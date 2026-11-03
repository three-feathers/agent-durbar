/*
 * A short clip of a release's visible changes, for the top of its notes (spec 008 FR-171..FR-178, owner request 2026-11-03).
 * Simulator only (DURBAR_SIM=15, frozen, pinned clock): no agent app, no account, no AI credits (constitution IV).
 *
 *   npm run build
 *   node scripts/release-video.js --version v0.1.7 --out <folder>          the trial clip (scenes below, in this order)
 *   node scripts/release-video.js --version v0.1.7 --out <folder> --scenes crews,mcp
 *   node scripts/release-video.js --list                                    the scene catalogue
 *   FFMPEG=<path to ffmpeg>                                                  when ffmpeg is not on PATH
 *
 * Two halves in one file:
 * - the command (plain Node): checks ffmpeg and the build, starts the app once through ui-suite's `runOne` (a fresh profile, no shell,
 *   xvfb-run on Linux without a display) with this file as the driver, then encodes the frames with ffmpeg (no shell, fixed arguments):
 *   `release-<version>.mp4` (1440x1028: the app's 1440x900 with a 128 px caption band under it, H.264, 30 fps) and `release-<version>.gif` (800 px wide, 8 fps, at most GIF_MAX bytes; it
 *   retries smaller when it is over), plus `release-<version>.json` (scenes, lengths, sizes) and one still per scene to look at;
 * - the driver (Electron main, `module.exports`): plays each scene in the simulator at 1440x900 with a caption naming the change and
 *   captures the page with `webContents.capturePage()` at FPS frames a second; the caption is drawn by a second, offscreen window into a
 *   band under the app, so no caption covers an app pixel. Before and after filming each scene it refuses to go on when the
 *   page's text (body text, input values, titles, labels, alt text) holds the home folder, the user or host name, this checkout's
 *   path or anything `redact` masks (FR-176): the clip shows simulator data only.
 *
 * It never touches a release, a tag or the notes. Any failure exits 1 and leaves no `release-*` file behind (FR-175: the release
 * still publishes, without a clip). One Electron at a time.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const W = 1440, H_ = 900;            // the app's size (FR-172)
const BAND = 128;                    // the caption band under the app: no caption covers an app pixel
const FRAME_H = H_ + BAND;           // the clip's frame: 1440x1028
const FPS = 8;                       // frames captured a second; the GIF keeps them all, the MP4 repeats them to 30 fps
const MP4_FPS = 30;
const GIF_WIDTHS = [800, 720, 640];  // tried in turn until the GIF fits GIF_MAX
const GIF_MAX = 5 * 1024 * 1024;     // FR-172: loads fast in the notes
const MP4_MAX = 20 * 1024 * 1024;
const LEN_MIN = 25, LEN_MAX = 75;    // seconds; FR-172 aims at 30-60, the bounds fail a broken run
const VERSION_RE = /^v\d+\.\d+\.\d+(?:-(?:alpha|beta|rc)\.\d+)?$/;
const CLOCK = '2026-10-20T09:30:00Z'; // the same pinned page clock as shots-docs
const RECORD_MS = 5 * 60 * 1000;     // FR-175: time limits, so a hang never holds a release (the whole tree is killed)
const FFMPEG_MS = 3 * 60 * 1000;
const PROBE_MS = 30 * 1000;
/* FR-176 (review on #1083): the only variables Electron and ffmpeg get (runOne adds the simulator's own); never a token. */
const ENV_ALLOW = ['PATH', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'TEMP', 'TMP', 'TMPDIR', 'SYSTEMROOT', 'WINDIR', 'SYSTEMDRIVE',
  'DISPLAY', 'WAYLAND_DISPLAY', 'XAUTHORITY', 'XDG_RUNTIME_DIR', 'FONTCONFIG_PATH', 'FONTCONFIG_FILE', 'LANG', 'LC_ALL', 'UI_SUITE_XVFB'];

/* ---------------------------------------------------------------- the scene catalogue (FR-173) ----------------------------------------------------------------
 * id -> { title, sub, play(S) }. `title` names the change (the caption, at least 22 px on a 1440 px frame), `sub` says where to find it.
 * `play` sets the scene up and calls S.film(seconds) for what is recorded; set-up time is never in the clip. */
