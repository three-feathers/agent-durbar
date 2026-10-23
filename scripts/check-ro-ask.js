/*
 * Spec 003 FR-094..FR-097 (2026-10-23, owner request, issue #618): a Read-only denial offers "Switch to Ask first…", which opens the
 * usual mode menu (openModeMenu, modes only) anchored to it; choosing Ask first switches through changeMode, says to ask the agent
 * again and never resends. Simulator only, no credits. Linux with xvfb-run:
 *
 *   npm run build
 *   OUT=docs/screenshots DURBAR_USER_DATA=$(mktemp -d) DURBAR_SIM=15 DURBAR_SIM_FREEZE=1 \
 *     DURBAR_DRIVER=$PWD/scripts/check-ro-ask.js xvfb-run -a npx electron . --no-sandbox
 *
 * Also in `npm run check:ui` (scripts/ui-suite.js). Mutation check: the old spec 052 FR-074 button (switch at once, no menu) fails it.
 */
const assert = require('assert');
const path = require('path');
const { helpers, jsLiteral } = require('./driver-helpers');
const OUT = process.env.OUT || '/tmp';

module.exports = async (ctx) => {
  const H = helpers(ctx); // spec 008 FR-097: shared plumbing
  const { js, until, key } = H;
  const BTN = '#chat [data-act="ro-ask"]';
  const menuItems = () => js(`[...document.querySelectorAll('#modeMenu [data-mode]')].map(b=>b.dataset.mode+(b.getAttribute('aria-checked')==='true'?'*':''))`);
  const active = () => js(`(()=>{const e=document.activeElement;return e?(e.id||e.dataset.act||e.dataset.mode||e.tagName):''})()`);
  const modeOf = (id) => js(`((window.__durbarSimUi.agents().find(a=>a.id===${jsLiteral(id)})||{}).info||{}).permMode`);
  const denyNow = (id, summary) => js(`window.__durbarSimUi.emit({type:'status',sessionId:${jsLiteral(id)},timestamp:Date.now(),status:'needs-permission',intent:'Denied (read-only mode): '+${jsLiteral(summary)},permission:{requestId:'ro-'+Date.now()+Math.random(),kind:'write',summary:${jsLiteral(summary)},state:'denied'}})`);

  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    const kb = w === 1280; // the 1280 run takes the keyboard path
    await H.load({ w, h, focus: true });
    const ro = await H.openSimAgent(`a=>!a.parent&&a.info&&a.info.permMode==='read-only'&&a.live&&(a.state==='idle'||a.state==='done')`, '#msgInput');
    assert.ok(ro.ok, `${w}: opened a Read-only agent's chat ${jsLiteral(ro.seen)}`);
    const id = ro.id;
    const name = await js(`(window.__durbarSimUi.agents().find(a=>a.id===${jsLiteral(id)})||{}).name`);
    // 1) the simulator's own denial: a Read-only agent asked to edit (settlePerm path)
    await js(`(()=>{const i=document.getElementById('msgInput');i.value='Please edit the file.';i.dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('sendBtn').click();})()`);
    assert.ok(await until(`!!document.querySelector(${jsLiteral(BTN)})`, 10000), `${w}: a Read-only denial offers a button`);
    // 2) a real adapter's denial (showPerm path, needs-permission with a denied permission): the one button moves to it
    await denyNow(id, 'write notes.md');
    assert.ok(await until(`[...document.querySelectorAll('#chat .note.perm')].pop().querySelector('[data-act="ro-ask"]')!==null`, 5000), `${w}: the button moved to the newest denial`);
    const b = await js(`(()=>{const all=[...document.querySelectorAll(${jsLiteral(BTN)})],b=all[0],n=b&&b.closest('.note'),r=b&&b.getBoundingClientRect(),R=n&&n.getBoundingClientRect();
      return {count:all.length,text:b&&b.textContent,popup:b&&b.getAttribute('aria-haspopup'),exp:b&&b.getAttribute('aria-expanded'),note:n&&n.querySelector('.pstate').textContent,
        inside:!!b&&r.left>=R.left-0.5&&r.right<=R.right+0.5&&r.bottom<=R.bottom+0.5,font:b&&parseFloat(getComputedStyle(b).fontSize)}})()`);
    assert.strictEqual(b.count, 1, `${w}: one button per agent`);
    assert.strictEqual(b.text, 'Switch to Ask first…', `${w}: the suggestion is the button`);
    assert.strictEqual(b.popup, 'menu', `${w}: aria-haspopup=menu`);
    assert.strictEqual(b.exp, 'false', `${w}: aria-expanded=false while closed`);
    assert.ok(/denied: this agent is in Read-only/.test(b.note) && !/Switch it to Ask first/.test(b.note), `${w}: the text no longer repeats the suggestion: ${b.note}`);
    assert.ok(b.inside, `${w}: the button sits inside the note`);
    assert.ok(b.font >= 10.5, `${w}: legible (${b.font}px)`);
    await H.shot(path.join(OUT, `003-ro-ask-${w}x${h}.png`), { prep: 'calm', delay: 150 });

    // 2b) the answer bar (the denial counts as the agent's waiting card): scrolled out of view, the bar's copy opens the same menu
    if (!kb) {
      await js(`document.getElementById('chat').scrollTop=0`);
      const AB = '#answerBar [data-act="ro-ask"]';
      assert.ok(await until(`!!document.querySelector(${jsLiteral(AB)})&&!document.getElementById('answerBar').hidden`, 5000), `${w}: the answer bar offers the button`);
      assert.strictEqual(await js(`document.querySelector(${jsLiteral(AB)}).getAttribute('aria-haspopup')`), 'menu', `${w}: bar button aria-haspopup`);
      await js(`document.querySelector(${jsLiteral(AB)}).click()`);
      assert.ok(await until(`!!document.getElementById('modeMenu')`, 3000), `${w}: the bar's button opens the menu`);
      assert.deepStrictEqual(await menuItems(), ['read-only*', 'ask', 'allow'], `${w}: the same menu from the bar`);
      const near = await js(`(()=>{const m=document.getElementById('modeMenu').getBoundingClientRect(),b=document.querySelector(${jsLiteral(AB)}).getBoundingClientRect();return Math.abs(m.left-b.left)<=40||Math.abs(m.right-b.right)<=40})()`);
      assert.ok(near, `${w}: anchored to the bar's button`);
      await key('Escape');
      assert.ok(await until(`!document.getElementById('modeMenu')`, 3000), `${w}: Escape closes it`);
      assert.strictEqual(await js(`document.activeElement===document.querySelector(${jsLiteral(AB)})`), true, `${w}: focus back on the bar's button`);
      await js(`(()=>{const c=document.getElementById('chat');c.scrollTop=c.scrollHeight})()`);
      await until(`document.getElementById('answerBar').hidden`, 3000);
    }
    // 3) open the menu: mouse at 1440, Enter at 1280
    if (kb) { await js(`document.querySelector(${jsLiteral(BTN)}).focus()`); await key('Return'); }
    else await js(`document.querySelector(${jsLiteral(BTN)}).click()`);
    assert.ok(await until(`!!document.getElementById('modeMenu')`, 5000), `${w}: the mode menu opens`);
    assert.deepStrictEqual(await menuItems(), ['read-only*', 'ask', 'allow'], `${w}: the three modes, Read-only ticked`);
    assert.ok(!(await js(`!!document.querySelector('#modeMenu [data-act],#modeMenu [data-op]')`)), `${w}: modes only (no model, plan or folder items)`);
    assert.strictEqual(await active(), 'read-only', `${w}: focus on the current mode`);
    assert.strictEqual(await js(`document.querySelector(${jsLiteral(BTN)}).getAttribute('aria-expanded')`), 'true', `${w}: aria-expanded=true while open`);
    const geo = await js(`(()=>{const m=document.getElementById('modeMenu').getBoundingClientRect(),b=document.querySelector(${jsLiteral(BTN)}).getBoundingClientRect();return {inView:m.top>=0&&m.bottom<=innerHeight&&m.left>=0&&m.right<=innerWidth,near:Math.abs(m.left-b.left)<=40||Math.abs(m.right-b.right)<=40}})()`);
    assert.ok(geo.inView && geo.near, `${w}: the menu is on screen, anchored to the button ${jsLiteral(geo)}`);
    await H.shot(path.join(OUT, `003-ro-ask-menu-${w}x${h}.png`), { delay: 150 });
    // Escape closes it, focus returns to the button
    await key('Escape');
    assert.ok(await until(`!document.getElementById('modeMenu')`, 3000), `${w}: Escape closes the menu`);
    assert.strictEqual(await active(), 'ro-ask', `${w}: focus back on the button`);

    // 4) Allow all keeps its confirmation; cancelling it changes nothing
    await key(kb ? 'Space' : 'Return', [], { char: 'always' });
    assert.ok(await until(`!!document.getElementById('modeMenu')`, 3000), `${w}: ${kb ? 'Space' : 'Enter'} opens the menu`);
    await js(`document.querySelector('#modeMenu [data-mode="allow"]').click()`);
    assert.ok(await until(`!![...document.querySelectorAll('.dlg h3')].find(x=>/^Allow all for/.test(x.textContent))`, 5000), `${w}: Allow all asks first`);
    await key('Escape');
    assert.ok(await until(`![...document.querySelectorAll('.dlg h3')].find(x=>/^Allow all for/.test(x.textContent))`, 3000), `${w}: Escape cancels the confirmation`);
    assert.strictEqual(await modeOf(id), 'read-only', `${w}: still Read-only after cancelling`);
    assert.ok(await H.exists(BTN), `${w}: the button stays after a cancel`);

    // 5) choose Ask first; count sends to prove nothing is resent
    await js(`(()=>{const b=window.__durbarSimUi.bridge();window.__sends=0;if(!b.__wrapped){const o=b.send;b.send=function(){window.__sends++;return o.apply(this,arguments)};b.__wrapped=1;}})()`);
    if (kb) {
      await js(`document.querySelector(${jsLiteral(BTN)}).focus()`); await key('Return');
      assert.ok(await until(`!!document.getElementById('modeMenu')`, 3000), `${w}: the menu opens again`);
      await key('Down');
      assert.strictEqual(await active(), 'ask', `${w}: ArrowDown moves to Ask first`);
      await key('Return');
    } else {
      await js(`document.querySelector(${jsLiteral(BTN)}).click()`);
      assert.ok(await until(`!!document.getElementById('modeMenu')`, 3000), `${w}: the menu opens again`);
      await js(`document.querySelector('#modeMenu [data-mode="ask"]').click()`);
    }
    assert.ok(await until(`((window.__durbarSimUi.agents().find(a=>a.id===${jsLiteral(id)})||{}).info||{}).permMode==='ask'`, 5000), `${w}: the mode changed to Ask first`);
    assert.ok(await until(`/Ask first/.test((document.getElementById('modeChip')||{}).textContent||'')`, 3000), `${w}: the chip says Ask first`);
    assert.ok(await until(`!document.querySelector(${jsLiteral(BTN)})`, 3000), `${w}: the button is gone after the switch`);
    const after = await js(`(()=>{const l=document.querySelector('#chat .ro-done');return {line:l&&l.textContent,toast:[...document.querySelectorAll('#toasts .toast')].map(t=>t.textContent).join(' | ')}})()`);
    assert.strictEqual(after.line, `Now in Ask first. Ask ${name} to try again: it will wait for your OK.`, `${w}: says to ask again`);
    assert.ok(/Ask first/.test(after.toast), `${w}: the usual toast: ${after.toast}`);
    assert.strictEqual(await active(), 'msgInput', `${w}: focus moves to the message box`);
    assert.strictEqual(await js('window.__sends'), 0, `${w}: nothing is resent`);
    assert.ok(!(await js(`!![...document.querySelectorAll('#chat button')].find(b=>/^Retry/.test(b.textContent))`)), `${w}: no Retry`);
    await H.shot(path.join(OUT, `003-ro-ask-done-${w}x${h}.png`), { prep: 'calm', delay: 150 });

    // 6) Needs you (once): a waiting Read-only agent's row opens the same menu from its chat
    if (!kb) {
      await key('Escape'); // back to the office
      const other = await js(`(window.__durbarSimUi.agents().find(a=>!a.parent&&a.live&&a.info&&a.info.permMode==='read-only'&&a.id!==${jsLiteral(id)})||{}).id`);
      assert.ok(other, `${w}: a second Read-only agent`);
      await denyNow(other, 'write todo.md');
      await js(`document.getElementById('inboxBtn').click()`);
      const sel = '#inboxBody .inbox-row[data-id="' + String(other).replace(/[^\w-]/g, '') + '"] button[data-k="other"]';
      assert.ok(await until(`!!document.querySelector(${jsLiteral(sel)})`, 5000), `${w}: the Needs you row offers the action`);
      const ib = await js(`(()=>{const b=document.querySelector(${jsLiteral(sel)});return {text:b.textContent,popup:b.getAttribute('aria-haspopup')}})()`);
      assert.deepStrictEqual(ib, { text: 'Switch to Ask first…', popup: 'menu' }, `${w}: the Needs you button`);
      await js(`document.querySelector(${jsLiteral(sel)}).click()`);
      assert.ok(await until(`!document.getElementById('inboxDlg')&&!!document.getElementById('modeMenu')&&document.body.classList.contains('panel-open')`, 5000), `${w}: the inbox closes and the menu opens in the chat`);
      assert.deepStrictEqual(await menuItems(), ['read-only*', 'ask', 'allow'], `${w}: the same menu from Needs you`);
      await key('Escape');
      assert.strictEqual(await active(), 'ro-ask', `${w}: focus on the chat's button`);
      assert.strictEqual(await modeOf(other), 'read-only', `${w}: nothing changed without a choice`);
    }
  }
  console.log('[ro-ask] PASS');
};
