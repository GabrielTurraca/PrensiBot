// certificados-optimizado.js — ESM (el proyecto usa "type": "module")
//
// Correcciones sobre la versión anterior:
//  - fields ahora incluye createdTime y parents (si no, la fecha de emisión
//    y el evento/carpeta de origen llegan undefined al frontend).
//  - CERTIFICADOS_FOLDER_ID puede ser un solo ID o varios separados por
//    coma (por ejemplo, si X-A y X-B guardan sus constancias en carpetas
//    de Drive distintas) — se indexan y consultan todas.

const CACHE_REFRESH_MS = 10 * 60 * 1000; // 10 minutos, ajustable
const CAMPOS_DRIVE = 'files(id, name, webViewLink, webContentLink, createdTime, parents)';

let indiceCertificados = new Map(); // dni -> [{ id, name, webViewLink, webContentLink, createdTime, parents }]
let indiceListo = false;

function obtenerCarpetasConfiguradas(carpetaConstanciasId) {
  return Array.isArray(carpetaConstanciasId)
    ? carpetaConstanciasId
    : String(carpetaConstanciasId).split(',').map(id => id.trim()).filter(Boolean);
}

async function listarTodosLosArchivos(driveClient, carpetaId) {
  let archivos = [];
  let pageToken = null;
  do {
    const res = await driveClient.files.list({
      q: `'${carpetaId}' in parents and trashed = false`,
      fields: `nextPageToken, ${CAMPOS_DRIVE}`,
      pageSize: 1000,
      pageToken
    });
    archivos = archivos.concat(res.data.files || []);
    pageToken = res.data.nextPageToken;
  } while (pageToken);
  return archivos;
}

export async function reconstruirIndice(driveClient, carpetaConstanciasId) {
  try {
    const carpetas = obtenerCarpetasConfiguradas(carpetaConstanciasId);
    const listas = await Promise.all(carpetas.map(id => listarTodosLosArchivos(driveClient, id)));
    const archivos = listas.flat();
    const nuevoIndice = new Map();

    for (const archivo of archivos) {
      // Se asume que el nombre del archivo contiene el DNI, ej: "12345678_Juan_Perez.pdf"
      const match = archivo.name.match(/\d{7,8}/);
      if (!match) continue;
      const dni = match[0];
      if (!nuevoIndice.has(dni)) nuevoIndice.set(dni, []);
      nuevoIndice.get(dni).push(archivo);
    }

    indiceCertificados = nuevoIndice;
    indiceListo = true;
    console.log(`[certificados] índice actualizado: ${archivos.length} archivos en ${carpetas.length} carpeta(s), ${nuevoIndice.size} DNIs`);
  } catch (err) {
    console.error('[certificados] error al reconstruir índice:', err.message);
    // Si falla, se mantiene el índice anterior en memoria en vez de vaciarlo
  }
}

export function iniciarRefrescoPeriodico(driveClient, carpetaConstanciasId) {
  reconstruirIndice(driveClient, carpetaConstanciasId); // carga inicial
  setInterval(() => reconstruirIndice(driveClient, carpetaConstanciasId), CACHE_REFRESH_MS);
}

/**
 * Reemplaza a buscarCertificadosEnDrive. Devuelve { status: 'success'|'not_found', results: [...] }
 */
export async function buscarCertificados(driveClient, carpetaConstanciasId, dniOCodigo) {
  // 1) Camino rápido: índice en memoria (<50ms)
  if (indiceListo && indiceCertificados.has(dniOCodigo)) {
    return { status: 'success', results: indiceCertificados.get(dniOCodigo) };
  }

  // 2) Fallback a Drive en paralelo (no en cascada), por cada carpeta configurada
  const carpetas = obtenerCarpetasConfiguradas(carpetaConstanciasId);

  const intentos = carpetas.flatMap(carpetaId => [
    driveClient.files.list({
      q: `'${carpetaId}' in parents and name contains '${dniOCodigo}' and mimeType = 'application/pdf' and trashed = false`,
      fields: CAMPOS_DRIVE
    }),
    driveClient.files.list({
      q: `'${carpetaId}' in parents and name contains '${dniOCodigo}' and trashed = false`,
      fields: CAMPOS_DRIVE
    })
  ]);
  // Fallback global (toda la cuenta) solo como último recurso
  intentos.push(
    driveClient.files.list({
      q: `name contains '${dniOCodigo}' and trashed = false`,
      fields: CAMPOS_DRIVE
    })
  );

  const resultados = await Promise.allSettled(intentos);
  for (const r of resultados) {
    if (r.status === 'fulfilled' && r.value.data.files && r.value.data.files.length > 0) {
      return { status: 'success', results: r.value.data.files };
    }
  }

  return { status: 'not_found', results: [] };
}
