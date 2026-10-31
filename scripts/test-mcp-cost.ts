/**
 * Spec 100 FR-002, FR-020..FR-024, FR-030: the estimator and the level rules. `npm run test:mcpcost`. No Electron, no network, no credits.
 */
import * as assert from 'assert';
import { chipFigure, chipWords, compactionBurst, compactionHint, compactionHintText, costLine, estimateTool, estimateTools, figureOf, fmtK, footnoteOf, hasFigures, heaviest, levelOf, lineAction, mcpWarnDefaults, parseWarnLevels, reportTotal, rowFigure, safeTokens, shareOf, totalLine, warningOf, warningText } from '../src/shared/mcpcost';
import type { McpContextReport, McpLevel } from '../src/shared/mcpcost';
import { claudeMcpContext, codexMcpContext, copilotMcpContext } from '../src/adapters/mcpcontext';

const L = mcpWarnDefaults();
const rep = (tokens: number, extra: Partial<McpContextReport> = {}): McpContextReport => ({ servers: [{ name: 'github', tokens, source: 'reported' }], window: 200_000, ...extra });

// FR-002: the formula
assert.strictEqual(estimateTool({ name: 'abcd', description: 'efgh', inputSchema: { a: 1 } }), Math.ceil(('abcdefgh' + '{"a":1}').length / 4) + 8);
assert.strictEqual(estimateTool({ name: 'abcd' }), 1 + 8, 'a missing description and schema count as nothing');
assert.strictEqual(estimateTool({ name: 'abcde' }), 2 + 8, 'ceil, not round or floor');
assert.strictEqual(estimateTool(null), 8, 'not an object: only the overhead');
const circular: Record<string, unknown> = {};
circular.self = circular;
assert.strictEqual(estimateTool({ name: 'abcd', inputSchema: circular }), 9, 'a schema that cannot be written counts as nothing and does not throw');
assert.strictEqual(estimateTool({ name: 'abcd', inputSchema: { n: BigInt(1) } }), 9, 'a BigInt in a schema does not throw');
assert.strictEqual(estimateTool({ name: 42, description: {} }), 8, 'odd field types are ignored');
// non-ASCII: characters as JavaScript counts them, no byte count
assert.strictEqual(estimateTool({ name: 'héllo', description: '日本語のツール' }), Math.ceil(12 / 4) + 8);
assert.strictEqual(estimateTools([{ name: 'a' }, { name: 'b' }]).tokens, 18, 'the sum of the tools');
assert.deepStrictEqual(estimateTools({ read: { description: 'abcd' }, odd: 1 }), { tokens: Math.ceil(8 / 4) + 8 + Math.ceil(3 / 4) + 8, tools: 2, capped: false }, 'a map by name (Codex) counts the key as the name');
for (const bad of [undefined, null, 7, 'x']) assert.deepStrictEqual(estimateTools(bad), { tokens: 0, tools: 0, capped: false }, 'no list: nothing');
// a 500-tool server, and one over the cap
const many = (n: number): unknown[] => Array.from({ length: n }, (_, i) => ({ name: `tool_${i}`, description: 'x'.repeat(100), inputSchema: { type: 'object', properties: { q: { type: 'string' } } } }));
const five = estimateTools(many(500));
assert.deepStrictEqual([five.tools, five.capped], [500, false], '500 tools are all counted');
assert.strictEqual(five.tokens, many(500).reduce((n: number, t) => n + estimateTool(t), 0));
const over = estimateTools(many(700));
assert.deepStrictEqual([over.tools, over.capped, over.tokens], [700, true, five.tokens], 'over the cap: the figure of the part counted, marked');

