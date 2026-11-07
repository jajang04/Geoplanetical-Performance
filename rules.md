# Geoplanetical Fire Performance Mod — Developer Rules & Guidelines

> **Mandatory AI Assistant Rules & Standard Operating Procedure (SOP)**  
> Every modification, fix, optimization, or feature implementation in this repository MUST strictly comply with these rules.

---

## 1. Mandatory 6-Step Implementation Pipeline

Whenever any code change, performance optimization, or bug fix is implemented, you must execute all six steps in order before concluding the task:

```
[1. Patch Code] ➔ [2. Run Test Suite] ➔ [3. Update mod.json] ➔ [4. Sync to AppData] ➔ [5. Update CHANGELOG] ➔ [6. Git Commit & Tag]
```

### Step 1: Code Patching & Integrity
- **Exact Byte Padding**: Replacements in bundled scripts (`renderer/app.bundle.js`, `renderer/simulation-worker.bundle.js`, `electron/main.js`) must preserve identical byte lengths using space padding.
- **Active-Mod Reversible Gating**: Any patched code must dynamically check if the mod is enabled in `localStorage` or active state. If the player disables the mod in the in-game Mods menu, vanilla behavior must be 100% restored with zero side effects.
- **Preserve Documentation**: Never remove existing comments or unrelated code blocks.

### Step 2: Verification (`node test.js`)
- Always execute `node test.js` and ensure all 4 test suites pass:
  1. Thumbnail validation (512x512 PNG, $\le 2$ MB).
  2. Byte-length integrity, syntax check via Node VM, and reversible gating.
  3. ASAR SHA-256 header block hash and Electron fuse (`0` for ASAR integrity check, `1` for runAsNode) verification.
  4. Native game `validateModManifest()` and `stripImageMetadata()` validation.

### Step 3: Mod Manifest Constraints (`mod-pack/mod.json`)
- **Version Bumping**:
  - Automatically increment patch version (`v1.5.1` ➔ `v1.5.2`) for bug fixes and optimizations.
  - Increment minor version (`v1.5.x` ➔ `v1.6.0`) for new player-facing features.
  - The `version` string must never exceed **64 characters** (`MOD_TEXT_LIMITS.version = 64`).
- **Description Character Ceiling**:
  - The `description` field has a strict hard limit of **2,000 characters** (`MOD_TEXT_LIMITS.description = 2000`).
  - Always verify with: `node -e "const m=require('./mod-pack/mod.json'); console.log(m.description.length);"`
  - When adding changelog notes to `description`, condense older entries so total length stays between **1,900 and 1,995 characters**.
- **Author Anonymity**:
  - `authors` must strictly remain `["jajang"]`. Never expose personal names, email addresses, or internal filesystem paths.

### Step 4: Live Game Synchronization
- Always sync updated files to the live local game mod folder:
  `%APPDATA%\Geoplanetical\mods\geoplanetical-performance`
- Run `node patcher.js install` (with `BypassSandbox: true` if permission requires it) to ensure the player's in-game Mod Studio immediately sees updated versions and descriptions.

### Step 5: Documentation & Changelog (`CHANGELOG.md`)
- Add an entry under the new version header in [CHANGELOG.md](file:///c:/server/ETC/Geoplanetical-Performance/CHANGELOG.md).
- Detail both the **technical root cause** and the **user-facing benefit**.

### Step 6: Git Version Control & Remote
- Stage modified files (`git add mod-pack/mod.json CHANGELOG.md ...`).
- Commit with conventional commit format: `fix: ...`, `feat: ...`, `perf: ...`, or `docs: ...`.
- Tag the commit with the new version: `git tag -fa vX.Y.Z -m "Release vX.Y.Z"`.
- If push is permitted/authenticated, run `git push origin master --tags` or prompt the user.

---

## 2. Performance & Hardware Safeguards (Low-Spec Laptop First)

This mod is specifically engineered to deliver smooth 60 FPS on 8GB RAM laptops with integrated graphics (e.g. Intel UHD / Iris Xe) without overheating:

1. **World Generation & Watchdog Safety**:
   - Geoplanetical has a hardcoded 180-second simulation worker timeout during boot (`omt = 18e4`).
   - New Game world generation must never exceed **100 seconds** total on dual/quad-core i5 laptops.
   - Keep `prewarmTransport()` bypassed or deferred — do not run full global 5,000-province pathfinding during initial boot.
2. **GPU & Thermal Throttling Prevention**:
   - Canvas resolution downscaled to 2K (saves 75% fill-rate compared to 8K).
   - Eliminate compositor CSS backdrop-filters (`blur()`) and unlit atmospheric shaders.
   - Ensure province polygon tessellation maintains spherical curvature ($R = 1.0008$) without chord sag or depth clipping (never drop tessellation below depth 8 on large landmasses).
3. **Simulation Speed & UI Non-Blocking**:
   - Turbo Speed 3 targets ~16 days/sec.
   - Simulation heavy ticks (such as month-end economic rollups) must never freeze the UI. Month-End UI Browsing serves cached day data so the player can browse menus without UI lockup.
4. **Hotkey Conflict Protection**:
   - Always verify prospective hotkeys against native engine key bindings.
   - **DO NOT USE**:
     - `F11` (Reserved by game for Fullscreen: `tn.toggleFullscreen()`)
     - `F12` (Reserved by Steam for Screenshots)
     - `F1` (Reserved by game for Help / Guide overlay)
   - **Current Standard Hotkeys**:
     - `F10`: Fire Graphics ON/OFF (with 2s floating toast).
     - `F2`: Turbo Speed 3 ON/OFF (with 2s floating toast).

---

## 3. Installer Architecture & Zero-Dependency Rule
- `Install-Mod.bat` and `Uninstall-Mod.bat` must work out-of-the-box on clean Windows installations without requiring Node.js in the user's `PATH`.
- If `node` is absent, the batch scripts automatically fall back to invoking `Geoplanetical.exe` with `set ELECTRON_RUN_AS_NODE=1`.
- The mod package (`mod-pack/`) must be self-contained so players installing from Steam Workshop can open folder via Mod Studio and double-click `Install-Mod.bat`.
