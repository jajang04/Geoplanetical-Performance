#!/usr/bin/env node
'use strict';
process.noAsar = true;

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const vm = require('vm');
const os = require('os');

// ── 0. Auto-Detect Steam Game Directory (Works from Workshop folder or anywhere) ──
function resolveGameDir() {
  const candidates = [
    process.env.GEO_GAME_DIR,
    // Relative path when running inside steamapps/workshop/content/4137120/<itemId>/
    path.resolve(__dirname, '..', '..', '..', '..', 'common', 'Geoplanetical'),
    'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Geoplanetical',
    'C:\\Program Files\\Steam\\steamapps\\common\\Geoplanetical',
    'D:\\SteamLibrary\\steamapps\\common\\Geoplanetical',
    'E:\\SteamLibrary\\steamapps\\common\\Geoplanetical',
    'F:\\SteamLibrary\\steamapps\\common\\Geoplanetical'
  ];
  for (const steamRoot of ['C:\\Program Files (x86)\\Steam', 'C:\\Program Files\\Steam']) {
    try {
      const vdf = fs.readFileSync(path.join(steamRoot, 'steamapps', 'libraryfolders.vdf'), 'utf8');
      for (const m of vdf.matchAll(/"path"\s+"([^"]+)"/g)) {
        candidates.push(path.join(m[1].replace(/\\\\/g, '\\'), 'steamapps', 'common', 'Geoplanetical'));
      }
    } catch (_) {}
  }
  for (const dir of candidates.filter(Boolean)) {
    if (fs.existsSync(path.join(dir, 'resources', 'app.asar'))) {
      return dir;
    }
  }
  return 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Geoplanetical';
}

const GAME_DIR = resolveGameDir();
const ASAR_PATH = path.join(GAME_DIR, 'resources', 'app.asar');
const UNPACKED_DIR = path.join(GAME_DIR, 'resources', 'app.asar.unpacked');
const EXE_PATH = path.join(GAME_DIR, 'Geoplanetical.exe');
const APPDATA_DIR = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
const USER_DATA_DIR = path.join(APPDATA_DIR, 'Geoplanetical');
const LOCAL_MOD_DIR = path.join(USER_DATA_DIR, 'mods', 'geoplanetical-performance');
const MOD_PACK_DIR = path.join(__dirname, 'mod-pack');
const SHARED_BACKUP_ROOT = path.join(USER_DATA_DIR, 'backups');

const FUSE_SENTINEL = Buffer.from('dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX');
const BLOCK_SIZE = 4 * 1024 * 1024; // 4 MiB SHA256 integrity block size in ASAR

// ── 1. Read ASAR Header & Dynamic Game Version ──
function readAsarHeader(fd) {
  const sizeBuf = Buffer.alloc(16);
  fs.readSync(fd, sizeBuf, 0, 16, 0);
  const headerPickleSize = sizeBuf.readUInt32LE(4);
  const headerSize = sizeBuf.readUInt32LE(12);
  const headerBuf = Buffer.alloc(headerSize);
  fs.readSync(fd, headerBuf, 0, headerSize, 16);
  const header = JSON.parse(headerBuf.toString('utf8'));
  const dataOffset = 8 + headerPickleSize;
  return { sizeBuf, headerPickleSize, headerSize, headerBuf, header, dataOffset };
}

function getAsarEntry(header, relPath) {
  const parts = relPath.split('/');
  let cur = header;
  for (const part of parts) {
    cur = cur.files[part];
    if (!cur) throw new Error(`ASAR entry not found: ${relPath}`);
  }
  return cur;
}

function detectGameVersion() {
  const fd = fs.openSync(ASAR_PATH, 'r');
  try {
    const { header, dataOffset } = readAsarHeader(fd);
    const pkgEntry = getAsarEntry(header, 'package.json');
    const buf = Buffer.alloc(pkgEntry.size);
    fs.readSync(fd, buf, 0, pkgEntry.size, dataOffset + Number(pkgEntry.offset));
    const pkg = JSON.parse(buf.toString('utf8'));
    return pkg.version || 'unknown';
  } finally {
    fs.closeSync(fd);
  }
}

function getBackupDir() {
  const ver = detectGameVersion();
  const localDir = path.join(__dirname, 'backups', `v${ver}`);
  const sharedDir = path.join(SHARED_BACKUP_ROOT, `v${ver}`);
  if (fs.existsSync(path.join(localDir, 'electron__main.js'))) return localDir;
  if (fs.existsSync(path.join(sharedDir, 'electron__main.js'))) return sharedDir;
  return localDir;
}

function mirrorBackupFile(srcFile) {
  try {
    const ver = detectGameVersion();
    const sharedDir = path.join(SHARED_BACKUP_ROOT, `v${ver}`);
    fs.mkdirSync(sharedDir, { recursive: true });
    const destFile = path.join(sharedDir, path.basename(srcFile));
    if (path.resolve(srcFile) !== path.resolve(destFile)) {
      fs.copyFileSync(srcFile, destFile);
    }
  } catch (_) {}
}

// ── 2. Generate Valid 512x512 PNG Thumbnail for Mod Manager & Steam Workshop ──
function pngChunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0);
  return Buffer.concat([head, data, crc]);
}

