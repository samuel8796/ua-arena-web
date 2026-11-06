import { firebaseConfig, aiSettings } from './firebase-config.js';
import { RULE_SYSTEM_PROMPT, personalGroupId, personalGroupName, parsePlayedAt } from './core.mjs';
import { createQuickMatch, changeQuickMatch, quickMatchResult } from './quick-core.mjs';
import { addTournamentEntrant, removeTournamentEntrant, startTournament, recordTournamentWinner, publicTournamentSnapshot, serializeTournamentRounds, deserializeTournamentRounds } from './tournament-core.mjs?v=2.1';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.4.0/firebase-app.js';
import { getAuth, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword, signInWithPopup, GoogleAuthProvider, signOut, updateProfile } from 'https://www.gstatic.com/firebasejs/12.4.0/firebase-auth.js';
import { getFirestore, doc, collection, getDoc, getDocs, setDoc, updateDoc, addDoc, onSnapshot, serverTimestamp, arrayUnion, runTransaction, writeBatch, Timestamp, query, where } from 'https://www.gstatic.com/firebasejs/12.4.0/firebase-firestore.js';
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
      const own=await getDoc(userRef(uid)),avatarData=own.exists()?own.data().avatarData||'':'';
      await setDoc(m,{uid,nickname:name,role:'owner',joinedAt:serverTimestamp(),...(avatarData?{avatarData}:{})});
    }
    await rememberGroup(uid,id,name);
    return id;
  })();
  personalGroupTasks.set(uid,task);
  try{return await task;}
  finally{if(personalGroupTasks.get(uid)===task)personalGroupTasks.delete(uid);}
}

