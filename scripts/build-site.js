/*
 * Spec 050: build the project website (GitHub Pages) from what the repository already maintains. Plain Node, no framework.
 *
 *   node scripts/build-site.js            writes _site/ (index.html, docs.html, screenshots, icon)
 *   SITE_OUT=dir SITE_RELEASE=off node scripts/build-site.js   (tests: another folder, no network)
 *
 * Two pages (spec delta 2026-10-20):
 * - index.html, a short landing page from docs/site/landing.json (hand-written, curated) plus the README's install steps,
 *   the newest CHANGELOG release and the latest GitHub release. landing.json is checked against the README on every build:
 *   a card's anchor must be a README heading, a harness must be in the README's Harnesses table, and every screenshot must
 *   exist, or the build fails.
 * - docs.html, the whole README with a table of contents, the built-feature grid from the specs index, the gallery
 *   (docs/site/gallery.json) and the full newest release notes.
 * Raw HTML in Markdown is escaped; relative links go to the file on GitHub; images are copied next to the page. No scripts,
 * external fonts, analytics or cookies.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { Marked } = require('marked');

const ROOT = path.join(__dirname, '..');
const OUT = process.env.SITE_OUT ? path.resolve(process.env.SITE_OUT) : path.join(ROOT, '_site');
const REPO = 'three-feathers/agent-durbar';
const GH = `https://github.com/${REPO}`;
const SHOTS = 'docs/screenshots';
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/* GitHub's heading anchors: lower case, punctuation dropped, spaces to hyphens, duplicates numbered. */
function slugger() {
  const seen = new Map();
  return (text) => {
    const base = String(text).toLowerCase().replace(/<[^>]*>/g, '').replace(/[^\p{L}\p{N} _-]/gu, '').trim().replace(/ /g, '-');
    const n = seen.get(base) || 0;
    seen.set(base, n + 1);
    return n ? `${base}-${n}` : base;
  };
}
/* Every heading anchor in a Markdown file (outside code fences). */
function headingAnchors(md) {
  const slug = slugger();
  const out = new Set();
  let fence = false;
  for (const l of md.split('\n')) {
    if (/^\s*(```|~~~)/.test(l)) fence = !fence;
    if (fence) continue;
    const m = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(l);
    if (m) out.add(slug(m[2].replace(/[*_`]/g, '')));
  }
  return out;
}

/* PNG width and height from the IHDR chunk, for width/height attributes (no layout shift). */
function pngSize(file) {
  try {
    const fd = fs.openSync(file, 'r');
    const b = Buffer.alloc(24);
    fs.readSync(fd, b, 0, 24, 0);
    fs.closeSync(fd);
    if (b.toString('latin1', 12, 16) !== 'IHDR') return null;
    return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
  } catch {
    return null;
  }
}
const dims = (rel) => {
  const s = pngSize(path.join(ROOT, rel));
  return s ? ` width="${s.w}" height="${s.h}"` : '';
};

/* Markdown with our rules: raw HTML is shown as text; repo-relative links point to GitHub; screenshots are copied. */
const copied = new Set();
function makeMd(baseDir, { ids = false } = {}) {
  const md = new Marked({ gfm: true, breaks: false, async: false });
  const fix = (href, isImg) => {
    if (!href || /^(https?:|mailto:|#)/.test(href)) return href;
    const rel = path.posix.normalize(path.posix.join(baseDir, href.split('#')[0]));
    const frag = href.includes('#') ? '#' + href.split('#')[1] : '';
    if (isImg || /^docs\/screenshots\/[^/]+\.png$/.test(rel)) {
      copied.add(rel);
      return 'screenshots/' + path.posix.basename(rel);
    }
    return `${GH}/blob/main/${rel}${frag}`;
  };
  const slug = slugger();
  md.use({
    renderer: {
      html(tok) { return esc(tok.text !== undefined ? tok.text : tok.raw || ''); },
      image(tok) {
        const src = fix(tok.href, true);
        const rel = /^https?:/.test(tok.href || '') ? null : path.posix.normalize(path.posix.join(baseDir, tok.href));
        return `<img src="${esc(src)}" alt="${esc(tok.text || '')}"${rel ? dims(rel) : ''} loading="lazy">`;
      },
      link(tok) {
        const href = fix(tok.href, false);
        const ext = /^https?:/.test(href) ? ' rel="noopener"' : '';
        return `<a href="${esc(href)}"${ext}>${this.parser.parseInline(tok.tokens)}</a>`;
      },
      heading(tok) {
        const inner = this.parser.parseInline(tok.tokens);
        return ids ? `<h${tok.depth} id="${esc(slug(tok.text.replace(/[*_`]/g, '')))}">${inner}</h${tok.depth}>\n` : `<h${tok.depth}>${inner}</h${tok.depth}>\n`;
      },
    },
  });
  return md;
}
const mdRoot = makeMd('');

