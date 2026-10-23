/**
 * Label backfill (spec 021 FR-045, team decision 2026-10-23): every issue and PR gets exactly one type label, at least one
 * area:* label and spec:NNN for every spec it touches. This script proposes the missing ones, ADD-ONLY (it never removes a label).
 *
 *   npm run labels:backfill                    dry run (default): per item the proposed additions, then totals per label
 *   npm run labels:backfill -- --apply         add them (throttled, idempotent: only labels the item does not have yet)
 *   npm run labels:backfill -- --create-labels create the labels that are missing (.github/labels.tsv plus spec:NNN per folder)
 *   --days N                                   closed items closed within the last N days (default 30); older closed ones are skipped
 *   --repo owner/name                          another repository (default: the current one)
 *
 * Needs `gh` logged in; --apply and --create-labels need write access. gh is spawned without a shell, with fixed arguments.
 * The inference functions are pure and exported for scripts/test-labels-backfill.ts.
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

export const TYPE_LABELS = ['bug', 'enhancement', 'task', 'documentation', 'question'] as const;

export interface Item {
  kind: 'issue' | 'pr';
  number: number;
  title: string;
  body: string;
  labels: string[];
  branch?: string; // PRs: head branch
  files?: string[]; // PRs: changed paths
}

export interface Proposal {
  item: Item;
  add: string[];
  notes: string[]; // things a human must look at (two type labels, no area found)
}

// Spec number -> area, used when a PR's paths or an issue's title say nothing clearer.
export const SPEC_AREAS: Record<string, string[]> = {
  '001': ['ui'], '002': ['adapters'], '003': ['permissions'], '004': ['ui'], '005': ['ui'], '006': ['ui'], '007': ['adapters'],
  '008': ['packaging'], '009': ['adapters'], '010': ['ui'], '011': ['usage'], '012': ['adapters'], '013': ['adapters'], '014': ['packaging'],
  '015': ['ui'], '016': ['ui'], '017': ['ui'], '018': ['permissions'], '019': ['mcp'], '020': ['mcp'], '021': ['harness'], '023': ['packaging'],
  '024': ['ui'], '025': ['docs'], '026': ['packaging'], '030': ['adapters'], '031': ['packaging'], '033': ['ui'], '034': ['ui'], '035': ['ui'],
  '036': ['ui'], '037': ['ui'], '038': ['ui'], '039': ['ui'], '040': ['ui'], '041': ['mcp'], '042': ['packaging'], '043': ['adapters'],
  '044': ['schedules'], '045': ['security'], '046': ['packaging'], '047': ['packaging'], '048': ['ui'], '049': ['adapters'], '050': ['docs'],
  '051': ['harness'], '052': ['ui'], '053': ['packaging'], '054': ['ui'], '055': ['packaging'], '056': ['adapters'], '057': ['ui'], '058': ['mcp'],
  '059': ['ui'], '060': ['platform'], '061': ['adapters'], '062': ['ci'], '063': ['ui'], '064': ['ui'], '065': ['ui'], '066': ['adapters'],
  '067': ['packaging'], '068': ['ui'], '069': ['mcp'], '070': ['ui'], '071': ['packaging'], '072': ['schedules'], '073': ['ui'], '074': ['ui'],
  '075': ['docs'], '076': ['adapters'], '077': ['ui'], '078': ['packaging'],
};

// Changed path -> area, only where the mapping is unambiguous (Paco's review of #633): a directory or a named file that belongs
// to one area. Shared files (README.md, package.json, CHANGELOG.md, changelog.d/, src/renderer/app.js alone, src/main/main.ts,
// the IPC and preload glue, tests) give no area by themselves. A changed specs/NNN-* folder gives that spec's area (SPEC_AREAS).
const PATH_RULES: Array<[RegExp, string]> = [
  [/^src\/adapters\//, 'adapters'],
  [/^src\/renderer\/(?!app\.js$)/, 'ui'],
  [/^src\/main\/(themes|floors|names|sessionnames)\.ts$|^src\/shared\/(themes|themetokens|themegen|floors|places|names|sessionname)\.ts$/, 'ui'],
  [/^\.github\/(workflows|scripts)\//, 'ci'],
  [/^(AGENTS\.md|CLAUDE\.md|\.claude\/|\.specify\/|\.github\/(ISSUE_TEMPLATE\/|copilot-instructions\.md|pull_request_template\.md|CODEOWNERS|labels\.tsv)|docs\/(collaboration|agent-notes)\.md|docs\/agent-setup\/|scripts\/(pr-gate\.sh|labels-backfill\.ts|test-labels-backfill\.ts))/, 'harness'],
  [/^docs\/(?!collaboration\.md|agent-notes\.md|agent-setup\/)/, 'docs'],
  [/^src\/main\/mcp(\/|\w*\.ts$)|^src\/shared\/mcp\w*\.ts$|^src\/adapters\/(mcp\w*|codexMcp)\.ts$/, 'mcp'],
  [/^src\/adapters\/(permissions|claudeModes|codexModes)\.ts$|^src\/main\/agenttrust\.ts$/, 'permissions'],
  [/^src\/main\/schedules\.ts$|^src\/shared\/(schedrules|looppace)\.ts$/, 'schedules'],
  [/^src\/shared\/(redact|wincmd|guards)\.ts$|^src\/main\/(hardening|ipcguard|debugguard)\.ts$/, 'security'],
  [/^(electron-builder\.[a-z]+|build\/|scripts\/(after-pack|pack-esm-\w+|installed-app-\w+|install-check|prepare-runtime|check-fuses(-launch)?)\.[jt]s)$|^build\//, 'packaging'],
  [/^src\/main\/(usagestore|usagetotalsstore)\.ts$|^src\/shared\/(credits|toolusage|usagedoc)\.ts$|^src\/adapters\/usagelimit\.ts$/, 'usage'],
  [/^\.github\/platforms\.json$|^src\/main\/(aumid|titledblclick|loginpath)\.ts$|^scripts\/check-mac-titlebar\.js$/, 'platform'],
];

// Title (and branch) words -> area: the author's own words, used only when neither the paths nor the specs gave an area.
const WORD_RULES: Array<[RegExp, string]> = [
  [/\b(adapter|copilot|codex|claude code|sdk)\b/i, 'adapters'],
  [/\b(ui|office|chat|screen|theme|desk|room|floor|dialog|menu|button|composer)\b/i, 'ui'],
  [/\b(ci|workflow|gate|codeql|actions?)\b/i, 'ci'],
  [/\b(docs?|readme|website|site|screenshots?)\b/i, 'docs'],
  [/\bmcp\b/i, 'mcp'],
  [/\b(permission|read-only|ask first|allow all|approval|grant)s?\b/i, 'permissions'],
  [/\b(schedul\w*|loops?)\b/i, 'schedules'],
  [/\b(security|secret|redact\w*|token leak|cve|vulnerab\w*)\b/i, 'security'],
  [/\b(packag\w*|installer|sign(ing)?|notari[sz]\w*|release|dmg|msi|appimage)\b/i, 'packaging'],
  [/\b(usage|credits?|cost|caps?)\b/i, 'usage'],
  [/\b(macos|windows|linux|platform)\b/i, 'platform'],
  [/\b(harness|agents?\.md|labels?|spec kit|board)\b/i, 'harness'],
];

export const MAX_BODY_SPECS = 3;
// Areas that only count when no other area matched: nearly every PR touches the docs and the agent notes (docs in sync).
const SECONDARY = new Set(['docs', 'harness']);

// documentation: user-facing docs only (README, docs/, guides). Spec Kit work (specs/) and the agent rules (AGENTS.md, CLAUDE.md)
// are not documentation: a spec-only PR is a task with the feature's area (Paco's review of #633).
const DOCS_ONLY = /^(docs\/(?!collaboration\.md|agent-notes\.md|agent-setup\/)|changelog\.d\/|README\.md|CHANGELOG\.md|CONTRIBUTING\.md|SECURITY\.md|(?!AGENTS\.md|CLAUDE\.md)[^/]+\.md$)/;
const SPEC_ONLY = /^(specs\/|changelog\.d\/)/;
const SHARED_ONLY = /^(changelog\.d\/|CHANGELOG\.md)/;

/** spec numbers the item touches, kept only when specs/NNN-* exists. */
export function inferSpecs(item: Item, knownSpecs: Set<string>): string[] {
  const found = new Set<string>();
  const t = /^\s*(?:\[\s*(\d{3})\b|spec\s+(\d{3})\b|(\d{3})\s*[:\-])/i.exec(item.title);
  if (t) found.add(t[1] ?? t[2] ?? t[3]);
  if (item.branch) { const b = /^(\d{3})-/.exec(item.branch); if (b) found.add(b[1]); }
  for (const f of item.files ?? []) { const m = /^specs\/(\d{3})-/.exec(f); if (m) found.add(m[1]); }
  // The body counts for issues only (a PR's own spec is in its title, branch and changed folders), and only when it names a
  // few specs: an idea that discusses ten specs does not touch them.
  if (item.kind === 'issue') {
    const body = new Set<string>();
    for (const m of item.body.matchAll(/\bspecs?\s*:?\s+(\d{3})\b/gi)) body.add(m[1]);
    for (const m of item.body.matchAll(/\bspecs\/(\d{3})-/g)) body.add(m[1]);
    const real = [...body].filter((n) => knownSpecs.has(n));
    if (real.length <= MAX_BODY_SPECS) for (const n of real) found.add(n);
  }
  return [...found].filter((n) => knownSpecs.has(n)).sort();
}

export function inferAreas(item: Item, specs: string[]): string[] {
  const areas = new Set<string>();
  for (const f of item.files ?? []) {
    for (const [re, a] of PATH_RULES) if (re.test(f)) areas.add(a);
    const m = /^specs\/(\d{3})-/.exec(f);
    if (m) for (const a of SPEC_AREAS[m[1]] ?? []) areas.add(a);
  }
  if ([...areas].some((a) => !SECONDARY.has(a))) for (const a of SECONDARY) areas.delete(a);
  if (!areas.size) for (const s of specs) for (const a of SPEC_AREAS[s] ?? []) areas.add(a);
  if (!areas.size) for (const [re, a] of WORD_RULES) if (re.test(`${item.title} ${item.branch ?? ''}`.replace(/[-_]/g, ' '))) areas.add(a);
  return [...areas].sort();
}

export function inferType(item: Item): string | null {
  const text = `${item.title} ${(item.branch ?? '').replace(/[-_/]/g, ' ')}`.replace(/\breview fix(es)?\b/gi, 'review');
  const files = item.files ?? [];
  const own = files.filter((f) => !SHARED_ONLY.test(f));
  if (item.kind === 'pr' && own.length && own.every((f) => SPEC_ONLY.test(f))) return 'task';
  if (item.kind === 'pr' && own.length && own.every((f) => DOCS_ONLY.test(f))) return 'documentation';
  if (/^\s*(docs?|readme)\b/i.test(item.title)) return 'documentation';
  if (/\b(fix(es|ed)?|bug|broken|crash\w*|regression|flak[ey]\w*|wrong|fails?)\b/i.test(text)) return 'bug';
  if (/\?\s*$/.test(item.title) || /^\s*question\b/i.test(item.title)) return 'question';
  if (/\bT\d{3}\b/.test(item.title)) return 'task';
  if (/\b(release|bump|chore|ci|refactor|backfill|sweep|record|land|integration|merge only|retake|screenshots?)\b/i.test(text)) return 'task';
  if (/\b(idea|feature|feat|owner request|add|new|support)\b/i.test(text)) return 'enhancement';
  if (item.kind === 'pr' && files.some((f) => f.startsWith('src/'))) return 'enhancement';
  return 'task';
}

export function propose(item: Item, knownSpecs: Set<string>): Proposal {
  const has = new Set(item.labels);
  const notes: string[] = [];
  const types = item.labels.filter((l) => (TYPE_LABELS as readonly string[]).includes(l));
  if (types.length > 1) notes.push(`has ${types.length} type labels (${types.join(', ')}): a human picks one`);
  const specs = inferSpecs(item, knownSpecs);
  const specAdds = specs.filter((s) => !has.has(`spec:${s}`)).map((s) => `spec:${s}`);
  let areaAdds: string[] = [];
  if (!item.labels.some((l) => l.startsWith('area:'))) {
    const allSpecs = [...new Set([...specs, ...item.labels.filter((l) => /^spec:\d{3}$/.test(l)).map((l) => l.slice(5))])];
    areaAdds = inferAreas(item, allSpecs).map((a) => `area:${a}`);
    if (!areaAdds.length) notes.push('no area found: a human adds one');
  }
  // A flagged item gets no type or area from the script (Paco, #633): a human or the item's owner agent picks them.
  if (notes.length) return { item, add: specAdds, notes };
  const typeAdd = types.length ? [] : [inferType(item)].filter((t): t is string => !!t);
  return { item, add: [...typeAdd, ...specAdds, ...areaAdds], notes };
}

export function totals(proposals: Proposal[]): Array<[string, number]> {
  const c = new Map<string, number>();
  for (const p of proposals) for (const l of p.add) c.set(l, (c.get(l) ?? 0) + 1);
  return [...c.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

/** The labels the taxonomy needs: .github/labels.tsv plus one spec:NNN per specs/ folder (same as sync-labels.sh). */
export function wantedLabels(root: string): Array<{ name: string; color: string; description: string }> {
  const out: Array<{ name: string; color: string; description: string }> = [];
  for (const line of fs.readFileSync(path.join(root, '.github', 'labels.tsv'), 'utf8').split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    const [name, color, description] = line.split('\t');
    if (name && color) out.push({ name, color, description: description ?? '' });
  }
  for (const d of fs.readdirSync(path.join(root, 'specs')).sort()) {
    const m = /^(\d{3})-(.+)$/.exec(d);
    if (m) out.push({ name: `spec:${m[1]}`, color: '0e8a16', description: `Spec ${m[1]}: ${m[2]}` });
  }
  return out;
}

// ---- gh plumbing (not unit tested; dry run only reads) ----

function gh(args: string[], repo: string | null): string {
  return execFileSync('gh', repo ? [...args, '--repo', repo] : args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

interface RawItem { number: number; title: string; body: string; labels: Array<{ name: string }>; headRefName?: string; files?: Array<{ path: string }> }

function toItem(kind: 'issue' | 'pr', r: RawItem): Item {
  return { kind, number: r.number, title: r.title, body: r.body ?? '', labels: r.labels.map((l) => l.name), branch: r.headRefName, files: r.files?.map((f) => f.path) };
}

function fetchItems(repo: string | null, days: number): Item[] {
  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const issueFields = 'number,title,body,labels';
  const prFields = 'number,title,body,labels,headRefName,files';
  const list = (kind: 'issue' | 'pr', state: string, search: string | null): Item[] => {
    const args = [kind, 'list', '--state', state, '--limit', '1000', '--json', kind === 'pr' ? prFields : issueFields];
    if (search) args.push('--search', search);
    return (JSON.parse(gh(args, repo)) as RawItem[]).map((r) => toItem(kind, r));
  };
  const seen = new Map<string, Item>();
  for (const it of [
    ...list('issue', 'open', null), ...list('issue', 'closed', `closed:>=${since}`),
    ...list('pr', 'open', null), ...list('pr', 'closed', `closed:>=${since}`),
  ]) seen.set(`${it.kind}${it.number}`, it);
  return [...seen.values()].sort((a, b) => a.number - b.number);
}

async function withRetry(what: string, fn: () => void): Promise<boolean> {
  for (let attempt = 1; attempt <= 4; attempt++) {
    try { fn(); return true; } catch (e) {
      const msg = String((e as { stderr?: string }).stderr ?? e);
      if (/rate limit|secondary|abuse|HTTP 429/i.test(msg) && attempt < 4) { console.error(`${what}: rate limited, waiting ${60 * attempt} s`); await sleep(60000 * attempt); continue; }
      console.error(`${what}: failed: ${msg.split('\n')[0]}`);
      return false;
    }
  }
  return false;
}

async function main(argv: string[]): Promise<number> {
  const apply = argv.includes('--apply');
  const createLabels = argv.includes('--create-labels');
  const opt = (name: string): string | null => { const i = argv.indexOf(name); return i >= 0 && argv[i + 1] ? argv[i + 1] : null; };
  const days = Number(opt('--days') ?? 30);
  const repo = opt('--repo');
  if (!Number.isFinite(days) || days < 0) { console.error('--days needs a number'); return 2; }
  const root = process.cwd();
  if (!fs.existsSync(path.join(root, 'specs')) || !fs.existsSync(path.join(root, '.github', 'labels.tsv'))) { console.error('run from the repository root'); return 2; }

  const existing = new Set((JSON.parse(gh(['label', 'list', '--limit', '1000', '--json', 'name'], repo)) as Array<{ name: string }>).map((l) => l.name));
  const wanted = wantedLabels(root);
  const missing = wanted.filter((l) => !existing.has(l.name));
  if (createLabels) {
    for (const l of missing) {
      if (await withRetry(`label ${l.name}`, () => gh(['label', 'create', l.name, '--color', l.color, '--description', l.description], repo))) { existing.add(l.name); console.log(`created label ${l.name}`); }
      await sleep(1000);
    }
  } else if (missing.length) {
    console.log(`Labels missing in the repository (--create-labels creates them): ${missing.map((l) => l.name).join(', ')}`);
  }

  const knownSpecs = new Set(fs.readdirSync(path.join(root, 'specs')).map((d) => /^(\d{3})-/.exec(d)?.[1]).filter((x): x is string => !!x));
  const items = fetchItems(repo, days);
  const proposals = items.map((it) => propose(it, knownSpecs));
  const changing = proposals.filter((p) => p.add.length);
  console.log(`${apply ? 'Applying' : 'Dry run'}: ${items.length} items (${items.filter((i) => i.kind === 'issue').length} issues, ${items.filter((i) => i.kind === 'pr').length} PRs; open plus closed in the last ${days} days), ${changing.length} get labels.`);
  for (const p of proposals) {
    if (!p.add.length && !p.notes.length) continue;
    const head = `${p.item.kind === 'pr' ? 'PR' : 'issue'} #${p.item.number} ${p.item.title.slice(0, 70)}`;
    console.log(`${head}\n    + ${p.add.join(', ') || '(nothing)'}${p.notes.map((n) => `\n    ! ${n}`).join('')}`);
  }
  console.log('\nTotals (label: items it would be added to):');
  for (const [l, n] of totals(proposals)) console.log(`  ${l}: ${n}${existing.has(l) ? '' : ' (label missing)'}`);
  const flagged = proposals.filter((p) => p.notes.length).length;
  if (flagged) console.log(`\n${flagged} items need a human look (lines with !): ${proposals.filter((p) => p.notes.length).map((p) => `#${p.item.number}`).join(' ')}`);

  if (apply) {
    let done = 0;
    for (const p of changing) {
      const add = p.add.filter((l) => existing.has(l));
      const skipped = p.add.filter((l) => !existing.has(l));
      if (skipped.length) console.error(`#${p.item.number}: skipped missing labels ${skipped.join(', ')} (run --create-labels first)`);
      if (!add.length) continue;
      const sub = p.item.kind === 'pr' ? 'pr' : 'issue';
      if (await withRetry(`#${p.item.number}`, () => gh([sub, 'edit', String(p.item.number), '--add-label', add.join(',')], repo))) done++;
      await sleep(1200); // stay well under GitHub's secondary rate limit for writes
    }
    console.log(`\nApplied labels to ${done} of ${changing.length} items.`);
  }
  return 0;
}

if (require.main === module) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (e) => { console.error(String(e?.stderr ?? e)); process.exitCode = 1; });
}
