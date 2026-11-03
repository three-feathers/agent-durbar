/*
 * Spec 097 FR-185, FR-186 (T142, T148; flat rows only so far): operation counts of the flat office, never times. Simulator only (DURBAR_SIM=15 DURBAR_SIM_FREEZE=1),
 * no AI credits. At 15 and 40 agents the driver replaces the text of one desk's name (a child-list change, which is what a render does and what `:has()` watches),
 * reads a layout property so that the style is recalculated inside the trace, and counts:
 *   - elements recalculated: the `elementCount` of every UpdateLayoutTree on the renderer's main thread in a short contentTracing of that change, summed. A count, not a
 *     time. Animations are switched off for the trace so that only the change counts. A calibration (a new element in a desk) must show at least one event, so a renamed thread or category cannot
 *     read as 0 and pass; the text change itself may recalculate 0.
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
    /* one text change in `text` (a text node replaced: a child-list change, which is what a render does and what `:has()` watches), then a layout read so that the style is recalculated inside the trace */
    const measure = async (host, text, key, label) => {
      const change = (i) => js(`(()=>{document.querySelector(${jsLiteral(text)}).textContent=${jsLiteral('Op ')}+${i};return document.body.offsetHeight;})()`);
      await change(0);
      await H.settle();
      /* calibration (pre-review of #949): a new element always has its style computed, so a trace with no UpdateLayoutTree event at all means the thread or event name changed. A text change itself may recalculate 0 elements when no stylesheet rule watches it (the AI maker's \`body:has()\` rule used to), and that is a pass */
      const probe = elementsRecalculated(await trace(() => js(`(()=>{const d=document.querySelector(${jsLiteral(host)});const s=document.createElement('i');s.className='ops-probe';d.appendChild(s);const h=document.body.offsetHeight;s.remove();return h;})()`)));
      assert.ok(probe > 0, `${label}: a new element must recalculate some element; a trace with none means the trace's thread or event name changed (${probe})`);
      const counts = [];
      for (let i = 1; i <= 4; i++) counts.push(elementsRecalculated(await trace(() => change(i))));
      rows[key] = Math.min(...counts); // the least of 4: a render that lands inside one trace by itself (a timer) only adds, and the `:has()` cost shows in all 4
      console.log(`[ops] ${label}: elements recalculated by one text change`, counts.join(' '));
    };
    await measure('#stage .desk[data-id]', '#stage .desk[data-id] .name', `elementsRecalculated@${n}`, `${n} agents`);
    /* spec 102 T212: a world's arrangement has the same row and no allowance of its own: the arcade, one text change on a marquee. */
    await H.load({ w: 1440, h: 900, index: process.env.OPS_INDEX || undefined, query: { sim: String(n), officeview: 'real', worldflags: 'retro', world: 'retro' }, ready: `!!document.querySelector('#stage .ro .ro-marquee')`, readyMs: 30000 });
    await js(`(()=>{const s=document.createElement('style');s.textContent='*,*::before,*::after{animation:none!important;transition:none!important}';document.head.appendChild(s);})();0`);
    await measure('#stage .ro-marquee', '#stage .ro-marquee', `elementsRecalculated@retro${n}`, `${n} agents, arcade`);
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
