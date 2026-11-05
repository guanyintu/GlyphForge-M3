@echo off
title GlyphForge M3 Auth Check - encrypted local vault
echo GlyphForge M3-A: first run stores encrypted test credentials in Windows DPAPI.
echo Future runs read the same local vault. No passwords sent to ChatGPT.
echo.
powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File "%~dp0Run-M3-Auth-Vault.ps1" -Action Run
set "TEST_EXIT=%ERRORLEVEL%"
echo.
echo Verification ended with exit code %TEST_EXIT%.
echo Press any key to close.
pause >nul
exit /b %TEST_EXIT%
