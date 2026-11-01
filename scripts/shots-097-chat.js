/*
 * The chat in the world (spec 097 FR-106, T120): the simulator only, no real session, no account, no AI credits.
 *
 *   npm run build
 *   SHOTS_OUT=<dir> DURBAR_USER_DATA=$(mktemp -d) DURBAR_SIM=15 DURBAR_SIM_FREEZE=1 \
 *     DURBAR_DRIVER=$PWD/scripts/shots-097-chat.js npx electron .        (xvfb-run -a ... --no-sandbox on Linux)
 *
 * For the Photo office and the cave (MOMENTS_WORLDS, default photo) at 1440x900, 1280x800 and 1100x800 it fails (exit 1) when:
 *   - the desk-side column is missing at 1200 px or wider, is 300 px (1440) or 250 px (1280) wide, is not aria-hidden or holds a focusable element, or is drawn at 1100 px;
 *   - the chat beside it is under 480 px, or a window 1200 px or wider whose panel would leave the chat under 480 px still draws the column;
 *   - the header has no 64 px portrait with its lamp ring and dot, or no lamp words ("Lamp warm, steady", ...) in its meta line;
 *   - the tab order of the panel is not the flat office's (the same agent, same elements);
 *   - the panel surface is under 78 % opaque, or any text pair (title, plate, lamp words, cards, hint) is under 4.5:1 against the composited surface (3:1 for large text);
 *   - a pending card has no speech tail with the column shown, or has one without it; text under 10.5 px.
 * Screenshots: <SHOTS_OUT>/<world>-chat-<w>x<h>.png, <world>-chatlimit-<w>x<h>.png.
 */
const os = require('os');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { helpers, jsLiteral } = require('./driver-helpers');

