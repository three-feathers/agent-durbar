/*
 * Spec 050: build the project website (GitHub Pages) from what the repository already maintains. Plain Node, no framework.
 *
 *   node scripts/build-site.js            writes _site/ (index.html, screenshots, icon)
 *   SITE_OUT=dir SITE_RELEASE=off node scripts/build-site.js   (tests: another folder, no network)
 *
 * Sources: README.md sections, the specs index (feature list), docs/site/gallery.json (which screenshots, with captions),
 * CHANGELOG.md (latest release section) and, unless SITE_RELEASE=off, the latest GitHub release (its files). Nothing is written
 * by hand twice: a change to those files changes the site on the next build. Raw HTML in Markdown is escaped; relative links
 * go to the file on GitHub; images are copied next to the page. No external fonts, scripts, analytics or cookies.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { Marked } = require('marked');

const ROOT = path.join(__dirname, '..');
const OUT = process.env.SITE_OUT ? path.resolve(process.env.SITE_OUT) : path.join(ROOT, '_site');
const REPO = 'three-feathers/agent-durbar';
const GH = `https://github.com/${REPO}`;
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/* Markdown with our rules: raw HTML is shown as text; repo-relative links point to GitHub; screenshots are copied. */
const copied = new Set();
function makeMd(baseDir) {
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
  md.use({
    renderer: {
      html(tok) { return esc(tok.text !== undefined ? tok.text : tok.raw || ''); },
      image(tok) { return `<img src="${esc(fix(tok.href, true))}" alt="${esc(tok.text || '')}" loading="lazy">`; },
      link(tok) {
        const href = fix(tok.href, false);
        const ext = /^https?:/.test(href) ? ' rel="noopener"' : '';
        return `<a href="${esc(href)}"${ext}>${this.parser.parseInline(tok.tokens)}</a>`;
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

/* The specs index: built features as cards (number, title, link), release specs left out. */
function features(index) {
  const rows = [];
  for (const l of index.split('\n')) {
    const m = /^\| \[(\d{3})\]\(([^)]+)\) \| ([^|]+) \| (.+) \|\s*$/.exec(l);
    if (!m) continue;
    const [, num, link, title, status] = m;
    if (/^Release /i.test(title.trim())) continue;
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
  const head = rel.slice(3, nl).replace(/\(\[[^\]]*\]\([^)]*\),?\s*/, '(').trim();
  return { head, body: rel.slice(nl + 1).trim() };
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

function downloadBox(rel) {
  if (!rel) return `<p><a class="btn primary" href="${GH}/releases">Download from the Releases page</a></p>`;
  const pick = (re) => rel.assets.find((a) => re.test(a.name));
  const items = [
    ['macOS (Apple Silicon)', pick(/arm64\.dmg$/)],
    ['macOS (Intel)', pick(/x64\.dmg$/)],
    ['Windows (installer)', pick(/^Agent-Durbar-Setup-.*\.exe$/)],
    ['Linux (AppImage)', pick(/\.AppImage$/)],
  ].filter(([, a]) => a);
  const sums = pick(/^SHA256SUMS\.txt$/);
  return `<p class="rel">Latest: <a href="${esc(rel.url)}"><b>${esc(rel.tag)}</b></a>${rel.pre ? ' (pre-release)' : ''}${rel.date ? ' · ' + esc(rel.date) : ''}</p>
    <div class="dl">${items.map(([label, a]) => `<a class="btn" href="${esc(a.url)}">${esc(label)}</a>`).join('')}</div>
    <p class="small">Unsigned alpha builds: your OS will warn the first time (see Install below).${sums ? ` Check them against <a href="${esc(sums.url)}">SHA256SUMS.txt</a>.` : ''} Other files on the <a href="${esc(rel.url)}">release page</a>.</p>`;
}

const CSS = `
:root{--bg:#f6f3ec;--surface:#fffdf8;--ink:#2b2722;--ink-2:#5b544a;--muted:#7a7266;--line:#e4ddcf;--accent:#3f6d5c;--accent-ink:#fff;--code:#efe9dc}
@media (prefers-color-scheme:dark){:root{--bg:#1d1b18;--surface:#26231f;--ink:#efe9de;--ink-2:#cfc6b6;--muted:#a39a8b;--line:#3a352e;--accent:#7fb39d;--accent-ink:#13201b;--code:#302c26}}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,Ubuntu,sans-serif}
a{color:var(--accent)}img{max-width:100%;height:auto;border-radius:10px;border:1px solid var(--line)}
header.top{position:sticky;top:0;z-index:2;background:color-mix(in srgb,var(--bg) 92%,transparent);backdrop-filter:blur(6px);border-bottom:1px solid var(--line)}
.wrap{max-width:1080px;margin:0 auto;padding:0 20px}
.top .wrap{display:flex;align-items:center;gap:12px;height:56px}.top .brand{display:flex;align-items:center;gap:10px;font-weight:700;color:var(--ink);text-decoration:none}
.top .brand img{width:28px;height:28px;border:0;border-radius:6px}.top nav{margin-left:auto;display:flex;gap:16px;flex-wrap:wrap}.top nav a{color:var(--ink-2);text-decoration:none;font-size:14px}
.hero{padding:56px 0 24px;text-align:center}.hero img.logo{width:88px;height:88px;border:0}.hero h1{font-size:clamp(30px,5vw,46px);margin:12px 0 4px}
.hero .tag{font-size:19px;color:var(--ink-2);margin:0 0 12px}.hero .lead{max-width:760px;margin:0 auto 22px;color:var(--ink-2)}
.btn{display:inline-block;padding:10px 16px;border-radius:10px;border:1px solid var(--line);background:var(--surface);color:var(--ink);text-decoration:none;font-weight:600;font-size:15px}
.btn.primary{background:var(--accent);color:var(--accent-ink);border-color:var(--accent)}
.dl{display:flex;gap:10px;flex-wrap:wrap;justify-content:center;margin:8px 0}.rel{margin:4px 0}.small{font-size:13.5px;color:var(--muted)}
section.blk{background:var(--surface);border:1px solid var(--line);border-radius:16px;padding:22px 26px;margin:22px 0}
section.blk h2{margin-top:0;font-size:24px}section.blk h3{font-size:18px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:12px;padding:0;list-style:none}
.grid li a{display:block;height:100%;padding:12px 14px;border:1px solid var(--line);border-radius:12px;background:var(--bg);text-decoration:none;color:var(--ink)}
.grid li small{display:block;color:var(--muted);font-size:12.5px}
.gallery{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px}.gallery figure{margin:0}.gallery figcaption{font-size:13.5px;color:var(--muted);margin-top:6px}
table{border-collapse:collapse;width:100%;font-size:14.5px;display:block;overflow-x:auto}th,td{border:1px solid var(--line);padding:6px 10px;text-align:left;vertical-align:top}
code{background:var(--code);padding:1px 5px;border-radius:5px;font-size:.92em}pre{background:var(--code);padding:12px;border-radius:10px;overflow-x:auto}pre code{background:none;padding:0}
blockquote{margin:0;padding:6px 14px;border-left:4px solid var(--accent);background:var(--bg);border-radius:6px}
footer{padding:28px 0 40px;color:var(--muted);font-size:13.5px;text-align:center}
@media (max-width:640px){.top nav{display:none}section.blk{padding:16px}}
`;

async function main() {
  const readme = read('README.md');
  const intro = readme.split('\n').find((l) => l.startsWith('Agent Durbar is ')) || '';
  const status = section(readme, 'What you can do'); // ensures the structure we rely on exists
  const gallery = JSON.parse(read('docs/site/gallery.json'));
  const feats = features(read('specs/README.md'));
  const changes = latestChanges(read('CHANGELOG.md'));
  const rel = await latestRelease();
  const blk = (id, title, html) => `<section class="blk" id="${id}"><h2>${esc(title)}</h2>${html}</section>`;
  const sec = (t) => mdRoot.parse(section(readme, t));

  const galleryHtml = `<div class="gallery">${gallery.map((g) => {
    copied.add('docs/screenshots/' + g.file);
    return `<figure><a href="screenshots/${esc(g.file)}"><img src="screenshots/${esc(g.file)}" alt="${esc(g.alt || g.caption)}" loading="lazy"></a><figcaption>${esc(g.caption)}</figcaption></figure>`;
  }).join('')}</div>`;
  const featHtml = `<p class="small">Each card is a feature that is built, with its spec: what it does, how it was checked, and its honest limits.</p><ul class="grid">${feats.map((f) => `<li><a href="${esc(f.href)}"><small>Spec ${esc(f.num)}</small>${esc(f.title)}</a></li>`).join('')}</ul>`;
  const changesHtml = changes ? `<h3>${esc(changes.head)}</h3>${mdRoot.parse(changes.body)}<p><a href="${GH}/blob/main/CHANGELOG.md">Full changelog</a></p>` : '';

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Agent Durbar: a calm command center for your AI agents</title>
<meta name="description" content="${esc(intro.replace(/\*\*/g, ''))}">
<meta name="color-scheme" content="light dark">
<link rel="icon" href="icon.svg" type="image/svg+xml">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<style>${CSS}</style></head>
<body>
<header class="top"><div class="wrap"><a class="brand" href="#"><img src="icon.svg" alt="">Agent Durbar</a>
<nav aria-label="Sections"><a href="#features">Features</a><a href="#harnesses">Harnesses</a><a href="#install">Install</a><a href="#safety">Safety</a><a href="#themes">Themes</a><a href="#how">How we work</a><a href="${GH}">GitHub</a></nav></div></header>
<main class="wrap">
<div class="hero"><img class="logo" src="icon.svg" alt="Agent Durbar icon: a lead and a working team">
<h1>Agent Durbar</h1><p class="tag">A calm command center for your AI agents</p>
<p class="lead">${mdRoot.parseInline(intro)}</p>
${downloadBox(rel)}
${(() => { const g = gallery[0]; return g ? `<p><img src="screenshots/${esc(g.file)}" alt="${esc(g.alt || g.caption)}"></p>` : ''; })()}
</div>
${blk('features', 'What you can do', sec('What you can do'))}
${blk('built', 'Every built feature', featHtml)}
${blk('gallery', 'Screenshots', galleryHtml)}
${blk('harnesses', 'Harnesses', sec('Harnesses'))}
${blk('new', "What's new", changesHtml)}
${blk('install', 'Install', sec('Install'))}
${blk('safety', 'Safety model', sec('Safety model'))}
${blk('costs', 'Costs and caps', sec('Costs and caps'))}
${blk('themes', 'Themes', sec('Themes'))}
${blk('limits', 'Known limits', sec('Known limits'))}
${blk('how', 'How we work', sec('How we work'))}
</main>
<footer><p>MIT licence · by Three Feathers · <a href="${GH}">${esc(REPO)}</a></p>
<p>Agent Durbar is an independent community project, not affiliated with, endorsed by or sponsored by GitHub, Microsoft, Anthropic or OpenAI. Built from the repository on every change; nothing here tracks you.</p></footer>
</body></html>
`;
  void status;
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(path.join(OUT, 'screenshots'), { recursive: true });
  fs.writeFileSync(path.join(OUT, 'index.html'), html);
  fs.copyFileSync(path.join(ROOT, 'build', 'icon.svg'), path.join(OUT, 'icon.svg'));
  fs.writeFileSync(path.join(OUT, '.nojekyll'), '');
  for (const rel of copied) {
    const src = path.join(ROOT, rel);
    if (!fs.existsSync(src)) throw new Error(`missing image: ${rel}`);
    fs.copyFileSync(src, path.join(OUT, 'screenshots', path.basename(rel)));
  }
  console.log(`site: ${OUT} (${feats.length} features, ${gallery.length} gallery images, ${copied.size} images copied${rel ? ', release ' + rel.tag : ', no release info'})`);
}

main().catch((e) => {
  console.error(e && e.message ? e.message : e);
  process.exit(1);
});
