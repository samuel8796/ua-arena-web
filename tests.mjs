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
const makeQuick=()=>({...createQuickMatch({playerA:'a',playerB:'b',deckA:'d1',deckB:'d2'},'c',origin),
  duelRolled:true,decider:'a',firstPlayer:'a'});
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
  assert.equal(q.activePlayer,'b');
  q=changeQuickMatch(q,'end',{uid:'c',now:origin+151000});
  const c=quickClock(q,origin+151000);
  assert.equal(c.playerAMs,80000);assert.equal(c.playerBMs,70000);assert.equal(c.unattributedMs,0);assert.equal(q.turns.length,2);
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
  const running=changeQuickMatch(makeQuick(),'start',{playerId:'a',uid:'c',now:origin+500});
  const q=changeQuickMatch(running,'finish',{uid:'c',matchId:'done',now:origin+1000});
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
  q=changeQuickMatch(q,'draw',{playerId:GUEST_PLAYER_ID,uid:'a',now:origin+300});
  q=changeQuickMatch(q,'choose',{playerId:GUEST_PLAYER_ID,uid:'a',now:origin+500});
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
  assert.ok(securityRules.includes('match /users/{uid}/decks/{deckId}'));
  assert.ok(securityRules.includes('request.resource.data.ownerUid == uid'));
  assert.ok(securityRules.includes('allow create, update, delete: if false;'));
  assert.ok(authAdapterCode.includes('async function migrateMyLegacyDecks'));
  assert.ok(authAdapterCode.includes('personalDeckRef(uid,legacy.id)'));
  assert.ok(authAdapterCode.includes('if(old.ownerUid!==uid||old.active===false)continue;'));
});
test('個人名片獨立於私人使用者資料，僅本人可編輯',()=>{
  assert.ok(securityRules.includes('match /playerCards/{uid}'));
  assert.ok(securityRules.includes('uid == request.auth.uid'));
  assert.ok(securityRules.includes("'showGroupStats','showOverallStats'"));
  assert.ok(authAdapterCode.includes('async savePlayerCard(uid,card)'));
  assert.ok(authAdapterCode.includes('showBio:!!card.showBio'));
});

import { resolvePlayerDeckSelection } from './core.mjs';
test('Quick Match: 牌組資料晚於團員載入時可補齊預設牌組',()=>{
  assert.equal(resolvePlayerDeckSelection('b','',[]),'');
  assert.equal(resolvePlayerDeckSelection('b','',[{id:'b-new',ownerUid:'b',active:true}]),'b-new');
});
test('Quick Match: 同戰團兩名玩家可以使用各自帳號牌組',()=>{
  const personalDecks=[{id:'a-deck',ownerUid:'a',active:true},{id:'b-deck',ownerUid:'b',active:true}];
  const selectedA=resolvePlayerDeckSelection('a','',personalDecks);
  const selectedB=resolvePlayerDeckSelection('b','',personalDecks);
  assert.equal(assertMatch({playerA:'a',playerB:'b',deckA:selectedA,deckB:selectedB,winner:'b'},people,personalDecks),true);
});
test('Quick Match: 選過的有效牌組不會被非同步更新覆蓋',()=>{
  const personalDecks=[{id:'first',ownerUid:'b',active:true},{id:'chosen',ownerUid:'b',active:true}];
  assert.equal(resolvePlayerDeckSelection('b','chosen',personalDecks),'chosen');
  assert.equal(resolvePlayerDeckSelection('b','wrong-owner',[...personalDecks,{id:'wrong-owner',ownerUid:'a'}]),'first');
  assert.equal(resolvePlayerDeckSelection('b','archived',[...personalDecks,{id:'archived',ownerUid:'b',active:false}]),'first');
});
test('Quick Match 提交讀取表單實際選擇的牌組，而非僅依賴草稿 ID',()=>{
  const appCode=readFileSync(new URL('./app.js',import.meta.url),'utf8');
  assert.ok(appCode.includes('fields.deckA||pickDeck(d.playerA,d.deckA)'));
  assert.ok(appCode.includes('fields.deckB||pickDeck(d.playerB,d.deckB)'));
  assert.ok(appCode.includes('d.deckA=d.playerA===GUEST_PLAYER_ID?GUEST_DECK_ID:pickDeck(d.playerA,d.deckA)'));
});


// v1.5 regressions: actual play date, user-level deck rates, and two-party access.
import { aggregateDeckWinRates, filterMatches, filteredMatchStats, parsePlayedAt, matchTimeMs } from './core.mjs';
test('v1.5 牌組勝率按照玩家實際使用跨戰團計算，代填不算本人',()=>{
 const joined={g1:[
  {playerA:'a',deckA:'d1',playerB:'b',winner:'a',recordedBy:'c',status:'active'},
  {playerA:'b',deckA:'d2',playerB:'c',winner:'c',recordedBy:'a',status:'active'}],
  g2:[{playerA:'c',playerB:'a',deckB:'d1',winner:'c',status:'active'},
      {playerA:'a',deckA:'d1',winner:'a',status:'void'}]};
 const x=aggregateDeckWinRates('a',joined,decks);
 assert.equal(x.length,1);assert.equal(x[0].games,2);assert.equal(x[0].wins,1);
 assert.equal(x[0].losses,1);assert.equal(x[0].rate,50);
});
test('v1.5 團內每個牌組顯示正確勝率',()=>{
 const p=computeStats(people,decks,matches).players.find(p=>p.id==='a');
 assert.equal(p.deckStats.find(d=>d.id==='d1').rate,50);
});
test('v1.5 可以補登過去時間但禁止無效日期和未來日期',()=>{
 const now=new Date('2026-11-05T21:00:00').getTime();
 assert.equal(parsePlayedAt('2025-08-14T20:30',now).getFullYear(),2025);
 assert.throws(()=>parsePlayedAt('2025-02-30T15:00',now));
 assert.throws(()=>parsePlayedAt('2025-13-01T15:00',now));
 assert.throws(()=>parsePlayedAt('2026-12-01T10:00',now));
});
test('v1.5 依實際對戰日和玩家過濾，新舊紀錄都能查',()=>{
 const x=[
  {playerA:'a',playerB:'b',status:'active',winner:'a',playedAt:'2025-03-11T13:30:00',createdAt:'2026-11-05T13:30:00'},
  {playerA:'b',playerB:'a',status:'active',winner:'b',createdAt:'2025-03-15T13:30:00'},
  {playerA:'a',playerB:'c',status:'void',winner:'a',playedAt:'2025-03-18T13:30:00'},
  {playerA:'b',playerB:'c',status:'active',winner:'b',playedAt:'2025-03-18T13:30:00'}];
 const selected=filterMatches(x,{playerId:'a',from:'2025-03-01',to:'2025-03-31'});
 const summary=filteredMatchStats(selected,'a');
 assert.equal(selected.length,3);assert.equal(summary.games,2);assert.equal(summary.wins,1);
 assert.equal(summary.losses,1);assert.equal(summary.rate,50);
 assert.ok(matchTimeMs(x[0]) < matchTimeMs({createdAt:x[0].createdAt}));
});
test('v1.5 公開名片、回填日期和雙方取消的 Rules 有限制',()=>{
 const rules=readFileSync(new URL('./firestore.rules',import.meta.url),'utf8');
 const adapter=readFileSync(new URL('./firebase-adapter.js',import.meta.url),'utf8');
 const ui=readFileSync(new URL('./app.js',import.meta.url),'utf8');
 assert.ok(rules.includes("'favoriteDeckStats'"));
 assert.ok(rules.includes("request.resource.data.playedAt is timestamp"));
 assert.ok(rules.includes("request.resource.data.hiddenAt == request.time"));
 assert.ok(rules.includes("resource.data.playerB == request.auth.uid"));
 assert.ok(adapter.includes('async hideQuickMatch(gid,id,uid)'));
 assert.ok(ui.includes("case 'match-detail'"));
 assert.ok(ui.includes('match-from'));
 assert.ok(ui.includes("case 'quick-remove'"));
 assert.ok(ui.includes("const checked=key=>c[key]!==false?'checked':'';"));
});


