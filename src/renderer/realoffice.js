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
  /* FR-184: nothing rewrites what did not change: a style or dataset value is written only when it differs */
  const sty = (e, k, v) => { if (e.style[k] !== v) e.style[k] = v; };
  const dset = (e, k, v) => { if (e.dataset[k] !== v) e.dataset[k] = v; };
  const box = (el, r) => { sty(el, 'left', px(r.x)); sty(el, 'top', px(r.y)); if (r.w != null) sty(el, 'width', px(r.w)); if (r.h != null) sty(el, 'height', px(r.h)); };
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
  function sweep(layer) { for (const [k, e] of layer._k) if (!layer._seen.has(k)) { e.remove(); layer._k.delete(k); } }
  function text(e, t) { t = String(t == null ? '' : t); if (e.textContent !== t) e.textContent = t; }
  function attr(e, k, v) { if (v == null || v === false) { if (e.hasAttribute(k)) e.removeAttribute(k); } else if (e.getAttribute(k) !== String(v)) e.setAttribute(k, String(v)); }
  function img(e, file) {
    const src = ART + file;
    if (e.getAttribute('src') !== src) {
      if (e.getAttribute('aria-hidden') !== 'true') { e.alt = ''; e.decoding = 'async'; e.draggable = false; e.setAttribute('aria-hidden', 'true'); }
      e.onerror = () => { if (!BAD.has(file)) { BAD.add(file); if (onArt) onArt(); } };
      e.src = src;
    }
  }
  /* a span with a status dot (the app's .dot classes, forced-colours aware) */
  const dotClass = (state) => 'dot ' + ({ limit: 'waiting', asleep: 'idle' }[state] || state);
  function dotHTML(state) { return '<span class="' + dotClass(state) + '" aria-hidden="true"></span>'; }

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
    sty(ro, 'width', px(lay.width)); sty(ro, 'height', px(lay.height));
    dset(ro, 'set', set); dset(ro, 'u', String(Math.round(lay.u))); dset(ro, 'face', String(Math.round(lay.faceH * 10) / 10)); dset(ro, 'big', lay.big ? '1' : '0');
    ro.classList.toggle('still', !!opts.still);
    /* z-order (plan: art < lights < chrome): floor and fixtures, people and desks; the ambient and the lights; then signs, plates, chips */
    const art = layerOf(ro, 'ro-art'), amb = layerOf(ro, 'ro-amb'), lights = layerOf(ro, 'ro-lights'), chrome = layerOf(ro, 'ro-chrome');
    const lobby = el(art, 'lobby', 'div', 'ro-lobby'); box(lobby, { x: 0, y: 0, w: lay.width, h: lay.lobbyH });
    const strip = el(art, 'strip', 'div', 'ro-strip'); box(strip, lay.floorStrip);
    /* FR-043: the room ambient: the share of active desks among the visible ones */
    const states = lay.zones.flatMap((z) => z.desks.map((d) => d.state));
    const ambient = L.ambientFor(states);
    const ambV = String(Math.round((1 - ambient) * 1000) / 1000);
    if (ro.style.getPropertyValue('--ro-amb') !== ambV) ro.style.setProperty('--ro-amb', ambV);
    dset(ro, 'ambient', String(ambient));
    const ambEl = el(amb, 'amb', 'div', 'ro-ambient'); box(ambEl, { x: 0, y: 0, w: lay.width, h: lay.height });

    const byFolder = new Map(model.folders.map((f) => [f.id, f]));
    const byAgent = new Map(model.folders.flatMap((f) => f.agents.map((a) => [a.id, a])));
    const now = Date.now();
    for (const z of lay.zones) {
      const f = byFolder.get(z.id);
      const zk = z.id + '\u0000' + z.part; /* a folder too big for one row has more parts, each its own zone (the sign repeats, "continued") */
      const zb = el(art, 'z:' + zk, 'div', 'ro-zone'); box(zb, z.box);
      /* FR-018: the folder sign: name, path, counts, cost, + and the room menu (the app's own handlers: data-newsess, data-foldermenu) */
      const sg = el(chrome, 's:' + zk, 'div', 'ro-sign'); box(sg, { x: z.sign.x, y: z.sign.y, h: z.sign.h }); sty(sg, 'maxWidth', px(z.sign.w));
      dset(sg, 'folder', z.id);
      signFill(sg, f, z);
      for (const d of z.desks) {
        const a = byAgent.get(d.id), k = d.id;
        const lt = L.lightFor(d.state, { still: !!opts.still });
        /* the person (FR-036 first frame; P2 adds the second frame and motion), behind the desk; FR-065: the initials disc when the picture failed */
        if (d.person) {
          const pe = el(art, 'p:' + k, 'img', 'ro-person'); box(pe, d.person); dset(pe, 'for', k); dset(pe, 'pose', d.person.pose); img(pe, d.person.file);
        } else if (!d.narrow) {
          const ini = el(art, 'i:' + k, 'div', 'ro-initials'); const r = 0.5 * lay.u; box(ini, { x: d.slot.x + 0.05 * d.slot.w + 0.42 * lay.u - r / 2, y: d.desk.y - r - 6, w: r, h: r }); dset(ini, 'for', k); text(ini, initials(a.name));
        }
        const dc = el(art, 'd:' + k, 'div', 'ro-desk' + (d.narrow ? ' narrow' : '')); box(dc, d.desk); dset(dc, 'for', k);
        const dk = dc.firstChild || dc.appendChild(document.createElement('img')); sty(dk, 'height', px(d.desk.full)); img(dk, 'desk.webp');
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
        if (call) { const c = el(lights, 'c:' + k, 'div', 'ro-call call-' + call + (lt.motion === 'pulse' ? ' pulse' : '') + (call === 'green' && !opts.still ? ' fade' : '')); box(c, { x: d.call.x, y: d.call.y, w: 10, h: 10 }); dset(c, 'for', k); }
        /* FR-038: cues, inside the slot */
        if (d.bubble) { const b = el(chrome, 'b:' + k, 'div', 'ro-bub'); box(b, d.bubble); attr(b, 'aria-hidden', 'true'); text(b, '?'); }
        if (d.bang) { const b = el(chrome, 'x:' + k, 'div', 'ro-bang'); box(b, d.bang); attr(b, 'aria-hidden', 'true'); text(b, '!'); }
        if (d.dots) { const b = el(chrome, 't:' + k, 'div', 'ro-dots'); box(b, d.dots); attr(b, 'aria-hidden', 'true'); if (!b.firstChild) b.innerHTML = '<i></i><i></i><i></i>'; }
        if (d.away) { const w = el(chrome, 'a:' + k, 'div', 'ro-away'); box(w, d.away); text(w, 'at ' + a.awayLabel + ' ↑'); }
        /* FR-016, FR-090: the name plate is the desk's one focusable button; the app's click handler opens the chat ([data-id]) */
        const pl = el(chrome, 'n:' + k, 'button', 'ro-plate st-' + d.state + (a.selected ? ' sel' : '') + (d.narrow ? ' narrow' : '')); box(pl, d.plate);
        if (pl.type !== 'button') pl.type = 'button';
        dset(pl, 'id', k); dset(pl, 'state', d.state);
        attr(pl, 'aria-pressed', a.selected ? 'true' : 'false'); attr(pl, 'aria-label', a.label); attr(pl, 'title', a.tip);
        plateFill(pl, a, d.state);
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
          const im = el(art, 'v:' + v.id, 'img', 'ro-visitor'); box(im, v.fig); dset(im, 'for', v.id); dset(im, 'pose', v.fig.pose); dset(im, 'feet', String(Math.round(v.fig.feetY * 10) / 10)); img(im, v.fig.file);
        }
        /* FR-026 "as the flat lobby": a go-place visitor (Boss, Bank, Coffee) is the flat lobby's own button (data-pvopen, and
           data-coffeeid for the coffee menu): app.js's delegated handlers open the chat; others forward to their plate (data-for) */
        const ch = el(chrome, 'vc:' + v.id, p.go ? 'button' : 'span', 'ro-chip' + (ag.needsYou ? ' wait' : '')); dset(ch, 'y', String(v.chip.y)); dset(ch, 'x', String(v.chip.x)); /* its place is stagger()'s to write */
        if (p.go) { if (ch.type !== 'button') ch.type = 'button'; dset(ch, 'pvopen', v.id); if (fx.id === 'coffee') dset(ch, 'coffeeid', v.id); attr(ch, 'aria-label', ag.title + '. Open the chat.'); } else dset(ch, 'for', v.id);
        attr(ch, 'title', ag.title); dset(ch, 'name', ag.name); chipFill(ch, ag.name, ag.needsYou, model.alertIcon);
      }
      const pl = el(chrome, 'fp:' + fx.id, p.post ? 'button' : 'div', 'ro-lplate' + (p.visitors.some((v) => v.needsYou) ? ' wait' : '')); box(pl, { x: fx.plate.x, y: fx.plate.y });
      if (p.post) { if (pl.type !== 'button') pl.type = 'button'; dset(pl, 'post', '1'); } else { attr(pl, 'role', 'group'); }
      dset(pl, 'place', fx.id); sty(pl, 'maxWidth', px(Math.max(44, fx.plate.w)));
      attr(pl, 'title', p.title); attr(pl, 'aria-label', p.title);
      /* owner 2026-10-31 09:03: no bare count when the people are visible; "+N" only for those that do not fit */
      const lsig = JSON.stringify([p.label, fx.more]);
      if (pl._sig !== lsig) { pl._sig = lsig; pl.textContent = ''; const s = document.createElement('span'); s.textContent = p.label; pl.appendChild(s); if (fx.more > 0) { const b = document.createElement('b'); b.className = 'ro-more'; b.textContent = '+' + fx.more; pl.appendChild(b); } }
    }
    [art, amb, lights, chrome].forEach(sweep);
    stagger(chrome);
    return lay;
  }

  /* FR-018, FR-184: the folder sign keeps its nodes: only the counts and the cost change on a status update, and the + and the room menu keep the focus */
  function signFill(sg, f, z) {
    const sig = JSON.stringify([f.name, f.path, !!f.cost, f.newSess, f.menu, z.part]);
    if (sg._sig !== sig) {
      sg._sig = sig; sg.textContent = ''; sg._cnt = null; sg._cost = null;
      const b = document.createElement('b'); b.textContent = z.part > 1 ? f.name + ' (continued)' : f.name; b.title = f.name + '\n' + f.path; sg.appendChild(b);
      if (z.part > 1) return;
      const p = document.createElement('span'); p.className = 'ro-path'; p.textContent = f.path; sg.appendChild(p);
      const sc = document.createElement('span'); sc.className = 'ro-sc'; sg._sc = sc; sg._cnt = new Map();
      if (f.cost) { const m = document.createElement('span'); m.className = 'ro-cost'; sc.appendChild(m); sg._cost = m; }
      if (f.newSess) { const nb = document.createElement('button'); nb.type = 'button'; nb.className = 'ro-sb'; nb.dataset.newsess = z.id; nb.title = 'New session in ' + f.name; nb.setAttribute('aria-label', 'New session in ' + f.name); nb.textContent = '+'; sc.appendChild(nb); }
      if (f.menu) { const mb = document.createElement('button'); mb.type = 'button'; mb.className = 'ro-sb'; mb.dataset.foldermenu = z.id; mb.setAttribute('aria-haspopup', 'menu'); mb.setAttribute('aria-label', 'Folder actions for ' + f.name); mb.title = 'Folder actions'; mb.textContent = '⋯'; sc.appendChild(mb); }
      sg.appendChild(sc);
    }
    if (!sg._cnt) return;
    if (sg._cost) text(sg._cost, f.cost);
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

  /* FR-016, FR-184: the plate keeps its nodes on a status change: only the text and the dot that changed are written (a helper's list is rebuilt when it changes) */
  function plateFill(pl, a, state) {
    let P = pl._parts;
    if (!P) {
      P = pl._parts = { l1: document.createElement('span'), nm: document.createElement('b'), rl: document.createElement('span'), l2: document.createElement('span'), dot: document.createElement('span'), tn: document.createTextNode(''), h: null, hs: '' };
      P.l1.className = 'ro-l1'; P.rl.className = 'ro-role'; P.l1.append(P.nm, P.rl);
      P.l2.className = 'ro-l2'; P.dot.setAttribute('aria-hidden', 'true'); P.l2.append(P.dot, P.tn);
      pl.textContent = ''; pl.append(P.l1, P.l2);
    }
    text(P.nm, a.name); text(P.rl, a.role);
    const hs = a.helpers.join();
    if (P.hs !== hs) {
      P.hs = hs; if (P.h) { P.h.remove(); P.h = null; }
      if (a.helpers.length) { P.h = document.createElement('span'); P.h.className = 'ro-help'; P.h.textContent = '+' + a.helpers.length + ' '; a.helpers.slice(0, 3).forEach((s) => P.h.insertAdjacentHTML('beforeend', dotHTML(s))); P.l1.appendChild(P.h); }
    }
    const dc = dotClass(state), line = ' ' + a.word + (a.task ? ' · ' + a.task : '');
    if (P.dot.className !== dc) P.dot.className = dc;
    if (P.tn.data !== line) P.tn.data = line;
  }

  /* a chip is [alert icon] + name; the icon is the app's own Alert sign (app.js signIcon, built from trusted markup, not the model's
     text; constitution V: no emoji), the name goes in with textContent. `label` is the name; a crowded chip shows initials, stagger()
     keeps the full name in data-full, and a render does not write the name back only for stagger() to cut it again (FR-184). */
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

  /* the width of a text in a chip's font, without touching the chip (no write, no layout): what its initials will take */
  let PEN = null;
  function textWidth(font, t) { if (!PEN) PEN = document.createElement('canvas').getContext('2d'); if (PEN.font !== font) PEN.font = font; return PEN.measureText(t).width; }

  /* visitors' name chips stand above their heads (owner 2026-10-31 10:48: never over the feet or legs; the layout gives each its
     place); when two would touch (a crowd, long names, a neighbour place), the later one moves a little right (up to 28 px) or up a
     level while it stays inside the band, else shows initials, which move right until they touch nobody (staggerPlan), so no two chips
     ever overlap. FR-184: only a chip or plate that changed is measured, all reads before the writes, and nothing is written or read
     at all when no chip or plate changed: a status update reads no layout here. */
  function stagger(chrome) {
    const L = X();
    const chips = [...chrome.querySelectorAll(':scope > .ro-chip')].sort((a, b) => parseFloat(a.dataset.x) - parseFloat(b.dataset.x));
    const plates = [...chrome.querySelectorAll(':scope > .ro-lplate')];
    const family = getComputedStyle(chrome).fontFamily;
    const keyOf = (c) => JSON.stringify([family, c.dataset.name, c._ic]);
    const stale = chips.filter((c) => !c._m || c._mk !== keyOf(c));
    /* writes first: a changed chip shows its whole name to be measured */
    for (const c of stale) if (c.dataset.full !== undefined) { text(c.querySelector('.ro-cn'), c.dataset.full); delete c.dataset.full; }
    /* then the reads, in one go */
    let hidden = false;
    for (const c of stale) {
      const name = c.querySelector('.ro-cn').textContent, w = c.offsetWidth, font = getComputedStyle(c.querySelector('.ro-cn')).font;
      if (!w) { hidden = true; c._mk = null; continue; } /* the office under a chat: not laid out, so nothing to remember; the next render measures */
      c._mk = keyOf(c);
      c._m = { w, h: c.offsetHeight || 17, iniW: Math.max(12, Math.ceil(w - textWidth(font, name) + textWidth(font, initials(c.dataset.name || '')))) };
    }
    for (const e of plates) {
      const k = JSON.stringify([family, e._sig, e.style.left, e.style.top, e.style.maxWidth]);
      if (e._rk !== k) { const x = e.offsetLeft, y = e.offsetTop, w = e.offsetWidth; if (!w) { hidden = true; e._rk = null; continue; } e._rk = k; e._r = [x, x + w, y, y + e.offsetHeight]; }
    }
    if (hidden) { chrome._plan = null; for (const c of chips) { sty(c, 'left', px(parseFloat(c.dataset.x) || 0)); sty(c, 'top', px(parseFloat(c.dataset.y) || 0)); } return; }
    const input = chips.map((c) => ({ x: parseFloat(c.dataset.x) || 0, y: parseFloat(c.dataset.y) || 0, w: c._m.w, h: c._m.h, iniW: c._m.iniW }));
    const rects = plates.map((e) => e._r);
    const planKey = JSON.stringify([input, rects, chips.map((c) => c.dataset.name)]);
    if (chrome._plan === planKey && !stale.length) return;
    chrome._plan = planKey;
    /* the plan, then the writes: each only when its value differs */
    L.staggerPlan(input, rects).forEach((o, i) => {
      const c = chips[i], name = c.dataset.full !== undefined ? c.dataset.full : c.querySelector('.ro-cn').textContent;
      sty(c, 'left', px(o.x)); sty(c, 'top', px(o.y));
      if (o.ini) { if (c.dataset.full === undefined) c.dataset.full = name; text(c.querySelector('.ro-cn'), initials(c.dataset.name || '')); }
      else if (c.dataset.full !== undefined) { text(c.querySelector('.ro-cn'), c.dataset.full); delete c.dataset.full; }
    });
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
  root.DurbarRealOffice = { render, reset, bad: () => [...BAD] };
})(typeof self !== 'undefined' ? self : this);
