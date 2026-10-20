/* "Needs you" outside the window and the inbox order (spec 052 FR-059, FR-061): the window title, the wait label, the oldest-first sort and
   the decision when to show one OS notification. Pure: no DOM, no timers of its own (time is injected). In the page: window.DurbarAttention;
   in Node: module.exports. */
(function(root, api){
  if(typeof module==='object'&&module.exports) module.exports=api; else root.DurbarAttention=api;
})(typeof self!=='undefined'?self:this, (function(){
  'use strict';
  const CUT=typeof module==='object'&&module.exports?require('./cuttext.js'):self.DurbarCutText;
  const APP='Agent Durbar';
  const COALESCE_MS=2000;   /* items that arrive within this long share one notification */
  const THROTTLE_MS=10000;  /* at most one notification this often */
  const BODY_MAX=80;

  /* "(3) Agent Durbar" while anything needs you, else "Agent Durbar" */
  function titleFor(n){const k=Math.floor(Number(n));return Number.isFinite(k)&&k>0?'('+k+') '+APP:APP;}

  /* one line, at most `max` characters (an ellipsis when cut) */
  function clip(text,max){
    return CUT.cutText(text,max>0?max:BODY_MAX); /* shared helper (cuttext.js) */
  }

  /* "waiting 4 min"; minutes only (the inbox repaints every 30 s at most) */
  function waitLabel(ms){
    const v=Number(ms); if(!Number.isFinite(v)||v<0)return '';
    const m=Math.floor(v/60000);
    if(m<1)return 'waiting under 1 min';
    if(m<60)return 'waiting '+m+' min';
    const h=Math.floor(m/60), r=m%60;
    return 'waiting '+h+' h'+(r?' '+r+' min':'');
  }

  /* oldest first by when each started needing you; a tie (or no time) keeps the given order */
  function sortOldestFirst(items,sinceOf){
    return items.map((x,i)=>({x,i,t:Number(sinceOf(x))})).sort((a,b)=>{
      const ta=Number.isFinite(a.t)?a.t:Infinity, tb=Number.isFinite(b.t)?b.t:Infinity;
      return ta===tb?a.i-b.i:ta-tb;
    }).map(o=>o.x);
  }

  /* One coalesced notification for new items while the window is in the background.
     observe(items, {armed, enabled, focused}): items are {key, id, name, text} for everything that needs you now. A key not seen before is
       new; before `armed` (startup) every key is only remembered. An item that leaves the list leaves the pending batch too; focus drops it.
     dueAt(): when the batch may be shown (null = nothing pending). take(): the notification {title, body, id} when due, else null. */
  function createNotifier(o){
    const now=(o&&o.now)||(()=>Date.now()), coalesce=(o&&o.coalesceMs)||COALESCE_MS, throttle=(o&&o.throttleMs)||THROTTLE_MS;
    let known=new Set(), batch=[], batchAt=0, last=-Infinity;
    return {
      observe(items,f){
        const opts=f||{}, list=Array.isArray(items)?items.filter(x=>x&&x.key!=null):[], keys=new Set(list.map(x=>String(x.key)));
        batch=batch.filter(x=>keys.has(String(x.key)));
        if(opts.focused||!opts.enabled)batch=[];
        for(const x of list){
          const k=String(x.key); if(known.has(k))continue;
          if(opts.armed&&opts.enabled&&!opts.focused){if(!batch.length)batchAt=now();batch.push(x);}
        }
        known=keys;
      },
      dueAt(){return batch.length?Math.max(batchAt+coalesce,last+throttle):null;},
      take(){
        if(!batch.length||now()<this.dueAt())return null;
        const ids=[...new Set(batch.map(x=>x.id))], first=batch[0];
        const n=ids.length===1?{title:(first.name||'An agent')+' needs you',body:clip(first.text||'',BODY_MAX),id:first.id}
          :{title:ids.length+' agents need you',body:clip([...new Set(batch.map(x=>x.name||'An agent'))].join(', '),BODY_MAX),id:first.id};
        batch=[];last=now();
        return n;
      },
    };
  }

  return {APP,COALESCE_MS,THROTTLE_MS,BODY_MAX,titleFor,clip,waitLabel,sortOldestFirst,createNotifier};
})());
