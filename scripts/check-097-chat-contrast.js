/*
 * Chat text against the real pixels behind it, in Real office (spec 097 Changes 2026-11-05, issue #1146; FR-106, FR-113, FR-233's "no text on a
 * picture, checked by a driver at both sizes"). The simulator only: no real session, no account, no AI credits.
 *
 *   npm run build
 *   SHOTS_OUT=<dir> DURBAR_USER_DATA=$(mktemp -d) DURBAR_SIM=15 DURBAR_SIM_FREEZE=1 \
 *     DURBAR_DRIVER=$PWD/scripts/check-097-chat-contrast.js npx electron .        (xvfb-run -a ... --no-sandbox on Linux)
 *   node scripts/ui-suite.js --only check-097-chat-contrast
 *
 * How it measures: every glyph in the chat panel is made transparent (one style rule, nothing else changes) and the window is captured, so
 * the pixels inside each line of text are exactly what is behind that text: a surface, a chip's fill, or a picture. Each line's own colour
 * (its computed `color`, times the opacity of it and its ancestors) is blended over those pixels and its contrast taken at every second
 * device pixel; the line's figure is the 5th percentile (one antialiased border pixel does not decide it, a picture behind the text does).
 *
 * At 1440x900 and 1280x800, for a main session's chat (with a reply that has a link and code) and a helper's chat, it fails (exit 1) when:
 *   - a line of body text, a link or a code chip is under 4.5:1, or large text (24 px, or 18.66 px bold) under 3:1 (WCAG AA, constitution);
 *   - a header line ends past the window's right edge (the stats line of #1146 was clipped there);
 *   - a kind of text the check exists for is missing (no line measured, no link, no code chip), so it cannot pass by measuring nothing.
 * Prints each chat's worst lines. Screenshots: <SHOTS_OUT>/chatcontrast-<main|helper>-<w>x<h>.png and the glyph-free captures (-bg).
 * CONTRAST_MUTANT=ro (the helper panel gets the Real office root's class again, #1164's bug) or =clear (the chat's surfaces transparent):
 * both must fail on the 4.5:1 assert; =nohide (the rule that makes the glyphs transparent never applies, as when a capture is a frame from before it) must fail on
 * "the glyph-free frame was captured", never read as a contrast of 1.00:1; used to show the check can fail.
 *
 * The glyph-free capture (#1301, spec 008 FR-184): `capturePage()` can return the compositor's previous frame, one that still shows the text, under load (on Linux CI
 * every line then measured 1.00:1: the text blended over itself). The same call that hides the glyphs adds a 4x4 magenta marker in the window's top right corner; the
 * capture is repeated until that marker is in it, so the frame measured is one drawn after the hiding, and fails (it never measures) when none comes in 15 s.
 */
const os = require('os');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { helpers, jsLiteral } = require('./driver-helpers');

const OUT = process.env.SHOTS_OUT || fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-097-chatcontrast-'));
fs.mkdirSync(OUT, { recursive: true });
const SIZES = [[1440, 900], [1280, 800]];
const MUTANT = process.env.CONTRAST_MUTANT || '';

/* sRGB relative luminance and WCAG contrast */
const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const lum = (r, g, b) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

/* The lines of text in the panel, in CSS px: one entry per text node's client rect that shows (inside the window and its scroller, not
   covered: the element at the rect's middle is its own element or inside it) */
const LINES = `(()=>{const out=[],p=document.getElementById('panel'),W=innerWidth,H=innerHeight;
  const tw=document.createTreeWalker(p,NodeFilter.SHOW_TEXT,{acceptNode:n=>n.nodeValue.trim()?NodeFilter.FILTER_ACCEPT:NodeFilter.FILTER_REJECT});
  for(let n=tw.nextNode();n;n=tw.nextNode()){
    const e=n.parentElement,cs=getComputedStyle(e);if(cs.visibility!=='visible'||e.closest('[aria-hidden="true"],svg,textarea,input,select'))continue;
    let op=1;for(let x=e;x&&x!==document.documentElement;x=x.parentElement)op*=parseFloat(getComputedStyle(x).opacity);if(op<0.05)continue;
    const r=document.createRange();r.selectNodeContents(n);
    for(const q of r.getClientRects()){
      if(q.width<3||q.height<6)continue;
      const mx=q.left+q.width/2,my=q.top+q.height/2;
      if(mx<0||my<0||my>=H)continue;
      const hit=document.elementFromPoint(Math.min(W-1,mx),my);if(!hit||!(hit===e||e.contains(hit)||hit.contains(e)))continue;
      const kind=e.closest('a[href]')?'link':e.closest('code,kbd,pre,.chip-code,.tcode')?'code':e.closest('#panel .phead,#panel header,#panelHead,.panel-head')?'header':'body';
      const fs=parseFloat(cs.fontSize),fw=parseInt(cs.fontWeight,10)||400;
      out.push({t:n.nodeValue.trim().slice(0,40),kind,x:q.left,y:q.top,w:q.width,h:q.height,right:q.right,color:cs.color,op,large:fs>=24||(fs>=18.66&&fw>=700),cls:(e.className&&e.className.baseVal===undefined?e.className:'').toString().slice(0,30)});
    }
  }
  return out;})()`;
