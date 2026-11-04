/*
 * Spec 104 FR-060..FR-068, FR-079 (T005): `npm run blog:check`, the guard on every public text the agent blog and the story and
 * explainer pages publish. Plain Node, no dependency, 0 AI credits. It fails closed: anything it cannot read or confirm fails.
 *
 *   node scripts/check-posts.js                 check docs/site/{blog,captions,story,explainers}
 *   node scripts/check-posts.js --offline       skip the online author check (says so; refused under CI when there is a link to check)
 *   node scripts/check-posts.js --add-blocked-host
 *                                               a HUMAN step: reads one host name from stdin (not echoed on a terminal), prints
 *                                               nothing, and adds its hash to docs/site/blocked-hashes.json. Never pass the name
 *                                               as an argument, in a file, a log, a PR or to an agent (FR-062).
 *
 * Output names the file, the line and the rule, never the matched text (a token, an address or a blocked name must not reach a
 * CI log). What no script can catch (a client nobody listed, paraphrased chat, personal detail in plain words, text inside video
 * frames) is the reviewers' job: the spec's Review list, a human read per FR-079 and an agent review per the owner's delta.
 *
 * Reuses (spec 021 FR-031): src/shared/redact.ts for tokens and secrets only, through release-notes.js's fail-closed loader
 * (Node 22.18+ type stripping); scripts/trusted-authors.txt, the list scripts/trusted-lib.sh reads (parsed the same way, with its
 * `who` rule for bots), because this check runs on every OS and so does not call bash; build-site.js's unreleased-phrase matcher
 * and media manifest check.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const REPO = 'three-feathers/agent-durbar';
const POSTS = 'docs/site/blog';
const TEXT_DIRS = ['docs/site/captions', 'docs/site/story', 'docs/site/explainers'];
const TEXT_EXT = /\.(md|vtt|txt|html)$/i;
const BLOCKED_FILE = 'docs/site/blocked-hashes.json';
const HASH_PREFIX = 'agent-durbar-blocked-v1:';
const OWNERS = ['vikramgorla', 'fjcabello', 'rubenlupi'];
// FR-067: a first name fails for all three owners; these are the names AGENTS.md already publishes (no new name is added here)
const FIRST_NAMES = ['vikram', 'paco', 'ruben', 'gorla'];
const POST_WORDS_MAX = 400;
const HUMAN_READ_FIRST = 5; // FR-079: the first 5 posts need a human owner's read
const FILE_MAX = 256 * 1024;

/* The rules, by id. Each has a fixture that fails it and a mutant that removes it (scripts/test-check-posts.js). */
const RULES = {
  secret: 'a token or secret (src/shared/redact.ts), also base64- or hex-encoded or cut across two lines',
  'redact-unavailable': 'redact.ts could not be loaded, so nothing is published (fail closed)',
  path: 'a home folder, drive, UNC or other private path',
  email: 'an email address',
  phone: 'a phone number',
  'bot-handle': 'a full bot handle (shorten it, as the talk does)',
  chat: 'a chat marker (chat link, chat id or quoted chat)',
  unreleased: 'a phrase from docs/site/unreleased.json (FR-008)',
  host: 'a URL, host, local name or host:port that is not on the allowlist (GitHub, the site, example.invalid)',
  scheme: 'a link that is not https (javascript:, data:, file:, http:, ...) and not relative',
  blocked: 'a blocked name (docs/site/blocked-hashes.json)',
  'first-name': "an owner's first name (handles only, FR-067)",
  'file-name': 'a post file name that is not YYYY-MM-DD-slug.md',
  'file-read': 'a file that cannot be read as UTF-8 text within 256 KB, or a symbolic link',
  front: 'a missing or malformed JSON front block',
  'front-key': 'an unknown front-block key',
  date: "the front block's date differs from the file name",
  label: 'a label field is missing: title, writtenBy, whose, writtenOn (FR-052)',
  evidence: 'no evidence, or evidence that does not exist on main (FR-053, FR-065)',
  'not-verified': 'notVerified is empty (FR-053)',
  words: `more than ${POST_WORDS_MAX} words (FR-050)`,
  figure: 'a paragraph with a figure and no link (FR-065)',
  'one-per-day': 'more than one post on a date (FR-065)',
  'human-read': 'a post that needs a human owner\'s read (first 5, or naming someone) has no humanRead (FR-067, FR-079)',
  'agent-review': 'agentReview is missing, or from the writer\'s own side (FR-079 delta 2026-11-03)',
  security: 'security words without a security field, or a security fix not yet in a published release (FR-064)',
  clip: 'the clip is not a clip in docs/site/media.json with captions (FR-054, FR-065)',
  'outside-link': 'a linked issue, PR or comment whose author or latest editor is not trusted, or one outside this repository (FR-063)',
  'online-check': 'the online author check could not run where it must (CI) (FR-063)',
  'hidden-char': 'an invisible or direction-changing character, an unknown HTML entity, or a word mixing Latin with Cyrillic or Greek letters',
  'long-line': 'a line longer than 4096 characters',
};
const PATH_RULES = new Set(['secret', 'path', 'email', 'phone', 'bot-handle', 'chat', 'unreleased', 'blocked', 'first-name', 'hidden-char']);
const FRONT_KEYS = ['date', 'title', 'writtenBy', 'whose', 'writtenOn', 'evidence', 'notVerified', 'humanRead', 'agentReview', 'clip', 'security', 'securityNote'];

