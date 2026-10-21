/**
 * Create an Agent Success Profile with AI (spec 043 FR-020/FR-021, T014a): the prompt carries the skeleton, the target app's front
 * matter rules and only what the user typed; the reply check refuses missing sections, tools the user did not name, `*`, no tools
 * line, extra front matter keys and no front matter, and strips HTML. `npm run test:profilegen`. No agent app, no credits.
 */
import * as assert from 'assert';
import * as path from 'path';
import { buildProfilePrompt, MAX_GEN_ANSWER, PROFILE_QUESTIONS, profileTemplate, SUCCESS_SECTIONS, userTextOf, validateGeneratedProfile } from '../src/shared/profiletemplates';
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
  assert.ok(/Never add any other tool/.test(p) && /Read, Grep, Glob/.test(p), 'tool rule and the read-only defaults');
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
  assert.ok(named.ok, 'Edit is allowed: the user named it');
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
  assert.ok(html.ok && !/<[A-Za-z!/?]/.test(html.text) && html.text.includes('&lt;script>') && html.warnings.length === 1, 'fence removed, HTML kept only as text, with a note');
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
  assert.ok(!validateGeneratedProfile('x'.repeat(70 * 1024), Q, parse).ok, 'too long');
  // a tool named only as part of a word is not "named"
  const sub = validateGeneratedProfile(filled('claude', 'p', 'tools: Read, Edit'), { app: 'claude', name: 'p', mode: 'describe', description: 'an editor of docs, never edits' }, parse);
  assert.ok(!sub.ok, '"Edit" inside "edits"/"editor" does not count as naming the tool');
  // backslashes and regex characters in the user's text or the tool name are plain text (no pattern is built from them)
  const bs = validateGeneratedProfile(filled('claude', 'p', 'tools: Read, mcp.srv:do-x'), { app: 'claude', name: 'p', mode: 'describe', description: 'uses mcp.srv:do-x and C:\\tmp\\a.b (.*) [x]' }, parse);
  assert.ok(bs.ok, 'a tool with dots, colons and dashes named verbatim');
  const bs2 = validateGeneratedProfile(filled('claude', 'p', 'tools: Read, mcpXsrv'), { app: 'claude', name: 'p', mode: 'describe', description: 'uses mcp.srv and \\w+ and .*' }, parse);
  assert.ok(!bs2.ok, '"." in the text is not a wildcard');
  const bs3 = validateGeneratedProfile(filled('claude', 'p', 'tools: Read, Edit'), { app: 'claude', name: 'p', mode: 'describe', description: 'may use Edit.' }, parse);
  assert.ok(bs3.ok, 'a trailing full stop is not part of the word');
}
console.log('profile generation tests passed');
