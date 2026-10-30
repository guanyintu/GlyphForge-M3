@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 set "PATH=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin;%PATH%"
if not exist "node_modules\vite\bin\vite.js" (
  echo 请先安装 Node.js 和 pnpm，然后在此文件夹运行 pnpm install。
  pause
  exit /b 1
)
if not exist "dist\index.html" (
  echo 正在构建文字工坊...
  node "node_modules\typescript\bin\tsc" -b
  if errorlevel 1 exit /b 1
  node "node_modules\vite\bin\vite.js" build
  if errorlevel 1 exit /b 1
)
echo GlyphForge http://127.0.0.1:5173
node "node_modules\vite\bin\vite.js" preview --host 127.0.0.1 --port 5173 --strictPort --open
pause
