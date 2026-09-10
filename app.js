import makeWASocket, { 
    useMultiFileAuthState, 
    downloadMediaMessage, 
    DisconnectReason,
    fetchLatestBaileysVersion,
    Browsers
} from "@whiskeysockets/baileys";
import { google } from "googleapis";
import fsPromises from "fs/promises";
import { existsSync, createReadStream, createWriteStream } from "fs";
import cron from "node-cron";
import QRCode from "qrcode-terminal";
import { Readable } from "stream";
import http from "http";

// Cargar variables de entorno desde .env si están presentes
if (!process.env.PARENT_FOLDER_ID) {
    try {
        const { default: dotenv } = await import("dotenv");
        dotenv.config();
    } catch (e) {
        // dotenv no está instalado y no se inició con --env-file, se usarán fallbacks
    }
}

const SECRET_PATH = "./client_secret.json";
const TOKEN_PATH = "./token.json";
const PARENT_FOLDER_ID = process.env.PARENT_FOLDER_ID || "1Q9Oi0PNtdMugEfYyB7Bn3m5poD0orB9e";
const SPREADSHEET_ID = process.env.SPREADSHEET_ID || "1oClGXPhsNW3y2y7UxLs80V5abTd-WgaAoGEwqNT9S5k";
const REPORTE_GROUP_JID = process.env.REPORTE_GROUP_JID || "120363250224178634@g.us"; // Grupo oficial de Prensa

const ADMIN_NUMBER_JID = process.env.ADMIN_NUMBER_JID || "5493624408292@s.whatsapp.net"; // Número personal del administrador
const PORT = process.env.PORT || 3000;
const MAX_FILE_SIZE_MB = parseInt(process.env.MAX_FILE_SIZE_MB || "100", 10);
const CONNECTION_GAP_ALERT_SECONDS = parseInt(process.env.CONNECTION_GAP_ALERT_SECONDS || "20", 10);
const CONNECTION_LOG_PATH = "./connection_events.log";

async function registrarEventoConexion(texto) {
    const timestamp = new Date().toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" });
    const linea = `[${timestamp}] ${texto}\n`;
    console.log(`[CONEXION] ${texto}`);
    try {
        await fsPromises.appendFile(CONNECTION_LOG_PATH, linea, "utf8");
    } catch (e) {
        console.error("❌ Error escribiendo en connection_events.log:", e);
    }
}

const WELCOME_MESSAGE = `¡Hola! Te damos la bienvenida a la línea de Prensa y Comunicación de la DRE X-A y X-B. 📸

Te recordamos que este número solo recibe y almacena material fotográfico o audiovisual para las redes sociales institucionales. No procesamos consultas administrativas, reclamos ni trámites generales.

Si vas a enviarnos las fotos de tu escuela, ¡aguardamos el envío! Si es por otro trámite, por favor comunicate por las vías correspondientes. ¡Muchas gracias!`;

const bienvenidaEnviada = new Map(); // JID -> timestamp de último envío de bienvenida
const processedMessageIds = new Map(); // msgId -> timestamp (TTL 1 hora)

function esMensajeDuplicado(msgId) {
    if (!msgId) return false;
    const ahora = Date.now();
    
    // Mantenimiento de memoria: limpiar IDs con más de 1 hora (3600000 ms)
    if (processedMessageIds.size > 500) {
        for (const [id, time] of processedMessageIds.entries()) {
            if (ahora - time > 3600000) {
                processedMessageIds.delete(id);
            }
        }
    }

    if (processedMessageIds.has(msgId)) {
        return true;
    }

    processedMessageIds.set(msgId, ahora);
    return false;
}

let drive;
let sheets;
let enviosNuevos = 0;
const COUNTER_PATH = "./counter.json";

async function cargarContador() {
    if (existsSync(COUNTER_PATH)) {
        try {
            const raw = await fsPromises.readFile(COUNTER_PATH, "utf8");
            const data = JSON.parse(raw);
            enviosNuevos = data.count || 0;
            console.log(`💾 Contador de envíos cargado: ${enviosNuevos}`);
        } catch (e) {
            console.error("❌ Error al cargar counter.json:", e);
        }
    }
}

async function guardarContador() {
    try {
        await fsPromises.writeFile(COUNTER_PATH, JSON.stringify({ count: enviosNuevos }), "utf8");
    } catch (e) {
        console.error("❌ Error al guardar counter.json:", e);
    }
}

// Cargar el contador al iniciar
await cargarContador();

let sockGlobal = null;
const sesiones = new Map();
const TEMP_DIR = "./temp";

