/*
 * Check for spec 052 (2026-11-20 delta, issue #1934, T423): the form variant of the question card (an MCP server asks an agent for input) renders
 * its message like the question card does (the chat's own safe renderer, after the masks) and shows all of it. Simulator only (no AI credits).
 *
 *   npm run check:ui -- --only check-elicit-markdown
 *
 * `simelicit=md` asks for input with a Markdown message of about 6,500 characters: bold, a numbered list of three, a code span, a link, a raw `<b>` tag,
 * an invented token (built from pieces) and a last line. At 1440x900 and 1280x800 with 15 agents, in the flat office and the Real office: the card shows a
 * <strong>, an <ol> of three items, a <code>, a link with its href, no `**`; the raw tag is text, never an element; the token is in no text, title or
 * label of the card; the whole message is there (the last line, no ellipsis at its end: the old cut was 2,000 characters); the card keeps its group name
 * "An MCP server asks for input", its message is its description (aria-describedby), the form's fields and buttons are still there; every text in the
 * message is at least 10.5px, nothing is cut or clamped and the card stays inside the chat without a sideways scroll.
 * Mutant (a patched copy of dist, each must die at its own label):
 *   ELICIT_MD_MUTANT=plain   the message as plain text again, cut at 2,000 (`qb.innerHTML=qMdHTML(R.message||'')` -> `qb.textContent=String(R.message||'').slice(0,2000)`)  => "the bold is a <strong>"
 *   ELICIT_MD_MUTANT=raw     the message rendered from the unmasked text (`qMdHTML(R.message||'')` -> `window.DurbarMD.render(String(R.message||''))`)  => "the token"
 * A miss prints DRIVER FAILED (Electron still exits 0), so the npm script exits non-zero unless "all checks passed" is printed.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { helpers, jsLiteral } = require('./driver-helpers');
const MUTANT = process.env.ELICIT_MD_MUTANT || '';
const WORLDS = (process.env.ELMD_WORLDS || 'flat,real').split(',');
const PATCH = {
  plain: ["qb.innerHTML=qMdHTML(R.message||'')", "qb.textContent=String(R.message||'').slice(0,2000)"],
  raw: ["qb.innerHTML=qMdHTML(R.message||'')", "qb.innerHTML=window.DurbarMD.render(String(R.message||''))"],
};
module.exports = async (ctx) => {
  let INDEX;
  if (MUTANT) {
    assert.ok(PATCH[MUTANT], `ELICIT_MD_MUTANT is plain or raw, not ${MUTANT}`);
    const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-elmd-'));
    fs.cpSync(path.join(__dirname, '..', 'dist'), copy, { recursive: true }); // the page reads ../shared too
    const f = path.join(copy, 'renderer', 'app.js'); const src = fs.readFileSync(f, 'utf8'); const [from, to] = PATCH[MUTANT];
    assert.strictEqual(src.split(from).length - 1, 1, `the ${MUTANT} mutant finds its line in app.js once`);
    fs.writeFileSync(f, src.replace(from, () => to));
    INDEX = path.join(copy, 'renderer', 'index.html');
  }
  const H = helpers(ctx);
  const { settle, js } = H;
  for (const world of WORLDS) for (const [w, h] of [[1440, 900], [1280, 800]]) {
    const tag = `${world} ${w}x${h}`;
    const query = { sim: '15', simelicit: 'md', ...(world === 'flat' ? {} : { officeview: 'real' }) };
    await H.load({ w, h, query, ready: 'fit', ...(INDEX ? { index: INDEX } : {}) });
    let ok;
    if (world === 'flat') ok = (await H.openSimAgent(`a=>!a.parent&&a.question`, '#chat .note.question.elicit .q-md')).ok;
    else { // the Real office has no desks: open the asking agent's chat as check-question-markdown does
      const id = await H.until(`((window.__durbarSimUi&&window.__durbarSimUi.agents().find(a=>!a.parent&&a.question))||{}).id`, 20000) && await js(`window.__durbarSimUi.agents().find(a=>!a.parent&&a.question).id`);
      await js(`window.__durbarSimUi.crew.openPanel(${jsLiteral(id)})`);
      ok = await H.until("document.body.classList.contains('panel-open')&&!!document.querySelector('#chat .note.question.elicit .q-md')", 15000);
    }
    assert.ok(ok, `${tag}: an agent has the MCP form in its chat`);
    await settle();
    await js(`document.querySelector('#chat .note.question.elicit').scrollIntoView({block:'start'})`); await settle();
    const r = await js(`(()=>{const card=document.querySelector('#chat .note.question.elicit'),q=card.querySelector('.q-text'),md=q.querySelector('.q-md'),chat=document.getElementById('chat');
      const all=[card.innerHTML,card.textContent,...[...card.querySelectorAll('[title],[aria-label],[placeholder]')].map(e=>(e.title||'')+(e.getAttribute('aria-label')||'')+(e.getAttribute('placeholder')||''))].join('\\n');
      const els=[q,...q.querySelectorAll('*')];
      const small=els.filter(e=>parseFloat(getComputedStyle(e).fontSize)<10.5).map(e=>e.tagName+':'+getComputedStyle(e).fontSize);
      const cut=els.filter(e=>{const c=getComputedStyle(e);return e.scrollHeight>e.clientHeight+1&&e.tagName!=='CODE'&&c.overflowY!=='visible'||c.textOverflow==='ellipsis'||(c.webkitLineClamp&&c.webkitLineClamp!=='none');}).map(e=>e.tagName);
      const cr=card.getBoundingClientRect(),hr=chat.getBoundingClientRect(),a=md.querySelector('a'),t=md.textContent.trim();
      return {strong:[...md.querySelectorAll('strong')].map(x=>x.textContent),ol:md.querySelectorAll('ol>li').length,code:[...md.querySelectorAll('code')].map(x=>x.textContent),
        href:a&&a.getAttribute('href'),stars:q.textContent.includes('**'),rawB:!!md.querySelector('b'),rawBText:md.textContent.includes('<b>not bold</b>'),
        leak:/ghp_|A1b2C3d4|E5f6G7h8/.test(all),len:t.length,last:t.endsWith('LAST-LINE-OF-THE-MESSAGE'),ellipsis:t.endsWith('…'),small,cut,
        group:card.getAttribute('role')+'|'+card.getAttribute('aria-label'),desc:card.getAttribute('aria-describedby')===q.id&&!!q.id,
        fields:card.querySelectorAll('select,input,textarea').length,buttons:[...card.querySelectorAll('button')].map(b=>b.textContent),
        inside:cr.left>=hr.left-1&&cr.right<=hr.right+1,sideways:chat.scrollWidth>chat.clientWidth+1,text:md.textContent.slice(0,100),html:md.innerHTML.slice(0,240)}})()`);
    assert.deepStrictEqual(r.strong.slice(0, 3), ['Where should this deploy go?', 'Staging:', 'Production:'], `${tag}: the bold is a <strong>: ${r.html}`);
    assert.strictEqual(r.ol, 3, `${tag}: the numbered points are a list of three: ${JSON.stringify(r)}`);
    assert.ok(r.code.includes('settings.ts'), `${tag}: the code span is a <code>: ${JSON.stringify(r.code)}`);
    assert.strictEqual(r.href, 'https://example.com/runbook', `${tag}: the link keeps its address`);
    assert.ok(!r.stars, `${tag}: no ** marks are left`);
    assert.ok(!r.rawB && r.rawBText, `${tag}: a raw <b> tag is text, never an element`);
    assert.ok(!r.leak, `${tag}: the token is in no text, title or label of the card (masked before it is rendered)`);
    assert.ok(r.last && !r.ellipsis && r.len > 5000, `${tag}: the whole message is shown, not cut at 2,000 characters (${r.len} characters, last line ${r.last}, ellipsis ${r.ellipsis})`);
    assert.strictEqual(r.group, 'group|An MCP server asks for input', `${tag}: the card keeps its group name`);
    assert.ok(r.desc, `${tag}: the message is the card's description`);
    assert.ok(r.fields >= 2 && r.buttons.length >= 2, `${tag}: the form's fields and buttons are still there: ${JSON.stringify({ f: r.fields, b: r.buttons })}`);
    assert.deepStrictEqual(r.small, [], `${tag}: every text in the message is at least 10.5px`);
    assert.deepStrictEqual(r.cut, [], `${tag}: nothing is cut or clamped`);
    assert.ok(r.inside && !r.sideways, `${tag}: the card stays inside the chat, no sideways scroll`);
    if (!MUTANT && process.env.OUT) await ctx.shot(path.join(process.env.OUT, `052-elicit-markdown-${world}-${w}x${h}.png`));
  }
  console.log('[elicit-md] all checks passed');
};
