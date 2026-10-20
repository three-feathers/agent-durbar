/*
 * Check for spec 059 (issue #372): rename a session in the simulator (no AI credits, no agent app). Simulator only.
 *
 *   npm run check:rename
 *   OUT=docs/screenshots  (optional) also saves the screenshots
 *
 * At 1440x900 and 1280x800, in Expert and in Simple: Rename… from the chat header's More menu and from the card menu; the dialog
 * words per kind (Copilot/Codex "Also saved in", Claude Code "at your next message", none "Only in Agent Durbar"); the field is
 * prefilled and selected; Enter saves, Escape changes nothing and returns focus, an empty name resets, a refused name keeps the
 * dialog open with the reason; an HTML-looking name shows as text on every surface (card, list row, header, strip, Schedules, Previous
 * sessions) and no element or script comes from it; a 60-character name fits the header; the runtime title is not in the tooltips of a
 * renamed session. A miss prints DRIVER FAILED (Electron still exits 0), so the npm script exits non-zero unless "all checks passed" is printed.
 */
const path = require('path');
const assert = require('assert');
const OUT = process.env.OUT || require('os').tmpdir();
const INDEX = path.join(process.cwd(), 'dist', 'renderer', 'index.html');
const Q = { sim: '15', simfreeze: '1', simkinds: 'mixed', simtitles: '1' };
const EVIL = '<img src=x onerror=window.__xss=1> & "q"';
const LONG = 'Sixty characters long name for the layout check, ends here..';

