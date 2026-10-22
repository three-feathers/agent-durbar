/**
 * Dev tool, USES AI CREDITS (spec 043 T016; owner-approved 2026-10-22): ONE "Create with AI" questionnaire generation through the app's
 * own one-shot path (`ClaudeAdapter.generateText`: haiku, no tools, no session kept), exactly as `profiles:generate` builds the prompt
 * and checks the reply. Prints the verdict, the front matter keys, the tools, the headings and the cost; the generated file goes to
 * REPLY_OUT if set (for a local look; never committed). Not part of `npm test`.
 *   tsc -p tsconfig.scripts.json && node dist-scripts/scripts/profilegen-real.js [claude|copilot]
 */
import { ClaudeAdapter, claudeBinaryPath } from '../src/adapters/claude';
import { buildProfilePrompt, SUCCESS_SECTIONS, validateGeneratedProfile } from '../src/shared/profiletemplates';
import type { FrontmatterParse, GenInput } from '../src/shared/profiletemplates';
import * as fs from 'fs';
import * as path from 'path';

async function main(): Promise<void> {
  const app = process.argv[2] === 'copilot' ? 'copilot' : 'claude';
  const input: GenInput = {
    app, name: 'release-manager', mode: 'questions',
    answers: {
      title: 'Release manager for the desktop app',
      reportsTo: 'Lead',
      reports: 'None',
      duties: 'Check that a release is ready: changelog, version, green CI, open blockers; write the release notes draft',
      success: 'No release goes out with a red check or a missing changelog line; notes are short and correct',
      skills: 'Semantic versioning, reading CI results, writing clear release notes',
      tools: 'git, gh (read-only: never push, tag, merge or publish)',
      behavior: 'Calm and brief; asks Lead before anything that changes the repository',
    },
  };
  const PE = require(path.join(__dirname, '..', '..', 'src', 'renderer', 'profileeditor.js')) as { parseFrontmatter(t: string): FrontmatterParse };
  // a child `claude` behaves like a user's CLI only without the parent session's CLAUDE* variables (docs/agent-notes.md)
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('CLAUDE'))) as NodeJS.ProcessEnv;
  const ad = new ClaudeAdapter({ claudePath: claudeBinaryPath, env: () => env } as never);
  const t0 = Date.now();
  const prompt = buildProfilePrompt(input);
  const g = await ad.generateText(prompt);
  if (process.env.REPLY_OUT) fs.writeFileSync(process.env.REPLY_OUT, g.text);
  const v = validateGeneratedProfile(g.text, input, (t) => PE.parseFrontmatter(t));
  const out: Record<string, unknown> = { targetApp: app, generator: 'haiku (ClaudeAdapter.generateText)', seconds: Math.round((Date.now() - t0) / 1000), costUsd: g.costUsd ?? null, promptChars: prompt.length, replyChars: g.text.length, ok: v.ok };
  if (!v.ok) out.error = v.error;
  else {
    if (process.env.REPLY_OUT) fs.writeFileSync(process.env.REPLY_OUT + '.checked.md', v.text);
    const fm = PE.parseFrontmatter(v.text);
    const fmv = Object.fromEntries(fm.entries.map((e) => [e.key, e.value]));
    const heads = [...fm.body.matchAll(/^#{1,2}\s+(.+?)\s*$/gm)].map((m) => m[1]);
    Object.assign(out, {
      warnings: v.warnings,
      frontmatterKeys: fm.entries.map((e) => e.key), frontmatterErrors: fm.errors.length,
      name: fmv.name, model: fmv.model ?? null, tools: fmv.tools,
      headings: heads,
      allSections: SUCCESS_SECTIONS.every((s) => heads.some((h) => h.toLowerCase() === s.heading.toLowerCase())),
    });
  }
  console.log(JSON.stringify(out, null, 2));
}
main().catch((e) => { console.error('FAILED', String(e instanceof Error ? e.message : e).slice(0, 300)); process.exit(1); });