async function limpiarArchivosHuerfanos() {
    if (!existsSync(TEMP_DIR)) return;
    try {
        const archivos = await fsPromises.readdir(TEMP_DIR);
        const ahora = Date.now();
        const UN_HORA_MS = 60 * 60 * 1000; // 1 hora en ms
        let borrados = 0;

        for (const archivo of archivos) {
            const pathArchivo = `${TEMP_DIR}/${archivo}`;
            try {
                const stat = await fsPromises.stat(pathArchivo);
                if (stat.isFile() && (ahora - stat.mtimeMs > UN_HORA_MS)) {
                    await fsPromises.unlink(pathArchivo);
                    borrados++;
                }
            } catch (e) {
                console.error(`❌ Error al procesar archivo temporal ${archivo}:`, e);
            }
        }
        if (borrados > 0) {
            console.log(`🧹 Limpieza al iniciar: Se eliminaron ${borrados} archivo(s) huérfano(s) de ./temp/`);
        } else {
            console.log(`🧹 Limpieza al iniciar: No se encontraron archivos huérfanos en ./temp/`);
        }
    } catch (e) {
        console.error("❌ Error al ejecutar limpieza de archivos huérfanos:", e);
    }
}

async function initGoogleDrive() {
    if (!existsSync(SECRET_PATH) || !existsSync(TOKEN_PATH)) {
        console.error("❌ Faltan client_secret.json o token.json.");
        return false;
    }
    try {
        const credentialsRaw = await fsPromises.readFile(SECRET_PATH, "utf8");
        const credentials = JSON.parse(credentialsRaw);
        const { client_secret, client_id, redirect_uris } = credentials.installed;
        const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);
        const tokenRaw = await fsPromises.readFile(TOKEN_PATH, "utf8");
        const token = JSON.parse(tokenRaw);
        oAuth2Client.setCredentials(token);
        drive = google.drive({ version: "v3", auth: oAuth2Client });
        sheets = google.sheets({ version: "v4", auth: oAuth2Client });
        console.log("✅ Google Drive y Google Sheets (OAuth2) conectados");
        return true;
    } catch (e) {
        console.error("❌ Error conectando a Drive/Sheets:", e.message);
        return false;
    }
}

async function buscarCarpeta(nombreCarpeta) {
    const response = await drive.files.list({
        q: `mimeType='application/vnd.google-apps.folder' and name='${nombreCarpeta}' and '${PARENT_FOLDER_ID}' in parents and trashed=false`,
        fields: "files(id, webViewLink)",
        spaces: "drive"
    });
    if (response.data.files && response.data.files.length > 0) {
        return { id: response.data.files[0].id, link: response.data.files[0].webViewLink };
    }
    return null;
}

async function crearCarpeta(nombreCarpeta) {
    const response = await drive.files.create({
        requestBody: { name: nombreCarpeta, mimeType: "application/vnd.google-apps.folder", parents: [PARENT_FOLDER_ID] },
        fields: "id, webViewLink",
    });
    return { id: response.data.id, link: `https://drive.google.com/drive/folders/${response.data.id}` };
}

/**
 * Subida eficiente mediante Stream directo (sin duplicar buffers en memoria)
 */
async function subirArchivoStream(fileStreamOrBuffer, nombreArchivo, mimeType, folderId) {
    let bodyStream;
    if (typeof fileStreamOrBuffer?.pipe === "function") {
        bodyStream = fileStreamOrBuffer;
    } else {
        bodyStream = new Readable();
        bodyStream.push(fileStreamOrBuffer);
        bodyStream.push(null);
    }

    const response = await drive.files.create({
        requestBody: { name: nombreArchivo, parents: [folderId] },
        media: { mimeType, body: bodyStream },
        fields: "id",
    });
    return response.data.id;
}

/**
 * Reintentos con backoff exponencial para subida a Drive (hasta maxReintentos)
 */
async function subirArchivoConReintentos(filePath, nombreArchivo, mimeType, folderId, maxReintentos = 3) {
    let intento = 0;
    while (intento < maxReintentos) {
        intento++;
        try {
            const fileStream = createReadStream(filePath);
            const id = await subirArchivoStream(fileStream, nombreArchivo, mimeType, folderId);
            return id;
        } catch (err) {
            console.error(`⚠️ [DRIVE] Intento ${intento}/${maxReintentos} falló al subir ${nombreArchivo}: ${err.message}`);
            if (intento < maxReintentos) {
                const backoffMs = Math.pow(2, intento) * 1000; // 2s, 4s, 8s
                console.log(`⏳ [DRIVE] Reintentando subida de ${nombreArchivo} en ${backoffMs / 1000}s...`);
                await new Promise(res => setTimeout(res, backoffMs));
            } else {
                throw new Error(`Fallaron los ${maxReintentos} intentos de subida para ${nombreArchivo}: ${err.message}`);
            }
        }
    }
}

// --- MÓDULO DE GOOGLE SHEETS: EFEMÉRIDES E INSTITUCIONES ---

let cacheAgenda = {
    efemerides: [],
    instituciones: [],
    lastFetch: 0
};
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // Caché local de 6 horas

function parseFechaDiaMes(fechaRaw) {
    if (!fechaRaw) return null;
    const str = String(fechaRaw).trim();
    const parts = str.split(/[\/\-.]/);
    if (parts.length >= 2) {
        const dia = parseInt(parts[0], 10);
        const mes = parseInt(parts[1], 10);
        if (!isNaN(dia) && !isNaN(mes) && dia >= 1 && dia <= 31 && mes >= 1 && mes <= 12) {
            return { dia, mes };
        }
    }
    return null;
}

