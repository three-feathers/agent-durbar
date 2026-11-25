/*
 * Check for spec 005 FR-342 (issue #1974): a tool call's chip in the chat shows the call's argument masked, the way the task line masks it.
 * Simulator only (no agent app, no AI credits).
 *
 *   npm run check:ui -- --only check-toolchip-mask
 *
 * Canaries are invented and built from pieces at run time (no secret-looking literal in this file). Through the simulator's test hook
 * (`__durbarSimEmit`, the path of its own events) the first agent gets tool calls whose argument holds a canary, at a call's start and in a
 * later update that brings the arguments. For each chip: its visible line, its `title`, every `aria-label` inside it, the open chip's command,
 * the chip's HTML and the confirm Copy opens hold no canary (nor a piece of one); since spec 005 FR-411 Copy on such a chip asks first and Cancel
 * copies nothing (check-005-chip-copy drives Copy anyway). In Flat and in Real office, at 1440x900; the corpus part once.
 * Work: the chip's mask runs once per start and once per update that brings arguments, never for an output update (a counter, not a clock).
 * Differential with main: a corpus of about 3,000 harmless commands, paths, searches and URLs, run through the chip's own mask, must show
 * exactly what main shows (main puts the raw argument on the chip: its one-line label cut at 400, the full text cut at 20,000): 0 changes.
 * Near misses are pinned both ways (NEAR_SAME as on main, NEAR_HIDDEN hidden as on the task line). An argument longer than the masks take
 * (12,288 characters) arrives empty, as main sends it, and the chip names its length only (spec 005 FR-438; the simulator applies main's rule). No redact module (`noredact=1`): the chip shows the tool name only, never the argument. A miss prints DRIVER FAILED.
 */
const assert = require('assert');
const { helpers, jsLiteral } = require('./driver-helpers');

const j = (...p) => p.join('');
const TOK = j('gh', 'p_', 'Zr4Kq8', 'Wm2Lx7', 'Vt5Np3', 'Hs9Bc6', 'Jd1Fg0', 'Ya', 'Ue3w'); // a bare token-shaped word
const BEARER = j('Qx7', 'Mw2Rt9', 'Lp4Vz8', 'Nc3Hk'); // a header value
const OPTV = j('Pv6', 'Tq1Zm4', 'Wx8Rs'); // an option value
const URLPW = j('Hn5', 'Jw8Kd2', 'Bq7'); // a password inside a URL
const NEEDLES = [TOK, TOK.slice(4), BEARER, BEARER.slice(0, 8), OPTV, OPTV.slice(0, 8), URLPW, URLPW.slice(0, 7), 'zr4kq8wm2'].map((x) => x.toLowerCase());
const CASES = [
  { id: 'hdr', tool: 'bash', args: { command: j('curl -s -H "Authorization', ': Bearer ', BEARER, '" https://api.example.test/v1/items') } },
  { id: 'opt', tool: 'bash', args: { command: j('npm run deploy -- --', 'token=', OPTV, ' --env staging') } },
  { id: 'bare', tool: 'bash', args: { command: j('echo ', TOK, ' | wc -c') } },
  { id: 'url', tool: 'web_fetch', args: { url: j('https://ana:', URLPW, '@db.example.test/admin?x=1') } },
  { id: 'urlcmd', tool: 'bash', args: { command: j('git clone https://ana:', URLPW, '@git.example.test/acme/app.git') } },
  { id: 'lines', tool: 'bash', args: { command: j('cd app &&\n  curl -H "Authorization', ': Bearer ', BEARER, '" \\\n  https://api.example.test/') } },  { id: 'cut', tool: 'bash', args: { command: j('echo ', 'ab '.repeat(131), TOK, ' done') } }, // the token across the label's 400 cut: masked before the cut
  { id: 'long', tool: 'bash', args: { command: j('echo ', 'ab '.repeat(4200), TOK) }, hides: false, long: true }, // past the masks' input limit: like main, the simulator sends it empty with its length (spec 005 FR-438); the window's own cut is checked on chipArg below
];
/* a value broken by a line continuation or a line break (the task line reads the flat form): each break kind, two shapes */
const CA = j('Hx9', 'Kq2'), CB = j('Lm7', 'Np4Rs');
const BREAKS = [['bs-lf', '\\\n'], ['bs-crlf', '\\\r\n'], ['caret-crlf', '^\r\n'], ['lf', '\n'], ['crlf', '\r\n']];
const CONT = [];
for (const [bk, br] of BREAKS) {
  CONT.push({ id: 'env-' + bk, raw: j('export DB_', 'PASSWORD=', CA, br, CB, ' && npm test') });
  CONT.push({ id: 'url-' + bk, raw: j('git clone https://ana:', 'password=3gP5K2', br, CB, '@git.example.test/a.git') });
}
/* labels an adapter already cut (history: 300; Codex: 200 and "…"; VS Code: 299 or 199 and "…"), the cut inside a token of several families */
const FAM = [j('sk', '-proj-', 'Rt5Wq8Zx2Vb7Nm4Kp1'), j('gl', 'pat-', 'Wd3Fh7Jk2Lm9Qs4Tv6'), j('xo', 'xb-', '1234567890', '-', 'Gh5Jk8Lm2Np4'), j('github', '_pat_', '11AB', 'Zx9Cv8Bn7Mm6Lk5Jh4'), j('AK', 'IA', 'QW3ER5TY7UI9OP2A')];
const FAM_NEEDLES = FAM.map((t) => t.slice(0, 12).toLowerCase()); // the head an adapter's cut leaves (12 to 16 characters)
const cutAt = (n, mark) => (t) => { const pad = 'echo ' + 'ab '.repeat(Math.max(0, Math.floor((n - 5 - 14) / 3))); return (pad + t + ' done').replace(/\s+/g, ' ').slice(0, n) + mark; };
const PATHNEEDLES = [TOK, BEARER].map((x) => x.toLowerCase());
/* near misses (pinned): harmless text the task line's mask leaves as it is reads exactly as on main; text it hides by its own rule (every
   header value of a command, a name or flag that says token, a URL's user part) is hidden on the chip too, as on the task line */
