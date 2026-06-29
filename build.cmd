@echo off
cd /d "%~dp0"
set NODE_OPTIONS=--use-system-ca
call npm.cmd install
if errorlevel 1 exit /b 1
call npm.cmd run build
if errorlevel 1 exit /b 1
echo.
echo Build complete. Load the "dist" folder in chrome://extensions
