import { firebaseConfig, aiSettings } from './firebase-config.js';
import { RULE_SYSTEM_PROMPT, personalGroupId, personalGroupName, parsePlayedAt } from './core.mjs?v=2.6';
import { createQuickMatch, changeQuickMatch, quickMatchResult } from './quick-core.mjs?v=2.6';
import { addTournamentEntrant, removeTournamentEntrant, startTournament, recordTournamentWinner, publicTournamentSnapshot, serializeTournamentRounds, deserializeTournamentRounds } from './tournament-core.mjs?v=2.1';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.4.0/firebase-app.js';
import { getAuth, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword, signInWithPopup, GoogleAuthProvider, signOut, updateProfile } from 'https://www.gstatic.com/firebasejs/12.4.0/firebase-auth.js';
import { getFirestore, doc, collection, getDoc, getDocs, setDoc, updateDoc, addDoc, onSnapshot, serverTimestamp, arrayUnion, runTransaction, writeBatch, Timestamp, query, where, or, deleteField } from 'https://www.gstatic.com/firebasejs/12.4.0/firebase-firestore.js';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'https://www.gstatic.com/firebasejs/12.4.0/firebase-app-check.js';
import { getAI, getGenerativeModel, GoogleAIBackend } from 'https://www.gstatic.com/firebasejs/12.4.0/firebase-ai.js';

const app = initializeApp(firebaseConfig);
if (aiSettings.recaptchaEnterpriseSiteKey) initializeAppCheck(app, {
  provider: new ReCaptchaEnterpriseProvider(aiSettings.recaptchaEnterpriseSiteKey),
  isTokenAutoRefreshEnabled: true
});
const auth = getAuth(app);
const db = getFirestore(app);
const googleProvider = new GoogleAuthProvider();
const groupRef = id => doc(db,'groups',id);
const memberRef = (gid,uid) => doc(db,'groups',gid,'members',uid);
const userRef = uid => doc(db,'users',uid);
const personalDeckRef = (uid,id) => doc(db,'users',uid,'decks',id);
const personalDeckCol = uid => collection(db,'users',uid,'decks');
const personalDeckImageRef = (uid,id) => doc(db,'users',uid,'deckImageSources',id);
const validSource = value => typeof value==='string'&&value.length<=150000&&(value===''||/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(value));
const playerCardRef = uid => doc(db,'playerCards',uid);
const publicTournamentRef = id => doc(db,'publicTournaments',id);
const publicTournamentOwnerRef = id => doc(db,'publicTournamentOwners',id);
const tournamentRef = (gid,id) => doc(db,'groups',gid,'tournaments',id);
const colRef = (gid,key) => collection(db,'groups',gid,key);
const tidy = docSnapshot => ({id:docSnapshot.id,...docSnapshot.data()});

async function rememberGroup(uid,gid,nickname){
  await setDoc(userRef(uid),{groups:arrayUnion(gid), nickname, updatedAt:serverTimestamp()},{merge:true});
}
// Auth callbacks and signUp() can overlap. Share one pending initialization
// per UID to avoid a second create being rejected as a restricted update.
const personalGroupTasks = new Map();
const initialProfiles=new Map();
const deckMigrationAttempted=new Set();
// Remote deck tasks are scoped to each group subscription to avoid stale results after switching.
let activeGroupDeckAccess=null;
async function ensurePersonalGroup(uid, nickname){
  const pending=personalGroupTasks.get(uid);
  if(pending)return pending;
  const task=(async()=>{
    const id=personalGroupId(uid), display=String(nickname||'玩家').trim().slice(0,24)||'玩家';
    const name=display.length>=2?display:'玩家';
    const g=groupRef(id);
    const existing=await getDoc(g);
    if(!existing.exists())await setDoc(g,{name:personalGroupName(name),createdBy:uid,createdAt:serverTimestamp()});
    else if(existing.data().createdBy!==uid)throw new Error('個人戰團識別碼被占用，請聯繫管理員。');
    const m=memberRef(id,uid);
    if(!(await getDoc(m)).exists()){
      const own=await getDoc(userRef(uid)),ownData=own.exists()?own.data():{};
      const avatarData=ownData.avatarData||'',level=Number(ownData.level)||1,frameChoice=ownData.frameChoice||'none';
      await setDoc(m,{uid,nickname:name,role:'owner',joinedAt:serverTimestamp(),...(avatarData?{avatarData}:{})});
      await optionallySyncMemberProgress(m,level,frameChoice);
    }
    await rememberGroup(uid,id,name);
    return id;
  })();
  personalGroupTasks.set(uid,task);
  try{return await task;}
  finally{if(personalGroupTasks.get(uid)===task)personalGroupTasks.delete(uid);}
}