// v1.6: shared artwork and exactly five highest-win-rate decks per card.
import { topDecksByWinRate } from './core.mjs';

test('v1.6 名片勝率前五名排序，排除未出賽且不得超過五副',()=>{
  const rows=[
    {id:'a',name:'A',games:10,wins:5,rate:50},
    {id:'b',name:'B',games:3,wins:3,rate:100},
    {id:'c',name:'C',games:8,wins:4,rate:50},
    {id:'d',name:'D',games:6,wins:5,rate:83},
    {id:'e',name:'E',games:1,wins:1,rate:100},
    {id:'f',name:'F',games:12,wins:5,rate:42},
    {id:'g',name:'G',games:0,wins:0,rate:0}
  ];
  assert.deepEqual(topDecksByWinRate(rows).map(x=>x.id),['b','e','d','a','c']);
  assert.equal(topDecksByWinRate(rows).length,5);
  assert.equal(rows[0].id,'a','do not mutate original stats');
});
test('v1.6 相同勝率優先比較場次，勝率比較採實際分數而非四捨五入',()=>{
  const data=[
    {id:'less',name:'less',games:7,wins:5,rate:71},
    {id:'more',name:'more',games:14,wins:10,rate:71},
    {id:'lower',name:'lower',games:1000,wins:714,rate:71}
  ];
  assert.deepEqual(topDecksByWinRate(data).map(x=>x.id),['more','less','lower']);
  assert.deepEqual(topDecksByWinRate(null),[]);
  assert.deepEqual(topDecksByWinRate(data,0),[]);
});
test('v1.6 戰績詳情顯示雙方圖片；玩家名片包含最高五副與最愛牌組圖片',()=>{
  const ui=readFileSync(new URL('./app.js',import.meta.url),'utf8');
  const css=readFileSync(new URL('./styles.css',import.meta.url),'utf8');
  const adapter=readFileSync(new URL('./firebase-adapter.js',import.meta.url),'utf8');
  assert.ok(ui.includes("battleDeckArtwork(m,'A')"));
  assert.ok(ui.includes("battleDeckArtwork(m,'B')"));
  assert.ok(ui.includes("d.id===deckId&&d.ownerUid===ownerUid"));
  assert.ok(ui.includes("topDecksByWinRate(stats.deckStats,5)"));
  assert.ok(ui.includes("groupVisible?topDecksByWinRate"));
  assert.ok(ui.includes("deck-art-top-five"));
  assert.ok(ui.includes("deck-art-favorite"));
  assert.ok(ui.includes("card?.showFavoriteDeck&&card.favoriteDeck?.name&&!topDecks.length"));
  assert.ok(ui.includes("favoriteId===d.id"));
  assert.ok(ui.includes("from './core.mjs?v=2.3'"));
  assert.ok(ui.includes('aria-label="尚未上傳牌組圖片"'));
  assert.ok(css.includes("object-fit:scale-down"));
  assert.ok(css.includes("@media(max-width:380px)"));
  assert.ok(adapter.includes("onSnapshot(personalDeckCol(uid)"));
});

// v1.7 — shared avatars and mobile half-art cards
test('v1.7 全站頭像同步使用僅本人可寫的帳號與團員文件',()=>{
  const rules=readFileSync(new URL('./firestore.rules',import.meta.url),'utf8');
  const adapter=readFileSync(new URL('./firebase-adapter.js',import.meta.url),'utf8');
  const demo=readFileSync(new URL('./demo-adapter.js',import.meta.url),'utf8');
  assert.ok(rules.includes('function validAvatar(data)'));
  assert.ok(rules.includes("'avatarData'"));
  assert.ok(rules.includes("uid == request.auth.uid"));
  assert.ok(rules.includes("hasOnly(['nickname','avatarData'])"));
  assert.ok(rules.includes("data.avatarData.size() <= 40000"));
  assert.ok(adapter.includes('async saveAvatar(uid,avatarData,groupIds,avatarSourceData'));
  assert.ok(adapter.includes("updateDoc(memberRef(gid,uid),{avatarData})"));
  assert.ok(demo.includes('async saveAvatar(uid,avatarData,groupIds'));
  assert.ok(demo.includes('data.profile={...(data.profile||{}),nickname,bio}'));
});
test('v1.7 改換頭像具備裁切壓縮上傳與移除，並能在各玩家頁面顯示',()=>{
  const app=readFileSync(new URL('./app.js',import.meta.url),'utf8');
  assert.ok(app.includes('function playerAvatar(uid,extra='));
  assert.ok(app.includes('chooseAvatarCrop(source)'));
  assert.ok(app.includes('if(!data)return;'));
  assert.ok(!app.includes('imageToAvatarDataUrl(file)'));
  assert.ok(app.includes('case \'remove-avatar\''));
  assert.ok(app.includes("target.name==='avatar'"));
  assert.ok(app.includes("'remove-avatar'"));
  assert.ok(app.includes('playerAvatar(stats.id,'));
  assert.ok(app.includes('playerAvatar(p.id)'));
  assert.ok(app.includes('playerAvatar(state.user?.uid'));
});
test('v1.7 牌組圖片採上半圖下半文字，手機維持兩欄且不溢出',()=>{
  const css=readFileSync(new URL('./styles.css',import.meta.url),'utf8');
  const app=readFileSync(new URL('./app.js',import.meta.url),'utf8');
  assert.ok(css.includes(".detail-participants .detail-side .deck-art-battle"));
  assert.ok(css.includes(".detail-participants .detail-side .deck-art-battle img"));
  assert.ok(css.includes('object-fit:cover'));
  assert.ok(css.includes('.deck-top-five{display:grid;grid-template-columns:repeat(2,minmax(0,1fr))'));
  assert.ok(css.includes('@media(max-width:380px)'));
  assert.ok(app.includes('class="detail-side-info"'));
  assert.ok(app.includes('class="detail-side-user"'));
  assert.ok(app.includes('deck-top-five-info'));
});

