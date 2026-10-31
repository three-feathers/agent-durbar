/* Auto-follow work and the attention queue (spec 052 FR-182..FR-190, issue 686). Pure: no DOM, no timers, no clock of its own (time and the
   page's facts are passed in). In the page: window.DurbarAutoFollow; in Node: module.exports.
   It decides; app.js reads the page, opens chats and shows the strip. It is not a second attention model: `queue()` only puts the two
   existing ones in a fixed order (needsMeOrder() first, then the unread finished agents), and nothing here ever answers a request. */
(function(root, api){
  if(typeof module==='object'&&module.exports) module.exports=api; else root.DurbarAutoFollow=api;
})(typeof self!=='undefined'?self:this, (function(){
  'use strict';
  const TYPED_MS=2000; /* FR-185: a key typed into a field this recently still counts as typing */

  /* FR-186: one queue. `needs` is needsMeOrder() as ids (unchanged); `unread` is [{id, at}] of unread finished main agents, `at` = when each
     became unread. Unread ones follow the needs-you ones, oldest first (a tie or no time keeps the given order); an agent is listed once. */
  function queue(needs, unread){
    const out=[], seen=new Set();
    for(const id of Array.isArray(needs)?needs:[]){if(typeof id==='string'&&id&&!seen.has(id)){seen.add(id);out.push(id);}}
    const rest=(Array.isArray(unread)?unread:[]).filter(u=>u&&typeof u.id==='string'&&u.id&&!seen.has(u.id)).map((u,i)=>({id:u.id,i,t:Number(u.at)}));
    rest.sort((a,b)=>{const ta=Number.isFinite(a.t)?a.t:Infinity, tb=Number.isFinite(b.t)?b.t:Infinity;return ta===tb?a.i-b.i:ta-tb;});
    for(const r of rest){if(!seen.has(r.id)){seen.add(r.id);out.push(r.id);}}
    return out;
  }

  /* FR-186: the chat being viewed keeps its place. `held` = {id, at}: the id and the index it had; when it fell out of the live queue (it was
     answered, or its unread marker cleared) it is put back at that index (or the end) so "2 of 3" does not change under the person. */
  function withHeld(ids, held){
    const list=ids.slice();
    if(held&&typeof held.id==='string'&&held.id&&!list.includes(held.id)){
      const at=Number.isInteger(held.at)&&held.at>=0?Math.min(held.at,list.length):list.length;
      list.splice(at,0,held.id);
    }
    return list;
  }

  /* where `id` stands: {index (0-based, -1 when not in it), count} */
  function position(ids, id){return {index:ids.indexOf(id), count:ids.length};}

  /* FR-186: "2 of 3"; "Nothing needs you" for an empty queue; "none of 3" is never said: outside the queue it says the count only */
  function positionText(pos){
    if(!pos||!(pos.count>0))return 'Nothing needs you';
    return pos.index>=0?(pos.index+1)+' of '+pos.count:pos.count+(pos.count===1?' needs you':' need you');
  }

  /* FR-186: the neighbour. dir = 1 (Next) or -1 (Previous). It wraps. From outside the queue Next is the first and Previous the last.
     An empty queue gives null (FR-187: the caller goes back to the office). */
  function step(ids, currentId, dir){
    const n=ids.length; if(!n)return null;
    const i=ids.indexOf(currentId);
    if(i<0)return dir<0?ids[n-1]:ids[0];
    return ids[((i+(dir<0?-1:1))%n+n)%n];
  }

  /* FR-185: why a switch is held, '' when none is. s = what the page sees now:
     {editable (focus is in an editable field), editableText (that field has text), typedAgo (ms since a key was typed into a field, or null),
      dialog, menu, screen (Settings or Tools open), readingOther (the open chat is another agent's and scrolled up), hidden, blurred}.
     `office:true` is the return to the office right after a send: an empty field that just sent is not "typing". */
  function holdReason(s, o){
    s=s||{}; o=o||{};
    if(s.hidden)return 'the window is hidden';
    if(s.blurred)return 'the window is in the background';
    if(s.dialog)return 'a dialog is open';
    if(s.menu)return 'a menu is open';
    if(s.screen)return 'Settings or Tools is open';
    if(s.editable&&(!o.office||s.editableText))return 'you are typing';
    if(Number.isFinite(s.typedAgo)&&s.typedAgo>=0&&s.typedAgo<TYPED_MS&&(!o.office||s.editableText))return 'you are typing';
    if(s.readingOther)return 'you are reading another chat';
    return '';
  }

  /* what an agent's arrival is called: done, ask (a permission or a question), error, limit */
  const KINDS=['done','ask','error','limit'];

  /* the followed agents and their arrivals. FR-183..FR-185 */
  function createTracker(){
    const followed=new Set(), delivered=new Set(), pending=new Map(); /* pending: key -> {id, kind} */
    let quiet=false, last=null; /* quiet: one automatic switch happened and the person has not acted since; last: the last desk (FR-187) */
    return {
      follow(id){if(typeof id==='string'&&id){followed.add(id);last=id;}},
      has(id){return followed.has(id);},
      ids(){return [...followed];},
      get size(){return followed.size;},
      drop(id){followed.delete(id);for(const [k,v] of [...pending])if(v.id===id)pending.delete(k);},
      clear(){followed.clear();pending.clear();quiet=false;},
      /* FR-185: the person opened `id` by hand: every other followed agent stops being followed; the person acted, so a held arrival may be delivered */
      manualOpen(id){for(const f of [...followed])if(f!==id)this.drop(f);quiet=false;if(typeof id==='string'&&id)last=id;},
      /* FR-187: the last desk the person was on or followed */
      lastDesk(){return last;},
      setLast(id){if(typeof id==='string'&&id)last=id;},
      /* an arrival of a followed agent (once per key: a repeated report of the same thing is not a new arrival) */
      arrive(id,kind,key){
        if(!followed.has(id)||!KINDS.includes(kind))return false;
        const k=id+'|'+kind+'|'+String(key==null?'':key);
        if(delivered.has(k)||pending.has(k))return false;
        for(const [pk,v] of [...pending])if(v.id===id)pending.delete(pk); /* a newer arrival of the same agent replaces its older one */
        pending.set(k,{id,kind,key:k});return true;
      },
      /* an arrival that ended before it was delivered (answered elsewhere, error cleared) */
      retract(id,kinds){for(const [k,v] of [...pending])if(v.id===id&&(!kinds||kinds.includes(v.kind)))pending.delete(k);},
      pendingList(){return [...pending.values()];},
      /* FR-184, FR-185: the one arrival to deliver now, or null. `reason` = holdReason(); `can(id)` = the agent can be opened automatically
         (FR-188: not in a hidden folder or off floor). Delivering marks it, drops its follow, and goes quiet until the person acts. */
      due(reason,can){
        if(reason||quiet)return null;
        for(const v of pending.values()){
          if(can&&!can(v.id))continue;
          pending.delete(v.key);delivered.add(v.key);followed.delete(v.id);quiet=true;last=v.id;
          return {id:v.id,kind:v.kind};
        }
        return null;
      },
      /* the person did something of their own (Previous, Next, a click): arrivals held behind the quiet state may come */
      acted(){quiet=false;},
      get isQuiet(){return quiet;},
    };
  }

  /* FR-183, FR-190: the strip's words are about Durbar's own action, never the agent's voice and never a promise */
  function statusText(s){
    s=s||{};
    if(s.paused)return 'Auto-follow is paused. Nothing moves by itself.';
    if(s.held&&s.heldCount>0)return 'Held: '+s.held+'. '+(s.heldCount===1?'1 is waiting to open.':s.heldCount+' are waiting to open.');
    const n=Number(s.followed)||0;
    if(n===1&&s.hiddenName)return 'Auto-follow on. '+s.hiddenName+' is working in a hidden folder.';
    if(n>1)return 'Auto-follow on. '+n+' followed agents are working.';
    if(n===1)return 'Auto-follow on. '+(s.name||'An agent')+' is working. Back to the office.';
    return 'Auto-follow on. It follows an agent after you send it a message.';
  }

  return {TYPED_MS,KINDS,queue,withHeld,position,positionText,step,holdReason,createTracker,statusText};
})());
