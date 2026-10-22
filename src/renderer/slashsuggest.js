/* The composer's "/" list (spec 072 FR-008), pure helpers: which word the caret is in, which entries match, and the text after
   picking one. No DOM. In the page: window.DurbarSlash; in Node (test-slashcommands): module.exports. app.js draws the list. */
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
  /* The entries that match `query`: names that start with it first, then names that contain it; the given order (folder, user, app)
     is kept inside each part. An empty query keeps every entry. */
  function filter(entries,query){
    const list=Array.isArray(entries)?entries.filter(e=>e&&typeof e.name==='string'):[];
    const q=String(query||'').toLowerCase();
    const sorted=list.map((e,i)=>({e,i})).sort((a,b)=>(RANK[a.e.source]??3)-(RANK[b.e.source]??3)||a.i-b.i).map(x=>x.e);
    if(!q)return sorted;
    const pre=[],mid=[];
    for(const e of sorted){const n=e.name.toLowerCase();if(n.startsWith(q))pre.push(e);else if(n.includes(q))mid.push(e);}
    return pre.concat(mid);
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
  return {tokenAt,filter,insert,SOURCE_WORD,KIND_WORD};
})());
