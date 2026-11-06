/** Deterministic, single-elimination tournament bracket functions.
 * Public snapshots contain display names only (never Firebase user IDs or private group IDs).
 */
export const TOURNAMENT_MAX_PLAYERS = 32;
const unique = values => new Set(values).size === values.length;
export function validateEntrants(entrants) {
  if (!Array.isArray(entrants) || entrants.length < 2 || entrants.length > TOURNAMENT_MAX_PLAYERS)
    throw new Error('單敗淘汰賽必須有 2–32 名參賽者。');
  if (!unique(entrants.map(p=>p.uid)) || entrants.some(p=>!p.uid || !p.nickname || p.nickname.length>24))
    throw new Error('參賽者不可重複，且必須有有效暱稱。');
}
const clone = value => JSON.parse(JSON.stringify(value));
/** Firestore prohibits nested arrays; save each bracket round as a map
 * containing an array of match maps. UI/core can still work with round arrays.
 * Accept legacy already-decoded arrays, as well as stored object rounds. */
export function serializeTournamentRounds(rounds=[]) {
  return deserializeTournamentRounds(rounds).map(round=>({matches:round.map(m=>({
    a:m.a||'',b:m.b||'',winner:m.winner||'',bye:!!m.bye,...(m.matchId?{matchId:m.matchId}:{})
  }))}));
}
export function deserializeTournamentRounds(rounds=[]) {
  if(!Array.isArray(rounds))return [];
  return rounds.map(round=>Array.isArray(round)?round:(Array.isArray(round?.matches)?round.matches:[]));
}
/** Completed single elimination: final loser gets runner-up. Without a bronze
 * playoff the two semifinal losers share third place (some may have a bye). */
export function tournamentPodium(tournament) {
  const empty={champion:'',runnerUp:'',thirdPlace:[]};
  if(!tournament||tournament.status!=='completed')return empty;
  const rounds=deserializeTournamentRounds(tournament.rounds);
  const final=rounds.at(-1)?.[0];
  if(!final?.winner || !final.a || !final.b || ![final.a,final.b].includes(final.winner))return empty;
  const runnerUp=final.winner===final.a?final.b:final.a;
  const semi=rounds.length>1?rounds.at(-2):[];
  const thirdPlace=semi
    .filter(m=>m.a&&m.b&&m.winner&&[m.a,m.b].includes(m.winner))
    .map(m=>m.winner===m.a?m.b:m.a)
    .filter(uid=>uid!==final.winner&&uid!==runnerUp);
  return {champion:final.winner,runnerUp,thirdPlace:[...new Set(thirdPlace)]};
}
export function tournamentPlacement(tournament,uid){
  if(!uid||!tournament?.participants?.some(p=>p.uid===uid))return '';
  if(tournament.status!=='completed')return 'participating';
  const podium=tournamentPodium(tournament);
  if(podium.champion===uid)return 'champion';
  if(podium.runnerUp===uid)return 'runnerUp';
  if(podium.thirdPlace.includes(uid))return 'thirdPlace';
  return 'participant';
}
export function tournamentMedals(uid,allTournaments=[]) {
  const results=allTournaments.filter(t=>t.status==='completed'&&t.participants?.some(p=>p.uid===uid));
  return {events:results.length,
    champion:results.filter(t=>tournamentPlacement(t,uid)==='champion').length,
    runnerUp:results.filter(t=>tournamentPlacement(t,uid)==='runnerUp').length,
    thirdPlace:results.filter(t=>tournamentPlacement(t,uid)==='thirdPlace').length};
}

/** Shuffling is optional for controlled testing, defaults to non-cryptographic random draw. */
export function createBracket(entrants, random=Math.random) {
  validateEntrants(entrants);
  const entrantsCopy=entrants.map(p=>p.uid);
  for(let i=entrantsCopy.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[entrantsCopy[i],entrantsCopy[j]]=[entrantsCopy[j],entrantsCopy[i]];}
  const size=2**Math.ceil(Math.log2(entrantsCopy.length));
  // Distribute byes between pairs so each real player has a first-round opponent or an explicit bye.
  const byeCount=size-entrantsCopy.length;
  const first=[];let pos=0;
  for(let i=0;i<size/2;i++){
    const a=entrantsCopy[pos++]||'';
    const b=i<byeCount?'':(entrantsCopy[pos++]||'');
    first.push({a,b,winner:!b?a:'',bye:!b});
  }
  const rounds=[first];
  for(let len=first.length;len>1;len/=2)rounds.push(Array.from({length:len/2},()=>({a:'',b:'',winner:'',bye:false})));
  return propagate(rounds);
}
function propagate(rounds){
  for(let r=1;r<rounds.length;r++){
    const previous=rounds[r-1];
    for(let j=0;j<rounds[r].length;j++){
      const left=previous[j*2],right=previous[j*2+1];
      const next=rounds[r][j];
      // Only reveal next match once both feeder matches have an outcome.
      if(left.winner && right.winner){next.a=left.winner;next.b=right.winner;}
    }
  }
  return rounds;
}
export function recordTournamentWinner(tournament,roundIndex,matchIndex,winner,matchId=''){
  if(tournament.status!=='running')throw new Error('賽事尚未開始或已結束。');
  const rounds=clone(deserializeTournamentRounds(tournament.rounds));
  const match=rounds[roundIndex]?.[matchIndex];
  if(!match || !match.a || !match.b || match.winner)throw new Error('此場對戰尚未開放或已有結果。');
  if(winner!==match.a && winner!==match.b)throw new Error('勝者必須是該場參賽者。');
  match.winner=winner;
  if(matchId)match.matchId=matchId;
  propagate(rounds);
  const champion=rounds.at(-1)?.[0]?.winner||'';
  return {...tournament,rounds,champion,status:champion?'completed':'running'};
}
export function addTournamentEntrant(tournament,member){
  if(tournament.status!=='registration')throw new Error('報名已截止。');
  if(tournament.participants.length>=TOURNAMENT_MAX_PLAYERS)throw new Error('本賽事人數已達上限。');
  if(tournament.participants.some(p=>p.uid===member.uid))throw new Error('這位玩家已在名單中。');
  return {...tournament,participants:[...tournament.participants,{uid:member.uid,nickname:member.nickname}]};
}
export function removeTournamentEntrant(tournament,uid){
  if(tournament.status!=='registration')throw new Error('賽事已開始，無法移除參賽者。');
  return {...tournament,participants:tournament.participants.filter(p=>p.uid!==uid)};
}
export function startTournament(tournament,random=Math.random){
  if(tournament.status!=='registration')throw new Error('這場錦標賽無法重新開賽。');
  const rounds=createBracket(tournament.participants,random);
  return {...tournament,rounds,status:'running',champion:''};
}
export function publicTournamentSnapshot(tournament){
  const nicknames=Object.fromEntries(tournament.participants.map(p=>[p.uid,p.nickname]));
  const nameFor=uid=>uid?nicknames[uid]||'未知玩家':'';
  return {
    title:tournament.title,description:tournament.description||'',hostName:tournament.hostName||'賽事房主',
    status:tournament.status,public:true,
    participants:tournament.participants.map(p=>({name:p.nickname})),
    rounds:serializeTournamentRounds(deserializeTournamentRounds(tournament.rounds)
      .map(round=>round.map(m=>({a:nameFor(m.a),b:nameFor(m.b),winner:nameFor(m.winner),bye:!!m.bye})))),
    champion:nameFor(tournament.champion),
    ...(tournament.eventAt?{eventAt:tournament.eventAt}:{})
  };
}
