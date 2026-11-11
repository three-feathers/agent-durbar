/*
 * The chat in the world (spec 097 FR-106, T120): the simulator only, no real session, no account, no AI credits.
 *
 *   npm run build
 *   SHOTS_OUT=<dir> DURBAR_USER_DATA=$(mktemp -d) DURBAR_SIM=15 DURBAR_SIM_FREEZE=1 \
 *     DURBAR_DRIVER=$PWD/scripts/shots-097-chat.js npx electron .        (xvfb-run -a ... --no-sandbox on Linux)
 *
 * For the Photo office, the cave and the Retro arcade (MOMENTS_WORLDS, default photo; the arcade also at 1100x800) it fails (exit 1) when:
 *   - a desk-side column exists (the owner removed it on 2026-11-01) or the chat is not the window's width beside the 220px agent rail (spec 005 FR-190);
 *   - the header has no 32 px portrait with its lamp ring, dot and a cropped picture, or the lamp words ("Lamp warm, steady", ...) are not on the task line alone, whole beside a long task;
 *   - the tab order of the panel is not the flat office's (the same agent, same elements);
 *   - the panel surface is under 78 % opaque, or any text pair (title, lamp words, cards, hint) is under 4.5:1 against the composited surface (3:1 for large text);
 *   - text under 10.5 px;
 *   - (spec 102 RA6, T221, `retro`) a pending permission card of a waiting agent is not dark, or any text of any card of the chat (title, paragraphs, summary, buttons) is under 4.5:1 (3:1 large);
 *     the header's name is not on the marquee (a fill, the mark's yellow); the tab order differs from the flat office's for the same agent;
 *   - (#1144, FR-245) with Retro Pixel picked as the theme, a header button (.btn) in the Photo office has an offset box-shadow (the arcade's hard 3px shadow); the theme comes back after.
 * Screenshots: <SHOTS_OUT>/<world>-chat-<w>x<h>.png, <world>-chatlimit-<w>x<h>.png.
 */
const os = require('os');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { helpers, jsLiteral } = require('./driver-helpers');

