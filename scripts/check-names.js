// Spec 008 FR-040..FR-045: fail unless the packed app carries the expected display names and identity.
// Expected values come from package.json (build.productName, build.appId, name, desktopName), never from literals here.
// Usage: node scripts/check-names.js   (checks every packed build of this platform under release/)
//   all OSes  app.asar/package.json: name = package name, no top-level productName (it would move the profile folder and the Keychain name)
//   linux     release/linux-unpacked/<name>; when release/*.AppImage exists, its .desktop (Name, Exec, Icon, StartupWMClass)
//   win32     release/win-unpacked/<productName>.exe, version resource ProductName and FileDescription
//   darwin    release/mac*/<productName>.app/Contents/Info.plist CFBundleName, CFBundleDisplayName, CFBundleExecutable, CFBundleIdentifier
// The compare* functions are pure and self-tested by `npm run test:checknames`.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

/** What the package must show, from a parsed package.json. */
function expectedOf(pkg) {
  const productName = pkg.build && pkg.build.productName;
  const appId = pkg.build && pkg.build.appId;
  if (!productName || !appId || !pkg.name || !pkg.desktopName) throw new Error('package.json needs name, desktopName, build.productName and build.appId');
  return { name: pkg.name, version: pkg.version, productName, appId, desktopId: pkg.desktopName.replace(/\.desktop$/, '') };
}

/** The packed app.asar/package.json: same name, no top-level productName. Returns a list of problems. */
function compareAsarPackage(asarPkg, exp) {
  const bad = [];
  if (asarPkg.name !== exp.name) bad.push(`app.asar package.json name is ${JSON.stringify(asarPkg.name)}, expected ${JSON.stringify(exp.name)}`);
  if (asarPkg.productName !== undefined) bad.push(`app.asar package.json has a top-level productName (${JSON.stringify(asarPkg.productName)}); it would move the profile folder and the Keychain name`);
  if (asarPkg.desktopName !== `${exp.desktopId}.desktop`) bad.push(`app.asar package.json desktopName is ${JSON.stringify(asarPkg.desktopName)}, expected ${JSON.stringify(exp.desktopId + '.desktop')}`);
  return bad;
}

/** Value of a key in the [Desktop Entry] section of a .desktop file's text. */
function desktopField(text, key) {
  let inEntry = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^\[.*\]\s*$/.test(line)) inEntry = line.trim() === '[Desktop Entry]';
    else if (inEntry && line.startsWith(key + '=')) return line.slice(key.length + 1);
  }
  return undefined;
}

/** The AppImage's .desktop text: Name, StartupWMClass, Icon, and Exec without a forced --no-sandbox (FR-041). */
function compareDesktop(text, exp) {
  const bad = [];
  const want = { Name: exp.productName, StartupWMClass: exp.desktopId, Icon: exp.desktopId, Exec: 'AppRun %U' };
  for (const [k, v] of Object.entries(want)) {
    const got = desktopField(text, k);
    if (got !== v) bad.push(`.desktop ${k}= is ${JSON.stringify(got)}, expected ${JSON.stringify(v)}`);
  }
  return bad;
}

/** Windows version resource strings ({ ProductName, FileDescription, ... }). */
function compareVersionStrings(strings, exp) {
  const bad = [];
  for (const k of ['ProductName', 'FileDescription']) if (strings[k] !== exp.productName) bad.push(`exe ${k} is ${JSON.stringify(strings[k])}, expected ${JSON.stringify(exp.productName)}`);
  return bad;
}

/** A parsed Info.plist object. */
function comparePlist(info, exp) {
  const bad = [];
  const want = { CFBundleName: exp.productName, CFBundleDisplayName: exp.productName, CFBundleExecutable: exp.productName, CFBundleIdentifier: exp.appId };
  for (const [k, v] of Object.entries(want)) if (info[k] !== v) bad.push(`Info.plist ${k} is ${JSON.stringify(info[k])}, expected ${JSON.stringify(v)}`);
  return bad;
}

function listDirs(dir, re) {
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter((d) => re.test(d)).sort().map((d) => path.join(dir, d)) : [];
}

function readAsarPackage(asarFile) {
  const asar = require('@electron/asar');
  return JSON.parse(asar.extractFile(asarFile, 'package.json').toString('utf8'));
}

function readExeStrings(exeFile) {
  const ResEdit = require('resedit');
  const exe = ResEdit.NtExecutable.from(fs.readFileSync(exeFile));
  const res = ResEdit.NtExecutableResource.from(exe);
  const infos = ResEdit.Resource.VersionInfo.fromEntries(res.entries);
  if (!infos.length) return {};
  const lang = infos[0].getAllLanguagesForStringValues()[0];
  return lang ? infos[0].getStringValues(lang) : {};
}

