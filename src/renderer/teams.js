/* Team templates in Settings (spec 111 T008, FR-020, FR-021, FR-024, FR-131, FR-132). Two parts:
   - the pure part (rowsOf, actionsOf, refusalText, summaryText): no DOM, in Node through module.exports (scripts/test-teams-ui.ts);
   - the section (mount): a list of rows, each with plain buttons (keyboard only, every button named with the template it acts on), Delete through
     the shared askDialog, answers from the `teams:*` channels in words only (a code and a notice, never a value or a field's text).
   Built-in starters come from setStarters (T026 supplies them; none yet) and show *Use…* and *Duplicate* only. *Export…* is shown disabled until
   the import and export group (G7). New, Edit and Use open the member editor, which is T009: `openEditor` below is the one hook it fills in.
   In the page: window.DurbarTeams; in Node: module.exports. */
(function(root, api){
  if(typeof module==='object'&&module.exports) module.exports=api; else root.DurbarTeams=api;
})(typeof self!=='undefined'?self:this, (function(){
  'use strict';
  const ORIGIN_WORD={starter:'Built in', own:'Yours', imported:'Imported'};
  const MAX_APPS=3;
  /* `teams:list` says `setAside` once after the store set a bad file aside (FR-001): in words, never the file's path or content */
  const ASIDE_WORDS='The team templates file could not be read, so it was kept aside and the list starts empty.';

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
  /* FR-021: a starter is Use and Duplicate only; Export waits for G7 (shown, disabled, with its reason). The order is the tab order. */
  function actionsOf(row){
    const starter=!!row&&row.origin==='starter';
    if(starter)return [{id:'use',label:'Use…'},{id:'duplicate',label:'Duplicate'}];
    return [{id:'use',label:'Use…'},{id:'edit',label:'Edit…'},{id:'duplicate',label:'Duplicate'},
      {id:'export',label:'Export…',disabled:true,why:'Export comes with import and export, in a later step.'},{id:'delete',label:'Delete'}];
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
  let X=null, STARTERS=[];
  function init(ctx){X=ctx;}
  /* T026 gives the built-in starters (plain templates, ids main resolves); the list repaints the next time it is mounted or repainted */
  function setStarters(list){STARTERS=Array.isArray(list)?list:[];}
  /* T009's hook. `request` is {mode:'new'|'edit'|'use', template?: the stored template (never a starter's id sent to main), starter?: true}. T009 replaces
     this body with the member editor (dialog size l) and resolves true when a template was saved, so the list repaints. Until then it says so, in words. */
  function openEditor(request){
    void request;
    if(X&&X.announce)X.announce('The member editor is not available yet.');
    if(X&&X.toast)X.toast('The member editor is not available yet.',3600);
    return Promise.resolve(false);
  }

  function el(tag,cls,text){const e=document.createElement(tag);if(cls)e.className=cls;if(text!=null)e.textContent=text;return e;}

  /* box: an empty element inside the Settings section; ctx via init(). Returns {repaint}. */
  function mount(box){
    if(!box||!X||!X.bridge||typeof X.bridge.teamsList!=='function')return null;
    let list=[], blocked=false, busy=false, notice='', loaded=false, asideNote='';
    const starters=()=>STARTERS;
    const say=(t)=>{notice=t;if(X.announce)X.announce(t);paint();};
    async function load(){
      let r=null;try{r=await X.bridge.teamsList();}catch(e){r=null;}
      if(r&&r.ok){list=r.templates||[];blocked=!!r.blocked;loaded=true;if(r.setAside){asideNote=ASIDE_WORDS;if(X.announce)X.announce(ASIDE_WORDS);}return true;}
      loaded=true;return false;
    }
    function after(res,what){ /* a refused call: words; a `changed` answer carries the reloaded list */
      if(res&&res.ok===false&&res.code==='changed'&&Array.isArray(res.templates))list=res.templates;
      if(res&&res.ok===false)blocked=!!res.blocked||blocked;
      say(refusalText(res,what));
    }
    function focusFirst(sel){const t=box.querySelector(sel);if(t&&t.focus)t.focus({preventScroll:true});}
    function find(id){return list.find(t=>t&&t.id===id)||starters().find(t=>t&&t.id===id)||null;}
    async function act(kind,row,btn){
      if(busy)return;
      const src=find(row.id);
      if(kind==='use'||kind==='edit'){
        const changed=await openEditor({mode:kind,template:src,starter:row.origin==='starter'});
        if(changed){await load();paint();}
        return;
      }
      if(kind==='duplicate'){
        busy=true;let r=null;try{r=await X.bridge.teamsDuplicate(row.id);}catch(e){r=null;}busy=false;
        if(r&&r.ok){await load();notice='Copied as "'+String(r.template.name)+'".';if(X.announce)X.announce('Template copied.');paint();focusFirst('[data-tid="'+r.template.id+'"] button');}
        else{after(r,'The copy');focusFirst('[data-tid="'+row.id+'"] button[data-act="duplicate"]');}
        return;
      }
      if(kind==='delete'){
        const ans=await X.askDialog({title:'Delete this template?',
          body:'"'+row.name+'" will be removed from your templates. Rooms already made from it do not change.',
          buttons:[{label:'Cancel',value:null},{label:'Delete',value:'del',cls:'primary danger'}],returnFocus:btn}); /* Cancel has the focus: Enter never deletes unread */
        if(!ans||ans.value!=='del'){return;}
        busy=true;let r=null;try{r=await X.bridge.teamsDelete(row.id);}catch(e){r=null;}busy=false;
        if(r&&r.ok){await load();notice='Template deleted.';if(X.announce)X.announce('Template deleted.');paint();focusFirst('#tmNew');}
        else{after(r,'The delete');}
      }
    }
    function paint(){
      const rows=rowsOf(list,starters());
      box.textContent='';
      const bar=el('div','scr-row');
      const nb=el('button','btn','New template…');nb.type='button';nb.id='tmNew';
      nb.onclick=async()=>{if(busy)return;if(await openEditor({mode:'new'})){await load();paint();}};
      bar.appendChild(nb);box.appendChild(bar);
      if(blocked){const b=el('p','scr-note warn','The team templates file cannot be read or set aside, so changes may not be saved.');b.setAttribute('role','note');box.appendChild(b);}
      if(asideNote){const a=el('p','scr-note warn',asideNote);a.id='tmAside';a.setAttribute('role','note');box.appendChild(a);}
      const st=el('p','scr-note small',notice);st.id='tmNotice';st.setAttribute('role','status');box.appendChild(st);
      if(!rows.length){box.appendChild(el('p','scr-note small',loaded?'No team templates yet. A template is a saved team: its members, roles and settings.':'Loading…'));return;}
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
        actionsOf(row).forEach(a=>{
          const b=el('button','btn sm'+(a.id==='delete'?' danger':''),a.label);b.type='button';b.dataset.act=a.id;
          b.setAttribute('aria-label',a.label.replace('…','')+' '+row.name+(a.disabled?' (not available yet)':''));
          if(a.disabled){b.disabled=true;b.title=a.why||'';}else b.onclick=()=>{void act(a.id,row,b);};
          acts.appendChild(b);
        });
        li.appendChild(acts);ul.appendChild(li);
      });
      box.appendChild(ul);
    }
    paint();
    void load().then(paint);
    return {repaint:()=>load().then(paint)};
  }
  return {rowsOf,actionsOf,summaryText,refusalText,ASIDE_WORDS,ORIGIN_WORD,init,setStarters,mount,openEditor};
})());
