@echo off
title GlyphForge M3 Auth Check (read-only)
echo GlyphForge M3-A Auth verification: test project only, no writes.
echo Enter passwords only in this local window; they are hidden and never uploaded to ChatGPT.
echo.
wsl.exe --cd "%~dp0.." --exec /bin/bash scripts/run-community-auth-smoke.sh
set "TEST_EXIT=%ERRORLEVEL%"
echo.
echo Verification ended with exit code %TEST_EXIT%.
echo Press any key to close.
pause >nul
exit /b %TEST_EXIT%
