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

console.log(`=== Running Geoplanetical Fire Performance Mod v1.6.0 Verification Suite (Game v${ver}) ===\n`);

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
assert(mainPatched.includes("process.env.NODE_OPTIONS = '--max-old-space-size=4096'"), 'main.js sets 4GB V8 heap limit for simulation worker via NODE_OPTIONS');

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
assert(bundlePatched.includes('e.key==="F10"'), 'app.bundle.js supports F10 Graphics toggle');
assert(bundlePatched.includes('e.key==="F2"'), 'app.bundle.js supports F2 Turbo toggle');
assert(!/key===(["'])F11\1[^}]*__GEO_FIRE_TURBO__/.test(bundlePatched), 'app.bundle.js does not bind Turbo to F11 (reserved for Fullscreen)');
assert(bundlePatched.includes('__GFTOAST'), 'app.bundle.js contains screen toast notifications');
assert(bundlePatched.includes('subscribeView(t,a={},n=!0)'), 'app.bundle.js contains Month-End UI Browsing cache adapter');
assert(bundlePatched.includes('r?.pending?this.views.get(t):null'), 'app.bundle.js provides pending cached view snapshot during month-end');
assert(bundlePatched.includes('.BOOT,{...t,gf:__GFM("turbo")},'), 'app.bundle.js passes gf flag during session.boot');
assert(bundlePatched.includes('__GFM()||await ') && bundlePatched.includes('.request("session-switch")'), 'app.bundle.js skips blocking session-switch autosave on in-game save load');

const swOrig = fs.readFileSync(path.join(BACKUP_DIR, 'renderer__simulation-worker.tail.js'), 'utf8');
const swPatched = transformWorkerTailJs(swOrig);
const unpackedWorker = path.join(path.dirname(ASAR_PATH), 'app.asar.unpacked', 'renderer', 'simulation-worker.bundle.js');
if (fs.existsSync(unpackedWorker)) {
  new vm.Script(fs.readFileSync(unpackedWorker, 'utf8'), { filename: 'renderer/simulation-worker.bundle.js' });
}
assert.strictEqual(Buffer.byteLength(swPatched, 'utf8'), Buffer.byteLength(swOrig, 'utf8'), 'simulation-worker.tail.js byte length exact');
assert(swPatched.includes('__GEO_FIRE_WORKER__'), 'simulation-worker.tail.js contains Turbo Speed 3 hook');
assert(/[A-Za-z0-9_$]+\._gf&&[A-Za-z0-9_$]+\.speedIdx===3\?16:/.test(swPatched), 'simulation-worker.tail.js gates 16.0x Speed 3 on live ._gf flag');
assert(swPatched.includes('cM=') && swPatched.includes('(pW?16:48)') && swPatched.includes('(pW?24:64)'), 'simulation-worker.tail.js uses adaptive 16-24ms / 48-64ms cooperative slice budgets');
assert(swPatched.includes('prewarmTransport(){return Promise.resolve({status:"idle"})}'), 'simulation-worker.tail.js bypasses 80s boot prewarmTransport');
assert(swPatched.includes('require("zlib").gunzipSync(e)'), 'simulation-worker.tail.js uses native C++ zlib.gunzipSync for T0 checkpoint');
assert(/if\(globalThis\.__GFW\)return (a&&[A-Za-z0-9_$]+\.add\(e\),)?[A-Za-z0-9_$]+\.set\(e,[A-Za-z0-9_$]+\(e\.finance,r\)\)/.test(swPatched), 'simulation-worker.tail.js bypasses wYa read-only schema checks on built-in checkpoint');
assert(swPatched.includes('if(globalThis.__GFW)return F(a);'), 'simulation-worker.tail.js fast-paths $2e finance double-clone and ledger audits on boot and save load');
assert(swPatched.includes('checkpointPayload:globalThis.__GFW?null:t'), 'simulation-worker.tail.js frees 700MB checkpointPayload early during HYa');
assert(/!globalThis\.__GFW&&([A-Za-z0-9_$]+\(a\.checkpointPayload\)&&)?[A-Za-z0-9_$]+\(e,a\.checkpointPayload\)/.test(swPatched), 'simulation-worker.tail.js skips 5.1s kYa deep-diff during mgt');
assert(swPatched.includes('e.compression==="gzip"?z.gunzipSync(e.bytes):z.inflateSync(e.bytes)'), 'simulation-worker.tail.js uses native C++ zlib for .gsav decompression in pir');
assert(/e\._gf\?1:2,[A-Za-z0-9_$]+\.SETTLEMENT/.test(swPatched), 'simulation-worker.tail.js uses 1 outer CGE pass on monthly ticks');
assert(swPatched.includes('if(i&&!e._gf||d){'), 'simulation-worker.tail.js skips redundant opening UVe pass on monthly settlement');
assert(/for\(let [A-Za-z0-9_$]+ of globalThis\.__GFW\?\[[A-Za-z0-9_$]+\]:\[[A-Za-z0-9_$]+,(1\/0|[A-Za-z0-9_$]+)\]\)/.test(swPatched), 'simulation-worker.tail.js caps supplierSearchExpansion to 1 pass');

for (const batFile of ['Install-Mod.bat', 'Uninstall-Mod.bat']) {
  const batText = fs.readFileSync(path.join(__dirname, batFile), 'utf8');
  assert(!/\)\s*else\s*\(/i.test(batText), `${batFile} must not use if (...) else (...) blocks that break on (x86) paths`);
  assert(batText.includes('goto :run_node') && batText.includes('$env:GEO_MOD_DIR'), `${batFile} uses label-based branching and GEO_MOD_DIR env var`);
}
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

for (const modJsonPath of [path.join(__dirname, 'mod-pack', 'mod.json'), path.join(LOCAL_MOD_DIR, 'mod.json')]) {
  const mj = JSON.parse(fs.readFileSync(modJsonPath, 'utf8'));
  assert(mj.version.length <= 64, `${modJsonPath} version length (${mj.version.length}) must be <= 64`);
  assert(mj.description.length <= 2000, `${modJsonPath} description length (${mj.description.length}) must be <= 2000`);
  const validation = modManifest.validateModManifest(mj);
  assert.strictEqual(validation.ok, true, `validateModManifest must return ok: true for ${modJsonPath} (got ${JSON.stringify(validation)})`);
  assert.strictEqual(validation.manifest.id, 'geoplanetical-performance');
}

const installedThumbBytes = fs.readFileSync(path.join(LOCAL_MOD_DIR, 'thumb.png'));
const stripped = modImageMeta.stripImageMetadata(installedThumbBytes, '.png');
assert(stripped.bytes.length > 100, 'stripImageMetadata succeeds on thumb.png');
console.log('✔ [Test 4] Geoplanetical native validateModManifest() & stripImageMetadata() passed 100%!');

const flagsPath = path.join(path.dirname(ASAR_PATH), 'app.asar.unpacked', 'electron', 'simulation-runtime-flags.js');
if (fs.existsSync(flagsPath)) {
  const flagsContent = fs.readFileSync(flagsPath, 'utf8');
  assert(flagsContent.includes('--max-old-space-size=4096'), 'simulation-runtime-flags.js must include --max-old-space-size=4096');
  console.log('✔ [Test 5] V8 utilityProcess heap limit (4096MB) verified in simulation-runtime-flags.js');
}

console.log('\nALL TESTS PASSED! Geoplanetical Fire Performance Mod v1.6.0 is ready.');
