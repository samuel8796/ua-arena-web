import assert from 'node:assert/strict';
import { COLORS, colorOf, safeText, assertMatch, computeStats, RULE_SYSTEM_PROMPT } from './core.mjs';
const people=[{id:'a',nickname:'Amy'},{id:'b',nickname:'Ben'},{id:'c',nickname:'Chris'}];
const decks=[{id:'d1',ownerUid:'a',name:'紫牌',color:'PURPLE'},{id:'d2',ownerUid:'b',name:'紅牌',color:'RED'},{id:'d3',ownerUid:'c',name:'藍牌',color:'BLUE'}];
const matches=[
  {id:'m1',status:'active',playerA:'a',playerB:'b',deckA:'d1',deckB:'d2',winner:'a',recordedBy:'c'},
  {id:'m2',status:'active',playerA:'b',playerB:'c',deckA:'d2',deckB:'d3',winner:'b',recordedBy:'a'},
  {id:'m3',status:'active',playerA:'a',playerB:'b',deckA:'d1',deckB:'d2',winner:'b',recordedBy:'c'},
  {id:'m4',status:'void',playerA:'a',playerB:'c',deckA:'d1',deckB:'d3',winner:'a',recordedBy:'c'}
];
let pass=0;const test=(name,fn)=>{fn();console.log(`✓ ${name}`);pass++};
test('七色牌組含混色',()=>assert.equal(COLORS.length,7));
test('未知顏色回退',()=>assert.equal(colorOf('BAD').name,'其他'));
test('XSS 字串被逸出',()=>assert.equal(safeText('<img src=x onerror="a">'),'&lt;img src=x onerror=&quot;a&quot;&gt;'));
test('可由第三人代填其他兩人對戰',()=>assert.equal(assertMatch({playerA:'a',playerB:'b',deckA:'d1',deckB:'d2',winner:'a'},people,decks),true));
test('拒絕同一玩家雙方參賽',()=>assert.throws(()=>assertMatch({playerA:'a',playerB:'a',deckA:'d1',deckB:'d1',winner:'a'},people,decks)));
test('拒絕交叉錯誤牌組',()=>assert.throws(()=>assertMatch({playerA:'a',playerB:'b',deckA:'d2',deckB:'d1',winner:'a'},people,decks)));
test('拒絕不存在勝者',()=>assert.throws(()=>assertMatch({playerA:'a',playerB:'b',deckA:'d1',deckB:'d2',winner:'c'},people,decks)));
test('撤銷對戰不計入戰績',()=>assert.equal(computeStats(people,decks,matches).totalMatches,3));
test('各玩家只計算自己的勝負',()=>{
  const r=computeStats(people,decks,matches);const a=r.players.find(p=>p.id==='a');const b=r.players.find(p=>p.id==='b');
  assert.equal(a.games,2);assert.equal(a.wins,1);assert.equal(b.games,3);assert.equal(b.wins,2);
});
test('勝率百分比正確四捨五入',()=>assert.equal(computeStats(people,decks,matches).players.find(p=>p.id==='b').rate,67));
test('最常用牌組與勝場統計正確',()=>{
  const s=computeStats(people,decks,matches).players.find(p=>p.id==='a');assert.equal(s.favorite.name,'紫牌');assert.equal(s.mostWins.wins,1);
});
test('AI Prompt 限定 UA 避免混用其他 TCG',()=>assert.ok(RULE_SYSTEM_PROMPT.includes('UNION ARENA')&&RULE_SYSTEM_PROMPT.includes('不得混用')));
console.log(`\n${pass} tests passed.`);
import { QUICK_MATCH_LIMIT_MS, createQuickMatch, changeQuickMatch, quickClock, quickMatchResult, mmss } from './quick-core.mjs';
const origin = 1_750_000_000_000;
const makeQuick=()=>createQuickMatch({playerA:'a',playerB:'b',deckA:'d1',deckB:'d2'},'c',origin);
test('Quick Match 起始固定 30 分鐘',()=>{
  const q=makeQuick();assert.equal(q.status,'ready');assert.equal(quickClock(q,origin).remainingMs,QUICK_MATCH_LIMIT_MS);
});
test('同一時間只能一人回合進行中',()=>{
  const q=changeQuickMatch(makeQuick(),'start',{playerId:'a',uid:'c',now:origin+1000});
  assert.throws(()=>changeQuickMatch(q,'start',{playerId:'b',uid:'c',now:origin+2000}));
});
test('記錄兩人各自回合用時',()=>{
  let q=changeQuickMatch(makeQuick(),'start',{playerId:'a',uid:'c',now:origin+1000});
  q=changeQuickMatch(q,'end',{uid:'c',now:origin+81000});
  q=changeQuickMatch(q,'start',{playerId:'b',uid:'c',now:origin+91000});
  q=changeQuickMatch(q,'end',{uid:'c',now:origin+151000});
  const c=quickClock(q,origin+151000);
  assert.equal(c.playerAMs,80000);assert.equal(c.playerBMs,60000);assert.equal(c.unattributedMs,10000);assert.equal(q.turns.length,2);
});
test('關閉頁面後以時間戳回復倒數',()=>{
  const q=changeQuickMatch(makeQuick(),'start',{playerId:'a',uid:'c',now:origin+1000});
  const revived=JSON.parse(JSON.stringify(q));
  assert.equal(quickClock(revived,origin+301000).remainingMs,1500000);
});
test('總時限到達但不自動判勝負',()=>{
  const q=changeQuickMatch(makeQuick(),'start',{playerId:'a',uid:'c',now:origin+1000});
  const c=quickClock(q,origin+QUICK_MATCH_LIMIT_MS+1000);
  assert.equal(c.remainingMs,0);assert.equal(c.expired,true);
  assert.throws(()=>changeQuickMatch({...q,activePlayer:'',activeSinceMs:0},'start',{playerId:'b',uid:'c',now:origin+QUICK_MATCH_LIMIT_MS+2000}));
});
test('結束比賽時自動結算正在進行的回合',()=>{
  const q=changeQuickMatch(makeQuick(),'start',{playerId:'a',uid:'c',now:origin+1000});
  const finished=changeQuickMatch(q,'finish',{uid:'c',matchId:'match-1',now:origin+121000});
  assert.equal(finished.status,'finished');assert.equal(finished.turns[0].durationMs,120000);
  assert.equal(quickMatchResult(finished).playerAMs,120000);
  assert.equal(mmss(quickClock(finished).remainingMs),'28:00');
});
test('不可在已完成的對戰繼續開始回合',()=>{
  const q=changeQuickMatch(makeQuick(),'finish',{uid:'c',matchId:'done',now:origin+1000});
  assert.throws(()=>changeQuickMatch(q,'start',{uid:'c',playerId:'a',now:origin+2000}));
});

