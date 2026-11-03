import { createQuickMatch, changeQuickMatch, quickMatchResult } from './quick-core.mjs';
import { personalGroupId, personalGroupName } from './core.mjs';
import { addTournamentEntrant, removeTournamentEntrant, startTournament, recordTournamentWinner, publicTournamentSnapshot } from './tournament-core.mjs';
const K='ua-arena-demo-v1-1';
const SAMPLE_IMAGE='';
function seed(){
  return {quickMatches:[],tournaments:[],tournamentRequests:[],profile:{nickname:'Samuel',bio:''},groups:{demo:{id:'demo',name:'UA 週末對戰團',createdBy:'demo-user',createdAt:Date.now()}},members:[
    {id:'demo-user',uid:'demo-user',nickname:'Samuel',role:'owner'},
    {id:'friend-1',uid:'friend-1',nickname:'Alex',role:'member'},
    {id:'friend-2',uid:'friend-2',nickname:'Kevin',role:'member'},
    {id:'friend-3',uid:'friend-3',nickname:'Yuki',role:'member'}],
  decks:[
    {id:'d1',ownerUid:'demo-user',createdBy:'demo-user',name:'紫色魯夫',color:'PURPLE',imageData:SAMPLE_IMAGE,active:true},
    {id:'d2',ownerUid:'friend-1',createdBy:'demo-user',name:'綠色魯路修',color:'GREEN',imageData:SAMPLE_IMAGE,active:true},
    {id:'d3',ownerUid:'friend-2',createdBy:'demo-user',name:'紅色炭治郎',color:'RED',imageData:SAMPLE_IMAGE,active:true},
    {id:'d4',ownerUid:'friend-3',createdBy:'demo-user',name:'藍色咒術迴戰',color:'BLUE',imageData:SAMPLE_IMAGE,active:true}],
  matches:[
    {id:'m1',playerA:'demo-user',playerB:'friend-1',deckA:'d1',deckB:'d2',winner:'demo-user',recordedBy:'demo-user',status:'active',createdAt:Date.now()-3600000},
    {id:'m2',playerA:'friend-2',playerB:'demo-user',deckA:'d3',deckB:'d1',winner:'friend-2',recordedBy:'demo-user',status:'active',createdAt:Date.now()-86400000},
    {id:'m3',playerA:'friend-1',playerB:'friend-3',deckA:'d2',deckB:'d4',winner:'friend-1',recordedBy:'demo-user',status:'active',createdAt:Date.now()-172800000},
    {id:'m4',playerA:'demo-user',playerB:'friend-3',deckA:'d1',deckB:'d4',winner:'demo-user',recordedBy:'demo-user',status:'active',createdAt:Date.now()-259200000},
    {id:'m5',playerA:'friend-2',playerB:'friend-1',deckA:'d3',deckB:'d2',winner:'friend-2',recordedBy:'demo-user',status:'active',createdAt:Date.now()-345600000}]
  };
}
let data;
function read(){try{data=JSON.parse(localStorage.getItem(K))||seed();}catch{data=seed()}return data;}
function save(){try{localStorage.setItem(K,JSON.stringify(data))}catch{}listeners.forEach(cb=>cb({members:data.members,decks:data.decks,matches:data.matches,quickMatches:data.quickMatches||[],tournaments:data.tournaments||[]}));}
const listeners=new Set();
read();
const demoUser={uid:'demo-user',displayName:'Samuel',email:'demo@ua-arena.local'};
export const demoAdapter={
  mode:'demo',aiEnabled:false,
  onAuth(cb){queueMicrotask(()=>cb(demoUser));return ()=>{};},
  async signIn(){return demoUser},async signUp(){return demoUser},async signInGoogle(){return demoUser},async signOut(){},
  async getMyGroups(){
    const gid=personalGroupId(demoUser.uid);
    if(!data.groups[gid])data.groups[gid]={id:gid,name:personalGroupName(demoUser.displayName),createdBy:demoUser.uid};
    if(!data.members.some(m=>m.uid===demoUser.uid&&m.groupId===gid)){
      // Demo's original seed has a flat member list. The personal group always projects only the owner.
      save();
    }
    return Object.keys(data.groups);
  },
  async getProfile(){return data.profile||{};},
  async saveProfile(uid,nickname,bio){data.profile={nickname,bio};demoUser.displayName=nickname;data.members.filter(m=>m.uid===uid).forEach(m=>m.nickname=nickname);save();return {failures:[]};},
  subscribePublicTournament(id,cb){const publish=()=>cb(data.tournaments.find(t=>t.publicId===id)?{...publicTournamentSnapshot(data.tournaments.find(t=>t.publicId===id)),id}:null);publish();const fn=()=>publish();listeners.add(fn);return ()=>listeners.delete(fn);},
  async getGroup(gid){return data.groups[gid]||data.groups.demo},
  async createGroup(uid,nickname,title){const id=`demo-${Date.now().toString(36)}`;data.groups[id]={id,name:title,createdBy:uid};data.members.push({id:uid,uid,nickname,role:'owner'});save();return id;},
  async joinGroup(uid,nickname,gid){if(!data.groups[gid])throw new Error('沒有這個示範群組');save();return gid;},
  subscribe(gid,cb){
    const send=()=>cb({members:gid===personalGroupId(demoUser.uid)?data.members.filter(m=>m.id===demoUser.uid):data.members,
      decks:gid===personalGroupId(demoUser.uid)?data.decks.filter(d=>d.ownerUid===demoUser.uid):data.decks,
      matches:(data.matches||[]).filter(m=>gid===personalGroupId(demoUser.uid)?m.groupId===gid:!m.groupId || m.groupId===gid),
      quickMatches:(data.quickMatches||[]).filter(q=>gid===personalGroupId(demoUser.uid)?q.groupId===gid:!q.groupId||q.groupId===gid),
      tournaments:gid===personalGroupId(demoUser.uid)?[]:(data.tournaments||[])});
    send();listeners.add(send);return ()=>listeners.delete(send);
  },
  async addDeck(gid,uid,d){data.decks.push({...d,id:`d-${Date.now().toString(36)}`,createdBy:uid,active:true,createdAt:Date.now()});save();},
  async updateDeck(gid,id,d){Object.assign(data.decks.find(x=>x.id===id),d);save();},
  async archiveDeck(gid,id){data.decks.find(x=>x.id===id).active=false;save();},
  async addMatch(gid,uid,m){data.matches.unshift({...m,groupId:gid,id:`m-${Date.now().toString(36)}`,recordedBy:uid,status:'active',createdAt:Date.now()});save();},
  async voidMatch(gid,id){data.matches.find(x=>x.id===id).status='void';save();},
  async createQuickMatch(gid,uid,payload){const id=`q-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,7)}`;
    data.quickMatches.unshift({...createQuickMatch(payload,uid,Date.now()),id,groupId:gid});save();return id;},
  async changeQuickMatch(gid,id,uid,action,playerId=''){
    const idx=data.quickMatches.findIndex(x=>x.id===id);if(idx<0)throw new Error('找不到對戰。');
    data.quickMatches[idx]=changeQuickMatch(data.quickMatches[idx],action,{uid,playerId,now:Date.now()});save();},
  async finishQuickMatch(gid,id,uid,winner,note=''){
    const idx=data.quickMatches.findIndex(x=>x.id===id);if(idx<0)throw new Error('找不到對戰。');
    const before=data.quickMatches[idx];if(![before.playerA,before.playerB].includes(winner))throw new Error('無效的勝者。');
    const matchId=`m-q-${Date.now().toString(36)}`;
    const next=changeQuickMatch(before,'finish',{uid,matchId,now:Date.now()});
    data.quickMatches[idx]={...next,id};
    data.matches.unshift({id:matchId,groupId:gid,playerA:before.playerA,playerB:before.playerB,deckA:before.deckA,deckB:before.deckB,
      ...(before.guestDeck?{guestDeck:before.guestDeck}:{}),
      winner,note,recordedBy:uid,status:'active',createdAt:Date.now(),quickMatchId:id,timing:quickMatchResult(next,next.finishedAtMs)});
    save();},

  subscribeTournamentRequests(gid,id,cb){const fn=()=>cb((data.tournamentRequests||[]).filter(r=>r.tournamentId===id));fn();listeners.add(fn);return ()=>listeners.delete(fn);},
  async hasTournamentRequest(gid,id,uid){return (data.tournamentRequests||[]).some(r=>r.tournamentId===id&&r.uid===uid);},
  async requestTournamentJoin(gid,id,uid,nickname){data.tournamentRequests||=[];data.tournamentRequests.push({tournamentId:id,uid,nickname,status:'pending'});save();},
  async approveTournamentRequest(gid,id,uid,hostUid){await this.changeTournament(gid,id,hostUid,'add',uid);data.tournamentRequests=data.tournamentRequests.filter(r=>!(r.tournamentId===id&&r.uid===uid));save();},
  async createTournament(gid,uid,title,description,hostName){
    const id=`t-${Date.now().toString(36)}`,publicId=`p-${id}`;
    data.tournaments ||= [];data.tournaments.push({id,publicId,title,description,hostName,status:'registration',createdBy:uid,participants:[],rounds:[],champion:'',createdAt:Date.now()});save();return id;
  },
  async changeTournament(gid,id,uid,action,arg){
    const idx=data.tournaments.findIndex(t=>t.id===id);if(idx<0)throw new Error('賽事不存在。');
    const cur=data.tournaments[idx];if(cur.createdBy!==uid)throw new Error('只有房主可操作。');let next;
    if(action==='add')next=addTournamentEntrant(cur,data.members.find(p=>p.uid===arg)||{uid:arg,nickname:'參賽者'});
    else if(action==='remove')next=removeTournamentEntrant(cur,arg);
    else if(action==='start')next=startTournament(cur);
    else if(action==='result')next=recordTournamentWinner(cur,arg.round,arg.match,arg.winner);
    else if(action==='cancel'&&cur.status==='registration')next={...cur,status:'cancelled'};
    else throw new Error('操作不允許。');
    data.tournaments[idx]={...next,id,publicId:cur.publicId};save();
  },

  async askRule(){throw new Error('展示模式尚未連接 Gemini。');}
};
