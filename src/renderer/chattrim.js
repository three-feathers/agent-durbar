/* A chat keeps a bounded transcript (spec 005 FR-238, issue 1380): at most CHAT_KEEP.messages messages at the top of a chat, at most
   CHAT_KEEP.blocks blocks inside a timeline that is still growing (the open turn's, a running helper's), and at most CHAT_KEEP.budget leaf
   blocks in the whole chat (each message counts its timeline's blocks, else 1): over the budget, the oldest whole messages go, never the
   newest `.msg.user` nor the newest `.msg.agent` (notes do not count); then, if one closed message alone is over, its oldest blocks (its newest stays). The oldest go first everywhere. Never removed: a card that still waits for the person (not settled, with its own buttons: the test pendingCardOf
   uses), or a message holding one; the MCP line; the "Earlier messages and steps" line itself; a running helper's block; and the elements
   the caller names as live (the sign-in and fresh-note cards, the open turn's message, the typing line, the streaming thinking block, the
   live bubble and chip row). When blocks go, the timeline's bookkeeping for them goes too: a kept reference keeps the removed element alive.
   Pure: no globals; works on anything shaped like DOM elements (children, remove, classList, matches, querySelector(All), contains).
   In the page: window.DurbarChatTrim; in Node (tests): module.exports. */