import { TOURNAMENT_MAX_PLAYERS,createBracket,startTournament,recordTournamentWinner,addTournamentEntrant,removeTournamentEntrant,publicTournamentSnapshot } from './tournament-core.mjs';
const entrants=[{uid:'a',nickname:'Amy'},{uid:'b',nickname:'Ben'},{uid:'c',nickname:'Chris'},{uid:'d',nickname:'Dana'}];
const tourney=(people=entrants)=>({title:'週末盃',description:'友誼賽',hostName:'Amy',createdBy:'a',publicId:'public1234567890',status:'registration',participants:people,rounds:[],champion:''});
test('賽事容許 2 至 32 人單敗淘汰',()=>{
  assert.equal(TOURNAMENT_MAX_PLAYERS,32);
  assert.equal(createBracket(entrants,()=>.999).length,2);
  assert.throws(()=>createBracket(entrants.slice(0,1)));
  assert.throws(()=>createBracket(Array.from({length:33},(_,i)=>({uid:String(i),nickname:'P'+i}))));
});
test('房主能建立賽程並自動晉級',()=>{
  let t=startTournament(tourney(),()=>.999);
  assert.equal(t.status,'running');
  t=recordTournamentWinner(t,0,0,t.rounds[0][0].a);
  t=recordTournamentWinner(t,0,1,t.rounds[0][1].a);
  assert.ok(t.rounds[1][0].a && t.rounds[1][0].b);
  const winner=t.rounds[1][0].a;
  t=recordTournamentWinner(t,1,0,winner);
  assert.equal(t.status,'completed');assert.equal(t.champion,winner);
});
test('3 人賽事的輪空不會提前產生冠軍',()=>{
  let t=startTournament(tourney(entrants.slice(0,3)),()=>.999);
  assert.equal(t.status,'running');assert.equal(t.champion,'');
  const playable=t.rounds[0].findIndex(m=>m.a&&m.b);
  t=recordTournamentWinner(t,0,playable,t.rounds[0][playable].a);
  assert.ok(t.rounds[1][0].a && t.rounds[1][0].b);
});
test('5 人賽程會安排 3 個輪空',()=>{
  const arr=[...entrants,{uid:'e',nickname:'Eve'}];
  const t=startTournament(tourney(arr),()=>.999);
  assert.equal(t.rounds[0].filter(m=>m.bye).length,3);
  assert.equal(t.status,'running');
});
test('不能重複登錄勝者或讓非參賽者勝出',()=>{
  let t=startTournament(tourney(),()=>.999);
  assert.throws(()=>recordTournamentWinner(t,0,0,'outsider'));
  t=recordTournamentWinner(t,0,0,t.rounds[0][0].a);
  assert.throws(()=>recordTournamentWinner(t,0,0,t.rounds[0][0].a));
});
test('截止報名後不能任意加入參賽者',()=>{
  const t=addTournamentEntrant(tourney(entrants.slice(0,2)),entrants[2]);
  assert.equal(t.participants.length,3);
  assert.throws(()=>addTournamentEntrant(t,entrants[2]));
  const removed=removeTournamentEntrant(t,entrants[2].uid);
  assert.equal(removed.participants.length,2);
  assert.throws(()=>addTournamentEntrant(startTournament(tourney()),{uid:'z',nickname:'Z'}));
});
test('公開觀賽資料不暴露 UID、群組 ID 或私人牌組',()=>{
  let t=startTournament(tourney(),()=>.999);
  const projected=publicTournamentSnapshot({...t,groupId:'SECRET-GROUP',privateEmail:'a@example.com',deckA:'private-deck'});
  const serialized=JSON.stringify(projected);
  assert.ok(serialized.includes('Amy'));
  for(const confidential of ['SECRET-GROUP','a@example.com','private-deck','"uid"','groupId','"createdBy"'])assert.ok(!serialized.includes(confidential));
});
test('同名參賽者不會繞過 UID 去重驗證',()=>{
  const same=[{uid:'a',nickname:'Sam'},{uid:'a',nickname:'Sam'}];
  assert.throws(()=>createBracket(same));
});
console.log('Tournament tests completed.');