const MARK = 4; // the marker's side in CSS px
const HIDE_CSS = MUTANT === 'nohide' ? '' : '#panel,#panel *{color:transparent!important;-webkit-text-fill-color:transparent!important;text-shadow:none!important;caret-color:transparent!important;text-decoration-color:transparent!important}';
const MARK_CSS = `position:fixed;top:0;right:0;width:${MARK}px;height:${MARK}px;background:#ff00ff;z-index:2147483647;pointer-events:none`;
const HIDE_ON = `(()=>{const s=document.createElement('style');s.id='cc-hide';s.textContent=${jsLiteral(HIDE_CSS)};document.head.appendChild(s);
  const m=document.createElement('div');m.id='cc-mark';m.style.cssText=${jsLiteral(MARK_CSS)};document.body.appendChild(m);return true})()`;
const HIDE_OFF = `(()=>{for(const id of ['cc-hide','cc-mark']){const s=document.getElementById(id);if(s)s.remove();}return true})()`;
/* the marker's colour, read from a capture: BGRA bitmap, a pixel well inside the marker */
const hasMark = (img, s) => {
  const { width: iw, height: ih } = img.getSize();
  const x = Math.min(iw - 1, Math.floor(iw - (MARK / 2) * s)), y = Math.min(ih - 1, Math.floor((MARK / 2) * s)), i = (y * iw + x) * 4, b = img.toBitmap();
  return b[i + 2] > 240 && b[i + 1] < 16 && b[i] > 240;
};
const MUTATE = {
  ro: `(()=>{const pi=document.querySelector('#panel .panel-in');pi.classList.add('ro');return pi.classList.contains('ro')})()`,
  clear: `(()=>{const s=document.createElement('style');s.textContent='#panel,#panel *{background-color:transparent!important}html[data-world] body{background:url(realoffice/worlds/photo/floor.webp) center/cover!important}';document.head.appendChild(s);return true})()`,
};

