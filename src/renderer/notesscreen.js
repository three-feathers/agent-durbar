/* The per-folder Notes screen (spec 083 FR-044, FR-045, T034a), pure helpers: the screen's two groups (notes not done, then the
   folded Done group), its search (the drawer's rule, DurbarNotes.search, over both groups), the folder menu's label, which chat of the
   folder the screen talks to main through (main finds the folder from an agent id, FR-062: the window never sends a path) and where
   the focus goes after a row leaves the list. No DOM, no bridge call: app.js draws and talks to main; screens.js gives the frame.
   In the page: window.DurbarNotesScreen; in Node (test-notesscreen): module.exports. */
(function(root, api){
  if(typeof module==='object'&&module.exports) module.exports=api; else root.DurbarNotesScreen=api;
})(typeof self!=='undefined'?self:this, (function(){
  'use strict';
  const valid=n=>!!n&&typeof n==='object'&&typeof n.id==='string'&&n.id!=='';
  /* newest first, ties by id (the drawer's order, FR-021) */
  const newest=(a,b)=>(a.createdAt<b.createdAt?1:a.createdAt>b.createdAt?-1:a.id<b.id?1:a.id>b.id?-1:0);

  /* FR-044/FR-045: every note of the folder, not done ones first, then the done ones; each newest first. No session split: the screen
     is the folder's. */
  function groups(notes){
    const open=[],done=[];
    for(const n of Array.isArray(notes)?notes:[])if(valid(n))(n.done===true?done:open).push(n);
    return {open:open.sort(newest),done:done.sort(newest)};
  }
  /* FR-043 on the screen: the drawer's search (`search` is DurbarNotes.search, `rank` DurbarNav.rank, `mask` the masking function) run
     over both groups; an empty query keeps everything. A missing search function matches nothing (fail closed). */
  function filter(g,query,search,rank,mask){
    const q=String(query==null?'':query).trim();
    if(!q)return g;
    if(typeof search!=='function')return {open:[],done:[]};
    let r=null;try{r=search({session:g.open,folder:g.done},q,rank,mask);}catch(e){r=null;}
    return r&&Array.isArray(r.session)&&Array.isArray(r.folder)?{open:r.session,done:r.folder}:{open:[],done:[]};
  }
  /* the folder `⋯` item (D10): "Notes (N)…" with N the notes not done; "Notes…" while the count is not known yet */
  function menuLabel(n){return typeof n==='number'&&Number.isFinite(n)&&n>=0?'Notes ('+Math.floor(n)+')…':'Notes…';}
  const doneLabel=n=>'Done ('+(Number(n)||0)+')';
  const EMPTY='No notes in this folder yet. Save a message with its ⋯ menu, or add one.';
  /* the chat the screen reads the folder's notes through: the open chat when it is a main chat of this folder (then Insert can put a
     note into its message box), else the folder's first main chat; `ok(agent)` says whether notes work for it (live, not a helper).
     Returns {id, over} or null when the folder has no such chat. */
  function pickAgent(list,roomId,selectedId,panelOpen,ok){
    const can=a=>!!a&&!a.parent&&a.room===roomId&&(typeof ok!=='function'||ok(a)===true);
    const all=Array.isArray(list)?list:[];
    const sel=panelOpen&&selectedId?all.find(a=>a&&a.id===selectedId):null;
    if(can(sel))return {id:sel.id,over:true};
    const first=all.find(can);
    return first?{id:first.id,over:false}:null;
  }
  /* FR-014's rule for a row that leaves the list (deleted, marked done or not done): the next row, else the previous, else '' */
  function neighbours(ids,id){
    const l=Array.isArray(ids)?ids:[], i=l.indexOf(id);
    if(i<0)return {next:'',prev:''};
    return {next:l[i+1]||'',prev:l[i-1]||''};
  }
  return {groups,filter,menuLabel,doneLabel,EMPTY,pickAgent,neighbours};
})());
