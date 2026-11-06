/** Quick Match timers. Times are UTC epoch milliseconds; Firestore stores all transitions. */
export const QUICK_MATCH_LIMIT_MS = 30 * 60 * 1000;
export const QUICK_MAX_TURNS = 200;
export function createQuickMatch({playerA, playerB, deckA, deckB, guestDeck}, uid, now=Date.now()) {
  if (!playerA || !playerB || playerA === playerB || !deckA || !deckB) throw new Error('請選擇兩位不同玩家及各自牌組。');
  return {playerA, playerB, deckA, deckB, ...(guestDeck?{guestDeck:{name:guestDeck.name.trim(),color:guestDeck.color}}:{}), timerEnabled:true, status:'ready',
    createdBy:uid, createdAtMs:now, startedAtMs:0, activePlayer:'', activeSinceMs:0,
    turns:[], finishedAtMs:0, resultMatchId:'', revision:0, lastActionAtMs:now, updatedBy:uid,
     duelRolled:false,decider:'',firstPlayer:''};
}
export function changeQuickMatch(s, action, {playerId='', now=Date.now(), uid='', matchId=''}={}) {
  if (!Number.isSafeInteger(now) || now < (s.createdAtMs||0)) throw new Error('裝置時間異常，請校正時鐘後重試。');
  if (!['ready','running'].includes(s.status)) throw new Error('這場對戰已結束，無法再修改計時。');
  if (now < (s.lastActionAtMs||0)) throw new Error('時間資料不一致，請同步最新對戰資訊後重試。');
  if(action==='finish' && s.duelRolled===false&&!s.firstPlayer)throw new Error('請先完成決鬥抽選並決定先後攻。');
  const next={...s,turns:[...(s.turns||[])],lastActionAtMs:now,updatedBy:uid,revision:(s.revision||0)+1};
  if(action==='draw') {
    if(s.status!=='ready'||s.startedAtMs||s.duelRolled!==false)throw new Error('本場已抽選過決定先後攻的人。');
    if(![s.playerA,s.playerB].includes(playerId))throw new Error('抽選玩家無效。');
    next.duelRolled=true;next.decider=playerId;next.firstPlayer='';
  } else if(action==='choose') {
    if(s.status!=='ready'||!s.duelRolled||!s.decider||s.firstPlayer)throw new Error('請先按「開始決鬥」抽出決定先後攻的玩家。');
    if(![s.playerA,s.playerB].includes(playerId))throw new Error('無效的先攻玩家。');
    next.firstPlayer=playerId;
  } else if(action==='start') {
    // Legacy running timers without a firstPlayer keep their original behavior.
    if(s.duelRolled===false&&!s.firstPlayer)throw new Error('請先抽籤並決定先後攻。');
    if(!s.startedAtMs && s.firstPlayer && playerId!==s.firstPlayer)throw new Error('必須由先攻玩家按下「回合開始」。');
    if(s.activePlayer)throw new Error('上一個回合尚未結束，請先點選「回合結束」。');
    if (![s.playerA,s.playerB].includes(playerId)) throw new Error('無效的玩家。');
    if ((s.turns||[]).length>=QUICK_MAX_TURNS) throw new Error('回合紀錄已達上限，請結束比賽。');
    if(s.startedAtMs && now - s.startedAtMs >= QUICK_MATCH_LIMIT_MS) throw new Error('30 分鐘已到，請登錄勝負。');
    next.status='running';next.startedAtMs=s.startedAtMs||now;next.activePlayer=playerId;next.activeSinceMs=now;
  } else if (action==='end' || action==='finish') {
    if (action==='end' && !s.activePlayer) throw new Error('目前沒有進行中的回合。');
    if(s.activePlayer){
      next.turns.push({playerId:s.activePlayer,startedAtMs:s.activeSinceMs,endedAtMs:now,durationMs:Math.max(0,now-s.activeSinceMs)});
    }
    if(action==='end'){
      // Switch to the other player in the same committed transition, with
      // no extra tap or unassigned time between turns.
      next.activePlayer=s.activePlayer===s.playerA?s.playerB:s.playerA;
      next.activeSinceMs=now;
    } else {
      next.activePlayer='';next.activeSinceMs=0;
    }
    if(action==='finish') {
      if(!matchId)throw new Error('缺少對戰結果 ID。');
      next.status='finished';next.finishedAtMs=now;next.resultMatchId=matchId;
    }
  } else if(action==='cancel') {
    next.status='cancelled';next.finishedAtMs=now;next.activePlayer='';next.activeSinceMs=0;
  } else throw new Error('無效的計時操作。');
  return next;
}
export function quickClock(s, now=Date.now()) {
  const started=Number(s?.startedAtMs)||0;
  const ended=s?.finishedAtMs ? Number(s.finishedAtMs) : now;
  const elapsedMs=started?Math.max(0,ended-started):0;
  const remainingMs=Math.max(0,QUICK_MATCH_LIMIT_MS-elapsedMs);
  const a=Number(s?.turns?.filter(t=>t.playerId===s.playerA).reduce((n,t)=>n+Math.max(0,t.durationMs||0),0))||0;
  const b=Number(s?.turns?.filter(t=>t.playerId===s.playerB).reduce((n,t)=>n+Math.max(0,t.durationMs||0),0))||0;
  const live=s?.activePlayer&&s?.activeSinceMs?Math.max(0,ended-s.activeSinceMs):0;
  const aMs=a+(s?.activePlayer===s?.playerA?live:0);
  const bMs=b+(s?.activePlayer===s?.playerB?live:0);
  return {elapsedMs,remainingMs,expired:started>0 && remainingMs===0,
    playerAMs:aMs,playerBMs:bMs,unattributedMs:Math.max(0,elapsedMs-aMs-bMs),
    turns:s?.turns?.length||0,activePlayer:s?.activePlayer||''};
}
export function mmss(ms){const seconds=Math.max(0,Math.floor(ms/1000));return `${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`}
export function quickMatchResult(s,now=Date.now()) {
  const clock=quickClock(s,now);
  return {enabled:true,limitMs:QUICK_MATCH_LIMIT_MS,elapsedMs:clock.elapsedMs,playerAMs:clock.playerAMs,playerBMs:clock.playerBMs,unattributedMs:clock.unattributedMs,turns:clock.turns,expired:clock.expired};
}
