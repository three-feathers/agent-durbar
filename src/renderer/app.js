/* Agent Durbar renderer: office view, list view, chat panel, live + demo + simulated data.
   Plain script (no modules) so it runs in the sandboxed Electron renderer and in a plain browser. */
(function(){
'use strict';
const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const FLOOR_MARK='durbar:floor-switch'; let floorSwitchTimed=false; /* spec 033 SC-003: see startFloorSwitchTiming */
const THEME=window.THEME; /* theme packs (specs 035-040): tokens, words, motion; every scene colour reads a semantic token */
const T_=n=>THEME.token(n);
const wordOf=k=>THEME.word(k);
const qs = new URLSearchParams(location.search);
const NO_REDACT=qs.has('sim')&&qs.get('noredact')==='1'; /* spec 041 FR-065 test only (simulator): the page as if the redact module were missing, to check it fails closed */
/* spec 052 FR-084: Command (⌘) on a Mac, Ctrl elsewhere; keys are shown per platform (src/renderer/keys.js) */
const KEYS=window.DurbarKeys;
const IS_MAC=KEYS.isMac(navigator.platform);
const keyText=parts=>KEYS.keyText(parts,IS_MAC), keyLabels=parts=>KEYS.keyLabels(parts,IS_MAC), ariaKeys=parts=>KEYS.ariaKeys(parts,IS_MAC);
/* spec 074 (issue 548): the keyboard navigator. Its shortcut is a display preference of this window (localStorage, like the detail
   level); default Ctrl+F, ⌘F on a Mac (Ctrl+J until 2026-10-23, issue 587). The pure parts (levels, matching, chat numbers, clash check) are in navigator.js. */
const NAV=window.DurbarNav, NAVKEY_KEY='durbar.navKey';
let NAV_KEY=(()=>{try{return NAV.loadCombo(localStorage.getItem(NAVKEY_KEY),IS_MAC);}catch(e){return Object.assign({},NAV.DEFAULT_COMBO);}})();
const navKeyParts=()=>NAV.comboParts(NAV_KEY), navKeyText=()=>keyText(navKeyParts());
function setNavKey(c){
  NAV_KEY=c?{mod:!!c.mod,ctrl:!!c.ctrl,alt:!!c.alt,shift:!!c.shift,code:c.code}:Object.assign({},NAV.DEFAULT_COMBO);
  try{if(c&&!NAV.sameCombo(NAV_KEY,NAV.DEFAULT_COMBO))localStorage.setItem(NAVKEY_KEY,JSON.stringify(NAV_KEY));else localStorage.removeItem(NAVKEY_KEY);}catch(e){}
  scheduleRender(); /* the badges' tooltips name the shortcut */
}
let navRecording=false; /* Settings > Keyboard is recording a combination: the shortcut does not open the navigator meanwhile */
/* FR-011: chat numbers, per session id, lowest free number; kept on this computer (ids only) outside the simulator and the demo */
const CHATNO_KEY='durbar.chatNo';
let CHATNO={}, CHATNO_FOR=null;
function syncChatNos(){
  if(CHATNO_FOR!==agents){CHATNO_FOR=agents;CHATNO={};if(!demoOn&&rememberOn()){try{CHATNO=NAV.loadNumbers(localStorage.getItem(CHATNO_KEY));}catch(e){CHATNO={};}}}
  const ids=agents.filter(a=>!a.parent).map(a=>a.id);
  /* once the office has loaded, a session that is gone frees its number (before that, restored sessions keep theirs reserved) */
  const next=NAV.assignNumbers(agentsListed||demoOn?NAV.pruneNumbers(CHATNO,ids):CHATNO,ids);
  if(JSON.stringify(next)!==JSON.stringify(CHATNO)){CHATNO=next;if(!demoOn&&rememberOn()){try{localStorage.setItem(CHATNO_KEY,JSON.stringify(CHATNO));}catch(e){}}}
}
const chatNoOf=a=>{if(!a||a.parent)return 0;if(CHATNO_FOR!==agents||!(a.id in CHATNO))syncChatNos();return CHATNO[a.id]||0;};
/* FR-012: the badge "C3" (text, not colour); the element around it carries the words ("chat 3") */
const chatNoHTML=a=>{const n=chatNoOf(a);return n?`<span class="chatno" data-n="C${n}" aria-hidden="true" title="Chat ${n}: ${esc(navKeyText())}, then C ${n}"></span>`:'';}; /* the text is CSS content: it stays out of the desk's own text (names come first there) */
const chatNoWords=a=>{const n=chatNoOf(a);return n?', chat '+n:'';};
const INBOX_KEY=keyText(['mod','shift','A']), NEXT_KEY=keyText(['mod','shift','N']), PAL_KEY=keyText(['mod','K']);
/* spec 006 FR-036: show or hide Previous sessions (H for history) */
const PREV_KEYS=['mod','shift','H'], PREV_KEY=keyText(PREV_KEYS);
const ADD_KEY=keyText(['mod','O']), ADDWS_KEY=keyText(['mod','shift','O']); /* spec 052 FR-164: + Folder, + Workspace (the Mac File menu has the same keys) */
/* spec 052 FR-085: the window's platform from the preload (the Mac title bar styles are gated on html[data-platform="darwin"]) */
if(window.agentDurbar&&window.agentDurbar.platform==='darwin')document.documentElement.dataset.platform='darwin';
/* spec 052 FR-085 (issue 591): the Mac title bar is hidden; a double-click on a drag area (not on a control) zooms like a title bar */
if(window.agentDurbar&&window.agentDurbar.platform==='darwin'&&window.agentDurbar.titleDoubleClick)document.addEventListener('dblclick',e=>{
  if(KEYS.shouldSendTitleDoubleClick(e.target))window.agentDurbar.titleDoubleClick();
});
/* the keys written in index.html are the Windows/Linux ones: rewrite them for a Mac */
if(IS_MAC){document.querySelectorAll('[aria-keyshortcuts]').forEach(el=>el.setAttribute('aria-keyshortcuts',KEYS.ariaFor(el.getAttribute('aria-keyshortcuts'),true)));
  document.querySelectorAll('[data-keys-text]').forEach(el=>{if(el.title)el.title=KEYS.textFor(el.title,true);for(const n of el.querySelectorAll('small'))n.textContent=KEYS.textFor(n.textContent,true);});}
const DEMO_LIB = window.DURBAR_DEMO;
const {L,S} = DEMO_LIB;
const N_MAIN = Math.max(8, Math.min(15, parseInt(qs.get('n')||'12',10)));
const FORCE_DENSITY = ['full','roomy','card','mini','micro'].includes(qs.get('density')) ? qs.get('density') : null;

/* ---------------- demo data ---------------- */
let ROOMS = DEMO_LIB.ROOMS;
let agents = DEMO_LIB.AGENTS.filter(a=>!DEMO_LIB.EXTRA_IDS.includes(a.id) || DEMO_LIB.EXTRA_IDS.indexOf(a.id) < N_MAIN-12);
if(N_MAIN<12){const drop=['hugo','priya','noor','maya'].slice(0,12-N_MAIN);agents=agents.filter(a=>!drop.includes(a.id));}
agents = agents.map(a=>Object.assign({paused:false,label:null},a));
const byId = id=>agents.find(a=>a.id===id);
const roomOf = a => ROOMS.find(r=>r.id===(a.parent?byId(a.parent).room:a.room));
const wsOf = a => roomOf(a).id;
const helpersOf = a => agents.filter(x=>x.parent===a.id);
/* usage totals (spec 011 FR-018..FR-021): one run-long ledger, one record per `usage` event, never decreased */
const LEDGER=window.DurbarUsage.createLedger();
const ledgerRemoved=()=>LEDGER.hasUnlisted()||LEDGER.roomIds().some(id=>{const r=ROOMS.find(x=>x.id===id);return !r||r.hidden;});
/* Totals saved before this run (spec 011 FR-027, issue #21): asked from the main process once agents exist, and again when one is added
   (its folder may have a saved total). The baseline is frozen in main, so asking again never double counts what this run recorded. */
let baselineQueued=false, baselineAsking=0, usageSaveError='';
function loadUsageBaseline(){
  if(baselineQueued||!bridge||!bridge.usageTotals)return; baselineQueued=true;
  setTimeout(()=>{baselineQueued=false;baselineAsking++;bridge.usageTotals().then(v=>{if(v&&v.ok){LEDGER.setBaseline(v);usageSaveError=typeof v.error==='string'?v.error:'';scheduleRender();}}).catch(()=>{}).finally(()=>{baselineAsking--;});},50);
}
/* After "Reset usage totals" in Settings: this run's figures and the baseline both start from zero. */
function onUsageReset(view){LEDGER.clearRun();LEDGER.setBaseline(view&&view.ok?view:{});usageSaveError=view&&typeof view.error==='string'?view.error:'';scheduleRender();}
const recordUsage=(a,e)=>{const r=roomOf(a);if(r)LEDGER.record(r.id,e);};
/* ---- floors (spec 033): ordered groups of rooms; a floor that is off is hidden exactly like a hidden folder ---- */
/* spend of the rooms on floors that are off: still in the office total, named in its tooltip (FR-016) */
/* same since-reset totals as the room headers (spec 011 FR-027: the folder key adds the saved baseline) */
const offFloorSpend=()=>window.DurbarUsage.sum(ROOMS.filter(r=>!floorOn(r.floor)).map(r=>{const f=folderOfRoom(r.id);return LEDGER.room(r.id,f&&f.key);}));
let FLOORS=null; /* {floors:[{id,name,on,ground}],lastFloor,byAgent} from the bridge; null = no floors (demo mode, older bridge) */
const floorsLive=()=>!!FLOORS&&!demoOn;
const floorById=id=>floorsLive()?(FLOORS.floors.find(f=>f.id===id)||FLOORS.floors.find(f=>f.ground)||null):null;
const floorOn=id=>{const f=floorById(id);return !f||f.on;};
const roomShown=r=>!!r&&!r.hidden&&floorOn(r.floor);
const floorsOnList=()=>floorsLive()?FLOORS.floors.filter(f=>f.on):[];
const floorTagsOn=()=>floorsOnList().length>1;
const floorRank=r=>{const f=floorById(r.floor);return f?FLOORS.floors.indexOf(f):0;};
/* rooms in floor order; inside a floor, the order they were added (stable) */
const roomsInOrder=()=>ROOMS.map((r,i)=>[r,i]).sort((x,y)=>floorRank(x[0])-floorRank(y[0])||x[1]-y[1]).map(p=>p[0]);
const floorTag=r=>{if(!floorTagsOn())return '';const f=floorById(r.floor);return f?`<span class="floor-tag" title="Floor: ${esc(f.name)}">${esc(f.name)}</span>`:'';};
/* the dollar estimates of the agents whose kind reports them (Claude Code), in a room or the whole office */
/* spec 052 FR-044 (#315): the Tools > Cost rows, one per folder. period 'run' = since the app opened (or the last reset), 'since' = the
   saved totals plus this run. Claude's dollar estimate and the tokens come from the sessions open now (this run only). */
function costData(period){
  const since=LEDGER.since(),run=period!=='since'||!since;
  if(demoOn)return {since,period:run?'run':'since',rows:[],office:null};
  const live=agents.filter(a=>!a.parent&&a.usage);
  const rows=ROOMS.map(r=>{const f=folderOfRoom(r.id),t=run?LEDGER.roomRun(r.id):LEDGER.room(r.id,(f&&f.key)||r.path),mine=live.filter(a=>a.room===r.id);
    return {id:r.id,name:r.name,path:r.path,nano:t.nano,calls:t.calls,unreported:t.unreported,usd:usdEstimates(r.id),
      tokens:mine.reduce((n,a)=>n+(a.usage.inT||0)+(a.usage.outT||0),0),tokensOnly:mine.some(a=>a.info&&a.info.adapterId==='codex')};});
  return {since,period:run?'run':'since',rows,office:run?LEDGER.officeRun():LEDGER.office()};
}
function usdEstimates(roomId){return agents.filter(a=>!a.parent&&a.usage&&(!roomId||a.room===roomId)&&usageCaps(a).costUsd&&!usageCaps(a).nanoAiu).reduce((n,a)=>n+(a.usage.usd||0),0);}
function aiuChip(){
  const t=LEDGER.office(); if(!t.calls||demoOn)return '';
  /* spec 052 FR-028 (#307): one unit, money: Copilot credits at USD 0.01 plus Claude's own estimates; the split is in the tooltip (FR-168: it is built there, within 300 characters) */
  const usd=usdEstimates(), aiu=t.nano/1e9, none=t.unreported>=t.calls&&!usd;
  const tipOpts={scope:'office',removed:ledgerRemoved(),since:LEDGER.since(),run:LEDGER.officeRun(),offFloors:offFloorSpend(),estimate:'≈ '+fmtMoney(aiu*AIU_USD+usd)+' = '+aiu.toFixed(2)+' AIU'+(usd?' + '+fmtMoney(usd)+' Claude (est.)':'')+'. Codex: no cost.'};
  const tip2=window.DurbarUsage.tooltip(t,tipOpts),tipFull=window.DurbarUsage.tooltip(t,{...tipOpts,full:true});
  const inner=none?'<span class="l">cost not reported</span>':`<span class="l">≈</span><b>${esc(fmtMoney(aiu*AIU_USD+usd))}</b>`;
  return `<span class="stat stat-aiu" role="note" title="${esc(tip2)}" aria-label="${esc(tipFull.replace(/\n/g,' '))}">${inner}</span>`;
}
/* ---- how an agent is doing (spec 034, issue #20): the body follows the context window, trouble gets a drawing ---- */
const MOODS=window.DurbarMood;
const MOOD=MOODS.createMoodTracker();
const ACT=window.DurbarActivity;
let SERIOUS=false; /* Serious mode (Settings): no mood drawings at all */
/* spec 052 FR-069: Serious mode also stops every looping animation (styles.css, html[data-serious]) */
function markSerious(){document.documentElement.toggleAttribute('data-serious',SERIOUS);}
/* spec 052 FR-031 (#306): detail level. Simple hides the developer details (tokens, model and context chips, paths, MCP, VS Code, resume
   command) and says what agents do in plain verbs; Expert is everything. A display preference of this window (localStorage). */
let SIMPLE=(()=>{try{return localStorage.getItem('durbar.detail')==='simple';}catch(e){return false;}})();
function setDetail(level){SIMPLE=level==='simple';try{localStorage.setItem('durbar.detail',SIMPLE?'simple':'expert');}catch(e){}document.body.classList.toggle('simple',SIMPLE);relabelScopes();relabelEdits();renderDefaultsChip();renderAll();if(ui.selected){updatePanelHeader();const s=byId(ui.selected);if(s)updateCtxChip(liveRoot(s));fitToolbar();}}
/* spec 052 FR-099 (round 10): Spacing, Comfortable or Compact. Compact tightens the chrome only (chat, screens, dialogs, inbox); the top bar,
   desk cards, rooms and the lobby never change. A display preference of this window (localStorage), like the detail level. */
let DENSITY=(()=>{try{return localStorage.getItem('durbar.density')==='compact'?'compact':'comfortable';}catch(e){return 'comfortable';}})();
function markDensity(){if(DENSITY==='compact')document.documentElement.setAttribute('data-density','compact');else document.documentElement.removeAttribute('data-density');}
function setDensity(v){DENSITY=v==='compact'?'compact':'comfortable';try{localStorage.setItem('durbar.density',DENSITY);}catch(e){}markDensity();}
markDensity();
const PLACE_VERB={library:'Reading notes',software:'Searching files',terminal:'Running a command',web:'Searching the web',other:'Using a tool'}; /* FR-037: words for people who do not write code */
let AMB_ID=null;   /* the one agent that has the ambulance (the most recent error), chosen once per render */
const NO_MOOD={body:'normal',trouble:null,pct:null,words:''};
function moodFor(a){
  if(SERIOUS||!a||a.parent||!a.live)return NO_MOOD;
  const c=STATS.agent(a.id).ctx, pct=c&&c.limit>0?window.DurbarStats.ctxLevel(c.tokens,c.limit).pct:null;
  const st=vis(a), body=MOODS.bodyOf(pct), failStreak=MOOD.failStreak(a.id);
  const waitingMs=st==='waiting'?MOOD.waitingMs(a.id):0; /* only while the figure is waiting: a request answered elsewhere must not leave it tapping */
  const coffee=!!a.coffee&&a.coffeeKind!=='cap'; /* spec 068 FR-005: calm on a coffee break, with a cup; spec 001 FR-035: calm at the Bank, no cup */
  const trouble=MOODS.troubleOf({state:st,ambulance:AMB_ID===a.id,limit:!!a.limit,waitingMs,failStreak,coffee:!!a.coffee});
  return {body,trouble,pct,coffee,words:MOODS.phrases({body,pct,trouble,waitingMs,failStreak,coffee}).join(', ')};
}
/* spec 052 FR-021: a problem that is not a status (stuck on failing tools, memory nearly full) also shows on the card's pill, in any mood
   setting: it is information, not decoration. '' when there is none. */
function cardWarn(a,pill){
  if(!a||a.parent||!a.live)return '';
  const c=STATS.agent(a.id).ctx, pct=c&&c.limit>0?window.DurbarStats.ctxLevel(c.tokens,c.limit).pct:null, fs=MOOD.failStreak(a.id);
  const out=[];
  if(MOODS.bodyOf(pct)==='monster')out.push('Context almost full ('+pct+'%)');
  if(!(pill&&isFailing(a))&&MOODS.troubleOf({state:vis(a),ambulance:false,limit:false,waitingMs:0,failStreak:fs})==='dizzy')out.push(fs+' tool calls failed in a row');
  return out.join('; ');
}
/* spec 052 FR-062: a pill that says "Failing" already tells the streak, so its ⚠ is left for the other warnings */
const pillWarn=a=>{const w=cardWarn(a,true);return w?`<span class="pwarn" title="${esc(w)}" aria-hidden="true">⚠</span>`:'';};
const moodWords=a=>{const w=moodFor(a).words;return w?' — '+esc(w):'';};
const pickAmbulanceId=()=>MOODS.pickAmbulance(agents.filter(x=>x.live&&!x.parent&&roomShown(roomOf(x))).map(x=>({id:x.id,state:vis(x),errorAt:MOOD.errorAt(x.id)})));
/* a room takes the tone of its worst main agent; the siren is on while it has the ambulance or a fainted agent (spec 034 delta, issue #135) */
const NO_ALERT={tone:'calm',siren:false};
function roomAlert(r){
  if(SERIOUS||!r)return NO_ALERT;
  return MOODS.roomAlertOf(agents.filter(a=>!a.parent&&a.live&&a.room===r.id).map(a=>{const m=moodFor(a);return {state:vis(a),body:m.body,trouble:m.trouble};}));
}
const ALERT_WORDS='Alert: an agent needs help';
/* Theme (specs 035-040): apply an id or manifest, clear the scene cache, re-render, persist. */
/* spec 052 FR-070: a theme change cross-fades (a view transition of the whole window, 240ms in CSS). None under reduced motion, at
   boot, or without the API. Chromium runs the callback on the next frame, not at once, so callers wait for it; drivers that call
   THEME.setTheme() themselves are not affected. A transition that is skipped still runs the callback. */
function swapView(fn,instant){
  if(instant||reducedMotion()||typeof document.startViewTransition!=='function'){fn();return Promise.resolve();}
  try{const vt=document.startViewTransition(fn);return vt.updateCallbackDone.catch(()=>{});}catch(e){fn();return Promise.resolve();}
}
async function applyTheme(idOrManifest,instant){
  let applied=null;
  await swapView(()=>{applied=THEME.setTheme(idOrManifest);SC_CACHE.clear();renderAll();},instant===true);
  if(applied==null){applied=THEME.setTheme(idOrManifest);SC_CACHE.clear();renderAll();} /* the callback did not run (should not happen) */
  if(bridge&&bridge.setTheme){
    const r=await bridge.setTheme(typeof idOrManifest==='string'?idOrManifest:applied).catch(()=>null);
    if(r&&!r.ok)toast('The theme could not be saved.',4000);
  }
  if(applied==='clean-office'&&typeof idOrManifest==='string'&&idOrManifest!=='clean-office')toast('Unknown theme <b>'+esc(idOrManifest)+'</b> — back to Clean Office.',4200);
  else toast('Theme: <b>'+esc(THEME.list().find(t=>t.id===applied)?.name||applied)+'</b>.',2600);
}
const SIREN=()=>'<span class="siren" aria-hidden="true"><svg viewBox="0 0 14 14" focusable="false"><rect class="siren-light" x="3" y="2" width="8" height="6.5" rx="3.2"/><rect x="1.5" y="8.5" width="11" height="3" rx="1" fill="'+T_('--siren-base')+'"/></svg></span>';
/* "impatient" starts after 60 s without any event, so look every few seconds and redraw only when somebody's mood changed */
let moodSig='';
setInterval(()=>{if(SERIOUS||demoOn)return;const sig=agents.map(x=>x.live&&!x.parent?moodFor(x).trouble+'/'+moodFor(x).body:'').join('|');if(sig!==moodSig){moodSig=sig;scheduleRender();}},5000);
/* spec 052 FR-062: "Last activity" labels follow the clock through the normal render, every 30 s and only when a label changed */
let agoSig='';
setInterval(()=>{if(demoOn)return;const sig=agents.map(x=>(x.lastEventAt?ACT.agoShort(Date.now()-x.lastEventAt):'')+(x.busySince?'/'+ACT.agoShort(Date.now()-x.busySince):'')).join('|');if(sig!==agoSig){agoSig=sig;scheduleRender();}},30000);
/* ---- places in the office (spec 024): a shared lobby; main agents walk to the place of the tool they are using ---- */
const VISITS=window.DurbarPlaces.createVisits();
const SEEN_SERVERS=new Set(); /* MCP server names seen in tool events this run (per-folder extras included): the Places settings list them */
let CUSTOM=[]; /* the user's own places [{id,name,icon}] (spec 024 FR-018), from the settings; changed only through setCustomPlaces */
const customIds=()=>CUSTOM.map(p=>p.id);
/* One name for a place everywhere it is shown (tile, card text, Settings options, toasts). A custom place shows the user's own text; callers escape it. */
const fixedPlace=id=>window.DurbarPlaces.IDS.includes(id)||window.DurbarPlaces.SPECIAL.includes(id); /* built-ins, coffee corner, Boss, Bank, Postbox: theme words */
const placeLabel=id=>fixedPlace(id)?wordOf('place-'+id):window.DurbarPlaces.placeName(id,CUSTOM);
/* spec 052 FR-013: a themed place name with its plain name, for tooltips and screen readers ("Cartridge Bay (Software library)") */
const placeLabelFull=id=>{const t=placeLabel(id);if(!fixedPlace(id)||!THEME.plainWord)return t;const p=THEME.plainWord('place-'+id);return p&&p!==t?t+' ('+p+')':t;};
let PLACE_MAP={}; /* MCP server name -> place id | 'desk' (global setting); unmapped servers use the built-in rules */
const RETURNING=new Set(); /* agents whose figure is still walking back to the desk: the desk keeps its empty chair until it arrives */
const PLACE_ICON={
  library:'<svg class="pic" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 16.5V4h3.5v12.5zM6.5 16.5V6h3.5v10.5zM10.5 16.5l3-11.5 3.4.9-3 11.4zM2 16.5h16"/></svg>',
  software:'<svg class="pic" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3.5" width="14" height="5" rx="1.5"/><rect x="3" y="11.5" width="14" height="5" rx="1.5"/><path d="M6 6h.01M6 14h.01M10 6h4M10 14h4"/></svg>',
  terminal:'<svg class="pic" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2.5" y="3.5" width="15" height="13" rx="2"/><path d="M6 8l3 2.5L6 13M11 13h3.5"/></svg>',
  web:'<svg class="pic" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="10" cy="10" r="7"/><path d="M3 10h14M10 3c2.5 2.2 2.5 11.8 0 14M10 3c-2.5 2.2-2.5 11.8 0 14"/></svg>',
  coffee:'<svg class="pic" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 8.5h10v4.2a4 4 0 0 1-4 4h-2a4 4 0 0 1-4-4z"/><path d="M13.5 9.5h1.2a2.2 2.2 0 0 1 0 4.4h-1.6M6.5 2.8c-.8 1 .8 1.8 0 3M10 2.8c-.8 1 .8 1.8 0 3"/></svg>', /* spec 068: the coffee corner */
  /* spec 001 FR-034/FR-035/FR-038: the Boss's door with its name plate, the Bank's columns, the Postbox */
  boss:'<svg class="pic" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.5 17.5V3.5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v14M2.5 17.5h15"/><path d="M7.5 6h5"/><circle cx="12.6" cy="11" r=".9" fill="currentColor" stroke="none"/></svg>',
  bank:'<svg class="pic" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 7.5L10 3l7.5 4.5zM4.5 8.5v6M8 8.5v6M12 8.5v6M15.5 8.5v6M2.5 17h15"/></svg>',
  postbox:'<svg class="pic" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 9.5a4 4 0 0 1 8 0v7.5H3z"/><path d="M11 9.5h6v7.5h-6M7 17v1.5M5 9.5h4"/><path d="M14 9.5V4.5h3v2h-3"/></svg>',
  other:'<svg class="pic" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="10" cy="10" r="2.6"/><path d="M10 2.5v2.4M10 15.1v2.4M2.5 10h2.4M15.1 10h2.4M4.7 4.7l1.7 1.7M13.6 13.6l1.7 1.7M15.3 4.7l-1.7 1.7M6.4 13.6l-1.7 1.7"/></svg>',
};
const placeIcon=p=>{
  if(!PLACE_ICON[p.id])return window.DurbarPlaceIcons.iconSvg(p.icon);
  const art=THEME.slot('place-'+p.id);
  if(art===null)return PLACE_ICON[p.id];
  return `<svg class="pic" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><g class="art-slot" data-slot="place-${p.id}">${art}</g></svg>`;
};
const lobbyArt=()=>{
  const v=THEME.slot('lobby-art');
  return v===null?'':`<svg class="lobby-art" data-slot="lobby-art" viewBox="0 0 320 36" preserveAspectRatio="none" aria-hidden="true" focusable="false">${v}</svg>`;
};
/* the lobby's tiles (spec 001 FR-039): the places with the Boss in the middle of the row, then the coffee corner (spec 068), the Bank and the
   Postbox (only where the app has schedules, not in the demo); the fixed tiles are never mapping choices */
const postShown=()=>!!(bridge&&bridge.listSchedules)&&!demoOn;
const lobbyPlaces=()=>{const D=window.DurbarPlaces,ps=D.allPlaces(CUSTOM),m=new Map(ps.map(p=>[p.id,p]));return D.lobbyOrder(ps.map(p=>p.id),postShown()).map(id=>m.get(id)||{id,name:''});};
const lobbyOn=()=>!demoOn&&agents.some(a=>a.live&&!a.parent);
const MAX_TILES=8, canAddPlace=()=>!!(bridge&&bridge.addPlace)&&window.DurbarPlaces.allPlaces(CUSTOM).length<MAX_TILES;
/* who is at a place and visible under the current filters (a hidden room or a filtered-out agent has no figure) */
const placeVisitors=pid=>{const ids=VISITS.occupants(pid).filter(id=>{const a=byId(id),r=a&&!a.parent&&roomOf(a);return roomShown(r)&&(ui.ws==='all'||wsOf(a)===ui.ws)&&matchStatus(a);});
  /* spec 001 FR-034: the Boss's queue is in the order the agents started waiting (the inbox's NEED_SINCE, oldest first) */
  if(pid===window.DurbarPlaces.BOSS){const t=id=>{const v=NEED_SINCE.get(id);return v==null?Infinity:v;};ids.sort((x,y)=>t(x)-t(y));}
  return ids;};
const isAway=a=>!a.parent&&(!!VISITS.at(a.id)||RETURNING.has(a.id));
const taskOf=a=>{const v=a.parent?null:VISITS.at(a.id),D=window.DurbarPlaces;if(v&&(v.place===D.COFFEE||v.place===D.BANK))return taskText(a);
  if(v&&v.place===D.BOSS)return wordOf('boss-note')+' · '+taskText(a); /* spec 001 FR-034: the empty desk's small note */return v?(SIMPLE?(PLACE_VERB[v.place]||'Using a tool')+' · '+taskText(a):'At '+placeLabel(v.place)+': '+visitDoing(a,v)+' · '+taskText(a)):taskText(a);};
/* spec 001 FR-036, spec 041 FR-065: the desk card's title and accessible name mask agent text before any cut (a token cut mid-way no longer
   matches a token shape). Through DurbarSafeText (safeMask); without redact the title keeps only the name and the label drops the text (fail closed). */
const deskMask=t=>safeMask(t); /* the one mask (DurbarSafeText, FR-065): unescaped, Markdown-aware, '' when redact is missing */
const deskTip=a=>{const full=a.name+' · '+(a.profile?a.profile.name+' · '+a.role:a.role)+kindTag(a)+remoteTag(a)+' · '+stWord(a)+': '+taskOf(a),m=deskMask(full);
  return DurbarCutText.cutText(m||a.name,200);};
/* A result of addPlace/updatePlace/removePlace (or a settings read): the places and the map as they are now. Agents standing at a place that is gone
   go back to their desk at once (spec 024 FR-025); a rename or an icon change only redraws. */
function setCustomPlaces(list,map){
  const old=CUSTOM; CUSTOM=Array.isArray(list)?list:[];
  old.filter(p=>!CUSTOM.some(q=>q.id===p.id)).forEach(p=>VISITS.dropPlace(p.id));
  if(map&&typeof map==='object')PLACE_MAP=map;
  scheduleRender();
}
/* spec 001 FR-036: what a visitor does at a place, in a few words: the live readout of its tool without the verb (masked, FR-031), else the
   tool or server of the visit; in Simple the plain place words (never a command). */
const VERB_RE=/^(Running|Reading|Editing|Searching|Opening|Using)\s+/;
const PLACE_DOING=new Map(); /* agent id -> its newest tool call in a few masked words ("npm test", "github list_pull_requests") */
function visitDoing(a,v){
  const D=window.DurbarPlaces;
  if(v.place===D.COFFEE||v.place===D.BANK)return coffeeUntilWords(a)||coffeeWord(); /* spec 068: on a break, not a tool call; FR-035: the cap at the Bank */
  if(v.place===D.BOSS){const w=bossWait(a.id);return (v.label==='q'?'question':'asks for your OK')+(w?' · '+w:'');} /* FR-034 */
  if(SIMPLE)return PLACE_VERB[v.place]||'Using a tool';
  return (liveOn()&&PLACE_DOING.get(a.id))||v.label||PLACE_VERB[v.place]||'Using a tool'; /* the command only with Live activity on desks (FR-028), else the tool's name (review on PR 511) */
}
/* spec 001 FR-034: how long an agent has waited, short ("12 min") */
/* the inbox's own wording (ATT.waitLabel, "waiting 12 min") without its verb, so the Boss and the inbox say the same (review on PR 511) */
const bossWait=id=>{const t=NEED_SINCE.get(id);if(t==null)return '';const w=ATT.waitLabel(Math.max(0,Date.now()-t)).replace(/^waiting /,'');return w==='less than a minute'?'<1 min':w;};
const BADGE_KEY='<svg viewBox="0 0 12 12" width="9" height="9" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true" focusable="false"><circle cx="4" cy="6" r="2.4"/><path d="M6.4 6H11M9.4 6v2M11 6v1.6"/></svg>';
/* Who is at a place: "name (folder): activity". The accessible names keep the whole words; with `cut` (tooltips, spec 052 FR-168, review on
   PR 511) the name (30), folder (22) and activity (40) are cut with an ellipsis, so an entry's title stays within 120 characters with
   " Open the chat." */
const visitorWords=(a,v,cut)=>{const C=cut?DurbarCutText.cutText:(t=>String(t)),n=C(a.name,30);
  if(v&&(v.place===window.DurbarPlaces.COFFEE||v.place===window.DurbarPlaces.BANK)){const u=coffeeUntilWords(a);return n+(u?' ('+C(u,40)+')':'');}
  const r=roomOf(a);return n+(r?' ('+C(r.name,22)+')':'')+(v?': '+C(visitDoing(a,v),40):'');};
/* A place tile's title: at most 4 names (each cut), then "and N more", then the longest wait at the Boss; one line, well under 300 characters */
const placeTip=(pid,ids,wait)=>{const C=DurbarCutText.cutText,nm=ids.slice(0,4).map(id=>C(byId(id).name,30)),more=ids.length-nm.length;
  return `${placeLabelFull(pid)}: ${nm.length?nm.join(', ')+(more?` and ${more} more`:''):'nobody'}${wait?'. Longest wait '+wait:''}`;};
function lobbyHTML(aw){
  if(!lobbyOn())return '';
  const D=window.DurbarPlaces, all=lobbyPlaces(), add=canAddPlace(), fit=D.lobbyFit(aw,D.allPlaces(CUSTOM).length,add,postShown());
  const own={[D.BOSS]:fit.boss,[D.COFFEE]:fit.coffee,[D.BANK]:fit.bank,[D.POSTBOX]:fit.post}; /* FR-039: the fixed tiles' own widths */
  return `<section class="lobby" data-key="lobby" aria-label="${esc(wordOf('lobby-label'))}">${all.map(p=>{
    const box=own[p.id]||null, cf=p.id===D.COFFEE, boss=p.id===D.BOSS, bank=p.id===D.BANK;
    if(p.id===D.POSTBOX)return postboxHTML(p,box);
    const named=!box||box.named, sty=box?` style="flex:0 0 ${box.width}px"`:'';
    const caps=box?box.chips:fit.caps, ids=placeVisitors(p.id);
    /* the Boss shows as many of its queue as it can: names only when everyone there fits by name, else initials (FR-034) */
    const {mode,slots:cap}=boss&&ids.length>caps.named?{mode:'initials',slots:caps.initials}:D.chipsFor(caps,ids.length);
    const sp=mode==='initials'?D.initialSpots(box?box.width:fit.tile,ids.length):D.layoutSpots(ids.length,cap), who=ids.map(id=>{const a=byId(id);return visitorWords(a,VISITS.at(id));});
    const go=boss||bank; /* FR-034/FR-035: an entry at the Boss or the Bank opens that chat at its request */
    const chips=ids.slice(0,sp.shown).map((id,i)=>{const a=byId(id),v=VISITS.at(id),w=visitorWords(a,v),t=visitorWords(a,v,true),k=boss&&v?v.label:'';
      const inner=`<span class="slot on" data-slot="${i}"></span><span class="pv-t">${mode==='named'?`<b class="pv-n">${esc(a.name)}</b><small class="pv-a">${esc(v?visitDoing(a,v):'')}</small>`:`<b class="pv-n pv-i">${esc(D.initialsOf(a.name))}</b>`}</span>`;
      return go?`<button type="button" class="pv pv-go" data-key="pv:${esc(id)}" data-visitor="${esc(id)}" data-pvopen="${esc(id)}"${k?` data-ask="${k}"`:''} title="${esc(t)}. Open the chat." aria-label="${esc(w)}. Open the chat.">${inner}</button>`
        :`<span class="pv" data-key="pv:${esc(id)}" data-visitor="${esc(id)}" title="${esc(t)}">${inner}</span>`;}).join('');
    const more=sp.more?`<button class="pv pv-more" type="button" data-key="pv-more:${esc(p.id)}" data-placemore="${esc(p.id)}" aria-haspopup="menu" title="${sp.more} more here. Open the list." aria-label="${sp.more} more at ${esc(placeLabelFull(p.id))}: ${esc(ids.slice(sp.shown).map(id=>byId(id).name).join(', '))}"><span class="slot more" data-slot="${sp.shown}">+${sp.more}</span>${mode==='named'?'<span class="pv-t"><b class="pv-n">more</b></span>':''}</button>`:'';
    const wait=boss&&ids.length?bossWait(ids[0]):''; /* FR-034: the longest wait, in the header */
    const label=`${placeLabelFull(p.id)}: ${who.length?who.join(cf||bank?', ':'; '):'nobody'}${wait?'. Longest wait '+wait:''}`; /* the accessible name: everyone there, in full (the title is placeTip) */
    return `<div class="place${ids.length?' busy':''}${cf?' coffee':''}${boss?' boss':''}${bank?' bank':''}${named?'':' unnamed'}"${sty} data-key="place:${p.id}" data-place="${p.id}" data-chips="${mode}" tabindex="-1" role="group" title="${esc(placeTip(p.id,ids,wait))}" aria-label="${esc(label)}"><span class="plh">${placeIcon(p)}${named?`<span class="pn">${esc(placeLabel(p.id))}</span>`:''}${wait?`<span class="bw" aria-hidden="true">${esc(wait)}</span>`:''}${ids.length?`<span class="pc" aria-hidden="true">${ids.length}</span>`:''}</span><span class="prow" aria-hidden="${ids.length?'false':'true'}">${ids.length?chips+more:'<span class="pv-none">nobody</span>'}</span></div>`;
  }).join('')}${add?'<button class="place-add" type="button" data-key="place-add" title="Add a place" aria-label="Add a place">+</button>':''}${lobbyArt()}</section>`;
}
/* spec 001 FR-038: the Postbox: the next three scheduled runs, the letters still due today, a flag for a missed or failed last run. A button:
   it opens Settings > Schedules. */
function postboxHTML(p,box){
  let S;try{S=SCHED;}catch(e){S={pausedAll:false,schedules:[]};} /* SCHED is declared further down */
  const D=window.DurbarPlaces, paused=!!S.pausedAll, list=S.schedules||[], next=D.postNext(list,paused).slice(0,3);
  const today=D.lettersToday(list,paused,Date.now(),(window.DurbarSchedTemplates||{}).nextRuleRun), miss=D.postMissed(list), named=!box||box.named;
  const line=x=>{const room=ROOMS.find(r=>folderKeyOf(r)===x.s.folder), fold=room?room.name:(String(x.s.folder||'').split(/[\\/]/).filter(Boolean).pop()||'');
    return {short:clock(x.t)+' · '+safeExcerpt(x.s.prompt,60,''), full:clock(x.t)+' · '+fold+' · '+safeExcerpt(x.s.prompt,200,''), long:clock(x.t)+' · '+fold+' · '+safeExcerpt(x.s.prompt,60,'')};};
  const ls=next.map(line), empty=paused?'All paused':'No letters';
  const sum=(today?today+' today':'none today')+(miss?', '+miss+' missed':'');
  const label=`${placeLabelFull(p.id)}: ${sum}. ${ls.length?'Next: '+ls.map(l=>l.full).join('; '):empty}. Open Settings > Schedules.`;
  return `<button type="button" class="place postbox${miss?' flagged':''}${named?'':' unnamed'}" style="flex:0 0 ${box?box.width:200}px" data-key="place:${p.id}" data-place="${p.id}" data-post="1" title="${esc(label)}" aria-label="${esc(label)}">`
    +`<span class="pb-l"><span class="plh">${placeIcon(p)}${named?`<span class="pn">${esc(placeLabel(p.id))}</span>`:''}</span><span class="pb-n">${esc(today?today+' today':'none today')}</span>${miss?`<span class="pb-flag" aria-hidden="true">${miss} missed</span>`:''}</span>`
    +`<span class="pb-r" aria-hidden="true">${ls.length?ls.map(l=>`<span class="pb-line">${esc(named?l.long:l.short)}</span>`).join(''):`<span class="pb-line pb-none">${esc(empty)}</span>`}</span></button>`;
}
/* spec 001 FR-034/FR-035: open an agent's chat with its pending request (question, permission or spending limit) in view and focused,
   like the answer bar's "show" */
function openAtRequest(id){
  openPanel(id,true);
  setTimeout(()=>{const a=byId(id),c=a&&(a.live||chats[a.id])?pendingCardOf(a):null;if(c&&c.isConnected)focusRequest(c);},60);
}
/* spec 052 FR-016 / spec 001 FR-034: a pending request into view and focused: a question's first answer control, else the card itself (never its
   Approve button: an Enter right after must not approve). Shared by the answer bar's "show" and openAtRequest. */
function focusRequest(card){
  card.scrollIntoView({block:'center'});
  const f=card.classList.contains('question')?card.querySelector('.q-opt,.q-other,.q-form input,.q-form select,.q-open'):null;if(f){f.focus();return;}
  if(!card.hasAttribute('tabindex'))card.setAttribute('tabindex','-1');card.focus();
}
document.addEventListener('click',e=>{const b=e.target.closest&&e.target.closest('#stage [data-pvopen]');if(b){openAtRequest(b.dataset.pvopen);return;}
  const pb=e.target.closest&&e.target.closest('#stage [data-post]');if(pb)openSchedSettings();});
/* spec 001 FR-034: who goes to the Boss. A live main agent whose oldest pending request in its chat is a question ('q') or a permission ('p'):
   not the spending limit (the Bank, FR-035) or a coffee break (spec 068), not an error (that stays at the desk). Run before every render. */
function bossKind(a){
  if(!a||a.parent||!a.live||a.coffee||a.limit||vis(a)!=='waiting')return '';
  const c=pendingCardOf(a); if(!c||c.classList.contains('limit')||c.classList.contains('coffee'))return '';
  return c.classList.contains('question')?'q':'p';
}
function syncDesks(){
  if(demoOn)return;
  const D=window.DurbarPlaces; let any=false;
  for(const a of agents){
    if(a.parent||!a.live)continue;
    const k=bossKind(a), v=VISITS.at(a.id);
    if(k){if(!(VISITS.pinned(a.id)&&v&&v.place!==D.BOSS)){VISITS.pin(a.id,D.BOSS,k);any=true;}} /* a break (coffee, Bank) keeps its own place */
    else if(v&&v.place===D.BOSS)VISITS.unpin(a.id);
  }
  if(any)needsMeOrder(); /* fills NEED_SINCE for the queue's order and waits */
}
/* spec 001 FR-038: when a schedule fires, a letter flies once from the Postbox to that agent's desk (none under reduced motion or when either
   end is not on screen). One element in the walkers layer, removed when it lands. */
function flyLetter(agentId){
  if(REDUCED||reducedMotion()||ui.view!=='office')return;
  const layer=$('walkers'), floor=$('floor'), pb=document.querySelector('#stage .place.postbox'), d=document.querySelector(`#stage .desk[data-id="${CSS.escape(String(agentId))}"]`);
  if(!layer||!floor||!pb||!d)return;
  const fr=floor.getBoundingClientRect(); if(!fr.width)return;
  const c=el=>{const r=el.getBoundingClientRect();return {x:Math.round(r.left-fr.left+floor.scrollLeft+r.width/2),y:Math.round(r.top-fr.top+floor.scrollTop+r.height/2)};};
  const from=c(pb.querySelector('.pic')||pb), to=c(d.querySelector('.scene')||d);
  const el=document.createElement('span');el.className='letter';el.setAttribute('aria-hidden','true');
  el.innerHTML='<svg viewBox="0 0 16 12" width="16" height="12" aria-hidden="true" focusable="false"><rect x=".75" y=".75" width="14.5" height="10.5" rx="1.5" fill="var(--surface)" stroke="currentColor" stroke-width="1.3"/><path d="M1.5 1.8L8 6.6l6.5-4.8" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>';
  el.style.transform=`translate(${from.x}px,${from.y}px)`;layer.appendChild(el);void el.offsetWidth;
  let done=false;const end=()=>{if(done)return;done=true;el.remove();};
  el.addEventListener('transitionend',e=>{if(e.target===el&&e.propertyName==='transform')end();});setTimeout(end,1600);
  el.classList.add('flying');el.style.transform=`translate(${to.x}px,${to.y}px)`;
}
/* spec 001 FR-036: "+N" at a place lists every visitor (the shared menu element, as the folder menu); choosing one opens its chat */
function openPlaceMenu(pid,anchor){
  closeModeMenu();
  const ids=placeVisitors(pid); if(!ids.length)return;
  const m=document.createElement('div');m.id='modeMenu';m.className='mode-menu';m.setAttribute('role','menu');m.setAttribute('aria-label','At '+placeLabelFull(pid));
  m.innerHTML=ids.map(id=>{const a=byId(id),v=VISITS.at(id),r=roomOf(a);return `<button type="button" role="menuitem" data-pvopen="${esc(id)}"><span class="mt"><b>${esc(a.name)}</b><small>${esc((r?r.name+' · ':'')+(v?visitDoing(a,v):''))}</small></span></button>`;}).join('');
  document.body.appendChild(m);
  const ab=anchor.getBoundingClientRect(),b=m.getBoundingClientRect();
  m.style.left=Math.max(8,Math.min(ab.left,innerWidth-b.width-8))+'px';
  m.style.top=(ab.bottom+6+b.height<=innerHeight-8?ab.bottom+6:Math.max(8,ab.top-6-b.height))+'px';
  m.addEventListener('click',e=>{const t=e.target.closest('[data-pvopen]');if(!t)return;closeModeMenu();openAtRequest(t.dataset.pvopen);});
  m.addEventListener('keydown',e=>{const its=[...m.querySelectorAll('[data-pvopen]')],i=its.indexOf(document.activeElement);
    if(e.key==='ArrowDown'){e.preventDefault();its[(i+1)%its.length].focus();}else if(e.key==='ArrowUp'){e.preventDefault();its[(i+its.length-1)%its.length].focus();}
    else if(e.key==='Escape'||e.key==='Tab'){e.preventDefault();e.stopPropagation();closeModeMenu();if(anchor&&document.contains(anchor))anchor.focus();}});
  m.querySelector('button').focus();
}
document.addEventListener('click',e=>{const b=e.target.closest&&e.target.closest('#stage [data-placemore]');if(!b)return;e.stopImmediatePropagation();
  if(document.getElementById('modeMenu')){closeModeMenu();return;}openPlaceMenu(b.dataset.placemore,b);},true);
const WALK_MS=1000, MAX_WALKS=3; /* about 1 s per walk; beyond 3 at once the others simply appear */
const walkers=new Map(); /* agent id -> {el, back, walking, shown, timer, to} */
const walkCount=()=>{let n=0;walkers.forEach(w=>{if(w.walking)n++;});return n;};
function dropWalker(id){const w=walkers.get(id);if(!w)return;clearTimeout(w.timer);if(w.off)w.off();w.el.remove();walkers.delete(id);RETURNING.delete(id);}
/* spec 001 FR-051 (change 2026-10-23): a figure on its way back that is dropped without a walk (reduced motion, no desk on screen, not the office)
   is back now: draw again, as the end of a walk does, or the desk kept its empty chair (and a finished agent stayed out of the lounge) until
   some other change drew the office */
function dropBack(id){const was=RETURNING.has(id);dropWalker(id);if(was)scheduleRender();}
/* Before the desks are drawn: an agent whose visit just ended keeps its empty chair until its figure is back. */
function prepareWalkers(){
  if(ui.view!=='office'||!lobbyOn())return;
  walkers.forEach((w,id)=>{if(!w.back&&!VISITS.at(id))RETURNING.add(id);});
}
/* After the office is drawn: put every figure where it belongs (positions are recomputed on every render, so resizes, filters and
   opened/closed rooms never leave one in the wrong place) and start the walks. */
function syncWalkers(){
  const layer=$('walkers'), floor=$('floor'); if(!layer||!floor)return;
  if(ui.view!=='office'||!lobbyOn()){[...walkers.keys()].forEach(dropBack);return;}
  const fr=floor.getBoundingClientRect();
  if(!fr.width||!fr.height)return; /* office hidden (full-screen chat open): leave the figures as they are until it is shown again */
  const center=el=>{const r=el.getBoundingClientRect();return {x:Math.round(r.left-fr.left+floor.scrollLeft+r.width/2),y:Math.round(r.top-fr.top+floor.scrollTop+r.height/2)};};
  const want=new Map(); /* agent id -> slot centre of the place it is visiting (only those that fit; the rest are the "+N") */
  lobbyPlaces().forEach(p=>{
    const tile=document.querySelector(`#stage .place[data-place="${p.id}"]`); if(!tile)return;
    const ids=placeVisitors(p.id), shown=tile.querySelectorAll('.slot.on').length; /* the entries drawn (the "+N" circle is not one) */
    ids.slice(0,shown).forEach((id,i)=>{const sl=tile.querySelector(`.slot[data-slot="${i}"]`);if(sl)want.set(id,center(sl));});
  });
  const deskPos=id=>{const d=document.querySelector(`#stage [data-id="${CSS.escape(id)}"]`);const sc=d&&(d.querySelector('.scene')||d);return sc?center(sc):null;};
  const move=(w,pos,after,instant)=>{ /* instant: a layout change moved the slot under a resting figure: put it back, no walk */
    clearTimeout(w.timer); if(w.off){w.off();w.off=null;} /* a new move cancels the old walk's listener and fallback */
    const walk=!instant&&!REDUCED&&w.shown&&(w.walking||walkCount()<MAX_WALKS);
    w.el.style.transition=walk?`transform ${WALK_MS}ms linear`:'none';
    w.el.style.transform=`translate(${pos.x}px,${pos.y}px)`;
    w.el.classList.toggle('walking',walk); w.walking=walk; w.to=pos.x+','+pos.y;
    if(walk){ /* the walk ends when the transform transition ends (not on a wall-clock guess: under load it can run late); the timer is only a fallback if the event never comes */
      const el=w.el; let done=false;
      const end=()=>{if(done)return;done=true;clearTimeout(w.timer);el.removeEventListener('transitionend',onEnd);w.off=null;w.walking=false;el.classList.remove('walking');if(after)after();};
      const onEnd=e=>{if(e.target===el&&e.propertyName==='transform')end();};
      el.addEventListener('transitionend',onEnd); w.off=()=>{done=true;el.removeEventListener('transitionend',onEnd);};
      w.timer=setTimeout(end,WALK_MS+500);
    }
    else if(after)after();
  };
  want.forEach((pos,id)=>{
    let w=walkers.get(id);
    if(!w){
      const a=byId(id); if(!a)return;
      const el=document.createElement('span'); el.className='walker'; el.dataset.agent=a.id; el.setAttribute('aria-hidden','true'); el.innerHTML='<span class="wk">'+avatar(a)+'</span>'; layer.appendChild(el);
      w={el,back:false,walking:false,shown:false,timer:0,to:'',tk:THEME.themeIdForCache()}; walkers.set(id,w);
      /* a visit that began a while ago and is only now drawn (its tile got wider, the queue shorter) is already there: no walk from the desk */
      const v=VISITS.at(id), long=!!v&&Date.now()-v.since>WALK_MS+500;
      const from=long?pos:(deskPos(id)||pos); el.style.transition='none'; el.style.transform=`translate(${from.x}px,${from.y}px)`; void el.offsetWidth; w.shown=true;
      move(w,pos,null,long); return;
    }
    if(w.back){w.back=false;RETURNING.delete(id);move(w,pos);return;}
    if(w.walking){if(w.to!==pos.x+','+pos.y)move(w,pos);return;}
    if(w.to!==pos.x+','+pos.y)move(w,pos,null,true);
  });
  [...walkers.keys()].forEach(id=>{
    if(want.has(id))return;
    const w=walkers.get(id), dp=deskPos(id);
    if(!dp||REDUCED){dropBack(id);return;} /* no desk on screen (room closed, filtered out) or no animation wanted: just disappear */
    if(VISITS.at(id)){dropWalker(id);return;} /* still at the place, now inside its "+N" (a narrower tile, a longer queue): it did not leave, so no walk back */
    if(w.back)return;
    w.back=true; RETURNING.add(id);
    move(w,dp,()=>{dropWalker(id);scheduleRender();});
  });
  /* spec 040 FR-023: a figure drawn before a theme switch is drawn again in the new theme (it is not rebuilt while it walks or rests) */
  const tk=THEME.themeIdForCache();
  walkers.forEach((w,id)=>{const a=byId(id);if(a&&w.tk!==tk){const wk=w.el.querySelector('.wk');if(wk)wk.innerHTML=avatar(a);w.tk=tk;}});
  /* spec 034 FR-015: the figure away at a place keeps its mood (ring, horns, trouble dot); none in Serious mode (moodFor) */
  walkers.forEach((w,id)=>{const a=byId(id),m=moodFor(a);w.el.dataset.body=m.body;w.el.dataset.trouble=m.trouble||'';w.el.dataset.coffee=m.coffee?'1':''; /* spec 068: a cup in the hand */
    /* spec 001 FR-034: at the Boss, a tiny badge on the figure: ? for a question, a key for a permission */
    const v=VISITS.at(id),k=v&&v.place===window.DurbarPlaces.BOSS?v.label:'';
    if((w.el.dataset.ask||'')!==k){w.el.dataset.ask=k;let b=w.el.querySelector('.wb');if(!k){if(b)b.remove();}else{if(!b){b=document.createElement('span');b.className='wb';w.el.appendChild(b);}b.innerHTML=k==='q'?'?':BADGE_KEY;}}
    /* spec 017 FR-019, FR-020 (owner 2026-10-23): the same pose as at the door: an empty wallet at Durbar's spending limit wherever the
       figure is (Bank, coffee corner, walking), a wave while it waits at the Boss; drawn in its own colours, still with reduced motion */
    const pr=a&&signsOn()?(a.limit?'wallet':k?'wave':''):'';
    if((w.el.dataset.prop||'')!==pr){w.el.dataset.prop=pr;let q=w.el.querySelector('.wprop');if(!pr){if(q)q.remove();}else{if(!q){q=document.createElement('span');q.className='wprop';q.setAttribute('aria-hidden','true');w.el.appendChild(q);}q.innerHTML=pr==='wallet'?walletSvg(a,'w-wallet'):waveArmSvg(a,'w-arm');}}});
}
function roomAiu(r){const f=folderOfRoom(r.id),t=LEDGER.room(r.id,f&&f.key),usd=usdEstimates(r.id),m=t.calls&&!(t.unreported>=t.calls&&!usd)?approx(t.nano/1e9*AIU_USD+usd):'';return t.calls&&!demoOn?{long:m||window.DurbarUsage.fmtTotal(t),short:m||window.DurbarUsage.fmtShort(t),tip:window.DurbarUsage.tooltip(t,{scope:'folder',since:LEDGER.since(),run:LEDGER.roomRun(r.id)})}:null;}

/* spec 052 FR-076: one word per status on every screen (pills, list, header, palette, counters); longer phrases only in sentences */
const LABELS={working:'Working',thinking:'Thinking',waiting:'Waiting',idle:'Idle',error:'Error',done:'Done'};
const vis = a => a.paused ? 'idle' : a.state;
const label = (a,short) => a.paused ? 'Paused' : (a.label || LABELS[a.state]);
/* spec 052 FR-062: Working (or Thinking) while its recent tool calls failed in a row (the mood's "dizzy" streak) reads "Failing", in the waiting
   colours (.st-failing); the card keeps its is-working look and its place in the status filters. Main agents only (the tracker's scope). */
const isFailing = a => !!a&&!a.parent&&!!a.live&&!a.paused&&(a.state==='working'||a.state==='thinking')&&MOOD.failStreak(a.id)>=MOODS.DIZZY_STREAK;
const pillSt = a => isFailing(a)?'failing':vis(a);
const stWord = (a,short) => isFailing(a)?'Failing':label(a,short);
const pillTip = a => isFailing(a)?` title="${MOOD.failStreak(a.id)} tool calls failed in a row"`:'';
/* spec 052 FR-062: last activity, from the last event of the agent or its helpers (a.lastEventAt, the time it arrived); repainted by the 30 s tick */
const sinceLast = a => {const r=a&&a.parent?byId(a.parent)||a:a;return r&&r.lastEventAt?Math.max(0,Date.now()-r.lastEventAt):null;};
const lastTip = a => {const t=ACT.agoLong(sinceLast(a));return t?' · Last activity '+t:'';};
/* waiting-for-you first, then errors, everything else keeps its stable order (calm: no constant reshuffling) */
const prio = a => {const s=vis(a);return s==='waiting'?0:s==='error'?1:2;};

/* ---------------- state ---------------- */
const ui = {view:'office', ws:'all', status:null, selected:null, expanded:{}};
/* spec 052 FR-087 / FR-091: the last view, folder filter and open chat, and the most recently opened chats (ids only), kept in this
   window's localStorage. Not in the simulator (its agents are made up each run) and not before the real agent list is back. */
const UI_KEY='durbar.ui';
let uiRestored=false, uiSaved='', RECENT=[];
const $ = id => document.getElementById(id);

const fmtTok = n => n>=1e6?(n/1e6).toFixed(1)+'M':n>=1e4?Math.round(n/1e3)+'k':n>=1e3?(n/1e3).toFixed(1)+'k':String(n);
/* AI-credit cap (spec 011): AIU as reported by the runtime; the cap is the session's, so helper cards show their own usage only. */
const capOf=a=>{const c=a&&!a.parent&&a.info&&a.info.maxAiCredits;return c>0?c:0;};
const MIN_CAP=30; /* the runtime's minimum session limit, AI credits (1 credit = USD 0.01; AIU as reported = credits per GitHub docs) */
const capDigits=()=>2;
const fmtCap=n=>Number.isInteger(n)?String(n):n.toFixed(2);
/* spec 012 FR-150: a kind can cap its own dollar estimate instead of AI credits (Claude Code); the number and the words follow its unit */
const capUnitOf=a=>{const r=a&&a.parent?(byId(a.parent)||a):a;const c=typeof capsFor==='function'&&r&&r.info?capsFor(r):null;return c&&c.capUnit==='usd'?'usd':'aiu';};
const isUsdCap=a=>capUnitOf(a)==='usd';
const capUsed=a=>isUsdCap(a)?(a.usage&&a.usage.usd||0):(a.usage?a.usage.nano/1e9:0);
const fmtCapOf=(a,n)=>isUsdCap(a)?'$'+n.toFixed(2):fmtCap(n)+' AIU';
const MIN_USD_CAP=0.01;
/* spec 012 FR-122: what the agent's kind reports decides the money part: AIU, a labelled dollar estimate (never AIU), or nothing */
const usageCaps=a=>{const r=a&&a.parent?(byId(a.parent)||a):a;const c=typeof capsFor==='function'&&r&&r.info?capsFor(r):null;return (c&&c.usage)||{nanoAiu:true};};
/* spec 052 FR-028 (#307): money as people read it; small amounts are "<$0.01", not four decimals */
const fmtMoney=v=>v>0&&v<0.005?'<$0.01':'$'+v.toFixed(2);
const approx=v=>(v>0&&v<0.005?'':'≈ ')+fmtMoney(v); /* "<$0.01" needs no "≈" */
const AIU_USD=0.01; /* 1 Copilot AI credit = USD 0.01 (GitHub's price; Settings says the same) */
/* spec 052 FR-080: a request in plain words for Simple, from the event's kind and summary ("write src/tools/companies.ts", "run npm test"):
   {what,folder,cmd}, or null for a kind that keeps its summary. The event data is unchanged; callers set the words with textContent. */
const baseOf=p=>{const parts=String(p||'').split(/[\\/]/).filter(Boolean);return {base:parts.pop()||'',dir:parts.pop()||''};};
const clipName=s=>DurbarCutText.cutText(s,40); /* shared helper (cuttext.js): a file name, at most 40 characters */
function plainAsk(kind,summary){
  const s=String(summary||'').trim(), k=String(kind||'');
  if(k==='write'||k==='read'){
    let rest=s.replace(/^(write|edit|create|read)(\s+|$)/i,'').replace(/^\([^()]*\)$/,''), more=''; /* spec 052 FR-172: "write (Codex did not say which file)" names no file */
    const m=/\s+\(\+(\d+) more\)$/.exec(rest);if(m){more=' and '+m[1]+' more file'+(m[1]==='1'?'':'s');rest=rest.slice(0,m.index);}
    const {base,dir}=baseOf(rest.replace(/\s+\([^()]*\)$/,'').trim());
    return {what:(k==='write'?'change ':'read ')+(base?clipName(base):'a file')+more,folder:dir?'in '+dir:'',cmd:''};
  }
  if(k==='shell')return {what:'run a command',folder:'',cmd:s.replace(/^run\s+/i,'')};
  if(k==='url')return {what:'open a web page',folder:'',cmd:''};
  if(k==='mcp'||k==='custom-tool')return {what:'use one of its tools',folder:'',cmd:''};
  return null;
}
/* spec 052 FR-081: a tool row of the chat in plain words for Simple ("Read companies.ts", "Searched files", "Ran a command") */
function plainChip(k,tool,label,running){
  const t=String(tool||'').toLowerCase(), first=String(label||'').trim().split(/\s+/)[0]||'', {base}=baseOf(first), file=/[\\/.]/.test(first)&&base?clipName(base):'a file';
  if(/fetch|web|url|http/.test(t))return running?'Looking at a web page':'Looked at a web page';
  if(k==='read')return (running?'Reading ':'Read ')+file;
  if(k==='edit')return (running?'Changing ':'Changed ')+file;
  if(k==='run')return running?'Running a command':'Ran a command';
  if(k==='search')return /grep|glob|find|rg\b|file/.test(t)?(running?'Searching files':'Searched files'):(running?'Searching':'Ran a search'); /* round 4: an issue or notes search is not a file search */
  return running?'Using a tool':'Used a tool';
}
/* spec 052 FR-057: in Simple, the stop at the spending limit and a rate-limit error read in plain words; Expert keeps the exact text */
const taskText=a=>{const t=a.task==null?'':String(a.task);if(!SIMPLE)return t;
  {const w=/^(Waiting for permission|Denied \(read-only mode\)): (write|edit|run|read|fetch|mcp)\b ?(.*)$/i.exec(t); /* FR-080: never the command itself */
    const p=w&&plainAsk({write:'write',edit:'write',run:'shell',read:'read',fetch:'url',mcp:'mcp'}[w[2].toLowerCase()],w[2]+' '+w[3]);
    if(p)return (/^W/.test(w[1])?'Waiting for your OK to ':'Read-only stopped it: wanted to ')+p.what;}
  const m=/^Stopped at (\$?)(\d+(?:\.\d+)?)( AIU)?\. Raise the limit to go on\.$/.exec(t);
  if(m){const n=parseFloat(m[2]);return 'Paused: reached the spending limit you set ('+(m[1]?fmtMoney(n):'about '+fmtMoney(n*AIU_USD))+')';}
  if(a.state==='error'&&/\b429\b|rate[ -]?limit/i.test(t))return 'The AI service is busy. Try again in a minute.';
  return t;};
const fmtUsd=v=>approx(v)+' est.';
/* spec 052 (2026-10-21, round 7): the home folder shows as ~ (Windows C:\\Users\\name, macOS /Users/name, Linux /home/name), so the part after it, where the folder is, survives an ellipsis; tooltips keep the full path */
const showPath=p=>String(p||'').replace(/^(?:\/home\/[^/]+|\/Users\/[^/]+|[A-Za-z]:\\Users\\[^\\]+)(?=[\\/]|$)/,'~');
const USD_TIP='The agent\'s own estimate of the API price for these tokens, not a bill and not AIU.';
/* spec 052 (2026-10-21, office fit): the cost part of a card's usage line; " est." in its own span so a narrow card can drop it (the tooltip explains it) */
const useCost=c=>{const t=String(c||'');if(t.endsWith(' est.'))return esc(t.slice(0,-5))+'<span class="est"> est.</span>';
  if(t.endsWith(' AIU')){const v=t.slice(0,-4),m=/^(\d+)\.\d+\/(\d+(?:\.\d+)?)$/.exec(v); /* a capped "33.00/30": a very narrow card shows "33/30" (exact value in the tooltip) */
    return (m?'<span class="full">'+esc(v)+'</span><span class="short">'+esc(m[1]+'/'+m[2])+'</span>':esc(v))+'<span class="est"> AIU</span>';}
  return esc(t);};
function usageShort(a){const u=a.usage; if(!u||!u.calls)return ''; const k=usageCaps(a), c=capOf(a);
  if(SIMPLE){const m=k.nanoAiu?u.nano/1e9*AIU_USD:(k.costUsd?(u.usd||0):null);return m==null?'':approx(m);}
  if(!k.nanoAiu)return c&&k.costUsd&&isUsdCap(a)?fmtTok(u.inT+u.outT)+' · $'+(u.usd||0).toFixed(2)+'/$'+c.toFixed(2)+' est.':fmtTok(u.inT+u.outT)+' tok'+(k.costUsd?' · '+fmtUsd(u.usd||0):'');
  return c?fmtTok(u.inT+u.outT)+' · '+(u.nano/1e9).toFixed(capDigits(c))+'/'+fmtCap(c)+' AIU':fmtTok(u.inT+u.outT)+' tok · '+approx(u.nano/1e9*AIU_USD);}
function usageLong(a){const u=a.usage; if(!u||!u.calls)return ''; if(SIMPLE){const m=usageShort(a);return m?'Cost so far: '+m:'';} /* spec 052 FR-081: money only */ const k=usageCaps(a), c=capOf(a), base=u.calls+' calls · '+fmtTok(u.inT)+' in / '+fmtTok(u.outT)+' out tokens';
  if(!k.nanoAiu)return base+(k.costUsd?' · '+(c&&isUsdCap(a)?fmtUsd(u.usd||0).replace(/ est\.$/,' of a $'+c.toFixed(2)+' limit est.'):fmtUsd(u.usd||0)):'');
  return base+' · '+(u.nano/1e9).toFixed(3)+' AIU'+(c?' of '+fmtCap(c)+' limit':'');}

/* ---------------- svg helpers ---------------- */

/* ---------------- svg helpers ---------------- */
function shade(hex,p){const n=parseInt(hex.slice(1),16);let r=n>>16,g=(n>>8)&255,b=n&255;const f=p<0?0:255,t=Math.abs(p);
  r=Math.round((f-r)*t+r);g=Math.round((f-g)*t+g);b=Math.round((f-b)*t+b);return '#'+((1<<24)+(r<<16)+(g<<8)+b).toString(16).slice(1)}
function badgeSVG(st){
  const w=T_('--done-mark'); /* the badge glyph sits on the status dot colour */
  if(st==='done')return '<svg viewBox="0 0 10 10" fill="none" stroke="'+w+'" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 5.3l2.1 2.1L8 3"/></svg>';
  if(st==='error')return '<svg viewBox="0 0 10 10" fill="none" stroke="'+w+'" stroke-width="1.8" stroke-linecap="round"><path d="M5 2v3.4M5 7.6v.1"/></svg>';
  if(st==='waiting')return '<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="2.2" fill="'+w+'"/></svg>';
  if(st==='idle')return '<svg viewBox="0 0 10 10" fill="none" stroke="'+w+'" stroke-width="1.6" stroke-linecap="round"><path d="M2.5 5h5"/></svg>';
  return '<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="2" fill="'+w+'" opacity=".9"/></svg>';
}
function hairFront(style,c){
  const fr=`<path d="M61 43.5C61 33 67 30.5 74 30.5C81 30.5 87 33 87 43.5C84 38.5 80 37 74 37C68 37 64 38.5 61 43.5Z" fill="${c}"/>`;
  const acc=THEME.slot('hair-acc');
  if(style==='bun')return fr+`<circle cx="74" cy="28" r="5.5" fill="${c}"/>`+(acc||'');
  if(style==='curly')return `<circle cx="64" cy="36" r="6.2" fill="${c}"/><circle cx="74" cy="31.5" r="7" fill="${c}"/><circle cx="84" cy="36" r="6.2" fill="${c}"/>`+fr+(acc||'');
  return fr+(acc||'');
}
/* a theme's character art (spec 040 FR-010): the body layers go under the head, the headwear over the hair (spec 040 FR-023: drawn
   before the head, a hat was hidden by the head and the hair) */
const artSlot=name=>{const v=THEME.slot(name);return v===null?'':`<g class="art-slot" data-slot="${name}">${v}</g>`;};
function charArt(part){
  return (part==='head'?['char-headwear']:['char-body','char-robe','char-collar']).map(artSlot).join('');
}
/* the same overlays for the other scene kits (spec 040 FR-023): a pack's art is drawn on every kit, not only the office one */
const kitArt=()=>({body:charArt('body'),head:charArt('head')+artSlot('hair-acc'),desk:artSlot('desk-back')+artSlot('desk-art'),monitor:artSlot('monitor-art'),cup:artSlot('gadget-cup'),laptop:artSlot('gadget-laptop')});
/* spec 070 FR-010: the pack's clothes and hair colours; skins stay the app's (D3). An agent keeps its index in the app palette, so it
   keeps its slot in every theme (a colour that is not in the palette picks one by its hash) */
function themedLook(k){
  const f=THEME.figures&&THEME.figures();
  if(!f||!k)return k;
  const pick=(list,pal,c)=>{if(!list)return c;let i=pal.indexOf(c);if(i<0)i=hashN(String(c));return list[i%list.length];};
  return Object.assign({},k,{shirt:pick(f.shirts,S.sh,k.shirt),hair:pick(f.hairs,S.hr,k.hair)});
}
function scene(a,mini,c){
  const st=vis(a), mood=moodFor(a), k=mood.body==='monster'?Object.assign({},themedLook(a.look),{skin:T_('--monster-skin')}):themedLook(a.look), shirt=k.shirt, arm=shade(shirt,-.14), skinD=shade(k.skin,-.08);
  const kit=THEME.sceneKit(); /* another theme's people and desks (spec 035 FR-013); the office kit is the code below */
  /* spec 040 FR-023: the signature names the theme too, so a theme switch redraws the desk (same signature = the old SVG is kept) */
  const tk=THEME.themeIdForCache();
  if(kit!=='office'&&window.DurbarScenes){const v=window.DurbarScenes.draw(kit,a,{st,mood,k,mini,c,T:T_,shade,reduced:REDUCED||SERIOUS,themeKey:tk,art:kitArt()});if(v)return c?v:stillSig(v);}
  let s=`<svg class="scene${c?' sc-c':''}" data-sig="${st}|${k.shirt}${k.skin}${k.hair}${k.style}${k.glasses?1:0}|${c?'c':mini?'m':'f'}|${tk}|${mood.body}${mood.trouble||''}${mood.coffee?'C':''}" viewBox="${c?'16 5 176 116':mini?'22 4 166 118':'0 0 200 124'}" aria-hidden="true" focusable="false">`;
  s+=`<ellipse cx="100" cy="118" rx="88" ry="3.5" fill="${T_('--scene-shadow')}" opacity=".06"/>`;
  /* compact scenes: flat halo rects + CSS-only animation (no blur filter, no SMIL) so 15 of them stay cheap */
  if(c){const hc={working:T_('--halo-working'),thinking:T_('--halo-thinking'),waiting:T_('--halo-waiting'),error:T_('--halo-error')}[st];
    if(hc) s+=`<g class="halo halo-${st}"><rect x="101" y="22" width="86" height="66" rx="17" fill="${hc}" opacity=".13"/><rect x="107" y="28" width="74" height="54" rx="13" fill="${hc}" opacity=".16"/></g>`;}
  else if(st==='working'||st==='thinking') s+=`<rect class="glow" x="106" y="28" width="76" height="54" rx="14" fill="${st==='working'?T_('--halo-working'):T_('--halo-thinking')}" filter="url(#soft)" opacity=".24"/>`;
  s+=`<rect x="52" y="50" width="44" height="48" rx="13" fill="${T_('--chair')}"/>`;
  s+='<g class="pp">'; /* the person (hidden by CSS while the agent is away at a place: an empty chair stays) */
  if(k.style==='long') s+=`<path d="M59.5 44a14.5 14.5 0 0 1 29 0v19q0 4-4 4h-21q-4 0-4-4z" fill="${k.hair}"/>`;
  s+=`<path d="${mood.body==='normal'?'M55 99V77q0-14 14-14h10q14 0 14 14v22z':'M52 99V77q0-14 14-14h16q14 0 14 14v22z'}" fill="${shirt}"/>`; /* heavy and monster: a wider body, still inside the chair */
  s+=`<path d="M69.5 63.5q4.5 5 9 0" fill="none" stroke="${shade(shirt,.35)}" stroke-width="2" stroke-linecap="round"/>`;
  s+=`<rect x="70" y="53" width="8" height="10" rx="3" fill="${skinD}"/>`;
  s+=charArt('body');
  const eyesClosed = st==='idle'||mood.trouble==='faint';
  const tilt = mood.trouble==='faint'?'rotate(-24 74 56)': st==='idle'?'rotate(-7 74 56)': st==='error'?'rotate(4 74 56)':'';
  s+=`<g ${tilt?`transform="${tilt}"`:''}${mood.trouble==='faint'?' style="transform-box:view-box"':''}><g class="${st==='working'?'head':''}"><circle cx="74" cy="44" r="12.5" fill="${k.skin}"/>`;
  s+=hairFront(k.style,k.hair)+charArt('head');
  if(mood.body==='monster') s+=`<path d="M64.5 35.5l-4.2-9.5 9 5.2zM83.5 35.5l4.2-9.5-9 5.2z" fill="${T_('--monster-horn')}"/><path d="M65 33l2.4-4.6 2.6 3.6 2.8-5 2.8 4.6 2.6-3.6 2.4 4.6" fill="none" stroke="${k.hair}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`;
  const ex = eyesClosed?0:1.4;
  if(eyesClosed) s+=`<path d="M67.5 45.6q2 1.7 4 0M76.5 45.6q2 1.7 4 0" fill="none" stroke="${T_('--face-dark')}" stroke-width="1.3" stroke-linecap="round"/>`;
  else s+=`<circle cx="${70.3+ex}" cy="45.4" r="1.35" fill="${T_('--face-dark')}"/><circle cx="${78.3+ex}" cy="45.4" r="1.35" fill="${T_('--face-dark')}"/>`;
  if(k.glasses) s+=`<g fill="none" stroke="${T_('--face-dark')}" stroke-width="1.1"><circle cx="${70.3+ex}" cy="45.4" r="4"/><circle cx="${78.3+ex}" cy="45.4" r="4"/></g>`;
  const mouth = mood.body==='monster'?'M70.2 53.8q3.8-3.6 7.6 0': st==='error'?'M71 53.2q3-2 6 0': (st==='done'||st==='idle')?'M70.5 51q3.5 3 7 0':'M71 51.6q3 2 6 0';
  if(mood.body==='monster') s+=`<path d="M65.5 40l7 3.4M82.5 40l-7 3.4" fill="none" stroke="${T_('--face-dark')}" stroke-width="1.8" stroke-linecap="round"/>`;
  s+=mood.trouble==='faint'?`<ellipse cx="74" cy="52" rx="1.9" ry="2.4" fill="${T_('--faint-mouth')}"/></g></g>`:`<path d="${mouth}" fill="none" stroke="${T_('--mouth')}" stroke-width="1.3" stroke-linecap="round"/></g></g>`;
  if(mood.body==='heavy') s+=`<path class="sweat" d="M90.5 36.5q3.2 4.6 0 7.4q-3.2-2.8 0-7.4z" fill="${T_('--sweat')}" stroke="${T_('--sweat-line')}" stroke-width=".6"/>`;
  s+='</g>';
  // desk
  s+=`<rect x="10" y="86" width="180" height="7" rx="3.5" fill="${T_('--desk')}"/><rect x="15" y="93" width="170" height="21" rx="4" fill="${T_('--desk-front')}"/><rect x="22" y="98" width="46" height="11" rx="3" fill="${T_('--desk-drawer')}"/><rect x="142" y="98" width="36" height="11" rx="3" fill="${T_('--desk-drawer')}"/>`;
  // monitor
  s+=`<rect x="138.5" y="76" width="11" height="9" fill="${T_('--monitor-stand')}"/><rect x="130" y="83" width="28" height="3.5" rx="1.75" fill="${T_('--monitor-stand')}"/>`;
  const deskBack=THEME.slot('desk-back'), deskArt=THEME.slot('desk-art'), monitorArt=THEME.slot('monitor-art');
  s+=(deskBack===null?'':`<g class="art-slot" data-slot="desk-back">${deskBack}</g>`)+(deskArt===null?'':`<g class="art-slot" data-slot="desk-art">${deskArt}</g>`);
  const scr={working:T_('--screen-working'),thinking:T_('--screen-thinking'),waiting:T_('--screen-waiting'),idle:T_('--screen-idle'),error:T_('--screen-error'),done:T_('--screen-done')}[st];
  s+=`<rect x="112" y="32" width="64" height="45" rx="5" fill="${T_('--monitor-frame')}"/><rect x="116" y="36" width="56" height="37" rx="3" fill="${scr}"/>`;
  s+=monitorArt===null?'':`<g class="art-slot" data-slot="monitor-art">${monitorArt}</g>`;
  if(st==='working') s+=`<rect class="bar" x="121" y="41" width="34" height="3.6" rx="1.8" fill="${T_('--bar-blue')}"/><rect class="bar" x="121" y="48.5" width="26" height="3.6" rx="1.8" fill="${T_('--bar-sage')}"/><rect class="bar" x="121" y="56" width="42" height="3.6" rx="1.8" fill="${T_('--bar-blue')}"/><rect class="bar" x="121" y="63.5" width="20" height="3.6" rx="1.8" fill="${T_('--bar-blue-2')}"/>`;
  if(st==='thinking') s+=`<rect x="121" y="41" width="30" height="3.6" rx="1.8" fill="${T_('--halo-thinking')}" opacity=".55"/><rect x="121" y="48.5" width="40" height="3.6" rx="1.8" fill="${T_('--halo-thinking')}" opacity=".4"/><rect x="121" y="56" width="22" height="3.6" rx="1.8" fill="${T_('--halo-thinking')}" opacity=".55"/><rect x="121" y="63.5" width="5" height="3.6" rx="1.8" fill="${T_('--halo-thinking')}"${c?' class="cursor"':''}>${REDUCED||c?'':'<animate attributeName="opacity" values="1;.15;1" dur="1.6s" repeatCount="indefinite"/>'}</rect>`;
  if(st==='waiting') s+=`<rect x="121" y="41" width="30" height="3.6" rx="1.8" fill="${T_('--wait-dot')}" opacity=".5"/><rect x="123" y="49" width="42" height="19" rx="5" fill="${T_('--wait-card')}" stroke="${T_('--wait-note-stroke')}" stroke-width="1.2"/><circle cx="131" cy="58.5" r="3" fill="${T_('--wait-dot')}"/><rect x="138" y="54" width="20" height="3" rx="1.5" fill="${T_('--wait-note-line')}"/><rect x="138" y="60" width="14" height="3" rx="1.5" fill="${T_('--wait-note-line-2')}"/>`;
  if(st==='idle') s+=`<circle cx="144" cy="54.5" r="7" fill="none" stroke="${T_('--idle-clock')}" stroke-width="1.6"/><path d="M144 50.5v4l2.6 1.6" fill="none" stroke="${T_('--idle-clock')}" stroke-width="1.6" stroke-linecap="round"/>`;
  if(st==='error') s+=`<circle cx="144" cy="52" r="9" fill="none" stroke="${T_('--halo-error')}" stroke-width="2"/><path d="M144 47.5v5.5M144 56.6v.1" stroke="${T_('--halo-error')}" stroke-width="2.2" stroke-linecap="round"/><rect x="127" y="65" width="34" height="3" rx="1.5" fill="${T_('--err-mark')}"/>`;
  if(st==='done') s+=`<circle cx="144" cy="54.5" r="10" fill="${T_('--done-bg')}"/><path class="done-tick" d="M139 54.5l3.6 3.6 6.6-7" fill="none" stroke="${T_('--done-mark')}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>`;
  const lap=artSlot('gadget-laptop'), cup=artSlot('gadget-cup'); /* spec 070 FR-011: a pack's own laptop and cup replace the app's */
  s+=lap||`<rect x="59" y="82.2" width="36" height="3.8" rx="1.9" fill="${T_('--laptop')}"/>`;
  if(st==='idle'||mood.coffee) s+=(cup||`<rect x="98" y="76" width="10" height="10" rx="2.5" fill="${T_('--cup')}" stroke="${T_('--cup-line')}" stroke-width="1"/><path d="M108 78.5q4 0 4 3t-4 3" fill="none" stroke="${T_('--cup-line')}" stroke-width="1.4"/>`)+`<path class="steam" d="M101 73q-2-3 0-5" fill="none" stroke="${T_('--steam')}" stroke-width="1.2" stroke-linecap="round"/><path class="steam" d="M105 73q-2-3 0-5" fill="none" stroke="${T_('--steam')}" stroke-width="1.2" stroke-linecap="round"/>`;
  const hand=(x,y)=>`<circle cx="${x}" cy="${y}" r="3.6" fill="${k.skin}"/>`;
  const armL=(x1,y1,x2,y2)=>`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${arm}" stroke-width="8" stroke-linecap="round"/>`;
  const typing = st==='working';
  s+='<g class="pp">';
  s+=`<g class="${typing?'hand-l':''}">${armL(61,71,68,81)}${hand(68.5,81.4)}</g>`;
  if(st==='waiting'&&mood.trouble!=='impatient'&&mood.trouble!=='faint'){ /* impatient taps the desk, a fainted agent does not wave */
    const wave = REDUCED||SERIOUS||c?'':`<animateTransform attributeName="transform" type="rotate" values="-4 87 71;6 87 71;-4 87 71" dur="2.8s" repeatCount="indefinite"/>`;
    s+=`<g${c?' class="wave"':''}>${wave}${armL(87,71,97,46)}${hand(97.5,42.5)}</g>`;
  } else if(st==='idle'||mood.trouble==='faint'){
    s+=`<g>${armL(87,71,96,80)}${hand(97,80.5)}</g>`;
  } else {
    s+=`<g class="${typing?'hand-r':mood.trouble==='impatient'?'tap':''}">${armL(87,71,81,81)}${hand(80.5,81.4)}</g>`;
  }
  s+='</g>';
  if(mood.trouble==='dizzy'){const star=(x,y)=>`<path d="M${x} ${y-3.2}l1 2.2 2.2 1-2.2 1-1 2.2-1-2.2-2.2-1 2.2-1z" fill="${T_('--star')}"/>`;s+=`<g class="pp"><g class="dizzy">${star(58,28)}${star(74,21)}${star(90,28)}</g></g>`;}
  if(mood.trouble==='ambulance') s+=`<g class="amb"><rect x="18" y="93" width="36" height="17" rx="4" fill="${T_('--amb-body')}" stroke="${T_('--amb-line')}" stroke-width="1"/><rect x="40" y="96" width="11" height="7" rx="1.5" fill="${T_('--amb-window')}"/><rect x="18" y="103" width="36" height="3" fill="${T_('--amb-stripe')}"/><path d="M28 96.5v5M25.5 99h5" stroke="${T_('--amb-stripe')}" stroke-width="2" stroke-linecap="round"/><rect class="amb-light" x="30" y="89.5" width="9" height="4" rx="2" fill="${T_('--amb-light')}"/><circle cx="26" cy="111" r="3.6" fill="${T_('--amb-wheel')}"/><circle cx="46" cy="111" r="3.6" fill="${T_('--amb-wheel')}"/></g>`;
  if(st==='thinking') s+=`<g class="bubble-g"><circle cx="58.5" cy="31" r="2" fill="${T_('--bubble')}" stroke="${T_('--bubble-line')}" stroke-width="1"/><circle cx="52" cy="25" r="3" fill="${T_('--bubble')}" stroke="${T_('--bubble-line')}" stroke-width="1"/><rect x="18" y="4" width="42" height="19" rx="9.5" fill="${T_('--bubble')}" stroke="${T_('--bubble-line')}" stroke-width="1.2"/><g fill="${T_('--think-dot')}"><circle class="td" cx="30" cy="13.5" r="2.2"/><circle class="td" cx="39" cy="13.5" r="2.2"/><circle class="td" cx="48" cy="13.5" r="2.2"/></g></g>`;
  s+='</svg>';
  return c?s:stillSig(s);
}
/* spec 052 FR-069: Serious mode draws full scenes without the SMIL wave; a mark in the signature redraws them when it is switched */
function stillSig(svg){return SERIOUS?svg.replace(' data-sig="',' data-sig="still|'):svg;}
function avatar(a){
  const k=themedLook(a.look);
  const kit=THEME.sceneKit();
  if(kit!=='office'&&window.DurbarScenes){const v=window.DurbarScenes.avatar(kit,a,{k,T:T_,shade,reduced:REDUCED,art:kitArt()});if(v)return v;}
  return `<svg viewBox="50 20 48 48" width="100%" height="100%" aria-hidden="true" focusable="false">${k.style==='long'?`<path d="M59.5 44a14.5 14.5 0 0 1 29 0v19q0 4-4 4h-21q-4 0-4-4z" fill="${k.hair}"/>`:''}<path d="M55 99V77q0-14 14-14h10q14 0 14 14v22z" fill="${k.shirt}"/><rect x="70" y="53" width="8" height="10" rx="3" fill="${shade(k.skin,-.08)}"/>${charArt('body')}<circle cx="74" cy="44" r="12.5" fill="${k.skin}"/>${hairFront(k.style,k.hair)}${charArt('head')}<circle cx="71.7" cy="45.4" r="1.35" fill="${T_('--face-dark')}"/><circle cx="79.7" cy="45.4" r="1.35" fill="${T_('--face-dark')}"/><path d="M71 51.6q3 2 6 0" fill="none" stroke="${T_('--mouth')}" stroke-width="1.3" stroke-linecap="round"/></svg>`;
}
const PLANT=()=>'<svg class="room-plant" width="26" height="30" viewBox="0 0 26 30" aria-hidden="true" focusable="false">'+THEME.slot('plant')+'</svg>';
/* ---------------- toast ---------------- */
/* spec 052 FR-004: a toast's timer pauses while it is hovered or holds focus, so it can be read at any zoom; ms 0 = until closed */
function holdTimer(t,ms,kill){
  if(!ms)return;let left=ms,start=Date.now(),id=setTimeout(kill,left);
  const pause=()=>{if(!id)return;clearTimeout(id);id=0;left-=Date.now()-start;};
  const resume=()=>{if(id||t.matches(':hover')||t.contains(document.activeElement))return;start=Date.now();id=setTimeout(kill,Math.max(left,1500));};
  t.addEventListener('mouseenter',pause);t.addEventListener('focusin',pause);t.addEventListener('mouseleave',resume);t.addEventListener('focusout',()=>setTimeout(resume,0));
}
/* spec 052 FR-170: with a chat open the toasts end above the composer (they sat on its left end); the bottom edge is read when a toast arrives */
function placeToasts(){const box=$('toasts');if(!box)return;let top=innerHeight; /* the highest box a toast must stay above: the answer bar when it shows, else the composer */
  if(document.body.classList.contains('panel-open'))for(const e of [document.querySelector('#panel .composer'),$('answerBar')])if(e&&!e.hidden&&e.getClientRects().length)top=Math.min(top,e.getBoundingClientRect().top);
  box.style.setProperty('--toast-b',(top<innerHeight?Math.ceil(innerHeight-top+12):16)+'px');}
let toastRO=null;
function mountToast(t){const box=$('toasts');placeToasts();box.appendChild(t);
  if(window.ResizeObserver){if(!toastRO)toastRO=new ResizeObserver(placeToasts);toastRO.disconnect();for(const e of [document.querySelector('#panel .composer'),$('answerBar'),$('panel')])if(e)toastRO.observe(e);} /* the composer grows with a long message, the answer bar appears and goes */}
window.addEventListener('resize',placeToasts);
function toast(html,ms){const t=document.createElement('div');t.className='toast';t.innerHTML=html;mountToast(t);holdTimer(t,ms||3200,()=>{t.style.transition='opacity .3s';t.style.opacity='0';setTimeout(()=>t.remove(),320)});return t;}
/* spec 052 FR-047: a button that awaits a bridge call shows it is busy: disabled + aria-busy, same width, the given label, and a 12px spinner
   after 150ms (none under reduced motion: the label alone). Returns done(), which restores the button. busy(null) is a no-op. */
const reducedMotion=()=>{try{return matchMedia('(prefers-reduced-motion: reduce)').matches;}catch(e){return false;}};
function busy(btn,label){
  if(!btn||btn.getAttribute('aria-busy')==='true')return ()=>{};
  const html=btn.innerHTML,mw=btn.style.minWidth,was=btn.disabled;
  btn.style.minWidth=btn.offsetWidth+'px';btn.disabled=true;btn.setAttribute('aria-busy','true');
  btn.textContent=label||btn.textContent;
  const t=reducedMotion()?0:setTimeout(()=>{if(btn.getAttribute('aria-busy')!=='true')return;const sp=document.createElement('span');sp.className='spin';sp.setAttribute('aria-hidden','true');btn.prepend(sp);},150);
  return ()=>{clearTimeout(t);if(btn.getAttribute('aria-busy')!=='true')return;btn.innerHTML=html;btn.style.minWidth=mw;btn.disabled=was;btn.removeAttribute('aria-busy');};
}
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const SN=()=>window.DurbarSessionName;
const nameTipAttr=a=>{const t=SN().nameTip(a.alias,a.title,a.folderLabel||a.baseName||'');return t?` title="${esc(t)}"`:'';};
/* the inverse of esc, in one pass (spec 045 FR-002: chained replacements turned "&amp;lt;" into "<") */
const unesc=s=>String(s).replace(/&(amp|lt|gt|quot);/g,(m,k)=>({amp:'&',lt:'<',gt:'>',quot:'"'}[k]));

/* ---------------- top bar ---------------- */
function visibleAgents(){return agents.filter(a=>roomShown(roomOf(a))&&(ui.ws==='all'||wsOf(a)===ui.ws));}
function renderStats(){
  renderInboxBtn();
  const list=visibleAgents().filter(a=>!a.parent); const c={working:0,waiting:0,idle:0,error:0,done:0};
  list.forEach(a=>{const s=vis(a); if(s==='working'||s==='thinking')c.working++; else c[s]++;});
  const defs=[['working','Working','working or thinking'],['waiting','Waiting','waiting for you'],['idle','Idle','idle or paused'],['error',c.error===1?'Error':'Errors','with errors'],['done','Done','done']];
  morphHTML($('stats'),defs.map(([k,l,t])=>`<button class="stat${(k==='waiting'||k==='error')&&c[k]?' attn':''}" data-k="${k}" aria-pressed="${ui.status===k}" title="Show only agents ${t}" aria-label="${c[k]} ${t}. Toggle filter."><span class="dot ${k}"></span><b>${c[k]}</b><span class="l">${l}</span></button>`).join('')+aiuChip());
}
function renderFilter(){
  const sel=$('wsFilter');
  if(ui.ws!=='all'&&!roomShown(ROOMS.find(r=>r.id===ui.ws)))ui.ws='all'; /* its floor went off or it was hidden */
  sel.innerHTML='<option value="all">All folders</option>'+roomsInOrder().filter(roomShown).map(r=>`<option value="${esc(r.id)}">${esc(r.name)}</option>`).join('');
  sel.value=ui.ws;
}
const matchStatus = a => !ui.status || ((ui.status==='working')?['working','thinking'].includes(vis(a)):vis(a)===ui.status);

/* ---------------- office view ---------------- */
const DENS={
  full:{cw:164,hw:90},
  /* compact densities: uniform desk cells on a grid (cw = min cell width), helpers on a strip of mini desks below */
  roomy:{cw:262,gap:10,rp:14},   /* card with bigger desks, used only when the floor has room to spare */
  card:{cw:236,gap:8,rp:12},
  mini:{cw:216,gap:6,rp:10},
  micro:{cw:190,gap:5,rp:8}
};
/* Layout candidates, richest first: [density, helpers shown before "+N more"]. The first one that fits wins. */
/* spec 001 FR-029: `full` with a live-activity side panel next to each main desk comes first; it wins only when it fits (and the setting is on) */
const CANDIDATES=[['full',3,'side'],['full',2,'side'],['full',3],['full',2],['roomy',3],['card',3],['card',1],['mini',3],['mini',1],['micro',3],['micro',1]];
/* ---- spec 001 FR-028..FR-032: live activity on the desks. The readout comes from the main agent's own normalized events (liveact.js),
   masked through src/shared/redact.ts (window.DurbarRedact; without it the feature stays off: fail closed). With room to spare, a fixed
   side panel next to each main desk (a layout candidate, so it is used only when it fits); else the desk's text line under the name.
   Painted by textContent at most 4 times a second, never by a re-layout. ---- */
let LIVE_SIDE=false; const SIDE_W=196, SIDE_GAP=8;
let LIVE_PREF=(()=>{try{return localStorage.getItem('durbar.liveActivity')!=='off';}catch(e){return true;}})();
const LIVE_MASK=(()=>{const L=window.DurbarLiveAct,R=NO_REDACT?null:window.DurbarRedact;if(!L||!R||typeof R.redact!=='function')return null;
  return {redact:t=>R.redact(t),cmd:t=>R.maskSecretCommand(t),url:t=>R.maskSecretUrl(t)};})();
const LIVEACT=LIVE_MASK?window.DurbarLiveAct.create({mask:LIVE_MASK}):null;
const liveOn=()=>!!LIVEACT&&LIVE_PREF;
function setLiveOn(on){LIVE_PREF=!!on;try{localStorage.setItem('durbar.liveActivity',LIVE_PREF?'on':'off');}catch(e){}scheduleRender();}
/* the readout to show now, or null: a live main agent that is Working or Thinking (Waiting, Error, Done and Idle keep their own text) */
const liveShown=a=>liveOn()&&a&&!a.parent&&a.live&&!a.paused&&(a.state==='working'||a.state==='thinking')?LIVEACT.of(a.id):null;
const deskLine=a=>{if(GROW)return grownLine(a);const r=LIVE_SIDE?null:liveShown(a);return r?r.text:taskOf(a);};
/* ---- spec 001 FR-041..FR-045: grown desks. With few agents a `roomy` card grows by a factor f (--gf and data-grow on the stage; chosen by
   growSearch in chooseLayout). GROW is set while grown cards are probed or shown: their text line is a box that holds more (FR-043). ---- */
let GROW=0;
const GR=window.DurbarProbe.GROW;
function setGrow(el,f){if(f){el.style.setProperty('--gf',String(f));el.dataset.grow=f>=GR.TWO_LINES?'2':'1';}else{el.style.removeProperty('--gf');delete el.dataset.grow;}}
/* the text of a grown desk: the readout with its newest sentences, else the start of the last reply (Done, Idle), else the desk text.
   The reply is masked on the raw text before Markdown is removed (excerpt); with no working mask nothing from it shows (fail closed). */
/* the start of the last reply, masked on the raw text, plain, cut to 600; '' without a reply or a working mask (fail closed) */
function replyExcerpt(a){return safeExcerpt(a.lastOutput,600,'');} /* spec 041 FR-065: the one mask (safetext), then the cut; '' with no working mask */
/* does the main text of a grown desk show the last reply (a Done or Idle desk with one)? Then no reply column repeats it (FR-047) */
const grownShowsReply=a=>!a.parent&&!liveShown(a)&&(vis(a)==='done'||vis(a)==='idle')&&!!a.lastOutput;
function grownLine(a){
  const r=liveShown(a);
  if(r)return r.kind==='tool'?r.long:(window.DurbarLiveAct.KIND_WORD[r.kind]||'')+': '+r.long;
  if(grownShowsReply(a))return replyExcerpt(a)||(vis(a)==='done'?'Finished.':'Ready.');
  return taskOf(a);
}
/* spec 001 FR-047: the side of a wide grown desk: the last reply (when the main text is not already showing it) and the facts (the tool of
   this turn, usage, context, time). Shown only when the render pass gives the card two or three columns (data-gc); hidden in the probe. */
function grownSideHTML(a){
  if(a.parent)return '';
  const rep=grownShowsReply(a)?'':replyExcerpt(a), r=liveShown(a), facts=[];
  if(r&&r.tool)facts.push([r.kind==='tool'?'Now':'Last tool',r.tool]);
  const u=usageLong(a);
  if(u){const p=u.split(' · ');if(p.length>2){facts.push(['Usage',p.slice(0,2).join(' · ')]);facts.push(['Cost',p.slice(2).join(' · ')]);}else facts.push([SIMPLE?'Cost':'Usage',u.replace(/^Cost so far: /,'')]);}
  try{const c=window.DurbarScreens&&window.DurbarScreens.ctxChip(a);if(c&&c.cls!=='unk')facts.push([SIMPLE?'Memory':'Context',SIMPLE?c.pct+'% full':c.text.replace(/^Context /,'')]);}catch(e){}
  const busy=a.busySince&&(a.state==='working'||a.state==='thinking')?ACT.agoLong(Date.now()-a.busySince):'', last=ACT.agoLong(sinceLast(a));
  if(busy)facts.push(['On this task',busy==='just now'?'just started':busy.replace(/ ago$/,'')]); else if(last)facts.push(['Last activity',last]);
  return `<span class="gx"${rep?' data-rep="1"':''}>${rep?`<span class="gx-r"><span class="gx-h">Last reply</span><span class="gx-t">${esc(rep)}</span></span>`:''}<span class="gx-f">${facts.map(([k,v])=>`<span class="gx-l"><span class="gx-k">${esc(k)}</span> ${esc(v)}</span>`).join('')}</span></span>`;
}
const liveAttrs=a=>{if(a.parent)return '';const r=LIVE_SIDE?null:liveShown(a);return ` data-live="${esc(a.id)}"${r?` data-lk="${r.kind}"`:''}`;};
function sideHTML(a){
  const r=liveShown(a);
  return `<div class="liveside${r?'':' is-empty'}" data-key="side:${esc(a.id)}" data-side="${esc(a.id)}"${r?` data-lk="${r.kind}"`:''} aria-hidden="true"><span class="ls-k">${r?esc(window.DurbarLiveAct.KIND_WORD[r.kind]||''):''}</span><span class="ls-t">${r?esc(r.lines):''}</span></div>`;
}
function paintLive(a){
  const st=$('stage'); if(!st)return;
  const id=CSS.escape(a.id), r=liveShown(a);
  st.querySelectorAll(`[data-live="${id}"]`).forEach(el=>{const t=deskLine(a);if(el.textContent!==t){el.textContent=t;if(GROW)fitSide(el);}const k=LIVE_SIDE||!r?'':r.kind;if((el.dataset.lk||'')!==k){if(k)el.dataset.lk=k;else delete el.dataset.lk;}});
  const sp=st.querySelector(`[data-side="${id}"]`);
  if(sp){const k=r?r.kind:'',w=r?window.DurbarLiveAct.KIND_WORD[k]||'':'',t=r?r.lines:'';
    sp.classList.toggle('is-empty',!r);if((sp.dataset.lk||'')!==k){if(k)sp.dataset.lk=k;else delete sp.dataset.lk;}
    const kw=sp.querySelector('.ls-k'),tx=sp.querySelector('.ls-t');if(kw&&kw.textContent!==w)kw.textContent=w;if(tx&&tx.textContent!==t){tx.textContent=t;fitSide(tx);}}
}
/* text taller than the panel keeps its newest lines in view (bottom-anchored, the top fades): measured, so any font works */
function fitSide(tx){tx.classList.remove('over');if(tx.scrollHeight>tx.clientHeight+1)tx.classList.add('over');}
/* spec 001 FR-043: a grown desk's text box is the room its card leaves, cut to whole lines (so no half line shows), then fitted like the panel */
function fitLines(tx){
  tx.style.flex='';tx.style.height='';
  const lh=parseFloat(getComputedStyle(tx).lineHeight)||16, n=Math.max(1,Math.floor((tx.clientHeight+0.5)/lh));
  tx.style.flex='none';tx.style.height=(n*lh)+'px';
  fitSide(tx);
}
/* spec 001 FR-047, FR-048: a grown card's columns from its width (its grid cell, before any cap): DurbarProbe.grownCols; the card is at most as
   wide as its columns, so a wide room never stretches the lines */
function setGrownCols(card){
  const cell=card.parentElement, sc=card.querySelector('.sc'), gx=card.querySelector('.gx');
  card.style.maxWidth='';
  const cs=getComputedStyle(card), pad=parseFloat(cs.paddingLeft)+parseFloat(cs.paddingRight), cg=parseFloat(cs.columnGap)||0;
  const room=(cell?cell.clientWidth:card.clientWidth)-pad-(sc?sc.getBoundingClientRect().width:0)-cg;
  const c=gx?window.DurbarProbe.grownCols(room,{reply:gx.dataset.rep==='1'}):{n:1};
  if(c.n<2){delete card.dataset.gc;['--gm','--gr','--gs'].forEach(k=>card.style.removeProperty(k));return;}
  const G=window.DurbarProbe.GCOL, side=c.n===3?c.reply+G.GAP+c.side:c.side;
  card.dataset.gc=String(c.n); card.style.setProperty('--gm',c.main+'px'); card.style.setProperty('--gr',c.reply+'px'); card.style.setProperty('--gs',c.side+'px');
  card.style.maxWidth=Math.ceil(pad+(sc?sc.getBoundingClientRect().width:0)+cg+c.main+G.GAP+side)+'px';
}
/* the reply column: whole lines from the top, the last one with an ellipsis */
function fitClamp(tx){
  tx.style.height='';tx.style.webkitLineClamp='';tx.style.flex='';
  const lh=parseFloat(getComputedStyle(tx).lineHeight)||15, n=Math.floor((tx.clientHeight+0.5)/lh);
  tx.parentElement.classList.toggle('is-empty',n<1);
  if(n>=1){tx.style.flex='none';tx.style.height=(n*lh)+'px';tx.style.webkitLineClamp=String(n);}
}
const liveTimers=new Map();
function livePaintSoon(a){
  if(liveTimers.has(a.id))return; /* a trailing paint is already due: it reads the newest text */
  const now=performance.now();
  if(LIVEACT.due(a.id,now)){paintLive(a);return;}
  liveTimers.set(a.id,setTimeout(()=>{liveTimers.delete(a.id);LIVEACT.mark(a.id,performance.now());paintLive(a);},LIVEACT.wait(a.id,now)));
}
function liveFeed(a,e){
  if(!liveOn()||a.parent||e.agentId)return;
  let x;
  if(e.type==='toolCall'&&e.phase==='start'){const k=toolKind(e.tool),l0=editLabel(e)||toolLabel(e.args),l=k==='edit'&&l0&&!e.mcpServer?EV.displayPath(l0,a.info&&a.info.cwd).rel:l0; /* spec 005 FR-020: an edit names its file relative to the folder */x={kind:k,label:l,simple:SIMPLE?plainChip(k,e.tool,l,true):'',skip:isTaskTool(e.tool)};}
  if(LIVEACT.onEvent(a.id,e,x))livePaintSoon(a);
}
let HCAP=1; /* helpers shown on a compact strip before "+N more" (a layout parameter, chosen with the density) */
let HBOOST=new Map(); /* agent id -> helpers shown, for agents that get more than HCAP because the floor has room left over (see chooseLayout) */
const helperCap=(d,a)=>(a&&HBOOST.get(a.id))||HCAP;
const SC_CACHE=new Map();
function sceneCacheKey(a){const st=vis(a),k=a.look,m=moodFor(a);return st+k.shirt+k.skin+k.hair+k.style+(k.glasses?1:0)+'|'+m.body+(m.trouble||'')+'|'+THEME.themeIdForCache();}
function sceneC(a){const key=sceneCacheKey(a);let v=SC_CACHE.get(key);if(!v){v=scene(a,false,true);SC_CACHE.set(key,v);}return v;}
function visibleHelpers(a,d){
  const all=helpersOf(a).slice().sort((x,y)=>prio(x)-prio(y));
  const cap=helperCap(d,a);
  if(all.length<=cap+1||ui.expanded[a.id])return {shown:all,hidden:[]};
  return {shown:all.slice(0,cap),hidden:all.slice(cap)};
}
function moreHTML(a,hidden,d){
  const dots=['waiting','error','working','thinking','done','idle'].map(k=>{const n=hidden.filter(h=>vis(h)===k).length;return n?`<span class="dot ${k}" title="${n} ${LABELS[k]}"></span>`:''}).join('');
  return `<button class="more" data-more="${esc(a.id)}" aria-expanded="false" aria-label="Show ${hidden.length} more helpers of ${esc(a.name)}">+${hidden.length} more ${dots}</button>`;
}
function helperHTML(h){
  const st=vis(h);
  return `<button class="helper is-${st}" data-id="${esc(h.id)}" aria-pressed="${ui.selected===h.id}" aria-label="${esc(h.name)}, helper of ${esc(byId(h.parent).name)}, ${esc(h.role)}, folder ${esc(roomOf(h).path)}, ${label(h)}: ${esc(taskText(h))}" title="${esc(taskText(h))}">
    ${scene(h,true)}<span class="badge ${st}">${badgeSVG(st)}</span>
    <div class="hinfo"><div class="hname">${esc(h.name)}</div><div class="hrole">${esc(h.role)}</div><div class="hst"><span class="dot ${st}"></span>${label(h)}</div></div></button>`;
}
function helperTileHTML(h){
  const st=vis(h);
  return `<button class="helper hc is-${st}" data-id="${esc(h.id)}" aria-pressed="${ui.selected===h.id}" aria-label="${esc(h.name)}, helper of ${esc(byId(h.parent).name)}, ${label(h)}: ${esc(taskText(h))}" title="${esc(h.name)} · ${label(h)}: ${esc(taskText(h))}">
    <span class="sc">${sceneC(h)}</span><span class="hi"><span class="hname">${esc(h.name)}</span><span class="hs st-${st}">${label(h,true)}</span></span></button>`;
}
const visitPlace=a=>{const v=a.parent?null:VISITS.at(a.id);return v?v.place:(RETURNING.has(a.id)?null:null);};
function cardHTML(a,d,nSubs){
  const st=vis(a), use=usageShort(a);
  return `<button class="desk card is-${st}${isFailing(a)?' is-failing':''}${isAway(a)?' is-away':''}" data-id="${esc(a.id)}" data-state="${st}"${isAway(a)&&VISITS.at(a.id)?` data-place="${VISITS.at(a.id).place}"`:''} aria-pressed="${ui.selected===a.id}" title="${esc(deskTip(a))}${moodWords(a)}${use?' · '+use:''}${esc(lastTip(a))}" aria-label="${esc(a.name)}${chatNoWords(a)}${draftWords(a)}, ${esc(a.role)}${modeWords(a)}${remoteWords(a)}, folder ${esc(roomOf(a).path)}, ${esc(stWord(a))}: ${esc(deskMask(taskOf(a)))}${moodWords(a)}${nSubs?`. ${nSubs} helper${nSubs>1?'s':''}`:''}${use?'. Usage '+use:''}. Open chat panel.">
    <span class="sc">${cabinHTML(a,'c',sceneC(a))}</span>
    <span class="ci"><span class="l1">${chatNoHTML(a)}${draftHTML(a)}<span class="name"${nameTipAttr(a)}>${esc(a.name)}</span>${modeIcon(a)}<span class="role">${esc((a.profile?a.profile.name+" · "+a.role:a.role)+kindTag(a)+remoteTag(a))}</span>${signsOn()?signHTML(a,'stl'):`<span class="stl st-${pillSt(a)}">${esc(stWord(a,true))}</span>`}</span>    <span class="intent"${liveAttrs(a)} title="${esc(taskOf(a))}">${esc(deskLine(a))}</span>
    <span class="l3">${signsOn()?signHTML(a,'pill'):`<span class="pill st-${pillSt(a)}"${pillTip(a)}><i></i>${esc(stWord(a,true))}${pillWarn(a)}</span>`}<span class="use"${use.endsWith(' est.')?` title="${esc(USD_TIP)}"`:''}>${capOf(a)&&use.includes(' · ')?`<span class="aiu">${useCost(use.split(' · ')[1])}</span>`:`<span class="tok">${esc(use.split(' · ')[0]||'')}</span>${use.includes(' · ')?`<span class="aiu"><span class="sep">&nbsp;· </span>${useCost(use.split(' · ')[1])}</span>`:''}`}</span></span></span>${GROW?grownSideHTML(a):''}</button>`;
}
function linksSVG(d,rows,extraMore){
  const D=DENS[d]; const n=rows+(extraMore?1:0);
  let py,ys=[];
  if(d==='full'){py=78;for(let i=0;i<n;i++)ys.push(34+i*104);}
  else{py=D.ch/2;for(let i=0;i<rows;i++)ys.push(i*(D.hh+D.hgap)+D.hh/2);if(extraMore)ys.push(rows*(D.hh+D.hgap)+D.mh/2);}
  const w=d==='full'?24:16, mid=d==='full'?12:8;
  return `<svg class="links" aria-hidden="true" focusable="false"><g fill="none" stroke="${T_('--link')}" stroke-width="1" stroke-linecap="round" stroke-linejoin="round">${ys.map(y=>`<path d="M0 ${py}H${mid}V${y}H${w}"/>`).join('')}</g><circle cx="0" cy="${py}" r="2.6" fill="${T_('--link')}"/></svg>`;
}
function unitHTML(a,d){
  const st=vis(a), {shown,hidden}=visibleHelpers(a,d), nSubs=shown.length+hidden.length;
  let helpers='';
  if(nSubs){
    const fewer=ui.expanded[a.id]&&nSubs>helperCap(d,a)+1;
    if(d==='full'){
      const rows=shown.map(helperHTML).join('');
      helpers=`<div class="helpers" data-key="strip">${linksSVG(d,shown.length,hidden.length>0||fewer)}${rows}${hidden.length?moreHTML(a,hidden,d):''}${fewer?`<button class="more" data-more="${esc(a.id)}" aria-expanded="true">Show fewer</button>`:''}</div>`;
    } else {
      helpers=`<div class="helpers hstrip${fewer?' open':''}" data-key="strip">${shown.map(helperTileHTML).join('')}${hidden.length?moreHTML(a,hidden,d):''}${fewer?`<button class="more fewer" data-more="${esc(a.id)}" aria-expanded="true">Show fewer</button>`:''}</div>`;
    }
  }
  let desk;
  if(d==='full'){
    desk=`<button class="desk is-${st}${isAway(a)?' is-away':''}" data-id="${esc(a.id)}" data-state="${st}"${isAway(a)&&VISITS.at(a.id)?` data-place="${VISITS.at(a.id).place}"`:''} aria-pressed="${ui.selected===a.id}"${lastTip(a)?` title="${esc(lastTip(a).slice(3))}"`:''} aria-label="${esc(a.name)}${chatNoWords(a)}${draftWords(a)}, ${esc(a.role)}${modeWords(a)}${remoteWords(a)}, folder ${esc(roomOf(a).path)}, ${esc(stWord(a))}: ${esc(deskMask(taskOf(a)))}${moodWords(a)}${nSubs?`. ${nSubs} helper${nSubs>1?'s':''}`:''}. Open chat panel.">
      ${cabinHTML(a,'f',scene(a,false))}<span class="badge ${st}">${badgeSVG(st)}</span>
      <div class="info"><div class="who">${chatNoHTML(a)}${draftHTML(a)}<span class="name"${nameTipAttr(a)}>${esc(a.name)}</span>${modeIcon(a)}<span class="role">${esc((a.profile?a.profile.name+" · "+a.role:a.role)+kindTag(a)+remoteTag(a))}</span></div>
      <p class="task"${liveAttrs(a)} title="${esc(taskOf(a))}">${esc(deskLine(a))}</p>${signsOn()?signHTML(a,'pill'):`<span class="pill st-${pillSt(a)}"${pillTip(a)}><i></i>${esc(stWord(a))}${pillWarn(a)}</span>`}</div></button>`;    if(LIVE_SIDE)desk+=sideHTML(a);
  } else desk=cardHTML(a,d,nSubs);
  return `<div class="unit${nSubs?' has-h':''}${SHUT_PREV&&SHUT_PREV.has(a.id)?' unrolling':''}" data-key="unit:${esc(a.id)}">${desk}${helpers}${doorBtnHTML(a)}</div>`; /* the door button last: sibling rules such as .liveside+.helpers stay true */
}
const unitWidth=(a,d)=>{const D=DENS[d];return D.cw+(d==='full'&&LIVE_SIDE?SIDE_W+SIDE_GAP+(helpersOf(a).length?2:0):0)+(helpersOf(a).length?(d==='full'?D.hw+14+8:D.hw+18):0);};
/* ---- spec 001 FR-051..FR-056: finished agents rest in the lounge when their room has others at work. A resting agent is not a desk in the
   layout search (so its space goes to the other desks); it sits on a couch (finished in the last 10 minutes) or sleeps in a bunk bed (older),
   in a lounge corner at the end of its room's desk row. The rules are in shutters.js; the time is the agent's last event (the desk's "Last
   activity", repainted every 30 s). Its button carries the state as data-state and as its first is-* class (drivers read it), the resting
   kind as rest-recent / rest-old and data-rest. */
const SHUT=window.DurbarShutters;
let SHUT_PREF=(()=>{try{return localStorage.getItem('durbar.shutters')!=='off';}catch(e){return true;}})();
const shutOn=()=>!!SHUT&&SHUT_PREF;
function setShutOn(on){SHUT_PREF=!!on;try{localStorage.setItem('durbar.shutters',SHUT_PREF?'on':'off');}catch(e){}scheduleRender();}
const shutInput=a=>({id:a.id,state:vis(a),paused:!!a.paused,limit:!!a.limit,away:isAway(a),replied:!!a.lastOutput,helpersBusy:helpersOf(a).some(h=>{const s=vis(h);return s!=='done'&&s!=='idle';}),since:sinceLast(a)});
function shutPlan(r){
  if(!shutOn())return new Map();
  return SHUT.roomPlan(agents.filter(a=>!a.parent&&a.room===r.id).map(shutInput));
}
let SHUT_PREV=null; /* ids rolled at the last render: a newly rolled agent rolls in once (FR-055), a desk that unrolls rolls out once */
const SHUT_MARK='<svg class="sh-mark" viewBox="0 0 12 12" aria-hidden="true" focusable="false"><circle cx="6" cy="6" r="5.2" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M3.6 6.2 5.3 7.8 8.4 4.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
/* the reply for the couch bubble, the dream cloud and its tooltip, the peek card: masked, then cut (spec 041 FR-065); without a working mask nothing from it (fail closed) */
function shutReply(a,n){const fb=vis(a)==='done'?'Finished.':'Ready.';return (a.lastOutput?safeExcerpt(a.lastOutput,n,fb):'')||fb;}
/* FR-052: the lounge. Each resting agent is its own character (avatar(a): the theme's scene kit, the same person as on its desk) on a couch
   seat (recent) or a nap bed (old); a speech bubble over the couch and a dream cloud over the beds take turns (LOUNGE_TURN, FR-055). */
let LOUNGE_TURN=0;
function restHTML(x,i){
  const {a,k}=x, st=vis(a), ago=ACT.agoLong(sinceLast(a)), said=SHUT.spoken(ago), line=shutReply(a,140);
  const who=a.profile?a.profile.name+' · '+a.role:a.role;
  const roll=SHUT_PREV&&!SHUT_PREV.has(a.id)?' rolling':'';
  const where=k==='recent'?'resting on the couch':'asleep on a nap bed';
  const lab=`${esc(a.name)}${chatNoWords(a)}${draftWords(a)}, ${esc(who)}, folder ${esc(roomOf(a).path)}, ${where}, ${st==='done'?'finished':'idle after its reply'}${said?' '+esc(said):''}: ${esc(line)}${/[.!?…]$/.test(line)?'':'.'} Open chat panel.`; /* every part escaped here */
  const peek=`<span class="peek" aria-hidden="true"><span class="pk-h"><b>${esc(a.name)}</b><span class="pk-role">${esc(who)}</span></span><span class="pk-st">${signsOn()?(g=>`<span class="dsign-tx" data-sign="${g.key}">${signIcon(g.icon)}${esc(g.word)}</span>`)(signOf(a,true)):SHUT_MARK+esc(stWord(a))}${ago?' · finished '+esc(ago):''} · ${where}</span><span class="pk-tx">${esc(shutReply(a,300))}</span></span>`;
  const art=k==='recent'
    ?`<span class="lg-av">${avatar(a)}</span>`
    :`<svg class="lg-bed" viewBox="0 0 44 24" preserveAspectRatio="none" aria-hidden="true" focusable="false"><rect class="bd-frame" x="1" y="10" width="42" height="11" rx="3"/><rect class="bd-head" x="1" y="3" width="5" height="18" rx="2"/><rect class="bd-mat" x="5" y="8" width="37" height="6" rx="2.5"/><rect class="bd-pil" x="6" y="5" width="10" height="5" rx="2.5"/><rect class="bd-leg" x="3" y="20" width="3" height="4"/><rect class="bd-leg" x="38" y="20" width="3" height="4"/></svg><span class="lg-av lying">${avatar(a)}</span><svg class="lg-blanket" viewBox="0 0 44 24" preserveAspectRatio="none" aria-hidden="true" focusable="false"><path class="bd-blk" d="M17 6.5q12-3 25 1V14H17z"/></svg>`;
  return `<button class="desk shut is-${st} rest-${k}${roll}" type="button" data-id="${esc(a.id)}" data-state="${st}" data-rest="${k}" aria-pressed="${ui.selected===a.id}" aria-label="${lab}"><span class="lg-sp">${chatNoHTML(a)}${draftHTML(a)}${art}<span class="name lg-name">${esc(a.name)}</span></span>${peek}</button>`;
}
/* FR-053: a room's resting agents, their couches and beds, and the corner's width (DurbarShutters.width, counted by the layout) */
function shutGroup(r,rolled){
  if(!rolled||!rolled.length)return null;
  const recent=rolled.filter(x=>x.k==='recent'), old=rolled.filter(x=>x.k==='old'), key='shut:'+r.id, open=!!ui.expanded[key];
  const {shown,hidden}=SHUT.split(old,SHUT.OLD_CAP,open), fewer=open&&old.length>SHUT.OLD_CAP;
  const more=hidden.length>0||fewer, cs=SHUT.couches(recent.length), cols=SHUT.bunks(shown.length), items=cols+(more?1:0);
  const w=SHUT.width(recent.length,shown.length,more), inner=w-2*SHUT.PAD;
  let couchW=cs.length?cs.reduce((x,k)=>x+k*SHUT.SEAT_W+SHUT.COUCH_PAD,0)+(cs.length-1)*SHUT.GAP:0, bedW=items?cols*SHUT.BUNK_W+(more?SHUT.MORE_W:0)+(items-1)*SHUT.GAP:0;
  /* one kind only: its bubble takes the whole width (the corner is at least MIN_W wide); both: each over its own furniture */
  const sayW=couchW&&!bedW?inner:couchW, dreamW=bedW&&!couchW?inner:bedW;
  return {recent,old,shown,hidden,fewer,key,cs,couchW,bedW,sayW,dreamW,w};
}
const shutW=(r,rolled)=>{const g=shutGroup(r,rolled);return g?g.w:0;};
/* one bubble: every resident's line, the one whose turn it is shown; its tail points at that resident (x: the centre of its seat or bed) */
function bubbleHTML(cls,list,width,xOf,lineOf,tip){
  if(!list.length)return width?`<span class="lg-bub none" style="flex-basis:${width}px"></span>`:'';
  const on=SHUT.turn(LOUNGE_TURN,list.length);
  return `<span class="lg-bub ${cls}" style="flex-basis:${width}px;--tail:${xOf(on)}px" aria-hidden="true"${tip?` title="${esc(tip)}"`:''}>${list.map((x,i)=>`<span class="lg-t${i===on?' on':''}" style="--tx:${xOf(i)}px">${cls==='dream'?'<b class="lg-zz">z z</b> ':''}${esc(lineOf(x))}</span>`).join('')}</span>`;
}
function shuttersHTML(r,rolled){
  const g=shutGroup(r,rolled); if(!g)return '';
  const cs=g.cs;
  /* the centre of seat i and of bed i, from the left of their zone */
  const seatX=i=>{let x=0,n=i;for(const k of cs){if(n<k)return x+SHUT.COUCH_PAD/2+n*SHUT.SEAT_W+SHUT.SEAT_W/2;x+=k*SHUT.SEAT_W+SHUT.COUCH_PAD+SHUT.GAP;n-=k;}return x;};
  const bedX=i=>Math.floor(Math.min(i,Math.max(0,g.shown.length-1))/2)*(SHUT.BUNK_W+SHUT.GAP)+SHUT.BUNK_W/2;
  let seat=0;
  const couches=cs.map(k=>{const xs=g.recent.slice(seat,seat+k);seat+=k;
    return `<span class="lg-couch" style="flex-basis:${k*SHUT.SEAT_W+SHUT.COUCH_PAD}px"><svg class="lg-sofa" viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true" focusable="false"><rect class="sf-back" x="4" y="2" width="92" height="24" rx="7"/><rect class="sf-seat" x="4" y="20" width="92" height="14" rx="4"/><rect class="sf-arm" x="0" y="12" width="9" height="24" rx="4"/><rect class="sf-arm" x="91" y="12" width="9" height="24" rx="4"/><rect class="sf-leg" x="8" y="34" width="5" height="6"/><rect class="sf-leg" x="87" y="34" width="5" height="6"/></svg>${xs.map(restHTML).join('')}</span>`;}).join('');
  const all=g.old, dreams=all.map(x=>x.a.name+': '+shutReply(x.a,90)).join('\n');
  const say=bubbleHTML('say',g.recent,g.sayW,seatX,x=>shutReply(x.a,160),'');
  const dream=bubbleHTML('dream',all,g.dreamW,i=>bedX(i),x=>shutReply(x.a,160),dreams);
  /* bunks: two beds to a column (the lower bunk first) */
  const bunks=[];for(let i=0;i<g.shown.length;i+=2)bunks.push(`<span class="lg-bunk">${g.shown.slice(i,i+2).map(restHTML).join('')}</span>`);
  const beds=bunks.join('')+(g.hidden.length?`<button class="more shut-more" type="button" data-more="${esc(g.key)}" aria-expanded="false" aria-label="Show ${g.hidden.length} more finished agents asleep in ${esc(r.name)}" title="${g.hidden.length} more asleep">+${g.hidden.length} asleep</button>`:'')+(g.fewer?`<button class="more shut-more fewer" type="button" data-more="${esc(g.key)}" aria-expanded="true" aria-label="Show fewer finished agents in ${esc(r.name)}">Fewer</button>`:'');
  const n=g.recent.length+g.old.length;
  return `<div class="lounge" data-key="${esc(g.key)}" style="--shw:${g.w}px" role="group" aria-label="${n} finished agent${n>1?'s':''} resting in ${esc(r.name)}"><div class="lg-bubs">${say}${g.couchW&&g.bedW?'<span class="lg-gap"></span>':''}${dream}</div><div class="lg-in">${couches?`<span class="lg-couches" style="flex-basis:${g.couchW}px">${couches}</span>`:''}${beds?`<span class="lg-beds" style="flex-basis:${g.bedW}px">${beds}</span>`:''}</div></div>`;
}
/* FR-055: the bubbles take turns without a re-render (classes only); the page's own timer, or a driver's tick in the frozen simulator */
function loungeTurn(){
  LOUNGE_TURN++;
  document.querySelectorAll('#stage .lg-bub').forEach(b=>{const ts=b.querySelectorAll('.lg-t'),k=SHUT.turn(LOUNGE_TURN,ts.length);ts.forEach((t,i)=>t.classList.toggle('on',i===k));if(ts[k])b.style.setProperty('--tail',ts[k].style.getPropertyValue('--tx'));});
}
if(!(qs.has('sim')&&qs.get('simfreeze')==='1'))setInterval(()=>{if(document.querySelector('#stage .lg-bub .lg-t + .lg-t'))loungeTurn();},7000);
/* FR-054: the peek card opens beside the lounge: to its left, or to its right when the room has no space on the left (measured on hover and focus) */
const shutAim=e=>{const b=e.target&&e.target.closest&&e.target.closest('#stage .desk.shut');if(!b)return;const g=b.closest('.lounge'),room=b.closest('.room');if(!g||!room)return;
  b.classList.toggle('pk-right',g.getBoundingClientRect().left-room.getBoundingClientRect().left<330);};
document.addEventListener('pointerover',shutAim);document.addEventListener('focusin',shutAim);
function officeModel(ignoreStatus){
  const rooms=[];
  roomsInOrder().forEach(r=>{
    if(!roomShown(r)||(ui.ws!=='all'&&ui.ws!==r.id))return;
    const plan=shutPlan(r); /* spec 001 FR-051: from the whole room, not the status filter */
    const shown=agents.filter(a=>!a.parent&&a.room===r.id&&(ignoreStatus||matchStatus(a)));
    if(!shown.length)return;
    const key=a=>Math.min(prio(a),...helpersOf(a).map(prio));
    shown.sort((x,y)=>key(x)-key(y));
    const mains=shown.filter(a=>!plan.has(a.id)), rolled=shown.filter(a=>plan.has(a.id)).map(a=>({a,k:plan.get(a.id)}));
    rooms.push({r,mains,rolled,all:agents.filter(a=>wsOf(a)===r.id)});
  });
  return rooms;
}
/* ---- room doors (spec 017): a closed room is a compact door plate with a one-line status ---- */
/* door colours come from the theme (spec 036) */
/* ink: spec 017 FR-004, the same door drawn in the text colour (currentColor) for a session's door sign; no theme art there */
function doorSvg(open,ink){
  const t=ink?(n=>/-(line|knob)$/.test(n)?'currentColor':'none'):T_; /* ink: outlines and the knob only, no fills */
  const art=ink?null:THEME.slot('door-art'), ov=art===null?'':`<g class="art-slot" data-slot="door-art">${art}</g>`;
  return open
    ?`<svg class="door-svg" viewBox="0 0 20 20" aria-hidden="true" focusable="false"><rect x="4" y="2.5" width="12" height="15" rx="1.6" fill="${t('--door-bg')}" stroke="${t('--door-line')}" stroke-width="1.2"/>${ov}<path class="leaf" d="M4.4 3.2 9.6 4.6V15.4L4.4 16.8Z" fill="${t('--door-leaf')}" stroke="${t('--door-leaf-line')}" stroke-width="1"/><circle cx="8.2" cy="10" r=".8" fill="${t('--door-knob')}"/></svg>`
    :`<svg class="door-svg" viewBox="0 0 20 20" aria-hidden="true" focusable="false"><rect x="4" y="2.5" width="12" height="15" rx="1.6" fill="${t('--door-leaf')}" stroke="${t('--door-leaf-line')}" stroke-width="1.2"/><rect x="6.2" y="4.7" width="7.6" height="4.4" rx=".9" fill="${t('--door-panel')}"/><circle cx="13.1" cy="12" r="1" fill="${t('--door-knob')}"/>${ov}</svg>`;
}
/* ---- spec 017 FR-003..FR-009 (2026-10-23, owner): a session's meeting-room door sign. The sign is derived from the shown state
   (DurbarRoom.doorSign); it takes the place of the desk's status pill or word and uses the same .st-* colours. The plain word stays in
   the desk's accessible name, its tooltip, the list and the counters. */
const SIGN_ICONS={
  alert:'<path d="M6 1.6 11 10.4H1Z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M6 4.8v2.6M6 8.9v.1" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>',
  hourglass:'<path d="M3 1.5h6M3 10.5h6M3.6 1.6c0 2.6 4.8 2.6 4.8 4.4S3.6 7.8 3.6 10.4M8.4 1.6c0 2.6-4.8 2.6-4.8 4.4s4.8 1.8 4.8 4.4" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>',
  bar:'<circle cx="6" cy="6" r="4.7" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M3.6 6h4.8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  clock:'<circle cx="6" cy="6" r="4.7" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M6 3.4V6l1.8 1.2" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>',
  people:'<circle cx="4.2" cy="4" r="1.7" fill="currentColor"/><circle cx="8.2" cy="4.4" r="1.5" fill="currentColor"/><path d="M1.2 10.2c.3-2.2 1.5-3.2 3-3.2s2.7 1 3 3.2ZM7.6 7.2c1.6-.3 2.9.6 3.2 3H8.5" fill="currentColor"/>',
  dot:'<circle cx="6" cy="6" r="4.7" fill="none" stroke="currentColor" stroke-width="1.3"/><circle cx="6" cy="6" r="2.5" fill="currentColor"/>',
  check:'<circle cx="6" cy="6" r="4.7" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M3.8 6.1 5.3 7.6 8.3 4.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>',
  inbox:'<path d="M1.6 7.2 3 2.4h6l1.4 4.8v2.6H1.6Z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M1.6 7.2h2.6l.7 1.2h2.2l.7-1.2h2.6" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>',
  bolt:'<path d="M6.8 1.2 2.6 6.9h3l-.8 3.9 4.6-6H6.4Z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>',
  bubble:'<path d="M2 3.4A1.6 1.6 0 0 1 3.6 1.8h4.8A1.6 1.6 0 0 1 10 3.4v3A1.6 1.6 0 0 1 8.4 8H5.2L3 10V8h0A1.6 1.6 0 0 1 2 6.4Z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><circle cx="4.4" cy="4.9" r=".6" fill="currentColor"/><circle cx="6" cy="4.9" r=".6" fill="currentColor"/><circle cx="7.6" cy="4.9" r=".6" fill="currentColor"/>',
  ring:'<circle cx="6" cy="6" r="4.7" fill="none" stroke="currentColor" stroke-width="1.3"/><circle cx="6" cy="6" r="1.6" fill="none" stroke="currentColor" stroke-width="1.2"/>',
  wallet:'<rect x="1.4" y="3.2" width="9.2" height="6.8" rx="1.3" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M1.6 4.6 8.6 2" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><circle cx="8.4" cy="6.6" r=".9" fill="currentColor"/>',
  lock:'<rect x="2.3" y="5.3" width="7.4" height="5.2" rx="1.1" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M4 5.3V3.9a2 2 0 0 1 4 0v1.4" fill="none" stroke="currentColor" stroke-width="1.3"/>'
};
/* spec 017 FR-011a, FR-019, FR-020 (owner 2026-10-23): the figure's props, in the agent's own shirt and skin colours and the theme's door
   tokens (no new colours); `still` under reduced motion or in Serious mode (FR-022) */
const motionStill=()=>REDUCED||SERIOUS?' still':'';
function waveArmSvg(a,cls){const k=themedLook(a.look);return `<svg class="${cls}${motionStill()}" viewBox="24 0 24 48" aria-hidden="true" focusable="false"><path d="M37.5 47 41 30.5" stroke="${k.shirt}" stroke-width="5.5" stroke-linecap="round" fill="none"/><circle cx="41.8" cy="26.6" r="3.6" fill="${k.skin}"/></svg>`;}
/* an open, empty wallet held out in both hands (calm, no money): the theme's door colours for the leather, the surface inside */
function walletSvg(a,cls){const k=themedLook(a.look),t=T_;return `<svg class="${cls}${motionStill()}" viewBox="0 0 48 30" aria-hidden="true" focusable="false"><path d="M6 29 12 17M42 29 36 17" stroke="${k.shirt}" stroke-width="5" stroke-linecap="round" fill="none"/><rect x="9" y="6" width="30" height="16" rx="3" fill="${t('--door-leaf-line')}"/><rect x="12" y="8.5" width="24" height="11" rx="2" fill="${t('--surface')}"/><path d="M17 14h14" stroke="${t('--door-leaf-line')}" stroke-width="1.4" stroke-dasharray="2 2.4" stroke-linecap="round"/><circle cx="12" cy="17" r="3.2" fill="${k.skin}"/><circle cx="36" cy="17" r="3.2" fill="${k.skin}"/></svg>`;}
/* FR-021: small flames on the desk of an agent in error, in the error and waiting colour tokens; they flicker, still under FR-022 */
function fireSvg(){const t=T_;return `<svg class="cb-fire${motionStill()}" viewBox="0 0 60 24" preserveAspectRatio="xMidYMax meet" aria-hidden="true" focusable="false"><g class="fl fl1"><path d="M10 24C4 20 7 13 11 9c0 5 4 5 4 10 0 3-2 5-5 5Z" fill="${t('--c-error')}"/><path d="M11 24c-2-2-1-5 1-7 0 3 2 3 2 5 0 1-1 2-3 2Z" fill="${t('--c-waiting')}"/></g><g class="fl fl2"><path d="M30 24c-7-4-4-13 1-18 0 6 6 7 6 13 0 3-3 5-7 5Z" fill="${t('--c-error')}"/><path d="M31 24c-3-2-2-6 1-9 0 4 3 4 3 7 0 1-2 2-4 2Z" fill="${t('--c-waiting')}"/></g><g class="fl fl3"><path d="M50 24c-5-3-3-9 1-12 0 4 4 5 4 9 0 2-2 3-5 3Z" fill="${t('--c-error')}"/><path d="M50.5 24c-2-1.5-1-4 .8-6 0 2.5 2 2.8 2 4.6 0 .9-1.3 1.4-2.8 1.4Z" fill="${t('--c-waiting')}"/></g></svg>`;}
const signIcon=k=>`<svg class="ds-ic" viewBox="0 0 12 12" aria-hidden="true" focusable="false" data-icon="${k}">${SIGN_ICONS[k]||''}</svg>`;
let SIGN_PREF=(()=>{try{return localStorage.getItem('durbar.doorsigns')!=='off';}catch(e){return true;}})();
const signsOn=()=>!!(window.DurbarRoom&&window.DurbarRoom.doorSign)&&SIGN_PREF;
function setSignsOn(on){SIGN_PREF=!!on;try{localStorage.setItem('durbar.doorsigns',SIGN_PREF?'on':'off');}catch(e){}layoutKey='';scheduleRender();}
/* spec 017 FR-015: doors the user closed (id -> {closed, held}), from main (bridge.doorsList, kept fresh by onDoorsChanged) */
let DOORS={};
const doorOf=a=>(a&&!a.parent&&DOORS[a.id])||{closed:false,held:0};
const signOf=(a,resting)=>window.DurbarRoom.doorSign({state:vis(a),paused:!!a.paused,coffee:!!a.coffee,limit:!!a.limit,ended:vis(a)==='idle'&&a.label==='Ended',resting:!!resting,failing:isFailing(a),helpers:helpersOf(a).map(vis),userClosed:doorOf(a).closed,held:doorOf(a).held});
const signTitle=(a,g)=>g.key==='shut'?'Do not disturb (you closed it)'+(doorOf(a).held?' · '+doorOf(a).held+' held':''):g.word;
/* the sign in the pill's place (cls 'pill': door, icon, word and the warning a pill carries) or in the mini/micro status word's place
   (cls 'stl': icon and short word only, so it gives way like the status word did and a long name keeps three characters, FR-007) */
function signHTML(a,cls){
  const g=signOf(a);
  return `<span class="${cls} dsign st-${g.tone} ds-${g.key}" data-sign="${g.key}" title="${esc(signTitle(a,g))}: ${esc(stWord(a))}${isFailing(a)?' ('+MOOD.failStreak(a.id)+' tool calls failed in a row)':''}">${cls==='pill'?doorSvg(g.door==='open',true):''}${signIcon(g.icon)}<span class="dsw">${esc(cls==='stl'?g.short:g.word)}</span>${cls==='pill'?pillWarn(a):''}</span>`;
}
/* spec 017 FR-011..FR-014 (owner 2026-10-23, "real office cabin style"): each session is a cabin. While the agent is busy, waits, must
   not be disturbed or is away, its cabin door is closed and drawn in place of the desk scene (same box, so the layout is unchanged): the
   door in the theme's door colours (the folder door's tokens), the agent's photo (its avatar from the scene kit) and a meeting-room sign
   (icon and short word in the status colours). When its work is done, it is free or it has an error, the door stands open: the desk
   scene as today, an open door leaf at its edge and a tag (Done, Available, Alert). kind: 'c' (card scene box) or 'f' (full desk). */
function cabinHTML(a,kind,sceneHTML){
  if(!signsOn())return sceneHTML;
  const g=signOf(a), tag=`<span class="cb-sign st-${g.tone}" data-sign="${g.key}">${signIcon(g.icon)}<span class="cb-w" data-w="${esc(g.short)}"></span></span>`; /* the word as CSS content: a desk's text still starts with its name (drivers and the office check find desks that way) */
  if(g.door==='open')return `<span class="cb-scene cb-${kind}">${sceneHTML}<span class="cb-open" data-cabin="open" aria-hidden="true"><span class="cb-leaf-open"></span>${g.effect==='fire'?fireSvg():''}${tag}</span></span>`;
  /* FR-019: at Durbar's spending limit the agent stands at its closed door holding out an empty wallet, the Limit sign above */
  if(g.figure==='wallet')return `<span class="cabin cb-${kind} cb-waiting cb-limit st-${g.tone}" data-cabin="limit" aria-hidden="true"><span class="cb-door"><span class="cb-knob"></span></span><span class="cb-figure">${avatar(a)}${walletSvg(a,'cb-wallet')}</span>${tag}</span>`;
  /* owner 2026-10-23 13:59 UTC: someone waiting for you is not shut in: it stands in front of its closed door and waves, the sign above it.
     The figure is the scene kit's avatar; the waving arm is drawn in its own shirt and skin colours; no animation with reduced motion or
     in Serious mode (a static raised hand) */
  if(g.figure==='wave'){
    const arm=waveArmSvg(a,'cb-arm');
    return `<span class="cabin cb-${kind} cb-waiting st-${g.tone}" data-cabin="waiting" aria-hidden="true"><span class="cb-door"><span class="cb-knob"></span></span><span class="cb-figure">${avatar(a)}${arm}</span>${tag}</span>`;
  }
  return `<span class="cabin cb-${kind} st-${g.tone}" data-cabin="closed" aria-hidden="true"><span class="cb-door"><span class="cb-photo">${avatar(a)}</span><span class="cb-knob"></span></span>${tag}</span>`;
}
/* spec 017 FR-015: the door button beside a desk (not inside it: a button cannot hold a button), on the scene's corner */
function doorBtnHTML(a){
  if(!signsOn()||!bridge||!bridge.setDoor||demoOn||a.parent)return '';
  const d=doorOf(a), lab=d.closed?'Open the door: '+a.name+(d.held?' ('+d.held+' held)':''):d.held?'Send or discard '+d.held+' held: '+a.name:'Close the door (do not disturb): '+a.name;
  /* the tooltip names the agent cut short (a long session title, spec 052 FR-171's 120 characters); the accessible name is whole */
  const tip=(d.closed?'Open the door: ':d.held?'Send or discard '+d.held+' held: ':'Close the door (do not disturb): ')+DurbarCutText.cutText(a.name,60)+(d.closed&&d.held?' ('+d.held+' held)':'');
  return `<button class="cb-toggle" type="button" data-doorset="${esc(a.id)}" aria-pressed="${d.closed}" aria-label="${esc(lab)}" title="${esc(tip)}">${doorSvg(!d.closed,true)}</button>`;
}
function roomArt(){
  let s='';
  for(const name of ['room-back-wall','room-back-window','room-floor']){
    const v=THEME.slot(name);
    s+=v===null?'':`<svg class="room-art" data-slot="${name}" viewBox="0 0 320 118" preserveAspectRatio="none" aria-hidden="true" focusable="false">${v}</svg>`;
  }
  return s;
}
function roomSummary(r){
  const mains=agents.filter(a=>!a.parent&&a.room===r.id);
  const sum=window.DurbarRoom.summarizeRoom(mains.map(a=>({state:vis(a),helpers:helpersOf(a).map(vis)})));
  return Object.assign({n:mains.length},sum);
}
function plateHTML({r}){
  const sm=roomSummary(r), u=roomAiu(r), al=roomAlert(r);
  return `<button class="plate tone-${sm.tone}" type="button" data-door="${esc(r.id)}" data-key="door:${esc(r.id)}" data-tint="${r.tint}" aria-expanded="false" aria-label="${esc(wordOf('door-open'))} ${esc(r.name)}. ${esc(sm.text)}. ${sm.n} agent${sm.n===1?'':'s'}.${u?' Usage: '+esc(u.long)+'.':''}${al.siren?' '+ALERT_WORDS+'.':''}" title="${esc(r.path)}">${doorSvg(false)}<span class="plate-tx"><b>${esc(r.name)}</b>${al.siren?SIREN():''}${floorTag(r)}<span class="plate-sum">${esc(sm.text)}</span></span>${u?`<span class="plate-aiu" title="${esc(u.tip)}">${esc(u.short)}</span>`:''}<span class="plate-n">${sm.n}</span></button>`;
}
const doorsHTML=list=>list.length?`<div class="doors" data-key="doors">${list.map(plateHTML).join('')}</div>`:'';
function stageHTML(sizing,d,aw,cap){return stageParts(sizing,d,aw,cap).join('');}
/* the stage in parts (each open room, the lobby, the door plates), so a render can patch only the parts that changed */
function stageParts(sizing,d,aw,cap){
  const open=sizing.filter(m=>!m.r.closed).map(m=>roomHTML(m,d,aw,cap)), doors=doorsHTML(sizing.filter(m=>m.r.closed)), lob=lobbyHTML(aw);
  const mid=!lob?open.length:open.length<2?open.length:Math.ceil(open.length/2); /* one room: below it; none: above the door plates */
  return [...open.slice(0,mid),lob,...open.slice(mid),doors].filter(Boolean);
}
/* spec 052 (2026-10-21, measured): a render used to rebuild, parse and diff the whole stage although a tick usually changes one
   desk. Each part's HTML is remembered; only a part whose HTML changed is parsed and morphed. Anything unexpected (parts added,
   removed or reordered, a part with more than one root) falls back to the full morph, so the result is the same DOM. */
let stagePrev=null;
function morphParts(stage,parts){
  const prev=stagePrev;
  if(!prev||prev.length!==parts.length)return false;
  const kids=[...stage.children].filter(k=>!k.classList.contains('scene-out'));
  if(kids.length!==parts.length)return false;
  for(let i=0;i<parts.length;i++){
    if(parts[i]===prev[i])continue;
    const t=document.createElement('template');t.innerHTML=parts[i];
    const n=t.content.firstElementChild;
    if(!n||t.content.childElementCount!==1||keyOf(n)==null||keyOf(n)!==keyOf(kids[i]))return false;
    morphNode(kids[i],n);
  }
  return true;
}
/* spec 017 FR-015, FR-017: the door button of a desk. Closing it: Do not disturb (scheduled runs are held, remote control goes off first;
   if that fails the door stays open and says so). Opening it with runs held asks, listing them: Send all (in order, through the
   scheduler), Discard, or Keep closed (the default: Escape and Enter keep it closed). An open door that still holds runs asks the same. */
const doorRemoteOff=new Set(); /* agents whose remote control the door turned off: reopening says it stays off */
/* review on #631: the held prompts, each masked first, then its first line cut (never cut before masking); fail closed without the mask */
async function heldLines(a){
  const list=bridge.doorsHeld?await bridge.doorsHeld(a.id).catch(()=>[]):[], R=window.DurbarRedact, out=[];
  const MAXL=8;
  for(const h of (Array.isArray(list)?list:[]).slice(0,MAXL)){
    const t=h&&typeof h.prompt==='string'?h.prompt:'';
    const m=R&&typeof R.redact==='function'?R.redact(t):null;
    out.push(m===null?'(hidden: masking is not available)':DurbarCutText.cutText(String(m).split(/\r?\n/).find(x=>x.trim())||'(empty)',90));
  }
  if(Array.isArray(list)&&list.length>MAXL)out.push('and '+(list.length-MAXL)+' more');
  return out;
}
async function askHeld(a,btn,closed){
  const n=doorOf(a).held, lines=await heldLines(a);
  return askDialog({title:(closed?'Open the door of ':'Held prompts of ')+a.name+'?',body:n+(n===1?' prompt was':' prompts were')+' held while the door was closed. Send all sends them in order through the schedules (Pause all and each schedule\'s limit still apply): the first now, each next one when '+a.name+' is free again.',
    lines,buttons:[{label:closed?'Keep closed':'Not now',value:null},...(closed?[]:[{label:'Close the door',value:'close'}]),{label:'Discard',value:'discard'},{label:'Send all ('+n+')',value:'send'}],returnFocus:()=>document.querySelector(`[data-doorset="${CSS.escape(a.id)}"]`)||btn});
}
async function sendOrDiscard(a,how,n){
  const q=await bridge.releaseHeld(a.id,how).catch(()=>null);
  if(!q||!q.ok){toast('The held prompts are still there: '+esc((q&&q.error)||'could not '+how+' them')+'.',5200).classList.add('err');return;}
  toast(esc(a.name)+': '+(how==='send'?(n===1?'the held prompt goes out when '+esc(a.name)+' is free.':'the '+n+' held prompts go out one by one.'):(n===1?'1 held prompt discarded.':n+' held prompts discarded.')),4200);
}
async function closeDoor(a){
  const r=await bridge.setDoor(a.id,true).catch(()=>null);
  if(!r||!r.ok){toast('Could not close the door'+(r&&r.error?': '+esc(r.error):'.'),5200).classList.add('err');return;}
  DOORS[a.id]={closed:true,held:r.held||0};
  if(r.remoteOff)doorRemoteOff.add(a.id); /* main also sent agents:remoteOff: the Remote chip and the card's tag go (onRemoteOff) */
  scheduleRender();
  announce(a.name+': door closed. Do not disturb: scheduled prompts are held until you open it.');
  toast(esc(a.name)+': door closed. Scheduled prompts wait here until you open it'+(r.remoteOff?'; remote control is off.':'.'),4200);
}
async function toggleDoor(id,btn){
  const a=byId(id); if(!a||a.parent||!bridge||!bridge.setDoor)return;
  const cur=doorOf(a);
  if(!cur.closed&&!cur.held)return closeDoor(a);
  if(!cur.closed){ /* an open door that still holds runs */
    const v=await askHeld(a,btn,false);
    if(!v||!v.value)return;
    if(v.value==='close')return closeDoor(a);
    return sendOrDiscard(a,v.value,cur.held);
  }
  let how=null;
  if(cur.held){const v=await askHeld(a,btn,true);if(!v||!v.value)return;how=v.value;} /* Keep closed */
  const r=await bridge.setDoor(a.id,false).catch(()=>null);
  if(!r||!r.ok){toast('Could not open the door.',4200).classList.add('err');return;}
  DOORS[a.id]={closed:false,held:r.held||0};scheduleRender();
  const stays=doorRemoteOff.delete(a.id)?' Remote control stays off; turn it on again from the chat if you need it.':'';
  announce(a.name+': door open.'+stays);
  if(stays)toast(esc(a.name)+': door open.'+esc(stays),5200);
  if(how)await sendOrDiscard(a,how,cur.held);
}
function setRoomClosed(r,closed,quiet){
  if(!!r.closed===!!closed)return;
  r.closed=!!closed;
  const ag=agents.find(x=>!x.parent&&x.room===r.id);
  if(ag&&ag.live&&bridge&&bridge.setRoomClosed)bridge.setRoomClosed(ag.id,!!closed);
  if(!quiet){doorAnim=r.id;renderAll();}
}
let doorAnim=null;
function renderDoorBar(){
  const b=$('doorBar'); if(!b)return;
  const vis_=ROOMS.filter(r=>roomShown(r)&&(ui.ws==='all'||ui.ws===r.id)&&agents.some(a=>!a.parent&&a.room===r.id));
  const open=vis_.filter(r=>!r.closed).length, shut=vis_.length-open;
  b.hidden=vis_.length<2||ui.view!=='office';
  $('closeAll').disabled=!open; $('openAll').disabled=!shut;
}
/* The folder/workspace of a room: the key its MCP extras are stored under (same key as the saved folder list). */
function folderOfRoom(roomId){
  const r=ROOMS.find(x=>x.id===roomId),ag=agents.find(x=>!x.parent&&x.room===roomId&&x.info);
  return r&&ag?{key:ag.info.workspaceFile||ag.info.cwd,name:r.name}:null;
}
/* spec 044 FR-010: a room with active schedules shows a small clock with the count and the next run; it opens the folder's Schedules. Empty otherwise (the ⋯ menu still has Schedules). */
const CLOCK_SVG='<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><circle cx="8" cy="8" r="6.2"/><path d="M8 4.6V8l2.4 1.6"/></svg>';
function roomSchedChip(r){
  if(!bridge||!bridge.listSchedules||demoOn)return '';
  let ss;try{ss=schedulesOf(r).filter(s=>!s.done);}catch(e){return '';} /* SCHED is declared further down; before it exists there is nothing to show */
  if(!ss.length)return '';
  const next=nextRunOf(ss),off=SCHED.pausedAll||ss.every(s=>s.paused);
  /* the chip stays short: the time when the next run is within a day, else the weekday and time */
  const t=ss.filter(s=>!s.paused).map(s=>s.next||s.at).filter(Boolean).sort((x,y)=>x-y)[0];
  const short=t?(t-Date.now()<86400000?hm(t):new Date(t).toLocaleDateString([],{weekday:'short'})+' '+hm(t)):'';
  const tip=ss.length+' schedule'+(ss.length>1?'s':'')+' for '+r.name+(off?' (paused)':next?', next run '+next:'')+'. Click to see or change them.';
  return `<button class="room-sched${off?' off':''}" type="button" data-schedroom="${esc(r.id)}" title="${esc(tip)}" aria-label="${esc(tip)}">${CLOCK_SVG}<span>${ss.length}${off?'':short?' · '+esc(short):''}</span></button>`;
}
function roomHTML({r,mains,all,rolled},d,aw,cap){
  const al=roomAlert(r), alAttr=(al.tone==='calm'?'':` data-alert="${al.tone}"`)+(al.siren?' data-siren="1"':''), alLabel=al.siren?'. '+ALERT_WORDS:'';
  const dots=['waiting','error','working','done','idle'].map(k=>{const n=all.filter(a=>{const s=vis(a);return k==='working'?(s==='working'||s==='thinking'):s===k}).length;return n?`<span class="rd${k==='waiting'?' attn':(k==='done'||k==='idle')?' calm':''}" title="${n} ${LABELS[k]}"><span class="dot ${k}"></span>${n}<span class="rdw"> ${LABELS[k].toLowerCase()}</span></span>`:''}).join(''); /* spec 001 FR-037: "5 working" when the header has room */
  /* spec 052 FR-006: the counts in words too (screen readers, and a tooltip for colour-blind users) */
  const dotsLabel=['waiting','error','working','done','idle'].map(k=>{const n=all.filter(a=>{const s=vis(a);return k==='working'?(s==='working'||s==='thinking'):s===k}).length;return n?n+' '+LABELS[k].toLowerCase():'';}).filter(Boolean).join(', ');
  const head=`<div class="room-head"><button class="door" type="button" data-door="${esc(r.id)}" aria-expanded="true" aria-label="${esc(wordOf('door-close'))} ${esc(r.name)}" title="${esc(wordOf('door-title-prefix'))}: ${esc(r.name)} ${esc(wordOf('door-plate-suffix'))}">${doorSvg(true)}</button><span class="room-name" title="${esc(r.name)}${(()=>{const u=roomAiu(r);return u?' · '+esc(u.long):'';})()}">${esc(r.name)}</span>${al.siren&&!SIM_QUIET_HEADS.has('siren')?SIREN():''}${floorTag(r)}<span class="room-path" title="${esc(r.path)}">${esc(showPath(r.path))}</span>${(()=>{const u=SIM_QUIET_HEADS.has('aiu')?null:roomAiu(r);return u?`<button class="room-aiu" type="button" data-costview="${esc(r.id)}" title="${esc(u.tip+'\nClick for the cost by folder.')}">${esc(u.long)}</button>`:'';})()}${dotsLabel?`<span class="room-dots" role="img" aria-label="${esc(dotsLabel)}" title="${esc(dotsLabel)}">${dots}</span>`:`<span class="room-dots" aria-hidden="true">${dots}</span>`}${bridge&&bridge.newSession&&anyKindReady()&&!demoOn?`<button class="room-new" type="button" data-newsess="${esc(r.id)}" title="New session in ${esc(r.name)}" aria-label="New session in ${esc(r.name)}">+</button>`:''}${bridge&&bridge.removeFolder&&!demoOn?`<button class="room-new room-more" type="button" data-foldermenu="${esc(r.id)}" title="Folder actions: new session, schedules, rename, hide, remove" aria-label="Folder actions for ${esc(r.name)}" aria-haspopup="menu">⋯</button>`:''}${roomSchedChip(r)}${bridge&&bridge.mcpFolderState&&agents.some(x=>x.room===r.id&&!x.parent&&x.info&&feat(x,'mcp'))&&!demoOn?`<button class="room-mcp" type="button" data-mcproom="${esc(r.id)}" title="MCP extras for ${esc(r.name)}: optional servers for this folder only" aria-label="MCP extras for ${esc(r.name)}">MCP</button>`:''}${PLANT()}</div>`;
  if(d==='full'){
    const gap=6, pad=12;
    const sw=shutW(r,rolled), widths=mains.map(a=>unitWidth(a,d)).concat(sw?[sw]:[]); /* FR-053: the squeezed group sits in the desks' row */
    const basis=Math.min(aw,widths.reduce((x,y)=>x+y,0)+gap*(widths.length-1)+2*pad+30);
    const min=Math.max(DENS.full.cw,...widths)+2*pad+30;
    return `<section class="room" data-key="room:${esc(r.id)}" data-tint="${r.tint}"${alAttr} style="--w:${Math.round(basis)};--min:${Math.round(min)}px" aria-label="Folder ${esc(r.name)}${alLabel}">${head}
      <div class="units">${roomArt()}${mains.map(a=>unitHTML(a,d)).join('')}${shuttersHTML(r,rolled)}</div></section>`;
  }
  /* compact: the room is a floor-plan zone with `cols` desk columns */
  const D=DENS[d], sw=shutW(r,rolled), over=2*D.rp+4+(sw?sw+D.gap:0); /* FR-053: the room's width counts the squeezed group */
  const cols=Math.max(1,Math.min(mains.length||1,cap,sw?Math.floor((aw-over+D.gap)/(D.cw+D.gap)):Infinity)); /* and its columns still get a whole cell each */
  const basis=cols*D.cw+(cols-1)*D.gap+over, min=D.cw+over;
  return `<section class="room" data-key="room:${esc(r.id)}" data-tint="${r.tint}"${alAttr} style="--w:${Math.round(basis)};--min:${Math.round(min)}px" aria-label="Folder ${esc(r.name)}${alLabel}">${head}
    ${sw?`<div class="units has-shut">${roomArt()}<div class="units-in" style="--cols:${cols}">${mains.map(a=>unitHTML(a,d)).join('')}</div>${shuttersHTML(r,rolled)}</div>`:`<div class="units" style="--cols:${cols}">${roomArt()}${mains.map(a=>unitHTML(a,d)).join('')}</div>`}</section>`;
}
/* ---- keyed DOM updates: patch only what changed, so desk animations keep running ---- */
const keyOf=n=>n.nodeType===1?(n.getAttribute('data-key')||(n.dataset.id!=null?'id:'+n.dataset.id:null)||(n.dataset.more!=null?'more:'+n.dataset.more+(n.classList.contains('fewer')||n.getAttribute('aria-expanded')==='true'?':f':''):null)):null;
function syncAttrs(o,n){
  for(const at of [...o.attributes])if(!n.hasAttribute(at.name))o.removeAttribute(at.name);
  for(const at of n.attributes)if(o.getAttribute(at.name)!==at.value)o.setAttribute(at.name,at.value);
}
function morphNode(o,n){
  if(o.nodeType!==1){if(o.nodeValue!==n.nodeValue)o.nodeValue=n.nodeValue;return o;}
  /* scenes carry a signature of everything they draw: same signature = leave the SVG (and its animations) alone */
  if(n.dataset&&n.dataset.sig!==undefined){if(o.dataset.sig===n.dataset.sig)return o;sceneSwap(o,n);return n;}
  const toDone=o.classList.contains('pill')&&!o.classList.contains('st-done')&&n.classList.contains('st-done');
  syncAttrs(o,n); morphChildren(o,n); if(toDone)pulseDone(o); return o;
}
/* ---- spec 052 FR-067: state changes you can see. Transform and opacity only, never under reduced motion (the Web Animations
   below are not covered by the CSS rule, so each one checks reducedMotion() itself) ---- */
function motion(el,frames,opts){if(!el||!el.animate||reducedMotion())return null;try{return el.animate(frames,opts);}catch(e){return null;}}
/* the green pill gives one small pulse when an agent has just finished */
function pulseDone(el){motion(el,[{transform:'scale(1)'},{transform:'scale(1.06)'},{transform:'scale(1)'}],{duration:400,easing:'ease-in-out'});}
/* a desk scene that changes (new status, mood, look) cross-fades: the old drawing sits on top in an absolutely positioned layer
   of its own size and fades out in 180ms while the new one is already in place, so the desk never changes size. The layer is
   the parent's last child (morphChildren leaves it alone, so the other children are not moved), and the old scene loses its
   .scene class, so nothing else counts it. First renders (innerHTML) never come here. */
function sceneSwap(o,n){
  const was=(o.dataset.sig||'').replace(/^still\|/,''), now=(n.dataset.sig||'').replace(/^still\|/,'');
  const r=!reducedMotion()&&o.isConnected?o.getBoundingClientRect():null, p=o.parentNode;
  o.replaceWith(n);
  if(now.startsWith('done|')&&!was.startsWith('done|')){const t=n.querySelector('.done-tick');if(t&&!reducedMotion())t.classList.add('draw');}
  if(!r||!r.width||!r.height||!p||p.nodeType!==1)return;
  const w=document.createElement('div');w.className='scene-out';w.setAttribute('aria-hidden','true');
  o.removeAttribute('data-sig');o.setAttribute('class',String(o.getAttribute('class')||'').replace(/\bscene\b/,'scene-old'));
  w.appendChild(o);p.appendChild(w);
  const op=w.offsetParent||document.body, pr=op.getBoundingClientRect();
  w.style.left=(r.left-pr.left-op.clientLeft+op.scrollLeft)+'px';w.style.top=(r.top-pr.top-op.clientTop+op.scrollTop)+'px';
  w.style.width=r.width+'px';w.style.height=r.height+'px';
  const a=motion(w,[{opacity:1},{opacity:0}],{duration:180,easing:'ease-out',fill:'forwards'});
  if(a)a.onfinish=()=>w.remove();
  setTimeout(()=>{if(w.isConnected)w.remove();},a?400:0);
}
function morphChildren(op,np){
  const old=[...op.childNodes], byKey=new Map(), plain=[];
  old.forEach(k=>{if(k.nodeType===1&&k.classList.contains('scene-out'))return; /* a fading old scene (FR-067): left alone, it removes itself */
    const key=keyOf(k);if(key!=null)byKey.set(key,k);else plain.push(k);});
  let pi=0, ref=op.firstChild; const used=new Set();
  for(const nk of [...np.childNodes]){
    const key=keyOf(nk); let m=null;
    if(key!=null){m=byKey.get(key)||null;if(m&&(used.has(m)||m.nodeName!==nk.nodeName))m=null;}
    else if(pi<plain.length&&plain[pi].nodeName===nk.nodeName&&!used.has(plain[pi]))m=plain[pi++];
    if(m){const r=morphNode(m,nk);used.add(r);if(r===m){if(m===ref)ref=m.nextSibling;else op.insertBefore(m,ref);}else if(m===ref)ref=r.nextSibling;}
    else{op.insertBefore(nk,ref);used.add(nk);}
  }
  old.forEach(k=>{if(!used.has(k)&&k.parentNode===op&&!(k.nodeType===1&&k.classList.contains('scene-out')))op.removeChild(k);});
}
function morphHTML(el,html){const t=document.createElement('template');t.innerHTML=html;morphChildren(el,t.content);}

/* ---- layout: pick the richest density that fits the floor at scale 1 (text is never scaled down) ----
   The search renders trial layouts into the hidden #probe, never into the visible stage, and its result is cached
   until the *shape* of the office changes (agents, helper counts, filters, size). Status changes only patch the DOM. */
/* spec 001 FR-033 (2026-10-21, measured): the search is most of a floor switch, so each trial is made cheaper without changing a
   measured box: the drawings inside every <svg> are left out (DurbarProbe.svgHollow), and a trial that differs from the one before
   only in style attributes (the compact search changes only each room's --w, --min and --cols) sets those in place instead of
   parsing the stage again. --w, --min and --cols do not inherit (styles.css), so that restyles the rooms, not every desk. */
const {svgHollow,styleSplit}=window.DurbarProbe;
let probePrev=null; /* the last trial's HTML without its style attributes, while the probe holds it */
function probeSet(probe,html){
  html=svgHollow(html);
  const {bare,vals}=styleSplit(html);
  if(probePrev!==null&&bare===probePrev){
    const els=probe.querySelectorAll('[style]');
    if(els.length===vals.length&&!vals.some(v=>v.includes('&'))){ /* a value with an entity is left to the parser */
      els.forEach((e,i)=>{if(e.getAttribute('style')!==vals[i])e.setAttribute('style',vals[i]);});
      return;
    }
  }
  probe.innerHTML=html; probePrev=bare;
}
function chooseLayout(sizing,aw,ah){
  const probe=$('probe'); probe.style.width=aw+'px';
  GROW=0; setGrow(probe,0); /* a grown render leaves GROW on: the plain candidates are probed with plain text */
  const openOnly=sizing.filter(m=>!m.r.closed);
  if(!openOnly.length){probe.innerHTML=svgHollow(stageHTML(sizing,'card',aw,1));probe.dataset.d='card';const ok=probe.scrollHeight<=ah+1;probe.innerHTML='';probePrev=null;return {d:'card',hcap:1,cap:1,fit:ok,boost:[],heads:false};}
  /* spec 001 FR-023 (change 2026-10-23): a layout fits when the office fits the floor AND every room header holds its parts. A layout that
     fits only by size is kept as the fallback (soft), so a header that cannot fit anywhere never sends the office into scroll mode. */
  const sizeFits=()=>probe.scrollHeight<=ah+1&&probe.scrollWidth<=aw+1;
  const fits=()=>sizeFits()&&headsFit(probe);
  let soft=null;
  const cands=FORCE_DENSITY?CANDIDATES.filter(c=>c[0]===FORCE_DENSITY):CANDIDATES;
  let res=null, lastAny=null;
  for(const [d,hcap,side] of cands){
    if(side&&!liveOn())continue;
    HCAP=hcap; HBOOST=new Map(); LIVE_SIDE=!!side; probe.dataset.d=d; probe.style.height='auto';
    if(d==='full'){
      probeSet(probe,stageHTML(sizing,d,aw));
      if(fits()){res={d,hcap,cap:0,fit:true,boost:[],side:!!side,heads:true};break;}
      if(!soft&&sizeFits())soft={d,hcap,cap:0,fit:true,boost:[],side:!!side};
      lastAny={d,hcap,cap:0,fit:false,boost:[],side:!!side};continue;
    }
    const D=DENS[d], over=2*D.rp+4;
    const maxCap=Math.max(1,Math.min(Math.max(...openOnly.map(m=>m.mains.length)),Math.floor((aw-over+D.gap)/(D.cw+D.gap))));
    let best=null, bySize=null, any=null;
    for(let c=maxCap;c>=1;c--){
      probeSet(probe,stageHTML(sizing,d,aw,c));
      const h=probe.scrollHeight;
      if(!any||h<any.h-8)any={c,h};
      if(sizeFits()){
        /* among layouts that fit, prefer desks close to a comfortable width (not stretched, not squeezed) */
        let tw=0; const ds=probe.querySelectorAll('.desk.card'); ds.forEach(e=>{tw+=e.getBoundingClientRect().width;});
        const miss=Math.abs(tw/Math.max(1,ds.length)-D.cw*1.3);
        if(!bySize||miss<bySize.miss-6)bySize={c,h,miss};
        if(headsFit(probe)&&(!best||miss<best.miss-6))best={c,h,miss};
      }
    }
    if(best){res={d,hcap,cap:best.c,fit:true,boost:[],heads:true};break;}
    if(bySize&&!soft)soft={d,hcap,cap:bySize.c,fit:true,boost:[]};
    lastAny={d,hcap,cap:any.c,fit:false,boost:[]};
  }
  if(!res&&soft)res=soft;
  /* spec 001 FR-042: when the search picked `full` or `roomy` (few agents), grown `roomy` desks win if they fit at least one step larger
     than `roomy`. Never after card/mini/micro (15 agents lay out as before) or with a forced density. */
  if(res&&res.fit&&!FORCE_DENSITY&&(res.d==='full'||res.d==='roomy')){
    const g=growSearch(sizing,aw,ah,openOnly,GR.MIN+GR.STEP);
    if(g)res={d:'roomy',hcap:3,cap:g.c,fit:true,boost:[],grow:g.f,heads:res.heads};
  }
  /* Leftover floor space (also what closed rooms free up): give the agents with the most helpers more of them, one step up
     (1 -> 3, 2 -> 3, 3 -> 6 shown before "+N more"), attention first, while the layout still fits. */
  if(res&&res.fit){
    const up={1:3,2:3,3:6}[res.hcap]||res.hcap;
    const many=openOnly.flatMap(m=>m.mains).filter(a=>helpersOf(a).length>res.hcap+1).sort((x,y)=>Math.min(prio(x),...helpersOf(x).map(prio))-Math.min(prio(y),...helpersOf(y).map(prio))||helpersOf(y).length-helpersOf(x).length);
    HCAP=res.hcap; LIVE_SIDE=!!res.side; probe.dataset.d=res.d; GROW=res.grow?1:0; setGrow(probe,res.grow||0);
    for(const a of many){
      HBOOST.set(a.id,up); probe.style.height='auto';
      probeSet(probe,stageHTML(sizing,res.d,aw,res.cap));
      if(fits())res.boost.push([a.id,up]); else HBOOST.delete(a.id);
    }
  }
  probe.innerHTML=''; probePrev=null; LIVE_SIDE=false; GROW=0; setGrow(probe,0);
  return res||lastAny;
}
/* FR-042: for each column count (most first), the largest f at which the office fits; the stage HTML goes into the probe once per column
   count (probeSet sets the column change in place) and each f only changes --gf on the probe. Returns {c, f, h} or null. */
function growSearch(sizing,aw,ah,openOnly,lo){
  const probe=$('probe'), D=DENS.roomy, over=2*D.rp+4;
  const maxCap=Math.max(1,Math.min(Math.max(...openOnly.map(m=>m.mains.length)),Math.floor((aw-over+D.gap)/(D.cw+D.gap))));
  HCAP=3; HBOOST=new Map(); LIVE_SIDE=false; GROW=1; probe.dataset.d='roomy'; probe.style.height='auto';
  const cols=[]; for(let c=maxCap;c>=1;c--)cols.push(c);
  let cur=0;
  const best=window.DurbarProbe.pick(cols,lo,(c,f)=>{
    if(cur!==c){probeSet(probe,stageHTML(sizing,'roomy',aw,c));cur=c;}
    setGrow(probe,f);
    return {fits:probe.scrollHeight<=ah+1&&probe.scrollWidth<=aw+1,h:probe.scrollHeight};
  });
  GROW=0; setGrow(probe,0);
  return best;
}
let layoutKey='', layout=null;
let SIM_QUIET_HEADS=new Set(); /* spec 001 FR-023 (2026-10-23): simulator only (__durbarSimUi.quietHeads(['siren','aiu'])): room headers drawn without those parts, so a driver can lay the office out first and add them after, as a late siren or cost does */
let HEAD_RETRY=''; /* the layout key and header contents of the last relayout made because a header no longer held its parts */
/* spec 001 FR-026: what a new user needs before the first folder: sign in once (spec 052 FR-056: named by the AI account, not the app), add a folder (Read-only), or look around in the demo */
const WELCOME_HTML=`<section class="welcome" aria-labelledby="wlT"><h2 id="wlT">Welcome to Agent Durbar</h2>
  <p class="wl-sub">Your AI agents in one office: see what each one is doing, chat with it, and decide what it may do. For code, documents, research or notes, with GitHub Copilot, Claude Code or OpenAI Codex side by side.</p>
  <ol class="wl-steps">
    <li><b>Connect your AI account once</b>: ChatGPT (through Codex), Claude (through Claude Code) or GitHub Copilot (a free plan works). <b>Connect an AI account…</b> installs the agent app and signs in for you, showing every step; nothing is typed in a terminal.<br><span class="wl-which">Which one? Have ChatGPT: Codex. Have Claude: Claude Code. Neither: GitHub Copilot (free).</span></li>
    <li><b>Add a folder</b> with <b>+ Folder</b> (top left): a project, a set of documents, any folder your agent should work in. Each folder becomes a room with its own agent. Agents start in <b>Read-only</b>: they can read the folder, nothing else.</li>
    <li><b>Send a message</b> to start. Switch to <b>Ask first</b> or <b>Allow all</b> only for folders you trust.</li>
  </ol>
  <div class="wl-actions"><button class="btn" type="button" data-wl="setup">Connect an AI account…</button><button class="btn primary" type="button" data-wl="add">+ Add a folder</button><button class="btn" type="button" data-wl="demo">Look around in the demo</button></div>
  <div class="wl-level" role="group" aria-labelledby="wlLv"><p id="wlLv"><b>Do you write code?</b> <span>You can change this any time in Settings (Detail level).</span></p>
    <span class="wl-lv-btns"><button class="btn" type="button" data-wl-level="expert" aria-pressed="false">Yes, show me the details</button><button class="btn" type="button" data-wl-level="simple" aria-pressed="false">No, keep it simple</button></span></div>
  <p class="wl-note">Agents run on your computer, as you, and use your own plan (Copilot AI credits, your Claude or ChatGPT plan).</p></section>`;
/* spec 052 FR-031, FR-082: the welcome card asks "Do you write code?"; the answer sets the detail level (remembered like the Settings choice).
   Nothing chosen: Expert, and neither button is pressed. */
const detailChosen=()=>{try{return localStorage.getItem('durbar.detail');}catch(e){return null;}};
const welcomeHTML=()=>{const c=detailChosen();return WELCOME_HTML.replace(/data-wl-level="(expert|simple)" aria-pressed="false"/g,(m,l)=>c===l?'data-wl-level="'+l+'" aria-pressed="true"':m);};
document.addEventListener('click',e=>{const b=e.target.closest&&e.target.closest('[data-wl-level]');if(!b)return;const l=b.dataset.wlLevel;setDetail(l);
  const again=document.querySelector('[data-wl-level="'+l+'"]');if(again)again.focus();announce(l==='simple'?'Simple: plain words, without developer details.':'Expert: every detail is shown.');});
document.addEventListener('click',e=>{const b=e.target.closest('[data-wl]');if(!b)return;
  if(b.dataset.wl==='add')$('addFolder').click();
  else if(b.dataset.wl==='setup')window.DurbarScreens.openSettings('harnesses'); /* spec 051 FR-008 */
  else{const t=$('demoToggle');t.checked=true;t.dispatchEvent(new Event('change'));}});
/* spec 052 FR-070: an empty office shows an empty desk (theme colours through currentColor) above its sentence */
const EMPTY_DESK='<svg class="empty-desk" viewBox="0 0 120 72" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
  +'<rect x="24" y="22" width="30" height="30" rx="9" fill="currentColor" stroke="none" opacity=".14"/>'
  +'<rect x="70" y="14" width="38" height="27" rx="3.5"/><rect x="74" y="18" width="30" height="19" rx="2" fill="currentColor" stroke="none" opacity=".1"/>'
  +'<path d="M89 41v7M81 49h16"/><path d="M8 52h104" stroke-width="3.5"/><rect x="13" y="54" width="94" height="14" rx="3" fill="currentColor" stroke="none" opacity=".1"/></svg>';
/* spec 052 FR-070: when the first-run card shows, "+ Folder" (FR-164) in the top bar rings once (CSS pseudo-element, opacity and scale).
   It waits 600ms and checks the card is still there, so a start that loads agents a moment later does not ring. */
function ringFolder(){if(reducedMotion())return;setTimeout(()=>{const b=$('addFolder'),st=$('stage');if(!b||!st||!st.querySelector('.welcome')||!b.getClientRects().length)return;
  b.classList.remove('ring-once');void b.offsetWidth;b.classList.add('ring-once');setTimeout(()=>b.classList.remove('ring-once'),1600);},600);}
function renderOffice(){
  if(ui.view!=='office')return;
  const floor=$('floor'), stage=$('stage'), cs=getComputedStyle(floor);
  const aw=floor.clientWidth-parseFloat(cs.paddingLeft)-parseFloat(cs.paddingRight);
  const ah=floor.clientHeight-parseFloat(cs.paddingTop)-parseFloat(cs.paddingBottom);
  if(aw<=0||ah<=0)return;
  const model=officeModel();
  if(!model.length){
    stage.dataset.d='card'; stage.style.width=aw+'px'; stage.style.height='auto'; layoutKey=''; GROW=0; setGrow(stage,0); spreadOffice(stage,false);
    stagePrev=null;
    if(!agents.length&&!demoOn){if(!stage.querySelector('.welcome'))ringFolder();stage.innerHTML=welcomeHTML();floor.classList.remove('scrolls');return;} /* spec 001 FR-026: first run */
    stage.innerHTML='<div class="empty">'+EMPTY_DESK+(!agents.length&&!demoOn?'No agents yet. Use "+ Folder" at the top left to add a folder'+(SIMPLE?'.':' (or "+ Workspace" for a VS Code .code-workspace file).'):(agents.length&&ROOMS.every(r=>r.hidden)?'All folders are hidden. Open Manage folders (next to the folder filter) to show them again.':agents.length&&floorsLive()&&!floorsOnList().length?(FLOORS.floors.length>1?'All floors are off. Open "Floors" above or Settings > Floors to switch one on.':'Your only floor is off. Switch it on in Settings > Floors.'):agents.length&&ROOMS.every(r=>!roomShown(r))?('Nothing to show: every folder is hidden or on a floor that is off. Open '+(floorsLive()&&FLOORS.floors.length>1?(SIMPLE?'"Floors" above, or ':'"Floors" or "Folders" above, or '):(SIMPLE?'':'"Folders" above, or '))+'Settings > Floors.'):'No agents match these filters.'))+'</div>';
    floor.classList.remove('scrolls'); return;
  }
  /* Density is chosen from the unfiltered set so cards do not change shape when a status pill filters. */
  const sizing=ui.status?officeModel(true):model;
  const key=JSON.stringify([aw,ah,FORCE_DENSITY,liveOn(),lobbyOn(),floorTagsOn()&&floorsOnList().map(f=>f.id+':'+f.name),sizing.map(m=>m.r.closed?[m.r.id,'closed']:[m.r.id,m.mains.map(a=>[a.id,helpersOf(a).length,!!ui.expanded[a.id]]),(m.rolled||[]).map(x=>[x.a.id,x.k]),!!ui.expanded['shut:'+m.r.id]])]);
  if(key!==layoutKey||!layout){layout=chooseLayout(sizing,aw,ah);layoutKey=key;}
  HCAP=layout.hcap; HBOOST=new Map(layout.boost); LIVE_SIDE=!!layout.side; GROW=layout.grow?1:0;
  const parts=stageParts(model,layout.d,aw,layout.cap);
  const fresh=stage.dataset.d!==layout.d||!!stage.querySelector('.empty');
  stage.style.width=aw+'px'; stage.style.height='auto'; stage.dataset.d=layout.d; setGrow(stage,layout.grow||0);
  if(fresh)stage.innerHTML=parts.join(''); else if(!morphParts(stage,parts))morphHTML(stage,parts.join(''));
  stagePrev=parts; SHUT_PREV=new Set(model.flatMap(m=>(m.rolled||[]).map(x=>x.a.id)));
  stage.dataset.fit=layout.fit?'ok':'scroll'; stage.dataset.h=String(layout.hcap); stage.dataset.side=layout.side?'1':'0';
  fitUsage(stage);
  /* spec 001 FR-023 (change 2026-10-23): the layout is cached by the office's shape, but a header can gain a part without the shape changing
     (the siren, the cost chip, the MCP chip arrive after the first layout). A layout picked because its headers held their parts is
     searched again when a header on screen no longer does; once per layout key and header contents, so it cannot loop. */
  const heads=stage.querySelectorAll('.room-head');
  if(layout.heads&&[...heads].some(h=>!headHolds(h))){
    const sig=key+'\n'+[...heads].map(h=>[...h.children].map(e=>e.getAttribute('class')).join(' ')+'='+h.textContent).join('\n');
    if(sig!==HEAD_RETRY){HEAD_RETRY=sig;layoutKey='';renderOffice();return;}
  }
  if(layout.side)stage.querySelectorAll('.liveside .ls-t').forEach(fitSide);
  if(layout.grow){stage.querySelectorAll('.desk.card').forEach(setGrownCols);stage.querySelectorAll('.desk.card .intent').forEach(fitLines);stage.querySelectorAll('.desk.card[data-gc] .gx-t').forEach(fitClamp);} /* FR-043, FR-047: columns, then whole lines, the newest in view */
  floor.classList.toggle('scrolls',!layout.fit);
  spreadOffice(stage,!!layout.fit); /* FR-086, FR-087: the spare height, after everything else is drawn */
  if(doorAnim){const el=stage.querySelector(`[data-door="${CSS.escape(doorAnim)}"]`),box=el&&(el.closest('.room')||el);if(box&&!REDUCED){box.classList.add('enter');setTimeout(()=>box.classList.remove('enter'),420);}doorAnim=null;}
}

/* spec 001 FR-086, FR-087 (owner report, issue 619): a drawn office that fits and is shorter than the floor used to leave all the spare
   height below its last row. The rows of rooms grow first (every room row by the same whole px, at most SPREAD_CAP of the shortest; the
   CSS puts half of it under the header and half under the desks), then the rest becomes even gaps above, between and below the rows
   (DurbarProbe.spreadRows, pure). Measured from the layout (offsetTop and the computed border-box height), not the screen box, so a room's
   door animation (a transform) does not change it. The layout search never sees it: #probe has no data-spread. */
const SPREAD_CAP=0.2;
function spreadOffice(stage,on){
  stage.style.removeProperty('--rx'); stage.style.removeProperty('padding-top'); stage.style.removeProperty('row-gap'); delete stage.dataset.spread;
  if(!on)return;
  const floor=$('floor'), fcs=getComputedStyle(floor);
  const avail=floor.clientHeight-parseFloat(fcs.paddingTop)-parseFloat(fcs.paddingBottom), gap=parseFloat(getComputedStyle(stage).rowGap)||0;
  const rows=[];
  for(const k of stage.children){
    if(!k.getClientRects().length)continue;
    const t=k.offsetTop, h=parseFloat(getComputedStyle(k).height)||k.offsetHeight;
    let row=rows.find(x=>Math.abs(x.t-t)<2); if(!row){row={t,b:t+h,room:false};rows.push(row);}
    row.b=Math.max(row.b,t+h); if(k.classList.contains('room'))row.room=true;
  }
  rows.sort((x,y)=>x.t-y.t);
  const sp=window.DurbarProbe.spreadRows(rows.map(r=>({h:r.b-r.t,room:r.room})),avail,gap,SPREAD_CAP);
  if(!sp.rx&&!sp.top&&sp.rowGap===gap)return;
  stage.dataset.spread='1'; stage.style.setProperty('--rx',sp.rx+'px'); stage.style.paddingTop=sp.top+'px'; stage.style.rowGap=sp.rowGap+'px';
}
/* spec 052 (2026-10-21; real 15-session office, and CI's fonts): a card's usage line is fitted by measuring, not by a width
   threshold, so it holds with any font. Step by step until the cost fits: drop the token count, then " est." / " AIU", then the
   short form of a capped figure ("33/30"), then the cost itself (its tooltip and the status pill still say it). */
const USE_STEPS=['no-tok','no-unit','short','no-cost'];
function fitUsage(root){
  for(const u of root.querySelectorAll('.desk .use')){
    u.classList.remove(...USE_STEPS);
    const cost=u.querySelector('.aiu'), tok=u.querySelector('.tok');
    /* spec 017 FR-007 (2026-10-23): a token count cut inside itself ("1" of "14k tok") reads as a wrong number, so it does not fit either */
    const fits=()=>{if(tok&&tok.getClientRects().length&&tok.scrollWidth>tok.clientWidth+0.5)return false;if(!cost||!cost.getClientRects().length)return u.scrollWidth<=u.clientWidth+0.5;const c=cost.getBoundingClientRect(),b=u.getBoundingClientRect();return u.scrollWidth<=u.clientWidth+0.5&&c.right<=b.right+0.5&&c.left>=b.left-0.5;};
    for(const st of USE_STEPS){if(fits())break;u.classList.add(st);}
  }
  /* the same for room headers: a name cut (even by a pixel, which shows an ellipsis) while its path still shows hides the path (also in the tooltip) */
  root.querySelectorAll('.room-head').forEach(fitHead);
}
function fitHead(hd){
  hd.classList.remove('no-path','no-words');
  const n=hd.querySelector('.room-name'),p=hd.querySelector('.room-path');
  /* spec 001 FR-037: the count words go first (the counts stay, the words are in the tooltip and label), then the path */
  const tight=()=>(n&&n.scrollWidth>n.clientWidth+0.5)||hd.scrollWidth>hd.clientWidth+0.5;
  if(hd.querySelector('.rdw')&&tight())hd.classList.add('no-words');
  if(n&&p&&p.getClientRects().length&&n.scrollWidth>n.clientWidth+0.5)hd.classList.add('no-path');
}
/* spec 001 FR-023 (change 2026-10-23): after those steps, every part of every room header is inside its header (what check:office asserts) */
function headsFit(root){
  for(const hd of root.querySelectorAll('.room-head')){fitHead(hd);if(!headHolds(hd))return false;}
  return true;
}
function headHolds(hd){
  const H=hd.getBoundingClientRect();
  for(const e of hd.children){if(!e.getClientRects().length)continue;const r=e.getBoundingClientRect();if(r.width>0&&r.right>H.right+1)return false;}
  return true;
}
if(document.fonts&&document.fonts.ready)document.fonts.ready.then(()=>{const s=document.getElementById('stage');if(s)fitUsage(s);}).catch(()=>{});
/* spec 052 FR-164: the top bar is one row. When its parts do not fit (a narrow window, a wide theme or system font, the Mac traffic
   lights), the brand name moves to screen readers only (the mark and the Live/Demo pill stay; the name is also the window's and the Mac
   menu bar's). Measured, not guessed by width: the class is removed, the row measured, and set again only if the parts still wrap. */
function fitTopbar(){
  const bar=document.querySelector('.topbar');if(!bar||!bar.getClientRects().length)return;
  bar.classList.remove('tb-tight');
  const kids=[...bar.children].filter(k=>k.getClientRects().length);if(kids.length<2)return;
  const mid=k=>{const r=k.getBoundingClientRect();return (r.top+r.bottom)/2;};
  const m0=mid(kids[0]);
  if(kids.some(k=>Math.abs(mid(k)-m0)>8))bar.classList.add('tb-tight');
}
{const bar=document.querySelector('.topbar');
  if(bar&&window.ResizeObserver){const ro=new ResizeObserver(()=>fitTopbar());ro.observe(bar);bar.querySelectorAll(':scope > .controls, :scope > .stats').forEach(e=>ro.observe(e));}
  window.addEventListener('resize',fitTopbar);
  if(document.fonts&&document.fonts.ready)document.fonts.ready.then(fitTopbar).catch(()=>{});}
window.DurbarFit=()=>{const s=document.getElementById('stage');if(s)fitUsage(s);fitTopbar();}; /* the layout checks refit after forcing a font */
/* ---------------- list view ---------------- */
/* spec 052 FR-064: sortable columns (click a header: ascending, then descending; in memory only), 34px rows. Unsorted it keeps the
   office order with waiting and errors first. A helper stays under its main agent; main agents sort by the column. */
const LCOLS=[['name','Agent'],['app','Agent app'],['role','Role'],['folder','Folder'],['task','Current task'],['ago','Active'],['cost','Usage'],['status','Status']];
const ST_ORDER={waiting:0,error:1,failing:2,working:3,thinking:4,idle:5,done:6};
let LSORT=null;
const appOf=a=>{const r=a&&a.parent?byId(a.parent):a;return r&&r.live&&r.info?kindWord(r.info.adapterId):'';};
/* the card's money words without the tokens: AIU as ≈ $, Claude's $ estimate; a kind with no price shows its tokens */
const costVal=a=>{const u=a.usage;if(!u||!u.calls)return null;const k=usageCaps(a);return k.nanoAiu?u.nano/1e9*AIU_USD:k.costUsd?(u.usd||0):null;};
const costText=a=>{const u=a.usage;if(!u||!u.calls)return '';const k=usageCaps(a);return k.nanoAiu?approx(u.nano/1e9*AIU_USD):k.costUsd?fmtUsd(u.usd||0):SIMPLE?'':fmtTok(u.inT+u.outT)+' tok';}; /* spec 052 FR-081: no token counts in Simple */
const LVAL={name:a=>a.name,app:appOf,role:a=>a.role,folder:a=>roomOf(a).name,task:a=>taskText(a),ago:sinceLast,cost:costVal,status:a=>ST_ORDER[pillSt(a)]};
function renderList(){
  const groups=[];
  roomsInOrder().forEach(r=>{ if(!roomShown(r)||(ui.ws!=='all'&&ui.ws!==r.id))return;
    agents.filter(a=>!a.parent&&a.room===r.id).slice().sort((x,y)=>Math.min(prio(x),...helpersOf(x).map(prio))-Math.min(prio(y),...helpersOf(y).map(prio))).forEach(a=>{
      if(matchStatus(a))groups.push(a);
    });});
  const sorted=LSORT?ACT.sortBy(groups,LVAL[LSORT.key],LSORT.dir):groups;
  const rows=[];sorted.forEach(a=>{rows.push([a,false]);(LSORT?ACT.sortBy(helpersOf(a),LVAL[LSORT.key],LSORT.dir):helpersOf(a)).forEach(h=>rows.push([h,true]));});
  /* spec 034 FR-014: no figures here, so the mood words (cards: drawing + label) are written at the start of the task cell */
  const row=([a,sub])=>{const st=pillSt(a),mw=moodFor(a).words,ago=ACT.agoShort(sinceLast(a)),agoL=ACT.agoLong(sinceLast(a)),cost=costText(a),app=appOf(a);return `<button class="lrow" data-id="${esc(a.id)}" aria-pressed="${ui.selected===a.id}" aria-label="${esc(a.name)}${chatNoWords(a)}${draftWords(a)}, ${esc(a.role)}${app?', '+esc(app):''}, ${esc(roomOf(a).name)}, ${esc(stWord(a))}: ${esc(taskText(a))}${moodWords(a)}${agoL?'. Last activity '+agoL:''}${cost?'. Cost '+esc(cost):''}">
    <span class="lname"><span class="dot ${st}"></span>${sub?'':chatNoHTML(a)+draftHTML(a)}<span class="${sub?'sub':''}" title="${esc(a.name)}">${esc(a.name)}</span>${modeIcon(a,true)}</span><span class="lcell" title="${esc(app)}">${esc(app)}</span><span class="lcell" title="${esc(a.role)}">${esc(a.role)}</span><span class="lcell mono lfold" title="${esc(roomOf(a).name)}">${esc(roomOf(a).name)}</span><span class="lcell" title="${esc(DurbarCutText.cutText((mw?mw+'. ':'')+taskText(a),300))}">${mw?`<span class="lmood">${esc(mw)}</span> · `:''}${esc(taskText(a))}</span><span class="lcell num"${agoL?` title="Last activity ${esc(agoL)}"`:''}>${esc(ago)}</span><span class="lcell num"${cost&&cost.endsWith(' est.')?` title="${esc(USD_TIP)}"`:''}>${esc(cost)}</span><span><span class="pill st-${pillSt(a)}"${pillTip(a)}><i></i>${esc(stWord(a))}</span></span></button>`};
  const head=LCOLS.map(([k,t])=>{const on=LSORT&&LSORT.key===k,dir=on?(LSORT.dir==='asc'?'ascending':'descending'):'none';
    return `<span role="columnheader" aria-sort="${dir}"${k==='folder'?' class="lfold"':k==='ago'||k==='cost'?' class="num"':''}><button type="button" class="lsort" data-lsort="${k}" title="Sort by ${esc(t.toLowerCase())}">${esc(t)}<span class="sarr" aria-hidden="true">${on?(LSORT.dir==='asc'?'▲':'▼'):'↕'}</span></button></span>`;}).join('');
  $('list').innerHTML=`<div class="list-wrap" role="group" aria-label="Agents"><div class="lrow lhead" role="row">${head}</div>${rows.map(row).join('')||'<div class="empty">No agents match these filters.</div>'}</div>`;
}
document.addEventListener('click',e=>{const b=e.target.closest('#list [data-lsort]');if(!b)return;
  LSORT=ACT.nextSort(LSORT,b.dataset.lsort);renderList();const n=document.querySelector(`#list [data-lsort="${CSS.escape(b.dataset.lsort)}"]`);if(n)n.focus();});

function renderAll(){
  syncChatNos(); /* spec 074 FR-011 */
  AMB_ID=pickAmbulanceId();
  syncDesks(); /* spec 001 FR-034: who walks to the Boss and who comes back */
  prepareWalkers();
  const ae=document.activeElement, id=ae&&ae.dataset&&(ae.dataset.id||ae.dataset.more||ae.dataset.door||ae.dataset.lsort), inPanel=ae&&ae.closest&&ae.closest('#panel'), scope=ae&&ae.closest?(ae.closest('#list')?'#list ':ae.closest('#stage')?'#stage ':''):''; /* FR-173: read before the render detaches it */
  const key=ae&&ae.dataset&&(ae.dataset.id?'data-id':ae.dataset.more?'data-more':ae.dataset.door?'data-door':ae.dataset.lsort?'data-lsort':''); /* spec 052 FR-064: a sort header keeps focus too */
  renderStats();
  updateFloorAttention();
  if(ui.view==='office')renderOffice(); else renderList();
  renderDoorBar();
  syncWalkers();
  /* spec 052 FR-173: look in the view the focus was in. The office desks stay in the page (hidden) while the list shows, with the same data-id, so a document-wide lookup found the hidden desk and the focus fell to the page. */
  if(id&&!inPanel){const n=document.querySelector(`${scope}[${key}="${CSS.escape(id)}"]`); if(n&&ae!==n)n.focus({preventScroll:true});}
  if(ui.selected){updatePanelHeader();renderStrip();}
  rememberUi();
  if(floorSwitchTimed)endFloorSwitchTiming();
}


/* ---------------- icons ---------------- */
function ICON_(){return { /* token colours (spec 036): built on every call, not once */
 read:'<svg viewBox="0 0 16 16" fill="none" stroke="'+T_('--ic-read')+'" stroke-width="1.5" stroke-linejoin="round"><path d="M4 1.8h5.2L12.5 5v9.2H4z"/><path d="M9 1.8V5.2h3.5"/></svg>',
 edit:'<svg viewBox="0 0 16 16" fill="none" stroke="'+T_('--ic-edit')+'" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"><path d="M2.5 13.5l.7-3L11 2.7a1.4 1.4 0 0 1 2 2L5.5 12.8z"/></svg>',
 run:'<svg viewBox="0 0 16 16" fill="none" stroke="'+T_('--ic-run')+'" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"><rect x="1.8" y="2.8" width="12.4" height="10.4" rx="2"/><path d="M4.8 6.2l2 1.8-2 1.8M8.6 10h2.6"/></svg>',
 search:'<svg viewBox="0 0 16 16" fill="none" stroke="'+T_('--ic-search')+'" stroke-width="1.5" stroke-linecap="round"><circle cx="7" cy="7" r="4.2"/><path d="M10.2 10.2l3.3 3.3"/></svg>',
 tool:'<svg viewBox="0 0 16 16" fill="none" stroke="'+T_('--ic-tool')+'" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="2.2"/><path d="M8 1.8v1.8M8 12.4v1.8M1.8 8h1.8M12.4 8h1.8M3.6 3.6l1.3 1.3M11.1 11.1l1.3 1.3M12.4 3.6l-1.3 1.3M4.9 11.1l-1.3 1.3"/></svg>',
 back:'<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 3L4.5 8l5 5"/><path d="M5 8h8"/></svg>',
 chev:'<svg class="chev" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 2l4 4-4 4"/></svg>',
 file:'<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><path d="M4 1.8h5.2L12.5 5v9.2H4z"/><path d="M9 1.8V5.2h3.5"/></svg>',
 img:'<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"><rect x="1.8" y="2.8" width="12.4" height="10.4" rx="2"/><circle cx="5.6" cy="6.4" r="1.3"/><path d="M2.5 12l3.8-3.4 2.6 2.2 2-1.6 3 2.8"/></svg>',
 x:'<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M3 3l6 6M9 3l-6 6"/></svg>'
};}
function ICON(k){return ICON_()[k];}
const TOOLNAME={read:'Read file',edit:'Edit file',run:'Run',search:'Search'};
const toolKind=n=>{n=String(n||'').toLowerCase();
  if(/read|view|cat|open|fetch/.test(n))return 'read'; if(/edit|write|create|patch|replace/.test(n))return 'edit';
  if(/bash|shell|run|exec|cmd|terminal/.test(n))return 'run'; if(/grep|search|glob|find|list/.test(n))return 'search'; return 'tool';};

/* ---------------- panel + chat ---------------- */
const chats={};
const sleep=ms=>new Promise(r=>setTimeout(r,REDUCED?0:ms));

async function typeInto(el,text,speed,chat,tok){
  if(REDUCED){el.textContent=text;return;}
  const off=()=>tok!==undefined&&chat&&chat.turn!==tok; /* spec 005 FR-038 (2026-10-22): Stop cancels a demo turn mid-word */
  for(let i=0;i<text.length;){if(off())return;i+=2+Math.floor(Math.random()*3);el.textContent=text.slice(0,i);stickyScroll(chat);await sleep(speed);}
  if(!off())el.textContent=text;
}
/* Tool chip: one compact line that truncates; click expands it to show the full command and output. */
const CHIPS_SHOWN=6;
/* spec 052 FR-063: open, it shows the whole command or argument (`full`, monospace, wrapped) with Copy, how long the call took (`ms`, from the
   events' times) and up to OUT_SHOWN characters of output in a scrollable block, with "Show all" for the rest. The closed line stays one line. */
const OUT_SHOWN=20000, OUT_KEEP=1000000;
const fmtDur=ms=>ms<1000?Math.round(ms)+' ms':ms<60000?(ms/1000).toFixed(1)+' s':Math.floor(ms/60000)+' min '+Math.round(ms%60000/1000)+' s';
function makeChip({tool,kind,label,res,state,output,full,ms}){
  const k=kind||toolKind(tool), name=TOOLNAME[tool]||tool||'tool';
  const el=document.createElement('div');
  el.className='chip'+(state==='failed'||state==='fail'?' fail':state==='run'?' run':'');
  el.setAttribute('role','button');el.tabIndex=0;el.setAttribute('aria-expanded','false');
  el.title=name+': '+label+(res?' ('+res+')':'');
  const out=output==null?'':String(output).slice(0,OUT_KEEP), detail=out&&out!==res?out:'', cmd=full&&String(full).trim()?String(full):'';
  const dur=typeof ms==='number'&&Number.isFinite(ms)&&ms>0?fmtDur(ms):'';
  if(detail)el.classList.add('has-detail');
  if(cmd)el.classList.add('has-cmd');
  const more=detail.length>OUT_SHOWN;
  el.innerHTML=`${ICON(k)||ICON('tool')}<span class="plain">${esc(plainChip(k,tool,label,state==='run'))}</span><b>${esc(name)}</b><code>${esc(label)}</code>${res?`<span class="res">${el.className.includes('fail')?'Failed: ':''}${esc(res)}</span>`:''}${cmd||dur||detail?`<span class="xbody">${cmd?`<span class="cmdbox"><pre class="cmd">${esc(cmd)}</pre><button type="button" class="cp-btn cp-cmd" aria-label="Copy the command" title="Copy the command">Copy</button></span>`:''}${dur||(state==='failed'&&res)?`<span class="xmeta">${state==='failed'?'Failed':'Done'}${dur?' · took '+esc(dur):''}</span>`:''}${detail?`<pre class="detail">${esc(more?detail.slice(0,OUT_SHOWN):detail)}</pre>${more?`<button type="button" class="xall">Show all (${detail.length.toLocaleString('en-US')} characters)</button>`:''}`:''}</span>`:''}`;
  if(more)el._out=detail;
  return el;
}
/* the open chip's own buttons and text: Copy the command, Show all output; a click inside the open body never folds the chip (text can be selected) */
document.addEventListener('click',e=>{const x=e.target.closest('#chat .chip .xall');if(!x)return;const c=x.closest('.chip'),p=c&&c.querySelector('.detail');if(p&&c._out){p.textContent=c._out;x.remove();}});
function refreshChips(box){
  const chips=[...box.children].filter(c=>c.classList.contains('chip'));
  let more=box.querySelector('.chips-more');
  const expanded=box.dataset.exp==='1', hide=Math.max(0,chips.length-CHIPS_SHOWN);
  chips.forEach((c,i)=>{c.hidden=!expanded&&i<hide;const d=c._ed&&c._ed.diffEl;if(d)d.hidden=c.hidden;}); /* spec 005: an edit's diff hides with its row */
  if(hide>0){
    if(!more){more=document.createElement('button');more.type='button';more.className='chips-more';box.prepend(more);}
    more.textContent=expanded?'Show fewer':'+'+hide+' earlier';more.setAttribute('aria-expanded',String(expanded));
  } else if(more)more.remove();
}
function addChip(box,el){box.appendChild(el);refreshChips(box);}
function newAgentMsg(chat,a){
  const m=document.createElement('div');m.className='msg agent';
  m.innerHTML=`<div class="meta">${esc(a.name)}</div><div class="think streaming"><button class="think-toggle" aria-expanded="true">${ICON('chev')}<span class="think-l">Thinking</span><span class="live" aria-hidden="true"><i></i><i></i><i></i></span></button><div class="think-body"></div></div><div class="chips" aria-label="Tool calls"></div>`;
  const tb=m.querySelector('.think-toggle'),body=m.querySelector('.think-body');
  tb.addEventListener('click',()=>{const o=tb.getAttribute('aria-expanded')==='true';tb.setAttribute('aria-expanded',String(!o));body.hidden=o;m.querySelector('.think').dataset.touched='1';});
  m.querySelector('.think').dataset.t0=String(Date.now());
  chat.el.appendChild(m);stickyScroll(chat);return m;
}
/* "Thinking · 4s" while a turn waits for the model; reasoning summaries only arrive when the model finishes thinking */
setInterval(()=>{
  document.querySelectorAll('.think.streaming').forEach(t=>{const l=t.querySelector('.think-l'),b=t.querySelector('.think-body');
    const sec=Math.max(0,Math.round((Date.now()-Number(t.dataset.t0||Date.now()))/1000));if(l)l.textContent=(b&&b.textContent?'Thinking':'Waiting for the model')+' · '+sec+'s';});
  document.querySelectorAll('.typing[data-t0]').forEach(typingPaint); /* spec 005 FR-022: names the current action when one runs */
},1000);
function collapseThink(think){
  if(!think||think.dataset.touched)return;
  const tb=think.querySelector('.think-toggle'),body=think.querySelector('.think-body');
  if(tb){tb.setAttribute('aria-expanded','false');} if(body)body.hidden=true;
}
/* returns false when Stop cancelled the turn (stopDemoTurn): the caller then leaves chat.busy alone */
async function playTurn(chat,a,turn,opts){
  opts=opts||{};
  const tok=chat.turn=(chat.turn||0)+1, off=()=>chat.turn!==tok;
  const m=newAgentMsg(chat,a), body=m.querySelector('.think-body'), chips=m.querySelector('.chips'), think=m.querySelector('.think');
  const cut=()=>{think.classList.remove('streaming');m.querySelectorAll('.caret').forEach(x=>x.classList.remove('caret'));collapseThink(think);return false;};
  await typeInto(body,turn.think,16,chat,tok); if(off())return cut();
  think.classList.remove('streaming');
  for(const t of turn.tools){await sleep(380);if(off())return cut();const [k,l,res,rs]=t;addChip(chips,makeChip({kind:k,tool:k,label:l,res,state:rs}));stickyScroll(chat);}
  if(turn.reply){
    await sleep(350); if(off())return cut();
    const b=document.createElement('div');b.className='bubble caret';m.appendChild(b);
    await typeInto(b,turn.reply,14,chat,tok); if(off())return cut(); b.classList.remove('caret');
    collapseThink(think);
    if(turn.quick){const q=document.createElement('div');q.className='quick';q.setAttribute('role','group');q.setAttribute('aria-label','Quick replies');
      turn.quick.forEach(txt=>{const bt=document.createElement('button');bt.textContent=txt;bt.addEventListener('click',()=>{q.remove();sendMessage(txt,a.id);});q.appendChild(bt);});m.appendChild(q);}
  } else if(opts.inProgress){
    const t=document.createElement('div');t.className='typing';t.setAttribute('aria-label',a.name+' is working');t.innerHTML='<i></i><i></i><i></i>';m.appendChild(t);
  }
  stickyScroll(chat);
  return true;
}
/* spec 005 FR-038 (2026-10-22): Stop in a demo chat ends the canned turn: the text stops, chat.busy clears, so Stop and the spinner go */
function stopDemoTurn(a){const c=chats[a.id];if(!c)return;c.el.querySelectorAll('.typing').forEach(x=>x.remove());if(!c.busy)return;c.turn=(c.turn||0)+1;c.busy=false;setSend();}
function addUserMsg(chat,text,atts,ts){
  const m=document.createElement('div');m.className='msg user';
  const now=ts?new Date(ts):new Date();const hh=(ts&&now.toDateString()!==new Date().toDateString()?now.toLocaleDateString([],{month:'short',day:'numeric'})+' ':'')+String(now.getHours()).padStart(2,'0')+':'+String(now.getMinutes()).padStart(2,'0');
  m.innerHTML='<div class="bubble"></div><div class="chips" aria-label="Attachments"></div><div class="meta">You · '+hh+'</div>';
  m.querySelector('.bubble').textContent=text;
  const box=m.querySelector('.chips');
  (atts||[]).forEach(x=>{const c=document.createElement('div');c.className='chip att-chip'+(x.img?' img':'');c.title=x.path||x.name;
    c.innerHTML=(x.img?ICON('img'):ICON('file'))+'<span>'+esc(x.name)+'</span>';box.appendChild(c);});
  if(!(atts||[]).length)box.remove();
  chat.el.appendChild(m);stickyScroll(chat);
}
function getChat(a){
  if(a.live)return liveChat(a);
  if(chats[a.id])return chats[a.id];
  const chat=chats[a.id]={el:document.createElement('div'),busy:false};
  chat.el.className='chat-inner';
  const f=(a.files||['src/'])[0];
  const sc=a.ask?a:Object.assign({},a,{ask:'Please take care of this: '+a.task.charAt(0).toLowerCase()+a.task.slice(1)+'.',
    think:'Starting with the files involved, then keeping the change small and checking it as I go.',tools:[['read',f,'','ok']],reply:null});
  addUserMsg(chat,sc.ask);
  const inProg=(a.state==='working'||a.state==='thinking');
  const reply=inProg?null:sc.reply;
  chat.busy=true;
  playTurn(chat,a,{think:sc.think,tools:sc.tools,reply:reply,quick:inProg?null:sc.quick},{inProgress:inProg}).then(ok=>{if(ok){chat.busy=false;setSend();}});
  return chat;
}
const GENERIC_THINK=[
 'Reading the request and checking which files it touches. I will keep the change small and run the existing tests before reporting back.',
 'This is within the current scope. I will look at the related code first, then make the smallest edit that does what you asked.',
 'Understood. Before changing anything I want to see how this is used elsewhere in the project so I do not break a caller.'];
async function sendMessage(text,forId){
  const a=byId(forId||ui.selected); if(!a)return;
  if(a.live)return sendLive(text,forId); const chat=getChat(a);
  text=(text||'').trim(); if(!text&&!attached.length)return;
  if(chat.busy){toast('Hold on, '+esc(a.name)+' is still replying.');return;}
  const files=attached.map(x=>x.name);
  addUserMsg(chat,text||'(attachment)',attached.slice());
  attached=[];renderAttached();
  const input=$('msgInput');if(input){input.value='';autoGrow();}
  const prev=a.state; chat.busy=true; setSend();
  if(!a.paused){a.state='thinking';a.label=null;renderAll();}
  const f=(a.files&&a.files[0])||'src/';
  const snippet=text.length>70?text.slice(0,67)+'...':text;
  const turn={think:GENERIC_THINK[Math.floor(Math.random()*GENERIC_THINK.length)]+(snippet?' You said: "'+snippet+'".':''),
    tools:[['read',f,'','ok'],['search',(snippet.split(' ').slice(0,3).join(' ')||'usages'),'5 hits','ok'],['run','npm test','all passing','ok']],
    reply:'Got it. I looked at '+f+' and nothing else depends on it, so I will go ahead with that'+(files.length?', using the attached '+(files.length>1?'files':'file')+' as reference':'')+'. I will post a summary here when it is ready for you to review.'};
  if(!await playTurn(chat,a,turn,{inProgress:false}))return; /* stopped: the Stop handler set the state */
  if(!a.paused){a.state=(prev==='thinking'||prev==='working')?prev:'working';}
  chat.busy=false; setSend(); renderAll();
}
let attached=[];
const SAMPLE_FILES=['notes.md','schema.sql','error-log.txt','spec-draft.pdf'], SAMPLE_IMGS=['screenshot-2026-10-16.png','floor-plan.png','diagram.png'];
let fi=0,ii=0;
/* Caps (also enforced in the main process): 10 MB per file, 5 files per message. */
const MAX_ATT_BYTES=10*1024*1024, MAX_ATT_FILES=5;
const fmtSize=n=>n>=1048576?(n/1048576).toFixed(1).replace(/\.0$/,'')+' MB':Math.max(1,Math.round(n/1024))+' KB';
const cleanName=n=>String(n||'').split(/[\\/]/).pop().replace(/[\u0000-\u001f\u007f<>:"|?*]/g,'').trim().replace(/^\.+/,'').slice(0,80);
let attNoteTimer=0;
function attNotice(msgs){
  const n=$('attNote'); if(!n)return; clearTimeout(attNoteTimer);
  n.textContent=msgs.join(' '); n.hidden=!msgs.length;
  if(msgs.length)attNoteTimer=setTimeout(()=>{n.hidden=true;},9000);
}
/* Add files through one gate so the picker, drop and paste share the same caps and messages. */
function gate(items){
  const msgs=[], over=[], skipped=[];
  const accepted=[];
  for(const it of items){
    if(it.size>MAX_ATT_BYTES){msgs.push('"'+it.name+'" is '+fmtSize(it.size)+', over the '+fmtSize(MAX_ATT_BYTES)+' per-file limit. Not attached.');continue;}
    if(attached.length+accepted.length>=MAX_ATT_FILES){skipped.push(it.name);continue;}
    accepted.push(it);
  }
  if(skipped.length)msgs.push('Up to '+MAX_ATT_FILES+' files per message. Not attached: '+skipped.slice(0,3).map(n=>'"'+n+'"').join(', ')+(skipped.length>3?' and '+(skipped.length-3)+' more':'')+'.');
  return {accepted,msgs};
}
function addPicked(list){
  const {accepted,msgs}=gate(list.map(f=>({name:f.name,size:f.size||0,img:f.kind==='image',path:f.path,kind:f.kind})));
  accepted.forEach(x=>attached.push(x));
  renderAttached();setSend();if(msgs.length)attNotice(msgs);
}
/* Pasted / dropped File objects: the renderer has no path, so bytes go to the main process, which checks the
   format (real image type, no SVG), sanitizes the name and stages a private temp copy. */
async function addFiles(files,opts){
  opts=opts||{}; const a0=byId(ui.selected); if(!a0)return;
  let list=[...files]; if(opts.imagesOnly)list=list.filter(f=>/^image\//i.test(f.type));
  if(!list.length)return;
  const {accepted,msgs}=gate(list.map(f=>({f,name:cleanName(f.name)||'file',size:f.size,img:/^image\//i.test(f.type)})));
  for(const it of accepted){
    let name=it.name; if(it.img&&(!name||/^image\.\w+$/i.test(name))){const d=new Date(),p=n=>String(n).padStart(2,'0');name='pasted-image-'+p(d.getHours())+p(d.getMinutes())+p(d.getSeconds())+'.'+((it.f.type.split('/')[1]||'png').replace('jpeg','jpg'));}
    if(a0.live){
      const r=await bridge.stageAttachment(name,it.f.type,await it.f.arrayBuffer());
      if(!r.ok){msgs.push(r.error);continue;}
      attached.push({name:r.file.name,img:r.file.kind==='image',path:r.file.path,kind:r.file.kind,size:r.file.size});
    } else attached.push({name,img:it.img,size:it.f.size});
    renderAttached();setSend();
  }
  if(msgs.length)attNotice(msgs);
}
function renderAttached(){
  const box=$('attached'); if(!box)return;
  const pa=byId(ui.selected); /* spec 066 FR-006: the one-shot "Plan first" flag shows as a chip above the composer */
  box.innerHTML=(pa&&pa.planNext?`<span class="att plan-chip" title="The next message asks the agent for a plan first; nothing changes until you approve it."><span>Plan first</span><button type="button" data-planoff="1" aria-label="Don't plan first">${ICON('x')}</button></span>`:'')+attached.map((x,i)=>`<span class="att ${x.img?'img':''}" title="${esc(x.path||x.name)}${x.size?' ('+fmtSize(x.size)+')':''}">${x.img?ICON('img'):ICON('file')}<span>${esc(x.name)}</span><button type="button" data-rm="${i}" aria-label="Remove ${esc(x.name)}">${ICON('x')}</button></span>`).join('')+(attached.length?`<span class="att-count" aria-live="polite">${attached.length}/${MAX_ATT_FILES}</span>`:'');
}
/* spec 052 FR-174 (issue 453): the placeholder is one line. A textarea placeholder wraps and takes no text-overflow, so the name is cut here with DurbarCutText (code points, never inside an emoji), from the measured width of the textarea, and ends in an ellipsis. The full text is the aria-label (repaintName keeps it current). */
let phCtx=null,phRO=null;
function fitPlaceholder(){const t=$('msgInput');if(!t)return;const full=t.getAttribute('aria-label')||'',cs=getComputedStyle(t),w=t.clientWidth-parseFloat(cs.paddingLeft)-parseFloat(cs.paddingRight);if(!full||!(w>0))return;
  if(!phCtx)phCtx=document.createElement('canvas').getContext('2d');phCtx.font=cs.font;const fits=x=>phCtx.measureText(x).width<=w-1;
  const text=window.DurbarCutText.fitCut(full,fits);
  if(t.placeholder!==text)t.placeholder=text;}
/* spec 005 FR-044..FR-048 (issue 592): the message box grows with its text up to 40% of the chat panel (never under the old 110px), and the
   transcript always keeps 140px (DurbarComposerSize). A size chosen with the handle on the composer's top edge fixes the height; double-click
   or Enter on the handle goes back to growing. One value for the whole app, a display preference of this computer (localStorage, like the
   detail level). */
const CSZ=window.DurbarComposerSize;
let composerChosen=(()=>{try{return CSZ.parse(localStorage.getItem(CSZ.KEY));}catch(e){return null;}})();
function composerLimits(t){const c=$('chat'),p=t.closest('.panel-in');return CSZ.limits({panelH:p?p.clientHeight:0,chatH:c?c.clientHeight:0,boxH:t.getBoundingClientRect().height});}
function sizeComposer(){const t=$('msgInput');if(!t)return;const lim=composerLimits(t);let h;
  if(composerChosen!=null)h=CSZ.clamp(composerChosen,lim);
  else{const was=t.style.height;t.style.height='auto';h=CSZ.height({chosen:null,content:t.scrollHeight,lim});if(was===h+'px')t.style.height=was;}
  if(t.style.height!==h+'px')t.style.height=h+'px';t.style.maxHeight=lim.max+'px';
  const g=$('composerGrip');if(g){g.setAttribute('aria-valuenow',String(h));g.setAttribute('aria-valuemin',String(lim.min));g.setAttribute('aria-valuemax',String(lim.max));}}
function setComposerChosen(h){composerChosen=h;try{if(h==null)localStorage.removeItem(CSZ.KEY);else localStorage.setItem(CSZ.KEY,String(h));}catch(e){}sizeComposer();}
let cszRO=null,cszRaf=0;
function wireComposerGrip(){const g=$('composerGrip'),t=$('msgInput');if(!g||!t)return;
  let drag=null;
  const boxH=()=>Math.round(t.getBoundingClientRect().height);
  g.addEventListener('mousedown',e=>e.preventDefault()); /* the box keeps the focus and its caret */
  g.addEventListener('pointerdown',e=>{if(e.button!==0)return;e.preventDefault();drag={id:e.pointerId,y:e.clientY,h:boxH(),lim:composerLimits(t),moved:false};try{g.setPointerCapture(e.pointerId);}catch(_){}});
  g.addEventListener('pointermove',e=>{if(!drag||e.pointerId!==drag.id)return;const dy=drag.y-e.clientY;if(!drag.moved&&Math.abs(dy)<2)return;
    if(!drag.moved){drag.moved=true;g.classList.add('dragging');}composerChosen=CSZ.clamp(drag.h+dy,drag.lim);sizeComposer();});
  const end=e=>{if(!drag||e.pointerId!==drag.id)return;const moved=drag.moved;drag=null;g.classList.remove('dragging');try{g.releasePointerCapture(e.pointerId);}catch(_){}if(moved)setComposerChosen(composerChosen);};
  g.addEventListener('pointerup',end);g.addEventListener('pointercancel',end);
  g.addEventListener('dblclick',e=>{e.preventDefault();setComposerChosen(null);});
  g.addEventListener('keydown',e=>{if(e.altKey||e.ctrlKey||e.metaKey||e.shiftKey||e.isComposing)return;const r=CSZ.keyStep(e.key,boxH(),composerLimits(t));if(r==null)return;
    e.preventDefault();e.stopPropagation();setComposerChosen(r==='reset'?null:r);});
  /* the limits follow the window and whatever opens above the chat (Previous sessions, the answer bar); once per frame */
  if(window.ResizeObserver){if(cszRO)cszRO.disconnect();else cszRO=new ResizeObserver(()=>{if(!cszRaf)cszRaf=requestAnimationFrame(()=>{cszRaf=0;sizeComposer();});});cszRO.observe($('chat'));}
  sizeComposer();
}
function autoGrow(){sizeComposer();setSend();}
function setSend(){const b=$('sendBtn'),t=$('msgInput');if(!b||!t)return;const a=byId(ui.selected);const busy=a&&chats[a.id]&&chats[a.id].busy;b.setAttribute('aria-disabled',String(!!busy||(!t.value.trim()&&!attached.length)));syncRunState();}

function updatePanelHeader(){
  const a=byId(ui.selected); if(!a)return; const st=vis(a);
  const ph=$('panelHead'); if(!ph)return;
  const sp=ph.querySelector('[data-f=status]'); const pst=pillSt(a); const toDone=pst==='done'&&sp.classList.contains('pill')&&!sp.classList.contains('st-done'); sp.className='pill st-'+pst; sp.innerHTML='<i></i>'+esc(stWord(a)); sp.title=isFailing(a)?MOOD.failStreak(a.id)+' tool calls failed in a row':''; if(toDone)pulseDone(sp); /* spec 052 FR-062, FR-067 */
  const ag=ph.querySelector('[data-f=ago]'); if(ag){const t=ACT.agoShort(sinceLast(a));ag.textContent=!t?'':t==='just now'?'active just now':'active '+t+' ago';ag.title=t?'Last activity '+ACT.agoLong(sinceLast(a)):'';}
  const t=ph.querySelector('[data-f=task]'); t.textContent=taskText(a); t.title=taskText(a);
  const ug=ph.querySelector('[data-f=usage]'); ug.textContent=usageLong(a); ug.title=ug.textContent.endsWith(' est.')?USD_TIP:'';
  updateCapChip(a);
  $('pauseBtn').querySelector('span').textContent=a.paused?'Resume':'Pause';
  syncRunState(); /* spec 005 FR-038: Send or Stop follows the turn */
}
/* spec 052 FR-003: the chat header's More menu. A real menu: arrows move, Home/End jump, Esc closes and returns focus to More;
   a choice or a click elsewhere closes it. The items are the old buttons with their ids, so their handlers stay as they were. */
function wireMoreMenu(){wireMenu('moreBtn','moreMenu');}
/* spec 052 FR-003, #308: one menu behaviour for the chat's More and the top bar's ⋯ */
function wireMenu(btnId,menuId){
  const btn=$(btnId), m=$(menuId); if(!btn||!m)return;
  /* spec 052 FR-057, FR-081: skip items Simple hides with CSS (Copy resume command, MCP servers, Tools and usage, Control from GitHub), so arrows never land on them */
  const items=()=>[...m.querySelectorAll('[role="menuitem"],input')].filter(x=>!x.hidden&&!x.disabled&&!x.closest('[hidden]')&&x.getClientRects().length);
  const close=(back)=>{if(m.hidden)return;m.hidden=true;btn.setAttribute('aria-expanded','false');document.removeEventListener('mousedown',outside,true);if(back)btn.focus();};
  const outside=e=>{if(!m.contains(e.target)&&e.target!==btn&&!btn.contains(e.target))close(false);};
  const open=(first)=>{m.hidden=false;btn.setAttribute('aria-expanded','true');document.addEventListener('mousedown',outside,true);const it=items();if(it.length)(first==='last'?it[it.length-1]:it[0]).focus();};
  btn.onclick=()=>m.hidden?open('first'):close(true);
  if(btnId==='topMoreBtn')m.addEventListener('change',()=>close(true));
  btn.onkeydown=e=>{if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();open(e.key==='ArrowUp'?'last':'first');}};
  m.onkeydown=e=>{
    const it=items(), k=it.indexOf(document.activeElement);
    if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close(true);}
    else if(e.key==='ArrowDown'){e.preventDefault();it[(k+1)%it.length].focus();}
    else if(e.key==='ArrowUp'){e.preventDefault();it[(k-1+it.length)%it.length].focus();}
    else if(e.key==='Home'){e.preventDefault();it[0].focus();}
    else if(e.key==='End'){e.preventDefault();it[it.length-1].focus();}
    else if(e.key==='Tab')close(false);
  };
  m.addEventListener('click',e=>{if(e.target.closest('[role="menuitem"]'))close(false);});
}
/* spec 052 FR-001: the answer bar. While a request in the chat waits for you (permission, question, cost limit) and its card is out
   of view, a bar above the composer shows it with the same choices; its buttons press the card's own buttons, so there is one code
   path. A question is answered in its card (options and text): the bar takes you there. */
/* the words of a request card (permission, question, limit), in full: the answer bar and the inbox show exactly this (FR-016, FR-027) */
function requestText(n){const c=n.cloneNode(true);c.querySelectorAll('.note-actions,.q-opts,.q-form,.q-urlbox,.pstate,.pdiff,.pcmd,.pfold[hidden]'+(SIMPLE?'':',.pfold')).forEach(x=>x.remove()); /* spec 052 FR-080: the command never (notifications use this text) */const q=n.querySelector('.q-text');return safeMask((q?q.textContent:c.textContent).replace(/\s+/g,' ').trim().replace(/^(Needs your OK|Permission|Question from the agent|Questions from the agent):?\s*/,''));} /* spec 041 FR-065: the question is agent text; the answer bar, the inbox and announcements read it from here */let answerObs=null;
/* spec 052 FR-060: the key of a permission card's button, and the one click path the bar and the keys share */
const answerKeyOf=b=>b.dataset.act==='session'?'S':/\bdanger\b/.test(b.className)?'D':/\bprimary\b/.test(b.className)?'A':'';
const chatKeyText=k=>keyText(KEYS.chatParts(k,IS_MAC)), chatKeyAria=k=>ariaKeys(KEYS.chatParts(k,IS_MAC)); /* FR-084: Alt+A elsewhere, ⌥⌘A on a Mac */
const answerPress=(src,what)=>()=>{const word=src.textContent;src.click();announce(word+': '+what);const m=$('msgInput');if(m)m.focus();};
function wireAnswerBar(a){
  if(answerObs){answerObs.m.disconnect();answerObs.i.disconnect();answerObs=null;}
  const bar=$('answerBar'), chat=$('chat'); if(!bar||!chat)return;
  let card=null, cardVisible=true;
  /* in view = at least 60% of the card inside the chat's box; recomputed on scroll and on every change (plain geometry, no observer timing).
     spec 052 FR-162: a card with no height (inside something folded or hidden) is not in view, so the bar shows it. */
  const inView=()=>{if(!card||!card.isConnected)return true;const c=chat.getBoundingClientRect();if(!c.height)return true;const r=card.getBoundingClientRect();if(!r.height)return false;const vis=Math.min(r.bottom,c.bottom)-Math.max(r.top,c.top);return vis>=0.6*Math.min(r.height,c.height);};
  let raf=0;const recheck=()=>{if(raf)return;raf=requestAnimationFrame(()=>{raf=0;const v=inView();if(v!==cardVisible){cardVisible=v;paint();}});};
  chat.addEventListener('scroll',recheck,{passive:true});window.addEventListener('resize',recheck);
  const io={observe(){},unobserve(){},disconnect(){chat.removeEventListener('scroll',recheck);window.removeEventListener('resize',recheck);}};
  /* FR-016: the oldest waiting request first, and how many there are */
  const waiting=()=>[...chat.querySelectorAll('.note.perm:not(.settled)')].filter(n=>n.querySelector(':scope > .note-actions button'));
  const pending=()=>waiting()[0]||null;
  const textOf=requestText;
  /* FR-016: to the request itself, not to its Approve button (an Enter right after must not approve) */
  const show=()=>{if(card)focusRequest(card);};
  /* spec 052 FR-162: a short question with one choice and a few short options is answered from the bar itself: its option buttons, its
     own "Other answer" box and Skip press the card's own controls (one code path: the card's Answer handler sends and settles). */
  const qFits=c=>{if(!c.classList.contains('question')||c.classList.contains('elicit'))return null;const it=c.querySelectorAll('.q-item');if(it.length!==1)return null;
    const opts=[...it[0].querySelectorAll('.q-opt')],other=it[0].querySelector('.q-other'),ok=c.querySelector(':scope > .note-actions .btn.primary'),skip=c.querySelector(':scope > .note-actions .btn.danger');
    if(it[0].querySelector('.q-opts[role="group"]')||opts.length>4||!other||!ok||opts.some(o=>(o.querySelector('.q-lbl')||o).textContent.length>40))return null;
    const qt=it[0].querySelector('.q-text').cloneNode(true),tag=qt.querySelector('.tag');if(tag)tag.remove();
    return {opts,other,ok,skip,tag:tag?tag.textContent:'',q:safeMask(qt.textContent.replace(/\s+/g,' ').trim())};};
  let painted='';
  function paint(){
    if(!card||cardVisible){if(painted||!bar.hidden){bar.hidden=true;bar.innerHTML='';painted='';}return;}
    const n=waiting().length, text=textOf(card);
    /* the same request, count and words: keep the bar as it is (a repaint would drop what you type in its box and its focus) */
    const key=n+'\u0001'+text;if(painted&&bar._card===card&&painted===key&&!bar.hidden)return;
    const hadFocus=bar.contains(document.activeElement);
    painted=key;bar._card=card;
    const q=card.classList.contains('question'), long=text.length>480, fit=q&&!long?qFits(card):null;
    bar.innerHTML='<span class="ab-q"><b></b> <span></span></span><span class="ab-act"></span>';
    bar.querySelector('b').textContent=(n>1?'1 of '+n+' · ':'')+a.name+(q?' asks:':card.classList.contains('limit')?' stopped:':' needs your OK:');
    const qs=bar.querySelector('.ab-q span');
    if(fit){if(fit.tag){const tg=document.createElement('span');tg.className='tag';tg.textContent=fit.tag;qs.appendChild(tg);qs.appendChild(document.createTextNode(' '));}qs.appendChild(document.createTextNode(fit.q));}
    else{qs.textContent=long?'a long request; read it in the chat before you answer.':text;if(long)qs.title=DurbarCutText.cutText(text,300);} /* spec 052 FR-160: the full text is in the chat; FR-168: a data tooltip is at most 300 characters */
    const act=bar.querySelector('.ab-act');
    const add=(label,cls,fn,title,keys)=>{const b=document.createElement('button');b.type='button';b.className='btn '+cls;b.textContent=label;if(title)b.title=title;if(keys)b.setAttribute('aria-keyshortcuts',keys);b.onclick=fn;act.appendChild(b);return b;};
    if(fit){
      const said=w=>{announce('Answered: '+w);const m=$('msgInput');if(m)m.focus();};
      for(const o of fit.opts){const lb=(o.querySelector('.q-lbl')||o).textContent;add(lb,'ab-opt',()=>{o.click();fit.ok.click();said(lb);},o.title);}
      const box=document.createElement('input');box.type='text';box.className='ab-other';box.maxLength=500;box.placeholder='Other answer';box.setAttribute('aria-label','Other answer: '+fit.q);box.setAttribute('aria-keyshortcuts','Enter');box.title='Type your own answer; Enter sends it';
      box.addEventListener('keydown',ev=>{if(ev.key!=='Enter'||ev.shiftKey||ev.isComposing||ev.altKey||ev.ctrlKey||ev.metaKey)return;ev.preventDefault();
        const v=box.value.replace(/\s+/g,' ').trim();if(!v){announce('Type an answer first, or choose an option.');return;}
        fit.other.value=v;fit.other.dispatchEvent(new Event('input',{bubbles:true}));fit.ok.click();said(v);});
      act.appendChild(box);
      if(fit.skip)add(fit.skip.textContent,'danger',()=>{fit.skip.click();announce('Skipped');const m=$('msgInput');if(m)m.focus();},fit.skip.title);
    }
    else if(q)add('Answer in chat','primary',show);
    /* FR-016: a long request is answered in the chat only; the wide grant (any arguments) stays in the card */
    /* FR-060: Alt+A / Alt+S / Alt+D (⌥⌘A/S/D on a Mac, FR-084) press the same buttons (permission requests only) */
    else if(!long)for(const src of card.querySelectorAll(':scope > .note-actions button'))if(!src.dataset.broad){
      /* spec 003 FR-095: a Read-only denial's "Switch to Ask first…" opens the mode menu here, anchored to the bar's own button */
      if(src.dataset.act==='ro-ask'){const b=add(src.textContent,'',()=>roAskOpen(a,b),src.title);b.dataset.act='ro-ask';b.setAttribute('aria-haspopup','menu');b.setAttribute('aria-expanded','false');continue;}
      const k=card.classList.contains('limit')?'':answerKeyOf(src);add(src.textContent,(src.className.match(/\b(primary|danger|session)\b/)||[''])[0],answerPress(src,text),k?(src.title?src.title+' ':'')+'('+chatKeyText(k)+')':src.title,k?chatKeyAria(k):'');}
    add(q?'Show question':'Show in chat','ghost',show,q?'Scroll to the question in the chat':'Scroll to the request in the chat');
    bar.hidden=false;
    if(hadFocus){const f=act.querySelector('button,input');if(f)f.focus();}
  }
  const check=()=>{const p=pending();if(p!==card){card=p;cardVisible=inView();}else cardVisible=inView();paint();};
  const mo=new MutationObserver(()=>check());mo.observe(chat,{childList:true,subtree:true});
  /* spec 052 FR-060: answer the oldest waiting permission (the one the bar shows) from the keyboard, through the bar's own click path.
     A question or a spending limit is answered in its card; a long request is read in the chat first. Returns false when nothing applies. */
  const answerKey=kind=>{
    const c=pending(); if(!c)return false;
    if(c.classList.contains('question')||c.classList.contains('limit')||textOf(c).length>480){card=c;show();announce(c.classList.contains('question')?'Answer the question in its card.':c.classList.contains('limit')?'Choose in the spending limit card.':'A long request: read it in the chat before you answer.');return true;}
    const src=[...c.querySelectorAll(':scope > .note-actions button')].find(b=>!b.dataset.broad&&answerKeyOf(b)===kind);
    if(!src)return false;
    answerPress(src,textOf(c))();return true;
  };
  answerObs={m:mo,i:io,answerKey};check();
}
/* ---------------- spec 063: the folder chip says the git branch and how many files changed; a click lists them ---------------- */
const FSTAT=new Map(); /* main agent id -> {at, busy, st} */
const GS=window.DurbarGitStatus;
/* the folder's own name (the last part of its path) */
const folderNameOf=a=>{const r=roomOf(a);const p=r&&r.path?String(r.path).replace(/[\\/]+$/,''):'';return p.split(/[\\/]/).pop()||'';};
function refreshFolderStatus(a0){
  const a=a0&&liveRoot(a0); if(!a||!a.live||!bridge.gitStatus||!GS)return;
  const c=FSTAT.get(a.id)||{at:0};FSTAT.set(a.id,c);
  if(c.busy||Date.now()-c.at<5000){paintFolderStatus(a);return;} /* FR-005: once per 5 s, one request at a time */
  c.busy=true;c.at=Date.now();
  bridge.gitStatus(a.id).then(st=>{c.st=st;},()=>{c.st={repo:false};}).finally(()=>{c.busy=false;paintFolderStatus(a);});
}
function paintFolderStatus(a){
  const sel=ui.selected&&byId(ui.selected);if(!sel||liveRoot(sel)!==a)return;
  const chip=document.querySelector('#panelHead .folder');if(!chip)return;
  const st=(FSTAT.get(a.id)||{}).st;
  let t=chip.querySelector('.fst');
  const text=GS.chipText(st);
  if(!text){if(t)t.remove();chip.removeAttribute('role');chip.removeAttribute('tabindex');chip.onclick=chip.onkeydown=null;return;}
  if(!t){t=document.createElement('span');t.className='fst';chip.appendChild(t);}
  t.textContent=text;
  /* FR-003: a button only when there is something to show */
  if(GS.count(st)){chip.setAttribute('role','button');chip.tabIndex=0;chip.setAttribute('aria-label',GS.chipLabel(st));
    chip.onclick=()=>showFolderStatus(a,chip);chip.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();showFolderStatus(a,chip);}};}
  else{chip.removeAttribute('role');chip.removeAttribute('tabindex');chip.setAttribute('aria-label',GS.chipLabel(st));chip.onclick=chip.onkeydown=null;}
}
async function showFolderStatus(a,chip){
  const st=(FSTAT.get(a.id)||{}).st;if(!st||!st.repo)return;
  const r=await askDialog({title:'Changes in '+(folderNameOf(a)||'this folder'),body:GS.body(st),lines:GS.lines(st),buttons:[{label:'Open in VS Code',value:'vscode'},{label:'Done',value:null,cls:'primary'}],returnFocus:chip});
  if(r&&r.value==='vscode'&&bridge.openInVSCode)openLive(a,chip);
}
/* spec 074 FR-022 (issues 587, 612): unsent text and attachments per chat, in memory only (this window; never written to disk: a draft
   can hold a pasted token), so closing a chat or opening another never loses a half-written prompt. Sending empties the box, which
   drops the entry; ending or removing the session drops it too. */
const DRAFTS=new Map();
function keepDraft(){const m=$('msgInput');if(!m||!ui.selected)return;
  if(m.value||attached.length)DRAFTS.set(ui.selected,{t:m.value,att:attached.slice()});else DRAFTS.delete(ui.selected);}
/* FR-024 (issue 612): a pencil on the desk, list row and strip of a chat that has an unsent draft and is not the open one */
/* FR-022 (issue 612, after review): ending a session drops its draft, also from its open box (it cannot resume into the same box) */
function dropDraft(id){DRAFTS.delete(id);if(ui.selected===id){const m=$('msgInput');if(m){m.value='';autoGrow();}attached=[];renderAttached();}scheduleRender();}
const hasDraft=a=>!!a&&a.id!==ui.selected&&DRAFTS.has(a.id);
const draftHTML=a=>hasDraft(a)?`<span class="draft-mark" title="Unsent draft" aria-hidden="true">${ICON('edit')}</span>`:'';
const draftWords=a=>hasDraft(a)?', unsent draft':'';
/* spec 074 FR-019 (issue 587): the cursor at the end of the open chat's message box, ready to type; Enter sends through the normal
   composer. Never the answer bar (a focused Allow would approve on Enter). No usable box (a helper, not live): the chat title. */
function focusComposer(){
  const m=$('msgInput');
  if(m&&!m.disabled&&!m.readOnly&&m.getClientRects().length){m.focus({preventScroll:true});const n=m.value.length;try{m.setSelectionRange(n,n);}catch(e){}return true;}
  const t=$('panelTitle');if(t)t.focus({preventScroll:true});return false;
}
function openPanel(id,focus){
  const a=byId(id); if(!a)return; closeSlash(); keepDraft(); ui.selected=id; attached=(DRAFTS.get(id)||{att:[]}).att.slice();
  noteRecentChat(a); rememberUi();
  document.body.classList.add('panel-open');
  const room=roomOf(a), parent=a.parent?byId(a.parent):null;
  const p=$('panel');
  const stripScroll=(p.querySelector('.strip-list')||{}).scrollLeft||0;
  const mdlName=a.live&&a.info?modelLabel(a.info):'';
  const subText=a.role+(parent?' · helper of '+parent.name:'');
  p.innerHTML=`<div class="panel-in">
   <div class="strip" role="navigation" aria-label="Agents"><button class="btn back" id="backBtn" type="button" title="Back to the office (Esc)">${ICON('back')}<span>Office</span></button><div class="strip-list" id="stripList"></div></div>
   <div class="ph" id="panelHead"><div class="ph-top"><div class="avatar">${avatar(a)}</div><div class="ph-id"><h2 id="panelTitle" tabindex="-1"${nameTipAttr(a)||` title="${esc(a.name)}"`}>${esc(a.name)}</h2><div class="sub" title="${esc(subText)}">${parent?'':chatNoHTML(a)}${!parent&&chatNoOf(a)?'<span class="sr-only">Chat '+chatNoOf(a)+'. </span>':''}${esc(subText)}</div></div>
      <div class="ph-meta"><span data-f="status"></span><span class="ph-ago" data-f="ago"></span><!-- spec 005 FR-039: the header keeps who and what (status, limit, remote, folder); how the next message runs is under the message box (FR-037) -->${a.live&&!a.parent&&bridge&&bridge.setCap?capChipHTML(liveRoot(a)):''}${canRemote(a)?remoteChipHTML(a):''}<span class="folder" title="${esc(room.path)}"><svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" style="flex:none"><path d="M1.8 4.2a1.4 1.4 0 0 1 1.4-1.4h3l1.6 1.8h4.8a1.4 1.4 0 0 1 1.4 1.4v6.2a1.4 1.4 0 0 1-1.4 1.4H3.2a1.4 1.4 0 0 1-1.4-1.4z"/></svg><span class="folder-t">${esc(showPath(room.path))}</span></span></div>      <div class="actions"><!-- spec 052 FR-003: two actions in view (FR-139: a third, + New, by owner decision), the rest under More (ids kept; End and Remove last); spec 006 FR-033 (2026-10-21): Previous sessions moved out of the actions, to their own section above the chat -->${a.live&&!a.parent&&bridge.newSession&&anyKindReady()&&!demoOn?`<button class="btn sm" id="newSessHdrBtn" type="button" title="New session in ${esc(room.name)}" aria-label="New session in ${esc(room.name)}">+ New</button>`:''}<button class="btn sm primary" id="vscodeBtn" type="button" title="Open this folder in VS Code"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5.5 4.5L2 8l3.5 3.5M10.5 4.5L14 8l-3.5 3.5M9 3l-2 10"/></svg>Open in VS Code</button>
        <button class="btn sm" id="pauseBtn" type="button"><svg viewBox="0 0 16 16" fill="currentColor"><rect x="4" y="3" width="2.8" height="10" rx="1"/><rect x="9.2" y="3" width="2.8" height="10" rx="1"/></svg><span>Pause</span></button>
        <button class="btn sm" id="moreBtn" type="button" aria-haspopup="menu" aria-expanded="false" aria-controls="moreMenu" title="More actions for this agent">More<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6l4 4 4-4"/></svg></button><div class="more-menu" id="moreMenu" role="menu" aria-label="More actions" hidden>${a.live&&!a.parent?`<button class="more-it" role="menuitem" tabindex="-1" id="toolsHdrBtn" type="button" title="Which tools this agent used, how often, and its models and context window"><span class="mt">Tools and usage<small>Tools used, models, context window</small></span></button>`:''}${a.live&&!a.parent&&bridge.listSchedules&&!demoOn?`<button class="more-it" role="menuitem" tabindex="-1" id="schedHdrBtn" type="button" title="Prompts sent to this folder's agent at a time, every day or at an interval"><span class="mt">Schedules${(()=>{try{const n=schedulesOf(room).filter(s=>!s.done).length;return n?' ('+n+')':'';}catch(e){return '';}})()}<small>Prompts sent at a set time</small></span></button>`:''}${a.live&&bridge.newSession&&!a.parent&&anyKindReady()?`<button class="more-it" role="menuitem" tabindex="-1" id="newSessBtn" type="button" title="Another agent with its own chat in this folder"><span class="mt">+ New session<small>Another agent in this folder</small></span></button>${canHandover(a)?'<button class="more-it" role="menuitem" tabindex="-1" id="handoverBtn" type="button" title="Start a session in another agent app from a summary of this conversation. You review it first."><span class="mt">Continue in another app…<small>Start there from a summary</small></span></button>':''}`:''}${canRemote(a)?`<button class="more-it${a.remote?' on':''}" role="menuitem" tabindex="-1" id="remoteBtn" type="button" title="Follow and steer this session from github.com and GitHub Mobile">${remoteItemInner(a)}</button>`:''}${a.live&&!a.parent&&resumeCmdOf(a)?`<button class="more-it" role="menuitem" tabindex="-1" id="copyResBtn" type="button" title="Copy a command that continues this session in a terminal (end the session here first)"><span class="mt">Copy resume command<small>Continue this session in a terminal</small></span></button>`:''}${canRenameSession(a)?`<button class="more-it" role="menuitem" tabindex="-1" id="renameSessBtn" type="button" title="Give this session a short name"><span class="mt">Rename…<small>A short name for this session</small></span></button>`:''}<div class="more-sep" role="separator"></div>${a.live&&bridge.end&&!a.parent?`<button class="more-it danger" role="menuitem" tabindex="-1" id="endBtn" type="button" title="End this session and free it. Sending a message later resumes it."><span class="mt">End session<small>A later message resumes it</small></span></button>`:''}${a.live&&bridge.removeSession&&!a.parent&&siblingsOf(a).length?`<button class="more-it danger" role="menuitem" tabindex="-1" id="rmSessBtn" type="button" title="End this session and take its card out of the office. The folder's other sessions stay."><span class="mt">Remove from office<small>Ends it; history stays in Previous sessions</small></span></button>`:(a.live&&bridge.removeFolder&&!a.parent&&!demoOn?`<button class="more-it danger" role="menuitem" tabindex="-1" id="rmFolderBtn" type="button" title="Forget ${esc(DurbarCutText.cutText(room.name,30))} in Agent Durbar. Its session ends; nothing on disk is deleted."><span class="mt">Remove folder<small>Forgets the folder; files stay on disk</small></span></button>`:'')}</div></div></div>
    <div class="ph-line"><p class="ptask" data-f="task"></p><p class="pusage" data-f="usage"></p></div>
    <div class="grants" id="grants" aria-label="Permissions allowed for this session" hidden></div></div>
   <div class="prev" id="prev" role="region" aria-label="${SIMPLE?'Earlier chats':'Previous sessions'}" hidden>${a.live&&!a.parent?`<div class="prev-bar"><button class="prev-toggle" id="prevBtn" type="button" data-pv="toggle" aria-expanded="false" aria-controls="prevPanel" aria-keyshortcuts="${esc(ariaKeys(PREV_KEYS))}">${ICON('chev')}<span class="prev-l">${SIMPLE?'Earlier chats':'Previous sessions'}</span><span class="prev-c" hidden></span><span class="prev-sub"></span></button></div><div class="prev-panel" id="prevPanel" hidden></div>`:''}</div>
   <div id="chat" role="log" aria-live="off" aria-label="Chat with ${esc(a.name)}" tabindex="0"></div>
   <div class="answer-bar" id="answerBar" role="region" aria-label="Waiting for your answer" hidden></div>
   <div class="composer"><div class="cgrip" id="composerGrip" role="separator" aria-orientation="horizontal" aria-label="Resize message box" aria-controls="msgInput" tabindex="0" title="Drag to resize the message box. Double-click to let it grow with your text again."></div><div class="att-note" id="attNote" role="alert" hidden></div><div class="attached" id="attached" aria-label="Attachments"></div>
    <div class="inbox">
     <textarea id="msgInput" rows="1" placeholder="Message ${esc(a.name)}…" aria-label="Message ${esc(a.name)}"></textarea>
     ${runSlotHTML(a)}</div>
    ${composerToolbarHTML(a,mdlName)}
    <p class="hint">${esc(composerHint(a))}</p></div>
   <div class="drop-ov" id="dropOv" aria-hidden="true"><div>Drop to attach<small>Up to 5 files, 10 MB each. Images: PNG, JPEG, GIF, WebP, BMP.</small></div></div></div>`;
  renderStrip(); const sl=$('stripList'); if(sl)sl.scrollLeft=stripScroll;
  const chat=getChat(a); $('chat').appendChild(chat.el);
  updatePanelHeader(); renderGrants();
  const chatEl=$('chat'); chatEl.dataset.pin='1'; chatEl.scrollTop=1e6;
  chatEl.onscroll=()=>{chatEl.dataset.pin=(chatEl.scrollHeight-chatEl.scrollTop-chatEl.clientHeight<80)?'1':'0';};
  $('panel').querySelector('.panel-in').classList.toggle('ro',!!(a.live&&a.parent));
  $('backBtn').onclick=closePanel;
  refreshFolderStatus(a); /* spec 063: branch and changed files on the folder chip */
  $('vscodeBtn').onclick=e=>a.live?openLive(a,e.currentTarget):toast('Would run <code>code '+esc(room.path)+'</code>',3800);
  if(a.live)$('pauseBtn').hidden=true;
  if($('newSessBtn'))$('newSessBtn').onclick=()=>newSession(a);
  if($('newSessHdrBtn'))$('newSessHdrBtn').onclick=()=>newSession(a);
  if($('handoverBtn'))$('handoverBtn').onclick=()=>newSession(a,{summary:true,handover:true}); /* spec 030 FR-042 (#409) */
  if($('schedHdrBtn'))$('schedHdrBtn').onclick=()=>openSchedules(room,a);
  if($('toolsHdrBtn'))$('toolsHdrBtn').onclick=()=>window.DurbarScreens.openTools(liveRoot(a).id);
  if($('mcpBtn'))refreshMcpCount(liveRoot(a)); /* spec 005 FR-037: the click is delegated (the chip is redrawn with its count) */
  if($('renameSessBtn'))$('renameSessBtn').onclick=e=>renameSessionUi(a,null,{opener:()=>$('moreBtn')||e.currentTarget});
  if($('endBtn'))$('endBtn').onclick=e=>endLive(a,e.currentTarget).catch(failToast('end'));
  if($('rmSessBtn'))$('rmSessBtn').onclick=()=>removeSessionUi(a);
  if($('rmFolderBtn'))$('rmFolderBtn').onclick=()=>removeFolder(room); /* spec 006 FR-022: the only session of the folder */
  if($('copyResBtn'))$('copyResBtn').onclick=()=>copyResume(a);
  if($('remoteBtn'))$('remoteBtn').onclick=()=>(a.remote?remoteOff(a):remoteOn(a));
  if($('remoteChip'))$('remoteChip').onclick=()=>remoteLinkDialog(a);
  if(a.live&&!a.parent)initPrev(a); else {const pv=$('prev');if(pv)pv.hidden=true;}
  if(a.live&&!a.parent&&a.info&&a.info.resumeLast&&bridge.wake)wakeLast(a);
  wireMoreMenu();
  wireAnswerBar(a);
  if(needsMe(a)){const c=pendingCardOf(a);if(c)announce(a.name+(c.classList.contains('question')?' asks: ':' needs your OK: ')+requestText(c));}
  $('pauseBtn').onclick=()=>{a.paused=!a.paused;if(a.live&&bridge.setPaused)bridge.setPaused(a.id,a.paused);toast(esc(a.name)+(a.paused?' paused.':' resumed.'));renderAll();};
  if($('stopBtn'))$('stopBtn').onclick=e=>{RUN_SAID.stopped=true;if(a.live){const b=e.currentTarget;if(b.getAttribute('aria-busy')==='true')return;b.setAttribute('aria-busy','true');return stopLive(a).catch(failToast('stop')).finally(()=>{b.removeAttribute('aria-busy');syncRunState();});}stopDemoTurn(a);a.paused=false;a.state='idle';a.label=null;a.task='Stopped by you. Ready for a new task.';toast(esc(a.name)+' stopped.');renderAll();};
  $('attFile').onclick=()=>{if(a.live)return pickLive();addPicked([{name:SAMPLE_FILES[fi++%SAMPLE_FILES.length],kind:'file',size:12*1024}]);};
  $('attImg').onclick=()=>{if(a.live)return pickLive('image');addPicked([{name:SAMPLE_IMGS[ii++%SAMPLE_IMGS.length],kind:'image',size:240*1024}]);};
  /* drag and drop anywhere on the panel, paste into the message box */
  const panel=$('panel'), ov=$('dropOv'); let dragDepth=0;
  const hasFiles=e=>e.dataTransfer&&[...(e.dataTransfer.types||[])].includes('Files');
  panel.ondragenter=e=>{if(!hasFiles(e))return;e.preventDefault();dragDepth++;ov.classList.add('on');};
  panel.ondragover=e=>{if(!hasFiles(e))return;e.preventDefault();e.dataTransfer.dropEffect='copy';};
  panel.ondragleave=e=>{if(!hasFiles(e))return;dragDepth=Math.max(0,dragDepth-1);if(!dragDepth)ov.classList.remove('on');};
  panel.ondrop=e=>{if(!hasFiles(e))return;e.preventDefault();dragDepth=0;ov.classList.remove('on');addFiles(e.dataTransfer.files);};
  $('msgInput').addEventListener('paste',e=>{
    const fl=[...(e.clipboardData?e.clipboardData.files:[])].filter(f=>/^image\//i.test(f.type)); if(!fl.length)return;
    if(!e.clipboardData.getData('text/plain'))e.preventDefault(); /* image only: attach; image + text: attach and let the text paste */
    addFiles(fl,{imagesOnly:true});});
  $('grants').onclick=e=>{
    if(e.target.closest('#grantsBtn')){grantsOpen=!grantsOpen;const b=$('grantsBtn'),p=$('grantsPop');b.setAttribute('aria-expanded',String(grantsOpen));p.hidden=!grantsOpen;if(grantsOpen){const f=p.querySelector('[data-revoke]');if(f)f.focus();}return;}
    if(e.target.closest('#grantsAll')){revokeAllGrants();return;}
    const b=e.target.closest('[data-revoke]');
    if(b){const r=liveRoot(byId(ui.selected));const all=[...$('grants').querySelectorAll('[data-revoke]')];grantsFocus=all.indexOf(b);bridge.revokeGrant(r.id,b.dataset.revoke);}};
  grantsOpen=false;
  $('grants').addEventListener('focusout',e=>{if(grantsOpen&&e.relatedTarget&&!e.relatedTarget.closest('#grants')&&!e.relatedTarget.closest('.dlg-ov'))closeGrants(false);});
  $('grants').onkeydown=e=>{if(e.key==='Escape'&&grantsOpen){e.preventDefault();e.stopPropagation();closeGrants(true);}};
  if(!window.__grantsOutside){window.__grantsOutside=true;document.addEventListener('click',e=>{const path=e.composedPath();if(grantsOpen&&!path.some(n=>n.id==='grants')&&!path.some(n=>n.classList&&n.classList.contains('dlg-ov')))closeGrants(false);}); /* a click in the Revoke all dialog (Cancel) is not outside: it behaves like Esc and keeps the list open */ /* composedPath: a revoke redraws the list, so the clicked button may already be detached here */}
  $('attached').onclick=e=>{const po=e.target.closest('[data-planoff]');if(po){const pa=byId(ui.selected);if(pa)pa.planNext=false;renderAttached();const m=$('msgInput');if(m)m.focus();return;}const b=e.target.closest('[data-rm]');if(b){attached.splice(+b.dataset.rm,1);renderAttached();setSend();attNotice([]);}};
  const input=$('msgInput');
  fitPlaceholder();if(window.ResizeObserver){if(phRO)phRO.disconnect();else phRO=new ResizeObserver(fitPlaceholder);phRO.observe(input);}
  input.addEventListener('input',autoGrow);
  initSlash(a,input); /* spec 073: the "/" list; its keydown runs first, so Enter / Tab / Esc pick or close while it is open */
  input.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendMessage(input.value);}});
  $('sendBtn').onclick=()=>{if($('sendBtn').getAttribute('aria-disabled')!=='true')sendMessage(input.value);};
  setSend(); wireToolbar(); /* spec 005 FR-037..FR-040 */
  wireComposerGrip(); /* spec 005 FR-044..FR-048 */
  renderAll(); const cur=document.querySelector('#stripList .sitem.sel'); if(cur)cur.scrollIntoView({inline:'nearest',block:'nearest'});
  /* spec 074 FR-022 (issue 587): this chat's unsent text comes back */
  {const m=$('msgInput'),dr=DRAFTS.get(id);if(m&&dr){m.value=dr.t;autoGrow();}if(dr&&dr.att.length){renderAttached();setSend();}}
  /* spec 074 FR-019: a chat the user opened gets the cursor in its message box (the title when it has none) */
  if(focus==='title')$('panelTitle').focus({preventScroll:true});else if(focus)focusComposer();
}
/* spec 052 FR-095 (round 10): the composer's hint, short: the keys, then the demo or live words and the mode (the mode part is rebuilt when it changes) */
function composerHint(a){
  const base='Shift+Enter: new line · Drop or paste images';
  if(!a||!a.live)return base+' · Demo: sample data';
  const r=liveRoot(a)||a, m=MODE_NAME[((r.info||a.info)||{}).permMode];
  return base+' · '+(SIM?'Demo, no credits used':'Live '+kindWord(r.info&&r.info.adapterId))+(m?' · '+m:'');
}
/* ---------------- spec 073: the "/" list in the message box (an ARIA combobox with a listbox; focus stays in the box) ----------------
   Entries come from main (agents:slashCommands: the folder's, the user's, and the app's built-ins that run when typed) or the simulator;
   a demo chat has a few canned ones. Typing filters; ArrowUp/Down move; Tab or Enter put "/name " in the box; Esc closes the list only. */
var SLASH=window.DurbarSlash||null; /* var: openPanel can run before this line during start-up (restored chat) */
var SLASH_CACHE=new Map(); /* agent id -> {at, list, error} (30 s, FR-010) */
var SLASH_ROWS=8;
var DEMO_SLASH=[
  {name:'review',description:'Review the changes on this branch',argumentHint:'<focus>',source:'folder',kind:'command',where:'.claude/commands/review.md'},
  {name:'release-notes',description:'Draft release notes from the merged pull requests',source:'folder',kind:'skill',where:'.claude/skills/release-notes/SKILL.md'},
  {name:'explain',description:'Explain a file or function in plain words',argumentHint:'<path>',source:'user',kind:'command',where:'~/.claude/commands/explain.md'},
  {name:'compact',description:'Free up context by summarising the conversation so far',source:'app',kind:'builtin'},
];
var slashUi=null; /* {a, input, items, active, tok, el, loading} while the list is open */
function slashOf(a){
  if(!a||!SLASH)return null;
  if(!a.live)return {list:DEMO_SLASH};
  const r=liveRoot(a); if(!r||!r.info||!r.info.slash||!bridge.slashCommands)return null;
  return SLASH_CACHE.get(r.id)||null;
}
async function fetchSlash(a){
  const r=liveRoot(a); if(!r||!bridge.slashCommands)return;
  const cur=SLASH_CACHE.get(r.id); if(cur&&(cur.pending||Date.now()-cur.at<30000))return;
  SLASH_CACHE.set(r.id,{at:Date.now(),list:cur?cur.list:null,pending:true});
  let res=null;try{res=await bridge.slashCommands(r.id);}catch(e){res={ok:false,error:String(e&&e.message||e),entries:[]};}
  SLASH_CACHE.set(r.id,{at:Date.now(),list:res&&res.ok&&Array.isArray(res.entries)?res.entries:[],error:res&&!res.ok?res.error:null});
  if(slashUi&&liveRoot(slashUi.a)===r)slashUpdate(true);
}
function slashSupported(a){return !!(window.DurbarSlash&&a&&!a.parent&&(!a.live||(liveRoot(a).info&&liveRoot(a).info.slash&&bridge.slashCommands)));}
function initSlash(a,input){
  if(!slashSupported(a))return;
  input.setAttribute('role','combobox');input.setAttribute('aria-autocomplete','list');input.setAttribute('aria-expanded','false');input.setAttribute('aria-controls','slashList');
  input.addEventListener('keydown',e=>slashKey(e,a,input));
  input.addEventListener('input',()=>{if(!input.dataset.composing)slashUpdate();});
  input.addEventListener('compositionstart',()=>{input.dataset.composing='1';});
  input.addEventListener('compositionend',()=>{delete input.dataset.composing;slashUpdate();});
  input.addEventListener('click',()=>slashUpdate());
  input.addEventListener('keyup',e=>{if(e.key==='ArrowLeft'||e.key==='ArrowRight'||e.key==='Home'||e.key==='End')slashUpdate();});
  input.addEventListener('blur',()=>{setTimeout(()=>{if(slashUi&&document.activeElement!==slashUi.input)closeSlash();},0);});
}
function closeSlash(){
  const u=slashUi; slashUi=null;
  const el=document.getElementById('slashList'); if(el)el.remove();
  if(u&&u.input){u.input.setAttribute('aria-expanded','false');u.input.removeAttribute('aria-activedescendant');}
}
/* open, refilter or close the list for the word at the caret (FR-008) */
function slashUpdate(refetched){
  const input=$('msgInput'); const a=byId(ui.selected);
  if(!input||!a||!slashSupported(a)||input.dataset.composing){closeSlash();return;}
  const tok=SLASH.tokenAt(input.value,input.selectionStart);
  if(!tok||input.selectionStart!==input.selectionEnd){closeSlash();return;}
  if(a.live)fetchSlash(a);
  const src=slashOf(a), loading=!src||!src.list;
  const items=loading?[]:SLASH.filter(src.list,tok.query);
  const opening=!slashUi;
  const keep=slashUi&&slashUi.tok.query===tok.query&&slashUi.items[slashUi.active]?slashUi.items[slashUi.active].name:null; /* a new query starts at the first match */
  slashUi={a,input,items,tok,loading,active:Math.max(0,keep?items.findIndex(x=>x.name===keep):0)};
  if(slashUi.active<0)slashUi.active=0;
  drawSlash(src);
  if(opening||refetched)announce(loading?'Looking for commands…':items.length?items.length+(items.length===1?' command':' commands')+'. Arrow keys to choose, Tab to insert.':(tok.query?'No matching commands':'No commands for this agent app here'));
}
function drawSlash(src){
  const u=slashUi; if(!u)return;
  let el=document.getElementById('slashList');
  if(!el){el=document.createElement('div');el.id='slashList';el.className='mode-menu slash-list';el.setAttribute('role','listbox');
    el.addEventListener('mousedown',e=>e.preventDefault()); /* the box keeps the focus */
    el.addEventListener('click',e=>{const o=e.target.closest('[role="option"]');if(!o||!slashUi)return;slashUi.active=+o.dataset.i;slashPick();});
    document.body.appendChild(el);}
  const app=kindWord(liveRoot(u.a)&&liveRoot(u.a).info&&liveRoot(u.a).info.adapterId);
  el.setAttribute('aria-label',(u.a.live?app:'Demo')+' commands');
  const err=src&&src.error?`<p class="sl-empty" role="presentation">Could not list commands: ${esc(safeExcerpt(src.error,120,'unknown error'))}</p>`:''; /* FR-013: masked, then cut */
  el.innerHTML=u.loading?'<p class="sl-empty" role="presentation">Looking for commands…</p>'
    :u.items.length?u.items.map((x,i)=>SLASH.optionHtml(SLASH.view(x,safeMask),i,i===u.active,slashTip(x))).join('') /* masked (FR-013) and escaped in slashsuggest.js (FR-008) */
    :err||`<p class="sl-empty" role="presentation">${u.tok.query?'No matching commands':'No commands for this agent app here'}</p>`;
  u.input.setAttribute('aria-expanded','true');
  if(u.items.length)u.input.setAttribute('aria-activedescendant','slashOpt-'+u.active);else u.input.removeAttribute('aria-activedescendant');
  placeSlash(el,u.input);
  const act=document.getElementById('slashOpt-'+u.active); if(act)act.scrollIntoView({block:'nearest'});
}
/* FR-008 (review on PR 535): the row's tooltip has what an ellipsis may cut: the full name, the description and the place (a data
   tooltip, at most 300 characters); FR-013: each part masked (DurbarSafeText), then the whole cut */
function slashTip(x){return SLASH.tip(x,safeMask,DurbarCutText.cutText);}
/* a menu (--menu-w, design-rules.md) above the message box at its left edge, at most 8 rows (the rest scroll inside), never over the
   box (SC-003) */
function placeSlash(el,input){
  const box=input.closest('.inbox')||input, br=box.getBoundingClientRect(), panel=$('panel'), pr=panel?panel.getBoundingClientRect():{top:8};
  const row=el.querySelector('.sl-opt'), rh=row?row.getBoundingClientRect().height:40;
  const room=Math.max(rh+12,br.top-Math.max(8,pr.top)-12);
  el.style.maxHeight=Math.min(room,Math.ceil(rh*SLASH_ROWS+10))+'px'; /* 8 rows, the padding and the border */
  placeMenu(el,br.left,br.bottom+6,box);
}
function slashKey(e,a,input){
  if(!slashUi||e.isComposing)return;
  const u=slashUi, n=u.items.length;
  if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();closeSlash();return;}
  if(e.key==='ArrowDown'||e.key==='ArrowUp'){if(!n)return;e.preventDefault();e.stopImmediatePropagation();u.active=(u.active+(e.key==='ArrowDown'?1:n-1))%n;drawSlash(slashOf(a));return;}
  if((e.key==='Tab'&&!e.shiftKey&&!e.altKey&&!e.ctrlKey&&!e.metaKey)||(e.key==='Enter'&&!e.shiftKey&&!e.altKey&&!e.ctrlKey&&!e.metaKey)){
    if(!n){if(e.key==='Tab'){closeSlash();}return;} /* nothing to pick: Tab moves on, Enter sends as typed */
    e.preventDefault();e.stopImmediatePropagation();slashPick();
  }
}
function slashPick(){
  const u=slashUi; if(!u||!u.items[u.active])return;
  const end=u.tok.start+1+u.tok.query.length;
  const r=SLASH.insert(u.input.value,u.tok.start,end,u.items[u.active].name);
  u.input.value=r.value; u.input.setSelectionRange(r.caret,r.caret);
  closeSlash(); autoGrow(); u.input.focus({preventScroll:true});
  announce('Inserted /'+SLASH.view(u.items[u.active],safeMask).name); /* FR-013: the read-out name is masked too */
}
/* ---------------- spec 005 FR-037..FR-042: the composer toolbar and the one Send / Stop slot ----------------
   The chips that set how the next message runs sit in a row under the message box (VS Code style); the header keeps who and what.
   Same chip builders, ids, menus and handlers as before: only their place changed. */
const CT_IC={
  profile:'<svg class="cti" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8" cy="5.6" r="2.6"/><path d="M3 13.6c.6-2.6 2.6-4 5-4s4.4 1.4 5 4"/></svg>',
  model:'<svg class="cti" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="4" width="8" height="8" rx="1.6"/><path d="M6.5 1.8V4M9.5 1.8V4M6.5 12v2.2M9.5 12v2.2M1.8 6.5H4M1.8 9.5H4M12 6.5h2.2M12 9.5h2.2"/></svg>',
  mcp:'<svg class="cti" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 2v3M10 2v3M4.2 5h7.6v2.4a3.8 3.8 0 0 1-7.6 0zM8 11.2V14"/></svg>',
  send:'<svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 9h11M9.5 4.5L14 9l-4.5 4.5"/></svg>',
  stop:'<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><rect x="3.5" y="3.5" width="9" height="9" rx="2"/></svg>',
};
const STOP_TIP='Stop: interrupts this reply. The chat stays open and ready; nothing is removed.';
/* FR-038: Send while idle; Stop with a spinner left of it while a turn runs. Stop only where the app can interrupt (spec 012 FR-050). */
function runSlotHTML(a){
  const canStop=!(a.live&&!feat(liveRoot(a),'stop'));
  return `<div class="run-slot" id="runSlot"><button class="ib send" id="sendBtn" type="button" aria-label="Send message" title="Send (Enter)" aria-disabled="true">${CT_IC.send}</button><span class="run-spin" id="runSpin" aria-hidden="true" title="Working on a reply" hidden><i aria-hidden="true"></i></span>${canStop?`<button class="ib stop" id="stopBtn" type="button" aria-label="Stop" title="${esc(a.live?STOP_TIP:'Stop')}" hidden>${CT_IC.stop}</button>`:''}</div>`;
}
/* FR-037: left to right Profile, Mode, Model (with its window), Context, MCP, then the attachments; data-ct = overflow rank (FR-040, 1 goes first) */
function composerToolbarHTML(a,mdlName){
  const main=a.live&&a.info&&!a.parent, r=liveRoot(a);
  const it=(rank,html)=>html?`<span class="ct"${rank?` data-ct="${rank}"`:' data-keep="1"'}>${html}</span>`:'';
  return `<div class="ctoolbar" id="cToolbar" role="group" aria-label="Chat settings"><div class="ct-items" id="ctItems">`
    +it(3,main&&a.info.profiles&&bridge.listProfiles?agentChipHTML(a):'')
    +it(0,main&&bridge.setPermMode?modeChipHTML(a):'')
    +it(6,mdlName?(main&&bridge.setModel&&feat(a,'models')?modelChipHTML(a):`<span class="mchip" title="${esc(mdlName.title)}">${CT_IC.model}<span>${esc(mdlName.text)}</span></span>`):'')
    +it(2,a.live&&!a.parent&&window.DurbarStats?ctxChipHTML(r):'')
    +it(1,a.live&&!a.parent&&bridge.agentMcp&&feat(r,'mcp')?mcpChipHTML(r):'')
    +it(5,`<button class="ib ct-ib" id="attFile" type="button" aria-label="Attach file" title="Attach file">${ICON('file')}</button>`)
    +it(4,`<button class="ib ct-ib" id="attImg" type="button" aria-label="Attach image" title="Attach image">${ICON('img')}</button>`)
    +`</div><div class="ct-more"><button class="ib ct-ib" id="ctMoreBtn" type="button" aria-haspopup="true" aria-expanded="false" aria-controls="ctMorePop" aria-label="More chat settings" title="More chat settings" hidden>⋯</button><div class="ct-more-pop" id="ctMorePop" role="group" aria-label="More chat settings" hidden></div></div></div>`;
}
/* FR-037 item 5: the MCP chip: the icon and how many servers are switched on for this agent (the dialog is spec 019/058's) */
const MCP_N=new Map(), MCP_F=new Map(); /* per agent: servers switched on; servers failed or needing a sign-in (spec 058 FR-094) */
function mcpChipHTML(a){
  const n=MCP_N.get(a.id), known=typeof n==='number', f=MCP_F.get(a.id)||0;
  /* spec 058 FR-094 (issue 603): a dot in the error colour when a server failed, said in the name and tooltip too (never colour alone) */
  const failed=f?', '+f+' failed':'';
  const lab=known?'MCP servers: '+n+' on'+failed+'. Open the list':'MCP servers'+(f?': '+f+' failed':'')+'. Open the list';
  return `<button class="mchip mchip-btn${f?' mcp-failed':''}" id="mcpBtn" type="button" aria-label="${esc(lab)}" title="${f?esc('MCP servers for this agent: '+(known?n+' on, ':'')+f+' failed. Click to see why.'):`MCP servers for this agent${known?': '+n+' switched on':''}. Click to see or switch them (set globally in Settings).`}">${CT_IC.mcp}<span>MCP</span>${known?`<b class="ct-n">${n}</b>`:''}${f?'<i class="ct-dot" aria-hidden="true"></i>':''}</button>`;
}
async function refreshMcpCount(a){
  if(!a||!bridge.agentMcp||!ui.selected)return;
  {const cur=byId(ui.selected);if(!cur||liveRoot(cur)!==a||!$('mcpBtn'))return;} /* only for the open chat; opening a chat asks again */
  let st=null;try{st=await bridge.agentMcp(a.id);}catch(e){st=null;}
  if(!st||!st.ok)return;
  const n=(st.servers||[]).filter(x=>x.defaultOn&&!x.off).length;
  const f=(st.servers||[]).filter(x=>x.status==='failed'||x.status==='needs-auth').length;
  if(MCP_N.get(a.id)===n&&(MCP_F.get(a.id)||0)===f)return; MCP_N.set(a.id,n);MCP_F.set(a.id,f);
  const el=$('mcpBtn'),cur=ui.selected&&byId(ui.selected);if(!el||!cur||liveRoot(cur)!==a)return;
  const had=document.activeElement===el;el.outerHTML=mcpChipHTML(a);if(had){const f=$('mcpBtn');if(f)f.focus({preventScroll:true});}
}
const RUN_SAID={id:null,run:false,stopped:false}; /* spec 005 T074: what the live region last said about the open chat's turn */
/* FR-038: a turn runs (live: the same rule that greys Compact; demo: the canned turn plays) */
function runningNow(a){
  if(!a)return false;
  if(a.live)return busyNow(liveRoot(a)||a);
  const c=chats[a.id];return !!(c&&c.busy);
}
function syncRunState(){
  const a=byId(ui.selected), slot=$('runSlot'); if(!a||!slot)return;
  const t=$('msgInput'), run=runningNow(a), has=!!(t&&(t.value.trim()||attached.length));
  const stop=$('stopBtn'), spin=$('runSpin'), send=$('sendBtn');
  const set=(el,hide)=>{if(!el||el.hidden===hide)return;const had=hide&&document.activeElement===el;el.hidden=hide;if(had&&t)t.focus({preventScroll:true});}; /* a button that goes away hands focus to the message box */
  set(spin,!run); set(stop,!run);
  /* a live agent takes a message mid-turn (Enter sends, as before): then Send shows beside Stop; without Stop the slot keeps Send */
  set(send,run&&!!stop&&!(a.live&&has));
  if(slot.classList.contains('running')!==run)slot.classList.toggle('running',run);
  /* spec 005 T074 (review on PR 498): the spinner is decorative; a screen reader hears the change once through the shared live region.
     Only a change in the same chat speaks: opening a chat (or redrawing it) is not a turn starting or ending */
  const was=RUN_SAID.id===a.id?RUN_SAID.run:null; RUN_SAID.id=a.id; RUN_SAID.run=run;
  if(was!==null&&was!==run){announce(run?'Working…':RUN_SAID.stopped?'Stopped':'Reply finished');RUN_SAID.stopped=false;} /* a new turn forgets an earlier Stop */
}
/* the mode, model, profile and context menus: below their chip, or above it when the chip sits in the composer toolbar (FR-037); spec 073's "/" list too */
function placeMenu(m,x,y,anchor){
  const r=m.getBoundingClientRect();
  let py=y;
  if(anchor&&anchor.closest&&anchor.closest('#cToolbar,#panel .composer')&&document.contains(anchor)){const ar=anchor.getBoundingClientRect();py=ar.top-r.height-6;if(py<8)py=y;}
  const px=Math.max(8,Math.min(x,innerWidth-r.width-8));py=Math.max(8,Math.min(py,innerHeight-r.height-8));
  m.style.left=px+'px';m.style.top=py+'px';
  return {px,py};
}
/* FR-037 item 4: the context chip's menu: the used / size line, Compact (spec 030) and the Tools view (what the chip opened before) */
/* spec 005 FR-037 (2026-10-22): can the chip's popup act? Simple has no Tools item, so an agent that cannot compact gets an info-only popup */
function ctxCanCompact(a){const r=(a&&liveRoot(a))||a;return !!(r&&ctrlOf(r).compact&&bridge&&bridge.compact);}
function ctxHasActs(a){return !SIMPLE||ctxCanCompact(a);}
function closeCtxMenu(){const m=document.getElementById('ctxMenu');if(m){m.remove();const c=$('ctxChip');if(c)c.setAttribute('aria-expanded','false');}}
function openCtxMenu(a0,anchor){
  const a=liveRoot(a0); if(!a)return;
  closeCtxMenu();closeModeMenu();closeModelMenu();closeAgentMenu();
  const c=window.DurbarScreens.ctxChip(a), canC=ctxCanCompact(a), busy=busyNow(a), acts=ctxHasActs(a);
  const m=document.createElement('div');m.id='ctxMenu';m.className='mode-menu';m.setAttribute('role',acts?'menu':'dialog');m.setAttribute('aria-label',(SIMPLE?'Memory of ':'Context window of ')+a.name);
  m.innerHTML=`<p class="mm-h">${SIMPLE?'Memory':'Context window'}</p><p class="mm-info">${esc(SIMPLE?(c.cls==='unk'?'Not known yet. It shows after the first message.':'The agent’s memory of this conversation is '+c.pct+'% full.'):c.title)}</p>`
    +(canC?`<button type="button" role="menuitem" id="compactBtn" class="mm-compact"${busy?' aria-disabled="true"':''}><span class="mt"><b>${SIMPLE?'Tidy up memory':'Compact'}</b><small>${esc(busy?(SIMPLE?'The agent is busy. Tidy up when it is idle.':'The agent is busy. Compact when it is idle.'):(SIMPLE?'Summarise so the agent has room. One model call.':'Summarise to free space. Costs one model call.'))}</small></span></button>`:'')
    +(SIMPLE?'':`<button type="button" role="menuitem" data-act="ctxTools"><span class="mt"><b>Models and context of all agents</b><small>The Tools view</small></span></button>`);
  if(!acts)m.tabIndex=-1; /* info only (Simple, cannot compact): the line itself, Escape closes back to the chip */
  document.body.appendChild(m);
  const r=anchor.getBoundingClientRect();placeMenu(m,r.left,r.bottom+6,anchor);
  anchor.setAttribute('aria-expanded','true');
  m.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;e.stopPropagation();
    if(b.getAttribute('aria-disabled')==='true')return;
    closeCtxMenu();
    if(b.id==='compactBtn')compactDialog(a,$('ctxChip')||anchor);
    else if(b.dataset.act==='ctxTools')window.DurbarScreens.openTools(null,'agents');});
  m.addEventListener('keydown',e=>{const it=[...m.querySelectorAll('button')],i=it.indexOf(document.activeElement);
    if(!it.length&&(e.key==='ArrowDown'||e.key==='ArrowUp')){e.preventDefault();}
    else if(e.key==='ArrowDown'){e.preventDefault();it[(i+1)%it.length].focus();}else if(e.key==='ArrowUp'){e.preventDefault();it[(i+it.length-1)%it.length].focus();}
    else if(e.key==='Escape'||e.key==='Tab'){e.preventDefault();e.stopPropagation();closeCtxMenu();const t=$('ctxChip')||anchor;if(t&&t.focus&&document.contains(t))t.focus();}});
  (m.querySelector('button')||m).focus();
}
/* FR-040: one row always. Controls that do not fit go, by rank, into the "⋯" popover (same nodes, ids and handlers); the mode never does. */
let ctFitting=false;
function fitToolbar(){
  const bar=$('cToolbar'),row=$('ctItems'),pop=$('ctMorePop'),more=$('ctMoreBtn'); if(!bar||!row||!pop||!more)return;
  if(!bar.getClientRects().length||!pop.hidden)return; /* not while the popover is open: it refits when it closes */
  /* the common case: nothing in ⋯ and the row fits: no DOM change (a chip's text updates often) */
  if(!pop.querySelector('.ct')&&row.scrollWidth<=row.clientWidth+1){if(!more.hidden)more.hidden=true;return;}
  ctFitting=true;
  const ae=document.activeElement; /* moving a node drops its focus: put it back */
  try{
    const all=[...bar.querySelectorAll('.ct')].sort((p,q)=>(+p.dataset.pos)-(+q.dataset.pos));
    all.forEach(n=>{if(n.parentNode!==row)row.appendChild(n);});
    all.forEach(n=>row.appendChild(n)); /* the canonical order */
    more.hidden=true;
    const fits=()=>row.scrollWidth<=row.clientWidth+1;
    if(!fits()){
      more.hidden=false;
      const out=all.filter(n=>n.dataset.ct).sort((p,q)=>(+p.dataset.ct)-(+q.dataset.ct));
      for(const n of out){if(fits())break;if(!n.offsetWidth)continue;pop.appendChild(n);} /* one Simple hides is not moved */
      [...pop.children].sort((p,q)=>(+p.dataset.pos)-(+q.dataset.pos)).forEach(n=>pop.appendChild(n));
    }
    if(!pop.querySelector('.ct')){more.hidden=true;}
  }finally{if(ctObs)ctObs.mut.takeRecords();ctFitting=false;if(ae&&ae!==document.activeElement&&document.contains(ae)&&ae.getClientRects().length)ae.focus({preventScroll:true});}
}
let ctObs=null;
function closeCtMore(back){const pop=$('ctMorePop'),b=$('ctMoreBtn');if(!pop||pop.hidden)return;pop.hidden=true;if(b)b.setAttribute('aria-expanded','false');document.removeEventListener('mousedown',ctOutside,true);if(back&&b)b.focus();requestAnimationFrame(fitToolbar);}
function ctOutside(e){const pop=$('ctMorePop'),b=$('ctMoreBtn');if(!pop)return;const t=e.target;
  if(pop.contains(t)||(b&&b.contains(t))||(t.closest&&t.closest('#modeMenu,#modelMenu,#agentMenu,#ctxMenu,.dlg-ov,[role="dialog"]')))return;closeCtMore(false);}
function wireToolbar(){
  if(ctObs){ctObs.res.disconnect();ctObs.mut.disconnect();ctObs=null;}
  const bar=$('cToolbar'); if(!bar)return;
  [...bar.querySelectorAll('.ct')].forEach((n,i)=>{n.dataset.pos=String(i);});
  const more=$('ctMoreBtn'),pop=$('ctMorePop');
  more.onclick=()=>{if(!pop.hidden){closeCtMore(true);return;}pop.hidden=false;more.setAttribute('aria-expanded','true');document.addEventListener('mousedown',ctOutside,true);const f=pop.querySelector('button:not([hidden])');if(f)f.focus();};
  pop.onkeydown=e=>{if(e.key==='Escape'&&!document.querySelector('#modeMenu,#modelMenu,#agentMenu,#ctxMenu')){e.preventDefault();e.stopPropagation();closeCtMore(true);}};
  let raf=0;const later=()=>{if(ctFitting||raf)return;raf=requestAnimationFrame(()=>{raf=0;fitToolbar();});};
  const res=new ResizeObserver(later);res.observe(bar);bar.querySelectorAll('.ct').forEach(n=>res.observe(n)); /* a chip that grows, or shows in Simple */
  const mut=new MutationObserver(()=>{if(!ctFitting)later();});mut.observe(bar,{childList:true,subtree:true,characterData:true});
  ctObs={res,mut};
  fitToolbar();
}
function closePanel(){closeSlash();keepDraft();
  if(ctObs){ctObs.res.disconnect();ctObs.mut.disconnect();ctObs=null;} closeCtMore(false); closeCtxMenu();
  const id=ui.selected; ui.selected=null; document.body.classList.remove('panel-open'); $('panel').innerHTML='';
  renderAll();
  const n=id&&document.querySelector(`[data-id="${CSS.escape(id)}"]`); if(n)n.focus();
}

/* ---------------- events ---------------- */
document.addEventListener('click',e=>{
  /* markdown links: only http(s) leaves the app, through the system browser (main re-checks the URL) */
  const lk=e.target.closest('.md a');
  if(lk){e.preventDefault();const u=lk.getAttribute('href')||'';
    if(/^https?:\/\//i.test(u)){if(bridge&&bridge.openExternal)bridge.openExternal(u);else toast('Would open <code>'+esc(SHORT(u,80))+'</code> in your browser',3200);}
    return;}
  const cp=e.target.closest('.codebox .copy');
  if(cp){const code=cp.parentNode.querySelector('code');const txt=code?code.textContent:'';
    const done=()=>copiedLabel(cp);
    if(navigator.clipboard&&navigator.clipboard.writeText)navigator.clipboard.writeText(txt).then(done,()=>toast('Could not copy.').classList.add('err'));else{const ta=document.createElement('textarea');ta.value=txt;document.body.appendChild(ta);ta.select();try{document.execCommand('copy');done();}catch(_){toast('Could not copy.').classList.add('err');}ta.remove();}
    return;}
  const so=e.target.closest('.sub-open');
  if(so){const blk=so.closest('.subblk'),id=blk&&blk.dataset.sub,par=ui.selected&&byId(ui.selected),card=par&&liveById(par.id+':'+id);if(card)openPanel(card.id,false);return;}
  const pc=e.target.closest('[data-parentchat]');
  if(pc){const cur=byId(ui.selected);if(cur&&cur.parent)openPanel(cur.parent,false);return;}
  const dset=e.target.closest('[data-doorset]'); if(dset){toggleDoor(dset.dataset.doorset,dset);return;} /* spec 017 FR-015: before the desk's own click */
  const dr=e.target.closest('[data-door]'); if(dr){const r=ROOMS.find(x=>x.id===dr.dataset.door);if(r)setRoomClosed(r,!r.closed);return;}
  if(e.target.closest('#closeAll,#openAll')){const shut=!!e.target.closest('#closeAll');
    ROOMS.filter(r=>roomShown(r)&&(ui.ws==='all'||ui.ws===r.id)&&agents.some(a=>!a.parent&&a.room===r.id)).forEach(r=>setRoomClosed(r,shut,true));
    layoutKey='';renderAll();return;}
  const st=e.target.closest('.stat[data-k]'); if(st){const k=st.dataset.k;ui.status=ui.status===k?null:k;renderAll();const n=document.querySelector(`.stat[data-k="${k}"]`);if(n)n.focus();return;}
  const mo=e.target.closest('[data-more]'); if(mo){const id=mo.dataset.more;ui.expanded[id]=!ui.expanded[id];renderAll();return;}
  const cm=e.target.closest('.chips-more'); if(cm){const box=cm.parentNode;box.dataset.exp=box.dataset.exp==='1'?'0':'1';refreshChips(box);return;}
  const chip=e.target.closest('#chat .chip:not(.att-chip)'); if(chip){if(e.target.closest('.xbody'))return;const o=chip.classList.toggle('open');chip.setAttribute('aria-expanded',String(o));return;} /* spec 052 FR-063: the open body (Copy, Show all, selecting text) keeps it open */
  const sw=e.target.closest('[data-sw]'); if(sw){openPanel(sw.dataset.sw,true);return;} /* spec 074 FR-019: mouse or keyboard */
  if(e.target.closest('[data-costview]')){window.DurbarScreens.openTools(null,'cost');return;}
  const mr=e.target.closest('[data-mcproom]'); if(mr){const f=folderOfRoom(mr.dataset.mcproom);if(f)window.DurbarScreens.folderMcp(f.key,f.name);return;}
  const sc=e.target.closest('[data-schedroom]'); if(sc){const r=ROOMS.find(x=>x.id===sc.dataset.schedroom);if(r)openSchedules(r);return;}
  const fm=e.target.closest('[data-foldermenu]'); if(fm){const r=ROOMS.find(x=>x.id===fm.dataset.foldermenu),b=fm.getBoundingClientRect();openFolderMenu(r,b.left,b.bottom+4,fm);return;}
  const ns=e.target.closest('[data-newsess]'); if(ns){const r=ROOMS.find(x=>x.id===ns.dataset.newsess),ag=r&&agents.find(x=>!x.parent&&x.room===r.id);if(ag)newSession(ag);return;}
  const t=e.target.closest('[data-id]'); if(t&&!t.closest('#panel')){openPanel(t.dataset.id,true);} /* spec 074 FR-019: mouse or keyboard, desk or list row */
});
/* a file dropped anywhere else must not navigate the window away */
['dragover','drop'].forEach(t=>window.addEventListener(t,e=>{if(e.dataTransfer&&[...(e.dataTransfer.types||[])].includes('Files'))e.preventDefault();}));
/* spec 052 FR-175 / spec 074 FR-025 (review on PR 597): "a dialog is open" for the global shortcuts = any modal element, the app's
   confirmations too (askDialog in dialog.js is role="alertdialog", which a role="dialog" check missed). One helper, not copies. */
const MODAL_SEL='[aria-modal="true"]', modalOpen=()=>!!document.querySelector(MODAL_SEL);
document.addEventListener('keydown',e=>{
  /* spec 052 FR-035: Ctrl+Shift+A (attention: the inbox) and Ctrl+Shift+N (next agent) work everywhere, also in text fields and in a
     screen reader's browse mode, where single letters are taken. Not Ctrl+Shift+I: Electron's default menu opens DevTools there. */
  /* spec 052 FR-042: Ctrl+K (⌘K on a Mac, FR-084) opens the command palette from anywhere, also from text fields */
  const mod=KEYS.modDown(e,IS_MAC);
  /* spec 074 FR-002: the navigator shortcut (Settings > Keyboard; default Ctrl+F, ⌘F on a Mac) opens the palette in Go-to mode from
     anywhere, text fields included, but not over another dialog that asks something (the ? sheet is closed like for Ctrl+K) */
  if(!navRecording&&NAV.comboMatches(e,NAV_KEY,IS_MAC)){
    if(![...document.querySelectorAll(MODAL_SEL)].some(d=>!d.closest('#palDlg,#kbdDlg'))){e.preventDefault();closeKbdHelp();openPalette({nav:true});}
    return;
  }
  if(mod&&!e.shiftKey&&!e.altKey&&(e.key==='k'||e.key==='K'||e.code==='KeyK')){e.preventDefault();closeKbdHelp();openPalette();return;}
  /* spec 052 FR-164: Ctrl+O adds a folder, Ctrl+Shift+O a VS Code workspace (the same buttons, so the same code path). On a Mac the
     File menu owns ⌘O / ⇧⌘O, so this handler stays out of the way there. Not under a dialog, and only with the app's bridge (the
     page without it has no add buttons). Like the Mac menu it also works from an open chat and in Simple. */
  if(!IS_MAC&&mod&&!e.altKey&&(e.key==='o'||e.key==='O'||e.code==='KeyO')&&document.body.classList.contains('has-bridge')&&!modalOpen()){const b=$(e.shiftKey?'addWs':'addFolder');if(b&&!b.disabled){e.preventDefault();b.click();}return;}
  /* spec 052 FR-091: Ctrl+` goes back to the previous chat (and again, back). Control also on a Mac: Cmd+` switches windows there. Not under a dialog. */
  if(e.ctrlKey&&!e.metaKey&&!e.shiftKey&&!e.altKey&&e.code==='Backquote'&&!modalOpen()){e.preventDefault();openPreviousChat();return;}
  if(mod&&e.shiftKey&&!e.altKey&&(e.key==='A'||e.key==='a'||e.code==='KeyA')){e.preventDefault();openInbox();return;}
  /* spec 074 FR-020 / FR-021 (issue 587): Ctrl+A (⌘A) opens Needs you and Ctrl+Backspace (⌘⌫) goes back to the office, only outside
     text: never in an editable field (even an empty one), with text selected or under a dialog, and Ctrl+A not in the chat log.
     Everywhere else they select all and delete as always, so a half-written prompt is never lost. */
  if(mod){
    const ed=el=>!!el&&el.nodeType===1&&(el.matches('input,textarea,select,[contenteditable]:not([contenteditable="false"])')||!!el.isContentEditable);
    const tsk=NAV.textSafeKey(e,IS_MAC,{editable:ed(e.target)||ed(document.activeElement),log:!!(e.target&&e.target.closest&&e.target.closest('#chat')),
      selected:String((window.getSelection&&window.getSelection())||'').length>0,dialog:modalOpen()});
    if(tsk==='inbox'){e.preventDefault();openInbox();return;}
    if(tsk==='office'&&(ui.selected||vsViewing)){e.preventDefault();if(vsViewing)leaveVsView();if(ui.selected)closePanel();return;}
  }
  /* spec 006 FR-036: Ctrl+Shift+H (⇧⌘H) shows or hides Previous sessions in the open chat, also from the message box; not under a dialog */
  if(mod&&e.shiftKey&&!e.altKey&&e.code==='KeyH'&&ui.selected&&$('prevBtn')&&!modalOpen()){e.preventDefault();togglePrevByKey();return;}
  if(mod&&e.shiftKey&&!e.altKey&&(e.key==='N'||e.key==='n'||e.code==='KeyN')){e.preventDefault();closeInbox();openNextNeedsMe();return;}
  /* spec 052 FR-060: in an open chat, Alt+A allow once, Alt+S allow for this session, Alt+D deny (the request the answer bar shows), Alt+N the
     next agent that needs you. By the key's position (e.code). On a Mac it is Option+Command (FR-084): Option+letter alone types accents
     or dead keys there. Not while you type in a field with text, and not under a dialog. Windows and Linux have no app menu (FR-083). */
  if(KEYS.chatKeyDown(e,IS_MAC)&&/^Key[ASDN]$/.test(e.code)&&ui.selected&&$('panel')&&!modalOpen()){
    const t=e.target, typing=t&&t.matches&&t.matches('input,textarea,[contenteditable="true"]')&&String((t.value!=null?t.value:t.textContent)||'').length>0;
    if(!typing){const k=e.code.slice(3);
      if(k==='N'){e.preventDefault();openNextNeedsMe();return;}
      if(answerObs&&answerObs.answerKey&&answerObs.answerKey(k)){e.preventDefault();return;}}
  }
  if(e.key==='Escape'){
    if($('inboxDlg')){closeInbox();return;}
    if(e.target&&e.target.id==='prevQ'&&e.target.value){e.target.value='';e.target.dispatchEvent(new Event('input',{bubbles:true}));return;} /* spec 006 FR-023: Escape clears the search first */
    if(window.DurbarScreens&&window.DurbarScreens.isOpen()&&!document.getElementById('scrDlg')&&!document.getElementById('modeDlg')){window.DurbarScreens.close();return;}
    if(document.getElementById('sessDlg')){closeSessDlg();return;}
    if(!$('foldersPop').hidden){toggleFolders(false);return;}
    if(!$('floorsPop').hidden){toggleFloors(false);return;}
    if(vsViewing){leaveVsView();return;}
    if(ui.selected){closePanel();return;}
  }
  if((e.key==='Enter'||e.key===' ')&&e.target.matches&&e.target.matches('#chat .chip:not(.att-chip)')){e.preventDefault();e.target.click();}
  /* spec 052 FR-064: in the list, J/K (and ↓/↑) move between rows; Enter opens the chat (the row is a button). The inbox has its own J/K. */
  if(!e.altKey&&!e.ctrlKey&&!e.metaKey&&!e.shiftKey&&!e.isComposing&&e.target.matches&&e.target.matches('#list button.lrow, #list .lsort')&&/^(j|k|J|K|ArrowDown|ArrowUp)$/.test(e.key)){
    const rows=[...document.querySelectorAll('#list button.lrow')], i=rows.indexOf(e.target), down=/^(j|J|ArrowDown)$/.test(e.key);
    const n=i<0?(down?rows[0]:null):rows[Math.max(0,Math.min(rows.length-1,i+(down?1:-1)))];
    if(n){e.preventDefault();n.focus();n.scrollIntoView({block:'nearest'});}
    return;
  }
  /* spec 052 FR-014: N opens the next agent that needs you (waiting, error or at its limit), outside text fields and dialogs */
  if((e.key==='i'||e.key==='I')&&!e.altKey&&!e.ctrlKey&&!e.metaKey&&!e.isComposing&&!(e.target&&e.target.closest&&e.target.closest('input,textarea,select,[contenteditable="true"],[role="dialog"],[role="menu"]'))&&!modalOpen()){e.preventDefault();openInbox();return;}
  /* spec 052 FR-043: ? opens the keyboard shortcut sheet, outside text fields and dialogs */
  if(e.key==='?'&&!e.altKey&&!e.ctrlKey&&!e.metaKey&&!e.isComposing&&!(e.target&&e.target.closest&&e.target.closest('input,textarea,select,[contenteditable="true"],[role="dialog"],[role="menu"]'))&&!modalOpen()){e.preventDefault();openKbdHelp();return;}
  if((e.key==='n'||e.key==='N')&&!e.altKey&&!e.ctrlKey&&!e.metaKey&&!e.isComposing&&!(e.target&&e.target.closest&&e.target.closest('input,textarea,select,[contenteditable="true"],[role="dialog"],[role="menu"]'))&&!modalOpen()){e.preventDefault();openNextNeedsMe();return;}
  /* spec 001 FR-019: arrow keys move between desks, helpers and door plates; left/right in reading order, up/down to the nearest one in that direction */
  if(/^Arrow(Left|Right|Up|Down)$/.test(e.key)&&!e.altKey&&!e.ctrlKey&&!e.metaKey&&!e.shiftKey&&e.target.matches&&e.target.matches(DESK_NAV)){
    const all=[...document.querySelectorAll(DESK_NAV)].filter(x=>x.getClientRects().length), i=all.indexOf(e.target);
    let next=null;
    if(e.key==='ArrowRight'||e.key==='ArrowLeft'){
      /* the nearest one on the same row in that direction; at the end of a row, the next or previous one in reading order */
      const r=e.target.getBoundingClientRect(),cy=(r.top+r.bottom)/2,right=e.key==='ArrowRight';let bd=Infinity;
      for(const x of all){if(x===e.target)continue;const q=x.getBoundingClientRect();if(cy<q.top||cy>q.bottom)continue;
        const dx=right?q.left-r.right:r.left-q.right;if(dx<-2)continue;if(dx<bd){bd=dx;next=x;}}
      if(!next)next=right?all[i+1]||null:(i>0?all[i-1]:null);
    }
    else{
      const r=e.target.getBoundingClientRect(),cx=(r.left+r.right)/2,down=e.key==='ArrowDown';let bd=Infinity;
      for(const x of all){if(x===e.target)continue;const q=x.getBoundingClientRect(),dy=down?q.top-r.bottom:r.top-q.bottom;if(dy<-2)continue;
        const d=dy*3+Math.abs((q.left+q.right)/2-cx);if(d<bd){bd=d;next=x;}}
    }
    if(next){e.preventDefault();next.focus();next.scrollIntoView({block:'nearest',inline:'nearest'});}
  }
});
/* spec 052 FR-015: folders restored in Allow all, named in a strip under the top bar, with a one-click way back to Ask first. Counts folders. */
function renderRestoreStrip(){
  const el=$('restoreStrip'); if(!el)return;
  const ags=agents.filter(a=>a.live&&!a.parent&&a.info&&a.info.permMode==='allow'&&a.info.permRestored);
  const rooms=[...new Map(ags.map(a=>[roomOf(a).id,roomOf(a)])).values()];
  if(!rooms.length||el.dataset.kept==='1'){el.hidden=true;el.innerHTML='';return;}
  /* spec 052 FR-057 (round 5): what it means, in the same words in Simple and Expert; "Ask first" stays the mode's name in menus */
  el.innerHTML='<span class="ns-ic" aria-hidden="true">!</span><span class="ns-t"></span><span class="ns-act"><button class="btn primary" type="button" data-ns="ask">Make it ask me first</button><button class="btn" type="button" data-ns="keep">Keep as it is</button></span>';
  const names=rooms.map(r=>r.name).join(', ');
  el.querySelector('.ns-t').textContent=rooms.length===1?'One folder ('+names+') lets agents change files without asking.':rooms.length+' folders ('+names+') let agents change files without asking.';
  el.hidden=false;
  el.querySelector('[data-ns="keep"]').onclick=()=>{el.dataset.kept='1';renderRestoreStrip();scheduleRender();};
  el.querySelector('[data-ns="ask"]').onclick=async()=>{
    const bad=[];
    for(const a of ags){const r=await bridge.setPermMode(a.id,'ask',{}).catch(e=>({ok:false,error:String(e&&e.message||e)}));if(r&&r.ok){a.info.permMode='ask';a.info.permRestored=undefined;a.role=roleFor(a.info);}else bad.push(a.name);}
    toast(bad.length?'Could not switch '+esc(bad.join(', '))+'.':(ags.length>1?ags.length+' sessions are':'The session is')+' on <b>Ask first</b> from the next request.',4200).classList.add(bad.length?'err':'ok');
    renderRestoreStrip();if(ui.selected)updatePanelHeader();scheduleRender();
  };
  scheduleRender();
}
/* spec 052 FR-014: the agents that need you, and the next one after the open chat.
   FR-061: oldest first, by when each started needing you (a pending permission's arrival time when the mood tracker has it, else when this
   page first saw it need you); a tie keeps office order (desks on screen first, then the rest). */
const needsMe=a=>!!a&&!a.parent&&(vis(a)==='waiting'||vis(a)==='error'||!!a.limit);
const NEED_SINCE=new Map();
const ATT=window.DurbarAttention;
function needsMeOrder(){
  const ids=[...document.querySelectorAll('#stage .desk[data-id]')].map(d=>d.dataset.id);
  const list=[...ids,...agents.map(a=>a.id).filter(id=>!ids.includes(id))].map(byId).filter(needsMe), now=Date.now(), live=new Set();
  for(const a of list){live.add(a.id);if(!NEED_SINCE.has(a.id)){const w=MOOD.waitingMs(a.id);NEED_SINCE.set(a.id,w>0?now-w:now);}}
  for(const id of [...NEED_SINCE.keys()])if(!live.has(id))NEED_SINCE.delete(id);
  return ATT.sortOldestFirst(list,a=>NEED_SINCE.get(a.id));
}
/* spec 052 FR-059: "needs you" outside the window: the title "(3) Agent Durbar", the app icon badge (or a taskbar flash on Windows) and one
   coalesced OS notification for new items while the window is in the background. Off in the demo unless turned on; nothing that was already
   waiting at startup. A notification says only the agent's name and its request's summary line (at most 80 characters), never file contents. */
let NOTIFY=false, ATT_ARMED=false, attCount=-1, attTimer=0;
const NOTIFIER=ATT.createNotifier();
const cardKey=new WeakMap();let cardSeq=0;
function attentionItems(list,withText){
  return list.map(a=>{
    const card=a.live||chats[a.id]?pendingCardOf(a):null; /* never build a demo chat just to look */
    if(card&&!cardKey.has(card))cardKey.set(card,++cardSeq);
    const kind=card?(card.classList.contains('question')?'q':card.classList.contains('limit')?'l':card.classList.contains('coffee')?'c':'p'):(vis(a)==='error'?'e':a.limit?'l':'w');
    /* the OS notification never carries the request itself (a command can hold a token, and it would sit on the lock screen and in the
       notification history): only what kind of answer is needed (security review, 2026-10-20) */
    const text=!withText?'':kind==='q'?'Has a question for you.':kind==='p'?'Asks for your OK.':kind==='e'?'Has an error. Please check it.':kind==='l'?'Reached its spending limit.':kind==='c'?(DurbarCutText.cutText(coffeeTask(a),70)+'.'):'Waiting for you.';
    return {key:a.id+'|'+kind+'|'+(card?cardKey.get(card):''),id:a.id,name:a.name,text};
  });
}
function syncAttention(list){
  const n=list.length;
  if(n!==attCount){
    attCount=n;document.title=ATT.titleFor(n);
    if(bridge&&bridge.setBadge)bridge.setBadge(demoOn?0:n).catch(()=>{});
  }
  const focused=document.hasFocus(), enabled=NOTIFY&&!demoOn&&typeof Notification==='function';
  NOTIFIER.observe(attentionItems(list,ATT_ARMED&&enabled&&!focused),{armed:ATT_ARMED,enabled,focused});
  const due=NOTIFIER.dueAt();
  if(due!=null&&!attTimer)attTimer=setTimeout(()=>{attTimer=0;showAttention();},Math.max(0,due-Date.now()));
}
function showAttention(){
  syncAttention(needsMeOrder()); /* drop what was answered meanwhile, and what you saw by coming back */
  const n=NOTIFIER.take(); if(!n)return;
  try{
    const note=new Notification(n.title,{body:n.body});
    note.onclick=()=>{try{window.focus();}catch(e){}if(bridge&&bridge.focusWindow)bridge.focusWindow().catch(()=>{});closeKbdHelp();openInbox(n.id);try{note.close();}catch(e){}};
  }catch(e){/* notifications not available here: the title and the badge still show the count */}
}
window.addEventListener('focus',()=>{if(attCount>0)syncAttention(needsMeOrder());});
/* spec 052 FR-027 (#305): the Needs you inbox. One queue of every agent that needs you, oldest first; each row holds its request in full
   and the same choices as its card (the buttons press the card's own buttons; the wide grant stays in the chat). */
function renderInboxBtn(){
  const b=$('inboxBtn'); if(!b)return;
  const list=needsMeOrder(), n=list.length;
  syncAttention(list);
  b.hidden=!agents.length; b.classList.toggle('attn',n>0);
  rollCount(b.querySelector('b'),n);
  b.setAttribute('aria-label',n?n+(n===1?' agent needs':' agents need')+' you. Open the inbox (I or '+INBOX_KEY+').':'Nobody needs you. Open the inbox (I or '+INBOX_KEY+').');
}
/* Settings > Schedules (spec 044 FR-011): the Settings screen, scrolled to its Schedules section */
function openSchedSettings(){window.DurbarScreens.openSettings('schedules');} /* spec 001 FR-038, spec 052 FR-055: scrollInBody inside screens.js */
/* spec 052 FR-068: the count rolls (old number out, new one in, 220ms) inside a box that keeps its width; up when it grows */
function rollCount(box,n){
  if(!box)return; const txt=String(n), prev=box.dataset.n;
  if(prev===txt)return; box.dataset.n=txt; clearTimeout(box._roll);
  if(prev==null||reducedMotion()||!box.getClientRects().length){box.textContent=txt;return;}
  const dir=Number(txt)>Number(prev)?'up':'down', inn=document.createElement('span'), out=document.createElement('span');
  inn.className='roll-in '+dir;inn.textContent=txt;out.className='roll-out '+dir;out.textContent=prev;out.setAttribute('aria-hidden','true');
  box.replaceChildren(inn,out);
  box._roll=setTimeout(()=>{if(box.dataset.n===txt)box.textContent=txt;},260);
}
function pendingCardOf(a){const c=getChat(a);const all=[...c.el.querySelectorAll('.note.perm:not(.settled)')].filter(n=>n.querySelector(':scope > .note-actions button'));return all[0]||null;}
/* spec 052 FR-048: focus goes back to where it was when the inbox opened (still in the page and shown), else to the inbox button */
let inboxBack=null;
let inboxTick=0;
function closeInbox(){clearInterval(inboxTick);inboxTick=0;const d=$('inboxDlg');if(!d)return;d.remove();const back=inboxBack;inboxBack=null;
  const b=back&&back.isConnected&&back.getClientRects().length&&!back.disabled?back:$('inboxBtn');if(b&&b.getClientRects().length)b.focus();}
/* spec 052 FR-034: one polite live region for requests and answers (screen readers hear them; nothing visible changes) */
let announceT=0;
function announce(text){const el=$('srAnnounce');if(!el||!text)return;clearTimeout(announceT);el.textContent='';announceT=setTimeout(()=>{el.textContent=String(text).slice(0,300);},60);}
function openInbox(focusId){
  const back=$('inboxDlg')?inboxBack:document.activeElement;
  closeInbox(); inboxBack=back&&back!==document.body?back:null;
  const d=document.createElement('div');d.id='inboxDlg';d.className='dlg-ov';
  d.innerHTML='<div class="dlg l inbox-dlg" role="dialog" aria-modal="true" aria-labelledby="inboxT" aria-describedby="inboxKeys"><h3 id="inboxT">Needs you</h3><div class="dbody" id="inboxBody"></div><p class="inbox-keys" id="inboxKeys"'+(SIMPLE?' hidden':'')+'>Keys: J/K move · A allow · S session · D deny · O open</p><div class="dbtn"><button class="btn" type="button" id="inboxClose">Close</button></div></div>';
  document.body.appendChild(d);
  d.addEventListener('click',e=>{if(e.target===d)closeInbox();});
  d.addEventListener('keydown',inboxKey);
  $('inboxClose').onclick=closeInbox;
  /* FR-059: a notification opens the inbox on its agent's row */
  const at=typeof focusId==='string'?needsMeOrder().findIndex(a=>a.id===focusId):-1;
  paintInbox(at>0?at:0);
  /* FR-061: the wait times follow the clock while the inbox is open; every 30 s, labels only (focus and rows stay) */
  inboxTick=setInterval(()=>{const b=$('inboxBody');if(!b){clearInterval(inboxTick);inboxTick=0;return;}b.querySelectorAll('.inbox-row[data-id]').forEach(r=>{const w=r.querySelector('.ib-wait'),t=NEED_SINCE.get(r.dataset.id);if(w&&t!=null)w.textContent='· '+ATT.waitLabel(Date.now()-t);});},30000);
}
/* FR-033: keys inside the inbox act on the row that holds focus; Tab stays inside the dialog */
function inboxKey(e){
  const d=$('inboxDlg'); if(!d)return;
  if(e.key==='Escape'){e.preventDefault();e.stopPropagation();closeInbox();return;}
  if(e.key==='Tab'){const f=[...d.querySelectorAll('button,summary,[tabindex="-1"].ib-h,input')].filter(x=>x.getClientRects().length);if(!f.length)return;const i=f.indexOf(document.activeElement);if(e.shiftKey&&(i<=0)){e.preventDefault();f[f.length-1].focus();}else if(!e.shiftKey&&i===f.length-1){e.preventDefault();f[0].focus();}return;}
  if(e.altKey||e.ctrlKey||e.metaKey)return;
  const rows=[...d.querySelectorAll('.inbox-row')], row=document.activeElement&&document.activeElement.closest('.inbox-row'), ri=rows.indexOf(row);
  const go=i=>{const r=rows[Math.max(0,Math.min(rows.length-1,i))];if(r)r.querySelector('.ib-h').focus();};
  const k=e.key.toLowerCase();
  if(k==='j'||e.key==='ArrowDown'){e.preventDefault();go(ri+1);return;}
  if(k==='k'||e.key==='ArrowUp'){e.preventDefault();go(ri<0?0:ri-1);return;}
  if(!row)return;
  const act=x=>{const b=row.querySelector(`[data-k="${x}"]`);if(b){e.preventDefault();b.click();}};
  if(k==='a')act('approve');else if(k==='d')act('deny');else if(k==='s')act('session');
  else if(k==='o'||(e.key==='Enter'&&document.activeElement.classList.contains('ib-h'))){e.preventDefault();row.querySelector('[data-k="open"]').click();}
}
/* spec 052 FR-068: after an answered row has faded (180ms), the list repaints and the rows that moved slide up into place
   (FLIP: measure each row by agent before and after, start it at the old offset, animate the offset to 0 in 200ms) */
function flipInbox(paint){
  const body=$('inboxBody'); if(!body||reducedMotion())return paint();
  const before=new Map([...body.querySelectorAll('.inbox-row[data-id]:not(.gone)')].map(r=>[r.dataset.id,r.getBoundingClientRect().top]));
  paint();
  body.querySelectorAll('.inbox-row[data-id]').forEach(r=>{const t=before.get(r.dataset.id);if(t==null)return;const dy=t-r.getBoundingClientRect().top;
    if(Math.abs(dy)>=1)motion(r,[{transform:`translateY(${dy}px)`},{transform:'none'}],{duration:200,easing:'ease-out'});});
}
function paintInbox(focusIndex){
  const body=$('inboxBody'); if(!body)return;
  const list=needsMeOrder();
  body.innerHTML=list.length?'':'<p class="inbox-empty" tabindex="-1"><span class="ib-ok" aria-hidden="true"></span><span><b>All clear. Nobody needs you right now.</b><small>Agents that ask for permission, ask a question, reach their limit or hit an error appear here.</small></span></p>'; /* spec 052 FR-048 */
  list.forEach((a,i)=>{
    const card=pendingCardOf(a), row=document.createElement('section');row.className='inbox-row';
    const st=vis(a), q=card&&card.classList.contains('question'), what=card?(q?'asks':card.classList.contains('limit')?'reached its spending limit':card.classList.contains('coffee')?'is on a '+coffeeWord().toLowerCase():'needs your OK'):(st==='error'?'has an error':a.limit?'reached its limit':LABELS[st]||st);
    row.setAttribute('aria-labelledby','ibh'+i);row.dataset.id=a.id;
    row.innerHTML='<div class="ib-av" aria-hidden="true">'+avatar(a)+'</div><div class="ib-main"><div class="ib-top"><h4 class="ib-h" id="ibh'+i+'" tabindex="-1"><b class="ib-n"></b> <span class="ib-sub"><span class="ib-w"></span> <span class="ib-f"></span> <span class="ib-wait"></span></span></h4></div><p class="ib-t" id="ibt'+i+'"></p><div class="ib-act"></div></div>';
    row.querySelector('.ib-h b').textContent=a.name;row.querySelector('.ib-h b').title=a.name;row.querySelector('.ib-w').textContent=what;row.querySelector('.ib-f').textContent='· '+roomOf(a).name;row.querySelector('.ib-f').title=roomOf(a).name; /* spec 052 FR-170: the name is its own line, the rest wraps below it */
    {const t=NEED_SINCE.get(a.id);row.querySelector('.ib-wait').textContent=t!=null?'· '+ATT.waitLabel(Date.now()-t):'';} /* FR-061 */
    const text=card?requestText(card):(taskOf(a)||'');row.querySelector('.ib-t').textContent=text;
    const act=row.querySelector('.ib-act');
    for(const dd of card?card.querySelectorAll(':scope > details.pdiff, :scope > details.pcmd'):[]){const c=dd.cloneNode(true);c.open=false;act.before(c);} /* spec 052 FR-063, FR-080: the card's "Show the change" and (Simple) "Show the command", collapsed */
    /* spec 052 FR-076: Allow, Allow for session, Deny in one fixed order inside a group that never wraps; FR-096: "Open" is a small link-style
       button at the end of the heading line (a question keeps "Answer in chat" with the actions). FR-077: each button names its key in its title and aria-keyshortcuts. */
    const KEY={approve:'A',session:'S',deny:'D',open:'O'}, RANK={approve:0,session:1,deny:2,other:3};
    const ans=document.createElement('span');ans.className='ib-ans';act.appendChild(ans);
    const add=(label,cls,k,fn,title,box)=>{const b=document.createElement('button');b.type='button';b.className=cls==='link'?'linkbtn ib-open':'btn sm '+cls;b.textContent=label;b.dataset.k=k;b.setAttribute('aria-describedby','ibh'+i+' ibt'+i);
      if(KEY[k]){b.setAttribute('aria-keyshortcuts',KEY[k]);title=(title?title+' ':'')+'(key '+KEY[k]+')';}if(title)b.title=title;b.onclick=fn;(box||ans).appendChild(b);};
    const kOf=src=>src.dataset.act==='session'?'session':/danger/.test(src.className)?'deny':/primary/.test(src.className)?'approve':'other';
    if(card&&!q)for(const src of [...card.querySelectorAll(':scope > .note-actions button')].filter(x=>!x.dataset.broad).sort((x,y)=>RANK[kOf(x)]-RANK[kOf(y)])){
      const k=kOf(src);
      /* spec 003 FR-097: the Read-only denial's "Switch to Ask first…" opens the same mode menu, from the chat (the inbox is modal) */
      if(src.dataset.act==='ro-ask'){add(src.textContent,'',k,()=>{closeInbox();openPanel(a.id,true);requestAnimationFrame(()=>{if(!src.isConnected)return;src.focus({preventScroll:true});src.click();});},src.title);ans.lastElementChild.setAttribute('aria-haspopup','menu');continue;}
      add(src.textContent,(src.className.match(/\b(primary|danger|session)\b/)||[''])[0],k,ev=>{const word=k==='deny'?'Denied':k==='other'?src.textContent:'Allowed';
        /* spec 052 FR-047/FR-048: the row's buttons go busy, then the row shows the answer for 600ms, folds away in 200ms, then the list repaints */
        if(row.classList.contains('settled')||row.dataset.answering)return; row.dataset.answering='1';
        act.querySelectorAll('button').forEach(x=>{if(x!==ev.currentTarget)x.disabled=true;});const done=busy(ev.currentTarget,'Sending…');
        row.querySelector('.ib-h').focus();src.click();
        setTimeout(()=>{const left=needsMeOrder().length;announce(word+' '+a.name+'. '+(left?left+' left.':'Nobody else needs you.'));renderInboxBtn();
          if(!row.isConnected){done();paintInbox(i);return;}
          row.classList.add('settled');act.innerHTML='';const p=document.createElement('p');p.className='ib-done '+(k==='deny'?'no':k==='other'?'':'yes');p.textContent=k==='deny'?'Denied':k==='other'?word:'✓ '+word;act.appendChild(p);
          setTimeout(()=>{if(!row.isConnected)return paintInbox(i);if(reducedMotion())return paintInbox(i);
            row.classList.add('gone');setTimeout(()=>flipInbox(()=>paintInbox(i)),180);},600);},250);},src.title);
    }
    if(q)add('Answer in chat','primary','open',()=>{closeInbox();openPanel(a.id,true);},'',act);
    else add('Open','link','open',()=>{closeInbox();openPanel(a.id,true);},'Open the chat',row.querySelector('.ib-top'));
    body.appendChild(row);
  });
  /* FR-033: focus a heading (it reads the agent and its request through the row), never a button */
  if(focusIndex!=null){const hs=body.querySelectorAll('.ib-h');const h=hs[Math.min(focusIndex,hs.length-1)]||body.querySelector('.inbox-empty')||$('inboxClose');if(h)h.focus();}
}
function openNextNeedsMe(){
  const list=needsMeOrder(); if(!list.length){toast('Nobody needs you right now.',2600);return;}
  const cur=list.findIndex(a=>a.id===ui.selected), nx=list[(cur+1)%list.length];
  openPanel(nx.id,'title'); /* spec 074 FR-019: the title, not the message box, so N, N, N keeps walking the queue (spec 052 FR-014) */
}
/* ---- spec 052 FR-042 / FR-043 (#316): command palette (Ctrl+K, ⌘K on a Mac) and keyboard shortcut sheet (?) ---- */
let palBack=null, palItems=[], palActive=0;
const palUsable=id=>{const el=$(id);return !!el&&!el.disabled&&!el.hidden&&!el.closest('[hidden]:not(#topMoreMenu)');}; /* items inside the top bar's closed menus still count */
const palClick=id=>()=>{const el=$(id);if(el)el.click();};
function palActions(){
  return [
    {label:'Needs you',hint:'The inbox of agents that need you ('+INBOX_KEY+')',kw:'inbox attention waiting approve',keys:['I'],run:openInbox},
    {label:'Next agent that needs you',hint:'Open the next waiting chat ('+NEXT_KEY+')',kw:'next waiting jump',keys:['N'],run:openNextNeedsMe},
    {label:'Office view',kw:'view office desks rooms',run:palClick('vOffice'),ok:()=>palUsable('vOffice')},
    {label:'List view',kw:'view list table rows',run:palClick('vList'),ok:()=>palUsable('vList')},
    {label:'Tools',kw:'tools usage mcp',run:palClick('toolsBtn'),ok:()=>palUsable('toolsBtn')},
    {label:'Settings',kw:'settings preferences theme options',...(IS_MAC?{keys:keyLabels(['mod',','])}:{}),run:palClick('settingsBtn'),ok:()=>palUsable('settingsBtn')},
    {label:'Add folder',kw:'add folder workspace project new open',keys:keyLabels(['mod','O']),run:palClick('addFolder'),ok:()=>palUsable('addFolder')},
    {label:'Add VS Code workspace',kw:'add workspace code-workspace vscode new open',keys:keyLabels(['mod','shift','O']),run:palClick('addWs'),ok:()=>palUsable('addWs')&&!SIMPLE},
    {label:'Defaults for new sessions',kw:'defaults agent app mode permission model new session',run:()=>toggleDefaults(true),ok:()=>palUsable('defaultsBtn')},
    {label:'Detail level: Simple',kw:'simple detail beginner view',run:()=>setDetail('simple')},
    {label:'Detail level: Expert',kw:'expert detail developer view',run:()=>setDetail('expert')},
    {label:'Collapse all folders',kw:'doors close collapse compact plates rooms',run:palClick('closeAll'),ok:()=>palUsable('closeAll')},
    {label:'Expand all folders',kw:'doors open expand rooms',run:palClick('openAll'),ok:()=>palUsable('openAll')},
    {label:'Back to the previous chat',kw:'previous last recent chat toggle switch',keys:['Ctrl','`'],run:openPreviousChat,ok:()=>!!previousChat()},
    {label:SIMPLE?'Show or hide earlier chats':'Show or hide previous sessions',kw:'previous earlier sessions chats history resume list collapse expand',keys:keyLabels(PREV_KEYS),run:togglePrevByKey,ok:()=>{const b=$('prevBtn'),x=$('prev');return !!b&&!!x&&!x.hidden&&!vsViewing;}}, /* spec 006 FR-036 */
    {label:'Keyboard shortcuts',kw:'keys shortcuts help hotkeys',keys:['?'],run:openKbdHelp},
    {label:'Go to… (navigator)',hint:'Floor, folder, agent or a chat by number',kw:'navigator go jump floor folder chat number spotlight',keys:keyLabels(navKeyParts()),run:()=>openPalette({nav:true}),nav:true}, /* spec 074 FR-015 */
    {label:'Send to several sessions…',hint:'One message to the running sessions you pick',kw:'send several many all broadcast message group sessions',run:()=>sendToSeveral(),ok:()=>!!bridge&&!!bridge.send&&sendTargets().filter(x=>!x.why).length>=2}, /* spec 064 FR-001 */
    {label:'End all sessions',hint:'Ends every running session; the chats stay',kw:'end stop all sessions quit day close',run:()=>endAllSessions(),ok:()=>!!bridge&&!!bridge.end&&endAllTargets().length>0},
    ...remotePalItems(),
    ...handoverPalItems(),
  ].filter(x=>!x.ok||x.ok()).map(x=>({...x,group:'Actions'}));
}
function palAll(withRecent){
  /* spec 052 FR-091: with an empty search, the 5 most recently opened chats come first, as "Recent" (and are not repeated under Agents) */
  const rec=withRecent?recentChats(5):[], recIds=new Set(rec.map(a=>a.id));
  const agItem=(a,group)=>{const r=roomOf(a);return {group,label:a.name,
    hint:[chatNoOf(a)?'chat '+chatNoOf(a):'',r&&r.name,stWord(a),a.info?kindWord(a.info.adapterId):''].filter(Boolean).join(' · '), /* spec 074 FR-012 */
    kw:[r&&r.name,stWord(a),a.info?kindWord(a.info.adapterId):''].filter(Boolean).join(' '),run:()=>openPanel(a.id,true)};};
  const ags=[...rec.map(a=>agItem(a,'Recent')),...agents.filter(a=>!a.parent&&!recIds.has(a.id)).map(a=>agItem(a,'Agents'))];
  const rooms=roomsInOrder().filter(roomShown).map(r=>({group:'Folders',label:r.name,hint:'Show only this folder',kw:'folder filter',
    run:()=>{if(ui.selected)closePanel();ui.ws=r.id;renderAll();}}));
  if(ui.ws!=='all')rooms.unshift({group:'Folders',label:'All folders',hint:'Show every folder',kw:'folder filter all',run:()=>{if(ui.selected)closePanel();ui.ws='all';renderAll();}});
  return [...ags,...rooms,...palActions()];
}
function palFilter(q){
  q=q.trim().toLowerCase(); return NAV.rank(palAll(!q),q); /* spec 074: the matching is shared with the navigator */
}
const kbdHTML=keys=>(keys||[]).map(k=>'<kbd>'+esc(k)+'</kbd>').join('');
/* spec 074 (review on PR 597): the element focus goes back to. When the office was drawn again while the box was open, the old desk
   node is gone: take the shown one with the same data-id (the desk, or the list row in the list view) */
function liveBack(b){if(!b||b.isConnected||!b.dataset||!b.dataset.id)return b;return [...document.querySelectorAll('[data-id="'+CSS.escape(b.dataset.id)+'"]')].find(x=>x.getClientRects().length)||null;}
function closePalette(back){const d=$('palDlg');if(!d)return;d.remove();palNav=null;const b=liveBack(palBack);palBack=null;if(back!==false&&b&&b.isConnected&&b.getClientRects().length)b.focus();}
/* spec 074 (issue 548): the same box in a "Go to" mode with levels (start, folders, agents, chats). null = Ctrl+K's search. */
let palNav=null;
const NAV_START=()=>[{kind:'start',q:'',active:0}];
const PAL_FOOT='<kbd>↑</kbd><kbd>↓</kbd> move <kbd>Enter</kbd> open <kbd>Esc</kbd> close';
const NAV_FOOT='<kbd>↑</kbd><kbd>↓</kbd> move <kbd>Enter</kbd> open <kbd>Esc</kbd> back <kbd>F</kbd> folders <kbd>C</kbd> and a number: a chat';
function openPalette(opts){
  const nav=!!(opts&&opts.nav);
  if($('palDlg')){if(nav!==!!palNav){palNav=nav?NAV_START():null;palMode();}$('palIn').focus();return;}
  closeInbox();
  palBack=document.activeElement&&document.activeElement!==document.body?document.activeElement:null;
  palNav=nav?NAV_START():null;
  const d=document.createElement('div');d.id='palDlg';d.className='dlg-ov pal-ov';
  d.innerHTML='<div class="dlg pal-dlg" role="dialog" aria-modal="true" aria-label="Command palette"><div class="pal-top"><p class="pal-crumb" id="palCrumb" hidden></p><input id="palIn" type="text" role="combobox" aria-expanded="true" aria-controls="palList" aria-autocomplete="list" aria-activedescendant="" aria-label="Search agents, folders and actions" placeholder="Search agents, folders and actions…" autocomplete="off" spellcheck="false"></div><div class="pal-list" id="palList" role="listbox" aria-label="Results"></div><p class="pal-foot" id="palFoot" aria-hidden="true">'+PAL_FOOT+'</p></div>';
  document.body.appendChild(d);
  const inp=$('palIn');
  d.addEventListener('click',e=>{if(e.target===d){closePalette();return;}const o=e.target.closest('[role="option"]');if(o)palRun(+o.dataset.i);});
  d.addEventListener('mousemove',e=>{const o=e.target.closest('[role="option"]');if(o&&+o.dataset.i!==palActive)palSetActive(+o.dataset.i);});
  d.addEventListener('keydown',e=>{
    /* spec 074 FR-002: the navigator shortcut closes the navigator, or turns Ctrl+K's search into the navigator */
    if(!navRecording&&NAV.comboMatches(e,NAV_KEY,IS_MAC)){e.preventDefault();e.stopPropagation();if(palNav)closePalette();else{palNav=NAV_START();palMode();}return;}
    if(e.key==='Escape'){e.preventDefault();e.stopPropagation();if(palNav&&navBack())return;closePalette();return;} /* FR-007: back one level, closes at the start */
    if(e.key==='Backspace'&&palNav&&!inp.value&&palNav.length>1){e.preventDefault();e.stopPropagation();navBack();return;}
    if(e.key==='Tab'){e.preventDefault();inp.focus();return;} /* the input is the only stop: Tab stays inside */
    if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();if(palItems.length)palSetActive((palActive+(e.key==='ArrowDown'?1:-1)+palItems.length)%palItems.length);return;}
    if(e.key==='Home'&&e.ctrlKey){e.preventDefault();palSetActive(0);return;}
    if(e.key==='End'&&e.ctrlKey){e.preventDefault();palSetActive(palItems.length-1);return;}
    if(e.key==='Enter'){e.preventDefault();palRun(palActive);return;}
    e.stopPropagation(); /* typing here never reaches the office's single-letter keys */
  });
  inp.addEventListener('input',()=>{if(palNav){navTop().q=inp.value;navShow(true);}else palPaint(inp.value);});
  palMode();
  inp.focus();
}
/* the labels, foot line and list of the current mode */
function palMode(){
  const inp=$('palIn'),dlg=document.querySelector('#palDlg .pal-dlg'),cr=$('palCrumb'),ft=$('palFoot'); if(!inp||!dlg)return;
  if(palNav){dlg.setAttribute('aria-label','Go to');dlg.setAttribute('aria-describedby','palCrumb');cr.hidden=false;ft.innerHTML=NAV_FOOT;inp.value=navTop().q||'';navShow(false);}
  else{dlg.setAttribute('aria-label','Command palette');dlg.removeAttribute('aria-describedby');cr.hidden=true;ft.innerHTML=PAL_FOOT;
    inp.setAttribute('aria-label','Search agents, folders and actions');inp.placeholder='Search agents, folders and actions…';inp.value='';palPaint('');}
}
const navTop=()=>palNav[palNav.length-1];
/* what the office shows: floors that are on (only when two or more are), folders that are shown, main sessions with their numbers */
function navSnap(){
  const fl=floorsOnList(), rooms=roomsInOrder().filter(roomShown).filter(r=>agents.some(a=>!a.parent&&a.room===r.id));
  return {floors:fl.length>=2?fl.map(f=>({id:f.id,name:f.name})):[],
    folders:rooms.map(r=>({id:r.id,name:r.name,floor:(floorById(r.floor)||{}).id||''})),
    chats:agents.filter(a=>!a.parent&&roomShown(roomOf(a))&&chatNoOf(a)).map(a=>({id:a.id,name:a.name,folder:a.room,no:chatNoOf(a),
      hint:[roomOf(a).name,stWord(a),a.info?kindWord(a.info.adapterId):''].filter(Boolean).join(' · ')}))};
}
const NAV_PH={start:'Floor or folder; F folders; C and a number for a chat',folders:'Folder name or number',agents:'Agent name or chat number',chats:'Chat number or name'};
function navShow(typed){
  const inp=$('palIn'); if(!inp||!palNav)return;
  const snap=navSnap(), lv=navTop(), v=NAV.view(snap,lv);
  if(v.go){lv.q='';palNav=NAV.push(palNav,{kind:v.go.level,q:v.go.q});inp.value=v.go.q;navShow(typed);return;} /* FR-004: "f ", "c 3" */
  if(typed&&v.auto){navChoose(snap,v.auto);return;} /* FR-006: a number nobody else starts with opens at once */
  const words=NAV.crumbs(snap,palNav);
  $('palCrumb').textContent=words.join(' › ');
  inp.placeholder=NAV_PH[lv.kind]+'…'; inp.setAttribute('aria-label',words.join(', ')+'. '+NAV_PH[lv.kind]);
  palItems=v.items.map(it=>({group:'',label:it.label,hint:it.hint,num:it.n!=null?(it.kind==='chat'?'C'+it.n:String(it.n)):'',
    keys:it.kind==='go'?[it.to==='folders'?'F':'C']:null,navItem:it}));
  let empty='No matches.';
  if(!snap.chats.length)empty='Nothing to go to yet. Add a folder with + Folder.';
  else if(v.digits)empty=lv.kind==='chats'||lv.kind==='agents'?'No chat '+(+v.digits)+' here. It may be in a hidden folder or on a floor that is off.':'Nothing has number '+(+v.digits)+'.';
  else if(lv.kind==='agents'&&!lv.q)empty='No sessions in this folder.';
  palRender(empty);
  const act=typed?v.active:Math.min(lv.active||0,Math.max(0,palItems.length-1));
  palSetActive(act);
  announce(words[words.length-1]+': '+(palItems.length?(palItems.length===1?'1 result':palItems.length+' results'):empty)); /* FR-016: the reason, not "0 results" */
}
function navChoose(snap,item){
  const r=NAV.pick(snap,item); if(!r)return;
  if(r.push){navTop().q=$('palIn').value;palNav=NAV.push(palNav,r.push);$('palIn').value='';navShow(false);return;}
  if(r.open)navOpen(r.open);
}
function navBack(){const b=NAV.back(palNav);if(!b)return false;palNav=b;$('palIn').value=navTop().q||'';navShow(false);return true;}
/* FR-009 / FR-010: open the chat the way a click on its desk does, and put the cursor at the end of its message box. Nothing is sent
   here: Enter in that box goes through the normal composer, with the session's own mode, limit and approvals. */
function navOpen(id){
  closePalette(false);
  if(window.DurbarScreens&&window.DurbarScreens.isOpen())window.DurbarScreens.close();
  if(vsViewing)leaveVsView();
  openPanel(id,true);
  const a=byId(id), inBox=document.activeElement===$('msgInput');
  if(a)announce((chatNoOf(a)?'Chat '+chatNoOf(a)+', ':'')+a.name+(inBox?'. Type a message and press Enter to send.':''));
}
function palPaint(q){
  palItems=palFilter(q); palActive=0;
  palRender('No matches.');
  palSetActive(0);
  announce(palItems.length?(palItems.length===1?'1 result':palItems.length+' results'):'No matches.');
}
function palRender(empty){
  const list=$('palList'); if(!list)return;
  let html='',g='';
  palItems.forEach((x,i)=>{
    if(x.group!==g){g=x.group;html+='<div class="pal-g" role="presentation">'+esc(g)+'</div>';}
    html+='<div class="pal-o" role="option" id="palO'+i+'" data-i="'+i+'" aria-selected="false">'+(x.num?'<span class="pal-n" aria-hidden="true">'+esc(x.num)+'</span>':'')+'<span class="pal-l" title="'+esc(x.label)+'">'+(x.num?'<span class="sr-only">'+esc(x.num.startsWith('C')?'Chat '+x.num.slice(1):x.num)+': </span>':'')+esc(x.label)+'</span>'+(x.hint?'<span class="pal-h" title="'+esc(x.hint)+'">'+esc(x.hint)+'</span>':'')+(x.keys?'<span class="pal-k">'+kbdHTML(x.keys)+'</span>':'')+'</div>';
  });
  list.innerHTML=html||'<p class="pal-empty">'+esc(empty)+'</p>'; /* no role inside the listbox: the reason is announced (spec 074 FR-016) */
}
function palSetActive(i){
  const list=$('palList'),inp=$('palIn'); if(!list||!inp)return;
  palActive=i; if(palNav)navTop().active=i;
  list.querySelectorAll('[role="option"]').forEach(o=>o.setAttribute('aria-selected',String(+o.dataset.i===i)));
  const o=$('palO'+i);
  inp.setAttribute('aria-activedescendant',o?o.id:'');
  if(o)o.scrollIntoView({block:'nearest'});
}
function palRun(i){
  const x=palItems[i]; if(!x)return;
  if(palNav){navChoose(navSnap(),x.navItem);return;}
  if(x.nav){palNav=NAV_START();palMode();return;} /* "Go to… (navigator)": the same box switches mode */
  const b=palBack; closePalette(false);
  if(x.run===openKbdHelp){openKbdHelp(b);return;}
  x.run();
  /* an action that moves focus (a chat, the inbox, Settings) keeps it; otherwise focus goes back to where it was */
  setTimeout(()=>{const f=document.activeElement;if((!f||f===document.body)&&b&&b.isConnected&&b.getClientRects().length)b.focus();},0);
}
/* FR-043: the shortcut sheet */
function closeKbdHelp(){const d=$('kbdDlg');if(!d)return;d.remove();const b=palBack;palBack=null;if(b&&b.isConnected&&b.getClientRects().length)b.focus();}
function openKbdHelp(back){
  if($('kbdDlg'))return;
  palBack=back instanceof Element?back:(document.activeElement&&document.activeElement!==document.body?document.activeElement:null);
  const rows=[
    [keyLabels(['mod','K']),'Command palette: agents, folders and actions'],
    [keyLabels(navKeyParts()),'Go to: floor, folder, agent or a chat by number (change it in Settings)'], /* spec 074 FR-015 */
    [keyLabels(['mod','O']),'Add a folder'], /* spec 052 FR-164 */
    ...(SIMPLE?[]:[[keyLabels(['mod','shift','O']),'Add a VS Code workspace']]),
    [['I'],'Needs you inbox',keyLabels(['mod','shift','A'])],
    [keyLabels(['mod','A']),'Needs you inbox, outside text (in a text box it selects all)'], /* spec 074 FR-021 */
    [['N'],'Next agent that needs you',keyLabels(['mod','shift','N'])],
    ...(IS_MAC?[[keyLabels(['mod',',']),'Settings']]:[]), /* FR-083: the app menu's Settings… item */
    [['Ctrl','`'],'Back to the previous chat (on a Mac too: Control, not Cmd)'],
    [keyLabels(PREV_KEYS),SIMPLE?'Show or hide earlier chats in a chat':'Show or hide previous sessions in a chat'], /* spec 006 FR-036 */
    [['←','→','↑','↓'],'Move between desks'],
    [['Esc'],'Back, or close'],
    [keyLabels(['mod',IS_MAC?'⌫':'Backspace']),'Back to the office from a chat, outside text (in a text box it deletes)'], /* spec 074 FR-020 */
    [['?'],'This list'],
  ];
  const inbox=[[['J'],['K'],'Next or previous request (also ↓ ↑)'],[['A'],'Allow once'],[['S'],'Allow for this session'],[['D'],'Deny'],[['O'],'Open the chat']];
  /* spec 052 FR-060: in an open chat that waits for you */
  /* FR-084: ⌥⌘ on a Mac (Option alone types accents there), Alt elsewhere */
  const ck=k=>keyLabels(KEYS.chatParts(k,IS_MAC));
  const inChat=[[ck('A'),'Allow once'],[ck('S'),'Allow for this session'],[ck('D'),'Deny'],[ck('N'),'Next agent that needs you']];
  /* spec 052 FR-064 */
  const inList=[[['J'],['K'],'Next or previous row (also ↓ ↑)'],[['Enter'],'Open chat']];
  /* spec 074 FR-015: inside the navigator */
  const inNav=[[['F','Space'],'All folders'],[['C','3'],'Chat 3 (C and its number)'],[['1','2','3'],'Pick by the number shown'],[['Esc'],'Back one level (or Backspace in an empty box)']];
  const row=(keys,what,alt)=>'<tr><td class="kb-k">'+kbdHTML(keys)+(alt?' <span class="kb-or">or</span> '+kbdHTML(alt):'')+'</td><td>'+esc(what)+'</td></tr>';
  const d=document.createElement('div');d.id='kbdDlg';d.className='dlg-ov';
  d.innerHTML='<div class="dlg kbd-dlg" role="dialog" aria-modal="true" aria-labelledby="kbdT"><h3 id="kbdT">Keyboard shortcuts</h3><div class="kb-cols"><div class="kb-col"><table class="kb-t"><tbody>'+rows.map(r=>row(r[0],r[1],r[2])).join('')+'</tbody></table><h4 class="kb-h">In the list view</h4><table class="kb-t"><tbody>'+inList.map(r=>r.length===3?row(r[0],r[2],r[1]):row(r[0],r[1])).join('')+'</tbody></table><h4 class="kb-h">In Go to (the navigator)</h4><table class="kb-t"><tbody>'+inNav.map(r=>row(r[0],r[1])).join('')+'</tbody></table></div><div class="kb-col"><h4 class="kb-h">In the Needs you inbox</h4><table class="kb-t"><tbody>'+inbox.map(r=>r.length===3?row(r[0],r[2],r[1]):row(r[0],r[1])).join('')+'</tbody></table><h4 class="kb-h">In a chat that waits for you</h4><table class="kb-t"><tbody>'+inChat.map(r=>row(r[0],r[1])).join('')+'</tbody></table></div></div><div class="dbtn"><button class="btn" type="button" id="kbdClose">Close</button></div></div>';
  document.body.appendChild(d);
  d.addEventListener('click',e=>{if(e.target===d)closeKbdHelp();});
  d.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();closeKbdHelp();}else if(e.key==='Tab'){e.preventDefault();$('kbdClose').focus();}});
  $('kbdClose').onclick=closeKbdHelp;
  /* spec 052 (2026-10-21, round 1): focusing Close must not scroll the sheet to its end (the title and Ctrl K were hidden at 1280x800) */
  $('kbdClose').focus({preventScroll:true});d.querySelector('.kbd-dlg').scrollTop=0;
}
$('kbdHelpBtn').onclick=()=>openKbdHelp($('topMoreBtn'));
/* ---- end spec 052 FR-042 / FR-043 ---- */
/* ---- spec 052 round 8, daily use (FR-087..FR-091) ---- */
const rememberOn=()=>!!bridge&&!qs.get('sim')&&!demoOn;
/* FR-087: written only when something changed (renderAll runs often); the folder is kept by its path, which stays the same across restarts */
function rememberUi(){
  if(!uiRestored||!rememberOn())return;
  const sel=byId(ui.selected), root=sel&&(sel.parent?byId(sel.parent):sel);
  const room=ui.ws!=='all'?ROOMS.find(r=>r.id===ui.ws):null;
  const v=JSON.stringify({view:ui.view,ws:room?room.path:null,chat:root&&root.live?root.id:null,recent:RECENT.slice(0,10)});
  if(v===uiSaved)return; uiSaved=v;
  try{localStorage.setItem(UI_KEY,v);}catch(e){}
}
/* after the agent list loaded: the view, then the folder filter (if that folder is still shown), then the chat (only if that agent still exists) */
function restoreUi(){
  if(uiRestored)return; uiRestored=true;
  if(!rememberOn())return;
  let o=null; try{o=JSON.parse(localStorage.getItem(UI_KEY)||'null');}catch(e){o=null;}
  if(!o||typeof o!=='object')return;
  RECENT=Array.isArray(o.recent)?o.recent.filter(x=>typeof x==='string'&&x.length<=200).slice(0,10):[];
  if(o.view==='list'&&ui.view!=='list'&&qs.get('view')!=='list')setView('list');
  const room=typeof o.ws==='string'?ROOMS.find(r=>r.path===o.ws&&roomShown(r)):null;
  if(room){ui.ws=room.id;renderFilter();renderAll();}
  const a=typeof o.chat==='string'?byId(o.chat):null;
  if(a&&!a.parent&&!ui.selected&&!pendingOpen)openPanel(a.id,false);
  uiSaved='';rememberUi();
}
/* FR-091: the most recently opened chats, newest first (main agents; a helper's chat counts for its main agent) */
function noteRecentChat(a){
  const r=a&&(a.parent?byId(a.parent):a); if(!r||!r.live)return;
  RECENT=[r.id,...RECENT.filter(x=>x!==r.id)].slice(0,10);
}
const recentChats=n=>RECENT.map(byId).filter(a=>a&&!a.parent&&a.live&&roomShown(roomOf(a))).slice(0,n);
/* the chat to go back to: the newest one that is not open now */
function previousChat(){
  const sel=byId(ui.selected), cur=sel&&(sel.parent?sel.parent:sel.id);
  return recentChats(10).find(a=>a.id!==cur)||null;
}
function openPreviousChat(){
  const p=previousChat();
  if(!p){toast('No earlier chat to go back to yet.',2600);return;}
  closeInbox();openPanel(p.id,true);
}
/* FR-090: End all sessions: every main session that is running (the card menu's own rule: started, not ended), through the same end path */
const endAllTargets=()=>agents.filter(a=>!a.parent&&a.live&&DMK().cardMenuActions(a,capsFor(a)).end);
/* ---------------- spec 064: one message to several running sessions ---------------- */
const SEND_BUSY={working:'busy',thinking:'busy',waiting:'waits for you'};
function sendTargets(){
  return agents.filter(a=>!a.parent&&a.live&&a.info).map(a=>{
    const why=a.limit?'at its spending limit':SIGNIN&&SIGNIN.needsSignIn(KINDS,kindOf(a))?'needs a sign-in':SEND_BUSY[a.state]||'';
    return {a,why};
  });
}
async function sendToSeveral(anchor){
  const list=sendTargets();
  if(list.filter(x=>!x.why).length<1){toast('No running session is free to take a message right now.',3200);return;}
  const r=await askDialog({title:'Send to several sessions',size:'m',
    body:'Each session you tick gets this message as if you typed it in its chat, with its own agent app, mode and spending limit.',
    input:{label:'Message',multiline:true,max:4000,focus:true,placeholder:'For example: pull the latest main and run the tests again'},
    picks:list.map(({a,why})=>({label:a.name+' \u00b7 '+(folderOfAgentName(a)||'')+' \u00b7 '+kindWord(kindOf(a))+' \u00b7 '+(MODE_NAME[a.info.permMode]||'Read-only'),note:why,value:a.id,disabled:!!why})),
    need:{text:true,picks:1,label:n=>n?'Send to '+n+' session'+(n===1?'':'s'):'Send'},
    buttons:[{label:'Cancel',value:null},{label:'Send',value:'send',cls:'primary'}],returnFocus:anchor});
  if(!r||r.value!=='send')return;
  const text=String(r.text||'').trim().slice(0,4000);if(!text||!r.picked||!r.picked.length)return;
  const bad=[];let n=0;
  for(const id of r.picked){const a=byId(id);if(!a||!a.live){bad.push(a?a.name:id);continue;}
    try{await sendLive(text,id,{fromComposer:false});n++;}catch(err){bad.push(a.name);}}
  toast(bad.length?'Sent to '+n+'; could not send to '+esc(bad.join(', '))+'.':'Sent to '+n+' session'+(n===1?'':'s')+'.',3600).classList.add(bad.length?'err':'ok');
}
const folderOfAgentName=a=>{const r=roomOf(a);const p=r&&r.path?String(r.path).replace(/[\\/]+$/,''):'';return p.split(/[\\/]/).pop()||'';};
async function endAllSessions(anchor){
  const list=endAllTargets();
  if(!list.length){toast('No session is running.',2600);return;}
  const busyN=list.filter(a=>a.state==='working'||a.state==='thinking'||a.state==='waiting').length;
  const ok=await askDialog({title:'End all sessions?',body:(list.length===1?'1 session ends':list.length+' sessions end')+' and frees '+(list.length===1?'its place':'their places')+(busyN?' ('+busyN+' still working: '+(busyN===1?'its reply stops':'their replies stop')+')':'')+'. The chats stay; send a message to pick up where you left off.',returnFocus:anchor,
    buttons:[{label:'Cancel',value:null},{label:'End all sessions',value:'ok',cls:'primary danger'}]});
  if(!ok)return;
  const bad=[];
  for(const a of list){try{await (bridge.end||bridge.stop)(a.id);dropDraft(a.id);}catch(err){bad.push(a.name);}}
  const n=list.length-bad.length;
  toast(bad.length?'Could not end '+esc(bad.join(', '))+'.':(n===1?'1 session ended.':n+' sessions ended.')+' Sending a message resumes one.',4200).classList.add(bad.length?'err':'ok');
}
/* FR-089: "Since you were away": how long the app was closed and the scheduled prompts that did not run, from main's stores only */
const awayWords=ms=>{const m=Math.round(ms/60000),d=Math.floor(m/1440),h=Math.floor((m%1440)/60),mm=m%60;
  return d?d+(d===1?' day':' days')+(h?' '+h+' h':''):h?h+' h'+(mm?' '+mm+' min':''):mm+' min';};
async function renderAwayStrip(){
  const el=$('awayStrip'); if(!el||!bridge||!bridge.sinceAway||demoOn)return;
  let s=null; try{s=await bridge.sinceAway();}catch(e){s=null;}
  if(!s||typeof s.awayMs!=='number'){el.hidden=true;el.innerHTML='';return;}
  const missed=Array.isArray(s.missed)?s.missed:[];
  el.innerHTML='<span class="ns-ic" aria-hidden="true">i</span><span class="ns-t"><b>Since you were away</b> ('+esc(awayWords(s.awayMs))+'): '+
    (missed.length?(missed.length===1?'1 scheduled prompt':missed.length+' scheduled prompts')+' did not run while the app was closed.':'nothing was scheduled while the app was closed.')+
    '</span>'+(missed.length?'<span class="aw-list">'+missed.map(m=>'<span class="aw-it" data-sched="'+esc(m.id)+'"><span class="aw-w"><b>'+esc(m.folderName)+'</b>: “'+esc(safeExcerpt(m.prompt,80,''))+'”'+(m.repeats?' <small>(runs again as planned)</small>':'')+'</span>'+(bridge.runScheduleNow?'<button class="btn" type="button" data-awrun="'+esc(m.id)+'">Run missed now</button>':'')+'</span>').join('')+'</span>':'')+
    '<span class="ns-act"><button class="btn" type="button" data-aw="close">Dismiss</button></span>';
  el.hidden=false;
  el.querySelector('[data-aw="close"]').onclick=()=>{el.hidden=true;el.innerHTML='';if(bridge.dismissSinceAway)bridge.dismissSinceAway().catch(()=>{});scheduleRender();};
  el.querySelectorAll('[data-awrun]').forEach(b=>b.onclick=async()=>{
    const done=busy(b,'Sending…');let r;
    try{r=await bridge.runScheduleNow(b.dataset.awrun);}catch(err){r={ok:false,error:String(err&&err.message||err)};}finally{done();}
    if(r&&r.ok){const it=b.closest('.aw-it');b.remove();if(it)it.insertAdjacentHTML('beforeend','<span class="aw-ok">Sent</span>');toast('Sent the scheduled prompt now.',3200).classList.add('ok');}
    else toast('Could not run it: '+esc((r&&r.error)||'unknown error'),5000).classList.add('err');
  });
  scheduleRender();
}
$('endAllBtn').onclick=()=>endAllSessions($('topMoreBtn'));
if($('sendSeveralBtn'))$('sendSeveralBtn').onclick=()=>sendToSeveral($('topMoreBtn'));
const DESK_NAV='#stage .desk, #stage .helper, #stage .plate';
$('wsFilter').addEventListener('change',e=>{ui.ws=e.target.value;renderAll();});
function setView(v){ui.view=v;document.body.classList.toggle('list-mode',v==='list');
  $('vOffice').setAttribute('aria-pressed',String(v==='office'));$('vList').setAttribute('aria-pressed',String(v==='list'));renderAll();}
$('vOffice').onclick=()=>setView('office');
$('vList').onclick=()=>setView('list');
let resizeQueued=false;
const relayout=()=>{if(resizeQueued)return;resizeQueued=true;requestAnimationFrame(()=>{resizeQueued=false;if(ui.view==='office'){renderOffice();syncWalkers();}});}; /* spec 024: figures follow a resize */
new ResizeObserver(relayout).observe($('floor'));
window.addEventListener('resize',relayout);


/* ---------------- LIVE MODE (Electron bridge, or the simulated agents dev mode) ---------------- */
/* DURBAR_SIM=N (Electron env, passed as ?sim=N) or ?sim=N in a plain browser feeds fake normalized
   events through exactly the same onLiveEvent path as the Copilot adapter. No AI credits are used. */
const SIM = qs.has('sim') ? Math.max(1,Math.min(40,parseInt(qs.get('sim')||'12',10)||12)) : 0;
const sim = SIM && window.__durbarSim ? window.__durbarSim.create({n:SIM, freeze:qs.get('simfreeze')==='1', titles:qs.get('simtitles')==='long'?'long':qs.get('simtitles')==='1', names:qs.get('simnames')==='long'?'long':undefined, reply:qs.get('simreply')==='long'?'long':qs.get('simreply')==='secrets'?'secrets':undefined, grants:qs.get('simgrants')==='many'?'many':qs.get('simgrants')==='stuck'?'stuck':undefined, question:qs.get('simquestion')==='long'?'long':qs.get('simquestion')==='compact'?'compact':qs.get('simquestion')==='1', elicit:qs.get('simelicit')||undefined, solo:qs.get('simrooms')==='solo', unreported:qs.get('simunreported')||undefined, waitOld:qs.get('simwaitold')==='1', sched:qs.get('simsched')==='1', schedFire:Math.max(0,Math.min(600,parseInt(qs.get('simschedfire')||'0',10)||0)), seedTotals:qs.get('simtotals')==='1', seed:parseInt(qs.get('seed')||'7',10), edits:qs.get('simedits')==='1', floors:qs.get('simfloors')==='1', floorsOff:(qs.get('floorsoff')||'').split(',').map(x=>x.trim()).filter(Boolean)}) : null;
const bridge = sim || window.agentDurbar;
const DEMO={agents:agents,rooms:ROOMS}, LIVE={agents:[],rooms:[]};
let demoOn=!bridge;
const TINTS=['sage','blue','sand','clay'];
const CLOSED_Q=(qs.get('closed')||'').split(',').filter(Boolean); /* dev/screenshots: ?closed=blog,infra-notes */
ROOMS.forEach(r=>{if(CLOSED_Q.includes(r.name)||CLOSED_Q.includes(r.id))r.closed=true;});
const hashN=str=>{let h=0;for(const c of str)h=(h*31+c.charCodeAt(0))>>>0;return h;};
const lookFor=key=>{const h=hashN(key);return L(S.sk[h%5],S.hr[(h>>>3)%6],['bun','short','long','curly'][(h>>>6)%4],S.sh[(h>>>9)%7],(h>>>12)%3===0);};
const liveById=id=>LIVE.agents.find(a=>a.id===id);
const liveRoot=a=>a.parent?byId(a.parent):a;
let renderQueued=false, agentsListed=false;
function scheduleRender(){if(renderQueued)return;renderQueued=true;requestAnimationFrame(()=>{if(!renderQueued)return;renderQueued=false;renderAll();});} /* settleNow() may have drawn it already */
function setBadge(){const b=$('protoBadge'); if(!b)return; b.className='proto'+(SIM&&!demoOn?' sim':'');
  /* spec 001 FR-027: not one agent app; the tooltip names the ready ones */
  const ready=DMK().kindChoices(KINDS).filter(k=>!k.disabled).map(k=>k.name);
  b.title=SIM&&!demoOn?'Demo: fake events, no sessions started, no AI credits used':(!demoOn&&ready.length?'Live: '+ready.join(', '):'');b.textContent=demoOn?'Demo: sample data':SIM?'Demo':'Live';}
function applyMode(){
  agents=demoOn?DEMO.agents:LIVE.agents; ROOMS=demoOn?DEMO.rooms:LIVE.rooms;
  ui.ws='all'; ui.status=null;
  if(ui.selected)closePanel();
  setBadge(); renderFloorsBtn(); renderIntoFloor(); renderFilter(); renderAll(); labelDemo();
}
/* spec 052 round 10: the top bar's demo item says what choosing it does */
function labelDemo(){const w=$('demoWord');if(w)w.textContent=demoOn?'Turn off demo':'Turn on demo';}
function liveChat(a){
  if(chats[a.id])return chats[a.id];
  const el=document.createElement('div');el.className='chat-inner';
  const chat=chats[a.id]={el,busy:false};
  if(a.sub)buildSubTranscript(a,chat);
  return chat;
}
function addNote(chat,html,err){const n=document.createElement('div');n.className='note'+(err?' err':'');n.innerHTML=html;chat.el.appendChild(n);stickyScroll(chat);return n;}
const MODE_NAME={'read-only':'Read-only','ask':'Ask first','allow':'Allow all'};
/* spec 003 (2026-10-21): a session that came back (restart or Previous sessions) says in its chat which mode it is in and why, so a mode never changes unseen */
function modeBackNote(a,was){
  const i=a&&a.info; if(!i||!i.permMode||!i.permFrom||a.parent)return;
  const m='<b>'+esc(MODE_NAME[i.permMode]||i.permMode)+'</b>';
  const why=i.permFrom==='session'?'the mode you last chose for this session':i.permFrom==='folder'?'this folder\'s saved mode (no mode was remembered for this session)':'the same as the session you opened it from (no mode was remembered for this session)';
  const diff=was&&was!==i.permMode?' The session you opened it from is in '+esc(MODE_NAME[was]||was)+'.':'';
  addNote(liveChat(a),'Permissions: '+m+', '+why+'.'+diff+' Change it with the mode chip above.').classList.add('modeback');
}
const MODE_TEXT={'read-only':'read-only','allow':'no prompts','ask':'asks first'};
/* spec 052 FR-077: one short line per mode in the menu; the full explanation stays in its title */
const MODE_SHORT={'read-only':"Reads only: can't change files or run commands",'ask':'Asks before each change or command','allow':'Never asks: edits, commands, web'}; /* spec 052 FR-093, FR-165: short but accurate; a hint wraps into at most two balanced lines at --menu-w (the full help is in the title) */
const MODE_HELP={'read-only':'Reads only. Edits, commands and other changes are denied. An MCP tool runs only if its server marks it read-only.','ask':'Asks before every edit or command. You can approve for the rest of the session.','allow':'Everything runs without asking: edits, shell commands, web requests and tools.'};
/* spec 012 FR-123: the agent kind's own name in agent-facing text; Copilot's wording is unchanged */
const KIND_WORD={copilot:'Copilot',claude:'Claude Code',codex:'Codex'};
const kindWord=id=>{const k=id||'copilot';if(KIND_WORD[k])return KIND_WORD[k];const d=(KINDS||[]).find(x=>x.id===k);return d&&d.displayName?d.displayName:k;};
const RESUME_CMD={copilot:id=>'copilot --resume '+id,claude:id=>'claude --resume '+id}; /* kinds with a terminal resume command */
const resumeCmdOf=a=>{const r=liveRoot(a),f=r&&RESUME_CMD[(r.info&&r.info.adapterId)||'copilot'];return f?f(r.id):'';};
const roleFor=info=>kindWord(info.adapterId)+' ('+MODE_TEXT[info.permMode]+')'+(info.model&&info.model!=='auto'?' · '+info.model:'');
const MODE_IC={
 'read-only':'<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3.2" y="7" width="9.6" height="6.6" rx="1.6"/><path d="M5.4 7V5.4a2.6 2.6 0 0 1 5.2 0V7"/></svg>',
 'ask':'<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 1.8l5 1.8v3.8c0 3-2.1 5.2-5 6.6-2.9-1.4-5-3.6-5-6.6V3.6z"/><path d="M6.2 7.8l1.4 1.4 2.4-2.6"/></svg>',
 /* spec 052 FR-018: an open padlock, not a pencil: Allow all is unguarded, not "editable" */
 'allow':'<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"><rect x="3.2" y="7" width="9.6" height="6.6" rx="1.6"/><path d="M5.6 7V5.2a2.4 2.4 0 0 1 4.7-.7"/></svg>'};
/* spec 052 FR-011: the desk's accessible name says its permission mode; the glyph next to the name is decoration for screen readers */
/* spec 052 FR-039: with more than one harness in the office, each card says which one runs it ("Reviewer · Codex") */
const kindTag=a=>{const r=a&&a.parent?byId(a.parent):a;if(!r||!r.live||!r.info)return '';const ks=new Set(agents.filter(x=>x.live&&!x.parent&&x.info).map(x=>x.info.adapterId||'copilot'));return ks.size>1?' · '+kindWord(r.info.adapterId):'';};
/* spec 054 FR-007: remote control on = text in the card's existing role line and its accessible name (no new element, no size change) */
const remoteTag=a=>a&&!a.parent&&a.remote?' · Remote':'';
const remoteWords=a=>a&&!a.parent&&a.remote?', remote control on':'';
const modeWords=a=>a&&a.live&&a.info&&!a.parent&&a.info.permMode?', '+MODE_NAME[a.info.permMode]+(a.info.permMode==='allow'&&a.info.permRestored?' (restored)':''):'';
/* spec 052 FR-065: Allow all is a small red "Allow all" text badge in the icon's slot (the words, not only a padlock); the other modes keep the icon */
/* spec 052 FR-065: the list row says "Allow all" in a red badge (text=true); a desk card keeps the red icon, because a text badge
   there hides the agent's name at 1280x800 (office check) */
const modeIcon=(a,text)=>a&&a.live&&a.info&&!a.parent&&a.info.permMode?(a.info.permMode==='allow'&&text?`<span class="modebadge" title="${esc(MODE_NAME.allow)}${a.info.permRestored?' (restored from your last run)':''}: ${esc(MODE_SHORT.allow)}. Right-click for options." aria-hidden="true">Allow all</span>`:`<span class="modeic mode-${a.info.permMode}" title="${esc(MODE_NAME[a.info.permMode])}${a.info.permMode==='allow'&&a.info.permRestored?' (restored from your last run)':''}: ${esc(MODE_SHORT[a.info.permMode])}. Right-click for options." aria-hidden="true">${MODE_IC[a.info.permMode]}</span>`):'';
/* spec 033 SC-003 (2026-10-21, issue #454): a floor switch is timed inside the app, from the click to the end of the office render
   that shows it (that render measures the stage, so its layout is done). One User Timing entry, replaced on each switch; the
   simulator check reads it. Nothing else uses it. */
function startFloorSwitchTiming(){performance.clearMarks(FLOOR_MARK);performance.mark(FLOOR_MARK);}
function endFloorSwitchTiming(){floorSwitchTimed=false;performance.clearMeasures(FLOOR_MARK);performance.measure(FLOOR_MARK,FLOOR_MARK);performance.clearMarks(FLOOR_MARK);}
/* Floors state from the bridge (spec 033): rooms take their floor from it, then everything that depends on visibility re-renders. */
function applyFloors(state){
  if(!state||!Array.isArray(state.floors)||!state.floors.length)return;
  FLOORS=state;
  LIVE.rooms.forEach(r=>{const ag=LIVE.agents.find(a=>!a.parent&&a.room===r.id&&state.byAgent&&state.byAgent[a.id]);if(ag)r.floor=state.byAgent[ag.id];});
  afterFloorsChange();
}
function afterFloorsChange(){
  renderFloorsBtn(); renderIntoFloor();
  if(demoOn)return;
  /* the open agent is now on a floor that is off: back to the office (its pending requests stay pending, FR-010) */
  if(ui.selected){const a=byId(ui.selected);if(a&&!roomShown(roomOf(a)))closePanel();}
  renderFilter(); renderFloorsPanel(); renderFloorsSettings();
  floorSwitchTimed=performance.getEntriesByName(FLOOR_MARK,'mark').length>0; scheduleRender();
}
/* ---------------- floors: top-bar button, "into" select, panel (spec 033) ---------------- */
/* FR-007 (PR #124 review): only with two or more floors, and compact (icon + "2/3"), so the top bar fits at 1280x800 with
   wide fonts too. With the Ground floor alone the top bar looks as before; the first extra floor is made in Settings > Floors. */
const FLOORS_IC='<svg class="fl-ic" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M8 1.8l6.2 3.1L8 8 1.8 4.9z"/><path d="M1.8 8.1L8 11.2l6.2-3.1"/><path d="M1.8 11.1L8 14.2l6.2-3.1"/></svg>';
function renderFloorsBtn(){
  const b=$('floorsBtn'); if(!b)return;
  const show=floorsLive()&&FLOORS.floors.length>1;
  b.hidden=!show;
  if(!show){const pop=$('floorsPop');if(pop&&!pop.hidden)toggleFloors(false);return;}
  const on=floorsOnList().length,n=FLOORS.floors.length,tip='Floors: '+on+' of '+n+' on';
  b.innerHTML=FLOORS_IC+'<span class="fl-cnt">'+on+'/'+n+'</span>';
  b.title=tip+'. Switch floors on and off, manage them.';
  b.setAttribute('aria-label',tip+'. Open the floors panel.');
}
/* Floor for the next added folder (FR-006): chosen in the Floors panel before the picker opens; default = the last one used.
   The top bar has no room for one more select at 1280x800, so Add folder / Add VS Code workspace only name it in their tooltip. */
let INTO=null;
const intoFloor=()=>{if(!floorsLive()||FLOORS.floors.length<2)return undefined;const f=(INTO&&FLOORS.floors.find(x=>x.id===INTO))||FLOORS.floors.find(x=>x.id===FLOORS.lastFloor)||FLOORS.floors[0];return f.id;};
function renderIntoFloor(){
  const n=intoFloor()&&floorById(intoFloor()).name;
  $('addFolder').title=(n?'Add a folder to the floor "'+n+'" (change it in Floors)':'Add a folder')+' ('+ADD_KEY+')';
  $('addWs').title=(n?'Add a VS Code workspace (.code-workspace file) to the floor "'+n+'" (change it in Floors)':'Add a VS Code workspace (.code-workspace file)')+' ('+ADDWS_KEY+')';
}
let floorsErr='';
function toggleFloors(on){
  const pop=$('floorsPop'),btn=$('floorsBtn');
  const show=on===undefined?pop.hidden:on;
  pop.hidden=!show; btn.setAttribute('aria-expanded',String(show));
  if(show){floorsErr='';renderFloorsPanel();const f=pop.querySelector('button,input,select');if(f)f.focus();}
  else if(document.activeElement&&pop.contains(document.activeElement))btn.focus();
}
const roomsOnFloor=id=>roomsInOrder().filter(r=>(floorById(r.floor)||{}).id===id);
/* Attention on a floor that is off (FR-010, maintainer decision in issue #122): plain text in the Floors controls only,
   e.g. "Off, 1 waiting, 1 error". Main agents and helpers of every room on that floor, hidden rooms included. Never a pill,
   toast, sound, sort order or change to "Floors n/m". */
function offFloorAttention(fid){
  const f=floorById(fid); if(!f||f.on)return '';
  const ids=new Set(roomsOnFloor(fid).map(r=>r.id));
  let w=0,e=0,l=0;
  agents.forEach(a=>{const r=roomOf(a);if(!r||!ids.has(r.id))return;const st=vis(a);if(st==='waiting'){if(a.limit)l++;else w++;}else if(st==='error')e++;});
  const parts=[];
  if(w)parts.push(w+' waiting'); if(e)parts.push(e+' error'+(e===1?'':'s')); if(l)parts.push(l+' at spending limit');
  return parts.length?'Off, '+parts.join(', '):'';
}
/* refresh only those texts on every render, so an open select or the focus in the panel is never disturbed */
function updateFloorAttention(){
  document.querySelectorAll('.floors-ui [data-att]').forEach(el=>{const t=offFloorAttention(el.dataset.att);if(el.textContent!==t)el.textContent=t;el.hidden=!t;});
}
/* The floors controls (FR-007, FR-023): one markup for the top-bar panel and the Settings section. `px` keeps ids unique per place. */
function floorsBodyHTML(px){
  const last=FLOORS.floors.length-1;
  const opts=sel=>FLOORS.floors.map(f=>`<option value="${esc(f.id)}"${f.id===sel?' selected':''}>${esc(f.name)}</option>`).join('');
  const into=intoFloor();
  return (into?`<div class="fl-into"><label for="${px}Into">New folders go to</label><select id="${px}Into" class="fl-into-sel" title="Floor for the folders you add with + Folder or + Workspace">${opts(into)}</select></div>`:'')+
    FLOORS.floors.map((f,i)=>{
      const rooms=roomsOnFloor(f.id);
      return `<div class="fl-floor${f.on?'':' off'}"><div class="fl-row">
        <button class="fl-sw" type="button" data-fl="on" data-floor="${esc(f.id)}" aria-pressed="${f.on}" aria-label="${esc(f.name)}: ${f.on?'on':'off'}. Switch ${f.on?'off':'on'}.">${f.on?'On':'Off'}</button>
        <div class="fl-t"><b title="${esc(f.name)}">${esc(f.name)}</b><small>${rooms.length} folder${rooms.length===1?'':'s'}</small><small class="fl-att" data-att="${esc(f.id)}"${offFloorAttention(f.id)?'':' hidden'}>${esc(offFloorAttention(f.id))}</small></div>
        <button class="btn" type="button" data-fl="only" data-floor="${esc(f.id)}" title="Switch ${esc(f.name)} on and every other floor off" aria-label="Show only ${esc(f.name)}">Show only</button>
        <button class="btn" type="button" data-fl="rename" data-floor="${esc(f.id)}" aria-label="Rename ${esc(f.name)}">Rename…</button>
        <button class="btn" type="button" data-fl="up" data-floor="${esc(f.id)}" aria-label="Move ${esc(f.name)} up"${i===0?' disabled':''}>Up</button>
        <button class="btn" type="button" data-fl="down" data-floor="${esc(f.id)}" aria-label="Move ${esc(f.name)} down"${i===last?' disabled':''}>Down</button>
        ${f.ground?'':`<button class="btn danger" type="button" data-fl="del" data-floor="${esc(f.id)}" aria-label="Delete ${esc(f.name)}">Delete</button>`}</div>
        ${rooms.map(r=>`<div class="fl-folder"><span class="fl-fn" title="${esc(r.path)}">${esc(r.name)}</span>${r.hidden?'<span class="tag">hidden</span>':''}<label class="sr-only" for="${px}m-${esc(r.id)}">Floor of ${esc(r.name)}</label><select id="${px}m-${esc(r.id)}" data-fl="move" data-room="${esc(r.id)}" title="Move ${esc(r.name)} to another floor">${opts(f.id)}</select></div>`).join('')}</div>`;}).join('')+
    `<div class="fl-new"><label class="sr-only" for="${px}New">New floor name</label><input id="${px}New" type="text" maxlength="40" placeholder="New floor name" autocomplete="off" spellcheck="false"><button class="btn" type="button" data-fl="create">Create</button></div>`+
    `<p class="fl-err" role="alert"${floorsErr?'':' hidden'}>${esc(floorsErr)}</p>`;
}
/* re-render one floors container, keeping keyboard focus on the same control */
function paintFloors(box,html){
  const ae=document.activeElement,fk=ae&&box.contains(ae)?{fl:ae.dataset.fl||'',key:ae.dataset.floor||ae.dataset.room||'',id:ae.id}:null;
  box.innerHTML=html;
  if(!fk)return;
  const el=fk.id?box.querySelector('#'+CSS.escape(fk.id)):box.querySelector(`[data-fl="${CSS.escape(fk.fl)}"][data-floor="${CSS.escape(fk.key)}"],[data-fl="${CSS.escape(fk.fl)}"][data-room="${CSS.escape(fk.key)}"]`);
  if(el&&!el.disabled)el.focus();else box.focus();
}
function renderFloorsPanel(){
  const pop=$('floorsPop'); if(!pop||pop.hidden||!floorsLive())return;
  paintFloors(pop,'<div class="fp-h">Floors <small>A floor that is off is hidden and not counted. Its agents keep running and can spend credits; what waits for you there is shown only here.</small></div>'+floorsBodyHTML('fp'));
}
/* Settings > Floors (FR-023): same controls; painted when the Settings screen is open */
function renderFloorsSettings(){
  const box=$('floorsSet'); if(!box||!floorsLive())return;
  paintFloors(box,floorsBodyHTML('fs'));
}
/* every floors call returns the full new state; an error is shown in the panel */
async function floorCall(p){
  let r=null; try{r=await p;}catch{r=null;}
  floorsErr=r&&!r.ok?(r.error||'That did not work.'):(r?'':'Floors are not available.');
  if(r&&r.state)applyFloors(r.state); else {renderFloorsPanel();renderFloorsSettings();}
  return r;
}
async function floorAction(el){
  const fl=el.dataset.fl,id=el.dataset.floor,f=floorById(id);
  if((fl==='on'||fl==='only')&&f)startFloorSwitchTiming();
  if(fl==='on'&&f)return floorCall(bridge.setFloorOn(id,!f.on));
  if(fl==='only'&&f)return floorCall(bridge.onlyFloor(id));
  if((fl==='up'||fl==='down')&&f){
    const ids=FLOORS.floors.map(x=>x.id),i=ids.indexOf(id),j=fl==='up'?i-1:i+1;
    if(j<0||j>=ids.length)return; [ids[i],ids[j]]=[ids[j],ids[i]];
    return floorCall(bridge.reorderFloors(ids));
  }
  if(fl==='rename'&&f){
    const r=await askDialog({title:'Rename floor',body:'1 to 40 characters. Names must be different from the other floors.',input:{label:'Name',value:f.name,max:40,focus:true},returnFocus:el,
      buttons:[{label:'Cancel',value:null},{label:'Rename',value:'ok',cls:'primary'}]});
    if(r&&typeof r.text==='string'&&r.text.trim()!==f.name)return floorCall(bridge.renameFloor(id,r.text));
    return;
  }
  if(fl==='del'&&f){
    const n=roomsOnFloor(id).length;
    const r=await askDialog({title:'Delete floor '+f.name+'?',body:(n?(n===1?'Its folder moves':'Its '+n+' folders move')+' to '+((FLOORS.floors.find(x=>x.ground)||{}).name||'the ground floor')+'. ':'')+'No folder is removed and no session is ended.',returnFocus:()=>{const b=el.closest('.floors-ui');return (b&&b.querySelector('.fl-sw'))||$('floorsBtn');},
      buttons:[{label:'Cancel',value:null},{label:'Delete floor',value:'ok',cls:'primary danger'}]});
    if(r)return floorCall(bridge.deleteFloor(id));
    return;
  }
  if(fl==='create'){
    const box=el.closest('.floors-ui'),inp=box&&box.querySelector('.fl-new input'),name=inp?inp.value:'',iid=inp&&inp.id;
    const r=await floorCall(bridge.createFloor(name));
    if(r&&r.ok){const i2=iid&&document.getElementById(iid);if(i2){i2.value='';i2.focus();}}
    return;
  }
}
function moveRoomToFloor(roomId,floorId){
  const ag=agents.find(x=>!x.parent&&x.room===roomId&&x.live);
  if(!ag||!bridge.moveFolderToFloor)return;
  return floorCall(bridge.moveFolderToFloor(ag.id,floorId));
}
function addLiveAgent(info){
  if(liveById(info.id))return;
  if(window.DurbarFolderSetup&&!info.parent)setTimeout(()=>window.DurbarFolderSetup.check(info),0); /* spec 061 FR-001: new and saved folders, once each per run */
  let room=LIVE.rooms.find(r=>r.path===info.cwd);
  if(!room){room={id:'r'+LIVE.rooms.length+':'+info.cwd,name:(info.label||info.roomName||info.name),folderName:(info.roomName||info.name),path:info.cwd,tint:TINTS[LIVE.rooms.length%4],floor:info.floor||'ground',hidden:!!info.hidden,closed:!!info.closed||CLOSED_Q.includes(info.roomName||info.name)};LIVE.rooms.push(room);}
  let name=info.name; const dup=LIVE.agents.filter(x=>!x.parent&&x.room===room.id&&x.baseName===info.name).length; if(dup)name=info.name+' #'+(dup+1);
  LIVE.agents.push({id:info.id,name:SN().displayName(info.alias,safeMask(info.title)||undefined,name),alias:info.alias,folderLabel:name,title:safeMask(info.title)||undefined,baseName:info.name,role:info.role||roleFor(info),room:room.id,state:'idle',label:info.lazy?'Not started':null,task:info.lazy?(info.resumeLast?'Your last session here. It continues when you open it.':'Saved folder. A session starts with your first message.'):'Ready. Send a message to start.',
    look:lookFor(info.id),files:[],paused:false,live:true,info,usage:{calls:0,inT:0,outT:0,nano:0},usageText:'',turn:null,worked:false,pend:new Map(),settled:new Set(),grants:[]});
  if(!demoOn){if(!ui.expanded)ui.expanded={};renderFilter();scheduleRender();loadUsageBaseline();}
  if(pendingOpen===info.id){pendingOpen=null;if(!demoOn)openPanel(info.id,false);}
}
/* ---------------- chat timeline: thinking, tools, text and sub-agent blocks in arrival order (spec 015) ---------------- */
/* Markdown (spec 016): renders are batched per animation frame and patched into the existing DOM, so streaming does not flicker. */
const MDQ=new Set();
function mdHTML(raw){
  const md=window.DurbarMD; if(!md)return esc(raw).replace(/\n/g,'<br>');
  return md.render(raw).replace(/<pre>/g,'<div class="codebox"><button type="button" class="copy" aria-label="Copy code">Copy</button><pre>').replace(/<\/pre>/g,'</pre></div>');
}
function mdPaint(el){el._mdq=false;if(el._raw==null)return;const t=document.createElement('template');t.innerHTML=mdHTML(el._raw);morphChildren(el,t.content);addCopyButtons(el);}
/* spec 005 FR-015: copy a reply (its Markdown as written) or one code block; buttons come back after every repaint */
function addCopyButtons(el){
  const mk=(cls,label)=>{const b=document.createElement('button');b.type='button';b.className='cp-btn '+cls;b.textContent='Copy';b.setAttribute('aria-label',label);b.title=label;return b;};
  el.querySelectorAll('pre').forEach(p=>{if(!p.querySelector(':scope > .cp-code'))p.appendChild(mk('cp-code','Copy this code'));});
  /* spec 052 FR-170: while the reply streams the caret is the last thing in the bubble, so the Copy button waits for the end (else the caret sat inside it) */
  const streaming=el.classList.contains('caret'),cp=el.querySelector(':scope > .cp-msg');
  if(streaming&&cp)cp.remove();
  else if(!streaming&&el.closest('.msg.agent')&&!cp)el.appendChild(mk('cp-msg','Copy this reply'));
}
document.addEventListener('click',async e=>{
  const b=e.target.closest('.cp-btn');if(!b)return;
  e.stopPropagation();
  const text=b.classList.contains('cp-cmd')?((b.parentElement.querySelector('pre.cmd')||{}).textContent||''):b.classList.contains('cp-code')?((b.parentElement.querySelector('code')||b.parentElement).textContent||'').replace(/(Copy|Copied ✓)$/,''):(b.closest('.bubble')||{})._raw||''; /* spec 052 FR-063: cp-cmd copies a tool call's command */
  try{await navigator.clipboard.writeText(text);copiedLabel(b);}
  catch{toast('Could not copy to the clipboard.',3000).classList.add('err');}
});
/* spec 052 FR-049: after a copy the button says "Copied ✓" for 1200ms, then "Copy" again */
function copiedLabel(b){clearTimeout(b._cpT);b.textContent='Copied ✓';b._cpT=setTimeout(()=>{b.textContent='Copy';},1200);}
function mdFlush(){const l=[...MDQ];MDQ.clear();l.forEach(mdPaint);}
let mdRaf=0;
function mdSet(el,raw,now){
  el._raw=raw;el.classList.add('md');
  if(now||REDUCED){mdPaint(el);return;}
  if(el._mdq)return; el._mdq=true; MDQ.add(el);
  if(!mdRaf)mdRaf=requestAnimationFrame(()=>{mdRaf=0;mdFlush();});
}
/* spec 052 (2026-10-21, measured): following the chat to the bottom read scrollHeight (a full layout of the chat) on every event,
   so a long conversation got slower with each message (27 ms per message at 1000). Now one read and one write per frame. */
let stickyRaf=0; const stickyChats=new Set();
function stickyScroll(chat){stickyChats.add(chat);if(!stickyRaf)stickyRaf=requestAnimationFrame(stickyFlush);}
function stickyFlush(){stickyRaf=0;const c=$('chat');const l=[...stickyChats];stickyChats.clear();
  if(c&&c.dataset.pin!=='0'&&l.some(chat=>chat.el.parentNode===c))c.scrollTop=c.scrollHeight;
  const bodies=[...thinkScroll];thinkScroll.clear();bodies.forEach(b=>{if(b.isConnected&&b.scrollHeight>b.clientHeight)b.scrollTop=b.scrollHeight;});}
const thinkScroll=new Set(); /* the open thinking box follows its own text, in the same frame */

function makeT(tl,chat){return {tl,chat,think:null,thinkN:0,bubble:null,chipsEl:null,chipEls:{},intent:'',typing:null};}
function tScroll(T){if(T.chat)stickyScroll(T.chat);}
function tChips(T){
  const last=T.typing&&T.typing.parentNode===T.tl?T.typing.previousElementSibling:T.tl.lastElementChild;
  if(last&&last===T.chipsEl)return T.chipsEl;
  const c=document.createElement('div');c.className='chips';c.setAttribute('aria-label','Tool calls');
  T.tl.insertBefore(c,T.typing&&T.typing.parentNode===T.tl?T.typing:null);T.chipsEl=c;return c;
}
function tAppend(T,el){T.tl.insertBefore(el,T.typing&&T.typing.parentNode===T.tl?T.typing:null);}
function newThink(T,id){
  const el=document.createElement('div');el.className='think streaming';el.dataset.t0=String(Date.now());
  el.innerHTML=`<button class="think-toggle" type="button" aria-expanded="true">${ICON('chev')}<span class="think-l">Thinking</span><span class="think-prev"></span><span class="live" aria-hidden="true"><i></i><i></i><i></i></span></button><div class="think-body md"></div>`;
  const tb=el.querySelector('.think-toggle'),body=el.querySelector('.think-body');
  tb.addEventListener('click',()=>{const o=tb.getAttribute('aria-expanded')==='true';tb.setAttribute('aria-expanded',String(!o));body.hidden=o;el.dataset.touched='1';});
  tAppend(T,el);
  return {id,el,body,raw:'',t0:Date.now()};
}
function tThink(T,id,delta){
  id=id||'r';
  let b=T.think;
  if(!b||b.id!==id){if(b)tThinkEnd(b);b=T.think=newThink(T,id);T.thinkN++;}
  b.raw+=delta;mdSet(b.body,b.raw);
  if(!REDUCED){thinkScroll.add(b.body);if(!stickyRaf)stickyRaf=requestAnimationFrame(stickyFlush);}
  tScroll(T);
}
function plainFirst(raw){return String(raw).replace(/[*_`#>\[\]]/g,'').replace(/\s+/g,' ').trim().slice(0,90);}
function tThinkEnd(b){
  if(!b||!b.el.classList.contains('streaming'))return;
  mdPaint(b.body);
  b.el.classList.remove('streaming');
  const sec=Math.max(1,Math.round((Date.now()-b.t0)/1000));
  b.el.querySelector('.think-l').textContent='Thought for '+sec+'s';
  b.el.querySelector('.think-prev').textContent=plainFirst(b.raw);
  collapseThink(b.el);
}
function tText(T,e){
  if(!T.bubble){T.bubble=document.createElement('div');T.bubble.className='bubble caret md';T.bubble._acc='';tAppend(T,T.bubble);}
  if(e.final){T.bubble._acc=e.text||T.bubble._acc;mdSet(T.bubble,T.bubble._acc,true);T.bubble.classList.remove('caret');addCopyButtons(T.bubble);const out=T.bubble._acc;T.bubble=null;tScroll(T);return out;}
  T.bubble._acc+=e.delta;mdSet(T.bubble,T.bubble._acc);tScroll(T);return null;
}
function tIntent(T,txt){
  txt=SHORT(txt,160);if(!txt||T.intent===txt)return;T.intent=txt;
  const n=document.createElement('div');n.className='intent-line';n.textContent=txt;tAppend(T,n);tScroll(T);
}
function tTool(T,e){
  const box=tChips(T);
  if(e.phase==='start'){const label=editLabel(e)||toolLabel(e.args),cmd=toolFull(e.args);const el=makeChip({tool:e.tool,label,full:cmd,res:'running',state:'run'});addChip(box,el);
    const c=T.chipEls[e.callId]={el,tool:e.tool,label,cmd,t0:e.timestamp,seen:Date.now(),box,T,state:'run',res:'running',output:'',ms:null,edit:e.edit||null};
    if(c.edit)edPaint(c);
    tAct(T,e.callId,c);}
  else{const c=T.chipEls[e.callId];if(c){
    /* spec 005 FR-019: an update may bring the whole arguments (a call that started from its streamed arguments) and the edit so far */
    if(e.edit)c.edit=e.edit;
    if(e.args!==undefined){const l=editLabel(e)||toolLabel(e.args);if(l)c.label=l;const f=toolFull(e.args);if(f)c.cmd=f;}
    if(e.phase!=='update'||e.output!=null){const full=String(e.output||''),done=e.phase!=='update';
      c.ms=done&&typeof c.t0==='number'&&typeof e.timestamp==='number'?e.timestamp-c.t0:null; /* spec 052 FR-063: duration from the start and end events' times */
      c.res=done?SHORT(full||(e.phase==='complete'?'ok':'failed'),60):'running';c.output=full;c.state=!done?'run':e.phase==='failed'?'failed':'ok';
      if(done&&T.actId===e.callId)tActNext(T);}
    if(c.edit)edQueue(c);
    else if(e.phase!=='update'||e.output!=null||e.args!==undefined)chipRepaint(c);
    if(c.edit&&T.actId===e.callId)tAct(T,e.callId,c);}}
  tScroll(T);
}
function chipRepaint(c){
  const el=makeChip({tool:c.tool,label:c.label,full:c.cmd,ms:c.ms,res:c.res,output:c.output,state:c.state});
  el.style.animation='none'; /* a repaint is not a new call: no pop (FR-021, no jank while the arguments stream) */
  if(c.el.classList.contains('open')){el.classList.add('open');el.setAttribute('aria-expanded','true');}
  c.el.replaceWith(el);c.el=el;refreshChips(c.box);
}
/* ---- spec 005 FR-020..FR-023: file edits as an edit row ("Editing app.js  src  +12 −3") and an inline diff below it ---- */
const EV=window.DurbarEditView;
/* the card's task line for a tool start: "Editing app.js" for a file edit (FR-020), else "<tool> <label>" as before */
function toolTask(e,folder,max){const lbl=editLabel(e)||toolLabel(e.args);
  if(toolKind(e.tool)==='edit'&&lbl&&!e.mcpServer)return SHORT((e.edit?EV.summary(e.edit,{running:true,simple:SIMPLE,folder}).text:'Editing '+EV.displayPath(lbl,folder).name),max);
  return e.tool+(lbl?' '+safeToolLabel(e.tool,lbl,max):'');} /* FR-065: a command through maskSecretCommand, a URL through maskSecretUrl (the way LIVEACT masks it) */
/* FR-024: the adapters mask before sending; the page masks again with the same module when it is loaded (window.DurbarRedact) */
const edRed=t=>{const R=window.DurbarRedact;try{return R&&typeof R.redact==='function'?R.redact(t):t;}catch(_){return t;}};
const editLabel=e=>e&&e.edit&&Array.isArray(e.edit.files)&&e.edit.files[0]?String(e.edit.files[0].path||''):'';
const EDQ=new Set();let edRaf=0;
/* at most one paint per row per frame while the arguments stream in (FR-021) */
function edQueue(c){EDQ.add(c);if(!edRaf)edRaf=requestAnimationFrame(()=>{edRaf=0;const l=[...EDQ];EDQ.clear();l.forEach(edPaint);});}
function edPaint(c){
  chipRepaint(c);
  const el=c.el,ed=c.edit,run=c.state==='run',sm=EV.summary(ed,{running:run,failed:c.state==='failed',simple:SIMPLE,folder:c.T.folder});
  el.classList.add('editchip');el._ed=c;
  el.querySelectorAll(':scope>.plain,:scope>b,:scope>code').forEach(x=>x.remove());
  const head=document.createElement('span');head.className='ed-head';
  const v=document.createElement('span');v.className='ed-verb';v.textContent=sm.verb;
  const n=document.createElement('b');n.className='ed-name';n.textContent=sm.name+(sm.to?' → '+sm.to:'');
  head.append(v,n);
  if(sm.dir){const d=document.createElement('span');d.className='ed-dir';d.textContent=sm.dir;head.appendChild(d);}
  if(sm.count){head.appendChild(edCount(EV.totals(ed)));}
  const ic=el.querySelector(':scope>svg');if(ic)ic.after(head);else el.prepend(head);
  el.title=sm.title+(sm.count?' ('+sm.count+')':'');
  el.setAttribute('aria-label',sm.text+(sm.dir?' in '+sm.dir:'')+(sm.count?', '+sm.count.replace('−','minus ')+' lines':''));
  edDiff(c,sm);
}
function edCount(t){const s=document.createElement('span');s.className='ed-count';
  const a=document.createElement('i');a.className='add';a.textContent='+'+t.added;const r=document.createElement('i');r.className='del';r.textContent='−'+t.removed;s.append(a,r);return s;}
/* the diff under the row: a <details> open in Expert, closed in Simple ("See what changes (+12 −3)"); 12 lines, then Show all */
function edDiff(c,sm){
  const ed=c.edit,files=(ed&&ed.files)||[],withDiff=files.filter(f=>typeof f.diff==='string'&&f.diff);
  if(!withDiff.length&&files.length<2){if(c.diffEl){c.diffEl.remove();c.diffEl=null;}return;}
  let d=c.diffEl;
  if(!d){d=document.createElement('details');d.className='ediff pdiff';if(!SIMPLE){d._auto=true;d.open=true;}
    const su=document.createElement('summary');const pre=document.createElement('pre');pre.setAttribute('aria-label','The change, as removed and added lines');d.append(su,pre);
    d.addEventListener('toggle',()=>{if(d._auto)d._auto=false;else d.dataset.touched='1';});
    d.addEventListener('click',ev=>{const b=ev.target.closest('.xall');if(!b)return;ev.preventDefault();c.all=true;edDiff(c,EV.summary(c.edit,{running:c.state==='run',failed:c.state==='failed',simple:SIMPLE,folder:c.T.folder}));});
    c.diffEl=d;}
  if(d.previousElementSibling!==c.el)c.el.after(d);
  d.hidden=c.el.hidden;
  const cnt=sm.count?' ('+sm.count+')':'';
  const su=d.querySelector('summary'); /* the labels sit on the summary: relabelScopes switches them with the level, as on the permission card */
  const notMade=c.state==='failed'; /* a refused or failed call: the lines were not written */
  su.dataset.lblExpert=(files.length>1?'The changes':'The change')+(notMade?' (not made)':'')+cnt;su.dataset.lblSimple=(notMade?'See what would have changed':'See what changes')+cnt;
  su.textContent=SIMPLE?su.dataset.lblSimple:su.dataset.lblExpert;
  /* every file's lines in one list; a file line before each when there are several */
  const rows=[];
  files.forEach(f=>{
    if(files.length>1){const p=EV.displayPath(f.path,c.T.folder);rows.push({t:'file',s:(p.rel||p.name)+(f.movedTo?' → '+EV.displayPath(f.movedTo,c.T.folder).rel:''),f});}
    if(typeof f.diff==='string'&&f.diff){const {lines,more}=ACT.diffLines(f.diff,EV.MAX_LINES);lines.forEach(l=>rows.push(l));if(more)rows.push({t:'more',s:'… '+more+' more line'+(more===1?'':'s')+' not shown'});}
  });
  if(ed&&ed.more)rows.push({t:'more',s:'… and '+ed.more+' more file'+(ed.more===1?'':'s')});
  const n=EV.shown(rows.length,c.all),pre=d.querySelector('pre'),frag=document.createDocumentFragment();
  rows.slice(0,n).forEach(l=>{const sp=document.createElement('span');sp.className='dl '+(l.t==='more'?'dmore':l.t);sp.textContent=edRed(l.s||' ');
    if(l.t==='file'&&l.f&&(l.f.added||l.f.removed||l.f.diff)){sp.textContent=edRed(l.s)+'  ';sp.appendChild(edCount({added:l.f.added||0,removed:l.f.removed||0}));}
    frag.appendChild(sp);});
  if(rows.length>n){const b=document.createElement('button');b.type='button';b.className='xall';b.textContent='Show all ('+rows.length.toLocaleString('en-US')+' lines)';frag.appendChild(b);}
  pre.replaceChildren(frag);
  d.classList.toggle('partial',!!(ed&&ed.partial));
  stickyScroll(c.T.chat);
}
/* Simple/Expert switched: rows and diffs take the other words; a diff the user opened or closed keeps that */
function relabelEdits(){const all=sel=>Object.values(chats).flatMap(ch=>ch&&ch.el?[...ch.el.querySelectorAll(sel)]:[]); /* every chat, also the ones not open now */
  all('.typing').forEach(t=>{const x=t._act;if(x)tAct(x.T,x.id,x.c);});
  all('.chip.editchip').forEach(el=>{const c=el._ed;if(!c)return;
  if(c.diffEl&&!c.diffEl.dataset.touched&&c.diffEl.open===SIMPLE){c.diffEl._auto=true;c.diffEl.open=!SIMPLE;}edPaint(c);});}
/* spec 005 FR-022: the waiting line names what runs now ("Editing app.js · 12s"); null = no tool open */
/* the current tool ended: name the newest tool still running (several can be open at once), else none */
function tActNext(T){let id=null,c=null;
  for(const [k,v] of Object.entries(T.chipEls||{}))if(v&&v.state==='run'&&(!c||(v.seen||0)>=(c.seen||0))){id=k;c=v;}
  tAct(T,id,c);}
function tAct(T,id,c){
  const ty=T.typing;if(!ty)return;
  if(!id||!c){delete ty.dataset.act;delete ty.dataset.a0;T.actId=null;ty._act=null;typingPaint(ty);return;}
  const k=toolKind(c.tool);
  const text=c.edit?EV.summary(c.edit,{running:true,simple:SIMPLE,folder:T.folder}).text:SIMPLE||k!=='tool'?plainChip(k,c.tool,c.label,true):'Using '+String(c.tool||'a tool');
  if(T.actId!==id)ty.dataset.a0=String(c.seen||Date.now()); /* the tool's own time, also when it comes back after a newer one ended */
  T.actId=id;ty._act={T,id,c};ty.dataset.act=SHORT(text,80);typingPaint(ty);
}
function typingPaint(t){const l=t.querySelector('.t-l');if(!l)return;
  const now=Date.now(),sec=Math.max(0,Math.round((now-Number(t.dataset.t0))/1000));
  /* a permission card waits in this turn: the agent is not editing, it waits for the user's answer (review on PR 463) */
  const ask=t.parentNode&&t.parentNode.querySelector('.note.perm.pending');
  if(ask){l.textContent='Waiting for your OK · '+Math.max(0,Math.round((now-Number(ask.dataset.t0||now))/1000))+'s';return;}
  if(t.dataset.act){l.textContent=t.dataset.act+' · '+Math.max(0,Math.round((now-Number(t.dataset.a0||now))/1000))+'s';return;}
  l.textContent=(t.parentNode&&t.parentNode.children.length>1?'Working':'Waiting for the model')+' · '+sec+'s';}
/* end of a turn / sub-agent run: finish blocks; say honestly when the model sent no reasoning */
function tEnd(T,opts){
  mdFlush();
  if(T.think)tThinkEnd(T.think);
  if(T.bubble){T.bubble.classList.remove('caret');addCopyButtons(T.bubble);T.bubble=null;}
  if(T.typing){T.typing.remove();T.typing=null;}
  if(!T.thinkN&&opts&&opts.note&&T.tl.children.length&&!T.tl.querySelector('.nothink')){
    const n=document.createElement('div');n.className='nothink';
    n.textContent='This model does not send reasoning for this step. The tool timeline shows what it did.';
    n.title='Some turns come back without a reasoning summary. Agent Durbar hides nothing.';
    T.tl.insertBefore(n,T.tl.firstChild);
  }
}

/* ---- sub-agents: one record per spawning `task` call; the nested block in the parent chat and the helper's own
   read-only transcript are two views of the same event log ---- */
const SUB_LOG_MAX=3000;
const SUBIC='<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="5.2" cy="5" r="2"/><circle cx="11.2" cy="6" r="1.6"/><path d="M1.8 13c0-2.4 1.5-3.8 3.4-3.8s3.4 1.4 3.4 3.8M9.6 12.6c.2-1.6 1.1-2.6 2.6-2.6 1.4 0 2.2 1 2.2 2.6"/></svg>';
function subRec(a,id,seed){
  if(!a.subs)a.subs=new Map();
  let s=a.subs.get(id);
  if(!s){
    s={id,parent:a,name:'Sub-agent',task:'',prompt:'',model:'',agentName:'',status:'running',result:'',error:'',log:[],views:[],card:null,tools:0,tokens:0,durationMs:0,t0:Date.now(),usage:{calls:0,inT:0,outT:0,nano:0}};
    a.subs.set(id,s);
    const t=ensureTurn(a); s.block=subBlock(s,t.T);
    const cid=a.id+':'+id; let card=liveById(cid);
    if(!card){card={id:cid,parent:a.id,name:'Sub-agent',role:'Helper',state:'working',label:null,task:'',look:lookFor(cid),files:[],paused:false,live:true,info:a.info,usage:{calls:0,inT:0,outT:0,nano:0},usageText:'',pend:new Map(),settled:new Set(),grants:[],sub:s};LIVE.agents.push(card);}
    card.sub=s; s.card=card;
  }
  if(seed)Object.assign(s,seed);
  return s;
}
function subStatusText(s){return s.status==='running'?'Running':s.status==='failed'?'Failed':'Done';}
function subFoot(s){
  const p=[];
  if(s.model)p.push(s.model); if(s.agentName)p.push(s.agentName);
  const ms=s.durationMs||(s.status==='running'?Date.now()-s.t0:0); if(ms)p.push((ms/1000).toFixed(1)+'s');
  if(s.tools)p.push(s.tools+' tool call'+(s.tools===1?'':'s')); if(s.tokens)p.push(fmtTok(s.tokens)+' tokens');
  return p.join(' · ');
}
/* the inner part both views share: prompt, timeline, result, footer */
function subBody(s,host,chat){
  host.insertAdjacentHTML('beforeend','<div class="sub-prompt"></div><div class="tl"></div><div class="sub-res"></div><div class="sub-err" role="alert" hidden></div><div class="sub-foot"></div>');
  const v={s,host,chat,prompt:host.querySelector('.sub-prompt'),res:host.querySelector('.sub-res'),err:host.querySelector('.sub-err'),foot:host.querySelector('.sub-foot'),T:null};
  v.T=makeT(host.querySelector('.tl'),chat);v.T.folder=s.parent&&s.parent.info&&s.parent.info.cwd;
  s.views.push(v); subPaintView(v);
  s.log.forEach(e=>subApply(v,e,true));
  return v;
}
function subPaintView(v){
  const s=v.s;
  if(s.prompt){v.prompt.hidden=false;if(v.prompt._raw!==s.prompt)v.prompt.innerHTML='<span class="lbl">Task</span><div class="pt"></div>',mdSet(v.prompt.querySelector('.pt'),s.prompt,true),v.prompt._raw=s.prompt;}
  else v.prompt.hidden=true;
  const showRes=s.result&&s.result!==s.lastFinal;
  v.res.hidden=!showRes;
  if(showRes&&v.res._raw!==s.result){v.res.innerHTML='<span class="lbl">Result</span><div class="rt"></div>';mdSet(v.res.querySelector('.rt'),s.result,true);v.res._raw=s.result;}
  v.err.hidden=!s.error; v.err.textContent=s.error?'Failed: '+s.error:'';
  v.foot.textContent=subFoot(s);
  if(v.paint)v.paint();
}
function subPaint(s){s.views.forEach(subPaintView);}
function subBlock(s,T){
  const el=document.createElement('div');el.className='subblk running';el.dataset.sub=s.id;
  el.innerHTML=`<div class="sub-head"><button class="sub-toggle" type="button" aria-expanded="true">${ICON('chev')}<span class="sub-ic">${SUBIC}</span><b class="sub-name"></b><span class="sub-task"></span><span class="sub-st"></span></button><button class="sub-open" type="button" title="Open this sub-agent's full activity (read-only)">Open</button></div><div class="sub-in"></div>`;
  const tg=el.querySelector('.sub-toggle'),inn=el.querySelector('.sub-in');
  tg.addEventListener('click',()=>{const o=tg.getAttribute('aria-expanded')==='true';tg.setAttribute('aria-expanded',String(!o));inn.hidden=o;el.dataset.touched='1';});
  tAppend(T,el);
  const v=subBody(s,inn,T.chat);
  v.paint=()=>{
    el.classList.toggle('running',s.status==='running');el.classList.toggle('failed',s.status==='failed');el.classList.toggle('done',s.status==='done');
    el.querySelector('.sub-name').textContent=s.name;
    el.querySelector('.sub-task').textContent=s.status==='running'?safeExcerpt(s.task||s.prompt,90):safeExcerpt(s.result||s.lastFinal||s.error||s.task,110);
    el.querySelector('.sub-st').textContent=subStatusText(s);
    el.querySelector('.sub-open').hidden=!s.card;
  };
  v.paint();
  v.el=el;v.toggle=tg;v.inn=inn;
  return v;
}
function subCollapse(s){const v=s.block;if(!v||v.el.dataset.touched)return;v.toggle.setAttribute('aria-expanded','false');v.inn.hidden=true;}
function subApply(v,e,replay){
  const s=v.s,T=v.T;
  switch(e.type){
  case 'user':if(!s.prompt){s.prompt=e.text;subPaintView(v);}return;
  case 'thinking':tThink(T,e.reasoningId,e.delta);return;
  case 'output':{const out=tText(T,e);if(out!=null&&!replay){}return;}
  case 'status':if(e.intent)tIntent(T,e.intent);return;
  case 'toolCall':tTool(T,e);return;
  }
}
/* an event with agentId (the spawning task call id) */
function onSubEvent(a,e){
  const s=subRec(a,e.agentId), card=s.card;
  if(e.type==='usage'){
    const u=s.usage;u.calls++;u.inT+=e.inputTokens||0;u.outT+=e.outputTokens||0;u.nano+=e.nanoAiu||0;u.usd=(u.usd||0)+(e.costUsd>0?e.costUsd:0);
    const cu=card.usage;cu.calls=u.calls;cu.inT=u.inT;cu.outT=u.outT;cu.nano=u.nano;cu.usd=u.usd;card.usageText=usageLong(card);
    const p=a.usage;p.calls++;p.inT+=e.inputTokens||0;p.outT+=e.outputTokens||0;p.nano+=e.nanoAiu||0;p.usd=(p.usd||0)+(e.costUsd>0?e.costUsd:0);a.usageText=usageLong(a);
    recordUsage(a,e);
    scheduleRender();if(ui.selected===card.id||ui.selected===a.id)updatePanelHeader();return;
  }
  if(s.log.length<SUB_LOG_MAX)s.log.push(e);
  if(e.type==='toolCall'&&e.phase==='start'){s.tools++;}
  if(e.type==='status'&&e.status==='error'){s.error=e.intent||'Error';}
  if(e.type==='user'&&!s.prompt)s.prompt=e.text;
  if(e.type==='output'&&e.final)s.lastFinal=e.text||'';
  s.views.forEach(v=>subApply(v,e));
  subPaint(s);
  /* helper card: what it is doing right now */
  if(e.type==='thinking')setState(card,'thinking',null);
  else if(e.type==='output')setState(card,'working',null,e.final?safeExcerpt(e.text,100):undefined);
  else if(e.type==='toolCall'&&e.phase==='start'){setState(card,'working',null,toolTask(e,s.parent&&s.parent.info&&s.parent.info.cwd,80));}
  else if(e.type==='status'&&e.intent)setState(card,'working',null,safeExcerpt(e.intent,100));
  if(ui.selected===card.id)updatePanelHeader();
}
function onSubagent(a,e){
  const s=subRec(a,e.subagentId), card=s.card;
  if(e.name)s.name=safeMask(e.name)||s.name; if(e.model)s.model=e.model; if(e.agentName)s.agentName=safeMask(e.agentName)||''; /* spec 041 FR-065 */
  if(e.task&&e.phase==='started')s.task=e.task;
  if(e.durationMs)s.durationMs=e.durationMs; if(e.totalTokens)s.tokens=e.totalTokens; if(e.totalToolCalls!=null)s.tools=Math.max(s.tools,e.totalToolCalls);
  card.name=s.name;card.role=s.agentName?'Helper · '+s.agentName:'Helper';
  if(e.phase==='started'){s.status='running';setState(card,'working',null,s.task||'Working');}
  else{
    s.t1=Date.now();
    if(e.phase==='failed'){s.status='failed';s.error=e.error||e.task||'Failed';setState(card,'error',null,safeExcerpt(s.error,100));}
    else{s.status='done';setState(card,'done','Done',safeExcerpt(s.result||s.task,100));}
    s.views.forEach(v=>{tEnd(v.T,{note:false});});
    subCollapse(s);
  }
  subPaint(s);scheduleRender();
}
/* tool call of the parent: `task` becomes the sub-agent block, not a chip */
const isTaskTool=t=>t==='task'||t==='agent';
function onTaskTool(a,e){
  const s=subRec(a,e.callId);
  if(e.phase==='start'){
    const g=e.args||{};
    if(g.prompt&&!s.prompt)s.prompt=String(g.prompt);
    if(g.description&&!s.task)s.task=String(g.description);
    if(g.agent_type&&!s.agentName)s.agentName=safeMask(String(g.agent_type))||''; /* spec 041 FR-065 */
    if(s.name==='Sub-agent'&&s.task)s.name=SHORT(safeMask(s.task),40);
  } else {
    if(e.phase==='complete'&&e.output)s.result=String(e.output);
    if(e.phase==='failed'){s.status='failed';s.error=String(e.output||'Failed');}
    else if(s.status==='running'){s.status='done';}
    s.views.forEach(v=>tEnd(v.T,{note:false}));
    if(s.card)setState(s.card,s.status==='failed'?'error':'done',s.status==='failed'?null:'Done',safeExcerpt(s.result||s.error||s.task,100));
    subCollapse(s);
  }
  subPaint(s);scheduleRender();
}
/* the helper's own full view (opened from a helper card): header + the shared body, read-only */
function buildSubTranscript(card,chat){
  const s=card.sub,host=chat.el;
  host.innerHTML='';
  const head=document.createElement('div');head.className='sub-ro';
  head.innerHTML='<div><b>Sub-agent activity</b><span>Read-only. It updates live while the sub-agent works. Messages go to its parent agent.</span></div><button class="btn" type="button" data-parentchat="1">Back to parent chat</button>';
  host.appendChild(head);
  const wrap=document.createElement('div');wrap.className='sub-full';
  wrap.innerHTML='<div class="sub-full-head"><span class="sub-ic"></span><h3></h3><span class="sub-st"></span></div><p class="sub-full-task"></p>';
  host.appendChild(wrap);
  const body=document.createElement('div');body.className='sub-full-body';wrap.appendChild(body);
  const v=subBody(s,body,chat);
  v.paint=()=>{wrap.querySelector('.sub-ic').innerHTML=SUBIC;wrap.querySelector('h3').textContent=s.name;wrap.querySelector('.sub-st').textContent=subStatusText(s);wrap.querySelector('.sub-st').className='sub-st '+s.status;wrap.querySelector('.sub-full-task').textContent=s.task;};
  v.paint();
  if(s.status!=='running')tEnd(v.T,{note:false});
}

function ensureTurn(a){
  if(a.turn)return a.turn;
  const chat=liveChat(a), m=document.createElement('div');m.className='msg agent';
  m.innerHTML=`<div class="meta">${esc(a.name)}</div><div class="tl"></div>`;
  chat.el.appendChild(m);
  const T=makeT(m.querySelector('.tl'),chat);T.folder=a.info&&a.info.cwd; /* spec 005 FR-020: edit paths relative to it */
  const ty=document.createElement('div');ty.className='typing';ty.dataset.t0=String(Date.now());ty.innerHTML='<i></i><i></i><i></i><span class="t-l"></span>';
  T.tl.appendChild(ty);T.typing=ty;
  const t=a.turn={m,T};
  stickyScroll(chat);return t;
}
function closeTurn(a){
  const t=a.turn; if(!t)return;
  tEnd(t.T,{note:true});
  a.turn=null;
}
function setState(a,state,label,task){
  if(typeof task==='string')task=taskMask(task); /* spec 041 FR-065: backstop, whatever path built the line (the helper masks before cutting; this one cannot repair a cut token) */
  const ch=a.state!==state||(label!==undefined&&a.label!==label)||(task!==undefined&&a.task!==task);
  a.state=state; if(label!==undefined)a.label=label; if(task!==undefined)a.task=task;
  if(SIM&&task!==undefined)(window.__taskLog=window.__taskLog||[]).push(a.task); /* simulator only: every task line ever stored, for the FR-065 driver (a line is often replaced at once) */
  if(state==='working'||state==='thinking'){if(!a.busySince)a.busySince=Date.now();}else if(state==='done'||state==='idle')a.busySince=null; /* spec 001 FR-047: time on task */
  if(ch&&a.live&&a.info&&a.info.modelControl&&a.info.modelControl.compact&&!a.parent)updateCtxChip(a); /* the Compact button is greyed while the agent works */
  if(ch)scheduleRender();
}
const SHORT=(v,n)=>DurbarCutText.cutText(v,n);
const RED=!NO_REDACT&&window.DurbarRedact&&typeof window.DurbarRedact.redact==='function'?window.DurbarRedact:null;
const STX=window.DurbarSafeText; /* if safetext.js did not load the page still draws, and shows no agent text */
const SAFE=STX?STX.create({redact:RED?t=>RED.redact(t):null,cut:SHORT}):{ready:false,mask:()=>'',excerpt:(t,n,fb)=>t?(fb==null?'Finished.':fb):''}; /* spec 041 FR-065: agent text is masked on the raw text, then made plain, then cut; no redact module: neutral words, never the raw text */
const safeExcerpt=(t,n,fb)=>SAFE.excerpt(t,n,fb),safeMask=t=>SAFE.mask(t);
/* the tool label of a task line, masked the way the live readout (LIVEACT) masks it: a command by maskSecretCommand, a URL by maskSecretUrl, else redact; then cut */
const TOOLMASK=RED?{redact:t=>RED.redact(t),cmd:t=>RED.maskSecretCommand(t),url:t=>RED.maskSecretUrl(t)}:{};
const safeToolLabel=(tool,l,n)=>{const m=STX?STX.maskLabel(l,toolKind(tool),TOOLMASK):'';return m?SHORT(m,n):'';};
/* setState's backstop (FR-065): the task text is masked. With no redact module only Durbar's own fixed words stay (agent text is blanked) */
const FIXED_TASK=new Set(['Ready','Thinking','Working','Finished.','Waiting for permission','Waiting for your OK on a plan','The agent asks you a question','Stopped. Ready for your next message.','Signed in again. Ready for your message.','Session ended. Send a message to resume it.','Ready. Send a message to start.','Plan rejected. Nothing was changed.','Continuing your last session…','Your last session here. It continues when you open it.']);
const FIXED_TASK_FORMAT=/^Stopped at \$?[\d.,]+( AIU)?\. (Raise the limit to go on|Ready for your next message)\.$/; /* Durbar's own limit lines, whole string: a prefix alone would let agent text through */
/* a permission line from an adapter ("Waiting for permission: run <command>", "Allowed: fetch <url>", ...): the part after the verb is a command or a URL, masked like a tool label (--api-key K, ?key=K) */
const PERM_LINE=/^(Waiting for permission|Denied \(read-only mode\)|Allowed for this session|Allowed|Approved|Denied): (run|fetch|write|edit|read|mcp)\b ?([\s\S]*)$/;
const taskMask=t=>{
  if(!SAFE.ready)return FIXED_TASK.has(t)||FIXED_TASK_FORMAT.test(t)?t:(/^Waiting for permission\b/.test(t)?'Waiting for permission':'');
  const p=PERM_LINE.exec(t);
  if(p){const rest=STX?STX.maskLabel(p[3],p[2]==='run'?'run':'tool',TOOLMASK):'';return p[1]+': '+p[2]+(rest?' '+rest:'');}
  return SAFE.mask(t);};
/* a working or error intent: masked and plain through the helper (a permission line is left to taskMask, which keeps its command's own characters) */
const intentText=t=>typeof t!=='string'||!t||PERM_LINE.test(t)?t:(SAFE.ready?SAFE.excerpt(t,null,''):t);
const toolArg=args=>!args||typeof args!=='object'?'':String(args.path||args.pattern||args.command||args.url||args.query||args.file_path||Object.values(args).find(x=>typeof x==='string')||'');
function toolLabel(args){return toolArg(args).replace(/\s+/g,' ').slice(0,400);}
/* spec 052 FR-063: the whole argument as written (line breaks kept), for the open chip; at most 20000 characters */
const toolFull=args=>toolArg(args).slice(0,OUT_SHOWN);
/* ---------------- AI-credit cap: chip, dialog, limit reached (spec 011) ---------------- */
let APP_SETTINGS={};
function capChipHTML(a){
  if(!feat(a,'cap'))return ''; /* this agent kind has no credit cap: no chip (spec 012 FR-061) */
  const c=capOf(a),used=capUsed(a),pct=c?Math.min(100,Math.round(used/c*100)):0;
  const cls=!c?'unk':a.limit?'high':pct>=80?'warn':'ok';
  if(isUsdCap(a)){
    const t2=c?'$'+used.toFixed(2)+' / $'+c.toFixed(2):SIMPLE?'No spending limit':'Limit: none'; /* spec 052 FR-093: plain words in Simple */
    const ti=c?'Spending limit: about $'+used.toFixed(2)+' of $'+c.toFixed(2)+' used ('+pct+'%). Claude\'s estimate, not a bill. Click to change or remove it.':'No spending limit for this session. Click to set one in dollars (Claude\'s estimate, min $0.01).';
    return `<button class="ctxchip capchip ${cls}" id="capChip" type="button" title="${esc(ti)}"><span class="bar" aria-hidden="true"><i style="width:${c?pct:0}%"></i></span><span>${esc(t2)}</span></button>`;
  }
  const text=c?used.toFixed(capDigits(c))+' / '+fmtCap(c)+' AIU':SIMPLE?'No spending limit':'Limit: none';
  const title=c?'Spending limit: '+used.toFixed(2)+' of '+fmtCap(c)+' AIU used ('+pct+'%). A soft limit: one response can pass it. Click to change or remove it.':'No spending limit for this session. Click to set one (at least 30 AIU).';
  return `<button class="ctxchip capchip ${cls}" id="capChip" type="button" title="${esc(title)}"><span class="bar" aria-hidden="true"><i style="width:${c?pct:0}%"></i></span><span>${esc(text)}</span></button>`;
}
function updateCapChip(a){
  const el=$('capChip');if(!el||!ui.selected)return;const cur=byId(ui.selected);if(!cur||liveRoot(cur)!==a)return;
  el.outerHTML=capChipHTML(a);
}
function closeCapDlg(){const d=document.getElementById('capDlg');if(d)d.remove();}
function openCapDialog(a){
  closeCapDlg();
  const cur=capOf(a),usd=isUsdCap(a),min=usd?MIN_USD_CAP:MIN_CAP;
  const d=document.createElement('div');d.id='capDlg';d.className='dlg-ov';
  d.innerHTML=`<div class="dlg m" role="dialog" aria-modal="true" aria-labelledby="cdT"><h3 id="cdT">Spending limit for ${esc(a.name)}</h3>
   ${usd?`<p class="dsub">The most this session may cost. When it is reached the agent stops and asks you.</p>
   <ul class="dlist"><li>In dollars, Claude's own estimate: not a bill.</li><li>A <b>soft</b> limit: one turn can go a little past it.</li><li>It counts what the session used while Agent Durbar ran it, and is not saved with the folder. The minimum is $${MIN_USD_CAP}.</li></ul>`
   :`<p class="dsub">The most AI credits this session may use. When it is reached the agent stops and asks you.</p>
   <ul class="dlist"><li>1 credit = USD 0.01; shown as AIU, the unit the Copilot runtime reports.</li><li>A <b>soft</b> limit: it is checked after each model response, so one response can go past it.</li><li>The minimum is ${MIN_CAP}.</li></ul>`}
   <label>${usd?'Limit ($, estimate)':'Limit (AI credits)'}<input id="cdVal" type="number" min="${min}" step="${usd?'0.01':'1'}" placeholder="No limit" value="${cur||''}"></label>
   <p class="dsub small cd-plan">${esc(window.DurbarCost.PLAN_NOTE)}</p><!-- spec 052 FR-058 --><!-- spec 052 (2026-10-21): the Copilot plan note said the same as the line above; it stays in Tools > Cost --><!-- spec 052 FR-075 -->
   <p class="derr" id="cdErr" role="alert" hidden></p>
   <div class="dbtn"><button class="btn" id="cdCancel" type="button">Cancel</button><button class="btn" id="cdNone" type="button">Remove limit</button><button class="btn primary" id="cdSave" type="button">Save</button></div></div>`;
  document.body.appendChild(d);
  const apply=async v=>{
    const r=await bridge.setCap(a.id,v).catch(e=>({ok:false,error:String(e&&e.message||e)}));
    if(!r||!r.ok){const er=$('cdErr');er.textContent=(r&&r.error)||'Could not change the limit.';er.hidden=false;return;}
    a.info.maxAiCredits=r.maxAiCredits||undefined;a.usageText=usageLong(a);closeCapDlg();updateCapChip(a);updatePanelHeader();scheduleRender();
    toast(esc(a.name)+': '+(v===null?'no spending limit.':'spending limit <b>'+esc(fmtCapOf(a,v))+'</b>.'),3200);
  };
  $('cdCancel').onclick=closeCapDlg;$('cdNone').onclick=()=>apply(null);
  $('cdSave').onclick=()=>{const v=parseFloat($('cdVal').value);if(!(v>=min)||v>(usd?1e4:1e6)){const er=$('cdErr');er.textContent=usd?'Enter an amount from $'+MIN_USD_CAP+' to $10,000, or use Remove limit.':'Enter a number from '+MIN_CAP+' (the runtime minimum), or use Remove limit.';er.hidden=false;return;}apply(Math.round(v*100)/100);};
  d.addEventListener('click',e=>{if(e.target===d)closeCapDlg();});
  d.addEventListener('keydown',e=>{if(e.key==='Escape'){e.stopPropagation();closeCapDlg();}if(e.key==='Enter'&&e.target.id==='cdVal')$('cdSave').click();});
  $('cdVal').focus();
}
document.addEventListener('click',e=>{const c=e.target.closest('#capChip');if(!c)return;const a=byId(ui.selected);if(a)openCapDialog(liveRoot(a));});
/* The runtime reached the cap and waits for the user: inline notice with Raise limit / Remove limit / Stop here (spec 052 FR-075: "Raise limit" for both units: it raises Durbar's limit, it buys nothing). */
function showLimit(a,e){
  const t=ensureTurn(a);
  const usd=isUsdCap(a),max=e.maxAiCredits||capOf(a),used=e.usedAiCredits!=null?e.usedAiCredits:capUsed(a);
  const n=document.createElement('div');n.className='note perm limit';n.setAttribute('role','group');n.setAttribute('aria-label','Spending limit reached');
  n.innerHTML='<b>Spending limit reached:</b> <span class="psum"></span><span class="pstate"></span>';
  n.querySelector('.psum').textContent=usd?'about $'+used.toFixed(2)+' of $'+(max||0).toFixed(2)+' (Claude\'s estimate). The agent waits for you.':'used '+used.toFixed(2)+' of '+fmtCap(max)+' AIU. The agent waits for you.';
  const row=document.createElement('div');row.className='note-actions';
  const amt=document.createElement('input');amt.type='number';amt.min='0.01';amt.step=usd?'0.01':'1';amt.value=String(max||(usd?MIN_USD_CAP:MIN_CAP));amt.className='limit-amt';amt.setAttribute('aria-label',usd?'Dollars to add to the limit':'AI credits to add to the limit');
  const mk=(l,cls,title,fn)=>{const b=document.createElement('button');b.type='button';b.className='btn '+cls;b.textContent=l;if(title)b.title=title;b.onclick=fn;row.appendChild(b);return b;};
  const answer=async choice=>{
    const r=await bridge.resolveLimit(a.id,e.requestId,choice).catch(err=>({ok:false,error:String(err&&err.message||err)}));
    if(!r||!r.ok){addNote(liveChat(a),'Could not answer the spending limit: '+esc((r&&r.error)||'unknown error'),true);return;}
    settleLimit(a,choice.kind);
  };
  row.appendChild(amt);
  mk('Raise limit','primary',usd?'Let the agent use this many more dollars (counted from what it used or the limit, whichever is higher) and continue':'Raise the limit by this many AI credits and let the agent continue',()=>{const v=parseFloat(amt.value);if(!(v>0)){amt.focus();return;}answer({kind:'add',credits:Math.round(v*100)/100});});
  mk('Remove limit','session','Remove the limit and let the agent continue',()=>answer({kind:'unset'}));
  mk('Stop here','danger','Cancel the blocked request. The agent is ready for your next message (the limit stays).',()=>answer({kind:'cancel'}));
  n.appendChild(row);
  a.limit={requestId:e.requestId,n,row,st:n.querySelector('.pstate')};
  tChips(t.T).appendChild(n);stickyScroll(liveChat(a));
}
/* ---------- questions from the agent (spec 012 FR-130): options as buttons, "Other" text, Answer / Skip; text only, never HTML ---------- */
/* ---------------- plan first (spec 066): the agent's proposed plan, with Approve / Revise… / Reject ---------------- */
function showPlan(a,e){
  if(a.plan&&a.plan.requestId===e.requestId)return;
  const t=ensureTurn(a);
  const n=document.createElement('div');n.className='note perm plan-card';n.setAttribute('role','group');n.setAttribute('aria-label','Proposed plan');
  const head=document.createElement('b');head.textContent='Proposed plan';n.appendChild(head);
  const st=document.createElement('span');st.className='pstate';n.appendChild(st);
  const body=document.createElement('div');body.className='md plan-body';body.innerHTML=mdHTML(e.text||'(The agent sent an empty plan.)');n.appendChild(body);
  const mode=a.info&&a.info.permMode;
  const why=document.createElement('p');why.className='plan-why';why.textContent='Nothing has changed yet. Approve to let the agent carry it out in '+(MODE_NAME[mode]||'the current mode')+(mode==='read-only'?': changes will be refused, switch the mode first if it should edit.':'.');n.appendChild(why);
  const row=document.createElement('div');row.className='note-actions';
  const btn=(label,cls,fn)=>{const b=document.createElement('button');b.type='button';b.className='btn '+cls;b.textContent=label;b.onclick=fn;row.appendChild(b);return b;};
  const answer=async(ans)=>{row.querySelectorAll('button').forEach(b=>b.disabled=true);const r=await bridge.resolvePlan(a.id,e.requestId,ans).catch(err=>({ok:false,error:String(err&&err.message||err)}));if(!r||!r.ok){row.querySelectorAll('button').forEach(b=>b.disabled=false);toast('Could not answer the plan: '+esc((r&&r.error)||'unknown error'),5000).classList.add('err');}};
  const ok=btn('Approve','primary',()=>answer({kind:'approve'}));
  btn('Revise…','',async()=>{const v=await askDialog({title:'Revise the plan',body:'Tell the agent what to change. It sends a new plan; nothing runs until you approve.',input:{label:'What should change',multiline:true,max:4000,focus:true},need:{text:true},buttons:[{label:'Cancel',value:null},{label:'Send',value:'ok',cls:'primary'}]});if(v&&v.value==='ok'&&v.text&&v.text.trim())answer({kind:'revise',feedback:v.text.trim()});});
  btn('Reject','',()=>answer({kind:'reject'}));
  n.appendChild(row);
  tChips(t.T).appendChild(n);stickyScroll(liveChat(a));
  a.plan={requestId:e.requestId,n,st,row};
  if(ui.selected===a.id)ok.focus();
}
function settlePlan(a,action){
  const P=a.plan;if(!P)return;a.plan=null;
  P.row.remove();
  P.st.textContent=' → '+(action==='approve'?'approved':action==='revise'?'sent back with your changes':'rejected');P.n.classList.add('settled',action==='approve'?'approved':'denied');
  if(action==='reject'){closeTurn(a);a.worked=false;setState(a,'idle',null,'Plan rejected. Nothing was changed.');}
  else setState(a,'working',null,action==='approve'?'Carrying out the plan':'Revising the plan');
}
function showQuestion(a,e){
  if(e.elicitation&&typeof e.elicitation==='object'){showElicitation(a,e);return;}
  const t=ensureTurn(a), qs=(e.questions||[]).slice(0,4);
  const n=document.createElement('div');n.className='note perm question';n.setAttribute('role','group');n.setAttribute('aria-label','Question from the agent');
  const head=document.createElement('b');head.textContent=qs.length>1?'Questions from the agent':'Question from the agent';n.appendChild(head);
  const st=document.createElement('span');st.className='pstate';n.appendChild(st);
  const picks=qs.map(()=>new Set()), others=[];
  qs.forEach((q,i)=>{
    const box=document.createElement('div');box.className='q-item';
    const qt=document.createElement('p');qt.className='q-text';
    if(q.header){const h=document.createElement('span');h.className='tag';h.textContent=q.header;qt.appendChild(h);qt.appendChild(document.createTextNode(' '));}
    qt.appendChild(document.createTextNode(q.question));box.appendChild(qt);
    const opts=document.createElement('div');opts.className='q-opts';opts.setAttribute('role',q.multiSelect?'group':'radiogroup');opts.setAttribute('aria-label',q.question);
    (q.options||[]).forEach(o=>{const b=document.createElement('button');b.type='button';b.className='btn q-opt';b.setAttribute(q.multiSelect?'aria-pressed':'aria-checked','false');if(!q.multiSelect)b.setAttribute('role','radio');
      const lb=document.createElement('span');lb.className='q-lbl';lb.textContent=o.label;b.appendChild(lb);b.title=DurbarCutText.cutText(o.description?o.label+' — '+o.description:o.label,300); /* FR-140: the title always has the label; FR-168: a data tooltip is at most 300 characters */
      if(o.description){const d=document.createElement('span');d.className='q-desc';d.textContent=o.description;b.appendChild(d);} /* spec 052 FR-160: the description is on screen, not only in the tooltip */
      b.onclick=()=>{const s=picks[i];if(q.multiSelect){s.has(o.label)?s.delete(o.label):s.add(o.label);b.setAttribute('aria-pressed',String(s.has(o.label)));b.classList.toggle('primary',s.has(o.label));}
        else{s.clear();s.add(o.label);opts.querySelectorAll('.q-opt').forEach(x=>{x.setAttribute('aria-checked',String(x===b));x.classList.toggle('primary',x===b);});others[i].value='';others[i].classList.remove('chosen');others[i].style.height='';}};
      opts.appendChild(b);});
    /* spec 052 FR-160/FR-161: a box that grows with its text; typing chooses it; Enter sends the card (Answer's own handler), Shift+Enter adds a line */
    const other=document.createElement('textarea');other.rows=1;other.maxLength=500;other.className='q-other';other.placeholder='Other answer (Enter to send)';other.setAttribute('aria-label','Other answer: '+q.question);
    const hint=document.createElement('span');hint.className='sr-only';hint.id='qh'+(++qFormSeq);hint.textContent='Enter sends this answer. Shift+Enter adds a line.';
    other.setAttribute('aria-describedby',hint.id);other.setAttribute('aria-keyshortcuts','Enter');
    const grow=()=>{other.style.height='auto';other.style.height=other.scrollHeight+2+'px';};
    other.oninput=()=>{const has=!!other.value.trim();other.classList.toggle('chosen',has);
      if(has&&!q.multiSelect){picks[i].clear();opts.querySelectorAll('.q-opt').forEach(x=>{x.setAttribute('aria-checked','false');x.classList.remove('primary');});}grow();};
    other.addEventListener('keydown',ev=>{if(ev.key!=='Enter'||ev.shiftKey||ev.isComposing||ev.altKey||ev.ctrlKey||ev.metaKey)return;ev.preventDefault();
      if(!other.value.trim()){announce('Type an answer first, or choose an option and press Answer.');return;}ok.click();});
    others.push(other);opts.appendChild(other);opts.appendChild(hint);box.appendChild(opts);n.appendChild(box);
  });
  const row=document.createElement('div');row.className='note-actions';
  const send=async answers=>{
    const r=await bridge.answerQuestion(a.id,e.requestId,answers).catch(err=>({ok:false,error:String(err&&err.message||err)}));
    if(!r||!r.ok){addNote(liveChat(a),'Could not answer: '+esc((r&&r.error)||'unknown error'),true);return;}
    settleQuestion(a,answers);
  };
  const ok=document.createElement('button');ok.type='button';ok.className='btn primary';ok.textContent='Answer';
  ok.onclick=()=>{const ans={};qs.forEach((q,i)=>{const o=others[i].value.replace(/\s+/g,' ').trim();const v=[...picks[i]].concat(o?[o]:[]).join(', ');if(v)ans[q.question]=v;});
    if(Object.keys(ans).length<qs.length){const miss=qs.findIndex(q=>!ans[q.question]);(others[miss]||ok).focus();toast('Choose an answer for each question, or Skip.',3500);return;}send(ans);};
  const skip=document.createElement('button');skip.type='button';skip.className='btn danger';skip.textContent='Skip';skip.title='Do not answer; the agent decides itself';skip.onclick=()=>send(null);
  row.appendChild(ok);row.appendChild(skip);n.appendChild(row);
  a.question={requestId:e.requestId,n,row,st};
  tChips(t.T).appendChild(n);stickyScroll(liveChat(a));
  announce(a.name+' asks: '+(safeMask((qs[0]&&qs[0].question)||'')||'a question'));renderInboxBtn();
}
/* ---------- MCP elicitation (spec 012 FR-151): a form in the question card, or an https page opened only after a click.
   Text only, never HTML; values are never logged or shown afterwards. Main checks the answer again before the agent gets it. ---------- */
const Q_SECRET=/pass(word|phrase|wd|code)?|token|secret|api[\s_.-]?key|private[\s_.-]?key|credential|\bpin\b|otp/i;
let qFormSeq=0;
/* the plain-words check of one field (the same rules main applies); '' = fine */
function elicitCheck(f,el){
  const name='"'+f.title+'"';
  if(f.type==='boolean')return '';
  const raw=el.value, v=f.type==='string'?raw:raw.trim();
  if(v.trim()===''){if(f.required)return 'Fill in '+name+'.';if(f.type==='number'||f.type==='integer'){if(el.validity&&el.validity.badInput)return name+' must be a number.';}return '';}
  if(f.type==='number'||f.type==='integer'){const n=Number(v);if(!isFinite(n))return name+' must be a number.';if(f.type==='integer'&&!Number.isInteger(n))return name+' must be a whole number.';
    if(typeof f.min==='number'&&n<f.min)return name+' must be at least '+f.min+'.';if(typeof f.max==='number'&&n>f.max)return name+' must be at most '+f.max+'.';return '';}
  if(f.type==='enum')return (f.enumValues||[]).includes(v)?'':name+' must be one of the choices.';
  const mx=Math.min(typeof f.maxLength==='number'?f.maxLength:2000,2000);
  if(v.length>mx)return name+' must be at most '+mx+' characters.';
  if(typeof f.minLength==='number'&&v.length<f.minLength)return name+' must be at least '+f.minLength+' characters.';
  const t=v.trim();
  if(f.format==='email'&&!/^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{1,63}$/.test(t))return name+' must be an email address.';
  if(f.format==='uri'){try{new URL(t);}catch(_){return name+' must be a web address.';}}
  if(f.format==='date'&&!/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(t))return name+' must be a date (YYYY-MM-DD).';
  if(f.format==='date-time'&&isNaN(Date.parse(t)))return name+' must be a date and time.';
  return '';
}
function showElicitation(a,e){
  const t=ensureTurn(a), R=e.elicitation, isUrl=typeof R.url==='string'&&!!R.url, fields=Array.isArray(R.fields)?R.fields.slice(0,12):[];
  const uid='qf'+(++qFormSeq);
  const n=document.createElement('div');n.className='note perm question elicit';n.setAttribute('role','group');n.setAttribute('aria-label',isUrl?'An MCP server asks you to open a page':'An MCP server asks for input');
  const head=document.createElement('b');head.textContent=isUrl?'An MCP server asks you to open a page':'An MCP server asks for input';n.appendChild(head);
  const st=document.createElement('span');st.className='pstate';n.appendChild(st);
  const qt=document.createElement('p');qt.className='q-text';qt.id=uid+'-msg';
  if(R.source){const h=document.createElement('span');h.className='tag';h.textContent=SHORT(R.source,40);qt.appendChild(h);qt.appendChild(document.createTextNode(' '));}
  qt.appendChild(document.createTextNode(SHORT(R.message||'',2000)));n.appendChild(qt);n.setAttribute('aria-describedby',qt.id);
  const row=document.createElement('div');row.className='note-actions';
  const btn=(label,cls,title,fn)=>{const b=document.createElement('button');b.type='button';b.className='btn '+cls;b.textContent=label;if(title)b.title=title;b.onclick=fn;return b;};
  const inputs=[];
  const busy=on=>row.querySelectorAll('button').forEach(b=>{if(on){b.dataset.was=b.disabled?'1':'';b.disabled=true;}else b.disabled=b.dataset.was==='1';});
  const send=async(action,values)=>{
    busy(true);
    const r=bridge.answerElicitation?await bridge.answerElicitation(a.id,e.requestId,action,values).catch(err=>({ok:false,error:String(err&&err.message||err)})):{ok:false,error:'This build cannot answer MCP requests.'};
    if(!r||!r.ok){busy(false);const bad=r&&r.field?inputs.find(x=>x.f.name===r.field):null;
      if(bad){bad.err.textContent=r.error||'Check this field.';bad.el.setAttribute('aria-invalid','true');bad.el.focus();}
      else addNote(liveChat(a),'Could not answer: '+esc((r&&r.error)||'unknown error'),true);return;}
    settleQuestion(a,null,action);
  };
  if(isUrl){
    const box=document.createElement('div');box.className='q-urlbox';
    const lead=document.createElement('p');lead.className='q-help';lead.textContent='This opens a page on:';box.appendChild(lead);
    const host=document.createElement('p');host.className='q-host';host.style.margin='0';host.textContent=R.host||'';box.appendChild(host);
    const full=document.createElement('p');full.className='q-url';full.textContent=SHORT(R.url,240);box.appendChild(full);
    n.appendChild(box);
    const done=btn('Done','primary','I finished on that page',()=>send('accept'));done.hidden=true;
    const open=btn('Open in browser','primary q-open','Open '+(R.host||'the page')+' in your browser',async()=>{
      const r=bridge.openElicitationUrl?await bridge.openElicitationUrl(a.id,e.requestId).catch(()=>({ok:false})):{ok:false,error:'This build cannot open it.'};
      if(!r||!r.ok){addNote(liveChat(a),'Could not open the page: '+esc((r&&r.error)||'unknown error'),true);return;}
      open.className='btn q-open';open.textContent='Open again';done.hidden=false;done.focus();announce('Opened '+(R.host||'the page')+' in your browser. Press Done when you have finished there.');});
    row.appendChild(open);row.appendChild(done);
  }else{
    const form=document.createElement('form');form.className='q-form';form.noValidate=true;form.setAttribute('aria-label','Form from '+(R.source||'an MCP server'));
    fields.forEach((f,i)=>{
      const id=uid+'-'+i, wrap=document.createElement('div');wrap.className='q-field';
      const label=document.createElement('label');label.htmlFor=id;label.textContent=f.title||f.name;
      if(f.required){const m=document.createElement('span');m.className='q-req';m.setAttribute('aria-hidden','true');m.textContent=' *';label.appendChild(m);}
      let el;
      if(f.type==='boolean'){el=document.createElement('input');el.type='checkbox';el.checked=f.default===true;const c=document.createElement('div');c.className='q-check';c.appendChild(el);c.appendChild(label);wrap.appendChild(c);}
      else{
        if(f.type==='enum'){el=document.createElement('select');const vals=f.enumValues||[];
          const none=document.createElement('option');none.value='';none.textContent=f.required?'Choose…':'(none)';el.appendChild(none);
          vals.forEach((v,j)=>{const o=document.createElement('option');o.value=v;o.textContent=(f.enumNames&&f.enumNames[j])||v;el.appendChild(o);});
          if(typeof f.default==='string'&&vals.includes(f.default))el.value=f.default;}
        else if(f.type==='number'||f.type==='integer'){el=document.createElement('input');el.type='number';el.step=f.type==='integer'?'1':'any';el.inputMode=f.type==='integer'?'numeric':'decimal';
          if(typeof f.min==='number')el.min=String(f.min);if(typeof f.max==='number')el.max=String(f.max);if(typeof f.default==='number')el.value=String(f.default);}
        else{el=document.createElement('input');const secret=f.secret||Q_SECRET.test(f.name+' '+(f.title||''));
          el.type=secret?'password':f.format==='email'?'email':f.format==='uri'?'url':f.format==='date'?'date':f.format==='date-time'?'datetime-local':'text';
          el.maxLength=Math.min(typeof f.maxLength==='number'?f.maxLength:2000,2000);el.autocomplete='off';el.spellcheck=false;
          if(!secret&&typeof f.default==='string')el.value=f.default;}
        el.className='q-input';wrap.appendChild(label);wrap.appendChild(el);
      }
      el.id=id;el.name=f.name;if(f.required)el.setAttribute('aria-required','true');
      const desc=[];
      if(f.description){const h=document.createElement('p');h.className='q-help';h.style.margin='0';h.id=id+'-help';h.textContent=f.description;wrap.appendChild(h);desc.push(h.id);}
      const err=document.createElement('span');err.className='q-err';err.id=id+'-err';err.setAttribute('aria-live','polite');wrap.appendChild(err);desc.push(err.id);
      el.setAttribute('aria-describedby',desc.join(' '));
      el.addEventListener('input',()=>{if(err.textContent){err.textContent='';el.removeAttribute('aria-invalid');}});
      inputs.push({f,el,err});form.appendChild(wrap);
    });
    const submit=()=>{
      let first=null;const values={};
      for(const x of inputs){const m=elicitCheck(x.f,x.el);x.err.textContent=m;if(m){x.el.setAttribute('aria-invalid','true');if(!first)first=x;}else x.el.removeAttribute('aria-invalid');
        if(!m){if(x.f.type==='boolean')values[x.f.name]=x.el.checked;else{const v=x.el.value;if(v.trim()!=='')values[x.f.name]=(x.f.type==='number'||x.f.type==='integer')?Number(v):v;}}}
      if(first){first.el.focus();announce(first.err.textContent);return;}
      send('accept',values);
    };
    form.onsubmit=ev=>{ev.preventDefault();submit();};
    form.addEventListener('keydown',ev=>{if(ev.key==='Enter'&&ev.target&&ev.target.tagName==='INPUT'&&ev.target.type!=='checkbox'){ev.preventDefault();submit();}});
    n.appendChild(form);
    row.appendChild(btn('Submit','primary','Send these answers to the MCP server',submit));
  }
  row.appendChild(btn('Decline','danger','Say no to this request',()=>send('decline')));
  row.appendChild(btn('Cancel','ghost','Dismiss it without answering',()=>send('cancel')));
  n.appendChild(row);
  a.question={requestId:e.requestId,n,row,st,elicit:isUrl?'url':'form'};
  tChips(t.T).appendChild(n);stickyScroll(liveChat(a));
  announce(a.name+': '+(R.source?R.source+' ':'an MCP server ')+(isUrl?'asks you to open a page on '+(R.host||'the web'):'asks for input')+'. '+safeExcerpt(R.message||'',160,''));renderInboxBtn();
}
function settleQuestion(a,answers,action){
  const Q=a.question;if(!Q)return;a.question=null;
  if(Q.row)Q.row.remove();Q.n.querySelectorAll('.q-opts,.q-form,.q-urlbox').forEach(x=>x.remove());
  /* spec 012 FR-151: an elicitation says what the user did, never the values (they can be secrets) */
  if(Q.elicit){const acc=action==='accept';Q.st.textContent=' → '+(acc?(Q.elicit==='url'?'done':'submitted'):action==='decline'?'declined':'cancelled');Q.n.classList.add('settled',acc?'approved':'denied');
    if(a.state==='waiting')setState(a,'working',null,acc?'Answered':action==='decline'?'Declined':'Cancelled');updatePanelHeader();stickyScroll(liveChat(a));return;}
  Q.st.textContent=answers?' → answered: '+Object.values(answers).join('; '):' → skipped';
  Q.n.classList.add('settled',answers?'approved':'denied');
  if(a.state==='waiting')setState(a,'working',null,answers?'Answered':'Question skipped'); /* a Stop already set it idle */
  updatePanelHeader();stickyScroll(liveChat(a));
}
function settleLimit(a,action){
  const L=a.limit;if(!L)return;a.limit=null;
  if(a.coffee)endCoffee(a,action==='cancel'?'stopped':'limit raised'); /* spec 068: the cap's coffee break ends with the answer */
  if(L.row)L.row.remove();
  const word=action==='cancel'?'stopped here':action==='unset'?'limit removed':isUsdCap(a)?'limit raised':'credits added';
  L.st.textContent=' → '+word;L.n.classList.add('settled',action==='cancel'?'denied':'approved');
  const what='the spending limit';
  if(action==='cancel'){closeTurn(a);a.worked=false;setState(a,'idle',null,'Stopped at '+what+'. Ready for your next message.');}
  else setState(a,'working',null,'Continuing after '+what);
  updateCapChip(a);stickyScroll(liveChat(a));
}
/* ---------------- coffee break (spec 068): a usage limit puts the agent in the coffee corner until the limit resets ---------------- */
const COFFEE=window.DurbarCoffee;
let BREAK_RESUME='auto'; /* the setting (FR-006): 'auto' resumes by itself when it costs nothing extra; 'ask' always asks */
const SIM_BREAK=(()=>{try{const q=new URLSearchParams(location.search);return q.has('sim')&&q.has('simbreak');}catch(e){return false;}})(); /* simulator drivers: short waits (FR-017) */
const BREAKS=COFFEE.createBreaks(SIM_BREAK?{marginMs:2000,gapMs:3000,lateMs:600000,remindMs:20000}:{});
const coffeeWord=()=>'Coffee break'; /* a status word: plain in every theme (spec 035: status pills keep their size); only the corner's name is themed */
const coffeeUntil=a=>{const b=BREAKS.get(a.id);return b?COFFEE.untilText(b,BREAKS.autoResumes(a.id),Date.now()):'';};
const LIMIT_WORD='Limit reached'; /* spec 001 FR-035: the cap's label at the Bank (spec 011's words, a status word: not themed) */
const breakWord=a=>{const b=BREAKS.get(a.id);return b&&b.kind==='cap'?LIMIT_WORD:coffeeWord();};
const coffeeTask=a=>breakWord(a)+' — '+coffeeUntil(a);
/* "until 14:30" for the coffee corner and Bank entries and labels (FR-014; visitorWords cuts it for tooltips) */
const coffeeUntilWords=a=>{const b=a&&BREAKS.get(a.id);return b?(b.kind==='cap'?'until you raise the limit':b.resetsAt?'until '+COFFEE.whenText(b.resetsAt,Date.now()):'until the limit resets'):'';};
/* the card's sentence: what is used up, and what happens next */
function coffeeSentence(a){
  const b=BREAKS.get(a.id); if(!b)return '';
  const when=b.resetsAt?COFFEE.atWhen(b.resetsAt,Date.now())+(b.estimated?' (an estimate)':''):''; /* "at 14:30", "Fri 9:00", "1 Nov" (FR-004) */
  const what=SIMPLE||!b.source?'The usage limit is used up.':b.source+' is used up.';
  if(b.phase==='back')return 'The limit has reset. Resume sends one message so the agent continues where it stopped.';
  const next=BREAKS.autoResumes(a.id)?' The agent comes back '+when+' and continues by itself.':b.resetsAt?' The limit resets '+when+'; the agent will ask you before it goes on'+(b.paid?' (going on may be billed).':'.'):' The agent app did not say when it resets.';
  return what+next+' Try now sends one message to continue (after a long break it can cost a little more).';
}
/* the chat card (FR-009): Try now / Stay on break, or, once the limit has reset and the agent asks, Resume / Not now. The inbox copies the buttons. */
function showCoffee(a,back){
  const chat=liveChat(a), b=BREAKS.get(a.id); if(!b)return;
  if(a.coffeeCard){a.coffeeCard.classList.add('settled');const r=a.coffeeCard.querySelector('.note-actions');if(r)r.remove();}
  const n=document.createElement('div');n.className='note perm coffee';n.setAttribute('role','group');n.setAttribute('aria-label',coffeeWord());
  n.innerHTML='<b></b> <span class="psum"></span><span class="pstate"></span>';
  n.querySelector('b').textContent=(back?'Back from the '+coffeeWord().toLowerCase():coffeeWord())+':';
  n.querySelector('.psum').textContent=coffeeSentence(a);
  const row=document.createElement('div');row.className='note-actions';
  const mk=(l,cls,title,fn)=>{const x=document.createElement('button');x.type='button';x.className='btn '+cls;x.textContent=l;x.title=title;x.onclick=fn;row.appendChild(x);return x;};
  if(back){
    mk('Resume','primary','Send one message so the agent continues where it stopped',()=>resumeCoffee(a,'user'));
    mk('Not now','','Leave it here; the agent goes on with your next message',()=>{endCoffee(a,'not now');setState(a,'idle',null,'The usage limit has reset. Send a message to go on.');});
  } else {
    mk('Try now','primary','Send one message now so the agent continues (if the limit has not reset yet, it goes back on its break)',()=>resumeCoffee(a,'user'));
    if(BREAKS.autoResumes(a.id))mk('Stay on break','','Do not continue by itself; ask me when the limit resets',()=>{BREAKS.stay(a.id);showCoffee(a,false);setState(a,'waiting',coffeeWord(),coffeeTask(a));});
  }
  n.appendChild(row);
  chat.el.appendChild(n);stickyScroll(chat);
  a.coffeeCard=n;
  scheduleRender();
}
/* FR-001..FR-004: the agent goes on a break (a usage limit of its agent app, or Durbar's own cap) */
function startCoffee(a,info){
  const b=BREAKS.start(a.id,Object.assign({app:kindOf(a)},info),BREAK_RESUME); if(!b)return;
  const isNew=!a.coffee;
  a.coffee=true;a.coffeeKind=b.kind;if(isNew)a.coffeeShut=false;
  if(b.kind==='provider'){closeTurn(a);a.worked=false;if(isNew||a.coffeeCard)showCoffee(a,false);}
  /* spec 001 FR-035 (owner 2026-10-22): Durbar's own cap waits at the Bank, a provider limit in the coffee corner */
  if(VISITS.pin(a.id,b.kind==='cap'?window.DurbarPlaces.BANK:window.DurbarPlaces.COFFEE,breakWord(a)))scheduleRender();
  setState(a,'waiting',breakWord(a),coffeeTask(a));
  if(isNew)announce(a.name+': '+coffeeTask(a));
}
/* the break ends without a resume of ours (a message, Stop, the agent went on by itself, Not now) */
function endCoffee(a,why){
  if(!a||!a.coffee)return;
  a.coffee=false;a.coffeeKind='';BREAKS.end(a.id);
  if(VISITS.unpin(a.id))scheduleRender();
  if(a.coffeeCard){const r=a.coffeeCard.querySelector('.note-actions');if(r)r.remove();a.coffeeCard.querySelector('.pstate').textContent=' → '+(why||'ended');a.coffeeCard.classList.add('settled');a.coffeeCard=null;}
}
/* FR-007: one fixed message to the same session (automatic at the reset, or Try now / Resume) */
function resumeCoffee(a,how){
  if(!a||!a.coffee)return;
  const b=BREAKS.get(a.id); if(!b||b.kind!=='provider')return;
  if(a.limit)return; /* FR-007: never while Durbar's spending limit is pending (main would hold the message anyway) */
  a.coffee=false;a.coffeeKind='';BREAKS.resumed(a.id);
  if(VISITS.unpin(a.id))scheduleRender();
  if(a.coffeeCard){const r=a.coffeeCard.querySelector('.note-actions');if(r)r.remove();a.coffeeCard.querySelector('.pstate').textContent=' → '+(how==='auto'?'resumed by itself':'resumed');a.coffeeCard.classList.add('settled','approved');a.coffeeCard=null;}
  addNote(liveChat(a),'Back from the '+esc(coffeeWord().toLowerCase())+' ('+(how==='auto'?'resumed by itself after the limit reset':'resumed by you')+').');
  void sendLive(COFFEE.RESUME_TEXT,a.id,{fromComposer:false,coffee:true});
}
/* the window's timer: what the break core says is due (FR-007, FR-011) */
function coffeeTick(){
  if(!BREAKS.size())return;
  /* FR-007: a paused agent, or one whose Durbar spending limit is pending, asks instead of resuming by itself (the rule is holdIds in coffeebreak.js) */
  for(const x of BREAKS.tick({hold:COFFEE.holdIds(agents)})){
    const a=byId(x.id); if(!a||!a.live){BREAKS.end(x.id);continue;}
    if(x.type==='resume')resumeCoffee(a,'auto');
    else if(x.type==='ask'){const bb=BREAKS.get(a.id);if(bb)bb.phase='back';if(VISITS.unpin(a.id))scheduleRender();showCoffee(a,true);setState(a,'waiting',coffeeWord(),coffeeTask(a));}
    else if(x.type==='remind')showCoffee(a,false); /* a new card: one reminder in the inbox and as a notification (Q4) */
  }
}
/* spec 052 FR-057: in Simple, a folder grant says what it lets the agent do: "Let Ada change files in “tools” until the session ends".
   Only for a "write in <folder>/" scope (the last path segment); any other scope keeps its label. The inbox and the answer bar copy the card's button. */
/* spec 052 FR-172 (review on #470): a write in several folders ("write in src/, docs/", "… and N more folders") names each folder's last segment. */
const simpleScopeLabel=(a,label)=>{const m=/^write in (.+)$/.exec(String(label||''));if(!m)return '';let rest=m[1],more=0;const mm=/ and (\d+) more folders$/.exec(rest);if(mm){more=+mm[1];rest=rest.slice(0,mm.index);}
  const segs=rest.split(/\/, /).map(x=>x.replace(/\/+$/,'').split(/[\\/]/).filter(Boolean).pop()).filter(Boolean);if(!segs.length)return '';
  const q=segs.map(x=>'“'+DurbarCutText.cutText(x,28)+'”'),list=more?q.join(', ')+' and '+more+' more folders':q.length>1?q.slice(0,-1).join(', ')+' and '+q[q.length-1]:q[0];
  return 'Let '+a.name+' change files in '+list+' until the session ends';};
/* spec 052 FR-172 (review on #470): a write in several folders cuts each folder name, never the list, and keeps "and N more folders" whole,
   so the Expert button names every folder it grants (or says how many more). Any other scope label is cut at 32 characters as before. */
const expertScopeLabel=l=>{const m=/^write in (.+\/, .+)$/.exec(String(l||''));if(!m)return DurbarCutText.cutText(String(l||''),32);let rest=m[1],tail='';const mm=/ and \d+ more folders$/.exec(rest);if(mm){tail=mm[0];rest=rest.slice(0,mm.index);}
  return 'write in '+rest.split(/\/, /).map(x=>DurbarCutText.cutText(x.replace(/\/+$/,''),16)+'/').join(', ')+tail;};
const relabelScopes=()=>{document.querySelectorAll('[data-lbl-simple]').forEach(b=>{b.textContent=SIMPLE?b.dataset.lblSimple:b.dataset.lblExpert;});document.querySelectorAll('.note.perm .pfold').forEach(f=>{f.hidden=!SIMPLE;});};
/* spec 052 FR-063: "Show the change", collapsed: the request's diff as + / - lines in monospace (text only, escaped by textContent) */
function diffBlock(diff){
  const {lines,more}=ACT.diffLines(diff), d=document.createElement('details');d.className='pdiff';
  const add=lines.filter(l=>l.t==='add').length, del=lines.filter(l=>l.t==='del').length;
  const sm=document.createElement('summary'),cnt=add||del?' (+'+add+' −'+del+')':'';sm.dataset.lblExpert='Show the change'+cnt;sm.dataset.lblSimple='See what changes'+cnt;sm.textContent=SIMPLE?sm.dataset.lblSimple:sm.dataset.lblExpert;d.appendChild(sm); /* FR-080: Simple words */
  const pre=document.createElement('pre');pre.setAttribute('aria-label','The change, as removed and added lines');
  lines.forEach(l=>{const s=document.createElement('span');s.className='dl '+l.t;s.textContent=l.s||' ';pre.appendChild(s);});
  if(more){const m=document.createElement('span');m.className='dmore';m.textContent='… '+more+' more line'+(more===1?'':'s')+' not shown';pre.appendChild(m);}
  d.appendChild(pre);return d;
}
/* ---------- permissions: inline note in the tool timeline, Allow once / Allow for this session / Deny, revocable chips ---------- */
function showPerm(a,p){
  const t=ensureTurn(a);
  const n=document.createElement('div');n.className='note perm';n.setAttribute('role','group');n.setAttribute('aria-label','Permission request');
  n.innerHTML='<b>Needs your OK:</b> <span class="psum"></span><span class="pstate"></span>';
  /* spec 052 FR-080: in Simple, "Ada wants to change companies.ts" (the folder in small text) or "Ada wants to run a command" (the command
     under a collapsed "Show the command"); Expert keeps the summary. Both texts sit on the element so the detail level can switch live. */
  const ps=n.querySelector('.psum'), pl=plainAsk(p.kind,p.summary), plain=pl?a.name+' wants to '+pl.what:'';
  ps.textContent=SIMPLE&&pl?plain:p.summary;
  if(pl){ps.dataset.lblSimple=plain;ps.dataset.lblExpert=p.summary;
    if(pl.folder){const f=document.createElement('small');f.className='pfold';f.textContent=' '+pl.folder;f.hidden=!SIMPLE;ps.after(f);}} /* FR-092: the folder note belongs to the plain words only, never after a raw summary that has the path */
  if(p.state==='pending'&&typeof p.diff==='string'&&p.diff)n.appendChild(diffBlock(p.diff)); /* spec 052 FR-063 */
  if(pl&&pl.cmd){const d=document.createElement('details');d.className='pcmd';const sm=document.createElement('summary');sm.textContent='Show the command';
    const pre=document.createElement('pre');pre.textContent=pl.cmd;d.append(sm,pre);n.appendChild(d);}
  const st=n.querySelector('.pstate');
  if(p.state==='denied'){ /* spec 003 FR-094: with the button the text no longer repeats the suggestion */
    st.innerHTML=roAskHint(a,n)?' <i>(denied: this agent is in Read-only)</i>':' <i>(denied: this agent is in Read-only. Switch it to Ask first to be asked instead)</i>';
  }
  else if(p.state==='pending'){
    const row=document.createElement('div');row.className='note-actions';
    const mk=(l,cls,title,fn)=>{const b=document.createElement('button');b.type='button';b.className='btn '+cls;b.textContent=l;if(title)b.title=title;b.onclick=fn;row.appendChild(b);};
    const answer=(approve,remember,broad)=>{bridge.resolvePermission(a.id,p.requestId,approve,remember,!!broad);settlePerm(a,{requestId:p.requestId,state:approve?'approved':'denied',via:'user',remembered:approve&&remember,scopeLabel:broad?p.broadScopeLabel:p.scopeLabel,summary:p.summary});};
    mk('Allow once','primary','Allow this one request',()=>answer(true,false)); /* spec 052 FR-037/FR-051: the same plain words in Simple and Expert */
    if(p.scopeKey){const ex='Allow “'+expertScopeLabel(p.scopeLabel||p.kind||'this')+'” for this session',sl=simpleScopeLabel(a,p.scopeLabel);
      mk(SIMPLE&&sl?sl:ex,'session','Allow "'+DurbarCutText.cutText(p.scopeLabel||p.kind,30)+'" until you end this session'+(p.kind==='shell'?' (this exact command)':'')+'. Revoke from its chip.',()=>answer(true,true));const sb=row.lastElementChild;sb.dataset.act='session';if(sl){sb.dataset.lblSimple=sl;sb.dataset.lblExpert=ex;}}
    if(p.broadScopeKey){mk('Allow for this session: any arguments','session','Allow every simple "'+DurbarCutText.cutText(p.broadScopeLabel||p.kind,18)+'" command (no pipes, redirects or substitutions) until you end this session.',()=>answer(true,true,true));row.lastElementChild.dataset.broad='1';}
    mk('Deny','danger','Deny this request',()=>answer(false,false));
    n.appendChild(row);
    a.pend.set(p.requestId,{n,row,st});
    n.classList.add('pending');n.dataset.t0=String(Date.now()); /* the waiting line says "Waiting for your OK" meanwhile */
  }
  tChips(t.T).appendChild(n);stickyScroll(liveChat(a));
  if(t.T.typing)typingPaint(t.T.typing);
  if(p.state==='pending')announce(SIMPLE&&pl?plain:a.name+' needs your OK: '+p.summary);
  renderInboxBtn();
}
/* spec 003 FR-094..FR-096 (owner 2026-10-23, supersedes spec 052 FR-074's button): under a request denied by Read-only, one button
   "Switch to Ask first…" per agent, on its newest denial (a newer one moves it). It opens the usual mode menu (openModeMenu, modes only),
   anchored to it; a choice goes through changeMode with its dialogs. Returns true when the button is shown. */
function roAskHint(a,n){
  if(!a.info||a.info.permMode!=='read-only'||!bridge.setPermMode||!feat(a,'modes'))return false;
  /* spec 003 FR-098 hook: when a managed policy (spec 076, not built) locks the mode, return false here so the plain text stays. */
  let h=a.roHint;
  if(!h||!h.b){
    const row=document.createElement('div');row.className='note-actions';
    const b=document.createElement('button');b.type='button';b.className='btn';b.dataset.act='ro-ask';b.textContent='Switch to Ask first…';
    b.title='Choose a permission mode. Ask first: each edit, command or web request waits for your OK.';
    b.setAttribute('aria-haspopup','menu');b.setAttribute('aria-expanded','false');
    b.onclick=()=>roAskOpen(a,b);
    row.appendChild(b);h=a.roHint={row,b};
  }
  n.appendChild(h.row);
  return true;
}
/* the button (or its copy in the answer bar) opens the mode menu anchored to itself; a second press closes it */
function roAskOpen(a,b){
  if(document.getElementById('modeMenu')&&b.getAttribute('aria-expanded')==='true'){closeModeMenu();b.focus();return;}
  const r=b.getBoundingClientRect();if(openModeMenu(a,r.left,r.bottom+4,b,{modesOnly:true}))b.setAttribute('aria-expanded','true');
}
/* spec 003 FR-096: after a switch out of Read-only the button goes; when the switch came from it, one line says to ask the agent again
   (no Retry: a denied tool call has no safe retry, and nothing is resent) and focus moves to the message box */
function roAskAfterSwitch(a,mode,anchor){
  const h=a.roHint; if(!h||mode==='read-only')return;
  a.roHint=null;
  const note=h.row.parentNode, mine=!!(anchor&&anchor.dataset&&anchor.dataset.act==='ro-ask'); /* the chat's button or its answer-bar copy */
  h.row.remove();
  if(!mine||!note)return;
  const l=document.createElement('p');l.className='ro-done';
  l.textContent='Now in '+MODE_NAME[mode]+'. Ask '+a.name+' to try again: '+(mode==='allow'?'it will run without asking.':'it will wait for your OK.');
  note.appendChild(l);
  announce(l.textContent); /* focus moves to the message box, so a screen reader hears the line here (review on PR 622) */
  const mi=$('msgInput');if(mi&&ui.selected&&liveRoot(byId(ui.selected)||a)===a)mi.focus({preventScroll:true});
}
function settlePerm(a,p){
  let e=a.pend.get(p.requestId);
  if(!e&&a.settled.has(p.requestId))return; /* already shown (the click settles locally, the adapter event follows) */
  if(!e){ /* auto-approved by a session grant, or answered elsewhere: show a settled note in timeline order */
    if(p.state==='pending')return;
    showPerm(a,Object.assign({},p,{state:'approved'}));
    const n=tChips(ensureTurn(a).T).lastElementChild;e={n,st:n.querySelector('.pstate')};
  }
  a.pend.delete(p.requestId);a.settled.add(p.requestId);
  if(e.row)e.row.remove();
  e.n.classList.remove('pending');
  if(a.turn&&a.turn.T.typing)typingPaint(a.turn.T.typing);
  const word=p.state==='approved'?'approved':'denied';
  const why=p.via==='stopped'?' (session stopped)':p.via==='session'?' (allowed for this session)':p.remembered?' (and remembered for this session)':'';
  e.st.textContent=' → '+(word==='approved'?'allowed':'denied')+why;
  e.n.classList.add('settled',word);
  if(word==='denied'&&!p.via)roAskHint(a,e.n); /* denied by the mode (no one answered it): Read-only */
  stickyScroll(liveChat(a));
}
function setGrants(a,list){a.grants=list;if(ui.selected&&liveRoot(byId(ui.selected)||a)===a)renderGrants();}
/* spec 052 FR-141: 1-2 grants are single chips; 3 or more are one "Allowed (N)" chip that opens a list (a row per grant, Revoke all).
   The label drops a tool-name prefix that repeats the server name; the title and the accessible name keep the full label. */
let grantsAllBusy=''; /* the agent id while its Revoke all is under way (the revokes arrive one by one and the focus may be lost in between); '' otherwise */
let grantsAgent='';
let grantsOpen=false, grantsFocus=null; /* grantsFocus: where the focus goes after the next draw (a revoke button index, or 'chip') */
function grantChipX(g){return `<button type="button" data-revoke="${esc(g.key)}" aria-label="Revoke permission: ${esc(g.label)}">${ICON('x')}</button>`;}
function renderGrants(){
  const box=$('grants'),a0=byId(ui.selected);if(!box||!a0)return;const a=liveRoot(a0),gs=a.grants||[];
  if(grantsAgent!==a.id){grantsAgent=a.id;grantsFocus=null;} /* a focus target left over from another agent */
  grantsAllBusy=window.DurbarGrantLabel.grantsBusyFor(grantsAllBusy,a.id); /* another agent: that Revoke all is not ours to finish */
  const short=g=>window.DurbarGrantLabel.shortGrantLabel(g.label);
  const hadFocus=box.contains(document.activeElement)||grantsFocus!==null||grantsAllBusy!==''; /* the user is working in the grants: do not let the focus fall to <body> when they all go */
  if(gs.length<=2){
    grantsOpen=false;
    box.innerHTML=gs.map(g=>`<span class="gchip" title="Allowed for this session: ${esc(DurbarCutText.cutText(g.label,240))}. Revoke to be asked again."><span>Allowed: ${esc(short(g))}</span>${grantChipX(g)}</span>`).join('');
  }else{
    box.innerHTML=`<button type="button" class="gchip gchip-btn" id="grantsBtn" aria-expanded="${grantsOpen}" aria-controls="grantsPop" title="${gs.length} permissions allowed for this session. Open the list to revoke them."><span>Allowed (${gs.length})</span><svg class="chev" width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6l4 4 4-4"/></svg></button>
      <div class="grants-pop" id="grantsPop" role="group" aria-label="Allowed for this session"${grantsOpen?'':' hidden'}><ul role="list" class="gp-list">${gs.map(g=>`<li class="gp-row" title="Allowed for this session: ${esc(DurbarCutText.cutText(g.label,240))}. Revoke to be asked again."><span class="gp-t">${esc(short(g))}</span>${grantChipX(g)}</li>`).join('')}</ul><button type="button" class="btn sm gp-all" id="grantsAll">Revoke all</button></div>`;
  }
  box.hidden=!gs.length;
  if(grantsFocus!==null){
    const f=grantsFocus;grantsFocus=null;
    const btns=[...box.querySelectorAll('[data-revoke]')];
    const t=f==='chip'?$('grantsBtn'):btns[Math.min(f,btns.length-1)];
    if(t)t.focus();
  }
  if(!gs.length&&hadFocus&&!box.contains(document.activeElement)){ /* none left: the chips are gone; the composer is the same neighbour as after answering a card */
    grantsFocus=null;grantsAllBusy='';const m=$('msgInput');if(m)m.focus();announce('All permissions revoked.');
  }
}
function closeGrants(toChip){
  if(!grantsOpen)return;grantsOpen=false;
  const b=$('grantsBtn'),p=$('grantsPop');if(b)b.setAttribute('aria-expanded','false');if(p)p.hidden=true;
  if(toChip&&b)b.focus();
}
async function revokeAllGrants(){
  const r=liveRoot(byId(ui.selected));if(!r)return;const gs=(r.grants||[]).slice();
  if(gs.length>1){
    const ok=await askDialog({title:'Revoke all '+gs.length+' permissions?',body:'Durbar will ask again the next time the agent wants to use any of them in this session.',returnFocus:$('grantsBtn'),
      buttons:[{label:'Cancel',value:null},{label:'Revoke all',value:'ok',cls:'primary danger'}]});
    if(!ok)return;
  }
  grantsOpen=false;grantsFocus='chip';grantsAllBusy=r.id;
  /* it ends when every revoke has settled (a failed one included) and the events had a moment to arrive, whether or not the count reached 0 */
  await Promise.allSettled(gs.map(g=>Promise.resolve().then(()=>bridge.revokeGrant(r.id,g.key))));
  setTimeout(()=>{if(grantsAllBusy===r.id)grantsAllBusy='';grantsFocus=null;},1000);
}
/* ---------------- tool usage, models and context window (spec 019) ---------------- */
const STATS=window.DurbarStats.createStats();
let statsRefresh=0;
function feedStats(a,e){
  /* spec 058 FR-083: Settings' live MCP list follows a chat that stops or becomes ready again */
  if(e.type==='status'&&(e.status==='stopped'||e.status==='idle')&&!e.agentId&&window.DurbarScreens.liveEvent)window.DurbarScreens.liveEvent(a.id);
  /* sub-agent events are counted for the agent that owns them (a.id is the session) */
  if(e.type==='toolCall')STATS.recordTool(a.id,e);
  else if(e.type==='usage')STATS.recordModel(a.id,e.model);
  else if(e.type==='context'&&!e.agentId){STATS.setContext(a.id,e);if(a.ctxWaiting){a.ctxWaiting=false;}}
  else if(e.type==='mcp'){a.mcp=e.servers;refreshMcpCount(a);if(window.DurbarScreens.mcpEvent)window.DurbarScreens.mcpEvent(a.id);} /* spec 005 FR-037: the MCP chip's count; spec 058 FR-004: an open MCP dialog follows it */
  else return;
  if(e.type==='usage'||e.type==='context'||(e.type==='toolCall'&&e.phase==='start')){
    updateCtxChip(a);
    if(e.type==='context')updateModelChip(a); /* spec 005 FR-037: the model chip shows the window the runtime reports */
    if(e.type==='context')maybeSuggestFresh(a);
    if(window.DurbarScreens.isOpen()&&!statsRefresh)statsRefresh=setTimeout(()=>{statsRefresh=0;window.DurbarScreens.refresh();},700);
  }
}
function ctxChipHTML(a){const c=window.DurbarScreens.ctxChip(a);
  return `<span class="ctxgrp" id="ctxGrp">${ctxChipBtn(a,c)}</span>`;} /* spec 005 FR-037: Compact is in the chip's menu */
/* spec 052 FR-081: Simple says "Memory 74% full" (same id, same click). FR-093: Simple shows it only from 70% full (class mem-low hides it) */
function ctxChipBtn(a,c){
  const canC=ctxCanCompact(a), acts=ctxHasActs(a);
  const text=SIMPLE?(c.cls==='unk'?'Memory: not known yet':'Memory '+c.pct+'% full'):c.text, title=SIMPLE?'How full the agent\'s memory of this conversation is. '+(canC?'Click to tidy up memory.':'Click for details.'):String(c.title||'').replace(/[.\s]+$/,'')+'. '+(canC?'Click to compact or see all agents.':'Click to see all agents.'); /* spec 005 T070: one full stop, whether the title ends with one or not */
  return `<button class="ctxchip ${c.cls}${c.cls==='unk'||!(c.pct>=70)?' mem-low':''}" id="ctxChip" type="button" aria-haspopup="${acts?'menu':'dialog'}" aria-expanded="${!!document.getElementById('ctxMenu')}" title="${esc(title)}"><span class="bar" aria-hidden="true"><i style="width:${c.pct}%"></i></span><span>${esc(text)}</span></button>`;}
function updateCtxChip(a){
  const el=$('ctxGrp');if(!el||!ui.selected)return;const cur=byId(ui.selected);if(!cur||liveRoot(cur)!==a)return;
  /* spec 052 (2026-10-21): only when it changed: replacing it on every state change cost time and dropped keyboard focus */
  const g=$('ctxGrp');if(!g)return;const html=ctxChipHTML(a);if(g._html===html)return;
  const had=g.contains(document.activeElement)&&document.activeElement.id;
  const t=document.createElement('template');t.innerHTML=html;const n=t.content.firstElementChild;if(!n){g.outerHTML=html;return;}
  g.replaceWith(n);n._html=html;if(had){const f=document.getElementById(had);if(f)f.focus({preventScroll:true});}
}
/* A main agent's session title from the runtime (issue #126): shown instead of the folder name everywhere a.name is shown;
   the folder stays in the room header and in the tooltip. Sub-agents keep their own names. */
function applyTitle(a,title){
  if(typeof title!=='string'||!title)return;
  title=safeMask(title); if(!title||a.title===title)return; /* spec 041 FR-065: a runtime title is agent text and becomes the agent's name; no mask: the folder name stays */
  a.title=title; repaintName(a);
}
/* spec 059: the display name is the user's name, else the runtime's title, else the folder label (FR-001); the tooltip never shows the runtime title once the user named the session (FR-003) */
function repaintName(a){
  a.name=SN().displayName(a.alias,a.title,a.folderLabel);
  if(a.info)a.info.alias=a.alias;
  if(ui.selected===a.id){const h=document.getElementById('panelTitle');if(h){h.textContent=a.name;const t=SN().nameTip(a.alias,a.title,a.folderLabel||a.baseName||'');h.title=t||a.name;}const mi=$('msgInput');if(mi){mi.setAttribute('aria-label','Message '+a.name);fitPlaceholder();}const c=document.getElementById('chat');if(c)c.setAttribute('aria-label','Chat with '+a.name);}
  scheduleRender();
  if(document.getElementById('schedDlg'))try{renderSchedDlg();}catch(e){}
}
/* main tells every window that a session got (or lost) the user's name */
/* spec 052 FR-174: a driver gives the open chat a late title and a user name through the real applyTitle and repaintName (simulator only) */
if(SIM)window.__durbarSimRetitle=(title,alias)=>{const a=byId(ui.selected);if(!a)return false;applyTitle(a,title);a.alias=alias||undefined;repaintName(a);return true;};
function onAgentRenamed(e){
  const a=liveById(e&&e.id); if(!a)return;
  a.alias=typeof e.alias==='string'&&e.alias?e.alias:undefined;
  repaintName(a);
}
function onLiveEvent(e){
  const a=liveById(e.sessionId); if(!a)return;
  if(e.type==='permission'&&e.permission&&e.permission.via==='policy')return; /* spec 052 FR-071: an Allow all approval is for the activity log in main, no card */
  a.lastEventAt=Date.now(); /* spec 052 FR-062: last activity (when it arrived here; a helper's event counts for its main agent) */
  feedStats(a,e);
  liveFeed(a,e); /* spec 001 FR-028 */
  if(!e.agentId){ /* spec 034: only main-agent events change the mood */
    if(e.type==='toolCall')MOOD.onTool(a.id,e);
    else if(e.type==='status'){MOOD.onStatus(a.id,e.status);if(e.permission)MOOD.onPermission(a.id,e.permission,e.timestamp);} /* a pending request arrives inside a needs-permission status */
    else if(e.type==='permission')MOOD.onPermission(a.id,e.permission,e.timestamp);   /* its answer arrives as a permission event */
  }
  if(e.type==='toolCall'&&e.mcpServer&&SEEN_SERVERS.size<500)SEEN_SERVERS.add(String(e.mcpServer).trim().slice(0,200));
  if(!e.agentId){ /* spec 024: only main-agent events move anyone (helper events carry an agentId) */
    if(e.type==='toolCall'){
      /* spec 001 FR-036: what the agent does at the place, masked like the live readout (FR-031); nothing without the masking (fail closed) */
      if(e.phase==='start'&&LIVE_MASK&&window.DurbarPlaces.classify(e,PLACE_MAP,customIds())!=='desk'){const t=window.DurbarLiveAct.phrase({kind:toolKind(e.tool),tool:e.tool,label:toolLabel(e.args)},LIVE_MASK).replace(VERB_RE,'').trim();if(t)PLACE_DOING.set(a.id,t);else PLACE_DOING.delete(a.id);}
      if(VISITS.onTool(a.id,e,PLACE_MAP,customIds()))scheduleRender();}
    else if(e.type==='status'){if(VISITS.onStatus(a.id,e.status))scheduleRender();}
  }
  if(e.type==='title'){if(!e.agentId)applyTitle(a,e.title);return;}
  if(e.type==='agentSchedule'){if(!e.agentId)onAgentSchedule(a,e);return;}
  if(e.type==='subagent')return onSubagent(a,e);
  if(e.type==='usageLimit'){if(!e.agentId&&!(e.update&&!a.coffee))startCoffee(a,{kind:'provider',resetsAt:e.resetsAt,estimated:e.estimated,paid:e.paid,source:e.source});return;} /* spec 068 */
  if(e.agentId&&e.type!=='permission'&&e.type!=='grants'&&e.type!=='limit')return onSubEvent(a,e);
  const chat=liveChat(a), main=true;
  switch(e.type){
  case 'user':{addUserMsg(chat,e.text,(e.attachments||[]).map(x=>({name:String(x.path).split(/[\\/]/).pop(),img:x.kind==='image',path:x.path})));return;}
  case 'status':
    if(!main)return;
    if(e.status==='idle')refreshFolderStatus(a); /* spec 063 FR-005: a finished turn may have changed files */
    /* spec 068: the turn that hit a usage limit ends quietly (the coffee break says why); working again, Stop or the end of the session end the break */
    if(a.coffee&&!a.limit){
      /* only the turn's closing status keeps the break (2026-10-22): the adapters' marker reason 'usage-limit' (never the words), then at most one plain idle of the same turn */
      if(e.status==='idle'&&e.reason==='usage-limit'){closeTurn(a);a.worked=false;a.coffeeShut=true;return;}
      if(e.status==='idle'&&!e.intent&&a.coffeeShut){a.coffeeShut=false;closeTurn(a);a.worked=false;return;}
      /* any other idle or error: the turn went on (and finished or failed) after the limit; the break ends and the status shows as usual */
      const wentOn=e.status==='idle'&&!e.intent&&!a.coffeeShut;a.coffeeShut=false;
      if(e.status==='working'||e.status==='stopped'||e.status==='idle'||e.status==='error'){endCoffee(a,e.status==='working'||wentOn?'the agent went on':e.status==='error'?'an error':'stopped');if(wentOn)a.worked=true;}
    }
    if(e.status==='working'){a.worked=true; const tt=ensureTurn(a); if(e.intent){a.intent=e.intent;if(!/^(Thinking|Approved|Allowed|Denied|Waiting for permission)/.test(e.intent))tIntent(tt.T,e.intent);}
      if(a.state!=='working'&&a.state!=='thinking')setState(a,'working',null,intentText(e.intent)||a.task); else if(e.intent)setState(a,a.state,undefined,intentText(e.intent));}
    else if(e.status==='needs-permission'){
      ensureTurn(a); setState(a,'waiting',null,intentText(e.intent)||'Waiting for permission');
      if(e.permission)showPerm(a,e.permission);
    }
    else if(e.status==='idle'&&e.intent==='Aborted'){if(a.limit)settleLimit(a,'cancel');if(a.question)settleQuestion(a,null,'cancel');if(a.pendingProfile){const n=a.pendingProfile.name;a.pendingProfile=undefined;updateAgentChip(a);addNote(chat,'The waiting switch to the agent '+esc(n)+' was dropped when you stopped the reply.');}const was=a.worked;a.worked=false;closeTurn(a);
      [...a.pend.keys()].forEach(id=>settlePerm(a,{requestId:id,state:'denied',via:'stopped'}));
      if(was)addNote(chat,'Stopped by you. The agent is ready for your next message.');
      /* real:(spec 030 T042) the runtime drops a switch that was still queued when the turn is stopped: say so, never leave "Next: ..." behind */
      if(a.pendingModel){const nm=a.pendingModel.name;a.pendingModel=undefined;updateModelChip(a);addNote(chat,'The queued switch to '+esc(nm)+' was dropped when you stopped the reply. Choose it again if you still want it.');}
      setState(a,'idle',null,'Stopped. Ready for your next message.');}
    else if(e.status==='idle'){const was=a.worked;a.worked=false;closeTurn(a);if(a.pendingProfile){const p=a.pendingProfile;a.pendingProfile=undefined;applyProfile(a,p);}
      if(was)setState(a,'done','Done',a.lastOutput?safeExcerpt(a.lastOutput,140):'Finished.'); else setState(a,'idle',null,a.task);
      updateCtxChip(a);maybeSuggestFresh(a);
      /* a queued switch applies when the turn ends (its model event follows at once); if none came, do not leave "Next: ..." standing */
      if(a.pendingModel){const p=a.pendingModel;setTimeout(()=>{if(a.pendingModel===p){a.pendingModel=undefined;updateModelChip(a);}},2000);}}
    else if(e.status==='error'&&e.errorKind==='auth'){closeTurn(a);a.worked=false;markKindSignedOut(kindOf(a));showSignInCard(a,{detail:e.intent||''});setState(a,'error',null,kindWord(kindOf(a))+' needs you to sign in again.');} /* spec 012 FR-157 */
    else if(e.status==='error'){closeTurn(a);addNote(chat,esc(e.intent||'Error'),true);setState(a,'error',null,safeExcerpt(e.intent||'Error',140,'Error'));}
    else if(e.status==='stopped'){
      if(a.limit)settleLimit(a,'cancel');
      /* a permission still pending when the session stops is denied cleanly: no Approve/Deny left behind, grants gone */
      [...a.pend.keys()].forEach(id=>settlePerm(a,{requestId:id,state:'denied',via:'stopped'}));
      setGrants(a,[]);
      if(a.remote){a.remote=null;updateRemoteUi(a);} /* spec 054 FR-003: remote control ends with the session */
      a.worked=false; /* spec 058 FR-022: the turn ended with the session; a resume's "idle" (Restart session) is not a finished turn ("Done") */
      closeTurn(a);setState(a,'idle','Ended','Session ended. Send a message to resume it.');}
    return;
  case 'permission':if(main)settlePerm(a,e.permission);return;
  case 'grants':setGrants(a,e.grants||[]);return;
  case 'limit':
    if(e.phase==='changed'){a.info.maxAiCredits=e.maxAiCredits>0?e.maxAiCredits:undefined;a.usageText=usageLong(a);updateCapChip(a);updatePanelHeader();scheduleRender();}
    else if(e.phase==='exhausted'){if(a.limit&&a.limit.requestId===e.requestId)return;showLimit(a,e);startCoffee(a,{kind:'cap'});updateCapChip(a);} /* spec 068 Q2: Durbar's own spending limit is a coffee break, 'until you raise the limit' */
    else if(e.phase==='resolved'){if(a.limit&&a.limit.requestId===e.requestId)settleLimit(a,e.action||'add');}
    return;
  case 'plan': /* spec 066 */
    if(e.phase==='proposed'){showPlan(a,e);setState(a,'waiting',null,'Waiting for your OK on a plan');updatePanelHeader();scheduleRender();}
    else if(a.plan&&a.plan.requestId===e.requestId)settlePlan(a,e.action||'reject');
    return;
  case 'question': /* spec 012 FR-130 */
    if(e.phase==='asked'){if(a.question&&a.question.requestId===e.requestId)return;showQuestion(a,e);setState(a,'waiting',null,'The agent asks you a question');updatePanelHeader();scheduleRender();}
    else if(a.question&&a.question.requestId===e.requestId)settleQuestion(a,e.phase==='answered'?e.answers:null,a.question.elicit?(e.phase==='answered'?(e.elicitAction||'accept'):'cancel'):undefined);
    return;
  case 'agentProfile':{ /* spec 043: the session's custom agent; details from the last list when the event has none */
    const p=e.profile?Object.assign({},(a.profileList||[]).find(x=>x.id===e.profile.id)||{},e.profile.source==='other'&&(a.profileList||[]).some(x=>x.id===e.profile.id)?{}:e.profile):null;
    if(p&&a.profileList){const known=a.profileList.find(x=>x.id===p.id);if(known)Object.assign(p,{source:known.source,description:known.description,path:known.path});}
    a.profile=p;updateAgentChip(a);scheduleRender();return;}
  case 'model':onModelEvent(a,e);return;
  case 'compaction':onCompaction(a,e);return;
  case 'thinking':{if(a.coffee&&!a.limit)endCoffee(a,'the agent went on');const t=ensureTurn(a);tThink(t.T,e.reasoningId,e.delta);setState(a,'thinking',null);return;}
  case 'output':{const t=ensureTurn(a);const out=tText(t.T,e);if(out!=null)a.lastOutput=out;if(!a.coffee)setState(a,'working',null);return;} /* spec 068: text after a usage limit does not end the break */
  case 'toolCall':{const t=ensureTurn(a);
    if(isTaskTool(e.tool)||(t.T.chipEls[e.callId]===undefined&&a.subs&&a.subs.has(e.callId)))onTaskTool(a,e);
    else tTool(t.T,e);
    if(e.phase==='start'&&!isTaskTool(e.tool)&&!a.coffee)setState(a,a.state==='thinking'?'working':a.state,null,intentText(a.intent)||toolTask(e,a.info&&a.info.cwd,90));
    stickyScroll(chat);return;}
  case 'usage':{const u=a.usage;u.calls++;u.inT+=e.inputTokens||0;u.outT+=e.outputTokens||0;u.nano+=e.nanoAiu||0;u.usd=(u.usd||0)+(e.costUsd>0?e.costUsd:0);
    a.usageText=usageLong(a);recordUsage(a,e);scheduleRender();
    if(ui.selected===a.id||(byId(ui.selected)||{}).parent===a.id)updatePanelHeader();return;}
  }
}
async function sendLive(text,forId,opts){
  const a0=byId(forId||ui.selected); if(!a0)return; const a=liveRoot(a0);
  /* spec 064 FR-003: a message sent from elsewhere (Send to several) leaves the open chat's composer and attachments alone */
  const fromComposer=!(opts&&opts.fromComposer===false);
  const atts=fromComposer?attached.slice():[];
  text=(text||'').trim(); if(!text&&!atts.length)return;
  /* spec 012 FR-157: an app that is known to be signed out gets the sign-in card first; the typed text stays in the box */
  if(SIGNIN&&SIGNIN.needsSignIn(KINDS,kindOf(a))){PROMPTS.set(a.id,text,atts);showSignInCard(a,{before:true});return;}
  if(PROMPTS)PROMPTS.set(a.id,text,atts); /* memory only, for Send again after a sign-in (never stored) */
  if(a.coffee&&!(opts&&opts.coffee))endCoffee(a,'you sent a message'); /* spec 068 FR-009: a message ends the coffee break */
  a.sent=true;
  const chat=liveChat(a);
  addUserMsg(chat,text||'(attachment)',atts);
  if(fromComposer){attached=[];renderAttached();attNotice([]);
    const input=$('msgInput');if(input){input.value='';autoGrow();}}
  if(LIVEACT)LIVEACT.clear(a.id); /* spec 001 FR-028: a new message starts a fresh readout */
  a.worked=true; a.intent=''; closeTurn(a); ensureTurn(a); setState(a,'thinking',null,'Thinking');
  const planFirst=!!a.planNext&&!!(capsFor(a)&&capsFor(a).planMode); /* spec 066: one message only */
  if(a.planNext){a.planNext=false;renderAttached();}
  if(planFirst)addNote(chat,'Asked for a plan first: nothing changes until you approve it.');
  const r=await bridge.send(a.id,text||'Please look at the attached file(s).',atts.map(x=>({path:x.path,name:x.name,kind:x.kind})),planFirst?{plan:true}:undefined);
  if(!r.ok){closeTurn(a);const n=addNote(chat,'Send failed: '+esc((r.error&&safeMask(r.error))||'unknown error'),true); /* spec 041 FR-065 (delta 2026-10-23): the app's error is masked (shown whole, not cut); no mask: a neutral word */modeRefusalAction(a,n,r.error);setState(a,'error',null,'Send failed: '+safeExcerpt(r.error,100,'unknown error'));}
  else if(r.slash)addNote(chat,'Sent the text of <code>'+esc(DurbarCutText.cutText(safeMask(r.slash),160))+'</code> (the agent app does not load it in Durbar’s sessions).'+(r.slashNote?' '+esc(DurbarCutText.cutText(safeMask(r.slashNote),200)):'')); /* spec 073 FR-005; slashNote: masked, then cut (FR-013) */
  else if(r.slashNote)addNote(chat,esc(DurbarCutText.cutText(safeMask(r.slashNote),240))); /* spec 073 (review on PR 615): over the size cap, sent as typed; masked, then cut (FR-013) */
}
/* spec 012 FR-087 (owner 2026-10-20, option c): a refusal of Read-only / Ask first (Codex's sandbox could not start, or Codex cannot
   limit reads) never suggests a mode in its text; a "Change mode…" button opens the usual mode menu, with every mode and its help */
const MODE_REFUSAL=/Read-only and Ask first need|limit reads to the session's folders/;
function modeRefusalAction(a,note,error){
  if(!note||!MODE_REFUSAL.test(String(error||''))||!bridge.setPermMode||!feat(a,'modes'))return;
  const row=document.createElement('div');row.className='note-actions';
  const b=document.createElement('button');b.type='button';b.className='btn';b.textContent='Change mode…';b.dataset.act='modeRefusal';
  b.onclick=()=>{const r=b.getBoundingClientRect();openModeMenu(a,r.left,r.bottom+4,b);};
  row.appendChild(b);note.appendChild(row);
}
/* ---------------- sign in again from the chat (spec 012 FR-157) ---------------- */
const SIGNIN=window.DurbarSignIn||null;
const PROMPTS=SIGNIN?SIGNIN.createPromptMemory():null;
const kindOf=a=>(liveRoot(a).info&&liveRoot(a).info.adapterId)||'copilot';
/* spec 058: the options the MCP dialog gets (the chip and Settings' Open in chat alike); FR-093: the agent app's version for Copy diagnostics, from the agent app list */
const mcpOpts=r=>{const k=kindOf(r),d=(KINDS||[]).find(x=>x.id===k);return {toggle:feat(r,'mcpToggle'),restart:feat(r,'mcpRestart'),appName:kindWord(k),...(d&&typeof d.version==='string'&&d.version?{appVersion:d.version}:{})};};
/* the window's own copy of the adapter list follows at once (main also sends the changed list; the simulator has no main) */
function markKindSignedOut(kind){
  if(!KINDS)return;
  let changed=false;
  KINDS=KINDS.map(k=>{if(k.id!==kind||k.state!=='ready')return k;changed=true;return Object.assign({},k,{state:'not-signed-in'});});
  if(changed)applyKinds();
}
function showSignInCard(a0,o){
  const a=liveRoot(a0), chat=liveChat(a), kind=kindOf(a), name=kindWord(kind), opts=o||{};
  if(a.signCard&&a.signCard.isConnected&&!a.signCard.classList.contains('settled'))a.signCard.remove(); /* one open card per chat */
  const n=document.createElement('div');n.className='note perm signin';n.setAttribute('role','group');n.setAttribute('aria-label',name+': sign in');
  n.innerHTML='<b class="signin-title"></b> <span class="psum"></span><div class="note-actions"></div>'+(opts.detail?'<details class="signin-details"><summary>Details</summary><pre></pre></details>':'');
  if(opts.detail)n.querySelector('pre').textContent=opts.detail;
  let phase='needed';
  const paint=()=>{
    const t=SIGNIN.cardText(name,phase,{before:!!opts.before,hasPrompt:!!PROMPTS.get(a.id),restart:!opts.before&&SIGNIN.restartBeforeResend(kind)});
    n.querySelector('.signin-title').textContent=t.title;n.querySelector('.psum').textContent=' '+t.note;
    const row=n.querySelector('.note-actions');row.textContent='';
    if(t.button){const b=document.createElement('button');b.type='button';b.className='btn primary';b.textContent=t.button;b.onclick=()=>phase==='done'?resend(b):signIn();row.appendChild(b);}
    if(phase!=='done'&&phase!=='signing'){const l=document.createElement('button');l.type='button';l.className='linkbtn';l.textContent='Open Settings > Agent apps';l.onclick=()=>window.DurbarScreens.openSettings('harnesses');row.appendChild(l);}
    n.classList.toggle('settled',phase==='done'||phase==='sent');
  };
  const signIn=async()=>{
    const H=window.DurbarHarnesses;
    if(!H||!H.available()||!H.signIn){window.DurbarScreens.openSettings('harnesses');return;}
    phase='signing';paint();
    const r=await H.signIn(kind,name).catch(()=>({ok:false}));
    await loadKinds(true);
    phase=r&&r.ok&&!SIGNIN.needsSignIn(KINDS,kind)?'done':'failed';paint();
    if(phase==='done'&&a.state==='error')setState(a,'idle',null,'Signed in again. Ready for your message.');
  };
  const resend=async b=>{
    const p=PROMPTS.get(a.id);if(!p)return;
    b.disabled=true;
    if(!opts.before&&SIGNIN.restartBeforeResend(kind)){const done=busy(b,'Restarting the session…');try{await (bridge.end||bridge.stop)(a.id);}catch(err){/* not running: the message starts it */}finally{done();}}
    phase='sent';n.querySelector('.note-actions').textContent='';n.querySelector('.psum').textContent=opts.before?' Sent.':' Restarted the session and sent your last message again.';n.classList.add('settled');
    attached=p.atts.slice();sendLive(p.text,a.id);
  };
  paint();chat.el.appendChild(n);stickyScroll(chat);a.signCard=n;
  if(opts.before)setState(a,a.state==='error'?'error':a.state,null,name+' needs you to sign in first.');
  return n;
}
async function pickLive(want){addPicked(await bridge.pickAttachments(want));}
/* spec 052 FR-047: btn (optional) shows the busy state while the bridge call runs; FR-050: success and failure toasts are typed */
async function openLive(a,btn){
  const done=busy(btn,'Opening…');
  try{const r=await bridge.openInVSCode(liveRoot(a).id);
    toast(r.ok?'Opening in '+esc(r.edition||'VS Code')+'…':'Could not open VS Code: '+esc(r.error||'unknown error'),4200).classList.add(r.ok?'ok':'err');}
  catch(err){toast('Could not open VS Code: '+esc(String(err&&err.message||err)),5000).classList.add('err');}
  finally{done();}
}
async function stopLive(a,btn){const r=liveRoot(a),done=busy(btn,'Stopping…');try{await bridge.stop(r.id);}finally{done();}toast(esc(r.name)+': stopped the current turn. It is ready for your next message.').classList.add('ok');}
async function endLive(a,btn){const r=liveRoot(a),done=busy(btn,'Ending…');try{await (bridge.end||bridge.stop)(r.id);}finally{done();}dropDraft(r.id);toast(esc(r.name)+': session ended. Sending a message resumes it.',4200).classList.add('ok');}
const failToast=what=>err=>toast('Could not '+what+': '+esc(String(err&&err.message||err)),5000).classList.add('err');
async function copyResume(a){const r=liveRoot(a),cmd=resumeCmdOf(r); if(!cmd)return;
  try{await navigator.clipboard.writeText(cmd);toast('Copied <code>'+esc(cmd)+'</code>. End the session here first, then run it in a terminal in '+esc(roomOf(r).path)+'. In VS Code, turn on the sessions list filter External to see sessions started here.',9000).classList.add('ok');}
  catch{toast('Run <code>'+esc(cmd)+'</code> in a terminal in '+esc(roomOf(r).path)+' (end the session here first).',8000);}}
/* ---------------- full-screen chat: the strip of all agents ---------------- */
function stripAgents(){
  return agents.filter(x=>!x.parent&&roomShown(roomOf(x))).map((x,i)=>[x,i]).sort((p,q)=>prio(p[0])-prio(q[0])||p[1]-q[1]).map(p=>p[0]);
}
function renderStrip(){
  const box=$('stripList'); if(!box)return;
  const cur=byId(ui.selected), root=cur?(cur.parent||cur.id):null;
  morphHTML(box,stripAgents().map(x=>{const st=pillSt(x),attn=st==='waiting'||st==='error'||st==='failing'; /* spec 052 FR-092: Failing here too */
    return `<button class="sitem st-${st}${attn?' attn':''}${x.id===root?' sel':''}" type="button" data-sw="${esc(x.id)}" data-key="sw:${esc(x.id)}" aria-current="${x.id===root}" title="${chatNoOf(x)?'C'+chatNoOf(x)+' · ':''}${esc(x.name)} · ${esc(stWord(x,true))}: ${esc(taskText(x))}" aria-label="${esc(x.name)}${chatNoWords(x)}${draftWords(x)}, ${esc(stWord(x,true))}. Open chat."><span class="sav">${avatar(x)}</span><span class="stx"><b>${esc(x.name)}${draftHTML(x)}</b><span class="sst"><span class="dot ${st}"></span><span class="sw">${esc(stWord(x,true))}</span><span class="sin">${esc(SHORT(taskText(x),48))}</span></span></span></button>`;}).join(''));
}


/* ---------------- permission mode: change it at any time (spec 018) ---------------- */
function modeChipHTML(a){const m=a.info.permMode, rs=m==='allow'&&a.info.permRestored;
  /* spec 061 FR-012: Read-only still means something: when the folder's own hooks or allow rules apply, the chip says so */
  const fr=a.info.folderRules?' + folder rules':'';
  if(!feat(a,'modes'))return `<span class="modechip${m==='allow'?' modebadge':''}" title="Set when the session starts">${esc(MODE_NAME[m]+fr)}</span>`; /* spec 052 FR-065 */
  return `<button class="mode-chip mode-${m}" id="modeChip" type="button" aria-haspopup="menu" aria-expanded="false" title="Permission mode: ${esc(MODE_NAME[m])}${rs?(a.info.permFrom==='session'?' (restored: the mode you last chose for this session)':' (restored from your last run)'):''}. Click to change."><span class="mi">${MODE_IC[m]}</span><span>${esc(MODE_NAME[m]+fr)}</span>${rs?'<span class="mode-restored">restored</span>':''}${ICON('chev')}</button>`;}
function closeModeMenu(){const m=document.getElementById('modeMenu');if(m){m.remove();const c=$('modeChip');if(c)c.setAttribute('aria-expanded','false');document.querySelectorAll('[data-act="ro-ask"][aria-expanded="true"]').forEach(b=>b.setAttribute('aria-expanded','false'));}}
function openModeMenu(a0,x,y,anchor,o){ /* o.modesOnly (spec 003 FR-095): the three modes and the note, without Model, Plan first, folder setup or card actions */
  const a=liveRoot(a0); if(!a||!a.live)return false;
  /* spec 005 FR-017: Stop and End session for a main agent opened from its card (not from the chat header chip) */
  const only=!!(o&&o.modesOnly);
  const ops=!only&&anchor&&anchor.dataset&&anchor.dataset.id&&!a0.parent&&bridge.stop?DMK().cardMenuActions(a,capsFor(a)):{stop:null,end:null};
  const canRen=!only&&!!(anchor&&anchor.dataset&&anchor.dataset.id&&!a0.parent&&canRenameSession(a)); /* spec 059 FR-006: Rename… in the card menu */
  const hasMode=!!bridge.setPermMode&&feat(a,'modes'), hasOps=!!(ops.stop||(ops.end&&bridge.end)||canRen);
  if(!hasMode&&!hasOps)return false;
  closeModeMenu();
  const m=document.createElement('div');m.id='modeMenu';m.className='mode-menu';m.setAttribute('role','menu');m.setAttribute('aria-label',(hasOps?'Actions for ':'Permission mode for ')+a.name);
  m.innerHTML=(hasMode?['read-only','ask','allow'].filter(k=>feat(a,'modeList',k)).map(k=>`<button type="button" role="menuitemradio" aria-checked="${a.info.permMode===k}" data-mode="${k}" class="mm-${k}" title="${esc(MODE_HELP[k])}"><span class="mi">${MODE_IC[k]}</span><span class="mt"><b>${MODE_NAME[k]}</b><small>${esc(MODE_SHORT[k])}</small></span><span class="ck">${a.info.permMode===k?'✓':''}</span></button>`).join('')+(!only&&bridge.setModel&&a.info?`<button type="button" role="menuitem" data-act="model" class="mm-model"><span class="mt"><b>Model and context…</b><small>${esc(modelLabel(a.info).text)}</small></span></button>`:'')+(!only&&capsFor(a)&&capsFor(a).planMode&&!a0.parent?`<button type="button" role="menuitemcheckbox" aria-checked="${!!a.planNext}" data-act="planNext" class="mm-plan"><span class="mt"><b>Plan first (next message)</b><small>It plans first; you approve before it acts.</small></span><span class="ck">${a.planNext?'✓':''}</span></button>`:'')+(!only&&bridge.folderSetupScan&&window.DurbarFolderSetup&&a.info?`<button type="button" role="menuitem" data-act="foldersetup" class="mm-fsetup"><span class="mt"><b>This folder\u2019s setup…</b><small>${a.info.folderRules?'Its own hooks or allow rules are on':'Hooks, rules and MCP servers in its files'}</small></span></button>`:'')+`<p class="mm-note">Applies from the next request. The session keeps running.</p>`:'')+(hasOps?`<div class="mm-sep" role="separator"></div>`+(canRen?`<button type="button" role="menuitem" data-op="rename" class="mm-rename" title="Give this session a short name"><span class="mt"><b>Rename…</b><small>A short name for this session</small></span></button>`:'')+(ops.stop?`<button type="button" role="menuitem" data-op="stop" class="mm-stop"${ops.stop.disabled?` aria-disabled="true" aria-describedby="mmStopWhy" title="${esc(ops.stop.reason)}"`:''}><span class="mt"><b>Stop</b><small${ops.stop.disabled?' id="mmStopWhy"':''}>${esc(ops.stop.disabled?ops.stop.reason:'Stops this reply. The agent stays open.')}</small></span></button>`:'')+(ops.end&&bridge.end?`<button type="button" role="menuitem" data-op="end" class="mm-end mm-danger"><span class="mt"><b>End session</b><small>Send a message to pick up where you left off.</small></span></button>`:''):'');
  document.body.appendChild(m);
  const {px,py}=placeMenu(m,x,y,anchor); /* spec 005 FR-037: above a toolbar chip */
  m.addEventListener('click',e=>{const pn=e.target.closest('[data-act="planNext"]');if(pn){a.planNext=!a.planNext;closeModeMenu();renderAttached();announce(a.planNext?'The next message asks for a plan first.':'Plan first is off.');const mi=$('msgInput');if(mi)mi.focus();return;}const g=e.target.closest('[data-act="model"]');if(g){closeModeMenu();openModelMenu(a,px,py,anchor);return;}if(e.target.closest('[data-act="foldersetup"]')){closeModeMenu();window.DurbarFolderSetup.openFor(a.info);return;}const o=e.target.closest('[data-op]');if(o){if(o.getAttribute('aria-disabled')==='true')return;closeModeMenu();cardOp(a,o.dataset.op,anchor);return;}const b=e.target.closest('[data-mode]');if(!b)return;closeModeMenu();changeMode(a,b.dataset.mode,anchor);});
  m.addEventListener('keydown',e=>{const it=[...m.querySelectorAll('[data-mode],[data-act],[data-op]')],i=it.indexOf(document.activeElement);
    if(e.key==='ArrowDown'){e.preventDefault();it[(i+1)%it.length].focus();}else if(e.key==='ArrowUp'){e.preventDefault();it[(i+it.length-1)%it.length].focus();}
    else if(e.key==='Escape'||e.key==='Tab'){e.preventDefault();e.stopPropagation();closeModeMenu();if(anchor&&anchor.focus&&document.contains(anchor))anchor.focus();}});
  (m.querySelector('[aria-checked="true"]')||m.querySelector('button')).focus();
  const c=$('modeChip');if(c&&anchor===c)c.setAttribute('aria-expanded','true');
  return true;
}
/* spec 005 FR-017: Stop / End session from the card menu; the same calls and toasts as the chat header */
async function cardOp(a,op,anchor){
  try{
    if(op==='rename')return await renameSessionUi(a,null,{opener:anchor});
    if(op==='stop')return await stopLive(a);
    /* decided at click time: the agent may have become busy (or ended) while the menu was open */
    const en=DMK().cardMenuActions(a,capsFor(a)).end;
    if(!en)return;
    if(en.confirm){
      const ok=await askDialog({title:'End '+a.name+'?',body:a.name+' is '+(a.state==='waiting'?'waiting for you':'still working')+'. The session ends and frees its place. Send a message to pick up where you left off.',returnFocus:anchor,
        buttons:[{label:'Cancel',value:null},{label:'End session',value:'ok',cls:'primary danger'}]});
      if(!ok)return;
    }
    await endLive(a);
  }catch(err){toast('Could not '+(op==='stop'?'stop':'end')+': '+esc(String(err&&err.message||err)),5000).classList.add('err');}
  finally{refocusAnchor(anchor);}
}
/* small modal: returns {value, checked} or null when dismissed. Focus trap, Escape and focus return live in dialog.js (spec 003 FR-033). */
const askDialog=DurbarDialog(document);
/* spec 043 FR-014: the profile file editor (profileeditor.js) uses the same bridge, dialog, toast and escaping */
if(window.DurbarProfileEditor)window.DurbarProfileEditor.init({bridge,askDialog,toast:(...x)=>toast(...x),esc:s=>esc(s)});
/* ---------------- spec 059: rename a session ---------------- */
/* Main sessions only (never helpers); a started or not started, live or ended card. */
const canRenameSession=a=>!!(a&&a.live&&!a.parent&&a.info&&bridge.renameSession);
/* One dialog for the More menu, the card menu and the Previous sessions row menu. `prev`: null for the agent's own session, else {id,title,runtime} of a Previous sessions row. */
async function renameSessionUi(a0,prev,o){
  const a=liveRoot(a0); if(!a||!a.live||!bridge.renameSession)return;
  const info=a.info||{}, app=kindWord(info.adapterId), cap=info.renameCap;
  const own=!prev, cur=own?a.name:(prev.name||prev.title||''), runtime=own?(a.title||''):(prev.runtime||'');
  const inApp=!(own&&info.lazy&&!info.resumeLast); /* a card that never started has no session in the agent app yet */
  const lines=[SN().whereLine(cap,app,inApp)];
  if(runtime&&runtime!==cur)lines.push('Name in '+app+': '+SN().shortName(runtime,80));
  let text=SN().shortName(cur,SN().MAX), reason='', out;
  for(;;){
    const res=await askDialog({title:'Rename session',body:'A short name for this session in Agent Durbar, 1 to '+SN().MAX+' characters. Leave it empty to use '+app+"'s title again.",lines,
      input:{label:'Name',value:text,max:SN().MAX,focus:true,select:true,error:reason,submitOnEnter:true,check:SN().nameError},
      returnFocus:o&&o.opener,buttons:[{label:'Cancel',value:null},{label:'Rename',value:'ok',cls:'primary'}]});
    if(!res)return;
    text=res.text||'';
    try{out=await bridge.renameSession(a.id,own?null:prev.id,text);}catch(err){out={ok:false,error:String(err&&err.message||err)};}
    /* main checks the name again with the shared rule (it also refuses a text that looks like a secret): that reason goes back under the field */
    if(out&&!out.ok&&/^(Use 1 to|Remove control|That looks like a secret)/.test(out.error||'')){reason=out.error;continue;}
    break;
  }
  if(!out||!out.ok){toast(esc((out&&out.error)||'Could not rename the session.'),5000).classList.add('err');return;}
  if(own){a.alias=out.name||undefined;repaintName(a);}
  else if(o&&o.onDone)o.onDone(out);
  announce(out.name?'Renamed.':'Name reset.');
  if(out.note)toast(esc(out.note),6000);
}
/* after a mode change the chip is re-rendered; put focus back on it (or the card it was opened from) unless the user moved it on */
function refocusAnchor(anchor){
  const ae=document.activeElement;if(ae&&ae!==document.body&&document.contains(ae))return;
  let t=anchor&&document.contains(anchor)?anchor:null;
  if(!t&&anchor&&(anchor.id==='modeChip'||anchor.id==='modelChip'||anchor.id==='compactBtn'||anchor.id==='ctxChip'||anchor.id==='agentChip'))t=$(anchor.id);
  if(!t&&anchor&&anchor.dataset&&anchor.dataset.id)t=document.querySelector('#stage [data-id="'+anchor.dataset.id+'"]');
  if(t&&t.focus)t.focus();
}
async function changeMode(a,mode,anchor){
  try{await changeModeInner(a,mode,anchor);}finally{refocusAnchor(anchor);}
}
async function changeModeInner(a,mode,anchor){
  const cur=a.info.permMode; if(mode===cur||!bridge.setPermMode)return;
  const pend=a.pend?a.pend.size:0, grants=(a.grants||[]).length;
  const opts={};
  if(mode==='allow'){
    const r=await askDialog({title:'Allow all for '+a.name+'?',body:'Edits, shell commands, web requests and tools will run without asking, in '+roomOf(a).path+'. Nothing is undone automatically; you can switch back at any time.',
      check:pend?{label:'Also approve the '+pend+' request'+(pend>1?'s':'')+' waiting now (listed above)',checked:false}:null,lines:pend?[...a.pend.values()].map(e=>{const t=e.n&&e.n.querySelector('.psum');return 'Waiting: '+(t?t.textContent:'a request');}):undefined,returnFocus:anchor,
      buttons:[{label:'Cancel',value:null},{label:'Allow all',value:'ok',cls:'primary warn'}]});
    if(!r)return; opts.approvePending=!!r.checked;
  } else if(grants){
    const r=await askDialog({title:'Switch '+a.name+' to '+MODE_NAME[mode]+'?',body:'This session has '+grants+' remembered "Allow for this session" permission'+(grants>1?'s':'')+'. Keep them for when you switch back, or clear them now?',
      returnFocus:anchor,buttons:[{label:'Cancel',value:null},{label:'Switch, keep them',value:'keep'},{label:'Switch and clear them',value:'clear',cls:'primary'}]});
    if(!r)return; opts.clearGrants=r.value==='clear';
  }
  const res=await bridge.setPermMode(a.id,mode,opts).catch(e=>({ok:false,error:String(e&&e.message||e)}));
  if(!res||!res.ok){toast('Could not change the mode: '+esc((res&&res.error)||'unknown error'),5000);return;}
  a.info.permMode=mode; a.info.permRestored=undefined; a.info.permFrom=undefined; a.role=roleFor(a.info); roAskAfterSwitch(a,mode,anchor);
  if(opts.clearGrants)setGrants(a,[]);
  renderRestoreStrip();
  toast(esc(a.name)+': <b>'+esc(MODE_NAME[mode])+(capsFor(a).permModeSwitch==='next-message'?'</b>. Applies from the next message.':'</b> from the next request.')+(mode==='allow'?' Everything runs without asking.':''),4200);
  if(ui.selected&&liveRoot(byId(ui.selected)||a)===a){const c=$('modeChip');if(c){c.outerHTML=modeChipHTML(a);}const h=document.querySelector('#panel .hint');if(h)h.textContent=composerHint(byId(ui.selected)||a);updatePanelHeader();}
  scheduleRender();
}
document.addEventListener('click',e=>{
  const cc=e.target.closest('#ctxChip');
  if(cc){e.stopPropagation();if(document.getElementById('ctxMenu')){closeCtxMenu();return;}const a=byId(ui.selected);if(a)openCtxMenu(a,cc);return;} /* spec 005 FR-037 */
  if(!e.target.closest('#ctxMenu'))closeCtxMenu();
  const mb=e.target.closest('#mcpBtn'); /* spec 005 FR-037: the MCP chip opens the existing dialog; the count follows it */
  if(mb){e.stopPropagation();const a=byId(ui.selected),r=a&&liveRoot(a);if(r)Promise.resolve(window.DurbarScreens.agentMcp(r,mcpOpts(r))).finally(()=>refreshMcpCount(r));return;}
  const ac=e.target.closest('#agentChip');
  if(ac){e.stopPropagation();if(document.getElementById('agentMenu')){closeAgentMenu();return;}const r=ac.getBoundingClientRect(),a=byId(ui.selected);if(a)openAgentMenu(a,r.left,r.bottom+6,ac);return;}
  if(!e.target.closest('#agentMenu'))closeAgentMenu();
  const mc=e.target.closest('#modelChip');
  if(mc){e.stopPropagation();if(document.getElementById('modelMenu')){closeModelMenu();return;}const r=mc.getBoundingClientRect(),a=byId(ui.selected);if(a)openModelMenu(a,r.left,r.bottom+6,mc);return;}
  if(!e.target.closest('#modelMenu'))closeModelMenu();
  const cb=e.target.closest('#compactBtn');
  if(cb&&!cb.closest('#ctxMenu')){e.stopPropagation();const a=byId(ui.selected);if(a)compactDialog(liveRoot(a),cb);return;}
  const chip=e.target.closest('#modeChip');
  if(chip){e.stopPropagation();if(document.getElementById('modeMenu')){closeModeMenu();return;}const r=chip.getBoundingClientRect(),a=byId(ui.selected);if(a)openModeMenu(a,r.left,r.bottom+6,chip);return;}
  if(!e.target.closest('#modeMenu,[data-act="ro-ask"]'))closeModeMenu(); /* spec 003 FR-095: the Read-only denial's button toggles the menu itself */
},true);
/* spec 006 FR-022: folder actions on a room's header (right-click, or the context-menu key on its door), same menu element as the mode menu.
   spec 033 FR-024 (issue 590): with two or more floors, "Move to floor ▸" opens a second level in the same element (‹ Back, one radio
   item per floor, the current one ticked and disabled); the move is the Floors panel's moveRoomToFloor, then an Undo toast. */
function openFolderMenu(r,x,y,anchor){
  if(!r||demoOn||!bridge||!bridge.removeFolder)return;
  closeModeMenu();
  const m=document.createElement('div');m.id='modeMenu';m.className='mode-menu';m.setAttribute('role','menu');
  const it=(act,label,sub,cls,extra)=>`<button type="button" role="menuitem" data-fact="${act}"${cls?` class="${cls}"`:''}${extra||''}><span class="mt"><b>${esc(label)}</b><small>${esc(sub)}</small></span></button>`;
  const canMove=floorsLive()&&FLOORS.floors.length>1&&!!bridge.moveFolderToFloor;
  const place=()=>{m.style.left='0px';m.style.top='0px';const b=m.getBoundingClientRect();m.style.left=Math.max(8,Math.min(x,innerWidth-b.width-8))+'px';m.style.top=Math.max(8,Math.min(y,innerHeight-b.height-8))+'px';};
  const paintTop=focusMove=>{
    m.setAttribute('aria-label','Folder '+r.name);
    const here=canMove&&floorById(r.floor);
    m.innerHTML=(bridge.newSession&&anyKindReady()?it('new','New session','Another agent with its own chat here'):'')
      +(bridge.listSchedules?it('sched','Schedules',(()=>{const n=schedulesOf(r).filter(s=>!s.done).length;return n?n+' scheduled, '+(nextRunOf(schedulesOf(r))?'next '+nextRunOf(schedulesOf(r)):'paused'):'Prompts sent here at a time, every day or at an interval';})()):'')
      +(bridge.renameFolder?it('rename','Rename…','A display name for this room'):'')
      +(canMove?`<button type="button" role="menuitem" data-fact="floor" aria-haspopup="menu" aria-expanded="false"><span class="mt"><b>Move to floor</b><small>${esc(here?'Now on '+here.name+'. Its agents go with it':'Its agents go with it')}</small></span><span class="ck" aria-hidden="true">▸</span></button>`:'')
      +(bridge.setFolderHidden?it('hide','Hide','Out of the office; its sessions keep running'):'')
      +it('rm','Remove folder','Ends its sessions; nothing on disk is deleted','mm-danger');
    place();
    (focusMove&&m.querySelector('[data-fact="floor"]')||m.querySelector('button')).focus();
  };
  const paintFloors=()=>{
    const cur=(floorById(r.floor)||{}).id;
    m.setAttribute('aria-label','Move '+r.name+' to floor');
    m.innerHTML=`<button type="button" role="menuitem" data-fact="back"><span class="mt"><b>‹ Back</b></span></button>`+FLOORS.floors.map(f=>{const here=f.id===cur,n=roomsOnFloor(f.id).length;
      return `<button type="button" role="menuitemradio" data-fact="to" data-floor="${esc(f.id)}" aria-checked="${here}"${here?' aria-disabled="true"':''}><span class="mt"><b>${esc(f.name)}</b><small>${esc(here?'Here now':(f.on?n+' folder'+(n===1?'':'s'):'Off: the folder leaves the office'))}</small></span><span class="ck">${here?'✓':''}</span></button>`;}).join('');
    place();
    (m.querySelector('[data-fact="to"]:not([aria-disabled="true"])')||m.querySelector('button')).focus();
  };
  document.body.appendChild(m);paintTop(false);
  m.addEventListener('click',e=>{const t=e.target.closest('[data-fact]');if(!t)return;const f=t.dataset.fact;
    if(f==='floor'){paintFloors();return;}
    if(f==='back'){paintTop(true);return;}
    if(t.getAttribute('aria-disabled')==='true')return;
    closeModeMenu();
    if(f==='to'){moveFolderByMenu(r,t.dataset.floor,anchor);return;}
    const ag=agents.find(q=>!q.parent&&q.room===r.id);
    if(f==='new'){if(ag)newSession(ag);}else if(f==='sched')openSchedules(r);else if(f==='rename')renameFolder(r,anchor);else if(f==='hide')hideFolder(r,true);else removeFolder(r);});
  m.addEventListener('keydown',e=>{const its=[...m.querySelectorAll('[data-fact]')],i=its.indexOf(document.activeElement),sub=!!m.querySelector('[data-fact="back"]');
    if(e.key==='ArrowDown'){e.preventDefault();its[(i+1)%its.length].focus();}else if(e.key==='ArrowUp'){e.preventDefault();its[(i+its.length-1)%its.length].focus();}
    else if(e.key==='ArrowRight'&&document.activeElement&&document.activeElement.dataset.fact==='floor'){e.preventDefault();paintFloors();}
    else if(sub&&(e.key==='ArrowLeft'||e.key==='Escape')){e.preventDefault();e.stopPropagation();paintTop(true);}
    else if(e.key==='Escape'||e.key==='Tab'){e.preventDefault();e.stopPropagation();closeModeMenu();if(anchor&&anchor.focus&&document.contains(anchor))anchor.focus();}});
}
/* spec 033 FR-024: the menu's move is the Floors panel's (moveRoomToFloor, FR-005), then the action toast with Undo (spec 030/052) */
async function moveFolderByMenu(r,floorId,anchor){
  const from=(floorById(r.floor)||{}).id,to=floorById(floorId);
  if(!to||to.id===from)return;
  const fail=res=>{toast(esc((res&&res.error)||'Could not move the folder.'),5000).classList.add('err');};
  const res=await moveRoomToFloor(r.id,to.id);
  if(!res||!res.ok){fail(res);return;}
  refocusAnchor(anchor);
  const fromName=(floorById(from)||{}).name||'';
  toastAction(esc(r.name)+' moved to <b>'+esc(to.name)+'</b>.'+(to.on?'':' That floor is off, so it left the office.'),'Undo',async()=>{
    const u=await moveRoomToFloor(r.id,from);
    if(!u||!u.ok){fail(u);return;}
    announce(r.name+' is back on '+fromName+'.');
  },8000); /* the toast area is a polite live region, so the move is announced once */
}
document.addEventListener('contextmenu',e=>{
  const h=e.target.closest('#stage .room-head');
  if(h&&!e.target.closest('.desk')){const door=h.querySelector('[data-door]'),r=door&&ROOMS.find(x=>x.id===door.dataset.door);
    if(r&&bridge&&bridge.removeFolder&&!demoOn){e.preventDefault();const b=h.getBoundingClientRect();openFolderMenu(r,e.clientX||b.left+16,e.clientY||b.bottom,door);return;}}
  /* spec 033 FR-024: in the List view the Folder cell opens the folder menu of that row's folder; the rest of the row keeps the agent's menu */
  const lf=e.target.closest('#list .lrow[data-id] .lfold');
  if(lf&&bridge&&bridge.removeFolder&&!demoOn){const a=byId(lf.closest('.lrow').dataset.id),rr=a&&roomOf(a);if(rr&&ROOMS.includes(rr)){e.preventDefault();const b=lf.getBoundingClientRect();openFolderMenu(rr,e.clientX||b.left+8,e.clientY||b.bottom,lf.closest('.lrow'));return;}}
  const d=e.target.closest('.desk[data-id], .helper[data-id], .lrow[data-id]');if(!d||d.closest('#panel'))return;
  const a=byId(d.dataset.id),ra=a&&liveRoot(a);if(!ra||!ra.live)return;
  const r=d.getBoundingClientRect();
  if(openModeMenu(a,e.clientX||r.left+16,e.clientY||r.top+16,d))e.preventDefault();
});

/* ---------------- model + effort ---------------- */
let MODELS=[];
/* spec 012 FR-120: one model list per agent kind; MODELS is the default kind's. A kind without a list gets [] (selects hidden, FR-062). */
const MODELS_BY={};
const isDefaultKind=k=>!k||!KINDS||k===defaultKind();
const modelsFor=k=>isDefaultKind(k)?MODELS:(MODELS_BY[k]||[]);
const firstModelId=list=>list.some(m=>m.id==='auto')?'auto':list[0]?list[0].id:'auto';
async function ensureModels(k){
  if(isDefaultKind(k)||MODELS_BY[k]||!bridge.listModels)return;
  MODELS_BY[k]=[];
  const r=await bridge.listModels(k).catch(()=>null);
  if(r&&r.ok)MODELS_BY[k]=r.models; else delete MODELS_BY[k]; /* asked again next time */
}
function modelLabel(info){
  const m=modelsFor(info.adapterId).find(x=>x.id===(info.model||'auto')), nm=m?m.name:(info.model||'auto')==='auto'?'Auto':info.model;
  const eff=(info.effort?' · '+info.effort+' effort':'')+(info.tier==='long'?' · long context':'');
  const mult=m&&m.multiplier!=null?' · ×'+m.multiplier+' credit multiplier':'';
  return {text:nm+eff,title:'Model: '+nm+eff+mult+(m&&m.multiplier!=null?' (as reported by your Copilot account)':'')};
}
function fillModelSelect(sel,cur,kind,prefix){
  const list=modelsFor(kind);
  sel.innerHTML=(list.length?list:[{id:'auto',name:'Auto'}]).map(m=>`<option value="${esc(m.id)}">${prefix||''}${esc(m.name)}${m.multiplier!=null?' ×'+m.multiplier:''}</option>`).join('');
  sel.value=list.some(m=>m.id===cur)?cur:firstModelId(list);
}
function fillEffortSelect(sel,modelId,cur,off,kind){
  const m=modelsFor(kind).find(x=>x.id===modelId), ef=off?[]:(m&&m.efforts)||[];
  sel.hidden=!ef.length; sel.innerHTML=ef.length?'<option value="">Effort: default'+(m.defaultEffort?' ('+esc(m.defaultEffort)+')':'')+'</option>'+ef.map(x=>`<option value="${esc(x)}">Effort: ${esc(x)}</option>`).join(''):'';
  if(ef.includes(cur))sel.value=cur;
}
async function loadModels(){
  loadKinds();
  /* spec 012 FR-157: main changed the list itself (a session was refused because of the sign-in) */
  if(bridge.onAdaptersChanged)bridge.onAdaptersChanged(list=>{if(Array.isArray(list)&&list.length){KINDS=list;applyKinds();}});
  if(!bridge.listModels)return;
  const r=await bridge.listModels().catch(()=>null);
  if(!r||!r.ok||!r.models.length)return;
  MODELS=r.models;
  const ms=$('modelSel');
  fillModelSelect(ms,'auto','');ms.dataset.kind='';
  ms.title='Model for new sessions. This is what your Copilot account offers; × is the cost multiplier the API reports.';
  syncKindModel();
}

/* ---------------- agent kinds: choose one, see which are ready, gate controls by capability (spec 012 T017) ---------------- */
let KINDS=null; /* null = no list (a bridge without listAdapters, or the call failed): the UI is as before */
const DMK=()=>window.DurbarModels;
const capsFor=a=>DMK().capsOf(a&&a.info,KINDS);
const feat=(a,f,mode)=>DMK().shows(capsFor(a),f,mode);
const kindCaps=id=>DMK().capsOf({adapterId:id},KINDS);
const defaultKind=()=>KINDS&&KINDS[0]?KINDS[0].id:'';
const anyKindReady=()=>!KINDS||DMK().kindChoices(KINDS).some(k=>!k.disabled); /* the room "+" and "+ New session" need a kind that can start */
/* spec 052 FR-005: the top bar's mode is the default for NEW sessions, not every agent's mode: it says so (and is narrower than before) */
const PERM_LABEL={'read-only':'Read-only',ask:'Ask first',allow:'Allow all'}; /* spec 052 FR (2026-10-21): the popover labels the select; no "New: " prefix */
/* Permissions select of a kind: only the modes it can enforce; a value it cannot hold falls back to read-only, never to a wider mode (spec 012 FR-067) */
function fillPermSelect(sel,caps){
  const modes=DMK().modesFor(caps),cur=sel.value;
  if([...sel.options].map(o=>o.value).join()!==modes.join())sel.innerHTML=modes.map(k=>`<option value="${k}">${PERM_LABEL[k]}</option>`).join('');
  sel.value=DMK().fallbackMode(caps,cur);
}
/* the first kind that is ready, preferring `want` */
const pickKind=want=>{const ch=DMK().kindChoices(KINDS);const w=ch.find(k=>k.id===want&&!k.disabled);return w?w.id:(ch.find(k=>!k.disabled)||{id:''}).id;};
/* spec 051 FR-013, FR-015: the account line per app ({ [id]: { status, text } } from harness:accounts), in memory only; a tooltip, never logged */
let ACCTS=null;
const acctText=(id,state)=>state==='ready'&&ACCTS&&ACCTS[id]&&typeof ACCTS[id].text==='string'?ACCTS[id].text:'';
/* spec 051 FR-020: in About agent apps the line already says "ready", so the account is only the masked name and plan ("o••• · Copilot
   Individual"): the dialog body stays within its 8 lines (spec 052 FR-170, check-ui-text in CI's DejaVu font) */
const aboutAcct=t=>t.replace(/^Signed in as /,'');
const kindTitle=k=>{const t=acctText(k.id,k.state);return t?k.name+': '+t:'';};
const kindOptions=()=>DMK().kindChoices(KINDS).map(k=>`<option value="${esc(k.id)}"${k.disabled?' disabled':''}${kindTitle(k)?` title="${esc(kindTitle(k))}"`:''}>${esc(k.shortName||k.name)}${k.stateText?' ('+esc(k.stateText)+')':''}</option>`).join('');
/* Toolbar: model and effort follow the chosen kind. A kind other than the default has no model list yet (FR-062, T049), so both are hidden and it starts with its own default. */
function syncKindModel(){
  const ms=$('modelSel'),ef=$('effortSel');
  const id=KINDS&&$('kindSel').value||defaultKind(), other=!!KINDS&&id!==defaultKind();
  const c=KINDS?kindCaps(id):null, can=!c||DMK().shows(c,'models');
  if(other&&can&&!MODELS_BY[id]){ensureModels(id).then(()=>{if(MODELS_BY[id]&&MODELS_BY[id].length)syncKindModel();});}
  const k=other?id:'', ok=can&&(!other||modelsFor(id).length>0);
  if(ok&&(ms.dataset.kind||'')!==k){fillModelSelect(ms,undefined,k);ms.dataset.kind=k;ms.title=other?'Model for new sessions of this agent app, as its CLI lists them.':'Model for new sessions. This is what your Copilot account offers; × is the cost multiplier the API reports.';}
  ms.hidden=!ok;
  fillEffortSelect(ef,ms.value,undefined,!ok||(c&&!DMK().shows(c,'effort')),k);
  fillPermSelect($('permMode'),kindCaps(id));
  if(KINDS)kindSelTitle($('kindSel'),KIND_SEL_TITLE); /* spec 051 FR-013: the chosen app's account in the tooltip */
  renderDefaultsChip();
}
/* spec 052 FR-105 (round 11): the defaults for new sessions are one chip in the top bar ("Copilot · Read-only · Auto"); the selects
   (ids kept) are in a small popover. The chip shows what each visible select holds, without the "New: " and "Model: " prefixes. */
const optWord=s=>s&&!s.hidden&&s.selectedOptions&&s.selectedOptions[0]?s.selectedOptions[0].textContent.replace(/^(New|Model):\s*/,'').trim():'';
function renderDefaultsChip(){
  const b=$('defaultsBtn'); if(!b)return;
  /* spec 052 (2026-10-21, round 1): the permission mode first, so a narrow chip cuts the model, never the mode */
  const parts=[optWord($('permMode')),optWord($('kindSel')),SIMPLE?'':optWord($('modelSel'))].filter(Boolean);
  /* spec 052 FR-164: the mode and the rest in two spans (same text), so a narrow top bar shows the whole mode word, not "Read-on…" */
  const dv=b.querySelector('.dv'),m=document.createElement('span'),r=document.createElement('span');
  m.className='dv-m';r.className='dv-r';m.textContent=parts.length?parts[0]:'Defaults';r.textContent=parts.length>1?' · '+parts.slice(1).join(' · '):'';
  dv.replaceChildren(m,r);
  b.classList.toggle('is-allow',!!$('permMode')&&$('permMode').value==='allow'); /* round 5: a default of Allow all is visible at a glance */
  b.setAttribute('aria-label','Defaults for new sessions: '+(parts.join(' · ')||'none'));
  b.title='Defaults for new sessions: '+(parts.join(', ')||'none')+'. Each agent shows its own values in its chat.';
}
function toggleDefaults(on,back){
  const pop=$('defaultsPop'),btn=$('defaultsBtn'); if(!pop||!btn)return;
  const show=on===undefined?pop.hidden:on;
  if(show===!pop.hidden)return;
  pop.hidden=!show; btn.setAttribute('aria-expanded',String(show));
  if(show){
    const r=btn.getBoundingClientRect();
    pop.style.top=Math.round(r.bottom+6)+'px';
    pop.style.left=Math.round(Math.max(14,Math.min(r.left,innerWidth-pop.offsetWidth-14)))+'px';
    const first=[...pop.querySelectorAll('select,button')].find(x=>!x.hidden&&!x.disabled&&x.getClientRects().length);
    if(first)first.focus();
  }else if(back)btn.focus();
}
function wireDefaults(){
  const pop=$('defaultsPop'),btn=$('defaultsBtn'); if(!pop||!btn)return;
  btn.onclick=()=>toggleDefaults(undefined,true);
  btn.onkeydown=e=>{if(e.key==='ArrowDown'){e.preventDefault();toggleDefaults(true);}};
  pop.addEventListener('change',renderDefaultsChip);
  pop.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();toggleDefaults(false,true);}});
  /* Tab past the last control, or a click elsewhere, closes it (a dialog opened from it, such as About agent apps, does not) */
  pop.addEventListener('focusout',e=>{const t=e.relatedTarget;if(t&&!pop.contains(t)&&t!==btn&&!t.closest('.dlg-ov,.dlg'))toggleDefaults(false);});
  document.addEventListener('mousedown',e=>{if(!pop.hidden&&!pop.contains(e.target)&&!btn.contains(e.target)&&!e.target.closest('.dlg-ov,.dlg'))toggleDefaults(false);},true);
}
function applyKinds(){
  const show=DMK().showsKindPicker(KINDS), sel=$('kindSel'), keep=sel.value;
  $('kindHelp').hidden=!show; sel.hidden=!show;
  /* spec 012 FR-136: hidden with one ready harness, but it still holds that one, so it is what new folders use */
  if(KINDS){sel.innerHTML=kindOptions();sel.value=pickKind(keep||defaultKind());}
  /* the other ready kinds' model lists, for their agents' model chips (spec 012 FR-120); a CLI probe, no prompt */
  (KINDS||[]).forEach(k=>{if(!isDefaultKind(k.id)&&k.state==='ready'&&DMK().shows(kindCaps(k.id),'models'))ensureModels(k.id).then(()=>scheduleRender());});
  syncKindModel();
  setBadge(); /* FR-027: the badge's tooltip lists the ready harnesses */
}
async function loadKinds(refresh){
  if(!bridge||!bridge.listAdapters)return;
  const r=await bridge.listAdapters(refresh===true).catch(()=>null);
  KINDS=Array.isArray(r)&&r.length?r:null;
  applyKinds();
  if(KINDS&&bridge.harnessAccounts&&!ACCTS)bridge.harnessAccounts(false).then(setAccounts,()=>undefined); /* spec 051 FR-014: once per run here; Settings refreshes it */
}
/* spec 051 FR-013: the picker's tooltips (each option, and the select for the chosen app) and the open New session dialog's select */
const KIND_SEL_TITLE='Agent app for new folders and sessions';
function kindSelTitle(sel,base){
  if(!sel)return;
  const k=DMK().kindChoices(KINDS).find(x=>x.id===sel.value),t=k?acctText(k.id,k.state):'';
  sel.title=base+(t?'. '+k.shortName+': '+t:'');
}
function setAccounts(a){
  ACCTS=a&&typeof a==='object'?a:null;
  if(!KINDS)return;
  for(const sel of [$('kindSel'),$('sdKind')]){if(!sel)continue;const v=sel.value;sel.innerHTML=kindOptions();sel.value=v;}
  kindSelTitle($('kindSel'),KIND_SEL_TITLE);kindSelTitle($('sdKind'),'Agent app for this session');
}
/* spec 052 FR-051: the toast names the agent app when it is known */
function notReadyToast(ch){toast(esc((ch&&ch.shortName)||'That agent app')+' isn\'t ready yet. Set it up in Settings &gt; Agent apps.',6000);}
async function aboutKinds(){
  for(;;){
    const ch=DMK().kindChoices(KINDS);
    const r=await askDialog({title:'About agent apps',size:'m',body:'Each agent app (Copilot, Claude Code, Codex) runs agents its own way. Only an app that is ready can be chosen. Settings > Agent apps can install, update or sign in to one for you.',
      lines:ch.map(k=>k.name+': '+(k.state==='ready'?'ready':k.stateText)+(acctText(k.id,k.state)?' · '+aboutAcct(acctText(k.id,k.state)):'')+(k.version?' · version '+k.version:'')+(k.hint?' · '+k.hint:'')),
      buttons:[{label:'Close',value:null},{label:'Check again',value:'again'},{label:'Set up agent apps…',value:'setup',cls:'primary'}],returnFocus:()=>$('kindHelp')});
    if(r&&r.value==='setup'){window.DurbarScreens.openSettings('harnesses');return;} /* spec 051 FR-008 */
    if(!r||r.value!=='again')return;
    await loadKinds(true);
  }
}

/* ---------------- switch model and context, compact (spec 030) ---------------- */
const DM=window.DurbarModels;
const modelOf=(id,kind)=>modelsFor(kind).find(m=>m.id===(id||'auto'))||{id:id||'auto',name:(id||'auto')==='auto'?'Auto':String(id),efforts:[]};
const ctrlOf=a=>(a.info&&a.info.modelControl)||{switch:'none',compact:false};
const tierOf=a=>a.info&&a.info.tier==='long'?'long':'default';
const busyNow=a=>a.state==='working'||a.state==='thinking'||a.state==='waiting'||!!a.worked||!!a.compacting;
const UNVERIFIED_WHY='Not verified on a real account yet: if a switch does nothing or fails, start a new session.';
const NO_SWITCH_WHY='This agent cannot change its model in place yet. Start a new session with the model you want; this one keeps its model until it ends.';
/* a toast with one action button (Undo); the container is a polite live region, the button is a normal tab stop */
function toastAction(html,label,onClick,ms){
  const t=document.createElement('div');t.className='toast with-act';
  const s=document.createElement('span');s.innerHTML=html;t.appendChild(s);
  const b=document.createElement('button');b.type='button';b.className='toast-act';b.textContent=label;
  let gone=false;const kill=()=>{if(gone)return;gone=true;t.style.transition='opacity .3s';t.style.opacity='0';setTimeout(()=>t.remove(),320);};
  b.onclick=()=>{kill();onClick();};t.appendChild(b);mountToast(t);holdTimer(t,ms===0?0:(ms||8000),kill);
  return t;
}
/* spec 052 FR-163: the same status line twice in a row is one line with a count ("… (×3)"), so repeated notes never push a request out of view */
function addInfoNote(chat,text,cls){
  const last=chat.el.lastElementChild;
  if(last&&last.dataset.fold===text&&last.dataset.foldKind===(cls||'')){const k=(+last.dataset.foldN||1)+1;last.dataset.foldN=String(k);last.textContent=text+' (×'+k+')';stickyScroll(chat);return last;}
  const n=document.createElement('div');n.className='note info'+(cls?' '+cls:'');n.textContent=text;n.dataset.fold=text;n.dataset.foldKind=cls||'';chat.el.appendChild(n);stickyScroll(chat);return n;}

function modelChipHTML(a){
  const m=modelLabel(a.info),pend=a.pendingModel;
  const win=modelWindow(a), txt=m.text+(win?' · '+DM.fmtTokens(win):'')+(pend?' → '+pend.name:''); /* spec 005 FR-037: name, effort and the window; the icon and the label say it is the model (FR-077) */
  const title=m.title+(pend?'. Next: '+pend.name+(pend.tier==='long'?' (long context)':'')+', when the current reply ends.':'')+(ctrlOf(a).switch==='none'?' This agent cannot switch in place; click for why.':' Click to change the model or the context.');
  return `<button class="mchip mchip-btn" id="modelChip" type="button" aria-haspopup="menu" aria-expanded="false" aria-label="${esc('Model: '+m.text+(win?', '+DM.fmtTokens(win)+' tokens context window':'')+(pend?'; next: '+pend.name:''))}" title="${esc(title+(win?' Context window: '+DM.fmtTokens(win)+' tokens.':''))}">${CT_IC.model}<span>${esc(txt)}</span><svg class="chev" viewBox="0 0 10 10" width="9" height="9" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 3.5l3 3 3-3"/></svg></button>`;
}
/* spec 005 FR-037: the window in use: as the runtime reported it for this session, else the model list's (spec 030), else none */
function modelWindow(a){
  const st=window.DurbarStats&&typeof STATS!=='undefined'?STATS.agent(a.id).ctx:null;
  if(st&&st.limit>0&&!a.ctxWaiting)return st.limit;
  const w=DM.windowOf(modelOf(a.info.model||'auto',a.info.adapterId),tierOf(a));
  return w>0?w:0;
}
function updateModelChip(a){
  const el=$('modelChip');if(!el||!ui.selected)return;const cur=byId(ui.selected);if(!cur||liveRoot(cur)!==a)return;
  const html=modelChipHTML(a);if(el._html===html)return; /* only when it changed (the window arrives with context events) */
  const had=document.activeElement===el,open=el.getAttribute('aria-expanded');el.outerHTML=html;const n=$('modelChip');if(n){n._html=html;n.setAttribute('aria-expanded',open||'false');if(had)n.focus({preventScroll:true});}
}

/* ---------------- custom agent per session (spec 043) ---------------- */
function agentChipHTML(a){
  const cur=a.profile?a.profile.name:'Default', pend=a.pendingProfile;
  const title='Profile: '+cur+(pend?'. Next: '+(pend.id?pend.name:'Default')+', when the current reply ends.':'')+' Click to choose a profile (a custom agent) for this session.';
  return `<button class="mchip mchip-btn" id="agentChip" type="button" aria-haspopup="menu" aria-expanded="false" aria-label="${esc('Profile: '+cur+(pend?' → '+(pend.id?pend.name:'Default'):''))}" title="${esc(title)}">${CT_IC.profile}<span>${esc(cur+(pend?' → '+(pend.id?pend.name:'Default'):''))}</span><svg class="chev" viewBox="0 0 10 10" width="9" height="9" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 3.5l3 3 3-3"/></svg></button>`;
}
function updateAgentChip(a){
  const el=$('agentChip');if(!el||!ui.selected)return;const cur=byId(ui.selected);if(!cur||liveRoot(cur)!==a)return;
  el.outerHTML=agentChipHTML(a);
}
function closeAgentMenu(){const m=document.getElementById('agentMenu');if(m){m.remove();const c=$('agentChip');if(c)c.setAttribute('aria-expanded','false');}}
const SOURCE_WORD={repo:'from this folder',user:'your agents',other:''};
async function openAgentMenu(a0,x,y,anchor){
  const a=liveRoot(a0); if(!a||!bridge.listProfiles)return;
  closeAgentMenu();closeModelMenu();closeModeMenu();
  const m=document.createElement('div');m.id='agentMenu';m.className='mode-menu model-menu';m.setAttribute('role','menu');m.setAttribute('aria-label','Profile for '+a.name);
  m.innerHTML='<p class="mm-h">Profile</p><p class="mm-why" role="note">Looking for profiles…</p>';document.body.appendChild(m);
  const place=()=>placeMenu(m,x,y,anchor);place(); /* spec 005 FR-037: above a toolbar chip */
  const c=$('agentChip');if(c&&anchor===c)c.setAttribute('aria-expanded','true');
  const PE=window.DurbarProfileEditor, canEdit=!!(PE&&bridge.readProfileFile&&bridge.listProfileFiles);
  /* spec 043 FR-040: main's file list, read beside the profiles, says which files may be deleted (writable plain files) */
  const [r,lf]=await Promise.all([bridge.listProfiles(a.id).catch(err=>({ok:false,error:String(err&&err.message||err),profiles:[]})),canEdit&&bridge.deleteProfileFile?bridge.listProfileFiles().catch(()=>null):null]);
  if(!document.body.contains(m))return;
  a.profileList=r.ok?r.profiles:a.profileList;
  const curId=a.profile?a.profile.id:null;
  const plat=(window.agentDurbar&&window.agentDurbar.platform)||'';
  const canDel=file=>!!(PE&&PE.samePath&&lf&&lf.files&&lf.files.some(f=>f.writable&&PE.samePath(f.path,file,plat))); /* case folded only on Windows and macOS (review on PR 572) */
  const item=(id,name,sub,tag,file)=>{const b=`<button type="button" role="menuitemradio" aria-checked="${id===curId}" data-prof="${esc(id===null?'':id)}"><span class="mt"><b>${esc(name)}${tag?' <span class="tag">'+esc(tag)+'</span>':''}</b>${sub?'<small>'+esc(sub)+'</small>':''}</span><span class="ck">${id===curId?'✓':''}</span></button>`;
    /* spec 043 FR-014: an Edit button beside a profile that has a file opens the editor (the row itself still selects) */
    return file&&canEdit?`<div class="mm-prow">${b}<button type="button" class="mm-edit" data-edit="${esc(id)}" title="${esc('Open '+name+' in the editor')}" aria-label="${esc('Edit the file of '+name)}">Edit</button>${canDel(file)?`<button type="button" class="mm-edit mm-del" data-del="${esc(id)}" title="${esc('Delete the file of '+name+' from disk')}" aria-label="${esc('Delete the file of '+name)}">Delete</button>`:''}</div>`:b;};
  let h='<p class="mm-h">Profile</p>'+item(null,'Default','The standard agent of this session','');
  if(!r.ok)h+=`<p class="mm-why" role="note">${esc(r.error||'Could not list the profiles.')}</p>`;
  else if(!r.profiles.length)h+='<p class="mm-why" role="note">No profiles found. Put agent files in <code>.github/agents/*.agent.md</code> in this folder, or in <code>~/.copilot/agents</code>.</p>';
  else h+=r.profiles.map(p=>item(p.id,p.name,p.description||'',SOURCE_WORD[p.source]||'',p.path)).join('');
  if(canEdit&&bridge.createProfileFile)h+='<div class="mm-foot"><button type="button" class="btn sm" data-newprof="1">New profile…</button></div>';
  m.innerHTML=h;place();
  m.addEventListener('click',e=>{if(e.target.closest('button[data-newprof]')){closeAgentMenu();PE.newProfile({app:a.info&&a.info.adapterId==='claude'?'claude':'copilot',returnFocus:anchor||$('agentChip')});return;}
    const ed=e.target.closest('button[data-edit]');if(ed){const p=(a.profileList||[]).find(x=>x.id===ed.dataset.edit);closeAgentMenu();if(p&&p.path)PE.openByPath(p.path,{returnFocus:anchor||$('agentChip')});return;}
    const dl=e.target.closest('button[data-del]');if(dl){const p=(a.profileList||[]).find(x=>x.id===dl.dataset.del);closeAgentMenu();if(p&&p.path)PE.removeByPath(p.path,{returnFocus:anchor||$('agentChip')});return;} /* spec 043 FR-040 */
    const b=e.target.closest('button[data-prof]');if(!b)return;closeAgentMenu();
    const id=b.dataset.prof||null, p=id?(a.profileList||[]).find(x=>x.id===id):{id:null,name:'Default'};if(!p)return;
    if((a.profile?a.profile.id:null)===id&&!a.pendingProfile)return;
    if(busyNow(a)){a.pendingProfile=p;updateAgentChip(a);addNote(liveChat(a),'The profile changes to '+esc(p.name)+' when the current reply ends.');return;}
    applyProfile(a,p,anchor);});
  m.addEventListener('keydown',e=>{const it=[...m.querySelectorAll('button')],i=it.indexOf(document.activeElement);
    if(e.key==='ArrowDown'){e.preventDefault();it[(i+1)%it.length].focus();}else if(e.key==='ArrowUp'){e.preventDefault();it[(i+it.length-1)%it.length].focus();}
    else if(e.key==='Escape'||e.key==='Tab'){e.preventDefault();e.stopPropagation();closeAgentMenu();if(anchor&&anchor.focus&&document.contains(anchor))anchor.focus();}});
  (m.querySelector('[aria-checked="true"]')||m.querySelector('button')).focus();
}
/* select (null id = default); a repository agent asks once with what it brings (spec 043 US2) */
async function applyProfile(a,p,anchor){
  let r=await bridge.selectProfile(a.id,p.id||null).catch(err=>({ok:false,error:String(err&&err.message||err)}));
  if(r&&r.needsConfirm){
    const q=r.profile||p, lines=[];
    lines.push('Tools: '+(q.tools?(q.tools.length?q.tools.join(', '):'none'):'all the tools of this session'));
    lines.push('Preferred model: '+(q.model||'none (the session model)'));
    lines.push('MCP servers it starts: '+(q.mcpServers&&q.mcpServers.length?q.mcpServers.join(', '):'none'));
    if(q.path)lines.push('File: '+q.path);
    const ok=await askDialog({title:'Use the profile '+q.name+' from this folder?',body:'This profile comes from the folder\'s repository, so someone else may have written it. It changes how the agent answers and which tools it uses; your permission mode stays as it is. Asked once for this folder and this version of the file.',lines,returnFocus:anchor||$('agentChip'),
      buttons:[{label:'Cancel',value:null},{label:'Use this profile',value:'ok',cls:'primary'}]});
    if(!ok)return;
    r=await bridge.selectProfile(a.id,q.id,true).catch(err=>({ok:false,error:String(err&&err.message||err)}));
  }
  if(!r||!r.ok){toast('Could not change the profile: '+esc((r&&r.error)||'unknown error'),5000);return;}
  a.profile=r.profile?Object.assign({},(a.profileList||[]).find(x=>x.id===r.profile.id)||{},r.profile):null;
  updateAgentChip(a);scheduleRender();
  addNote(liveChat(a),a.profile?'Profile: '+esc(a.profile.name)+' for the next replies.':'Back to the default profile.');
}
function closeModelMenu(){const m=document.getElementById('modelMenu');if(m){m.remove();const c=$('modelChip');if(c)c.setAttribute('aria-expanded','false');}}
function openModelMenu(a0,x,y,anchor){
  const a=liveRoot(a0); if(!a||!a.live||!a.info||!bridge.setModel)return;
  closeModelMenu();closeModeMenu();
  const on=ctrlOf(a).switch!=='none'&&!!bridge.setModel, curId=a.info.model||'auto', cur=modelOf(curId,a.info.adapterId), tier=tierOf(a), pend=a.pendingModel;
  const dis=on?'':' aria-disabled="true"';
  const kl=modelsFor(a.info.adapterId), list=kl.length?kl:[cur];
  let h=on?'':`<p class="mm-why" role="note">${esc(NO_SWITCH_WHY)}</p>`;
  h+='<p class="mm-h">Model</p>'+list.map(m=>{const chk=m.id===curId,w=DM.windowOf(m);
    return `<button type="button" role="menuitemradio" aria-checked="${chk}" data-pick="${esc(m.id)}"${dis}><span class="mt"><b>${esc(m.name)}${m.multiplier!=null?' ×'+esc(m.multiplier):''}</b><small>${esc(DM.priceLine(m))}${w?' · '+esc(DM.fmtTokens(w))+' window':''}</small></span><span class="ck">${chk?'✓':''}</span></button>`;}).join('');
  if((cur.efforts||[]).length)h+='<p class="mm-h">Reasoning effort</p><div class="mm-seg" role="group" aria-label="Reasoning effort">'+['',...cur.efforts].map(x=>{const on2=(a.info.effort||'')===x;return `<button type="button" data-effort="${esc(x)}" aria-pressed="${on2}"${dis}>${x?esc(x):'Default'}</button>`;}).join('')+'</div>';
  if(DM.hasLong(cur))h+=`<button type="button" role="menuitemcheckbox" aria-checked="${tier==='long'}" data-tier="1"${dis} class="mm-tier"><span class="mt"><b>Long context</b><small>${esc(DM.fmtTokens(DM.windowOf(cur,'long')))} window · ${esc(DM.priceLine(cur,'long'))}</small></span><span class="ck">${tier==='long'?'✓':''}</span></button>`;
  if(pend)h+=`<div class="mm-pend" role="status"><span>Next: <b>${esc(pend.name)}</b>${pend.tier==='long'?' (long context)':''}, when this reply ends.</span><button type="button" data-cancelq="1">Cancel</button></div>`;
  h+=on?'<p class="mm-note">Applies from the next message; the conversation is kept. Costlier switches ask first, and your spending limit never changes.'+(ctrlOf(a).unverified?' '+esc(UNVERIFIED_WHY):'')+'</p>':'<div class="mm-foot"><button type="button" class="btn" data-newsess="1">New session…</button></div>';
  const m=document.createElement('div');m.id='modelMenu';m.className='mode-menu model-menu';m.setAttribute('role','menu');m.setAttribute('aria-label','Model and context for '+a.name);
  m.innerHTML=h;document.body.appendChild(m);
  const {px,py}=placeMenu(m,x,y,anchor); /* spec 005 FR-037: above a toolbar chip */
  m.addEventListener('click',e=>{
    const b=e.target.closest('button');if(!b)return;
    if(b.dataset.newsess){closeModelMenu();newSession(a);return;}
    if(b.dataset.cancelq){closeModelMenu();cancelPendingModel(a,anchor);return;}
    if(b.getAttribute('aria-disabled')==='true')return;
    closeModelMenu();
    if(b.dataset.pick!==undefined){const t=modelOf(b.dataset.pick,a.info.adapterId);chooseModel(a,{model:t.id,contextTier:t.id===cur.id?tier:'default'},anchor);}
    else if(b.dataset.effort!==undefined)chooseModel(a,{model:cur.id,effort:b.dataset.effort||null,contextTier:tier},anchor);
    else if(b.dataset.tier)chooseModel(a,{model:cur.id,contextTier:tier==='long'?'default':'long'},anchor);
  });
  m.addEventListener('keydown',e=>{const it=[...m.querySelectorAll('button')],i=it.indexOf(document.activeElement);
    if(e.key==='ArrowDown'||e.key==='ArrowRight'){e.preventDefault();it[(i+1)%it.length].focus();}else if(e.key==='ArrowUp'||e.key==='ArrowLeft'){e.preventDefault();it[(i+it.length-1)%it.length].focus();}
    else if(e.key==='Escape'||e.key==='Tab'){e.preventDefault();e.stopPropagation();closeModelMenu();if(anchor&&anchor.focus&&document.contains(anchor))anchor.focus();}});
  (m.querySelector('[aria-checked="true"]')||m.querySelector('button')).focus();
  const c=$('modelChip');if(c&&anchor===c)c.setAttribute('aria-expanded','true');
}

async function chooseModel(a,req,anchor){
  try{await chooseModelInner(a,req,anchor);}finally{refocusAnchor(anchor);}
}
async function chooseModelInner(a,req,anchor){
  const cur=modelOf(a.info.model,a.info.adapterId),tgt=modelOf(req.model,a.info.adapterId),tierFrom=tierOf(a),tierTo=req.contextTier==='long'?'long':'default';
  const sameEffort=req.effort===undefined||(req.effort||'')===(a.info.effort||'');
  const pend=a.pendingModel;
  if(!pend&&tgt.id===cur.id&&tierTo===tierFrom&&sameEffort)return;
  const c=STATS.agent(a.id).ctx,tokens=c?c.tokens:undefined;
  const cap=isUsdCap(a)?undefined:a.info.maxAiCredits,used=a.usage?a.usage.nano/1e9:0; /* the switch estimate is in AI credits: a dollar cap is not compared */
  const cf=DM.confirmFor(cur,tgt,{tokens,cap,used,tierFrom,tierTo});
  const confirm={};
  if(cf.needed){
    const lines=cf.reasons.map(r=>r.text);
    lines.push('Price now: '+DM.priceLine(cur,tierFrom)+'. New: '+DM.priceLine(tgt,tierTo)+'.');
    if(cf.estimate!==undefined&&!cf.overCap)lines.push('Reading this conversation once would cost about '+DM.fmtCredits(cf.estimate)+' AI credits with '+tgt.name+' (an estimate, if nothing is cached).');
    if(cap>0)lines.push('Your spending limit of '+fmtCap(cap)+' AI credits is not changed.');
    if(busyNow(a))lines.push('A reply is running: the switch applies when it ends.'+(ctrlOf(a).unverified?' If you stop the reply, whether the switch still applies is not verified.':''));
    if(ctrlOf(a).unverified)lines.push(UNVERIFIED_WHY);
    const r=await askDialog({title:'Switch '+a.name+' to '+tgt.name+(tierTo==='long'?' (long context)':'')+'?',body:'The conversation is kept. From the next message this agent uses the new model.',lines,returnFocus:anchor,
      buttons:[{label:'Cancel',value:null},{label:cf.compaction?'Compact and switch':cf.overCap?'Switch anyway':'Switch',value:'ok',cls:'primary'+(cf.overCap?' warn':'')}]});
    if(!r)return;
    if(cf.compaction)confirm.compaction='accept';
  }
  /* an effort the new model does not support is cleared (its default), never sent: the runtime would refuse the switch */
  const effort=req.effort!==undefined?req.effort:(a.info.effort&&tgt.id!==cur.id&&!(tgt.efforts||[]).includes(a.info.effort)?null:undefined);
  await sendModelChange(a,Object.assign({model:tgt.id,contextTier:tierTo},effort!==undefined?{effort}:{},confirm.compaction?{confirm}:{}),{prev:{model:cur.id,effort:a.info.effort,tier:tierFrom},tgt,anchor});
}
async function sendModelChange(a,req,ctx){
  const res=await bridge.setModel(a.id,req).catch(e=>({ok:false,error:String(e&&e.message||e)}));
  if(!res||!res.ok){toast('Could not change the model: '+esc((res&&res.error)||'unknown error'),6000);return;}
  const r=res.result||{},nm=ctx.tgt.name+(req.contextTier==='long'?' (long context)':'');
  if(r.status==='applied'){
    /* spec 052 (2026-10-21): one Undo toast per agent; a newer switch replaces the older toast (only the last switch can be undone) */
    if(!ctx.undo){document.querySelectorAll('#toasts .toast[data-undo-model="'+CSS.escape(a.id)+'"]').forEach(t=>t.remove());const t=toastAction(esc(a.name)+': <b>'+esc(nm)+'</b> from the next message.','Undo',()=>undoModel(a,ctx.prev,ctx.anchor),8000);if(t&&t.dataset)t.dataset.undoModel=a.id;}
    else toast(esc(a.name)+': back to <b>'+esc(nm)+'</b>.',3800);
  }else if(r.status==='queued'){
    a.pendingModel={queueId:r.queueId,name:ctx.tgt.name,tier:req.contextTier,prev:ctx.prev};updateModelChip(a);
    toast(esc(a.name)+' is replying: <b>'+esc(nm)+'</b> applies when the reply ends.',5000);
  }else if(r.status==='needs-confirmation'){
    const cf=r.confirmation||{};
    const d=await askDialog({title:'Compact the context first?',body:(cf.targetName||ctx.tgt.name)+' has a window of '+DM.fmtTokens(cf.targetLimit)+' tokens, and this conversation uses '+DM.fmtTokens(cf.currentTokens)+'. It must be compacted before the switch, which costs one model call.',returnFocus:ctx.anchor,
      buttons:[{label:'Cancel',value:null},{label:'Compact and switch',value:'ok',cls:'primary'}]});
    if(d)await sendModelChange(a,Object.assign({},req,{confirm:{compaction:'accept'}}),ctx);
  }else toast(esc(r.message||'The model was not changed.'),5000);
}
async function undoModel(a,prev,anchor){
  if(!bridge.setModel)return;
  const req={model:prev.model,contextTier:prev.tier,effort:prev.effort||null};
  await sendModelChange(a,req,{prev,tgt:modelOf(prev.model),anchor,undo:true});
  refocusAnchor(anchor);
}
async function cancelPendingModel(a,anchor){
  const p=a.pendingModel;if(!p||!bridge.cancelQueuedModel)return;
  const r=await bridge.cancelQueuedModel(a.id,p.queueId).catch(()=>({ok:false}));
  if(r&&r.ok){a.pendingModel=undefined;updateModelChip(a);toast(esc(a.name)+': the queued switch to <b>'+esc(p.name)+'</b> was cancelled.',3800);}
  else toast('Nothing to cancel: the switch already applied or was dropped.',4200);
  refocusAnchor(anchor);
}

/* events: the model changed (ours or the runtime's) and compaction lines */
function onModelEvent(a,e){
  const chat=liveChat(a),keepAuto=(a.info.model||'auto')==='auto'&&e.cause!=='user';
  if(!keepAuto){
    a.info.model=e.model;
    if(e.cause==='user'||e.effort!==undefined)a.info.effort=e.effort;
    a.info.tier=e.tier==='long'?'long':undefined;
    a.role=roleFor(a.info);
  }
  a.ctxWaiting=true; /* the runtime reports the new window with the next message */
  if(e.cause==='user'&&a.pendingModel)a.pendingModel=undefined;
  /* the start-up report and Auto's own routing are not a change the user needs to hear about */
  const quiet=e.cause==='runtime'&&(!e.previousModel||keepAuto);
  if(!quiet){
    const nm=x=>modelOf(x).name;
    const n=addInfoNote(chat,DM.modelChangeText(e,nm),e.cause==='user'?'':'rt');
    if(e.cause!=='user'){n.classList.remove('info');toast(esc(a.name)+': the runtime switched to <b>'+esc(nm(e.model))+'</b> ('+(e.cause==='rate-limit'?'rate limit':e.cause==='fallback'?'request refused':'its own choice')+').',5200);}
  }
  updateModelChip(a);updateCtxChip(a);scheduleRender();
}
function onCompaction(a,e){
  const chat=liveChat(a), at=()=>new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
  /* spec 052 FR-163 (owner, 2026-10-21): compactions in a row (nothing else added to the chat in between) are one line that updates in
     place: "Context compacted 4 times · last 10:21: …". Its tooltip lists each one. The line is found by its place in the chat, not by
     isConnected: a chat that is not open is not in the page, and that check left a "Compacting the context…" line behind every time. */
  let R=a.compRun;
  if(!R||R.chat!==chat||!R.el||R.el.parentNode!==chat.el||(chat.el.lastElementChild!==R.el&&!(R.pending&&e.phase!=='start')))R=null; /* a started one ends on its own line */
  const line=t=>{const el=document.createElement('div');el.className='note info cline';el.setAttribute('role','status');el.textContent=t;chat.el.appendChild(el);return el;};
  if(!R)R=a.compRun={chat,n:0,at:'',el:null,log:[]};
  const t=DM.compactionFoldText(e,R.n+(e.phase==='complete'?1:0),e.phase==='complete'?at():R.at);
  if(R.el)R.el.textContent=t;else R.el=line(t);
  R.el.classList.toggle('failed',e.phase==='failed');
  stickyScroll(chat);
  R.pending=e.phase==='start';
  if(e.phase==='start'){a.compacting=true;}
  else{
    if(e.phase==='complete'){R.n++;R.at=at();}
    R.log.push(at()+'  '+DM.compactionText(e));if(R.log.length>40)R.log.shift();
    if(R.log.length>1)R.el.title=R.log.join('\n');
    a.compacting=false;
    if(e.phase==='complete'){
      a.compactions=(a.compactions||0)+1;a.compactFailed=false;
      const old=STATS.agent(a.id).ctx;
      if(e.tokensAfter>=0)STATS.setContext(a.id,{tokens:e.tokensAfter,limit:e.limit>0?e.limit:(old&&old.limit)||0});
    }else a.compactFailed=true;
  }
  updateCtxChip(a);if(e.phase!=='start')maybeSuggestFresh(a);
}

/* manual compaction: confirm what it costs, optional focus, then the result line comes from the compaction events */
async function compactDialog(a,anchor){
  if(!bridge.compact||ctrlOf(a).compact!==true)return;
  if(busyNow(a)){toast('The agent is busy. Compact when it is idle.',3800);return;}
  const cur=modelOf(a.info.model,a.info.adapterId),c=STATS.agent(a.id).ctx,est=DM.estimateInputCredits(c&&c.tokens,cur,tierOf(a));
  const lines=['Summarises the conversation so it takes less room. It costs one model call'+(est!==undefined?' (about '+DM.fmtCredits(est)+' AI credits to read the conversation, an estimate if nothing is cached)':' (the price of '+cur.name+' is not reported)')+' and cannot be undone.'];
  if(c&&c.limit>0)lines.push('Now: '+DM.fmtTokens(c.tokens)+' of '+DM.fmtTokens(c.limit)+' tokens.');
  if(ctrlOf(a).unverified)lines.push('Not verified on a real account yet; if it fails, the conversation stays as it is.');
  const r=await askDialog({title:'Compact the context of '+a.name+'?',body:'Older messages are replaced by a summary; the agent keeps working in the same session.',lines,input:{label:'Focus (optional)',hint:'What the summary should keep',placeholder:'e.g. the API decisions',max:200},returnFocus:anchor,
    buttons:[{label:'Cancel',value:null},{label:'Compact',value:'ok',cls:'primary'}]});
  if(!r)return;
  const res=await bridge.compact(a.id,(r.text||'').trim()||undefined).catch(e=>({ok:false,error:String(e&&e.message||e)}));
  if(!res||!res.ok)toast('Could not compact: '+esc((res&&res.error)||'unknown error'),6000);
  else if(res.result&&res.result.success===false)toast('Not compacted: '+esc(res.result.message||'the runtime declined.'),6000);
  else if(res.result&&res.result.success===true){
    /* the line normally comes from the compaction events; if the runtime sent none for a manual compaction, say it from the result */
    const before=a.compactions||0,rr=res.result;
    setTimeout(()=>{if((a.compactions||0)===before&&!a.compacting)onCompaction(a,{phase:'complete',trigger:'manual',tokensRemoved:rr.tokensRemoved,tokensAfter:rr.tokensAfter});},1500);
  }
  refocusAnchor(anchor);
}

/* near the limit: suggest a fresh session once, dismissible for good (spec 030 FR-013) */
function maybeSuggestFresh(a){
  const c=STATS.agent(a.id).ctx;if(!c||!(c.limit>0))return;
  const pct=Math.round(c.tokens/c.limit*100);
  if(a.freshNote&&a.freshNote.isConnected){if(pct<80){a.freshNote.remove();a.freshNote=null;}return;}
  const idle=!busyNow(a);
  if(!DM.suggestFresh({percent:pct,compactions:a.compactions||0,lastCompactionFailed:!!a.compactFailed,idle,dismissed:a.freshDismissed,canCompact:ctrlOf(a).compact===true}))return;
  const chat=liveChat(a),n=document.createElement('div');n.className='note fresh';n.setAttribute('role','note');
  const why=a.compactFailed&&!a.compactions?'The last compaction did not work.':a.compactions?'It was already compacted '+(a.compactions>1?a.compactions+' times':'once')+'.':'This agent cannot compact in place.';
  n.innerHTML='<b>This conversation is '+pct+'% full.</b> '+esc(why)+' A new session starts clean in the same folder; this one keeps its history.<div class="note-actions"><button class="btn" type="button" data-fresh="new">New session…</button>'+(canHandoff(a)?'<button class="btn" type="button" data-fresh="sum">New session with a summary…</button>':'')+'<button class="btn" type="button" data-fresh="x">Dismiss</button></div>';
  n.querySelector('[data-fresh="new"]').onclick=()=>newSession(a);
  const sb=n.querySelector('[data-fresh="sum"]');if(sb)sb.onclick=()=>newSession(a,{summary:true});
  n.querySelector('[data-fresh="x"]').onclick=()=>{a.freshDismissed=true;n.remove();a.freshNote=null;const i=$('msgInput');if(i)i.focus();};
  chat.el.appendChild(n);a.freshNote=n;stickyScroll(chat);
}

/* ---------------- new session (another agent in a folder) ---------------- */
function closeSessDlg(){const d=document.getElementById('sessDlg');if(d)d.remove();}
/* spec 030 FR-036: a live agent whose kind can make a hand-off summary */
/* ---------------- spec 054: remote control from the agent app's own service (web and mobile; FR-060 names it) ---------------- */
/* Only for a live main agent whose kind reports `remote`; hidden otherwise (FR-006). State lives on the agent (`a.remote`) and in main. */
const canRemote=a=>!!(bridge.setRemote&&a&&a.live&&!a.parent&&a.info&&feat(a,'remote'));
/* spec 054 FR-060: the service this agent app is controlled from (GitHub for Copilot before the field existed) */
const svc=a=>{const r=capsFor(a)&&capsFor(a).remoteService;return r&&r.name?r:{name:'GitHub',host:'github.com',mobile:'GitHub Mobile'};};
const remoteVisText=v=>v==='repo'?'Visible to: anyone who can read the repository.':v==='unshared'?'Visible to: you and the repository\'s collaborators.':'';
const remoteItemInner=a=>a.remote?'<span class="mt">Stop remote control<small>Ends following and steering</small></span>':'<span class="mt">Control from '+esc(svc(a).name)+' (web and mobile)<small>Follow and steer it from your phone</small></span>';
const remoteChipHTML=a=>`<button class="mchip mchip-btn" id="remoteChip" type="button" title="Remote control is on: this session can be followed and steered from ${esc(svc(a).name)}. Click for the link."${a.remote?'':' hidden'}>Remote</button>`;
function remotePalItems(){
  const a=ui.selected?byId(ui.selected):null; if(!canRemote(a))return [];
  const kw='remote mobile phone steer '+svc(a).name.toLowerCase();
  return [a.remote?{label:'Stop remote control',hint:a.name,kw,run:()=>remoteOff(a)}:{label:'Control from '+svc(a).name+' (web and mobile)',hint:a.name,kw,run:()=>remoteOn(a)}];
}
/* the header chip and the More item follow the state in place (the composer keeps its text); the office re-renders the card */
function updateRemoteUi(a){
  if(ui.selected===a.id){const c=$('remoteChip');if(c)c.hidden=!a.remote;const b=$('remoteBtn');if(b){b.innerHTML=remoteItemInner(a);b.classList.toggle('on',!!a.remote);}}
  scheduleRender();
}
const remoteBack=()=>$('moreBtn')||$('panelTitle');
let remoteBusy=false;
async function remoteOn(a){
  /* spec 054 FR-011: never together with Allow all (main refuses too); say why before asking anything */
  if(a&&a.info&&a.info.permMode==='allow'){toast('Remote control is off in Allow all: anyone steering this session on '+esc(svc(a).name)+' could make it run commands without asking you. Switch '+esc(a.name)+' to Ask first, then turn it on.',7000).classList.add('err');return;}
  if(!canRemote(a)||remoteBusy||a.remote)return;
  const S=svc(a);
  const r=await askDialog({title:'Control this session from '+S.name+'?',
    body:'Durbar turns on remote control for this session. Its messages are sent to '+S.name+', so you can follow and steer it from '+S.host+' and '+S.mobile+'. Anyone who can see this session on '+S.name+' can steer it.',
    lines:[S.host==='github.com'?'Who can see it is decided by GitHub: you and the repository\'s collaborators, or everyone who can read the repository. Durbar does not change that.':'Who can see it is decided by your '+S.name+' account. Durbar does not change that.'],
    buttons:[{label:'Cancel',value:null},{label:'Turn on',value:'on',cls:'primary warn'}],returnFocus:remoteBack});
  if(!r||r.value!=='on')return;
  remoteBusy=true; let res;
  try{res=await bridge.setRemote(a.id,true);}catch(e){res={ok:false,error:String(e&&e.message||e)};}finally{remoteBusy=false;}
  if(res&&res.cancelled)return; /* spec 054 FR-011: the user said no in the main process's own confirmation */
  if(!res||!res.ok){toast('Could not turn on remote control: '+esc(res&&res.error||'unknown error'),6000).classList.add('err');return;}
  a.remote={url:typeof res.url==='string'?res.url:'',steerable:res.steerable!==false,visibility:res.visibility||''};
  updateRemoteUi(a);
  toast('Remote control is on for '+esc(a.name)+'.').classList.add('ok');
  remoteLinkDialog(a);
}
async function remoteOff(a){
  if(!a||!a.remote||remoteBusy||!bridge.setRemote)return;
  remoteBusy=true; let res;
  try{res=await bridge.setRemote(a.id,false);}catch(e){res={ok:false,error:String(e&&e.message||e)};}finally{remoteBusy=false;}
  if(!res||!res.ok){toast('Could not stop remote control: '+esc(res&&res.error||'unknown error'),6000).classList.add('err');return;}
  a.remote=null; updateRemoteUi(a);
  toast('Remote control is off for '+esc(a.name)+'.').classList.add('ok');
}
/* FR-006: the link as text (never HTML), Copy link and Open (main opens its own stored link, on that service's host only, FR-060) */
async function remoteLinkDialog(a){
  const rm=a&&a.remote; if(!rm)return;
  const lines=[];
  const S=svc(a);
  if(rm.url){lines.push(rm.url);lines.push('Open this link in '+S.mobile+' to steer from your phone.');}
  else lines.push('Remote control is on, but '+S.name+' did not give a link. Find the session on '+S.host+'.');
  if(!rm.steerable)lines.push(S.name+' can show this session but cannot steer it yet.');
  const vt=remoteVisText(rm.visibility); if(vt)lines.push(vt);
  const r=await askDialog({title:'Remote control is on',body:'Follow and steer '+a.name+' from '+S.host+' or '+S.mobile+'. Stop it any time from More > Stop remote control.',lines,
    buttons:[...(rm.url?[{label:'Copy link',value:'copy'},{label:'Open on '+S.name,value:'open',cls:'primary'}]:[]),{label:'Done',value:null}],returnFocus:()=>$('remoteChip')||remoteBack()});
  if(!r)return;
  if(r.value==='copy'){try{await navigator.clipboard.writeText(rm.url);toast('Link copied.').classList.add('ok');}catch(e){toast('Could not copy.').classList.add('err');}}
  else if(r.value==='open'&&bridge.openRemote){const o=await bridge.openRemote(a.id).catch(()=>({ok:false}));if(!o||!o.ok)toast('Could not open the link.').classList.add('err');}
}
const canHandoff=a=>!!(bridge.handoff&&a&&a.live&&!a.parent&&feat(a,'handoff'));
/* spec 030 FR-042 (#409): continue this conversation in another agent app; only when one is ready (otherwise hidden, no clutter) */
const handoverTargets=a=>DMK().handoverTargets(KINDS,(liveRoot(a).info||{}).adapterId);
const canHandover=a=>!!(canHandoff(a)&&bridge.newSession&&handoverTargets(a).length);
function handoverPalItems(){
  const a=ui.selected?byId(ui.selected):null; if(!a||!canHandover(a))return [];
  return [{label:'Continue in another app…',hint:a.name,kw:'handover hand off continue other agent app claude codex copilot summary move',run:()=>newSession(a,{summary:true,handover:true})}];
}
function newSession(a0,o){
  const a=liveRoot(a0); if(!bridge.newSession)return; o=o||{};
  closeSessDlg();
  const d=document.createElement('div');d.id='sessDlg';d.className='dlg-ov';
  const ho=!!o.handover&&canHandover(a); /* spec 030 FR-042: the "Continue in another app" preset of this dialog */
  d.innerHTML=`<div class="dlg m" role="dialog" aria-modal="true" aria-labelledby="sdT"><h3 id="sdT">${ho?'Continue in another agent app':'New session in '+esc(roomOf(a).name)}</h3>
   <p class="dsub">${ho?'A new session in <code>'+esc(roomOf(a).path)+'</code>, in the agent app you pick, starting from a summary of this conversation (you review it first). '+esc(a.name)+' keeps its history.':'Another agent with its own chat in <code>'+esc(roomOf(a).path)+'</code>.'}</p>
   ${DMK().showsKindPicker(KINDS)?`<label>Agent app<select id="sdKind">${kindOptions()}</select></label>`:''}
   <label>Permissions<select id="sdPerm"><option value="read-only">Read-only</option><option value="ask">Ask first</option><option value="allow">Allow all (no prompts)</option></select></label>
   <label id="sdModelL">Model<select id="sdModel"></select></label>
   <label id="sdEffL">Reasoning effort<select id="sdEff"></select></label>
   ${bridge.listProfiles&&a.info&&a.info.profiles?`<div id="sdAgentL" class="sd-agent" hidden><label>Profile<select id="sdAgent"><option value="">Default</option></select></label>${bridge.setFolderDefaultAgent?'<label class="chk"><input type="checkbox" id="sdAgentDef"> Default for new sessions here</label>':''}</div>`:''}
   ${canHandoff(a)?`<label class="chk" id="sdSumL"><input type="checkbox" id="sdSum"${o.summary?' checked':''}> Start with a summary of this conversation (you review it before it is sent)</label>`:''}
   ${bridge.setCap?'<label id="sdCapL"><span id="sdCapT">Spending limit</span><input id="sdCap" type="number" min="0.001" step="0.01" placeholder="No limit" aria-describedby="sdCapH"></label><small class="dhint" id="sdCapH">In AI credits. Empty means no limit.</small>':''}
   <div class="dbtn"><button class="btn" id="sdCancel" type="button">Cancel</button><button class="btn primary" id="sdGo" type="button">Start session</button></div></div>`;
  document.body.appendChild(d);
  $('sdPerm').value=a.info.permMode||'read-only';
  let capUsd=null; /* the unit the cap field shows; the AIU default is never put in a dollar field (FR-150) */
  /* the chosen kind decides which fields exist: its own model list (spec 012 FR-120; none yet = hidden, FR-062); no credit cap field without the capability (FR-061) */
  const kindNow=()=>$('sdKind')?$('sdKind').value:'';
  const listKind=()=>{const k=kindNow()||a.info.adapterId||'';return isDefaultKind(k)?'':k;};
  let filled=null;
  const eff=()=>{
    const k=kindNow(),c=k?kindCaps(k):null,lk=listKind();
    if(lk&&!MODELS_BY[lk]){ensureModels(lk).then(()=>{if($('sessDlg')&&listKind()===lk)eff();});}
    if(filled!==lk){fillModelSelect($('sdModel'),(a.info.adapterId||'')===(k||a.info.adapterId||'')?a.info.model:undefined,lk);filled=lk;}
    $('sdModelL').hidden=(!!lk&&!modelsFor(lk).length)||(c&&!DMK().shows(c,'models'));
    const off=c&&!DMK().shows(c,'effort');
    fillEffortSelect($('sdEff'),$('sdModel').value,a.info.effort,off||$('sdModelL').hidden,lk);$('sdEffL').hidden=$('sdEff').hidden;
    if($('sdCapL')){
      $('sdCapL').hidden=!!c&&!DMK().shows(c,'cap');$('sdCapH').hidden=$('sdCapL').hidden;
      const cc=c||capsFor(a),usd=!!cc&&cc.capUnit==='usd';
      if(usd!==capUsd){capUsd=usd;$('sdCapH').textContent=usd?'Claude\'s estimate, in dollars. Empty means no limit.':'In AI credits. Empty means no limit.';$('sdCap').min=usd?String(MIN_USD_CAP):'0.001';$('sdCap').value=usd?'':(APP_SETTINGS.defaultMaxAiCredits||'');}
    }
    if(c)fillPermSelect($('sdPerm'),c);
  };
  if($('sdKind'))$('sdKind').value=pickKind(ho?handoverTargets(a)[0].id:(a.info.adapterId||defaultKind()));
  kindSelTitle($('sdKind'),'Agent app for this session'); /* spec 051 FR-013 */
  eff(); $('sdModel').onchange=eff; if($('sdKind'))$('sdKind').onchange=()=>{eff();agentRow();kindSelTitle($('sdKind'),'Agent app for this session');};
  /* spec 043 T010: the new session can start with a custom agent of this folder (the same list as the Agent chip; same kind only) */
  const agentRow=()=>{const l=$('sdAgentL');if(!l)return;l.hidden=!(l.dataset.ready==='1'&&(kindNow()||a.info.adapterId||'')===(a.info.adapterId||kindNow()||''));};
  if($('sdAgentL'))bridge.listProfiles(a.id).then(r=>{
    if(!$('sessDlg')||!r||!r.ok||!r.profiles.length)return;
    a.profileList=r.profiles;
    $('sdAgent').insertAdjacentHTML('beforeend',r.profiles.map(p=>`<option value="${esc(p.id)}">${esc(p.name)}${SOURCE_WORD[p.source]?' ('+esc(SOURCE_WORD[p.source])+')':''}</option>`).join(''));
    /* spec 043 FR-009: the folder's default agent is preselected while it is still in the list */
    const def=a.info.defaultAgent;
    if(def&&r.profiles.some(p=>p.id===def)){$('sdAgent').value=def;if($('sdAgentDef'))$('sdAgentDef').checked=true;}
    if($('sdAgentDef'))$('sdAgent').onchange=()=>{$('sdAgentDef').checked=!!$('sdAgent').value&&$('sdAgent').value===a.info.defaultAgent;};
    $('sdAgentL').dataset.ready='1';agentRow();
  }).catch(()=>undefined);
  d.addEventListener('click',e=>{if(e.target===d)closeSessDlg();});
  $('sdCancel').onclick=closeSessDlg;
  $('sdGo').onclick=async()=>{
    if($('sdPerm').value==='allow'&&!(await confirmAllow(roomOf(a).name)))return;
    const kind=kindNow();
    if($('sdKind')&&(!kind||(DMK().kindChoices(KINDS).find(k=>k.id===kind)||{disabled:true}).disabled)){notReadyToast(DMK().kindChoices(KINDS).find(k=>k.id===kind));return;}
    const opts={permMode:$('sdPerm').value,model:$('sdModelL').hidden?undefined:$('sdModel').value,effort:$('sdEff').hidden?undefined:($('sdEff').value||undefined)};
    if(kind)opts.adapterId=kind;
    if($('sdCap')&&!$('sdCapL').hidden){const cv=parseFloat($('sdCap').value);opts.maxAiCredits=capUsd?(cv>=MIN_USD_CAP&&cv<=1e4?Math.round(cv*100)/100:null):(cv>=MIN_CAP&&cv<=1e6?Math.round(cv*100)/100:null);}
    const profId=$('sdAgentL')&&!$('sdAgentL').hidden?$('sdAgent').value:'';
    if($('sdAgentDef')&&!$('sdAgentL').hidden){
      const want=$('sdAgentDef').checked&&profId?profId:(profId===a.info.defaultAgent?null:undefined);
      if(want!==undefined&&want!==(a.info.defaultAgent||null))bridge.setFolderDefaultAgent(a.id,want).then(dr=>{if(dr&&dr.ok)for(const x of agents)if(x.room===a.room&&x.info)x.info.defaultAgent=dr.defaultAgent;}).catch(()=>undefined);
    }
    let first='';
    if($('sdSum')&&$('sdSum').checked){
      /* spec 030 FR-036: make the summary, let the user edit it; nothing is sent until Start */
      $('sdGo').disabled=true;$('sdGo').textContent='Preparing a summary…';
      const h=await bridge.handoff(a.id).catch(e=>({ok:false,error:String(e&&e.message||e)}));
      if(!$('sessDlg'))return; /* cancelled meanwhile */
      closeSessDlg();
      const text=h&&h.ok?String(h.summary||'').trim():'';
      if(!text){
        const why=h&&h.ok?'The agent returned an empty summary.':'Could not make a summary: '+((h&&h.error)||'unknown error');
        const go=await askDialog({title:'No summary',body:why,lines:['You can still start a new session without it.'],buttons:[{label:'Cancel',value:null},{label:'Start without a summary',value:'ok',cls:'primary'}]});
        if(!go)return;
      }else{
        /* spec 030 FR-043: a summary that moves to another app says where it came from (editable, like the rest) */
        const src=a.info.adapterId||'copilot', to=kind||src;
        const body=to!==src?DMK().provenanceLine(kindWord(src),a.name)+'\n\n'+text:text;
        first=await reviewHandoff(a,body,h.costUsd,to!==src?kindWord(to):'');
        if(first===null)return;
      }
    }
    if($('sdGo')){$('sdGo').disabled=true;$('sdGo').textContent='Starting…';}
    const r=await bridge.newSession(a.id,opts);
    closeSessDlg();
    if(!r.ok){toast('Could not start a session: '+esc(r.error||'unknown error'),6000);return;}
    addLiveAgent(r.agent); openPanel(r.agent.id,false);
    if(profId){const na=liveById(r.agent.id),p=(a.profileList||[]).find(x=>x.id===profId);if(na&&p){na.profileList=a.profileList;applyProfile(na,p);}}
    if(first){const keep=attached;attached=[];await sendLive(first,r.agent.id);attached=keep;renderAttached();}
  };
  $('sdGo').focus();
}

/* spec 030 FR-036: the hand-off summary in an editable box; resolves to the edited text, or null (Cancel). User text: never logged. */
function reviewHandoff(a,text,costUsd,toApp){
  return new Promise(resolve=>{
    const d=document.createElement('div');d.id='hoDlg';d.className='dlg-ov';
    const cost=costUsd>0?' (about $'+(costUsd<0.01?costUsd.toFixed(4):costUsd.toFixed(2))+', Claude\'s estimate)':'';
    d.innerHTML=`<div class="dlg l ho-dlg" role="dialog" aria-modal="true" aria-labelledby="hoT"><h3 id="hoT">Summary for the new session</h3>
     <p class="dsub">This becomes the first message of the new session in ${esc(roomOf(a).name)}${toApp?' ('+esc(toApp)+')':''}. Edit it as you like; nothing is sent until you press Start. Making it used the model of ${esc(a.name)}${esc(cost)}; this session keeps its history.</p>
     <textarea id="hoText" rows="14" aria-label="Summary for the new session"></textarea>
     <div class="dbtn"><button class="btn" id="hoCancel" type="button">Cancel</button><button class="btn primary" id="hoGo" type="button">${toApp?'Start in '+esc(toApp):'Start new session'}</button></div></div>`;
    document.body.appendChild(d);
    const ta=$('hoText');ta.value=text;
    const done=v=>{d.remove();resolve(v);};
    $('hoCancel').onclick=()=>done(null);
    $('hoGo').onclick=()=>{const v=ta.value.trim();if(!v){ta.focus();return;}done(v);};
    d.addEventListener('keydown',e=>{if(e.key==='Escape'){e.stopPropagation();done(null);}});
    ta.focus();ta.setSelectionRange(0,0);ta.scrollTop=0;
  });
}

/* ---------------- folders: new session, hide / show, remove ---------------- */
function toggleFolders(on){
  const pop=$('foldersPop'),btn=$('foldersBtn');
  const show=on===undefined?pop.hidden:on;
  pop.hidden=!show; btn.setAttribute('aria-expanded',String(show));
  if(show){
    renderFolders();
    const r=btn.getBoundingClientRect();
    pop.style.top=Math.round(r.bottom+6)+'px';
    pop.style.right='auto';
    pop.style.left=Math.round(Math.max(14,Math.min(r.left,innerWidth-pop.offsetWidth-14)))+'px';
  }
}
/* ---------------- scheduled prompts (spec 044): per folder, while the app is open ---------------- */
let SCHED={pausedAll:false,schedules:[]};
const folderKeyOf=r=>{const ag=agents.find(x=>!x.parent&&x.room===r.id);const i=ag&&ag.info;return i?(i.workspaceFile||i.cwd):r.path;};
const schedulesOf=r=>SCHED.schedules.filter(s=>s.folder===folderKeyOf(r));
const clock=ms=>{const d=new Date(ms),n=new Date(),t=d.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});return d.toDateString()===n.toDateString()?t:d.toLocaleDateString([],{month:'short',day:'numeric'})+' '+t;};
const recurringS=s=>s.every!==undefined||!!s.rule;
const nextRunOf=ss=>{const t=ss.filter(s=>!s.paused&&!s.done).map(s=>recurringS(s)?s.next:s.at).filter(Boolean).sort((a,b)=>a-b)[0];return t&&!SCHED.pausedAll?clock(t):'';};
const OUTCOME_WORD={sent:'sent','skipped-busy':'skipped: the agent was busy','skipped-paused':'skipped: paused','skipped-cap':'not sent: reached its limit','skipped-ended':'not sent: the session has ended',missed:'missed: the app was closed',failed:'could not send',held:'held: the door is closed (Do not disturb)','skipped-door-full':'not kept: the closed door already holds as many prompts as it can'};
const DAY3=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
/* spec 044 FR-012: "every day at 08:30", "weekdays at 09:00", "weekly on Mon, Thu at 17:00" (Monday first) */
const ruleText=r=>r.kind==='weekdays'?'weekdays at '+r.time:r.kind==='weekly'?'weekly on '+[...(r.days||[])].sort((a,b)=>((a+6)%7)-((b+6)%7)).map(d=>DAY3[d]).join(', ')+' at '+r.time:'every day at '+r.time;
/* FR-015: the unit a limit is kept in for this agent (its app's cap unit), or '' when the app reports no spending in a unit */
const schedCapUnit=a=>{const c=a&&a.info?capsFor(a):null;if(!c||!c.usage)return '';const u=c.capUnit==='usd'?'usd':'aiu';return (u==='usd'?c.usage.costUsd:c.usage.nanoAiu)?u:'';};
const capAmt=(n,u)=>u==='usd'?'$'+(Number(n)||0).toFixed(2):(Math.round((Number(n)||0)*100)/100)+' AIU';
/* one schedule's line under its prompt: when, target, state, spend, next and last run (escaped by the caller) */
function schedLine(s){
  const st=s.done?' · done':s.paused?(s.pausedReason==='session-ended'?' · Paused: the session has ended':s.pausedReason==='cap'?' · Paused: reached its limit':' · paused'):(recurringS(s)&&s.next&&!SCHED.pausedAll?' · next '+clock(s.next):'');
  return whenOf(s)+(s.target?' · → '+((t=>t?SN().shortName(t.name,40):null)(agents.find(x=>x.id===s.target.session&&x.live))||s.target.name||'one session'):'')+st
    +(s.cap?' · spent '+capAmt(s.spent||0,s.cap.unit)+' of '+capAmt(s.cap.amount,s.cap.unit)+(s.spentUnknown?' (the spend was not fully reported)':''):'')
    +(s.last?' · last '+clock(s.last.at)+': '+(OUTCOME_WORD[s.last.outcome]||s.last.outcome):'');
}
/* the row's buttons; `k` is the data attribute (sc in the dialog, ss in Settings). An ended session cannot be resumed, only moved to the folder's agent (FR-014). */
const schedBtns=(s,k)=>`<button class="btn" type="button" data-${k}="edit" data-id="${esc(s.id)}">Edit…</button>`+(s.done?'':s.paused&&s.pausedReason==='session-ended'?`<button class="btn" type="button" data-${k}="retarget" data-id="${esc(s.id)}" title="Send it to this folder's agent from now on, and resume it">Use the folder's agent</button>`
  :`<button class="btn" type="button" data-${k}="pause" data-id="${esc(s.id)}"${s.pausedReason==='cap'?' title="Resume starts counting its spending again from zero"':''}>${s.paused?'Resume':'Pause'}</button>`)
  +`<button class="btn danger" type="button" data-${k}="del" data-id="${esc(s.id)}">Delete</button>`;
/* spec 044 FR-025: the prompt is one line cut to 90 characters; it is a button that shows the whole prompt under the row (aria-expanded) and folds it again; its tooltip is at most 300 characters (spec 052 FR-168) */
const SCHED_OPEN=new Set();
const promptToggle=(key,prompt)=>{const open=SCHED_OPEN.has(key);return `<button class="sc-p" type="button" data-pkey="${esc(key)}" aria-expanded="${open}" title="${esc(DurbarCutText.cutText(prompt,300))}">${esc(DurbarCutText.cutText(prompt,90))}</button><p class="sc-full"${open?'':' hidden'}>${esc(prompt)}</p>`;};
document.addEventListener('click',e=>{
  const b=e.target.closest&&e.target.closest('.sc-p');if(!b)return;
  const k=b.dataset.pkey,open=!SCHED_OPEN.has(k);
  if(open)SCHED_OPEN.add(k);else SCHED_OPEN.delete(k);
  b.setAttribute('aria-expanded',String(open));const f=b.nextElementSibling;if(f)f.hidden=!open;
});
const schedRow=(s,k)=>`<div class="sc-row${s.paused||s.done?' off':''}" data-id="${esc(s.id)}"><div class="sc-t">${promptToggle('s:'+s.id,s.prompt)}<small>${esc(schedLine(s))}</small></div>${schedBtns(s,k)}</div>`;
/* pause/resume/retarget/delete from a row (dialog or Settings) */
async function schedAct(act,s){
  if(act==='del')await bridge.removeSchedule(s.id);
  else{const r=await bridge.saveSchedule(act==='retarget'?Object.assign({},s,{target:null,paused:false}):Object.assign({},s,{paused:!s.paused}));if(r&&!r.ok)toast(esc(r.error||'Could not change the schedule.'),5000);}
  await refreshSchedules();
}
/* spec 044 FR-016: prompts scheduled inside the agent app's own session (Copilot /every, /after, manage_schedule), read-only */
function onAgentSchedule(a,e){
  const m=a.agentScheds||(a.agentScheds=new Map());const id=String(e.scheduleId);
  if(e.phase==='created')m.set(id,{prompt:e.prompt||'',everyMs:e.everyMs,cron:e.cron,tz:e.tz,at:e.at,recurring:e.recurring,selfPaced:e.selfPaced,origin:e.origin});
  else if(e.phase==='cancelled')m.delete(id);
  else if(e.phase==='rearmed'&&m.has(id))m.get(id).nextAt=e.nextAt;
  renderSchedDlg();
}
const ownWhen=x=>x.selfPaced?'when the agent decides'+(x.nextAt?', next '+clock(x.nextAt):''):x.cron?'cron '+x.cron+(x.tz?' ('+x.tz+')':''):x.everyMs?'every '+Math.max(1,Math.round(x.everyMs/60000))+' min':x.at?'once at '+clock(x.at):'scheduled';
const hm=ms=>{const d=new Date(ms);return String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');};
const whenOf=s=>s.rule?ruleText(s.rule):s.every!==undefined&&s.at!==undefined?(s.every===1440?'every day at '+hm(s.at):'every '+(s.every%60===0?(s.every/60)+' h':s.every+' min')+' from '+hm(s.at)) /* spec 044 FR-007 */
  :s.every!==undefined?(s.every%60===0?'every '+(s.every/60)+' h':'every '+s.every+' min'):'once at '+clock(s.at);
function renderSchedDlg(){
  const d=$('schedDlg'); if(!d)return; const r=ROOMS.find(x=>x.id===d.dataset.room); if(!r){closeSchedDlg();return;}
  const ss=schedulesOf(r), list=$('sdList');
  list.innerHTML=ss.length?ss.map(s=>schedRow(s,'sc')).join(''):'<p class="sc-empty">No schedules for this folder yet.</p>';
  $('sdPausedNote').hidden=!SCHED.pausedAll;
  /* FR-016: the agent app's own schedules of this folder's live sessions, read-only */
  const own=agents.filter(x=>x.live&&!x.parent&&x.room===r.id&&x.agentScheds&&x.agentScheds.size).flatMap(x=>[...x.agentScheds.entries()].map(([id,v])=>({x,v,id})));
  const ow=$('sdOwn');if(ow){ow.hidden=!own.length;ow.innerHTML=own.length?'<h4>Scheduled in the agent app (read-only)</h4><p class="sc-tpl-note">Made with the app\'s own commands or by the agent. Agent Durbar shows them but cannot change them; ask the agent, or use the app\'s own schedule manager.</p>'
    +own.map(({x,v,id})=>`<div class="sc-row off"><div class="sc-t">${v.prompt?promptToggle('o:'+x.id+':'+id,v.prompt):'<b>(no prompt text)</b>'}<small>${esc(ownWhen(v)+' · '+(x.name)+(v.origin==='model'?' · made by the agent':v.origin==='user'?' · made by you':''))}</small></div></div>`).join(''):'';}
}
function closeSchedDlg(){const d=$('schedDlg');if(d)d.remove();}
/* `from`: the chat it was opened from (FR-014: then it can send to that session instead of the folder's agent) */
function openSchedules(r,from,opts){
  closeSchedDlg();toggleFolders(false);
  const ag=from&&from.live&&!from.parent&&from.info&&from.room===r.id?from:null;
  const folderAg=agents.find(x=>!x.parent&&x.room===r.id&&x.live)||null;
  const d=document.createElement('div');d.id='schedDlg';d.className='dlg-ov';d.dataset.room=r.id;
  const today=new Date().getDay();
  const unitWord=u=>u==='usd'?'dollars (estimate)':u==='aiu'?'AI credits':'';
  const soon=new Date(Date.now()+60*60000);soon.setSeconds(0,0);const pad=n=>String(n).padStart(2,'0');
  const local=`${soon.getFullYear()}-${pad(soon.getMonth()+1)}-${pad(soon.getDate())}T${pad(soon.getHours())}:${pad(soon.getMinutes())}`;
  d.innerHTML=`<div class="dlg m sched-dlg" role="dialog" aria-modal="true" aria-labelledby="sdhT"><h3 id="sdhT">Schedules for ${esc(r.name)}</h3>
   <p class="dsub">A prompt sent to this folder's agent at a time or an interval, <b>only while Agent Durbar is open</b>. A run is skipped when the agent is busy or waiting for you; missed runs are not caught up. The agent's own permission mode and spending limit apply.</p>
   <p class="sc-paused" id="sdPausedNote" hidden>All schedules are paused (Folders panel).</p>
   <div class="sc-list" id="sdList"></div>
   <div class="sc-own" id="sdOwn" hidden></div>
   <div class="sc-form"><h4 id="scFormT" hidden>Edit schedule</h4>${window.DurbarSchedTemplates?`<label id="scTplL">Start from a template<select id="scTpl"><option value="">Blank prompt</option>${DurbarSchedTemplates.TEMPLATES.map(t=>`<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('')}</select></label><p class="sc-tpl-note" id="scTplNote" hidden></p>`:''}<label>Prompt<textarea id="scPrompt" rows="3" maxlength="2000" placeholder="For example: Summarise the open pull requests in three bullet points."></textarea></label>
    <div class="sc-when"><label class="chk"><input type="radio" name="scKind" value="every" checked> Every <input type="number" id="scEvery" min="5" max="1440" step="5" value="60" aria-label="Minutes between runs"> minutes</label>
    <label class="chk"><input type="radio" name="scKind" value="daily"> <select id="scCal" aria-label="Which days"><option value="daily">Every day</option><option value="weekdays">Weekdays (Mon–Fri)</option><option value="weekly">Weekly on</option></select> at <input type="time" id="scDaily" value="08:30" aria-label="Time of day"></label>
    <label class="chk"><input type="radio" name="scKind" value="once"> Once at <input type="datetime-local" id="scAt" value="${local}" aria-label="Date and time"></label></div>
    <div class="sc-days" id="scDays" role="group" aria-label="Days of the week" hidden>${[1,2,3,4,5,6,0].map(n=>`<label class="chk"><input type="checkbox" value="${n}"${n===today?' checked':''}> ${DAY3[n]}</label>`).join('')}</div>
    <div class="sc-opts"><label class="sc-to" id="scToL"${ag?'':' hidden'}><span class="sc-lbl">Send to</span> <select id="scTarget" aria-describedby="scToHint"><option value="">This folder's agent</option><option value="${ag?esc(ag.id):''}">This session</option></select></label>
     <label id="scCapL" title="Optional. When this schedule's own runs have spent this much, it pauses and says so."${schedCapUnit(folderAg)?'':' hidden'}><span class="sc-lbl">Limit</span> <input type="number" id="scCap" min="0.01" step="0.01" placeholder="none" aria-describedby="scCapU"> <span id="scCapU">${esc(unitWord(schedCapUnit(folderAg)))}</span></label></div><p class="sc-hint" id="scToHint" title="${ag?esc(ag.name):''}" hidden>${ag?esc(ag.name):''}</p></div><p class="sc-tpl-note" id="scCapKeep" hidden></p>
   <div class="dbtn"><button class="btn" id="scClose" type="button">Close</button><button class="btn" id="scCancel" type="button" hidden>Cancel</button><button class="btn primary" id="scAdd" type="button">Add schedule</button></div></div>`;
  document.body.appendChild(d);
  renderSchedDlg();
  const toLocal=ms=>{const x=new Date(ms);return `${x.getFullYear()}-${pad(x.getMonth()+1)}-${pad(x.getDate())}T${pad(x.getHours())}:${pad(x.getMinutes())}`;};
  /* what "This session" means: the chat the dialog came from, or (editing) the schedule's own session; `live` is its agent when it still exists */
  let tgt=ag?{id:ag.id,agent:ag.info.adapterId||'copilot',name:ag.name,live:ag}:null;
  let editing=null; /* spec 044 FR-022: the schedule the form edits (main's copy when Edit… was pressed), or null when it adds one */
  const applyTgt=()=>{
    $('scToL').hidden=!tgt;
    const sel=$('scTarget');sel.options[1].value=tgt?tgt.id:'';
    $('scToHint').textContent=tgt?tgt.name:'';$('scToHint').title=tgt?tgt.name:'';
    $('scToHint').hidden=!sel.value;
  };
  let capUnitNow=schedCapUnit(folderAg); /* a number typed for one unit is never carried to another (5 dollars must not become 5 AI credits) */
  const syncCap=()=>{const sel=$('scTarget'),u=schedCapUnit(sel.value&&tgt?tgt.live||folderAg:folderAg);if(u!==capUnitNow&&$('scCap'))$('scCap').value='';capUnitNow=u;$('scCapL').hidden=!u;$('scCapU').textContent=unitWord(u);const keep=$('scCapKeep'),gone=!!editing&&!!editing.cap&&!u,same=!editing||(editing.target?editing.target.session:'')===(sel.value||'');keep.hidden=!gone;
    keep.textContent=same?'The limit this schedule has is kept: this agent app does not report what a run costs, so it cannot be changed here.':'This agent app does not report what a run costs, so the limit will be removed.';};
  const setKind=k=>{d.querySelector(`input[name="scKind"][value="${k}"]`).checked=true;};
  const showDays=()=>{$('scDays').hidden=$('scCal').value!=='weekly';};
  /* the form back to a blank new schedule */
  const blankForm=()=>{
    $('scPrompt').value='';setKind('every');$('scEvery').value='60';$('scCal').value='daily';$('scDaily').value='08:30';$('scAt').value=local;
    d.querySelectorAll('#scDays input').forEach(x=>{x.checked=Number(x.value)===today;});showDays();
    tgt=ag?{id:ag.id,agent:ag.info.adapterId||'copilot',name:ag.name,live:ag}:null;applyTgt();$('scTarget').value='';$('scToHint').hidden=true;
    if($('scCap'))$('scCap').value='';if($('scTpl')){$('scTpl').value='';$('scTplNote').hidden=true;}syncCap();
  };
  const setMode=on=>{
    $('scFormT').hidden=!on;$('scCancel').hidden=!on;$('scAdd').textContent=on?'Save':'Add schedule';
    if($('scTplL'))$('scTplL').hidden=on;if($('scTplNote'))$('scTplNote').hidden=true; /* owner Q3: no template picker while editing */
  };
  const stopEdit=()=>{editing=null;blankForm();setMode(false);};
  /* FR-022: Edit… fills the form from the schedule */
  const startEdit=s=>{
    editing=s;blankForm();setMode(true);
    $('scPrompt').value=s.prompt;
    if(s.rule){setKind('daily');$('scCal').value=s.rule.kind;$('scDaily').value=s.rule.time;d.querySelectorAll('#scDays input').forEach(x=>{x.checked=(s.rule.days||[]).includes(Number(x.value));});showDays();}
    else if(s.every!==undefined){setKind('every');$('scEvery').value=String(s.every);}
    else{setKind('once');$('scAt').value=toLocal(s.at);}
    if(s.target){const a=agents.find(x=>x.id===s.target.session&&x.live&&x.info);tgt={id:s.target.session,agent:s.target.agent,name:a?a.name:(s.target.name||'one session'),live:a||null};}
    applyTgt();$('scTarget').value=s.target?s.target.session:'';$('scToHint').hidden=!$('scTarget').value;syncCap();
    if(s.cap&&$('scCap')&&!$('scCapL').hidden)$('scCap').value=String(s.cap.amount);
    $('scFormT').scrollIntoView({block:'nearest'});$('scPrompt').focus();
  };
  /* one builder for Add and Save (FR-023: main checks it again); null after telling the user what is missing */
  const buildInput=()=>{
    const prompt=$('scPrompt').value.trim();if(!prompt){$('scPrompt').focus();toast('Write the prompt first.',3000);return null;}
    const kind=d.querySelector('input[name="scKind"]:checked').value;
    const input={folder:editing?editing.folder:folderKeyOf(r),prompt};
    if(editing){input.id=editing.id;input.edit=true;}
    if(kind==='daily'){ /* spec 044 FR-012: a calendar rule; main computes the next run from the local wall clock */
      const time=$('scDaily').value;if(!/^\d\d:\d\d$/.test(time)){toast('Choose a time of day.',3500);return null;}
      const cal=$('scCal').value,rule={kind:cal,time};
      if(cal==='weekly'){rule.days=[...d.querySelectorAll('#scDays input:checked')].map(x=>Number(x.value));if(!rule.days.length){toast('Choose at least one day.',3500);return null;}}
      input.rule=rule;
    }
    else if(kind==='once'){
      let t=new Date($('scAt').value).getTime();
      if(editing&&!editing.done&&editing.at!==undefined&&$('scAt').value===toLocal(editing.at))t=editing.at; /* an unchanged time stays as it is */
      if(!(t>Date.now())&&!(editing&&!editing.done&&t===editing.at)){toast(editing&&editing.done?'Pick a time in the future to run it again.':'Choose a time in the future.',3500);return null;}
      input.at=t;
    }
    else{const m=Math.round(Number($('scEvery').value));if(!(m>=5&&m<=1440)){toast('Choose 5 to 1440 minutes.',3500);return null;}input.every=m;if(editing&&editing.every===m&&editing.at!==undefined)input.at=editing.at; /* FR-007: an anchored interval keeps its first time */}
    const tsel=$('scTarget'),tag=tsel&&tsel.value&&tgt?tgt:null; /* FR-014 */
    if(tag)input.target={session:tag.id,agent:tag.agent,name:SN().shortName(tag.name||'',40)};
    else if(editing)input.target=null;
    const capV=$('scCap')&&!$('scCapL').hidden?String($('scCap').value).trim():''; /* FR-015 */
    if(capV){const n=Number(capV),u=schedCapUnit(tag?tag.live||folderAg:folderAg);if(!(n>0)||!u){toast('A limit must be a positive amount.',3500);return null;}input.cap={amount:n,unit:u};}
    else if(editing&&(!$('scCapL').hidden||(editing.cap&&!$('scCapKeep').hidden&&(editing.target?editing.target.session:'')!==($('scTarget').value||''))))input.cap=null; /* an empty field removes the limit; a hidden one keeps it, unless Send to moved to an app with no unit (then main would refuse it) */
    return input;
  };
  d.addEventListener('click',async e=>{
    if(e.target===d){closeSchedDlg();return;}
    const b=e.target.closest('button');if(!b)return;
    if(b.id==='scClose'){closeSchedDlg();return;}
    if(b.id==='scCancel'){stopEdit();return;}
    if(b.id==='scAdd'){
      const input=buildInput();if(!input)return;
      const was=editing;
      const res=await bridge.saveSchedule(input);
      if(!res.ok){toast(esc(res.error||(was?'Could not save the schedule.':'Could not add the schedule.')),5000);if(was&&res.error==='That schedule is gone.'){stopEdit();await refreshSchedules();}return;}
      if(was)stopEdit();else{$('scPrompt').value='';if($('scCap'))$('scCap').value='';}await refreshSchedules();toast((was?'Schedule saved: ':'Schedule added: ')+esc(whenOf(res.schedule))+'.',3000);return;
    }
    const s=SCHED.schedules.find(x=>x.id===b.dataset.id);if(!s||!b.dataset.sc)return;
    if(b.dataset.sc==='edit'){startEdit(s);return;}
    await schedAct(b.dataset.sc,s);
  });
  /* the calendar choice: weekly shows the days; touching any of it picks "On a calendar" */
  const calKind=()=>{setKind('daily');};
  $('scCal').addEventListener('change',()=>{calKind();showDays();});
  $('scDaily').addEventListener('input',calKind);
  $('scDays').addEventListener('change',calKind);
  $('scTarget').addEventListener('change',()=>{$('scToHint').hidden=!$('scTarget').value;syncCap();});
  applyTgt();
  if(opts&&opts.edit){const s=SCHED.schedules.find(x=>x.id===opts.edit);if(s)startEdit(s);}
  d.addEventListener('keydown',e=>{if(e.key==='Escape'){e.stopPropagation();closeSchedDlg();}});
  /* spec 044 FR-006: a template fills the form (prompt and when); nothing is saved until Add schedule */
  const tpl=$('scTpl');if(tpl)tpl.addEventListener('change',()=>{
    const t=DurbarSchedTemplates.byId(tpl.value),note=$('scTplNote');
    if(!t){note.hidden=true;return;}
    $('scPrompt').value=t.prompt;
    if(t.daily){d.querySelector('input[name="scKind"][value="daily"]').checked=true;$('scCal').value='daily';showDays();$('scDaily').value=t.daily;}
    else if(t.every){d.querySelector('input[name="scKind"][value="every"]').checked=true;$('scEvery').value=String(t.every);}
    note.textContent=t.needs+(t.decides?' At the end it asks you what to do next: the agent shows as Waiting, with a question card in its chat.':'')+' You can edit the prompt and the time before adding it.';note.hidden=false;
  });
  if(!editing)(tpl||$('scPrompt')).focus();
}
async function refreshSchedules(){if(!bridge.listSchedules)return;SCHED=await bridge.listSchedules();schedChanged();}
/* everything that shows schedules: the Folders panel, the open dialog, room chips (office render), Settings (spec 044 FR-009..FR-011) */
function schedChanged(){renderFolders();renderSchedDlg();renderSchedSettings();scheduleRender();if(ui.selected&&$('schedHdrBtn'))updatePanelHeader();}
document.addEventListener('change',async e=>{if(e.target&&e.target.id==='schedPauseAll'){const r=await bridge.setSchedulesPaused(e.target.checked);SCHED.pausedAll=r.pausedAll;schedChanged();}});
if(bridge&&bridge.onSchedules){bridge.onSchedules(doc=>{SCHED=doc;schedChanged();});}
/* spec 044 FR-011: Settings > Schedules, every folder's schedules in one list; pause, resume, delete, add (opens that folder's dialog), Pause all */
function renderSchedSettings(){
  const host=$('schedSet');if(!host||!bridge.listSchedules)return;
  const rooms=ROOMS.filter(r=>agents.some(a=>!a.parent&&a.room===r.id));
  const groups=rooms.map(r=>({r,ss:schedulesOf(r)})).filter(g=>g.ss.length);
  const without=rooms.filter(r=>!schedulesOf(r).length);
  host.innerHTML=`<label class="fp-pause"><input type="checkbox" id="schedPauseAllSet"${SCHED.pausedAll?' checked':''}> Pause all schedules</label>`
    +(groups.length?groups.map(({r,ss})=>`<div class="ss-group"><div class="ss-head"><b>${esc(r.name)}</b><small>${esc(r.path)}</small><button class="btn" type="button" data-ss="open" data-room="${esc(r.id)}" title="See this folder's schedules and add one">Schedules for this folder…</button></div>`
      +ss.map(s=>schedRow(s,'ss')).join('')+'</div>').join('')
      :'<p class="scr-note small">No schedules yet.</p>')
    +(without.length?`<div class="scr-tools"><label class="ss-add">Add a schedule to<select id="ssRoom">${without.map(r=>`<option value="${esc(r.id)}">${esc(r.name)}</option>`).join('')}</select></label><button class="btn" type="button" data-ss="add">Add…</button></div>`:'');
}
document.addEventListener('click',async e=>{
  const b=e.target.closest('#schedSet [data-ss]');if(!b)return;
  const act=b.dataset.ss;
  if(act==='open'){const r=ROOMS.find(x=>x.id===b.dataset.room);if(r)openSchedules(r);return;}
  if(act==='add'){const r=ROOMS.find(x=>x.id===$('ssRoom').value);if(r)openSchedules(r);return;}
  const s=SCHED.schedules.find(x=>x.id===b.dataset.id);if(!s)return;
  if(act==='edit'){const r=ROOMS.find(x=>folderKeyOf(x)===s.folder);if(r)openSchedules(r,null,{edit:s.id});else toast('That folder is not in the office.',3500);return;}
  await schedAct(act,s);
});
document.addEventListener('change',async e=>{if(e.target&&e.target.id==='schedPauseAllSet'){const r=await bridge.setSchedulesPaused(e.target.checked);SCHED.pausedAll=r.pausedAll;schedChanged();}});
/* spec 012 FR-158: a new sign-in reconnected the agent app, so remote control ended for this session */
if(bridge&&bridge.onRemoteUrl)bridge.onRemoteUrl(p=>{const a=p&&liveById(p.id);if(a&&a.remote&&typeof p.url==='string')a.remote.url=p.url;});
/* spec 065: after a turn that changed files, one muted line with "Undo these changes…"; the dialog previews, then restores */
const CKPT=window.DurbarCheckpoints||null;
function checkpointNote(a,n){
  if(!CKPT||!a)return;
  const text=CKPT.noteText(n);if(!text)return;
  const chat=liveChat(a);
  const note=addNote(chat,esc(text));note.classList.add('ckpt-note');note.dataset.turn=String(n.turn);
  if(!(n.files||[]).length||!bridge.checkpointPreview)return;
  const row=document.createElement('div');row.className='note-actions';
  const b=document.createElement('button');b.type='button';b.className='btn';b.textContent=CKPT.button(n);b.dataset.act='ckptUndo';
  b.onclick=()=>undoCheckpoint(a,n.turn,b);
  row.appendChild(b);note.appendChild(row);
}
async function undoCheckpoint(a,turn,btn){
  const p=await bridge.checkpointPreview(a.id,turn).catch(e=>({ok:false,error:String(e&&e.message||e)}));
  if(!p||!p.ok){toast(esc((p&&p.error)||'Could not read these changes.')).classList.add('err');return;}
  if(p.conflicts.length){
    await askDialog({title:'These changes cannot be undone now',body:'These files changed after that turn, so nothing will be restored (your newer changes are kept):',lines:p.conflicts,buttons:[{label:'OK',value:null,cls:'primary'}],returnFocus:()=>btn});
    return;
  }
  const r=await askDialog({title:'Undo these changes?',body:'These files will be put back as they were before the turn. A copy of them as they are now is kept, so you can undo this again.',lines:CKPT.previewLines(p),
    buttons:[{label:'Cancel',value:null},{label:CKPT.confirmLabel(p),value:'undo',cls:'primary warn'}],returnFocus:()=>btn});
  if(!r||r.value!=='undo')return;
  const u=await bridge.checkpointUndo(a.id,turn).catch(e=>({ok:false,error:String(e&&e.message||e)}));
  if(!u||!u.ok){
    if(u&&u.conflicts&&u.conflicts.length)await askDialog({title:'Nothing was restored',body:(u.error||'')+' Changed files:',lines:u.conflicts,buttons:[{label:'OK',value:null,cls:'primary'}],returnFocus:()=>btn});
    else toast(esc((u&&u.error)||'Could not restore the files.')).classList.add('err');
    return;
  }
  btn.disabled=true;btn.textContent='Undone';
  checkpointNote(a,Object.assign({id:a.id},u.undo));
}
if(bridge&&bridge.onCheckpoint)bridge.onCheckpoint(n=>{const a=n&&liveById(n.id);if(a)checkpointNote(a,n);});
/* spec 017 FR-015..FR-017: doors the user closed, from main; a change redraws the desks (same sizes, so no new layout) */
const setDoors=d=>{const o={};if(d&&typeof d==='object')for(const [k,v] of Object.entries(d))if(v&&typeof v==='object')o[k]={closed:v.closed===true,held:Number.isInteger(v.held)&&v.held>0?v.held:0};DOORS=o;scheduleRender();};
if(bridge&&bridge.doorsList){bridge.doorsList().then(setDoors).catch(()=>{});if(bridge.onDoorsChanged)bridge.onDoorsChanged(setDoors);}
/* review on #631: why Send all stopped (the runs stay held), and a run a full door could not keep: never silent */
const STOP_WHY={'paused-all':'schedules are paused (Pause all)',paused:'its schedule is paused',cap:"its schedule reached its own limit",ended:'its session has ended',failed:'it could not be sent'};
if(bridge&&bridge.onDoorsStopped)bridge.onDoorsStopped(p=>{const a=p&&byId(p.id);if(!a)return;const t=esc(a.name)+': Send all stopped because '+esc(STOP_WHY[p.why]||'it could not go now')+'. The rest stay held; use the door button to send or discard them.';toast(t,6000).classList.add('err');addNote(liveChat(a),t);});
if(bridge&&bridge.onDoorsFull)bridge.onDoorsFull(p=>{const a=p&&byId(p.id);if(!a)return;const t='A scheduled prompt for '+esc(a.name)+' was not kept: its closed door already holds as many prompts as it can. Open the door to send or discard them.';toast(t,6000).classList.add('err');addNote(liveChat(a),t);});
if(bridge&&bridge.onRemoteOff){bridge.onRemoteOff(p=>{const id=typeof p==='string'?p:p&&p.id;const a=liveById(id);if(!a||!a.remote)return;a.remote=null;updateRemoteUi(a);
  /* spec 054 FR-062: the adapter's own reason when it has one; otherwise the sign-in reconnect (spec 012 FR-158) */
  const why=p&&typeof p==='object'&&typeof p.reason==='string'&&p.reason?esc(p.reason.slice(0,300)):esc(a.name)+' reconnected after the new sign-in';
  addNote(liveChat(a),'Remote control ended: '+why+'. Turn it on again from More if you still need it.');});}
if(bridge&&bridge.onScheduleRan){bridge.onScheduleRan(r=>{const a=liveById(r.agentId);if(!a)return;flyLetter(a.id); /* spec 001 FR-038 */addNote(liveChat(a),'Scheduled prompt ('+esc(r.rule?ruleText(r.rule):r.every!==undefined?whenOf({every:r.every}):'once')+').');});}
function renderFolders(){
  const pop=$('foldersPop'); if(pop.hidden)return;
  if(!ROOMS.length){pop.innerHTML='<p class="fp-empty">No folders yet. Use + Folder (top left) to add a folder, or + Workspace for a VS Code .code-workspace file. Folders you add are remembered next time.</p>';return;}
  const sched=bridge.listSchedules?`<label class="fp-pause" title="Nothing scheduled is sent while this is on (kept across restarts)"><input type="checkbox" id="schedPauseAll"${SCHED.pausedAll?' checked':''}> Pause all schedules</label>`:'';
  pop.innerHTML='<div class="fp-h">Folders <small>remembered across restarts</small>'+sched+'</div>'+ROOMS.map(r=>{
    const n=agents.filter(x=>!x.parent&&x.room===r.id).length, ss=schedulesOf(r).filter(s=>!s.done), nx=nextRunOf(ss);
    return `<div class="fp-row${r.hidden?' hid':''}"><div class="fp-t"><b title="${esc(r.name)}">${esc(r.name)}${r.hidden?' <span class="tag">hidden</span>':''}</b><small title="${esc(r.path)}">${esc(r.path)} · ${n} agent${n===1?'':'s'}${nx?' · ⏰ next '+esc(nx):''}</small></div>
     ${bridge.listSchedules?`<button class="btn" type="button" data-fp="sched" data-room="${esc(r.id)}" title="Prompts sent to ${esc(r.name)} at a time or an interval, while the app is open">Schedules${ss.length?' ('+ss.length+')':''}</button>`:''}<button class="btn" type="button" data-fp="new" data-room="${esc(r.id)}">New session</button><button class="btn" type="button" data-fp="rename" data-room="${esc(r.id)}" title="Give ${esc(r.name)} a display name">Rename</button><button class="btn" type="button" data-fp="hide" data-room="${esc(r.id)}">${r.hidden?'Show':'Hide'}</button><button class="btn danger" type="button" data-fp="rm" data-room="${esc(r.id)}">Remove</button></div>`;}).join('');
}
async function hideFolder(r,hidden){
  const ag=agents.find(x=>x.room===r.id); if(!ag)return;
  if(hidden&&ui.selected&&roomOf(byId(ui.selected)||ag)===r)closePanel();
  r.hidden=hidden; if(bridge.setFolderHidden)await bridge.setFolderHidden(liveRoot(ag).id,hidden);
  if(hidden&&ui.ws===r.id)ui.ws='all';
  renderFilter(); renderFolders(); scheduleRender();
  toast(esc(r.name)+(hidden?' hidden. Its sessions keep running; show it from Manage folders.':' is shown again.'),3600);
}
async function removeFolder(r){
  const ags=agents.filter(x=>x.room===r.id), busy=ags.filter(x=>['working','thinking','waiting'].includes(x.state)).length;
  const msg=busy?`${esc(r.name)} has ${busy} agent${busy===1?'':'s'} still working. Remove the folder and end ${busy===1?'it':'them'}?`:`Remove ${esc(r.name)}? Its sessions end here; your earlier ${esc(kindWord(((ags.find(x=>!x.parent)||{}).info||{}).adapterId))} sessions stay on disk and can be resumed if you add the folder again.`;
  if(!window.confirm(unesc(msg)))return;
  const root=ags.find(x=>!x.parent); const res=root&&bridge.removeFolder?await bridge.removeFolder(root.id):{ok:true,removedIds:[]};
  if(!res.ok){toast('Could not remove the folder.',4000).classList.add('err');return;}
  if(ui.selected&&(byId(ui.selected)||{}).room===r.id)closePanel();
  const gone=new Set(ags.map(x=>x.id));
  for(let i=agents.length-1;i>=0;i--){if(gone.has(agents[i].id)||gone.has(agents[i].parent)){DRAFTS.delete(agents[i].id);delete chats[agents[i].id];delete prev[agents[i].id];agents.splice(i,1);}}
  const ri=ROOMS.indexOf(r); if(ri>=0)ROOMS.splice(ri,1);
  if(ui.ws===r.id)ui.ws='all';
  renderFilter(); renderFolders(); scheduleRender(); toast(esc(r.name)+' removed.',3200).classList.add('ok');
}
/* spec 006 FR-018: a display name for the room; empty goes back to the folder's own name */
async function renameFolder(r,el){
  const ag=agents.find(x=>!x.parent&&x.room===r.id); if(!ag||!bridge.renameFolder)return;
  const own=r.folderName||r.name;
  const res=await askDialog({title:'Rename '+r.name,body:'A display name for this folder in the office, 1 to 40 characters. Leave it empty to use the folder name ('+own+'). The folder on disk is not renamed.',input:{label:'Name',value:r.name,max:40,focus:true},returnFocus:el,
    buttons:[{label:'Cancel',value:null},{label:'Rename',value:'ok',cls:'primary'}]});
  if(!res||typeof res.text!=='string')return;
  const out=await bridge.renameFolder(liveRoot(ag).id,res.text);
  if(!out||!out.ok){toast('Could not rename the folder.',4000);return;}
  r.name=out.label||own;
  renderFilter(); renderFolders(); scheduleRender(); if(ui.selected&&roomOf(byId(ui.selected)||{})===r)openPanel(ui.selected,false);
}
/* spec 006 FR-017: one main session out of the office; the last one of a folder stays (Folders > Remove) */
function siblingsOf(a){const r=liveRoot(a);return agents.filter(x=>!x.parent&&x.room===r.room&&x.id!==r.id);}
async function removeSessionUi(a){
  const r=liveRoot(a); if(!bridge.removeSession||!siblingsOf(r).length)return;
  const busy=['working','thinking','waiting'].includes(r.state);
  const ok=await askDialog({title:'Remove '+r.name+' from the office?',body:(busy?r.name+' is still '+(r.state==='waiting'?'waiting for you':'working')+'. ':'')+'The session ends and its card leaves the office. Its history stays on disk and is listed under Previous sessions.',returnFocus:$('moreBtn')||$('rmSessBtn'),
    buttons:[{label:'Cancel',value:null},{label:'Remove from office',value:'ok',cls:'primary danger'}]});
  if(!ok)return;
  const out=await bridge.removeSession(r.id).catch(e=>({ok:false,error:String(e&&e.message||e)}));
  if(!out.ok){toast('Could not remove: '+esc(out.error||'unknown error'),5000).classList.add('err');return;}
  const name=r.name; removeLiveAgent(r.id); renderFolders(); scheduleRender(); toast(esc(name)+' removed. Its history is under Previous sessions.',3600).classList.add('ok');
}
function removeLiveAgent(id){
  STATS.forget(id); MOOD.forget(id);
  if(LIVEACT){LIVEACT.drop(id);clearTimeout(liveTimers.get(id));liveTimers.delete(id);} /* spec 001 FR-028 */
  VISITS.leave(id); dropWalker(id); BREAKS.end(id); /* spec 068: a removed agent's break is forgotten */
  for(let i=agents.length-1;i>=0;i--)if(agents[i].id===id||agents[i].parent===id){DRAFTS.delete(agents[i].id);delete chats[agents[i].id];delete prev[agents[i].id];agents.splice(i,1);}
  if(ui.selected&&!byId(ui.selected))closePanel();
}

/* ---------------- previous sessions (Copilot, resumable) + VS Code chat history (read-only) ---------------- */
const prev={}; let vsViewing=false;
const when=ms=>{if(!ms)return '';const d=new Date(ms),n=new Date(),t=d.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
  return d.toDateString()===n.toDateString()?'Today '+t:d.toLocaleDateString([],{month:'short',day:'numeric',year:d.getFullYear()===n.getFullYear()?undefined:'numeric'})+' '+t;};
/* spec 052 FR-002: Previous sessions open by themselves only for an empty chat (no message sent here, nothing resumed, nothing on screen) */
const pristine=a=>!a.sent&&!a.resumed&&!((chats[a.id]||{}).el&&chats[a.id].el.querySelector(':scope > :not(.note)'));
const prevOf=a=>prev[a.id]||(prev[a.id]={open:false,touched:false,cli:null,vs:null,q:'',showHidden:false});
/* spec 006 FR-024..FR-026: pins and hides come with each list as arrays of ids; every count the user sees leaves hidden rows out (FR-025) */
const prevMarks=(g,st)=>{const r=g==='vs'?st.vs:st.cli;return {pinned:(r&&r.pinned)||[],hidden:(r&&r.hidden)||[]};};
function prevCounts(st){const S=window.DurbarSessionSearch,c=st.cli,v=st.vs,mc=prevMarks('cli',st),mv=prevMarks('vs',st);
  const lc=c&&c.ok?c.sessions:[],lv=v&&v.ok?v.sessions:[],nc=S.visibleCount(lc,mc.hidden),nv=S.visibleCount(lv,mv.hidden);
  return {nc,nv,hid:lc.length-nc+lv.length-nv};}
/* the app's name and its CLI in the delete confirmation (FR-030) */
const DEL_WORDS={copilot:{app:'GitHub Copilot',cli:'Copilot CLI'},codex:{app:'Codex',cli:'Codex CLI'}};
const prevSrc=(a,g)=>g==='vs'?'vscode':((liveRoot(a).info||{}).adapterId||'copilot');
async function loadPrev(a){
  const st=prevOf(a); st.loading=true;
  const safe=(f,empty)=>f?f(a.id).catch(e=>Object.assign({ok:false,error:String(e&&e.message||e)},empty)):null;
  const [c,v]=await Promise.all([safe(feat(a,'history')?bridge.listPrevious:null,{sessions:[]}),safe(bridge.listVsChats,{sessions:[],storesFound:0,unreadable:0,tooLarge:0,formatNote:''})]);
  st.cli=namePrev(c); st.vs=v; st.loading=false;
  const vis=prevCounts(st);
  if(!st.touched&&pristine(a)&&(vis.nc||vis.nv))st.open=true; /* spec 006 FR-025: hidden rows do not open the panel by themselves */
  if(ui.selected===a.id)renderPrev(a);
  /* spec 006 FR-036: Ctrl+Shift+H pressed while the lists loaded: open now, or say there are none only now that it is known */
  if(st.wantOpen){st.wantOpen=false;if(ui.selected===a.id&&!vsViewing){if(prevShows(st))setPrevOpen(a,true,true);else toast(SIMPLE?'No earlier chats in this folder.':'No previous sessions in this folder.',2600);}}
  return st;
}
/* spec 059 FR-009: a row with the user's name shows it as its title (its tooltip and the search too); the runtime title is kept apart and not searched */
function namePrev(c){
  if(!c||!c.ok||!c.names||!Array.isArray(c.sessions))return c;
  c.sessions=c.sessions.map(x=>c.names[x.id]?Object.assign({},x,{runtime:x.runtime!==undefined?x.runtime:x.title,title:c.names[x.id],named:true}):x);
  return c;
}
/* Rename… for a Previous sessions row (FR-006): the row's ⋯ menu (spec 006 FR-027) calls this with the row's id. */
async function renamePrevRow(a0,id,opener){
  const a=liveRoot(a0), st=prevOf(a), row=st.cli&&st.cli.sessions&&st.cli.sessions.find(x=>x.id===id); if(!row)return;
  await renameSessionUi(a,{id,title:row.title,name:row.named?row.title:'',runtime:row.runtime!==undefined?row.runtime:row.title},{opener,onDone:out=>{
    if(out.name){row.runtime=row.runtime!==undefined?row.runtime:row.title;row.title=out.name;row.named=true;}
    else{row.title=row.runtime!==undefined?row.runtime:row.title;row.named=false;}
    if(ui.selected===a.id){renderPrev(a);const r=[...document.querySelectorAll('.prev-row')].find(x=>x.dataset.pk===id),f=r&&r.querySelector('.prev-more');if(f)f.focus();}
  }});
}
/* spec 006 FR-035: open or closed is one display preference of this computer (localStorage, like the detail level; no session data) */
const PREV_PREF='durbar.prevOpen';
function prevPref(){try{const v=localStorage.getItem(PREV_PREF);return v==='open'?true:v==='closed'?false:null;}catch(e){return null;}}
function setPrevPref(open){try{localStorage.setItem(PREV_PREF,open?'open':'closed');}catch(e){}}
function initPrev(a){
  const box=$('prev'); if(!box)return;
  if((!bridge.listPrevious||!feat(a,'history'))&&!bridge.listVsChats){box.hidden=true;return;}
  const st=prevOf(a), p=prevPref();
  if(p!==null){st.open=p;st.touched=true;} /* a saved choice wins over the FR-002 auto-open */
  st.wantOpen=false; /* FR-036 (review on PR 497): a Ctrl+Shift+H pressed before leaving this chat is dropped, not fulfilled when an old load comes back */
  vsViewing=false; st.showHidden=false; renderPrev(a); loadPrev(a); /* Show hidden is per panel, not saved */
}
/* FR-036: Ctrl+Shift+H (⇧⌘H) opens or closes the section; focus goes to the search (or the first row) when it opens, back to the toggle when it closes */
function setPrevOpen(ra,open,byKey){
  const st=prevOf(ra); st.open=open; st.touched=true; setPrevPref(open); renderPrev(ra);
  const btn=$('prevBtn');
  if(byKey){const f=open?($('prevQ')||document.querySelector('#prevLists .prev-row .btn')):null;(f||btn)&&(f||btn).focus();}
  if(byKey&&open)announce(SIMPLE?'Earlier chats shown.':'Previous sessions shown.'); /* a click already says it through aria-expanded; closing returns focus to the toggle, which says it */
}
function togglePrevByKey(){
  const a=byId(ui.selected); if(!a||a.parent||vsViewing||!a.live)return;
  const ra=liveRoot(a), box=$('prev'), btn=$('prevBtn');
  if(!box||!btn||box.hidden){
    const st=prevOf(ra);
    if(st.loading&&!prevShows(st)){st.wantOpen=true;toast(SIMPLE?'Looking for earlier chats…':'Looking for previous sessions…',2600);return;} /* FR-034: never "none" before the lists are back */
    toast(SIMPLE?'No earlier chats in this folder.':'No previous sessions in this folder.',2600);return;}
  setPrevOpen(ra,!prevOf(ra).open,true);
}
/* the two groups of Previous sessions, pinned first, hidden ones out unless shown, filtered by the title query (spec 006 FR-023..FR-027) */
const PIN_SVG='<svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true" focusable="false"><path d="M9.5 1.5l5 5-2 .5-2.5 2.5.5 3.5-1 1L6.5 10 3 13.5l-.5-.5L6 9.5 2.5 6l1-1 3.5.5L9.5 3z" fill="currentColor"/></svg>';
function prevRow(x,g,k,title,sub,main,info,a){
  title=safeMask(title)||'Session'; /* spec 041 FR-065: a session title is agent text */
  const hid=info.hidden, mark=(info.pinned?`<span class="prev-pin" title="Pinned">${PIN_SVG}<span class="sr-only">Pinned</span></span>`:'')+(hid?'<span class="tag prev-hidtag">Hidden</span>':'');
  return `<div class="prev-row${hid?' is-hidden':''}" data-pg="${g}" data-pk="${esc(k)}"><div class="prev-tx"><b title="${esc(title)}">${mark}<span class="prev-t">${esc(title)}</span></b><small>${sub}</small></div>${main}<button class="btn sm prev-more" type="button" data-pv="more" aria-haspopup="menu" aria-label="Actions for ${esc(title)}" title="${g==='cli'?'Pin, rename, hide or delete':'Pin, hide or delete'}">⋯</button></div>`;
}
function prevListsHtml(a){
  const st=prevOf(a), c=st.cli, v=st.vs, kw=kindWord(a.info&&a.info.adapterId), hasHist=!!c, q=(st.q||'').trim();
  const S=window.DurbarSessionSearch, sh=st.showHidden===true;
  const mc=prevMarks('cli',st), mv=prevMarks('vs',st);
  const ac=c&&c.ok?S.arrangeSessions(c.sessions,{pinned:mc.pinned,hidden:mc.hidden,showHidden:sh,query:q,timeKey:'modifiedTime'}):{rows:[],hiddenCount:0,total:0};
  const av=v&&v.ok?S.arrangeSessions(v.sessions,{pinned:mv.pinned,hidden:mv.hidden,showHidden:sh,query:q,timeKey:'updated'}):{rows:[],hiddenCount:0,total:0};
  const cnt=(n,m)=>q&&m?` <span class="prev-n">${n} of ${m}</span>`:'';
  const none='<p class="prev-empty prev-nomatch">No sessions match</p>';
  let h='';
  if(hasHist){h+='<div class="prev-h">'+esc(kw)+' sessions in this folder'+cnt(ac.rows.length,ac.total)+' <small>Resume continues the same session; earlier messages are shown here.</small></div>';
    if(!c.ok)h+=`<p class="prev-empty">Could not list sessions${c.error?': '+esc(c.error):''}.</p>`;
    else if(!c.sessions.length)h+='<p class="prev-empty">No earlier '+esc(kw)+' sessions for this folder.</p>';
    else if(!ac.total)h+='<p class="prev-empty">All earlier '+esc(kw)+' sessions here are hidden.</p>';
    else if(!ac.rows.length)h+=none;
    else h+=ac.rows.map(r=>{const x=r.item;return prevRow(x,'cli',x.id,x.title,esc(when(x.modifiedTime))+(x.branch?' · '+esc(x.branch):''),`<button class="btn" type="button" data-pv="resume" data-sid="${esc(x.id)}">Resume</button>`,r,a);}).join('');}
  h+='<div class="prev-h">VS Code chat history <span class="tag">read-only</span>'+cnt(av.rows.length,av.total)+' <small>A copy of what VS Code saved. It cannot be continued here.</small></div>';
  if(!v||!v.ok)h+=`<p class="prev-empty">Could not read VS Code chats${v&&v.error?': '+esc(v.error):''}.</p>`;
  else if(!v.sessions.length)h+='<p class="prev-empty">'+(v.storesFound?'No chats in the VS Code storage for this folder.':'No VS Code chats found for this folder (VS Code never opened it, or it is stored somewhere this app does not read).')+'</p>';
  else if(!av.total)h+='<p class="prev-empty">All VS Code chats here are hidden.</p>';
  else if(!av.rows.length)h+=none;
  else h+=av.rows.map(r=>{const x=r.item;return prevRow(x,'vs',x.key,x.title,`${esc(when(x.updated))} · ${x.requests} message${x.requests===1?'':'s'}`,`<button class="btn" type="button" data-pv="view" data-key="${esc(x.key)}">View</button>`,r,a);}).join('');
  if(v&&(v.unreadable||v.tooLarge))h+=`<p class="prev-fine">${v.unreadable?v.unreadable+' chat file(s) could not be read. ':''}${v.tooLarge?v.tooLarge+' file(s) skipped for size.':''}</p>`;
  if(v&&v.formatNote)h+=`<p class="prev-fine">${esc(v.formatNote)}</p>`;
  const nh=ac.hiddenCount+av.hiddenCount;
  if(nh>0)h+=`<div class="prev-showhid"><button class="btn sm" type="button" data-pv="showhidden" aria-pressed="${sh}">${sh?'Hide the hidden ones':'Show hidden ('+nh+')'}</button></div>`;
  return h;
}
/* the section's toggle row (spec 006 FR-033): chevron, label, the count of rows that show and a breakdown with "K hidden" (FR-025) */
function prevButton(a){
  const btn=$('prevBtn'); if(!btn)return;
  const st=prevOf(a), kw=kindWord(a.info&&a.info.adapterId), word=SIMPLE?'Earlier chats':'Previous sessions';
  const lab=btn.querySelector('.prev-l'), cnt=btn.querySelector('.prev-c'), sub=btn.querySelector('.prev-sub');
  if(lab)lab.textContent=word; const box=$('prev'); if(box)box.setAttribute('aria-label',word);
  let what='';
  if(st.cli||st.vs){const n=prevCounts(st);
    if(cnt){cnt.hidden=false;cnt.textContent=String(n.nc+n.nv);}
    what=[st.cli?n.nc+' '+kw:'',st.vs?n.nv+' VS Code chat'+(n.nv===1?'':'s'):'',n.hid?n.hid+' hidden':''].filter(Boolean).join(' · ');}
  else{if(cnt)cnt.hidden=true;what='Looking…';}
  if(sub)sub.textContent=what;
  btn.title=word+': '+what+'. '+(st.open?'Hide':'Show')+' ('+PREV_KEY+')';
  btn.setAttribute('aria-expanded',String(!!st.open));
}
/* FR-034: the section shows once its lists are back and hold a row (shown or hidden) or an error to read; never empty, never while loading */
function prevShows(st){
  const c=st.cli, v=st.vs; if(!c&&!v)return false;
  if((c&&!c.ok)||(v&&!v.ok))return true;
  return !!((c&&c.sessions&&c.sessions.length)||(v&&v.sessions&&v.sessions.length));
}
function renderPrev(a){
  const box=$('prev'), panel=$('prevPanel'); if(!box||!panel||a.parent)return;
  const st=prevOf(a), c=st.cli, v=st.vs;
  /* spec 006 FR-033: a section of its own above the chat; its toggle row stays, the lists under it show only while it is open */
  prevButton(a);
  if(!prevShows(st)){box.hidden=true;box.classList.remove('open');panel.hidden=true;panel.innerHTML='';return;}
  const nc=c&&c.ok?c.sessions.length:0, nv=v&&v.ok?v.sessions.length:0; /* the search box counts every row, hidden or not */
  const keepScroll=(panel.querySelector('.prev-body')||{}).scrollTop||0;
  const qf=document.activeElement&&document.activeElement.id==='prevQ'?document.activeElement:null, qSel=qf?[qf.selectionStart,qf.selectionEnd]:null; /* a re-render (a list coming back) keeps focus in the search */
  let h='';
  if(st.open){
    h+='<div class="prev-body">';
    /* spec 006 FR-023: a title search when there are at least 2 entries; the query lives in this panel only and is never sent anywhere */
    if(nc+nv>=2)h+=`<input class="prev-q" id="prevQ" type="search" aria-label="Search sessions" placeholder="Search sessions" autocomplete="off" spellcheck="false" value="${esc(st.q)}">`;
    else st.q='';
    h+='<div class="prev-lists" id="prevLists">'+prevListsHtml(a)+'</div>';
    h+='</div>';
  }
  box.hidden=false; box.classList.toggle('open',!!st.open); panel.hidden=!st.open; panel.innerHTML=h;
  if(qf){const nq=$('prevQ');if(nq){nq.focus();try{nq.setSelectionRange(qSel[0],qSel[1]);}catch(e){}}}
  const nb=panel.querySelector('.prev-body'); if(nb){nb.scrollTop=keepScroll;
    /* spec 052 (2026-10-21, round 1): a cut last row read like text over the chat; fade it while more rows are below */
    const more=()=>nb.classList.toggle('more-below',nb.scrollTop+nb.clientHeight<nb.scrollHeight-2);
    more();nb.addEventListener('scroll',more,{passive:true});}
}
/* spec 006 FR-021: a folder restored after a restart continues its last session when its chat is first opened (no prompt is sent) */
async function wakeLast(a){
  if(a.waking)return; a.waking=true;
  setState(a,'working','Starting','Continuing your last session…');
  const r=await bridge.wake(a.id).catch(e=>({ok:false,error:String(e&&e.message||e)}));
  a.waking=false;
  if(!r||!r.ok){setState(a,'idle','Not started','Your last session here. It continues when you open it.');toast('Could not continue the last session: '+esc((r&&r.error)||'unknown error'),7000);return;}
  if(a.info){a.info.resumeLast=false;a.info.lazy=false;}
  if(r.resumed){a.resumed=true;replayHistory(a,r.history,r.title,'Continued after restart');setState(a,'idle',null,'Continued: '+SHORT(safeMask(r.title)||'last session',90));}
  else{if(r.resumed===false)addNote(liveChat(a),'The last session is no longer available; this is a new session.');setState(a,'idle',null,'Ready. Send a message to start.');}
  modeBackNote(a);
}
function replayHistory(a,h,title,lead){
  const chat=liveChat(a); let m=null;
  if(h&&h.truncated)addNote(chat,'Showing the last '+h.items.length+' of '+h.total+' items; earlier ones are not shown.');
  const agentMsg=()=>{if(!m){m=document.createElement('div');m.className='msg agent';m.innerHTML='<div class="meta">'+esc(a.name)+'</div>';chat.el.appendChild(m);}return m;};
  const chipBox=()=>{const mm=agentMsg();let l=mm.lastElementChild;if(!l||!l.classList.contains('chips')){l=document.createElement('div');l.className='chips';l.setAttribute('aria-label','Tool calls');mm.appendChild(l);}return l;};
  for(const it of ((h&&h.items)||[])){
    if(it.type==='user'){m=null;addUserMsg(chat,it.text,(it.attachments||[]).map(x=>({name:x.name,img:x.kind==='image'})),it.ts);}
    else if(it.type==='output'){const b=document.createElement('div');b.className='bubble';agentMsg().appendChild(b);mdSet(b,it.text,true);}
    else{const full=it.output||'';addChip(chipBox(),makeChip({tool:it.tool,label:it.label,res:SHORT(full||(it.failed?'failed':'ok'),60),output:full,state:it.failed?'failed':'ok'}));}
  }
  addNote(chat,(lead||'Resumed')+': '+esc((title||'earlier session').replace(/[.!?…]+$/,''))+'. New messages continue this session.');
}
async function resumePrev(a,sid,btn){
  const done=busy(btn,'Resuming…'); /* spec 052 FR-047: the shared busy state (it was a hand-made one) */
  const r=await bridge.resumeSession(a.id,sid,pristine(a)).catch(e=>({ok:false,error:String(e&&e.message||e)}));
  if(!r.ok){toast('Could not resume: '+esc(r.error||'unknown error'),7000).classList.add('err');done();return;}
  if(r.removedId)removeLiveAgent(r.removedId);
  if(ui.selected&&!byId(ui.selected))closePanel();
  addLiveAgent(r.agent);
  const na=liveById(r.agent.id); if(!na)return;
  na.resumed=true; na.sent=false; replayHistory(na,r.history,r.title);
  modeBackNote(na,r.modeWas);
  setState(na,'idle',null,'Resumed: '+SHORT(safeMask(r.title),90));
  openPanel(na.id,false);
}
function leaveVsView(){
  if(!vsViewing)return; vsViewing=false;
  const a=byId(ui.selected),pi=document.querySelector('#panel .panel-in'); if(pi)pi.classList.remove('viewing');
  if(a){const c=$('chat');c.replaceChildren(liveChat(a).el);c.scrollTop=1e6;}
}
async function viewVs(a,key,btn){
  if(btn){btn.disabled=true;}
  const r=await bridge.readVsChat(a.id,key).catch(e=>({ok:false,error:String(e&&e.message||e)}));
  if(btn)btn.disabled=false;
  if(!r.ok){toast(esc(r.error||'Could not read this chat.'),6000);return;}
  const tr=r.transcript, wrap=document.createElement('div'); wrap.className='vsview';
  wrap.innerHTML=`<div class="vsbar" role="note"><div><b>VS Code chat history · read-only</b><span>A copy of what VS Code saved. It cannot be continued here.</span></div><button class="btn" id="vsCont" type="button" title="Open this chat's folder in VS Code and continue there">Continue in VS Code</button><button class="btn" id="vsBack" type="button">Back to chat</button></div><h3 class="vst">${esc(tr.title)}</h3><div class="vsmeta">${tr.shownRequests} of ${tr.totalRequests} messages</div>${tr.notes.length?'<div class="vsnotes">'+tr.notes.map(n=>'<p>'+esc(n)+'</p>').join('')+'</div>':''}<div class="vsbody chat-inner"></div>`;
  const body=wrap.querySelector('.vsbody'), fake={el:body};
  let am=null;
  for(const b of tr.blocks){
    if(b.type==='user'){am=null;addUserMsg(fake,b.text||'(attachment)',(b.attachments||[]).map(n=>({name:n,img:false})),b.ts);}
    else if(b.type==='assistant'){if(!am){am=document.createElement('div');am.className='msg agent';am.innerHTML='<div class="meta">Copilot (VS Code)</div>';body.appendChild(am);}const d=document.createElement('div');d.className='bubble';am.appendChild(d);mdSet(d,b.text,true);}
    else if(b.type==='tool'){if(!am){am=document.createElement('div');am.className='msg agent';am.innerHTML='<div class="meta">Copilot (VS Code)</div>';body.appendChild(am);}let l=am.lastElementChild;if(!l||!l.classList.contains('chips')){l=document.createElement('div');l.className='chips';am.appendChild(l);}addChip(l,makeChip({tool:'tool',kind:'tool',label:b.label,state:'ok'}));}
    else if(b.type==='note'){const n=document.createElement('div');n.className='note err';n.textContent=b.text;body.appendChild(n);}
  }
  const c=$('chat'); c.replaceChildren(wrap); vsViewing=true;
  document.querySelector('#panel .panel-in').classList.add('viewing');
  $('vsBack').onclick=leaveVsView; $('vsBack').focus({preventScroll:true});
  $('vsCont').onclick=e=>openLive(a,e.currentTarget);
  /* FR-016: open at the latest message; again once layout (fonts) settles, unless the reader already scrolled up */
  const toEnd=(again)=>{if(vsViewing&&c.contains(wrap)&&!(again&&c.scrollTop+c.clientHeight<c.scrollHeight-40))c.scrollTop=c.scrollHeight;};
  toEnd(false); requestAnimationFrame(()=>{toEnd(true);setTimeout(()=>toEnd(true),250);});
}
/* ---- spec 006 FR-024..FR-031: Pin, Hide and Delete on a row of Previous sessions ----
   The window sends ids only (the agent, the source, the session id); main re-checks everything. Delete is offered here and nowhere else:
   not on a desk card, an office List-view row, the card menu or the chat header (Clarifications Q1). */
const prevItem=(st,g,k)=>{const r=g==='vs'?st.vs:st.cli;return r&&r.ok?r.sessions.find(x=>(g==='vs'?x.key:x.id)===k):null;};
function prevRowEl(g,k){return [...document.querySelectorAll('#prevLists .prev-row')].find(r=>r.dataset.pg===g&&r.dataset.pk===k)||null;}
function refreshPrevLists(a){const l=$('prevLists');if(l)l.innerHTML=prevListsHtml(a);prevButton(a);}
/* after Hide or Delete: the next row's ⋯, else the previous row's, else the search box, else the Previous button (FR-027) */
function focusAfterRow(rows,idx){
  const all=[...document.querySelectorAll('#prevLists .prev-row')];
  const keyed=rows.map(r=>all.find(e=>e.dataset.pg===r.g&&e.dataset.pk===r.k)).filter(Boolean);
  const t=keyed[idx]||keyed[idx-1]||null;
  const f=t?t.querySelector('.prev-more'):($('prevQ')||$('prevBtn'));
  if(f&&f.focus)f.focus();
}
function visibleRows(a){const r=[];document.querySelectorAll('#prevLists .prev-row').forEach(e=>r.push({g:e.dataset.pg,k:e.dataset.pk}));return r;}
async function markPrev(a,g,k,mark){
  const st=prevOf(a), res=st[g==='vs'?'vs':'cli'];
  if(!bridge.markPrevious||!res)return false;
  const before=visibleRows(a), at=before.findIndex(r=>r.g===g&&r.k===k);
  const out=await bridge.markPrevious(a.id,prevSrc(a,g),k,mark).catch(e=>({ok:false,error:String(e&&e.message||e)}));
  if(!out||!out.ok){toast('Could not change that: '+esc((out&&out.error)||'unknown error'),5000).classList.add('err');return false;}
  Object.assign(res,window.DurbarSessionSearch.applyMark({pinned:res.pinned,hidden:res.hidden},k,mark));
  refreshPrevLists(a);
  announce(mark==='hide'?'Hidden. Show hidden brings it back.':mark==='pin'?'Pinned to top.':mark==='unpin'?'Unpinned.':'Shown again.');
  if(mark==='hide'&&!st.showHidden){const after=visibleRows(a);focusAfterRow(after,Math.min(at,after.length));}
  else{const e=prevRowEl(g,k);const f=e&&e.querySelector('.prev-more');if(f)f.focus();}
  return true;
}
function openPrevMenu(a,g,k,anchor,x,y){
  closeModeMenu();
  const st=prevOf(a), item=prevItem(st,g,k); if(!item)return;
  const mk=prevMarks(g,st), hid=mk.hidden.includes(k), pinned=mk.pinned.includes(k), title=item.title||'this session';
  const canDel=g!=='vs'&&bridge.deletePrevious;
  const it=(act,label,sub,cls,dis)=>`<button type="button" role="menuitem" data-pact="${act}"${cls?` class="${cls}"`:''}${dis?` aria-disabled="true" title="${esc(dis)}"`:` title="${esc(sub)}"`}><span class="mt"><b>${esc(label)}</b><small>${esc(dis||sub)}</small></span></button>`;
  const m=document.createElement('div');m.id='modeMenu';m.className='mode-menu';m.setAttribute('role','menu');m.setAttribute('aria-label','Actions for '+title);
  m.innerHTML=(hid?'':pinned?it('unpin','Unpin','Back to its place by date'):it('pin','Pin to top','Keep it first in this list'))
    +(g!=='vs'&&bridge.renameSession?it('rename','Rename…','Give this session a short name'):'')
    +(hid?it('unhide','Unhide','Show it in the list again'):it('hide','Hide','Only in Durbar; it stays in VS Code and the CLI'))
    +(canDel?(feat(a,'deleteSession')?it('delete','Delete…','Removes it from the agent app, VS Code and the CLI','mm-danger'):it('delete','Delete…','','mm-danger',window.DurbarSessionSearch.noDeleteReason(kindWord(a.info&&a.info.adapterId)))):'');
  document.body.appendChild(m);
  const b=m.getBoundingClientRect(); m.style.left=Math.max(8,Math.min(x,innerWidth-b.width-8))+'px'; m.style.top=Math.max(8,Math.min(y,innerHeight-b.height-8))+'px';
  const back=()=>{const e=prevRowEl(g,k),f=e&&e.querySelector('.prev-more');if(f)f.focus();else if(anchor.focus&&document.contains(anchor))anchor.focus();};
  m.addEventListener('click',e=>{const t=e.target.closest('[data-pact]');if(!t)return;
    if(t.getAttribute('aria-disabled')==='true'){e.preventDefault();return;}
    closeModeMenu();
    const act=t.dataset.pact;
    if(act==='delete')deletePrev(a,g,k,item);else if(act==='rename')renamePrevRow(a,k,()=>{const e=prevRowEl(g,k);return (e&&e.querySelector('.prev-more'))||anchor;});else markPrev(a,g,k,act);});
  m.addEventListener('keydown',e=>{const its=[...m.querySelectorAll('[data-pact]')],i=its.indexOf(document.activeElement);
    if(e.key==='ArrowDown'){e.preventDefault();its[(i+1)%its.length].focus();}else if(e.key==='ArrowUp'){e.preventDefault();its[(i+its.length-1)%its.length].focus();}
    else if(e.key==='Escape'||e.key==='Tab'){e.preventDefault();e.stopPropagation();closeModeMenu();back();}});
  m.querySelector('button').focus();
}
async function deletePrev(a,g,k,item){
  const st=prevOf(a), root=liveRoot(a), kind=(root.info&&root.info.adapterId)||'copilot', w=DEL_WORDS[kind]||{app:kindWord(kind),cli:kindWord(kind)+' CLI'};
  const row=prevRowEl(g,k), more=row&&row.querySelector('.prev-more');
  const d=window.DurbarSessionSearch.deleteDialogText({title:item.title,app:w.app,cli:w.cli,codex:kind==='codex'});
  const ok=await askDialog({title:d.title,body:d.body,lines:d.lines,returnFocus:more||$('prevBtn'),buttons:[{label:'Cancel',value:null},{label:'Delete',value:'ok',cls:'primary danger'}]});
  if(!ok)return;
  const before=visibleRows(a), at=before.findIndex(r=>r.g===g&&r.k===k);
  const rowBtns=row?[...row.querySelectorAll('button')]:[]; rowBtns.forEach(b=>{if(b!==more)b.disabled=true;});
  const done=busy(more,'…');
  const out=await bridge.deletePrevious(a.id,k).catch(e=>({ok:false,error:String(e&&e.message||e)}));
  done(); rowBtns.forEach(b=>{b.disabled=false;});
  if(out&&out.ok){
    const res=st.cli; if(res&&res.sessions){res.sessions=res.sessions.filter(x=>x.id!==k);res.pinned=(res.pinned||[]).filter(x=>x!==k);res.hidden=(res.hidden||[]).filter(x=>x!==k);}
    refreshPrevLists(a); toast('Session deleted.',3200).classList.add('ok'); announce('Deleted.');
    const after=visibleRows(a); focusAfterRow(after,Math.min(at,after.length)); return;
  }
  if(out&&out.code==='in-office'){inOfficeDialog(a,out,more);return;}
  toast('Could not delete: '+esc((out&&out.error)||'unknown error'),7000).classList.add('err');
  loadPrev(a); /* the list may be stale (the session is gone, or no longer in this folder) */
}
/* FR-030: Delete was refused because the session still has a card. Durbar never ends, removes or deletes anything by itself here. */
async function inOfficeDialog(a,out,returnTo){
  const card=out.agentId?byId(out.agentId):null, croot=card&&liveRoot(card);
  const canRemove=!!(croot&&bridge.removeSession&&siblingsOf(croot).length);
  const d=window.DurbarSessionSearch.refusalDialogText(canRemove);
  const buttons=[{label:'Cancel',value:null}];
  if(croot)buttons.push({label:'Go to session',value:'go',cls:'primary'});
  if(canRemove)buttons.push({label:'Remove from office',value:'rm'});
  const r=await askDialog({title:d.title,body:d.body,lines:d.lines,returnFocus:returnTo||$('prevBtn'),buttons});
  if(!r||!croot)return;
  if(r.value==='go')openPanel(croot.id,false);
  else if(r.value==='rm')removeSessionUi(croot);
}
document.addEventListener('input',e=>{
  if(!e.target||e.target.id!=='prevQ')return;
  const a=byId(ui.selected); if(!a)return; const ra=liveRoot(a), l=$('prevLists'); if(!l)return;
  prevOf(ra).q=e.target.value; l.innerHTML=prevListsHtml(ra);
});
document.addEventListener('click',e=>{
  const b=e.target.closest('[data-pv]'); if(!b||!(b.closest('#prev')||b.id==='prevBtn'))return;
  const a=byId(ui.selected); if(!a)return; const ra=liveRoot(a);
  if(b.dataset.pv==='toggle'){if(ra.parent)return;setPrevOpen(ra,!prevOf(ra).open,false);}
  else if(b.dataset.pv==='resume')resumePrev(ra,b.dataset.sid,b);
  else if(b.dataset.pv==='view')viewVs(ra,b.dataset.key,b);
  else if(b.dataset.pv==='showhidden'){const st=prevOf(ra);st.showHidden=!st.showHidden;refreshPrevLists(ra);const nb=document.querySelector('#prevLists [data-pv="showhidden"]');if(nb)nb.focus();}
  else if(b.dataset.pv==='more'){const row=b.closest('.prev-row');if(row){const r=b.getBoundingClientRect();openPrevMenu(ra,row.dataset.pg,row.dataset.pk,b,r.left,r.bottom+4);}}
});
/* FR-027: right-click, Shift+F10 or the context-menu key on a row open the same menu as its ⋯ */
document.addEventListener('contextmenu',e=>{
  const row=e.target.closest('#prev .prev-row'); if(!row||!bridge.markPrevious)return;
  const a=byId(ui.selected); if(!a)return; e.preventDefault();
  const more=row.querySelector('.prev-more'); if(more)openPrevMenu(liveRoot(a),row.dataset.pg,row.dataset.pk,more,e.clientX||more.getBoundingClientRect().left,e.clientY||more.getBoundingClientRect().bottom);
});
document.addEventListener('keydown',e=>{
  if(!((e.key==='F10'&&e.shiftKey)||e.key==='ContextMenu'))return;
  const row=e.target.closest&&e.target.closest('#prev .prev-row'); if(!row||!bridge.markPrevious)return;
  const a=byId(ui.selected); if(!a)return; e.preventDefault();
  const more=row.querySelector('.prev-more'),r=more.getBoundingClientRect(); openPrevMenu(liveRoot(a),row.dataset.pg,row.dataset.pk,more,r.left,r.bottom+4);
});
document.addEventListener('click',e=>{
  const fb=e.target.closest('.floors-ui [data-fl]');
  if(fb&&fb.tagName==='BUTTON'){floorAction(fb);return;}
  const fpop=$('floorsPop');
  if(fpop&&!fpop.hidden&&!e.target.closest('#floorsPop')&&!e.target.closest('#floorsBtn')&&!e.target.closest('#modeDlg'))toggleFloors(false);
  const f=e.target.closest('[data-fp]');
  if(f){const r=ROOMS.find(x=>x.id===f.dataset.room);if(!r)return;
    if(f.dataset.fp==='new'){const ag=agents.find(x=>!x.parent&&x.room===r.id);toggleFolders(false);if(ag)newSession(ag);}
    else if(f.dataset.fp==='hide')hideFolder(r,!r.hidden);
    else if(f.dataset.fp==='rm')removeFolder(r);
    else if(f.dataset.fp==='rename')renameFolder(r,f);
    else if(f.dataset.fp==='sched')openSchedules(r);
    return;}
  const pop=$('foldersPop');
  if(!pop.hidden&&!e.target.closest('#foldersPop')&&!e.target.closest('#foldersBtn'))toggleFolders(false);
});

/* After adding a folder: if it already has earlier Copilot sessions or VS Code chats, say so and show them. */
async function announcePrevious(a){
  if(!bridge.listPrevious)return;
  const st=await loadPrev(a); const vis=prevCounts(st), n=vis.nc, v=vis.nv; /* hidden rows are not announced (spec 006 FR-025) */
  if(!n&&!v)return;
  toast('Found '+(n?n+' earlier '+esc(kindWord(a.info&&a.info.adapterId))+' session'+(n===1?'':'s'):'')+(n&&v?' and ':'')+(v?v+' VS Code chat'+(v===1?'':'s'):'')+' for <b>'+esc(roomOf(a).name)+'</b>. Opening them.',4200);
  if(!ui.selected){st.open=true;openPanel(a.id,false);}
}
async function confirmAllow(what){
  const r=await askDialog({title:'Allow all for '+what+'?',body:'Edits, shell commands, web requests and tools will run without asking. Nothing is undone automatically. The choice is saved for this folder and comes back after a restart, marked restored.',buttons:[{label:'Cancel',value:null},{label:'Allow all',value:'ok',cls:'primary warn'}]});
  return !!r;
}
async function addVia(fn){
  if($('permMode').value==='allow'&&!(await confirmAllow('the folder you add next')))return;
  const ef=$('effortSel'),o={floor:intoFloor()};
  if(!$('modelSel').hidden)o.model=$('modelSel').value;
  if(!ef.hidden)o.effort=ef.value||undefined;
  if(!$('kindSel').hidden){
    const ch=DMK().kindChoices(KINDS).find(k=>k.id===$('kindSel').value);
    if(!ch||ch.disabled){notReadyToast(ch);return;}
    o.adapterId=ch.id;
  }else if(KINDS&&$('kindSel').value&&$('kindSel').value!==defaultKind())o.adapterId=$('kindSel').value; /* FR-136: the only ready harness */
  const r=await fn($('permMode').value,o);
  if(r.error)toast('Could not add: '+esc(r.error),6000);
  /* spec 006 FR-016 (issue #170): adding is allowed, but say once what such a folder exposes */
  (r.warnings||[]).forEach(w=>toast('<b>'+esc(w.name)+'</b>: agents in this folder can read everything '+(w.kind==='root'?'on this drive':'under your home folder')+', including SSH keys and saved credentials.',9000));
  r.agents.forEach(addLiveAgent);
  r.agents.forEach(x=>{const ag=liveById(x.id);if(ag)announcePrevious(ag);});
  INTO=null; if(bridge.floorsState)bridge.floorsState().then(applyFloors).catch(()=>{});
}
let pendingOpen=qs.get('open');
if(bridge){
  document.body.classList.add('has-bridge');
  $('demoToggle').onchange=e=>{demoOn=e.target.checked;applyMode();};
  labelDemo();
  wireMenu('topMoreBtn','topMoreMenu');
  wireDefaults();
  $('endAllBtn').hidden=$('endAllSep').hidden=!bridge.end; /* spec 052 FR-090 */
  if($('sendSeveralBtn'))$('sendSeveralBtn').hidden=!bridge.send; /* spec 064 FR-001 */
  $('inboxBtn').onclick=openInbox;
  $('addFolder').onclick=()=>addVia(bridge.addFolder);
  $('addWs').onclick=()=>addVia(bridge.addWorkspaceFile);
  $('foldersBtn').onclick=()=>toggleFolders();
  $('floorsBtn').onclick=()=>toggleFloors();
  document.addEventListener('change',e=>{
    const s=e.target.closest&&e.target.closest('.floors-ui select[data-fl="move"]');if(s)moveRoomToFloor(s.dataset.room,s.value);
    if(e.target&&e.target.classList&&e.target.classList.contains('fl-into-sel')){INTO=e.target.value;renderIntoFloor();renderFloorsPanel();renderFloorsSettings();}});
  document.addEventListener('keydown',e=>{const t=e.target;if(e.key==='Enter'&&t&&t.closest&&t.closest('.floors-ui .fl-new')){e.preventDefault();floorAction(t.closest('.fl-new').querySelector('[data-fl="create"]'));}});
  document.body.classList.toggle('simple',SIMPLE);
  window.DurbarScreens.init({shutters:{get:()=>SHUT_PREF,set:setShutOn,usable:()=>!!SHUT},signs:{get:()=>SIGN_PREF,set:setSignsOn,usable:()=>!!(window.DurbarRoom&&window.DurbarRoom.doorSign)},navKey:{text:navKeyText,textOf:c=>keyText(NAV.comboParts(c)),defText:()=>keyText(NAV.comboParts(NAV.DEFAULT_COMBO)),isDefault:()=>NAV.sameCombo(NAV_KEY,NAV.DEFAULT_COMBO),set:setNavKey,recording:on=>{navRecording=!!on;},fromEvent:e=>NAV.comboFromEvent(e,IS_MAC),clash:c=>NAV.clashOf(c,IS_MAC)},roomName:id=>{const r=ROOMS.find(x=>x.id===id);return r?r.name:String(id||'');},refreshKinds:()=>loadKinds(true),setAccounts,detail:{get:()=>SIMPLE?'simple':'expert',set:setDetail},density:{get:()=>DENSITY,set:setDensity},liveAct:{get:()=>LIVE_PREF,set:setLiveOn,usable:()=>!!LIVEACT},bridge,stats:STATS,esc,toast,announce,floors:{on:()=>floorsLive(),render:()=>renderFloorsSettings()},sched:{on:()=>!!bridge.listSchedules&&!demoOn,render:()=>renderSchedSettings()},onSettings:v=>{APP_SETTINGS=v||{};},onUsageReset,isSerious:()=>SERIOUS,isNotify:()=>NOTIFY,setNotify:on=>{NOTIFY=!!on;},breakResume:()=>BREAK_RESUME,setBreakResume:v=>{BREAK_RESUME=v==='ask'?'ask':'auto';},setSerious:on=>{SERIOUS=!!on;markSerious();scheduleRender();},usageSince:()=>LEDGER.since(),usageOffice:()=>LEDGER.office(),costData,usageError:()=>usageSaveError,
    places:window.DurbarPlaces,customPlaces:()=>CUSTOM,placeMap:()=>PLACE_MAP,placeLabel,setCustomPlaces,placeServers:()=>[...SEEN_SERVERS],setPlaceMap:m=>{PLACE_MAP=(m&&typeof m==='object')?m:{};scheduleRender();},
    applyTheme,
    previewTheme:(m)=>{swapView(()=>{THEME.setTheme(m);SC_CACHE.clear();renderAll();});}, /* spec 040 FR-014: Try it / Discard, nothing saved */
    agents:()=>LIVE.agents.filter(x=>x.live&&!x.parent).map(x=>({id:x.id,name:x.name,model:x.info&&x.info.model,adapterId:x.info&&x.info.adapterId,room:(ROOMS.find(r=>r.id===x.room)||{}).name||''})),
    staticLimit:a=>{const m=modelsFor(a.info&&a.info.adapterId).find(x=>x.id===((a.info&&a.info.model)||a.model||'auto'));return (m&&m.contextWindow)||0;},
    /* spec 058 FR-082: a running chat for Settings' live MCP list: the live agent (state, grants, remote: the Restart session questions)
       and the same options the MCP chip passes to the chat's MCP dialog */
    mcpSession:id=>{const r=LIVE.agents.find(y=>y.id===id&&y.live&&!y.parent);return r?{a:r,mcp:!!feat(r,'mcp'),o:mcpOpts(r)}:null;},
    folderOf:x=>{const ag=LIVE.agents.find(y=>y.id===(x&&x.id||x));return ag?folderOfRoom(ag.room):null;},
    openAgent:id=>openPanel(id,false),
    /* spec 058 FR-027: Restart session failed because the sign-in expired: the chat's sign-in card (spec 012 FR-157), as for a failed message */
    signInAgain:(a,detail)=>{const r=liveRoot(a);closeTurn(r);r.worked=false;markKindSignedOut(kindOf(r));showSignInCard(r,{detail:detail||''});setState(r,'error',null,kindWord(kindOf(r))+' needs you to sign in again.');}});
  document.addEventListener('click',e=>{if(e.target.closest&&e.target.closest('.place-add'))window.DurbarScreens.placeDialog(null);});
  $('toolsBtn').onclick=()=>window.DurbarScreens.isOpen()?window.DurbarScreens.close():window.DurbarScreens.openTools(null);
  $('settingsBtn').onclick=()=>window.DurbarScreens.openSettings();
  /* spec 052 FR-083: Settings… (⌘,) in the macOS app menu. The real window's preload carries it, also under the simulator. */
  {const real=window.agentDurbar;if(real&&real.onMenuSettings)real.onMenuSettings(()=>window.DurbarScreens.openSettings());
    /* spec 052 FR-164: File > Add Folder… / Add VS Code Workspace… press the same top-bar buttons (one code path) */
    if(real&&real.onMenuAdd)real.onMenuAdd(k=>{const b=$(k==='workspace'?'addWs':'addFolder');if(b&&!b.disabled)b.click();});
   /* FR-085: in full screen the top bar no longer keeps room for the traffic lights */
   if(real&&real.onFullScreen)real.onFullScreen(on=>{if(on)document.documentElement.dataset.fullscreen='';else delete document.documentElement.dataset.fullscreen;});}
  $('modelSel').onchange=syncKindModel;
  $('kindSel').onchange=syncKindModel;
  $('kindHelp').onclick=()=>aboutKinds();
  bridge.onEvent(onLiveEvent);
  bridge.onAgentAdded(addLiveAgent);
  if(bridge.onAgentRenamed)bridge.onAgentRenamed(onAgentRenamed);
  /* spec 061: a folder's own agent setup is shown when its agent joins the office (once per folder in this run) */
  if(window.DurbarFolderSetup){window.DurbarFolderSetup.init({bridge,esc,toast:(t,ms)=>toast(esc(t),ms),onRules:map=>{for(const id of Object.keys(map)){const a=liveById(id);if(!a||!a.info)continue;a.info.folderRules=map[id]||undefined;const c=$('modeChip'),sel=ui.selected&&liveRoot(byId(ui.selected)||a);if(c&&sel&&sel.id===a.id)c.outerHTML=modeChipHTML(a);}}});}
  bridge.listAgents().then(l=>{l.forEach(addLiveAgent);agentsListed=true;renderFilter();if(bridge.floorsState)bridge.floorsState().then(applyFloors).catch(()=>{});renderRestoreStrip();
    restoreUi();renderAwayStrip(); /* spec 052 FR-087 / FR-089 */
    /* spec 052 FR-059: what already needs you a few seconds after start is remembered, not notified */
    setTimeout(()=>{renderInboxBtn();ATT_ARMED=true;},3000);});
  loadModels();
  refreshSchedules();
  /* User themes (spec 040): register imported packs, then apply the saved theme id */
  THEME.setTheme.resolveUser=bridge.getUserTheme?(id)=>bridge.getUserTheme(id):null;
  const themeBoot=(v)=>{
    const tid=(v&&v.theme)||'clean-office';
    const apply=()=>{if(THEME.current().id!==tid)applyTheme(tid,true);else scheduleRender();};
    if(bridge.listUserThemes){bridge.listUserThemes().then(list=>{
      const good={};(list||[]).filter(t=>t.ok&&t.manifest!==false).forEach(t=>{});
      return bridge.getUserTheme?Promise.all((list||[]).filter(t=>t.ok).map(t=>bridge.getUserTheme(t.id).then(m=>[t.id,m])))
        .then(pairs=>{for(const [id,m] of pairs)if(m)good[id]=m;THEME.registerUserThemes(good);apply();})
      :apply();
    }).catch(()=>apply());}else apply();
  };
  if(bridge.getSettings)bridge.getSettings().then(v=>{APP_SETTINGS=v||{};PLACE_MAP=(v&&v.placeMap)||{};CUSTOM=(v&&Array.isArray(v.customPlaces))?v.customPlaces:[];SERIOUS=!!(v&&v.seriousMode);markSerious();NOTIFY=!!(v&&v.notifyNeedsMe!==false);BREAK_RESUME=v&&v.breakResume==='ask'?'ask':'auto';themeBoot(v);}).catch(()=>{});
  setInterval(()=>{if(VISITS.tick())scheduleRender();},250);
  setInterval(coffeeTick,SIM_BREAK?1000:5000); /* spec 068: resume, ask or remind when a break is due */
  agents=LIVE.agents; ROOMS=LIVE.rooms;
  setBadge();
}

renderFilter(); renderAll();
if(qs.get('view')==='list')setView('list');
if(pendingOpen&&demoOn){openPanel(pendingOpen,false);pendingOpen=null;}
/* spec 059 test hook, simulator only: a driver reads agents and calls what the Previous sessions row menu will call */
/* spec 008 FR-113, simulator only: false until the agents are listed, the frozen simulator has replayed every script and the saved usage
   totals are read; then any queued frame is drawn now (a stalled animation frame once left a comparison driver measuring a stale page) */
const settleNow=()=>{if(!agentsListed||!window.__durbarSimReplayed||baselineQueued||baselineAsking)return false;if(renderQueued){renderQueued=false;renderAll();}return true;};
if(SIM)window.__durbarSimUi={agents:()=>agents,renamePrevRow,settleNow,bridge:()=>bridge,render:()=>{layoutKey='';scheduleRender();},loungeTurn,quietHeads:(parts)=>{SIM_QUIET_HEADS=new Set(Array.isArray(parts)?parts:[]);},paint:()=>scheduleRender(),emit:onLiveEvent}; /* bridge: the simulator's fake (spec 005 T073: a driver counts Stop calls); render: spec 001 FR-057 drivers move a finish time back; never set outside DURBAR_SIM */
})();
