/* The team member editor (spec 111 T009, FR-002, FR-022, FR-023, FR-131, FR-132). Two parts:
   - the pure part (the draft, its rules, the payload for `teams:put`, the words): no DOM, in Node through module.exports (scripts/test-teams-editor.ts);
   - the dialog (open): a form of the shared askDialog (size l, so Esc cancels, Tab stays inside and the focus goes back), one fieldset with a legend
     per member. The permissions and limit rows are the ones New session uses (memberrows.js); the app, model and effort lists are the page's own
     (`env`, from app.js). Every value here can come from an imported template, so it is set with `textContent` or `.value` only, never as HTML, and an
     answer of main is shown in fixed words by its `code`: no `errors` text and no value reaches the page.
   In the page: window.DurbarTeamEditor; in Node: module.exports. */
(function(root, api){
  if(typeof module==='object'&&module.exports) module.exports=api; else root.DurbarTeamEditor=api;
})(typeof self!=='undefined'?self:this, (function(){
  'use strict';
  const MAX_MEMBERS=8, NAME_MAX=60, ROLE_MAX=40, TPL_NAME_MAX=40, DESC_MAX=200;
  const BRIEF_OWN={chars:4000,lines:80}, BRIEF_FILE={chars:2000,lines:40};
  const PROFILE_ID_RE=/^[A-Za-z0-9._:@/-]{1,100}$/;
  const FALLBACK_APPS=['copilot','claude','codex'];
  const MARK_WORDS='This brief came from a file. Mark it as written by you? It will be sent as your own text and may grow to 4,000 characters.';
  const PROFILE_HINT='Checked when the member first starts';
  /* the words of a field main refused: fixed per field, never main's text (`errors` name a field and never its value; even so, nothing of it is shown) */
  const FIELD_WORDS={name:'This name was not accepted.',role:'This role was not accepted.',brief:'This brief was not accepted. Reword it.',profile:'This custom agent id was not accepted.',
    app:'This app was not accepted.',model:'This model was not accepted.',effort:'This effort was not accepted.',permMode:'These permissions were not accepted.',
    cap:'This limit was not accepted.',character:'This character was not accepted.',sendBrief:'This setting was not accepted.'};

  const cp=s=>Array.from(String(s==null?'':s)).length;
  const lineCount=s=>String(s).replace(/\r\n?/g,'\n').split('\n').length;
  const briefLimits=fromFile=>fromFile?BRIEF_FILE:BRIEF_OWN;
  const num=n=>String(n).replace(/\B(?=(\d{3})+(?!\d))/g,',');
  const cut=(s,n)=>{const a=Array.from(String(s));return a.length>n?a.slice(0,n-1).join('')+'…':String(s);};
  const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);

  /* ---------------------------------------------------------------- the draft (pure) */
  let KEY=0;
  const nextKey=()=>++KEY;
  function blankMember(app){
    return {key:nextKey(),name:'',role:'',brief:'',profile:'',app:String(app||''),model:'',effort:'',permMode:'read-only',capText:'',capUnit:'',character:'',sendBrief:true,memberId:'',briefFrom:'',capCleared:false};
  }
  function newDraft(app){return {id:'',name:'',description:'',members:[blankMember(app)],notice:''};}
  /* a stored template (own data of main's answer) becomes a draft; a field of another type is read as empty, never kept */
  function draftOf(t){
    const str=v=>typeof v==='string'?v:'';
    const members=(t&&Array.isArray(t.members)?t.members:[]).slice(0,MAX_MEMBERS).map(m=>{
      m=m&&typeof m==='object'?m:{};
      const cap=m.cap&&typeof m.cap==='object'?m.cap:null;
      return {key:nextKey(),name:str(m.name),role:str(m.role),brief:str(m.brief),profile:str(m.profile),app:str(m.app),model:str(m.model),effort:str(m.effort),
        permMode:['read-only','ask','allow'].includes(m.permMode)?m.permMode:'read-only',
        capText:cap&&typeof cap.amount==='number'&&isFinite(cap.amount)?String(cap.amount):'',capUnit:cap&&(cap.unit==='usd'||cap.unit==='aiu')?cap.unit:'',
        character:str(m.character),sendBrief:m.sendBrief!==false,memberId:str(m.memberId),briefFrom:m.briefFrom==='file'?'file':'',capCleared:false};
    });
    return {id:str(t&&t.id),name:str(t&&t.name),description:str(t&&t.description),members:members.length?members:[blankMember('')],notice:''};
  }
  const canAdd=d=>d.members.length<MAX_MEMBERS;
  /* FR-002: at most 8 members; refused here too, so a caller that forgot to disable the button still cannot make a 9th */
  function addMember(d,app){
    if(!canAdd(d))return null;
    const m=blankMember(app);d.members.push(m);return m;
  }
  const canRemove=d=>d.members.length>1;
  function removeMember(d,i){
    if(!canRemove(d)||i<0||i>=d.members.length)return false;
    d.members.splice(i,1);return true;
  }
  function moveMember(d,i,dir){
    const j=i+(dir<0?-1:1);
    if(i<0||i>=d.members.length||j<0||j>=d.members.length)return false;
    const t=d.members[i];d.members[i]=d.members[j];d.members[j]=t;return true;
  }
  /* FR-022: changing the app clears the limit (its unit may differ) and the model and effort (they are the old app's); nothing else moves */
  function changeApp(m,app){
    m.app=String(app||'');m.capText='';m.capUnit='';m.capCleared=false;m.model='';m.effort='';
    return m;
  }
  /* the model changed: the effort stays only when the new model offers it (`efforts`: the model's list, or null when unknown) */
  function changeModel(m,id,efforts){
    m.model=String(id||'');
    if(!m.model||!Array.isArray(efforts)||!efforts.includes(m.effort))m.effort='';
    return m;
  }
  /* the limit's unit follows the app (`unit` 'usd' or 'aiu'; '' = the app has no limit): a typed amount stays only in the unit it was typed in */
  function syncCapUnit(m,unit){
    if(m.capUnit&&unit&&m.capUnit!==unit&&m.capText!==''){m.capText='';m.capCleared=true;}
    m.capUnit=unit||'';
    return m;
  }
  function markMine(m){m.briefFrom='';return m;}

  /* ---------------------------------------------------------------- the rules of the form (pure; main checks again) */
  const keyOfName=s=>{let t=String(s==null?'':s);try{t=t.normalize('NFKC');}catch(e){/* keep as is */}return t.trim().replace(/\s+/g,' ').toLowerCase();};
  /* the names of the other members that read the same as member i's (a simple fold here; main compares by skeleton and refuses a clash too) */
  function sameNames(d,i){
    const k=keyOfName(d.members[i].name);
    if(!k)return [];
    const out=[];d.members.forEach((o,j)=>{if(j!==i&&keyOfName(o.name)===k)out.push(j);});
    return out;
  }
  function capWords(unit,limits){
    const lim=limits||{};
    return unit==='usd'?'Use an amount from '+(lim.minUsd>0?lim.minUsd:0.01)+' to '+num(10000)+' dollars.':'Use an amount from '+(lim.minAiu>0?lim.minAiu:30)+' to '+num(1000000)+' AI credits.';
  }
  /* {template:{name,description,members?}, members:[{name?,role?,brief?,profile?,cap?}], count} of fixed sentences; `parse(unit,text)` is DurbarMemberRows.capParse */
  function checkDraft(d,o){
    o=o||{};
    const out={template:{},members:d.members.map(()=>({})),count:0};
    const add=(bag,k,t)=>{bag[k]=t;out.count++;};
    const tn=String(d.name).trim();
    if(!tn||cp(tn)>TPL_NAME_MAX)add(out.template,'name','Give the template a name (1 to '+TPL_NAME_MAX+' characters).');
    const ds=String(d.description);
    if(cp(ds.trim())>DESC_MAX||/[\r\n]/.test(ds))add(out.template,'description','The description is one line of at most '+DESC_MAX+' characters.');
    if(d.members.length<1||d.members.length>MAX_MEMBERS)add(out.template,'members','A template has 1 to '+MAX_MEMBERS+' members.');
    d.members.forEach((m,i)=>{
      const bag=out.members[i];
      const n=String(m.name).trim(),r=String(m.role).trim();
      if(!n||cp(n)>NAME_MAX)add(bag,'name','Give the member a name (1 to '+NAME_MAX+' characters).');
      else if(sameNames(d,i).length)add(bag,'name','Two members cannot have names that look the same.');
      if(!r||cp(r)>ROLE_MAX)add(bag,'role','Give the member a role (1 to '+ROLE_MAX+' characters).');
      const lim=briefLimits(m.briefFrom==='file');
      if(cp(m.brief)>lim.chars||lineCount(m.brief)>lim.lines)add(bag,'brief','The brief is too long: at most '+num(lim.chars)+' characters and '+lim.lines+' lines.');
      if(m.profile!==''&&!PROFILE_ID_RE.test(m.profile))add(bag,'profile','Use letters, digits and . _ : @ / - only, up to 100 characters.');
      if(m.capUnit&&String(m.capText).trim()!==''){
        const p=o.parse?o.parse(m.capUnit==='usd',m.capText):{amount:parseFloat(m.capText)};
        if(p.error)add(bag,'cap',capWords(m.capUnit,o.limits));
      }
    });
    return out;
  }
  /* the value `teams:put` takes: no empty optional, the trimmed texts, a `memberId` for a member that exists (main keeps its file mark by it; `briefFrom`
     is never sent: only `teams:markMine` removes it) */
  function payload(d){
    const t={name:String(d.name).trim(),members:d.members.map(m=>{
      const o={name:String(m.name).trim(),role:String(m.role).trim(),app:m.app,permMode:m.permMode,sendBrief:m.sendBrief!==false};
      if(String(m.brief).trim()!=='')o.brief=String(m.brief).replace(/\r\n?/g,'\n');
      if(m.profile!=='')o.profile=m.profile;
      if(m.model!=='')o.model=m.model;
      if(m.effort!=='')o.effort=m.effort;
      if(m.character!=='')o.character=m.character;
      if(m.capUnit&&String(m.capText).trim()!==''){const a=parseFloat(m.capText);if(isFinite(a))o.cap={unit:m.capUnit,amount:Math.round(a*100)/100};}
      if(m.memberId!=='')o.memberId=m.memberId;
      return o;
    })};
    const desc=String(d.description).trim();
    if(desc!=='')t.description=desc;
    if(d.id!=='')t.id=d.id;
    return t;
  }
  /* which fields main refused, from the start of each `errors` line ("Member 2, brief: ..."): only the member number and a known field name are read, nothing after it */
  function refusedFields(res){
    const out=new Map();
    const errs=res&&Array.isArray(res.errors)?res.errors.slice(0,200):[];
    for(const e of errs){
      const m=typeof e==='string'?/^Member (\d{1,2})(?:, (name|role|brief|profile|app|model|effort|permMode|cap|character|sendBrief|role and brief))?[:,]/.exec(e.slice(0,60)):null;
      if(!m)continue;
      const f=m[2]==='role and brief'?'brief':m[2];
      if(!f)continue;
      const i=Number(m[1])-1;
      if(i<0||i>=MAX_MEMBERS)continue;
      if(!out.has(i))out.set(i,new Set());
      out.get(i).add(f);
    }
    return out;
  }
  /* what the person can change, as one string: the draft is "dirty" when it differs from the one it started as (Esc then asks before it discards) */
  const snapshot=d=>JSON.stringify([d.name,d.description,d.members.map(m=>[m.name,m.role,m.brief,m.profile,m.app,m.model,m.effort,m.permMode,m.capText,m.character,m.sendBrief,m.memberId])]);
  const isDirty=(d,base)=>snapshot(d)!==base;
  const DISCARD_WORDS='What you typed in this template will be lost.';
  const legendText=(i,n,name)=>'Member '+(i+1)+' of '+n+(String(name).trim()?': '+cut(String(name).trim(),40):'');
  const charLabel=id=>{const s=String(id).replace(/[-_]+/g,' ').trim();return s?s.charAt(0).toUpperCase()+s.slice(1):String(id);};
  /* the state words of a member (FR-132): in its description, so a screen reader hears them with the member */
  function stateWords(m,appState){
    const w=[];
    if(m.briefFrom==='file')w.push('Brief from a file');
    if(appState&&appState!=='ready')w.push(appState==='not-installed'?'App not installed':'App not ready');
    return w;
  }

  /* ---------------------------------------------------------------- the dialog (page only) */
  /* focus, then reveal the control in its own scroller (innerscroll.js), as screens.js and teams.js do; never a bare .focus() */
  const focusEl=t=>{if(!t||typeof t.focus!=='function')return;if(typeof window!=='undefined'&&window.DurbarScroll&&window.DurbarScroll.focus)window.DurbarScroll.focus(t);else t.focus({preventScroll:true});};
  const el=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!=null)e.textContent=text;return e;};

  /* open({mode:'new'|'edit', template?}, env) resolves true when the list should be repainted (something was saved, a brief was marked, or main said the
     file changed), false otherwise. env: {bridge, askDialog, announce, toast, refusalText, rows (the page's app, model and permission helpers), opener} */
  async function open(request,env){
    const R=env&&env.rows?env.rows():null, MR=typeof self!=='undefined'?self.DurbarMemberRows:null;
    if(!R||!MR||!env.bridge||typeof env.bridge.teamsPut!=='function'||typeof env.askDialog!=='function'){
      if(env&&env.toast)env.toast('The member editor is not available here.',3600);
      return false;
    }
    const say=t=>{if(env.announce)env.announce(t);};
    const edit=request&&request.mode==='edit'&&request.template;
    if(request&&request.mode==='edit'&&!request.template){say('That template is not there any more.');if(env.toast)env.toast('That template is not there any more.',3600);return true;}
    const choices=()=>{const k=R.kinds();return k.length?k:FALLBACK_APPS.map(id=>({id,name:id,shortName:id,state:'',stateText:''}));};
    const firstReady=()=>{const c=choices();return (c.find(k=>!k.disabled)||c[0]||{id:''}).id;};
    const draft=edit?draftOf(request.template):newDraft(firstReady());
    const opener=request.opener||(document.activeElement!==document.body?document.activeElement:null);
    let baseline=null; /* taken after the first paint of the members: that paint normalises what the app cannot enforce (a permission, a limit in the other unit, an empty app) */
    let reload=false, saved=false, focusAfter=null;
    for(;;){
      const shown=draft.notice;draft.notice='';
      const r=await ask(draft,{notice:shown,focus:focusAfter});
      focusAfter=null;
      if(r&&r.value==='discard?'){ /* Esc, Cancel or the backdrop with unsaved changes: ask (the editor is closed meanwhile, the draft is kept) */
        const ans=await env.askDialog({title:'Discard changes?',body:DISCARD_WORDS,
          buttons:[{label:'Cancel',value:null},{label:'Discard',value:'discard',cls:'primary danger'}],returnFocus:opener}); /* danger: the focus starts on Cancel */
        if(ans&&ans.value==='discard')return reload||saved;
        continue;
      }
      if(r&&typeof r.value==='string'&&r.value.indexOf('mark:')===0){
        const m=draft.members.find(x=>String(x.key)===r.value.slice(5));
        const done=m?await confirmMark(m):false;
        if(done)reload=true;
        focusAfter=m?{key:m.key,field:'brief'}:null;
        continue;
      }
      return reload||saved||!!(r&&r.value==='save');
    }

    async function confirmMark(m){
      const ans=await env.askDialog({title:'Mark this brief as yours?',body:MARK_WORDS,
        buttons:[{label:'Keep as from the file',value:null},{label:'Mark as mine',value:'mark',cls:'primary warn'}],returnFocus:opener}); /* warn: the focus starts on the safe button */
      if(!ans||ans.value!=='mark')return false;
      let res=null;try{res=await env.bridge.teamsMarkMine(draft.id,m.memberId);}catch(e){res=null;}
      if(res&&res.ok){markMine(m);say('The brief is marked as yours.');draft.notice='';return true;}
      draft.notice=env.refusalText?env.refusalText(res,'Marking the brief'):'Marking the brief did not work.';
      if(res&&res.ok===false&&res.code==='changed')reload=true;
      say(draft.notice);
      return false;
    }

    /* one dialog for the draft as it is now; resolves {value:'save'|'mark:<key>'} or null */
    function ask(d,o){
      const ui=build(d,o);
      if(baseline===null)baseline=snapshot(d);
      let closeIt=null;
      const busyNow=()=>!!ui.busy;
      ui.closeWith=v=>{if(closeIt)closeIt(v);};
      const p=env.askDialog({title:d.id?'Edit team template':'New team template',body:'A template is a saved team: its members, roles and settings. Nothing starts until you use it.',
        size:'l',overlayClass:'tm-ed-ov',returnFocus:opener,
        custom:{node:ui.node,value:()=>null,valid:()=>true,confirm:()=>ui.save(),dismiss:()=>{if(busyNow())return false;if(!isDirty(draft,baseline))return true;if(closeIt)closeIt('discard?');return false;}},
        buttons:[{label:'Cancel',value:null},{label:'Save template',value:'save',cls:'primary'}],
        auto:(close)=>{closeIt=close;return ()=>{ui.dead=true;};}});
      /* the focus goes where the caller says (after a mark) or to the template's name, once the dialog is in the page */
      Promise.resolve().then(()=>ui.start());
      return p;
    }

    /* ------------------------------------------------ the form */
    function build(d,o){
      const ui={dead:false,closeWith:null};
      const node=el('div','tm-ed');node.setAttribute('role','group');node.setAttribute('aria-label','Template and members');
      const err=el('p','derr',o.notice||'');err.id='tmEdErr';err.tabIndex=-1;err.setAttribute('role','alert');err.hidden=!o.notice;node.appendChild(err);
      const setNote=t=>{err.textContent=t||'';err.hidden=!t;};

      /* a field: label, control, hint, error; ids are per member (key) so a repaint never repeats one */
      const ids=new Set();
      const uid=(base)=>{let n=base,i=1;while(ids.has(n))n=base+'_'+(++i);ids.add(n);return n;};
      function field(host,base,labelText,control,hintText,cls){
        const w=el('div','tm-f'+(cls?' '+cls:''));
        const id=uid('tmEd-'+base);control.id=id;
        const lab=el('label',null,labelText);lab.htmlFor=id;
        w.appendChild(lab);w.appendChild(control);
        const dn=[];
        if(hintText){const h=el('small','dhint',hintText);h.id=id+'-h';w.appendChild(h);dn.push(h.id);}
        const e=el('small','tm-err','');e.id=id+'-e';e.hidden=true;w.appendChild(e);
        host.appendChild(w);
        return {w,control,err:e,base:dn,id};
      }
      /* the error of a field: fixed words, linked to the control by aria-describedby, and the control is marked invalid */
      function showErr(f,text){
        f.err.textContent=text||'';f.err.hidden=!text;
        const ids2=f.base.slice();if(f.extra)ids2.push.apply(ids2,f.extra());
        if(text){ids2.push(f.err.id);f.control.setAttribute('aria-invalid','true');}else f.control.removeAttribute('aria-invalid');
        if(ids2.length)f.control.setAttribute('aria-describedby',ids2.join(' '));else f.control.removeAttribute('aria-describedby');
      }
      const text=(v,max)=>{const i=el('input');i.type='text';i.value=v;i.autocomplete='off';i.spellcheck=false;void max;return i;};

      /* template */
      const head=el('div','tm-grid');node.appendChild(head);
      const fName=field(head,'tname','Template name',text(d.name),null);
      const fDesc=field(head,'tdesc','Description (optional)',text(d.description),'One line, up to '+DESC_MAX+' characters.');
      fName.control.oninput=()=>{d.name=fName.control.value;showErr(fName,'');};
      fDesc.control.oninput=()=>{d.description=fDesc.control.value;showErr(fDesc,'');};
      showErr(fName,'');showErr(fDesc,'');

      const list=el('div','tm-members');node.appendChild(list);
      const addBar=el('div','tm-addbar');node.appendChild(addBar);
      const addBtn=el('button','btn','Add member');addBtn.type='button';addBtn.dataset.act='add';
      const addNote=el('small','dhint','');addNote.id='tmEdAddNote';
      addBar.appendChild(addBtn);addBar.appendChild(addNote);
      const countEl=el('small','tm-err','');countEl.id='tmEdCount';countEl.hidden=true;node.appendChild(countEl);

      const parse=(usd,t)=>MR.capParse(usd,t,R.limits);
      const views=new Map(); /* member key -> its fields, to read and repaint */

      function paintAddBar(){
        const can=canAdd(d);
        addBtn.disabled=!can;
        addNote.textContent=can?d.members.length+' of '+MAX_MEMBERS+' members.':'A team has at most '+MAX_MEMBERS+' members.';
        addBtn.setAttribute('aria-describedby','tmEdAddNote');
      }
      const refreshLegends=()=>{
        d.members.forEach((m,i)=>{
          const v=views.get(m.key);if(!v)return;
          v.legend.textContent=legendText(i,d.members.length,m.name);
          const nm=m.name.trim()||('member '+(i+1));
          v.up.disabled=i===0;v.down.disabled=i===d.members.length-1;v.rm.disabled=!canRemove(d);
          v.up.setAttribute('aria-label','Move up '+nm);v.down.setAttribute('aria-label','Move down '+nm);v.rm.setAttribute('aria-label','Remove '+nm);
          v.rm.title=canRemove(d)?'':'A template has at least one member.';
          if(v.mark)v.mark.setAttribute('aria-label','Mark the brief of '+nm+' as mine');
        });
      };

      function memberView(m){
        const caps=()=>R.kindCaps(m.app);
        const fs=el('fieldset','tm-mem');fs.dataset.key=String(m.key);
        const legend=el('legend','',legendText(0,1,m.name));fs.appendChild(legend);
        const stId='tmEd-m'+m.key+'-st';
        const status=el('small','tm-st','');status.id=stId;fs.setAttribute('aria-describedby',stId);
        const bar=el('div','tm-mh');fs.appendChild(bar);
        const btn=(label,act)=>{const b=el('button','btn sm',label);b.type='button';b.dataset.act=act;bar.appendChild(b);return b;};
        const up=btn('Move up','up'),down=btn('Move down','down'),rm=btn('Remove','remove');rm.classList.add('danger');
        bar.appendChild(status);
        const grid=el('div','tm-grid');fs.appendChild(grid);
        const v={fs,legend,up,down,rm,status,f:{},mark:null};

        v.f.name=field(grid,'m'+m.key+'-name','Name',text(m.name),null);
        v.f.role=field(grid,'m'+m.key+'-role','Role',text(m.role),null);
        const marks=el('div','tm-marks');marks.id='tmEd-m'+m.key+'-marks';marks.setAttribute('role','note');
        v.marks=marks;v.f.name.extra=()=>marks.childNodes.length?[marks.id]:[];
        v.f.name.w.appendChild(marks);

        /* app: state words in the options (a not-installed app can still be chosen for a template; the create step says it again) */
        const appSel=el('select');
        const known=choices();
        known.forEach(k=>{const o2=el('option','',(k.shortName||k.name||k.id)+' ('+(k.stateText||'ready')+')');o2.value=k.id;appSel.appendChild(o2);});
        if(m.app&&!known.some(k=>k.id===m.app)){const o2=el('option','',m.app+' (not available here)');o2.value=m.app;appSel.appendChild(o2);}
        if(!m.app)m.app=firstReady();
        appSel.value=m.app;
        v.f.app=field(grid,'m'+m.key+'-app','App',appSel,null);

        const modelSel=el('select');
        v.f.model=field(grid,'m'+m.key+'-model','Model',modelSel,null);
        const effSel=el('select');
        v.f.effort=field(grid,'m'+m.key+'-eff','Reasoning effort',effSel,null);

        const perm=MR.permRow(document,{id:uid('tmEd-m'+m.key+'-perm')});
        const pw=el('div','tm-f');pw.appendChild(perm.label);grid.appendChild(pw);v.permW=pw;v.perm=perm.select;
        const capIds={row:uid('tmEd-m'+m.key+'-caprow'),title:uid('tmEd-m'+m.key+'-capt'),input:uid('tmEd-m'+m.key+'-cap'),hint:uid('tmEd-m'+m.key+'-caph')};
        const cap=MR.capRow(document,{ids:capIds,describedBy:[]});
        const cw=el('div','tm-f');cap.nodes.forEach(n=>cw.appendChild(n));
        const capErr=el('small','tm-err','');capErr.id=capIds.input+'-e';capErr.hidden=true;cw.appendChild(capErr);grid.appendChild(cw);
        v.capW=cw;v.cap=cap;v.f.cap={control:cap.input,err:capErr,base:[capIds.hint],extra:null,w:cw};
        const capNote=el('small','dhint','');capNote.id=capIds.input+'-n';cw.appendChild(capNote);v.capNote=capNote;

        const prof=field(grid,'m'+m.key+'-prof','Custom agent id (optional)',text(m.profile),PROFILE_HINT);
        v.f.profile=prof;
        const charSel=el('select');
        v.f.character=field(grid,'m'+m.key+'-char','Character',charSel,null);

        const bw=el('div','tm-f tm-wide');
        const ta=el('textarea');ta.rows=3;ta.value=m.brief;ta.spellcheck=false;
        v.f.brief=field(bw,'m'+m.key+'-brief','Role brief (optional)',ta,'Up to '+BRIEF_OWN.chars+' characters.');
        grid.appendChild(bw);
        const briefHint=bw.querySelector('.dhint');
        const sendId=uid('tmEd-m'+m.key+'-send');
        const sl=el('label','chk');const sc=el('input');sc.type='checkbox';sc.id=sendId;sc.checked=m.sendBrief!==false;sl.appendChild(sc);sl.appendChild(document.createTextNode(' Send role brief'));
        bw.appendChild(sl);v.send=sc;
        if(m.briefFrom==='file'&&m.memberId&&d.id){
          const mk=el('button','btn sm','Mark as mine');mk.type='button';mk.dataset.act='mark';bw.appendChild(mk);v.mark=mk;
          mk.onclick=()=>ui.closeWith('mark:'+m.key);
        }

        /* ---- painting from the member's data */
        v.paintBrief=()=>{
          const lim=briefLimits(m.briefFrom==='file');
          briefHint.textContent=(m.briefFrom==='file'?'From a file: up to ':'Up to ')+num(lim.chars)+' characters and '+lim.lines+' lines.'+(m.briefFrom==='file'?' Use Mark as mine to write your own.':'');
        };
        v.paintStatus=()=>{
          const st=(known.find(k=>k.id===m.app)||{}).state;
          v.status.textContent=stateWords(m,st).join(' · ');
        };
        v.paintMarks=()=>{
          marks.textContent='';
          const L=typeof self!=='undefined'?self.DurbarLookalike:null;
          if(L&&m.name){try{const r=L.check(m.name.slice(0,200),'other');if(r&&r.findings&&r.findings.length)marks.appendChild(el('span','mtag warn','Mixed letters'));}catch(e){/* a mark is only a help */}}
          const i=d.members.indexOf(m);
          if(i>=0)sameNames(d,i).forEach(j=>marks.appendChild(el('span','mtag warn','Looks like '+cut(d.members[j].name.trim(),40))));
          showErr(v.f.name,v.f.name.err.hidden?'':v.f.name.err.textContent);
        };
        v.paintModels=()=>{
          const app=m.app,c=caps();
          const can=R.shows(c,'models');
          const list2=can?R.modelsFor(app):[];
          const loaded=v.loaded===app;
          if(can&&!loaded&&!v.loading){v.loading=true;R.ensureModels(app).then(()=>{v.loading=false;v.loaded=app;if(!ui.dead&&views.get(m.key)===v)v.paintModels();},()=>{v.loading=false;v.loaded=app;});}
          const none=!can||(loaded&&!list2.length);
          v.f.model.w.hidden=none;
          if(none){v.f.effort.w.hidden=true;return;}
          if(!loaded){modelSel.textContent='';const o2=el('option','','Loading models…');o2.value='';modelSel.appendChild(o2);modelSel.disabled=true;v.f.effort.w.hidden=true;return;}
          modelSel.disabled=false;
          R.fillModelSelect(modelSel,undefined,app);
          const dflt=el('option','','App default');dflt.value='';modelSel.insertBefore(dflt,modelSel.firstChild);
          if(m.model&&!list2.some(x=>x.id===m.model)){const o2=el('option','',m.model+' (not offered here)');o2.value=m.model;modelSel.appendChild(o2);}
          modelSel.value=m.model;
          const model=list2.find(x=>x.id===m.model);
          const effOff=!R.shows(c,'effort')||!model;
          R.fillEffortSelect(effSel,m.model,m.effort,effOff,app);
          v.f.effort.w.hidden=effSel.hidden;
          if(!effSel.hidden)effSel.value=m.effort;
        };
        v.paintPerm=()=>{v.perm.value=m.permMode;R.fillPerm(v.perm,caps(),m.app);m.permMode=v.perm.value;};
        v.paintCap=()=>{
          const c=caps(),shown=R.shows(c,'cap'),usd=!!c&&c.capUnit==='usd';
          cw.hidden=!shown;
          syncCapUnit(m,shown?(usd?'usd':'aiu'):'');
          if(!shown)return;
          const sp=MR.capSpec(usd,{template:true,minUsd:R.limits&&R.limits.minUsd});
          cap.input.min=sp.min;cap.input.placeholder=sp.placeholder;cap.hint.textContent=sp.hint;
          cap.title.textContent=usd?'Spending limit (dollars)':'Spending limit (AI credits)';
          cap.input.value=m.capText;
          capNote.textContent=m.capCleared?'Its saved limit used another unit, so it was cleared.':'';capNote.hidden=!m.capCleared;
        };
        v.paintChars=()=>{
          const ids3=R.characters();
          charSel.textContent='';
          const any=el('option','','Any');any.value='';charSel.appendChild(any);
          ids3.forEach(id=>{const o2=el('option','',charLabel(id));o2.value=id;charSel.appendChild(o2);});
          if(m.character&&!ids3.includes(m.character)){const o2=el('option','',m.character+' (not in the current set)');o2.value=m.character;charSel.appendChild(o2);}
          charSel.value=m.character;
        };
        v.paintAll=()=>{v.paintBrief();v.paintStatus();v.paintMarks();v.paintModels();v.paintPerm();v.paintCap();v.paintChars();};

        /* ---- events: the draft always holds what is on screen; typing clears that field's error */
        const clear=f=>showErr(f,'');
        v.f.name.control.oninput=e=>{m.name=e.target.value;clear(v.f.name);d.members.forEach(o2=>{const w2=views.get(o2.key);if(w2)w2.paintMarks();});refreshLegends();};
        v.f.role.control.oninput=e=>{m.role=e.target.value;clear(v.f.role);};
        ta.oninput=()=>{m.brief=ta.value;clear(v.f.brief);};
        sc.onchange=()=>{m.sendBrief=sc.checked;};
        prof.control.oninput=e=>{m.profile=e.target.value.trim();clear(prof);};
        cap.input.oninput=()=>{m.capText=cap.input.value;m.capCleared=false;capNote.hidden=true;clear(v.f.cap);};
        appSel.onchange=()=>{changeApp(m,appSel.value);v.loaded=null;clear(v.f.cap);v.paintStatus();v.paintModels();v.paintPerm();v.paintCap();};
        modelSel.onchange=()=>{const mod=R.modelsFor(m.app).find(x=>x.id===modelSel.value);changeModel(m,modelSel.value,mod&&mod.efforts);v.paintModels();};
        effSel.onchange=()=>{m.effort=effSel.value;};
        v.perm.onchange=()=>{m.permMode=v.perm.value;};
        charSel.onchange=()=>{m.character=charSel.value;};
        up.onclick=()=>act('up',m);down.onclick=()=>act('down',m);rm.onclick=()=>act('remove',m);
        v.paintAll();
        return v;
      }

      function repaintMembers(){
        views.clear();list.textContent='';
        ids.clear();ids.add(fName.id);ids.add(fDesc.id); /* the old members' ids are gone with their fieldsets */
        d.members.forEach(m=>{const v=memberView(m);views.set(m.key,v);list.appendChild(v.fs);});
        d.members.forEach(m=>{const v=views.get(m.key);if(v)v.paintMarks();});
        refreshLegends();paintAddBar();
      }
      function focusMember(m,sel){
        const v=m&&views.get(m.key);const t=v&&v.fs.querySelector(sel);
        if(t&&!t.disabled){focusEl(t);return true;}
        return false;
      }
      function act(kind,m){
        const i=d.members.indexOf(m);
        if(kind==='up'||kind==='down'){
          if(!moveMember(d,i,kind==='up'?-1:1))return;
          repaintMembers();
          say(m.name.trim()+' moved to position '+(d.members.indexOf(m)+1)+' of '+d.members.length+'.');
          if(!focusMember(m,'[data-act="'+kind+'"]'))focusMember(m,'[data-act="'+(kind==='up'?'down':'up')+'"]');
        }else if(kind==='remove'){
          const nm=m.name.trim()||'The member';
          if(!removeMember(d,i))return;
          repaintMembers();say(nm+' removed. '+d.members.length+(d.members.length===1?' member':' members')+' left.');
          const nx=d.members[Math.min(i,d.members.length-1)];
          focusMember(nx,'input[type="text"]');
        }
      }
      addBtn.onclick=()=>{
        const m=addMember(d,firstReady());
        if(!m){say('A team has at most '+MAX_MEMBERS+' members.');return;}
        repaintMembers();say('Member added. '+d.members.length+' members.');
        focusMember(m,'input[type="text"]');
      };
      repaintMembers();

      /* ------------------------------------------------ save */
      let busy=false;
      function showCheck(c){
        showErr(fName,c.template.name||'');showErr(fDesc,c.template.description||'');
        countEl.textContent=c.template.members||'';countEl.hidden=!c.template.members;
        d.members.forEach((m,i)=>{
          const v=views.get(m.key);if(!v)return;
          for(const f of ['name','role','brief','profile','cap'])showErr(v.f[f],c.members[i][f]||'');
        });
      }
      function firstInvalid(){return node.querySelector('[aria-invalid="true"]');}
      ui.save=async function(){
        if(busy)return false;
        const c=checkDraft(d,{parse,limits:R.limits});
        showCheck(c);
        if(c.count>0){
          setNote('Some fields need attention: '+c.count+(c.count===1?' field is':' fields are')+' marked.');
          say(err.textContent);
          const f=firstInvalid();if(f)focusEl(f);else focusEl(err);
          return false;
        }
        setNote('');busy=true;ui.busy=true;say('Saving…');
        let res=null;try{res=await env.bridge.teamsPut(payload(d));}catch(e){res=null;}
        busy=false;ui.busy=false;
        if(res&&res.ok){saved=true;}
        if(ui.dead&&!(res&&res.ok))return false;
        if(res&&res.ok){saved=true;say('Template saved.');return true;}
        const words=env.refusalText?env.refusalText(res,'The template'):'The template could not be saved.';
        if(res&&res.ok===false&&res.code==='changed')reload=true;
        setNote(words+' What you typed is kept.');say(err.textContent);
        if(res&&res.ok===false&&res.code==='invalid'){
          const rf=refusedFields(res);
          rf.forEach((fields,i)=>{const m=d.members[i],v=m&&views.get(m.key);if(!v)return;fields.forEach(f=>{if(v.f[f])showErr(v.f[f],FIELD_WORDS[f]||'');});});
        }
        const f=firstInvalid();focusEl(f||err);
        return false;
      };
      ui.start=()=>{
        const f=o.focus;
        if(f&&focusMember(d.members.find(x=>x.key===f.key),f.field==='brief'?'textarea':'input'))return;
        if(o.notice){focusEl(err);return;}
        focusEl(fName.control);
      };
      ui.node=node;
      return ui;
    }
  }

  return {MAX_MEMBERS,NAME_MAX,ROLE_MAX,TPL_NAME_MAX,DESC_MAX,PROFILE_HINT,MARK_WORDS,FIELD_WORDS,briefLimits,blankMember,newDraft,draftOf,snapshot,isDirty,canAdd,addMember,canRemove,removeMember,moveMember,
    changeApp,changeModel,syncCapUnit,markMine,sameNames,keyOfName,capWords,checkDraft,payload,refusedFields,legendText,charLabel,stateWords,open};
})());