// v1.7.1 iPhone Safari photo frames must fill their area rather than render
// wide source images as thin centered strips in auto-sized grid tracks.
test('v1.7.1 手機牌組圖片完整填滿容器、不留上下黑邊',()=>{
 const css=readFileSync(new URL('./styles.css',import.meta.url),'utf8');
 const html=readFileSync(new URL('./index.html',import.meta.url),'utf8');
 assert.ok(css.includes('v1.7.1 iOS Safari fix'));
 assert.ok(css.includes('.detail-participants .detail-side .deck-art-battle > img'));
 assert.ok(css.includes('.deck-top-five-item .deck-art-top-five > img'));
 assert.ok(css.includes('position:absolute;'));
 assert.ok(css.includes('inset:0;'));
 assert.ok(css.includes('min-height:100%;'));
 assert.ok(css.includes('object-fit:cover;'));
 assert.ok(css.includes('height:clamp(132px,38vw,170px);'));
 assert.ok(html.includes('href="./styles.css?v=2.4.1"'));
});

import {avatarCropGeometry,avatarSourceCrop} from './avatar-crop-core.mjs';
test('v1.8 可手動拖移放大圓形頭像，矩形裁切範圍始終在原圖之內',()=>{
  const cases=[[640,480],[480,640],[1400,200],[200,1400],[300,300]];
  for(const [w,h] of cases){
    for(const zoom of [1,1.5,3]){
      for(const [x,y] of [[0,0],[9999,-9999],[-9999,9999]]){
        const g=avatarCropGeometry(w,h,320,zoom,x,y),src=avatarSourceCrop(g);
        assert.ok(g.offsetX<=Math.max(0,(g.width-g.radius*2)/2)+1e-5);
        assert.ok(src.x>=-1e-5&&src.y>=-1e-5);
        assert.ok(src.x+src.size<=w+1e-5);
        assert.ok(src.y+src.size<=h+1e-5);
        assert.ok(src.size>0);
      }
    }
  }
});
test('v1.8 縮放界限及資料正確，重設置中後裁切範圍恢復原位',()=>{
  const base=avatarCropGeometry(1200,800,320,1,0,0);
  const restored=avatarCropGeometry(1200,800,320,1,0,0);
  assert.deepEqual(avatarSourceCrop(base),avatarSourceCrop(restored));
  assert.equal(avatarCropGeometry(1200,800,320,100,0,0).zoom,3);
  assert.equal(avatarCropGeometry(1200,800,320,-5,0,0).zoom,1);
  assert.throws(()=>avatarCropGeometry(0,100,320,1,0,0));
});
test('v1.8 圓形預覽需確認才保存，取消不寫入，支援手機雙指及滑桿',()=>{
  const app=readFileSync(new URL('./app.js',import.meta.url),'utf8');
  const ui=readFileSync(new URL('./avatar-crop-ui.mjs',import.meta.url),'utf8');
  const css=readFileSync(new URL('./styles.css',import.meta.url),'utf8');
  const html=readFileSync(new URL('./index.html',import.meta.url),'utf8');
  const wf=readFileSync(new URL('./.github/workflows/pages.yml',import.meta.url),'utf8');
  assert.ok(app.includes('chooseAvatarCrop(source)'));
  assert.ok(app.includes('if(!data)return;'));
  assert.ok(ui.includes('role="dialog"'));
  assert.ok(ui.includes("data-crop-action=\"cancel\""));
  assert.ok(ui.includes("data-crop-action=\"save\""));
  assert.ok(ui.includes('canvas.setPointerCapture(ev.pointerId)'));
  assert.ok(ui.includes("canvas.addEventListener('pointermove'"));
  assert.ok(ui.includes("slider.addEventListener('input'"));
  assert.ok(ui.includes("document.body.style.overflow=previousOverflow"));
  assert.ok(ui.includes('URL.revokeObjectURL(url)'));
  assert.ok(css.includes('touch-action:none'));
  assert.ok(html.includes('styles.css?v=2.4.1'));
  assert.ok(html.includes('app.js?v=2.4.1'));
  assert.ok(wf.includes('avatar-crop-ui.mjs avatar-crop-core.mjs'));
});


import {playerWinStreak,streakTier} from './core.mjs';

