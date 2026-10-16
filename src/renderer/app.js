/* Agent Durbar renderer: office view, list view, chat panel, live + demo + simulated data.
   Plain script (no modules) so it runs in the sandboxed Electron renderer and in a plain browser. */
(function(){
'use strict';
const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const qs = new URLSearchParams(location.search);
const DEMO_LIB = window.DURBAR_DEMO;
const {L,S} = DEMO_LIB;
const N_MAIN = Math.max(8, Math.min(15, parseInt(qs.get('n')||'12',10)));
const FORCE_DENSITY = ['full','card','mini','micro'].includes(qs.get('density')) ? qs.get('density') : null;

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
  let s=`<svg class="scene${c?' sc-c':''}" viewBox="${c?'16 5 176 116':mini?'22 4 166 118':'0 0 200 124'}" aria-hidden="true" focusable="false">`;
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
function visibleAgents(){return agents.filter(a=>(ui.ws==='all'||wsOf(a)===ui.ws));}
function renderStats(){
  const list=visibleAgents().filter(a=>!a.parent); const c={working:0,waiting:0,idle:0,error:0,done:0};
  list.forEach(a=>{const s=vis(a); if(s==='working'||s==='thinking')c.working++; else c[s]++;});
  const defs=[['working','Working','working or thinking'],['waiting','Waiting','waiting for you'],['idle','Idle','idle or paused'],['error','Errors','with errors'],['done','Done','done']];
  $('stats').innerHTML=defs.map(([k,l,t])=>`<button class="stat${(k==='waiting'||k==='error')&&c[k]?' attn':''}" data-k="${k}" aria-pressed="${ui.status===k}" title="Show only agents ${t}" aria-label="${c[k]} ${t}. Toggle filter."><span class="dot ${k}"></span><b>${c[k]}</b><span class="l">${l}</span></button>`).join('');
}
function renderFilter(){
  const sel=$('wsFilter');
  sel.innerHTML='<option value="all">All folders</option>'+ROOMS.map(r=>`<option value="${esc(r.id)}">${esc(r.name)}</option>`).join('');
  sel.value=ui.ws;
}
const matchStatus = a => !ui.status || ((ui.status==='working')?['working','thinking'].includes(vis(a)):vis(a)===ui.status);

/* ---------------- office view ---------------- */
const DENS={
  full:{cw:164,hw:90,cap:3},
  /* compact densities: uniform desk cells on a grid (cw = min cell width), helpers on a strip of mini desks below */
  card:{cw:236,cap:1,gap:8,rp:12},
  mini:{cw:216,cap:1,gap:6,rp:10},
  micro:{cw:190,cap:1,gap:5,rp:8}
};
const SC_CACHE=new Map();
function sceneC(a){const st=vis(a),k=a.look,key=st+k.shirt+k.skin+k.hair+k.style+(k.glasses?1:0);let v=SC_CACHE.get(key);if(!v){v=scene(a,false,true);SC_CACHE.set(key,v);}return v;}
function visibleHelpers(a,d){
  const all=helpersOf(a).slice().sort((x,y)=>prio(x)-prio(y));
  const cap=DENS[d].cap;
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
    <span class="ci"><span class="l1"><span class="name">${esc(a.name)}</span><span class="role">${esc(a.role)}</span><span class="stl st-${st}">${label(a,true)}</span></span>
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
    const fewer=ui.expanded[a.id]&&nSubs>DENS[d].cap+1;
    if(d==='full'){
      const rows=shown.map(helperHTML).join('');
      helpers=`<div class="helpers">${linksSVG(d,shown.length,hidden.length>0||fewer)}${rows}${hidden.length?moreHTML(a,hidden,d):''}${fewer?`<button class="more" data-more="${esc(a.id)}" aria-expanded="true">Show fewer</button>`:''}</div>`;
    } else {
      helpers=`<div class="helpers strip${fewer?' open':''}">${shown.map(helperTileHTML).join('')}${hidden.length?moreHTML(a,hidden,d):''}${fewer?`<button class="more fewer" data-more="${esc(a.id)}" aria-expanded="true">Show fewer</button>`:''}</div>`;
    }
  }
  let desk;
  if(d==='full'){
    desk=`<button class="desk is-${st}" data-id="${esc(a.id)}" aria-pressed="${ui.selected===a.id}" aria-label="${esc(a.name)}, ${esc(a.role)}, folder ${esc(roomOf(a).path)}, ${label(a)}: ${esc(a.task)}${nSubs?`. ${nSubs} helper${nSubs>1?'s':''}`:''}. Open chat panel.">
      ${scene(a,false)}<span class="badge ${st}">${badgeSVG(st)}</span>
      <div class="info"><div class="who"><span class="name">${esc(a.name)}</span><span class="role">${esc(a.role)}</span></div>
      <p class="task">${esc(a.task)}</p><span class="pill st-${st}"><i></i>${label(a)}</span></div></button>`;
  } else desk=cardHTML(a,d,nSubs);
  return `<div class="unit${nSubs?' has-h':''}">${desk}${helpers}</div>`;
}
const unitWidth=(a,d)=>{const D=DENS[d];return D.cw+(helpersOf(a).length?(d==='full'?D.hw+14+8:D.hw+18):0);};
function officeModel(ignoreStatus){
  const rooms=[];
  ROOMS.forEach(r=>{
    if(ui.ws!=='all'&&ui.ws!==r.id)return;
    const mains=agents.filter(a=>!a.parent&&a.room===r.id&&(ignoreStatus||matchStatus(a)));
    if(!mains.length)return;
    const key=a=>Math.min(prio(a),...helpersOf(a).map(prio));
    mains.sort((x,y)=>key(x)-key(y));
    rooms.push({r,mains,all:agents.filter(a=>wsOf(a)===r.id)});
  });
  return rooms;
}
function roomHTML({r,mains,all},d,aw,cap){
  const dots=['waiting','error','working','done','idle'].map(k=>{const n=all.filter(a=>{const s=vis(a);return k==='working'?(s==='working'||s==='thinking'):s===k}).length;return n?`<span class="rd${k==='waiting'?' attn':(k==='done'||k==='idle')?' calm':''}" title="${n} ${LABELS[k]}"><span class="dot ${k}"></span>${n}</span>`:''}).join('');
  const head=`<div class="room-head"><span class="room-name" title="${esc(r.name)}">${esc(r.name)}</span><span class="room-path" title="${esc(r.path)}">${esc(r.path)}</span><span class="room-dots" aria-hidden="true">${dots}</span>${PLANT}</div>`;
  if(d==='full'){
    const gap=6, pad=12;
    const widths=mains.map(a=>unitWidth(a,d));
    const basis=Math.min(aw,widths.reduce((x,y)=>x+y,0)+gap*(widths.length-1)+2*pad+30);
    const min=Math.max(...widths)+2*pad+30;
    return `<section class="room" data-tint="${r.tint}" style="--w:${Math.round(basis)};--min:${Math.round(min)}px" aria-label="Workspace ${esc(r.name)}">${head}
      <div class="units">${mains.map(a=>unitHTML(a,d)).join('')}</div></section>`;
  }
  /* compact: the room is a floor-plan zone with `cols` desk columns */
  const D=DENS[d], cols=Math.max(1,Math.min(mains.length,cap)), over=2*D.rp+4;
  const basis=cols*D.cw+(cols-1)*D.gap+over, min=D.cw+over;
  return `<section class="room" data-tint="${r.tint}" style="--w:${Math.round(basis)};--min:${Math.round(min)}px" aria-label="Workspace ${esc(r.name)}">${head}
    <div class="units" style="--cols:${cols}">${mains.map(a=>unitHTML(a,d)).join('')}</div></section>`;
}
/* Pick the richest density that fits the floor at scale 1 (text is never scaled down).
   Compact densities also try several desk-column counts per room and keep the shortest layout that fits. */
function renderOffice(){
  if(ui.view!=='office')return;
  const floor=$('floor'), stage=$('stage'), cs=getComputedStyle(floor);
  const aw=floor.clientWidth-parseFloat(cs.paddingLeft)-parseFloat(cs.paddingRight);
  const ah=floor.clientHeight-parseFloat(cs.paddingTop)-parseFloat(cs.paddingBottom);
  if(aw<=0||ah<=0)return;
  const model=officeModel();
  if(!model.length){
    stage.dataset.d='card'; stage.style.width=aw+'px'; stage.style.height='auto';
    stage.innerHTML='<div class="empty">'+(!agents.length&&!demoOn?'No agents yet. Use "Add folder" or "Add .code-workspace" above.':'No agents match these filters.')+'</div>';
    floor.classList.remove('scrolls'); return;
  }
  /* Density is chosen from the unfiltered set so cards do not change shape when a status pill filters. */
  const order=FORCE_DENSITY?[FORCE_DENSITY]:['full','card','mini','micro'];
  const sizing=ui.status?officeModel(true):model;
  const fits=()=>stage.scrollHeight<=ah+1&&stage.scrollWidth<=aw+1;
  let fit=false, d=order[0], cap=0;
  stage.style.width=aw+'px';
  for(d of order){
    stage.dataset.d=d; stage.style.height='auto';
    if(d==='full'){
      stage.innerHTML=sizing.map(m=>roomHTML(m,d,aw)).join('');
      if(fits()){fit=true;break;}
      continue;
    }
    const D=DENS[d], over=2*D.rp+4;
    const maxCap=Math.max(1,Math.min(Math.max(...sizing.map(m=>m.mains.length)),Math.floor((aw-over+D.gap)/(D.cw+D.gap))));
    let best=null, any=null;
    for(let c=maxCap;c>=1;c--){
      stage.innerHTML=sizing.map(m=>roomHTML(m,d,aw,c)).join('');
      const h=stage.scrollHeight;
      if(!any||h<any.h-8)any={c,h};
      if(fits()){
        /* among layouts that fit, prefer desks close to a comfortable width (not stretched, not squeezed) */
        const ds=stage.querySelectorAll('.desk.card'); let tw=0; ds.forEach(e=>{tw+=e.getBoundingClientRect().width;});
        const miss=Math.abs(tw/Math.max(1,ds.length)-D.cw*1.3);
        if(!best||miss<best.miss-6)best={c,h,miss};
      }
    }
    cap=(best||any).c;
    if(best){fit=true;break;}
  }
  if(d==='full')stage.innerHTML=model.map(m=>roomHTML(m,d,aw)).join('');
  else stage.innerHTML=model.map(m=>roomHTML(m,d,aw,cap)).join('');
  stage.style.height='auto';
  stage.dataset.fit=fit?'ok':'scroll';
  floor.classList.toggle('scrolls',!fit);
}

/* ---------------- list view ---------------- */
function renderList(){
  const rows=[];
  ROOMS.forEach(r=>{ if(ui.ws!=='all'&&ui.ws!==r.id)return;
    agents.filter(a=>!a.parent&&a.room===r.id).slice().sort((x,y)=>Math.min(prio(x),...helpersOf(x).map(prio))-Math.min(prio(y),...helpersOf(y).map(prio))).forEach(a=>{
      const subs=helpersOf(a);
      if(matchStatus(a)){rows.push([a,false]);subs.forEach(h=>rows.push([h,true]));}
    });});
  const row=([a,sub])=>{const st=vis(a);return `<button class="lrow" data-id="${esc(a.id)}" aria-pressed="${ui.selected===a.id}" aria-label="${esc(a.name)}, ${esc(a.role)}, ${esc(roomOf(a).name)}, ${label(a)}: ${esc(a.task)}">
    <span class="lname"><span class="dot ${st}"></span><span class="${sub?'sub':''}">${esc(a.name)}</span></span><span class="lcell">${esc(a.role)}</span><span class="lcell mono">${esc(roomOf(a).name)}</span><span class="lcell">${esc(a.task)}</span><span><span class="pill st-${st}"><i></i>${label(a)}</span></span></button>`};
  $('list').innerHTML=`<div class="list-wrap" role="group" aria-label="Agents"><div class="lrow head" aria-hidden="true"><span>Agent</span><span>Role</span><span>Workspace</span><span>Current task</span><span>Status</span></div>${rows.map(row).join('')||'<div class="empty">No agents match these filters.</div>'}</div>`;
}

function renderAll(){
  const ae=document.activeElement, id=ae&&ae.dataset&&(ae.dataset.id||ae.dataset.more), inPanel=ae&&ae.closest&&ae.closest('#panel');
  const key=ae&&ae.dataset&&(ae.dataset.id?'data-id':ae.dataset.more?'data-more':'');
  renderStats();
  if(ui.view==='office')renderOffice(); else renderList();
  if(id&&!inPanel){const n=document.querySelector(`[${key}="${CSS.escape(id)}"]`); if(n&&ae!==n)n.focus({preventScroll:true});}
  if(ui.selected)updatePanelHeader();
}


/* ---------------- icons ---------------- */
const ICON={
 read:'<svg viewBox="0 0 16 16" fill="none" stroke="#5b7f94" stroke-width="1.5" stroke-linejoin="round"><path d="M4 1.8h5.2L12.5 5v9.2H4z"/><path d="M9 1.8V5.2h3.5"/></svg>',
 edit:'<svg viewBox="0 0 16 16" fill="none" stroke="#7f8a5b" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"><path d="M2.5 13.5l.7-3L11 2.7a1.4 1.4 0 0 1 2 2L5.5 12.8z"/></svg>',
 run:'<svg viewBox="0 0 16 16" fill="none" stroke="#4f7f65" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"><rect x="1.8" y="2.8" width="12.4" height="10.4" rx="2"/><path d="M4.8 6.2l2 1.8-2 1.8M8.6 10h2.6"/></svg>',
 search:'<svg viewBox="0 0 16 16" fill="none" stroke="#8a6f4a" stroke-width="1.5" stroke-linecap="round"><circle cx="7" cy="7" r="4.2"/><path d="M10.2 10.2l3.3 3.3"/></svg>',
 tool:'<svg viewBox="0 0 16 16" fill="none" stroke="#7a7f8c" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="2.2"/><path d="M8 1.8v1.8M8 12.4v1.8M1.8 8h1.8M12.4 8h1.8M3.6 3.6l1.3 1.3M11.1 11.1l1.3 1.3M12.4 3.6l-1.3 1.3M4.9 11.1l-1.3 1.3"/></svg>',
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
function scrollChat(chat){const c=$('chat'); if(c&&chat.el.parentNode===c){c.scrollTop=c.scrollHeight;}}
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
  m.innerHTML=`<div class="meta">${esc(a.name)}</div><div class="think streaming"><button class="think-toggle" aria-expanded="true">${ICON.chev}<span>Thinking</span><span class="live" aria-hidden="true"><i></i><i></i><i></i></span></button><div class="think-body"></div></div><div class="chips" aria-label="Tool calls"></div>`;
  const tb=m.querySelector('.think-toggle'),body=m.querySelector('.think-body');
  tb.addEventListener('click',()=>{const o=tb.getAttribute('aria-expanded')==='true';tb.setAttribute('aria-expanded',String(!o));body.hidden=o;m.querySelector('.think').dataset.touched='1';});
  chat.el.appendChild(m);scrollChat(chat);return m;
}
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
function addUserMsg(chat,text,atts){
  const m=document.createElement('div');m.className='msg user';
  const now=new Date();const hh=String(now.getHours()).padStart(2,'0')+':'+String(now.getMinutes()).padStart(2,'0');
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
function renderAttached(){
  const box=$('attached'); if(!box)return;
  box.innerHTML=attached.map((x,i)=>`<span class="att ${x.img?'img':''}" title="${esc(x.path||x.name)}">${x.img?ICON.img:ICON.file}<span>${esc(x.name)}</span><button type="button" data-rm="${i}" aria-label="Remove ${esc(x.name)}">${ICON.x}</button></span>`).join('');
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
  p.innerHTML=`<div class="panel-in">
   <div class="ph" id="panelHead"><div class="ph-top"><div class="avatar">${avatar(a)}</div><div style="min-width:0;padding-right:34px"><h2 id="panelTitle" tabindex="-1">${esc(a.name)}</h2><div class="sub">${esc(a.role)}${parent?' · helper of '+esc(parent.name):''}</div></div></div>
    <button class="close" id="closeBtn" aria-label="Close panel">${ICON.x}</button>
    <div class="ph-meta"><span data-f="status"></span><span class="folder" title="${esc(room.path)}"><svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" style="flex:none"><path d="M1.8 4.2a1.4 1.4 0 0 1 1.4-1.4h3l1.6 1.8h4.8a1.4 1.4 0 0 1 1.4 1.4v6.2a1.4 1.4 0 0 1-1.4 1.4H3.2a1.4 1.4 0 0 1-1.4-1.4z"/></svg><span class="folder-t">${esc(room.path)}</span></span></div>
    <p class="ptask" data-f="task"></p><p class="pusage" data-f="usage"></p>
    <div class="grants" id="grants" aria-label="Permissions allowed for this session" hidden></div>
    <div class="actions"><button class="btn primary" id="vscodeBtn"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5.5 4.5L2 8l3.5 3.5M10.5 4.5L14 8l-3.5 3.5M9 3l-2 10"/></svg>Open in VS Code</button>
      <button class="btn" id="pauseBtn"><svg viewBox="0 0 16 16" fill="currentColor"><rect x="4" y="3" width="2.8" height="10" rx="1"/><rect x="9.2" y="3" width="2.8" height="10" rx="1"/></svg><span>Pause</span></button>
      <button class="btn danger" id="stopBtn"><svg viewBox="0 0 16 16" fill="currentColor"><rect x="3.5" y="3.5" width="9" height="9" rx="2"/></svg>Stop</button></div></div>
   <div id="chat" role="log" aria-live="off" aria-label="Chat with ${esc(a.name)}" tabindex="0"></div>
   <div class="composer"><div class="attached" id="attached" aria-label="Attachments"></div>
    <div class="inbox"><button class="ib" id="attFile" type="button" aria-label="Attach file" title="Attach file">${ICON.file}</button><button class="ib" id="attImg" type="button" aria-label="Attach image" title="Attach image">${ICON.img}</button>
     <textarea id="msgInput" rows="1" placeholder="Message ${esc(a.name)}..." aria-label="Message ${esc(a.name)}"></textarea>
     <button class="ib send" id="sendBtn" type="button" aria-label="Send message" aria-disabled="true"><svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9h11M9.5 4.5L14 9l-4.5 4.5"/></svg></button></div>
    <p class="hint">Enter sends, Shift+Enter adds a line. Sample only.</p></div></div>`;
  const chat=getChat(a); $('chat').appendChild(chat.el);
  updatePanelHeader(); renderGrants();
  $('chat').scrollTop=1e6;
  $('closeBtn').onclick=closePanel;
  $('vscodeBtn').onclick=()=>a.live?openLive(a):toast('Would run <code>code '+esc(room.path)+'</code>',3800);
  if(a.live)$('pauseBtn').hidden=true;
  $('pauseBtn').onclick=()=>{a.paused=!a.paused;toast(esc(a.name)+(a.paused?' paused.':' resumed.'));renderAll();};
  $('stopBtn').onclick=()=>{if(a.live)return stopLive(a);a.paused=false;a.state='idle';a.label='Stopped';a.task='Stopped by you. Ready for a new task.';toast(esc(a.name)+' stopped.');renderAll();};
  $('attFile').onclick=()=>{if(a.live)return pickLive();attached.push({name:SAMPLE_FILES[fi++%SAMPLE_FILES.length]});renderAttached();setSend();};
  $('attImg').onclick=()=>{if(a.live)return pickLive();attached.push({name:SAMPLE_IMGS[ii++%SAMPLE_IMGS.length],img:true});renderAttached();setSend();};
  $('grants').onclick=e=>{const b=e.target.closest('[data-revoke]');if(b){const r=liveRoot(byId(ui.selected));bridge.revokeGrant(r.id,b.dataset.revoke);}};
  $('attached').onclick=e=>{const b=e.target.closest('[data-rm]');if(b){attached.splice(+b.dataset.rm,1);renderAttached();setSend();}};
  const input=$('msgInput');
  input.addEventListener('input',autoGrow);
  input.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendMessage(input.value);}});
  $('sendBtn').onclick=()=>{if($('sendBtn').getAttribute('aria-disabled')!=='true')sendMessage(input.value);};
  if(a.live){const h=document.querySelector('#panel .hint');if(h)h.textContent='Enter sends, Shift+Enter adds a line. '+(SIM?'Simulated session (no AI credits)':'Live Copilot session')+' ('+a.info.permMode+').';}
  setSend();
  renderAll();
  if(focus!==false)$('panelTitle').focus({preventScroll:true});
}
function closePanel(){
  const id=ui.selected; ui.selected=null; document.body.classList.remove('panel-open'); $('panel').innerHTML='';
  renderAll();
  const n=id&&document.querySelector(`[data-id="${CSS.escape(id)}"]`); if(n)n.focus();
}

