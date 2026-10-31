/*
 * Spec 097 FR-185, FR-186 (T142, T148; flat rows only so far): operation counts of the flat office, never times. Simulator only (DURBAR_SIM=15 DURBAR_SIM_FREEZE=1),
 * no AI credits. At 15 and 40 agents the driver replaces the text of one desk's name (a child-list change, which is what a render does and what `:has()` watches),
 * reads a layout property so that the style is recalculated inside the trace, and counts:
 *   - elements recalculated: the `elementCount` of every UpdateLayoutTree on the renderer's main thread in a short contentTracing of that change, summed. A count, not a
 *     time. Animations are switched off for the trace so that only the change counts. A trace without one such event fails the row (a renamed thread or category would
 *     otherwise read as 0 and pass).
 * It is not a status change: FR-186's status event (renders, layout reads) is a row still to build. What one status change still costs is not asserted here.
 *
 *   npm run check:ui -- --only check-office-ops      (builds first)
 *   OPS_INDEX=<index.html>   load another build of the page (a mutation or a before/after run)
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { contentTracing } = require('electron');
const { helpers, jsLiteral } = require('./driver-helpers');

/* Limits are counts. FR-185 / T148: one text change recalculates at most this many elements (measured after the fix: see the spec). */
const LIMITS = { elementsRecalculated: 50 };
const KNOWN_FAILURES = {}; // 'row@n': 'T-number of the task that fixes it'

const FLAT = `document.querySelectorAll('#stage .desk[data-id]').length>=1&&!document.querySelector('#stage .ro')`;

async function trace(fn) {
  await contentTracing.startRecording({ included_categories: ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'blink', 'toplevel'], excluded_categories: ['*'] });
  await fn();
  const file = path.join(os.tmpdir(), `durbar-ops-${process.pid}-${Date.now()}.json`);
  await contentTracing.stopRecording(file);
  try {
    const d = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(d) ? d : d.traceEvents;
  } finally { fs.rmSync(file, { force: true }); }
}

/** Sum of `elementCount` of the renderer main thread's UpdateLayoutTree events. */
function elementsRecalculated(events) {
  const names = new Map(events.filter((e) => e.ph === 'M' && e.name === 'thread_name').map((e) => [`${e.pid}:${e.tid}`, e.args.name]));
  return events.filter((e) => e.name === 'UpdateLayoutTree' && names.get(`${e.pid}:${e.tid}`) === 'CrRendererMain')
    .reduce((s, e) => s + ((e.args && e.args.elementCount) || 0), 0);
}

module.exports = async (ctx) => {
  const H = helpers(ctx);
  const { js } = H;
  const rows = {};
  for (const n of [15, 40]) {
    await H.load({ w: 1440, h: 900, index: process.env.OPS_INDEX || undefined, query: { sim: String(n) }, ready: FLAT, readyMs: 30000 });
    await js(`(()=>{const s=document.createElement('style');s.textContent='*,*::before,*::after{animation:none!important;transition:none!important}';document.head.append(s);})()`);
    /* one text change in one desk (a name's text node replaced: a child-list change, which is what a render does and what `:has()` watches), then a layout read so that the style is recalculated inside the trace */
    const change = (i) => js(`(()=>{document.querySelector('#stage .desk[data-id] .name').textContent=${jsLiteral('Op ')}+${i};return document.body.offsetHeight;})()`);
    await change(0);
    await H.settle();
    const counts = [];
    for (let i = 1; i <= 4; i++) counts.push(elementsRecalculated(await trace(() => change(i))));
    assert.ok(counts.every((c) => c > 0), `${n} agents: a replaced text node must recalculate some element; a trace with none means the trace's thread or event name changed (${counts})`);
    rows[`elementsRecalculated@${n}`] = Math.max(...counts);
    console.log(`[ops] ${n} agents: elements recalculated by one text change`, counts.join(' '));
  }
  const failed = [];
  for (const [key, value] of Object.entries(rows)) {
    const [row, n] = key.split('@');
    const known = KNOWN_FAILURES[key];
    if (value > LIMITS[row]) {
      if (known) console.log(`[ops] ${key} = ${value} over ${LIMITS[row]} (known failure, fix ${known})`);
      else failed.push(`${key} = ${value}, limit ${LIMITS[row]}`);
    } else if (known) failed.push(`${key} = ${value} is within its limit: delete its KNOWN_FAILURES entry (${known})`);
  }
  assert.deepStrictEqual(failed, [], `op rows over their limits:\n  ${failed.join('\n  ')}`);
  console.log('[ops] checks passed');
  process.exitCode = 0;
};
