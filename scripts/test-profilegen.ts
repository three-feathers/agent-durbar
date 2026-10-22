/**
 * Create an Agent Success Profile with AI (spec 043 FR-021/FR-022, T015a): the prompt carries the skeleton, the target app's front
 * matter rules and only what the user typed; the reply check refuses missing sections, tools the user did not name, `*`, no tools
 * line, extra front matter keys and no front matter, and strips HTML. `npm run test:profilegen`. No agent app, no credits.
 */
import * as assert from 'assert';
import * as path from 'path';
import { buildProfilePrompt, MAX_GEN_ANSWER, MAX_PROFILE_BYTES, parseToolList, PROFILE_QUESTIONS, profileTemplate, SUCCESS_SECTIONS, userTextOf, validateGeneratedProfile } from '../src/shared/profiletemplates';
import { generateProfile } from '../src/main/profilegen';
import type { OneShot } from '../src/main/profilegen';
import { MAX_PROFILE_BYTES as SAVE_LIMIT } from '../src/main/profilefiles';
import type { FrontmatterParse, GenInput } from '../src/shared/profiletemplates';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const PE = require(path.join(__dirname, '..', '..', 'src', 'renderer', 'profileeditor.js')) as { parseFrontmatter(t: string): FrontmatterParse };
const parse = (t: string): FrontmatterParse => PE.parseFrontmatter(t);

// ---- prompt ----
const Q: GenInput = { app: 'claude', name: 'pay-reviewer', mode: 'questions', answers: { title: 'Payments reviewer', tools: 'Read, Grep and Edit only after I agree', behavior: 'Brief, asks me when unsure', bogus: 'ignored' } as Record<string, string> };
{
  const p = buildProfilePrompt(Q);
  for (const s of ['Payments reviewer', 'Read, Grep and Edit only after I agree', 'Brief, asks me when unsure', 'name: pay-reviewer', '# Agent Success Profile: pay-reviewer']) assert.ok(p.includes(s), `prompt has ${s}`);
  for (const s of SUCCESS_SECTIONS) assert.ok(p.includes('## ' + s.heading), `skeleton section ${s.heading}`);
  assert.ok(!p.includes('ignored'), 'only the known questions');
  assert.ok(/Never add any other tool/.test(p) && /only these, written exactly: Read, Grep, Glob\./.test(p), 'tool rule and the read-only defaults');
  assert.ok(/only these, written exactly: Read, Grep, Glob, Bash\(git:\*\)\./.test(buildProfilePrompt({ ...Q, tools: ['Bash(git:*)'] })), 'the Extra tools line is the only addition');
  assert.ok(!/[\\/]home[\\/]|[A-Z]:\\|~\/|https?:/.test(p), 'no paths or URLs that the user did not type');
  const cp = buildProfilePrompt({ app: 'copilot', name: 'x', mode: 'describe', description: 'A docs helper' });
  assert.ok(/tools: \[view, grep, glob\]/.test(cp) && /no model line/.test(cp) && cp.includes('A docs helper'), 'Copilot rules');
  const long = buildProfilePrompt({ app: 'claude', name: 'x', mode: 'questions', answers: { title: 'y'.repeat(5000) } });
  assert.ok(!long.includes('y'.repeat(MAX_GEN_ANSWER + 1)) && long.includes('y'.repeat(MAX_GEN_ANSWER)), 'answers capped');
  assert.strictEqual(PROFILE_QUESTIONS.length, 8);
  assert.deepStrictEqual([...new Set(PROFILE_QUESTIONS.map((q) => q.section))].sort(), SUCCESS_SECTIONS.map((s) => s.heading).sort(), 'one question per section');
  assert.strictEqual(userTextOf({ app: 'claude', name: 'x', mode: 'describe', description: ' a\u0001b ' }), 'a b', 'control characters out');
}

