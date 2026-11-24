'use strict';
/*
 * Spec 117 FR-020 / FR-021 / T014: `node scripts/review-profile.js <base> <head>` prints `heavy` or `light`, then every path that
 * is not on the light list. FAIL CLOSED: light is one explicit list; everything else is heavy, and so are an empty diff, an unreadable
 * diff, an unknown path, an unknown change status, a rename or copy with either end heavy, and a renderer .js change whose
 * diff is missing or touches an HTML sink, an escape or mask helper, a URL guard or the preload bridge. A heavy veto list is checked
 * first, so a later light rule cannot widen into masking, IPC, secrets, permissions, user-file writes, CSP pages or the
 * prompt-injection tooling. One heavy file makes the whole change heavy.
 * Git runs through execFileSync with an argument array (no shell); refs starting with `-` are refused. Exit 0 with the answer on the
 * first stdout line; exit 2 (and the line `heavy`) when git could not be read. Pure functions are exported for
 * scripts/test-review-profile.ts. Not wired into ci-changes.js yet (see spec 117 tasks T014 note).
 */
const path = require('path');
const { execFileSync } = require('child_process');

// ---- the light list (FR-020): the only way to be light ----
const RASTER_AUDIO_FONT = /\.(png|webp|jpe?g|gif|mp3|ogg|woff2)$/;
const CODE_EXT = /\.(js|mjs|cjs|ts|tsx|html?|css|svg|sh|ps1|py|yml|yaml)$/;
// Renderer modules that mask, sanitise, escape, label grants, check URLs or render agent text: heavy BY PATH, whatever the changed line says
// (Paco's review of #2027). Derived with: grep -rlE "safeMask|redact|sanitiz|\besc[A-Z_(]|escapeHtml|escape|lookalike|mask[A-Z]" src/renderer
// (every hit is kept: fail closed, a cosmetic file in the list only costs a heavy review), plus the trust and text modules that grep misses.
const HEAVY_RENDERER = [
  'safetext', 'lookalike', 'markdown', 'sandboxtext', 'grantlabel', 'whyallowed', 'mcpwords', 'signin', 'cuttext', 'chattrim',
  'browserpane', 'activitytable', 'modelswitch', 'foldersetup', 'exports-shim', 'app', 'teams', 'realoffice', 'profileeditor', 'scenekits',
  'places', 'orgwords', 'reorder', 'harnesses', 'slashsuggest', 'retry', 'liveact', 'helpercard', 'charmaker', 'theme', 'activity',
  'convsearch', 'screens', 'newfolder', 'notes', 'dock',
];
const KEYWORDS = ['redact', 'mask', 'trust', 'permiss', 'url', 'path', 'ipc', 'token', 'secret', 'fuzz', 'gate', 'claim', 'safe-print', 'spawn', 'shell', 'credit', 'spend',
  'safetext', 'brainstate', 'sanit', 'escape', 'csp', 'auth', 'lookalike', 'markdown', 'grantlabel', 'whyallowed', 'sandboxtext'];
