/* Settings > Office memory (spec 116 T007; FR-002, FR-003, FR-053, FR-054, FR-070; US1.2, US1.3; Q12). Two parts:
   - the pure part (statusLine, confirmParts, remoteLine, failText, WORDS): no DOM, in Node through module.exports (scripts/test-memory-ui.ts);
   - the section (mount): the folder as `~` path, Choose folder..., Stop using, the switch, the status line, and the fixed sentences. Plain buttons and the
     same `button.swt[role=switch]` markup the other Settings rows use (keyboard only: every control is a button with a name). Choosing and turning on go
     through the shared askDialog with Cancel focused (a `warn` primary makes dialog.js focus Cancel). Only the existing `memory:*` calls are used
     (`memoryStatus`, `memoryPick`, `memoryApply`, `memorySetOn`, `memoryStop`, `onMemoryChanged`); the window never sends a path. Answers are fixed words.
   In the page: window.DurbarMemory; in Node: module.exports. */
(function(root, api){
  if(typeof module==='object'&&module.exports) module.exports=api; else root.DurbarMemory=api;
})(typeof self!=='undefined'?self:this, (function(){
  'use strict';
  /* FR-054 (Q12 a), FR-053, and the line under the switch (US1.5): the exact sentences */
  const WORDS={
    allowAll:'An agent in Allow all can also change files in your memory folder.',
    injection:'Files in this folder are notes for the agent that reads them, not orders for Durbar. An agent that reads a hostile file may follow it, as with any file in a project; its mode still decides what it may do, so Read-only stays read-only.',
    restart:'Running sessions keep it until they restart. Turning the memory off or choosing another folder changes new sessions only.',
    intro:'A folder of your own notes that every agent can read. Durbar never runs git, pushes or pulls.',
  };
  /* T009 (FR-022): the two words of the memory note. The text itself is main's (`src/main/memorynote.ts`) and is shown exactly as it came, with textContent. */
  const NOTE_WORDS={preview:'Sent with your next message: memory note',sent:'Memory note sent',lead:'This is what the agent reads first:'};
  const HOST_CUT=64;

  /* Text from main or from a folder's own name, made safe to show: the shared hidden-character definition (`unhide`, src/shared/redact.ts, passed in
     by app.js as the other windows take it; FR-031) removes the zero-width, bidi, C1 and separator characters a name can hide in; line breaks and tabs become
     a space. FAILS CLOSED: no `unhide` (or one that throws) shows nothing from main. Paths arrive from main already as `~/...` (win32: `~\\...`), so there is no
     home folder to cut here. */
  function clean(t){
    let u=null;
    try{u=X&&typeof X.unhide==='function'?X.unhide(String(t==null?'':t)):null;}catch(e){u=null;}
    return typeof u==='string'?u.replace(/[\r\n\t]+/g,' '):'';
  }

  /* FR-002: On / Off / Not found / Refused: reason. `cls` is the scr-note tone; the state is in the words, never only the colour (FR-070). */
  function statusLine(st){
    if(!st||typeof st!=='object'||!st.path)return {text:'Not set up. Choose a folder to start.',cls:''};
    const where=clean(st.path), why=clean(st.reason);
    if(st.state==='refused')return {text:'Refused: '+(why||'this folder cannot be used')+' ('+where+') The memory is off.',cls:'warn'};
    if(st.state==='notFound')return {text:'Not found: '+where+' is not there or cannot be read. New sessions get nothing from it until it is back.',cls:'warn'};
    if(st.state==='on'&&st.on)return {text:'On. New sessions can read this folder.',cls:'ok'};
    return {text:'Off. New sessions get nothing from this folder.',cls:''};
  }

  /* US1.3 / FR-055: hosts arrive masked and cut by main; cut again here, control characters out, so a bad answer cannot flood the dialog. */
  function remoteLine(remote){
    if(!remote||typeof remote!=='object')return '';
    if(remote.kind==='remote'){
      const hs=(Array.isArray(remote.hosts)?remote.hosts:[]).map(h=>clean(h).slice(0,HOST_CUT)).filter(Boolean).slice(0,8);
      return 'This folder has a git remote ('+(hs.length?hs.join(', '):'unknown host')+'). Durbar cannot tell whether it is public.';
    }
    if(remote.kind==='unknown')return 'Durbar could not check whether this folder has a git remote, so it cannot tell whether it is public.';
    return '';
  }

  /* US1.2 (+ US1.3): the confirmation before the memory is on; `remote` only when a pick found one (turning an already saved folder on has no pick) */
  function confirmParts(path, remote){
    const lines=['Every agent can read every file in it, in every mode.','Durbar writes only its own durbar/ folder in it.','Durbar never runs git, pushes or pulls.','The chat index holds names and dates, never chat text.'];
    const r=remoteLine(remote);if(r)lines.push(r);
    return {title:'Use this folder as your office memory?',body:clean(path),lines,
      buttons:[{label:'Cancel',value:null},{label:'Use this folder',value:'ok',cls:'primary warn'}]};
  }

  function failText(res){
    if(res&&res.error==='refused')return 'Refused: '+(clean(res.reason)||'this folder cannot be used')+(clean(res.path)?' ('+clean(res.path)+')':'')+' Nothing was changed.';
    if(res&&res.error==='invalid')return 'That choice has expired. Choose the folder again.';
    if(res&&res.error==='noFolder')return 'Choose a folder first.';
    return 'That did not work. Nothing was changed.';
  }

  let X=null;
  function init(ctx){X=ctx;}
  /* the page's own escaper, as teams.js takes it from app.js (FR-031) */
  const esc=s=>X.esc(s);
  /* the one `memory:changed` listener of this window: a new mount drops the old one first (12 Settings opens = 1 listener) */
  let stopListening=null;
  /* only under the simulator until T008 (the re-check when an office folder changes: today an office folder that overlaps the memory folder leaves "On" over a
     folder the sessions silently do not get), T009 (the memory note that tells the agents) and T010 (the docs) have all landed; lifting it is this one line (decided 2026-11-28) */
  function shown(){return !!(X&&X.sim);}

  /* box: an empty element inside the Settings section; ctx via init(). */
  function mount(box){
    if(!box||!X||!X.bridge||!X.bridge.memoryStatus)return {repaint(){}};
    let st=null, notice='', busy=false;
    const doc=box.ownerDocument;
    const say=t=>{notice=t;if(X.announce&&t)X.announce(t);};
    function paint(focusId){
      const keep=focusId||(doc.activeElement&&box.contains(doc.activeElement)?doc.activeElement.id:'');
      const has=!!(st&&st.path), line=statusLine(st), on=!!(st&&st.state==='on'&&st.on);
      const canSwitch=has&&st.state!=='refused'&&!busy;
      box.innerHTML=`<p class="scr-note">${esc(WORDS.intro)}</p>
        <p class="scr-note mem-path" id="memPath"><b>Folder:</b> ${has?`<code id="memPathText"></code>`:'<span>none chosen</span>'}</p>
        <div class="scr-tools"><button class="btn" type="button" id="memChoose"${busy?' disabled':''}>Choose folder…</button><button class="btn" type="button" id="memStop"${has&&!busy?'':' disabled'} aria-label="Stop using this memory folder">Stop using</button>
          <span class="swrow" style="display:flex;align-items:center;gap:10px"><b>Use office memory</b><button class="swt${on?' on':''}" type="button" id="memSw" role="switch" aria-checked="${on?'true':'false'}" aria-label="Use office memory"${canSwitch?'':' disabled'}><i></i></button></span></div>
        <p class="scr-note ${line.cls}" id="memStatus" role="status"></p>
        <p class="scr-note small" id="memNotice" role="status"></p>
        <p class="scr-note">${esc(WORDS.restart)}</p>
        <p class="scr-note">${esc(WORDS.allowAll)}</p>
        <p class="scr-note">${esc(WORDS.injection)}</p>`;
      const pt=box.querySelector('#memPathText');if(pt)pt.textContent=clean(st.path);
      box.querySelector('#memStatus').textContent=line.text;
      box.querySelector('#memNotice').textContent=notice;
      box.querySelector('#memChoose').onclick=()=>void choose();
      box.querySelector('#memStop').onclick=()=>void stop();
      box.querySelector('#memSw').onclick=()=>void toggle(!on);
      if(keep){const e=box.querySelector('#'+keep);if(e&&!e.disabled&&typeof e.focus==='function')e.focus({preventScroll:true});}
    }
    async function load(){let r=null;try{r=await X.bridge.memoryStatus();}catch(e){r=null;}st=r&&typeof r==='object'?r:{on:false,state:'off',keepInGit:false};}
    async function ask(path,remote){
      const p=confirmParts(path,remote);
      const a=await X.askDialog({title:p.title,body:p.body,lines:p.lines,buttons:p.buttons,returnFocus:()=>box.querySelector('#memChoose')||null});
      return !!a&&a.value==='ok';
    }
    async function choose(){
      if(busy)return;busy=true;paint();
      let pk=null;try{pk=await X.bridge.memoryPick();}catch(e){pk=null;}
      if(!pk||pk.ok===false&&pk.error==='cancelled'){busy=false;paint('memChoose');return;}
      if(pk.ok===false){say(failText(pk));busy=false;paint('memChoose');return;}
      const yes=await ask(pk.path,pk.remote);
      if(!yes){say('Nothing was changed.');busy=false;await load();paint('memChoose');return;}
      let ap=null;try{ap=await X.bridge.memoryApply(pk.token);}catch(e){ap=null;}
      busy=false;
      if(ap&&ap.ok===true){say('Office memory is on.');}else say(failText(ap));
      await load();paint('memChoose');
    }
    async function toggle(want){
      if(busy||!st||!st.path)return;busy=true;paint();
      if(want&&!(await ask(st.path,null))){busy=false;paint('memSw');return;}
      let r=null;try{r=await X.bridge.memorySetOn(want);}catch(e){r=null;}
      busy=false;
      say(r&&r.ok===true?(want?'Office memory is on.':'Office memory is off.'):failText(r));
      await load();paint('memSw');
    }
    async function stop(){
      if(busy)return;busy=true;paint();
      let r=null;try{r=await X.bridge.memoryStop();}catch(e){r=null;}
      busy=false;
      say(r&&r.ok===true?'Stopped using the folder. Its files are untouched.':failText(r));
      await load();paint('memChoose');
    }
    if(stopListening){stopListening();stopListening=null;}
    if(typeof X.bridge.onMemoryChanged==='function'){
      const off=X.bridge.onMemoryChanged(v=>{
        if(!box.isConnected){if(typeof off==='function')off();if(stopListening===off)stopListening=null;return;}
        if(!v||typeof v!=='object')return;
        const was=st;st=v;
        if(!was||was.state!==v.state||was.on!==v.on||was.path!==v.path||was.reason!==v.reason){notice='';if(X.announce)X.announce(statusLine(v).text);} /* a pushed change: the old notice is stale; say the new state */
        paint();
      });
      stopListening=typeof off==='function'?off:null;
    }
    void load().then(paint);
    return {repaint:paint};
  }

  /* T009: text from main (the note, the path in it) made safe to show with the shared `unhide` (the T007 rule above): hidden and direction characters out, line
     breaks kept (the note is several lines). FAILS CLOSED: no `unhide`, or one that throws, shows nothing. Returns null for nothing to show. */
  function safeText(t){
    let u=null;
    const raw=String(t==null?'':t);
    try{u=X&&typeof X.unhide==='function'?X.unhide(raw):null;}catch(e){u=null;}
    return typeof u==='string'&&u!==''&&u===raw?u:null; /* fails closed: a text that `unhide` would change (hidden or direction characters) is not shown cleaned, it is not shown */
  }
  /* T009: a closed <details> holding the exact text (textContent, never HTML), under a plain line that says what it is. Returns the element, or null. */
  function noteDetails(doc,summary,text,cls){
    const t=safeText(text);if(t===null)return null;
    const d=doc.createElement('details');d.className=cls;
    const s=doc.createElement('summary');s.textContent=summary;
    const p=doc.createElement('p');p.className='mem-note-lead';p.textContent=NOTE_WORDS.lead;
    const pre=doc.createElement('pre');pre.className='mem-note-text';pre.textContent=t;
    d.appendChild(s);d.appendChild(p);d.appendChild(pre);return d;
  }
  /* T009 US1.2: the preview above the composer. `p` is main's {id,text} or anything else (nothing to send: the box is empty and hidden). Only under the simulator's gate. */
  function paintNotePreview(host,p){
    if(!host)return null;
    host.textContent='';
    const ok=shown()&&p&&typeof p==='object'&&typeof p.id==='string'&&typeof p.text==='string'&&p.text!=='';
    const d=ok?noteDetails(host.ownerDocument,NOTE_WORDS.preview,p.text,'nt-notice mem-note-box'):null;
    if(!d){host.hidden=true;delete host.dataset.noteId;return null;}
    host.dataset.noteId=p.id;host.hidden=false;host.appendChild(d);
    return p.id;
  }
  /* T009 US1.2: the line above the person's bubble; `text` is what main says it sent */
  function sentLine(doc,text){
    if(!shown()||typeof text!=='string'||text==='')return null;
    const t=safeText(text);if(t===null)return null;
    /* collapsed by default: one line, a button (Enter and Space work, aria-expanded says the state) that opens the exact text */
    const box=doc.createElement('div');box.className='note mem-note-sent';
    const btn=doc.createElement('button');btn.type='button';btn.className='mem-note-toggle';btn.setAttribute('aria-expanded','false');btn.textContent=NOTE_WORDS.sent;
    const body=doc.createElement('div');body.className='mem-note-body';body.hidden=true;
    const p=doc.createElement('p');p.className='mem-note-lead';p.textContent=NOTE_WORDS.lead;
    const pre=doc.createElement('pre');pre.className='mem-note-text';pre.textContent=t;
    body.appendChild(p);body.appendChild(pre);
    btn.addEventListener('click',()=>{const open=btn.getAttribute('aria-expanded')!=='true';btn.setAttribute('aria-expanded',String(open));body.hidden=!open;});
    box.appendChild(btn);box.appendChild(body);return box;
  }
  /* T009: a chat reloaded from the agent app's history: the note's text is not kept (the app stores it, Durbar shows only that it went) */
  function sentLineBare(doc){
    if(!shown())return null;
    const d=doc.createElement('div');d.className='note mem-note-sent bare';d.textContent=NOTE_WORDS.sent;return d;
  }
  return {WORDS,NOTE_WORDS,paintNotePreview,sentLine,sentLineBare,statusLine,remoteLine,confirmParts,failText,init,shown,mount};
})());