const NEAR_SAME = [['bash', 'gh auth status'], ['bash', 'grep -rn "Authorization" src'], ['bash', 'git clone git@github.com:acme/app.git'], ['grep', 'password'], ['view', 'src/auth/token.ts'], ['bash', 'echo $GITHUB_TOKEN | wc -c'], ['bash', 'git log --format=%H -n 1'], ['web_fetch', 'https://example.com/login?next=/home']];
const NEAR_HIDDEN = [['bash', 'curl -H "Accept: application/json" https://api.example.com/v1'], ['bash', 'npm run deploy -- --token-file ./x.txt'], ['bash', 'export TOKEN_NAME=deploy'], ['web_fetch', 'https://ana@example.com/profile']];

/* the harmless corpus: realistic commands, paths, searches and URLs, made from pieces with a fixed seed */
function corpus() {
  let s = 1974;
  const r = (n) => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) % n; }; // mulberry32
  const p = (a) => a[r(a.length)];
  const files = ['src/app.ts', 'src/renderer/app.js', 'README.md', 'package.json', 'tests/test_api.py', 'cmd/server/main.go', 'lib/utils.rb', 'docs/install.md', 'scripts/build.sh', 'src/main/main.ts', 'Cargo.toml', 'web/index.html', 'src/components/Button.tsx', 'config/settings.yaml', '.github/workflows/ci.yml'];
  const dirs = ['src', 'tests', 'docs', 'scripts', 'dist', 'build', 'lib', 'app', 'web', 'packages/core'];
  const branches = ['main', 'develop', 'feature/login-form', 'fix/1974-chip', 'release/2.3', 'chore/deps', 'hotfix/null-check'];
  const words = ['user', 'session', 'render', 'config', 'listen', 'TODO', 'handleClick', 'fetchData', 'parseArgs', 'export default', 'import React', 'useEffect', 'async function'];
  const pkgs = ['lodash@4.17.21', 'react@18.3.1', 'typescript', 'eslint', 'vitest', '@types/node', 'express', 'zod@3.23.8', 'prettier'];
  const hosts = ['github.com', 'docs.python.org', 'developer.mozilla.org', 'registry.npmjs.org', 'example.com', 'localhost:3000', 'api.example.com', 'en.wikipedia.org', 'stackoverflow.com', 'pkg.go.dev'];
  const paths = ['', '/', '/docs', '/en-US/docs/Web/API/fetch', '/3/library/os.html', '/acme/app/pull/42', '/wiki/Shell_script', '/v1/items', '/questions/123456/how-to-split-a-string', '/react', '/search'];
  const qs = ['', '?page=2', '?q=react+hooks&sort=stars', '?tab=readme-ov-file', '#usage', '?lang=en&v=3', '?limit=20&offset=40', '?id=42'];
  const cmd = [
    () => `git status`, () => `git log --oneline -${5 + r(40)}`, () => `git checkout -b ${p(branches)}`, () => `git diff HEAD~${1 + r(5)} -- ${p(files)}`,
    () => `git commit -m "${p(['fix', 'feat', 'docs', 'chore'])}: update ${p(words)} handling"`, () => `git push origin ${p(branches)}`, () => `git rebase ${p(branches)}`,
    () => `git show ${(r(0xfffffff) + 0x1000000).toString(16).slice(0, 7)}`, () => `npm test`, () => `npm run ${p(['build', 'lint', 'typecheck', 'dev', 'start'])}`,
    () => `npm install ${p(pkgs)}`, () => `npm run lint -- --fix`, () => `node scripts/${p(['build', 'check', 'gen'])}.js --verbose`,
    () => `python3 -m pytest ${p(dirs)}/ -k ${p(words).replace(/\s.*/, '')} -q`, () => `ls -la ${p(dirs)}`, () => `cat ${p(files)}`,
    () => `grep -rn "${p(words)}" ${p(dirs)}`, () => `find . -name "*.${p(['ts', 'js', 'py', 'go', 'md'])}" -not -path "./node_modules/*"`,
    () => `sed -n ${1 + r(100)},${100 + r(200)}p ${p(files)}`, () => `docker build -t app:1.${r(10)} .`, () => `docker run --rm -p ${8000 + r(100)}:80 nginx`,
    () => `kubectl get pods -n ${p(['default', 'staging', 'kube-system'])}`, () => `curl -s https://${p(hosts)}${p(paths)}${p(qs)}`, () => `make -j${1 + r(16)}`,
    () => `cargo build --release`, () => `go test ./...`, () => `mkdir -p ${p(dirs)}/${p(words).replace(/\s.*/, '')}`, () => `rm -rf ${p(['dist', 'build', 'node_modules/.cache', 'coverage'])}`,
    () => `cp ${p(files)} /tmp/backup`, () => `echo "Hello, ${p(['world', 'team', 'Ada'])}"`, () => `wc -l ${p(files)}`, () => `head -n ${10 + r(50)} ${p(files)}`,
    () => `tail -f logs/app.log`, () => `ps aux | grep node`, () => `export NODE_ENV=production`, () => `cd ${p(dirs)} && npm test`,
    () => `cat <<'EOF' > ${p(files)}\nline one\n  line two ${p(words)}\nEOF`, () => `Get-ChildItem -Recurse -Filter *.${p(['ts', 'ps1'])}`, () => `cmd /c dir ${p(dirs)}`,
    () => `pip install -r requirements.txt`, () => `yarn add ${p(pkgs)}`, () => `npx tsc -p tsconfig.json --noEmit`, () => `du -sh ${p(dirs)}`,
    () => `for f in ${p(dirs)}/*.md; do\n  echo "$f"\ndone`, () => `jq '.scripts' package.json`, () => `tar -czf out.tgz ${p(dirs)}`, () => `chmod +x ${p(['scripts/build.sh', 'run.sh'])}`,
  ];
  const out = new Map();
  let guard = 0;
  while (out.size < 3000 && guard++ < 100000) {
    const k = r(10);
    let it;
    if (k < 3) it = { tool: 'bash', raw: p(cmd)() };
    else if (k < 5) it = { tool: 'bash', raw: `${p(cmd)()}${p([' && ', ' | head -n ' + (5 + r(60)) + ' && ', ' || ', '; '])}${p(cmd)()}` };
    else if (k < 6) it = { tool: 'bash', raw: `${p(cmd)()} 2>&1 | ${p(['tail -n ' + (10 + r(90)), 'grep -v warn', 'sort | uniq -c', 'tee out.log'])}` };
    else if (k < 8) it = { tool: 'web_fetch', raw: `https://${p(hosts)}${p(paths)}${p(qs)}` };
    else if (k < 9) it = { tool: 'view', raw: p([p(files), `~/work/${p(files)}`, `${p(dirs)}/${p(files)}`]) };
    else it = { tool: 'grep', raw: p(words) };
    out.set(it.tool + '\u0000' + it.raw, it);
  }
  return [...out.values()];
}

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { js, until } = H;
  const emit = (e) => js(`window.__durbarSimEmit(Object.assign(${jsLiteral(e)},{timestamp:Date.now()}))`);
  const hid = (t) => /\[redacted\]/.test(t) || (t.lastIndexOf('[') >= 0 && '[redacted]'.startsWith(t.slice(t.lastIndexOf('[')))); // the mark, or its head where the 400 cut falls in it
  const leak = (t) => NEEDLES.find((n) => String(t).toLowerCase().includes(n));
  /* what a chip shows: line, title, aria-labels, open command, the copied text (Copy pressed, the page's own handler), HTML */
  let ID = '';
  const read = (callId) => js(`(async()=>{const c=window.__durbarSimUi.chipEl(${jsLiteral(ID)},${jsLiteral(callId)});if(!c||!c.isConnected)return null;
      const code=(c.querySelector('code')||{}).textContent||'', pre=(c.querySelector('pre.cmd')||{}).textContent||'';
      const aria=[c,...c.querySelectorAll('*')].map(e=>e.getAttribute('aria-label')||'').join(' | ');
      let copied='',asked=false,dlg='';const b=c.querySelector('.cp-cmd');
      if(b){const w=navigator.clipboard.writeText;navigator.clipboard.writeText=t=>{copied=String(t);return Promise.resolve();};try{b.click();await new Promise(r=>setTimeout(r,30));
        const d=document.querySelector('#modeDlg [role=alertdialog]');if(d){asked=true;dlg=d.outerHTML;d.querySelector('[data-cancel]').click();await new Promise(r=>setTimeout(r,30));}}finally{navigator.clipboard.writeText=w;}}
      return {code,title:c.title,aria,pre,copied,asked,dlg,hasCopy:!!b,html:c.outerHTML};})()`);
  const checkChip = async (tag, callId, phase, hides = true, long = false) => {
    const v = await read(callId);
    assert.ok(v, `${tag}: the chip of ${callId} is in the chat`);
    let x;
    x = leak(v.code); assert.ok(!x, `${tag} ${phase}: LABEL shows "${x}"`);
    x = leak(v.title); assert.ok(!x, `${tag} ${phase}: TITLE shows "${x}"`);
    x = leak(v.aria); assert.ok(!x, `${tag} ${phase}: ARIA-LABEL shows "${x}"`);
    x = leak(v.pre); assert.ok(!x, `${tag} ${phase}: COMMAND shows "${x}"`);
    if (long) { // spec 005 FR-438: arrives empty; the chip names its length, shows none of it and has no open command
      x = leak(v.html); assert.ok(!x, `${tag} ${phase}: HTML holds "${x}"`);
      assert.ok(v.code === '' && !v.hasCopy && /Arguments too long to show \([\d,]+ characters\)/.test(v.title), `${tag} ${phase}: an over-limit argument is named, not shown: ${JSON.stringify(v.title)}`);
      return v;
    }
    assert.ok(v.hasCopy, `${tag} ${phase}: the open chip has Copy`);
    x = leak(v.copied); assert.ok(!x, `${tag} ${phase}: COPY copies "${x}"`);
    // spec 005 FR-411: Copy on a chip whose argument was masked (or cut) asks first; Cancel copies nothing (check-005-chip-copy drives Copy anyway)
    assert.ok(v.asked && v.copied === '', `${tag} ${phase}: Copy asks first and Cancel copies nothing (asked ${v.asked}, copied ${v.copied.length} characters)`);
    x = leak(v.dlg); assert.ok(!x, `${tag} ${phase}: the confirm shows "${x}"`);
    x = leak(v.html); assert.ok(!x, `${tag} ${phase}: HTML holds "${x}"`);
    if (hides) assert.ok(hid(v.code) && /\[redacted\]/.test(v.pre), `${tag} ${phase}: the chip says what it hid: ${v.code.slice(0, 120)}`);
    return v;
  };
  const open = async (id) => { await js(`window.__durbarSimUi.crew.openPanel(${jsLiteral(id)})`); await until(`document.body.classList.contains('panel-open')&&!!document.getElementById('chat')`, 10000); };
  const agentId = () => js(`(()=>{const a=window.__durbarSimUi.agents().find(x=>!x.parent&&x.live);return a?a.id:''})()`);

  const REAL = `!!document.querySelector('#stage .ro .ro-plate')&&document.getElementById('stage').dataset.d==='real'`;
  for (const [world, query] of [['flat', {}], ['real', { officeview: 'real' }]]) {
    await H.load({ w: 1440, h: 900, query, ready: world === 'real' ? REAL : 'fit', settle: world !== 'real' });
    const id = ID = await agentId();
    assert.ok(id, `${world}: a live agent`);
    await open(id);
    for (const c of CASES) {
      // start: the argument arrives with the start event
      const cs = `${world}-${c.id}-s`;
            await emit({ type: 'toolCall', sessionId: id, callId: cs, tool: c.tool, phase: 'start', args: c.args });
      assert.ok(await until(`!!window.__durbarSimUi.chipEl(${jsLiteral(ID)},${jsLiteral(cs)})`, 5000), `${world}: chip ${cs}`);
      await checkChip(world, cs, 'start ' + c.id, c.hides !== false, !!c.long);
      // update: the call starts with a harmless argument, a later update brings the whole arguments (spec 005 FR-019)
      const cu = `${world}-${c.id}-u`;
      const n0 = await js(`window.__durbarSimUi.chipMasks()`);
      await emit({ type: 'toolCall', sessionId: id, callId: cu, tool: c.tool, phase: 'start', args: c.tool === 'web_fetch' ? { url: 'https://example.com/' } : { command: 'echo start' } });
      assert.ok(await until(`!!window.__durbarSimUi.chipEl(${jsLiteral(ID)},${jsLiteral(cu)})`, 5000), `${world}: chip ${cu}`);
      await emit({ type: 'toolCall', sessionId: id, callId: cu, tool: c.tool, phase: 'update', args: c.args });
      for (let i = 0; i < 20; i++) await emit({ type: 'toolCall', sessionId: id, callId: cu, tool: c.tool, phase: 'update', output: 'line ' + i + '\n' });
      await emit({ type: 'toolCall', sessionId: id, callId: cu, tool: c.tool, phase: 'complete', output: 'done' });
      assert.ok(await until(`(()=>{const c=window.__durbarSimUi.chipEl(${jsLiteral(ID)},${jsLiteral(cu)});return !!c&&!c.classList.contains('run')})()`, 5000), `${world}: chip ${cu} done`);
      const n1 = await js(`window.__durbarSimUi.chipMasks()`);
      // work counter: the start masks once, the update with arguments once; 20 output updates and the end add nothing (an edit masks its file too)
      assert.ok(n1 - n0 <= 2, `${world} ${c.id}: WORK the chip's mask ran ${n1 - n0} times for one start, one argument update and 21 output events (at most 2)`);
      await checkChip(world, cu, 'update ' + c.id, c.hides !== false, !!c.long);
    }
    // the masked text is the task line's (the same mask): a chip never shows more than the header's task line for the same call
    console.log(`[toolchip-mask] ${world}: ${CASES.length * 2} chips masked (start and update)`);
  }

  // continuation: the chip hides whatever the task line (the flat reading) hides, for each break kind
  {
    await H.load({ w: 1440, h: 900, query: {}, ready: 'fit' });
    const id = ID = await agentId();
    await open(id);
    let hiddenByTask = 0;
    for (const c of CONT) {
      const cs = 'cont-' + c.id;
      await emit({ type: 'toolCall', sessionId: id, callId: cs, tool: 'bash', phase: 'start', args: { command: c.raw } });
      assert.ok(await until(`!!window.__durbarSimUi.chipEl(${jsLiteral(ID)},${jsLiteral(cs)})`, 5000), `chip ${cs}`);
      const v = await read(cs);
      const task = String(await js(`window.__durbarSimUi.taskLabel('bash',${jsLiteral(c.raw)})`));
      if (task.includes(CB)) continue; // the task line shows it too: not more than the task line
      hiddenByTask++;
      for (const [k, t] of [['line', v.code], ['title', v.title], ['command', v.pre], ['copy', v.copied], ['html', v.html]]) assert.ok(!t.includes(CB), `CONTINUATION ${c.id}: the chip's ${k} shows what the task line hides: ${t.slice(0, 120)}`);
    }
    assert.ok(hiddenByTask >= 4, `CONTINUATION: the task line hides the value in ${hiddenByTask} cases (the check needs some)`);
  }

  // the other feeds of a chip: a replayed history, the VS Code transcript, a demo turn; labels cut by the adapters at their caps
  {
    const chatText = () => js(`(document.getElementById('chat')||document.body).outerHTML.toLowerCase()`);
    const pathCheck = async (tag, needles) => { const t = await chatText(); for (const n of needles) assert.ok(!t.includes(n), `${tag} shows "${n.slice(0, 14)}..."`); assert.ok(/\[redacted\]|\u2026|…/.test(t), `${tag}: the chips are there`); };
    const cut300 = cutAt(300, ''), cut200 = cutAt(200, '\u2026'), cut299 = cutAt(299, '\u2026'), cut199 = cutAt(199, '\u2026');
    await H.load({ w: 1440, h: 900, query: {}, ready: 'fit' });
    let id = ID = await agentId();
    await open(id);
    const items = [{ type: 'tool', callId: 'r0', tool: 'bash', label: CASES[0].args.command }, { type: 'tool', callId: 'r1', tool: 'bash', label: CASES[2].args.command }];
    FAM.forEach((t, i) => { items.push({ type: 'tool', callId: 'ra' + i, tool: 'bash', label: cut300(t) }); items.push({ type: 'tool', callId: 'rb' + i, tool: 'shell', label: cut200(t) }); });
    await js(`window.__durbarSimUi.replay(${jsLiteral(id)},${jsLiteral(items)})`);
    await pathCheck('REPLAY', [...PATHNEEDLES, ...FAM_NEEDLES]);
    const blocks = [{ type: 'user', text: 'hi' }, { type: 'tool', label: CASES[0].args.command }, { type: 'tool', label: CASES[2].args.command }];
    FAM.forEach((t) => { blocks.push({ type: 'tool', label: cut299(t) }); blocks.push({ type: 'tool', label: cut199(t) }); });
    await js(`window.__durbarSimUi.vsView(${jsLiteral(id)},${jsLiteral({ title: 'VS Code chat', blocks, notes: [], shownRequests: 1, totalRequests: 1 })})`);
    assert.ok(await until(`!!document.querySelector('.vsview .chip')`, 5000), 'VSCODE: the transcript is shown');
    await pathCheck('VSCODE', [...PATHNEEDLES, ...FAM_NEEDLES]);
    await H.load({ w: 1440, h: 900, query: {}, ready: 'fit' });
    id = ID = await agentId();
    await open(id);
    await js(`window.__durbarSimUi.demoTurn(${jsLiteral(id)},${jsLiteral([['run', CASES[0].args.command, 'ok', 'ok'], ['run', CASES[2].args.command, 'ok', 'ok']])})`);
    assert.ok(await until(`[...document.querySelectorAll('#chat .chip code')].some(c=>/\[redacted\]/.test(c.textContent))`, 8000), 'DEMO: the demo chips are there');
    await pathCheck('DEMO', PATHNEEDLES);
    console.log(`[toolchip-mask] continuation, replay, VS Code and demo feeds masked`);
  }

  // the adapter-cut rule takes only a label at an adapter's cap: a harmless replayed or VS Code label of 199 to 299 characters reads as
  // chipArg reads it (one pin per path: 250 characters), and so does every line of 199 to 299 characters of this repository's sources and specs
  {
    await H.load({ w: 1440, h: 900, query: {}, ready: 'fit' });
    const pin = ('npm run build && ' + 'node scripts/build-step.js --quiet && '.repeat(6) + 'echo finished building the whole project tree').slice(0, 250);
    assert.strictEqual(pin.length, 250);
    const fs = require('fs'), path = require('path');
    const lines = new Set();
    const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else if (/\.(js|ts|md)$/.test(e.name)) for (const l of fs.readFileSync(f, 'utf8').split(/\r?\n/)) { const t = l.replace(/\s+/g, ' ').trim(); if (t.length >= 199 && t.length <= 299) lines.add(t); } } };
    for (const d of ['src', 'specs', 'scripts']) walk(path.join(__dirname, '..', d));
    const r = await js(`(()=>{const U=window.__durbarSimUi,pin=${jsLiteral(pin)},ls=${jsLiteral([...lines])};
      const pins={replay:U.cutLabel('bash',pin),vscode:U.cutLabel('tool',pin)};let bad=0;const ex=[];
      for(const l of ls){if(U.cutLabel('bash',l)!==U.chipArg('bash',l).label||U.cutLabel('tool',l)!==U.chipArg('tool',l).label){bad++;if(ex.length<5)ex.push(l.slice(0,120));}}
      return {pins,n:ls.length,bad,ex};})()`);
    assert.strictEqual(r.pins.replay, pin, 'CUT-PIN replay: a 250-character harmless label reads unchanged');
    assert.strictEqual(r.pins.vscode, pin, 'CUT-PIN VS Code: a 250-character harmless label reads unchanged');
    console.log(`[toolchip-mask] adapter-cut rule: ${r.n} repo lines of 199-299 characters, changes ${r.bad}`);
    for (const e of r.ex) console.log('  changed:', e);
    assert.strictEqual(r.bad, 0, `CUT-RULE ${r.bad} of ${r.n} uncut lines lose their last word`);
  }

  // differential: the harmless corpus shows exactly what main shows (main: label = raw one line cut at 400, full = raw cut at 20,000)
  {
    await H.load({ w: 1440, h: 900, query: {}, ready: 'fit' });
    const items = corpus();
    assert.ok(items.length >= 3000, `the corpus has ${items.length} items`);
    const r = await js(`(()=>{const items=${jsLiteral(items)};const bad=[];const k={};
      for(const it of items){const m=window.__durbarSimUi.chipArg(it.tool,it.raw);k[it.tool]=(k[it.tool]||0)+1;
        const lab=it.raw.replace(/\\s+/g,' ').slice(0,400), full=it.raw.slice(0,20000);
        if(m.label!==lab||m.full!==full)bad.push({tool:it.tool,raw:it.raw,label:m.label,full:m.full});}
      return {n:items.length,bad:bad.slice(0,20),nBad:bad.length,k};})()`);
    console.log(`[toolchip-mask] differential: ${r.n} harmless items ${JSON.stringify(r.k)}, changes ${r.nBad}`);
    for (const b of r.bad) console.log('  changed:', JSON.stringify(b).slice(0, 300));
    assert.strictEqual(r.nBad, 0, `DIFFERENTIAL ${r.nBad} of ${r.n} harmless arguments read differently from main`);
    const near = await js(`(()=>{const f=window.__durbarSimUi.chipArg;return {same:${jsLiteral(NEAR_SAME)}.map(([t,x])=>{const m=f(t,x);return m.label===x&&m.full===x?'':x+' => '+m.full;}).filter(Boolean),
      hidden:${jsLiteral(NEAR_HIDDEN)}.map(([t,x])=>{const m=f(t,x);return /\[redacted\]/.test(m.label)&&/\[redacted\]/.test(m.full)?'':x+' => '+m.full;}).filter(Boolean)};})()`);
    assert.deepStrictEqual(near.same, [], 'NEAR-MISS harmless text the task line keeps reads as on main');
    assert.deepStrictEqual(near.hidden, [], 'NEAR-MISS text the task line hides by its own rule is hidden on the chip too');
  }

  // fail closed: no redact module, the chip shows the tool name only
  {
    await H.load({ w: 1440, h: 900, query: { noredact: '1' }, ready: 'fit' });
    const id = ID = await agentId();
    await open(id);
    const cs = 'noredact-hdr';
        await emit({ type: 'toolCall', sessionId: id, callId: cs, tool: 'bash', phase: 'start', args: CASES[0].args });
    assert.ok(await until(`!!window.__durbarSimUi.chipEl(${jsLiteral(ID)},${jsLiteral(cs)})`, 5000), 'noredact: the chip');
    const v = await js(`(()=>{const c=window.__durbarSimUi.chipEl(${jsLiteral(ID)},${jsLiteral(cs)});return {code:(c.querySelector('code')||{}).textContent,html:c.outerHTML};})()`);
    assert.ok(!leak(v.html) && v.code === '', `noredact: FAIL-CLOSED the chip shows no argument: ${JSON.stringify(v.code)}`);
  }
  console.log('[toolchip-mask] all checks passed');
};
module.exports.corpus = corpus;
