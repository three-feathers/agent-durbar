/*
 * Spec 008 FR-096: simulator drivers wait for what they need instead of sleeping a fixed time. A fixed delay is too long on a fast
 * machine and too short on a slow CI runner (macOS); these waits end as soon as the page is ready and give a slow runner time.
 *
 *   const { waits } = require('./driver-helpers');
 *   const { until, settle, office, chatOf } = waits(ctx);
 *
 * `until` never throws: on a timeout it returns false and the driver's own assertion that follows reports what is wrong, so a wait
 * can never hide or weaken a check. Expressions run in the page.
 *
 * Spec 008 FR-097: the other plumbing the drivers repeated lives here too (`helpers(ctx)`: js, click, clickText, key, load, shot ...), so
 * one fix reaches every driver. Nothing here asserts; a driver's own checks stay in the driver.
 */
/* A value as a JavaScript literal that is safe to splice into code run in the page: JSON, with the characters that could end a
   script or a string in some contexts escaped (CodeQL js/bad-code-sanitization; the recommended escaping). Every value put into page code goes through it. */
const UNSAFE = { '<': '\\u003C', '>': '\\u003E', '/': '\\u002F', '\u2028': '\\u2028', '\u2029': '\\u2029' };
const jsLiteral = (v) => JSON.stringify(v).replace(/[<>/\u2028\u2029]/g, (c) => UNSAFE[c]);

const fs = require('fs');
const path = require('path');
/* spec 102 T226 (FR-267): the fixture user theme with a dark page and its own display font; it takes Retro Pixel's place as the second theme of the layout checks.
   CHECK_DARK is the manifest, CHECK_DARK_QUERY loads it in the simulator (`theme` + `usertheme`), and `window.THEME.setTheme(CHECK_DARK)` switches to it in a loaded page. */
const CHECK_DARK = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'themes', 'check-dark.json'), 'utf8'));
const CHECK_DARK_QUERY = { theme: CHECK_DARK.id, usertheme: JSON.stringify(CHECK_DARK) };
/* spec 102 T226: a run that says "dark" must be on the dark fixture: the theme on screen is `check-dark` and the page (`--bg`) is an opaque fill with luminance under 0.2.
   A transparent or unparsable `--bg` is not dark (review of PR #1276, B). `darkProblem` judges what the page reported; `darkFixtureProblem` reads it. Both return the problem text, or '' when it is right. */
function darkProblem(on) {
  if (on.id !== CHECK_DARK.id) return `the dark run is on theme "${on.id}", not the fixture "${CHECK_DARK.id}"`;
  const v = /^rgba?\(/.test(String(on.bg)) ? (String(on.bg).match(/\d+(\.\d+)?/g) || []).map(Number) : [];
  const alpha = v.length === 3 ? 1 : v.length === 4 ? v[3] : NaN; /* rgb() has none; rgba() carries it as the fourth number */
  if (!(v.length === 3 || v.length === 4) || !(alpha >= 0.9)) return `the dark run's page is not an opaque fill (--bg ${on.bg})`;
  const lum = (0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]) / 255;
  if (!(lum < 0.2)) return `the dark run's page is not dark (--bg ${on.bg}, luminance ${lum.toFixed(2)})`;
  return '';
}
async function darkFixtureProblem(ctx) {
  return darkProblem(await ctx.js(`(()=>{const e=document.createElement('i');e.style.cssText='position:fixed;background:var(--bg)';document.body.appendChild(e);const c=getComputedStyle(e).backgroundColor;e.remove();return {id:window.THEME.current().id,bg:c}})()`));
}
const LIMIT = 8000;
const INDEX = path.join(__dirname, '..', 'dist', 'renderer', 'index.html');

