# 📋 Registro de Tareas - Prensi Bot 2026

Este archivo sirve como nexo de comunicación entre **Gemini (Navegador)**, **Claude (Navegador)** y **Antigravity (Agente)**.

---

## 📌 Tareas Pendientes

*(Agrega aquí las tareas o consultas generadas por Gemini/Claude para que Antigravity las ejecute)*

- [ ] *Ejemplo: Agregar nueva funcionalidad...*

---

## ⏳ En Progreso

*(Tareas actualmente en desarrollo por Antigravity)*

- *Ninguna por el momento.*

---

## ✅ Tareas Completadas

- [x] **[2026-09-04] Verificación Post-Fix: Deduplicación y Estabilidad de Sync**
  - **Deduplicación de Mensajes (Paso 1)**: Implementado `processedMessageIds` (Map en memoria con TTL de 1 hora) y la función `esMensajeDuplicado(msg.key.id)`. Garantiza que ningún mensaje se procese dos veces (tanto para eventos `type === "notify"` como `type === "append"`).
  - **Monitoreo de RAM y Sync (Paso 2)**: Se monitoreó el proceso en el VPS. El consumo de RAM se mantiene súper estable en `66.5 MiB` de Heap (muy lejos del límite `max_memory_restart: 300M`), con latencia del Event Loop en `0.45 ms`.
  - **Verificación en Drive (Paso 3)**: Confirmado que no existen carpetas o archivos duplicados en Google Drive desde el despliegue del fix.
  - **Despliegue y Sincronización**: Desplegado en VPS (`prensi-bot-server`), PM2 reiniciado, verificado `connection_events.log` y sincronizado en GitHub (`main`).

- [x] **[2026-09-04] Visibilidad y mitigación de pérdida de mensajes por reconexión de socket**
  - **Origen / Contexto**: Ocurrió un microcorte de red de WhatsApp el 03/09/2026 entre las 17:43:50 y 17:43:56 ART.
  - **Descubrimiento Principal**: Se detectó que `app.js` descartaba mensajes con `type !== "notify"`. Al reconectar Baileys, los mensajes offline/pendientes llegan con `type === "append"`, los cuales eran ignorados anteriormente.
  - **Cambios Aplicados**:
    - **Paso 1 (Logging Persistente)**: Implementado archivo de log dedicado `./connection_events.log` y función `registrarEventoConexion()` que registra timestamps de cortes, reconexiones y cantidad de notificaciones offline pendientes.
    - **Paso 2 (Configuración de Baileys y Filtro de Mensajes)**: Se configuró `markOnlineOnConnect: true`, `syncFullHistory: false`, `shouldSyncHistoryMessage: () => true` en `makeWASocket()`. En `messages.upsert`, se habilitó el procesamiento de `type === "notify"` Y `type === "append"`, y se amplió el umbral de descarte de mensajes antiguos a 15 minutos (900s).
    - **Paso 3 (Alertas Proactivas al Admin)**: Configurado `CONNECTION_GAP_ALERT_SECONDS` (por defecto 3 segundos). Ante desconexiones de socket seguidas de reconexión con duración `>= threshold`, se envía un mensaje de alerta proactivo a `ADMIN_NUMBER_JID` detallando hora del corte, hora de reconexión, duración y notificaciones pendientes.
  - **Despliegue y Sincronización**: Desplegado en VPS (`prensi-bot-server`), PM2 reiniciado, verificado `connection_events.log` y sincronizado en GitHub (`main`).

- [x] **[2026-09-02] Hardening de Resiliencia y Recursos para VPS (`VM.Standard.E2.1.Micro / ARM`)**
  - **Sugerido por**: Claude (Navegador)
  - **Resultados de Auditoría (Paso 0)**:
    - **RAM**: 954 MiB total, 511 MiB en uso, 442 MiB disponibles.
    - **Disco**: 45 GB total (`/dev/sda1`), 13 GB en uso (28%), 32 GB libres.
    - **Swap**: Swapfile de 4.0 GiB ya existente y activo en el VPS (`124 MiB` en uso).
    - **Limpieza `./temp/`**: Se encontraron 12 archivos `.mp4` huérfanos del 11 de agosto (~15 MB).
  - **Cambios Aplicados**:
    - **Paso 2 (PM2)**: Configurado `max_memory_restart: 300M`, instalado y activo `pm2-logrotate` (`max_size: 10M`, `retain: 5`), y guardada la configuración con `pm2 save`.
    - **Paso 3 (Limpieza de Huérfanos)**: Implementada función `limpiarArchivosHuerfanos()` al arranque de `app.js` que elimina archivos temporales con mtime > 1 hora (eliminó automáticamente los 12 archivos antiguos en el reinicio).
    - **Paso 4 (Reintentos en Drive)**: Implementada función `subirArchivoConReintentos()` con 3 reintentos y backoff exponencial (2s, 4s, 8s). Si fallan todos los reintentos, el archivo se retiene en `./temp/` para evitar pérdida de datos y se notifica al administrador.
    - **Paso 5 (Límite de Tamaño)**: Implementado `MAX_FILE_SIZE_MB` (por defecto 100 MB). Se evalúa `fileLength` antes de descargar el buffer; si excede el límite, se rechaza la descarga con aviso al usuario.
  - **Despliegue y Sincronización**: Desplegado en VPS (`prensi-bot-server`), servicio PM2 `prensi-bot` reiniciado y conectado a WhatsApp sin errores. Sincronizado en GitHub (`main`).

- [x] **[2026-09-02] Ignorar actividad de grupos en WhatsApp**
  - **Detalle**: Se actualizó `app.js` para filtrar explícitamente mensajes con `msg.key.participant` y `g.us`, evitando que fotos/videos enviados dentro del grupo "PRENSA DRE XA-XB" incrementen el contador de material o activen reportes automáticos.
  - **Despliegue**: Actualizado en el VPS (`prensi-bot-server`) y sincronizado en GitHub (`main`).

---

## 💡 Notas e Instrucciones

- Cada vez que agregues o modifiques una tarea en este archivo en GitHub o localmente, puedes avisarle a Antigravity en el chat para proceder con su ejecución.
- Al finalizar una tarea, Antigravity actualizará la casilla a `[x]`, moverá el elemento a **Tareas Completadas** con fecha/detalle, y hará el *push* a GitHub.
