/** Pure, testable stat & input functions. Firestore data is handled separately. */
export const COLORS = [
  {id:'RED',name:'紅色',hex:'#f46b72'},
  {id:'BLUE',name:'藍色',hex:'#5a9dfa'},
  {id:'GREEN',name:'綠色',hex:'#63d5a8'},
  {id:'YELLOW',name:'黃色',hex:'#f4c75a'},
  {id:'PURPLE',name:'紫色',hex:'#ad8bf6'},
  {id:'MULTI',name:'混色',hex:'#d2b2f9'},
  {id:'OTHER',name:'其他',hex:'#a5adbc'}
];
export const colorOf = id => COLORS.find(c=>c.id===id) || COLORS.at(-1);
export const safeText = (x='') => String(x ?? '').replace(/[&<>"']/g, s=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]));
export const shortId = (id='') => id.length>11 ? `${id.slice(0,5)}…${id.slice(-4)}` : id;
export const asDate = value => value?.toDate?.() || (value ? new Date(value) : null);
export const formatDate = value => {
  const date = asDate(value);
  if(!date || Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('zh-TW',{timeZone:'Asia/Taipei',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
};
export function assertMatch({playerA,playerB,deckA,deckB,winner}, players=[],decks=[]) {
  if(!playerA || !playerB || playerA===playerB) throw new Error('請選擇兩位不同的玩家。');
  if(!players.some(p=>p.id===playerA)||!players.some(p=>p.id===playerB)) throw new Error('玩家不存在。');
  const da=decks.find(d=>d.id===deckA), db=decks.find(d=>d.id===deckB);
  if(!da || da.ownerUid!==playerA || !db || db.ownerUid!==playerB) throw new Error('牌組必須屬於所選玩家。');
  if(![playerA,playerB].includes(winner)) throw new Error('請選擇本場勝者。');
  return true;
}
export function computeStats(players=[],decks=[],matches=[]) {
  const active=matches.filter(m=>m.status==='active');
  const decksById=Object.fromEntries(decks.map(d=>[d.id,d]));
  const perPlayer=players.map(p=>{
    const games=active.filter(m=>m.playerA===p.id||m.playerB===p.id);
    const wins=games.filter(m=>m.winner===p.id).length;
    const deckSummary={};
    for(const m of games){
      const id=m.playerA===p.id?m.deckA:m.deckB;
      const d=decksById[id]; if(!d) continue;
      if(!deckSummary[id])deckSummary[id]={id,name:d.name,color:d.color,games:0,wins:0,losses:0};
      deckSummary[id].games++;
      if(m.winner===p.id)deckSummary[id].wins++; else deckSummary[id].losses++;
    }
    const ds=Object.values(deckSummary);
    const by=(field)=>[...ds].sort((a,b)=>b[field]-a[field] || b.games-a.games)[0] || null;
    return {...p,games:games.length,wins,losses:games.length-wins,rate:games.length?Math.round(wins/games.length*100):0,
      favorite:by('games'),mostWins:by('wins'),mostLosses:by('losses'),deckStats:ds};
  });
  const leaderboard=[...perPlayer].sort((a,b)=>b.wins-a.wins||b.rate-a.rate||b.games-a.games);
  return {totalMatches:active.length,players:perPlayer,leaderboard,activeMatches:active};
}
export function matchupSummary(matches=[], players=[]) {
  return players.map(p=>{
    const wins=matches.filter(m=>m.status==='active'&&m.winner===p.id).length;
    return {name:p.nickname,wins};
  });
}
export const RULE_SYSTEM_PROMPT = `你是繁體中文的 BANDAI UNION ARENA（UA）專用規則助手。只討論 UA；不得混用寶可夢、遊戲王、航海王卡牌等其他 TCG。對用戶非 UA 的問題回答「我只回答 UNION ARENA 的相關問題。」。先給簡短結論，再說理由，預設 80–150 字。區分日文、英文、繁體中文、簡體中文與混合版本，必要時要求卡號和效果全文。沒有可靠官方依據時，明確表示無法確認，不得捏造卡片效果、法規或來源連結。不得把不同語言版本的規則視為必然一致。AI 回答不是官方裁定。`;
