import { firebaseConfig, aiSettings } from './firebase-config.js';
import {chooseAvatarCrop} from './avatar-crop-ui.mjs?v=1.8';
import { COLORS, colorOf, safeText as e, shortId, formatDate, assertMatch, computeStats, aggregatePersonalStats, aggregateDeckWinRates, filterMatches, filteredMatchStats, matchTimeMs, matchDateValue, parsePlayedAt, topDecksByWinRate, playerWinStreak, streakTier, resolvePlayerDeckSelection, GUEST_PLAYER_ID, GUEST_DECK_ID, guestPlayer, personalGroupId, isGuestMatch, guestDeckLabel } from './core.mjs?v=1.9';
import { demoAdapter } from './demo-adapter.js';
import { QUICK_MATCH_LIMIT_MS, quickClock, mmss } from './quick-core.mjs';

const $=q=>document.querySelector(q);
const safeStoreGet=k=>{try{return localStorage.getItem(k)}catch{return null}};
const safeStoreSet=(k,v)=>{try{localStorage.setItem(k,v)}catch{}};
const app=$('#app');
const configured=Boolean(firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.appId);
const params=new URLSearchParams(location.search);
let adapter=null, unsub=()=>{}, historyUnsub=()=>{}, tournamentRequestUnsub=()=>{}, toastTimer;
const state={user:null,profile:{},personalHistory:{},historyReady:false,myCard:null,playerCard:null,groupDetails:{},tournaments:[],tournamentRequests:[],myTournamentRequest:false,tournamentId:'',publicTournament:null,publicWatchError:'',groupId:'',groupIds:[],group:null,players:[],decks:[],matches:[],tab:'overview',modal:null,draft:{},filter:'ALL',playerFilter:'',matchFrom:'',matchTo:'',inviteId:params.get('join')||'',authMode:'login',preview:false,rulesReply:'',rulesQuestion:'',rulesEdition:'繁體中文版',busy:false,quickMatches:[],quickSessionId:'',quickCreate:true,quickDraft:{},quickPending:null,quickResultOpen:false};
const player=id=>state.players.find(x=>x.id===id);
const playerName=id=>player(id)?.nickname||'未知玩家';
const deck=id=>state.decks.find(x=>x.id===id);
const deckName=id=>deck(id)?.name||'已封存牌組';
const battleDeckName=(m,side)=>guestDeckLabel(m,side)||deckName(m[side==='A'?'deckA':'deckB']);
const icon={overview:'◈',matches:'⚔',decks:'▤',players:'♟',rules:'✦',quick:'⏱',tournaments:'🏆',groups:'⇄',profile:'◉',more:'☰'};
const pathIcon=(i)=>icon[i]||'◈';
const getStats=()=>computeStats(state.players,state.decks,state.matches);
const ownStats=()=>aggregatePersonalStats(state.user?.uid||'',state.personalHistory);
const isOwner=()=>state.group?.createdBy===state.user?.uid;
const isPersonal=()=>state.groupId===personalGroupId(state.user?.uid||'');
const guardedImage=src=>typeof src==='string' && /^data:image\/(webp|jpeg);base64,[A-Za-z0-9+/=]+$/.test(src) ? src : '';
// Player portraits are stored as compact JPEG data on the player's group-member
// document; keep the initial placeholder until an upload is available.
const guardedAvatar=src=>typeof src==='string'&&src.length<=40000&&/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(src)?src:'';
function playerAvatar(uid,extra='',forcedTier=undefined) {
  const p=player(uid),label=uid===state.user?.uid?userLabel():p?.nickname||'玩家';
  const src=guardedAvatar(uid===state.user?.uid?(state.profile?.avatarData||p?.avatarData):p?.avatarData);
  // The frame is decorative; only the user's profile contains tier explanations.
  const tier=forcedTier===undefined?(uid&&uid!==GUEST_PLAYER_ID?streakTier(playerWinStreak(uid,state.matches).current):null):forcedTier;
  const frame=['bronze','silver','gold','prismatic'].includes(tier)?tier:null;
  return `<span class="avatar-shell${extra?' '+extra:''}${frame?' is-framed':''}">
    <span class="avatar">${src?`<img src="${src}" alt="${e(label)} 的頭像" decoding="async" loading="lazy">`:e((label[0]||'?').toUpperCase())}</span>
    ${frame?`<img class="avatar-frame-decoration" src="./assets/streak-${frame}.svg" alt="" aria-hidden="true" loading="lazy" decoding="async">`:''}
  </span>`;
}

/** Reuse existing personal/legacy deck images without re-encoding them.
 * Match both deck ID and participant UID so similarly named decks stay distinct.
 * Empty or missing images use the same neutral placeholder on all devices. */
function deckArtwork(ownerUid,deckId,label,sizeClass='') {
  const owned=state.decks.find(d=>d.id===deckId&&d.ownerUid===ownerUid);
  const src=guardedImage(owned?.imageData);
  const classes=sizeClass?' '+sizeClass:'';
  return `<div class="deck-art-frame${classes}">${src
    ?`<img src="${src}" alt="${e(label||owned.name)} 牌組圖片" loading="lazy" decoding="async">`
    :'<span class="deck-art-missing" aria-label="尚未上傳牌組圖片">▧<small>尚無圖片</small></span>'}</div>`;
}
function battleDeckArtwork(match,side) {
  return deckArtwork(match[side==='A'?'playerA':'playerB'],match[side==='A'?'deckA':'deckB'],battleDeckName(match,side),'deck-art-battle');
}
const userLabel=()=>state.profile?.nickname||player(state.user?.uid)?.nickname||state.user?.displayName||state.user?.email?.split('@')[0]||'玩家';
const escapeAttr=e;
const n=(x)=>Number(x||0).toLocaleString('zh-TW');
const percent=x=>`${x}%`;
function toast(message,error=false){const t=$('#toast');t.textContent=message;t.className=`toast show${error?' error':''}`;clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.className='toast',3500)}
function readableError(err){
  const msg=String(err?.message||err||'未知錯誤');
  if(msg.includes('permission-denied')||msg.includes('Missing or insufficient permissions'))return '資料存取被拒絕。請檢查 Firestore 規則、群組權限與使用者身分。';
  if(msg.includes('auth/invalid-credential'))return 'Email 或密碼不正確。';
  if(msg.includes('auth/email-already-in-use'))return 'Email 已被註冊，請直接登入。';
  if(msg.includes('auth/weak-password'))return '密碼強度不足，請使用至少 6 字元。';
  if(msg.includes('auth/unauthorized-domain'))return '尚未將 GitHub Pages 網域加入 Firebase Authentication 的 Authorized domains。';
  return msg.length>200?`${msg.slice(0,200)}…`:msg;
}
async function runBusy(fn){if(state.busy)return;state.busy=true;document.querySelectorAll('button[type="submit"]').forEach(x=>x.disabled=true);try{await fn()}catch(error){console.error(error);toast(readableError(error),true)}finally{state.busy=false;document.querySelectorAll('button[type="submit"]').forEach(x=>x.disabled=false)}}
function authPage(){
  app.innerHTML=`<div class="auth-screen"><section class="auth-side"><div class="logo" style="margin:0;padding:0"><span class="logo-icon">UA</span> UA <span class="arena">ARENA</span></div><h1>每一場對決<br>都有<span>紀錄。</span></h1><p>專為 UNION ARENA 玩家打造。統一管理牌組、對戰勝負、玩家勝率，讓每一場精彩對戰都有跡可循。</p><div style="margin-top:40px;color:#8eb7a7;font-size:11px;letter-spacing:.15em">TRACK YOUR GAME. OWN YOUR ARENA.</div></section><section class="auth-panel"><div class="auth-form"><div class="label-up">WELCOME TO THE ARENA</div><h2 style="margin-top:13px">${!configured?'先體驗網站':state.authMode==='login'?'登入帳號':'建立新帳號'}</h2><p>${!configured?'目前是展示模式。連接 Firebase 後就能開放朋友註冊並共用資料。':state.authMode==='login'?'使用帳號登入，繼續你的 UA 對戰之旅。':'建立帳號後即可建立自己的對戰群組。'}</p>${!configured ? `<div class="setup-banner">尚未填入 Firebase 設定。展示模式資料只存在目前瀏覽器，不會與朋友同步。請閱讀 README.md 完成正式部署。</div><button class="btn btn-primary btn-full" data-action="start-demo">進入可操作展示 <span>↗</span></button>`:
    `<form data-form="auth">${state.authMode==='register'?`<div class="field"><label>玩家暱稱</label><input name="nickname" autocomplete="nickname" required minlength="2" maxlength="30" placeholder="例如：Samuel" /></div>`:''}<div class="field"><label>Email</label><input name="email" type="email" required autocomplete="email" placeholder="you@example.com" /></div><div class="field"><label>密碼</label><input name="password" type="password" minlength="6" required autocomplete="${state.authMode==='register'?'new-password':'current-password'}" placeholder="至少 6 個字元" /></div><button class="btn btn-primary btn-full" type="submit">${state.authMode==='login'?'登入':'註冊並登入'} →</button></form><button class="btn btn-ghost btn-full" style="margin-top:12px" data-action="google-login">使用 Google 帳號登入</button><div class="auth-alt">${state.authMode==='login'?'還沒有帳號？':'已經有帳號？'} <button data-action="toggle-auth">${state.authMode==='login'?'建立帳號':'返回登入'}</button></div>`}
  <div class="copyright">非 UNION ARENA / BANDAI 官方服務。</div></div></section></div>`;
}
function setupPage(){
  const names=state.groupIds.map(id=>`<option value="${e(id)}">${e(state.groupDetails[id]||id)}</option>`).join('');
  app.innerHTML=`<div class="auth-screen"><section class="auth-side"><div class="logo" style="margin:0;padding:0"><span class="logo-icon">UA</span> UA <span class="arena">ARENA</span></div><h1>一起記錄<br><span>每場勝負。</span></h1><p>建立專屬的朋友對戰團，或使用朋友傳來的邀請代碼加入，一起累積戰績。</p></section><section class="auth-panel"><div class="auth-form"><div class="label-up">YOUR PLAY GROUP</div><h2 style="margin-top:14px">建立或加入對戰團</h2><p>帳號：${e(state.user?.email||'展示使用者')}</p>${state.groupIds.length?`<div class="field"><label>切換現有群組</label><select id="group-select"><option value="">請選擇群組</option>${names}</select></div><button class="btn btn-ghost btn-full" data-action="select-existing-group">進入現有群組</button><div class="divider"></div>`:''}<form data-form="create-group"><div class="field"><label>你的暱稱</label><input name="nickname" required maxlength="24" value="${escapeAttr(state.user?.displayName||'')}" placeholder="其他人會看到這個名字" /></div><div class="field"><label>群組名稱</label><input name="name" required minlength="2" maxlength="40" placeholder="例如：週五 UA 對戰團" /></div><button class="btn btn-primary btn-full" type="submit">建立我的對戰團 →</button></form><div class="divider"></div><form data-form="join-group"><div class="field"><label>朋友分享的群組代碼</label><input name="code" required value="${e(state.inviteId)}" placeholder="貼上邀請代碼" /></div><div class="field"><label>你的玩家暱稱</label><input name="nickname" required maxlength="24" value="${escapeAttr(state.user?.displayName||'')}" placeholder="例如：Samuel" /></div><button class="btn btn-ghost btn-full" type="submit">加入朋友的對戰團</button></form><button class="btn btn-ghost btn-full" style="margin-top:16px" data-action="logout">登出</button></div></section></div>`;
}
const menu=[['overview','總覽'],['quick','Quick Match'],['matches','戰績紀錄'],['decks','我的牌組'],['players','玩家排行'],['tournaments','錦標賽'],['groups','我的對戰團'],['profile','個人資料'],['rules','規則 AI']];
const mobileMenu=['overview','quick','tournaments','matches','decks'];
function shell(content){
  app.innerHTML=`<div class="shell"><aside class="sidebar"><div class="logo"><span class="logo-icon">UA</span><span>UA <span class="arena">ARENA</span></span></div><div class="nav-group">MAIN MENU</div>${menu.map(([id,title])=>`<button class="nav ${state.tab===id?'active':''}" data-tab="${id}"><span class="ico">${pathIcon(id)}</span>${title}</button>`).join('')}<div class="sidebar-bottom"><button class="nav" data-action="share-invite"><span class="ico">↗</span>邀請朋友</button><button class="nav" data-tab="groups"><span class="ico">⇄</span>切換群組</button><button class="nav" data-tab="profile"><span class="ico">◉</span>個人資料</button><button class="nav" data-action="logout"><span class="ico">⇥</span>登出</button><button class="profile profile-button" data-tab="profile" aria-label="查看個人資料">${playerAvatar(state.user?.uid)}<div class="who"><b>${e(userLabel())}</b><small>${e(state.user?.email||'本機展示模式')}</small></div></button></div></aside><main class="main"><div class="topbar"><div class="mobile-head">UA <span>ARENA</span></div><div class="top-label"><span class="label-up">YOUR BATTLESPACE</span></div><div class="top-actions"><button class="group-pill" data-tab="groups">⌘ ${e(state.group?.name||'對戰團')} ▾</button>${adapter?.mode==='demo'?'<span class="tag">DEMO</span>':''}<button class="circle-action" data-action="share-invite" title="分享群組連結">↗</button></div></div>${adapter?.mode==='demo'?'<div class="setup-banner" style="margin-top:16px">展示模式：資料只保存在此瀏覽器。如需多人登入共用，請依 README 連接 Firebase。</div>':''}<div class="page">${content}<div class="copyright">UA ARENA · Community battle tracker · 非 BANDAI 官方網站</div></div></main><nav class="mobile-nav">${mobileMenu.map(id=>`<button data-tab="${id}" class="${state.tab===id?'active':''}"><span class="icon">${pathIcon(id)}</span>${({overview:'總覽',quick:'速配',tournaments:'賽事',matches:'戰績',decks:'牌組'})[id]}</button>`).join('')}<button data-action="more-menu" class="${['profile','groups','players','rules'].includes(state.tab)?'active':''}"><span class="icon">☰</span>更多</button></nav></div>${renderModal()}`;
}
function overviewPage(){
  const s=getStats(),me=s.players.find(x=>x.id===state.user?.uid)||{games:0,wins:0,rate:0,favorite:null};
  return `<div class="page-head"><div><div class="label-up">DASHBOARD / OVERVIEW</div><h1 style="margin-top:7px">歡迎回到競技場，${e(userLabel())}。</h1><p>你的每一次對決，都在這裡留下足跡。</p></div><button class="btn btn-primary" data-action="new-match">＋ 登錄對戰</button></div><section class="hero"><div class="hero-content"><div class="eyebrow">YOUR NEXT MATCH STARTS HERE</div><h2>下一場，誰會拿下勝利？</h2><p>不論是你自己參戰，還是幫朋友代填，都能快速登錄兩位玩家的對戰結果。</p><button class="btn btn-primary btn-sm" data-action="open-quick">⏱ Quick Match</button></div></section><div class="metrics"><div class="metric"><div class="metric-label">團隊累積對戰</div><div class="metric-num">${n(s.totalMatches)}</div><div class="metric-foot">ALL MATCHES</div></div><div class="metric"><div class="metric-label">我的勝率</div><div class="metric-num mint">${percent(me.rate)}</div><div class="metric-foot">PERSONAL WIN RATE</div></div><div class="metric"><div class="metric-label">我的勝場</div><div class="metric-num purple">${n(me.wins)}</div><div class="metric-foot">VICTORIES</div></div><div class="metric"><div class="metric-label">牌組收藏數</div><div class="metric-num gold">${n(state.decks.filter(x=>x.active!==false&&x.ownerUid===state.user?.uid).length)}</div><div class="metric-foot">ALL ACTIVE DECKS</div></div></div><div class="two-col"><section class="card"><div class="section-head"><h3>⚔ 最近對戰</h3><button class="text-link" data-tab="matches">查看全部 →</button></div>${recentList(s.activeMatches.slice().sort((a,b)=>matchTimeMs(b)-matchTimeMs(a)).slice(0,6))}</section><section class="card"><div class="section-head"><h3>♛ 勝場排行榜</h3><button class="text-link" data-tab="players">完整排行 →</button></div>${leaderRows(s.leaderboard.slice(0,5))}</section></div>`;
}
function dateNum(d){return d?.seconds?d.seconds*1000:(d?.toDate?.()?.getTime?.()||new Date(d||0).getTime()||0)}
function localDateTimeValue(ms=Date.now()){
 const d=new Date(ms),pad=n=>String(n).padStart(2,'0');
 return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function matchDateLabel(m){const ms=matchTimeMs(m);return ms?new Date(ms).toLocaleString('zh-TW',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}):'—'}
