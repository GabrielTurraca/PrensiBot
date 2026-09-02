@echo off
:: Script de configuración inicial para Windows
echo.
echo =======================================================
echo    Iniciando configuracion de Prensi Bot 2026
echo =======================================================
echo.

:: 1. Copiar .env si no existe
if not exist .env (
    copy .env.example .env
    echo [OK] Archivo .env creado a partir de .env.example
) else (
    echo [INFO] El archivo .env ya existe. No se ha modificado.
)

:: 2. Copiar Caddyfile si no existe
if not exist Caddyfile (
    copy Caddyfile.example Caddyfile
    echo [OK] Archivo Caddyfile creado a partir de Caddyfile.example
) else (
    echo [INFO] El archivo Caddyfile ya existe. No se ha modificado.
)

echo.
echo =======================================================
echo    Configuracion completada con exito.
echo    Recuerda editar tu archivo .env con tus credenciales.
echo =======================================================
echo.
pause