// numbers from an agent app
for (const bad of [NaN, Infinity, -Infinity, -1, 1e9, 1e12, '12', null, undefined, {}]) assert.strictEqual(safeTokens(bad), undefined, `not a figure: ${String(bad)}`);
assert.strictEqual(safeTokens(0), 0);
assert.strictEqual(safeTokens(12.4), 12);
assert.strictEqual(reportTotal({ servers: [{ name: 'a', tokens: NaN, source: 'reported' }, { name: 'b', tokens: -5, source: 'reported' }, { name: 'c', tokens: 10, source: 'reported' }] }), 10, 'bad numbers are not summed');
assert.strictEqual(reportTotal({ servers: [{ name: 'a', tokens: Infinity, source: 'reported' }] }), undefined, 'only bad numbers: no figure, not 0');
assert.strictEqual(reportTotal({ servers: [], total: 500 }), 500, "no server figures: the app's total");
assert.strictEqual(reportTotal({ servers: [{ name: 'a', tokens: 3, source: 'reported' }], total: 500 }), 3, 'the rows win over a total, so the total line equals the rows');
assert.strictEqual(reportTotal({ servers: [{ name: 'a', tokens: 3, deferredTokens: 90_000, source: 'reported' }] }), 3, 'deferred tools are not in the window (spec 100 Changes 2026-10-31)');
assert.strictEqual(reportTotal(null), undefined);
assert.strictEqual(hasFigures({ servers: [{ name: 'a', source: 'unknown' }] }), false);

// FR-020: the share and the levels. Strictly above; the share, not the absolute size
assert.strictEqual(shareOf(rep(20_000)), 10);
assert.strictEqual(shareOf(rep(200_000, { window: 1_000_000 })), 20, 'a 1M window: the same rule');
assert.strictEqual(shareOf(rep(20_000, { window: undefined }), 100_000), 20, 'the window from the context figure');
assert.strictEqual(shareOf(rep(20_000, { window: undefined })), undefined, 'window unknown: no share');
assert.strictEqual(shareOf(rep(20_000, { window: 0 })), undefined, 'a window of 0 is unknown');
assert.strictEqual(shareOf(rep(20_000, { window: NaN })), undefined, 'a bad window is unknown');
assert.strictEqual(shareOf(rep(20_000), 100_000), 10, "the report's window wins");
const cases: [number, McpLevel][] = [[0, 'none'], [10, 'none'], [15, 'none'], [15.01, 'warn'], [20, 'warn'], [30, 'warn'], [30.01, 'strong'], [35, 'strong'], [100, 'strong'], [400, 'strong']];
for (const [s, want] of cases) assert.strictEqual(levelOf(s, L), want, `level of ${s} %`);
assert.strictEqual(levelOf(undefined, L), 'none');
assert.strictEqual(levelOf(NaN, L), 'none');
assert.strictEqual(levelOf(99, { ...L, off: true }), 'none', 'off: never');
assert.strictEqual(levelOf(6, { warn: 5, strong: 7, off: false }), 'warn', 'configured levels are used');
assert.strictEqual(levelOf(8, { warn: 5, strong: 7, off: false }), 'strong');

// FR-020: the settings
assert.deepStrictEqual(parseWarnLevels({ warn: 5, strong: 90 }), { warn: 5, strong: 90, off: false });
assert.deepStrictEqual(parseWarnLevels({ warn: 10, strong: 20, off: true }), { warn: 10, strong: 20, off: true });
for (const bad of [null, [], 'x', {}, { warn: 4, strong: 30 }, { warn: 15, strong: 91 }, { warn: 30, strong: 30 }, { warn: 40, strong: 30 }, { warn: 15.5, strong: 30 }, { warn: '15', strong: 30 }, { warn: NaN, strong: 30 }]) assert.strictEqual(parseWarnLevels(bad), undefined, `refused: ${JSON.stringify(bad)}`);

// heaviest
const three: McpContextReport = { window: 100_000, servers: [{ name: 'a', tokens: 1, source: 'reported' }, { name: 'c', tokens: 9, source: 'reported' }, { name: 'b', tokens: 9, source: 'reported' }, { name: 'z', tokens: 0, source: 'reported' }, { name: 'u', source: 'unknown' }, { name: 'd', tokens: 3, source: 'reported' }] };
assert.deepStrictEqual(heaviest(three, 3).map((x) => x.name), ['b', 'c', 'd'], 'heaviest first, ties by name, at most n');
assert.deepStrictEqual(heaviest(three, 9).map((x) => x.name), ['b', 'c', 'd', 'a'], 'no figure or 0: left out');
assert.deepStrictEqual(heaviest(null, 3), []);
assert.strictEqual(three.servers[0].name, 'a', 'the input keeps its order');

