/* Settings > Office memory (spec 116 T007; FR-002, FR-003, FR-053, FR-054, FR-070; US1.2, US1.3; Q12). Two parts:
   - the pure part (shortPath, statusLine, confirmParts, remoteLine, failText, WORDS): no DOM, in Node through module.exports (scripts/test-memory-ui.ts);
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
  const HOST_CUT=64;
  const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  /* FR-002: the path as `~` when it is under the home folder. Main already answers `~` paths; this is for a path that comes back whole (the simulator, a
     refusal) when the caller knows the home folder. Windows: the drive letter and the separators are told apart from POSIX by the home path itself; the
     compare folds case there and takes either slash, the rest of the path keeps its own separators. */
  function shortPath(p, home){
    if(typeof p!=='string'||p==='')return '';
    if(p==='~'||p.startsWith('~/')||p.startsWith('~\\'))return p;
    if(typeof home!=='string'||home==='')return p;
    const win=/^[A-Za-z]:[\\/]/.test(home)||/^\\\\/.test(home);
    const norm=s=>win?s.replace(/\\/g,'/').toLowerCase():s;
    let h=home;while(h.length>1&&(h.endsWith('/')||(win&&h.endsWith('\\'))))h=h.slice(0,-1);
    const np=norm(p), nh=norm(h);
    if(np===nh)return '~';
    if(np.startsWith(nh+'/')){return '~'+p.slice(h.length);}
    return p;
  }

  /* FR-002: On / Off / Not found / Refused: reason. `cls` is the scr-note tone; the state is in the words, never only the colour (FR-070). */
  function statusLine(st){
    if(!st||typeof st!=='object'||!st.path)return {text:'Not set up. Choose a folder to start.',cls:''};
    const where=String(st.path);
    if(st.state==='refused')return {text:'Refused: '+(st.reason||'this folder cannot be used')+' ('+where+') The memory is off.',cls:'warn'};
    if(st.state==='notFound')return {text:'Not found: '+where+' is not there or cannot be read. New sessions get nothing from it until it is back.',cls:'warn'};
    if(st.state==='on'&&st.on)return {text:'On. New sessions can read this folder.',cls:'ok'};
    return {text:'Off. New sessions get nothing from this folder.',cls:''};
  }

  /* US1.3 / FR-055: hosts arrive masked and cut by main; cut again here, control characters out, so a bad answer cannot flood the dialog. */
  function remoteLine(remote){
    if(!remote||typeof remote!=='object')return '';
    if(remote.kind==='remote'){
      const hs=(Array.isArray(remote.hosts)?remote.hosts:[]).map(h=>String(h).replace(/[\u0000-\u001f\u007f‪-‮⁦-⁩]/g,' ').slice(0,HOST_CUT)).filter(Boolean).slice(0,8);
      return 'This folder has a git remote ('+(hs.length?hs.join(', '):'unknown host')+'). Durbar cannot tell whether it is public.';
    }
    if(remote.kind==='unknown')return 'Durbar could not check whether this folder has a git remote, so it cannot tell whether it is public.';
    return '';
  }

  /* US1.2 (+ US1.3): the confirmation before the memory is on; `remote` only when a pick found one (turning an already saved folder on has no pick) */
  function confirmParts(path, remote){
    const lines=['Every agent can read every file in it, in every mode.','Durbar writes only its own durbar/ folder in it.','Durbar never runs git, pushes or pulls.','The chat index holds names and dates, never chat text.'];
    const r=remoteLine(remote);if(r)lines.push(r);
    return {title:'Use this folder as your office memory?',body:String(path||''),lines,
      buttons:[{label:'Cancel',value:null},{label:'Use this folder',value:'ok',cls:'primary warn'}]};
  }

  function failText(res){
    if(res&&res.error==='refused')return 'Refused: '+(res.reason||'this folder cannot be used')+(res.path?' ('+res.path+')':'')+' Nothing was changed.';
    if(res&&res.error==='invalid')return 'That choice has expired. Choose the folder again.';
    if(res&&res.error==='noFolder')return 'Choose a folder first.';
    return 'That did not work. Nothing was changed.';
  }

  let X=null;
  function init(ctx){X=ctx;}
  /* only under the simulator until the memory note (T009) and the docs (T010) land: a folder nobody tells the agents about would be half a feature */
  function shown(){return !!(X&&X.sim);}

  /* box: an empty element inside the Settings section; ctx via init(). */
  function mount(box){
    if(!box||!X||!X.bridge||!X.bridge.memoryStatus)return {repaint(){}};
    let st=null, notice='', busy=false, unsub=null;
    const doc=box.ownerDocument;
    const say=t=>{notice=t;if(X.announce&&t)X.announce(t);};
    const home=()=>typeof X.home==='function'?X.home():X.home;
    function paint(focusId){
      const keep=focusId||(doc.activeElement&&box.contains(doc.activeElement)?doc.activeElement.id:'');
      const has=!!(st&&st.path), line=statusLine(st), on=!!(st&&st.state==='on'&&st.on);
      const canSwitch=has&&st.state!=='refused'&&!busy;
      box.innerHTML=`<p class="scr-note">${esc(WORDS.intro)}</p>
        <p class="scr-note mem-path" id="memPath"><b>Folder</b> ${has?`<code id="memPathText"></code>`:'<span>none chosen</span>'}</p>
        <div class="scr-tools"><button class="btn" type="button" id="memChoose"${busy?' disabled':''}>Choose folder…</button><button class="btn" type="button" id="memStop"${has&&!busy?'':' disabled'} aria-label="Stop using this memory folder">Stop using</button>
          <span class="swrow" style="display:flex;align-items:center;gap:10px"><b>Use office memory</b> <small>(off: new sessions get nothing)</small><button class="swt${on?' on':''}" type="button" id="memSw" role="switch" aria-checked="${on?'true':'false'}" aria-label="Use office memory"${canSwitch?'':' disabled'}><i></i></button></span></div>
        <p class="scr-note ${line.cls}" id="memStatus" role="status"></p>
        <p class="scr-note small" id="memNotice" role="status"></p>
        <p class="scr-note">${esc(WORDS.restart)}</p>
        <p class="scr-note">${esc(WORDS.allowAll)}</p>
        <p class="scr-note">${esc(WORDS.injection)}</p>`;
      const pt=box.querySelector('#memPathText');if(pt)pt.textContent=shortPath(st.path,home());
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
      const yes=await ask(shortPath(pk.path,home()),pk.remote);
      if(!yes){say('Nothing was changed.');busy=false;await load();paint('memChoose');return;}
      let ap=null;try{ap=await X.bridge.memoryApply(pk.token);}catch(e){ap=null;}
      busy=false;
      if(ap&&ap.ok===true){say('Office memory is on.');}else say(failText(ap));
      await load();paint('memChoose');
    }
    async function toggle(want){
      if(busy||!st||!st.path)return;busy=true;paint();
      if(want&&!(await ask(shortPath(st.path,home()),null))){busy=false;paint('memSw');return;}
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
    if(typeof X.bridge.onMemoryChanged==='function'){
      unsub=X.bridge.onMemoryChanged(v=>{
        if(!box.isConnected){if(unsub){unsub();unsub=null;}return;}
        if(v&&typeof v==='object'){st=v;paint();}
      });
    }
    void load().then(paint);
    return {repaint:paint};
  }

  return {WORDS,shortPath,statusLine,remoteLine,confirmParts,failText,init,shown,mount};
})());
