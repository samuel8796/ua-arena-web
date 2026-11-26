/** Tournament pairing and standings (single elimination and Swiss).
 * Public snapshots contain display names only (never Firebase user IDs or private group IDs).
 */
export const TOURNAMENT_MAX_PLAYERS = 32;
const unique = values => new Set(values).size === values.length;
export function validateEntrants(entrants) {
  if (!Array.isArray(entrants) || entrants.length < 2 || entrants.length > TOURNAMENT_MAX_PLAYERS)
    throw new Error('錦標賽必須有 2–32 名參賽者。');
  if (!unique(entrants.map(p=>p.uid)) || entrants.some(p=>typeof p.uid!=='string'||!p.uid||p.uid.length>128||typeof p.nickname!=='string'||!p.nickname.trim()||p.nickname.length>24))
    throw new Error('參賽者不可重複，且必須有有效暱稱。');
  if (!unique(entrants.map(p=>p.nickname.trim().toLocaleLowerCase())))
    throw new Error('參賽者暱稱不可重複，請修改同名玩家或訪客名稱。');
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
  if(tournament.format==='swiss'){
    const ranked=swissStandings(tournament);
    return {champion:ranked[0]?.uid||'',runnerUp:ranked[1]?.uid||'',thirdPlace:ranked[2]?[ranked[2].uid]:[]};
  }
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
  if(tournament.format==='swiss'){
    if(roundIndex!==rounds.length-1)throw new Error('只能登錄目前瑞士制輪次。');
    const finished=rounds[roundIndex].every(m=>!!m.winner);
    if(!finished)return {...tournament,rounds};
    if(rounds.length<swissRoundLimit(tournament.participants.length)){
      rounds.push(createSwissRound(tournament.participants,rounds));
      return {...tournament,rounds,champion:'',status:'running'};
    }
    const completed={...tournament,rounds,status:'completed'};
    return {...completed,champion:swissStandings(completed)[0]?.uid||''};
  }
  propagate(rounds);
  const champion=rounds.at(-1)?.[0]?.winner||'';
  return {...tournament,rounds,champion,status:champion?'completed':'running'};
}
export function addTournamentEntrant(tournament,member){
  if(tournament.status!=='registration')throw new Error('報名已截止。');
  if(tournament.participants.length>=TOURNAMENT_MAX_PLAYERS)throw new Error('本賽事人數已達上限。');
  if(tournament.participants.some(p=>p.uid===member.uid))throw new Error('這位玩家已在名單中。');
  const entrants=[...tournament.participants,{uid:member.uid,nickname:member.nickname}];
  validateEntrantsForRegistration(entrants);
  return {...tournament,participants:entrants};
}
export function removeTournamentEntrant(tournament,uid){
  if(tournament.status!=='registration')throw new Error('賽事已開始，無法移除參賽者。');
  return {...tournament,participants:tournament.participants.filter(p=>p.uid!==uid)};
}
export function startTournament(tournament,random=Math.random){
  if(tournament.status!=='registration')throw new Error('這場錦標賽無法重新開賽。');
  validateEntrants(tournament.participants);
  const rounds=tournament.format==='swiss'?[createSwissRound(tournament.participants,[],random)]:createBracket(tournament.participants,random);
  return {...tournament,rounds,status:'running',champion:''};
}
export function publicTournamentSnapshot(tournament){
  const nicknames=Object.fromEntries(tournament.participants.map(p=>[p.uid,p.nickname]));
  const nameFor=uid=>uid?nicknames[uid]||'未知玩家':'';
  return {
    title:tournament.title,description:tournament.description||'',hostName:tournament.hostName||'賽事房主',
    status:tournament.status,public:true,
    ...(tournament.format?{format:tournament.format}:{}),
    participants:tournament.participants.map(p=>({name:p.nickname})),
    rounds:serializeTournamentRounds(deserializeTournamentRounds(tournament.rounds)
      .map(round=>round.map(m=>({a:nameFor(m.a),b:nameFor(m.b),winner:nameFor(m.winner),bye:!!m.bye})))),
    champion:nameFor(tournament.champion),
    ...(tournament.eventAt?{eventAt:tournament.eventAt}:{})
  };
}


