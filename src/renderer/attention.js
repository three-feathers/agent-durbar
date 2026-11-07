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
    if(m<1)return 'waiting less than a minute';
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

  /* Your door (spec 052 FR-193, T196): what is NEW to the panel that opens by itself. Pure; time injected. Items are {key, id, kind, card}:
     a card's key is its request id (all of an agent's cards, not only the oldest), a state with no card is agent plus kind. Unlike the notifier
     it remembers a key after the agent leaves the list while that agent is paused (unpausing shows the same card: not new). A settled card, or a
     card-less key whose agent left that state, is forgotten; an error is forgotten only after a full THROTTLE_MS out of error (a retry loop opens once).
     Before `armed` everything is only remembered. observe() returns {fresh, startup}: startup is true once, on the first armed look with anything waiting. */
  function createArrivals(o){
    const now=(o&&o.now)||(()=>Date.now()), throttle=(o&&o.throttleMs)||THROTTLE_MS;
    const known=new Map(); let wasArmed=false;
    return {
      observe(items,f){
        const opts=f||{}, armed=!!opts.armed, paused=typeof opts.isPaused==='function'?opts.isPaused:()=>false;
        const list=(Array.isArray(items)?items:[]).filter(x=>x&&x.key!=null&&x.id!=null), present=new Set(list.map(x=>String(x.key)));
        const fresh=[];
        for(const x of list){
          const k=String(x.key), v=known.get(k);
          if(v){v.seen=now();continue;}
          /* the same agent gaining its card (a demo chat being built): its card-less wait of the same kind, or a plain wait */
          const flip=x.card?[String(x.id)+'|'+x.kind,String(x.id)+'|w'].find(f=>known.has(f)&&!known.get(f).card):null;
          if(flip){known.delete(flip);known.set(k,{id:x.id,kind:x.kind,card:true,seen:now()});continue;}
          known.set(k,{id:x.id,kind:x.kind,card:!!x.card,seen:now()});
          if(armed)fresh.push(x);
        }
        for(const [k,v] of [...known]){
          if(present.has(k)||paused(v.id))continue;
          if(!v.card&&v.kind==='e'&&now()-v.seen<throttle)continue;
          known.delete(k);
        }
        let startup=false;
        if(armed&&!wasArmed){wasArmed=true;startup=list.length>0;}
        return {fresh,startup};
      },
    };
  }

  /* When the panel may open by itself. arrive(n): n new requests; startup(): something waited at app start; dismissed(): the person closed it.
     ruling({open, held}) -> 'open' | 'startup' | 'hold' | 'none'. A burst is one opening; a held opening stays pending (nothing is lost) and
     opens once when the guard clears; a request within COALESCE_MS of a dismissal does not snap it back, and it opens at most once per THROTTLE_MS.
     App start is not throttled or coalesced (the owner wants the list) but is held like any opening. */
  function createDoorGate(o){
    const now=(o&&o.now)||(()=>Date.now()), coalesce=(o&&o.coalesceMs)||COALESCE_MS, throttle=(o&&o.throttleMs)||THROTTLE_MS;
    let pending=0, start=false, lastDismiss=-Infinity, lastOpen=-Infinity;
    return {
      arrive(n){if(n>0)pending+=n;},
      startup(){start=true;},
      dismissed(){lastDismiss=now();},
      ruling(s){
        const st=s||{};
        if(st.open){pending=0;start=false;return 'none';}
        if(!pending&&!start)return 'none';
        if(st.held)return 'hold';
        const t=now();
        if(start){start=false;pending=0;lastOpen=t;return 'startup';}
        pending=0;
        if(t-lastDismiss<coalesce||t-lastOpen<throttle)return 'none';
        lastOpen=t;return 'open';
      },
    };
  }

  /* FR-198: a row's answer buttons take no press until RISE_GUARD_MS after the panel opened or the row moved under the pointer. opened(t) starts the panel's
     guard; place(list, t) takes [{key, top, under}] (key = agent and request, top = the row's place, under = the pointer is on it now) and returns key -> armAt
     (a row already there keeps its time; a new or moved row under the pointer gets t + ms); armed(armAt, t) says whether a press is allowed. */
  const RISE_GUARD_MS=400;
  function createRiseGuard(o){
    const ms=(o&&o.ms)||RISE_GUARD_MS; let openAt=-Infinity; const rows=new Map();
    return {
      opened(t){openAt=t;rows.clear();},
      close(){rows.clear();},
      place(list,t){
        const next=new Map();
        for(const r of list||[]){const prev=rows.get(r.key);let at=Math.max(openAt+ms,prev?prev.armAt:0);const moved=!prev||Math.abs(prev.top-r.top)>=1;
          if(moved&&r.under)at=Math.max(at,t+ms);next.set(r.key,{top:r.top,armAt:at});}
        rows.clear();next.forEach((v,k)=>rows.set(k,v));
        const out=new Map();next.forEach((v,k)=>out.set(k,v.armAt));return out;
      },
      armed(at,t){return t>=at;},
    };
  }

  /* FR-197: what a press does. found: the agent's live pending card with the id the row was painted for exists; holds: that card still holds the very button the row
     copied; disabled: that button is on its way. Only 'send' sends; the agent's next card is never used in place of a missing one. */
  function pressVerdict(s){const x=s||{};if(!x.found||!x.holds)return 'stale';return x.disabled?'waiting':'send';}

  return {APP,COALESCE_MS,THROTTLE_MS,BODY_MAX,titleFor,clip,waitLabel,sortOldestFirst,createNotifier,createArrivals,createDoorGate,createRiseGuard,pressVerdict,RISE_GUARD_MS};
})());
