/* Spec 005 FR-194, FR-216: the rail's List view. Pure rules: no DOM, no timers, no storage. In the page: window.DurbarRail; in Node:
   module.exports (scripts/test-railorder.ts).
   group(items): the rows by folder. Each item is {id, room, rank, needs, since, prio, i}: the folder key, the folder's place in the office's
   room order, whether the session needs you (`needsMe`), since when (`NEED_SINCE`, ms), its `prio` and its creation order. Folders with
   someone needing you come first, oldest wait first, then the office's room order; inside a folder those needing you first, oldest first,
   then `prio`, then creation order. group(items, sort) takes FR-341's choice (see SORTS below). Time never reorders anything: only `needs` and `since`, which change with a status, do.
   recent / loadYouAt / stampYouAt / youAtJSON / stampable (spec 113 P6): the Recent order and the times you sent a message (below).
   loadFolds / foldsJSON: the collapsed folders, kept by path (the key the app already stores for the view, durbar.ui's `ws`). A corrupt,
   oversized or wrong-typed value loads as "nothing collapsed", never an error. */
(function(root, api){
  if(typeof module==='object'&&module.exports) module.exports=api; else root.DurbarRail=api;
})(typeof self!=='undefined'?self:this, (function(){
  'use strict';
  const FOLD_KEY='durbar.railFolds', MAX_FOLDS=200, MAX_PATH=1024;
  const num=v=>typeof v==='number'&&Number.isFinite(v);
  /* spec 005 FR-341 (issue 1961): the rail's sort choice. 'needs' is FR-194's order exactly. The others reorder the rows inside each folder by
     one key, ties by FR-194's order; folders are ordered by their first row under the same key, ties by FR-194's folder order. `created` is the
     session's creation time (ms) or missing: missing sorts last under 'oldest' and first under 'newest'. Still no clock: only status and the
     fixed creation time move a row. */
  const SORTS=[
    ['needs','Needs you first'],['working','Working first'],['waiting','Waiting first'],
    ['oldest','Oldest first'],['newest','Newest first']];
  const SORT_KEY='durbar.railSort', DEFAULT_SORT='needs';
  const isSort=v=>typeof v==='string'&&SORTS.some(s=>s[0]===v);
  const sortLabel=k=>(SORTS.find(s=>s[0]===k)||SORTS[0])[1];
  function loadSort(raw){return isSort(raw)?raw:DEFAULT_SORT;} /* anything else (corrupt, wrong type, an old build's value) is the default */
  /* the key of one row under a choice: a number, lower first; 0 for every row when the choice has no key of its own */
  function primary(sort,x){
    if(sort==='working')return x.working?0:x.needs?1:2;
    if(sort==='waiting')return x.needs?0:x.working?1:2;
    if(sort==='oldest')return num(x.created)?x.created:Infinity;
    if(sort==='newest')return num(x.created)?-x.created:-Infinity;
    return 0;
  }
  /* FR-341: when each session was first seen (`durbar.railBorn`, {id: ms}), the creation time the rail sorts by. loadBorn: string ids up to 200
     characters, finite positive times, at most MAX_BORN entries; anything else loads as an empty map. stampBorn adds `now` for each id without
     a time (one batch shares one time, so ties fall to FR-194's order). bornJSON is the value to store: only ids still listed (as pruneNumbers
     does, and, before the session list has loaded (`listed` false), every saved id is kept), or null to remove the key. */
  const BORN_KEY='durbar.railBorn', MAX_BORN=500;
  function loadBorn(raw){
    let o=raw; if(typeof raw==='string'){try{o=JSON.parse(raw);}catch(e){return {};}}
    const out={}; if(!o||typeof o!=='object'||Array.isArray(o))return out;
    let n=0;
    for(const [id,t] of Object.entries(o)){if(n>=MAX_BORN)break;if(id&&id.length<=200&&num(t)&&t>0){out[id]=t;n++;}}
    return out;
  }
  function stampBorn(map,ids,now){
    const out=Object.assign({},map||{});
    for(const id of Array.isArray(ids)?ids:[])if(typeof id==='string'&&id&&!Object.prototype.hasOwnProperty.call(out,id))out[id]=now;
    return out;
  }
  function bornJSON(map,ids,listed){
    const keep=new Set(ids||[]), out={}; let n=0;
    for(const [id,t] of Object.entries(map||{})){if(n>=MAX_BORN)break;if(listed===false||keep.has(id)){out[id]=t;n++;}}
    return n?JSON.stringify(out):null;
  }
  function group(items,sort){
    const how=isSort(sort)?sort:DEFAULT_SORT;
    const by=new Map();
    for(const x of Array.isArray(items)?items:[]){
      if(!x||typeof x.id!=='string')continue;
      let g=by.get(x.room); if(!g){g={room:x.room,rank:num(x.rank)?x.rank:1e9,first:by.size,rows:[],needN:0,since:Infinity};by.set(x.room,g);}
      g.rows.push(x);
      if(x.needs){g.needN++;const t=num(x.since)?x.since:Infinity;if(t<g.since)g.since=t;}
    }
    const inGroup=(p,q)=>{
      if(!!p.needs!==!!q.needs)return p.needs?-1:1;
      if(p.needs){const a=num(p.since)?p.since:Infinity,b=num(q.since)?q.since:Infinity;if(a!==b)return a<b?-1:1;}
      return (p.prio||0)-(q.prio||0)||(p.i||0)-(q.i||0);
    };
    const cmp=(p,q)=>{const a=primary(how,p),b=primary(how,q);return a===b?inGroup(p,q):a<b?-1:1;};
    const gs=[...by.values()];
    for(const g of gs)g.rows.sort(cmp);
    const dflt=(a,b)=>{
      if(!!a.needN!==!!b.needN)return a.needN?-1:1;
      if(a.needN&&a.since!==b.since)return a.since<b.since?-1:1;
      return a.rank-b.rank||a.first-b.first;
    };
    gs.sort((a,b)=>{
      const x=primary(how,a.rows[0]),y=primary(how,b.rows[0]);
      return x===y?dflt(a,b):x<y?-1:1;
    });
    return gs.map(g=>({room:g.room,ids:g.rows.map(r=>r.id),needN:g.needN}));
  }
  function loadFolds(raw){
    let o=raw;
    if(typeof raw==='string'){try{o=JSON.parse(raw);}catch(e){return new Set();}}
    if(!o||typeof o!=='object'||Array.isArray(o)||o.v!==1||!Array.isArray(o.closed)||o.closed.length>MAX_FOLDS)return new Set();
    const out=new Set();
    for(const p of o.closed){if(typeof p!=='string'||!p.length||p.length>MAX_PATH)return new Set();out.add(p);}
    return out;
  }
  /* the value to store, or null to remove the key: only paths that are still folders (`known`), at most MAX_FOLDS. Before the session list
     has loaded (`listed` false) every saved path is kept, as pruneNumbers does: a folder whose sessions have not appeared yet is not lost */
  function foldsJSON(closed,known,listed){
    const k=known instanceof Set?known:new Set(known||[]), all=listed===false, list=[];
    for(const p of closed instanceof Set?closed:[]){if(typeof p==='string'&&p.length&&p.length<=MAX_PATH&&(all||k.has(p)))list.push(p);if(list.length>=MAX_FOLDS)break;}
    return list.length?JSON.stringify({v:1,closed:list}):null;
  }
  /* spec 005 FR-340 (issue 1905): folders whose display names are equal (case folded) are told apart on screen by the nearest parent folder that
     differs: `rooms` is [{id,name,path}] (the path as the app shows it, home as ~); the result is a Map id -> label for the folders that share their
     name with another, nothing for a unique one. One parent first ("acme"), then two ("clients/acme") while the labels still collide; when the
     parents are all equal too (renamed folders), the folder's own last segment. Never throws, never reads more than MAX_PATH characters of a path. `maxDepth` (optional; Recent's rows use 3, spec 113 FR-043) caps the parents shown: past it, the folder's own last segment. */
  function parentNames(rooms,maxDepth){
    const by=new Map(), out=new Map();
    for(const r of Array.isArray(rooms)?rooms:[]){
      if(!r||typeof r.id!=='string')continue;
      const k=String(r.name==null?'':r.name).trim().toLowerCase(), segs=String(r.path==null?'':r.path).slice(0,MAX_PATH).split(/[\\/]+/).filter(Boolean);
      let g=by.get(k); if(!g){g=[];by.set(k,g);}
      g.push({id:r.id,leaf:segs.pop()||'',up:segs});
    }
    for(const g of by.values()){
      if(g.length<2)continue;
      const most=Math.max(...g.map(x=>x.up.length));
      let lab=null;
      for(let d=1;d<=Math.min(Math.max(1,most),num(maxDepth)&&maxDepth>=1?maxDepth:Infinity);d++){
        const l=g.map(x=>x.up.slice(-d).join('/'));
        if(new Set(l).size===g.length){lab=l;break;}
      }
      if(!lab)lab=g.map(x=>x.leaf); /* the same parents: the folder's own name tells them apart */
      g.forEach((x,i)=>out.set(x.id,lab[i]));
    }
    return out;
  }
  /* spec 113 P6 (FR-041, FR-042, FR-044, FR-045): the Recent order. `youAt` is the last time you sent a message to a session (ms); the stores hold ids and
     times only, never text. loadYouAt: an object of string ids (up to 200 characters) and finite positive times, at most MAX_YOUAT entries; anything else
     (bad JSON, a wrong type, one bad entry, too many entries, a value over MAX_RAW characters) loads as an empty map, never an error; a time later than
     `now` (the clock moved back) reads as now. stampYouAt adds one id at `now` and keeps the MAX_YOUAT newest. youAtJSON is the value to store: only ids
     still listed (before the list has loaded, `listed` false, every saved id is kept), or null to remove the key. */
  const YOUAT_KEY='durbar.railYouAt', ORDER_KEY='durbar.railOrder', IDLE_KEY='durbar.railIdleOpen', MAX_YOUAT=500, MAX_RAW=100000;
  function loadYouAt(raw,now){
    let o=raw;
    if(typeof raw==='string'){if(raw.length>MAX_RAW)return {};try{o=JSON.parse(raw);}catch(e){return {};}}
    if(!o||typeof o!=='object'||Array.isArray(o))return {};
    const ents=Object.entries(o); if(ents.length>MAX_YOUAT)return {};
    const out={}, top=num(now)?now:Infinity;
    for(const [id,t] of ents){if(!id||id.length>200||!num(t)||t<=0)return {};out[id]=Math.min(t,top);}
    return out;
  }
  function stampYouAt(map,id,now){
    const out=Object.assign({},map||{});
    if(typeof id!=='string'||!id||id.length>200||!num(now)||now<=0)return out;
    delete out[id]; out[id]=now; /* the newest entry is last */
    const ents=Object.entries(out); if(ents.length<=MAX_YOUAT)return out;
    ents.reverse().sort((a,b)=>b[1]-a[1]); /* newest inserted first, then by time (stable): of equal times the later stamp stays */
    return Object.fromEntries(ents.slice(0,MAX_YOUAT));
  }
  function youAtJSON(map,ids,listed){
    const keep=new Set(ids||[]), out={}; let n=0;
    for(const [id,t] of Object.entries(map||{})){if(n>=MAX_YOUAT)break;if(num(t)&&(listed===false||keep.has(id))){out[id]=t;n++;}}
    return n?JSON.stringify(out):null;
  }
  /* a send the person typed that the app accepted stamps `youAt`: not a failed or refused one, not a send that went nowhere (`notSent`), not a coffee-break resume */
  function stampable(res,opts){return !!res&&res.ok===true&&res.notSent!==true&&!(opts&&opts.coffee);}
  const isOrder=v=>v==='folders'||v==='recent';
  function loadOrder(raw){return isOrder(raw)?raw:'folders';}
  function loadIdleOpen(raw){return raw==='1';}
  /* FR-041, FR-045: the flat list. Each item is {id, rank, needs, since, prio, i, youAt}: `rank` the folder's place in the office's room order. Returns
     {head, open, idle} (ids): `head` is who needs you (FR-194's order: oldest wait first, then the office's order), then the rows you sent to since
     `startedAt`, newest first, ties in the office's order; `idle` is the rest that does not need you: your older sends (newest first), then the never-sent
     rows by fixed keys only (folder rank, prio, creation order: a neighbour's status change never moves them). Agent time never reorders anything. `openId`
     (the open chat's row) never sits in `idle`: it is returned as `open`, to be shown after `head`. No `startedAt` (not a number): only an unstamped row is idle. */
  function recent(items,startedAt,openId){
    const list=(Array.isArray(items)?items:[]).filter(x=>x&&typeof x.id==='string');
    const office=(p,q)=>(num(p.rank)?p.rank:1e9)-(num(q.rank)?q.rank:1e9)||(p.prio||0)-(q.prio||0)||(p.i||0)-(q.i||0);
    const you=x=>num(x.youAt)?x.youAt:-Infinity;
    const byYou=(p,q)=>{const a=you(p),b=you(q);return a===b?office(p,q):a>b?-1:1;};
    const needs=list.filter(x=>x.needs).sort((p,q)=>{const a=num(p.since)?p.since:Infinity,b=num(q.since)?q.since:Infinity;return a===b?office(p,q):a<b?-1:1;});
    const rest=list.filter(x=>!x.needs);
    const fresh=x=>num(x.youAt)&&(!num(startedAt)||x.youAt>=startedAt);
    const head=needs.concat(rest.filter(fresh).sort(byYou)), idle=rest.filter(x=>!fresh(x)).sort(byYou);
    let open=null;
    if(typeof openId==='string'){const k=idle.findIndex(x=>x.id===openId);if(k>=0){open=openId;idle.splice(k,1);}}
    return {head:head.map(x=>x.id),open,idle:idle.map(x=>x.id)};
  }
  return {YOUAT_KEY,ORDER_KEY,IDLE_KEY,MAX_YOUAT,loadYouAt,stampYouAt,youAtJSON,stampable,loadOrder,loadIdleOpen,recent,FOLD_KEY,BORN_KEY,MAX_BORN,loadBorn,stampBorn,bornJSON,SORT_KEY,DEFAULT_SORT,SORTS,sortLabel,loadSort,MAX_FOLDS,MAX_PATH,group,loadFolds,foldsJSON,parentNames};
})());
