# Geoplanetical Fire Performance Mod — Workspace Rules

You are working on the Geoplanetical Fire Performance Mod repository.
You must strictly follow the rules documented in `rules.md` at all times:

1. **Mandatory 6-Step Implementation Pipeline on EVERY modification/fix**:
   - [1] Patch code with exact byte length padding and active-mod gating (`localStorage.getItem('geoplanetical-performance-active') !== 'false'`).
   - [2] Verify with `node test.js` (all 4 test suites must pass).
   - [3] Update `mod-pack/mod.json`:
     - Auto-bump version (patch `v1.x.y` for fixes/optimizations, minor `v1.x.0` for new features).
     - Keep `version` string $\le 64$ characters.
     - Keep `description` $\le 2000$ characters (condense older changelog if needed; target 1900–1995 chars).
     - Keep author strictly `["jajang"]`.
   - [4] Sync to live local game directory (`%APPDATA%\Geoplanetical\mods\geoplanetical-performance\mod.json`).
   - [5] Update `CHANGELOG.md` with technical root causes and user benefits.
   - [6] Commit in git with conventional commits and update git version tag (`vX.Y.Z`).

2. **Performance & Hardware Safeguards (Low-Spec Laptop Optimization)**:
   - Keep New Game world generation under 100 seconds (never let it trigger the 180s watchdog timeout `omt = 18e4`).
   - Canvas resolution 2K, disable CSS compositor blur, no 3D clouds/atmosphere, maintain spherical polygon tessellation (avoid chord sag black patches).
   - Preserve non-blocking UI during month-end calculations.
   - Protect reserved hotkeys: Never touch F11 (Fullscreen), F12 (Steam screenshot), or F1 (Help). Use F10 for Graphics toggle and F2 for Turbo toggle.

3. **Installer & Zero-Dependency**:
   - Maintain standalone Node-free execution in `Install-Mod.bat` via `ELECTRON_RUN_AS_NODE=1` fallback.
