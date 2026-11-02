/* Rearranging the office (spec 033, delta 2026-11-01, issue 677): the rules for a saved manual order of rooms, desks and places, and the
   pointer drag that changes it. Order is sequencing only: it never turns the automatic layout off (density, columns, fit are chosen as before).
   Pure part: no DOM, no timers, no storage. Drag part: touches the DOM only through `attach`, moves nothing but `transform` and `opacity`,
   reads layout once when a drag starts and never again until it ends. In the page: window.DurbarReorder; in Node: module.exports.
   The order document is {rooms:[room key], desks:{room key:[agent id]}, places:[place id]}; a key not listed sorts after the listed ones in
   its usual order, an id that is gone is ignored (a corrupt or old document is never an error). */
(function(root, api){
  if(typeof module==='object'&&module.exports) module.exports=api; else root.DurbarReorder=api;
})(typeof self!=='undefined'?self:this, (function(){
  'use strict';
  const MAX_ROOMS=200, MAX_DESK_ROOMS=200, MAX_DESKS=100, MAX_PLACES=50, MAX_KEY=1024;
  const str=(v,n)=>typeof v==='string'&&v.length>0&&v.length<=n;
  /* a clean list of distinct strings, at most `max` long */
  function cleanList(v,max,len){
    const out=[],seen=new Set();
    for(const k of Array.isArray(v)?v:[]){if(!str(k,len||MAX_KEY)||seen.has(k))continue;seen.add(k);out.push(k);if(out.length>=max)break;}
    return out;
  }
  const empty=()=>({rooms:[],desks:{},places:[]});
  /* Tolerant parse of a saved order document. Never throws. */
  function sanitize(raw){
    const o=raw&&typeof raw==='object'&&!Array.isArray(raw)?raw:{};
    const desks=[];
    const src=o.desks&&typeof o.desks==='object'&&!Array.isArray(o.desks)?Object.entries(o.desks):[];
    for(const [k,v] of src){
      if(desks.length>=MAX_DESK_ROOMS)break;
      if(!str(k,MAX_KEY))continue;
      const l=cleanList(v,MAX_DESKS,200);
      if(l.length)desks.push([k,l]);
    }
    return {rooms:cleanList(o.rooms,MAX_ROOMS),desks:Object.fromEntries(desks),places:cleanList(o.places,MAX_PLACES,200)};
  }
  const isEmpty=d=>!d||(!d.rooms.length&&!d.places.length&&!Object.keys(d.desks).length);
  /* The items in their shown order: the ones the saved order lists first, in that order; the others after them, in their own order. */
  function sortBy(items,keyOf,order){
    const idx=new Map((Array.isArray(order)?order:[]).map((k,i)=>[k,i]));
    if(!idx.size)return items.slice();
    const BIG=1e9;
    return items.map((x,i)=>[x,i,idx.has(keyOf(x))?idx.get(keyOf(x)):BIG]).sort((a,b)=>a[2]-b[2]||a[1]-b[1]).map(p=>p[0]);
  }
  /* `list` (keys in shown order) with `key` taken out and put before `target` (or after it); unchanged when either is missing or equal. */
  function moveTo(list,key,target,after){
    const l=list.slice(), i=l.indexOf(key);
    if(i<0||key===target||l.indexOf(target)<0)return l;
    l.splice(i,1);
    const j=l.indexOf(target);
    l.splice(after?j+1:j,0,key);
    return l;
  }
  /* One step on the keyboard: `key` swaps places with its neighbour `delta` (-1 earlier, +1 later) in `list`. null at either end or for an unknown key. */
  function step(list,key,delta){
    const i=list.indexOf(key), j=i+delta;
    if(i<0||j<0||j>=list.length||(delta!==-1&&delta!==1))return null;
    const l=list.slice();[l[i],l[j]]=[l[j],l[i]];
    return {list:l,from:i,to:j};
  }
  /* The new saved list after a group (the rooms of one floor, the desks of one room) was put in a new order: the group first, in that order,
     then every saved key that is not in the group, so other floors and hidden rooms keep their relative order. */
  function merge(saved,group,max){
    const g=new Set(group);
    return [...group,...(Array.isArray(saved)?saved:[]).filter(k=>!g.has(k))].slice(0,max||MAX_ROOMS);
  }
  /* Where a pointer is among the cached slots: the index of the slot whose centre is nearest (rows first when the slots wrap). */
  function nearest(slots,x,y){
    let best=-1,bd=Infinity;
    slots.forEach((r,i)=>{const dx=x-(r.left+r.width/2),dy=y-(r.top+r.height/2),d=dy*dy*4+dx*dx;if(d<bd){bd=d;best=i;}});
    return best;
  }
  /* The preview while a drag is over slot `to`: for the item at index `i` (not the dragged one), the translate to the slot it would take.
     `from` = the dragged item's index. Items outside the span stay (null). */
  function shiftFor(i,from,to,slots){
    if(from===to||i===from)return null;
    let t=-1;
    if(to>from&&i>from&&i<=to)t=i-1;
    else if(to<from&&i>=to&&i<from)t=i+1;
    if(t<0)return null;
    return {dx:slots[t].left-slots[i].left,dy:slots[t].top-slots[i].top};
  }
  const announce=(name,pos,n,where)=>`${name} moved to position ${pos} of ${n}${where?' in '+where:''}.`;

  /* ---- the pointer drag ---- */
  let live=null; // the drag in progress, or null
  const busy=()=>!!live;
  /* attach(host, kinds, hooks): `kinds` = [{kind, item:(target)=>el|null, group:(el)=>[el,...] (the items it can swap with, in shown order),
     key:(el)=>string, handle?:(target)=>boolean}]; `hooks.commit(kind, el, groupEls, fromIndex, toIndex)` is called once on a drop that changed
     the order; `hooks.end()` after every drag (drop or cancel); `hooks.disabled()` true = no drag now. A press that moves less than 6 px is a click. */
  function attach(host,kinds,hooks){
    let down=null, swallow=false;
    const me={}; // one drag at a time overall (`live`), but each attach owns only the drags it began: a second attach (the floors list) never ends the first one's
    const doc=host.ownerDocument||document;
    host.addEventListener('pointerdown',e=>{
      if(e.button!==0||!e.isPrimary||live||(hooks.disabled&&hooks.disabled()))return;
      const t=e.target;
      if(!t||!t.closest||t.closest('input,textarea,select,[contenteditable="true"]'))return;
      for(const k of kinds){
        const el=k.item(t);
        if(!el)continue;
        if(k.handle&&!k.handle(t))continue;
        down={k,el,x:e.clientX,y:e.clientY,id:e.pointerId};
        return;
      }
    });
    doc.addEventListener('pointermove',e=>{
      if(down&&!live){
        if(e.pointerId!==down.id)return;
        if((e.buttons&1)===0){down=null;return;}
        if(Math.hypot(e.clientX-down.x,e.clientY-down.y)<6)return;
        begin(down,e);down=null;
      }
      if(live&&live.me===me&&e.pointerId===live.id)move(e);
    });
    const finish=(e,drop)=>{
      if(down&&e.pointerId===down.id)down=null;
      if(!live||live.me!==me||e.pointerId!==live.id)return;
      swallow=true;setTimeout(()=>{swallow=false;},0);
      end(drop);
    };
    doc.addEventListener('pointerup',e=>finish(e,true));
    doc.addEventListener('pointercancel',e=>finish(e,false));
    doc.addEventListener('keydown',e=>{if(live&&live.me===me&&e.key==='Escape'){e.preventDefault();e.stopPropagation();end(false);}},true);
    doc.defaultView.addEventListener('blur',()=>{if(live&&live.me===me)end(false);});
    // a scroll or a wheel would move the cached slots: cancel instead of dropping somewhere unseen
    doc.addEventListener('wheel',()=>{if(live&&live.me===me)end(false);},{passive:true,capture:true});
    doc.addEventListener('scroll',e=>{if(live&&live.me===me&&(e.target===doc||(e.target.contains&&e.target.contains(host))))end(false);},{capture:true,passive:true});
    // the click that ends a drag must not open the desk or the tile that was dragged
    doc.addEventListener('click',e=>{if(swallow){e.stopPropagation();e.preventDefault();}},true);
    function begin(d,e){
      const els=d.k.group(d.el);
      const from=els.indexOf(d.el);
      if(from<0||els.length<2)return;
      const slots=els.map(x=>{const r=x.getBoundingClientRect();return {left:r.left,top:r.top,width:r.width,height:r.height};}); // the only layout read of the drag
      live={me,id:d.id,k:d.k,el:d.el,els,from,to:from,slots,x:d.x,y:d.y,last:null};
      try{host.setPointerCapture(d.id);}catch(_){}
      doc.body.classList.add('reo-dragging');
      d.el.classList.add('reo-lift');
      els.forEach(x=>{if(x!==d.el)x.classList.add('reo-slot');});
    }
    function move(e){
      const l=live;
      l.el.style.transform=`translate(${e.clientX-l.x}px,${e.clientY-l.y}px)`;
      const to=nearest(l.slots,e.clientX,e.clientY);
      if(to<0||to===l.to)return;
      l.to=to;
      l.els.forEach((x,i)=>{
        if(x===l.el)return;
        const s=shiftFor(i,l.from,to,l.slots);
        x.style.transform=s?`translate(${s.dx}px,${s.dy}px)`:'';
      });
    }
    function end(drop){
      const l=live;live=null;
      try{host.releasePointerCapture(l.id);}catch(_){}
      doc.body.classList.remove('reo-dragging');
      l.el.classList.remove('reo-lift');
      l.els.forEach(x=>{x.classList.remove('reo-slot');x.style.transform='';});
      if(drop&&l.to!==l.from&&hooks.commit)hooks.commit(l.k.kind,l.el,l.els,l.from,l.to);
      if(hooks.end)hooks.end();
    }
  }
  return {MAX_ROOMS,MAX_DESKS,MAX_PLACES,empty,sanitize,isEmpty,sortBy,moveTo,step,merge,nearest,shiftFor,announce,attach,busy};
})());