/** Renderer line content that makes a renderer .js change heavy (FR-020 content rule). */
const SINK_PATTERNS = [
  /innerHTML|outerHTML|insertAdjacentHTML|document\s*\.\s*write|srcdoc/i,
  /setAttribute\s*\(\s*['"`](href|src)/i,
  /\.\s*(href|src)\b|\b(href|src)\s*[:=]/i,
  /\besc[A-Za-z0-9_$]*|\bsafeMask|\bmask[A-Za-z0-9_$]*/i,
  /openExternal|new\s+URL\s*\(|protocol|\b(https?|file):|lookalike/i,
  /agentDurbar\s*\./i,
];

const LIGHT_RULES = [
  { name: 'specs', test: (p) => p.startsWith('specs/') },
  { name: 'changelog.d', test: (p) => p.startsWith('changelog.d/') },
  { name: 'docs', test: (p) => p.startsWith('docs/') },
  { name: 'readme', test: (p) => p === 'readme.md' || p === 'changelog.md' },
  { name: 'binary assets', test: (p) => RASTER_AUDIO_FONT.test(p) },
  { name: 'renderer css', test: (p) => p.startsWith('src/renderer/') && p.endsWith('.css') },
  { name: 'renderer js', test: (p) => p.startsWith('src/renderer/') && p.endsWith('.js'), content: true },
  {
    name: 'ui drivers and tests',
    test: (p) => /^scripts\/(check-[^/]*\.js|shots-[^/]*\.js|ui-suite\.js|test-[^/]*\.(ts|js))$/.test(p),
    loads: true,
  },
];

// ---- the heavy veto, checked before any light rule (defense in depth; heavy is also "anything unlisted") ----
const HEAVY_VETO = [
  { name: 'src/main', test: (p) => p.startsWith('src/main/') },
  { name: 'src/shared', test: (p) => p.startsWith('src/shared/') },
  { name: 'src/preload', test: (p) => p.startsWith('src/preload/') },
  { name: 'src/adapters', test: (p) => p.startsWith('src/adapters/') },
  { name: '.github', test: (p) => p.startsWith('.github/') },
  { name: 'build', test: (p) => p.startsWith('build/') },
  { name: 'renderer masking, trust and text modules', test: (p) => p.startsWith('src/renderer/') && /\.js$/.test(p) && HEAVY_RENDERER.includes(p.split('/').pop().slice(0, -3)) },
  { name: 'renderer html (CSP pages)', test: (p) => p.startsWith('src/renderer/') && /\.html?$/.test(p) },
  { name: 'scripts shell and trust tooling', test: (p) => /^scripts\/[^/]*(\.sh|\.ps1|trust)[^/]*$/.test(p) || /^scripts\/(pr-gate|claim|safe-print|gh-trusted)\b/.test(p) },
  { name: 'docs/rules', test: (p) => p.startsWith('docs/rules/') },
  { name: 'docs/agent-setup', test: (p) => p.startsWith('docs/agent-setup/') },
  { name: 'docs code (the public site and any script under docs)', test: (p) => p.startsWith('docs/') && CODE_EXT.test(p) },
  { name: 'svg', test: (p) => p.endsWith('.svg') },
  { name: 'repo rules and manifests', test: (p) => ['package.json', 'package-lock.json', 'agents.md', 'claude.md'].includes(p) },
  { name: 'path with dot segments', test: (p) => p.split('/').some((s) => s === '..' || s === '.' || s === '') },
];

/** One light file must never hide a heavy one: heavy if ANY entry is heavy; an empty list is heavy. */
function combineAny(results) {
  return results.length > 0 && results.every((r) => r.profile === 'light') ? 'light' : 'heavy';
}

const DEFAULT_CONFIG = { lightRules: LIGHT_RULES, heavyVeto: HEAVY_VETO, sinkPatterns: SINK_PATTERNS, combine: combineAny, pathsOf: allPaths, keywords: KEYWORDS, heavyRenderer: HEAVY_RENDERER };

function normalize(p) {
  if (typeof p !== 'string' || p === '' || p.includes('\0')) return null;
  return p.replace(/\\/g, '/').replace(/^(\.\/)+/, '').toLowerCase();
}
function allPaths(e) { return e.oldPath ? [e.path, e.oldPath] : [e.path]; }

/** Added or removed lines of a unified diff (headers excluded). */
function changedLines(patch) {
  return String(patch).split('\n').filter((l) => /^[+-]/.test(l) && !/^(\+\+\+|---)( |$)/.test(l));
}

/** Source files named inside a driver or test (src/..., .github/..., relative imports). Used by the "loads only light files" rule. */
function referencedFiles(text) {
  const out = new Set();
  for (const m of text.matchAll(/(?:\.\.\/|\.\/|['"`])((?:src|\.github|scripts)\/[A-Za-z0-9_./-]+)/g)) out.add(m[1]);
  for (const m of text.matchAll(/['"`]\.\/([A-Za-z0-9_.-]+)['"`]/g)) out.add('scripts/' + m[1]);
  // modules loaded by name through path.join(R, 'safetext.js') or a bare quoted file name
  for (const m of text.matchAll(/['"`]([A-Za-z0-9_-]+)\.(?:js|ts)['"`]/g)) out.add('name:' + m[1].toLowerCase());
  return [...out];
}

function createProfile(config = DEFAULT_CONFIG) {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  /** Classify one normalized path. `ctx` = { patch, readFile }. Returns { profile, reason }. */
  function classifyPath(raw, ctx = {}, depth = 0) {
    const p = normalize(raw);
    if (p === null) return { profile: 'heavy', reason: 'unreadable path' };
    const veto = cfg.heavyVeto.find((r) => r.test(p));
    if (veto) return { profile: 'heavy', reason: 'heavy: ' + veto.name };
    const rule = cfg.lightRules.find((r) => r.test(p));
    if (!rule) return { profile: 'heavy', reason: 'not on the light list' };
    if (rule.content) {
      if (typeof ctx.patch !== 'string') return { profile: 'heavy', reason: 'renderer change without its diff' };
      const hit = changedLines(ctx.patch).find((l) => cfg.sinkPatterns.some((re) => re.test(l)));
      if (hit) return { profile: 'heavy', reason: 'renderer line touches a sink, escape, URL guard or bridge' };
    }
    if (rule.loads) {
      const base = p.split('/').pop();
      const kw = cfg.keywords.find((k) => base.includes(k));
      if (kw) return { profile: 'heavy', reason: 'name has "' + kw + '"' };
      if (depth > 0) return { profile: 'light', reason: rule.name };
      if (typeof ctx.readFile !== 'function') return { profile: 'heavy', reason: 'cannot read the file to see what it loads' };
      let text;
      try { text = ctx.readFile(raw); } catch { text = null; }
      if (typeof text !== 'string') return { profile: 'heavy', reason: 'cannot read the file to see what it loads' };
      for (const ref of referencedFiles(text)) {
        if (ref.startsWith('name:')) {
          const stem = ref.slice(5);
          if (cfg.heavyRenderer.includes(stem) || cfg.keywords.some((k) => stem.includes(k))) return { profile: 'heavy', reason: 'loads a heavy module by name: ' + stem };
          continue;
        }
        const cands = path.extname(ref) ? [ref] : [ref + '.ts', ref + '.js'];
        const isSrc = cands.some((c) => /^(src|\.github)\//.test(c)) || cands.some((c) => cfg.keywords.some((k) => c.split('/').pop().toLowerCase().includes(k)));
        if (!isSrc) continue;
        // a referenced file must itself be on the light list by path (renderer js: path only, its diff is not ours)
        const sub = classifyPath(cands[0], { patch: '', readFile: ctx.readFile }, depth + 1);
        if (sub.profile !== 'light') return { profile: 'heavy', reason: 'loads a non-light file: ' + ref };
      }
    }
    return { profile: 'light', reason: rule.name };
  }

  /** entries: strings or { status, path, oldPath?, patch? }. Returns { profile, files: [{path, profile, reason}] }. */
  function classify(entries, ctx = {}) {
    if (!Array.isArray(entries) || entries.length === 0) return { profile: 'heavy', files: [], reason: 'empty or unreadable diff' };
    const files = [];
    for (const raw of entries) {
      const e = typeof raw === 'string' ? { status: 'M', path: raw } : raw || {};
      const status = String(e.status || '?')[0];
      if (!['A', 'M', 'D', 'R', 'C'].includes(status)) { files.push({ path: String(e.path), profile: 'heavy', reason: 'unknown change status' }); continue; }
      const ps = cfg.pathsOf(e);
      for (const p of ps) {
        const r = classifyPath(p, { patch: e.patch, readFile: ctx.readFile });
        files.push({ path: String(p), profile: r.profile, reason: r.reason });
      }
    }
    return { profile: cfg.combine(files), files };
  }
  return { classify, classifyPath };
}

const DEFAULT = createProfile();

// ---- CLI: git through argument arrays only ----
function validRef(r) {
  return typeof r === 'string' && r.length > 0 && r.length < 200 && !r.startsWith('-') && /^[A-Za-z0-9_.\/@~^{}+-]+$/.test(r);
}
function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
}
/** Changed entries between base and head (merge-base form, what a PR changes), with -U0 patches for renderer .js files. */
function readDiff(base, head, cwd) {
  if (!validRef(base) || !validRef(head)) throw new Error('bad ref');
  const range = base + '...' + head;
  const z = git(['diff', '--name-status', '-M', '-z', '--no-ext-diff', '--no-textconv', range, '--'], cwd);
  const parts = z.split('\0');
  const entries = [];
  for (let i = 0; i < parts.length && parts[i] !== ''; ) {
    const status = parts[i++];
    if (/^[RC]/.test(status)) entries.push({ status, oldPath: parts[i++], path: parts[i++] });
    else entries.push({ status, path: parts[i++] });
  }
  if (entries.some((e) => e.path === undefined || (e.oldPath === undefined && /^[RC]/.test(e.status)))) throw new Error('unparsable diff');
  for (const e of entries) {
    if (/^src\/renderer\/.*\.js$/i.test(e.path.replace(/\\/g, '/'))) {
      const paths = e.oldPath ? [e.path, e.oldPath] : [e.path];
      e.patch = git(['diff', '-U0', '--no-ext-diff', '--no-textconv', range, '--', ...paths], cwd);
    }
  }
  return entries;
}

/** Reader of file contents AS OF <head> (git show <head>:<path>, argument array); a path missing at head throws. */
function headReader(head, cwd) {
  if (!validRef(head)) throw new Error('bad ref');
  return (p) => git(['show', head + ':' + p], cwd);
}

function main(argv) {
  const [base, head] = argv;
  if (!base || !head) { process.stdout.write('heavy\nusage: node scripts/review-profile.js <base> <head>\n'); return 2; }
  const root = path.join(__dirname, '..');
  let entries;
  try { entries = readDiff(base, head, root); } catch { process.stdout.write('heavy\nunreadable diff (fail closed)\n'); return 2; }
  // contents come from <head>, never the working tree; a file missing at head throws, which classifies heavy
  const readFile = headReader(head, root);
  const res = DEFAULT.classify(entries, { readFile });
  const lines = [res.profile];
  if (res.reason) lines.push(res.reason);
  for (const f of res.files) if (f.profile !== 'light') lines.push(`${f.path}: ${f.reason}`);
  // paths are repo file names (not secrets), printed for the PR author; strip control characters first
  process.stdout.write(lines.map((l) => l.replace(/[\x00-\x09\x0b-\x1f\x7f]/g, '?')).join('\n') + '\n');
  return 0;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = { classify: DEFAULT.classify, classifyPath: DEFAULT.classifyPath, createProfile, DEFAULT_CONFIG, LIGHT_RULES, HEAVY_VETO, SINK_PATTERNS, KEYWORDS, HEAVY_RENDERER, referencedFiles, readDiff, validRef, headReader };
