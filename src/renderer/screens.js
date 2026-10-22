/* Full-page screens: Settings (credit cap, the Copilot CLI MCP list), Tools (tool usage this session / all time, models, context window), and a folder's MCP extras. Specs 019, 020.
   Plain script; app.js calls DurbarScreens.init(ctx) once. No secret value ever reaches this file: the bridge sends key names and "set" flags. */
(function(){
  'use strict';
  const S=window.DurbarStats;
  let X=null; /* ctx from app.js: {bridge, stats, esc, toast, floors:{on(),render()}, agents(), staticLimit(a), openAgent(id), sim, places, placeServers(), setPlaceMap(m)} */
  let cur=null; /* {kind:'settings'|'tools'|'folder', ...} */
  let period='session'; /* Tools view: 'session' | 'all' (remembered for the run) */
  let costPer='run'; /* Tools > Cost: 'run' | 'since' (spec 052 FR-044; remembered for the run) */
  let usage=null; /* last all-time view {doc,labels,error} from main */
  const $=id=>document.getElementById(id);
  const esc=s=>X.esc(s);
  const root=()=>$('screen');
  const fmt=n=>S.fmtTokens(n);
  const cap=(s,n)=>{s=String(s==null?'':s);return s.length>n?s.slice(0,n-1)+'…':s;};
  /* spec 052 FR-055: bring a heading to the top of the screen's own scroller only. scrollIntoView also scrolled the
     outer page (overflow:hidden still scrolls), which hid the top bar and left a blank strip at the bottom. */
  const scrollInBody=h=>{const sc=h.closest('.scr-body');if(sc)sc.scrollTop+=h.getBoundingClientRect().top-sc.getBoundingClientRect().top-12;};

  /* ---------------- shared: frame, dialogs ---------------- */
  function open(kind,opts){
    cur=Object.assign({kind},opts||{});
    if(kind==='settings')advOpen=cur.section==='mcp';
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
  /* modal: body is an element or html; buttons [{label,value,cls}]; resolves value (or null when dismissed). `validate(root)` may return an error text (keeps it open and shows it), `true` (keeps it open; the caller already showed the error) or a promise of either. */
  function dialog({title,html,buttons,wide,size,cls,validate,onOpen}){
    return new Promise(resolve=>{
      const old=document.getElementById('scrDlg');if(old)old.remove();
      const d=document.createElement('div');d.id='scrDlg';d.className='dlg-ov';
      d.innerHTML=`<div class="dlg${wide?' wide':''}${size==='m'||size==='l'?' '+size:''}${cls?' '+cls:''}" role="dialog" aria-modal="true" aria-labelledby="scrDlgT"><h3 id="scrDlgT"></h3><div class="dbody">${html||''}</div><p class="derr" id="scrDlgErr" role="alert" hidden></p><div class="dbtn"></div></div>`;
      d.querySelector('#scrDlgT').textContent=title;
      const row=d.querySelector('.dbtn');
      const done=v=>{d.remove();resolve(v);};
      buttons.forEach(b=>{const el=document.createElement('button');el.type='button';el.className='btn'+(b.cls?' '+b.cls:'');el.textContent=b.label;if(b.value===null)el.dataset.cancel='1';
        el.onclick=async()=>{if(b.value!==null&&validate){el.disabled=true;let err;try{err=await validate(d);}finally{el.disabled=false;}if(err){if(typeof err==='string'){const e=d.querySelector('#scrDlgErr');e.textContent=err;e.hidden=false;}return;}}done(b.value===null?null:{value:b.value,root:d});};row.appendChild(el);});
      d.addEventListener('click',e=>{if(e.target===d)done(null);});
      d.addEventListener('keydown',e=>{if(e.key==='Escape'){e.stopPropagation();done(null);}});
      document.body.appendChild(d);
      if(onOpen)onOpen(d);
      /* spec 052 FR-076: a red or amber confirmation starts on Cancel, as in dialog.js (FR-036), so Enter never confirms it unread */
      const pr=row.querySelector('.primary'), risky=pr&&/\b(danger|warn)\b/.test(pr.className)&&row.querySelector('[data-cancel]');
      const first=d.querySelector('input,select,textarea')||(risky?row.querySelector('[data-cancel]'):pr)||row.lastElementChild;
      if(first)first.focus();
      d._close=()=>done(null);
    });
  }
  const sw=(on,label,attrs)=>`<button class="swt${on?' on':''}" type="button" role="switch" aria-checked="${on?'true':'false'}" aria-label="${esc(label)}" ${attrs||''}><i></i></button>`;

  /* ---------------- Settings: MCP servers ---------------- */
  let mcp=null; /* last McpState */
  let advOpen=false; /* Settings > Advanced (MCP) open; kept across repaints, reset when Settings opens (FR-030) */
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
    const capSec=X.bridge.setDefaultCap?`<section class="scr-sec" aria-labelledby="capH"><h3 id="capH">Spending limit</h3>
        <p class="scr-note">A spending limit for each <b>new Copilot</b> session, in AI credits (AIU; 1 credit = USD 0.01). Empty means no limit; each session can change its own from its chat header. Claude Code sessions have a dollar limit in their chat header; Codex does not report cost.</p>
        <details class="scr-more"><summary>More about the limit</summary><p class="scr-note small">Minimum 30 (the Copilot runtime refuses less). A session that reaches its limit stops and asks you. The limit is soft: it is checked after each model response, so one response can go past it. The stop-and-ask flow follows GitHub's documentation and has not been seen on a real account yet.</p></details>
        <div class="scr-tools"><label class="capf">Default limit (AI credits)<input id="capDef" type="number" min="30" step="1" placeholder="No limit" value="${app.defaultMaxAiCredits||''}"></label><button class="btn primary" type="button" id="capSave">Save</button><span class="scr-note small" id="capMsg" role="status"></span></div>${usageSec}</section>`:'';
    const f=mcp.file;
    const fileNote=!f.found?`<p class="scr-note" role="status">No <code>${esc(f.label)}</code> yet. Servers you add with the Copilot CLI (<code>/mcp add</code>) or by editing that file appear here by themselves. The built-in GitHub server is always listed.</p>`
      :f.error?`<p class="scr-note warn" role="status"><code>${esc(f.label)}</code> could not be read (${esc(f.error)}). Fix the file; this list updates the next time you open this screen.</p>`
      :`<p class="scr-note ok" role="status">Read from <code>${esc(f.label)}</code>${f.skipped?` · ${f.skipped} entr${f.skipped>1?'ies were':'y was'} skipped (not usable)`:''}. The list is read again every time this screen opens.</p>`;
    /* Places (spec 024 FR-008): which place the tool calls of each MCP server walk to. Servers: the Copilot CLI list, the names of every saved folder's
       extras, every server seen in tool events this run and any already mapped. */
    /* Agent mood (spec 034 FR-004): Serious mode turns the monster, ambulance and the other drawings off */
    const moodSec=X.bridge.setSeriousMode&&X.isSerious?`<section class="scr-sec" aria-labelledby="moodH"><h3 id="moodH">Agent mood</h3>
        <p class="scr-note">Agent figures get heavier from 70% of their context window and turn into a grumpy monster above 90% (a hint to start a fresh session). Trouble gets a drawing too: an ambulance when a session errors (one at a time), a faint at the spending limit, an agent tapping the desk after 60 s waiting for you, and dizzy stars after 3 failed tool calls in a row. The text and percentages never change. Serious mode turns every drawing off.</p>
        <div class="scr-tools"><span class="swrow" style="display:flex;align-items:center;gap:10px"><b>Serious mode</b> <small>(no mood drawings)</small>${sw(!!X.isSerious(),'Serious mode: no mood drawings on the agent figures','id="seriousSw"')}</span><span class="scr-note small" id="seriousMsg" role="status"></span></div></section>`:'';
    /* spec 052 FR-059: an OS notification when an agent needs you while Durbar is in the background (on for real sessions, off in the demo) */
    const notifySec=X.bridge.setNotifyNeedsMe&&X.isNotify?`<section class="scr-sec" aria-labelledby="ntfH"><h3 id="ntfH">Notifications</h3>
        <p class="scr-note">While Agent Durbar is in the background, one notification tells you when an agent asks for permission, asks a question, reaches its spending limit or hits an error. It shows only the agent's name and a short summary of the request, never file contents. The window title and the app icon show how many need you.</p>
        <div class="scr-tools"><span class="swrow" style="display:flex;align-items:center;gap:10px"><b>Notify me when an agent needs me (when Durbar is in the background)</b>${sw(!!X.isNotify(),'Notify me when an agent needs me (when Durbar is in the background)','id="notifySw"')}</span><span class="scr-note small" id="notifyMsg" role="status"></span></div></section>`:'';
    let placesSec='';
    if(X.bridge.setPlace&&X.places){
      const P=X.places, map=app.placeMap||{};
      /* names of every saved folder's extras (spec 024 FR-016); a missing call or bad data keeps today's list */
      let extra=null;
      if(X.bridge.mcpExtraNames){try{extra=await X.bridge.mcpExtraNames();}catch(e){extra=null;}}
      const names=P.mergePlaceNames(mcp.cli.map(c=>c.name),extra,X.placeServers(),Object.keys(map));
      const mine=X.customPlaces?X.customPlaces():[], mineIds=mine.map(p=>p.id), PI=window.DurbarPlaceIcons;
      const rows=P.placeRows(names,map,mineIds).map(({name:n,aliases,value:v})=>{const note=aliases.length?' also '+aliases.join(', '):'';
        return `<li class="plrow" data-srv="${esc(n)}" data-alias="${esc(aliases.join('\n'))}"><span class="plname" title="${esc(n+note)}">${esc(n)}${note?` <small>${esc(note.trim())}</small>`:''}</span><select data-place-sel aria-label="Place for the tools of ${esc(n)}"><option value=""${v?'':' selected'}>Default (${esc(X.placeLabel(P.defaultServerPlace(n)))})</option>${P.allPlaces(mine).map(p=>`<option value="${esc(p.id)}"${v===p.id?' selected':''}>${esc(X.placeLabel(p.id))}</option>`).join('')}<option value="desk"${v==='desk'?' selected':''}>Stay at desk</option></select></li>`;}).join('');
      placesSec=`<section class="scr-sec" aria-labelledby="plH"><h3 id="plH" tabindex="-1">Places in the office</h3>
        <p class="scr-note">In the lobby, an agent walks to a place while one of its tools runs.</p>
        <details class="scr-more"><summary>More</summary><p class="scr-note small"><b>Terminal</b> for shell commands, <b>Web</b> for web fetches, and the place you choose here for the tools of each MCP server. File tools (read, edit, search) never move an agent. The choice applies to the next tool call, for all folders, and is kept between runs. Only server names and places are saved.</p></details>
        ${X.bridge.addPlace&&PI?`<h4 class="scr-sub">Your places</h4>
        ${mine.length?`<ul class="plrows" id="myPlaces">${mine.map(p=>`<li class="plrow" data-place="${esc(p.id)}"><span class="plname" title="${esc(X.placeLabel(p.id))}"><span class="plico">${PI.iconSvg(p.icon)}</span>${esc(X.placeLabel(p.id))}</span><button class="btn sm" type="button" data-pl-act="edit" aria-label="Edit ${esc(X.placeLabel(p.id))}">Edit</button><button class="btn sm" type="button" data-pl-act="delete" aria-label="Delete ${esc(X.placeLabel(p.id))}">Delete</button></li>`).join('')}</ul>`:'<p class="scr-note small">You have no places of your own yet. Make one for the servers that fit none of the places above.</p>'}
        ${mine.length<3?'<div class="scr-tools"><button class="btn" type="button" data-pl-act="add">Add a place</button></div>':'<p class="scr-note small" id="plCapNote">Up to 3 places of your own.</p>'}
        <h4 class="scr-sub">Where each server goes</h4>`:''}
        ${names.length?`<ul class="plrows" id="plList">${rows}</ul>`:'<p class="scr-note small">No MCP servers yet. They appear here when your Copilot CLI list has some, or after an agent uses one in this run.</p>'}</section>`;
    }
    /* Floors (spec 033 FR-023): the same controls as the top-bar Floors panel, painted by app.js into #floorsSet */
    const floorsSec=X.floors&&X.floors.on()?`<section class="scr-sec" aria-labelledby="flH"><h3 id="flH">Floors</h3>
        <p class="scr-note">Groups of folders: a floor that is <b>off</b> is hidden from the office, but <b>its agents keep running</b> and can spend credits.</p>
        <details class="scr-more"><summary>More</summary><p class="scr-note small">An off floor is not counted in Working, Waiting, Idle, Errors and Done. The office credit total still counts its agents, and an agent there that waits for you or has an error is shown <b>only here</b>, on its floor's row (for example "Off, 1 waiting"). With two or more floors, the same controls are also in the <b>Floors</b> button of the top bar.</p></details>
        <div class="floors-ui floors-set" id="floorsSet" tabindex="-1"></div></section>`:'';
    /* Schedules (spec 044 FR-011): every folder's schedules, painted by app.js into #schedSet */
    const schedSec=X.sched&&X.sched.on()?`<section class="scr-sec" aria-labelledby="schH"><h3 id="schH">Schedules</h3>
        <p class="scr-note">Prompts sent to a folder's agent at a time, every day or at an interval, <b>only while Agent Durbar is open</b>.</p>
        <details class="scr-more"><summary>More</summary><p class="scr-note small">A run is skipped when the agent is busy or waiting for you; the agent's own permission mode and cap apply. A folder's ⋯ menu, its clock in the room header and the Schedules button in its chat open the same list for that folder, with a starter kit of templates.</p></details>
        <div class="sched-set" id="schedSet"></div></section>`:'';
    /* Theme (specs 037-040): pick a built-in or imported pack; applies live, no restart. */
    const curTheme=(app.theme||'clean-office');
    let userThemes=[];
    if(X.bridge.listUserThemes){try{userThemes=(await X.bridge.listUserThemes())||[];}catch(e){userThemes=[];}}
    const themes=(window.THEME?window.THEME.list():[{id:'clean-office',name:'Clean Office'}]).map((t)=>({...t,own:false})).concat(userThemes.filter((u)=>u.ok!==false).map((u)=>({id:u.id,name:u.name||u.id,author:typeof u.author==='string'?u.author:'',own:true})));
    const baseAuthor=(themes.find((t)=>t.id==='clean-office')||{}).author||'Three Feathers'; /* FR-030: a card names its author only when it is not the built-in one */
    const badThemes=userThemes.filter((u)=>u.ok===false);
    const themeSec=`<section class="scr-sec" aria-labelledby="themeH"><h3 id="themeH">Theme</h3>
        <p class="scr-note">The look of the office; the choice applies at once and is kept on this computer.</p>
        <details class="scr-more"><summary>More</summary><p class="scr-note small">Colours, small art and scene words (places, lobby, doors). Status, permission and credit wording never change, and the layout always fits 15 agents at 1280×800. A theme is a folder with a data-only manifest.json (no scripts, no CSS).</p></details>
        <ul class="thlist" id="thList">${themes.map((t)=>{const by=t.author&&t.author!==baseAuthor?t.author:'';const dm=/^Durbar · (.+)$/.exec(t.name||'');return `<li class="throw"><button class="thpick" type="button" data-theme="${esc(t.id)}" aria-pressed="${t.id===curTheme}" aria-label="Theme ${esc(t.name)}${t.own?', yours':''}${by?esc(', by '+by):''}"><span class="thsw" data-theme-sw="${esc(t.id)}" aria-hidden="true"><i class="thsw-wall"></i><i class="thsw-desk"></i><i class="thsw-chair"></i><i class="thsw-ag"></i></span><span class="thtx">${dm?'<span class="thover">Durbar</span>':''}<b title="${esc(t.name)}">${esc(dm?dm[1]:t.name)}</b>${t.own?'<span class="mtag">yours</span>':''}${by?`<small>${esc(by)}</small>`:''}</span></button></li>`;}).join('')}</ul>
        ${badThemes.length?`<p class="scr-note warn" role="status">${badThemes.length} theme folder${badThemes.length>1?'s were':' was'} ignored: ${esc(badThemes.map((b)=>b.id+': '+(b.error||'invalid')).join('; '))}</p>`:''}
        <div class="scr-tools">${X.bridge.generateTheme?'<button class="btn" type="button" id="thAi">Make a theme with AI…</button>':''}<button class="btn" type="button" id="thImport">Import a theme…</button><button class="btn" type="button" id="thExport" title="Copy the active theme's folder (one of your own themes) to a folder you pick">Export the active theme…</button></div></section>`;
    const ab=app.about;
    const aboutSec=ab?`<section class="scr-sec" aria-labelledby="aboutH"><h3 id="aboutH">About</h3>
        <p class="scr-note"><b>${esc(ab.name)}</b> ${esc(ab.version)} · by <b>${esc(ab.owner)}</b></p>
        <p class="scr-note small" id="aboutCredits">Contributors: ${ab.contributors.map(c=>esc(c.label)).join(', ')}</p>
        <p class="scr-note small">${esc(ab.copyright)} · MIT License</p></section>`:'';
    /* spec 051: Settings > Agent apps (install, update, sign in) */
    let hsSec='';
    if(window.DurbarHarnesses&&window.DurbarHarnesses.available()&&X.bridge.listAdapters){
      let kinds=[],cp=null;try{kinds=(await X.bridge.listAdapters(!!X._hsRefresh))||[];}catch(e){kinds=[];}X._hsRefresh=false;
      if(X.bridge.copilotAuth&&kinds.some(k=>k.id==='copilot'&&k.state==='ready')){try{cp=await X.bridge.copilotAuth();}catch(e){cp=null;}}
      hsSec=window.DurbarHarnesses.sectionHTML(kinds,cp);
    }
    /* spec 052 FR-031 (#306): Simple or Expert */
    const dl=X.detail?X.detail.get():'expert';
    const detailSec=X.detail?`<section class="scr-sec" aria-labelledby="detH"><h3 id="detH">Detail level</h3>
        <p class="scr-note">Expert adds tokens, models, context and paths. Permissions work the same in both.</p>
        <div class="seg" role="group" aria-label="Detail level"><button type="button" data-detail="simple" aria-pressed="${dl==='simple'}">Simple</button><button type="button" data-detail="expert" aria-pressed="${dl!=='simple'}">Expert</button></div>${X.density?densityRow():''}${X.liveAct&&X.liveAct.usable()?liveActRow():''}</section>`:'';
    /* spec 074 FR-013 (issue #548): the navigator shortcut, recorded here, checked for clashes, kept for this window */
    const keySec=X.navKey?`<section class="scr-sec" aria-labelledby="keyH"><h3 id="keyH">Keyboard</h3>
        <p class="scr-note">Go to (the navigator) opens from anywhere: a floor, a folder, an agent, or a chat by its number (C and the number).</p>
        <div class="scr-row"><span class="scr-row-l" id="navKeyL">Go to shortcut</span><kbd class="navkey-now" id="navKeyNow">${esc(X.navKey.text())}</kbd><button class="btn" type="button" id="navKeyRec" aria-describedby="navKeyL">Change…</button><button class="btn" type="button" id="navKeyReset"${X.navKey.isDefault()?' disabled':''}>Reset to ${esc(X.navKey.defText())}</button></div>
        <p class="scr-note small" id="navKeyMsg" role="status"></p>
        <p class="scr-note small">Shortcuts the app, text editing or your operating system already use are refused. The list of operating system shortcuts is a known list, not every one there is.</p></section>`:'';
    /* spec 052 FR-066, FR-093: what Durbar does not do, in calm plain words (checked against the README's Safety model and Costs and caps) */
    const notSec=`<section class="scr-sec" aria-labelledby="notH"><h3 id="notH">What Durbar does not do</h3><ul class="scr-not">
        <li>Durbar asks Claude Code and Copilot to stay in their folders but cannot force them; only Codex is held there by the system (in Read-only and Ask first).</li>
        <li>It does not stop a reply halfway: spending limits are checked between replies.</li>
        <li>It does not see your bill; costs are estimates.</li>
        <li>It sends nothing to any server of its own.</li>
        <li>Rooms you hide or switch off still run and cost money.</li></ul></section>`;
    r.innerHTML=head('Settings')+`<div class="scr-body">${hsSec}${detailSec}${keySec}${notSec}${themeSec}${capSec}${moodSec}${notifySec}${schedSec}${floorsSec}${placesSec}
      <details class="scr-adv" id="advMcp"${advOpen?' open':''}><summary><h3 class="scr-adv-h">Advanced: MCP servers (extra tools for agents)</h3></summary>
      <section class="scr-sec" aria-labelledby="mcpH"><h3 id="mcpH" tabindex="-1">MCP servers</h3>
        <p class="scr-note">Every agent gets the servers of your <b>Copilot CLI list</b>, the one global list.</p>
        <details class="scr-more"><summary>More</summary><p class="scr-note small">There is nothing to configure or import here. Each agent can switch single servers off from its own header (MCP button). Claude Code and Codex read their own MCP settings; each agent's <b>MCP</b> item (in its chat's More menu) shows what it uses.</p></details>
        <p class="scr-warn" role="note"><b>MCP servers run local commands with your user rights.</b> The Copilot runtime starts the servers of your CLI list in every session, exactly as the CLI does. Read-only MCP tools can run without asking even in Read-only mode.</p>
        ${fileNote}
        <h4 class="scr-sub">From the Copilot CLI list <small>all agents</small></h4>
        <ul class="srvs" id="ambList">${amb}</ul>
        <p class="scr-note small">You cannot edit these here: change <code>${esc(f.label)}</code> with the Copilot CLI or an editor. The switch only controls whether <b>new</b> sessions started by this app start a server; a running session keeps its servers until it ends, or until you switch one in that agent's MCP menu.</p>
      </section>
      <section class="scr-sec" aria-labelledby="extH"><h3 id="extH">Extras for one folder <small>optional</small></h3>
        <p class="scr-note">Agent Durbar can add its own servers, but <b>only per folder or workspace</b>: open the <b>MCP</b> button in a room's header.</p>
        <details class="scr-more"><summary>More</summary><p class="scr-note small"><b>Folder extras…</b> in an agent's MCP menu opens the same list. Extras apply only to agents in that folder and are never shared with other folders. Switching one on shows its exact command first, and asks again if the command changes.</p></details>
      </section></details>${aboutSec}</div>`;
    wireHead();
    /* spec 051 FR-008: entry points open Settings at Agent apps */
    if(cur.section==='harnesses'){cur.section=null;const h=$('hsH');if(h){scrollInBody(h);h.focus({preventScroll:true});}}
    if($('advMcp')){$('advMcp').ontoggle=()=>{advOpen=$('advMcp').open;};if(cur.section==='mcp'){cur.section=null;const h=$('mcpH');if(h){scrollInBody(h);h.focus({preventScroll:true});}}}
    if(X.floors&&$('floorsSet'))X.floors.render();
    if($('navKeyRec'))wireNavKey();
    if(X.sched&&$('schedSet'))X.sched.render();
    if($('capSave'))$('capSave').onclick=async()=>{
      const v=parseFloat($('capDef').value),msg=$('capMsg');
      if($('capDef').value.trim()!==''&&!(v>=30&&v<=1e6)){msg.textContent='Enter a number from 30 (the runtime minimum), or leave it empty for no cap.';return;}
      const res=await X.bridge.setDefaultCap($('capDef').value.trim()===''?null:Math.round(v*100)/100);
      if(X.onSettings)X.onSettings({defaultMaxAiCredits:res&&res.defaultMaxAiCredits});
      msg.textContent=res&&res.defaultMaxAiCredits?'Saved: new sessions start with a cap of '+res.defaultMaxAiCredits+' AIU.':'Saved: new sessions start without a cap.';
    };
    if($('usageTotalsReset'))$('usageTotalsReset').onclick=async()=>{
      const ok=await dialog({title:'Reset usage totals?',html:'<p class="dsub">This sets the saved office and folder totals to zero and starts counting from now. Tool counts in Tools &gt; All time are not changed, and neither are your agents or their history.</p>',buttons:[{label:'Cancel',value:null},{label:'Reset',value:'ok',cls:'primary danger'}]});
      if(!ok)return;
      let v=null; try{v=await X.bridge.usageResetTotals();}catch(e){v=null;}
      if(v&&v.ok){X.onUsageReset(v);X.toast('Usage totals were reset.',2600);paintSettings();}
      else{const m=$('usageTotalsMsg');if(m)m.textContent='Could not reset the totals.';}
    };
    r.onclick=onSettingsClick;
    r.onchange=onPlaceChange;
    /* theme picker (spec 037): click applies live through app.js's applyTheme; no restart */
    /* spec 037 FR-014: each swatch shows its own theme's colours (validated colour values set through CSSOM) */
    /* FR-030 (#309): a mini room per card; previewRoom returns only validated colour values, set as custom properties through CSSOM */
    if($('thList')&&window.THEME&&window.THEME.previewRoom)$('thList').querySelectorAll('[data-theme-sw]').forEach((sw)=>{
      const c=window.THEME.previewRoom(sw.dataset.themeSw);
      for(const k of Object.keys(c))sw.style.setProperty('--sw-'+k,c[k]);
    });
    if($('thList'))$('thList').addEventListener('click',(e)=>{
      const b=e.target.closest&&e.target.closest('[data-theme]');if(!b||!X.applyTheme)return;
      X.applyTheme(b.dataset.theme);
      /* spec 040 FR-019: the list shows the new choice at once (it was only repainted when Settings reopened) */
      $('thList').querySelectorAll('[data-theme]').forEach((x)=>x.setAttribute('aria-pressed',String(x===b)));
    });
    if($('thImport'))$('thImport').onclick=async()=>{
      if(!X.bridge.importTheme)return;
      const res=await X.bridge.importTheme().catch(()=>null);
      if(!res||!res.ok){X.toast(esc(res&&res.error||'The theme folder could not be imported (cancelled or not a valid pack).'),4200);return;}
      X.toast('Theme <b>'+esc(res.name||res.id)+'</b> imported.',3200);
      if(X.applyTheme)X.applyTheme(res.id);
      paintSettings();
    };
    if($('thAi'))$('thAi').onclick=()=>aiTheme(curTheme);
    if($('thExport'))$('thExport').onclick=async()=>{
      if(!X.bridge.exportTheme)return;
      /* spec 040 FR-019: the theme active NOW, not the one when Settings was painted; a built-in one says why it cannot be exported */
      const active=(window.THEME&&window.THEME.current&&window.THEME.current().id)||curTheme;
      if(window.THEME&&window.THEME.list().some((t)=>t.id===active&&!userThemes.some((u)=>u.id===active))){
        X.toast(esc((window.THEME.list().find((t)=>t.id===active)||{name:active}).name)+' is built into the app, so there is nothing to export. Pick one of your own themes (marked "yours") first, or make one with AI.',6000);return;
      }
      const res=await X.bridge.exportTheme(active).catch(()=>null);
      if(!res||!res.ok){X.toast(esc(res&&res.error||'Export did not work (cancelled, or only your own themes can be exported).'),4200);return;}
      X.toast('Theme copied to <b>'+esc(res.to)+'</b>.',4200);
    };
    if(focus){const h=r.querySelector('h2');if(h){h.tabIndex=-1;h.focus({preventScroll:true});}}
  }
  /* spec 040 FR-014..FR-018: AI theme maker. Describe -> one prompt to a harness with `oneShot` -> a checked manifest ->
     preview (Try it, live, not saved) -> Save as my theme, Try again or Discard (back to the theme that was active). User text is never logged. */
  /* spec 040 FR-015: AI credits a Copilot generation reported (1e9 nano = 1 credit) */
  const aiCredits=(nano)=>(Number(nano)/1e9).toFixed(2);
  async function aiTheme(){
    const before=(window.THEME&&window.THEME.current&&window.THEME.current().id)||'clean-office';
    let kinds=[];
    if(X.bridge.listAdapters){try{kinds=((await X.bridge.listAdapters())||[]).filter((k)=>k&&k.state==='ready'&&k.capabilities&&k.capabilities.oneShot);}catch(e){kinds=[];}}
    if(!kinds.length){await dialog({title:'Make a theme with AI',html:'<p class="dsub">This needs Claude Code, OpenAI Codex or GitHub Copilot, installed and signed in on this computer.</p>',buttons:[{label:'Close',value:'ok',cls:'primary'}]});return;}
    let desc='',kind=kinds[0].id;
    /* spec 052 FR-093: the cost line names only the app picked in "Made by", and follows the selection */
    const aiCostLine=(id)=>{const k=kinds.find((x)=>x.id===id)||kinds[0], n=k.displayName||k.id;
      return 'Uses your own '+n+' account: '+(k.id==='claude'?'a small cost (at most $0.25, usually about a cent).':k.id==='copilot'?'a few AI credits from your plan.':k.id==='codex'?'a small part of your ChatGPT plan\'s usage.':'a small cost on your own plan.');};
    /* spec 040 FR-021: a few example looks at random, so people see how to describe one */
    let ideas=[];
    if(X.bridge.themeIdeas){try{ideas=(await X.bridge.themeIdeas())||[];}catch(e){ideas=[];}}
    const pick=()=>{const p=ideas.slice(),o=[];while(o.length<4&&p.length)o.push(p.splice(Math.floor(Math.random()*p.length),1)[0]);return o;};
    const ideaHtml=()=>ideas.length?`<div class="ai-ideas" id="aiIdeas"><span class="scr-note small">Ideas:</span>${pick().map((i)=>`<button class="btn ai-idea" type="button" data-idea="${esc(i)}">${esc(i)}</button>`).join('')}<button class="btn ai-more" type="button" id="aiMore" title="Show other ideas">More ideas</button></div>`:'';
    for(;;){
      const r=await dialog({title:'Make a theme with AI',size:'m',html:`<p class="dsub">Describe a look in a few words, for example “a night-shift newsroom” or “a ship's bridge at dawn”.</p>
        <ul class="dlist ai-pts"><li>One request, small cost</li><li>No tools, nothing kept</li><li>Preview before saving</li></ul>
        <p class="scr-note small">The agent app you pick designs a light or dark theme. Durbar keeps only safe values and checks that text stays readable.</p>
        <label>Look<textarea id="aiDesc" rows="3" maxlength="300" placeholder="A calm library at night">${esc(desc)}</textarea></label>
        ${ideaHtml()}
        <label>Made by<select id="aiKind">${kinds.map((k)=>`<option value="${esc(k.id)}"${k.id===kind?' selected':''}>${esc(k.displayName||k.id)}</option>`).join('')}</select></label>
        <p class="scr-note small" id="aiCost">${esc(aiCostLine(kind))}</p>`,
        buttons:[{label:'Cancel',value:null},{label:'Make the theme',value:'go',cls:'primary'}],
        validate:(d)=>{const v=d.querySelector('#aiDesc').value.trim();return v.length<3?'Describe the look in a few words.':false;},
        onOpen:(d)=>{const t=d.querySelector('#aiDesc');t.addEventListener('input',()=>{desc=t.value;});
          d.addEventListener('click',(e)=>{const b=e.target.closest&&e.target.closest('.ai-idea');if(b){t.value=b.dataset.idea;desc=t.value;t.focus();return;}
            if(e.target.closest&&e.target.closest('#aiMore')){const box=d.querySelector('#aiIdeas');if(box)box.outerHTML=ideaHtml();}});d.querySelector('#aiKind').addEventListener('change',(e)=>{kind=e.target.value;const c=d.querySelector('#aiCost');if(c)c.textContent=aiCostLine(kind);});}});
      if(!r||r.value!=='go')return;
      const busy=X.toast?X.toast('Making the theme… this can take up to a minute.',60000):null;
      let g=null;
      try{g=await X.bridge.generateTheme(desc.trim(),kind);}catch(e){g={ok:false,error:String(e&&e.message||e)};}
      if(busy&&busy.remove)busy.remove();
      if(!g||!g.ok){
        const again=await dialog({title:'No theme this time',html:`<p class="dsub">${esc((g&&g.error)||'Unknown error.')}</p>${g&&g.costUsd?`<p class="scr-note small">Cost: about $${esc(g.costUsd.toFixed(4))} (estimate).</p>`:''}${g&&g.nanoAiu?`<p class="scr-note small">Used ${esc(aiCredits(g.nanoAiu))} AI credits (as reported by Copilot).</p>`:''}`,buttons:[{label:'Close',value:null},{label:'Try again',value:'again',cls:'primary'}]});
        if(again&&again.value==='again')continue;return;
      }
      const m=g.manifest, toks=m.tokens||{}, hex=/^#[0-9a-f]{3,6}$/i;
      const swatches=['--bg','--surface','--ink','--sage','--blue','--amber','--brand-bg','--desk'].filter((k)=>hex.test(toks[k]||'')).map((k)=>`<span class="ai-sw" title="${esc(k)}" data-col="${esc(toks[k])}"></span>`).join('');
      /* spec 052 (2026-10-21, round 1): say what each word renames (the Clean Office word), never the internal key such as place-library */
      const plain=(k)=>String(window.THEME&&window.THEME.plainWord?window.THEME.plainWord(k):k).split(':')[0];
      const words=Object.entries(m.words||{}).map(([k,v])=>`<li><small>${esc(plain(k))}</small> ${esc(v)}</li>`).join('');
      const lookId=(id)=>id==='clean'||id==='office'?'clean-office':id==='pixel'?'retro':/^court-/.test(String(id))?'durbar-'+String(id).slice(6):id; /* style / scene kit -> the built-in theme it comes from */
      const lookName=(id)=>{const t=window.THEME&&window.THEME.list?window.THEME.list().find((x)=>x.id===lookId(id)):null;return t?t.name:String(id||'');};
      for(;;){
        const pick=await dialog({title:'Theme: '+m.name,wide:true,html:`<div class="ai-sws" aria-hidden="true">${swatches}</div>
          <p class="dsub">Built on the <b>${esc(lookName(m.ui))}</b> look, with <b>${esc(lookName(m.scene))}</b> people and furniture; ${Object.keys(toks).length} colours.${g.costUsd?` Made for about $${esc(g.costUsd.toFixed(4))} (estimate).`:''}${g.nanoAiu?` Used ${esc(aiCredits(g.nanoAiu))} AI credits (as reported by Copilot).`:''}</p>
          ${words?`<ul class="ai-words">${words}</ul>`:''}
          ${g.warnings&&g.warnings.length?`<p class="scr-note small">${esc(g.warnings.join('; '))}.</p>`:''}
          <p class="scr-note small">Try it shows it now without saving. Discard goes back to the theme you had.</p>`,
          buttons:[{label:'Discard',value:null},{label:'Try again',value:'again'},{label:'Try it',value:'try'},{label:'Save as my theme',value:'save',cls:'primary'}],
          onOpen:(d)=>d.querySelectorAll('[data-col]').forEach((el)=>{if(hex.test(el.dataset.col))el.style.background=el.dataset.col;})}); /* CSSOM, validated hex only */
        const choice=pick&&pick.value;
        if(choice==='try'){
          /* spec 040 FR-021: look at it in the real office: Settings closes, a small bar offers Save / Details / Try again / Discard */
          if(X.previewTheme)X.previewTheme(m);
          close();
          const next=await tryBar(m.name);
          if(next==='save'||next==='details'){open('settings');await new Promise((r)=>setTimeout(r,60));}
          if(next==='details')continue;
          if(next==='save'){
            const res=await X.bridge.saveGeneratedTheme(m).catch(()=>null);
            if(!res||!res.ok){X.toast(esc((res&&res.error)||'The theme could not be saved.'),5000);if(X.previewTheme)X.previewTheme(before);return;}
            if(X.applyTheme)X.applyTheme(res.id);
            X.toast('Theme <b>'+esc(res.name||res.id)+'</b> saved. It is in the list as one of yours.',3600);
            paintSettings();return;
          }
          if(X.previewTheme)X.previewTheme(before);
          if(next==='again'){open('settings');await new Promise((r)=>setTimeout(r,60));break;}
          return;
        }
        if(choice==='save'){
          const res=await X.bridge.saveGeneratedTheme(m).catch(()=>null);
          if(!res||!res.ok){X.toast(esc((res&&res.error)||'The theme could not be saved.'),5000);continue;}
          if(X.applyTheme)X.applyTheme(res.id);
          X.toast('Theme <b>'+esc(res.name||res.id)+'</b> saved. It is in the list as one of yours.',3600);
          paintSettings();return;
        }
        if(X.previewTheme)X.previewTheme(before); /* Discard or Try again: back to the theme that was active */
        if(choice==='again')break;
        return;
      }
    }
  }
  /* the "trying a theme" bar over the live office; resolves 'save' | 'details' | 'again' | 'discard' (Escape) */
  function tryBar(name){
    return new Promise((resolve)=>{
      const old=document.getElementById('aiTryBar');if(old)old.remove();
      const b=document.createElement('div');b.id='aiTryBar';b.className='ai-trybar';b.setAttribute('role','dialog');b.setAttribute('aria-label','Trying a theme');
      b.innerHTML=`<span>Trying <b></b>. Nothing is saved yet.</span><button class="btn" type="button" data-t="discard">Discard</button><button class="btn" type="button" data-t="again">Try again</button><button class="btn" type="button" data-t="details">Details</button><button class="btn primary" type="button" data-t="save">Save as my theme</button>`;
      b.querySelector('b').textContent=name;
      const done=(v)=>{b.remove();document.removeEventListener('keydown',onKey,true);resolve(v);};
      const onKey=(e)=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();done('discard');}};
      b.addEventListener('click',(e)=>{const t=e.target.closest&&e.target.closest('[data-t]');if(t)done(t.dataset.t);});
      document.addEventListener('keydown',onKey,true);
      document.body.appendChild(b);
      b.querySelector('[data-t="save"]').focus();
    });
  }
  /* one server of the Copilot CLI list (or the built-in one): read-only, with its exact command/URL and a switch for new sessions */
  function cliRow(a){
    const run=a.command||a.url?(a.transport==='stdio'||a.command?[a.command].concat(a.args||[]).join(' '):a.url):'';
    return `<li class="srv amb" data-amb="${esc(a.name)}"><div class="srv-main"><div class="srv-top"><b class="srv-name">${esc(a.name)}</b><span class="mtag src">${a.origin==='builtin'?'built-in':'Copilot CLI list'}</span>${a.transport?`<span class="mtag">${esc(a.transport)}</span>`:''}</div>
      ${run?`<code class="srv-cmd" title="${esc(run)}">${esc(cap(run,180))}</code>`:''}</div>
      <div class="srv-act">${sw(a.enabled,(a.enabled?'Switch off ':'Switch on ')+a.name+' for new sessions','data-act="amb"')}</div></li>`;
  }
  const secretChip=(kind,s)=>`<span class="sec" title="${kind==='env'?'Environment variable':'Header'}: ${s.set?'value stored, hidden':'no value'}">${esc(s.key)}<i>${s.set?'••••••':'not set'}</i></span>`;
  /* spec 052 FR-099 (round 10): Spacing, under Detail level; Compact tightens the chat, screens, dialogs and inbox (never the office) */
  function densityRow(){
    const d=X.density.get();
    return `<div class="scr-row"><span class="scr-row-l" id="denL">Spacing</span><div class="seg" role="group" aria-labelledby="denL"><button type="button" data-density="comfortable" aria-pressed="${d!=='compact'}">Comfortable</button><button type="button" data-density="compact" aria-pressed="${d==='compact'}" title="Tighter chat, screens, dialogs and inbox. The office and the top bar keep their sizes.">Compact</button></div></div>`;
  }
  /* spec 001 FR-032: the live readout on the desks (thinking, tool, reply), on by default; kept per computer like Spacing */
  function liveActRow(){
    const on=!!X.liveAct.get();
    return `<div class="scr-row"><span class="scr-row-l" id="laL">Live activity on desks</span>${sw(on,'Live activity on desks: what each working agent is thinking or doing, on its desk','id="liveActSw" aria-describedby="laN"')}<span class="scr-note small" id="laN">What each working agent is thinking or doing, on its desk. Secrets are masked.</span></div>`;
  }
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
    if(res&&res.ok){X.setPlaceMap(res.placeMap||{});X.toast(esc(name)+': '+(sel.value===''?'back to the default place.':sel.value==='desk'?'agents stay at their desk.':'agents go to '+esc(X.placeLabel(sel.value))+'.'),3200);}
    else X.toast('Could not save the place for '+esc(name)+'.',4200);
  }
  /* ---------------- your own places (spec 024 FR-023, FR-024) ---------------- */
  const PLACE_ERR={'name-empty':'Type a name for the place.','name-long':'Use 24 characters or fewer.','name-taken':'A place with this name already exists.','name-invalid':'The name cannot have line breaks or other control characters.',icon:'Pick one of the icons.',limit:'Up to 3 places of your own.',unknown:'That place could not be saved. It may have been deleted.'};
  /* The Add / Edit dialog. `existing` = {id,name,icon} to edit, or null to add. Resolves the saved result, or null. */
  async function placeDialog(existing){
    const PI=window.DurbarPlaceIcons;
    if(!X||!PI||!(existing?X.bridge.updatePlace:X.bridge.addPlace))return null;
    const opener=document.activeElement, icon0=existing?existing.icon:'star';
    let saved=null;
    const radios=PI.LIST.map(i=>`<label class="pico-opt"><input type="radio" name="plIcon" value="${i.id}"${i.id===icon0?' checked':''}><span class="pico" aria-hidden="true">${i.svg}</span><span class="pico-sr">${i.label}</span></label>`).join('');
    const html=`<label>Name<input id="plName" type="text" autocomplete="off" spellcheck="false" value="${esc(existing?existing.name:'')}" aria-describedby="plNameHelp plNameErr"></label>
      <p class="dsub small" id="plNameHelp">Up to 24 characters.</p><p class="pl-err" id="plNameErr" role="alert" hidden></p>
      <div class="pico-grid" role="radiogroup" aria-label="Icon">${radios}</div>`;
    const r=await dialog({title:existing?'Edit place':'Add a place',size:'m',html,buttons:[{label:'Cancel',value:null},{label:'Save',value:'ok',cls:'primary'}],
      onOpen:d=>{const inp=d.querySelector('#plName');inp.addEventListener('keydown',ev=>{if(ev.key==='Enter'){ev.preventDefault();d.querySelector('.dbtn .primary').click();}});inp.addEventListener('input',()=>{d.querySelector('#plNameErr').hidden=true;});},
      validate:async d=>{
        const name=d.querySelector('#plName').value, ic=(d.querySelector('input[name="plIcon"]:checked')||{}).value;
        let res=null;
        try{res=existing?await X.bridge.updatePlace(existing.id,{name,icon:ic}):await X.bridge.addPlace(name,ic);}catch(err){res=null;}
        if(res&&res.customPlaces){X.setCustomPlaces(res.customPlaces,res.placeMap);if(cur&&cur.kind==='settings')paintSettings();}
        if(res&&res.ok){saved=res;return '';}
        const e=d.querySelector('#plNameErr');e.textContent=PLACE_ERR[res&&res.error]||PLACE_ERR.unknown;e.hidden=false;
        d.querySelector(res&&res.error&&/^name-/.test(res.error)?'#plName':'.dbtn .primary').focus();
        return true;
      }});
    if(!r||!saved){if(opener&&opener.focus&&document.contains(opener))opener.focus();return null;}
    const id=existing?existing.id:saved.place&&saved.place.id;
    if(cur&&cur.kind==='settings'){await paintSettings();const b=document.querySelector(`#myPlaces li[data-place="${CSS.escape(id)}"] [data-pl-act="edit"]`);if(b)b.focus();}
    else{await new Promise(r=>requestAnimationFrame(()=>setTimeout(r,80)));const t=document.querySelector('.place-add')||document.querySelector(`#stage .place[data-place="${CSS.escape(id)}"]`);if(t)t.focus();} /* from the lobby: the Add button, or the new tile once the cap took the button away */
    X.toast(esc(existing?'Saved '+saved.customPlaces.find(p=>p.id===existing.id).name+'.':'Added '+(saved.place?saved.place.name:'the place')+'. Choose its servers in Settings > Places.'),3200);
    return saved;
  }
  async function deletePlace(id){
    const opener=document.activeElement;
    const p=(X.customPlaces?X.customPlaces():[]).find(x=>x.id===id); if(!p||!X.bridge.removePlace)return;
    const map=X.placeMap?X.placeMap():{}, srv=Object.keys(map).filter(k=>map[k]===id).sort();
    const b=n=>'<b>'+esc(n)+'</b>', shown=srv.slice(0,4).map(b), more=srv.length-shown.length;
    const list=more>0?shown.join(', ')+' and '+more+' more':shown.length>1?shown.slice(0,-1).join(', ')+' and '+shown[shown.length-1]:shown[0];
    const body=srv.length?`${list} ${srv.length>1?'go':'goes'} back to ${srv.length>1?'their':'its'} default place.`:'No server is sent there.';
    const r=await dialog({title:'Delete "'+X.placeLabel(p.id)+'"?',html:`<p class="dsub">${body} Agents that are there now walk back to their desks.</p>`,buttons:[{label:'Cancel',value:null},{label:'Delete',value:'ok',cls:'primary danger'}]});
    if(!r){if(opener&&opener.focus&&document.contains(opener))opener.focus();return;}
    const label=X.placeLabel(p.id); /* before setCustomPlaces: afterwards the place is gone and the label is empty */
    let res=null; try{res=await X.bridge.removePlace(id);}catch(err){res=null;}
    if(res&&res.customPlaces)X.setCustomPlaces(res.customPlaces,res.placeMap);
    if(res&&res.ok)X.toast(esc(label)+' was deleted.',3200); else X.toast('Could not delete '+esc(label)+'.',4200);
    await paintSettings();
    const nb=document.querySelector('#myPlaces ~ .scr-tools [data-pl-act="add"], .scr-tools [data-pl-act="add"]')||document.getElementById('plH'); if(nb)nb.focus(); /* the Add button, or the Places heading */
  }
  /* spec 074 FR-013 / FR-014: Change… records the next key combination; Escape cancels; a refused one says why */
  function wireNavKey(){
    const rec=$('navKeyRec'),msg=$('navKeyMsg'),now=$('navKeyNow'),reset=$('navKeyReset');
    let onKey=null;
    const stop=()=>{if(onKey)window.removeEventListener('keydown',onKey,true);onKey=null;X.navKey.recording(false);rec.textContent='Change…';rec.setAttribute('aria-pressed','false');};
    const show=t=>{now.textContent=X.navKey.text();reset.disabled=X.navKey.isDefault();msg.textContent=t;};
    rec.onclick=()=>{
      if(onKey){stop();msg.textContent='Not changed.';return;}
      X.navKey.recording(true);rec.textContent='Press the keys… (Esc to cancel)';rec.setAttribute('aria-pressed','true');msg.textContent='Press the new shortcut now.';
      onKey=e=>{
        if(e.key==='Escape'&&!e.ctrlKey&&!e.metaKey&&!e.altKey&&!e.shiftKey){e.preventDefault();e.stopPropagation();stop();msg.textContent='Not changed.';rec.focus();return;}
        if(e.key==='Tab'&&!e.ctrlKey&&!e.metaKey&&!e.altKey)return; /* Tab still leaves the button */
        const c=X.navKey.fromEvent(e); if(!c)return; /* a modifier alone: wait for the key */
        e.preventDefault();e.stopPropagation();
        const why=X.navKey.clash(c);
        if(why){msg.textContent=X.navKey.textOf(c)+' cannot be used. '+why+' Try another, or press Esc.';return;}
        stop();X.navKey.set(c);show('Saved: '+X.navKey.text()+' opens Go to.');rec.focus();
      };
      window.addEventListener('keydown',onKey,true);
    };
    rec.onblur=()=>{if(onKey){stop();msg.textContent='Not changed.';}};
    reset.onclick=()=>{X.navKey.set(null);show('Back to '+X.navKey.text()+'.');rec.focus();};
  }
  async function onSettingsClick(e){
    const pa=e.target.closest('[data-pl-act]');
    if(pa){
      const li=pa.closest('li'), id=li&&li.dataset.place, act=pa.dataset.plAct;
      if(act==='add')await placeDialog(null);
      else if(act==='edit'){const p=(X.customPlaces?X.customPlaces():[]).find(x=>x.id===id);if(p)await placeDialog(p);}
      else if(act==='delete')await deletePlace(id);
      return;
    }
    if(window.DurbarHarnesses&&window.DurbarHarnesses.onClick(e))return;
    const dlb=e.target.closest('[data-detail]');
    if(dlb&&X.detail){X.detail.set(dlb.dataset.detail);paint();return;}
    const dnb=e.target.closest('button[data-density]');
    if(dnb&&X.density){X.density.set(dnb.dataset.density);const g=dnb.parentElement;if(g)g.querySelectorAll('[data-density]').forEach(b=>b.setAttribute('aria-pressed',String(b===dnb)));return;}
    const ss=e.target.closest('#seriousSw');
    if(ss&&X.bridge.setSeriousMode){
      const on=ss.getAttribute('aria-checked')!=='true';
      let res=null; try{res=await X.bridge.setSeriousMode(on);}catch(err){res=null;}
      if(res&&res.ok){X.setSerious(!!res.seriousMode);ss.classList.toggle('on',!!res.seriousMode);ss.setAttribute('aria-checked',res.seriousMode?'true':'false');const m=$('seriousMsg');if(m)m.textContent=res.seriousMode?'Serious mode is on: no mood drawings.':'Serious mode is off.';}
      return;
    }
    const la=e.target.closest('#liveActSw');
    if(la&&X.liveAct){const on=!X.liveAct.get();X.liveAct.set(on);la.classList.toggle('on',on);la.setAttribute('aria-checked',on?'true':'false');return;}
    const ns=e.target.closest('#notifySw');
    if(ns&&X.bridge.setNotifyNeedsMe){
      const on=ns.getAttribute('aria-checked')!=='true';
      let res=null; try{res=await X.bridge.setNotifyNeedsMe(on);}catch(err){res=null;}
      if(res&&res.ok){const v=!!res.notifyNeedsMe;if(X.setNotify)X.setNotify(v);ns.classList.toggle('on',v);ns.setAttribute('aria-checked',v?'true':'false');const m=$('notifyMsg');if(m)m.textContent=v?'Notifications are on.':'Notifications are off.';}
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
        <p class="scr-note">These servers are optional and belong to <b>this folder only</b>: agents in other folders do not get them. Servers from your Copilot CLI list are available to every agent and are not edited here.</p>
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
    $('fxSettings').onclick=()=>open('settings',{section:'mcp'});
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
        const r=await dialog({title:'Remove old server "'+n+'"?',html:'<p class="dsub">It is deleted from Agent Durbar with its stored secret values. It was not being used.</p>',buttons:[{label:'Cancel',value:null},{label:'Remove',value:'ok',cls:'primary danger'}]});
        if(r){await X.bridge.mcpRemoveLegacy(n);paintFolder();}
      }
      return;
    }
    const name=li.dataset.name,v=st.servers.find(x=>x.name===name);if(!v)return;
    if(act.act==='toggle'){const turnOn=!(v.enabled&&v.trusted);await toggleServer(v,turnOn,st);}
    else if(act.act==='edit')editServer(v,st);
    else if(act.act==='remove'){
      const r=await dialog({title:'Remove "'+name+'"?',html:'<p class="dsub">The server and its stored secret values are deleted from this folder in Agent Durbar. Running sessions keep it until they end.</p>',buttons:[{label:'Cancel',value:null},{label:'Remove',value:'ok',cls:'primary danger'}]});
      if(r){await X.bridge.mcpRemove(st.key,name);X.toast('Removed '+esc(name)+'.',2600);paintFolder();}
    }
  }
  async function toggleServer(v,turnOn,st){
    let r=await X.bridge.mcpSetEnabled(st.key,v.name,turnOn,false);
    if(r&&r.needsTrust){
      const t=r.needsTrust;
      const run=t.transport==='stdio'?[t.command].concat(t.args||[]).join(' '):t.url;
      const ok=await dialog({title:'Trust "'+t.name+'" in '+st.name+'?',wide:true,html:`<p class="dsub"><b>This will run a program on your computer</b> every time a session starts in <b>${esc(st.name)}</b>, with your user rights, and give it access to what you pass in its environment. Agents there will be able to call its tools${t.transport==='stdio'?'':' (a remote server: requests and your header values go to that URL)'}.</p>
        ${t.transport==='stdio'?'':'<p class="dsub">If this server asks you to sign in, the agent app may keep that sign-in in your system keychain after the session ends (Copilot does).</p>'}
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
  /* spec 058 FR-023: what Restart session costs, said before it runs; null when there is nothing to ask (idle, no grants, no remote control) */
  function restartSessionAsk(a){
    const busy=a.state==='working'||a.state==='thinking'||a.state==='waiting', grants=Array.isArray(a.grants)&&a.grants.length>0, remote=!!a.remote;
    if(!busy&&!grants&&!remote)return null;
    return ['The conversation is kept and resuming spends no AI credits.',busy?'The running turn stops.':'','"Approve for this session" grants are cleared.',remote?'Remote control turns off.':''].filter(Boolean);
  }
  let mcpDlgHook=null; /* set while a per-agent MCP dialog is open: called with an agent id on each `mcp` event */
  async function copyText(text,okMsg,ms){
    try{
      if(!navigator.clipboard||!navigator.clipboard.writeText)throw new Error('no clipboard');
      await navigator.clipboard.writeText(text);
      X.toast(okMsg,ms||2400).classList.add('ok');
    }catch(e){X.toast('Could not copy to the clipboard.',3200).classList.add('err');}
  }
  async function agentMcp(a,o){
    if(!X.bridge.agentMcp)return;
    const fixed=!!o&&o.toggle===false; /* this agent kind cannot switch servers while it runs (spec 012 FR-067): shown, with the reason */
    const noServerRestart=!!o&&o.restart===false; /* spec 058 FR-032: e.g. Codex: no per-server Restart, only Restart session */
    const load=async()=>X.bridge.agentMcp(a.id);
    let st=await load();
    const restarting=new Set(); /* server names whose Restart is under way (FR-031: the button stays disabled) */
    const openDet=new Set(); /* server names whose Details are open (kept over a repaint) */
    let sessBusy=false;
    const body=s=>{
      const rows=s.servers.map(x=>{
        const eff=x.defaultOn&&!x.off;
        const W=window.DurbarMcpWords, sv=W.stateOf(x.status);
        const stat=`<span class="mst ${esc(sv.cls)}"${x.status&&sv.cls==='unknown'?` title="${esc(W.plain(x.status,120))}"`:''}>${W.iconSvg(sv.icon)}<span class="mst-w">${esc(sv.word)}</span></span>`;
        const hint=W.hintFor({status:x.status,errorClass:x.errorClass,error:x.error,app:s.app||o&&o.appName});
        const detOpen=x.error&&openDet.has(x.name);
        /* FR-007: the masked text (main masked it; never the runtime's raw text) behind Details, and Copy copies exactly that */
        const det=x.error?`<button class="btn sm srv-detbtn" type="button" data-det="${esc(x.name)}" aria-expanded="${detOpen?'true':'false'}" aria-label="${esc((detOpen?'Hide':'Show')+' details of '+x.name)}">Details</button>`:'';
        const detBox=detOpen?`<div class="srv-det"><pre class="srv-err" tabindex="0" data-err="${esc(x.name)}" aria-label="${esc('Error text of '+x.name)}">${esc(x.error)}</pre><button class="btn sm" type="button" data-copy="${esc(x.name)}" aria-label="${esc('Copy the error text of '+x.name)}">Copy</button></div>`:'';
        const rs=x.canRestart&&X.bridge.agentMcpRestart?(restarting.has(x.name)?`<button class="btn sm" type="button" disabled aria-label="${esc('Restarting '+x.name+' for '+a.name)}">Restarting…</button>`:`<button class="btn sm" type="button" data-restart="${esc(x.name)}" aria-label="${esc('Restart '+x.name+' for '+a.name)}" title="Restart only this server in this session">Restart</button>`):'';
        return `<li class="srv sm" data-n="${esc(x.name)}"><div class="srv-main"><div class="srv-top"><b class="srv-name" title="${esc(W.plain(x.name,120))}">${esc(x.name)}</b><span class="mtag${x.origin==='folder'?' extra':' src'}">${x.origin==='cli'?'Copilot CLI list':x.origin==='folder'?'this folder only':'runtime'}</span>${stat}${!x.defaultOn?`<span class="mtag">${x.origin==='folder'?'off in folder extras':'off in Settings'}</span>`:''}</div>${hint?`<span class="srv-hint">${esc(hint)}</span>`:''}${det}${detBox}</div>
          <div class="srv-act">${rs}${sw(eff,(eff?'Switch off ':'Switch on ')+x.name+' for '+a.name,'data-n="'+esc(x.name)+'"'+(!x.defaultOn||fixed?' disabled':''))}</div></li>`;}).join('');
      /* FR-022 / FR-030 / FR-032: Restart session lives only here (Q10) */
      const rsess=s.canRestartSession&&X.bridge.agentMcpRestartSession?`<div class="mcp-rsess"><button class="btn sm" type="button" id="mcpRestartSess"${sessBusy?' disabled':''}>${sessBusy?'Restarting session…':'Restart session with these servers'}</button><span class="dsub small">${noServerRestart?esc(o.appName||'This agent app')+' cannot restart one server; use this instead. ':''}Ends this session and resumes it with the servers in Settings and the folder's extras. The conversation is kept.${s.start==='next-message'?' The servers start with your next message.':''}</span></div>`:'';
      return `<p class="dsub">${s.live?(fixed?'This agent is running.':s.toggleApplies==='next-message'?'This agent is running: a switch applies from your next message.':'This agent is running: a switch applies right away.'):'This agent has no running session: your choices apply when it starts.'} Your Copilot CLI servers are global (see <b>Settings</b>); extras belong to this agent's folder only. Here you can only switch one off for <b>${esc(a.name)}</b>.</p>${fixed?'<p class="dsub" role="note"><b>The switches are off for this agent app:</b> it cannot change its MCP servers while it runs. They are set when the session starts.</p>':''}<ul class="srvs" id="agMcp">${rows||'<li class="scr-empty">No MCP servers.</li>'}</ul>${rsess}<p class="dsub small">Applies to this agent until the app is closed.</p>`;
    };
    let dlg=null;
    /* FR-004 / FR-033: repaint in place and keep the focus on the same control (by server name), so a keyboard user is not thrown out */
    /* what the dialog last showed per server: a repaint compares with it and updates it, so a user's own change (switch, Details, Restart) is never announced later */
    let seen=new Map(st.servers.map(x=>[x.name,x.status||'']));
    const repaint=async()=>{st=await load();if(!dlg||!dlg.isConnected)return [];
      const f=document.activeElement,inside=f&&dlg.contains(f);
      const key=!inside?null:f.dataset.restart!==undefined?['restart',f.dataset.restart]:f.dataset.det!==undefined?['det',f.dataset.det]:f.dataset.copy!==undefined?['copy',f.dataset.copy]:f.dataset.err!==undefined?['err',f.dataset.err]:f.dataset.n!==undefined?['n',f.dataset.n]:f.id?['id',f.id]:null;
      const errTop=key&&key[0]==='err'?f.scrollTop:0;
      const bodyEl=dlg.querySelector('.dbody'),top=bodyEl.scrollTop;
      bodyEl.innerHTML=body(st);bodyEl.scrollTop=top; /* FR-004: the scroll position stays */
      if(key){
        const pre=key[0]==='err'?[...dlg.querySelectorAll('.dbody pre[data-err]')].find(x=>x.dataset.err===key[1]):null;
        if(pre){pre.focus();pre.scrollTop=errTop;}
        else{
          const btns=[...dlg.querySelectorAll('.dbody button:not([disabled])')];
          const back=btns.find(x=>key[0]==='id'?x.id===key[1]:x.dataset[key[0]]===key[1])||((key[0]==='copy'||key[0]==='err')&&btns.find(x=>x.dataset.det===key[1]))||(key[0]!=='n'&&key[0]!=='id'?btns.find(x=>x.dataset.n===key[1]):null);
          if(back)back.focus();
        }
      }
      const W=window.DurbarMcpWords,ch=[];
      for(const x of st.servers){const was=seen.get(x.name);if(was!==undefined&&was!==(x.status||''))ch.push(x.name+': '+W.stateOf(x.status).word);}
      seen=new Map(st.servers.map(x=>[x.name,x.status||'']));
      return ch;};
    /* FR-004 / FR-033: an `mcp` event for this agent repaints the open dialog (no re-open) and says what changed through the polite live region.
       A throttle: the first event starts a 150 ms timer and the events that arrive meanwhile share its one repaint. The hook is dropped when the dialog closes. */
    let evT=0;
    const onEvent=id=>{
      if(id!==a.id||!dlg||!dlg.isConnected||evT)return;
      evT=setTimeout(async()=>{evT=0;
        let ch;try{ch=await repaint();}catch(e){return;}
        if(ch.length)X.announce(ch.slice(0,3).join('. ')+(ch.length>3?' and '+(ch.length-3)+' more':''));
      },150);
    };
    mcpDlgHook=onEvent;
    const restartOne=async name=>{
      if(restarting.has(name))return;
      restarting.add(name);
      let call;try{call=Promise.resolve(X.bridge.agentMcpRestart(a.id,name));}catch(e){call=Promise.reject(e);}
      call=call.catch(e=>({ok:false,error:String(e&&e.message||e)}));
      await repaint(); /* after the call went out: the row can already show the runtime's "pending" */
      const r=await call;
      restarting.delete(name);
      X.toast(r&&r.ok?'Restarted '+esc(name)+'.':'Could not restart '+esc(name)+': '+esc((r&&r.error)||'unknown error'),r&&r.ok?3200:6000);
      await repaint();
    };
    const restartSession=async()=>{
      if(sessBusy)return;
      const ask=window.DurbarDialog&&window.DurbarDialog(document);
      const confirm=async()=>{const lines=restartSessionAsk(a)||['The conversation is kept and resuming spends no AI credits.','The running turn stops.','"Approve for this session" grants are cleared.'];
        if(!ask)return window.confirm('Restart '+a.name+"'s session with the current MCP servers?");
        const v=await ask({title:'Restart '+a.name+"'s session?",body:'Restart '+a.name+"'s session with the current MCP servers?",lines,returnFocus:()=>dlg&&dlg.querySelector('#mcpRestartSess'),buttons:[{label:'Cancel',value:null},{label:'Restart session',value:'ok',cls:'primary warn'}]});
        return !!v;};
      let confirmed=false;
      if(restartSessionAsk(a)){if(!await confirm())return;confirmed=true;}
      sessBusy=true;await repaint();
      let r;try{r=await X.bridge.agentMcpRestartSession(a.id,confirmed);}catch(e){r={ok:false,error:String(e&&e.message||e)};}
      if(r&&!r.ok&&r.needsConfirm&&!confirmed){sessBusy=false;await repaint();if(!await confirm())return;sessBusy=true;await repaint();try{r=await X.bridge.agentMcpRestartSession(a.id,true);}catch(e){r={ok:false,error:String(e&&e.message||e)};}}
      sessBusy=false;
      if(r&&r.errorKind==='auth'&&X.signInAgain){if(dlg&&dlg._ov)dlg._ov._close();X.signInAgain(a,r.error||'');return;} /* FR-027: the chat's sign-in card, not a toast */
      X.toast(r&&r.ok?esc(a.name)+': session restarted with the current MCP servers.'+(st.start==='next-message'?' Its servers start with your next message.':''):'Could not restart the session: '+esc((r&&r.error)||'unknown error')+(r&&r.ended?' The session has ended; send a message to resume it.':''),r&&r.ok?4200:7000);
      await repaint();
    };
    const d0=dialog({title:'MCP servers for '+a.name,wide:true,html:body(st),buttons:[{label:'Settings',value:'settings'},{label:'Folder extras…',value:'folder'},{label:'Done',value:'ok',cls:'primary'}],
      onOpen:d=>{dlg=d.querySelector('.dlg');dlg._ov=d;d.addEventListener('click',async e=>{
        const rb=e.target.closest('button[data-restart]');if(rb&&!rb.disabled){void restartOne(rb.dataset.restart);return;}
        const db=e.target.closest('button[data-det]');
        if(db){const n=db.dataset.det;if(openDet.has(n))openDet.delete(n);else openDet.add(n);void repaint();return;}
        const cb=e.target.closest('button[data-copy]');
        if(cb){const sv=st.servers.find(x=>x.name===cb.dataset.copy);void copyText(sv&&sv.error||'','Copied the error text.');return;}
        if(e.target.closest('#mcpRestartSess')){void restartSession();return;}
        const b=e.target.closest('button.swt');if(!b||b.disabled)return;const on=b.getAttribute('aria-checked')!=='true';
        const r=await X.bridge.setAgentMcp(a.id,b.dataset.n,on);
        if(r&&r.error)X.toast(esc(r.error),5200);
        await repaint();});}});
    const r=await d0;
    clearTimeout(evT);evT=0;if(mcpDlgHook===onEvent)mcpDlgHook=null;
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
    const hasActivity=!!X.bridge.activityList;
    const simple=!!(X.detail&&X.detail.get()==='simple'); /* spec 052 FR-081: Simple has no Models and context tab and no token column */
    let tab=cur.tab||'tools'; if((all||simple)&&tab==='agents')tab='tools'; if(tab==='activity'&&!hasActivity)tab='tools';
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
    const tabs=`<div class="seg" role="tablist" aria-label="Tools view"><button role="tab" id="tabTools" aria-selected="${tab==='tools'}" type="button">${simple?'Activity summary':'Tool usage'}</button>${simple||all?'':`<button role="tab" id="tabAgents" aria-selected="${tab==='agents'}" type="button">Models and context</button>`}<button role="tab" id="tabCost" aria-selected="${tab==='cost'}" type="button">Cost</button>${hasActivity?`<button role="tab" id="tabActivity" aria-selected="${tab==='activity'}" type="button">Activity</button>`:''}</div>`;
    const cost=tab==='cost'?costView(simple):null;
    const act=tab==='activity'?await activityView():null;
    const body=act?act.html:cost?cost.html:tab==='tools'?await toolsTab(scope,tot,groups,all):agentsTab(scope,agents);
    if(!cur||cur.kind!=='tools')return;
    const actBtns=act?`<button class="btn" type="button" id="actCsv"${act.n?'':' disabled'}>Export CSV</button><button class="btn" type="button" id="actJson"${act.n?'':' disabled'}>Export JSON</button><button class="btn danger" type="button" id="actClear"${act.n?'':' disabled'}>Clear activity</button>`:'';
    const head=act?`${tabs}<span class="grow"></span>${actBtns}`:cost?`${cost.seg}${tabs}<span class="grow"></span><button class="btn" type="button" id="costCsv"${cost.built.rows.length&&!cost.none?'':' disabled'}>Copy as CSV</button>`:`${per}${scopeSel}${tabs}<span class="grow"></span>`;
    r.innerHTML=`<div class="scr-head"><h2>Tools</h2>${head}<button class="btn" type="button" id="scrClose" title="Close (Esc)">Close</button></div>
      <div class="scr-body">${body}</div>`;
    wireHead();
    if($('toolScope'))$('toolScope').onchange=e=>{cur.scope=e.target.value||null;paintTools();};
    if($('perSession'))$('perSession').onclick=()=>{if(period==='session')return;period='session';cur.scope=null;paintTools();};
    if($('perAll'))$('perAll').onclick=()=>{if(period==='all')return;period='all';paintTools();};
    $('tabTools').onclick=()=>{cur.tab='tools';paintTools();};
    if($('tabAgents'))$('tabAgents').onclick=()=>{cur.tab='agents';if(period==='all'){period='session';cur.scope=null;}paintTools();};
    $('tabCost').onclick=()=>{cur.tab='cost';paintTools();};
    if($('costRun'))$('costRun').onclick=()=>{costPer='run';paintTools();};
    if($('costSince'))$('costSince').onclick=()=>{costPer='since';paintTools();};
    if(cost&&$('costCsv'))$('costCsv').onclick=()=>copyCostCsv(cost);
    if($('tabActivity'))$('tabActivity').onclick=()=>{cur.tab='activity';paintTools();};
    if($('actCsv'))$('actCsv').onclick=()=>exportActivity('csv');
    if($('actJson'))$('actJson').onclick=()=>exportActivity('json');
    if($('actClear'))$('actClear').onclick=()=>clearActivity();
    r.onclick=async e=>{
      const l=e.target.closest('[data-open]');if(l){close();X.openAgent(l.dataset.open);return;}
      if(e.target.closest('#cfgSettings')){open('settings',{section:'mcp'});return;}
      if(e.target.closest('#usageReset')){
        const ok=await dialog({title:'Reset all-time counts?',html:'<p class="dsub">This clears the counts kept across restarts and starts again from today. It does not touch your agents or their history.</p>',buttons:[{label:'Cancel',value:null},{label:'Reset',value:'ok',cls:'primary danger'}]});
        if(ok&&X.bridge.usageReset){await X.bridge.usageReset();X.toast('All-time counts were reset.',2600);cur.scope=null;paintTools();}
      }
    };
    if(focus){const h=r.querySelector('h2');if(h){h.tabIndex=-1;h.focus({preventScroll:true});}}
  }
  /* ---------------- Tools > Activity (spec 052 FR-071): rows come from main only; the window reads, exports and clears ---------------- */
  async function activityView(){
    const A=window.DurbarActivity;
    let rows=[];
    try{const r=await X.bridge.activityList({limit:500});rows=r&&Array.isArray(r.rows)?r.rows:[];}catch(e){rows=[];}
    return {n:rows.length,html:`<p class="scr-note">${esc(A.NOTE)}</p>${A.tableHtml(rows,esc)}${rows.length>=500?'<p class="scr-note small">The newest 500 rows are shown; an export holds the whole log (at most 5000 rows).</p>':''}`};
  }
  async function exportActivity(format){
    if(!X.bridge.activityExport)return;
    const r=await X.bridge.activityExport(format).catch(e=>({ok:false,error:String(e&&e.message||e)}));
    if(r&&r.cancelled)return;
    if(r&&r.ok)X.toast('Saved '+(r.count||0)+' row'+(r.count===1?'':'s')+(r.to?' to '+esc(r.to):'')+'.',2800).classList.add('ok');
    else X.toast('Could not save the activity log: '+esc((r&&r.error)||'unknown error'),4200).classList.add('err');
  }
  async function clearActivity(){
    if(!X.bridge.activityClear)return;
    const ok=await dialog({title:'Clear the activity log?',html:'<p class="dsub">This deletes every row kept on this computer. Export it first if you need it. It does not touch your agents, their permissions or their history.</p>',buttons:[{label:'Cancel',value:null},{label:'Clear',value:'ok',cls:'primary danger'}]});
    if(!ok)return;
    await X.bridge.activityClear().catch(()=>null);
    X.toast('The activity log was cleared.',2600);
    if(cur&&cur.kind==='tools'&&cur.tab==='activity')paintTools();
  }
  /* ---------------- Tools > Cost (spec 052 FR-044, #315) ---------------- */
  const sinceDay=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}/.test(s)?s.slice(0,10):'';
  function costView(simple){
    const C=window.DurbarCost;
    const day=sinceDay(X.usageSince?X.usageSince():'');
    if(!day)costPer='run';
    const d=X.costData?X.costData(costPer):{rows:[],office:null,period:'run'};
    const built=C.build(d.rows,d.office);
    /* spec 052 FR-092: the same pair as Tool usage ("This session" / "All time"), placed before the tabs; the start date is a small subtitle */
    const allTime=costPer==='since'&&!!day, label=allTime?'All time (since '+day+')':'This session';
    const seg=`<div class="seg" role="tablist" aria-label="Period"><button role="tab" id="costRun" aria-selected="${!allTime}" type="button" title="Since Agent Durbar opened (or the last reset)">This session</button>${day?`<button role="tab" id="costSince" aria-selected="${allTime}" type="button" title="The saved totals since the last reset in Settings (${esc(day)}), plus this session">All time</button>`:''}</div>${allTime?`<small class="per-since">since ${esc(day)}</small>`:''}`;
    if(!built.rows.length)return {seg,built,label,html:'<p class="scr-empty">No folders yet.<br><small>Add a folder and start a session; the cost of each folder shows here.</small></p>'};
    /* spec 052 FR-050: no usage at all yet: a plain sentence instead of a table of dashes */
    /* spec 052 FR-075: a Copilot agent in the office: say the plan has a fixed price (the same words as the spending-limit dialog) */
    const plan=X.agents().some(a=>(a.adapterId||'copilot')==='copilot')?`<p class="scr-note small cost-plan">${esc(C.COPILOT_PLAN_NOTE)}</p>`:'';
    if(built.rows.every(r=>r.empty))return {seg,built,label,none:true,html:'<p class="scr-empty">No costs yet. Numbers appear after an agent\'s first reply.</p>'+plan};
    const n=v=>`<td class="num">${esc(v)}</td>`;
    const moneyCell=r=>C.notReported(r)?'<td class="num unk">not reported</td>':r.empty?'<td class="num">–</td>':n((/^</.test(C.money(r.money))?'':'≈ ')+C.money(r.money)); /* "<$0.01" needs no "≈" (as on the cards) */
    const row=r=>{
      const note=[r.tokensOnly?'Codex: tokens only':'',r.other?'saved totals of folders no longer in the list':''].filter(Boolean).join(' · ');
      return `<tr class="${r.empty?'empty':''}${r.other?' other':''}"><th scope="row" title="${esc(r.path||r.name)}">${esc(r.name)}</th>${moneyCell(r)}${n(r.aiu.toFixed(2))}${n(r.usd?C.money(r.usd):'–')}${simple?'':n(r.tokens?fmt(r.tokens):'–')}${n(String(r.calls))}<td class="cnote">${esc(note)}</td></tr>`;};
    const head=`<thead><tr><th scope="col">Folder</th><th scope="col" class="num">Est. cost</th><th scope="col" class="num">Copilot AIU</th><th scope="col" class="num">Claude $ est.<br><small>this session</small></th>${simple?'':'<th scope="col" class="num">Tokens<br><small>this session</small></th>'}<th scope="col" class="num">Calls</th><th scope="col">Note</th></tr></thead>`;
    const sum=`<p class="scr-sum">Cost by folder, <b>${allTime?'all time':'this session'}</b>${allTime?` (since ${esc(day)})`:''}. Estimated cost: Copilot AI credits at $0.01 each, plus Claude Code's own estimate. Not a bill.</p>`;
    const notes=`<p class="scr-note small">Copilot AIU and calls: ${allTime?'the totals saved since '+esc(day)+' (reset in Settings) plus this session':'since Agent Durbar opened (or the last reset)'}; ended sessions are included. Claude $ and tokens: the sessions open now, this session only. Codex reports tokens but no cost. A budget per folder is not available yet.</p>`;
    return {seg,built,label,html:sum+`<table class="ttab cost">${head}<tbody>${built.rows.map(row).join('')}</tbody><tfoot>${row(Object.assign({empty:false,other:false,path:''},built.total,{tokensOnly:false}))}</tfoot></table>`+notes+plan};
  }
  async function copyCostCsv(cost){
    const k=cost.built.rows.length;
    await copyText(window.DurbarCost.toCsv(cost.built,cost.label),'Copied '+k+' folder'+(k===1?'':'s')+' as CSV',2600); /* FR-050 */
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
        ${scope?'':`<td class="by">${r.agents.slice(0,4).map(x=>x.id?`<button class="by-chip" type="button" data-open="${esc(x.id)}" title="Open ${esc(nameOf(x.id))}">${esc(nameOf(x.id))} <b>${x.count}</b></button>`:`<span class="by-chip static" title="${esc(x.label)}">${esc(x.label)} <b>${x.count}</b></span>`).concat(r.agents.length>4?[`<span class="by-more">+${r.agents.length-4}</span>`]:[]).join('<span class="by-sep" aria-hidden="true"> · </span>')}</td>`}</tr>`).join('')}</tbody></table></section>`).join('')+cfg;
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
    const maxTools=Math.max(1,...list.map(a=>X.stats.agent(a.id).total)),rn=id=>X.roomName?X.roomName(id):String(id||''); /* the folder's name, not its id (spec 052 FR-170) */
    return `<p class="scr-sum">Model(s) each agent used and how full its context window is. Under <b>Auto</b> the runtime picks the model per request; the window is that model's. Unknown means the runtime did not report it (yet).</p>
    <table class="ttab agt"><thead><tr><th scope="col">Agent</th><th scope="col">Model(s)</th><th scope="col">Context window (used / size)</th><th scope="col" class="num">Tool calls</th></tr></thead><tbody>${list.map(a=>{const st=X.stats.agent(a.id);
      return `<tr><th scope="row"><button class="by-chip" type="button" data-open="${esc(a.id)}" title="${esc(a.name)}">${esc(a.name)}</button><div class="mdl-sub" title="${esc(rn(a.room))}">${esc(rn(a.room))}</div></th><td>${modelText(a,st)}</td><td>${ctxCell(st.ctx,X.staticLimit(a))}</td>
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
    return {cls:lv.level,text:'Context '+lv.pct+'%'+(long?' · long':''),title:fmt(st.ctx.tokens)+' of '+fmt(l)+' tokens used ('+lv.pct+'%)'+long+(st.ctx.system!==undefined?'. System '+fmt(st.ctx.system)+', chat '+fmt(st.ctx.conversation||0)+', tools '+fmt(st.ctx.toolDefinitions||0)+'.':''),pct:lv.pct};
  }

  window.DurbarScreens={
    init(ctx){X=ctx;if(window.DurbarHarnesses)window.DurbarHarnesses.init({bridge:ctx.bridge,toast:(t)=>ctx.toast(ctx.esc(t),3600),onChange:(again)=>{X._hsRefresh=true;if(ctx.refreshKinds)ctx.refreshKinds();if(cur&&cur.kind==='settings')paint();}});},
    folderMcp:openFolder,
    openSettings:(section)=>{mcp=null;open('settings',section==='mcp'||section==='harnesses'?{section}:null);},
    openTools:(scope,tab)=>{if(tab==='agents')period='session';open('tools',{scope:scope||null,tab:tab||'tools'});},
    agentMcp,
    mcpEvent:id=>{if(mcpDlgHook)mcpDlgHook(id);},
    placeDialog,
    dialog, /* spec 061: the folder-setup list uses the same modal */
    close,isOpen,
    /* live refresh while the Tools view is open (called when events arrive) */
    refresh:()=>{if(cur&&cur.kind==='tools'&&!document.getElementById('scrDlg'))paintTools();},
    period:()=>period,
    ctxChip,
  };
})();
