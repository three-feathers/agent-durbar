#!/usr/bin/env node
/*
 * Spec 021 FR-086 item 5 (T068): the `test:*` scripts of package.json sit in ONE block in code-unit order (plain `<` on the
 * strings, never localeCompare, so every OS sorts the same), so two PRs that add a suite collide only when their names sort
 * next to each other. npm does not care about key order.
 *
 *   node scripts/fragments.js --check   exit 1 when the `test:*` keys are not contiguous and sorted (part of `npm test`)
 *   node scripts/fragments.js --fix     rewrites package.json: the block sorted, placed where the first `test:*` key is,
 *                                       the other scripts keeping their order (`npm run fragments:fix`)
 *
 * Later migrations of spec 021 FR-086 (T069 and on) extend this file with the other hot-file checks.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const PACKAGE = path.join(__dirname, '..', 'package.json');
const FIX = 'npm run fragments:fix';
const isTest = (k) => k.startsWith('test:');
const byCodeUnit = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// null when the order is right, else a message naming the first offending key and the fix command
function checkOrder(scripts) {
  const keys = Object.keys(scripts);
  const tests = keys.filter(isTest);
  const first = keys.findIndex(isTest);
  for (let i = 0; i < tests.length; i++) {
    if (keys[first + i] !== tests[i]) {
      return `package.json: the test:* scripts are not in one block; "${tests[i]}" is outside it (spec 021 FR-086). Fix: ${FIX}`;
    }
  }
  for (let i = 1; i < tests.length; i++) {
    if (byCodeUnit(tests[i - 1], tests[i]) > 0) {
      return `package.json: "${tests[i]}" must sort before "${tests[i - 1]}" in the test:* block (code-unit order, spec 021 FR-086). Fix: ${FIX}`;
    }
  }
  return null;
}

// the scripts object with the block sorted at the first test:* key's place; keys and values untouched
function sortScripts(scripts) {
  const keys = Object.keys(scripts);
  const first = keys.findIndex(isTest);
  if (first < 0) return { ...scripts };
  const block = keys.filter(isTest).sort(byCodeUnit);
  const others = keys.filter((k) => !isTest(k));
  const before = keys.slice(0, first).filter((k) => !isTest(k));
  const order = [...before, ...block, ...others.slice(before.length)];
  return Object.fromEntries(order.map((k) => [k, scripts[k]]));
}

function main(argv) {
  const text = fs.readFileSync(PACKAGE, 'utf8').replace(/\r\n/g, '\n');
  const pkg = JSON.parse(text);
  if (argv.includes('--fix')) {
    pkg.scripts = sortScripts(pkg.scripts);
    fs.writeFileSync(PACKAGE, JSON.stringify(pkg, null, 2) + '\n');
    return 0;
  }
  if (argv.includes('--check')) {
    const msg = checkOrder(pkg.scripts);
    if (msg) { console.error(msg); return 1; }
    console.log('fragments: the test:* scripts of package.json are one sorted block');
    return 0;
  }
  console.error('usage: node scripts/fragments.js --check | --fix');
  return 2;
}

module.exports = { checkOrder, sortScripts };
if (require.main === module) process.exitCode = main(process.argv.slice(2));