function waits(ctx) {
  guardWindow(ctx.win); // spec 008 FR-136: a driver whose window closes fails (every driver uses waits or helpers)
  /** Wait until the page expression is truthy (polled every 50 ms), at most `ms`. */
  const until = async (expr, ms = LIMIT) => {
    const end = Date.now() + ms;
    for (;;) {
      if (await ctx.js(`(()=>{try{return !!(${expr})}catch(e){return false}})()`)) return true;
      if (Date.now() > end) {
        console.log(`[waits] timed out after ${ms} ms: ${String(expr).replace(/\s+/g, ' ').slice(0, 160)}`);
        return false;
      }
      await ctx.sleep(50);
    }
  };
  /** Wait until the page stops changing: the same element count and text size twice in a row, 200 ms apart (at most `ms`). */
  const settle = async (ms = LIMIT) => {
    const end = Date.now() + ms;
    let prev = '';
    for (;;) {
      const now = await ctx.js(`document.querySelectorAll('*').length+':'+document.body.innerText.length`);
      if (now === prev || Date.now() > end) return;
      prev = now;
      await ctx.sleep(200);
    }
  };
  /** The office is shown (no chat panel) with at least `n` desks, and it has stopped changing. */
  const office = async (n = 1) => {
    await until(`!document.body.classList.contains('panel-open')&&document.querySelectorAll('#stage .desk[data-id]').length>=${Number(n)}`);
    await settle();
  };
  /** The chat of the agent named `name` is open, and it has stopped changing. */
  const chatOf = async (name) => {
    await until(`document.body.classList.contains('panel-open')&&(document.getElementById('panelTitle')||{}).textContent===${jsLiteral(String(name))}`);
    await settle();
  };
  /** Spec 001 FR-085: no lobby figure is mid-walk (the 1 s WALK_MS transition of `syncWalkers` marks a figure `.walking`), at most `ms`.
   *  Used by `calm` and every `shot`, so no screenshot catches a figure between two places. */
  const settleWalk = (ms = 6000) => until(`!document.querySelector('.walker.walking')`, ms);
  /** The page is ready after a simulator replay (`simfreeze=1`): replayed, the lobby's visits settled, the last render drawn and no scene transition running. `load`'s settle and
   *  check-097-crews' wait (issue #1459) use this one expression, so they cannot drift apart. */
  const SETTLED = `!!window.__durbarSimReplayed&&!!window.__durbarSimUi&&window.__durbarSimUi.visitsSettled()&&window.__durbarSimUi.settleNow()&&!document.querySelector('.scene-out')`;
  return { until, settle, settleWalk, office, chatOf, SETTLED };
}


/**
 * Spec 008 FR-136 (issue #922): a driver whose window closes fails. On Windows and Linux a closed window quits the app with exit 0
 * (`window-all-closed`) before the driver's next assertion runs, and ui-suite counted that as a pass. `waits(ctx)` (so every driver, since `helpers(ctx)`
 * calls it) fails the run when the window closes and main's `window-all-closed` fires. The driver's normal end (main's `app.exit`) closes the window
 * too but quits without that event, so it stays a pass. A driver that closes its window on purpose calls the returned `allow()` before it does. On a Mac a close only hides the
 * window (appmenu.ts hideOnClose), so there is nothing to catch. `fail` is injectable for the unit test.
 */
const guards = new WeakMap();
function guardWindow(win, fail = failDriver, appLike = null) {
  if (!win || typeof win.once !== 'function') return { allow() {} };
  if (guards.has(win)) return guards.get(win);
  let allowed = false, closed = false;
  const g = { allow() { allowed = true; } };
  guards.set(win, g);
  const gone = () => { if (!allowed) fail('DRIVER FAILED AssertionError: the window closed before the driver finished (spec 008 FR-136)'); };
  /* The verdict waits for main's `window-all-closed`, which only a real close emits: the driver's normal end (`app.exit`) closes the window too, but quits
     without that event, and must stay a pass. */
  const app = appLike || require('electron').app;
  win.once('closed', () => { closed = true; });
  app.on('window-all-closed', () => { if (closed || (typeof win.isDestroyed === 'function' && win.isDestroyed())) gone(); });
  return g;
}
function failDriver(message) {
  console.error(message);
  require('electron').app.exit(1);
}

/**
 * Spec 097 delta 2026-11-11 (issue #1448): a diagnostic, nothing else. `pointerLog(ctx)` records the pointer events the page receives during a
 * pointer-dependent step into a ring of the last POINTER_LOG_MAX events (capture-phase listeners on window), and `step(driver, name, fn)` runs the
 * step: when `fn` fails with an AssertionError the ring is printed (`[pointer-log] <driver> <step>: N events`, one line per event) and the SAME error is
 * thrown again; a pass prints nothing. It never retries, waits, moves the pointer or changes a limit, and a failed arm or read (a reloaded or closed page)
 * is ignored, so a driver passes and fails as it did. Only type, position, buttons, isTrusted and the time since the step began are kept: no page text.
 * `DIAG_FORCE_FAIL=1` (or a part of a step name) makes the first matching step fail once after it ran, to see the output.
 * Spec 033 delta 2026-11-11 (issue #1526): `step(driver, name, fn, { dom: '<selector>' })` also records the DOM mutations (childList, attributes, subtree) of that
 * element into a ring of the last DOM_LOG_MAX and prints them in a `[dom-log]` block before the pointer block, on a failure only: milliseconds since the step began, the
 * kind (c = childList, a = attributes), the target's tag and first class (cut at 16 characters) and the counts of added and removed nodes. No text, no attribute values.
 */
