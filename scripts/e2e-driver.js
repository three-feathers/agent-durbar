const fs = require('fs');
const { execSync } = require('child_process');
const SHOTS = '/workspace/command-center';
const HELLO = '/workspace/durbar-test/hello-app', NOTES = '/workspace/durbar-test/notes-app';
const phases = (process.env.PHASES || 'dry').split(',');
const out = (...a) => { const l = a.join(' '); console.log('[driver] ' + l); fs.appendFileSync('/workspace/m3/driver.log', l + '\n'); };
const diff = (d) => execSync('git diff --stat; git diff', { cwd: d }).toString();

async function sendViaUi(ctx, id, text, attach) {
  await ctx.js(`document.querySelector('[data-id=${JSON.stringify(id)}]').click()`);
  await ctx.sleep(500);
  if (attach) { await ctx.js(`document.getElementById('${attach}').click()`); await ctx.sleep(500); }
  await ctx.js(`(()=>{const t=document.getElementById('msgInput');t.value=${JSON.stringify(text)};t.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await ctx.sleep(200);
  await ctx.js(`document.getElementById('sendBtn').click()`);
}
const cardState = (id) => `(document.querySelector('.desk[data-id=${JSON.stringify(id)}]')||{}).className||''`;

module.exports = async (ctx) => {
  await ctx.win.setContentSize(1280, 800); await ctx.sleep(1500);
  if (phases.includes('dry')) {
    const r = await ctx.addMany([HELLO], 'ask'); const id = r.agents[0].id;
    await ctx.sleep(800);
    await ctx.js(`document.querySelector('[data-id=${JSON.stringify(id)}]').click()`); await ctx.sleep(500);
    await ctx.js(`document.getElementById('attFile').click()`); await ctx.sleep(600);
    out('chips', await ctx.js(`document.getElementById('attached').innerText`));
    out('card class', await ctx.js(cardState(id)));
    await ctx.shot('/workspace/m3/dry.png');
    return;
  }
  if (phases.includes('fake')) { // no AI: synthetic events through the real renderer path
    const r = await ctx.addMany([HELLO], 'ask'); const id = r.agents[0].id; await ctx.sleep(800);
    await ctx.js(`document.querySelector('[data-id=${JSON.stringify(id)}]').click()`); await ctx.sleep(500);
    const send = (e) => ctx.win.webContents.send('agent:event', { sessionId: id, timestamp: Date.now(), ...e });
    send({ type: 'user', text: 'Add a one-line comment at the top of index.js saying hello.' });
    send({ type: 'status', status: 'working', intent: 'Thinking' });
    send({ type: 'toolCall', callId: 'c1', tool: 'apply_patch', phase: 'start', args: { path: HELLO + '/index.js' } });
    send({ type: 'status', status: 'needs-permission', intent: 'Waiting for permission: write ' + HELLO + '/index.js', permission: { requestId: 'c1', kind: 'write', summary: 'write ' + HELLO + '/index.js', state: 'pending' } });
    await ctx.sleep(700);
    await ctx.shot(SHOTS + '/m3-approval-pending.png');
    await ctx.js(`[...document.querySelectorAll('#panel button')].find(b=>b.textContent==='Deny').click()`); await ctx.sleep(400);
    out('FAKE note after deny:', await ctx.js(`[...document.querySelectorAll('#panel .note')].map(n=>n.innerText).join(' | ')`));
    return;
  }
  if (phases.includes('ask')) {
    const r = await ctx.addMany([HELLO], 'ask'); const id = r.agents[0].id; await ctx.sleep(800);
    const before = fs.readFileSync(HELLO + '/index.js', 'utf8');
    await sendViaUi(ctx, id, 'Add a one-line comment at the top of index.js saying hello. ');
    const waited = await ctx.waitFor(`[...document.querySelectorAll('#panel button')].some(b=>b.textContent==='Approve')`, 90000);
    out('ASK1 approve button appeared:', waited, 'card:', await ctx.js(cardState(id)));
    await ctx.sleep(500);
    out('ASK1 note:', await ctx.js(`[...document.querySelectorAll('#panel .note')].map(n=>n.innerText).join(' | ')`));
    await ctx.shot(SHOTS + '/m3-approval-pending.png');
    await ctx.js(`[...document.querySelectorAll('#panel button')].find(b=>b.textContent==='Deny').click()`);
    const done1 = await ctx.waitFor(`/is-(done|idle|error)/.test(${cardState(id)})`, 90000);
    await ctx.sleep(800);
    out('ASK1 finished:', done1, 'card:', await ctx.js(cardState(id)));
    out('ASK1 file unchanged:', fs.readFileSync(HELLO + '/index.js', 'utf8') === before, 'git diff:', JSON.stringify(diff(HELLO)));
    await ctx.shot(SHOTS + '/m3-approval-denied.png');
    // second prompt: approve
    await sendViaUi(ctx, id, 'Please try again: add that one-line comment at the top of index.js.');
    const w2 = await ctx.waitFor(`[...document.querySelectorAll('#panel button')].some(b=>b.textContent==='Approve')`, 90000);
    out('ASK2 approve button appeared:', w2, 'card:', await ctx.js(cardState(id)));
    await ctx.js(`[...document.querySelectorAll('#panel button')].find(b=>b.textContent==='Approve').click()`);
    const done2 = await ctx.waitFor(`/is-(done|idle|error)/.test(${cardState(id)})`, 90000);
    await ctx.sleep(800);
    out('ASK2 finished:', done2, 'card:', await ctx.js(cardState(id)));
    out('ASK2 git diff:', JSON.stringify(diff(HELLO)));
    await ctx.shot(SHOTS + '/m3-approval-approved.png');
  }
  if (phases.includes('ro')) {
    execSync('git checkout -- .', { cwd: HELLO });
    const r = await ctx.addMany([HELLO], 'read-only'); const id = r.agents[0].id; await ctx.sleep(800);
    await sendViaUi(ctx, id, 'Add a one-line comment at the top of index.js saying hello. ');
    await ctx.waitFor(`document.querySelector('#panel .note')`, 90000);
    const done = await ctx.waitFor(`/is-(done|idle|error)/.test(${cardState(id)})`, 90000);
    await ctx.sleep(800);
    out('RO finished:', done, 'card:', await ctx.js(cardState(id)));
    out('RO chat:', await ctx.js(`document.getElementById('panel').innerText.slice(-1500)`));
    out('RO git diff:', JSON.stringify(diff(HELLO)));
    await ctx.shot(SHOTS + '/m3-readonly-denied.png');
  }
  if (phases.includes('att')) {
    const r = await ctx.addMany([NOTES], 'read-only'); const id = r.agents[0].id; await ctx.sleep(800);
    await ctx.js(`document.querySelector('[data-id=${JSON.stringify(id)}]').click()`); await ctx.sleep(500);
    await ctx.js(`document.getElementById('attFile').click()`); await ctx.sleep(600); // DURBAR_PICK answers with both files
    out('ATT chips before send:', JSON.stringify(await ctx.js(`[...document.querySelectorAll('#attached .att')].map(e=>e.innerText.trim()+(e.classList.contains('img')?' [img]':''))`)));
    await ctx.shot(SHOTS + '/m3-attachments-composer.png');
    await ctx.js(`(()=>{const t=document.getElementById('msgInput');t.value='Describe the attached image in one sentence and summarise the file in one sentence. Do not edit files.';t.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await ctx.sleep(200);
    await ctx.js(`document.getElementById('sendBtn').click()`);
    await ctx.sleep(1000);
    out('ATT chips in chat:', JSON.stringify(await ctx.js(`[...document.querySelectorAll('#panel .msg .chips .att, #panel .chips .att')].map(e=>e.innerText.trim())`)));
    const done = await ctx.waitFor(`/is-(done|idle|error)/.test(${cardState(id)})`, 120000);
    await ctx.sleep(800);
    out('ATT finished:', done, 'card:', await ctx.js(cardState(id)));
    out('ATT chat:', await ctx.js(`document.getElementById('panel').innerText.slice(-2500)`));
    out('ATT git status:', JSON.stringify(execSync('git status --short', { cwd: NOTES }).toString()));
    await ctx.shot(SHOTS + '/m3-attachments.png');
  }
};