import { GUEST_PLAYER_ID, GUEST_DECK_ID, personalGroupId, personalGroupName, guestPlayer, guestDeckLabel, isGuestMatch } from './core.mjs';
const guestPeople=[people[0],guestPlayer()];
const guestPayload={playerA:'a',playerB:GUEST_PLAYER_ID,deckA:'d1',deckB:GUEST_DECK_ID,winner:'a',guestDeck:{name:'紅色野場牌',color:'RED'}};
test('每個帳號的個人戰團 ID 固定且名稱來自暱稱',()=>{
  assert.equal(personalGroupId('abc'),'personal_abc');
  assert.equal(personalGroupName('小明'),'小明的戰團');
});
test('訪客玩家僅為虛擬角色，不需要真正的團員文件',()=>{
  assert.equal(guestPlayer().virtual,true);assert.equal(isGuestMatch(guestPayload),true);
});
test('個人戰團可以紀錄自己對訪客的勝負',()=>assert.equal(assertMatch(guestPayload,guestPeople,decks,{allowGuest:true}),true));
test('訪客不可以在一般對戰團使用',()=>assert.throws(()=>assertMatch(guestPayload,guestPeople,decks)));
test('訪客必須填牌組名稱和有效顏色',()=>{
  assert.throws(()=>assertMatch({...guestPayload,guestDeck:{name:'',color:'RED'}},guestPeople,decks,{allowGuest:true}));
  assert.throws(()=>assertMatch({...guestPayload,guestDeck:{name:'牌組',color:'INVALID'}},guestPeople,decks,{allowGuest:true}));
  assert.throws(()=>assertMatch({...guestPayload,deckB:'d2'},guestPeople,decks,{allowGuest:true}));
});
test('不允許把訪客牌組寫成一般玩家的正式牌組',()=>{
  assert.throws(()=>assertMatch({...guestPayload,playerB:'b'},people,decks,{allowGuest:true}));
});
test('訪客戰績計入本人勝率，不建立持久化的牌組物件',()=>{
  const r=computeStats(guestPeople,decks,[{...guestPayload,status:'active'},
    {...guestPayload,winner:GUEST_PLAYER_ID,guestDeck:{name:'藍色野場牌',color:'BLUE'},status:'active'}]);
  const owner=r.players.find(p=>p.id==='a'),visitor=r.players.find(p=>p.id===GUEST_PLAYER_ID);
  assert.equal(owner.games,2);assert.equal(owner.wins,1);assert.equal(visitor.wins,1);
  assert.equal(visitor.deckStats.length,2);assert.equal(decks.some(d=>d.ownerUid===GUEST_PLAYER_ID),false);
});
test('訪客的當場牌組名稱與顏色可留在歷史紀錄',()=>{
  assert.match(guestDeckLabel(guestPayload,'B'),/紅色野場牌.*紅色/);
});
test('Quick Match 30 分鐘計時完整保存訪客當場使用的牌組',()=>{
  let q=createQuickMatch(guestPayload,'a',origin);
  assert.deepEqual(q.guestDeck,guestPayload.guestDeck);
  q=changeQuickMatch(q,'start',{playerId:GUEST_PLAYER_ID,uid:'a',now:origin+1000});
  q=changeQuickMatch(q,'end',{uid:'a',now:origin+21000});
  assert.equal(quickClock(q,origin+21000).playerBMs,20000);
  assert.equal(q.guestDeck.name,'紅色野場牌');
});
console.log('Guest-player tests completed.');