const POINTER_LOG_MAX = 200;
const DOM_LOG_MAX = 100;
const POINTER_TYPES = ['pointermove', 'pointerdown', 'pointerup', 'pointercancel', 'pointerover', 'pointerout', 'pointerenter', 'pointerleave', 'mousemove', 'mousedown', 'mouseup', 'mouseenter', 'mouseleave'];
const POINTER_SHORT = { pointermove: 'pm', pointerdown: 'pd', pointerup: 'pu', pointercancel: 'pc', pointerover: 'po', pointerout: 'pt', pointerenter: 'pe', pointerleave: 'pl', mousemove: 'mm', mousedown: 'md', mouseup: 'mu', mouseenter: 'me', mouseleave: 'ml' };
const POINTER_ARM = `(()=>{const w=window,L=w.__ptrLog=w.__ptrLog||{ev:[],t0:0};
  if(!w.__ptrLogOn){w.__ptrLogOn=1;for(const t of ${JSON.stringify(POINTER_TYPES)})w.addEventListener(t,(e)=>{const E=L.ev;E.push({type:e.type,x:Math.round(e.clientX),y:Math.round(e.clientY),buttons:e.buttons,trusted:e.isTrusted,at:performance.now()});if(E.length>${POINTER_LOG_MAX})E.splice(0,E.length-${POINTER_LOG_MAX});},true);}
  L.ev.length=0;L.t0=performance.now();return 1})()`;
/** The mutation ring of one element (`sel` is spliced through jsLiteral, the helper every driver uses for page code); a missing element or MutationObserver arms nothing. */
const domArm = (sel) => `(()=>{const w=window;if(w.__domLog&&w.__domLog.obs)w.__domLog.obs.disconnect();w.__domLog=null;const el=document.querySelector(${jsLiteral(sel)});if(!el||typeof MutationObserver!=='function')return 0;
  const D=w.__domLog={ev:[],t0:performance.now(),obs:null};D.obs=new MutationObserver((rs)=>{const now=performance.now();for(const r of rs){const t=r.target,c=String((t.classList&&t.classList[0])||'').slice(0,16);D.ev.push({k:r.type==='childList'?'c':'a',tag:String(t.tagName||'').toLowerCase(),cls:c,add:r.addedNodes?r.addedNodes.length:0,rem:r.removedNodes?r.removedNodes.length:0,at:now});}if(D.ev.length>${DOM_LOG_MAX})D.ev.splice(0,D.ev.length-${DOM_LOG_MAX});});
  D.obs.observe(el,{childList:true,subtree:true,attributes:true});return 1})()`;
const DOM_READ = `(()=>{const D=window.__domLog;if(!D)return '[]';const q=D.obs.takeRecords();void q;return JSON.stringify(D.ev.map((e)=>({k:e.k,tag:e.tag,cls:e.cls,add:e.add,rem:e.rem,ms:Math.round(e.at-D.t0)})))})()`;
const POINTER_READ = `(()=>{const L=window.__ptrLog;return L?JSON.stringify(L.ev.map((e)=>({type:e.type,x:e.x,y:e.y,buttons:e.buttons,trusted:e.trusted,ms:Math.round(e.at-L.t0)}))):'[]'})()`;
function pointerLog(ctx, out = (l) => console.log(l)) {
  let forced = false;
  const forceHit = (name) => {
    const f = process.env.DIAG_FORCE_FAIL;
    if (forced || !f) return false;
    if (f !== '1' && !String(name).includes(f)) return false;
    forced = true;
    return true;
  };
  const arm = async (dom) => { try { await ctx.js(POINTER_ARM); } catch { /* a diagnostic never changes the verdict */ } if (dom) { try { await ctx.js(domArm(dom)); } catch { /* same */ } } };
  const printDom = async (driver, name) => {
    let ev = [];
    try { ev = JSON.parse(await ctx.js(DOM_READ)); } catch { return; }
    out(`[dom-log] ${driver} ${name}: ${ev.length} mutations (ms kind tag.class +added-removed; c=childList a=attributes)`);
    const tok = ev.map((e) => `${e.ms} ${e.k} ${e.tag}.${e.cls} +${e.add}-${e.rem}`);
    for (let i = 0; i < tok.length; i += 8) out('  ' + tok.slice(i, i + 8).join(';'));
  };
  const print = async (driver, name) => {
    let ev = [];
    try { ev = JSON.parse(await ctx.js(POINTER_READ)); } catch { return; }
    out(`[pointer-log] ${driver} ${name}: ${ev.length} events (ms type x,y buttons+T/S; ${Object.entries(POINTER_SHORT).map(([k, v]) => v + '=' + k.replace('pointer', 'p.').replace('mouse', 'm.')).join(' ')}; T=trusted S=script)`);
    /* the suite shows only the last 25 lines of a failed driver, each cut at 240 characters: 11 short events a line keep 200 events (19 lines) inside that */
    const tok = ev.map((e) => `${e.ms} ${POINTER_SHORT[e.type] || e.type} ${e.x},${e.y} ${e.buttons}${e.trusted ? 'T' : 'S'}`);
    for (let i = 0; i < tok.length; i += 11) out('  ' + tok.slice(i, i + 11).join(';'));
  };
  const step = async (driver, name, fn, opts = {}) => {
    await arm(opts && opts.dom);
    try {
      const r = await fn();
      if (forceHit(name)) throw new (require('assert').AssertionError)({ message: `forced failure of ${name} (DIAG_FORCE_FAIL)` });
      return r;
    } catch (e) {
      if (e && (e.name === 'AssertionError' || e.code === 'ERR_ASSERTION')) { if (opts && opts.dom) await printDom(driver, name); await print(driver, name); }
      throw e;
    }
  };
  return { arm, step, print, printDom };
}