// FR-030: more than 3 in 30 minutes
const MIN = 60_000;
const NOW = 100 * MIN;
assert.strictEqual(compactionBurst([NOW, NOW - MIN, NOW - 2 * MIN], NOW), false, '3 is not more than 3');
assert.strictEqual(compactionBurst([NOW, NOW - MIN, NOW - 2 * MIN, NOW - 3 * MIN], NOW), true, '4 in 3 minutes');
assert.strictEqual(compactionBurst([NOW, NOW - MIN, NOW - 2 * MIN, NOW - 30 * MIN], NOW), false, 'exactly 30 minutes ago is outside');
assert.strictEqual(compactionBurst([NOW, NOW - MIN, NOW - 2 * MIN, NOW - 29 * MIN], NOW), true, '29 minutes ago is inside');
assert.strictEqual(compactionBurst([NOW + MIN, NOW + 2 * MIN, NOW + 3 * MIN, NOW + 4 * MIN], NOW), false, 'a future time does not count');
assert.strictEqual(compactionBurst([], NOW), false);

// FR-022: one line, dismiss rules
const st = (shown: McpLevel, dismissed: McpLevel) => ({ shown, dismissed });
assert.strictEqual(lineAction(st('none', 'none'), 'none'), 'none');
assert.strictEqual(lineAction(st('none', 'none'), 'warn'), 'show', 'the first crossing');
assert.strictEqual(lineAction(st('none', 'none'), 'strong'), 'show', 'first figure already strong (SC-001)');
assert.strictEqual(lineAction(st('warn', 'none'), 'warn'), 'none', 'one line: no second one');
assert.strictEqual(lineAction(st('warn', 'none'), 'strong'), 'update', 'the same line rises');
assert.strictEqual(lineAction(st('strong', 'none'), 'warn'), 'update', 'the same line falls');
assert.strictEqual(lineAction(st('warn', 'none'), 'none'), 'hide', 'below the level: gone');
assert.strictEqual(lineAction(st('none', 'warn'), 'warn'), 'none', 'dismissed at warn: not back at warn');
assert.strictEqual(lineAction(st('none', 'warn'), 'strong'), 'show', 'dismissed at warn: back when it rises to strong');
assert.strictEqual(lineAction(st('none', 'strong'), 'strong'), 'none', 'dismissed at strong: never again');
assert.strictEqual(lineAction(st('none', 'strong'), 'warn'), 'none');

// FR-024: partial and unknown
assert.strictEqual(warningOf(rep(20_000), undefined, L), null, '10 %: no line');
assert.strictEqual(warningOf(rep(40_000, { window: undefined }), undefined, L), null, 'window unknown: no line');
assert.strictEqual(warningOf({ servers: [{ name: 'a', source: 'unknown' }], window: 1000 }, undefined, L), null, 'no figures: no line');
assert.strictEqual(warningOf(rep(20_000, { partial: true }), undefined, L), null, 'partial below the level: no line');
const atLeast = warningOf(rep(40_000, { partial: true }), undefined, L);
assert.ok(atLeast && atLeast.atLeast && atLeast.level === 'warn', 'partial above the level: raised as at least');
assert.ok(/at least 20 %/.test(warningText(atLeast)), warningText(atLeast));
assert.strictEqual(warningOf(rep(90_000), undefined, { ...L, off: true }), null, 'off: no line');