const SCENES = {
  intro: {
    title: 'Agent Durbar {version}', sub: 'What is new, in the simulator',
    async play(S) { await S.reset(); await S.card(true); await S.film(3); await S.card(false); },
  },
  crews: {
    title: 'Four new character crews', sub: 'Pirate, Monster, Royal and Animal Rebels: Settings > Characters',
    async play(S) {
      await S.reset();
      await S.openSettings();
      await S.scrollTo('chH');
      await S.film(3);
      for (const [id, name] of [['pirate', 'Pirate'], ['monster', 'Monster'], ['royal', 'Royal'], ['rebels', 'Animal Rebels']]) {
        await S.pickCharacters(id);
        await S.closeSettings();
        await S.caption(`${name} crew`, 'Settings > Characters');
        await S.film(2.5);
        await S.openSettings();
      }
      await S.pickCharacters('theme');
      await S.closeSettings();
    },
  },
  mcp: {
    title: 'What MCP servers cost', sub: 'The MCP chip and a line warn when tool definitions fill the window',
    async play(S) {
      await S.reset({ simmcpctx: 'owner' });
      await S.openMcpChat();
      await S.film(4.5);
    },
  },
  org: {
    title: 'Settings > Organization', sub: 'What your organization\'s policy blocks, per agent app (read-only)',
    async play(S) {
      await S.reset({ simkinds: 'mixed', simorgpolicy: '1' });
      await S.openSettings();
      if (!(await S.H.until(`document.querySelectorAll('#orgSet li.orgrow').length===3`, 8000))) throw new Error('org: the Organization rows did not show');
      await S.scrollTo('orgH');
      await S.film(4.5);
      await S.closeSettings();
    },
  },
  floors: {
    title: 'Floors count up from the bottom', sub: 'Floor 1 is at the bottom of the lift; PageUp goes one floor up',
    async play(S) {
      await S.reset({ simfloors: '1' });
      if (!(await S.H.until(`(()=>{const l=document.getElementById('lift');return !!l&&!l.hidden&&l.getClientRects().length>0})()`, 8000))) throw new Error('floors: no lift');
      await S.film(2);
      await S.H.key('PageUp', [], { pause: 30 });
      await S.H.settle();
      await S.film(2.5);
    },
  },
  office: {
    title: 'Two themes, one open office', sub: 'Clean Office and Retro Pixel; no doors, no Simple/Expert switch',
    async play(S) {
      await S.reset();
      await S.film(2);
      await S.pickTheme('retro');
      await S.film(2.5);
      await S.pickTheme('clean-office');
    },
  },
  outro: {
    title: '{count} changes in {version}', sub: 'The full list is in the notes below',
    async play(S) { await S.reset(); await S.card(true); await S.film(3); await S.card(false); },
  },
};
const DEFAULT_SCENES = ['intro', 'crews', 'mcp', 'org', 'floors', 'office', 'outro'];

/* ---------------------------------------------------------------- pure parts (tested by scripts/test-release-video.js) ---------------------------------------------------------------- */

function parseArgs(argv) {
  const a = { scenes: DEFAULT_SCENES.slice(), keepFrames: false, list: false, count: null };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const val = () => { const v = argv[++i]; if (v === undefined || v.startsWith('--')) throw new Error(`${k} needs a value`); return v; };
    if (k === '--version') a.version = val();
    else if (k === '--out') a.out = val();
    else if (k === '--scenes') a.scenes = val().split(',').map((s) => s.trim()).filter(Boolean);
    else if (k === '--count') a.count = Number(val());
    else if (k === '--keep-frames') a.keepFrames = true;
    else if (k === '--list') a.list = true;
    else throw new Error(`unknown argument ${k}`);
  }
  if (a.list) return a;
  if (!a.version || !VERSION_RE.test(a.version)) throw new Error(`--version must be a release tag like v1.2.3 or v1.2.3-alpha.4 (got ${JSON.stringify(a.version)})`);
  if (!a.out) throw new Error('--out <folder> is required');
  const unknown = a.scenes.filter((s) => !Object.prototype.hasOwnProperty.call(SCENES, s));
  if (unknown.length) throw new Error(`unknown scene(s): ${unknown.join(', ')} (see --list)`);
  if (!a.scenes.length) throw new Error('no scene selected');
  if (a.count !== null && !(Number.isInteger(a.count) && a.count > 0 && a.count < 1000)) throw new Error('--count must be a whole number of changes');
  return a;
}