/** Extracts the .desktop file of an AppImage into a fresh temp folder (fixed arguments, no shell). */
function readAppImageDesktop(image) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-names-'));
  try {
    fs.chmodSync(image, 0o755);
    const r = spawnSync(image, ['--appimage-extract', '*.desktop'], { cwd: tmp, encoding: 'utf8', timeout: 120000 });
    const root = path.join(tmp, 'squashfs-root');
    const desk = fs.existsSync(root) ? fs.readdirSync(root).find((f) => f.endsWith('.desktop')) : undefined;
    if (!desk) throw new Error(`no .desktop file in ${path.basename(image)} (exit ${r.status}): ${(r.stderr || '').slice(-300)}`);
    return { file: desk, text: fs.readFileSync(path.join(root, desk), 'utf8') };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/** Runs every check for `platform`; returns { problems, notes }. `release` is the output folder. */
function checkRelease(platform, release, exp) {
  const problems = [];
  const notes = [];
  const need = (file) => { if (!fs.existsSync(file)) { problems.push(`missing ${file}`); return false; } return true; };
  const asarCheck = (asarFile) => {
    if (!need(asarFile)) return;
    const bad = compareAsarPackage(readAsarPackage(asarFile), exp);
    problems.push(...bad.map((b) => `${path.relative(release, asarFile)}: ${b}`));
    notes.push(`${path.relative(release, asarFile)} package.json name/productName/desktopName`);
  };
  if (platform === 'linux') {
    const dir = path.join(release, 'linux-unpacked');
    need(path.join(dir, exp.name));
    asarCheck(path.join(dir, 'resources', 'app.asar'));
    // only AppImages of this version (artifactName Agent-Durbar-<version>-<arch>.AppImage); an older one left in release/ is ignored and named
    const all = fs.existsSync(release) ? fs.readdirSync(release).filter((f) => f.endsWith('.AppImage')) : [];
    const images = all.filter((f) => f.includes(`-${exp.version}-`));
    for (const old of all.filter((f) => !images.includes(f))) notes.push(`${old} skipped (not version ${exp.version})`);
    for (const img of images) {
      const d = readAppImageDesktop(path.join(release, img));
      problems.push(...compareDesktop(d.text, exp).map((b) => `${img} ${d.file}: ${b}`));
      notes.push(`${img} ${d.file}`);
    }
  } else if (platform === 'win32') {
    const dir = path.join(release, 'win-unpacked');
    const exe = path.join(dir, `${exp.productName}.exe`);
    if (need(exe)) {
      problems.push(...compareVersionStrings(readExeStrings(exe), exp).map((b) => `${path.basename(exe)}: ${b}`));
      notes.push(`${path.basename(exe)} version resource`);
    }
    asarCheck(path.join(dir, 'resources', 'app.asar'));
  } else if (platform === 'darwin') {
    const apps = listDirs(release, /^mac/).map((d) => path.join(d, `${exp.productName}.app`)).filter((a) => fs.existsSync(a));
    if (!apps.length) problems.push(`no ${exp.productName}.app under ${release}/mac*`);
    for (const app of apps) {
      const info = require('plist').parse(fs.readFileSync(path.join(app, 'Contents', 'Info.plist'), 'utf8'));
      problems.push(...comparePlist(info, exp).map((b) => `${path.relative(release, app)}: ${b}`));
      notes.push(`${path.relative(release, app)} Info.plist`);
      asarCheck(path.join(app, 'Contents', 'Resources', 'app.asar'));
    }
  } else {
    problems.push(`no names check for platform ${platform}`);
  }
  return { problems, notes };
}

module.exports = { expectedOf, compareAsarPackage, compareDesktop, desktopField, compareVersionStrings, comparePlist, checkRelease };

if (require.main === module) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
    const { problems, notes } = checkRelease(process.platform, path.resolve('release'), expectedOf(pkg));
    if (problems.length) {
      for (const p of problems) console.error(`  FAIL ${p}`);
      console.error(`check-names: ${problems.length} difference(s) from spec 008 FR-040..FR-045`);
      process.exit(1);
    }
    if (!notes.length) {
      console.error(`check-names: nothing was checked on ${process.platform}; run "npm run pack:dir" first.`);
      process.exit(1);
    }
    for (const n of notes) console.log(`  ok   ${n}`);
    console.log('check-names ok');
  } catch (e) {
    console.error('check-names:', e.message);
    process.exit(1);
  }
}