function personalDeckStats(){return aggregateDeckWinRates(state.user?.uid||'',state.personalHistory,state.decks)}
function deckRateInGroup(uid,deckId){return getStats().players.find(p=>p.id===uid)?.deckStats.find(x=>x.id===deckId)||{games:0,wins:0,losses:0,rate:0}}

function recentList(matches){
 if(!matches.length)return `<div class="empty"><span class="empty-icon">⚔</span><h3>還沒有對戰紀錄</h3><p>先記錄第一場，讓戰績開始累積。</p><button class="btn btn-primary btn-sm" data-action="new-match">登錄第一場</button></div>`;
 return matches.map(m=>`<button type="button" class="match-row match-preview" data-action="match-detail" data-id="${e(m.id)}"><div class="match-icon">⚔</div><div class="match-pair"><strong>${e(playerName(m.playerA))} <span class="muted">vs</span> ${e(playerName(m.playerB))}</strong><small>${e(matchDateLabel(m))} · 點擊查看完整資訊</small></div><span class="win-badge">🏆 ${e(playerName(m.winner))}</span></button>`).join('');
}
function leaderRows(players){if(!players.length)return `<div class="empty">尚無玩家</div>`;return players.map((p,i)=>`<button class="leaderboard-item" style="width:100%;border-left:0;border-right:0;border-top:0;background:transparent;color:inherit;text-align:left" data-action="player-detail" data-id="${e(p.id)}"><span class="rank">${String(i+1).padStart(2,'0')}</span>${playerAvatar(p.id,'avatar-small')}<span class="name">${e(p.nickname)} <small>· ${n(p.games)} 場</small></span><span class="pct">${p.wins} 勝</span></button>`).join('')}
function matchesPage(){
 const all=filterMatches(state.matches,{playerId:state.playerFilter,from:state.matchFrom,to:state.matchTo});
 const stats=filteredMatchStats(all,state.playerFilter);
 const summary=state.playerFilter
   ? `<span><b>${stats.games}</b> 場</span><span><b>${stats.wins}</b> 勝</span><span><b>${stats.losses}</b> 敗</span><span><b>${stats.rate}%</b> 勝率</span>`
   : `<span><b>${stats.games}</b> 場有效</span><span><b>${stats.uniquePlayers}</b> 位玩家</span><span><b>${stats.voided}</b> 場已撤銷</span>`;
 const rateTags=!state.playerFilter?computeStats(state.players,state.decks,all).players.filter(p=>p.games>0).sort((a,b)=>b.games-a.games).slice(0,10).map(p=>`<span class="person-rate">${e(p.nickname)} <b>${p.rate}%</b> 勝率</span>`).join(''):'';
 const rows=all.map(m=>`<article class="history-item ${m.status==='void'?'is-void':''}">
   <div class="history-main"><span class="history-date">${e(matchDateLabel(m))}</span><strong>${e(playerName(m.playerA))} <span class="muted">vs</span> ${e(playerName(m.playerB))}</strong><small>${m.status==='void'?'已撤銷':`🏆 ${e(playerName(m.winner))} 勝`}</small></div>
   <button class="btn btn-outline btn-sm" type="button" data-action="match-detail" data-id="${e(m.id)}">查看詳情</button></article>`).join('');
 return `<div class="page-head"><div><div class="label-up">MATCH HISTORY / BATTLE LOG</div><h1>對戰紀錄</h1><p>按玩家及對戰日期篩選；詳細牌組、計時與備註集中在單場詳情。</p></div><button class="btn btn-primary" data-action="new-match">＋ 新增戰績</button></div>
 <section class="card history-filter"><div class="history-filters">
   <label>玩家<select id="match-filter"><option value="">全部玩家</option>${state.players.map(p=>`<option value="${e(p.id)}" ${state.playerFilter===p.id?'selected':''}>${e(p.nickname)}</option>`).join('')}</select></label>
   <label>開始日期<input type="date" id="match-from" value="${e(state.matchFrom)}"></label>
   <label>結束日期<input type="date" id="match-to" value="${e(state.matchTo)}"></label>
   <button class="btn btn-ghost btn-sm" data-action="clear-match-filters">清除篩選</button>
 </div><div class="history-stats">${summary}${rateTags}</div></section>
 <section class="card history-results">${rows||'<div class="empty">此篩選條件沒有對戰紀錄。</div>'}</section>`;
}
function matchDetailBody(){
 const m=state.matches.find(x=>x.id===state.draft.id);
 if(!m)return '<div class="empty">找不到這場紀錄。</div>';
 const q=m.quickMatchId?state.quickMatches.find(x=>x.id===m.quickMatchId):null;
 const allowed=m.status==='active'&&(m.recordedBy===state.user?.uid||m.playerA===state.user?.uid||m.playerB===state.user?.uid||isOwner());
 const turns=q?.turns||[];
 return `<div class="match-detail-header"><span class="tag">${m.status==='void'?'已撤銷':'有效對戰'}</span><strong>🏆 ${e(playerName(m.winner))} 勝</strong></div>
 <div class="detail-participants"><div class="detail-side">${battleDeckArtwork(m,'A')}<div class="detail-side-info"><div class="detail-side-user">${playerAvatar(m.playerA,'avatar-match')}<strong>${e(playerName(m.playerA))}</strong></div><span class="detail-side-deck">${e(battleDeckName(m,'A'))}</span><span class="detail-side-result">${m.winner===m.playerA?'🏆 本場勝利':'本場敗北'}</span></div></div><b>VS</b><div class="detail-side">${battleDeckArtwork(m,'B')}<div class="detail-side-info"><div class="detail-side-user">${playerAvatar(m.playerB,'avatar-match')}<strong>${e(playerName(m.playerB))}</strong></div><span class="detail-side-deck">${e(battleDeckName(m,'B'))}</span><span class="detail-side-result">${m.winner===m.playerB?'🏆 本場勝利':'本場敗北'}</span></div></div></div>
 <div class="detail-facts"><div><span>實際對戰時間</span><b>${e(matchDateLabel(m))}</b></div><div><span>登錄時間</span><b>${e(formatDate(m.createdAt))}</b></div><div><span>登錄人</span><b>${e(playerName(m.recordedBy))}</b></div><div><span>備註</span><b>${e(m.note||'無')}</b></div></div>
 ${m.timing?.enabled?`<div class="detail-timing"><h3>⏱ 30 分鐘計時紀錄</h3><div class="history-stats"><span><b>${mmss(m.timing.playerAMs)}</b> ${e(playerName(m.playerA))}</span><span><b>${mmss(m.timing.playerBMs)}</b> ${e(playerName(m.playerB))}</span><span><b>${mmss(m.timing.unattributedMs)}</b> 間隔</span></div>
 ${turns.length?`<div class="table-wrap"><table class="table"><thead><tr><th>回合</th><th>玩家</th><th>時間</th></tr></thead><tbody>${turns.map((t,i)=>`<tr><td>${i+1}</td><td>${e(playerName(t.playerId))}</td><td>${mmss(t.durationMs)}</td></tr>`).join('')}</tbody></table></div>`:'<p class="muted sm">沒有保存逐回合明細。</p>'}</div>`:''}
 ${allowed?`<button type="button" class="btn btn-danger btn-full" data-action="void-match" data-id="${e(m.id)}" style="margin-top:20px">撤銷這場戰績（雙方皆可）</button>`:''}`;
}
function decksPage(){
  const filtered=state.decks.filter(d=>d.ownerUid===state.user?.uid&&d.active!==false&&(state.filter==='ALL'||d.color===state.filter));
  return `<div class="page-head"><div><div class="label-up">ACCOUNT DECK LIBRARY / PERSONAL</div><h1 style="margin-top:7px">牌組收藏</h1><p>你建立的牌組跟著帳號，加入新戰團後直接共用，不必重新上傳。</p></div><button class="btn btn-primary" data-action="new-deck">＋ 新增牌組</button></div><div class="filter-row"><button class="tab-chip ${state.filter==='ALL'?'active':''}" data-color-filter="ALL">全部 · ${state.decks.filter(x=>x.active!==false&&x.ownerUid===state.user?.uid).length}</button>${COLORS.map(c=>`<button class="tab-chip ${state.filter===c.id?'active':''}" data-color-filter="${c.id}"><span class="dot" style="background:${c.hex};margin-right:5px"></span>${c.name}</button>`).join('')}</div><div class="deck-grid">${filtered.length?filtered.map(deckCard).join(''):`<div class="empty" style="grid-column:1/-1"><span class="empty-icon">▤</span><h3>還沒有牌組</h3><p>新增圖片、名稱與顏色，建立你的第一副牌組。</p><button class="btn btn-primary btn-sm" data-action="new-deck">新增牌組</button></div>`}</div>`;
}
function deckCard(d){const cover=guardedImage(d.imageData),canEdit=d.ownerUid===state.user?.uid&&!d.legacy;const dr=personalDeckStats().find(x=>x.id===d.id)||{games:0,wins:0,rate:0};return `<article class="deck-card"><div class="deck-cover">${cover?`<img src="${cover}" alt="${e(d.name)} 封面">`:'<span class="deck-placeholder">UA</span>'}<span class="deck-color"><span class="dot" style="background:${colorOf(d.color).hex}"></span> ${e(colorOf(d.color).name)}</span></div><div class="deck-info"><h3>${e(d.name)}</h3><p>持有者：${e(playerName(d.ownerUid))}</p><div class="deck-winrate"><strong>${dr.rate}% 勝率</strong><span>${dr.games} 場 · ${dr.wins} 勝</span></div><div class="deck-actions">${canEdit?`<button class="btn btn-ghost btn-sm" data-action="edit-deck" data-id="${e(d.id)}">編輯</button><button class="btn btn-ghost btn-sm" data-action="archive-deck" data-id="${e(d.id)}">封存</button>`:d.legacy&&d.ownerUid===state.user?.uid?'<span class="tag">舊牌組搬移中</span>':'<span class="tag">朋友的牌組</span>'}</div></div></article>`}
function playersPage(){
  const s=getStats();const ranked=[...s.players].sort((a,b)=>b.rate-a.rate||b.wins-a.wins);
  return `<div class="page-head"><div><div class="label-up">PLAYERS / LEADERBOARD</div><h1 style="margin-top:7px">玩家戰績榜</h1><p>勝率、常用牌組與對戰成績，所有成員都能查看。</p></div><button class="btn btn-ghost" data-action="share-invite">↗ 邀請朋友加入</button></div><div class="player-grid">${ranked.map(p=>`<button class="player-card" data-action="player-detail" data-id="${e(p.id)}" style="text-align:left;color:inherit"><div class="player-line">${playerAvatar(p.id)}<div><strong>${e(p.nickname)}</strong><p class="muted sm">${p.id===state.user?.uid?'你自己':p.role==='owner'?'群組建立者':'對戰成員'}</p></div></div><div class="big-rate">${p.rate}% <span class="muted sm">WIN RATE</span></div><div class="bar-track"><div class="bar-fill" style="width:${p.rate}%"></div></div><div class="row-stats" style="margin-top:15px"><span><b>${p.games}</b> 場</span><span><b>${p.wins}</b> 勝</span><span><b>${p.losses}</b> 敗</span><span>${e(p.favorite?.name||'尚無牌組')}</span></div></button>`).join('')||'<div class="empty">尚無玩家</div>'}</div>`;
}
function rulesPage(){
  return `<div class="page-head"><div><div class="label-up">RULE ENGINE / AI ASSISTANT</div><h1 style="margin-top:7px">UA 規則助手</h1><p>只討論 UNION ARENA。請明確提供卡號、版本與完整效果文字，判斷會更準確。</p></div></div><div class="two-col"><section class="card"><div class="section-head"><h3>✦ 問 Gemini 一個規則問題</h3><span class="tag">${adapter?.aiEnabled?'AI 已啟用':'需要啟用 AI'}</span></div><div class="alert">AI 答覆不是官方裁定。系統已設定 UA 專屬提示，但目前未建立官方 FAQ 檢索資料庫；有爭議時仍應以適用版本的官方規則為準。</div><form data-form="ask-rule" style="margin-top:20px"><div class="field"><label>適用卡牌版本</label><select name="edition">${['繁體中文版','日文版','英文版','簡體中文版','混合版本'].map(v=>`<option ${state.rulesEdition===v?'selected':''}>${v}</option>`).join('')}</select></div><div class="field" style="margin-top:16px"><label>你的問題</label><textarea name="question" required minlength="6" maxlength="900" placeholder="例如：對手回合能否使用起動主要？如果涉及特定卡片，請提供卡號與效果文字。">${e(state.rulesQuestion)}</textarea></div><button class="btn btn-primary" type="submit" style="margin-top:14px" ${adapter?.aiEnabled?'':'disabled'}>✦ 送出問題</button></form>${state.rulesReply?`<div class="ai-results">${e(state.rulesReply)}</div>`:''}${!adapter?.aiEnabled?'<div class="hint" style="margin-top:12px">請依 README 啟用 Firebase AI Logic 並設定 App Check，按鈕才會生效；不可直接把 Gemini API Key 寫在公開的 GitHub Pages 原始碼中。</div>':''}</section><aside class="card"><h3>官方規則參考</h3><p class="muted sm" style="margin-top:10px">混合版本不代表所有語系的規則自動一致。遇到牌組與卡牌效果問題，請先指定版本。</p><div class="divider"></div><div class="source-links" style="flex-direction:column"><a target="_blank" rel="noopener noreferrer" href="https://www.unionarena-tcg.com/tc/rules/">↗ UA 繁體中文官方規則</a><a target="_blank" rel="noopener noreferrer" href="https://www.unionarena-tcg.com/na/faq/">↗ UA 英文版官方 FAQ</a><a target="_blank" rel="noopener noreferrer" href="https://www.unionarena-tcg.com/jp/">↗ UA 日文官方網站</a></div></aside></div>`;
}
function pickerOptions(players,selected,exclude='',allowGuest=false){return players.filter(p=>p.id!==exclude && (allowGuest||p.id!==GUEST_PLAYER_ID)).map(p=>`<option value="${e(p.id)}" ${selected===p.id?'selected':''}>${e(p.nickname)}</option>`).join('')}
function guestDefault(){return {name:'',color:'OTHER'}};
function deckInputFor(playerId,side,chosen,guestDeck,quick=false){
  if(playerId===GUEST_PLAYER_ID)return `<div class="field"><label>訪客玩家使用牌組</label><input name="guestDeckName" maxlength="42" required value="${e(guestDeck?.name||'')}" placeholder="例如：紫色魯夫（本場限定）"/><div class="hint">此牌組僅記錄在這場比賽，不會建立到「我的牌組」。</div><select name="guestDeckColor" style="margin-top:8px">${COLORS.map(c=>`<option value="${c.id}" ${(guestDeck?.color||'OTHER')===c.id?'selected':''}>${e(c.name)}</option>`).join('')}</select></div>`;
  return `<div class="field"><label>玩家 ${side} 使用牌組</label><select name="deck${side}" ${quick?'':'id="deck-'+side.toLowerCase()+'"'}>${deckOptions(playerId,chosen)}</select>${!deckOptions(playerId,chosen)?'<div class="hint">該玩家目前沒有牌組，請先新增牌組。</div>':''}</div>`;
}
function deckOptions(uid,chosen){return state.decks.filter(d=>d.ownerUid===uid&&d.active!==false).map(d=>`<option value="${e(d.id)}" ${chosen===d.id?'selected':''}>${e(d.name)} · ${e(colorOf(d.color).name)}</option>`).join('')}
function matchModalBody(){
  const d=state.draft;
  const pa=player(d.playerA),pb=player(d.playerB);
  return `<div class="mode-note">⚔ 每場只需要一個人填寫。${isPersonal()?'個人戰團可選「訪客玩家」，不需邀請對方註冊。訪客牌組僅保存於本場結果中。':'玩家 A 預設為你，也能代填群組內兩人的對戰。'}</div><form data-form="new-match"><div class="form-grid"><div class="field"><label>玩家 A</label><select name="playerA" id="player-a">${pickerOptions(state.players,d.playerA,'',isPersonal())}</select></div><div class="field"><label>玩家 B</label><select name="playerB" id="player-b">${pickerOptions(state.players,d.playerB,d.playerA,isPersonal())}</select></div>${deckInputFor(d.playerA,'A',d.deckA,d.guestDeck)}${deckInputFor(d.playerB,'B',d.deckB,d.guestDeck)}<div class="field field-full"><label>本場勝者</label><div class="winner-options"><button class="winner-option ${d.winner===d.playerA?'selected':''}" type="button" data-action="pick-winner" data-winner="A">🏆 ${e(pa?.nickname||'玩家 A')}</button><button class="winner-option ${d.winner===d.playerB?'selected':''}" type="button" data-action="pick-winner" data-winner="B">🏆 ${e(pb?.nickname||'玩家 B')}</button></div></div><div class="field field-full"><label>實際對戰日期與時間</label><input type="datetime-local" name="playedAt" value="${e(state.draft.playedAt||localDateTimeValue())}" required><div class="hint">預設為現在，可以補登過去的對戰；系統另保留登錄時間。</div></div><div class="field field-full"><label>備註（選填）</label><textarea name="note" maxlength="200" placeholder="例如：野場、三局兩勝…">${e(d.note||'')}</textarea></div></div><div class="modal-footer"><button type="button" class="btn btn-ghost" data-action="close-modal">取消</button><button type="submit" class="btn btn-primary" ${state.players.length<2?'disabled':''}>儲存戰績 →</button></div></form>`;
}
function deckModalBody(){const d=state.draft;return `<form data-form="save-deck"><div class="field"><label>牌組圖片</label><div class="upload" id="deck-upload">${guardedImage(d.imageData)?`<img src="${guardedImage(d.imageData)}" alt="牌組圖片預覽">`:'<div style="font-size:33px">▧</div><strong>點擊上傳牌組圖片</strong><span class="sm muted">將壓縮後儲存，建議使用自己的照片或獲授權圖片</span>'}<input name="cover" type="file" accept="image/*" aria-label="上傳牌組圖片" /></div></div><div class="field mt"><label>牌組名稱</label><input name="name" required minlength="1" maxlength="42" value="${e(d.name||'')}" placeholder="例如：紫色魯夫" /></div><div class="field mt"><label>牌組持有者</label><input name="ownerUid" type="hidden" value="${e(state.user.uid)}"><div class="mode-note">${e(userLabel())} · 個人牌組庫（所有已加入戰團共用）</div></div><div class="field mt"><label>牌組顏色</label><div class="color-choices">${COLORS.map(c=>`<button type="button" class="color-choice ${d.color===c.id?'selected':''}" data-action="pick-deck-color" data-color="${c.id}"><span class="dot" style="background:${c.hex}"></span>${c.name}</button>`).join('')}</div></div><div class="modal-footer"><button class="btn btn-ghost" type="button" data-action="close-modal">取消</button><button class="btn btn-primary" type="submit">${d.id?'儲存修改':'建立牌組'} →</button></div></form>`}

