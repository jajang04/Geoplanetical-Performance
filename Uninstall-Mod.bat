@echo off
setlocal
cd /d "%~dp0"
set "GEO_MOD_DIR=%~dp0"
echo ============================================================================
echo   Uninstalling Geoplanetical Fire Performance Mod and restoring game files...
echo ============================================================================

taskkill /F /IM Geoplanetical.exe >nul 2>nul

where node >nul 2>nul
if %ERRORLEVEL% EQU 0 goto :run_node
goto :run_ps

:run_node
node "%~dp0patcher.js" uninstall
goto :done

:run_ps
echo [Info] Standalone Node.js not found in PATH — using Geoplanetical's built-in engine...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference = 'Stop'; " ^
  "$dir = $env:GEO_MOD_DIR.TrimEnd('\'); " ^
  "$cands = @([IO.Path]::GetFullPath((Join-Path $dir '..\..\..\..\common\Geoplanetical')), 'C:\Program Files (x86)\Steam\steamapps\common\Geoplanetical', 'C:\Program Files\Steam\steamapps\common\Geoplanetical', 'D:\SteamLibrary\steamapps\common\Geoplanetical', 'E:\SteamLibrary\steamapps\common\Geoplanetical', 'F:\SteamLibrary\steamapps\common\Geoplanetical'); " ^
  "try { $sp = (Get-ItemProperty 'HKCU:\Software\Valve\Steam' -ErrorAction Stop).SteamPath.Replace('/','\'); $cands += (Join-Path $sp 'steamapps\common\Geoplanetical'); $vdf = Join-Path $sp 'steamapps\libraryfolders.vdf'; if (Test-Path $vdf) { Select-String -Path $vdf -Pattern '\"path\"\s+\"([^\"]+)\"' -AllMatches | ForEach-Object { $_.Matches } | ForEach-Object { $cands += (Join-Path ($_.Groups[1].Value -replace '\\\\','\') 'steamapps\common\Geoplanetical') } } } catch {}; " ^
  "$gameDir = $cands | Where-Object { $_ -and (Test-Path (Join-Path $_ 'Geoplanetical.exe')) } | Select-Object -First 1; " ^
  "if (-not $gameDir) { Write-Error 'Could not locate Geoplanetical installation directory.'; exit 1 }; " ^
  "Get-Process Geoplanetical -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue; Start-Sleep -Milliseconds 300; " ^
  "$exe = Join-Path $gameDir 'Geoplanetical.exe'; " ^
  "$bytes = [IO.File]::ReadAllBytes($exe); " ^
  "$sent = [Text.Encoding]::ASCII.GetBytes('dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX'); " ^
  "$idx = -1; for ($i = 0; $i -le $bytes.Length - $sent.Length; $i++) { if ($bytes[$i] -eq $sent[0]) { $m = $true; for ($j = 1; $j -lt $sent.Length; $j++) { if ($bytes[$i+$j] -ne $sent[$j]) { $m = $false; break } }; if ($m) { $idx = $i; break } } }; " ^
  "if ($idx -ge 0) { $rOff = $idx + $sent.Length + 2; if ($bytes[$rOff] -ne 0x31) { $fs = [IO.File]::Open($exe, [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::ReadWrite); $fs.Position = $rOff; $fs.WriteByte(0x31); $fs.Close() } }; " ^
  "$env:GEO_GAME_DIR = $gameDir; $env:ELECTRON_RUN_AS_NODE = '1'; $env:ELECTRON_NO_ASAR = '1'; " ^
  "& $exe (Join-Path $dir 'patcher.js') uninstall 2>&1 | ForEach-Object { Write-Host $_ }; " ^
  "Start-Sleep -Milliseconds 200; " ^
  "if ($idx -ge 0) { $fs = [IO.File]::Open($exe, [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::ReadWrite); $fs.Position = ($idx + $sent.Length + 2); $fs.WriteByte(0x30); $fs.Position = ($idx + $sent.Length + 6); $fs.WriteByte(0x31); $fs.Close() }"

:done
echo.
pause
