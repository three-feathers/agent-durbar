/* Spec 093 (create a folder from + Folder): the window's side of the flow. Plain script: in the page window.DurbarNewFolder, in Node
   (tests) module.exports. DurbarNewFolder.create(ctx) returns {choose(createOnly), start(kind)}.
   The window keeps no copy of the rules and never sends a path: main picks the parent (createPickParent answers a token and the
   text to show), checks the name (createCheck, then createFolder again), and adds the folder like Add existing. Every dialog is the
   shared askDialog (text set with textContent, keyboard only, Escape cancels).
   ctx: {bridge, askDialog, toast(html,ms), esc, mode() -> {value,label}, confirmAllow(what) -> Promise<boolean>,
         addOptions() -> options or null (a kind that is not ready: it already said so), addExisting(), applyResult(result, plain text)}.
   Phase 1: New repository (git init) and Empty folder. Phase 2 adds Clone a repository. */
(function(root,api){
  if(typeof module==='object'&&module.exports)module.exports=api;else root.DurbarNewFolder=api;
})(typeof self!=='undefined'?self:this,(function(){
  'use strict';
  const KIND_LINES=['New repository: an empty folder with git, on this computer only.','Empty folder: no git.'];
  const TITLE={init:'New repository',empty:'Empty folder'};
  const WHAT={init:'git init: an empty repository on this computer only, with no remote.',empty:'An empty folder, without git.'};
  function create(ctx){
    let running=false;
    /* FR-001: + Folder and the welcome screen (Add existing first and focused, so Enter keeps today's behaviour);
       FR-001a: File > New Folder… opens the choice of kind only (createOnly). */
    async function choose(createOnly){
      if(running)return;
      const buttons=createOnly
        ?[{label:'New repository…',value:'init',cls:'primary'},{label:'Empty folder…',value:'empty'},{label:'Cancel',value:null}]
        :[{label:'Add existing folder…',value:'existing',cls:'primary'},{label:'New repository…',value:'init'},{label:'Empty folder…',value:'empty'},{label:'Cancel',value:null}];
      const r=await ctx.askDialog({title:createOnly?'New folder':'Add a folder',body:createOnly?'Create a new folder and add it to the office.':'Add a folder you already have, or create a new one.',lines:KIND_LINES,buttons,size:createOnly?'m':'l'}); /* four buttons need the wide dialog to stay on one row */
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
    /* FR-003: (the Allow all confirmation, as Add existing asks it) -> the system picker -> the name -> create. Cancel or Escape at
       any step ends the flow with nothing created; a refused name or place keeps the typed text and shows main's reason. */
    async function start(kind){
      const b=ctx.bridge;
      if(running||!TITLE[kind])return;
      if(!b||!b.createPickParent||!b.createCheck||!b.createFolder){ctx.toast('Creating a folder is not available here.',4000);return;}
      running=true;
      try{
        const mode=ctx.mode();
        if(mode.value==='allow'&&!(await ctx.confirmAllow('the folder you create next')))return; /* FR-061, Q2 = b */
        const o=ctx.addOptions();
        if(!o)return;
        let p=await pick();
        if(!p)return;
        let name='',error='';
        for(;;){
          const r=await ctx.askDialog({title:TITLE[kind],body:'In '+p.parent+'. It starts in '+mode.label+'.',lines:[WHAT[kind]],
            input:{label:'Folder name',value:name,max:200,focus:true,submitOnEnter:true,error:error||undefined},
            buttons:[{label:'Cancel',value:null},{label:'Change place…',value:'place'},{label:'Create',value:'ok',cls:'primary'}],size:'m'});
          if(!r)return;
          name=String(r.text||'').trim();
          if(r.value==='place'){const q=await pick();if(q)p=q;error='';continue;}
          const chk=await b.createCheck({kind,name});
          if(!chk||!chk.ok){error=(chk&&chk.error)||'That name cannot be used.';continue;}
          const res=await b.createFolder({kind,token:p.token,name},mode.value,o);
          if(!res||!res.ok){error=(res&&res.error)||'Could not create the folder.';continue;}
          ctx.applyResult(res,(kind==='init'?'New repository ':'New folder ')+(res.name||name)+' created.'); /* plain text: the page escapes it */
          return;
        }
      }finally{running=false;}
    }
    return {choose,start,busy:()=>running};
  }
  return {create,KIND_LINES};
})());
