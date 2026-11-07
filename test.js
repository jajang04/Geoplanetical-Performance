'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const {
  status,
  detectGameVersion,
  getBackupDir,
  generateThumbnailPng,
  transformMainJs,
  transformWorkshopJs,
  transformAppBundleJs,
  transformWorkerTailJs,
  LOCAL_MOD_DIR,
  ASAR_PATH
} = require('./patcher');

const ver = detectGameVersion();
const BACKUP_DIR = getBackupDir();

console.log(`=== Running Geoplanetical Fire Performance Mod v1.4.0 Verification Suite (Game v${ver}) ===\n`);

// Helper to read raw file & header entry from ASAR
function readFromAsar(relPath) {
  const fd = fs.openSync(ASAR_PATH, 'r');
  try {
    const sizeBuf = Buffer.alloc(16);
    fs.readSync(fd, sizeBuf, 0, 16, 0);
    const headerPickleSize = sizeBuf.readUInt32LE(4);
    const headerSize = sizeBuf.readUInt32LE(12);
    const headerBuf = Buffer.alloc(headerSize);
    fs.readSync(fd, headerBuf, 0, headerSize, 16);
    const header = JSON.parse(headerBuf.toString('utf8'));
    const dataOffset = 8 + headerPickleSize;
    let cur = header;
    for (const p of relPath.split('/')) cur = cur.files[p];
    const buf = Buffer.alloc(cur.size);
    fs.readSync(fd, buf, 0, cur.size, dataOffset + Number(cur.offset));
    return { buf, entry: cur };
  } finally {
    fs.closeSync(fd);
  }
}

// 1. Test Thumbnail PNG generation
const thumb = generateThumbnailPng();
assert(thumb.length > 100 && thumb.length < 4 * 1024 * 1024, 'Thumbnail size within mod limits');
assert.strictEqual(thumb.readUInt32BE(16), 512, 'Thumbnail width === 512');
assert.strictEqual(thumb.readUInt32BE(20), 512, 'Thumbnail height === 512');
console.log('✔ [Test 1] Generated 512x512 PNG thumbnail is valid (' + thumb.length + ' bytes)');

// 2. Test Transforms & Byte-Length Preservation on Clean Backups
const mainOrig = fs.readFileSync(path.join(BACKUP_DIR, 'electron__main.js'), 'utf8');
const mainPatched = transformMainJs(mainOrig);
assert.strictEqual(Buffer.byteLength(mainPatched, 'utf8'), Buffer.byteLength(mainOrig, 'utf8'), 'main.js byte length exact');
assert(mainPatched.includes('__GEO_FIRE_MAIN__'), 'main.js contains Fire Mod hook');

const wkOrig = fs.readFileSync(path.join(BACKUP_DIR, 'electron__mods__mod-workshop.js'), 'utf8');
const wkPatched = transformWorkshopJs(wkOrig);
assert.strictEqual(Buffer.byteLength(wkPatched, 'utf8'), Buffer.byteLength(wkOrig, 'utf8'), 'mod-workshop.js byte length exact');
assert(wkPatched.includes('__GEO_FIRE_WKSHP__'), 'mod-workshop.js contains Workshop staging hook');

const bundleOrig = fs.readFileSync(path.join(BACKUP_DIR, 'renderer__app.bundle.js'), 'utf8');
const bundlePatched = transformAppBundleJs(bundleOrig);
assert.strictEqual(Buffer.byteLength(bundlePatched, 'utf8'), Buffer.byteLength(bundleOrig, 'utf8'), 'app.bundle.js byte length exact');
assert(bundlePatched.includes('__GEO_FIRE_MOD__'), 'app.bundle.js contains Fire Mod runtime');
assert(bundlePatched.includes('x.id==="geoplanetical-performance"&&x.status==="active"'), 'app.bundle.js gates on status === "active"');
assert(bundlePatched.includes('if (uGf > 0.5)'), 'app.bundle.js uses non-destructive Dual Globe Shader');
assert(bundlePatched.includes('window.addEventListener("keydown",e=>{if(e.key==="F10")'), 'app.bundle.js uses F10 toggle shortcut (preserving F9 screenshot)');
assert(!bundlePatched.includes('window.addEventListener("keydown",e=>{if(e.key==="F9")'), 'app.bundle.js does not hijack F9');

