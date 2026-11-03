#!/usr/bin/env node
/*
 * Spec 025 FR-021 (`npm run test:featureinventory`, part of `npm test`): checks docs/feature-inventory.md.
 *  - every row has six cells, a Flat and a Real office state word (works | in PR | planned | missing), a Worlds cell
 *    (none, or mock/planned/built joined by +, optional `(moment-id)` that must exist in docs/experience/world-moments.json),
 *    spec numbers that have a specs/NNN-* folder, and a Proof with at least one tag that resolves
 *    (test:NAME = package.json script test:NAME, driver:NAME = scripts/NAME.js, read:PATH = an existing file);
 *  - `in PR` names a branch in the row; `built` in Worlds needs a registry moment with code: present;
 *  - every spec with `status: built` is in a row or on the `Exempt:` line;
 *  - a registry world with shippable: true needs the Helpers row to say `built` for worlds (helpers per world are a row).
 * Plain Node, paths with path.join. Usage: node scripts/feature-inventory.js [--root D]
 */
'use strict';
const fs = require('fs');
const path = require('path');

const STATES = ['works', 'in PR', 'planned', 'missing'];
const state = (c) => STATES.find((s) => c === s || c.startsWith(s + ' ') || c.startsWith(s + ','));

function check(root) {
  const p = [];
  const j = (...a) => path.join(root, ...a);
  const read = (f) => fs.readFileSync(j(...f.split('/')), 'utf8');
  const exists = (f) => fs.existsSync(j(...f.split('/')));
  let md, pkg, reg;
  try { md = read('docs/feature-inventory.md'); pkg = JSON.parse(read('package.json')); reg = JSON.parse(read('docs/experience/world-moments.json')); } catch (e) { return [`cannot read inputs: ${e.message}`]; }
  const specs = fs.readdirSync(j('specs')).filter((d) => /^\d{3}-/.test(d));
  const num = new Set(specs.map((d) => d.slice(0, 3)));
  const moments = new Map(reg.moments.map((m) => [m.id, m]));
  const seen = new Set();
  const rows = md.split('\n').filter((l) => l.startsWith('| ') && !l.startsWith('| Feature') && !l.startsWith('|---'));
  if (!rows.length) p.push('no feature rows');
  let helpersBuilt = false;
  let helpersRow = false;
  for (const l of rows) {
    const c = l.split('|').slice(1, -1).map((x) => x.trim());
    const name = c[0] || '?';
    const bad = (m) => p.push(`row "${name}": ${m}`);
    if (c.length !== 6) { bad(`${c.length} cells, want 6`); continue; }
    for (const i of [1, 2]) {
      const s = state(c[i]);
      if (!s) bad(`cell "${c[i]}" must start with one of ${STATES.join(', ')}`);
      else if (s === 'in PR' && !/^in PR [\w.-]+/.test(c[i])) bad('"in PR" must name the branch');
    }
    const w = /^(none|(mock|planned|built)(\+(mock|planned|built))*)(?: \(([\w-]+)\))?$/.exec(c[3]);
    if (!w) bad(`Worlds "${c[3]}" is not none or mock/planned/built joined by +`);
    else {
      if (w[5] && !moments.has(w[5])) bad(`registry has no moment "${w[5]}"`);
      if (/built/.test(w[1])) {
        if (!w[5] || moments.get(w[5])?.code !== 'present') bad('Worlds "built" needs a registry moment with code: present');
        if (/^Helpers/.test(name)) helpersBuilt = true;
      }
    }
    const ns = c[4].split(/\s+/).filter(Boolean);
    if (!ns.length) bad('no spec');
    for (const n of ns) { if (!num.has(n)) bad(`spec ${n} has no folder in specs/`); seen.add(n); }
    const tags = c[5].match(/\b(test|driver|read):[^\s]+/g) || [];
    if (!tags.length) bad('Proof has no test:, driver: or read: tag');
    for (const t of tags) {
      const [k, v] = [t.slice(0, t.indexOf(':')), t.slice(t.indexOf(':') + 1).replace(/:\d+$/, '')];
      if (k === 'test' && !pkg.scripts['test:' + v]) bad(`no npm script test:${v}`);
      if (k === 'driver' && !exists(`scripts/${v}.js`)) bad(`no scripts/${v}.js`);
      if (k === 'read' && !exists(v)) bad(`no file ${v}`);
    }
    if (/^Helpers/.test(name)) helpersRow = true;
  }
  const ex = /^Exempt: ([\d ]+)/m.exec(md);
  const exempt = new Set(ex ? ex[1].trim().split(/\s+/) : []);
  if (!ex) p.push('no "Exempt:" line');
  for (const n of exempt) if (!num.has(n)) p.push(`exempt spec ${n} has no folder`);
  for (const d of specs) {
    const st = /^status:\s*(\S+)/m.exec(read(`specs/${d}/spec.md`));
    if (st && st[1] === 'built' && !seen.has(d.slice(0, 3)) && !exempt.has(d.slice(0, 3))) p.push(`spec ${d} is built but in no row and not exempt`);
  }
  const live = Object.entries(reg.worlds).filter(([, w]) => w.shippable === true).map(([k]) => k);
  if (live.length && !(helpersRow && helpersBuilt)) p.push(`world(s) ${live.join(', ')} shippable: true, but the Helpers row is not "built" for worlds`);
  return p;
}

module.exports = { check };
if (require.main === module) {
  const i = process.argv.indexOf('--root');
  const root = i > 0 ? process.argv[i + 1] : path.join(__dirname, '..');
  const p = check(root);
  for (const m of p) console.error('feature-inventory: ' + m);
  console.log(p.length ? `feature-inventory: ${p.length} problem(s)` : 'feature-inventory: ok');
  process.exit(p.length ? 1 : 0);
}