async function optionallySyncMemberProgress(ref,level,frameChoice){
  try{await updateDoc(ref,{level,frameChoice});}
  catch(error){
    // Old published Firestore rules may not yet accept the new cosmetic fields.
    // A membership must still be creatable while rules are being upgraded.
    console.warn('玩家等級顯示欄位尚未同步，請確認已發布最新版 Firestore 規則',error);
  }
}

// Existing matches keep referencing original IDs. Copy owned group decks to
// the account library using the SAME IDs; leave the group documents untouched.
// This is idempotent and only the owner can execute canonical writes.
async function migrateMyLegacyDecks(uid,groupIds){
  let copied=0;
  for(const gid of groupIds){
    try{
      const list=await getDocs(query(colRef(gid,'decks'),where('ownerUid','==',uid)));
      for(const legacy of list.docs){
        const old=legacy.data();
        if(old.ownerUid!==uid||old.active===false)continue;
        const target=personalDeckRef(uid,legacy.id);
        if((await getDoc(target)).exists())continue;
        await setDoc(target,{
          ownerUid:uid,createdBy:uid,name:String(old.name||'舊牌組').slice(0,42)||'舊牌組',
          color:['RED','BLUE','GREEN','YELLOW','PURPLE','MULTI','OTHER'].includes(old.color)?old.color:'OTHER',
          imageData:old.imageData||'',active:old.active!==false,
          createdAt:serverTimestamp(),updatedAt:serverTimestamp()
        });
        copied++;
      }
    }catch(err){
      // A legacy group may no longer exist or a newly published ruleset may
      // still be propagating. Never block sign-in or delete source records.
      console.warn('Legacy deck migration skipped for group',gid,err);
    }
  }
  return copied;
}
export const firebaseAdapter = {
  mode:'cloud',
  aiEnabled:Boolean(aiSettings.enabled && aiSettings.recaptchaEnterpriseSiteKey),
  onAuth:cb=>onAuthStateChanged(auth,cb),
  async signUp(email,password,name){
    const res=await createUserWithEmailAndPassword(auth,email,password);
    await updateProfile(res.user,{displayName:name.trim()});
    await ensurePersonalGroup(res.user.uid,name);
    return res.user;
  },
  async signIn(email,password){return (await signInWithEmailAndPassword(auth,email,password)).user;},
  async signInGoogle(){return (await signInWithPopup(auth,googleProvider)).user;},
  async signOut(){await signOut(auth);},
  async getMyGroups(uid){
    const snap=await getDoc(userRef(uid));
    const profile=snap.exists()?snap.data():{};
    const nickname=profile.nickname||auth.currentUser?.displayName||auth.currentUser?.email?.split('@')[0]||'玩家';
    let groupIds=Array.isArray(profile.groups)?profile.groups.filter(x=>typeof x==='string'):[];
    const personalId=personalGroupId(uid);
    // Returning users already own this group: do not run three reads plus
    // a user-profile write during every sign-in merely to recreate it.
    if(!groupIds.includes(personalId)){
      await ensurePersonalGroup(uid,nickname);
      groupIds=[...new Set([...groupIds,personalId])];
    }
    initialProfiles.set(uid,{...profile,groups:groupIds});
    return groupIds;
  },
  async getProfile(uid){
    if(initialProfiles.has(uid)){const value=initialProfiles.get(uid);initialProfiles.delete(uid);return value;}
    const snap=await getDoc(userRef(uid));return snap.exists()?snap.data():{};
  },
  async migrateLegacyDecksOnDemand(uid,groupIds){
    if(auth.currentUser?.uid!==uid||deckMigrationAttempted.has(uid))return 0;
    deckMigrationAttempted.add(uid);
    try{return await migrateMyLegacyDecks(uid,groupIds)}
    catch(err){console.warn('Legacy deck migration skipped',err);return 0;}
  },
  async saveAvatar(uid,avatarData,groupIds,avatarSourceData=''){
    if(auth.currentUser?.uid!==uid)throw new Error('只能修改自己的頭像。');
    if(typeof avatarData!=='string'||(avatarData!==''&&!/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(avatarData))||avatarData.length>40000)
      throw new Error('頭像格式錯誤或檔案太大，請重新選擇圖片。');
    if(!validSource(avatarSourceData))throw new Error('頭像原圖格式錯誤或過大。');
    await setDoc(userRef(uid),{avatarData,avatarSourceData,updatedAt:serverTimestamp()},{merge:true});
    const failures=[];
    for(const gid of groupIds){
      try{await updateDoc(memberRef(gid,uid),{avatarData});}
      catch(err){console.warn('同步團員頭像失敗',gid,err);failures.push(gid);}
    }
    return {failures};
  },
  async saveProgression(uid,groupIds,progress){
    if(auth.currentUser?.uid!==uid)throw new Error('只能更新自己的等級與外框。');
    const level=Math.max(1,Math.floor(Number(progress.level)||1));
    const totalXp=Math.max(0,Math.floor(Number(progress.totalXp)||0));
    const bestStreak=Math.max(0,Math.floor(Number(progress.bestStreak)||0));
    const frameChoice=String(progress.frameChoice||'none');
    const thresholds={none:0,bronze:2,silver:5,gold:10,prismatic:20};
    if(level>10000||totalXp>1000000000||bestStreak>100000||
      !(frameChoice in thresholds)||thresholds[frameChoice]>bestStreak)throw new Error('玩家進度或連勝外框尚未解鎖。');
    // Transactional maximum prevents an older device from removing an earned frame.
    const stored=await runTransaction(db,async transaction=>{
      const ref=userRef(uid),snapshot=await transaction.get(ref),previous=snapshot.exists()?snapshot.data():{};
      const nextBest=Math.max(Number(previous.bestStreak)||0,bestStreak);
      const nextXp=Math.max(Number(previous.totalXp)||0,totalXp);
      const nextLevel=Math.max(Number(previous.level)||1,level);
      const selected=progress.changingFrame===true?frameChoice:
        (typeof previous.frameChoice==='string'?previous.frameChoice:frameChoice);
      const nextFrame=(selected in thresholds&&thresholds[selected]<=nextBest)?selected:'none';
      transaction.set(ref,{level:nextLevel,totalXp:nextXp,bestStreak:nextBest,
        frameChoice:nextFrame,updatedAt:serverTimestamp()},{merge:true});
      return {level:nextLevel,totalXp:nextXp,bestStreak:nextBest,frameChoice:nextFrame};
    });
    const failures=[];
    for(const gid of groupIds||[]){
      try{await updateDoc(memberRef(gid,uid),{level:stored.level,frameChoice:stored.frameChoice});}
      catch(error){console.warn('無法同步戰團的外框與等級',gid,error);failures.push(gid);}
    }
    return {failures,progress:stored};
  },
  async saveProfileCover(uid,profileCoverData,profileCoverSourceData=''){
    if(auth.currentUser?.uid!==uid)throw new Error('只能修改自己的資料背景。');
    if(typeof profileCoverData!=='string'||profileCoverData.length>90000||
       (profileCoverData!==''&&!/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(profileCoverData)))
      throw new Error('個人資料背景格式錯誤或圖片太大。');
    if(!validSource(profileCoverSourceData))throw new Error('背景原圖格式錯誤或過大。');
    await setDoc(userRef(uid),{profileCoverData,profileCoverSourceData,updatedAt:serverTimestamp()},{merge:true});
  },
  async saveProfile(uid,nickname,bio,groupIds){
    const name=nickname.trim();if(name.length<2||name.length>24)throw new Error('暱稱請使用 2–24 字元。');
    if(bio.length>160)throw new Error('個人簡介不得超過 160 字。');
    await updateProfile(auth.currentUser,{displayName:name});
    await setDoc(userRef(uid),{nickname:name,bio:bio.trim(),updatedAt:serverTimestamp()},{merge:true});
    const failures=[];
    for(const gid of groupIds){try{await updateDoc(memberRef(gid,uid),{nickname:name});}catch(e){failures.push(gid)}}
    return {failures};
  },
  subscribePublicTournament(id,onChange,onError){
    return onSnapshot(publicTournamentRef(id),snap=>onChange(snap.exists()?tidy(snap):null),onError);
  },
  async getGroup(gid){const snap=await getDoc(groupRef(gid));if(!snap.exists())throw new Error('找不到群組，請確認邀請代碼。');return tidy(snap);},
  async createGroup(uid,nickname,title){
    const g=doc(collection(db,'groups'));
    await setDoc(g,{name:title.trim(),createdBy:uid,createdAt:serverTimestamp()});
    const own=await getDoc(userRef(uid)),ownData=own.exists()?own.data():{};
      const avatarData=ownData.avatarData||'',level=Number(ownData.level)||1,frameChoice=ownData.frameChoice||'none';
    await setDoc(memberRef(g.id,uid),{uid,nickname:nickname.trim(),role:'owner',joinedAt:serverTimestamp(),...(avatarData?{avatarData}:{})});
    await optionallySyncMemberProgress(memberRef(g.id,uid),level,frameChoice);
    await rememberGroup(uid,g.id,nickname.trim());
    return g.id;
  },
  async joinGroup(uid,nickname,gid){
    const g=await this.getGroup(gid);
    const existing=await getDoc(memberRef(gid,uid));
    if(!existing.exists()){
      const own=await getDoc(userRef(uid)),ownData=own.exists()?own.data():{};
      const avatarData=ownData.avatarData||'',level=Number(ownData.level)||1,frameChoice=ownData.frameChoice||'none';
      await setDoc(memberRef(gid,uid),{uid,nickname:nickname.trim(),role:g.createdBy===uid?'owner':'member',joinedAt:serverTimestamp(),...(avatarData?{avatarData}:{})});
      await optionallySyncMemberProgress(memberRef(gid,uid),level,frameChoice);
    }
    await rememberGroup(uid,gid,nickname.trim());
    return gid;
  },
  subscribe(gid,onChange,onError){
    const keys=['decks','matches','quickMatches','tournaments'];
    const current={members:[],decks:[],matches:[],quickMatches:[],tournaments:[]};
    const personal=new Map(),remoteLoadedAt=new Map(),memberIds=new Set(),remoteTasks=new Map();
    let stopped=false,scheduled=false;
    const ownUid=auth.currentUser?.uid;
    const emit=()=>{
      if(stopped)return;
      const joined=new Map(current.decks.map(d=>[d.id,{...d,legacy:true}]));
      for(const entries of personal.values())
        for(const d of entries)joined.set(d.id,{...d,personal:true});
      onChange({...current,decks:[...joined.values()]});
    };
    const schedule=()=>{
      if(scheduled||stopped)return;
      scheduled=true;
      queueMicrotask(()=>{scheduled=false;emit()});
    };
    const remoteLoad=async uid=>{
      if(stopped||!uid||uid===ownUid||!memberIds.has(uid)||
        Date.now()-(remoteLoadedAt.get(uid)||0)<60000)return;
      if(remoteTasks.has(uid))return remoteTasks.get(uid);
      const job=(async()=>{
        try{
          const snapshot=await getDocs(personalDeckCol(uid));
          if(stopped)return;
          personal.set(uid,snapshot.docs.map(tidy));
          remoteLoadedAt.set(uid,Date.now());schedule();
        }catch(err){if(!stopped)onError?.(err)}
        finally{remoteTasks.delete(uid)}
      })();
      remoteTasks.set(uid,job);
      return job;
    };
    const prefetchRecent=()=>{
      if(!memberIds.size||!current.matches.length)return;
      const ids=new Set();
      const recent=current.matches.slice().sort((a,b)=>
        (Number(b.playedAt?.seconds||b.createdAt?.seconds||0)-
         Number(a.playedAt?.seconds||a.createdAt?.seconds||0))).slice(0,12);
      for(const m of recent){
        if(m.playerA!==ownUid)ids.add(m.playerA);
        if(m.playerB!==ownUid)ids.add(m.playerB);
      }
      // No all-member scan: only up to six recent opponents are prefetched.
      for(const uid of [...ids].filter(id=>memberIds.has(id)).slice(0,6))
        void remoteLoad(uid);
    };
    const unsubs=keys.map(k=>onSnapshot(colRef(gid,k),snapshot=>{
      current[k]=snapshot.docs.map(tidy);
      schedule();
      if(k==='matches')prefetchRecent();
    },onError));
    unsubs.push(onSnapshot(colRef(gid,'members'),snapshot=>{
      current.members=snapshot.docs.map(tidy);
      const next=new Set(current.members.map(x=>x.id));
      for(const uid of personal.keys())if(uid!==ownUid&&!next.has(uid)){
        personal.delete(uid);remoteLoadedAt.delete(uid);
      }
      memberIds.clear();for(const uid of next)memberIds.add(uid);
      prefetchRecent();schedule();
    },onError));
    if(ownUid)unsubs.push(onSnapshot(personalDeckCol(ownUid),snapshot=>{
      personal.set(ownUid,snapshot.docs.map(tidy));schedule();
    },onError));
    activeGroupDeckAccess={gid,load:remoteLoad};
    return ()=>{
      stopped=true;
      unsubs.forEach(stop=>stop());
      if(activeGroupDeckAccess?.gid===gid&&activeGroupDeckAccess.load===remoteLoad)activeGroupDeckAccess=null;
      personal.clear();remoteLoadedAt.clear();remoteTasks.clear();
    };
  },
  async loadPlayerDecks(gid,uid){
    if(activeGroupDeckAccess?.gid!==gid)return;
    return activeGroupDeckAccess.load(uid);
  },
  subscribePersonalHistory(groupIds,uid,onChange,onError){
    const byGroup={};
    const unsubs=groupIds.map(gid=>onSnapshot(
      query(colRef(gid,'matches'),or(where('playerA','==',uid),where('playerB','==',uid))),
      snapshot=>{
        byGroup[gid]=snapshot.docs.map(tidy);
        onChange({...byGroup});
      },onError));
    return ()=>unsubs.forEach(fn=>fn());
  },
  subscribePersonalTournaments(groupIds,uid,onChange,onError){
    const byGroup={};
    const unsubs=groupIds.map(gid=>onSnapshot(colRef(gid,'tournaments'),snapshot=>{
      byGroup[gid]=snapshot.docs.map(tidy).filter(t=>t.participants?.some(p=>p.uid===uid));
      onChange({...byGroup});
    },onError));
    return ()=>unsubs.forEach(stop=>stop());
  },
  async getPlayerCard(uid){
    const snap=await getDoc(playerCardRef(uid));
    return snap.exists()?snap.data():null;
  },
  async savePlayerCard(uid,card){
    if(auth.currentUser?.uid!==uid)throw new Error('只能修改自己的公開名片。');
    const sourceData=String(card.coverSourceData||'');
    if(!validSource(sourceData))throw new Error('名片背景原圖無效或過大。');
    const batch=writeBatch(db);
    batch.set(playerCardRef(uid),{
      nickname:String(card.nickname||'玩家').trim().slice(0,24),
      coverData:typeof card.coverData==='string'&&card.coverData.length<=90000&&(!card.coverData||/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(card.coverData))?card.coverData:'',
      bio:card.showBio?String(card.bio||'').trim().slice(0,160):'',
      showBio:!!card.showBio,showGroupStats:!!card.showGroupStats,
      showOverallStats:!!card.showOverallStats,showFavoriteDeck:!!card.showFavoriteDeck,
      favoriteDeck:card.showFavoriteDeck?{name:card.favoriteDeck?.name||'',color:card.favoriteDeck?.color||'OTHER'}:{name:'',color:'OTHER'},
      favoriteDeckStats:card.showFavoriteDeck?{games:Number(card.favoriteDeckStats?.games||0),wins:Number(card.favoriteDeckStats?.wins||0),losses:Number(card.favoriteDeckStats?.losses||0),rate:Number(card.favoriteDeckStats?.rate||0)}:{games:0,wins:0,losses:0,rate:0},
      totalStats:{games:Number(card.totalStats?.games||0),wins:Number(card.totalStats?.wins||0),
        losses:Number(card.totalStats?.losses||0),rate:Number(card.totalStats?.rate||0)},
      updatedAt:serverTimestamp()
    });
    // Keep the full source private; only the cropped banner is publicly readable.
    batch.set(userRef(uid),{cardCoverSourceData:sourceData,updatedAt:serverTimestamp()},{merge:true});
    await batch.commit();
  },
  async getDeckSource(uid,id){
    if(auth.currentUser?.uid!==uid)throw new Error('只能檢視自己的牌組圖片來源。');
    const snap=await getDoc(personalDeckImageRef(uid,id));
    return snap.exists()?String(snap.data().sourceData||''):'';
  },
  async addDeck(gid,uid,d){
    if(d.ownerUid!==uid)throw new Error('牌組只能新增到自己的帳號。');

    const sourceData=String(d.imageSourceData||'');
    if(!validSource(sourceData))throw new Error('牌組來源圖片無效或過大。');
    const ref=doc(personalDeckCol(uid)),batch=writeBatch(db);
    batch.set(ref,{ownerUid:uid,createdBy:uid,name:d.name.trim(),color:d.color,
      imageData:d.imageData||'',active:true,createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
    batch.set(personalDeckImageRef(uid,ref.id),{sourceData,updatedAt:serverTimestamp()});
    await batch.commit();
  },
  async updateDeck(gid,id,d){
    const uid=auth.currentUser?.uid;
    if(!uid||d.ownerUid!==uid)throw new Error('只能修改自己的牌組。');

    const sourceData=String(d.imageSourceData||'');
    if(!validSource(sourceData))throw new Error('牌組來源圖片無效或過大。');
    const batch=writeBatch(db);
    batch.update(personalDeckRef(uid,id),{name:d.name.trim(),color:d.color,imageData:d.imageData||'',updatedAt:serverTimestamp()});
    batch.set(personalDeckImageRef(uid,id),{sourceData,updatedAt:serverTimestamp()});
    await batch.commit();
  },
  async archiveDeck(gid,id){
    const uid=auth.currentUser?.uid;
    if(!uid)throw new Error('請先登入。');
    await updateDoc(personalDeckRef(uid,id),{active:false,updatedAt:serverTimestamp()});
  },
  async addMatch(gid,uid,m){
    const playedAt=m.playedAt?parsePlayedAt(m.playedAt):new Date();
    await addDoc(colRef(gid,'matches'),{playerA:m.playerA,deckA:m.deckA,playerB:m.playerB,deckB:m.deckB,winner:m.winner,
      ...(m.guestDeck?{guestDeck:{name:m.guestDeck.name.trim(),color:m.guestDeck.color}}:{}),
      ...(m.firstPlayer?{firstPlayer:m.firstPlayer}:{}),isBackfill:m.isBackfill===true,playedAt:Timestamp.fromDate(playedAt),
      note:(m.note||'').trim(),recordedBy:uid,status:'active',createdAt:serverTimestamp()});
  },
  async updateTimedMatch(gid,id,winner,note){
    const ref=doc(db,'groups',gid,'matches',id);
    const snap=await getDoc(ref);
    if(!snap.exists())throw new Error('找不到這場對戰。');
    const before=snap.data();
    if(before.status!=='active'||!before.quickMatchId||before.tournamentId||
       ![before.playerA,before.playerB].includes(winner))throw new Error('此計時對戰不可編輯。');
    await updateDoc(ref,{winner,note:String(note||'').trim().slice(0,200)});
  },
  async updateMatch(gid,id,m){
    const ref=doc(db,'groups',gid,'matches',id);
    const snap=await getDoc(ref);
    if(!snap.exists())throw new Error('找不到這場對戰。');
    const before=snap.data();
    if(before.status!=='active'||before.tournamentId||before.quickMatchId)
      throw new Error('只有一般對戰可從戰績詳情編輯，計時與錦標賽紀錄不可直接修改。');
    await updateDoc(ref,{
      playerA:m.playerA,playerB:m.playerB,deckA:m.deckA,deckB:m.deckB,
      winner:m.winner,note:(m.note||'').trim().slice(0,200),
      isBackfill:before.isBackfill===true||m.isBackfill===true,
      firstPlayer:m.firstPlayer||deleteField(),
      playedAt:Timestamp.fromDate(parsePlayedAt(m.playedAt)),
      guestDeck:m.guestDeck?{name:m.guestDeck.name.trim(),color:m.guestDeck.color}:deleteField()
    });
  },
  async voidMatch(gid,id){await updateDoc(doc(db,'groups',gid,'matches',id),{status:'void',cancelledAt:serverTimestamp()});},
  async createQuickMatch(gid,uid,payload){
    const now=Date.now();
    const obj=createQuickMatch(payload,uid,now);
    const created=await addDoc(colRef(gid,'quickMatches'),{...obj,createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
    return created.id;
  },
  async hideQuickMatch(gid,id,uid){
    const ref=doc(db,'groups',gid,'quickMatches',id);
    const snap=await getDoc(ref);
    if(!snap.exists())throw new Error('找不到此速配場次。');
    const q=snap.data();
    if(![q.playerA,q.playerB,q.createdBy].includes(uid)){
      const g=await getDoc(groupRef(gid));
      if(!g.exists()||g.data().createdBy!==uid)throw new Error('只有玩家、建立者或房主可以移除速配場次。');
    }
    if(!['finished','cancelled'].includes(q.status))throw new Error('請先結束或取消計時，再移除清單紀錄。');
    if(q.hiddenAt)return;
    await updateDoc(ref,{hiddenAt:serverTimestamp()});
  },
  async changeQuickMatch(gid,id,uid,action,playerId=''){
    const ref=doc(db,'groups',gid,'quickMatches',id);
    await runTransaction(db,async tx=>{
      const snap=await tx.get(ref);
      if(!snap.exists())throw new Error('找不到計時中的對戰。');
      const next=changeQuickMatch(snap.data(),action,{uid,playerId,now:Date.now()});
      tx.update(ref,{...next,updatedAt:serverTimestamp()});
    });
  },
  async finishQuickMatch(gid,id,uid,winner,note=''){
    const ref=doc(db,'groups',gid,'quickMatches',id);
    const matchDoc=doc(colRef(gid,'matches'));
    await runTransaction(db,async tx=>{
      const snap=await tx.get(ref);
      if(!snap.exists())throw new Error('找不到此對戰。');
      const before=snap.data();
      if(![before.playerA,before.playerB].includes(winner))throw new Error('請選擇勝利玩家。');
      const next=changeQuickMatch(before,'finish',{uid,matchId:matchDoc.id,now:Date.now()});
      const timing=quickMatchResult(next,next.finishedAtMs);
      tx.set(matchDoc,{playerA:before.playerA,deckA:before.deckA,playerB:before.playerB,deckB:before.deckB,
        ...(before.guestDeck?{guestDeck:before.guestDeck}:{}),
        winner,...(before.firstPlayer?{firstPlayer:before.firstPlayer}:{}),note:note.trim().slice(0,200),recordedBy:uid,status:'active',createdAt:serverTimestamp(),
        quickMatchId:id,timing,playedAt:Timestamp.fromMillis(before.startedAtMs||before.createdAtMs)});
      tx.update(ref,{...next,updatedAt:serverTimestamp()});
    });
  },

  subscribeTournamentRequests(gid,id,onChange,onError){
    return onSnapshot(collection(db,'groups',gid,'tournaments',id,'requests'),snap=>onChange(snap.docs.map(tidy)),onError);
  },
  async hasTournamentRequest(gid,id,uid){
    const ref=doc(db,'groups',gid,'tournaments',id,'requests',uid);
    const snap=await getDoc(ref);return snap.exists();
  },
  async requestTournamentJoin(gid,id,uid,nickname){
    await setDoc(doc(db,'groups',gid,'tournaments',id,'requests',uid),{uid,nickname:nickname.slice(0,24),status:'pending',createdAt:serverTimestamp()});
  },
  async approveTournamentRequest(gid,id,uid,hostUid){
    const ref=tournamentRef(gid,id),req=doc(db,'groups',gid,'tournaments',id,'requests',uid);
    await runTransaction(db,async tx=>{
      const t=await tx.get(ref),r=await tx.get(req),member=await tx.get(memberRef(gid,uid));
      if(!t.exists()||!r.exists()||!member.exists())throw new Error('報名不存在或玩家已離開對戰團。');
      const current=t.data();if(current.createdBy!==hostUid)throw new Error('只有房主可以審核報名。');
      const next=addTournamentEntrant(current,{uid,nickname:member.data().nickname});
      tx.update(ref,{participants:next.participants,updatedAt:serverTimestamp()});
      tx.update(publicTournamentRef(current.publicId),{...publicTournamentSnapshot(next),updatedAt:serverTimestamp()});
      tx.delete(req);
    });
  },
  async createTournament(gid,uid,title,description,hostName,eventTime){
    const name=title.trim(),desc=description.trim();
    const eventAt=Timestamp.fromDate(parsePlayedAt(eventTime));
    if(name.length<2||name.length>60||desc.length>240)throw new Error('錦標賽名稱為 2–60 字，說明最多 240 字。');
    const privateRef=doc(colRef(gid,'tournaments'));
    const publicRef=doc(collection(db,'publicTournaments'));
    const t={title:name,description:desc,hostName:hostName.trim().slice(0,24),status:'registration',createdBy:uid,
      publicId:publicRef.id,participants:[],rounds:[],champion:'',eventAt,createdAt:serverTimestamp(),updatedAt:serverTimestamp()};
    const batch=writeBatch(db);
    batch.set(privateRef,t);
    batch.set(publicTournamentOwnerRef(publicRef.id),{ownerUid:uid,createdAt:serverTimestamp()});
    batch.set(publicRef,{...publicTournamentSnapshot(t),createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
    await batch.commit();return privateRef.id;
  },
  async changeTournament(gid,id,uid,action,playerOrResult){
    const ref=tournamentRef(gid,id);
    await runTransaction(db,async tx=>{
      const snap=await tx.get(ref);
      if(!snap.exists())throw new Error('錦標賽不存在。');
      const current=snap.data();
      if(current.createdBy!==uid)throw new Error('只有錦標賽房主可以修改參賽名單及戰績。');
      let next;
      if(action==='add'){
        const member=await tx.get(memberRef(gid,playerOrResult));
        if(!member.exists())throw new Error('只能加入此對戰團內的玩家。');
        next=addTournamentEntrant(current,{uid:playerOrResult,nickname:member.data().nickname});
      }else if(action==='remove')next=removeTournamentEntrant(current,playerOrResult);
      else if(action==='start')next=startTournament(current);
      else if(action==='result')throw new Error('請透過淘汰賽詳細設定選擇牌組、勝者及對戰時間。');
      else if(action==='cancel'){
        if(current.status!=='registration')throw new Error('進行中的錦標賽不能取消。');
        next={...current,status:'cancelled'};
      }else throw new Error('不支援的錦標賽操作。');
      tx.update(ref,{participants:next.participants,rounds:serializeTournamentRounds(next.rounds),status:next.status,champion:next.champion,updatedAt:serverTimestamp()});
      tx.update(publicTournamentRef(current.publicId),{...publicTournamentSnapshot(next),updatedAt:serverTimestamp()});
    });
  },

  /** Save the bracket result and the regular match together, once only. */
  async saveTournamentMatch(gid,id,uid,payload){
    const tRef=tournamentRef(gid,id),round=Number(payload.round),index=Number(payload.match);
    if(!Number.isInteger(round)||round<0||round>4||!Number.isInteger(index)||index<0||index>15)throw new Error('無效的淘汰賽場次。');
    const playedAt=Timestamp.fromDate(parsePlayedAt(payload.playedAt));
    const matchRef=doc(colRef(gid,'matches'),`t_${id}_${round}_${index}`);
    await runTransaction(db,async tx=>{
      const snap=await tx.get(tRef),existing=await tx.get(matchRef);
      if(!snap.exists())throw new Error('找不到這場錦標賽。');
      if(existing.exists())throw new Error('這場對戰已登錄，不能重複計入戰績。');
      const current=snap.data();
      if(current.createdBy!==uid)throw new Error('只有賽事房主可以記錄對戰結果。');
      const side=deserializeTournamentRounds(current.rounds)[round]?.[index];
      if(!side?.a||!side?.b||side.winner)throw new Error('這場賽程尚未開放或已有結果。');
      if(payload.playerA!==side.a||payload.playerB!==side.b)throw new Error('玩家必須與抽籤結果相同。');
      if(![side.a,side.b].includes(payload.winner))throw new Error('勝者必須是本場參賽玩家。');
      const next=recordTournamentWinner(current,round,index,payload.winner,matchRef.id);
      tx.set(matchRef,{playerA:side.a,playerB:side.b,deckA:payload.deckA,deckB:payload.deckB,
        winner:payload.winner,...(payload.firstPlayer?{firstPlayer:payload.firstPlayer}:{}),isBackfill:payload.isBackfill===true,note:String(payload.note||'').trim().slice(0,200),playedAt,recordedBy:uid,status:'active',
        tournamentId:id,tournamentRound:round,tournamentMatch:index,tournamentTitle:current.title,
        createdAt:serverTimestamp()});
      tx.update(tRef,{participants:next.participants,rounds:serializeTournamentRounds(next.rounds),
        status:next.status,champion:next.champion,updatedAt:serverTimestamp()});
      tx.update(publicTournamentRef(current.publicId),{...publicTournamentSnapshot(next),updatedAt:serverTimestamp()});
    });
  },
  /** Atomically delete private event, its recorded rounds, public listing,
   * owner metadata and pending requests. Reject a stale bracket snapshot. */
  async deleteTournament(gid,id,uid){
    const tRef=tournamentRef(gid,id),snap=await getDoc(tRef);
    if(!snap.exists())throw new Error('錦標賽已不存在。');
    const t=snap.data();
    if(t.createdBy!==uid)throw new Error('只有房主可以刪除錦標賽。');
    const [matches,requests]=await Promise.all([
      getDocs(query(colRef(gid,'matches'),where('tournamentId','==',id))),
      getDocs(collection(db,'groups',gid,'tournaments',id,'requests'))
    ]);
    if(matches.size>40||requests.size>40)throw new Error('關聯紀錄數量異常，請先檢查。');
    const oldUpdated=t.updatedAt?.toMillis?.()||0;
    await runTransaction(db,async tx=>{
      const latest=await tx.get(tRef);
      if(!latest.exists()||latest.data().createdBy!==uid)throw new Error('沒有刪除權限或賽事已不存在。');
      if((latest.data().updatedAt?.toMillis?.()||0)!==oldUpdated)throw new Error('刪除前賽程已更新，請重新整理再試。');
      const recorded=deserializeTournamentRounds(latest.data().rounds).flat().filter(m=>m.matchId).length;
      if(recorded!==matches.size)throw new Error('關聯戰績與賽程不一致，請先檢查，避免遺漏資料。');
      for(const m of matches.docs)tx.delete(m.ref);
      for(const request of requests.docs)tx.delete(request.ref);
      tx.delete(tRef);
      tx.delete(publicTournamentRef(t.publicId));
      tx.delete(publicTournamentOwnerRef(t.publicId));
    });
  },
  async askRule(question,edition){
    if(!this.aiEnabled)throw new Error('尚未啟用 Firebase AI Logic 與 App Check，請依部署文件設定。');
    const ai=getAI(app,{backend:new GoogleAIBackend()});
    const model=getGenerativeModel(ai,{model:aiSettings.model||'gemini-2.5-flash',systemInstruction:RULE_SYSTEM_PROMPT,generationConfig:{maxOutputTokens:450,temperature:0.15}});
    const result=await model.generateContent(`使用者指定 UA 卡牌版本：${edition}。請謹慎分辨版本差異。問題：${question}`);
    return result.response.text()||'目前無法取得可用的回答。';
  }
};