function playerModalBody(){
  const stats=getStats().players.find(p=>p.id===state.draft.id);
  if(!stats)return '<div class="empty">找不到玩家</div>';
  const card=state.playerCard;
  const groupVisible=card===undefined?false:(card?card.showGroupStats!==false:true);
  const self=stats.id===state.user?.uid;
  const total=card?.showOverallStats?card.totalStats:null;
  const topDecks=groupVisible?topDecksByWinRate(stats.deckStats,5):[];
  const favoriteMatches=card?.favoriteDeck?.name
    ?state.decks.filter(d=>d.ownerUid===stats.id&&d.name===card.favoriteDeck.name&&d.color===card.favoriteDeck.color)
    :[];
  const favoriteId=favoriteMatches.length===1?favoriteMatches[0].id:'';
  return `<div class="player-line">${playerAvatar(stats.id,'avatar-player')}
    <div><h2>${e(stats.nickname)}</h2><p class="muted sm">${self?'你自己的玩家名片':'其他玩家的名片'} · ${e(state.group?.name||'')}</p></div></div>
    ${card?.showBio&&card.bio?`<section class="card" style="margin-top:14px"><h3>關於我</h3><p class="muted">${e(card.bio)}</p></section>`:''}
    ${card?.showFavoriteDeck&&card.favoriteDeck?.name&&!topDecks.length?`<section class="card" style="margin-top:14px"><h3>♡ 最愛牌組</h3><div class="deck-favorite-feature">${deckArtwork(stats.id,favoriteId,card.favoriteDeck.name,'deck-art-favorite')}<div class="deck-favorite-info"><strong>${e(card.favoriteDeck.name)}</strong><span>${e(colorOf(card.favoriteDeck.color).name)}</span><small>使用此牌組：${Number(card.favoriteDeckStats?.games||0)} 場 · ${Number(card.favoriteDeckStats?.wins||0)} 勝 · ${Number(card.favoriteDeckStats?.rate||0)}% 勝率（公開快照）</small></div></div></section>`:''}
    ${groupVisible?`<h3 style="margin-top:18px">目前戰團戰績</h3><div class="stats-detail">
      <div class="stats-cell"><b>${stats.games}</b><span>場次</span></div>
      <div class="stats-cell"><b>${stats.wins}</b><span>勝場</span></div>
      <div class="stats-cell"><b>${stats.rate}%</b><span>勝率</span></div></div>`:''}
    ${topDecks.length?`<section class="card" style="margin-top:14px"><div class="section-head"><h3>牌組勝率 TOP 5</h3><span class="tag">此戰團 · 最多五副</span></div><div class="deck-top-five">${topDecks.map((d,i)=>`<div class="deck-top-five-item"><span class="deck-top-five-rank">${i+1}</span>${deckArtwork(stats.id,d.id,d.name,'deck-art-top-five')}<div class="deck-top-five-info"><strong>${e(d.name)}${card?.showFavoriteDeck&&favoriteId===d.id?' <span class="deck-fav-tag">♡ 最愛</span>':''}</strong><span>${e(colorOf(d.color).name)} · ${d.games} 場 / ${d.wins} 勝 / ${d.losses} 敗</span></div><b class="deck-top-five-rate">${d.rate}%</b></div>`).join('')}</div><p class="hint">依勝率排序；相同勝率優先顯示場次較多的牌組。</p></section>`:''}
    ${total?`<h3 style="margin-top:18px">個人公開總戰績</h3><div class="stats-detail">
      <div class="stats-cell"><b>${Number(total.games)||0}</b><span>總場次</span></div>
      <div class="stats-cell"><b>${Number(total.wins)||0}</b><span>勝場</span></div>
      <div class="stats-cell"><b>${Number(total.rate)||0}%</b><span>勝率</span></div></div><p class="muted sm">這是玩家上次更新公開名片時的戰績快照。</p>`:''}
    ${!groupVisible&&!total?'<div class="hint" style="margin-top:16px">這位玩家沒有開放名片戰績。</div>':''}
    ${self?'<button class="btn btn-outline btn-full" data-tab="profile" style="margin-top:18px">編輯我的公開名片</button>':''}`;
}

