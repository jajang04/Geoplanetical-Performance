# Geoplanetical Fire Performance Mod 🔥

[![Game Version](https://img.shields.io/badge/Game-v1.1.2-blue.svg)](https://store.steampowered.com/app/940230/Geoplanetical/)
[![Mod Version](https://img.shields.io/badge/Mod-v1.6.2-orange.svg)](https://github.com/jajang04/Geoplanetical-Performance/releases)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Tested On](https://img.shields.io/badge/Tested%20On-8GB%20RAM%20%2F%20Iris%20Xe-success.svg)](#hardware-targets)

A surgical, conflict-free performance optimization engine for **Geoplanetical**, engineered to deliver **smooth 60 FPS**, lightning-fast world generation, and lag-free month-end progression on low-spec laptops (8GB RAM / integrated graphics) as well as high-end gaming rigs.

---

## ⚡ What It Does

* **Smooth 60 FPS Graphics Boost:** Replaces heavy 8K globe textures and unlit atmospheric passes with lightweight 2K shaders and removes heavy CSS UI compositor backdrop blurs (`backdrop-filter: blur`).
* **Fast New Game Boot:** Skips redundant prewarm pathfinding and the 25-second intro narrator hold, baking nation atlas labels asynchronously.
* **Month-End UI Browsing:** Browse diplomacy, economy, and budget tabs smoothly during heavy month-end simulation ticks without the UI freezing.
* **Zero Simulation Conflicts:** 100% preserves the official v1.1.2 economic solver (CGE matrix trade settlement, double-entry banking ledger, puppet states, and country AI).
* **Zero RAM Thrashing:** Protects V8 heap limits on 8GB RAM systems to prevent Windows from swapping memory to disk.
* **Live In-Game Toggle (F10):** Press **`F10`** anytime while playing to instantly toggle Fire Graphics ON/OFF with a floating on-screen confirmation toast.

---

## 🚀 Installation

### Method 1: Steam Workshop (Official Steam Users)
1. **Subscribe** to the mod on the [Steam Workshop](https://steamcommunity.com/sharedfiles/filedetails/?id=3834097787).
2. Because Steam Workshop only loads presentation images by default, run the 1-click installer once:
   * In Steam, right-click **Geoplanetical** → **Manage** → **Browse local files**.
   * In Windows File Explorer's address bar, click **`steamapps`**, then navigate to:  
     `workshop\content\4137120\3834097787\`
   * Double-click **`Install-Mod.bat`** (takes ~1-2 seconds, zero Node.js installation required).
3. Launch the game through Steam! You will see **`FIRE [F10]`** and your FPS in the top-right corner.

---

### Method 2: Standalone / Non-Steam / Offline Installation (Direct GitHub Download)
*If you are using a portable, offline, GOG, or non-Steam copy of Geoplanetical, follow these steps:*

1. **Download the latest release:**
   * Go to the [Releases](https://github.com/jajang04/Geoplanetical-Performance/releases) tab and download the source code zip (or clone this repository).
2. **Extract the files:**
   * Unzip the downloaded folder.
3. **Run the Installer:**
   * **If your game is installed in a default path** (or you placed the extracted mod folder right inside your `Geoplanetical` game directory):  
     Simply double-click **`Install-Mod.bat`**. The installer auto-detects `Geoplanetical.exe` using the game's built-in engine.
   * **If your game is in a custom folder** (e.g., `D:\Games\Geoplanetical`):  
     Either move the mod folder inside your game folder, or open PowerShell / Command Prompt and run:
     ```cmd
     set GEO_GAME_DIR=D:\Games\Geoplanetical
     Install-Mod.bat
     ```
4. **Launch the game:**
   * Start `Geoplanetical.exe`.
   * You will see the **`FIRE [F10]`** indicator and FPS counter active in the top-right corner of the screen.

---

## 🎮 In-Game Controls & Toggle

| Action | Control | Description |
| :--- | :--- | :--- |
| **Toggle Fire Graphics** | **`F10`** | Switches live between Fire Mode (smooth 60 FPS) and Vanilla visuals with a 2-second floating toast. |
| **Mods Menu** | In-Game Menu | You can also enable or disable the mod directly under the **Mods** menu anytime. |

*(Note: `F11` is left untouched so it never conflicts with the game's native Fullscreen hotkey).*

---

## 🔄 How to Update the Mod

Whenever a new mod version is released, or whenever the official game receives an update on Steam:

### For Steam Workshop Users:
1. Steam will automatically download the updated Workshop files.
2. Navigate to your Workshop content folder:  
   `steamapps\workshop\content\4137120\3834097787\`
3. Double-click **`Install-Mod.bat`** once to apply the updated patch to the new game version.
4. Launch the game!

### For Standalone / Non-Steam Users:
1. Download the latest **`Geoplanetical-Fire-Performance-Mod-vX.X.X.zip`** from the [GitHub Releases](https://github.com/jajang04/Geoplanetical-Performance/releases) page.
2. Extract and replace the files in your mod directory.
3. Double-click **`Install-Mod.bat`** to re-patch and synchronize your game engine.
4. Launch `Geoplanetical.exe`!

---

## 🔄 How to Uninstall

To revert your game back to 100% clean vanilla files:
1. Double-click **`Uninstall-Mod.bat`** in the mod folder.
2. It immediately restores the original unmodified `app.asar`, Electron fuses, and vanilla configs from backups.

---

## 🛠️ Technical Details & Safeguards

* **Hardware Targets:** Specifically benchmarked and optimized for Intel Core i5-11300H (4 cores / 8 threads), 8GB RAM, and Intel Iris Xe integrated graphics.
* **100% Reversible ASAR Injection:** All bytecode patches preserve exact byte counts using whitespace padding and verify SHA-256 block hash integrity.
* **Active-Mod Dynamic Gating:** All renderer optimizations dynamically check the mod's active state. Turning off the mod in the in-game menu instantly reverts all WebGL shaders and CSS styles to vanilla without restarting.

---

## 📜 License & Credits

* Created by **jajang**
* Released under the [MIT License](LICENSE)