function parseDiasAnticipacion(val) {
    if (!val) return [7, 3, 0];
    const str = String(val);
    const parsed = str.split(",").map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
    return parsed.length > 0 ? parsed : [7, 3, 0];
}

function getFechaArgentina() {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat("es-AR", {
        timeZone: "America/Argentina/Buenos_Aires",
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
    });
    const parts = formatter.formatToParts(now);
    const day = parseInt(parts.find(p => p.type === "day").value, 10);
    const month = parseInt(parts.find(p => p.type === "month").value, 10);
    const year = parseInt(parts.find(p => p.type === "year").value, 10);
    return { day, month, year, dateObj: new Date(year, month - 1, day) };
}

function obtenerDiasHastaFecha(diaEvento, mesEvento) {
    const hoy = getFechaArgentina();
    let targetYear = hoy.year;
    let fechaTarget = new Date(targetYear, mesEvento - 1, diaEvento);
    
    let diffTime = fechaTarget.getTime() - hoy.dateObj.getTime();
    let diffDays = Math.round(diffTime / (1000 * 3600 * 24));
    
    if (diffDays < 0) {
        fechaTarget = new Date(targetYear + 1, mesEvento - 1, diaEvento);
        diffDays = Math.round((fechaTarget.getTime() - hoy.dateObj.getTime()) / (1000 * 3600 * 24));
    }
    
    return diffDays;
}

function parseCSVRow(line) {
    const result = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') {
            inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
            result.push(current.trim());
            current = '';
        } else {
            current += char;
        }
    }
    result.push(current.trim());
    return result;
}

async function cargarDatosSheets(forceRefresh = false) {
    const ahora = Date.now();
    if (!forceRefresh && cacheAgenda.lastFetch > 0 && (ahora - cacheAgenda.lastFetch < CACHE_TTL_MS)) {
        return cacheAgenda;
    }

    if (!SPREADSHEET_ID) {
        console.warn("⚠️ [SHEETS] SPREADSHEET_ID no configurado.");
        return cacheAgenda;
    }

    try {
        console.log("📊 [SHEETS] Consultando Google Sheets...");
        
        const urlEf = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent("Efemérides")}`;
        const resEf = await fetch(urlEf);
        const textEf = await resEf.text();

        const urlInst = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent("Instituciones")}`;
        const resInst = await fetch(urlInst);
        const textInst = await resInst.text();

        const efemerides = [];
        const linesEf = textEf.split(/\r?\n/).slice(1);
        for (const line of linesEf) {
            if (!line.trim()) continue;
            const cols = parseCSVRow(line);
            const [fechaRaw, titulo, ambito, sugerencia, diasRaw, estado] = cols;
            if (!fechaRaw || !titulo || String(estado || "").trim().toLowerCase() !== "activo") continue;

            const dateParsed = parseFechaDiaMes(fechaRaw);
            if (!dateParsed) continue;

            efemerides.push({
                tipo: "efemeride",
                dia: dateParsed.dia,
                mes: dateParsed.mes,
                titulo: String(titulo).trim(),
                ambito: ambito ? String(ambito).trim() : "General",
                sugerencia: sugerencia ? String(sugerencia).trim() : "",
                diasAnticipacion: parseDiasAnticipacion(diasRaw)
            });
        }

        const instituciones = [];
        const linesInst = textInst.split(/\r?\n/).slice(1);
        for (const line of linesInst) {
            if (!line.trim()) continue;
            const cols = parseCSVRow(line);
            const [nombreInst, localidad, regional, fechaRaw, anioFundRaw, diasRaw, estado] = cols;
            if (!nombreInst || !fechaRaw || String(estado || "").trim().toLowerCase() !== "activo") continue;

            const dateParsed = parseFechaDiaMes(fechaRaw);
            if (!dateParsed) continue;

            const anioFundacion = anioFundRaw ? parseInt(String(anioFundRaw).trim(), 10) : null;

            instituciones.push({
                tipo: "institucion",
                dia: dateParsed.dia,
                mes: dateParsed.mes,
                nombre: String(nombreInst).trim(),
                localidad: localidad ? String(localidad).trim() : "",
                regional: regional ? String(regional).trim() : "",
                anioFundacion: !isNaN(anioFundacion) ? anioFundacion : null,
                diasAnticipacion: parseDiasAnticipacion(diasRaw)
            });
        }

        cacheAgenda = {
            efemerides,
            instituciones,
            lastFetch: ahora
        };
        console.log(`✅ [SHEETS] Caché de agenda actualizada: ${efemerides.length} efemérides y ${instituciones.length} instituciones activas.`);
        return cacheAgenda;
    } catch (e) {
        console.error("❌ [SHEETS] Error leyendo Google Sheets:", e.message);
        return cacheAgenda;
    }
}