test('v1.9 連勝從每位玩家的有效對戰紀錄計算，輸掉立即重置',()=>{
 const games=[
  {id:'a',status:'active',playerA:'sam',playerB:'osc',winner:'sam',playedAt:'2026-10-01T19:00:00'},
  {id:'b',status:'active',playerA:'osc',playerB:'friend',winner:'osc',playedAt:'2026-10-01T19:10:00'},
  {id:'c',status:'active',playerA:'sam',playerB:'friend',winner:'sam',playedAt:'2026-10-01T19:20:00'},
  {id:'d',status:'active',playerA:'sam',playerB:'osc',winner:'osc',playedAt:'2026-10-01T19:30:00'},
  {id:'e',status:'active',playerA:'sam',playerB:'osc',winner:'sam',playedAt:'2026-10-01T19:40:00'},
  {id:'f',status:'void',playerA:'sam',playerB:'osc',winner:'osc',playedAt:'2026-10-01T19:50:00'},
  {id:'g',status:'active',playerA:'osc',playerB:'friend',winner:'friend',playedAt:'2026-10-01T19:55:00'}
 ];
 assert.deepEqual(playerWinStreak('sam',games),{current:1,best:2,games:4});
 assert.deepEqual(playerWinStreak('osc',games),{current:0,best:2,games:5});
 assert.deepEqual(playerWinStreak('none',games),{current:0,best:0,games:0});
 assert.deepEqual(playerWinStreak(null,games),{current:0,best:0,games:0});
});
test('v1.9 補登過去戰績按照實際對戰時間排序，不按輸入順序',()=>{
 const games=[
  {id:'late-input',status:'active',playerA:'a',playerB:'b',winner:'a',playedAt:'2026-11-03T20:00:00',createdAt:'2026-11-06T08:00:00'},
  {id:'recent-loss',status:'active',playerA:'a',playerB:'b',winner:'b',playedAt:'2026-11-05T20:00:00',createdAt:'2026-11-05T20:00:00'},
  {id:'old-win',status:'active',playerA:'a',playerB:'b',winner:'a',playedAt:'2026-11-02T20:00:00',createdAt:'2026-11-02T20:00:00'},
  {id:'latest-win',status:'active',playerA:'a',playerB:'b',winner:'a',playedAt:'2026-11-06T08:00:00',createdAt:'2026-11-06T08:01:00'}
 ];
 assert.deepEqual(playerWinStreak('a',games),{current:1,best:2,games:4});
 assert.deepEqual(playerWinStreak('a',games.slice().reverse()),{current:1,best:2,games:4});
});
test('v1.9 連勝外框達到 2、5、10、20 場時自動切換',()=>{
 for(const [n,tier] of [[0,null],[1,null],[2,'bronze'],[4,'bronze'],
   [5,'silver'],[9,'silver'],[10,'gold'],[19,'gold'],[20,'prismatic'],[25,'prismatic']]){
   assert.equal(streakTier(n),tier);
 }
});
test('v1.9 四款透明連勝外框以獨立 SVG 呈現，圖例僅放在個人資料',()=>{
 const app=readFileSync(new URL('./app.js',import.meta.url),'utf8');
 const css=readFileSync(new URL('./styles.css',import.meta.url),'utf8');
 const wf=readFileSync(new URL('./.github/workflows/pages.yml',import.meta.url),'utf8');
 assert.ok(app.includes("streakTier(playerWinStreak(uid,state.matches).current)"));
 assert.ok(app.includes("avatar-frame-decoration"));
 assert.ok(app.includes("function streakGuide()"));
 assert.ok(app.includes('tournamentMedalPanel() + personalExtras()'));
 assert.ok(app.includes('case \'streak-guide\''));
 assert.ok(app.includes('case \'tournament-detail\''));
 assert.ok(!app.includes('玩家自訂名片'));
 assert.ok(app.includes("role")||app.includes("function playerAvatar"));
 assert.ok(css.includes('.avatar-shell>.avatar-frame-decoration'));
 assert.ok(css.includes('width:156%'));
 assert.ok(css.includes('pointer-events:none'));
 assert.ok(wf.includes('cp assets/streak-*.svg dist/assets/'));
 for(const tier of ['bronze','silver','gold','prismatic']){
   const frame=readFileSync(new URL('./assets/streak-'+tier+'.svg',import.meta.url),'utf8');
   assert.ok(frame.startsWith('<svg'));
   assert.ok(frame.includes('viewBox="0 0 200 200"'));
   assert.ok(frame.includes('fill="none"'));
   assert.ok(frame.includes('<circle cx="100" cy="100"'));
   assert.ok(frame.includes('<defs>'));
 }
});


import {serializeTournamentRounds,deserializeTournamentRounds,tournamentPodium,tournamentPlacement,tournamentMedals} from './tournament-core.mjs';
test('v2.0 賽程改為 Firestore 可寫入的陣列物件，杜絕巢狀陣列',()=>{
 const start=startTournament(tourney(),()=>.999);
 const encoded=serializeTournamentRounds(start.rounds);
 assert.ok(encoded.length>0);
 assert.ok(encoded.every(r=>!Array.isArray(r)&&Array.isArray(r.matches)));
 assert.deepEqual(deserializeTournamentRounds(encoded),start.rounds);
 const projected=publicTournamentSnapshot({...start,rounds:encoded});
 assert.ok(projected.rounds.every(r=>!Array.isArray(r)&&Array.isArray(r.matches)));
 assert.equal(projected.rounds[0].matches[0].a,entrants[0].nickname);
 const auth=readFileSync(new URL('./firebase-adapter.js',import.meta.url),'utf8');
 assert.ok(auth.includes('rounds:serializeTournamentRounds(next.rounds)'));
});
test('v2.0 從 Firestore 儲存後的賽程續記，產生冠軍、亞軍與並列季軍',()=>{
 let t=startTournament(tourney(),()=>.999);
 t={...t,rounds:serializeTournamentRounds(t.rounds)};
 // Recorded round results persist as encoded maps between transactions.
 for(let m=0;m<2;m++){
   const match=deserializeTournamentRounds(t.rounds)[0][m];
   t=recordTournamentWinner(t,0,m,match.a);
   t={...t,rounds:serializeTournamentRounds(t.rounds)};
 }
 const f=deserializeTournamentRounds(t.rounds)[1][0];
 t=recordTournamentWinner(t,1,0,f.a);
 t={...t,rounds:serializeTournamentRounds(t.rounds)};
 assert.equal(t.status,'completed');
 const podium=tournamentPodium(t);
 assert.equal(podium.champion,f.a);
 assert.equal(podium.runnerUp,f.b);
 assert.equal(podium.thirdPlace.length,2);
 assert.ok(podium.thirdPlace.every(x=>![f.a,f.b].includes(x)));
 assert.equal(tournamentPlacement(t,f.a),'champion');
 assert.equal(tournamentPlacement(t,f.b),'runnerUp');
 assert.equal(tournamentPlacement(t,podium.thirdPlace[0]),'thirdPlace');
 assert.equal(tournamentPlacement(t,'unknown'),'');
 assert.equal(tournamentMedals(f.a,[t]).champion,1);
 assert.equal(tournamentMedals(f.b,[t]).runnerUp,1);
 assert.equal(tournamentMedals(podium.thirdPlace[0],[t]).thirdPlace,1);
});
test('v2.0 2 人賽事無季軍；3 人賽事可判定季軍',()=>{
 let two=startTournament(tourney(entrants.slice(0,2)),()=>.999);
 two=recordTournamentWinner(two,0,0,two.rounds[0][0].a);
 assert.equal(tournamentPodium(two).thirdPlace.length,0);
 assert.ok(tournamentPodium(two).runnerUp);
 let three=startTournament(tourney(entrants.slice(0,3)),()=>.999);
 const idx=three.rounds[0].findIndex(m=>m.a&&m.b);
 three=recordTournamentWinner(three,0,idx,three.rounds[0][idx].a);
 three=recordTournamentWinner(three,1,0,three.rounds[1][0].a);
 assert.equal(tournamentPodium(three).thirdPlace.length,1);
});
test('v2.0 個人跨戰團獎牌總數與賽事詳情、戰績中的賽事結果',()=>{
 const app=readFileSync(new URL('./app.js',import.meta.url),'utf8');
 const firebase=readFileSync(new URL('./firebase-adapter.js',import.meta.url),'utf8');
 const demo=readFileSync(new URL('./demo-adapter.js',import.meta.url),'utf8');
 assert.ok(firebase.includes('subscribePersonalTournaments(groupIds,uid,onChange,onError)'));
 assert.ok(demo.includes('subscribePersonalTournaments(groupIds,uid,cb)'));
 assert.ok(app.includes('function tournamentMedalPanel()'));
 assert.ok(app.includes('function tournamentDetailBody()'));
 assert.ok(app.includes('tournament-history-results'));
 assert.ok(app.includes('tournamentResultCard(t,state.groupId)'));
 assert.ok(app.includes('function restartPersonalTournaments()'));
 assert.ok(app.includes('personalTournamentUnsub();personalTournamentUnsub=()=>{}'));
 assert.ok(app.includes('deserializeTournamentRounds(rounds)'));
 assert.ok(app.includes('data-action="streak-guide"'));
 assert.ok(!app.includes('streakGuide() + personalExtras()'));
 const css=readFileSync(new URL('./styles.css',import.meta.url),'utf8');
 assert.ok(css.includes('.tournament-medal-stats'));
 assert.ok(css.includes('.tournament-podium-list'));
 assert.ok(css.includes('.modal .streak-guide'));
});

