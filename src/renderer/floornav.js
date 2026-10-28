/* Floors as places (spec 092): the rules for moving between floor screens. Pure: no DOM, no timers, no storage. Same pattern as places.js.
   In the page: window.DurbarFloorNav; in Node: module.exports.
   A "floor" here is {id, name, on}; the list is in floor order (spec 033), the first floor is the top of the building (spec 092 Q-A). */
(function(root, api){
  if(typeof module==='object'&&module.exports) module.exports=api; else root.DurbarFloorNav=api;
})(typeof self!=='undefined'?self:this, (function(){
  'use strict';
  const list=f=>Array.isArray(f)?f.filter(x=>x&&typeof x==='object'&&typeof x.id==='string'):[];
  const onList=f=>list(f).filter(x=>x.on);
  /* Floor screens exist only with two or more floors on (FR-001, FR-004). */
  const screens=f=>onList(f).length>=2;
  /* The next floor that is on after `cur` in direction `dir` ('next' = down the list, PageDown; 'prev' = up, PageUp), skipping floors that are off
     (FR-011). No wrap: at the last (first) floor, or when `cur` is not in the list, null. */
  function nextOn(floors,cur,dir){
    const all=list(floors),i=all.findIndex(x=>x.id===cur);
    if(i<0||(dir!=='next'&&dir!=='prev'))return null;
    const step=dir==='next'?1:-1;
    for(let j=i+step;j>=0&&j<all.length;j+=step)if(all[j].on)return all[j].id;
    return null;
  }
  /* The floor the view should be on, given the one it was on (FR-022, FR-023): `cur` itself when it is on; else the next floor that is on
     after it, else the previous one; the first floor that is on when `cur` is unknown. `before` (optional) = the floor ids in the order
     they had before a change, so a floor that was deleted still has a place in the building. null when no floor is on. */
  function nearestOn(floors,cur,before){
    const all=list(floors),on=all.filter(x=>x.on);
    if(!on.length)return null;
    if(on.some(x=>x.id===cur))return cur;
    const ids=all.map(x=>x.id);
    const old=Array.isArray(before)?before.filter(x=>typeof x==='string'):null;
    const pos=ids.indexOf(cur)>=0?ids.indexOf(cur):old&&old.indexOf(cur)>=0?old.indexOf(cur):-1;
    if(pos<0)return on[0].id;
    if(ids.indexOf(cur)>=0){
      const nx=nextOn(all,cur,'next');if(nx)return nx;
      const pv=nextOn(all,cur,'prev');return pv||on[0].id;
    }
    /* a deleted floor: the floors that were after it in the old order, then the ones before it */
    const after=old.slice(pos+1).map(id=>on.find(x=>x.id===id)).find(Boolean);
    if(after)return after.id;
    const prior=old.slice(0,pos).reverse().map(id=>on.find(x=>x.id===id)).find(Boolean);
    return prior?prior.id:on[0].id;
  }
  const TEXT_SEL='input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"],[role="combobox"],[role="listbox"],[role="slider"],[role="menu"],[role="menuitem"],[role="dialog"]';
  const inText=t=>{
    if(!t||typeof t!=='object')return false;
    if(t.isContentEditable===true)return true;
    try{return typeof t.closest==='function'&&!!t.closest(TEXT_SEL);}catch(e){return false;}
  };
  /* What a PageUp / PageDown press does (FR-011): {go:'next'|'prev'} change the floor; {scroll:1|-1} scroll the floor screen by a page first (a screen that
     scrolls scrolls first and changes floor only from an edge: a press that reaches the edge does not also change floor); null = the key keeps its own meaning.
     e = the key event; target = the element that has the focus; scroll = {scrolls, atTop, atBottom} of the floor screen, read before the key does anything;
     open = {office: the office view is shown (default true), dialog, menu: one is open, all: the All floors view is shown (FR-034: scroll only)}. A held key (repeat) does nothing here, so a long press scrolls
     the browser's way and never rushes through the floors. */
  function keyAction(e,target,scroll,open){
    if(!e||(e.key!=='PageDown'&&e.key!=='PageUp'))return null;
    if(e.ctrlKey||e.altKey||e.shiftKey||e.metaKey||e.isComposing||e.repeat||e.defaultPrevented)return null;
    const o=open||{};
    if(o.office===false||o.dialog||o.menu)return null;
    if(inText(target))return null;
    const dir=e.key==='PageDown'?'next':'prev',s=scroll||{};
    if(s.scrolls&&(dir==='next'?!s.atBottom:!s.atTop))return {scroll:dir==='next'?1:-1};
    if(o.all)return null; /* FR-034: in the All floors view the keys only scroll; they never change the floor or the view */
    return {go:dir};
  }
  /* Does this key press change the floor? 'next' (PageDown), 'prev' (PageUp) or null (it scrolls the floor screen first, or keeps its own meaning). */
  function keyEligible(e,target,scroll,open){const a=keyAction(e,target,scroll,open);return a&&a.go?a.go:null;}
  /* What a screen reader hears after a floor change (FR-012): "Floor Client B, 2 of 3". `floor` = the floor object or its name; n = its place among
     the floors that are on (from 1), m = how many are on. */
  function announceText(floor,n,m){
    const name=floor&&typeof floor==='object'?floor.name:floor;
    return 'Floor '+String(name==null?'':name)+', '+n+' of '+m;
  }
  /* The place of a floor among the floors that are on: {n, m} (n from 1), or null when it is not on. */
  function place(floors,id){
    const on=onList(floors),i=on.findIndex(x=>x.id===id);
    return i<0?null:{n:i+1,m:on.length};
  }
  /* ---- phase 2: the All floors view (FR-031..FR-037) and the lift's badges (FR-014, FR-015, FR-028) ---- */
  /* The view from its stored value (FR-037): 'all' only for exactly the string 'all'; anything else (absent, blocked storage, a bad value) is the
     one-floor default. */
  const viewOf=v=>v==='all'?'all':'one';
  /* The view's storage (FR-037; Paco's review of #849): `store` is a function that returns the storage (localStorage in the page), so even reaching it
     can throw (blocked site data, private mode) without breaking anything: a read that throws is the one-floor default, a write that throws is lost
     (false). The key is removed for the default, so only an explicit 'all' is ever stored. */
  const VIEW_KEY='durbar.floorView';
  function readView(store){try{const st=store();return viewOf(st?st.getItem(VIEW_KEY):null);}catch(e){return 'one';}}
  function writeView(store,v){try{const st=store();if(!st)return false;if(viewOf(v)==='all')st.setItem(VIEW_KEY,'all');else st.removeItem(VIEW_KEY);return true;}catch(e){return false;}}
  /* What a screen reader hears when the All floors view is chosen (FR-036): "All floors, 3 floors". */
  const announceAll=m=>'All floors, '+m+' floor'+(m===1?'':'s');
  const KINDS=['waiting','error','limit','reply'];
  const WORDS={waiting:'waiting',error:'error',limit:'limit reached',reply:'new reply'};
  const ERRS={error:'errors'};
  const zero=()=>({n:0,waiting:0,error:0,limit:0,reply:0,hidden:0});
  /* Badge counts per floor (FR-014, FR-016): items = one entry per agent that needs the user, {floor: its floor id, kind: one of KINDS, hidden: in a
     hidden folder}; an agent is counted once (the caller gives each agent one kind). Floors that are off have no badge; nor does `cur` (the floor shown);
     with `all` (the All floors view, FR-035) no floor has one. Returns {floorId: {n, waiting, error, limit, reply, hidden}} for floors with n > 0. */
  function badgeCounts(floors,items,cur,all){
    const out={};
    if(all)return out;
    const on=new Set(onList(floors).map(x=>x.id)), seen=new Set();
    for(const it of Array.isArray(items)?items:[]){
      if(!it||typeof it!=='object'||!on.has(it.floor)||it.floor===cur||!KINDS.includes(it.kind))continue;
      if(it.id!=null){if(seen.has(it.id))continue;seen.add(it.id);}
      const c=out[it.floor]||(out[it.floor]=zero());
      c.n++; c[it.kind]++; if(it.hidden)c.hidden++;
    }
    return out;
  }
  /* The words of a badge (FR-015): "2 waiting, 1 error, 1 new reply"; '' with nothing. */
  function badgeText(c){
    if(!c||!c.n)return '';
    return KINDS.filter(k=>c[k]>0).map(k=>c[k]+' '+(c[k]>1&&ERRS[k]?ERRS[k]:WORDS[k])).join(', ');
  }
  /* The count on a badge (FR-015): '9+' past nine. */
  const badgeNum=n=>n>9?'9+':String(n|0);
  /* The pinned edge rows of a lift that scrolls (FR-028): items = [{pos: 'above'|'in'|'below', counts}] for the badged buttons; the counts of the
     buttons out of view above and below are summed. {up, down}: the summed counts, or null when nothing badged is out of view on that side. */
  function edgeSummary(items){
    const sum={above:null,below:null};
    for(const it of Array.isArray(items)?items:[]){
      if(!it||(it.pos!=='above'&&it.pos!=='below')||!it.counts||!it.counts.n)continue;
      const c=sum[it.pos]||(sum[it.pos]=zero());
      for(const k of ['n','hidden'].concat(KINDS))c[k]+=it.counts[k]|0;
    }
    return {up:sum.above,down:sum.below};
  }
  return {screens,nextOn,nearestOn,keyAction,keyEligible,announceText,place,TEXT_SEL,viewOf,readView,writeView,VIEW_KEY,announceAll,badgeCounts,badgeText,badgeNum,edgeSummary,KINDS};
})());
