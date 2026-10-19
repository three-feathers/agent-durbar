const fs = require('fs');
const { execSync } = require('child_process');
const os = require('os');
const path = require('path');
// spec 010 T021: every path comes from the environment, with defaults under the temp folder (no machine-specific paths)
const BASE = process.env.E2E_DIR || path.join(os.tmpdir(), 'durbar-e2e');
const SHOTS = process.env.E2E_SHOTS || path.join(BASE, 'shots');
const LOGS = process.env.E2E_LOGS || path.join(BASE, 'logs');
const HELLO = process.env.E2E_HELLO || path.join(BASE, 'durbar-test', 'hello-app'), NOTES = process.env.E2E_NOTES || path.join(BASE, 'durbar-test', 'notes-app');
fs.mkdirSync(SHOTS, { recursive: true }); fs.mkdirSync(LOGS, { recursive: true });
const phases = (process.env.PHASES || 'dry').split(',');
const out = (...a) => { const l = a.join(' '); console.log('[driver] ' + l); fs.appendFileSync(path.join(LOGS, 'driver.log'), l + '\n'); };
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
    await ctx.shot(path.join(SHOTS, 'dry.png'));
    return;
  }
  if (phases.includes('m5')) { // no AI: real main process + real session start (no prompt), synthetic events through the real renderer path
    const r = await ctx.addMany([HELLO], 'ask'); const id = r.agents[0].id; await ctx.sleep(800);
    const open = () => ctx.js(`document.querySelector('#stage [data-id=${JSON.stringify(id)}]').click()`);
    const send = (e) => ctx.win.webContents.send('agent:event', { sessionId: id, timestamp: Date.now(), ...e });
    const notes = () => ctx.js(`[...document.querySelectorAll('#panel .note')].map(n=>n.innerText.replace(/\\n/g,' | '))`);
    const btns = () => ctx.js(`[...document.querySelectorAll('#panel .note-actions button')].map(b=>b.textContent)`);
    await open(); await ctx.sleep(500);
    // 1) staging through the real main process: sanitize, caps, real image check
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
    const stage = (name, mime, expr) => ctx.js(`(async()=>{const b=${expr};return JSON.stringify(await window.agentDurbar.stageAttachment(${JSON.stringify(name)},${JSON.stringify(mime)},b))})()`);
    const pngExpr = `Uint8Array.from(atob('${png}'),c=>c.charCodeAt(0)).buffer`;
    out('M5 stage png:', await stage('../../evil/shot.jpeg', 'image/jpeg', pngExpr));
    out('M5 stage svg:', await stage('x.png', 'image/png', `new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>').buffer`));
    out('M5 stage 11MB:', await stage('big.bin', 'application/octet-stream', `new ArrayBuffer(11*1024*1024)`));
    // 2) drop + paste in the real renderer (live agent => goes through stageAttachment in main)
    await ctx.js(`(()=>{const mk=(n,t,sz)=>new File([sz?new Uint8Array(sz):Uint8Array.from(atob('${png}'),c=>c.charCodeAt(0))],n,{type:t});
      const dt=new DataTransfer();dt.items.add(mk('a.png','image/png'));dt.items.add(mk('b.png','image/png'));dt.items.add(mk('huge.png','image/png',11*1024*1024));
      document.getElementById('panel').dispatchEvent(new DragEvent('drop',{dataTransfer:dt,bubbles:true,cancelable:true}));})()`);
    await ctx.sleep(1500);
    await ctx.js(`(()=>{const dt=new DataTransfer();dt.items.add(new File([Uint8Array.from(atob('${png}'),c=>c.charCodeAt(0))],'image.png',{type:'image/png'}));
      document.getElementById('msgInput').dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true}));})()`);
    await ctx.sleep(800);
    out('M5 chips:', JSON.stringify(await ctx.js(`[...document.querySelectorAll('#attached .att')].map(e=>e.innerText.trim()+' '+e.title)`)));
    out('M5 note:', await ctx.js(`document.getElementById('attNote').hidden?'(none)':document.getElementById('attNote').innerText`));
    await ctx.shot(path.join(SHOTS, 'm5-electron-attach-cap.png'));
    // 3) permission UI: Approve for this session + chip + revoke
    send({ type: 'user', text: 'Edit index.js and README.md' });
    send({ type: 'status', status: 'working', intent: 'Thinking' });
    send({ type: 'toolCall', callId: 'r1', tool: 'view', phase: 'start', args: { path: HELLO + '/index.js' } });
    send({ type: 'toolCall', callId: 'r1', tool: 'view', phase: 'complete', output: '12 lines' });
    send({ type: 'status', status: 'needs-permission', intent: 'Waiting for permission', permission: { requestId: 'p1', kind: 'write', summary: 'write ' + HELLO + '/index.js', state: 'pending', scopeKey: 'write:' + HELLO, scopeLabel: 'write in durbar-test/hello-app/' } });
    await ctx.sleep(600);
    out('M5 pending buttons:', JSON.stringify(await btns()), 'card:', await ctx.js(cardState(id)));
    await ctx.js(`[...document.querySelectorAll('#panel .note-actions button')].find(b=>b.textContent==='Approve for this session').click()`);
    send({ type: 'grants', grants: [{ key: 'write:' + HELLO, kind: 'write', label: 'write in durbar-test/hello-app/' }] });
    send({ type: 'toolCall', callId: 'w1', tool: 'apply_patch', phase: 'start', args: { path: HELLO + '/index.js' } });
    send({ type: 'permission', permission: { requestId: 'p2', kind: 'write', summary: 'write ' + HELLO + '/README.md', state: 'approved', via: 'session' } });
    send({ type: 'toolCall', callId: 'w2', tool: 'apply_patch', phase: 'start', args: { path: HELLO + '/README.md' } });
    await ctx.sleep(600);
    out('M5 notes:', JSON.stringify(await notes()));
    out('M5 timeline order:', await ctx.js(`[...document.querySelectorAll('#panel .msg.agent .chips > *')].map(c=>c.classList.contains('note')?'NOTE':(c.querySelector('b')||{}).innerText).join(' > ')`));
    out('M5 grant chips:', JSON.stringify(await ctx.js(`[...document.querySelectorAll('#grants .gchip')].map(c=>c.innerText)`)));
    await ctx.shot(path.join(SHOTS, 'm5-electron-session-grant.png'));
    await ctx.js(`document.querySelector('#grants [data-revoke]').click()`); await ctx.sleep(300);
    send({ type: 'grants', grants: [] }); await ctx.sleep(300);
    out('M5 chips after revoke:', await ctx.js(`document.querySelectorAll('#grants .gchip').length`));
    // 4) stop while pending: the real adapter stop() emits 'stopped'; Approve/Deny must be gone
    send({ type: 'status', status: 'needs-permission', intent: 'Waiting for permission', permission: { requestId: 'p3', kind: 'write', summary: 'write ' + HELLO + '/index.js', state: 'pending', scopeKey: 'k', scopeLabel: 'write' } });
    await ctx.sleep(400);
    out('M5 before stop buttons:', JSON.stringify(await btns()));
    await ctx.js(`document.getElementById('stopBtn').click()`); await ctx.sleep(1500);
    out('M5 after stop buttons:', JSON.stringify(await btns()), 'last note:', (await notes()).slice(-1)[0], 'card:', await ctx.js(cardState(id)));
    await ctx.shot(path.join(SHOTS, 'm5-electron-stop-pending.png'));
    return;
  }
  if (phases.includes('real')) { // ONE tiny real prompt: Approve for this session across two edits (uses AI credits, see DURBAR_LOG usage events)
    execSync('git checkout -- .', { cwd: HELLO });
    const r = await ctx.addMany([HELLO], 'ask'); const id = r.agents[0].id; await ctx.sleep(800);
    await sendViaUi(ctx, id, 'Make two separate edit tool calls, one file each: add the one-line comment "// hello" at the top of index.js, then add the line "hello" at the end of README.md. Nothing else, no summary.');
    const appr = `[...document.querySelectorAll('#panel .note-actions button')].some(b=>b.textContent==='Approve for this session')`;
    out('REAL first request pending:', await ctx.waitFor(appr, 90000), 'card:', await ctx.js(cardState(id)));
    await ctx.shot(path.join(SHOTS, 'm5-real-pending.png'));
    await ctx.js(`[...document.querySelectorAll('#panel .note-actions button')].find(b=>b.textContent==='Approve for this session').click()`);
    await ctx.sleep(1500);
    out('REAL chips after approve:', JSON.stringify(await ctx.js(`[...document.querySelectorAll('#grants .gchip')].map(c=>c.innerText)`)));
    const done = await ctx.waitFor(`/is-(done|idle|error)/.test(${cardState(id)})`, 90000);
    await ctx.sleep(800);
    out('REAL finished:', done, 'card:', await ctx.js(cardState(id)));
    out('REAL notes:', JSON.stringify(await ctx.js(`[...document.querySelectorAll('#panel .note')].map(n=>n.innerText.replace(/\\n/g,' | '))`)));
    out('REAL git diff:', JSON.stringify(diff(HELLO)));
    await ctx.shot(path.join(SHOTS, 'm5-real-session-grant.png'));
    execSync('git checkout -- .', { cwd: HELLO });
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
    await ctx.shot(path.join(SHOTS, 'm3-approval-pending.png'));
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
    await ctx.shot(path.join(SHOTS, 'm3-approval-pending.png'));
    await ctx.js(`[...document.querySelectorAll('#panel button')].find(b=>b.textContent==='Deny').click()`);
    const done1 = await ctx.waitFor(`/is-(done|idle|error)/.test(${cardState(id)})`, 90000);
    await ctx.sleep(800);
    out('ASK1 finished:', done1, 'card:', await ctx.js(cardState(id)));
    out('ASK1 file unchanged:', fs.readFileSync(HELLO + '/index.js', 'utf8') === before, 'git diff:', JSON.stringify(diff(HELLO)));
    await ctx.shot(path.join(SHOTS, 'm3-approval-denied.png'));
    // second prompt: approve
    await sendViaUi(ctx, id, 'Please try again: add that one-line comment at the top of index.js.');
    const w2 = await ctx.waitFor(`[...document.querySelectorAll('#panel button')].some(b=>b.textContent==='Approve')`, 90000);
    out('ASK2 approve button appeared:', w2, 'card:', await ctx.js(cardState(id)));
    await ctx.js(`[...document.querySelectorAll('#panel button')].find(b=>b.textContent==='Approve').click()`);
    const done2 = await ctx.waitFor(`/is-(done|idle|error)/.test(${cardState(id)})`, 90000);
    await ctx.sleep(800);
    out('ASK2 finished:', done2, 'card:', await ctx.js(cardState(id)));
    out('ASK2 git diff:', JSON.stringify(diff(HELLO)));
    await ctx.shot(path.join(SHOTS, 'm3-approval-approved.png'));
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
    await ctx.shot(path.join(SHOTS, 'm3-readonly-denied.png'));
  }
  if (phases.includes('att')) {
    const r = await ctx.addMany([NOTES], 'read-only'); const id = r.agents[0].id; await ctx.sleep(800);
    await ctx.js(`document.querySelector('[data-id=${JSON.stringify(id)}]').click()`); await ctx.sleep(500);
    await ctx.js(`document.getElementById('attFile').click()`); await ctx.sleep(600); // DURBAR_PICK answers with both files
    out('ATT chips before send:', JSON.stringify(await ctx.js(`[...document.querySelectorAll('#attached .att')].map(e=>e.innerText.trim()+(e.classList.contains('img')?' [img]':''))`)));
    await ctx.shot(path.join(SHOTS, 'm3-attachments-composer.png'));
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
    await ctx.shot(path.join(SHOTS, 'm3-attachments.png'));
  }
};