function parseColor(s) {
  const m = /rgba?\(([^)]+)\)/.exec(s);
  if (!m) return null;
  const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
  return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
}

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { js } = H;
  const must = async (expr, what, ms = 15000) => assert.ok(await H.until(expr, ms), 'timed out waiting for ' + what);
  const REAL = `!!document.querySelector('#stage .ro .ro-plate')&&document.getElementById('stage').dataset.d==='real'`;
  const openChat = async (id, name) => {
    await js(`window.__durbarSimUi.crew.openPanel(${jsLiteral(id)})`);
    await must(`document.body.classList.contains('panel-open')&&(document.getElementById('panelTitle')||{}).textContent===${jsLiteral(name)}`, 'the chat of ' + name);
    await H.settle();
  };
  const back = async () => { await js(`document.getElementById('backBtn').click()`); await must(`!document.body.classList.contains('panel-open')`, 'back to the office'); };

  /** every line of text in the open chat, with its contrast against the pixels behind it */
  const measure = async (file) => {
    const lines = await js(LINES);
    await js(HIDE_ON);
    const vw = await js('innerWidth');
    let img = null;
    for (const end = Date.now() + 15000; Date.now() < end;) {
      await js(`new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r(true))))`);
      const c = await ctx.win.webContents.capturePage();
      if (hasMark(c, c.getSize().width / vw)) { img = c; break; }
      await ctx.sleep(50);
    }
    await js(HIDE_OFF);
    assert.ok(img, 'the glyph-free frame was captured: no capture showed the marker added with the hiding of the text in 15 s (#1301)');
    fs.writeFileSync(file, img.toPNG());
    const { width: iw, height: ih } = img.getSize(), bmp = img.toBitmap(); // BGRA
    const s = iw / vw;
    return lines.map((l) => {
      const c = parseColor(l.color), a = c ? c.a * l.op : 0, vals = [];
      for (let y = Math.max(0, Math.floor(l.y * s)); y < Math.min(ih, Math.ceil((l.y + l.h) * s)); y += 2)
        for (let x = Math.max(0, Math.floor(l.x * s)); x < Math.min(iw, Math.ceil((l.x + l.w) * s)); x += 2) {
          if (x >= iw - MARK * s && y < MARK * s) continue; // the marker's own pixels
          const i = (y * iw + x) * 4, br = bmp[i + 2], bg = bmp[i + 1], bb = bmp[i];
          const fr = a * c.r + (1 - a) * br, fg = a * c.g + (1 - a) * bg, fb = a * c.b + (1 - a) * bb;
          vals.push(ratio(lum(fr, fg, fb), lum(br, bg, bb)));
        }
      vals.sort((p, q) => p - q);
      return { ...l, n: vals.length, p5: vals.length ? vals[Math.floor(vals.length * 0.05)] : 0, min: vals[0] || 0 };
    });
  };

  for (const [w, h] of SIZES) {
    const tag = `${w}x${h}`;
    await H.load({ w, h, query: { officeview: 'real' }, ready: REAL, settle: false });
    await must(`[...document.querySelectorAll('#stage .ro img')].every(i=>i.complete)`, 'the pictures');
    const pair = await js(`(()=>{const all=window.__durbarSimUi.agents();const k=all.find(a=>a.parent&&a.live&&all.some(m=>m.id===a.parent&&!m.parent));if(!k)return null;const m=all.find(x=>x.id===k.parent);return {main:{id:m.id,name:m.name},helper:{id:k.id,name:k.name}};})()`);
    assert.ok(pair, `${tag}: the simulator has a main session with a live helper`);
    /* a reply with a link and inline code, so that both are measured */
    await js(`(()=>{const E=e=>window.__durbarSimEmit(Object.assign({timestamp:Date.now(),sessionId:${jsLiteral(pair.main.id)}},e));E({type:'output',final:true,text:'Read [the registry notes](https://example.com/registry) first, then run \`npm test\` in \`src/tools\`.'});})()`);
    const worst = {};
    for (const [who, a] of [['main', pair.main], ['helper', pair.helper]]) {
      await openChat(a.id, a.name);
      if (who === 'main') await must(`!!document.querySelector('#panel a[href*="example.com/registry"]')`, 'the reply with a link');
      if (MUTATE[MUTANT] && who === (MUTANT === 'ro' ? 'helper' : who)) assert.ok(await js(MUTATE[MUTANT]), 'the mutant applies');
      await H.settle();
      await H.shot(path.join(OUT, `chatcontrast-${who}-${tag}.png`), { settle: true, tag: 'chatcontrast', what: `${who} ${a.name} ${tag}` });
      const res = await measure(path.join(OUT, `chatcontrast-${who}-${tag}-bg.png`));
      const kinds = {};
      for (const l of res) kinds[l.kind] = (kinds[l.kind] || 0) + 1;
      console.log('[097-chatcontrast]', tag, who, 'lines', res.length, JSON.stringify(kinds));
      assert.ok(res.length >= 10, `${tag}: the ${who} chat has lines of text to measure (${res.length})`);
      assert.ok(kinds.body > 0 && kinds.code > 0, `${tag}: the ${who} chat has body text and code chips measured (${JSON.stringify(kinds)})`);
      if (who === 'main') assert.ok(kinds.link > 0, `${tag}: a link is measured in the main chat (${JSON.stringify(kinds)})`);
      const low = res.filter((l) => l.n && l.p5 < (l.large ? 3 : 4.5));
      const sorted = [...res].sort((p, q) => p.p5 - q.p5).slice(0, 5);
      console.log('[097-chatcontrast]', tag, who, 'worst', sorted.map((l) => `${l.kind} "${l.t}" ${l.p5.toFixed(2)} (min ${l.min.toFixed(2)}, ${l.color})`).join(' | '));
      worst[who] = low.map((l) => `${l.kind} "${l.t}" ${l.p5.toFixed(2)}:1 on ${l.color} (.${l.cls})`);
      const vw = await js('innerWidth');
      const clipped = res.filter((l) => l.kind === 'header' && l.right > vw + 0.5).map((l) => `"${l.t}" ends at ${l.right.toFixed(0)}`);
      assert.deepStrictEqual(clipped, [], `${tag}: the ${who} chat's header text ends inside the window`);
      await back();
    }
    assert.deepStrictEqual(worst, { main: [], helper: [] }, `${tag}: chat text at least 4.5:1 (large 3:1) against the pixels behind it`);
  }
  console.log('[097-chatcontrast] ok');
};
