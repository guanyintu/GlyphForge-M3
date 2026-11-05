@echo off
title GlyphForge M3 bounded HTTP business check
powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File "%~dp0Run-M3-Auth-Vault.ps1" -Action Run -Check Business
exit /b %ERRORLEVEL%
