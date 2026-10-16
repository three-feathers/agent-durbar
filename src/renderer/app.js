/* Agent Durbar renderer: office view, list view, chat panel, live + demo + simulated data.
   Plain script (no modules) so it runs in the sandboxed Electron renderer and in a plain browser. */
(function(){
'use strict';
const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
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
function usageShort(a){const u=a.usage; if(!u||!u.calls)return ''; return fmtTok(u.inT+u.outT)+' tok · '+(u.nano/1e9).toFixed(2)+' AIU';}
function usageLong(a){const u=a.usage; if(!u||!u.calls)return ''; return u.calls+' calls · '+fmtTok(u.inT)+' in / '+fmtTok(u.outT)+' out tokens · '+(u.nano/1e9).toFixed(3)+' AIU';}

/* ---------------- svg helpers ---------------- */

/* ---------------- svg helpers ---------------- */
function shade(hex,p){const n=parseInt(hex.slice(1),16);let r=n>>16,g=(n>>8)&255,b=n&255;const f=p<0?0:255,t=Math.abs(p);
  r=Math.round((f-r)*t+r);g=Math.round((f-g)*t+g);b=Math.round((f-b)*t+b);return '#'+((1<<24)+(r<<16)+(g<<8)+b).toString(16).slice(1)}
function badgeSVG(st){
  if(st==='done')return '<svg viewBox="0 0 10 10" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 5.3l2.1 2.1L8 3"/></svg>';
  if(st==='error')return '<svg viewBox="0 0 10 10" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round"><path d="M5 2v3.4M5 7.6v.1"/></svg>';
  if(st==='waiting')return '<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="2.2" fill="#fff"/></svg>';
  if(st==='idle')return '<svg viewBox="0 0 10 10" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round"><path d="M2.5 5h5"/></svg>';
  return '<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="2" fill="#fff" opacity=".9"/></svg>';
}
function hairFront(style,c){
  const fr=`<path d="M61 43.5C61 33 67 30.5 74 30.5C81 30.5 87 33 87 43.5C84 38.5 80 37 74 37C68 37 64 38.5 61 43.5Z" fill="${c}"/>`;
  if(style==='bun')return fr+`<circle cx="74" cy="28" r="5.5" fill="${c}"/>`;
  if(style==='curly')return `<circle cx="64" cy="36" r="6.2" fill="${c}"/><circle cx="74" cy="31.5" r="7" fill="${c}"/><circle cx="84" cy="36" r="6.2" fill="${c}"/>`+fr;
  return fr;
}
function scene(a,mini,c){
  const st=vis(a), k=a.look, shirt=k.shirt, arm=shade(shirt,-.14), skinD=shade(k.skin,-.08);
  let s=`<svg class="scene${c?' sc-c':''}" data-sig="${st}|${k.shirt}${k.skin}${k.hair}${k.style}${k.glasses?1:0}|${c?'c':mini?'m':'f'}" viewBox="${c?'16 5 176 116':mini?'22 4 166 118':'0 0 200 124'}" aria-hidden="true" focusable="false">`;
  s+=`<ellipse cx="100" cy="118" rx="88" ry="3.5" fill="#2c3733" opacity=".06"/>`;
  /* compact scenes: flat halo rects + CSS-only animation (no blur filter, no SMIL) so 15 of them stay cheap */
  if(c){const hc={working:'#6f93b5',thinking:'#8a97bd',waiting:'#d9962b',error:'#bf5a50'}[st];
    if(hc) s+=`<g class="halo halo-${st}"><rect x="101" y="22" width="86" height="66" rx="17" fill="${hc}" opacity=".13"/><rect x="107" y="28" width="74" height="54" rx="13" fill="${hc}" opacity=".16"/></g>`;}
  else if(st==='working'||st==='thinking') s+=`<rect class="glow" x="106" y="28" width="76" height="54" rx="14" fill="${st==='working'?'#6f93b5':'#8a97bd'}" filter="url(#soft)" opacity=".24"/>`;
  s+=`<rect x="52" y="50" width="44" height="48" rx="13" fill="#cdc6b8"/>`;
  if(k.style==='long') s+=`<path d="M59.5 44a14.5 14.5 0 0 1 29 0v19q0 4-4 4h-21q-4 0-4-4z" fill="${k.hair}"/>`;
  s+=`<path d="M55 99V77q0-14 14-14h10q14 0 14 14v22z" fill="${shirt}"/>`;
  s+=`<path d="M69.5 63.5q4.5 5 9 0" fill="none" stroke="${shade(shirt,.35)}" stroke-width="2" stroke-linecap="round"/>`;
  s+=`<rect x="70" y="53" width="8" height="10" rx="3" fill="${skinD}"/>`;
  const tilt = st==='idle'?'rotate(-7 74 56)': st==='error'?'rotate(4 74 56)':'';
  s+=`<g ${tilt?`transform="${tilt}"`:''}><g class="${st==='working'?'head':''}"><circle cx="74" cy="44" r="12.5" fill="${k.skin}"/>`;
  s+=hairFront(k.style,k.hair);
  const ex = st==='idle'?0:1.4;
  if(st==='idle') s+=`<path d="M67.5 45.6q2 1.7 4 0M76.5 45.6q2 1.7 4 0" fill="none" stroke="#3b3330" stroke-width="1.3" stroke-linecap="round"/>`;
  else s+=`<circle cx="${70.3+ex}" cy="45.4" r="1.35" fill="#3b3330"/><circle cx="${78.3+ex}" cy="45.4" r="1.35" fill="#3b3330"/>`;
  if(k.glasses) s+=`<g fill="none" stroke="#3b3330" stroke-width="1.1"><circle cx="${70.3+ex}" cy="45.4" r="4"/><circle cx="${78.3+ex}" cy="45.4" r="4"/></g>`;
  const mouth = st==='error'?'M71 53.2q3-2 6 0': (st==='done'||st==='idle')?'M70.5 51q3.5 3 7 0':'M71 51.6q3 2 6 0';
  s+=`<path d="${mouth}" fill="none" stroke="#7a4b3a" stroke-width="1.3" stroke-linecap="round"/></g></g>`;
  // desk
  s+=`<rect x="10" y="86" width="180" height="7" rx="3.5" fill="#d8c6a8"/><rect x="15" y="93" width="170" height="21" rx="4" fill="#e8dcc6"/><rect x="22" y="98" width="46" height="11" rx="3" fill="#dccdb1"/><rect x="142" y="98" width="36" height="11" rx="3" fill="#dccdb1"/>`;
  // monitor
  s+=`<rect x="138.5" y="76" width="11" height="9" fill="#7c8791"/><rect x="130" y="83" width="28" height="3.5" rx="1.75" fill="#7c8791"/>`;
  const scr={working:'#eaf1f7',thinking:'#eaeef6',waiting:'#f8eed9',idle:'#d4d8d6',error:'#f6e3e0',done:'#e2efe7'}[st];
  s+=`<rect x="112" y="32" width="64" height="45" rx="5" fill="#5f6d77"/><rect x="116" y="36" width="56" height="37" rx="3" fill="${scr}"/>`;
  if(st==='working') s+=`<rect class="bar" x="121" y="41" width="34" height="3.6" rx="1.8" fill="#6f93b5"/><rect class="bar" x="121" y="48.5" width="26" height="3.6" rx="1.8" fill="#8fb09a"/><rect class="bar" x="121" y="56" width="42" height="3.6" rx="1.8" fill="#6f93b5"/><rect class="bar" x="121" y="63.5" width="20" height="3.6" rx="1.8" fill="#a8bfd2"/>`;
  if(st==='thinking') s+=`<rect x="121" y="41" width="30" height="3.6" rx="1.8" fill="#8a97bd" opacity=".55"/><rect x="121" y="48.5" width="40" height="3.6" rx="1.8" fill="#8a97bd" opacity=".4"/><rect x="121" y="56" width="22" height="3.6" rx="1.8" fill="#8a97bd" opacity=".55"/><rect x="121" y="63.5" width="5" height="3.6" rx="1.8" fill="#8a97bd"${c?' class="cursor"':''}>${REDUCED||c?'':'<animate attributeName="opacity" values="1;.15;1" dur="1.6s" repeatCount="indefinite"/>'}</rect>`;
  if(st==='waiting') s+=`<rect x="121" y="41" width="30" height="3.6" rx="1.8" fill="#d9962b" opacity=".5"/><rect x="123" y="49" width="42" height="19" rx="5" fill="#fff" stroke="#e5be78" stroke-width="1.2"/><circle cx="131" cy="58.5" r="3" fill="#d9962b"/><rect x="138" y="54" width="20" height="3" rx="1.5" fill="#e5cf9f"/><rect x="138" y="60" width="14" height="3" rx="1.5" fill="#efe0bb"/>`;
  if(st==='idle') s+=`<circle cx="144" cy="54.5" r="7" fill="none" stroke="#b5b9b6" stroke-width="1.6"/><path d="M144 50.5v4l2.6 1.6" fill="none" stroke="#b5b9b6" stroke-width="1.6" stroke-linecap="round"/>`;
  if(st==='error') s+=`<circle cx="144" cy="52" r="9" fill="none" stroke="#bf5a50" stroke-width="2"/><path d="M144 47.5v5.5M144 56.6v.1" stroke="#bf5a50" stroke-width="2.2" stroke-linecap="round"/><rect x="127" y="65" width="34" height="3" rx="1.5" fill="#e3b5af"/>`;
  if(st==='done') s+=`<circle cx="144" cy="54.5" r="10" fill="#5f9a76"/><path d="M139 54.5l3.6 3.6 6.6-7" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>`;
  s+=`<rect x="59" y="82.2" width="36" height="3.8" rx="1.9" fill="#8f99a1"/>`;
  if(st==='idle') s+=`<rect x="98" y="76" width="10" height="10" rx="2.5" fill="#f6f1e7" stroke="#cdbf9f" stroke-width="1"/><path d="M108 78.5q4 0 4 3t-4 3" fill="none" stroke="#cdbf9f" stroke-width="1.4"/><path class="steam" d="M101 73q-2-3 0-5" fill="none" stroke="#b6b2a8" stroke-width="1.2" stroke-linecap="round"/><path class="steam" d="M105 73q-2-3 0-5" fill="none" stroke="#b6b2a8" stroke-width="1.2" stroke-linecap="round"/>`;
  const hand=(x,y)=>`<circle cx="${x}" cy="${y}" r="3.6" fill="${k.skin}"/>`;
  const armL=(x1,y1,x2,y2)=>`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${arm}" stroke-width="8" stroke-linecap="round"/>`;
  const typing = st==='working';
  s+=`<g class="${typing?'hand-l':''}">${armL(61,71,68,81)}${hand(68.5,81.4)}</g>`;
  if(st==='waiting'){
    const wave = REDUCED||c?'':`<animateTransform attributeName="transform" type="rotate" values="-4 87 71;6 87 71;-4 87 71" dur="2.8s" repeatCount="indefinite"/>`;
    s+=`<g${c?' class="wave"':''}>${wave}${armL(87,71,97,46)}${hand(97.5,42.5)}</g>`;
  } else if(st==='idle'){
    s+=`<g>${armL(87,71,96,80)}${hand(97,80.5)}</g>`;
  } else {
    s+=`<g class="${typing?'hand-r':''}">${armL(87,71,81,81)}${hand(80.5,81.4)}</g>`;
  }
  if(st==='thinking') s+=`<g class="bubble-g"><circle cx="58.5" cy="31" r="2" fill="#fff" stroke="#c9d0e0" stroke-width="1"/><circle cx="52" cy="25" r="3" fill="#fff" stroke="#c9d0e0" stroke-width="1"/><rect x="18" y="4" width="42" height="19" rx="9.5" fill="#fff" stroke="#c9d0e0" stroke-width="1.2"/><g fill="#8a97bd"><circle class="td" cx="30" cy="13.5" r="2.2"/><circle class="td" cx="39" cy="13.5" r="2.2"/><circle class="td" cx="48" cy="13.5" r="2.2"/></g></g>`;
  s+='</svg>';
  return s;
}
function avatar(a){
  const k=a.look;
  return `<svg viewBox="50 20 48 48" width="100%" height="100%" aria-hidden="true" focusable="false">${k.style==='long'?`<path d="M59.5 44a14.5 14.5 0 0 1 29 0v19q0 4-4 4h-21q-4 0-4-4z" fill="${k.hair}"/>`:''}<path d="M55 99V77q0-14 14-14h10q14 0 14 14v22z" fill="${k.shirt}"/><rect x="70" y="53" width="8" height="10" rx="3" fill="${shade(k.skin,-.08)}"/><circle cx="74" cy="44" r="12.5" fill="${k.skin}"/>${hairFront(k.style,k.hair)}<circle cx="71.7" cy="45.4" r="1.35" fill="#3b3330"/><circle cx="79.7" cy="45.4" r="1.35" fill="#3b3330"/><path d="M71 51.6q3 2 6 0" fill="none" stroke="#7a4b3a" stroke-width="1.3" stroke-linecap="round"/></svg>`;
}
const PLANT='<svg class="room-plant" width="26" height="30" viewBox="0 0 26 30" aria-hidden="true" focusable="false"><path d="M13 20C13 12 9 8 4 7c0 6 3 11 9 13z" fill="#9dbca6"/><path d="M13 20c0-9 4-13 9-14 0 7-3 12-9 14z" fill="#86a98f"/><path d="M13 20C12 14 12 9 13 3c2 6 2 11 0 17z" fill="#aac6b2"/><path d="M7 21h12l-1.5 8h-9z" fill="#d4b99a"/></svg>';


/* ---------------- toast ---------------- */
function toast(html,ms){const t=document.createElement('div');t.className='toast';t.innerHTML=html;$('toasts').appendChild(t);setTimeout(()=>{t.style.transition='opacity .3s';t.style.opacity='0';setTimeout(()=>t.remove(),320)},ms||3200)}
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

/* ---------------- top bar ---------------- */
function visibleAgents(){return agents.filter(a=>!roomOf(a).hidden&&(ui.ws==='all'||wsOf(a)===ui.ws));}
function renderStats(){
  const list=visibleAgents().filter(a=>!a.parent); const c={working:0,waiting:0,idle:0,error:0,done:0};
  list.forEach(a=>{const s=vis(a); if(s==='working'||s==='thinking')c.working++; else c[s]++;});
  const defs=[['working','Working','working or thinking'],['waiting','Waiting','waiting for you'],['idle','Idle','idle or paused'],['error','Errors','with errors'],['done','Done','done']];
  morphHTML($('stats'),defs.map(([k,l,t])=>`<button class="stat${(k==='waiting'||k==='error')&&c[k]?' attn':''}" data-k="${k}" aria-pressed="${ui.status===k}" title="Show only agents ${t}" aria-label="${c[k]} ${t}. Toggle filter."><span class="dot ${k}"></span><b>${c[k]}</b><span class="l">${l}</span></button>`).join(''));
}
function renderFilter(){
  const sel=$('wsFilter');
  sel.innerHTML='<option value="all">All folders</option>'+ROOMS.filter(r=>!r.hidden).map(r=>`<option value="${esc(r.id)}">${esc(r.name)}</option>`).join('');
  sel.value=ui.ws;
}
const matchStatus = a => !ui.status || ((ui.status==='working')?['working','thinking'].includes(vis(a)):vis(a)===ui.status);

/* ---------------- office view ---------------- */
const DENS={
  full:{cw:164,hw:90,cap:3},
  /* compact densities: uniform desk cells on a grid (cw = min cell width), helpers on a strip of mini desks below */
  roomy:{cw:262,gap:10,rp:14},   /* card with bigger desks, used only when the floor has room to spare */
  card:{cw:236,gap:8,rp:12},
  mini:{cw:216,gap:6,rp:10},
  micro:{cw:190,gap:5,rp:8}
};
/* Layout candidates, richest first: [density, helpers shown before "+N more"]. The first one that fits wins. */
const CANDIDATES=[['full',3],['roomy',3],['card',3],['card',1],['mini',3],['mini',1],['micro',3],['micro',1]];
let HCAP=1; /* helpers shown on a compact strip before "+N more" (a layout parameter, chosen with the density) */
let HBOOST=new Set(); /* with HCAP=1, agents that still get 3 because the floor has room left over (see chooseLayout) */
const helperCap=(d,a)=>d==='full'?DENS.full.cap:(a&&HBOOST.has(a.id)?3:HCAP);
const SC_CACHE=new Map();
function sceneC(a){const st=vis(a),k=a.look,key=st+k.shirt+k.skin+k.hair+k.style+(k.glasses?1:0);let v=SC_CACHE.get(key);if(!v){v=scene(a,false,true);SC_CACHE.set(key,v);}return v;}
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
function cardHTML(a,d,nSubs){
  const st=vis(a), use=usageShort(a);
  return `<button class="desk card is-${st}" data-id="${esc(a.id)}" aria-pressed="${ui.selected===a.id}" title="${esc(a.name)} · ${label(a)}: ${esc(a.task)}${use?' · '+use:''}" aria-label="${esc(a.name)}, ${esc(a.role)}, folder ${esc(roomOf(a).path)}, ${label(a)}: ${esc(a.task)}${nSubs?`. ${nSubs} helper${nSubs>1?'s':''}`:''}${use?'. Usage '+use:''}. Open chat panel.">
    <span class="sc">${sceneC(a)}</span>
    <span class="ci"><span class="l1"><span class="name">${esc(a.name)}</span>${modeIcon(a)}<span class="role">${esc(a.role)}</span><span class="stl st-${st}">${label(a,true)}</span></span>
    <span class="intent">${esc(a.task)}</span>
    <span class="l3"><span class="pill st-${st}"><i></i>${label(a,true)}</span><span class="use">${esc(use.split(' · ')[0]||'')}<span class="aiu">${use.includes(' · ')?' · '+esc(use.split(' · ')[1]):''}</span></span></span></span></button>`;
}
function linksSVG(d,rows,extraMore){
  const D=DENS[d]; const n=rows+(extraMore?1:0);
  let py,ys=[];
  if(d==='full'){py=78;for(let i=0;i<n;i++)ys.push(34+i*104);}
  else{py=D.ch/2;for(let i=0;i<rows;i++)ys.push(i*(D.hh+D.hgap)+D.hh/2);if(extraMore)ys.push(rows*(D.hh+D.hgap)+D.mh/2);}
  const w=d==='full'?24:16, mid=d==='full'?12:8;
  return `<svg class="links" aria-hidden="true" focusable="false"><g fill="none" stroke="#a9b6ad" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${ys.map(y=>`<path d="M0 ${py}H${mid}V${y}H${w}"/>`).join('')}</g><circle cx="0" cy="${py}" r="2.6" fill="#a9b6ad"/></svg>`;
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
    desk=`<button class="desk is-${st}" data-id="${esc(a.id)}" aria-pressed="${ui.selected===a.id}" aria-label="${esc(a.name)}, ${esc(a.role)}, folder ${esc(roomOf(a).path)}, ${label(a)}: ${esc(a.task)}${nSubs?`. ${nSubs} helper${nSubs>1?'s':''}`:''}. Open chat panel.">
      ${scene(a,false)}<span class="badge ${st}">${badgeSVG(st)}</span>
      <div class="info"><div class="who"><span class="name">${esc(a.name)}</span>${modeIcon(a)}<span class="role">${esc(a.role)}</span></div>
      <p class="task">${esc(a.task)}</p><span class="pill st-${st}"><i></i>${label(a)}</span></div></button>`;
  } else desk=cardHTML(a,d,nSubs);
  return `<div class="unit${nSubs?' has-h':''}" data-key="unit:${esc(a.id)}">${desk}${helpers}</div>`;
}
const unitWidth=(a,d)=>{const D=DENS[d];return D.cw+(helpersOf(a).length?(d==='full'?D.hw+14+8:D.hw+18):0);};
function officeModel(ignoreStatus){
  const rooms=[];
  ROOMS.forEach(r=>{
    if(r.hidden||(ui.ws!=='all'&&ui.ws!==r.id))return;
    const mains=agents.filter(a=>!a.parent&&a.room===r.id&&(ignoreStatus||matchStatus(a)));
    if(!mains.length)return;
    const key=a=>Math.min(prio(a),...helpersOf(a).map(prio));
    mains.sort((x,y)=>key(x)-key(y));
    rooms.push({r,mains,all:agents.filter(a=>wsOf(a)===r.id)});
  });
  return rooms;
}
/* ---- room doors (spec 017): a closed room is a compact door plate with a one-line status ---- */
const DOOR_OPEN='<svg class="door-svg" viewBox="0 0 20 20" aria-hidden="true" focusable="false"><rect x="4" y="2.5" width="12" height="15" rx="1.6" fill="#efe8d8" stroke="#b3a07c" stroke-width="1.2"/><path class="leaf" d="M4.4 3.2 9.6 4.6V15.4L4.4 16.8Z" fill="#d8c6a8" stroke="#a89572" stroke-width="1"/><circle cx="8.2" cy="10" r=".8" fill="#8a7650"/></svg>';
const DOOR_SHUT='<svg class="door-svg" viewBox="0 0 20 20" aria-hidden="true" focusable="false"><rect x="4" y="2.5" width="12" height="15" rx="1.6" fill="#d8c6a8" stroke="#a89572" stroke-width="1.2"/><rect x="6.2" y="4.7" width="7.6" height="4.4" rx=".9" fill="#e8dcc6"/><circle cx="13.1" cy="12" r="1" fill="#8a7650"/></svg>';
function roomSummary(r){
  const mains=agents.filter(a=>!a.parent&&a.room===r.id);
  const sum=window.DurbarRoom.summarizeRoom(mains.map(a=>({state:vis(a),helpers:helpersOf(a).map(vis)})));
  return Object.assign({n:mains.length},sum);
}
function plateHTML({r}){
  const sm=roomSummary(r);
  return `<button class="plate tone-${sm.tone}" type="button" data-door="${esc(r.id)}" data-key="door:${esc(r.id)}" data-tint="${r.tint}" aria-expanded="false" aria-label="Open room ${esc(r.name)}. ${esc(sm.text)}. ${sm.n} agent${sm.n===1?'':'s'}." title="${esc(r.path)}">${DOOR_SHUT}<span class="plate-tx"><b>${esc(r.name)}</b><span class="plate-sum">${esc(sm.text)}</span></span><span class="plate-n">${sm.n}</span></button>`;
}
const doorsHTML=list=>list.length?`<div class="doors" data-key="doors">${list.map(plateHTML).join('')}</div>`:'';
const stageHTML=(sizing,d,aw,cap)=>sizing.filter(m=>!m.r.closed).map(m=>roomHTML(m,d,aw,cap)).join('')+doorsHTML(sizing.filter(m=>m.r.closed));
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
  const vis_=ROOMS.filter(r=>!r.hidden&&(ui.ws==='all'||ui.ws===r.id)&&agents.some(a=>!a.parent&&a.room===r.id));
  const open=vis_.filter(r=>!r.closed).length, shut=vis_.length-open;
  b.hidden=vis_.length<2||ui.view!=='office';
  $('closeAll').disabled=!open; $('openAll').disabled=!shut;
}
function roomHTML({r,mains,all},d,aw,cap){
  const dots=['waiting','error','working','done','idle'].map(k=>{const n=all.filter(a=>{const s=vis(a);return k==='working'?(s==='working'||s==='thinking'):s===k}).length;return n?`<span class="rd${k==='waiting'?' attn':(k==='done'||k==='idle')?' calm':''}" title="${n} ${LABELS[k]}"><span class="dot ${k}"></span>${n}</span>`:''}).join('');
  const head=`<div class="room-head"><button class="door" type="button" data-door="${esc(r.id)}" aria-expanded="true" aria-label="Close room ${esc(r.name)}" title="Close the door: ${esc(r.name)} becomes a compact plate">${DOOR_OPEN}</button><span class="room-name" title="${esc(r.name)}">${esc(r.name)}</span><span class="room-path" title="${esc(r.path)}">${esc(r.path)}</span><span class="room-dots" aria-hidden="true">${dots}</span>${bridge&&bridge.newSession&&!demoOn?`<button class="room-new" type="button" data-newsess="${esc(r.id)}" title="New session in ${esc(r.name)}" aria-label="New session in ${esc(r.name)}">+</button>`:''}${PLANT}</div>`;
  if(d==='full'){
    const gap=6, pad=12;
    const widths=mains.map(a=>unitWidth(a,d));
    const basis=Math.min(aw,widths.reduce((x,y)=>x+y,0)+gap*(widths.length-1)+2*pad+30);
    const min=Math.max(...widths)+2*pad+30;
    return `<section class="room" data-key="room:${esc(r.id)}" data-tint="${r.tint}" style="--w:${Math.round(basis)};--min:${Math.round(min)}px" aria-label="Workspace ${esc(r.name)}">${head}
      <div class="units">${mains.map(a=>unitHTML(a,d)).join('')}</div></section>`;
  }
  /* compact: the room is a floor-plan zone with `cols` desk columns */
  const D=DENS[d], cols=Math.max(1,Math.min(mains.length,cap)), over=2*D.rp+4;
  const basis=cols*D.cw+(cols-1)*D.gap+over, min=D.cw+over;
  return `<section class="room" data-key="room:${esc(r.id)}" data-tint="${r.tint}" style="--w:${Math.round(basis)};--min:${Math.round(min)}px" aria-label="Workspace ${esc(r.name)}">${head}
    <div class="units" style="--cols:${cols}">${mains.map(a=>unitHTML(a,d)).join('')}</div></section>`;
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
  if(!openOnly.length){probe.innerHTML=doorsHTML(sizing);probe.dataset.d='card';const ok=probe.scrollHeight<=ah+1;probe.innerHTML='';return {d:'card',hcap:1,cap:1,fit:ok,boost:[]};}
  const fits=()=>probe.scrollHeight<=ah+1&&probe.scrollWidth<=aw+1;
  const cands=FORCE_DENSITY?CANDIDATES.filter(c=>c[0]===FORCE_DENSITY):CANDIDATES;
  let res=null, lastAny=null;
  for(const [d,hcap] of cands){
    HCAP=hcap; HBOOST=new Set(); probe.dataset.d=d; probe.style.height='auto';
    if(d==='full'){
      probe.innerHTML=stageHTML(sizing,d,aw);
      if(fits()){res={d,hcap,cap:0,fit:true};break;}
      lastAny={d,hcap,cap:0,fit:false};continue;
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
  /* Leftover floor space: with one helper per strip, give 3 to the agents with the most helpers (attention first) while it still fits. */
  if(res&&res.d!=='full'&&res.hcap===1){
    const many=openOnly.flatMap(m=>m.mains).filter(a=>helpersOf(a).length>2).sort((x,y)=>Math.min(prio(x),...helpersOf(x).map(prio))-Math.min(prio(y),...helpersOf(y).map(prio))||helpersOf(y).length-helpersOf(x).length);
    HCAP=1; probe.dataset.d=res.d;
    for(const a of many){
      HBOOST.add(a.id); probe.style.height='auto';
      probe.innerHTML=stageHTML(sizing,res.d,aw,res.cap);
      if(fits())res.boost.push(a.id); else HBOOST.delete(a.id);
    }
  }
  probe.innerHTML='';
  return res||lastAny;
}
let layoutKey='', layout=null;
function renderOffice(){
  if(ui.view!=='office')return;
  const floor=$('floor'), stage=$('stage'), cs=getComputedStyle(floor);
  const aw=floor.clientWidth-parseFloat(cs.paddingLeft)-parseFloat(cs.paddingRight);
  const ah=floor.clientHeight-parseFloat(cs.paddingTop)-parseFloat(cs.paddingBottom);
  if(aw<=0||ah<=0)return;
  const model=officeModel();
  if(!model.length){
    stage.dataset.d='card'; stage.style.width=aw+'px'; stage.style.height='auto'; layoutKey='';
    stage.innerHTML='<div class="empty">'+(!agents.length&&!demoOn?'No agents yet. Use "+ Folder" or "+ Workspace" above.':(agents.length&&ROOMS.every(r=>r.hidden)?'All folders are hidden. Open "Folders" above to show them again.':'No agents match these filters.'))+'</div>';
    floor.classList.remove('scrolls'); return;
  }
  /* Density is chosen from the unfiltered set so cards do not change shape when a status pill filters. */
  const sizing=ui.status?officeModel(true):model;
  const key=JSON.stringify([aw,ah,FORCE_DENSITY,sizing.map(m=>m.r.closed?[m.r.id,'closed']:[m.r.id,m.mains.map(a=>[a.id,helpersOf(a).length,!!ui.expanded[a.id]])])]);
  if(key!==layoutKey||!layout){layout=chooseLayout(sizing,aw,ah);layoutKey=key;}
  HCAP=layout.hcap; HBOOST=new Set(layout.boost);
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
  ROOMS.forEach(r=>{ if(r.hidden||(ui.ws!=='all'&&ui.ws!==r.id))return;
    agents.filter(a=>!a.parent&&a.room===r.id).slice().sort((x,y)=>Math.min(prio(x),...helpersOf(x).map(prio))-Math.min(prio(y),...helpersOf(y).map(prio))).forEach(a=>{
      const subs=helpersOf(a);
      if(matchStatus(a)){rows.push([a,false]);subs.forEach(h=>rows.push([h,true]));}
    });});
  const row=([a,sub])=>{const st=vis(a);return `<button class="lrow" data-id="${esc(a.id)}" aria-pressed="${ui.selected===a.id}" aria-label="${esc(a.name)}, ${esc(a.role)}, ${esc(roomOf(a).name)}, ${label(a)}: ${esc(a.task)}">
    <span class="lname"><span class="dot ${st}"></span><span class="${sub?'sub':''}">${esc(a.name)}</span></span><span class="lcell">${esc(a.role)}</span><span class="lcell mono">${esc(roomOf(a).name)}</span><span class="lcell">${esc(a.task)}</span><span><span class="pill st-${st}"><i></i>${label(a)}</span></span></button>`};
  $('list').innerHTML=`<div class="list-wrap" role="group" aria-label="Agents"><div class="lrow head" aria-hidden="true"><span>Agent</span><span>Role</span><span>Workspace</span><span>Current task</span><span>Status</span></div>${rows.map(row).join('')||'<div class="empty">No agents match these filters.</div>'}</div>`;
}

function renderAll(){
  const ae=document.activeElement, id=ae&&ae.dataset&&(ae.dataset.id||ae.dataset.more||ae.dataset.door), inPanel=ae&&ae.closest&&ae.closest('#panel');
  const key=ae&&ae.dataset&&(ae.dataset.id?'data-id':ae.dataset.more?'data-more':ae.dataset.door?'data-door':'');
  renderStats();
  if(ui.view==='office')renderOffice(); else renderList();
  renderDoorBar();
  if(id&&!inPanel){const n=document.querySelector(`[${key}="${CSS.escape(id)}"]`); if(n&&ae!==n)n.focus({preventScroll:true});}
  if(ui.selected){updatePanelHeader();renderStrip();}
}


/* ---------------- icons ---------------- */
const ICON={
 read:'<svg viewBox="0 0 16 16" fill="none" stroke="#5b7f94" stroke-width="1.5" stroke-linejoin="round"><path d="M4 1.8h5.2L12.5 5v9.2H4z"/><path d="M9 1.8V5.2h3.5"/></svg>',
 edit:'<svg viewBox="0 0 16 16" fill="none" stroke="#7f8a5b" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"><path d="M2.5 13.5l.7-3L11 2.7a1.4 1.4 0 0 1 2 2L5.5 12.8z"/></svg>',
 run:'<svg viewBox="0 0 16 16" fill="none" stroke="#4f7f65" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"><rect x="1.8" y="2.8" width="12.4" height="10.4" rx="2"/><path d="M4.8 6.2l2 1.8-2 1.8M8.6 10h2.6"/></svg>',
 search:'<svg viewBox="0 0 16 16" fill="none" stroke="#8a6f4a" stroke-width="1.5" stroke-linecap="round"><circle cx="7" cy="7" r="4.2"/><path d="M10.2 10.2l3.3 3.3"/></svg>',
 tool:'<svg viewBox="0 0 16 16" fill="none" stroke="#7a7f8c" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="2.2"/><path d="M8 1.8v1.8M8 12.4v1.8M1.8 8h1.8M12.4 8h1.8M3.6 3.6l1.3 1.3M11.1 11.1l1.3 1.3M12.4 3.6l-1.3 1.3M4.9 11.1l-1.3 1.3"/></svg>',
 back:'<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 3L4.5 8l5 5"/><path d="M5 8h8"/></svg>',
 chev:'<svg class="chev" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 2l4 4-4 4"/></svg>',
 file:'<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><path d="M4 1.8h5.2L12.5 5v9.2H4z"/><path d="M9 1.8V5.2h3.5"/></svg>',
 img:'<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"><rect x="1.8" y="2.8" width="12.4" height="10.4" rx="2"/><circle cx="5.6" cy="6.4" r="1.3"/><path d="M2.5 12l3.8-3.4 2.6 2.2 2-1.6 3 2.8"/></svg>',
 x:'<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M3 3l6 6M9 3l-6 6"/></svg>'
};
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
  el.innerHTML=`${ICON[k]||ICON.tool}<b>${esc(name)}</b><code>${esc(label)}</code>${res?`<span class="res">${el.className.includes('fail')?'Failed: ':''}${esc(res)}</span>`:''}<span class="detail">${esc(detail)}</span>`;
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
  m.innerHTML=`<div class="meta">${esc(a.name)}</div><div class="think streaming"><button class="think-toggle" aria-expanded="true">${ICON.chev}<span class="think-l">Thinking</span><span class="live" aria-hidden="true"><i></i><i></i><i></i></span></button><div class="think-body"></div></div><div class="chips" aria-label="Tool calls"></div>`;
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
    c.innerHTML=(x.img?ICON.img:ICON.file)+'<span>'+esc(x.name)+'</span>';box.appendChild(c);});
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
  box.innerHTML=attached.map((x,i)=>`<span class="att ${x.img?'img':''}" title="${esc(x.path||x.name)}${x.size?' ('+fmtSize(x.size)+')':''}">${x.img?ICON.img:ICON.file}<span>${esc(x.name)}</span><button type="button" data-rm="${i}" aria-label="Remove ${esc(x.name)}">${ICON.x}</button></span>`).join('')+(attached.length?`<span class="att-count" aria-live="polite">${attached.length}/${MAX_ATT_FILES}</span>`:'');
}
function autoGrow(){const t=$('msgInput');if(!t)return;t.style.height='auto';t.style.height=Math.min(110,t.scrollHeight)+'px';setSend();}
function setSend(){const b=$('sendBtn'),t=$('msgInput');if(!b||!t)return;const a=byId(ui.selected);const busy=a&&chats[a.id]&&chats[a.id].busy;b.setAttribute('aria-disabled',String(!!busy||(!t.value.trim()&&!attached.length)));}

