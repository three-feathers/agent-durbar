/* Agent text on the office floor (spec 041 FR-065, issue #541): a desk, tooltip, inbox row or card line built from what an agent
   wrote is masked on the RAW text first (redact), then made plain (Markdown stripped), then cut. The order matters: making it plain
   removes `_`, `*` and backticks (so `ghp_...` would no longer match) and a cut inside a token leaves a half token no pattern knows.
   Fails closed: with no redact function the text is never shown (excerpt gives `fallback`, mask gives '').
   Pure: no DOM. In the page: window.DurbarSafeText; in Node (tests): module.exports. */
(function(root, api){
  if(typeof module==='object'&&module.exports) module.exports=api; else root.DurbarSafeText=api;
})(typeof self!=='undefined'?self:this, (function(){
  'use strict';
  const plain=t=>String(t==null?'':t).replace(/```[\s\S]*?```/g,' code ').replace(/!?\[([^\]]*)\]\([^)]*\)/g,'$1').replace(/^[#>\-*\s]+/gm,'').replace(/[*_`~]/g,'').replace(/\s+/g,' ').trim();
  /* o.redact(string) => string (src/shared/redact.ts), o.cut(string, n) => string (cuttext.js) */
  function create(o){
    const red=o&&typeof o.redact==='function'?o.redact:null, cut=o&&typeof o.cut==='function'?o.cut:null;
    /* the masked text, otherwise unchanged ('' for null; '' when there is no redact function) */
    const mask=t=>{if(t==null)return '';if(!red)return '';try{return String(red(String(t)));}catch(e){return '';}};
    /* masked, plain, at most n characters; `fallback` (default 'Finished.') when masking is not possible */
    const excerpt=(t,n,fallback)=>{const fb=fallback==null?'Finished.':fallback;if(t==null||t==='')return '';if(!red||!cut)return fb;
      try{return cut(plain(String(red(String(t)))),n);}catch(e){return fb;}};
    return {mask,excerpt,plain};
  }
  return {create,plain};
})());
