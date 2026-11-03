import { firebaseConfig, aiSettings } from './firebase-config.js';
import { RULE_SYSTEM_PROMPT } from './core.mjs';
import { createQuickMatch, changeQuickMatch, quickMatchResult } from './quick-core.mjs';
import { addTournamentEntrant, removeTournamentEntrant, startTournament, recordTournamentWinner, publicTournamentSnapshot } from './tournament-core.mjs';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.4.0/firebase-app.js';
import { getAuth, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword, signInWithPopup, GoogleAuthProvider, signOut, updateProfile } from 'https://www.gstatic.com/firebasejs/12.4.0/firebase-auth.js';
import { getFirestore, doc, collection, getDoc, setDoc, updateDoc, addDoc, onSnapshot, serverTimestamp, arrayUnion, runTransaction, writeBatch } from 'https://www.gstatic.com/firebasejs/12.4.0/firebase-firestore.js';
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
const publicTournamentRef = id => doc(db,'publicTournaments',id);
const tournamentRef = (gid,id) => doc(db,'groups',gid,'tournaments',id);
const colRef = (gid,key) => collection(db,'groups',gid,key);
const tidy = docSnapshot => ({id:docSnapshot.id,...docSnapshot.data()});

async function rememberGroup(uid,gid,nickname){
  await setDoc(userRef(uid),{groups:arrayUnion(gid), nickname, updatedAt:serverTimestamp()},{merge:true});
}
export const firebaseAdapter = {
  mode:'cloud',
  aiEnabled:Boolean(aiSettings.enabled && aiSettings.recaptchaEnterpriseSiteKey),
  onAuth:cb=>onAuthStateChanged(auth,cb),
  async signUp(email,password,name){
    const res=await createUserWithEmailAndPassword(auth,email,password);
    await updateProfile(res.user,{displayName:name.trim()});
    return res.user;
  },
  async signIn(email,password){return (await signInWithEmailAndPassword(auth,email,password)).user;},
  async signInGoogle(){return (await signInWithPopup(auth,googleProvider)).user;},
  async signOut(){await signOut(auth);},
  async getMyGroups(uid){const snap=await getDoc(userRef(uid));return snap.exists()?(snap.data().groups||[]):[];},
  async getProfile(uid){const snap=await getDoc(userRef(uid));return snap.exists()?snap.data():{};},
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
    await setDoc(memberRef(g.id,uid),{uid,nickname:nickname.trim(),role:'owner',joinedAt:serverTimestamp()});
    await rememberGroup(uid,g.id,nickname.trim());
    return g.id;
  },
  async joinGroup(uid,nickname,gid){
    const g=await this.getGroup(gid);
    const existing=await getDoc(memberRef(gid,uid));
    if(!existing.exists())await setDoc(memberRef(gid,uid),{uid,nickname:nickname.trim(),role:g.createdBy===uid?'owner':'member',joinedAt:serverTimestamp()});
    await rememberGroup(uid,gid,nickname.trim());
    return gid;
  },
  subscribe(gid,onChange,onError){
    const keys=['members','decks','matches','quickMatches','tournaments'];
    const current={members:[],decks:[],matches:[],quickMatches:[],tournaments:[]};
    const unsubscribe=keys.map(k=>onSnapshot(colRef(gid,k),snapshot=>{
      current[k]=snapshot.docs.map(tidy);onChange({...current});
    },onError));
    return ()=>unsubscribe.forEach(fn=>fn());
  },
  async addDeck(gid,uid,d){
    await addDoc(colRef(gid,'decks'),{ownerUid:d.ownerUid,createdBy:uid,name:d.name.trim(),color:d.color,imageData:d.imageData||'',active:true,createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
  },
  async updateDeck(gid,id,d){
    await updateDoc(doc(db,'groups',gid,'decks',id),{name:d.name.trim(),color:d.color,imageData:d.imageData||'',updatedAt:serverTimestamp()});
  },
  async archiveDeck(gid,id){await updateDoc(doc(db,'groups',gid,'decks',id),{active:false,updatedAt:serverTimestamp()});},
  async addMatch(gid,uid,m){
    await addDoc(colRef(gid,'matches'),{playerA:m.playerA,deckA:m.deckA,playerB:m.playerB,deckB:m.deckB,winner:m.winner,note:(m.note||'').trim(),recordedBy:uid,status:'active',createdAt:serverTimestamp()});
  },
  async voidMatch(gid,id){await updateDoc(doc(db,'groups',gid,'matches',id),{status:'void',cancelledAt:serverTimestamp()});},
  async createQuickMatch(gid,uid,payload){
    const now=Date.now();
    const obj=createQuickMatch(payload,uid,now);
    const created=await addDoc(colRef(gid,'quickMatches'),{...obj,createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
    return created.id;
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
        winner,note:note.trim().slice(0,200),recordedBy:uid,status:'active',createdAt:serverTimestamp(),
        quickMatchId:id,timing});
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
  async createTournament(gid,uid,title,description,hostName){
    const name=title.trim(),desc=description.trim();
    if(name.length<2||name.length>60||desc.length>240)throw new Error('錦標賽名稱為 2–60 字，說明最多 240 字。');
    const privateRef=doc(colRef(gid,'tournaments'));
    const publicRef=doc(collection(db,'publicTournaments'));
    const t={title:name,description:desc,hostName:hostName.trim().slice(0,24),status:'registration',createdBy:uid,
      publicId:publicRef.id,participants:[],rounds:[],champion:'',createdAt:serverTimestamp(),updatedAt:serverTimestamp()};
    const batch=writeBatch(db);
    batch.set(privateRef,t);
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
      else if(action==='result')next=recordTournamentWinner(current,playerOrResult.round,playerOrResult.match,playerOrResult.winner);
      else if(action==='cancel'){
        if(current.status!=='registration')throw new Error('進行中的錦標賽不能取消。');
        next={...current,status:'cancelled'};
      }else throw new Error('不支援的錦標賽操作。');
      tx.update(ref,{participants:next.participants,rounds:next.rounds,status:next.status,champion:next.champion,updatedAt:serverTimestamp()});
      tx.update(publicTournamentRef(current.publicId),{...publicTournamentSnapshot(next),updatedAt:serverTimestamp()});
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
