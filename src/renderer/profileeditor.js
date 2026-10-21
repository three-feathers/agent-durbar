/* Profile file editor (spec 043 FR-014..FR-016): a large dialog with Edit | Split | Preview, a monospace text area, a throttled
   preview through the chat's sanitised Markdown renderer (spec 016, window.DurbarMD; no second renderer), a front matter check
   (FR-015), Save with Ctrl/Cmd+S, an Unsaved mark, a guard before closing with unsaved changes and the external-change question
   (askDialog), and New profile (FR-013). Main owns the files: this file sends only ids from main's list, or app + place index + name.
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
  const newDirHint=(app,scope)=>scope==='user'?(app==='copilot'?'~/.copilot/agents':'~/.claude/agents'):(app==='copilot'?'.github/agents':'.claude/agents');

  const pure={parseFrontmatter,throttle,loadMode,saveMode,MODES,MODE_KEY,NAME_RE,newFileName,newDirHint,placeText,baseName};
  if(!win)return pure;

  /* ---------------- the editor (page only) ---------------- */
  const doc=win.document;
  let X=null; /* {bridge, askDialog, toast, esc} from app.js */
  let st=null; /* the open file: {id, info, sha, saved, writable, mode, opener} */
  const listeners=[];
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
  function paintDirty(){
    if(!st)return;const d=dirty();
    $('peDirty').hidden=!d;
    const sv=$('peSave');if(sv)sv.disabled=!st.writable||!d;
  }
  function setMode(m){
    if(!MODES.includes(m)||!st)return;
    st.mode=m;saveMode(store(),m);
    $('peMain').dataset.mode=m;
    doc.querySelectorAll('#peModes button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.pm===m)));
    if(m!=='edit')st.preview.flush(),renderPreview();
  }
  function status(t){const s=$('peStatus');if(s)setText(s,t);}

  async function close(force){
    if(!st)return true;
    if(!force&&dirty()){
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
  function onFocusIn(e){const ov=$('peOv');if(!ov||$('modeDlg')||$('peNewOv'))return;if(!ov.contains(e.target)){const t=$('peSrc');if(t)t.focus();}}

  async function save(overwrite){
    if(!st||!st.writable||st.saving)return;
    const text=$('peSrc').value;
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
    setText($('peSub'),(APP_LABEL[f.app]||f.app)+' · '+placeText(f)+' · '+f.fileName);
    $('peSub').title=f.path||'';
    const ro=$('peRo');ro.hidden=st.writable;setText(ro,st.writable?'':'Read-only: '+(f.note||'you cannot write this file.'));
    const sv=$('peSave');if(sv)sv.hidden=!st.writable;
  }

  /** Opens the editor on a file id from listProfileFiles (FR-014). */
  async function open(id,opts){
    if(!X||!X.bridge.readProfileFile)return;
    if(isOpen()&&!(await close()))return;
    const r=await X.bridge.readProfileFile(id).catch(e=>({ok:false,error:String(e&&e.message||e)}));
    if(!r||!r.ok){X.toast('Could not open the profile: '+X.esc((r&&r.error)||'unknown error'),5000);return;}
    const opener=(opts&&opts.returnFocus)||(doc.activeElement&&doc.activeElement!==doc.body?doc.activeElement:null);
    st={id,info:r.info,sha:r.sha256,saved:r.text,writable:!!r.info.writable,mode:loadMode(store()),opener,fmErrors:0};
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
    const src=$('peSrc');src.value=r.text;src.readOnly=!st.writable;
    paintHead();setMode(st.mode);paintDirty();renderPreview();
    src.addEventListener('input',()=>{paintDirty();st.preview();});
    $('peModes').addEventListener('click',e=>{const b=e.target.closest('button[data-pm]');if(b)setMode(b.dataset.pm);});
    $('peSave').onclick=()=>save(false);
    $('peClose').onclick=()=>close();
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
    ov.innerHTML=`<div class="dlg pe-new" role="dialog" aria-modal="true" aria-labelledby="peNT"><h3 id="peNT">New profile</h3>
      <p class="dsub">A profile is a Markdown file with a short front matter that the agent app loads as a custom agent.</p>
      <label>Agent app<select id="peNApp"><option value="copilot">GitHub Copilot</option><option value="claude">Claude Code</option></select></label>
      <label>Where<select id="peNPlace"></select></label>
      <label>Name<input type="text" id="peNName" maxlength="64" autocomplete="off" spellcheck="false" placeholder="reviewer"></label>
      <p class="dsub small" id="peNHint"></p><p class="derr" id="peNErr" role="alert" hidden></p>
      <div class="dbtn"><button class="btn" type="button" id="peNCancel" data-cancel="1">Cancel</button><button class="btn primary" type="button" id="peNGo">Create</button></div></div>`;
    const sel=ov.querySelector('#peNPlace');
    folders.forEach((f,i)=>{const o=doc.createElement('option');o.value=String(i);o.textContent='This folder: '+baseName(f);o.title=f;sel.appendChild(o);});
    const u=doc.createElement('option');u.value='user';u.textContent='Your user folder (all folders)';sel.appendChild(u);
    if(opts&&opts.app&&APP_LABEL[opts.app])ov.querySelector('#peNApp').value=opts.app;
    doc.body.appendChild(ov);
    const hint=()=>{const app=$('peNApp').value,pl=$('peNPlace').value,n=$('peNName').value.trim()||'<name>';setText($('peNHint'),'File: '+newDirHint(app,pl==='user'?'user':'folder')+'/'+newFileName(app,n)+(pl==='user'?'':' in '+baseName(folders[Number(pl)]||'')));};
    hint();ov.addEventListener('input',hint);ov.addEventListener('change',hint);
    return new Promise(resolve=>{
      const done=v=>{ov.remove();if(opener&&opener.focus&&doc.contains(opener)&&!v)opener.focus();resolve(v);};
      const go=async()=>{
        const name=$('peNName').value.trim(),er=$('peNErr');
        if(!NAME_RE.test(name)){er.hidden=false;setText(er,'Use letters, digits, dots, dashes or underscores (up to 64), starting with a letter or digit.');$('peNName').focus();return;}
        const pl=$('peNPlace').value;
        const r=await X.bridge.createProfileFile($('peNApp').value,pl==='user'?'user':Number(pl),name).catch(e=>({ok:false,error:String(e&&e.message||e)}));
        if(!r.ok){er.hidden=false;setText(er,r.error||'Could not create the file.');return;}
        done(r.id);changed(r.info);open(r.id,{returnFocus:opener});
      };
      ov.querySelector('#peNGo').onclick=go;ov.querySelector('#peNCancel').onclick=()=>done(null);
      ov.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();done(null);}else if(e.key==='Enter'&&e.target.id==='peNName'){e.preventDefault();go();}
        else if(e.key==='Tab'){const it=[...ov.querySelectorAll('select,input,button')];const i=it.indexOf(doc.activeElement);if(e.shiftKey&&i<=0){e.preventDefault();it[it.length-1].focus();}else if(!e.shiftKey&&i===it.length-1){e.preventDefault();it[0].focus();}}});
      ov.addEventListener('click',e=>{if(e.target===ov)done(null);});
      $('peNName').focus();
    });
  }

  /** The Profile menu's Edit button: the session's profile carries its file path; main's list gives the id for it. */
  async function openByPath(p,opts){
    if(!X||!X.bridge.listProfileFiles)return;
    const l=await X.bridge.listProfileFiles().catch(()=>null);
    const norm=s=>String(s||'').replace(/\\/g,'/').toLowerCase(); /* the agent app may spell the path differently (separators, drive letter case) */
    const f=l&&(l.files.find(x=>x.path===p)||l.files.find(x=>norm(x.path)===norm(p)));
    if(!f){X.toast('This profile\'s file is not in the list of profile files (Settings > Profiles).',5000);return;}
    if(f.tooBig){X.toast(X.esc(f.note||'The file is too large to open here.'),5000);return;}
    return open(f.id,opts);
  }

  return Object.assign({},pure,{init,open,openByPath,newProfile,close,isOpen,onChange,dirty:()=>dirty(),mode:()=>st&&st.mode});
});