/** The caption text with {version} and {count} filled in. */
function fill(text, vars) {
  return String(text).replace(/\{(version|count)\}/g, (_, k) => (vars[k] === null || vars[k] === undefined ? '' : String(vars[k])));
}

/**
 * FR-176: what in the page's text must never be in a frame. Values shorter than 4 characters are left out (a 3-letter user name
 * would match ordinary words); the home folder and the checkout path are matched as written and with the other slash.
 */
function forbiddenValues({ home = os.homedir(), user = safeUser(), host = os.hostname(), root = ROOT, email = gitEmail() } = {}) {
  const out = new Set();
  if (email && /^[^\s@]+@[^\s@]+$/.test(email)) out.add(email); // the git identity (review on #1083)
  for (const v of [home, root]) if (v && v.length >= 4) { out.add(v); out.add(v.replace(/\\/g, '/')); out.add(v.replace(/\//g, '\\')); }
  for (const v of [user, host]) if (v && v.length >= 4) out.add(v);
  return [...out];
}
/** `git config user.email` of this checkout ('' when unset or git is missing): no shell, a time limit. */
function gitEmail(run = require('child_process').execFileSync) {
  try { return String(run('git', ['config', 'user.email'], { cwd: ROOT, encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true, shell: false }) || '').trim(); } catch { return ''; }
}
/** The allow-listed part of an environment (names matched case-insensitively: Windows has `Path`, `SystemRoot`). */
function childEnv(env = process.env) {
  const out = {};
  for (const [k, v] of Object.entries(env)) if (ENV_ALLOW.includes(k.toUpperCase()) && typeof v === 'string') out[k] = v;
  return out;
}
function safeUser() { try { return os.userInfo().username; } catch { return process.env.USER || process.env.USERNAME || ''; } }

/**
 * FR-176: the problems in `text` (empty when clean). A user or host name counts only as a whole word, case-insensitively; a path anywhere.
 * `redact` is the app's own masker (src/shared/redact.ts); a text it changes holds something shaped like a secret.
 */
function privacyProblems(text, forbidden, redact) {
  const t = String(text || '');
  const lower = t.toLowerCase();
  const hits = [];
  for (const v of forbidden) {
    if (v.includes('@')) { if (lower.includes(v.toLowerCase())) hits.push('the git email'); continue; }
    const isPath = /[\\/]/.test(v);
    if (isPath ? t.includes(v) : new RegExp(`(^|[^a-z0-9_.-])${v.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z0-9_-])`).test(lower)) hits.push(isPath ? 'a local path' : 'the user or host name');
  }
  if (typeof redact === 'function' && redact(t) !== t) hits.push('text that redact masks (token-shaped)');
  return [...new Set(hits)];
}

/**
 * The ffmpeg concat list for frames captured at their own times: each frame shows until the next one was taken, the last for one
 * frame period (the concat demuxer needs the last file twice for its duration to count). Names only: ffmpeg runs in the frames folder.
 */
function concatList(frames, fps = FPS) {
  if (!frames.length) throw new Error('no frames were captured');
  const lines = ['ffconcat version 1.0'];
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    if (!/^[a-z0-9-]+\.(png|jpg)$/.test(f.file)) throw new Error(`unexpected frame name ${JSON.stringify(f.file)}`);
    const next = frames[i + 1];
    const d = next ? Math.max(0.001, (next.t - f.t) / 1000) : 1 / fps;
    lines.push(`file ${f.file}`, `duration ${d.toFixed(3)}`);
  }
  lines.push(`file ${frames[frames.length - 1].file}`);
  return lines.join('\n') + '\n';
}

/**
 * One clip frame as a BGRA bitmap (W x FRAME_H): the app's bitmap (W x H_) on top, unchanged, and the band's bottom BAND rows under it;
 * a title card (`card`) is the band window's whole frame. Nothing is drawn over the app's rows.
 */
function composeFrame(app, band, { card = false, w = W, h = H_, bandH = BAND } = {}) {
  const row = w * 4, total = row * (h + bandH);
  if (!band || band.length !== total) throw new Error('the band bitmap has the wrong size');
  if (card) return Buffer.from(band);
  if (!app || app.length !== row * h) throw new Error('the app bitmap has the wrong size');
  const out = Buffer.allocUnsafe(total);
  app.copy(out, 0, 0, row * h);
  band.copy(out, row * h, row * h, total);
  return out;
}

/* The band window's page: a dark strip at the bottom with the caption, or (card) the whole frame as a title card. Static text only. */
const BAND_HTML = `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<style>html,body{margin:0;height:100%;background:#12161e;overflow:hidden}
body{font-family:system-ui,"Segoe UI",Roboto,"DejaVu Sans",sans-serif;color:#fff}
#app{position:absolute;left:0;right:0;top:0;height:${H_}px;background:#12161e}
#band{position:absolute;left:0;right:0;top:${H_}px;height:${BAND}px;box-sizing:border-box;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#12161e;border-top:2px solid #2c3442;text-align:center}
#t{font-weight:650;font-size:38px;line-height:1.2}#s{margin-top:6px;font-size:25px;line-height:1.25;color:#d5dce7}
body.card #band{display:none}body.card #app{height:${FRAME_H}px;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center}
#ct{font-weight:650;font-size:64px}#cs{margin-top:18px;font-size:30px;color:#d5dce7}body:not(.card) #ct,body:not(.card) #cs{display:none}</style>
<div id="app"><div id="ct"></div><div id="cs"></div></div><div id="band"><div id="t"></div><div id="s"></div></div>
<script>window.setBand=(t,s,card)=>{for(const id of ['t','ct'])document.getElementById(id).textContent=t;for(const id of ['s','cs'])document.getElementById(id).textContent=s;document.body.classList.toggle('card',!!card);return new Promise((r)=>requestAnimationFrame(()=>requestAnimationFrame(()=>r(true))));};</script>`;

/** ffmpeg argument lists (no shell). `list` and the outputs are names in the working folder or absolute paths. */
function mp4Args(list, out) {
  return ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list,
    '-vf', `fps=${MP4_FPS},scale=${W}:${FRAME_H}:flags=lanczos,format=yuv420p`, '-c:v', 'libx264', '-preset', 'slow', '-crf', '24', '-movflags', '+faststart', '-an', out];
}
function gifArgs(list, out, width, colors = 192) {
  const base = `fps=${FPS},scale=${width}:-2:flags=lanczos`;
  return ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list,
    '-filter_complex', `[0:v]${base},split[a][b];[a]palettegen=max_colors=${colors}:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`,
    '-loop', '0', out];
}
/** The GIF tries, best first: each width with 192 colours, then the smallest width with 128. */
function gifTries() { return [...GIF_WIDTHS.map((w) => ({ width: w, colors: 192 })), { width: GIF_WIDTHS[GIF_WIDTHS.length - 1], colors: 128 }]; }

