// UA Arena progression v2.8: computed from valid match outcomes, not timestamps.
export const XP_FOR_WIN=100;
export const XP_FOR_LOSS=40;
export const STREAK_FRAME_TIERS=[
  {id:'bronze',threshold:2,label:'銅色連勝框'},
  {id:'silver',threshold:5,label:'銀色連勝框'},
  {id:'gold',threshold:10,label:'金色連勝框'},
  {id:'prismatic',threshold:20,label:'彩色連勝框'}
];
export const LEVEL_FRAME_THRESHOLDS=[100,200,300,400,500];
export const xpNeededForNextLevel=level=>100+20*(Math.max(1,Math.floor(level))-1);
export function levelFromExperience(value=0) {
  const totalXp=Math.max(0,Math.floor(Number(value)||0));
  let level=1,rest=totalXp;
  while(level<10000&&rest>=xpNeededForNextLevel(level)){
    rest-=xpNeededForNextLevel(level);level++;
  }
  const required=xpNeededForNextLevel(level);
  return {level,totalXp,intoLevel:rest,nextLevelXp:required,remainingXp:required-rest,
    progress:Math.round(rest/required*100)};
}
export function progressionFromMatches(uid,groupMatches={}){
  let wins=0,losses=0;
  for(const matches of Object.values(groupMatches||{})){
    for(const match of matches||[]){
      if(!match||match.status!=='active'||![match.playerA,match.playerB].includes(uid)
         ||![match.playerA,match.playerB].includes(match.winner))continue;
      if(match.winner===uid)wins++;
      else losses++;
    }
  }
  return {wins,losses,...levelFromExperience(wins*XP_FOR_WIN+losses*XP_FOR_LOSS)};
}
export function highestStreakAcrossGroups(uid,groupMatches={},streakCalculator){
  let best=0;
  for(const matches of Object.values(groupMatches||{}))
    best=Math.max(best,Number(streakCalculator(uid,matches||[]).best)||0);
  return best;
}
export function unlockedStreakFrames(best=0){
  return STREAK_FRAME_TIERS.filter(f=>(Number(best)||0)>=f.threshold).map(f=>f.id);
}
export function levelFrameFor(level){
  const l=Number(level)||1;
  return LEVEL_FRAME_THRESHOLDS.filter(v=>l>=v).at(-1)||0;
}
export function validFrameChoice(choice,best){
  return choice==='none'||unlockedStreakFrames(best).includes(choice);
}
