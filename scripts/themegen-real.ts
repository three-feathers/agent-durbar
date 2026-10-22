/**
 * Dev tool, USES AI CREDITS (spec 070 T011; owner-approved 2026-10-22): the AI theme maker on a real model through the app's own one-shot
 * path, `ClaudeAdapter.generateText` (haiku, no tools, no session kept), with the same pass loop as `theme:generate` but at most
 * `PASSES` prompts (default 2; the app allows 3). Checks the spec 070 additions: typed tokens (fonts from the allow-list, title weight,
 * radii, shadows), `figures`, the `gadget-cup` / `gadget-laptop` art through the renderer's sanitizer, and the fallback count the
 * Settings card and the AI dialog show. Prints only shapes and counts (the reply goes to REPLY_OUT if set, for a local look; never
 * committed). Not part of `npm test`.
 *   tsc -p tsconfig.scripts.json && node dist-scripts/scripts/themegen-real.js ["description"]
 */
import { ClaudeAdapter, claudeBinaryPath } from '../src/adapters/claude';
import { MAX_PASSES, buildFixPrompt, buildRetryPrompt, buildThemePrompt, firstJsonObject, keepArt, parseGeneratedTheme } from '../src/shared/themegen';
import { FONT_ALLOW, TYPED_TOKENS, typedValue } from '../src/shared/themetokens';
import { checkUserManifest } from '../src/shared/themes';
import * as fs from 'fs';
import * as path from 'path';

type Theme = { _tokens(): Record<string, string>; _sanitizeSlot(s: string): string | null; registerUserThemes(m: Record<string, unknown>): void; fallbacks(id: string): { dropped: string[]; contrast: string[] } };

async function main(): Promise<void> {
  const description = process.argv[2] ?? 'a calm pink design studio with stylish people and plants';
  const limit = Math.min(Number(process.env.PASSES) || 2, MAX_PASSES);
  const T = require(path.join(__dirname, '..', '..', 'src', 'renderer', 'theme.js')) as Theme;
  const ctx = { clean: T._tokens(), sanitizeArt: (s: string) => T._sanitizeSlot(s), taken: () => false };
  // a child `claude` behaves like a user's CLI only without the parent session's CLAUDE* variables (docs/agent-notes.md)
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('CLAUDE'))) as NodeJS.ProcessEnv;
  const ad = new ClaudeAdapter({ claudePath: claudeBinaryPath, env: () => env } as never);
  let cost = 0;
  const replies: string[] = [];
  const ask = async (p: string): Promise<string> => {
    const r = await ad.generateText(p);
    cost += r.costUsd ?? 0;
    replies.push(r.text);
    return r.text;
  };
  const t0 = Date.now();
  let g = parseGeneratedTheme(await ask(buildThemePrompt(description, ctx.clean)), description, ctx as never);
  const first = g.ok ? { ok: true, issues: g.issues, warnings: g.warnings } : { ok: false, error: g.error };
  let passes = 1;
  while (!g.ok && passes < limit) { g = parseGeneratedTheme(await ask(buildRetryPrompt(description, ctx.clean, g.error)), description, ctx as never); passes++; }
  while (g.ok && g.issues.length && passes < limit) {
    const next = parseGeneratedTheme(await ask(buildFixPrompt(g.raw, g.issues)), description, ctx as never);
    passes++;
    if (next.ok && next.issues.length <= g.issues.length) g = keepArt(next, g);
  }
  if (process.env.REPLY_OUT) fs.writeFileSync(process.env.REPLY_OUT, JSON.stringify(replies, null, 1));
  const out: Record<string, unknown> = { model: 'haiku (ClaudeAdapter.generateText)', passes, seconds: Math.round((Date.now() - t0) / 1000), costUsd: Math.round(cost * 10000) / 10000, first };
  if (!g.ok) { out.error = g.error; console.log(JSON.stringify(out, null, 2)); return; }
  // what the model sent for the typed tokens, before the parser dropped anything
  const reply0 = firstJsonObject(replies[0]) as Record<string, unknown> | undefined;
  const rt = (reply0?.tokens ?? {}) as Record<string, unknown>;
  const sentTyped = Object.keys(TYPED_TOKENS).map((k) => {
    const v = rt[k] ?? rt[k.slice(2)];
    return { key: k, sent: v === undefined ? null : String(v).slice(0, 90), valid: v === undefined ? null : typedValue(k, v) !== null };
  });
  const m = g.manifest as { id: string; tokens: Record<string, string>; figures?: Record<string, string[]>; art?: Record<string, string> };
  const fontsUsed = ['--font', '--ui-display', '--font-mono'].filter((k) => m.tokens[k]).map((k) => ({ key: k, names: m.tokens[k].split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')) }));
  const offList = fontsUsed.flatMap((f) => f.names.filter((n) => !FONT_ALLOW.includes(n)));
  const rawArt = (reply0?.art ?? {}) as Record<string, unknown>;
  const gadget = (k: string) => ({ sent: typeof rawArt[k] === 'string', sentChars: typeof rawArt[k] === 'string' ? (rawArt[k] as string).length : 0, kept: !!m.art?.[k], keptChars: m.art?.[k]?.length ?? 0, resanitizedSame: m.art?.[k] ? T._sanitizeSlot(m.art[k]) === m.art[k] : null });
  const v = checkUserManifest(JSON.stringify(m));
  T.registerUserThemes({ [m.id]: m });
  const fb = T.fallbacks(m.id);
  Object.assign(out, {
    parsesAsTheme: true,
    finalIssues: g.issues,
    warnings: g.warnings,
    colourTokens: Object.keys(m.tokens).filter((k) => !(k in TYPED_TOKENS)).length,
    typedSent: sentTyped,
    typedKept: Object.keys(m.tokens).filter((k) => k in TYPED_TOKENS),
    fontsUsed,
    fontsOffAllowList: offList,
    figures: m.figures ? { shirts: m.figures.shirts?.length ?? 0, hairs: m.figures.hairs?.length ?? 0, sentShirts: Array.isArray((reply0?.figures as Record<string, unknown> | undefined)?.shirts) } : null,
    artSlotsKept: Object.keys(m.art ?? {}).length,
    artSlotsSent: Object.keys(rawArt).length,
    gadgetCup: gadget('gadget-cup'),
    gadgetLaptop: gadget('gadget-laptop'),
    importCheck: { ok: v.ok, dropped: v.ok ? (v as { dropped?: string[] }).dropped ?? [] : v.error },
    fallbacksShown: { dropped: fb.dropped.length, contrast: fb.contrast.length, total: fb.dropped.length + fb.contrast.length, contrastPairs: fb.contrast },
  });
  console.log(JSON.stringify(out, null, 2));
}
main().catch((e) => { console.error('FAILED', String(e instanceof Error ? e.message : e).slice(0, 300)); process.exit(1); });
