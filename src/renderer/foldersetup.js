/* Spec 061: "This folder brings its own agent setup". Plain script (window.DurbarFolderSetup). Lists a folder's own hooks, permission rules
   and MCP servers in full (masked by main, FR-014), grouped by agent app and kind, everything on by default (Q1) except that hooks need the
   explicit confirmation (FR-011); an AI explanation per hook on demand, advisory only (FR-015, FR-016). Main decides nothing on its own:
   only "Use these" / "Turn all off" here records an answer (FR-013). Uses the Settings dialog (DurbarScreens.dialog), not a second modal. */
(function(){
  'use strict';
  let X=null; /* {bridge, esc, toast, onRules(map)} */
  const seen=new Set(); /* folder keys checked in this run (FR-001: once per folder) */
  let queue=Promise.resolve();
  const APP={claude:'Claude Code',copilot:'Copilot',codex:'Codex',any:'Every agent app'};
  const KIND={hook:'Hooks',rule:'Permission rules',mcp:'MCP servers'};
  const NOTE={
    hook:'Hooks run commands on your computer when the agent does something, <b>without asking you, even in Read-only.</b>',
    rule:'<b>Allow</b> rules let the agent use these tools <b>without asking, even in Read-only.</b> <b>Deny</b> rules: the agent can never use these, even in Allow all. <b>Ask</b> rules: it asks first.',
    mcp:'MCP servers start with the session and give the agent their tools.',
  };
  const keyOf=info=>info.workspaceFile||info.cwd;

  function init(ctx){X=ctx;}

  /* FR-001 / FR-003: after a folder joins the office, and once per saved folder in this run: show the list only when something is new or changed */
  function check(info,{force}={}){
    if(!X||!X.bridge||!X.bridge.folderSetupScan||!info)return;
    const key=keyOf(info);
    if(!force&&seen.has(key))return;
    seen.add(key);
    queue=queue.then(async()=>{
      let v;try{v=await X.bridge.folderSetupScan(key);}catch(e){return;}
      if(!v||!v.ok)return;
      if(!force&&!v.pending.length)return;
      await open(v,info);
    }).catch(()=>undefined);
    return queue;
  }

  /* Q1: on by default; a declined item stays off. Review #424: off until ticked again when new or changed after an answer (FR-010),
     when part of it is hidden (FR-014), and for broad allow rules (S1, they also need the confirmation below).
     Pure, so test:foldersetup pins every case (re-review #424). */
  function defaultOn(it,v){
    const isNew=v.pending.includes(it.id), wasSeen=(v.accepted.length+v.declined.length)>0;
    const broadAllow=it.kind==='rule'&&it.ruleKind==='allow'&&!!it.broad;
    return !!it.supported&&!v.declined.includes(it.id)&&!(isNew&&wasSeen)&&!it.hidden&&!broadAllow;
  }

  /* re-review #424: a command box whose text does not fit says so (measured: depends on the window and the font) */
  function markLong(root){
    root.querySelectorAll('.fs-cmd').forEach(c=>{
      const next=c.nextElementSibling, has=next&&next.classList.contains('fs-more');
      if(c.scrollHeight>c.clientHeight+2){if(!has)c.insertAdjacentHTML('afterend','<span class="fs-more">Long: scroll inside the box to read all of it.</span>');}
      else if(has)next.remove();
    });
  }

  function itemHTML(it,v){
    const esc=X.esc, isNew=v.pending.includes(it.id), wasSeen=(v.accepted.length+v.declined.length)>0;
    const on=defaultOn(it,v);
    const tags=[it.ruleKind?`<span class="mtag fs-${it.ruleKind}">${it.ruleKind}</span>`:'',it.broad?'<span class="mtag warn" title="Needs the confirmation tick: it covers a whole tool, or runs shell commands">broad</span>':'',isNew&&wasSeen?'<span class="mtag new">new or changed</span>':'',it.event?`<span class="mtag">${esc(it.event)}${it.matcher?' · '+esc(it.matcher):''}</span>`:''].join('');
    const secrets=it.secretNames&&it.secretNames.length?`<span class="fs-sec">Value hidden (the name looks secret): ${it.secretNames.map(esc).join(', ')}.</span>`:'';
    const hidden=it.hidden?`<span class="fs-hidden">${it.hiddenWhy?esc(it.hiddenWhy):`Part of this ${it.kind==='rule'?'rule':'command'} is hidden because it looks like a secret key. Ticking it uses the hidden part too.`}</span>`:'';
    const why=!it.supported?`<span class="imp-block">${esc(it.unsupportedWhy||'Not supported.')}</span>`:'';
    const ai=it.kind==='hook'&&it.supported&&X.bridge.folderSetupExplain?`<button class="btn sm" type="button" data-explain="${esc(it.id)}">Explain with AI</button><div class="fs-ai" data-ai="${esc(it.id)}" aria-live="polite"></div>`:'';
    return `<li class="imp-row fs-row${it.supported?'':' dis'}"><label><input type="checkbox" data-fs="${esc(it.id)}" data-kind="${it.kind}"${on?' checked':''}${it.supported?'':' disabled'} aria-label="Use ${esc(it.label)}">
      <span class="imp-main"><span class="srv-top"><b class="srv-name">${esc(it.label)}</b>${tags}<span class="mtag src">${esc(it.file)}</span></span>
      <code class="srv-cmd fs-cmd" tabindex="0" aria-label="Full ${esc(it.label)}">${esc(it.detail)}</code>${hidden}${secrets}${why}</span></label>${ai}</li>`;
  }

  function bodyHTML(v,info){
    const esc=X.esc;
    const apps=['claude','copilot','codex','any'].filter(a=>v.items.some(i=>i.app===a));
    const groups=apps.map(app=>{
      const kinds=['hook','rule','mcp'].filter(k=>v.items.some(i=>i.app===app&&i.kind===k));
      return `<section class="fs-app"><h4>${esc(APP[app])}</h4>${kinds.map(k=>`<div class="fs-kind"><h5>${KIND[k]}</h5><p class="scr-note small">${NOTE[k]}</p><ul class="imp-list">${v.items.filter(i=>i.app===app&&i.kind===k).map(i=>itemHTML(i,v)).join('')}</ul></div>`).join('')}</section>`;
    }).join('');
    const hooks=v.items.some(i=>i.kind==='hook'&&i.supported);
    const broad=v.items.some(i=>i.kind==='rule'&&i.ruleKind==='allow'&&i.broad);
    const probs=v.problems.length?`<p class="scr-note small warn">Not read (never used): ${v.problems.map(p=>`<code>${esc(p.file)}</code> ${esc(p.message)}`).join('; ')}.</p>`:'';
    const folder=String(v.key||'').split(/[\\/]/).filter(Boolean).pop()||info.name||'This folder';
    return `<p class="dsub">The folder <b>${esc(folder)}</b> has its own agent setup in its files. It is on unless you turn it off; nothing of it runs before you answer here. Durbar's own mode still decides everything these items do not.</p>
      ${groups}${probs}
      ${hooks||broad?`<label class="chk fs-confirm"><input type="checkbox" id="fsHooksOk"> <span>${hooks&&broad?'I have read these hooks and broad allow rules, and I know what they run and allow.':hooks?'I have read these hooks and I know what they run.':'I have read these broad allow rules and I know what they allow.'}</span></label><p class="scr-note small">Without this tick the ${hooks&&broad?'hooks and broad allow rules':hooks?'hooks':'broad allow rules'} stay off; the rest is used.</p>`:''}
      <p class="scr-note small">Changes apply from the agent's next start in this folder. A file that changes later is shown again before it is used.</p>`;
  }

  async function open(v,info){
    const S=window.DurbarScreens;
    if(!S||!S.dialog||!v.items.length&&!v.problems.length){
      if(!v.items.length&&X.toast)X.toast('This folder brings no agent setup of its own (no hooks, rules or MCP servers).',3600);
      return;
    }
    /* the dialog is removed when it closes: read the ticks on the button click (validate runs before the close) */
    let picked={accepted:[],hooksConfirmed:false};
    const r=await S.dialog({title:'This folder brings its own agent setup',wide:true,cls:'imp fs',html:bodyHTML(v,info),
      buttons:[{label:'Turn all off',value:'off'},{label:'Use these',value:'use',cls:'primary'}],
      validate:d=>{picked={accepted:[...d.querySelectorAll('[data-fs]')].filter(c=>c.checked&&!c.disabled).map(c=>c.dataset.fs),hooksConfirmed:!!(d.querySelector('#fsHooksOk')||{}).checked};return '';},
      onOpen:d=>{
        requestAnimationFrame(()=>markLong(d));
        d.addEventListener('click',async e=>{
          const b=e.target.closest('[data-explain]');if(!b)return;
          const box=d.querySelector(`[data-ai="${b.dataset.explain}"]`);b.disabled=true;box.textContent='Asking an agent app…';
          let x;try{x=await X.bridge.folderSetupExplain(v.key,b.dataset.explain);}catch(err){x={ok:false,error:String(err&&err.message||err)};}
          b.disabled=false;
          if(!x||!x.ok){box.className='fs-ai err';box.textContent=(x&&x.error)||'No AI explanation.';return;}
          const word={harmless:'Looks harmless',care:'Needs care',risky:'Risky'}[x.verdict]||'';
          box.className='fs-ai v-'+x.verdict;
          box.innerHTML=`<b>${X.esc(word)}</b> <span class="fs-ai-src">AI explanation by ${X.esc(x.by||'an agent app')}; it can be wrong. The command above is what runs.${x.cost?' Cost: '+X.esc(x.cost)+'.':''}</span><div>${X.esc(x.text||'')}</div>`;
        });
      }});
    if(!r)return; /* dismissed: nothing recorded, so nothing applies (pending stays pending) */
    const off=(r&&r.value)==='off'; /* the dialog resolves {value, root} */
    const accepted=off?[]:picked.accepted;
    const declined=v.items.map(i=>i.id).filter(id=>!accepted.includes(id));
    const hooksConfirmed=!off&&picked.hooksConfirmed;
    const res=await X.bridge.folderSetupDecide(v.key,{accepted,declined,hooksConfirmed});
    if(res&&res.ok){
      if(X.onRules&&res.folderRules)X.onRules(res.folderRules);
      const hooksDropped=!off&&!hooksConfirmed&&v.items.some(i=>(i.kind==='hook'||(i.kind==='rule'&&i.ruleKind==='allow'&&i.broad))&&accepted.includes(i.id));
      if(X.toast)X.toast(off?'The folder’s own setup is off.':hooksDropped?'Used, except the hooks and broad allow rules (not confirmed).':'The folder’s setup will be used from the next start.',3600);
    }
  }
  window.DurbarFolderSetup={init,check,openFor:(info)=>check(info,{force:true}),defaultOn,markLong};
})();