// Existing matches keep referencing original IDs. Copy owned group decks to
// the account library using the SAME IDs; leave the group documents untouched.
// This is idempotent and only the owner can execute canonical writes.
async function migrateMyLegacyDecks(uid,groupIds){
  let copied=0;
  for(const gid of groupIds){
    try{
      const list=await getDocs(colRef(gid,'decks'));
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
    const display=snap.exists()?snap.data().nickname:null;
    const nickname=display||auth.currentUser?.displayName||auth.currentUser?.email?.split('@')[0]||'玩家';
    await ensurePersonalGroup(uid,nickname);
    const current=await getDoc(userRef(uid));
    const groupIds=current.exists()?(current.data().groups||[]):[];
    // Run best-effort migration without delaying account sign-in.
    void migrateMyLegacyDecks(uid,groupIds).catch(err=>console.warn('Deck migration',err));
    return groupIds;
  },
  async getProfile(uid){const snap=await getDoc(userRef(uid));return snap.exists()?snap.data():{};},
  async saveAvatar(uid,avatarData,groupIds){
    if(auth.currentUser?.uid!==uid)throw new Error('只能修改自己的頭像。');
    if(typeof avatarData!=='string'||(avatarData!==''&&!/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(avatarData))||avatarData.length>40000)
      throw new Error('頭像格式錯誤或檔案太大，請重新選擇圖片。');
    await setDoc(userRef(uid),{avatarData,updatedAt:serverTimestamp()},{merge:true});
    const failures=[];
    for(const gid of groupIds){
      try{await updateDoc(memberRef(gid,uid),{avatarData});}
      catch(err){console.warn('同步團員頭像失敗',gid,err);failures.push(gid);}
    }
    return {failures};
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
    const own=await getDoc(userRef(uid)),avatarData=own.exists()?own.data().avatarData||'':'';
    await setDoc(memberRef(g.id,uid),{uid,nickname:nickname.trim(),role:'owner',joinedAt:serverTimestamp(),...(avatarData?{avatarData}:{})});
    await rememberGroup(uid,g.id,nickname.trim());
    return g.id;
  },
  async joinGroup(uid,nickname,gid){
    const g=await this.getGroup(gid);
    const existing=await getDoc(memberRef(gid,uid));
    if(!existing.exists()){
      const own=await getDoc(userRef(uid)),avatarData=own.exists()?own.data().avatarData||'':'';
      await setDoc(memberRef(gid,uid),{uid,nickname:nickname.trim(),role:g.createdBy===uid?'owner':'member',joinedAt:serverTimestamp(),...(avatarData?{avatarData}:{})});
    }
    await rememberGroup(uid,gid,nickname.trim());
    return gid;
  },
  subscribe(gid,onChange,onError){
    const keys=['decks','matches','quickMatches','tournaments'];
    const current={members:[],decks:[],matches:[],quickMatches:[],tournaments:[]};
    const personal=new Map(), personalUnsubs=new Map();
    const emit=()=>{
      // Legacy decks are fallback until the owner logs in. Account-owned decks
      // win when an ID exists in both places.
      const joined=new Map(current.decks.map(d=>[d.id,{...d,legacy:true}]));
      for(const entries of personal.values())for(const d of entries)joined.set(d.id,{...d,personal:true});
      onChange({...current,decks:[...joined.values()]});
    };
    const unsubs=keys.map(k=>onSnapshot(colRef(gid,k),snapshot=>{
      current[k]=snapshot.docs.map(tidy);emit();
    },onError));
    unsubs.push(onSnapshot(colRef(gid,'members'),snapshot=>{
      current.members=snapshot.docs.map(tidy);
      const ids=new Set(current.members.map(x=>x.id));
      for(const [uid,stop] of personalUnsubs){
        if(!ids.has(uid)){stop();personalUnsubs.delete(uid);personal.delete(uid);}
      }
      for(const uid of ids){
        if(personalUnsubs.has(uid))continue;
        personalUnsubs.set(uid,onSnapshot(personalDeckCol(uid),snapshot=>{
          personal.set(uid,snapshot.docs.map(tidy));emit();
        },onError));
      }
      emit();
    },onError));
    return ()=>{unsubs.forEach(fn=>fn());personalUnsubs.forEach(fn=>fn());personalUnsubs.clear();};
  },
  // Listen to the current account's records from EVERY joined group. Only
  // matches involving the account are used for its overall statistics.
  subscribePersonalHistory(groupIds,uid,onChange,onError){
    const byGroup={};
    const unsubs=groupIds.map(gid=>onSnapshot(colRef(gid,'matches'),snapshot=>{
      byGroup[gid]=snapshot.docs.map(tidy).filter(m=>m.playerA===uid||m.playerB===uid);
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
    await setDoc(playerCardRef(uid),{
      nickname:String(card.nickname||'玩家').trim().slice(0,24),
      bio:card.showBio?String(card.bio||'').trim().slice(0,160):'',
      showBio:!!card.showBio,showGroupStats:!!card.showGroupStats,
      showOverallStats:!!card.showOverallStats,showFavoriteDeck:!!card.showFavoriteDeck,
      favoriteDeck:card.showFavoriteDeck?{name:card.favoriteDeck?.name||'',color:card.favoriteDeck?.color||'OTHER'}:{name:'',color:'OTHER'},
      favoriteDeckStats:card.showFavoriteDeck?{games:Number(card.favoriteDeckStats?.games||0),wins:Number(card.favoriteDeckStats?.wins||0),losses:Number(card.favoriteDeckStats?.losses||0),rate:Number(card.favoriteDeckStats?.rate||0)}:{games:0,wins:0,losses:0,rate:0},
      totalStats:{games:Number(card.totalStats?.games||0),wins:Number(card.totalStats?.wins||0),
        losses:Number(card.totalStats?.losses||0),rate:Number(card.totalStats?.rate||0)},
      updatedAt:serverTimestamp()
    });
  },
  async addDeck(gid,uid,d){
    if(d.ownerUid!==uid)throw new Error('牌組只能新增到自己的帳號。');
    await addDoc(personalDeckCol(uid),{ownerUid:uid,createdBy:uid,name:d.name.trim(),color:d.color,
      imageData:d.imageData||'',active:true,createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
  },
  async updateDeck(gid,id,d){
    const uid=auth.currentUser?.uid;
    if(!uid||d.ownerUid!==uid)throw new Error('只能修改自己的牌組。');
    await updateDoc(personalDeckRef(uid,id),{name:d.name.trim(),color:d.color,imageData:d.imageData||'',updatedAt:serverTimestamp()});
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
      ...(m.firstPlayer?{firstPlayer:m.firstPlayer}:{}),playedAt:Timestamp.fromDate(playedAt),
      note:(m.note||'').trim(),recordedBy:uid,status:'active',createdAt:serverTimestamp()});
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
    if(![q.playerA,q.playerB].includes(uid))throw new Error('只有本場兩位玩家能移除速配清單紀錄。');
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
        winner:payload.winner,...(payload.firstPlayer?{firstPlayer:payload.firstPlayer}:{}),note:String(payload.note||'').trim().slice(0,200),playedAt,recordedBy:uid,status:'active',
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