import {sortDeckLibrary} from './core.mjs';
test('v2.1 牌組依勝率、出場次數、名稱排序且不影響原始順序',()=>{
 const original=[{id:'a',name:'紅監獄'},{id:'b',name:'藍一拳'},{id:'c',name:'綠巨人'},{id:'d',name:'黃坂本'}];
 const stats=[{id:'a',games:10,wins:6},{id:'b',games:6,wins:6},{id:'c',games:18,wins:8}];
 assert.deepEqual(sortDeckLibrary(original,stats,'rate').map(d=>d.id),['b','a','c','d']);
 assert.deepEqual(sortDeckLibrary(original,stats,'games').map(d=>d.id),['c','a','b','d']);
 assert.deepEqual(sortDeckLibrary(original,stats,'name').map(d=>d.name),[...original.map(d=>d.name)].sort((a,b)=>a.localeCompare(b,'zh-Hant')));
 assert.equal(original[0].id,'a');
});
test('v2.1 淘汰賽每一場建立唯一正式戰績，連結保存在 Firestore 安全的賽程中',()=>{
 let t=startTournament(tourney(),()=>.999);
 const first=t.rounds[0][0];
 const matchId='t_tournament1_0_0';
 t=recordTournamentWinner(t,0,0,first.a,matchId);
 const stored=serializeTournamentRounds(t.rounds);
 assert.equal(stored[0].matches[0].matchId,matchId);
 assert.equal(deserializeTournamentRounds(stored)[0][0].winner,first.a);
 assert.throws(()=>recordTournamentWinner({...t,rounds:stored},0,0,first.a,'another'));
 const noTournament=computeStats(people,decks,matches).totalMatches;
 const battle={id:matchId,status:'active',playerA:'a',playerB:'b',deckA:'d1',deckB:'d2',winner:'a',tournamentId:'tournament1'};
 const withTournament=computeStats(people,decks,[...matches,battle]).totalMatches;
 assert.equal(withTournament,noTournament+1);
 assert.equal(computeStats(people,decks,matches).totalMatches,noTournament);
});
test('v2.1 牌組選擇與時間用正式戰績儲存，刪除賽事同時移除關聯對戰',()=>{
 const firebase=readFileSync(new URL('./firebase-adapter.js',import.meta.url),'utf8');
 const demo=readFileSync(new URL('./demo-adapter.js',import.meta.url),'utf8');
 assert.ok(firebase.includes('async saveTournamentMatch(gid,id,uid,payload)'));
 assert.ok(firebase.includes('async deleteTournament(gid,id,uid)'));
 assert.ok(firebase.includes('tournamentId:id,tournamentRound:round,tournamentMatch:index,tournamentTitle:current.title'));
 assert.ok(firebase.includes('parsePlayedAt(payload.playedAt)'));
 assert.ok(firebase.includes('tx.set(matchRef,'));
 assert.ok(firebase.includes('getDocs(query(colRef(gid,\'matches\'),where(\'tournamentId\',\'==\',id)))'));
 assert.ok(firebase.includes('tx.delete(publicTournamentRef(t.publicId))'));
 assert.ok(firebase.includes('tx.delete(publicTournamentOwnerRef(t.publicId))'));
 assert.ok(firebase.includes('for(const request of requests.docs)tx.delete(request.ref)'));
 assert.ok(firebase.includes('recorded!==matches.size'));
 assert.ok(demo.includes('data.matches=data.matches.filter(m=>m.tournamentId!==id)'));
 assert.ok(demo.includes('data.tournaments=data.tournaments.filter(t=>t.id!==id)'));
});
test('v2.1 房主權限、牌組驗證及關聯紀錄清理具備 Firestore 安全規則',()=>{
 const rules=readFileSync(new URL('./firestore.rules',import.meta.url),'utf8');
 assert.ok(rules.includes('function validTournamentMatch(gid,matchId,d)'));
 assert.ok(rules.includes('validTournamentMatch(gid,matchId,request.resource.data)'));
 assert.ok(rules.includes('getAfter(/databases/$(database)/documents/groups/$(gid)/tournaments/$(d.tournamentId))'));
 assert.ok(rules.includes("&& !('tournamentId' in resource.data)"));
 assert.ok(rules.includes('!existsAfter(/databases/$(database)/documents/groups/$(gid)/tournaments/$(resource.data.tournamentId))'));
 assert.ok(rules.includes("request.resource.data.eventAt is timestamp"));
 assert.ok(rules.includes('!existsAfter(/databases/$(database)/documents/publicTournamentOwners/$(resource.data.publicId))'));
});
test('v2.1 個人名片、帳號資訊改為彈窗並放在個人簡介下',()=>{
 const app=readFileSync(new URL('./app.js',import.meta.url),'utf8');
 const css=readFileSync(new URL('./styles.css',import.meta.url),'utf8');
 assert.ok(app.includes('function playerCardSettings()'));
 assert.ok(app.includes('function accountInfoBody()'));
 assert.ok(app.includes('data-action="open-card-settings"'));
 assert.ok(app.includes('data-action="open-account-info"'));
 assert.ok(app.includes("case 'card-settings'"));
 assert.ok(app.includes("case 'account-info'"));
 assert.ok(app.includes('state.myCard={...card}'));
 assert.ok(css.includes('.profile-quick-actions'));
 assert.ok(css.includes('.profile-grid-single'));
});
test('v2.1 計時對戰雙方牌組顯示大圖，並支援錦標賽選牌及篩選戰績',()=>{
 const app=readFileSync(new URL('./app.js',import.meta.url),'utf8');
 const css=readFileSync(new URL('./styles.css',import.meta.url),'utf8');
 assert.ok(app.includes('function tournamentMatchModalBody()'));
 assert.ok(app.includes('data-form="tournament-result"'));
 assert.ok(app.includes('data-action="tournament-match"'));
 assert.ok(app.includes('adapter.saveTournamentMatch('));
 assert.ok(app.includes('assertMatch(data,state.players,state.decks)'));
 assert.ok(app.includes("data-action=\"delete-tournament\""));
 assert.ok(app.includes('adapter.deleteTournament('));
 assert.ok(app.includes('name="eventAt"'));
 assert.ok(app.includes('quick-player-visual'));
 assert.ok(app.includes('sortDeckLibrary('));
 assert.ok(app.includes('id="deck-sort"'));
 assert.ok(app.includes('tournamentMatchRows'));
 assert.ok(app.includes('all.filter(m=>!m.tournamentId)'));
 assert.ok(css.includes('.quick-player-visual .deck-art-battle>img'));
 assert.ok(css.includes('.tournament-deck-choices'));
});