(function(root, api){
  if(typeof module==='object'&&module.exports) module.exports=api; else root.DurbarChatTrim=api;
})(typeof self!=='undefined'?self:this, (function(){
  'use strict';
  const CHAT_KEEP=Object.freeze({messages:300,blocks:300,budget:2000});
  const KEEP_ROLES=Object.freeze(['user','agent']); /* the newest `.msg.user` and the newest `.msg.agent` (not notes): the budget never removes them whole */
  const NOTE_CLASS='chat-trim';
  /* a line updated in place by its own reference, a running helper, the note */
  const PIN_SEL='.mcp-line, .subblk.running, .'+NOTE_CLASS;
  const CARD_SEL='.note.perm:not(.settled)';
  /* as pendingCardOf (app.js): not settled AND its own actions row has a button. A Read-only denial is never settled; only the newest one
     carries the "Switch to Ask first…" button, so only that one is kept */
  function waitingCard(n){try{return !!(n&&n.matches&&n.matches(CARD_SEL)&&n.querySelector(':scope > .note-actions button'));}catch(e){return true;}}
  function holdsWaitingCard(el){
    if(waitingCard(el))return true;
    try{if(!el||!el.querySelector||!el.querySelector(CARD_SEL))return false;for(const n of el.querySelectorAll(CARD_SEL))if(waitingCard(n))return true;return false;}catch(e){return true;} /* unsure: keep it; most elements hold no card at all (one query) */
  }
  const has=(el,sel)=>{try{return !!(el&&((el.matches&&el.matches(sel))||(el.querySelector&&el.querySelector(sel))));}catch(e){return true;}};
  function isPinned(el,live){return !el||(!!live&&live.has(el))||has(el,PIN_SEL)||holdsWaitingCard(el);}
  /* Which of `n` items (index 0 = oldest) to drop so that at most `keep` remain, oldest first, skipping pinned ones; `pinned(i)` is asked
     only of the items it looks at (it stops as soon as enough are dropped). Pinned items count toward the total but are never dropped. */
  function planDrop(n,keep,pinned){
    const k=Math.max(0,Math.floor(Number(keep)||0)), over=Math.max(0,Math.floor(Number(n)||0)-k), out=[];
    for(let i=0;i<n&&out.length<over;i++)if(!pinned(i))out.push(i);
    return out;
  }
  /* Removes the oldest unpinned children of `parent` beyond `keep` (`skip(el)`: a child that neither counts nor goes, e.g. the note); returns how many went. */
  function trimChildren(parent,keep,live,skip){
    if(!parent||!parent.children)return 0;
    const kids=Array.prototype.filter.call(parent.children,el=>!(skip&&skip(el)));
    if(kids.length<=keep)return 0;
    const drop=planDrop(kids.length,keep,i=>isPinned(kids[i],live));
    for(const i of drop)kids[i].remove();
    return drop.length;
  }
  /* the leaf blocks of one message: the blocks of its timeline (`.tl`, found once and remembered), else 1 */
  const TL=typeof WeakMap==='function'?new WeakMap():null;
  function tlOf(el){
    if(TL&&TL.has(el))return TL.get(el);
    let t=null;try{t=el&&el.querySelector?el.querySelector(':scope > .tl'):null;}catch(e){t=null;}
    if(TL&&el&&typeof el==='object')TL.set(el,t);
    return t;
  }
  function leaves(el){const t=tlOf(el);return t?Math.max(1,t.childElementCount|0):1;}
  const isMsg=el=>!!(el&&el.classList&&el.classList.contains('msg'));
  const isNote=el=>!!(el&&el.classList&&el.classList.contains(NOTE_CLASS));
  const msgsOf=el=>el&&el.children?Array.prototype.filter.call(el.children,x=>!isNote(x)):[];
  function leafTotal(el){let n=0;for(const x of msgsOf(el))n+=leaves(x);return n;}
  /* Whether a chat is over any cap: cheap (counts only), so a chat at its caps costs nothing more per frame. `tls`: the growing timelines. */
  function over(o){
    const keep=o.keep||CHAT_KEEP, el=o.el; if(!el)return false;
    const msgs=(el.childElementCount|0)-(o.noteIn?1:0);
    if(msgs>keep.messages)return true;
    for(const t of o.tls||[])if(t&&t.tl&&(t.tl.childElementCount|0)>keep.blocks)return true;
    return leafTotal(el)>keep.budget;
  }
  /* The elements to remove, nothing removed yet. `o` = { el, keep, tls: [{ tl, live }] (the open turn first, then running helpers), live }. */
  function plan(o){
    const keep=o.keep||CHAT_KEEP, live=o.live||new Set(), el=o.el, drops=[];
    if(!el)return drops;
    const kids=msgsOf(el), gone=new Uint8Array(kids.length); /* by index: a Set of 200,000 elements cost more than the whole plan */
    /* the newest `.msg.user` and the newest `.msg.agent` are never removed whole, by the message cap or the budget (notes do not count: with
       more notes than the cap allows, the oldest notes go first); `kept` marks them */
    const kept=new Uint8Array(kids.length);
    for(const role of KEEP_ROLES){for(let i=kids.length-1;i>=0;i--)if(isMsg(kids[i])&&kids[i].classList.contains(role)){kept[i]=1;break;}}
    for(const i of planDrop(kids.length,keep.messages,i=>kept[i]||isPinned(kids[i],live))){gone[i]=1;drops.push(kids[i]);}
    const tlDrop=new Map();
    for(const t of o.tls||[]){
      if(!t||!t.tl||!el.contains(t.tl))continue;
      if(kids.some((k,i)=>gone[i]&&k.contains(t.tl)))continue; /* its message goes whole */
      const L=t.live?new Set([...live,...t.live]):live, bl=Array.prototype.slice.call(t.tl.children);
      const d=planDrop(bl.length,keep.blocks,i=>isPinned(bl[i],L)).map(i=>bl[i]);
      tlDrop.set(t.tl,d.length);for(const x of d)drops.push(x);
    }
    /* the budget: whole messages, oldest first, never a pinned one */
    let total=0;const left=new Float64Array(kids.length);
    for(let i=0;i<kids.length;i++){if(gone[i])continue;const k=kids[i];let n=leaves(k);const t=tlOf(k);if(t&&tlDrop.has(t))n=Math.max(1,n-tlDrop.get(t));left[i]=n;total+=n;}
    /* the newest `.msg.user` and the newest `.msg.agent` never go whole (the person's last question, the last reply, whatever comes after
       either: queued messages of the person do not push the reply out); notes after them (Stopped by you,
       a dropped switch, a fresh-session note) neither count nor use up that protection: they stay subject to the budget like any child */
    if(total>keep.budget){
      for(let i=0;i<kids.length;i++){
        if(total<=keep.budget)break;
        const k=kids[i];
        if(gone[i]||kept[i]||isPinned(k,live))continue;
        const t=tlOf(k);
        if(t&&tlDrop.has(t)){for(let j=drops.length-1;j>=0;j--)if(t.contains(drops[j]))drops.splice(j,1);} /* the whole message goes instead */
        gone[i]=1;drops.push(k);total-=left[i]||1;
      }
    }
    /* still over (one closed message larger than the budget, say a turn of thousands of calls): the oldest blocks of the closed timelines
       go, oldest message first, each keeping at least its newest block (the reply); a growing timeline is held by its own cap above */
    if(total>keep.budget){
      for(let i=0;i<kids.length&&total>keep.budget;i++){
        if(gone[i])continue;
        const t=tlOf(kids[i]);
        if(!t||tlDrop.has(t))continue;
        const bl=Array.prototype.slice.call(t.children);
        for(let j=0;j<bl.length-1&&total>keep.budget;j++){if(isPinned(bl[j],live))continue;drops.push(bl[j]);total--;}
      }
    }
    return drops;
  }

  /* After blocks left a timeline: forget every reference it keeps to an element no longer `inside` it.
     Returns true when the chip the waiting line names (T.actId) went, so the caller names the next one. */
  function forgetRemoved(T,inside){
    if(!T)return false;
    let actGone=false;
    for(const k of Object.keys(T.chipEls||{})){const c=T.chipEls[k];if(!c||!c.el||!inside(c.el)){delete T.chipEls[k];if(T.actId===k)actGone=true;}}
    if(T.think&&!(T.think.el&&inside(T.think.el)))T.think=null;
    if(T.chipsEl&&!inside(T.chipsEl))T.chipsEl=null;
    if(T.bubble&&!inside(T.bubble))T.bubble=null;
    return actGone;
  }
  /* The live elements of a chat (FR-238): the agent's sign-in and fresh-note cards, and the open turn's message, typing line, streaming
     thinking block, live bubble and chip row. `a`: the agent (or null), `t`: its open turn { m, T } (or null). */
  function liveSet(a,t){const T=t&&t.T;return new Set([a&&a.signCard,a&&a.freshNote,t&&t.m,T&&T.typing,T&&T.think&&T.think.el,T&&T.bubble,T&&T.chipsEl].filter(Boolean));}
  const noteText=n=>'Earlier messages and steps are not kept in this view ('+Number(n).toLocaleString('en-US')+' removed)';
  /* Removes what plan() chose: `onDrop(el)` is called for each before it goes (still in the chat). Then each timeline's bookkeeping
     (`Ts`: the open turn's T first, then helpers') forgets the removed blocks. Returns { removed, actGone } (actGone: the open turn's). */
  function apply(drops,Ts,onDrop){
    for(const d of drops){if(onDrop)onDrop(d);d.remove();}
    let actGone=false;
    if(drops.length)(Ts||[]).forEach((T,i)=>{if(!T||!T.tl)return;const g=forgetRemoved(T,x=>T.tl.contains(x));if(i===0)actGone=g;});
    return {removed:drops.length,actGone};
  }
  /* One pass over a chat: `o` = { el, T: the open turn (or null), live, keep, subs: [{ T, live }] }. Returns { removed, actGone }. */
  function trimChat(o){
    const T=o.T||null, subs=o.subs||[];
    const tls=(T?[{tl:T.tl}]:[]).concat(subs.map(s=>({tl:s.T&&s.T.tl,live:s.live})));
    const drops=plan({el:o.el,keep:o.keep,live:o.live,tls});
    return apply(drops,[T].concat(subs.map(s=>s.T)),o.onDrop);
  }
  return {KEEP_ROLES,liveSet,CHAT_KEEP,NOTE_CLASS,PIN_SEL,CARD_SEL,isPinned,waitingCard,planDrop,trimChildren,leaves,leafTotal,over,plan,apply,forgetRemoved,trimChat,noteText};
})());
