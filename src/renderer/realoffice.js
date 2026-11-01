/* Real office mode (spec 097 phases P1, P2): the second renderer of the office. app.js builds a plain model from the same state as the flat
   office (officeModel, VISITS, status words, masked task text) and calls render(); this file lays it out with the pure engine
   (src/shared/realoffice-layout.ts), picks the lights (src/shared/lights.ts) and draws absolutely placed elements in #stage. It is
   loaded only when Real office is chosen (FR-061): app.js adds this script, its CSS, the two compiled shared modules and the art
   metadata (realoffice/art/people.js, made from people.json by copy-assets.js) on first use. The DOM is keyed: a re-render moves
   and re-classes the same elements, so focus stays (FR-090). No text is set with innerHTML from the model: names, roles, tasks
   and paths go in with textContent (the model's text is already masked by app.js, FR-030's path). */
(function (root) {
  'use strict';
  const X = () => root.exports || {};
  const ART = 'realoffice/art/';
  const BAD = new Set(); /* FR-065: pictures that failed to load in this session */
  const SEEN = new Map(); /* FR-052: the light state each desk had at the last render */
  const TICKS = new Map(); /* desk id -> time the green tick started */
  let PEOPLE = null; /* session id -> person id, durbar.realpeople */
  let onArt = null;
  /* phase P2 (FR-030..FR-035, FR-070..FR-074). CUR: the drawn scene; a monitor repaints on its own, at most once per REPAINT_MS, only when its
     lines changed, and not at all while the office is hidden or the desk is scrolled away: so no timer runs in an idle office. */
  const REPAINT_MS = 2000; /* FR-033 */
  const SCR = new Map(); /* desk id -> {box, last, timer, dirty, away, fit, sig} */
  const OFF = new Set(); /* keys of desks whose motion stands still: scrolled away or under the zoom */
  let CUR = null; /* {ro, screenOf, still, hold, desks: Map id -> desk, agents: Map id -> model agent, folders: Map, drawn} */
  let ZOOM = null; /* {id, hover, focus, panel, plate} */
  let IO = null, DISMISSED = '';

  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const px = (n) => Math.round(n * 10) / 10 + 'px';
  /* spec Changes 2026-11-01: while `SLIDE` is on (a draw of the same window size, people moving), something the layout moved a little slides there on `transform`, so a visitor's arrival does not make the lobby jump */
  let SLIDE = false;
  const box = (el, r) => {
    if (SLIDE && el._x !== undefined) { const dx = el._x - r.x, dy = el._y - r.y; if ((Math.abs(dx) >= 0.5 || Math.abs(dy) >= 0.5) && el.animate) el.animate([{ transform: `translate(${dx}px,${dy}px)` }, { transform: 'none' }], { duration: Math.max(280, Math.min(520, Math.hypot(dx, dy) * 1.2)), easing: 'cubic-bezier(.25,.1,.25,1)' }); }
    el._x = r.x; el._y = r.y; el.style.left = px(r.x); el.style.top = px(r.y); if (r.w != null) el.style.width = px(r.w); if (r.h != null) el.style.height = px(r.h); };
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
  function sweep(layer, fade) { for (const [k, e] of layer._k) if (!layer._seen.has(k)) { if (layer._obs && layer._obs.delete(e)) layer._ro.unobserve(e); if (fade && (k.startsWith('p:') || k.startsWith('v:'))) zoomOut(e); else e.remove(); layer._k.delete(k); } }
  function text(e, t) { t = String(t == null ? '' : t); if (e.textContent !== t) e.textContent = t; }
  function attr(e, k, v) { if (v == null || v === false) { if (e.hasAttribute(k)) e.removeAttribute(k); } else if (e.getAttribute(k) !== String(v)) e.setAttribute(k, String(v)); }
  function img(e, file) {
    const src = ART + file;
    if (e.getAttribute('src') !== src) {
      e.alt = ''; e.decoding = 'async'; e.draggable = false; e.setAttribute('aria-hidden', 'true');
      e.onerror = () => { if (!BAD.has(file)) { BAD.add(file); if (onArt) onArt(); } };
      e.src = src;
    }
  }
  /* FR-071 and FR-047: may anything move now? Web Animations do not see the CSS rules, so this is asked before each one; `still` holds Serious mode and reduced motion at load, the query a later change */
  function moving() {
    if (!CUR || CUR.still || CUR.hold) return false;
    try { if (matchMedia('(prefers-reduced-motion: reduce)').matches) return false; } catch (e) { return false; }
    return true;
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
  function poof(host, r, delay) {
    const d = document.createElement('div'); d.className = 'ro-poof';
    const w = r.h * 0.8; box(d, { x: r.x + r.w / 2 - w / 2, y: r.y + r.h * 0.45 - w / 2, w, h: w }); host.appendChild(d);
    const a = d.animate([{ transform: 'scale(.5)', opacity: 0 }, { opacity: 1, offset: 0.4 }, { transform: 'scale(1.2)', opacity: 0 }], { duration: ZOOM_IN, delay, easing: 'ease-out', fill: 'backwards' });
    a.onfinish = a.oncancel = () => d.remove();
  }
  function zoomOut(e) {
    const r = { x: parseFloat(e.style.left) || 0, y: parseFloat(e.style.top) || 0, w: parseFloat(e.style.width) || 0, h: parseFloat(e.style.height) || 0 };
    e.className = 'ro-ghost' + (e.classList.contains('ro-visitor') ? ' v' : ''); delete e.dataset.for;
    if (e.parentNode && r.h) poof(e.parentNode, r, 0);
    const a = e.animate([{ transform: 'scale(1)', opacity: 1 }, { transform: 'scale(.62)', opacity: 0 }], { duration: ZOOM_OUT, easing: 'cubic-bezier(.5,0,.8,.5)', fill: 'forwards' });
    a.onfinish = a.oncancel = () => e.remove();
  }
  function glide(e, id, from, to) {
    if (!from || (from.x === to.x && from.y === to.y)) return false;
    if (e.parentNode) poof(e.parentNode, to, ZOOM_OUT - 40);
    const a = e.animate([{ transform: 'scale(.62)', opacity: 0 }, { transform: 'scale(1.03)', opacity: 1, offset: 0.72 }, { transform: 'none', opacity: 1 }], { duration: ZOOM_IN, delay: ZOOM_OUT - 40, easing: 'cubic-bezier(.2,.7,.3,1)', fill: 'backwards' });
    GLIDING.set(id, a);
    a.onfinish = a.oncancel = () => { if (GLIDING.get(id) === a) { GLIDING.delete(id); if (onArt) onArt(); } };
    return true;
  }

  function setVar(e, k, v) { if (e.style.getPropertyValue(k) !== v) e.style.setProperty(k, v); }
  /* one clock per desk, its own place in the cycle: a desk's two pictures and caret stay together */
  function clock(e, ms) { for (const a of e.getAnimations()) if (a.animationName) a.startTime = ms; } /* the CSS loops only: a walk under way keeps its own time */

  /* the typing rig: a wrapper with the body's movement on the body's clock, over it a head and two hands cut from the same picture (spec Changes 2026-11-01) */
  function rigOf(art, k, rect, r, m, pe) {
    const w = el(art, 'rg:' + k, 'div', 'ro-rig m-rig' + (OFF.has(k) ? ' ro-off' : ''));
    box(w, rect); w.dataset.for = k;
    const org = getComputedStyle(pe).transformOrigin; if (w.style.transformOrigin !== org) w.style.transformOrigin = org;
    for (const [v, val] of [['--ro-sw', m.sway + 's'], ['--ro-u', (rect.h / 100).toFixed(3) + 'px'], ['--ro-pat', (2.2 + (m.offset % 900) / 900) .toFixed(2) + 's']]) setVar(w, v, val);
    if (w._pid !== rect.pid) {
      w._pid = rect.pid; w.textContent = '';
      for (const [cls, part, key] of [['h', r.head, 'head'], ['l', r.l, 'l'], ['r', r.r, 'r']]) {
        if (!part) continue;
        const i = new Image(); i.className = cls; i.alt = ''; i.src = ART + rect.pid + '-rig' + key + '.webp';
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
  function dotHTML(state) { return '<span class="dot ' + ({ limit: 'waiting', asleep: 'idle' }[state] || state) + '" aria-hidden="true"></span>'; }

  /* FR-037: one person per session, kept in durbar.realpeople; the simulator uses a seeded pick so pictures repeat run to run */
  function people(model, ids, rand, remember) {
    const L = X();
    if (!PEOPLE) { PEOPLE = {}; if (remember) { try { const o = JSON.parse(localStorage.getItem('durbar.realpeople') || '{}'); if (o && typeof o === 'object' && !Array.isArray(o)) for (const [k, v] of Object.entries(o)) if (typeof v === 'string' && k.length <= 200 && ids.includes(v)) PEOPLE[k] = v; } catch (e) { PEOPLE = {}; } } }
    /* every main session of the app (model.sessions), not only the folders on screen: a filter must not hand a hidden session a new person */
    const sessions = model.sessions || model.folders.flatMap((f) => f.agents.map((a) => ({ id: a.id, folder: f.id })));
    const next = L.assignPeople(PEOPLE, sessions, ids, rand);
    if (JSON.stringify(next) !== JSON.stringify(PEOPLE)) { PEOPLE = next; if (remember) { try { localStorage.setItem('durbar.realpeople', JSON.stringify(PEOPLE)); } catch (e) { /* storage full or off: the pick still holds for this window */ } } }
    return PEOPLE;
  }

  /**
   * Draw the office into `stage`. `model`: {folders:[{id,name,path,cost,counts:[{state,n,word}],newSess,menu,agents:[{id,name,role,
   * state,word,task,label,tip,selected,away,awayLabel,helpers:[state]}]}], places:[{id,label,custom,post,title,go,visitors:[{id,name,
   * needsYou,title}]}]}; `view`: {w,h}; `opts`: {still, set, rand, remember, onArt}. Returns the layout (for the app's checks).
   */
  function render(stage, model, view, opts) {
    const L = X(), meta = root.DurbarRealOfficeArt;
    onArt = opts.onArt || null;
    const set = opts.set || 'office';
    const ids = Object.keys(meta.seat).sort();
    const who = people(model, ids, opts.rand, !!opts.remember);
    const seatOk = (p) => !!p && !['typeA', 'think', 'waveA', 'rest'].some((f) => BAD.has(p + '-' + f + '.webp'));
    const engine = {
      folders: model.folders.map((f) => ({ id: f.id, agents: f.agents.map((a) => ({ id: a.id, state: a.state, away: a.away || null, person: seatOk(who[a.id]) ? who[a.id] : null })) })),
      places: model.places.map((p) => ({ id: p.id, custom: !!p.custom, visitors: p.visitors.map((v) => ({ id: v.id, needsYou: !!v.needsYou, person: who[v.id] || null })) })),
    };
    const signs = {};
    for (const f of model.folders) signs[f.id] = { name: f.name, path: f.path, counts: f.counts.length + (f.cost ? 1 : 0) };
    const lay = L.realLayout(engine, view, meta, signs);

    let ro = stage.querySelector(':scope > .ro');
    if (!ro) { stage.textContent = ''; ro = document.createElement('div'); ro.className = 'ro'; stage.appendChild(ro); ro.addEventListener('click', forward); wireZoom(ro); }
    ro.style.width = px(lay.width); ro.style.height = px(lay.height);
    ro.dataset.set = set; ro.dataset.u = String(Math.round(lay.u)); ro.dataset.face = String(Math.round(lay.faceH * 10) / 10); ro.dataset.big = lay.big ? '1' : '0';
    ro.classList.toggle('still', !!opts.still);
    ro.classList.toggle('hold', !!opts.hold); /* the people stand still, the lights may not (FR-071) */
    const drawn = !!(CUR && CUR.ro === ro && CUR.drawn);
    if (!drawn) OFF.clear();
    if (ZOOM && !ZOOM.panel.isConnected) closeZoom();
    const sized = view.w + 'x' + view.h, sameSize = !!CUR && CUR.sized === sized && !!CUR.painted;
    CUR = { ro, screenOf: opts.screenOf || null, sized, still: !!opts.still, hold: !!opts.hold, desks: new Map(lay.zones.flatMap((z) => z.desks.map((d) => [d.id, d]))), agents: new Map(model.folders.flatMap((f) => f.agents.map((a) => [a.id, { ...a, folder: f.name }]))), drawn, scroll: !!lay.scroll };
    SLIDE = sameSize && moving() && !hiddenNow();
    CUR.painted = true;
    ro.classList.toggle('paused', hiddenNow()); if (hiddenNow()) finishMoves(ro);
    /* z-order (plan: art < lights < chrome): floor and fixtures, people and desks; the ambient and the lights; then signs, plates, chips */
    const art = layerOf(ro, 'ro-art'), amb = layerOf(ro, 'ro-amb'), lights = layerOf(ro, 'ro-lights'), chrome = layerOf(ro, 'ro-chrome');
    const lobby = el(art, 'lobby', 'div', 'ro-lobby'); box(lobby, { x: 0, y: 0, w: lay.width, h: lay.lobbyH });
    const strip = el(art, 'strip', 'div', 'ro-strip'); box(strip, lay.floorStrip);
    /* FR-043: the room ambient: the share of active desks among the visible ones */
    const states = lay.zones.flatMap((z) => z.desks.map((d) => d.state));
    const ambient = L.ambientFor(states);
    ro.style.setProperty('--ro-amb', String(Math.round((1 - ambient) * 1000) / 1000));
    ro.dataset.ambient = String(ambient);
    const ambEl = el(amb, 'amb', 'div', 'ro-ambient'); box(ambEl, { x: 0, y: 0, w: lay.width, h: lay.height });

    const byFolder = new Map(model.folders.map((f) => [f.id, f]));
    const byAgent = new Map(model.folders.flatMap((f) => f.agents.map((a) => [a.id, a])));
    const now = Date.now();
    for (const z of lay.zones) {
      const f = byFolder.get(z.id);
      const zk = z.id + '\u0000' + z.part; /* a folder too big for one row has more parts, each its own zone (the sign repeats, "continued") */
      const zb = el(art, 'z:' + zk, 'div', 'ro-zone'); box(zb, z.box);
      /* FR-018: the folder sign: name, path, counts, cost, + and the room menu (the app's own handlers: data-newsess, data-foldermenu) */
      const sg = el(chrome, 's:' + zk, 'div', 'ro-sign'); box(sg, { x: z.sign.x, y: z.sign.y, h: z.sign.h }); sg.style.maxWidth = px(z.sign.w);
      sg.dataset.folder = z.id;
      const sig = JSON.stringify([f.name, f.path, f.counts, f.cost, f.newSess, f.menu, z.part]);
      if (sg._sig !== sig && z.part > 1) { sg._sig = sig; sg.textContent = ''; const b = document.createElement('b'); b.textContent = f.name + ' (continued)'; b.title = f.name + '\n' + f.path; sg.appendChild(b); }
      if (sg._sig !== sig) {
        sg._sig = sig; sg.textContent = '';
        const b = document.createElement('b'); b.textContent = f.name; b.title = f.name + '\n' + f.path; sg.appendChild(b);
        const p = document.createElement('span'); p.className = 'ro-path'; p.textContent = f.path; sg.appendChild(p);
        const sc = document.createElement('span'); sc.className = 'ro-sc';
        for (const c of f.counts) { const s = document.createElement('span'); s.className = 'ro-cnt'; s.title = c.n + ' ' + c.word; s.insertAdjacentHTML('beforeend', dotHTML(c.state)); s.appendChild(document.createTextNode(String(c.n))); sc.appendChild(s); }
        if (f.cost) { const m = document.createElement('span'); m.className = 'ro-cost'; m.textContent = f.cost; sc.appendChild(m); }
        if (f.newSess) { const nb = document.createElement('button'); nb.type = 'button'; nb.className = 'ro-sb'; nb.dataset.newsess = z.id; nb.title = nb.ariaLabel = 'New session in ' + f.name; nb.setAttribute('aria-label', 'New session in ' + f.name); nb.textContent = '+'; sc.appendChild(nb); }
        if (f.menu) { const mb = document.createElement('button'); mb.type = 'button'; mb.className = 'ro-sb'; mb.dataset.foldermenu = z.id; mb.setAttribute('aria-haspopup', 'menu'); mb.setAttribute('aria-label', 'Folder actions for ' + f.name); mb.title = 'Folder actions'; mb.textContent = '⋯'; sc.appendChild(mb); }
        sg.appendChild(sc);
      }
      for (const d of z.desks) {
        const a = byAgent.get(d.id), k = d.id;
        const lt = L.lightFor(d.state, { still: !!opts.still });
        /* the person, behind the desk: FR-036's pose, FR-070's second frame or breath, FR-072's cross-fade; FR-065: the initials disc when the picture failed */
        if (d.person) {
          const m = L.personMotion(k, d.person.pose, d.state);
          const fresh = !art._k.has('p:' + k);
          const rigged = d.person.pose === 'typeA' && moving() && LOD === 0 && !GLIDING.has(k) && !(fresh && CUR.drawn && WHERE.has(k)) && meta.rig && has(meta.rig, d.person.pid) ? meta.rig[d.person.pid] : null;
          const two = !rigged && moving() && m.kind === 'frames' && d.person.fileB && !BAD.has(d.person.fileB) && !GLIDING.has(k) ? second(art, 'pb:' + k, k, d.person, d.person.fileB, 'ro-person2', m) : null;
          const pe = el(art, 'p:' + k, 'img', 'ro-person' + (rigged ? ' m-rig' : two && two.on ? ' m-a m-' + m.style : m.kind === 'breathe' && moving() ? ' m-br' : '') + (OFF.has(k) ? ' ro-off' : ''));
          box(pe, d.person); pe.dataset.for = k; pe.dataset.pose = d.person.pose;
          const was = pe.getAttribute('src');
          if (was && was !== ART + d.person.file && moving() && !hiddenNow() && !OFF.has(k)) { const g = pe.cloneNode(false); art.insertBefore(g, pe); fadeAway(g, 120); pe.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 170, delay: 90, easing: 'ease-in-out', fill: 'backwards' }); } /* FR-072, spec Changes 2026-11-01: the old out, then the new in */
          img(pe, d.person.file);
          if (fresh && CUR.drawn && moving() && !hiddenNow() && !OFF.has(k) && !glide(pe, k, WHERE.get(k), d.person)) fadeIn(pe, 150, 150); /* FR-073: in at the desk */
          WHERE.set(k, d.person);
          if (m.kind) { setVar(pe, '--ro-per', m.period + 's'); setVar(pe, '--ro-sw', m.sway + 's'); setVar(pe, '--ro-u', (d.person.h / 100).toFixed(3) + 'px'); }
          if (rigged) rigOf(art, k, d.person, rigged, m, pe);
          if (two && two.on && !two.b._clock) { two.b._clock = true; clock(two.b, m.offset); clock(pe, m.offset); }
        } else if (!d.narrow) {
          const ini = el(art, 'i:' + k, 'div', 'ro-initials'); const r = 0.5 * lay.u; box(ini, { x: d.slot.x + 0.05 * d.slot.w + 0.42 * lay.u - r / 2, y: d.desk.y - r - 6, w: r, h: r }); ini.dataset.for = k; text(ini, initials(a.name));
        }
        const dc = el(art, 'd:' + k, 'div', 'ro-desk' + (d.narrow ? ' narrow' : '')); box(dc, d.desk); dc.dataset.for = k;
        const dk = dc.firstChild || dc.appendChild(document.createElement('img')); dk.style.height = px(d.desk.full); img(dk, 'desk.webp');
        /* the monitor: the glass in the art; its text sits with the chrome, above the lights (FR-044), and repaints on its own (FR-033) */
        const sc = el(art, 'm:' + k, 'div', 'ro-screen st-' + d.state + (lt.glow === 'off' ? ' off' : '')); box(sc, d.screen); sc.dataset.for = k;
        if (!sc.firstChild) sc.innerHTML = '<div class="ro-bezel"><div class="ro-glass" aria-hidden="true"></div></div><div class="ro-neck"></div><div class="ro-foot"></div>';
        const bez = sc.firstChild; bez.style.height = px(d.glass.h + 6);
        screenBox(chrome, d, k);
        /* FR-040, FR-041: lamp, screen glow and call light, as classes over the art (D4) */
        const lamp = el(lights, 'l:' + k, 'div', 'ro-lamp lamp-' + lt.lamp + (lt.motion === 'pulse' ? ' pulse' : '')); box(lamp, d.lamp);
        const glow = el(lights, 'g:' + k, 'div', 'ro-glow glow-' + lt.glow + (lt.motion === 'breathe' ? ' breathe' : '')); box(glow, { x: d.glass.x - 6, y: d.glass.y - 6, w: d.glass.w + 12, h: d.glass.h + 12 });
        let call = lt.call;
        if (call === 'green-once') {
          if (L.doneTick(SEEN, k, d.state)) TICKS.set(k, now);
          const t0 = TICKS.get(k); call = t0 && now - t0 < 2000 ? 'green' : null;
          if (call) setTimeout(() => { if (onArt) onArt(); }, 2050 - (now - t0)); /* redraw when the tick is over */
        } else { L.doneTick(SEEN, k, d.state); TICKS.delete(k); }
        if (call) { const c = el(lights, 'c:' + k, 'div', 'ro-call call-' + call + (lt.motion === 'pulse' ? ' pulse' : '') + (call === 'green' && !opts.still ? ' fade' : '')); box(c, { x: d.call.x, y: d.call.y, w: 10, h: 10 }); c.dataset.for = k; }
        /* FR-038: cues, inside the slot */
        if (d.bubble) { const b = el(chrome, 'b:' + k, 'div', 'ro-bub'); box(b, d.bubble); attr(b, 'aria-hidden', 'true'); text(b, '?'); }
        if (d.bang) { const b = el(chrome, 'x:' + k, 'div', 'ro-bang'); box(b, d.bang); attr(b, 'aria-hidden', 'true'); text(b, '!'); }
        if (d.dots) { const b = el(chrome, 't:' + k, 'div', 'ro-dots'); box(b, d.dots); attr(b, 'aria-hidden', 'true'); if (!b.firstChild) b.innerHTML = '<i></i><i></i><i></i>'; }
        if (d.away) { const w = el(chrome, 'a:' + k, 'div', 'ro-away'); box(w, { x: d.away.x, y: d.away.y, w: d.away.s, h: d.away.s }); text(w, 'at ' + a.awayLabel); if (!w._in && CUR.drawn && moving() && !hiddenNow()) w.animate([{ transform: 'translateX(-50%) rotate(-2.5deg) scale(.7)', opacity: 0 }, { transform: 'translateX(-50%) rotate(-2.5deg)', opacity: 1 }], { duration: ZOOM_IN, delay: ZOOM_OUT - 40, easing: 'cubic-bezier(.2,.7,.3,1)', fill: 'backwards' }); w._in = true; }
        /* FR-016, FR-090: the name plate is the desk's one focusable button; the app's click handler opens the chat ([data-id]) */
        const pl = el(chrome, 'n:' + k, 'button', 'ro-plate st-' + d.state + (a.selected ? ' sel' : '') + (d.narrow ? ' narrow' : '')); box(pl, d.plate);
        pl.type = 'button'; pl.dataset.id = k; pl.dataset.state = d.state;
        attr(pl, 'aria-pressed', a.selected ? 'true' : 'false'); attr(pl, 'aria-label', a.label); attr(pl, 'title', a.tip);
        const psig = JSON.stringify([a.name, a.role, a.word, a.task, a.helpers, d.state]);
        if (pl._sig !== psig) {
          pl._sig = psig; pl.textContent = '';
          const l1 = document.createElement('span'); l1.className = 'ro-l1';
          const nm = document.createElement('b'); nm.textContent = a.name; l1.appendChild(nm);
          const rl = document.createElement('span'); rl.className = 'ro-role'; rl.textContent = a.role; l1.appendChild(rl);
          if (a.helpers.length) { const h = document.createElement('span'); h.className = 'ro-help'; h.textContent = '+' + a.helpers.length + ' '; a.helpers.slice(0, 3).forEach((s) => h.insertAdjacentHTML('beforeend', dotHTML(s))); l1.appendChild(h); }
          const l2 = document.createElement('span'); l2.className = 'ro-l2';
          l2.insertAdjacentHTML('beforeend', dotHTML(d.state));
          l2.appendChild(document.createTextNode(' ' + a.word + (a.task ? ' · ' + a.task : '')));
          pl.appendChild(l1); pl.appendChild(l2);
        }
      }
    }
    /* the lobby band: fixtures, their lights, visitors and chips, place plates (FR-023..FR-027, FR-045) */
    const byPlace = new Map(model.places.map((p) => [p.id, p]));
    for (const fx of lay.fixtures) {
      const p = byPlace.get(fx.id), file = 'fx-' + fx.id + '.webp';
      if (fx.art && !fx.custom && !BAD.has(file)) { const im = el(art, 'f:' + fx.id, 'img', 'ro-fx'); box(im, fx.art); img(im, file); }
      else if (fx.art && fx.custom) { const ki = el(art, 'f:' + fx.id, 'div', 'ro-kiosk'); box(ki, { x: fx.art.x + fx.art.w * 0.2, y: fx.art.y + fx.art.h * 0.35, w: fx.art.w * 0.6, h: fx.art.h * 0.65 }); if (ki._ic !== p.icon) { ki._ic = p.icon; ki.innerHTML = p.icon || ''; } }
      const fl = L.fixtureLight(fx.id, p.visitors.length, p.visitors.some((v) => v.needsYou));
      if (fl && fx.art) { const li = el(lights, 'fl:' + fx.id, 'div', 'ro-fxl fxl-' + fl + (fx.id === 'boss' ? ' boss' : '')); box(li, fx.light); }
      for (const v of fx.visitors) {
        const ag = p.visitors.find((x) => x.id === v.id);
        if (v.fig && !BAD.has(v.fig.file)) {
          /* owner 2026-10-31 10:19 and 10:48: the feet on the front floor plane (layout), with a soft contact shadow under them */
          const sh = el(art, 'vs:' + v.id, 'div', 'ro-shadow'); box(sh, v.shadow);
          /* FR-070: stride frames, a sip, a knock or a breath; FR-073: in at the fixture after the fade at the desk */
          const m = L.personMotion(v.id, v.fig.pose, null), fresh = !art._k.has('v:' + v.id), mov = moving() && !OFF.has(v.id);
          const two = mov && m.kind === 'frames' && v.fig.fileB && !BAD.has(v.fig.fileB) && !(GLIDING.has(v.id) || (fresh && CUR.drawn && WHERE.has(v.id))) ? second(art, 'vb:' + v.id, v.id, v.fig, v.fig.fileB, 'ro-visitor2', m) : null;
          const cl = two && two.on ? ' m-a m-' + m.style : mov ? ({ breathe: ' m-br', sip: ' m-sip', knock: ' m-knock' }[m.kind] || '') : '';
          const im = el(art, 'v:' + v.id, 'img', 'ro-visitor' + cl); box(im, v.fig); im.dataset.for = v.id; im.dataset.pose = v.fig.pose; im.dataset.feet = String(Math.round(v.fig.feetY * 10) / 10); img(im, v.fig.file);
          if (cl) { setVar(im, '--ro-per', m.period + 's'); setVar(im, '--ro-sw', m.sway + 's'); setVar(im, '--ro-u', (v.fig.h / 100).toFixed(3) + 'px'); setVar(im, '--ro-org', '50% ' + px(v.fig.feetY - v.fig.y)); }
          if (fresh && CUR.drawn && moving() && !hiddenNow() && !glide(im, v.id, WHERE.get(v.id), v.fig)) fadeIn(im, 150, 150);
          WHERE.set(v.id, v.fig);
          if (two && two.on && !two.b._clock) { two.b._clock = true; clock(two.b, m.offset); clock(im, m.offset); }
        }
        /* FR-026 "as the flat lobby": a go-place visitor (Boss, Bank, Coffee) is the flat lobby's own button (data-pvopen, and
           data-coffeeid for the coffee menu): app.js's delegated handlers open the chat; others forward to their plate (data-for) */
        const ch = el(chrome, 'vc:' + v.id, p.go ? 'button' : 'span', 'ro-chip' + (ag.needsYou ? ' wait' : '')); box(ch, v.chip); ch.dataset.y = String(v.chip.y); ch.dataset.x = String(v.chip.x);
        if (p.go) { ch.type = 'button'; ch.dataset.pvopen = v.id; if (fx.id === 'coffee') ch.dataset.coffeeid = v.id; attr(ch, 'aria-label', ag.title + '. Open the chat.'); } else ch.dataset.for = v.id;
        attr(ch, 'title', ag.title); ch.dataset.name = ag.name; chipFill(ch, ag.name, ag.needsYou, model.alertIcon);
      }
      /* FR-025/FR-026 "as the flat lobby": the people that do not fit ("+N") open the flat lobby's own list (data-placemore, app.js
         openPlaceMenu), so the plate is a button then, with a name that says so */
      const pl = el(chrome, 'fp:' + fx.id, p.post || fx.more > 0 ? 'button' : 'div', 'ro-lplate' + (p.visitors.some((v) => v.needsYou) ? ' wait' : '')); box(pl, { x: fx.plate.x, y: fx.plate.y });
      if (p.post) { pl.type = 'button'; pl.dataset.post = '1'; } else if (fx.more > 0) { pl.type = 'button'; pl.dataset.placemore = fx.id; attr(pl, 'aria-haspopup', 'menu'); } else { attr(pl, 'role', 'group'); }
      pl.dataset.place = fx.id; pl.style.maxWidth = px(Math.max(44, fx.plate.w));
      attr(pl, 'title', fx.more > 0 ? p.title + '. ' + fx.more + ' more: open the list.' : p.title); attr(pl, 'aria-label', fx.more > 0 ? p.title + '. ' + fx.more + ' more: open the list.' : p.title);
      /* owner 2026-10-31 09:03: no bare count when the people are visible; "+N" only for those that do not fit */
      const lsig = JSON.stringify([p.label, fx.more]);
      if (pl._sig !== lsig) { pl._sig = lsig; pl.textContent = ''; const s = document.createElement('span'); s.textContent = p.label; pl.appendChild(s); if (fx.more > 0) { const b = document.createElement('b'); b.className = 'ro-more'; b.textContent = '+' + fx.more; pl.appendChild(b); } }
    }
    sweep(art, drawn && moving() && !hiddenNow()); [amb, lights, chrome].forEach((l) => sweep(l));
    fitPlates(chrome, lay.width);
    stagger(chrome, lay.width);
    for (const [id, s] of SCR) if (!CUR.desks.has(id)) { clearTimeout(s.timer); if (IO) IO.unobserve(s.box); SCR.delete(id); }
    watchOff(lay);
    SLIDE = false;
    CUR.drawn = true;
    if (moving() && !hiddenNow()) handOver(ro);
    watchFrames(ro);
    if (ZOOM) { if (!CUR.desks.has(ZOOM.id) || hiddenNow()) closeZoom(); else placeZoom(); }
    settle(chrome, lay.width);
    return lay;
  }

  /* a font that arrives after the measure (a lazily loaded bold face, another machine's metrics) widens a chip or plate: a
     ResizeObserver sees it and places again, so nothing overlaps in the settled state. A width equal to the one the placement
     used ends it (no loop). */
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
          if (moved) { chrome._settled = (chrome._settled || 0) + 1; fitPlates(chrome, chrome._W); stagger(chrome, chrome._W); } /* _settled: the driver sees the observer act */
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
    box(b, rect); b.dataset.for = id; setVar(b, '--ro-per', m.period + 's'); setVar(b, '--ro-sw', m.sway + 's'); setVar(b, '--ro-u', (rect.h / 100).toFixed(3) + 'px');
    if (b._file !== file) {
      b._file = file; b._ok = false; b._clock = false;
      img(b, file);
      b.decode().then(() => { if (b._file === file) { b._ok = true; if (onArt) onArt(); } }, () => {});
    }
    return { b, on };
  }

  /* ---- FR-030..FR-035: the monitors ---- */
  function screenBox(chrome, d, k) {
    const L = X(), f = L.screenFit(d.glass), box2 = el(chrome, 'st:' + k, 'div', 'ro-stext st-' + d.state + (f.small ? ' small' : '') + (d.state === 'asleep' ? ' off' : '') + (OFF.has(k) ? ' ro-off' : '')); box(box2, d.glass); attr(box2, 'aria-hidden', 'true');
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
    const L = X(), data = CUR.screenOf(id, d.state, a.word), f = L.screenFit(d.glass);
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
    if (data.caret && !s.caret) { s.caret = document.createElement('i'); s.caret.className = 'ro-caret'; s.box.appendChild(s.caret); const m = L.personMotion(id, 'typeA', d.state); setVar(s.caret, '--ro-per', '1.2s'); if (moving()) clock(s.caret, m.offset); }
    else if (!data.caret && s.caret) { s.caret.remove(); s.caret = null; }
    s.painted = true;
    if (ZOOM && ZOOM.id === id) fillZoom();
  }

  /* FR-074: a window hidden or back; FR-181: desks scrolled away stand still and do not paint, and catch up once when they are back */
  function resume() {
    if (!CUR) return;
    const h = hiddenNow(); CUR.ro.classList.toggle('paused', h); if (h) finishMoves(CUR.ro);
    if (h) { closeZoom(); return; }
    for (const [id, s] of SCR) if (s.dirty) plan(id);
  }
  document.addEventListener('visibilitychange', resume);
  function setOff(id, off) {
    if (off === OFF.has(id)) return;
    if (off) OFF.add(id); else OFF.delete(id);
    if (!CUR) return;
    const art = CUR.ro.querySelector(':scope > .ro-art');
    for (const key of ['p:', 'pb:']) { const e = art && art._k.get(key + id); if (e) e.classList.toggle('ro-off', off); }
    const s = SCR.get(id); if (s) s.box.classList.toggle('ro-off', off);
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
  function wireZoom(ro) {
    let wait = 0;
    ro.addEventListener('pointerover', (e) => {
      const sc = e.target.closest && e.target.closest('.ro-screen');
      if (!sc || e.pointerType === 'touch' || !sc.dataset.for) return;
      if ((ZOOM && ZOOM.hover && ZOOM.id === sc.dataset.for) || DISMISSED === sc.dataset.for) return; /* Esc holds until the pointer has left */
      clearTimeout(wait); wait = setTimeout(() => openZoom(sc.dataset.for, 'hover'), 120); /* crossing the room opens nothing */
    });
    ro.addEventListener('pointerout', (e) => {
      const sc = e.target.closest && e.target.closest('.ro-screen');
      if (!sc || (e.relatedTarget && sc.contains(e.relatedTarget))) return;
      clearTimeout(wait); DISMISSED = '';
      if (ZOOM && ZOOM.id === sc.dataset.for) leaveZoom('hover');
    });
    ro.addEventListener('focusin', (e) => { const p = e.target.closest && e.target.closest('.ro-plate'); if (p && p.matches(':focus-visible')) openZoom(p.dataset.id, 'focus'); });
    ro.addEventListener('focusout', (e) => { const p = e.target.closest && e.target.closest('.ro-plate'); if (p && ZOOM && ZOOM.id === p.dataset.id) leaveZoom('focus'); });
  }
  function zoomKey(e) {
    if (e.key !== 'Escape' || !ZOOM) return;
    if (hiddenNow()) { closeZoom(); return; } /* the office is covered: this Escape is for what covers it */
    e.preventDefault(); e.stopPropagation(); DISMISSED = ZOOM.hover ? ZOOM.id : ''; closeZoom();
  }
  function openZoom(id, why) {
    if (!CUR || hiddenNow() || !CUR.desks.has(id) || !CUR.screenOf) return;
    if (CUR.desks.get(id).state === 'asleep') return; /* FR-035: an asleep screen is off, nothing to read */
    if (!ZOOM || ZOOM.id !== id) {
      closeZoom();
      const p = document.createElement('div'); p.className = 'ro-zoom'; p.id = 'roZoom'; p.setAttribute('role', 'region');
      p.innerHTML = '<div class="ro-zh"><b></b><span class="ro-zr"></span><span class="ro-zs"></span><span class="ro-zf"></span></div><div class="ro-zb"><div class="ro-zl"></div></div>';
      CUR.ro.appendChild(p);
      ZOOM = { id, hover: false, focus: false, panel: p, plate: CUR.ro.querySelector('.ro-plate[data-id="' + CSS.escape(id) + '"]') };
      if (ZOOM.plate) ZOOM.plate.setAttribute('aria-describedby', 'roZoom');
      document.addEventListener('keydown', zoomKey, true);
      addEventListener('blur', closeZoom);
      const fl = CUR.ro.closest('#floor'); if (fl) { ZOOM.floor = fl; fl.addEventListener('scroll', closeZoom, { passive: true }); }
      fillZoom(); placeZoom();
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
    removeEventListener('blur', closeZoom);
    if (z.floor) z.floor.removeEventListener('scroll', closeZoom);
    for (const id of z.under || []) { const s = SCR.get(id); if (!s || !s.away) setOff(id, false); }
  }
  /* name, role, status, folder and the last lines, textContent only (FR-031, FR-034); a described region, not a live one */
  function fillZoom() {
    const a = CUR.agents.get(ZOOM.id), d = CUR.desks.get(ZOOM.id), p = ZOOM.panel;
    if (!a || !d) return;
    p.setAttribute('aria-label', 'Screen of ' + a.name);
    p.dataset.state = d.state; p.dataset.for = ZOOM.id;
    text(p.querySelector('.ro-zh b'), a.name); text(p.querySelector('.ro-zr'), a.role); text(p.querySelector('.ro-zs'), a.word); text(p.querySelector('.ro-zf'), a.folder);
    const data = CUR.screenOf(ZOOM.id, d.state, a.word);
    const host = p.querySelector('.ro-zl');
    fillRows(host, data.lines);
    ZOOM.rows = data.lines.reduce((n, l) => n + Math.max(1, Math.ceil(Array.from(l.t).length / 52)), 0);
  }
  function placeZoom() {
    const ro = CUR.ro, o = ro.getBoundingClientRect(), fl = ro.closest('#floor'), f = fl ? fl.getBoundingClientRect() : o, d = CUR.desks.get(ZOOM.id);
    const near = (e) => { const b = e.getBoundingClientRect(); return { x: b.left - o.left, y: b.top - o.top, w: b.width, h: b.height }; };
    const avoid = [d.screen, ...[...ro.querySelectorAll('.ro-plate:is(.st-waiting,.st-limit), .ro-lplate.wait, .ro-chip.wait')].map(near)];
    if (ZOOM.plate) avoid.push(near(ZOOM.plate));
    const view = { x: Math.max(0, f.left - o.left), y: Math.max(0, f.top - o.top), w: Math.min(f.right, o.right) - Math.max(f.left, o.left), h: Math.min(f.bottom, o.bottom) - Math.max(f.top, o.top) };
    const w = Math.max(ZOOM_W[0], Math.min(ZOOM_W[1], view.w * 0.34));
    const rows = Math.max(ZOOM_MIN_ROWS, Math.min(ZOOM_ROWS, ZOOM.rows || 0));
    const r = X().zoomRect(d.screen, avoid, view, { w, h: ZOOM_HEAD + rows * ZOOM_LH + 12, minH: ZOOM_HEAD + ZOOM_MIN_ROWS * ZOOM_LH + 12 });
    box(ZOOM.panel, r); ZOOM.panel.dataset.side = r.side;
    setVar(ZOOM.panel, '--ro-zh', Math.max(1, Math.floor((r.h - ZOOM_HEAD - 8) / ZOOM_LH)) * ZOOM_LH + 'px');
    /* what the panel covers whole stands still until it closes */
    const under = [];
    for (const [id, de] of CUR.desks) if (id !== ZOOM.id && de.person && de.person.x >= r.x && de.person.x + de.person.w <= r.x + r.w && de.person.y >= r.y && de.person.y + de.person.h <= r.y + r.h) { under.push(id); setOff(id, true); }
    for (const id of ZOOM.under || []) if (!under.includes(id)) { const s = SCR.get(id); if (!s || !s.away) setOff(id, false); }
    ZOOM.under = under;
  }

  /* Paco's review of #921 (art): a lobby place plate reads in full (never an ellipsis) when there is room: a plate wider than its
     slot grows to the right, then to the left, into free space only (up to the next plate on the same rows or the band's edge); no
     fixture moves. Measured once per render, left to right, so a plate never covers another. Too little room keeps the ellipsis
     (the driver fails on it). */
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
     text; constitution V: no emoji), the name goes in with textContent. `label` is the name or, when crowded, the initials. */
  function chipFill(ch, label, wait, icon) {
    const w = wait && icon ? icon : '';
    if (ch._ic !== w || !ch.querySelector('.ro-cn')) {
      ch._ic = w; ch.textContent = '';
      if (w) { const i = document.createElement('span'); i.className = 'ro-ci'; i.setAttribute('aria-hidden', 'true'); i.innerHTML = w; ch.appendChild(i); }
      const n = document.createElement('span'); n.className = 'ro-cn'; ch.appendChild(n);
    }
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
  function reset() { PEOPLE = null; SEEN.clear(); TICKS.clear(); }
  root.DurbarRealOffice = { render, reset, feed, resume, bad: () => [...BAD], resolve, stagger }; /* resolve: for the driver's deterministic check */
})(typeof self !== 'undefined' ? self : this);
