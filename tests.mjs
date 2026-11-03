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
