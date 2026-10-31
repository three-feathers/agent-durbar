/*
 * Spec 001 FR-187 (issue #875): the status counts of the top bar show an instant, app-drawn tooltip on hover and on keyboard focus. Simulator
 * only (no AI credits, no agent app). Linux with xvfb-run:
 *
 *   npm run check:ui -- --only check-status-tooltip
 *
 * At 1440x900 and 1280x800 (SIM=15), for each of the five counts: a real mouse move shows the tooltip at once (a few polls, not the system's
 * delay), with the state, the count read from the pill and "Click to show only these."; the tooltip is role=tooltip, the pill's accessible
 * description (aria-describedby) while it is shown, at least 10.5px, inside the window and not over the pill; the pills carry no native
 * title text. Moving away hides it. Keyboard: Tab to a pill shows it, Escape hides it (and is used up: the pill keeps focus, no chat closes)
 * and it stays hidden until focus returns. Click hides it and turns the filter on; hovering again says "Click to show all."; the count's
 * redraw (folder filter) while it is shown updates its text; the pill going away hides it; scroll, window blur and resize hide it. Then the
 * same check (shown, inside, clear, contrast 4.5:1 for 12px text) in every built-in theme, a dark user theme and Serious mode. Every wait is
 * until() and its result is asserted. A miss prints DRIVER FAILED (Electron still exits 0), so the check is "all checks passed" printed.
 *   OUT=docs/screenshots  (optional) also saves 001-status-tooltip-{1440x900,1280x800}.png
 */
