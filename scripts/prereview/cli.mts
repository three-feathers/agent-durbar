// Pre-review bot entry (spec 103). The only file that imports the Agent SDK, and the only one run with tsx from the installed copy.
// Kept thin on purpose: all logic is in ../prereview-*.ts and is tested with fakes by `npm run test:prereview`.
import { query } from '@anthropic-ai/claude-agent-sdk';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';
import cliNs from '../prereview-cli';
import runNs from '../prereview-run';
// the shared files are CommonJS (the repo root has no "type": "module"); tsx hands them over as a default export
const { main } = cliNs as typeof import('../prereview-cli');
const { nodeExec } = runNs as typeof import('../prereview-run');

const here = path.dirname(fileURLToPath(import.meta.url));
const code = await main(process.argv.slice(2), {
  exec: nodeExec, env: process.env, query: query as never, fetch: fetch as never, now: () => new Date(), randomHex: (n: number) => randomBytes(n).toString('hex'),
  root: path.resolve(here, '..', '..'), nodeBin: process.execPath, entry: fileURLToPath(import.meta.url), me: typeof process.getuid === 'function' ? process.getuid() : -1,
  stdin: async () => { const chunks: Buffer[] = []; for await (const c of process.stdin) chunks.push(c as Buffer); return Buffer.concat(chunks).toString('utf8'); },
  out: (s: string) => { process.stdout.write(s); }, err: (s: string) => { process.stderr.write(s); },
});
process.exit(code);