/* README: the text of one `## Title` section (until the next `## `). */
function section(readme, title) {
  const lines = readme.split('\n');
  const i = lines.findIndex((l) => l.trim() === '## ' + title);
  if (i < 0) throw new Error(`README has no section "## ${title}"`);
  let j = i + 1;
  while (j < lines.length && !lines[j].startsWith('## ')) j++;
  return lines.slice(i + 1, j).join('\n').trim();
}
/* README: every `## ` title in order. */
const sectionTitles = (readme) => readme.split('\n').filter((l) => l.startsWith('## ')).map((l) => l.slice(3).trim());

/* README Harnesses table: the bold names in its first column. */
function harnessNames(readme) {
  const names = new Set();
  for (const l of section(readme, 'Harnesses').split('\n')) {
    const m = /^\|\s*\*\*([^*]+)\*\*\s*\|/.exec(l);
    if (m) names.add(m[1].trim());
  }
  return names;
}

/* README Install: the first-run step for each OS (`- **macOS:** …`). */
function installSteps(readme) {
  const steps = {};
  let open = null; // an OS line with its steps as nested bullets below it ("- **Windows:**" then "  - …")
  for (const l of section(readme, 'Install').split('\n')) {
    const m = /^- \*\*(macOS|Windows|Linux):\*\*\s*(.*)$/.exec(l);
    if (m) { open = m[2].trim() ? null : m[1]; if (m[2].trim()) steps[m[1]] = m[2].trim().replace(/^[a-z]/, (c) => c.toUpperCase()); continue; }
    const sub = /^\s{2,}- (.+)$/.exec(l);
    if (open && sub) { steps[open] = ((steps[open] ? steps[open] + ' ' : '') + sub[1].trim()).replace(/^[a-z]/, (c) => c.toUpperCase()); continue; }
    if (!/^\s/.test(l)) open = null;
  }
  return steps;
}

/* The specs index: built features as cards (number, title, link); release specs and `exclude` (process specs) left out. */
function features(index, exclude = []) {
  const rows = [];
  for (const l of index.split('\n')) {
    const m = /^\| \[(\d{3})\]\(([^)]+)\) \| ([^|]+) \| (.+) \|\s*$/.exec(l);
    if (!m) continue;
    const [, num, link, title, status] = m;
    if (/^Release /i.test(title.trim()) || exclude.includes(num)) continue;
    const s = status.toLowerCase();
    const built = /\b(built|implemented|published)\b/.test(s) && !/^\*{0,2}draft/.test(s.trim());
    if (!built) continue;
    rows.push({ num, title: title.trim().replace(/\s*\(.*?issue.*?\)\s*$/i, ''), href: `${GH}/blob/main/specs/${link}` });
  }
  return rows;
}