function renderModal(){if(!state.modal)return '';let title,body;switch(state.modal){case 'match':title='新增對戰紀錄';body=matchModalBody();break;case 'match-detail':title='對戰詳情';body=matchDetailBody();break;case 'deck':title=state.draft.id?'編輯牌組':'新增牌組';body=deckModalBody();break;case 'player':title='玩家詳細戰績';body=playerModalBody();break;case 'tournament-create':title='建立錦標賽';body=`<form data-form="create-tournament"><div class="field"><label>錦標賽名稱</label><input name="title" minlength="2" maxlength="60" required placeholder="例如：UA 週末冠軍盃"></div><div class="field mt"><label>賽事說明（選填）</label><textarea name="description" maxlength="240" rows="3" placeholder="例如：採單敗淘汰，房主確認結果"></textarea></div><div class="alert" style="margin-top:14px">僅房主可新增參賽者、開始賽程與登錄勝者。公開觀賽連結可免登入查看賽程，不會公開私人對戰團與牌組資料。</div><div class="modal-footer"><button type="button" class="btn btn-ghost" data-action="close-modal">取消</button><button type="submit" class="btn btn-primary">建立錦標賽</button></div></form>`;break;case 'more':title='功能選單';body=`<div class="more-links">${[['profile','◉ 個人資料'],['groups','⇄ 我的對戰團'],['players','♟ 玩家排行'],['rules','✦ 規則 AI']].map(([id,label])=>`<button class="nav" data-tab="${id}">${label}</button>`).join('')}</div>`;break;case 'invite':title='邀請朋友';body=`<p class="muted sm">將連結傳給朋友，對方註冊登入後就能加入你的對戰群組。具有連結的人可申請加入，請只傳給信任的朋友。</p><div class="divider"></div><label>對戰團名稱</label><div class="group-pill" style="display:inline-block;margin-bottom:17px">${e(state.group?.name)}</div><label>邀請連結</label><div class="invite-id"><span class="mono">${e(inviteUrl())}</span><button class="btn btn-primary btn-sm" data-action="copy-invite">複製</button></div><div class="hint">好友完成登入後即可進入群組；同一個帳號可參加多個群組。</div>`;break;default:body='';title='';}
  return `<div class="modal-backdrop" data-action="backdrop"><div class="modal" role="dialog" aria-modal="true" aria-label="${e(title)}"><div class="modal-header"><h2>${e(title)}</h2><button class="close" data-action="close-modal" aria-label="關閉視窗">✕</button></div>${body}</div></div>`;
}

function groupHubPage(){
  return `<div class="page-head"><div><div class="label-up">PLAY GROUPS / SWITCH</div><h1>我的對戰團</h1><p>同一帳號可參加多個戰團；戰績依戰團分開，牌組則由帳號共用。</p></div><button class="btn btn-primary" data-action="switch-group">＋ 新增或加入對戰團</button></div><div class="group-card-grid">${state.groupIds.map(id=>`<section class="card group-card"><span class="tag">${id===personalGroupId(state.user?.uid||'')?'🏠 個人戰團':id===state.groupId?'目前所在對戰團':'已加入'}</span><h3>${e(state.groupDetails[id]|| (id===state.groupId?state.group?.name:id))}</h3><p class="muted sm">${id===personalGroupId(state.user?.uid||'')?'不需要對手註冊，即可記錄訪客對戰':id===state.groupId?`${state.players.length} 名玩家 · ${state.matches.filter(m=>m.status==='active').length} 場對戰`:'切換後可查看該團戰績與牌組'}</p><button class="btn ${id===state.groupId?'btn-ghost':'btn-outline'}" data-action="select-group-card" data-id="${e(id)}">${id===state.groupId?'返回目前群組':'切換到這個對戰團'} →</button></section>`).join('')}</div><div class="card" style="margin-top:18px"><h3>想邀請朋友加入目前的對戰團？</h3><p class="muted sm" style="margin:9px 0 15px">邀請連結只供加入對戰團；錦標賽的公開觀賽連結是另一個網址。</p><button class="btn btn-ghost" data-action="share-invite">↗ 複製／查看邀請連結</button></div>`;
}

function personalExtras(){
  const totals=ownStats(),c=state.myCard||{};
  const mine=state.decks.filter(d=>d.ownerUid===state.user?.uid&&d.active!==false);
  const groups=totals.byGroup.map(g=>`<tr><td><strong>${e(state.groupDetails[g.groupId]||g.groupId)}</strong></td><td>${g.games}</td><td>${g.wins}</td><td>${g.losses}</td><td>${g.rate}%</td><td><button class="btn btn-ghost btn-sm" data-action="my-group-matches" data-id="${e(g.groupId)}">查看</button></td></tr>`).join('');
  const checked=key=>c[key]!==false?'checked':'';
  const fav=(c.favoriteDeck?.name||'');
  return `<section class="card" style="margin-top:20px">
    <div class="section-head"><h3>⚔ 我的個人總戰績</h3><span class="tag">跨 ${state.groupIds.length} 個戰團</span></div>
    ${!state.historyReady?'<div class="hint">正在載入各戰團戰績，請稍後…</div>':''}
    <div class="stats-detail">
      <div class="stats-cell"><b>${totals.games}</b><span>總場次</span></div>
      <div class="stats-cell"><b>${totals.wins}</b><span>總勝場</span></div>
      <div class="stats-cell"><b>${totals.losses}</b><span>總敗場</span></div>
      <div class="stats-cell"><b>${totals.rate}%</b><span>總勝率</span></div>
    </div>
    <div class="divider"></div><h3>各戰團戰績</h3>
    <div class="table-wrap" style="margin-top:12px"><table class="table"><thead><tr>
      <th>戰團</th><th>場次</th><th>勝</th><th>敗</th><th>勝率</th><th>明細</th>
    </tr></thead><tbody>${groups}</tbody></table></div>
    <p class="muted sm">僅統計你有參賽的有效場次；替別人代填不計入個人戰績。撤銷的對戰不列入。</p>
  </section>
  <section class="card" style="margin-top:20px">
    <div class="section-head"><h3>▤ 我的牌組勝率</h3><span class="tag">跨戰團累計</span></div>
    <div class="deck-rate-list">${personalDeckStats().map(d=>`<div class="deck-rate-row"><span>${e(d.name)}</span><strong>${d.rate}%</strong><small>${d.games} 場 · ${d.wins} 勝 · ${d.losses} 敗</small></div>`).join('')||'<div class="empty">尚無個人牌組的對戰紀錄。</div>'}</div>
  </section>
  <section class="card" style="margin-top:20px">
    <div class="section-head"><h3>◉ 公開玩家名片設定</h3><span class="tag">自行決定分享內容</span></div>
    <p class="muted sm">其他登入玩家點你的名片會看到你勾選的項目；Email、群組清單與完整私人對戰明細不會公開。</p>
    <form data-form="save-card" style="margin-top:15px">
      <label class="field"><input type="checkbox" name="showBio" ${checked('showBio')}> 公開我的個人簡介</label>
      <label class="field" style="margin-top:11px"><input type="checkbox" name="showGroupStats" ${checked('showGroupStats')}> 名片顯示目前戰團戰績</label>
      <label class="field" style="margin-top:11px"><input type="checkbox" name="showOverallStats" ${checked('showOverallStats')}> 公開跨戰團的個人總戰績</label>
      <label class="field" style="margin-top:11px"><input type="checkbox" name="showFavoriteDeck" ${checked('showFavoriteDeck')}> 公開最愛牌組</label>
      <div class="field" style="margin-top:11px"><label>選擇最愛牌組</label><select name="favoriteDeckId">
        <option value="">不指定</option>
        ${mine.map(d=>`<option value="${e(d.id)}" ${d.name===fav||(!fav&&d.id===mine[0]?.id)?'selected':''}>${e(d.name)} · ${e(colorOf(d.color).name)}</option>`).join('')}
      </select></div>
      <p class="hint">總戰績會在儲存公開名片時建立快照；之後他人新增你的戰績，快照不會自動變動。戰團排行榜仍依實際紀錄計算。</p>
      <button class="btn btn-primary" type="submit" style="margin-top:18px">儲存公開名片</button>
    </form>
  </section>`;
}