import {sideRecordStats,deckDetailStats} from './core.mjs';
test('v2.2 先後攻資訊只從實際記錄計算，歷史缺欄位不猜測',()=>{
 const matches=[
  {status:'active',playerA:'a',playerB:'b',deckA:'a1',deckB:'b1',winner:'a',firstPlayer:'a'},
  {status:'active',playerA:'b',playerB:'a',deckA:'b1',deckB:'a1',winner:'b',firstPlayer:'a'},
  {status:'active',playerA:'a',playerB:'b',deckA:'a1',deckB:'b1',winner:'a',firstPlayer:'b'},
  {status:'active',playerA:'a',playerB:'b',deckA:'a1',deckB:'b1',winner:'a'},
  {status:'void',playerA:'a',playerB:'b',deckA:'a1',deckB:'b1',winner:'b',firstPlayer:'b'}
 ];
 const x=sideRecordStats('a',matches);
 assert.deepEqual(x.first,{games:2,wins:1,losses:1,rate:50});
 assert.deepEqual(x.second,{games:1,wins:1,losses:0,rate:100});
 assert.equal(x.known,3);assert.equal(x.unknown,1);
 assert.equal(computeStats(people,decks,matches).totalMatches,4);
});
test('v2.2 牌組詳情包含先後攻勝率與對特定玩家牌組的克制關係',()=>{
 const matches=[
  {status:'active',playerA:'a',deckA:'a1',playerB:'b',deckB:'b1',winner:'a',firstPlayer:'a'},
  {status:'active',playerA:'b',deckA:'b1',playerB:'a',deckB:'a1',winner:'a',firstPlayer:'b'},
  {status:'active',playerA:'a',deckA:'a1',playerB:'b',deckB:'b1',winner:'b',firstPlayer:'b'},
  {status:'active',playerA:'a',deckA:'a1',playerB:'c',deckB:'c1',winner:'c'}
 ];
 const info=deckDetailStats('a','a1',matches,
  [{id:'a',nickname:'甲'},{id:'b',nickname:'乙'},{id:'c',nickname:'丙'}],
  [{id:'a1',name:'甲組'},{id:'b1',name:'乙組'},{id:'c1',name:'丙組'}]);
 assert.equal(info.games,4);assert.equal(info.wins,2);assert.equal(info.losses,2);
 assert.equal(info.sides.first.wins,1);assert.equal(info.sides.second.wins,1);
 assert.equal(info.sides.unknown,1);
 assert.equal(info.mostDefeated.playerName,'乙');assert.equal(info.mostDefeated.deckName,'乙組');
 assert.equal(info.mostDefeated.wins,2);
 assert.equal(info.mostLostTo.playerName,'乙');assert.equal(info.mostLostTo.deckName,'乙組');
});
test('v2.2 新計時場次抽出決定者、選好先攻後才可啟動',()=>{
 const initial=createQuickMatch({playerA:'a',playerB:'b',deckA:'d1',deckB:'d2'},'a',origin);
 assert.equal(initial.duelRolled,false);assert.equal(initial.firstPlayer,'');
 assert.throws(()=>changeQuickMatch(initial,'start',{playerId:'a',uid:'a',now:origin+1000}));
 const drawn=changeQuickMatch(initial,'draw',{playerId:'b',uid:'a',now:origin+1000});
 assert.equal(drawn.decider,'b');
 assert.throws(()=>changeQuickMatch(drawn,'draw',{playerId:'a',uid:'a',now:origin+1300}));
 const chosen=changeQuickMatch(drawn,'choose',{playerId:'b',uid:'a',now:origin+1400});
 assert.equal(chosen.firstPlayer,'b');assert.equal(chosen.startedAtMs,0);
 assert.throws(()=>changeQuickMatch(chosen,'start',{playerId:'a',uid:'a',now:origin+1800}));
 const running=changeQuickMatch(chosen,'start',{playerId:'b',uid:'a',now:origin+2000});
 assert.equal(running.startedAtMs,origin+2000);assert.equal(running.activePlayer,'b');
 const handed=changeQuickMatch(running,'end',{uid:'a',now:origin+12000});
 assert.equal(handed.activePlayer,'a');assert.equal(handed.activeSinceMs,origin+12000);
 assert.equal(quickClock(handed,origin+12000).unattributedMs,0);
 const end=changeQuickMatch(handed,'finish',{uid:'a',matchId:'x1',now:origin+19000});
 assert.equal(end.activePlayer,'');assert.equal(end.turns.length,2);
 assert.equal(quickClock(end,origin+19000).playerBMs,10000);
 assert.equal(quickClock(end,origin+19000).playerAMs,7000);
});
test('v2.2 前端、Firebase 及規則皆保留先後攻，並提供牌組詳情彈窗',()=>{
 const app=readFileSync(new URL('./app.js',import.meta.url),'utf8');
 const rules=readFileSync(new URL('./firestore.rules',import.meta.url),'utf8');
 const adapter=readFileSync(new URL('./firebase-adapter.js',import.meta.url),'utf8');
 const css=readFileSync(new URL('./styles.css',import.meta.url),'utf8');
 assert.ok(app.includes('data-action="duel-draw"'));
 assert.ok(app.includes('data-action="duel-choose"'));
 assert.ok(app.includes("crypto.getRandomValues(bytes)"));
 assert.ok(app.includes('function deckDetailBody()'));
 assert.ok(app.includes('function firstTurnDetails()'));
 assert.ok(app.includes('data-action="deck-detail"'));
 assert.ok(app.includes('data-action="turn-stats"'));
 assert.ok(app.includes('firstPlayerSelect('));
 assert.ok(app.includes("case 'duel-choose'"));
 assert.ok(app.includes("firstPlayer:fields.firstPlayer"));
 assert.ok(app.includes("data-action=\"deck-settings\""));
 assert.ok(adapter.includes('firstPlayer:before.firstPlayer'));
 assert.ok(adapter.includes("m.firstPlayer?{firstPlayer:m.firstPlayer}"));
 assert.ok(adapter.includes("payload.firstPlayer?{firstPlayer:payload.firstPlayer}"));
 assert.ok(rules.includes("request.resource.data.duelRolled == false"));
 assert.ok(rules.includes("request.resource.data.firstPlayer in [resource.data.playerA,resource.data.playerB]"));
 assert.ok(rules.includes("request.resource.data.activePlayer == (resource.data.activePlayer == resource.data.playerA ? resource.data.playerB : resource.data.playerA)"));
 assert.ok(rules.includes("'playedAt','firstPlayer'"));
 assert.ok(css.includes('.duel-stage'));
 assert.ok(css.includes('.deck-detail-roles'));
});