/**
 * The helpers every driver used to define for itself (FR-097). `H = helpers(ctx)`; it also carries `until`, `settle`, `office`, `chatOf`.
 * Values spliced into page code go through jsLiteral.
 */
const DRIVER_WORLD = process.env.DRIVER_WORLD || ''; // spec 102 T283: `retro` runs a driver's Real office loads in the arcade; spec 097 FR-377: `cave` in the Prehistoric cave
if (DRIVER_WORLD && DRIVER_WORLD !== 'retro' && DRIVER_WORLD !== 'cave') throw new Error('DRIVER_WORLD must be retro or cave');
const assert = require('assert');
function helpers(ctx) {
  const w = waits(ctx);
  const closeGuard = guardWindow(ctx.win);
  const ptr = pointerLog(ctx);
  const wc = () => ctx.win.webContents;
  /** Run code in the page. A failure names the code (first 90 chars) and is thrown again, so the driver fails as before. */
  const js = async (code) => { try { return await ctx.js(code); } catch (e) { console.log('JS ERR for', String(code).slice(0, 90)); throw e; } };
  /** Click the first element matching `sel`; false when there is none. */
  const click = (sel) => js(`(()=>{const e=document.querySelector(${jsLiteral(sel)});if(!e)return false;e.click();return true})()`);
  /** Click the first `sel` element whose trimmed text is exactly `text`; false when there is none. */
  const clickText = (sel, text) => js(`(()=>{const b=[...document.querySelectorAll(${jsLiteral(sel)})].find(x=>x.textContent.trim()===${jsLiteral(text)});if(!b)return false;b.click();return true})()`);
  const exists = (sel) => js(`!!document.querySelector(${jsLiteral(sel)})`);
  /** The text of an element ('' when missing): innerText by default, or pass 'textContent'. */
  const text = (sel, prop = 'innerText') => js(`(document.querySelector(${jsLiteral(sel)})||{})[${jsLiteral(prop)}]||''`);
  /** The data-id of the desk whose name starts with `name` (null when none). */
  const idOf = (name) => js(`(()=>{const d=[...document.querySelectorAll('#stage .desk[data-id]')].find(x=>x.querySelector('.name,.nm,h3,b')&&x.innerText.trim().startsWith(${jsLiteral(name)}));return d?d.dataset.id:null})()`);
  /**
   * Windows CI: the drivers run three at a time on one desktop and a hidden runner window loses the OS focus to a neighbour, so `document.hasFocus()`
   * turns false in the middle of a driver (seen as `pageFocus:false, active:true, focus:false` in check-list-columns). `focusPage()` asks for the real
   * focus until the page has it and returns whether it does. With `{ emulate: true }` it falls back to Chromium's focus emulation only when the real focus does not come; with `{ emulate: 'first' }` it turns the emulation on at once, from the call on, for a driver that tests no OS blur (CDP
   * `Emulation.setFocusEmulationEnabled`), which makes `hasFocus()` true whatever the OS does and so hides every real blur: the caller owns that
   * and ends it with `releaseFocus()` (try/finally) before any step that tests a focus loss. Nothing turns it on by itself, `H.key` included.
   * `loseFocus()` releases, blurs the window and returns whether the page reports no focus, for a driver that tests a blur (assert its result).
   * Every wait ends as soon as the condition holds. `webContents.isFocused()` is the host's view and stays real.
   */
  const emulating = new WeakSet();
  const emulateFocus = async () => {
    const c = wc();
    if (!c || !c.debugger || emulating.has(c)) return;
    try {
      if (!c.debugger.isAttached()) c.debugger.attach('1.3');
      await c.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true });
      emulating.add(c);
    } catch (e) { console.log('focus emulation unavailable:', String(e && e.message).slice(0, 80)); }
  };
  const releaseFocus = async () => {
    const c = wc();
    if (!c || !c.debugger || !emulating.has(c)) return;
    emulating.delete(c);
    try { await c.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: false }); } catch { /* the page is gone */ }
    try { if (c.debugger.isAttached()) c.debugger.detach(); } catch { /* already detached */ }
  };
  const focusPage = async (o = {}) => {
    const end = Date.now() + (o.ms || 3000);
    /* emulate:'first': the emulation is on from the start, not only after the real focus failed: a neighbour can take the OS focus later (check-edit-popups,
       #1179: a focus() behind a dialog fires no focusin in an unfocused page), and releaseFocus() ends it as before. emulate:true keeps the
       fallback only: a driver that tests a blur after releaseFocus() (check-list-columns) must not start with the emulation, because on Windows
       the blur it then makes does not reach a page that never owned the OS focus (#1179) */
    if (o.emulate === 'first') { await emulateFocus(); if (emulating.has(wc())) return w.until('document.hasFocus()', 1500); }
    for (;;) {
      try { if (ctx.win.show) ctx.win.show(); if (ctx.win.focus) ctx.win.focus(); wc().focus(); } catch { /* the window is going away: the guard reports it */ }
      if (await w.until('document.hasFocus()', 400)) return true;
      if (Date.now() > end) break;
    }
    if (!o.emulate) return false;
    await emulateFocus();
    return w.until('document.hasFocus()', 1500);
  };
  const loseFocus = async () => { await releaseFocus(); try { ctx.win.blur(); } catch { /* gone */ } return w.until('!document.hasFocus()', 4000); };
  /** Give another web contents (a Browser tab's view) the real focus and wait until it reports it; false when it never does. */
  const focusWc = async (target, ms = 3000) => {
    const end = Date.now() + ms;
    for (;;) {
      try { target.focus(); } catch { /* gone */ }
      const stop = Date.now() + 300;
      while (Date.now() < stop) { if (target.isFocused()) return true; await ctx.sleep(30); }
      if (Date.now() > end) return false;
    }
  };
  /**
   * A key press. Return and Enter also send the char event that activates a button; `char: 'always'` sends it for every key, `char: 'never'` for none (a shortcut such as Ctrl+K).
   * `pause` lets the key's own handler run; what it changes is waited for by the caller.
   */
  const key = async (keyCode, modifiers, o = {}) => {
    const mods = modifiers || [];
    wc().sendInputEvent({ type: 'keyDown', keyCode, modifiers: mods });
    if (o.char === 'never') { /* a shortcut: key down and up only */ }
    else if (o.char === 'always') wc().sendInputEvent({ type: 'char', keyCode, modifiers: mods });
    else if (keyCode === 'Return' || keyCode === 'Enter') wc().sendInputEvent({ type: 'char', keyCode: '\r', modifiers: mods });
    wc().sendInputEvent({ type: 'keyUp', keyCode, modifiers: mods });
    await ctx.sleep(o.pause === undefined ? 50 : o.pause);
  };
  /** Hide the start-up toasts with a style (once). `keepActions`: keep the ones with a button. `blur`: also drop the focus ring. */
  const calm = async (o = {}) => { await js(`(()=>{if(!document.getElementById('shotCalm')){const s=document.createElement('style');s.id='shotCalm';s.textContent='#toasts${o.keepActions ? ' .toast:not(.with-act)' : ''}{display:none!important}';document.head.append(s);}${o.blur ? 'if(document.activeElement&&document.activeElement!==document.body)document.activeElement.blur();' : ''}})()`); await w.settleWalk(); };
  /**
   * Spec 008 FR-214, FR-215: the real pointer rests where the window lies on the screen (script clicks never move it), so a control under it reads in its :hover colours.
   * Moves the pointer to 0,0 and re-sends the move every `retry` ms (250) until nothing under `scope` (a selector list) matches :hover, at most `ms` (3000; a slow first run drops or delays the first move).
   * FR-216: the move counts only when the page saw a mousemove at 0,0 (a capture listener), and nothing may be :hover at two samples at least a frame and 100 ms apart (the Xvfb cursor rests mid-window and hovers a button again a moment after one empty sample); a re-hover re-sends the move.
   * Returns what still is hovered (descriptions; empty = fine); `controls` (a selector list) limits the list to those elements. When the bound ends with such an element still hovered it throws, labelled, so a real leak is told from a slow start.
   * `{ stay: true }` only lists (a mutant that put the pointer there itself): no move, no wait, no failure. A colour read goes after this and asserts the list is empty.
   */
  const pointerOff = async (scope, controls, o = {}) => {
    const sel = scope.split(',').map((x) => x.trim() + ' :hover').join(',');
    const list = () => js(`[...document.querySelectorAll(${jsLiteral(sel)})].filter(e=>${controls ? 'e.matches(' + jsLiteral(controls) + ')&&e.getClientRects().length' : 'true'}).map(e=>(e.id?'#'+e.id:e.tagName.toLowerCase()+'.'+String(e.className).trim().replace(/ +/g,'.'))+' "'+(e.textContent||e.value||'').trim().slice(0,30)+'"')`);
    if (o.stay) return list();
    const ms = o.ms || 3000, retry = o.retry || 250, end = Date.now() + ms;
    // FR-216: the page records the last point it saw (capture phase, so no handler hides it); the move counts as delivered only when that point is 0,0, and a later real-cursor move (the Xvfb cursor rests mid-window) makes it undelivered again
    await ctx.js(`(()=>{const s=window.__pointerOffSeen={x:null,y:null};addEventListener('mousemove',(e)=>{s.x=e.clientX;s.y=e.clientY},true)})()`);
    // one sample: nothing under the scope is :hover and the last move the page saw was 0,0; `frame`: after a painted frame (or 250 ms when none is painted)
    const sample = (frame) => ctx.js(`(async()=>{try{${frame ? 'await new Promise((r)=>{const t=setTimeout(r,250);requestAnimationFrame(()=>{clearTimeout(t);r()})});' : ''}const s=window.__pointerOffSeen||{};return !document.querySelector(${jsLiteral(sel)})&&s.x===0&&s.y===0}catch(e){return false}})()`);
    let moves = 0, last = 0, clear = false, hot = [];
    for (;;) {
      if (Date.now() - last >= retry || moves === 0) { wc().sendInputEvent({ type: 'mouseMove', x: 0, y: 0 }); moves++; last = Date.now(); }
      // two clear samples at least one frame and 100 ms apart: one empty :hover can come before the real cursor's hover is applied (FR-216)
      if (await sample(false)) {
        await ctx.sleep(100);
        if (await sample(true)) {
          hot = await list();
          if (!hot.length) { clear = true; break; }
        }
        last = 0; // it was clear and is hovered again: send the move again at once
      }
      if (Date.now() > end) break;
      await ctx.sleep(50);
    }
    if (!clear) hot = await list();
    if (!clear && hot.length) throw new assert.AssertionError({ message: `pointerOff: the pointer did not leave ${scope} after ${ms} ms and ${moves} move(s): ${JSON.stringify(hot)}` });
    return hot;
  };
  /** Remove the toasts that are on screen now. */
  const clearToasts = () => js(`document.querySelectorAll('#toasts .toast').forEach(t=>t.remove())`);
  /**
   * Size the window, load the renderer with the simulator query and wait until it is ready (default: 15 desks) and has stopped changing.
   * `query` is added to sim=15 and simfreeze=1 (an undefined value removes one); `fastVisits: true` adds `simvisits=fast` (spec 008 FR-190: the lobby's own timers 10x shorter, simulator only; for a driver that never looks at lobby visits or walking and takes no picture of them); `ready` is a page expression ('fit': the stage has laid out); `settle: false` skips the
   * settling wait; `focus` focuses the page afterwards.
   */
  const load = async (o = {}) => {
    if (o.w && o.h) ctx.win.setContentSize(o.w, o.h);
    // spec 001 FR-084: a pinned simulator clock (main's `simclock`, from DURBAR_SIM_CLOCK) stays pinned across the driver's reloads
    let clock = null;
    try { clock = new URL(wc().getURL()).searchParams.get('simclock'); } catch { clock = null; }
    const query = { sim: '15', simfreeze: '1', ...(clock && /^\d{1,15}$/.test(clock) ? { simclock: clock } : {}), ...(o.fastVisits ? { simvisits: 'fast' } : {}), ...(o.query || {}) };
    for (const k of Object.keys(query)) if (query[k] === undefined) delete query[k];
    const arcade = DRIVER_WORLD === 'retro' && query.officeview === 'real'; // spec 102 T283: the Real office loads draw the arcade
    if (arcade) Object.assign(query, { worldflags: 'retro', world: 'retro' });
    const cave = DRIVER_WORLD === 'cave' && query.officeview === 'real'; // spec 097 FR-377: the Real office loads draw the Prehistoric cave
    if (cave) Object.assign(query, { worldflags: 'cave', world: 'cave' });
    await ctx.win.loadFile(o.index || INDEX, { query });
    // spec 092: with `simfloors=1` (the 15 agents spread over three floors on) the office shows one floor, so the default "15 desks" would only be met by its timeout
    const ready = o.ready === 'fit' ? `document.getElementById('stage')&&document.getElementById('stage').dataset.fit` : o.ready || `document.querySelectorAll('#stage .desk[data-id]').length>=${query.simfloors === '1' ? 1 : 15}`;
    if (!(await ctx.waitFor(ready, o.readyMs || 15000))) console.log(`[waits] load: the ready expression never held in ${o.readyMs || 15000} ms (pass \`ready\` for this page): ${String(ready).replace(/\s+/g, ' ').slice(0, 120)}`); // spec 008 FR-190: a timeout here costs the whole wait
    // spec 008 FR-190: a frozen simulator says when it is steady (every script replayed, no lobby visit waiting to start or end, the frame drawn): wait for that
    // instead of letting `settle` find it by sampling 200 ms apart (a load used to spend 0.5-1 s there). `settle` still runs after it, so nothing is skipped.
    if (query.simfreeze === '1' && !o.index && o.settle !== false) await w.until(w.SETTLED, 4000);
    if (o.settle !== false) await w.settle();
    if (arcade) assert.ok(await w.until(`!!document.querySelector('#stage .ro[data-world="retro"]')`, 5000), 'DRIVER_WORLD=retro: the arcade is not drawn (a pass here would be the Photo office)');
    if (cave) assert.ok(await w.until(`!!document.querySelector('#stage .ro[data-world="cave"]')`, 5000), 'DRIVER_WORLD=cave: the cave is not drawn (a pass here would be the Photo office)');
    if (o.focus) wc().focus();
  };
  /**
   * A screenshot of the page as it is now: `prep` first ('toasts' removes the toasts on screen, 'calm' moves the pointer off the controls (unless `keepHover`) and hides them with a style (`keepActions`, `blur` as in calm),
   * 'mouse' moves the pointer off the controls, 'none'; a `file` ending .jpg is written as a JPEG, `quality` 1..100, default 60), then (`settle: true`) the page settles, then `delay` ms for paint (default 150). `file` is the full path.
   */
  const shot = async (file, o = {}) => {
    const prep = o.prep || 'none';
    if (prep === 'toasts') await clearToasts();
    else if (prep === 'calm') { if (!o.keepHover) { wc().sendInputEvent({ type: 'mouseMove', x: 1, y: 1 }); await new Promise((r) => setTimeout(r, 120)); } await calm({ keepActions: o.keepActions, blur: o.blur }); } // PR 631: under xvfb the pointer rests mid-window (on a desk): its hover pencil and the room's hover buttons were pictured
    else if (prep === 'mouse') wc().sendInputEvent({ type: 'mouseMove', x: 1, y: 1 });
    if (o.settle) await w.settle();
    if (prep !== 'calm' && !o.walking) await w.settleWalk(); // FR-085 (calm already waited); `walking: true` keeps a figure mid-walk on purpose
    await ctx.sleep(o.delay === undefined ? 150 : o.delay);
    await ctx.shot(file, { quality: o.quality }); // spec 101: under `npm run shots:docs` main's ctx.shot closes the macOS room for every picture (src/main/docshot.ts); a `.jpg` file is written as a JPEG by that same capture (quality 1..100, default 60), for a photo-heavy picture the PNG palette guard (compress-shots) refuses
    if (o.tag) console.log(`[${o.tag}] saved`, o.what !== undefined ? o.what : path.basename(file));
  };
  /**
   * Spec 052 FR-173 (review on #516): open the chat of the simulated agent that `pick` finds, without clicking every desk. `pick` is page
   * code for an `Array.find` callback over the simulator's agents (`window.__durbarSimUi.agents()`), for example `a=>!a.parent&&a.question`.
   * It waits (at most `o.ms`, default 20 s) for the simulator's own state, clicks that one desk, then waits (at most `o.cardMs`, default
   * 15 s) for the chat to be open with `card` in it. Returns `{ id, ok, seen }`; `seen` is the observed state for the driver's failure message (with the page errors since the call).
   * A synchronous sweep over all desks could never see a request that arrived, or a chat that rendered, between two sweeps.
   */
  const openSimAgent = async (pick, card, o = {}) => {
    // page errors from here on go into `seen.errors` (a "Script failed to execute" under load is then diagnosable)
    await js(`(()=>{window.__osaErr=[];if(!window.__osaErrOn){window.__osaErrOn=1;addEventListener('error',e=>{(window.__osaErr=window.__osaErr||[]).push(String(e.message).slice(0,160));});}})()`);
    const find = `((window.__durbarSimUi&&window.__durbarSimUi.agents().find(${pick}))||{}).id||''`;
    await w.until(find, o.ms || 20000);
    const id = await js(find);
    const desk = `document.querySelector('#stage .desk[data-id="'+CSS.escape(${jsLiteral(String(id))})+'"]')`;
    if (id) {
      await w.until(`!!${desk}`, 8000);
      await js(`(()=>{const d=${desk};if(d)d.click();})()`);
      await w.until(`document.body.classList.contains('panel-open')&&!!document.querySelector(${jsLiteral(card)})`, o.cardMs || 15000);
    }
    const seen = await js(`(()=>{const ag=(window.__durbarSimUi&&window.__durbarSimUi.agents())||[];let m=[];try{m=ag.filter(${pick}).map(a=>a.id);}catch(e){m=['pick threw: '+String(e.message).slice(0,80)];}
      return {sim:!!window.__durbarSimUi,matching:m,desk:!!${desk},desks:document.querySelectorAll('#stage .desk[data-id]').length,panel:document.body.classList.contains('panel-open'),
        title:(document.getElementById('panelTitle')||{}).textContent||'',card:!!document.querySelector(${jsLiteral(card)}),visibility:document.visibilityState,errors:window.__osaErr||[]}})()`);
    return { id, ok: !!id && seen.panel && seen.card, seen };
  };
  /**
   * Spec 092 (floor screens): with two or more floors on, the office shows one floor at a time. `floors()` lists the floors that are on, in floor order
   * ({id, name}, read from the Floors panel); `shownFloor()` is the id of the floor screen shown (the saved current floor); `goToFloor(id)` presses
   * PageUp / PageDown, as a user does, until that floor is shown (each press waits for the change); `eachFloor(fn)` goes to the first floor and runs
   * `fn(floor, index)` on every floor screen in turn, ending on the last one. Office view only. With one floor on, `eachFloor` runs `fn` once.
   */
  const floors = async () => {
    const open = await js(`!document.getElementById('floorsPop').hidden`);
    if (!open) { await js(`document.getElementById('floorsBtn').click()`); await w.until(`!document.getElementById('floorsPop').hidden`); }
    const rows = await js(`[...document.querySelectorAll('#floorsPop [data-fl="on"]')].map(b=>({id:b.dataset.floor,name:b.getAttribute('aria-label').split(': ')[0],on:b.getAttribute('aria-checked')==='true'}))`);
    if (!open) { await js(`document.getElementById('floorsBtn').click()`); await w.until(`document.getElementById('floorsPop').hidden`); }
    return rows.filter((r) => r.on).map(({ id, name }) => ({ id, name }));
  };
  const shownFloor = () => js(`localStorage.getItem('durbar.floor')`);
  const goToFloor = async (id) => {
    const list = await floors();
    for (let guard = 0; guard < 2 * list.length + 2; guard++) {
      const here = await shownFloor(), cur = list.findIndex((f) => f.id === here), want = list.findIndex((f) => f.id === id);
      if (want < 0 || cur === want) return cur === want;
      const was = list[cur] ? list[cur].id : null;
      await key(want > cur ? 'PageUp' : 'PageDown', [], { pause: 30 }); // spec 092 Q-D: the list goes up the building
      await w.until(`localStorage.getItem('durbar.floor')!==${jsLiteral(was)}`);
    }
    return false;
  };
  const eachFloor = async (fn) => {
    const list = await floors();
    if (list.length < 2) { await fn(list[0] || null, 0); return; }
    await goToFloor(list[0].id);
    for (let i = 0; i < list.length; i++) { await goToFloor(list[i].id); await w.settle(); await fn(list[i], i); }
  };
  return { ...w, pointerStep: ptr.step, allowWindowClose: closeGuard.allow, wc, js, click, clickText, exists, text, idOf, key, calm, pointerOff, clearToasts, focusPage, releaseFocus, loseFocus, focusWc, load, shot, openSimAgent, floors, shownFloor, goToFloor, eachFloor, INDEX };
}

