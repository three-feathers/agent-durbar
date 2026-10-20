/** Unit test: MCP server error text is masked before it reaches the window (spec 019 FR-021). */
import * as assert from 'assert';
import { maskMcpError, maskMcpStatuses, mcpSecretValues, MCP_ERROR_MAX_CHARS } from '../src/main/mcpmask';

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
console.log('mcp error mask: planted secrets, normal text, mask-then-cut, session values OK');