/** The length a run must have (FR-172): a clip outside it means a scene broke or hung. */
function lengthOk(seconds) { return seconds >= LEN_MIN && seconds <= LEN_MAX; }

/* ---------------------------------------------------------------- the command (plain Node) ---------------------------------------------------------------- */

function ffmpegPath() { return process.env.FFMPEG || 'ffmpeg'; }
/** A child (ffmpeg, ffprobe) with no shell, the allow-listed environment and a time limit: at the limit it is killed and this throws (FR-175). */
function run(file, args, opts = {}) {
  const { execFileSync } = require('child_process');
  return execFileSync(file, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, shell: false, maxBuffer: 16 * 1024 * 1024, env: childEnv(), timeout: FFMPEG_MS, killSignal: 'SIGKILL', ...opts });
}
function hasFfmpeg() {
  try { return /ffmpeg version/.test(String(run(ffmpegPath(), ['-hide_banner', '-version'], { timeout: PROBE_MS }))); } catch { return false; }
}
function seconds(file) {
  const probe = process.env.FFPROBE || (process.env.FFMPEG ? path.join(path.dirname(process.env.FFMPEG), path.basename(process.env.FFMPEG).replace(/ffmpeg/i, 'ffprobe')) : 'ffprobe');
  try { return Number(String(run(probe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file], { timeout: PROBE_MS })).trim()); } catch { return NaN; }
}

