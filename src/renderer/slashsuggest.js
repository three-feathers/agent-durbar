/* The composer's "/" list (spec 073 FR-008), pure helpers: which word the caret is in, which entries match (with the palette's
   shared matcher, DurbarNav.rank in navigator.js), a row's HTML (every field escaped), what a row shows (masked, `view`, `tip`), and the text after picking one. No DOM.
   In the page: window.DurbarSlash; in Node (test-slashcommands): module.exports. app.js places the list and handles the keys. */
(function(root, api){
  if(typeof module==='object'&&module.exports) module.exports=api; else root.DurbarSlash=api;
})(typeof self!=='undefined'?self:this, (function(){
  'use strict';
  const NAME_CHARS=/^[A-Za-z0-9._:-]*$/;
  /* The "/" word that ends at the caret: { start (index of "/"), query (typed after it) }, or null.
     Only at the start of the box or after a space or new line (never inside a word or a URL), and only with the caret at its end. */
  function tokenAt(value,caret){
    const v=String(value==null?'':value), c=Math.max(0,Math.min(Number(caret)||0,v.length));
    if(c<v.length&&!/\s/.test(v[c]))return null;
    let s=c; while(s>0&&!/\s/.test(v[s-1]))s--;
    if(v[s]!=='/')return null;
    const q=v.slice(s+1,c);
    if(!NAME_CHARS.test(q)||q.length>64)return null;
    return {start:s,query:q};
  }
  const RANK={folder:0,user:1,app:2,note:3};
  /* the palette's matcher (spec 074, navigator.js), looked up when used: in the page navigator.js loads after this file */
  function nav(){
    const g=typeof globalThis!=='undefined'?globalThis:typeof self!=='undefined'?self:{};
    if(g.DurbarNav&&typeof g.DurbarNav.rank==='function')return g.DurbarNav;
    if(typeof require==='function')return require('./navigator.js');
    throw new Error('navigator.js is not loaded');
  }
  /* The entries that match `query`, ranked like Ctrl+K and Go to (DurbarNav.rank: the name starts with it, a word of the name does,
     the name contains it, the description does); the order folder, user, app is kept inside each step. An empty query keeps all. */
  function filter(entries,query){
    const list=Array.isArray(entries)?entries.filter(e=>e&&typeof e.name==='string'):[];
    const sorted=list.map((e,i)=>({e,i})).sort((a,b)=>(RANK[a.e.source]??3)-(RANK[b.e.source]??3)||a.i-b.i).map(x=>x.e);
    return nav().rank(sorted.map(e=>({label:e.name,kw:e.description||'',e})),String(query||'')).map(x=>x.e);
  }
  /* The box's text after picking `name` for the word from `start` to `end`: "/name " in its place; no second space before text that
     already starts with one. Returns { value, caret } with the caret after the space. */
  function insert(value,start,end,name){
    const v=String(value==null?'':value), rest=v.slice(end), word='/'+name;
    const sep=/^\s/.test(rest)?'':' ';
    const out=v.slice(0,start)+word+sep+rest;
    return {value:out,caret:start+word.length+(sep?1:/^\s/.test(rest)?1:0)};
  }
  /* Spec 083 FR-030 (spec 073 FR-066/FR-067): the list of a chat = the commands that match, then the notes that match (same ranking),
     then "All notes…". Nothing typed after "/": at most `max` notes. `notes` are entries with source 'note' and an `insertText`;
     `all` is the "All notes…" entry (kind 'more'), offered only when nothing is typed. Returns { commands, notes, items }. */
  function withNotes(commands,notes,query,max,all){
    const q=String(query||''), cmds=filter(commands,q);
    const list=(Array.isArray(notes)?notes:[]).filter(e=>e&&e.source==='note');
    const ranked=q?nav().rank(list.map(e=>({label:e.name,kw:e.description||'',e})),q).map(x=>x.e):list;
    const shown=q?ranked:ranked.slice(0,Number(max)>0?Number(max):5);
    const more=!q&&list.length&&all?[all]:[];
    return {commands:cmds,notes:shown,items:cmds.concat(shown,more)};
  }
  const SOURCE_WORD={folder:'folder',user:'user',app:'app'};
  const KIND_WORD={skill:'skill',command:'command',prompt:'prompt',builtin:'built-in'};
  const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  /* One option row of the list (FR-008). Every field comes from a file's front matter or the app, so each is escaped here (the XSS
     guard; test-slashcommands checks it with a hostile entry). `tip` is the row's full text for its title. */
  const NOTE_SVG='<svg class="sl-ico" viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 2.5h9v11h-9zM6 5.5h4M6 8h4M6 10.5h2.5"/></svg>';
  const SCOPE_WORD={session:'this session',folder:'this folder',file:'project file'};
  function optionHtml(x,i,active,tip){
    const n=Number(i)|0;
    if(x.source==='note'){ /* spec 083: a note row has an icon and its title, no slash; every field is escaped here too */
      const more=x.kind==='more';
      return `<div class="sl-opt sl-note" role="option" id="slashOpt-${n}" data-i="${n}" aria-selected="${!!active}" title="${esc(tip||'')}"><span class="sl-line">${NOTE_SVG}<b class="sl-name">${esc(more?'All notes…':x.name)}</b>${more?'':`<span class="sl-src sl-note-src">note · ${esc(SCOPE_WORD[x.scope]||x.scope||'this folder')}</span>`}</span>${!more&&x.description?`<span class="sl-desc">${esc(x.description)}</span>`:''}</div>`;
    }
    return `<div class="sl-opt" role="option" id="slashOpt-${n}" data-i="${n}" aria-selected="${!!active}" title="${esc(tip||'')}"><span class="sl-line"><b class="sl-name">/${esc(x.name)}</b>${x.argumentHint?`<span class="sl-hint">${esc(x.argumentHint)}</span>`:''}<span class="sl-src sl-${esc(x.source)}">${esc(SOURCE_WORD[x.source]||x.source)} · ${esc(KIND_WORD[x.kind]||x.kind)}</span></span>${x.description?`<span class="sl-desc">${esc(x.description)}</span>`:''}</div>`;
  }
  /* FR-013 (issue #608): what the list SHOWS of an entry, masked. `mask` is the page's DurbarSafeText mask (spec 041 FR-065; app.js
     passes SAFE.mask): token shapes hidden, also one split by Markdown, the text otherwise as written (not `excerpt`, which drops `_`
     and would change `release_notes`). No mask function, or one that gives '' (no redact module): the field is empty, never the raw
     text (fail closed). The real entry keeps its name: picking inserts and sends that one. */
  function view(x,mask){
    const m=t=>{if(t==null||t==='')return '';if(typeof mask!=='function')return '';try{const r=mask(String(t));return typeof r==='string'?r:'';}catch(e){return '';}};
    return {name:m(x.name),description:m(x.description),argumentHint:m(x.argumentHint),where:m(x.where),source:x.source,kind:x.kind,scope:x.scope};
  }
  /* The row's tooltip (FR-008): the full name, the description and the place, each MASKED first (view), then joined and cut to 300 by
     `cut` (DurbarCutText.cutText): a cut inside a token would leave a half token that no pattern knows. */
  function tip(x,mask,cut){
    const v=view(x,mask);
    if(x.source==='note'){const tt=x.kind==='more'?'All notes of this folder':[v.name,v.description,'Note · '+(SCOPE_WORD[x.scope]||'this folder')].filter(Boolean).join('\n');return typeof cut==='function'?cut(tt,300):tt.slice(0,300);}
    const place=x.source==='app'?'Built-in command of the agent app':v.where?'Sends the text of '+v.where:'';
    const t=['/'+v.name,v.description,place].filter(Boolean).join('\n');
    return typeof cut==='function'?cut(t,300):t.slice(0,300);
  }
  return {tokenAt,filter,withNotes,insert,optionHtml,view,tip,SOURCE_WORD,KIND_WORD};
})());