async function verificarYNotificarEventosMatutinos() {
    console.log("⏰ [CRON MATUTINO] Ejecutando verificación de efemérides e instituciones...");
    const datos = await cargarDatosSheets(true);
    const hoy = getFechaArgentina();
    
    const alertas = [];

    for (const ef of datos.efemerides) {
        const diasFaltantes = obtenerDiasHastaFecha(ef.dia, ef.mes);
        if (ef.diasAnticipacion.includes(diasFaltantes)) {
            alertas.push({ ...ef, diasFaltantes });
        }
    }

    for (const inst of datos.instituciones) {
        const diasFaltantes = obtenerDiasHastaFecha(inst.dia, inst.mes);
        if (inst.diasAnticipacion.includes(diasFaltantes)) {
            let aniosCumplidos = null;
            if (inst.anioFundacion) {
                aniosCumplidos = hoy.year - inst.anioFundacion;
            }
            alertas.push({ ...inst, diasFaltantes, aniosCumplidos });
        }
    }

    if (alertas.length === 0) {
        console.log("⏰ [CRON MATUTINO] No hay eventos ni aniversarios programados para alertar hoy.");
        return;
    }

    let msg = `🤖 *ALERTAS PRENSI BOT - EFEMÉRIDES Y ANIVERSARIOS*\n\n`;

    alertas.forEach((item, index) => {
        const etiquetaDias = item.diasFaltantes === 0 
            ? "🚨 *¡HOY!*" 
            : `⏳ *Faltan ${item.diasFaltantes} día(s)*`;

        if (item.tipo === "efemeride") {
            msg += `📌 *${item.titulo}* (${etiquetaDias})\n`;
            msg += `  • *Ámbito*: ${item.ambito}\n`;
            msg += `  • *Fecha*: ${String(item.dia).padStart(2, '0')}/${String(item.mes).padStart(2, '0')}\n`;
            if (item.sugerencia) msg += `  • *Sugerencia*: ${item.sugerencia}\n`;
        } else {
            msg += `🏫 *${item.nombre}* (${etiquetaDias})\n`;
            if (item.localidad || item.regional) msg += `  • *Ubicación*: ${item.localidad} (${item.regional})\n`;
            msg += `  • *Fecha Aniversario*: ${String(item.dia).padStart(2, '0')}/${String(item.mes).padStart(2, '0')}\n`;
            if (item.aniosCumplidos) msg += `  • *Cumple*: ${item.aniosCumplidos}° Aniversario (Fundada en ${item.anioFundacion})\n`;
            msg += `  • *Acción*: Preparar gráfica institucional y salutación oficial.\n`;
        }
        if (index < alertas.length - 1) msg += `\n───────────────────\n\n`;
    });

    if (sockGlobal) {
        try {
            await sockGlobal.sendMessage(REPORTE_GROUP_JID, { text: msg });
            console.log(`✅ [CRON MATUTINO] Notificación consolidada enviada a ${REPORTE_GROUP_JID} (${alertas.length} evento(s)).`);
        } catch (err) {
            console.error("❌ [CRON MATUTINO] Error enviando reporte consolidado de agenda:", err);
        }
    }
}

async function obtenerResumenProximosDias(diasLimit = 15) {
    const datos = await cargarDatosSheets(false);
    const hoy = getFechaArgentina();
    
    const proximos = [];

    for (const ef of datos.efemerides) {
        const diasFaltantes = obtenerDiasHastaFecha(ef.dia, ef.mes);
        if (diasFaltantes >= 0 && diasFaltantes <= diasLimit) {
            proximos.push({ ...ef, diasFaltantes });
        }
    }

    for (const inst of datos.instituciones) {
        const diasFaltantes = obtenerDiasHastaFecha(inst.dia, inst.mes);
        if (diasFaltantes >= 0 && diasFaltantes <= diasLimit) {
            let aniosCumplidos = null;
            if (inst.anioFundacion) {
                aniosCumplidos = hoy.year - inst.anioFundacion;
            }
            proximos.push({ ...inst, diasFaltantes, aniosCumplidos });
        }
    }

    proximos.sort((a, b) => a.diasFaltantes - b.diasFaltantes);

    if (proximos.length === 0) {
        return `📅 *Agenda Institucional (Próximos ${diasLimit} Días)*\n\nNo hay efemérides ni aniversarios registrados en la planilla para los próximos ${diasLimit} días.`;
    }

    let msg = `📅 *AGENDA INSTITUCIONAL - PRÓXIMOS ${diasLimit} DÍAS*\n\n`;

    proximos.forEach((item) => {
        const fechaStr = `${String(item.dia).padStart(2, '0')}/${String(item.mes).padStart(2, '0')}`;
        const cuandoStr = item.diasFaltantes === 0 ? "HOY" : `en ${item.diasFaltantes} día(s)`;

        if (item.tipo === "efemeride") {
            msg += `📖 *${fechaStr}* - *${item.titulo}* (${cuandoStr})\n`;
            msg += `   └ Ámbito: ${item.ambito}\n`;
        } else {
            msg += `🏫 *${fechaStr}* - *${item.nombre}* (${cuandoStr})\n`;
            msg += `   └ ${item.localidad || 'DRE'} ${item.aniosCumplidos ? `(${item.aniosCumplidos}° Aniversario)` : ''}\n`;
        }
    });

    return msg;
}


