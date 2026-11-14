/* Team templates in Settings (spec 111 T008, FR-020, FR-021, FR-024, FR-131, FR-132). Two parts:
   - the pure part (rowsOf, actionsOf, refusalText, summaryText): no DOM, in Node through module.exports (scripts/test-teams-ui.ts);
   - the section (mount): a list of rows, each with plain buttons (keyboard only, every button named with the template it acts on), Delete through
     the shared askDialog, answers from the `teams:*` channels in words only (a code and a notice, never a value or a field's text).
   Built-in starters come from setStarters (T026 supplies them; none yet) and show *Use…* and *Duplicate* only. *Export…* is shown disabled until
   the import and export group (G7). New and Edit open the member editor (teameditor.js, T009) through `openEditor` below; Use… waits for the create step (T010).
   In the page: window.DurbarTeams; in Node: module.exports. */
(function(root, api){
  if(typeof module==='object'&&module.exports) module.exports=api; else root.DurbarTeams=api;
})(typeof self!=='undefined'?self:this, (function(){
  'use strict';
  const ORIGIN_WORD={starter:'Built in', own:'Yours', imported:'Imported'};
  const MAX_APPS=3;
  /* `teams:list` says `setAside` once after the store set a bad file aside (FR-001): in words, never the file's path or content; the store keeps the valid ones */
  const ASIDE_WORDS='The team templates file could not be read, so it was kept aside; templates that could not be read are not in the list.';
  const LOAD_FAILED_WORDS='The team templates could not be loaded. Try again.';
  /* the store's limit (LIMITS.templates, src/shared/teamtemplate.ts; test-teams-ui.ts checks both are the same number) */
  const MAX_TEMPLATES=50;
  const FULL_WORDS='At most '+MAX_TEMPLATES+' templates: delete one first.';
  const EXPORT_WHY='Export comes with import and export, in a later step.';

  /* FR-020: starters first, then the person's templates in the order main gave them. A row says what it can do; `origin` is only ever one of the three. */
  function rowsOf(list, starters){
    const one=(t,starter)=>{
      if(!t||typeof t!=='object')return null;
      const origin=starter?'starter':(t.origin==='imported'?'imported':'own');
      const members=Array.isArray(t.members)?t.members:[];
      const apps=[];
      members.forEach(m=>{const a=m&&typeof m.app==='string'?m.app:'';if(a&&!apps.includes(a))apps.push(a);});
      return {id:String(t.id==null?'':t.id), name:String(t.name==null?'':t.name), origin, originWord:ORIGIN_WORD[origin], count:members.length, apps};
    };
    const out=[];
    (Array.isArray(starters)?starters:[]).forEach(t=>{const r=one(t,true);if(r)out.push(r);});
    (Array.isArray(list)?list:[]).forEach(t=>{const r=one(t,false);if(r)out.push(r);});
    return out;
  }
  /* FR-021: a starter is Use and Duplicate only; Export waits for G7 (shown, disabled, with its reason). The order is the tab order.
     opts.full: the store holds its limit, so Duplicate says why it cannot (a disabled control with its reason, never a refusal after the click). */
  function actionsOf(row,opts){
    const starter=!!row&&row.origin==='starter', full=!!(opts&&opts.full);
    const dup=full?{id:'duplicate',label:'Duplicate',disabled:true,why:FULL_WORDS}:{id:'duplicate',label:'Duplicate'};
    if(starter)return [{id:'use',label:'Use…'},dup];
    return [{id:'use',label:'Use…'},{id:'edit',label:'Edit…'},dup,
      {id:'export',label:'Export…',disabled:true,why:EXPORT_WHY},{id:'delete',label:'Delete'}];
  }
  /* "2 members · claude, codex" (the app ids are data from the adapters list, never named in this file) */
  function summaryText(row){
    const n=row&&row.count?row.count:0, apps=(row&&row.apps)||[];
    const a=apps.length?' · '+apps.slice(0,MAX_APPS).join(', ')+(apps.length>MAX_APPS?' and '+(apps.length-MAX_APPS)+' more':''):'';
    return n+(n===1?' member':' members')+a;
  }
  /* a refused channel call in words (spec 111 delta "template channels"): nothing of `errors` is shown, so no value and no field text reaches the page */
  function refusalText(res, what){
    const w=what||'That';
    if(!res||typeof res!=='object'||res.ok!==false)return w+' did not work. Nothing was changed.';
    let t;
    if(res.code==='changed')t='The team templates were changed somewhere else, so the list was refreshed. Try again.';
    else if(res.code==='failed')t=w+' could not be saved. Nothing was changed; try again.';
    else t=w+' was not accepted. Nothing was changed.';
    return res.blocked?t+' The team templates file cannot be read or set aside, so saving may keep failing.':t;
  }

  /* ---------------------------------------------------------------- the section (page only) */
  let X=null, STARTERS=[], ASIDE=''; /* ASIDE is module state: a repaint of Settings builds a new mount and must not lose the note (spec 111 review of 1661) */
  function init(ctx){X=ctx;}
  /* T026 gives the built-in starters (plain templates, ids main resolves); the list repaints the next time it is mounted or repainted */
  function setStarters(list){STARTERS=Array.isArray(list)?list:[];}
  /* the section is shown only under the simulator until Use… and the create preview exist (T010): with the editor alone a person could save templates but not use them */
  function shown(){return !!(X&&X.sim);}
  /* The member editor (T009, teameditor.js). `request` is {mode:'new'|'edit'|'use', template?: the stored template (never a starter's id sent to main), starter?: true}.
     New and Edit open the editor and resolve true when the list should be repainted (saved, a brief marked, or the file changed). Use… is G4 (T010): until then it says so. */
  function openEditor(request){
    const E=typeof self!=='undefined'?self.DurbarTeamEditor:null;
    if(request&&request.mode!=='use'&&E&&X&&X.editorEnv&&typeof E.open==='function'){
      return E.open(request,{bridge:X.bridge,askDialog:X.askDialog,announce:X.announce,toast:X.toast,refusalText:(res,what)=>refusalText(res,what),rows:X.editorEnv,
        opener:typeof document!=='undefined'&&document.activeElement&&document.activeElement!==document.body?document.activeElement:null});
    }
    const t=request&&request.mode==='use'?'Creating a team from a template is not available yet.':'The member editor is not available yet.';
    if(X&&X.announce)X.announce(t);
    if(X&&X.toast)X.toast(t,3600);
    return Promise.resolve(false);
  }

  function el(tag,cls,text){const e=document.createElement(tag);if(cls)e.className=cls;if(text!=null)e.textContent=text;return e;}
  /* focus without moving the page, then reveal the control in its own scroller (the same helper as screens.js `focusIn`) */
  function focusEl(t){if(!t||typeof t.focus!=='function')return;if(typeof window!=='undefined'&&window.DurbarScroll&&window.DurbarScroll.focus)window.DurbarScroll.focus(t);else t.focus({preventScroll:true});}

  /* box: an empty element inside the Settings section; ctx via init(). Returns {repaint}. */
  function mount(box){
    if(!box||!X||!X.bridge||typeof X.bridge.teamsList!=='function')return null;
    let list=[], blocked=false, busy=false, notice='', loaded=false, loadFailed=false;
    const starters=()=>STARTERS;
    const say=(t)=>{notice=t;if(X.announce)X.announce(t);paint();};
    /* true when the list came back; a throw or `ok: false` is a failed load (never "no templates") */
    async function load(){
      let r=null;try{r=await X.bridge.teamsList();}catch(e){r=null;}
      loaded=true;
      if(r&&r.ok===true){
        list=Array.isArray(r.templates)?r.templates:[];blocked=!!r.blocked;loadFailed=false;
        if(r.setAside&&!ASIDE){ASIDE=ASIDE_WORDS;if(X.announce)X.announce(ASIDE_WORDS);if(X.toast)X.toast((X.esc?X.esc(ASIDE_WORDS):ASIDE_WORDS),7000);}
        return true;
      }
      loadFailed=true;return false;
    }
    function after(res,what){ /* a refused call: words; a `changed` answer carries the reloaded list */
      if(res&&res.ok===false&&res.code==='changed'&&Array.isArray(res.templates)){list=res.templates;loadFailed=false;}
      if(res&&res.ok===false)blocked=!!res.blocked||blocked;
      say(refusalText(res,what));
    }
    function focusFirst(sel){focusEl(box.querySelector(sel));}
    function find(id){return list.find(t=>t&&t.id===id)||starters().find(t=>t&&t.id===id)||null;}
    const full=()=>!loadFailed&&list.length>=MAX_TEMPLATES;
    /* after a change: reload; a failed reload says so (never "Copied"/"deleted" over a list that is not there) and returns false */
    async function reloaded(okText,announceText){
      const good=await load();
      if(!good){notice='The change was made, but the list could not be loaded. Try again.';if(X.announce)X.announce(notice);return false;}
      ASIDE=''; /* a real list after a change of this window: the earlier set-aside note has been seen */
      notice=okText;if(X.announce)X.announce(announceText);return true;
    }
    async function act(kind,row,btn){
      if(busy)return;
      const src=find(row.id);
      if(kind==='use'||kind==='edit'){
        const changed=await openEditor({mode:kind,template:src,starter:row.origin==='starter'});
        if(changed){await load();paint();}
        focusFirst('[data-tid="'+row.id+'"] button[data-act="'+kind+'"]'); /* the list was repainted: the focus goes back to the button that opened the editor */
        return;
      }
      if(kind==='duplicate'){
        busy=true;let r=null;try{r=await X.bridge.teamsDuplicate(row.id);}catch(e){r=null;}busy=false;
        if(r&&r.ok){const good=await reloaded('Copied as "'+String(r.template.name)+'".','Template copied.');paint();focusFirst(good?'[data-tid="'+r.template.id+'"] button':'#tmRetry');}
        else{after(r,'The copy');focusFirst('[data-tid="'+row.id+'"] button[data-act="duplicate"]');}
        return;
      }
      if(kind==='delete'){
        const ans=await X.askDialog({title:'Delete this template?',
          body:'"'+row.name+'" will be removed from your templates. Rooms already made from it do not change.',
          buttons:[{label:'Cancel',value:null},{label:'Delete',value:'del',cls:'primary danger'}],returnFocus:btn}); /* Cancel has the focus: Enter never deletes unread */
        if(!ans||ans.value!=='del'){return;}
        busy=true;let r=null;try{r=await X.bridge.teamsDelete(row.id);}catch(e){r=null;}busy=false;
        if(r&&r.ok){const good=await reloaded('Template deleted.','Template deleted.');paint();focusFirst(good?'#tmNew':'#tmRetry');}
        else{after(r,'The delete');focusFirst(box.querySelector('[data-tid="'+row.id+'"]')?'[data-tid="'+row.id+'"] button[data-act="delete"]':'#tmNew');} /* a refused delete: back to its button, or to New when the refreshed list lost the row */
      }
    }
    function paint(){
      const rows=rowsOf(loadFailed?[]:list,starters());
      const isFull=full();
      box.textContent='';
      const bar=el('div','scr-row');
      const nb=el('button','btn','New template…');nb.type='button';nb.id='tmNew';
      if(loadFailed||isFull){nb.disabled=true;nb.setAttribute('aria-label','New template ('+(loadFailed?LOAD_FAILED_WORDS:FULL_WORDS)+')');}
      else nb.onclick=async()=>{if(busy)return;if(await openEditor({mode:'new'})){await load();paint();}focusFirst('#tmNew');};
      bar.appendChild(nb);box.appendChild(bar);
      if(blocked){const b=el('p','scr-note warn','The team templates file cannot be read or set aside, so changes may not be saved.');b.setAttribute('role','note');box.appendChild(b);}
      if(ASIDE){
        const a=el('p','scr-note warn',ASIDE+' ');a.id='tmAside';a.setAttribute('role','note');
        const d=el('button','btn sm','Dismiss');d.type='button';d.id='tmAsideX';d.setAttribute('aria-label','Dismiss the notice about the file kept aside');
        d.onclick=()=>{ASIDE='';paint();focusFirst('#tmNew');};
        a.appendChild(d);box.appendChild(a);
      }
      if(loadFailed){
        const f=el('p','scr-note warn',LOAD_FAILED_WORDS+' ');f.id='tmFailed';f.setAttribute('role','note');
        const rb=el('button','btn sm','Try again');rb.type='button';rb.id='tmRetry';
        rb.onclick=async()=>{if(busy)return;busy=true;await load();busy=false;if(!loadFailed)notice='';paint();focusFirst(loadFailed?'#tmRetry':'#tmNew');};
        f.appendChild(rb);box.appendChild(f);
      }
      if(isFull){const n=el('p','scr-note small',FULL_WORDS);n.id='tmFull';box.appendChild(n);}
      const st=el('p','scr-note small',notice);st.id='tmNotice';box.appendChild(st); /* no role: the page announcer speaks (one voice) */
      if(!rows.length){if(!loadFailed)box.appendChild(el('p','scr-note small',loaded?'No team templates yet. A template is a saved team: its members, roles and settings.':'Loading…'));return;}
      const ul=el('ul','tm-list');ul.setAttribute('aria-label','Team templates');
      rows.forEach(row=>{
        const li=el('li','tm-row');li.dataset.tid=row.id;li.dataset.origin=row.origin;
        const info=el('div','tm-info');
        const nm=el('b','tm-name',row.name);nm.id='tmN-'+row.id;
        info.appendChild(nm);
        const tag=el('span','mtag',row.originWord);tag.id='tmO-'+row.id;info.appendChild(tag);
        info.appendChild(el('small','tm-sum',summaryText(row)));
        li.appendChild(info);
        const acts=el('div','tm-acts');acts.setAttribute('role','group');acts.setAttribute('aria-labelledby','tmN-'+row.id);
        actionsOf(row,{full:isFull}).forEach(a=>{
          const b=el('button','btn sm'+(a.id==='delete'?' danger':''),a.label);b.type='button';b.dataset.act=a.id;
          b.setAttribute('aria-label',a.label.replace('…','')+' '+row.name+(a.disabled?' ('+(a.id==='export'?'not available yet':a.why)+')':''));
          if(a.disabled){b.disabled=true;b.title=a.why||'';}else b.onclick=()=>{void act(a.id,row,b);};
          acts.appendChild(b);
        });
        li.appendChild(acts);ul.appendChild(li);
      });
      box.appendChild(ul);
      if(rows.some(r=>r.origin!=='starter')){const e=el('p','scr-note small','Export…: '+EXPORT_WHY);e.id='tmExportNote';box.appendChild(e);}
    }
    paint();
    void load().then(paint);
    return {repaint:()=>load().then(paint)};
  }
  return {rowsOf,actionsOf,summaryText,refusalText,ASIDE_WORDS,LOAD_FAILED_WORDS,FULL_WORDS,EXPORT_WHY,MAX_TEMPLATES,ORIGIN_WORD,init,setStarters,shown,mount,openEditor};
})());
