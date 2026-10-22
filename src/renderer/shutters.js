/* Finished agents roll in (spec 001 FR-051..FR-053): which main agents of a room roll in, and how far. Pure: no DOM, no clock of its own
   (the time since the agent finished is passed in). In the page: window.DurbarShutters; in Node: module.exports.
   An agent is a plain object: {id, state, paused, limit, away, replied, helpersBusy, since} where `state` is the shown state (vis),
   `replied` says it has a last reply in this session, `helpersBusy` that a helper is not Done or Idle, and `since` the milliseconds since
   its last event (null when unknown). */
(function(root, api){
  if(typeof module==='object'&&module.exports) module.exports=api; else root.DurbarShutters=api;
})(typeof self!=='undefined'?self:this, (function(){
  'use strict';
  /* owner defaults (FR-052): on the couch for 10 minutes after finishing, then on a nap bed; 3 seats a couch; beds are bunks (2 to a
     column); up to 4 beds, else 3 and "+N asleep"; the corner is at least 150px wide so a bubble has room for its lines. Sizes in px (styles.css uses the same): the layout counts the corner so the open desks get the rest of the row (FR-053). */
  const RECENT_MS=10*60000, OLD_CAP=4, COUCH_SEATS=3, SEAT_W=64, COUCH_PAD=8, BUNK_W=72, MORE_W=52, GAP=6, PAD=8, MIN_W=150;
  /* FR-051: Done, or Idle after a finished turn; never paused (coffee break), at a limit, away at a place, or with a busy helper */
  function finished(x){
    if(!x||x.paused||x.limit||x.away||x.helpersBusy)return false;
    return x.state==='done'||(x.state==='idle'&&!!x.replied);
  }
  /* 'recent' (half rolled), 'old' (fully rolled) or null (keeps its desk), for one finished agent; unknown time counts as old */
  function kindOf(x){
    if(!finished(x))return null;
    const t=x.since;
    return typeof t==='number'&&Number.isFinite(t)&&t>=0&&t<RECENT_MS?'recent':'old';
  }
  /* FR-051: the room rule. Returns a Map id -> 'recent' | 'old' for the agents that roll in; empty when no agent of the room stays open */
  function roomPlan(list){
    const out=new Map(), xs=Array.isArray(list)?list:[];
    const kinds=xs.map(kindOf);
    if(!kinds.some(k=>k===null))return out;
    xs.forEach((x,i)=>{if(kinds[i])out.set(x.id,kinds[i]);});
    return out;
  }
  /* FR-052: the beds shown and the sleepers behind "+N asleep": all when expanded or when they fit, else cap-1 beds and the rest */
  function split(old,cap,expanded){
    const xs=Array.isArray(old)?old:[], c=Math.max(2,cap==null?OLD_CAP:cap|0);
    if(expanded||xs.length<=c)return {shown:xs.slice(),hidden:[]};
    return {shown:xs.slice(0,c-1),hidden:xs.slice(c-1)};
  }
  /* FR-052: how many sit on each couch: 3 a couch, then another couch ([3,2] for 5) */
  function couches(n){const out=[];let k=Math.max(0,n|0);while(k>0){out.push(Math.min(COUCH_SEATS,k));k-=COUCH_SEATS;}return out;}
  /* FR-055: whose bubble shows at turn t (the page moves t every few seconds; a test moves it by hand) */
  function turn(t,n){n=n|0;if(n<=0)return 0;const k=Math.floor(Number(t)||0);return ((k%n)+n)%n;}
  /* FR-054: the "last activity" words (DurbarActivity.agoLong: "just now", "12 min ago", "3 h ago", "2 d ago") for a screen reader */
  function spoken(ago){
    const m=/^(\d+) (min|h|d) ago$/.exec(String(ago||''));
    if(!m)return ago==='just now'?'just now':'';
    const n=+m[1], w={min:'minute',h:'hour',d:'day'}[m[2]];
    return n+' '+w+(n===1?'':'s')+' ago';
  }
  /* FR-052: bunk columns for n beds (two beds to a column) */
  function bunks(n){return Math.ceil(Math.max(0,n|0)/2);}
  /* FR-053: the lounge corner's width: couches (seats and their frame), bunk columns, the "+N asleep" button, gaps and padding, at least
     MIN_W; 0 when empty */
  function width(nRecent,nBeds,more){
    const cs=couches(nRecent), cols=bunks(nBeds);
    const couch=cs.length?cs.reduce((w,k)=>w+k*SEAT_W+COUCH_PAD,0)+(cs.length-1)*GAP:0;
    const items=cols+(more?1:0), beds=items?cols*BUNK_W+(more?MORE_W:0)+(items-1)*GAP:0;
    if(!couch&&!beds)return 0;
    return Math.max(MIN_W,2*PAD+couch+beds+(couch&&beds?GAP:0));
  }
  return {RECENT_MS,OLD_CAP,COUCH_SEATS,SEAT_W,COUCH_PAD,BUNK_W,MORE_W,GAP,PAD,MIN_W,finished,kindOf,roomPlan,split,couches,bunks,turn,spoken,width};
})());