/* CHANGELOG: the newest release section (its heading and intro paragraph and list). */
function latestChanges(changelog) {
  const parts = changelog.split(/\n(?=## v)/);
  const rel = parts.find((p) => p.startsWith('## v'));
  if (!rel) return null;
  const nl = rel.indexOf('\n');
  const head = rel.slice(3, nl).replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').trim();
  return { head, body: rel.slice(nl + 1).trim() };
}

/* Internal references (spec numbers, FR ids, issue numbers) left out for the landing page. */
function stripRefs(text) {
  return String(text)
    .replace(/\s*\([^()]*\b(?:spec \d{3}|specs? \d{3}|FR-\d+|#\d+|owner)\b[^()]*\)/gi, '')
    .replace(/\s+([.,;:])/g, '$1')
    .trim();
}
/* The landing page's "What's new": at most `max` top-level bullets, each its bold lead and first sentence. */
function shortChanges(changes, max = 5) {
  if (!changes) return null;
  const bullets = [];
  for (const l of changes.body.split('\n')) {
    if (!l.startsWith('- ')) continue;
    let t = stripRefs(l.slice(2));
    const lead = /^\*\*(.+?)\*\*\s*(.*)$/.exec(t);
    if (lead) {
      const rest = (/^(.+?[.!?])(\s|$)/.exec(lead[2]) || [, lead[2]])[1];
      t = `**${lead[1]}** ${rest}`.trim();
    }
    bullets.push(t);
    if (bullets.length >= max) break;
  }
  // the release's own summary paragraph (the text before the first bullet), when it has one: it reads better than internal bullet leads
  const intro = changes.body.split(/\n\s*\n/).map((x) => x.trim()).find((x) => x && !x.startsWith('- ') && !x.startsWith('#'));
  return { head: changes.head, bullets, intro: intro ? stripRefs(intro.replace(/\s*\n\s*/g, ' ')) : '' };
}

/* landing.json must stay in step with the README and the screenshots. Returns a list of problems (empty: fine). */
const ICONS = {
  inbox: '<path d="M4 13h4l2 3h4l2-3h4"/><path d="M5.5 5h13L21 13v5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-5z"/>',
  shield: '<path d="M12 3l8 3v6c0 4.5-3.4 8.2-8 9-4.6-.8-8-4.5-8-9V6z"/><path d="M8.5 12l2.5 2.5 4.5-5"/>',
  coins: '<ellipse cx="9" cy="7" rx="6" ry="3"/><path d="M3 7v5c0 1.7 2.7 3 6 3s6-1.3 6-3V7"/><path d="M9 15v2c0 1.7 2.7 3 6 3s6-1.3 6-3v-5c0-1.7-2.7-3-6-3"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  gauge: '<path d="M4 18a8 8 0 1 1 16 0"/><path d="M12 18l4-6"/>',
};
function validateLanding(landing, { readme, shotExists = (f) => fs.existsSync(path.join(ROOT, SHOTS, f)) }) {
  const errs = [];
  const anchors = headingAnchors(readme);
  const names = harnessNames(readme);
  const shot = (f, where) => { if (f && !shotExists(f)) errs.push(`${where}: screenshot ${SHOTS}/${f} is missing`); };
  const need = (v, where) => { if (!v || typeof v !== 'string') errs.push(`${where} is missing`); };
  if (!landing || typeof landing !== 'object') return ['landing.json is not an object'];
  need(landing.hero && landing.hero.title, 'hero.title');
  need(landing.hero && landing.hero.tagline, 'hero.tagline');
  need(landing.hero && landing.hero.image, 'hero.image');
  shot(landing.hero && landing.hero.image, 'hero.image');
  need(landing.status, 'status');
  (landing.cards || []).forEach((c, i) => {
    need(c.title, `cards[${i}].title`);
    if (!anchors.has(c.readmeAnchor)) errs.push(`cards[${i}].readmeAnchor "${c.readmeAnchor}" is not a README heading`);
    if (!ICONS[c.icon]) errs.push(`cards[${i}].icon "${c.icon}" is unknown`);
    shot(c.screenshot, `cards[${i}]`);
  });
  if (!Array.isArray(landing.howItWorks) || landing.howItWorks.length !== 3) errs.push('howItWorks needs 3 steps');
  (landing.howItWorks || []).forEach((s, i) => shot(s.screenshot, `howItWorks[${i}]`));
  (landing.themes || []).forEach((t, i) => {
    need(t.name, `themes[${i}].name`);
    if (!t.screenshot) errs.push(`themes[${i}].screenshot is missing`);
    shot(t.screenshot, `themes[${i}]`);
    if (!/^#[0-9a-f]{6}$/i.test(t.swatch || '')) errs.push(`themes[${i}].swatch is not a #rrggbb colour`);
  });
  if (landing.aiTheme) shot(landing.aiTheme.screenshot, 'aiTheme');
  (landing.harnesses || []).forEach((h, i) => {
    if (!names.has(h.name)) errs.push(`harnesses[${i}].name "${h.name}" is not in the README's Harnesses table`);
    need(h.verified, `harnesses[${i}].verified`);
    need(h.notYet, `harnesses[${i}].notYet`);
  });
  if (!Array.isArray(landing.featuresExclude)) errs.push('featuresExclude is missing');
  return errs;
}

async function latestRelease() {
  if (process.env.SITE_RELEASE === 'off') return null;
  try {
    const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'agent-durbar-site' };
    if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    const r = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=5`, { headers });
    if (!r.ok) return null;
    const list = await r.json();
    const rel = Array.isArray(list) ? list.find((x) => !x.draft) : null;
    if (!rel) return null;
    return { tag: String(rel.tag_name), url: String(rel.html_url), pre: rel.prerelease === true, date: String(rel.published_at || '').slice(0, 10), assets: (rel.assets || []).map((a) => ({ name: String(a.name), url: String(a.browser_download_url) })) };
  } catch {
    return null; // no network: the page links to the Releases page instead
  }
}
function assetsOf(rel) {
  const pick = (re) => (rel ? rel.assets.find((a) => re.test(a.name)) : null);
  return {
    macArm: pick(/arm64\.dmg$/), macIntel: pick(/x64\.dmg$/), win: pick(/^Agent-Durbar-Setup-.*\.exe$/),
    linux: pick(/\.AppImage$/), sums: pick(/^SHA256SUMS\.txt$/),
  };
}

const CSS_BASE = `
:root{--bg:#f7f4ee;--surface:#fffdf9;--ink:#1f1c18;--ink-2:#575046;--muted:#7a7266;--line:#e6dfd2;--accent:#2f6b57;--accent-2:#8a1c2b;--gold:#c8962e;--code:#efe9dc;
--s1:4px;--s2:8px;--s3:16px;--s4:24px;--s5:40px;--s6:64px;--s7:112px;--max:1120px;--prose:680px;--gut:24px}
@media (prefers-color-scheme:dark){:root{--bg:#141210;--surface:#1d1a17;--ink:#f1ece3;--ink-2:#cfc6b6;--muted:#a39a8b;--line:#2e2a25;--accent:#7fc0a6;--accent-2:#e0707e;--gold:#e2b456;--code:#26221e}}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%;scroll-padding-top:72px}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,Ubuntu,"Helvetica Neue",Arial,sans-serif}
a{color:var(--accent);text-underline-offset:2px}img{max-width:100%;height:auto}
h1,h2,h3{line-height:1.15;margin:0 0 var(--s3)}h2{font-size:clamp(26px,3.5vw,36px);letter-spacing:-.02em}h3{font-size:19px}
.wrap{max-width:var(--max);margin:0 auto;padding:0 var(--gut)}
header.top{position:sticky;top:0;z-index:5;background:color-mix(in srgb,var(--bg) 90%,transparent);backdrop-filter:blur(8px);border-bottom:1px solid var(--line)}
.top .wrap{display:flex;align-items:center;gap:var(--s3);height:60px}
.brand{display:flex;align-items:center;gap:10px;font-weight:700;color:var(--ink);text-decoration:none;letter-spacing:-.01em}.brand img{width:28px;height:28px}
.top nav{margin-left:auto;display:flex;gap:var(--s4);align-items:center}.top nav a{color:var(--ink-2);text-decoration:none;font-size:14.5px}.top nav a:hover{color:var(--ink)}
.top nav a.gh{font-weight:600;color:var(--ink)}
.eyebrow{font-size:12px;text-transform:uppercase;letter-spacing:.12em;color:var(--accent-2);font-weight:700;margin:0 0 var(--s3)}
.lead{font-size:19px;color:var(--muted);margin:0 0 var(--s4)}.small{font-size:13.5px;color:var(--muted)}
code{background:var(--code);padding:1px 5px;border-radius:5px;font-size:.9em}pre{background:var(--code);padding:var(--s3);border-radius:10px;overflow-x:auto}pre code{background:none;padding:0}
table{border-collapse:collapse;width:100%;font-size:14.5px;display:block;overflow-x:auto}th,td{border:1px solid var(--line);padding:6px 10px;text-align:left;vertical-align:top}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;height:44px;padding:0 20px;border-radius:10px;font-weight:600;font-size:15.5px;text-decoration:none;transition:transform .15s ease,box-shadow .15s ease}
.btn.primary{background:var(--ink);color:var(--bg)}.btn.secondary{color:var(--ink);box-shadow:inset 0 0 0 1px var(--line);background:var(--surface)}
.btn:hover{transform:translateY(-1px)}
@media (prefers-reduced-motion:reduce){.btn,.btn:hover{transition:none;transform:none}}
footer.foot{border-top:1px solid var(--line);margin-top:var(--s7);padding:var(--s5) 0 var(--s6);color:var(--muted);font-size:13.5px}
.foot nav{display:flex;flex-wrap:wrap;gap:var(--s3) var(--s4);margin-bottom:var(--s3)}.foot nav a{color:var(--ink-2)}.foot p{margin:var(--s2) 0;max-width:760px}
.durbar{height:14px;margin:var(--s7) auto;max-width:560px;position:relative;background:radial-gradient(circle at 50% 100%,transparent 5px,var(--gold) 5.5px 6.5px,transparent 7px) 0 0/16px 14px repeat-x;-webkit-mask:linear-gradient(90deg,transparent,#000 30%,#000 70%,transparent);mask:linear-gradient(90deg,transparent,#000 30%,#000 70%,transparent);opacity:.55}
.durbar::after{content:"";position:absolute;left:50%;top:3px;width:8px;height:8px;background:var(--accent-2);transform:translateX(-50%) rotate(45deg)}
@media (max-width:640px){:root{--gut:16px}.top nav a:not(.keep){display:none}.top nav{gap:var(--s3)}footer.foot{margin-top:var(--s6)}.durbar{margin:var(--s6) auto}}
`;

const CSS_LANDING = `
section.sec{margin:var(--s7) auto 0}.sec.flush{margin-top:0}section.sec>.head{max-width:var(--prose);margin-bottom:var(--s5)}section.sec>.head p{margin:0}
.hero{background:radial-gradient(60% 50% at 50% 0%,color-mix(in srgb,var(--gold) 14%,transparent),transparent),var(--bg);padding:var(--s6) 0 0;text-align:center}
.hero h1{font-size:clamp(36px,6vw,64px);line-height:1.05;font-weight:700;letter-spacing:-.03em;margin:0 auto var(--s3);max-width:820px}
.hero .lead{max-width:640px;margin:0 auto var(--s4)}
.cta{display:flex;gap:var(--s2);justify-content:center;flex-wrap:wrap}
.os{margin:var(--s3) 0 var(--s1);font-size:14px;color:var(--muted)}.os a{color:var(--ink-2)}.os span+span::before{content:"·";margin:0 8px;color:var(--line)}
.status{display:inline-block;margin:var(--s2) 0 0;font-size:13.5px;color:var(--ink-2);padding:4px 12px;border-radius:999px;background:color-mix(in srgb,var(--gold) 14%,var(--surface));border:1px solid color-mix(in srgb,var(--gold) 35%,var(--line))}
.frame{margin:var(--s5) auto 0;max-width:var(--max);border-radius:14px;border:1px solid var(--line);padding:6px;background:var(--surface);box-shadow:0 30px 60px -20px #2b1d0f40,0 12px 24px -12px #0002}
.frame .bar{display:flex;gap:6px;padding:4px 6px 8px}.frame .bar i{width:9px;height:9px;border-radius:50%;background:var(--line)}
.frame img{display:block;border-radius:9px;width:100%}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:var(--s3)}
.card{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:var(--s4);display:flex;flex-direction:column}
.card h3{margin:var(--s3) 0 var(--s2);font-size:18px}.card p{margin:0 0 var(--s3);color:var(--ink-2);font-size:15px}.card .more{margin-top:auto;font-size:14px;font-weight:600}
.card img{border-radius:8px;border:1px solid var(--line);margin:0 0 var(--s3);aspect-ratio:16/9;object-fit:cover;object-position:left top}
.ico{width:36px;height:36px;border-radius:10px;display:grid;place-items:center;background:color-mix(in srgb,var(--accent) 14%,transparent);color:var(--accent)}
.ico svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.how{display:grid;grid-template-columns:minmax(0,5fr) minmax(0,7fr);gap:var(--s5);align-items:center}
.steps{list-style:none;margin:0;padding:0;counter-reset:s}.steps li{counter-increment:s;position:relative;padding:0 0 var(--s4) 52px}
.steps li::before{content:counter(s);position:absolute;left:0;top:0;width:36px;height:36px;border-radius:50%;display:grid;place-items:center;font-weight:700;background:var(--ink);color:var(--bg)}
.steps h3{margin:4px 0 var(--s1);font-size:18px}.steps p{margin:0;color:var(--ink-2)}
.shot{border-radius:12px;border:1px solid var(--line);box-shadow:0 18px 40px -20px #2b1d0f40;display:block}
h1,h2,h3{text-wrap:balance}
.os span{white-space:nowrap}
.themes{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:var(--s3);margin:0;padding:0;list-style:none}
.themes figure{margin:0}.themes .tz{aspect-ratio:16/10;overflow:hidden;border-radius:12px;border:1px solid var(--line);background:var(--surface)}.themes .tz img{display:block;width:230%;max-width:none;height:auto;border:0;border-radius:0}
.themes figcaption{display:flex;align-items:center;gap:8px;margin-top:var(--s2);font-size:13.5px;color:var(--ink-2);line-height:1.3}
.sw{flex:none;width:12px;height:12px;border-radius:50%;box-shadow:0 0 0 2px var(--surface),0 0 0 3px var(--line)}
.ai{display:flex;align-items:center;gap:var(--s3);margin-top:var(--s4);color:var(--ink-2)}.ai img{width:120px;aspect-ratio:16/10;object-fit:cover;object-position:left top;border-radius:8px;border:1px solid var(--line)}
.apps{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:var(--s3)}
.app{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:var(--s4)}.app h3{font-size:18px;margin-bottom:var(--s2)}
.app p{margin:0 0 var(--s2);font-size:15px}.app .ok{color:var(--ink-2)}.app .ok::before{content:"✓ ";color:var(--accent);font-weight:700}
.app .no{color:var(--muted);font-size:14px}.app .no::before{content:"○ ";color:var(--gold)}
.points{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:var(--s4)}.points h3{font-size:18px;margin:var(--s3) 0 var(--s1)}.points p{margin:0;color:var(--ink-2);font-size:15px}
.dl{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:var(--s3)}
.os-col{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:var(--s4)}.os-col h3{font-size:18px;margin-bottom:var(--s2)}
.os-col .links{display:flex;flex-direction:column;gap:6px;margin:0 0 var(--s3)}.os-col .links a{font-weight:600}.os-col p{margin:0;font-size:14.5px;color:var(--ink-2)}
details{margin-top:var(--s4);background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:var(--s3) var(--s4)}summary{cursor:pointer;font-weight:600}
details ul{margin:var(--s2) 0 0;padding-left:20px;font-size:14.5px}
.news{max-width:var(--prose)}.news ul{padding-left:20px;margin:0 0 var(--s3)}.news li{margin-bottom:var(--s2);color:var(--ink-2)}.news li strong{color:var(--ink)}
@media (max-width:900px){.how{grid-template-columns:1fr}.apps,.points,.dl{grid-template-columns:1fr}.themes{grid-template-columns:repeat(3,minmax(0,1fr))}}
@media (max-width:640px){section.sec{margin-top:var(--s6)}section.sec>.head{margin-bottom:var(--s4)}.hero{padding-top:var(--s5)}
.cta .btn{width:100%}.cards{grid-template-columns:1fr}.lead{font-size:17px}.frame{margin-top:var(--s4);padding:4px}.frame .bar{padding:2px 4px 6px}
.themes{display:grid;grid-auto-flow:column;grid-template-columns:none;grid-auto-columns:72%;overflow-x:auto;scroll-snap-type:x mandatory;padding-bottom:var(--s2)}.themes li{scroll-snap-align:start}
.card,.app,.os-col{padding:var(--s3)}.steps li{padding-bottom:var(--s3)}}
`;

const CSS_DOCS = `
.docs{display:grid;grid-template-columns:220px minmax(0,1fr);gap:var(--s5);padding-top:var(--s5)}
.toc{position:sticky;top:76px;align-self:start;max-height:calc(100vh - 92px);overflow:auto;font-size:14px}
.toc summary{font-weight:700;margin-bottom:var(--s2);list-style:none}.toc ol{list-style:none;margin:0;padding:0}.toc li a{display:block;padding:4px 0;color:var(--ink-2);text-decoration:none}.toc li a:hover{color:var(--accent)}
.doc{max-width:820px}.doc h1{font-size:clamp(32px,5vw,48px);letter-spacing:-.03em}
.doc section{padding-top:var(--s5);border-top:1px solid var(--line);margin-top:var(--s5)}.doc section:first-of-type{border-top:0;margin-top:0;padding-top:0}
.doc img{border-radius:10px;border:1px solid var(--line)}
blockquote{margin:0 0 var(--s3);padding:var(--s2) var(--s3);border-left:4px solid var(--gold);background:var(--surface);border-radius:6px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:var(--s2);padding:0;list-style:none}
.grid li a{display:block;height:100%;padding:12px 14px;border:1px solid var(--line);border-radius:12px;background:var(--surface);text-decoration:none;color:var(--ink)}
.grid li small{display:block;color:var(--muted);font-size:12.5px}
.gallery{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:var(--s3)}.gallery figure{margin:0}.gallery figcaption{font-size:13.5px;color:var(--muted);margin-top:6px}
@media (max-width:860px){.docs{grid-template-columns:1fr;gap:var(--s3);padding-top:var(--s4)}.toc{position:static;max-height:none;background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:var(--s3)}}
`;

function page({ title, description, css, nav, body }) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta name="color-scheme" content="light dark">
<link rel="icon" href="icon.svg" type="image/svg+xml">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<style>${CSS_BASE}${css}</style></head>
<body>
<header class="top"><div class="wrap"><a class="brand" href="index.html"><img src="icon.svg" alt="" width="28" height="28">Agent Durbar</a>
<nav aria-label="Site">${nav}</nav></div></header>
${body}
<footer class="foot"><div class="wrap">
<nav aria-label="Footer"><a href="${GH}">GitHub</a><a href="docs.html">Docs</a><a href="${GH}/blob/main/CHANGELOG.md">Changelog</a><a href="${GH}/blob/main/SECURITY.md">Security</a><a href="${GH}/blob/main/LICENSE">License (MIT)</a><a href="${GH}/releases">Releases</a></nav>
<p>Made by <a href="https://github.com/three-feathers">Three Feathers</a> and contributors, spec-driven with GitHub Spec Kit. MIT licence.</p>
<p>Agent Durbar is an independent community project, not affiliated with, endorsed by or sponsored by GitHub, Microsoft, Anthropic or OpenAI. "GitHub Copilot", "Claude" and "Codex" are trademarks of their owners. This site is built from the repository on every change; nothing here tracks you.</p>
</div></footer>
</body></html>
`;
}

const img = (file, alt, { lazy = true, cls = '' } = {}) => {
  copied.add(`${SHOTS}/${file}`);
  return `<img${cls ? ` class="${cls}"` : ''} src="screenshots/${esc(file)}" alt="${esc(alt)}"${dims(`${SHOTS}/${file}`)}${lazy ? ' loading="lazy"' : ''} decoding="async">`;
};

function landingHtml({ landing, readme, rel, changes }) {
  const a = assetsOf(rel);
  const relUrl = rel ? rel.url : `${GH}/releases`;
  const link = (asset, label) => `<a href="${esc(asset ? asset.url : relUrl)}">${esc(label)}</a>`;
  const steps = installSteps(readme);
  const step = (os) => (steps[os] ? mdRoot.parseInline(steps[os]) : 'See the install notes in the docs.');
  const h = landing.hero;
  const osLinks = rel
    ? [[a.macArm, 'macOS Apple Silicon'], [a.macIntel, 'macOS Intel'], [a.win, 'Windows'], [a.linux, 'Linux']].filter(([x]) => x).map(([x, l]) => `<span>${link(x, l)}</span>`).join('')
    : `<span><a href="${GH}/releases">macOS, Windows and Linux builds on the Releases page</a></span>`;
  const news = shortChanges(changes);

  const nav = `<a href="#features">Features</a><a href="#themes">Themes</a><a href="#apps">Agent apps</a><a href="#download">Download</a><a class="keep" href="docs.html">Docs</a><a class="keep gh" href="${GH}">GitHub</a>`;
  const body = `<main>
<div class="hero"><div class="wrap">
<p class="eyebrow">${esc(h.eyebrow || '')}</p>
<h1>${esc(h.title)}</h1>
<p class="lead">${esc(h.tagline)}</p>
<div class="cta"><a class="btn primary" href="${esc(relUrl)}">Download alpha</a><a class="btn secondary" href="docs.html">Read the docs</a></div>
<p class="os">${osLinks}</p>
<p class="status" id="status">${esc(landing.status)}</p>
<div class="frame"><div class="bar" aria-hidden="true"><i></i><i></i><i></i></div>${img(h.image, h.alt || h.title, { lazy: false })}</div>
</div></div>

<div class="wrap">
<section class="sec" id="features"><div class="head"><p class="eyebrow">Why Durbar</p><h2>One calm place for every agent</h2></div>
<div class="cards">${landing.cards.map((c) => `<article class="card"><div class="ico"><svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[c.icon]}</svg></div>
<h3>${esc(c.title)}</h3><p>${esc(c.text)}</p>${c.screenshot ? img(c.screenshot, c.alt || c.title) : ''}<a class="more" href="docs.html#${esc(c.readmeAnchor)}">Read more<span aria-hidden="true"> →</span></a></article>`).join('\n')}</div>
</section>

<section class="sec" id="how"><div class="head"><p class="eyebrow">How it works</p><h2>Three steps to a working office</h2></div>
<div class="how"><ol class="steps">${landing.howItWorks.map((s) => `<li><h3>${esc(s.title)}</h3><p>${esc(s.text)}</p></li>`).join('')}</ol>
<div>${(() => { const s = landing.howItWorks.find((x) => x.screenshot); return s ? img(s.screenshot, s.alt || s.title, { cls: 'shot' }) : ''; })()}</div></div>
</section>

<div class="durbar" role="presentation"></div>

<section class="sec flush" id="themes"><div class="head"><p class="eyebrow">Themes</p><h2>Make the office yours</h2><p class="lead">Six built-in looks change the whole app live: colours, frames, people and furniture. Status and permission words stay the same in every one.</p></div>
<ul class="themes">${landing.themes.map((t) => `<li><figure><div class="tz">${img(t.screenshot, `The office in the ${t.name} theme`)}</div><figcaption><span class="sw" style="background:${esc(t.swatch)}"></span>${esc(t.name)}</figcaption></figure></li>`).join('')}</ul>
${landing.aiTheme ? `<p class="ai">${img(landing.aiTheme.screenshot, landing.aiTheme.alt || '')}<span>${esc(landing.aiTheme.text)}</span></p>` : ''}
</section>

<section class="sec" id="apps"><div class="head"><p class="eyebrow">Agent apps</p><h2>Works with the agents you already use</h2><p>Durbar drives the agent apps you installed and signed in to yourself. What we checked, and what we have not yet:</p></div>
<div class="apps">${landing.harnesses.map((x) => `<article class="app"><h3>${esc(x.name)}</h3><p class="ok">${esc(x.verified)}</p><p class="no">${esc(x.notYet)}</p></article>`).join('')}</div>
<p class="small"><a href="docs.html#harnesses">Details for each agent app</a></p>
</section>

<section class="sec" id="safety"><div class="head"><p class="eyebrow">Safety and cost</p><h2>Agents ask before they act</h2></div>
<div class="points">${landing.safety.map((s, i) => `<div><div class="ico"><svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[['eye', 'lock', 'gauge'][i % 3]]}</svg></div><h3>${esc(s.title)}</h3><p>${esc(s.text)}</p></div>`).join('')}</div>
<p class="small"><a href="docs.html#safety-model">The full safety model</a> · <a href="docs.html#costs-and-caps">Costs and spending limits</a></p>
</section>

<div class="durbar" role="presentation"></div>

<section class="sec flush" id="download"><div class="head"><p class="eyebrow">Download</p><h2>Install the alpha</h2><p>${rel ? `Latest: <a href="${esc(rel.url)}"><b>${esc(rel.tag)}</b></a>${rel.pre ? ' (pre-release)' : ''}${rel.date ? ', ' + esc(rel.date) : ''}. ` : ''}The builds are not code-signed yet, so your system warns you the first time. Only open files from the Releases page.</p></div>
<div class="dl">
<div class="os-col"><h3>macOS</h3><div class="links">${link(a.macArm, 'Apple Silicon (.dmg)')}${link(a.macIntel, 'Intel (.dmg)')}</div><p>${step('macOS')}</p></div>
<div class="os-col"><h3>Windows 10/11</h3><div class="links">${link(a.win, 'Installer (.exe)')}</div><p>${step('Windows')}</p></div>
<div class="os-col"><h3>Linux</h3><div class="links">${link(a.linux, 'AppImage (x64)')}</div><p>${step('Linux')}</p></div>
</div>
<details><summary>Check the download (SHA-256)</summary>
<p class="small">Compare your file with ${a.sums ? `<a href="${esc(a.sums.url)}">SHA256SUMS.txt</a>` : `<code>SHA256SUMS.txt</code> on the <a href="${esc(relUrl)}">release page</a>`}:</p>
<ul><li>macOS: <code>shasum -a 256 Agent-Durbar-*.dmg</code></li><li>Windows: <code>certutil -hashfile Agent-Durbar-Setup-*.exe SHA256</code></li><li>Linux: <code>sha256sum -c SHA256SUMS.txt --ignore-missing</code></li></ul>
</details>
</section>

${news ? `<section class="sec" id="new"><div class="head"><p class="eyebrow">What's new</p><h2>${esc(news.head)}</h2></div>
<div class="news">${news.intro ? `<p class="lead">${mdRoot.parseInline(news.intro)}</p>` : `<ul>${news.bullets.map((b) => `<li>${mdRoot.parseInline(b)}</li>`).join('')}</ul>`}
<p><a href="${GH}/blob/main/CHANGELOG.md">Full changelog on GitHub</a> · <a href="docs.html#whats-new">All of this release</a></p></div>
</section>` : ''}
</div>
</main>`;
  return page({
    title: 'Agent Durbar: see all your AI agents at once',
    description: `${h.title}. ${h.tagline}`,
    css: CSS_LANDING,
    nav,
    body,
  });
}

function docsHtml({ readme, intro, feats, gallery, changes }) {
  const mdDocs = makeMd('', { ids: true });
  const titles = sectionTitles(readme).filter((t) => t !== 'Contents');
  const slug = slugger();
  const secs = titles.map((t) => ({ id: slug(t), title: t, html: mdDocs.parse(section(readme, t)) }));
  const status = (/^> \*\*Status[\s\S]*?(?=\n\n)/m.exec(readme) || [''])[0];
  const extra = [
    { id: 'features', title: 'Every built feature', html: `<p class="small">Each card is a built feature with its spec: what it does, how it was checked, and its honest limits.</p><ul class="grid">${feats.map((f) => `<li><a href="${esc(f.href)}"><small>Spec ${esc(f.num)}</small>${esc(f.title)}</a></li>`).join('')}</ul>` },
    { id: 'gallery', title: 'Screenshots', html: `<div class="gallery">${gallery.map((g) => `<figure><a href="screenshots/${esc(g.file)}">${img(g.file, g.alt || g.caption)}</a><figcaption>${esc(g.caption)}</figcaption></figure>`).join('')}</div>` },
    { id: 'whats-new', title: "What's new", html: changes ? `<h3>${esc(changes.head)}</h3>${mdRoot.parse(changes.body)}<p><a href="${GH}/blob/main/CHANGELOG.md">Full changelog</a></p>` : '' },
  ];
  const all = [...secs, ...extra];
  const nav = `<a href="index.html#features">Features</a><a href="index.html#download">Download</a><a class="keep" href="docs.html">Docs</a><a class="keep gh" href="${GH}">GitHub</a>`;
  const body = `<main class="wrap docs">
<nav class="toc" aria-label="Contents"><details open><summary>Contents</summary><ol>${all.map((s) => `<li><a href="#${esc(s.id)}">${esc(s.title)}</a></li>`).join('')}</ol></details></nav>
<div class="doc">
<h1>Agent Durbar docs</h1>
<p class="lead">${mdRoot.parseInline(intro)}</p>
${status ? mdRoot.parse(status) : ''}
${all.map((s) => `<section id="${esc(s.id)}"><h2>${esc(s.title)}</h2>${s.html}</section>`).join('\n')}
</div>
</main>`;
  return page({ title: 'Agent Durbar docs', description: intro.replace(/\*\*/g, ''), css: CSS_DOCS, nav, body });
}

async function main() {
  const readme = read('README.md');
  const intro = readme.split('\n').find((l) => l.startsWith('Agent Durbar is ')) || '';
  const landing = JSON.parse(read('docs/site/landing.json'));
  const errs = validateLanding(landing, { readme });
  if (errs.length) throw new Error(`docs/site/landing.json is out of step:\n- ${errs.join('\n- ')}`);
  const gallery = JSON.parse(read('docs/site/gallery.json'));
  const feats = features(read('specs/README.md'), landing.featuresExclude);
  const changes = latestChanges(read('CHANGELOG.md'));
  const rel = await latestRelease();

  const index = landingHtml({ landing, readme, rel, changes });
  const docs = docsHtml({ readme, intro, feats, gallery, changes });

  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(path.join(OUT, 'screenshots'), { recursive: true });
  fs.writeFileSync(path.join(OUT, 'index.html'), index);
  fs.writeFileSync(path.join(OUT, 'docs.html'), docs);
  fs.copyFileSync(path.join(ROOT, 'build', 'icon.svg'), path.join(OUT, 'icon.svg'));
  fs.writeFileSync(path.join(OUT, '.nojekyll'), '');
  for (const r of copied) {
    const src = path.join(ROOT, r);
    if (!fs.existsSync(src)) throw new Error(`missing image: ${r}`);
    fs.copyFileSync(src, path.join(OUT, 'screenshots', path.basename(r)));
  }
  console.log(`site: ${OUT} (index ${index.length} B, docs ${docs.length} B, ${feats.length} features, ${gallery.length} gallery images, ${copied.size} images copied${rel ? ', release ' + rel.tag : ', no release info'})`);
}

module.exports = { validateLanding, headingAnchors, harnessNames, installSteps, features, latestChanges, shortChanges, stripRefs, slugger };

if (require.main === module) {
  main().catch((e) => {
    console.error(e && e.message ? e.message : e);
    process.exit(1);
  });
}