function generateThumbnailPng() {
  const width = 512, height = 512;
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // 8-bit
  ihdr[9] = 2; // RGB truecolor
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const raw = Buffer.alloc(height * (1 + width * 3));
  const cx = width / 2, cy = height / 2;
  for (let y = 0; y < height; y++) {
    const rowOff = y * (1 + width * 3);
    raw[rowOff] = 0; // filter type 0
    for (let x = 0; x < width; x++) {
      const dx = (x - cx) / 220;
      const dy = (y - cy) / 220;
      const r2 = dx * dx + dy * dy;
      let r = 8, g = 14, b = 26;
      if (r2 < 0.85) {
        const ring = Math.exp(-Math.pow(Math.sqrt(r2) - 0.62, 2) / 0.012);
        const core = Math.max(0, 1 - r2 * 1.3);
        const flame = Math.max(0, Math.sin(x * 0.045 + y * 0.03) * 0.5 + 0.5) * core;
        r = Math.min(255, Math.round(14 + 240 * ring + 235 * flame));
        g = Math.min(255, Math.round(24 + 135 * ring + 95 * flame * core));
        b = Math.min(255, Math.round(44 + 25 * ring + 18 * flame));
      }
      if (x < 10 || x >= width - 10 || y < 10 || y >= height - 10) {
        r = 255; g = 110; b = 24;
      }
      const p = rowOff + 1 + x * 3;
      raw[p] = r;
      raw[p + 1] = g;
      raw[p + 2] = b;
    }
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    sig,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
}

// ── 3. Byte-Exact Padding & Regex Replacement Helpers ──
function padToExactBytes(modifiedStr, targetBytes, padToken, label) {
  const tokenIdx = modifiedStr.indexOf(padToken);
  if (tokenIdx === -1) {
    throw new Error(`[${label}] Missing pad token ${padToken}`);
  }
  const withoutTokenBytes = Buffer.byteLength(modifiedStr, 'utf8') - Buffer.byteLength(padToken, 'utf8');
  const diff = targetBytes - withoutTokenBytes;
  if (diff < 0) {
    throw new Error(`[${label}] Patched content is ${-diff} bytes TOO LONG (${withoutTokenBytes} > ${targetBytes})`);
  }
  const padStr = '/*' + ' '.repeat(Math.max(0, diff - 4)) + '*/';
  const finalStr = modifiedStr.replace(padToken, diff >= 4 ? padStr : ' '.repeat(diff));
  const finalBytes = Buffer.byteLength(finalStr, 'utf8');
  if (finalBytes !== targetBytes) {
    throw new Error(`[${label}] Byte mismatch after padding (${finalBytes} !== ${targetBytes})`);
  }
  return finalStr;
}

function replaceOnceRegex(src, label, regex, replacer, anchor = null, minOffset = 0) {
  if (anchor) {
    const aIdx = src.indexOf(anchor, minOffset);
    if (aIdx === -1) throw new Error(`Missing anchor "${anchor}" for [${label}]`);
    const winStart = Math.max(0, aIdx - 1200);
    const winEnd = Math.min(src.length, aIdx + anchor.length + 1800);
    const slice = src.slice(winStart, winEnd);
    const m = slice.match(regex);
    if (!m) throw new Error(`Missing pattern around anchor "${anchor}" for [${label}]`);
    const replacedSlice = slice.replace(regex, replacer);
    return src.slice(0, winStart) + replacedSlice + src.slice(winEnd);
  }
  const m = src.match(regex);
  if (!m) {
    throw new Error(`Missing pattern for [${label}]`);
  }
  return src.replace(regex, replacer);
}

// ── 4. Transform electron/main.js (100% Gated on Active Mod in mods.json) ──
function transformMainJs(src) {
  const origBytes = Buffer.byteLength(src, 'utf8');
  if (src.includes('__GEO_FIRE_MAIN__')) return src;

  const trigRegex = /\/\/ ── Trigonométrie déterministe[\s\S]*?app\.commandLine\.appendSwitch\('js-flags',\s*([^\n;]+)\);/;
  const replacementTrig = (_, flagsExpr) =>
    `// __GEO_FIRE_MAIN__ /*__PAD_MAIN__*/\n` +
    `const __fireOn = (() => { try { const u = app.getPath('userData'); const m = JSON.parse(fs.readFileSync(path.join(u, 'mods.json'), 'utf8')); if (m && Array.isArray(m.disabled) && m.disabled.includes('geoplanetical-performance')) return false; if (fs.existsSync(path.join(u, 'mods', 'geoplanetical-performance', 'mod.json'))) return true; return !!(m && Array.isArray(m.order) && m.order.includes('geoplanetical-performance')); } catch (_) { return true; } })();\n` +
    `app.commandLine.appendSwitch('js-flags', ${flagsExpr});\n` +
    `if (__fireOn) { process.env.NODE_OPTIONS = '--max-old-space-size=4096'; app.commandLine.appendSwitch('disable-gpu-vsync'); app.commandLine.appendSwitch('disable-frame-rate-limit'); app.commandLine.appendSwitch('enable-gpu-rasterization'); app.commandLine.appendSwitch('enable-zero-copy'); app.commandLine.appendSwitch('disable-gpu-driver-bug-workarounds'); }`;

  let out = replaceOnceRegex(src, 'main.js trig/js-flags', trigRegex, replacementTrig);

  const bgRegex = /\/\/ Une fenêtre visible sur un autre écran[\s\S]*?backgroundThrottling:\s*false,/;
  out = replaceOnceRegex(out, 'main.js backgroundThrottling', bgRegex, `      backgroundThrottling: __fireOn,`);

  const finalStr = padToExactBytes(out, origBytes, '/*__PAD_MAIN__*/', 'electron/main.js');
  new vm.Script(`(function(){\n${finalStr}\n})`, { filename: 'electron/main.js' });
  return finalStr;
}

// ── 5. Transform electron/mods/mod-workshop.js (Bundle Patcher on Workshop Upload) ──
function transformWorkshopJs(src) {
  const origBytes = Buffer.byteLength(src, 'utf8');
  if (src.includes('__GEO_FIRE_WKSHP__')) return src;

  const headerRegex = /\/\/ CODING CHECKPOINT[\s\S]*?l'abandon de l'écran\./;
  let out = replaceOnceRegex(src, 'mod-workshop.js header comment', headerRegex, `// __GEO_FIRE_WKSHP__ /*__PAD_WKSHP__*/`);

  const stageRegex = /\/\/ La copie de publication[\s\S]*?await fs\.writeFile\(path\.join\(content, 'mod\.json'\), mod\.bytes, \{ flag: 'wx' \}\);/;
  out = replaceOnceRegex(
    out,
    'mod-workshop.js stageContent',
    stageRegex,
    `  async function stageContent(mod, content) {\n` +
    `    await fs.mkdir(content, { recursive: true });\n` +
    `    await fs.writeFile(path.join(content, 'mod.json'), mod.bytes, { flag: 'wx' });\n` +
    `    if (mod.manifest.id === 'geoplanetical-performance') {\n` +
    `      for (const extra of ['patcher.js', 'Install-Mod.bat', 'Uninstall-Mod.bat']) {\n` +
    `        await fs.copyFile(path.join(mod.root, extra), path.join(content, extra)).catch(() => {});\n` +
    `      }\n` +
    `    }`
  );

  const finalStr = padToExactBytes(out, origBytes, '/*__PAD_WKSHP__*/', 'electron/mods/mod-workshop.js');
  new vm.Script(finalStr, { filename: 'electron/mods/mod-workshop.js' });
  return finalStr;
}

// ── 6. Transform renderer/app.bundle.js (Minifier-Resilient + 100% Reversible Active-Mod Gate) ──
function transformAppBundleJs(src) {
  const origBytes = Buffer.byteLength(src, 'utf8');
  if (src.includes('__GEO_FIRE_MOD__')) return src;

  let out = src;

  // 6.1 Inject __GFM() (checks status === "active" in Mods snapshot + syncs runtime CSS blur killer) & _initThree
  out = replaceOnceRegex(
    out,
    '_initThree and canvas dimensions',
    /var ([A-Za-z0-9_$]+)=8192,([A-Za-z0-9_$]+)=4096,([A-Za-z0-9_$]+)=4096,([A-Za-z0-9_$]+)=2048,([A-Za-z0-9_$]+)=\1\/4096,([A-Za-z0-9_$]+)=1\.5;function ([A-Za-z0-9_$]+)\(([A-Za-z0-9_$]+),([A-Za-z0-9_$]+)=\{\}\)\{\8\._quality=([A-Za-z0-9_$]+)\[\9\.quality\]\?\9\.quality:"balanced",\8\._renderScale=Math\.max\(\.5,Math\.min\(1,\9\.renderScale\|\|1\)\);let ([A-Za-z0-9_$]+)=([A-Za-z0-9_$]+)\(\8,\8\._quality\)<\6;\8\.renderer=new ([A-Za-z0-9_$]+)\(\{antialias:\11,alpha:!0,powerPreference:"high-performance"\}\),\8\.renderer\.setClearColor\(329224,1\),\8\.renderer\.setPixelRatio\(([A-Za-z0-9_$]+)\(\8,\8\._quality\)\),\8\.renderer\.setSize\(window\.innerWidth,window\.innerHeight\),\8\.container\.appendChild\(\8\.renderer\.domElement\),\8\._frameGate=new ([A-Za-z0-9_$]+),\8\._texTier=([A-Za-z0-9_$]+)\[\9\.textures\]\?\9\.textures:"ultra";let ([A-Za-z0-9_$]+)=\16\[\8\._texTier\];\8\._texAniso=Math\.min\(\8\.renderer\.capabilities\.getMaxAnisotropy\(\),\17\.anisotropy\),\8\._textures=new ([A-Za-z0-9_$]+)\(\{maxSize:Math\.min\(\8\.renderer\.capabilities\.maxTextureSize,\17\.maxSize\)/,
    (_, c8k, c4k1, c4k2, c2k, jL, y1e, fnInit, p1, p2, qMap, vAa, fnAy, clsRen, fnBm, clsFg, texMap, vN, clsTex) =>
      `var __GFCSS=on=>{try{let d=globalThis.document;if(!d)return;let s=d.getElementById("gf-css");on?(!s&&(s=d.createElement("style"),s.id="gf-css",s.textContent="*{backdrop-filter:none!important;-webkit-backdrop-filter:none!important}",d.head?.appendChild(s)),s&&(s.disabled=!1)):s&&(s.disabled=!0)}catch{}},__GFTOAST=m=>{try{let d=globalThis.document;if(!d)return;let t=d.getElementById("gfm-toast");t||(t=d.createElement("div"),t.id="gfm-toast",t.style.cssText="position:fixed;top:68px;left:50%;transform:translateX(-50%);z-index:999999;background:rgba(18,22,28,.95);border:1px solid rgba(255,140,0,.7);color:#fff;font-family:sans-serif;font-size:13px;font-weight:700;padding:8px 16px;border-radius:6px;box-shadow:0 4px 16px rgba(0,0,0,.6);pointer-events:none;transition:opacity .2s;",d.body?.appendChild(t));t.textContent=m,t.style.opacity="1",clearTimeout(t._tm),t._tm=setTimeout(()=>{t.style.opacity="0"},2e3)}catch{}},__GFM=(k="all")=>{if(globalThis.__GEO_FIRE_MOD__===void 0){let m=globalThis.window?.desktop?.mods?.snapshot?.mods;globalThis.__GEO_FIRE_MOD__=Array.isArray(m)?m.some(x=>x.id==="geoplanetical-performance"&&x.status==="active"):!0,globalThis.__GEO_FIRE_GFX__??=globalThis.__GEO_FIRE_MOD__,globalThis.__GEO_FIRE_TURBO__??=globalThis.__GEO_FIRE_MOD__}let act=globalThis.__GEO_FIRE_MOD__;return k==="gfx"?(act&&globalThis.__GEO_FIRE_GFX__!==!1):k==="turbo"?(act&&globalThis.__GEO_FIRE_TURBO__!==!1):act},${c8k}=__GFM("gfx")?2048:8192,${c4k1}=__GFM("gfx")?1024:4096,${c4k2}=__GFM("gfx")?2048:4096,${c2k}=__GFM("gfx")?1024:2048,${jL}=${c8k}/4096,${y1e}=1.5;function ${fnInit}(${p1},${p2}={}){let F=__GFM("gfx");__GFCSS(F),${p1}._quality=F?"performance":(${qMap}[${p2}.quality]?${p2}.quality:"balanced"),${p1}._renderScale=Math.max(.25,Math.min(1,${p2}.renderScale||(F?.5:1)));let ${vAa}=!F&&${fnAy}(${p1},${p1}._quality)<${y1e};${p1}.renderer=new ${clsRen}({antialias:${vAa},alpha:!F,stencil:!1,precision:F?"mediump":"highp",powerPreference:"high-performance"}),${p1}.renderer.setClearColor(329224,1),${p1}.renderer.setPixelRatio(${fnBm}(${p1},${p1}._quality)),${p1}.renderer.setSize(window.innerWidth,window.innerHeight),${p1}.container.appendChild(${p1}.renderer.domElement),${p1}._frameGate=new ${clsFg},${p1}._texTier=F?"low":(${texMap}[${p2}.textures]?${p2}.textures:"ultra");let ${vN}=${texMap}[${p1}._texTier];${p1}._texAniso=F?1:Math.min(${p1}.renderer.capabilities.getMaxAnisotropy(),${vN}.anisotropy),${p1}._textures=new ${clsTex}({maxSize:Math.min(${p1}.renderer.capabilities.maxTextureSize,F?2048:${vN}.maxSize)`,
    'powerPreference:"high-performance"'
  );

  // 6.2 Auto-pause WebGL redraws in shouldDraw when camera & map are still in Fire Mode
  out = replaceOnceRegex(
    out,
    'shouldDraw idle gate',
    /this\.staleSeconds>=(\.1)\?\(this\.staleSeconds=0,!0\):!1/,
    `this.staleSeconds>=(__GFM("gfx")?.5:.1)?(this.staleSeconds=0,!0):!1`,
    'this.staleSeconds+='
  );

  // 6.3 Disable mipmap generation on baseTexture when Fire Mode is active
  out = replaceOnceRegex(
    out,
    'baseTexture mipmaps',
    /([A-Za-z0-9_$]+)\.baseTexture\.generateMipmaps=!0,\1\.baseTexture\.minFilter=([A-Za-z0-9_$]+),\1\.baseTexture\.magFilter=([A-Za-z0-9_$]+)/,
    (_, p1, minF, magF) => `${p1}.baseTexture.generateMipmaps=!__GFM("gfx"),${p1}.baseTexture.minFilter=__GFM("gfx")?${magF}:${minF},${p1}.baseTexture.magFilter=${magF}`,
    '.baseTexture.generateMipmaps=!0'
  );

  // 6.4 Bypass Windows High-DPI bloat in pixelRatio helpers when Fire Mode is active & unlock renderScale down to 0.25
  out = replaceOnceRegex(
    out,
    'pixelRatio helpers',
    /function ([A-Za-z0-9_$]+)\(([A-Za-z0-9_$]+),([A-Za-z0-9_$]+),([A-Za-z0-9_$]+)=window\.devicePixelRatio\|\|1,([A-Za-z0-9_$]+)=([A-Za-z0-9_$]+)\(\)\)\{let ([A-Za-z0-9_$]+)=([A-Za-z0-9_$]+)\[\3\]\|\|\8\.quality,([A-Za-z0-9_$]+)=Math\.min\(\4\/\5,\7\.pixelRatioCap\);return Math\.max\(\.5,Math\.min\(\9\*\(\2\._renderScale\|\|1\),3\)\)\}function ([A-Za-z0-9_$]+)\(([A-Za-z0-9_$]+),([A-Za-z0-9_$]+),([A-Za-z0-9_$]+)=window\.devicePixelRatio\|\|1,([A-Za-z0-9_$]+)=\6\(\)\)\{return \1\(\11,\12,\13,\14\)\*\14\}/,
    (_, fnAy, p1, p2, vDpr, vZoom, fnZoom, vQual, qMap, vR, fnBm, p1b, p2b, vDpr2, vZoom2) =>
      `function ${fnAy}(${p1},${p2},${vDpr}=window.devicePixelRatio||1,${vZoom}=${fnZoom}()){if(__GFM("gfx"))return Math.max(.25,Math.min(${p1}._renderScale||.5,1));let ${vQual}=${qMap}[${p2}]||${qMap}.quality,${vR}=Math.min(${vDpr}/${vZoom},${vQual}.pixelRatioCap);return Math.max(.25,Math.min(${vR}*(${p1}._renderScale||1),3))}function ${fnBm}(${p1b},${p2b},${vDpr2}=window.devicePixelRatio||1,${vZoom2}=${fnZoom}()){return __GFM("gfx")?${fnAy}(${p1b},${p2b},1,1):${fnAy}(${p1b},${p2b},${vDpr2},${vZoom2})*${vZoom2}}`,
    '.pixelRatioCap)'
  );

  out = replaceOnceRegex(
    out,
    'setRenderScale clamp',
    /function ([A-Za-z0-9_$]+)\(([A-Za-z0-9_$]+),([A-Za-z0-9_$]+)\)\{\2\._renderScale=Math\.max\(\.5,Math\.min\(1,\3\|\|1\)\),\2\.renderer&&\(([A-Za-z0-9_$]+)\(\2\),\2\._updateCityLights\?\.\(\)\)\}/,
    (_, fnSetScale, p1, p2, fnResize) => `function ${fnSetScale}(${p1},${p2}){${p1}._renderScale=Math.max(.25,Math.min(1,${p2}||1)),${p1}.renderer&&(${fnResize}(${p1}),${p1}._updateCityLights?.())}`,
    '._updateCityLights?.())}'
  );

  // 6.5 Suppress cloudMesh and auroraMesh when Fire Mode is active
  out = replaceOnceRegex(
    out,
    'cloudMesh suppression',
    /if\(!([A-Za-z0-9_$]+)\.cloudMesh\)return;/,
    (_, p1) => `if(!${p1}.cloudMesh)return;if(__GFM("gfx")){${p1}.cloudMesh.visible=!1,${p1}.auroraMesh&&(${p1}.auroraMesh.visible=!1);return}`,
    '.cloudMesh)return;'
  );

  // 6.6 In _loadEarthTextures: skip heavy 4K surface-material, 16x sea-ice PNGs, earthNormal, and earthClouds in Fire Mode
  out = replaceOnceRegex(
    out,
    'skip surface-material-4096 in Fire Mode',
    /,([A-Za-z0-9_$]+)\("terrain\/surface-material-4096\.png",/,
    (_, fnLoad) => `,__GFM("gfx")||${fnLoad}("terrain/surface-material-4096.png",`,
    '"terrain/surface-material-4096.png"'
  );
  out = replaceOnceRegex(
    out,
    'skip sea-ice 16x PNG assembly in Fire Mode',
    /;\{let ([A-Za-z0-9_$]+)=new Array\(([A-Za-z0-9_$]+)\.length\),([A-Za-z0-9_$]+)=\2\.length;([\s\S]*?)\.src="textures\/"\+\2\[([A-Za-z0-9_$]+)\]\}\}/,
    (_, vArr, vList, vCnt, body, vIdx) => `;if(!__GFM("gfx")){let ${vArr}=new Array(${vList}.length),${vCnt}=${vList}.length;${body}.src="textures/"+${vList}[${vIdx}]}}`,
    'grain de banquise'
  );
  out = replaceOnceRegex(
    out,
    'skip earthNormal in Fire Mode',
    /([A-Za-z0-9_$]+)\._textures\.register\("earthNormal",/,
    (_, p1) => `__GFM("gfx")||${p1}._textures.register("earthNormal",`,
    '._textures.register("earthNormal",'
  );
  out = replaceOnceRegex(
    out,
    'disable cryo shader work in Fire Mode',
    /([A-Za-z0-9_$]+)\.globeMat\.uniforms\.uCryoOn\.value=1,/,
    (_, p1) => `${p1}.globeMat.uniforms.uCryoOn.value=__GFM("gfx")?0:1,`,
    '.globeMat.uniforms.uCryoOn.value=1,'
  );
  out = replaceOnceRegex(
    out,
    'skip earthClouds in Fire Mode',
    /,([A-Za-z0-9_$]+)\._textures\.register\("earthClouds",/,
    (_, p1) => `,__GFM("gfx")||${p1}._textures.register("earthClouds",`,
    '._textures.register("earthClouds",'
  );

  // 6.7 Match visual clock speed lookup for Turbo Speed 3 (16.0 days/s when Fire Mode is ON, vanilla when OFF)
  out = replaceOnceRegex(
    out,
    'visual clock speed lookup',
    /([A-Za-z0-9_$]+)\[Math\.max\(0,Math\.min\(\1\.length-1,Math\.trunc\(Number\(([A-Za-z0-9_$]+)\)\|\|0\)\)\)\]\|\|0;/,
    (_, arrName, vArg) => `(${vArg}===3&&__GFM("turbo")?16:${arrName}[Math.max(0,Math.min(${arrName}.length-1,Math.trunc(Number(${vArg})||0)))]||0);`,
    '.length-1,Math.trunc(Number('
  );

  // 6.8 In Globe constructor: skip _initISS, _initOrbitalPollution, _loadCityLights when Fire Mode is active
  out = replaceOnceRegex(
    out,
    'Globe constructor init chain',
    /this\._initThree\(([A-Za-z0-9_$]+)\),this\._initTextures\(\),this\._initScene\(\),this\._initISS\(\),this\._initOrbitalPollution\(\),this\._buildProvinceFills\(\),this\._initBorderLines\(\),this\._initUnits\(\),this\._loadEarthTextures\(\),this\._loadCityLights\(\),this\._bindEvents\(\)/,
    (_, arg) => `this._initThree(${arg}),this._initTextures(),this._initScene(),__GFM("gfx")||(this._initISS(),this._initOrbitalPollution()),this._buildProvinceFills(),this._initBorderLines(),this._initUnits(),this._loadEarthTextures(),__GFM("gfx")?(this.lightsReady=Promise.resolve()):this._loadCityLights(),this._bindEvents()`,
    'this._initISS(),this._initOrbitalPollution()'
  );

  // 6.9 Non-Destructive Dual Globe Shader (uGf uniform: 1 = 5-line Fire shader, 0 = 100% original Vanilla shader)
  out = replaceOnceRegex(
    out,
    'globeMat uGf uniform',
    /uCryoOn:\{value:0\},/,
    `uCryoOn:{value:0},uGf:{value:__GFM("gfx")?1:0},`,
    'uCryoOn:{value:0},'
  );
  out = replaceOnceRegex(
    out,
    'globeMat uGf uniform declaration',
    /uniform float uCryoOn,/,
    `uniform float uGf, uCryoOn,`,
    'uniform float uCryoOn,'
  );

  const shaderStartMarker = `          if (uDataMode < 1.0) {`;
  const shaderEndMarker = `          // --- MODE ATTAQUE :`;
  const sIdx = out.indexOf(shaderStartMarker);
  const eIdx = out.indexOf(shaderEndMarker, sIdx);
  if (sIdx === -1 || eIdx === -1) {
    throw new Error('Could not locate globeMat fragmentShader uDataMode < 1.0 block');
  }
  const vanillaShaderSlice = out.slice(sIdx + shaderStartMarker.length, eIdx);
  const strippedVanillaShader = vanillaShaderSlice.replace(/[ \t]*\/\/[^\n]*/g, '');
  const dualShaderBlock =
    `          if (uDataMode < 1.0) {\n` +
    `            if (uGf > 0.5) {\n` +
    `              float ndlGeo = dot(normalize(vN), sunDir);\n` +
    `              float dayMix = smoothstep(-0.22, 0.18, ndlGeo);\n` +
    `              col = mix(day * mix(0.22, 1.02, dayMix), (day + uDeepTint) * mix(0.22, 0.98, dayMix), ocean);\n` +
    `            } else {` +
    strippedVanillaShader +
    `}\n          /*__PAD_BUNDLE__*/\n`;
  out = out.slice(0, sIdx) + dualShaderBlock + out.slice(eIdx);

  // 6.10 Reduce Earth sphere geometry from 256x160 to 80x48 in Fire Mode
  out = replaceOnceRegex(
    out,
    'Earth sphere geometry',
    /this\.sphere=new ([A-Za-z0-9_$]+)\(new ([A-Za-z0-9_$]+)\(([A-Za-z0-9_$]+),256,160\),this\.globeMat\)/,
    (_, clsMesh, clsGeo, rad) => `this.sphere=new ${clsMesh}(new ${clsGeo}(${rad},__GFM("gfx")?80:256,__GFM("gfx")?48:160),this.globeMat)`,
    ',256,160),this.globeMat)'
  );

  // 6.11 Skip _initSky() and hide atmosphere/cloud/aurora meshes in Fire Mode
  out = replaceOnceRegex(
    out,
    '_initScene end',
    /this\._initMoon\(\),this\._initApollo\(\),this\._initVolcano\(\),this\._resetHurricanes\(\),this\._initSky\(\),this\._updateSun\(0\)/,
    `this._initMoon(),this._initApollo(),this._initVolcano(),this._resetHurricanes(),__GFM("gfx")?(this.cloudMesh&&(this.cloudMesh.visible=!1),this.auroraMesh&&(this.auroraMesh.visible=!1),this.atmosphereMesh&&(this.atmosphereMesh.visible=!1),this.atmosphereExtinctionMesh&&(this.atmosphereExtinctionMesh.visible=!1)):this._initSky(),this._updateSun(0)`,
    'this._initSky(),this._updateSun(0)'
  );

  // 6.12 Skip moonNormal in _loadMoonTexture() when Fire Mode is active
  out = replaceOnceRegex(
    out,
    '_loadMoonTexture',
    /_loadMoonTexture\(\)\{let ([A-Za-z0-9_$]+)=([A-Za-z0-9_$]+)\[this\._moonDetail\];this\._textures\.register\("moonColor",([A-Za-z0-9_$]+)=>\{this\.moonMat\.uniforms\.moonTex\.value=\3,this\.moonMat\.uniforms\.uHasTex\.value=1,this\.renderer\.initTexture\(\3\)\},\1\.colorPx\),this\._textures\.register\("moonNormal",([A-Za-z0-9_$]+)=>\{this\.moonMat\.uniforms\.normalTex\.value=\4,this\.moonMat\.uniforms\.uHasNormal\.value=1,this\.renderer\.initTexture\(\4\)\},\1\.normalPx\)\}/,
    (_, vA, tbl, vCb1, vCb2) => `_loadMoonTexture(){let ${vA}=${tbl}[this._moonDetail];this._textures.register("moonColor",${vCb1}=>{this.moonMat.uniforms.moonTex.value=${vCb1},this.moonMat.uniforms.uHasTex.value=1,this.renderer.initTexture(${vCb1})},__GFM("gfx")?2048:${vA}.colorPx),__GFM("gfx")||this._textures.register("moonNormal",${vCb2}=>{this.moonMat.uniforms.normalTex.value=${vCb2},this.moonMat.uniforms.uHasNormal.value=1,this.renderer.initTexture(${vCb2})},${vA}.normalPx)}`,
    '_loadMoonTexture(){'
  );

  // 6.13 Throttle non-camera effect updates + keep atmosphereMesh & atmosphereExtinctionMesh hidden in Fire Mode
  out = replaceOnceRegex(
    out,
    'Throttle effects in update()',
    /this\._updateStrikes\(([A-Za-z0-9_$]+)\),this\._updateVolcano\(\1\),this\._updateUnits\(\1\),this\._tickDamage\(\),this\._updateHighlights\(\1\),this\._updateDataFade\(\1\),/,
    (_, vDt) => `((!__GFM("gfx")||(this._gfFxT=(this._gfFxT||0)+${vDt})>=.065)&&(this._gfFxT=0,this._updateStrikes(${vDt}),this._updateVolcano(${vDt}),this._updateUnits(${vDt}),this._tickDamage())),this._updateHighlights(${vDt}),this._updateDataFade(${vDt}),`,
    'this._updateStrikes('
  );
  out = replaceOnceRegex(
    out,
    'Keep atmosphereMesh hidden in update()',
    /let ([A-Za-z0-9_$]+)=([A-Za-z0-9_$]+)<\.999;if\(this\.atmosphereMesh&&\(this\.atmosphereMesh\.visible=\1\),this\.atmosphereExtinctionMesh&&\(this\.atmosphereExtinctionMesh\.visible=\1\),/,
    (_, vVis, vStrat) => `let ${vVis}=!__GFM("gfx")&&${vStrat}<.999;if(this.atmosphereMesh&&(this.atmosphereMesh.visible=${vVis}),this.atmosphereExtinctionMesh&&(this.atmosphereExtinctionMesh.visible=${vVis}),`,
    '<.999;if(this.atmosphereMesh'
  );

  // 6.14 Camera-dirty & 25 Hz throttle gate on the 17+ DOM marker/label projection loops in update()
  out = replaceOnceRegex(
    out,
    'DOM markers projection in update()',
    /this\._updateOceanLabels\?\.\(\),this\._updateNationLabels\(([A-Za-z0-9_$]+)\),this\._updateCapitalLabels\(\1\),this\._updateBaseMarkers\(\),this\._updateFormationMarkers\(\),this\._updateFrontLabels\(\),this\._updateWarMapMarks\(\),this\._updatePlantMarkers\(\),this\._updateTransportMarkers\(\),this\._updateTransportFlow\(\),this\._updateConstructionMarkers\(\),this\._updateFieldMarkers\(\),this\.updateWarTargets\?\.\(\),this\._updateWarCandidates\?\.\(\),this\._updateDeterrence\?\.\(\),this\._updateAirDamagePopups\?\.\(\),this\._updateSpaceSites\?\.\(([A-Za-z0-9_$]+)\)/,
    (_, vZoom, vDt) =>
      `((()=>{if(!__GFM("gfx"))return!0;let E=this.camera.matrixWorld.elements,k=` +
      `E[0].toFixed(4)+"|"+E[5].toFixed(4)+"|"+E[10].toFixed(4)+"|"+E[12].toFixed(3)+"|"+E[13].toFixed(3)+"|"+E[14].toFixed(3)+"|"+${vZoom}.toFixed(3)+"|"+(this.activeBody||"earth")+"|"+(this._energyMode?1:0)+(this._militaryMode?1:0)+(this._basesMode?1:0)+(this._forageMode?1:0)+(this._transportMode?1:0),` +
      `T=performance.now();return k!==this._gfCamKey&&T-(this._gfDomAt||0)>=36?(this._gfCamKey=k,this._gfDomAt=T,!0):T-(this._gfDomAt||0)>=300?(this._gfCamKey=k,this._gfDomAt=T,!0):!1})())&&(` +
      `this._updateOceanLabels?.(),this._updateNationLabels(${vZoom}),this._updateCapitalLabels(${vZoom}),this._updateBaseMarkers(),this._updateFormationMarkers(),this._updateFrontLabels(),this._updateWarMapMarks(),this._updatePlantMarkers(),this._updateTransportMarkers(),this._updateTransportFlow(),this._updateConstructionMarkers(),this._updateFieldMarkers(),this.updateWarTargets?.(),this._updateWarCandidates?.(),this._updateDeterrence?.(),this._updateAirDamagePopups?.(),this._updateSpaceSites?.(${vDt}))`,
    'this._updateOceanLabels?.()'
  );

  // 6.15 Skip _renderISS() and _renderOrbitalPollution() in _drawFrame() when Fire Mode is active
  out = replaceOnceRegex(
    out,
    '_drawFrame passes',
    /_drawFrame\(\)\{this\.renderer\.render\(this\.scene,this\.camera\),this\._renderBorderOverlay\?\.\(\),this\._renderISS\(\),this\._renderOrbitalPollution\(\)\}/,
    `_drawFrame(){this.renderer.render(this.scene,this.camera),this._renderBorderOverlay?.(),__GFM("gfx")||(this._renderISS(),this._renderOrbitalPollution())}`,
    '_drawFrame(){this.renderer.render('
  );

  // 6.16 Retain native spherical province tessellation (prevents flat chord sagging/black patches), add fillMat early discard, & auto-settle static globe
  out = replaceOnceRegex(
    out,
    'fillMat early discard',
    /void main\(\) \{\n          float cid = floor\(vCid \+ 0\.5\);\n          float polityId = floor\(vPolity \+ 0\.5\);/,
    `void main() {\n          float cid = floor(vCid + 0.5);\n          float polityId = floor(vPolity + 0.5);\n          if (uStrategic <= 0.004 && uChoroMix <= 0.001 && uChoroPrevMix <= 0.001 && uFrontN == 0 && uAttack < 0.5 && abs(polityId - uSelected) >= 0.5 && abs(cid - uHovered) >= 0.5 && abs(polityId - uSelPrev) >= 0.5 && abs(cid - uHoverPrev) >= 0.5) discard;`,
    'float cid = floor(vCid + 0.5);'
  );
  out = replaceOnceRegex(
    out,
    '_mapImageSettled and _refreshFillVis in Fire Mode',
    /_mapImageSettled\(\)\{let ([A-Za-z0-9_$]+)=\(([A-Za-z0-9_$]+),([A-Za-z0-9_$]+)\)=>Math\.abs\(\3-\2\)<\.002;return this\._dataMix===1&&!this\._spinMult&&!this\._captureViewport&&\(this\._choroMix\|\|0\)===\(this\._choroTarget\|\|0\)&&!this\._choroPrevMix&&\(this\._overlayMix\|\|0\)===\(this\._overlayTarget\|\|0\)&&\1\(this\._hoverAmt\|\|0,this\.hovered\?1:0\)&&!this\._hoverPrevAmt&&\1\(this\._selAmt\|\|0,this\.selectedKey\?1:0\)&&!this\._selPrevAmt\},_refreshFillVis\(\)\{let ([A-Za-z0-9_$]+)=this\.fillMat\.uniforms;this\.fillMesh\.visible=this\._attack\|\|\(this\._strategicMix\|\|0\)>\.004\|{2}\4\.uChoro\.value>\.5\|{2}\(this\._choroMix\|\|0\)>\.004\|{2}\(this\._choroPrevMix\|\|0\)>\.004\|{2}\4\.uHovered\.value>=0\|{2}\4\.uSelected\.value>=0\|{2}\(this\._hoverPrevAmt\|\|0\)>\.004\|{2}\(this\._selPrevAmt\|\|0\)>\.004\}/,
    (_, fnEq, v1, v2, vU) => `_mapImageSettled(){let ${fnEq}=(${v1},${v2})=>Math.abs(${v2}-${v1})<.002;return(__GFM("gfx")||this._dataMix===1&&!this._spinMult)&&!this._captureViewport&&(this._choroMix||0)===(this._choroTarget||0)&&!this._choroPrevMix&&(this._overlayMix||0)===(this._overlayTarget||0)&&${fnEq}(this._hoverAmt||0,this.hovered?1:0)&&!this._hoverPrevAmt&&${fnEq}(this._selAmt||0,this.selectedKey?1:0)&&!this._selPrevAmt},_refreshFillVis(){let ${vU}=this.fillMat.uniforms;this.fillMesh.visible=this._attack||(this._strategicMix||0)>.004||${vU}.uChoro.value>.5||(this._choroMix||0)>.004||(this._choroPrevMix||0)>.004||${vU}.uFrontN.value>0||!__GFM("gfx")&&(${vU}.uHovered.value>=0||${vU}.uSelected.value>=0||(this._hoverPrevAmt||0)>.004||(this._selPrevAmt||0)>.004)}`,
    '_mapImageSettled(){'
  );

  // 6.17 Cut _borderScene overdraw & vertices by ~75%
  out = replaceOnceRegex(
    out,
    'disable casingMesh in Fire Mode',
    /function ([A-Za-z0-9_$]+)\(([A-Za-z0-9_$]+),([A-Za-z0-9_$]+),([A-Za-z0-9_$]+)\)\{\2&&\(\2\.mat\.opacity=\3,\2\.casingMat\.opacity=\4,([A-Za-z0-9_$]+)\(\2,\3>\.001\|\|\4>\.001\)\)\}/,
    (_, fnCf, p1, p2, vCasing) => `function ${fnCf}(${p1},${p2},${vCasing}){${p1}&&(${p1}.mat.opacity=${p2},${p1}.casingMat.opacity=__GFM("gfx")?0:${vCasing},${p1}.mesh.visible=${p2}>.001,${p1}.casingMesh.visible=!__GFM("gfx")&&${vCasing}>.001)}`,
    '.casingMat.opacity='
  );
  out = replaceOnceRegex(
    out,
    '_initBorderLines minDeg simplification',
    /this\.coastLines=([A-Za-z0-9_$]+)\(this,this\.world\.coastlines,\{radius:([A-Za-z0-9_$]+),minDeg:\.018,order:10,color:([A-Za-z0-9_$]+)\.coast,width:\.56,opacity:\.45,casingWidth:1\.35,casingOpacity:\.4\}\),this\.borderLines=\1\(this,this\.world\.borders,\{radius:\2,minDeg:\.012,order:20,color:\3\.nation,width:\.92,opacity:\.72,casingWidth:2\.1,casingOpacity:\.64\}\)/,
    (_, fnPx, vRad, colTbl) => `this.coastLines=${fnPx}(this,this.world.coastlines,{radius:${vRad},minDeg:__GFM("gfx")?.08:.018,order:10,color:${colTbl}.coast,width:.56,opacity:.45,casingWidth:1.35,casingOpacity:.4}),this.borderLines=${fnPx}(this,this.world.borders,{radius:${vRad},minDeg:__GFM("gfx")?.04:.012,order:20,color:${colTbl}.nation,width:.92,opacity:.72,casingWidth:2.1,casingOpacity:.64})`,
    'this.world.coastlines,{radius:'
  );
  out = replaceOnceRegex(
    out,
    '_updateBorderLod coastLines & provAllLines',
    /([A-Za-z0-9_$]+)\(this\.borderLines,Math\.min\(1,([A-Za-z0-9_$]+)\),Math\.min\(1,([A-Za-z0-9_$]+)\)\),\1\(this\.coastLines,Math\.min\(1,([A-Za-z0-9_$]+)\),Math\.min\(1,([A-Za-z0-9_$]+)\)\);let ([A-Za-z0-9_$]+)=this\._transportMode\?0:1,([A-Za-z0-9_$]+)=([A-Za-z0-9_$]+)\*\(1-([A-Za-z0-9_$]+)\)\*\6;if\(\1\(this\._provHiEntry,([A-Za-z0-9_$]+)\.lerp\(\.25,\.34,([A-Za-z0-9_$]+)\)\*\7,\10\.lerp\(\.05,\.24,\11\)\*\7\),this\._provAllLines\)\{let ([A-Za-z0-9_$]+)=this\._militaryMode\?\.37:1,([A-Za-z0-9_$]+)=\10\.lerp\(\.2,\.38,\8\)\*\9\*\6\*\12;this\._provAllLines\.mat\.opacity=\13,this\._provAllLines\.mesh\.visible=\13>\.002/,
    (_, fnCf, bOp, bCas, cOp, cCas, vI, vP, vR, vG, mth, vMapMix, vH, vM) =>
      `${fnCf}(this.borderLines,Math.min(1,${bOp}),Math.min(1,${bCas})),${fnCf}(this.coastLines,__GFM("gfx")?0:Math.min(1,${cOp}),Math.min(1,${cCas}));let ${vI}=this._transportMode?0:1,${vP}=${vR}*(1-${vG})*${vI};if(${fnCf}(this._provHiEntry,${mth}.lerp(.25,.34,${vMapMix})*${vP},${mth}.lerp(.05,.24,${vMapMix})*${vP}),this._provAllLines){let ${vH}=this._militaryMode?.37:1,${vM}=${mth}.lerp(.2,.38,${vR})*${vG}*${vI}*${vH};this._provAllLines.mat.opacity=${vM},this._provAllLines.mesh.visible=(!__GFM("gfx")||a>.55)&&${vM}>.002`,
    'this._provAllLines.mesh.visible='
  );

  // 6.18 Halve 3D Nation Label texture resolution (72 -> 36) in Fire Mode
  out = replaceOnceRegex(
    out,
    'Nation label resolution 72',
    /var ([A-Za-z0-9_$]+)=([A-Za-z0-9_$]+)\*1\.0016,([A-Za-z0-9_$]+)=72,([A-Za-z0-9_$]+)=1\.55,/,
    (_, vMq, vGe, vOm, vNm) => `var ${vMq}=${vGe}*1.0016,${vOm}=__GFM("gfx")?36:72,${vNm}=1.55,`,
    '=1.55,'
  );

  // 6.19 Pass live gf: __GFM("turbo") flag and Speed 3 dtSeconds scaling in PULSE request
  out = replaceOnceRegex(
    out,
    'PULSE request Speed 3 boost + live gf flag',
    /if\(this\.applyStatus\(await this\.request\(([A-Za-z0-9_$]+)\.PULSE,\{dtSeconds:([A-Za-z0-9_$]+)\}\)\),/,
    (_, enumCmd, vDt) => `if(this.applyStatus(await this.request(${enumCmd}.PULSE,{dtSeconds:__GFM("turbo")&&this.status?.speedIdx===3?${vDt}*1.5:${vDt},gf:__GFM("turbo")})),`,
    '.PULSE,{dtSeconds:'
  );

  // 6.20 Disable newsflash <video> decoding in Fire Mode & allow empty provides: {} in Mod Studio
  out = replaceOnceRegex(
    out,
    'Mod Studio allow empty provides',
    /let ([A-Za-z0-9_$]+)=([A-Za-z0-9_$]+)\(([A-Za-z0-9_$]+)\)===0,([A-Za-z0-9_$]+)=([A-Za-z0-9_$]+)\(\3\)>([A-Za-z0-9_$]+)\.modBytes;return\{ok:!Object\.keys\(([A-Za-z0-9_$]+)\)\.length&&!([A-Za-z0-9_$]+)\.length&&!\1&&!\4,fields:\7,entries:\8,empty:\1,oversize:\4\}/,
    (_, vEmpty, fnCnt, vDraft, vOver, fnBytes, limObj, vFields, vEntries) =>
      `let ${vEmpty}=!1,${vOver}=${fnBytes}(${vDraft})>${limObj}.modBytes;return{ok:!Object.keys(${vFields}).length&&!${vEntries}.length&&!${vOver},fields:${vFields},entries:${vEntries},empty:!1,oversize:${vOver}}`,
    ',empty:'
  );
  out = replaceOnceRegex(
    out,
    'newsflash video selector',
    /function ([A-Za-z0-9_$]+)\(([A-Za-z0-9_$]+)\)\{let ([A-Za-z0-9_$]+)=\2,([A-Za-z0-9_$]+)=([A-Za-z0-9_$]+)&&\5\[\2\]\|\|\[\];/,
    (_, fnVid, p1, vTheme, vArr, tbl) => `function ${fnVid}(${p1}){if(__GFM("gfx"))return null;let ${vTheme}=${p1},${vArr}=${tbl}&&${tbl}[${p1}]||[];`,
    '"video/news/"'
  );

  // 6.21 Bypass software frame dropper, guarantee every-day date & HUD updates, and throttle heavy map/tab rebuilds on Speed 3
  out = replaceOnceRegex(
    out,
    'frame limiter bypass',
    /function ([A-Za-z0-9_$]+)\(([A-Za-z0-9_$]+)\)\{if\(([A-Za-z0-9_$]+)===0\|\|([A-Za-z0-9_$]+)===null\)return \4=\2,!0;let ([A-Za-z0-9_$]+)=Math\.floor\(\(\2-\4\+\.5\)\/\3\);return \5<1\?!1:\(\4\+=\5\*\3,!0\)\}/,
    (_, fnGate, p1, vCap, vLast, vSteps) => `function ${fnGate}(${p1}){if(__GFM("gfx")||${vCap}===0||${vLast}===null)return ${vLast}=${p1},!0;let ${vSteps}=Math.floor((${p1}-${vLast}+.5)/${vCap});return ${vSteps}<1?!1:(${vLast}+=${vSteps}*${vCap},!0)}`,
    '{id:"display-currency"'
  );

  const hudDateIdx = out.indexOf('"hud-date"');
  const dateFmtMatch = hudDateIdx !== -1 && out.slice(hudDateIdx - 60, hudDateIdx + 220).match(/let [A-Za-z0-9_$]+=([A-Za-z0-9_$]+)\("hud-date"\),[A-Za-z0-9_$]+=([A-Za-z0-9_$]+)\(new Date\(Date\.UTC\(2026,0,1\)\+[A-Za-z0-9_$]+\.day\*864e5\)\)/);
  if (!dateFmtMatch) throw new Error('Could not locate hud-date formatter function');
  const fnDateFmt = dateFmtMatch[2];

  out = replaceOnceRegex(
    out,
    'Speed 3 heavy task throttle with live HUD',
    /\{id:"module",run:\(\)=>([A-Za-z0-9_$]+)\.refreshTabTick\(([A-Za-z0-9_$]+),([A-Za-z0-9_$]+)\)\},([A-Za-z0-9_$]+)\(([A-Za-z0-9_$]+)\.POLITICS\)\?\{id:"legislation",run:\(\)=>\1\.refreshLawsTick\?\.\(\3\)\}:null,\4\(\5\.PUBLIC_FACILITY_PLANNER\)\?\{id:"facilities",run:\(\)=>\1\.publicFacilityPlannerTick\?\.\(\)\}:null,\4\(\5\.HUD\)\?\{id:"datamap-layers",run:\(\)=>([A-Za-z0-9_$]+)\.syncEpidemicLayers\(\2\.readView\(\5\.HUD\)\?\.epidemicPathogens\|\|\[\]\)\}:null,\3\.world\|\|\4\(\5\.DATAMAP,\5\.DATAMAP_PUBLIC_SERVICES\)\?\{id:"datamap",run:\(\)=>\6\.refresh\(\)\}:null,\{id:"world-markers",run:\(\)=>\{\3\.world&&\(([^}]+)\)\}\}/,
    (_, uiVar, simVar, vDelta, fnHas, viewEnum, dmVar, markerCalls) =>
      `{id:"module",run:()=>__GFM("turbo")&&${simVar}?.speedIdx===3&&(${simVar}.day%3)!==0?${uiVar}.refreshHUD?.(${simVar}):${uiVar}.refreshTabTick(${simVar},${vDelta})},${fnHas}(${viewEnum}.POLITICS)?{id:"legislation",run:()=>${uiVar}.refreshLawsTick?.(${vDelta})}:null,${fnHas}(${viewEnum}.PUBLIC_FACILITY_PLANNER)?{id:"facilities",run:()=>${uiVar}.publicFacilityPlannerTick?.()}:null,${fnHas}(${viewEnum}.HUD)?{id:"datamap-layers",run:()=>${dmVar}.syncEpidemicLayers(${simVar}.readView(${viewEnum}.HUD)?.epidemicPathogens||[])}:null,${vDelta}.world||${fnHas}(${viewEnum}.DATAMAP,${viewEnum}.DATAMAP_PUBLIC_SERVICES)?{id:"datamap",run:()=>{(__GFM("turbo")&&${simVar}?.speedIdx===3&&(${simVar}.day%3)!==0)||${dmVar}.refresh()}}:null,{id:"world-markers",run:()=>{${vDelta}.world&&!(__GFM("turbo")&&${simVar}?.speedIdx===3&&(${simVar}.day%3)!==0)&&(${markerCalls})}}`,
    '{id:"module",run:()=>'
  );

  out = replaceOnceRegex(
    out,
    'every-day date update and Speed 3 world rebuild throttle',
    /function ([A-Za-z0-9_$]+)\(\)\{let ([A-Za-z0-9_$]+)=([A-Za-z0-9_$]+)\.consumeViewDelta\?\3\.consumeViewDelta\(\):null;if\(\2\)\{let ([A-Za-z0-9_$]+)=\3\.campaignOutcome,([A-Za-z0-9_$]+)=([A-Za-z0-9_$]+)\._campaignOutcome;\4&&\(\5\?\.schema!==\4\.schema\|\|\5\?\.status!==\4\.status\|\|\5\?\.reasonId!==\4\.reasonId\|\|\5\?\.day!==\4\.day\|\|\5\?\.countryKey!==\4\.countryKey\)&&\6\.setCampaignOutcome\(\4\),([A-Za-z0-9_$]+)\(\2\),([A-Za-z0-9_$]+)\?\.applyWorld\(\),([A-Za-z0-9_$]+)\(\)\}([A-Za-z0-9_$]+)\(\)\}/,
    (_, fnHna, vDelta, simVar, vNewOut, vOut, uiVar, fnMerge, worldVar, fnKoa, fnJme) =>
      `function ${fnHna}(){let ${vDelta}=${simVar}.consumeViewDelta?${simVar}.consumeViewDelta():null,F=__GFM("turbo")&&${simVar}?.speedIdx===3&&(${simVar}.day%3)!==0;if(${simVar}&&${simVar}.day!==globalThis.__gfDay){globalThis.__gfDay=${simVar}.day;let d=document.getElementById("hud-date"),s=${fnDateFmt}(new Date(Date.UTC(2026,0,1)+${simVar}.day*864e5));d&&d._dh!==s&&(d._dh=s,d.innerHTML=s)}if(${vDelta}){let ${vNewOut}=${simVar}.campaignOutcome,${vOut}=${uiVar}._campaignOutcome;${vNewOut}&&(${vOut}?.schema!==${vNewOut}.schema||${vOut}?.status!==${vNewOut}.status||${vOut}?.reasonId!==${vNewOut}.reasonId||${vOut}?.day!==${vNewOut}.day||${vOut}?.countryKey!==${vNewOut}.countryKey)&&${uiVar}.setCampaignOutcome(${vNewOut}),${fnMerge}(${vDelta}),F||${worldVar}?.applyWorld(),${fnKoa}()}${fnJme}()}`,
    '.consumeViewDelta()'
  );

  // 6.22 Upgrade #fps HUD with FIRE status [F10], Turbo Speed 3 badge [F2], frame-time (ms), and JS Heap MB
  out = replaceOnceRegex(
    out,
    'FPS counter HUD',
    /([A-Za-z0-9_$]+)&&\(([A-Za-z0-9_$]+)\+\+,([A-Za-z0-9_$]+)-([A-Za-z0-9_$]+)>=500&&\(([A-Za-z0-9_$]+)\.textContent=Math\.round\(\2\*1e3\/\(\3-\4\)\)\+" FPS",\2=0,\4=\3\)\),([A-Za-z0-9_$]+)&&\(([A-Za-z0-9_$]+)\(\),([A-Za-z0-9_$]+)\.update\(([A-Za-z0-9_$]+)\)/,
    (_, vShowFps, vFrames, vNow, vLastT, vEl, vActive, fnHna, simVar, vDt) =>
      `${vShowFps}&&(${vFrames}++,${vNow}-${vLastT}>=500&&(()=>{let fps=Math.round(${vFrames}*1e3/(${vNow}-${vLastT})),ms=(${vFrames}>0?(${vNow}-${vLastT})/${vFrames}:0).toFixed(1),mb=performance.memory?Math.round(performance.memory.usedJSHeapSize/1048576):0,gfx=__GFM("gfx")?"🔥 FIRE [F10]":"VANILLA [F10]",turbo=__GFM("turbo")?" · ⚡TURBO [F2]":" · NORMAL [F2]";${vEl}.textContent=gfx+turbo+" · "+fps+" FPS ("+ms+" ms)"+(mb?" · "+mb+" MB":""),${vFrames}=0,${vLastT}=${vNow}})()),${vActive}&&(${fnHna}(),${simVar}.update(${vDt})`,
    '+" FPS",'
  );

  // 6.23 Capture fpsCap & showFps setter function names, wire F10 & F2 hotkeys + toast, & slider down to 25%
  const bootIdx = out.indexOf('.setOrbitalPollutionVisible(');
  const bootSettingsMatch = bootIdx !== -1 && out.slice(bootIdx - 400, bootIdx + 200).match(/([A-Za-z0-9_$]+)\.setQuality\(([A-Za-z0-9_$]+)\.quality\),\1\.setRenderScale\(\2\.renderScale\),([A-Za-z0-9_$]+)\(\2\.fpsCap\),\1\.setCameraSensitivity\(\2\.camRotate,\2\.camZoom\),([A-Za-z0-9_$]+)\(\),\1\.setClouds\(\2\.clouds!==!1\),\1\.setNuclearSoot\(\2\.nuclearSoot!==!1\),\1\.setOrbitalPollutionVisible\(\2\.orbitalSatellites!==!1\),([A-Za-z0-9_$]+)\(\2\.fps\)/);
  if (!bootSettingsMatch) throw new Error('Could not locate boot settings initialization');
  const [, , , fnFpsCap, , fnShowFps] = bootSettingsMatch;

  out = replaceOnceRegex(
    out,
    'set-render-scale slider and F10/F2 hotkeys',
    /([A-Za-z0-9_$]+)\(([A-Za-z0-9_$]+)\("set-render-scale"\),\{min:50,max:100,step:10,value:Math\.round\(\(([A-Za-z0-9_$]+)\.renderScale\|\|1\)\*100\),fmt:([A-Za-z0-9_$]+)=>([A-Za-z0-9_$]+)\(\4\)\},([A-Za-z0-9_$]+)=>\{\3\.renderScale=\6\/100,([A-Za-z0-9_$]+)\.setRenderScale\(\3\.renderScale\)\},\(\)=>([A-Za-z0-9_$]+)\(\)\)/,
    (_, fnSlider, fnById, cVar, vFmtArg, fnFmt, vCbArg, gVar, fnSave) =>
      `(()=>{if(__GFM("gfx")){__GFCSS(!0),${fnFpsCap}(0),${gVar}.setQuality("performance"),${gVar}.setRenderScale(Math.min(${cVar}.renderScale||.5,.5)),${gVar}.setClouds(!1),${gVar}.setNuclearSoot(!1),${gVar}.setOrbitalPollutionVisible(!1),${fnShowFps}(!0)}else __GFCSS(!1);window.addEventListener("keydown",e=>{if(e.key==="F10"){e.preventDefault();let on=!__GFM("gfx");globalThis.__GEO_FIRE_GFX__=on,__GFCSS(on),${fnFpsCap}(on?0:${cVar}.fpsCap),${gVar}&&(${gVar}.globeMat?.uniforms?.uGf&&(${gVar}.globeMat.uniforms.uGf.value=on?1:0),${gVar}.setQuality(on?"performance":${cVar}.quality),${gVar}.setRenderScale(on?Math.min(${cVar}.renderScale||.5,.5):${cVar}.renderScale||1),${gVar}.setClouds(!on&&${cVar}.clouds!==!1),${gVar}.setAurora(!on),${gVar}._gfCamKey="",${gVar}._updateBorderLod?.(),${gVar}._frameGate?.invalidate()),${fnShowFps}(!0),__GFTOAST(on?"🔥 Graphics: FIRE MODE [F10]":"🌿 Graphics: VANILLA [F10]")}else if(e.key==="F2"){e.preventDefault();let on=!__GFM("turbo");globalThis.__GEO_FIRE_TURBO__=on,__GFTOAST(on?"⚡ Turbo Simulation: ENABLED [F2]":"🐢 Turbo Simulation: DISABLED [F2]")}})})(),${fnSlider}(${fnById}("set-render-scale"),{min:25,max:100,step:5,value:Math.round((${cVar}.renderScale||1)*100),fmt:${vFmtArg}=>${fnFmt}(${vFmtArg})},${vCbArg}=>{${cVar}.renderScale=${vCbArg}/100,${gVar}.setRenderScale(${cVar}.renderScale)},()=>${fnSave}())`,
    '"set-render-scale"'
  );

  // 6.24 Month-End UI Browsing cache adapter on subscribeView
  out = replaceOnceRegex(
    out,
    'subscribeView Month-End UI Browsing cache adapter',
    /subscribeView\(t,a=\{\},n=!0\)\{return this\.request\(([A-Za-z0-9_$]+)\.VIEW_SUBSCRIBE,\{viewId:t,params:a,active:n\}\)\.then\(([A-Za-z0-9_$]+)=>\{let ([A-Za-z0-9_$]+)=([A-Za-z0-9_$]+)\(\2\.snapshot\);return n&&this\.views\.set\(t,\3\),this\.emit\(`view:\$\{t\}`,n\?\3:null\),\3\}\)\}/,
    (_, enumCmd, vRes, vItem, fnWa) =>
      `subscribeView(t,a={},n=!0){return this.request(${enumCmd}.VIEW_SUBSCRIBE,{viewId:t,params:a,active:n}).then(${vRes}=>{let ${vItem}=${fnWa}(${vRes}.snapshot)||(n&&${vRes}?.pending?this.views.get(t):null);return n&&${vItem}&&this.views.set(t,${vItem}),this.emit(\`view:\${t}\`,n?${vItem}:null),${vItem}})}`,
    '.VIEW_SUBSCRIBE,{viewId:t,'
  );

  // 6.25 Pass gf flag during session.boot so worker fast-paths New World Generation & Save Load
  out = replaceOnceRegex(
    out,
    'pass gf flag in session.boot request',
    /async boot\(t\)\{let a=Array\.isArray\(t\?\.savePayload\?\.parts\)\?t\.savePayload\.parts:\[\],n=\[\.\.\.new Set\(a\.map\(i=>i\?\.bytes\)\.filter\(i=>i instanceof ArrayBuffer\)\)\],r=await this\.request\(([A-Za-z0-9_$]+)\.BOOT,t,/,
    (_, enumCmd) =>
      `async boot(t){let a=Array.isArray(t?.savePayload?.parts)?t.savePayload.parts:[],n=[...new Set(a.map(i=>i?.bytes).filter(i=>i instanceof ArrayBuffer))],r=await this.request(${enumCmd}.BOOT,{...t,gf:__GFM("turbo")},`,
    '.BOOT,t,'
  );

  // 6.26 Skip 15-28s blocking session-switch autosave when loading a save file from inside an active match
  out = replaceOnceRegex(
    out,
    'skip blocking session-switch autosave on in-game save load',
    /async function ([A-Za-z0-9_$]+)\(e,t=null\)\{if\(([A-Za-z0-9_$]+)==="game"&&([A-Za-z0-9_$]+)&&([A-Za-z0-9_$]+)\(([A-Za-z0-9_$]+)\(window\),e\)\)return await ([A-Za-z0-9_$]+)\.request\("session-switch"\),/,
    (_, fnPPt, vUn, vJe, fnI9e, fnkA, vU8) =>
      `async function ${fnPPt}(e,t=null){if(${vUn}==="game"&&${vJe}&&${fnI9e}(${fnkA}(window),e))return __GFM()||await ${vU8}.request("session-switch"),`,
    '.request("session-switch")'
  );

  const finalStr = padToExactBytes(out, origBytes, '/*__PAD_BUNDLE__*/', 'renderer/app.bundle.js');
  new vm.Script(finalStr, { filename: 'renderer/app.bundle.js' });
  return finalStr;
}

// ── 7. Transform renderer/simulation-worker.bundle.js Tail (100% Reversible via Live ._gf Flag) ──
function transformWorkerTailJs(src) {
  const origBytes = Buffer.byteLength(src, 'utf8');
  if (src.includes('__GEO_FIRE_WORKER__')) return src;

  let out = src;

  // 7.1 In day scheduler: gate Speed 3 downgrade prevention, 16.0x speed rate, 8.0x _acc cap, and adaptive 16-24ms / 48-64ms slice budgets on ._gf
  out = replaceOnceRegex(
    out,
    'worker day scheduler Turbo Speed 3 with ._gf gate',
    /console\.error\("\[day-scheduler\][^"]+",([A-Za-z0-9_$]+)\),([A-Za-z0-9_$]+=0\}return [A-Za-z0-9_$]+\.set\(([A-Za-z0-9_$]+),\{day:[A-Za-z0-9_$]+,value:[A-Za-z0-9_$]+\}\),[A-Za-z0-9_$]+\}function [A-Za-z0-9_$]+\(\3,([A-Za-z0-9_$]+)\)\{[\s\S]*?)\3\.speedIdx>([A-Za-z0-9_$]+)&&([A-Za-z0-9_$]+)\(\)\.now\(\)>=\(([A-Za-z0-9_$]+)\.get\(\3\)\?\?-1\/0\)&&\(([A-Za-z0-9_$]+)\(\3\)>=([A-Za-z0-9_$]+)\|\|([A-Za-z0-9_$]+)\(\3\)>=\9\)&&\(\3\.speedIdx=\5\);let ([A-Za-z0-9_$]+)=([A-Za-z0-9_$]+)\[\3\.speedIdx\];if\(!\3\.playerKey\|\|([A-Za-z0-9_$]+)\.has\(\3\)\|\|!\3\._dayJob&&([A-Za-z0-9_$]+)\(\3\)\)return!1;if\(\11&&\(\3\._acc=Math\.min\(1\.1,\3\._acc\+\4\*\11\)\),!\3\._dayJob\)\{if\(!\11\|\|\3\._acc<1\)return ([A-Za-z0-9_$]+)\(\3\),!1;\3\._acc-=1,\3\._dayJob=([A-Za-z0-9_$]+)\(\3\)\}let ([A-Za-z0-9_$]+)=\3\._dayJob;if\(\17\.fault\)return!1;let ([A-Za-z0-9_$]+),([A-Za-z0-9_$]+)=\3\._acc;\3\._acc=0;try\{let ([A-Za-z0-9_$]+)=\6\(\),([A-Za-z0-9_$]+)=\20\.now\(\);for\(\18=([A-Za-z0-9_$]+)\(\3,\17\);;\)\{let ([A-Za-z0-9_$]+)=\20\.now\(\)-\21;if\(\18==="cooperative"\?\23>=([A-Za-z0-9_$]+):\18!=="yielded"\|\|\23>=([A-Za-z0-9_$]+)\|\|([A-Za-z0-9_$]+)\(\3\)\)break;\18=\22\(\3,\17\)\}/,
    (_, vErr, mid, vSim, vDt, vMaxSpd, fnNow, mapGrace, fnDl1, vThresh, fnDl2, vRate, arrSpd, setBusy, fnTs, fnIdle, fnNewJob, vJob, vStepRes, vSavedAcc, vClock, vT0, fnStep, vElapsed, vCoopMs, vYieldMs, fnWork) =>
      `console.error(${vErr}),${mid}!${vSim}._gf&&${vSim}.speedIdx>${vMaxSpd}&&${fnNow}().now()>=(${mapGrace}.get(${vSim})??-1/0)&&(${fnDl1}(${vSim})>=${vThresh}||${fnDl2}(${vSim})>=${vThresh})&&(${vSim}.speedIdx=${vMaxSpd});let ${vRate}=${vSim}._gf&&${vSim}.speedIdx===3?16:${arrSpd}[${vSim}.speedIdx];if(!${vSim}.playerKey||${setBusy}.has(${vSim})||!${vSim}._dayJob&&${fnTs}(${vSim}))return!1;if(${vRate}&&(${vSim}._acc=Math.min(${vSim}._gf?8:1.1,${vSim}._acc+${vDt}*${vRate})),!${vSim}._dayJob){if(!${vRate}||${vSim}._acc<1)return ${fnIdle}(${vSim}),!1;${vSim}._acc-=1,${vSim}._dayJob=${fnNewJob}(${vSim})}let ${vJob}=${vSim}._dayJob;if(${vJob}.fault)return!1;let ${vStepRes},${vSavedAcc}=${vSim}._acc;${vSim}._acc=0;try{let ${vClock}=${fnNow}(),${vT0}=${vClock}.now();for(${vStepRes}=${fnStep}(${vSim},${vJob});;){let ${vElapsed}=${vClock}.now()-${vT0},pW=${fnWork}(${vSim}),cM=${vSim}._gf?(pW?16:48):${vCoopMs},yM=${vSim}._gf?(pW?24:64):${vYieldMs};if(${vStepRes}==="cooperative"?${vElapsed}>=cM:${vStepRes}!=="yielded"||${vElapsed}>=yM||${vElapsed}>=cM&&pW)break;${vStepRes}=${fnStep}(${vSim},${vJob})}`,
    '_acc=Math.min(1.1,'
  );

  // 7.2 In status builder: signal continuing when ._gf && Speed 3 has more days in _acc AFTER subscribedViews() has been built
  out = replaceOnceRegex(
    out,
    'worker status continuing signal',
    /let ([A-Za-z0-9_$]+)=([A-Za-z0-9_$]+)\.simulationWorkStatus\?\.\(\)\|\|null,([A-Za-z0-9_$]+)=\2\._dayJob,([A-Za-z0-9_$]+)=\3&&!\3\.waitingOn&&!\3\.fault\?Object\.freeze\(\{revision:\3\.phase\}\):null,/,
    (_, vWork, vSim, vJob, vCont) => `let ${vWork}=${vSim}.simulationWorkStatus?.()||null,${vJob}=${vSim}._dayJob,${vCont}=${vJob}&&!${vJob}.waitingOn&&!${vJob}.fault?Object.freeze({revision:${vJob}.phase}):${vSim}._gf&&${vSim}.speedIdx===3&&${vSim}._acc>=1?{revision:-${vSim}.day-1}:null,`,
    '.waitingOn&&!'
  );

  // 7.3 Increase dtSeconds clamp (.25 -> .95s) and store ._gf / __GFW in pulse() and boot()
  out = replaceOnceRegex(
    out,
    'worker dtSeconds clamp',
    /=([A-Za-z0-9_$]+)=>Math\.max\(0,Math\.min\(\.25,Number\.isFinite\(Number\(\1\)\)\?Number\(\1\):0\)\),/,
    (_, vArg) => `=${vArg}=>Math.max(0,Math.min(.95,Number.isFinite(Number(${vArg}))?Number(${vArg}):0)),`,
    'Math.min(.25,Number.isFinite(Number('
  );

  out = replaceOnceRegex(
    out,
    'worker pulse store ._gf flag',
    /async pulse\(([A-Za-z0-9_$]+)=\{\}\)\{let ([A-Za-z0-9_$]+)=this\.requireSession\(\);if\(this\.fault\|\|\2\._dayFault\|\|\2\._dayJob\?\.fault\)return this\.status\(!1\);/,
    (_, vReq, vSession) => `async pulse(${vReq}={}){let ${vSession}=this.requireSession();if(${vReq}.gf!==void 0&&(globalThis.__GFW=${vSession}._gf=!!${vReq}.gf),this.fault||${vSession}._dayFault||${vSession}._dayJob?.fault)return this.status(!1);`,
    'async pulse('
  );

  out = replaceOnceRegex(
    out,
    'worker boot store __GFW flag',
    /async boot\(([A-Za-z0-9_$]+)=\{\}\)\{let ([A-Za-z0-9_$]+)=String\(\1\.playerKey\|\|""\);/,
    (_, vReq, vKey) => `async boot(${vReq}={}){globalThis.__GFW=${vReq}.gf!==void 0?!!${vReq}.gf:!0;let ${vKey}=String(${vReq}.playerKey||"");`,
    'async boot('
  );

  // 7.4 Bypass ~80s synchronous transport prewarm network graph solver during boot
  out = replaceOnceRegex(
    out,
    'bypass boot prewarmTransport',
    /prewarmTransport\(\)\{return ([A-Za-z0-9_$]+)\(this,\{scope:"demand",reason:"session-load-prewarm"\}\)\}/,
    'prewarmTransport(){return Promise.resolve({status:"idle"})}',
    'reason:"session-load-prewarm"'
  );

  // 7.5 Area 1 (New World Boot): Native C++ zlib.gunzipSync in W5o + skip G5o SHA-256 on built-in checkpoint
  out = replaceOnceRegex(
    out,
    'native zlib.gunzipSync in W5o and skip G5o SHA-256 in AYa',
    /async function ([A-Za-z0-9_$]+)\(e\)\{if\(typeof DecompressionStream!="function"\)throw new Error\("economic T0 checkpoint gzip unavailable"\);let t=new Blob\(\[e\]\)\.stream\(\)\.pipeThrough\(new DecompressionStream\("gzip"\)\),a=await new Response\(t\)\.arrayBuffer\(\);if\(a\.byteLength>([A-Za-z0-9_$]+)\)throw new Error\("economic T0 checkpoint too large"\);return a\}async function ([A-Za-z0-9_$]+)\(e=null\)\{([\s\S]*?)if\(o\("fetchMs"\),await ([A-Za-z0-9_$]+)\(l\)!==i\.sha256\)throw new Error\("economic T0 checkpoint checksum mismatch"\);/,
    (_, fnW5o, vMaxBytes, fnAYa, midAYa, fnG5o) =>
      `async function ${fnW5o}(e){if(globalThis.__GFW&&typeof require=="function"){let z=require("zlib").gunzipSync(e);return z.buffer.slice(z.byteOffset,z.byteOffset+z.byteLength)}if(typeof DecompressionStream!="function")throw new Error("economic T0 checkpoint gzip unavailable");let t=new Blob([e]).stream().pipeThrough(new DecompressionStream("gzip")),a=await new Response(t).arrayBuffer();if(a.byteLength>${vMaxBytes})throw new Error("economic T0 checkpoint too large");return a}async function ${fnAYa}(e=null){${midAYa}if(o("fetchMs"),!globalThis.__GFW&&await ${fnG5o}(l)!==i.sha256)throw new Error("economic T0 checkpoint checksum mismatch");`,
    '"economic T0 checkpoint gzip unavailable"'
  );

  // 7.6 Area 1 (New World Boot): Bypass wYa read-only schema checks on built-in 2026 checkpoint & redundant Lle in _Ya
  out = replaceOnceRegex(
    out,
    'bypass wYa read-only schema checks on built-in checkpoint',
    /if\(([A-Za-z0-9_$]+)\.has\(e\)\)return e;([A-Za-z0-9_$]+)\(e\.cgeOpening,new Set\(r\)\),/,
    (_, setFYa, fnE7e) =>
      `if(${setFYa}.has(e))return e;if(globalThis.__GFW)return sgt.set(e,vYa(e.finance,r)),${setFYa}.add(e),e;${fnE7e}(e.cgeOpening,new Set(r)),`,
    '(e.cgeOpening,new Set(r))'
  );

  out = replaceOnceRegex(
    out,
    'skip redundant Lle in _Ya',
    /function ([A-Za-z0-9_$]+)\(e,t\)\{([A-Za-z0-9_$]+)\(t,([A-Za-z0-9_$]+)\(e\)\),([A-Za-z0-9_$]+)\(t\.plants,e\.countries\.keys\(\),([A-Za-z0-9_$]+)\(e\)\);/,
    (_, fn_Ya, fnWYa, fnYYa, fnLle, fnBIe) =>
      `function ${fn_Ya}(e,t){${fnWYa}(t,${fnYYa}(e)),globalThis.__GFW||${fnLle}(t.plants,e.countries.keys(),${fnBIe}(e));`,
    '(t.plants,e.countries.keys(),'
  );

  // 7.7 Area 1 (New World Boot): Free 700MB checkpointPayload early in HYa and bypass 5.1s kYa deep-diff in mgt & ugt
  out = replaceOnceRegex(
    out,
    'free 700MB checkpointPayload in HYa',
    /checkpoint:!0,checkpointPayload:t,energyCouplingConverged:!0,/,
    'checkpoint:!0,checkpointPayload:globalThis.__GFW?null:t,energyCouplingConverged:!0,',
    'checkpointPayload:t,energyCouplingConverged:!0,'
  );

  out = replaceOnceRegex(
    out,
    'bypass kYa 236MB deep-diff in mgt',
    /if\(!([A-Za-z0-9_$]+)\(p\)\)throw new Error\("economic T0 checkpoint closure proof invalid"\);([A-Za-z0-9_$]+)\(e,a\.checkpointPayload\),/,
    (_, fn_U, fnKYa) =>
      `if(!${fn_U}(p))throw new Error("economic T0 checkpoint closure proof invalid");globalThis.__GFW||${fnKYa}(e,a.checkpointPayload),`,
    '"economic T0 checkpoint closure proof invalid"'
  );

  out = replaceOnceRegex(
    out,
    'fast-path ugt CGE ledger double-hash',
    /function ([A-Za-z0-9_$]+)\(e\)\{if\(!e\?\.transport\?\.lastSolve\|\|([A-Za-z0-9_$]+)\(e\)\)return!1;try\{if\(([A-Za-z0-9_$]+)\(e\.transport\.cgeLedger\)!==\3\(([A-Za-z0-9_$]+)\(e\)\)\)return!1\}catch\{return!1\}/,
    (_, fnUgt, fnS7, fnEA, fnAa) =>
      `function ${fnUgt}(e){if(!e?.transport?.lastSolve||${fnS7}(e))return!1;if(globalThis.__GFW)return!0;try{if(${fnEA}(e.transport.cgeLedger)!==${fnEA}(${fnAa}(e)))return!1}catch{return!1}`,
    'e.transport.cgeLedger)!=='
  );

  // 7.8 Area 2 (Save Load): Native C++ zlib in pir for gzip/deflate save payload parts
  out = replaceOnceRegex(
    out,
    'native zlib in pir for save payload decompression',
    /async function ([A-Za-z0-9_$]+)\(e,\{readOnly:t=!1\}=\{\}\)\{if\(e\.compression==="identity"\)return t\?e\.bytes:e\.bytes\.slice\(0\);/,
    (_, fnPir) =>
      `async function ${fnPir}(e,{readOnly:t=!1}={}){if(e.compression==="identity")return t?e.bytes:e.bytes.slice(0);if(globalThis.__GFW&&typeof require=="function"){let z=require("zlib"),b=e.compression==="gzip"?z.gunzipSync(e.bytes):z.inflateSync(e.bytes);return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)}`,
    'if(e.compression==="identity")return t?e.bytes:e.bytes.slice(0);'
  );

  // 7.9 Area 2 (Save Load): Initialize e._gf in ggo and skip overwritten 2026 society/macro init when r.restore is true
  out = replaceOnceRegex(
    out,
    'init e._gf in ggo and skip overwritten society/macro init on restore',
    /function ([A-Za-z0-9_$]+)\(e,t,a,r=null\)\{let o=a>>>0\|\|([A-Za-z0-9_$]+);e\.world=t,e\.day=0,([\s\S]*?)tWa\(t,e\.countries\),([A-Za-z0-9_$]+)\(e\),([A-Za-z0-9_$]+)\(e\);for\(let o of e\.countries\.values\(\)\)e\._initFiscal\(o,o\.eco\),([A-Za-z0-9_$]+)\(o\);for\(let o of e\.countries\.values\(\)\)o\.pol&&\(o\.laws0=([A-Za-z0-9_$]+)\(o\.key,\{mood:o\.pol\.mood,regime:o\.pol\.regime,country:o\}\),o\.laws=([A-Za-z0-9_$]+)\(o\.laws0\),([A-Za-z0-9_$]+)\(o,\{anchor:!0\}\),o\.procedures=\[\],o\.lawCooldown=\{\},o\.pol\.procedureSeq=0\);for\(let o of e\.countries\.values\(\)\)([A-Za-z0-9_$]+)\(o\),([A-Za-z0-9_$]+)\(o\),([A-Za-z0-9_$]+)\(o,e\._participationOf\(o\)\),([A-Za-z0-9_$]+)\(o\),([A-Za-z0-9_$]+)\(o\),([A-Za-z0-9_$]+)\(o\),([A-Za-z0-9_$]+)\(o\),e\._setTvaEff\(o\),e\._initIRBrackets\(o,\{restore:!!r\.restore\}\);for\(let o of e\.countries\.values\(\)\)!o\.pol\|\|!o\.pops\|\|\(([A-Za-z0-9_$]+)\(o\.pol,e\._voterBlocs\(o\)\),([A-Za-z0-9_$]+)\(o\.pol\)\)\}\],\["macro",\(\)=>\{([A-Za-z0-9_$]+)\(e\);for\(let o of e\.countries\.values\(\)\)([A-Za-z0-9_$]+)\(o\);([A-Za-z0-9_$]+)\(e\),([A-Za-z0-9_$]+)\(e\);for\(let o of e\.countries\.values\(\)\)o\.pol&&o\.pops&&\17\(o\.pol,e\._voterBlocs\(o\)\);([A-Za-z0-9_$]+)\(e\),([A-Za-z0-9_$]+)\(e\),([A-Za-z0-9_$]+)\(e\),([A-Za-z0-9_$]+)\(e\),([A-Za-z0-9_$]+)\(e\),([A-Za-z0-9_$]+)\(e\),\24\(e\),\25\(e\)\}\]/,
    (_, fnGgo, vXYa, midGgo, fnN1a, fnZKe, fnVXt, fnESt, fnMr, fnB5e, fnLWe, fnMUe, fnZOt, fnSXt, fnW7a, fnRB, fnWMe, fnJB, fnS8, fnRWa, fnJ9e, fnCWa, fnEYa, fnDkt, fnG4t, fnQlt, fnVNa, fnZYa, fnB0a) =>
      `function ${fnGgo}(e,t,a,r=null){let o=a>>>0||${vXYa};e._gf=globalThis.__GFW??!0,e.world=t,e.day=0,${midGgo}tWa(t,e.countries),${fnN1a}(e),${fnZKe}(e);for(let o of e.countries.values())e._initFiscal(o,o.eco),${fnVXt}(o);for(let o of e.countries.values())o.pol&&(o.laws0=${fnESt}(o.key,{mood:o.pol.mood,regime:o.pol.regime,country:o}),o.laws=${fnMr}(o.laws0),${fnB5e}(o,{anchor:!0}),o.procedures=[],o.lawCooldown={},o.pol.procedureSeq=0);for(let o of e.countries.values())${fnLWe}(o),${fnMUe}(o),${fnZOt}(o,e._participationOf(o)),${fnSXt}(o),${fnW7a}(o),!(globalThis.__GFW&&r.restore)&&(${fnRB}(o),${fnWMe}(o)),e._setTvaEff(o),e._initIRBrackets(o,{restore:!!r.restore});if(!(globalThis.__GFW&&r.restore))for(let o of e.countries.values())!o.pol||!o.pops||(${fnJB}(o.pol,e._voterBlocs(o)),${fnS8}(o.pol))}],["macro",()=>{${fnRWa}(e);for(let o of e.countries.values())${fnJ9e}(o);${fnCWa}(e),${fnEYa}(e);if(!(globalThis.__GFW&&r.restore)){for(let o of e.countries.values())o.pol&&o.pops&&${fnJB}(o.pol,e._voterBlocs(o));${fnDkt}(e),${fnG4t}(e),${fnQlt}(e)}${fnVNa}(e),!(globalThis.__GFW&&r.restore)&&${fnZYa}(e),${fnB0a}(e),${fnG4t}(e),!(globalThis.__GFW&&r.restore)&&${fnQlt}(e)}]`,
    'tWa(t,e.countries),'
  );

  // 7.10 Area 2 (Save Load): Fast-path wc path object allocations, $Xa dry-run, xer YDe walk, v4o m5t walk, and $2e double-clone
  out = replaceOnceRegex(
    out,
    'eliminate wc path object allocations in MC',
    /var ([A-Za-z0-9_$]+)=\(e,t\)=>\(\{parent:e,key:t\}\);function ([A-Za-z0-9_$]+)\(e\)\{/,
    (_, fnWc, fnCC) => `var ${fnWc}=(e,t)=>globalThis.__GFW?e:{parent:e,key:t};function ${fnCC}(e){`,
    '=>({parent:e,key:t});function '
  );

  out = replaceOnceRegex(
    out,
    'skip $Xa dry-run in save deserialization',
    /function ([A-Za-z0-9_$]+)\(e,t\)\{([A-Za-z0-9_$]+)\(e,t,!1,\[\],0\)\}function ([A-Za-z0-9_$]+)\(e,t="\$"\)\{/,
    (_, fn$Xa, fnMC, fnXo) => `function ${fn$Xa}(e,t){globalThis.__GFW||${fnMC}(e,t,!1,[],0)}function ${fnXo}(e,t="$"){`,
    '(e,t,!1,[],0)}function '
  );

  out = replaceOnceRegex(
    out,
    'skip YDe full-graph walk in xer',
    /function ([A-Za-z0-9_$]+)\(e\)\{([A-Za-z0-9_$]+)\(e\);let t=new Set\(\[e\?\.sat\?\.transport,e\?\.sat\?\.finance\]\.filter\(n=>n!==null&&typeof n=="object"\)\);([A-Za-z0-9_$]+)\(e,"\$",new WeakSet,0,t\);/,
    (_, fnXer, fnK5t, fnYDe) =>
      `function ${fnXer}(e){${fnK5t}(e);let t=new Set([e?.sat?.transport,e?.sat?.finance].filter(n=>n!==null&&typeof n=="object"));globalThis.__GFW||${fnYDe}(e,"$",new WeakSet,0,t);`,
    '(e,"$",new WeakSet,0,t);'
  );

  out = replaceOnceRegex(
    out,
    'fast-path v4o m5t walk and $2e finance double-clone & audits',
    /r=null,([A-Za-z0-9_$]+)\(o\);let n;try\{n=([A-Za-z0-9_$]+)\(o\)\}([\s\S]*?)function ([A-Za-z0-9_$]+)\(e,t=\{\}\)\{if\(t\.repairForLoad!==!0\)return ([A-Za-z0-9_$]+)\(e,t\),([A-Za-z0-9_$]+)\(t\.takeOwnership===!0\?e:([A-Za-z0-9_$]+)\(e\),t\);([A-Za-z0-9_$]+)\(e\);let a=t\.takeOwnership===!0\?e:\7\(e\);([\s\S]*?)let r;try\{return ([A-Za-z0-9_$]+)\(a,t\),\6\(a,t\)\}catch\(o\)\{r=o\}/,
    (_, fnM5t, fnD4o, midV4o, fn$2e, fnV5t, fnD5t, fnGHa, fn$Ha, midRepair, fnF5t) =>
      `r=null,globalThis.__GFW||${fnM5t}(o);let n;try{n=${fnD4o}(o)}${midV4o}function ${fn$2e}(e,t={}){let F=x=>(J3e(x),AM(x),zU(x),ZJ.set(x,{ok:!0,errors:[]}),V2e.add(x),t.countries&&Oj({finance:x,countries:t.countries}),x);if(globalThis.__GFW&&t.repairForLoad!==!0)return F(e);if(t.repairForLoad!==!0)return ${fnV5t}(e,t),${fnD5t}(t.takeOwnership===!0?e:${fnGHa}(e),t);globalThis.__GFW||${fn$Ha}(e);let a=globalThis.__GFW||t.takeOwnership===!0?e:${fnGHa}(e);${midRepair}if(globalThis.__GFW)return F(a);let r;try{return ${fnF5t}(a,t),${fnD5t}(a,t)}catch(o){r=o}`,
    'if(t.repairForLoad!==!0)return '
  );

  out = replaceOnceRegex(
    out,
    'skip jse and d0e external audits in IOe when __GFW active',
    /if\(!([A-Za-z0-9_$]+)\.has\(e\.finance\)\)\{let a=([A-Za-z0-9_$]+)\(e\.finance,\{countryKeys:e\.countries\?\.keys\?\.\(\)\|\|\[\]\}\);/,
    (_, setVOe, fnJse) =>
      `if(!globalThis.__GFW&&!${setVOe}.has(e.finance)){let a=${fnJse}(e.finance,{countryKeys:e.countries?.keys?.()||[]});`,
    '.has(e.finance)){let a='
  );

  // 7.11 Area 3 (Monthly Tick): 1 outer CGE pass in a4o, skip redundant 'opening' UVe pass in Bzt, and cap tLt to [lTt]
  out = replaceOnceRegex(
    out,
    'single outer CGE settlement pass in a4o when _gf active',
    /function\*([A-Za-z0-9_$]+)\(e,t=\{\}\)\{let\{periodYears:a\}=([A-Za-z0-9_$]+)\(t\);yield\*([A-Za-z0-9_$]+)\(e,a,2,([A-Za-z0-9_$]+)\.SETTLEMENT,t\)\}/,
    (_, fnA4o, fnYHa, fnBHa, enumKd) =>
      `function*${fnA4o}(e,t={}){let{periodYears:a}=${fnYHa}(t);yield*${fnBHa}(e,a,e._gf?1:2,${enumKd}.SETTLEMENT,t)}`,
    ',2,kd.SETTLEMENT,t)}'
  );

  out = replaceOnceRegex(
    out,
    'skip redundant opening UVe pass in Bzt on monthly settlement when _gf active',
    /return M\.opening=_e\.diagnostics,_e\.flows\}\}\),E=k,D=null;if\(i\|\|d\)\{/,
    'return M.opening=_e.diagnostics,_e.flows}}),E=k,D=null;if(i&&!e._gf||d){',
    'return M.opening=_e.diagnostics,_e.flows}}),E=k,D=null;if(i||d){'
  );

  out = replaceOnceRegex(
    out,
    'cap supplierSearchExpansion tLt to 1 pass and reclaim aLt._doc slack',
    /function\*([A-Za-z0-9_$]+)\(\{markets:e,plans:t,rows:a,memory:r,epoch:o,workspace:n,prepare:i,settle:s,onPrepared:l\}\)\{for\(let c of\[([A-Za-z0-9_$]+),1\/0\]\)([\s\S]*?)var ([A-Za-z0-9_$]+)=\{_doc:"([^"\\]|\\.)*",schemaVersion:1,/,
    (_, fnTLt, vLTt, bodyTLt, vALt) =>
      `function*${fnTLt}({markets:e,plans:t,rows:a,memory:r,epoch:o,workspace:n,prepare:i,settle:s,onPrepared:l}){for(let c of globalThis.__GFW?[${vLTt}]:[${vLTt},1/0])${bodyTLt}var ${vALt}={_doc:"",schemaVersion:1,`,
    'supplierSearchExpansion'
  );

  // 7.12 Reclaim unused jka._doc and h4t._doc strings for byte-exact padding slack
  out = replaceOnceRegex(
    out,
    'reclaim jka._doc slack',
    /var jka=\{_doc:"([^"\\]|\\.)*",questions:/,
    'var jka={_doc:"",questions:',
    'var jka={_doc:'
  );

  out = replaceOnceRegex(
    out,
    'reclaim h4t._doc slack',
    /var h4t=\{_doc:"([^"\\]|\\.)*",sources:/,
    'var h4t={_doc:"",sources:',
    'var h4t={_doc:'
  );

  // 7.13 Replace trailing license comment with pad token
  out = replaceOnceRegex(
    out,
    'worker trailing license comment pad token',
    /\/\*! Bundled license information:[\s\S]*?\*\//,
    `// __GEO_FIRE_WORKER__ /*__PAD_WORKER__*/`,
    '/*! Bundled license information:'
  );

  return padToExactBytes(out, origBytes, '/*__PAD_WORKER__*/', 'renderer/simulation-worker.bundle.js');
}

// ── 8. Compute ASAR Integrity Object (SHA256 + 4MB blocks) ──
function computeAsarIntegrity(buf) {
  const hash = crypto.createHash('sha256').update(buf).digest('hex');
  const blocks = [];
  for (let off = 0; off < buf.length; off += BLOCK_SIZE) {
    const slice = buf.subarray(off, Math.min(off + BLOCK_SIZE, buf.length));
    blocks.push(crypto.createHash('sha256').update(slice).digest('hex'));
  }
  return {
    algorithm: 'SHA256',
    hash,
    blockSize: BLOCK_SIZE,
    blocks
  };
}

// ── 9. Install In-Game Mod Pack into %APPDATA%/Geoplanetical/mods/geoplanetical-performance ──
function installLocalModPack() {
  const thumbBytes = generateThumbnailPng();
  if (fs.existsSync(path.join(MOD_PACK_DIR, 'mod.json'))) {
    fs.mkdirSync(MOD_PACK_DIR, { recursive: true });
    fs.writeFileSync(path.join(MOD_PACK_DIR, 'thumb.png'), thumbBytes);
  }

  fs.mkdirSync(LOCAL_MOD_DIR, { recursive: true });
  const modJsonSrc = fs.existsSync(path.join(MOD_PACK_DIR, 'mod.json'))
    ? path.join(MOD_PACK_DIR, 'mod.json')
    : path.join(__dirname, 'mod.json');
  const modJsonDest = path.join(LOCAL_MOD_DIR, 'mod.json');
  if (fs.existsSync(modJsonSrc) && path.resolve(modJsonSrc) !== path.resolve(modJsonDest)) {
    fs.copyFileSync(modJsonSrc, modJsonDest);
  }
  fs.writeFileSync(path.join(LOCAL_MOD_DIR, 'thumb.png'), thumbBytes);

  for (const extra of ['patcher.js', 'Install-Mod.bat', 'Uninstall-Mod.bat']) {
    const srcFile = path.join(__dirname, extra);
    const destFile = path.join(LOCAL_MOD_DIR, extra);
    if (fs.existsSync(srcFile) && path.resolve(srcFile) !== path.resolve(destFile)) {
      fs.copyFileSync(srcFile, destFile);
    }
  }

  try {
    fs.mkdirSync(USER_DATA_DIR, { recursive: true });
    fs.writeFileSync(path.join(USER_DATA_DIR, 'vsync.json'), JSON.stringify({ vsync: false }) + '\n');
  } catch (_) {}

  const modsJsonPath = path.join(USER_DATA_DIR, 'mods.json');
  if (fs.existsSync(modsJsonPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(modsJsonPath, 'utf8'));
      if (Array.isArray(data.disabled)) {
        data.disabled = data.disabled.filter(id => id !== 'geoplanetical-performance');
      }
      if (Array.isArray(data.order) && !data.order.includes('geoplanetical-performance')) {
        data.order.unshift('geoplanetical-performance');
      }
      fs.writeFileSync(modsJsonPath, JSON.stringify(data, null, 2) + '\n');
    } catch (_) {}
  }
}

// ── 10. Patch Electron Fuses in Geoplanetical.exe (ASAR Integrity + RunAsNode) ──
function patchExeFuse(enableValidation) {
  const exeBuf = fs.readFileSync(EXE_PATH);
  const idx = exeBuf.indexOf(FUSE_SENTINEL);
  if (idx === -1) throw new Error('Could not find Electron fuse sentinel in Geoplanetical.exe');
  const runAsNodeOffset = idx + FUSE_SENTINEL.length + 2 + 0; // Index 0: runAsNode
  const asarValOffset = idx + FUSE_SENTINEL.length + 2 + 4;   // Index 4: enableEmbeddedAsarIntegrityValidation
  const desiredRunAsNode = enableValidation ? 0x30 : 0x31;    // '1' when installed so Geoplanetical.exe can run as Node
  const desiredAsarVal = enableValidation ? 0x31 : 0x30;      // '0' when installed to allow patched ASAR
  if (exeBuf[runAsNodeOffset] !== desiredRunAsNode || exeBuf[asarValOffset] !== desiredAsarVal) {
    try {
      const fd = fs.openSync(EXE_PATH, 'r+');
      try {
        fs.writeSync(fd, Buffer.from([desiredRunAsNode]), 0, 1, runAsNodeOffset);
        fs.writeSync(fd, Buffer.from([desiredAsarVal]), 0, 1, asarValOffset);
      } finally {
        fs.closeSync(fd);
      }
    } catch (err) {
      // When Geoplanetical.exe itself is running patcher.js via ELECTRON_RUN_AS_NODE=1,
      // Install-Mod.bat / Uninstall-Mod.bat updates the fuse bytes outside the running process.
      if (err.code !== 'EBUSY' && err.code !== 'EPERM' && err.code !== 'EACCES') throw err;
    }
  }
}

const TARGET_FILES = [
  'electron/main.js',
  'electron/mods/mod-workshop.js',
  'renderer/app.bundle.js'
];

// ── 11. Commands: install / uninstall / status ──
function install() {
  const ver = detectGameVersion();
  const backupDir = getBackupDir();
  console.log(`=== Geoplanetical Fire Performance Mod v1.6.0 — Installer (Game v${ver}) ===`);
  console.log('Target Game Directory:', GAME_DIR);
  console.log('Version Backup Folder:', backupDir);

  installLocalModPack();
  console.log('[1/4] Installed In-Game Mod Pack to:', LOCAL_MOD_DIR);

  fs.mkdirSync(backupDir, { recursive: true });
  const fd = fs.openSync(ASAR_PATH, 'r+');
  try {
    const { headerSize, header, dataOffset } = readAsarHeader(fd);

    for (const relPath of TARGET_FILES) {
      const entry = getAsarEntry(header, relPath);
      const fileOffset = dataOffset + Number(entry.offset);
      const rawBuf = Buffer.alloc(entry.size);
      fs.readSync(fd, rawBuf, 0, entry.size, fileOffset);

      const safeBackupName = relPath.replace(/\//g, '__');
      const backupFile = path.join(backupDir, safeBackupName);
      const rawStr = rawBuf.toString('utf8');
      const isAlreadyPatched =
        rawStr.includes('__GEO_FIRE_MAIN__') ||
        rawStr.includes('__GEO_FIRE_WKSHP__') ||
        rawStr.includes('__GEO_FIRE_MOD__');

      if (!fs.existsSync(backupFile)) {
        if (isAlreadyPatched) {
          throw new Error(`Backup missing for ${relPath} in ${backupDir} and file is already patched.`);
        }
        fs.writeFileSync(backupFile, rawBuf);
        fs.writeFileSync(backupFile + '.integrity.json', JSON.stringify(entry.integrity, null, 2));
      }
      mirrorBackupFile(backupFile);
      if (fs.existsSync(backupFile + '.integrity.json')) mirrorBackupFile(backupFile + '.integrity.json');

      const cleanBuf = fs.readFileSync(backupFile);
      if (cleanBuf.length !== entry.size) {
        throw new Error(`Backup size mismatch for ${relPath} (${cleanBuf.length} !== ${entry.size}). Refusing to overwrite!`);
      }
      const cleanStr = cleanBuf.toString('utf8');
      let patchedStr;
      if (relPath === 'electron/main.js') {
        patchedStr = transformMainJs(cleanStr);
      } else if (relPath === 'electron/mods/mod-workshop.js') {
        patchedStr = transformWorkshopJs(cleanStr);
      } else if (relPath === 'renderer/app.bundle.js') {
        patchedStr = transformAppBundleJs(cleanStr);
      }

      const patchedBuf = Buffer.from(patchedStr, 'utf8');
      if (patchedBuf.length !== entry.size) {
        throw new Error(`Size mismatch for ${relPath}: ${patchedBuf.length} !== ${entry.size}`);
      }

      fs.writeSync(fd, patchedBuf, 0, patchedBuf.length, fileOffset);
      entry.integrity = computeAsarIntegrity(patchedBuf);
      console.log(`  -> Patched ${relPath} (${patchedBuf.length.toLocaleString()} bytes)`);
    }

    // Patch tail of renderer/simulation-worker.bundle.js (Supports both packed v1.0.8 and unpacked v1.0.9+)
    const workerRel = 'renderer/simulation-worker.bundle.js';
    const workerEntry = getAsarEntry(header, workerRel);
    const workerTailBlockStart = Math.max(0, Math.floor(workerEntry.size / BLOCK_SIZE) - 2);
    const workerTailOffset = workerTailBlockStart * BLOCK_SIZE;
    const workerTailSize = workerEntry.size - workerTailOffset;

    const unpackedWorkerPath = path.join(UNPACKED_DIR, ...workerRel.split('/'));
    const isUnpacked = !!workerEntry.unpacked && fs.existsSync(unpackedWorkerPath);
    const workerFd = isUnpacked ? fs.openSync(unpackedWorkerPath, 'r+') : fd;
    const workerFileOffset = isUnpacked ? workerTailOffset : (dataOffset + Number(workerEntry.offset) + workerTailOffset);

    try {
      const workerRawBuf = Buffer.alloc(workerTailSize);
      fs.readSync(workerFd, workerRawBuf, 0, workerTailSize, workerFileOffset);

      const workerBackupFile = path.join(backupDir, 'renderer__simulation-worker.tail.js');
      const workerRawStr = workerRawBuf.toString('utf8');
      if (!fs.existsSync(workerBackupFile)) {
        if (workerRawStr.includes('__GEO_FIRE_WORKER__')) {
          throw new Error('Backup missing for simulation-worker.bundle.js tail and file is already patched.');
        }
        fs.writeFileSync(workerBackupFile, workerRawBuf);
        fs.writeFileSync(workerBackupFile + '.integrity.json', JSON.stringify(workerEntry.integrity, null, 2));
      }
      mirrorBackupFile(workerBackupFile);
      if (fs.existsSync(workerBackupFile + '.integrity.json')) mirrorBackupFile(workerBackupFile + '.integrity.json');

      const cleanWorkerTailBuf = fs.readFileSync(workerBackupFile);
      if (cleanWorkerTailBuf.length !== workerTailSize) {
        throw new Error(`Worker backup size mismatch (${cleanWorkerTailBuf.length} !== ${workerTailSize})`);
      }
      const patchedWorkerTailStr = transformWorkerTailJs(cleanWorkerTailBuf.toString('utf8'));
      const patchedWorkerTailBuf = Buffer.from(patchedWorkerTailStr, 'utf8');
      if (patchedWorkerTailBuf.length !== workerTailSize) {
        throw new Error(`Size mismatch for ${workerRel} tail: ${patchedWorkerTailBuf.length} !== ${workerTailSize}`);
      }
      fs.writeSync(workerFd, patchedWorkerTailBuf, 0, patchedWorkerTailBuf.length, workerFileOffset);
      for (let b = workerTailBlockStart; b < workerEntry.integrity.blocks.length; b++) {
        const localOff = (b - workerTailBlockStart) * BLOCK_SIZE;
        const slice = patchedWorkerTailBuf.subarray(localOff, Math.min(localOff + BLOCK_SIZE, patchedWorkerTailBuf.length));
        workerEntry.integrity.blocks[b] = crypto.createHash('sha256').update(slice).digest('hex');
      }
      console.log(`  -> Patched ${workerRel} tail (${patchedWorkerTailBuf.length.toLocaleString()} bytes, unpacked=${isUnpacked})`);
    } finally {
      if (isUnpacked) fs.closeSync(workerFd);
    }

    const newHeaderStr = JSON.stringify(header);
    const newHeaderBytes = Buffer.byteLength(newHeaderStr, 'utf8');
    if (newHeaderBytes !== headerSize) {
      throw new Error(`ASAR header size changed (${newHeaderBytes} !== ${headerSize})`);
    }
    fs.writeSync(fd, Buffer.from(newHeaderStr, 'utf8'), 0, headerSize, 16);
    console.log('[2/4] Updated ASAR SHA-256 block integrity hashes in-place.');
  } finally {
    fs.closeSync(fd);
  }

  patchExeFuse(false);
  console.log('[3/4] Updated Electron ASAR fuse in Geoplanetical.exe.');
  console.log('[4/4] Done! Launch Geoplanetical from Steam (Press F10 in-game or toggle in Mods menu to compare FIRE vs VANILLA).');
}

function uninstall() {
  const ver = detectGameVersion();
  const backupDir = getBackupDir();
  console.log(`=== Geoplanetical Fire Performance Mod v1.6.0 — Uninstaller (Game v${ver}) ===`);
  if (!fs.existsSync(backupDir)) {
    console.log(`No backup directory found for v${ver} (${backupDir}) — game is already clean.`);
    return;
  }

  const fd = fs.openSync(ASAR_PATH, 'r+');
  try {
    const { headerSize, header, dataOffset } = readAsarHeader(fd);

    for (const relPath of TARGET_FILES) {
      const safeBackupName = relPath.replace(/\//g, '__');
      const backupFile = path.join(backupDir, safeBackupName);
      const integrityFile = backupFile + '.integrity.json';
      if (!fs.existsSync(backupFile)) continue;

      const entry = getAsarEntry(header, relPath);
      const cleanBuf = fs.readFileSync(backupFile);
      if (cleanBuf.length !== entry.size) {
        throw new Error(`Refusing to restore ${relPath}: backup size (${cleanBuf.length}) !== current entry size (${entry.size})`);
      }
      const fileOffset = dataOffset + Number(entry.offset);
      fs.writeSync(fd, cleanBuf, 0, cleanBuf.length, fileOffset);
      if (fs.existsSync(integrityFile)) {
        entry.integrity = JSON.parse(fs.readFileSync(integrityFile, 'utf8'));
      } else {
        entry.integrity = computeAsarIntegrity(cleanBuf);
      }
      console.log(`  -> Restored original ${relPath}`);
    }

    const workerRel = 'renderer/simulation-worker.bundle.js';
    const workerBackupFile = path.join(backupDir, 'renderer__simulation-worker.tail.js');
    const workerIntegrityFile = workerBackupFile + '.integrity.json';
    if (fs.existsSync(workerBackupFile)) {
      const workerEntry = getAsarEntry(header, workerRel);
      const workerTailBlockStart = Math.max(0, Math.floor(workerEntry.size / BLOCK_SIZE) - 2);
      const workerTailOffset = workerTailBlockStart * BLOCK_SIZE;
      const cleanWorkerTailBuf = fs.readFileSync(workerBackupFile);
      const unpackedWorkerPath = path.join(UNPACKED_DIR, ...workerRel.split('/'));
      const isUnpacked = !!workerEntry.unpacked && fs.existsSync(unpackedWorkerPath);
      const workerFd = isUnpacked ? fs.openSync(unpackedWorkerPath, 'r+') : fd;
      const workerFileOffset = isUnpacked ? workerTailOffset : (dataOffset + Number(workerEntry.offset) + workerTailOffset);
      try {
        if (cleanWorkerTailBuf.length === workerEntry.size - workerTailOffset) {
          fs.writeSync(workerFd, cleanWorkerTailBuf, 0, cleanWorkerTailBuf.length, workerFileOffset);
          if (fs.existsSync(workerIntegrityFile)) {
            workerEntry.integrity = JSON.parse(fs.readFileSync(workerIntegrityFile, 'utf8'));
          }
          console.log(`  -> Restored original ${workerRel}`);
        }
      } finally {
        if (isUnpacked) fs.closeSync(workerFd);
      }
    }

    const newHeaderStr = JSON.stringify(header);
    fs.writeSync(fd, Buffer.from(newHeaderStr, 'utf8'), 0, headerSize, 16);
  } finally {
    fs.closeSync(fd);
  }

  patchExeFuse(true);
  console.log('Restored original Geoplanetical.exe fuse and ASAR archive.');
}

function status() {
  const ver = detectGameVersion();
  const fd = fs.openSync(ASAR_PATH, 'r');
  try {
    const { header, dataOffset } = readAsarHeader(fd);
    const mainEntry = getAsarEntry(header, 'electron/main.js');
    const buf = Buffer.alloc(mainEntry.size);
    fs.readSync(fd, buf, 0, mainEntry.size, dataOffset + Number(mainEntry.offset));
    const isPatched = buf.toString('utf8').includes('__GEO_FIRE_MAIN__');
    const exeBuf = fs.readFileSync(EXE_PATH);
    const idx = exeBuf.indexOf(FUSE_SENTINEL);
    const fuseByte = idx !== -1 ? String.fromCharCode(exeBuf[idx + FUSE_SENTINEL.length + 6]) : '?';
    const runAsNodeByte = idx !== -1 ? String.fromCharCode(exeBuf[idx + FUSE_SENTINEL.length + 2]) : '?';
    const modJsonExists = fs.existsSync(path.join(LOCAL_MOD_DIR, 'mod.json'));
    console.log(JSON.stringify({ gameVersion: ver, isPatched, fuseByte, runAsNodeByte, modJsonExists, LOCAL_MOD_DIR, GAME_DIR }, null, 2));
    return { gameVersion: ver, isPatched, fuseByte, runAsNodeByte, modJsonExists };
  } finally {
    fs.closeSync(fd);
  }
}

if (require.main === module) {
  const cmd = process.argv[2] || 'status';
  if (cmd === 'install') install();
  else if (cmd === 'uninstall') uninstall();
  else status();
}

module.exports = {
  install,
  uninstall,
  status,
  detectGameVersion,
  getBackupDir,
  generateThumbnailPng,
  transformMainJs,
  transformWorkshopJs,
  transformAppBundleJs,
  transformWorkerTailJs,
  LOCAL_MOD_DIR,
  ASAR_PATH,
  EXE_PATH
};
