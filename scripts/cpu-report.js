/*
 * Preloaded (`node --require scripts/cpu-report.js <suite file>`) by scripts/run-tests.js (spec 117 FR-017): at exit, appends this process's
 * CPU time (user + system, microseconds, from process.cpuUsage()) as one line to the file in DURBAR_CPU_FILE. Reports a number only: no
 * environment, argument or output is read or written. Never throws: a suite must not fail because the report did.
 */
'use strict';
process.on('exit', () => {
  try {
    const file = process.env.DURBAR_CPU_FILE;
    if (!file) return;
    const u = process.cpuUsage();
    require('fs').appendFileSync(file, `${u.user + u.system}\n`);
  } catch (_) { /* the report is optional */ }
});