/* ---------------- events ---------------- */
document.addEventListener('click',e=>{
  const st=e.target.closest('.stat'); if(st){const k=st.dataset.k;ui.status=ui.status===k?null:k;renderAll();const n=document.querySelector(`.stat[data-k="${k}"]`);if(n)n.focus();return;}
  const mo=e.target.closest('[data-more]'); if(mo){const id=mo.dataset.more;ui.expanded[id]=!ui.expanded[id];renderAll();return;}
  const cm=e.target.closest('.chips-more'); if(cm){const box=cm.parentNode;box.dataset.exp=box.dataset.exp==='1'?'0':'1';refreshChips(box);return;}
  const chip=e.target.closest('#chat .chip:not(.att-chip)'); if(chip){const o=chip.classList.toggle('open');chip.setAttribute('aria-expanded',String(o));return;}
  const t=e.target.closest('[data-id]'); if(t&&!t.closest('#panel')){openPanel(t.dataset.id,e.detail===0);}
});
document.addEventListener('keydown',e=>{
  if(e.key==='Escape'&&ui.selected){closePanel();return;}
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
  return chats[a.id]={el,busy:false};
}
function addNote(chat,html,err){const n=document.createElement('div');n.className='note'+(err?' err':'');n.innerHTML=html;chat.el.appendChild(n);scrollChat(chat);return n;}
function addLiveAgent(info){
  if(liveById(info.id))return;
  let room=LIVE.rooms.find(r=>r.path===info.cwd);
  if(!room){room={id:'r'+LIVE.rooms.length+':'+info.cwd,name:(info.roomName||info.name),path:info.cwd,tint:TINTS[LIVE.rooms.length%4]};LIVE.rooms.push(room);}
  const mode={'read-only':'read-only','allow':'can edit','ask':'asks first'}[info.permMode];
  let name=info.name; const dup=LIVE.agents.filter(x=>!x.parent&&x.room===room.id&&x.baseName===info.name).length; if(dup)name=info.name+' '+(dup+1);
  LIVE.agents.push({id:info.id,name,baseName:info.name,role:info.role||('Copilot ('+mode+')'),room:room.id,state:'idle',label:'Ready',task:'Ready. Send a message to start.',
    look:lookFor(info.id),files:[],paused:false,live:true,info,usage:{calls:0,inT:0,outT:0,nano:0},usageText:'',turn:null,worked:false,pend:new Map(),settled:new Set(),grants:[]});
  if(!demoOn){if(!ui.expanded)ui.expanded={};renderFilter();scheduleRender();}
  if(pendingOpen===info.id){pendingOpen=null;if(!demoOn)openPanel(info.id,false);}
}
function ensureTurn(a){
  if(a.turn)return a.turn;
  const chat=liveChat(a), m=newAgentMsg(chat,a);
  const t=a.turn={m,body:m.querySelector('.think-body'),chips:m.querySelector('.chips'),think:m.querySelector('.think'),chipEls:{},bubble:null};
  const ty=document.createElement('div');ty.className='typing';ty.innerHTML='<i></i><i></i><i></i>';m.appendChild(ty);t.typing=ty;
  return t;
}
function closeTurn(a){
  const t=a.turn; if(!t)return;
  t.think.classList.remove('streaming');
  if(!t.body.textContent.trim())t.think.remove(); else collapseThink(t.think);
  if(t.typing)t.typing.remove();
  if(t.bubble)t.bubble.classList.remove('caret');
  a.turn=null;
}
function setState(a,state,label,task){
  const ch=a.state!==state||(label!==undefined&&a.label!==label)||(task!==undefined&&a.task!==task);
  a.state=state; if(label!==undefined)a.label=label; if(task!==undefined)a.task=task;
  if(ch)scheduleRender();
}
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
  t.chips.appendChild(n);scrollChat(liveChat(a));
}
function settlePerm(a,p){
  let e=a.pend.get(p.requestId);
  if(!e&&a.settled.has(p.requestId))return; /* already shown (the click settles locally, the adapter event follows) */
  if(!e){ /* auto-approved by a session grant, or answered elsewhere: show a settled note in timeline order */
    if(p.state==='pending')return;
    showPerm(a,Object.assign({},p,{state:'approved'}));
    const n=ensureTurn(a).chips.lastElementChild;e={n,st:n.querySelector('.pstate')};
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
  const chat=liveChat(a), main=!e.agentId;
  switch(e.type){
  case 'user':{addUserMsg(chat,e.text,(e.attachments||[]).map(x=>({name:String(x.path).split(/[\\/]/).pop(),img:x.kind==='image',path:x.path})));return;}
  case 'status':
    if(!main)return;
    if(e.status==='working'){a.worked=true; ensureTurn(a); if(e.intent)a.intent=e.intent;
      if(a.state!=='working'&&a.state!=='thinking')setState(a,'working',null,e.intent||a.task); else if(e.intent)setState(a,a.state,undefined,e.intent);}
    else if(e.status==='needs-permission'){
      ensureTurn(a); setState(a,'waiting',null,e.intent||'Waiting for permission');
      if(e.permission)showPerm(a,e.permission);
    }
    else if(e.status==='idle'){const was=a.worked;a.worked=false;closeTurn(a);
      if(was)setState(a,'done','Done',a.lastOutput?SHORT(a.lastOutput,140):'Finished.'); else setState(a,'idle','Ready',a.task);}
    else if(e.status==='error'){closeTurn(a);addNote(chat,esc(e.intent||'Error'),true);setState(a,'error',null,SHORT(e.intent||'Error',140));}
    else if(e.status==='stopped'){
      /* a permission still pending when the session stops is denied cleanly: no Approve/Deny left behind, grants gone */
      [...a.pend.keys()].forEach(id=>settlePerm(a,{requestId:id,state:'denied',via:'stopped'}));
      setGrants(a,[]);
      closeTurn(a);setState(a,'idle','Stopped','Stopped by you. Session closed.');}
    return;
  case 'permission':if(main)settlePerm(a,e.permission);return;
  case 'grants':setGrants(a,e.grants||[]);return;
  case 'thinking':{if(!main)return;const t=ensureTurn(a);t.body.textContent+=e.delta;scrollChat(chat);setState(a,'thinking',null);return;}
  case 'output':{if(!main)return;const t=ensureTurn(a);
    if(!t.bubble){t.bubble=document.createElement('div');t.bubble.className='bubble caret';t.m.insertBefore(t.bubble,t.typing||null);}
    if(e.final){t.bubble.textContent=e.text||t.bubble.textContent;t.bubble.classList.remove('caret');a.lastOutput=e.text||'';t.bubble=null;}
    else t.bubble.textContent+=e.delta;
    scrollChat(chat);setState(a,'working',null);return;}
  case 'toolCall':{const t=ensureTurn(a);
    if(e.phase==='start'){const label=toolLabel(e.args);const el=makeChip({tool:e.tool,label,res:'running',state:'run'});
      addChip(t.chips,el);t.chipEls[e.callId]={el,tool:e.tool,label};
      if(main)setState(a,a.state==='thinking'?'working':a.state,null,a.intent||(e.tool+(label?' '+SHORT(label,90):'')));}
    else{const c=t.chipEls[e.callId]; if(c){const full=String(e.output||'');
      const el=makeChip({tool:c.tool||e.tool,label:c.label,res:SHORT(full||(e.phase==='complete'?'ok':'failed'),60),output:full.slice(0,2000),state:e.phase==='failed'?'failed':'ok'});
      c.el.replaceWith(el);c.el=el;refreshChips(t.chips);}}
    scrollChat(chat);return;}
  case 'usage':{const u=a.usage;u.calls++;u.inT+=e.inputTokens||0;u.outT+=e.outputTokens||0;u.nano+=e.nanoAiu||0;
    a.usageText=usageLong(a);scheduleRender();
    if(ui.selected===a.id||(byId(ui.selected)||{}).parent===a.id)updatePanelHeader();return;}
  case 'subagent':{const sid=a.id+':'+e.subagentId;let s=liveById(sid);
    if(!s){s={id:sid,parent:a.id,name:e.name||'Sub-agent',role:'Helper',state:'working',label:null,task:e.task||'',look:lookFor(sid),files:[],paused:false,live:true,info:a.info,usage:{calls:0,inT:0,outT:0,nano:0},usageText:'',pend:new Map(),settled:new Set(),grants:[]};LIVE.agents.push(s);}
    if(e.phase==='started')setState(s,'working',null,e.task||'Working');
    else if(e.phase==='completed')setState(s,'done','Done',s.task);
    else setState(s,'error',null,SHORT(e.task||'Failed',100));
    scheduleRender();return;}
  }
}
async function sendLive(text,forId){
  const a0=byId(forId||ui.selected); if(!a0)return; const a=liveRoot(a0);
  text=(text||'').trim(); if(!text&&!attached.length)return;
  const chat=liveChat(a), atts=attached.slice();
  addUserMsg(chat,text||'(attachment)',atts);
  attached=[];renderAttached();
  const input=$('msgInput');if(input){input.value='';autoGrow();}
  a.worked=true; a.intent=''; closeTurn(a); ensureTurn(a); setState(a,'thinking',null,'Thinking');
  const r=await bridge.send(a.id,text||'Please look at the attached file(s).',atts.map(x=>({path:x.path,name:x.name,kind:x.kind})));
  if(!r.ok){closeTurn(a);addNote(chat,'Send failed: '+esc(r.error||'unknown error'),true);setState(a,'error',null,'Send failed: '+SHORT(r.error,100));}
}
async function pickLive(){
  const files=await bridge.pickAttachments();
  files.forEach(f=>attached.push({name:f.name,img:f.kind==='image',path:f.path,kind:f.kind}));
  renderAttached();setSend();
}
async function openLive(a){
  const r=await bridge.openInVSCode(liveRoot(a).id);
  toast(r.ok?'Opening in VS Code…':'Could not open VS Code: '+esc(r.error||'unknown error'),4200);
}
async function stopLive(a){const r=liveRoot(a);await bridge.stop(r.id);toast(esc(r.name)+' stopped.');}
async function addVia(fn){
  const r=await fn(document.getElementById('permMode').value);
  if(r.error)toast('Could not add: '+esc(r.error),6000);
  r.agents.forEach(addLiveAgent);
}
let pendingOpen=qs.get('open');
if(bridge){
  document.body.classList.add('has-bridge');
  $('demoToggle').onchange=e=>{demoOn=e.target.checked;applyMode();};
  $('addFolder').onclick=()=>addVia(bridge.addFolder);
  $('addWs').onclick=()=>addVia(bridge.addWorkspaceFile);
  bridge.onEvent(onLiveEvent);
  bridge.onAgentAdded(addLiveAgent);
  bridge.listAgents().then(l=>l.forEach(addLiveAgent));
  agents=LIVE.agents; ROOMS=LIVE.rooms;
  setBadge();
}

renderFilter(); renderAll();
if(qs.get('view')==='list')setView('list');
if(pendingOpen&&demoOn){openPanel(pendingOpen,false);pendingOpen=null;}
})();
