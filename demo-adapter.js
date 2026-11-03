import { createQuickMatch, changeQuickMatch, quickMatchResult } from './quick-core.mjs';
const K='ua-arena-demo-v1-1';
const SAMPLE_IMAGE='';
function seed(){
  return {quickMatches:[],groups:{demo:{id:'demo',name:'UA 週末對戰團',createdBy:'demo-user',createdAt:Date.now()}},members:[
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
function save(){try{localStorage.setItem(K,JSON.stringify(data))}catch{}listeners.forEach(cb=>cb({members:data.members,decks:data.decks,matches:data.matches,quickMatches:data.quickMatches||[]}));}
const listeners=new Set();
read();
const demoUser={uid:'demo-user',displayName:'Samuel',email:'demo@ua-arena.local'};
export const demoAdapter={
  mode:'demo',aiEnabled:false,
  onAuth(cb){queueMicrotask(()=>cb(demoUser));return ()=>{};},
  async signIn(){return demoUser},async signUp(){return demoUser},async signInGoogle(){return demoUser},async signOut(){},
  async getMyGroups(){return Object.keys(data.groups)},
  async getGroup(gid){return data.groups[gid]||data.groups.demo},
  async createGroup(uid,nickname,title){const id=`demo-${Date.now().toString(36)}`;data.groups[id]={id,name:title,createdBy:uid};data.members.push({id:uid,uid,nickname,role:'owner'});save();return id;},
  async joinGroup(uid,nickname,gid){if(!data.groups[gid])throw new Error('沒有這個示範群組');save();return gid;},
  subscribe(gid,cb){listeners.add(cb);queueMicrotask(()=>cb({members:data.members,decks:data.decks,matches:data.matches,quickMatches:data.quickMatches||[]}));return ()=>listeners.delete(cb);},
  async addDeck(gid,uid,d){data.decks.push({...d,id:`d-${Date.now().toString(36)}`,createdBy:uid,active:true,createdAt:Date.now()});save();},
  async updateDeck(gid,id,d){Object.assign(data.decks.find(x=>x.id===id),d);save();},
  async archiveDeck(gid,id){data.decks.find(x=>x.id===id).active=false;save();},
  async addMatch(gid,uid,m){data.matches.unshift({...m,id:`m-${Date.now().toString(36)}`,recordedBy:uid,status:'active',createdAt:Date.now()});save();},
  async voidMatch(gid,id){data.matches.find(x=>x.id===id).status='void';save();},
  async createQuickMatch(gid,uid,payload){const id=`q-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,7)}`;
    data.quickMatches.unshift({...createQuickMatch(payload,uid,Date.now()),id});save();return id;},
  async changeQuickMatch(gid,id,uid,action,playerId=''){
    const idx=data.quickMatches.findIndex(x=>x.id===id);if(idx<0)throw new Error('找不到對戰。');
    data.quickMatches[idx]=changeQuickMatch(data.quickMatches[idx],action,{uid,playerId,now:Date.now()});save();},
  async finishQuickMatch(gid,id,uid,winner,note=''){
    const idx=data.quickMatches.findIndex(x=>x.id===id);if(idx<0)throw new Error('找不到對戰。');
    const before=data.quickMatches[idx];if(![before.playerA,before.playerB].includes(winner))throw new Error('無效的勝者。');
    const matchId=`m-q-${Date.now().toString(36)}`;
    const next=changeQuickMatch(before,'finish',{uid,matchId,now:Date.now()});
    data.quickMatches[idx]={...next,id};
    data.matches.unshift({id:matchId,playerA:before.playerA,playerB:before.playerB,deckA:before.deckA,deckB:before.deckB,
      winner,note,recordedBy:uid,status:'active',createdAt:Date.now(),quickMatchId:id,timing:quickMatchResult(next,next.finishedAtMs)});
    save();},

  async askRule(){throw new Error('展示模式尚未連接 Gemini。');}
};