function streakGuide(){
  const streak=playerWinStreak(state.user?.uid,state.matches);
  const tiers=[{id:'bronze',threshold:2,name:'銅框'},{id:'silver',threshold:5,name:'銀框'},
    {id:'gold',threshold:10,name:'金框'},{id:'prismatic',threshold:20,name:'彩色框'}];
  const active=streakTier(streak.current);
  return `<section class="card streak-guide">
    <div class="section-head"><h3>✦ 連勝頭像外框</h3><span class="tag">目前戰團</span></div>
    <div class="streak-status"><strong>目前連勝 ${streak.current} 場</strong><span>${active?'已獲得 '+e(tiers.find(t=>t.id===active)?.name||'外框'):'再連勝 '+Math.max(0,2-streak.current)+' 場即可取得銅框'}</span></div>
    <div class="streak-tier-grid">${tiers.map(t=>`<div class="streak-tier-card${active===t.id?' achieved':''}">
      ${playerAvatar(state.user?.uid,'avatar-tier-preview',t.id)}
      <strong>連贏 ${t.threshold} 場</strong><small>${t.name}</small>
    </div>`).join('')}</div>
    <p class="hint">外框會依目前戰團的連續勝場自動變化，輸掉一場就重新累計。只計入有效戰績，並按實際對戰時間排序；已撤銷的對戰不計入。其他頁面只顯示外框，不顯示等級說明。</p>
  </section>`;
}
function profilePage(){
  const me=getStats().players.find(p=>p.id===state.user?.uid);
  return `<div class="page-head"><div><div class="label-up">ACCOUNT / PERSONAL PROFILE</div><h1>我的個人資料</h1><p>編輯你的全站暱稱，並查看帳號所屬的對戰團。</p></div></div><div class="profile-grid"><section class="card"><div class="profile-heading">${playerAvatar(state.user?.uid,'avatar-large')}<div><h2>${e(userLabel())}</h2><p class="muted sm">${e(state.user?.email||'展示帳號')}</p></div></div><div class="avatar-editor"><label class="avatar-upload-control"><input type="file" name="avatar" accept="image/*" aria-label="上傳個人頭像"><span>📷 更換頭像</span></label><button class="btn btn-ghost btn-sm" data-action="remove-avatar" type="button" ${!guardedAvatar(state.profile?.avatarData)?'disabled':''}>移除頭像</button><p class="hint">圖片會裁切成正方形並壓縮，供已加入戰團的成員查看；按「確認使用」後才會儲存。</p></div><div class="divider"></div><form data-form="save-profile"><div class="field"><label>公開玩家暱稱</label><input name="nickname" minlength="2" maxlength="24" required value="${e(userLabel())}" placeholder="你的顯示名稱"></div><div class="field mt"><label>個人簡介（只有你自己能在此頁查看）</label><textarea name="bio" maxlength="160" rows="4" placeholder="例如：喜歡紫色牌組">${e(state.profile?.bio||'')}</textarea></div><div class="hint">儲存後會同步更新你已加入對戰團的玩家暱稱；歷史勝負不會因此刪除。</div><button class="btn btn-primary" type="submit" style="margin-top:18px">儲存個人資料</button></form></section><section class="card"><h3>帳號資訊</h3><div class="profile-info-row"><span>Email</span><strong>${e(state.user?.email||'未設定')}</strong></div><div class="profile-info-row"><span>信箱驗證</span><strong>${state.user?.emailVerified?'已驗證':'尚未驗證'}</strong></div><div class="profile-info-row"><span>加入對戰團</span><strong>${state.groupIds.length} 個</strong></div><div class="profile-info-row"><span>目前團內戰績</span><strong>${me?`${me.wins} 勝 / ${me.losses} 敗`:'尚無紀錄'}</strong></div><div class="divider"></div><h3>我加入的對戰團</h3>${state.groupIds.map(id=>`<button class="nav" data-action="select-group-card" data-id="${e(id)}">⇄ ${e(state.groupDetails[id]||id)} ${id===state.groupId?'· 目前':''}</button>`).join('')}<div class="hint">Email 與密碼由 Firebase Authentication 管理；此頁先提供安全的暱稱與簡介編輯。</div></section></div>` + streakGuide() + personalExtras();
}
const tournamentStatus=s=>({registration:'開放報名',running:'進行中',completed:'已完賽',cancelled:'已取消'})[s]||'未知狀態';
function spectatorUrl(publicId){const u=new URL(location.href);u.search='';u.hash='';u.searchParams.set('watch',publicId);return u.href;}
function tournamentBracket(rounds,isPublic=false,host=false){
  if(!rounds?.length)return '<div class="empty">尚未抽籤產生賽程</div>';
  const label=uid=>isPublic?uid:(uid?state.players.find(p=>p.id===uid)?.nickname||'參賽者':'待決定');
  return `<div class="bracket-scroller"><div class="bracket-board">${rounds.map((round,ri)=>`<section class="bracket-round"><h3>ROUND ${ri+1}${ri===rounds.length-1?' · 決賽':''}</h3>${round.map((m,mi)=>{
    const a=isPublic?m.a:label(m.a),b=isPublic?m.b:label(m.b),winner=m.winner?(isPublic?m.winner:label(m.winner)):'';
    return `<div class="bracket-match"><small class="muted">MATCH ${mi+1}${m.bye?' · 輪空':''}</small><div class="bracket-person ${m.winner&&m.winner===m.a?'winner':''}">${e(a||'待定')}${m.winner===m.a&&m.a?' 🏆':''}</div><div class="bracket-person ${m.winner&&m.winner===m.b?'winner':''}">${e(b||(m.bye?'輪空':'待定'))}${m.winner===m.b&&m.b?' 🏆':''}</div>${!isPublic&&host&&m.a&&m.b&&!m.winner?`<div class="bracket-actions"><button class="btn btn-outline btn-sm" data-action="tournament-winner" data-round="${ri}" data-match="${mi}" data-winner="${e(m.a)}">${e(a)} 勝</button><button class="btn btn-outline btn-sm" data-action="tournament-winner" data-round="${ri}" data-match="${mi}" data-winner="${e(m.b)}">${e(b)} 勝</button></div>`:winner?`<div class="muted sm">勝者：${e(winner)}</div>`:''}</div>`;
  }).join('')}</section>`).join('')}</div></div>`;
}
function tournamentPage(){
  const selected=state.tournaments.find(t=>t.id===state.tournamentId);
  if(!selected){
    const tournaments=[...state.tournaments].sort((a,b)=>dateNum(b.createdAt)-dateNum(a.createdAt));
    return `<div class="page-head"><div><div class="label-up">TOURNAMENTS / BRACKET</div><h1>錦標賽</h1><p>建立單敗淘汰賽，由房主管理參賽者、賽程與每場勝者。</p></div><button class="btn btn-primary" data-action="new-tournament">＋ 建立錦標賽</button></div><div class="tournament-grid">${tournaments.length?tournaments.map(t=>`<button class="card tournament-card" data-action="select-tournament" data-id="${e(t.id)}"><div class="tournament-card-head"><span class="tag">${tournamentStatus(t.status)}</span><span class="muted sm">${(t.participants||[]).length}/32 人</span></div><h3>${e(t.title)}</h3><p>${e(t.description||'單敗淘汰賽')}</p><div class="tournament-card-foot"><span>${t.createdBy===state.user?.uid?'👑 我是房主':'♟ 我是團員'}</span><span>查看賽程 →</span></div></button>`).join(''):`<div class="card empty"><h3>尚無錦標賽</h3><p>開始建立第一場 UA Arena 錦標賽。</p><button class="btn btn-primary" data-action="new-tournament">建立錦標賽</button></div>`}</div>`;
  }
  const host=selected.createdBy===state.user?.uid;
  const open=selected.status==='registration';
  const available=state.players.filter(p=>!selected.participants.some(x=>x.uid===p.id));
  return `<div class="page-head"><div><button class="text-link" data-action="tournament-back">← 返回錦標賽列表</button><div class="label-up" style="margin-top:15px">TOURNAMENT ROOM / ${host?'HOST':'PARTICIPANT'}</div><h1>${e(selected.title)}</h1><p>${e(selected.description||'單敗淘汰賽')} · ${tournamentStatus(selected.status)}</p></div><button class="btn btn-ghost" data-action="copy-spectator" data-id="${e(selected.publicId)}">↗ 複製公開觀賽連結</button></div><div class="tournament-overview"><div class="metric"><div class="metric-label">賽事狀態</div><div class="metric-num mint" style="font-size:21px">${tournamentStatus(selected.status)}</div></div><div class="metric"><div class="metric-label">參賽人數</div><div class="metric-num">${selected.participants.length}</div></div><div class="metric"><div class="metric-label">賽事房主</div><div class="metric-num" style="font-size:19px">${e(selected.hostName||playerName(selected.createdBy))}</div></div><div class="metric"><div class="metric-label">冠軍</div><div class="metric-num gold" style="font-size:19px">${selected.champion?e(playerName(selected.champion)):'尚未產生'}</div></div></div><div class="two-col"><section class="card"><div class="section-head"><h3>♟ 參賽者名單</h3><span class="tag">${selected.participants.length}/32</span></div>${(selected.participants||[]).map((part,i)=>`<div class="tournament-entrant"><span>${i+1}. ${e(part.nickname)} ${part.uid===selected.createdBy?'👑':''}</span>${host&&open?`<button class="btn btn-ghost btn-sm" data-action="remove-entrant" data-id="${e(part.uid)}">移除</button>`:''}</div>`).join('')||'<div class="empty">房主尚未加入參賽者</div>'}${host&&open?`<form data-form="tournament-add" class="tournament-add"><div class="field"><label>從目前對戰團新增參賽者</label><select name="uid" required><option value="">選擇玩家</option>${available.map(p=>`<option value="${e(p.id)}">${e(p.nickname)}</option>`).join('')}</select></div><button class="btn btn-outline" type="submit" ${available.length?'':'disabled'}>加入名單</button></form><div class="divider"></div><button class="btn btn-primary btn-full" data-action="tournament-start" ${selected.participants.length>=2?'':'disabled'}>開始賽事 · 抽籤產生賽程</button>`:''}${host&&open&&state.tournamentRequests.length?`<div class="divider"></div><h3 style="margin-bottom:12px">等待房主核准 · ${state.tournamentRequests.length} 人</h3>${state.tournamentRequests.map(req=>`<div class="tournament-entrant"><span>${e(req.nickname)}</span><button class="btn btn-outline btn-sm" data-action="approve-entrant" data-id="${e(req.uid)}">核准報名</button></div>`).join('')}`:''}${!host&&open&&!selected.participants.some(p=>p.uid===state.user?.uid)?`<div class="divider"></div><button class="btn ${state.myTournamentRequest?'btn-ghost':'btn-primary'} btn-full" data-action="request-entrant" ${state.myTournamentRequest?'disabled':''}>${state.myTournamentRequest?'已送出報名申請 · 等待房主核准':'我要報名參加錦標賽'}</button>`:''}${!host&&selected.participants.some(p=>p.uid===state.user?.uid)?'<div class="alert" style="margin-top:16px">你已列入參賽名單。</div>':''}</section><section class="card"><h3>公開觀賽</h3><p class="muted sm" style="margin:10px 0">無需登入即可觀看賽程與戰況。公開資料僅包含賽事標題、參賽者暱稱及勝負結果。</p><div class="invite-id"><span class="mono">${e(spectatorUrl(selected.publicId))}</span><button class="btn btn-primary btn-sm" data-action="copy-spectator" data-id="${e(selected.publicId)}">複製</button></div><div class="divider"></div><h3>權限說明</h3><p class="muted sm" style="margin-top:12px">房主負責新增參賽者、開始賽事與確認每場勝者；其他團員可查看，持有連結的訪客只能觀看。</p></section></div><section class="card" style="margin-top:20px"><div class="section-head"><h3>🏆 淘汰賽程</h3><span class="tag">單敗淘汰</span></div>${tournamentBracket(selected.rounds,false,host)}</section>`;
}
function publicWatchPage(){
  const t=state.publicTournament;
  app.innerHTML=`<div class="watch-page"><div class="watch-header"><div class="logo" style="margin:0"><span class="logo-icon">UA</span> UA <span class="arena">ARENA</span></div><button class="btn btn-ghost btn-sm" data-action="watch-home">返回 UA Arena</button></div><div class="watch-content"><div class="label-up">LIVE TOURNAMENT / PUBLIC VIEW</div>${t?`<h1>${e(t.title)}</h1><p class="muted">${e(t.description||'公開賽程')} · ${tournamentStatus(t.status)}</p><div class="tournament-overview" style="margin-top:25px"><div class="metric"><div class="metric-label">賽事狀態</div><div class="metric-num mint" style="font-size:21px">${tournamentStatus(t.status)}</div></div><div class="metric"><div class="metric-label">參賽人數</div><div class="metric-num">${t.participants?.length||0}</div></div><div class="metric"><div class="metric-label">賽事房主</div><div class="metric-num" style="font-size:18px">${e(t.hostName||'')}</div></div><div class="metric"><div class="metric-label">冠軍</div><div class="metric-num gold" style="font-size:20px">${e(t.champion||'尚未產生')}</div></div></div><section class="card"><h3>參賽者</h3><div class="public-entrant-list">${(t.participants||[]).map(p=>`<span class="tag">${e(p.name)}</span>`).join('')||'<span class="muted">尚未公布名單</span>'}</div></section><section class="card" style="margin-top:18px"><div class="section-head"><h3>賽程與即時戰況</h3><span class="tag">自動同步</span></div>${tournamentBracket(t.rounds,true,false)}</section><p class="muted sm" style="margin-top:22px">此連結為公開唯讀頁面，不提供修改賽程或存取私人戰績的權限。</p>`:`<div class="card" style="margin-top:30px"><h2>${state.publicWatchError?'無法載入賽事':'正在載入公開賽程…'}</h2><p class="muted">${e(state.publicWatchError||'請確認觀賽連結。')}</p></div>`}</div></div>`;
}
function ensureQuickDraft(force=false){
  const d=state.quickDraft;
  const validA=state.players.some(p=>p.id===d.playerA);
  const validB=state.players.some(p=>p.id===d.playerB);
  if(force||!validA||!validB||d.playerA===d.playerB){
    const a=state.players.find(p=>p.id===state.user?.uid)?.id||state.players[0]?.id||'';
    const b=isPersonal()?GUEST_PLAYER_ID:state.players.find(p=>p.id!==a)?.id||'';
    state.quickDraft={playerA:a,playerB:b,deckA:pickDeck(a),deckB:pickDeck(b),guestDeck:guestDefault(),timerEnabled:true};
  }else{
    // onSnapshot can deliver members before their personal decks. Reconcile the
    // selected IDs on every render, without overwriting a valid user selection.
    d.deckA=d.playerA===GUEST_PLAYER_ID?GUEST_DECK_ID:pickDeck(d.playerA,d.deckA);
    d.deckB=d.playerB===GUEST_PLAYER_ID?GUEST_DECK_ID:pickDeck(d.playerB,d.deckB);
  }
}
function quickSetupPage(){
  ensureQuickDraft();const d=state.quickDraft;
  return `<section class="card quick-form"><div class="section-head"><h3>快速建立一場對戰</h3><span class="tag">由任何一位群組成員操作</span></div>
    <form data-form="quick-setup"><div class="form-grid"><div class="field"><label>玩家 A</label><select name="playerA">${pickerOptions(state.players,d.playerA,'',isPersonal())}</select></div>
    <div class="field"><label>玩家 B</label><select name="playerB">${pickerOptions(state.players,d.playerB,d.playerA,isPersonal())}</select></div>
    ${deckInputFor(d.playerA,'A',d.deckA,d.guestDeck,true)}
    ${deckInputFor(d.playerB,'B',d.deckB,d.guestDeck,true)}
    </div><label class="quick-switch"><input type="checkbox" name="timerDisabled" ${!d.timerEnabled?'checked':''}/><span><strong>不使用計時，直接登錄勝負</strong><small>預設使用 30 分鐘計時。如要補登或只記錄結果，請勾選此選項，並可填寫過去的對戰日期。</small></span></label>
    ${(!d.deckA&&d.playerA!==GUEST_PLAYER_ID)||(!d.deckB&&d.playerB!==GUEST_PLAYER_ID)?'<div class="hint">正在同步雙方的個人牌組；若長時間沒有牌組，請確認該玩家已建立並啟用自己的牌組。</div>':''}
    <div class="modal-footer" style="padding-bottom:0"><button type="submit" class="btn btn-primary" ${(!d.deckA&&d.playerA!==GUEST_PLAYER_ID)||(!d.deckB&&d.playerB!==GUEST_PLAYER_ID)?'disabled':''}>${d.timerEnabled?'建立計時對戰 →':'直接輸入勝負 →'}</button></div></form></section>`;
}
function quickResultForm(s){
  const timed=Boolean(s),d=s||state.quickPending;
  if(!d)return '';
  return `<section class="card quick-form"><div class="section-head"><h3>🏆 登錄勝負結果</h3><button class="btn btn-ghost btn-sm" data-action="${timed?'quick-result-close':'quick-new'}">取消</button></div>
    <p class="muted sm">${e(playerName(d.playerA))}（${e(battleDeckName(d,'A'))}） VS ${e(playerName(d.playerB))}（${e(battleDeckName(d,'B'))}）</p>
    ${timed?`<p class="hint">提交時會自動結束目前回合，儲存每回合及兩位玩家累計用時。時間用完不會自動判定勝者。</p>`:''}
    <form data-form="quick-result"><div class="field mt"><label>本場勝利者</label><select name="winner" required><option value="${e(d.playerA)}">🏆 ${e(playerName(d.playerA))}</option><option value="${e(d.playerB)}">🏆 ${e(playerName(d.playerB))}</option></select></div>
    ${!timed?`<div class="field mt"><label>實際對戰日期與時間</label><input type="datetime-local" name="playedAt" required value="${localDateTimeValue()}"><div class="hint">可回填過去時間；登錄時間另外保存。</div></div>`:`<div class="hint">對戰時間使用計時開始時間。</div>`}<div class="field mt"><label>備註（選填）</label><textarea name="note" maxlength="200" placeholder="例如：時間到、加賽等"></textarea></div>
    <button class="btn btn-primary" type="submit" style="margin-top:15px">確認儲存結果 →</button></form></section>`;
}
function quickSessionPage(s){
 const c=quickClock(s);const playing=s.status==='ready'||s.status==='running';const timedDone=s.status==='finished';
 const total=mmss(c.remainingMs);
 const turnRows=(s.turns||[]).slice().reverse().map((t,i)=>`<tr><td>${s.turns.length-i}</td><td>${e(playerName(t.playerId))}</td><td class="mono">${mmss(t.durationMs)}</td></tr>`).join('');
 return `<section class="card quick-session"><div class="section-head"><h3>⏱ ${e(playerName(s.playerA))} VS ${e(playerName(s.playerB))}</h3><span class="tag">${timedDone?'已完成':s.status==='cancelled'?'已取消':s.status==='ready'?'等待開始':'進行中'}</span></div>
 <div class="quick-clock ${c.expired?'expired':''}"><span>30:00 總倒數</span><strong class="qm-time-left">${total}</strong><small class="qm-time-state">${c.expired?'時間已到，請登錄結果':!s.startedAtMs?'由第一位玩家點選回合開始後啟動':s.activePlayer?`目前回合：${e(playerName(s.activePlayer))}`:'等待下一位玩家開始回合'}</small></div>
 <div class="quick-players">${[s.playerA,s.playerB].map((id,i)=>`<div class="quick-player ${s.activePlayer===id?'is-active':''}"><div class="quick-player-name">${e(playerName(id))}</div><div class="muted sm">${e(battleDeckName(s,i===0?'A':'B'))}</div><div class="quick-player-time ${i===0?'qm-player-a':'qm-player-b'}">${mmss(i===0?c.playerAMs:c.playerBMs)}</div>
 ${playing?(s.activePlayer===id?`<button class="btn btn-primary btn-full" data-action="quick-turn-end">■ 回合結束</button>`:s.activePlayer?`<button class="btn btn-ghost btn-full" disabled>等待對手結束</button>`:`<button class="btn btn-primary btn-full" data-action="quick-turn-start" data-player="${e(id)}" ${c.expired?'disabled':''}>▶ 回合開始</button>`):''}</div>`).join('')}</div>
 <div class="hint">兩人累計用時不包含回合間空檔。總計時不因關閉頁面而停止；同一群組的其他裝置也會同步回合操作。這是朋友間的用時參考，並非防作弊裁判計時。</div>
 <div class="quick-summary"><span>已完成回合：<b>${c.turns}</b></span><span>未歸屬空檔：<b class="qm-gap">${mmss(c.unattributedMs)}</b></span></div>
 ${playing?`<button class="btn btn-primary btn-full" data-action="quick-result-open" style="margin-top:18px">🏆 結束對戰並登錄結果</button><button class="btn btn-ghost btn-full" style="margin-top:8px" data-action="quick-cancel">取消本場（不計勝負）</button>`:''}
 ${(s.turns||[]).length?`<div class="divider"></div><h3 class="quick-history-title">回合用時紀錄</h3><div class="table-wrap"><table class="table"><thead><tr><th>回合</th><th>玩家</th><th>花費時間</th></tr></thead><tbody>${turnRows}</tbody></table></div>`:''}
 </section>${state.quickResultOpen && playing?quickResultForm(s):''}`;
}
function quickPage(){
 const visible=state.quickMatches.filter(x=>!x.hiddenAt);
 const active=visible.filter(x=>x.status==='ready'||x.status==='running').sort((a,b)=>(b.createdAtMs||0)-(a.createdAtMs||0));
 const selected=state.quickMatches.find(x=>x.id===state.quickSessionId)||(!state.quickCreate?active[0]:null);
 if(selected && !state.quickSessionId)state.quickSessionId=selected.id;
 const rows=visible.slice().sort((a,b)=>b.createdAtMs-a.createdAtMs).slice(0,30).map(q=>`<div class="quick-list-entry">
   <button type="button" class="quick-list-row ${selected?.id===q.id?'selected':''}" data-action="quick-select" data-id="${e(q.id)}">
    <span class="quick-list-meta"><strong>${e(playerName(q.playerA))} vs ${e(playerName(q.playerB))}</strong>
      <small>${e(new Date(q.startedAtMs||q.createdAtMs||Date.now()).toLocaleString('zh-TW',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}))}</small></span>
    <span class="tag">${q.status==='finished'?'已完成':q.status==='ready'?'待開始':q.status==='running'?'進行中':'已取消'}</span>
   </button>
   ${[q.playerA,q.playerB].includes(state.user?.uid)?`<button type="button" class="btn btn-danger btn-sm quick-remove" data-action="quick-remove" data-id="${e(q.id)}">刪除</button>`:''}
 </div>`).join('');
 return `<div class="page-head"><div><div class="label-up">QUICK MATCH / 30-MINUTE CLOCK</div><h1>Quick Match</h1><p>30 分鐘計時與直接記錄兩種模式，對戰結果會保存在目前戰團。</p></div><button class="btn btn-primary" data-action="quick-new">＋ 新對戰</button></div>
 ${state.players.length<2?`<section class="card"><div class="empty">請先建立個人牌組或邀請其他玩家加入對戰團。</div></section>`:state.quickPending?quickResultForm(null):state.quickCreate?quickSetupPage():selected?quickSessionPage(selected):quickSetupPage()}
 ${visible.length?`<section class="card quick-session-list"><div class="section-head"><h3>歷史對戰及計時場次</h3><span class="tag">${visible.length} 場</span></div>
 <p class="muted sm" style="margin-bottom:13px">雙方玩家都能刪除這份速配清單。已完成的正式戰績仍會保留，可從「戰績紀錄」查看或撤銷。</p>
 <div class="quick-list">${rows}</div></section>`:''}`;
}
function refreshQuickClock(){
 if(state.tab!=='quick'||state.quickCreate)return;
 const s=state.quickMatches.find(x=>x.id===state.quickSessionId);if(!s)return;
 const c=quickClock(s);const container=$('.quick-session');if(!container)return;
 const text=(sel,value)=>{const el=container.querySelector(sel);if(el)el.textContent=value};
 text('.qm-time-left',mmss(c.remainingMs));text('.qm-player-a',mmss(c.playerAMs));text('.qm-player-b',mmss(c.playerBMs));text('.qm-gap',mmss(c.unattributedMs));
 text('.qm-time-state',c.expired?'時間已到，請登錄結果':!s.startedAtMs?'由第一位玩家點選回合開始後啟動':s.activePlayer?`目前回合：${playerName(s.activePlayer)}`:'等待下一位玩家開始回合');
 container.querySelector('.quick-clock')?.classList.toggle('expired',c.expired);
 if(c.expired)container.querySelectorAll('[data-action="quick-turn-start"]').forEach(b=>b.disabled=true);
}
setInterval(refreshQuickClock,250);
function inviteUrl(){let url=new URL(location.href);url.search='';url.hash='';url.searchParams.set('join',state.groupId);return url.href}
function render(){if(!state.user){authPage();return}if(!state.groupId){setupPage();return}const pages={overview:overviewPage,quick:quickPage,matches:matchesPage,decks:decksPage,players:playersPage,rules:rulesPage,tournaments:tournamentPage,profile:profilePage,groups:groupHubPage};shell((pages[state.tab]||overviewPage)())}
function openModal(kind,draft={}){state.modal=kind;state.draft=draft;render()}
function pickDeck(uid,selectedId=''){return resolvePlayerDeckSelection(uid,selectedId,state.decks)}
function newMatch(){if(state.players.length<2){toast('請先加入群組或使用個人戰團的訪客模式。',true);return}const pa=state.players.find(p=>p.id===state.user.uid)?.id||state.players[0].id;const pb=isPersonal()?GUEST_PLAYER_ID:state.players.find(p=>p.id!==pa)?.id||'';openModal('match',{playerA:pa,playerB:pb,deckA:pickDeck(pa),deckB:pickDeck(pb),guestDeck:guestDefault(),winner:pa,note:'',playedAt:localDateTimeValue()});}
function newDeck(d={}){if(d.ownerUid&&d.ownerUid!==state.user?.uid){toast('只能編輯自己的牌組。',true);return}openModal('deck',{id:d.id||'',ownerUid:state.user.uid,name:d.name||'',color:d.color||'PURPLE',imageData:d.imageData||''});}
async function loadGroup(gid){
  tournamentRequestUnsub();tournamentRequestUnsub=()=>{};unsub();unsub=()=>{};state.groupId='';state.group=await adapter.getGroup(gid);
  state.groupId=gid;state.tab='overview';state.quickDraft={};state.players=[];state.decks=[];state.matches=[];state.quickMatches=[];state.tournaments=[];state.tournamentRequests=[];state.myTournamentRequest=false;state.tournamentId='';state.quickSessionId='';state.quickCreate=true;state.quickResultOpen=false;state.quickPending=null;
  safeStoreSet(`ua-arena-last-${state.user.uid}`,gid);
  unsub=adapter.subscribe(gid,snapshot=>{state.players=isPersonal()?[...snapshot.members.filter(p=>p.id!==GUEST_PLAYER_ID),guestPlayer()]:snapshot.members;state.decks=snapshot.decks;state.matches=snapshot.matches;state.quickMatches=snapshot.quickMatches||[];state.tournaments=snapshot.tournaments||[];render()},error=>toast(readableError(error),true));
  render();
}
function restartPersonalHistory(){
  historyUnsub();historyUnsub=()=>{};
  state.personalHistory={};state.historyReady=false;
  if(!state.user)return;
  if(!state.groupIds.length){state.historyReady=true;return;}
  historyUnsub=adapter.subscribePersonalHistory(state.groupIds,state.user.uid,records=>{
    state.personalHistory=records;
    state.historyReady=state.groupIds.every(id=>Object.prototype.hasOwnProperty.call(records,id));
    if(state.tab==='profile'&&!state.modal)render();
  },err=>{console.warn('個人戰績同步失敗',err);toast(readableError(err),true)});
}
async function afterAuth(user){
  state.user=user;state.groupId='';state.modal=null;
  if(!user){unsub();historyUnsub();historyUnsub=()=>{};state.personalHistory={};state.historyReady=false;state.groupIds=[];state.myCard=null;render();return}
  try{
    state.groupIds=await adapter.getMyGroups(user.uid);
    state.profile=await adapter.getProfile(user.uid);
    try{state.myCard=await adapter.getPlayerCard(user.uid);}catch(err){console.warn('名片讀取尚未啟用',err);state.myCard=null;}
    restartPersonalHistory();
    const groupInfo=await Promise.allSettled(state.groupIds.map(id=>adapter.getGroup(id)));
    state.groupDetails=Object.fromEntries(groupInfo.map((res,i)=>[state.groupIds[i],res.status==='fulfilled'?res.value.name:state.groupIds[i]]));
    if(state.inviteId){render();return}
    const preferred=safeStoreGet(`ua-arena-last-${user.uid}`);
    const selected=state.groupIds.includes(preferred)?preferred:state.groupIds[0];
    if(selected)await loadGroup(selected);else render();
  }catch(error){console.error(error);toast(readableError(error),true);render();}
}
async function imageToCompressedDataUrl(file){
  if(!file.type.startsWith('image/'))throw new Error('請選擇圖片檔案。');
  if(file.size>12*1024*1024)throw new Error('圖片超過 12 MB，請先縮小後上傳。');
  const bitmap=await createImageBitmap(file);
  try{
    let max=700;
    for(let step=0;step<5;step++){
      const ratio=Math.min(1,max/Math.max(bitmap.width,bitmap.height));
      const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*ratio));canvas.height=Math.max(1,Math.round(bitmap.height*ratio));
      const ctx=canvas.getContext('2d');ctx.fillStyle='#121b2a';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
      const data=canvas.toDataURL('image/jpeg',Math.max(.48,.80-step*.08));
      if(data.length<=155000)return data;
      max=Math.round(max*.78);
    }
  }finally{bitmap.close?.();}
  throw new Error('壓縮後圖片仍過大，請改用尺寸較小的圖片。');
}
async function handleAction(action,el){
  switch(action){
  case 'start-demo':state.preview=true;await afterAuth({uid:'demo-user',displayName:'Samuel',email:'demo@ua-arena.local'});break;
  case 'toggle-auth':state.authMode=state.authMode==='login'?'register':'login';render();break;
  case 'google-login':await runBusy(async()=>await adapter.signInGoogle());break;
  case 'logout':if(adapter.mode==='demo'){state.user=null;state.preview=false;render()}else await runBusy(async()=>adapter.signOut());break;
  case 'switch-group':tournamentRequestUnsub();tournamentRequestUnsub=()=>{};unsub();state.groupId='';state.inviteId='';render();break;
  case 'select-group-card':if(el.dataset.id===state.groupId){state.tab='overview';render();}else await runBusy(async()=>loadGroup(el.dataset.id));break;
  case 'my-group-matches':await runBusy(async()=>{
    if(el.dataset.id!==state.groupId)await loadGroup(el.dataset.id);
    state.tab='matches';state.playerFilter=state.user.uid;render();
  });break;
  case 'more-menu':openModal('more');break;
  case 'new-tournament':openModal('tournament-create');break;
  case 'select-tournament':{
    tournamentRequestUnsub();tournamentRequestUnsub=()=>{};
    state.tournamentId=el.dataset.id;state.tournamentRequests=[];state.myTournamentRequest=false;
    const selected=state.tournaments.find(t=>t.id===state.tournamentId);
    if(selected?.createdBy===state.user.uid){
      tournamentRequestUnsub=adapter.subscribeTournamentRequests(state.groupId,state.tournamentId,reqs=>{state.tournamentRequests=reqs;render();},err=>toast(readableError(err),true));
    }else if(selected)state.myTournamentRequest=await adapter.hasTournamentRequest(state.groupId,state.tournamentId,state.user.uid);
    render();break;
  }
  case 'tournament-back':tournamentRequestUnsub();tournamentRequestUnsub=()=>{};state.tournamentId='';render();break;
  case 'copy-spectator':await navigator.clipboard.writeText(spectatorUrl(el.dataset.id));toast('公開觀賽連結已複製');break;
  case 'request-entrant':await runBusy(async()=>{await adapter.requestTournamentJoin(state.groupId,state.tournamentId,state.user.uid,playerName(state.user.uid));state.myTournamentRequest=true;render();toast('報名申請已送出，請等待房主核准。')});break;
  case 'approve-entrant':await runBusy(async()=>{await adapter.approveTournamentRequest(state.groupId,state.tournamentId,el.dataset.id,state.user.uid);toast('已核准報名。')});break;
  case 'tournament-start':if(confirm('確定抽籤開賽？開始後無法新增或移除參賽者。'))await runBusy(async()=>{await adapter.changeTournament(state.groupId,state.tournamentId,state.user.uid,'start');toast('賽事已開始！')});break;
  case 'remove-entrant':if(confirm('移除這位參賽者？'))await runBusy(async()=>{await adapter.changeTournament(state.groupId,state.tournamentId,state.user.uid,'remove',el.dataset.id);toast('已移除參賽者')});break;
  case 'tournament-winner':if(confirm(`確認此場由 ${playerName(el.dataset.winner)} 獲勝？結果將自動晉級，不能直接覆寫。`))await runBusy(async()=>{await adapter.changeTournament(state.groupId,state.tournamentId,state.user.uid,'result',{round:Number(el.dataset.round),match:Number(el.dataset.match),winner:el.dataset.winner});toast('已更新賽程')});break;
  case 'watch-home':location.assign(location.pathname);break;
  case 'select-existing-group':{const gid=$('#group-select')?.value;if(gid)await runBusy(async()=>await loadGroup(gid));else toast('請先選擇群組。',true);break}
  case 'remove-avatar':if(guardedAvatar(state.profile?.avatarData)&&confirm('確定移除個人頭像？同戰團成員將恢復顯示你的暱稱首字。')){
    await runBusy(async()=>{
      const result=await adapter.saveAvatar(state.user.uid,'',state.groupIds);
      state.profile={...state.profile,avatarData:''};
      state.players=state.players.map(p=>p.id===state.user.uid?{...p,avatarData:''}:p);
      render();toast(result.failures?.length?'頭像已清除，但部分戰團同步失敗。':'頭像已移除');
    });
  }break;
  case 'new-match':newMatch();break;case 'match-detail':openModal('match-detail',{id:el.dataset.id});break;case 'clear-match-filters':state.playerFilter='';state.matchFrom='';state.matchTo='';render();break;
  case 'open-quick':state.tab='quick';state.modal=null;state.quickCreate=true;state.quickPending=null;state.quickResultOpen=false;ensureQuickDraft();render();break;
  case 'quick-new':state.quickCreate=true;state.quickSessionId='';state.quickPending=null;state.quickResultOpen=false;ensureQuickDraft(true);render();break;
  case 'quick-select':state.tab='quick';state.quickSessionId=el.dataset.id;state.quickCreate=false;state.quickPending=null;state.quickResultOpen=false;render();break;
   case 'quick-remove':{
    const session=state.quickMatches.find(x=>x.id===el.dataset.id);
    if(!session||![session.playerA,session.playerB].includes(state.user?.uid))throw new Error('只有本場的兩位玩家可以刪除。');
    if(!confirm('確定從快速對戰清單刪除此場？未結束的計時會先取消；已保存的正式戰績仍會保留，可在戰績詳情撤銷。'))break;
    await runBusy(async()=>{
      if(['ready','running'].includes(session.status))await adapter.changeQuickMatch(state.groupId,session.id,state.user.uid,'cancel');
      await adapter.hideQuickMatch(state.groupId,session.id,state.user.uid);
      if(state.quickSessionId===session.id){state.quickSessionId='';state.quickCreate=true;state.quickPending=null;}
      render();toast('已從速配清單移除。');
    });break;
   }
  case 'quick-result-open':state.quickResultOpen=true;render();break;
  case 'quick-cancel':if(confirm('放棄這場計時對戰？不會產生勝負紀錄，計時資料將保留為已取消。'))await runBusy(async()=>{await adapter.changeQuickMatch(state.groupId,state.quickSessionId,state.user.uid,'cancel');toast('已取消計時對戰。')});break;
  case 'quick-result-close':state.quickResultOpen=false;render();break;
  case 'quick-turn-start':await runBusy(async()=>{await adapter.changeQuickMatch(state.groupId,state.quickSessionId,state.user.uid,'start',el.dataset.player);toast('回合已開始計時。')});break;
  case 'quick-turn-end':await runBusy(async()=>{await adapter.changeQuickMatch(state.groupId,state.quickSessionId,state.user.uid,'end');toast('已記錄本回合用時。')});break;
  case 'new-deck':newDeck();break;
  case 'edit-deck':{const d=deck(el.dataset.id);if(d)newDeck(d);break;}
  case 'archive-deck':if(confirm('封存這副牌組？歷史對戰會保留，但不能用於新對戰。'))await runBusy(async()=>{await adapter.archiveDeck(state.groupId,el.dataset.id);toast('牌組已封存。')});break;
  case 'void-match':if(confirm('確定撤銷這筆紀錄？它會保留稽核痕跡，但不計入統計。'))await runBusy(async()=>{await adapter.voidMatch(state.groupId,el.dataset.id);state.modal=null;render();toast('已撤銷對戰紀錄。')});break;
  case 'player-detail':{
    state.playerCard=undefined;openModal('player',{id:el.dataset.id});
    try{state.playerCard=el.dataset.id===state.user?.uid?state.myCard:await adapter.getPlayerCard(el.dataset.id);render();}
    catch(err){console.error(err);toast(readableError(err),true)}
    break;
  }
  case 'share-invite':if(isPersonal()){toast('個人戰團不需邀請對方。請直接選擇「訪客玩家」登錄戰績。');break;}openModal('invite');break;
  case 'copy-invite':await navigator.clipboard.writeText(inviteUrl());toast('邀請連結已複製！');break;
  case 'close-modal':case 'backdrop':state.modal=null;render();break;
  case 'pick-deck-color':state.draft.color=el.dataset.color;render();break;
  case 'pick-winner':state.draft.winner=el.dataset.winner==='A'?state.draft.playerA:state.draft.playerB;render();break;
  }
}
app.addEventListener('click',event=>{
  const tab=event.target.closest('[data-tab]');if(tab){state.tab=tab.dataset.tab;state.modal=null;if(state.tab==='quick' && !state.quickPending){const live=state.quickMatches.find(q=>q.status==='running'||q.status==='ready');if(live){state.quickSessionId=live.id;state.quickCreate=false;}else{state.quickCreate=true;ensureQuickDraft();}}render();return}
  const colorFilter=event.target.closest('[data-color-filter]');if(colorFilter){state.filter=colorFilter.dataset.colorFilter;render();return}
  const act=event.target.closest('[data-action]');if(!act)return;
  if(act.dataset.action==='backdrop'&&event.target!==act)return;
  if(event.target.closest('.modal')&&act.dataset.action==='backdrop')return;
  handleAction(act.dataset.action,act).catch(err=>toast(readableError(err),true));
});
app.addEventListener('change',async event=>{
  const target=event.target;
  if(target.id==='match-filter'||target.id==='match-from'||target.id==='match-to'){
    if(target.id==='match-filter')state.playerFilter=target.value;
    if(target.id==='match-from')state.matchFrom=target.value;
    if(target.id==='match-to')state.matchTo=target.value;
    render();return;
  }
  if(target.name==='avatar'&&target.files?.[0]){
    const file=target.files[0];
    target.value=''; // Re-selecting the same file must still reopen the editor.
    try{
      const data=await chooseAvatarCrop(file);
      if(!data)return; // Cancel never sends a Firebase write.
      await runBusy(async()=>{
        const result=await adapter.saveAvatar(state.user.uid,data,state.groupIds);
        state.profile={...state.profile,avatarData:data};
        state.players=state.players.map(p=>p.id===state.user.uid?{...p,avatarData:data}:p);
        render();toast(result.failures?.length?'頭像已更新，但部分戰團同步失敗。':'個人頭像已更新！');
      });
    }catch(err){console.error(err);toast(readableError(err),true)}
    return;
  }
  if(target.name==='cover'&&target.files?.[0]){
    await runBusy(async()=>{state.draft.imageData=await imageToCompressedDataUrl(target.files[0]);render();toast('圖片已壓縮並準備儲存。')});return;
  }
  if(state.modal==='deck'&&target.name==='ownerUid'){state.draft.ownerUid=target.value;return;}
  if(state.tab==='quick' && state.quickCreate && target.closest('[data-form="quick-setup"]')){
    const d=state.quickDraft;
    if(target.name==='playerA'){d.playerA=target.value;if(d.playerB===d.playerA)d.playerB=state.players.find(p=>p.id!==d.playerA)?.id||'';d.deckA=pickDeck(d.playerA);d.deckB=pickDeck(d.playerB);}
    else if(target.name==='playerB'){d.playerB=target.value;d.deckB=pickDeck(d.playerB);}
    else if(target.name==='deckA'||target.name==='deckB')d[target.name]=target.value;
    else if(target.name==='guestDeckColor'){d.guestDeck||=guestDefault();d.guestDeck.color=target.value;}
    else if(target.name==='timerDisabled')d.timerEnabled=!target.checked;
    render();return;
  }
  if(!state.modal||state.modal!=='match')return;
  const d=state.draft;
  if(target.name==='playerA'){
    d.playerA=target.value;
    if(d.playerB===d.playerA)d.playerB=state.players.find(p=>p.id!==d.playerA)?.id||'';
    d.deckA=pickDeck(d.playerA);d.deckB=pickDeck(d.playerB);d.winner=d.playerA;render();
  }else if(target.name==='playerB'){
    d.playerB=target.value;d.deckB=pickDeck(d.playerB);if(![d.playerA,d.playerB].includes(d.winner))d.winner=d.playerA;render();
  }else if(target.name==='deckA'){d.deckA=target.value}
  else if(target.name==='deckB'){d.deckB=target.value}
  else if(target.name==='guestDeckColor'){d.guestDeck||=guestDefault();d.guestDeck.color=target.value}
});
app.addEventListener('input',event=>{if(state.modal==='match'&&event.target.name==='note')state.draft.note=event.target.value;if(state.modal==='deck'&&event.target.name==='name')state.draft.name=event.target.value;if(event.target.name==='guestDeckName'){const d=state.modal==='match'?state.draft:state.quickDraft;d.guestDeck||=guestDefault();d.guestDeck.name=event.target.value;}});
app.addEventListener('submit',event=>{
  const form=event.target.closest('form[data-form]');if(!form)return;event.preventDefault();
  const fields=Object.fromEntries(new FormData(form));
  runBusy(async()=>{
    switch(form.dataset.form){
    case 'save-profile':{
      const result=await adapter.saveProfile(state.user.uid,fields.nickname,fields.bio||'',state.groupIds);
      state.profile={...state.profile,nickname:fields.nickname.trim(),bio:(fields.bio||'').trim()};
      state.players=state.players.map(p=>p.id===state.user.uid?{...p,nickname:fields.nickname.trim()}:p);
      render();toast(result.failures?.length?'個人資料已更新，但部分群組暱稱同步失敗。':'個人資料已更新');break;
    }
    case 'save-card':{
      const all=ownStats();
      if(fields.showOverallStats&&!state.historyReady)throw new Error('各戰團戰績還在載入，請稍後再儲存名片。');
      const favorite=state.decks.find(d=>d.id===fields.favoriteDeckId&&d.ownerUid===state.user.uid&&d.active!==false);
      const favoriteStats=personalDeckStats().find(d=>d.id===favorite?.id)||{games:0,wins:0,losses:0,rate:0};
      const visibleTotal=fields.showOverallStats?{games:all.games,wins:all.wins,losses:all.losses,rate:all.rate}:{games:0,wins:0,losses:0,rate:0};
      const card={nickname:userLabel().slice(0,24),bio:state.profile?.bio||'',showBio:!!fields.showBio,
        showGroupStats:!!fields.showGroupStats,showOverallStats:!!fields.showOverallStats,
        showFavoriteDeck:!!fields.showFavoriteDeck,
        favoriteDeck:favorite&&fields.showFavoriteDeck?{name:favorite.name,color:favorite.color}:{name:'',color:'OTHER'},
        favoriteDeckStats:fields.showFavoriteDeck?{games:favoriteStats.games,wins:favoriteStats.wins,losses:favoriteStats.losses,rate:favoriteStats.rate}:{games:0,wins:0,losses:0,rate:0},
        totalStats:visibleTotal};
      await adapter.savePlayerCard(state.user.uid,card);
      state.myCard=card;render();toast('公開玩家名片已儲存。');break;
    }
    case 'create-tournament':{
      const id=await adapter.createTournament(state.groupId,state.user.uid,fields.title,fields.description||'',userLabel());
      state.modal=null;state.tab='tournaments';state.tournamentId=id;render();toast('錦標賽建立成功！');break;
    }
    case 'tournament-add':{
      if(!fields.uid)throw new Error('請選擇參賽者。');
      await adapter.changeTournament(state.groupId,state.tournamentId,state.user.uid,'add',fields.uid);
      toast('已加入參賽名單');break;
    }
    case 'auth':
      if(state.authMode==='register')await adapter.signUp(fields.email.trim(),fields.password,fields.nickname.trim());
      else await adapter.signIn(fields.email.trim(),fields.password);
      break;
    case 'create-group':{const gid=await adapter.createGroup(state.user.uid,fields.nickname,fields.name);state.groupIds=[...new Set([...state.groupIds,gid])];state.inviteId='';restartPersonalHistory();await loadGroup(gid);toast('對戰團建立成功！');break;}
    case 'join-group':{let gid=(fields.code||'').trim();if(gid.includes('://')){try{gid=new URL(gid).searchParams.get('join')||gid}catch{}}await adapter.joinGroup(state.user.uid,fields.nickname,gid);state.groupIds=[...new Set([...state.groupIds,gid])];state.inviteId='';restartPersonalHistory();history.replaceState({},'',location.pathname);await loadGroup(gid);toast('成功加入群組！');break;}
    case 'quick-setup':{
      const d=state.quickDraft;
      const match={playerA:d.playerA,playerB:d.playerB,deckA:d.playerA===GUEST_PLAYER_ID?GUEST_DECK_ID:(fields.deckA||pickDeck(d.playerA,d.deckA)),deckB:d.playerB===GUEST_PLAYER_ID?GUEST_DECK_ID:(fields.deckB||pickDeck(d.playerB,d.deckB)),
        ...(isGuestMatch(d)?{guestDeck:{name:(fields.guestDeckName||d.guestDeck?.name||'').trim(),color:fields.guestDeckColor||d.guestDeck?.color||'OTHER'}}:{})};
      assertMatch({...match,winner:d.playerA},state.players,state.decks,{allowGuest:isPersonal()});
      if(d.timerEnabled){
        const id=await adapter.createQuickMatch(state.groupId,state.user.uid,match);
        state.quickSessionId=id;state.quickCreate=false;state.quickPending=null;state.quickResultOpen=false;
        render();toast('30 分鐘對戰已建立，點選玩家的「回合開始」啟動計時。');
      } else {state.quickCreate=false;state.quickPending=match;state.quickResultOpen=true;render();}
      break;
    }
    case 'quick-result':{
      const winner=fields.winner,note=fields.note||'';
      if(state.quickPending){
        assertMatch({...state.quickPending,winner},state.players,state.decks,{allowGuest:isPersonal()});
        parsePlayedAt(fields.playedAt);
        await adapter.addMatch(state.groupId,state.user.uid,{...state.quickPending,winner,note,playedAt:fields.playedAt});
      } else {
        const selected=state.quickMatches.find(x=>x.id===state.quickSessionId);
        if(!selected)throw new Error('找不到計時中的對戰，請重整頁面。');
        if(![selected.playerA,selected.playerB].includes(winner))throw new Error('無效的勝者。');
        await adapter.finishQuickMatch(state.groupId,state.quickSessionId,state.user.uid,winner,note);
      }
      state.quickPending=null;state.quickResultOpen=false;state.quickCreate=true;state.quickSessionId='';
      state.tab='matches';render();toast('對戰結果已儲存！');
      break;
    }
    case 'new-match':{
      const {guestDeck:_unused,...draft}=state.draft;
      parsePlayedAt(fields.playedAt);
      const payload={...draft,playedAt:fields.playedAt,note:fields.note||'',deckA:draft.playerA===GUEST_PLAYER_ID?GUEST_DECK_ID:fields.deckA||'',deckB:draft.playerB===GUEST_PLAYER_ID?GUEST_DECK_ID:fields.deckB||'',
        ...(isGuestMatch(draft)?{guestDeck:{name:(fields.guestDeckName||state.draft.guestDeck?.name||'').trim(),color:fields.guestDeckColor||state.draft.guestDeck?.color||'OTHER'}}:{})};
      assertMatch(payload,state.players,state.decks,{allowGuest:isPersonal()});
      await adapter.addMatch(state.groupId,state.user.uid,payload);state.modal=null;state.tab='matches';render();toast('成功登錄一場對戰！');break;
    }
    case 'save-deck':{
      const data={...state.draft,name:fields.name.trim(),ownerUid:state.user.uid};
      if(!data.name||data.name.length>42)throw new Error('請填寫 1–42 字元的牌組名稱。');
      if(!COLORS.some(c=>c.id===data.color))throw new Error('請選擇有效的牌組顏色。');
      if(data.ownerUid!==state.user.uid)throw new Error('只能在自己的帳號下管理牌組。');
      if(data.id)await adapter.updateDeck(state.groupId,data.id,data);else await adapter.addDeck(state.groupId,state.user.uid,data);
      state.modal=null;state.tab='decks';render();toast('牌組已儲存！');break;
    }
    case 'ask-rule':{
      const question=(fields.question||'').trim();if(question.length<6)throw new Error('請輸入完整問題。');
      state.rulesEdition=fields.edition;state.rulesQuestion=question;state.rulesReply='正在查詢…';render();
      const response=await adapter.askRule(question,fields.edition);
      state.rulesReply=response;render();toast('Gemini 已回覆。');break;
    }
    }
  });
});
async function init(){
  const watchId=params.get('watch');
  if(watchId){
    if(!/^[a-zA-Z0-9_-]{12,80}$/.test(watchId)){state.publicWatchError='觀賽連結格式不正確。';publicWatchPage();return;}
    try{
      adapter=configured?(await import('./firebase-adapter.js')).firebaseAdapter:demoAdapter;
      adapter.subscribePublicTournament(watchId,t=>{state.publicTournament=t;state.publicWatchError=t?'':'找不到賽事或公開資料尚未建立。';publicWatchPage();},err=>{state.publicWatchError=readableError(err);publicWatchPage();});
      publicWatchPage();return;
    }catch(err){state.publicWatchError=readableError(err);publicWatchPage();return;}
  }
  if(!configured){adapter=demoAdapter;state.user=null;authPage();return}
  try{const mod=await import('./firebase-adapter.js');adapter=mod.firebaseAdapter;adapter.onAuth(afterAuth);}
  catch(error){console.error(error);app.innerHTML=`<div class="intro-box"><h2>Firebase 初始化失敗</h2><p>${e(readableError(error))}</p><p>請檢查 firebase-config.js 的專案設定，並確認已啟用 Authentication 與 Firestore。</p></div>`;}
}
init();
