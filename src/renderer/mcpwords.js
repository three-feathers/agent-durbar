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
  /* control characters and the bidi/format marks (U+200E/F, U+202A-202E, U+2066-2069, U+FEFF) are flattened: a name can never reorder
     the text around it (review on PR #630) */
  const plain=(t,n)=>{const s=String(t==null?'':t).slice(0,n+160).replace(/[\u0000-\u001f\u007f-\u009f\u200e\u200f\u2028-\u202e\u2066-\u2069\ufeff]+/g,' ').trim();return s.length>n?s.slice(0,n-1)+'\u2026':s;};
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
  /* Spec 058 FR-201: the suggested fix per reason key, fixed text; Agent Durbar never runs it (the person presses it where it is).
     ctx = {file} (a list's file label, `~/...`, for `config`). Unknown keys get the `unknown` fix. */
  const FIXES={
    'auth':'Sign in again: Show opens the chat’s MCP list, with Sign in (or the steps to sign in from a terminal).',
    'not-found':'Install the command, or put its full path in the server’s entry. Then restart the server, or start a new chat.',
    'policy':'Your organization’s sign-in rules refused it, usually a managed-device check. Sign in again using a browser your organization allows, or ask your administrator.',
    'refused':'Check the server’s address or port and that the server is running; another program may use the port. Then press Restart.',
    'crashed':'Open Details for the server’s own error, fix its command or settings, then press Restart.',
    'timeout':'Press Restart. If it times out again, check your network or how long the server takes to start.',
    'permission':'Allow the command to run (its file permissions), then press Restart.',
    'disconnected':'Press Restart, and check that the server still runs or can be reached.',
    'unknown':'Open Details or Copy diagnostics to see what the agent app reported.',
    /* spec 058 FR-232 (issue 1621): a 403 from a server that sends its own token; Sign in cannot change a header */
    'token':'The server refused the token. Check the header or its variable; Sign in does not change it.'
  };
  /* FR-006 hints; since FR-201 (2026-11-03, one wording per failure kind) the fix text of the strip, so the chat dialog, Settings and the
     launch strip say the same. `config` stays its own: a wrong entry, not an unreadable list. */
  const CLASS_HINT={
    'not-found':FIXES['not-found'],
    'timeout':FIXES.timeout,
    'exited':FIXES.crashed,
    'config':'The server\'s settings look wrong. Check them in Settings or the folder\'s extras.',
    'permission':FIXES.permission,
    'refused':FIXES.refused,
    'disconnected':FIXES.disconnected
  };

  const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
  /* Spec 058 FR-006 / FR-090: the one text classifier, shared by the hint and the reason (they never disagree). Reads the already-masked
     text, cut first (linear on hostile input); returns a class word or '' (nothing guessed). */
  const TEXT_RULES=[
    /* first: an auth refusal often also says "terminated" or "closed" (`SSE stream terminated: 401`), and it is not a crash (review on PR #630) */
    [/\b40[13]\b|unauthori[sz]ed|forbidden/i,'auth'],
    [/\bENOENT\b|command not found|is not recognized|no such file or directory/i,'not-found'],
    [/\bEACCES\b|permission denied/i,'permission'],
    [/\bETIMEDOUT\b|timed out|timeout/i,'timeout'],
    [/\bECONNREFUSED\b|connection refused|\bENOTFOUND\b|\bEAI_AGAIN\b|getaddrinfo|host not found|could not resolve/i,'refused'],
    [/exited|crashed|terminated|killed|\bSIGSEGV\b|\bSIGKILL\b|exit code/i,'exited'],
    [/invalid (config|configuration)|configuration error|misconfigured/i,'config']
  ];
  function textClass(t){const s=String(t==null?'':t).slice(0,2000);for(const [re,c] of TEXT_RULES)if(re.test(s))return c;return '';}
  /* Spec 058 FR-232 (issue 1621): the refused-token words, with the `${NAME}` variables main found unset in Durbar's own environment
     (names only: main never sends a value, and the names are checked again here with main's own rule, `envVarName` of the compiled
     src/shared/redact.ts: the page's `exports` (redact.js loads after this file, so it is read at call time), or redact.js beside the
     renderer folder in the built tree; tests of the source tree hand it in with `useShared`. No rule found: no name is shown (fail closed). */
  let SHARED=null;
  const useShared=m=>{if(!m||typeof m.envVarName!=='function')return false;SHARED=m;return true;};
  const varNameRule=()=>{
    if(SHARED)return SHARED.envVarName;
    try{const m=typeof module==='object'&&module.exports?require('../shared/redact.js'):(typeof self!=='undefined'?self.exports:null);if(m&&typeof m.envVarName==='function')return m.envVarName;}catch(e){}
    return null;
  };
  function tokenHint(vars){
    const ok=varNameRule();
    const v=ok?(Array.isArray(vars)?vars:[]).filter(n=>typeof n==='string'&&ok(n)===true).slice(0,3):[];
    if(!v.length)return FIXES.token;
    const list=v.length===1?v[0]:v.slice(0,-1).join(', ')+' and '+v[v.length-1];
    return FIXES.token+' Agent Durbar does not see '+list+': set '+(v.length===1?'it':'them')+' where Agent Durbar starts, then open the app again.';
  }
  function signInHint(app){return 'This server needs you to sign in. '+(app?app:'Your agent app')+' keeps the sign-in; Agent Durbar never sees it.';}
  function hintFor(o){
    const status=o&&o.status, cls=o&&o.errorClass, app=o&&o.app?String(o.app):'';
    if(status==='disabled'&&o.by==='start')return 'It was off when this session started. Use Restart session with these servers to start it.';
    if(status==='disabled'&&o.by==='app')return 'Turn it on in '+(app?plain(app,40)+'’s own':'the agent app’s own')+' MCP settings, then restart the session. Agent Durbar cannot switch it on here.';
    if(status==='needs-auth'||(status==='failed'&&cls==='auth'))return signInHint(app);
    if(status!=='failed')return '';
    if(o.tokenRefused===true)return tokenHint(o.tokenVars); /* FR-232: main decided (a 403 on a token server it knows) */
    const c=typeof cls==='string'&&own(CLASS_HINT,cls)?cls:textClass(o&&o.error);
    if(c==='auth')return signInHint(app);
    return c?CLASS_HINT[c]:'';
  }
  /* Spec 058 FR-187/FR-188 (issue #779 A): a Running server whose last tool call failed with a refused sign-in or an organization access
     policy. `cls` is main's class word (`auth` | `policy`); anything else says nothing. The words are fixed here: no vendor text, claims, IDs or
     e-mail address can reach them. */
  const CALL_WORDS={'policy':'last call blocked by your organization\u2019s access policy','auth':'last call needs sign-in'};
  const callWord=cls=>typeof cls==='string'&&own(CALL_WORDS,cls)?CALL_WORDS[cls]:'';
  function callHint(cls,app){
    if(cls==='policy')return 'Your organization\u2019s access policy refused the server\u2019s last call (usually a managed-device check). Sign in again using a browser your organization allows, or ask your administrator. Agent Durbar cannot change the policy.';
    if(cls==='auth')return 'The server refused its last call for a missing sign-in. '+(app?plain(app,40):'Your agent app')+' keeps the sign-in; sign in again to use its tools.';
    return '';
  }
  /* Spec 058 FR-090 (issue 603): one plain reason for a failed or needs-sign-in server, else null. Order: sign-in; the adapter's class
     (FR-091); the masked text (the hint's rules); "Disconnected later" when it was seen Running first (FR-092); otherwise "reason unknown".
     `x` = an `agents:mcp` entry: {status, errorClass, error (masked), afterRunning}. */
  const REASONS={'auth':'Refused: needs sign-in','token':'Refused: token not accepted','not-found':'Not installed (command not found)','crashed':'Crashed on start','disconnected':'Disconnected later',
    'timeout':'Timed out','refused':'Refused the connection','permission':'Permission denied','config':'Settings look wrong','unknown':'Failed (reason unknown)'};
  const REASON_CLASSES=['not-found','exited','disconnected','timeout','refused','permission','config'];
  function reasonOf(x){
    if(!x||typeof x!=='object')return null;
    const st=x.status, cls=typeof x.errorClass==='string'?x.errorClass:'';
    if(st==='needs-auth'||(st==='failed'&&cls==='auth'))return {key:'auth',word:REASONS.auth};
    if(st!=='failed')return null;
    if(x.tokenRefused===true)return {key:'token',word:REASONS.token}; /* FR-232 */
    let c=REASON_CLASSES.indexOf(cls)>=0?cls:textClass(x.error);
    if(c==='auth')return {key:'auth',word:REASONS.auth};
    if(c==='exited')c=x.afterRunning===true?'disconnected':'crashed';
    if(!c)c=x.afterRunning===true?'disconnected':'unknown';
    return {key:c,word:REASONS[c]};
  }
  /* FR-092: "at 14:02" (local), "on 2026-10-22 at 14:02" when not today; '' for no usable time. `now` is injectable for tests. */
  function whenText(since,now){
    if(typeof since!=='number'||!isFinite(since)||since<=0||since>8.64e15)return '';
    const d=new Date(since), n=new Date(typeof now==='number'&&isFinite(now)?now:Date.now());
    const p=v=>String(v).padStart(2,'0'), hm=p(d.getHours())+':'+p(d.getMinutes());
    const same=d.getFullYear()===n.getFullYear()&&d.getMonth()===n.getMonth()&&d.getDate()===n.getDate();
    return same?'at '+hm:'on '+d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate())+' at '+hm;
  }
  /* Spec 058 FR-221: "Renewed 12:40" (local; with the date when not today) for a connected server Durbar renewed in the background; '' for no usable time. */
  function renewedWord(at,now){
    const w=whenText(at,now);
    return w?'Renewed '+w.replace(/^at /,'').replace(/^on /,'').replace(' at ',' '):'';
  }
  /* FR-093: the Copy diagnostics text, from the reply only (main masked the error, FR-005). Each value is masked by `redact` (the shared
     masking, the same code as main) BEFORE it is cut and flattened, so no head of a token survives a cut; then the whole text is masked
     again. The time is UTC only: with a local time next to it the text would give away the user's time zone. No folder, path, agent name
     or environment value. Fails closed: no redact, a throw or a non-string result gives ''. o = {server, entry, app, appVersion}. */
  function diagnostics(o,redact){
    if(typeof redact!=='function')return '';
    try{
      const m=(v,n)=>{const r=redact(String(v==null?'':v));if(typeof r!=='string')throw new Error('mask');return plain(r,n);};
      const e=o&&o.entry&&typeof o.entry==='object'?o.entry:{};
      const rs=reasonOf(e), ok=whenText(e.since,e.since)!=='';
      const lines=[
        'Agent Durbar: MCP server diagnostics',
        'Server: '+m(o&&o.server,200),
        'State: '+stateOf(e.status).word,
        'Reason: '+(rs?rs.word:'none'),
        'When (UTC): '+(ok?new Date(e.since).toISOString():'not known'),
        'Transport: '+(e.transport?m(e.transport,60):'not reported'),
        'Agent app: '+(o&&o.app?m(o.app,60):'not known')+(o&&o.appVersion?' '+m(o.appVersion,40):' (version not known)'),
        'Error (masked): '+(e.error?m(e.error,400):'none reported')
      ];
      const out=redact(lines.join('\n'));
      return typeof out==='string'?out:'';
    }catch(err){return '';}
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
  function fixFor(key,ctx){
    if(key==='config'){const f=ctx&&ctx.file?plain(ctx.file,120):'';return 'Fix the entry in '+(f||'the agent app’s MCP list')+'. Agent Durbar reads it again when Settings opens.';}
    if(key==='token')return tokenHint(ctx&&ctx.vars);
    return typeof key==='string'&&own(FIXES,key)?FIXES[key]:FIXES.unknown;
  }
  /* Spec 058 FR-199 part 1: findings from `mcp:globalState` alone (no session): a list that could not be read, and a stdio server whose
     command main did not find (FR-198) that new sessions would start. One finding per server name over the apps' lists.
     Returns [{key, kind:'list', name, where, reason, rkey, fix}]; names and labels are plain text (the caller escapes). */
  function fileFindings(g){
    const out=[];
    if(!g||g.ok!==true||!Array.isArray(g.apps))return out;
    const byName=new Map();
    for(const a of g.apps){
      if(!a||typeof a!=='object')continue;
      const label=plain(a.label||a.app,40), file=plain(a.file,120);
      if(typeof a.error==='string'&&a.error){out.push({key:'list:'+String(a.app),kind:'list',name:label+'’s MCP list',where:file,reason:'Could not be read',rkey:'config',fix:fixFor('config',{file})});continue;}
      const off=new Set(Array.isArray(a.off)?a.off:[]);
      for(const v of Array.isArray(a.servers)?a.servers:[]){
        if(!v||v.missing!==true||!okName(v.name)||off.has(v.name))continue;
        const f=byName.get(v.name);
        if(f){if(!f.apps.includes(label))f.apps.push(label);continue;}
        byName.set(v.name,{key:'cmd:'+v.name,kind:'list',name:plain(v.name,80),apps:[label],reason:REASONS['not-found'],rkey:'not-found',fix:fixFor('not-found')});
      }
    }
    for(const f of byName.values()){f.where=f.apps.join(', ')+(f.apps.length>1?' lists':' list');delete f.apps;out.push(f);}
    return out;
  }
  /* Spec 058 FR-199 part 2: one finding for a running chat's server from its `mcp` report entry (FR-090's reason), or for a failed tool
     call with the `policy` word (FR-193); null when the entry needs nothing. chat = {id, name, app}. */
  function chatFinding(x,chat,policy){
    if(!x||!okName(x.name)||!chat)return null;
    const r=policy===true?{key:'policy',word:'Blocked by your organization’s access policy'}:reasonOf(x);
    if(!r)return null;
    return {key:(policy===true?'policy:':'chat:')+JSON.stringify([String(chat.id),x.name]),kind:'chat',chatId:String(chat.id),name:plain(x.name,80),where:plain(chat.name,80)+(chat.app?' ('+plain(chat.app,40)+')':''),reason:r.word,rkey:r.key,fix:fixFor(r.key,r.key==='token'?{vars:x.tokenVars}:undefined)};
  }
  /* Spec 058 FR-232: the strip learns of a refused token from main's `agents:mcp` reply (an `mcp` event has no entry to judge by): a chat's
     `auth` finding of a server main marked `tokenRefused` becomes the token finding. Returns true when it changed. */
  function launchToken(items,reply,chat){
    if(!(items instanceof Map)||!reply||!Array.isArray(reply.servers)||!chat)return false;
    let ch=false;
    for(const x of reply.servers){
      if(!x||x.tokenRefused!==true||x.status!=='failed'||!okName(x.name))continue;
      const k='chat:'+JSON.stringify([String(chat.id),x.name]), f=items.get(k);
      if(!f||f.rkey!=='auth')continue;
      items.set(k,chatFinding(x,chat));ch=true;
    }
    return ch;
  }
  /* Spec 058 FR-199 part 2: the 10-minute window, on a monotonic clock (`performance.now()` in the page); a clock that went back, or a bad
     value, counts as outside (nothing new is added). */
  const LAUNCH_MS=10*60*1000;
  function launchYoung(t0,now){return typeof t0==='number'&&typeof now==='number'&&isFinite(t0)&&isFinite(now)&&now>=t0&&now-t0<=LAUNCH_MS;}
  /* One event of a running chat against the strip's findings (a Map key -> finding, changed in place); returns true when it changed.
     A status finding (`chat:` key) follows the server's reports: Failed / Needs sign-in set it (only while `young`), anything else drops it.
     A policy finding (`policy:` key, FR-193) is not a server state: reports never touch it; a later successful call of that server drops it. */
  function launchUpdate(items,e,chat,young){
    if(!(items instanceof Map)||!e||!chat)return false;
    let ch=false;
    const put=f=>{if(f&&young===true){items.set(f.key,f);ch=true;}};
    const drop=k=>{if(items.delete(k))ch=true;};
    if(e.type==='mcp'){
      for(const x of Array.isArray(e.servers)?e.servers:[]){
        if(!x||!okName(x.name))continue;
        if(x.status==='failed'||x.status==='needs-auth')put(chatFinding(x,chat));
        else drop('chat:'+JSON.stringify([String(chat.id),x.name]));
      }
    }else if(e.type==='toolCall'&&typeof e.mcpServer==='string'){
      if(e.phase==='failed'&&e.mcpCall==='policy')put(chatFinding({name:e.mcpServer},chat,true));
      else if(e.phase==='complete')drop('policy:'+JSON.stringify([String(chat.id),e.mcpServer]));
    }
    return ch;
  }
  /* Spec 058 FR-196: which chats "Restart where it failed" restarts. `chats` = an aggregate row's chats; `usable(c)` = the window can reach
     that chat. Failed rows only; a sign-in failure is skipped ('auth', a restart does not fix it), and so is an app without a per-server
     restart ('session', e.g. Codex). Returns {targets, failed (all failed rows), skipped:[{chat, why}]}. */
  function restartTargets(chats,usable){
    const failed=(Array.isArray(chats)?chats:[]).filter(c=>c&&c.entry&&c.entry.status==='failed');
    const targets=[],skipped=[];
    for(const c of failed){
      const r=reasonOf(c.entry);
      if(r&&r.key==='auth')skipped.push({chat:c,why:'auth'});
      else if(c.entry.canRestart!==true)skipped.push({chat:c,why:'session'});
      else if(typeof usable!=='function'||usable(c))targets.push(c);
    }
    return {targets,failed,skipped};
  }
  /* spec 058 FR-229 (issue 1229): the one text for a chat's Sign in press that could not start a sign-in. Never empty: `row` is the dialog's row for the
     server (or none), `err` an error text of the call (already masked by main). The wording is the dialog's own ("Could not start the sign-in: ..."). */
  function signInPressNote(name,row,err,live){
    const n=plain(name,64)||'this server';
    let why=typeof err==='string'&&err.trim()?plain(err,160):'';
    if(!why){
      if(live===false)why='The chat\u2019s session is not running. Send a message to start it, then sign in.';
      else if(!row)why=n+' is not in this chat\u2019s MCP list.';
      else if(row.signIn)why='A sign-in is already open: press Open sign-in page on its row.';
      else if(row.canSignInAgain===true)why='This row offers Sign in again\u2026 instead: press it on the row.';
      else if(row.canSignIn!==true)why='This app cannot start the sign-in from here. Open the row for the steps.';
      else why='Unknown error.';
    }
    return 'Could not start the sign-in for '+n+': '+why;
  }
  return {signInPressNote,stateOf,offBy,iconSvg,hintFor,callWord,callHint,signInHint,plain,aggregate,reasonOf,whenText,renewedWord,diagnostics,fixFor,fileFindings,chatFinding,launchYoung,launchUpdate,launchToken,tokenHint,useShared,textClass,restartTargets,LAUNCH_MS,RANK:RANK.slice(),ICON_NAMES:Object.keys(ICONS)};
})());
