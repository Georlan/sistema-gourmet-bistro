@echo off
setlocal
chcp 65001 >nul
title Verificacao Koma - Impressao Windows
cd /d "%~dp0"

set "KOMA_CHECK=%LOCALAPPDATA%\KomaPrintAgent\check-windows.ps1"
if not exist "%KOMA_CHECK%" set "KOMA_CHECK=%~dp0print-agent\check-windows.ps1"

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%KOMA_CHECK%"
set "KOMA_EXIT=%ERRORLEVEL%"
echo.
pause
exit /b %KOMA_EXIT%
