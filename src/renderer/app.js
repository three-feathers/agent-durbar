/* Agent Durbar renderer: office view, list view, chat panel, live + demo + simulated data.
   Plain script (no modules) so it runs in the sandboxed Electron renderer and in a plain browser. */
(function(){
'use strict';
const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const THEME=window.THEME; /* theme packs (specs 035-040): tokens, words, motion; every scene colour reads a semantic token */
const T_=n=>THEME.token(n);
const wordOf=k=>THEME.word(k);
const qs = new URLSearchParams(location.search);
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
let baselineQueued=false, usageSaveError='';
function loadUsageBaseline(){
  if(baselineQueued||!bridge||!bridge.usageTotals)return; baselineQueued=true;
  setTimeout(()=>{baselineQueued=false;bridge.usageTotals().then(v=>{if(v&&v.ok){LEDGER.setBaseline(v);usageSaveError=typeof v.error==='string'?v.error:'';scheduleRender();}}).catch(()=>{});},50);
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
function aiuChip(){
  const t=LEDGER.office(); if(!t.calls||demoOn)return '';
  const tip=window.DurbarUsage.tooltip(t,{scope:'office',removed:ledgerRemoved(),since:LEDGER.since(),run:LEDGER.officeRun(),offFloors:offFloorSpend()});
  const inner=t.unreported>=t.calls?'<span class="l">credits not reported</span>':`<b>${esc((t.nano/1e9).toFixed(2))}</b><span class="l">AIU</span>`;
  return `<span class="stat stat-aiu" role="note" title="${esc(tip)}" aria-label="${esc(tip.replace(/\n/g,' '))}">${inner}</span>`;
}
/* ---- how an agent is doing (spec 034, issue #20): the body follows the context window, trouble gets a drawing ---- */
const MOODS=window.DurbarMood;
const MOOD=MOODS.createMoodTracker();
let SERIOUS=false; /* Serious mode (Settings): no mood drawings at all */
let AMB_ID=null;   /* the one agent that has the ambulance (the most recent error), chosen once per render */
const NO_MOOD={body:'normal',trouble:null,pct:null,words:''};
function moodFor(a){
  if(SERIOUS||!a||a.parent||!a.live)return NO_MOOD;
  const c=STATS.agent(a.id).ctx, pct=c&&c.limit>0?window.DurbarStats.ctxLevel(c.tokens,c.limit).pct:null;
  const st=vis(a), body=MOODS.bodyOf(pct), failStreak=MOOD.failStreak(a.id);
  const waitingMs=st==='waiting'?MOOD.waitingMs(a.id):0; /* only while the figure is waiting: a request answered elsewhere must not leave it tapping */
  const trouble=MOODS.troubleOf({state:st,ambulance:AMB_ID===a.id,limit:!!a.limit,waitingMs,failStreak});
  return {body,trouble,pct,words:MOODS.phrases({body,pct,trouble,waitingMs,failStreak}).join(', ')};
}
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
async function applyTheme(idOrManifest){
  const applied=THEME.setTheme(idOrManifest);
  SC_CACHE.clear();
  renderAll();
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
/* ---- places in the office (spec 024): a shared lobby; main agents walk to the place of the tool they are using ---- */
const VISITS=window.DurbarPlaces.createVisits();
const SEEN_SERVERS=new Set(); /* MCP server names seen in tool events this run (per-folder extras included): the Places settings list them */
let CUSTOM=[]; /* the user's own places [{id,name,icon}] (spec 024 FR-018), from the settings; changed only through setCustomPlaces */
const customIds=()=>CUSTOM.map(p=>p.id);
/* One name for a place everywhere it is shown (tile, card text, Settings options, toasts). A custom place shows the user's own text; callers escape it. */
const placeLabel=id=>window.DurbarPlaces.IDS.includes(id)?wordOf('place-'+id):window.DurbarPlaces.placeName(id,CUSTOM);
let PLACE_MAP={}; /* MCP server name -> place id | 'desk' (global setting); unmapped servers use the built-in rules */
const RETURNING=new Set(); /* agents whose figure is still walking back to the desk: the desk keeps its empty chair until it arrives */
const PLACE_ICON={
  library:'<svg class="pic" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 16.5V4h3.5v12.5zM6.5 16.5V6h3.5v10.5zM10.5 16.5l3-11.5 3.4.9-3 11.4zM2 16.5h16"/></svg>',
  software:'<svg class="pic" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3.5" width="14" height="5" rx="1.5"/><rect x="3" y="11.5" width="14" height="5" rx="1.5"/><path d="M6 6h.01M6 14h.01M10 6h4M10 14h4"/></svg>',
  terminal:'<svg class="pic" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2.5" y="3.5" width="15" height="13" rx="2"/><path d="M6 8l3 2.5L6 13M11 13h3.5"/></svg>',
  web:'<svg class="pic" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="10" cy="10" r="7"/><path d="M3 10h14M10 3c2.5 2.2 2.5 11.8 0 14M10 3c-2.5 2.2-2.5 11.8 0 14"/></svg>',
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
const lobbyOn=()=>!demoOn&&agents.some(a=>a.live&&!a.parent);
const MAX_TILES=8, canAddPlace=()=>!!(bridge&&bridge.addPlace)&&window.DurbarPlaces.allPlaces(CUSTOM).length<MAX_TILES;
/* who is at a place and visible under the current filters (a hidden room or a filtered-out agent has no figure) */
const placeVisitors=pid=>VISITS.occupants(pid).filter(id=>{const a=byId(id),r=a&&!a.parent&&roomOf(a);return roomShown(r)&&(ui.ws==='all'||wsOf(a)===ui.ws)&&matchStatus(a);});
const isAway=a=>!a.parent&&(!!VISITS.at(a.id)||RETURNING.has(a.id));
const taskOf=a=>{const v=a.parent?null:VISITS.at(a.id);return v?'At '+placeLabel(v.place)+': '+v.label+' · '+a.task:a.task;};
/* A result of addPlace/updatePlace/removePlace (or a settings read): the places and the map as they are now. Agents standing at a place that is gone
   go back to their desk at once (spec 024 FR-025); a rename or an icon change only redraws. */
function setCustomPlaces(list,map){
  const old=CUSTOM; CUSTOM=Array.isArray(list)?list:[];
  old.filter(p=>!CUSTOM.some(q=>q.id===p.id)).forEach(p=>VISITS.dropPlace(p.id));
  if(map&&typeof map==='object')PLACE_MAP=map;
  scheduleRender();
}
function lobbyHTML(aw){
  if(!lobbyOn())return '';
  const all=window.DurbarPlaces.allPlaces(CUSTOM), add=canAddPlace();
  const cap=window.DurbarPlaces.tileSlots(aw,all.length,add);
  return `<section class="lobby" data-key="lobby" aria-label="${esc(wordOf('lobby-label'))}">${all.map(p=>{
    const ids=placeVisitors(p.id), sp=window.DurbarPlaces.layoutSpots(ids.length,cap), names=ids.map(id=>byId(id).name);
    const slots=Array.from({length:cap},(_,i)=>i<sp.shown?`<span class="slot on" data-slot="${i}"></span>`:(sp.more&&i===cap-1?`<span class="slot more" data-slot="${i}">+${sp.more}</span>`:`<span class="slot" data-slot="${i}"></span>`)).join('');
    return `<div class="place${ids.length?' busy':''}" data-key="place:${p.id}" data-place="${p.id}" tabindex="-1" role="group" title="${esc(placeLabel(p.id))}: ${names.length?esc(names.join(', ')):'nobody'}" aria-label="${esc(placeLabel(p.id))}: ${names.length?esc(names.join(', ')):'nobody'}">${placeIcon(p)}<span class="pn">${esc(placeLabel(p.id))}</span><span class="prow" aria-hidden="true"><span class="pslots">${slots}</span></span></div>`;
  }).join('')}${add?'<button class="place-add" type="button" data-key="place-add" title="Add a place" aria-label="Add a place">+</button>':''}${lobbyArt()}</section>`;
}
const WALK_MS=1000, MAX_WALKS=3; /* about 1 s per walk; beyond 3 at once the others simply appear */
const walkers=new Map(); /* agent id -> {el, back, walking, shown, timer, to} */
const walkCount=()=>{let n=0;walkers.forEach(w=>{if(w.walking)n++;});return n;};
function dropWalker(id){const w=walkers.get(id);if(!w)return;clearTimeout(w.timer);w.el.remove();walkers.delete(id);RETURNING.delete(id);}
/* Before the desks are drawn: an agent whose visit just ended keeps its empty chair until its figure is back. */
function prepareWalkers(){
  if(ui.view!=='office'||!lobbyOn())return;
  walkers.forEach((w,id)=>{if(!w.back&&!VISITS.at(id))RETURNING.add(id);});
}
/* After the office is drawn: put every figure where it belongs (positions are recomputed on every render, so resizes, filters and
   opened/closed rooms never leave one in the wrong place) and start the walks. */
function syncWalkers(){
  const layer=$('walkers'), floor=$('floor'); if(!layer||!floor)return;
  if(ui.view!=='office'||!lobbyOn()){[...walkers.keys()].forEach(dropWalker);return;}
  const fr=floor.getBoundingClientRect();
  if(!fr.width||!fr.height)return; /* office hidden (full-screen chat open): leave the figures as they are until it is shown again */
  const center=el=>{const r=el.getBoundingClientRect();return {x:Math.round(r.left-fr.left+floor.scrollLeft+r.width/2),y:Math.round(r.top-fr.top+floor.scrollTop+r.height/2)};};
  const want=new Map(); /* agent id -> slot centre of the place it is visiting (only those that fit; the rest are the "+N") */
  window.DurbarPlaces.allPlaces(CUSTOM).forEach(p=>{
    const tile=document.querySelector(`#stage .place[data-place="${p.id}"]`); if(!tile)return;
    const ids=placeVisitors(p.id), sp=window.DurbarPlaces.layoutSpots(ids.length,tile.querySelectorAll('.slot').length);
    ids.slice(0,sp.shown).forEach((id,i)=>{const sl=tile.querySelector(`.slot[data-slot="${i}"]`);if(sl)want.set(id,center(sl));});
  });
  const deskPos=id=>{const d=document.querySelector(`#stage [data-id="${CSS.escape(id)}"]`);const sc=d&&(d.querySelector('.scene')||d);return sc?center(sc):null;};
  const move=(w,pos,after,instant)=>{ /* instant: a layout change moved the slot under a resting figure: put it back, no walk */
    clearTimeout(w.timer);
    const walk=!instant&&!REDUCED&&w.shown&&(w.walking||walkCount()<MAX_WALKS);
    w.el.style.transition=walk?`transform ${WALK_MS}ms linear`:'none';
    w.el.style.transform=`translate(${pos.x}px,${pos.y}px)`;
    w.el.classList.toggle('walking',walk); w.walking=walk; w.to=pos.x+','+pos.y;
    if(walk)w.timer=setTimeout(()=>{w.walking=false;w.el.classList.remove('walking');if(after)after();},WALK_MS+40);
    else if(after)after();
  };
  want.forEach((pos,id)=>{
    let w=walkers.get(id);
    if(!w){
      const a=byId(id); if(!a)return;
      const el=document.createElement('span'); el.className='walker'; el.setAttribute('aria-hidden','true'); el.innerHTML='<span class="wk">'+avatar(a)+'</span>'; layer.appendChild(el);
      w={el,back:false,walking:false,shown:false,timer:0,to:''}; walkers.set(id,w);
      const from=deskPos(id)||pos; el.style.transition='none'; el.style.transform=`translate(${from.x}px,${from.y}px)`; void el.offsetWidth; w.shown=true;
      move(w,pos); return;
    }
    if(w.back){w.back=false;RETURNING.delete(id);move(w,pos);return;}
    if(w.walking){if(w.to!==pos.x+','+pos.y)move(w,pos);return;}
    if(w.to!==pos.x+','+pos.y)move(w,pos,null,true);
  });
  [...walkers.keys()].forEach(id=>{
    if(want.has(id))return;
    const w=walkers.get(id), dp=deskPos(id);
    if(!dp||REDUCED){dropWalker(id);return;} /* no desk on screen (room closed, filtered out) or no animation wanted: just disappear */
    if(w.back)return;
    w.back=true; RETURNING.add(id);
    move(w,dp,()=>{dropWalker(id);scheduleRender();});
  });
  /* spec 034 FR-015: the figure away at a place keeps its mood (ring, horns, trouble dot); none in Serious mode (moodFor) */
  walkers.forEach((w,id)=>{const m=moodFor(byId(id));w.el.dataset.body=m.body;w.el.dataset.trouble=m.trouble||'';});
}
function roomAiu(r){const f=folderOfRoom(r.id),t=LEDGER.room(r.id,f&&f.key);return t.calls&&!demoOn?{long:window.DurbarUsage.fmtTotal(t),short:window.DurbarUsage.fmtShort(t),tip:window.DurbarUsage.tooltip(t,{scope:'folder',since:LEDGER.since(),run:LEDGER.roomRun(r.id)})}:null;}

const LABELS={working:'Working',thinking:'Thinking',waiting:'Waiting for you',idle:'Idle',error:'Error',done:'Done'};
const LABELS_SHORT={waiting:'Waiting'};
const vis = a => a.paused ? 'idle' : a.state;
const label = (a,short) => a.paused ? 'Paused' : (a.label || (short&&LABELS_SHORT[a.state]) || LABELS[a.state]);
/* waiting-for-you first, then errors, everything else keeps its stable order (calm: no constant reshuffling) */
const prio = a => {const s=vis(a);return s==='waiting'?0:s==='error'?1:2;};

/* ---------------- state ---------------- */
const ui = {view:'office', ws:'all', status:null, selected:null, expanded:{}};
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
const fmtUsd=v=>'≈ $'+(v>0&&v<0.01?v.toFixed(4):v.toFixed(2))+' est.';
const USD_TIP='The agent\'s own estimate of the API price for these tokens, not a bill and not AIU.';
function usageShort(a){const u=a.usage; if(!u||!u.calls)return ''; const k=usageCaps(a), c=capOf(a);
  if(!k.nanoAiu)return c&&k.costUsd&&isUsdCap(a)?fmtTok(u.inT+u.outT)+' · $'+(u.usd||0).toFixed(2)+'/$'+c.toFixed(2)+' est.':fmtTok(u.inT+u.outT)+' tok'+(k.costUsd?' · '+fmtUsd(u.usd||0):'');
  return c?fmtTok(u.inT+u.outT)+' · '+(u.nano/1e9).toFixed(capDigits(c))+'/'+fmtCap(c)+' AIU':fmtTok(u.inT+u.outT)+' tok · '+(u.nano/1e9).toFixed(2)+' AIU';}
function usageLong(a){const u=a.usage; if(!u||!u.calls)return ''; const k=usageCaps(a), c=capOf(a), base=u.calls+' calls · '+fmtTok(u.inT)+' in / '+fmtTok(u.outT)+' out tokens';
  if(!k.nanoAiu)return base+(k.costUsd?' · '+(c&&isUsdCap(a)?fmtUsd(u.usd||0).replace(/ est\.$/,' of a $'+c.toFixed(2)+' cap est.'):fmtUsd(u.usd||0)):'');
  return base+' · '+(u.nano/1e9).toFixed(3)+' AIU'+(c?' of '+fmtCap(c)+' cap':'');}

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
function charArt(){
  let s='';
  for(const name of ['char-body','char-robe','char-headwear','char-collar']){
    const v=THEME.slot(name);
    s+=v===null?'':`<g class="art-slot" data-slot="${name}">${v}</g>`;
  }
  return s;
}
function scene(a,mini,c){
  const st=vis(a), mood=moodFor(a), k=mood.body==='monster'?Object.assign({},a.look,{skin:T_('--monster-skin')}):a.look, shirt=k.shirt, arm=shade(shirt,-.14), skinD=shade(k.skin,-.08);
  const kit=THEME.sceneKit(); /* another theme's people and desks (spec 035 FR-013); the office kit is the code below */
  if(kit!=='office'&&window.DurbarScenes){const v=window.DurbarScenes.draw(kit,a,{st,mood,k,mini,c,T:T_,shade,reduced:REDUCED});if(v)return v;}
  let s=`<svg class="scene${c?' sc-c':''}" data-sig="${st}|${k.shirt}${k.skin}${k.hair}${k.style}${k.glasses?1:0}|${c?'c':mini?'m':'f'}|${mood.body}${mood.trouble||''}" viewBox="${c?'16 5 176 116':mini?'22 4 166 118':'0 0 200 124'}" aria-hidden="true" focusable="false">`;
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
  s+=charArt();
  const eyesClosed = st==='idle'||mood.trouble==='faint';
  const tilt = mood.trouble==='faint'?'rotate(-24 74 56)': st==='idle'?'rotate(-7 74 56)': st==='error'?'rotate(4 74 56)':'';
  s+=`<g ${tilt?`transform="${tilt}"`:''}${mood.trouble==='faint'?' style="transform-box:view-box"':''}><g class="${st==='working'?'head':''}"><circle cx="74" cy="44" r="12.5" fill="${k.skin}"/>`;
  s+=hairFront(k.style,k.hair);
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
  if(st==='done') s+=`<circle cx="144" cy="54.5" r="10" fill="${T_('--done-bg')}"/><path d="M139 54.5l3.6 3.6 6.6-7" fill="none" stroke="${T_('--done-mark')}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>`;
  s+=`<rect x="59" y="82.2" width="36" height="3.8" rx="1.9" fill="${T_('--laptop')}"/>`;
  if(st==='idle') s+=`<rect x="98" y="76" width="10" height="10" rx="2.5" fill="${T_('--cup')}" stroke="${T_('--cup-line')}" stroke-width="1"/><path d="M108 78.5q4 0 4 3t-4 3" fill="none" stroke="${T_('--cup-line')}" stroke-width="1.4"/><path class="steam" d="M101 73q-2-3 0-5" fill="none" stroke="${T_('--steam')}" stroke-width="1.2" stroke-linecap="round"/><path class="steam" d="M105 73q-2-3 0-5" fill="none" stroke="${T_('--steam')}" stroke-width="1.2" stroke-linecap="round"/>`;
  const hand=(x,y)=>`<circle cx="${x}" cy="${y}" r="3.6" fill="${k.skin}"/>`;
  const armL=(x1,y1,x2,y2)=>`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${arm}" stroke-width="8" stroke-linecap="round"/>`;
  const typing = st==='working';
  s+='<g class="pp">';
  s+=`<g class="${typing?'hand-l':''}">${armL(61,71,68,81)}${hand(68.5,81.4)}</g>`;
  if(st==='waiting'&&mood.trouble!=='impatient'&&mood.trouble!=='faint'){ /* impatient taps the desk, a fainted agent does not wave */
    const wave = REDUCED||c?'':`<animateTransform attributeName="transform" type="rotate" values="-4 87 71;6 87 71;-4 87 71" dur="2.8s" repeatCount="indefinite"/>`;
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
  return s;
}
function avatar(a){
  const k=a.look;
  const kit=THEME.sceneKit();
  if(kit!=='office'&&window.DurbarScenes){const v=window.DurbarScenes.avatar(kit,a,{k,T:T_,shade,reduced:REDUCED});if(v)return v;}
  return `<svg viewBox="50 20 48 48" width="100%" height="100%" aria-hidden="true" focusable="false">${k.style==='long'?`<path d="M59.5 44a14.5 14.5 0 0 1 29 0v19q0 4-4 4h-21q-4 0-4-4z" fill="${k.hair}"/>`:''}<path d="M55 99V77q0-14 14-14h10q14 0 14 14v22z" fill="${k.shirt}"/><rect x="70" y="53" width="8" height="10" rx="3" fill="${shade(k.skin,-.08)}"/>${charArt()}<circle cx="74" cy="44" r="12.5" fill="${k.skin}"/>${hairFront(k.style,k.hair)}<circle cx="71.7" cy="45.4" r="1.35" fill="${T_('--face-dark')}"/><circle cx="79.7" cy="45.4" r="1.35" fill="${T_('--face-dark')}"/><path d="M71 51.6q3 2 6 0" fill="none" stroke="${T_('--mouth')}" stroke-width="1.3" stroke-linecap="round"/></svg>`;
}
const PLANT=()=>'<svg class="room-plant" width="26" height="30" viewBox="0 0 26 30" aria-hidden="true" focusable="false">'+THEME.slot('plant')+'</svg>';
/* ---------------- toast ---------------- */
function toast(html,ms){const t=document.createElement('div');t.className='toast';t.innerHTML=html;$('toasts').appendChild(t);setTimeout(()=>{t.style.transition='opacity .3s';t.style.opacity='0';setTimeout(()=>t.remove(),320)},ms||3200)}
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
/* the inverse of esc, in one pass (spec 045 FR-002: chained replacements turned "&amp;lt;" into "<") */
const unesc=s=>String(s).replace(/&(amp|lt|gt|quot);/g,(m,k)=>({amp:'&',lt:'<',gt:'>',quot:'"'}[k]));

/* ---------------- top bar ---------------- */
function visibleAgents(){return agents.filter(a=>roomShown(roomOf(a))&&(ui.ws==='all'||wsOf(a)===ui.ws));}
function renderStats(){
  const list=visibleAgents().filter(a=>!a.parent); const c={working:0,waiting:0,idle:0,error:0,done:0};
  list.forEach(a=>{const s=vis(a); if(s==='working'||s==='thinking')c.working++; else c[s]++;});
  const defs=[['working','Working','working or thinking'],['waiting','Waiting','waiting for you'],['idle','Idle','idle or paused'],['error','Errors','with errors'],['done','Done','done']];
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
const CANDIDATES=[['full',3],['full',2],['roomy',3],['card',3],['card',1],['mini',3],['mini',1],['micro',3],['micro',1]];
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
  return `<button class="helper is-${st}" data-id="${esc(h.id)}" aria-pressed="${ui.selected===h.id}" aria-label="${esc(h.name)}, helper of ${esc(byId(h.parent).name)}, ${esc(h.role)}, folder ${esc(roomOf(h).path)}, ${label(h)}: ${esc(h.task)}" title="${esc(h.task)}">
    ${scene(h,true)}<span class="badge ${st}">${badgeSVG(st)}</span>
    <div class="hinfo"><div class="hname">${esc(h.name)}</div><div class="hrole">${esc(h.role)}</div><div class="hst"><span class="dot ${st}"></span>${label(h)}</div></div></button>`;
}
function helperTileHTML(h){
  const st=vis(h);
  return `<button class="helper hc is-${st}" data-id="${esc(h.id)}" aria-pressed="${ui.selected===h.id}" aria-label="${esc(h.name)}, helper of ${esc(byId(h.parent).name)}, ${label(h)}: ${esc(h.task)}" title="${esc(h.name)} · ${label(h)}: ${esc(h.task)}">
    <span class="sc">${sceneC(h)}</span><span class="hi"><span class="hname">${esc(h.name)}</span><span class="hs st-${st}">${label(h,true)}</span></span></button>`;
}
const visitPlace=a=>{const v=a.parent?null:VISITS.at(a.id);return v?v.place:(RETURNING.has(a.id)?null:null);};
function cardHTML(a,d,nSubs){
  const st=vis(a), use=usageShort(a);
  return `<button class="desk card is-${st}${isAway(a)?' is-away':''}" data-id="${esc(a.id)}"${isAway(a)&&VISITS.at(a.id)?` data-place="${VISITS.at(a.id).place}"`:''} aria-pressed="${ui.selected===a.id}" title="${esc(a.name)} · ${label(a)}: ${esc(taskOf(a))}${moodWords(a)}${use?' · '+use:''}" aria-label="${esc(a.name)}, ${esc(a.role)}, folder ${esc(roomOf(a).path)}, ${label(a)}: ${esc(taskOf(a))}${moodWords(a)}${nSubs?`. ${nSubs} helper${nSubs>1?'s':''}`:''}${use?'. Usage '+use:''}. Open chat panel.">
    <span class="sc">${sceneC(a)}</span>
    <span class="ci"><span class="l1"><span class="name"${a.title?` title="${esc(a.title)} · ${esc(a.folderLabel||'')}"`:''}>${esc(a.name)}</span>${modeIcon(a)}<span class="role">${esc(a.profile?a.profile.name+" · "+a.role:a.role)}</span><span class="stl st-${st}">${label(a,true)}</span></span>
    <span class="intent">${esc(taskOf(a))}</span>
    <span class="l3"><span class="pill st-${st}"><i></i>${label(a,true)}</span><span class="use"${use.endsWith(' est.')?` title="${esc(USD_TIP)}"`:''}>${capOf(a)&&use.includes(' · ')?`<span class="aiu">${esc(use.split(' · ')[1])}</span>`:`${esc(use.split(' · ')[0]||'')}<span class="aiu">${use.includes(' · ')?' · '+esc(use.split(' · ')[1]):''}</span>`}</span></span></span></button>`;
}
function linksSVG(d,rows,extraMore){
  const D=DENS[d]; const n=rows+(extraMore?1:0);
  let py,ys=[];
  if(d==='full'){py=78;for(let i=0;i<n;i++)ys.push(34+i*104);}
  else{py=D.ch/2;for(let i=0;i<rows;i++)ys.push(i*(D.hh+D.hgap)+D.hh/2);if(extraMore)ys.push(rows*(D.hh+D.hgap)+D.mh/2);}
  const w=d==='full'?24:16, mid=d==='full'?12:8;
  return `<svg class="links" aria-hidden="true" focusable="false"><g fill="none" stroke="${T_('--link')}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${ys.map(y=>`<path d="M0 ${py}H${mid}V${y}H${w}"/>`).join('')}</g><circle cx="0" cy="${py}" r="2.6" fill="${T_('--link')}"/></svg>`;
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
    desk=`<button class="desk is-${st}${isAway(a)?' is-away':''}" data-id="${esc(a.id)}"${isAway(a)&&VISITS.at(a.id)?` data-place="${VISITS.at(a.id).place}"`:''} aria-pressed="${ui.selected===a.id}" aria-label="${esc(a.name)}, ${esc(a.role)}, folder ${esc(roomOf(a).path)}, ${label(a)}: ${esc(taskOf(a))}${moodWords(a)}${nSubs?`. ${nSubs} helper${nSubs>1?'s':''}`:''}. Open chat panel.">
      ${scene(a,false)}<span class="badge ${st}">${badgeSVG(st)}</span>
      <div class="info"><div class="who"><span class="name"${a.title?` title="${esc(a.title)} · ${esc(a.folderLabel||'')}"`:''}>${esc(a.name)}</span>${modeIcon(a)}<span class="role">${esc(a.profile?a.profile.name+" · "+a.role:a.role)}</span></div>
      <p class="task">${esc(taskOf(a))}</p><span class="pill st-${st}"><i></i>${label(a)}</span></div></button>`;
  } else desk=cardHTML(a,d,nSubs);
  return `<div class="unit${nSubs?' has-h':''}" data-key="unit:${esc(a.id)}">${desk}${helpers}</div>`;
}
const unitWidth=(a,d)=>{const D=DENS[d];return D.cw+(helpersOf(a).length?(d==='full'?D.hw+14+8:D.hw+18):0);};
function officeModel(ignoreStatus){
  const rooms=[];
  roomsInOrder().forEach(r=>{
    if(!roomShown(r)||(ui.ws!=='all'&&ui.ws!==r.id))return;
    const mains=agents.filter(a=>!a.parent&&a.room===r.id&&(ignoreStatus||matchStatus(a)));
    if(!mains.length)return;
    const key=a=>Math.min(prio(a),...helpersOf(a).map(prio));
    mains.sort((x,y)=>key(x)-key(y));
    rooms.push({r,mains,all:agents.filter(a=>wsOf(a)===r.id)});
  });
  return rooms;
}
/* ---- room doors (spec 017): a closed room is a compact door plate with a one-line status ---- */
/* door colours come from the theme (spec 036) */
function doorSvg(open){
  const t=T_;
  const art=THEME.slot('door-art'), ov=art===null?'':`<g class="art-slot" data-slot="door-art">${art}</g>`;
  return open
    ?`<svg class="door-svg" viewBox="0 0 20 20" aria-hidden="true" focusable="false"><rect x="4" y="2.5" width="12" height="15" rx="1.6" fill="${t('--door-bg')}" stroke="${t('--door-line')}" stroke-width="1.2"/>${ov}<path class="leaf" d="M4.4 3.2 9.6 4.6V15.4L4.4 16.8Z" fill="${t('--door-leaf')}" stroke="${t('--door-leaf-line')}" stroke-width="1"/><circle cx="8.2" cy="10" r=".8" fill="${t('--door-knob')}"/></svg>`
    :`<svg class="door-svg" viewBox="0 0 20 20" aria-hidden="true" focusable="false"><rect x="4" y="2.5" width="12" height="15" rx="1.6" fill="${t('--door-leaf')}" stroke="${t('--door-leaf-line')}" stroke-width="1.2"/><rect x="6.2" y="4.7" width="7.6" height="4.4" rx=".9" fill="${t('--door-panel')}"/><circle cx="13.1" cy="12" r="1" fill="${t('--door-knob')}"/>${ov}</svg>`;
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
function stageHTML(sizing,d,aw,cap){
  const open=sizing.filter(m=>!m.r.closed).map(m=>roomHTML(m,d,aw,cap)), doors=doorsHTML(sizing.filter(m=>m.r.closed)), lob=lobbyHTML(aw);
  if(!lob)return open.join('')+doors;
  const mid=open.length<2?open.length:Math.ceil(open.length/2); /* one room: below it; none: above the door plates */
  return open.slice(0,mid).join('')+lob+open.slice(mid).join('')+doors;
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
function roomHTML({r,mains,all},d,aw,cap){
  const al=roomAlert(r), alAttr=(al.tone==='calm'?'':` data-alert="${al.tone}"`)+(al.siren?' data-siren="1"':''), alLabel=al.siren?'. '+ALERT_WORDS:'';
  const dots=['waiting','error','working','done','idle'].map(k=>{const n=all.filter(a=>{const s=vis(a);return k==='working'?(s==='working'||s==='thinking'):s===k}).length;return n?`<span class="rd${k==='waiting'?' attn':(k==='done'||k==='idle')?' calm':''}" title="${n} ${LABELS[k]}"><span class="dot ${k}"></span>${n}</span>`:''}).join('');
  const head=`<div class="room-head"><button class="door" type="button" data-door="${esc(r.id)}" aria-expanded="true" aria-label="${esc(wordOf('door-close'))} ${esc(r.name)}" title="${esc(wordOf('door-title-prefix'))}: ${esc(r.name)} ${esc(wordOf('door-plate-suffix'))}">${doorSvg(true)}</button><span class="room-name" title="${esc(r.name)}${(()=>{const u=roomAiu(r);return u?' · '+esc(u.long):'';})()}">${esc(r.name)}</span>${al.siren?SIREN():''}${floorTag(r)}<span class="room-path" title="${esc(r.path)}">${esc(r.path)}</span>${(()=>{const u=roomAiu(r);return u?`<span class="room-aiu" title="${esc(u.tip)}">${esc(u.long)}</span>`:'';})()}<span class="room-dots" aria-hidden="true">${dots}</span>${bridge&&bridge.newSession&&anyKindReady()&&!demoOn?`<button class="room-new" type="button" data-newsess="${esc(r.id)}" title="New session in ${esc(r.name)}" aria-label="New session in ${esc(r.name)}">+</button>`:''}${bridge&&bridge.removeFolder&&!demoOn?`<button class="room-new room-more" type="button" data-foldermenu="${esc(r.id)}" title="Folder actions: new session, rename, hide, remove" aria-label="Folder actions for ${esc(r.name)}" aria-haspopup="menu">⋯</button>`:''}${bridge&&bridge.mcpFolderState&&agents.some(x=>x.room===r.id&&!x.parent&&x.info&&feat(x,'mcp'))&&!demoOn?`<button class="room-mcp" type="button" data-mcproom="${esc(r.id)}" title="MCP extras for ${esc(r.name)}: optional servers for this folder only" aria-label="MCP extras for ${esc(r.name)}">MCP</button>`:''}${PLANT()}</div>`;
  if(d==='full'){
    const gap=6, pad=12;
    const widths=mains.map(a=>unitWidth(a,d));
    const basis=Math.min(aw,widths.reduce((x,y)=>x+y,0)+gap*(widths.length-1)+2*pad+30);
    const min=Math.max(...widths)+2*pad+30;
    return `<section class="room" data-key="room:${esc(r.id)}" data-tint="${r.tint}"${alAttr} style="--w:${Math.round(basis)};--min:${Math.round(min)}px" aria-label="Workspace ${esc(r.name)}${alLabel}">${head}
      <div class="units">${roomArt()}${mains.map(a=>unitHTML(a,d)).join('')}</div></section>`;
  }
  /* compact: the room is a floor-plan zone with `cols` desk columns */
  const D=DENS[d], cols=Math.max(1,Math.min(mains.length,cap)), over=2*D.rp+4;
  const basis=cols*D.cw+(cols-1)*D.gap+over, min=D.cw+over;
  return `<section class="room" data-key="room:${esc(r.id)}" data-tint="${r.tint}"${alAttr} style="--w:${Math.round(basis)};--min:${Math.round(min)}px" aria-label="Workspace ${esc(r.name)}${alLabel}">${head}
    <div class="units" style="--cols:${cols}">${roomArt()}${mains.map(a=>unitHTML(a,d)).join('')}</div></section>`;
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
  if(n.dataset&&n.dataset.sig!==undefined){if(o.dataset.sig===n.dataset.sig)return o;o.replaceWith(n);return n;}
  syncAttrs(o,n); morphChildren(o,n); return o;
}
function morphChildren(op,np){
  const old=[...op.childNodes], byKey=new Map(), plain=[];
  old.forEach(k=>{const key=keyOf(k);if(key!=null)byKey.set(key,k);else plain.push(k);});
  let pi=0, ref=op.firstChild; const used=new Set();
  for(const nk of [...np.childNodes]){
    const key=keyOf(nk); let m=null;
    if(key!=null){m=byKey.get(key)||null;if(m&&(used.has(m)||m.nodeName!==nk.nodeName))m=null;}
    else if(pi<plain.length&&plain[pi].nodeName===nk.nodeName&&!used.has(plain[pi]))m=plain[pi++];
    if(m){const r=morphNode(m,nk);used.add(r);if(r===m){if(m===ref)ref=m.nextSibling;else op.insertBefore(m,ref);}else if(m===ref)ref=r.nextSibling;}
    else{op.insertBefore(nk,ref);used.add(nk);}
  }
  old.forEach(k=>{if(!used.has(k)&&k.parentNode===op)op.removeChild(k);});
}
function morphHTML(el,html){const t=document.createElement('template');t.innerHTML=html;morphChildren(el,t.content);}

/* ---- layout: pick the richest density that fits the floor at scale 1 (text is never scaled down) ----
   The search renders trial layouts into the hidden #probe, never into the visible stage, and its result is cached
   until the *shape* of the office changes (agents, helper counts, filters, size). Status changes only patch the DOM. */
function chooseLayout(sizing,aw,ah){
  const probe=$('probe'); probe.style.width=aw+'px';
  const openOnly=sizing.filter(m=>!m.r.closed);
  if(!openOnly.length){probe.innerHTML=stageHTML(sizing,'card',aw,1);probe.dataset.d='card';const ok=probe.scrollHeight<=ah+1;probe.innerHTML='';return {d:'card',hcap:1,cap:1,fit:ok,boost:[]};}
  const fits=()=>probe.scrollHeight<=ah+1&&probe.scrollWidth<=aw+1;
  const cands=FORCE_DENSITY?CANDIDATES.filter(c=>c[0]===FORCE_DENSITY):CANDIDATES;
  let res=null, lastAny=null;
  for(const [d,hcap] of cands){
    HCAP=hcap; HBOOST=new Map(); probe.dataset.d=d; probe.style.height='auto';
    if(d==='full'){
      probe.innerHTML=stageHTML(sizing,d,aw);
      if(fits()){res={d,hcap,cap:0,fit:true,boost:[]};break;}
      lastAny={d,hcap,cap:0,fit:false,boost:[]};continue;
    }
    const D=DENS[d], over=2*D.rp+4;
    const maxCap=Math.max(1,Math.min(Math.max(...openOnly.map(m=>m.mains.length)),Math.floor((aw-over+D.gap)/(D.cw+D.gap))));
    let best=null, any=null;
    for(let c=maxCap;c>=1;c--){
      probe.innerHTML=stageHTML(sizing,d,aw,c);
      const h=probe.scrollHeight;
      if(!any||h<any.h-8)any={c,h};
      if(fits()){
        /* among layouts that fit, prefer desks close to a comfortable width (not stretched, not squeezed) */
        let tw=0; const ds=probe.querySelectorAll('.desk.card'); ds.forEach(e=>{tw+=e.getBoundingClientRect().width;});
        const miss=Math.abs(tw/Math.max(1,ds.length)-D.cw*1.3);
        if(!best||miss<best.miss-6)best={c,h,miss};
      }
    }
    if(best){res={d,hcap,cap:best.c,fit:true,boost:[]};break;}
    lastAny={d,hcap,cap:any.c,fit:false,boost:[]};
  }
  /* Leftover floor space (also what closed rooms free up): give the agents with the most helpers more of them, one step up
     (1 -> 3, 2 -> 3, 3 -> 6 shown before "+N more"), attention first, while the layout still fits. */
  if(res&&res.fit){
    const up={1:3,2:3,3:6}[res.hcap]||res.hcap;
    const many=openOnly.flatMap(m=>m.mains).filter(a=>helpersOf(a).length>res.hcap+1).sort((x,y)=>Math.min(prio(x),...helpersOf(x).map(prio))-Math.min(prio(y),...helpersOf(y).map(prio))||helpersOf(y).length-helpersOf(x).length);
    HCAP=res.hcap; probe.dataset.d=res.d;
    for(const a of many){
      HBOOST.set(a.id,up); probe.style.height='auto';
      probe.innerHTML=stageHTML(sizing,res.d,aw,res.cap);
      if(fits())res.boost.push([a.id,up]); else HBOOST.delete(a.id);
    }
  }
  probe.innerHTML='';
  return res||lastAny;
}
let layoutKey='', layout=null;
/* spec 001 FR-026: what a new user needs before the first folder: sign in once, add a folder (Read-only), or look around in the demo */
const WELCOME_HTML=`<section class="welcome" aria-labelledby="wlT"><h2 id="wlT">Welcome to Agent Durbar</h2>
  <p class="wl-sub">Your AI agents in one office: see what each one is doing, chat with it, and decide what it may do. For code, documents, research or notes, with GitHub Copilot, Claude Code or OpenAI Codex side by side.</p>
  <ol class="wl-steps">
    <li><b>Sign in to an agent harness once</b> on this computer: GitHub Copilot (<code>copilot login</code>, a free plan works), Claude Code (<code>claude auth login</code>) or OpenAI Codex (<code>codex login</code>). Several can be used side by side.</li>
    <li><b>Add a folder</b> with <b>+ Folder</b>: a project, a set of documents, any folder your agent should work in. Each folder becomes a room with its own agent. Agents start in <b>Read-only</b>: they can read the folder, nothing else.</li>
    <li><b>Send a message</b> to start. Switch to <b>Ask first</b> or <b>Allow all</b> only for folders you trust.</li>
  </ol>
  <div class="wl-actions"><button class="btn primary" type="button" data-wl="add">+ Add a folder</button><button class="btn" type="button" data-wl="demo">Look around in the demo</button></div>
  <p class="wl-note">Agents run on your computer, as you, and use your own plan (Copilot AI credits, your Claude or ChatGPT plan).</p></section>`;
document.addEventListener('click',e=>{const b=e.target.closest('[data-wl]');if(!b)return;
  if(b.dataset.wl==='add')$('addFolder').click();
  else{const t=$('demoToggle');t.checked=true;t.dispatchEvent(new Event('change'));}});
function renderOffice(){
  if(ui.view!=='office')return;
  const floor=$('floor'), stage=$('stage'), cs=getComputedStyle(floor);
  const aw=floor.clientWidth-parseFloat(cs.paddingLeft)-parseFloat(cs.paddingRight);
  const ah=floor.clientHeight-parseFloat(cs.paddingTop)-parseFloat(cs.paddingBottom);
  if(aw<=0||ah<=0)return;
  const model=officeModel();
  if(!model.length){
    stage.dataset.d='card'; stage.style.width=aw+'px'; stage.style.height='auto'; layoutKey='';
    if(!agents.length&&!demoOn){stage.innerHTML=WELCOME_HTML;floor.classList.remove('scrolls');return;} /* spec 001 FR-026: first run */
    stage.innerHTML='<div class="empty">'+(!agents.length&&!demoOn?'No agents yet. Use "+ Folder" or "+ Workspace" above.':(agents.length&&ROOMS.every(r=>r.hidden)?'All folders are hidden. Open "Folders" above to show them again.':agents.length&&floorsLive()&&!floorsOnList().length?'All floors are off. Open "Floors" above to switch one on.':agents.length&&ROOMS.every(r=>!roomShown(r))?'Nothing to show: every folder is hidden or on a floor that is off. Open "Floors" or "Folders" above.':'No agents match these filters.'))+'</div>';
    floor.classList.remove('scrolls'); return;
  }
  /* Density is chosen from the unfiltered set so cards do not change shape when a status pill filters. */
  const sizing=ui.status?officeModel(true):model;
  const key=JSON.stringify([aw,ah,FORCE_DENSITY,lobbyOn(),floorTagsOn()&&floorsOnList().map(f=>f.id+':'+f.name),sizing.map(m=>m.r.closed?[m.r.id,'closed']:[m.r.id,m.mains.map(a=>[a.id,helpersOf(a).length,!!ui.expanded[a.id]])])]);
  if(key!==layoutKey||!layout){layout=chooseLayout(sizing,aw,ah);layoutKey=key;}
  HCAP=layout.hcap; HBOOST=new Map(layout.boost);
  const html=stageHTML(model,layout.d,aw,layout.cap);
  const fresh=stage.dataset.d!==layout.d||!!stage.querySelector('.empty');
  stage.style.width=aw+'px'; stage.style.height='auto'; stage.dataset.d=layout.d;
  if(fresh)stage.innerHTML=html; else morphHTML(stage,html);
  stage.dataset.fit=layout.fit?'ok':'scroll'; stage.dataset.h=String(layout.hcap);
  floor.classList.toggle('scrolls',!layout.fit);
  if(doorAnim){const el=stage.querySelector(`[data-door="${CSS.escape(doorAnim)}"]`),box=el&&(el.closest('.room')||el);if(box&&!REDUCED){box.classList.add('enter');setTimeout(()=>box.classList.remove('enter'),420);}doorAnim=null;}
}

/* ---------------- list view ---------------- */
function renderList(){
  const rows=[];
  roomsInOrder().forEach(r=>{ if(!roomShown(r)||(ui.ws!=='all'&&ui.ws!==r.id))return;
    agents.filter(a=>!a.parent&&a.room===r.id).slice().sort((x,y)=>Math.min(prio(x),...helpersOf(x).map(prio))-Math.min(prio(y),...helpersOf(y).map(prio))).forEach(a=>{
      const subs=helpersOf(a);
      if(matchStatus(a)){rows.push([a,false]);subs.forEach(h=>rows.push([h,true]));}
    });});
  /* spec 034 FR-014: no figures here, so the mood words (cards: drawing + label) are written at the start of the task cell */
  const row=([a,sub])=>{const st=vis(a),mw=moodFor(a).words;return `<button class="lrow" data-id="${esc(a.id)}" aria-pressed="${ui.selected===a.id}" aria-label="${esc(a.name)}, ${esc(a.role)}, ${esc(roomOf(a).name)}, ${label(a)}: ${esc(a.task)}${moodWords(a)}">
    <span class="lname"><span class="dot ${st}"></span><span class="${sub?'sub':''}">${esc(a.name)}</span></span><span class="lcell">${esc(a.role)}</span><span class="lcell mono">${esc(roomOf(a).name)}</span><span class="lcell"${mw?` title="${esc(mw)}"`:''}>${mw?`<span class="lmood">${esc(mw)}</span> · `:''}${esc(a.task)}</span><span><span class="pill st-${st}"><i></i>${label(a)}</span></span></button>`};
  $('list').innerHTML=`<div class="list-wrap" role="group" aria-label="Agents"><div class="lrow head" aria-hidden="true"><span>Agent</span><span>Role</span><span>Workspace</span><span>Current task</span><span>Status</span></div>${rows.map(row).join('')||'<div class="empty">No agents match these filters.</div>'}</div>`;
}

function renderAll(){
  AMB_ID=pickAmbulanceId();
  prepareWalkers();
  const ae=document.activeElement, id=ae&&ae.dataset&&(ae.dataset.id||ae.dataset.more||ae.dataset.door), inPanel=ae&&ae.closest&&ae.closest('#panel');
  const key=ae&&ae.dataset&&(ae.dataset.id?'data-id':ae.dataset.more?'data-more':ae.dataset.door?'data-door':'');
  renderStats();
  updateFloorAttention();
  if(ui.view==='office')renderOffice(); else renderList();
  renderDoorBar();
  syncWalkers();
  if(id&&!inPanel){const n=document.querySelector(`[${key}="${CSS.escape(id)}"]`); if(n&&ae!==n)n.focus({preventScroll:true});}
  if(ui.selected){updatePanelHeader();renderStrip();}
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
function scrollChat(chat){const c=$('chat'); if(c&&chat.el.parentNode===c&&c.dataset.pin!=='0'){c.scrollTop=c.scrollHeight;}}
async function typeInto(el,text,speed,chat){
  if(REDUCED){el.textContent=text;return;}
  for(let i=0;i<text.length;){i+=2+Math.floor(Math.random()*3);el.textContent=text.slice(0,i);scrollChat(chat);await sleep(speed);}
  el.textContent=text;
}
/* Tool chip: one compact line that truncates; click expands it to show the full command and output. */
const CHIPS_SHOWN=6;
function makeChip({tool,kind,label,res,state,output}){
  const k=kind||toolKind(tool), name=TOOLNAME[tool]||tool||'tool';
  const el=document.createElement('div');
  el.className='chip'+(state==='failed'||state==='fail'?' fail':state==='run'?' run':'');
  el.setAttribute('role','button');el.tabIndex=0;el.setAttribute('aria-expanded','false');
  el.title=name+': '+label+(res?' ('+res+')':'');
  const detail=output&&output!==res?output:'';
  if(detail)el.classList.add('has-detail');
  el.innerHTML=`${ICON(k)||ICON('tool')}<b>${esc(name)}</b><code>${esc(label)}</code>${res?`<span class="res">${el.className.includes('fail')?'Failed: ':''}${esc(res)}</span>`:''}<span class="detail">${esc(detail)}</span>`;
  return el;
}
function refreshChips(box){
  const chips=[...box.children].filter(c=>c.classList.contains('chip'));
  let more=box.querySelector('.chips-more');
  const expanded=box.dataset.exp==='1', hide=Math.max(0,chips.length-CHIPS_SHOWN);
  chips.forEach((c,i)=>{c.hidden=!expanded&&i<hide;});
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
  chat.el.appendChild(m);scrollChat(chat);return m;
}
/* "Thinking · 4s" while a turn waits for the model; reasoning summaries only arrive when the model finishes thinking */
setInterval(()=>{
  document.querySelectorAll('.think.streaming').forEach(t=>{const l=t.querySelector('.think-l'),b=t.querySelector('.think-body');
    const sec=Math.max(0,Math.round((Date.now()-Number(t.dataset.t0||Date.now()))/1000));if(l)l.textContent=(b&&b.textContent?'Thinking':'Waiting for the model')+' · '+sec+'s';});
  document.querySelectorAll('.typing[data-t0]').forEach(t=>{const l=t.querySelector('.t-l');if(!l)return;
    const sec=Math.max(0,Math.round((Date.now()-Number(t.dataset.t0))/1000));l.textContent=(t.parentNode&&t.parentNode.children.length>1?'Working':'Waiting for the model')+' · '+sec+'s';});
},1000);
function collapseThink(think){
  if(!think||think.dataset.touched)return;
  const tb=think.querySelector('.think-toggle'),body=think.querySelector('.think-body');
  if(tb){tb.setAttribute('aria-expanded','false');} if(body)body.hidden=true;
}
async function playTurn(chat,a,turn,opts){
  opts=opts||{};
  const m=newAgentMsg(chat,a), body=m.querySelector('.think-body'), chips=m.querySelector('.chips'), think=m.querySelector('.think');
  await typeInto(body,turn.think,16,chat);
  think.classList.remove('streaming');
  for(const t of turn.tools){await sleep(380);const [k,l,res,rs]=t;addChip(chips,makeChip({kind:k,tool:k,label:l,res,state:rs}));scrollChat(chat);}
  if(turn.reply){
    await sleep(350);
    const b=document.createElement('div');b.className='bubble caret';m.appendChild(b);
    await typeInto(b,turn.reply,14,chat);b.classList.remove('caret');
    collapseThink(think);
    if(turn.quick){const q=document.createElement('div');q.className='quick';q.setAttribute('role','group');q.setAttribute('aria-label','Quick replies');
      turn.quick.forEach(txt=>{const bt=document.createElement('button');bt.textContent=txt;bt.addEventListener('click',()=>{q.remove();sendMessage(txt,a.id);});q.appendChild(bt);});m.appendChild(q);}
  } else if(opts.inProgress){
    const t=document.createElement('div');t.className='typing';t.setAttribute('aria-label',a.name+' is working');t.innerHTML='<i></i><i></i><i></i>';m.appendChild(t);
  }
  scrollChat(chat);
}
function addUserMsg(chat,text,atts,ts){
  const m=document.createElement('div');m.className='msg user';
  const now=ts?new Date(ts):new Date();const hh=(ts&&now.toDateString()!==new Date().toDateString()?now.toLocaleDateString([],{month:'short',day:'numeric'})+' ':'')+String(now.getHours()).padStart(2,'0')+':'+String(now.getMinutes()).padStart(2,'0');
  m.innerHTML='<div class="bubble"></div><div class="chips" aria-label="Attachments"></div><div class="meta">You · '+hh+'</div>';
  m.querySelector('.bubble').textContent=text;
  const box=m.querySelector('.chips');
  (atts||[]).forEach(x=>{const c=document.createElement('div');c.className='chip att-chip'+(x.img?' img':'');c.title=x.path||x.name;
    c.innerHTML=(x.img?ICON('img'):ICON('file'))+'<span>'+esc(x.name)+'</span>';box.appendChild(c);});
  if(!(atts||[]).length)box.remove();
  chat.el.appendChild(m);scrollChat(chat);
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
  playTurn(chat,a,{think:sc.think,tools:sc.tools,reply:reply,quick:inProg?null:sc.quick},{inProgress:inProg}).then(()=>{chat.busy=false;setSend();});
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
  await playTurn(chat,a,turn,{inProgress:false});
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
  box.innerHTML=attached.map((x,i)=>`<span class="att ${x.img?'img':''}" title="${esc(x.path||x.name)}${x.size?' ('+fmtSize(x.size)+')':''}">${x.img?ICON('img'):ICON('file')}<span>${esc(x.name)}</span><button type="button" data-rm="${i}" aria-label="Remove ${esc(x.name)}">${ICON('x')}</button></span>`).join('')+(attached.length?`<span class="att-count" aria-live="polite">${attached.length}/${MAX_ATT_FILES}</span>`:'');
}
function autoGrow(){const t=$('msgInput');if(!t)return;t.style.height='auto';t.style.height=Math.min(110,t.scrollHeight)+'px';setSend();}
function setSend(){const b=$('sendBtn'),t=$('msgInput');if(!b||!t)return;const a=byId(ui.selected);const busy=a&&chats[a.id]&&chats[a.id].busy;b.setAttribute('aria-disabled',String(!!busy||(!t.value.trim()&&!attached.length)));}

function updatePanelHeader(){
  const a=byId(ui.selected); if(!a)return; const st=vis(a);
  const ph=$('panelHead'); if(!ph)return;
  const sp=ph.querySelector('[data-f=status]'); sp.className='pill st-'+st; sp.innerHTML='<i></i>'+label(a);
  const t=ph.querySelector('[data-f=task]'); t.textContent=a.task; t.title=a.task;
  const ug=ph.querySelector('[data-f=usage]'); ug.textContent=usageLong(a); ug.title=ug.textContent.endsWith(' est.')?USD_TIP:'';
  updateCapChip(a);
  $('pauseBtn').querySelector('span').textContent=a.paused?'Resume':'Pause';
}
function openPanel(id,focus){
  const a=byId(id); if(!a)return; ui.selected=id; attached=[];
  document.body.classList.add('panel-open');
  const room=roomOf(a), parent=a.parent?byId(a.parent):null;
  const p=$('panel');
  const stripScroll=(p.querySelector('.strip-list')||{}).scrollLeft||0;
  const mdlName=a.live&&a.info?modelLabel(a.info):'';
  p.innerHTML=`<div class="panel-in">
   <div class="strip" role="navigation" aria-label="Agents"><button class="btn back" id="backBtn" type="button" title="Back to the office (Esc)">${ICON('back')}<span>Office</span></button><div class="strip-list" id="stripList"></div></div>
   <div class="ph" id="panelHead"><div class="ph-top"><div class="avatar">${avatar(a)}</div><div class="ph-id"><h2 id="panelTitle" tabindex="-1"${a.title?` title="${esc(a.title)} · ${esc(a.folderLabel||'')}"`:''}>${esc(a.name)}</h2><div class="sub">${esc(a.role)}${parent?' · helper of '+esc(parent.name):''}</div></div>
      <div class="ph-meta"><span data-f="status"></span>${a.live&&a.info&&!a.parent&&bridge.setPermMode?modeChipHTML(a):''}${mdlName?(a.live&&a.info&&!a.parent&&bridge.setModel&&feat(a,'models')?modelChipHTML(a):`<span class="mchip" title="${esc(mdlName.title)}">${esc(mdlName.text)}</span>`):''}${a.live&&a.info&&!a.parent&&a.info.profiles&&bridge.listProfiles?agentChipHTML(a):''}${a.live&&!a.parent&&window.DurbarStats?ctxChipHTML(liveRoot(a)):''}${a.live&&!a.parent&&bridge&&bridge.setCap?capChipHTML(liveRoot(a)):''}<span class="folder" title="${esc(room.path)}"><svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" style="flex:none"><path d="M1.8 4.2a1.4 1.4 0 0 1 1.4-1.4h3l1.6 1.8h4.8a1.4 1.4 0 0 1 1.4 1.4v6.2a1.4 1.4 0 0 1-1.4 1.4H3.2a1.4 1.4 0 0 1-1.4-1.4z"/></svg><span class="folder-t">${esc(room.path)}</span></span></div>
      <div class="actions">${a.live&&!a.parent?`<button class="btn" id="toolsHdrBtn" type="button" title="Which tools this agent used, how often, and its models and context window">Tools</button>`:''}${a.live&&!a.parent&&bridge.agentMcp&&feat(liveRoot(a),'mcp')?`<button class="btn" id="mcpBtn" type="button" title="MCP servers for this agent (set globally in Settings)">MCP</button>`:''}${a.live&&bridge.newSession&&!a.parent&&anyKindReady()?`<button class="btn" id="newSessBtn" type="button" title="Another agent with its own chat in this folder">+ New session</button>`:''}<button class="btn primary" id="vscodeBtn" type="button" title="Open this folder in VS Code"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5.5 4.5L2 8l3.5 3.5M10.5 4.5L14 8l-3.5 3.5M9 3l-2 10"/></svg>Open in VS Code</button>
        ${a.live&&!a.parent&&resumeCmdOf(a)?`<button class="btn" id="copyResBtn" type="button" title="Copy a command that continues this session in a terminal (end the session here first)">Copy resume command</button>`:''}
        <button class="btn" id="pauseBtn" type="button"><svg viewBox="0 0 16 16" fill="currentColor"><rect x="4" y="3" width="2.8" height="10" rx="1"/><rect x="9.2" y="3" width="2.8" height="10" rx="1"/></svg><span>Pause</span></button>
        ${a.live&&!feat(liveRoot(a),'stop')?'':`<button class="btn danger" id="stopBtn" type="button" title="${a.live?'Interrupt the current turn. The agent stays open and ready.':'Stop'}"><svg viewBox="0 0 16 16" fill="currentColor"><rect x="3.5" y="3.5" width="9" height="9" rx="2"/></svg>Stop</button>`}
        ${a.live&&bridge.end&&!a.parent?`<button class="btn" id="endBtn" type="button" title="End this session and free it. Sending a message later resumes it.">End session</button>`:''}${a.live&&bridge.removeSession&&!a.parent&&siblingsOf(a).length?`<button class="btn danger" id="rmSessBtn" type="button" title="End this session and take its card out of the office. The other sessions in ${esc(room.name)} stay.">Remove session</button>`:(a.live&&bridge.removeFolder&&!a.parent&&!demoOn?`<button class="btn danger" id="rmFolderBtn" type="button" title="Take ${esc(room.name)} out of Agent Durbar: its session ends and the folder is no longer remembered. Nothing on disk is deleted.">Remove folder</button>`:'')}</div></div>
    <p class="ptask" data-f="task"></p><p class="pusage" data-f="usage"></p>
    <div class="grants" id="grants" aria-label="Permissions allowed for this session" hidden></div></div>
   <div class="prev" id="prev" hidden></div>
   <div id="chat" role="log" aria-live="off" aria-label="Chat with ${esc(a.name)}" tabindex="0"></div>
   <div class="composer"><div class="att-note" id="attNote" role="alert" hidden></div><div class="attached" id="attached" aria-label="Attachments"></div>
    <div class="inbox"><button class="ib" id="attFile" type="button" aria-label="Attach file" title="Attach file">${ICON('file')}</button><button class="ib" id="attImg" type="button" aria-label="Attach image" title="Attach image">${ICON('img')}</button>
     <textarea id="msgInput" rows="1" placeholder="Message ${esc(a.name)}..." aria-label="Message ${esc(a.name)}"></textarea>
     <button class="ib send" id="sendBtn" type="button" aria-label="Send message" aria-disabled="true"><svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9h11M9.5 4.5L14 9l-4.5 4.5"/></svg></button></div>
    <p class="hint">Enter sends, Shift+Enter adds a line. Drop or paste images to attach. Sample only.</p></div>
   <div class="drop-ov" id="dropOv" aria-hidden="true"><div>Drop to attach<small>Up to 5 files, 10 MB each. Images: PNG, JPEG, GIF, WebP, BMP.</small></div></div></div>`;
  renderStrip(); const sl=$('stripList'); if(sl)sl.scrollLeft=stripScroll;
  const chat=getChat(a); $('chat').appendChild(chat.el);
  updatePanelHeader(); renderGrants();
  const chatEl=$('chat'); chatEl.dataset.pin='1'; chatEl.scrollTop=1e6;
  chatEl.onscroll=()=>{chatEl.dataset.pin=(chatEl.scrollHeight-chatEl.scrollTop-chatEl.clientHeight<80)?'1':'0';};
  $('panel').querySelector('.panel-in').classList.toggle('ro',!!(a.live&&a.parent));
  $('backBtn').onclick=closePanel;
  $('vscodeBtn').onclick=()=>a.live?openLive(a):toast('Would run <code>code '+esc(room.path)+'</code>',3800);
  if(a.live)$('pauseBtn').hidden=true;
  if($('newSessBtn'))$('newSessBtn').onclick=()=>newSession(a);
  if($('toolsHdrBtn'))$('toolsHdrBtn').onclick=()=>window.DurbarScreens.openTools(liveRoot(a).id);
  if($('mcpBtn'))$('mcpBtn').onclick=()=>window.DurbarScreens.agentMcp(liveRoot(a),{toggle:feat(liveRoot(a),'mcpToggle')});
  if($('endBtn'))$('endBtn').onclick=()=>endLive(a);
  if($('rmSessBtn'))$('rmSessBtn').onclick=()=>removeSessionUi(a);
  if($('rmFolderBtn'))$('rmFolderBtn').onclick=()=>removeFolder(room); /* spec 006 FR-022: the only session of the folder */
  if($('copyResBtn'))$('copyResBtn').onclick=()=>copyResume(a);
  if(a.live&&!a.parent)initPrev(a); else {const pv=$('prev');if(pv)pv.hidden=true;}
  if(a.live&&!a.parent&&a.info&&a.info.resumeLast&&bridge.wake)wakeLast(a);
  $('pauseBtn').onclick=()=>{a.paused=!a.paused;if(a.live&&bridge.setPaused)bridge.setPaused(a.id,a.paused);toast(esc(a.name)+(a.paused?' paused.':' resumed.'));renderAll();};
  if($('stopBtn'))$('stopBtn').onclick=()=>{if(a.live)return stopLive(a);a.paused=false;a.state='idle';a.label='Stopped';a.task='Stopped by you. Ready for a new task.';toast(esc(a.name)+' stopped.');renderAll();};
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
  $('grants').onclick=e=>{const b=e.target.closest('[data-revoke]');if(b){const r=liveRoot(byId(ui.selected));bridge.revokeGrant(r.id,b.dataset.revoke);}};
  $('attached').onclick=e=>{const b=e.target.closest('[data-rm]');if(b){attached.splice(+b.dataset.rm,1);renderAttached();setSend();attNotice([]);}};
  const input=$('msgInput');
  input.addEventListener('input',autoGrow);
  input.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendMessage(input.value);}});
  $('sendBtn').onclick=()=>{if($('sendBtn').getAttribute('aria-disabled')!=='true')sendMessage(input.value);};
  if(a.live){const h=document.querySelector('#panel .hint');if(h)h.textContent='Enter sends, Shift+Enter adds a line. Drop or paste images to attach. '+(SIM?'Simulated session (no AI credits)':'Live '+kindWord(liveRoot(a).info&&liveRoot(a).info.adapterId)+' session')+' ('+MODE_NAME[a.info.permMode]+').';}
  setSend();
  renderAll(); const cur=document.querySelector('#stripList .sitem.sel'); if(cur)cur.scrollIntoView({inline:'nearest',block:'nearest'});
  if(focus!==false)$('panelTitle').focus({preventScroll:true});
}
function closePanel(){
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
    const done=()=>{cp.textContent='Copied';setTimeout(()=>{cp.textContent='Copy';},1400);};
    if(navigator.clipboard&&navigator.clipboard.writeText)navigator.clipboard.writeText(txt).then(done,()=>toast('Could not copy.'));else{const ta=document.createElement('textarea');ta.value=txt;document.body.appendChild(ta);ta.select();try{document.execCommand('copy');done();}catch(_){toast('Could not copy.');}ta.remove();}
    return;}
  const so=e.target.closest('.sub-open');
  if(so){const blk=so.closest('.subblk'),id=blk&&blk.dataset.sub,par=ui.selected&&byId(ui.selected),card=par&&liveById(par.id+':'+id);if(card)openPanel(card.id,false);return;}
  const pc=e.target.closest('[data-parentchat]');
  if(pc){const cur=byId(ui.selected);if(cur&&cur.parent)openPanel(cur.parent,false);return;}
  const dr=e.target.closest('[data-door]'); if(dr){const r=ROOMS.find(x=>x.id===dr.dataset.door);if(r)setRoomClosed(r,!r.closed);return;}
  if(e.target.closest('#closeAll,#openAll')){const shut=!!e.target.closest('#closeAll');
    ROOMS.filter(r=>roomShown(r)&&(ui.ws==='all'||ui.ws===r.id)&&agents.some(a=>!a.parent&&a.room===r.id)).forEach(r=>setRoomClosed(r,shut,true));
    layoutKey='';renderAll();return;}
  const st=e.target.closest('.stat[data-k]'); if(st){const k=st.dataset.k;ui.status=ui.status===k?null:k;renderAll();const n=document.querySelector(`.stat[data-k="${k}"]`);if(n)n.focus();return;}
  const mo=e.target.closest('[data-more]'); if(mo){const id=mo.dataset.more;ui.expanded[id]=!ui.expanded[id];renderAll();return;}
  const cm=e.target.closest('.chips-more'); if(cm){const box=cm.parentNode;box.dataset.exp=box.dataset.exp==='1'?'0':'1';refreshChips(box);return;}
  const chip=e.target.closest('#chat .chip:not(.att-chip)'); if(chip){const o=chip.classList.toggle('open');chip.setAttribute('aria-expanded',String(o));return;}
  const sw=e.target.closest('[data-sw]'); if(sw){openPanel(sw.dataset.sw,e.detail===0);return;}
  const mr=e.target.closest('[data-mcproom]'); if(mr){const f=folderOfRoom(mr.dataset.mcproom);if(f)window.DurbarScreens.folderMcp(f.key,f.name);return;}
  const fm=e.target.closest('[data-foldermenu]'); if(fm){const r=ROOMS.find(x=>x.id===fm.dataset.foldermenu),b=fm.getBoundingClientRect();openFolderMenu(r,b.left,b.bottom+4,fm);return;}
  const ns=e.target.closest('[data-newsess]'); if(ns){const r=ROOMS.find(x=>x.id===ns.dataset.newsess),ag=r&&agents.find(x=>!x.parent&&x.room===r.id);if(ag)newSession(ag);return;}
  const t=e.target.closest('[data-id]'); if(t&&!t.closest('#panel')){openPanel(t.dataset.id,e.detail===0);}
});
/* a file dropped anywhere else must not navigate the window away */
['dragover','drop'].forEach(t=>window.addEventListener(t,e=>{if(e.dataTransfer&&[...(e.dataTransfer.types||[])].includes('Files'))e.preventDefault();}));
document.addEventListener('keydown',e=>{
  if(e.key==='Escape'){
    if(window.DurbarScreens&&window.DurbarScreens.isOpen()&&!document.getElementById('scrDlg')&&!document.getElementById('modeDlg')){window.DurbarScreens.close();return;}
    if(document.getElementById('sessDlg')){closeSessDlg();return;}
    if(!$('foldersPop').hidden){toggleFolders(false);return;}
    if(!$('floorsPop').hidden){toggleFloors(false);return;}
    if(vsViewing){leaveVsView();return;}
    if(ui.selected){closePanel();return;}
  }
  if((e.key==='Enter'||e.key===' ')&&e.target.matches&&e.target.matches('#chat .chip:not(.att-chip)')){e.preventDefault();e.target.click();}
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
const sim = SIM && window.__durbarSim ? window.__durbarSim.create({n:SIM, freeze:qs.get('simfreeze')==='1', titles:qs.get('simtitles')==='1', question:qs.get('simquestion')==='1', solo:qs.get('simrooms')==='solo', unreported:qs.get('simunreported')||undefined, waitOld:qs.get('simwaitold')==='1', seedTotals:qs.get('simtotals')==='1', seed:parseInt(qs.get('seed')||'7',10), floors:qs.get('simfloors')==='1', floorsOff:(qs.get('floorsoff')||'').split(',').map(x=>x.trim()).filter(Boolean)}) : null;
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
let renderQueued=false;
function scheduleRender(){if(renderQueued)return;renderQueued=true;requestAnimationFrame(()=>{renderQueued=false;renderAll();});}
function setBadge(){const b=$('protoBadge'); if(!b)return; b.className='proto'+(SIM&&!demoOn?' sim':'');
  /* spec 001 FR-027: not one harness; the tooltip names the ready ones */
  const ready=DMK().kindChoices(KINDS).filter(k=>!k.disabled).map(k=>k.name);
  b.title=SIM&&!demoOn?'Fake events, no sessions started, no AI credits used':(!demoOn&&ready.length?'Live: '+ready.join(', '):'');b.textContent=demoOn?'Prototype - sample data':SIM?'Simulated agents':'Live';}
function applyMode(){
  agents=demoOn?DEMO.agents:LIVE.agents; ROOMS=demoOn?DEMO.rooms:LIVE.rooms;
  ui.ws='all'; ui.status=null;
  if(ui.selected)closePanel();
  setBadge(); renderFloorsBtn(); renderIntoFloor(); renderFilter(); renderAll();
}
function liveChat(a){
  if(chats[a.id])return chats[a.id];
  const el=document.createElement('div');el.className='chat-inner';
  const chat=chats[a.id]={el,busy:false};
  if(a.sub)buildSubTranscript(a,chat);
  return chat;
}
function addNote(chat,html,err){const n=document.createElement('div');n.className='note'+(err?' err':'');n.innerHTML=html;chat.el.appendChild(n);scrollChat(chat);return n;}
const MODE_NAME={'read-only':'Read-only','ask':'Ask first','allow':'Allow all'};
const MODE_TEXT={'read-only':'read-only','allow':'no prompts','ask':'asks first'};
const MODE_HELP={'read-only':'Reads only. Edits, commands and other changes are denied.','ask':'Asks before every edit or command. You can approve for the rest of the session.','allow':'Everything runs without asking: edits, shell commands, web requests and tools.'};
/* spec 012 FR-123: the agent kind's own name in agent-facing text; Copilot's wording is unchanged */
const KIND_WORD={copilot:'Copilot',claude:'Claude Code',codex:'Codex'};
const kindWord=id=>{const k=id||'copilot';if(KIND_WORD[k])return KIND_WORD[k];const d=(KINDS||[]).find(x=>x.id===k);return d&&d.displayName?d.displayName:k;};
const RESUME_CMD={copilot:id=>'copilot --resume '+id,claude:id=>'claude --resume '+id}; /* kinds with a terminal resume command */
const resumeCmdOf=a=>{const r=liveRoot(a),f=r&&RESUME_CMD[(r.info&&r.info.adapterId)||'copilot'];return f?f(r.id):'';};
const roleFor=info=>kindWord(info.adapterId)+' ('+MODE_TEXT[info.permMode]+')'+(info.model&&info.model!=='auto'?' · '+info.model:'');
const MODE_IC={
 'read-only':'<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3.2" y="7" width="9.6" height="6.6" rx="1.6"/><path d="M5.4 7V5.4a2.6 2.6 0 0 1 5.2 0V7"/></svg>',
 'ask':'<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 1.8l5 1.8v3.8c0 3-2.1 5.2-5 6.6-2.9-1.4-5-3.6-5-6.6V3.6z"/><path d="M6.2 7.8l1.4 1.4 2.4-2.6"/></svg>',
 'allow':'<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"><path d="M2.5 13.5l.7-3L11 2.7a1.4 1.4 0 0 1 2 2L5.5 12.8z"/></svg>'};
const modeIcon=a=>a&&a.live&&a.info&&!a.parent&&a.info.permMode?`<span class="modeic mode-${a.info.permMode}" title="${esc(MODE_NAME[a.info.permMode])}${a.info.permMode==='allow'&&a.info.permRestored?' (restored from your last run)':''}: ${esc(MODE_HELP[a.info.permMode])} (right-click for options)" aria-hidden="true">${MODE_IC[a.info.permMode]}</span>`:'';
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
  renderFilter(); renderFloorsPanel(); renderFloorsSettings(); scheduleRender();
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
   The top bar has no room for one more select at 1280x800, so + Folder / + Workspace only name it in their tooltip. */
let INTO=null;
const intoFloor=()=>{if(!floorsLive()||FLOORS.floors.length<2)return undefined;const f=(INTO&&FLOORS.floors.find(x=>x.id===INTO))||FLOORS.floors.find(x=>x.id===FLOORS.lastFloor)||FLOORS.floors[0];return f.id;};
function renderIntoFloor(){
  const n=intoFloor()&&floorById(intoFloor()).name;
  $('addFolder').title=n?'Add a folder to the floor "'+n+'" (change it in Floors)':'Add a folder';
  $('addWs').title=n?'Add a .code-workspace file to the floor "'+n+'" (change it in Floors)':'Add a .code-workspace file';
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
  if(w)parts.push(w+' waiting'); if(e)parts.push(e+' error'+(e===1?'':'s')); if(l)parts.push(l+' at credit limit');
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
        <button class="btn" type="button" data-fl="only" data-floor="${esc(f.id)}" title="Switch ${esc(f.name)} on and every other floor off" aria-label="Only ${esc(f.name)}">Only</button>
        <button class="btn" type="button" data-fl="rename" data-floor="${esc(f.id)}" aria-label="Rename ${esc(f.name)}">Rename</button>
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
      buttons:[{label:'Cancel',value:null},{label:'Delete floor',value:'ok',cls:'primary warn'}]});
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
  let room=LIVE.rooms.find(r=>r.path===info.cwd);
  if(!room){room={id:'r'+LIVE.rooms.length+':'+info.cwd,name:(info.label||info.roomName||info.name),folderName:(info.roomName||info.name),path:info.cwd,tint:TINTS[LIVE.rooms.length%4],floor:info.floor||'ground',hidden:!!info.hidden,closed:!!info.closed||CLOSED_Q.includes(info.roomName||info.name)};LIVE.rooms.push(room);}
  let name=info.name; const dup=LIVE.agents.filter(x=>!x.parent&&x.room===room.id&&x.baseName===info.name).length; if(dup)name=info.name+' #'+(dup+1);
  LIVE.agents.push({id:info.id,name:info.title||name,folderLabel:name,title:info.title,baseName:info.name,role:info.role||roleFor(info),room:room.id,state:'idle',label:info.lazy?'Not started':'Ready',task:info.lazy?(info.resumeLast?'Your last session here. It continues when you open it.':'Saved folder. A session starts with your first message.'):'Ready. Send a message to start.',
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
  if(el.closest('.msg.agent')&&!el.querySelector(':scope > .cp-msg'))el.appendChild(mk('cp-msg','Copy this reply'));
}
document.addEventListener('click',async e=>{
  const b=e.target.closest('.cp-btn');if(!b)return;
  e.stopPropagation();
  const text=b.classList.contains('cp-code')?((b.parentElement.querySelector('code')||b.parentElement).textContent||'').replace(/Copy$/,''):(b.closest('.bubble')||{})._raw||'';
  try{await navigator.clipboard.writeText(text);b.textContent='Copied';setTimeout(()=>{b.textContent='Copy';},1500);}
  catch{toast('Could not copy to the clipboard.',3000);}
});
function mdFlush(){const l=[...MDQ];MDQ.clear();l.forEach(mdPaint);}
let mdRaf=0;
function mdSet(el,raw,now){
  el._raw=raw;el.classList.add('md');
  if(now||REDUCED){mdPaint(el);return;}
  if(el._mdq)return; el._mdq=true; MDQ.add(el);
  if(!mdRaf)mdRaf=requestAnimationFrame(()=>{mdRaf=0;mdFlush();});
}
function stickyScroll(chat){const c=$('chat'); if(c&&chat.el.parentNode===c&&c.dataset.pin!=='0')c.scrollTop=c.scrollHeight;}

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
  if(!REDUCED&&b.body.scrollHeight>b.body.clientHeight)b.body.scrollTop=b.body.scrollHeight;
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
  if(e.final){T.bubble._acc=e.text||T.bubble._acc;mdSet(T.bubble,T.bubble._acc,true);T.bubble.classList.remove('caret');const out=T.bubble._acc;T.bubble=null;tScroll(T);return out;}
  T.bubble._acc+=e.delta;mdSet(T.bubble,T.bubble._acc);tScroll(T);return null;
}
function tIntent(T,txt){
  txt=SHORT(txt,160);if(!txt||T.intent===txt)return;T.intent=txt;
  const n=document.createElement('div');n.className='intent-line';n.textContent=txt;tAppend(T,n);tScroll(T);
}
function tTool(T,e){
  const box=tChips(T);
  if(e.phase==='start'){const label=toolLabel(e.args);const el=makeChip({tool:e.tool,label,res:'running',state:'run'});addChip(box,el);T.chipEls[e.callId]={el,tool:e.tool,label,box};}
  else{const c=T.chipEls[e.callId];if(c){const full=String(e.output||'');
    const el=makeChip({tool:c.tool||e.tool,label:c.label,res:SHORT(full||(e.phase==='complete'?'ok':'failed'),60),output:full.slice(0,2000),state:e.phase==='failed'?'failed':'ok'});
    c.el.replaceWith(el);c.el=el;refreshChips(c.box);}}
  tScroll(T);
}
/* end of a turn / sub-agent run: finish blocks; say honestly when the model sent no reasoning */
function tEnd(T,opts){
  mdFlush();
  if(T.think)tThinkEnd(T.think);
  if(T.bubble){T.bubble.classList.remove('caret');T.bubble=null;}
  if(T.typing){T.typing.remove();T.typing=null;}
  if(!T.thinkN&&opts&&opts.note&&T.tl.children.length&&!T.tl.querySelector('.nothink')){
    const n=document.createElement('div');n.className='nothink';
    n.textContent='This model does not send reasoning for this step. The tool timeline shows what it did.';
    n.title='Some turns (often plain tool use or delegation) come back without any reasoning summary. Nothing is hidden by Agent Durbar.';
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
  v.T=makeT(host.querySelector('.tl'),chat);
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
    el.querySelector('.sub-task').textContent=s.status==='running'?SHORT(plainMd(s.task||s.prompt),90):SHORT(plainMd(s.result||s.lastFinal||s.error||s.task),110);
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
  else if(e.type==='output')setState(card,'working',null,e.final?SHORT(plainMd(e.text),100):undefined);
  else if(e.type==='toolCall'&&e.phase==='start'){const l=toolLabel(e.args);setState(card,'working',null,e.tool+(l?' '+SHORT(l,80):''));}
  else if(e.type==='status'&&e.intent)setState(card,'working',null,SHORT(e.intent,100));
  if(ui.selected===card.id)updatePanelHeader();
}
function onSubagent(a,e){
  const s=subRec(a,e.subagentId), card=s.card;
  if(e.name)s.name=e.name; if(e.model)s.model=e.model; if(e.agentName)s.agentName=e.agentName;
  if(e.task&&e.phase==='started')s.task=e.task;
  if(e.durationMs)s.durationMs=e.durationMs; if(e.totalTokens)s.tokens=e.totalTokens; if(e.totalToolCalls!=null)s.tools=Math.max(s.tools,e.totalToolCalls);
  card.name=s.name;card.role=s.agentName?'Helper · '+s.agentName:'Helper';
  if(e.phase==='started'){s.status='running';setState(card,'working',null,s.task||'Working');}
  else{
    s.t1=Date.now();
    if(e.phase==='failed'){s.status='failed';s.error=e.error||e.task||'Failed';setState(card,'error',null,SHORT(s.error,100));}
    else{s.status='done';setState(card,'done','Done',SHORT(plainMd(s.result||s.task),100));}
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
    if(g.agent_type&&!s.agentName)s.agentName=String(g.agent_type);
    if(s.name==='Sub-agent'&&s.task)s.name=SHORT(s.task,40);
  } else {
    if(e.phase==='complete'&&e.output)s.result=String(e.output);
    if(e.phase==='failed'){s.status='failed';s.error=String(e.output||'Failed');}
    else if(s.status==='running'){s.status='done';}
    s.views.forEach(v=>tEnd(v.T,{note:false}));
    if(s.card)setState(s.card,s.status==='failed'?'error':'done',s.status==='failed'?null:'Done',SHORT(plainMd(s.result||s.error||s.task),100));
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
  const T=makeT(m.querySelector('.tl'),chat);
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
  const ch=a.state!==state||(label!==undefined&&a.label!==label)||(task!==undefined&&a.task!==task);
  a.state=state; if(label!==undefined)a.label=label; if(task!==undefined)a.task=task;
  if(ch&&a.live&&a.info&&a.info.modelControl&&a.info.modelControl.compact&&!a.parent)updateCtxChip(a); /* the Compact button is greyed while the agent works */
  if(ch)scheduleRender();
}
const plainMd=t=>String(t==null?'':t).replace(/```[\s\S]*?```/g,' code ').replace(/!?\[([^\]]*)\]\([^)]*\)/g,'$1').replace(/^[#>\-*\s]+/gm,'').replace(/[*_`~]/g,'').replace(/\s+/g,' ').trim();
const SHORT=(v,n)=>{v=String(v==null?'':v).replace(/\s+/g,' ');return v.length>n?v.slice(0,n-1)+'…':v;};
function toolLabel(args){
  if(!args||typeof args!=='object')return '';
  const v=args.path||args.pattern||args.command||args.url||args.query||args.file_path||Object.values(args).find(x=>typeof x==='string')||'';
  return String(v).replace(/\s+/g,' ').slice(0,400);
}
/* ---------------- AI-credit cap: chip, dialog, limit reached (spec 011) ---------------- */
let APP_SETTINGS={};
function capChipHTML(a){
  if(!feat(a,'cap'))return ''; /* this agent kind has no credit cap: no chip (spec 012 FR-061) */
  const c=capOf(a),used=capUsed(a),pct=c?Math.min(100,Math.round(used/c*100)):0;
  const cls=!c?'unk':a.limit?'high':pct>=80?'warn':'ok';
  if(isUsdCap(a)){
    const t2=c?'$'+used.toFixed(2)+' / $'+c.toFixed(2):'No cap';
    const ti=c?'Cost cap: about $'+used.toFixed(2)+' of $'+c.toFixed(2)+' used by this session while Agent Durbar ran it ('+pct+'%). Claude\'s own estimate of the API price, not a bill; with a Claude subscription nothing is billed per token. Soft cap: one turn can go a little past it. Click to change or remove it.':'No cost cap for this session. Click to set one in dollars (Claude\'s estimate, min $0.01).';
    return `<button class="ctxchip capchip ${cls}" id="capChip" type="button" title="${esc(ti)}"><span class="bar" aria-hidden="true"><i style="width:${c?pct:0}%"></i></span><span>${esc(t2)}</span></button>`;
  }
  const text=c?used.toFixed(capDigits(c))+' / '+fmtCap(c)+' AIU':'No cap';
  const title=c?'Credit cap: '+used.toFixed(2)+' of '+fmtCap(c)+' AIU used by this session ('+pct+'%). AIU as reported by the Copilot runtime. Soft cap: checked after each model response, so one response can overshoot it. Click to change or remove it.':'No credit cap for this session. Click to set one (min 30 AIU, as reported by the Copilot runtime).';
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
  d.innerHTML=`<div class="dlg" role="dialog" aria-modal="true" aria-labelledby="cdT"><h3 id="cdT">${usd?'Cost':'Credit'} cap for ${esc(a.name)}</h3>
   ${usd?`<p class="dsub">The most this session may cost, in dollars of Claude's own estimate (not a bill; with a Claude subscription nothing is billed per token). When it is reached the agent stops and asks you. It is a <b>soft</b> cap: one turn can go a little past it. It counts what the session used while Agent Durbar ran it, and it is not saved with the folder. The minimum is $${MIN_USD_CAP}.</p>`
   :`<p class="dsub">The most AI credits this session may use (1 credit = USD 0.01; shown as AIU, the unit the Copilot runtime reports). When it is reached the agent stops and asks you. It is a <b>soft</b> cap: it is checked after each model response, so one response can go past it. The minimum is ${MIN_CAP}.</p>`}
   <label>${usd?'Cap ($, estimate)':'Cap (AIU)'}<input id="cdVal" type="number" min="${min}" step="${usd?'0.01':'1'}" placeholder="No cap" value="${cur||''}"></label>
   <p class="derr" id="cdErr" role="alert" hidden></p>
   <div class="dbtn"><button class="btn" id="cdCancel" type="button">Cancel</button><button class="btn" id="cdNone" type="button">Remove cap</button><button class="btn primary" id="cdSave" type="button">Save</button></div></div>`;
  document.body.appendChild(d);
  const apply=async v=>{
    const r=await bridge.setCap(a.id,v).catch(e=>({ok:false,error:String(e&&e.message||e)}));
    if(!r||!r.ok){const er=$('cdErr');er.textContent=(r&&r.error)||'Could not change the cap.';er.hidden=false;return;}
    a.info.maxAiCredits=r.maxAiCredits||undefined;a.usageText=usageLong(a);closeCapDlg();updateCapChip(a);updatePanelHeader();scheduleRender();
    toast(esc(a.name)+': '+(v===null?(usd?'no cost cap.':'no credit cap.'):(usd?'cost cap':'credit cap')+' <b>'+esc(fmtCapOf(a,v))+'</b>.'),3200);
  };
  $('cdCancel').onclick=closeCapDlg;$('cdNone').onclick=()=>apply(null);
  $('cdSave').onclick=()=>{const v=parseFloat($('cdVal').value);if(!(v>=min)||v>(usd?1e4:1e6)){const er=$('cdErr');er.textContent=usd?'Enter an amount from $'+MIN_USD_CAP+' to $10,000, or use Remove cap.':'Enter a number from '+MIN_CAP+' (the runtime minimum), or use Remove cap.';er.hidden=false;return;}apply(Math.round(v*100)/100);};
  d.addEventListener('click',e=>{if(e.target===d)closeCapDlg();});
  d.addEventListener('keydown',e=>{if(e.key==='Escape'){e.stopPropagation();closeCapDlg();}if(e.key==='Enter'&&e.target.id==='cdVal')$('cdSave').click();});
  $('cdVal').focus();
}
document.addEventListener('click',e=>{const c=e.target.closest('#capChip');if(!c)return;const a=byId(ui.selected);if(a)openCapDialog(liveRoot(a));});
/* The runtime reached the cap and waits for the user: inline notice with Add credits / Remove cap / Stop here. */
function showLimit(a,e){
  const t=ensureTurn(a);
  const usd=isUsdCap(a),max=e.maxAiCredits||capOf(a),used=e.usedAiCredits!=null?e.usedAiCredits:capUsed(a);
  const n=document.createElement('div');n.className='note perm limit';n.setAttribute('role','group');n.setAttribute('aria-label',usd?'Cost cap reached':'Credit limit reached');
  n.innerHTML=usd?'<b>Cost cap reached:</b> <span class="psum"></span><span class="pstate"></span>':'<b>Credit limit reached:</b> <span class="psum"></span><span class="pstate"></span>';
  n.querySelector('.psum').textContent=usd?'about $'+used.toFixed(2)+' of $'+(max||0).toFixed(2)+' (Claude\'s estimate). The agent waits for you.':'used '+used.toFixed(2)+' of '+fmtCap(max)+' AIU. The agent waits for you.';
  const row=document.createElement('div');row.className='note-actions';
  const amt=document.createElement('input');amt.type='number';amt.min='0.01';amt.step=usd?'0.01':'1';amt.value=String(max||(usd?MIN_USD_CAP:MIN_CAP));amt.className='limit-amt';amt.setAttribute('aria-label',usd?'Dollars to add to the cap':'AIU to add to the cap');
  const mk=(l,cls,title,fn)=>{const b=document.createElement('button');b.type='button';b.className='btn '+cls;b.textContent=l;if(title)b.title=title;b.onclick=fn;row.appendChild(b);return b;};
  const answer=async choice=>{
    const r=await bridge.resolveLimit(a.id,e.requestId,choice).catch(err=>({ok:false,error:String(err&&err.message||err)}));
    if(!r||!r.ok){addNote(liveChat(a),'Could not answer the credit limit: '+esc((r&&r.error)||'unknown error'),true);return;}
    settleLimit(a,choice.kind);
  };
  row.appendChild(amt);
  mk(usd?'Raise cap':'Add credits','primary',usd?'Let the agent use this many more dollars (counted from what it used or the cap, whichever is higher) and continue':'Raise the cap by this many AIU and let the agent continue',()=>{const v=parseFloat(amt.value);if(!(v>0)){amt.focus();return;}answer({kind:'add',credits:Math.round(v*100)/100});});
  mk('Remove cap','session','Remove the cap and let the agent continue',()=>answer({kind:'unset'}));
  mk('Stop here','danger','Cancel the blocked request. The agent is ready for your next message (the cap stays).',()=>answer({kind:'cancel'}));
  n.appendChild(row);
  a.limit={requestId:e.requestId,n,row,st:n.querySelector('.pstate')};
  tChips(t.T).appendChild(n);scrollChat(liveChat(a));
}
/* ---------- questions from the agent (spec 012 FR-130): options as buttons, "Other" text, Answer / Skip; text only, never HTML ---------- */
function showQuestion(a,e){
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
      b.textContent=o.label;if(o.description)b.title=o.description;
      b.onclick=()=>{const s=picks[i];if(q.multiSelect){s.has(o.label)?s.delete(o.label):s.add(o.label);b.setAttribute('aria-pressed',String(s.has(o.label)));b.classList.toggle('primary',s.has(o.label));}
        else{s.clear();s.add(o.label);opts.querySelectorAll('.q-opt').forEach(x=>{x.setAttribute('aria-checked',String(x===b));x.classList.toggle('primary',x===b);});others[i].value='';}};
      opts.appendChild(b);});
    const other=document.createElement('input');other.type='text';other.maxLength=500;other.className='q-other';other.placeholder='Other answer';other.setAttribute('aria-label','Other answer: '+q.question);
    other.oninput=()=>{if(other.value.trim()&&!q.multiSelect){picks[i].clear();opts.querySelectorAll('.q-opt').forEach(x=>{x.setAttribute('aria-checked','false');x.classList.remove('primary');});}};
    others.push(other);opts.appendChild(other);box.appendChild(opts);n.appendChild(box);
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
  tChips(t.T).appendChild(n);scrollChat(liveChat(a));
}
function settleQuestion(a,answers){
  const Q=a.question;if(!Q)return;a.question=null;
  if(Q.row)Q.row.remove();Q.n.querySelectorAll('.q-opts').forEach(x=>x.remove());
  Q.st.textContent=answers?' → answered: '+Object.values(answers).join('; '):' → skipped';
  Q.n.classList.add('settled',answers?'approved':'denied');
  if(a.state==='waiting')setState(a,'working',null,answers?'Answered':'Question skipped'); /* a Stop already set it idle */
  updatePanelHeader();scrollChat(liveChat(a));
}
function settleLimit(a,action){
  const L=a.limit;if(!L)return;a.limit=null;
  if(L.row)L.row.remove();
  const word=action==='cancel'?'stopped here':action==='unset'?'cap removed':isUsdCap(a)?'cap raised':'credits added';
  L.st.textContent=' → '+word;L.n.classList.add('settled',action==='cancel'?'denied':'approved');
  const what=isUsdCap(a)?'the cost cap':'the credit limit';
  if(action==='cancel'){closeTurn(a);a.worked=false;setState(a,'idle','Ready','Stopped at '+what+'. Ready for your next message.');}
  else setState(a,'working',null,'Continuing after '+what);
  updateCapChip(a);scrollChat(liveChat(a));
}
/* ---------- permissions: inline note in the tool timeline, Approve / Approve for this session / Deny, revocable chips ---------- */
function showPerm(a,p){
  const t=ensureTurn(a);
  const n=document.createElement('div');n.className='note perm';n.setAttribute('role','group');n.setAttribute('aria-label','Permission request');
  n.innerHTML='<b>Permission:</b> <span class="psum"></span><span class="pstate"></span>';
  n.querySelector('.psum').textContent=p.summary;
  const st=n.querySelector('.pstate');
  if(p.state==='denied')st.innerHTML=' <i>(denied: read-only mode; add the folder in Ask mode to allow edits)</i>';
  else if(p.state==='pending'){
    const row=document.createElement('div');row.className='note-actions';
    const mk=(l,cls,title,fn)=>{const b=document.createElement('button');b.type='button';b.className='btn '+cls;b.textContent=l;if(title)b.title=title;b.onclick=fn;row.appendChild(b);};
    const answer=(approve,remember,broad)=>{bridge.resolvePermission(a.id,p.requestId,approve,remember,!!broad);settlePerm(a,{requestId:p.requestId,state:approve?'approved':'denied',via:'user',remembered:approve&&remember,scopeLabel:broad?p.broadScopeLabel:p.scopeLabel,summary:p.summary});};
    mk('Approve','primary','Allow this one request',()=>answer(true,false));
    if(p.scopeKey)mk('Approve for this session','session','Allow "'+(p.scopeLabel||p.kind)+'" until you stop this session'+(p.kind==='shell'?' (this exact command only)':'')+'. Shown as a chip you can revoke.',()=>answer(true,true));
    if(p.broadScopeKey)mk('Approve for session: any arguments','session','Allow every simple "'+(p.broadScopeLabel||p.kind)+'" command (no pipes, redirects or substitutions) until you stop this session. Wider than the exact command above; shown as a chip you can revoke.',()=>answer(true,true,true));
    mk('Deny','danger','Deny this request',()=>answer(false,false));
    n.appendChild(row);
    a.pend.set(p.requestId,{n,row,st});
  }
  tChips(t.T).appendChild(n);scrollChat(liveChat(a));
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
  const word=p.state==='approved'?'approved':'denied';
  const why=p.via==='stopped'?' (session stopped)':p.via==='session'?' (allowed for this session)':p.remembered?' (and remembered for this session)':'';
  e.st.textContent=' → '+word+why;
  e.n.classList.add('settled',word);
  scrollChat(liveChat(a));
}
function setGrants(a,list){a.grants=list;if(ui.selected&&liveRoot(byId(ui.selected)||a)===a)renderGrants();}
function renderGrants(){
  const box=$('grants'),a0=byId(ui.selected);if(!box||!a0)return;const a=liveRoot(a0);
  box.innerHTML=(a.grants||[]).map(g=>`<span class="gchip" title="Allowed for this session: ${esc(g.label)}. Revoke to be asked again."><span>Allowed: ${esc(g.label)}</span><button type="button" data-revoke="${esc(g.key)}" aria-label="Revoke permission: ${esc(g.label)}">${ICON('x')}</button></span>`).join('');
  box.hidden=!(a.grants||[]).length;
}
/* ---------------- tool usage, models and context window (spec 019) ---------------- */
const STATS=window.DurbarStats.createStats();
let statsRefresh=0;
function feedStats(a,e){
  /* sub-agent events are counted for the agent that owns them (a.id is the session) */
  if(e.type==='toolCall')STATS.recordTool(a.id,e);
  else if(e.type==='usage')STATS.recordModel(a.id,e.model);
  else if(e.type==='context'&&!e.agentId){STATS.setContext(a.id,e);if(a.ctxWaiting){a.ctxWaiting=false;}}
  else if(e.type==='mcp')a.mcp=e.servers;
  else return;
  if(e.type==='usage'||e.type==='context'||(e.type==='toolCall'&&e.phase==='start')){
    updateCtxChip(a);
    if(e.type==='context')maybeSuggestFresh(a);
    if(window.DurbarScreens.isOpen()&&!statsRefresh)statsRefresh=setTimeout(()=>{statsRefresh=0;window.DurbarScreens.refresh();},700);
  }
}
function ctxChipHTML(a){const c=window.DurbarScreens.ctxChip(a);
  return `<span class="ctxgrp" id="ctxGrp">${ctxChipBtn(a,c)}${compactBtnHTML(a)}</span>`;}
function ctxChipBtn(a,c){
  return `<button class="ctxchip ${c.cls}" id="ctxChip" type="button" title="${esc(c.title)} Click for models and context of all agents."><span class="bar" aria-hidden="true"><i style="width:${c.pct}%"></i></span><span>${esc(c.text)}</span></button>`;}
function updateCtxChip(a){
  const el=$('ctxGrp');if(!el||!ui.selected)return;const cur=byId(ui.selected);if(!cur||liveRoot(cur)!==a)return;
  const g=$('ctxGrp');if(g)g.outerHTML=ctxChipHTML(a);
}
/* A main agent's session title from the runtime (issue #126): shown instead of the folder name everywhere a.name is shown;
   the folder stays in the room header and in the tooltip. Sub-agents keep their own names. */
function applyTitle(a,title){
  if(typeof title!=='string'||!title||a.title===title)return;
  a.title=title; a.name=title;
  if(ui.selected===a.id){const h=document.getElementById('panelTitle');if(h){h.textContent=title;h.title=title+' · '+(a.folderLabel||a.baseName||'');}}
  scheduleRender();
}
function onLiveEvent(e){
  const a=liveById(e.sessionId); if(!a)return;
  feedStats(a,e);
  if(!e.agentId){ /* spec 034: only main-agent events change the mood */
    if(e.type==='toolCall')MOOD.onTool(a.id,e);
    else if(e.type==='status'){MOOD.onStatus(a.id,e.status);if(e.permission)MOOD.onPermission(a.id,e.permission,e.timestamp);} /* a pending request arrives inside a needs-permission status */
    else if(e.type==='permission')MOOD.onPermission(a.id,e.permission,e.timestamp);   /* its answer arrives as a permission event */
  }
  if(e.type==='toolCall'&&e.mcpServer&&SEEN_SERVERS.size<500)SEEN_SERVERS.add(String(e.mcpServer).trim().slice(0,200));
  if(!e.agentId){ /* spec 024: only main-agent events move anyone (helper events carry an agentId) */
    if(e.type==='toolCall'){if(VISITS.onTool(a.id,e,PLACE_MAP,customIds()))scheduleRender();}
    else if(e.type==='status'){if(VISITS.onStatus(a.id,e.status))scheduleRender();}
  }
  if(e.type==='title'){if(!e.agentId)applyTitle(a,e.title);return;}
  if(e.type==='subagent')return onSubagent(a,e);
  if(e.agentId&&e.type!=='permission'&&e.type!=='grants'&&e.type!=='limit')return onSubEvent(a,e);
  const chat=liveChat(a), main=true;
  switch(e.type){
  case 'user':{addUserMsg(chat,e.text,(e.attachments||[]).map(x=>({name:String(x.path).split(/[\\/]/).pop(),img:x.kind==='image',path:x.path})));return;}
  case 'status':
    if(!main)return;
    if(e.status==='working'){a.worked=true; const tt=ensureTurn(a); if(e.intent){a.intent=e.intent;if(!/^(Thinking|Approved|Allowed|Denied|Waiting for permission)/.test(e.intent))tIntent(tt.T,e.intent);}
      if(a.state!=='working'&&a.state!=='thinking')setState(a,'working',null,e.intent||a.task); else if(e.intent)setState(a,a.state,undefined,e.intent);}
    else if(e.status==='needs-permission'){
      ensureTurn(a); setState(a,'waiting',null,e.intent||'Waiting for permission');
      if(e.permission)showPerm(a,e.permission);
    }
    else if(e.status==='idle'&&e.intent==='Aborted'){if(a.limit)settleLimit(a,'cancel');if(a.question)settleQuestion(a,null);if(a.pendingProfile){const n=a.pendingProfile.name;a.pendingProfile=undefined;updateAgentChip(a);addNote(chat,'The waiting switch to the agent '+esc(n)+' was dropped when you stopped the reply.');}const was=a.worked;a.worked=false;closeTurn(a);
      [...a.pend.keys()].forEach(id=>settlePerm(a,{requestId:id,state:'denied',via:'stopped'}));
      if(was)addNote(chat,'Stopped by you. The agent is ready for your next message.');
      /* real:(spec 030 T042) the runtime drops a switch that was still queued when the turn is stopped: say so, never leave "Next: ..." behind */
      if(a.pendingModel){const nm=a.pendingModel.name;a.pendingModel=undefined;updateModelChip(a);addNote(chat,'The queued switch to '+esc(nm)+' was dropped when you stopped the reply. Choose it again if you still want it.');}
      setState(a,'idle','Ready','Stopped. Ready for your next message.');}
    else if(e.status==='idle'){const was=a.worked;a.worked=false;closeTurn(a);if(a.pendingProfile){const p=a.pendingProfile;a.pendingProfile=undefined;applyProfile(a,p);}
      if(was)setState(a,'done','Done',a.lastOutput?SHORT(plainMd(a.lastOutput),140):'Finished.'); else setState(a,'idle','Ready',a.task);
      updateCtxChip(a);maybeSuggestFresh(a);
      /* a queued switch applies when the turn ends (its model event follows at once); if none came, do not leave "Next: ..." standing */
      if(a.pendingModel){const p=a.pendingModel;setTimeout(()=>{if(a.pendingModel===p){a.pendingModel=undefined;updateModelChip(a);}},2000);}}
    else if(e.status==='error'){closeTurn(a);addNote(chat,esc(e.intent||'Error'),true);setState(a,'error',null,SHORT(e.intent||'Error',140));}
    else if(e.status==='stopped'){
      if(a.limit)settleLimit(a,'cancel');
      /* a permission still pending when the session stops is denied cleanly: no Approve/Deny left behind, grants gone */
      [...a.pend.keys()].forEach(id=>settlePerm(a,{requestId:id,state:'denied',via:'stopped'}));
      setGrants(a,[]);
      closeTurn(a);setState(a,'idle','Ended','Session ended. Send a message to resume it.');}
    return;
  case 'permission':if(main)settlePerm(a,e.permission);return;
  case 'grants':setGrants(a,e.grants||[]);return;
  case 'limit':
    if(e.phase==='changed'){a.info.maxAiCredits=e.maxAiCredits>0?e.maxAiCredits:undefined;a.usageText=usageLong(a);updateCapChip(a);updatePanelHeader();scheduleRender();}
    else if(e.phase==='exhausted'){if(a.limit&&a.limit.requestId===e.requestId)return;showLimit(a,e);setState(a,'waiting','Limit reached',(isUsdCap(a)?'Cost cap reached: ':'Credit limit reached: ')+fmtCapOf(a,e.maxAiCredits||0));updateCapChip(a);}
    else if(e.phase==='resolved'){if(a.limit&&a.limit.requestId===e.requestId)settleLimit(a,e.action||'add');}
    return;
  case 'question': /* spec 012 FR-130 */
    if(e.phase==='asked'){if(a.question&&a.question.requestId===e.requestId)return;showQuestion(a,e);setState(a,'waiting','Waiting for your answer','The agent asks you a question');updatePanelHeader();scheduleRender();}
    else if(a.question&&a.question.requestId===e.requestId)settleQuestion(a,e.phase==='answered'?e.answers:null);
    return;
  case 'agentProfile':{ /* spec 043: the session's custom agent; details from the last list when the event has none */
    const p=e.profile?Object.assign({},(a.profileList||[]).find(x=>x.id===e.profile.id)||{},e.profile.source==='other'&&(a.profileList||[]).some(x=>x.id===e.profile.id)?{}:e.profile):null;
    if(p&&a.profileList){const known=a.profileList.find(x=>x.id===p.id);if(known)Object.assign(p,{source:known.source,description:known.description,path:known.path});}
    a.profile=p;updateAgentChip(a);scheduleRender();return;}
  case 'model':onModelEvent(a,e);return;
  case 'compaction':onCompaction(a,e);return;
  case 'thinking':{const t=ensureTurn(a);tThink(t.T,e.reasoningId,e.delta);setState(a,'thinking',null);return;}
  case 'output':{const t=ensureTurn(a);const out=tText(t.T,e);if(out!=null)a.lastOutput=out;setState(a,'working',null);return;}
  case 'toolCall':{const t=ensureTurn(a);
    if(isTaskTool(e.tool)||(t.T.chipEls[e.callId]===undefined&&a.subs&&a.subs.has(e.callId)))onTaskTool(a,e);
    else tTool(t.T,e);
    if(e.phase==='start'&&!isTaskTool(e.tool)){const label=toolLabel(e.args);setState(a,a.state==='thinking'?'working':a.state,null,a.intent||(e.tool+(label?' '+SHORT(label,90):'')));}
    scrollChat(chat);return;}
  case 'usage':{const u=a.usage;u.calls++;u.inT+=e.inputTokens||0;u.outT+=e.outputTokens||0;u.nano+=e.nanoAiu||0;u.usd=(u.usd||0)+(e.costUsd>0?e.costUsd:0);
    a.usageText=usageLong(a);recordUsage(a,e);scheduleRender();
    if(ui.selected===a.id||(byId(ui.selected)||{}).parent===a.id)updatePanelHeader();return;}
  }
}
async function sendLive(text,forId){
  const a0=byId(forId||ui.selected); if(!a0)return; const a=liveRoot(a0);
  text=(text||'').trim(); if(!text&&!attached.length)return;
  a.sent=true;
  const chat=liveChat(a), atts=attached.slice();
  addUserMsg(chat,text||'(attachment)',atts);
  attached=[];renderAttached();attNotice([]);
  const input=$('msgInput');if(input){input.value='';autoGrow();}
  a.worked=true; a.intent=''; closeTurn(a); ensureTurn(a); setState(a,'thinking',null,'Thinking');
  const r=await bridge.send(a.id,text||'Please look at the attached file(s).',atts.map(x=>({path:x.path,name:x.name,kind:x.kind})));
  if(!r.ok){closeTurn(a);addNote(chat,'Send failed: '+esc(r.error||'unknown error'),true);setState(a,'error',null,'Send failed: '+SHORT(r.error,100));}
}
async function pickLive(want){addPicked(await bridge.pickAttachments(want));}
async function openLive(a){
  const r=await bridge.openInVSCode(liveRoot(a).id);
  toast(r.ok?'Opening in '+esc(r.edition||'VS Code')+'…':'Could not open VS Code: '+esc(r.error||'unknown error'),4200);
}
async function stopLive(a){const r=liveRoot(a);await bridge.stop(r.id);toast(esc(r.name)+': stopped the current turn. It is ready for your next message.');}
async function endLive(a){const r=liveRoot(a);await (bridge.end||bridge.stop)(r.id);toast(esc(r.name)+': session ended. Sending a message resumes it.',4200);}
async function copyResume(a){const r=liveRoot(a),cmd=resumeCmdOf(r); if(!cmd)return;
  try{await navigator.clipboard.writeText(cmd);toast('Copied <code>'+esc(cmd)+'</code>. End the session here first, then run it in a terminal in '+esc(roomOf(r).path)+'. In VS Code, turn on the sessions list filter External to see sessions started here.',9000);}
  catch{toast('Run <code>'+esc(cmd)+'</code> in a terminal in '+esc(roomOf(r).path)+' (end the session here first).',8000);}}
/* ---------------- full-screen chat: the strip of all agents ---------------- */
function stripAgents(){
  return agents.filter(x=>!x.parent&&roomShown(roomOf(x))).map((x,i)=>[x,i]).sort((p,q)=>prio(p[0])-prio(q[0])||p[1]-q[1]).map(p=>p[0]);
}
function renderStrip(){
  const box=$('stripList'); if(!box)return;
  const cur=byId(ui.selected), root=cur?(cur.parent||cur.id):null;
  morphHTML(box,stripAgents().map(x=>{const st=vis(x),attn=st==='waiting'||st==='error';
    return `<button class="sitem st-${st}${attn?' attn':''}${x.id===root?' sel':''}" type="button" data-sw="${esc(x.id)}" data-key="sw:${esc(x.id)}" aria-current="${x.id===root}" title="${esc(x.name)} · ${esc(label(x,true))}: ${esc(x.task)}" aria-label="${esc(x.name)}, ${esc(label(x,true))}. Open chat."><span class="sav">${avatar(x)}</span><span class="stx"><b>${esc(x.name)}</b><span class="sst"><span class="dot ${st}"></span><span class="sw">${esc(label(x,true))}</span><span class="sin">${esc(SHORT(x.task,48))}</span></span></span></button>`;}).join(''));
}


/* ---------------- permission mode: change it at any time (spec 018) ---------------- */
function modeChipHTML(a){const m=a.info.permMode, rs=m==='allow'&&a.info.permRestored;
  if(!feat(a,'modes'))return `<span class="modechip" title="Set when the session starts">${esc(MODE_NAME[m])}</span>`;
  return `<button class="mode-chip mode-${m}" id="modeChip" type="button" aria-haspopup="menu" aria-expanded="false" title="Permission mode: ${esc(MODE_NAME[m])}. ${esc(MODE_HELP[m])}${rs?' Restored from your last run.':''} Click to change; it applies from the next request."><span class="mi">${MODE_IC[m]}</span><span>${esc(MODE_NAME[m])}</span>${rs?'<span class="mode-restored">restored</span>':''}${ICON('chev')}</button>`;}
function closeModeMenu(){const m=document.getElementById('modeMenu');if(m){m.remove();const c=$('modeChip');if(c)c.setAttribute('aria-expanded','false');}}
function openModeMenu(a0,x,y,anchor){
  const a=liveRoot(a0); if(!a||!a.live||!bridge.setPermMode||!feat(a,'modes'))return;
  closeModeMenu();
  const m=document.createElement('div');m.id='modeMenu';m.className='mode-menu';m.setAttribute('role','menu');m.setAttribute('aria-label','Permission mode for '+a.name);
  m.innerHTML=['read-only','ask','allow'].filter(k=>feat(a,'modeList',k)).map(k=>`<button type="button" role="menuitemradio" aria-checked="${a.info.permMode===k}" data-mode="${k}" class="mm-${k}"><span class="mi">${MODE_IC[k]}</span><span class="mt"><b>${MODE_NAME[k]}</b><small>${esc(MODE_HELP[k])}</small></span><span class="ck">${a.info.permMode===k?'✓':''}</span></button>`).join('')+(bridge.setModel&&a.info?`<button type="button" role="menuitem" data-act="model" class="mm-model"><span class="mt"><b>Model and context…</b><small>${esc(modelLabel(a.info).text)}</small></span></button>`:'')+`<p class="mm-note">Applies from the next request. The session keeps running.</p>`;
  document.body.appendChild(m);
  const r=m.getBoundingClientRect(); const px=Math.max(8,Math.min(x,innerWidth-r.width-8)), py=Math.max(8,Math.min(y,innerHeight-r.height-8));
  m.style.left=px+'px';m.style.top=py+'px';
  m.addEventListener('click',e=>{const g=e.target.closest('[data-act="model"]');if(g){closeModeMenu();openModelMenu(a,px,py,anchor);return;}const b=e.target.closest('[data-mode]');if(!b)return;closeModeMenu();changeMode(a,b.dataset.mode,anchor);});
  m.addEventListener('keydown',e=>{const it=[...m.querySelectorAll('[data-mode],[data-act]')],i=it.indexOf(document.activeElement);
    if(e.key==='ArrowDown'){e.preventDefault();it[(i+1)%it.length].focus();}else if(e.key==='ArrowUp'){e.preventDefault();it[(i+it.length-1)%it.length].focus();}
    else if(e.key==='Escape'||e.key==='Tab'){e.preventDefault();e.stopPropagation();closeModeMenu();if(anchor&&anchor.focus&&document.contains(anchor))anchor.focus();}});
  (m.querySelector('[aria-checked="true"]')||m.querySelector('button')).focus();
  const c=$('modeChip');if(c&&anchor===c)c.setAttribute('aria-expanded','true');
}
/* small modal: returns {value, checked} or null when dismissed. Focus trap, Escape and focus return live in dialog.js (spec 003 FR-033). */
const askDialog=DurbarDialog(document);
/* after a mode change the chip is re-rendered; put focus back on it (or the card it was opened from) unless the user moved it on */
function refocusAnchor(anchor){
  const ae=document.activeElement;if(ae&&ae!==document.body&&document.contains(ae))return;
  let t=anchor&&document.contains(anchor)?anchor:null;
  if(!t&&anchor&&(anchor.id==='modeChip'||anchor.id==='modelChip'||anchor.id==='compactBtn'))t=$(anchor.id);
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
      check:pend?{label:'Also approve the '+pend+' request'+(pend>1?'s':'')+' waiting now',checked:true}:null,returnFocus:anchor,
      buttons:[{label:'Cancel',value:null},{label:'Allow all',value:'ok',cls:'primary warn'}]});
    if(!r)return; opts.approvePending=!!r.checked;
  } else if(grants){
    const r=await askDialog({title:'Switch '+a.name+' to '+MODE_NAME[mode]+'?',body:'This session has '+grants+' remembered "Approve for this session" permission'+(grants>1?'s':'')+'. Keep them for when you switch back, or clear them now?',
      returnFocus:anchor,buttons:[{label:'Cancel',value:null},{label:'Switch, keep them',value:'keep'},{label:'Switch and clear them',value:'clear',cls:'primary'}]});
    if(!r)return; opts.clearGrants=r.value==='clear';
  }
  const res=await bridge.setPermMode(a.id,mode,opts).catch(e=>({ok:false,error:String(e&&e.message||e)}));
  if(!res||!res.ok){toast('Could not change the mode: '+esc((res&&res.error)||'unknown error'),5000);return;}
  a.info.permMode=mode; a.info.permRestored=undefined; a.role=roleFor(a.info);
  if(opts.clearGrants)setGrants(a,[]);
  toast(esc(a.name)+': <b>'+esc(MODE_NAME[mode])+(capsFor(a).permModeSwitch==='next-message'?'</b>. Applies from the next message.':'</b> from the next request.')+(mode==='allow'?' Everything runs without asking.':''),4200);
  if(ui.selected&&liveRoot(byId(ui.selected)||a)===a){const c=$('modeChip');if(c){c.outerHTML=modeChipHTML(a);}const h=document.querySelector('#panel .hint');if(h)h.textContent=h.textContent.replace(/\([^()]*\)\.?$/,'('+MODE_NAME[a.info.permMode]+').');updatePanelHeader();}
  scheduleRender();
}
document.addEventListener('click',e=>{
  const cc=e.target.closest('#ctxChip');
  if(cc){window.DurbarScreens.openTools(null,'agents');return;}
  const ac=e.target.closest('#agentChip');
  if(ac){e.stopPropagation();if(document.getElementById('agentMenu')){closeAgentMenu();return;}const r=ac.getBoundingClientRect(),a=byId(ui.selected);if(a)openAgentMenu(a,r.left,r.bottom+6,ac);return;}
  if(!e.target.closest('#agentMenu'))closeAgentMenu();
  const mc=e.target.closest('#modelChip');
  if(mc){e.stopPropagation();if(document.getElementById('modelMenu')){closeModelMenu();return;}const r=mc.getBoundingClientRect(),a=byId(ui.selected);if(a)openModelMenu(a,r.left,r.bottom+6,mc);return;}
  if(!e.target.closest('#modelMenu'))closeModelMenu();
  const cb=e.target.closest('#compactBtn');
  if(cb){e.stopPropagation();const a=byId(ui.selected);if(a)compactDialog(liveRoot(a),cb);return;}
  const chip=e.target.closest('#modeChip');
  if(chip){e.stopPropagation();if(document.getElementById('modeMenu')){closeModeMenu();return;}const r=chip.getBoundingClientRect(),a=byId(ui.selected);if(a)openModeMenu(a,r.left,r.bottom+6,chip);return;}
  if(!e.target.closest('#modeMenu'))closeModeMenu();
},true);
/* spec 006 FR-022: folder actions on a room's header (right-click, or the context-menu key on its door), same menu element as the mode menu */
function openFolderMenu(r,x,y,anchor){
  if(!r||demoOn||!bridge||!bridge.removeFolder)return;
  closeModeMenu();
  const m=document.createElement('div');m.id='modeMenu';m.className='mode-menu';m.setAttribute('role','menu');m.setAttribute('aria-label','Folder '+r.name);
  const it=(act,label,sub,cls)=>`<button type="button" role="menuitem" data-fact="${act}"${cls?` class="${cls}"`:''}><span class="mt"><b>${esc(label)}</b><small>${esc(sub)}</small></span></button>`;
  m.innerHTML=(bridge.newSession&&anyKindReady()?it('new','New session','Another agent with its own chat here'):'')
    +(bridge.renameFolder?it('rename','Rename…','A display name for this room'):'')
    +(bridge.setFolderHidden?it('hide','Hide','Out of the office; its sessions keep running'):'')
    +it('rm','Remove folder…','Ends its sessions; nothing on disk is deleted','mm-danger');
  document.body.appendChild(m);
  const b=m.getBoundingClientRect(); m.style.left=Math.max(8,Math.min(x,innerWidth-b.width-8))+'px'; m.style.top=Math.max(8,Math.min(y,innerHeight-b.height-8))+'px';
  m.addEventListener('click',e=>{const t=e.target.closest('[data-fact]');if(!t)return;closeModeMenu();const ag=agents.find(q=>!q.parent&&q.room===r.id);
    if(t.dataset.fact==='new'){if(ag)newSession(ag);}else if(t.dataset.fact==='rename')renameFolder(r,anchor);else if(t.dataset.fact==='hide')hideFolder(r,true);else removeFolder(r);});
  m.addEventListener('keydown',e=>{const its=[...m.querySelectorAll('[data-fact]')],i=its.indexOf(document.activeElement);
    if(e.key==='ArrowDown'){e.preventDefault();its[(i+1)%its.length].focus();}else if(e.key==='ArrowUp'){e.preventDefault();its[(i+its.length-1)%its.length].focus();}
    else if(e.key==='Escape'||e.key==='Tab'){e.preventDefault();e.stopPropagation();closeModeMenu();if(anchor&&anchor.focus&&document.contains(anchor))anchor.focus();}});
  m.querySelector('button').focus();
}
document.addEventListener('contextmenu',e=>{
  const h=e.target.closest('#stage .room-head');
  if(h&&!e.target.closest('.desk')){const door=h.querySelector('[data-door]'),r=door&&ROOMS.find(x=>x.id===door.dataset.door);
    if(r&&bridge&&bridge.removeFolder&&!demoOn){e.preventDefault();const b=h.getBoundingClientRect();openFolderMenu(r,e.clientX||b.left+16,e.clientY||b.bottom,door);return;}}
  const d=e.target.closest('.desk[data-id], .helper[data-id], .lrow[data-id]');if(!d||d.closest('#panel'))return;
  const a=byId(d.dataset.id),ra=a&&liveRoot(a);if(!ra||!ra.live||!bridge.setPermMode)return;
  e.preventDefault();const r=d.getBoundingClientRect();
  openModeMenu(ra,e.clientX||r.left+16,e.clientY||r.top+16,d);
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
  if(!bridge.listModels)return;
  const r=await bridge.listModels().catch(()=>null);
  if(!r||!r.ok||!r.models.length)return;
  MODELS=r.models;
  const ms=$('modelSel');
  fillModelSelect(ms,'auto','','Model: ');ms.dataset.kind='';
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
const PERM_LABEL={'read-only':'Read-only',ask:'Ask first',allow:'Allow all (no prompts)'};
/* Permissions select of a kind: only the modes it can enforce; a value it cannot hold falls back to read-only, never to a wider mode (spec 012 FR-067) */
function fillPermSelect(sel,caps){
  const modes=DMK().modesFor(caps),cur=sel.value;
  if([...sel.options].map(o=>o.value).join()!==modes.join())sel.innerHTML=modes.map(k=>`<option value="${k}">${PERM_LABEL[k]}</option>`).join('');
  sel.value=DMK().fallbackMode(caps,cur);
}
/* the first kind that is ready, preferring `want` */
const pickKind=want=>{const ch=DMK().kindChoices(KINDS);const w=ch.find(k=>k.id===want&&!k.disabled);return w?w.id:(ch.find(k=>!k.disabled)||{id:''}).id;};
const kindOptions=()=>DMK().kindChoices(KINDS).map(k=>`<option value="${esc(k.id)}"${k.disabled?' disabled':''}>${esc(k.shortName||k.name)}${k.stateText?' ('+esc(k.stateText)+')':''}</option>`).join('');
/* Toolbar: model and effort follow the chosen kind. A kind other than the default has no model list yet (FR-062, T049), so both are hidden and it starts with its own default. */
function syncKindModel(){
  const ms=$('modelSel'),ef=$('effortSel');
  const id=KINDS&&$('kindSel').value||defaultKind(), other=!!KINDS&&id!==defaultKind();
  const c=KINDS?kindCaps(id):null, can=!c||DMK().shows(c,'models');
  if(other&&can&&!MODELS_BY[id]){ensureModels(id).then(()=>{if(MODELS_BY[id]&&MODELS_BY[id].length)syncKindModel();});}
  const k=other?id:'', ok=can&&(!other||modelsFor(id).length>0);
  if(ok&&(ms.dataset.kind||'')!==k){fillModelSelect(ms,undefined,k,'Model: ');ms.dataset.kind=k;ms.title=other?'Model for new sessions of this agent kind, as its CLI lists them.':'Model for new sessions. This is what your Copilot account offers; × is the cost multiplier the API reports.';}
  ms.hidden=!ok;
  fillEffortSelect(ef,ms.value,undefined,!ok||(c&&!DMK().shows(c,'effort')),k);
  fillPermSelect($('permMode'),kindCaps(id));
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
}
async function aboutKinds(){
  for(;;){
    const ch=DMK().kindChoices(KINDS);
    const r=await askDialog({title:'About agent kinds',body:'Each kind is a different agent harness. Only a kind that is ready can be chosen. Nothing is installed or run from here: copy the hint if you need to set one up.',
      lines:ch.map(k=>k.name+': '+(k.state==='ready'?'ready':k.stateText)+(k.version?' · version '+k.version:'')+(k.hint?' · '+k.hint:'')),
      buttons:[{label:'Close',value:null},{label:'Check again',value:'again',cls:'primary'}],returnFocus:()=>$('kindHelp')});
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
  b.onclick=()=>{kill();onClick();};t.appendChild(b);$('toasts').appendChild(t);setTimeout(kill,ms||8000);
  return t;
}
function addInfoNote(chat,text,cls){const n=document.createElement('div');n.className='note info'+(cls?' '+cls:'');n.textContent=text;chat.el.appendChild(n);scrollChat(chat);return n;}

function modelChipHTML(a){
  const m=modelLabel(a.info),pend=a.pendingModel;
  const txt=m.text+(pend?' → '+pend.name:'');
  const title=m.title+(pend?'. Next: '+pend.name+(pend.tier==='long'?' (long context)':'')+', when the current reply ends.':'')+(ctrlOf(a).switch==='none'?' This agent cannot switch in place; click for why.':' Click to change the model or the context.');
  return `<button class="mchip mchip-btn" id="modelChip" type="button" aria-haspopup="menu" aria-expanded="false" title="${esc(title)}"><span>${esc(txt)}</span><svg class="chev" viewBox="0 0 10 10" width="9" height="9" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 3.5l3 3 3-3"/></svg></button>`;
}
function updateModelChip(a){
  const el=$('modelChip');if(!el||!ui.selected)return;const cur=byId(ui.selected);if(!cur||liveRoot(cur)!==a)return;
  el.outerHTML=modelChipHTML(a);
}
function compactBtnHTML(a){
  const c=ctrlOf(a);if(!c.compact||!bridge.compact)return '';
  const busy=busyNow(a);
  return `<button class="mchip mchip-btn" id="compactBtn" type="button"${busy?' aria-disabled="true"':''} title="${busy?'The agent is busy. Compact when it is idle.':'Summarise the conversation to free space in the context window. Costs one model call.'}">Compact</button>`;
}

/* ---------------- custom agent per session (spec 043) ---------------- */
function agentChipHTML(a){
  const cur=a.profile?a.profile.name:'Default agent', pend=a.pendingProfile;
  const title='Agent: '+cur+(pend?'. Next: '+(pend.id?pend.name:'Default agent')+', when the current reply ends.':'')+' Click to choose a custom agent for this session.';
  return `<button class="mchip mchip-btn" id="agentChip" type="button" aria-haspopup="menu" aria-expanded="false" title="${esc(title)}"><span>${esc(cur+(pend?' → '+(pend.id?pend.name:'Default agent'):''))}</span><svg class="chev" viewBox="0 0 10 10" width="9" height="9" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 3.5l3 3 3-3"/></svg></button>`;
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
  const m=document.createElement('div');m.id='agentMenu';m.className='mode-menu model-menu';m.setAttribute('role','menu');m.setAttribute('aria-label','Custom agent for '+a.name);
  m.innerHTML='<p class="mm-h">Agent</p><p class="mm-why" role="note">Looking for agents…</p>';document.body.appendChild(m);
  const place=()=>{const r=m.getBoundingClientRect();m.style.left=Math.max(8,Math.min(x,innerWidth-r.width-8))+'px';m.style.top=Math.max(8,Math.min(y,innerHeight-r.height-8))+'px';};place();
  const c=$('agentChip');if(c&&anchor===c)c.setAttribute('aria-expanded','true');
  const r=await bridge.listProfiles(a.id).catch(err=>({ok:false,error:String(err&&err.message||err),profiles:[]}));
  if(!document.body.contains(m))return;
  a.profileList=r.ok?r.profiles:a.profileList;
  const curId=a.profile?a.profile.id:null;
  const item=(id,name,sub,tag)=>`<button type="button" role="menuitemradio" aria-checked="${id===curId}" data-prof="${esc(id===null?'':id)}"><span class="mt"><b>${esc(name)}${tag?' <span class="tag">'+esc(tag)+'</span>':''}</b>${sub?'<small>'+esc(sub)+'</small>':''}</span><span class="ck">${id===curId?'✓':''}</span></button>`;
  let h='<p class="mm-h">Agent</p>'+item(null,'Default agent','The standard agent of this session','');
  if(!r.ok)h+=`<p class="mm-why" role="note">${esc(r.error||'Could not list the agents.')}</p>`;
  else if(!r.profiles.length)h+='<p class="mm-why" role="note">No custom agents found. Put agent files in <code>.github/agents/*.agent.md</code> in this folder, or in <code>~/.copilot/agents</code>.</p>';
  else h+=r.profiles.map(p=>item(p.id,p.name,p.description||'',SOURCE_WORD[p.source]||'')).join('');
  m.innerHTML=h;place();
  m.addEventListener('click',e=>{const b=e.target.closest('button[data-prof]');if(!b)return;closeAgentMenu();
    const id=b.dataset.prof||null, p=id?(a.profileList||[]).find(x=>x.id===id):{id:null,name:'Default agent'};if(!p)return;
    if((a.profile?a.profile.id:null)===id&&!a.pendingProfile)return;
    if(busyNow(a)){a.pendingProfile=p;updateAgentChip(a);addNote(liveChat(a),'The agent changes to '+esc(p.name)+' when the current reply ends.');return;}
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
    const ok=await askDialog({title:'Use the agent '+q.name+' from this folder?',body:'This agent comes from the folder\'s repository, so someone else may have written it. It changes how the agent answers and which tools it uses; your permission mode stays as it is. Asked once for this folder and this version of the file.',lines,returnFocus:anchor||$('agentChip'),
      buttons:[{label:'Cancel',value:null},{label:'Use this agent',value:'ok',cls:'primary'}]});
    if(!ok)return;
    r=await bridge.selectProfile(a.id,q.id,true).catch(err=>({ok:false,error:String(err&&err.message||err)}));
  }
  if(!r||!r.ok){toast('Could not change the agent: '+esc((r&&r.error)||'unknown error'),5000);return;}
  a.profile=r.profile?Object.assign({},(a.profileList||[]).find(x=>x.id===r.profile.id)||{},r.profile):null;
  updateAgentChip(a);scheduleRender();
  addNote(liveChat(a),a.profile?'Agent: '+esc(a.profile.name)+' for the next replies.':'Back to the default agent.');
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
  h+=on?'<p class="mm-note">Applies from the next message; the conversation is kept. Costlier switches ask first, and your credit cap never changes.'+(ctrlOf(a).unverified?' '+esc(UNVERIFIED_WHY):'')+'</p>':'<div class="mm-foot"><button type="button" class="btn" data-newsess="1">New session…</button></div>';
  const m=document.createElement('div');m.id='modelMenu';m.className='mode-menu model-menu';m.setAttribute('role','menu');m.setAttribute('aria-label','Model and context for '+a.name);
  m.innerHTML=h;document.body.appendChild(m);
  const r=m.getBoundingClientRect();const px=Math.max(8,Math.min(x,innerWidth-r.width-8)),py=Math.max(8,Math.min(y,innerHeight-r.height-8));
  m.style.left=px+'px';m.style.top=py+'px';
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
    if(cap>0)lines.push('Your credit cap of '+fmtCap(cap)+' AI credits is not changed.');
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
    if(!ctx.undo)toastAction(esc(a.name)+': <b>'+esc(nm)+'</b> from the next message.','Undo',()=>undoModel(a,ctx.prev,ctx.anchor),8000);
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
  const chat=liveChat(a),t=DM.compactionText(e);
  if(e.phase==='start'){
    if(a.compNote&&a.compNote.isConnected)a.compNote.remove();
    a.compNote=addInfoNote(chat,t,'cline');a.compNote.setAttribute('role','status');a.compacting=true;
  }else{
    if(a.compNote&&a.compNote.isConnected){a.compNote.textContent=t;scrollChat(chat);}else addInfoNote(chat,t,'cline');
    if(e.phase==='failed'&&a.compNote)a.compNote.classList.add('failed');
    a.compNote=null;a.compacting=false;
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
  const r=await askDialog({title:'Compact the context of '+a.name+'?',body:'Older messages are replaced by a summary; the agent keeps working in the same session.',lines,input:{label:'Focus (optional): what the summary should keep',placeholder:'e.g. the API decisions',max:200},returnFocus:anchor,
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
  n.innerHTML='<b>This conversation is '+pct+'% full.</b> '+esc(why)+' A new session starts clean in the same folder; this one keeps its history.<div class="note-actions"><button class="btn" type="button" data-fresh="new">New session…</button><button class="btn" type="button" data-fresh="x">Dismiss</button></div>';
  n.querySelector('[data-fresh="new"]').onclick=()=>newSession(a);
  n.querySelector('[data-fresh="x"]').onclick=()=>{a.freshDismissed=true;n.remove();a.freshNote=null;const i=$('msgInput');if(i)i.focus();};
  chat.el.appendChild(n);a.freshNote=n;scrollChat(chat);
}

/* ---------------- new session (another agent in a folder) ---------------- */
function closeSessDlg(){const d=document.getElementById('sessDlg');if(d)d.remove();}
function newSession(a0){
  const a=liveRoot(a0); if(!bridge.newSession)return;
  closeSessDlg();
  const d=document.createElement('div');d.id='sessDlg';d.className='dlg-ov';
  d.innerHTML=`<div class="dlg" role="dialog" aria-modal="true" aria-labelledby="sdT"><h3 id="sdT">New session in ${esc(roomOf(a).name)}</h3>
   <p class="dsub">Another agent with its own chat in <code>${esc(roomOf(a).path)}</code>.</p>
   ${DMK().showsKindPicker(KINDS)?`<label>Harness<select id="sdKind">${kindOptions()}</select></label>`:''}
   <label>Permissions<select id="sdPerm"><option value="read-only">Read-only</option><option value="ask">Ask first</option><option value="allow">Allow all (no prompts)</option></select></label>
   <label id="sdModelL">Model<select id="sdModel"></select></label>
   <label id="sdEffL">Reasoning effort<select id="sdEff"></select></label>
   ${bridge.listProfiles&&a.info&&a.info.profiles?`<div id="sdAgentL" class="sd-agent" hidden><label>Agent<select id="sdAgent"><option value="">Default agent</option></select></label>${bridge.setFolderDefaultAgent?'<label class="chk"><input type="checkbox" id="sdAgentDef"> Default for new sessions here</label>':''}</div>`:''}
   ${bridge.setCap?'<label id="sdCapL"><span id="sdCapT">Credit cap (AIU, empty = no cap)</span><input id="sdCap" type="number" min="0.001" step="0.01" placeholder="No cap"></label>':''}
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
      $('sdCapL').hidden=!!c&&!DMK().shows(c,'cap');
      const cc=c||capsFor(a),usd=!!cc&&cc.capUnit==='usd';
      if(usd!==capUsd){capUsd=usd;$('sdCapT').textContent=usd?'Cost cap ($, Claude\'s estimate, empty = no cap)':'Credit cap (AIU, empty = no cap)';$('sdCap').min=usd?String(MIN_USD_CAP):'0.001';$('sdCap').value=usd?'':(APP_SETTINGS.defaultMaxAiCredits||'');}
    }
    if(c)fillPermSelect($('sdPerm'),c);
  };
  if($('sdKind'))$('sdKind').value=pickKind(a.info.adapterId||defaultKind());
  eff(); $('sdModel').onchange=eff; if($('sdKind'))$('sdKind').onchange=()=>{eff();agentRow();};
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
    if($('sdKind')&&(!kind||(DMK().kindChoices(KINDS).find(k=>k.id===kind)||{disabled:true}).disabled)){toast('That agent kind is not ready. Open "About agent kinds" in the toolbar to see why.',6000);return;}
    const opts={permMode:$('sdPerm').value,model:$('sdModelL').hidden?undefined:$('sdModel').value,effort:$('sdEff').hidden?undefined:($('sdEff').value||undefined)};
    if(kind)opts.adapterId=kind;
    if($('sdCap')&&!$('sdCapL').hidden){const cv=parseFloat($('sdCap').value);opts.maxAiCredits=capUsd?(cv>=MIN_USD_CAP&&cv<=1e4?Math.round(cv*100)/100:null):(cv>=MIN_CAP&&cv<=1e6?Math.round(cv*100)/100:null);}
    const profId=$('sdAgentL')&&!$('sdAgentL').hidden?$('sdAgent').value:'';
    if($('sdAgentDef')&&!$('sdAgentL').hidden){
      const want=$('sdAgentDef').checked&&profId?profId:(profId===a.info.defaultAgent?null:undefined);
      if(want!==undefined&&want!==(a.info.defaultAgent||null))bridge.setFolderDefaultAgent(a.id,want).then(dr=>{if(dr&&dr.ok)for(const x of agents)if(x.room===a.room&&x.info)x.info.defaultAgent=dr.defaultAgent;}).catch(()=>undefined);
    }
    $('sdGo').disabled=true;$('sdGo').textContent='Starting…';
    const r=await bridge.newSession(a.id,opts);
    closeSessDlg();
    if(!r.ok){toast('Could not start a session: '+esc(r.error||'unknown error'),6000);return;}
    addLiveAgent(r.agent); openPanel(r.agent.id,false);
    if(profId){const na=liveById(r.agent.id),p=(a.profileList||[]).find(x=>x.id===profId);if(na&&p){na.profileList=a.profileList;applyProfile(na,p);}}
  };
  $('sdGo').focus();
}

/* ---------------- folders: new session, hide / show, remove ---------------- */
function toggleFolders(on){
  const pop=$('foldersPop'),btn=$('foldersBtn');
  const show=on===undefined?pop.hidden:on;
  pop.hidden=!show; btn.setAttribute('aria-expanded',String(show));
  if(show)renderFolders();
}
/* ---------------- scheduled prompts (spec 044): per folder, while the app is open ---------------- */
let SCHED={pausedAll:false,schedules:[]};
const folderKeyOf=r=>{const ag=agents.find(x=>!x.parent&&x.room===r.id);const i=ag&&ag.info;return i?(i.workspaceFile||i.cwd):r.path;};
const schedulesOf=r=>SCHED.schedules.filter(s=>s.folder===folderKeyOf(r));
const clock=ms=>{const d=new Date(ms),n=new Date(),t=d.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});return d.toDateString()===n.toDateString()?t:d.toLocaleDateString([],{month:'short',day:'numeric'})+' '+t;};
const nextRunOf=ss=>{const t=ss.filter(s=>!s.paused&&!s.done).map(s=>s.every!==undefined?s.next:s.at).filter(Boolean).sort((a,b)=>a-b)[0];return t&&!SCHED.pausedAll?clock(t):'';};
const OUTCOME_WORD={sent:'sent','skipped-busy':'skipped: the agent was busy','skipped-paused':'skipped: paused',missed:'missed: the app was closed',failed:'could not send'};
const whenOf=s=>s.every!==undefined?(s.every%60===0?'every '+(s.every/60)+' h':'every '+s.every+' min'):'once at '+clock(s.at);
function renderSchedDlg(){
  const d=$('schedDlg'); if(!d)return; const r=ROOMS.find(x=>x.id===d.dataset.room); if(!r){closeSchedDlg();return;}
  const ss=schedulesOf(r), list=$('sdList');
  list.innerHTML=ss.length?ss.map(s=>`<div class="sc-row${s.paused||s.done?' off':''}"><div class="sc-t"><b title="${esc(s.prompt)}">${esc(s.prompt.length>90?s.prompt.slice(0,89)+'…':s.prompt)}</b><small>${esc(whenOf(s))}${s.done?' · done':s.paused?' · paused':(s.every!==undefined&&s.next&&!SCHED.pausedAll?' · next '+esc(clock(s.next)):'')}${s.last?' · last '+esc(clock(s.last.at))+': '+esc(OUTCOME_WORD[s.last.outcome]||s.last.outcome):''}</small></div>${s.done?'':`<button class="btn" type="button" data-sc="pause" data-id="${esc(s.id)}">${s.paused?'Resume':'Pause'}</button>`}<button class="btn danger" type="button" data-sc="del" data-id="${esc(s.id)}">Delete</button></div>`).join(''):'<p class="sc-empty">No schedules for this folder yet.</p>';
  $('sdPausedNote').hidden=!SCHED.pausedAll;
}
function closeSchedDlg(){const d=$('schedDlg');if(d)d.remove();}
function openSchedules(r){
  closeSchedDlg();toggleFolders(false);
  const d=document.createElement('div');d.id='schedDlg';d.className='dlg-ov';d.dataset.room=r.id;
  const soon=new Date(Date.now()+60*60000);soon.setSeconds(0,0);const pad=n=>String(n).padStart(2,'0');
  const local=`${soon.getFullYear()}-${pad(soon.getMonth()+1)}-${pad(soon.getDate())}T${pad(soon.getHours())}:${pad(soon.getMinutes())}`;
  d.innerHTML=`<div class="dlg sched-dlg" role="dialog" aria-modal="true" aria-labelledby="sdhT"><h3 id="sdhT">Schedules for ${esc(r.name)}</h3>
   <p class="dsub">A prompt sent to this folder's agent at a time or an interval, <b>only while Agent Durbar is open</b>. A run is skipped when the agent is busy or waiting for you; missed runs are not caught up. The agent's own permission mode and credit cap apply.</p>
   <p class="sc-paused" id="sdPausedNote" hidden>All schedules are paused (Folders panel).</p>
   <div class="sc-list" id="sdList"></div>
   <div class="sc-form"><label>Prompt<textarea id="scPrompt" rows="3" maxlength="2000" placeholder="For example: Summarise the open pull requests in three bullet points."></textarea></label>
    <div class="sc-when"><label class="chk"><input type="radio" name="scKind" value="every" checked> Every <input type="number" id="scEvery" min="5" max="1440" step="5" value="60" aria-label="Minutes between runs"> minutes</label>
    <label class="chk"><input type="radio" name="scKind" value="once"> Once at <input type="datetime-local" id="scAt" value="${local}" aria-label="Date and time"></label></div></div>
   <div class="dbtn"><button class="btn" id="scClose" type="button">Close</button><button class="btn primary" id="scAdd" type="button">Add schedule</button></div></div>`;
  document.body.appendChild(d);
  renderSchedDlg();
  d.addEventListener('click',async e=>{
    if(e.target===d){closeSchedDlg();return;}
    const b=e.target.closest('button');if(!b)return;
    if(b.id==='scClose'){closeSchedDlg();return;}
    if(b.id==='scAdd'){
      const prompt=$('scPrompt').value.trim();if(!prompt){$('scPrompt').focus();toast('Write the prompt first.',3000);return;}
      const once=d.querySelector('input[name="scKind"]:checked').value==='once';
      const input={folder:folderKeyOf(r),prompt};
      if(once){const t=new Date($('scAt').value).getTime();if(!(t>Date.now())){toast('Choose a time in the future.',3500);return;}input.at=t;}
      else{const m=Math.round(Number($('scEvery').value));if(!(m>=5&&m<=1440)){toast('Choose 5 to 1440 minutes.',3500);return;}input.every=m;}
      const res=await bridge.saveSchedule(input);
      if(!res.ok){toast(esc(res.error||'Could not add the schedule.'),5000);return;}
      $('scPrompt').value='';await refreshSchedules();toast('Schedule added: '+esc(whenOf(res.schedule))+'.',3000);return;
    }
    const s=SCHED.schedules.find(x=>x.id===b.dataset.id);if(!s)return;
    if(b.dataset.sc==='del'){await bridge.removeSchedule(s.id);await refreshSchedules();}
    else if(b.dataset.sc==='pause'){await bridge.saveSchedule(Object.assign({},s,{paused:!s.paused}));await refreshSchedules();}
  });
  d.addEventListener('keydown',e=>{if(e.key==='Escape'){e.stopPropagation();closeSchedDlg();}});
  $('scPrompt').focus();
}
async function refreshSchedules(){if(!bridge.listSchedules)return;SCHED=await bridge.listSchedules();renderFolders();renderSchedDlg();}
document.addEventListener('change',async e=>{if(e.target&&e.target.id==='schedPauseAll'){const r=await bridge.setSchedulesPaused(e.target.checked);SCHED.pausedAll=r.pausedAll;renderFolders();renderSchedDlg();}});
if(bridge&&bridge.onSchedules){bridge.onSchedules(doc=>{SCHED=doc;renderFolders();renderSchedDlg();});}
if(bridge&&bridge.onScheduleRan){bridge.onScheduleRan(r=>{const a=liveById(r.agentId);if(!a)return;addNote(liveChat(a),'Scheduled prompt ('+esc(r.every!==undefined?whenOf({every:r.every}):'once')+').');});}
function renderFolders(){
  const pop=$('foldersPop'); if(pop.hidden)return;
  if(!ROOMS.length){pop.innerHTML='<p class="fp-empty">No folders yet. Use + Folder or + Workspace. Folders you add are remembered next time.</p>';return;}
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
  toast(esc(r.name)+(hidden?' hidden. Its sessions keep running; show it from Folders.':' is shown again.'),3600);
}
async function removeFolder(r){
  const ags=agents.filter(x=>x.room===r.id), busy=ags.filter(x=>['working','thinking','waiting'].includes(x.state)).length;
  const msg=busy?`${esc(r.name)} has ${busy} agent${busy===1?'':'s'} still working. Remove the folder and end ${busy===1?'it':'them'}?`:`Remove ${esc(r.name)}? Its sessions end here; your earlier ${esc(kindWord(((ags.find(x=>!x.parent)||{}).info||{}).adapterId))} sessions stay on disk and can be resumed if you add the folder again.`;
  if(!window.confirm(unesc(msg)))return;
  const root=ags.find(x=>!x.parent); const res=root&&bridge.removeFolder?await bridge.removeFolder(root.id):{ok:true,removedIds:[]};
  if(!res.ok){toast('Could not remove the folder.',4000);return;}
  if(ui.selected&&(byId(ui.selected)||{}).room===r.id)closePanel();
  const gone=new Set(ags.map(x=>x.id));
  for(let i=agents.length-1;i>=0;i--){if(gone.has(agents[i].id)||gone.has(agents[i].parent)){delete chats[agents[i].id];delete prev[agents[i].id];agents.splice(i,1);}}
  const ri=ROOMS.indexOf(r); if(ri>=0)ROOMS.splice(ri,1);
  if(ui.ws===r.id)ui.ws='all';
  renderFilter(); renderFolders(); scheduleRender(); toast(esc(r.name)+' removed.',3200);
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
  const ok=await askDialog({title:'Remove '+r.name+'?',body:(busy?r.name+' is still '+(r.state==='waiting'?'waiting for you':'working')+'. ':'')+'The session ends and its card leaves the office. Its history stays on disk and is listed under Previous sessions.',returnFocus:$('rmSessBtn'),
    buttons:[{label:'Cancel',value:null},{label:'Remove session',value:'ok',cls:'primary warn'}]});
  if(!ok)return;
  const out=await bridge.removeSession(r.id).catch(e=>({ok:false,error:String(e&&e.message||e)}));
  if(!out.ok){toast('Could not remove: '+esc(out.error||'unknown error'),5000);return;}
  const name=r.name; removeLiveAgent(r.id); renderFolders(); scheduleRender(); toast(esc(name)+' removed. Its history is under Previous sessions.',3600);
}
function removeLiveAgent(id){
  STATS.forget(id); MOOD.forget(id);
  VISITS.leave(id); dropWalker(id);
  for(let i=agents.length-1;i>=0;i--)if(agents[i].id===id||agents[i].parent===id){delete chats[agents[i].id];delete prev[agents[i].id];agents.splice(i,1);}
  if(ui.selected&&!byId(ui.selected))closePanel();
}

/* ---------------- previous sessions (Copilot, resumable) + VS Code chat history (read-only) ---------------- */
const prev={}; let vsViewing=false;
const when=ms=>{if(!ms)return '';const d=new Date(ms),n=new Date(),t=d.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
  return d.toDateString()===n.toDateString()?'Today '+t:d.toLocaleDateString([],{month:'short',day:'numeric',year:d.getFullYear()===n.getFullYear()?undefined:'numeric'})+' '+t;};
const pristine=a=>!a.sent&&!a.resumed;
const prevOf=a=>prev[a.id]||(prev[a.id]={open:false,touched:false,cli:null,vs:null});
async function loadPrev(a){
  const st=prevOf(a);
  const safe=(f,empty)=>f?f(a.id).catch(e=>Object.assign({ok:false,error:String(e&&e.message||e)},empty)):null;
  const [c,v]=await Promise.all([safe(feat(a,'history')?bridge.listPrevious:null,{sessions:[]}),safe(bridge.listVsChats,{sessions:[],storesFound:0,unreadable:0,tooLarge:0,formatNote:''})]);
  st.cli=c; st.vs=v;
  if(!st.touched&&pristine(a)&&((c&&c.sessions.length)||(v&&v.sessions.length)))st.open=true;
  if(ui.selected===a.id)renderPrev(a);
  return st;
}
function initPrev(a){
  const box=$('prev'); if(!box)return;
  if((!bridge.listPrevious||!feat(a,'history'))&&!bridge.listVsChats){box.hidden=true;return;}
  vsViewing=false; renderPrev(a); loadPrev(a);
}
function renderPrev(a){
  const box=$('prev'); if(!box||a.parent)return;
  const st=prevOf(a), c=st.cli, v=st.vs;
  if(!c&&!v){box.hidden=false;box.innerHTML='<div class="prev-bar"><span class="prev-t">Previous sessions</span><span class="prev-c">Looking…</span></div>';return;}
  const nc=c&&c.ok?c.sessions.length:0, nv=v&&v.ok?v.sessions.length:0, kw=kindWord(a.info&&a.info.adapterId), hasHist=!!c; /* c is null for a kind without history (loadPrev) */
  const keepScroll=(box.querySelector('.prev-body')||{}).scrollTop||0;
  let h=`<button class="prev-toggle" type="button" aria-expanded="${st.open}" data-pv="toggle">${ICON('chev')}<span class="prev-t">Previous sessions</span><span class="prev-c">${hasHist?nc+' '+esc(kw)+' · ':''}${nv} VS Code chat${nv===1?'':'s'}</span></button>`;
  if(st.open){
    h+='<div class="prev-body">';
    if(hasHist){h+='<div class="prev-h">'+esc(kw)+' sessions in this folder <small>Resume continues the same session; earlier messages are shown here.</small></div>';
    if(!c.ok)h+=`<p class="prev-empty">Could not list sessions${c.error?': '+esc(c.error):''}.</p>`;
    else if(!c.sessions.length)h+='<p class="prev-empty">No earlier '+esc(kw)+' sessions for this folder.</p>';
    else h+=c.sessions.map(x=>`<div class="prev-row"><div class="prev-tx"><b title="${esc(x.title)}">${esc(x.title)}</b><small>${esc(when(x.modifiedTime))}${x.branch?' · '+esc(x.branch):''}</small></div><button class="btn" type="button" data-pv="resume" data-sid="${esc(x.id)}">Resume</button></div>`).join('');}
    h+='<div class="prev-h">VS Code chat history <span class="tag">read-only</span> <small>A copy of what VS Code saved. It cannot be continued here.</small></div>';
    if(!v||!v.ok)h+=`<p class="prev-empty">Could not read VS Code chats${v&&v.error?': '+esc(v.error):''}.</p>`;
    else if(!v.sessions.length)h+='<p class="prev-empty">'+(v.storesFound?'No chats in the VS Code storage for this folder.':'No VS Code chats found for this folder (VS Code never opened it, or it is stored somewhere this app does not read).')+'</p>';
    else h+=v.sessions.map(x=>`<div class="prev-row"><div class="prev-tx"><b title="${esc(x.title)}">${esc(x.title)}</b><small>${esc(when(x.updated))} · ${x.requests} message${x.requests===1?'':'s'}</small></div><button class="btn" type="button" data-pv="view" data-key="${esc(x.key)}">View</button></div>`).join('');
    if(v&&(v.unreadable||v.tooLarge))h+=`<p class="prev-fine">${v.unreadable?v.unreadable+' chat file(s) could not be read. ':''}${v.tooLarge?v.tooLarge+' file(s) skipped for size.':''}</p>`;
    if(v&&v.formatNote)h+=`<p class="prev-fine">${esc(v.formatNote)}</p>`;
    h+='</div>';
  }
  box.hidden=false; box.innerHTML=h;
  const nb=box.querySelector('.prev-body'); if(nb)nb.scrollTop=keepScroll;
}
/* spec 006 FR-021: a folder restored after a restart continues its last session when its chat is first opened (no prompt is sent) */
async function wakeLast(a){
  if(a.waking)return; a.waking=true;
  setState(a,'working','Starting','Continuing your last session…');
  const r=await bridge.wake(a.id).catch(e=>({ok:false,error:String(e&&e.message||e)}));
  a.waking=false;
  if(!r||!r.ok){setState(a,'idle','Not started','Your last session here. It continues when you open it.');toast('Could not continue the last session: '+esc((r&&r.error)||'unknown error'),7000);return;}
  if(a.info){a.info.resumeLast=false;a.info.lazy=false;}
  if(r.resumed){a.resumed=true;replayHistory(a,r.history,r.title,'Continued after restart');setState(a,'idle','Ready','Continued: '+SHORT(r.title||'last session',90));}
  else{if(r.resumed===false)addNote(liveChat(a),'The last session is no longer available; this is a new session.');setState(a,'idle','Ready','Ready. Send a message to start.');}
}
function replayHistory(a,h,title,lead){
  const chat=liveChat(a); let m=null;
  if(h&&h.truncated)addNote(chat,'Showing the last '+h.items.length+' of '+h.total+' items; earlier ones are not shown.');
  const agentMsg=()=>{if(!m){m=document.createElement('div');m.className='msg agent';m.innerHTML='<div class="meta">'+esc(a.name)+'</div>';chat.el.appendChild(m);}return m;};
  const chipBox=()=>{const mm=agentMsg();let l=mm.lastElementChild;if(!l||!l.classList.contains('chips')){l=document.createElement('div');l.className='chips';l.setAttribute('aria-label','Tool calls');mm.appendChild(l);}return l;};
  for(const it of ((h&&h.items)||[])){
    if(it.type==='user'){m=null;addUserMsg(chat,it.text,(it.attachments||[]).map(x=>({name:x.name,img:x.kind==='image'})),it.ts);}
    else if(it.type==='output'){const b=document.createElement('div');b.className='bubble';agentMsg().appendChild(b);mdSet(b,it.text,true);}
    else{const full=it.output||'';addChip(chipBox(),makeChip({tool:it.tool,label:it.label,res:SHORT(full||(it.failed?'failed':'ok'),60),output:full.slice(0,2000),state:it.failed?'failed':'ok'}));}
  }
  addNote(chat,(lead||'Resumed')+': '+esc((title||'earlier session').replace(/[.!?…]+$/,''))+'. New messages continue this session.');
}
async function resumePrev(a,sid,btn){
  if(btn){btn.disabled=true;btn.textContent='Resuming…';}
  const r=await bridge.resumeSession(a.id,sid,pristine(a)).catch(e=>({ok:false,error:String(e&&e.message||e)}));
  if(!r.ok){toast('Could not resume: '+esc(r.error||'unknown error'),7000);if(btn){btn.disabled=false;btn.textContent='Resume';}return;}
  if(r.removedId)removeLiveAgent(r.removedId);
  if(ui.selected&&!byId(ui.selected))closePanel();
  addLiveAgent(r.agent);
  const na=liveById(r.agent.id); if(!na)return;
  na.resumed=true; na.sent=false; replayHistory(na,r.history,r.title);
  setState(na,'idle','Ready','Resumed: '+SHORT(r.title||'',90));
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
  wrap.innerHTML=`<div class="vsbar" role="note"><div><b>VS Code chat history · read-only</b><span>A copy of what VS Code saved. It cannot be continued here.</span></div><button class="btn" id="vsBack" type="button">Back to chat</button></div><h3 class="vst">${esc(tr.title)}</h3><div class="vsmeta">${tr.shownRequests} of ${tr.totalRequests} messages</div><div class="vsbody chat-inner"></div>${tr.notes.length?'<div class="vsnotes">'+tr.notes.map(n=>'<p>'+esc(n)+'</p>').join('')+'</div>':''}`;
  const body=wrap.querySelector('.vsbody'), fake={el:body};
  let am=null;
  for(const b of tr.blocks){
    if(b.type==='user'){am=null;addUserMsg(fake,b.text||'(attachment)',(b.attachments||[]).map(n=>({name:n,img:false})),b.ts);}
    else if(b.type==='assistant'){if(!am){am=document.createElement('div');am.className='msg agent';am.innerHTML='<div class="meta">Copilot (VS Code)</div>';body.appendChild(am);}const d=document.createElement('div');d.className='bubble';am.appendChild(d);mdSet(d,b.text,true);}
    else if(b.type==='tool'){if(!am){am=document.createElement('div');am.className='msg agent';am.innerHTML='<div class="meta">Copilot (VS Code)</div>';body.appendChild(am);}let l=am.lastElementChild;if(!l||!l.classList.contains('chips')){l=document.createElement('div');l.className='chips';am.appendChild(l);}addChip(l,makeChip({tool:'tool',kind:'tool',label:b.label,state:'ok'}));}
    else if(b.type==='note'){const n=document.createElement('div');n.className='note err';n.textContent=b.text;body.appendChild(n);}
  }
  const c=$('chat'); c.replaceChildren(wrap); c.scrollTop=0; vsViewing=true;
  document.querySelector('#panel .panel-in').classList.add('viewing');
  $('vsBack').onclick=leaveVsView; $('vsBack').focus({preventScroll:true});
}
document.addEventListener('click',e=>{
  const b=e.target.closest('[data-pv]'); if(!b||!b.closest('#prev'))return;
  const a=byId(ui.selected); if(!a)return; const ra=liveRoot(a);
  if(b.dataset.pv==='toggle'){const st=prevOf(ra);st.open=!st.open;st.touched=true;renderPrev(ra);}
  else if(b.dataset.pv==='resume')resumePrev(ra,b.dataset.sid,b);
  else if(b.dataset.pv==='view')viewVs(ra,b.dataset.key,b);
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
  const st=await loadPrev(a); const n=(st.cli&&st.cli.ok?st.cli.sessions.length:0), v=(st.vs&&st.vs.ok?st.vs.sessions.length:0);
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
    if(!ch||ch.disabled){toast('That agent kind is not ready. Open "About agent kinds" in the toolbar to see why.',6000);return;}
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
  $('addFolder').onclick=()=>addVia(bridge.addFolder);
  $('addWs').onclick=()=>addVia(bridge.addWorkspaceFile);
  $('foldersBtn').onclick=()=>toggleFolders();
  $('floorsBtn').onclick=()=>toggleFloors();
  document.addEventListener('change',e=>{
    const s=e.target.closest&&e.target.closest('.floors-ui select[data-fl="move"]');if(s)moveRoomToFloor(s.dataset.room,s.value);
    if(e.target&&e.target.classList&&e.target.classList.contains('fl-into-sel')){INTO=e.target.value;renderIntoFloor();renderFloorsPanel();renderFloorsSettings();}});
  document.addEventListener('keydown',e=>{const t=e.target;if(e.key==='Enter'&&t&&t.closest&&t.closest('.floors-ui .fl-new')){e.preventDefault();floorAction(t.closest('.fl-new').querySelector('[data-fl="create"]'));}});
  window.DurbarScreens.init({bridge,stats:STATS,esc,toast,floors:{on:()=>floorsLive(),render:()=>renderFloorsSettings()},onSettings:v=>{APP_SETTINGS=v||{};},onUsageReset,isSerious:()=>SERIOUS,setSerious:on=>{SERIOUS=!!on;scheduleRender();},usageSince:()=>LEDGER.since(),usageOffice:()=>LEDGER.office(),usageError:()=>usageSaveError,
    places:window.DurbarPlaces,customPlaces:()=>CUSTOM,placeMap:()=>PLACE_MAP,placeLabel,setCustomPlaces,placeServers:()=>[...SEEN_SERVERS],setPlaceMap:m=>{PLACE_MAP=(m&&typeof m==='object')?m:{};scheduleRender();},
    applyTheme,
    agents:()=>LIVE.agents.filter(x=>x.live&&!x.parent).map(x=>({id:x.id,name:x.name,model:x.info&&x.info.model,room:(ROOMS.find(r=>r.id===x.room)||{}).name||''})),
    staticLimit:a=>{const m=modelsFor(a.info&&a.info.adapterId).find(x=>x.id===((a.info&&a.info.model)||a.model||'auto'));return (m&&m.contextWindow)||0;},
    folderOf:x=>{const ag=LIVE.agents.find(y=>y.id===(x&&x.id||x));return ag?folderOfRoom(ag.room):null;},
    openAgent:id=>openPanel(id,false)});
  document.addEventListener('click',e=>{if(e.target.closest&&e.target.closest('.place-add'))window.DurbarScreens.placeDialog(null);});
  $('toolsBtn').onclick=()=>window.DurbarScreens.isOpen()?window.DurbarScreens.close():window.DurbarScreens.openTools(null);
  $('settingsBtn').onclick=()=>window.DurbarScreens.openSettings();
  $('modelSel').onchange=syncKindModel;
  $('kindSel').onchange=syncKindModel;
  $('kindHelp').onclick=()=>aboutKinds();
  bridge.onEvent(onLiveEvent);
  bridge.onAgentAdded(addLiveAgent);
  bridge.listAgents().then(l=>{l.forEach(addLiveAgent);renderFilter();if(bridge.floorsState)bridge.floorsState().then(applyFloors).catch(()=>{});const rs=l.filter(x=>x.permRestored&&!x.parent).length;if(rs)toast(rs+' saved folder'+(rs>1?'s were':' was')+' restored in <b>Allow all</b>, as you left '+(rs>1?'them':'it')+'. Everything runs without asking there; the mode chip says <i>restored</i>. "Approve for this session" grants start empty.',9000);});
  loadModels();
  refreshSchedules();
  /* User themes (spec 040): register imported packs, then apply the saved theme id */
  THEME.setTheme.resolveUser=bridge.getUserTheme?(id)=>bridge.getUserTheme(id):null;
  const themeBoot=(v)=>{
    const tid=(v&&v.theme)||'clean-office';
    const apply=()=>{if(THEME.current().id!==tid)applyTheme(tid);else scheduleRender();};
    if(bridge.listUserThemes){bridge.listUserThemes().then(list=>{
      const good={};(list||[]).filter(t=>t.ok&&t.manifest!==false).forEach(t=>{});
      return bridge.getUserTheme?Promise.all((list||[]).filter(t=>t.ok).map(t=>bridge.getUserTheme(t.id).then(m=>[t.id,m])))
        .then(pairs=>{for(const [id,m] of pairs)if(m)good[id]=m;THEME.registerUserThemes(good);apply();})
      :apply();
    }).catch(()=>apply());}else apply();
  };
  if(bridge.getSettings)bridge.getSettings().then(v=>{APP_SETTINGS=v||{};PLACE_MAP=(v&&v.placeMap)||{};CUSTOM=(v&&Array.isArray(v.customPlaces))?v.customPlaces:[];SERIOUS=!!(v&&v.seriousMode);themeBoot(v);}).catch(()=>{});
  setInterval(()=>{if(VISITS.tick())scheduleRender();},250);
  agents=LIVE.agents; ROOMS=LIVE.rooms;
  setBadge();
}

renderFilter(); renderAll();
if(qs.get('view')==='list')setView('list');
if(pendingOpen&&demoOn){openPanel(pendingOpen,false);pendingOpen=null;}
})();
