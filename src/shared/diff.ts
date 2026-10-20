/**
 * A simple unified diff for a permission card (spec 052 FR-063): "Show the change" on an edit request. Pure, no imports.
 * Not a full diff algorithm: common lines at the start and the end are kept as context (at most `CONTEXT` of each), and the
 * lines in between are shown as removed and then added. Enough for a reviewer to see what an edit or a new file would do.
 */

/** Lines of context kept before and after the changed block. */
export const CONTEXT = 3;
/** Longest diff text sent with a permission request (characters); longer text is cut at a line and says so. */
export const DIFF_MAX = 20000;

const lines = (s: string): string[] => (s === '' ? [] : s.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n'));

/** The header and body of a unified diff that turns `oldText` into `newText` for `file`; '' when nothing changes. */
export function simpleDiff(file: string, oldText: string, newText: string, max = DIFF_MAX): string {
  if (typeof oldText !== 'string' || typeof newText !== 'string' || oldText === newText) return '';
  const a = lines(oldText);
  const b = lines(newText);
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;
  const ctxBefore = a.slice(Math.max(0, pre - CONTEXT), pre);
  const ctxAfter = a.slice(a.length - suf, a.length - suf + Math.min(suf, CONTEXT));
  const removed = a.slice(pre, a.length - suf);
  const added = b.slice(pre, b.length - suf);
  const start = pre - ctxBefore.length;
  const name = String(file || 'file').replace(/[\r\n]+/g, ' ');
  const out = [
    `--- a/${name}`,
    `+++ b/${name}`,
    `@@ -${a.length ? start + 1 : 0},${ctxBefore.length + removed.length + ctxAfter.length} +${b.length ? start + 1 : 0},${ctxBefore.length + added.length + ctxAfter.length} @@`,
    ...ctxBefore.map((l) => ' ' + l),
    ...removed.map((l) => '-' + l),
    ...added.map((l) => '+' + l),
    ...ctxAfter.map((l) => ' ' + l),
  ].join('\n');
  return clipDiff(out, max);
}

/** Cut a diff at a line boundary so it fits in `max` characters, with a last line that says how many lines were left out. */
export function clipDiff(text: string, max = DIFF_MAX): string {
  if (text.length <= max) return text;
  const cut = text.lastIndexOf('\n', max);
  const kept = text.slice(0, cut > 0 ? cut : max);
  const left = text.slice(kept.length).split('\n').filter(Boolean).length;
  return kept + `\n… ${left} more line${left === 1 ? '' : 's'} not shown`;
}