module.exports = async (ctx) => {
  const js = async (c) => { try { return await ctx.js(c); } catch (e) { console.log('JS ERR for', c.slice(0, 120)); throw e; } };
  const shot = async (name) => { ctx.win.webContents.sendInputEvent({ type: 'mouseMove', x: 1, y: 1 }); await ctx.sleep(300); await ctx.shot(path.join(OUT, name)); console.log('[rename] saved', name); };
  const key = async (k) => js(`(()=>{const t=document.activeElement||document.body;const e=new KeyboardEvent('keydown',{key:${JSON.stringify(k)},bubbles:true,cancelable:true});t.dispatchEvent(e);return e.defaultPrevented})()`);
  const dlg = () => js(`(()=>{const d=document.getElementById('modeDlg');if(!d)return null;const i=d.querySelector('#mdIn'),e=d.querySelector('#mdErr');return {title:d.querySelector('h3').textContent,lines:[...d.querySelectorAll('.dlist li')].map(x=>x.textContent),value:i.value,sel:[i.selectionStart,i.selectionEnd],max:i.maxLength,err:e&&!e.hidden?e.textContent:'',focus:document.activeElement===i,btns:[...d.querySelectorAll('.btn')].map(b=>b.textContent+(b.classList.contains('primary')?'*':''))}})()`);
  const type = (v) => js(`(()=>{const i=document.getElementById('mdIn');i.value=${JSON.stringify(v)};i.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  const openFromMore = async (id) => {
    await js(`document.querySelector('#stage [data-id="${id}"], #list [data-id="${id}"]').click()`); await ctx.sleep(500);
    await js(`document.getElementById('moreBtn').click()`); await ctx.sleep(200);
    await js(`document.getElementById('renameSessBtn').click()`); await ctx.sleep(300);
  };
  const closePanel = async () => { await js(`(()=>{const b=document.getElementById('backBtn');if(b)b.click();})()`); await ctx.sleep(300); };
  const names = (id) => js(`(()=>{const a=__durbarSimUi.agents().find(x=>x.id===${JSON.stringify(id)});const d=document.querySelector('#stage .desk[data-id="${id}"] .name');return {name:a.name,alias:a.alias||'',card:d?d.textContent:null,cardTip:d?d.getAttribute('title')||'':null}})()`);

  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    for (const level of ['expert', 'simple']) {
      ctx.win.setContentSize(w, h);
      await ctx.win.loadFile(INDEX, { query: Q });
      await ctx.waitFor(`document.getElementById('stage')&&document.getElementById('stage').dataset.fit`, 15000);
      await js(`localStorage.setItem('durbar.detail',${JSON.stringify(level)})`);
      await ctx.win.loadFile(INDEX, { query: Q });
      await ctx.waitFor(`document.getElementById('stage')&&document.getElementById('stage').dataset.fit`, 15000);
      await ctx.sleep(1800);
      const tag = `${w} ${level}`;
      ctx.win.show(); ctx.win.focus(); ctx.win.webContents.focus();
      assert.ok(await js(`document.body.classList.contains('simple')===${level === 'simple'}`), `${tag}: the detail level is on`);
      assert.strictEqual(await js(`window.__xss===undefined`), true);

      // 1. the dialog words per kind (sim-1 Claude, sim-5 Codex, sim-2 Copilot, sim-7 has no rename); Escape changes nothing
      const kinds = [['sim-1', /^Also saved in Claude Code at your next message.*may sync/, 'claude'], ['sim-5', /^Also saved in .*Codex.*may sync/, 'codex'], ['sim-2', /^Also saved in .*Copilot.*may sync/, 'copilot'], ['sim-7', /^Only in Agent Durbar\./, 'none']];
      for (const [id, re, kind] of kinds) {
        const before = await names(id);
        await openFromMore(id);
        const d = await dlg();
        assert.ok(d, `${tag}: ${kind}: the dialog is open`);
        assert.strictEqual(d.title, 'Rename session');
        assert.ok(re.test(d.lines[0]), `${tag}: ${kind}: dialog line "${d.lines[0]}"`);
        assert.ok(kind !== 'claude' || /\/resume list.*by its id/.test(d.lines[0]), `${tag}: the Claude line says where the name shows: ${d.lines[0]}`);
        assert.strictEqual(d.max, 60);
        assert.ok(d.focus && d.sel[0] === 0 && d.sel[1] === d.value.length, `${tag}: ${kind}: the field is focused and fully selected: ${JSON.stringify(d)}`);
        assert.deepStrictEqual(d.btns, ['Cancel', 'Rename*']);
        if (id === 'sim-1' && w === 1440 && level === 'expert') await shot('059-rename-dialog-1440x900.png');
        if (id === 'sim-1' && w === 1280 && level === 'simple') await shot('059-rename-dialog-simple-1280x800.png');
        await type('Not saved');
        await key('Escape'); await ctx.sleep(250);
        assert.strictEqual(await js(`!document.getElementById('modeDlg')`), true, `${tag}: Escape closes`);
        assert.strictEqual(await js(`document.activeElement&&document.activeElement.id`), 'moreBtn', `${tag}: ${kind}: focus returns to More`);
        assert.deepStrictEqual(await names(id), before, `${tag}: ${kind}: Escape changed nothing`);
        await closePanel();
      }

      // 2. a refused name keeps the dialog open with the reason; an empty name is allowed
      await openFromMore('sim-1');
      await type('x'.repeat(61)); await key('Enter'); await ctx.sleep(200);
      let d = await dlg();
      assert.ok(d && d.err === 'Use 1 to 60 characters.' && d.focus, `${tag}: a 61-character name is refused under the field: ${JSON.stringify(d)}`);
      await type('bad\u0007name'); await key('Enter'); await ctx.sleep(200);
      d = await dlg();
      assert.ok(d && d.err === 'Remove control or hidden characters.', `${tag}: control characters are refused: ${JSON.stringify(d)}`);
      await type('ghp_abcdefghijklmnopqrstuvwxyz0123456789'); await key('Enter'); await ctx.sleep(200);
      d = await dlg();
      assert.ok(d && /secret/.test(d.err), `${tag}: a token-looking name is refused: ${JSON.stringify(d)}`);

      // 3. an HTML-looking name: saved with Enter, shown as text everywhere, nothing runs
      const runtimeTitle = (await names('sim-1')).name; // the sim title of the first agent
      await type(EVIL); await key('Enter'); await ctx.sleep(400);
      assert.strictEqual(await js(`!document.getElementById('modeDlg')`), true, `${tag}: Enter saves and closes`);
      const n1 = await names('sim-1');
      assert.strictEqual(n1.alias, EVIL, `${tag}: the alias is the typed text`);
      assert.strictEqual(n1.name, EVIL);
      const hdr = await js(`(()=>{const h=document.getElementById('panelTitle');return {text:h.textContent,tip:h.getAttribute('title')||'',aria:document.getElementById('chat').getAttribute('aria-label')}})()`);
      assert.strictEqual(hdr.text, EVIL, `${tag}: the header shows the name as text`);
      assert.ok(hdr.tip.startsWith(EVIL) && (runtimeTitle === EVIL || !hdr.tip.includes(runtimeTitle) || runtimeTitle.length < 3), `${tag}: the header tooltip has the name and not the runtime title: ${hdr.tip}`);
      assert.strictEqual(hdr.aria, 'Chat with ' + EVIL);
      // strip (the other sessions of the panel) and the card behind
      const strip = await js(`(()=>{const s=document.querySelector('[data-sw="sim-1"] b');return s?s.textContent:null})()`);
      assert.ok(strip === EVIL, `${tag}: the strip shows the name as text: ${strip}`);
      // Schedules: the option and the list use the name, cut to 40 with the full name in the tooltip
      if (await js(`!!document.getElementById('schedHdrBtn')`)) {
        await js(`document.getElementById('moreBtn').click()`); await ctx.sleep(150);
        await js(`document.getElementById('schedHdrBtn').click()`); await ctx.sleep(400);
        const sc = await js(`(()=>{const o=document.querySelector('#scTarget option[value]:not([value=""])');return o?{t:o.textContent,tip:o.title}:null})()`);
        assert.ok(sc && sc.t === 'This session (' + EVIL + ')' && sc.tip === EVIL, `${tag}: the Schedules option: ${JSON.stringify(sc)}`);
        await js(`document.getElementById('scClose').click()`); await ctx.sleep(200);
      }
      await closePanel(); await ctx.sleep(300);
      const n1b = await names('sim-1');
      assert.strictEqual(n1b.card, EVIL, `${tag}: the desk card shows the name as text: ${JSON.stringify(n1b)}`);
      assert.ok(!n1b.cardTip.includes('Fix login bug') && n1b.cardTip.startsWith(EVIL), `${tag}: the card tooltip has the name, no runtime title: ${n1b.cardTip}`);
      // list view
      await js(`document.getElementById('vList').click()`); await ctx.sleep(500);
      const lrow = await js(`(()=>{const r=document.querySelector('.lrow[data-id="sim-1"]');return r?r.textContent:null})()`);
      assert.ok(lrow !== null && lrow.includes(EVIL), `${tag}: the list row shows the name: ${lrow}`);
      await js(`document.getElementById('vOffice')&&document.getElementById('vOffice').click()`); await ctx.sleep(400);
      // nothing came from the markup
      const bad = await js(`({img:document.querySelectorAll('img[src="x"]').length,xss:window.__xss!==undefined})`);
      assert.deepStrictEqual(bad, { img: 0, xss: false }, `${tag}: the name made no element and ran nothing`);
      if (level === 'expert') await shot(`059-rename-done-${w}x${h}.png`);

      // 4. an empty name resets to the runtime's title; a 60-character name fits the header
      await openFromMore('sim-1');
      await type(''); await key('Enter'); await ctx.sleep(400);
      let n2 = await names('sim-1');
      assert.ok(n2.alias === '' && n2.name !== EVIL, `${tag}: an empty name resets: ${JSON.stringify(n2)}`);
      await closePanel();
      await openFromMore('sim-1');
      await type(LONG); await key('Enter'); await ctx.sleep(400);
      assert.strictEqual([...LONG].length, 60);
      const fit = await js(`(()=>{const R=e=>e.getBoundingClientRect();const t=R(document.getElementById('panelTitle')),a=R(document.querySelector('#panelHead .actions'));return {titleRight:t.right,actLeft:a.left,overlap:t.right>a.left+0.5&&t.bottom>R(document.querySelector('#panelHead .actions')).top&&t.top<R(document.querySelector('#panelHead .actions')).bottom,inView:t.right<=innerWidth}})()`);
      assert.ok(!fit.overlap && fit.inView, `${tag}: the 60-character name fits the header: ${JSON.stringify(fit)}`);
      await closePanel();

      // 5. the card menu has Rename…
      await js(`document.querySelector('#stage .desk[data-id="sim-2"]').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:300,clientY:300}))`); await ctx.sleep(300);
      assert.strictEqual(await js(`!!document.querySelector('#modeMenu [data-op="rename"]')`), true, `${tag}: the card menu offers Rename…`);
      await js(`document.querySelector('#modeMenu [data-op="rename"]').click()`); await ctx.sleep(300);
      d = await dlg();
      assert.ok(d && d.title === 'Rename session', `${tag}: the card menu opens the same dialog`);
      await type('From the card'); await key('Enter'); await ctx.sleep(400);
      assert.strictEqual((await names('sim-2')).card, 'From the card', `${tag}: renamed from the card menu`);
      // a failure of the agent app is a note, the name is still saved
      await js(`window.__simRenameFail='refused by the app'`);
      await js(`document.querySelector('#stage .desk[data-id="sim-2"]').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:300,clientY:300}))`); await ctx.sleep(300);
      await js(`document.querySelector('#modeMenu [data-op="rename"]').click()`); await ctx.sleep(300);
      await type('Kept in Durbar'); await key('Enter'); await ctx.sleep(500);
      assert.strictEqual((await names('sim-2')).card, 'Kept in Durbar');
      assert.ok(await js(`[...document.querySelectorAll('.toast')].some(t=>/Renamed in Agent Durbar only\\./.test(t.textContent)&&/refused by the app/.test(t.textContent))`), `${tag}: the partial result is a toast`);

      // 6. Previous sessions rows (the row menu is spec 006 FR-027; here the function it calls)
      const pa = await js(`(()=>{const a=__durbarSimUi.agents().find(x=>x.live&&!x.parent&&x.info&&x.info.cwd==='~/work/mcp-swiss');return a?a.id:null})()`);
      assert.ok(pa, `${tag}: an agent in the folder with Previous sessions`);
      await js(`document.querySelector('#stage [data-id="${pa}"]').click()`); await ctx.sleep(700);
      await js(`(()=>{const b=document.getElementById('prevBtn');if(b&&b.getAttribute('aria-expanded')!=='true')b.click();})()`); await ctx.sleep(400);
      await js(`setTimeout(()=>__durbarSimUi.renamePrevRow(__durbarSimUi.agents().find(x=>x.id===${JSON.stringify(pa)}),'prev-1',document.getElementById('prevBtn')),0)`); await ctx.sleep(400);
      d = await dlg();
      assert.ok(d && d.value === 'Rename the filings handler and update its tests'.slice(0, 60), `${tag}: the row dialog starts from the row title: ${JSON.stringify(d)}`);
      await type(EVIL); await key('Enter'); await ctx.sleep(500);
      const row = await js(`(()=>{const r=[...document.querySelectorAll('.prev-row .prev-t')].find(b=>b.textContent===${JSON.stringify(EVIL)});return r?r.parentElement.getAttribute('title'):null})()`);
      assert.strictEqual(row, EVIL, `${tag}: the Previous row shows the name as text`);
      assert.strictEqual(await js(`document.querySelectorAll('img[src="x"]').length`), 0);
      await js(`(()=>{const q=document.getElementById('prevQ');if(q){q.value='onerror';q.dispatchEvent(new Event('input',{bubbles:true}));}})()`); await ctx.sleep(300);
      assert.ok(await js(`[...document.querySelectorAll('.prev-row .prev-t')].some(b=>b.textContent===${JSON.stringify(EVIL)})`), `${tag}: the search finds the row by its name`);
      await js(`(()=>{const q=document.getElementById('prevQ');if(q){q.value='';q.dispatchEvent(new Event('input',{bubbles:true}));}})()`);
      await closePanel();
      console.log(`[rename] ${tag} ok`);
    }
  }
  console.log('[rename] all checks passed');
};
