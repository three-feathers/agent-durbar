/* A parent keeps its newest finished helpers (spec 005 FR-240, issue 1418): at most SUB_KEEP.done finished helpers that ended well and
   SUB_KEEP.failed that failed, the newest by the time they ended (`t1`); the older ones are retired by app.js (subRetire). Never retired:
   a running helper (also a background one), and the ids the caller names as held (the open one, the one holding the focus, a text
   selection or an open message menu). Held helpers count toward their limit but never go, so with more held than the limit nothing goes.
   Equal end times keep the order the helpers came in (the earlier one is the older). Any status but running and failed counts as done.
   Pure: no globals, no DOM. In the page: window.DurbarSubRetire; in Node (tests): module.exports. */
(function(root, api){
  if(typeof module==='object'&&module.exports) module.exports=api; else root.DurbarSubRetire=api;
})(typeof self!=='undefined'?self:this, (function(){
  'use strict';
  const SUB_KEEP=Object.freeze({done:50,failed:20});
  const GONE_MAX=500; /* the tombstone ring on the parent: the last 500 retired ids */
  const lim=v=>{const n=Math.floor(Number(v));return Number.isFinite(n)&&n>0?n:0;};
  const endOf=s=>{const t=Number(s&&s.t1);return Number.isFinite(t)?t:0;};
  /* `o` = { subs: iterable of { id, status, t1 } in the order they came (a Map's values), keep: { done, failed }, held: Set of ids (or
     an array) }. Returns the ids to retire, oldest first; [] when every status is at or under its limit. */
  function plan(o){
    const out=[];if(!o||!o.subs)return out;
    const keep=o.keep||SUB_KEEP,held=o.held instanceof Set?o.held:new Set(o.held||[]);
    const by={done:[],failed:[]};let i=0;
    for(const s of o.subs){
      i++;
      if(!s||s.status==='running')continue; /* the running guard: a running helper (also a background one) is never retired */
      by[s.status==='failed'?'failed':'done'].push({s,i});
    }
    for(const st of ['done','failed']){
      const k=lim(keep[st]),list=by[st];
      if(list.length<=k)continue;
      /* oldest first: by end time, then by arrival (a stable order for equal times) */
      list.sort((x,y)=>endOf(x.s)-endOf(y.s)||x.i-y.i);
      let over=list.length-k;
      for(const x of list){if(over<=0)break;if(held.has(x.s.id))continue;out.push(x.s.id);over--;}
    }
    return out;
  }
  /* The tombstone ring: remembers `id` as retired (a Set in arrival order, the oldest forgotten past `max`). Returns the ring. */
  function bury(ring,id,max){
    const r=ring instanceof Set?ring:new Set(),m=lim(max==null?GONE_MAX:max);
    r.delete(id);r.add(id);
    while(r.size>m){const first=r.values().next().value;r.delete(first);}
    return r;
  }
  const noteText=n=>{const k=Math.max(0,Math.floor(Number(n)||0));return k.toLocaleString('en-US')+' earlier helper'+(k===1?' is':'s are')+' not kept in this view';};
  return {SUB_KEEP,GONE_MAX,plan,bury,noteText};
})());
