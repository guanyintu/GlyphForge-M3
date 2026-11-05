@echo off
title GlyphForge M3 - Forget local encrypted test credentials
powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File "%~dp0Run-M3-Auth-Vault.ps1" -Action Forget
echo.
pause
