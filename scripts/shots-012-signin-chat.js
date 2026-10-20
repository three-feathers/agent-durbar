/*
 * Spec 012 FR-157 (sign in again from the chat): simulator checks and screenshots at 1440x900 and 1280x800. No real sign-in runs:
 * the simulator plays its canned sign-in, and `simauth` makes the simulated Copilot refuse a turn with Claude Code's real 401 text.
 *
 *   npm run build
 *   OUT=docs/screenshots DURBAR_USER_DATA=$(mktemp -d) DURBAR_SIM=15 DURBAR_SIM_FREEZE=1 \
 *     DURBAR_DRIVER=$PWD/scripts/shots-012-signin-chat.js xvfb-run -a npx electron . --no-sandbox
 *
 * Checks:
 * - simauth=expired: a message fails with the 401; the chat shows "Copilot needs you to sign in again." with Sign in, the raw error
 *   only in a closed Details; Sign in runs the in-app sign-in; the card says "Signed in ✓"; Send again restarts the session and
 *   re-sends the last message.
 * - simauth=out: the app is not signed in from the start; sending shows the same card instead, the typed text stays in the box,
 *   and after the sign-in Send sends it.
 * Prints "[012-signin] PASS".
 */
const assert = require('assert');
const path = require('path');
const OUT = process.env.OUT || '/tmp';
const INDEX = path.join(process.cwd(), 'dist', 'renderer', 'index.html');

module.exports = async (ctx) => {
  const js = (c) => ctx.js(c);
  const shot = async (name) => { ctx.win.webContents.sendInputEvent({ type: 'mouseMove', x: 1, y: 1 }); await ctx.sleep(400); await ctx.shot(path.join(OUT, name)); console.log('[012-signin] saved', name); };
  const card = () => js(`(()=>{const c=[...document.querySelectorAll('#chat .note.signin')].pop();if(!c)return null;const d=c.querySelector('details');return {title:(c.querySelector('.signin-title')||{}).textContent,text:c.textContent,btns:[...c.querySelectorAll('button')].map(b=>b.textContent.trim()),details:d?{open:d.open,text:d.textContent}:null};})()`);
  const waitCard = async (want) => { for (let i = 0; i < 40; i++) { const c = await card(); if (c && (!want || want(c))) return c; await ctx.sleep(200); } return card(); };
  const clickCard = (label) => js(`(()=>{const c=[...document.querySelectorAll('#chat .note.signin')].pop();const b=c&&[...c.querySelectorAll('button')].find(x=>x.textContent.trim()===${JSON.stringify(label)});if(b)b.click();return !!b;})()`);
  const type = (t) => js(`(()=>{const i=document.getElementById('msgInput');i.value=${JSON.stringify(t)};i.dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('sendBtn').click();})()`);
  const userMsgs = () => js(`[...document.querySelectorAll('#chat .msg.user .bubble')].map(b=>b.textContent)`);
  /* the simulated sign-in: the dialog opens with the link and code; the paste box finishes it at once (no 60 s wait) */
  const finishSignIn = async () => {
    for (let i = 0; i < 20 && !(await js(`!!document.getElementById('hsPaste')`)); i++) await ctx.sleep(200);
    assert.ok(await js(`!!document.getElementById('hsDlg')`), 'Sign in opens the in-app sign-in dialog');
    await ctx.sleep(500);
    await js(`(()=>{document.getElementById('hsPasteBox').hidden=false;document.getElementById('hsPaste').value='SIM';document.getElementById('hsPasteGo').click();})()`);
    for (let i = 0; i < 20 && (await js(`!!document.getElementById('hsDlg')`)); i++) await ctx.sleep(200);
    assert.ok(await js(`!document.getElementById('hsDlg')`), 'the dialog closes when the sign-in ends');
  };
  const openIdleAgent = () => js(`(()=>{const d=[...document.querySelectorAll('#stage .desk[data-id]')].find(x=>!/needs your|asks you|waiting/i.test(x.innerText));if(d)d.click();return d?d.dataset.id:'';})()`);

  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    // ---- an expired sign-in: the message fails, the card offers Sign in, then Send again
    ctx.win.setContentSize(w, h);
    await ctx.win.loadFile(INDEX, { query: { sim: '15', simfreeze: '1', simauth: 'expired' } });
    await ctx.waitFor(`document.getElementById('stage')&&document.getElementById('stage').dataset.fit`, 15000);
    await ctx.sleep(1500);
    assert.ok(await openIdleAgent(), 'an agent chat opens');
    await ctx.sleep(600);
    await type('hello after expiry');
    let c = await waitCard();
    assert.ok(c, 'the sign-in card is shown');
    assert.strictEqual(c.title, 'Copilot needs you to sign in again.');
    assert.ok(c.btns.includes('Sign in'), 'Sign in button: ' + JSON.stringify(c.btns));
    assert.ok(c.details && !c.details.open && /401 OAuth access token is invalid/.test(c.details.text), 'the raw error only in a closed Details: ' + JSON.stringify(c.details));
    assert.ok(!/^Failed to authenticate/m.test(await js(`[...document.querySelectorAll('#chat .note.err')].map(n=>n.textContent).join('\\n')`)), 'no raw error card');
    await shot(`012-signin-card-${w}x${h}.png`);
    assert.ok(await clickCard('Sign in'));
    await finishSignIn();
    c = await waitCard((x) => /Signed in/.test(x.title));
    assert.strictEqual(c.title, 'Signed in ✓');
    assert.ok(c.btns.includes('Send again') && /restarts the session/.test(c.text), 'Send again, and it says the session restarts: ' + c.text);
    await shot(`012-signin-done-${w}x${h}.png`);
    assert.ok(await clickCard('Send again'));
    await ctx.sleep(1500);
    const sent = await userMsgs();
    assert.strictEqual(sent.filter((t) => t === 'hello after expiry').length, 2, 'the last message was sent again: ' + JSON.stringify(sent));
    c = await card();
    assert.ok(/sent your last message again/.test(c.text), 'the card says so: ' + c.text);

    // ---- not signed in from the start: the card comes before anything is sent; the text stays in the box
    await ctx.win.loadFile(INDEX, { query: { sim: '15', simfreeze: '1', simauth: 'out' } });
    await ctx.waitFor(`document.getElementById('stage')&&document.getElementById('stage').dataset.fit`, 15000);
    await ctx.sleep(1500);
    assert.ok(await openIdleAgent());
    await ctx.sleep(600);
    const before = (await userMsgs()).length;
    await type('first message');
    c = await waitCard();
    assert.ok(c && /still in the box/.test(c.text), 'the card says the message was not sent: ' + (c && c.text));
    assert.strictEqual(await js(`document.getElementById('msgInput').value`), 'first message', 'the typed text stays');
    assert.strictEqual((await userMsgs()).length, before, 'nothing was sent');
    await shot(`012-signin-before-${w}x${h}.png`);
    assert.ok(await clickCard('Sign in'));
    await finishSignIn();
    c = await waitCard((x) => /Signed in/.test(x.title));
    assert.ok(c.btns.includes('Send'), 'Send: ' + JSON.stringify(c.btns));
    assert.ok(await clickCard('Send'));
    await ctx.sleep(1200);
    assert.ok((await userMsgs()).includes('first message'), 'sent after the sign-in');
    assert.strictEqual(await js(`document.getElementById('msgInput').value`), '', 'the box is empty after sending');
    console.log('[012-signin]', w, 'ok');
  }
  console.log('[012-signin] PASS');
};
