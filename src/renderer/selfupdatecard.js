/* Spec 118 T014 (FR-002, FR-006, FR-011, FR-016, FR-462..FR-464): Durbar's own update check in the window. Main decides everything (when to
   check, which repository, which version, what the release page is); this file shows main's view: the Updates block of Settings > About,
   the line in the top bar's More menu (⋯), the toast (main says when: once per version) and the Update dialog. Every text is set with
   textContent and DOM calls only (no HTML string is ever parsed here), so nothing from a release feed becomes markup (SC-004). Nothing is downloaded here.
   Plain script: in the page window.DurbarSelfUpdate; in Node the pure helpers through module.exports. */
(function(root, api){
  if(typeof module==='object'&&module.exports) module.exports=api; else root.DurbarSelfUpdate=api;
})(typeof self!=='undefined'?self:this, (function(){
  'use strict';
  /* FR-025: the window gets closed codes only; these are their words */
  const REASON={
    network:'no network, or the proxy refused it',
    timeout:'GitHub did not answer within 10 seconds',
    status:'GitHub answered with an error (it may be busy; Durbar tries again tomorrow)',
    redirect:'the update source moved (a renamed repository is not followed)',
    'content-type':'the answer could not be read',
    'too-large':'the answer was too large',
    'feed-invalid':'the answer could not be read',
    'not-allowed':'that address is not allowed'
  };
  const BY={'built-in':'built in',you:'changed by you',organization:'set by your organization'};
  /* FR-006, in plain words (also in docs/safety.md and the README) */
  const SENDS='A check is one request to api.github.com for the release list of the repository above, and, when there is an update, '+
    'one for that release\'s releases.json from raw.githubusercontent.com. It sends no version number of your copy of Durbar, and no account or machine identifier. '+
    'GitHub sees your IP address, the time and which repository you follow. Switched off, nothing is sent unless you press Check now.';
  const UNKNOWN_TEXT='This release does not say whether it changes how Durbar works; read its notes before you update.';
  const MAJOR_TEXT='This update may change how Durbar works (a new major version, or a new minor version before 1.0). Read the notes below before you update.';
  const NO_DOWNLOAD='Durbar does not download or install updates yet: open the release page and download the installer for your system there.';

  /* review of PR 2128, item 6: the snooze says its days, as the dialog's "Remind me in 7 days" does */
  function reminderText(until,now){
    if(!(typeof until==='number'&&until>now))return 'Reminder snoozed';
    const d=Math.ceil((until-now)/86400000);
    return 'Reminder in '+d+(d===1?' day':' days');
  }
  function reasonText(code){return REASON[code]||'the answer could not be read';}
  function ago(ms){
    if(!(typeof ms==='number'&&ms>=0))return 'just now';
    const m=Math.floor(ms/60000);
    if(m<1)return 'just now';
    if(m<60)return m+' min ago';
    const h=Math.floor(m/60);
    if(h<48)return h+' h ago';
    return Math.floor(h/24)+' days ago';
  }
  /* the state line of the Updates block (FR-011) */
  function stateText(v,now){
    if(!v)return '';
    if(v.checking)return 'Checking…';
    const at=typeof v.checkedAt==='number'?' · checked '+ago((now||Date.now())-v.checkedAt):'';
    if(v.state==='update'&&v.target){
      const tail=v.notice==='skipped'?' (skipped)':v.notice==='snoozed'?' · '+reminderText(v.snoozeUntil,now||Date.now()):'';
      return 'Update available: v'+v.target+tail+at;
    }
    if(v.state==='up-to-date')return 'Up to date · v'+v.running+at;
    if(v.state==='newer')return 'Up to date (this build is newer than the latest release) · v'+v.running+at;
    if(v.state==='failed')return 'Could not check: '+reasonText(v.reason)+at;
    return typeof v.checkedAt==='number'?'Last checked'+at.replace(' · checked',''):'Not checked yet';
  }
  /* FR-002: where updates come from, always said */
  function sourceText(v){
    if(!v||!v.source)return '';
    return 'Updates from '+v.source+' ('+(BY[v.sourceBy]||'built in')+')';
  }
  /* FR-016, FR-464: the More menu line only while an update exists that is neither snoozed nor skipped */
  function menuLine(v){
    return v&&v.shown&&v.state==='update'&&v.notice==='show'&&v.target?'Update available: v'+v.target:'';
  }
  function releasesWord(n){return n===1?'1 release comes with it.':n+' releases come with it.';}

  // ---- the page part (needs a document) ------------------------------------------------------------------------------------------------
  let B=null, ASK=null, onAnnounce=()=>{}, V=null, aboutEl=null, busy=false, doc=null;
  function el(tag,cls,text){const e=doc.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e;}
  function set(v){
    if(!v||typeof v!=='object')return;
    V=v;
    syncMenu();
    if(aboutEl&&aboutEl.isConnected)paintAbout();
  }
  function syncMenu(){
    const it=doc&&doc.getElementById('selfUpdItem');if(!it)return;
    const line=menuLine(V);
    it.hidden=!line;
    const w=doc.getElementById('selfUpdWord');if(w)w.textContent=line||'Update available';
  }
  function init(o){
    doc=(o&&o.doc)||(typeof document!=='undefined'?document:null);
    B=o&&o.bridge;ASK=o&&o.askDialog;if(o&&typeof o.onAnnounce==='function')onAnnounce=o.onAnnounce;
    if(!doc||!B||typeof B.selfUpdateGet!=='function')return false;
    const it=doc.getElementById('selfUpdItem');
    if(it)it.addEventListener('click',()=>{void openDialog(doc.getElementById('topMoreBtn'));});
    if(typeof B.onSelfUpdate==='function')B.onSelfUpdate(v=>{set(v);if(v&&typeof v.announce==='string'&&v.notice==='show')onAnnounce(v.announce);});
    B.selfUpdateGet().then(set,()=>undefined);
    return true;
  }
  /* Settings > About: the Updates block, painted into `box` (an empty element the settings screen made) */
  function fillAbout(box){
    if(!box||!B)return;
    aboutEl=box;
    paintAbout();
    B.selfUpdateGet().then(set,()=>undefined); /* a fresh view each time Settings opens (nothing is contacted) */
  }
  function paintAbout(){
    const box=aboutEl, v=V;
    box.textContent='';
    if(!v||(!v.shown&&!v.blocked)){box.hidden=true;return;}
    box.hidden=false;
    box.appendChild(el('h4','scr-sub','Updates')).id='suH';
    if(!v.shown){box.appendChild(el('p','scr-note','Turned off by your organization.')).id='suState';return;}
    const st=box.appendChild(el('p','scr-note su-state',stateText(v)));st.id='suState';st.setAttribute('role','status');
    const src=sourceText(v);
    if(src)box.appendChild(el('p','scr-note small',src)).id='suSource';
    if(v.origin==='local')box.appendChild(el('p','scr-note small','This build was made outside a release workflow; '+(v.source?'updates from '+v.source+'.':'it follows no release workflow.'))).id='suLocal';
    const row=box.appendChild(el('div','scr-tools'));
    const lab=row.appendChild(el('span','swrow su-swrow'));
    const lb=lab.appendChild(el('b','','Check for Durbar updates once a day'));lb.id='suSwL';
    const sw=lab.appendChild(el('button','swt'+(v.dailyCheck?' on':'')));
    sw.type='button';sw.id='suDaily';sw.setAttribute('role','switch');sw.setAttribute('aria-checked',v.dailyCheck?'true':'false');sw.setAttribute('aria-labelledby','suSwL');sw.appendChild(el('i'));
    sw.disabled=!v.canCheck;
    sw.onclick=async()=>{
      if(sw.disabled||typeof B.selfUpdateSetDaily!=='function')return;
      const want=sw.getAttribute('aria-checked')!=='true';
      sw.disabled=true;
      let r=null;try{r=await B.selfUpdateSetDaily(want);}catch(e){r=null;}
      if(r&&r.update)set(r.update);else sw.disabled=false;
      const msg=doc.getElementById('suMsg');
      if(msg)msg.textContent=r&&r.ok?'':'Could not save this setting; it applies until Durbar restarts.';
      const again=doc.getElementById('suDaily');if(again)again.focus({preventScroll:true});
    };
    const tools=box.appendChild(el('div','scr-tools'));
    if(v.canCheck){
      const c=tools.appendChild(el('button','btn',v.checking||busy?'Checking…':'Check now'));c.type='button';c.id='suCheck';c.disabled=!!(v.checking||busy);
      c.onclick=async()=>{
        if(busy||typeof B.selfUpdateCheck!=='function')return;
        busy=true;c.disabled=true;c.textContent='Checking…';
        let r=null;try{r=await B.selfUpdateCheck();}catch(e){r=null;}
        busy=false;
        if(r)set(r);else paintAbout();
        const again=doc.getElementById('suCheck');if(again)again.focus({preventScroll:true});
      };
    }
    if(v.state==='update'&&v.target){const s=tools.appendChild(el('button','btn','See what is new…'));s.type='button';s.id='suOpen';s.onclick=()=>{void openDialog(s);};}
    tools.appendChild(el('span','scr-note small','')).id='suMsg';
    box.appendChild(el('p','scr-note small su-sends',SENDS)).id='suSends';
  }
  /* the Update dialog (FR-011, FR-464): built with DOM calls; askDialog gives the focus trap, Escape and the focus return */
  async function openDialog(opener){
    if(!B||typeof B.selfUpdateNotes!=='function'||!ASK)return null;
    let n=null;try{n=await B.selfUpdateNotes();}catch(e){n=null;}
    if(!n||!n.target||!Array.isArray(n.releases))return null;
    const target=n.target;
    const node=el('div','su-dlg');
    const src=sourceText(n);
    if(src)node.appendChild(el('p','dsub su-src',src));
    if(n.gap){const oldest=n.releases.length?n.releases[n.releases.length-1].version:target;node.appendChild(el('p','dsub su-gap','Some releases between v'+n.running+' and v'+oldest+' are not listed. Read the release page before you update.'));}
    let tick=null;
    if(n.breaking==='breaking'||n.breaking==='unknown'){
      const card=node.appendChild(el('section','su-brk'));card.setAttribute('aria-labelledby','suBrkH');
      card.appendChild(el('h4','su-brk-h',n.breaking==='unknown'?'Breaking: unknown':'Breaking changes')).id='suBrkH';
      if(n.breaking==='unknown')card.appendChild(el('p','su-brk-t',UNKNOWN_TEXT));
      else if(!n.marks||!n.marks.length)card.appendChild(el('p','su-brk-t',MAJOR_TEXT));
      else n.marks.forEach(m=>{
        const p=card.appendChild(el('p','su-brk-t'));p.appendChild(el('b','','v'+m.version+': '));p.appendChild(doc.createTextNode(m.notes));
        if(m.action){const a=card.appendChild(el('p','su-brk-t'));a.appendChild(el('b','','What to do: '));a.appendChild(doc.createTextNode(m.action));}
      });
      const lab=card.appendChild(el('label','chk su-tick'));
      tick=lab.appendChild(el('input'));tick.type='checkbox';tick.id='suTick';
      lab.appendChild(el('span','','I have read the breaking changes'));
    }
    const list=node.appendChild(el('div','su-rels'));list.setAttribute('role','region');list.setAttribute('aria-label','Release notes');list.tabIndex=0;
    n.releases.forEach((r,i)=>{
      const d=list.appendChild(el('details','su-rel'));if(i===0)d.open=true;
      d.appendChild(el('summary','','v'+r.version+(r.date?' · '+r.date:'')));
      d.appendChild(el('div','su-notes',r.text||'No notes.'));
      if(r.clipped)d.appendChild(el('p','scr-note small','Shortened: the release page has the rest.'));
    });
    node.appendChild(el('p','scr-note small su-nodl',NO_DOWNLOAD));
    const custom={node,value:()=>(tick?tick.checked:true),valid:()=>(!tick||tick.checked)};
    if(tick)tick.addEventListener('change',()=>{if(custom.onChange)custom.onChange(tick.checked);});
    const res=await ASK({title:'Update available: v'+target,size:'l',body:'You are running v'+n.running+'. '+releasesWord(n.releases.length),custom,
      buttons:[{label:'Close',value:null},{label:'Skip this version',value:'skip'},{label:'Remind me in 7 days',value:'snooze'},{label:'Open the release page',value:'open',cls:'primary'}],
      returnFocus:opener||undefined});
    if(!res)return null;
    try{
      if(res.value==='open'&&(!tick||tick.checked)&&typeof B.selfUpdateOpenPage==='function')await B.selfUpdateOpenPage(target);
      else if(res.value==='snooze'&&typeof B.selfUpdateSnooze==='function'){const r=await B.selfUpdateSnooze(target);if(r&&r.update)set(r.update);}
      else if(res.value==='skip'&&typeof B.selfUpdateSkip==='function'){const r=await B.selfUpdateSkip(target);if(r&&r.update)set(r.update);}
    }catch(e){/* main refused (the feed changed meanwhile): the next view says what is true */}
    return res.value;
  }
  return {reminderText,reasonText,ago,stateText,sourceText,menuLine,releasesWord,SENDS,UNKNOWN_TEXT,init,fillAbout,openDialog,view:()=>V};
})());
