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
  const tokenText=t=>{const s=String(t).replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g,' ').trim();return s.length>40?s.slice(0,39)+'…':s;};
  /* `status` is the runtime's token (missing/empty = no state yet). Returns {word, icon, cls}; an unknown token reads "Unknown state: <token>"
     (plain text, the caller escapes) and gets the neutral class. */
  function stateOf(status){
    if(status===undefined||status===null||status==='')return Object.assign({},NONE);
    if(typeof status==='string'&&Object.prototype.hasOwnProperty.call(STATES,status))return Object.assign({},STATES[status]);
    const t=tokenText(typeof status==='string'?status:'?');
    return {word:t?'Unknown state: '+t:'Unknown state',icon:'dash',cls:'unknown'};
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
  return {stateOf,iconSvg,hintFor,signInHint,ICON_NAMES:Object.keys(ICONS)};
})());
