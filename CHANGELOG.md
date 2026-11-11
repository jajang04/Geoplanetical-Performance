# Changelog — Geoplanetical Fire Performance Mod

All notable changes, fixes, and architecture improvements to **Geoplanetical Fire Performance Mod** (`geoplanetical-performance`) are documented in this file.

---

## [v1.6.1] — 2026-11-11

### Fixed (Game v1.1.2 Compatibility)
- **Updated Renderer Patch Hooks for Official Game Update v1.1.2**:
  - **Root Cause**: Geoplanetical v1.1.2 updated `_initThree` (added an explicit `e._quality !== "performance"` antialiasing guard), updated `shouldDraw()` with a settled/active threshold (`a ? .1 : .025`), replaced the blocking `session-switch` IPC autosave with a clean reload flow (`Rwe` / `location.reload()`), and rotated minified variable names on nation label mesh creation (`this._nlGroup.add(M)`).
  - **Fix & Benefit**: Updated [patcher.js](file:///c:/server/ETC/Geoplanetical-Performance/patcher.js) and [test.js](file:///c:/server/ETC/Geoplanetical-Performance/test.js) to support both **v1.1.2** and **v1.1.0** cleanly with exact byte-length padding, while preserving all new native v1.1.2 physical-core detection (`machine-cores.js`), per-minute render health telemetry (`diag:perf`), and clean reload save-switching.

---

## [v1.6.0] — 2026-11-07

### Added & Fixed
- **Clean Native v1.1.0 Simulation Engine (Zero Conflicts)**:
  - Eliminated conflicting simulation worker monkey-patches to ensure 100% native stability and full compatibility with the official v1.1.0 engine update (Banking, Stocks, Puppets, regional trade overhaul, and pre-baked economic checkpoint).
  - Eliminates monthly tick retry stalls, trade divergence loops, and save loading delays caused by outdated v1.0.8/v1.0.9 monkey-patches.
- **Zero RAM Swapping on 8GB Systems**:
  - Preserved vanilla V8 memory limits instead of forcing 4GB heap allocations. Eliminates heavy Windows `pagefile.sys` disk thrashing during session switching and save loading on 8GB RAM laptops.
- **Fast New World Generation & Loading Screen Bypass**:
  - **Auto-Bypass 25s Intro Audio Loading Stall**: Patched `renderer/app.bundle.js` so Fire Mode automatically bypasses the 25-second intro narrator lock without requiring mouse clicks or keypresses.
  - **Non-Blocking 3D Atlas Label Baking**: Nation label baking runs smoothly in the background via `requestAnimationFrame` instead of freezing the loading screen for 212 nations.
- **Instant In-Game Save Load**:
  - Skipped the forced blocking `session-switch` autosave when loading a save file from inside an active match.
- **Pure Three.js Graphics Boost & Smooth 60 FPS UI**:
  - Retained all lightweight dual globe shaders, CSS blur removal, 2K canvas, disabled clouds/soot/shadows, unlocked FPS cap, and live F10 Graphics toggle.
  - **CSS Layout & Paint Containment**: Injected `contain: layout paint !important; content-visibility: auto !important;` on `.panel`, `.window`, `.modal`, `.hud-overlay`, and `.table-container` in Fire Mode, isolating panel reflows and stopping Chromium from repainting the entire viewport whenever market or country numbers update.
  - **Three.js Nation Label Frustum Culling**: Computed bounding spheres on nation ribbon geometry and enabled `frustumCulled = __GFM("gfx")` on all 212 label meshes so Three.js automatically culls off-screen and backside nation labels.
  - **Background Sparkline Canvas Freeze**: Skipped Canvas 2D clear/stroke routines in `_paintSpark` whenever the sparkline panel is closed.
- **Fixed Steam Workshop `.bat` Launchers Closing Immediately or Hanging Without Node.js**:
  - Replaced `if (...) else (...)` blocks in `Install-Mod.bat` and `Uninstall-Mod.bat` with `goto` label branching (`:run_node` / `:run_ps` / `:done`) to fix crashes caused by parentheses in `(x86)` paths.
  - Replaced slow PowerShell byte loops with native .NET `IndexOf(..., [StringComparison]::Ordinal)` in ISO-8859-1 encoding, reducing fuse patching time from 5 minutes down to **222 ms** without Node.js.

---

## [v1.5.2] — 2026-11-07

### Added & Fixed
- **Updated Installation Guide for Steam Workshop Subscribers**:
  - Clarified the physical file location for Steam Workshop subscribers (`steamapps/workshop/content/3182430/3834097787/`) vs. the local AppData directory (`%APPDATA%\Geoplanetical\mods\`), resolving confusion where subscribers saw an empty AppData folder when clicking the in-game folder icon.

---

## [v1.5.1] — 2026-11-07

### Added & Fixed
- **Optimized New Game World Generation (~80s Faster, Much Cooler)**:
  - Bypassed the non-essential `prewarmTransport()` network graph solver during `session.boot`. Reduced new game creation time from ~190s down to ~95s, finishing 85s before the 180s watchdog timer and eliminating prolonged 100% CPU heat.
- **Fixed Dark Polygonal Patches (Restored Native Spherical Tessellation)**:
  - Fixed dark slate patches appearing on large nations (Russia, China, India) caused by over-simplified triangle subdivision in `_buildProvinceFills()`. Restored native spherical depth 8 tessellation so province overlays smoothly hug the globe surface at $1.0008\times R$ with zero Z-clipping or chord sag.

---

## [v1.5.0] — 2026-11-07

### Added & Fixed
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