// v1.3.1 regression contracts; the Firestore emulator remains the authority
// for fully evaluating these rules with real authenticated requests.
import { readFileSync } from 'node:fs';
const securityRules=readFileSync(new URL('./firestore.rules',import.meta.url),'utf8');
const authAdapterCode=readFileSync(new URL('./firebase-adapter.js',import.meta.url),'utf8');
test('個人戰團不存在時可依登入 UID 安全讀取',()=>{
  assert.ok(securityRules.includes("allow get: if signedIn() && (!gid.matches('^personal_.*') || personalGroup(gid));"));
  assert.ok(!securityRules.includes("(!gid.matches('^personal_.*') || resource.data.createdBy"));
});
test('防止註冊和登入 callback 重複建立同一個人戰團',()=>{
  assert.ok(authAdapterCode.includes("const personalGroupTasks = new Map();"));
  assert.ok(authAdapterCode.includes("if(pending)return pending;"));
});

import { aggregatePersonalStats } from './core.mjs';
test('個人總戰績跨團累計、同名文件在不同團仍各算一場',()=>{
  const r=aggregatePersonalStats('a',{
    alpha:[{id:'same',playerA:'a',playerB:'b',winner:'a',status:'active'},{id:'bad',playerA:'a',playerB:'b',winner:'a',status:'void'}],
    beta:[{id:'same',playerA:'a',playerB:'c',winner:'c',status:'active'},{id:'irrelevant',playerA:'b',playerB:'c',winner:'b',status:'active'}],
    gamma:[{id:'wild',playerA:'a',playerB:'__ua_guest__',winner:'a',status:'active'}]
  });
  assert.equal(r.games,3);assert.equal(r.wins,2);assert.equal(r.losses,1);assert.equal(r.rate,67);
  assert.equal(r.byGroup.find(x=>x.groupId==='alpha').games,1);
  assert.equal(r.byGroup.find(x=>x.groupId==='beta').losses,1);
  assert.equal(r.byGroup.find(x=>x.groupId==='gamma').wins,1);
});
test('帳號牌組僅允許持有者寫入、舊戰團牌組變成唯讀',()=>{
  assert.ok(currentRules.includes('match /users/{uid}/decks/{deckId}'));
  assert.ok(currentRules.includes('request.resource.data.ownerUid == uid'));
  assert.ok(currentRules.includes('allow create, update, delete: if false;'));
  assert.ok(firebaseAdapterSource.includes('async function migrateMyLegacyDecks'));
  assert.ok(firebaseAdapterSource.includes('personalDeckRef(uid,legacy.id)'));
  assert.ok(firebaseAdapterSource.includes('if(old.ownerUid!==uid||old.active===false)continue;'));
});
test('個人名片獨立於私人使用者資料，僅本人可編輯',()=>{
  assert.ok(currentRules.includes('match /playerCards/{uid}'));
  assert.ok(currentRules.includes('uid == request.auth.uid'));
  assert.ok(currentRules.includes("'showGroupStats','showOverallStats'"));
  assert.ok(firebaseAdapterSource.includes('async savePlayerCard(uid,card)'));
  assert.ok(firebaseAdapterSource.includes('showBio:!!card.showBio'));
});
