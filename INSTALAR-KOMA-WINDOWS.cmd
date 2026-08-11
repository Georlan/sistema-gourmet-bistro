@echo off
setlocal
chcp 65001 >nul
title Instalador Koma - Impressao Windows
cd /d "%~dp0"

echo.
echo ============================================================
echo   KOMA - INSTALACAO RAPIDA DA IMPRESSAO
echo ============================================================
echo.
echo O navegador sera aberto para autorizar este computador.
echo O Koma nao vai alterar a impressora padrao do Windows.
echo.

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0print-agent\install-windows.ps1"
set "KOMA_EXIT=%ERRORLEVEL%"

echo.
if not "%KOMA_EXIT%"=="0" (
  echo [ERRO] A instalacao nao foi concluida.
  echo Leia a mensagem acima, corrija o item indicado e tente novamente.
) else (
  echo [OK] Instalacao concluida. O Koma iniciara junto com o Windows.
)
echo.
pause
exit /b %KOMA_EXIT%
