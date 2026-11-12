/* Live activity on the desks (spec 001 FR-028..FR-031): one readout per main agent, built from its normalized events (thinking and
   reply deltas, tool starts), masked through src/shared/redact.ts and repainted at most 4 times a second. Pure: no DOM, time is passed in.
   In the page: window.DurbarLiveAct (it also names the compiled redact module that exports-shim.js collected window.DurbarRedact); in Node: module.exports. */
(function(root, api){
  if(typeof module==='object'&&module.exports) module.exports=api;
  else{root.DurbarLiveAct=api; if(root.exports&&typeof root.exports.redact==='function')root.DurbarRedact=root.exports;} /* the global `exports` stays: the compiled module reads its own constants from it */
})(typeof self!=='undefined'?self:this, (function(){
  'use strict';
  const ST=(typeof module==='object'&&module.exports?require('./safetext.js'):self.DurbarSafeText)||{plain:()=>'',maskLabel:()=>'',maskRaw:()=>''}; /* no safetext.js: the readout is empty, nothing leaks (fail closed) */ /* spec 041 FR-065: the one owner of plain() and the label mask (safetext.js loads first) */
  const KEEP=1200;          /* characters of the current thinking block or reply kept (the newest) */
  const PAINT_MS=250;       /* FR-030: at most 4 paints a second per desk */
  const LINE_MAX=160;       /* one-line readout (desk text line) */
  const PANEL_MAX=200;      /* side panel, a few lines */
  const STREAM_MAX=600;     /* a grown desk (spec 001 FR-043): up to 8 lines, the newest sentences */
  const SCREEN_LINES=24;    /* spec 097 FR-031: a Real office monitor keeps at most 24 lines... */
  const SCREEN_CHARS=200;   /* ...of at most 200 characters */
  const cutOf=(s,n)=>{s=String(s==null?'':s).replace(/\s+/g,' ').trim();const c=Array.from(s);return c.length<=n?s:c.slice(0,n-1).join('').trimEnd()+'…';};
  /* Markdown to plain words: code blocks, links, emphasis, headings and list marks go; whitespace collapses */
  const plain=t=>ST.plain(t);
  /* spec 001 FR-043, spec 041 FR-065: a reply shown on a desk. Masked by safetext's maskRaw (unescaped, and again on the plain-kept text when Markdown
     could split a token), then made plain. No working mask: '' (fail closed). Never a bare redact(raw). */
  const excerpt=(raw,redact)=>{const m=ST.maskRaw(String(raw==null?'':raw),redact);return m?plain(m):'';};
  /* a heading line ("**Planning the change**", "## Plan") is a title, not a sentence: it is left out */
  const HEAD=/^[ \t]*(?:#{1,6}[ \t].*|\*\*[^*\n]+\*\*[ \t]*)$/gm;
  /* The newest whole sentences that fit in `max` characters (only the newest one with `one`). A sentence ends at . ! ? or … followed by a
     space (so "registry.ts" or "v0.3" do not split), or where its paragraph ends. A sentence still being written counts only when there
     is no whole one yet. */
  function lastSentences(text,max,one){
    const paras=String(text==null?'':text).replace(/```[\s\S]*?(```|$)/g,' ').replace(HEAD,'').split(/\n[ \t]*\n/).map(plain).filter(Boolean);
    if(!paras.length)return '';
    const parts=[];
    paras.forEach((p,i)=>{const ss=p.split(/(?<=[.!?…])\s+/).map(x=>x.trim()).filter(Boolean);
      ss.forEach((x,j)=>parts.push({x,done:/[.!?…]$/.test(x)||(j===ss.length-1&&i<paras.length-1)}));});
    const done=parts.filter(p=>p.done).map(p=>p.x);
    const pool=done.length?done:[parts[parts.length-1].x];
    let out=pool[pool.length-1];
    for(let i=pool.length-2;i>=0&&!one;i--){const next=pool[i]+' '+out;if(Array.from(next).length>max)break;out=next;}
    return cutOf(out,max);
  }
  const openStr=raw=>{const t=String(raw==null?'':raw),i=Math.max(t.lastIndexOf('\x1b]'),t.lastIndexOf('\x1bP'),t.lastIndexOf('\x1b^'),t.lastIndexOf('\x1b_'),t.lastIndexOf('\x1bX'),t.lastIndexOf('\x90'),t.lastIndexOf('\x98'),t.lastIndexOf('\x9d'),t.lastIndexOf('\x9e'),t.lastIndexOf('\x9f'));return i>=0&&!/[\x07\x9c]|\x1b\\/.test(t.slice(i+1));};
  /* spec 097 FR-317 (issue #1284): a tool NAME is shown through the same mask as a label (MCP servers choose names). Control codes out first, then the mask;
     a name the mask changed in ANY way is shown as the generic word `tool`, never half hidden. No mask or a failing one: `tool` too. Every surface that shows a name calls this. */
  /* spec 012 FR-181 (review of PR 1585, round 7): a tool name longer than this is the neutral word before any mask runs (fail closed); the longest real names are under 30 characters, and an
     uncapped name was the one input that let a backslash-dense or `[redacted:`-dense text reach maskRaw at up to 1,000,000 characters (issue #1593) */
  const TOOL_CAP=256;
  const toolName=(raw,mask)=>{const m=mask||{};try{if(typeof m.redact!=='function')return 'tool'; /* no mask: fail closed, as a label */
    if(String(raw==null?'':raw).length>TOOL_CAP)return 'tool';
    if(openStr(raw))return 'tool'; /* an escape string left open at the end swallows what follows it, and what is shown would be the start of a token (ghp_ and four characters): fail closed (review of PR 1292) */
    const t=String(clearIn(raw==null?'':raw,m.redact)).trim();if(!t)return 'tool';
    const x=ST.maskRaw(t,m.redact);return x===t?t:'tool';}catch(e){return 'tool';}}; /* shown only when the mask left it exactly as it was: any change, a failed or cut mask ("[redaction failed]", the 1,000,000-character cut), a throw: `tool` */
  /* spec 097 FR-318 (issue #1290; review of PR 1292): the words of a permission request (its summary, the scope labels of its buttons, a grant chip, the "why allowed" label)
     through the same masks as the chat. Returns {text, hidden, why}: why is `secret` (a part was replaced), `control` (control characters were turned into visible markers
     such as ⟦ESC⟧) or `unchecked` (the mask is missing or failed: neutral words, no text). NEVER deletes a visible character: the grant key is the full raw text, so the card must
     show all of it. Control characters (escapes, C1, bidi, zero-width) become a visible marker each and hidden is true. A token an escape splits would slip past the mask once marked,
     so the text is also read three other ways (escape sequences out, introducers out, control characters out): when the mask changes any of them, the neutral words are shown
     (why `secret`). By kind: `shell` the command after `run ` through the command mask (maskLabel 'run'); `tool` each word of `server › tool` through toolName, then one redact; any other
     kind: redact (a URL by the URL mask). Empty text stays empty. Only shown text: ids, keys, scopes are untouched. */
  const PERM_FB={shell:'a command',tool:'tool',other:'request'};
  /* every character that can make a shown command differ from the real one: C0/C1 controls, any whitespace that is not a plain space (LF, CR, TAB, NBSP, U+2028...), every Cf and
     Default_Ignorable_Code_Point (ZWJ, ZWNJ, U+2060, variation selectors, tags, soft hyphen, bidi) and the blank fillers (U+2800, U+3164, U+115F, U+1160, U+FFA0) */
  const PCTRL_T=/[^\S ]|[\x00-\x1f\x7f-\x9f\p{Cf}\p{Default_Ignorable_Code_Point}\u2800\u3164\u115f\u1160\uffa0]/u;
  const PCTRL=new RegExp(PCTRL_T.source,'gu');
  const PMARK={'\x1b':'ESC','\n':'LF','\r':'CR','\t':'TAB'};
  const pmark=c=>'⟦'+(PMARK[c]||'U+'+c.codePointAt(0).toString(16).toUpperCase().padStart(4,'0'))+'⟧';
  const PERM_CAP=10000; /* characters looked at: more is cut (at a word) before any heavy work, and marked */
  /* review of PR 1292, round 3: a masked shell command is `lost` (shown text cannot be trusted to say what runs) when the mask blanked the whole command or failed, changed it without
     a [redacted] marker, or replaced a span that holds command substitution or a shell operator ($( ` ; | & < > or a line break marker): the visible pieces are matched back into the
     raw command, so every character that is not visible lies in a span that is checked */
  const REDACTED=/\[redacted[^\]]*\]/, SPANBAD=/\$\(|`|[;|&<>({\n\r]|\u27e6(?:LF|CR)\u27e7/;
  function shellLost(cmd,x){
    if(x===cmd)return false;
    if(/redaction failed/.test(x)||/^\s*\[redacted[^\]]*\]\s*$/.test(x))return true;
    const parts=x.split(new RegExp(REDACTED.source,'g'));if(parts.length<2)return true;
    if(!cmd.startsWith(parts[0]))return true;
    let pos=parts[0].length;
    for(let i=1;i<parts.length;i++){
      const p=parts[i],last=i===parts.length-1;let idx;
      if(last){if(!cmd.endsWith(p)||cmd.length-p.length<pos)return true;idx=cmd.length-p.length;}
      else{idx=cmd.indexOf(p,pos);if(idx<0)return true;}
      if(SPANBAD.test(cmd.slice(pos,idx)))return true;
      pos=idx+p.length;
    }
    return false;
  }
  function permCore(raw,k,m){ /* {s, out} (out null: the mask gave nothing) for a text without control characters */
    const s=String(raw).replace(/\s+/g,' ').trim();if(!s)return {s:'',out:''};
    if(k==='shell'){const mm=/^(run )([\s\S]*)$/.exec(s),pre=mm?mm[1]:'',cmd=mm?mm[2]:s;if(!cmd)return {s,out:s};
      const x=ST.maskLabel(cmd,'run',m);return {s,out:x?pre+x:null,lost:x?shellLost(cmd,x):false};}
    if(k==='tool'){const j=s.split(/( › |\s+)/).map((w,i)=>i%2||!w?w:toolName(w,m)).join('');const x=ST.maskLabel(j,'other',m);return {s,out:x||null};}
    const x=ST.maskLabel(s,'other',m);return {s,out:x||null};
  }
  function permBase(raw,kind,mask){
    const m=mask||{}, k=kind==='shell'||kind==='tool'?kind:'other', fb=why=>({text:PERM_FB[k],hidden:true,why});
    try{
      if(raw==null||raw==='')return {text:'',hidden:false};
      if(typeof m.redact!=='function')return fb('unchecked');
      let r0=String(raw),cut=false;
      if(r0.length>PERM_CAP){cut=true;r0=r0.slice(0,PERM_CAP);const i=r0.search(/\s\S*$/);r0=i>0?r0.slice(0,i):'';} /* cut at a word: never half a token */
      const tail=t=>cut?{text:t.text,hidden:true,why:'cut'}:t, suf=cut?' ⟦cut⟧':'';
      if(!PCTRL_T.test(r0)){
        const c=permCore(r0,k,m);if(c.out===null)return fb('unchecked');if(c.lost)return fb('concealed');return tail(c.out===c.s?{text:c.out+suf,hidden:false}:{text:c.out+suf,hidden:true,why:'secret'});}
      for(const v of [stripAnsi(r0),introOut(r0),r0.replace(PCTRL,'')]){ /* a token the controls split: the mask must find nothing in any reading */
        const c=permCore(v,k,m);if(c.out===null)return fb('unchecked');if(c.out!==c.s)return fb('concealed');} /* a secret behind controls: no text, and the card offers no Allow */
      let mk=r0.replace(PCTRL,pmark),mcut=false;
      if(mk.length>PERM_CAP){mcut=true;mk=mk.slice(0,PERM_CAP);const i=mk.search(/\s\S*$/);mk=i>0?mk.slice(0,i):'';} /* the markers grow the text: the cap counts the marked length too */
      const c=permCore(mk,k,m);if(c.out===null)return fb('unchecked');if(c.lost)return fb('concealed');
      if(mcut)return {text:c.out+' \u27e6cut\u27e7',hidden:true,why:'cut'};
      return tail({text:c.out+suf,hidden:true,why:c.out!==c.s?'secret':'control'});
    }catch(e){return fb('unchecked');}
  }
  /* spec 003 FR-117, FR-119 (issue #1300): lookalike letters. The check reads the raw text (controls out, before the mask: so a letter the mask hid is still
     counted, `inHidden`) and the shown text (FR-318 markers out); only what is shown gets a marker after each flagged letter, never a letter of a hidden part.
     The text keeps every character: the markers only add. No lookalike.js, or a throw: `look.unchecked` when the text has a non-ASCII letter, digit or mark. */
  const LK=()=>{try{return typeof module==='object'&&module.exports?require('./lookalike.js'):self.DurbarLookalike;}catch(e){return null;}}; /* read on each call: a page without it fails safe */
  const FRMARK=/\u27e6(?:ESC|LF|CR|TAB|cut|U\+([0-9A-F]{4,6}))\u27e7/g;
  /* the shown text without the FR-318 markers (a whitespace one as a line break, as the check reads a control), and where each character is in the shown text */
  function unmark(t){
    let out='';const at=[];let last=0,m;FRMARK.lastIndex=0;
    const put=(s,from)=>{for(let i=0;i<s.length;i++){out+=s[i];at.push(from+i);}};
    while((m=FRMARK.exec(t))){put(t.slice(last,m.index),last);
      const w=m[1]?/\s/.test(String.fromCodePoint(parseInt(m[1],16))):/^\u27e6(?:LF|CR|TAB)\u27e7$/.test(m[0]); /* only a whitespace control separates words, as clean() reads it (ESC is dropped: fix round 2) */if(w){out+='\n';at.push(m.index);}last=m.index+m[0].length;}
    put(t.slice(last),last);at.push(t.length);return {s:out,at};
  }
  const NONASCII_W=/(?![\x00-\x7f])[\p{L}\p{M}\p{N}]/u;
  const MARK_MAX=20; /* at most this many lookalike markers in one text, then one "and N more" (fix round 1: the text stays near its own length) */
  const PLACEHOLDER=/\[(?:redacted[^\]]*|redaction failed|secret hidden)\]/g;
  /* Which characters of the raw text are shown (fix round 1 of #1300's review: inHidden is decided per finding, not by counting). Both texts read with the
     controls out and whitespace runs as one space; the shown text's parts between mask placeholders are found in order in the raw one, and what lies
     between them is hidden. Returns a function rawIndex -> shown?, or null when the shown text cannot be matched back (then everything counts as hidden). */
  function shownRaw(r0,shown){
    const R=[],rawToR=new Int32Array(r0.length+1).fill(-1);let sp=true;
    for(let i=0;i<r0.length;){const cp=r0.codePointAt(i),c=String.fromCodePoint(cp);
      if(/\s/.test(c)){if(!sp){R.push(' ');sp=true;}}
      else if(!PCTRL_T.test(c)){for(let j=0;j<c.length;j++){rawToR[i+j]=R.length;R.push(c[j]);}sp=false;}
      i+=c.length;}
    while(R.length&&R[R.length-1]===' ')R.pop();
    const Rs=R.join(''), S=shown.replace(/\s+/g,' ').trim(), vis=new Uint8Array(Rs.length+1);
    let pos=0,last=0,m,parts=0;PLACEHOLDER.lastIndex=0;
    const take=p=>{if(!p)return true;const i=Rs.indexOf(p,pos);if(i<0||(parts===0&&i!==0))return false;vis.fill(1,i,i+p.length);pos=i+p.length;return true;};
    while((m=PLACEHOLDER.exec(S))){if(!take(S.slice(last,m.index)))return null;parts++;last=m.index+m[0].length;}
    const tail=S.slice(last);
    if(parts===0)return S===Rs?(i=>rawToR[i]>=0?1:-1):null;
    if(tail){const i=Rs.lastIndexOf(tail);if(i<pos||i+tail.length!==Rs.length)return null;vis.fill(1,i,i+tail.length);}
    return i=>rawToR[i]<0?-1:vis[rawToR[i]]===1?1:0; /* 1 shown, 0 hidden, -1 a control left out of both */
  }
  function permLook(b,raw,k){
    const L=LK();
    const r0=String(raw).slice(0,PERM_CAP);
    if(!L||typeof L.check!=='function')return NONASCII_W.test(r0)?Object.assign({},b,{look:{unchecked:true}}):b;
    try{
      const rc=L.check(r0,k), u=unmark(b.text), sc=L.check(u.s,k), vis=shownRaw(r0,u.s);
      const seenRaw=i=>vis?vis(i)===1:false;
      const spanSeen=(a,e)=>{if(!vis||!(e>a))return false;for(let i=a;i<e;i++)if(vis(i)===0)return false;return true;}; /* every character of a host shown (fix round 2: a token masked inside a host never reaches the line) */
      /* hosts and unreadable hosts come from the raw text, only where it is shown (a host the mask made, `[redacted]x.invalid`, is never one) */
      const hosts=rc.hosts.filter(h=>L.hostOdd(h)&&spanSeen(h.index,h.end));
      const fs=sc.findings.filter(f=>f.rule!=='host').concat(rc.findings.filter(f=>f.rule==='host'&&spanSeen(f.index,f.end)));
      const inHidden=rc.findings.some(f=>f.rule==='host'?!spanSeen(f.index,f.end):!seenRaw(f.index))||rc.hosts.some(h=>L.hostOdd(h)&&!spanSeen(h.index,h.end));
      if(!fs.length&&!hosts.length&&!inHidden)return b;
      /* one pass, in order: a marker after each of the first MARK_MAX flagged letters, then one "and N more" */
      const at=[],done=new Set();for(const f of sc.findings){if(f.rule==='host'||done.has(f.index))continue;done.add(f.index);at.push(f);}
      at.sort((x,y)=>x.index-y.index);
      const out=[];let from=0;const m=Math.min(at.length,MARK_MAX);
      for(let i=0;i<m;i++){const f=at[i],p=u.at[f.index]+f.char.length;out.push(b.text.slice(from,p),L.marker(f));if(i===m-1&&at.length>m)out.push('⟦and '+(at.length-m)+' more lookalike letters⟧');from=p;}
      out.push(b.text.slice(from));
      return Object.assign({},b,{text:out.join(''),look:{n:fs.length,findings:fs,hosts,inHidden}});
    }catch(e){return NONASCII_W.test(r0)?Object.assign({},b,{look:{unchecked:true}}):b;}
  }
  function permText(raw,kind,mask){
    const b=permBase(raw,kind,mask), k=kind==='shell'||kind==='tool'?kind:'other';
    if(!b||!b.text||raw==null||(b.hidden&&(b.why==='unchecked'||b.why==='concealed'||b.why==='cut')))return b; /* a blind card shows no text, so no lookalike line (FR-118) */
    return permLook(b,raw,k);
  }
  /* A tool start as a verb phrase. kind: read | edit | run | search | tool (the chat's toolKind); label: the chat's toolLabel. */
  function phrase(o,mask){
    const m=mask||{}, cl=x=>m.redact?clearIn(x,m.redact):stripAnsi(x); /* control codes out first, the way the monitor line does (a token split by an escape must be whole for the mask) */
    const kind=o&&o.kind||'tool', tool=toolName(o&&o.tool,m), raw=String(cl(o&&o.label||'')).trim();
    const isUrl=/^[a-z][a-z0-9+.-]{1,20}:\/\//i.test(raw);
    /* spec 097 FR-314 (review of PR 1272): the home folder goes BEFORE the cut, so a cut user name leaves no start of itself; no home mask: as it is */
    const hm=x=>{if(typeof m.home!=='function')return x;const h=m.home(x);return typeof h==='string'?h:'';};
    const lab=hm(ST.maskLabel(raw,kind,m));
    const t=tool.toLowerCase();
    let verb;
    if(isUrl||/fetch|web|url|http/.test(t))verb='Opening';
    else if(kind==='read')verb='Reading';
    else if(kind==='edit')verb='Editing';
    else if(kind==='run')verb='Running';
    else if(kind==='search')verb='Searching';
    else return cutOf(hm('Using '+tool+(lab?' '+lab:'')),LINE_MAX);
    return cutOf(hm(verb+(lab?' '+lab:'')),LINE_MAX);
  }
  /* spec 097 FR-031: terminal control codes never reach a screen: CSI, OSC, DCS and the like, control characters and text-direction overrides.
     Stripped BEFORE masking: an escape inside a token (gh<ESC>[0mp_...) would hide it from the mask and be glued back by the strip. */
  const ANSI=/\x1b\[[0-?]*[ -\/]*[@-~]?|\x9b[0-?]+[ -\/]*[@-~]|\x1b\][^\x07\x1b\x9c]*(?:\x07|\x1b\\|\x9c)?|\x9d[^\x07\x1b\x9c]*(?:\x07|\x1b\\|\x9c)|(?:\x1b[P^_X]|[\x90\x98\x9e\x9f])[^\x1b\x9c]*(?:\x1b\\|\x9c)?|\x1b[ -\/]*[0-~]?/g;
  const CTRL=/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f\u00ad\u061c\u200b\u200e\u200f\u2028-\u202e\u2066-\u2069\ufeff]/g;
  const stripAnsi=t=>String(t==null?'':t).replace(ANSI,'').replace(/\r\n?/g,'\n').replace(CTRL,'');
  /* the same text with only the escape's introducer gone: what `gh<ESC>[p_...` or `gh<U+009B>p_...` is if the letter after it belongs to a token, not to the escape */
  const INTRO=/\x1b\[|\x1b\]|\x1b[P^_X]|\x1b|[\x90\x98\x9b\x9d\x9e\x9f]/g;
  const introOut=t=>String(t==null?'':t).replace(INTRO,'').replace(/\r\n?/g,'\n').replace(CTRL,'');
  /* spec 097 FR-318: the escape-free text wins when the mask already finds a token in it (an OSC or CSI cut out of the middle of one leaves it whole); the introducer-only text is
     for a token whose own letter the escape would swallow (`gh<ESC>[p_...`), which the escape-free text no longer shows. Taking it first left the tail of a token after an OSC. */
  const clearIn=(raw,redact)=>{const a=stripAnsi(raw);try{const b=introOut(raw),u=ST.unhide?ST.unhide:x=>x;if(b!==a&&redact(u(a))===u(a)&&redact(u(b))!==u(b))return b;}catch(e){return '';}return a;};
  /* A sentence over SCREEN_CHARS goes on as more lines, cut at a word where there is one */
  const chunks=t=>{const c=Array.from(t),out=[];let i=0;
    while(c.length-i>SCREEN_CHARS){let j=i+SCREEN_CHARS;for(let k=j;k>i+SCREEN_CHARS/2;k--)if(c[k]===' '){j=k;break;}out.push(c.slice(i,j).join('').trim());i=j;}
    out.push(c.slice(i).join('').trim());return out.filter(Boolean);};
  /* Per-agent readouts. onEvent returns true when what a desk should show changed. */
  function create(opts){
    const o=opts||{}, mask=o.mask||{}, red=s=>mask.redact?ST.maskRaw(s,mask.redact):s; /* FR-065: also masks a token that Markdown broke up (ghp\_..., gh`p_...) */
    const st=new Map();
    const get=id=>{let s=st.get(id);if(!s){s={kind:'',text:'',lines:'',long:null,body:'',tool:'',buf:'',rid:null,lastPaint:-Infinity,log:[],seq:0,blk:'',done:false};st.set(id,s);}return s;};
    /* spec 097 FR-030, FR-031: a Real office monitor's lines, from the same events and masks as the readout above (it adds no masker):
       control codes stripped, then maskRaw (mask before any cut), the home folder shortened, then plain text in lines of at most 200
       characters. No working mask: nothing (fail closed). `done` false: the word still arriving is held back, since half a token matches no shape.
       A text cut at KEEP loses its first word for the same reason. */
    const home=t=>{if(!mask.home)return t;const h=mask.home(t);return typeof h==='string'?h:'';};
    /* control codes out: as escapes, unless read the other way they leave a token, which must then be masked in that reading */
    const clear=raw=>clearIn(raw,mask.redact);
    const block=(raw,k,done)=>{
      if(!mask.redact)return [];
      let t=String(raw==null?'':raw);
      if(t.length>=KEEP){t=t.slice(-KEEP);const m=/\s/.exec(t);t=m?t.slice(m.index+1):'';}
      t=clear(t);
      if(!done){let e=t.length;while(e>0&&!/\s/.test(t[e-1]))e--;t=t.slice(0,e);}
      const m=home(ST.maskRaw(t,mask.redact));
      if(!m)return [];
      const out=[];
      for(const para of m.replace(/```[\s\S]*?(```|$)/g,' ').replace(HEAD,'').split(/\n+/)){
        const p=plain(para);
        if(p)for(const x of p.split(/(?<=[.!?…])\s+/))for(const c of chunks(x))out.push({k,t:c});
      }
      return out.slice(-SCREEN_LINES);};
    /* spec 097 FR-035 (review of P2): a question, an approval or an error on a monitor: all it shows is one line, cut at 200 like the desk's title, read through the
       command and URL masks too since an approval quotes a command; any of them missing: nothing */
    const strict=(raw,k)=>{
      if(!mask.redact||!mask.cmd||!mask.url)return [];
      try{let t=String(raw==null?'':raw);
        if(t.length>KEEP){t=t.slice(0,KEEP);const m=/\s\S*$/.exec(t.slice(-200));t=m?t.slice(0,t.length-200+m.index):'';}
        t=clear(t);
        const m0=ST.maskRaw(t,mask.redact);if(!m0)return [];
        const m1=mask.cmd(m0);if(typeof m1!=='string')return [];
        const m2=mask.url(m1);if(typeof m2!=='string')return [];
        const m=home(m2);if(!m)return [];
        const l=cutOf(plain(m.replace(/```[\s\S]*?(```|$)/g,' ')),SCREEN_CHARS);
        return l?[{k:k||'plain',t:l}]:[];}catch(e){return [];}};
    const logPush=(s,k,t,cid)=>{s.log.push({n:s.seq++,k,t,cid});if(s.log.length>SCREEN_LINES)s.log.splice(0,s.log.length-SCREEN_LINES);};
    /* the text block being streamed becomes finished lines (a tool, a new turn or a status ends it) */
    const commit=s=>{if(s.blk&&s.buf)for(const l of block(s.buf,s.blk,true))logPush(s,l.k,l.t);s.blk='';s.done=false;};
    /* body: the masked text a grown desk's `long` is made from, only when one asks (of()); a tool phrase or '' has none (long = lines) */
    const set=(s,kind,text,lines,body)=>{body=body||'';const ch=s.kind!==kind||s.text!==text||s.lines!==lines||(s.body!==body&&s.long!==null);
      if(s.body!==body)s.long=null;s.kind=kind;s.text=text;s.lines=lines;s.body=body;return ch;};
    const longOf=s=>{if(!s.body)return s.lines||s.text;if(s.long===null)s.long=lastSentences(s.body,STREAM_MAX);return s.long;};
    function onEvent(id,e,extra){
      if(!e||e.agentId)return false; /* helpers' events never change the main desk */
      const s=get(id), x=extra||{};
      switch(e.type){
      case 'thinking':{
        if(s.kind!=='think'||(e.reasoningId&&e.reasoningId!==s.rid)){commit(s);s.buf='';s.rid=e.reasoningId||null;}
        s.blk='think';s.done=false;
        s.buf=(s.buf+String(e.delta||'')).slice(-KEEP);
        const body=red(s.buf);
        return set(s,'think','Thinking: '+lastSentences(body,LINE_MAX-10,true),lastSentences(body,PANEL_MAX),body);}
      case 'output':{
        if(s.kind!=='reply'){commit(s);s.buf='';}
        s.blk='reply';s.done=!!e.final;
        s.buf=e.final&&typeof e.text==='string'?e.text.slice(-KEEP):(s.buf+String(e.delta||'')).slice(-KEEP);
        const body=red(s.buf), l=lastSentences(body,LINE_MAX-10,true);
        if(!l)return false;
        return set(s,'reply','Replying: '+l,lastSentences(body,PANEL_MAX),body);}
      case 'toolCall':{
        /* spec 097 FR-032: a finished call colours its line (command, then ok or error); its output is not shown, as on the desk */
        if(e.phase==='complete'||e.phase==='failed'){for(let i=s.log.length-1;i>=0;i--)if(s.log[i].cid&&s.log[i].cid===e.callId){s.log[i].k=e.phase==='failed'?'err':'ok';break;}}
        if(e.phase!=='start'||x.skip)return false;
        commit(s);
        s.buf='';
        /* spec 097 FR-314 (review of PR 1272): ONE phrase (`phrase` clears its input, masks it, the home folder too, before the cut): the desk line, the
           grown desk's last tool, the zoom and the monitor line all read it. No redact: control codes are stripped and the label masks fail closed. */
        const p=phrase({kind:x.kind,tool:e.tool,label:x.label},mask);
        if(mask.redact&&p)logPush(s,'cmd',p,e.callId);
        s.tool=p; /* spec 001 FR-047: the last tool of this turn stays for a wide grown desk while the agent thinks or replies */
        return set(s,'tool',p,p);}
      case 'user':commit(s);s.buf='';s.tool='';return set(s,'','','');
      case 'status':
        if(e.status==='working')return false;
        commit(s);s.buf='';s.tool='';return set(s,'','','');
      default:return false;
      }
    }
    return {
      onEvent,
      /* {kind, text, lines, long, tool} or null when there is nothing to show (long: a grown desk's newest sentences, spec 001 FR-043;
         tool: the last tool phrase of this turn, masked, or '', FR-047) */
      of:id=>{const s=st.get(id);if(!s||!s.text)return null;const o={kind:s.kind,text:s.text,lines:s.lines||s.text,tool:s.tool||''};
        Object.defineProperty(o,'long',{enumerable:true,get:()=>longOf(s)||o.lines});return o;},
      /* spec 097 FR-030: the monitor's newest lines, oldest first: [{n,k,t}] (n: a number that stays with the line; k: think, reply, cmd, ok, err) */
      screen:id=>{const s=st.get(id);if(!s)return [];const tail=s.blk&&s.buf?block(s.buf,s.blk,s.done):[];
        return s.log.concat(tail.map((l,i)=>({n:s.seq+i,k:l.k,t:l.t}))).slice(-SCREEN_LINES).map(l=>({n:l.n,k:l.k,t:l.t}));},
      /* a finished text (a last reply, a task) as screen lines, through the same steps */
      block:(raw,k)=>block(raw,k||'reply',true),
      strict,
      clear:id=>{const s=st.get(id);if(s){commit(s);s.buf='';s.tool='';set(s,'','','');}},
      drop:id=>{st.delete(id);},
      /* FR-030: may this desk be painted now? Records the paint when it may. */
      due:(id,now)=>{const s=get(id);if(now-s.lastPaint>=PAINT_MS){s.lastPaint=now;return true;}return false;},
      wait:(id,now)=>{const s=get(id);return Math.max(0,PAINT_MS-(now-s.lastPaint));},
      /* a trailing paint that a timer made: it counts like any other (a timer may fire a little early) */
      mark:(id,now)=>{get(id).lastPaint=now;}
    };
  }
  const KIND_WORD={think:'Thinking',tool:'Working',reply:'Replying'};
  return {create,phrase,toolName,permText,lastSentences,plain,excerpt,stripAnsi,KIND_WORD,PAINT_MS,LINE_MAX,PANEL_MAX,STREAM_MAX,SCREEN_LINES,SCREEN_CHARS};
})());
