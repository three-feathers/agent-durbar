/* Agent text on the office floor (spec 041 FR-065, issue #541): a desk, tooltip, inbox row, answer bar or card line built from what an
   agent wrote is masked BEFORE it is cut, and on the text with its Markdown removed but its `_` kept: excerpt = unescape, plainKeep, redact, drop
   `_`, cut; mask = redact the unescaped text, and when one of `* ` ~ [ ]` is present also redact the plain-kept text (shown if it found more).
   The order matters: dropping `_` first would break `ghp_...`, a cut inside a token leaves a half token no pattern knows, and a second pass over
   an earlier mask's output leaves the tail of a late-split token in clear (`[redacted]` glued to its tail).
   The single owner of `plain` and `excerpt`: liveact.js and app.js use these, they keep no copy.
   Fails closed: no redact function, a throwing one, or a result that is not a string gives '' (the wrapper from `create` then shows a
   neutral word). Pure: no DOM. In the page: window.DurbarSafeText; in Node (tests): module.exports. */
(function(root, factory){
  const api=factory(typeof module==='object'&&module.exports?require('./cuttext.js'):root.DurbarCutText);
  if(typeof module==='object'&&module.exports) module.exports=api; else root.DurbarSafeText=api;
})(typeof self!=='undefined'?self:this, function(CT){
  'use strict';
  /* Markdown escapes undone before the first mask: `ghp\_...` must read as a token (the backslash would break the pattern) */
  const unesc=t=>String(t==null?'':t).replace(/\\([\\`*_{}\[\]()#+\-.!~|<>])/g,'$1');
  /* Markdown to plain words but KEEPING `_`: code blocks (also one never closed), links, emphasis, headings and list marks (- * + >) go;
     whitespace collapses. `codeWord`: a code block leaves the word "code" (the desk line), otherwise a space (the live readout). */
  const plainKeep=(t,codeWord)=>String(t==null?'':t).replace(/```[\s\S]*?(```|$)/g,codeWord?' code ':' ').replace(/!?\[([^\]]*)\]\([^)]*\)/g,'$1').replace(/^[#>\-*+\s]+/gm,'').replace(/[*`~]/g,'').replace(/\s+/g,' ').trim();
  /* ... and the plain words (also without `_`) */
  const plain=(t,codeWord)=>plainKeep(t,codeWord).replace(/_/g,'');
  const SPLIT=/[*`~\[\]]/; /* Markdown marks that can sit inside a token (emphasis, code, strike, link brackets) */
  const cutter=(s,n)=>CT&&typeof CT.cutText==='function'?CT.cutText(s,n):s;
  /* Make plain (keeping `_`), THEN mask, then drop `_`: a token split by Markdown (`gh`+backtick+`p_...`, `ghp_<20 chars>**K1l2...**`) only shows
     its shape once the Markdown is gone, and `_` must still be there for the pattern. The mask always reads the unescaped raw text made plain,
     never the output of an earlier mask (a half-masked token joined with its tail matches nothing): the token's own characters are never
     removed by plainKeep. null when masking is not possible. */
  /* Both passes, combined (review of PR #614, issue #608): removing Markdown can also GLUE a token to the word before it (`x**ghp_...**`
     gives `xghp_...`, and no token shape starts after a letter), so the pass on the plain-kept text `k` alone misses it, and taking one pass's
     output instead of the other lost what the other found. So: mask `k`, then also mask in that output every token-like run of the raw text
     `u` that the mask changes on its own (marks are not run characters, so a run is the token as written between them), together with the
     token characters glued after it (a late split: `x**ghp_<20>**K1l2...` gives `x[redacted]`). Anything either pass finds is masked.
     Only needed when a mark that can split or glue is present. Throws when redact gives no string (the callers fail closed). */
  const RUN=/[A-Za-z0-9_\-.+\/=:@%]{12,}/g; /* no Markdown mark (`~` either): a run is what stands between them */
  const reEsc=t=>t.replace(/[.*+?^${}()|[\]\\\/]/g,'\\$&');
  const both=(u,k,redact)=>{let m=redact(k);if(typeof m!=='string')throw new Error('mask');if(!SPLIT.test(u))return m;
    const seen=new Set(),found=[];for(const r of u.match(RUN)||[]){if(seen.has(r))continue;seen.add(r);const x=redact(r);if(typeof x!=='string')throw new Error('mask');if(x!==r)found.push(r);}
    found.sort((a,b)=>b.length-a.length);
    for(const r of found)m=m.replace(new RegExp(reEsc(r)+'[A-Za-z0-9_-]*','g'),()=>'[redacted]');
    return m;};
  /* spec 097 FR-030 (review of P2): what can sit invisibly inside a token and hide it from every shape: default-ignorable characters (soft hyphen, zero-width,
     bidi marks, joiners, tag characters), line separators and control characters. The masks read a copy without them; when they find nothing the text is
     shown as it was, so the joiners real scripts need stay. */
  const HIDDEN=/\p{Default_Ignorable_Code_Point}|[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u2028\u2029]/gu;
  const unhide=t=>String(t==null?'':t).replace(HIDDEN,'');
  const unhid=(raw,run,bare)=>{const s=String(raw==null?'':raw),c=unhide(s);if(c===s)return run(s);const m=run(c);return m===null||m===bare(c)?run(s):m;};
  const maskPlain0=(raw,redact,codeWord)=>{try{
    const u=unesc(raw),m=both(u,plainKeep(u,codeWord),redact);
    return m.replace(/_/g,'');}catch(e){return null;}};
  const maskPlain=(raw,redact,codeWord)=>{if(typeof redact!=='function')return null;
    return unhid(raw,t=>maskPlain0(t,redact,codeWord),c=>plainKeep(unesc(c),codeWord).replace(/_/g,''));};
  /* the masked text, not made plain or cut: masked as it is, and again on the plain-kept text when Markdown that can split a token is
     present (otherwise the text is shown as it is). '' when masking is not possible. */
  const maskRaw=(raw,redact)=>{if(typeof redact!=='function')return '';return unhid(raw,t=>maskRaw0(t,redact),c=>unesc(c));};
  const maskRaw0=(raw,redact)=>{try{const u=unesc(raw),m1=redact(u);if(typeof m1!=='string')return '';
    if(!SPLIT.test(u))return m1; /* no Markdown that can split a token: one pass is enough (and keeps the live readout cheap) */
    const k=plainKeep(u),m2=both(u,k,redact);return m2!==k?m2:m1;}catch(e){return '';}}; /* m2 holds what either pass found (both) */
  /* raw agent text -> masked, plain, at most n characters (no n: not cut). '' when masking is not possible. */
  const excerpt=(raw,redact,n,codeWord)=>{const p=maskPlain(String(raw==null?'':raw),redact,codeWord);if(p===null)return '';return n==null?p:cutter(p,n);};
  /* a tool label masked the way the live readout (LIVEACT) masks it: a command by maskSecretCommand, a URL by maskSecretUrl, anything else by redact.
     mask = {redact, cmd, url}. A missing function for the kind that is needed gives '' (fail closed). */
  const isUrl=s=>/^[a-z][a-z0-9+.-]{1,20}:\/\//i.test(s);
  const maskLabel=(raw,kind,mask)=>{const s=String(raw==null?'':raw).trim();if(!s)return '';const m=mask||{};
    const f=kind==='run'?m.cmd:isUrl(s)?m.url:m.redact;if(typeof f!=='function')return '';
    try{const one=t=>{const r=f(t);return typeof r==='string'?r:'';};return unhid(s,one,c=>c);}catch(e){return '';}};
  /* the wrapper the page uses: fallback words and the "is masking possible" flag */
  function create(o){
    const red=o&&typeof o.redact==='function'?o.redact:null, cut=o&&typeof o.cut==='function'?o.cut:cutter;
    /* the masked text, not made plain or cut ('' for null, and when masking is not possible). Markdown is not stripped (the text is shown as
       it is), but a token that only shows once it is stripped is masked too. */
    const mask=t=>t==null?'':maskRaw(String(t),red);
    /* masked, plain, at most n characters (no n: not cut); `fallback` (default 'Finished.') when there is text but masking is not possible */
    const ex=(t,n,fallback)=>{if(t==null||t==='')return '';const fb=fallback==null?'Finished.':fallback;if(!red)return fb;
      const p=maskPlain(String(t),red,true);if(p===null)return fb;return n==null?p:cut(p,n);};
    return {mask,excerpt:ex,plain,ready:!!red};
  }
  return {create,plain,plainKeep,unesc,unhide,maskRaw,excerpt,maskLabel};
});