function obtenerMensajeInterno(message) {
    if (!message) return null;
    if (message.ephemeralMessage) {
        return obtenerMensajeInterno(message.ephemeralMessage.message);
    }
    if (message.viewOnceMessage) {
        return obtenerMensajeInterno(message.viewOnceMessage.message);
    }
    if (message.viewOnceMessageV2) {
        return obtenerMensajeInterno(message.viewOnceMessageV2.message);
    }
    if (message.viewOnceMessageV2Extension) {
        return obtenerMensajeInterno(message.viewOnceMessageV2Extension.message);
    }
    if (message.documentWithCaptionMessage) {
        return obtenerMensajeInterno(message.documentWithCaptionMessage.message);
    }
    return message;
}

let disconnectTimestamp = 0;

async function iniciarBot() {
    console.log("🚀 Iniciando bot...");
    await initGoogleDrive();
    
    if (!existsSync(TEMP_DIR)) {
        await fsPromises.mkdir(TEMP_DIR, { recursive: true });
    }
    
    await limpiarArchivosHuerfanos();
    
    const { state, saveCreds } = await useMultiFileAuthState("./auth_info");
    const { version } = await fetchLatestBaileysVersion();
    
    const sock = makeWASocket({ 
        version,
        auth: state, 
        printQRInTerminal: false, 
        browser: Browsers.ubuntu("Chrome"),
        markOnlineOnConnect: true,
        syncFullHistory: false,
        shouldSyncHistoryMessage: () => true,
        getMessage: async () => ({ conversation: "" })
    });
    
    sockGlobal = sock;

    sock.ev.on("connection.update", async (update) => {
        const { connection, qr, lastDisconnect, receivedPendingNotifications } = update;
        if (qr) { console.log("\n📱 ESCANEA ESTE QR:\n"); QRCode.generate(qr, { small: true }); }
        
        if (connection === "close") {
            disconnectTimestamp = Date.now();
            const statusCode = (lastDisconnect?.error)?.output?.statusCode;
            const errorMsg = lastDisconnect?.error?.message || "Desconexión de socket de WhatsApp";
            await registrarEventoConexion(`🔴 Desconexión de socket (Código: ${statusCode || "N/A"} - Error: ${errorMsg})`);

            const shouldReconnect = statusCode !== DisconnectReason?.loggedOut;
            if (shouldReconnect) setTimeout(iniciarBot, 5000);
        }

        if (connection === "open") {
            const ahora = Date.now();
            let gapSeconds = 0;
            if (disconnectTimestamp > 0) {
                gapSeconds = Math.floor((ahora - disconnectTimestamp) / 1000);
            }
            
            const pendingInfo = receivedPendingNotifications === false 
                ? "0 (Sin notificaciones pendientes)" 
                : (receivedPendingNotifications ? "Sí (Hay notificaciones pendientes)" : "Completada");

            await registrarEventoConexion(`🟢 Conexión de WhatsApp restablecida. Duración del corte: ${gapSeconds}s. Notificaciones offline: ${pendingInfo}`);

            const esCorteLargo = gapSeconds >= CONNECTION_GAP_ALERT_SECONDS;
            const esSyncIncompleto = receivedPendingNotifications === false || receivedPendingNotifications === 0;

            if (disconnectTimestamp > 0 && (esCorteLargo || esSyncIncompleto)) {
                const horaCorte = new Date(disconnectTimestamp).toLocaleTimeString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" });
                const horaReconexion = new Date(ahora).toLocaleTimeString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" });
                
                const alertaMsg = `⚠️ *Alerta de Reconexión de Socket*\n\n` +
                    `• *Inicio del corte*: ${horaCorte}\n` +
                    `• *Reconexión*: ${horaReconexion}\n` +
                    `• *Duración del corte*: ${gapSeconds} segundo(s)\n` +
                    `• *Notificaciones offline*: ${pendingInfo}\n\n` +
                    `Revisá si algún usuario envió material durante este lapso.`;

                try {
                    await sock.sendMessage(ADMIN_NUMBER_JID, { text: alertaMsg });
                } catch (notifyErr) {
                    console.error("Error al enviar alerta de reconexión al admin:", notifyErr);
                }
            }
            disconnectTimestamp = 0;
        }
    });
    
    sock.ev.on("creds.update", saveCreds);
    
    sock.ev.on("messages.upsert", async ({ messages, type }) => {
        // Aceptar tanto mensajes en tiempo real ("notify") como recuperados tras reconexión ("append")
        if (type !== "notify" && type !== "append") return;

        for (const msg of messages) {
            if (!msg.message || msg.key.fromMe) continue;
            
            const msgId = msg.key.id;
            if (esMensajeDuplicado(msgId)) {
                console.log(`[MENSAJE DUPLICADO] Omitiendo mensaje ya procesado (ID: ${msgId})`);
                continue;
            }
            
            const msgTimestamp = typeof msg.messageTimestamp === "number" 
                ? msg.messageTimestamp 
                : (msg.messageTimestamp?.low || 0);
            const ahoraSec = Math.floor(Date.now() / 1000);
            // Umbral de 15 minutos (900s) para permitir mensajes en cola recibidos tras reconexión
            if (msgTimestamp > 0 && (ahoraSec - msgTimestamp) > 900) {
                console.log(`[MENSAJE] Omitiendo mensaje antiguo (recibido hace ${ahoraSec - msgTimestamp} s)`);
                continue;
            }

            const rawJid = msg.key.remoteJid || "";
            const senderPn = msg.key.senderPn || "";
            const participant = msg.key.participant || msg.participant || "";

            // Seleccionar el JID de número telefónico real si el mensaje viene identificado con @lid
            const numero = (senderPn && senderPn.endsWith("@s.whatsapp.net")) ? senderPn : rawJid;

            const messageContent = obtenerMensajeInterno(msg.message);
            if (!messageContent) continue;

            const messageKeys = Object.keys(messageContent);
            const validKeys = [
                "conversation", "extendedTextMessage", "imageMessage", "videoMessage",
                "audioMessage", "documentMessage", "stickerMessage", "contactMessage",
                "contactsArrayMessage", "locationMessage", "liveLocationMessage",
                "interactiveResponseMessage", "buttonsResponseMessage", "listResponseMessage",
                "templateButtonReplyMessage"
            ];
            const hasValidKey = messageKeys.some(key => validKeys.includes(key));
            if (!hasValidKey) continue;

            const texto = messageContent.conversation || 
                          messageContent.extendedTextMessage?.text || 
                          messageContent.imageMessage?.caption || 
                          messageContent.videoMessage?.caption || 
                          messageContent.documentMessage?.caption ||
                          "";

            const esComandoAgenda = texto.trim().toLowerCase().startsWith("#agenda") || texto.trim().toLowerCase().startsWith("#efemerides");

            // Ignorar estrictamente todo mensaje de grupo, canal, difusión o estado (salvo comandos #agenda / #efemerides en grupo)
            const isGroup = !!participant || 
                            rawJid.endsWith("@g.us") || 
                            rawJid.includes("@g.us") || 
                            rawJid.endsWith("@broadcast") ||
                            rawJid.endsWith("@newsletter") ||
                            rawJid === REPORTE_GROUP_JID;

            if (isGroup) {
                if (esComandoAgenda && (rawJid === REPORTE_GROUP_JID || rawJid.endsWith("@g.us"))) {
                    console.log(`[COMANDO AGENDA EN GRUPO] Recibido "${texto.trim()}" en ${rawJid}`);
                    try {
                        const respuestaAgenda = await obtenerResumenProximosDias(15);
                        await sock.sendMessage(rawJid, { text: respuestaAgenda });
                    } catch (errAgenda) {
                        console.error("❌ Error al responder comando agenda en grupo:", errAgenda);
                    }
                } else {
                    if (rawJid.endsWith("@g.us") || rawJid === REPORTE_GROUP_JID) {
                        console.log(`[GRUPO IGNORADO] ID: ${rawJid}`);
                    } else if (participant) {
                        console.log(`[MENSAJE DE GRUPO IGNORADO] Participante: ${participant.split('@')[0]} en ${rawJid}`);
                    } else {
                        console.log(`[DIFUSION/CANAL IGNORADO] ID: ${rawJid}`);
                    }
                }
                continue;
            }

            if (esComandoAgenda) {
                console.log(`[COMANDO AGENDA PRIVADO] Recibido de ${numero.split('@')[0]}`);
                try {
                    const respuestaAgenda = await obtenerResumenProximosDias(15);
                    await sock.sendMessage(numero, { text: respuestaAgenda });
                } catch (errAgenda) {
                    console.error("❌ Error respondiendo agenda en privado:", errAgenda);
                }
                continue;
            }

            const tipoMsg = messageKeys.find(key => validKeys.includes(key)) || "desconocido";

            console.log(`[MENSAJE] Recibido de ${numero.split('@')[0]} - Tipo: ${tipoMsg} - Texto: "${texto}" - Es archivo: ${!!esArchivo}`);
            
            try {
                if (!sesiones.has(numero)) {
                    console.log(`[SESION] Creando nueva sesión para ${numero.split('@')[0]}`);
                    sesiones.set(numero, { 
                        archivosLocales: [],
                        timeoutId: null,
                        esRecap: false,
                        activeDownloads: 0
                    });
                }

                const sesion = sesiones.get(numero);

                if (texto.toLowerCase().includes("#recap")) {
                    console.log(`[SESION] Activado modo recap para ${numero.split('@')[0]}`);
                    sesion.esRecap = true;
                }

                if (sesion.timeoutId) {
                    console.log(`[SESION] Cancelando timeout anterior para ${numero.split('@')[0]}`);
                    clearTimeout(sesion.timeoutId);
                    sesion.timeoutId = null;
                }

                if (esArchivo) {
                    // Verificación de tamaño antes de iniciar descarga
                    let sizeInBytes = 0;
                    if (messageContent.imageMessage) sizeInBytes = Number(messageContent.imageMessage.fileLength || 0);
                    else if (messageContent.videoMessage) sizeInBytes = Number(messageContent.videoMessage.fileLength || 0);
                    else if (messageContent.documentMessage) sizeInBytes = Number(messageContent.documentMessage.fileLength || 0);

                    const maxSizeBytes = MAX_FILE_SIZE_MB * 1024 * 1024;
                    if (sizeInBytes > maxSizeBytes) {
                        const sizeMB = (sizeInBytes / (1024 * 1024)).toFixed(1);
                        console.warn(`[DESCARGA OMITIDA] Archivo de ${numero.split('@')[0]} supera el límite (${sizeMB} MB > ${MAX_FILE_SIZE_MB} MB)`);
                        await sock.sendMessage(numero, { text: `⚠️ El archivo enviado es demasiado pesado (${sizeMB} MB). El tamaño máximo permitido es de ${MAX_FILE_SIZE_MB} MB. Por favor enviá un video más corto o comprimido.` });
                        esArchivo = false;
                    }
                }

                if (esArchivo) {
                    sesion.activeDownloads++;
                    console.log(`[DESCARGA] Iniciando descarga de archivo de ${numero.split('@')[0]} (Descargas activas: ${sesion.activeDownloads})`);
                    try {
                        const buffer = await downloadMediaMessage(msg, "buffer", {});
                        let ext = isImage ? ".jpg" : ".mp4";
                        let mime = isImage ? "image/jpeg" : "video/mp4";
                        if (messageContent.documentMessage) {
                            mime = messageContent.documentMessage.mimetype || mime;
                            const docName = messageContent.documentMessage.fileName || "";
                            const matchExt = docName.match(/\.[a-zA-Z0-9]+$/);
                            if (matchExt) ext = matchExt[0];
                        }
                        const fileName = `archivo_${Date.now()}_${Math.random().toString(36).substring(2, 8)}${ext}`;
                        const filePath = `${TEMP_DIR}/${fileName}`;
                        
                        await fsPromises.writeFile(filePath, buffer);
                        
                        sesion.archivosLocales.push({
                            path: filePath,
                            name: fileName,
                            mimeType: mime
                        });
                        console.log(`[DESCARGA] Guardado archivo local: ${fileName}`);
                    } catch (downloadErr) {
                        console.error("[DESCARGA] Error al descargar media de whatsapp:", downloadErr);
                    } finally {
                        sesion.activeDownloads--;
                        console.log(`[DESCARGA] Descarga finalizada para ${numero.split('@')[0]} (Descargas activas: ${sesion.activeDownloads})`);
                    }
                }

                if (sesion.activeDownloads === 0) {
                    if (sesion.archivosLocales.length > 0) {
                        console.log(`[SESION] Programando subida a Drive en 3 minutos para ${numero.split('@')[0]} (${sesion.archivosLocales.length} archivos en espera)`);
                        sesion.timeoutId = setTimeout(async () => {
                            try {
                                console.log(`[DRIVE] Iniciando proceso de subida para ${numero.split('@')[0]}`);
                                sesiones.delete(numero);

                                const now = new Date();
                                const year = now.getFullYear();
                                const month = String(now.getMonth() + 1).padStart(2, '0');
                                const day = String(now.getDate()).padStart(2, '0');
                                const numLimpio = numero.split('@')[0];
                                let carpetaName = `${year}${month}${day}_${numLimpio}`;
                                
                                if (sesion.esRecap) {
                                    carpetaName = `${year}${month}${day}_Recap`;
                                }
                                
                                let carpeta = await buscarCarpeta(carpetaName);
                                if (!carpeta) {
                                    console.log(`[DRIVE] Creando carpeta: ${carpetaName}`);
                                    carpeta = await crearCarpeta(carpetaName);
                                }
                                
                                let subidosConExito = 0;
                                for (const archivo of sesion.archivosLocales) {
                                    if (existsSync(archivo.path)) {
                                        console.log(`[DRIVE] Subiendo archivo a Drive (Streaming con reintentos): ${archivo.name}`);
                                        try {
                                            await subirArchivoConReintentos(archivo.path, archivo.name, archivo.mimeType, carpeta.id);
                                            await fsPromises.unlink(archivo.path);
                                            console.log(`[DRIVE] Archivo subido y eliminado localmente: ${archivo.name}`);
                                            subidosConExito++;
                                        } catch (uploadErr) {
                                            console.error(`❌ [DRIVE] Falló definitivamente la subida de ${archivo.name}. Se conserva en ./temp/ para revisión manual: ${uploadErr.message}`);
                                        }
                                    }
                                }
                                
                                if (subidosConExito > 0) {
                                    enviosNuevos++;
                                    await guardarContador();
                                    console.log(`[DRIVE] Subida completada con éxito para ${numero.split('@')[0]}. Enviando mensaje de agradecimiento.`);
                                    await sock.sendMessage(numero, { text: "Gracias por compartirlo con el equipo de Prensa." });
                                } else {
                                    console.error(`❌ [DRIVE] No se pudo subir ningún archivo enviado por wa.me/${numero.split('@')[0]}. Los archivos se conservan en ./temp/.`);
                                    try {
                                        await sock.sendMessage(ADMIN_NUMBER_JID, { text: `⚠️ *Error de Subida a Drive*\nFalló la subida de todos los archivos enviados por: wa.me/${numero.split('@')[0]}\nLos archivos se conservan en ./temp/ del servidor para revisión manual.` });
                                    } catch (notifyErr) {
                                        console.error("Error al notificar al admin:", notifyErr);
                                    }
                                }
                            } catch (err) {
                                console.error("[DRIVE] Error inesperado durante el ciclo de subida a drive:", err);
                                try {
                                    await sock.sendMessage(ADMIN_NUMBER_JID, { text: `⚠️ *Error Inesperado en Subida a Drive*\nOcurrió un fallo en el ciclo de subida para: wa.me/${numero.split('@')[0]}` });
                                } catch (notifyErr) {
                                    console.error("Error al notificar al admin:", notifyErr);
                                }
                            }
                        }, 180000);
                    } else {
                        const esComandoRecap = texto.toLowerCase().includes("#recap");
                        if (!esComandoRecap) {
                            const ahora = Date.now();
                            const ultimaBienvenida = bienvenidaEnviada.get(numero) || 0;
                            const COOLDOWN_MS = 24 * 60 * 60 * 1000;

                            if (ahora - ultimaBienvenida > COOLDOWN_MS) {
                                console.log(`[BIENVENIDA] Enviando mensaje de bienvenida a ${numero.split('@')[0]}`);
                                bienvenidaEnviada.set(numero, ahora);
                                await sock.sendMessage(numero, { text: WELCOME_MESSAGE });
                            } else {
                                console.log(`[BIENVENIDA] Omitiendo bienvenida para ${numero.split('@')[0]} por cooldown`);
                            }
                        } else {
                            console.log(`[COMANDO] Recibido #recap de ${numero.split('@')[0]}`);
                        }
                        sesiones.delete(numero);
                    }
                }

            } catch (e) {
                console.error(e);
                try {
                    await sock.sendMessage(ADMIN_NUMBER_JID, { text: `⚠️ *Error de Procesamiento*\nOcurrió un error al procesar un mensaje de: wa.me/${numero.split('@')[0]}` });
                } catch (notifyErr) {
                    console.error("Error al notificar al admin:", notifyErr);
                }
            }
        }
    });
}