async function main(argv = process.argv.slice(2), deps = {}) {
  const a = parseArgs(argv);
  if (a.list) { for (const [id, s] of Object.entries(SCENES)) console.log(`${id.padEnd(8)} ${s.title}: ${s.sub}`); return null; }
  const out = path.resolve(a.out);
  fs.mkdirSync(out, { recursive: true });
  const base = `release-${a.version}`;
  const finals = ['.mp4', '.gif', '.json'].map((x) => path.join(out, base + x));
  for (const f of finals) fs.rmSync(f, { force: true }); // FR-175: an old clip never stands in for a failed new one, even when this run is killed
  if (!(deps.hasFfmpeg || hasFfmpeg)()) throw new Error('ffmpeg was not found (install it, or set FFMPEG=<path>); no clip was made');
  if (!fs.existsSync(path.join(ROOT, 'dist', 'renderer', 'index.html'))) throw new Error('no build: run `npm run build` first');
  if (!(deps.ensure || require('./ensure-electron').ensureElectron)()) throw new Error('the Electron binary is not installed and could not be fetched');
  const frames = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-release-video-'));
  try {
    console.log(`release-video: ${a.version}, scenes ${a.scenes.join(', ')}, frames in ${frames}`);
    const runOne = deps.runOne || require('./ui-suite').runOne;
    const r = await runOne({ name: 'release-video', baseEnv: childEnv(), timeoutMs: RECORD_MS, killTree: true, env: { DURBAR_SIM_CLOCK: CLOCK, TZ: 'UTC', LANG: 'en_US.UTF-8', RV_VERSION: a.version, RV_SCENES: a.scenes.join(','), RV_COUNT: a.count === null ? '' : String(a.count) } }, frames);
    if (!r.ok) throw new Error(`the recording failed (${r.why || 'exit ' + r.code}):\n${r.log.split(/\r?\n/).filter((l) => l.trim()).slice(-20).join('\n')}`);
    const shot = JSON.parse(fs.readFileSync(path.join(frames, 'frames.json'), 'utf8'));
    fs.writeFileSync(path.join(frames, 'list.ffconcat'), concatList(shot.frames));
    const enc = deps.run || run;
    const mp4Part = path.join(out, base + '.part.mp4');
    enc(ffmpegPath(), mp4Args('list.ffconcat', mp4Part), { cwd: frames, timeout: FFMPEG_MS });
    let gif = null;
    for (const t of gifTries()) {
      const part = path.join(out, base + '.part.gif');
      enc(ffmpegPath(), gifArgs('list.ffconcat', part, t.width, t.colors), { cwd: frames, timeout: FFMPEG_MS });
      const bytes = fs.statSync(part).size;
      console.log(`release-video: GIF ${t.width} px, ${t.colors} colours: ${(bytes / 1048576).toFixed(2)} MB`);
      if (bytes <= GIF_MAX) { gif = { ...t, bytes, part }; break; }
      fs.rmSync(part, { force: true });
    }
    if (!gif) throw new Error(`the GIF stays over ${GIF_MAX / 1048576} MB at every size tried`);
    const mp4Bytes = fs.statSync(mp4Part).size;
    if (mp4Bytes > MP4_MAX) throw new Error(`the MP4 is ${(mp4Bytes / 1048576).toFixed(1)} MB, over ${MP4_MAX / 1048576} MB`);
    const len = shot.seconds;
    if (!lengthOk(len)) throw new Error(`the clip is ${len.toFixed(1)} s, outside ${LEN_MIN}-${LEN_MAX} s`);
    for (const s of shot.scenes) if (s.still) fs.copyFileSync(path.join(frames, s.still), path.join(out, `${base}-scene-${s.n}-${s.id}.${s.still.split('.').pop()}`));
    fs.renameSync(mp4Part, finals[0]);
    fs.renameSync(gif.part, finals[1]);
    const manifest = { version: a.version, seconds: Number(len.toFixed(1)), mp4: { file: path.basename(finals[0]), bytes: mp4Bytes, width: W, height: FRAME_H, fps: MP4_FPS, probedSeconds: seconds(finals[0]) },
      gif: { file: path.basename(finals[1]), bytes: gif.bytes, width: gif.width, colors: gif.colors, fps: FPS }, scenes: shot.scenes.map(({ id, title, sub, from, to }) => ({ id, title, sub, from, to })), privacy: shot.privacy };
    fs.writeFileSync(finals[2], JSON.stringify(manifest, null, 2) + '\n');
    console.log(`release-video: ${finals[0]} (${(mp4Bytes / 1048576).toFixed(2)} MB), ${finals[1]} (${(gif.bytes / 1048576).toFixed(2)} MB), ${len.toFixed(1)} s`);
    return manifest;
  } catch (e) {
    for (const f of [...finals, path.join(out, base + '.part.mp4'), path.join(out, base + '.part.gif')]) fs.rmSync(f, { force: true });
    throw e;
  } finally {
    if (!a.keepFrames) fs.rmSync(frames, { recursive: true, force: true });
    else console.log(`release-video: frames kept in ${frames}`);
  }
}

