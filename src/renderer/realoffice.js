/* Real office mode (spec 097 phase P1): the second renderer of the office. app.js builds a plain model from the same state as the flat
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
  /* an element that leaves is also unobserved (the resize observer of the chrome layer, settle), so the observed set cannot grow all day */
  function sweep(layer) { for (const [k, e] of layer._k) if (!layer._seen.has(k)) { if (layer._obs && layer._obs.delete(e)) layer._ro.unobserve(e); e.remove(); layer._k.delete(k); } }
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
    if (!ro) { stage.textContent = ''; ro = document.createElement('div'); ro.className = 'ro'; stage.appendChild(ro); ro.addEventListener('click', forward); }
    ro.style.width = px(lay.width); ro.style.height = px(lay.height);
    ro.dataset.set = set; ro.dataset.u = String(Math.round(lay.u)); ro.dataset.face = String(Math.round(lay.faceH * 10) / 10); ro.dataset.big = lay.big ? '1' : '0';
    ro.classList.toggle('still', !!opts.still);
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
        /* the person (FR-036 first frame; P2 adds the second frame and motion), behind the desk; FR-065: the initials disc when the picture failed */
        if (d.person) {
          const pe = el(art, 'p:' + k, 'img', 'ro-person'); box(pe, d.person); pe.dataset.for = k; pe.dataset.pose = d.person.pose; img(pe, d.person.file);
        } else if (!d.narrow) {
          const ini = el(art, 'i:' + k, 'div', 'ro-initials'); const r = 0.5 * lay.u; box(ini, { x: d.slot.x + 0.05 * d.slot.w + 0.42 * lay.u - r / 2, y: d.desk.y - r - 6, w: r, h: r }); ini.dataset.for = k; text(ini, initials(a.name));
        }
        const dc = el(art, 'd:' + k, 'div', 'ro-desk' + (d.narrow ? ' narrow' : '')); box(dc, d.desk); dc.dataset.for = k;
        const dk = dc.firstChild || dc.appendChild(document.createElement('img')); dk.style.height = px(d.desk.full); img(dk, 'desk.webp');
        /* the monitor: P1 shows the status on the glass (decorative line bars; live, masked text is phase P2, FR-030..FR-035) */
        const sc = el(art, 'm:' + k, 'div', 'ro-screen st-' + d.state + (lt.glow === 'off' ? ' off' : '')); box(sc, d.screen); sc.dataset.for = k;
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
          const im = el(art, 'v:' + v.id, 'img', 'ro-visitor'); box(im, v.fig); im.dataset.for = v.id; im.dataset.pose = v.fig.pose; im.dataset.feet = String(Math.round(v.fig.feetY * 10) / 10); img(im, v.fig.file);
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
    [art, amb, lights, chrome].forEach(sweep);
    fitPlates(chrome, lay.width);
    stagger(chrome, lay.width);
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
  root.DurbarRealOffice = { render, reset, bad: () => [...BAD], resolve }; /* resolve: for the driver's deterministic check */
})(typeof self !== 'undefined' ? self : this);
