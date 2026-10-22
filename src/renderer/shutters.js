/* Finished agents roll in (spec 001 FR-051..FR-053): which main agents of a room roll in, and how far. Pure: no DOM, no clock of its own
   (the time since the agent finished is passed in). In the page: window.DurbarShutters; in Node: module.exports.
   An agent is a plain object: {id, state, paused, limit, away, replied, helpersBusy, since} where `state` is the shown state (vis),
   `replied` says it has a last reply in this session, `helpersBusy` that a helper is not Done or Idle, and `since` the milliseconds since
   its last event (null when unknown). */
(function(root, api){
  if(typeof module==='object'&&module.exports) module.exports=api; else root.DurbarShutters=api;
})(typeof self!=='undefined'?self:this, (function(){
  'use strict';
  /* owner defaults (FR-052): a narrow panel for 10 minutes after finishing, then a slat; up to 6 slats, else 5 and a "+N" slat.
     Widths in px (styles.css uses the same): the layout counts them so the open desks get the rest of the row (FR-053). */
  const RECENT_MS=10*60000, OLD_CAP=5, PANEL_W=136, SLAT_W=40, GAP=6;

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
  /* FR-052: the slats shown and the ones behind "+N" (all shown when expanded, or when only one would hide) */
  function split(old,cap,expanded){
    const xs=Array.isArray(old)?old:[], c=Math.max(1,cap==null?OLD_CAP:cap|0);
    if(expanded||xs.length<=c+1)return {shown:xs.slice(),hidden:[]};
    return {shown:xs.slice(0,c),hidden:xs.slice(c)};
  }
  /* FR-054: the "last activity" words (DurbarActivity.agoLong: "just now", "12 min ago", "3 h ago", "2 d ago") for a screen reader */
  function spoken(ago){
    const m=/^(\d+) (min|h|d) ago$/.exec(String(ago||''));
    if(!m)return ago==='just now'?'just now':'';
    const n=+m[1], w={min:'minute',h:'hour',d:'day'}[m[2]];
    return n+' '+w+(n===1?'':'s')+' ago';
  }
  /* FR-053: the width of a room's group: its panels, its slats and one "+N" or "Show fewer" slat when there is one; 0 when empty */
  function width(nRecent,nSlats,more){
    const p=Math.max(0,nRecent|0), q=Math.max(0,nSlats|0)+(more?1:0), n=p+q;
    return n?p*PANEL_W+q*SLAT_W+(n-1)*GAP:0;
  }
  return {RECENT_MS,OLD_CAP,PANEL_W,SLAT_W,GAP,finished,kindOf,roomPlan,split,spoken,width};
})());