test('v2.2.1 尚未由先攻者開始計時時，不能提前完成正式計時戰績',()=>{
 let q=createQuickMatch({playerA:'a',playerB:'b',deckA:'d1',deckB:'d2'},'a',origin);
 q=changeQuickMatch(q,'draw',{playerId:'a',uid:'a',now:origin+1000});
 q=changeQuickMatch(q,'choose',{playerId:'b',uid:'a',now:origin+1500});
 assert.equal(q.startedAtMs,0);
 assert.throws(()=>changeQuickMatch(q,'finish',{uid:'a',matchId:'no-start',now:origin+1800}));
});
test('v2.2.1 個人名片牌組封面可以點開唯讀詳情，先後攻勝場會即時更新',()=>{
 const app=readFileSync(new URL('./app.js',import.meta.url),'utf8');
 const css=readFileSync(new URL('./styles.css',import.meta.url),'utf8');
 assert.ok(app.includes('class="deck-top-five-open" data-action="deck-detail"'));
 assert.ok(app.includes('class="deck-role-mini"'));
 assert.ok(app.includes("['profile','decks'].includes(state.tab)"));
 assert.ok(app.includes('d.createdAt?e(new Date(dateNum(d.createdAt))'));
 assert.ok(app.includes('s.duelRolled===undefined||!!s.startedAtMs'));
 assert.ok(css.includes('.deck-top-five-open'));
});

test('v2.3 牌組六種排序方向及未出場勝率不混算',()=>{
 const decks=[{id:'a',name:'紅監獄'},{id:'b',name:'藍一拳'},{id:'c',name:'綠巨人'},{id:'d',name:'黃坂本'}];
 const stats=[{id:'a',games:10,wins:6},{id:'b',games:6,wins:6},{id:'c',games:18,wins:8}];
 assert.deepEqual(sortDeckLibrary(decks,stats,'rate-asc').map(d=>d.id),['c','a','b','d']);
 assert.deepEqual(sortDeckLibrary(decks,stats,'games-asc').map(d=>d.id),['d','b','a','c']);
 assert.deepEqual(sortDeckLibrary(decks,stats,'name-desc').map(d=>d.name),
   [...decks.map(d=>d.name)].sort((a,b)=>b.localeCompare(a,'zh-Hant')));
});
test('v2.3 剪裁一次並完整顯示，個人與公開名片有獨立背景欄位',()=>{
 const app=readFileSync(new URL('./app.js',import.meta.url),'utf8');
 const ui=readFileSync(new URL('./wide-crop-ui.mjs',import.meta.url),'utf8');
 const css=readFileSync(new URL('./styles.css',import.meta.url),'utf8');
 const adapter=readFileSync(new URL('./firebase-adapter.js',import.meta.url),'utf8');
 const rules=readFileSync(new URL('./firestore.rules',import.meta.url),'utf8');
 const wf=readFileSync(new URL('./.github/workflows/pages.yml',import.meta.url),'utf8');
 assert.ok(ui.includes("export async function chooseWideCrop"));
 assert.ok(ui.includes("ratio:16/9"));
 assert.ok(ui.includes("ratio:3"));
 assert.ok(ui.includes("data-wide-action=\"save\""));
 assert.ok(ui.includes("data-wide-action=\"cancel\""));
 assert.ok(app.includes("chooseWideCrop(source,'deck')"));
 assert.ok(app.includes("chooseWideCrop(source,'profile')"));
 assert.ok(app.includes("chooseWideCrop(source,'card')"));
 assert.ok(css.includes("object-fit:cover !important"));
 assert.ok(css.includes(".player-card-banner:after"));
 assert.ok(css.includes(".card-settings-modal input[type=\"checkbox\"]"));
 assert.ok(adapter.includes("async saveProfileCover"));
 assert.ok(adapter.includes("coverData:typeof card.coverData"));
 assert.ok(rules.includes("validWideCover"));
 assert.ok(rules.includes("'profileCoverData'"));
 assert.ok(wf.includes("core.mjs image-source.mjs wide-crop-ui.mjs avatar-crop-ui.mjs"));
});
test('v2.3 戰績詳情右上設定允許範圍內的編輯與撤銷',()=>{
 const app=readFileSync(new URL('./app.js',import.meta.url),'utf8');
 const adapter=readFileSync(new URL('./firebase-adapter.js',import.meta.url),'utf8');
 const rules=readFileSync(new URL('./firestore.rules',import.meta.url),'utf8');
 assert.ok(app.includes('data-action="match-settings"'));
 assert.ok(app.includes('data-action="match-edit"'));
 assert.ok(app.includes('data-action="void-match"'));
 assert.ok(!app.includes('撤銷這場戰績（雙方皆可）'));
 assert.ok(adapter.includes("async updateMatch(gid,id,m)"));
 assert.ok(adapter.includes("async updateTimedMatch(gid,id,winner,note)"));
 assert.ok(rules.includes(".hasOnly(['winner','note'])"));
 assert.ok(rules.includes("!('tournamentId' in resource.data)"));
});

