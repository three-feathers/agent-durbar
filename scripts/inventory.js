#!/usr/bin/env node
/*
 * The size ratchet of spec 070 FR-054: counts the font-size, line-height and font-weight literals, the px values of padding, margin and gap,
 * the radii that are not a token, the shadow literals and the `<button>` class sets of the renderer, chrome and office apart, and compares
 * them with scripts/fixtures/ui-inventory.json. A count over the baseline fails ("use a token or a class set that exists"); a count under it
 * fails until the baseline is lowered in the same change (`node scripts/inventory.js --update`), as the colour ratchet of FR-040 does.
 * It moved from the 2026-11-01 sweep's tools/inventory.js, trimmed to what `--check` needs. Plain Node, no dependency, only reads files,
 * runs the same on Windows, macOS and Linux (paths are normalised to `/`). `test:theme-tokens` runs it.
 *
 *   node scripts/inventory.js            print the counts
 *   node scripts/inventory.js --check    exit 1 on drift (what npm test does)
 *   node scripts/inventory.js --update   write the baseline (after lowering a count on purpose; never to raise one)
 *
 * Static detection: what the source names. Rules built from data at run time may be under-counted.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const BASELINE = path.join(__dirname, 'fixtures', 'ui-inventory.json');
const KINDS = ['font-size', 'line-height', 'font-weight', 'spacing', 'radius', 'shadow'];

const PX = /(?<![\w.-])-?\d*\.?\d+px\b/g;
const stripVarFallback = (v) => { let s = v, prev; do { prev = s; s = s.replace(/var\(\s*--[\w-]+\s*,[^()]*\)/g, 'var()'); } while (s !== prev); return s; };
const lineOf = (src, i) => src.slice(0, i).split('\n').length;

/* a small CSS parser: selectors and declarations; @media, @supports, @container and @layer bodies are walked, @keyframes and @font-face skipped */
function parseCss(src, file) {
  const rules = [];
  const clean = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  const walk = (from, to) => {
    let i = from, start = from;
    while (i < to) {
      if (clean[i] === '{') {
        const head = clean.slice(start, i).trim();
        let d = 1, j = i + 1;
        while (j < to && d) { if (clean[j] === '{') d++; else if (clean[j] === '}') d--; j++; }
        if (/^@(media|supports|container|layer)/.test(head)) walk(i + 1, j - 1);
        else if (!/^@/.test(head)) {
          const decls = [];
          for (const d2 of clean.slice(i + 1, j - 1).split(/;(?![^(]*\))/)) { const k = d2.indexOf(':'); if (k > 0) { const p = d2.slice(0, k).trim(); if (p) decls.push([p, d2.slice(k + 1).trim()]); } }
          rules.push({ file, line: lineOf(clean, i), selector: head.replace(/\s+/g, ' '), decls });
        }
        i = j; start = j; continue;
      }
      i++;
    }
  };
  walk(0, clean.length);
  return rules;
}

