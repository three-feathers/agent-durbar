/*
 * Spec 099 T037 (SC-001, FR-056): Autopilot in the window, on the simulator, 0 credits, 15 agents, at 1440x900 and 1280x800.
 * Two runs (ui-suite has both):
 *   no flag: the default build: nothing offers it, in the menu, the list of agent apps or the page text, and main never put `simautopilot` in the page's query;
 *   DURBAR_AUTOPILOT_TEST=1 (the test-only gate, spec *Changes*): menu, form, chip, desk, list, chat, every end reason, hostile text.
 * The native dialog cannot be pressed from here: the simulator's bridge asks `__durbarSimUi.autopilotDialog` in its place. Main's real dialog is tested in test-autopilot-ipc.ts.
 *   npm run build; OUT=<dir> DURBAR_USER_DATA=$(mktemp -d) DURBAR_SIM=15 DURBAR_AUTOPILOT_TEST=1 DURBAR_DRIVER=$PWD/scripts/check-autopilot.js npx electron . --no-sandbox
 */
const assert = require('assert');
const os = require('os');
const path = require('path');
const { helpers, jsLiteral } = require('./driver-helpers');
const OUT = process.env.OUT || os.tmpdir();
const ON = process.env.DURBAR_AUTOPILOT_TEST === '1';
const SIZES = [[1440, 900], [1280, 800]];
const q = (o = {}) => ({ simkinds: 'mixed', ...(ON ? { simautopilot: '1' } : {}), ...o });
const REASONS = ['done', 'cap', 'limit', 'no-progress', 'blocked', 'stopped', 'error'];

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { js, until } = H;
  const must = async (expr, msg, ms = 8000) => assert.ok(await until(expr, ms), msg + ' (' + expr.slice(0, 120) + ')');
  const pick = (kind, mode) => `(a=>a.live&&!a.parent&&a.info&&(a.info.adapterId||'copilot')===${jsLiteral(kind)}${mode ? `&&a.info.permMode===${jsLiteral(mode)}` : ''})`;
  // text under 10.5px anywhere inside a selector; hidden nodes do not count
  const small = (sel) => js(`(()=>{const o=[];for(const r of document.querySelectorAll(${jsLiteral(sel)}))for(const n of [r,...r.querySelectorAll('*')]){if(!n.getClientRects().length)continue;const own=[...n.childNodes].some(c=>c.nodeType===3&&c.textContent.trim());if(own&&parseFloat(getComputedStyle(n).fontSize)<10.5)o.push(n.tagName+':'+n.textContent.trim().slice(0,30)+':'+getComputedStyle(n).fontSize);}return o;})()`);
  const inView = (sel) => js(`(()=>{const e=document.querySelector(${jsLiteral(sel)});if(!e)return false;const r=e.getBoundingClientRect();return r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight&&r.width>0;})()`);
  const fitOffice = async (w) => {
    const f = await js(`(()=>{const ds=[...document.querySelectorAll('#stage .desk[data-id]')];const rs=ds.map(d=>d.getBoundingClientRect());let over=0;for(let i=0;i<rs.length;i++)for(let j=i+1;j<rs.length;j++){const a=rs[i],b=rs[j];if(a.left<b.right-1&&b.left<a.right-1&&a.top<b.bottom-1&&b.top<a.bottom-1)over++;}return {n:ds.length,over,sc:document.scrollingElement.scrollTop,bottom:Math.max(...rs.map(r=>r.bottom)),h:innerHeight,right:Math.max(...rs.map(r=>r.right)),w:innerWidth};})()`);
    assert.strictEqual(f.n >= 15, true, `${w}: 15 agents`);
    assert.strictEqual(f.over, 0, `${w}: no desks overlap`);
    assert.strictEqual(f.sc, 0, `${w}: the page does not scroll`);
    assert.ok(f.bottom <= f.h && f.right <= f.w, `${w}: all fit ${jsLiteral(f)}`);
  };

  if (!ON) {
    // ---- the default build: nothing a person sees changes ----
    const first = await js('location.search');
    assert.ok(!/simautopilot/.test(first), 'main offered no Autopilot to the simulator');
    for (const [w, h] of SIZES) {
      await H.load({ w, h, query: q() });
      await H.calm();
      const kinds = await js(`window.__durbarSimUi.bridge().listAdapters().then(l=>l.map(k=>[k.id,'autopilot' in (k.capabilities||{})]))`);
      assert.ok(kinds.length >= 3 && kinds.every((k) => k[1] === false), 'no capability in the list of agent apps');
      const r = await js(`window.__durbarSimUi.bridge().setAutopilot(window.__durbarSimUi.agents()[0].id,{limit:5})`);
      assert.deepStrictEqual(r, { ok: false, error: 'Autopilot is not available yet.' }, 'the simulator refuses too');
      // real preload, real main: refused by main under the simulator, whatever the page asks
      const real = await js(`window.agentDurbar.setAutopilot('sim-1',{limit:5}).then(x=>x,e=>({threw:String(e&&e.message||e)}))`);
      assert.ok(real.threw || real.ok === false, `main refuses: ${jsLiteral(real)}`);
      for (const kind of ['copilot', 'claude', 'codex']) {
        const o = await H.openSimAgent(pick(kind), '#modeChip');
        assert.ok(o.ok, `${w}: open a ${kind} agent ${jsLiteral(o.seen)}`);
        await H.click('#modeChip');
        await must(`!!document.querySelector('#modeMenu [data-mode="allow"],#modeMenu [data-mode="ask"]')`, 'the mode menu opened');
        const m = await js(`(()=>{const x=document.getElementById('modeMenu');return {ap:!!x.querySelector('[data-act="autopilot"]'),text:x.innerText,modes:x.querySelectorAll('[data-mode]').length};})()`);
        assert.strictEqual(m.ap, false, `${kind}: no menu item`);
        assert.ok(!/autopilot/i.test(m.text), `${kind}: no word in the menu`);
        if (kind === 'copilot' && w === 1440) await H.shot(path.join(OUT, `099-default-menu-${w}.png`), { prep: 'calm' });
        await H.key('Escape');
        await H.clickText('#panel button', 'Close').catch(() => undefined);
        await js(`document.getElementById('closePanel')&&document.getElementById('closePanel').click()`);
      }
      const page = await js(`document.body.innerText`);
      assert.ok(!/autopilot/i.test(page), 'no word anywhere on the page');
    }
    console.log('check-autopilot (default build): OK');
    return;
  }

  // ---- the test-only gate ----
  assert.ok(/simautopilot=1/.test(await js('location.search')), 'main put it in the query only because the gate is open');

  const turnOn = async (cap) => {
    await H.click('#modeChip');
    await must(`!!document.querySelector('#modeMenu [data-act="autopilot"]')`, 'the menu item');
    await H.click('#modeMenu [data-act="autopilot"]');
    await must(`!!document.querySelector('#modeDlg .ap-form')`, 'the form');
    if (cap !== undefined) await js(`(()=>{const b=document.getElementById('apCapOn');b.checked=true;b.dispatchEvent(new Event('change',{bubbles:true}));const c=document.getElementById('apCap');c.value=${jsLiteral(String(cap))};c.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await H.clickText('#modeDlg button', 'Continue…');
    await must(`!document.querySelector('#modeDlg')`, 'the form closed');
  };
  const chip = () => js(`(()=>{const c=document.getElementById('modeChip');const s=getComputedStyle(c);return {text:c.innerText.replace(/\\s+/g,' ').trim(),title:c.title,cls:c.className,color:s.color,bg:s.backgroundColor,font:parseFloat(s.fontSize),glyph:!!c.querySelector('.mi svg')};})()`);
  const send = async (t) => {
    await js(`(()=>{const i=document.getElementById('msgInput');i.value=${jsLiteral(t)};i.dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('sendBtn').click();})()`);
  };

  for (const [w, h] of SIZES) {
    await H.load({ w, h, query: q({ simaphold: '1' }) });
    await H.calm();
    await until(`window.__durbarSimUi.agents().filter(a=>a.live&&!a.parent).length>=15`, 15000);
    await H.shot(path.join(OUT, `099-office-before-${w}.png`), { prep: 'calm' });
    await fitOffice(w);

    // the menu: in every mode (D13), with the real mode's check mark
    const o = await H.openSimAgent(pick('claude', 'read-only'), '#modeChip');
    assert.ok(o.ok, `${w}: a Claude Code agent in Read-only ${jsLiteral(o.seen)}`);
    const id = o.id;
    assert.match((await chip()).text, /Read-only/);
    await H.click('#modeChip');
    await must(`!!document.querySelector('#modeMenu [data-act="autopilot"]')`, 'the menu item, from Read-only');
    const menu = await js(`(()=>{const x=document.querySelector('#modeMenu [data-act="autopilot"]');const o=x.getBoundingClientRect();return {text:x.innerText,dis:x.getAttribute('aria-disabled'),checked:x.getAttribute('aria-checked'),h:o.height,glyph:!!x.querySelector('.mi svg'),inside:o.bottom<=innerHeight&&o.top>=0,ro:document.querySelector('#modeMenu [data-mode="read-only"]').getAttribute('aria-checked')};})()`);
    assert.match(menu.text, /Autopilot…/);
    assert.strictEqual(menu.dis, null);
    assert.strictEqual(menu.checked, 'false');
    assert.strictEqual(menu.ro, 'true');
    assert.ok(menu.glyph && menu.inside, `${w}: glyph, on screen`);
    assert.deepStrictEqual(await small('#modeMenu'), [], `${w}: menu text`);
    await H.shot(path.join(OUT, `099-menu-${w}.png`), { prep: 'calm' });

    // the form: grants nothing; warnings; Continue follows validity
    await H.click('#modeMenu [data-act="autopilot"]');
    await must(`!!document.querySelector('#modeDlg .ap-form')`, 'the form');
    assert.strictEqual(await js(`window.__durbarSimUi.agents().find(a=>a.id===${jsLiteral(id)}).info.autopilot===undefined`), true, 'the form grants nothing');
    const form = await js(`(()=>{const d=document.querySelector('#modeDlg');return {limit:document.getElementById('apLimit').value,hours:document.getElementById('apHours').value,text:d.innerText,warn:[...d.querySelectorAll('.ap-warn:not(.ap-folder)')].filter(x=>!x.hidden).length,folder:!!document.getElementById('apFolder'),btns:[...d.querySelectorAll('.dbtn button')].map(b=>b.textContent)};})()`);
    assert.strictEqual(form.limit, '5');
    assert.strictEqual(form.hours, '2');
    assert.match(form.text, /No spend cap: Autopilot stops when the task is done/);
    assert.match(form.text, /US dollars \(Claude's estimate\)/);
    assert.match(form.text, /Not verified on a real session yet/);
    assert.strictEqual(form.warn, 0);
    assert.ok(form.folder, 'from Read-only the form says the folder changes');
    assert.deepStrictEqual(form.btns, ['Cancel', 'Continue…']);
    await H.shot(path.join(OUT, `099-form-${w}.png`), { prep: 'calm' });
    const setv = (fid, v) => js(`(()=>{const c=document.getElementById(${jsLiteral(fid)});c.value=${jsLiteral(String(v))};c.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await setv('apLimit', 21);
    await setv('apHours', 3);
    await js(`(()=>{const b=document.getElementById('apCapOn');b.click();})()`);
    await setv('apCap', 2);
    const warned = await js(`(()=>{const d=document.querySelector('#modeDlg');const dlg=d.querySelector('.dlg').getBoundingClientRect();return {a:!document.getElementById('apLimitW').hidden&&document.getElementById('apLimitW').textContent,b:!document.getElementById('apHoursW').hidden&&document.getElementById('apHoursW').textContent,counts:!document.getElementById('apCounts').hidden&&document.getElementById('apCounts').textContent,none:document.getElementById('apNoCap').hidden,inside:dlg.top>=0&&dlg.bottom<=innerHeight&&dlg.right<=innerWidth,btn:[...d.querySelectorAll('.dbtn button')].every(b=>{const r=b.getBoundingClientRect();return r.right<=dlg.right&&r.bottom<=dlg.bottom;}),color:getComputedStyle(document.getElementById('apLimitW')).fontWeight};})()`);
    assert.match(String(warned.a), /Above 20 extra turns/);
    assert.match(String(warned.b), /Above 2 hours/);
    assert.match(String(warned.counts), /for this session in total/);
    assert.strictEqual(warned.none, true, 'a cap ticked: the no-cap sentence goes');
    assert.ok(warned.inside && warned.btn, `${w}: dialog on screen, buttons inside`);
    assert.deepStrictEqual(await small('#modeDlg'), [], `${w}: form text`);
    // the picture, not only the words: each field sits on one line with its text, and the rows start at the left
    const rows = await js(`[...document.querySelectorAll('#modeDlg .ap-row')].map(r=>{const c=getComputedStyle(r),i=r.querySelector('.ap-num').getBoundingClientRect(),l=r.querySelector('.ap-lbl').getBoundingClientRect(),b=r.getBoundingClientRect();return {dir:c.flexDirection,mid:Math.abs((i.top+i.bottom)/2-(l.top+l.bottom)/2),left:r.firstElementChild.getBoundingClientRect().left-b.left,h:b.height};})`);
    assert.strictEqual(rows.length, 3);
    for (const r of rows) {
      assert.strictEqual(r.dir, 'row', `${w}: a row`);
      assert.ok(r.mid <= 3, `${w}: the field and its text on one line ${jsLiteral(r)}`);
      assert.ok(r.left <= 1, `${w}: from the left ${jsLiteral(r)}`);
      assert.ok(r.h <= 40, `${w}: one line ${jsLiteral(r)}`);
    }
    await H.shot(path.join(OUT, `099-form-warnings-${w}.png`), { prep: 'calm' });
    for (const bad of [0, 1001, 1.5, '']) {
      await setv('apLimit', bad);
      assert.strictEqual(await js(`document.querySelector('#modeDlg .dbtn .primary').disabled`), true, `Continue is off for limit ${bad}`);
    }
    await setv('apLimit', 5);
    assert.strictEqual(await js(`document.querySelector('#modeDlg .dbtn .primary').disabled`), false);
    await H.key('Escape');
    await must(`!document.querySelector('#modeDlg')`, 'Esc closes the form');
    assert.match((await chip()).text, /Read-only/, 'Esc: nothing changed');

    // main's "No": nothing changes
    await js(`window.__durbarSimUi.autopilotDialog=()=>false;0`);
    await turnOn();
    await must(`(window.__durbarSimUi.autopilotAsked||[]).length>=1`, 'the (simulated) native dialog was asked');
    assert.match((await chip()).text, /Read-only/, 'Cancel at the native dialog: nothing changed');
    assert.strictEqual(await js(`window.__durbarSimUi.agents().find(a=>a.id===${jsLiteral(id)}).info.permMode`), 'read-only');
    await js(`window.__durbarSimUi.autopilotDialog=null;0`);

    // on: the real mode on the chip, the menu, the desk and the list
    await turnOn();
    await must(`/Autopilot/.test(document.getElementById('modeChip').innerText)`, 'the chip');
    const c1 = await chip();
    assert.strictEqual(c1.text, 'Autopilot');
    assert.ok(c1.glyph, 'its own glyph');
    assert.match(c1.cls, /mode-autopilot/);
    assert.match(c1.title, /up to 5 more turns per message, no spend cap/);
    assert.match(c1.title, /Not verified on a real session yet/);
    assert.ok(c1.font >= 10.5);
    const redInk = await js(`getComputedStyle(document.documentElement).getPropertyValue('--red-ink').trim()`);
    assert.ok(redInk, 'the token exists');
    assert.notStrictEqual(c1.bg, 'rgba(0, 0, 0, 0)', 'the chip has its own background, as a computed value');
    const ph = await js(`(()=>{const m=document.getElementById('msgInput');const f=document.getElementById('attFile');const n=document.getElementById('apNoAttach');return {p:m.placeholder,l:m.getAttribute('aria-label'),file:f?getComputedStyle(f).display:'none',tip:n&&n.title};})()`);
    assert.match(ph.l, /Describe the finished result\. Claude Code keeps going until it is done\./);
    assert.strictEqual(ph.file, 'none', 'D10: no attach button on a text-only goal');
    assert.match(String(ph.tip), /takes text only/);
    assert.match(await js(`document.querySelector('#panel .hint').textContent`), /Autopilot/, 'the composer hint');
    await H.click('#modeChip');
    await must(`!!document.querySelector('#modeMenu [data-act="autopilot"]')`, 'the menu again');
    const m2 = await js(`(()=>{const a=document.querySelector('#modeMenu [data-act="autopilot"]');const b=document.querySelector('#modeMenu [data-mode="allow"]');return {a:a.getAttribute('aria-checked'),ack:a.querySelector('.ck').textContent,b:b.getAttribute('aria-checked'),bck:b.querySelector('.ck').textContent};})()`);
    assert.deepStrictEqual(m2, { a: 'true', ack: '✓', b: 'false', bck: '' }, 'the check mark is on Autopilot');
    await H.shot(path.join(OUT, `099-menu-on-${w}.png`), { prep: 'calm' });
    await H.key('Escape');

    // a run: the chip counts; the question is shown, not waited on; the chat says each step; no text under 10.5px
    await send('Add a flag and the tests');
    await must(`/Autopilot · 2\\/5/.test(document.getElementById('modeChip').innerText)`, 'the chip counts', 10000);
    const run = await js(`(()=>{const q=[...document.querySelectorAll('.note.ap-question')].pop();return {lines:[...document.querySelectorAll('.note.ap-line')].map(n=>n.textContent),qHead:q&&q.querySelector('b').textContent,qBtns:q?q.querySelectorAll('button,textarea').length:-1,pending:document.querySelectorAll('.note.perm:not(.settled)').length,state:window.__durbarSimUi.agents().find(a=>a.id===${jsLiteral(id)}).state};})()`);
    assert.ok(run.lines.includes('Autopilot: working on your message (up to 5 more turns, no spend cap)'), JSON.stringify(run.lines));
    assert.ok(run.lines.includes('Autopilot: continuing (2 of up to 5)'), JSON.stringify(run.lines));
    assert.strictEqual(run.qHead, 'Decided by itself (Autopilot)');
    assert.strictEqual(run.qBtns, 0, 'FR-030: no buttons');
    assert.strictEqual(run.pending, 0, 'and nothing waits');
    assert.notStrictEqual(run.state, 'waiting');
    assert.deepStrictEqual(await small('#panel .note.ap-line, #panel .note.ap-question, #modeChip'), [], `${w}: chat lines`);
    const stacked = await js(`(()=>{const n=[...document.querySelectorAll('#panel .note.ap-line, #panel .note.ap-question')].map(x=>x.getBoundingClientRect());return n.every((r,i)=>i===0||r.top>=n[i-1].bottom-1);})()`);
    assert.ok(stacked, `${w}: the lines stack, one under the other`);
    assert.ok(await js(`document.querySelector('#panel .note.ap-question').getBoundingClientRect().width>300`), `${w}: the question card is not squeezed`);
    await H.shot(path.join(OUT, `099-chip-run-${w}.png`), { prep: 'calm' });
    // Stop: at once, back to Allow all, and the card says so
    await H.click('#stopBtn');
    await must(`!!document.querySelector('.note.ap-end[data-reason="stopped"]')`, 'the end card');
    const c2 = await chip();
    assert.match(c2.text, /^Allow all/, `S3: ${c2.text}`);
    assert.ok(!/mode-autopilot/.test(c2.cls));
    const end = await js(`(()=>{const n=document.querySelector('.note.ap-end[data-reason="stopped"]');return {t:n.querySelector('.ap-words').textContent,ic:n.querySelector('.ap-ic').textContent,btns:[...n.querySelectorAll('button')].map(b=>b.textContent)};})()`);
    assert.strictEqual(end.t, 'Autopilot ended: stopped by you, after 2 more turns, $0.04');
    assert.ok(end.ic, 'an icon, not colour alone');
    assert.deepStrictEqual(end.btns, ['Run again on Autopilot…', 'Switch to Ask first…']);
    const backName = await js(`window.__durbarSimUi.agents().find(a=>a.id===${jsLiteral(id)}).name`);
    assert.strictEqual(await js(`document.getElementById('msgInput').getAttribute('aria-label')`), 'Message ' + backName, 'the composer is back');
    assert.ok(await js(`!!document.getElementById('attFile')&&getComputedStyle(document.getElementById('attFile')).display!=='none'&&!document.getElementById('apNoAttach')`), 'the attach button is back');
    await H.shot(path.join(OUT, `099-end-stopped-${w}.png`), { prep: 'calm' });
    // Run again asks again
    await H.clickText('.note.ap-end button', 'Run again on Autopilot…');
    await must(`!!document.querySelector('#modeDlg .ap-form')`, 'the form again');
    await H.key('Escape');

    // on the office and the list, all fifteen at once, each with its real mode
    await js(`document.getElementById('closePanel')&&document.getElementById('closePanel').click()`);
    await H.key('Escape');
    await js(`(async()=>{const U=window.__durbarSimUi,b=U.bridge();for(const a of U.agents()){if(a.live&&!a.parent&&a.info&&!a.info.autopilot){const r=await b.setAutopilot(a.id,{limit:5});if(r&&r.ok){a.info.permMode='allow';a.info.autopilot=r.autopilot;}}}U.render&&U.render();})();0`);
    await until(`window.__durbarSimUi.agents().filter(a=>a.info&&a.info.autopilot).length>=10`, 8000);
    await js(`window.__durbarSimUi.render&&window.__durbarSimUi.render()`);
    await must(`document.querySelectorAll('#stage .modeic.mode-autopilot').length>=10`, 'the desks show it');
    await H.shot(path.join(OUT, `099-office-${w}.png`), { prep: 'calm' });
    await fitOffice(w);
    const desk = await js(`(()=>{const d=document.querySelector('#stage .desk[data-id="'+CSS.escape(${jsLiteral(id)})+'"]');const ic=d.querySelector('.modeic.mode-autopilot');const name=d.querySelector('.name');const a=window.__durbarSimUi.agents().find(x=>x.id===${jsLiteral(id)});return {glyph:!!ic&&!!ic.querySelector('svg'),color:ic&&getComputedStyle(ic).color,nameW:name.getBoundingClientRect().width,aria:d.getAttribute('aria-label')||'',task:d.innerText,stage:document.querySelectorAll('#stage .modebadge').length};})()`);
    assert.ok(desk.glyph, 'the desk glyph');
    assert.ok(desk.nameW > 10, `the name is still shown: ${desk.nameW}`);
    assert.match(desk.aria, /Autopilot/, 'the desk says it in words');
    assert.deepStrictEqual(await small('#stage .desk .ci, #stage .desk .info'), [], `${w}: desks`);
    assert.match(await js(`(()=>{const a=window.__durbarSimUi.agents().find(x=>x.id===${jsLiteral(id)});return document.querySelector('#stage .desk[data-id="'+CSS.escape(a.id)+'"]').getAttribute('aria-label');})()`), /On Autopilot:/, 'the desk line');
    await H.click('#vList');
    await must(`!!document.querySelector('#list .lrow .ap-badge')`, 'the list says Autopilot');
    const list = await js(`(()=>{const b=document.querySelector('#list .lrow .ap-badge');const s=getComputedStyle(b);const r=b.getBoundingClientRect();return {t:b.textContent,font:parseFloat(s.fontSize),n:document.querySelectorAll('#list .lrow .ap-badge').length,w:r.width,color:s.color,allowBadges:[...document.querySelectorAll('#list .lrow .modebadge')].filter(x=>x.textContent==='Allow all').length};})()`);
    assert.strictEqual(list.t, 'Autopilot');
    assert.ok(list.font >= 10.5, `list badge ${list.font}`);
    assert.ok(list.n >= 10);
    await H.shot(path.join(OUT, `099-list-${w}.png`), { prep: 'calm' });
    await H.click('#vOffice');

    // down from Autopilot, by the menu: Allow all is only a stop; another mode ends it first
    await H.load({ w, h, query: q() });
    await H.calm();
    const o2 = await H.openSimAgent(pick('codex'), '#modeChip');
    assert.ok(o2.ok, `${w}: codex`);
    await turnOn(9000);
    await must(`/Autopilot/.test(document.getElementById('modeChip').innerText)`, 'on');
    assert.match((await chip()).title, /9000 tokens/, 'the cap in the person\'s unit');
    await H.click('#modeChip');
    await must(`!!document.querySelector('#modeMenu [data-mode="allow"]')`, 'menu');
    await H.click('#modeMenu [data-mode="allow"]');
    await must(`/^Allow all/.test(document.getElementById('modeChip').innerText.trim())`, 'Allow all from Autopilot is a stop');
    await turnOn();
    await must(`/Autopilot/.test(document.getElementById('modeChip').innerText)`, 'on again');
    await H.click('#modeChip');
    await must(`!!document.querySelector('#modeMenu [data-mode="read-only"]')`, 'menu');
    await H.click('#modeMenu [data-mode="read-only"]');
    await must(`/^Read-only/.test(document.getElementById('modeChip').innerText.trim())`, 'Read-only ends it first');
    assert.strictEqual(await js(`window.__durbarSimUi.agents().find(a=>a.id===${jsLiteral(o2.id)}).info.autopilot`), undefined);
    // a new session from one on Autopilot is not on Autopilot (FR-008) is pinned in the simulator's new-session copy and in main by test-autopilot-ipc

    // Copilot keeps its attach button (D10), and shows the 30 line
    const o3 = await H.openSimAgent(pick('copilot'), '#modeChip');
    assert.ok(o3.ok, 'copilot');
    await H.click('#modeChip');
    await must(`!!document.querySelector('#modeMenu [data-act="autopilot"]')`, 'menu');
    await H.click('#modeMenu [data-act="autopilot"]');
    await must(`!!document.querySelector('#modeDlg .ap-form')`, 'form');
    await js(`(()=>{document.getElementById('apCapOn').click();const c=document.getElementById('apCap');c.value='10';c.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    assert.match(await js(`document.getElementById('apRaised').hidden?'':document.getElementById('apRaised').textContent`), /smallest cap is 30 AI credits/, 'D9');
    await H.shot(path.join(OUT, `099-form-copilot-${w}.png`), { prep: 'calm' });
    await H.clickText('#modeDlg button', 'Continue…');
    await must(`/Autopilot/.test(document.getElementById('modeChip').innerText)`, 'copilot on');
    assert.match((await chip()).title, /30 AI credits/);
    assert.ok(await js(`getComputedStyle(document.getElementById('attFile')).display!=='none'&&!document.getElementById('apNoAttach')`), 'D10: Copilot keeps it');
  }

  // ---- every end reason, words and icon, at both sizes (SC-001) ----
  const shown = new Set();
  for (const [w, h] of SIZES) for (const reason of REASONS) {
    if (reason === 'stopped') continue; // above, by the real button
    await H.load({ w, h, query: q({ sim: `autopilot-${reason}` }) });
    await H.calm();
    const o = await H.openSimAgent(pick('copilot'), '#modeChip');
    assert.ok(o.ok);
    await turnOn();
    await must(`/Autopilot/.test(document.getElementById('modeChip').innerText)`, `on for ${reason}`);
    await send('Run it');
    await must(`!!document.querySelector('.note.ap-end[data-reason=${jsLiteral(reason)}]')`, `end ${reason}`, 12000);
    const n = await js(`(()=>{const n=document.querySelector('.note.ap-end[data-reason=${jsLiteral(reason)}]');return {t:n.querySelector('.ap-words').textContent,ic:n.querySelector('.ap-ic').textContent,btns:[...n.querySelectorAll('button')].map(b=>b.textContent),font:parseFloat(getComputedStyle(n.querySelector('.ap-words')).fontSize),border:getComputedStyle(n).borderLeftColor};})()`);
    const words = { done: /Copilot judged the task done/, cap: /spend cap was reached/, limit: /turn limit was reached/, 'no-progress': /no progress/, blocked: /blocked/, error: /error/ }[reason];
    assert.match(n.t, words, reason);
    assert.match(n.t, /^Autopilot ended: .*, after \d+ more turns?, 1\.5 AI credits$/, n.t);
    assert.ok(n.ic && n.font >= 10.5);
    assert.strictEqual(n.btns.includes('Run again on Autopilot…'), reason !== 'done', `S3 ${reason}`);
    const c = await chip();
    if (reason === 'done') assert.match(c.text, /^Autopilot$/, 'D8: stays on');
    else {
      assert.match(c.text, /^Allow all/, `S3 ${reason}: ${c.text}`);
      const st = await js(`document.querySelector('#panel .st-pill,#panel [class*="pill"]')?document.querySelector('#panel .st-pill,#panel [class*="pill"]').innerText:''`);
      const task = await js(`window.__durbarSimUi.agents().find(a=>a.id===${jsLiteral(o.id)}).task`);
      assert.ok(!/^Done/.test(st.trim()), `${reason}: never Done: ${st}`);
      assert.match(String(task), /^Autopilot ended: /, `${reason}: the status says why: ${task}`);
    }
    if (w === 1280 || reason === 'limit') await H.shot(path.join(OUT, `099-end-${reason}-${w}.png`), { prep: 'calm' });
    shown.add(reason);
  }
  assert.strictEqual(shown.size, REASONS.length - 1);

  // needs me: an end that was not seen sorts in the inbox, until it is seen; done does not
  await H.load({ w: 1440, h: 900, query: q({ sim: 'autopilot-limit', simaphold: '1' }) });
  await H.calm();
  const o4 = await H.openSimAgent(pick('copilot'), '#modeChip');
  await turnOn();
  await must(`/Autopilot/.test(document.getElementById('modeChip').innerText)`, 'on');
  await send('go');
  await must(`/Autopilot · 2\\/5/.test(document.getElementById('modeChip').innerText)`, 'running');
  const before = await js(`window.__durbarSimUi.agents().find(a=>a.id===${jsLiteral(o4.id)}).apEnded`);
  assert.ok(!before);
  await js(`document.getElementById('closePanel')&&document.getElementById('closePanel').click()`);
  await H.key('Escape');
  await until(`!document.body.classList.contains('panel-open')`, 4000);
  await js(`window.__durbarSimApGo(${jsLiteral(o4.id)})`);
  await must(`window.__durbarSimUi.agents().find(a=>a.id===${jsLiteral(o4.id)}).apEnded===true`, 'needs me until it is seen', 10000);
  await js(`document.querySelector('#stage .desk[data-id="'+CSS.escape(${jsLiteral(o4.id)})+'"]').click()`);
  await must(`window.__durbarSimUi.agents().find(a=>a.id===${jsLiteral(o4.id)}).apEnded===false`, 'seen');

  // hostile text on every surface: a goal, a question, output and a session's name are text, never markup
  await H.load({ w: 1440, h: 900, query: q({ simhostile: '1' }) });
  await H.calm();
  const o5 = await H.openSimAgent(pick('claude'), '#modeChip');
  const evil = '<img src=x onerror="window.__apPwned=1">';
  await js(`(()=>{const a=window.__durbarSimUi.agents().find(x=>x.id===${jsLiteral(o5.id)});a.name=${jsLiteral(evil)};a.task=${jsLiteral(evil)};})()`);
  await H.click('#modeChip');
  await must(`!!document.querySelector('#modeMenu [data-act="autopilot"]')`, 'menu');
  await H.click('#modeMenu [data-act="autopilot"]');
  await must(`!!document.querySelector('#modeDlg .ap-form')`, 'form');
  assert.match(await js(`document.getElementById('mdT').textContent`), /<img src=x/, 'the title shows it as text');
  await H.shot(path.join(OUT, '099-hostile-form-1440.png'), { prep: 'calm' });
  await H.clickText('#modeDlg button', 'Continue…');
  await must(`/Autopilot/.test(document.getElementById('modeChip').innerText)`, 'on');
  await send(evil);
  await must(`!!document.querySelector('.note.ap-end')`, 'the run ends', 10000);
  const hostile = await js(`(()=>{const ev=document.querySelectorAll('img[src="x"]').length;return {pwned:window.__apPwned===1,imgs:ev,q:document.querySelector('.note.ap-question .q-text').textContent};})()`);
  assert.strictEqual(hostile.pwned, false, 'nothing ran');
  assert.strictEqual(hostile.imgs, 0, 'no element came of it');
  assert.match(hostile.q, /<img src=x/, 'shown as its own text');
  await js(`document.getElementById('closePanel')&&document.getElementById('closePanel').click()`);
  await H.key('Escape');
  await js(`window.__durbarSimUi.render&&window.__durbarSimUi.render()`);
  await ctx.sleep(200);
  assert.strictEqual(await js(`document.querySelectorAll('img[src="x"]').length`), 0, 'and on the desk');

  console.log('check-autopilot (test gate): OK');
};