const OUT = process.env.SHOTS_OUT || fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-097-chat-'));
const SIZES = [[1440, 900], [1280, 800], [1100, 800]];
const WORLDS = (process.env.MOMENTS_WORLDS || 'photo').split(',');

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { js } = H;
  const must = async (expr, what, ms = 15000) => assert.ok(await H.until(expr, ms), 'timed out waiting for ' + what);
  const REAL = `!!document.querySelector('#stage .ro .ro-plate')&&document.getElementById('stage').dataset.d==='real'`;
  const q = (world, extra = {}) => ({ officeview: 'real', ...(world === 'cave' ? { worldflags: 'cave', world: 'cave' } : {}), ...extra });
  const open = async (name) => {
    await js(`(()=>{const p=[...document.querySelectorAll('#stage .ro-plate')].find(x=>x.textContent.startsWith(${jsLiteral(name)}));p.click()})()`);
    await must(`document.body.classList.contains('panel-open')&&!!document.getElementById('roPortrait')`, 'the chat of ' + name);
    await H.settle();
  };
  const tabOrder = () => js(`[...document.querySelectorAll('#panel button,#panel [href],#panel input,#panel textarea,#panel select,#panel [tabindex]:not([tabindex="-1"])')].filter(e=>!e.closest('.ro-col,.strip-list')&&e.getClientRects().length).map(e=>e.id||e.getAttribute('aria-label')||e.textContent.trim().slice(0,20)||e.tagName).join('|').replace(/ \u00B7 \d+s/g,'')`); /* a running turn's clock ("Thinking · 1s") moves between two loads */
  /* every text element of the panel and its pair against the composited surface behind it */
  const CONTRAST = `(()=>{const P=(c)=>{let m=/^color\\(srgb ([^)]+)\\)/.exec(c);if(m){const v=m[1].split(/[ \\/]+/).filter(Boolean).map(Number);return {r:v[0]*255,g:v[1]*255,b:v[2]*255,a:v.length>3?v[3]:1};}m=/rgba?\\(([^)]+)\\)/.exec(c);if(!m)return null;const v=m[1].split(/[ ,\\/]+/).filter(Boolean).map(Number);return {r:v[0],g:v[1],b:v[2],a:v.length>3?v[3]:1};};
    const bgOf=(e)=>{let acc={r:255,g:255,b:255};const st=[];for(let n=e;n;n=n.parentElement){const c=P(getComputedStyle(n).backgroundColor);if(c&&c.a>0)st.push(c);if(c&&c.a>=1)break;}
      for(const c of st.reverse())acc={r:c.r*c.a+acc.r*(1-c.a),g:c.g*c.a+acc.g*(1-c.a),b:c.b*c.a+acc.b*(1-c.a)};return acc;};
    const L=(c)=>{const f=(x)=>{x/=255;return x<=.03928?x/12.92:Math.pow((x+.055)/1.055,2.4)};return .2126*f(c.r)+.7152*f(c.g)+.0722*f(c.b)};
    const els=[...document.querySelectorAll('#panelTitle,.ro-lampwords,.rc-plate b,.rc-l2,.rc-l3,#chat .note,.hint,#panel .ph-meta .pill')].filter(e=>e.getClientRects().length&&e.textContent.trim());
    const alpha=P(getComputedStyle(document.getElementById('panel')).backgroundColor).a;
    const bad=[];for(const e of els){const fg=P(getComputedStyle(e).color),bg=bgOf(e);const fa=fg.a;const f2={r:fg.r*fa+bg.r*(1-fa),g:fg.g*fa+bg.g*(1-fa),b:fg.b*fa+bg.b*(1-fa)};
      const l1=L(f2),l2=L(bg),r=(Math.max(l1,l2)+.05)/(Math.min(l1,l2)+.05);const px=parseFloat(getComputedStyle(e).fontSize),need=px>=24?3:4.5;
      if(r<need)bad.push((e.id||e.className||e.tagName)+' '+r.toFixed(2)+' < '+need);}
    return {alpha,n:els.length,bad,small:[...document.querySelectorAll('.ro-col *,.ro-lampwords,#roPortrait')].filter(e=>e.children.length===0&&e.textContent.trim()&&parseFloat(getComputedStyle(e).fontSize)<10.5).length};})()`;

  for (const world of WORLDS) for (const [w, h] of SIZES) {
    const tag = `${world} ${w}x${h}`;
    await H.load({ w, h, query: q(world), ready: REAL, settle: false });
    await must(`[...document.querySelectorAll('#stage .ro img')].every(i=>i.complete)`, 'the pictures');
    await open('Mira');
    const colWanted = w >= 1200;
    const st = await js(`(()=>{const c=document.querySelector('.ro-col'),pi=document.querySelector('.panel-in'),port=document.getElementById('roPortrait');return {col:!!c,w:c&&c.getBoundingClientRect().width,aria:c&&c.getAttribute('aria-hidden'),foc:c?c.querySelectorAll('button,a,input,[tabindex]').length:0,chat:pi.getBoundingClientRect().width,
      port:port&&[port.getBoundingClientRect().width,port.getBoundingClientRect().height],ring:port&&getComputedStyle(port).boxShadow!=='none',dot:!!(port&&port.querySelector('.dot')),img:!!(port&&port.querySelector('img')),lamp:(document.querySelector('.ro-lampwords')||{}).textContent,surface:c&&c.dataset.surface,
      person:!!document.querySelector('.rc-person'),desk:!!document.querySelector('.rc-desk')}})()`);
    assert.strictEqual(st.col, colWanted, `${tag}: the column is drawn exactly when the window is 1200 px or wider`);
    assert.deepStrictEqual(st.port, [64, 64], `${tag}: a 64 px portrait`);
    assert.ok(st.ring && st.dot && st.img, `${tag}: portrait with lamp ring, dot and the person`);
    assert.ok(/^Lamp (warm, steady|on, breathing|bright, amber call light|on, red error light|on, orange call light|low|off)/.test(st.lamp), `${tag}: lamp words in the header: ${st.lamp}`);
    if (colWanted) {
      assert.strictEqual(Math.round(st.w), w >= 1440 ? 300 : 250, `${tag}: column width`);
      assert.ok(st.aria === 'true' && st.foc === 0 && st.person && st.desk, `${tag}: decorative column with the person and the desk: ${JSON.stringify(st)}`);
      assert.ok(st.chat >= 480, `${tag}: the chat keeps 480 px: ${st.chat}`);
    }
    const ct = await js(CONTRAST);
    assert.ok(ct.alpha >= 0.78, `${tag}: the panel surface is at least 78 % opaque (${ct.alpha})`);
    assert.deepStrictEqual(ct.bad, [], `${tag}: contrast of ${ct.n} text pairs`);
    assert.strictEqual(ct.small, 0, `${tag}: no text under 10.5px`);
    const tabsReal = await tabOrder();
    await shot(world, 'chat', w, h);
    // the 480 px rule: a window 1200 px or wider whose panel would leave the chat under 480 px has no column
    if (w === 1280) {
      await js(`document.getElementById('panel').style.maxWidth='700px';window.dispatchEvent(new Event('resize'))`);
      await must(`!document.querySelector('.ro-col')`, 'the column dropped (700 - 250 < 480)');
      await js(`document.getElementById('panel').style.maxWidth='740px';window.dispatchEvent(new Event('resize'))`);
      await must(`!!document.querySelector('.ro-col')`, 'the column back (740 - 250 = 490)');
      await js(`document.getElementById('panel').style.maxWidth='';window.dispatchEvent(new Event('resize'))`);
    }
    // the cards point a speech tail at the person, only with the column
    await js(`document.getElementById('backBtn').click()`);
    await must(`!document.body.classList.contains('panel-open')`, 'back to the office');
    await must(REAL, 'the office');
    await open('Omar');
    await must(`!!document.querySelector('#chat .note.limit')`, 'the limit card');
    const tail = await js(`getComputedStyle(document.querySelector('#chat .note.limit'),'::before').content`);
    assert.strictEqual(tail !== 'none' && tail !== 'normal', colWanted, `${tag}: the card's speech tail only with the column (${tail})`);
    await js(`document.querySelector('#chat .note.limit').scrollIntoView({block:'center'})`);
    await shot(world, 'chatlimit', w, h);
    // tab order equal to the flat office's for the same agent
    if (world === 'photo') {
      await js(`localStorage.setItem('durbar.officeview','flat')`);
      await H.load({ w, h, query: { sim: '15', officeview: 'flat' }, settle: false });
      await js(`(()=>{const d=[...document.querySelectorAll('#stage .desk[data-id]')].find(x=>x.innerText.trim().startsWith('Mira'));d.click()})()`);
      await must(`document.body.classList.contains('panel-open')`, 'the flat chat');
      await H.settle();
      assert.strictEqual(await tabOrder(), tabsReal, `${tag}: the panel's tab order (outside the agent strip, whose states move) is the flat one`);
      assert.ok(!(await js(`!!document.querySelector('.ro-col,#roPortrait')`)), `${tag}: flat has neither column nor portrait`);
    }
  }
  async function shot(world, name, w, h) { await H.shot(path.join(OUT, `${world}-${name}-${w}x${h}.png`), { prep: 'calm', settle: true, tag: 'chat', what: `${world}-${name}-${w}x${h}` }); }
};
