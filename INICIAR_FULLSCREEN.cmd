@echo off
setlocal DisableDelayedExpansion
title Fullscreen - Demo local
cd /d "%~dp0"
if errorlevel 1 goto carpeta_error

where node.exe >nul 2>&1
if errorlevel 1 goto node_error

node "scripts\local-demo.mjs"
if errorlevel 1 (
    echo.
    echo No se pudo iniciar Fullscreen. El motivo aparece arriba.
    pause
    exit /b 1
)
exit /b 0

:carpeta_error
echo No se pudo abrir la carpeta de Fullscreen.
pause
exit /b 1

:node_error
echo Instala Node.js 24 o superior y vuelve a abrir este archivo.
pause
exit /b 1
