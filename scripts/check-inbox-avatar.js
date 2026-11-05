/*
 * Check for spec 052 Changes 2026-11-04 (issue #1174): no avatar in the Needs you dialog grows past its box, so the rows and the first
 * Allow button are in view. Simulator only (no AI credits).   npm run check:ui -- --only check-inbox-avatar
 *
 * At 1440x900 and 1280x800, in the default and the Retro Pixel theme, in the flat office, in Real office, and in Real office
 * before its own stylesheet (realoffice.css, loaded lazily) has arrived: opens the inbox and asserts
 *  - every avatar svg/img in the dialog (rows and the header's faces) is at most 40 px square;
 *  - the first request's Allow button is inside the dialog's box and inside the window, and elementFromPoint at its centre hits it.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { helpers, jsLiteral } = require('./driver-helpers');
const OUT = process.env.SHOTS_OUT || fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-inbox-avatar-'));
const MAX = 40;
module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { until, settle, js } = H;
  const READY = { flat: 'fit', real: `!!document.querySelector('#stage .ro .ro-plate')&&document.getElementById('stage').dataset.d==='real'` };
  const probe = () => js(`(()=>{const R=e=>e.getBoundingClientRect(),d=document.querySelector('#inboxDlg .inbox-dlg');if(!d)return null;
    const els=[...new Set([...d.querySelectorAll('.ib-av svg,.ib-av img,.ibw-face svg,.ibw-face img,.ibw-face>*,.ib-av>*')].map(e=>e.closest('.ro-face')||e))];
    /* spec 097 (#1193): a Real office face is a cropped picture in a clipping circle; the visible face is the .ro-face box, which must clip and fit its holder */
    const av=els.map(e=>{const r=R(e),cs=getComputedStyle(e),box=e.classList.contains('ro-face')?e.parentElement:null,b=box&&R(box);return {w:Math.round(r.width),h:Math.round(r.height),ro:!!box,clip:!!box&&cs.overflow==='hidden'&&parseFloat(cs.borderTopLeftRadius)>0,fit:!!box&&r.left>=b.left-1&&r.right<=b.right+1&&r.top>=b.top-1&&r.bottom<=b.bottom+1};});
    const b=d.querySelector('.inbox-row .ib-ans .btn');if(!b)return {av,btn:null};const r=R(b),x=r.left+r.width/2,y=r.top+r.height/2,dr=R(d),hit=document.elementFromPoint(x,y);
    return {av,dlg:{t:Math.round(dr.top),b:Math.round(dr.bottom),h:Math.round(dr.height)},btn:{label:b.textContent,x:Math.round(x),y:Math.round(y),hit:!!hit&&(hit===b||b.contains(hit)),inDlg:y>dr.top&&y<dr.bottom&&x>dr.left&&x<dr.right,inWin:y>0&&y<innerHeight&&x>0&&x<innerWidth}};})()`);
  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    for (const view of ['flat', 'real', 'real-nocss']) {
      for (const theme of ['', 'retro']) {
        const at = `${w}x${h} ${view} ${theme || 'default'}`;
        await H.load({ w, h, query: view === 'flat' ? {} : { officeview: 'real' }, ready: READY[view === 'flat' ? 'flat' : 'real'] });
        if (theme) { await js(`window.THEME.setTheme(${jsLiteral(theme)})`); await settle(); }
        if (view === 'real-nocss') await js(`document.querySelectorAll('link[href$="realoffice.css"]').forEach(l=>l.remove());0`);
        // a waiting agent with a pending permission
        await js(`window.__durbarSimUi.emit({type:'status',sessionId:'sim-2',timestamp:Date.now(),status:'needs-permission',intent:'Edit a file',permission:{requestId:'av-'+Date.now(),kind:'write',summary:'Write to /tmp/zzdemo/a.txt',scopeKey:'write:/tmp/zzdemo',scopeLabel:'write in /tmp/zzdemo',state:'pending'}})`);
        await settle();
        await js(`document.getElementById('inboxBtn').click()`);
        assert.ok(await until(`!!document.querySelector('#inboxDlg .inbox-row .ib-ans .btn')`, 8000), `${at}: the inbox shows a request with a button`);
        await settle();
        const p = await probe();
        assert.ok(p.av.length > 0, `${at}: the dialog has avatars: ${JSON.stringify(p)}`);
        for (const a of p.av.filter((x) => x.ro)) {
          assert.ok(a.clip, `${at}: a Real office face (.ro-face) clips its picture (overflow hidden, rounded): ${JSON.stringify(p)}`);
          assert.ok(a.w >= 16 && a.h >= 16 && a.w <= MAX && a.h <= MAX, `${at}: a Real office face (.ro-face) is a visible square of 16 to ${MAX} px, not ${a.w}x${a.h}: ${JSON.stringify(p)}`);
          assert.ok(a.fit, `${at}: a Real office face fits inside its avatar box: ${JSON.stringify(p)}`);
        }
        for (const a of p.av) assert.ok(a.w <= MAX && a.h <= MAX, `${at}: an avatar in the inbox is at most ${MAX}px square, not ${a.w}x${a.h}: ${JSON.stringify(p)}`);
        assert.ok(p.btn.inDlg && p.btn.inWin, `${at}: the first Allow button is inside the dialog and the window: ${JSON.stringify(p)}`);
        assert.ok(p.btn.hit, `${at}: elementFromPoint at the first Allow button hits it: ${JSON.stringify(p)}`);
        if (theme === 'retro' && view !== 'flat') await H.shot(path.join(OUT, `inbox-avatar-${view}-${w}x${h}.png`), { prep: 'calm', settle: true, tag: 'inboxavatar', what: at });
        console.log('[inbox-avatar]', at, 'ok', JSON.stringify(p.av.map((a) => a.w)));
      }
    }
  }
  console.log('check-inbox-avatar: all checks passed');
};
