@echo off
setlocal
chcp 65001 >nul
title Desinstalador Koma - Impressao Windows
cd /d "%~dp0"

echo.
echo ============================================================
echo   KOMA - DESINSTALACAO DA IMPRESSAO
echo ============================================================
echo.
echo Encerrando e desregistrando a execucao em segundo plano...
echo.

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0print-agent\install-windows.ps1" -Uninstall
set "KOMA_EXIT=%ERRORLEVEL%"

echo.
if not "%KOMA_EXIT%"=="0" (
    echo [ERRO] A desinstalacao encontrou um problema.
    pause
    exit /b %KOMA_EXIT%
)

echo [OK] Desinstalacao concluida.
pause
