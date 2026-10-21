/*
 * Check for spec 052 FR-141 (issue #367): grouped grant chips and a chat header whose chips flow. Simulator only (no AI credits).
 *
 *   npm run check:grant-chips
 *   OUT=docs/screenshots  (optional) also saves the screenshots
 *
 * `simgrants=many` gives the first agent eight session grants with long names. At 1440x900 and 1280x800, in Expert and in Simple:
 * exactly one "Allowed (8)" chip (a button, aria-expanded false); its list shows all eight with a revoke button each and the short
 * labels (full label in the title); Escape closes it and returns focus to the chip; a revoke keeps the list open with the focus on a
 * revoke button; Revoke all asks first. The header chips stay on at most two rows, the grants row is one chip tall, and nothing overlaps.
 * With 1-2 grants the single chips are back (first run only). A miss prints DRIVER FAILED (Electron still exits 0), so the npm script
 * exits non-zero unless "all checks passed" is printed.
 */
const path = require('path');
const assert = require('assert');
const { helpers, jsLiteral } = require('./driver-helpers');
const OUT = process.env.OUT || require('os').tmpdir();
const Q = { simgrants: 'many' };
module.exports = async (ctx) => {
  const H = helpers(ctx); // spec 008 FR-096/097: shared plumbing, waits for the page instead of a fixed time
  const { until, settle, js } = H;
  const shot = (name) => H.shot(path.join(OUT, name), { prep: 'mouse', tag: 'grant-chips' });
  const measure = () => js(`(()=>{
    const R=e=>e.getBoundingClientRect(), ph=document.getElementById('panelHead'), meta=ph.querySelector('.ph-meta'), g=document.getElementById('grants');
    const kids=[...meta.children].filter(c=>R(c).height>0&&getComputedStyle(c).visibility!=='hidden');
    const rows=Math.round((R(meta).height+4)/32); /* 28px chips with a 4px row gap */
    const rects=kids.map(c=>R(c));
    let overlap='';for(let i=0;i<rects.length;i++)for(let j=i+1;j<rects.length;j++){const a=rects[i],b=rects[j];if(a.left<b.right-0.5&&b.left<a.right-0.5&&a.top<b.bottom-0.5&&b.top<a.bottom-0.5)overlap+=kids[i].className+'/'+kids[j].className+' ';}
    const act=ph.querySelector('.actions'),ar=R(act);const mr=R(meta);
    const small=[...meta.querySelectorAll('*')].filter(e=>R(e).height>0&&e.childElementCount===0&&e.textContent.trim()&&parseFloat(getComputedStyle(e).fontSize)<10.5).length;
    const hs=[...ph.querySelectorAll('.ph-meta button,.ph-meta .mchip,.ph-meta .folder,.ph-meta .ctxchip,.actions .btn')].filter(e=>R(e).height>0).map(e=>Math.round(R(e).height));
    return {head:Math.round(R(ph).height),rows,overlap,metaRight:mr.right,actLeft:ar.left,metaOverActions:mr.left<ar.right-0.5&&mr.right>ar.left+0.5&&mr.top<ar.bottom-0.5&&mr.bottom>ar.top+0.5,
      grantsH:g.hidden?0:Math.round(R(g).height),small,maxCtl:Math.max(...hs),minCtl:Math.min(...hs),vw:innerWidth}})()`);
  let first = true;
  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    for (const level of ['expert', 'simple']) {
      await H.load({ w, h, query: Q, ready: 'fit', settle: false });
      await js(`localStorage.setItem('durbar.detail',${jsLiteral(level)})`); // remembered: reload so the office is drawn in it
      await H.load({ query: Q, ready: 'fit' });
      const tag = `${w} ${level}`;
      assert.ok(await js(`document.body.classList.contains('simple')===${level === 'simple'}`), `${tag}: the detail level is on`);
      let id = null;
      for (const end = Date.now() + 8000; !id && Date.now() < end;) { id = await js(`(()=>{for(const d of document.querySelectorAll('#stage .desk[data-id]')){d.click();const g=document.getElementById('grants');if(g&&!g.hidden)return d.dataset.id;const b=document.getElementById('backBtn');if(b)b.click();}return ''})()`); if (!id) await ctx.sleep(100); }
      assert.ok(id, `${tag}: an agent has grants in its chat`);
      await until(`!!document.getElementById('grantsBtn')`); await settle();
      // 1. one chip
      const c = await js(`(()=>{const g=document.getElementById('grants');const b=document.getElementById('grantsBtn');return {chips:g.querySelectorAll(':scope > .gchip').length,all:g.querySelectorAll('.gchip').length,text:b&&b.textContent.trim(),exp:b&&b.getAttribute('aria-expanded'),ctl:b&&b.getAttribute('aria-controls'),tag:b&&b.tagName,popHidden:document.getElementById('grantsPop').hidden,single:g.querySelectorAll('.gchip:not(.gchip-btn)').length}})()`);
      assert.strictEqual(c.chips, 1, `${tag}: exactly one Allowed chip: ${JSON.stringify(c)}`);
      assert.strictEqual(c.single, 0, `${tag}: no single grant chips beside it: ${JSON.stringify(c)}`);
      assert.ok(c.tag === 'BUTTON' && /^Allowed \(8\)/.test(c.text) && c.exp === 'false' && c.ctl === 'grantsPop' && c.popHidden, `${tag}: the chip is a closed button: ${JSON.stringify(c)}`);
      // 2. header geometry with the grants closed
      let m = await measure();
      assert.ok(m.rows <= 2, `${tag}: the header chips use at most two rows (${m.rows}): ${JSON.stringify(m)}`);
      assert.strictEqual(m.overlap, '', `${tag}: header chips overlap: ${m.overlap}`);
      assert.ok(!m.metaOverActions, `${tag}: the chips overlap the actions: ${JSON.stringify(m)}`);
      assert.ok(m.grantsH > 0 && m.grantsH <= 26, `${tag}: the grants row is one chip tall (${m.grantsH}px)`);
      assert.ok(m.head <= 170, `${tag}: the header stays compact (${m.head}px)`);
      assert.strictEqual(m.small, 0, `${tag}: no header text under 10.5px`);
      assert.ok(m.minCtl >= 22 && m.maxCtl <= 32, `${tag}: header control heights ${m.minCtl}-${m.maxCtl}`);
      if (level === 'expert') await shot(`052-grant-chips-closed-${w}x${h}.png`);
      if (level === 'simple') await shot(`052-grant-chips-simple-${w}x${h}.png`);
      // 3. open: all eight, revoke buttons, short labels
      await js(`document.getElementById('grantsBtn').click()`); await until(`!document.getElementById('grantsPop').hidden&&document.activeElement&&document.activeElement.dataset.revoke!==undefined`);
      const o = await js(`(()=>{const p=document.getElementById('grantsPop'),pr=p.getBoundingClientRect();const rows=[...p.querySelectorAll('.gp-row')];
        return {hidden:p.hidden,exp:document.getElementById('grantsBtn').getAttribute('aria-expanded'),list:p.querySelector('ul').getAttribute('role'),popRole:p.getAttribute('role'),popLabel:p.getAttribute('aria-label'),n:rows.length,
          revokes:rows.filter(r=>/^Revoke permission: /.test((r.querySelector('button')||{}).getAttribute&&r.querySelector('button').getAttribute('aria-label')||'')).length,
          texts:rows.map(r=>r.querySelector('.gp-t').textContent),titles:rows.map(r=>r.title),all:!!document.getElementById('grantsAll'),
          inside:pr.left>=0&&pr.right<=innerWidth&&pr.top>=0&&pr.bottom<=innerHeight,clipped:rows.some(r=>r.getBoundingClientRect().height<20),focus:document.activeElement&&document.activeElement.dataset.revoke!==undefined}})()`);
      assert.ok(o.popRole === 'group' && o.popLabel === 'Allowed for this session', `${tag}: the list is a named group: ${JSON.stringify({ role: o.popRole, label: o.popLabel })}`);
      assert.ok(!o.hidden && o.exp === 'true' && o.list === 'list', `${tag}: the list is open: ${JSON.stringify(o)}`);
      assert.strictEqual(o.n, 8, `${tag}: all eight grants are listed`);
      assert.strictEqual(o.revokes, 8, `${tag}: each row has a named revoke button`);
      assert.ok(o.all && o.inside && !o.clipped, `${tag}: Revoke all is there and the list is inside the window: ${JSON.stringify({ all: o.all, inside: o.inside })}`);
      assert.ok(o.focus, `${tag}: the focus moved into the list`);
      assert.ok(o.texts.includes('server-x › GetItem') && o.texts.includes('billing-service › create_invoice_draft') && o.texts.includes('calendar › CreateEvent'), `${tag}: short labels: ${o.texts.join(' | ')}`);
      assert.ok(o.texts.includes('billing-service › refund') && o.texts.includes('run: git status --short --branch'), `${tag}: other labels are unchanged`);
      assert.ok(o.titles[0].includes('server-x › server-x-GetItem'), `${tag}: the title keeps the full label: ${o.titles[0]}`);
      m = await measure();
      assert.ok(m.rows <= 2 && m.overlap === '', `${tag}: header unchanged with the list open: ${JSON.stringify(m)}`);
      if (level === 'expert' || w === 1440) await shot(`052-grant-chips-open-${level === 'simple' ? 'simple-' : ''}${w}x${h}.png`);
      // 4. Escape closes and returns focus to the chip
      await js(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}))`); await until(`document.getElementById('grantsPop').hidden&&document.activeElement.id==='grantsBtn'`);
      const e = await js(`({hidden:document.getElementById('grantsPop').hidden,exp:document.getElementById('grantsBtn').getAttribute('aria-expanded'),focus:document.activeElement.id})`);
      assert.ok(e.hidden && e.exp === 'false' && e.focus === 'grantsBtn', `${tag}: Escape closes the list and focuses the chip: ${JSON.stringify(e)}`);
      assert.ok(await js(`!!document.getElementById('panelHead')`), `${tag}: Escape did not leave the chat`);
      // 5. a revoke keeps the list open and the focus on a revoke button
      await js(`document.getElementById('grantsBtn').click()`); await until(`!document.getElementById('grantsPop').hidden`);
      await js(`document.querySelectorAll('#grantsPop [data-revoke]')[1].click()`); await until(`document.querySelectorAll('#grantsPop .gp-row').length===7&&document.activeElement&&document.activeElement.dataset.revoke!==undefined`);
      const r = await js(`({n:document.querySelectorAll('#grantsPop .gp-row').length,hidden:document.getElementById('grantsPop').hidden,focus:document.activeElement.dataset.revoke!==undefined,chip:document.getElementById('grantsBtn').textContent.trim()})`);
      assert.ok(r.n === 7 && !r.hidden && r.focus && /\(7\)/.test(r.chip), `${tag}: after a revoke seven remain, the list is open, focus on a revoke button: ${JSON.stringify(r)}`);
      // 6. click outside closes
      await js(`document.getElementById('chat').click()`); await until(`document.getElementById('grantsPop').hidden`);
      assert.ok(await js(`document.getElementById('grantsPop').hidden`), `${tag}: a click outside closes the list`);
      if (first) {
        first = false;
        // 7. down to two: single chips, then one, then none
        await js(`document.getElementById('grantsBtn').click()`); await until(`!document.getElementById('grantsPop').hidden`);
        const left = `(()=>{const p=document.getElementById('grantsPop');return p&&!p.hidden?p.querySelectorAll('.gp-row').length:document.querySelectorAll('#grants .gchip').length})()`;
        for (let n = 7; n > 2; n--) { await js(`document.querySelector('#grantsPop [data-revoke]').click()`); await until(`${left}===${n - 1}&&document.activeElement&&document.activeElement.dataset.revoke!==undefined`); }
        const two = await js(`(()=>{const g=document.getElementById('grants');return {btn:!!document.getElementById('grantsBtn'),chips:[...g.querySelectorAll('.gchip')].map(c=>c.firstElementChild.textContent),x:g.querySelectorAll('.gchip button[aria-label^="Revoke permission: "]').length,focus:document.activeElement.dataset.revoke!==undefined}})()`);
        assert.ok(!two.btn && two.chips.length === 2 && two.x === 2 && two.chips.every((t) => t.startsWith('Allowed: ')), `${tag}: two grants are two single chips: ${JSON.stringify(two)}`);
        assert.ok(two.focus, `${tag}: the focus stays on a revoke button after the list turns into chips`);
        await shot(`052-grant-chips-two-${w}x${h}.png`);
        await js(`document.querySelector('#grants [data-revoke]').click()`); await until(`document.querySelectorAll('#grants .gchip').length===1`);
        assert.strictEqual(await js(`document.querySelectorAll('#grants .gchip').length`), 1, `${tag}: one grant is one chip`);
        await js(`document.querySelector('#grants [data-revoke]').click()`); await until(`document.getElementById('grants').hidden&&document.activeElement.id==='msgInput'`);
        assert.ok(await js(`document.getElementById('grants').hidden`), `${tag}: no grants, no row`);
        assert.strictEqual(await js(`document.activeElement.id`), 'msgInput', `${tag}: after the last single chip is revoked the focus is on the composer, not <body>`);
      } else {
        // 8. Revoke all asks first: Cancel keeps them, the confirmation revokes them
        await js(`document.getElementById('grantsBtn').click()`); await until(`!document.getElementById('grantsPop').hidden`);
        await js(`document.getElementById('grantsAll').click()`); await until(`[...document.querySelectorAll('.dlg-ov button')].some(x=>x.textContent.trim()==='Cancel')`);
        const d = await js(`(()=>{const b=[...document.querySelectorAll('.dlg-ov button')].map(x=>x.textContent.trim());return b})()`);
        assert.ok(d.includes('Cancel') && d.includes('Revoke all'), `${tag}: Revoke all asks first: ${d}`);
        await js(`[...document.querySelectorAll('.dlg-ov button')].find(x=>x.textContent.trim()==='Cancel').click()`); await until(`!document.querySelector('.dlg-ov')`);
        assert.strictEqual(await js(`document.querySelectorAll('#grantsPop .gp-row').length`), 7, `${tag}: Cancel keeps the grants`);
        assert.strictEqual(await js(`document.getElementById('grantsBtn').getAttribute('aria-expanded')+'/'+document.getElementById('grantsPop').hidden`), 'true/false', `${tag}: Cancel keeps the list open, like Esc`);
        await js(`document.getElementById('grantsBtn').getAttribute('aria-expanded')==='true'||document.getElementById('grantsBtn').click()`); await until(`!document.getElementById('grantsPop').hidden`);
        await js(`document.getElementById('grantsAll').click()`); await until(`[...document.querySelectorAll('.dlg-ov button')].some(x=>x.textContent.trim()==='Revoke all')`);
        await js(`[...document.querySelectorAll('.dlg-ov button')].find(x=>x.textContent.trim()==='Revoke all').click()`);
        await until(`document.getElementById('grants').hidden&&document.activeElement.id==='msgInput'&&document.getElementById('srAnnounce').textContent==='All permissions revoked.'`);
        assert.ok(await js(`document.getElementById('grants').hidden`), `${tag}: Revoke all removes every grant`);
        assert.strictEqual(await js(`document.activeElement.id`), 'msgInput', `${tag}: after Revoke all the focus is on the composer, not <body>`);
        assert.strictEqual(await js(`document.getElementById('srAnnounce').textContent`), 'All permissions revoked.', `${tag}: it is announced`);
      }
      console.log('[grant-chips]', w, level, 'ok');
    }
  }
  // A Revoke all that fails (the revokes never remove anything) leaves the grants and the page working; after switching to an agent
  // without grants the focus is not taken and nothing is announced.
  await H.load({ w: 1440, h: 900, query: { simgrants: 'stuck' }, ready: 'fit' });
  let ids = null;
  for (const end = Date.now() + 8000; !(ids && ids[0]) && Date.now() < end;) { ids = await js(`(()=>{const d=[...document.querySelectorAll('#stage .desk[data-id]')];let a='';for(const x of d){x.click();const g=document.getElementById('grants');if(g&&!g.hidden){a=x.dataset.id;break;}const b=document.getElementById('backBtn');if(b)b.click();}return [a,d.map(x=>x.dataset.id).find(i=>i!==a)]})()`); if (!(ids && ids[0])) await ctx.sleep(100); }
  await until(`!!document.getElementById('grantsBtn')`); await settle();
  await js(`document.getElementById('grantsBtn').click()`); await until(`!document.getElementById('grantsPop').hidden`);
  await js(`document.getElementById('grantsAll').click()`); await until(`[...document.querySelectorAll('.dlg-ov button')].some(x=>x.textContent.trim()==='Revoke all')`);
  await js(`[...document.querySelectorAll('.dlg-ov button')].find(x=>x.textContent.trim()==='Revoke all').click()`); await ctx.sleep(100); // quick: inside the 1s the flag may live
  assert.strictEqual(await js(`document.querySelectorAll('#grantsPop .gp-row').length`), 8, 'stuck: a revoke that fails leaves the grants');
  await js(`document.getElementById('backBtn').click()`); await until(`!document.body.classList.contains('panel-open')&&!!document.querySelector(${jsLiteral(`#stage .desk[data-id="${ids[1]}"]`)})`);
  await js(`document.querySelector(${jsLiteral(`#stage .desk[data-id="${ids[1]}"]`)}).click()`); await until(`document.body.classList.contains('panel-open')&&!!document.getElementById('grants')`);
  await ctx.sleep(150); // the checks below are that nothing happens (no announcement, no focus move): give a late handler its chance
  assert.ok(await js(`document.getElementById('grants').hidden`), 'stuck: the other agent has no grants');
  assert.notStrictEqual(await js(`document.getElementById('srAnnounce').textContent`), 'All permissions revoked.', 'stuck: a failed Revoke all on one agent does not announce for another');
  assert.notStrictEqual(await js(`document.activeElement.id`), 'msgInput', 'stuck: the focus is not taken to the composer of another agent');
  console.log('[grant-chips] all checks passed');
};
