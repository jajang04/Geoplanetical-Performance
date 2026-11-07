# Changelog — Geoplanetical Fire Performance Mod

All notable changes, fixes, and architecture improvements to **Geoplanetical Fire Performance Mod** (`geoplanetical-performance`) are documented in this file.

---

## [v1.6.0] — 2026-11-07

### Added & Fixed
- **5.8x Faster New World Generation (`131s` ➔ `22.6s`)**:
  - **4 GB Worker V8 Heap (`--max-old-space-size=4096`)**: Prevents V8 old-generation GC thrashing and out-of-memory crashes on 8 GB RAM laptops during the ~2.5 GB peak allocation spike of `session.boot` and save deserialization.
  - **Native C++ `zlib.gunzipSync` (`4,555 ms` ➔ `579 ms`)**: Replaced the pure-JS `UZIP` inflate loop (`W5o`) with Node's native C++ `zlib.gunzipSync` for the 700 MB `boot-world-checkpoint.json.gz` payload.
  - **Read-Only Checkpoint Validation & Deep-Diff Bypass (`25,659 ms` ➔ `148 ms`)**: Skipped redundant SHA-256 verification (`G5o`) on the immutable built-in checkpoint, bypassed 25 read-only schema invariant walks in `wYa` while preserving `vYa` finance runtime map hydration, skipped duplicate `Lle` household accounting checks in `_Ya`, freed the 700 MB `checkpointPayload` buffer immediately after `JSON.parse` (`HYa`), and bypassed the 236 MB `kYa` deep-clone certification diff (`mgt`/`ugt`).
- **3.5x Faster Save File Loading (`46s` ➔ `13.0s`) & 6x Faster Save Snapshots (`28.0s` ➔ `4.7s`)**:
  - **Instant In-Game Save Load (`15–28s` Saved)**: Skipped the forced blocking `session-switch` autosave in `PPt` when loading a save file from inside an active match in Fire Mode.
  - **Fast Restore Pipeline (`34.7s` ➔ `5.5s`)**: Replaced pure-JS `UZIP` decompression in `pir` with native C++ `zlib` (`gunzipSync` / `inflateSync`), eliminated millions of temporary `{parent, key}` path object allocations during `MC` recursive save-tree walks, skipped pre-restore `eVa` passes that are immediately overwritten by `Str` (`RB`, `WMe`, `jB`/`S8`, `dkt`, `ZYa`, and duplicate `g4t`/`qlt`), bypassed the redundant `$Xa` dry-run migration clone, and bypassed `GHa` double-cloning and full Day 1–31 financial ledger transaction replay audits (`f5t`/`d5t`/`P5t`/`B9`) inside `$2e` and `IOe`.
- **1.6x Faster Monthly Rollover Tick (`45.0s` ➔ `28.5s`, Saving `16.5s` Every Month) & 60 FPS Cooperative Slicing**:
  - **Single-Pass Monthly CGE World Trade (`16,915 ms` ➔ `7,138 ms`, 2.37x Faster)**: Reduced outer CGE calibration passes (`a4o`) from 2 to 1 on monthly rollover, skipped the redundant `"opening"` `UVe` global trade matrix solve before monthly operating settlement in `Bzt` (`operatingSettlement` cut from `7,790 ms` to `5,309 ms`), and capped `supplierSearchExpansion` (`tLt`) to 1 pass (`[lTt]`).
  - **Adaptive Cooperative Frame Slicing (`16ms / 24ms`)**: Dynamically tightens the worker's cooperative slice budget in `xJa` from `48ms / 64ms` down to `16ms / 24ms` whenever UI IPC requests (`VIEW_SUBSCRIBE`, camera/UI updates) are pending in the worker queue, keeping the UI responsive at 60 FPS during month-end calculations.
- **Fixed Steam Workshop `.bat` Launchers Closing Immediately or Hanging Without Node.js**:
  - Replaced `if %ERRORLEVEL% EQU 0 (...) else (...)` blocks in `Install-Mod.bat` and `Uninstall-Mod.bat` with `goto` label branching (`:run_node` / `:run_ps` / `:done`), safe environment variable passing (`GEO_MOD_DIR`), and `\x22` regex escaping. Fixes the `cmd.exe` syntax crash caused by the closing parenthesis `)` in `C:\Program Files (x86)\Steam\steamapps\workshop\content\4137120\3834097787\`.
  - Replaced the slow byte-by-byte PowerShell `for` loop across the 200 MB `Geoplanetical.exe` binary with native .NET `IndexOf(..., [StringComparison]::Ordinal)` in ISO-8859-1 encoding, reducing the Node-free fuse scan from **5+ minutes down to `222 ms` (`0.22 seconds`)** when standalone Node.js is not installed.
  - Added automatic `libraryfolders.vdf` multi-drive Steam library discovery and cross-folder shared backup synchronization (`%APPDATA%\Geoplanetical\backups\v<ver>`).

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
