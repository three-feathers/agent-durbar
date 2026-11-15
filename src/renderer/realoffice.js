/* Real office mode (spec 097 phases P1, P2): the second renderer of the office. app.js builds a plain model from the same state as the flat
   office (officeModel, VISITS, status words, masked task text) and calls render(); this file lays it out with the pure engine
   (src/shared/realoffice-layout.ts), picks the lights (src/shared/lights.ts) and draws absolutely placed elements in #stage. It is
   loaded only when Real office is chosen (FR-061): app.js adds this script, its CSS, the two compiled shared modules and the art
   metadata (realoffice/worlds/<id>/world.js and realoffice/sets/<id>/set.js, made by copy-assets.js) on first use. The DOM is keyed: a re-render moves
   and re-classes the same elements, so focus stays (FR-090). No text is set with innerHTML from the model: names, roles, tasks
   and paths go in with textContent (the model's text is already masked by app.js, FR-030's path). */
(function (root) {
  'use strict';
  const X = () => root.exports || {};
  let WD = 'realoffice/worlds/photo/', SD = 'realoffice/sets/office/'; /* the shown world's and set's folders (spec 102 FR-205): a world loads no other world's files */
  const BAD = new Set(); /* FR-065: pictures that failed to load in this session */
  const SEEN = new Map(); /* FR-052: the light state each desk had at the last render */
  let PEOPLE = null; /* session id -> person id, durbar.realpeople (Office people) or durbar.realpeople.<set> */
  let SET_SHOWN = '';
  const peopleKey = () => SET_SHOWN === 'office' || !SET_SHOWN ? 'durbar.realpeople' : 'durbar.realpeople.' + SET_SHOWN;
  let onArt = null;
  let EMPTY_BOX = null, SLIP_RO = null;
  /* phase P2 (FR-030..FR-035, FR-070..FR-074). CUR: the drawn scene; a monitor repaints on its own, at most once per REPAINT_MS, only when its
     lines changed, and not at all while the office is hidden or the desk is scrolled away: so no timer runs in an idle office. */
  const REPAINT_MS = 2000; /* FR-033 */
  const SCR = new Map(); /* desk id -> {box, last, timer, dirty, away, fit, sig} */
  const OFF = new Set(); /* keys of desks whose motion stands still: scrolled away or under the zoom */
  let LAY_G = 0; const CUR_G = () => LAY_G; /* the arcade's scale, for its screen text (0 in other worlds) */
  let CUR = null; /* {ro, screenOf, still, hold, desks: Map id -> desk, agents: Map id -> model agent, folders: Map, drawn} */
  let CIRCLE_HOLD = null; /* FR-230: {key, at}: where the circle fell back to rows, and the count of agents it fell back at */
  let ZOOM = null; /* {id, hover, focus, panel, plate} */
  let IO = null, DISMISSED = '';
  /* spec 052 FR-183: focus the app moves by itself onto a plate is not the person asking to read that screen */
  let PT = ''; /* the pointer's last position in the office (x,y of its last pointermove), the format of QUIET_AT: a card held under a resting pointer (FR-328) is let go only by a move to another one */
  let QUIET_FOCUS = false, QUIET_POINTER = false, QUIET_AT = '', ARMED = false; /* QUIET_POINTER: the room came back (Esc from a chat, issue 1040) under a pointer that has not moved; hovering starts when it leaves QUIET_AT. ARMED: a hover zoom is waiting out its 120 ms (driver reads hoverState) */
  function quietFocus(fn) { QUIET_FOCUS = true; QUIET_POINTER = true; QUIET_AT = ''; try { fn(); } finally { QUIET_FOCUS = false; } }

  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const px = (n) => Math.round(n * 10) / 10 + 'px';
  /* FR-184: nothing rewrites what did not change: a style or dataset value is written only when it differs */
  const sty = (e, k, v) => { if (e.style[k] !== v) e.style[k] = v; };
  const dset = (e, k, v) => { if (e.dataset[k] !== v) e.dataset[k] = v; };
  /* spec Changes 2026-11-01: while `SLIDE` is on (a draw of the same window size, people moving), something the layout moved or resized eases there on `translate` and `scale`, so a change does not make the room jump; chips and plates fade in place instead */
  let SLIDE = false;
  /* on `translate` and `scale`, not `transform`: an element keeps its own transform while it moves (the post-it's tilt, a person's motion); no layout during it (spec Changes 2026-11-01) */
  const easeFrom = (el, dx, dy, sx, sy) => {
    if (!el.animate || (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5 && sx === 1 && sy === 1)) return;
    const ms = Math.max(280, Math.min(520, Math.hypot(dx, dy) * 1.2)), ease = { duration: ms, easing: 'cubic-bezier(.25,.1,.25,1)' };
    if (sx === 1 && sy === 1) return el.animate([{ translate: `${dx}px ${dy}px` }, { translate: '0 0' }], ease);
    /* scaled about the element's own origin: the translate brings its top left to where it was */
    const o = getComputedStyle(el).transformOrigin.split(' '), ox = parseFloat(o[0]) || 0, oy = parseFloat(o[1]) || 0;
    const flip = el.classList.contains('mir') ? -1 : 1; /* a mirrored picture stays mirrored while it eases (spec 102 FR-256) */
    return el.animate([{ translate: `${dx - ox * (1 - sx)}px ${dy - oy * (1 - sy)}px`, scale: `${flip * sx} ${sy}` }, { translate: '0 0', scale: `${flip} 1` }], ease);
  };
  const box = (el, r) => { /* gives the ease it started, if any */
    let a = null;
    if (SLIDE && el._x !== undefined && !el.classList.contains('ro-chip') && !el.classList.contains('ro-lplate')) {
      const sw = r.w != null && el._bw > 0 && Math.abs(el._bw - r.w) >= 1 && r.w > 0 ? el._bw / r.w : 1, sh = r.h != null && el._bh > 0 && Math.abs(el._bh - r.h) >= 1 && r.h > 0 ? el._bh / r.h : 1;
      a = easeFrom(el, el._x - r.x, el._y - r.y, sw, sh) || null;
    }
    if (r.w != null) el._bw = r.w;
    if (r.h != null) el._bh = r.h;
    el._x = r.x; el._y = r.y; sty(el, 'left', px(r.x)); sty(el, 'top', px(r.y)); if (r.w != null) sty(el, 'width', px(r.w)); if (r.h != null) sty(el, 'height', px(r.h));
    return a; };
  /* spec 097 FR-365 (bug 1513): the rename pencil is placed by CSS anchor only, so its plate's ease (translate and scale on the compositor) does not carry
     its painted icon: in the first ~200 ms it was drawn over the name and the status icon. While the plate eases the pencil is not painted (opacity, so it
     keeps its name and Tab place); it fades in at its own spot when the ease ends. Under reduced motion nothing eases, so nothing hides. A pencil that
     has the focus is not hidden (its focus ring stays; it may be drawn displaced for the ease, a known gap). */
  const REN_IN = 120;
  function hideWhile(e, ease) {
    if (e._hide) e._hide.cancel();
    if (!e._hf) { e._hf = true; e.addEventListener('focus', () => { if (e._hide) { e._hide.cancel(); e._hide = null; } }); } /* focused while hidden: shown at once, and no fade from 0 when the ease ends (`show` stops at its guard) */
    /* held until the plate's own ease ends (its `finished`), not for a time of its own: a plate's ease can start a frame after the pencil's hold
       (measured in the cave, 17 ms), and a timed hold then ended while the plate still moved (review of PR 1555) */
    const h = e._hide = e.animate([{ opacity: 0 }, { opacity: 0 }], { duration: Infinity });
    const show = () => { if (e._hide !== h) return; h.cancel(); e._hide = e.animate([{ opacity: 0 }], { duration: REN_IN, easing: 'linear' }); }; /* one keyframe: it ends on the CSS opacity (hover, focus, ren-show) */
    ease.finished.then(show, show);
  }
  /* the plate's ease still under way (a move on translate or scale), for a pencil made while it runs */
  const easeOf = (el) => el.getAnimations ? el.getAnimations().find((n) => !n.animationName && n.playState === 'running' && n.effect && n.effect.getKeyframes().some((f) => f.translate || f.scale)) || null : null;
  const initials = (name) => String(name || '?').trim().split(/\s+/).slice(0, 2).map((w) => Array.from(w)[0] || '').join('').toUpperCase() || '?';

  /* the keyed layers: one Map per layer, elements reused by key; unseen keys are removed at the end of a render */
  function layerOf(rootEl, cls) {
    let l = rootEl.querySelector(':scope > .' + cls);
    if (!l) { l = document.createElement('div'); l.className = cls; rootEl.appendChild(l); l._k = new Map(); }
    l._seen = new Set();
    return l;
  }
  function el(layer, key, tag, cls) {
    let e = layer._k.get(key);
    if (!e || e.tagName !== tag.toUpperCase()) {
      if (e) { if (layer._obs && layer._obs.delete(e)) layer._ro.unobserve(e); e.remove(); } /* a replaced element is unobserved too */
      e = document.createElement(tag); layer.appendChild(e); layer._k.set(key, e);
    }
    if (e.className !== cls) e.className = cls;
    layer._seen.add(key);
    return e;
  }
  /* FR-073: `fade`: a person or visitor who left fades where they stood (the fade itself is a picture nobody can click); an element that leaves is also unobserved (the resize observer of the chrome layer, settle), so the observed set cannot grow all day */
  /* spec 097 FR-249: a desk picture whose agent went to the lounge (or a lounge desk whose agent went back) fades out where it stood */
  function sweep(layer, fade) { for (const [k, e] of layer._k) if (!layer._seen.has(k)) { if (layer._obs && layer._obs.delete(e)) layer._ro.unobserve(e); if (fade && (k.startsWith('p:') || k.startsWith('v:'))) zoomOut(e); else if (fade && (k.startsWith('d:') || k.startsWith('ld:'))) fadeOut(e, 220); else e.remove(); layer._k.delete(k); } }
  function fadeOut(e, ms) { delete e.dataset.for; e.style.pointerEvents = 'none'; const a = e.animate([{ opacity: 1 }, { opacity: 0 }], { duration: ms, easing: 'ease-in-out', fill: 'forwards' }); a.onfinish = a.oncancel = () => e.remove(); }
  function text(e, t) { t = String(t == null ? '' : t); if (e.textContent !== t) e.textContent = t; }
  function attr(e, k, v) { if (v == null || v === false) { if (e.hasAttribute(k)) e.removeAttribute(k); } else if (e.getAttribute(k) !== String(v)) e.setAttribute(k, String(v)); }
  /* FR-183: a person or the desk comes in two sizes, chosen by what it is shown at (`shown`, CSS px; the browser multiplies by the device pixel ratio); the world's or set's `px` holds the full picture's width. FR-065: a failed picture marks `src`, whichever size failed */
  /* owner 2026-11-01: faces stay sharp. The half-size picture only when it is shown at least this much smaller than it is, where the softness cannot be seen; a little more memory for that */
  const HALF_MARGIN = 1.5;
  let WPX = {}, SPX = {}; /* the shown world's and set's `px`: file -> the full picture's width, for the ones that have a half-size picture */
  function img(e, file, set, shown) {
    const src = (set ? SD : WD) + file, w = shown && (set ? SPX : WPX)[file];
    if (w) { const sizes = Math.ceil(shown * HALF_MARGIN) + 'px'; if (e.getAttribute('sizes') !== sizes) e.setAttribute('sizes', sizes); }
    if (e.getAttribute('src') !== src) {
      if (e.getAttribute('aria-hidden') !== 'true') { e.alt = ''; e.decoding = 'async'; e.draggable = false; e.setAttribute('aria-hidden', 'true'); }
      e.onerror = () => { if (!BAD.has(src)) { BAD.add(src); if (onArt) onArt(); } };
      if (w) e.setAttribute('srcset', (set ? SD : WD) + file.replace(/\.webp$/, '.h.webp') + ' ' + Math.ceil(w / 2) + 'w, ' + src + ' ' + w + 'w'); else e.removeAttribute('srcset');
      e.src = src;
    }
  }
  /* FR-071 and FR-047: may anything move now? Web Animations do not see the CSS rules, so this is asked before each one; `still` holds Motion off and reduced motion at load, the query a later change */
  function moving() {
    if (!CUR || CUR.still || CUR.hold || !CUR.ro._ready) return false;
    try { if (matchMedia('(prefers-reduced-motion: reduce)').matches) return false; } catch (e) { return false; }
    return true;
  }
  /* FR-228: loops started while the first draw is busy stay on the main thread (Chromium: "incompatible animations"), at 60 style recalculations a second, sometimes for 30 s:
     the room stands still for its first 2 s, then everything starts in one pass. Measured: 2 s and 3 s held 4 of 4; 0.7 s, waiting for the pictures to decode, or for 30 quiet frames did not */
  const READY_MS = 2000;
  function whenReady(ro) {
    if (ro._ready || ro._waiting) return;
    ro._waiting = true;
    setTimeout(() => {
      ro._ready = true; ro.dataset.go = '1'; /* spec 102 FR-309: the arcade's CSS loops (marquee flash, cue dots, caret) start now, not at the first draw */
      if (!CUR || CUR.ro !== ro) return;
      for (const c of SCR.values()) if (c.caret) clock(c.caret, c.caretMs);
      if (onArt) onArt();
    }, READY_MS);
  }
  /* FR-074: hidden, or the office under a chat or a screen (body.panel-open hides it): nothing paints */
  function hiddenNow() { return document.hidden || !CUR || !CUR.ro.isConnected || document.body.classList.contains('panel-open'); }
  /* a one-time picture that goes away: FR-072's old pose, FR-073's person leaving a desk or a fixture; eased opacity only (FR-180) */
  function fadeAway(e, ms) {
    e.className = 'ro-ghost' + (e.classList.contains('ro-visitor') ? ' v' : ''); delete e.dataset.for;
    const a = e.animate([{ opacity: 1 }, { opacity: 0 }], { duration: ms, easing: 'ease-in-out', fill: 'forwards' });
    a.onfinish = a.oncancel = () => e.remove();
  }
  function fadeIn(e, ms, delay) { e.animate([{ opacity: 0 }, { opacity: 1 }], { duration: ms, delay: delay || 0, easing: 'steps(5, end)', fill: 'backwards' }); }
  /* spec Changes 2026-11-01: measured on macOS at 15 agents, CSS animations that started during a draw stay on the main thread until they restart (renderer main 11.9 % of a core, then 0.6 %): once settled, each gets its own start time set again, so the compositor takes it and nobody's timing changes */
  /* FR-074: nothing runs while hidden: a walk, a slide or a fade under way ends where it was going (the CSS ones pause by `animation-play-state`) */
  function finishMoves(ro) { if (ro.getAnimations) for (const a of ro.getAnimations({ subtree: true })) if (!a.animationName) { try { a.finish(); } catch (e) { /* one with no end: none is drawn here */ } } }
  let handTimer = 0, handStep = 0;
  const HAND_MS = [3000, 8000, 15000, 30000]; /* measured: at 3 s it does not hold, at 15 s it does; the reason is not known, so it tries again */
  function handOver(ro) {
    handStep = 0;
    if (handTimer) return;
    const next = () => {
      handTimer = setTimeout(() => {
        handTimer = 0;
        if (!CUR || CUR.ro !== ro || !ro.isConnected || !ro.getAnimations || !moving() || hiddenNow()) return;
        for (const a of ro.getAnimations({ subtree: true })) {
          if (!a.animationName || a.playState !== 'running' || a.startTime == null) continue;
          a.startTime = a.startTime; /* the same place: not pause and play, which would take the animation away from `animation-play-state` and so from FR-074's pause */
        }
        if (++handStep < HAND_MS.length) next();
      }, HAND_MS[handStep]);
    };
    next();
  }
  /* spec Changes 2026-11-01: a person going to or from a place glides from where they were, with a stride bounce; the second picture waits for the arrival (GLIDING) */
  const WHERE = new Map(), GLIDING = new Map();
  /* spec Changes 2026-11-01: a person zooms out where they were and zooms in where they go: never two bodies, nothing crosses the room */
  const ZOOM_OUT = 280, ZOOM_IN = 320;
  /* spec 102 FR-262: in a pixel world the teleport is a dissolve: three copies under static dither masks, from a small pool; only opacity moves */
  let PIXEL = false; const DIS_POOL = [];
  const DIS_MS = 150;
  function dissolve(e, out, delay) {
    if (!e.parentNode) return;
    [0, 1, 2].forEach((i) => {
      const c = DIS_POOL.pop() || document.createElement('img');
      c.alt = ''; c.setAttribute('aria-hidden', 'true'); c.className = 'ro-dis d' + i + (e.classList.contains('mir') ? ' mir' : '');
      c.src = e.getAttribute('src'); c.style.cssText = 'left:' + e.style.left + ';top:' + e.style.top + ';width:' + e.style.width + ';height:' + e.style.height;
      e.parentNode.insertBefore(c, e.nextSibling);
      const peak = 0.34 + i * 0.2;
      const a = c.animate([{ opacity: 0 }, { opacity: 1, offset: out ? 1 - peak : peak }, { opacity: 0 }], { duration: DIS_MS, delay, easing: 'steps(3)', fill: 'both' });
      a.onfinish = a.oncancel = () => { c.remove(); if (DIS_POOL.length < 12) DIS_POOL.push(c); };
    });
  }
  /* spec 102 FR-260: a done flourish: one coin rises and fades, 2 s, once; stepped; its element is always there */
  function coinUp(chrome, k, g) {
    const co = chrome._k.get('co:' + k); if (!co) return;
    co.animate([{ transform: 'translateY(0)', opacity: 1 }, { transform: 'translateY(' + -20 * g + 'px)', opacity: 0 }], { duration: 2000, easing: 'steps(10)' });
  }
  function poof(host, r, delay) {
    if (PIXEL) return;
    const d = document.createElement('div'); d.className = 'ro-poof';
    const w = r.h * 0.8; box(d, { x: r.x + r.w / 2 - w / 2, y: r.y + r.h * 0.45 - w / 2, w, h: w }); host.appendChild(d);
    const a = d.animate([{ transform: 'scale(.5)', opacity: 0 }, { opacity: 1, offset: 0.4 }, { transform: 'scale(1.2)', opacity: 0 }], { duration: ZOOM_IN, delay, easing: 'ease-out', fill: 'backwards' });
    a.onfinish = a.oncancel = () => d.remove();
  }
  function zoomOut(e) {
    const r = { x: parseFloat(e.style.left) || 0, y: parseFloat(e.style.top) || 0, w: parseFloat(e.style.width) || 0, h: parseFloat(e.style.height) || 0 };
    e.className = 'ro-ghost' + (e.classList.contains('ro-visitor') ? ' v' : ''); delete e.dataset.for;
    if (e.parentNode && r.h) poof(e.parentNode, r, 0);
    if (PIXEL) { dissolve(e, true, 0); const f = e.animate([{ opacity: 1 }, { opacity: 0 }], { duration: DIS_MS, easing: 'steps(3)', fill: 'forwards' }); f.onfinish = f.oncancel = () => e.remove(); return; }
    const a = e.animate([{ transform: 'scale(1)', opacity: 1 }, { transform: 'scale(.62)', opacity: 0 }], { duration: ZOOM_OUT, easing: 'cubic-bezier(.5,0,.8,.5)', fill: 'forwards' });
    a.onfinish = a.oncancel = () => e.remove();
  }
  function glide(e, id, from, to) {
    if (!from || (from.x === to.x && from.y === to.y)) return false;
    if (e.parentNode) poof(e.parentNode, to, ZOOM_OUT - 40);
    if (PIXEL) {
      dissolve(e, false, DIS_MS);
      const f = e.animate([{ opacity: 0 }, { opacity: 1 }], { duration: DIS_MS, delay: DIS_MS, easing: 'steps(3)', fill: 'backwards' });
      GLIDING.set(id, f);
      f.onfinish = f.oncancel = () => { if (GLIDING.get(id) === f) { GLIDING.delete(id); if (onArt) onArt(); } };
      return true;
    }
    const a = e.animate([{ transform: 'scale(.62)', opacity: 0 }, { transform: 'scale(1.03)', opacity: 1, offset: 0.72 }, { transform: 'none', opacity: 1 }], { duration: ZOOM_IN, delay: ZOOM_OUT - 40, easing: 'cubic-bezier(.2,.7,.3,1)', fill: 'backwards' });
    GLIDING.set(id, a);
    a.onfinish = a.oncancel = () => { if (GLIDING.get(id) === a) { GLIDING.delete(id); if (onArt) onArt(); } };
    return true;
  }

  function setVar(e, k, v) { if (e.style.getPropertyValue(k) !== v) e.style.setProperty(k, v); }
  /* one clock per desk, its own place in the cycle: a desk's two pictures and caret stay together */
  /* FR-229: every endless loop on one grid: the whole effect stepped, duration and start on 1/12 s, so all of them change on the same frames and the rest stay unpainted */
  const STEP_MS = 1000 / 12, onStep = (ms) => Math.round(ms / STEP_MS) * STEP_MS;
  const offStep = (ms) => { const m = ((ms % STEP_MS) + STEP_MS) % STEP_MS; return Math.min(m, STEP_MS - m) > 0.01; };
  function snap(a) { if (a.playState === 'running' && a.startTime != null && offStep(a.startTime)) a.startTime = onStep(a.startTime); } /* a paused one stays paused (FR-074): a resume keeps its place, off the grid until it comes back here */
  function onGrid(host) {
    for (const a of host.getAnimations({ subtree: true })) {
      if (!a.animationName) continue;
      const t = a.effect.getTiming();
      if (t.iterations !== Infinity) continue;
      if (!t.easing.startsWith('steps')) {
        const n = Math.max(2, Math.round(t.duration / STEP_MS));
        a.effect.updateTiming({ duration: n * STEP_MS, easing: 'steps(' + n + ', end)' });
      }
      if (a.pending) a.ready.then(() => snap(a), () => {}); else snap(a);
    }
  }
  function clock(e, ms) { for (const a of e.getAnimations()) if (a.animationName) a.startTime = onStep(ms); } /* the CSS loops only: a walk under way keeps its own time */

  /* the typing rig: a wrapper with the body's movement on the body's clock, over it a head and two hands cut from the same picture (spec Changes 2026-11-01) */
  /* spec 102 FR-257, FR-306: the cabinet: one of the world's drawings, a strip of bodies in colour variants; the colour (with its marquee
     trim and side art) stays with the session, the body follows the seat order, so neighbours differ */
  function cabinetOf(dc, meta, cab, k, state, body) {
    dc.classList.toggle('st-idle', state === 'idle'); /* FR-260: dim by opacity: a shade would darken the floor beside it too */
    const kind = cab.gw === meta.monitor.big.glass[2] ? 'big' : cab.gw === meta.monitor.small.glass[2] ? 'small' : 'narrow', m = meta.monitor[kind];
    /* spec 102 T171: a file name or cell count that is not plain paints no picture, and neither does a missing validator (fail closed); the element is reused
       across renders, so a picture an earlier, accepted entry painted is taken off first */
    if (!X().monitorProblem || X().monitorProblem(m)) {
      for (const p of ['backgroundImage', 'backgroundSize', 'backgroundPosition']) if (dc.style[p]) dc.style[p] = '';
      delete dc.dataset.body;
      return;
    }
    let h = 0; for (const c of k) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    const nb = m.bodies || 1, cell = ((body || 0) % nb) * (m.cells / nb) + (h % (m.cells / nb));
    const url = 'url("' + WD + m.file + '")', size = m.cells * 100 + '% 100%', pos = (cell / Math.max(1, m.cells - 1)) * 100 + '% 0';
    dc.dataset.body = String(cell / (m.cells / nb) | 0);
    if (dc.style.backgroundImage !== url) dc.style.backgroundImage = url;
    if (dc.style.backgroundSize !== size) dc.style.backgroundSize = size;
    if (dc.style.backgroundPosition !== pos) dc.style.backgroundPosition = pos;
  }
  function rigOf(art, k, rect, r, m, pe) {
    const w = el(art, 'rg:' + k, 'div', 'ro-rig m-rig' + (OFF.has(k) ? ' ro-off' : ''));
    box(w, rect); dset(w, 'for', k);
    const org = getComputedStyle(pe).transformOrigin; if (w.style.transformOrigin !== org) w.style.transformOrigin = org;
    for (const [v, val] of [['--ro-sw', m.sway + 's'], ['--ro-u', (rect.h / 100).toFixed(3) + 'px'], ['--ro-pat', (2.2 + (m.offset % 900) / 900) .toFixed(2) + 's']]) setVar(w, v, val);
    if (w._pid !== rect.pid) {
      w._pid = rect.pid; w.textContent = '';
      for (const [cls, part, key] of [['h', r.head, 'head'], ['l', r.l, 'l'], ['r', r.r, 'r']]) {
        if (!part) continue;
        const i = new Image(); i.className = cls; i.alt = ''; i.src = SD + rect.pid + '-rig' + key + '.webp';
        i.style.left = (part.x * 100) + '%'; i.style.top = (part.y * 100) + '%'; i.style.width = (part.w * 100) + '%'; i.style.height = (part.h * 100) + '%';
        i.style.transformOrigin = (part.px * 100) + '% ' + (part.py * 100) + '%';
        w.appendChild(i);
      }
      w._clock = false;
    }
    if (!w._clock) { w._clock = true; clock(w, m.offset); clock(pe, m.offset); for (const i of w.children) clock(i, m.offset + (i.className === 'r' ? 700 : 0)); }
  }

  /* fewer layers when frames drop: about 1 s in 20, read 40 frames (spec Changes 2026-11-01). lod 1: no rig; lod 2: no body movement either */
  let LOD = 0, lodBad = 0, lodGood = 0, lodTimer = 0;
  function watchFrames(ro) {
    if (lodTimer || !root.requestAnimationFrame) return;
    lodTimer = setTimeout(() => {
      lodTimer = 0;
      if (!CUR || CUR.ro !== ro || !ro.isConnected) return;
      if (!moving() || hiddenNow()) { watchFrames(ro); return; }
      let n = 0, t0 = 0;
      const step = (t) => {
        if (!t0) t0 = t;
        if (++n < 40) { root.requestAnimationFrame(step); return; }
        const fps = (n - 1) * 1000 / (t - t0);
        if (fps < 45) { lodGood = 0; if (++lodBad >= 2 && LOD < 2) { LOD++; lodBad = 0; apply(); } } else if (fps > 57) { lodBad = 0; if (++lodGood >= 6 && LOD > 0) { LOD--; lodGood = 0; apply(); } }
        watchFrames(ro);
      };
      const apply = () => { ro.classList.toggle('lod1', LOD === 1); ro.classList.toggle('lod2', LOD === 2); if (onArt) onArt(); };
      root.requestAnimationFrame(step);
    }, 20000);
  }

  /* a span with a status dot (the app's .dot classes, forced-colours aware) */
  const dotClass = (state) => 'dot ' + ({ limit: 'waiting', asleep: 'idle' }[state] || state);
  function dotHTML(state) { return '<span class="' + dotClass(state) + '" aria-hidden="true"></span>'; }

  /* FR-037: one person per session, kept in durbar.realpeople; the simulator uses a seeded pick so pictures repeat run to run */
  function people(model, ids, rand, remember) {
    const L = X();
    if (!PEOPLE) { PEOPLE = {}; if (remember) { try { const o = JSON.parse(localStorage.getItem(peopleKey()) || '{}'); if (o && typeof o === 'object' && !Array.isArray(o)) for (const [k, v] of Object.entries(o)) if (typeof v === 'string' && k.length <= 200 && ids.includes(v)) PEOPLE[k] = v; } catch (e) { PEOPLE = {}; } } }
    /* every main session of the app (model.sessions), not only the folders on screen: a filter must not hand a hidden session a new person */
    const sessions = model.sessions || model.folders.flatMap((f) => f.agents.map((a) => ({ id: a.id, folder: f.id })));
    const next = L.assignPeople(PEOPLE, sessions, ids, rand);
    if (JSON.stringify(next) !== JSON.stringify(PEOPLE)) { PEOPLE = next; if (remember) { try { localStorage.setItem(peopleKey(), JSON.stringify(PEOPLE)); } catch (e) { /* storage full or off: the pick still holds for this window */ } } }
    return PEOPLE;
  }

  /**
   * Draw the office into `stage`. `model`: {folders:[{id,name,path,cost,counts:[{state,n,word}],newSess,menu,agents:[{id,name,role,
   * state,word,task,label,tip,selected,away,awayLabel,helpers:[state],helpWords}]}], places:[{id,label,custom,post,title,go,visitors:[{id,name,
   * needsYou,title}]}]}; `view`: {w,h}; `opts`: {still, world, set, rand, remember, onArt}. Returns the layout (for the app's checks).
   */
  function render(stage, model, view, opts) {
    const L = X();
    const world = has(root.DurbarRealOfficeWorlds || {}, opts.world || 'photo') ? opts.world || 'photo' : 'photo', set = has(root.DurbarRealOfficeSets || {}, opts.set || 'office') ? opts.set || 'office' : 'office';
    WD = 'realoffice/worlds/' + world + '/'; SD = 'realoffice/sets/' + set + '/';
    if (SET_SHOWN !== set) { SET_SHOWN = set; PEOPLE = null; SEEN.clear(); } /* the people belong to a set: switching sets draws its own, kept apart */
    WPX = root.DurbarRealOfficeWorlds[world].px || {}; SPX = root.DurbarRealOfficeSets[set].px || {};
    const meta = Object.assign({}, root.DurbarRealOfficeWorlds[world], root.DurbarRealOfficeSets[set]); /* the world's furniture numbers with the set's people numbers */
    onArt = opts.onArt || null;
    meta.pixelPeople = !!root.DurbarRealOfficeSets[set].pixelArt; /* spec 097 T247: a crew's hi-res people in a pixel world are scaled to its people */
    PIXEL = !!meta.pixelArt;
    const ids = Object.keys(meta.seat).sort();
    const who = people(model, ids, opts.rand, !!opts.remember);
    const seatOk = (p) => !!p && !['typeA', 'think', 'waveA', 'rest'].some((f) => BAD.has(SD + p + '-' + f + '.webp'));
    const engine = {
      keepRooms: !!model.keepRooms, /* spec 097 FR-353: a saved room order is kept in the rows */
      folders: model.folders.map((f) => ({ id: f.id, keep: !!f.keep, agents: f.agents.map((a) => ({ id: a.id, state: a.state, away: a.away || null, person: seatOk(who[a.id]) ? who[a.id] : null, lounge: !!a.lounge, helpers: a.lounge || !a.subs ? 0 : a.subs.length })) })), /* spec 097 FR-246: the app's room rule (shutPlan) seats it in the lounge row; FR-306: the strip's helpers (none in the lounge; none without their list: the plate keeps its +N) */
      places: model.places.map((p) => ({ id: p.id, custom: !!p.custom, visitors: p.visitors.map((v) => ({ id: v.id, needsYou: !!v.needsYou, person: who[v.id] || null })) })),
    };
    const signs = {};
    for (const f of model.folders) signs[f.id] = { name: f.name, path: f.path, counts: f.counts.length + (f.cost ? 1 : 0) };
    /* spec 102 FR-228: the one seam; FR-230 (owner, 2026-11-14 13:10 UTC): a circle that does not fit at the face floor draws rows, and comes back only with two agents fewer than it left at (kept per world, window size and folder list, so another floor does not inherit it) */
    const arr = meta.arrangement && meta.arrangement !== 'rows' && L.layoutFor ? meta.arrangement : 'rows';
    let lay, ran = arr;
    if (arr === 'circle' && L.layoutWithFallback) {
      const n = engine.folders.reduce((c, f) => c + f.agents.length, 0), key = world + '|' + view.w + 'x' + view.h + '|' + engine.folders.map((f) => f.id).join(',');
      const r = L.layoutWithFallback('circle', engine, view, meta, signs, CIRCLE_HOLD && CIRCLE_HOLD.key === key ? CIRCLE_HOLD.at : undefined);
      lay = r.lay; ran = r.ran;
      if (ran === 'circle') CIRCLE_HOLD = null; else if (!CIRCLE_HOLD || CIRCLE_HOLD.key !== key) CIRCLE_HOLD = { key, at: n };
    } else lay = arr !== 'rows' ? L.layoutFor(arr, engine, view, meta, signs) : L.realLayout(engine, view, meta, signs);
    /* spec 102 delta 2026-11-11 (issue 1566): an arcade hall that would scroll takes the floor's own padding (`opts.lend`, px) when that makes it fit, so a strip over the floor does not make 15 agents scroll at 1280x800; `lent` tells the host to drop that padding */
    if (lay.scroll && opts.lend > 0 && meta.arrangement === 'aisles' && L.layoutFor) {
      const v2 = { w: view.w, h: view.h + opts.lend }, l2 = L.layoutFor(meta.arrangement, engine, v2, meta, signs);
      if (!l2.scroll) { lay = l2; view = v2; lay.lent = true; }
    }

    let ro = stage.querySelector(':scope > .ro');
    if (!ro) { stage.textContent = ''; ro = document.createElement('div'); ro.className = 'ro'; stage.appendChild(ro); ro.addEventListener('click', forward); wireZoom(ro); }
    sty(ro, 'width', px(lay.width)); sty(ro, 'height', px(lay.height));
    LAY_G = lay.cabinet ? lay.g || 0 : 0;
    if (lay.g) setVar(ro, '--ro-g', String(lay.g)); /* spec 102 FR-255: one integer scale for the world's art */
    dset(ro, 'set', set); dset(ro, 'world', world); dset(ro, 'arrangement', ran); dset(ro, 'u', String(Math.round(lay.u))); dset(ro, 'face', String(Math.round(lay.faceH * 10) / 10)); dset(ro, 'big', lay.big ? '1' : '0');
    ro.classList.toggle('still', !!opts.still);
    ro.classList.toggle('hold', !!opts.hold); /* the people stand still, the lights may not (FR-071) */
    const drawn = !!(CUR && CUR.ro === ro && CUR.drawn);
    if (!drawn) OFF.clear();
    if (ZOOM && !ZOOM.panel.isConnected) closeZoom();
    const sized = view.w + 'x' + view.h, sameSize = !!CUR && CUR.sized === sized && !!CUR.painted;
    const wasLive = CUR && CUR.ro === ro ? CUR.live : undefined;
    CUR = { pixelArt: !!meta.pixelArt, ro, live: opts.live, screenOf: opts.screenOf || null, factsOf: opts.factsOf || null, sized, still: !!opts.still, hold: !!opts.hold, desks: new Map(lay.zones.flatMap((z) => z.desks.map((d) => [d.id, d])).concat(lay.lounge ? lay.lounge.desks.map((d) => [d.id, d]) : [])), agents: new Map(model.folders.flatMap((f) => f.agents.map((a) => [a.id, { ...a, folder: f.name }]))), drawn, scroll: !!lay.scroll };
    SLIDE = sameSize && moving() && !hiddenNow();
    CUR.painted = true;
    ro.classList.toggle('paused', hiddenNow()); if (hiddenNow()) finishMoves(ro);
    /* z-order (plan: art < lights < chrome): floor and fixtures, people and desks; the ambient and the lights; then signs, plates, chips */
    const art = layerOf(ro, 'ro-art'), amb = layerOf(ro, 'ro-amb'), lights = layerOf(ro, 'ro-lights'), chrome = layerOf(ro, 'ro-chrome');
    const lobby = el(art, 'lobby', 'div', 'ro-lobby'); box(lobby, { x: 0, y: 0, w: lay.width, h: lay.lobbyH });
    const strip = el(art, 'strip', 'div', 'ro-strip'); box(strip, lay.floorStrip);
    if (lay.focus) { const fc = el(art, 'focus', 'div', 'ro-focus'); box(fc, lay.focus); fc.setAttribute('aria-hidden', 'true'); } /* spec 102 FR-227, T166: the one still picture the ring stands round; the world's stylesheet paints it, a picture that fails to load moves nothing */
    /* FR-043: the room ambient: the share of active desks among the visible ones */
    const allDesks = lay.zones.flatMap((z) => z.desks).concat(lay.lounge ? lay.lounge.desks : []); /* spec 097 FR-247: the lounge's seats are desks to the room's light, the zoom and the slips */
    const states = model.empty ? ['idle'] : allDesks.map((d) => d.state); /* FR-119: an empty floor is lit at 70 % (FR-043) */
    const ambient = L.ambientFor(states);
    const ambV = String(Math.round((1 - ambient) * 1000) / 1000);
    if (ro.style.getPropertyValue('--ro-amb') !== ambV) ro.style.setProperty('--ro-amb', ambV);
    dset(ro, 'ambient', String(ambient));
    const ambEl = el(amb, 'amb', 'div', 'ro-ambient'); box(ambEl, { x: 0, y: 0, w: lay.width, h: lay.height });

    EMPTY_BOX = null;
    if (model.empty) drawEmpty(art, chrome, lay, meta, model.empty);
    const byFolder = new Map(model.folders.map((f) => [f.id, f]));
    const byAgent = new Map(model.folders.flatMap((f) => f.agents.map((a) => [a.id, a])));
    const now = Date.now();
    for (const z of lay.zones) {
      const f = byFolder.get(z.id);
      const zk = z.id + '\u0000' + z.part; /* a folder too big for one row has more parts, each its own zone (the sign repeats, "continued") */
      const zb = el(art, 'z:' + zk, 'div', 'ro-zone'); box(zb, z.box);
      /* FR-018: the folder sign: name, path, counts, cost, + and the room menu (the app's own handlers: data-newsess, data-foldermenu) */
      const sg = el(chrome, 's:' + zk, 'div', 'ro-sign' + (z.signShort ? ' short' : '')); box(sg, { x: z.sign.x, y: z.sign.y, h: z.sign.h }); sty(sg, 'maxWidth', px(z.sign.w));
      dset(sg, 'folder', z.id);
      signFill(sg, f, z);
      for (const d of z.desks) deskOne(d);
    }
    if (lay.lounge) {
      for (const d of lay.lounge.desks) deskOne(d); /* spec 097 FR-247: after the desks */
      /* FR-249: keyboard order is the desks', then the seats': a plate that was a desk's keeps its element, so it is moved after the last desk's plate (and its pencil), unless it has the focus */
      const last = lay.zones.length ? lay.zones[lay.zones.length - 1].desks.slice(-1)[0] : null;
      let at = last ? chrome._k.get('h:' + last.id) || chrome._k.get('rn:' + last.id) || chrome._k.get('n:' + last.id) : null;
      for (const d of lay.lounge.desks) {
        const pl = chrome._k.get('n:' + d.id), rb = chrome._k.get('rn:' + d.id);
        if (!pl || pl.contains(document.activeElement) || (rb && rb.contains(document.activeElement))) { at = rb || pl || at; continue; }
        if (at && at.nextElementSibling !== pl) at.after(pl);
        if (rb && pl.nextElementSibling !== rb) pl.after(rb);
        at = rb || pl;
      }
    }
    function deskOne(d) {
        const a = byAgent.get(d.id), k = d.id;
        const lt = L.lightFor(d.state, { still: !!opts.still, unread: !!a.unread }); /* FR-236: a done desk with an unread reply tints green */
        const st = lay.cabinet ? L.aisleStatus(d.state, !!opts.still) : null; /* spec 102 FR-260 */
        /* the person, behind the desk: FR-036's pose, FR-070's second frame or breath, FR-072's cross-fade; FR-065: the initials disc when the picture failed */
        if (d.person) {
          const m = d.lounge ? { kind: null, period: 0, offset: 0, sway: 0, style: null } : L.personMotion(k, d.person.pose, d.state); /* FR-247: a lounge seat is a still picture: nothing runs there, in view or scrolled away (FR-181) */
          const fresh = !art._k.has('p:' + k);
          const rigged = d.person.pose === 'typeA' && moving() && LOD === 0 && !GLIDING.has(k) && !(fresh && CUR.drawn && WHERE.has(k)) && meta.rig && has(meta.rig, d.person.pid) ? meta.rig[d.person.pid] : null;
          const two = !rigged && moving() && m.kind === 'frames' && d.person.fileB && !BAD.has(SD + d.person.fileB) && !GLIDING.has(k) ? second(art, 'pb:' + k, k, d.person, d.person.fileB, 'ro-person2', m) : null;
          const pe = el(art, 'p:' + k, 'img', 'ro-person' + (a.asleep ? ' asleep' : '') + (lay.cabinet ? (st.bob && moving() ? ' bob' : '') : rigged ? ' m-rig' : two && two.on ? ' m-a m-' + m.style : m.kind === 'breathe' && moving() ? ' m-br' : '') + (OFF.has(k) ? ' ro-off' : ''));
          box(pe, d.person); dset(pe, 'for', k); dset(pe, 'pose', d.person.pose);
          if (d.facing) pe.classList.toggle('mir', d.facing === 'right');
          if (lay.cabinet) { /* FR-261: people in 4 phases on one clock, whenever each began: at most 8 frames a second */
            let h = 0; for (const c of k) h = (h * 31 + c.charCodeAt(0)) >>> 0; setVar(pe, '--ro-ph', -(h % 4) * 0.25 + 's');
            if (st.bob) for (const an of pe.getAnimations()) if (an.animationName && an.startTime !== 0) an.startTime = 0;
          }
          const was = pe.getAttribute('src');
          if (was && was !== SD + d.person.file && !lay.cabinet /* a pixel world swaps the frame: no second picture (FR-261) */ && moving() && !hiddenNow() && !OFF.has(k)) { const g = pe.cloneNode(false); art.insertBefore(g, pe); fadeAway(g, 120); pe.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 170, delay: 90, easing: 'ease-in-out', fill: 'backwards' }); } /* FR-072, spec Changes 2026-11-01: the old out, then the new in */
          img(pe, d.person.file, true, d.person.w);
          if (fresh && CUR.drawn && moving() && !hiddenNow() && !OFF.has(k) && !glide(pe, k, WHERE.get(k), d.person)) fadeIn(pe, 150, 150); /* FR-073: in at the desk */
          WHERE.set(k, d.person);
          if (m.kind) { setVar(pe, '--ro-per', m.period + 's'); setVar(pe, '--ro-sw', m.sway + 's'); setVar(pe, '--ro-u', (d.person.h / 100).toFixed(3) + 'px'); }
          if (rigged) rigOf(art, k, d.person, rigged, m, pe);
          if (two && two.on && !two.b._clock) { two.b._clock = true; clock(two.b, m.offset); clock(pe, m.offset); }
        } else if (d.lounge) { /* FR-065 in the lounge: the initials where the face would be */
          const ini = el(art, 'i:' + k, 'div', 'ro-initials'); box(ini, d.face); dset(ini, 'for', k); text(ini, initials(a.name));
        } else if (!d.narrow && !(lay.cabinet && a.away)) { /* at a cabinet, an empty place is the note on its glass */
          const ini = el(art, 'i:' + k, 'div', 'ro-initials'); const r = 0.5 * lay.u; box(ini, { x: d.slot.x + 0.05 * d.slot.w + 0.42 * lay.u - r / 2, y: d.desk.y - r - 6, w: r, h: r }); dset(ini, 'for', k); text(ini, initials(a.name));
        }
        /* spec 097 FR-247, FR-248: a lounge seat has the world's desk, small and whole, instead of a desk or a cabinet; FR-249: a desk picture that comes fades in */
        const fresh = !art._k.has((d.lounge ? 'ld:' : 'd:') + k) && CUR.drawn && moving() && !hiddenNow();
        if (d.lounge) { const t = el(art, 'ld:' + k, 'img', 'ro-ltable'); box(t, d.table); dset(t, 'for', k); img(t, 'desk.webp', false, d.table.w); if (fresh) fadeIn(t, 220); }
        else {
          const dc = el(art, 'd:' + k, 'div', 'ro-desk' + (d.narrow ? ' narrow' : '') + (lay.cabinet ? ' ro-cab' + (d.facing === 'right' ? ' mir' : '') : '')); box(dc, d.desk); dset(dc, 'for', k);
          if (lay.cabinet) cabinetOf(dc, meta, lay.cabinet, k, d.state, d.body);
          else { const dk = dc.firstChild || dc.appendChild(document.createElement('img')); sty(dk, 'height', px(d.desk.full)); img(dk, 'desk.webp', false, d.desk.w); }
          if (fresh) fadeIn(dc, 220);
        }
        /* the monitor: the glass in the art; its text sits with the chrome, above the lights (FR-044), and repaints on its own (FR-033) */
        const sc = el(art, 'm:' + k, 'div', 'ro-screen st-' + d.state + (lt.glow === 'off' ? ' off' : '') + (a.asleep ? ' asleep' : '') + (d.lounge ? ' ro-lmon' : '') + (lt.tint !== 'none' ? ' tint-' + lt.tint : '')); /* FR-236: the screen is the status cue */ box(sc, d.screen); dset(sc, 'for', k);
        if (!sc.firstChild) sc.innerHTML = '<div class="ro-bezel"><div class="ro-glass" aria-hidden="true"></div></div><div class="ro-neck"></div><div class="ro-foot"></div><svg class="ro-ctx" aria-hidden="true" focusable="false"><rect class="ro-ck" pathLength="100" fill="none"/><rect pathLength="100" fill="none"/></svg>'; /* spec 097 FR-324: the context line, made once per desk */
        const bez = sc.firstChild; bez.style.height = px(d.glass.h + 6);
        ctxPaint(sc, a, d); /* FR-322: the line round the frame, outside the glass; attributes only (FR-326) */
        if (!d.lounge) screenBox(chrome, d, k);
        else { const s = SCR.get(k); if (s) { clearTimeout(s.timer); if (IO) IO.unobserve(s.box); SCR.delete(k); } } /* FR-247: a lounge monitor shows no text (the zoom still reads its last lines, FR-034) */
        /* spec 102 FR-257: the marquee carries the name: real text, level, never inside the mirrored picture */
        if (d.marquee) {
          const mq = el(chrome, 'mq:' + k, 'div', 'ro-marquee mq-' + st.marquee); box(mq, d.marquee); attr(mq, 'aria-hidden', 'true'); text(mq, a.name); dset(mq, 'for', k);
          /* the flash is opacity on the marquee's own ::after: no node, and it moves with the marquee (FR-261); one beat for all of them */
          if (/flash/.test(st.marquee)) for (const an of mq.getAnimations({ subtree: true })) if (an.startTime !== 0) an.startTime = 0;
          const gc = meta.glow, gi = Math.max(0, gc.cells.indexOf(d.state)), gw = gc.cell[0] * lay.g, gh = gc.cell[1] * lay.g;
          const fg = el(art, 'fg:' + k, 'div', 'ro-fglow g-' + st.glow); box(fg, { x: Math.max(d.slot.x, Math.min(d.desk.x + (d.desk.w - gw) / 2, d.slot.x + d.slot.w - gw)), y: d.plate.y - gh / 2, w: gw, h: gh }); dset(fg, 'for', k);
          const gp = (gi / Math.max(1, gc.cells.length - 1)) * 100 + '% 0'; if (fg.style.backgroundPosition !== gp) fg.style.backgroundPosition = gp;
          const q = el(chrome, 'cu:' + k, 'div', 'ro-cue cue-' + st.cue); box(q, d.cue); dset(q, 'for', k); attr(q, 'aria-hidden', 'true'); text(q, { none: '', dots: '\u2022\u2022\u2022', ask: '?', bang: '!', tick: '\u2713', zz: 'z z' }[st.cue]);
          const co = el(chrome, 'co:' + k, 'div', 'ro-coin'); box(co, { x: d.face.x + d.face.w / 2 - 3 * lay.g, y: d.face.y, w: 6 * lay.g, h: 6 * lay.g }); attr(co, 'aria-hidden', 'true'); dset(co, 'for', k);
        }
        /* FR-040, FR-041: lamp and screen glow, as classes over the art (D4); the status cue is the screen's tint (FR-236) */
        const lamp = el(lights, 'l:' + k, 'div', 'ro-lamp lamp-' + lt.lamp + (lt.motion === 'pulse' ? ' pulse' : '')); box(lamp, d.lamp); dset(lamp, 'for', k);
        const glow = el(lights, 'g:' + k, 'div', 'ro-glow glow-' + lt.glow + (lt.motion === 'breathe' ? ' breathe' : '')); box(glow, { x: d.glass.x - 6, y: d.glass.y - 6, w: d.glass.w + 12, h: d.glass.h + 12 });
        if (L.doneTick(SEEN, k, d.state) && st && st.flourish && moving() && !hiddenNow()) coinUp(chrome, k, lay.g); /* spec 102 FR-261: the arcade's coin on a turn to done (FR-236: no call light any more) */
        /* FR-238: "New reply" above the plate's right end while the reply is unread (the flat desk's "New", the same isUnread); made once, shown by class */
        const nt = el(chrome, 'nr:' + k, 'span', 'ro-newtag' + (a.unread ? ' on' : '')); box(nt, { x: d.plate.x + d.plate.w, y: d.plate.y }); attr(nt, 'aria-hidden', 'true'); text(nt, 'New reply'); dset(nt, 'for', k);
        /* spec 097 FR-316: "Draft" above the plate's left end while the chat has an unsent draft (the flat desk's pencil, the same hasDraft); made once, shown by class; aria-hidden (the plate's name says it) */
        const dt = el(chrome, 'dr:' + k, 'span', 'ro-drafttag' + (a.draft ? ' on' : '')); box(dt, d.away ? { x: d.away.x - d.away.s / 2, y: d.away.y } : { x: d.plate.x, y: d.plate.y }); /* an empty seat's post-it fills the place above the plate: the tag sits on top of the note's left corner */ attr(dt, 'aria-hidden', 'true'); dset(dt, 'for', k);
        if (!dt.firstChild) { if (model.draftIcon) dt.innerHTML = model.draftIcon; dt.appendChild(document.createTextNode('Draft')); } /* the icon is the app's own markup (trusted, as renIcon) */
        /* FR-038: cues, inside the slot */
        if (d.bubble) { const b = el(chrome, 'b:' + k, 'div', 'ro-bub'); box(b, d.bubble); attr(b, 'aria-hidden', 'true'); text(b, '?'); }
        if (d.bang) { const b = el(chrome, 'x:' + k, 'div', 'ro-bang'); box(b, d.bang); attr(b, 'aria-hidden', 'true'); text(b, '!'); }
        if (d.dots) { const b = el(chrome, 't:' + k, 'div', 'ro-dots'); box(b, d.dots); attr(b, 'aria-hidden', 'true'); if (!b.firstChild) b.innerHTML = '<i></i><i></i><i></i>'; }
        if (d.away) { const w = el(chrome, 'a:' + k, 'div', 'ro-away'); dset(w, 'place', a.away); if (a.away === 'coffee') dset(w, 'surface', 'coffee-bar'); /* spec 098 FR-010: the moment's marker */ w.style.setProperty('--ro-note', L.notePaper(a.away)); w.style.setProperty('--ro-note-ink', L.NOTE_INK); box(w, { x: d.away.x, y: d.away.y, w: d.away.s, h: d.away.s }); text(w, 'at ' + a.awayLabel); if (!w._in && CUR.drawn && moving() && !hiddenNow()) w.animate([{ transform: 'translateX(-50%) rotate(-2.5deg) scale(.7)', opacity: 0 }, { transform: 'translateX(-50%) rotate(-2.5deg)', opacity: 1 }], { duration: ZOOM_IN, delay: ZOOM_OUT - 40, easing: 'cubic-bezier(.2,.7,.3,1)', fill: 'backwards' }); w._in = true; }
        /* FR-120: a static "z z" over a sleeping person (carved in the cave); aria-hidden, the plate and the name carry the meaning */
        if (a.asleep && d.person) { const z = el(chrome, 'z:' + k, 'div', 'ro-zz'); box(z, { x: d.person.x + d.person.w * 0.62, y: Math.max(d.slot.y + 2, d.person.y + d.person.h * 0.04) }); attr(z, 'aria-hidden', 'true'); text(z, 'z z'); }
        /* FR-016, FR-090: the name plate is the desk's one focusable button; the app's click handler opens the chat ([data-id]) */
        const pl = el(chrome, 'n:' + k, 'button', 'ro-plate st-' + d.state + (a.selected ? ' sel' : '') + (d.narrow ? ' narrow' : '') + (a.asleep ? ' asleep' : '') + (d.lounge ? ' lounge' : '') + (a.ren ? ' has-ren' : '') + (!d.strip && a.helpers && a.helpers.length ? ' has-help' : '')); const plEase = box(pl, d.plate); /* has-help: the plate carries the +N (FR-308); a class, not :has(), so one text change does not re-match the arcade's whole tree */
        if (pl.type !== 'button') pl.type = 'button'; dset(pl, 'id', k); dset(pl, 'state', d.state); if (d.lounge) dset(pl, 'surface', 'lounge'); else if (pl.dataset.surface) delete pl.dataset.surface; /* spec 098 FR-010: the moment's marker (spec 097 FR-246: every lounge seat) */
        /* spec 097 FR-308 (review of PR 1322): helpers with no strip (the fallback: the plate's +N and dots) are said in the plate's name and tooltip, in the flat desk's words (`helpWords`); FR-325: so is the context (`labelOf`) */
        const hw = helpWordsOf(a, d);
        attr(pl, 'aria-pressed', a.selected ? 'true' : 'false'); attr(pl, 'aria-label', labelOf(a, d)); attr(pl, 'title', hw ? a.tip + ' · ' + hw.slice(2) : a.tip);
        plateFill(pl, a, d.state, !!d.strip);
        /* spec 059 FR-170 (#1155): Open office's rename pencil (.ren[data-ren]: the app's own click and F2 handlers, the same in-place edit), right
           after its plate (a button cannot sit inside one) so the plate's hover and focus show it; CSS anchors it just after the name: no layout read */
        if (a.ren) {
          /* spec 097 FR-357 (#1427): two anchors, the name and the plate; the world's CSS picks the plate where the plate does not draw the name (an arcade cabinet's) */
          const anc = '--ren-' + k.replace(/[^A-Za-z0-9_-]/g, '_'), ancP = anc + '-pl', nm = pl._parts.nm;
          if (nm.style.getPropertyValue('anchor-name') !== anc) nm.style.setProperty('anchor-name', anc);
          if (pl.style.getPropertyValue('anchor-name') !== ancP) pl.style.setProperty('anchor-name', ancP);
          const rb = el(chrome, 'rn:' + k, 'button', 'ren ro-ren');
          if (pl.nextElementSibling !== rb) pl.after(rb);
          if (rb.type !== 'button') rb.type = 'button'; dset(rb, 'ren', k); attr(rb, 'aria-label', 'Rename ' + a.name); attr(rb, 'title', 'Rename ' + a.name);
          if (rb.style.getPropertyValue('--ro-ren-nm') !== anc) { rb.style.setProperty('--ro-ren-nm', anc); rb.style.setProperty('--ro-ren-pl', ancP); }
          if (!rb.firstChild && model.renIcon) rb.innerHTML = model.renIcon; /* the app's own icon markup (trusted, as alertIcon) */
          const fresh = !rb._ren; rb._ren = true;
          const mv = plEase || (fresh ? easeOf(pl) : null); /* FR-365: a pencil made (or come back) while its plate eases waits for the rest of it */
          if (mv && rb !== document.activeElement) hideWhile(rb, mv); /* FR-365 */
        }
        /* spec 097 FR-306..FR-309 (issue #1139): the helpers' head figures under the plate, right after it and its pencil in the Tab order; a lounge seat and the fallback (no room: the plate keeps +N; the arcade at 1280x800) have no strip box, so no strip */
        if (d.strip && a.subs && a.subs.length) helperStrip(chrome, d, a, k, who, ids, meta);
        else if (chrome._k.get('h:' + k)) { chrome._k.get('h:' + k).remove(); chrome._k.delete('h:' + k); }
    }
    /* the lobby band: fixtures, their lights, visitors and chips, place plates (FR-023..FR-027, FR-045) */
    const byPlace = new Map(model.places.map((p) => [p.id, p]));
    for (const fx of lay.fixtures) {
      const p = byPlace.get(fx.id), file = 'fx-' + fx.id + '.webp';
      if (fx.art && !fx.custom && !BAD.has(WD + file)) { const im = el(art, 'f:' + fx.id, 'img', 'ro-fx'); box(im, fx.art); dset(im, 'place', fx.id); img(im, file); }
      else if (fx.art && fx.custom) { const ki = el(art, 'f:' + fx.id, 'div', 'ro-kiosk'); dset(ki, 'place', fx.id); box(ki, { x: fx.art.x + fx.art.w * 0.2, y: fx.art.y + fx.art.h * 0.35, w: fx.art.w * 0.6, h: fx.art.h * 0.65 }); if (ki._ic !== p.icon) { ki._ic = p.icon; ki.innerHTML = p.icon || ''; } }
      const fl = L.fixtureLight(fx.id, p.visitors.length, p.visitors.some((v) => v.needsYou));
      if (fl && fx.art) { const li = el(lights, 'fl:' + fx.id, 'div', 'ro-fxl fxl-' + fl + (fx.id === 'boss' ? ' boss' : '')); box(li, fx.light); }
      for (const v of fx.visitors) {
        const ag = p.visitors.find((x) => x.id === v.id);
        if (v.fig && !BAD.has(SD + v.fig.file)) {
          /* owner 2026-10-31 10:19 and 10:48: the feet on the front floor plane (layout), with a soft contact shadow under them */
          const sh = el(art, 'vs:' + v.id, 'div', 'ro-shadow'); box(sh, v.shadow);
          /* FR-070: stride frames, a knock or a breath; FR-073: in at the fixture after the fade at the desk */
          const m = L.personMotion(v.id, v.fig.pose, null), fresh = !art._k.has('v:' + v.id), mov = moving() && !OFF.has(v.id);
          const two = mov && m.kind === 'frames' && v.fig.fileB && !BAD.has(SD + v.fig.fileB) && !(GLIDING.has(v.id) || (fresh && CUR.drawn && WHERE.has(v.id))) ? second(art, 'vb:' + v.id, v.id, v.fig.b || v.fig, v.fig.fileB, 'ro-visitor2', m) : null;
          const cl = two && two.on ? ' m-a m-' + m.style : mov ? ({ breathe: ' m-br', knock: ' m-knock' }[m.kind] || '') : '';
          const im = el(art, 'v:' + v.id, 'img', 'ro-visitor' + cl); box(im, v.fig); dset(im, 'for', v.id); dset(im, 'place', fx.id); dset(im, 'pose', v.fig.pose); dset(im, 'faces', v.fig.faces); dset(im, 'feet', String(Math.round(v.fig.feetY * 10) / 10)); img(im, v.fig.file, true, v.fig.w);
          if (cl) { setVar(im, '--ro-per', m.period + 's'); setVar(im, '--ro-sw', m.sway + 's'); setVar(im, '--ro-u', (v.fig.h / 100).toFixed(3) + 'px'); setVar(im, '--ro-org', '50% ' + px(v.fig.feetY - v.fig.y)); }
          if (fresh && CUR.drawn && moving() && !hiddenNow() && !glide(im, v.id, WHERE.get(v.id), v.fig)) fadeIn(im, 150, 150);
          WHERE.set(v.id, v.fig);
          if (two && two.on && !two.b._clock) { two.b._clock = true; clock(two.b, m.offset); clock(im, m.offset); }
        }
        /* FR-026 "as the flat lobby": a go-place visitor (Boss, Bank, Coffee) is the flat lobby's own button (data-pvopen, and
           data-coffeeid for the coffee menu): app.js's delegated handlers open the chat; others forward to their plate (data-for) */
        const ch = el(chrome, 'vc:' + v.id, p.go ? 'button' : 'span', 'ro-chip' + (ag.needsYou ? ' wait' : '')); dset(ch, 'y', String(v.chip.y)); dset(ch, 'x', String(v.chip.x)); /* its place is stagger()'s to write */
        if (p.go) { if (ch.type !== 'button') ch.type = 'button'; dset(ch, 'pvopen', v.id); if (fx.id === 'coffee') dset(ch, 'coffeeid', v.id); attr(ch, 'aria-label', ag.title + '. Open the chat.'); } else dset(ch, 'for', v.id);
        dset(ch, 'place', fx.id); attr(ch, 'title', ag.title); dset(ch, 'name', ag.name); chipFill(ch, ag.name, ag.needsYou, model.alertIcon);
      }
      /* FR-025/FR-026 "as the flat lobby": the people that do not fit ("+N") open the flat lobby's own list (data-placemore, app.js
         openPlaceMenu), so the plate is a button then, with a name that says so */
      const pl = el(chrome, 'fp:' + fx.id, p.post || fx.more > 0 ? 'button' : 'div', 'ro-lplate' + (p.visitors.some((v) => v.needsYou) ? ' wait' : '')); box(pl, { x: fx.plate.x, y: fx.plate.y });
      if (p.post) { if (pl.type !== 'button') pl.type = 'button'; dset(pl, 'post', '1'); } else if (fx.more > 0) { if (pl.type !== 'button') pl.type = 'button'; dset(pl, 'placemore', fx.id); attr(pl, 'aria-haspopup', 'menu'); } else { attr(pl, 'role', 'group'); }
      dset(pl, 'place', fx.id); sty(pl, 'maxWidth', px(Math.max(44, fx.plate.w)));
      attr(pl, 'title', fx.more > 0 ? p.title + '. ' + fx.more + ' more: open the list.' : p.title); attr(pl, 'aria-label', fx.more > 0 ? p.title + '. ' + fx.more + ' more: open the list.' : p.title);
      /* owner 2026-10-31 09:03: no bare count when the people are visible; "+N" only for those that do not fit */
      const lsig = JSON.stringify([p.label, fx.more]);
      if (pl._sig !== lsig) { pl._sig = lsig; pl.textContent = ''; const s = document.createElement('span'); s.textContent = p.label; pl.appendChild(s); if (fx.more > 0) { const b = document.createElement('b'); b.className = 'ro-more'; b.textContent = '+' + fx.more; pl.appendChild(b); } }
    }
    drawSlips(chrome, lay, model.slips);
    sweep(art, drawn && moving() && !hiddenNow()); [amb, lights, chrome].forEach((l) => sweep(l));
    for (const id of WHERE.keys()) if (!CUR.agents.has(id)) WHERE.delete(id); /* a session gone: what stays is bounded by the sessions there are */
    watchBody(); wasHidden = hiddenNow();
    fitRoles(chrome); /* keeps its own record of what it measured */
    /* FR-184: a status update reads no layout here: chips and plates are measured and placed again only when one of them or the width changed */
    const lobbySig = JSON.stringify([lay.width, [...chrome.querySelectorAll(':scope > .ro-chip')].map((c) => [c.dataset.name, c.dataset.x, c.dataset.y, !!c._ic]), [...chrome.querySelectorAll(':scope > .ro-lplate')].map((e) => [e.dataset.place, e.title, e.style.left, e.style.top])]);
    if (chrome._lobbySig !== lobbySig) { placeLobby(chrome, lay.width); chrome._lobbySig = document.hidden || document.body.classList.contains('panel-open') ? null : lobbySig; } /* under a chat nothing is laid out: what it measures there is not remembered */
    else for (const e of chrome.querySelectorAll(':scope > .ro-chip, :scope > .ro-lplate')) if (e._at) { sty(e, 'left', e._at[0]); sty(e, 'top', e._at[1]); if (e._at[2]) sty(e, 'maxWidth', e._at[2]); } /* the draw above wrote the unplaced box: back to where they were placed */
    /* a chip or plate does not travel: it fades in where it now is, so nothing passes over anything (owner 2026-11-01) */
    for (const e of chrome.querySelectorAll(':scope > .ro-chip, :scope > .ro-lplate')) {
      const L = parseFloat(e.style.left), T = parseFloat(e.style.top);
      if (SLIDE && e._lx !== undefined && (Math.abs(e._lx - L) >= 0.5 || Math.abs(e._ly - T) >= 0.5)) e.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220, easing: 'ease-out' });
      e._lx = L; e._ly = T;
    }
    for (const [id, s] of SCR) if (!CUR.desks.has(id)) { clearTimeout(s.timer); if (IO) IO.unobserve(s.box); SCR.delete(id); }
    watchOff(lay);
    SLIDE = false;
    CUR.drawn = true;
    whenReady(ro);
    if (moving() && !meta.pixelArt) onGrid(ro);
    if (moving() && !hiddenNow()) handOver(ro);
    watchFrames(ro);
    if (wasLive !== undefined && wasLive !== CUR.live) for (const [id, s] of SCR) { /* the setting holds at once: it does not wait for the next line, or the repaint pace */
      if (s.away || hiddenNow()) s.dirty = true; else { clearTimeout(s.timer); s.timer = 0; s.dirty = false; paintScreen(id); }
    }
    if (ZOOM) {
      const zd = CUR.desks.get(ZOOM.id);
      if (!zd || hiddenNow()) closeZoom(); /* FR-328: an asleep agent's card stays (its glass is dark, the card has its reply) */
      else { if (ZOOM.st !== zd.state) { fillZoom(); ZOOM.held = PT || '?'; } placeZoom(); } /* FR-328 (2026-11-08): the card follows the agent's state as its facts do (FR-315): asleep or back, it is filled again, not left with the old tool log */
    }
    settle(chrome, lay.width);
    return lay;
  }

  /* FR-018, FR-184: the folder sign keeps its nodes: only the counts and the cost change on a status update, and the + and the room menu keep the focus */
  function signFill(sg, f, z) {
    const sig = JSON.stringify([f.name, f.path, !!f.cost, f.newSess, f.menu, z.part]);
    if (sg._sig !== sig) {
      sg._sig = sig; sg.textContent = ''; sg._cnt = null; sg._cost = null;
      const b = document.createElement('b'); b.textContent = z.part > 1 ? f.name + ' (continued)' : f.name; b.title = f.name + '\n' + f.path; sg.appendChild(b); sg._b = b;
      if (z.part > 1) return;
      const p = document.createElement('span'); p.className = 'ro-path'; p.textContent = f.path; sg.appendChild(p);
      const sc = document.createElement('span'); sc.className = 'ro-sc'; sg._sc = sc; sg._cnt = new Map();
      if (f.cost) { const m = document.createElement('span'); m.className = 'ro-cost'; sc.appendChild(m); sg._cost = m; }
      if (f.newSess) { const nb = document.createElement('button'); nb.type = 'button'; nb.className = 'ro-sb'; nb.dataset.newsess = z.id; nb.title = 'New session in ' + f.name; nb.setAttribute('aria-label', 'New session in ' + f.name); nb.textContent = '+'; sc.appendChild(nb); }
      if (f.menu) { const mb = document.createElement('button'); mb.type = 'button'; mb.className = 'ro-sb'; mb.dataset.foldermenu = z.id; mb.setAttribute('aria-haspopup', 'menu'); mb.setAttribute('aria-label', 'Folder actions for ' + f.name); mb.title = 'Folder actions'; mb.textContent = '⋯'; sc.appendChild(mb); }
      sg.appendChild(sc);
    }
    if (!sg._cnt) return;
    if (sg._cost) { text(sg._cost, f.cost); attr(sg._b, 'title', f.name + '\n' + f.path + (z.signShort ? '\n' + f.cost : '')); } /* FR-256, FR-356: the short sign hides the cost, so its name's hover says it */
    /* one count per state, reused by state and kept in the model's order, in front of the cost and the buttons */
    const sc = sg._sc, live = new Set(f.counts.map((c) => c.state));
    for (const [st, e] of sg._cnt) if (!live.has(st)) { e.remove(); sg._cnt.delete(st); }
    let next = sc.firstChild;
    for (const c of f.counts) {
      let e = sg._cnt.get(c.state);
      if (!e) { e = document.createElement('span'); e.className = 'ro-cnt'; e.insertAdjacentHTML('beforeend', dotHTML(c.state)); e._n = document.createTextNode(''); e.appendChild(e._n); sg._cnt.set(c.state, e); }
      if (e._n.data !== String(c.n)) e._n.data = String(c.n);
      attr(e, 'title', c.n + ' ' + c.word);
      if (e === next) next = next.nextSibling; else sc.insertBefore(e, next);
    }
  }

  /* spec 097 FR-322..FR-326: the context line round a desk's monitor frame. One svg with one rect per desk (made with the monitor); the rect's dash is the share of
     its outline (pathLength 100, from the top-left corner, clockwise), its band is data-lv (the CSS colours it from the theme tokens). No line for an unknown
     context, a known 0 % or a lounge seat. Only attributes and two custom properties change: no node, no layout read. */
  function ctxPaint(sc, a, d) {
    const s = sc.lastElementChild; if (!s || !s.classList.contains('ro-ctx')) return;
    const f = d && d.lounge ? null : X().ctxFrame(a.ctx && a.ctx.pct, a.ctx && a.ctx.level);
    const lv = f ? f.lv : '', dash = f ? f.dash : '';
    if ((s.dataset.lv || '') !== lv) { if (lv) s.dataset.lv = lv; else delete s.dataset.lv; }
    for (const r of s.children) attr(r, 'stroke-dasharray', dash || null); /* the dark keyline under the line (.ro-ck) and the line itself: the same dash */
    if (d) { setVar(s, '--ro-cw', px(d.screen.w)); setVar(s, '--ro-ch', px(CUR && CUR.pixelArt ? d.screen.h : d.glass.h + 6)); /* the arcade's screen box is the whole frame; the others' is the bezel */ }
  }
  /* FR-325: the plate's name with the context in the flat office's words, before "Open chat panel."; a lounge seat's name is the model's */
  const OPEN_WORDS = '. Open chat panel.';
  function helpWordsOf(a, d) { return d && !d.strip && a.helpWords && a.helpers && a.helpers.length ? a.helpWords : ''; } /* FR-308: the fallback plate's helper count, in the flat desk's words */
  function labelOf(a, d) {
    const w = d && d.lounge ? '' : X().ctxWords(a.ctx && a.ctx.pct), hw = helpWordsOf(a, d), l = String(a.label || '');
    return l.endsWith(OPEN_WORDS) ? l.slice(0, -OPEN_WORDS.length) + w + hw + OPEN_WORDS : l + hw; /* the context words, then the helpers' (". 6 helpers" stays one phrase) */
  }
  /* FR-326: a context event of one agent: its line and its plate's name, without a draw; the next draw writes the same */
  function ctx(id, c) {
    if (!CUR) return false;
    const a = CUR.agents.get(id), d = CUR.desks.get(id); if (!a || !d) return false;
    a.ctx = c || null;
    const sc = CUR.ro.querySelector('.ro-screen[data-for="' + CSS.escape(id) + '"]'), pl = CUR.ro.querySelector('.ro-plate[data-id="' + CSS.escape(id) + '"]');
    if (sc) ctxPaint(sc, a, d);
    if (pl) attr(pl, 'aria-label', labelOf(a, d));
    return true;
  }
  /* spec 097 FR-306..FR-309, FR-184 (issue #1139): one desk's helper strip of head figures. The container (key h:<id>) sits in the layout's strip box; each helper is one button (data-id: the app's own click opens its
     Sub-agent activity view) kept by id, so a status change writes only the dot's class, the edge and the labels, never a node; the name is only in the accessible name and the tooltip (no tile). `+K` and
     `Show fewer` are the one button the app's [data-more] handler folds. `a.subs`: the helpers in `orderedHelpers` order ({id,name,state,label,title,selected}); the picture is a person of the set, never the parent's
     (`helperPerson`), cropped on the head by `headCrop`, from the seated rest picture (`SD + person-rest.webp`, the half-size file by `img`'s own rule). Opened, all helpers show in one scrolling row (a fixed height, FR-015). */
  function helperStrip(chrome, d, a, k, who, ids, meta) {
    const L = X(), st = d.strip, subs = a.subs, open = !!a.subsOpen && subs.length > st.shown;
    const bx = el(chrome, 'h:' + k, 'div', 'ro-hstrip' + (open ? ' open' : ''));
    box(bx, { x: st.x, y: st.y, w: st.w, h: st.h });
    attr(bx, 'role', 'group'); attr(bx, 'aria-label', 'Helpers of ' + a.name);
    setVar(bx, '--ro-hc', String(Math.max(1, st.cols)));
    setVar(bx, '--ro-head', L.HEAD + 'px');
    const anchor = chrome._k.get('rn:' + k) || chrome._k.get('n:' + k);
    if (anchor && anchor.nextElementSibling !== bx && !bx.contains(document.activeElement)) anchor.after(bx);
    if (!bx._b) bx._b = new Map();
    const shown = open ? subs : subs.slice(0, st.shown), hidden = open ? [] : subs.slice(st.shown);
    const want = [];
    const seat = meta.seat || {};
    for (const h of shown) {
      let b = bx._b.get(h.id);
      if (!b) {
        b = document.createElement('button'); b.type = 'button'; bx._b.set(h.id, b);
        b._pic = document.createElement('span'); b._pic.className = 'ro-hp'; b._pic.setAttribute('aria-hidden', 'true');
        b._dot = document.createElement('span'); b._dot.setAttribute('aria-hidden', 'true');
        b.append(b._pic, b._dot);
      }
      const cls = 'ro-hd st-' + h.state + (h.selected ? ' sel' : '');
      if (b.className !== cls) b.className = cls;
      const dc = dotClass(h.state); if (b._dot.className !== dc) b._dot.className = dc;
      const person = L.helperPerson ? L.helperPerson(h.id, who[a.id], ids) : null, sm = person && has(seat, person) ? seat[person] : null, file = person ? person + '-rest.webp' : '';
      if (sm && !BAD.has(SD + file) && L.headCrop) {
        const c = L.headCrop(sm), f = L.HEAD / c.s;
        let im = b._img;
        if (!im) { im = b._img = document.createElement('img'); b._pic.textContent = ''; b._pic.appendChild(im); }
        sty(im, 'width', px(sm.w * f)); sty(im, 'left', px(-c.x * f)); sty(im, 'top', px(-c.y * f));
        img(im, file, true, sm.w * f);
      } else {
        if (b._img) { b._img = null; b._pic.textContent = ''; }
        if (!b._pic.firstChild || b._pic.firstChild.className !== 'ro-hg') { b._pic.textContent = ''; const g = document.createElement('span'); g.className = 'ro-hg'; b._pic.appendChild(g); } /* FR-065: no picture, a neutral silhouette (CSS), never a letter of the name: the name is drawn nowhere */
      }
      dset(b, 'id', h.id); attr(b, 'aria-pressed', h.selected ? 'true' : 'false'); attr(b, 'aria-label', h.label); attr(b, 'title', h.title);
      want.push(b);
    }
    for (const [id, b] of bx._b) if (!shown.some((h) => h.id === id)) { b.remove(); bx._b.delete(id); }
    if (hidden.length || open) {
      let m = bx._more;
      if (!m) { m = bx._more = document.createElement('button'); m.type = 'button'; m.className = 'ro-hmore'; }
      dset(m, 'more', a.id);
      text(m, open ? 'Fewer' : '+' + hidden.length);
      attr(m, 'aria-expanded', open ? 'true' : 'false'); attr(m, 'aria-label', open ? 'Show fewer helpers of ' + a.name : 'Show ' + hidden.length + ' more helpers of ' + a.name); attr(m, 'title', open ? 'Show fewer helpers' : hidden.map((h) => h.name).slice(0, 8).join(', ') + (hidden.length > 8 ? ', ...' : ''));
      want.push(m);
    } else if (bx._more) { bx._more.remove(); bx._more = null; }
    let next = bx.firstChild;
    for (const e of want) { if (e === next) next = next.nextSibling; else bx.insertBefore(e, next); }
  }

  /* FR-016, FR-184: the plate keeps its nodes on a status change: only the text and the dot that changed are written (a helper's list is rebuilt when it changes) */
  /* `strip`: the desk's helpers are drawn as head figures (spec 097 FR-306), so the plate keeps no +N and dots; they stay when the strip cannot be drawn (FR-308's last step, the arcade) */
  function plateFill(pl, a, state, strip) {
    let P = pl._parts;
    if (!P) {
      P = pl._parts = { l1: document.createElement('span'), nm: document.createElement('b'), rl: document.createElement('span'), l2: document.createElement('span'), dot: document.createElement('span'), wd: document.createElement('span'), tk: document.createElement('span'), h: null, hs: '' };
      P.l1.className = 'ro-l1'; P.rl.className = 'ro-role'; P.l1.append(P.nm, P.rl);
      P.l2.className = 'ro-l2'; P.dot.setAttribute('aria-hidden', 'true'); P.wd.className = 'ro-wd'; P.tk.className = 'ro-tk'; P.l2.append(P.dot, P.wd, P.tk); /* the status word and the task are two runs: where the line is a flex row (the arcade's plate with helpers) only the task gives way */
      pl.textContent = ''; pl.append(P.l1, P.l2);
    }
    text(P.nm, a.name); text(P.rl, a.role);
    const hs = strip ? '' : a.helpers.join();
    if (P.hs !== hs) {
      P.hs = hs; if (P.h) { P.h.remove(); P.h = null; }
      if (hs) { P.h = document.createElement('span'); P.h.className = 'ro-help'; const hc = document.createElement('span'); hc.className = 'ro-hc'; hc.textContent = '+' + a.helpers.length + ' '; P.h.appendChild(hc); a.helpers.slice(0, 3).forEach((s) => P.h.insertAdjacentHTML('beforeend', dotHTML(s))); P.l1.appendChild(P.h); }
    }
    const dc = dotClass(state), word = a.word ? ' ' + a.word : '', task = a.task ? (a.word ? ' · ' : ' ') + a.task : ''; /* word + task read as before: ' Word · task' */
    if (P.dot.className !== dc) P.dot.className = dc;
    if (P.wd.textContent !== word) P.wd.textContent = word;
    if (P.tk.textContent !== task) P.tk.textContent = task;
  }


  /* spec 097 FR-119 (empty office): a floor with nothing on it. Three empty desks of the world, their screens off, under the plate that holds
     the flat office's own sentence (word for word, textContent). The shared lobby above is the real one (the caller passes the places). */
  function drawEmpty(art, chrome, lay, meta, empty) {
    const W = lay.width, top = lay.lobbyH, H = lay.height - top;
    const dw = Math.max(120, Math.min(W * 0.26, 340, (H - 60) / 0.7)), dh = dw * (meta.desk[1] / meta.desk[0]);
    const gap = (W - 3 * dw) / 4, y0 = top + Math.max(70, H * 0.42);
    for (let i = 0; i < 3; i++) {
      const x = gap + i * (dw + gap);
      const dc = el(art, 'ed:' + i, 'div', 'ro-desk ro-edesk'); box(dc, { x, y: y0, w: dw, h: Math.min(dh * 0.72, lay.height - y0 - 6) }); attr(dc, 'aria-hidden', 'true');
      const dk = dc.firstChild || dc.appendChild(document.createElement('img')); dk.style.height = px(dh); img(dk, 'desk.webp');
      const sw = dw * 0.5, sh = sw * 0.64;
      const sc = el(art, 'em:' + i, 'div', 'ro-screen ro-escreen st-idle off'); box(sc, { x: x + dw / 2 - sw / 2, y: y0 - sh - 10, w: sw, h: sh + 14 }); attr(sc, 'aria-hidden', 'true');
      if (!sc.firstChild) sc.innerHTML = '<div class="ro-bezel"><div class="ro-glass"></div></div><div class="ro-neck"></div><div class="ro-foot"></div>';
      sc.firstChild.style.height = px(sh);
    }
    const pw = Math.min(560, W - 40);
    const pl = el(chrome, 'ep', 'div', 'ro-eplate'); box(pl, { x: (W - pw) / 2, y: top + 14, w: pw });
    pl.dataset.surface = 'empty-office'; pl.dataset.floorEmpty = empty.id || '';
    text(pl, empty.text);
    EMPTY_BOX = { x: (W - pw) / 2 - 4, y: top + 10, w: pw + 8, h: 64 }; /* the plate (two lines at most) is on the avoid list of the slips */
  }

  /* spec 097 FR-121, FR-122, FR-124: slips and a bubble. The words, buttons and their order come from the app (the cards' own); this draws them on
     the free spot nearest their door or desk (placeBox: never on a plate, a sign, a chair label or a cue; always under the lobby band, FR-110).
     A queue slip that has no room for its words becomes a one-line pill; a limit slip or bubble with no room is not drawn (the Bank's chip, the
     desk's plate and the top bar's Inbox button say it too). The buttons carry data-slipact; app.js clicks the card's own button. */
  function drawSlips(chrome, lay, slips) {
    const P = root.exports && root.exports.placeBox, A = root.exports && root.exports.slipAvoid;
    const want = [];
    if (slips && slips.queue) want.push('queue');
    if (slips && slips.limit) want.push('limit');
    for (const e of (slips && slips.elicit) || []) want.push('elicit:' + e.id);
    if (!want.length || !P || !A) return;
    const avoid = A(lay);
    if (EMPTY_BOX) avoid.push(EMPTY_BOX);
    /* with more than four agents the monitors are read from afar: a slip takes a spot clear of them, else a smaller variant (the pill); with big screens (four or fewer) it may sit over one */
    const desks = lay.zones.flatMap((z) => z.desks).concat(lay.lounge ? lay.lounge.desks : []), screens = desks.map((d) => d.screen);
    const HARD = lay.cabinet ? [...screens, ...desks.flatMap((d) => [d.desk, d.person]).filter(Boolean)] : []; /* what no slip may ever cover in the arcade */
    if (lay.cabinet) avoid.push(...HARD); /* spec 102, owner 2026-11-03: in the arcade nothing covers a cabinet or a person */
    const softAvoid = lay.big || lay.cabinet ? [] : screens;
    const bounds = { x: 4, y: lay.lobbyH + 4, w: lay.width - 8, h: lay.height - lay.lobbyH - 8 };
    const door = (id) => { const f = lay.fixtures.find((x) => x.id === id); return f ? { x: f.slot.x + f.slot.w / 2, y: lay.lobbyH } : { x: lay.width / 2, y: lay.lobbyH }; };
    const hits = (r) => avoid.some((q) => r.x < q.x + q.w && q.x < r.x + r.w && r.y < q.y + q.h && q.y < r.y + r.h);
    const put = (key, cls, build, anchor, variants, surface) => {
      const e = el(chrome, key, 'div', cls); dset(e, 'surface', surface);
      /* a late stylesheet, font or text change gives the slip another box than the one it was placed with: it is placed again (once per change) */
      if (typeof ResizeObserver === 'function') {
        if (!SLIP_RO) SLIP_RO = new ResizeObserver((list) => { for (const en of list) { const t = en.target; if (t._at && (Math.ceil(t.offsetWidth) + 2 > t._at.w || Math.ceil(t.offsetHeight) + 2 > t._at.h) && onArt) onArt(); } });
        if (!e._obs) { e._obs = true; SLIP_RO.observe(e); }
      }
      /* the fullest variant that fits is used; a spot that is still free is kept, so a slip does not hop from render to render */
      const order = variants;
      for (const v of order) {
        const sig = JSON.stringify([v, build.sig]);
        if (e._sig !== sig) { e._sig = sig; e._at = null; e.textContent = ''; build.fill(e, v); }
        e.hidden = false; dset(e, 'variant', v); /* spec 097 FR-358 (#1434): the variant's own CSS (the pill's auto width and one line) applies before the box is measured, not after the spot is chosen */
        if (e._at && e._v === v) { e.style.left = px(e._at.x); e.style.top = px(e._at.y); }
        else { e.style.left = '0px'; e.style.top = '0px'; }
        e.style.width = ''; e.style.height = '';
        const size = () => ({ w: Math.ceil(e.offsetWidth) + 2, h: Math.ceil(e.offsetHeight) + 2 });
        let r = size();
        const laneFree = () => lay.lane && v === 'pill' && !(e._at.y >= lay.lane.y && e._at.y + r.h <= lay.lane.y + lay.lane.h + 0.01) && P(r, avoid, lay.lane, anchor); /* a pill docked before its font loaded goes back to the lane */
        if (e._at && e._v === v && e._at.w >= r.w && e._at.h >= r.h && !hits({ x: e._at.x, y: e._at.y, w: r.w, h: r.h }) && !laneFree() && e._at.x + r.w <= bounds.x + bounds.w && e._at.y + r.h <= bounds.y + bounds.h) { avoid.push({ x: e._at.x, y: e._at.y, w: r.w, h: r.h }); e.dataset.variant = v; return true; }
        for (let pass = 0; pass < 2; pass++) { /* the second pass re-places with the box it really has (a late font can widen the text) */
          const dock = () => P(r, avoid, { x: bounds.x, y: bounds.y + bounds.h - r.h, w: bounds.w, h: r.h }, anchor) || (lay.lane && P(r, HARD, lay.lane, anchor)) || P(r, HARD, bounds, anchor, 4) || { x: bounds.x + bounds.w - r.w, y: bounds.y + bounds.h - r.h, w: r.w, h: r.h }; /* last: over another slip or a sign, never a cabinet, screen or person while any such spot exists (pre-review of #1079) */
          const at = (lay.lane && v === 'pill' ? P(r, avoid, lay.lane, anchor) : null) || P(r, avoid.concat(softAvoid), bounds, anchor) || (lay.big || v === 'pill' ? P(r, avoid, bounds, anchor) : null) || (lay.cabinet && v === 'pill' ? dock() : null); /* a one-line pill may sit over a monitor when there is no other spot; in the arcade it docks at the floor's bottom edge, never hidden */
          if (!at) break;
          e.style.left = px(at.x); e.style.top = px(at.y);
          const r2 = size();
          if (r2.w <= r.w && r2.h <= r.h) { e._at = at; e._v = v; dset(e, 'variant', v); avoid.push(at); return true; }
          r = r2;
        }
      }
      e.hidden = true; e._at = null; e._v = null; dset(e, 'variant', 'none'); return false;
    };
    const btn = (label, title, cls, data) => { const b = document.createElement('button'); b.type = 'button'; b.className = cls === 'link' ? 'linkbtn ro-sbtn' : cls === 'sl-fold' || cls === 'sl-more' || cls === 'ro-pill' ? 'ro-sbtn ' + cls : 'btn sm ro-sbtn ' + cls; /* the inbox's own button classes (spec 052 FR-076) */ b.textContent = label; if (title) b.title = title; for (const k of Object.keys(data)) b.dataset[k] = String(data[k]); return b; };
    const p = (cls, t) => { const n = document.createElement('p'); n.className = cls; n.textContent = t; return n; };
    if (slips.queue) {
      const Q = slips.queue;
      put('slip:queue', 'ro-slip ro-queue', {
        sig: Q,
        fill: (e, v) => {
          e.setAttribute('role', 'group'); e.setAttribute('aria-label', Q.total + (Q.total === 1 ? ' request needs you' : ' requests need you'));
          if (v === 'pill') { e.appendChild(btn(Q.total + (Q.total === 1 ? ' needs you' : ' need you') + ' \u00B7 Open the inbox', '', 'ro-pill', { slipact: 'inbox' })); return; }
          const f = Q.first, h = document.createElement('p'); h.className = 'sl-h';
          const nm = document.createElement('b'); nm.textContent = f.name; h.appendChild(nm);
          const w = document.createElement('span'); w.textContent = ' ' + f.what + ' \u00B7 ' + f.folder; h.appendChild(w); e.appendChild(h);
          e.appendChild(p('sl-t', f.text));
          const row = document.createElement('div'); row.className = 'sl-act';
          for (const a of f.actions) row.appendChild(btn(a.label, a.title, a.cls, a.k === 'open' ? { slipact: 'open', slipid: f.id } : { slipact: 'perm', slipid: f.id, slipreq: f.req, slipidx: a.idx }));
          row.appendChild(btn('Show in chat', 'Open the chat', 'link', { slipact: 'open', slipid: f.id }));
          if (f.detail) row.appendChild(btn('Review in the inbox', 'This request has a change or a command to read first: the inbox shows it', 'ro-sbtn-review primary', { slipact: 'inbox' })); /* no Allow on a slip whose card has details (review on PR 994) */
          e.appendChild(row);
          for (const g of Q.folded) { const b = btn(g.text, '', 'sl-fold', { slipact: 'open', slipid: g.id }); e.appendChild(b); }
          if (Q.more > 0) e.appendChild(btn('+' + Q.more + ' more \u00B7 Open the inbox', '', 'sl-more', { slipact: 'inbox' }));
        },
      }, door('boss'), lay.cabinet ? ['pill'] : ['full', 'pill'], 'inbox'); /* the arcade: one line, the inbox holds the rest */
    }
    if (slips.limit) {
      const L = slips.limit;
      put('slip:limit', 'ro-slip ro-limit', {
        sig: [L.id, L.name, L.who, L.text, L.actions, L.input && [L.input.label, L.input.min, L.input.step, L.input.value]],
        fill: (e, v) => {
          e.setAttribute('role', 'group'); e.setAttribute('aria-label', 'Spending limit reached');
          if (v === 'pill') { e.appendChild(btn(L.name + ': Spending limit reached \u00B7 Show in chat', 'Open the chat', 'ro-pill', { slipact: 'open', slipid: L.id, slipfocus: 'limit' })); return; }
          e.appendChild(p('sl-h', L.who)); e.appendChild(p('sl-t', L.text));
          const row = document.createElement('div'); row.className = 'sl-act';
          if (L.input) { const i = document.createElement('input'); i.type = 'number'; i.className = 'limit-amt'; i.min = L.input.min; i.step = L.input.step; i.value = L.input.value; i.setAttribute('aria-label', L.input.label); row.appendChild(i); }
          for (const a of L.actions) row.appendChild(btn(a.label, a.title, a.cls, { slipact: 'limit', slipid: L.id, slipreq: L.req, slipidx: a.idx }));
          row.appendChild(btn('Show in chat', 'Open the chat', 'link', { slipact: 'open', slipid: L.id, slipfocus: 'limit' }));
          e.appendChild(row);
        },
      }, door('bank'), lay.cabinet ? ['pill'] : ['full', 'pill'], 'limit-card');
    }
    for (const B of slips.elicit || []) {
      const d = lay.zones.flatMap((z) => z.desks).concat(lay.lounge ? lay.lounge.desks : []).find((x) => x.id === B.id);
      if (!d) continue;
      put('slip:' + B.id, 'ro-slip ro-bubble', {
        sig: B,
        fill: (e) => {
          e.setAttribute('role', 'group'); e.setAttribute('aria-label', B.head);
          e.appendChild(p('sl-h', B.head)); e.appendChild(p('sl-t', B.text));
          const row = document.createElement('div'); row.className = 'sl-act';
          row.appendChild(btn('Answer in chat', '', 'primary', { slipact: 'open', slipid: B.id }));
          row.appendChild(btn('Show in chat', 'Open the chat', 'link', { slipact: 'open', slipid: B.id }));
          e.appendChild(row);
        },
      }, { x: d.slot.x + d.slot.w / 2, y: d.slot.y }, ['full'], 'elicitation');
    }
  }

  /* a font that arrives after the measure (a lazily loaded bold face, another machine's metrics) widens a chip or plate: a
     ResizeObserver sees it and places again, so nothing overlaps in the settled state. A width equal to the one the placement
     used ends it (no loop). */
  function placeLobby(chrome, W) {
    fitPlates(chrome, W); stagger(chrome, W);
    for (const e of chrome.querySelectorAll(':scope > .ro-chip, :scope > .ro-lplate')) e._at = [e.style.left, e.style.top, e.style.maxWidth];
  }
  function settle(chrome, W) {
    if (typeof ResizeObserver !== 'function') return;
    chrome._W = W;
    if (!chrome._ro) {
      let queued = false;
      chrome._ro = new ResizeObserver(() => {
        if (queued) return; queued = true;
        requestAnimationFrame(() => {
          queued = false;
          if (!chrome.isConnected) return;
          const moved = [...chrome.querySelectorAll(':scope > .ro-chip, :scope > .ro-lplate')].some((e) => e._w != null && Math.abs(e.getBoundingClientRect().width - e._w) > 0.5);
          if (moved) { chrome._settled = (chrome._settled || 0) + 1; placeLobby(chrome, chrome._W); } /* _settled: the driver sees the observer act */
        });
      });
    }
    if (!chrome._obs) chrome._obs = new Set();
    for (const e of chrome.querySelectorAll(':scope > .ro-chip, :scope > .ro-lplate')) if (!chrome._obs.has(e)) { chrome._obs.add(e); chrome._ro.observe(e, { box: 'border-box' }); }
  }

  /* FR-070: the second frame of a pose over the first; it moves only once decoded, so nothing pops; FR-065: a failed one leaves the first frame still */
  function second(art, key, id, rect, file, cls, m) {
    const prev = art._k.get(key), on = !!prev && prev._file === file && prev._ok;
    const b = el(art, key, 'img', cls + (on ? ' m-b m-' + m.style : '') + (OFF.has(id) ? ' ro-off' : ''));
    box(b, rect); dset(b, 'for', id); setVar(b, '--ro-per', m.period + 's'); setVar(b, '--ro-sw', m.sway + 's'); setVar(b, '--ro-u', (rect.h / 100).toFixed(3) + 'px');
    const fresh = b._file !== file;
    img(b, file, true, rect.w); /* FR-183: the second frame takes the same size as the first (its `sizes` follows the shown width on every render, as the first's does) */
    if (fresh) {
      b._file = file; b._ok = false; b._clock = false;
      b.decode().then(() => { if (b._file === file) { b._ok = true; if (onArt) onArt(); } }, () => {});
    }
    return { b, on };
  }

  /* ---- FR-030..FR-035: the monitors ---- */
  function screenBox(chrome, d, k) {
    const L = X(), f = L.screenFit(d.glass, CUR_G()), box2 = el(chrome, 'st:' + k, 'div', 'ro-stext st-' + d.state + (f.small ? ' small' : '') + (d.state === 'asleep' ? ' off' : '') + (OFF.has(k) ? ' ro-off' : '')); box(box2, d.glass); attr(box2, 'aria-hidden', 'true');
    let s = SCR.get(k);
    if (!s || s.box !== box2) { if (s) clearTimeout(s.timer); s = { box: box2, last: -Infinity, timer: 0, dirty: true, away: false, sig: '', fit: '' }; SCR.set(k, s); }
    const fit = JSON.stringify(f);
    if (s.fit !== fit) { /* a new size is drawn at once: it is the layout, not a repaint of text */
      s.fit = fit; setVar(box2, '--ro-sf', f.font + 'px'); setVar(box2, '--ro-sl', f.lh + 'px'); setVar(box2, '--ro-sh', f.whole + 'px'); setVar(box2, '--ro-sr', String(Math.max(1, Math.round(f.whole / f.lh))));
      s.sig = '';
      if (s.painted && !s.away && !hiddenNow()) { paintScreen(k); s.dirty = false; } else s.dirty = true;
    }
    if (d.state !== s.state) { s.state = d.state; s.dirty = true; }
    if (s.dirty) plan(k);
  }
  /* FR-033: at most once per REPAINT_MS, the newest text; a trailing paint when it comes in between */
  function plan(id) {
    const s = SCR.get(id);
    if (!s || s.timer || s.away || hiddenNow()) return;
    const wait = s.last + REPAINT_MS - performance.now();
    if (wait <= 0) { s.dirty = false; s.last = performance.now(); paintScreen(id); return; }
    s.timer = setTimeout(() => { s.timer = 0; if (!s.dirty) return; plan(id); }, wait + 1);
  }
  /* the agent's lines changed (app.js liveFeed) */
  function feed(id) { const s = SCR.get(id); if (s) { s.dirty = true; plan(id); } }
  /* rows of a text box: the lines keep their elements while they scroll, and only what changed is written (FR-184). Returns the rows added. */
  function fillRows(host, lines) {
    const old = host._rows || (host._rows = new Map()), keep = new Set(lines.map((l) => l.n));
    for (const [n, e] of old) if (!keep.has(n)) { e.remove(); old.delete(n); }
    let added = 0, at = host.firstChild;
    for (const l of lines) {
      let e = old.get(l.n);
      if (!e) { e = document.createElement('div'); e.className = 'ro-sl'; old.set(l.n, e); host.insertBefore(e, at); added++; } else at = e.nextSibling;
      if (e.dataset.k !== l.k) e.dataset.k = l.k;
      text(e, l.t); /* textContent only: no markup, no link (FR-031) */
    }
    return added;
  }
  function paintScreen(id) {
    const s = SCR.get(id), d = CUR && CUR.desks.get(id), a = CUR && CUR.agents.get(id);
    if (!s || !d || !a || !CUR.screenOf) return;
    const L = X(), data = CUR.screenOf(id, d.state, a.word), f = L.screenFit(d.glass, CUR_G());
    if (data.off) { if (s.painted) { s.box.textContent = ''; s.painted = false; s.lines = null; s.bars = null; s.caret = null; } s.sig = ''; return; }
    const sig = JSON.stringify([data.lines, data.caret, s.fit]);
    if (sig === s.sig) return;
    s.sig = sig;
    if (!s.lines) { const clip = document.createElement('div'); clip.className = 'ro-clip'; s.box.appendChild(clip); s.lines = document.createElement('div'); s.lines.className = 'ro-lines'; clip.appendChild(s.lines); s.bars = document.createElement('div'); s.bars.className = 'ro-bars'; s.lines.appendChild(s.bars); s.rows = document.createElement('div'); s.rows.className = 'ro-rows'; s.lines.appendChild(s.rows); }
    const shown = data.lines.slice(-f.rows);
    /* with Live activity off a working screen still looks at work: bars that say nothing, as many as fit, with no text behind them */
    const older = data.quiet ? Array.from({ length: Math.max(0, Math.floor((f.whole - f.lh - 2) / 6)) }, (_, i) => ({ n: i, k: i % 3 ? 'plain' : 'cmd', t: 'x'.repeat(10 + (i * 17 + id.length * 7) % 40) })) : f.bars ? data.lines.slice(0, -f.rows).slice(-f.bars) : [];
    /* FR-032: older lines as bars, each as long as its line and coloured by its kind */
    while (s.bars.childElementCount > older.length) s.bars.lastChild.remove();
    while (s.bars.childElementCount < older.length) s.bars.appendChild(document.createElement('i'));
    older.forEach((l, i) => { const b = s.bars.children[i], w = Math.min(96, 18 + Array.from(l.t).length * 1.4).toFixed(0) + '%'; if (b.style.width !== w) b.style.width = w; if (b.dataset.k !== l.k) b.dataset.k = l.k; });
    const added = fillRows(s.rows, shown);
    /* FR-033: the new line slides in, three steps, transform only; the text is already right, so a dropped frame costs nothing */
    if (added && s.painted && moving() && !s.away) s.lines.animate([{ transform: 'translateY(' + Math.min(added, 2) * f.lh + 'px)' }, { transform: 'none' }], { duration: 180, easing: 'steps(3, end)' });
    /* spec 008 FR-184: one caret element per screen, shown or hidden: a repaint after the throttle (FR-033) changes no node, so a status update adds or removes none (spec 102 FR-229);
       shown again it is a new animation, so it takes its desk's clock again */
    if (data.caret) {
      const fresh = !s.caret;
      if (fresh) { s.caret = document.createElement('i'); s.caret.className = 'ro-caret'; s.box.appendChild(s.caret); setVar(s.caret, '--ro-per', '1.2s'); }
      if (fresh || s.caret.hidden) {
        s.caret.hidden = false;
        s.caretMs = L.personMotion(id, 'typeA', d.state).offset;
        if (moving()) { clock(s.caret, s.caretMs); if (CUR && !CUR.pixelArt) onGrid(s.caret); }
      }
    } else if (s.caret && !s.caret.hidden) s.caret.hidden = true;
    s.painted = true;
    if (ZOOM && ZOOM.id === id) { const k = ZOOM.kh; fillZoom(); if (k !== ZOOM.kh) placeZoom(); }
  }

  /* FR-074: a window hidden or back; FR-181: desks scrolled away stand still and do not paint, and catch up once when they are back */
  /* body.panel-open comes and goes between draws: the room pauses and resumes at once */
  let bodyWatch = null, wasHidden = false;
  function watchBody() {
    if (bodyWatch || typeof MutationObserver !== 'function') return;
    bodyWatch = new MutationObserver(() => { if (hiddenNow() !== wasHidden) resume(); });
    bodyWatch.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  }
  function resume() {
    if (!CUR) return;
    wasHidden = hiddenNow();
    const h = hiddenNow(); CUR.ro.classList.toggle('paused', h); if (h) finishMoves(CUR.ro);
    if (h) { closeZoom(); return; }
    QUIET_POINTER = true; QUIET_AT = ''; /* back in view: a pointer resting on a screen is not asking to read it */
    if (moving() && !CUR.pixelArt) onGrid(CUR.ro); /* FR-229 */
    for (const [id, s] of SCR) if (s.dirty) plan(id);
  }
  document.addEventListener('visibilitychange', resume);
  function setOff(id, off) {
    if (off === OFF.has(id)) return;
    if (off) OFF.add(id); else OFF.delete(id);
    if (!CUR) return;
    const art = CUR.ro.querySelector(':scope > .ro-art');
    for (const key of ['p:', 'pb:', 'rg:']) { const e = art && art._k.get(key + id); if (e) e.classList.toggle('ro-off', off); }
    const s = SCR.get(id); if (s) s.box.classList.toggle('ro-off', off);
    if (!off && moving() && !CUR.pixelArt) onGrid(CUR.ro); /* FR-229: back in view, back on the grid */
  }
  function watchOff(lay) {
    if (!lay.scroll || typeof IntersectionObserver !== 'function') {
      if (IO) { IO.disconnect(); IO = null; }
      for (const [id, s] of SCR) { s.watched = false; if (s.away) { s.away = false; setOff(id, false); if (s.dirty) plan(id); } }
      return;
    }
    const root = CUR.ro.closest('#floor') || null;
    if (IO && IO.root !== root) { IO.disconnect(); IO = null; for (const s of SCR.values()) s.watched = false; }
    if (!IO) IO = new IntersectionObserver((list) => { for (const n of list) { const id = n.target._id, s = SCR.get(id); if (!s || s.box !== n.target) continue; s.away = !n.isIntersecting; setOff(id, s.away); if (!s.away && s.dirty) plan(id); } }, { root });
    for (const [id, s] of SCR) if (!s.watched) { s.watched = true; s.box._id = id; IO.observe(s.box); }
  }

  /* ---- FR-034: the zoom ---- */
  const ZOOM_W = [380, 480], ZOOM_HEAD = 44, ZOOM_LH = 17, ZOOM_ROWS = 12, ZOOM_MIN_ROWS = 4;
  const ZWIDE = new Set(['Model', 'Now', 'Last tool', 'Usage', 'Changed']);
  function wireZoom(ro) {
    let wait = 0;
    /* spec 097 FR-327: the agent a pointer is over: its monitor, person, desk (or lounge table) or name plate, never a visitor, chip or lobby plate */
    const hid = (n) => { const t = n && n.closest && n.closest('.ro-screen, .ro-person, .ro-person2, .ro-rig, .ro-initials, .ro-marquee, .ro-desk, .ro-ltable, .ro-plate'); return t ? (t.classList.contains('ro-plate') ? t.dataset.id : t.dataset.for) || '' : ''; };
    const arm = (id) => { clearTimeout(wait); ARMED = true; wait = setTimeout(() => { ARMED = false; openZoom(id, 'hover'); }, 120); };
    /* FR-328: the agent changed state under a resting pointer (it walked to the lounge): the browser's pointerout is not the person leaving; the next real move is */
    ro.addEventListener('pointermove', (e) => {
      PT = e.clientX + ',' + e.clientY;
      if (ZOOM && ZOOM.held && ZOOM.held !== PT) { ZOOM.held = false; if (ZOOM.hover && hid(e.target) !== ZOOM.id) leaveZoom('hover'); } /* the browser repeats a move at the same place after the room changed: not the person moving (as QUIET_AT below) */
    }, true);
    ro.addEventListener('pointerleave', () => { if (ZOOM && ZOOM.held) { ZOOM.held = false; if (ZOOM.hover) leaveZoom('hover'); } });
    ro.addEventListener('pointermove', (e) => {
      if (!QUIET_POINTER) return;
      const at = e.clientX + ',' + e.clientY;
      if (!QUIET_AT) QUIET_AT = at;
      if (QUIET_AT === at) return;
      QUIET_POINTER = false;
      const id = hid(e.target);
      if (id && e.pointerType !== 'touch' && DISMISSED !== id) arm(id);
    });
    ro.addEventListener('pointerover', (e) => {
      const id = hid(e.target);
      if (QUIET_POINTER && !QUIET_AT) QUIET_AT = e.clientX + ',' + e.clientY;
      if (QUIET_POINTER || !id || e.pointerType === 'touch') return;
      if ((ZOOM && ZOOM.hover && ZOOM.id === id) || DISMISSED === id) return; /* Esc holds until the pointer has left */
      arm(id); /* crossing the room opens nothing */
    });
    ro.addEventListener('pointerout', (e) => {
      const id = hid(e.target);
      if (!id || hid(e.relatedTarget) === id) return; /* still on the same agent's desk */
      clearTimeout(wait); ARMED = false; DISMISSED = '';
      if (ZOOM && ZOOM.id === id && !ZOOM.held) leaveZoom('hover');
    });
    ro.addEventListener('focusin', (e) => { const p = e.target.closest && e.target.closest('.ro-plate'); if (p && !QUIET_FOCUS && p.matches(':focus-visible')) openZoom(p.dataset.id, 'focus'); });
    ro.addEventListener('focusout', (e) => { const p = e.target.closest && e.target.closest('.ro-plate'); if (p && ZOOM && ZOOM.id === p.dataset.id) leaveZoom('focus'); });
  }
  function zoomKey(e) {
    if (e.key !== 'Escape' || !ZOOM) return;
    if (hiddenNow()) { closeZoom(); return; } /* the office is covered: this Escape is for what covers it */
    if (document.querySelector('#modeMenu,#modelMenu,#agentMenu,#ctxMenu')) return; /* FR-328: an open menu is above the card: this Escape closes the menu first (the card is not told apart from it; it goes with its hover or focus) */
    e.preventDefault(); e.stopPropagation(); DISMISSED = ZOOM.hover ? ZOOM.id : ''; closeZoom();
  }
  function openZoom(id, why) {
    if (!CUR || hiddenNow() || !CUR.desks.has(id) || !CUR.screenOf) return;
    if (!ZOOM || ZOOM.id !== id) {
      closeZoom();
      const p = document.createElement('div'); p.className = 'ro-zoom'; p.id = 'roZoom'; p.setAttribute('role', 'region');
      p.innerHTML = '<div class="ro-zh"><b></b><span class="ro-zr"></span><span class="ro-zs"></span><span class="ro-zf"></span></div><div class="ro-zk"></div><div class="ro-zb"><div class="ro-zl"></div></div>';
      CUR.ro.appendChild(p);
      ZOOM = { id, hover: false, focus: false, panel: p, plate: CUR.ro.querySelector('.ro-plate[data-id="' + CSS.escape(id) + '"]') };
      if (ZOOM.plate) ZOOM.plate.setAttribute('aria-describedby', 'roZoom');
      document.addEventListener('keydown', zoomKey, true);
      document.addEventListener('focusin', replaceZoom, true); document.addEventListener('focusout', replaceLater, true);
      addEventListener('blur', closeZoom);
      addEventListener('focus', replaceZoom); /* FR-330: a slip focused by script while the window was in the background fired no focusin; the place is sought again when the window has the focus */
      const fl = CUR.ro.closest('#floor'); if (fl) { ZOOM.floor = fl; fl.addEventListener('scroll', closeZoom, { passive: true }); }
      fillZoom(); if (!placeZoom()) return; /* FR-330: no place that leaves the focused slip uncovered: no card */
    }
    ZOOM[why] = true;
  }
  function leaveZoom(why) { if (!ZOOM) return; ZOOM[why] = false; if (!ZOOM.hover && !ZOOM.focus) closeZoom(); }
  function closeZoom() {
    if (!ZOOM) return;
    const z = ZOOM; ZOOM = null;
    z.panel.remove();
    if (z.plate) z.plate.removeAttribute('aria-describedby');
    document.removeEventListener('keydown', zoomKey, true);
    document.removeEventListener('focusin', replaceZoom, true); document.removeEventListener('focusout', replaceLater, true);
    removeEventListener('blur', closeZoom);
    removeEventListener('focus', replaceZoom);
    if (z.floor) z.floor.removeEventListener('scroll', closeZoom);
    for (const id of z.under || []) { const s = SCR.get(id); if (!s || !s.away) setOff(id, false); }
    if (CUR && CUR.ro) for (const e of CUR.ro.querySelectorAll('.ro-slip[inert]')) e.removeAttribute('inert');
  }
  /* name, role, status, folder and the last lines, textContent only (FR-031, FR-034); a described region, not a live one */
  function fillZoom() {
    const a = CUR.agents.get(ZOOM.id), d = CUR.desks.get(ZOOM.id), p = ZOOM.panel;
    if (!a || !d) return;
    p.setAttribute('aria-label', 'Screen of ' + a.name);
    p.dataset.state = d.state; p.dataset.for = ZOOM.id; ZOOM.st = d.state;
    text(p.querySelector('.ro-zh b'), a.name); text(p.querySelector('.ro-zr'), a.role); text(p.querySelector('.ro-zs'), a.word); text(p.querySelector('.ro-zf'), a.folder);
    const data = CUR.screenOf(ZOOM.id, d.state, a.word, true); /* true: for the card (FR-328: an asleep agent's reply lines) */
    const host = p.querySelector('.ro-zl');
    fillRows(host, data.lines);
    /* spec 097 FR-312: the facts, label and text, two to a line; textContent only */
    const facts = (CUR.factsOf ? CUR.factsOf(ZOOM.id) : []).slice(0, 8), kb = p.querySelector('.ro-zk');
    kb.textContent = '';
    for (const [k, v] of facts) { const l = document.createElement('span'); l.className = k === 'Changed' ? 'ro-zi ro-zw ro-zc' : ZWIDE.has(k) ? 'ro-zi ro-zw' : 'ro-zi'; const kk = document.createElement('span'); kk.className = 'ro-zy'; text(kk, k); l.appendChild(kk); l.appendChild(document.createTextNode(' ')); const vv = document.createElement('span'); vv.className = 'ro-zv'; text(vv, v); l.appendChild(vv); kb.appendChild(l); }
    const wide = facts.filter(([k]) => ZWIDE.has(k)).length; /* long ones take a whole line, cut with an ellipsis when too long (FR-313) */
    const extra = facts.filter(([k, v]) => k === 'Changed' && Array.from(v).length + 8 > 54).length; /* FR-329: a Changed line wraps, so it takes a second row */
    ZOOM.kh = facts.length ? (wide + extra + Math.ceil((facts.length - wide) / 2)) * ZOOM_LH + 9 : 0; /* .ro-zk: 4 px padding above and below, a 1 px rule */ kb.hidden = !facts.length;
    ZOOM.rows = data.lines.reduce((n, l) => n + Math.max(1, Math.ceil(Array.from(l.t).length / 52)), 0);
  }
  function placeZoom() {
    const ro = CUR.ro, o = ro.getBoundingClientRect(), fl = ro.closest('#floor'), f = fl ? fl.getBoundingClientRect() : o, d = CUR.desks.get(ZOOM.id);
    const near = (e) => { const b = e.getBoundingClientRect(); return { x: b.left - o.left, y: b.top - o.top, w: b.width, h: b.height }; };
    const slipRects = [...ro.querySelectorAll('.ro-slip:not([hidden])')].map(near);
    const avoid = [d.screen, ...[...ro.querySelectorAll('.ro-plate:is(.st-waiting,.st-limit), .ro-lplate.wait, .ro-chip.wait')].map(near), ...slipRects]; /* FR-330 (2026-11-08): a slip or bubble (FR-110) is avoided too; the card is painted above them (CSS) for when no free place is left */
    if (ZOOM.plate) avoid.push(near(ZOOM.plate));
    const view = { x: Math.max(0, f.left - o.left), y: Math.max(0, f.top - o.top), w: Math.min(f.right, o.right) - Math.max(f.left, o.left), h: Math.min(f.bottom, o.bottom) - Math.max(f.top, o.top) };
    const w = Math.max(ZOOM_W[0], Math.min(ZOOM_W[1], view.w * 0.34));
    const HEAD = ZOOM_HEAD + (ZOOM.kh || 0), rows = Math.max(ZOOM_MIN_ROWS, Math.min(ZOOM_ROWS, ZOOM.rows || 0));
    const size = { w, h: HEAD + rows * ZOOM_LH + 12, minH: HEAD + ZOOM_MIN_ROWS * ZOOM_LH + 12 };
    let r = X().zoomRect(d.screen, avoid, view, size);
    /* FR-330 (2026-11-08, round 3 of #1313): the card is never over the slip that holds the keyboard focus (a click through the card, which takes no pointer events, would press a hidden button). That slip is the avoid list's first claim: when the place found covers it, the other slips are let go and the place is sought again; when none is left, no card */
    const act = document.activeElement, fs = act && act.closest && act.closest('.ro-slip:not([hidden])');
    if (fs && ro.contains(fs)) {
      const fr = near(fs), hits = (q) => q.x < fr.x + fr.w && fr.x < q.x + q.w && q.y < fr.y + fr.h && fr.y < q.y + q.h;
      if (hits(r)) {
        r = X().zoomRect(d.screen, avoid.filter((a) => !slipRects.includes(a)).concat([fr]), view, size);
        if (hits(r)) { closeZoom(); return false; }
      }
    }
    box(ZOOM.panel, r); ZOOM.panel.dataset.side = r.side;
    setVar(ZOOM.panel, '--ro-zh', Math.max(1, Math.floor((r.h - HEAD - 8) / ZOOM_LH)) * ZOOM_LH + 'px');
    /* what the panel covers whole stands still until it closes */
    const under = [];
    for (const [id, de] of CUR.desks) if (id !== ZOOM.id && de.person && de.person.x >= r.x && de.person.x + de.person.w <= r.x + r.w && de.person.y >= r.y && de.person.y + de.person.h <= r.y + r.h) { under.push(id); setOff(id, true); }
    for (const id of ZOOM.under || []) if (!under.includes(id)) { const s = SCR.get(id); if (!s || !s.away) setOff(id, false); }
    ZOOM.under = under;
    ZOOM.rect = r; coverSlips();
    return true;
  }
  /* FR-330: a slip the card still covers (no free place was left) takes no click or key while it is hidden under the card; the slip that holds the keyboard focus is never under it (placeZoom), so it needs no exception. The place is sought again when the focus moves */
  function coverSlips() {
    if (!ZOOM || !ZOOM.rect || !CUR || !CUR.ro) return;
    const ro = CUR.ro, o = ro.getBoundingClientRect(), r = ZOOM.rect;
    for (const e of ro.querySelectorAll('.ro-slip')) {
      const q = e.getBoundingClientRect(), x = q.left - o.left, y = q.top - o.top;
      const hit = !e.hidden && x < r.x + r.w && r.x < x + q.width && y < r.y + r.h && r.y < y + q.height;
      if (hit) e.setAttribute('inert', ''); else e.removeAttribute('inert');
    }
  }
  const replaceZoom = () => { if (ZOOM && CUR && CUR.desks.has(ZOOM.id)) placeZoom(); };
  const replaceLater = () => setTimeout(replaceZoom, 0);

  /* Paco's review of #921 (art): a lobby place plate reads in full (never an ellipsis) when there is room: a plate wider than its
     slot grows to the right, then to the left, into free space only (up to the next plate on the same rows or the band's edge); no
     fixture moves. Measured once per render, left to right, so a plate never covers another. Too little room keeps the ellipsis
     (the driver fails on it). */
  /* review 2026-11-02: a role that has no room for about three characters is not shown (a one-letter sliver reads as a mistake). Done once per draw and only for a plate
     whose width or words changed (not per frame): show every changed role, read all widths, then hide the ones that are too narrow. */
  const ROLE_MIN = 20; /* px: about three characters of the 10.5 px role text */
  function fitRoles(chrome) {
    const todo = [];
    for (const p of chrome.querySelectorAll(':scope > .ro-plate')) {
      const r = p.querySelector('.ro-role'); if (!r) continue;
      const key = p.style.width + '|' + p.style.height + '|' + p._sig;
      if (p._rk === key) continue;
      p._rk = key; r.hidden = false; todo.push(r);
    }
    const w = todo.map((r) => r.getBoundingClientRect().width);
    todo.forEach((r, i) => { r.hidden = w[i] < ROLE_MIN; });
  }
  function fitPlates(chrome, W) {
    const pl = [...chrome.querySelectorAll(':scope > .ro-lplate')].sort((a, b) => a.offsetLeft - b.offsetLeft);
    const done = [];
    for (const p of pl) {
      const base = parseFloat(p.style.maxWidth) || p.offsetWidth, L0 = parseFloat(p.style.left) || 0;
      p.style.maxWidth = 'none'; const need = p.getBoundingClientRect().width + 1; p.style.maxWidth = px(base); /* fractional, plus a pixel: a text 0.4 px wider than its box still gets the ellipsis */
      const y0 = p.offsetTop, y1 = y0 + p.offsetHeight;
      const rows = (q) => q.y0 < y1 && y0 < q.y1;
      if (need > base) {
        const mine = done.filter(rows), others = pl.filter((q) => q !== p && !done.includes(q)).map((q) => ({ x0: parseFloat(q.style.left) || 0, y0: q.offsetTop, y1: q.offsetTop + q.offsetHeight })).filter(rows);
        const lo = Math.max(0, ...mine.map((q) => q.x1 + 2)), hi = Math.min(W, ...others.filter((q) => q.x0 >= L0).map((q) => q.x0 - 2));
        let r = Math.min(L0 + need, hi), l = L0;
        if (r - l < need) l = Math.max(lo, r - need);
        if (r - l < need) r = Math.min(W, l + need);
        p.style.left = px(l); p.style.maxWidth = px(Math.max(base, Math.min(r - l, need)));
      }
      const rr = p.getBoundingClientRect(), cr = chrome.getBoundingClientRect();
      p._w = rr.width;
      done.push({ x0: rr.left - cr.left, x1: rr.right - cr.left, y0, y1 });
    }
  }

  /* a chip is [alert icon] + name; the icon is the app's own Alert sign (app.js signIcon, built from trusted markup, not the model's
     text; constitution V: no emoji), the name goes in with textContent. `label` is the name. When stagger() has cut a crowded chip's
     name (the whole name kept in data-full), a render with the same name leaves the cut text as it is: the chip keeps the text it was placed
     with when the lobby's signature holds and stagger() does not run again (FR-184); a new name or icon clears data-full and writes the name. */
  function chipFill(ch, label, wait, icon) {
    const w = wait && icon ? icon : '';
    if (ch._ic !== w || !ch.querySelector('.ro-cn')) {
      ch._ic = w; ch.textContent = ''; delete ch.dataset.full;
      if (w) { const i = document.createElement('span'); i.className = 'ro-ci'; i.setAttribute('aria-hidden', 'true'); i.innerHTML = w; ch.appendChild(i); }
      const n = document.createElement('span'); n.className = 'ro-cn'; ch.appendChild(n);
    }
    if (ch.dataset.full === label) return;
    if (ch.dataset.full !== undefined) delete ch.dataset.full;
    text(ch.querySelector('.ro-cn'), label);
  }

  /* visitors' name chips stand above their heads (owner 2026-10-31 10:48: never over the feet or legs; the layout gives each its
     place); when two would touch, the chip takes the nearest free spot (up to 64 px left or right, up to three levels up, inside the
     band), and shows initials only when no spot is free for the name; measured once per render, left to right, so no two chips ever
     overlap */
  function stagger(chrome, W) {
    const GAPC = 1; /* px between two chips, or a chip and a plate */
    const chips = [...chrome.querySelectorAll(':scope > .ro-chip')].sort((a, b) => parseFloat(a.dataset.x || a.style.left) - parseFloat(b.dataset.x || b.style.left));
    /* the place plates are there first: a chip never covers one */
    const cr = chrome.getBoundingClientRect(); /* fractional boxes: a rounded offsetLeft hides half a pixel of overlap */
    const placed = [...chrome.querySelectorAll(':scope > .ro-lplate')].map((e) => { const r = e.getBoundingClientRect(); return [r.left - cr.left, r.right - cr.left, r.top - cr.top, r.bottom - cr.top]; });
    const plates = placed.slice(), chipsPlaced = []; /* plates stay fixed; a placed chip may move left to make room (pushLeft) */
    const band = W || chrome.clientWidth || 1e9;
    for (const c of chips) {
      const base = parseFloat(c.dataset.y || c.style.top) || 0, x0 = parseFloat(c.dataset.x || c.style.left) || 0;
      c.style.left = px(x0); c.style.top = px(base); if (c.dataset.full) { text(c.querySelector('.ro-cn'), c.dataset.full); delete c.dataset.full; }
      const h = c.getBoundingClientRect().height || 17;
      const hitList = (L0, R0, t) => placed.filter(([a, b, y0, y1]) => a < R0 + GAPC && L0 < b + GAPC && y0 < t + h && t < y1);
      const hits = (L0, R0, t) => hitList(L0, R0, t).length > 0;
      /* Paco's review of #921: names while there is room. Every spot within 64 px left or right on up to three levels is tried, the
         least move first (a level costs 12 px); only when none is free do the initials try the same, then (a crowd with no room) the
         initials move right until they touch nobody */
      const best = () => {
        const w = c.getBoundingClientRect().width, l = x0 - w / 2; let pick = null;
        for (let k = 0; k < 3; k++) {
          const t = base - 18 * k; if (t < 0 && k > 0) break;
          for (let d = 0; d <= 64; d += 2) for (const dx of d ? [d, -d] : [0]) {
            if (l + dx < 0 || l + dx + w > band || hits(l + dx, l + dx + w, t)) continue;
            const score = d + 12 * k; if (!pick || score < pick.score) pick = { score, t, dx, l, w };
          }
        }
        return pick;
      };
      /* no free spot even by sliding: the chips already placed on this row may move left (up to 64 px from their person, never onto a
         plate) to make room: a chain, right to left; the cheapest spot counts a little more for each chip it moves */
      const pushLeft = (L, t) => {
        const moves = []; let limit = L - GAPC;
        const row = chipsPlaced.filter((q) => q.t < t + h && t < q.t + q.h).sort((a, b) => b.l + b.w - (a.l + a.w));
        for (const q of row) {
          if (q.l + q.w <= limit) break;
          const nl = limit - q.w;
          if (nl < 0 || Math.abs(nl + q.w / 2 - q.x0) > 64 || plates.some(([a, b, y0, y1]) => a < nl + q.w + GAPC && nl < b + GAPC && y0 < q.t + q.h && q.t < y1)) return null;
          moves.push([q, nl]); limit = nl - GAPC;
        }
        return moves;
      };
      const withPush = () => {
        const w = c.getBoundingClientRect().width, l = x0 - w / 2; let found = null;
        for (let k = 0; k < 3; k++) {
          const t = base - 18 * k; if (t < 0 && k > 0) break;
          for (let d = 0; d <= 64; d += 2) for (const dx of d ? [d, -d] : [0]) {
            const L = l + dx;
            if (L < 0 || L + w > band || plates.some(([a, b, y0, y1]) => a < L + w + GAPC && L < b + GAPC && y0 < t + h && t < y1)) continue;
            const moves = pushLeft(L, t); if (!moves) continue;
            const moved = new Map(moves);
            if (!chipsPlaced.every((q) => { const ql = moved.has(q) ? moved.get(q) : q.l; return !(ql < L + w + GAPC && L < ql + q.w + GAPC && q.t < t + h && t < q.t + q.h); })) continue;
            const score = d + 12 * k + 4 * moves.length; if (!found || score < found.score) found = { score, t, dx, l, w, moves };
          }
        }
        if (!found) return null;
        for (const [q, nl] of found.moves) { q.l = nl; q.ent[0] = nl; q.ent[1] = nl + q.w; q.c.style.left = px(nl + q.w / 2); }
        return found;
      };
      let pick = best() || withPush();
      /* no free spot for the whole name: a shorter one (its first letters and "…", from 6 down to 2), never bare initials (Paco, #921) */
      const nm = c.dataset.name || '', n = c.querySelector('.ro-cn'), g = Array.from(nm);
      for (const k of [6, 5, 4, 3, 2]) {
        if (pick || k > g.length - 2) continue;
        c.dataset.full = nm; text(n, g.slice(0, k).join('') + '\u2026'); pick = best() || withPush();
      }
      if (!pick) { const w = c.getBoundingClientRect().width, l = x0 - w / 2; let dx = 0; for (let i = 0; i < 40; i++) { const hl = hitList(l + dx, l + dx + w, base); if (!hl.length) break; dx = Math.max(...hl.map(([, b]) => b)) + 2 - l; } pick = { t: base, dx, l, w }; }
      const ent = [pick.l + pick.dx, pick.l + pick.dx + pick.w, pick.t, pick.t + h];
      placed.push(ent); chipsPlaced.push({ c, l: pick.l + pick.dx, w: pick.w, t: pick.t, h, x0, ent });
      c.style.top = px(pick.t); c.style.left = px(x0 + pick.dx); c._w = pick.w;
    }
    resolve(chrome);
  }

  /* the last word, on what is really drawn: a chip whose drawn box still touches a plate or an earlier chip (its width was not what
     was measured: a font face that arrived in between, another machine's metrics) moves right past it. Left to right, a few passes. */
  function resolve(chrome) {
    const cr = chrome.getBoundingClientRect(), rel = (e) => { const r = e.getBoundingClientRect(); return { x0: r.left - cr.left, x1: r.right - cr.left, y0: r.top - cr.top, y1: r.bottom - cr.top }; };
    const chips = [...chrome.querySelectorAll(':scope > .ro-chip')].sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);
    for (let pass = 0; pass < 4; pass++) {
      const placed = [...chrome.querySelectorAll(':scope > .ro-lplate')].map(rel);
      let moved = false;
      for (const c of chips) {
        const r = rel(c), hit = placed.filter((q) => q.x0 < r.x1 - 0.3 && r.x0 < q.x1 - 0.3 && q.y0 < r.y1 - 0.3 && r.y0 < q.y1 - 0.3);
        if (hit.length) { c.style.left = px((parseFloat(c.style.left) || 0) + Math.max(...hit.map((q) => q.x1)) + 1.5 - r.x0); moved = true; }
        placed.push(rel(c));
      }
      if (!moved) break;
    }
  }

  /* FR-006: a click on a person, desk or screen (data-for) does what a click on its plate does; the plate is the one button */
  function forward(e) {
    const t = e.target.closest && e.target.closest('[data-for]');
    if (!t) return;
    const pl = t.closest('.ro').querySelector('.ro-plate[data-id="' + CSS.escape(t.dataset.for) + '"]');
    if (pl) pl.click();
  }

  /* forget the session picks (Settings change of Characters, a test) */
  function reset() { PEOPLE = null; SEEN.clear(); WHERE.clear(); }
  /* leaving Real office: nothing of it goes on, and no key listener of the zoom stays to swallow an Escape */
  function leave() {
    closeZoom();
    if (IO) { IO.disconnect(); IO = null; }
    for (const s of SCR.values()) clearTimeout(s.timer);
    SCR.clear(); OFF.clear(); WHERE.clear(); GLIDING.clear();
    clearTimeout(handTimer); handTimer = 0; clearTimeout(lodTimer); lodTimer = 0;
    LOD = 0; lodBad = 0; lodGood = 0; DISMISSED = '';
    if (bodyWatch) { bodyWatch.disconnect(); bodyWatch = null; }
    wasHidden = false;
    CUR = null;
  }
  /* spec 097 FR-186: work the room has put off on a timer (a screen's throttled repaint, FR-033; a redraw when a done tick ends): check-office-ops-real starts a measured update only when there is none, so no earlier update's deferred work is counted in it. Read only */
  const pending = () => { let screens = 0; for (const s of SCR.values()) if (s.timer) screens++; return { screens }; }; /* FR-236: no done tick to wait for any more */
  root.DurbarRealOffice = { hoverState: () => ({ still: QUIET_POINTER, armed: ARMED }), pending, render, reset, leave, feed, resume, quietFocus, ctx, whereSize: () => WHERE.size, bad: () => [...BAD], resolve, stagger, personOf: (id) => (PEOPLE && has(PEOPLE, id) ? PEOPLE[id] : null) /* the chat's header draws the same person (spec 097 FR-106) */ }; /* resolve: for the driver's deterministic check */
})(typeof self !== 'undefined' ? self : this);
