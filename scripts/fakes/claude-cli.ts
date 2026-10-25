/**
 * A scripted fake of the `claude` CLI child process (spec 012 T090/T091): records what the host writes to stdin and lets a
 * test push stdout lines, stderr and an exit. No process, no Claude account, no credits.
 */
import type { ChildLike, SpawnFn } from '../../src/adapters/claudeTransport';

type Cb = (...a: unknown[]) => void;

export class FakeClaudeChild {
  written: string[] = [];
  ended = false;
  killed: string[] = [];
  /** When set, the child answers stdin end / SIGTERM by exiting; false lets close() escalate to SIGKILL. */
  exitOnEnd = true;
  exitOnTerm = true;
  private on_: Record<string, Cb[]> = {};
  private outCbs: Cb[] = [];
  private errCbs: Cb[] = [];
  /** Called for every JSON object the host writes (tests reply from here). */
  onWrite?: (obj: Record<string, unknown>) => void;
  stdin = {
    write: (chunk: string): boolean => {
      this.written.push(chunk);
      for (const line of chunk.split('\n')) {
        if (!line.trim()) continue;
        try {
          this.onWrite?.(JSON.parse(line));
        } catch {
          /* not JSON */
        }
      }
      return true;
    },
    end: (): void => {
      this.ended = true;
      if (this.exitOnEnd) setTimeout(() => this.exit(0, null), 0);
    },
    on: (): void => undefined,
  };
  stdout = { on: (_ev: 'data', cb: Cb) => this.outCbs.push(cb) };
  stderr = { on: (_ev: 'data', cb: Cb) => this.errCbs.push(cb) };
  on(ev: string, cb: Cb): this {
    (this.on_[ev] ??= []).push(cb);
    return this;
  }
  kill(signal: NodeJS.Signals = 'SIGTERM'): boolean {
    this.killed.push(signal);
    if (signal === 'SIGKILL' || this.exitOnTerm) setTimeout(() => this.exit(null, signal), 0);
    return true;
  }
  /** Raw stdout text (may split or join lines arbitrarily). */
  out(text: string): void {
    this.outCbs.forEach((cb) => cb(Buffer.from(text)));
  }
  send(obj: unknown): void {
    this.out(JSON.stringify(obj) + '\n');
  }
  err(text: string): void {
    this.errCbs.forEach((cb) => cb(Buffer.from(text)));
  }
  private exited = false;
  exit(code: number | null, signal: string | null): void {
    if (this.exited) return;
    this.exited = true;
    (this.on_['exit'] ?? []).forEach((cb) => cb(code, signal));
  }
  fail(message: string): void {
    (this.on_['error'] ?? []).forEach((cb) => cb(new Error(message)));
  }
  /** The JSON objects the host wrote, in order. */
  objects(): Record<string, unknown>[] {
    return this.written.flatMap((c) => c.split('\n')).filter((l) => l.trim()).map((l) => JSON.parse(l));
  }
}

/** A spawn that hands out FakeClaudeChild instances and records the argv and options. */
export function fakeSpawn(): { spawn: SpawnFn; calls: Array<{ file: string; args: string[]; cwd: string; shell: boolean }>; children: FakeClaudeChild[]; next?: (c: FakeClaudeChild) => void } {
  const rec: { spawn: SpawnFn; calls: Array<{ file: string; args: string[]; cwd: string; shell: boolean }>; children: FakeClaudeChild[]; next?: (c: FakeClaudeChild) => void } = {
    calls: [],
    children: [],
    spawn: (file, args, options) => {
      rec.calls.push({ file, args: [...args], cwd: options.cwd, shell: options.shell });
      const c = new FakeClaudeChild();
      rec.children.push(c);
      rec.next?.(c);
      return c as unknown as ChildLike;
    },
  };
  return rec;
}

/** Spec 087: host facts where Claude Code's sandbox can be tried (Linux, bubblewrap and socat found, a new enough CLI). No probe runs. */
export const SANDBOX_HOST_OK = async (): Promise<{ platform: string; version: string; haveBwrap: boolean; haveSocat: boolean }> => ({ platform: 'linux', version: '2.1.300', haveBwrap: true, haveSocat: true });