// Cron diario matutino (07:00 AM ART): Verificación de efemérides y aniversarios institucionales
cron.schedule('0 7 * * *', async () => {
    try {
        await verificarYNotificarEventosMatutinos();
    } catch (err) {
        console.error("[CRON MATUTINO] Error ejecutando verificación matutina:", err);
    }
}, {
    timezone: "America/Argentina/Buenos_Aires"
});

cron.schedule('0 8-19 * * 1-5', async () => {

    if (enviosNuevos > 0 && sockGlobal) {
        const enviosAEnviar = enviosNuevos;
        try {
            const localHourStr = new Date().toLocaleString("en-US", { timeZone: "America/Argentina/Buenos_Aires", hour: "numeric", hour12: false });
            const currentHour = parseInt(localHourStr, 10);
            
            let reportText = "";
            if (currentHour === 8) {
                reportText = `🤖 *Reporte Prensi Bot*\n\nEn el período fuera de horario (desde ayer a las 19:00) he recibido material nuevo de ${enviosAEnviar} sesión(es) de WhatsApp. Revisar el chat o la carpeta de Drive.`;
            } else {
                reportText = `🤖 *Reporte Prensi Bot*\n\nEn la última hora he recibido material nuevo de ${enviosAEnviar} sesión(es) de WhatsApp. Revisar el chat o la carpeta de Drive.`;
            }
            
            await sockGlobal.sendMessage(REPORTE_GROUP_JID, { text: reportText });
            console.log(`[CRON] Reporte enviado (Hora: ${currentHour}). Envios reseteados de ${enviosAEnviar} a 0.`);
        } catch (error) {
            console.error("[CRON] Error enviando reporte:", error);
        } finally {
            enviosNuevos = 0;
            await guardarContador();
        }
    }
}, {
    timezone: "America/Argentina/Buenos_Aires"
});

