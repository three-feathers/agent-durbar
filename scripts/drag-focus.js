'use strict';
/**
 * Diagnostic for check-097-drag (issue 1550, spec 097 FR-352): names an OS focus loss in the failure of the status-change assert. A window blur ends a drag by
 * design, and the pointer log records no blur. This never changes a verdict: it only decides what the thrown error says, and a non-assertion error is returned as is.
 */
const assert = require('assert');

/** the page-side recorder: window blur/focus with times (ms since the install); read back with `window.__dragFocusLog` */
const RECORDER = `(()=>{const t0=performance.now(),L=window.__dragFocusLog=[];for(const n of ['blur','focus'])window.addEventListener(n,()=>L.push({n,t:Math.round(performance.now()-t0)}));return 1})()`;

/** the error to throw for a failed assert `e`; `f` is { focusBefore, focusAfter, events: [{n, t}] } */
function labelFocus(e, f) {
  if (!(e instanceof assert.AssertionError)) return e;
  const blurAt = (f.events || []).find((x) => x.n === 'blur');
  const lost = !!blurAt || (f.focusBefore === true && f.focusAfter === false);
  let head = '';
  if (lost) head = `the window lost the OS focus during the status-change hold (blur at ${blurAt ? blurAt.t + ' ms' : 'not observed, hasFocus true before and false after'}): an environment problem on a shared desktop, not a repaint that ended the drag (FR-352, issue 1550)`;
  else if (f.focusBefore === false) head = 'the window had no OS focus before the status-change hold (hasFocus false before the hold, no blur during it): an environment problem on a shared desktop';
  if (!head) return e;
  return new assert.AssertionError({ message: `${head}\n${e.message}`, actual: e.actual, expected: e.expected, operator: e.operator });
}

/** one short line for the log */
function focusLine(tag, f) {
  return `[focus-log] ${tag} hold: hasFocus before=${f.focusBefore} after=${f.focusAfter}; window: ${(f.events || []).map((x) => `${x.n}@${x.t}ms`).join(', ') || 'no blur/focus'}`;
}

module.exports = { RECORDER, labelFocus, focusLine };