const assert = require('assert');
const path = require('path');
const { helpers, jsLiteral } = require('./driver-helpers');
const OUT = process.env.OUT || require('os').tmpdir();
const KEYS = ['working', 'waiting', 'idle', 'error', 'done'];
const MEANING = { working: ['working or thinking', 'working or thinking'], waiting: ['waiting for you', 'waiting for you'], idle: ['idle or paused', 'idle or paused'], error: ['with an error', 'with errors'], done: ['done', 'done'] };
const NAME = { working: 'Working', waiting: 'Waiting', idle: 'Idle', error: 'Error', done: 'Done' };
// an independent copy of the wording, so a change in tooltip.js is caught here
const expected = (k, n, on) => `${NAME[k]} · ${n} ${n === 1 ? 'agent' : 'agents'} ${MEANING[k][n === 1 ? 0 : 1]}. ${on ? 'Click to show all.' : 'Click to show only these.'}`;
// a dark user theme (tokens only, the one shots-043-editor uses): no built-in theme has a dark surface
const NIGHT = { id: 'night-tip', name: 'Night (tip check)', extends: 'clean-office', tokens: { '--bg': '#14171c', '--surface': '#1d2127', '--surface-2': '#262b33', '--raised': '#22272e', '--card': '#1d2127', '--soft': '#20252c', '--note': '#2a2f37', '--warn-bg': '#3a3020', '--line': '#3a414c', '--line-2': '#4b5361', '--line-ctl': '#5a6372', '--ink': '#e8eaee', '--ink-2': '#c4c9d1', '--muted': '#9aa2ae', '--blue-ink': '#8fb8ff', '--amber-ink': '#f0c36a', '--card-waiting-line': '#7a6330', '--card-waiting': '#2b2618', '--card-error': '#2e1c1c' } };

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { js, until } = H;
  const ok = async (expr, what, ms) => assert.ok(await until(expr, ms || 6000), what);
  const pill = (k) => `.stat[data-k="${k}"]`;
  const wc = () => H.wc();
  const rectOf = (k) => js(`(()=>{const r=document.querySelector(${jsLiteral(pill(k))}).getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}})()`);
  const move = async (x, y) => { wc().sendInputEvent({ type: 'mouseMove', x, y }); };
  // mouse moves sent back to back are merged by the page, so each move waits until the page has seen it (:hover)
  const away = async () => { await move(1, 1); await ok(`!document.querySelector('#stats .stat[data-k]:hover')`, 'the pointer left the counts', 3000); };
  const hover = async (k) => {
    for (let i = 0; i < 4; i++) { // the first moves can be lost while the OS activates the window
      const p = await rectOf(k); await move(p.x - 1, p.y); await move(p.x, p.y);
      if (await until(`document.querySelector(${jsLiteral(pill(k))}).matches(':hover')`, 1500)) return;
    }
    assert.fail(`the pointer never reached the ${k} count`);
  };
  const click = async (k) => { await hover(k); const p = await rectOf(k); wc().sendInputEvent({ type: 'mouseDown', x: p.x, y: p.y, button: 'left', clickCount: 1 }); wc().sendInputEvent({ type: 'mouseUp', x: p.x, y: p.y, button: 'left', clickCount: 1 }); };
  const shown = `(()=>{const t=document.getElementById('appTip');return !!t&&!t.hidden&&t.getClientRects().length>0})()`;
  const hidden = `(()=>{const t=document.getElementById('appTip');return !t||t.hidden||!t.getClientRects().length})()`;
  // Windows runners: the OS can take the window's focus or move it at any moment, and the tooltip rightly hides on a window blur, resize or
  // scroll (FR-187), so a step that fails is tried again (up to 3 times) only when such a trusted event came; with none it fails at once
  const osWatch = () => js(`(()=>{window.__osEv=[];if(!window.__osWatch){window.__osWatch=1;['blur','resize','scroll'].forEach(t=>window.addEventListener(t,e=>{if(e.isTrusted&&(t!=='blur'||e.target===window))window.__osEv.push(t);},true));}})()`);
  const osEvents = () => js(`(window.__osEv||[]).join(',')`);
  const focusWin = async () => { for (let i = 0; i < 20 && !(await js(`document.hasFocus()`)); i++) { ctx.win.show(); ctx.win.focus(); wc().focus(); await ctx.sleep(150); } }; // a window the OS did not activate has no :focus-visible
  const osRetry = async (what, fn) => {
    for (let i = 0; ; i++) {
      await focusWin(); await osWatch();
      try { return await fn(); } catch (e) {
        const ev = await osEvents();
        if (!ev || i === 2) assert.fail(`${e.message} ${ev ? `(the OS took the window on 3 tries: ${ev})` : '(no window blur, resize or scroll came)'}`);
        console.log(`[statustip] ${what}: the OS took the window (${ev}), trying again`);
        await away();
      }
    }
  };
  const hoverShown = (k, what) => osRetry(what, async () => { await hover(k); await ok(shown, what, 1500); }); // at once: no system delay, a poll or two
  const tipText = () => js(`document.getElementById('appTip').textContent`);
  const count = (k) => js(`+document.querySelector(${jsLiteral(pill(k) + ' b')}).textContent`);
  const on = (k) => js(`document.querySelector(${jsLiteral(pill(k))}).getAttribute('aria-pressed')==='true'`);
  const geo = (k) => js(`(()=>{const t=document.getElementById('appTip'),r=t.getBoundingClientRect(),p=document.querySelector(${jsLiteral(pill(k))}).getBoundingClientRect(),cs=getComputedStyle(t);
    const rgb=c=>c.match(/[\\d.]+/g).map(Number);const lum=c=>{const [r,g,b]=c.map(v=>{v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4);});return 0.2126*r+0.7152*g+0.0722*b;};
    const a=lum(rgb(cs.color).slice(0,3)),b=lum(rgb(cs.backgroundColor).slice(0,3));
    return {l:r.left,t:r.top,r:r.right,b:r.bottom,w:innerWidth,h:innerHeight,pl:p.left,pt:p.top,pr:p.right,pb:p.bottom,font:parseFloat(cs.fontSize),role:t.getAttribute('role'),desc:document.querySelector(${jsLiteral(pill(k))}).getAttribute('aria-describedby'),
      ratio:Math.round((Math.max(a,b)+0.05)/(Math.min(a,b)+0.05)*100)/100,alpha:rgb(cs.backgroundColor)[3]===undefined?1:rgb(cs.backgroundColor)[3],pe:cs.pointerEvents,tr:cs.transitionDuration,an:cs.animationName}})()`);
  const checkGeo = (g, k, what) => {
    assert.ok(g.l >= 0 && g.t >= 0 && g.r <= g.w && g.b <= g.h, `${what}: inside the window: ${JSON.stringify(g)}`);
    assert.ok(g.r <= g.pl || g.l >= g.pr || g.b <= g.pt || g.t >= g.pb, `${what}: does not cover the ${k} pill: ${JSON.stringify(g)}`);
    assert.ok(g.font >= 10.5, `${what}: text at least 10.5px: ${g.font}`);
    assert.strictEqual(g.role, 'tooltip', `${what}: role=tooltip`);
    assert.strictEqual(g.desc, 'appTip', `${what}: the pill is described by the tooltip`);
    assert.ok(g.ratio >= 4.5, `${what}: contrast ${g.ratio}:1 is below 4.5:1`);
    assert.ok(g.alpha >= 0.99, `${what}: the tooltip background is opaque`);
    assert.strictEqual(g.pe, 'none', `${what}: the tooltip never takes the pointer`);
    assert.ok(g.tr === '0s' && g.an === 'none', `${what}: no motion (reduced motion needs no branch): ${g.tr} ${g.an}`);
  };

  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    const tag = `${w}x${h}`;
    await H.load({ w, h, focus: true });
    await H.calm({ blur: true });
    await away();
    await ok(hidden, `${tag}: no tooltip at rest`);
    // no native title text on the five pills, and the empty title stops the group's own title from showing on them
    assert.deepStrictEqual(await js(`[...document.querySelectorAll('#stats .stat[data-k]')].map(b=>b.getAttribute('title'))`), ['', '', '', '', ''], `${tag}: the pills have no native tooltip text`);
    assert.ok(await js(`!!document.getElementById('stats').getAttribute('title')`), `${tag}: the group keeps its own title for its gaps`);
    assert.ok(await js(`[...document.querySelectorAll('#stats .stat[data-k]')].every(b=>/^[A-Za-z]+: \\d+$/.test(b.getAttribute('aria-label')))`), `${tag}: each pill keeps an accessible name with the state and the count`);
    assert.strictEqual(await js(`document.querySelectorAll('[title*="Show only agents"]').length`), 0, `${tag}: the old native wording is gone`);

    // hover: each count, at once, with its state and count; moving away hides it
    for (const k of KEYS) {
      await hoverShown(k, `${tag}: hovering ${k} shows the tooltip`);
      const n = await count(k);
      assert.strictEqual(await tipText(), expected(k, n, false), `${tag}: ${k} text: ${await tipText()}`);
      checkGeo(await geo(k), k, `${tag} ${k} hover`);
      await away();
      await ok(hidden, `${tag}: leaving ${k} hides it`);
      assert.strictEqual(await js(`document.querySelector(${jsLiteral(pill(k))}).hasAttribute('aria-describedby')`), false, `${tag}: ${k}: the description goes with the tooltip`);
    }

    // keyboard focus: Tab to a pill, Escape, and it stays hidden until focus returns
    await osRetry(`${tag}: keyboard`, async () => {
      await js(`document.activeElement&&document.activeElement.blur&&document.activeElement.blur();document.body.focus()`);
      await focusWin();
      assert.ok(await js(`document.hasFocus()`), `${tag}: the page has focus`);
      let k0 = null;
      for (let i = 0; i < 40 && !k0; i++) { await H.key('Tab', [], { pause: 40 }); k0 = await js(`(document.activeElement&&document.activeElement.matches&&document.activeElement.matches('#stats .stat[data-k]'))?document.activeElement.dataset.k:null`); }
      assert.ok(k0, `${tag}: Tab reaches a status count`);
      await ok(shown, `${tag}: keyboard focus on ${k0} shows the tooltip`, 1500);
      assert.strictEqual(await tipText(), expected(k0, await count(k0), await on(k0)), `${tag}: focus text`);
      checkGeo(await geo(k0), k0, `${tag} ${k0} focus`);
      await js(`window.__escSeen=0;window.__escCount=window.__escCount||(window.addEventListener('keydown',e=>{if(e.key==='Escape')window.__escSeen++;}),true)`);
      await H.key('Escape', [], { pause: 60 });
      await ok(hidden, `${tag}: Escape hides the tooltip`);
      assert.strictEqual(await js(`window.__escSeen`), 0, `${tag}: that Escape is used up (it never reaches the window, so no panel closes)`);
      await H.key('Escape', [], { pause: 60 });
      assert.ok(await until(`window.__escSeen===1`, 1500), `${tag}: with no tooltip shown, Escape reaches the window as usual (the listener works)`);
      assert.strictEqual(await js(`document.activeElement.dataset.k`), k0, `${tag}: Escape leaves focus on the pill`);
      await js(`document.activeElement.blur()`); // focus away and back
      await ok(hidden, `${tag}: focus elsewhere: no tooltip`);
      await js(`document.querySelector(${jsLiteral(pill(k0))}).focus()`);
      await ok(shown, `${tag}: focus returns to ${k0}: the tooltip shows again`, 1500);
      await H.key('Tab', [], { pause: 60 }); // on to the next pill or control: the tooltip follows focus
      await ok(`(()=>{const a=document.activeElement;return a&&a.dataset&&a.dataset.k&&a.dataset.k!==${jsLiteral(k0)}?document.getElementById('appTip').textContent.startsWith((a.dataset.k[0].toUpperCase()+a.dataset.k.slice(1))+' · '):document.getElementById('appTip').hidden})()`, `${tag}: Tab moves the tooltip to the next pill or hides it`);
      await js(`document.activeElement.blur()`);
      await ok(hidden, `${tag}: blur hides it`);
    });

    // click hides it and turns the filter on; hovering again says Click to show all
    await click('idle');
    await ok(`document.querySelector(${jsLiteral(pill('idle'))}).getAttribute('aria-pressed')==='true'`, `${tag}: the click turns the Idle filter on`);
    await ok(hidden, `${tag}: the click hides the tooltip`);
    await H.settle();
    await away();
    await hoverShown('idle', `${tag}: hovering the filtered pill shows the tooltip`);
    assert.strictEqual(await tipText(), expected('idle', await count('idle'), true), `${tag}: filter-on text: ${await tipText()}`);
    // a redraw while shown (the folder filter changes the counts): new text, still shown, still clear of the pill
    const opt = await js(`(()=>{const o=[...document.querySelectorAll('#wsFilter option')].find(x=>x.value!=='all');return o?o.value:null})()`);
    if (opt) {
      await osRetry(`${tag}: redraw`, async () => { // from the filter 'all': hover, then the redraw
        await js(`(()=>{const s=document.getElementById('wsFilter');s.value='all';s.dispatchEvent(new Event('change'))})()`);
        await H.settle();
        await hover('idle');
        await ok(shown, `${tag}: shown before the redraw`, 1500);
        await js(`(()=>{const s=document.getElementById('wsFilter');s.value=${jsLiteral(opt)};s.dispatchEvent(new Event('change'))})()`);
        await H.settle();
        await ok(shown, `${tag}: still shown after the top bar redrew`);
      });
      assert.strictEqual(await tipText(), expected('idle', await count('idle'), await on('idle')), `${tag}: the text follows the redraw: ${await tipText()}`);
      checkGeo(await geo('idle'), 'idle', `${tag} after redraw`);
      await js(`(()=>{const s=document.getElementById('wsFilter');s.value='all';s.dispatchEvent(new Event('change'))})()`);
      await H.settle();
    }
    await away();
    await ok(hidden, `${tag}: leaving hides it`);
    await click('idle');
    await ok(`document.querySelector(${jsLiteral(pill('idle'))}).getAttribute('aria-pressed')==='false'`, `${tag}: the second click turns the filter off`);
    await away();

    // never sticks: scroll, window blur, resize, the pill going away
    for (const [what, code] of [['scroll', `document.getElementById('floor').dispatchEvent(new Event('scroll'))`], ['window blur', `window.dispatchEvent(new Event('blur'))`], ['resize', `window.dispatchEvent(new Event('resize'))`]]) {
      await away(); await hoverShown('waiting', `${tag}: shown before ${what}`);
      await js(code);
      await ok(hidden, `${tag}: ${what} hides it`);
    }
    await away(); await hoverShown('done', `${tag}: shown before the pill goes away`);
    // read in the same page task as the removal: the simulator redraws the counts on its own clock, and the pill that comes back under a
    // still pointer may rightly show its tooltip again, so a later poll would race that redraw (flaked 4 of 6 runs on Linux)
    assert.ok(await js(`(()=>{document.querySelector(${jsLiteral(pill('done'))}).remove();window.DurbarTip.refresh();const t=document.getElementById('appTip');return !t||t.hidden})()`), `${tag}: a pill that is gone takes its tooltip with it`);

    // the picture
    await H.load({ w, h });
    await H.calm({ blur: true });
    await hoverShown('idle', `${tag}: shown for the picture`);
    await H.shot(path.join(OUT, `001-status-tooltip-${tag}.png`), { prep: 'none', settle: false, tag: 'statustip' });
    await away();
    console.log(`[statustip] ${tag} ok`);
  }

  // every built-in theme, a dark user theme and Serious mode: shown, inside, clear, contrast
  await H.load({ w: 1280, h: 800 });
  await H.calm({ blur: true });
  const themes = ['clean-office', 'retro'];
  for (const theme of themes) {
    await js(`window.THEME.setTheme(${jsLiteral(theme)})`);
    await ok(`window.THEME.current().id===${jsLiteral(theme)}`, theme + ' applied');
    await H.settle();
    for (const k of ['idle', 'error']) {
      await away(); await hoverShown(k, `${theme}: ${k} shows the tooltip`);
      const g = await geo(k);
      checkGeo(g, k, `${theme} ${k}`);
      console.log(`[statustip] ${theme} ${k}: contrast ${g.ratio}:1`);
    }
  }
  await js(`window.THEME.setTheme(${jsLiteral(NIGHT)})`);
  await ok(`window.THEME.current().id==='night-tip'`, 'the dark theme applied');
  await H.settle();
  await away(); await hoverShown('waiting', 'dark theme: the tooltip shows');
  checkGeo(await geo('waiting'), 'waiting', 'dark theme');
  console.log(`[statustip] dark theme: contrast ${(await geo('waiting')).ratio}:1`);
  await away();
  await js(`window.THEME.setTheme('clean-office')`);
  await H.settle();
  // Serious mode
  await H.click('#settingsBtn');
  await ok(`!!document.getElementById('seriousSw')`, 'Settings shows the Serious mode switch');
  if (!(await js(`document.getElementById('seriousSw').getAttribute('aria-checked')==='true'`))) await H.click('#seriousSw');
  await ok(`document.getElementById('seriousSw').getAttribute('aria-checked')==='true'`, 'Serious mode on');
  await H.click('#scrClose');
  await ok(`!document.getElementById('seriousSw')||!document.getElementById('seriousSw').getClientRects().length`, 'Settings closes');
  assert.ok(await js(`document.documentElement.hasAttribute('data-serious')`), 'Serious mode is on');
  await away(); await hoverShown('idle', 'Serious mode: the tooltip shows');
  checkGeo(await geo('idle'), 'idle', 'Serious mode');
  console.log('[statustip] all checks passed');
};
