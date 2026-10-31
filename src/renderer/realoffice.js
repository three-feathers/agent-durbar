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
  const box = (el, r) => { el.style.left = px(r.x); el.style.top = px(r.y); if (r.w != null) el.style.width = px(r.w); if (r.h != null) el.style.height = px(r.h); };
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
      if (e) e.remove();
      e = document.createElement(tag); layer.appendChild(e); layer._k.set(key, e);
    }
    if (e.className !== cls) e.className = cls;
    layer._seen.add(key);
    return e;
  }
  /* FR-073: `fade`: a person or visitor who left fades where they stood (the fade itself is a picture nobody can click) */
  function sweep(layer, fade) { for (const [k, e] of layer._k) if (!layer._seen.has(k)) { if (fade && (k.startsWith('p:') || k.startsWith('v:'))) fadeAway(e, 150); else e.remove(); layer._k.delete(k); } }
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
  /* a one-time picture that goes away: FR-072's old pose, FR-073's person leaving a desk or a fixture; stepped opacity only (FR-180, FR-181) */
  function fadeAway(e, ms) {
    e.className = 'ro-ghost'; delete e.dataset.for;
    const a = e.animate([{ opacity: 1 }, { opacity: 0 }], { duration: ms, easing: 'steps(5, end)', fill: 'forwards' });
    a.onfinish = a.oncancel = () => e.remove();
  }
  function fadeIn(e, ms, delay) { e.animate([{ opacity: 0 }, { opacity: 1 }], { duration: ms, delay: delay || 0, easing: 'steps(5, end)', fill: 'backwards' }); }
  function setVar(e, k, v) { if (e.style.getPropertyValue(k) !== v) e.style.setProperty(k, v); }
  /* FR-181: a desk's picture frames and caret change on the same frame: one clock per desk, its own place in the cycle */
  function clock(e, ms) { for (const a of e.getAnimations()) a.startTime = ms; }

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
    CUR = { ro, screenOf: opts.screenOf || null, still: !!opts.still, hold: !!opts.hold, desks: new Map(lay.zones.flatMap((z) => z.desks.map((d) => [d.id, d]))), agents: new Map(model.folders.flatMap((f) => f.agents.map((a) => [a.id, { ...a, folder: f.name }]))), drawn, scroll: !!lay.scroll };
    ro.classList.toggle('paused', hiddenNow());
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
          const two = moving() && m.kind === 'frames' && d.person.fileB && !BAD.has(d.person.fileB) ? second(art, 'pb:' + k, k, d.person, d.person.fileB, 'ro-person2', m) : null;
          const pe = el(art, 'p:' + k, 'img', 'ro-person' + (two && two.on ? ' m-a' : m.kind === 'breathe' && moving() ? ' m-br' : '') + (OFF.has(k) ? ' ro-off' : ''));
          box(pe, d.person); pe.dataset.for = k; pe.dataset.pose = d.person.pose;
          const was = pe.getAttribute('src');
          if (was && was !== ART + d.person.file && moving() && !hiddenNow() && !OFF.has(k)) { const g = pe.cloneNode(false); art.insertBefore(g, pe); fadeAway(g, 250); } /* FR-072 */
          img(pe, d.person.file);
          if (fresh && CUR.drawn && moving() && !hiddenNow() && !OFF.has(k)) fadeIn(pe, 150, 150); /* FR-073: in at the desk after the fade at the fixture */
          if (m.kind) setVar(pe, '--ro-per', m.period + 's');
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
        if (d.away) { const w = el(chrome, 'a:' + k, 'div', 'ro-away'); box(w, d.away); text(w, 'at ' + a.awayLabel + ' ↑'); }
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
          const two = mov && m.kind === 'frames' && v.fig.fileB && !BAD.has(v.fig.fileB) ? second(art, 'vb:' + v.id, v.id, v.fig, v.fig.fileB, 'ro-visitor2', m) : null;
          const cl = two && two.on ? ' m-a' : mov ? ({ breathe: ' m-br', sip: ' m-sip', knock: ' m-knock' }[m.kind] || '') : '';
          const im = el(art, 'v:' + v.id, 'img', 'ro-visitor' + cl); box(im, v.fig); im.dataset.for = v.id; im.dataset.pose = v.fig.pose; im.dataset.feet = String(Math.round(v.fig.feetY * 10) / 10); img(im, v.fig.file);
          if (fresh && CUR.drawn && moving() && !hiddenNow()) fadeIn(im, 150, 150);
          if (cl) { setVar(im, '--ro-per', m.period + 's'); setVar(im, '--ro-org', '50% ' + px(v.fig.feetY - v.fig.y)); }
          if (two && two.on && !two.b._clock) { two.b._clock = true; clock(two.b, m.offset); clock(im, m.offset); }
        }
        /* FR-026 "as the flat lobby": a go-place visitor (Boss, Bank, Coffee) is the flat lobby's own button (data-pvopen, and
           data-coffeeid for the coffee menu): app.js's delegated handlers open the chat; others forward to their plate (data-for) */
        const ch = el(chrome, 'vc:' + v.id, p.go ? 'button' : 'span', 'ro-chip' + (ag.needsYou ? ' wait' : '')); box(ch, v.chip); ch.dataset.y = String(v.chip.y); ch.dataset.x = String(v.chip.x);
        if (p.go) { ch.type = 'button'; ch.dataset.pvopen = v.id; if (fx.id === 'coffee') ch.dataset.coffeeid = v.id; attr(ch, 'aria-label', ag.title + '. Open the chat.'); } else ch.dataset.for = v.id;
        attr(ch, 'title', ag.title); ch.dataset.name = ag.name; chipFill(ch, ag.name, ag.needsYou, model.alertIcon);
      }
      const pl = el(chrome, 'fp:' + fx.id, p.post ? 'button' : 'div', 'ro-lplate' + (p.visitors.some((v) => v.needsYou) ? ' wait' : '')); box(pl, { x: fx.plate.x, y: fx.plate.y });
      if (p.post) { pl.type = 'button'; pl.dataset.post = '1'; } else { attr(pl, 'role', 'group'); }
      pl.dataset.place = fx.id; pl.style.maxWidth = px(Math.max(44, fx.plate.w));
      attr(pl, 'title', p.title); attr(pl, 'aria-label', p.title);
      /* owner 2026-10-31 09:03: no bare count when the people are visible; "+N" only for those that do not fit */
      const lsig = JSON.stringify([p.label, fx.more]);
      if (pl._sig !== lsig) { pl._sig = lsig; pl.textContent = ''; const s = document.createElement('span'); s.textContent = p.label; pl.appendChild(s); if (fx.more > 0) { const b = document.createElement('b'); b.className = 'ro-more'; b.textContent = '+' + fx.more; pl.appendChild(b); } }
    }
    sweep(art, drawn && moving() && !hiddenNow()); [amb, lights, chrome].forEach((l) => sweep(l));
    stagger(chrome);
    for (const [id, s] of SCR) if (!CUR.desks.has(id)) { clearTimeout(s.timer); if (IO) IO.unobserve(s.box); SCR.delete(id); }
    watchOff(lay);
    CUR.drawn = true;
    if (ZOOM) { if (!CUR.desks.has(ZOOM.id) || hiddenNow()) closeZoom(); else placeZoom(); }
    return lay;
  }

  /* FR-070: the second frame of a pose over the first; it moves only once decoded, so nothing pops; FR-065: a failed one leaves the first frame still */
  function second(art, key, id, rect, file, cls, m) {
    const prev = art._k.get(key), on = !!prev && prev._file === file && prev._ok;
    const b = el(art, key, 'img', cls + (on ? ' m-b' : '') + (OFF.has(id) ? ' ro-off' : ''));
    box(b, rect); b.dataset.for = id; setVar(b, '--ro-per', m.period + 's');
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
      s.fit = fit; setVar(box2, '--ro-sf', f.font + 'px'); setVar(box2, '--ro-sl', f.lh + 'px'); setVar(box2, '--ro-sh', f.whole + 'px');
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
    const shown = data.lines.slice(-f.rows), older = f.bars ? data.lines.slice(0, -f.rows).slice(-f.bars) : [];
    /* FR-032: older lines as bars, each as long as its line and coloured by its kind */
    while (s.bars.childElementCount > older.length) s.bars.lastChild.remove();
    while (s.bars.childElementCount < older.length) s.bars.appendChild(document.createElement('i'));
    older.forEach((l, i) => { const b = s.bars.children[i], w = Math.min(96, 18 + Array.from(l.t).length * 1.4).toFixed(0) + '%'; if (b.style.width !== w) b.style.width = w; if (b.dataset.k !== l.k) b.dataset.k = l.k; });
    const added = fillRows(s.rows, shown);
    /* FR-033: the new line slides in, three steps, transform only; the text is already right, so a dropped frame costs nothing */
    if (added && s.painted && moving() && !s.away) s.lines.animate([{ transform: 'translateY(' + Math.min(added, 2) * f.lh + 'px)' }, { transform: 'none' }], { duration: 180, easing: 'steps(3, end)' });
    if (data.caret && !s.caret) { s.caret = document.createElement('i'); s.caret.className = 'ro-caret'; s.box.appendChild(s.caret); const m = L.personMotion(id, 'typeA', d.state); setVar(s.caret, '--ro-per', m.period + 's'); if (moving()) clock(s.caret, m.offset); }
    else if (!data.caret && s.caret) { s.caret.remove(); s.caret = null; }
    s.painted = true;
    if (ZOOM && ZOOM.id === id) fillZoom();
  }

  /* FR-074: a window hidden or back; FR-181: desks scrolled away stand still and do not paint, and catch up once when they are back */
  function resume() {
    if (!CUR) return;
    const h = hiddenNow(); CUR.ro.classList.toggle('paused', h);
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
     place); when two would touch (a crowd, long names, a neighbour place), the later one moves a little right (up to 28 px) or up a
     level while it stays inside the band, else shows initials, which move right until they touch nobody; measured once per render,
     left to right, so no two chips ever overlap */
  function stagger(chrome) {
    const chips = [...chrome.querySelectorAll(':scope > .ro-chip')].sort((a, b) => parseFloat(a.dataset.x || a.style.left) - parseFloat(b.dataset.x || b.style.left));
    /* the place plates are there first: a chip never covers one */
    const placed = [...chrome.querySelectorAll(':scope > .ro-lplate')].map((e) => [e.offsetLeft, e.offsetLeft + e.offsetWidth, e.offsetTop, e.offsetTop + e.offsetHeight]);
    for (const c of chips) {
      const base = parseFloat(c.dataset.y || c.style.top) || 0, x0 = parseFloat(c.dataset.x || c.style.left) || 0;
      c.style.left = px(x0); c.style.top = px(base); if (c.dataset.full) { text(c.querySelector('.ro-cn'), c.dataset.full); delete c.dataset.full; }
      const h = c.offsetHeight || 17;
      const hits = (L0, R0, t) => placed.filter(([a, b, y0, y1]) => a < R0 + 2 && L0 < b + 2 && y0 < t + h && t < y1);
      /* the least move to the right at level top `t` that touches nobody */
      const shift = (l, r, t) => { let dx = 0; for (let i = 0; i < 20; i++) { const hit = hits(l + dx, r + dx, t); if (!hit.length) return dx; dx = Math.max(...hit.map(([, b]) => b)) + 3 - l; } return Infinity; };
      const put = (l, w, t, dx) => { placed.push([l + dx, l + dx + w, t, t + h]); c.style.top = px(t); c.style.left = px(x0 + dx); };
      let done = false;
      for (let tries = 0; tries < 2 && !done; tries++) {
        if (tries) { const n = c.querySelector('.ro-cn'); c.dataset.full = n.textContent; text(n, initials(c.dataset.name || '')); }
        const w = c.offsetWidth, l = x0 - w / 2, limit = tries ? 40 : 28;
        for (let k = 0; k < 3 && !done; k++) {
          const t = base - 18 * k;
          if (t < 0 && k > 0) break;
          const dx = shift(l, l + w, t);
          if (dx <= limit) { put(l, w, t, dx); done = true; }
        }
      }
      /* a crowd with no room left: the initials move right until they touch nobody (never over another chip) */
      if (!done) { const w = c.offsetWidth, l = x0 - w / 2; put(l, w, base, shift(l, l + w, base)); }
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
  root.DurbarRealOffice = { render, reset, feed, resume, bad: () => [...BAD] };
})(typeof self !== 'undefined' ? self : this);
