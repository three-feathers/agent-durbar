/*
 * Spec 044 FR-020, FR-021 (issue #371): in the Schedules dialog the "Send to" and "Limit" labels stay on one line and are not
 * covered by the control next to them, and every option of "Send to" fits the select (a native select cuts text hard, no ellipsis), and the chosen session's full name shows on a hint line under it.
 * Simulator only (no AI credits). Linux with xvfb-run:
 *
 *   npm run check:sched-sendto
 *
 * At 1440x900, 1280x800 and 900x700, in Simple and Expert, at the dialog's usual width and at a narrow one (340 px), with a session
 * whose name is a long sentence. A miss prints DRIVER FAILED (Electron still exits 0), so the npm script exits non-zero unless
 * "all checks passed" is printed.
 */
const assert = require('assert');
const path = require('path');
const { helpers, jsLiteral } = require('./driver-helpers');
const LONG = 'Rename public tool find_company and update every call site and the docs index'; // simtitles=1 gives one main agent this title

module.exports = async (ctx) => {
  const H = helpers(ctx); // spec 008 FR-096/097: shared plumbing, waits for the page instead of a fixed time
  const { until, settle } = H;
  // stays local, not the shared js: it wraps the page code in try/catch and reports the page's own stack
  const js = async (c) => {
    const r = await ctx.js(`(()=>{try{return {v:(${c})}}catch(e){return {err:String(e&&e.stack||e).slice(0,300)}}})()`);
    if (r.err) throw new Error('renderer: ' + r.err + ' in ' + String(c).slice(0, 80));
    return r.v;
  };
  for (const [w, h] of [[1440, 900], [1280, 800], [900, 700]]) {
    ctx.win.setContentSize(w, h);
    for (const level of ['simple', 'expert']) {
      // the detail level is a stored display preference (localStorage), read at load
      await H.load({ query: { simtitles: '1' }, settle: false });
      await js(`localStorage.setItem('durbar.detail',${jsLiteral(level)})`);
      await H.load({ query: { simtitles: '1' }, settle: false });
      await until(`[...document.querySelectorAll('#stage .desk[data-id]')].some(x=>x.textContent.includes('Rename public tool'))`); await settle();
      await H.calm();
      assert.strictEqual(await js(`document.body.classList.contains('simple')`), level === 'simple', 'detail level ' + level);
      for (const width of [0, 340]) {
        const id = await js(`(()=>{const d=[...document.querySelectorAll('#stage .desk[data-id]')].find(x=>x.textContent.includes('Rename public tool'));if(!d)throw new Error('no desk with the long title');d.click();return d.dataset.id})()`);
        await until(`document.body.classList.contains('panel-open')&&!!document.getElementById('schedHdrBtn')`); await settle();
        await js(`document.getElementById('schedHdrBtn').click()`); await until(`!!document.getElementById('scTarget')`);
        assert.ok(await js(`!!document.getElementById('scTarget')`), 'Send to is there');
        if (width) await js(`document.querySelector('#schedDlg .dlg').style.width='${width}px'`);
        await settle();
        const r = await js(`(()=>{
          const box=e=>{const b=e.getBoundingClientRect();return {l:b.left,r:b.right,t:b.top,b:b.bottom,h:b.height}};
          const lh=e=>parseFloat(getComputedStyle(e).lineHeight)||parseFloat(getComputedStyle(e).fontSize)*1.3;
          const row=(lbl,ctl)=>{const L=document.querySelector(lbl),C=document.querySelector(ctl);return {label:L.textContent,lh:lh(L),lb:box(L),cb:box(C),vis:L.getClientRects().length>0}};
          const sel=document.getElementById('scTarget'), cs=getComputedStyle(sel), hint=document.getElementById('scToHint');
          const cv=document.createElement('canvas').getContext('2d'); cv.font=cs.fontStyle+' '+cs.fontWeight+' '+cs.fontSize+' '+cs.fontFamily;
          const inner=sel.clientWidth-parseFloat(cs.paddingLeft)-parseFloat(cs.paddingRight)-22; /* 22: the arrow */
          const opts=[...sel.options].map(o=>({text:o.textContent,w:cv.measureText(o.textContent).width,val:o.value}));
          const hint0={hidden:hint.hidden};
          sel.value=sel.options[1].value; sel.dispatchEvent(new Event('change'));
          const hb=box(hint), db=box(document.querySelector('#schedDlg .dlg'));
          const hint1={hidden:hint.hidden,title:hint.title,text:hint.textContent,l:hb.l,r:hb.r,dl:db.l,dr:db.r,fs:parseFloat(getComputedStyle(hint).fontSize),desc:sel.getAttribute('aria-describedby')};
          sel.value=''; sel.dispatchEvent(new Event('change'));
          const hint2={hidden:hint.hidden};
          return {to:row('.sc-to .sc-lbl','#scTarget'),cap:row('#scCapL .sc-lbl','#scCap'),opts,inner,hint0,hint1,hint2,id:${jsLiteral(id)}}})()`);
        const tag = `${w}x${h} ${level} ${width || 'full'}`;
        for (const k of ['to', 'cap']) {
          const x = r[k];
          if (k === 'cap' && !x.vis) continue; // Limit only shows when the folder's agent has a spending unit
          assert.ok(x.lb.h <= x.lh * 1.5, `${tag}: "${x.label}" label is one line (height ${x.lb.h}, line ${x.lh})`);
          const overlap = x.lb.l < x.cb.r - 0.5 && x.cb.l < x.lb.r - 0.5 && x.lb.t < x.cb.b - 0.5 && x.cb.t < x.lb.b - 0.5;
          assert.ok(!overlap, `${tag}: "${x.label}" label is not covered by its control`);
        }
        assert.ok(r.cap.vis, `${tag}: the Limit row is shown in the simulator`);
        for (const o of r.opts) assert.ok(o.w <= r.inner, `${tag}: option "${o.text}" is ${Math.round(o.w)}px, the select shows ${Math.round(r.inner)}px`);
        assert.deepStrictEqual(r.opts.map((o) => o.text), ["This folder's agent", 'This session'], `${tag}: short option texts`);
        assert.strictEqual(r.opts[1].val, r.id, `${tag}: the option value is the session id`);
        assert.strictEqual(r.hint0.hidden, true, `${tag}: no hint while "This folder's agent" is chosen`);
        assert.strictEqual(r.hint1.hidden, false, `${tag}: the hint shows for "This session"`);
        assert.strictEqual(r.hint1.title, LONG, `${tag}: the hint's title is the full name`);
        assert.strictEqual(r.hint1.text, LONG, `${tag}: the hint holds the name (cut by CSS only)`);
        assert.ok(r.hint1.l >= r.hint1.dl && r.hint1.r <= r.hint1.dr + 0.5, `${tag}: the hint stays inside the dialog`);
        assert.ok(r.hint1.fs >= 10.5, `${tag}: hint text is at least 10.5px`);
        assert.strictEqual(r.hint1.desc, 'scToHint', `${tag}: the select is described by the hint`);
        assert.strictEqual(r.hint2.hidden, true, `${tag}: the hint hides again`);
        console.log('[sched-sendto]', tag, 'ok', JSON.stringify({ label: r.to.lb.h, optW: r.opts.map((o) => Math.round(o.w)), selW: Math.round(r.inner) }));
        if (!width) await ctx.shot(path.join(process.env.OUT || '/tmp', `044-sendto-${level}-${w}x${h}.png`));
        await js(`document.getElementById('scClose').click()`); await until(`!document.getElementById('schedDlg')`);
        await js(`document.getElementById('backBtn').click()`); await until(`!document.body.classList.contains('panel-open')`); await settle();
      }
    }
  }
  console.log('[sched-sendto] all checks passed');
};
