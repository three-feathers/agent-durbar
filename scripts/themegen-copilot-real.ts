/**
 * Dev tool, USES AI CREDITS (spec 040 T027, #301; owner-approved 2026-10-20): ONE call of the real `CopilotAdapter.generateText` with the
 * AI theme maker's first prompt (`buildThemePrompt`), exactly as `theme:generate` sends it (Copilot's MCP servers switched off by name).
 * Records: whether text came back, whether it parses as a theme, the AI credits reported, every event type the throw-away session emitted
 * (to prove no tool ran), and the names in `~/.copilot/session-state` before and after (to prove the session was deleted).
 * The prompt and the reply are never printed. Not part of `npm test`.
 *   npx tsx scripts/themegen-copilot-real.ts [description]
 */
import { CopilotAdapter } from '../src/adapters/copilot';
import { buildThemePrompt, firstJsonObject, parseGeneratedTheme } from '../src/shared/themegen';
import { cliServers } from '../src/main/mcpfiles';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const stateDir = path.join(os.homedir(), '.copilot', 'session-state');
const names = (): string[] => (fs.existsSync(stateDir) ? fs.readdirSync(stateDir).sort() : []);
const eventTypes: string[] = [];

class Watched extends CopilotAdapter {
  protected async getClient(): Promise<any> { // eslint-disable-line @typescript-eslint/no-explicit-any
    const c = (await super.getClient()) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    if (!c.__watched) {
      const create = c.createSession.bind(c);
      c.createSession = async (cfg: unknown) => {
        const s = await create(cfg);
        s.on((e: { type: string }) => eventTypes.push(e.type));
        return s;
      };
      c.__watched = true;
    }
    return c;
  }
  rawClient(): Promise<any> { return this.getClient(); } // eslint-disable-line @typescript-eslint/no-explicit-any
}

async function main(): Promise<void> {
  const description = process.argv[2] ?? 'calm forest library';
  const T = require(path.join(__dirname, '..', 'src', 'renderer', 'theme.js')) as { _tokens(): Record<string, string>; _sanitizeSlot(s: string): string | null };
  const ctx = { clean: T._tokens(), sanitizeArt: (s: string) => T._sanitizeSlot(s), taken: () => false };
  const disabled = cliServers(path.join(os.homedir(), '.copilot'), new Set()).servers.map((s) => s.name);
  const before = names();
  const ad = new Watched();
  const t0 = Date.now();
  let result: Record<string, unknown>;
  try {
    const r = await ad.generateText(buildThemePrompt(description, ctx.clean), { disabledMcpServers: disabled });
    const g = parseGeneratedTheme(r.text, description, ctx as never);
    const o = firstJsonObject(r.text) as Record<string, unknown> | undefined;
    const tk = o && typeof o.tokens === 'object' && o.tokens ? Object.keys(o.tokens as object) : [];
    const shape = { jsonFound: !!o, topKeys: o ? Object.keys(o).slice(0, 12) : [], tokenKeys: tk.length, knownTokenKeys: tk.filter((k) => k in ctx.clean).length };
    result = { returnedText: r.text.length > 0, replyChars: r.text.length, parsesAsTheme: g.ok, issues: g.ok ? g.issues.length : g.error, aiCredits: r.nanoAiu ? r.nanoAiu / 1e9 : null, shape };
    if (process.env.REPLY_OUT) fs.writeFileSync(process.env.REPLY_OUT, r.text); // a theme JSON, for a local look; never committed
  } catch (e) {
    result = { error: String(e instanceof Error ? e.message : e).slice(0, 200) };
  }
  result.seconds = Math.round((Date.now() - t0) / 100) / 10;
  result.disabledMcpServers = disabled.length;
  result.eventTypes = [...new Set(eventTypes)];
  result.toolEvents = eventTypes.filter((t) => /^tool\.|permission/.test(t)).length;
  await new Promise((r) => setTimeout(r, 1500));
  const after = names();
  result.sessionStateBefore = before.length;
  result.sessionStateAfter = after.length;
  result.newEntries = after.filter((n) => !before.includes(n));
  console.log(JSON.stringify(result, null, 2));
  await (await ad.rawClient()).stop();
}
main().catch((e) => { console.error('FAILED', String(e instanceof Error ? e.message : e).slice(0, 300)); process.exit(1); });
