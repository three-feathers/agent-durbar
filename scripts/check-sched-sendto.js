/*
 * Spec 044 FR-020, FR-021 (issue #371): in the Schedules dialog the "Send to" and "Limit" labels stay on one line and are not
 * covered by the control next to them, and the "This session (...)" option shows a short name (title = the full name).
 * Simulator only (no AI credits). Linux with xvfb-run:
 *
 *   npm run check:sched-sendto
 *
 * At 1440x900 and 1280x800, in Simple and Expert, at the dialog's usual width and at a narrow one (340 px), with a session
 * whose name is a long sentence. A miss prints DRIVER FAILED (Electron still exits 0), so the npm script exits non-zero unless
 * "all checks passed" is printed.
 */
const assert = require('assert');
const path = require('path');
const INDEX = path.join(__dirname, '..', 'dist', 'renderer', 'index.html');
const LONG = 'Rename public tool find_company and update every call site and the docs index'; // simtitles=1 gives one main agent this title
const CAP = 40;

module.exports = async (ctx) => {
  const js = async (c) => {
    const r = await ctx.js(`(()=>{try{return {v:(${c})}}catch(e){return {err:String(e&&e.stack||e).slice(0,300)}}})()`);
    if (r.err) throw new Error('renderer: ' + r.err + ' in ' + String(c).slice(0, 80));
    return r.v;
  };
  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    ctx.win.setContentSize(w, h);
    for (const level of ['simple', 'expert']) {
      // the detail level is a stored display preference (localStorage), read at load
      await ctx.win.loadFile(INDEX, { query: { sim: '15', simfreeze: '1', simtitles: '1' } });
      await js(`localStorage.setItem('durbar.detail',${JSON.stringify(level)})`);
      await ctx.win.loadFile(INDEX, { query: { sim: '15', simfreeze: '1', simtitles: '1' } });
      await ctx.waitFor(`document.querySelectorAll('#stage .desk[data-id]').length>=15`, 15000);
      await ctx.sleep(900);
      await js(`(()=>{const s=document.createElement('style');s.textContent='#toasts{display:none!important}';document.head.appendChild(s);return true})()`);
      assert.strictEqual(await js(`document.body.classList.contains('simple')`), level === 'simple', 'detail level ' + level);
      for (const width of [0, 340]) {
        const id = await js(`(()=>{const d=[...document.querySelectorAll('#stage .desk[data-id]')].find(x=>x.textContent.includes('Rename public tool'));if(!d)throw new Error('no desk with the long title');d.click();return d.dataset.id})()`);
        await ctx.sleep(600);
        await js(`document.getElementById('schedHdrBtn').click()`); await ctx.sleep(300);
        assert.ok(await js(`!!document.getElementById('scTarget')`), 'Send to is there');
        if (width) await js(`document.querySelector('#schedDlg .dlg').style.width='${width}px'`);
        await ctx.sleep(150);
        const r = await js(`(()=>{
          const box=e=>{const b=e.getBoundingClientRect();return {l:b.left,r:b.right,t:b.top,b:b.bottom,h:b.height}};
          const lh=e=>parseFloat(getComputedStyle(e).lineHeight)||parseFloat(getComputedStyle(e).fontSize)*1.3;
          const row=(lbl,ctl)=>{const L=document.querySelector(lbl),C=document.querySelector(ctl);return {label:L.textContent,lh:lh(L),lb:box(L),cb:box(C),vis:L.getClientRects().length>0}};
          const sel=document.getElementById('scTarget'), o=sel.options[1];
          return {to:row('.sc-to .sc-lbl','#scTarget'),cap:row('#scCapL .sc-lbl','#scCap'),opt:o.textContent,title:o.title,val:o.value,id:${JSON.stringify(id)}}})()`);
        const tag = `${w}x${h} ${level} ${width || 'full'}`;
        for (const k of ['to', 'cap']) {
          const x = r[k];
          if (k === 'cap' && !x.vis) continue; // Limit only shows when the folder's agent has a spending unit
          assert.ok(x.lb.h <= x.lh * 1.5, `${tag}: "${x.label}" label is one line (height ${x.lb.h}, line ${x.lh})`);
          const overlap = x.lb.l < x.cb.r - 0.5 && x.cb.l < x.lb.r - 0.5 && x.lb.t < x.cb.b - 0.5 && x.cb.t < x.lb.b - 0.5;
          assert.ok(!overlap, `${tag}: "${x.label}" label is not covered by its control`);
        }
        assert.ok(r.cap.vis, `${tag}: the Limit row is shown in the simulator`);
        const inner = r.opt.replace(/^This session \(/, '').replace(/\)$/, '');
        assert.ok(inner.length <= CAP + 1, `${tag}: session option text is ${inner.length} characters: ${inner}`);
        assert.ok(inner.endsWith('…'), `${tag}: ends with an ellipsis`);
        assert.strictEqual(r.title, LONG, `${tag}: the title is the full name`);
        assert.strictEqual(r.val, r.id, `${tag}: the option value is the session id`);
        console.log('[sched-sendto]', tag, 'ok', JSON.stringify({ label: r.to.lb.h, opt: inner }));
        if (!width) await ctx.shot(path.join(process.env.OUT || '/tmp', `044-sendto-${level}-${w}x${h}.png`));
        await js(`document.getElementById('scClose').click()`); await ctx.sleep(200);
        await js(`document.getElementById('backBtn').click()`); await ctx.sleep(300);
      }
    }
  }
  console.log('[sched-sendto] all checks passed');
};
