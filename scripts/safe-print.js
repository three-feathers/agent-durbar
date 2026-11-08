'use strict';
/*
 * Spec 021 FR-085 (review of PR #1316): text that comes from a PR (file and directory names, allow-list lines, git's own messages)
 * is printed through here by scripts/spec-numbers.js and scripts/picture-budget.js. In GitHub Actions a stdout line that starts with
 * `::` is a workflow command (`::error::`, `::set-output`, `::add-mask::`, `::stop-commands::`), and the runner trims leading spaces
 * first. A git path may hold a newline, so `x\n::error::...` would start such a line. `printable` turns every control and
 * line-separator character into a visible escape and breaks every `::`; `emit` prints line by line through it, so nothing from a PR
 * can start a command or a second line. Pure, no dependencies.
 */
// C0 and C1 controls, DEL, line and paragraph separators, zero-width and bidi marks, BOM (code points, so the file holds no raw ones)
const CONTROL = new RegExp('[\\u0000-\\u001f\\u007f-\\u009f\\u2028\\u2029\\u200b-\\u200f\\u202a-\\u202e\\u2066-\\u2069\\ufeff]', 'g');
const NAMED = { '\n': '\\n', '\r': '\\r', '\t': '\\t' };

/** One line of text, safe to print: controls escaped (`\n`, `\u001b`), `::` written as `: :`. */
function printable(text) {
  return String(text)
    .replace(CONTROL, (c) => NAMED[c] || `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`)
    .replace(/:(?=:)/g, ': ');
}

/** Print text line by line; each line is made printable again, so even an unescaped fragment cannot start a workflow command. */
function emit(text, write = console.log) {
  for (const line of String(text).split(/\r?\n/)) write(printable(line));
}

module.exports = { printable, emit };