/* the office: the real office's own file and the rules that name the stage and its furniture (the owner's look is at the chrome first, FR-054) */
const isOffice = (r) => /(^|\/)realoffice[\w-]*\.css$/.test(r.file) || /(^|[\s,>+~(])(#stage|\.desk|\.room|\.seat|\.cabin|\.floor)\b/.test(r.selector);
const isRoot = (r) => /^(:root|html(\[[^\]]*\])?)(\s*,|$)/.test(r.selector);

const zero = () => Object.fromEntries(KINDS.map((k) => [k, 0]));
function countRules(rules) {
  const out = { chrome: zero(), office: zero() };
  for (const r of rules) {
    if (isRoot(r)) continue;
    const c = out[isOffice(r) ? 'office' : 'chrome'];
    for (const [p, raw] of r.decls) {
      if (p.startsWith('--')) continue;
      const v = stripVarFallback(raw.replace(/\s*!important/, ''));
      const px = (v.match(PX) || []).length;
      if (p === 'font-size') c['font-size'] += px;
      else if (p === 'font-weight') { if (/^\d+$/.test(v) || /bold|normal/.test(v)) c['font-weight']++; }
      else if (p === 'line-height') { if (/^[\d.]+(px)?$/.test(v)) c['line-height']++; }
      else if (/^(padding|margin)(-(top|right|bottom|left|inline|block))?$|^(gap|row-gap|column-gap)$/.test(p)) c.spacing += px;
      else if (/^border(-(top|bottom)-(left|right))?-radius$/.test(p)) { c.radius += (v.match(PX) || []).filter((x) => parseFloat(x) < 999).length; /* pill (999px) and 50% are the scale's own */ }
      else if (p === 'box-shadow') { if (v !== 'none' && !/^var\(\)$/.test(v) && !/^var\(--[\w-]+\)$/.test(v)) c.shadow++; }
    }
  }
  return out;
}

/* the class set of every `<button>` in the renderer's markup and JS: one entry per distinct set, `${...}` holes dropped */
function buttonSets(files) {
  const sets = new Set();
  for (const [, src] of files) for (const m of src.matchAll(/<button\b([^>]*?)>/g)) {
    const c = (m[1].match(/class="([^"]*)"/) || [, ''])[1].replace(/\$\{[^}]*\}/g, ' ').replace(/\s+/g, ' ').trim();
    sets.add(c.split(' ').filter(Boolean).sort().join(' ') || '(no class)');
  }
  return [...sets].sort();
}

function walkDir(dir, re) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? (e.name === 'vendor' || e.name === 'crew' ? [] : walkDir(path.join(dir, e.name), re)) : re.test(e.name) ? [path.join(dir, e.name)] : []);
}

/** The inventory of a renderer folder: `{ chrome, office, buttonSets }`. */
function inventory(rendererDir, repo = path.dirname(path.dirname(rendererDir))) {
  const rel = (f) => path.relative(repo, f).split(path.sep).join('/');
  const css = walkDir(rendererDir, /\.css$/).map((f) => parseCss(fs.readFileSync(f, 'utf8'), rel(f)));
  const src = walkDir(rendererDir, /\.(js|html)$/).filter((f) => !/[\\/](sim\.ts|demo\.js|simcrew\.js|simclock\.js)$/.test(f)).map((f) => [rel(f), fs.readFileSync(f, 'utf8')]);
  return { ...countRules(css.flat()), buttonSets: buttonSets(src) };
}

/** Problems of `now` against `base`, in words; empty = equal. Both ways, as FR-040: over fails, under fails until lowered. */
function compare(now, base) {
  const bad = [];
  for (const area of ['chrome', 'office']) for (const k of KINDS) {
    const a = now[area][k], b = (base[area] || {})[k];
    if (b === undefined) bad.push(`${area} ${k}: ${a}, not in the baseline`);
    else if (a > b) bad.push(`${area} ${k}: ${a} is over the baseline ${b}; use a token, the scale or a style that exists`);
    else if (a < b) bad.push(`${area} ${k}: ${a} is under the baseline ${b}; lower the baseline in this change (node scripts/inventory.js --update)`);
  }
  const have = new Set(base.buttonSets || []), cur = new Set(now.buttonSets);
  for (const s of now.buttonSets) if (!have.has(s)) bad.push(`new button class set "${s}"; use an existing one (a new one needs the baseline and a reason)`);
  for (const s of have) if (!cur.has(s)) bad.push(`button class set "${s}" is gone; lower the baseline in this change (node scripts/inventory.js --update)`);
  return bad;
}

module.exports = { inventory, compare, parseCss, KINDS, BASELINE };

if (require.main === module) {
  const now = inventory(path.join(ROOT, 'src', 'renderer'), ROOT);
  const show = () => { for (const a of ['chrome', 'office']) console.log(a.padEnd(7), KINDS.map((k) => `${k} ${now[a][k]}`).join(', ')); console.log('button class sets', now.buttonSets.length); };
  if (process.argv.includes('--update')) { fs.writeFileSync(BASELINE, JSON.stringify(now, null, 1) + '\n'); show(); console.log('baseline written'); }
  else if (process.argv.includes('--check')) {
    const bad = compare(now, JSON.parse(fs.readFileSync(BASELINE, 'utf8')));
    if (bad.length) { console.error('size ratchet (spec 070 FR-054):\n  ' + bad.join('\n  ')); process.exit(1); }
    show(); console.log('size ratchet: equal to the baseline');
  } else show();
}