const OUT = process.env.SHOTS_OUT || fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-097-chat-'));
const SIZES = [[1440, 900], [1280, 800]];
const sizesOf = (world) => (world === 'retro' ? [...SIZES, [1100, 800]] : SIZES); /* spec 102 T221: the arcade's chat also at 1100x800 */
const WORLDS = (process.env.MOMENTS_WORLDS || 'photo').split(',');

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { js } = H;
  const must = async (expr, what, ms = 15000) => assert.ok(await H.until(expr, ms), 'timed out waiting for ' + what);
  const REAL = `!!document.querySelector('#stage .ro .ro-plate')&&document.getElementById('stage').dataset.d==='real'`;
  const q = (world, extra = {}) => ({ officeview: 'real', ...(world === 'cave' || world === 'retro' ? { worldflags: world, world } : {}), ...extra });
  const open = async (name) => {
    await js(`(()=>{const p=[...document.querySelectorAll('#stage .ro-plate')].find(x=>x.textContent.startsWith(${jsLiteral(name)}));p.click()})()`);
    await must(`document.body.classList.contains('panel-open')&&!!document.getElementById('roPortrait')`, 'the chat of ' + name);
    await H.settle();
  };
  const tabOrder = () => js(`[...document.querySelectorAll('#panel button,#panel [href],#panel input,#panel textarea,#panel select,#panel [tabindex]:not([tabindex="-1"])')].filter(e=>!e.closest('.rail-list')&&e.getClientRects().length).map(e=>e.id||e.getAttribute('aria-label')||e.textContent.trim().slice(0,20)||e.tagName).join('|').replace(/ \\u00B7 \\d+s/g,'')`); /* a running turn's clock ("Thinking · 1s") moves between two loads */
  /* every text element of the panel and its pair against the composited surface behind it */
  const CONTRAST_OF = (deep) => `(()=>{const DEEP=${deep};const P=(c)=>{let m=/^color\\(srgb ([^)]+)\\)/.exec(c);if(m){const v=m[1].split(/[ \\/]+/).filter(Boolean).map(Number);return {r:v[0]*255,g:v[1]*255,b:v[2]*255,a:v.length>3?v[3]:1};}m=/rgba?\\(([^)]+)\\)/.exec(c);if(!m)return null;const v=m[1].split(/[ ,\\/]+/).filter(Boolean).map(Number);return {r:v[0],g:v[1],b:v[2],a:v.length>3?v[3]:1};};
    const bgOf=(e)=>{let acc={r:255,g:255,b:255};const st=[];for(let n=e;n;n=n.parentElement){const c=P(getComputedStyle(n).backgroundColor);if(c&&c.a>0)st.push(c);if(c&&c.a>=1)break;}
      for(const c of st.reverse())acc={r:c.r*c.a+acc.r*(1-c.a),g:c.g*c.a+acc.g*(1-c.a),b:c.b*c.a+acc.b*(1-c.a)};return acc;};
    const L=(c)=>{const f=(x)=>{x/=255;return x<=.03928?x/12.92:Math.pow((x+.055)/1.055,2.4)};return .2126*f(c.r)+.7152*f(c.g)+.0722*f(c.b)};
    const own=(e)=>[...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim());
    const els=[...document.querySelectorAll('#panelTitle,.ro-lampwords,#chat .note,.hint,#panel .ph-meta .pill'+(DEEP?',#chat .note *,#panel .ph *':''))].filter(e=>e.getClientRects().length&&e.textContent.trim()&&(!DEEP||own(e)||/^(note|hint|ro-lampwords)/.test(e.className)||e.id==='panelTitle'));
    const alpha=P(getComputedStyle(document.getElementById('panel')).backgroundColor).a;
    const bad=[];for(const e of els){const fg=P(getComputedStyle(e).color),bg=bgOf(e);const fa=fg.a;const f2={r:fg.r*fa+bg.r*(1-fa),g:fg.g*fa+bg.g*(1-fa),b:fg.b*fa+bg.b*(1-fa)};
      const l1=L(f2),l2=L(bg),r=(Math.max(l1,l2)+.05)/(Math.min(l1,l2)+.05);const px=parseFloat(getComputedStyle(e).fontSize),need=px>=24?3:4.5;
      if(r<need)bad.push((e.id||e.className||e.tagName)+' '+r.toFixed(2)+' < '+need);}
    return {alpha,n:els.length,bad,small:[...document.querySelectorAll('.ro-lampwords,#roPortrait')].filter(e=>e.children.length===0&&e.textContent.trim()&&parseFloat(getComputedStyle(e).fontSize)<10.5).length};})()`;
  const CONTRAST = CONTRAST_OF(false);

  for (const world of WORLDS) for (const [w, h] of sizesOf(world)) {
    const tag = `${world} ${w}x${h}`;
    await H.load({ w, h, query: q(world), ready: REAL, settle: false });
    await must(`[...document.querySelectorAll('#stage .ro img')].every(i=>i.complete)`, 'the pictures');
    await open('Mira');
    const st = await js(`(()=>{const pi=document.querySelector('.panel-in'),port=document.getElementById('roPortrait'),im=port&&port.querySelector('img');const rl=document.querySelector('#panel>.rail');return {col:!!document.querySelector('.ro-col,.rc-stage'),chat:pi.getBoundingClientRect().width,iw:innerWidth,rail:rl?rl.getBoundingClientRect().width:0,
      port:port&&[port.getBoundingClientRect().width,port.getBoundingClientRect().height],ring:port&&getComputedStyle(port).outlineStyle==='solid',dot:!!(port&&port.querySelector('.dot')),img:!!im,crop:!!(im&&im.style.left&&im.style.top),lamp:(document.querySelector('.ro-lampwords')||{}).textContent,where:[...document.querySelectorAll('.ro-lampwords')].map(e=>e.parentElement.className+'/'+(e.previousElementSibling||{}).className),headH:document.querySelector('.ph').getBoundingClientRect().height}})()`);
    assert.strictEqual(st.col, false, `${tag}: no desk-side column`);
    assert.strictEqual(st.rail, 220, `${tag}: the agent rail is on the left (spec 005 FR-190): ${st.rail}`);
    assert.strictEqual(Math.round(st.chat), st.iw - st.rail, `${tag}: the chat has the rest of the window's width (${st.chat})`);
    assert.deepStrictEqual(st.port, [32, 32], `${tag}: a 32 px portrait`);
    assert.deepStrictEqual(st.where, ['ph-line/ptask'], `${tag}: the lamp words on the task line, after the task, and nowhere else`);
    console.log('[097-chat]', tag, 'header', st.headH);
    /* a task too long for the line is cut; the lamp words stay whole */
    const cut = await js(`(()=>{const t=document.querySelector('.ph-line .ptask'),w=document.querySelector('.ro-lampwords'),was=t.textContent;t.textContent='A very long task '.repeat(40);const a=t.getBoundingClientRect(),b=w.getBoundingClientRect(),l=t.parentElement.getBoundingClientRect(),r={cut:t.scrollWidth>t.clientWidth,whole:w.scrollWidth<=w.clientWidth+1,inside:b.right<=l.right+1,after:b.left>=a.right-1};t.textContent=was;return r;})()`);
    assert.deepStrictEqual(cut, { cut: true, whole: true, inside: true, after: true }, `${tag}: a long task never hides the lamp words`);
    assert.ok(st.ring && st.dot && st.img && st.crop, `${tag}: portrait with lamp ring, dot and the cropped person: ${JSON.stringify(st)}`);
    assert.ok(/^Lamp (warm, steady|on, breathing|bright, amber screen|on, red screen|on, orange screen|low|off)/.test(st.lamp), `${tag}: lamp words in the header: ${st.lamp}`);
    const ct = await js(CONTRAST);
    assert.ok(ct.alpha >= 0.78, `${tag}: the panel surface is at least 78 % opaque (${ct.alpha})`);
    assert.deepStrictEqual(ct.bad, [], `${tag}: contrast of ${ct.n} text pairs`);
    assert.strictEqual(ct.small, 0, `${tag}: no text under 10.5px`);
    const tabsReal = await tabOrder();
    await shot(world, 'chat', w, h);
    if (world === 'retro') {
      /* spec 102 T221: the name on the marquee; every text of the cards, deep, 4.5:1; a waiting agent's permission card is dark */
      const mq = await js(`(()=>{const t=document.getElementById('panelTitle'),c=getComputedStyle(t);return {bg:c.backgroundColor,img:c.backgroundImage,outline:c.outlineStyle+' '+c.outlineWidth,ink:c.color,px:parseFloat(c.fontSize),font:c.fontFamily}})()`);
      assert.ok(mq.ink === 'rgb(255, 236, 39)' && /mono/i.test(mq.font) && mq.px >= 10.5, `${tag}: the header's name is the mark's yellow, mono: ${JSON.stringify(mq)}`);
      /* issue #1429 (T305): no black rectangle behind the name: its own fill is none, so it shows the panel's surface (a fill of the bar's black did not match it) */
      assert.ok(mq.bg === 'rgba(0, 0, 0, 0)' && mq.img === 'none' && /^none/.test(mq.outline), `${tag}: the header's name has no fill of its own, so it sits on the panel's colour: ${JSON.stringify(mq)}`);
      const deep = await js(CONTRAST_OF(true));
      assert.deepStrictEqual(deep.bad, [], `${tag}: contrast of ${deep.n} text elements of the header and the cards (deep)`);
      await js(`document.getElementById('backBtn').click()`);
      await must(`!document.body.classList.contains('panel-open')`, 'back to the office');
      await must(REAL, 'the office');
      const waiting = await js(`window.__durbarSimUi.agents().filter(a=>a.state==='waiting').map(a=>a.name)`);
      assert.ok(waiting.length > 0, `${tag}: a waiting agent in the simulator`);
      await open(waiting[0]);
      await must(`!!document.querySelector('#chat .note.perm:not(.settled)')`, 'the pending permission card');
      await js(`document.querySelector('#chat .note.perm:not(.settled)').scrollIntoView({block:'center'})`);
      const card = await js(`(()=>{const c=document.querySelector('#chat .note.perm:not(.settled)'),s=getComputedStyle(c);const m=/rgba?\\((\\d+), (\\d+), (\\d+)/.exec(s.backgroundColor);return {bg:s.backgroundColor,lum:m?(0.2126*+m[1]+0.7152*+m[2]+0.0722*+m[3])/255:1,btns:c.querySelectorAll('.btn').length}})()`);
      assert.ok(card.lum < 0.2 && card.btns >= 2, `${tag}: the permission card is dark and has its buttons: ${JSON.stringify(card)}`);
      const cd = await js(CONTRAST_OF(true));
      assert.deepStrictEqual(cd.bad, [], `${tag}: contrast of ${cd.n} text elements with the permission card open`);
      assert.strictEqual(cd.small, 0, `${tag}: no text under 10.5px with the card open`);
      await shot(world, 'chatperm', w, h);
    }
    await js(`document.getElementById('backBtn').click()`);
    await must(`!document.body.classList.contains('panel-open')`, 'back to the office');
    await must(REAL, 'the office');
    await open('Omar');
    await must(`!!document.querySelector('#chat .note.limit')`, 'the limit card');
    await js(`document.querySelector('#chat .note.limit').scrollIntoView({block:'center'})`);
    if (world === 'retro') {
      /* review of #1283: the limit state's header chip (.ctxchip.high on --bad-bg) and its card, measured too */
      const lim = await js(CONTRAST_OF(true));
      assert.deepStrictEqual(lim.bad, [], `${tag}: contrast of ${lim.n} text elements at the limit`);
      const chip = await js(`(()=>{const c=document.querySelector('.ctxchip.high');return c?{bg:getComputedStyle(c).backgroundColor,shown:c.getClientRects().length>0}:null})()`);
      assert.ok(chip && chip.shown, `${tag}: the limit chip is shown (and measured above): ${JSON.stringify(chip)}`);
    }
    await shot(world, 'chatlimit', w, h);
    // tab order equal to the flat office's for the same agent
    if (world === 'photo' || world === 'retro') {
      await js(`localStorage.setItem('durbar.officeview','flat')`);
      await H.load({ w, h, query: { sim: '15', officeview: 'flat' }, settle: false });
      await js(`(()=>{const d=[...document.querySelectorAll('#stage .desk[data-id]')].find(x=>x.innerText.trim().startsWith('Mira'));d.click()})()`);
      await must(`document.body.classList.contains('panel-open')`, 'the flat chat');
      await H.settle();
      assert.strictEqual(await tabOrder(), tabsReal, `${tag}: the panel's tab order (outside the agent strip, whose states move) is the flat one`);
      assert.ok(!(await js(`!!document.querySelector('.ro-col,#roPortrait')`)), `${tag}: flat has neither column nor portrait`);
    }

    /* #1144 (spec 097 FR-245): Retro Pixel's hard offset shadow on .btn never reaches the Photo office */
    if (world === 'photo') {
      const pickTheme = async (id) => {
        await H.js(`document.getElementById('settingsBtn').click()`);
        const sel = `#thList [data-theme="${id}"]`;
        await must(`!!document.querySelector(${jsLiteral(sel)})`, 'theme ' + id + ' in Settings');
        await js(`document.querySelector(${jsLiteral(sel)}).click()`);
        await must(`window.THEME.current().id===${jsLiteral(id)}`, 'theme ' + id + ' applied');
        await js(`window.DurbarScreens.close()`);
        await H.settle();
      };
      await H.load({ w, h, query: q(world), ready: REAL, settle: false });
      const was = await js(`window.THEME.current().id`);
      await pickTheme('retro');
      await open('Mira');
      const sh = await js(`(()=>{const b=[...document.querySelectorAll('#panel .btn')].filter(e=>e.getClientRects().length);return {ui:document.documentElement.dataset.ui,n:b.length,shadows:b.map(e=>getComputedStyle(e).boxShadow).filter(x=>x&&x!=='none')}})()`);
      await pickTheme(was);
      assert.ok(sh.n > 0, `${tag}: the chat header has buttons (${sh.n})`);
      assert.deepStrictEqual([sh.ui, sh.shadows], ['clean', []], `${tag}: Retro Pixel theme in the Photo office: plain UI style and no offset shadow on .btn`);
      /* spec 102 T221 (review of #1283): the arcade's mono marquee name is the world's alone. The Retro Pixel THEME in the flat office also has data-ui="retro"; its
         chat name keeps what main gave it: no font-family of its own on .ph h2, so the header's inherited one, not the mono display font */
      await js(`localStorage.setItem('durbar.officeview','flat')`);
      await H.load({ w, h, query: { sim: '15', officeview: 'flat' }, settle: false });
      await pickTheme('retro');
      await js(`(()=>{const d=[...document.querySelectorAll('#stage .desk[data-id]')].find(x=>x.innerText.trim().startsWith('Mira'));d.click()})()`);
      await must(`document.body.classList.contains('panel-open')`, 'the flat chat in Retro Pixel');
      await H.settle();
      const rp = await js(`(()=>{const h=document.getElementById('panelTitle'),e=document.documentElement;return {ui:e.dataset.ui,world:e.dataset.world||null,h2:getComputedStyle(h).fontFamily,ph:getComputedStyle(h.parentElement).fontFamily,display:getComputedStyle(e).getPropertyValue('--ui-display').trim()}})()`);
      assert.strictEqual(rp.ui, 'retro', `${tag}: the Retro Pixel theme is shown (data-ui retro)`);
      assert.strictEqual(rp.world, null, `${tag}: no world in the flat office`);
      assert.strictEqual(rp.h2, rp.ph, `${tag}: Retro Pixel theme, flat office: the chat name's font is the header's own, as on main: ${JSON.stringify(rp)}`);
      assert.notStrictEqual(rp.h2, rp.display, `${tag}: and not the arcade's mono display font`);
      await pickTheme(was);
    }
  }
  async function shot(world, name, w, h) { await H.shot(path.join(OUT, `${world}-${name}-${w}x${h}.png`), { prep: 'calm', settle: true, tag: 'chat', what: `${world}-${name}-${w}x${h}` }); }
};