/** A registration can be empty or contain only one player, unlike a started bracket. */
function validateEntrantsForRegistration(entrants){
  if(entrants.length>TOURNAMENT_MAX_PLAYERS)throw new Error('本賽事人數已達上限。');
  if(entrants.some(p=>typeof p.uid!=='string'||!p.uid||p.uid.length>128||typeof p.nickname!=='string'||!p.nickname.trim()||p.nickname.length>24))
    throw new Error('請輸入 1–24 字元的有效參賽者名稱。');
  if(!unique(entrants.map(p=>p.uid)))throw new Error('這位玩家已在名單中。');
  if(!unique(entrants.map(p=>p.nickname.trim().toLocaleLowerCase())))
    throw new Error('名單中已有同名玩家，請使用不同暱稱。');
}
export function isTournamentGuest(uid){return typeof uid==='string'&&uid.startsWith('guest_');}
export function addTournamentGuest(tournament,nickname,guestUid){
  if(tournament.status!=='registration')throw new Error('賽事已開始，無法加入訪客。');
  const name=String(nickname||'').trim();
  if(!/^guest_[A-Za-z0-9_-]{12,64}$/.test(guestUid||''))throw new Error('訪客識別碼無效。');
  const participants=[...tournament.participants,{uid:guestUid,nickname:name,guest:true}];
  validateEntrantsForRegistration(participants);
  return {...tournament,participants};
}
/** Auto-size Swiss rounds: 2–32 players require 1–5 rounds. */
export function swissRoundLimit(count){
  return Math.max(1,Math.min(5,Math.ceil(Math.log2(Math.max(2,count)))));
}
/** Win/bye=1 point. Buchholz is the sum of opponents' current points.
 * Remaining ties are resolved by wins and initial entrant order (stable).
 * Standings are projections of results, not user-editable stored scores. */
export function swissStandings(tournament){
  const entrants=(tournament?.participants||[]).map((p,seed)=>({
    uid:p.uid,nickname:p.nickname,guest:!!p.guest,seed,points:0,wins:0,losses:0,byes:0,
    opponents:[],buchholz:0
  }));
  const byId=new Map(entrants.map(p=>[p.uid,p]));
  for(const round of deserializeTournamentRounds(tournament?.rounds)){
    for(const m of round){
      if(!m?.winner)continue;
      const a=byId.get(m.a),b=byId.get(m.b);
      if(m.bye && a && !b && m.winner===m.a){a.points++;a.byes++;continue;}
      if(!a||!b||![m.a,m.b].includes(m.winner))continue;
      a.opponents.push(b.uid);b.opponents.push(a.uid);
      const w=m.winner===m.a?a:b,l=m.winner===m.a?b:a;
      w.points++;w.wins++;l.losses++;
    }
  }
  for(const p of entrants)p.buchholz=p.opponents.reduce((total,uid)=>total+(byId.get(uid)?.points||0),0);
  return entrants.sort((a,b)=>b.points-a.points||b.buchholz-a.buchholz||b.wins-a.wins||a.seed-b.seed)
    .map((p,i)=>({...p,rank:i+1}));
}
/** Pair near-equal scores without repeating opponents whenever possible.
 * If no complete non-rematch matching exists, only then permit rematches. */
export function createSwissRound(participants,history=[],random=Math.random){
  validateEntrants(participants);
  const previous=deserializeTournamentRounds(history);
  const seed=participants.map(p=>p.uid);
  if(!previous.length){
    for(let i=seed.length-1;i>0;i--){
      const j=Math.floor(random()*(i+1));[seed[i],seed[j]]=[seed[j],seed[i]];
    }
  }else{
    const ranks=swissStandings({participants,rounds:previous});
    seed.splice(0,seed.length,...ranks.map(x=>x.uid));
  }
  const ranks=swissStandings({participants,rounds:previous});
  const scores=new Map(ranks.map(p=>[p.uid,p.points]));
  const opponents=new Set();
  const priorByes=new Set();
  for(const round of previous)for(const m of round){
    if(m.bye && m.winner)priorByes.add(m.a);
    else if(m.a&&m.b)opponents.add([m.a,m.b].sort().join('|'));
  }
  let bye='';
  if(seed.length%2){
    const candidates=[...seed].reverse();
    bye=candidates.find(uid=>!priorByes.has(uid))||candidates[0];
    seed.splice(seed.indexOf(bye),1);
  }
  const paired=(remaining,allowRepeat)=>{
    if(!remaining.length)return [];
    const [first,...rest]=remaining;
    const options=[...rest].sort((a,b)=>{
      const repeatA=opponents.has([first,a].sort().join('|'))?1:0;
      const repeatB=opponents.has([first,b].sort().join('|'))?1:0;
      return (repeatA-repeatB)*1000+
        (Math.abs(scores.get(first)-scores.get(a))-Math.abs(scores.get(first)-scores.get(b)))*100+
        (seed.indexOf(a)-seed.indexOf(b));
    });
    for(const other of options){
      if(!allowRepeat&&opponents.has([first,other].sort().join('|')))continue;
      const next=paired(rest.filter(uid=>uid!==other),allowRepeat);
      if(next)return [[first,other],...next];
    }
    return null;
  };
  const pairs=paired(seed,false)||paired(seed,true);
  if(!pairs)throw new Error('無法產生瑞士制對戰配對。');
  return [...pairs.map(([a,b])=>({a,b,winner:'',bye:false})),
    ...(bye?[{a:bye,b:'',winner:bye,bye:true}]:[])];
}