function updatePanelHeader(){
  const a=byId(ui.selected); if(!a)return; const st=vis(a);
  const ph=$('panelHead'); if(!ph)return;
  const sp=ph.querySelector('[data-f=status]'); sp.className='pill st-'+st; sp.innerHTML='<i></i>'+label(a);
  const t=ph.querySelector('[data-f=task]'); t.textContent=a.task; t.title=a.task;
  ph.querySelector('[data-f=usage]').textContent=usageLong(a);
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
   <div class="strip" role="navigation" aria-label="Agents"><button class="btn back" id="backBtn" type="button" title="Back to the office (Esc)">${ICON.back}<span>Office</span></button><div class="strip-list" id="stripList"></div></div>
   <div class="ph" id="panelHead"><div class="ph-top"><div class="avatar">${avatar(a)}</div><div class="ph-id"><h2 id="panelTitle" tabindex="-1">${esc(a.name)}</h2><div class="sub">${esc(a.role)}${parent?' · helper of '+esc(parent.name):''}</div></div>
      <div class="ph-meta"><span data-f="status"></span>${a.live&&a.info&&!a.parent&&bridge.setPermMode?modeChipHTML(a):''}${mdlName?`<span class="mchip" title="${esc(mdlName.title)}">${esc(mdlName.text)}</span>`:''}<span class="folder" title="${esc(room.path)}"><svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" style="flex:none"><path d="M1.8 4.2a1.4 1.4 0 0 1 1.4-1.4h3l1.6 1.8h4.8a1.4 1.4 0 0 1 1.4 1.4v6.2a1.4 1.4 0 0 1-1.4 1.4H3.2a1.4 1.4 0 0 1-1.4-1.4z"/></svg><span class="folder-t">${esc(room.path)}</span></span></div>
      <div class="actions">${a.live&&bridge.newSession&&!a.parent?`<button class="btn" id="newSessBtn" type="button" title="Another agent with its own chat in this folder">+ New session</button>`:''}<button class="btn primary" id="vscodeBtn" type="button" title="Open this folder in VS Code"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5.5 4.5L2 8l3.5 3.5M10.5 4.5L14 8l-3.5 3.5M9 3l-2 10"/></svg>Open in VS Code</button>
        ${a.live&&!a.parent?`<button class="btn" id="copyResBtn" type="button" title="Copy a command that continues this session in a terminal (end the session here first)">Copy resume command</button>`:''}
        <button class="btn" id="pauseBtn" type="button"><svg viewBox="0 0 16 16" fill="currentColor"><rect x="4" y="3" width="2.8" height="10" rx="1"/><rect x="9.2" y="3" width="2.8" height="10" rx="1"/></svg><span>Pause</span></button>
        <button class="btn danger" id="stopBtn" type="button" title="${a.live?'Interrupt the current turn. The agent stays open and ready.':'Stop'}"><svg viewBox="0 0 16 16" fill="currentColor"><rect x="3.5" y="3.5" width="9" height="9" rx="2"/></svg>Stop</button>
        ${a.live&&bridge.end&&!a.parent?`<button class="btn" id="endBtn" type="button" title="End this session and free it. Sending a message later resumes it.">End session</button>`:''}</div></div>
    <p class="ptask" data-f="task"></p><p class="pusage" data-f="usage"></p>
    <div class="grants" id="grants" aria-label="Permissions allowed for this session" hidden></div></div>
   <div class="prev" id="prev" hidden></div>
   <div id="chat" role="log" aria-live="off" aria-label="Chat with ${esc(a.name)}" tabindex="0"></div>
   <div class="composer"><div class="att-note" id="attNote" role="alert" hidden></div><div class="attached" id="attached" aria-label="Attachments"></div>
    <div class="inbox"><button class="ib" id="attFile" type="button" aria-label="Attach file" title="Attach file">${ICON.file}</button><button class="ib" id="attImg" type="button" aria-label="Attach image" title="Attach image">${ICON.img}</button>
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
  if($('endBtn'))$('endBtn').onclick=()=>endLive(a);
  if($('copyResBtn'))$('copyResBtn').onclick=()=>copyResume(a);
  if(a.live&&!a.parent)initPrev(a); else {const pv=$('prev');if(pv)pv.hidden=true;}
  $('pauseBtn').onclick=()=>{a.paused=!a.paused;toast(esc(a.name)+(a.paused?' paused.':' resumed.'));renderAll();};
  $('stopBtn').onclick=()=>{if(a.live)return stopLive(a);a.paused=false;a.state='idle';a.label='Stopped';a.task='Stopped by you. Ready for a new task.';toast(esc(a.name)+' stopped.');renderAll();};
  $('attFile').onclick=()=>{if(a.live)return pickLive();addPicked([{name:SAMPLE_FILES[fi++%SAMPLE_FILES.length],kind:'file',size:12*1024}]);};
  $('attImg').onclick=()=>{if(a.live)return pickLive();addPicked([{name:SAMPLE_IMGS[ii++%SAMPLE_IMGS.length],kind:'image',size:240*1024}]);};
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
  if(a.live){const h=document.querySelector('#panel .hint');if(h)h.textContent='Enter sends, Shift+Enter adds a line. Drop or paste images to attach. '+(SIM?'Simulated session (no AI credits)':'Live Copilot session')+' ('+a.info.permMode+').';}
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
    ROOMS.filter(r=>!r.hidden&&(ui.ws==='all'||ui.ws===r.id)&&agents.some(a=>!a.parent&&a.room===r.id)).forEach(r=>setRoomClosed(r,shut,true));
    layoutKey='';renderAll();return;}
  const st=e.target.closest('.stat'); if(st){const k=st.dataset.k;ui.status=ui.status===k?null:k;renderAll();const n=document.querySelector(`.stat[data-k="${k}"]`);if(n)n.focus();return;}
  const mo=e.target.closest('[data-more]'); if(mo){const id=mo.dataset.more;ui.expanded[id]=!ui.expanded[id];renderAll();return;}
  const cm=e.target.closest('.chips-more'); if(cm){const box=cm.parentNode;box.dataset.exp=box.dataset.exp==='1'?'0':'1';refreshChips(box);return;}
  const chip=e.target.closest('#chat .chip:not(.att-chip)'); if(chip){const o=chip.classList.toggle('open');chip.setAttribute('aria-expanded',String(o));return;}
  const sw=e.target.closest('[data-sw]'); if(sw){openPanel(sw.dataset.sw,e.detail===0);return;}
  const ns=e.target.closest('[data-newsess]'); if(ns){const r=ROOMS.find(x=>x.id===ns.dataset.newsess),ag=r&&agents.find(x=>!x.parent&&x.room===r.id);if(ag)newSession(ag);return;}
  const t=e.target.closest('[data-id]'); if(t&&!t.closest('#panel')){openPanel(t.dataset.id,e.detail===0);}
});
/* a file dropped anywhere else must not navigate the window away */
['dragover','drop'].forEach(t=>window.addEventListener(t,e=>{if(e.dataTransfer&&[...(e.dataTransfer.types||[])].includes('Files'))e.preventDefault();}));
document.addEventListener('keydown',e=>{
  if(e.key==='Escape'){
    if(document.getElementById('sessDlg')){closeSessDlg();return;}
    if(!$('foldersPop').hidden){toggleFolders(false);return;}
    if(vsViewing){leaveVsView();return;}
    if(ui.selected){closePanel();return;}
  }
  if((e.key==='Enter'||e.key===' ')&&e.target.matches&&e.target.matches('#chat .chip:not(.att-chip)')){e.preventDefault();e.target.click();}
});
$('wsFilter').addEventListener('change',e=>{ui.ws=e.target.value;renderAll();});
function setView(v){ui.view=v;document.body.classList.toggle('list-mode',v==='list');
  $('vOffice').setAttribute('aria-pressed',String(v==='office'));$('vList').setAttribute('aria-pressed',String(v==='list'));renderAll();}
