#!/usr/bin/env node
/*
 * Writes the synthetic world pack and the hostile set (spec 102 T016) as zip files into ONE folder you name: the folder must exist and be empty.
 * Nothing is written anywhere else. Needs `npm run build:scripts` (or any `npm run test:world-packs`) first, for dist-scripts.
 *   node scripts/make-world-fixtures.js <empty-folder>
 */
const fs = require('fs');
const path = require('path');

const dir = process.argv[2];
if (!dir) { console.error('usage: node scripts/make-world-fixtures.js <empty-folder>'); process.exit(2); }
const out = path.resolve(dir);
if (!fs.existsSync(out) || !fs.statSync(out).isDirectory() || fs.readdirSync(out).length) { console.error('the folder must exist and be empty'); process.exit(2); }
const gen = require(path.join(__dirname, '..', 'dist-scripts', 'scripts', 'fixtures', 'worlds', 'gen.js'));
fs.writeFileSync(path.join(out, 'good.zip'), gen.toStored(gen.goodPack()), { flag: 'wx' });
for (const h of gen.hostileSet()) fs.writeFileSync(path.join(out, 'bad-' + h.id + '.zip'), h.zip, { flag: 'wx' });
console.log('wrote ' + (fs.readdirSync(out).length) + ' files to the folder');
