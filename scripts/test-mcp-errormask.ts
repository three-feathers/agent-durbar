/** Unit test: MCP server error text is masked before it reaches the window (spec 019 FR-021). */
import * as assert from 'assert';
import { maskMcpError, maskMcpEvent, maskMcpText, maskMcpStatuses, mcpSecretValues, MCP_ERROR_MAX_CHARS } from '../src/main/mcpmask';
import type { AgentEvent } from '../src/adapters/types';
import * as fs from 'fs';
import * as path from 'path';

const GH = 'ghp_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8';
const SESSION = 'zq-hunter2-session-value';
const BEARER = 'Bearer abcdef1234567890XYZ';

// planted secrets are gone
{
  const planted = [
    `401 from server, header Authorization: ${BEARER}`,
    `clone failed with token ${GH}`,
    'GET https://api.example.com/mcp?key=sekretvalue99&x=1 failed',
    'connect https://user:p4ssw0rd@host.example.com/mcp refused',
    'spawn failed: node server.js --token supersecretvalue1',
    `env had ${SESSION} in it`,
  ];
  const needles = ['abcdef1234567890XYZ', GH, 'sekretvalue99', 'p4ssw0rd', 'supersecretvalue1', SESSION];
  planted.forEach((t, i) => {
    const out = maskMcpError(t, [SESSION]) as string;
    assert.ok(!out.includes(needles[i]), `planted secret ${i} masked: ${out}`);
  });
}

// a normal error is unchanged; undefined stays undefined
assert.strictEqual(maskMcpError('Connection refused (ECONNREFUSED 127.0.0.1:3000)'), 'Connection refused (ECONNREFUSED 127.0.0.1:3000)');
assert.strictEqual(maskMcpError(undefined), undefined);

// masked before cut: a secret straddling the cap leaves no prefix
{
  const text = 'x '.repeat(147) + 'token=' + GH + ' tail';
  const out = maskMcpError(text) as string;
  assert.ok(!out.includes('ghp_'), `no prefix of the straddling token: ${out.slice(-40)}`);
  assert.ok(out.length <= MCP_ERROR_MAX_CHARS + 20, 'cut to about 300');
  const long = maskMcpError('word '.repeat(400)) as string;
  assert.ok(long.length <= MCP_ERROR_MAX_CHARS + 20, 'long text is cut');
}

// session values come from env and headers of the extras; short ones are skipped
{
  const v = mcpSecretValues({ a: { type: 'stdio', env: { K: SESSION, S: 'ab' } }, b: { type: 'http', headers: { H: 'longer-header-secret' } } });
  assert.deepStrictEqual(v, ['longer-header-secret', SESSION].sort((x, y) => y.length - x.length));
  assert.deepStrictEqual(mcpSecretValues(undefined), []);
}

// whole status list
{
  const out = maskMcpStatuses([{ name: 'a', status: 'failed', error: `bad ${SESSION}` }, { name: 'b', status: 'connected' }], [SESSION]);
  assert.ok(!(out[0].error as string).includes(SESSION));
  assert.strictEqual(out[1].error, undefined);
}
// FR-022: one masked copy of the event for every outward path (window, DURBAR_LOG sink)
{
  const ev = { type: 'mcp', sessionId: 's1', timestamp: 1, servers: [{ name: 'x', status: 'failed', error: `401 header X-Api-Key: ${SESSION}` }] } as unknown as AgentEvent;
  const out = maskMcpEvent(ev, [SESSION]);
  assert.ok(!JSON.stringify(out).includes(SESSION), 'the extra secret is masked in the event copy');
  assert.ok(JSON.stringify(ev).includes(SESSION), 'the original event is not changed (main keeps the raw state)');
  const other = { type: 'status', sessionId: 's1', timestamp: 1, status: 'idle' } as unknown as AgentEvent;
  assert.strictEqual(maskMcpEvent(other, [SESSION]), other, 'other events pass through as the same object');
}
// FR-022 wiring: both outward paths in main.ts send the masked copy, never the raw event
{
  const main = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'main', 'main.ts'), 'utf8');
  const sends = main.split('\n').filter((l) => l.includes('router.onEvent') && l.includes("'agent:event'")); // router events only (the window's own synthesized events carry no MCP text)
  assert.ok(sends.length >= 1 && sends.every((x) => x.includes('outward(')), `agent:event to the window goes through outward(): ${sends.join(' | ')}`);
  const sink = main.match(/write\(\{ t: Date\.now\(\), event: [^}]*\}/g) ?? [];
  assert.ok(sink.length === 1 && sink[0].includes('outward('), `the DURBAR_LOG sink writes outward(e): ${sink.join(' | ')}`);
}
// spec 058 FR-067: a failed MCP tool card is masked (session values, token shapes, URL keys), with no 300-character cut
{
  const HDR = 'hdr-secret-value-77';
  const card = (over: Record<string, unknown>): AgentEvent => ({ type: 'toolCall', sessionId: 's1', timestamp: 1, callId: 'c1', tool: 'srv-search', phase: 'failed', mcpServer: 'srv', mcpTool: 'search', ...over }) as unknown as AgentEvent;
  const long = 'detail line. '.repeat(60); // 780 characters
  const out = maskMcpEvent(card({ output: `${long}X-Api-Key: ${HDR} token ${GH} GET https://api.example.com/mcp?key=sekretvalue99&x=1` }), [HDR]) as unknown as { output: string };
  assert.ok(!out.output.includes(HDR) && !out.output.includes(GH) && !out.output.includes('sekretvalue99'), `card output masked: ${out.output.slice(-120)}`);
  assert.ok(out.output.startsWith(long), 'no 300-character cut on the card');
  assert.strictEqual(maskMcpText(undefined), undefined);
  assert.strictEqual(maskMcpText('x'.repeat(1000)), 'x'.repeat(1000));
  // only a FAILED call that names an MCP server
  for (const e of [card({ phase: 'complete', output: HDR }), card({ mcpServer: undefined, output: HDR }), card({ output: undefined })]) assert.strictEqual(maskMcpEvent(e, [HDR]), e, 'other tool events pass through as the same object');
  // wiring: main fetches the session's values for a failed MCP tool card
  const main = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'main', 'main.ts'), 'utf8');
  const line = main.split('\n').find((l) => l.startsWith('const outward = ')) ?? '';
  assert.ok(line.includes("'toolCall'") && line.includes('mcpServer') && line.includes('secretValuesFor'), `outward() passes the session values for failed MCP tool cards: ${line}`);
}
console.log('mcp error mask: planted secrets, normal text, mask-then-cut, session values, event copy OK');