$('vOffice').onclick=()=>setView('office');
$('vList').onclick=()=>setView('list');
let resizeQueued=false;
const relayout=()=>{if(resizeQueued)return;resizeQueued=true;requestAnimationFrame(()=>{resizeQueued=false;if(ui.view==='office')renderOffice();});};
new ResizeObserver(relayout).observe($('floor'));
window.addEventListener('resize',relayout);


/* ---------------- LIVE MODE (Electron bridge, or the simulated agents dev mode) ---------------- */
/* DURBAR_SIM=N (Electron env, passed as ?sim=N) or ?sim=N in a plain browser feeds fake normalized
   events through exactly the same onLiveEvent path as the Copilot adapter. No AI credits are used. */
const SIM = qs.has('sim') ? Math.max(1,Math.min(40,parseInt(qs.get('sim')||'12',10)||12)) : 0;
const sim = SIM && window.__durbarSim ? window.__durbarSim.create({n:SIM, freeze:qs.get('simfreeze')==='1', solo:qs.get('simrooms')==='solo', seed:parseInt(qs.get('seed')||'7',10)}) : null;
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
  b.title=SIM&&!demoOn?'Fake events, no sessions started, no AI credits used':'';b.textContent=demoOn?'Prototype - sample data':SIM?'Simulated agents':'Live - Copilot';}
