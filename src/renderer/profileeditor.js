/* Profile file editor (spec 043 FR-014..FR-016): a large dialog with Edit | Split | Preview, a monospace text area, a throttled
   preview through the chat's sanitised Markdown renderer (spec 016, window.DurbarMD; no second renderer), a front matter check
   (FR-015), Save with Ctrl/Cmd+S, an Unsaved mark, a guard before closing with unsaved changes and the external-change question
   (askDialog), and New profile (FR-013). Main owns the files: this file sends only ids from main's list, or app + folder id + name.
   Plain script: in the page it defines window.DurbarProfileEditor; in Node (tests) `require` gives the pure parts. */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory(null);
  else root.DurbarProfileEditor=factory(root);
})(typeof self!=='undefined'?self:this,function(win){
  'use strict';
  const MODES=['edit','split','preview'];
  const MODE_KEY='durbar.profileEditor.mode';
  const APP_LABEL={copilot:'GitHub Copilot',claude:'Claude Code'};
  const NAME_RE=/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
  /* Windows device names (FR-011): CON.md is a device there; refused in any case, with or without an extension. A copy of main's rule (src/main/profilefiles.ts isProfileName; test:profilefiles keeps them equal). */
  const RESERVED_RE=/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i;
  const validName=n=>typeof n==='string'&&NAME_RE.test(n)&&!n.includes('..')&&!RESERVED_RE.test(n);

  /* ---------------- pure parts (unit tested: scripts/test-profileeditor.ts) ---------------- */
  /** Strips a ` # comment` that is outside quotes. */
  function stripComment(v){
    let q='';
    for(let i=0;i<v.length;i++){const c=v[i];
      if(q){if(c===q&&(q==="'"||v[i-1]!=='\\'))q='';continue;}
      if(c==='"'||c==="'"){if(i===0||/[\s\[,{]/.test(v[i-1]))q=c;continue;}
      if(c==='#'&&(i===0||/\s/.test(v[i-1])))return v.slice(0,i).trimEnd();
    }
    return v;
  }
  /** One YAML scalar or flow list as display text; an error text when it is malformed. */
  function scalar(v){
    if(v==='')return {value:''};
    const c=v[0];
    if(c==='"'){if(v.length<2||!/[^\\]"$|^""$/.test(v))return {error:'a quote " is not closed'};return {value:v.slice(1,-1).replace(/\\"/g,'"')};}
    if(c==="'"){if(v.length<2||v[v.length-1]!=="'")return {error:"a quote ' is not closed"};return {value:v.slice(1,-1).replace(/''/g,"'")};}
    if(c==='['){if(v[v.length-1]!==']')return {error:'a list [ is not closed with ]'};
      const items=[];let cur='',q='';for(const ch of v.slice(1,-1)){if(q){if(ch===q)q='';cur+=ch;continue;}if(ch==='"'||ch==="'"){q=ch;cur+=ch;continue;}if(ch===','){items.push(cur.trim());cur='';continue;}cur+=ch;}
      if(q)return {error:'a quote inside the list is not closed'};
      if(cur.trim())items.push(cur.trim());
      return {value:items.map(x=>x.replace(/^(["'])(.*)\1$/,'$2')),list:true};}
    if(c==='{'){if(v[v.length-1]!=='}')return {error:'a map { is not closed with }'};return {value:v};}
    if(c==='|'||c==='>')return {block:true};
    if(/:\s/.test(v)||/:$/.test(v))return {error:'a value with ": " in it needs quotes'};
    if(c==='@'||c==='`')return {error:'a value cannot start with '+c+' (put it in quotes)'};
    return {value:v};
  }
  /**
   * The front matter of an agent file (FR-015): the lines between a first `---` line and the next `---` line, checked as the simple
   * YAML agent files use. Returns {has, closed, entries:[{key,value,line}], errors:[{line,msg}], body, bodyLine}. Never throws.
   */
  function parseFrontmatter(text){
    const s=String(text==null?'':text).replace(/^﻿/,'').replace(/\r\n/g,'\n');
    const lines=s.split('\n');
    const none={has:false,closed:false,entries:[],errors:[],body:s,bodyLine:1};
    if(lines[0].trimEnd()!=='---')return none;
    let end=-1;for(let i=1;i<lines.length;i++){if(lines[i].trimEnd()==='---'||lines[i].trimEnd()==='...'){end=i;break;}}
    if(end<0)return {has:true,closed:false,entries:[],errors:[{line:1,msg:'The front matter starts with --- but has no closing --- line.'}],body:s,bodyLine:1};
    const entries=[],errors=[],seen=new Set();
    let cur=null; /* the entry that indented lines belong to */
    const err=(i,msg)=>{if(errors.length<20)errors.push({line:i+1,msg:'Line '+(i+1)+': '+msg+'.'});};
    for(let i=1;i<end;i++){
      const raw=lines[i];
      if(!raw.trim()||/^\s*#/.test(raw))continue;
      const lead=/^[ \t]*/.exec(raw)[0];
      if(lead.includes('\t')){err(i,'a tab is used to indent (use spaces)');continue;}
      if(lead.length){ /* belongs to the key above: a list item, a nested key or block text */
        if(!cur){err(i,'an indented line with no key above it');continue;}
        const t=raw.trim();
        if(cur.block){cur.parts.push(t);continue;}
        const item=/^-\s*(.*)$/.exec(t);
        if(item){if(cur.kind==='map'){err(i,'a list item under a key that holds keys');continue;}cur.kind='list';const sc=scalar(stripComment(item[1].trim()));if(sc.error){err(i,sc.error);continue;}cur.parts.push(Array.isArray(sc.value)?sc.value.join(', '):sc.value);continue;}
        const kv=/^([^\s:#][^:]*?|"[^"]*"|'[^']*')\s*:(?:\s+(.*))?$/.exec(t);
        if(kv){if(cur.kind==='list'){err(i,'a key inside a list (start it with "- ")');continue;}cur.kind='map';cur.parts.push(t);continue;}
        if(cur.kind==='map'||cur.kind==='list'){err(i,'expected "key: value" or "- item"');continue;}
        err(i,'an indented line that is neither "key: value" nor "- item"');continue;
      }
      if(/^-\s/.test(raw)||raw==='-'){err(i,'a list item with no key above it');cur=null;continue;}
      const kv=/^([^\s:#"'][^:]*?|"[^"]*"|'[^']*')\s*:(?:\s+(.*))?$/.exec(raw.trimEnd());
      if(!kv){err(i,'expected "key: value"');cur=null;continue;}
      const key=kv[1].replace(/^(["'])(.*)\1$/,'$2').trim();
      if(seen.has(key))err(i,'the key "'+key+'" is given twice');
      seen.add(key);
      const v=stripComment((kv[2]||'').trim());
      const sc=scalar(v);
      if(sc.error){err(i,sc.error);cur=null;continue;}
      cur={key,line:i+1,parts:[],kind:'',block:!!sc.block,value:sc.block?'':sc.value};
      entries.push(cur);
    }
    const out=entries.map(e=>{
      let value=e.value;
      if(e.block)value=e.parts.join(' ');
      else if(Array.isArray(value))value=value.join(', ');
      else if(value===''&&e.parts.length)value=e.kind==='list'?e.parts.join(', '):e.parts.join('; ');
      return {key:e.key,value:String(value==null?'':value),line:e.line};
    });
    return {has:true,closed:true,entries:out,errors,body:lines.slice(end+1).join('\n'),bodyLine:end+2};
  }
  /** Calls fn at most once every `ms` (trailing call kept), so typing does not re-render on every key. */
  function throttle(fn,ms,timers){
    const T=timers||{set:(f,d)=>setTimeout(f,d),clear:t=>clearTimeout(t),now:()=>Date.now()};
    let last=-Infinity,t=null;
    const run=()=>{t=null;last=T.now();fn();};
    const call=()=>{if(t)return;const wait=last+ms-T.now();if(wait<=0)run();else t=T.set(run,wait);};
    call.flush=()=>{if(t){T.clear(t);run();}};
    call.cancel=()=>{if(t){T.clear(t);t=null;}};
    return call;
  }
  function loadMode(store){try{const v=store&&store.getItem(MODE_KEY);return MODES.includes(v)?v:'split';}catch(e){return 'split';}}
  function saveMode(store,m){try{if(store&&MODES.includes(m))store.setItem(MODE_KEY,m);}catch(e){/* private window: not kept */}}
  const placeText=(f)=>f.scope==='user'?'your user folder':'this folder'+(f.folder?' ('+baseName(f.folder)+')':'');
  function baseName(p){const s=String(p||'').replace(/[\\/]+$/,'');const i=Math.max(s.lastIndexOf('/'),s.lastIndexOf('\\'));return i>=0?s.slice(i+1):s;}
  /** The file a new profile gets (FR-013), for the form's hint; main decides the real one. */
  const newFileName=(app,name)=>app==='copilot'?name+'.agent.md':name+'.md';
  /** The folder for the hint: for the user folder, main's real one (`userDirs` from profiles:listFiles, so CLAUDE_CONFIG_DIR shows); the ~ form only when main sent none. */
  const newDirHint=(app,scope,userDirs)=>scope==='user'?((userDirs&&typeof userDirs[app]==='string'&&userDirs[app])||(app==='copilot'?'~/.copilot/agents':'~/.claude/agents')):(app==='copilot'?'.github/agents':'.claude/agents');
  /** dir + file with the folder's own separator (a Windows user folder uses backslashes). */
  const joinHint=(dir,file)=>{const d=String(dir);const sep=d.includes('\\')&&!d.includes('/')?'\\':'/';return d.replace(/[\\/]+$/,'')+sep+file;};

  /**
   * Spec 043 FR-040 (review on PR 572): the same file, as main compares folders (`sameDir`): separators normalised, and case folded only
   * where the file system ignores case by default (Windows, macOS). On Linux `/w/App` and `/w/app` are two folders, so Delete never
   * picks the other one.
   */
  function samePath(a,b,platform){
    const n=s=>String(s||'').replace(/\\/g,'/');
    const x=n(a),y=n(b);
    return platform==='win32'||platform==='darwin'?x.toLowerCase()===y.toLowerCase():x===y;
  }

  const pure={samePath,parseFrontmatter,throttle,loadMode,saveMode,MODES,MODE_KEY,NAME_RE,RESERVED_RE,validName,newFileName,newDirHint,joinHint,placeText,baseName};
  if(!win)return pure;

  /* ---------------- the editor (page only) ---------------- */
  const doc=win.document;
  let X=null; /* {bridge, askDialog, toast, esc} from app.js */
  let st=null; /* the open file: {id, info, sha, saved, writable, mode, opener} */
  const listeners=[];
  /* FR-039: Create with AI requests not ended yet, for the whole window, not one dialog: Stop waiting, Cancel, Escape and closing
     the dialog do not take a request back, so a reopened dialog keeps Create disabled until it ends (main refuses one too) */
  const aiRun={n:0,ends:new Set()};
  const store=()=>{try{return win.localStorage;}catch(e){return null;}};
  const changed=info=>listeners.forEach(fn=>{try{fn(info);}catch(e){/* a listener's own error */}});
  const $=id=>doc.getElementById(id);
  const isOpen=()=>!!$('peOv');

  function init(ctx){X=ctx;}
  function onChange(fn){listeners.push(fn);}
  function setText(el,t){el.textContent=t==null?'':String(t);}

  function renderPreview(){
    if(!st)return;
    const fm=parseFrontmatter($('peSrc').value);
    const dl=$('peFm');dl.textContent='';
    dl.hidden=!fm.entries.length;
    for(const e of fm.entries){const dt=doc.createElement('dt');setText(dt,e.key);const dd=doc.createElement('dd');setText(dd,e.value||'—');dl.append(dt,dd);}
    const md=win.DurbarMD;
    $('peMd').innerHTML=md?md.render(fm.body):''; /* spec 016 renderer: sanitised, raw HTML as text, no images, http(s) links only */
    if(!md)setText($('peMd'),fm.body);
    const er=$('peFmErr');
    if(fm.errors.length){er.hidden=false;setText(er,'Front matter: '+fm.errors.slice(0,3).map(x=>x.msg).join(' ')+(fm.errors.length>3?' (and '+(fm.errors.length-3)+' more)':'')+' You can still save; the agent app may skip this file.');}
    else{er.hidden=true;setText(er,'');}
    st.fmErrors=fm.errors.length;
  }
  function dirty(){return !!st&&$('peSrc')&&$('peSrc').value!==st.saved;}
  /* FR-042: a template draft nobody has changed holds nothing to lose: it closes without asking and writes nothing */
  function askOnClose(){return !!st&&(st.draft&&typeof st.pristine==='string'?$('peSrc').value!==st.pristine:dirty());}
  function paintDirty(){
    if(!st)return;const d=dirty();
    $('peDirty').hidden=!d;
    const sv=$('peSave');if(sv)sv.disabled=!st.writable||!d;
  }
  function setMode(m,keepPref){
    if(!MODES.includes(m)||!st)return;
    st.mode=m;if(!keepPref)saveMode(store(),m);
    $('peMain').dataset.mode=m;
    doc.querySelectorAll('#peModes button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.pm===m)));
    if(m!=='edit')st.preview.flush(),renderPreview();
  }
  function status(t){const s=$('peStatus');if(s)setText(s,t);}

  async function close(force){
    if(!st)return true;
    if(!force&&askOnClose()){
      const v=await X.askDialog({title:'Discard changes to '+st.info.name+'?',body:'Your changes to '+st.info.fileName+' are not saved.',returnFocus:()=>$('peSrc'),
        buttons:[{label:'Keep editing',value:null},{label:'Discard',value:'discard',cls:'primary danger'}]});
      if(!v)return false;
    }
    const opener=st.opener;
    st.preview.cancel();
    doc.removeEventListener('focusin',onFocusIn,true);
    const ov=$('peOv');if(ov)ov.remove();
    st=null;
    if(opener&&typeof opener.focus==='function'&&doc.contains(opener))opener.focus();
    return true;
  }
  /* focus stays in the editor (unless a question dialog is open on top of it) */
  function onFocusIn(e){const ov=$('peOv');if(!ov||$('modeDlg')||$('peNewOv')||$('peAiOv'))return;if(!ov.contains(e.target)){const t=$('peSrc');if(t)t.focus();}}

  async function save(overwrite){
    if(!st||!st.writable||st.saving)return;
    const text=$('peSrc').value;
    if(st.draft)return saveDraft(text);
    st.saving=true;status('Saving…');
    let r;
    try{r=await X.bridge.saveProfileFile(st.id,text,st.sha,overwrite===true);}catch(e){r={ok:false,error:String(e&&e.message||e)};}
    st&&(st.saving=false);
    if(!st)return;
    if(!r.ok&&r.conflict){
      status('');
      const v=await X.askDialog({title:'The file changed on disk',body:(r.error||'The file changed since you opened it.')+' Reload it and lose your changes, or overwrite it with your text?',returnFocus:()=>$('peSrc'),
        buttons:[{label:'Cancel',value:null},{label:'Reload',value:'reload'},{label:'Overwrite',value:'over',cls:'primary danger'}]});
      if(!v||!st)return;
      if(v.value==='over')return save(true);
      return reload();
    }
    if(!r.ok){status('Not saved: '+(r.error||'unknown error'));return;}
    st.sha=r.sha256;st.saved=text;st.info=r.info||st.info;
    paintHead();paintDirty();
    status(st.fmErrors?'Saved. The front matter has an error, so the agent app may skip this profile.':'Saved. Changes apply to sessions started after saving.');
    changed(st.info);
  }
  /* FR-029: the first Save of a draft creates the file (exclusive), then it is an ordinary open file */
  async function saveDraft(text){
    st.saving=true;status('Saving…');
    const d=st.draft;
    const r=await X.bridge.createProfileFile(d.app,d.place,d.name,d.template||'success',text).catch(e=>({ok:false,error:String(e&&e.message||e)}));
    if(!st)return;
    st.saving=false;
    if(!r.ok){status('Not saved: '+(r.error||'unknown error'));return;}
    const f=await X.bridge.readProfileFile(r.id).catch(()=>null);
    if(!st)return;
    st.id=r.id;st.draft=null;st.pristine=undefined;st.info=(f&&f.ok&&f.info)||r.info;st.sha=f&&f.ok?f.sha256:'';st.saved=f&&f.ok?f.text:text;
    if(f&&f.ok&&f.text!==$('peSrc').value)$('peSrc').value=f.text;
    if($('peVs'))$('peVs').hidden=false;
    paintHead();paintDirty();
    status(st.fmErrors?'Saved. The front matter has an error, so the agent app may skip this profile.':'Saved. Changes apply to sessions started after saving.');
    changed(st.info);
  }
  async function reload(){
    if(!st)return;
    const r=await X.bridge.readProfileFile(st.id).catch(e=>({ok:false,error:String(e&&e.message||e)}));
    if(!st)return;
    if(!r.ok){status('Could not reload: '+(r.error||'unknown error'));return;}
    st.sha=r.sha256;st.saved=r.text;st.info=r.info;st.writable=!!r.info.writable;
    $('peSrc').value=r.text;$('peSrc').readOnly=!st.writable;
    paintHead();paintDirty();renderPreview();status('Reloaded from disk.');
  }
  function paintHead(){
    const f=st.info;
    setText($('peT'),f.name||f.fileName);
    setText($('peSub'),'Agent Success Profile · '+(APP_LABEL[f.app]||f.app)+' · '+placeText(f)+' · '+f.fileName+(st.draft?' · new file, not saved yet':'')); /* owner decision 2026-10-21 (FR-019) */
    $('peSub').title=f.path||'';
    const ro=$('peRo');ro.hidden=st.writable;setText(ro,st.writable?'':'Read-only: '+(f.note||'you cannot write this file.'));
    const sv=$('peSave');if(sv)sv.hidden=!st.writable;
  }

  /** Opens the editor on a file id from listProfileFiles (FR-014). */
  async function open(id,opts){
    if(!X||!X.bridge.readProfileFile)return;
    if(isOpen()&&!(await close()))return;
    const r=await X.bridge.readProfileFile(id).catch(e=>({ok:false,error:String(e&&e.message||e)}));
    if(!r||!r.ok){X.toast('Could not open the Agent Success Profile: '+X.esc((r&&r.error)||'unknown error'),5000);return;}
    const opener=(opts&&opts.returnFocus)||(doc.activeElement&&doc.activeElement!==doc.body?doc.activeElement:null);
    mount({id,info:r.info,sha:r.sha256,saved:r.text,writable:!!r.info.writable,mode:loadMode(store()),opener,fmErrors:0},r.text);
  }
  /** FR-029: a draft that has no file yet (an AI result); Save creates the file. Opens in `opts.mode` (Split for a new draft). */
  async function openDraft(d,opts){
    if(!X||!X.bridge.createProfileFile)return;
    if(isOpen()&&!(await close()))return;
    const opener=(opts&&opts.returnFocus)||null;
    const fileName=newFileName(d.app,d.name);
    mount({id:null,draft:{app:d.app,place:d.place,name:d.name,template:d.template},pristine:opts&&opts.pristine?d.text:undefined,info:{app:d.app,scope:d.place==='user'?'user':'folder',folder:d.folder,fileName,path:'',name:d.name,writable:true},sha:'',saved:'',writable:true,mode:(opts&&opts.mode)||loadMode(store()),opener,fmErrors:0},d.text);
    if(opts&&opts.note)status(opts.note);
  }
  function mount(state,text){
    st=state;
    st.preview=throttle(renderPreview,150);
    const ov=doc.createElement('div');ov.id='peOv';ov.className='dlg-ov pe-ov';
    ov.innerHTML=`<div class="dlg pe" role="dialog" aria-modal="true" aria-labelledby="peT" aria-describedby="peSub">
      <div class="pe-head">
        <div class="pe-tt"><h3 id="peT"></h3><span class="pe-dirty" id="peDirty" hidden>Unsaved</span><p class="pe-sub" id="peSub"></p></div>
        <div class="seg pe-modes" id="peModes" role="group" aria-label="View"><button type="button" data-pm="edit" aria-pressed="false">Edit</button><button type="button" data-pm="split" aria-pressed="false">Split</button><button type="button" data-pm="preview" aria-pressed="false">Preview</button></div>
        <div class="pe-acts">${X.bridge.openProfileInVSCode?'<button class="btn sm" type="button" id="peVs" title="Open this file in VS Code">Open in VS Code</button>':''}<button class="btn sm primary" type="button" id="peSave" title="Save (Ctrl+S)">Save</button><button class="btn sm" type="button" id="peClose">Close</button></div>
      </div>
      <p class="pe-ro" id="peRo" role="note" hidden></p>
      <div class="pe-main" id="peMain">
        <div class="pe-edit"><label class="sr-only" for="peSrc">Text of the profile file</label><textarea id="peSrc" class="pe-src" spellcheck="false" autocomplete="off" autocapitalize="off" wrap="soft"></textarea><p class="pe-fmerr" id="peFmErr" role="status" hidden></p></div>
        <div class="pe-prev" id="pePrev" tabindex="0" role="region" aria-label="Preview"><dl class="pe-fm" id="peFm" hidden></dl><div class="md pe-md" id="peMd"></div></div>
      </div>
      <div class="pe-foot"><p class="pe-status" id="peStatus" role="status" aria-live="polite"></p><p class="pe-hint">Changes apply to sessions started after saving.</p></div>
    </div>`;
    doc.body.appendChild(ov);
    const src=$('peSrc');src.value=text;src.readOnly=!st.writable;
    paintHead();setMode(st.mode,true);paintDirty();renderPreview();
    src.addEventListener('input',()=>{paintDirty();st.preview();});
    $('peModes').addEventListener('click',e=>{const b=e.target.closest('button[data-pm]');if(b)setMode(b.dataset.pm);});
    $('peSave').onclick=()=>save(false);
    $('peClose').onclick=()=>close();
    if($('peVs')&&st.draft)$('peVs').hidden=true;
    if($('peVs'))$('peVs').onclick=async()=>{const v=await X.bridge.openProfileInVSCode(st.id).catch(e=>({ok:false,error:String(e&&e.message||e)}));if(!v.ok)X.toast(X.esc(v.error||'Could not open VS Code.'),5000);};
    /* links in the preview open in the system browser (http/https only; the renderer keeps no other href) */
    $('pePrev').addEventListener('click',e=>{const a=e.target.closest('a');if(!a)return;e.preventDefault();const h=a.getAttribute('href')||'';if(/^https?:\/\//i.test(h)&&X.bridge.openExternal)X.bridge.openExternal(h);});
    ov.addEventListener('keydown',e=>{
      if((e.ctrlKey||e.metaKey)&&!e.altKey&&(e.key==='s'||e.key==='S')){e.preventDefault();e.stopPropagation();save(false);return;}
      if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close();return;}
      if(e.key==='Tab'){const it=[...ov.querySelectorAll('button:not([disabled]):not([hidden]),textarea,[tabindex="0"]')].filter(x=>x.offsetParent!==null);if(!it.length)return;const i=it.indexOf(doc.activeElement);
        if(e.shiftKey&&i<=0){e.preventDefault();it[it.length-1].focus();}else if(!e.shiftKey&&i===it.length-1){e.preventDefault();it[0].focus();}}
    });
    ov.addEventListener('mousedown',e=>{if(e.target===ov)e.preventDefault();}); /* a click beside the editor does not close it (unsaved work) */
    doc.addEventListener('focusin',onFocusIn,true);
    (st.mode==='preview'?$('pePrev'):src).focus();
    if(st.mode!=='preview'){src.setSelectionRange(0,0);src.scrollTop=0;}
  }

  /** New profile (FR-013): agent app, place, name; main creates the file and the editor opens it. */
  async function newProfile(opts){
    if(!X||!X.bridge.createProfileFile)return;
    const l=await X.bridge.listProfileFiles().catch(()=>null);
    const folders=(l&&l.folders)||[];
    const opener=(opts&&opts.returnFocus)||doc.activeElement;
    const ov=doc.createElement('div');ov.id='peNewOv';ov.className='dlg-ov';
    ov.innerHTML=`<div class="dlg m pe-new" role="dialog" aria-modal="true" aria-labelledby="peNT"><h3 id="peNT">New Agent Success Profile</h3>
      <p class="dsub">A Markdown file with a short front matter that the agent app loads as a custom agent.</p>
      <fieldset class="pe-tpl" id="peNTpl"><legend>Template</legend></fieldset>
      <label>Agent app<select id="peNApp"><option value="copilot">GitHub Copilot</option><option value="claude">Claude Code</option></select></label>
      <label>Where<select id="peNPlace"></select></label>
      <label>Name<input type="text" id="peNName" maxlength="64" autocomplete="off" spellcheck="false" placeholder="reviewer"></label>
      <p class="dsub small" id="peNHint"></p><p class="derr" id="peNErr" role="alert" hidden></p>
      <div class="dbtn"><button class="btn" type="button" id="peNCancel" data-cancel="1">Cancel</button>${X.bridge.generateProfile?'<button class="btn" type="button" id="peNAi" title="Describe the agent or answer a few questions; an agent app writes the profile and you review it before saving">Create with AI…</button>':''}<button class="btn primary" type="button" id="peNGo">Create</button></div></div>`;
    /* FR-018: the templates from src/shared/profiletemplates.ts (read at call time); the Agent Success Profile is preselected */
    const TPL=(win.exports&&win.exports.PROFILE_TEMPLATES)||[{id:'success',label:'Agent Success Profile',note:''},{id:'standard',label:'Standard agent',note:''}];
    const DEF=(win.exports&&win.exports.DEFAULT_TEMPLATE)||'success';
    TPL.forEach(t=>{const l=doc.createElement('label');l.className='pe-tpl-opt';const r=doc.createElement('input');r.type='radio';r.name='peNTpl';r.value=t.id;r.checked=t.id===DEF;const b=doc.createElement('span');b.className='pe-tpl-t';setText(b,t.label+(t.id===DEF?' (default)':''));l.append(r,b);if(t.note){const n=doc.createElement('small');setText(n,t.note);l.appendChild(n);}ov.querySelector('#peNTpl').appendChild(l);});
    const sel=ov.querySelector('#peNPlace');
    folders.forEach(f=>{if(!f||typeof f.id!=='string')return;const o=doc.createElement('option');o.value=f.id;o.textContent='This folder: '+baseName(f.path);o.title=f.path;sel.appendChild(o);}); /* main sends an id per folder and accepts only one still in the office */
    const u=doc.createElement('option');u.value='user';u.textContent='Your user folder (all folders)';sel.appendChild(u);
    if(opts&&opts.app&&APP_LABEL[opts.app])ov.querySelector('#peNApp').value=opts.app;
    doc.body.appendChild(ov);
    const hint=()=>{const app=$('peNApp').value,pl=$('peNPlace').value,n=$('peNName').value.trim()||'<name>';setText($('peNHint'),'File: '+joinHint(newDirHint(app,pl==='user'?'user':'folder',l&&l.userDirs),newFileName(app,n))+(pl==='user'?'':' in '+baseName((folders.find(f=>f&&f.id===pl)||{}).path||'')));};
    hint();ov.addEventListener('input',hint);ov.addEventListener('change',hint);
    return new Promise(resolve=>{
      const done=v=>{ov.remove();if(opener&&opener.focus&&doc.contains(opener)&&!v)opener.focus();resolve(v);};
      const go=async()=>{
        const name=$('peNName').value.trim(),er=$('peNErr');
        if(!validName(name)){er.hidden=false;setText(er,NAME_RE.test(name)&&RESERVED_RE.test(name)?'That name is reserved on Windows (CON, PRN, AUX, NUL, COM1-9, LPT1-9): choose another.':'Use letters, digits, dots, dashes or underscores (up to 64), starting with a letter or digit.');$('peNName').focus();return;}
        const pl=$('peNPlace').value;
        const tp=(ov.querySelector('input[name="peNTpl"]:checked')||{}).value||DEF;
        /* FR-042: Create writes nothing; the template opens as a draft and the first Save creates the file (main checks again) */
        const app=$('peNApp').value,fn=newFileName(app,name),folder=pl==='user'?undefined:(folders.find(f=>f&&f.id===pl)||{}).path;
        const taken=((l&&l.files)||[]).some(f=>f&&f.app===app&&f.fileName===fn&&(pl==='user'?f.scope==='user':f.scope==='folder'&&f.folder===folder));
        if(taken){er.hidden=false;setText(er,fn+' exists already. Choose another name, or open it from the list.');$('peNName').focus();return;}
        const tpl=win.exports&&win.exports.profileTemplate;
        if(typeof tpl!=='function'){er.hidden=false;setText(er,'The templates are not loaded.');return;}
        done('draft');openDraft({app,place:pl,name,folder,template:tp,text:tpl(app,name,tp)},{pristine:true,returnFocus:opener,note:'Not saved yet: Save creates '+fn+'.'});
      };
      ov.querySelector('#peNGo').onclick=go;
      /* spec 043 FR-026: Create with AI, only for the Agent Success Profile template */
      const aiB=ov.querySelector('#peNAi');
      if(aiB){const tplNow=()=>(ov.querySelector('input[name="peNTpl"]:checked')||{}).value||DEF;const sync=()=>{aiB.hidden=tplNow()!=='success';};sync();ov.addEventListener('change',sync);
        aiB.onclick=async()=>{const name=$('peNName').value.trim(),er=$('peNErr');
          if(!NAME_RE.test(name)){er.hidden=false;setText(er,'Choose a name first: letters, digits, dots, dashes or underscores (up to 64), starting with a letter or digit.');$('peNName').focus();return;}
          const pl=$('peNPlace').value; /* 'user' or a folder id from main's list (FR-020) */
          const r=await aiCreate({app:$('peNApp').value,place:pl,name,folder:pl==='user'?undefined:(folders.find(f=>f&&f.id===pl)||{}).path});
          if(r==='done'){ov.remove();resolve('ai');}else if($('peNName'))$('peNName').focus();};}ov.querySelector('#peNCancel').onclick=()=>done(null);
      ov.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();done(null);}else if(e.key==='Enter'&&e.target.id==='peNName'){e.preventDefault();go();}
        else if(e.key==='Tab'){const it=[...ov.querySelectorAll('select,input:not([type=radio]),input[type=radio]:checked,button')];const i=it.indexOf(doc.activeElement);if(e.shiftKey&&i<=0){e.preventDefault();it[it.length-1].focus();}else if(!e.shiftKey&&i===it.length-1){e.preventDefault();it[0].focus();}}});
      ov.addEventListener('click',e=>{if(e.target===ov)done(null);});
      $('peNName').focus();
    });
  }

  /**
   * Spec 043 FR-026..FR-030: Create with AI. Describe it, or a questionnaire (each question optional); the cost line and the button
   * name the app and the one request; the reply is checked in main and opens as an unsaved draft in Split view. Answers are kept on
   * an error. Resolves 'done' when a draft opened, else null.
   */
  async function aiCreate(t){
    let kinds=[];
    if(X.bridge.listAdapters){try{kinds=((await X.bridge.listAdapters())||[]).filter(k=>k&&k.state==='ready'&&k.capabilities&&k.capabilities.oneShot);}catch(e){kinds=[];}}
    kinds.sort((a,b)=>(b.id===t.app)-(a.id===t.app)); /* FR-028: the target app first */
    const RO=((win.exports&&win.exports.DEFAULT_READ_TOOLS)||{})[t.app]||[];
    const QS=(win.exports&&win.exports.PROFILE_QUESTIONS)||[];
    const costLine=k=>win.DurbarScreens&&win.DurbarScreens.oneShotCostLine?win.DurbarScreens.oneShotCostLine(k):'Uses your own '+(k.displayName||k.id)+' account.';
    const ov=doc.createElement('div');ov.id='peAiOv';ov.className='dlg-ov';
    ov.innerHTML=`<div class="dlg pe-ai" role="dialog" aria-modal="true" aria-labelledby="peAT"><h3 id="peAT"></h3>
      <p class="dsub">Describe the agent, or answer a few questions. An agent app writes the Agent Success Profile in one request, with no tools and nothing kept; you read it in the editor before anything is saved.</p>
      ${kinds.length?`<div class="seg pe-ai-how" role="group" aria-label="How"><button type="button" data-am="describe" aria-pressed="true">Describe it</button><button type="button" data-am="questions" aria-pressed="false">Questionnaire</button></div>
      <div id="peADesc"><label>What does this agent do?<textarea id="peADescT" rows="5" maxlength="2000" placeholder="A careful reviewer for the payments service. It reports to me, reads code with Read, Grep and Glob, never edits files, and flags security and rounding risks in short notes."></textarea></label></div>
      <div id="peAQ" class="pe-ai-qs" hidden></div>
      <div class="pe-ai-row"><div><label>Extra tools (optional)<input type="text" id="peATools" maxlength="2000" autocomplete="off" spellcheck="false"></label>
      <p class="scr-note small" id="peAToolsNote"></p></div>
      <div><label>Written by<select id="peABy"></select></label>
      <p class="scr-note small" id="peACost"></p></div></div>`:'<p class="dsub">This needs Claude Code, OpenAI Codex or GitHub Copilot, installed and signed in on this computer.</p>'}
      <p class="derr" id="peAErr" role="alert" hidden></p><p class="pe-ai-wait" id="peAWait" role="status" hidden>Writing the profile… this can take up to a minute.</p>
      <div class="dbtn"><button class="btn" type="button" id="peACancel" data-cancel="1">${kinds.length?'Cancel':'Close'}</button><button class="btn" type="button" id="peAStop" hidden>Stop waiting</button><span class="scr-note small" id="peALate" hidden>Create is available again when the first request ends.</span>${kinds.length?'<button class="btn primary" type="button" id="peAGo">Create with AI</button>':''}</div></div>`;
    setText(ov.querySelector('#peAT'),'Create '+t.name+' with AI');
    /* FR-031: tools come only from this line, never from the text above */
    const toolsIn=ov.querySelector('#peATools');
    if(toolsIn){toolsIn.placeholder=t.app==='copilot'?'edit, shell':'Bash(git:*), Edit';setText(ov.querySelector('#peAToolsNote'),'The agent gets only the read-only tools ('+RO.join(', ')+') and the ones you list here, separated by commas. Tools named in your text are not granted.');}
    const q=ov.querySelector('#peAQ');
    if(q)QS.forEach(x=>{const l=doc.createElement('label');const sp=doc.createElement('span');setText(sp,x.question);const ta=doc.createElement('textarea');ta.rows=2;ta.maxLength=600;ta.dataset.q=x.id;ta.placeholder=x.hint;l.append(sp,ta);q.appendChild(l);});
    const by=ov.querySelector('#peABy');
    if(by){kinds.forEach(k=>{const o=doc.createElement('option');o.value=k.id;setText(o,k.displayName||k.id);by.appendChild(o);});by.value=kinds.some(k=>k.id===t.app)?t.app:kinds[0].id;}
    doc.body.appendChild(ov);
    let mode='describe',waiting=null; /* aiRun.n: requests not ended yet, also after Stop waiting or a closed dialog (FR-036, FR-039) */
    const paintCost=()=>{if(!by)return;const k=kinds.find(x=>x.id===by.value)||kinds[0];setText(ov.querySelector('#peACost'),'1 prompt. '+costLine(k)+' No tools, nothing kept.');setText(ov.querySelector('#peAGo'),'Create with AI (1 prompt, '+(k.displayName||k.id)+')');};
    paintCost();if(by)by.addEventListener('change',paintCost);
    const setHow=m=>{mode=m;ov.querySelectorAll('[data-am]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.am===m)));ov.querySelector('#peADesc').hidden=m!=='describe';ov.querySelector('#peAQ').hidden=m!=='questions';const f=ov.querySelector(m==='describe'?'#peADescT':'#peAQ textarea');if(f)f.focus();};
    ov.addEventListener('click',e=>{const b=e.target.closest('[data-am]');if(b&&!waiting)setHow(b.dataset.am);});
    const busy=on=>{ov.querySelectorAll('textarea,select,input,[data-am]').forEach(x=>{x.disabled=on;});const g=ov.querySelector('#peAGo');if(g){g.hidden=on;g.disabled=aiRun.n>0;}ov.querySelector('#peALate').hidden=on||!aiRun.n;ov.querySelector('#peAStop').hidden=!on;ov.querySelector('#peAWait').hidden=!on;};
    const err=m=>{const e=ov.querySelector('#peAErr');e.hidden=!m;setText(e,m||'');};
    return new Promise(resolve=>{
      const onEnd=()=>{if(ov.isConnected&&!waiting)busy(false);};aiRun.ends.add(onEnd);
      const done=v=>{aiRun.ends.delete(onEnd);ov.remove();resolve(v);};
      const stop=()=>{waiting=null;busy(false);err('Stopped waiting. The request may still finish on the agent app and be charged.');};
      /* FR-039: Cancel or Escape while waiting first stops waiting (the note says it may be charged); pressed again, it closes */
      const cancel=()=>{if(waiting){stop();return;}done(null);};
      ov.querySelector('#peACancel').onclick=cancel;
      ov.querySelector('#peAStop').onclick=stop;
      if(aiRun.n){busy(false);err('A request you started earlier is still running on the agent app and may be charged.');}
      const go=ov.querySelector('#peAGo');
      if(go)go.onclick=async()=>{
        if(aiRun.n)return;
        const req={app:t.app,name:t.name,by:by.value,mode,tools:toolsIn?toolsIn.value.trim():''};
        if(mode==='describe'){req.description=ov.querySelector('#peADescT').value.trim();if(req.description.length<10){err('Describe what the agent does in a sentence or two.');return;}}
        else{req.answers={};ov.querySelectorAll('#peAQ textarea').forEach(x=>{if(x.value.trim())req.answers[x.dataset.q]=x.value.trim();});if(!Object.keys(req.answers).length){err('Answer at least one question.');return;}}
        err('');aiRun.n++;busy(true);const token={};waiting=token;
        const r=await X.bridge.generateProfile(req).catch(e=>({ok:false,error:String(e&&e.message||e)}));
        aiRun.n--;
        aiRun.ends.forEach(fn=>{try{fn();}catch(e){/* a closed dialog */}}); /* Create comes back in whichever dialog is open now */
        if(waiting!==token)return; /* Stop waiting, Cancel or Escape: the answer is dropped */
        waiting=null;busy(false);
        const spent=r&&r.costUsd?' Cost: about $'+r.costUsd.toFixed(4)+' (estimate).':r&&r.nanoAiu?' Used '+(r.nanoAiu/1e9).toFixed(2)+' AI credits (as reported by Copilot).':'';
        if(!r||!r.ok){err(((r&&r.error)||'Unknown error.')+spent+' Your answers are kept: change them and try again.');return;}
        done('done');
        openDraft({app:t.app,place:t.place,name:t.name,folder:t.folder,text:r.text},{mode:'split',note:'Written by '+r.by+'.'+spent+(r.warnings&&r.warnings.length?' Note: '+r.warnings.join('; ')+'.':'')+' Read it, change what you like, then Save.'});
      };
      ov.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();cancel();}
        else if(e.key==='Tab'){const it=[...ov.querySelectorAll('button:not([hidden]):not([disabled]),textarea:not([disabled]),select:not([disabled])')].filter(x=>x.offsetParent!==null);const i=it.indexOf(doc.activeElement);if(!it.length)return;if(e.shiftKey&&i<=0){e.preventDefault();it[it.length-1].focus();}else if(!e.shiftKey&&i===it.length-1){e.preventDefault();it[0].focus();}}});
      const f=ov.querySelector('#peADescT')||ov.querySelector('#peACancel');f.focus();
    });
  }

  /**
   * Spec 043 FR-040: delete a profile file after an askDialog confirmation (Cancel focused, Delete in red). Main resolves the id again
   * and deletes only a writable plain file. The editor open on it closes; the change listeners repaint the lists (FR-041).
   * Resolves true when the file was deleted.
   */
  async function remove(id,opts){
    if(!X||!X.bridge.deleteProfileFile||!X.bridge.listProfileFiles)return false;
    const l=await X.bridge.listProfileFiles().catch(()=>null);
    const f=l&&(l.files||[]).find(x=>x.id===id);
    if(!f){X.toast('That profile file is not in the list any more.',5000);return false;}
    if(!f.writable){X.toast(X.esc(f.note||'You cannot delete this file.'),5000);return false;}
    const back=(opts&&opts.returnFocus)||null;
    const v=await X.askDialog({title:'Delete the profile '+f.name+'?',body:'The file is deleted from disk. A running session that uses this profile goes back to its default agent (Claude Code keeps it until the session ends).',lines:['File: '+f.path],returnFocus:back?()=>back:undefined,
      buttons:[{label:'Cancel',value:null},{label:'Delete',value:'delete',cls:'primary danger'}]});
    if(!v)return false;
    const r=await X.bridge.deleteProfileFile(id).catch(e=>({ok:false,error:String(e&&e.message||e)}));
    if(!r||!r.ok){X.toast('Not deleted: '+X.esc((r&&r.error)||'unknown error'),5000);return false;}
    if(st&&st.id===id)await close(true);
    X.toast('Deleted '+X.esc(f.fileName)+'.',4000);
    changed({deleted:id,app:f.app});
    return true;
  }
  /** FR-040: Delete from the Profile menu, which knows a profile by its file path; main's list gives the id. */
  async function removeByPath(p,opts){
    const f=await fileByPath(p);
    if(!f){X.toast('This profile\'s file is not in the list of profile files (Settings > Profiles).',5000);return false;}
    return remove(f.id,opts);
  }
  /* the agent app may spell the path differently (separators; drive letter case on Windows, case on macOS) */
  const platform=()=>(win.agentDurbar&&win.agentDurbar.platform)||'';
  async function fileByPath(p){
    if(!X||!X.bridge.listProfileFiles)return null;
    const l=await X.bridge.listProfileFiles().catch(()=>null);
    return (l&&(l.files.find(x=>x.path===p)||l.files.find(x=>samePath(x.path,p,platform()))))||null;
  }

  /** The Profile menu's Edit button: the session's profile carries its file path; main's list gives the id for it. */
  async function openByPath(p,opts){
    if(!X||!X.bridge.listProfileFiles)return;
    const f=await fileByPath(p);
    if(!f){X.toast('This profile\'s file is not in the list of profile files (Settings > Profiles).',5000);return;}
    if(f.tooBig){X.toast(X.esc(f.note||'The file is too large to open here.'),5000);return;}
    return open(f.id,opts);
  }

  return Object.assign({},pure,{init,open,openDraft,openByPath,newProfile,remove,removeByPath,close,isOpen,onChange,dirty:()=>dirty(),mode:()=>st&&st.mode});
});
