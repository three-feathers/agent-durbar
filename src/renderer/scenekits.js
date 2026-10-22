/* Scene kits (spec 035 FR-013): how the people, chairs, desks and monitors are drawn. A theme only names a kit (`scene`
   in the manifest); the drawing code is the app's. The office kit is the scene in app.js itself (byte-identical Clean
   Office); every other kit is drawn here, on the same 200x124 stage, with the same status cues in the same places
   (screen content, waving hand, thinking bubble, mood signs) and the same CSS animation hooks (.pp, .head, .hand-l,
   .hand-r, .wave, .tap, .bar, .cursor, .steam, .bubble-g, .dizzy, .sweat, .amb, .halo, .glow). */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api; else root.DurbarScenes = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const KITS = ['office', 'corporate', 'pixel', 'court-indian', 'court-european', 'court-japanese'];

  /* a small stable pick from a list, so each agent keeps its own turban or sash colour */
  const pick = (seed, list) => { let h = 0; for (const ch of String(seed)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return list[h % list.length]; };
  const R = (x, y, w, h, f, more) => `<rect x="${x}" y="${y}" width="${w}" height="${h}"${more || ''} fill="${f}"/>`;

  /* ---------- shared: the parts every kit keeps where they are ---------- */
  function halo(o) {
    const { st, c, T } = o;
    if (c) {
      const hc = { working: T('--halo-working'), thinking: T('--halo-thinking'), waiting: T('--halo-waiting'), error: T('--halo-error') }[st];
      return hc ? `<g class="halo halo-${st}"><rect x="101" y="22" width="86" height="66" rx="17" fill="${hc}" opacity=".13"/><rect x="107" y="28" width="74" height="54" rx="13" fill="${hc}" opacity=".16"/></g>` : '';
    }
    if (st === 'working' || st === 'thinking') return `<rect class="glow" x="106" y="28" width="76" height="54" rx="14" fill="${st === 'working' ? T('--halo-working') : T('--halo-thinking')}" filter="url(#soft)" opacity=".24"/>`;
    return '';
  }
  function screenContent(o) {
    const { st, c, T, reduced } = o;
    let s = '';
    if (st === 'working') s += `<rect class="bar" x="121" y="41" width="34" height="3.6" rx="1.8" fill="${T('--bar-blue')}"/><rect class="bar" x="121" y="48.5" width="26" height="3.6" rx="1.8" fill="${T('--bar-sage')}"/><rect class="bar" x="121" y="56" width="42" height="3.6" rx="1.8" fill="${T('--bar-blue')}"/><rect class="bar" x="121" y="63.5" width="20" height="3.6" rx="1.8" fill="${T('--bar-blue-2')}"/>`;
    if (st === 'thinking') s += `<rect x="121" y="41" width="30" height="3.6" rx="1.8" fill="${T('--halo-thinking')}" opacity=".55"/><rect x="121" y="48.5" width="40" height="3.6" rx="1.8" fill="${T('--halo-thinking')}" opacity=".4"/><rect x="121" y="56" width="22" height="3.6" rx="1.8" fill="${T('--halo-thinking')}" opacity=".55"/><rect x="121" y="63.5" width="5" height="3.6" rx="1.8" fill="${T('--halo-thinking')}"${c ? ' class="cursor"' : ''}>${reduced || c ? '' : '<animate attributeName="opacity" values="1;.15;1" dur="1.6s" repeatCount="indefinite"/>'}</rect>`;
    if (st === 'waiting') s += `<rect x="121" y="41" width="30" height="3.6" rx="1.8" fill="${T('--wait-dot')}" opacity=".5"/><rect x="123" y="49" width="42" height="19" rx="5" fill="${T('--wait-card')}" stroke="${T('--wait-note-stroke')}" stroke-width="1.2"/><circle cx="131" cy="58.5" r="3" fill="${T('--wait-dot')}"/><rect x="138" y="54" width="20" height="3" rx="1.5" fill="${T('--wait-note-line')}"/><rect x="138" y="60" width="14" height="3" rx="1.5" fill="${T('--wait-note-line-2')}"/>`;
    if (st === 'idle') s += `<circle cx="144" cy="54.5" r="7" fill="none" stroke="${T('--idle-clock')}" stroke-width="1.6"/><path d="M144 50.5v4l2.6 1.6" fill="none" stroke="${T('--idle-clock')}" stroke-width="1.6" stroke-linecap="round"/>`;
    if (st === 'error') s += `<circle cx="144" cy="52" r="9" fill="none" stroke="${T('--halo-error')}" stroke-width="2"/><path d="M144 47.5v5.5M144 56.6v.1" stroke="${T('--halo-error')}" stroke-width="2.2" stroke-linecap="round"/><rect x="127" y="65" width="34" height="3" rx="1.5" fill="${T('--err-mark')}"/>`;
    if (st === 'done') s += `<circle cx="144" cy="54.5" r="10" fill="${T('--done-bg')}"/><path class="done-tick" d="M139 54.5l3.6 3.6 6.6-7" fill="none" stroke="${T('--done-mark')}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>`;
    return s;
  }
  const screenBg = (o) => ({ working: '--screen-working', thinking: '--screen-thinking', waiting: '--screen-waiting', idle: '--screen-idle', error: '--screen-error', done: '--screen-done' })[o.st];
  function steam(o) {
    return `<path class="steam" d="M101 73q-2-3 0-5" fill="none" stroke="${o.T('--steam')}" stroke-width="1.2" stroke-linecap="round"/><path class="steam" d="M105 73q-2-3 0-5" fill="none" stroke="${o.T('--steam')}" stroke-width="1.2" stroke-linecap="round"/>`;
  }
  function afterPerson(o) {
    const { st, mood, T } = o;
    let s = '';
    if (mood.trouble === 'dizzy') { const star = (x, y) => `<path d="M${x} ${y - 3.2}l1 2.2 2.2 1-2.2 1-1 2.2-1-2.2-2.2-1 2.2-1z" fill="${T('--star')}"/>`; s += `<g class="pp"><g class="dizzy">${star(58, 28)}${star(74, 21)}${star(90, 28)}</g></g>`; }
    if (mood.trouble === 'ambulance') s += `<g class="amb"><rect x="18" y="93" width="36" height="17" rx="4" fill="${T('--amb-body')}" stroke="${T('--amb-line')}" stroke-width="1"/><rect x="40" y="96" width="11" height="7" rx="1.5" fill="${T('--amb-window')}"/><rect x="18" y="103" width="36" height="3" fill="${T('--amb-stripe')}"/><path d="M28 96.5v5M25.5 99h5" stroke="${T('--amb-stripe')}" stroke-width="2" stroke-linecap="round"/><rect class="amb-light" x="30" y="89.5" width="9" height="4" rx="2" fill="${T('--amb-light')}"/><circle cx="26" cy="111" r="3.6" fill="${T('--amb-wheel')}"/><circle cx="46" cy="111" r="3.6" fill="${T('--amb-wheel')}"/></g>`;
    if (st === 'thinking') s += `<g class="bubble-g"><circle cx="58.5" cy="31" r="2" fill="${T('--bubble')}" stroke="${T('--bubble-line')}" stroke-width="1"/><circle cx="52" cy="25" r="3" fill="${T('--bubble')}" stroke="${T('--bubble-line')}" stroke-width="1"/><rect x="18" y="4" width="42" height="19" rx="9.5" fill="${T('--bubble')}" stroke="${T('--bubble-line')}" stroke-width="1.2"/><g fill="${T('--think-dot')}"><circle class="td" cx="30" cy="13.5" r="2.2"/><circle class="td" cx="39" cy="13.5" r="2.2"/><circle class="td" cx="48" cy="13.5" r="2.2"/></g></g>`;
    return s;
  }
  /* the face: eyes, glasses, mouth, monster brows; `px` draws it in square pixels */
  function face(o, px) {
    const { st, mood, k, T } = o;
    const closed = st === 'idle' || mood.trouble === 'faint', ex = closed ? 0 : 1.4, ink = T('--face-dark');
    let s = '';
    if (px) {
      s += closed ? R(67, 45, 5, 1.6, ink) + R(76, 45, 5, 1.6, ink) : R(69 + ex, 43.5, 3, 3, ink) + R(77 + ex, 43.5, 3, 3, ink);
      if (k.glasses) s += `<g fill="none" stroke="${ink}" stroke-width="1.2"><rect x="${66.5 + ex}" y="41.5" width="8" height="7"/><rect x="${74.5 + ex}" y="41.5" width="8" height="7"/></g>`;
      if (mood.body === 'monster') s += R(65, 39, 6, 2, ink) + R(77, 39, 6, 2, ink);
      if (mood.trouble === 'faint') s += R(72, 50, 4, 4, T('--faint-mouth'));
      else if (st === 'error' || mood.body === 'monster') s += R(70, 52, 8, 2, T('--mouth')) + R(69, 53.5, 2, 2, T('--mouth')) + R(77, 53.5, 2, 2, T('--mouth'));
      else s += R(71, 51, 6, 2, T('--mouth')) + (st === 'done' || st === 'idle' ? R(69.5, 49.5, 2, 2, T('--mouth')) + R(76.5, 49.5, 2, 2, T('--mouth')) : '');
      return s;
    }
    if (closed) s += `<path d="M67.5 45.6q2 1.7 4 0M76.5 45.6q2 1.7 4 0" fill="none" stroke="${ink}" stroke-width="1.3" stroke-linecap="round"/>`;
    else s += `<circle cx="${70.3 + ex}" cy="45.4" r="1.35" fill="${ink}"/><circle cx="${78.3 + ex}" cy="45.4" r="1.35" fill="${ink}"/>`;
    if (k.glasses) s += `<g fill="none" stroke="${ink}" stroke-width="1.1"><circle cx="${70.3 + ex}" cy="45.4" r="4"/><circle cx="${78.3 + ex}" cy="45.4" r="4"/></g>`;
    if (mood.body === 'monster') s += `<path d="M65.5 40l7 3.4M82.5 40l-7 3.4" fill="none" stroke="${ink}" stroke-width="1.8" stroke-linecap="round"/>`;
    const mouth = mood.body === 'monster' ? 'M70.2 53.8q3.8-3.6 7.6 0' : st === 'error' ? 'M71 53.2q3-2 6 0' : (st === 'done' || st === 'idle') ? 'M70.5 51q3.5 3 7 0' : 'M71 51.6q3 2 6 0';
    s += mood.trouble === 'faint' ? `<ellipse cx="74" cy="52" rx="1.9" ry="2.4" fill="${T('--faint-mouth')}"/>` : `<path d="${mouth}" fill="none" stroke="${T('--mouth')}" stroke-width="1.3" stroke-linecap="round"/>`;
    return s;
  }
  const horns = (o, px) => o.mood.body !== 'monster' ? '' : px
    ? R(62, 26, 3, 6, o.T('--monster-horn')) + R(83, 26, 3, 6, o.T('--monster-horn')) + R(63, 29, 3, 4, o.T('--monster-horn')) + R(82, 29, 3, 4, o.T('--monster-horn'))
    : `<path d="M64.5 35.5l-4.2-9.5 9 5.2zM83.5 35.5l4.2-9.5-9 5.2z" fill="${o.T('--monster-horn')}"/>`;
  const sweat = (o) => o.mood.body === 'heavy' ? `<path class="sweat" d="M90.5 36.5q3.2 4.6 0 7.4q-3.2-2.8 0-7.4z" fill="${o.T('--sweat')}" stroke="${o.T('--sweat-line')}" stroke-width=".6"/>` : '';
  /* arms: the same anchor points in every kit, so the CSS typing and waving animations line up */
  function arms(o, K) {
    const { st, mood, c, reduced } = o, typing = st === 'working';
    let s = '<g class="pp">';
    s += `<g class="${typing ? 'hand-l' : ''}">${K.arm(o, 61, 71, 68, 81)}${K.hand(o, 68.5, 81.4)}</g>`;
    if (st === 'waiting' && mood.trouble !== 'impatient' && mood.trouble !== 'faint') {
      const wave = reduced || c ? '' : `<animateTransform attributeName="transform" type="rotate" values="-4 87 71;6 87 71;-4 87 71" dur="2.8s" repeatCount="indefinite"/>`;
      s += `<g${c ? ' class="wave"' : ''}>${wave}${K.arm(o, 87, 71, 97, 46)}${K.hand(o, 97.5, 42.5)}</g>`;
    } else if (st === 'idle' || mood.trouble === 'faint') {
      s += `<g>${K.arm(o, 87, 71, 96, 80)}${K.hand(o, 97, 80.5)}</g>`;
    } else {
      s += `<g class="${typing ? 'hand-r' : mood.trouble === 'impatient' ? 'tap' : ''}">${K.arm(o, 87, 71, 81, 81)}${K.hand(o, 80.5, 81.4)}</g>`;
    }
    return s + '</g>';
  }
  const roundArm = (o, x1, y1, x2, y2, col) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${col || o.arm}" stroke-width="8" stroke-linecap="round"/>`;
  const roundHand = (o, x, y) => `<circle cx="${x}" cy="${y}" r="3.6" fill="${o.k.skin}"/>`;
  const wide = (o) => o.mood.body !== 'normal';
  const torso = (o) => wide(o) ? 'M52 99V77q0-14 14-14h16q14 0 14 14v22z' : 'M55 99V77q0-14 14-14h10q14 0 14 14v22z';

  /* ---------- the composer: one order for every kit ---------- */
  /* shade() in app.js takes #rrggbb only; a user theme may give any token grammar colour, which is then used as is */
  /* the overlays app.js hands over (already sanitized theme art); a caller without them draws none */
  const artOf = (o) => { const a = o.art || {}; const s = (v) => (typeof v === 'string' ? v : ''); return { body: s(a.body), head: s(a.head), desk: s(a.desk), monitor: s(a.monitor), cup: s(a.cup), laptop: s(a.laptop) }; };
  const safeShade = (base) => (c, p) => (/^#[0-9a-f]{6}$/i.test(c) ? base.shade(c, p) : c);
  function draw(kitId, a, base) {
    const K = KIT[kitId];
    if (!K) return null;
    const o = Object.assign({}, base);
    o.shade = safeShade(base);
    o.arm = o.shade(o.k.shirt, -0.14);
    o.skinD = o.shade(o.k.skin, -0.08);
    o.seed = (a && (a.id || a.name)) || o.k.shirt + o.k.hair;
    const { st, mood, mini, c, k, T } = o;
    const art = artOf(o); /* a theme's character, desk and monitor art (spec 040 FR-023), drawn over every kit as over the office one */
    let s = `<svg class="scene${c ? ' sc-c' : ''}" data-sig="${st}|${k.shirt}${k.skin}${k.hair}${k.style}${k.glasses ? 1 : 0}|${c ? 'c' : mini ? 'm' : 'f'}|${o.themeKey || ''}|${mood.body}${mood.trouble || ''}${mood.coffee ? 'C' : ''}|${kitId}" viewBox="${c ? '16 5 176 116' : mini ? '22 4 166 118' : '0 0 200 124'}"${K.crisp ? ' shape-rendering="crispEdges"' : ''} aria-hidden="true" focusable="false">`;
    s += `<ellipse cx="100" cy="118" rx="88" ry="3.5" fill="${T('--scene-shadow')}" opacity=".06"/>`;
    s += K.backdrop ? K.backdrop(o) : '';
    s += halo(o);
    s += K.chair(o);
    s += '<g class="pp">';
    s += K.hairBack ? K.hairBack(o) : '';
    s += K.body(o) + art.body;
    const tilt = mood.trouble === 'faint' ? 'rotate(-24 74 56)' : st === 'idle' ? 'rotate(-7 74 56)' : st === 'error' ? 'rotate(4 74 56)' : '';
    s += `<g ${tilt ? `transform="${tilt}"` : ''}${mood.trouble === 'faint' ? ' style="transform-box:view-box"' : ''}><g class="${st === 'working' ? 'head' : ''}">`;
    s += K.head(o) + K.hair(o) + horns(o, K.crisp) + face(o, K.crisp) + (K.headTop ? K.headTop(o) : '') + art.head;
    s += '</g></g>' + sweat(o) + '</g>';
    s += K.desk(o) + art.desk;
    s += K.monitor(o);
    s += `<rect x="116" y="36" width="56" height="37"${K.crisp ? '' : ' rx="3"'} fill="${T(screenBg(o))}"/>` + art.monitor;
    s += screenContent(o);
    s += K.screenOver ? K.screenOver(o) : '';
    s += art.laptop || K.keyboard(o); /* spec 070 FR-011: a pack's own laptop and cup replace the kit's (the steam stays: it is a status cue) */
    if (st === 'idle' || (o.mood && o.mood.coffee)) s += art.cup ? art.cup + steam(o) : K.cup(o); // spec 068: a cup on the desk during a coffee break
    s += K.props ? K.props(o) : '';
    s += arms(o, K);
    s += afterPerson(o);
    return s + '</svg>';
  }
  /* the walking figure in the lobby: head and shoulders of the same kit */
  function avatar(kitId, a, base) {
    const K = KIT[kitId];
    if (!K) return null;
    const o = Object.assign({ st: 'working', mood: { body: 'normal' }, mini: false, c: false }, base);
    o.shade = safeShade(base);
    o.arm = o.shade(o.k.shirt, -0.14); o.skinD = o.shade(o.k.skin, -0.08); o.seed = (a && (a.id || a.name)) || o.k.shirt + o.k.hair;
    o.st = 'avatar';
    const art = artOf(o);
    return `<svg viewBox="50 20 48 48" width="100%" height="100%"${K.crisp ? ' shape-rendering="crispEdges"' : ''} aria-hidden="true" focusable="false">${K.hairBack ? K.hairBack(o) : ''}${K.body(o)}${art.body}${K.head(o)}${K.hair(o)}${face(Object.assign({}, o, { st: 'working' }), K.crisp)}${K.headTop ? K.headTop(o) : ''}${art.head}</svg>`;
  }

  const KIT = {};

  /* ---------- Corporate: suits and ties, an executive chair, a glass desk, a thin widescreen ---------- */
  KIT.corporate = {
    chair: (o) => `<rect x="49" y="34" width="50" height="64" rx="12" fill="${o.T('--chair')}"/><rect x="55" y="38" width="38" height="8" rx="4" fill="${o.shade(o.T('--chair'), 0.18)}"/><rect x="53" y="50" width="42" height="44" rx="9" fill="${o.shade(o.T('--chair'), 0.1)}"/>`,
    hairBack: (o) => o.k.style === 'long' ? `<path d="M60 44a14 14 0 0 1 28 0v12q0 3-3 3H63q-3 0-3-3z" fill="${o.k.hair}"/>` : '',
    body: (o) => {
      const suit = o.shade(o.k.shirt, -0.55), w = wide(o);
      return `<path d="${torso(o)}" fill="${suit}"/><path d="M68 63l6 12 6-12z" fill="#f8fafc"/><path d="M73 64.5h2l1.3 9.5-2.3 3.2-2.3-3.2z" fill="${o.k.shirt}"/><path d="M68 63l4 9-5 3M80 63l-4 9 5 3" fill="none" stroke="${o.shade(suit, 0.3)}" stroke-width="1.4"/><rect x="${w ? 85 : 83}" y="76" width="6" height="1.6" fill="#f8fafc" opacity=".9"/><rect x="70" y="53" width="8" height="10" rx="3" fill="${o.skinD}"/>`;
    },
    head: (o) => `<circle cx="74" cy="44" r="12.5" fill="${o.k.skin}"/>`,
    hair: (o) => {
      const c = o.k.hair, st = o.k.style;
      const part = `<path d="M61.5 42C61 32 67 30 74 30C82 30 87.5 33 87 42C85 37 82 35.5 77 35.5L70 35.5C66 35.5 63 38 61.5 42Z" fill="${c}"/><path d="M70 35.6l3-4.6" stroke="${o.shade(c, 0.25)}" stroke-width="1"/>`;
      if (st === 'bun') return part + `<ellipse cx="74" cy="29.5" rx="6" ry="4" fill="${c}"/>`;
      if (st === 'curly') return `<path d="M61 41c-1-11 6-13 13-13s14 2 13 13c-2-4-5-6-13-6s-11 2-13 6z" fill="${c}"/><circle cx="66" cy="32" r="3.4" fill="${c}"/><circle cx="74" cy="29.6" r="3.6" fill="${c}"/><circle cx="82" cy="32" r="3.4" fill="${c}"/>`;
      return part;
    },
    desk: (o) => {
      const top = o.T('--desk');
      return `<rect x="10" y="86" width="180" height="5" rx="1" fill="${top}" opacity=".75"/><rect x="10" y="86" width="180" height="1.4" fill="#ffffff" opacity=".7"/><rect x="10" y="91" width="180" height="1.2" fill="${o.shade(top, -0.3)}" opacity=".6"/><rect x="20" y="92" width="3" height="22" fill="${o.T('--monitor-stand')}"/><rect x="177" y="92" width="3" height="22" fill="${o.T('--monitor-stand')}"/><rect x="20" y="104" width="160" height="1.6" fill="${o.T('--monitor-stand')}" opacity=".5"/>`;
    },
    monitor: (o) => `<rect x="141.5" y="76" width="5" height="9" fill="${o.T('--monitor-stand')}"/><ellipse cx="144" cy="85.2" rx="11" ry="1.6" fill="${o.T('--monitor-stand')}"/><rect x="112.5" y="32.5" width="63" height="44" rx="2" fill="${o.T('--monitor-frame')}"/>`,
    screenOver: () => `<path d="M116 36h22l-14 37h-8z" fill="#ffffff" opacity=".08"/>`,
    keyboard: (o) => `<rect x="58" y="83.2" width="38" height="2.6" rx="1" fill="${o.T('--laptop')}"/>`,
    cup: (o) => `<rect x="98" y="76" width="9" height="10" rx="1.5" fill="#ffffff" stroke="${o.T('--cup-line')}" stroke-width="1"/><rect x="98" y="79" width="9" height="2.5" fill="${o.T('--brand-bg')}"/>` + steam(o),
    props: (o) => `<rect x="164" y="80" width="16" height="6" rx="2" fill="${o.T('--monitor-frame')}"/><rect x="166" y="77" width="12" height="3.4" rx="1.7" fill="${o.shade(o.T('--monitor-frame'), 0.2)}"/>`,
    arm: (o, x1, y1, x2, y2) => roundArm(o, x1, y1, x2, y2, o.shade(o.k.shirt, -0.6)),
    hand: (o, x, y) => `<rect x="${x - 4}" y="${y - 4.6}" width="8" height="2" fill="#f8fafc"/>` + roundHand(o, x, y),
  };

  /* ---------- Pixel: everything on a 3px grid, a CRT, square hands ---------- */
  KIT.pixel = {
    crisp: true,
    chair: (o) => { const ch = o.T('--chair'); return R(54, 50, 40, 48, ch) + R(51, 56, 3, 36, ch) + R(94, 56, 3, 36, ch) + R(57, 53, 34, 3, o.shade(ch, 0.2)); },
    hairBack: (o) => o.k.style === 'long' ? R(59, 36, 30, 27, o.k.hair) : '',
    body: (o) => {
      const sh = o.k.shirt, w = wide(o), x = w ? 52 : 55, wd = w ? 44 : 38;
      return R(x + 3, 63, wd - 6, 3, sh) + R(x, 66, wd, 33, sh) + R(x, 66, 3, 33, o.shade(sh, -0.2)) + R(x + wd - 3, 66, 3, 33, o.shade(sh, -0.2)) + R(70, 63, 8, 6, o.shade(sh, 0.35)) + R(71, 54, 6, 9, o.skinD);
    },
    head: (o) => { const s = o.k.skin; return R(64, 33, 20, 24, s) + R(61, 36, 26, 18, s) + R(62, 35, 24, 20, s) + R(60, 42, 2, 6, o.shade(s, -0.1)) + R(86, 42, 2, 6, o.shade(s, -0.1)); },
    hair: (o) => {
      const c = o.k.hair, st = o.k.style;
      let s = R(63, 30, 22, 6, c) + R(61, 33, 26, 5, c) + R(60, 37, 4, 7, c) + R(84, 37, 4, 7, c) + R(66, 36, 6, 3, c);
      if (st === 'bun') s += R(70, 24, 8, 7, c) + R(71, 23, 6, 1, o.shade(c, 0.3));
      if (st === 'curly') s += R(60, 30, 4, 4, c) + R(84, 30, 4, 4, c) + R(68, 27, 4, 3, c) + R(76, 27, 4, 3, c);
      return s + R(66, 31, 4, 2, o.shade(c, 0.35));
    },
    desk: (o) => { const d = o.T('--desk'), f = o.T('--desk-front'); return R(10, 86, 180, 6, d) + R(10, 86, 180, 2, o.shade(d, 0.25)) + R(13, 92, 174, 22, f) + R(13, 92, 174, 3, o.shade(f, -0.18)) + R(22, 98, 45, 12, o.T('--desk-drawer')) + R(42, 103, 6, 3, o.shade(f, -0.4)) + R(142, 98, 36, 12, o.T('--desk-drawer')) + R(157, 103, 6, 3, o.shade(f, -0.4)); },
    monitor: (o) => { const m = o.T('--monitor-frame'); return R(132, 77, 24, 9, o.T('--monitor-stand')) + R(126, 83, 36, 3, o.T('--monitor-stand')) + R(108, 28, 72, 52, m) + R(108, 28, 72, 3, o.shade(m, 0.25)) + R(111, 31, 66, 45, o.shade(m, -0.25)) + R(166, 76, 9, 3, '#ff004d') + R(160, 77, 3, 2, '#00e436'); },
    screenOver: () => { let s = '<g opacity=".14">'; for (let y = 37; y < 73; y += 3) s += R(116, y, 56, 1, '#000'); return s + '</g>'; },
    keyboard: (o) => R(58, 82, 39, 4, o.T('--laptop')) + R(60, 83, 3, 1, '#fff1e8') + R(66, 83, 3, 1, '#fff1e8') + R(72, 83, 3, 1, '#fff1e8') + R(78, 83, 3, 1, '#fff1e8') + R(84, 83, 3, 1, '#fff1e8'),
    cup: (o) => R(98, 76, 10, 10, o.T('--cup')) + R(98, 76, 10, 2, o.T('--cup-line')) + R(108, 78, 3, 2, o.T('--cup-line')) + R(110, 80, 2, 3, o.T('--cup-line')) + R(108, 83, 3, 2, o.T('--cup-line')) + steam(o),
    props: (o) => R(164, 80, 12, 6, '#7e2553') + R(166, 77, 8, 3, '#ff77a8') + R(168, 74, 4, 3, '#ffec27'),
    arm: (o, x1, y1, x2, y2) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${o.arm}" stroke-width="8" stroke-linecap="square"/>`,
    hand: (o, x, y) => R(x - 3.5, y - 3.5, 7, 7, o.k.skin),
  };

  /* ---------- Durbar · Indian: an arched throne back, sherwani and turban, a carved low desk, a jharokha screen ---------- */
  const GOLD = '#c9973a', GOLD_L = '#e7c27a';
  KIT['court-indian'] = {
    chair: (o) => `<path d="M48 98V60Q48 38 74 33Q100 38 100 60V98z" fill="${o.T('--chair')}" stroke="${GOLD}" stroke-width="2"/><path d="M54 96V62Q54 44 74 40Q94 44 94 62V96" fill="none" stroke="${GOLD_L}" stroke-width="1" opacity=".8"/><circle cx="74" cy="36.5" r="2.4" fill="${GOLD}"/>`,
    hairBack: (o) => o.k.style === 'long' ? `<path d="M61 44a13 13 0 0 1 26 0v8q0 3-3 3H64q-3 0-3-3z" fill="${o.k.hair}"/><path d="M86 50q4 14 1 30" fill="none" stroke="${o.k.hair}" stroke-width="4.5" stroke-linecap="round"/>` : '',
    body: (o) => {
      const sh = o.k.shirt;
      return `<path d="${torso(o)}" fill="${sh}"/><path d="M74 64v35" stroke="${o.shade(sh, -0.25)}" stroke-width="1"/><g fill="${GOLD}"><circle cx="76.5" cy="70" r="1.3"/><circle cx="76.5" cy="76" r="1.3"/><circle cx="76.5" cy="82" r="1.3"/></g><path d="M58 70Q74 86 92 74" fill="none" stroke="${GOLD_L}" stroke-width="3" opacity=".85"/><rect x="69" y="60" width="10" height="4.5" rx="1.5" fill="${o.shade(sh, -0.3)}" stroke="${GOLD}" stroke-width=".8"/><rect x="70" y="53" width="8" height="8" rx="3" fill="${o.skinD}"/>`;
    },
    head: (o) => `<circle cx="74" cy="44" r="12.5" fill="${o.k.skin}"/>`,
    hair: (o) => {
      const st = o.k.style, c = o.k.hair;
      if (st === 'long' || st === 'bun') {
        const s = `<path d="M61 43.5C61 33 67 30.5 74 30.5C81 30.5 87 33 87 43.5C84 38.5 80 37 74 37C68 37 64 38.5 61 43.5Z" fill="${c}"/><path d="M74 31v6" stroke="${o.shade(c, 0.3)}" stroke-width="1"/><circle cx="74" cy="38.6" r="1.5" fill="${GOLD}"/><circle cx="74" cy="41.5" r="1" fill="#b5302f"/>`;
        return st === 'bun' ? s + `<circle cx="74" cy="28" r="5.5" fill="${c}"/><g fill="#fffaf0"><circle cx="69" cy="27" r="1.4"/><circle cx="71" cy="24" r="1.4"/><circle cx="74.5" cy="22.8" r="1.4"/><circle cx="78" cy="24" r="1.4"/><circle cx="79.5" cy="27" r="1.4"/></g>` : s;
      }
      const t = pick(o.seed, ['#e0892b', '#a8343f', '#0f6e6e', '#c2456b', '#d9b13b']);
      return `<path d="M60 42C59 30 66 25.5 74 25.5C82 25.5 89 30 88 42C85 39.5 80 38.6 74 38.6C68 38.6 63 39.5 60 42Z" fill="${t}"/><path d="M61.5 37Q74 28 86.5 37M62.5 33Q74 25 85.5 33" fill="none" stroke="${o.shade(t, -0.22)}" stroke-width="1.2"/><circle cx="74" cy="30.5" r="2.4" fill="${GOLD}" stroke="#fffaf0" stroke-width=".7"/><path d="M74 28q3-6 7-7q-2 4-7 7z" fill="${o.shade(t, 0.35)}"/>`;
    },
    desk: (o) => {
      const d = o.T('--desk'), f = o.T('--desk-front');
      return `<rect x="10" y="86" width="180" height="6" rx="2" fill="${d}"/><rect x="10" y="91" width="180" height="1.4" fill="${GOLD}"/><path d="M16 92.5h168v6q-7 5-14 0q-7 5-14 0q-7 5-14 0q-7 5-14 0q-7 5-14 0q-7 5-14 0q-7 5-14 0q-7 5-14 0q-7 5-14 0q-7 5-14 0q-7 5-14 0q-7 5-14 0z" fill="${f}"/><path d="M20 98v16h7v-10q0-4 4-6zM180 98v16h-7v-10q0-4-4-6z" fill="${o.shade(f, -0.2)}"/>`;
    },
    monitor: (o) => `<rect x="138.5" y="76" width="11" height="9" fill="${GOLD}"/><rect x="128" y="83" width="32" height="3.5" rx="1.75" fill="${o.shade(o.T('--desk'), -0.15)}"/><path d="M110 78V40Q110 22 144 18Q178 22 178 40V78z" fill="${o.T('--monitor-frame')}" stroke="${GOLD}" stroke-width="1.6"/><path d="M144 13l3 5h-6zM139 18h10" fill="${GOLD}" stroke="${GOLD}" stroke-width="1"/><path d="M116 36q2-10 28-12q26 2 28 12" fill="none" stroke="${GOLD_L}" stroke-width="1"/>`,
    keyboard: (o) => `<rect x="58" y="81.5" width="38" height="4.5" rx="1" fill="#f3e3c3" stroke="${GOLD}" stroke-width=".6"/><path d="M62 83.7h30" stroke="#8a5a2b" stroke-width=".8" stroke-dasharray="2 1.5"/>`,
    cup: (o) => `<path d="M98 78h11l-1.5 8h-8z" fill="#b8862f"/><path d="M98 78h11" stroke="${GOLD_L}" stroke-width="1.4"/>` + steam(o),
    props: (o) => `<path d="M163 86q0-5 8-5q8 0 8 5z" fill="#b8862f"/><path d="M171 81q-2.5-3 0-7q2.5 4 0 7z" fill="#f2a83a"/><path d="M171 80q-1-1.6 0-3.2q1 1.6 0 3.2z" fill="#fff1c2"/>`,
    arm: (o, x1, y1, x2, y2) => roundArm(o, x1, y1, x2, y2),
    hand: (o, x, y) => `<circle cx="${x}" cy="${y}" r="4.6" fill="none" stroke="${GOLD}" stroke-width="1.2" opacity=".9"/>` + roundHand(o, x, y),
  };

  /* ---------- Durbar · European: a gilt throne, ruff and sash, periwigs, a mahogany bureau, a picture frame ---------- */
  const GILT = '#c9a24a', GILT_D = '#8f6d22';
  KIT['court-european'] = {
    chair: (o) => `<path d="M50 98V44Q50 30 58 27Q66 22 74 26Q82 22 90 27Q98 30 98 44V98z" fill="${GILT}"/><path d="M54 96V46Q54 34 62 31Q68 28 74 31Q80 28 86 31Q94 34 94 46V96z" fill="${o.T('--chair')}"/><circle cx="74" cy="24" r="3" fill="${GILT}"/><circle cx="58" cy="27.5" r="2" fill="${GILT}"/><circle cx="90" cy="27.5" r="2" fill="${GILT}"/>`,
    hairBack: (o) => {
      const st = o.k.style;
      if (st === 'long') return `<path d="M60 44a14 14 0 0 1 28 0v16q0 5-5 5H65q-5 0-5-5z" fill="${o.k.hair}"/>`;
      if (st === 'bun') return '';
      const w = '#ece6da';
      return `<g fill="${w}"><circle cx="61" cy="47" r="4.2"/><circle cx="61" cy="54" r="4"/><circle cx="87" cy="47" r="4.2"/><circle cx="87" cy="54" r="4"/></g><path d="M74 54q0 6 0 10" stroke="#1b2240" stroke-width="2.4" stroke-linecap="round"/>`;
    },
    body: (o) => {
      const sh = o.k.shirt, sash = pick(o.seed, ['#2b4c9a', '#7a1f35', '#3f6b4f']);
      return `<path d="${torso(o)}" fill="${sh}"/><path d="M60 66L90 96" stroke="${sash}" stroke-width="5"/><circle cx="84" cy="88" r="2.6" fill="${GILT}"/><g fill="${GILT}"><circle cx="71" cy="72" r="1.1"/><circle cx="71" cy="78" r="1.1"/></g><rect x="70" y="53" width="8" height="8" rx="3" fill="${o.skinD}"/><g fill="#fbf8f1" stroke="#d8d0bd" stroke-width=".6"><ellipse cx="66" cy="62" rx="5" ry="3"/><ellipse cx="74" cy="63.4" rx="5" ry="3"/><ellipse cx="82" cy="62" rx="5" ry="3"/></g>`;
    },
    head: (o) => `<circle cx="74" cy="44" r="12.5" fill="${o.k.skin}"/>`,
    hair: (o) => {
      const st = o.k.style, c = o.k.hair;
      if (st === 'long') return `<path d="M61 43.5C61 33 67 30.5 74 30.5C81 30.5 87 33 87 43.5C84 38.5 80 37 74 37C68 37 64 38.5 61 43.5Z" fill="${c}"/><path d="M85 34q4 2 3 6" stroke="#2b4c9a" stroke-width="2" fill="none" stroke-linecap="round"/>`;
      if (st === 'bun') return `<path d="M61 43.5C61 33 67 30.5 74 30.5C81 30.5 87 33 87 43.5C84 38.5 80 37 74 37C68 37 64 38.5 61 43.5Z" fill="${c}"/><circle cx="74" cy="28" r="5.5" fill="${c}"/><path d="M66 32.5l2.5-6 3 4.2 2.5-6 2.5 6 3-4.2 2.5 6z" fill="${GILT}" stroke="${GILT_D}" stroke-width=".5"/>`;
      const w = '#ece6da';
      return `<path d="M60.5 44C60 31 66 28.5 74 28.5C82 28.5 88 31 87.5 44C85 38 80 36 74 36C68 36 63 38 60.5 44Z" fill="${w}"/><g fill="${w}"><circle cx="62" cy="40" r="3.6"/><circle cx="86" cy="40" r="3.6"/></g><path d="M66 32q8-4 16 0" fill="none" stroke="#d6cdbb" stroke-width="1"/>`;
    },
    desk: (o) => {
      const d = o.T('--desk'), f = o.T('--desk-front');
      return `<rect x="10" y="86" width="180" height="7" rx="2" fill="${d}"/><rect x="10" y="86" width="180" height="1.4" fill="${GILT}"/><rect x="18" y="93" width="164" height="16" fill="${f}"/><g fill="none" stroke="${GILT}" stroke-width="1"><rect x="24" y="96" width="46" height="10" rx="2"/><rect x="130" y="96" width="46" height="10" rx="2"/></g><circle cx="47" cy="101" r="1.4" fill="${GILT}"/><circle cx="153" cy="101" r="1.4" fill="${GILT}"/><path d="M18 109q-2 3 1 5h5q-3-2-1-5zM182 109q2 3-1 5h-5q3-2 1-5z" fill="${o.shade(f, -0.25)}"/>`;
    },
    monitor: (o) => `<path d="M132 78l-6 8M156 78l6 8M144 78v8" stroke="${GILT_D}" stroke-width="2.2" stroke-linecap="round"/><rect x="108" y="28" width="72" height="53" rx="2" fill="${GILT}"/><rect x="111" y="31" width="66" height="47" fill="${GILT_D}"/><rect x="113" y="33" width="62" height="43" fill="${o.T('--monitor-frame')}"/><g fill="${GILT}"><circle cx="108" cy="28" r="3"/><circle cx="180" cy="28" r="3"/><circle cx="108" cy="81" r="3"/><circle cx="180" cy="81" r="3"/><path d="M138 28q6-7 12 0z"/></g>`,
    keyboard: (o) => `<rect x="58" y="82" width="38" height="4" rx="1" fill="#f4ecd8" stroke="#cbbf9f" stroke-width=".6"/><path d="M90 82l6-9" stroke="#3a2a1a" stroke-width="1"/><path d="M96 73q2-1 1 2z" fill="#fbf8f1"/>`,
    cup: (o) => `<path d="M98 78h10q0 6-5 8q-5-2-5-8z" fill="#fbf8f1" stroke="${GILT}" stroke-width=".8"/><path d="M108 79q3 0 2.5 3t-3 2" fill="none" stroke="${GILT}" stroke-width="1"/>` + steam(o),
    props: (o) => `<rect x="168" y="84" width="10" height="2.5" rx="1" fill="${GILT}"/><rect x="171.5" y="70" width="3" height="14" fill="#fbf8f1"/><path d="M173 70q-2.4-3 0-6.5q2.4 3.5 0 6.5z" fill="#f2b33a"/>`,
    arm: (o, x1, y1, x2, y2) => roundArm(o, x1, y1, x2, y2),
    hand: (o, x, y) => `<circle cx="${x}" cy="${y}" r="4.4" fill="#fbf8f1" opacity=".95"/>` + roundHand(o, x, y),
  };

  /* ---------- Durbar · Japanese: a gold folding screen, kimono and obi, plain short hair or a bun with a kanzashi, a lacquer table ---------- */
  const VERMILION = '#c23b22', LACQUER = '#1c1a17';
  KIT['court-japanese'] = {
    chair: (o) => `<g><rect x="40" y="30" width="22" height="66" fill="#d9b95c"/><rect x="62" y="28" width="24" height="68" fill="#e3c66e"/><rect x="86" y="30" width="22" height="66" fill="#d9b95c"/><g fill="none" stroke="${LACQUER}" stroke-width="1.2"><rect x="40" y="30" width="22" height="66"/><rect x="62" y="28" width="24" height="68"/><rect x="86" y="30" width="22" height="66"/></g><path d="M44 60q8-10 16-4q6-12 18-6q10-8 26 2" fill="none" stroke="#3f5a3a" stroke-width="2.4" opacity=".7"/><circle cx="96" cy="40" r="4" fill="${VERMILION}" opacity=".85"/></g>`,
    hairBack: (o) => o.k.style === 'long' ? `<path d="M60.5 44a13.5 13.5 0 0 1 27 0v24h-27z" fill="${o.k.hair}"/><rect x="72" y="64" width="4" height="3" fill="${VERMILION}"/>` : '',
    body: (o) => {
      const sh = o.k.shirt, obi = pick(o.seed, ['#d9b95c', '#2c4a7e', VERMILION, '#6b7d4a']);
      return `<path d="${torso(o)}" fill="${sh}"/><path d="M66 63L80 84M82 63L70 80" stroke="#f6f1e6" stroke-width="3.2"/><path d="M66 63L80 84" stroke="${o.shade(sh, -0.25)}" stroke-width="1"/><rect x="${wide(o) ? 52 : 55}" y="79" width="${wide(o) ? 44 : 38}" height="7" fill="${obi}"/><rect x="${wide(o) ? 52 : 55}" y="82" width="${wide(o) ? 44 : 38}" height="1.2" fill="${o.shade(obi, -0.3)}"/><rect x="70" y="53" width="8" height="10" rx="3" fill="${o.skinD}"/>`;
    },
    head: (o) => `<ellipse cx="74" cy="44.5" rx="12" ry="13" fill="${o.k.skin}"/>`,
    hair: (o) => {
      const st = o.k.style, c = o.k.hair;
      const base = `<path d="M61.5 44C61 33 67 30 74 30C81 30 87 33 86.5 44C85 39 81 36.5 74 36.5C67 36.5 63 39 61.5 44Z" fill="${c}"/>`;
      if (st === 'bun') return base + `<path d="M66 31q8-9 16 0q-2 4-8 4q-6 0-8-4z" fill="${c}"/><path d="M80 26l8-6" stroke="${o.shade(c, 0.5)}" stroke-width="1.2"/><circle cx="88.5" cy="19.5" r="2.4" fill="${VERMILION}"/><path d="M87 21.5l-1 4M90 21.5l1 4" stroke="#d9b95c" stroke-width=".8"/>`;
      if (st === 'curly') return `<path d="M61 47C60 33 66 30 74 30C82 30 88 33 87 47L84 47L84 39L64 39L64 47Z" fill="${c}"/>`;
      if (st === 'long') return base + `<path d="M62 40q12-6 24 0" fill="none" stroke="${o.shade(c, 0.25)}" stroke-width="1"/>`;
      /* plain short hair (no topknot): the cap plus short sides at the temples */
      return base + `<path d="M61.5 44L62 49.5H63.8V40.5Z M86.5 44L86 49.5H84.2V40.5Z" fill="${c}"/>`;
    },
    /* spec 052 FR-032: the table is warm lacquer from the theme's desk tokens, not near-black ink */
    desk: (o) => { const d = o.T('--desk'), f = o.T('--desk-front'); return `<rect x="10" y="86" width="180" height="6" rx="1" fill="${d}"/><rect x="10" y="86" width="180" height="1.4" fill="${VERMILION}"/><rect x="10" y="92" width="180" height="2" fill="${f}"/><path d="M18 94h8v20h-8zM174 94h8v20h-8z" fill="${o.T('--desk-drawer')}"/><rect x="18" y="110" width="164" height="2" fill="${d}" opacity=".6"/>`; },
    monitor: (o) => { const w = '#b48a5a'; return `<rect x="141" y="76" width="6" height="9" fill="${w}"/><rect x="130" y="84" width="28" height="2.4" fill="${LACQUER}"/><rect x="110" y="30" width="68" height="49" fill="${w}"/><rect x="108" y="27" width="72" height="4" fill="${LACQUER}"/><g fill="none" stroke="${o.shade(w, -0.25)}" stroke-width="1"><path d="M110 33h68M110 76h68M113 30v49M175 30v49"/></g>`; },
    keyboard: (o) => `<rect x="58" y="82.4" width="38" height="3.6" fill="#f6f1e6" stroke="#cdbf9f" stroke-width=".5"/><path d="M88 82l7-8" stroke="${LACQUER}" stroke-width="1.4" stroke-linecap="round"/><rect x="62" y="82" width="10" height="4" fill="${LACQUER}" opacity=".85"/>`,
    cup: (o) => `<path d="M98 79h11q-1 7-5.5 7q-4.5 0-5.5-7z" fill="#6b4b3a"/><path d="M98 79h11" stroke="#cdbf9f" stroke-width="1.2"/>` + steam(o),
    props: (o) => `<path d="M165 86q0-6 6-6q6 0 6 6z" fill="${LACQUER}"/><path d="M171 80q-5-4-1-10q2 4 6 3q-1 5-5 7z" fill="#4f6b3f"/>`,
    arm: (o, x1, y1, x2, y2) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${o.arm}" stroke-width="9.5" stroke-linecap="butt"/>`,
    hand: (o, x, y) => roundHand(o, x, y),
  };

  return { KITS, draw, avatar };
});