/* ---------------------------------------------------------------- the driver (Electron main) ---------------------------------------------------------------- */

async function driver(ctx) {
  const { helpers, jsLiteral } = require('./driver-helpers');
  const { nativeImage } = require('electron');
  const H = helpers(ctx);
  const out = process.env.OUT;
  if (!out) throw new Error('OUT is not set (start this through `node scripts/release-video.js`)');
  const vars = { version: process.env.RV_VERSION || '', count: process.env.RV_COUNT || null };
  const ids = String(process.env.RV_SCENES || DEFAULT_SCENES.join(',')).split(',').filter(Boolean);
  let redact = null;
  try { redact = require(path.join(ROOT, 'dist', 'shared', 'redact.js')).redact; } catch { /* checked below */ }
  if (typeof redact !== 'function') throw new Error('dist/shared/redact.js did not load: the privacy check cannot run, so no clip is made (FR-176)');
  const forbidden = forbiddenValues();
  const frames = [];
  const scenes = [];
  let n = 0, clipMs = 0;

  /* FR-172: the caption lives in its own band under the app frame (never over it), drawn by a second, offscreen window the size of
     the whole frame; title and end cards are that window's full frame. Its bitmap is taken again only when the caption changes. */
  const band = new (require('electron').BrowserWindow)({ show: false, useContentSize: true, width: W, height: FRAME_H, enableLargerThanScreen: true, webPreferences: { offscreen: true, sandbox: true, contextIsolation: true, javascript: true } });
  band.webContents.setFrameRate(10);
  band.setContentSize(W, FRAME_H); // larger than a small (xvfb) screen, like the app's own test window
  await band.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(BAND_HTML));
  let bandBmp = null, cardOn = false, capTitle = '', capSub = '';
  const paintBand = async () => {
    // the page resolves after two animation frames with the new text; then poll (50 ms, as `until` does) until two captures agree (FR-048b)
    await band.webContents.executeJavaScript(`window.setBand(${jsLiteral(capTitle)},${jsLiteral(capSub)},${cardOn})`);
    let img = null, prev = null;
    const end = Date.now() + 5000;
    for (;;) {
      band.webContents.invalidate();
      img = await band.webContents.capturePage();
      const bmp = img.toBitmap();
      if (prev && bmp.length === prev.length && bmp.equals(prev)) break;
      if (Date.now() > end) throw new Error('the caption band never settled');
      prev = bmp;
      await ctx.sleep(50);
    }
    const sz = img.getSize();
    if (!bandBmp) console.log(`[release-video] caption band window ${sz.width}x${sz.height} (${JSON.stringify(await band.webContents.executeJavaScript('[innerWidth,innerHeight,devicePixelRatio]'))})`);
    if (sz.width !== W || sz.height < FRAME_H) throw new Error(`the caption band window is ${sz.width}x${sz.height}, not ${W}x${FRAME_H}`);
    bandBmp = (sz.height === FRAME_H ? img : img.crop({ x: 0, y: 0, width: W, height: FRAME_H })).toBitmap(); // laid out from the top: a taller window only adds rows below
    if (bandBmp.length !== W * FRAME_H * 4) throw new Error(`the caption band has the wrong size (${sz.width}x${sz.height})`);
  };

  const S = {
    H,
    /** A fresh simulator page at 1440x900 (extra query values for the scene), calm: no toasts, the pointer off the controls. */
    async reset(query = {}) {
      await H.load({ w: W, h: H_, ready: 'fit', query });
      await H.office(query.simfloors === '1' ? 1 : 12);
      H.wc().sendInputEvent({ type: 'mouseMove', x: 1, y: 1 });
      await H.calm();
      await H.settle();
    },
    /** The caption in the band under the app (title, then where to find it). */
    async caption(title, sub) {
      capTitle = fill(title, vars); capSub = fill(sub, vars);
      await paintBand();
    },
    /** The full-frame title card (intro, outro) with the caption's text, or back to the app with the band. */
    async card(on) {
      cardOn = !!on;
      await paintBand();
    },
    async openSettings() {
      if (!(await H.js(`!!document.getElementById('chList')`))) await H.js(`document.getElementById('settingsBtn').click()`);
      if (!(await H.until(`!!document.getElementById('chList')&&!!document.getElementById('thList')`, 6000))) throw new Error('Settings did not open');
      await H.settle();
    },
    async closeSettings() {
      await H.js(`window.DurbarScreens.close()`);
      if (!(await H.until(`!document.getElementById('chList')`, 4000))) throw new Error('Settings did not close');
      await H.until(`!document.querySelector('.scene-out')`, 3000);
      await H.settle();
    },
    /** Scroll the Settings body (not the page) until heading `id` is near its top. */
    async scrollTo(id) {
      const inView = `(()=>{const sc=document.querySelector('#screen .scr-body'),h=document.getElementById(${jsLiteral(id)});if(!sc||!h)return false;const d=h.getBoundingClientRect().top-sc.getBoundingClientRect().top;if(Math.abs(d-8)>4&&sc.scrollTop+sc.clientHeight<sc.scrollHeight-1){sc.scrollTop+=d-8;return false;}return document.scrollingElement.scrollTop===0;})()`;
      if (!(await H.until(inView, 6000))) throw new Error(`could not scroll Settings to #${id}`);
      await H.settle();
    },
    /** Switch the theme through Settings (the real path) and come back to the office. */
    async pickTheme(id) {
      await this.openSettings();
      await H.js(`document.querySelector(${jsLiteral(`#thList [data-theme="${id}"]`)}).click()`);
      if (!(await H.until(`window.THEME.current().id===${jsLiteral(id)}`, 4000))) throw new Error(`theme ${id} not applied`);
      await H.clearToasts();
      await this.closeSettings();
      await H.office(12);
    },
    async pickCharacters(v) {
      await H.js(`document.querySelector(${jsLiteral(`#chList [data-characters="${v}"]`)}).click()`);
      if (!(await H.until(`window.THEME.characters()===${jsLiteral(v)}`, 4000))) throw new Error(`characters ${v} not applied`);
      await H.clearToasts();
    },
    /** A running Copilot chat whose MCP chip shows the strong warning (the simulator's `owner` figures, spec 100). */
    async openMcpChat() {
      const cands = await H.js(`window.__durbarSimUi.agents().filter(a=>a.live&&!a.parent&&(a.info&&a.info.adapterId||'copilot')==='copilot').map(a=>a.id)`);
      for (const id of cands) {
        const r = await H.js(`window.__durbarSimUi.bridge().agentMcp(${jsLiteral(id)})`);
        if (!(r && r.ok && r.live && (r.servers || []).filter((x) => x.status === 'connected').length >= 3)) continue;
        await H.js(`document.querySelector(${jsLiteral(`#stage .desk[data-id="${id}"]`)}).click()`);
        if (!(await H.until(`document.body.classList.contains('panel-open')&&!!document.querySelector('#mcpBtn .ct-mcpk')&&!!document.querySelector('.mcp-line')`, 10000))) throw new Error('mcp: the chip and its line did not show');
        H.wc().sendInputEvent({ type: 'mouseMove', x: 1, y: 1 });
        await H.settle();
        return;
      }
      throw new Error('mcp: no running Copilot chat with three connected servers');
    },
    /** Record `secs` seconds at FPS frames a second; the scene's text is checked first and last (FR-176). */
    async film(secs) {
      await this.check();
      const period = 1000 / FPS;
      const start = Date.now();
      let k = 0;
      while (Date.now() - start < secs * 1000) {
        const due = start + k * period;
        const wait = due - Date.now();
        if (wait > 0) await ctx.sleep(wait);
        let img = await H.wc().capturePage();
        const sz = img.getSize();
        if (sz.width !== W || sz.height !== H_) img = img.resize({ width: W, height: H_ }); // a scaled display: the frame stays 1440x900
        const bmp = composeFrame(cardOn ? null : img.toBitmap(), bandBmp, { card: cardOn });
        const file = `f${String(frames.length).padStart(5, '0')}.png`;
        fs.writeFileSync(path.join(out, file), nativeImage.createFromBitmap(bmp, { width: W, height: FRAME_H }).toPNG());
        frames.push({ file, t: clipMs + (Date.now() - start) });
        k++;
      }
      clipMs += Date.now() - start; // the clip's clock runs only while filming
      await this.check();
    },
    async check() {
      const text = await H.js(`(()=>{const parts=[document.body.innerText];for(const e of document.querySelectorAll('[title],[aria-label],[alt],[placeholder]'))for(const a of ['title','aria-label','alt','placeholder'])if(e.hasAttribute(a))parts.push(e.getAttribute(a));
        for(const i of document.querySelectorAll('input,textarea'))parts.push(i.value||'');return parts.join('\\n');})()`);
      const hits = privacyProblems(text, forbidden, redact);
      if (hits.length) throw new Error(`privacy check failed in scene ${scenes.length ? scenes[scenes.length - 1].id : '?'}: ${hits.join(', ')}; no clip is made (FR-176)`);
    },
  };

  for (const id of ids) {
    const sc = SCENES[id];
    if (!sc) throw new Error(`unknown scene ${id}`);
    n++;
    const rec = { n: String(n).padStart(2, '0'), id, title: fill(sc.title, vars), sub: fill(sc.sub, vars), from: Number((clipMs / 1000).toFixed(2)), firstFrame: frames.length };
    scenes.push(rec);
    // the caption is set by reset() callers through `S.caption`; put it on after every reset (a reload drops it)
    const reset = S.reset.bind(S);
    S.reset = async (q) => { await reset(q); await S.caption(sc.title, sc.sub); };
    await sc.play(S);
    S.reset = reset;
    rec.to = Number((clipMs / 1000).toFixed(2));
    if (frames.length === rec.firstFrame) throw new Error(`scene ${id} filmed nothing`);
    rec.still = frames[Math.min(frames.length - 1, rec.firstFrame + Math.floor((frames.length - rec.firstFrame) * 0.6))].file;
    console.log(`[release-video] ${rec.n} ${id}: ${rec.from}-${rec.to} s, ${frames.length - rec.firstFrame} frames`);
  }
  band.destroy();
  fs.writeFileSync(path.join(out, 'frames.json'), JSON.stringify({ seconds: clipMs / 1000, frames, scenes, privacy: { checked: scenes.length * 2, values: forbidden.length, redact: true } }));
  console.log(`[release-video] ${frames.length} frames, ${(clipMs / 1000).toFixed(1)} s`);
}

module.exports = driver;
Object.assign(module.exports, { ENV_ALLOW, RECORD_MS, FFMPEG_MS, childEnv, gitEmail, run, W, H_, BAND, FRAME_H, composeFrame, SCENES, DEFAULT_SCENES, VERSION_RE, FPS, GIF_MAX, MP4_MAX, parseArgs, fill, forbiddenValues, privacyProblems, concatList, mp4Args, gifArgs, gifTries, lengthOk, main });
if (require.main === module) main().catch((e) => { console.error('release-video:', e.message); process.exitCode = 1; });