// the words (US1, US2, US3, SC-002)
const owner = warningOf({ window: 200_000, servers: [{ name: 'github', tokens: 41_000, source: 'estimated' }, { name: 'jira', tokens: 12_000, source: 'estimated' }, { name: 'c', tokens: 9000, source: 'estimated' }, { name: 'd', tokens: 100, source: 'estimated' }] }, undefined, L);
assert.ok(owner);
assert.strictEqual(warningText(owner), 'MCP tool definitions take 31 % of this 200k window (github ≈41k, jira ≈12k, c ≈9k). This can make the conversation compact often.');
assert.strictEqual(compactionHintText(owner), 'MCP tool definitions take 31 % of the window, so each compaction frees less. Switching off github would free ≈41k.');
const big = warningOf(rep(200_000, { window: 1_000_000 }), undefined, L);
assert.ok(big && /1M window, 200k tokens/.test(warningText(big)), 'a 1M window also says the tokens');
assert.ok(big && /\(github 200k\)/.test(warningText(big)), 'a reported figure has no ≈');
assert.deepStrictEqual([fmtK(0), fmtK(400), fmtK(1200), fmtK(9960), fmtK(38_000), fmtK(1_000_000), fmtK(1_500_000)], ['0', '0.4k', '1.2k', '10k', '38k', '1M', '1.5M']);
assert.strictEqual(figureOf({ tokens: 12_000, source: 'reported' }), '12k');
assert.strictEqual(figureOf({ tokens: 12_000, source: 'estimated' }), '≈12k');
assert.strictEqual(figureOf({ tokens: 12_000, source: 'estimated', capped: true }), '≥12k');
assert.strictEqual(figureOf({ source: 'unknown' }), '');
assert.strictEqual(chipFigure(rep(38_000)), '38k');
assert.strictEqual(chipFigure({ servers: [{ name: 'a', tokens: 38_000, source: 'estimated' }] }), '≈38k');
assert.strictEqual(chipFigure({ servers: [{ name: 'a', source: 'unknown' }] }), '');
assert.strictEqual(chipWords({ servers: [{ name: 'a', tokens: 38_000, source: 'estimated' }], window: 200_000 }, undefined, L), 'MCP tool definitions: about 38 thousand tokens, 19 % of the window, estimated. Above the warning level of 15 %');
assert.strictEqual(chipWords(rep(70_000), undefined, L), 'MCP tool definitions: 70 thousand tokens, 35 % of the window, reported. Far above the warning level of 30 %');
assert.strictEqual(chipWords(rep(10_000), undefined, L), 'MCP tool definitions: 10 thousand tokens, 5 % of the window, reported');
assert.strictEqual(chipWords(rep(10_000, { window: undefined }), undefined, L), 'MCP tool definitions: 10 thousand tokens, reported', 'window unknown: tokens only');
assert.strictEqual(rowFigure({ name: 'a', tokens: 12_000, source: 'reported' }, { hasReport: true }), '12k tokens');
assert.strictEqual(rowFigure({ name: 'a', tokens: 12_000, source: 'estimated' }, { hasReport: true, largest: true }), '≈12k tokens (estimated), largest');
assert.strictEqual(rowFigure({ name: 'a', tokens: 0, deferredTokens: 400, source: 'reported' }, { hasReport: true }), '0 tokens, loaded on demand: 0.4k');
for (const o of [{ off: true }, { status: 'failed' }, { status: 'disabled' }, { status: 'needs-auth' }]) assert.strictEqual(rowFigure({ name: 'a', tokens: 12_000, source: 'reported' }, { ...o, hasReport: true }), 'not loaded', 'a failed or off server shows no figure');
assert.strictEqual(rowFigure({ name: 'a', source: 'unknown' }, { hasReport: true }), 'size not known');
assert.strictEqual(rowFigure(undefined, { hasReport: true }), 'size not known');
assert.strictEqual(rowFigure(undefined, { hasReport: false }), '', 'no report: the row stays as it was');
assert.strictEqual(totalLine({ servers: [{ name: 'a', tokens: 38_000, source: 'estimated' }], window: 200_000 }, undefined), 'Tool definitions of these servers: ≈38k tokens, 19 % of the 200k window');
assert.strictEqual(totalLine(rep(38_000, { partial: true }), undefined), 'Tool definitions of the servers that answered: 38k tokens, 19 % of the 200k window');
assert.strictEqual(totalLine(rep(38_000, { window: undefined }), undefined), 'Tool definitions of these servers: 38k tokens', 'window unknown: no percentage');
assert.strictEqual(totalLine({ servers: [] }, 1000), '');
assert.strictEqual(footnoteOf(rep(1), 'Copilot'), 'Reported by Copilot.');
assert.strictEqual(footnoteOf({ servers: [] }, 'Copilot'), 'Size not reported by Copilot.', 'no estimate from Copilot (decided Q4)');
assert.ok(/about 4 characters per token; the real figure can differ by a third/.test(footnoteOf({ servers: [{ name: 'a', tokens: 1, source: 'estimated' }] }, 'Codex')));

