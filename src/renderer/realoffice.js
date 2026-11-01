/* Real office mode (spec 097 phase P1): the second renderer of the office. app.js builds a plain model from the same state as the flat
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
  const TICKS = new Map(); /* desk id -> time the green tick started */
  let PEOPLE = null; /* session id -> person id, durbar.realpeople (Office people) or durbar.realpeople.<set> */
  let SET_SHOWN = '';
  const peopleKey = () => SET_SHOWN === 'office' || !SET_SHOWN ? 'durbar.realpeople' : 'durbar.realpeople.' + SET_SHOWN;
  let onArt = null;
  /* spec 097 FR-127: a lobby visit keeps the desk's size; the away width applies at the next real layout change (a different set of
     agents, their asleep state, a resize, a world or set change): then every agent that is away at that moment narrows */
  let EMPTY_BOX = null, SLIP_RO = null, SHAPE = '', NARROWED = new Set();
  /* spec 097 FR-126: desk <-> lobby: who left or arrived (id -> {at, place}); the pair lasts 300 ms, nothing under reduced motion */
  let WALK_MS = 300; let AWAY_PREV = new Map(); const WALKS = new Map(), VPOS = new Map();

  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const px = (n) => Math.round(n * 10) / 10 + 'px';
  const box = (el, r) => { el.style.left = px(r.x); el.style.top = px(r.y); if (r.w != null) el.style.width = px(r.w); if (r.h != null) el.style.height = px(r.h); };
  const byIdIn = (model, id) => model.folders.some((f) => f.agents.some((a) => a.id === id));
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
  /* FR-126: a person that goes (desk -> lobby or back) fades out where it stood in 150 ms (opacity only) instead of vanishing; a still scene or a hidden page removes it at once */
  let STILL = false;
  function sweep(layer) {
    for (const [k, e] of layer._k) if (!layer._seen.has(k)) {
      layer._k.delete(k);
      if (!STILL && layer._ready && e.classList && (e.classList.contains('ro-person') || e.classList.contains('ro-visitor')) && !document.hidden && !(e.complete && !e.naturalWidth)) { /* a picture that failed to load is never kept to fade (FR-065) */ e.classList.add('ro-gone'); e.style.pointerEvents = 'none'; setTimeout(() => e.remove(), 170); } else e.remove();
    }
    layer._ready = true;
  }
  /* an element that did not exist at the last render (FR-126: arrives with a fade-in, after the first draw only) */
  const born = (layer, key) => !!layer._ready && !layer._k.has(key);
  function text(e, t) { t = String(t == null ? '' : t); if (e.textContent !== t) e.textContent = t; }
  function attr(e, k, v) { if (v == null || v === false) { if (e.hasAttribute(k)) e.removeAttribute(k); } else if (e.getAttribute(k) !== String(v)) e.setAttribute(k, String(v)); }
  function img(e, file, set) {
    const src = (set ? SD : WD) + file;
    if (e.getAttribute('src') !== src) {
      e.alt = ''; e.decoding = 'async'; e.draggable = false; e.setAttribute('aria-hidden', 'true');
      e.onerror = () => { if (!BAD.has(src)) { BAD.add(src); if (onArt) onArt(); } };
      e.src = src;
    }
  }
  /* a span with a status dot (the app's .dot classes, forced-colours aware) */
  function dotHTML(state) { return '<span class="dot ' + ({ limit: 'waiting', asleep: 'idle' }[state] || state) + '" aria-hidden="true"></span>'; }

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
   * state,word,task,label,tip,selected,away,awayLabel,helpers:[state]}]}], places:[{id,label,custom,post,title,go,visitors:[{id,name,
   * needsYou,title}]}]}; `view`: {w,h}; `opts`: {still, world, set, rand, remember, onArt}. Returns the layout (for the app's checks).
   */
  function render(stage, model, view, opts) {
    const L = X();
    const world = has(root.DurbarRealOfficeWorlds || {}, opts.world || 'photo') ? opts.world || 'photo' : 'photo', set = has(root.DurbarRealOfficeSets || {}, opts.set || 'office') ? opts.set || 'office' : 'office';
    WD = 'realoffice/worlds/' + world + '/'; SD = 'realoffice/sets/' + set + '/';
    if (SET_SHOWN !== set) { SET_SHOWN = set; PEOPLE = null; SEEN.clear(); TICKS.clear(); } /* the people belong to a set: switching sets draws its own, kept apart */
    const meta = Object.assign({}, root.DurbarRealOfficeWorlds[world], root.DurbarRealOfficeSets[set]); /* the world's furniture numbers with the set's people numbers */
    onArt = opts.onArt || null;
    const ids = Object.keys(meta.seat).sort();
    const who = people(model, ids, opts.rand, !!opts.remember);
    const seatOk = (p) => !!p && !['typeA', 'think', 'waveA', 'rest'].some((f) => BAD.has(SD + p + '-' + f + '.webp'));
    const shape = JSON.stringify([view.w, view.h, world, set, model.folders.map((f) => [f.id, f.agents.map((a) => [a.id, a.state === 'asleep'])]), model.places.map((p) => p.id)]);
    if (shape !== SHAPE) { SHAPE = shape; NARROWED = new Set(model.folders.flatMap((f) => f.agents.filter((a) => a.away).map((a) => a.id))); }
    const engine = {
      folders: model.folders.map((f) => ({ id: f.id, agents: f.agents.map((a) => ({ id: a.id, state: a.state, away: a.away || null, keep: !!a.away && !NARROWED.has(a.id), person: seatOk(who[a.id]) ? who[a.id] : null })) })),
      places: model.places.map((p) => ({ id: p.id, custom: !!p.custom, visitors: p.visitors.map((v) => ({ id: v.id, needsYou: !!v.needsYou, person: who[v.id] || null })) })),
    };
    const signs = {};
    for (const f of model.folders) signs[f.id] = { name: f.name, path: f.path, counts: f.counts.length + (f.cost ? 1 : 0) };
    const lay = L.realLayout(engine, view, meta, signs);

    let ro = stage.querySelector(':scope > .ro');
    if (!ro) { stage.textContent = ''; ro = document.createElement('div'); ro.className = 'ro'; stage.appendChild(ro); ro.addEventListener('click', forward); }
    ro.style.width = px(lay.width); ro.style.height = px(lay.height);
    ro.dataset.set = set; ro.dataset.world = world; ro.dataset.u = String(Math.round(lay.u)); ro.dataset.face = String(Math.round(lay.faceH * 10) / 10); ro.dataset.big = lay.big ? '1' : '0';
    ro.classList.toggle('still', !!opts.still);
    STILL = !!opts.still;
    /* z-order (plan: art < lights < chrome): floor and fixtures, people and desks; the ambient and the lights; then signs, plates, chips */
    const art = layerOf(ro, 'ro-art'), amb = layerOf(ro, 'ro-amb'), lights = layerOf(ro, 'ro-lights'), chrome = layerOf(ro, 'ro-chrome');
    const lobby = el(art, 'lobby', 'div', 'ro-lobby'); box(lobby, { x: 0, y: 0, w: lay.width, h: lay.lobbyH });
    const strip = el(art, 'strip', 'div', 'ro-strip'); box(strip, lay.floorStrip);
    /* FR-043: the room ambient: the share of active desks among the visible ones */
    const states = model.empty ? ['idle'] : lay.zones.flatMap((z) => z.desks.map((d) => d.state)); /* FR-119: an empty floor is lit at 70 % (FR-043) */
    const ambient = L.ambientFor(states);
    ro.style.setProperty('--ro-amb', String(Math.round((1 - ambient) * 1000) / 1000));
    ro.dataset.ambient = String(ambient);
    const ambEl = el(amb, 'amb', 'div', 'ro-ambient'); box(ambEl, { x: 0, y: 0, w: lay.width, h: lay.height });

    /* FR-126: who left for a place or came back since the last render (never on the first draw, never under reduced motion) */
    const awayNow = new Map(model.folders.flatMap((f) => f.agents.filter((a) => a.away).map((a) => [a.id, a.awayLabel])));
    const now0 = Date.now();
    for (const [id, t] of WALKS) if (now0 - t.at >= WALK_MS) WALKS.delete(id);
    if (ro._drawn && !opts.still) {
      for (const [id, label] of awayNow) if (!AWAY_PREV.has(id)) WALKS.set(id, { at: now0, dir: 'out', place: label });
      for (const id of AWAY_PREV.keys()) if (!awayNow.has(id) && byIdIn(model, id)) WALKS.set(id, { at: now0, dir: 'back', place: '' });
      if (WALKS.size) setTimeout(() => { if (onArt) onArt(); }, WALK_MS + 30); /* redraw when the pair is over */
    } else WALKS.clear();
    AWAY_PREV = new Map(awayNow);
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
        /* the person (FR-036 first frame; P2 adds the second frame and motion), behind the desk; FR-065: the initials disc when the picture failed */
        if (d.person) {
          const nb = born(art, 'p:' + k) && !STILL;
          const pe = el(art, 'p:' + k, 'img', 'ro-person' + (a.asleep ? ' asleep' : '') + (nb ? ' ro-in' : '')); box(pe, d.person); pe.dataset.for = k; pe.dataset.pose = d.person.pose; img(pe, d.person.file, true);
        } else if (!d.narrow && !a.away) {
          const ini = el(art, 'i:' + k, 'div', 'ro-initials'); const r = 0.5 * lay.u; box(ini, { x: d.slot.x + 0.05 * d.slot.w + 0.42 * lay.u - r / 2, y: d.desk.y - r - 6, w: r, h: r }); ini.dataset.for = k; text(ini, initials(a.name));
        }
        const dc = el(art, 'd:' + k, 'div', 'ro-desk' + (d.narrow ? ' narrow' : '') + (a.asleep ? ' asleep' : '')); box(dc, d.desk); dc.dataset.for = k;
        const dk = dc.firstChild || dc.appendChild(document.createElement('img')); dk.style.height = px(d.desk.full); img(dk, 'desk.webp');
        /* the monitor: P1 shows the status on the glass (decorative line bars; live, masked text is phase P2, FR-030..FR-035) */
        const sc = el(art, 'm:' + k, 'div', 'ro-screen st-' + d.state + (lt.glow === 'off' ? ' off' : '') + (a.asleep ? ' asleep' : '')); box(sc, d.screen); sc.dataset.for = k;
        if (!sc.firstChild) sc.innerHTML = '<div class="ro-bezel"><div class="ro-glass"></div></div><div class="ro-neck"></div><div class="ro-foot"></div>';
        const bez = sc.firstChild; bez.style.height = px(d.glass.h + 6);
        const nb = Math.max(2, Math.min(24, Math.floor((d.glass.h - 10) / 7))), gl = bez.firstChild; /* decorative line bars as many as the glass holds (aria-hidden) */
        if (gl.childElementCount !== nb) { gl.setAttribute('aria-hidden', 'true'); gl.textContent = ''; for (let i = 0; i < nb; i++) { const b = document.createElement('i'); b.style.width = (22 + ((i * 37 + k.length * 13) % 60)) + '%'; gl.appendChild(b); } }
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
        const walk = WALKS.get(k);
        if (d.away && !(walk && walk.dir === 'out')) { const w = el(chrome, 'a:' + k, 'div', 'ro-away'); box(w, d.away); text(w, 'at ' + a.awayLabel + ' \u2191'); }
        /* FR-123: the tent card of a coffee break stands on the empty desk (aria-hidden; the plate and the chip say it too) */
        if (a.tent && d.away && !(walk && walk.dir === 'out')) { const t = el(chrome, 'tn:' + k, 'div', 'ro-tent'); t.dataset.surface = 'coffee-bar'; box(t, { x: d.slot.x + d.slot.w / 2, y: d.plate.y - 21 }); attr(t, 'aria-hidden', 'true'); text(t, a.tent); }
        /* FR-120: a static "z z" over a sleeping person (carved in the cave); aria-hidden, the plate and the name carry the meaning */
        if (a.asleep && d.person) { const z = el(chrome, 'z:' + k, 'div', 'ro-zz'); box(z, { x: d.person.x + d.person.w * 0.62, y: Math.max(d.slot.y + 2, d.person.y + d.person.h * 0.04) }); attr(z, 'aria-hidden', 'true'); text(z, 'z z'); }
        /* FR-016, FR-090: the name plate is the desk's one focusable button; the app's click handler opens the chat ([data-id]) */
        const pl = el(chrome, 'n:' + k, 'button', 'ro-plate st-' + d.state + (a.selected ? ' sel' : '') + (d.narrow ? ' narrow' : '') + (a.asleep ? ' asleep' : '')); box(pl, d.plate);
        pl.type = 'button'; pl.dataset.id = k; pl.dataset.state = d.state; if (a.asleep) pl.dataset.surface = 'lounge'; /* spec 098 FR-010: the moment's marker */
        attr(pl, 'aria-pressed', a.selected ? 'true' : 'false'); attr(pl, 'aria-label', a.label); attr(pl, 'title', a.tip);
        const goes = walk && walk.dir === 'out' ? '\u2192 ' + walk.place : '';
        const psig = JSON.stringify([a.name, a.role, a.word, a.task, a.helpers, d.state, goes]);
        if (pl._sig !== psig) {
          pl._sig = psig; pl.textContent = '';
          const l1 = document.createElement('span'); l1.className = 'ro-l1';
          const nm = document.createElement('b'); nm.textContent = a.name; l1.appendChild(nm);
          const rl = document.createElement('span'); rl.className = 'ro-role'; rl.textContent = a.role; l1.appendChild(rl);
          if (a.helpers.length) { const h = document.createElement('span'); h.className = 'ro-help'; h.textContent = '+' + a.helpers.length + ' '; a.helpers.slice(0, 3).forEach((s) => h.insertAdjacentHTML('beforeend', dotHTML(s))); l1.appendChild(h); }
          const l2 = document.createElement('span'); l2.className = 'ro-l2';
          l2.insertAdjacentHTML('beforeend', dotHTML(d.state));
          l2.appendChild(document.createTextNode(' ' + (goes || a.word + (a.task ? ' · ' + a.task : ''))));
          pl.appendChild(l1); pl.appendChild(l2);
        }
      }
    }
    /* the lobby band: fixtures, their lights, visitors and chips, place plates (FR-023..FR-027, FR-045) */
    const byPlace = new Map(model.places.map((p) => [p.id, p]));
    for (const fx of lay.fixtures) {
      const p = byPlace.get(fx.id), file = 'fx-' + fx.id + '.webp';
      if (fx.art && !fx.custom && !BAD.has(WD + file)) { const im = el(art, 'f:' + fx.id, 'img', 'ro-fx'); box(im, fx.art); img(im, file); }
      else if (fx.art && fx.custom) { const ki = el(art, 'f:' + fx.id, 'div', 'ro-kiosk'); box(ki, { x: fx.art.x + fx.art.w * 0.2, y: fx.art.y + fx.art.h * 0.35, w: fx.art.w * 0.6, h: fx.art.h * 0.65 }); if (ki._ic !== p.icon) { ki._ic = p.icon; ki.innerHTML = p.icon || ''; } }
      const fl = L.fixtureLight(fx.id, p.visitors.length, p.visitors.some((v) => v.needsYou));
      if (fl && fx.art) { const li = el(lights, 'fl:' + fx.id, 'div', 'ro-fxl fxl-' + fl + (fx.id === 'boss' ? ' boss' : '')); box(li, fx.light); }
      for (const v of fx.visitors) {
        const ag = p.visitors.find((x) => x.id === v.id);
        if (v.fig && !BAD.has(SD + v.fig.file)) {
          /* owner 2026-10-31 10:19 and 10:48: the feet on the front floor plane (layout), with a soft contact shadow under them */
          const sh = el(art, 'vs:' + v.id, 'div', 'ro-shadow'); box(sh, v.shadow);
          const nbv = born(art, 'v:' + v.id) && !STILL;
          const im = el(art, 'v:' + v.id, 'img', 'ro-visitor' + (nbv ? ' ro-in' : '')); box(im, v.fig); im.dataset.for = v.id; im.dataset.pose = v.fig.pose; im.dataset.feet = String(Math.round(v.fig.feetY * 10) / 10); img(im, v.fig.file, true);
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
    /* FR-126: the dotted trail between the desk and the place, drawn for the 300 ms of the pair only (an SVG path with a dash pattern fading in then out) */
    const deskAt = new Map(lay.zones.flatMap((z) => z.desks.map((d) => [d.id, { x: d.slot.x + d.slot.w / 2, y: d.desk.y }])));
    const figAt = new Map(lay.fixtures.flatMap((fx) => fx.visitors.filter((v) => v.fig).map((v) => [v.id, { x: v.fig.x + v.fig.w / 2, y: v.fig.feetY != null ? v.fig.feetY : v.fig.y + v.fig.h }])));
    for (const [id, w] of WALKS) {
      const a = figAt.get(id) || VPOS.get(id), b = deskAt.get(id);
      if (!a || !b) continue;
      const tr = el(chrome, 'tr:' + id, 'div', 'ro-trail ' + w.dir); box(tr, { x: 0, y: 0, w: lay.width, h: lay.height }); tr.dataset.surface = 'walk';
      const sig = [a.x, a.y, b.x, b.y, lay.width, lay.height].map(Math.round).join();
      if (tr._sig !== sig) { tr._sig = sig; tr.innerHTML = '<svg width="' + Math.round(lay.width) + '" height="' + Math.round(lay.height) + '" aria-hidden="true" focusable="false"><path d="M' + Math.round(b.x) + ' ' + Math.round(b.y) + ' Q' + Math.round((a.x + b.x) / 2) + ' ' + Math.round(Math.min(a.y, b.y) - 18) + ' ' + Math.round(a.x) + ' ' + Math.round(a.y) + '"/></svg>'; }
      attr(tr, 'aria-hidden', 'true');
    }
    VPOS.clear(); for (const [id, p] of figAt) VPOS.set(id, p);
    drawSlips(chrome, lay, model.slips);
    ro._drawn = true;
    [art, amb, lights, chrome].forEach(sweep);
    fitPlates(chrome, lay.width);
    stagger(chrome, lay.width);
    settle(chrome, lay.width);
    return lay;
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
    const P = root.exports && root.exports.placeBox;
    const want = [];
    if (slips && slips.queue) want.push('queue');
    if (slips && slips.limit) want.push('limit');
    for (const e of (slips && slips.elicit) || []) want.push('elicit:' + e.id);
    if (!want.length || !P) return;
    const avoid = [];
    for (const z of lay.zones) {
      avoid.push({ x: z.sign.x, y: z.sign.y, w: z.sign.w, h: z.sign.h });
      for (const d of z.desks) {
        avoid.push(d.plate);
        if (d.face) avoid.push(d.face); /* who needs you is read from the faces: a slip never covers one */
        if (d.away) avoid.push({ x: d.away.x - 80, y: d.away.y - 1, w: 160, h: 21 }); /* the chair label, \"at Software library\" at its longest */
        if (d.bubble) avoid.push({ x: d.bubble.x, y: d.bubble.y - 24, w: 24, h: 24 });
        if (d.bang) avoid.push({ x: d.bang.x, y: d.bang.y, w: 20, h: 20 });
      }
    }
    if (EMPTY_BOX) avoid.push(EMPTY_BOX);
    const bounds = { x: 4, y: lay.lobbyH + 4, w: lay.width - 8, h: lay.height - lay.lobbyH - 8 };
    const door = (id) => { const f = lay.fixtures.find((x) => x.id === id); return f ? { x: f.slot.x + f.slot.w / 2, y: lay.lobbyH } : { x: lay.width / 2, y: lay.lobbyH }; };
    const hits = (r) => avoid.some((q) => r.x < q.x + q.w && q.x < r.x + r.w && r.y < q.y + q.h && q.y < r.y + r.h);
    const put = (key, cls, build, anchor, variants, surface) => {
      const e = el(chrome, key, 'div', cls); e.dataset.surface = surface;
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
        e.hidden = false;
        if (e._at && e._v === v) { e.style.left = px(e._at.x); e.style.top = px(e._at.y); }
        else { e.style.left = '0px'; e.style.top = '0px'; }
        e.style.width = ''; e.style.height = '';
        const size = () => ({ w: Math.ceil(e.offsetWidth) + 2, h: Math.ceil(e.offsetHeight) + 2 });
        let r = size();
        if (e._at && e._v === v && e._at.w >= r.w && e._at.h >= r.h && !hits({ x: e._at.x, y: e._at.y, w: r.w, h: r.h }) && e._at.x + r.w <= bounds.x + bounds.w && e._at.y + r.h <= bounds.y + bounds.h) { avoid.push({ x: e._at.x, y: e._at.y, w: r.w, h: r.h }); e.dataset.variant = v; return true; }
        for (let pass = 0; pass < 2; pass++) { /* the second pass re-places with the box it really has (a late font can widen the text) */
          const at = P(r, avoid, bounds, anchor);
          if (!at) break;
          e.style.left = px(at.x); e.style.top = px(at.y);
          const r2 = size();
          if (r2.w <= r.w && r2.h <= r.h) { e._at = at; e._v = v; e.dataset.variant = v; avoid.push(at); return true; }
          r = r2;
        }
      }
      e.hidden = true; e._at = null; e._v = null; e.dataset.variant = 'none'; return false;
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
          for (const a of f.actions) row.appendChild(btn(a.label, a.title, a.cls, a.k === 'open' ? { slipact: 'open', slipid: f.id } : { slipact: 'perm', slipid: f.id, slipidx: a.idx }));
          row.appendChild(btn('Show in chat', 'Open the chat', 'link', { slipact: 'open', slipid: f.id }));
          e.appendChild(row);
          for (const g of Q.folded) { const b = btn(g.text, '', 'sl-fold', { slipact: 'open', slipid: g.id }); e.appendChild(b); }
          if (Q.more > 0) e.appendChild(btn('+' + Q.more + ' more \u00B7 Open the inbox', '', 'sl-more', { slipact: 'inbox' }));
        },
      }, door('boss'), ['full', 'pill'], 'inbox');
    }
    if (slips.limit) {
      const L = slips.limit;
      put('slip:limit', 'ro-slip ro-limit', {
        sig: [L.id, L.name, L.who, L.text, L.actions, L.input && [L.input.label, L.input.min, L.input.step, L.input.value]],
        fill: (e, v) => {
          e.setAttribute('role', 'group'); e.setAttribute('aria-label', 'Spending limit reached');
          if (v === 'pill') { e.appendChild(btn(L.name + ': Spending limit reached \u00B7 Show in chat', 'Open the chat', 'ro-pill', { slipact: 'open', slipid: L.id })); return; }
          e.appendChild(p('sl-h', L.who)); e.appendChild(p('sl-t', L.text));
          const row = document.createElement('div'); row.className = 'sl-act';
          if (L.input) { const i = document.createElement('input'); i.type = 'number'; i.className = 'limit-amt'; i.min = L.input.min; i.step = L.input.step; i.value = L.input.value; i.setAttribute('aria-label', L.input.label); row.appendChild(i); }
          for (const a of L.actions) row.appendChild(btn(a.label, a.title, a.cls, { slipact: 'limit', slipid: L.id, slipidx: a.idx }));
          row.appendChild(btn('Show in chat', 'Open the chat', 'link', { slipact: 'open', slipid: L.id }));
          e.appendChild(row);
        },
      }, door('bank'), ['full', 'pill'], 'limit-card');
    }
    for (const B of slips.elicit || []) {
      const d = lay.zones.flatMap((z) => z.desks).find((x) => x.id === B.id);
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
    for (const e of chrome.querySelectorAll(':scope > .ro-chip, :scope > .ro-lplate')) chrome._ro.observe(e, { box: 'border-box' });
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
    const chips = [...chrome.querySelectorAll(':scope > .ro-chip')].sort((a, b) => parseFloat(a.dataset.x || a.style.left) - parseFloat(b.dataset.x || b.style.left));
    /* the place plates are there first: a chip never covers one */
    const cr = chrome.getBoundingClientRect(); /* fractional boxes: a rounded offsetLeft hides half a pixel of overlap */
    const placed = [...chrome.querySelectorAll(':scope > .ro-lplate')].map((e) => { const r = e.getBoundingClientRect(); return [r.left - cr.left, r.right - cr.left, r.top - cr.top, r.bottom - cr.top]; });
    const band = W || chrome.clientWidth || 1e9;
    for (const c of chips) {
      const base = parseFloat(c.dataset.y || c.style.top) || 0, x0 = parseFloat(c.dataset.x || c.style.left) || 0;
      c.style.left = px(x0); c.style.top = px(base); if (c.dataset.full) { text(c.querySelector('.ro-cn'), c.dataset.full); delete c.dataset.full; }
      const h = c.getBoundingClientRect().height || 17;
      const hitList = (L0, R0, t) => placed.filter(([a, b, y0, y1]) => a < R0 + 1.5 && L0 < b + 1.5 && y0 < t + h && t < y1);
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
      let pick = best();
      /* no free spot for the whole name: a shorter name (first letters and "…") before bare initials */
      const nm = c.dataset.name || '', n = c.querySelector('.ro-cn'), g = Array.from(nm);
      for (const v of [g.length > 7 ? g.slice(0, 6).join('') + '\u2026' : '', g.length > 5 ? g.slice(0, 4).join('') + '\u2026' : '', initials(nm)]) {
        if (pick || !v) continue;
        c.dataset.full = nm; text(n, v); pick = best();
      }
      if (!pick) { const w = c.getBoundingClientRect().width, l = x0 - w / 2; let dx = 0; for (let i = 0; i < 40; i++) { const hl = hitList(l + dx, l + dx + w, base); if (!hl.length) break; dx = Math.max(...hl.map(([, b]) => b)) + 2 - l; } pick = { t: base, dx, l, w }; }
      placed.push([pick.l + pick.dx, pick.l + pick.dx + pick.w, pick.t, pick.t + h]);
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
  root.DurbarRealOffice = { render, reset, bad: () => [...BAD], resolve, walks: () => [...WALKS.keys()], walkInfo: () => JSON.stringify([...WALKS]), walkMs: (n) => { WALK_MS = n > 0 ? n : 300; } }; /* walks: the desks in a leave/arrive pair now (the driver's) */ /* resolve: for the driver's deterministic check */
})(typeof self !== 'undefined' ? self : this);
