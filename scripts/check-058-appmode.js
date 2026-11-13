/*
 * Check for spec 058 FR-233..FR-241 (issue #1667, T218): Settings > MCP servers > "Copilot sign-in app for Microsoft (experimental)".
 * Simulator only (no AI credits, no real runtime, no network; the simulator starts no Copilot client, so the reconnect is not run here:
 * main's save, hand and reconnect order is test:signinapp's).
 *
 *   npm run check:ui -- --only check-058-appmode
 *   OUT=<folder>   (optional) saves 058-appmode-<state>-<w>x<h>[-real].png
 *   APPMODE_MUTANT=<name>   must fail at a labelled assertion:
 *     notice-always   the once-shown notice comes back after Got it and after a save
 *     default-off     the default reads as Off (nothing stored shows the Off choice)
 *     field-always    the ID field shows in Visual Studio Code's mode too
 *     cancel-applies  the confirm's Cancel still saves
 *     scroll-reset    the page jumps to the top after a change
 *
 * At 1440x900 and 1280x800, in the flat office and in the Real office (DPR 1): the default is Visual Studio Code's app with the notice, Got it
 * hides it (and it stays hidden when Settings is opened again), Custom shows the ID field and refuses a bad ID inline with the fixed text (never the typed
 * value), Off shows its words, every change asks first (Cancel changes nothing) and the page keeps its scroll; text is at least 10.5px and
 * nothing overlaps or scrolls sideways.
 */
