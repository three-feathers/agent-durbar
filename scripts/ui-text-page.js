/*
 * Page-side measuring for scripts/check-ui-text.js (spec 052 FR-171). Read by the driver and evaluated in the page; installs
 * window.__uitext. Read-only: it changes nothing on the page (its probes are removed again).
 *
 *   window.__uitext.check(kind, rootSelectors, o) -> [{rule, el, detail}]   the violations of the PR1 rules on the visible roots
 *   kind: 'dialog' | 'popover' | 'menu' | 'screen' | 'chat'
 *   o.dark: also check the contrast of the FR-169 controls
 *
 * Part 2 rules (T150-T155): orphan (a menu hint's last line is one word), menu-width, menu-hints (a menu has a hint on every item or on none),
 * tooltip-length (static titles 120, data titles 300 characters and 8 lines), ellipsis-title, label-wrap, kbd-align, x-scroll on screens,
 * popover-width (a popover is the S or M token wide, with --pop-pad), copy-overlap and caret-after-copy in the chat, heading-lines in the inbox; `pairs()` is the contrast of the rules that moved to theme tokens.
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
    '.capf input', '.plrow select', '.dlg label.pico-opt', '.ctxchip', '#capChip', '.sitem.attn.st-error', '.dlg.fs .mtag',
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

  /* ---- part 2 (T150-T155) ---- */
  /* the visual lines of an element's text: [{top, text}] */
  function textLines(el) {
    const chars = [];
    const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = tw.nextNode(); n; n = tw.nextNode()) {
      for (let i = 0; i < n.textContent.length; i++) {
        const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + 1);
        const cr = [...r.getClientRects()].find((x) => x.width > 0);
        chars.push({ c: n.textContent[i], top: cr ? Math.round(cr.top) : null });
      }
    }
    const lines = [];
    for (const ch of chars) {
      if (ch.top === null) { if (lines.length) lines[lines.length - 1].text += ch.c; continue; }
      const last = lines[lines.length - 1];
      if (last && Math.abs(last.top - ch.top) <= 3) last.text += ch.c; else lines.push({ top: ch.top, text: ch.c });
    }
    return lines.map((l) => ({ top: l.top, text: l.text.replace(/\s+/g, ' ').trim() })).filter((l) => l.text);
  }
  /* FR-165/FR-167: menus share one width and padding; a hint is one line or two even lines; a menu has a hint on every item or on none */
  function menuRules(root, add) {
    const tok = getComputedStyle(document.documentElement).getPropertyValue('--menu-w').trim();
    const want = tok ? probe(root, 'width', tok) : NaN;
    if (Math.abs(want - 320) > 1) add('menu-width', root, root, `--menu-w is "${tok}" (${want}px), expected 320px`);
    const w = root.offsetWidth;
    if (!(Math.abs(w - Math.min(want, innerWidth - 16)) <= 1)) add('menu-width', root, root, `width ${Math.round(w)}px but --menu-w is ${want}px`);
    const cs = getComputedStyle(root);
    const pads = ['Top', 'Right', 'Bottom', 'Left'].map((k) => parseFloat(cs['padding' + k]));
    if (pads.some((v) => Math.abs(v - 6) > 0.5)) add('menu-width', root, root, `padding ${pads.join(' ')}, expected 6px all round`);
    for (const sm of root.querySelectorAll('small')) {
      if (!vis(sm)) continue;
      const ls = textLines(sm);
      if (ls.length >= 2 && !/\s/.test(ls[ls.length - 1].text)) add('orphan', root, sm, `last line is one word "${ls[ls.length - 1].text}" in "${snip(ls.map((l) => l.text).join(' '), 70)}"`);
    }
    const items = [...root.querySelectorAll('.more-it')].filter(vis);
    const withHint = items.filter((i) => i.querySelector('small')).length;
    if (withHint && withHint < items.length) add('menu-hints', root, root, `${withHint} of ${items.length} items have a hint line (all or none)`);
  }
  /* FR-170 / T147: the body of a dialog (its paragraphs and lists, not its fields) is at most 8 lines at its width; more is split into a first paragraph and a list or a "More" */
  function bodyLines(root, add) {
    let n = 0;
    for (const el of root.querySelectorAll(':scope > p.dsub, :scope > ul.dlist, :scope > .dsub, :scope > .dlist')) {
      if (!vis(el)) continue;
      n += textLines(el).length;
    }
    if (n > 8) add('body-lines', root, root, `${n} lines of body text (limit 8)`);
  }
  /* FR-170: a field label is one short line */
  function labelWrap(root, add) {
    for (const lb of root.querySelectorAll('label')) {
      if (!vis(lb) || lb.matches('.chk,.pico-opt,.dpick,.tgl') || lb.closest('.imp-row')) continue; // a pick row of a list is not a field label
      const lead = [...lb.childNodes].filter((n) => (n.nodeType === 3 && n.textContent.trim()) || (n.nodeType === 1 && n.matches('span:not(.dpick-t)') && n.textContent.trim()));
      if (!lead.length) continue;
      const tops = new Set();
      for (const n of lead) { const r = document.createRange(); r.selectNodeContents(n); [...r.getClientRects()].filter((x) => x.width > 0).forEach((x) => tops.add(Math.round(x.top / 3))); }
      if (tops.size > 1) add('label-wrap', root, lb, `the label wraps to ${tops.size} lines "${snip(lead.map((n) => n.textContent).join('').trim(), 60)}"`);
    }
  }
  /* FR-170: the description columns of the shortcut sheet start at one x per column of the sheet */
  function kbdAlign(root, add) {
    for (const k of root.querySelectorAll('.kb-t .kb-k')) { // the key column is wide enough for its keys (a fixed layout with a too narrow column would align the tables and cut the keys)
      const w = [...k.children].reduce((n, c) => Math.max(n, c.getBoundingClientRect().right), 0) - k.getBoundingClientRect().left;
      const room = k.clientWidth - parseFloat(getComputedStyle(k).paddingRight);
      if (vis(k) && w > room + 1) add('kbd-align', root, k, `the keys need ${Math.round(w)}px but the key column has ${Math.round(room)}px`);
    }
    const byX = new Map();
    for (const t of root.querySelectorAll('.kb-t')) { const k = Math.round(t.getBoundingClientRect().left); byX.set(k, (byX.get(k) || []).concat(t)); }
    for (const [, tables] of byX) {
      const xs = tables.flatMap((t) => [...t.querySelectorAll('tr')].map((tr) => (tr.children[1] ? Math.round(tr.children[1].getBoundingClientRect().left * 10) / 10 : null)).filter((x) => x !== null));
      if (xs.length && Math.max(...xs) - Math.min(...xs) > 2) add('kbd-align', root, tables[0], `description columns start at x ${[...new Set(xs.map(Math.round))].join(', ')}`);
    }
  }
  /* FR-170: the Copy button never covers text; the streaming caret is not after it */
  /* FR-174 (#453): the composer placeholder is one line at the textarea's own width and its own wrapping rules; it names the agent the heading names; a shortened one ends in an ellipsis and is a prefix of the full text */
  function placeholderRule(root, add) {
    const t = root.querySelector('#msgInput'); if (!t || !vis(t) || !t.placeholder) return;
    const cs = getComputedStyle(t), pcs = getComputedStyle(t, '::placeholder');
    const w = t.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const m = document.createElement('div');
    m.style.cssText = `position:fixed;left:0;top:0;visibility:hidden;white-space:pre-wrap;overflow-wrap:${cs.overflowWrap};word-break:${cs.wordBreak};width:${w}px;font:${cs.font};letter-spacing:${pcs.letterSpacing};line-height:${cs.lineHeight}`;
    m.textContent = t.placeholder; document.body.appendChild(m);
    const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2, lines = Math.round(m.getBoundingClientRect().height / lh);
    m.remove();
    if (lines > 1) add('placeholder-line', root, t, `the placeholder "${snip(t.placeholder, 50)}" takes ${lines} lines in ${Math.round(w)}px`);
    const label = (t.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim(), head = document.getElementById('panelTitle');
    if (head && label !== 'Message ' + head.textContent.replace(/\s+/g, ' ').trim()) add('placeholder-line', root, t, `the composer is named "${snip(label, 50)}" but the heading says "${snip(head.textContent, 50)}"`);
    if (/[\ud800-\udbff](?![\udc00-\udfff])|(?:^|[^\ud800-\udbff])[\udc00-\udfff]/.test(t.placeholder)) add('placeholder-line', root, t, `the placeholder cuts a character in two: "${snip(t.placeholder, 50)}"`);
    { const a = Array.from(t.placeholder.replace(/\u2026$/, '')); let k = 0; while (k < a.length && /[\u{1F1E6}-\u{1F1FF}]/u.test(a[a.length - 1 - k])) k++; if (k % 2 === 1) add('placeholder-line', root, t, `the placeholder cuts a flag in two: "${snip(t.placeholder, 50)}"`); }
    if (t.placeholder !== label + '\u2026' && !(t.placeholder.endsWith('\u2026') && label.startsWith(t.placeholder.slice(0, -1).trimEnd()))) add('placeholder-line', root, t, `the shortened placeholder "${snip(t.placeholder, 50)}" has no ellipsis or is not the start of "${snip(label, 50)}"`);
  }
  /* FR-176 (#540): the answer bar's session name is one line cut with an ellipsis and titled with the whole name; the verb ("asks:", "needs your OK:", "stopped:") is fully visible; the bar does not overflow */
  function answerBarNameRule(root, add) {
    const bar = root.querySelector('#answerBar'); if (!bar || !vis(bar)) return;
    const q = bar.querySelector('.ab-q'), n = bar.querySelector('.ab-n'), lead = bar.querySelector('.ab-q b');
    if (!q || !n || !lead) { add('answer-bar-name', root, bar, 'the answer bar has no name span (.ab-n)'); return; }
    const full = n.textContent.trim(), cs = getComputedStyle(n);
    if (!full) add('answer-bar-name', root, n, 'the name span is empty');
    if (n.title !== n.textContent) add('answer-bar-name', root, n, `the name's title is "${snip(n.title, 50)}", not the full name "${snip(full, 50)}"`);
    if (n.scrollWidth > n.clientWidth + 1 && !(cs.textOverflow === 'ellipsis' && cs.overflow === 'hidden' && cs.whiteSpace === 'nowrap')) add('answer-bar-name', root, n, `the name "${snip(full, 50)}" is cut (${n.scrollWidth}px in ${n.clientWidth}px) with no ellipsis (text-overflow ${cs.textOverflow}, overflow ${cs.overflow}, white-space ${cs.whiteSpace})`);
    { // the START of the name is what shows (a right-to-left name starts at its right end: dir="auto" on the span)
      const t = n.firstChild, nr = n.getBoundingClientRect();
      if (t && t.nodeType === 3 && t.length) { const r = document.createRange(); r.setStart(t, 0); r.setEnd(t, 1); const c = r.getBoundingClientRect(); if (c.width > 0 && (c.left < nr.left - 1 || c.right > nr.right + 1)) add('answer-bar-name', root, n, `the first letter of the name is cut off (${Math.round(c.left)}..${Math.round(c.right)} in ${Math.round(nr.left)}..${Math.round(nr.right)}): the ellipsis must end the name, not hide its start (dir ${cs.direction}, dir attribute "${n.getAttribute('dir')}")`); }
      if (/[\u0590-\u08ff]/.test(full) && cs.direction !== 'rtl') add('answer-bar-name', root, n, `a right-to-left name has direction ${cs.direction}: dir="auto" is missing`);
    }
    const lh = parseFloat(getComputedStyle(q).lineHeight) || 18;
    if (n.getBoundingClientRect().height > lh * 1.5) add('answer-bar-name', root, n, `the name takes ${Math.round(n.getBoundingClientRect().height)}px: more than one line`);
    if (n.getBoundingClientRect().width > q.getBoundingClientRect().width * 0.55) add('answer-bar-name', root, n, `the name is ${Math.round(n.getBoundingClientRect().width)}px wide in a ${Math.round(q.getBoundingClientRect().width)}px lead: past about half`);
    const verb = lead.lastChild; // the text node after the name: "asks:" / "needs your OK:" / "stopped:"
    if (!verb || verb.nodeType !== 3 || !/(asks|stopped|needs your OK):$/.test(verb.textContent)) add('answer-bar-name', root, lead, 'the verb is not its own text after the name');
    else {
      const r = document.createRange(); r.selectNodeContents(verb); const qr = q.getBoundingClientRect();
      for (const b of r.getClientRects()) if (b.width > 0 && (b.right > qr.right + 1 || b.left < qr.left - 1 || b.bottom > qr.bottom + 1 || b.top < qr.top - 1)) { add('answer-bar-name', root, lead, `the verb "${verb.textContent.trim()}" is cut off: it ends at ${Math.round(b.right)}x${Math.round(b.bottom)}, the lead is ${Math.round(qr.right)}x${Math.round(qr.bottom)}`); break; }
    }
    const br = bar.getBoundingClientRect();
    if (bar.scrollWidth > bar.clientWidth + 1 || br.right > innerWidth + 1 || br.left < -1) add('answer-bar-name', root, bar, `the answer bar overflows: ${bar.scrollWidth}px of content in ${bar.clientWidth}px (right edge ${Math.round(br.right)} of ${innerWidth})`);
  }
  function chatRules(root, add) {
    placeholderRule(root, add);
    answerBarNameRule(root, add);
    { const id = root.querySelector('.ph-id'), sub = id && id.querySelector('.sub'); if (sub && vis(sub) && sub.getBoundingClientRect().right > id.getBoundingClientRect().right + 1) add('heading-spill', root, sub, `the role line "${snip(sub.textContent, 50)}" ends at ${Math.round(sub.getBoundingClientRect().right)}px, past the heading box at ${Math.round(id.getBoundingClientRect().right)}px`); }
    for (const b of root.querySelectorAll('.cp-btn,.md .copy')) {
      if (!vis(b)) continue;
      const ch = document.getElementById('chat'); // the text around it has to be on screen to be measured: only the chat scrolls, never the page
      if (ch && ch.contains(b)) ch.scrollTop += b.getBoundingClientRect().top - ch.getBoundingClientRect().top - ch.clientHeight / 2;
      const msg = b.closest('#chat,.chat-inner') || b.closest('.msg,.sub-prompt,.sub-res,.think,.codebox') || b.parentElement; // the whole chat: the button also sticks out of its bubble
      const br = b.getBoundingClientRect();
      const tw = document.createTreeWalker(msg, NodeFilter.SHOW_TEXT);
      for (let n = tw.nextNode(); n; n = tw.nextNode()) {
        const el = n.parentElement; if (!n.textContent.trim() || !el || el.closest('button') || !vis(el) || !shown(el)) continue;
        const r = document.createRange(); r.selectNodeContents(n);
        const hit = [...r.getClientRects()].find((x) => x.width > 1 && x.right > br.left + 1 && x.left < br.right - 1 && x.bottom > br.top + 1 && x.top < br.bottom - 1);
        if (hit) { add('copy-overlap', root, b, `the Copy button covers the text "${snip(n.textContent.trim(), 40)}"`); break; }
      }
    }
    for (const bub of root.querySelectorAll('.bubble.caret')) {
      const last = bub.lastElementChild;
      if (last && last.matches('.cp-btn')) add('caret-after-copy', root, bub, 'the streaming caret follows the Copy button');
    }
  }
  /* FR-170: Needs you heading: the name has its own line and a title; its status, folder and wait sit below */
  function inboxRules(root, add) {
    for (const h of root.querySelectorAll('.ib-h')) {
      if (!vis(h)) continue;
      const n = h.querySelector('.ib-n') || h.querySelector('b'), sub = h.querySelector('.ib-sub');
      if (!n || !sub) { add('heading-lines', root, h, 'no .ib-n / .ib-sub'); continue; }
      if (sub.getBoundingClientRect().top < n.getBoundingClientRect().bottom - 1) add('heading-lines', root, h, 'the status line is not under the name');
      if (!n.getAttribute('title')) add('ellipsis-title', root, n, `the name has no title "${snip(n.textContent, 40)}"`);
    }
  }

  function check(kind, sels, o = {}) {
    const roots = [];
    // each box once: a root that holds, or sits in, another is skipped
    for (const s of [].concat(sels)) document.querySelectorAll(s).forEach((e) => { if (vis(e) && !roots.some((r) => r === e || r.contains(e) || e.contains(r))) roots.push(e); });
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
        const clipX = textish && /(hidden|clip)/.test(cs.overflowX) && el.scrollWidth > el.clientWidth + 1 && (!isCtl || cs.textOverflow === 'ellipsis'); // a control cut with an ellipsis needs its title too
        if (clipX) {
          const titled = cs.textOverflow === 'ellipsis' && (el.getAttribute('title') || (el.closest('[title]') || {}).title);
          if (!titled) {
            if (cs.textOverflow === 'ellipsis' && !el.closest('.dpick')) add('ellipsis-title', root, el, `ellipsis without its full text in a title "${snip(el.innerText.trim(), 50)}"`);
            else add('clipped', root, el, `x: shows ${el.clientWidth}px of ${el.scrollWidth}px "${snip(el.innerText.trim(), 50)}"`);
          }
        }
        const clamp = cs.webkitLineClamp && cs.webkitLineClamp !== 'none';
        if (textish && /(hidden|clip)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 2 && !isCtl && !clamp) add('clipped', root, el, `y: shows ${el.clientHeight}px of ${el.scrollHeight}px "${snip(el.innerText.trim(), 50)}"`);
        // sideways scroll inside a dialog, popover or menu (screens: T154, reported as a todo)
        if ((boxy || /(auto|scroll|hidden|clip)/.test(cs.overflowX)) && el.scrollWidth > el.clientWidth + (/(auto|scroll|hidden|clip)/.test(cs.overflowX) ? 1 : 3) && /* content over a visible edge: under 3px is a rounding or focus-ring artifact (the inbox heading line is 2px over) */ !isCtl && !el.matches('textarea,input,select') && cs.display !== 'inline') {
          // a label cut with an ellipsis is not a scroll (the clipped rule asks for its title); anything else that overflows sideways is
          if (boxy) { if (!(cs.textOverflow === 'ellipsis' && /(hidden|clip)/.test(cs.overflowX))) add('x-scroll', root, el, `scrollWidth ${el.scrollWidth} > clientWidth ${el.clientWidth}`); }
          else if (/(auto|scroll)/.test(cs.overflowX) && !el.closest(MACHINE) && !el.matches('.strip-list')) /* the agent strip is a horizontal scroller by design (15 sessions in a row) */ add('x-scroll', root, el, `scrollWidth ${el.scrollWidth} > clientWidth ${el.clientWidth}`);
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
      if (kind === 'menu' && root.matches('.more-menu,.mode-menu')) menuRules(root, add);
      if (kind === 'dialog' && root.classList.contains('dlg')) bodyLines(root, add);
      if (kind === 'dialog') { labelWrap(root, add); if (root.matches('.kbd-dlg')) kbdAlign(root, add); }
      if (kind === 'chat') chatRules(root, add);
      if (root.matches('#inboxDlg,#inboxDlg *') || root.querySelector('.inbox-row')) inboxRules(root, add);

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
      if (kind === 'popover') {
        // T171: a name cut to a sliver is the bug even with a title (the Folders popover's first row sat beside a floated checkbox: "mc...")
        for (const el of root.querySelectorAll('*')) {
          if (!vis(el) || getComputedStyle(el).textOverflow !== 'ellipsis') continue;
          if (el.scrollWidth > el.clientWidth + 1 && el.clientWidth < 120) add('popover-squeezed', root, el, `"${snip(el.textContent, 30)}" is cut to ${el.clientWidth}px (scrollWidth ${el.scrollWidth})`);
        }
        // FR-167 (T169, issue #508): width is the S or M token (or the window minus 32px), padding is --pop-pad
        const rs = getComputedStyle(document.documentElement);
        const toks = [['--pop-w-s', 420], ['--pop-w-m', 660]].map(([n, want]) => ({ n, want, v: rs.getPropertyValue(n).trim() }));
        const px = toks.map((x) => (x.v ? probe(root, 'width', x.v) : NaN));
        px.forEach((v, i) => { if (Math.abs(v - Math.min(toks[i].want, innerWidth - 32)) > 1) add('popover-width', root, root, `${toks[i].n} is "${toks[i].v}" (${v}px), expected ${toks[i].want}px`); });
        const w = root.offsetWidth;
        if (!px.some((v) => Math.abs(v - w) <= 1) && Math.abs(w - (innerWidth - 32)) > 1) add('popover-width', root, root, `width ${Math.round(w)}px is none of ${px.map(Math.round).join('/')} (nor ${innerWidth - 32})`);
        // the assignment is fixed: Defaults and Allowed grants are S, Folders and Floors are M (a popover on the other size fails)
        const SIZE = { defaultsPop: 0, grantsPop: 0, foldersPop: 1, floorsPop: 1 };
        if (!(root.id in SIZE)) add('popover-width', root, root, `popover "${root.id || root.className}" is not in the S/M map (add it to SIZE in ui-text-page.js)`);
        else if (Math.abs(px[SIZE[root.id]] - w) > 1 && Math.abs(w - (innerWidth - 32)) > 1) add('popover-width', root, root, `${root.id} is ${Math.round(w)}px but must be ${toks[SIZE[root.id]].n} (${Math.round(px[SIZE[root.id]])}px)`);
        const want = probe(root, 'padding', 'var(--pop-pad)');
        const pcs = getComputedStyle(root);
        const got = ['Top', 'Right', 'Bottom', 'Left'].map((k) => parseFloat(pcs['padding' + k]));
        if (want.some((v, i) => Math.abs(v - got[i]) > 0.5) || want.join() !== '12,14,12,14') add('popover-width', root, root, `padding ${got.join(' ')} but --pop-pad is ${want.join(' ')} (expected 12 14 12 14)`);
      }
      if (kind === 'popover' || kind === 'menu') {
        const cs = getComputedStyle(root);
        if (kind === 'popover' && root.scrollWidth > root.clientWidth + 1) add('x-scroll', root, root, `scrollWidth ${root.scrollWidth} > ${root.clientWidth}`);
      }
      if (o.darkAll) {
        // the dark fixture: the text of EVERY visible element on the surface, so a bright box from a rule or from an inline style=
        // is found even when its control is not in DARK_CONTROLS. Disabled controls and faded boxes are exempt (WCAG).
        for (const e of all) {
          const isField = /^(INPUT|SELECT|TEXTAREA)$/.test(e.tagName);
          if (!(ownText(e) || isField) || !shown(e)) continue;
          if (e.disabled || e.closest('[aria-disabled="true"],.is-off,[disabled]')) continue;
          let faded = false; for (let a = e; a && !faded; a = a.parentElement) faded = parseFloat(getComputedStyle(a).opacity) < 0.9;
          if (faded) continue;
          const back = backdrop(e);
          const fg = rgba(getComputedStyle(e).color);
          const k = contrast(over(fg, back), back);
          if (k < 4.5) { const b = { rule: 'dark-text', el: path(e, root), detail: `${k.toFixed(2)}:1 "${snip(ownText(e) || e.value || e.tagName.toLowerCase(), 30)}"`, key: [e.parentElement, e].filter(Boolean).map((n) => desc(n).replace(/#[^.]*/, '')).join(' > ') }; bad.push(b); }
        }
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

  /* FR-168: a static tooltip explains a control in at most 120 characters; a data tooltip (the full text of a cut name, a card or the totals) may be
     longer, at most 300 characters and 8 lines. Whole page: chrome titles are not in a surface's root. */
  const DATA_TIP = '#panelTitle,.ph-id .sub,.name,.gchip,.gchip *,.gp-row,.ptask,.ab-q,.ab-q *,.q-opt,.place,.intent,.room-aiu,.chip,.chip *,.desk,.helper,.lrow,.lrow *,.sitem,.sitem *,#stats,#stats *,.stat-aiu,.room-head *,.room-path,.prev-row *,.pal-o *,.ib-n,.ib-f,.by-chip,.mdl-sub,.dpick-t,.hs-name b,.sc-t b,.grant,.chip.att-chip,.att,.cmdbox,.pill,.ph-t,.folder,.sub-title,.lmood,.tile,.ttab td,.ttab th,.sl-opt';
  function tooltips() {
    const out = [];
    document.querySelectorAll('[title]').forEach((el) => {
      const t = el.getAttribute('title') || '';
      if (!t.trim() || !vis(el)) return;
      const data = el.matches(DATA_TIP);
      const lines = t.split('\n').length;
      if (data ? (t.length > 300 || lines > 8) : t.length > 120) out.push({ rule: 'tooltip-length', el: desc(el), detail: `${data ? 'data' : 'static'} tooltip of ${t.length} characters${lines > 1 ? ', ' + lines + ' lines' : ''}: "${snip(t, 60)}"` });
    });
    return out;
  }

  /* the contrast of the rules that moved from literal light colours to theme tokens (T152, round 2). list: [{sel, bg, color, border?}] read from the CSS by the driver. */
  function pairs(list) {
    const out = [];
    const host = document.createElement('div');
    host.style.cssText = 'position:absolute;left:-9999px;top:0;width:10px;height:10px;color:var(--ink);background:var(--surface)';
    document.body.appendChild(host);
    const base = backdrop(host);
    for (const r of list) {
      const p = document.createElement('div');
      p.style.cssText = 'background:' + r.bg + ';color:' + (r.color || 'var(--ink)');
      host.appendChild(p);
      const cs = getComputedStyle(p);
      const bg = over(rgba(cs.backgroundColor), base);
      const fg = over(rgba(cs.color), bg);
      const k = contrast(fg, bg);
      if (k < 4.5) out.push({ rule: 'tone-contrast', el: r.sel, detail: `${k.toFixed(2)}:1 for text ${r.color || 'var(--ink) (inherited)'} on ${r.bg}` });
      p.remove();
    }
    host.remove();
    return out;
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

  window.__uitext = { check, measureRule, tooltips, pairs, vis, darkControls: DARK_CONTROLS, measure: { probe, backdrop, contrast, rgba } };
})();
