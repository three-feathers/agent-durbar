/* The composer's "/" list (spec 073 FR-008), pure helpers: which word the caret is in, which entries match (with the palette's
   shared matcher, DurbarNav.rank in navigator.js), a row's HTML (every field escaped), and the text after picking one. No DOM.
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
  const RANK={folder:0,user:1,app:2};
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
  const SOURCE_WORD={folder:'folder',user:'user',app:'app'};
  const KIND_WORD={skill:'skill',command:'command',prompt:'prompt',builtin:'built-in'};
  const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  /* One option row of the list (FR-008). Every field comes from a file's front matter or the app, so each is escaped here (the XSS
     guard; test-slashcommands checks it with a hostile entry). `tip` is the row's full text for its title. */
  function optionHtml(x,i,active,tip){
    const n=Number(i)|0;
    return `<div class="sl-opt" role="option" id="slashOpt-${n}" data-i="${n}" aria-selected="${!!active}" title="${esc(tip||'')}"><span class="sl-line"><b class="sl-name">/${esc(x.name)}</b>${x.argumentHint?`<span class="sl-hint">${esc(x.argumentHint)}</span>`:''}<span class="sl-src sl-${esc(x.source)}">${esc(SOURCE_WORD[x.source]||x.source)} · ${esc(KIND_WORD[x.kind]||x.kind)}</span></span>${x.description?`<span class="sl-desc">${esc(x.description)}</span>`:''}</div>`;
  }
  return {tokenAt,filter,insert,optionHtml,SOURCE_WORD,KIND_WORD};
})());