// FR-030: the hint
const burst = [NOW, NOW - MIN, NOW - 2 * MIN, NOW - 3 * MIN];
const r31: McpContextReport = { window: 200_000, servers: [{ name: 'github', tokens: 41_000, source: 'estimated' }, { name: 'jira', tokens: 21_000, source: 'estimated' }] };
const hint = compactionHint(r31, undefined, L, burst, NOW, {});
assert.ok(hint);
assert.deepStrictEqual([hint.level, hint.top], ['strong', 'github']);
assert.strictEqual(hint.text, 'MCP tool definitions take 31 % of the window, so each compaction frees less. Switching off github would free ≈41k.');
assert.strictEqual(compactionHint(r31, undefined, L, burst.slice(1), NOW, {}), null, 'no burst: no hint');
assert.strictEqual(compactionHint(rep(20_000), undefined, L, burst, NOW, {}), null, '10 %: below the warn level');
assert.strictEqual(compactionHint(rep(30_000), undefined, L, burst, NOW, {})?.level, 'warn', 'exactly the warn level counts here ("at least", FR-030)');
assert.strictEqual(compactionHint(r31, undefined, L, burst, NOW, { strong: true }), null, 'once per session per level');
assert.ok(compactionHint(r31, undefined, L, burst, NOW, { warn: true }), 'a higher level may show once more');
assert.strictEqual(compactionHint(r31, undefined, { ...L, off: true }, burst, NOW, {}), null, 'off: never');
assert.strictEqual(compactionHint(rep(40_000, { window: undefined }), undefined, L, burst, NOW, {}), null, 'window unknown: never');
assert.ok(/at least/.test(compactionHint({ ...r31, partial: true }, undefined, L, burst, NOW, {})?.text ?? ''), 'partial: at least');

// FR-012: the Settings line
const at = (ms: number): string => `t${ms}`;
assert.strictEqual(costLine({ codex: { tokens: 12_000, source: 'estimated', at: 5 }, claude: { tokens: 0, deferredTokens: 400, source: 'reported', at: 9 } }, at), '0.4k on demand in Claude Code, ≈12k in Codex, measured t9');
assert.strictEqual(costLine({ copilot: { tokens: 12_000, source: 'reported', at: 5 } }, at), '12k in Copilot, measured t5');
assert.strictEqual(costLine({}, at), '', 'never measured: nothing');

// T012: Copilot's reply, parsed
const entry = (kind: string, id: string, tokens: unknown, parentId?: string) => ({ kind, id, label: 'ignored', tokens, ...(parentId ? { parentId } : {}) });
const cop = (entries: unknown[], extra: object = {}): McpContextReport => copilotMcpContext({ contextAttribution: { limit: 200_000, entries, ...extra } });
assert.deepStrictEqual(cop([entry('mcpServer', 'mcpServer:a', 500), entry('tool', 'tool:x', 300, 'mcpServer:a'), entry('tool', 'tool:y', 100, 'mcpServer:a')]).servers, [{ name: 'a', tokens: 500, source: 'reported' }], 'children inside the parent: not counted twice');
assert.deepStrictEqual(cop([entry('mcpServer', 'mcpServer:a', 0), entry('tool', 'tool:x', 300, 'mcpServer:a'), entry('tool', 'tool:y', 100, 'mcpServer:a')]).servers, [{ name: 'a', tokens: 400, source: 'reported' }], 'a parent with no figure of its own: the children');
assert.deepStrictEqual(cop([entry('plugin', 'plugin:p', 999), entry('mcpServer', 'mcpServer:a', 70, 'plugin:p')]).servers, [{ name: 'a', tokens: 70, source: 'reported' }], 'a server under a plugin is still a server; the plugin is not');
assert.deepStrictEqual(cop([entry('mcpServer', 'mcpServer:a', 70), entry('mcpServer', 'mcpServer:b', 30, 'mcpServer:a')]).servers, [{ name: 'a', tokens: 70, source: 'reported' }], 'a server nested in a server is not a second row');
assert.deepStrictEqual(cop([entry('mcpServer', 'mcpServer:a', NaN), entry('mcpServer', 'mcpServer:b', 1e12), entry('mcpServer', 'mcpServer:c', -1)]).servers.map((x) => x.tokens), [0, 0, 0], 'bad numbers are no tokens');
assert.deepStrictEqual(cop([{ kind: 'mcpServer' }, null, 'x', entry('other', 'mcpServer:z', 9)]).servers, [], 'odd entries and other kinds: ignored');
assert.strictEqual(cop([], { limit: NaN }).window, undefined, 'a bad limit is no window');
assert.strictEqual(cop([], { categories: { mcpTools: 5000 } }).total, 5000);
assert.strictEqual(copilotMcpContext({ entries: [], limit: 1000 }).window, 1000, 'a reply without the wrapper');
for (const bad of [null, undefined, 'x', 7, [], { contextAttribution: null }, { contextAttribution: 'x' }]) assert.deepStrictEqual(copilotMcpContext(bad), { servers: [] }, 'not a report');
assert.strictEqual(cop([entry('mcpServer', 'mcpServer:' + 'n'.repeat(500), 1)]).servers[0].name.length, 128, 'names cut at 128');
assert.strictEqual(cop(Array.from({ length: 2100 }, (_, i) => entry('mcpServer', `mcpServer:s${i}`, 1))).servers.length, 2000, 'at most 2000 entries');

