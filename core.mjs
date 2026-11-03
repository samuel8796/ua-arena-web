/** Pure, testable stat & input functions. Firestore data is handled separately. */
export const GUEST_PLAYER_ID = '__ua_guest__';
export const GUEST_DECK_ID = '__ua_guest_deck__';
export const personalGroupId = uid => `personal_${uid}`;
export const personalGroupName = nickname => `${String(nickname||'玩家').trim().slice(0,24)||'玩家'}的戰團`;
export const isGuestMatch = m => m.playerA===GUEST_PLAYER_ID || m.playerB===GUEST_PLAYER_ID;
export const guestPlayer = () => ({id:GUEST_PLAYER_ID,uid:GUEST_PLAYER_ID,nickname:'訪客玩家',role:'guest',virtual:true});
export const guestDeckLabel = (match,side) => match[side==='A'?'playerA':'playerB']===GUEST_PLAYER_ID ? `${match.guestDeck?.name||'訪客牌組'}（${colorOf(match.guestDeck?.color||'OTHER').name}）` : '';
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
export function assertMatch({playerA,playerB,deckA,deckB,winner,guestDeck}, players=[],decks=[], {allowGuest=false}={}) {
  if(!playerA || !playerB || playerA===playerB) throw new Error('請選擇兩位不同的玩家。');
  if(!players.some(p=>p.id===playerA)||!players.some(p=>p.id===playerB)) throw new Error('玩家不存在。');
  const hasGuest=playerA===GUEST_PLAYER_ID || playerB===GUEST_PLAYER_ID;
  if(hasGuest && !allowGuest)throw new Error('只有個人戰團可以登錄訪客玩家。');
  if(hasGuest){
    const guestSide=playerA===GUEST_PLAYER_ID?'A':'B';
    if((guestSide==='A'?deckA:deckB)!==GUEST_DECK_ID)throw new Error('訪客牌組只能在本場臨時填寫。');
    if(!guestDeck || typeof guestDeck.name!=='string'||!guestDeck.name.trim()||guestDeck.name.trim().length>42
       || !COLORS.some(c=>c.id===guestDeck.color))throw new Error('請填寫訪客使用牌組的名稱與顏色。');
  }else if(guestDeck)throw new Error('非訪客對戰不可包含訪客牌組。');
  for(const [id,deckId] of [[playerA,deckA],[playerB,deckB]]){
    if(id===GUEST_PLAYER_ID)continue;
    const found=decks.find(d=>d.id===deckId);
    if(!found||found.ownerUid!==id||found.active===false)throw new Error('牌組必須屬於所選玩家且仍在使用中。');
  }
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
      const d=decksById[id]||(id===GUEST_DECK_ID&&p.id===GUEST_PLAYER_ID&&m.guestDeck?{name:m.guestDeck.name,color:m.guestDeck.color}:null); if(!d)continue;
      const statId=id===GUEST_DECK_ID?`${id}:${d.name}:${d.color}`:id;
      if(!deckSummary[statId])deckSummary[statId]={id:statId,name:d.name,color:d.color,games:0,wins:0,losses:0};
      deckSummary[statId].games++;
      if(m.winner===p.id)deckSummary[statId].wins++; else deckSummary[statId].losses++;
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

/** Consolidates only this user's active matches across each joined play group.
 * IDs remain scoped to their group; duplicate doc IDs in different groups count separately.
 * A revoked/voided match never contributes to a personal record.
 */
export function aggregatePersonalStats(uid, groupMatches={}) {
  const byGroup=Object.entries(groupMatches||{}).map(([groupId, all])=>{
    const matches=(all||[]).filter(m=>m.status==='active'&&(m.playerA===uid||m.playerB===uid));
    const wins=matches.filter(m=>m.winner===uid).length;
    const games=matches.length;
    return {groupId,games,wins,losses:games-wins,rate:games?Math.round(wins*100/games):0,matches};
  });
  const games=byGroup.reduce((n,g)=>n+g.games,0);
  const wins=byGroup.reduce((n,g)=>n+g.wins,0);
  return {games,wins,losses:games-wins,rate:games?Math.round(100*wins/games):0,byGroup};
}
