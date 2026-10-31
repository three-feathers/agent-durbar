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
  /* A tool start as a verb phrase. kind: read | edit | run | search | tool (the chat's toolKind); label: the chat's toolLabel.
     simple: the plain chat words (spec 052 FR-081) given by the caller, so Simple never shows a command. */
  function phrase(o,mask){
    const m=mask||{}, kind=o&&o.kind||'tool', tool=String(o&&o.tool||'tool'), raw=String(o&&o.label||'').trim();
    if(o&&o.simple)return cutOf(o.simple,LINE_MAX);
    const isUrl=/^[a-z][a-z0-9+.-]{1,20}:\/\//i.test(raw);
    const lab=ST.maskLabel(raw,kind,m);
    const t=tool.toLowerCase();
    let verb;
    if(isUrl||/fetch|web|url|http/.test(t))verb='Opening';
    else if(kind==='read')verb='Reading';
    else if(kind==='edit')verb='Editing';
    else if(kind==='run')verb='Running';
    else if(kind==='search')verb='Searching';
    else return cutOf('Using '+tool+(lab?' '+lab:''),LINE_MAX);
    return cutOf(verb+(lab?' '+lab:''),LINE_MAX);
  }
  /* spec 097 FR-031: terminal control codes never reach a screen: CSI, OSC, DCS and the like, control characters and text-direction overrides.
     Stripped BEFORE masking: an escape inside a token (gh<ESC>[0mp_...) would hide it from the mask and be glued back by the strip. */
  const ANSI=/(?:\x1b\[|\x9b)[0-?]*[ -\/]*[@-~]?|(?:\x1b\]|\x9d)[^\x07\x1b\x9c]*(?:\x07|\x1b\\|\x9c)?|(?:\x1b[P^_X]|[\x90\x98\x9e\x9f])[^\x1b\x9c]*(?:\x1b\\|\x9c)?|\x1b[ -\/]*[0-~]?/g;
  const CTRL=/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;
  const stripAnsi=t=>String(t==null?'':t).replace(ANSI,'').replace(/\r\n?/g,'\n').replace(CTRL,'');
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
    const block=(raw,k,done)=>{
      if(!mask.redact)return [];
      let t=String(raw==null?'':raw);
      if(t.length>=KEEP){t=t.slice(-KEEP);const m=/\s/.exec(t);t=m?t.slice(m.index+1):'';}
      t=stripAnsi(t);
      if(!done){let e=t.length;while(e>0&&!/\s/.test(t[e-1]))e--;t=t.slice(0,e);}
      const m=home(ST.maskRaw(t,mask.redact));
      if(!m)return [];
      const out=[];
      for(const para of m.replace(/```[\s\S]*?(```|$)/g,' ').replace(HEAD,'').split(/\n+/)){
        const p=plain(para);
        if(p)for(const x of p.split(/(?<=[.!?…])\s+/))for(const c of chunks(x))out.push({k,t:c});
      }
      return out.slice(-SCREEN_LINES);};
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
        const p=phrase({kind:x.kind,tool:e.tool,label:x.label,simple:x.simple},mask);
        if(mask.redact){const l=home(phrase({kind:x.kind,tool:stripAnsi(e.tool),label:stripAnsi(x.label),simple:x.simple?stripAnsi(x.simple):x.simple},mask));if(l)logPush(s,'cmd',l,e.callId);}
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
  return {create,phrase,lastSentences,plain,excerpt,stripAnsi,KIND_WORD,PAINT_MS,LINE_MAX,PANEL_MAX,STREAM_MAX,SCREEN_LINES,SCREEN_CHARS};
})());
