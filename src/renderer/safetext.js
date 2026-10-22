/* Agent text on the office floor (spec 041 FR-065, issue #541): a desk, tooltip, inbox row, answer bar or card line built from what an
   agent wrote is masked on the RAW text first (redact), then made plain (Markdown stripped), then cut. The order matters: making it plain
   removes `_`, `*` and backticks (so `ghp_...` would no longer match) and a cut inside a token leaves a half token no pattern knows.
   The single owner of `plain` and `excerpt`: liveact.js and app.js use these, they keep no copy.
   Fails closed: no redact function, a throwing one, or a result that is not a string gives '' (the wrapper from `create` then shows a
   neutral word). Pure: no DOM. In the page: window.DurbarSafeText; in Node (tests): module.exports. */
(function(root, factory){
  const api=factory(typeof module==='object'&&module.exports?require('./cuttext.js'):root.DurbarCutText);
  if(typeof module==='object'&&module.exports) module.exports=api; else root.DurbarSafeText=api;
})(typeof self!=='undefined'?self:this, function(CT){
  'use strict';
  /* Markdown to plain words: code blocks (also one never closed), links, emphasis, headings and list marks (- * + >) go; whitespace
     collapses. `codeWord`: a code block leaves the word "code" (the desk line), otherwise a space (the live readout). */
  const plain=(t,codeWord)=>String(t==null?'':t).replace(/```[\s\S]*?(```|$)/g,codeWord?' code ':' ').replace(/!?\[([^\]]*)\]\([^)]*\)/g,'$1').replace(/^[#>\-*+\s]+/gm,'').replace(/[*_`~]/g,'').replace(/\s+/g,' ').trim();
  const cutter=(s,n)=>CT&&typeof CT.cutText==='function'?CT.cutText(s,n):s;
  /* raw agent text -> masked, plain, at most n characters (no n: not cut). '' when masking is not possible. */
  const excerpt=(raw,redact,n,codeWord)=>{if(typeof redact!=='function')return '';let m;try{m=redact(String(raw==null?'':raw));}catch(e){return '';}
    if(typeof m!=='string')return '';const p=plain(m,codeWord);return n==null?p:cutter(p,n);};
  /* a tool label masked like the chat chip: a command by maskSecretCommand, a URL by maskSecretUrl, anything else by redact.
     mask = {redact, cmd, url}. A missing function for the kind that is needed gives '' (fail closed). */
  const isUrl=s=>/^[a-z][a-z0-9+.-]{1,20}:\/\//i.test(s);
  const maskLabel=(raw,kind,mask)=>{const s=String(raw==null?'':raw).trim();if(!s)return '';const m=mask||{};
    const f=kind==='run'?m.cmd:isUrl(s)?m.url:m.redact;if(typeof f!=='function')return '';
    try{const r=f(s);return typeof r==='string'?r:'';}catch(e){return '';}};
  /* the wrapper the page uses: fallback words and the "is masking possible" flag */
  function create(o){
    const red=o&&typeof o.redact==='function'?o.redact:null, cut=o&&typeof o.cut==='function'?o.cut:cutter;
    /* the masked raw text, not made plain or cut ('' for null, and when masking is not possible) */
    const mask=t=>{if(t==null||!red)return '';try{const r=red(String(t));return typeof r==='string'?r:'';}catch(e){return '';}};
    /* masked, plain, at most n characters; `fallback` (default 'Finished.') when there is text but masking is not possible */
    const ex=(t,n,fallback)=>{if(t==null||t==='')return '';const fb=fallback==null?'Finished.':fallback;if(!red)return fb;
      let m;try{m=red(String(t));}catch(e){return fb;}if(typeof m!=='string')return fb;return cut(plain(m,true),n);};
    return {mask,excerpt:ex,plain,ready:!!red};
  }
  return {create,plain,excerpt,maskLabel};
});
