/*
 * Spec 102 T231 / issue #1625 (Mac line): what a screen reader is given by the Retro arcade, read from Chromium's accessibility tree (the tree VoiceOver reads through
 * NSAccessibility), in Tab order. Simulator only, 0 AI credits. NOT a VoiceOver run: it shows names, roles, states and order, not the spoken words, the VO cursor's
 * reading order, rotor lists or what a live region really announces. Env: AXW_OUT (a folder for the JSON).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { app } = require('electron');
const { helpers, waits, jsLiteral } = require('./driver-helpers.js');
const OUT = process.env.AXW_OUT || fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-axw-'));

module.exports = async (ctx) => {
  const H = helpers(ctx); const { js } = H; const { until } = waits(ctx);
  const wc = ctx.win.webContents;
  app.setAccessibilitySupportEnabled(true);
  await H.load({ w: 1440, h: 900, query: { sim: '15', officeview: 'real', simfreeze: '1' }, ready: `!!document.querySelector('#stage .ro[data-world="retro"] .ro-plate')`, readyMs: 30000, settle: true });
  wc.debugger.attach('1.3');
  const send = (m, p) => wc.debugger.sendCommand(m, p || {});
  await send('Accessibility.enable'); await send('DOM.enable'); await send('Runtime.enable');
  const setStates = (list) => js(`(()=>{const U=window.__durbarSimUi,S=${jsLiteral(list)};U.agents().filter(a=>!a.parent).forEach((a,i)=>{a.state=S[i%S.length];delete a.label;});U.render();})();0`);
  await setStates(['working', 'thinking', 'waiting', 'limit', 'error', 'done', 'idle', 'asleep']); await ctx.sleep(800);
  /* a draft on the second desk's agent: type into its chat, then open another agent's chat (keepDraft) and go back to the office */
  const ids = await js(`window.__durbarSimUi.realLayout().zones.flatMap(z=>z.desks).filter(d=>d.person).map(d=>d.id).slice(0,2)`);
  const clickPlate = (id) => js(`(()=>{const p=document.querySelector('#stage .ro-plate[data-id="'+CSS.escape(${jsLiteral(id)})+'"]');if(!p)return 'noplate';p.click();return 'ok'})()`);
  const r1 = await clickPlate(ids[0]); await until(`document.body.classList.contains('panel-open')&&document.getElementById('msgInput')`, 8000);
  await js(`(()=>{const m=document.getElementById('msgInput');m.value='a note not sent yet';m.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  const r2 = await clickPlate(ids[1]); await ctx.sleep(600);
  await js(`(()=>{const b=document.getElementById('backBtn')||document.querySelector('[data-act=back]');if(b)b.click();else document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));})()`);
  await until(`!document.body.classList.contains('panel-open')`, 5000); await ctx.sleep(600);
  const out = { clicks: [r1, r2], draftTags: await js(`[...document.querySelectorAll('#stage .ro-draft, #stage [class*=draft]')].map(e=>({cls:String(e.className),text:e.textContent,ariaHidden:e.getAttribute('aria-hidden')}))`) };

  const axByBackend = async () => {
    const t = await send('Accessibility.getFullAXTree'); const m = new Map();
    for (const n of t.nodes) if (n.backendDOMNodeId) m.set(n.backendDOMNodeId, n);
    return { m, nodes: t.nodes };
  };
  const val = (x) => (x && x.value !== undefined ? x.value : undefined);
  const describeFocus = async () => {
    const r = await send('Runtime.evaluate', { expression: 'document.activeElement' });
    if (!r.result || !r.result.objectId) return null;
    const d = await send('DOM.describeNode', { objectId: r.result.objectId });
    const ax = await axByBackend(); const n = ax.m.get(d.node.backendNodeId);
    const info = await js(`(()=>{const e=document.activeElement;if(!e)return null;const r=e.getBoundingClientRect();return {tag:e.tagName.toLowerCase(),cls:String(e.className).slice(0,60),id:e.id||'',rect:[Math.round(r.left),Math.round(r.top),Math.round(r.width),Math.round(r.height)],tabindex:e.getAttribute('tabindex'),ariaLabel:e.getAttribute('aria-label')}})()`);
    return { ...info, role: n ? val(n.role) : '(no ax node)', name: n ? val(n.name) : '', description: n ? val(n.description) : '', props: n ? (n.properties || []).filter((p) => ['focusable', 'checked', 'expanded', 'pressed', 'selected', 'disabled', 'live', 'haspopup'].includes(p.name)).map((p) => p.name + '=' + JSON.stringify(p.value.value)) : [] };
  };
  const tab = async (shift) => { wc.sendInputEvent({ type: 'keyDown', keyCode: 'Tab', modifiers: shift ? ['shift'] : [] }); wc.sendInputEvent({ type: 'keyUp', keyCode: 'Tab', modifiers: shift ? ['shift'] : [] }); await ctx.sleep(120); };
  /* the office: from the start of the page, Tab through every stop up to the end of the office plates */
  wc.focus(); await js(`(()=>{document.activeElement&&document.activeElement.blur();window.scrollTo(0,0);})()`); await ctx.sleep(200);
  const walk = []; let firstKey = null;
  for (let i = 0; i < 90; i++) {
    await tab(false); const f = await describeFocus(); if (!f) break;
    const key = f.cls + '|' + f.name + '|' + f.rect.join(','); if (i > 3 && key === firstKey) { walk.push({ wrapped: true }); break; } if (i === 0) firstKey = key; walk.push(f);
  }
  out.tabWalk = walk;
  /* every plate, sign and marquee as the tree has it: role, name, hidden or not, in DOM order */
  const ax = await axByBackend();
  const stageNodes = [];
  const q = await send('Runtime.evaluate', { expression: `(()=>[...document.querySelectorAll('#stage .ro-plate, #stage .ro-sign, #stage .ro-marquee, #stage .ro-draft, #stage .ro-cue, #stage .ro-help, #stage .ro-fx, #stage .ro-chip')])()` });
  const props = await send('Runtime.getProperties', { objectId: q.result.objectId, ownProperties: true });
  for (const p of props.result.filter((x) => /^\d+$/.test(x.name)).slice(0, 400)) {
    const d = await send('DOM.describeNode', { objectId: p.value.objectId });
    const n = ax.m.get(d.node.backendNodeId);
    const attrs = d.node.attributes || []; const cls = attrs[attrs.indexOf('class') + 1] || '';
    stageNodes.push({ cls: cls.split(' ').slice(0, 3).join(' '), role: n ? val(n.role) : '-', name: n ? String(val(n.name) || '').slice(0, 140) : '', ignored: n ? !!n.ignored : true });
  }
  out.stageNodes = stageNodes;
  /* live regions anywhere in the page and whether the arcade announces a status change */
  out.liveRegions = await js(`[...document.querySelectorAll('[aria-live],[role=status],[role=alert],[role=log]')].map(e=>({tag:e.tagName.toLowerCase(),id:e.id,role:e.getAttribute('role'),live:e.getAttribute('aria-live'),inStage:!!e.closest('#stage'),text:e.textContent.slice(0,80)}))`);
  await js(`(()=>{window.__lv=[];const mo=new MutationObserver(ms=>{for(const m of ms){const e=(m.target.nodeType===1?m.target:m.target.parentElement);const r=e&&e.closest('[aria-live],[role=status],[role=alert]');if(r)window.__lv.push((r.id||r.className||r.tagName)+': '+r.textContent.slice(0,80));}});mo.observe(document.body,{subtree:true,childList:true,characterData:true});window.__lvmo=mo;})()`);
  const who = ids[0] === undefined ? '' : ids[1];
  for (const st of ['error', 'working', 'waiting']) { await js(`window.__durbarSimEmit({type:'status',sessionId:${jsLiteral(who)},timestamp:Date.now(),status:${jsLiteral(st)}});0`); await ctx.sleep(900); }
  out.srAnnounceNow = await js(`document.getElementById('srAnnounce').textContent`);
  out.announcedOnStatusChange = await js(`window.__lv`);
  out.plateAfterChange = await js(`(()=>{const p=document.querySelector('#stage .ro-plate[data-id="'+CSS.escape(${jsLiteral(who)})+'"]');return p?{label:p.getAttribute('aria-label'),text:p.textContent.slice(0,120)}:null})()`);

  /* Settings > World: the cards, in Tab order inside the group */
  await js(`document.getElementById('settingsBtn').click()`); await until(`document.querySelector('#wrGroup')`, 8000);
  out.worldGroup = await js(`(()=>{const g=document.getElementById('wrGroup');if(!g)return null;return {role:g.getAttribute('role'),label:g.getAttribute('aria-label'),cards:[...g.querySelectorAll('[data-world]')].map(c=>({world:c.dataset.world,role:c.getAttribute('role'),checked:c.getAttribute('aria-checked'),tabindex:c.getAttribute('tabindex'),label:c.getAttribute('aria-label'),disabled:c.getAttribute('aria-disabled')||c.disabled,text:c.textContent.trim().slice(0,100)}))}})()`);
  await js(`(()=>{const c=document.querySelector('#wrGroup [data-world][tabindex="0"]')||document.querySelector('#wrGroup [data-world]');c.focus();})()`);
  const wf = [await describeFocus()];
  for (let i = 0; i < 5; i++) { wc.sendInputEvent({ type: 'keyDown', keyCode: 'Right' }); wc.sendInputEvent({ type: 'keyUp', keyCode: 'Right' }); await ctx.sleep(300); wf.push(await describeFocus()); }
  out.worldArrowWalk = wf;
  { const r = await send('Runtime.evaluate', { expression: "document.getElementById('wrGroup')" }); const dn = await send('DOM.describeNode', { objectId: r.result.objectId }); const a2 = await axByBackend(); const n = a2.m.get(dn.node.backendNodeId); out.worldGroupAx = n ? { role: val(n.role), name: val(n.name), description: val(n.description) } : null; out.worldHeading = await js(`(()=>{const g=document.getElementById('wrGroup');const h=g.previousElementSibling;return {labelledby:g.getAttribute('aria-labelledby'),prev:h?h.tagName+': '+h.textContent.slice(0,60):null}})()`); }
  fs.writeFileSync(path.join(OUT, 'ax-retro.json'), JSON.stringify(out, null, 1));
  console.log('[axw] done');
};
