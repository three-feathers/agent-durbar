/* FROZEN REFERENCE (spec 012 FR-182, review of PR 1721, round 4): src/renderer/safetext.js as on main at 2de1d8a6e, before PR 1721; the one change is the path of
   cuttext.js (this copy lives in scripts/fixtures). scripts/test-redact-monotone.ts checks that the desk masks of this PR never show what this copy hides. Do not edit. */
/* Agent text on the office floor (spec 041 FR-065, issue #541): a desk, tooltip, inbox row, answer bar or card line built from what an
   agent wrote is masked BEFORE it is cut, and on the text with its Markdown removed but its `_` kept: excerpt = unescape, plainKeep, redact, drop
   `_`, cut; mask = redact the unescaped text, and when one of `* ` ~ [ ]` is present also redact the plain-kept text (shown if it found more).
   The order matters: dropping `_` first would break `ghp_...`, a cut inside a token leaves a half token no pattern knows, and a second pass over
   an earlier mask's output leaves the tail of a late-split token in clear (`[redacted]` glued to its tail).
   The single owner of `plain` and `excerpt`: liveact.js and app.js use these, they keep no copy.
   Fails closed: no redact function, a throwing one, a result that is not a string, or no shared hidden-character module (`unhide`, from
   src/shared/redact.ts) gives '' (the wrapper from `create` then shows a neutral word and says `ready: false`). Pure: no DOM. In the page: window.DurbarSafeText; in Node (tests): module.exports. */
