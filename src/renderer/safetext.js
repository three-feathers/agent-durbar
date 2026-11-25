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
  const api=factory(node?require('./cuttext.js'):root.DurbarCutText,shared);
  if(typeof module==='object'&&module.exports) module.exports=api; else root.DurbarSafeText=api;
})(typeof self!=='undefined'?self:this, function(CT,SHARED){
  'use strict';
  /* Markdown escapes undone before the first mask: `ghp\_...` must read as a token (the backslash would break the pattern) */
  /* spec 012 FR-470 (issue #2113): `\\` is a Markdown escape, but a doubled backslash that starts a word and has a letter, a digit, `$`, `.`, `?` or a non-ASCII character after it (so no third backslash and no `_` or `*` mark) is the lead
     of a Windows network path: it stays doubled, or every surface that reads through here (helper cards, desk readout, monitor) shows `\\srv\share` as `\srv\share` */
  const unesc=t=>String(t==null?'':t).replace(/(?<![^\s"'`(\[<=:,;|>])\\\\(?=[A-Za-z0-9$.?]|[^\x00-\x7f])|\\([\\`*_{}\[\]()#+\-.!~|<>])/g,(m,c)=>c===undefined?m:c);
  /* Markdown links `[text](target)` (an image `![text](target)` too) become their text, exactly as `/!?\[([^\]]*)\]\([^)]*\)/g` replaces them, in one scan: from a `[`, the next
     `]` must be followed by `(` and a later `)`; when it is not, no `[` before that `]` can start a link either, so the scan goes on after it; with no `)` left none can */
  const stripLinks=t=>{let out='',from=0,i=t.indexOf('[');while(i>=0){const j=t.indexOf(']',i+1);if(j<0)break;if(t[j+1]!=='('){i=t.indexOf('[',j+1);continue;}
    const k=t.indexOf(')',j+2);if(k<0)break;const st=i>0&&t[i-1]==='!'&&i-1>=from?i-1:i;out+=t.slice(from,st)+t.slice(i+1,j);from=k+1;i=t.indexOf('[',from);}
    return from===0?t:out+t.slice(from);};
  /* Markdown to plain words but KEEPING `_`: code blocks (also one never closed), links, emphasis, headings and list marks (- * + >) go;
     whitespace collapses. `codeWord`: a code block leaves the word "code" (the desk line), otherwise a space (the live readout). */
  const plainKeep=(t,codeWord)=>stripLinks(String(t==null?'':t).replace(/```[\s\S]*?(```|$)/g,codeWord?' code ':' ')).replace(/^[#>\-*+\s]+/gm,'').replace(/[*`~]/g,'').replace(/\s+/g,' ').trim();
  /* issue #1725 (review of PR 1721, rounds 3 and 5): links are made plain by a scan (stripLinks), not by the regex `!?\[([^\]]*)\]\([^)]*\)` that rescanned to the end of the
     text from every `[` (quadratic: seconds per desk call on an 80k reply); the same links as that regex, of any length (round 3 bounded them, and a long link kept its
     marks where main removed them, so a token glued after it was no token: round 5) */
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
  /* spec 012 FR-183: the second pass reads the whole output once per run found, so its work is (runs x length, a proxy for the scan work); over BOTH_WORK (equal to MARKDOWN_WORK of src/shared/redact.ts) it fails closed (OVER: maskRaw
     gives '', the excerpt nothing, and the copy with hidden characters is not read in its place). Under it, nothing changes. A text of 16,384 characters (the
     split-aware window) holds at most 1,260 runs of 12 or more, so it stays under unless the mask's output is over three times its length. */
  const BOTH_WORK=1<<26,OVER=new Error('mask budget');
  const both=(u,k,redact)=>{let m=redact(k);if(typeof m!=='string')throw new Error('mask');if(!SPLIT.test(u))return m;
    const seen=new Set(),found=[];for(const r of u.match(RUN)||[]){if(seen.has(r))continue;seen.add(r);const x=redact(r);if(typeof x!=='string')throw new Error('mask');if(x!==r){found.push(r);if(found.length*m.length>BOTH_WORK)throw OVER;}} /* checked as each run is found (round 2 of the review of PR 1816) */
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
  /* spec 012 FR-185 (issue #1329): the shared GitHub last pass (`maskLoose`) runs once, over a finished desk output, never inside its readings (`withoutLoose`):
     a head it hides inside a reading can leave a later reading without the token it needed. Without the shared module both are no-ops. */
  const noLoose=f=>SH&&typeof SH.withoutLoose==='function'?SH.withoutLoose(f):f();
  const looseText=t=>SH&&typeof SH.maskLoose==='function'&&typeof t==='string'?SH.maskLoose(t):t;
  const lz=f=>looseText(noLoose(f));
  let looseHits=0;
  const looseNow=t=>{const x=SH&&typeof SH.maskLoose==='function'&&typeof t==='string'?SH.maskLoose(t,undefined,true,true):t;if(x!==t)looseHits++;return x;};
  /* the excerpt runs the pass inside its readings, before it drops `_` (which the pass needs), so it is not monotone by construction: when the pass changed
     anything, the reading with it fully off is made too and every piece it does not show is masked (`keep`, FR-182's rule), so nothing it hides shows */
  const plainLz=f=>{const n0=looseHits,h=lz(f);if(looseHits===n0||h===null||h===''||!SH||typeof SH.withoutLooseAll!=='function')return h;
    /* a `[redacted:` the text itself holds reads as a mask to `keep` (its pieces are cut at masks), so that text fails closed */
    try{const r=SH.withoutLooseAll(f);return r===null||r===''?r:h===r?h:h.includes('[redacted:')?null:keep(h,r);}catch(e){return null;}};
  const useShared=m=>{if(SH||!m||typeof m.unhide!=='function')return false;SH=m;return true;};
  const unhide=t=>{if(!SH)throw new Error('no unhide');const c=SH.unhide(t);if(typeof c!=='string')throw new Error('no unhide');return c;};
  const unhid=(raw,run,bare,fail)=>{try{const s=String(raw==null?'':raw),c=unhide(s);if(c===s)return run(s);const m=run(c);return m===null||m===bare(c)?run(s):m;}catch(e){return fail;}};
  /* spec 012 FR-182 (review of PR 1721, rounds 3 and 4): the reading of this PR keeps both: the text masked as written first, then the copy of THAT output without
     hidden characters masked again (removing a hidden character can glue a keyword or a word to a token, `ghp_…<ZWSP>mysql -p…`, which no rule then reads). The
     reading as before PR 1721 (unhid) is the reference: `keep` shows nothing it hides. */
  const unhidBoth=(raw,run,bare,fail)=>{try{const s=String(raw==null?'':raw),c=unhide(s);if(c===s)return run(s);const m=run(s);if(m===null||m==='')return m;
    const c2=unhide(m);if(c2===m)return m;const m2=run(c2);return m2===null||m2===bare(c2)?m:m2;}catch(e){return fail;}};
  /* both readings of one text: this PR's (split tokens masked first, unhidBoth) and the one before it (old, unhid), nothing shown that the second hides */
  /* spec 012 FR-189 (issue #1940): a text whose link or image markup splits a token is read with the shared link step first (linkFirst), and nothing the reading
     without it (w, main's) hides shows (keep): a stretch it masks can end inside a token that a later step of the desk reads whole */
  const both2=(raw,w,go,src)=>{const s=String(raw==null?'':raw);const wl=linkFirst(src==null?s:src,w);let h=go(wl,unhidBoth);if(h===null||h==='')return h;
    if(wl!==w){const h1=go(w,unhidBoth);if(h1===null||h1==='')return h1;if(h!==h1&&h.includes('[redacted:'))return null;h=keep(h,h1);} /* a `[redacted:` the text holds reads as a mask to `keep` (plainLz's rule): fail closed */
    /* spec 012 FR-188 (review of PR 1899, independent differential): with an entity or a percent escape in the text, the same reading with the decoded reading off is a
       reference too (its split step as before FR-188; the steps after it can read a decoded mask differently: a hidden character removed glues a keyword to it), so
       nothing it hides shows; the shared withoutDecode, throws without it (callers fail closed) */
    let hd=h;if(DEC_GATE.test(s)){if(!SH||typeof SH.withoutDecode!=='function')throw new Error('no withoutDecode');const h0=SH.withoutDecode(()=>go(splitFirst(src==null?s:src),unhidBoth));if(h0===null||h0==='')return h0;hd=keep(h,h0);}
    if(w===s&&wl===s&&unhide(s)===s)return hd;const r=old(()=>go(s,unhid));if(r===null||r==='')return r;return keep(hd,r);};
  const DEC_GATE=/[&%]/;
  /* spec 012 FR-182 (review of PR 1721, round 4): every desk mask first masks the tokens split by a line break, a mark, a tag, a comment or a hidden character
     (the shared maskSplitTokens, the step redact starts with; nothing else of the text changes), then runs its own steps (unhide, unescape, plain, redact) on that
     output exactly as before PR 1721. A split token is gone before those steps can glue or break it, and everything else they read as they did. Without the
     shared module: throws, so the callers fail closed. */
  /* the reading with split tokens masked first, with nothing shown that the reading as before PR 1721 hides (shared keepShownBy); '' on a failure */
  const keep=(h,r)=>{if(!SH||typeof SH.keepShownBy!=='function')throw new Error('no keepShownBy');const k=SH.keepShownBy(h,r);if(typeof k!=='string')throw new Error('mask');return k;};
  /* spec 012 FR-182 (review of PR 1721, round 6): the desk's split-aware reading is bounded. The desk shows at most a few hundred characters of a text (the reply
     excerpt: 600; the monitor lines keep 1,200), so this PR's reading reads at most DESK_SPLIT_MAX characters of it: the excerpt reads the start of the text (what it
     shows), and maskRaw of a longer text uses the reading as before PR 1721 alone. The reading as before always reads the whole text, at main's cost, and `keep`
     masks every piece the bounded reading shows that it does not show whole, so a token cut at the bound is hidden, and nothing main hides shows. The split work
     of one desk call is so at most a fixed multiple of DESK_SPLIT_MAX (pinned by a work counter). An owner may choose another number. */
  const DESK_SPLIT_MAX=16384;
  const TOKEN_TAIL=/[A-Za-z0-9_\-.~+\/=:@%]/;
  /* the first DESK_SPLIT_MAX characters, never half a surrogate pair, ending at the last white space before the bound, then before any split span that crosses
     that cut (round 10 of the review of PR 1721: the shared splitSafeCut reads the split spans within 512 characters of the cut), so a token split by a line
     break, a mark, a tag, a comment or a hidden character is whole in the window or not in it at all, and nothing else is dropped. With no white space at all,
     round 7's token-character trim: the one piece left is not a piece of the reference, so `keep` masks it whole. Without the shared module: throws (the
     callers fail closed). Linear: one walk back (pinned by a step counter) and the bounded split read */
  const WIN_BLANK=/\s/;
  let winSteps=0;
  const windowOf=s=>{if(s.length<=DESK_SPLIT_MAX)return s;let e=DESK_SPLIT_MAX;if(/[\ud800-\udbff]/.test(s[e-1]))e--;
    if(!SH||typeof SH.splitSafeCut!=='function')throw new Error('no splitSafeCut');
    let c=e;while(c>0&&!WIN_BLANK.test(s[c-1])){c--;winSteps++;}
    if(c===0){while(e>0&&TOKEN_TAIL.test(s[e-1]))e--;return s.slice(0,e);} /* no white space at all */
    const k=SH.splitSafeCut(s,c);if(!Number.isInteger(k)||k<0||k>c)throw new Error('cut');return s.slice(0,k);};
  /* round 7: what the excerpt can show, before the window is taken: a closed code block becomes an empty one (plainKeep shows "code" for either), a link's target
     goes (plainKeep shows its text either way); so a long code block or link target at the start no longer eats the window. Linear (stripLinks' scan; the code
     block regex ends at the next fence, and a fence with none after it is the last) */
  const shownSource=t=>{t=String(t==null?'':t).replace(/```[\s\S]*?```/g,'``````');let out='',from=0,i=t.indexOf('[');
    while(i>=0){const j=t.indexOf(']',i+1);if(j<0)break;if(t[j+1]!=='('){i=t.indexOf('[',j+1);continue;}const k=t.indexOf(')',j+2);if(k<0)break;out+=t.slice(from,j+2);from=k;i=t.indexOf('[',k+1);}
    return from===0?t:out+t.slice(from);};
  /* the reading as before PR 1721: the shared masks with their split step off (withoutSplit); throws without it */
  const old=fn=>{if(!SH||typeof SH.withoutSplit!=='function')throw new Error('no withoutSplit');return SH.withoutSplit(fn);};
  const splitFirst=raw=>{if(!SH||typeof SH.maskSplitTokens!=='function')throw new Error('no maskSplitTokens');const r=SH.maskSplitTokens(String(raw==null?'':raw));if(typeof r!=='string')throw new Error('mask');return r;};
  /* spec 012 FR-189 (issue #1940): the text with a token split by link or image markup (any Markdown form, an autolink, an HTML tag) masked first (the shared
     maskLinkSplitTokens, linear), then the split step; `w` (the split step alone) when it masks nothing. Throws without it or on its failure (callers fail closed) */
  const linkMasked=raw=>{if(!SH||typeof SH.maskLinkSplitTokens!=='function')throw new Error('no maskLinkSplitTokens');const l=SH.maskLinkSplitTokens(String(raw==null?'':raw));
    if(typeof l!=='string'||l==='[redaction failed]')throw new Error('mask');return l;};
  let linkHits=0;
  const linkFirst=(src,w)=>{const s=String(src==null?'':src),l=linkMasked(s);if(l===s)return w;linkHits++;return splitFirst(l);};
  /* review of PR 1949, round 1 (F1): a surface during which the link step masked anything is read again with it off (the shared withoutLinkSplit: the desk as
     before FR-189); when that reading fails closed (null or ''), so does the surface, and otherwise nothing it hides shows (keep). A text that holds an open
     `[redacted:` (which keep reads as a mask) and reads differently fails closed. Throws without the shared module (callers fail closed) */
  const linkBoth=(raw,fn)=>{const n0=linkHits,h=fn();if(h==null||h===''||linkHits===n0)return h;
    if(!SH||typeof SH.withoutLinkSplit!=='function')throw new Error('no withoutLinkSplit');const r=SH.withoutLinkSplit(fn);if(r==null||r==='')return r;if(h===r)return h;
    if(String(raw==null?'':raw).includes('[redacted:')||h.includes('[redacted:')||r.includes('[redacted:'))return null;return keep(h,r);};
  /* spec 012 FR-190 (issue #1320): a surface during which the shared continuation reading hid anything (the shared contReadCount moved) is read again with it off
     (the shared withoutContinuation: the desk as before FR-190); when that reading fails closed (null or ''), so does the surface, and otherwise nothing it hides
     shows (keep). A text that holds an open `[redacted:` and reads differently fails closed, as linkBoth. Throws without the shared module (callers fail closed) */
  const contCount=()=>{if(!SH||typeof SH.contReadCount!=='function')throw new Error('no contReadCount');const n=SH.contReadCount();if(typeof n!=='number')throw new Error('count');return n;};
  const contBoth=(raw,fn)=>{const n0=contCount(),h=fn();if(h==null||h===''||contCount()===n0)return h;
    if(typeof SH.withoutContinuation!=='function')throw new Error('no withoutContinuation');const r=SH.withoutContinuation(fn);if(r==null||r==='')return r;if(h===r)return h;
    if(String(raw==null?'':raw).includes('[redacted:')||h.includes('[redacted:')||r.includes('[redacted:'))return null;return keep(h,r);};
  /* spec 012 FR-184 (issue #1543): a line continuation (a backslash, or cmd's caret, before a line break) inside a token is joined by the shell, but plainKeep makes the break a blank
     (`\ `, a literal blank to the shell), and PowerShell's `u{…} escape, whose backtick plainKeep removes as Markdown; a text with one is masked as written first
     (redact reads them), as maskRaw0 does for a backslash */
  /* review of PR 1824 (F3): the shared definition (hasShellJoin), never a copy; throws without it (callers fail closed) */
  const lineCont=t=>{if(!SH||typeof SH.hasShellJoin!=='function')throw new Error('no hasShellJoin');return SH.hasShellJoin(String(t==null?'':t))===true;};
  const maskPlain0=(raw,redact,codeWord)=>{try{
    let r0=raw;if(!asBefore&&lineCont(raw)){r0=redact(raw);if(typeof r0!=='string')throw new Error('mask');}
    const u=unesc(r0),m=both(u,plainKeep(u,codeWord),redact);
    return looseNow(m).replace(/_/g,'');}catch(e){if(e===OVER)throw e;return null;}}; /* spec 012 FR-185: the GitHub last pass before `_` goes, which it needs */ /* OVER is final: unhid's catch gives null, never the text as written */
  const maskPlain1=(raw,redact,codeWord)=>{if(typeof redact!=='function')return null;
    const s0=String(raw==null?'':raw);let w,src;try{src=s0.length>DESK_SPLIT_MAX?windowOf(shownSource(s0)):s0;w=splitFirst(src);}catch(e){return null;}
    const go=(x,u)=>u(x,t=>maskPlain0(t,redact,codeWord),c=>plainKeep(unesc(c),codeWord).replace(/_/g,''),null);
    try{return both2(raw,w,go,src);}catch(e){return null;}};
  /* the masked text, not made plain or cut: masked as it is, and again on the plain-kept text when Markdown that can split a token is
     present (otherwise the text is shown as it is). '' when masking is not possible. */
  const maskRaw1=(raw,redact)=>{if(typeof redact!=='function')return '';const s0=String(raw==null?'':raw);
    const go=(x,u)=>u(x,t=>maskRaw0(t,redact),c=>unesc(c),'');
    if(s0.length>DESK_SPLIT_MAX){try{const r=old(()=>go(s0,unhid));return r==null?'':r;}catch(e){return '';}} /* round 6: a long text, the reading as before alone */
    let w;try{w=splitFirst(s0);}catch(e){return '';}try{const m=both2(raw,w,go);return m==null?'':m;}catch(e){return '';}};
  /* spec 012 FR-181 (review of PR 1585, round 6): a text with a backslash is masked as written first, then unescaped and masked again, so the tail glued to an escaped head
     (`ghp\_<body>@<rest>`) goes with it as in redact; a text without one is masked as before (byte for byte) */
  /* spec 012 FR-184 (review of PR 1824, F3): and a text with a line continuation or `u{…} (no backslash in cmd's caret form), as the excerpt does (lineCont) */
  const maskRaw0=(raw,redact)=>{try{const r0=raw.indexOf('\\')<0&&(asBefore||!lineCont(raw))?raw:redact(raw);if(typeof r0!=='string')return '';const u=unesc(r0),m1=redact(u);if(typeof m1!=='string')return '';
    if(!SPLIT.test(u))return m1; /* no Markdown that can split a token: one pass is enough (and keeps the live readout cheap) */
    const k=plainKeep(u),m2=both(u,k,redact);return m2!==k?m2:m1;}catch(e){return '';}}; /* m2 holds what either pass found (both) */
  /* spec 012 FR-184 (issue #1543): the shared masks read a shell's escapes (a backslash, a backtick or a caret between token characters: `$'ghp\x5f…'`, `gh`p_…`, `g^hp_…`)
     and hide such a run whole, which can take a word or a value another step of the desk needed. So a text that holds one is read twice, with those readings
     (the head) and without them (the shared withoutShell: escaped runs as FR-181 read them), and nothing the second hides shows (keep); when the second
     fails closed (null or ''), so does the result. A text without one is read once, as before. Without the shared module: throws (callers fail closed). */
  const SHELL_GATE=/\\|[A-Za-z0-9_\-.~+\/=:@%][`^][A-Za-z0-9_\-.~+\/=:@%]/;
  const noShell=fn=>{if(!SH||typeof SH.withoutShell!=='function')throw new Error('no withoutShell');return SH.withoutShell(fn);};
  /* true while the reference reading runs: the desk's own FR-184 step (maskPlain0's continuation pass) is off in it too, so it reads as before */
  let asBefore=false;
  /* review of PR 1824 (F2): when no shared redact call inside fn read a text differently with the shell readings (the shared shellReadCount did not move) and the
     text has no line continuation (the desk's own step), the reading without them is this one: not read again */
  const shellCount=()=>{if(!SH||typeof SH.shellReadCount!=='function')throw new Error('no shellReadCount');const n=SH.shellReadCount();if(typeof n!=='number')throw new Error('count');return n;};
  /* both readings of fn: {v: the result, r: the reading without the shell readings (v itself when it was not read again)}; null or '' in v when either fails */
  const shellPair=(raw,fn)=>{if(asBefore){const v=fn();return {v,r:v};}const s=String(raw==null?'':raw),n0=shellCount(),d0=deskShell,h=fn();
    if(h==null||h===''||!SHELL_GATE.test(s)||(shellCount()===n0&&deskShell===d0&&!lineCont(s)))return {v:h,r:h};
    let r;asBefore=true;try{r=noShell(fn);}finally{asBefore=false;}if(r==null||r==='')return {v:r,r};return {v:h===r?h:keep(h,r),r};};
  const shellBoth=(raw,fn)=>shellPair(raw,fn).v;
  const maskPlain=(raw,redact,codeWord)=>{try{return contBoth(raw,()=>linkBoth(raw,()=>shellBoth(raw,()=>maskPlain1(raw,redact,codeWord))));}catch(e){return null;}};
  const maskRaw=(raw,redact)=>{try{const m=lz(()=>contBoth(raw,()=>linkBoth(raw,()=>shellBoth(raw,()=>maskRaw1(raw,redact)))));return m==null?'':m;}catch(e){return '';}};
  /* raw agent text -> masked, plain, at most n characters (no n: not cut). '' when masking is not possible. */
  const excerpt=(raw,redact,n,codeWord)=>{const p=plainLz(()=>maskPlain(String(raw==null?'':raw),redact,codeWord));if(p===null)return '';return n==null?p:cutter(p,n);};
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
  /* spec 012 FR-184 (review of PR 1824, F3): with the shell readings on, the shared step's run (ESC_RUN_SHELL_SOURCE: also `\ `, a line continuation, `\u{…}`, a backtick or caret
     between token characters), so the label judges the same runs as redact; while the reading without them runs (asBefore), ERUN as before. Throws without it */
  let ERUN_SH=null;
  const erun=()=>{if(asBefore)return ERUN;if(ERUN_SH)return ERUN_SH;if(!SH||typeof SH.ESC_RUN_SHELL_SOURCE!=='string')throw new Error('no ESC_RUN_SHELL_SOURCE');return (ERUN_SH=new RegExp(SH.ESC_RUN_SHELL_SOURCE,'g'));};
  const ESC_RUNS=64,ESC_FULL=10000;
  /* review of PR 1824 (F2/F3): how many labels the shell-mode runs cut differently from ERUN; a reading during which it moved is read again without the shell readings (shellPair) */
  let deskShell=0;
  const escMask=(s,mk)=>{const RX=erun();
    if(RX!==ERUN){const a=s.match(RX)||[],b=s.match(ERUN)||[];if(a.length!==b.length||a.some((x,i)=>x!==b[i]))deskShell++;}if(unesc(s)===s)return mk(s);const capped=s.length>ESC_FULL;
    const got=t=>{const r=mk(t);if(typeof r!=='string'||!r||/\[redaction failed\]/.test(r))throw new Error('mask');return r;};
    const hit=new Set(),seen=new Set();
    for(const m of s.matchAll(RX)){const r=m[0];if(r.indexOf('\\')<0||seen.has(r))continue;
      seen.add(r);if(capped&&seen.size>ESC_RUNS)return '';const u=unesc(r);if(got(u)!==u)hit.add(r);}
    const o=got(hit.size?s.replace(RX,r=>hit.has(r)?'[redacted]':r):s); /* one pass: each run is replaced where it stands, so no order is needed */
    const u=unesc(o);return got(u)===u?o:'';};
  const maskLabel1=(raw,kind,mask)=>{const s=String(raw==null?'':raw).trim();if(!s)return '';const m=mask||{};
    const f=kind==='run'?m.cmd:isUrl(s)?m.url:m.redact;if(typeof f!=='function')return '';
    /* spec 012 FR-182 (review of PR 1721, round 4): each mask call masks the split tokens first, then reads as before (escMask's escaped runs are replaced
       before, so a token glued to an escaped one is still hidden in place, FR-180) */
    try{const one=t=>{const r=f(t);return typeof r==='string'?r:'';};
      /* round 7: the label as before PR 1721 first; when it is '' (the window's own fail-closed check), the label is '' here too */
      const ref=old(()=>escMask(s,t=>unhid(t,one,c=>c,'')));if(!ref)return '';
      /* round 8: a label with no split token and no hidden character reads the same both ways: the reading as before is the answer (one pass, not two) */
      const sf=splitFirst(s);if(sf===s&&unhide(s)===s&&linkMasked(s)===s)return ref; /* round 9: the split step on the label once, shared with the reading below */
      const h=escMask(s,t=>{const go=(x,u)=>u(x,one,c=>c,'');if(t.length>DESK_SPLIT_MAX){const r=old(()=>go(t,unhid));return r==null?'':r;}const m=both2(t,t===s?sf:splitFirst(t),go);return m==null?'':m;});
      return h?keep(h,ref):'';}catch(e){return '';}};
  const maskLabel=(raw,kind,mask)=>{try{const m=lz(()=>contBoth(raw,()=>linkBoth(raw,()=>shellBoth(raw,()=>maskLabel1(raw,kind,mask)))));return m==null?'':m;}catch(e){return '';}};
  /* spec 012 FR-184 (review of PR 1824, F1): the label and its reading without the shell readings ({text, ref}; ref is text when it was not read again; '' for
     both on a failure). The permission card checks both: a command the reading as before cannot match back to what runs stays lost (as on main) */
  /* review of PR 1949 (F1): the pair's text goes through linkBoth too; its ref is the last reading's (with the link step off when it was read again) */
  const maskLabelPair=(raw,kind,mask)=>{try{let r0='';const v=noLoose(()=>contBoth(raw,()=>linkBoth(raw,()=>{const q=shellPair(raw,()=>maskLabel1(raw,kind,mask));r0=q.r;return q.v;})));const p={v,r:r0};const t=p.v||'';return t?{text:looseText(t),ref:looseText(p.r||'')}:{text:'',ref:''};}catch(e){return {text:'',ref:''};}};
  /* the wrapper the page uses: fallback words and the "is masking possible" flag */
  function create(o){
    const red=o&&typeof o.redact==='function'?o.redact:null, cut=o&&typeof o.cut==='function'?o.cut:cutter;
    /* the masked text, not made plain or cut ('' for null, and when masking is not possible). Markdown is not stripped (the text is shown as
       it is), but a token that only shows once it is stripped is masked too. */
    const mask=t=>t==null?'':maskRaw(String(t),red);
    /* masked, plain, at most n characters (no n: not cut); `fallback` (default 'Finished.') when there is text but masking is not possible */
    const ex=(t,n,fallback)=>{if(t==null||t==='')return '';const fb=fallback==null?'Finished.':fallback;if(!red)return fb;
      const p=plainLz(()=>maskPlain(String(t),red,true));if(p===null)return fb;return n==null?p:cut(p,n);};
    return {mask,excerpt:ex,plain,get ready(){return !!red&&hasShared();}};
  }
  /* spec 012 FR-182 (review of PR 1721): whether the shared step finds a token split by a line break, a mark, a tag, a comment or a hidden character; throws without
     the shared module (callers fail closed). The permission card reads a command with its blanks collapsed, so it asks this on the text as written. */
  const splitHides=t=>{if(!SH||typeof SH.maskSplitTokens!=='function')throw new Error('no maskSplitTokens');const s=String(t==null?'':t),r=SH.maskSplitTokens(s);if(typeof r!=='string')throw new Error('mask');return r!==s;};
  /* spec 097 FR-311 (review of PR 1721, round 2): a masked name made plain for a tooltip or an accessible name: a link becomes its text and the emphasis, code and
     strike marks go (stripLinks: linear); unlike plainKeep, a leading #, -, + or > and the blanks stay as written (`#1613 split tokens` keeps its #) */
  const plainMarks=t=>stripLinks(String(t==null?'':t)).replace(/[*`~]/g,'');
  /* test only: the window the desk's split-aware reading takes of a long text (round 7) */
  const _deskWindowForTest=t=>windowOf(shownSource(t));
  const _deskWindowStepsForTest=()=>{const n=winSteps;winSteps=0;return n;};
  /* test only (review of PR 1824, F3): the run the desk label step reads with the shell readings on */
  const _deskEscRunForTest=()=>erun().source;
  return {create,plain,plainKeep,plainMarks,unesc,unhide,maskRaw,excerpt,maskLabel,maskLabelPair,noLoose,looseText,useShared,splitHides,_deskWindowForTest,_deskWindowStepsForTest,_deskEscRunForTest,DESK_SPLIT_MAX,BOTH_WORK};
});
