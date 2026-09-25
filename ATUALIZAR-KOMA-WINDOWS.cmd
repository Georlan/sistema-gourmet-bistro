@echo off
setlocal
chcp 65001 >nul
title Atualizador Koma - Impressao Windows
cd /d "%~dp0"

echo.
echo ============================================================
echo   KOMA - ATUALIZACAO DA IMPRESSAO
echo ============================================================
echo.
echo Atualizando os arquivos do agente de impressao...
echo Suas configuracoes e identificador serao preservados.
echo.

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0print-agent\install-windows.ps1" -Update
set "KOMA_EXIT=%ERRORLEVEL%"

echo.
if not "%KOMA_EXIT%"=="0" (
    echo [ERRO] A atualizacao nao foi concluida.
    pause
    exit /b %KOMA_EXIT%
)

echo [OK] Atualizacao concluida com sucesso.
pause
