/*
 * Page-side measuring for scripts/check-ui-text.js (spec 052 FR-171). Read by the driver and evaluated in the page; installs
 * window.__uitext. Read-only: it changes nothing on the page (its probes are removed again).
 *
 *   window.__uitext.check(kind, rootSelectors, o) -> [{rule, el, detail}]   the violations of the PR1 rules on the visible roots
 *   kind: 'dialog' | 'popover' | 'menu' | 'screen' | 'chat'
 *   o.dark: also check the contrast of the FR-169 controls
 *
 * PR2 rules (T150-T155) have hooks at the bottom (`pr2`) that only report and are not asserted yet.
 */
(function () {
  if (window.__uitext) return;
  const MIN_PX = 10.5;
  const vis = (el) => {
    if (!el || !el.getClientRects().length) return false;
    const c = getComputedStyle(el);
    if (c.visibility === 'hidden' || c.display === 'none' || parseFloat(c.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    if (el.closest('.sr-only,[aria-hidden="true"]')) return false;
    for (let d = el.closest('details:not([open])'); d; d = d.parentElement && d.parentElement.closest('details:not([open])')) {
      const sm = d.querySelector(':scope > summary');
      if (!(sm && sm.contains(el)) && el !== d) return false;
    }
    return true;
  };
  const desc = (el) => {
    let s = el.tagName.toLowerCase();
    if (el.id) s += '#' + el.id;
    const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/).filter(Boolean).slice(0, 3) : [];
    if (cls.length) s += '.' + cls.join('.');
    return s;
  };
  const path = (el, root) => { const p = []; for (let e = el; e && e !== root && p.length < 4; e = e.parentElement) p.unshift(desc(e)); return p.join(' > ') || desc(root); };
  const ownText = (el) => [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').replace(/\s+/g, ' ').trim();
  const snip = (t, n = 60) => (t.length > n ? t.slice(0, n - 1) + '…' : t);
  /* the part of el that is on screen, inside every clipping ancestor */
  const shown = (el) => {
    const r = el.getBoundingClientRect(); let L = r.left, T = r.top, R = r.right, B = r.bottom;
    for (let p = el.parentElement; p; p = p.parentElement) {
      const c = getComputedStyle(p);
      if (/(auto|scroll|hidden|clip)/.test(c.overflow + c.overflowX + c.overflowY)) { const q = p.getBoundingClientRect(); L = Math.max(L, q.left); T = Math.max(T, q.top); R = Math.min(R, q.right); B = Math.min(B, q.bottom); }
    }
    L = Math.max(L, 0); T = Math.max(T, 0); R = Math.min(R, innerWidth); B = Math.min(B, innerHeight);
    return R - L > 1 && B - T > 1;
  };
  const MACHINE = 'code,pre,kbd,.srv-cmd,.trustcmd,.hs-log,.hs-where,.pdiff,.q-url,.q-host,.signin-details,.mono';
  const LEGIT = /[-\/·,–—_.:;)\]]/;

  /* a probe element resolving a token to pixels (a token may be min(...), a length or a padding shorthand) */
  function probe(parent, prop, value) {
    const p = document.createElement('div');
    p.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none;box-sizing:content-box;width:0;height:0;' + prop + ':' + value;
    parent.appendChild(p);
    const cs = getComputedStyle(p);
    const out = prop === 'padding' ? ['Top', 'Right', 'Bottom', 'Left'].map((k) => parseFloat(cs['padding' + k])) : parseFloat(cs.width);
    p.remove();
    return out;
  }

  /* colour parsing through a canvas: handles rgb(), color-mix() results and color(srgb ...) alike */
  const cv = document.createElement('canvas'); cv.width = cv.height = 1;
  const g = cv.getContext('2d', { willReadFrequently: true });
  const rgba = (css) => { g.clearRect(0, 0, 1, 1); g.fillStyle = '#000'; g.fillStyle = css; g.fillRect(0, 0, 1, 1); const d = g.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
  const over = (top, bot) => { const a = top[3] + bot[3] * (1 - top[3]); return a ? [0, 1, 2].map((i) => (top[i] * top[3] + bot[i] * bot[3] * (1 - top[3])) / a).concat(a) : [0, 0, 0, 0]; };
  function backdrop(el) {
    let acc = [0, 0, 0, 0];
    const chain = [];
    for (let e = el; e; e = e.parentElement) chain.push(e);
    for (const e of chain) { // nearest first: composite what is behind it
      const c = rgba(getComputedStyle(e).backgroundColor);
      acc = over(acc, c);
      if (acc[3] >= 0.999) break;
    }
    return acc[3] >= 0.999 ? acc : over(acc, [255, 255, 255, 1]);
  }
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const contrast = (fg, bg) => { const a = lum(fg), b = lum(bg); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); };

  /* the controls of FR-169 that carried a literal light colour */
  const DARK_CONTROLS = [
    '#topBtns button[aria-pressed="true"]', '.scr-head .seg button[aria-selected="true"]', '.thpick[aria-pressed=true]',
    '.capf input', '.plrow select', '.dlg label.pico-opt', '.ctxchip', '#capChip', '.sitem.attn.st-error',
  ];

  function brokenWords(root) {
    const out = [];
    const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = tw.nextNode(); n; n = tw.nextNode()) {
      const el = n.parentElement; if (!el || !vis(el) || !shown(el)) continue;
      if (el.closest(MACHINE)) continue;
      const re = /[^\s]{4,}/g; let m;
      while ((m = re.exec(n.textContent))) {
        if (/[\/\\]/.test(m[0]) && m[0].length > 18) continue; // a path or an address
        const rg = document.createRange(); rg.setStart(n, m.index); rg.setEnd(n, m.index + m[0].length);
        const tops = new Set([...rg.getClientRects()].filter((r) => r.width > 0).map((r) => Math.round(r.top)));
        if (tops.size < 2) continue;
        let at = -1, prev = null;
        for (let i = 0; i < m[0].length; i++) {
          const c = document.createRange(); c.setStart(n, m.index + i); c.setEnd(n, m.index + i + 1);
          const cr = [...c.getClientRects()].filter((r) => r.width > 0)[0]; if (!cr) continue;
          const t = Math.round(cr.top); if (prev !== null && Math.abs(t - prev) > 2) { at = i; break; } prev = t;
        }
        if (at > 0 && LEGIT.test(m[0][at - 1])) continue;
        // a word longer than its whole line may break
        let blk = el; while (blk.parentElement && getComputedStyle(blk).display.startsWith('inline')) blk = blk.parentElement;
        while (blk.parentElement && blk.clientWidth < 160 && blk !== root) blk = blk.parentElement; // a box squeezed to a sliver is the bug, not the measure of a line
        const lineW = blk.clientWidth;
        const total = [...rg.getClientRects()].reduce((s, r) => s + r.width, 0);
        if (lineW && total > lineW * 1.02) continue;
        out.push({ rule: 'word-split', el: path(el, root), detail: `"${snip(m[0], 40)}" breaks after char ${at} (wrap ${getComputedStyle(el).overflowWrap})` });
      }
    }
    return out;
  }

  function check(kind, sels, o = {}) {
    const roots = [];
    for (const s of [].concat(sels)) document.querySelectorAll(s).forEach((e) => { if (vis(e) && !roots.includes(e) && !roots.some((r) => r.contains(e))) roots.push(e); });
    const bad = [];
    const add = (rule, root, el, detail) => bad.push({ rule, el: path(el, root), detail });
    if (!roots.length) return [{ rule: 'no-root', el: String(sels), detail: 'the surface is not on screen' }];
    for (const root of roots) {
      const all = [root, ...root.querySelectorAll('*')].filter(vis);
      const rr = root.getBoundingClientRect();
      const boxy = kind === 'dialog' || kind === 'popover' || kind === 'menu';
      for (const el of all) {
        const cs = getComputedStyle(el);
        const t = ownText(el);
        const isCtl = /^(BUTTON|INPUT|SELECT|TEXTAREA)$/.test(el.tagName);
        // size
        if ((t || (isCtl && (el.value || el.placeholder))) && parseFloat(cs.fontSize) < MIN_PX && shown(el)) add('font-size', root, el, `${cs.fontSize} "${snip(t || el.value || '', 40)}"`);
        // clipping
        const textish = (el.innerText || '').trim().length > 0;
        const clipX = textish && /(hidden|clip)/.test(cs.overflowX) && el.scrollWidth > el.clientWidth + 1 && !isCtl;
        if (clipX) {
          const titled = cs.textOverflow === 'ellipsis' && (el.getAttribute('title') || (el.closest('[title]') || {}).title);
          if (!titled) {
            if (cs.textOverflow === 'ellipsis' && !el.closest('.dpick')) add('todo-ellipsis-title', root, el, `T151/T154: ellipsis without its full text "${snip(el.innerText.trim(), 50)}"`);
            else add('clipped', root, el, `x: shows ${el.clientWidth}px of ${el.scrollWidth}px "${snip(el.innerText.trim(), 50)}"`);
          }
        }
        const clamp = cs.webkitLineClamp && cs.webkitLineClamp !== 'none';
        if (textish && /(hidden|clip)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 2 && !isCtl && !clamp) add('clipped', root, el, `y: shows ${el.clientHeight}px of ${el.scrollHeight}px "${snip(el.innerText.trim(), 50)}"`);
        // sideways scroll inside a dialog, popover or menu (screens: T154, reported as a todo)
        if ((boxy || /(auto|scroll|hidden|clip)/.test(cs.overflowX)) && el.scrollWidth > el.clientWidth + (/(auto|scroll|hidden|clip)/.test(cs.overflowX) ? 1 : 3) && /* content over a visible edge: under 3px is a rounding or focus-ring artifact (the inbox heading line is 2px over) */ !isCtl && !el.matches('textarea,input,select') && cs.display !== 'inline') {
          // a label cut with an ellipsis is not a scroll (the clipped rule asks for its title); anything else that overflows sideways is
          if (boxy) { if (!(cs.textOverflow === 'ellipsis' && /(hidden|clip)/.test(cs.overflowX))) add('x-scroll', root, el, `scrollWidth ${el.scrollWidth} > clientWidth ${el.clientWidth}`); }
          else if (/(auto|scroll)/.test(cs.overflowX)) add('todo-x-scroll', root, el, `T154: scrollWidth ${el.scrollWidth} > clientWidth ${el.clientWidth}`);
        }
        // a box that sticks out of its dialog / popover / menu (visible overflow)
        if (boxy && el !== root && shown(el) && (t || isCtl)) {
          const r = el.getBoundingClientRect();
          if (r.right > rr.right + 1 || r.left < rr.left - 1) add('x-scroll', root, el, `box ${Math.round(r.left)}..${Math.round(r.right)} outside ${Math.round(rr.left)}..${Math.round(rr.right)}`);
        }
        // field values: regular weight (400, 500 allowed)
        if (kind === 'dialog' && /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName) && !/^(checkbox|radio|button|submit|hidden)$/.test(el.type)) {
          if (parseInt(cs.fontWeight, 10) > 500) add('field-weight', root, el, `weight ${cs.fontWeight}`);
          if (el.placeholder) { const ph = getComputedStyle(el, '::placeholder'); if (parseInt(ph.fontWeight, 10) > 500) add('field-weight', root, el, `placeholder weight ${ph.fontWeight}`); }
        }
      }
      if (kind !== 'chat' && (rr.right > innerWidth + 1 || rr.bottom > innerHeight + 1 || rr.left < -1 || rr.top < -1)) add('offscreen', root, root, `box ${Math.round(rr.left)},${Math.round(rr.top)}..${Math.round(rr.right)},${Math.round(rr.bottom)} in ${innerWidth}x${innerHeight}`);
      bad.push(...brokenWords(root));

      if (kind === 'dialog' && root.classList.contains('dlg')) {
        // width: one of the three tokens, or the window minus 32px
        const toks = ['--dlg-w-s', '--dlg-w-m', '--dlg-w-l'].map((n) => ({ n, v: getComputedStyle(document.documentElement).getPropertyValue(n).trim() }));
        const px = toks.map((x) => (x.v ? probe(root, 'width', x.v) : NaN));
        const want = [420, 560, 760];
        px.forEach((v, i) => { if (Math.abs(v - Math.min(want[i], innerWidth - 32)) > 1) add('dialog-width', root, root, `${toks[i].n} is "${toks[i].v}" (${v}px), expected ${want[i]}px`); });
        const w = root.offsetWidth; // not the bounding box: the open animation (dlgin) scales it
        if (!px.some((v) => Math.abs(v - w) <= 1) && Math.abs(w - (innerWidth - 32)) > 1) add('dialog-width', root, root, `width ${Math.round(w)}px is none of ${px.map(Math.round).join('/')} (nor ${innerWidth - 32})`);
        // padding from the token (the palette has no padding on purpose: it is a search box)
        if (!root.classList.contains('pal-dlg')) {
          const pad = probe(root, 'padding', 'var(--dlg-pad)');
          const cs = getComputedStyle(root);
          const got = ['Top', 'Right', 'Bottom', 'Left'].map((k) => parseFloat(cs['padding' + k]));
          if (pad.some((v, i) => Math.abs(v - got[i]) > 0.5)) add('dialog-padding', root, root, `padding ${got.join(' ')} but --dlg-pad is ${pad.join(' ')}`);
        }
      }
      if (kind === 'popover' || kind === 'menu') {
        const cs = getComputedStyle(root);
        if (kind === 'popover' && root.scrollWidth > root.clientWidth + 1) add('x-scroll', root, root, `scrollWidth ${root.scrollWidth} > ${root.clientWidth}`);
      }
      if (o.dark) {
        for (const sel of DARK_CONTROLS) {
          const els = root.matches(sel) ? [root] : [...root.querySelectorAll(sel)];
          for (const c of els.filter(vis)) {
            const bg = backdrop(c);
            for (const e of [c, ...c.querySelectorAll('*')].filter(vis)) {
              const isField = /^(INPUT|SELECT|TEXTAREA)$/.test(e.tagName);
              if (!(ownText(e) || isField)) continue;
              const fg = rgba(getComputedStyle(e).color);
              const back = e === c ? bg : backdrop(e);
              const k = contrast(over(fg, back), back);
              if (k < 4.5) add('dark-contrast', root, e, `${k.toFixed(2)}:1 for ${sel} "${snip(ownText(e) || e.value || e.tagName.toLowerCase(), 30)}"`);
            }
          }
        }
      }
    }
    return bad;
  }

  /* PR2 hooks (T150-T155): present so the driver can call them; they report and are not asserted yet.
     TODO T150 orphan menu hints, T151 tooltip length, T154 long names, T155 chat overlap. */
  function pr2() {
    const tips = [];
    document.querySelectorAll('[title]').forEach((el) => { const t = (el.getAttribute('title') || '').trim(); if (t && vis(el)) tips.push({ el: desc(el), len: t.length }); });
    return { tooltips: tips.filter((x) => x.len > 120).length };
  }

  /* FR-165: help text uses one measure (--measure); paragraphs of the same section end at the same x (+-8px) */
  function measureRule() {
    const bad = [];
    const tok = getComputedStyle(document.documentElement).getPropertyValue('--measure').trim();
    const want = tok ? probe(document.body, 'width', tok) : NaN;
    if (Math.abs(want - 560) > 1) bad.push({ rule: 'measure', el: ':root', detail: `--measure is "${tok}", expected 560px` });
    const notes = [...document.querySelectorAll('#screen .scr-note')].filter(vis);
    for (const n of notes) {
      const mw = parseFloat(getComputedStyle(n).maxWidth);
      if (!(Math.abs(mw - want) <= 1)) bad.push({ rule: 'measure', el: path(n, document.body), detail: `max-width ${getComputedStyle(n).maxWidth} but --measure is ${want}px` });
    }
    const byParent = new Map();
    for (const n of notes) { if (n.getBoundingClientRect().height < 2 * parseFloat(getComputedStyle(n).lineHeight || 16)) continue; const k = n.parentElement; byParent.set(k, (byParent.get(k) || []).concat(n)); }
    for (const [par, list] of byParent) {
      const rights = list.map((n) => n.getBoundingClientRect().right);
      if (Math.max(...rights) - Math.min(...rights) > 8) bad.push({ rule: 'measure', el: path(par, document.body), detail: `paragraphs end at x ${rights.map(Math.round).join(', ')}` });
    }
    return bad;
  }

  window.__uitext = { check, measureRule, pr2, vis, darkControls: DARK_CONTROLS, measure: { probe, backdrop, contrast, rgba } };
})();
