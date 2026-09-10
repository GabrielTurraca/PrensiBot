# 🤖 CONTEXTO GENERAL Y ARQUITECTURA - PRENSI BOT 2026

Este documento contiene todo el contexto técnico y funcional del proyecto **Prensi Bot 2026**. Puedes copiar y pegar este texto al inicio de cualquier conversación con Claude o Gemini para poner a la IA en contexto inmediatamente.

---

## 📌 1. Objetivo del Bot
**Prensi Bot 2026** es un chatbot institucional de WhatsApp para la **Dirección Regional de Educación (DRE) X-A y X-B**.
- **Propósito**: Recibir y almacenar material fotográfico y audiovisual enviado por escuelas y usuarios para las redes sociales institucionales.
- **Acción principal**: Descarga imágenes/videos recibidos por mensajes privados, los sube organizadamente a **Google Drive** en subcarpetas con formato `YYYYMMDD_<telefono_remitente>`, envía un mensaje de agradecimiento al usuario e incrementa un contador de envíos.
- **Reportes automáticos**: De lunes a viernes, entre las 8:00 y las 19:00 (hora Argentina), un trabajo programado (Cron) envía un reporte consolidado al grupo de WhatsApp oficial de Prensa (`REPORTE_GROUP_JID`) indicando cuántas sesiones enviaron material en la última hora.

---

## 🛠️ 2. Stack Tecnológico
- **Lenguaje / Entorno**: Node.js (ES Modules, `type: module`).
- **Librería de WhatsApp**: `@whiskeysockets/baileys` (^6.7.9).
- **Almacenamiento en la Nube**: Google Drive API v3 y Google Sheets API v4 (`googleapis` ^144.0.0 via OAuth2 con `client_secret.json` y `token.json`).
- **Programador de Tareas**: `node-cron` (^3.0.3) configurado en zona horaria `America/Argentina/Buenos_Aires`.
- **Servidor HTTP Interno**: Módulo `http` nativo de Node.js escuchando en `http://127.0.0.1:3000` (escucha endpoint `/send-message` para alertas internas como notificaciones de Oracle Cloud Infrastructure).
- **Gestión de Procesos**: PM2 corriendo en un VPS Ubuntu ARM (Oracle Cloud Infrastructure).

---

## ⚙️ 3. Estructura y Reglas Clave del Código (`app.js`)

### A. Filtrado Estricto de Grupos (Regla Fundamental con Excepción de Comandos)
- El bot **NUNCA procesa imágenes, videos ni mensajes generales provenientes de grupos de WhatsApp**.
- **Excepción**: Únicamente se procesan mensajes de grupo si el texto inicia con los comandos `#agenda` o `#efemerides` enviados dentro de `REPORTE_GROUP_JID`. En tal caso, el bot responde de inmediato con la agenda de los próximos 15 días consultando la caché local.
- **Verificación de Grupo**: Un mensaje se descarta inmediatamente si proviene de un grupo (`@g.us`), canal o difusión y no corresponde a un comando autorizado de agenda.

### B. Gestión de Sesiones y Subida a Drive
- Cada remitente privado maneja una sesión en memoria (`sesiones.get(numero)`).
- Cuando un usuario envía archivos, se descargan a la carpeta local `./temp/`.
- Tras finalizar las descargas activas, se programa un `setTimeout` de 3 minutos (180.000 ms). Si el usuario envía más fotos dentro de ese lapso, el timer se reinicia.
- Cumplido el tiempo, los archivos se suben por *streaming* a Google Drive en la carpeta `YYYYMMDD_<telefono>`, se eliminan los archivos temporales de `./temp/`, se incrementa `enviosNuevos` (persistido en `counter.json`) y se le responde al usuario *"Gracias por compartirlo con el equipo de Prensa."*.

### C. Alertas Matutinas y Reporte Horario (Cron)
- **Alertas Matutinas (07:00 AM ART - Diario)**: Consulta la planilla de Google Sheets (`SPREADSHEET_ID`), calcula los días restantes para efemérides educativas y aniversarios institucionales (incluyendo cálculo automático de años de servicio). Si hay eventos coincidentes con los días de anticipación (ej. 7, 3 o 0 días), envía una única alerta consolidada con emojis a `REPORTE_GROUP_JID`.
- **Reporte de Envíos (08:00 - 19:00 ART - Lunes a Viernes)**: Si `enviosNuevos > 0`, redacta el reporte horario y lo envía a `REPORTE_GROUP_JID`. Al finalizar, resetea `enviosNuevos = 0` y guarda en `counter.json`.


---

## 📂 4. Estructura de Archivos del Proyecto
```
Prensi Bot 2026/
├── app.js               # Código principal del bot de WhatsApp y servidor HTTP
├── create_instance.py   # Script de automatización para creación de instancias en OCI
├── package.json         # Dependencias de Node.js (ESM)
├── .env                 # Variables de entorno (PORT, PARENT_FOLDER_ID, REPORTE_GROUP_JID, ADMIN_NUMBER_JID)
├── TASKS.md             # Registro de tareas entre Gemini, Claude y Antigravity
├── CONTEXT.md           # Este archivo de contexto
├── auth_info/           # Credenciales de autenticación de Baileys (gitignored)
├── temp/                # Almacenamiento temporal de archivos antes de subir a Drive
├── client_secret.json   # Credenciales OAuth2 de Google Drive (gitignored)
└── token.json           # Token de acceso OAuth2 de Google Drive (gitignored)
```

---

## 🔄 5. Flujo de Trabajo y Despliegue
1. **Desarrollo**: Modificaciones en `app.js` u otros módulos.
2. **Servidor**: El bot corre en el VPS `prensi-bot-server` con PM2 (`pm2 restart prensi-bot`).
3. **Control de Versiones**: Los cambios se sincronizan en la rama `main` del repositorio de GitHub (`GabrielTurraca/PrensiBot`).
