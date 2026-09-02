#!/bin/bash
# Script de configuración inicial para Linux

echo -e "\n======================================================="
echo -e "   Iniciando configuración de Prensi Bot 2026"
echo -e "=======================================================\n"

# 1. Copiar .env si no existe
if [ ! -f .env ]; then
    cp .env.example .env
    echo "[OK] Archivo .env creado a partir de .env.example"
else
    echo "[INFO] El archivo .env ya existe. No se ha modificado."
fi

# 2. Copiar Caddyfile si no existe
if [ ! -f Caddyfile ]; then
    cp Caddyfile.example Caddyfile
    echo "[OK] Archivo Caddyfile creado a partir de Caddyfile.example"
else
    echo "[INFO] El archivo Caddyfile ya existe. No se ha modificado."
fi

echo -e "\n======================================================="
echo -e "   Configuración completada con éxito."
echo -e "   Recuerda editar tu archivo .env con tus credenciales."
echo -e "=======================================================\n"
