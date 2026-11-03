import { firebaseConfig, aiSettings } from './firebase-config.js';
import { COLORS, colorOf, safeText as e, shortId, formatDate, assertMatch, computeStats } from './core.mjs';
import { demoAdapter } from './demo-adapter.js';
import { QUICK_MATCH_LIMIT_MS, quickClock, mmss } from './quick-core.mjs';

const $=q=>document.querySelector(q);
const safeStoreGet=k=>{try{return localStorage.getItem(k)}catch{return null}};
const safeStoreSet=(k,v)=>{try{localStorage.setItem(k,v)}catch{}};
const app=$('#app');
const configured=Boolean(firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.appId);
const params=new URLSearchParams(location.search);
let adapter=null, unsub=()=>{}, toastTimer;
const state={user:null,groupId:'',groupIds:[],group:null,players:[],decks:[],matches:[],tab:'overview',modal:null,draft:{},filter:'ALL',playerFilter:'',inviteId:params.get('join')||'',authMode:'login',preview:false,rulesReply:'',rulesQuestion:'',rulesEdition:'繁體中文版',busy:false,quickMatches:[],quickSessionId:'',quickCreate:true,quickDraft:{},quickPending:null,quickResultOpen:false};
const player=id=>state.players.find(x=>x.id===id);
const playerName=id=>player(id)?.nickname||'未知玩家';
const deck=id=>state.decks.find(x=>x.id===id);
const deckName=id=>deck(id)?.name||'已封存牌組';
const icon={overview:'◈',matches:'⚔',decks:'▤',players:'♟',rules:'✦',quick:'⏱'};
const pathIcon=(i)=>icon[i]||'◈';
const getStats=()=>computeStats(state.players,state.decks,state.matches);
const isOwner=()=>state.group?.createdBy===state.user?.uid;
const guardedImage=src=>typeof src==='string' && /^data:image\/(webp|jpeg);base64,[A-Za-z0-9+/=]+$/.test(src) ? src : '';
const userLabel=()=>player(state.user?.uid)?.nickname||state.user?.displayName||state.user?.email?.split('@')[0]||'玩家';
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
  const names=state.groupIds.map(id=>`<option value="${e(id)}">${e(id)}</option>`).join('');
  app.innerHTML=`<div class="auth-screen"><section class="auth-side"><div class="logo" style="margin:0;padding:0"><span class="logo-icon">UA</span> UA <span class="arena">ARENA</span></div><h1>一起記錄<br><span>每場勝負。</span></h1><p>建立專屬的朋友對戰團，或使用朋友傳來的邀請代碼加入，一起累積戰績。</p></section><section class="auth-panel"><div class="auth-form"><div class="label-up">YOUR PLAY GROUP</div><h2 style="margin-top:14px">建立或加入對戰團</h2><p>帳號：${e(state.user?.email||'展示使用者')}</p>${state.groupIds.length?`<div class="field"><label>切換現有群組</label><select id="group-select"><option value="">請選擇群組</option>${names}</select></div><button class="btn btn-ghost btn-full" data-action="select-existing-group">進入現有群組</button><div class="divider"></div>`:''}<form data-form="create-group"><div class="field"><label>你的暱稱</label><input name="nickname" required maxlength="24" value="${escapeAttr(state.user?.displayName||'')}" placeholder="其他人會看到這個名字" /></div><div class="field"><label>群組名稱</label><input name="name" required minlength="2" maxlength="40" placeholder="例如：週五 UA 對戰團" /></div><button class="btn btn-primary btn-full" type="submit">建立我的對戰團 →</button></form><div class="divider"></div><form data-form="join-group"><div class="field"><label>朋友分享的群組代碼</label><input name="code" required value="${e(state.inviteId)}" placeholder="貼上邀請代碼" /></div><div class="field"><label>你的玩家暱稱</label><input name="nickname" required maxlength="24" value="${escapeAttr(state.user?.displayName||'')}" placeholder="例如：Samuel" /></div><button class="btn btn-ghost btn-full" type="submit">加入朋友的對戰團</button></form><button class="btn btn-ghost btn-full" style="margin-top:16px" data-action="logout">登出</button></div></section></div>`;
}
const menu=[['overview','總覽'],['quick','Quick Match'],['matches','戰績紀錄'],['decks','我的牌組'],['players','玩家排行'],['rules','規則 AI']];
function shell(content){
  app.innerHTML=`<div class="shell"><aside class="sidebar"><div class="logo"><span class="logo-icon">UA</span><span>UA <span class="arena">ARENA</span></span></div><div class="nav-group">MAIN MENU</div>${menu.map(([id,title])=>`<button class="nav ${state.tab===id?'active':''}" data-tab="${id}"><span class="ico">${pathIcon(id)}</span>${title}</button>`).join('')}<div class="sidebar-bottom"><button class="nav" data-action="share-invite"><span class="ico">↗</span>邀請朋友</button><button class="nav" data-action="switch-group"><span class="ico">⇄</span>切換群組</button><button class="nav" data-action="logout"><span class="ico">⇥</span>登出</button><div class="profile"><span class="avatar">${e(userLabel()[0]?.toUpperCase()||'U')}</span><div class="who"><b>${e(userLabel())}</b><small>${e(state.user?.email||'本機展示模式')}</small></div></div></div></aside><main class="main"><div class="topbar"><div class="mobile-head">UA <span>ARENA</span></div><div class="top-label"><span class="label-up">YOUR BATTLESPACE</span></div><div class="top-actions"><button class="group-pill" data-action="share-invite">⌘ ${e(state.group?.name||'對戰團')} ▾</button>${adapter?.mode==='demo'?'<span class="tag">DEMO</span>':''}<button class="circle-action" data-action="share-invite" title="分享群組連結">↗</button></div></div>${adapter?.mode==='demo'?'<div class="setup-banner" style="margin-top:16px">展示模式：資料只保存在此瀏覽器。如需多人登入共用，請依 README 連接 Firebase。</div>':''}<div class="page">${content}<div class="copyright">UA ARENA · Community battle tracker · 非 BANDAI 官方網站</div></div></main><nav class="mobile-nav">${menu.map(([id,title])=>`<button data-tab="${id}" class="${state.tab===id?'active':''}"><span class="icon">${pathIcon(id)}</span>${title==='Quick Match'?'速配':title==='我的牌組'?'牌組':title==='戰績紀錄'?'戰績':title==='玩家排行'?'排行':title==='規則 AI'?'規則':'總覽'}</button>`).join('')}</nav></div>${renderModal()}`;
}
function overviewPage(){
  const s=getStats(),me=s.players.find(x=>x.id===state.user?.uid)||{games:0,wins:0,rate:0,favorite:null};
  return `<div class="page-head"><div><div class="label-up">DASHBOARD / OVERVIEW</div><h1 style="margin-top:7px">歡迎回到競技場，${e(userLabel())}。</h1><p>你的每一次對決，都在這裡留下足跡。</p></div><button class="btn btn-primary" data-action="new-match">＋ 登錄對戰</button></div><section class="hero"><div class="hero-content"><div class="eyebrow">YOUR NEXT MATCH STARTS HERE</div><h2>下一場，誰會拿下勝利？</h2><p>不論是你自己參戰，還是幫朋友代填，都能快速登錄兩位玩家的對戰結果。</p><button class="btn btn-primary btn-sm" data-action="open-quick">⏱ Quick Match</button></div></section><div class="metrics"><div class="metric"><div class="metric-label">團隊累積對戰</div><div class="metric-num">${n(s.totalMatches)}</div><div class="metric-foot">ALL MATCHES</div></div><div class="metric"><div class="metric-label">我的勝率</div><div class="metric-num mint">${percent(me.rate)}</div><div class="metric-foot">PERSONAL WIN RATE</div></div><div class="metric"><div class="metric-label">我的勝場</div><div class="metric-num purple">${n(me.wins)}</div><div class="metric-foot">VICTORIES</div></div><div class="metric"><div class="metric-label">牌組收藏數</div><div class="metric-num gold">${n(state.decks.filter(x=>x.active!==false).length)}</div><div class="metric-foot">ALL ACTIVE DECKS</div></div></div><div class="two-col"><section class="card"><div class="section-head"><h3>⚔ 最近對戰</h3><button class="text-link" data-tab="matches">查看全部 →</button></div>${recentList(s.activeMatches.slice().sort((a,b)=>dateNum(b.createdAt)-dateNum(a.createdAt)).slice(0,6))}</section><section class="card"><div class="section-head"><h3>♛ 勝場排行榜</h3><button class="text-link" data-tab="players">完整排行 →</button></div>${leaderRows(s.leaderboard.slice(0,5))}</section></div>`;
}
function dateNum(d){return d?.seconds?d.seconds*1000:(d?.toDate?.()?.getTime?.()||new Date(d||0).getTime()||0)}
function recentList(matches){if(!matches.length)return `<div class="empty"><span class="empty-icon">⚔</span><h3>還沒有對戰紀錄</h3><p>先記錄第一場，讓戰績開始累積。</p><button class="btn btn-primary btn-sm" data-action="new-match">登錄第一場</button></div>`;
return matches.map(m=>`<div class="match-row"><div class="match-icon">⚔</div><div class="match-pair"><strong>${e(playerName(m.playerA))} <span class="muted">vs</span> ${e(playerName(m.playerB))}</strong><small>${e(deckName(m.deckA))} ／ ${e(deckName(m.deckB))} · ${formatDate(m.createdAt)}${m.timing?.enabled?` · ⏱ ${mmss(m.timing.playerAMs)} / ${mmss(m.timing.playerBMs)}`:''}</small></div><span class="win-badge">🏆 ${e(playerName(m.winner))}</span></div>`).join('')}
function leaderRows(players){if(!players.length)return `<div class="empty">尚無玩家</div>`;return players.map((p,i)=>`<button class="leaderboard-item" style="width:100%;border-left:0;border-right:0;border-top:0;background:transparent;color:inherit;text-align:left" data-action="player-detail" data-id="${e(p.id)}"><span class="rank">${String(i+1).padStart(2,'0')}</span><span class="avatar" style="width:31px;height:31px;font-size:12px">${e(p.nickname?.[0]||'?')}</span><span class="name">${e(p.nickname)} <small>· ${n(p.games)} 場</small></span><span class="pct">${p.wins} 勝</span></button>`).join('')}
function matchesPage(){
  const all=[...state.matches].sort((a,b)=>dateNum(b.createdAt)-dateNum(a.createdAt));
  const selected=state.playerFilter?all.filter(m=>m.playerA===state.playerFilter||m.playerB===state.playerFilter):all;
  const rows=selected.map(m=>`<tr><td><span class="mono muted">${e(shortId(m.id))}</span><br><span class="muted">${formatDate(m.createdAt)}</span></td><td><strong>${e(playerName(m.playerA))}</strong><div class="muted">${e(deckName(m.deckA))}</div></td><td>VS</td><td><strong>${e(playerName(m.playerB))}</strong><div class="muted">${e(deckName(m.deckB))}</div></td><td><span class="result-chip">🏆 ${e(playerName(m.winner))}</span></td><td>${m.timing?.enabled?`<button class="btn btn-ghost btn-sm" data-action="quick-select" data-id="${e(m.quickMatchId)}" title="查看每回合詳細用時">⏱ ${mmss(m.timing.playerAMs)} / ${mmss(m.timing.playerBMs)}</button>`:'<span class="muted">未計時</span>'}</td><td><span class="muted">${e(playerName(m.recordedBy))}</span></td><td>${m.status==='void'?'<span class="tag">已撤銷</span>':(m.recordedBy===state.user?.uid||isOwner())?`<button class="btn btn-ghost btn-sm" data-action="void-match" data-id="${e(m.id)}">撤銷</button>`:'<span class="tag">有效</span>'}</td></tr>`).join('');
  return `<div class="page-head"><div><div class="label-up">MATCH HISTORY / BATTLE LOG</div><h1 style="margin-top:7px">對戰紀錄</h1><p>完整追蹤每一場勝負，不論誰是參賽者，都能由一位成員代為填寫。</p></div><button class="btn btn-primary" data-action="new-match">＋ 新增戰績</button></div><div class="filter-row"><select id="match-filter"><option value="">所有玩家</option>${state.players.map(p=>`<option value="${e(p.id)}" ${state.playerFilter===p.id?'selected':''}>${e(p.nickname)}</option>`).join('')}</select><span class="tag">${selected.filter(m=>m.status==='active').length} 場有效對戰</span></div><section class="card table-wrap">${!rows?'<div class="empty">目前沒有對戰紀錄</div>':`<table class="table"><thead><tr><th>比賽</th><th>玩家 A</th><th></th><th>玩家 B</th><th>勝利者</th><th>雙方用時 A / B</th><th>紀錄者</th><th>操作</th></tr></thead><tbody>${rows}</tbody></table>`}</section>`;
}
function decksPage(){
  const filtered=state.decks.filter(d=>d.active!==false && (state.filter==='ALL'||d.color===state.filter));
  return `<div class="page-head"><div><div class="label-up">DECK COLLECTION / LIBRARY</div><h1 style="margin-top:7px">牌組收藏</h1><p>收藏你與朋友的牌組，圖片、名稱與顏色，一目了然。</p></div><button class="btn btn-primary" data-action="new-deck">＋ 新增牌組</button></div><div class="filter-row"><button class="tab-chip ${state.filter==='ALL'?'active':''}" data-color-filter="ALL">全部 · ${state.decks.filter(x=>x.active!==false).length}</button>${COLORS.map(c=>`<button class="tab-chip ${state.filter===c.id?'active':''}" data-color-filter="${c.id}"><span class="dot" style="background:${c.hex};margin-right:5px"></span>${c.name}</button>`).join('')}</div><div class="deck-grid">${filtered.length?filtered.map(deckCard).join(''):`<div class="empty" style="grid-column:1/-1"><span class="empty-icon">▤</span><h3>還沒有牌組</h3><p>新增圖片、名稱與顏色，建立你的第一副牌組。</p><button class="btn btn-primary btn-sm" data-action="new-deck">新增牌組</button></div>`}</div>`;
}
function deckCard(d){const cover=guardedImage(d.imageData),canEdit=d.createdBy===state.user?.uid||d.ownerUid===state.user?.uid||isOwner();return `<article class="deck-card"><div class="deck-cover">${cover?`<img src="${cover}" alt="${e(d.name)} 封面">`:'<span class="deck-placeholder">UA</span>'}<span class="deck-color"><span class="dot" style="background:${colorOf(d.color).hex}"></span> ${e(colorOf(d.color).name)}</span></div><div class="deck-info"><h3>${e(d.name)}</h3><p>持有者：${e(playerName(d.ownerUid))}</p><div class="deck-actions">${canEdit?`<button class="btn btn-ghost btn-sm" data-action="edit-deck" data-id="${e(d.id)}">編輯</button><button class="btn btn-ghost btn-sm" data-action="archive-deck" data-id="${e(d.id)}">封存</button>`:'<span class="tag">朋友的牌組</span>'}</div></div></article>`}
function playersPage(){
  const s=getStats();const ranked=[...s.players].sort((a,b)=>b.rate-a.rate||b.wins-a.wins);
  return `<div class="page-head"><div><div class="label-up">PLAYERS / LEADERBOARD</div><h1 style="margin-top:7px">玩家戰績榜</h1><p>勝率、常用牌組與對戰成績，所有成員都能查看。</p></div><button class="btn btn-ghost" data-action="share-invite">↗ 邀請朋友加入</button></div><div class="player-grid">${ranked.map(p=>`<button class="player-card" data-action="player-detail" data-id="${e(p.id)}" style="text-align:left;color:inherit"><div class="player-line"><span class="avatar">${e(p.nickname?.[0]||'?')}</span><div><strong>${e(p.nickname)}</strong><p class="muted sm">${p.id===state.user?.uid?'你自己':p.role==='owner'?'群組建立者':'對戰成員'}</p></div></div><div class="big-rate">${p.rate}% <span class="muted sm">WIN RATE</span></div><div class="bar-track"><div class="bar-fill" style="width:${p.rate}%"></div></div><div class="row-stats" style="margin-top:15px"><span><b>${p.games}</b> 場</span><span><b>${p.wins}</b> 勝</span><span><b>${p.losses}</b> 敗</span><span>${e(p.favorite?.name||'尚無牌組')}</span></div></button>`).join('')||'<div class="empty">尚無玩家</div>'}</div>`;
}
function rulesPage(){
  return `<div class="page-head"><div><div class="label-up">RULE ENGINE / AI ASSISTANT</div><h1 style="margin-top:7px">UA 規則助手</h1><p>只討論 UNION ARENA。請明確提供卡號、版本與完整效果文字，判斷會更準確。</p></div></div><div class="two-col"><section class="card"><div class="section-head"><h3>✦ 問 Gemini 一個規則問題</h3><span class="tag">${adapter?.aiEnabled?'AI 已啟用':'需要啟用 AI'}</span></div><div class="alert">AI 答覆不是官方裁定。系統已設定 UA 專屬提示，但目前未建立官方 FAQ 檢索資料庫；有爭議時仍應以適用版本的官方規則為準。</div><form data-form="ask-rule" style="margin-top:20px"><div class="field"><label>適用卡牌版本</label><select name="edition">${['繁體中文版','日文版','英文版','簡體中文版','混合版本'].map(v=>`<option ${state.rulesEdition===v?'selected':''}>${v}</option>`).join('')}</select></div><div class="field" style="margin-top:16px"><label>你的問題</label><textarea name="question" required minlength="6" maxlength="900" placeholder="例如：對手回合能否使用起動主要？如果涉及特定卡片，請提供卡號與效果文字。">${e(state.rulesQuestion)}</textarea></div><button class="btn btn-primary" type="submit" style="margin-top:14px" ${adapter?.aiEnabled?'':'disabled'}>✦ 送出問題</button></form>${state.rulesReply?`<div class="ai-results">${e(state.rulesReply)}</div>`:''}${!adapter?.aiEnabled?'<div class="hint" style="margin-top:12px">請依 README 啟用 Firebase AI Logic 並設定 App Check，按鈕才會生效；不可直接把 Gemini API Key 寫在公開的 GitHub Pages 原始碼中。</div>':''}</section><aside class="card"><h3>官方規則參考</h3><p class="muted sm" style="margin-top:10px">混合版本不代表所有語系的規則自動一致。遇到牌組與卡牌效果問題，請先指定版本。</p><div class="divider"></div><div class="source-links" style="flex-direction:column"><a target="_blank" rel="noopener noreferrer" href="https://www.unionarena-tcg.com/tc/rules/">↗ UA 繁體中文官方規則</a><a target="_blank" rel="noopener noreferrer" href="https://www.unionarena-tcg.com/na/faq/">↗ UA 英文版官方 FAQ</a><a target="_blank" rel="noopener noreferrer" href="https://www.unionarena-tcg.com/jp/">↗ UA 日文官方網站</a></div></aside></div>`;
}
function pickerOptions(players,selected,exclude=''){return players.filter(p=>p.id!==exclude).map(p=>`<option value="${e(p.id)}" ${selected===p.id?'selected':''}>${e(p.nickname)}</option>`).join('')}
function deckOptions(uid,chosen){return state.decks.filter(d=>d.ownerUid===uid&&d.active!==false).map(d=>`<option value="${e(d.id)}" ${chosen===d.id?'selected':''}>${e(d.name)} · ${e(colorOf(d.color).name)}</option>`).join('')}
function matchModalBody(){
  const d=state.draft;
  const pa=player(d.playerA),pb=player(d.playerB);
  return `<div class="mode-note">⚔ 每場只需一個人填寫。玩家 A 預設為你，但可以改成群組中任意兩位成員；系統會保存實際提交者。</div><form data-form="new-match"><div class="form-grid"><div class="field"><label>玩家 A</label><select name="playerA" id="player-a">${pickerOptions(state.players,d.playerA)}</select></div><div class="field"><label>玩家 B</label><select name="playerB" id="player-b">${pickerOptions(state.players,d.playerB,d.playerA)}</select></div><div class="field"><label>玩家 A 牌組</label><select name="deckA" id="deck-a">${deckOptions(d.playerA,d.deckA)}</select>${!deckOptions(d.playerA,d.deckA)?'<div class="hint">該玩家目前沒有牌組，請先新增牌組。</div>':''}</div><div class="field"><label>玩家 B 牌組</label><select name="deckB" id="deck-b">${deckOptions(d.playerB,d.deckB)}</select>${!deckOptions(d.playerB,d.deckB)?'<div class="hint">該玩家目前沒有牌組，請先新增牌組。</div>':''}</div><div class="field field-full"><label>本場勝者</label><div class="winner-options"><button class="winner-option ${d.winner===d.playerA?'selected':''}" type="button" data-action="pick-winner" data-winner="A">🏆 ${e(pa?.nickname||'玩家 A')}</button><button class="winner-option ${d.winner===d.playerB?'selected':''}" type="button" data-action="pick-winner" data-winner="B">🏆 ${e(pb?.nickname||'玩家 B')}</button></div></div><div class="field field-full"><label>備註（選填）</label><textarea name="note" maxlength="200" placeholder="例如：三局兩勝決賽、朋友聚會…">${e(d.note||'')}</textarea></div></div><div class="modal-footer"><button type="button" class="btn btn-ghost" data-action="close-modal">取消</button><button type="submit" class="btn btn-primary" ${state.players.length<2?'disabled':''}>儲存戰績 →</button></div></form>`;
}
function deckModalBody(){const d=state.draft;return `<form data-form="save-deck"><div class="field"><label>牌組圖片</label><div class="upload" id="deck-upload">${guardedImage(d.imageData)?`<img src="${guardedImage(d.imageData)}" alt="牌組圖片預覽">`:'<div style="font-size:33px">▧</div><strong>點擊上傳牌組圖片</strong><span class="sm muted">將壓縮後儲存，建議使用自己的照片或獲授權圖片</span>'}<input name="cover" type="file" accept="image/*" aria-label="上傳牌組圖片" /></div></div><div class="field mt"><label>牌組名稱</label><input name="name" required minlength="1" maxlength="42" value="${e(d.name||'')}" placeholder="例如：紫色魯夫" /></div><div class="field mt"><label>牌組持有者</label><select name="ownerUid">${pickerOptions(state.players,d.ownerUid)}</select><div class="hint">可替群組內其他人建立牌組；實際建立者會另外記錄。</div></div><div class="field mt"><label>牌組顏色</label><div class="color-choices">${COLORS.map(c=>`<button type="button" class="color-choice ${d.color===c.id?'selected':''}" data-action="pick-deck-color" data-color="${c.id}"><span class="dot" style="background:${c.hex}"></span>${c.name}</button>`).join('')}</div></div><div class="modal-footer"><button class="btn btn-ghost" type="button" data-action="close-modal">取消</button><button class="btn btn-primary" type="submit">${d.id?'儲存修改':'建立牌組'} →</button></div></form>`}
function playerModalBody(){const stats=getStats().players.find(p=>p.id===state.draft.id);if(!stats)return '<div class="empty">找不到玩家</div>';const de=stats.deckStats.sort((a,b)=>b.games-a.games);return `<div class="player-line"><span class="avatar" style="width:52px;height:52px;font-size:22px">${e(stats.nickname?.[0]||'?')}</span><div><h2>${e(stats.nickname)}</h2><p class="muted sm">${stats.id===state.user?.uid?'你的個人戰績':'群組玩家戰績'}</p></div></div><div class="stats-detail"><div class="stats-cell"><b>${stats.games}</b><span>總場次</span></div><div class="stats-cell"><b>${stats.wins}</b><span>勝場</span></div><div class="stats-cell"><b>${stats.rate}%</b><span>勝率</span></div></div><div class="section-head"><h3>牌組表現</h3></div><div class="match-row"><div class="match-pair">最常用的牌組</div><strong class="sm">${e(stats.favorite?.name||'尚無資料')}</strong></div><div class="match-row"><div class="match-pair">勝場最多的牌組</div><strong class="sm">${e(stats.mostWins?.name||'尚無資料')}</strong></div><div class="match-row"><div class="match-pair">敗場最多的牌組</div><strong class="sm">${e(stats.mostLosses?.name||'尚無資料')}</strong></div>${de.length?`<div class="divider"></div><h3 style="margin-bottom:15px">各牌組成績</h3>${de.map(d=>`<div class="match-row"><div class="match-pair"><strong>${e(d.name)}</strong><small>${d.games} 場 · ${d.wins} 勝 ${d.losses} 敗</small></div><span class="win-badge">${Math.round(d.wins/d.games*100)}%</span></div>`).join('')}`:''}`}
function renderModal(){if(!state.modal)return '';let title,body;switch(state.modal){case 'match':title='新增對戰紀錄';body=matchModalBody();break;case 'deck':title=state.draft.id?'編輯牌組':'新增牌組';body=deckModalBody();break;case 'player':title='玩家詳細戰績';body=playerModalBody();break;case 'invite':title='邀請朋友';body=`<p class="muted sm">將連結傳給朋友，對方註冊登入後就能加入你的對戰群組。具有連結的人可申請加入，請只傳給信任的朋友。</p><div class="divider"></div><label>對戰團名稱</label><div class="group-pill" style="display:inline-block;margin-bottom:17px">${e(state.group?.name)}</div><label>邀請連結</label><div class="invite-id"><span class="mono">${e(inviteUrl())}</span><button class="btn btn-primary btn-sm" data-action="copy-invite">複製</button></div><div class="hint">好友完成登入後即可進入群組；同一個帳號可參加多個群組。</div>`;break;default:body='';title='';}
  return `<div class="modal-backdrop" data-action="backdrop"><div class="modal" role="dialog" aria-modal="true" aria-label="${e(title)}"><div class="modal-header"><h2>${e(title)}</h2><button class="close" data-action="close-modal" aria-label="關閉視窗">✕</button></div>${body}</div></div>`;
}
function ensureQuickDraft(force=false){
  if(!force && state.quickDraft.playerA && state.players.some(p=>p.id===state.quickDraft.playerA))return;
  const a=state.players.find(p=>p.id===state.user?.uid)?.id||state.players[0]?.id||'';
  const b=state.players.find(p=>p.id!==a)?.id||'';
  state.quickDraft={playerA:a,playerB:b,deckA:pickDeck(a),deckB:pickDeck(b),timerEnabled:true};
}
function quickSetupPage(){
  ensureQuickDraft();const d=state.quickDraft;
  return `<section class="card quick-form"><div class="section-head"><h3>快速建立一場對戰</h3><span class="tag">由任何一位群組成員操作</span></div>
    <form data-form="quick-setup"><div class="form-grid"><div class="field"><label>玩家 A</label><select name="playerA">${pickerOptions(state.players,d.playerA)}</select></div>
    <div class="field"><label>玩家 B</label><select name="playerB">${pickerOptions(state.players,d.playerB,d.playerA)}</select></div>
    <div class="field"><label>玩家 A 使用牌組</label><select name="deckA">${deckOptions(d.playerA,d.deckA)}</select></div>
    <div class="field"><label>玩家 B 使用牌組</label><select name="deckB">${deckOptions(d.playerB,d.deckB)}</select></div>
    </div><label class="quick-switch"><input type="checkbox" name="timerEnabled" ${d.timerEnabled?'checked':''}/><span><strong>開啟 30 分鐘回合計時</strong><small>每回合須按「回合開始／結束」，分別統計兩位玩家花費的時間。關閉時直接填寫勝負。</small></span></label>
    <div class="modal-footer" style="padding-bottom:0"><button type="submit" class="btn btn-primary">${d.timerEnabled?'建立計時對戰 →':'直接輸入勝負 →'}</button></div></form></section>`;
}
function quickResultForm(s){
  const timed=Boolean(s),d=s||state.quickPending;
  if(!d)return '';
  return `<section class="card quick-form"><div class="section-head"><h3>🏆 登錄勝負結果</h3><button class="btn btn-ghost btn-sm" data-action="${timed?'quick-result-close':'quick-new'}">取消</button></div>
    <p class="muted sm">${e(playerName(d.playerA))}（${e(deckName(d.deckA))}） VS ${e(playerName(d.playerB))}（${e(deckName(d.deckB))}）</p>
    ${timed?`<p class="hint">提交時會自動結束目前回合，儲存每回合及兩位玩家累計用時。時間用完不會自動判定勝者。</p>`:''}
    <form data-form="quick-result"><div class="field mt"><label>本場勝利者</label><select name="winner" required><option value="${e(d.playerA)}">🏆 ${e(playerName(d.playerA))}</option><option value="${e(d.playerB)}">🏆 ${e(playerName(d.playerB))}</option></select></div>
    <div class="field mt"><label>備註（選填）</label><textarea name="note" maxlength="200" placeholder="例如：時間到、加賽等"></textarea></div>
    <button class="btn btn-primary" type="submit" style="margin-top:15px">確認儲存結果 →</button></form></section>`;
}
function quickSessionPage(s){
 const c=quickClock(s);const playing=s.status==='ready'||s.status==='running';const timedDone=s.status==='finished';
 const total=mmss(c.remainingMs);
 const turnRows=(s.turns||[]).slice().reverse().map((t,i)=>`<tr><td>${s.turns.length-i}</td><td>${e(playerName(t.playerId))}</td><td class="mono">${mmss(t.durationMs)}</td></tr>`).join('');
 return `<section class="card quick-session"><div class="section-head"><h3>⏱ ${e(playerName(s.playerA))} VS ${e(playerName(s.playerB))}</h3><span class="tag">${timedDone?'已完成':s.status==='cancelled'?'已取消':s.status==='ready'?'等待開始':'進行中'}</span></div>
 <div class="quick-clock ${c.expired?'expired':''}"><span>30:00 總倒數</span><strong class="qm-time-left">${total}</strong><small class="qm-time-state">${c.expired?'時間已到，請登錄結果':!s.startedAtMs?'由第一位玩家點選回合開始後啟動':s.activePlayer?`目前回合：${e(playerName(s.activePlayer))}`:'等待下一位玩家開始回合'}</small></div>
 <div class="quick-players">${[s.playerA,s.playerB].map((id,i)=>`<div class="quick-player ${s.activePlayer===id?'is-active':''}"><div class="quick-player-name">${e(playerName(id))}</div><div class="muted sm">${e(deckName(i===0?s.deckA:s.deckB))}</div><div class="quick-player-time ${i===0?'qm-player-a':'qm-player-b'}">${mmss(i===0?c.playerAMs:c.playerBMs)}</div>
 ${playing?(s.activePlayer===id?`<button class="btn btn-primary btn-full" data-action="quick-turn-end">■ 回合結束</button>`:s.activePlayer?`<button class="btn btn-ghost btn-full" disabled>等待對手結束</button>`:`<button class="btn btn-primary btn-full" data-action="quick-turn-start" data-player="${e(id)}" ${c.expired?'disabled':''}>▶ 回合開始</button>`):''}</div>`).join('')}</div>
 <div class="hint">兩人累計用時不包含回合間空檔。總計時不因關閉頁面而停止；同一群組的其他裝置也會同步回合操作。這是朋友間的用時參考，並非防作弊裁判計時。</div>
 <div class="quick-summary"><span>已完成回合：<b>${c.turns}</b></span><span>未歸屬空檔：<b class="qm-gap">${mmss(c.unattributedMs)}</b></span></div>
 ${playing?`<button class="btn btn-primary btn-full" data-action="quick-result-open" style="margin-top:18px">🏆 結束對戰並登錄結果</button><button class="btn btn-ghost btn-full" style="margin-top:8px" data-action="quick-cancel">取消本場（不計勝負）</button>`:''}
 ${(s.turns||[]).length?`<div class="divider"></div><h3 class="quick-history-title">回合用時紀錄</h3><div class="table-wrap"><table class="table"><thead><tr><th>回合</th><th>玩家</th><th>花費時間</th></tr></thead><tbody>${turnRows}</tbody></table></div>`:''}
 </section>${state.quickResultOpen && playing?quickResultForm(s):''}`;
}
function quickPage(){
 const active=state.quickMatches.filter(x=>x.status==='ready'||x.status==='running').sort((a,b)=>(b.createdAtMs||0)-(a.createdAtMs||0));
 const selected=state.quickMatches.find(x=>x.id===state.quickSessionId)||(!state.quickCreate?active[0]:null);
 if(selected && !state.quickSessionId)state.quickSessionId=selected.id;
 return `<div class="page-head"><div><div class="label-up">QUICK MATCH / 30-MINUTE CLOCK</div><h1 style="margin-top:7px">Quick Match</h1><p>選擇雙方牌組，決定是否啟用 30 分鐘計時；記錄每位玩家每一回合的用時。</p></div><button class="btn btn-primary" data-action="quick-new">＋ 新對戰</button></div>
 ${state.players.length<2?`<section class="card"><div class="empty">請先邀請至少兩位玩家加入群組。</div></section>`:state.quickPending?quickResultForm(null):state.quickCreate?quickSetupPage():selected?quickSessionPage(selected):quickSetupPage()}
 ${state.quickMatches.length?`<section class="card quick-session-list"><div class="section-head"><h3>計時場次（可跨裝置恢復）</h3><span class="tag">${state.quickMatches.length} 場</span></div><div class="quick-list">${[...state.quickMatches].sort((a,b)=>b.createdAtMs-a.createdAtMs).slice(0,20).map(s=>`<button class="quick-list-row ${selected?.id===s.id?'selected':''}" data-action="quick-select" data-id="${e(s.id)}"><span>${e(playerName(s.playerA))} vs ${e(playerName(s.playerB))}</span><small>${s.status==='finished'?'已完成':s.status==='ready'?'待開始':s.status==='running'?'計時中':'已取消'} · ${mmss(quickClock(s).remainingMs)} 剩餘</small></button>`).join('')}</div></section>`:''}`;
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
function render(){if(!state.user){authPage();return}if(!state.groupId){setupPage();return}const pages={overview:overviewPage,quick:quickPage,matches:matchesPage,decks:decksPage,players:playersPage,rules:rulesPage};shell((pages[state.tab]||overviewPage)())}
function openModal(kind,draft={}){state.modal=kind;state.draft=draft;render()}
function pickDeck(uid){return state.decks.find(d=>d.ownerUid===uid&&d.active!==false)?.id||''}
function newMatch(){if(state.players.length<2){toast('至少需要兩位已加入的玩家才能紀錄。',true);return}const pa=state.players.find(p=>p.id===state.user.uid)?.id||state.players[0].id;const pb=state.players.find(p=>p.id!==pa)?.id||'';openModal('match',{playerA:pa,playerB:pb,deckA:pickDeck(pa),deckB:pickDeck(pb),winner:pa,note:''});}
function newDeck(d={}){if(!state.players.length){toast('請先建立群組或邀請玩家。',true);return}openModal('deck',{id:d.id||'',ownerUid:d.ownerUid||state.user.uid,name:d.name||'',color:d.color||'PURPLE',imageData:d.imageData||''});}
async function loadGroup(gid){
  unsub();unsub=()=>{};state.groupId='';state.group=await adapter.getGroup(gid);
  state.groupId=gid;state.tab='overview';state.players=[];state.decks=[];state.matches=[];state.quickMatches=[];state.quickSessionId='';state.quickCreate=true;state.quickResultOpen=false;state.quickPending=null;
  safeStoreSet(`ua-arena-last-${state.user.uid}`,gid);
  unsub=adapter.subscribe(gid,snapshot=>{state.players=snapshot.members;state.decks=snapshot.decks;state.matches=snapshot.matches;state.quickMatches=snapshot.quickMatches||[];render()},error=>toast(readableError(error),true));
  render();
}
async function afterAuth(user){
  state.user=user;state.groupId='';state.modal=null;
  if(!user){unsub();state.groupIds=[];render();return}
  try{
    state.groupIds=await adapter.getMyGroups(user.uid);
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
  case 'switch-group':unsub();state.groupId='';state.inviteId='';render();break;
  case 'select-existing-group':{const gid=$('#group-select')?.value;if(gid)await runBusy(async()=>await loadGroup(gid));else toast('請先選擇群組。',true);break}
  case 'new-match':newMatch();break;
  case 'open-quick':state.tab='quick';state.modal=null;state.quickCreate=true;state.quickPending=null;state.quickResultOpen=false;ensureQuickDraft();render();break;
  case 'quick-new':state.quickCreate=true;state.quickSessionId='';state.quickPending=null;state.quickResultOpen=false;ensureQuickDraft(true);render();break;
  case 'quick-select':state.tab='quick';state.quickSessionId=el.dataset.id;state.quickCreate=false;state.quickPending=null;state.quickResultOpen=false;render();break;
  case 'quick-result-open':state.quickResultOpen=true;render();break;
  case 'quick-cancel':if(confirm('放棄這場計時對戰？不會產生勝負紀錄，計時資料將保留為已取消。'))await runBusy(async()=>{await adapter.changeQuickMatch(state.groupId,state.quickSessionId,state.user.uid,'cancel');toast('已取消計時對戰。')});break;
  case 'quick-result-close':state.quickResultOpen=false;render();break;
  case 'quick-turn-start':await runBusy(async()=>{await adapter.changeQuickMatch(state.groupId,state.quickSessionId,state.user.uid,'start',el.dataset.player);toast('回合已開始計時。')});break;
  case 'quick-turn-end':await runBusy(async()=>{await adapter.changeQuickMatch(state.groupId,state.quickSessionId,state.user.uid,'end');toast('已記錄本回合用時。')});break;
  case 'new-deck':newDeck();break;
  case 'edit-deck':{const d=deck(el.dataset.id);if(d)newDeck(d);break;}
  case 'archive-deck':if(confirm('封存這副牌組？歷史對戰會保留，但不能用於新對戰。'))await runBusy(async()=>{await adapter.archiveDeck(state.groupId,el.dataset.id);toast('牌組已封存。')});break;
  case 'void-match':if(confirm('確定撤銷這筆紀錄？它會保留稽核痕跡，但不計入統計。'))await runBusy(async()=>{await adapter.voidMatch(state.groupId,el.dataset.id);toast('已撤銷對戰紀錄。')});break;
  case 'player-detail':openModal('player',{id:el.dataset.id});break;
  case 'share-invite':openModal('invite');break;
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
  if(target.name==='cover'&&target.files?.[0]){
    await runBusy(async()=>{state.draft.imageData=await imageToCompressedDataUrl(target.files[0]);render();toast('圖片已壓縮並準備儲存。')});return;
  }
  if(state.modal==='deck'&&target.name==='ownerUid'){state.draft.ownerUid=target.value;return;}
  if(state.tab==='quick' && state.quickCreate && target.closest('[data-form="quick-setup"]')){
    const d=state.quickDraft;
    if(target.name==='playerA'){d.playerA=target.value;if(d.playerB===d.playerA)d.playerB=state.players.find(p=>p.id!==d.playerA)?.id||'';d.deckA=pickDeck(d.playerA);d.deckB=pickDeck(d.playerB);}
    else if(target.name==='playerB'){d.playerB=target.value;d.deckB=pickDeck(d.playerB);}
    else if(target.name==='deckA'||target.name==='deckB')d[target.name]=target.value;
    else if(target.name==='timerEnabled')d.timerEnabled=target.checked;
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
});
app.addEventListener('input',event=>{if(state.modal==='match'&&event.target.name==='note')state.draft.note=event.target.value;if(state.modal==='deck'&&event.target.name==='name')state.draft.name=event.target.value;});
app.addEventListener('submit',event=>{
  const form=event.target.closest('form[data-form]');if(!form)return;event.preventDefault();
  const fields=Object.fromEntries(new FormData(form));
  runBusy(async()=>{
    switch(form.dataset.form){
    case 'auth':
      if(state.authMode==='register')await adapter.signUp(fields.email.trim(),fields.password,fields.nickname.trim());
      else await adapter.signIn(fields.email.trim(),fields.password);
      break;
    case 'create-group':{const gid=await adapter.createGroup(state.user.uid,fields.nickname,fields.name);state.groupIds=[...new Set([...state.groupIds,gid])];state.inviteId='';await loadGroup(gid);toast('對戰團建立成功！');break;}
    case 'join-group':{let gid=(fields.code||'').trim();if(gid.includes('://')){try{gid=new URL(gid).searchParams.get('join')||gid}catch{}}await adapter.joinGroup(state.user.uid,fields.nickname,gid);state.groupIds=[...new Set([...state.groupIds,gid])];state.inviteId='';history.replaceState({},'',location.pathname);await loadGroup(gid);toast('成功加入群組！');break;}
    case 'quick-setup':{
      const d=state.quickDraft;
      const match={playerA:d.playerA,playerB:d.playerB,deckA:d.deckA,deckB:d.deckB};
      assertMatch({...match,winner:d.playerA},state.players,state.decks);
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
        assertMatch({...state.quickPending,winner},state.players,state.decks);
        await adapter.addMatch(state.groupId,state.user.uid,{...state.quickPending,winner,note});
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
      const payload={...state.draft,note:fields.note||'',deckA:fields.deckA||'',deckB:fields.deckB||''};
      assertMatch(payload,state.players,state.decks);
      await adapter.addMatch(state.groupId,state.user.uid,payload);state.modal=null;state.tab='matches';render();toast('成功登錄一場對戰！');break;
    }
    case 'save-deck':{
      const data={...state.draft,name:fields.name.trim(),ownerUid:fields.ownerUid};
      if(!data.name||data.name.length>42)throw new Error('請填寫 1–42 字元的牌組名稱。');
      if(!COLORS.some(c=>c.id===data.color))throw new Error('請選擇有效的牌組顏色。');
      if(!state.players.some(p=>p.id===data.ownerUid))throw new Error('找不到牌組持有者。');
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
  if(!configured){adapter=demoAdapter;state.user=null;authPage();return}
  try{const mod=await import('./firebase-adapter.js');adapter=mod.firebaseAdapter;adapter.onAuth(afterAuth);}
  catch(error){console.error(error);app.innerHTML=`<div class="intro-box"><h2>Firebase 初始化失敗</h2><p>${e(readableError(error))}</p><p>請檢查 firebase-config.js 的專案設定，並確認已啟用 Authentication 與 Firestore。</p></div>`;}
}
init();