// T013: Claude's reply, parsed
const NAMES = ['my.server', 'a__b', 'web'];
const cl = (mcpTools: unknown[], extra: object = {}): McpContextReport => claudeMcpContext({ mcpTools, ...extra }, NAMES);
assert.deepStrictEqual(cl([{ name: 'mcp__my_server__t', serverName: 'my_server', tokens: 5 }]).servers.map((x) => x.name), ['my.server'], 'a normalised name goes back to the mcp_status name');
assert.deepStrictEqual(cl([{ name: 'odd', serverName: 'my_server', tokens: 5 }]).servers.map((x) => x.name), ['my.server'], 'by serverName when the tool name does not parse');
assert.deepStrictEqual(cl([{ name: 'mcp__a__b__t', serverName: 'a', tokens: 5 }]).servers.map((x) => x.name), ['a__b'], 'a server name with __: the longest match, not the first segment the CLI splits on');
assert.deepStrictEqual(cl([{ serverName: 'unlisted', tokens: 5 }]).servers.map((x) => x.name), ['unlisted'], 'a server the list does not have keeps its name');
assert.deepStrictEqual(cl([{ serverName: 'web', tokens: NaN }, { serverName: 'web', tokens: 1e10 }, { serverName: 'web', tokens: -1 }, { tokens: 5 }, null]).servers, [], 'bad numbers and no name: dropped');
assert.strictEqual(cl(Array.from({ length: 2500 }, () => ({ serverName: 'web', tokens: 1 }))).servers[0].tokens, 2000, 'at most 2000 tools');
assert.strictEqual(cl([{ serverName: 'n'.repeat(500), tokens: 1 }]).servers[0].name.length, 128, 'names cut at 128');
assert.strictEqual(cl([], { maxTokens: 160_000 }).window, 160_000, 'maxTokens without rawMaxTokens');
assert.strictEqual(cl([], { modelUsage: { m: { contextWindow: 1_000_000 } } }).window, 1_000_000, 'modelUsage last');
assert.strictEqual(cl([], { rawMaxTokens: 200_000, maxTokens: 1, modelUsage: { m: { contextWindow: 3 } } }).window, 200_000, 'rawMaxTokens first');
assert.strictEqual(cl([], { rawMaxTokens: Infinity }).window, undefined);
assert.deepStrictEqual(claudeMcpContext(null, NAMES), { servers: [] });
assert.strictEqual(reportTotal(cl([{ serverName: 'web', tokens: 40_000, isLoaded: false }, { serverName: 'web', tokens: 10, isLoaded: true }])), 10, 'an unloaded tool is not in the window');

// T014: Codex
assert.deepStrictEqual(codexMcpContext([null, 'x', { tools: {} }]), { servers: [] }, 'odd rows');
const huge = codexMcpContext([{ name: 'big', tools: many(700) }]);
assert.deepStrictEqual([huge.servers[0].capped, huge.servers[0].tools, huge.servers[0].tokens], [true, 700, five.tokens], 'over the cap: marked');
assert.strictEqual(figureOf(huge.servers[0]), `≥${fmtK(five.tokens)}`);
assert.deepStrictEqual(codexMcpContext([{ name: 'empty' }]).servers, [{ name: 'empty', tokens: 0, tools: 0, source: 'estimated' }], 'no tools: 0, estimated');

console.log('test:mcpcost OK');