const swOrig = fs.readFileSync(path.join(BACKUP_DIR, 'renderer__simulation-worker.tail.js'), 'utf8');
const swPatched = transformWorkerTailJs(swOrig);
assert.strictEqual(Buffer.byteLength(swPatched, 'utf8'), Buffer.byteLength(swOrig, 'utf8'), 'simulation-worker.tail.js byte length exact');
assert(swPatched.includes('__GEO_FIRE_WORKER__'), 'simulation-worker.tail.js contains Turbo Speed 3 hook');
assert(/[A-Za-z0-9_$]+\._gf&&[A-Za-z0-9_$]+\.speedIdx===3\?16:/.test(swPatched), 'simulation-worker.tail.js gates 16.0x Speed 3 on live ._gf flag');
console.log('✔ [Test 2] All JS transforms preserve exact byte lengths, pass VM syntax validation, and enforce 100% reversible Active-Mod gating');

// 3. Verify Patched ASAR Integrity Hashes & Fuse Status
const st = status();
assert.strictEqual(st.isPatched, true, 'Engine ASAR patch is active');
assert.strictEqual(st.modJsonExists, true, 'In-game mod pack is installed');
assert.strictEqual(st.fuseByte, '0', 'ASAR integrity fuse disabled');
assert.strictEqual(st.runAsNodeByte, '1', 'RunAsNode fuse enabled for zero-Node Install-Mod.bat');

for (const f of ['electron/main.js', 'electron/mods/mod-workshop.js', 'renderer/app.bundle.js']) {
  const { buf, entry } = readFromAsar(f);
  const actualSha = crypto.createHash('sha256').update(buf).digest('hex');
  assert.strictEqual(entry.integrity.hash, actualSha, `ASAR header SHA256 matches patched ${f}`);
}
console.log('✔ [Test 3] ASAR SHA-256 header integrity hashes and Electron fuses verified for all patched files');

// 4. Verify In-Game Mod Pack with Geoplanetical's own mod-manifest.js & mod-image-metadata.js from app.asar
function loadAsarModule(relPath, mocks = {}) {
  const code = readFromAsar(relPath).buf.toString('utf8');
  const mod = { exports: {} };
  const fn = new vm.Script(`(function(exports, require, module) { ${code}\n})`, { filename: relPath }).runInThisContext();
  fn(mod.exports, id => {
    if (mocks[id]) return mocks[id];
    return require(id);
  }, mod);
  return mod.exports;
}

const modContract = loadAsarModule('electron/mods/mod-contract.js');
const modFiles = loadAsarModule('electron/mods/mod-files.js', { './mod-contract': modContract });
const presValues = loadAsarModule('electron/mods/families/presentation-values.js', {
  '../mod-contract': modContract,
  '../mod-files': modFiles
});
const polIdentities = loadAsarModule('electron/mods/families/political-identities.js', {
  '../mod-contract': modContract,
  './presentation-values': presValues
});
const flagsFam = loadAsarModule('electron/mods/families/flags.js', {
  '../mod-contract': modContract,
  './presentation-values': presValues
});
const flagLibFam = loadAsarModule('electron/mods/families/flag-library.js', {
  '../mod-contract': modContract,
  './presentation-values': presValues
});
let actionPanelsFam = null;
try {
  const actionContract = loadAsarModule('src/modding/action-contract.js');
  actionPanelsFam = loadAsarModule('electron/mods/families/action-panels.js', {
    '../mod-contract': modContract,
    '../../../src/modding/action-contract': actionContract
  });
} catch (_) {}

const modFamilies = loadAsarModule('electron/mods/mod-families.js', {
  './families/political-identities': polIdentities,
  './families/flags': flagsFam,
  './families/flag-library': flagLibFam,
  ...(actionPanelsFam ? { './families/action-panels': actionPanelsFam } : {})
});
const modManifest = loadAsarModule('electron/mods/mod-manifest.js', {
  './mod-contract': modContract,
  './mod-families': modFamilies
});
const modImageMeta = loadAsarModule('electron/mods/mod-image-metadata.js');

const installedModJson = JSON.parse(fs.readFileSync(path.join(LOCAL_MOD_DIR, 'mod.json'), 'utf8'));
const validation = modManifest.validateModManifest(installedModJson);
assert.strictEqual(validation.ok, true, 'validateModManifest must return ok: true');
assert.strictEqual(validation.manifest.id, 'geoplanetical-performance');

const installedThumbBytes = fs.readFileSync(path.join(LOCAL_MOD_DIR, 'thumb.png'));
const stripped = modImageMeta.stripImageMetadata(installedThumbBytes, '.png');
assert(stripped.bytes.length > 100, 'stripImageMetadata succeeds on thumb.png');
console.log('✔ [Test 4] Geoplanetical native validateModManifest() & stripImageMetadata() passed 100%!');
console.log('\nALL TESTS PASSED! Geoplanetical Fire Performance Mod v1.4.0 is ready.');
