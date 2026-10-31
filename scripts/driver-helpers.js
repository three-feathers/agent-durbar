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

const path = require('path');
const LIMIT = 8000;
const INDEX = path.join(__dirname, '..', 'dist', 'renderer', 'index.html');

function waits(ctx) {
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
  return { until, settle, settleWalk, office, chatOf };
}

/**
 * The helpers every driver used to define for itself (FR-097). `H = helpers(ctx)`; it also carries `until`, `settle`, `office`, `chatOf`.
 * Values spliced into page code go through jsLiteral.
 */
function helpers(ctx) {
  const w = waits(ctx);
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
  /** Remove the toasts that are on screen now. */
  const clearToasts = () => js(`document.querySelectorAll('#toasts .toast').forEach(t=>t.remove())`);
  /**
   * Size the window, load the renderer with the simulator query and wait until it is ready (default: 15 desks) and has stopped changing.
   * `query` is added to sim=15 and simfreeze=1 (an undefined value removes one); `ready` is a page expression ('fit': the stage has laid out); `settle: false` skips the
   * settling wait; `focus` focuses the page afterwards.
   */
  const load = async (o = {}) => {
    if (o.w && o.h) ctx.win.setContentSize(o.w, o.h);
    // spec 001 FR-084: a pinned simulator clock (main's `simclock`, from DURBAR_SIM_CLOCK) stays pinned across the driver's reloads
    let clock = null;
    try { clock = new URL(wc().getURL()).searchParams.get('simclock'); } catch { clock = null; }
    const query = { sim: '15', simfreeze: '1', ...(clock && /^\d{1,15}$/.test(clock) ? { simclock: clock } : {}), ...(o.query || {}) };
    for (const k of Object.keys(query)) if (query[k] === undefined) delete query[k];
    await ctx.win.loadFile(o.index || INDEX, { query });
    // spec 092: with `simfloors=1` (the 15 agents spread over three floors on) the office shows one floor, so the default "15 desks" would only be met by its timeout
    const ready = o.ready === 'fit' ? `document.getElementById('stage')&&document.getElementById('stage').dataset.fit` : o.ready || `document.querySelectorAll('#stage .desk[data-id]').length>=${query.simfloors === '1' ? 1 : 15}`;
    await ctx.waitFor(ready, o.readyMs || 15000);
    if (o.settle !== false) await w.settle();
    if (o.focus) wc().focus();
  };
  /**
   * A screenshot of the page as it is now: `prep` first ('toasts' removes the toasts on screen, 'calm' moves the pointer off the controls (unless `keepHover`) and hides them with a style (`keepActions`, `blur` as in calm),
   * 'mouse' moves the pointer off the controls, 'none'), then (`settle: true`) the page settles, then `delay` ms for paint (default 150). `file` is the full path.
   */
  const shot = async (file, o = {}) => {
    const prep = o.prep || 'none';
    if (prep === 'toasts') await clearToasts();
    else if (prep === 'calm') { if (!o.keepHover) { wc().sendInputEvent({ type: 'mouseMove', x: 1, y: 1 }); await new Promise((r) => setTimeout(r, 120)); } await calm({ keepActions: o.keepActions, blur: o.blur }); } // PR 631: under xvfb the pointer rests mid-window (on a desk): its hover pencil and the room's hover buttons were pictured
    else if (prep === 'mouse') wc().sendInputEvent({ type: 'mouseMove', x: 1, y: 1 });
    if (o.settle) await w.settle();
    if (prep !== 'calm' && !o.walking) await w.settleWalk(); // FR-085 (calm already waited); `walking: true` keeps a figure mid-walk on purpose
    await ctx.sleep(o.delay === undefined ? 150 : o.delay);
    await ctx.shot(file);
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
    const rows = await js(`[...document.querySelectorAll('#floorsPop [data-fl="on"]')].map(b=>({id:b.dataset.floor,name:b.getAttribute('aria-label').split(': ')[0],on:b.getAttribute('aria-pressed')==='true'}))`);
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
  return { ...w, wc, js, click, clickText, exists, text, idOf, key, calm, clearToasts, load, shot, openSimAgent, floors, shownFloor, goToFloor, eachFloor, INDEX };
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

module.exports = { waits, helpers, jsLiteral, shotWithView, LIMIT, INDEX };
