/* Spec 093 (create a folder from + Folder): the window's side of the flow. Plain script: in the page window.DurbarNewFolder, in Node
   (tests) module.exports. DurbarNewFolder.create(ctx) returns {choose(createOnly), start(kind), busy()}.
   The window keeps no copy of the rules and never sends a path: main picks the parent (createPickParent answers a token and the
   text to show), checks the URL and the name (createCheck, then createFolder again), runs the clone and adds the folder like Add
   existing. Every question is the shared askDialog (text set with textContent, keyboard only, Escape cancels); the clone's progress
   dialog uses the same dialog classes and the setup runner's .hs-log box.
   ctx: {bridge, askDialog, toast(html,ms), esc, announce(text), doc, mode() -> {value,label},
         confirmAllow(what, extra) -> Promise<boolean>, addOptions() -> options or null (a kind that is not ready: it already said so),
         addExisting(), applyResult(result, plain text), progress?(title, onCancel) -> {update(p), close()} (tests)}.
   Kinds: clone (phase 2), init (git init) and empty. */
(function(root,api){
  if(typeof module==='object'&&module.exports)module.exports=api;else root.DurbarNewFolder=api;
})(typeof self!=='undefined'?self:this,(function(){
  'use strict';
  const KIND_LINES=['Clone: copy a repository from GitHub or another git server.','New repository: an empty folder with git, on this computer only.','Empty folder: no git.'];
  const TITLE={clone:'Clone a repository',init:'New repository',empty:'Empty folder'};
  const WHAT={init:'git init: an empty repository on this computer only, with no remote.',empty:'An empty folder, without git.'};
  /* FR-044: shown while main says the clone has been quiet for 30 s with no progress yet */
  const WAITING='Still waiting for the server. If your ssh or sign-in helper opened a window, answer it there; or press Cancel.';
  const CANCELLED='Cancelled. Nothing was kept.';
  /* FR-061, Q6 = a: the Allow all sentence of a clone names the host only (main's checkCloneUrl host: never the user part or path) */
  const hostSentence=host=>'This code comes from '+host+'; agents can run it without asking.';
  /* spec 052 FR-176: focus never scrolls the page (innerscroll.js's helper when the page has it) */
  const focusIn=el=>{if(!el)return;if(typeof window!=='undefined'&&window.DurbarScroll)window.DurbarScroll.focus(el);else if(typeof el.focus==='function')el.focus({preventScroll:true});};

  /* FR-040, FR-041, FR-082: the clone's progress: phase and percent, the last lines in the .hs-log box, the elapsed time and Cancel
     (Escape too). role=dialog with aria-modal; the phase is a polite live region (the percent and lines are not announced, so a
     screen reader is not flooded every 250 ms). Text only (textContent), never HTML. */
  function progressView(doc,title,onCancel){
    const old=doc.getElementById('nfProg');if(old)old.remove();
    const opener=doc.activeElement&&doc.activeElement!==doc.body?doc.activeElement:null;
    const ov=doc.createElement('div');ov.id='nfProg';ov.className='dlg-ov';
    ov.innerHTML='<div class="dlg m" role="dialog" aria-modal="true" aria-labelledby="nfPT" aria-describedby="nfPS"><h3 id="nfPT"></h3><p class="dsub" id="nfPS" role="status" aria-live="polite"></p><p class="dsub" id="nfPP"></p><p class="dsub" id="nfPW" hidden></p><pre class="hs-log" id="nfPL"></pre><p class="dsub" id="nfPE"></p><div class="dbtn"><button type="button" class="btn" id="nfPC" data-cancel="1">Cancel</button></div></div>';
    const $=id=>ov.querySelector('#'+id);
    $('nfPT').textContent=title;$('nfPS').textContent='Starting…';
    const btn=$('nfPC');let closed=false;
    const cancel=()=>{if(closed||btn.disabled)return;btn.disabled=true;btn.textContent='Cancelling…';$('nfPS').textContent='Cancelling…';onCancel();};
    btn.onclick=cancel;
    const onKey=e=>{if(closed)return;if(e.key==='Escape'){e.preventDefault();e.stopPropagation();cancel();return;}if(e.key==='Tab'){e.preventDefault();focusIn(btn);}};
    const onFocusIn=e=>{if(!closed&&!ov.contains(e.target))focusIn(btn);};
    doc.addEventListener('keydown',onKey,true);doc.addEventListener('focusin',onFocusIn,true);
    doc.body.appendChild(ov);focusIn(btn);
    const t0=Date.now();
    const tick=()=>{if(!closed)$('nfPE').textContent=Math.round((Date.now()-t0)/1000)+' s';};
    tick();const iv=setInterval(tick,1000);
    let phase='';
    return {
      update(p){
        if(closed||!p)return;
        if(!btn.disabled&&typeof p.phase==='string'&&p.phase&&p.phase!==phase){phase=p.phase;$('nfPS').textContent=p.phase;}
        $('nfPP').textContent=typeof p.percent==='number'?p.percent+'%':'';
        $('nfPL').textContent=Array.isArray(p.lines)?p.lines.map(String).join('\n'):'';
        const w=$('nfPW');w.hidden=!p.waiting;w.textContent=p.waiting?WAITING:'';
      },
      close(){
        if(closed)return;closed=true;clearInterval(iv);
        doc.removeEventListener('keydown',onKey,true);doc.removeEventListener('focusin',onFocusIn,true);ov.remove();
        if(opener&&doc.contains(opener))focusIn(opener);
      }
    };
  }

  function create(ctx){
    let running=false;
    /* FR-001: + Folder and the welcome screen (Add existing first and focused, so Enter keeps today's behaviour);
       FR-001a: File > New Folder… opens the choice of kind only (createOnly). */
    async function choose(createOnly){
      if(running)return;
      const kinds=[{label:'Clone a repository…',value:'clone'},{label:'New repository…',value:'init'},{label:'Empty folder…',value:'empty'}];
      const buttons=createOnly
        ?[Object.assign({},kinds[0],{cls:'primary'}),kinds[1],kinds[2],{label:'Cancel',value:null}]
        :[{label:'Add existing folder…',value:'existing',cls:'primary'},...kinds,{label:'Cancel',value:null}];
      const r=await ctx.askDialog({title:createOnly?'New folder':'Add a folder',body:createOnly?'Create a new folder and add it to the office.':'Add a folder you already have, or create a new one.',lines:KIND_LINES,buttons,size:'l'}); /* four or five buttons need the wide dialog to stay on one row */
      if(!r)return;
      if(r.value==='existing')return ctx.addExisting();
      return start(r.value);
    }
    async function pick(){
      const p=await ctx.bridge.createPickParent();
      if(p&&p.ok&&typeof p.token==='string'&&typeof p.parent==='string')return p;
      if(p&&p.error)ctx.toast(ctx.esc(p.error),6000);
      return null;
    }
    /* FR-003 (clone only): the URL dialog, checked by main at each try (FR-022); the answer carries the host, the suggested name and
       the URL masked for display. null when the user cancels. */
    async function askUrl(url,error){
      for(;;){
        const r=await ctx.askDialog({title:TITLE.clone,body:'Paste the address of a git repository: https://… or an ssh address such as git@github.com:owner/repo.git. Durbar uses your own git and its sign-in; it never asks for or keeps a password.',
          input:{label:'Repository address',value:url,max:2048,focus:true,submitOnEnter:true,placeholder:'https://github.com/owner/repo.git',error:error||undefined},
          buttons:[{label:'Cancel',value:null},{label:'Next',value:'ok',cls:'primary'}],size:'m'});
        if(!r)return null;
        url=String(r.text||'').trim();
        const chk=await ctx.bridge.createCheck({kind:'clone',url});
        if(chk&&chk.ok&&typeof chk.host==='string'&&chk.host)return {url,host:chk.host,suggested:typeof chk.suggested==='string'?chk.suggested:'',shown:typeof chk.shown==='string'?chk.shown:''};
        error=(chk&&chk.error)||'That address cannot be used.';
      }
    }
    /* FR-040, FR-041: the clone runs in main; the progress dialog shows its events and Cancel asks main to end it */
    async function runClone(req,mode,o,name){
      const b=ctx.bridge;
      const stop=()=>{b.createCancel();};
      const view=ctx.progress?ctx.progress('Cloning into '+name,stop):progressView(ctx.doc,'Cloning into '+name,stop);
      const off=b.onCreateProgress(p=>view.update(p));
      try{return await b.createFolder(req,mode,o);}
      finally{if(typeof off==='function')off();view.close();}
    }
    /* FR-003: (clone: the URL, then the Allow all confirmation with the host) or (the Allow all confirmation, as Add existing asks it)
       -> the system picker -> the name -> create. Cancel or Escape at any step ends the flow with nothing created; a refused URL,
       name or place keeps the typed text and shows main's reason. */
    async function start(kind){
      const b=ctx.bridge;
      if(running||!TITLE[kind])return;
      if(!b||!b.createPickParent||!b.createCheck||!b.createFolder||(kind==='clone'&&(!b.createCancel||!b.onCreateProgress))){ctx.toast('Creating a folder is not available here.',4000);return;}
      running=true;
      try{
        const mode=ctx.mode();
        let src=null;
        if(kind==='clone'){
          src=await askUrl('','');
          if(!src)return;
          if(mode.value==='allow'&&!(await ctx.confirmAllow('the repository you clone next',hostSentence(src.host))))return; /* FR-061, Q6 = a */
        }else if(mode.value==='allow'&&!(await ctx.confirmAllow('the folder you create next')))return; /* FR-061, Q2 = b */
        const o=ctx.addOptions();
        if(!o)return;
        let p=await pick();
        if(!p)return;
        let name=src?src.suggested:'',error='';
        for(;;){
          const lines=src?['From '+src.shown+'.']:[WHAT[kind]];
          const r=await ctx.askDialog({title:TITLE[kind],body:'In '+p.parent+'. It starts in '+mode.label+'.',lines,
            input:{label:'Folder name',value:name,max:200,focus:true,submitOnEnter:true,error:error||undefined},
            buttons:[{label:'Cancel',value:null},{label:'Change place…',value:'place'},{label:kind==='clone'?'Clone':'Create',value:'ok',cls:'primary'}],size:'m'});
          if(!r)return;
          name=String(r.text||'').trim();
          if(r.value==='place'){const q=await pick();if(q)p=q;error='';continue;}
          const chk=await b.createCheck(src?{kind,url:src.url,name}:{kind,name});
          if(!chk||!chk.ok){error=(chk&&chk.error)||'That name cannot be used.';continue;}
          const req=src?{kind,token:p.token,name,url:src.url}:{kind,token:p.token,name};
          const res=src?await runClone(req,mode.value,o,name):await b.createFolder(req,mode.value,o);
          if(res&&res.cancelled){const t=res.error||CANCELLED;ctx.toast(ctx.esc(t),5000);if(ctx.announce)ctx.announce(t);return;}
          if(!res||!res.ok){error=(res&&res.error)||'Could not create the folder.';continue;}
          const made=res.name||name;
          ctx.applyResult(res,kind==='clone'?'Cloned into '+made+'.'+(res.submodules?' Submodules were not cloned.':''):(kind==='init'?'New repository ':'New folder ')+made+' created.'); /* plain text: the page escapes it */
          return;
        }
      }finally{running=false;}
    }
    return {choose,start,busy:()=>running};
  }
  return {create,KIND_LINES,WAITING,hostSentence,progressView};
})());
