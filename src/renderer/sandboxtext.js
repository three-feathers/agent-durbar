/* Spec 087 FR-009/FR-010/FR-012: the words for an agent app's OS sandbox, from the normalized SandboxState (no vendor name or key).
   Pure: no DOM. In the page: window.DurbarSandboxText; in Node: module.exports. Text only (the caller escapes it). The state's reason
   was masked and cut in main; `mask` masks it again before it is shown (fail closed: no mask, no reason). */
(function(root, api){
  if(typeof module==='object'&&module.exports) module.exports=api; else root.DurbarSandboxText=api;
})(typeof self!=='undefined'?self:this, (function(){
  'use strict';
  const STATES=['on','off','unknown'], MECHS=['seatbelt','bubblewrap','processcontainer','vendor'], COVERS=['shell','mcp','files'];
  const NOT_VERIFIED='Requested; not verified on a real session.';
  /* a state the window may show, or null (own known fields only; anything malformed: nothing is shown, constitution II) */
  function clean(s){
    if(!s||typeof s!=='object'||Array.isArray(s))return null;
    const own=k=>Object.prototype.hasOwnProperty.call(s,k)?s[k]:undefined;
    if(!STATES.includes(own('state'))||!Array.isArray(own('covers'))||own('covers').some(c=>!COVERS.includes(c)))return null;
    if(own('mechanism')!==undefined&&!MECHS.includes(own('mechanism')))return null;
    return {state:own('state'),mechanism:own('mechanism'),managed:own('managed')===true,untilNewSession:own('untilNewSession')===true,covers:own('covers').slice(0,3),
      approvedMayLeave:own('approvedMayLeave')===true,writes:own('writes')==='folders'?'folders':'none',verified:own('verified')===true,reason:typeof own('reason')==='string'?own('reason').slice(0,200):''};
  }
  /* FR-009: the chip segment after the mode name; '' = nothing shown (Allow all with the app default, or no state) */
  function chipWord(s0){
    const s=clean(s0); if(!s)return '';
    if(s.state==='unknown')return 'Sandbox: checking';
    if(s.state==='off')return 'Not sandboxed';
    if(s.managed)return 'Sandboxed (managed)';
    if(s.untilNewSession)return 'Sandboxed (until a new session)';
    return 'Sandboxed';
  }
  function mechName(m,app){return m==='seatbelt'?'the macOS sandbox':m==='bubblewrap'?'bubblewrap':m==='processcontainer'?'Windows ProcessContainer':'the '+(app||'app')+' sandbox';}
  /* FR-010: exactly what is covered, per app (from `covers`), and how far it was checked */
  function coverage(s,app){
    const where=mechName(s.mechanism,app), w=s.writes==='folders'?'this folder':'none';
    if(s.covers.includes('files'))return 'Commands and file changes run in '+where+' (writes: none, network: off).'+(s.approvedMayLeave?' If you approve a command, '+(app||'the app')+' may run it outside the sandbox.':'');
    if(s.covers.includes('mcp'))return 'Shell commands and MCP servers run in '+where+' (writes: '+w+', network: off); they can read your PATH folders, also those in your home folder. File reads and edits are checked by Durbar.';
    return 'Shell commands run in '+where+' (writes: '+w+', network: off). MCP servers, file reads and edits are checked by Durbar, not the OS.';
  }
  /* the tooltip (and the mode menu note); `mask` is the window's masking, applied to the reason once more */
  function tooltip(s0,app,mask){
    const s=clean(s0); if(!s)return '';
    const reason=s.reason&&typeof mask==='function'?String(mask(s.reason)||''):'';
    if(s.state==='off')return (reason?reason.replace(/[.\s]+$/,'')+'.':'The OS sandbox is not in force.')+(/own checks still apply/.test(reason)?'':' Durbar’s own checks still apply.');
    const parts=[];
    if(s.state==='unknown')parts.push('Sandbox: checking. '+(app||'The app')+' confirms its sandbox when it starts.');
    if(s.managed)parts.push('Your organization keeps '+(app||'the app')+'’s sandbox on.');
    if(s.untilNewSession)parts.push('The sandbox set earlier in this session stays until a new session.');
    parts.push(coverage(s,app));
    if(!s.verified)parts.push(NOT_VERIFIED);
    return parts.join(' ');
  }
  /* FR-012: the Settings > Agent apps line (text) */
  function hostLine(v){
    if(!v||typeof v!=='object')return '';
    if(v.available===true)return 'OS sandbox: available'+(MECHS.includes(v.mechanism)&&v.mechanism!=='vendor'?' ('+mechName(v.mechanism).replace(/^the /,'')+')':'');
    return 'OS sandbox: not available'+(typeof v.reason==='string'&&v.reason?': '+v.reason.slice(0,200):'');
  }
  return {clean,chipWord,tooltip,hostLine,NOT_VERIFIED};
})());