const assert = require('assert');
const path = require('path');
const { helpers, jsLiteral } = require('./driver-helpers');
const OUT = process.env.OUT || require('os').tmpdir();
const MUTANT = process.env.APPMODE_MUTANT || '';
const GOOD_ID = '0A1B2C3D-4E5F-6789-ABCD-EF0123456789';
const BAD_TYPED = 'my-client-secret-value~abc';
const REFUSED = "Not an app (client) ID. It looks like 00000000-0000-0000-0000-000000000000 with your app's digits.";
const WORDS = {
  heading: 'Copilot sign-in app for Microsoft (experimental)',
  vscode: "Experimental. Uses Visual Studio Code's Microsoft Entra app ID, as Copilot did before version 1.0.26. Durbar is not Visual Studio Code. Your organization or Microsoft may refuse this, and sign-ins show as Visual Studio Code in your organization's logs.",
  off: "Agent Durbar does not set an app. Copilot's sign-in to Microsoft Entra MCP servers may fail; then use /mcp auth <name> in the Copilot CLI.",
  custom: "Your organization's own Microsoft Entra app (client) ID. It needs the MCP server's permissions, admin consent and the sign-in redirect address for this computer, which Agent Durbar has not confirmed yet: ask your administrator. An app ID is not a secret. Never enter a client secret here.",
  notice: "Experimental: Copilot now signs in to Microsoft Entra MCP servers with Visual Studio Code's app ID by default, as it did before. Sign-ins show as Visual Studio Code in your organization's logs. Choose Off or your own app below.",
  linux: 'On Linux this Copilot version cannot use the system sign-in; this setting may have no effect.',
  confirm: 'Copilot reconnects to use the new sign-in app. A running turn stops; its history stays.',
};
const WORLDS = [['flat', {}], ['real', { officeview: 'real' }]];

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { js, until } = H;
  const raf2 = () => js(`new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r(true))))`);
  const stored = () => js(`(window.__origGS||window.__durbarSimUi.bridge().getSettings)().then(s=>({app:s.copilotSignInApp||null,seen:s.copilotSignInAppNoticeSeen===true}))`);
  const top = () => js(`Math.round(document.querySelector('.scr-body').scrollTop)`);
  const pick = async (mode) => { await js(`(()=>{document.getElementById(${jsLiteral('siM_' + mode)}).click();})()`); await raf2(); };
  const typeId = async (v) => { await js(`(()=>{const e=document.getElementById('siId');e.value=${jsLiteral(v)};e.dispatchEvent(new Event('input',{bubbles:true}));})()`); await raf2(); };
  const dlg = () => js(`(()=>{const d=document.querySelector('#modeDlg .dlg');return d?{title:d.querySelector('h3').textContent,body:d.querySelector('.dsub').textContent,btns:[...d.querySelectorAll('.dbtn button')].map(b=>b.textContent.trim())}:null})()`);
  const scrollToHeading = () => js(`(()=>{const b=document.querySelector('.scr-body'),h=document.getElementById('siH');b.scrollTop+=h.getBoundingClientRect().top-b.getBoundingClientRect().top-60;return Math.round(b.scrollTop)})()`);
  // FR-240: a failed server whose masked error holds a refusal code gets the refusal words in Settings' live rows, worded by the app in force
  const refusal = async (tag, expectWords, expectReason) => {
    const id = await js(`window.__durbarSimUi.agents().filter(a=>a.live&&!a.parent&&(!a.info||!a.info.adapterId||a.info.adapterId==='copilot')).map(a=>a.id)[0]||null`);
    assert.ok(id, `${tag}: a running Copilot chat for the refusal rows`);
    const report = (error, errorClass) => js(`window.__durbarSimEmit({type:'mcp',sessionId:${jsLiteral(id)},timestamp:Date.now(),servers:[{name:'team-wiki',status:'failed',transport:'http',source:'user',sources:['copilot'],error:${jsLiteral(error)},errorClass:${jsLiteral(errorClass)}}]});0`);
    const read = async () => {
      assert.ok(await until(`!!document.querySelector('#liveBox [data-lvs="team-wiki"]')||!!document.querySelector('#liveBox button[data-lv="team-wiki"]')`, 6000), `${tag}: the live row of the failed server`);
      await js(`(()=>{const li=document.querySelector('#liveBox [data-lvs="team-wiki"][data-lvc]');if(!li){const b=document.querySelector('#liveBox button[data-lv="team-wiki"]');if(b&&b.getAttribute('aria-expanded')!=='true')b.click();}})()`);
      assert.ok(await until(`!!document.querySelector('#liveBox [data-lvs="team-wiki"][data-lvc] .srv-hint')`, 6000), `${tag}: the chat's row under the server has its hint`);
      return js(`(()=>{const li=document.querySelector('#liveBox [data-lvs="team-wiki"][data-lvc]');return {hint:[...li.querySelectorAll('.srv-hint')].map(e=>e.textContent).join(' | '),why:(li.querySelector('.srv-why')||{}).textContent||''}})()`);
    };
    await report('AADSTS65002: Consent between first party application and resource application must be configured', 'auth');
    await read();
    await until(`[...document.querySelectorAll('#liveBox [data-lvs="team-wiki"][data-lvc] .srv-hint')].some(e=>e.textContent.includes(${jsLiteral(expectWords)}))`, 6000); // the row repaints after the report: wait for the words, then assert them below
    const r = await read();
    assert.ok(r.hint.includes(expectWords), `${tag}: FR-240: the refusal words show on the row: ${JSON.stringify(r)}`);
    assert.ok(/Refused: the sign-in app/.test(r.why), `${tag}: FR-240: the reason says the app was refused, not "needs sign-in": ${JSON.stringify(r)}`);
    assert.ok(!/needs you to sign in/.test(r.hint), `${tag}: FR-240 order: the sign-in words do not win over the refusal words: ${JSON.stringify(r)}`);
    await report('unauthorized: sign in required', 'auth');
    assert.ok(await until(`/needs you to sign in|Sign in from the chat/.test((document.querySelector('#liveBox [data-lvs="team-wiki"][data-lvc]')||{textContent:''}).textContent)&&!/Refused: the sign-in app/.test((document.querySelector('#liveBox [data-lvs="team-wiki"][data-lvc]')||{textContent:''}).textContent)`, 6000), `${tag}: a plain sign-in failure keeps the sign-in words`);
  };
  const applyMutant = async () => {
    await js(`window.__origGS=window.__durbarSimUi.bridge().getSettings.bind(window.__durbarSimUi.bridge());0`); // the real answer, for the checks that read what is stored
    if (!MUTANT) return;
    await js(`(()=>{const b=window.__durbarSimUi.bridge(),m=${jsLiteral(MUTANT)},g=b.getSettings,s=b.setCopilotSignInApp,n=b.setCopilotSignInAppNoticeSeen;
      if(m==='notice-always'){b.getSettings=async()=>Object.assign({},await g(),{copilotSignInAppNoticeSeen:false});}
      if(m==='default-off'){b.getSettings=async()=>{const r=await g();return r.copilotSignInApp?r:Object.assign({},r,{copilotSignInApp:{mode:'off'}});};}
      if(m==='field-always'){const st=document.createElement('style');st.textContent='#siIdRow[hidden]{display:flex!important}';document.head.appendChild(st);}
      if(m==='cancel-applies'){const D=window.DurbarDialog;window.DurbarDialog=(d)=>{const a=D(d);return async(o)=>{await a(o);return 'ok';};};}
      if(m==='scroll-reset'){b.setCopilotSignInApp=async(c)=>{const r=await s.call(b,c);const e=document.querySelector('.scr-body');if(e)e.scrollTop=0;return r;};}
      return true;})()`);
  };

  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    for (const [wname, query] of WORLDS) {
      const tag = `${w}x${h} ${wname}`;
      const suffix = `${w}x${h}${wname === 'real' ? '-real' : ''}`;
      const shot = (name) => H.shot(path.join(OUT, `058-appmode-${name}-${suffix}.png`), { prep: 'mouse', tag: '058' });
      await H.load({ w, h, ready: 'fit', focus: true, query: { simkinds: 'mixed', ...query } });
      if (wname === 'real') assert.ok(await until(`document.documentElement.dataset.office==='real'||!!document.querySelector('#stage .ro')`, 6000), `${tag}: the Real office is the world`);
      await js(`window.DurbarScreens.openSettings('mcp')`);
      assert.ok(await until(`!!document.getElementById('siGroup')&&document.getElementById('advMcp').open`), `${tag}: Settings > MCP servers has the sign-in app group`);
      await H.settle();
      await applyMutant();
      await js(`window.DurbarScreens.openSettings('mcp')`);
      assert.ok(await until(`!!document.getElementById('siGroup')`), `${tag}: Settings painted again`);
      await H.settle();
      const platform = await js(`(window.agentDurbar&&window.agentDurbar.platform)||''`);

      // ---- the default, the words, the notice ----
      assert.strictEqual(await js(`document.getElementById('siH').textContent`), WORDS.heading, `${tag}: the group's heading`);
      assert.strictEqual(await js(`(document.querySelector('#siGroup input[name=siMode]:checked')||{}).value||null`), 'vscode', `${tag}: default: Visual Studio Code's app is selected when nothing is stored`);
      assert.strictEqual(await js(`document.getElementById('siGroup').getAttribute('role')+'|'+document.getElementById('siGroup').getAttribute('aria-labelledby')`), 'radiogroup|siH', `${tag}: a labelled radio group`);
      assert.deepStrictEqual(await js(`[...document.querySelectorAll('#siGroup input[name=siMode]')].map(i=>i.value+':'+(document.querySelector('label[for='+i.id+']')||{}).textContent.trim())`),
        ["vscode:Visual Studio Code's app (default)", 'off:Off', 'custom:Custom app'], `${tag}: the choices, in order (Copilot CLI's app is not offered, Q25)`);
      assert.strictEqual(await js(`document.getElementById('siD_vscode').textContent`), WORDS.vscode, `${tag}: Visual Studio Code's line (FR-239)`);
      assert.strictEqual(await js(`document.getElementById('siD_off').textContent`), WORDS.off, `${tag}: Off shows its words (FR-239)`);
      assert.strictEqual(await js(`document.getElementById('siD_custom').textContent`), WORDS.custom, `${tag}: Custom app's line (FR-239)`);
      assert.strictEqual(await js(`document.querySelectorAll('#siGroup input[name=siMode]:not(:checked)').length`), 2, `${tag}: one choice selected`);
      assert.strictEqual(await js(`!!document.getElementById('siD_off').closest('.siapp-opt').querySelector('input').getAttribute('aria-describedby')`), true, `${tag}: each choice names its line to a screen reader`);
      assert.strictEqual(await js(`(()=>{const n=document.getElementById('siNotice');return n?n.querySelector('span').textContent:null})()`), WORDS.notice, `${tag}: notice: shown once for a fresh settings file, with the fixed words`);
      assert.strictEqual(await js(`!!document.getElementById('siGotIt')&&document.getElementById('siGotIt').textContent`), 'Got it', `${tag}: the notice has Got it`);
      assert.strictEqual(await js(`document.getElementById('siIdRow').hidden&&document.getElementById('siIdRow').getClientRects().length===0`), true, `${tag}: field hidden in Visual Studio Code's mode`);
      assert.strictEqual(await js(`document.getElementById('siSave').disabled`), true, `${tag}: Save is off while nothing differs from what is in force`);
      assert.strictEqual(await js(`(document.getElementById('siLinux')||{}).textContent||null`), platform === 'linux' ? WORDS.linux : null, `${tag}: the Linux line only on Linux (platform ${platform}) (FR-241)`);
      await scrollToHeading();
      await raf2();
      // text size, overlap, sideways scroll
      const geo = await js(`(()=>{const sec=document.getElementById('siH').parentElement,b=document.querySelector('.scr-body'),bl=b.getBoundingClientRect();
        const ids=['siH','siNotice','siGroup','siErr','siLinux','siSave','siMsg'];
        const boxes=[...document.querySelectorAll('#siNotice,.siapp-opt,#siIdRow,#siErr,#siLinux,#siSave,#siMsg')].filter(e=>e.getClientRects().length).map(e=>({id:e.id||e.className,r:e.getBoundingClientRect()}));
        const overlaps=[];for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++){const a=boxes[i].r,c=boxes[j].r;if(a.left<c.right-1&&c.left<a.right-1&&a.top<c.bottom-1&&c.top<a.bottom-1)overlaps.push(boxes[i].id+'/'+boxes[j].id);}
        const els=[...document.querySelectorAll('#siH,#siNotice,#siNotice *,.siapp *,#siLinux,#siSave,#siMsg')].filter(e=>e.getClientRects().length&&[...e.childNodes].some(t=>t.nodeType===3&&t.textContent.trim()));
        const small=els.filter(e=>parseFloat(getComputedStyle(e).fontSize)<10.5).map(e=>e.id||e.className||e.tagName);
        const out=boxes.filter(x=>x.r.right>bl.right+0.5||x.r.left<bl.left-0.5).map(x=>x.id);
        return {overlaps,small,out,pageX:document.documentElement.scrollWidth<=innerWidth,bodyX:b.scrollWidth<=b.clientWidth+1,pageTop:document.scrollingElement.scrollTop,dpr:devicePixelRatio,n:els.length}})()`);
      assert.ok(geo.dpr === 1 && geo.n > 8, `${tag}: DPR 1 and the group has text ${JSON.stringify(geo)}`);
      assert.ok(geo.small.length === 0, `${tag}: no text under 10.5px ${JSON.stringify(geo)}`);
      assert.ok(geo.overlaps.length === 0, `${tag}: nothing overlaps ${JSON.stringify(geo)}`);
      assert.ok(geo.out.length === 0 && geo.pageX && geo.bodyX && geo.pageTop === 0, `${tag}: nothing outside the page, no sideways scroll, the document does not scroll ${JSON.stringify(geo)}`);
      assert.deepStrictEqual(await js(`[...document.querySelectorAll('#siGroup input, #siGroup button, #siSave')].filter(e=>e.getClientRects().length).map(e=>e.id)`), ['siM_vscode', 'siM_off', 'siM_custom', 'siSave'], `${tag}: keyboard order: the choices, then Save`);
      await H.clearToasts();
      await shot('default-notice');

      // ---- Got it: gone, and gone when Settings is opened again ----
      await js(`document.getElementById('siGotIt').click()`);
      assert.ok(await until(`!document.getElementById('siNotice')`, 4000), `${tag}: notice: Got it hides it`);
      assert.deepStrictEqual(await stored(), { app: null, seen: true }, `${tag}: Got it stores only the notice flag; the default stays unwritten`);
      await js(`window.DurbarScreens.close&&window.DurbarScreens.close();0`);
      await js(`window.DurbarScreens.openSettings('mcp')`);
      assert.ok(await until(`!!document.getElementById('siGroup')`), `${tag}: Settings opened again`);
      await H.settle();
      assert.strictEqual(await js(`!!document.getElementById('siNotice')`), false, `${tag}: notice: stays hidden when Settings is opened again`);
      assert.strictEqual(await js(`document.activeElement&&document.activeElement.tagName!=='BODY'`) !== undefined, true);

      // ---- Custom: the field, the inline refusal, a valid ID ----
      await scrollToHeading();
      await pick('custom');
      assert.strictEqual(await js(`!document.getElementById('siIdRow').hidden&&document.getElementById('siIdRow').getClientRects().length>0`), true, `${tag}: Custom shows the ID field`);
      assert.strictEqual(await js(`document.getElementById('siSave').disabled`), true, `${tag}: Custom with an empty field: Save is off`);
      assert.strictEqual(await js(`document.getElementById('siErr').hidden`), true, `${tag}: an empty field shows no error yet`);
      await typeId(BAD_TYPED);
      assert.strictEqual(await js(`document.getElementById('siErr').hidden===false&&document.getElementById('siErr').textContent`), REFUSED, `${tag}: a bad ID is refused inline with the fixed text`);
      assert.strictEqual(await js(`document.body.innerText.includes(${jsLiteral(BAD_TYPED)})&&document.getElementById('siErr').textContent.includes(${jsLiteral(BAD_TYPED.slice(0, 8))})`), false, `${tag}: the refused value is not echoed in the error`);
      assert.strictEqual(await js(`document.getElementById('siId').getAttribute('aria-invalid')+'|'+document.getElementById('siSave').disabled`), 'true|true', `${tag}: invalid field is marked and Save stays off`);
      await shot('custom-bad');
      await typeId(GOOD_ID);
      assert.strictEqual(await js(`document.getElementById('siErr').hidden&&document.getElementById('siSave').disabled===false`), true, `${tag}: a valid ID clears the error and enables Save`);
      assert.deepStrictEqual(await js(`[...document.querySelectorAll('#siGroup input, #siGroup button, #siSave')].filter(e=>e.getClientRects().length).map(e=>e.id)`), ['siM_vscode', 'siM_off', 'siM_custom', 'siId', 'siSave'], `${tag}: keyboard order with the field: choices, ID, Save`);

      // ---- the change asks first: Cancel changes nothing, the scroll stays ----
      const y0 = await scrollToHeading();
      assert.ok(y0 > 0, `${tag}: the page is scrolled before the change (scrollTop ${y0})`);
      await js(`document.getElementById('siSave').click();0`);
      assert.ok(await until(`!!document.querySelector('#modeDlg .dlg')`), `${tag}: Save asks first`);
      const d1 = await dlg();
      assert.ok(d1 && d1.body === WORDS.confirm && JSON.stringify(d1.btns) === JSON.stringify(['Cancel', 'Reconnect']), `${tag}: the confirm's words and buttons (FR-237) ${JSON.stringify(d1)}`);
      assert.ok(await H.clickText('#modeDlg .dbtn button', 'Cancel'), `${tag}: Cancel is there`);
      assert.ok(await until(`!document.querySelector('#modeDlg')`), `${tag}: the confirm closed`);
      await raf2();
      assert.deepStrictEqual(await stored(), { app: null, seen: true }, `${tag}: Cancel changes nothing (nothing saved)`);
      assert.strictEqual(await js(`document.querySelector('#siGroup input:checked').value+'|'+document.getElementById('siId').value`), `custom|${GOOD_ID}`, `${tag}: Cancel keeps the pick and the typed ID for another go`);
      // ---- Reconnect: saved (ID lower case), page keeps its place ----
      await js(`document.getElementById('siSave').click();0`);
      assert.ok(await until(`!!document.querySelector('#modeDlg .dlg')`), `${tag}: Save asks again`);
      assert.ok(await H.clickText('#modeDlg .dbtn button', 'Reconnect'));
      assert.ok(await until(`/^Saved\\./.test(document.getElementById('siMsg').textContent)`, 5000), `${tag}: the row says Saved`);
      assert.deepStrictEqual(await stored(), { app: { mode: 'custom', clientId: GOOD_ID.toLowerCase() }, seen: true }, `${tag}: saved: the custom ID, lower case`);
      await raf2();
      const y1 = await top();
      assert.ok(Math.abs(y1 - y0) <= 1, `${tag}: scroll kept: the page does not jump to the top on a change (before ${y0}, after ${y1})`);
      assert.strictEqual(await js(`document.getElementById('siSave').disabled`), true, `${tag}: after saving, Save is off (the same value does nothing)`);
      assert.strictEqual(await js(`!!document.getElementById('siNotice')`), false, `${tag}: notice: gone after a save`);
      await shot('custom-saved');

      // ---- Off ----
      await pick('off');
      assert.strictEqual(await js(`document.getElementById('siIdRow').hidden`), true, `${tag}: the field hides again outside Custom`);
      await js(`document.getElementById('siSave').click();0`);
      assert.ok(await until(`!!document.querySelector('#modeDlg .dlg')`), `${tag}: Off asks first too`);
      assert.ok(await H.clickText('#modeDlg .dbtn button', 'Reconnect'));
      assert.ok(await until(`/^Saved\\./.test(document.getElementById('siMsg').textContent)`, 5000), `${tag}: Off saved`);
      assert.deepStrictEqual(await stored(), { app: { mode: 'off' }, seen: true }, `${tag}: an explicit Off is stored as Off`);
      assert.ok(Math.abs((await top()) - y0) <= 1, `${tag}: scroll kept after Off`);
      await shot('off');
      await refusal(tag + ' Off', "Microsoft refused Copilot's sign-in app for this server. Use /mcp auth team-wiki in the Copilot CLI.");
      // ---- back to Visual Studio Code's app ----
      await pick('vscode');
      await js(`document.getElementById('siSave').click();0`);
      assert.ok(await until(`!!document.querySelector('#modeDlg .dlg')`));
      assert.ok(await H.clickText('#modeDlg .dbtn button', 'Reconnect'));
      assert.ok(await until(`/^Saved\\./.test(document.getElementById('siMsg').textContent)`, 5000), `${tag}: Visual Studio Code's app saved`);
      assert.deepStrictEqual(await stored(), { app: { mode: 'vscode' }, seen: true }, `${tag}: Visual Studio Code's app stored explicitly`);
      assert.ok(Math.abs((await top()) - y0) <= 1, `${tag}: scroll kept after the last change`);
      await refusal(tag + ' VS Code', "Microsoft refused the sign-in app chosen in Settings > MCP servers (Visual Studio Code's app): this server does not accept that app. Choose another app or Off.");
      await H.clearToasts();
    }
  }
  console.log('[058] app mode PASS');
};
