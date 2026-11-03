/* Spec 005 FR-194, FR-216: the rail's List view. Pure rules: no DOM, no timers, no storage. In the page: window.DurbarRail; in Node:
   module.exports (scripts/test-railorder.ts).
   group(items): the rows by folder. Each item is {id, room, rank, needs, since, prio, i}: the folder key, the folder's place in the office's
   room order, whether the session needs you (`needsMe`), since when (`NEED_SINCE`, ms), its `prio` and its creation order. Folders with
   someone needing you come first, oldest wait first, then the office's room order; inside a folder those needing you first, oldest first,
   then `prio`, then creation order. Time never reorders anything: only `needs` and `since`, which change with a status, do.
   loadFolds / foldsJSON: the collapsed folders, kept by path (the key the app already stores for the view, durbar.ui's `ws`). A corrupt,
   oversized or wrong-typed value loads as "nothing collapsed", never an error. */
(function(root, api){
  if(typeof module==='object'&&module.exports) module.exports=api; else root.DurbarRail=api;
})(typeof self!=='undefined'?self:this, (function(){
  'use strict';
  const FOLD_KEY='durbar.railFolds', MAX_FOLDS=200, MAX_PATH=1024;
  const num=v=>typeof v==='number'&&Number.isFinite(v);
  function group(items){
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
    const gs=[...by.values()];
    for(const g of gs)g.rows.sort(inGroup);
    gs.sort((a,b)=>{
      if(!!a.needN!==!!b.needN)return a.needN?-1:1;
      if(a.needN&&a.since!==b.since)return a.since<b.since?-1:1;
      return a.rank-b.rank||a.first-b.first;
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
  /* the value to store, or null to remove the key: only paths that are still folders (`known`), at most MAX_FOLDS */
  function foldsJSON(closed,known){
    const k=known instanceof Set?known:new Set(known||[]), list=[];
    for(const p of closed instanceof Set?closed:[]){if(typeof p==='string'&&p.length&&p.length<=MAX_PATH&&k.has(p))list.push(p);if(list.length>=MAX_FOLDS)break;}
    return list.length?JSON.stringify({v:1,closed:list}):null;
  }
  return {FOLD_KEY,MAX_FOLDS,MAX_PATH,group,loadFolds,foldsJSON};
})());