(function(root, factory){
  const node=typeof module==='object'&&module.exports;
  /* the shared hidden-character definition (src/shared/redact.ts, compiled): the page's `exports` (redact.js loads first), or redact.js
     beside the renderer folder in the built tree. Never a .ts file. Tests of the source tree hand the compiled one in (`useShared`). */
  const shared=(()=>{try{return node?require('../shared/redact.js'):root.exports;}catch(e){return null;}})();
  const api=factory(node?require('../../src/renderer/cuttext.js'):root.DurbarCutText,shared);
  if(typeof module==='object'&&module.exports) module.exports=api; else root.DurbarSafeText=api;
})(typeof self!=='undefined'?self:this, function(CT,SHARED){
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
  /* spec 097 FR-030 (review of P2): what can sit invisibly inside a token and hide it from every shape. The masks read a copy without it;
     when they find nothing the text is shown as it was, so the joiners real scripts need stay. One definition, `HIDDEN_CHARS` and
     `unhide` in src/shared/redact.ts (spec 084 FR-033, review of PR 1236). Without it every mask here fails closed: `unhide` throws,
     the masks give null or '' (the wrapper shows its fallback word) and `create().ready` is false. */
  let SH=SHARED&&typeof SHARED.unhide==='function'?SHARED:null;
  const hasShared=()=>!!SH;
  /* the compiled shared module, once, only when none was found at load (tests of the source tree; in the page and the built tree it is
     always found, so nothing can replace it). True when it is used. */
  const useShared=m=>{if(SH||!m||typeof m.unhide!=='function')return false;SH=m;return true;};
  const unhide=t=>{if(!SH)throw new Error('no unhide');const c=SH.unhide(t);if(typeof c!=='string')throw new Error('no unhide');return c;};
  const unhid=(raw,run,bare,fail)=>{try{const s=String(raw==null?'':raw),c=unhide(s);if(c===s)return run(s);const m=run(c);return m===null||m===bare(c)?run(s):m;}catch(e){return fail;}};
  const maskPlain0=(raw,redact,codeWord)=>{try{
    const u=unesc(raw),m=both(u,plainKeep(u,codeWord),redact);
    return m.replace(/_/g,'');}catch(e){return null;}};
  const maskPlain=(raw,redact,codeWord)=>{if(typeof redact!=='function')return null;
    return unhid(raw,t=>maskPlain0(t,redact,codeWord),c=>plainKeep(unesc(c),codeWord).replace(/_/g,''),null);};
  /* the masked text, not made plain or cut: masked as it is, and again on the plain-kept text when Markdown that can split a token is
     present (otherwise the text is shown as it is). '' when masking is not possible. */
  const maskRaw=(raw,redact)=>{if(typeof redact!=='function')return '';return unhid(raw,t=>maskRaw0(t,redact),c=>unesc(c),'');};
  /* spec 012 FR-181 (review of PR 1585, round 6): a text with a backslash is masked as written first, then unescaped and masked again, so the tail glued to an escaped head
     (`ghp\_<body>@<rest>`) goes with it as in redact; a text without one is masked as before (byte for byte) */
  const maskRaw0=(raw,redact)=>{try{const r0=raw.indexOf('\\')<0?raw:redact(raw);if(typeof r0!=='string')return '';const u=unesc(r0),m1=redact(u);if(typeof m1!=='string')return '';
    if(!SPLIT.test(u))return m1; /* no Markdown that can split a token: one pass is enough (and keeps the live readout cheap) */
    const k=plainKeep(u),m2=both(u,k,redact);return m2!==k?m2:m1;}catch(e){return '';}}; /* m2 holds what either pass found (both) */
  /* raw agent text -> masked, plain, at most n characters (no n: not cut). '' when masking is not possible. */
  const excerpt=(raw,redact,n,codeWord)=>{const p=maskPlain(String(raw==null?'':raw),redact,codeWord);if(p===null)return '';return n==null?p:cutter(p,n);};
  /* a tool label masked the way the live readout (LIVEACT) masks it: a command by maskSecretCommand, a URL by maskSecretUrl, anything else by redact.
     mask = {redact, cmd, url}. A missing function for the kind that is needed gives '' (fail closed). */
  const isUrl=s=>/^[a-z][a-z0-9+.-]{1,20}:\/\//i.test(s);
  /* spec 012 FR-180: a Markdown escape inside a token (`ghp\_...`) hides it from a mask that reads the label as written, while the desk mask
     (maskRaw) undoes the escapes first. The label stays as written (undoing them would change a command: `\>` is not `>`), so both forms are
     masked: each run of token characters holding an escape whose unescaped form the mask changes in any way becomes `[redacted]` BEFORE
     the mask reads the label (after it, a glued token the mask half hid as written no longer matches the run), and then the mask must leave
     the unescaped copy of the result exactly as it is, or the label is '' (fail closed). "Hides" is any change, never a count of markers:
     the mask can hide by stretching a `[redacted]` already there (`password=[redacted]_<rest>`). A mask that gives no string, '' or
     `[redaction failed]` on any copy: ''. On a label longer than ESC_FULL (the permission card's own cut) at most
     ESC_RUNS distinct escaped runs are looked at (one mask call each), more: '' (`phrase` and the desk tool labels pass it uncut); a shorter
     label, so every permission card, has every run checked. A label without an escape is masked as before. */
  const ERUN=/(?:[A-Za-z0-9_\-.+\/=:@%]|\\[\\`*_{}\[\]()#+\-.!~|<>A-Za-z0-9=:@%\/])+/g; /* spec 012 FR-181 (review of PR 1585, round 4): a backslash before a token character joins a run too (`\n` of a JSON line break, `\h` of a shell escape), as in the shared step, so a run is judged whole by the mask */
  const ESC_RUNS=64,ESC_FULL=10000;
  const escMask=(s,mk)=>{if(unesc(s)===s)return mk(s);const capped=s.length>ESC_FULL;
    const got=t=>{const r=mk(t);if(typeof r!=='string'||!r||/\[redaction failed\]/.test(r))throw new Error('mask');return r;};
    const hit=new Set(),seen=new Set();
    for(const m of s.matchAll(ERUN)){const r=m[0];if(r.indexOf('\\')<0||seen.has(r))continue;
      seen.add(r);if(capped&&seen.size>ESC_RUNS)return '';const u=unesc(r);if(got(u)!==u)hit.add(r);}
    const o=got(hit.size?s.replace(ERUN,r=>hit.has(r)?'[redacted]':r):s); /* one pass: each run is replaced where it stands, so no order is needed */
    const u=unesc(o);return got(u)===u?o:'';};
  const maskLabel=(raw,kind,mask)=>{const s=String(raw==null?'':raw).trim();if(!s)return '';const m=mask||{};
    const f=kind==='run'?m.cmd:isUrl(s)?m.url:m.redact;if(typeof f!=='function')return '';
    try{const one=t=>{const r=f(t);return typeof r==='string'?r:'';};return escMask(s,t=>unhid(t,one,c=>c,''));}catch(e){return '';}};
  /* the wrapper the page uses: fallback words and the "is masking possible" flag */
  function create(o){
    const red=o&&typeof o.redact==='function'?o.redact:null, cut=o&&typeof o.cut==='function'?o.cut:cutter;
    /* the masked text, not made plain or cut ('' for null, and when masking is not possible). Markdown is not stripped (the text is shown as
       it is), but a token that only shows once it is stripped is masked too. */
    const mask=t=>t==null?'':maskRaw(String(t),red);
    /* masked, plain, at most n characters (no n: not cut); `fallback` (default 'Finished.') when there is text but masking is not possible */
    const ex=(t,n,fallback)=>{if(t==null||t==='')return '';const fb=fallback==null?'Finished.':fallback;if(!red)return fb;
      const p=maskPlain(String(t),red,true);if(p===null)return fb;return n==null?p:cut(p,n);};
    return {mask,excerpt:ex,plain,get ready(){return !!red&&hasShared();}};
  }
  return {create,plain,plainKeep,unesc,unhide,maskRaw,excerpt,maskLabel,useShared};
});