// ---- reply check ----
const filled = (app: 'claude' | 'copilot', name: string, tools?: string, extra = ''): string => {
  let t = profileTemplate(app, name, 'success');
  if (tools !== undefined) t = t.replace(/^tools: .*$/m, tools);
  return extra ? t.replace('---\n\n', extra + '---\n\n') : t;
};
{
  const ok = validateGeneratedProfile(filled('claude', 'pay-reviewer'), Q, parse);
  assert.ok(ok.ok, JSON.stringify(ok));
  const named = validateGeneratedProfile(filled('claude', 'pay-reviewer', 'tools: Read, Grep, Edit'), Q, parse);
  assert.ok(!named.ok && /Edit/.test(named.error), 'Edit named only in an answer is refused (FR-027: text never grants)');
  const listed = validateGeneratedProfile(filled('claude', 'pay-reviewer', 'tools: Read, Grep, Edit'), { ...Q, tools: ['Edit'] }, parse);
  assert.ok(listed.ok && listed.extraTools.join() === 'Edit' && listed.warnings.some((w) => /Tools beyond read-only: Edit\. Check them/.test(w)), 'Edit listed under Extra tools: granted and shown');
  const broader = validateGeneratedProfile(filled('claude', 'pay-reviewer', 'tools: Read, Bash'), Q, parse);
  assert.ok(!broader.ok && /Bash/.test(broader.error), 'Bash refused: not named');
  const star = validateGeneratedProfile(filled('claude', 'pay-reviewer', 'tools: "*"'), Q, parse);
  assert.ok(!star.ok, '* refused');
  const noTools = validateGeneratedProfile(filled('claude', 'pay-reviewer').replace(/^tools: .*\n/m, ''), Q, parse);
  assert.ok(!noTools.ok && /no tools line/.test(noTools.error), 'a missing tools line is refused (it would allow every tool)');
  const partial = validateGeneratedProfile(filled('claude', 'pay-reviewer').replace(/## Key Success Criteria\n/, ''), Q, parse);
  assert.ok(!partial.ok && /Key Success Criteria/.test(partial.error), 'a missing section is refused');
  const mcp = validateGeneratedProfile(filled('copilot', 'pay-reviewer', undefined, 'mcp-servers:\n  github:\n    type: http\n'), { ...Q, app: 'copilot' }, parse);
  assert.ok(!mcp.ok && /mcp-servers/.test(mcp.error), 'extra front matter keys refused');
  assert.ok(!validateGeneratedProfile('# no front matter', Q, parse).ok);
  assert.ok(!validateGeneratedProfile(filled('claude', 'pay-reviewer').replace(/^description: .*\n/m, ''), Q, parse).ok, 'no description refused');
  const html = validateGeneratedProfile('```markdown\n' + filled('claude', 'pay-reviewer').replace('## Skills\n', '## Skills\n<script>alert(1)</script><img src=x onerror=alert(1)>\n') + '\n```', Q, parse);
  assert.ok(html.ok && !/<[A-Za-z!/?]/.test(html.text) && html.text.includes('&lt;script>') && html.warnings.filter((w) => /HTML/.test(w)).length === 1, 'fence removed, HTML kept only as text, with a note');
  // nested and overlapping tags, comments, closing tags: no "<" that opens a tag survives (one pass, nothing re-forms)
  for (const evil of ['<scr<script>ipt>alert(1)</scr</script>ipt>', '<<script>script>x', '<!--<script>-->', '</style><svg/onload=x>', '<<img src=x onerror=y>>', '<?xml x?>', '<ScRiPt>a</sCrIpT>']) {
    const r = validateGeneratedProfile(filled('claude', 'pay-reviewer').replace('## Skills\n', '## Skills\n' + evil + '\n'), Q, parse);
    assert.ok(r.ok && !/<[A-Za-z!/?]/.test(r.text), `neutralised: ${evil}`);
  }
  assert.ok(validateGeneratedProfile(filled('claude', 'pay-reviewer').replace('## Skills\n', '## Skills\nUse a < b and 3<4 as text\n'), Q, parse).ok, 'a plain "<" stays');
  const renamed = validateGeneratedProfile(filled('claude', 'other-name'), Q, parse);
  assert.ok(renamed.ok && /^---\nname: pay-reviewer\n/.test(renamed.text), 'the chosen name wins');
  const cop = validateGeneratedProfile(filled('copilot', 'pay-reviewer'), { app: 'copilot', name: 'pay-reviewer', mode: 'describe', description: 'reviews code' }, parse);
  assert.ok(cop.ok, 'Copilot read-only defaults allowed');
  const copBroader = validateGeneratedProfile(filled('copilot', 'pay-reviewer', 'tools: [view, shell]'), { app: 'copilot', name: 'pay-reviewer', mode: 'describe', description: 'reviews code' }, parse);
  assert.ok(!copBroader.ok && /shell/.test(copBroader.error), 'Copilot shell refused when not named');
  assert.ok(!validateGeneratedProfile('x'.repeat(MAX_PROFILE_BYTES + 1), Q, parse).ok, 'too long');
  // tools with dots, colons and dashes, and a scope, compared whole (no pattern is built from them)
  const D = (description: string, tools?: string[]): GenInput => ({ app: 'claude', name: 'p', mode: 'describe', description, tools });
  assert.ok(validateGeneratedProfile(filled('claude', 'p', 'tools: Read, mcp.srv:do-x'), D('uses the server tool', ['mcp.srv:do-x']), parse).ok, 'a listed MCP tool name');
  assert.ok(!validateGeneratedProfile(filled('claude', 'p', 'tools: Read, mcpXsrv:do-x'), D('uses the server tool', ['mcp.srv:do-x']), parse).ok, '"." in a listed tool is not a wildcard');
}

// ---- FR-026..FR-028: tools only from the Extra tools line; text never grants (review on #505, change 1) ----
{
  const D = (description: string, tools?: string[], app: 'claude' | 'copilot' = 'claude'): GenInput => ({ app, name: 'p', mode: 'describe', description, tools });
  for (const [said, tool] of [['A reviewer that must never use Bash or Write', 'Bash'], ['A docs helper, no bash at all', 'Bash'], ["A reader: don't let it run Bash", 'Bash'], ['A reviewer that should never Edit files', 'Edit'], ['must never use Bash or Write', 'Write']]) {
    const r = validateGeneratedProfile(filled('claude', 'p', `tools: Read, Grep, Glob, ${tool}`), D(said), parse);
    assert.ok(!r.ok && r.error.includes(tool), `"${said}" does not grant ${tool}`);
    const safe = validateGeneratedProfile(filled('claude', 'p'), D(said), parse);
    assert.ok(safe.ok && safe.warnings.some((w) => w.startsWith(`You mentioned ${tool}; it is not granted`)) && safe.extraTools.length === 0, `"${said}": ${tool} in the warnings, nothing granted: ${JSON.stringify(safe)}`);
  }
  const q = validateGeneratedProfile(filled('claude', 'p', 'tools: Read, Bash'), { app: 'claude', name: 'p', mode: 'questions', answers: { tools: 'never use Bash' } }, parse);
  assert.ok(!q.ok, 'a questionnaire answer does not grant either');
  // an explicit scope only when listed, compared whole
  const git = filled('claude', 'p', 'tools: Read, Grep, Glob, Bash(git:*)');
  assert.ok(!validateGeneratedProfile(git, D('runs Bash(git:*) for history'), parse).ok, 'Bash(git:*) typed in the text is not granted');
  const ok = validateGeneratedProfile(git, D('reads history', ['Bash(git:*)']), parse);
  assert.ok(ok.ok && ok.extraTools.join() === 'Bash(git:*)' && ok.warnings.some((w) => /Tools beyond read-only: Bash\(git:\*\)/.test(w)), 'Bash(git:*) listed: granted and shown');
  assert.ok(!validateGeneratedProfile(filled('claude', 'p', 'tools: Read, Bash'), D('reads history', ['Bash(git:*)']), parse).ok, 'a listed scope does not allow the whole tool');
  const mentionedListed = validateGeneratedProfile(git, D('may use Bash for git', ['Bash(git:*)']), parse);
  assert.ok(mentionedListed.ok && !mentionedListed.warnings.some((w) => /You mentioned Bash/.test(w)), 'no "mentioned" warning for a listed tool');
  const cop = validateGeneratedProfile(filled('copilot', 'p', 'tools: [view, grep, glob, shell]'), D('never run shell commands', undefined, 'copilot'), parse);
  assert.ok(!cop.ok && /shell/.test(cop.error), 'Copilot: shell in text only is refused');
  assert.ok(validateGeneratedProfile(filled('copilot', 'p', 'tools: [view, grep, glob, shell]'), D('runs the tests', ['shell'], 'copilot'), parse).ok, 'Copilot: shell listed');
  // the parser
  assert.deepStrictEqual(parseToolList(' Bash(git:*), Edit ,, edit '), { ok: true, tools: ['Bash(git:*)', 'Edit'] });
  assert.deepStrictEqual(parseToolList(''), { ok: true, tools: [] });
  assert.deepStrictEqual(parseToolList(undefined), { ok: true, tools: [] });
  for (const bad of ['*', 'Bash(*), *', 'never use Bash', 'Bash(a(b))', 'rm -rf', '1abc', 'x'.repeat(62), 'Bash(' + 'a'.repeat(81) + ')', 7]) assert.ok(!parseToolList(bad).ok, `refused tools entry ${String(bad).slice(0, 30)}`);
  assert.ok(!parseToolList(Array.from({ length: 21 }, (_, i) => 't' + i).join(',')).ok, 'at most 20');
}

// ---- FR-029: name (review on #505, change 2) ----
{
  const noName = validateGeneratedProfile(filled('claude', 'x').replace(/^name: .*\n/m, ''), Q, parse);
  assert.ok(noName.ok && /^---\nname: pay-reviewer\n/.test(noName.text), 'no name key: inserted');
  const body = filled('claude', 'x').replace(/^name: .*\n/m, '').replace('## Skills\n', '## Skills\nname: keep-this-line\n');
  const b = validateGeneratedProfile(body, Q, parse);
  assert.ok(b.ok && b.text.includes('\nname: keep-this-line\n') && /^---\nname: pay-reviewer\n/.test(b.text), 'a body line "name:" is never rewritten: ' + (b.ok ? b.text.slice(0, 80) : b.error));
  const both = validateGeneratedProfile(filled('claude', 'other').replace('## Skills\n', '## Skills\nname: keep-this-line\n'), Q, parse);
  assert.ok(both.ok && both.text.includes('name: keep-this-line') && (both.text.match(/^name: pay-reviewer$/gm) ?? []).length === 1, 'front matter name rewritten, body untouched');
}

// ---- FR-030: size in bytes, after neutralising, the save path's limit (review on #505, change 3) ----
{
  assert.strictEqual(MAX_PROFILE_BYTES, SAVE_LIMIT, 'one limit for the reply and the save path');
  const withSkills = (x: string): string => filled('claude', 'pay-reviewer').replace('## Skills\n', '## Skills\n' + x + '\n');
  const grow = withSkills('<b'.repeat(Math.floor(MAX_PROFILE_BYTES / 3)));
  assert.ok(grow.length < MAX_PROFILE_BYTES, 'under the cap before neutralising');
  const g = validateGeneratedProfile(grow, Q, parse);
  assert.ok(!g.ok && /too long/.test(g.error), 'grows past the cap through &lt;');
  const multi = withSkills('é'.repeat(Math.floor(MAX_PROFILE_BYTES * 0.6)));
  assert.ok(multi.length < MAX_PROFILE_BYTES, 'under the cap in characters');
  const m = validateGeneratedProfile(multi, Q, parse);
  assert.ok(!m.ok && /too long/.test(m.error), 'over the cap in bytes: refused only on size');
  assert.ok(validateGeneratedProfile(withSkills('é'.repeat(Math.floor(MAX_PROFILE_BYTES * 0.45))), Q, parse).ok, 'the same reply under the cap passes');
}

// ---- profiles:generate with a fake one-shot (review on #505, change 4) ----
void (async () => {
  const calls: string[] = [];
  const good: OneShot = { name: 'Fake', generate: async (p) => { calls.push(p); return { text: filled('claude', 'pay-reviewer'), costUsd: 0.001 }; } };
  const deps = { oneShot: (id: string) => (id === 'fake' ? good : undefined), parse, errText: (e: unknown) => String(e) };
  const base = { app: 'claude', name: 'pay-reviewer', by: 'fake', mode: 'describe', description: 'A careful payments reviewer' };
  const ok = await generateProfile(base, deps);
  assert.ok(ok.ok && ok.by === 'Fake' && ok.costUsd === 0.001 && calls.length === 1, 'a good request');
  for (const [bad, why] of [[{ ...base, name: '../x' }, 'valid name'], [{ ...base, name: 7 }, 'valid name'], [{ ...base, app: 'codex' }, 'agent app'], [{ ...base, by: 'nope' }, 'cannot write'], [{ ...base, by: 3 }, 'cannot write'], [{ ...base, description: 'short' }, 'sentence'], [{ ...base, mode: 'questions', answers: { title: '  ' } }, 'at least one'], [{ ...base, tools: 'never use Bash' }, 'Not a tool name'], [{ ...base, tools: '*' }, 'Not a tool name'], [null, 'agent app']] as [unknown, string][]) {
    const before: number = calls.length;
    const r = await generateProfile(bad, deps);
    assert.ok(!r.ok && r.error.includes(why) && calls.length === before, `refused before any request: ${why} ${JSON.stringify(r)}`);
  }
  // caps: over-long text is refused before any request; exactly the cap is sent whole
  for (const [bad, why] of [[{ ...base, description: 'd'.repeat(2001) }, 'longer than 2000'], [{ ...base, mode: 'questions', answers: { title: 'ok', duties: 'a'.repeat(MAX_GEN_ANSWER + 1) } }, `longer than ${MAX_GEN_ANSWER}`]] as [unknown, string][]) {
    const before: number = calls.length;
    const r = await generateProfile(bad, deps);
    assert.ok(!r.ok && r.error.includes(why) && calls.length === before, `refused before any request: ${why}`);
  }
  assert.ok((await generateProfile({ ...base, description: 'd'.repeat(2000) }, deps)).ok && calls[calls.length - 1].includes('d'.repeat(2000)), 'exactly 2000 characters are sent');
  await generateProfile({ ...base, mode: 'questions', answers: { title: 'a'.repeat(MAX_GEN_ANSWER), bogus: 'zzz-unknown' } }, deps);
  const last = calls[calls.length - 1];
  assert.ok(last.includes('a'.repeat(MAX_GEN_ANSWER)) && !last.includes('zzz-unknown'), 'an answer at the cap is sent whole, unknown questions dropped');
  // tools go through the field only
  const withBash: OneShot = { name: 'Fake', generate: async () => ({ text: filled('claude', 'pay-reviewer', 'tools: Read, Bash(git:*)') }) };
  const d2 = { ...deps, oneShot: () => withBash };
  assert.ok(!(await generateProfile({ ...base, description: 'never use Bash(git:*) here' }, d2)).ok, 'text does not grant');
  const g2 = await generateProfile({ ...base, tools: 'Bash(git:*)' }, d2);
  assert.ok(g2.ok && g2.extraTools.join() === 'Bash(git:*)', 'the field grants');
  // a refused reply or a failing app: an error, nothing written (generateProfile has no write path), cost still reported
  const refused = await generateProfile(base, { ...deps, oneShot: () => ({ name: 'F', generate: async () => ({ text: '# no front matter', nanoAiu: 5 }) }) });
  assert.ok(!refused.ok && refused.nanoAiu === 5 && /front matter/.test(refused.error), 'a refused reply reports why and what it cost');
  const thrown = await generateProfile(base, { ...deps, oneShot: () => ({ name: 'F', generate: async () => { throw new Error('boom'); } }) });
  assert.ok(!thrown.ok && /boom/.test(thrown.error), 'a failing app');
  console.log('profile generation tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
