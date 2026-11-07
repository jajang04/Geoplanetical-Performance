# Changelog — Geoplanetical Fire Performance Mod

All notable changes, fixes, and architecture improvements to **Geoplanetical Fire Performance Mod** (`geoplanetical-performance`) are documented in this file.

---

## [v1.5.0] — 2026-11-07

### Added
- **Separated Hotkeys (F10 & F2)**:
  - **`F10`**: Toggles **Fire Graphics** (Flat unlit shader, 2K canvas downscale, CSS compositor blur killer, disabled newsflash video decoding, hidden clouds/satellites) vs. Vanilla Graphics.
  - **`F2`**: Toggles **Turbo Speed 3** (~16 days/sec simulation speed) vs. Normal Speed 3.
  - *Conflict Prevention*: Verified all 12 function keys in Geoplanetical's engine. **`F11` is reserved by the game for Fullscreen (`tn.toggleFullscreen()`)**, while **`F2` is 100% unused** in vanilla and immediately adjacent to F1.
- **Interactive 2-Second Floating Screen Toasts**:
  - Pressing `F10` or `F2` pops an on-screen toast notification in the center of the viewport matching the game's native HUD typography:
    - `🔥 FIRE GRAPHICS: ON [F10]` / `❄️ VANILLA GRAPHICS: ON [F10]`
    - `⚡ TURBO SPEED 3: ON [F2]` / `⏱️ NORMAL SPEED 3: ON [F2]`
- **Month-End UI Browsing ("Browse During Calculation")**:
  - Non-blocking view adapter in `renderer/app.bundle.js`: When the 1st of the month arrives and the simulation worker is computing month-end closure, opening budget, diplomacy, trade, or country panels immediately serves cached data from the last committed day instead of freezing or locking the interface.
- **Frictionless 1-Click Installation Tutorial**:
  - Updated mod description to direct subscribers to the built-in game route: **In-Game: Mods ➔ Mod studio ➔ Open folder ➔ Double-click `Install-Mod.bat`**, eliminating manual Steam folder navigation.

---

## [v1.4.0] — 2026-11-07

### Added & Fixed
- **Game Patch v1.0.9 Support**:
  - Added compatibility for Geoplanetical v1.0.9's new unpacked simulation worker (`resources/app.asar.unpacked/renderer/simulation-worker.bundle.js`).
- **Node-Free Installer Fallback (Fixed "node is not recognized" Error)**:
  - Re-engineered `Install-Mod.bat` and `Uninstall-Mod.bat` to detect if Node.js is installed in PATH.
  - If standalone Node.js is missing, the installer automatically invokes `Geoplanetical.exe` with `ELECTRON_RUN_AS_NODE=1` to run `patcher.js` using the game's own bundled Node.js v24.19.0 engine. Subscribers do not need to install Node.js.
- **Mod Studio Empty Content Check Bypass**:
  - Patched leftover `empty: tht(e) === 0` validation check in `renderer/app.bundle.js` so that Mod Studio permits publishing with `provides: {}` without forcing an unwanted `Flags` tag on the Steam Workshop item.
- **Custom Version Label**:
  - Upgraded `mod.json` version string to utilize the new 64-character presentation label feature introduced in game v1.0.9.
- **Author Anonymity**:
  - Fixed author metadata across all project and manifest files to strictly reflect public pseudonym `jajang`.

---

## [v1.3.1] — 2026-11-05

### Added & Fixed
- **Live In-Game Toggle (F10)**:
  - Added live hotkey toggle allowing players to switch between Fire Mode and Vanilla without restarting the game.
- **Daily Date Progression Ticker**:
  - Fixed visual UI date lag during Turbo Speed 3 so the game date counter smoothly increments on every simulated day.

---

## [v1.0.0] — 2026-11-01

### Added
- **Initial Workshop Release**:
  - Sub-second surgical in-place ASAR binary patcher preserving exact byte lengths, updating SHA-256 block hashes and Electron fuses.
  - Flat unlit Three.js globe shader eliminating 4-tap B-spline reconstruction, 27-cell 3D Voronoi noise, and Cox-Munk anisotropic ocean glints.
  - 2K political canvas downscaling (`baseCanvas` to 2048×1024, `pickCanvas` to 1024×512).
  - Removal of 234 CSS compositor blurs and drop shadows.
  - 16x Turbo Speed 3 tick rate acceleration in simulation worker.