function applyMode(){
  agents=demoOn?DEMO.agents:LIVE.agents; ROOMS=demoOn?DEMO.rooms:LIVE.rooms;
  ui.ws='all'; ui.status=null;
  if(ui.selected)closePanel();
  setBadge(); renderFilter(); renderAll();
}
function liveChat(a){
  if(chats[a.id])return chats[a.id];
  const el=document.createElement('div');el.className='chat-inner';
  const chat=chats[a.id]={el,busy:false};
  if(a.sub)buildSubTranscript(a,chat);
  return chat;
}
function addNote(chat,html,err){const n=document.createElement('div');n.className='note'+(err?' err':'');n.innerHTML=html;chat.el.appendChild(n);scrollChat(chat);return n;}
const MODE_NAME={'read-only':'Read-only','ask':'Ask first','allow':'Allow edits'};
const MODE_TEXT={'read-only':'read-only','allow':'can edit','ask':'asks first'};
const MODE_HELP={'read-only':'Reads only. Edits, commands and other changes are denied.','ask':'Asks before every edit or command. You can approve for the rest of the session.','allow':'Edits, commands and other changes run without asking.'};
const roleFor=info=>'Copilot ('+MODE_TEXT[info.permMode]+')'+(info.model&&info.model!=='auto'?' · '+info.model:'');
const MODE_IC={
 'read-only':'<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3.2" y="7" width="9.6" height="6.6" rx="1.6"/><path d="M5.4 7V5.4a2.6 2.6 0 0 1 5.2 0V7"/></svg>',
 'ask':'<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 1.8l5 1.8v3.8c0 3-2.1 5.2-5 6.6-2.9-1.4-5-3.6-5-6.6V3.6z"/><path d="M6.2 7.8l1.4 1.4 2.4-2.6"/></svg>',
 'allow':'<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"><path d="M2.5 13.5l.7-3L11 2.7a1.4 1.4 0 0 1 2 2L5.5 12.8z"/></svg>'};
