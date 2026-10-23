/* Spec 058 FR-001 / FR-006: the word and icon for an MCP server's state, and the one-line hint for a failed or needs-sign-in row.
   Pure: no DOM, no escaping (the caller escapes every string it puts in markup). In the page: window.DurbarMcpWords; in Node: module.exports. */
(function(root, api){
  if(typeof module==='object'&&module.exports) module.exports=api; else root.DurbarMcpWords=api;
})(typeof self!=='undefined'?self:this, (function(){
  'use strict';
  /* icon = a shape name, so the state never rests on colour alone (constitution V); cls = the CSS class of the dot colour */
  const STATES={
    'connected':{word:'Running',icon:'check',cls:'connected'},
    'pending':{word:'Starting',icon:'clock',cls:'pending'},
    'failed':{word:'Failed',icon:'cross',cls:'failed'},
    'needs-auth':{word:'Needs sign-in',icon:'key',cls:'needs-auth'},
    'disabled':{word:'Off for this session',icon:'off',cls:'disabled'},
    'stopped':{word:'Stopped',icon:'stop',cls:'stopped'},
    'not_configured':{word:'Not set up for this session',icon:'dash',cls:'stopped'}
  };
  const NONE={word:'Not started yet',icon:'dash',cls:'none'};
  /* the token of an unknown state is shown, but only a short plain one: no control characters, cut at 40 */
  /* plain text for a title or a word: input cut first (a long runtime string costs nothing), control characters flattened, cut at n with an ellipsis */
  const plain=(t,n)=>{const s=String(t==null?'':t).slice(0,n+160).replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g,' ').trim();return s.length>n?s.slice(0,n-1)+'\u2026':s;};
  const tokenText=t=>plain(t,40);
  /* `status` is the runtime's token (missing/empty = no state yet). Returns {word, icon, cls}; an unknown token reads "Unknown state: <token>"
     (plain text, the caller escapes) and gets the neutral class. */
  function stateOf(status,ctx){
    if(status==='disabled'&&ctx){const w=offWord(ctx);if(w.by==='pending')return Object.assign({},STATES.pending);if(w)return {word:w.word,icon:'off',cls:'disabled'};}
    if(status===undefined||status===null||status==='')return Object.assign({},NONE);
    if(typeof status==='string'&&Object.prototype.hasOwnProperty.call(STATES,status))return Object.assign({},STATES[status]);
    const t=tokenText(typeof status==='string'?status:'?');
    return {word:t?'Unknown state: '+t:'Unknown state',icon:'dash',cls:'unknown'};
  }
  /* Spec 058 FR-078: who turned a `disabled` server off. ctx = {off (this session's switch), defaultOn (false: off in Settings or the folder's extras),
     origin, app}. The word and the row's switch must agree: the switch is on only when none of these is true. by: 'here' | 'settings' | 'start' | 'pending' | 'app'. */
  function offBy(ctx){
    if(!ctx)return 'app';
    if(ctx.off)return 'here';
    if(ctx.defaultOn===false)return 'settings';
    if(ctx.launchedOff)return 'start'; /* Durbar passed it as off when the session started: only a restart changes it */
    if(ctx.switchedHere)return 'pending'; /* switched on here; the runtime's old `disabled` is about to be replaced by its event */
    return 'app';
  }
  function offWord(ctx){
    const by=offBy(ctx),app=ctx&&ctx.app?plain(ctx.app,40):'';
    if(by==='here')return {by,word:'Off for this session'};
    if(by==='start')return {by,word:'Off until the session restarts'};
    if(by==='pending')return {by,word:'Starting'};
    if(by==='settings')return {by,word:ctx&&ctx.origin==='folder'?'Off in folder extras':'Off in Settings'};
    return {by,word:app?'Off in '+app:'Turned off by the agent app'};
  }
  /* 16x16 icon bodies (stroke, no fill), one per shape name; static markup, safe to place in a row */
  const ICONS={
    check:'<path d="M3.5 8.5l3 3 6-7"/>',
    clock:'<circle cx="8" cy="8" r="5.5"/><path d="M8 5v3.2l2 1.3"/>',
    cross:'<path d="M4 4l8 8M12 4l-8 8"/>',
    key:'<circle cx="5.5" cy="8" r="2.5"/><path d="M8 8h5.5M11.5 8v2.2"/>',
    off:'<circle cx="8" cy="8" r="5.5"/><path d="M4.1 11.9l7.8-7.8"/>',
    stop:'<rect x="4.5" y="4.5" width="7" height="7" rx="1"/>',
    dash:'<path d="M4 8h8"/>'
  };
  const iconSvg=name=>`<svg class="mst-ic" viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICONS[name]||ICONS.dash}</svg>`;

  /* The hint (FR-006): failed and needs-auth rows only, one short sentence with what to check. `errorClass` (FR-011) wins; otherwise
     the already-masked text decides. Returns '' when there is nothing useful to say. `app` is the agent app's name. */
  const CLASS_HINT={
    'not-found':'The command was not found. Check that it is installed and that its name is right in Settings or the folder\'s extras.',
    'timeout':'The server took too long to answer. Restart it, or check that it is reachable.',
    'exited':'The server stopped on its own. Restart it, and check its command and arguments.',
    'config':'The server\'s settings look wrong. Check them in Settings or the folder\'s extras.'
  };
  function signInHint(app){return 'This server needs you to sign in. '+(app?app:'Your agent app')+' keeps the sign-in; Agent Durbar never sees it.';}
  function hintFor(o){
    const status=o&&o.status, cls=o&&o.errorClass, app=o&&o.app?String(o.app):'';
    if(status==='disabled'&&o.by==='start')return 'It was off when this session started. Use Restart session with these servers to start it.';
    if(status==='disabled'&&o.by==='app')return 'Turn it on in '+(app?plain(app,40)+'\u2019s own':'the agent app\u2019s own')+' MCP settings, then restart the session. Agent Durbar cannot switch it on here.';
    if(status==='needs-auth'||(status==='failed'&&cls==='auth'))return signInHint(app);
    if(status!=='failed')return '';
    if(typeof cls==='string'&&Object.prototype.hasOwnProperty.call(CLASS_HINT,cls))return CLASS_HINT[cls];
    const t=String(o&&o.error||'').slice(0,2000);
    if(/\bENOENT\b|command not found|is not recognized|no such file or directory/i.test(t))return CLASS_HINT['not-found'];
    if(/\bEACCES\b|permission denied/i.test(t))return 'Permission was denied. Check that the command is allowed to run and that its folder can be read.';
    if(/\bETIMEDOUT\b|timed out|timeout/i.test(t))return CLASS_HINT.timeout;
    if(/\bECONNREFUSED\b|connection refused|\bENOTFOUND\b|\bEAI_AGAIN\b|getaddrinfo|host not found|could not resolve/i.test(t))return 'The server could not be reached. Check its address and your network.';
    if(/exited|crashed|terminated|killed|\bSIGSEGV\b|\bSIGKILL\b|exit code/i.test(t))return CLASS_HINT.exited;
    if(/invalid (config|configuration)|configuration error|misconfigured/i.test(t))return CLASS_HINT.config;
    return '';
  }
  /* Spec 058 FR-081: one server's live state over the running chats, for Settings > MCP servers. `sessions` = [{id, name, folder, reply}],
     `reply` an `agents:mcp` reply (main masked its errors); `configured` = server names of the configured lists. A chat "uses" a server when
     the agent app reported a state for it, or it is switched on there. Most urgent state first (RANK); the row takes its icon and class. */
  const RANK=['failed','needs-auth','pending','unknown','none','connected','not_configured','stopped','disabled'];
  const keyOf=st=>st===undefined||st===null||st===''?'none':typeof st==='string'&&Object.prototype.hasOwnProperty.call(STATES,st)?st:'unknown';
  const MAX_CHATS=50, MAX_SERVERS=200;
  const okName=n=>typeof n==='string'&&n.length>0&&n.length<=200;
  function aggregate(sessions,configured){
    const rows=new Map();
    const row=n=>{let r=rows.get(n);if(!r){r={name:n,chats:[]};rows.set(n,r);}return r;};
    let chats=0;
    for(const c of Array.isArray(sessions)?sessions:[]){
      if(chats>=MAX_CHATS)break;
      const rp=c&&c.reply;
      if(!rp||rp.ok!==true||rp.live!==true||!Array.isArray(rp.servers))continue;
      chats++;
      const seen=new Set();
      for(const e of rp.servers){
        if(!e||!okName(e.name)||seen.has(e.name))continue;
        seen.add(e.name);
        const reported=!(e.status===undefined||e.status===null||e.status==='');
        if(!reported&&(e.defaultOn===false||e.off===true))continue;
        /* the chat dialog's own words (FR-078: who turned a `disabled` server off), so both places say the same */
        const sv=stateOf(e.status,{off:e.off,defaultOn:e.defaultOn,origin:e.origin,app:rp.app,launchedOff:e.launchedOff,switchedHere:e.switchedHere});
        const k=e.status==='disabled'&&sv.cls==='pending'?'pending':keyOf(e.status);
        row(e.name).chats.push({id:String(c.id),name:plain(c.name,80),folder:plain(c.folder,80),entry:e,state:{key:k==='unknown'||k==='disabled'?k+':'+sv.word:k,rank:RANK.indexOf(k),word:sv.word,icon:sv.icon,cls:sv.cls}});
      }
    }
    for(const n of Array.isArray(configured)?configured:[])if(okName(n))row(n);
    let attention=0;
    const out=[...rows.values()].map(r=>{
      const parts=new Map();
      for(const ch of r.chats){const p=parts.get(ch.state.key);if(p)p.n++;else parts.set(ch.state.key,{key:ch.state.key,rank:ch.state.rank,word:ch.state.word,icon:ch.state.icon,cls:ch.state.cls,n:1});}
      const list=[...parts.values()].sort((x,y)=>x.rank-y.rank||(x.word<y.word?-1:x.word>y.word?1:0));
      const top=list[0]||Object.assign({rank:RANK.indexOf('none')},NONE);
      const att=list.some(p=>p.key==='failed'||p.key==='needs-auth');
      return {name:r.name,chats:r.chats,parts:list.map(p=>({key:p.key,word:p.word,icon:p.icon,cls:p.cls,n:p.n})),
        summary:list.length?list.map(p=>p.word+' in '+p.n+' chat'+(p.n===1?'':'s')).join(' \u00b7 '):NONE.word,icon:top.icon,cls:top.cls,attention:att};
    });
    out.sort((x,y)=>(y.attention-x.attention)||((y.chats.length>0)-(x.chats.length>0))||(x.name<y.name?-1:x.name>y.name?1:0));
    const servers=out.slice(0,MAX_SERVERS);
    for(const r of servers)if(r.attention)attention++;
    return {servers,attention,chats};
  }
  return {stateOf,offBy,iconSvg,hintFor,signInHint,plain,aggregate,RANK:RANK.slice(),ICON_NAMES:Object.keys(ICONS)};
})());