test('v2.4 已上傳的圖片只能編輯既有來源，移除後才能選擇新檔',()=>{
 const app=readFileSync(new URL('./app.js',import.meta.url),'utf8');
 const imageSource=readFileSync(new URL('./image-source.mjs',import.meta.url),'utf8');
 const avatarUi=readFileSync(new URL('./avatar-crop-ui.mjs',import.meta.url),'utf8');
 const wideUi=readFileSync(new URL('./wide-crop-ui.mjs',import.meta.url),'utf8');
 const css=readFileSync(new URL('./styles.css',import.meta.url),'utf8');
 for(const kind of ['avatar','profile-cover','deck','card-cover']){
   assert.ok(app.includes("case 'edit-"+kind+"-image'"));
   const removal=kind==='avatar'?"remove-avatar":kind==='profile-cover'?"remove-profile-cover":kind==='deck'?"remove-deck-image":"remove-card-cover";
   assert.ok(app.includes("case '"+removal+"'"));
 }
 assert.ok(app.includes('data-action="toggle-image-settings"'));
 assert.ok(app.includes("imageSettings('profile-cover'"));
 assert.ok(app.includes("imageSettings('card-cover'"));
 assert.ok(app.includes("imageSettings('deck'"));
 assert.ok(app.includes("imageSettings('avatar'"));
 assert.ok(app.includes("prepareImageSource(file,145000)"));
 assert.ok(app.includes("cardCoverSourceData"));
 assert.ok(app.includes("imageSourceData"));
 assert.ok(avatarUi.includes("const stored=typeof file==='string'"));
 assert.ok(wideUi.includes("const stored=typeof file==='string'"));
 assert.ok(imageSource.includes("export async function prepareImageSource"));
 assert.ok(css.includes(".profile-cover{"));
 assert.ok(css.includes("border:0!important"));
 assert.ok(css.includes("aspect-ratio:16 / 9!important"));
 assert.ok(css.includes(".image-settings-menu[hidden]"));
});
test('v2.4 原始照片僅擁有者可讀，公開牌組和名片只存裁切結果',()=>{
 const firebase=readFileSync(new URL('./firebase-adapter.js',import.meta.url),'utf8');
 const rules=readFileSync(new URL('./firestore.rules',import.meta.url),'utf8');
 const workflow=readFileSync(new URL('./.github/workflows/pages.yml',import.meta.url),'utf8');
 assert.ok(firebase.includes("personalDeckImageRef"));
 assert.ok(firebase.includes("async getDeckSource(uid,id)"));
 assert.ok(firebase.includes("batch.set(personalDeckImageRef"));
 assert.ok(firebase.includes("batch.set(userRef(uid),{cardCoverSourceData:sourceData"));
 assert.ok(rules.includes("match /users/{uid}/deckImageSources/{deckId}"));
 assert.ok(rules.includes("uid == request.auth.uid"));
 assert.ok(rules.includes("validImageSource"));
 assert.ok(rules.includes("'cardCoverSourceData'"));
 assert.ok(rules.includes("'avatarSourceData'"));
 assert.ok(rules.includes("'profileCoverSourceData'"));
 assert.ok(!rules.includes("match /users/{uid}/decks/{deckId} {\n      allow get: if false"));
 assert.ok(workflow.includes("node --check image-source.mjs"));
 assert.ok(workflow.includes("image-source.mjs wide-crop-ui.mjs"));
});

test('v2.5 個人背景無內縮邊框，名片背景填滿但保留暗化漸層',()=>{
 const app=readFileSync(new URL('./app.js',import.meta.url),'utf8');
 const css=readFileSync(new URL('./styles.css',import.meta.url),'utf8');
 assert.ok(app.includes('class="card profile-account-card"'));
 assert.ok(css.includes('.profile-account-card > .profile-cover'));
 assert.ok(css.includes('width:calc(100% + 44px)'));
 assert.ok(css.includes('margin:-22px -22px 18px'));
 assert.ok(css.includes('width:calc(100% + 34px)'));
 assert.ok(css.includes('margin:-17px -17px 17px'));
 assert.ok(css.includes('width:calc(100% + 24px)'));
 assert.ok(css.includes('margin:-12px -12px 16px'));
 assert.ok(css.includes('.player-card-banner > img'));
 assert.ok(css.includes('object-fit:cover !important'));
 assert.ok(css.includes('.player-card-banner:after'));
 assert.ok(css.includes('rgba(6,11,20,.88)'));
 assert.ok(css.includes('rgba(6,11,20,.50)'));
});
test('v2.5 圖片跨牌組收藏、對戰、計時、錦標賽、名片 TOP5 統一 16:9 滿版',()=>{
 const css=readFileSync(new URL('./styles.css',import.meta.url),'utf8');
 const app=readFileSync(new URL('./app.js',import.meta.url),'utf8');
 const imageRule=css.slice(css.lastIndexOf('/* v2.5 · Keep the entire cropped 16:9 picture'));
 for(const selector of [
  '.deck-cover',
  '.deck-art-frame',
  '.deck-top-five-item .deck-art-top-five',
  '.deck-top-five-open .deck-art-top-five',
  '.deck-favorite-feature .deck-art-favorite',
  '.detail-participants .detail-side .deck-art-battle',
  '.quick-player-visual .deck-art-battle',
  '.tournament-deck-choice .deck-art-tournament',
  '.deck-detail-cover',
  '.deck-image-preview'
 ])assert.ok(imageRule.includes(selector), 'missing full-frame selector: '+selector);
 assert.ok(imageRule.includes('aspect-ratio:16 / 9 !important'));
 assert.ok(imageRule.includes('height:auto !important'));
 assert.ok(imageRule.includes('object-fit:cover !important'));
 assert.ok(imageRule.includes('overflow:hidden'));
 assert.ok(!imageRule.includes('object-fit:contain'));
 assert.ok(app.includes("chooseWideCrop(source,'deck')"));
 const crop=readFileSync(new URL('./wide-crop-ui.mjs',import.meta.url),'utf8');
 assert.ok(crop.includes("ratio:16/9,width:960,height:540"));
});