const modeIcon=a=>a&&a.live&&a.info&&!a.parent&&a.info.permMode?`<span class="modeic mode-${a.info.permMode}" title="${esc(MODE_NAME[a.info.permMode])}: ${esc(MODE_HELP[a.info.permMode])} (right-click for options)" aria-hidden="true">${MODE_IC[a.info.permMode]}</span>`:'';
function addLiveAgent(info){
  if(liveById(info.id))return;
  let room=LIVE.rooms.find(r=>r.path===info.cwd);
  if(!room){room={id:'r'+LIVE.rooms.length+':'+info.cwd,name:(info.roomName||info.name),path:info.cwd,tint:TINTS[LIVE.rooms.length%4],hidden:!!info.hidden,closed:!!info.closed||CLOSED_Q.includes(info.roomName||info.name)};LIVE.rooms.push(room);}
  let name=info.name; const dup=LIVE.agents.filter(x=>!x.parent&&x.room===room.id&&x.baseName===info.name).length; if(dup)name=info.name+' #'+(dup+1);
  LIVE.agents.push({id:info.id,name,baseName:info.name,role:info.role||roleFor(info),room:room.id,state:'idle',label:info.lazy?'Not started':'Ready',task:info.lazy?'Saved folder. A session starts with your first message.':'Ready. Send a message to start.',
    look:lookFor(info.id),files:[],paused:false,live:true,info,usage:{calls:0,inT:0,outT:0,nano:0},usageText:'',turn:null,worked:false,pend:new Map(),settled:new Set(),grants:[]});
  if(!demoOn){if(!ui.expanded)ui.expanded={};renderFilter();scheduleRender();}
  if(pendingOpen===info.id){pendingOpen=null;if(!demoOn)openPanel(info.id,false);}
}
/* ---------------- chat timeline: thinking, tools, text and sub-agent blocks in arrival order (spec 015) ---------------- */
/* Markdown (spec 016): renders are batched per animation frame and patched into the existing DOM, so streaming does not flicker. */
const MDQ=new Set();
function mdHTML(raw){
  const md=window.DurbarMD; if(!md)return esc(raw).replace(/\n/g,'<br>');
  return md.render(raw).replace(/<pre>/g,'<div class="codebox"><button type="button" class="copy" aria-label="Copy code">Copy</button><pre>').replace(/<\/pre>/g,'</pre></div>');
}
function mdPaint(el){el._mdq=false;if(el._raw==null)return;const t=document.createElement('template');t.innerHTML=mdHTML(el._raw);morphChildren(el,t.content);}
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
  el.innerHTML=`<button class="think-toggle" type="button" aria-expanded="true">${ICON.chev}<span class="think-l">Thinking</span><span class="think-prev"></span><span class="live" aria-hidden="true"><i></i><i></i><i></i></span></button><div class="think-body md"></div>`;
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
  el.innerHTML=`<div class="sub-head"><button class="sub-toggle" type="button" aria-expanded="true">${ICON.chev}<span class="sub-ic">${SUBIC}</span><b class="sub-name"></b><span class="sub-task"></span><span class="sub-st"></span></button><button class="sub-open" type="button" title="Open this sub-agent's full activity (read-only)">Open</button></div><div class="sub-in"></div>`;
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
    const u=s.usage;u.calls++;u.inT+=e.inputTokens||0;u.outT+=e.outputTokens||0;u.nano+=e.nanoAiu||0;
    const cu=card.usage;cu.calls=u.calls;cu.inT=u.inT;cu.outT=u.outT;cu.nano=u.nano;card.usageText=usageLong(card);
    const p=a.usage;p.calls++;p.inT+=e.inputTokens||0;p.outT+=e.outputTokens||0;p.nano+=e.nanoAiu||0;a.usageText=usageLong(a);
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
  if(ch)scheduleRender();
}
const plainMd=t=>String(t==null?'':t).replace(/```[\s\S]*?```/g,' code ').replace(/!?\[([^\]]*)\]\([^)]*\)/g,'$1').replace(/^[#>\-*\s]+/gm,'').replace(/[*_`~]/g,'').replace(/\s+/g,' ').trim();
const SHORT=(v,n)=>{v=String(v==null?'':v).replace(/\s+/g,' ');return v.length>n?v.slice(0,n-1)+'…':v;};
function toolLabel(args){
  if(!args||typeof args!=='object')return '';
  const v=args.path||args.pattern||args.command||args.url||args.query||args.file_path||Object.values(args).find(x=>typeof x==='string')||'';
  return String(v).replace(/\s+/g,' ').slice(0,400);
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
    const answer=(approve,remember)=>{bridge.resolvePermission(a.id,p.requestId,approve,remember);settlePerm(a,{requestId:p.requestId,state:approve?'approved':'denied',via:'user',remembered:approve&&remember,scopeLabel:p.scopeLabel,summary:p.summary});};
    mk('Approve','primary','Allow this one request',()=>answer(true,false));
    if(p.scopeKey)mk('Approve for this session','session','Allow "'+(p.scopeLabel||p.kind)+'" until you stop this session. Shown as a chip you can revoke.',()=>answer(true,true));
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
  box.innerHTML=(a.grants||[]).map(g=>`<span class="gchip" title="Allowed for this session: ${esc(g.label)}. Revoke to be asked again."><span>Allowed: ${esc(g.label)}</span><button type="button" data-revoke="${esc(g.key)}" aria-label="Revoke permission: ${esc(g.label)}">${ICON.x}</button></span>`).join('');
  box.hidden=!(a.grants||[]).length;
}
function onLiveEvent(e){
  const a=liveById(e.sessionId); if(!a)return;
  if(e.type==='subagent')return onSubagent(a,e);
  if(e.agentId&&e.type!=='permission'&&e.type!=='grants')return onSubEvent(a,e);
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
    else if(e.status==='idle'&&e.intent==='Aborted'){const was=a.worked;a.worked=false;closeTurn(a);
      [...a.pend.keys()].forEach(id=>settlePerm(a,{requestId:id,state:'denied',via:'stopped'}));
      if(was)addNote(chat,'Stopped by you. The agent is ready for your next message.');
      setState(a,'idle','Ready','Stopped. Ready for your next message.');}
    else if(e.status==='idle'){const was=a.worked;a.worked=false;closeTurn(a);
      if(was)setState(a,'done','Done',a.lastOutput?SHORT(plainMd(a.lastOutput),140):'Finished.'); else setState(a,'idle','Ready',a.task);}
    else if(e.status==='error'){closeTurn(a);addNote(chat,esc(e.intent||'Error'),true);setState(a,'error',null,SHORT(e.intent||'Error',140));}
    else if(e.status==='stopped'){
      /* a permission still pending when the session stops is denied cleanly: no Approve/Deny left behind, grants gone */
      [...a.pend.keys()].forEach(id=>settlePerm(a,{requestId:id,state:'denied',via:'stopped'}));
      setGrants(a,[]);
      closeTurn(a);setState(a,'idle','Ended','Session ended. Send a message to resume it.');}
    return;
  case 'permission':if(main)settlePerm(a,e.permission);return;
  case 'grants':setGrants(a,e.grants||[]);return;
  case 'thinking':{const t=ensureTurn(a);tThink(t.T,e.reasoningId,e.delta);setState(a,'thinking',null);return;}
  case 'output':{const t=ensureTurn(a);const out=tText(t.T,e);if(out!=null)a.lastOutput=out;setState(a,'working',null);return;}
  case 'toolCall':{const t=ensureTurn(a);
    if(isTaskTool(e.tool)||(t.T.chipEls[e.callId]===undefined&&a.subs&&a.subs.has(e.callId)))onTaskTool(a,e);
    else tTool(t.T,e);
    if(e.phase==='start'&&!isTaskTool(e.tool)){const label=toolLabel(e.args);setState(a,a.state==='thinking'?'working':a.state,null,a.intent||(e.tool+(label?' '+SHORT(label,90):'')));}
    scrollChat(chat);return;}
  case 'usage':{const u=a.usage;u.calls++;u.inT+=e.inputTokens||0;u.outT+=e.outputTokens||0;u.nano+=e.nanoAiu||0;
    a.usageText=usageLong(a);scheduleRender();
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
async function pickLive(){addPicked(await bridge.pickAttachments());}
async function openLive(a){
  const r=await bridge.openInVSCode(liveRoot(a).id);
  toast(r.ok?'Opening in VS Code…':'Could not open VS Code: '+esc(r.error||'unknown error'),4200);
}
async function stopLive(a){const r=liveRoot(a);await bridge.stop(r.id);toast(esc(r.name)+': stopped the current turn. It is ready for your next message.');}
async function endLive(a){const r=liveRoot(a);await (bridge.end||bridge.stop)(r.id);toast(esc(r.name)+': session ended. Sending a message resumes it.',4200);}
async function copyResume(a){const r=liveRoot(a),cmd='copilot --resume '+r.id;
  try{await navigator.clipboard.writeText(cmd);toast('Copied <code>'+esc(cmd)+'</code>. End the session here first, then run it in a terminal in '+esc(roomOf(r).path)+'. In VS Code, turn on the sessions list filter External to see sessions started here.',9000);}
  catch{toast('Run <code>'+esc(cmd)+'</code> in a terminal in '+esc(roomOf(r).path)+' (end the session here first).',8000);}}
/* ---------------- full-screen chat: the strip of all agents ---------------- */
function stripAgents(){
  return agents.filter(x=>!x.parent&&!roomOf(x).hidden).map((x,i)=>[x,i]).sort((p,q)=>prio(p[0])-prio(q[0])||p[1]-q[1]).map(p=>p[0]);
}
function renderStrip(){
  const box=$('stripList'); if(!box)return;
  const cur=byId(ui.selected), root=cur?(cur.parent||cur.id):null;
  morphHTML(box,stripAgents().map(x=>{const st=vis(x),attn=st==='waiting'||st==='error';
    return `<button class="sitem st-${st}${attn?' attn':''}${x.id===root?' sel':''}" type="button" data-sw="${esc(x.id)}" data-key="sw:${esc(x.id)}" aria-current="${x.id===root}" title="${esc(x.name)} · ${esc(label(x,true))}: ${esc(x.task)}" aria-label="${esc(x.name)}, ${esc(label(x,true))}. Open chat."><span class="sav">${avatar(x)}</span><span class="stx"><b>${esc(x.name)}</b><span class="sst"><span class="dot ${st}"></span><span class="sw">${esc(label(x,true))}</span><span class="sin">${esc(SHORT(x.task,48))}</span></span></span></button>`;}).join(''));
}


/* ---------------- permission mode: change it at any time (spec 018) ---------------- */
function modeChipHTML(a){const m=a.info.permMode;
  return `<button class="mode-chip mode-${m}" id="modeChip" type="button" aria-haspopup="menu" aria-expanded="false" title="Permission mode: ${esc(MODE_NAME[m])}. ${esc(MODE_HELP[m])} Click to change; it applies from the next request."><span class="mi">${MODE_IC[m]}</span><span>${esc(MODE_NAME[m])}</span>${ICON.chev}</button>`;}
function closeModeMenu(){const m=document.getElementById('modeMenu');if(m){m.remove();const c=$('modeChip');if(c)c.setAttribute('aria-expanded','false');}}
function openModeMenu(a0,x,y,anchor){
  const a=liveRoot(a0); if(!a||!a.live||!bridge.setPermMode)return;
  closeModeMenu();
  const m=document.createElement('div');m.id='modeMenu';m.className='mode-menu';m.setAttribute('role','menu');m.setAttribute('aria-label','Permission mode for '+a.name);
  m.innerHTML=['read-only','ask','allow'].map(k=>`<button type="button" role="menuitemradio" aria-checked="${a.info.permMode===k}" data-mode="${k}" class="mm-${k}"><span class="mi">${MODE_IC[k]}</span><span class="mt"><b>${MODE_NAME[k]}</b><small>${esc(MODE_HELP[k])}</small></span><span class="ck">${a.info.permMode===k?'✓':''}</span></button>`).join('')+`<p class="mm-note">Applies from the next request. The session keeps running.</p>`;
  document.body.appendChild(m);
  const r=m.getBoundingClientRect(); const px=Math.max(8,Math.min(x,innerWidth-r.width-8)), py=Math.max(8,Math.min(y,innerHeight-r.height-8));
  m.style.left=px+'px';m.style.top=py+'px';
  m.addEventListener('click',e=>{const b=e.target.closest('[data-mode]');if(!b)return;closeModeMenu();changeMode(a,b.dataset.mode);if(anchor&&anchor.focus&&document.contains(anchor))anchor.focus();});
  m.addEventListener('keydown',e=>{const it=[...m.querySelectorAll('[data-mode]')],i=it.indexOf(document.activeElement);
    if(e.key==='ArrowDown'){e.preventDefault();it[(i+1)%it.length].focus();}else if(e.key==='ArrowUp'){e.preventDefault();it[(i+it.length-1)%it.length].focus();}
    else if(e.key==='Escape'||e.key==='Tab'){e.preventDefault();e.stopPropagation();closeModeMenu();if(anchor&&anchor.focus&&document.contains(anchor))anchor.focus();}});
  (m.querySelector('[aria-checked="true"]')||m.querySelector('button')).focus();
  const c=$('modeChip');if(c&&anchor===c)c.setAttribute('aria-expanded','true');
}
/* small modal: returns {value, checked} or null when dismissed */
function askDialog({title,body,buttons,check}){
  return new Promise(resolve=>{
    const old=document.getElementById('modeDlg');if(old)old.remove();
    const d=document.createElement('div');d.id='modeDlg';d.className='dlg-ov';
    d.innerHTML=`<div class="dlg" role="alertdialog" aria-modal="true" aria-labelledby="mdT" aria-describedby="mdB"><h3 id="mdT"></h3><p class="dsub" id="mdB"></p>${check?'<label class="chk"><input type="checkbox" id="mdChk"><span></span></label>':''}<div class="dbtn"></div></div>`;
    d.querySelector('#mdT').textContent=title;d.querySelector('#mdB').textContent=body;
    if(check){d.querySelector('.chk span').textContent=check.label;d.querySelector('#mdChk').checked=!!check.checked;}
    const row=d.querySelector('.dbtn');
    const done=v=>{d.remove();resolve(v);};
    buttons.forEach(b=>{const el=document.createElement('button');el.type='button';el.className='btn'+(b.cls?' '+b.cls:'');el.textContent=b.label;el.onclick=()=>done(b.value===null?null:{value:b.value,checked:check?d.querySelector('#mdChk').checked:false});row.appendChild(el);});
    d.addEventListener('click',e=>{if(e.target===d)done(null);});
    d.addEventListener('keydown',e=>{if(e.key==='Escape'){e.stopPropagation();done(null);}});
    document.body.appendChild(d);
    (row.querySelector('.primary')||row.lastElementChild).focus();
  });
}
async function changeMode(a,mode){
  const cur=a.info.permMode; if(mode===cur||!bridge.setPermMode)return;
  const pend=a.pend?a.pend.size:0, grants=(a.grants||[]).length;
  const opts={};
  if(mode==='allow'){
    const r=await askDialog({title:'Allow edits for '+a.name+'?',body:'Edits, shell commands and other changes will run without asking, in '+roomOf(a).path+'. Nothing is undone automatically; you can switch back at any time.',
      check:pend?{label:'Also approve the '+pend+' request'+(pend>1?'s':'')+' waiting now',checked:true}:null,
      buttons:[{label:'Cancel',value:null},{label:'Allow edits',value:'ok',cls:'primary warn'}]});
    if(!r)return; opts.approvePending=!!r.checked;
  } else if(grants){
    const r=await askDialog({title:'Switch '+a.name+' to '+MODE_NAME[mode]+'?',body:'This session has '+grants+' remembered "Approve for this session" permission'+(grants>1?'s':'')+'. Keep them for when you switch back, or clear them now?',
      buttons:[{label:'Cancel',value:null},{label:'Switch, keep them',value:'keep'},{label:'Switch and clear them',value:'clear',cls:'primary'}]});
    if(!r)return; opts.clearGrants=r.value==='clear';
  }
  const res=await bridge.setPermMode(a.id,mode,opts).catch(e=>({ok:false,error:String(e&&e.message||e)}));
  if(!res||!res.ok){toast('Could not change the mode: '+esc((res&&res.error)||'unknown error'),5000);return;}
  a.info.permMode=mode; a.role=roleFor(a.info);
  if(opts.clearGrants)setGrants(a,[]);
  toast(esc(a.name)+': <b>'+esc(MODE_NAME[mode])+'</b> from the next request.'+(mode==='allow'?' Edits run without asking.':''),4200);
  if(ui.selected&&liveRoot(byId(ui.selected)||a)===a){const c=$('modeChip');if(c){c.outerHTML=modeChipHTML(a);}const h=document.querySelector('#panel .hint');if(h)h.textContent=h.textContent.replace(/\([a-z\-]+\)\.?$/,'('+a.info.permMode+').');updatePanelHeader();}
  scheduleRender();
}
document.addEventListener('click',e=>{
  const chip=e.target.closest('#modeChip');
  if(chip){e.stopPropagation();if(document.getElementById('modeMenu')){closeModeMenu();return;}const r=chip.getBoundingClientRect(),a=byId(ui.selected);if(a)openModeMenu(a,r.left,r.bottom+6,chip);return;}
  if(!e.target.closest('#modeMenu'))closeModeMenu();
},true);
document.addEventListener('contextmenu',e=>{
  const d=e.target.closest('.desk[data-id], .helper[data-id], .lrow[data-id]');if(!d||d.closest('#panel'))return;
  const a=byId(d.dataset.id),ra=a&&liveRoot(a);if(!ra||!ra.live||!bridge.setPermMode)return;
  e.preventDefault();const r=d.getBoundingClientRect();
  openModeMenu(ra,e.clientX||r.left+16,e.clientY||r.top+16,d);
});

/* ---------------- model + effort ---------------- */
let MODELS=[];
function modelLabel(info){
  const m=MODELS.find(x=>x.id===(info.model||'auto')), nm=m?m.name:(info.model||'auto')==='auto'?'Auto':info.model;
  const eff=info.effort?' · '+info.effort+' effort':'';
  const mult=m&&m.multiplier!=null?' · ×'+m.multiplier+' credit multiplier':'';
  return {text:nm+eff,title:'Model: '+nm+eff+mult+(m&&m.multiplier!=null?' (as reported by your Copilot account)':'')};
}
function fillModelSelect(sel,cur){
  sel.innerHTML=(MODELS.length?MODELS:[{id:'auto',name:'Auto'}]).map(m=>`<option value="${esc(m.id)}">${esc(m.name)}${m.multiplier!=null?' ×'+m.multiplier:''}</option>`).join('');
  sel.value=MODELS.some(m=>m.id===cur)?cur:'auto';
}
function fillEffortSelect(sel,modelId,cur){
  const m=MODELS.find(x=>x.id===modelId), ef=(m&&m.efforts)||[];
  sel.hidden=!ef.length; sel.innerHTML=ef.length?'<option value="">Effort: default'+(m.defaultEffort?' ('+esc(m.defaultEffort)+')':'')+'</option>'+ef.map(x=>`<option value="${esc(x)}">Effort: ${esc(x)}</option>`).join(''):'';
  if(ef.includes(cur))sel.value=cur;
}
async function loadModels(){
  if(!bridge.listModels)return;
  const r=await bridge.listModels().catch(()=>null);
  if(!r||!r.ok||!r.models.length)return;
  MODELS=r.models;
  const ms=$('modelSel');
  ms.innerHTML=MODELS.map(m=>`<option value="${esc(m.id)}">Model: ${esc(m.name)}${m.multiplier!=null?' ×'+m.multiplier:''}</option>`).join('');
  ms.value=MODELS.some(m=>m.id==='auto')?'auto':MODELS[0].id;
  ms.title='Model for new sessions. This is what your Copilot account offers; × is the cost multiplier the API reports.';
  fillEffortSelect($('effortSel'),ms.value);
}

/* ---------------- new session (another agent in a folder) ---------------- */
function closeSessDlg(){const d=document.getElementById('sessDlg');if(d)d.remove();}
function newSession(a0){
  const a=liveRoot(a0); if(!bridge.newSession)return;
  closeSessDlg();
  const d=document.createElement('div');d.id='sessDlg';d.className='dlg-ov';
  d.innerHTML=`<div class="dlg" role="dialog" aria-modal="true" aria-labelledby="sdT"><h3 id="sdT">New session in ${esc(roomOf(a).name)}</h3>
   <p class="dsub">Another agent with its own chat in <code>${esc(roomOf(a).path)}</code>.</p>
   <label>Permissions<select id="sdPerm"><option value="read-only">Read-only</option><option value="ask">Ask first</option><option value="allow">Allow edits</option></select></label>
   <label>Model<select id="sdModel"></select></label>
   <label id="sdEffL">Reasoning effort<select id="sdEff"></select></label>
   <div class="dbtn"><button class="btn" id="sdCancel" type="button">Cancel</button><button class="btn primary" id="sdGo" type="button">Start session</button></div></div>`;
  document.body.appendChild(d);
  $('sdPerm').value=a.info.permMode||'read-only';
  fillModelSelect($('sdModel'),a.info.model||'auto');
  const eff=()=>{fillEffortSelect($('sdEff'),$('sdModel').value,a.info.effort);$('sdEffL').hidden=$('sdEff').hidden;};
  eff(); $('sdModel').onchange=eff;
  d.addEventListener('click',e=>{if(e.target===d)closeSessDlg();});
  $('sdCancel').onclick=closeSessDlg;
  $('sdGo').onclick=async()=>{
    const opts={permMode:$('sdPerm').value,model:$('sdModel').value,effort:$('sdEff').hidden?undefined:($('sdEff').value||undefined)};
    $('sdGo').disabled=true;$('sdGo').textContent='Starting…';
    const r=await bridge.newSession(a.id,opts);
    closeSessDlg();
    if(!r.ok){toast('Could not start a session: '+esc(r.error||'unknown error'),6000);return;}
    addLiveAgent(r.agent); openPanel(r.agent.id,false);
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
function renderFolders(){
  const pop=$('foldersPop'); if(pop.hidden)return;
  if(!ROOMS.length){pop.innerHTML='<p class="fp-empty">No folders yet. Use + Folder or + Workspace. Folders you add are remembered next time.</p>';return;}
  pop.innerHTML='<div class="fp-h">Folders <small>remembered across restarts</small></div>'+ROOMS.map(r=>{
    const n=agents.filter(x=>!x.parent&&x.room===r.id).length;
    return `<div class="fp-row${r.hidden?' hid':''}"><div class="fp-t"><b title="${esc(r.name)}">${esc(r.name)}${r.hidden?' <span class="tag">hidden</span>':''}</b><small title="${esc(r.path)}">${esc(r.path)} · ${n} agent${n===1?'':'s'}</small></div>
     <button class="btn" type="button" data-fp="new" data-room="${esc(r.id)}">New session</button><button class="btn" type="button" data-fp="hide" data-room="${esc(r.id)}">${r.hidden?'Show':'Hide'}</button><button class="btn danger" type="button" data-fp="rm" data-room="${esc(r.id)}">Remove</button></div>`;}).join('');
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
  const msg=busy?`${esc(r.name)} has ${busy} agent${busy===1?'':'s'} still working. Remove the folder and end ${busy===1?'it':'them'}?`:`Remove ${esc(r.name)}? Its sessions end here; your earlier Copilot sessions stay on disk and can be resumed if you add the folder again.`;
  if(!window.confirm(msg.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"')))return;
  const root=ags.find(x=>!x.parent); const res=root&&bridge.removeFolder?await bridge.removeFolder(root.id):{ok:true,removedIds:[]};
  if(!res.ok){toast('Could not remove the folder.',4000);return;}
  if(ui.selected&&(byId(ui.selected)||{}).room===r.id)closePanel();
  const gone=new Set(ags.map(x=>x.id));
  for(let i=agents.length-1;i>=0;i--){if(gone.has(agents[i].id)||gone.has(agents[i].parent)){delete chats[agents[i].id];delete prev[agents[i].id];agents.splice(i,1);}}
  const ri=ROOMS.indexOf(r); if(ri>=0)ROOMS.splice(ri,1);
  if(ui.ws===r.id)ui.ws='all';
  renderFilter(); renderFolders(); scheduleRender(); toast(esc(r.name)+' removed.',3200);
}
function removeLiveAgent(id){
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
  const [c,v]=await Promise.all([safe(bridge.listPrevious,{sessions:[]}),safe(bridge.listVsChats,{sessions:[],storesFound:0,unreadable:0,tooLarge:0,formatNote:''})]);
  st.cli=c; st.vs=v;
  if(!st.touched&&pristine(a)&&((c&&c.sessions.length)||(v&&v.sessions.length)))st.open=true;
  if(ui.selected===a.id)renderPrev(a);
  return st;
}
function initPrev(a){
  const box=$('prev'); if(!box)return;
  if(!bridge.listPrevious&&!bridge.listVsChats){box.hidden=true;return;}
  vsViewing=false; renderPrev(a); loadPrev(a);
}
function renderPrev(a){
  const box=$('prev'); if(!box||a.parent)return;
  const st=prevOf(a), c=st.cli, v=st.vs;
  if(!c&&!v){box.hidden=false;box.innerHTML='<div class="prev-bar"><span class="prev-t">Previous sessions</span><span class="prev-c">Looking…</span></div>';return;}
  const nc=c&&c.ok?c.sessions.length:0, nv=v&&v.ok?v.sessions.length:0;
  const keepScroll=(box.querySelector('.prev-body')||{}).scrollTop||0;
  let h=`<button class="prev-toggle" type="button" aria-expanded="${st.open}" data-pv="toggle">${ICON.chev}<span class="prev-t">Previous sessions</span><span class="prev-c">${nc} Copilot · ${nv} VS Code chat${nv===1?'':'s'}</span></button>`;
  if(st.open){
    h+='<div class="prev-body">';
    h+='<div class="prev-h">Copilot sessions in this folder <small>Resume continues the same session; earlier messages are shown here.</small></div>';
    if(!c||!c.ok)h+=`<p class="prev-empty">Could not list sessions${c&&c.error?': '+esc(c.error):''}.</p>`;
    else if(!c.sessions.length)h+='<p class="prev-empty">No earlier Copilot sessions for this folder.</p>';
    else h+=c.sessions.map(x=>`<div class="prev-row"><div class="prev-tx"><b title="${esc(x.title)}">${esc(x.title)}</b><small>${esc(when(x.modifiedTime))}${x.branch?' · '+esc(x.branch):''}</small></div><button class="btn" type="button" data-pv="resume" data-sid="${esc(x.id)}">Resume</button></div>`).join('');
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
function replayHistory(a,h,title){
  const chat=liveChat(a); let m=null;
  if(h&&h.truncated)addNote(chat,'Showing the last '+h.items.length+' of '+h.total+' items; earlier ones are not shown.');
  const agentMsg=()=>{if(!m){m=document.createElement('div');m.className='msg agent';m.innerHTML='<div class="meta">'+esc(a.name)+'</div>';chat.el.appendChild(m);}return m;};
  const chipBox=()=>{const mm=agentMsg();let l=mm.lastElementChild;if(!l||!l.classList.contains('chips')){l=document.createElement('div');l.className='chips';l.setAttribute('aria-label','Tool calls');mm.appendChild(l);}return l;};
  for(const it of ((h&&h.items)||[])){
    if(it.type==='user'){m=null;addUserMsg(chat,it.text,(it.attachments||[]).map(x=>({name:x.name,img:x.kind==='image'})),it.ts);}
    else if(it.type==='output'){const b=document.createElement('div');b.className='bubble';agentMsg().appendChild(b);mdSet(b,it.text,true);}
    else{const full=it.output||'';addChip(chipBox(),makeChip({tool:it.tool,label:it.label,res:SHORT(full||(it.failed?'failed':'ok'),60),output:full.slice(0,2000),state:it.failed?'failed':'ok'}));}
  }
  addNote(chat,'Resumed: '+esc(title||'earlier session')+'. New messages continue this session.');
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
  const f=e.target.closest('[data-fp]');
  if(f){const r=ROOMS.find(x=>x.id===f.dataset.room);if(!r)return;
    if(f.dataset.fp==='new'){const ag=agents.find(x=>!x.parent&&x.room===r.id);toggleFolders(false);if(ag)newSession(ag);}
    else if(f.dataset.fp==='hide')hideFolder(r,!r.hidden);
    else if(f.dataset.fp==='rm')removeFolder(r);
    return;}
  const pop=$('foldersPop');
  if(!pop.hidden&&!e.target.closest('#foldersPop')&&!e.target.closest('#foldersBtn'))toggleFolders(false);
});

/* After adding a folder: if it already has earlier Copilot sessions or VS Code chats, say so and show them. */
async function announcePrevious(a){
  if(!bridge.listPrevious)return;
  const st=await loadPrev(a); const n=(st.cli&&st.cli.ok?st.cli.sessions.length:0), v=(st.vs&&st.vs.ok?st.vs.sessions.length:0);
  if(!n&&!v)return;
  toast('Found '+(n?n+' earlier Copilot session'+(n===1?'':'s'):'')+(n&&v?' and ':'')+(v?v+' VS Code chat'+(v===1?'':'s'):'')+' for <b>'+esc(roomOf(a).name)+'</b>. Opening them.',4200);
  if(!ui.selected){st.open=true;openPanel(a.id,false);}
}
async function addVia(fn){
  const ef=$('effortSel');
  const r=await fn($('permMode').value,{model:$('modelSel').value,effort:ef.hidden?undefined:(ef.value||undefined)});
  if(r.error)toast('Could not add: '+esc(r.error),6000);
  r.agents.forEach(addLiveAgent);
  r.agents.forEach(x=>{const ag=liveById(x.id);if(ag)announcePrevious(ag);});
}
let pendingOpen=qs.get('open');
if(bridge){
  document.body.classList.add('has-bridge');
  $('demoToggle').onchange=e=>{demoOn=e.target.checked;applyMode();};
  $('addFolder').onclick=()=>addVia(bridge.addFolder);
  $('addWs').onclick=()=>addVia(bridge.addWorkspaceFile);
  $('foldersBtn').onclick=()=>toggleFolders();
  $('modelSel').onchange=()=>fillEffortSelect($('effortSel'),$('modelSel').value);
  bridge.onEvent(onLiveEvent);
  bridge.onAgentAdded(addLiveAgent);
  bridge.listAgents().then(l=>{l.forEach(addLiveAgent);renderFilter();});
  loadModels();
  agents=LIVE.agents; ROOMS=LIVE.rooms;
  setBadge();
}

renderFilter(); renderAll();
if(qs.get('view')==='list')setView('list');
if(pendingOpen&&demoOn){openPanel(pendingOpen,false);pendingOpen=null;}
})();
