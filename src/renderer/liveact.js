/* Live activity on the desks (spec 001 FR-028..FR-031): one readout per main agent, built from its normalized events (thinking and
   reply deltas, tool starts), masked through src/shared/redact.ts and repainted at most 4 times a second. Pure: no DOM, time is passed in.
   In the page: window.DurbarLiveAct (it also names the compiled redact module that exports-shim.js collected window.DurbarRedact); in Node: module.exports. */
(function(root, api){
  if(typeof module==='object'&&module.exports) module.exports=api;
  else{root.DurbarLiveAct=api; if(root.exports&&typeof root.exports.redact==='function')root.DurbarRedact=root.exports;} /* the global `exports` stays: the compiled module reads its own constants from it */
})(typeof self!=='undefined'?self:this, (function(){
  'use strict';
  const KEEP=1200;          /* characters of the current thinking block or reply kept (the newest) */
  const PAINT_MS=250;       /* FR-030: at most 4 paints a second per desk */
  const LINE_MAX=160;       /* one-line readout (desk text line) */
  const PANEL_MAX=200;      /* side panel, a few lines */
  const STREAM_MAX=600;     /* a grown desk (spec 001 FR-043): up to 8 lines, the newest sentences */
  const cutOf=(s,n)=>{s=String(s==null?'':s).replace(/\s+/g,' ').trim();const c=Array.from(s);return c.length<=n?s:c.slice(0,n-1).join('').trimEnd()+'…';};
  /* Markdown to plain words: code blocks, links, emphasis, headings and list marks go; whitespace collapses */
  const plain=t=>String(t==null?'':t).replace(/```[\s\S]*?(```|$)/g,' ').replace(/!?\[([^\]]*)\]\([^)]*\)/g,'$1').replace(/^[#>\-*+\s]+/gm,'').replace(/[*_`~]/g,'').replace(/\s+/g,' ').trim();
  /* spec 001 FR-043: a reply shown on a desk. Masked on the RAW text first (`plain` strips `_`, `*` and backticks, so `ghp_…` would
     become `ghp…` and no longer match), then made plain. No working mask: '' (fail closed). */
  const excerpt=(raw,redact)=>{if(typeof redact!=='function')return '';let m;try{m=redact(String(raw==null?'':raw));}catch(e){return '';}return typeof m==='string'?plain(m):'';};
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
    const lab=!raw?'':kind==='run'&&m.cmd?m.cmd(raw):isUrl&&m.url?m.url(raw):m.redact?m.redact(raw):raw;
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
  /* Per-agent readouts. onEvent returns true when what a desk should show changed. */
  function create(opts){
    const o=opts||{}, mask=o.mask||{}, red=s=>mask.redact?mask.redact(s):s;
    const st=new Map();
    const get=id=>{let s=st.get(id);if(!s){s={kind:'',text:'',lines:'',long:null,body:'',tool:'',buf:'',rid:null,lastPaint:-Infinity};st.set(id,s);}return s;};
    /* body: the masked text a grown desk's `long` is made from, only when one asks (of()); a tool phrase or '' has none (long = lines) */
    const set=(s,kind,text,lines,body)=>{body=body||'';const ch=s.kind!==kind||s.text!==text||s.lines!==lines||(s.body!==body&&s.long!==null);
      if(s.body!==body)s.long=null;s.kind=kind;s.text=text;s.lines=lines;s.body=body;return ch;};
    const longOf=s=>{if(!s.body)return s.lines||s.text;if(s.long===null)s.long=lastSentences(s.body,STREAM_MAX);return s.long;};
    function onEvent(id,e,extra){
      if(!e||e.agentId)return false; /* helpers' events never change the main desk */
      const s=get(id), x=extra||{};
      switch(e.type){
      case 'thinking':{
        if(s.kind!=='think'||(e.reasoningId&&e.reasoningId!==s.rid)){s.buf='';s.rid=e.reasoningId||null;}
        s.buf=(s.buf+String(e.delta||'')).slice(-KEEP);
        const body=red(s.buf);
        return set(s,'think','Thinking: '+lastSentences(body,LINE_MAX-10,true),lastSentences(body,PANEL_MAX),body);}
      case 'output':{
        if(s.kind!=='reply')s.buf='';
        s.buf=e.final&&typeof e.text==='string'?e.text.slice(-KEEP):(s.buf+String(e.delta||'')).slice(-KEEP);
        const body=red(s.buf), l=lastSentences(body,LINE_MAX-10,true);
        if(!l)return false;
        return set(s,'reply','Replying: '+l,lastSentences(body,PANEL_MAX),body);}
      case 'toolCall':{
        if(e.phase!=='start'||x.skip)return false;
        s.buf='';
        const p=phrase({kind:x.kind,tool:e.tool,label:x.label,simple:x.simple},mask);
        s.tool=p; /* spec 001 FR-047: the last tool of this turn stays for a wide grown desk while the agent thinks or replies */
        return set(s,'tool',p,p);}
      case 'user':s.buf='';s.tool='';return set(s,'','','');
      case 'status':
        if(e.status==='working')return false;
        s.buf='';s.tool='';return set(s,'','','');
      default:return false;
      }
    }
    return {
      onEvent,
      /* {kind, text, lines, long, tool} or null when there is nothing to show (long: a grown desk's newest sentences, spec 001 FR-043;
         tool: the last tool phrase of this turn, masked, or '', FR-047) */
      of:id=>{const s=st.get(id);if(!s||!s.text)return null;const o={kind:s.kind,text:s.text,lines:s.lines||s.text,tool:s.tool||''};
        Object.defineProperty(o,'long',{enumerable:true,get:()=>longOf(s)||o.lines});return o;},
      clear:id=>{const s=st.get(id);if(s){s.buf='';s.tool='';set(s,'','','');}},
      drop:id=>{st.delete(id);},
      /* FR-030: may this desk be painted now? Records the paint when it may. */
      due:(id,now)=>{const s=get(id);if(now-s.lastPaint>=PAINT_MS){s.lastPaint=now;return true;}return false;},
      wait:(id,now)=>{const s=get(id);return Math.max(0,PAINT_MS-(now-s.lastPaint));},
      /* a trailing paint that a timer made: it counts like any other (a timer may fire a little early) */
      mark:(id,now)=>{get(id).lastPaint=now;}
    };
  }
  const KIND_WORD={think:'Thinking',tool:'Working',reply:'Replying'};
  return {create,phrase,lastSentences,plain,excerpt,KIND_WORD,PAINT_MS,LINE_MAX,PANEL_MAX,STREAM_MAX};
})());
