/* Full-page screens: Settings (credit cap, the Copilot CLI MCP list), Tools (tool usage this session / all time, models, context window), and a folder's MCP extras. Specs 019, 020.
   Plain script; app.js calls DurbarScreens.init(ctx) once. No secret value ever reaches this file: the bridge sends key names and "set" flags. */
(function(){
  'use strict';
  const S=window.DurbarStats;
  let X=null; /* ctx from app.js: {bridge, stats, esc, toast, floors:{on(),render()}, agents(), staticLimit(a), openAgent(id), sim, places, placeServers(), setPlaceMap(m)} */
  let cur=null; /* {kind:'settings'|'tools'|'folder', ...} */
  let period='session'; /* Tools view: 'session' | 'all' (remembered for the run) */
  let usage=null; /* last all-time view {doc,labels,error} from main */
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
    if(cur.kind==='tools')paintTools(focus);else if(cur.kind==='folder')paintFolder(focus);else paintSettings(focus);
  }
  /* modal: body is an element or html; buttons [{label,value,cls}]; resolves value (or null when dismissed). `validate(root)` may return an error text (keeps it open). */
  function dialog({title,html,buttons,wide,cls,validate,onOpen}){
    return new Promise(resolve=>{
      const old=document.getElementById('scrDlg');if(old)old.remove();
      const d=document.createElement('div');d.id='scrDlg';d.className='dlg-ov';
      d.innerHTML=`<div class="dlg${wide?' wide':''}${cls?' '+cls:''}" role="dialog" aria-modal="true" aria-labelledby="scrDlgT"><h3 id="scrDlgT"></h3><div class="dbody">${html||''}</div><p class="derr" id="scrDlgErr" role="alert" hidden></p><div class="dbtn"></div></div>`;
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
    const amb=mcp.cli.map(cliRow).join('');
    let app={};
    if(X.bridge.getSettings){try{app=(await X.bridge.getSettings())||{};}catch(e){app={};}}
    /* Usage totals (spec 011 FR-028, issue #21): what the header shows, kept across restarts, and the reset */
    let usageSec='';
    if(X.bridge.usageResetTotals&&X.usageOffice&&window.DurbarUsage){
      const o=X.usageOffice(), since=(X.usageSince&&X.usageSince())||'', now=window.DurbarUsage.fmtTotal(o,2);
      usageSec=`<h4 class="scr-sub">Usage totals</h4>
        <p class="scr-note">The office header and each room show the credits spent, kept on this computer across restarts: only numbers, folder names and a fingerprint of each folder's path (never prompts or paths). <b id="usageNow">${now?esc(now+' in '+o.calls+(o.calls===1?' call':' calls')):'Nothing recorded yet'}${/^\d{4}-\d{2}-\d{2}/.test(since)?esc(', counting since '+since.slice(0,10)):''}.</b></p>
        ${X.usageError&&X.usageError()?`<p class="scr-note warn" role="status">The totals could not be saved to disk (${esc(X.usageError())}); counting continues for this run.</p>`:''}
        <div class="scr-tools"><button class="btn" type="button" id="usageTotalsReset">Reset usage totals</button><span class="scr-note small" id="usageTotalsMsg" role="status"></span></div>`;
    }
    const capSec=X.bridge.setDefaultCap?`<section class="scr-sec" aria-labelledby="capH"><h3 id="capH">Credit cap</h3>
        <p class="scr-note">The default cap, in AI credits (shown as AIU, the unit the Copilot runtime reports; 1 credit = USD 0.01), given to <b>new</b> sessions. Minimum 30 (the runtime refuses less); empty means no cap. Each session can change its own cap from its chat header; a session that reaches its cap stops and asks you. The cap is <b>soft</b>: it is checked after each model response, so one response can go past it. The stop-and-ask flow follows GitHub's documentation and is not yet verified on a real account (see spec 011).</p>
        <div class="scr-tools"><label class="capf">Default cap (AIU)<input id="capDef" type="number" min="30" step="1" placeholder="No cap" value="${app.defaultMaxAiCredits||''}"></label><button class="btn primary" type="button" id="capSave">Save</button><span class="scr-note small" id="capMsg" role="status"></span></div>${usageSec}</section>`:'';
    const f=mcp.file;
    const fileNote=!f.found?`<p class="scr-note" role="status">No <code>${esc(f.label)}</code> yet. Servers you add with the Copilot CLI (<code>/mcp add</code>) or by editing that file appear here by themselves. The built-in GitHub server is always listed.</p>`
      :f.error?`<p class="scr-note warn" role="status"><code>${esc(f.label)}</code> could not be read (${esc(f.error)}). Fix the file; this list updates the next time you open this screen.</p>`
      :`<p class="scr-note ok" role="status">Read from <code>${esc(f.label)}</code>${f.skipped?` · ${f.skipped} entr${f.skipped>1?'ies were':'y was'} skipped (not usable)`:''}. The list is read again every time this screen opens.</p>`;
    /* Places (spec 024 FR-008): which place the tool calls of each MCP server walk to. Servers: the Copilot CLI list, every server seen in
       tool events this run (folder extras show up once an agent uses them) and any already mapped. */
    /* Agent mood (spec 034 FR-004): Serious mode turns the monster, ambulance and the other drawings off */
    const moodSec=X.bridge.setSeriousMode&&X.isSerious?`<section class="scr-sec" aria-labelledby="moodH"><h3 id="moodH">Agent mood</h3>
        <p class="scr-note">Agent figures get heavier from 70% of their context window and turn into a grumpy monster above 90% (a hint to start a fresh session). Trouble gets a drawing too: an ambulance when a session errors (one at a time), a faint at the credit limit, an agent tapping the desk after 60 s waiting for you, and dizzy stars after 3 failed tool calls in a row. The text and percentages never change. Serious mode turns every drawing off.</p>
        <div class="scr-tools"><span class="swrow" style="display:flex;align-items:center;gap:10px"><b>Serious mode</b>${sw(!!X.isSerious(),'Serious mode: no mood drawings on the agent figures','id="seriousSw"')}</span><span class="scr-note small" id="seriousMsg" role="status"></span></div></section>`:'';
    let placesSec='';
    if(X.bridge.setPlace&&X.places){
      const P=X.places, map=app.placeMap||{};
      const names=[...new Set([...mcp.cli.map(c=>c.name),...X.placeServers(),...Object.keys(map)])];
      const rows=P.placeRows(names,map).map(({name:n,aliases,value:v})=>{const note=aliases.length?' also '+aliases.join(', '):'';
        return `<li class="plrow" data-srv="${esc(n)}" data-alias="${esc(aliases.join('\n'))}"><span class="plname" title="${esc(n+note)}">${esc(n)}${note?` <small>${esc(note.trim())}</small>`:''}</span><select data-place-sel aria-label="Place for the tools of ${esc(n)}"><option value=""${v?'':' selected'}>Default (${esc(P.placeName(P.defaultServerPlace(n)))})</option>${P.PLACES.map(p=>`<option value="${p.id}"${v===p.id?' selected':''}>${esc(p.name)}</option>`).join('')}<option value="desk"${v==='desk'?' selected':''}>Stay at desk</option></select></li>`;}).join('');
      placesSec=`<section class="scr-sec" aria-labelledby="plH"><h3 id="plH">Places in the office</h3>
        <p class="scr-note">In the lobby, an agent walks to a place while one of its tools runs: <b>Terminal</b> for shell commands, <b>Web</b> for web fetches, and the place you choose here for the tools of each MCP server. File tools (read, edit, search) never move an agent. The choice applies to the next tool call, for all folders, and is kept between runs. Only server names and places are saved.</p>
        ${names.length?`<ul class="plrows" id="plList">${rows}</ul>`:'<p class="scr-note small">No MCP servers yet. They appear here when your Copilot CLI list has some, or after an agent uses one in this run.</p>'}</section>`;
    }
    /* Floors (spec 033 FR-023): the same controls as the top-bar Floors panel, painted by app.js into #floorsSet */
    const floorsSec=X.floors&&X.floors.on()?`<section class="scr-sec" aria-labelledby="flH"><h3 id="flH">Floors</h3>
        <p class="scr-note">Groups of folders. A floor that is <b>off</b> is hidden from the office and not counted in Working, Waiting, Idle, Errors and Done. <b>Its agents keep running</b> and can spend credits; the office credit total still counts them, and an agent there that waits for you or has an error is shown <b>only here</b>, on its floor's row (for example "Off, 1 waiting"). With two or more floors, the same controls are also in the <b>Floors</b> button of the top bar.</p>
        <div class="floors-ui floors-set" id="floorsSet" tabindex="-1"></div></section>`:'';
    const ab=app.about;
    const aboutSec=ab?`<section class="scr-sec" aria-labelledby="aboutH"><h3 id="aboutH">About</h3>
        <p class="scr-note"><b>${esc(ab.name)}</b> ${esc(ab.version)} · by <b>${esc(ab.owner)}</b></p>
        <p class="scr-note small" id="aboutCredits">Contributors: ${ab.contributors.map(c=>esc(c.label)).join(', ')}</p>
        <p class="scr-note small">${esc(ab.copyright)} · MIT License</p></section>`:'';
    r.innerHTML=head('Settings')+`<div class="scr-body">${capSec}${moodSec}${floorsSec}${placesSec}
      <section class="scr-sec" aria-labelledby="mcpH"><h3 id="mcpH">MCP servers</h3>
        <p class="scr-note">MCP servers give agents extra tools. Your <b>Copilot CLI list</b> is the one global list: every agent gets those servers, with nothing to configure or import here. Each agent can switch single servers off from its own header (MCP button).</p>
        <p class="scr-warn" role="note"><b>MCP servers run local commands with your user rights.</b> The Copilot runtime starts the servers of your CLI list in every session, exactly as the CLI does. Read-only MCP tools can run without asking even in Read-only mode.</p>
        ${fileNote}
        <h4 class="scr-sub">From the Copilot CLI list <small>all agents</small></h4>
        <ul class="srvs" id="ambList">${amb}</ul>
        <p class="scr-note small">You cannot edit these here: change <code>${esc(f.label)}</code> with the Copilot CLI or an editor. The switch only controls whether <b>new</b> sessions started by this app start a server; a running session keeps its servers until it ends, or until you switch one in that agent's MCP menu.</p>
      </section>
      <section class="scr-sec" aria-labelledby="extH"><h3 id="extH">Extras for one folder <small>optional</small></h3>
        <p class="scr-note">Agent Durbar can add its own servers, but <b>only per folder or workspace</b>: open the <b>MCP</b> button in a room's header (or <b>Folder extras…</b> in an agent's MCP menu). Extras apply only to agents in that folder and are never shared with other folders. Switching one on shows its exact command first, and asks again if the command changes.</p>
      </section>${aboutSec}</div>`;
    wireHead();
    if(X.floors&&$('floorsSet'))X.floors.render();
    if($('capSave'))$('capSave').onclick=async()=>{
      const v=parseFloat($('capDef').value),msg=$('capMsg');
      if($('capDef').value.trim()!==''&&!(v>=30&&v<=1e6)){msg.textContent='Enter a number from 30 (the runtime minimum), or leave it empty for no cap.';return;}
      const res=await X.bridge.setDefaultCap($('capDef').value.trim()===''?null:Math.round(v*100)/100);
      if(X.onSettings)X.onSettings({defaultMaxAiCredits:res&&res.defaultMaxAiCredits});
      msg.textContent=res&&res.defaultMaxAiCredits?'Saved: new sessions start with a cap of '+res.defaultMaxAiCredits+' AIU.':'Saved: new sessions start without a cap.';
    };
    if($('usageTotalsReset'))$('usageTotalsReset').onclick=async()=>{
      const ok=await dialog({title:'Reset usage totals?',html:'<p class="dsub">This sets the saved office and folder totals to zero and starts counting from now. Tool counts in Tools &gt; All time are not changed, and neither are your agents or their history.</p>',buttons:[{label:'Cancel',value:null},{label:'Reset',value:'ok',cls:'primary warn'}]});
      if(!ok)return;
      let v=null; try{v=await X.bridge.usageResetTotals();}catch(e){v=null;}
      if(v&&v.ok){X.onUsageReset(v);X.toast('Usage totals were reset.',2600);paintSettings();}
      else{const m=$('usageTotalsMsg');if(m)m.textContent='Could not reset the totals.';}
    };
    r.onclick=onSettingsClick;
    r.onchange=onPlaceChange;
    if(focus){const h=r.querySelector('h2');if(h){h.tabIndex=-1;h.focus({preventScroll:true});}}
  }
  /* one server of the Copilot CLI list (or the built-in one): read-only, with its exact command/URL and a switch for new sessions */
  function cliRow(a){
    const run=a.command||a.url?(a.transport==='stdio'||a.command?[a.command].concat(a.args||[]).join(' '):a.url):'';
    return `<li class="srv amb" data-amb="${esc(a.name)}"><div class="srv-main"><div class="srv-top"><b class="srv-name">${esc(a.name)}</b><span class="mtag src">${a.origin==='builtin'?'built-in':'Copilot CLI list'}</span>${a.transport?`<span class="mtag">${esc(a.transport)}</span>`:''}</div>
      ${run?`<code class="srv-cmd" title="${esc(run)}">${esc(cap(run,180))}</code>`:''}</div>
      <div class="srv-act">${sw(a.enabled,(a.enabled?'Switch off ':'Switch on ')+a.name+' for new sessions','data-act="amb"')}</div></li>`;
  }
  const secretChip=(kind,s)=>`<span class="sec" title="${kind==='env'?'Environment variable':'Header'}: ${s.set?'value stored, hidden':'no value'}">${esc(s.key)}<i>${s.set?'••••••':'not set'}</i></span>`;
  function head(title){
    const tabs=cur&&cur.kind==='tools'?'':'';
    return `<div class="scr-head"><h2>${esc(title)}</h2>${tabs}<span class="grow"></span><button class="btn" type="button" id="scrClose" title="Close (Esc)">Close</button></div>`;
  }
  function wireHead(){const c=$('scrClose');if(c)c.onclick=close;}

  async function onPlaceChange(e){
    const sel=e.target.closest('select[data-place-sel]'); if(!sel||!X.bridge.setPlace)return;
    const li=sel.closest('li.plrow'), name=li&&li.dataset.srv; if(!name)return;
    /* canonical key first, then clear old alias keys (spec 024 FR-013); stop at the first failure */
    let res=null, last=null; /* last = result of the last save that worked, so a partial failure still refreshes the map */
    try{for(const [k,v] of X.places.placeSaves(name,sel.value===''?null:sel.value,li.dataset.alias?li.dataset.alias.split('\n'):[])){res=await X.bridge.setPlace(k,v);if(!res||!res.ok)break;last=res;}}catch(err){res=null;}
    if(last&&!(res&&res.ok))X.setPlaceMap(last.placeMap||{});
    if(res&&res.ok){X.setPlaceMap(res.placeMap||{});X.toast(esc(name)+': '+(sel.value===''?'back to the default place.':sel.value==='desk'?'agents stay at their desk.':'agents go to '+esc(X.places.placeName(sel.value))+'.'),3200);}
    else X.toast('Could not save the place for '+esc(name)+'.',4200);
  }
  async function onSettingsClick(e){
    const ss=e.target.closest('#seriousSw');
    if(ss&&X.bridge.setSeriousMode){
      const on=ss.getAttribute('aria-checked')!=='true';
      let res=null; try{res=await X.bridge.setSeriousMode(on);}catch(err){res=null;}
      if(res&&res.ok){X.setSerious(!!res.seriousMode);ss.classList.toggle('on',!!res.seriousMode);ss.setAttribute('aria-checked',res.seriousMode?'true':'false');const m=$('seriousMsg');if(m)m.textContent=res.seriousMode?'Serious mode is on: no mood drawings.':'Serious mode is off.';}
      return;
    }
    const li=e.target.closest('li.srv');if(!li||!li.dataset.amb)return;
    const act=(e.target.closest('[data-act]')||{}).dataset;
    if(act&&act.act==='amb'){const sw0=e.target.closest('[data-act]');const on=sw0.getAttribute('aria-checked')!=='true';await X.bridge.mcpSetCli(li.dataset.amb,on);X.toast(esc(li.dataset.amb)+(on?' will start in new sessions.':' will not start in new sessions.'),3200);paintSettings();}
  }

  /* ---------------- a folder's MCP extras (spec 020) ---------------- */
  const FOLDER_NOTE='Extra, this folder only';
  async function openFolder(key,name){
    if(!X.bridge.mcpFolderState)return;
    open('folder',{key,name:name||key});
  }
  async function paintFolder(focus){
    const k=cur.key;
    const first=!cur.st;
    if(first)root().innerHTML=head('MCP extras')+'<div class="scr-body"><p class="scr-note">Loading…</p></div>';
    const st=await X.bridge.mcpFolderState(k);
    if(!cur||cur.kind!=='folder'||cur.key!==k)return;
    cur.st=st;
    const r=root();
    if(!st||!st.ok){r.innerHTML=head('MCP extras')+'<div class="scr-body"><p class="scr-note">This folder is not in the office any more.</p></div>';wireHead();return;}
    const cmd=v=>v.transport==='stdio'?[v.command].concat(v.args||[]).join(' '):v.url;
    const srv=st.servers.map(v=>`<li class="srv" data-name="${esc(v.name)}">
      <div class="srv-main"><div class="srv-top"><b class="srv-name">${esc(v.name)}</b><span class="mtag extra" title="Only agents in ${esc(st.name)} get this server">${FOLDER_NOTE}</span><span class="mtag">${esc(v.transport)}</span>
        ${v.enabled&&!v.trusted?'<span class="mtag warn">needs trust</span>':''}${v.needsSecrets?'<span class="mtag warn" title="Secret values are not available. Edit the server and enter them again.">needs secrets</span>':''}${v.workingDirectory?`<span class="mtag" title="${esc(v.workingDirectory)}">cwd</span>`:''}</div>
        <code class="srv-cmd" title="${esc(cmd(v))}">${esc(cap(cmd(v),180))}</code>
        ${v.env.concat(v.headers).length?`<div class="srv-secrets" aria-label="Secret values (masked)">${v.env.map(x=>secretChip('env',x)).join('')}${v.headers.map(x=>secretChip('header',x)).join('')}</div>`:''}
      </div>
      <div class="srv-act">${sw(v.enabled&&v.trusted,(v.enabled?'Disable ':'Enable ')+v.name,'data-act="toggle"')}<button class="btn sm" type="button" data-act="edit">Edit</button><button class="btn sm danger" type="button" data-act="remove">Remove</button></div></li>`).join('');
    const leg=st.legacy.map(v=>`<li class="srv legacy" data-legacy="${esc(v.name)}"><div class="srv-main"><div class="srv-top"><b class="srv-name">${esc(v.name)}</b><span class="mtag warn">old app-level server, not applied</span><span class="mtag">${esc(v.transport)}</span></div>
        <code class="srv-cmd" title="${esc(cmd(v))}">${esc(cap(cmd(v),180))}</code></div>
      <div class="srv-act"><button class="btn sm" type="button" data-act="move">Move here</button><button class="btn sm danger" type="button" data-act="rmlegacy">Remove</button></div></li>`).join('');
    r.innerHTML=head('MCP extras · '+st.name)+`<div class="scr-body">
      <section class="scr-sec" aria-labelledby="fxH"><h3 id="fxH">Extra servers for <code>${esc(st.name)}</code> <small>${FOLDER_NOTE.toLowerCase()}</small></h3>
        <p class="scr-note">These servers are optional and belong to <b>this folder or workspace only</b>: agents in other folders do not get them. Servers from your Copilot CLI list are available to every agent and are not edited here.</p>
        <p class="scr-warn" role="note"><b>MCP servers run local commands with your user rights.</b> You see the exact command before a server is switched on for the first time, and again whenever its command or URL changes. Removing the folder from the office keeps these extras; they come back if you add the folder again.</p>
        <p class="scr-note ${st.secretsPersist?'ok':'warn'}" role="status">${st.secretsPersist?'Secret values (environment variables, headers) are stored encrypted by your operating system and are never shown again, logged or exported.':'<b>No OS-protected secret store is available here.</b> Secret values are kept in memory for this run only and are not saved: you will need to enter them again after a restart.'}</p>
        <div class="scr-tools"><button class="btn primary" type="button" id="mcpAdd">+ Add extra server</button><button class="btn" type="button" id="mcpImportVs" title="Read this folder's .vscode/mcp.json and pick servers to add (nothing is switched on)">Import from VS Code…</button><button class="btn" type="button" id="fxSettings">Copilot CLI list…</button></div>
        ${st.skipped.length?`<p class="scr-note warn" role="status">Not passed to new sessions: ${st.skipped.map(x=>'<b>'+esc(x.name)+'</b> ('+esc(x.reason)+')').join('; ')}.</p>`:''}
        ${srv?`<ul class="srvs" id="srvList">${srv}</ul>`:'<p class="scr-empty">No extras for this folder. Your Copilot CLI servers are already available to its agents.</p>'}
        <p class="scr-note small">Changes apply to <b>new</b> sessions in this folder and to agents that start or resume afterwards. A running session keeps its servers until it ends, or until you switch one in that agent's MCP menu.</p>
      </section>
      ${leg?`<section class="scr-sec" aria-labelledby="lgH"><h3 id="lgH">Old app-level servers <small>not applied</small></h3>
        <p class="scr-note">Earlier versions kept one global list of servers. Those are no longer used anywhere. <b>Move here</b> puts one into this folder (switched off; you review and trust it again), or remove it.</p><ul class="srvs" id="legList">${leg}</ul></section>`:''}</div>`;
    wireHead();
    $('mcpAdd').onclick=()=>editServer(null,st);
    $('mcpImportVs').onclick=()=>importVSCode(st);
    $('fxSettings').onclick=()=>open('settings');
    r.onclick=onFolderClick;
    if(focus){const h=r.querySelector('h2');if(h){h.tabIndex=-1;h.focus({preventScroll:true});}}
  }
  async function onFolderClick(e){
    const st=cur&&cur.st;if(!st)return;
    const li=e.target.closest('li.srv');if(!li)return;
    const act=(e.target.closest('[data-act]')||{}).dataset;if(!act)return;
    if(li.dataset.legacy){
      const n=li.dataset.legacy;
      if(act.act==='move'){const res=await X.bridge.mcpMoveLegacy(n,st.key);X.toast(res&&res.ok?esc(n)+' moved here (off). Review it and switch it on.':'Could not move: '+esc((res&&res.error)||'unknown error'),4200);paintFolder();}
      else if(act.act==='rmlegacy'){
        const r=await dialog({title:'Remove old server "'+n+'"?',html:'<p class="dsub">It is deleted from Agent Durbar with its stored secret values. It was not being used.</p>',buttons:[{label:'Cancel',value:null},{label:'Remove',value:'ok',cls:'primary warn'}]});
        if(r){await X.bridge.mcpRemoveLegacy(n);paintFolder();}
      }
      return;
    }
    const name=li.dataset.name,v=st.servers.find(x=>x.name===name);if(!v)return;
    if(act.act==='toggle'){const turnOn=!(v.enabled&&v.trusted);await toggleServer(v,turnOn,st);}
    else if(act.act==='edit')editServer(v,st);
    else if(act.act==='remove'){
      const r=await dialog({title:'Remove "'+name+'"?',html:'<p class="dsub">The server and its stored secret values are deleted from this folder in Agent Durbar. Running sessions keep it until they end.</p>',buttons:[{label:'Cancel',value:null},{label:'Remove',value:'ok',cls:'primary warn'}]});
      if(r){await X.bridge.mcpRemove(st.key,name);X.toast('Removed '+esc(name)+'.',2600);paintFolder();}
    }
  }
  async function toggleServer(v,turnOn,st){
    let r=await X.bridge.mcpSetEnabled(st.key,v.name,turnOn,false);
    if(r&&r.needsTrust){
      const t=r.needsTrust;
      const run=t.transport==='stdio'?[t.command].concat(t.args||[]).join(' '):t.url;
      const ok=await dialog({title:'Trust "'+t.name+'" in '+st.name+'?',wide:true,html:`<p class="dsub"><b>This will run a program on your computer</b> every time a session starts in <b>${esc(st.name)}</b>, with your user rights, and give it access to what you pass in its environment. Agents there will be able to call its tools${t.transport==='stdio'?'':' (a remote server: requests and your header values go to that URL)'}.</p>
        <p class="dsub">${t.transport==='stdio'?'Command':'URL'}:</p><pre class="trustcmd" tabindex="0">${esc(run)}</pre>${t.workingDirectory?`<p class="dsub">Working directory: <code>${esc(t.workingDirectory)}</code></p>`:''}
        <p class="dsub">Only continue if you know where this comes from. You will be asked again if the command or URL changes.</p>`,
        buttons:[{label:'Cancel',value:null},{label:'Trust and enable',value:'ok',cls:'primary warn'}]});
      if(!ok){paintFolder();return;}
      r=await X.bridge.mcpSetEnabled(st.key,v.name,true,true);
    }
    if(!r||!r.ok)X.toast('Could not change the server: '+esc((r&&r.error)||'unknown error'),5000);
    else X.toast(esc(v.name)+(turnOn?' is on for new sessions in '+esc(st.name)+'.':' is off.'),2800);
    paintFolder();
  }

  /* ---------------- import from VS Code's .vscode/mcp.json, per folder (spec 020 FR-020..FR-031) ---------------- */
  /* The main process reads the file; this only gets keys, flags and notes (never a secret value). Nothing is ticked, imports arrive off + untrusted. */
  const impChip=(kind,x)=>`<span class="sec" title="${kind==='env'?'Environment variable':'Header'}: ${x.hasValue?'the value is copied into the secret store (hidden)':'no value is copied: enter it after importing'}">${esc(x.key)}<i>${x.hasValue?'••••••':'no value'}</i></span>`;
  async function importVSCode(st){
    if(!X.bridge.mcpImportPreview)return;
    const pv=await X.bridge.mcpImportPreview(st.key);
    if(!cur||cur.kind!=='folder'||cur.key!==st.key)return;
    const intro=`<p class="dsub">Servers found in <code>${esc(pv.label||'.vscode/mcp.json')}</code> of <b>${esc(st.name)}</b>. The file is only read, never changed, and your Copilot CLI list is not touched.</p>`;
    if(!pv.ok||!pv.items.length){
      const msg=!pv.ok?esc(pv.error||'The file could not be read.'):'No servers in this file.'+(pv.skipped?` ${pv.skipped} entr${pv.skipped===1?'y was':'ies were'} skipped (not a server definition).`:'');
      await dialog({title:'Import from VS Code',html:intro+`<p class="scr-note ${pv.ok?'':'warn'}" role="status">${msg}</p>`,buttons:[{label:'Close',value:'ok',cls:'primary'}]});
      return;
    }
    const cmd=v=>v.transport==='stdio'?[v.command].concat(v.args||[]).join(' '):v.url;
    const usable=pv.items.filter(v=>!v.blocked&&!v.alreadyAdded);
    const rows=pv.items.map(v=>{
      const dis=!!(v.blocked||v.alreadyAdded);
      const secrets=v.env.concat(v.headers).length?`<div class="srv-secrets" aria-label="Secret values (masked)">${v.env.map(x=>impChip('env',x)).join('')}${v.headers.map(x=>impChip('header',x)).join('')}</div>`:'';
      const notes=v.notes.length?`<ul class="imp-notes">${v.notes.map(n=>'<li>'+esc(n)+'</li>').join('')}</ul>`:'';
      return `<li class="imp-row${dis?' dis':''}"><label><input type="checkbox" data-imp="${esc(v.id)}" aria-label="Import ${esc(v.name)}"${dis?' disabled':''}>
        <span class="imp-main"><span class="srv-top"><b class="srv-name">${esc(v.name)}</b><span class="mtag">${esc(v.transport)}</span>${v.from?`<span class="mtag src" title="Folder of this workspace">${esc(v.from)}</span>`:''}${v.alreadyAdded?'<span class="mtag">already added</span>':''}${v.blocked?'<span class="mtag warn">cannot import</span>':''}</span>
        <code class="srv-cmd" title="${esc(cmd(v))}">${esc(cap(cmd(v),180))}</code>${v.workingDirectory?`<span class="imp-cwd">Working directory: <code>${esc(cap(v.workingDirectory,120))}</code></span>`:''}${secrets}
        ${v.blocked?`<span class="imp-block">${esc(v.blocked)}</span>`:''}${notes}</span></label></li>`;
    }).join('');
    const inputs=[].concat(...pv.files.map(f=>f.inputs||[]));
    const issues=pv.files.filter(f=>f.state==='error').map(f=>(pv.files.length>1?f.from+': ':'')+f.message);
    const foot=[pv.skipped?`${pv.skipped} entr${pv.skipped===1?'y':'ies'} skipped (not a usable server definition).`:'',inputs.length?`The file declares inputs (${inputs.slice(0,6).map(esc).join(', ')}). Agent Durbar never asks for them, stores them or fills them in.`:'',issues.length?esc(issues.join(' ')):''].filter(Boolean).join(' ');
    const body=intro+`<p class="scr-note small">Tick what to add. Imported servers belong to <b>this folder only</b> and arrive <b>switched off</b>: the first time you switch one on you see its exact command and confirm that you trust it. Values of variables and headers stay hidden.</p>
      <div class="imp-tools"><button class="btn sm" type="button" data-all="1">Select all importable (${usable.length})</button><button class="btn sm" type="button" data-all="0">Clear</button><span class="imp-count" id="impCount" role="status" aria-live="polite">0 selected</span></div>
      <ul class="imp-list" id="impList">${rows}</ul>${foot?`<p class="scr-note small">${foot}</p>`:''}`;
    const r=await dialog({title:'Import from VS Code · '+st.name,wide:true,cls:'imp',html:body,buttons:[{label:'Cancel',value:null},{label:'Import selected',value:'ok',cls:'primary'}],
      onOpen:d=>{const upd=()=>{const n=d.querySelectorAll('[data-imp]:checked').length;d.querySelector('#impCount').textContent=n+' selected';};
        d.addEventListener('change',e=>{if(e.target.matches('[data-imp]'))upd();});
        d.addEventListener('click',e=>{const a=e.target.closest('[data-all]');if(a){d.querySelectorAll('[data-imp]:not(:disabled)').forEach(c=>{c.checked=a.dataset.all==='1';});upd();}});},
      validate:d=>d.querySelector('[data-imp]:checked')?'':'Tick at least one server to import.'});
    if(!r)return;
    const ids=[...r.root.querySelectorAll('[data-imp]:checked')].map(c=>c.dataset.imp);
    const res=await X.bridge.mcpImportApply(st.key,ids,pv.digest);
    const n=(res&&res.imported||[]).length,bad=(res&&res.failed)||[];
    if(n)X.toast(`Imported ${n} server${n===1?'':'s'} into ${esc(st.name)} (off). Switch one on to review and trust it.`,4600);
    if(bad.length||!res||!res.ok){
      await dialog({title:n?'Some servers were not imported':'Nothing was imported',html:`<p class="dsub">${res&&res.error?esc(res.error):'These entries could not be imported:'}</p>${bad.length?`<ul class="imp-notes">${bad.map(b=>'<li><b>'+esc(b.name)+'</b>: '+esc(b.error)+'</li>').join('')}</ul>`:''}`,buttons:[{label:'Close',value:'ok',cls:'primary'}]});
    }
    paintFolder();
  }

  /* add / edit form */
  function rowHTML(kind,k,existing,set){
    return `<div class="krow" data-kind="${kind}"><input class="k" type="text" spellcheck="false" autocomplete="off" aria-label="${kind==='env'?'Variable name':'Header name'}" placeholder="${kind==='env'?'NAME':'Header-Name'}" value="${esc(k||'')}" data-orig="${existing?esc(k):''}">
      <input class="v" type="password" spellcheck="false" autocomplete="new-password" aria-label="${kind==='env'?'Variable value (secret)':'Header value (secret)'}" placeholder="${existing&&set?'•••••• stored. Leave empty to keep':'value (secret)'}">
      <button class="btn sm" type="button" data-rm aria-label="Remove this row">×</button></div>`;
  }
  async function editServer(v,st){
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
    const r=await dialog({title:isNew?'Add extra server to '+st.name:'Edit "'+v.name+'"',wide:true,html,buttons:[{label:'Cancel',value:null},{label:isNew?'Add server':'Save',value:'ok',cls:'primary'}],
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
    const res=await X.bridge.mcpUpsert(st.key,input,v?v.name:undefined);
    if(!res||!res.ok){X.toast('Not saved: '+esc((res&&res.error)||'unknown error'),5600);return editServer2(input,v,st);}
    X.toast(esc(input.name)+(isNew?' added to '+esc(st.name)+' (off). Switch it on to use it.':' saved.'),3600);
    paintFolder();
  }
  /* reopen after a server-side validation error without losing what was typed (secret values are not kept) */
  function editServer2(input,v,st){const view=Object.assign({},v||{},{name:input.name,transport:input.transport,command:input.command,args:input.args,workingDirectory:input.workingDirectory,url:input.url,tools:input.tools,env:(v&&v.env)||[],headers:(v&&v.headers)||[]});return editServer(v?view:Object.assign(view,{name:input.name}),st);}

  /* ---------------- per-agent MCP menu ---------------- */
  async function agentMcp(a){
    if(!X.bridge.agentMcp)return;
    const load=async()=>X.bridge.agentMcp(a.id);
    let st=await load();
    const body=s=>{
      const rows=s.servers.map(x=>{
        const eff=x.defaultOn&&!x.off;
        const stat=x.status?`<span class="mst ${esc(x.status)}"><i></i>${esc(x.status)}</span>`:'<span class="mst none">not started</span>';
        return `<li class="srv sm" data-n="${esc(x.name)}"><div class="srv-main"><div class="srv-top"><b class="srv-name">${esc(x.name)}</b><span class="mtag${x.origin==='folder'?' extra':' src'}">${x.origin==='cli'?'Copilot CLI list':x.origin==='folder'?'this folder only':'runtime'}</span>${stat}${!x.defaultOn?`<span class="mtag">${x.origin==='folder'?'off in folder extras':'off in Settings'}</span>`:''}</div>${x.error?`<span class="imp-note">${esc(cap(x.error,160))}</span>`:''}</div>
          <div class="srv-act">${sw(eff,(eff?'Switch off ':'Switch on ')+x.name+' for '+a.name,'data-n="'+esc(x.name)+'"'+(!x.defaultOn?' disabled':''))}</div></li>`;}).join('');
      return `<p class="dsub">${s.live?'This agent is running: a switch applies right away.':'This agent has no running session: your choices apply when it starts.'} Your Copilot CLI servers are global (see <b>Settings</b>); extras belong to this agent's folder only. Here you can only switch one off for <b>${esc(a.name)}</b>.</p><ul class="srvs" id="agMcp">${rows||'<li class="scr-empty">No MCP servers.</li>'}</ul><p class="dsub small">Applies to this agent until the app is closed.</p>`;
    };
    const d0=dialog({title:'MCP servers for '+a.name,wide:true,html:body(st),buttons:[{label:'Settings…',value:'settings'},{label:'Folder extras…',value:'folder'},{label:'Done',value:'ok',cls:'primary'}],
      onOpen:d=>{d.addEventListener('click',async e=>{const b=e.target.closest('button.swt');if(!b||b.disabled)return;const on=b.getAttribute('aria-checked')!=='true';
        const r=await X.bridge.setAgentMcp(a.id,b.dataset.n,on);
        if(r&&r.error)X.toast(esc(r.error),5200);
        st=await load();d.querySelector('.dbody').innerHTML=body(st);});}});
    const r=await d0;
    if(r&&r.value==='settings')open('settings');
    else if(r&&r.value==='folder'&&X.folderOf){const f=X.folderOf(a);if(f)openFolder(f.key,f.name);}
  }

  /* ---------------- Tools view ---------------- */
  function nameOf(id){const a=X.agents().find(x=>x.id===id);return a?a.name:id.slice(0,8);}
  /* all-time document from main (spec 020); refreshed on every paint request of the all-time period */
  async function loadUsage(){
    if(!X.bridge.usageAllTime){usage=null;return;}
    try{usage=await X.bridge.usageAllTime();}catch(e){usage=null;}
  }
  /* the agent label (all-time key) of a live agent id */
  const labelOfId=id=>usage&&usage.labels&&usage.labels[id]||null;
  async function paintTools(focus){
    if(period==='all'&&cur&&cur.kind==='tools'){const k=++toolsSeq;await loadUsage();if(k!==toolsSeq||!cur||cur.kind!=='tools')return;}
    paintToolsNow(focus);
  }
  let toolsSeq=0;
  async function paintToolsNow(focus){
    const r=root();
    const all=period==='all';
    const agents=X.agents();
    const tab=all?'tools':(cur.tab||'tools');
    let scope=cur.scope||null; /* session: an agent id; all time: an agent label */
    let tot,groups,scopeSel;
    if(all){
      if(scope&&usage&&usage.labels&&usage.labels[scope])scope=usage.labels[scope]; /* an agent id from the chat header */
      cur.scope=scope;
      const doc=usage&&usage.doc;
      const labels=doc?Object.keys(doc.agents).filter(l=>doc.agents[l].calls||doc.agents[l].failed).sort((x,y)=>doc.agents[y].calls-doc.agents[x].calls||x.localeCompare(y)):[];
      if(scope&&!labels.includes(scope))labels.unshift(scope);
      const v=S.docView(doc,scope);
      tot=v.totals;groups=v.groups;
      scopeSel=`<label class="select-wrap"><span class="sr-only">Show</span><select id="toolScope"><option value="">All agents</option>${labels.map(l=>`<option value="${esc(l)}"${l===scope?' selected':''}>${esc(l)}</option>`).join('')}</select></label>`;
    }else{
      if(scope&&!agents.some(a=>a.id===scope)){const id=Object.keys((usage&&usage.labels)||{}).find(k=>usage.labels[k]===scope);scope=id||null;cur.scope=scope;}
      tot=X.stats.totals(scope);groups=X.stats.groups(scope);
      scopeSel=`<label class="select-wrap"><span class="sr-only">Show</span><select id="toolScope"><option value="">All agents</option>${agents.map(a=>`<option value="${esc(a.id)}"${a.id===scope?' selected':''}>${esc(a.name)}</option>`).join('')}</select></label>`;
    }
    const per=`<div class="seg" role="tablist" aria-label="Period"><button role="tab" id="perSession" aria-selected="${!all}" type="button">This session</button><button role="tab" id="perAll" aria-selected="${all}" type="button">All time</button></div>`;
    const tabs=all?'':`<div class="seg" role="tablist" aria-label="Tools view"><button role="tab" id="tabTools" aria-selected="${tab==='tools'}" type="button">Tool usage</button><button role="tab" id="tabAgents" aria-selected="${tab==='agents'}" type="button">Models &amp; context</button></div>`;
    const body=tab==='tools'?await toolsTab(scope,tot,groups,all):agentsTab(scope,agents);
    if(!cur||cur.kind!=='tools')return;
    r.innerHTML=`<div class="scr-head"><h2>Tools</h2>${per}${scopeSel}${tabs}<span class="grow"></span><button class="btn" type="button" id="scrClose" title="Close (Esc)">Close</button></div>
      <div class="scr-body">${body}</div>`;
    wireHead();
    $('toolScope').onchange=e=>{cur.scope=e.target.value||null;paintTools();};
    $('perSession').onclick=()=>{if(period==='session')return;period='session';cur.scope=null;paintTools();};
    $('perAll').onclick=()=>{if(period==='all')return;period='all';paintTools();};
    if($('tabTools'))$('tabTools').onclick=()=>{cur.tab='tools';paintTools();};
    if($('tabAgents'))$('tabAgents').onclick=()=>{cur.tab='agents';paintTools();};
    r.onclick=async e=>{
      const l=e.target.closest('[data-open]');if(l){close();X.openAgent(l.dataset.open);return;}
      if(e.target.closest('#cfgSettings')){open('settings');return;}
      if(e.target.closest('#usageReset')){
        const ok=await dialog({title:'Reset all-time counts?',html:'<p class="dsub">This clears the counts kept across restarts and starts again from today. It does not touch your agents or their history.</p>',buttons:[{label:'Cancel',value:null},{label:'Reset',value:'ok',cls:'primary warn'}]});
        if(ok&&X.bridge.usageReset){await X.bridge.usageReset();X.toast('All-time counts were reset.',2600);cur.scope=null;paintTools();}
      }
    };
    if(focus){const h=r.querySelector('h2');if(h){h.tabIndex=-1;h.focus({preventScroll:true});}}
  }
  const fmtDate=iso=>{const d=new Date(iso);return isNaN(d)?'':d.toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'});};
  async function toolsTab(scope,tot,groups,all){
    const name1=all?scope:(scope?nameOf(scope):'');
    const cfg=await configuredServers(scope,all,groups);
    if(!groups.length){
      const empty=all?`<p class="scr-empty">Nothing counted yet${scope?' for '+esc(scope):''}.<br><small>Counting starts with the first tool call and is kept across restarts. Only tool names, MCP server names, agent names and counts are stored; never arguments or output.</small></p>`
        :`<p class="scr-empty">No tool calls yet${scope?' for '+esc(name1):''} in this session.<br><small>This view counts tool calls since the app started (built-in tools and MCP tools of every server). History of resumed sessions is not counted. <b>All time</b> keeps counts across restarts.</small></p>`;
      return empty+cfg;
    }
    const max=Math.max(1,...groups.flatMap(g=>g.rows.map(r=>r.count)));
    const since=all&&usage&&usage.doc?fmtDate(usage.doc.since):'';
    const sum=`<p class="scr-sum"><b>${tot.total}</b> tool call${tot.total===1?'':'s'}${scope?' by '+esc(name1):all?` by ${tot.agents} agent${tot.agents===1?'':'s'}`:' by all agents'}${all&&since?` since ${esc(since)}`:''} · <b>${tot.mcp}</b> through MCP${tot.failed?` · <b>${tot.failed}</b> failed`:''}</p>`
      +(all?`<p class="scr-note small">Kept on this computer across restarts: tool names, MCP server names, agent names and counts only (never arguments, output or paths). ${usage&&usage.error?'<b class="warnc">Could not save the last update: '+esc(usage.error)+'.</b> ':''}<button class="btn sm danger" type="button" id="usageReset">Reset all-time counts</button></p>`:'');
    return sum+groups.map(g=>`<section class="tgrp ${g.source}"><h3>${esc(g.title)} <small>${g.total} call${g.total===1?'':'s'}</small></h3>
      <table class="ttab"><thead><tr><th scope="col">Tool</th><th scope="col" class="num">Calls</th><th scope="col" class="barc"><span class="sr-only">Share</span></th>${scope?'':'<th scope="col">Used by</th>'}</tr></thead><tbody>${g.rows.map(r=>`<tr><th scope="row"><code>${esc(r.name)}</code>${r.failed?` <span class="mtag warn" title="${r.failed} failed call${r.failed>1?'s':''}">${r.failed} failed</span>`:''}</th><td class="num">${r.count}</td>
        <td class="barc"><span class="bar ${g.source}" role="img" aria-label="${r.count} of ${max}"><i style="width:${Math.max(3,Math.round(r.count/max*100))}%"></i></span></td>
        ${scope?'':`<td class="by">${r.agents.slice(0,4).map(x=>x.id?`<button class="by-chip" type="button" data-open="${esc(x.id)}" title="Open ${esc(nameOf(x.id))}">${esc(nameOf(x.id))} <b>${x.count}</b></button>`:`<span class="by-chip static" title="${esc(x.label)}">${esc(x.label)} <b>${x.count}</b></span>`).join('')}${r.agents.length>4?`<span class="by-more">+${r.agents.length-4}</span>`:''}</td>`}</tr>`).join('')}</tbody></table></section>`).join('')+cfg;
  }
  /* "Configured MCP servers": the Copilot CLI list (and, for one session agent, its folder extras) with the calls of this period, 0 included */
  async function configuredServers(scope,all,groups){
    if(!X.bridge.mcpState)return '';
    let st=null;try{st=await X.bridge.mcpState();}catch(e){return '';}
    if(!st)return '';
    const calls=new Map(groups.filter(g=>g.source==='mcp').map(g=>[g.server,g.total]));
    const items=st.cli.map(a=>({name:a.name,tag:a.origin==='builtin'?'built-in':'Copilot CLI list',on:a.enabled}));
    if(!all&&scope&&X.bridge.agentMcp){
      try{const r=await X.bridge.agentMcp(scope);if(r&&r.ok)for(const x of r.servers)if(x.origin==='folder')items.push({name:x.name,tag:'this folder only',extra:true,on:x.defaultOn&&!x.off});}catch(e){/* optional */}
    }
    const rows=items.map(i=>`<li class="cfg"><b>${esc(i.name)}</b><span class="mtag${i.extra?' extra':' src'}">${esc(i.tag)}</span>${i.on?'':'<span class="mtag">off for new sessions</span>'}<span class="cfg-n">${calls.get(i.name)||0} call${(calls.get(i.name)||0)===1?'':'s'}</span></li>`).join('');
    return `<section class="tgrp cfgsec" aria-labelledby="cfgH"><h3 id="cfgH">Configured MCP servers <small>${all?'all time':'this session'}</small></h3><ul class="cfgs">${rows}</ul>
      <p class="scr-note small">${esc(st.file.label)}${st.file.found?'':' (not found)'}${st.file.error?' (unreadable)':''} is read live. Open <button class="linkbtn" type="button" id="cfgSettings">Settings</button> for the details.</p></section>`;
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
    const long=a.info&&a.info.tier==='long'?' · long context':'';
    /* spec 030: right after a model switch the old figure belongs to the old window; the runtime reports the new one with the next message */
    if(a.ctxWaiting)return {cls:'unk',text:'Window: waiting for next message',title:'The model changed. The new context window is reported with your next message; the earlier figure belonged to the old window.'+long,pct:0};
    if(lv.level==='unknown')return {cls:'unk',text:'Context: unknown',title:'Context window usage appears after the first message.',pct:0};
    const l=st.ctx&&st.ctx.limit>0?st.ctx.limit:lim;
    return {cls:lv.level,text:'Context '+lv.pct+'%'+(long?' · long':''),title:fmt(st.ctx.tokens)+' of '+fmt(l)+' tokens used ('+lv.pct+'%)'+long+(st.ctx.system!==undefined?'. System '+fmt(st.ctx.system)+', conversation '+fmt(st.ctx.conversation||0)+', tool definitions '+fmt(st.ctx.toolDefinitions||0)+'.':''),pct:lv.pct};
  }

  window.DurbarScreens={
    init(ctx){X=ctx;},
    folderMcp:openFolder,
    openSettings:()=>{mcp=null;open('settings');},
    openTools:(scope,tab)=>{if(tab==='agents')period='session';open('tools',{scope:scope||null,tab:tab||'tools'});},
    agentMcp,
    close,isOpen,
    /* live refresh while the Tools view is open (called when events arrive) */
    refresh:()=>{if(cur&&cur.kind==='tools'&&!document.getElementById('scrDlg'))paintTools();},
    period:()=>period,
    ctxChip,
  };
})();