function iniciarHttpServer() {
    const server = http.createServer((req, res) => {
        if (req.method === "POST" && req.url === "/send-message") {
            let body = "";
            req.on("data", chunk => {
                body += chunk.toString();
            });
            req.on("end", async () => {
                try {
                    const data = JSON.parse(body);
                    const message = data.message;
                    if (message && sockGlobal) {
                        await sockGlobal.sendMessage(ADMIN_NUMBER_JID, { text: message });
                        res.writeHead(200, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ status: "success" }));
                        return;
                    }
                } catch (e) {
                    console.error("Error processing HTTP message request:", e);
                }
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ status: "error", message: "Invalid request" }));
            });
        } else {
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ status: "error", message: "Not Found" }));
        }
    });

    server.listen(PORT, "127.0.0.1", () => {
        console.log(`🚀 HTTP Server listening on http://127.0.0.1:${PORT} (Internal Only)`);
    });
}

async function apagarLimpio(signal) {
    console.log(`\n🛑 Recibida señal ${signal}. Guardando contador y cerrando servidor...`);
    await guardarContador();
    process.exit(0);
}

process.on("SIGINT", () => apagarLimpio("SIGINT"));
process.on("SIGTERM", () => apagarLimpio("SIGTERM"));

iniciarBot().catch(console.error);
iniciarHttpServer();
