/**
 * Spec 117 FR-018: runs the shell script of ci.yml's "Build and test (<os>)" summary job with given part results, so tests judge the summary
 * by what it does (passes or fails), not by its text. Used by scripts/test-ci-shards.ts and scripts/test-ci-required-suites.ts (T022). The script
 * is ci.yml's own constant text, run with bash and a minimal env (PATH, the step's env, a temp GITHUB_STEP_SUMMARY); no PR text reaches it.
 * bash is assumed on Linux and macOS only: `canRun` is false on Windows, where callers skip the run and say so.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';

export const canRun = process.platform !== 'win32';

/** True when the summary script exits 0 for this OS, event and set of part results (env keys as in the step, e.g. UBUNTU=success). */
export function summaryPasses(script: string, osName: string, event: string, results: Record<string, string>): boolean {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-summary-'));
  try {
    const env = { PATH: process.env.PATH || '', OS: osName, EVENT_NAME: event, GITHUB_STEP_SUMMARY: path.join(tmp, 'summary.md'), ...results };
    const r = spawnSync('bash', ['-c', script], { env, encoding: 'utf8' });
    assert.ok(r.status !== null, `bash did not run the summary script: ${String(r.error)}`);
    return r.status === 0;
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}