/**
 * Spec 080: a picture of the window with a session browser's native view blitted in (`capturePage` of the window leaves child views out).
 * `view` is the attached `WebContentsView` (or none: the window's page alone). Written as PNG to `file`. Electron only (a driver).
 */
async function shotWithView(win, view, file) {
  const { nativeImage } = require('electron');
  const fs = require('fs');
  const page = await win.webContents.capturePage();
  const size = page.getSize();
  const base = Buffer.from(page.toBitmap());
  if (view) {
    const b = view.getBounds();
    const vi = await view.webContents.capturePage();
    const vs = vi.getSize();
    const vb = vi.toBitmap();
    for (let y = 0; y < Math.min(vs.height, size.height - b.y); y++) {
      const src = y * vs.width * 4;
      const dst = ((b.y + y) * size.width + b.x) * 4;
      vb.copy(base, dst, src, src + Math.min(vs.width, size.width - b.x) * 4);
    }
  }
  fs.writeFileSync(file, nativeImage.createFromBitmap(base, { width: size.width, height: size.height }).toPNG());
}

/* Spec 097 FR-365: a page expression, true once no WAAPI move or fade runs in #stage (a plate's ease, a pencil's hold and fade; the CSS loops, a person's bob,
   keep running and do not count). One text for the pencil-ease driver's waits and the release clip's one capture (scripts/release-video.js `glide`). */
const STILL_STAGE = `!(document.getElementById('stage')||document.body).getAnimations({subtree:true}).some(a=>!a.animationName&&a.playState==='running')`;

module.exports = { STILL_STAGE, waits, helpers, pointerLog, POINTER_LOG_MAX, DOM_LOG_MAX, guardWindow, jsLiteral, shotWithView, LIMIT, INDEX, CHECK_DARK, CHECK_DARK_QUERY, darkFixtureProblem, darkProblem };