/* ---------- loading ---------- */
function loadRedact() {
  const r = require('./release-notes.js').loadRedact(); // throws when redact.ts cannot load: the caller fails closed
  if (typeof r.redact !== 'function') throw new Error('no redact export');
  return r.redact;
}
function trustedAuthors(root = ROOT) {
  // as scripts/trusted-lib.sh: comment lines out, CR dropped, plain logins only (letters, digits, dashes, an optional [bot])
  return new Set(fs.readFileSync(path.join(root, 'scripts/trusted-authors.txt'), 'utf8').split('\n').map((l) => l.replace(/\r$/, ''))
    .filter((l) => !/^[ \t]*#/.test(l) && /^[A-Za-z0-9-]+(\[bot\])?$/.test(l)));
}
function loadBlocked(root = ROOT) {
  const f = path.join(root, BLOCKED_FILE);
  const j = JSON.parse(fs.readFileSync(f, 'utf8'));
  if (!j || !Array.isArray(j.sha256) || !j.sha256.every((h) => typeof h === 'string' && /^[0-9a-f]{64}$/.test(h))) throw new Error(`${BLOCKED_FILE}: "sha256" must be a list of 64-digit lower-case hex hashes`);
  return new Set(j.sha256);
}
const hashName = (name) => crypto.createHash('sha256').update(HASH_PREFIX + String(name).toLowerCase()).digest('hex');

/* ---------- text: one normalised reading per way a reader could see it ---------- */
const site = require('./build-site.js');
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const IGNORABLE = /\p{Default_Ignorable_Code_Point}/gu;
const BIDI = /[؜‎‏‪-‮⁦-⁩]/;
// Cyrillic and Greek letters that look Latin, read as Latin (review of T005: "Vіkram" must still be a first name)
const CONFUSABLE = {
  'а': 'a', 'е': 'e', 'і': 'i', 'о': 'o', 'р': 'p', 'с': 'c', 'у': 'y', 'х': 'x', 'к': 'k', 'м': 'm', 'т': 't', 'ѕ': 's', 'ј': 'j',
  'А': 'A', 'В': 'B', 'Е': 'E', 'К': 'K', 'М': 'M', 'Н': 'H', 'О': 'O', 'Р': 'P', 'С': 'C', 'Т': 'T', 'Х': 'X', 'І': 'I', 'Ѕ': 'S', 'Ј': 'J',
  'α': 'a', 'ι': 'i', 'ο': 'o', 'ν': 'v', 'κ': 'k', 'ρ': 'p', 'Α': 'A', 'Β': 'B', 'Ε': 'E', 'Η': 'H', 'Ι': 'I', 'Κ': 'K', 'Μ': 'M', 'Ν': 'N', 'Ο': 'O', 'Ρ': 'P', 'Τ': 'T', 'Χ': 'X', 'Ζ': 'Z',
};
const CONFUSABLE_RE = new RegExp(`[${Object.keys(CONFUSABLE).join('')}]`, 'g');
const LINE_MAX = 4096; // a post line is far shorter; a longer one fails, which also keeps every scan below linear-time worries
/* The readings of one line a reader could see: as written; entities decoded; invisible characters removed; accents off and
 * look-alike letters read as Latin; Markdown marks, escapes and tags removed; defanged dots ("x[.]com") joined; underscores removed. */
function lineReadings(line) {
  const n = line.normalize('NFKC').replace(/[。．｡]/g, '.');
  const decoded = n.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (m, e) => {
    if (e[0] === '#') { const c = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1)); return Number.isFinite(c) && c > 0 && c < 0x110000 ? String.fromCodePoint(c) : m; }
    return Object.prototype.hasOwnProperty.call(ENT, e.toLowerCase()) ? ENT[e.toLowerCase()] : m;
  });
  const clean = decoded.replace(IGNORABLE, '');
  const latin = clean.normalize('NFKD').replace(/\p{M}+/gu, '').replace(CONFUSABLE_RE, (c) => CONFUSABLE[c]);
  const unmarked = site.withoutTags(latin.replace(/\\(?=[!-/:-@[-`{-~])/g, '').replace(/[*`~]+/g, ''));
  const defang = (x) => x.replace(/\s*(?:\[\.\]|\(\.\)|\{\.\}|\[dot\]|\(dot\))\s*/gi, '.').replace(/(\S)\s+\.(?=[a-z]{2,24}\b)/g, '$1.');
  const defanged = defang(unmarked);
  // percent-encoding read as a browser or server would (twice, for double encoding), query and fragment included (review of PR #1106)
  // the defanged and percent-decoded readings come from both the text with tags taken out and the text as written (tags kept),
  // so no derived reading can only remove content (review of PR #1106, round 3)
  const out = [n, decoded, clean, latin, unmarked, unmarked.replace(/_+/g, '')];
  for (const base of [unmarked, latin, n]) {
    const d = defang(base);
    const p1 = percentDecoded(d);
    const p2 = percentDecoded(p1);
    out.push(d, p1, p2, p2.replace(IGNORABLE, ''));
  }
  return [...new Set(out)];
}
/* `%XX` runs decoded as UTF-8 where they form valid UTF-8, else byte by byte as Latin-1; never throws. */
function percentDecoded(t) {
  return String(t).replace(/(?:%[0-9a-f]{2})+/gi, (run) => {
    try { return decodeURIComponent(run); } catch { return run.replace(/%([0-9a-f]{2})/gi, (m, h) => String.fromCharCode(parseInt(h, 16))); }
  });
}
/* Base64 and hex runs long enough to hold a token, decoded, for the secret rule only (review of PR #1106). A decoded run that is
 * not mostly printable text is dropped: a commit hash or a picture's data is not a token. */
function encodedSecrets(t) {
  const out = [];
  const printable = (x) => x.length >= 12 && (x.match(/[\x20-\x7e]/g) || []).length / x.length > 0.9;
  for (const m of String(t).matchAll(/[A-Za-z0-9+/_-]{24,}={0,2}/g)) {
    const b = m[0].replace(/-/g, '+').replace(/_/g, '/');
    const x = Buffer.from(b, 'base64').toString('latin1');
    if (printable(x)) out.push(x);
  }
  for (const m of String(t).matchAll(/(?<![0-9a-f])(?:[0-9a-f]{2}){20,}(?![0-9a-f])/gi)) {
    const x = Buffer.from(m[0], 'hex').toString('latin1');
    if (printable(x)) out.push(x);
  }
  return out;
}

/* Hosts the site may name. On GitHub, only this project's own pages (and Spec Kit, which it is built with): anything else on
 * GitHub is someone else's text (FR-063), so it is an outside link, not an allowed host. */
const SITE_HOST = (h) => h === 'github.com' || h === 'www.github.com' || h === 'docs.github.com' || h === 'githubusercontent.com' || h.endsWith('.githubusercontent.com')
  || h === 'three-feathers.github.io' || h === 'example.invalid' || h.endsWith('.example.invalid');
const ALLOWED_HOST = SITE_HOST;
const GH_OK_PATH = /^\/(?:three-feathers\/agent-durbar(?:\/.*)?|three-feathers\/?|orgs\/three-feathers\/projects\/\d+\/?|github\/spec-kit(?:\/.*)?)$/i;
const URL_RE = /\b([a-z][a-z0-9+.-]{1,20}):\/\/([^\s<>()"'`\]\\]+)/gi;
const WWW_RE = /(?<![\w./@-])(www\.[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:[/?#][^\s<>()"'`\]\\]*)?)/gi;
const HOSTLIKE_RE = /(?<![\p{L}\p{N}_@.-])((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,23}[a-z0-9])(?![\p{L}\p{N}_-])/giu;
const IP_RE = /(?<![\d.])\d{1,3}(?:\.\d{1,3}){3}(?![\d.])/;
const KNOWN_DOTTED = new Set(['node.js', 'vs.code']);
// a bare dotted word is a host when its last label is a country code or a common generic top-level domain; file names
// (settings.json, index.ts) and code (process.env, JSON.parse) are not. A rarer generic domain written bare is a `[KNOWN GAP]`
// (a URL with any host is always checked, and every word is hashed against the blocked list).
const NOT_TLD_2 = new Set(['ts', 'js', 'gz', 'db', '7z']);
const COMMON_GTLD = new Set(('com net org info biz app dev cloud tech site online xyz page blog shop store news live pro name mobi jobs law bank finance services '
  + 'solutions systems software digital agency studio design media group company global world email host website space zone network consulting '
  + 'ventures capital partners works one inc ltd llc gmbh corp int edu gov mil local internal intranet lan home ai io co me tv cc').split(' '));
const hostish = (h) => { const t = h.split('.').pop(); return (t.length === 2 && !NOT_TLD_2.has(t)) || COMMON_GTLD.has(t); };

function repoFileNames(root) {
  try {
    return new Set(execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 })
      .split('\0').filter(Boolean).flatMap((f) => [f.toLowerCase(), path.posix.basename(f).toLowerCase()]));
  } catch {
    return new Set();
  }
}
/* Every form a blocked name could take in a reading: each word, its parts split on "-", joined without "-", and pairs of words. */
const RUN_MAX = 8;
function nameForms(text) {
  const toks = String(text).toLowerCase().match(/[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*/gu) || [];
  const out = new Set();
  toks.forEach((t, i) => {
    out.add(t); out.add(t.replace(/-/g, ''));
    // every contiguous run of up to RUN_MAX hyphen-separated parts ("2026-11-01-x-y" holds "x-y"), in a word of any length: a word
    // of k parts gives at most 8k runs, linear in the text (round 4 capped the run length; round 5 dropped the 64-part limit, which
    // let a name after part 64 through)
    const parts = t.split('-');
    for (let a = 0; a < parts.length; a++) for (let b = a + 1; b <= Math.min(parts.length, a + RUN_MAX); b++) { const run = parts.slice(a, b); out.add(run.join('-')); out.add(run.join('')); }
    if (i + 1 < toks.length) { const u = toks[i + 1]; out.add(t + u); out.add(`${t}-${u}`); out.add(`${t} ${u}`); out.add(`${t}.${u}`); }
  });
  return out;
}

/* One URL: its host on the allowlist, https, no user info; a link to this repository's issue, PR, comment or commit is returned
 * for the online check; any other GitHub link, or one that does not match strictly, is an outside link. */
function urlProblems(href, ln, add, links) {
  let u;
  try { u = new URL(href); } catch { add(ln, 'host'); return []; }
  if (u.protocol !== 'https:') add(ln, 'scheme');
  if (u.username || u.password || u.port) add(ln, 'host');
  const h = u.hostname.toLowerCase().replace(/\.$/, '');
  if (!ALLOWED_HOST(h)) add(ln, 'host');
  let p;
  try { p = decodeURIComponent(u.pathname); } catch { add(ln, 'host'); return [h]; }
  const frag = u.hash;
  if (h === 'github.com' || h === 'www.github.com') {
    if (!GH_OK_PATH.test(p)) add(ln, 'outside-link');
    const m = /^\/three-feathers\/agent-durbar\/(pull|pulls|issues|commit|commits|discussions)\/./i.exec(p); // an item; the list pages (/pulls, /issues) name no one
    if (m) {
      const item = /^\/three-feathers\/agent-durbar\/(pull|issues)\/(\d{1,7})(?:\/(?:files|commits|checks))?\/?$/i.exec(p);
      const commit = /^\/three-feathers\/agent-durbar\/commit\/([0-9a-f]{7,40})\/?$/i.exec(p);
      const cm = /^#issuecomment-(\d{1,15})$/.exec(frag);
      if (item && (!frag || cm)) links.push({ line: ln, repo: REPO, kind: item[1].toLowerCase(), id: item[2], comment: cm ? cm[1] : null, other: false });
      else if (commit && !frag) links.push({ line: ln, repo: REPO, kind: 'commit', id: commit[1].toLowerCase(), comment: null, other: false });
      else add(ln, 'outside-link'); // a line comment, review, discussion, commit comment or a path that does not match strictly
    }
  } else if (h.endsWith('.githubusercontent.com') || h === 'githubusercontent.com') {
    if (!/^\/three-feathers\/agent-durbar\//i.test(p)) add(ln, 'outside-link');
  } else if (h === 'three-feathers.github.io') {
    if (!/^\/agent-durbar(?:\/|$)/.test(p)) add(ln, 'host');
  }
  return [h, ...(p.match(HOSTLIKE_RE) || []).map((x) => x.toLowerCase())];
}

/*
 * The rules every public text obeys (FR-061, FR-062, FR-067's first names). Returns [{line, rule}] and the PR/issue/comment/commit
 * links found (for the online check). `ctx`: { redact, blocked, phrases, files }.
 */
function textProblems(text, ctx) {
  const out = [];
  const links = [];
  const add = (line, rule) => { if (!out.some((p) => p.line === line && p.rule === rule)) out.push({ line, rule }); };
  if (!ctx.redact) add(1, 'redact-unavailable');
  // each word form is hashed once per text (many readings and paragraphs repeat the same words)
  const hashed = new Map();
  const isBlocked = (w) => { let v = hashed.get(w); if (v === undefined) { v = ctx.blocked.has(hashName(w)); hashed.set(w, v); } return v; };
  const lines = String(text).split(/\r?\n/);
  lines.forEach((raw, i) => {
    const ln = i + 1;
    if (raw.length > LINE_MAX) { add(ln, 'long-line'); return; }
    // characters a reader does not see, or sees reordered, and entities the check cannot read: refused, never interpreted
    if (BIDI.test(raw) || /\p{Default_Ignorable_Code_Point}/u.test(raw) || /&(?:#x?0*(?:173|8203|8204|8205|8288|65279|ad|200b|200c|200d|2060|feff|202[a-e]|206[6-9]);?)/i.test(raw)
      || [...raw.matchAll(/&([a-z][a-z0-9]*);/gi)].some((m) => !Object.prototype.hasOwnProperty.call(ENT, m[1].toLowerCase()))
      || (raw.match(/[\p{L}\p{M}]+/gu) || []).some((w) => /[a-z]/i.test(w) && /[Ͱ-ϿЀ-ӿ]/.test(w))) add(ln, 'hidden-char');
    for (const r of lineReadings(raw)) {
      if (ctx.redact) {
        for (const x of [r, ...encodedSecrets(r)]) {
          let masked;
          try { masked = ctx.redact(x, {}); } catch { masked = null; }
          if (masked !== x) add(ln, 'secret');
        }
      }
      // any drive path (C:\, D:/, \\?\C:\), UNC path, home or user folder: always private in a public text (review of PR #1106)
      if (/(?<![\p{L}\p{N}])[a-z]:[\\/]|\\\\[?.]\\|(?:^|[^\w.-])(?:\/opt\/|\/srv\/|\/Volumes\/|\/media\/[a-z]|\/run\/user\/)/iu.test(r)) add(ln, 'path');
      // a link target that is not https (javascript:, data:, vbscript:, file:, ...) and not a relative link (review of PR #1106)
      // a browser drops tabs, line breaks and other controls inside a URL, so "java<TAB>script:" is javascript: (round 3)
      for (const m of r.matchAll(/\]\(\s*<?([^) >]*)/g)) { const t = m[1].replace(/[\x00-\x1f\x7f]+/g, ''); if (/^[a-z][a-z0-9+.-]*:/i.test(t) && !/^https:\/\//i.test(t)) add(ln, 'scheme'); }
      if (/(?<![\w.-])(?:javascript|vbscript|data|file|blob|filesystem|view-source|about|ftp|sftp|ssh|smb|ldap|chrome|jar):(?=[^\s])/i.test(r.replace(/[\x00-\x1f\x7f]+/g, '')) || /<[a-z][a-z0-9+.-]*:(?!\/\/)[^>\s]*>/i.test(r)) add(ln, 'scheme');
      if (/(?:^|[^\w.-])(?:~[a-z0-9._-]*[\\/]|\/home\/|\/Users\/|\/root(?:\/|\b)|\/var\/folders\/|\/private\/(?:var|tmp)\/|\/tmp\/|\/mnt\/[a-z]\/|[a-z]:[\\/]+(?:users|documents and settings)[\\/])|\\\\[a-z0-9._-]+\\[a-z0-9$._-]+|[$%](?:home|userprofile|appdata|localappdata|homepath|xdg_[a-z_]+)\b|\$\{home\}|\.(?:ssh|aws|claude|copilot|codex|gnupg)\//i.test(r)) add(ln, 'path');
      if (/(?<![a-z0-9._%+-])[a-z0-9._%+-]{1,64}@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}/i.test(r) || /\bmailto:/i.test(r)) add(ln, 'email');
      // phones: URLs, code and dates out first; a bare run of digits counts only with a +, separators or a phone word nearby
      const phoneText = r.replace(URL_RE, ' ').replace(/`[^`]*`/g, ' ').replace(/\b\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?)?/g, ' D ');
      const phoneWord = /\b(?:phone|tel|telephone|call|mobile|cell|whatsapp|sms|fax|signal)\b/i.test(r);
      for (const m of phoneText.matchAll(/(?<![\w.,])\+?\(?\d[\d ().-]{6,22}\d(?![\w.,]?\d)/g)) {
        const d = m[0].replace(/\D/g, '').length;
        if (d >= 9 && d <= 15 && (m[0].includes('+') || /[ ().-]/.test(m[0]) || phoneWord)) { add(ln, 'phone'); break; }
      }
      if (/(?<![\w])@[a-z][a-z0-9_]{2,}bot\b|(?<![\w@])[a-z][a-z0-9]{2,}_bot\b/i.test(r)) add(ln, 'bot-handle');
      if (/\b(?:t\.me|telegram\.(?:me|org)|wa\.me|whatsapp\.com|discord(?:app)?\.(?:com|gg)|slack\.com\/archives|teams\.microsoft\.com)\b|\b(?:chat_id|message_id|reply_to)\b|<channel\b|(?<![\d])-100\d{6,}|^\s*(?:>\s*)?\[?\d{1,2}:\d{2}(?::\d{2})?\]?\s*[\p{L}][\p{L}\p{N} ._-]{0,40}:\s/iu.test(r)) add(ln, 'chat');
      for (const w of FIRST_NAMES) if (new RegExp(`(?<!\\p{L})${w}(?!\\p{L})`, 'iu').test(r)) add(ln, 'first-name');
      // hosts: every URL (and bare www. name) is parsed as a browser would; every bare host-like word, in prose or in a URL's path,
      // must be on the allowlist; local names and host:port fail; every host, its parents and every word form are hashed
      const hosts = [];
      for (const m of r.matchAll(URL_RE)) hosts.push(...urlProblems(`${m[1]}://${m[2]}`, ln, add, links));
      for (const m of r.replace(URL_RE, ' ').matchAll(WWW_RE)) { add(ln, 'scheme'); hosts.push(...urlProblems(`https://${m[1]}`, ln, add, links)); }
      for (const m of r.replace(URL_RE, (x, s, rest) => (/^(?:www\.)?github\.com$|githubusercontent\.com$|^three-feathers\.github\.io$/i.test(rest.split(/[/?#]/)[0]) ? ' ' : ` ${rest.replace(/^[^/?#]*/, ' ')}`)).replace(WWW_RE, ' ').replace(/\]\(\s*<?(?![a-z][a-z0-9+.-]*:)[^)\s>]*/gi, '](').matchAll(HOSTLIKE_RE)) { // a relative link target is a file, not a host
        const h = m[1].toLowerCase();
        hosts.push(h); // every dotted word is hashed against the blocked list
        if (KNOWN_DOTTED.has(h) || ctx.files.has(h) || !hostish(h)) continue;
        if (!ALLOWED_HOST(h)) add(ln, 'host');
      }
      if (/(?<![\w.-])localhost\b|(?<![\w./-])[a-z][\w-]*:\d{2,5}\b(?!:)/i.test(r.replace(URL_RE, ' '))) add(ln, 'host');
      if (IP_RE.test(r.replace(/(?<![\d.])v?\d+\.\d+\.\d+(?:-[\w.]+)?\b(?!\.\d)/g, ' '))) add(ln, 'host');
      for (const h of hosts) {
        const parts = h.split('.');
        for (let k = 0; k < parts.length; k++) if (ctx.blocked.has(hashName(parts.slice(k).join('.')))) add(ln, 'blocked');
      }
      for (const w of nameForms(r)) if (isBlocked(w)) add(ln, 'blocked');
      if (site.unreleasedHits(r, ctx.phrases).length) add(ln, 'unreleased');
      for (const m of r.matchAll(/(?<![\w&/])#(\d{1,7})\b/g)) if (!links.some((l) => l.line === ln && l.kind === 'ref' && l.id === m[1])) links.push({ line: ln, repo: REPO, kind: 'ref', id: m[1], comment: null, other: false });
    }
  });
  // a phrase or a blocked pair of words split across the lines of one paragraph (Markdown joins them)
  let start = 0;
  const paras = [];
  lines.forEach((l, i) => { if (!l.trim()) { if (i > start) paras.push([start, lines.slice(start, i)]); start = i + 1; } });
  if (start < lines.length) paras.push([start, lines.slice(start)]);
  for (const [s, ls] of paras) {
    if (ls.length < 2 || ls.some((l) => l.length > LINE_MAX)) continue;
    // a token cut across two lines (review of PR #1106): the lines joined with nothing between them
    if (ctx.redact) for (const r of lineReadings(ls.map((l) => l.trim()).join(''))) { let m; try { m = ctx.redact(r, {}); } catch { m = null; } if (m !== r) add(s + 1, 'secret'); }
    for (const r of lineReadings(ls.join(' '))) {
      if (site.unreleasedHits(r, ctx.phrases).length) add(s + 1, 'unreleased');
      for (const w of nameForms(r)) if (isBlocked(w)) add(s + 1, 'blocked');
      for (const w of FIRST_NAMES) if (new RegExp(`(?<!\\p{L})${w}(?!\\p{L})`, 'iu').test(r)) add(s + 1, 'first-name');
    }
  }
  return { problems: out, links };
}

/* ---------- posts ---------- */
const POST_NAME_RE = /^(\d{4}-\d{2}-\d{2})-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/;
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z')) && new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s;
const nonEmpty = (s) => typeof s === 'string' && s.trim().length > 0;
const SECURITY_WORDS = /\b(vulnerab\w*|bypass\w*|inject\w*|leak\w*|exploit\w*|cve-\d{4}-\d+|xss|rce|privilege escalation|security fix\w*)\b/i;

/* Split a post into its front block (parsed) and body. Front: the file starts with `---`, JSON, `---`. */
function splitPost(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(text);
  if (!m) return null;
  let front;
  try { front = JSON.parse(m[1]); } catch { return null; }
  if (!front || typeof front !== 'object' || Array.isArray(front)) return null;
  return { front, body: m[2], bodyLine: m[1].split(/\r?\n/).length + 3 };
}

/* Paragraph figures (FR-065): a digit left after dates, times, versions, ids, shas, refs, code and URLs needs a link in its paragraph. */
function figureProblems(body, offset) {
  const out = [];
  const lines = body.split(/\r?\n/);
  let para = [], start = 0, fence = false;
  const flush = () => {
    if (!para.length) return;
    const t = para.join(' ');
    const linked = /\]\(https:\/\/[^)\s]+\)|https:\/\/\S+/.test(t);
    const rest = t.replace(/`[^`]*`/g, ' ').replace(/\]\([^)]*\)/g, ']').replace(/https?:\/\/\S+/g, ' ')
      .replace(/\b\d{4}-\d{2}-\d{2}\b/g, ' ').replace(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g, ' ').replace(/\bv\d+(?:\.\d+)+(?:-[\w.]+)?\b/gi, ' ')
      .replace(/\b(?:FR|SC|NFR|T|Q|US)-?\d+[a-z]?\b/gi, ' ').replace(/\bspecs?\s+\d{3}\b/gi, ' ').replace(/\b\d{3}-[a-z][a-z0-9-]*/gi, ' ')
      .replace(/#\d+/g, ' ').replace(/\b[0-9a-f]{7,40}\b/gi, (h) => (/[a-f]/i.test(h) && /\d/.test(h) ? ' ' : h));
    if (/\d/.test(rest) && !linked) out.push({ line: start + offset, rule: 'figure' });
    para = [];
  };
  lines.forEach((l, i) => {
    if (/^\s*(```|~~~)/.test(l)) { flush(); fence = !fence; return; }
    if (fence) return;
    if (!l.trim()) { flush(); return; }
    if (!para.length) start = i;
    para.push(l);
  });
  flush();
  return out;
}

function gitOk(root, args) {
  try { execFileSync('git', args, { cwd: root, stdio: 'ignore' }); return true; } catch { return false; }
}
function mainRef(root) {
  for (const r of ['refs/remotes/origin/main', 'refs/heads/main']) if (gitOk(root, ['show-ref', '--verify', '--quiet', r])) return r;
  return null;
}

/*
 * One post's own rules (FR-050..FR-054, FR-063..FR-067, FR-079). `ctx` adds: root, git (args -> bool), mainRef, media (name ->
 * entry), order (the post's place among all posts by date, 0-based), online (null when offline) and the links list to fill.
 */
function postProblems(name, text, ctx) {
  const out = [];
  const add = (line, rule) => out.push({ line, rule });
  const nm = POST_NAME_RE.exec(name);
  if (!nm) add(1, 'file-name');
  const p = splitPost(text);
  if (!p) { add(1, 'front'); return out; }
  const { front: f, body, bodyLine } = p;
  for (const k of Object.keys(f)) if (!FRONT_KEYS.includes(k)) add(2, 'front-key');
  if (!isDate(f.date) || (nm && f.date !== nm[1])) add(2, 'date');
  if (!nonEmpty(f.title) || f.title.length > 120 || !nonEmpty(f.writtenBy) || !OWNERS.includes(f.whose) || !isDate(f.writtenOn) || (isDate(f.date) && isDate(f.writtenOn) && f.writtenOn < f.date)) add(2, 'label');
  // evidence: at least one; each commit on main, each spec path in the repository, each PR or issue checked online
  const ev = Array.isArray(f.evidence) ? f.evidence : null;
  if (!ev || !ev.length) add(2, 'evidence');
  for (const e of ev || []) {
    const keys = e && typeof e === 'object' && !Array.isArray(e) ? Object.keys(e) : [];
    if (keys.length !== 1) { add(2, 'evidence'); continue; }
    const v = e[keys[0]];
    if (keys[0] === 'commit') { if (typeof v !== 'string' || !/^[0-9a-f]{7,40}$/.test(v) || !ctx.mainRef || !ctx.git(['merge-base', '--is-ancestor', v, ctx.mainRef])) add(2, 'evidence'); }
    else if (keys[0] === 'spec') { if (typeof v !== 'string' || !/^specs\/\d{3}-[a-z0-9-]+\/[a-z0-9._-]+\.md$/.test(v) || v.includes('..') || !fs.existsSync(path.join(ctx.root, v))) add(2, 'evidence'); }
    else if (keys[0] === 'pr' || keys[0] === 'issue') { if (!Number.isSafeInteger(v) || v < 1) add(2, 'evidence'); else ctx.links.push({ line: 2, repo: REPO, kind: keys[0] === 'pr' ? 'pull' : 'issues', id: String(v), comment: null, other: false }); }
    else add(2, 'evidence');
  }
  // a commit linked in the text is checked with the other links in checkAll (kind 'commit')
  if (!Array.isArray(f.notVerified) || !f.notVerified.length || !f.notVerified.every(nonEmpty)) add(2, 'not-verified');
  const words = body.replace(/\]\([^)]*\)/g, ']').replace(/^```[\s\S]*?^```/gm, ' ').match(/[\p{L}\p{N}][\p{L}\p{N}'\u2019.-]*/gu) || [];
  if (words.length > POST_WORDS_MAX) add(bodyLine, 'words');
  for (const x of figureProblems(body, bodyLine)) out.push(x);
  // FR-067, FR-079: a post naming an owner or any @login, and each of the first 5 posts, needs a human owner's read
  const all = `${body}\n${f.title || ''}`;
  const names = OWNERS.some((o) => new RegExp(`(?<![\\w-])${o}(?![\\w-])`, 'i').test(all)) || /(?<![\w.@])@[a-z0-9][a-z0-9-]{0,38}\b/i.test(all);
  if ((names || ctx.order < HUMAN_READ_FIRST) && !OWNERS.includes(f.humanRead)) add(2, 'human-read');
  // owner's delta 2026-11-03: every post also has an agent review, from another side than the writer's
  const ar = f.agentReview;
  if (!ar || typeof ar !== 'object' || Array.isArray(ar) || !nonEmpty(ar.by) || !OWNERS.includes(ar.whose) || ar.whose === f.whose || Object.keys(ar).some((k) => !['by', 'whose'].includes(k))) add(2, 'agent-review');
  // FR-064: security hold
  const sec = f.security;
  if (sec === undefined) { if (SECURITY_WORDS.test(all)) add(2, 'security'); }
  else if (sec === 'none') { if (!nonEmpty(f.securityNote)) add(2, 'security'); }
  else if (sec && typeof sec === 'object' && !Array.isArray(sec) && typeof sec.sha === 'string' && /^[0-9a-f]{7,40}$/.test(sec.sha) && typeof sec.release === 'string' && /^v\d+\.\d+\.\d+$/.test(sec.release) && Object.keys(sec).length === 2) {
    const inTag = ctx.git(['show-ref', '--verify', '--quiet', `refs/tags/${sec.release}`]) && ctx.git(['merge-base', '--is-ancestor', sec.sha, `refs/tags/${sec.release}`]);
    const published = ctx.online ? ctx.online.releasePublished(sec.release) : false; // offline: cannot confirm, so it holds
    if (!inTag || published !== true) add(2, 'security');
  } else add(2, 'security');
  // FR-054, FR-065: the clip is a clip in the manifest (the manifest's own check does budget, hash and captions)
  const clip = typeof f.clip === 'string' ? ctx.media.get(f.clip) : null;
  if (!clip || clip.kind !== 'clip' || !clip.captions) add(2, 'clip');
  return out;
}

/* ---------- online: author and latest editor of each linked item (FR-063), release state (FR-064) ---------- */
function ghOnline(run, trusted) {
  const [owner, name] = REPO.split('/');
  const who = (a) => (!a || !a.login ? 'ghost' : a.__typename === 'Bot' ? `${a.login}[bot]` : a.login);
  const ok = (n) => !!n && trusted.has(who(n.author)) && (n.editor == null || trusted.has(who(n.editor))) && n.isCrossRepository !== true;
  return {
    itemTrusted(num) {
      const q = 'query($o:String!,$n:String!,$i:Int!){repository(owner:$o,name:$n){issueOrPullRequest(number:$i){__typename ... on Issue{author{__typename login} editor{__typename login}} ... on PullRequest{isCrossRepository author{__typename login} editor{__typename login}}}}}';
      const j = JSON.parse(run(['api', 'graphql', '-f', `query=${q}`, '-f', `o=${owner}`, '-f', `n=${name}`, '-F', `i=${Number(num)}`]));
      return ok(j && j.data && j.data.repository && j.data.repository.issueOrPullRequest);
    },
    commentTrusted(id) {
      const c = JSON.parse(run(['api', `repos/${REPO}/issues/comments/${Number(id)}`]));
      if (!c || typeof c.node_id !== 'string' || !/^[A-Za-z0-9_=-]+$/.test(c.node_id)) return false;
      const q = 'query($id:ID!){node(id:$id){... on IssueComment{author{__typename login} editor{__typename login}}}}';
      const j = JSON.parse(run(['api', 'graphql', '-f', `query=${q}`, '-f', `id=${c.node_id}`]));
      return ok(j && j.data && j.data.node);
    },
    releasePublished(tag) {
      const j = JSON.parse(run(['api', `repos/${REPO}/releases/tags/${encodeURIComponent(tag)}`]));
      return !!j && j.draft === false && j.tag_name === tag;
    },
  };
}
const ghRunner = (args) => execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 30000, windowsHide: true, shell: false });

/* ---------- the whole check ---------- */
/*
 * opts: { root, offline, env, gh (args -> stdout), git (args -> bool), redactLoader }. Returns { problems: [{file, line, rule}], notes, files }.
 */
function checkAll(opts = {}) {
  const root = opts.root || ROOT;
  const env = opts.env || process.env;
  const problems = [];
  const notes = [];
  const push = (file, line, rule) => problems.push({ file, line, rule });
  let redact = null;
  try { redact = (opts.redactLoader || loadRedact)(); } catch { redact = null; }
  let blocked = new Set(), phrases = [], media = new Map();
  try { blocked = loadBlocked(root); } catch { push(BLOCKED_FILE, 1, 'file-read'); }
  try { phrases = site.loadUnreleased(path.join(root, 'docs/site/unreleased.json')); } catch { push('docs/site/unreleased.json', 1, 'file-read'); }
  try {
    const m = JSON.parse(fs.readFileSync(path.join(root, 'docs/site/media.json'), 'utf8'));
    if (site.validateMedia(m, { root }).length) push('docs/site/media.json', 1, 'clip');
    else for (const e of m.files) media.set(e.name, e);
  } catch { push('docs/site/media.json', 1, 'file-read'); }
  // bare file names are not hosts: the repository's files, and the media manifest's names (release assets, not in git)
  const ctx = { redact, blocked, phrases, files: new Set([...repoFileNames(root), ...[...media.keys()].map((n) => n.toLowerCase())]) };
  const git = opts.git || ((args) => gitOk(root, args));
  const links = [];
  // an unreadable file (permissions, a race) is a file-read problem, never a crash that prints a path or a stack (round 3)
  const readText = (rel) => {
    try {
      const p = path.join(root, rel);
      const st = fs.lstatSync(p);
      if (!st.isFile() || st.size > FILE_MAX) return null;
      const b = fs.readFileSync(p);
      const t = b.toString('utf8');
      return Buffer.from(t, 'utf8').equals(b) && !t.includes('\0') ? t : null;
    } catch {
      return null;
    }
  };
  const files = [];
  const walk = (rel, isPosts) => {
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs)) return;
    let list;
    try { list = fs.readdirSync(abs, { withFileTypes: true }); } catch { push(rel, 1, 'file-read'); return; }
    for (const e of list.sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const r = `${rel}/${e.name}`;
      if (e.isSymbolicLink()) { push(r, 1, 'file-read'); continue; }
      if (e.isDirectory()) { if (isPosts) push(r, 1, 'file-name'); else walk(r, false); continue; }
      if (isPosts && e.name === 'README.md') { files.push({ rel: r, post: false }); continue; }
      if (!isPosts && !TEXT_EXT.test(e.name)) { push(r, 1, 'file-read'); continue; }
      files.push({ rel: r, post: isPosts });
    }
  };
  walk(POSTS, true);
  for (const d of TEXT_DIRS) walk(d, false);
  const posts = files.filter((f) => f.post).map((f) => ({ ...f, name: path.posix.basename(f.rel) }));
  const byDate = new Map();
  for (const p of posts) { const d = (POST_NAME_RE.exec(p.name) || [])[1]; if (d) byDate.set(d, (byDate.get(d) || 0) + 1); }
  const ordered = posts.map((p) => p.name).sort();
  const ref = mainRef(root);
  let online = null;
  const wantOnline = !opts.offline;
  // without `gh` on this machine the step cannot run: said plainly, and refused under CI (below)
  const ghHere = () => { try { execFileSync('gh', ['--version'], { stdio: 'ignore', timeout: 10000, windowsHide: true }); return true; } catch { return false; } };
  if (wantOnline && (opts.gh || ghHere())) online = ghOnline(opts.gh || ghRunner, trustedAuthors(root));
  const postCtxBase = { root, git, mainRef: ref, media, online, links };
  for (const f of files) {
    const text = readText(f.rel);
    if (text === null) { push(f.rel, 1, 'file-read'); continue; }
    const t = textProblems(text, ctx);
    for (const x of t.problems) push(f.rel, x.line, x.rule);
    for (const l of t.links) links.push({ ...l, file: f.rel });
    if (f.post) {
      // the front block's values as JSON reads them (a \u escape must not hide a name, token or host): the text rules again
      const sp = splitPost(text);
      if (sp) {
        const strings = [];
        const walkV = (v) => { if (typeof v === 'string') strings.push(v); else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { strings.push(k); walkV(x); } };
        walkV(sp.front);
        const fp = textProblems(strings.join('\n'), ctx);
        for (const x of fp.problems) push(f.rel, 2, x.rule);
        for (const l of fp.links) links.push({ ...l, line: 2, file: f.rel });
      }
      const before = links.length;
      const name = path.posix.basename(f.rel);
      for (const x of postProblems(name, text, { ...postCtxBase, order: ordered.indexOf(name) })) push(f.rel, x.line, x.rule);
      for (let i = before; i < links.length; i++) links[i].file = f.rel;
      const d = (POST_NAME_RE.exec(name) || [])[1];
      if (d && byDate.get(d) > 1) push(f.rel, 1, 'one-per-day');
    }
  }
  // FR-063: each linked issue, PR or comment, once
  const seen = new Map();
  const toCheck = [];
  for (const l of links) {
    if (l.repo.toLowerCase() !== REPO || l.other) { push(l.file, l.line, 'outside-link'); continue; }
    if (l.kind === 'commit') { if (!/^[0-9a-f]{7,40}$/i.test(l.id) || !ref || !git(['merge-base', '--is-ancestor', l.id.toLowerCase(), ref])) push(l.file, l.line, 'evidence'); continue; }
    if (!/^\d{1,7}$/.test(l.id)) { push(l.file, l.line, 'outside-link'); continue; }
    toCheck.push(l);
  }
  if (toCheck.length && !online) {
    if (env.CI) for (const l of toCheck) push(l.file, l.line, 'online-check');
    else notes.push(`the online author check did NOT run (offline): ${toCheck.length} link(s) to issues, PRs or comments are unchecked; CI runs it`);
  } else if (online) {
    for (const l of toCheck) {
      const key = l.comment ? `c${l.comment}` : `i${l.id}`;
      if (!seen.has(key)) {
        let ok;
        try { ok = l.comment ? online.commentTrusted(l.comment) && online.itemTrusted(l.id) : online.itemTrusted(l.id); } catch { ok = null; }
        seen.set(key, ok);
      }
      const ok = seen.get(key);
      if (ok === null) push(l.file, l.line, env.CI ? 'online-check' : 'outside-link');
      else if (!ok) push(l.file, l.line, 'outside-link');
    }
  }
  // file and folder names are public too (the slug is the post's URL): the text rules run on each relative path, and a path that
  // fails is never printed, so a blocked name cannot reach a CI log through it (review of PR #1106)
  const roots = [POSTS, ...TEXT_DIRS];
  const withheld = new Map();
  for (const rel of new Set([...files.map((f) => f.rel), ...problems.map((p) => p.file)])) {
    const root = roots.find((d) => rel.startsWith(`${d}/`));
    if (!root) continue;
    const tail = rel.slice(root.length + 1);
    const pp = textProblems(tail.replace(/\.[a-z0-9]{1,5}$/i, '').replace(/[\\/]/g, ' '), ctx).problems.filter((x) => PATH_RULES.has(x.rule));
    if (/[^\x20-\x7e]/.test(tail)) pp.push({ line: 0, rule: 'hidden-char' }); // any non-ASCII name is withheld (round 3)
    if (!pp.length) continue;
    withheld.set(rel, `${root}/<file name withheld ${withheld.size + 1}>`);
    for (const x of pp) problems.push({ file: rel, line: 0, rule: x.rule });
  }
  for (const p of problems) if (withheld.has(p.file)) p.file = withheld.get(p.file);
  const uniq = [...new Map(problems.map((p) => [`${p.file}\0${p.line}\0${p.rule}`, p])).values()];
  return { problems: uniq, notes, files: files.length };
}

/* ---------- the human step: add a blocked name's hash, printing nothing (FR-062) ---------- */
function normaliseBlocked(input) {
  let s = String(input).trim().toLowerCase().replace(/^[a-z][a-z0-9+.-]*:\/\//, '').split(/[/?#]/)[0].replace(/^.*@/, '').replace(/:\d*$/, '').replace(/\.$/, '');
  s = s.normalize('NFKC');
  return /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/.test(s) && s.length <= 253 ? s : null;
}
function addBlocked(input, root = ROOT) {
  const name = normaliseBlocked(input);
  if (!name) return false;
  const f = path.join(root, BLOCKED_FILE);
  const j = JSON.parse(fs.readFileSync(f, 'utf8'));
  const set = new Set(Array.isArray(j.sha256) ? j.sha256 : []);
  set.add(hashName(name));
  // the bare name too (review of T005): "standin-client.com" also blocks "standin-client" and "standinclient"
  const labels = name.split('.');
  if (labels.length > 1) {
    const base = labels.length > 2 && /^(?:co|com|org|net|ac|gov|edu)$/.test(labels[labels.length - 2]) ? labels.slice(0, -2) : labels.slice(0, -1);
    const label = base[base.length - 1];
    if (label && label.length >= 3) { set.add(hashName(label)); set.add(hashName(label.replace(/-/g, ''))); }
  } else set.add(hashName(name.replace(/-/g, '')));
  j.sha256 = [...set].sort();
  fs.writeFileSync(f, JSON.stringify(j, null, 2) + '\n');
  return true;
}
function readSecretLine() {
  return new Promise((resolve) => {
    const s = process.stdin;
    let buf = '';
    const tty = !!s.isTTY;
    if (tty) s.setRawMode(true); // no echo on a terminal
    s.setEncoding('utf8');
    const done = () => { if (tty) s.setRawMode(false); s.pause(); resolve(buf); };
    s.on('data', (d) => {
      for (const ch of d) {
        if (ch === '\u0003') { if (tty) s.setRawMode(false); process.exit(130); }
        if (ch === '\r' || ch === '\n') { if (tty || buf) return done(); continue; }
        buf += ch;
      }
    });
    s.on('end', done);
  });
}

module.exports = { nameForms, urlProblems, LINE_MAX, RULES, FRONT_KEYS, OWNERS, FIRST_NAMES, checkAll, textProblems, postProblems, figureProblems, splitPost, lineReadings, trustedAuthors, ghOnline, hashName, normaliseBlocked, addBlocked, loadRedact, HASH_PREFIX };

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.includes('--add-blocked-host')) {
    if (args.length !== 1) { process.stderr.write('usage: node scripts/check-posts.js --add-blocked-host  (the name comes from stdin, never an argument)\n'); process.exit(2); }
    readSecretLine().then((line) => { process.exit(addBlocked(line) ? 0 : 2); });
  } else {
    for (const a of args) if (a !== '--offline') { process.stderr.write('usage: node scripts/check-posts.js [--offline] | --add-blocked-host\n'); process.exit(2); }
    let r;
    try {
      // tests only (round 4): make checkAll fail, to prove the last resort prints no path or stack; it can only fail the check
      if (process.env.DURBAR_BLOGCHECK_TEST_THROW === '1') throw Object.assign(new Error(`test-only failure in ${__filename}`), { code: 'ETESTSEAM' });
      r = checkAll({ offline: args.includes('--offline') });
    } catch (e) {
      // fail closed without a path, a name or a stack: only the error's code (round 3)
      process.stderr.write(`blog:check: internal error (${/^[A-Z][A-Z0-9_]{1,30}$/.test(String(e && e.code)) ? e.code : 'no code'}); nothing is published (fail closed)\n`);
      process.exit(1);
    }
    for (const n of r.notes) console.log(`blog:check: ${n}`);
    if (r.problems.length) {
      for (const p of r.problems) console.error(`${p.file}:${p.line}: ${p.rule}: ${RULES[p.rule] || p.rule}`);
      console.error(`blog:check: ${r.problems.length} problem(s) in ${r.files} file(s); the matched text is not printed (spec 104 FR-062)`);
      process.exit(1);
    }
    console.log(`blog:check: ok (${r.files} file(s) checked)`);
  }
}
