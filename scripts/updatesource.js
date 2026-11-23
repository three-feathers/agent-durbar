// Spec 118 FR-001 (T007): the update source baked into a build. scripts/copy-assets.js writes dist/main/updatesource.json with it; at run time
// the app reads only that file (src/main/updatesource.ts), never the environment or package.json. The repository parser is injected (the
// compiled `parseRepoSlug` of src/shared/selfupdate.ts), so this file and its test use the one strict parser.
//
//   node scripts/updatesource.js --summary <updatesource.json>   one Markdown line for a job summary (T028), after `npm run build`
'use strict';
const fs = require('fs');
const path = require('path');

// An environment value: unset or empty = not given; anything else must parse, and a value that does not fails the build (no fallback).
const given = (env, k) => Object.prototype.hasOwnProperty.call(env, k) && env[k] !== undefined && env[k] !== '';

/** The package.json `repository` as npm writes it: a string, or `{url}`; exactly one leading `git+` is npm's normal form and is dropped. */
function packageRepo(pkg) {
  const r = pkg && typeof pkg === 'object' ? pkg.repository : undefined;
  const raw = typeof r === 'string' ? r : r && typeof r === 'object' && !Array.isArray(r) ? r.url : undefined;
  if (typeof raw !== 'string') return undefined;
  return raw.startsWith('git+https://') ? raw.slice(4) : raw;
}

/** FR-001 order: DURBAR_UPDATE_REPO (origin env) > GITHUB_REPOSITORY (ci) > package.json repository (local). Throws when the chosen one does not parse. */
function resolveUpdateSource(env, pkg, parse) {
  const pick = given(env, 'DURBAR_UPDATE_REPO') ? ['DURBAR_UPDATE_REPO', env.DURBAR_UPDATE_REPO, 'env']
    : given(env, 'GITHUB_REPOSITORY') ? ['GITHUB_REPOSITORY', env.GITHUB_REPOSITORY, 'ci']
    : ['package.json repository', packageRepo(pkg), 'local'];
  const slug = parse(pick[1]);
  if (!slug) throw new Error(`updatesource: ${pick[0]} is not a GitHub owner/name (spec 118 FR-001); the build stops`);
  return { slug, origin: pick[2] };
}

const updateSourceText = (src) => JSON.stringify({ slug: src.slug, origin: src.origin }) + '\n';

/** Resolves and writes the file (copy-assets.js); returns what it wrote. */
function writeUpdateSource(file, env, pkg, parse) {
  const src = resolveUpdateSource(env, pkg, parse);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, updateSourceText(src));
  return src;
}

/** The job-summary line: the baked source, and a warning (never a failure) when it differs from package.json's repository. */
function summaryText(baked, pkg, parse, same) {
  if (!baked) return '- **Update source**: none (`dist/main/updatesource.json` missing or invalid): this build never checks for updates\n';
  const own = parse(packageRepo(pkg));
  const line = `- **Update source**: \`${baked.slug}\` (origin \`${baked.origin}\`)\n`;
  return own && same(own, baked.slug) ? line : line + `- **Warning**: the update source differs from package.json \`repository\` (\`${own || 'unparseable'}\`); a fork build names the fork, check that this is intended\n`;
}

module.exports = { resolveUpdateSource, updateSourceText, writeUpdateSource, summaryText, packageRepo };

if (require.main === module) {
  const [flag, file] = process.argv.slice(2);
  if (flag !== '--summary' || !file) { console.error('usage: node scripts/updatesource.js --summary <updatesource.json>'); process.exit(1); }
  const root = path.resolve(__dirname, '..');
  const su = require(path.join(root, 'dist', 'shared', 'selfupdate.js'));
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { text = undefined; }
  process.stdout.write(summaryText(su.parseUpdateSourceFile(text), require(path.join(root, 'package.json')), su.parseRepoSlug, su.sameRepo));
}
