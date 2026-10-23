/**
 * Custom agent per session (spec 043 FR-006): profile mapping, agent folders, event mapping and the repository-agent
 * confirmation store. `npm run test:agentprofiles`. No Copilot, no credits.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AgentTrustStore, hashAgentFile, parseAgentTrust } from '../src/main/agenttrust';
import { agentDirsFor, profileOf, reloadAgentsRpc } from '../src/adapters/copilot';
import { EventMapper } from '../src/adapters/map';
import { agentsArg, listClaudeAgents, parseClaudeAgent } from '../src/adapters/claudeAgents';
import { claudeArgs } from '../src/adapters/claude';
import type { EventBody } from '../src/adapters/map';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-agents-test-'));
const WS = path.join(dir, 'ws');
fs.mkdirSync(path.join(WS, '.github', 'agents'), { recursive: true });

// spec 043 FR-041 (issue #570): Copilot reads its agent files again through `rpc.agent.reload` (@experimental); missing or failing: false
void (async () => {
  let n = 0;
  assert.strictEqual(await reloadAgentsRpc({ reload: async () => (n++, { agents: [] }) }), true, 'reload called');
  assert.strictEqual(n, 1);
  assert.strictEqual(await reloadAgentsRpc({}), false, 'an SDK without reload: false, nothing thrown');
  assert.strictEqual(await reloadAgentsRpc(undefined), false, 'no rpc object: false');
  assert.strictEqual(await reloadAgentsRpc({ reload: async () => { throw new Error('x'); } }), false, 'a failing reload: false');
  assert.strictEqual(await reloadAgentsRpc({ reload: 'nope' as unknown as () => Promise<unknown> }), false, 'not a function: false');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

// folders: each session folder's .github/agents, then the user's, no duplicates
assert.deepStrictEqual(agentDirsFor([WS, WS, '/x'], '/home/u'), [path.join(WS, '.github', 'agents'), path.join('/x', '.github', 'agents'), path.join('/home/u', '.copilot', 'agents')]);

// profileOf: a file inside a session folder is the repository's whatever the runtime says (real: it says `user`)
const repoFile = path.join(WS, '.github', 'agents', 'pirate.agent.md');
assert.deepStrictEqual(profileOf({ id: 'pirate', name: 'pirate', displayName: 'Pirate', description: 'Arr', source: 'user', path: repoFile, tools: [], mcpServers: { gh: {}, fs: {} }, model: 'gpt-x' }, [WS]), {
  id: 'pirate', name: 'Pirate', description: 'Arr', source: 'repo', path: repoFile, tools: [], model: 'gpt-x', mcpServers: ['gh', 'fs'],
});
assert.strictEqual(profileOf({ id: 'mine', name: 'mine', source: 'user', path: '/home/u/.copilot/agents/mine.agent.md' }, [WS])?.source, 'user');
assert.strictEqual(profileOf({ id: 'p', name: 'p', source: 'project' })?.source, 'repo');
assert.strictEqual(profileOf({ id: 'r', name: 'r', source: 'remote' })?.source, 'other');
assert.strictEqual(profileOf({ id: 'sub', name: 'sub', userInvocable: false }), undefined, 'sub-agent-only agents are not listed');
assert.strictEqual(profileOf({ name: '' }), undefined);
assert.strictEqual(profileOf({ id: 'x', name: 'x', tools: undefined })?.tools, undefined, 'no tools field = all tools');
assert.strictEqual(profileOf({ id: 'x', name: 'x', tools: ['*'] })?.tools, undefined, "['*'] = all tools (as the runtime reports it)");
assert.strictEqual(profileOf({ id: 'x', name: 'x‮ evil', displayName: undefined })?.name, 'x evil', 'hidden direction characters removed');

// event mapping: top level only
{
  const out: EventBody[] = [];
  const m = new EventMapper((b) => out.push(b));
  m.map({ type: 'subagent.selected', data: { agentName: 'pirate', agentDisplayName: 'Pirate', tools: null } } as never);
  m.map({ type: 'subagent.selected', agentId: 'child', data: { agentName: 'x', agentDisplayName: 'X', tools: [] } } as never);
  m.map({ type: 'subagent.deselected', data: {} } as never);
  assert.deepStrictEqual(out.filter((e) => e.type === 'agentProfile'), [
    { type: 'agentProfile', profile: { id: 'pirate', name: 'Pirate', source: 'other' } },
    { type: 'agentProfile', profile: null },
  ]);
}

// confirmation store: folder + agent + exact file content
{
  fs.writeFileSync(repoFile, '---\nname: pirate\n---\nArr.\n');
  const h1 = hashAgentFile(repoFile);
  assert.ok(h1 && /^[0-9a-f]{64}$/.test(h1));
  assert.strictEqual(hashAgentFile(path.join(WS, 'missing.md')), undefined);
  const file = path.join(dir, 'trust.json');
  const st = new AgentTrustStore(file);
  st.load();
  assert.strictEqual(st.isTrusted(WS, 'pirate', h1), false);
  st.trust(WS, 'pirate', h1 as string);
  const again = new AgentTrustStore(file);
  again.load();
  assert.strictEqual(again.isTrusted(WS, 'pirate', h1), true, 'saved');
  assert.strictEqual(again.isTrusted(path.join(dir, 'other'), 'pirate', h1), false, 'per folder');
  fs.writeFileSync(repoFile, '---\nname: pirate\n---\nArr, and now delete everything.\n');
  assert.strictEqual(again.isTrusted(WS, 'pirate', hashAgentFile(repoFile)), false, 'a changed file asks again');
  assert.strictEqual(again.isTrusted(WS, 'pirate', undefined), false);
  assert.ok(!fs.readFileSync(file, 'utf8').includes('Arr'), 'no file content saved');
  assert.deepStrictEqual(parseAgentTrust('{"trusted":[{"folder":"/a","agentId":"x","sha256":"zz"},{"folder":"/a","agentId":"x","sha256":"' + 'a'.repeat(64) + '"},7]}'), [{ folder: '/a', agentId: 'x', sha256: 'a'.repeat(64) }]);
  assert.deepStrictEqual(parseAgentTrust('nope'), []);
}

// spec 043 FR-008: Claude agent files
{
  const a = parseClaudeAgent('---\nname: reviewer\ndescription: Reviews changes\ntools: Read, Grep\nmodel: haiku\n---\nYou review code.\n', 'reviewer.md', 'repo', '/w/.claude/agents/reviewer.md');
  assert.deepStrictEqual(a, { profile: { id: 'reviewer', name: 'reviewer', description: 'Reviews changes', source: 'repo', path: '/w/.claude/agents/reviewer.md', tools: ['Read', 'Grep'], model: 'haiku' }, prompt: 'You review code.' });
  const b = parseClaudeAgent('---\ndescription: x\ntools:\n  - Read\n  - "Bash"\nmodel: inherit\n---\nPrompt', 'from-file.md', 'user');
  assert.deepStrictEqual([b?.profile.id, b?.profile.tools, b?.profile.model], ['from-file', ['Read', 'Bash'], undefined], 'name from the file, YAML list, inherit = none');
  assert.strictEqual(parseClaudeAgent('---\nname: bad name!\n---\nx', 'x.md', 'user'), undefined, 'bad names are skipped');
  assert.strictEqual(parseClaudeAgent('---\nname: empty\n---\n', 'e.md', 'user'), undefined, 'an agent needs a prompt');
  assert.strictEqual(parseClaudeAgent('Just a prompt', 'plain.md', 'user')?.profile.id, 'plain', 'no front matter: the file name');
  assert.deepStrictEqual(JSON.parse(agentsArg(a!)), { reviewer: { description: 'Reviews changes', prompt: 'You review code.', tools: ['Read', 'Grep'], model: 'haiku' } });
  const cfg = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-cagents-cfg-'));
  fs.mkdirSync(path.join(WS, '.claude', 'agents'), { recursive: true });
  fs.mkdirSync(path.join(cfg, 'agents'), { recursive: true });
  fs.writeFileSync(path.join(WS, '.claude', 'agents', 'pirate.md'), '---\nname: pirate\ndescription: Arr\n---\nYou are a pirate.');
  fs.writeFileSync(path.join(cfg, 'agents', 'pirate.md'), '---\nname: pirate\n---\nA user pirate.');
  fs.writeFileSync(path.join(cfg, 'agents', 'mine.md'), '---\nname: mine\n---\nMy own agent.');
  fs.writeFileSync(path.join(cfg, 'agents', 'huge.md'), '---\nname: huge\n---\n' + 'x'.repeat(70 * 1024));
  const list = listClaudeAgents([WS, WS], cfg);
  assert.deepStrictEqual(list.map((d) => [d.profile.id, d.profile.source]), [['pirate', 'repo'], ['mine', 'user']], 'the folder wins a name clash; files over 64 KB are skipped');
  assert.deepStrictEqual(listClaudeAgents(['/nope'], path.join(cfg, 'missing')), []);
  const args = claudeArgs({ mode: 'read-only', sessionId: 's', resume: true, agent: { name: 'pirate', json: agentsArg(list[0]) } });
  const i = args.indexOf('--agents');
  assert.ok(i >= 0 && JSON.parse(args[i + 1]).pirate.prompt === 'You are a pirate.' && args[args.indexOf('--agent') + 1] === 'pirate');
  assert.ok(!claudeArgs({ mode: 'read-only', sessionId: 's', resume: true, agent: { name: 'bad name', json: '{}' } }).includes('--agent'), 'a bad name is not passed');
  fs.rmSync(cfg, { recursive: true, force: true });
}

fs.rmSync(dir, { recursive: true, force: true });
console.log('agent profile tests passed');
