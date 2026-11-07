@echo off
setlocal
cd /d "%~dp0"
set "GEO_MOD_DIR=%~dp0"
echo ============================================================================
echo   Installing Geoplanetical Fire Performance Mod v1.6.0...
echo ============================================================================

taskkill /F /IM Geoplanetical.exe >nul 2>nul

where node >nul 2>nul
if %ERRORLEVEL% EQU 0 goto :run_node
goto :run_ps

:run_node
node "%~dp0patcher.js" install
goto :done

:run_ps
echo [Info] Standalone Node.js not found in PATH — using Geoplanetical's built-in engine...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference = 'Stop'; " ^
  "$dir = $env:GEO_MOD_DIR.TrimEnd('\'); " ^
  "$cands = @([IO.Path]::GetFullPath((Join-Path $dir '..\..\..\..\common\Geoplanetical')), 'C:\Program Files (x86)\Steam\steamapps\common\Geoplanetical', 'C:\Program Files\Steam\steamapps\common\Geoplanetical', 'D:\SteamLibrary\steamapps\common\Geoplanetical', 'E:\SteamLibrary\steamapps\common\Geoplanetical', 'F:\SteamLibrary\steamapps\common\Geoplanetical'); " ^
  "try { $sp = (Get-ItemProperty 'HKCU:\Software\Valve\Steam' -ErrorAction Stop).SteamPath.Replace('/','\'); $cands += (Join-Path $sp 'steamapps\common\Geoplanetical'); $vdf = Join-Path $sp 'steamapps\libraryfolders.vdf'; if (Test-Path $vdf) { Select-String -Path $vdf -Pattern '\x22path\x22\s+\x22([^\x22]+)\x22' -AllMatches | ForEach-Object { $_.Matches } | ForEach-Object { $cands += (Join-Path ($_.Groups[1].Value -replace '\\\\','\') 'steamapps\common\Geoplanetical') } } } catch {}; " ^
  "$gameDir = $cands | Where-Object { $_ -and (Test-Path (Join-Path $_ 'Geoplanetical.exe')) } | Select-Object -First 1; " ^
  "if (-not $gameDir) { Write-Error 'Could not locate Geoplanetical installation directory.'; exit 1 }; " ^
  "Get-Process Geoplanetical -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue; Start-Sleep -Milliseconds 300; " ^
  "$exe = Join-Path $gameDir 'Geoplanetical.exe'; " ^
  "$bytes = [IO.File]::ReadAllBytes($exe); " ^
  "$sent = 'dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX'; " ^
  "$idx = [Text.Encoding]::GetEncoding(28591).GetString($bytes).IndexOf($sent, [StringComparison]::Ordinal); " ^
  "if ($idx -ge 0) { $rOff = $idx + $sent.Length + 2; $aOff = $idx + $sent.Length + 6; if ($bytes[$rOff] -ne 0x31 -or $bytes[$aOff] -ne 0x30) { $fs = [IO.File]::Open($exe, [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::ReadWrite); $fs.Position = $rOff; $fs.WriteByte(0x31); $fs.Position = $aOff; $fs.WriteByte(0x30); $fs.Close() } }; " ^
  "$env:GEO_GAME_DIR = $gameDir; $env:ELECTRON_RUN_AS_NODE = '1'; $env:ELECTRON_NO_ASAR = '1'; $ErrorActionPreference = 'Continue'; " ^
  "& $exe (Join-Path $dir 'patcher.js') install 2>&1 | ForEach-Object { Write-Host $_.ToString() }"

:done
echo.
pause
