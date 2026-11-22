/*
 * Preloaded (`node --require scripts/cpu-report.js <suite file>`) by scripts/run-tests.js (spec 117 FR-017): at exit, appends this process's
 * CPU time (user + system, microseconds, from process.cpuUsage()) as one line to the file in DURBAR_CPU_FILE. Reports a number only: no
 * environment, argument or output is read or written, and nothing is printed to stdout or stderr (scripts/test-run-tests.ts asserts it).
 * Never throws: a suite must not fail because the report did.
 * What is counted: the node process this preload is loaded into, and nothing it starts. The variable is read once and removed from this
 * process's environment, so a child (a fork(), which also inherits `--require`, or any spawn) finds no file and reports nothing; an Electron
 * or other child is not counted either. A `node` step the suite runs itself without the variable is not counted. CPU is therefore the suite's
 * own steps' main processes only, a lower bound of the real cost.
 */
'use strict';
const file = process.env.DURBAR_CPU_FILE;
delete process.env.DURBAR_CPU_FILE;
process.on('exit', () => {
  try {
    if (!file) return;
    const u = process.cpuUsage();
    require('fs').appendFileSync(file, `${u.user + u.system}\n`);
  } catch (_) { /* the report is optional */ }
});
