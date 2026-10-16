/* Full-page screens opened from the top bar: Settings (global MCP servers) and Tools (tool usage, models, context window). Spec 019.
   Plain script; app.js calls DurbarScreens.init(ctx) once. No secret value ever reaches this file: the bridge sends key names and "set" flags. */
(function(){
  'use strict';
  const S=window.DurbarStats;
  let X=null; /* ctx from app.js: {bridge, stats, esc, toast, agents(), staticLimit(a), openAgent(id), sim} */
  let cur=null; /* {kind:'settings'|'tools', ...} */
  const $=id=>document.getElementById(id);
  const esc=s=>X.esc(s);
  const root=()=>$('screen');
  const fmt=n=>S.fmtTokens(n);
  const cap=(s,n)=>{s=String(s==null?'':s);return s.length>n?s.slice(0,n-1)+'…':s;};

  /* ---------------- shared: frame, dialogs ---------------- */
  function open(kind,opts){
    cur=Object.assign({kind},opts||{});
    document.body.classList.add('screen-open');
    root().hidden=false;
    paint(true);
    ['toolsBtn','settingsBtn'].forEach(id=>{const b=$(id);if(b)b.setAttribute('aria-pressed',String((id==='toolsBtn'&&kind==='tools')||(id==='settingsBtn'&&kind==='settings')));});
  }
  function close(){
    if(!cur)return;
    cur=null;root().hidden=true;root().innerHTML='';
    document.body.classList.remove('screen-open');
    ['toolsBtn','settingsBtn'].forEach(id=>{const b=$(id);if(b)b.setAttribute('aria-pressed','false');});
  }
  const isOpen=()=>!!cur;
  function paint(focus){
    if(!cur)return;
    if(cur.kind==='tools')paintTools(focus);else paintSettings(focus);
  }
  /* modal: body is an element or html; buttons [{label,value,cls}]; resolves value (or null when dismissed). `validate(root)` may return an error text (keeps it open). */
  function dialog({title,html,buttons,wide,validate,onOpen}){
    return new Promise(resolve=>{
      const old=document.getElementById('scrDlg');if(old)old.remove();
      const d=document.createElement('div');d.id='scrDlg';d.className='dlg-ov';
      d.innerHTML=`<div class="dlg${wide?' wide':''}" role="dialog" aria-modal="true" aria-labelledby="scrDlgT"><h3 id="scrDlgT"></h3><div class="dbody">${html||''}</div><p class="derr" id="scrDlgErr" role="alert" hidden></p><div class="dbtn"></div></div>`;
      d.querySelector('#scrDlgT').textContent=title;
      const row=d.querySelector('.dbtn');
      const done=v=>{d.remove();resolve(v);};
      buttons.forEach(b=>{const el=document.createElement('button');el.type='button';el.className='btn'+(b.cls?' '+b.cls:'');el.textContent=b.label;
        el.onclick=()=>{if(b.value!==null&&validate){const err=validate(d);if(err){const e=d.querySelector('#scrDlgErr');e.textContent=err;e.hidden=false;return;}}done(b.value===null?null:{value:b.value,root:d});};row.appendChild(el);});
      d.addEventListener('click',e=>{if(e.target===d)done(null);});
      d.addEventListener('keydown',e=>{if(e.key==='Escape'){e.stopPropagation();done(null);}});
      document.body.appendChild(d);
      if(onOpen)onOpen(d);
      const first=d.querySelector('input,select,textarea')||row.querySelector('.primary')||row.lastElementChild;
      if(first)first.focus();
      d._close=()=>done(null);
    });
  }
  const sw=(on,label,attrs)=>`<button class="swt${on?' on':''}" type="button" role="switch" aria-checked="${on?'true':'false'}" aria-label="${esc(label)}" ${attrs||''}><i></i></button>`;

  /* ---------------- Settings: MCP servers ---------------- */
  let mcp=null; /* last McpState */
  async function loadMcp(){
    if(!X.bridge.mcpState){mcp=null;return;}
    try{mcp=await X.bridge.mcpState();}catch(e){mcp=null;}
  }
  async function paintSettings(focus){
    const first=!mcp;
    if(first)root().innerHTML=head('Settings')+'<div class="scr-body"><p class="scr-note">Loading…</p></div>';
    await loadMcp();
    if(!cur||cur.kind!=='settings')return;
    const r=root();
    if(!mcp){r.innerHTML=head('Settings')+'<div class="scr-body"><p class="scr-note">MCP settings are not available in this build.</p></div>';wireHead();return;}
    const cmd=v=>v.transport==='stdio'?[v.command].concat(v.args||[]).join(' '):v.url;
    const srv=mcp.servers.map(v=>`<li class="srv" data-name="${esc(v.name)}">
      <div class="srv-main"><div class="srv-top"><b class="srv-name">${esc(v.name)}</b><span class="mtag">${esc(v.transport)}</span>
        ${v.enabled&&!v.trusted?'<span class="mtag warn">needs trust</span>':''}${v.needsSecrets?'<span class="mtag warn" title="Secret values are not available. Edit the server and enter them again.">needs secrets</span>':''}${v.workingDirectory?`<span class="mtag" title="${esc(v.workingDirectory)}">cwd</span>`:''}</div>
        <code class="srv-cmd" title="${esc(cmd(v))}">${esc(cap(cmd(v),180))}</code>
        ${v.env.concat(v.headers).length?`<div class="srv-secrets" aria-label="Secret values (masked)">${v.env.map(s=>secretChip('env',s)).join('')}${v.headers.map(s=>secretChip('header',s)).join('')}</div>`:''}
      </div>
      <div class="srv-act">${sw(v.enabled&&v.trusted,(v.enabled?'Disable ':'Enable ')+v.name,'data-act="toggle"')}<button class="btn sm" type="button" data-act="edit">Edit</button><button class="btn sm danger" type="button" data-act="remove">Remove</button></div></li>`).join('');
    const amb=mcp.ambient.map(a=>`<li class="srv amb" data-amb="${esc(a.name)}"><div class="srv-main"><div class="srv-top"><b class="srv-name">${esc(a.name)}</b><span class="mtag">${a.origin==='builtin'?'built-in':'~/.copilot/mcp-config.json'}</span>${a.transport?`<span class="mtag">${esc(a.transport)}</span>`:''}</div>
        ${a.command||a.url?`<code class="srv-cmd">${esc(cap(a.transport==='stdio'||a.command?[a.command].concat(a.args||[]).join(' '):a.url,180))}</code>`:''}</div>
      <div class="srv-act">${sw(a.enabled,(a.enabled?'Switch off ':'Switch on ')+a.name+' for new sessions','data-act="amb"')}</div></li>`).join('');
    let app={};
    if(X.bridge.getSettings){try{app=(await X.bridge.getSettings())||{};}catch(e){app={};}}
    const capSec=X.bridge.setDefaultCap?`<section class="scr-sec" aria-labelledby="capH"><h3 id="capH">Credit cap</h3>
        <p class="scr-note">The default cap, in AIU (as the Copilot runtime reports AI credits), given to <b>new</b> sessions. Empty means no cap. Each session can change its own cap from its chat header; a session that reaches its cap stops and asks you. The cap is <b>soft</b>: one model call can go past it, and it is not yet verified against a real account (see spec 011).</p>
        <div class="scr-tools"><label class="capf">Default cap (AIU)<input id="capDef" type="number" min="0.001" step="0.01" placeholder="No cap" value="${app.defaultMaxAiCredits||''}"></label><button class="btn primary" type="button" id="capSave">Save</button><span class="scr-note small" id="capMsg" role="status"></span></div></section>`:'';
    r.innerHTML=head('Settings')+`<div class="scr-body">${capSec}
      <section class="scr-sec" aria-labelledby="mcpH"><h3 id="mcpH">MCP servers</h3>
        <p class="scr-note">MCP servers give agents extra tools. They are set once here and used by <b>every agent</b> that starts afterwards; each agent can switch single servers off from its own header (MCP button).</p>
        <p class="scr-warn" role="note"><b>MCP servers run local commands with your user rights.</b> Only enable servers you trust. You see the exact command before a server is switched on for the first time, and again whenever its command or URL changes. Read-only MCP tools can run without asking even in Read-only mode.</p>
        <p class="scr-note ${mcp.secretsPersist?'ok':'warn'}" role="status">${mcp.secretsPersist?'Secret values (environment variables, headers) are stored encrypted by your operating system and are never shown again, logged or exported.':'<b>No OS-protected secret store is available here.</b> Secret values are kept in memory for this run only and are not saved: you will need to enter them again after a restart. Never put secrets in arguments or URLs.'}</p>
        <div class="scr-tools"><button class="btn primary" type="button" id="mcpAdd">+ Add server</button><button class="btn" type="button" id="mcpImpCopilot" title="Read ~/.copilot/mcp-config.json (read-only)">Import from Copilot CLI</button><button class="btn" type="button" id="mcpImpVs" title="Read the VS Code user mcp.json (read-only)">Import from VS Code</button></div>
        ${mcp.skipped.length?`<p class="scr-note warn" role="status">Not passed to new sessions: ${mcp.skipped.map(s=>'<b>'+esc(s.name)+'</b> ('+esc(s.reason)+')').join('; ')}.</p>`:''}
        ${srv?`<ul class="srvs" id="srvList">${srv}</ul>`:'<p class="scr-empty">No servers yet. Add one, or import what you already use.</p>'}
        <p class="scr-note small">Changes apply to <b>new</b> sessions and to agents that start or resume afterwards. A running session keeps its servers until it ends, or until you switch one in that agent's MCP menu.</p>
      </section>
      <section class="scr-sec" aria-labelledby="ambH"><h3 id="ambH">Also loaded by the Copilot runtime</h3>
        <p class="scr-note">The runtime starts these in every session by itself (your <code>~/.copilot/mcp-config.json</code> and the built-in GitHub server). You cannot edit them here. The switch controls whether new sessions from this app start them.</p>
        <ul class="srvs" id="ambList">${amb}</ul></section></div>`;
    wireHead();
    if($('capSave'))$('capSave').onclick=async()=>{
      const v=parseFloat($('capDef').value),msg=$('capMsg');
      if($('capDef').value.trim()!==''&&!(v>0&&v<=1e6)){msg.textContent='Enter a number above 0, or leave it empty for no cap.';return;}
      const res=await X.bridge.setDefaultCap($('capDef').value.trim()===''?null:Math.round(v*1000)/1000);
      if(X.onSettings)X.onSettings({defaultMaxAiCredits:res&&res.defaultMaxAiCredits});
      msg.textContent=res&&res.defaultMaxAiCredits?'Saved: new sessions start with a cap of '+res.defaultMaxAiCredits+' AIU.':'Saved: new sessions start without a cap.';
    };
    $('mcpAdd').onclick=()=>editServer(null);
    $('mcpImpCopilot').onclick=()=>importFrom('copilot');
    $('mcpImpVs').onclick=()=>importFrom('vscode');
    r.onclick=onSettingsClick;
    if(focus){const h=r.querySelector('h2');if(h){h.tabIndex=-1;h.focus({preventScroll:true});}}
  }
  const secretChip=(kind,s)=>`<span class="sec" title="${kind==='env'?'Environment variable':'Header'}: ${s.set?'value stored, hidden':'no value'}">${esc(s.key)}<i>${s.set?'••••••':'not set'}</i></span>`;
  function head(title){
    const tabs=cur&&cur.kind==='tools'?'':'';
    return `<div class="scr-head"><h2>${esc(title)}</h2>${tabs}<span class="grow"></span><button class="btn" type="button" id="scrClose" title="Close (Esc)">Close</button></div>`;
  }
  function wireHead(){const c=$('scrClose');if(c)c.onclick=close;}

  async function onSettingsClick(e){
    const li=e.target.closest('li.srv');if(!li)return;
    const act=(e.target.closest('[data-act]')||{}).dataset;if(!act)return;
    if(li.dataset.amb){
      if(act.act==='amb'){const sw0=e.target.closest('[data-act]');const on=sw0.getAttribute('aria-checked')!=='true';await X.bridge.mcpSetAmbient(li.dataset.amb,on);X.toast(esc(li.dataset.amb)+(on?' will start in new sessions.':' will not start in new sessions.'),3200);paintSettings();}
      return;
    }
    const name=li.dataset.name,v=mcp.servers.find(x=>x.name===name);if(!v)return;
    if(act.act==='toggle'){const turnOn=!(v.enabled&&v.trusted);await toggleServer(v,turnOn);}
    else if(act.act==='edit')editServer(v);
    else if(act.act==='remove'){
      const r=await dialog({title:'Remove "'+name+'"?',html:'<p class="dsub">The server and its stored secret values are deleted from Agent Durbar. Running sessions keep it until they end.</p>',buttons:[{label:'Cancel',value:null},{label:'Remove',value:'ok',cls:'primary warn'}]});
      if(r){await X.bridge.mcpRemove(name);X.toast('Removed '+esc(name)+'.',2600);paintSettings();}
    }
  }
  async function toggleServer(v,turnOn){
    let r=await X.bridge.mcpSetEnabled(v.name,turnOn,false);
    if(r&&r.needsTrust){
      const t=r.needsTrust;
      const run=t.transport==='stdio'?[t.command].concat(t.args||[]).join(' '):t.url;
      const ok=await dialog({title:'Trust "'+t.name+'"?',wide:true,html:`<p class="dsub"><b>This will run a program on your computer</b> every time a session starts, with your user rights, and give it access to what you pass in its environment. Agents will be able to call its tools${t.transport==='stdio'?'':' (a remote server: requests and your header values go to that URL)'}.</p>
        <p class="dsub">${t.transport==='stdio'?'Command':'URL'}:</p><pre class="trustcmd" tabindex="0">${esc(run)}</pre>${t.workingDirectory?`<p class="dsub">Working directory: <code>${esc(t.workingDirectory)}</code></p>`:''}
        <p class="dsub">Only continue if you know where this comes from. You will be asked again if the command or URL changes.</p>`,
        buttons:[{label:'Cancel',value:null},{label:'Trust and enable',value:'ok',cls:'primary warn'}]});
      if(!ok){paintSettings();return;}
      r=await X.bridge.mcpSetEnabled(v.name,true,true);
    }
    if(!r||!r.ok)X.toast('Could not change the server: '+esc((r&&r.error)||'unknown error'),5000);
    else X.toast(esc(v.name)+(turnOn?' is on for new sessions.':' is off.'),2800);
    paintSettings();
  }

  /* add / edit form */
  function rowHTML(kind,k,existing,set){
    return `<div class="krow" data-kind="${kind}"><input class="k" type="text" spellcheck="false" autocomplete="off" aria-label="${kind==='env'?'Variable name':'Header name'}" placeholder="${kind==='env'?'NAME':'Header-Name'}" value="${esc(k||'')}" data-orig="${existing?esc(k):''}">
      <input class="v" type="password" spellcheck="false" autocomplete="new-password" aria-label="${kind==='env'?'Variable value (secret)':'Header value (secret)'}" placeholder="${existing&&set?'•••••• stored. Leave empty to keep':'value (secret)'}">
      <button class="btn sm" type="button" data-rm aria-label="Remove this row">×</button></div>`;
  }
  async function editServer(v){
    const isNew=!v;
    const t=v?v.transport:'stdio';
    const html=`<form class="mform" id="mForm" autocomplete="off" onsubmit="return false">
      <label>Name<input id="mName" type="text" spellcheck="false" value="${esc(v?v.name:'')}" maxlength="48" placeholder="e.g. playwright"></label>
      <label>Type<select id="mType"><option value="stdio"${t==='stdio'?' selected':''}>Local command (stdio)</option><option value="http"${t==='http'?' selected':''}>Remote (http)</option><option value="sse"${t==='sse'?' selected':''}>Remote (sse, older)</option></select></label>
      <div data-for="stdio"><label>Command<input id="mCmd" type="text" spellcheck="false" value="${esc(v&&v.command||'')}" placeholder="npx"></label>
        <label>Arguments <small>one per line (not secret: they are shown and saved in clear)</small><textarea id="mArgs" rows="3" spellcheck="false" placeholder="@playwright/mcp@latest">${esc((v&&v.args||[]).join('\n'))}</textarea></label>
        <label>Working directory <small>optional, absolute path</small><input id="mCwd" type="text" spellcheck="false" value="${esc(v&&v.workingDirectory||'')}"></label>
        <div class="kv"><div class="kvh">Environment variables <small>values are secrets: masked, stored encrypted</small></div><div id="envRows">${(v?v.env:[]).map(s=>rowHTML('env',s.key,true,s.set)).join('')}</div><button class="btn sm" type="button" data-add="env">+ Variable</button></div></div>
      <div data-for="remote"><label>URL<input id="mUrl" type="text" spellcheck="false" value="${esc(v&&v.url||'')}" placeholder="https://example.com/mcp"></label>
        <div class="kv"><div class="kvh">Headers <small>values are secrets: masked, stored encrypted. No secrets in the URL.</small></div><div id="hdrRows">${(v?v.headers:[]).map(s=>rowHTML('header',s.key,true,s.set)).join('')}</div><button class="btn sm" type="button" data-add="header">+ Header</button></div></div>
      <label>Tool filter <small>optional: tool names separated by commas; empty = all tools</small><input id="mTools" type="text" spellcheck="false" value="${esc((v&&v.tools||[]).filter(x=>x!=='*').join(', '))}"></label>
      ${isNew?'':'<p class="dsub">Changing the command, arguments, working directory, URL or type switches the server off until you trust it again.</p>'}</form>`;
    const sync=d=>{const ty=d.querySelector('#mType').value;d.querySelector('[data-for=stdio]').hidden=ty!=='stdio';d.querySelector('[data-for=remote]').hidden=ty==='stdio';};
    const collect=d=>{
      const ty=d.querySelector('#mType').value;
      const rows=(id,kind)=>[...d.querySelectorAll('#'+id+' .krow')].map(r=>{const k=r.querySelector('.k').value.trim(),val=r.querySelector('.v').value,orig=r.querySelector('.k').dataset.orig;
        return {key:k,value:(orig&&orig===k&&val==='')?undefined:val};}).filter(x=>x.key||x.value);
      const tools=d.querySelector('#mTools').value.split(',').map(s=>s.trim()).filter(Boolean);
      const o={name:d.querySelector('#mName').value.trim(),transport:ty,tools:tools.length?tools:undefined};
      if(ty==='stdio'){o.command=d.querySelector('#mCmd').value.trim();o.args=d.querySelector('#mArgs').value.split('\n').map(s=>s.replace(/\r$/,'')).filter(s=>s.trim()!=='');o.workingDirectory=d.querySelector('#mCwd').value.trim();o.env=rows('envRows','env');}
      else{o.url=d.querySelector('#mUrl').value.trim();o.headers=rows('hdrRows','header');}
      return o;
    };
    let saved=null;
    const r=await dialog({title:isNew?'Add MCP server':'Edit "'+v.name+'"',wide:true,html,buttons:[{label:'Cancel',value:null},{label:isNew?'Add server':'Save',value:'ok',cls:'primary'}],
      onOpen:d=>{sync(d);d.querySelector('#mType').onchange=()=>sync(d);
        d.addEventListener('click',e=>{const add=e.target.closest('[data-add]');if(add){const box=d.querySelector(add.dataset.add==='env'?'#envRows':'#hdrRows');box.insertAdjacentHTML('beforeend',rowHTML(add.dataset.add,'',false,false));box.lastElementChild.querySelector('.k').focus();}
          const rm=e.target.closest('[data-rm]');if(rm)rm.closest('.krow').remove();});},
      validate:d=>{
        const o=collect(d);
        if(!o.name)return 'Give the server a name.';
        if(o.transport==='stdio'&&!o.command)return 'Enter the command to run.';
        if(o.transport!=='stdio'&&!o.url)return 'Enter the URL.';
        return '';}});
    if(!r)return;
    const input=collect(r.root);
    const res=await X.bridge.mcpUpsert(input,v?v.name:undefined);
    if(!res||!res.ok){X.toast('Not saved: '+esc((res&&res.error)||'unknown error'),5600);return editServer2(input,v);}
    X.toast(esc(input.name)+(isNew?' added (off). Switch it on to use it.':' saved.'),3600);
    paintSettings();
  }
  /* reopen after a server-side validation error without losing what was typed (secret values are not kept) */
  function editServer2(input,v){const view=Object.assign({},v||{},{name:input.name,transport:input.transport,command:input.command,args:input.args,workingDirectory:input.workingDirectory,url:input.url,tools:input.tools,env:(v&&v.env)||[],headers:(v&&v.headers)||[]});return editServer(v?view:Object.assign(view,{name:input.name}));}

  async function importFrom(src){
    if(!X.bridge.mcpImportPreview)return;
    const p=await X.bridge.mcpImportPreview(src);
    const label=src==='copilot'?'Copilot CLI':'VS Code';
    if(!p.ok){X.toast(esc(p.error||'Nothing to import.'),4800);return;}
    if(!p.candidates.length){X.toast('Found no MCP servers in the '+esc(label)+' file.',4200);return;}
    const items=p.candidates.map((c,i)=>`<li class="imp"><label class="chk"><input type="checkbox" data-i="${i}" checked><span><b>${esc(c.name)}</b> <span class="mtag">${esc(c.transport)}</span>
      <code class="srv-cmd">${esc(cap(c.transport==='stdio'?[c.command].concat(c.args||[]).join(' '):c.url,160))}</code>
      ${c.envKeys.length||c.headerKeys.length?`<span class="srv-secrets">${c.envKeys.map(k=>`<span class="sec">${esc(k)}<i>••••••</i></span>`).join('')}${c.headerKeys.map(k=>`<span class="sec">${esc(k)}<i>••••••</i></span>`).join('')}</span>`:''}
      ${c.notes.map(n=>`<span class="imp-note">${esc(n)}</span>`).join('')}</span></label></li>`).join('');
    const r=await dialog({title:'Import from '+label,wide:true,html:`<p class="dsub">Read-only: the file is not changed. Imported servers are added <b>switched off</b> and must be trusted before use. Values of environment variables and headers are copied into the secret store and are not shown. ${p.skipped?p.skipped+' entr'+(p.skipped>1?'ies were':'y was')+' skipped (not usable).':''}</p><ul class="imps">${items}</ul>`,
      buttons:[{label:'Cancel',value:null},{label:'Import selected',value:'ok',cls:'primary'}]});
    if(!r)return;
    const names=[...r.root.querySelectorAll('input[data-i]:checked')].map(i=>p.candidates[+i.dataset.i].name);
    if(!names.length)return;
    const res=await X.bridge.mcpImportApply(p.token,names);
    X.toast(res.ok?('Imported '+res.added.length+' server'+(res.added.length===1?'':'s')+' (off). Review and switch them on.'):esc(res.error||'Import failed.'),4600);
    paintSettings();
  }

  /* ---------------- per-agent MCP menu ---------------- */
  async function agentMcp(a){
    if(!X.bridge.agentMcp)return;
    const load=async()=>X.bridge.agentMcp(a.id);
    let st=await load();
    const body=s=>{
      const rows=s.servers.map(x=>{
        const eff=x.defaultOn&&!x.off;
        const stat=x.status?`<span class="mst ${esc(x.status)}"><i></i>${esc(x.status)}</span>`:'<span class="mst none">not started</span>';
        return `<li class="srv sm" data-n="${esc(x.name)}"><div class="srv-main"><div class="srv-top"><b class="srv-name">${esc(x.name)}</b><span class="mtag">${x.origin==='durbar'?'Settings':'runtime'}</span>${stat}${!x.defaultOn?'<span class="mtag">off in Settings</span>':''}</div>${x.error?`<span class="imp-note">${esc(cap(x.error,160))}</span>`:''}</div>
          <div class="srv-act">${sw(eff,(eff?'Switch off ':'Switch on ')+x.name+' for '+a.name,'data-n="'+esc(x.name)+'"'+(!x.defaultOn?' disabled':''))}</div></li>`;}).join('');
      return `<p class="dsub">${s.live?'This agent is running: a switch applies right away.':'This agent has no running session: your choices apply when it starts.'} Servers are set globally in <b>Settings</b>; here you can only switch one off for <b>${esc(a.name)}</b>.</p><ul class="srvs" id="agMcp">${rows||'<li class="scr-empty">No MCP servers.</li>'}</ul><p class="dsub small">Applies to this agent until the app is closed.</p>`;
    };
    const d0=dialog({title:'MCP servers for '+a.name,wide:true,html:body(st),buttons:[{label:'Settings…',value:'settings'},{label:'Done',value:'ok',cls:'primary'}],
      onOpen:d=>{d.addEventListener('click',async e=>{const b=e.target.closest('button.swt');if(!b||b.disabled)return;const on=b.getAttribute('aria-checked')!=='true';
        const r=await X.bridge.setAgentMcp(a.id,b.dataset.n,on);
        if(r&&r.error)X.toast(esc(r.error),5200);
        st=await load();d.querySelector('.dbody').innerHTML=body(st);});}});
    const r=await d0;
    if(r&&r.value==='settings')open('settings');
  }

  /* ---------------- Tools view ---------------- */
  function nameOf(id){const a=X.agents().find(x=>x.id===id);return a?a.name:id.slice(0,8);}
  function paintTools(focus){
    const r=root();
    const scope=cur.scope||null;
    const agents=X.agents();
    const tab=cur.tab||'tools';
    const tot=X.stats.totals(scope);
    const scopeSel=`<label class="select-wrap"><span class="sr-only">Show</span><select id="toolScope"><option value="">All agents</option>${agents.map(a=>`<option value="${esc(a.id)}"${a.id===scope?' selected':''}>${esc(a.name)}</option>`).join('')}</select></label>`;
    r.innerHTML=`<div class="scr-head"><h2>Tools</h2>${scopeSel}<div class="seg" role="tablist" aria-label="Tools view"><button role="tab" id="tabTools" aria-selected="${tab==='tools'}" type="button">Tool usage</button><button role="tab" id="tabAgents" aria-selected="${tab==='agents'}" type="button">Models &amp; context</button></div><span class="grow"></span><button class="btn" type="button" id="scrClose" title="Close (Esc)">Close</button></div>
      <div class="scr-body">${tab==='tools'?toolsTab(scope,tot):agentsTab(scope,agents)}</div>`;
    wireHead();
    $('toolScope').onchange=e=>{cur.scope=e.target.value||null;paintTools();};
    $('tabTools').onclick=()=>{cur.tab='tools';paintTools();};
    $('tabAgents').onclick=()=>{cur.tab='agents';paintTools();};
    r.onclick=e=>{const l=e.target.closest('[data-open]');if(l){close();X.openAgent(l.dataset.open);}};
    if(focus){const h=r.querySelector('h2');if(h){h.tabIndex=-1;h.focus({preventScroll:true});}}
  }
  function toolsTab(scope,tot){
    const groups=X.stats.groups(scope);
    if(!groups.length)return `<p class="scr-empty">No tool calls yet${scope?' for '+esc(nameOf(scope)):''}.<br><small>Counts start when an agent uses a tool in this run (built-in tools and MCP tools of every server). History of resumed sessions is not counted.</small></p>`;
    const max=Math.max(1,...groups.flatMap(g=>g.rows.map(r=>r.count)));
    const sum=`<p class="scr-sum"><b>${tot.total}</b> tool call${tot.total===1?'':'s'}${scope?' by '+esc(nameOf(scope)):' by all agents'} · <b>${tot.mcp}</b> through MCP${tot.failed?` · <b>${tot.failed}</b> failed`:''}</p>`;
    return sum+groups.map(g=>`<section class="tgrp ${g.source}"><h3>${esc(g.title)} <small>${g.total} call${g.total===1?'':'s'}</small></h3>
      <table class="ttab"><thead><tr><th scope="col">Tool</th><th scope="col" class="num">Calls</th><th scope="col" class="barc"><span class="sr-only">Share</span></th>${scope?'':'<th scope="col">Used by</th>'}</tr></thead><tbody>${g.rows.map(r=>`<tr><th scope="row"><code>${esc(r.name)}</code>${r.failed?` <span class="mtag warn" title="${r.failed} failed call${r.failed>1?'s':''}">${r.failed} failed</span>`:''}</th><td class="num">${r.count}</td>
        <td class="barc"><span class="bar ${g.source}" role="img" aria-label="${r.count} of ${max}"><i style="width:${Math.max(3,Math.round(r.count/max*100))}%"></i></span></td>
        ${scope?'':`<td class="by">${r.agents.slice(0,4).map(x=>`<button class="by-chip" type="button" data-open="${esc(x.id)}" title="Open ${esc(nameOf(x.id))}">${esc(nameOf(x.id))} <b>${x.count}</b></button>`).join('')}${r.agents.length>4?`<span class="by-more">+${r.agents.length-4}</span>`:''}</td>`}</tr>`).join('')}</tbody></table></section>`).join('');
  }
  function ctxCell(c,limit){
    const tokens=c?c.tokens:undefined;
    const lim=c&&c.limit>0?c.limit:limit>0?limit:0;
    if(tokens===undefined&&!(lim>0))return `<span class="unk" title="The runtime reports usage with the first model call. The model window is not known before.">unknown</span>`;
    const lv=S.ctxLevel(tokens,lim);
    if(tokens===undefined)return `<span class="unk" title="Window size known, nothing used yet">0 / ${fmt(lim)} (not started)</span>`;
    if(lv.level==='unknown')return `<span class="unk" title="Used tokens known, window size unknown">${fmt(tokens)} used / unknown</span>`;
    return `<span class="ctx ${lv.level}"><span class="bar" role="img" aria-label="${lv.pct}% of the context window used"><i style="width:${Math.max(2,lv.pct)}%"></i></span><span class="ctxn">${fmt(tokens)} / ${fmt(lim)} <b>${lv.pct}%</b></span></span>`;
  }
  function modelText(a,st){
    const seen=st.models;
    const chosen=a.model&&a.model!=='auto'?a.model:'Auto';
    if(!seen.length)return `<span class="mdl">${esc(chosen)}</span> <span class="mdl-sub">chosen, none used yet</span>`;
    return `<span class="mdl">${esc(chosen)}</span>${a.model==='auto'||!a.model?' <span class="mdl-sub">→</span>':''} `+seen.slice(0,3).map(m=>`<span class="mchip" title="${m.calls} model call${m.calls>1?'s':''}">${esc(m.name)} <b>${m.calls}</b></span>`).join(' ')+(seen.length>3?` <span class="by-more">+${seen.length-3}</span>`:'');
  }
  function agentsTab(scope,agents){
    const list=agents.filter(a=>!scope||a.id===scope);
    if(!list.length)return '<p class="scr-empty">No agents.</p>';
    const maxTools=Math.max(1,...list.map(a=>X.stats.agent(a.id).total));
    return `<p class="scr-sum">Model(s) each agent used and how full its context window is. Under <b>Auto</b> the runtime picks the model per request; the window is that model's. Unknown means the runtime did not report it (yet).</p>
    <table class="ttab agt"><thead><tr><th scope="col">Agent</th><th scope="col">Model(s)</th><th scope="col">Context window (used / size)</th><th scope="col" class="num">Tool calls</th></tr></thead><tbody>${list.map(a=>{const st=X.stats.agent(a.id);
      return `<tr><th scope="row"><button class="by-chip" type="button" data-open="${esc(a.id)}">${esc(a.name)}</button><div class="mdl-sub">${esc(a.room||'')}</div></th><td>${modelText(a,st)}</td><td>${ctxCell(st.ctx,X.staticLimit(a))}</td>
        <td class="num">${st.total}<span class="bar mini ${st.total?'builtin':''}" aria-hidden="true"><i style="width:${st.total?Math.max(4,Math.round(st.total/maxTools*100)):0}%"></i></span></td></tr>`;}).join('')}</tbody></table>`;
  }
  /* small chip for the chat header: "Context 5%" + bar. Returns {html,title}. */
  function ctxChip(a){
    const st=X.stats.agent(a.id),lim=X.staticLimit(a),lv=S.ctxLevel(st.ctx&&st.ctx.tokens,st.ctx&&st.ctx.limit>0?st.ctx.limit:lim);
    if(lv.level==='unknown')return {cls:'unk',text:'Context: unknown',title:'Context window usage appears after the first message.',pct:0};
    const l=st.ctx&&st.ctx.limit>0?st.ctx.limit:lim;
    return {cls:lv.level,text:'Context '+lv.pct+'%',title:fmt(st.ctx.tokens)+' of '+fmt(l)+' tokens used ('+lv.pct+'%)'+(st.ctx.system!==undefined?'. System '+fmt(st.ctx.system)+', conversation '+fmt(st.ctx.conversation||0)+', tool definitions '+fmt(st.ctx.toolDefinitions||0)+'.':''),pct:lv.pct};
  }

  window.DurbarScreens={
    init(ctx){X=ctx;},
    openSettings:()=>{mcp=null;open('settings');},
    openTools:(scope,tab)=>open('tools',{scope:scope||null,tab:tab||'tools'}),
    agentMcp,
    close,isOpen,
    /* live refresh while the Tools view is open (called when events arrive) */
    refresh:()=>{if(cur&&cur.kind==='tools'&&!document.getElementById('scrDlg'))paintTools();},
    ctxChip,
  };
})();
