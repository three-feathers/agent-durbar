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
      approvedMayLeave:own('approvedMayLeave')===true,writes:own('writes')==='folders'?'folders':'none',verified:own('verified')===true,reason:typeof own('reason')==='string'?own('reason').slice(0,200):'',
      leftOut:Array.isArray(own('leftOut'))?own('leftOut').filter(x=>typeof x==='string').slice(0,10).map(x=>x.slice(0,200)):[],leftOutMore:Number.isInteger(own('leftOutMore'))&&own('leftOutMore')>0?own('leftOutMore'):0};
  }
  /* FR-009: the chip segment after the mode name; '' = nothing shown (Allow all with the app default, or no state) */
  function chipWord(s0){
    const s=clean(s0); if(!s)return '';
    if(s.state==='unknown')return 'Sandbox: checking';
    if(s.state==='off')return 'Not sandboxed';
    if(s.managed)return 'Sandboxed (managed)';
    if(s.untilNewSession)return 'Sandboxed (until a new session)';
    /* FR-021b (K15, #755): Copilot in Ask first (it covers MCP servers): an approved command was seen writing outside the folder, so no bare 'Sandboxed' */
    if(s.approvedMayLeave&&s.covers.includes('mcp'))return 'Sandboxed (partial)';
    return 'Sandboxed';
  }
  function mechName(m,app){return m==='seatbelt'?'the macOS sandbox':m==='bubblewrap'?'bubblewrap':m==='processcontainer'?'Windows ProcessContainer':'the '+(app||'app')+' sandbox';}
  /* FR-010: exactly what is covered, per app (from `covers`), and how far it was checked */
  function coverage(s,app){
    const where=mechName(s.mechanism,app), w=s.writes==='folders'?'this folder':'none';
    if(s.covers.includes('files'))return 'Commands and file changes run in '+where+' (writes: none, network: off).'+(s.approvedMayLeave?' If you approve a command, '+(app||'the app')+' may run it outside the sandbox.':'');
    /* FR-021a (K15): in Ask first an approved command wrote outside the folder inside Copilot's own sandbox (Linux, 2026-10-25), so no 'this folder'
       claim; its effective policy had one read-write rule Durbar did not send, which may exist in Read-only too (review on PR 753), so no bare 'none' */
    if(s.covers.includes('mcp'))return 'Shell commands and MCP servers run in '+where+' (writes: '+(s.approvedMayLeave?'not only this folder':w==='none'?'none asked; Copilot may add one':w)+', network: off). File reads and edits are checked by Durbar.'+(s.approvedMayLeave?' An approved command could write outside the folder ('+(app||'the app')+', seen on Linux, 2026-10-25).':'');
    return 'Shell commands run in '+where+' (writes: '+w+', network: off). MCP servers, hooks, the status line, file reads and edits are outside it.';
  }
  /* the tooltip (at most 300 characters: a data tooltip); `mask` is the window's masking, applied to the reason once more */
  function tooltip(s0,app,mask){const t=tip(s0,app,mask);return t.length>300?t.slice(0,299).replace(/\s+\S*$/,'')+'\u2026':t;}
  /* the mode menu note: the tooltip and the details that do not fit in it (FR-004: what PATH grants) */
  /* review round 4 on PR 733: the state names session folders the floor left out (credential folders): short in the tooltip, in full here */
  const leftOut=(s,mask)=>{ /* review round 6: a bounded list field, each entry masked again; a count for the rest */
    if(s.state==='off'||!s.leftOut.length||typeof mask!=='function')return '';
    const names=s.leftOut.map(x=>String(mask(x)||'')).filter(Boolean);
    return names.length?'Left out of the sandbox: '+names.join('; ')+(s.leftOutMore?'; and '+s.leftOutMore+' more':'')+'.':'';};
  function details(s0,app,mask){const s=clean(s0);if(!s)return '';const l=leftOut(s,mask),t=tip(s0,app,mask).replace('Some session folders are left out (the mode menu names them). ','');return (l?l+' ':'')+(s.state!=='off'&&s.covers.includes('mcp')?t+' Sandboxed commands can read your PATH folders, also those in your home folder.':t);}
  function tip(s0,app,mask){
    const s=clean(s0); if(!s)return '';
    const reason=s.reason&&typeof mask==='function'?String(mask(s.reason)||''):'';
    if(s.state==='off')return (reason?reason.replace(/[.\s]+$/,'')+'.':'The OS sandbox is not in force.')+(/own checks still apply/.test(reason)?'':' Durbar’s own checks still apply.');
    const parts=[];
    if(s.state==='unknown')parts.push('Checked when '+(app||'the app')+' starts.');
    if(s.managed)parts.push('Your organization keeps '+(app||'the app')+'’s sandbox on.');
    if(s.untilNewSession)parts.push('Set earlier in this session; it stays until a new session.');
    if(leftOut(s,mask))parts.push('Some session folders are left out (the mode menu names them).');
    parts.push(coverage(s,app));
    if(!s.verified)parts.push(NOT_VERIFIED);
    return parts.join(' ');
  }
  /* FR-022/FR-022a (issue 806): *Restart without the sandbox* is offered only for a floor kept from an earlier mode (untilNewSession), in Allow all,
     not held by the organization (managed), by an app that can resume. Pure and fail closed: a malformed state or input is false. */
  function canRestartWithoutSandbox(o){
    if(!o||typeof o!=='object')return false;
    const s=clean(o.sandbox); if(!s)return false;
    return o.mode==='allow'&&s.state==='on'&&s.untilNewSession&&!s.managed&&!!(o.caps&&typeof o.caps==='object'&&o.caps.resume===true);
  }
  /* FR-022: the tooltip of the action. Since FR-022c (K16 cleared in place on Linux, 2026-10-28) the action is the fallback when the app did not
     confirm the lowering, so it says that, not a vendor fact; at most 300 characters */
  function restartTip(s0,app){
    const s=clean(s0), a=app||'the app';
    const t=a+' did not confirm turning its sandbox off in this running session, so it stays until a new one. Restart keeps this conversation and starts a new session in Allow all.'+(s&&s.verified?'':' '+NOT_VERIFIED);
    return t.length>300?t.slice(0,299).replace(/\s+\S*$/,'')+'\u2026':t;
  }
  /* FR-022c (replaces FR-022e's sentence, decision Q4): the Allow all dialog's extra sentence, for a floor that the switch to Allow all turns off in the
     running session. The app whose sandbox also covers MCP servers is the one whose floor is lowered at the switch (FR-013, the same neutral test as
     FR-021b's chip word); '' for every other state. */
  function allowAllNote(s0,app){
    const s=clean(s0); if(!s||s.state!=='on'||s.managed||s.untilNewSession||!s.covers.includes('mcp'))return '';
    return (app||'The app')+'’s OS sandbox is also turned off for this session.';
  }
  /* FR-012: the Settings > Agent apps line (text) */
  function hostLine(v){
    if(!v||typeof v!=='object')return '';
    if(v.available===true)return 'OS sandbox: available'+(MECHS.includes(v.mechanism)&&v.mechanism!=='vendor'?' ('+mechName(v.mechanism).replace(/^the /,'')+')':'');
    return 'OS sandbox: not available'+(typeof v.reason==='string'&&v.reason?': '+v.reason.slice(0,200):'');
  }
  return {clean,chipWord,tooltip,details,hostLine,canRestartWithoutSandbox,restartTip,allowAllNote,NOT_VERIFIED};
})());
