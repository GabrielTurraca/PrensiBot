// certificados-optimizado.js — ESM (el proyecto usa "type": "module")
//
// Características:
//  - Descubrimiento e indexación automática de carpetas raíz y subcarpetas de eventos (1er nivel).
//  - Enriquecimiento de metadatos: dni, evento (nombre de carpeta o extraído del archivo), size, links de vista y descarga.
//  - Búsqueda instantánea en memoria (<50ms) con fallback paralelo a Google Drive API.
//  - Formateador de respuesta para comandos de WhatsApp (#certificado / #constancia).

const CACHE_REFRESH_MS = 10 * 60 * 1000; // 10 minutos
const CAMPOS_DRIVE = 'files(id, name, webViewLink, webContentLink, createdTime, size, parents, mimeType)';

let indiceCertificados = new Map(); // dni -> [certificadoEnriquecido]
let mapaCarpetas = new Map();       // folderId -> folderName
let todasLasCarpetasIds = [];       // [rootIds + subfolderIds]
let indiceListo = false;

function obtenerCarpetasConfiguradas(carpetaConstanciasId) {
  return Array.isArray(carpetaConstanciasId)
    ? carpetaConstanciasId
    : String(carpetaConstanciasId || '').split(',').map(id => id.trim()).filter(Boolean);
}

const NOMBRES_CARPETA_GENERICOS = new Set([
  'constancia dre',
  'constancias dre',
  'certificados',
  'certificados dre',
  'constancias',
  'general'
]);

function resolverNombreEvento(archivo, folderMap) {
  const parentId = Array.isArray(archivo.parents) && archivo.parents.length > 0 ? archivo.parents[0] : null;
  let eventoNombre = (parentId && folderMap.get(parentId)) ? folderMap.get(parentId) : 'Constancia DRE';

  if (NOMBRES_CARPETA_GENERICOS.has(eventoNombre.toLowerCase().trim())) {
    const sinExt = String(archivo.name || '').replace(/\.pdf$/i, '');
    const parts = sinExt.split('_');
    if (parts.length >= 2 && parts[1]) {
      const tagEtiqueta = parts[1].replace(/([a-z])([A-Z])/g, '$1 $2').trim();
      if (tagEtiqueta && !/^\d+$/.test(tagEtiqueta)) {
        eventoNombre = tagEtiqueta;
      }
    }
  }
  return eventoNombre;
}

function enriquecerArchivo(archivo, folderMap = mapaCarpetas, dniFallback = '') {
  const matchDni = String(archivo.name || '').match(/\d{7,8}/);
  const dni = matchDni ? matchDni[0] : dniFallback;
  const evento = resolverNombreEvento(archivo, folderMap);

  return {
    id: archivo.id,
    name: archivo.name,
    dni: dni || 'S/D',
    evento,
    webViewLink: archivo.webViewLink || `https://drive.google.com/file/d/${archivo.id}/view`,
    webContentLink: archivo.webContentLink || `https://drive.google.com/uc?export=download&id=${archivo.id}`,
    createdTime: archivo.createdTime || null,
    size: archivo.size || null,
    parents: archivo.parents || []
  };
}

async function descubrirEstructuraCarpetas(driveClient, carpetasRaiz) {
  const nuevoMapa = new Map();
  const conjuntoIds = new Set();

  for (const rootId of carpetasRaiz) {
    conjuntoIds.add(rootId);
    let rootName = 'Constancia DRE';
    try {
      const rootInfo = await driveClient.files.get({
        fileId: rootId,
        fields: 'id, name'
      });
      if (rootInfo.data && rootInfo.data.name) {
        rootName = rootInfo.data.name;
      }
    } catch (err) {
      console.warn(`[certificados] No se pudo obtener nombre de carpeta raíz ${rootId}:`, err.message);
    }
    nuevoMapa.set(rootId, rootName);

    try {
      const resSub = await driveClient.files.list({
        q: `mimeType = 'application/vnd.google-apps.folder' and '${rootId}' in parents and trashed = false`,
        fields: 'files(id, name)',
        pageSize: 100
      });
      for (const sub of (resSub.data.files || [])) {
        conjuntoIds.add(sub.id);
        nuevoMapa.set(sub.id, sub.name);
      }
    } catch (err) {
      console.warn(`[certificados] No se pudieron listar subcarpetas de ${rootId}:`, err.message);
    }
  }

  return {
    folderMap: nuevoMapa,
    folderIds: Array.from(conjuntoIds)
  };
}

async function listarTodosLosArchivos(driveClient, carpetaId) {
  let archivos = [];
  let pageToken = null;
  do {
    const res = await driveClient.files.list({
      q: `'${carpetaId}' in parents and mimeType != 'application/vnd.google-apps.folder' and trashed = false`,
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
    const carpetasRaiz = obtenerCarpetasConfiguradas(carpetaConstanciasId);
    if (carpetasRaiz.length === 0) return;

    const { folderMap, folderIds } = await descubrirEstructuraCarpetas(driveClient, carpetasRaiz);
    const listas = await Promise.all(folderIds.map(id => listarTodosLosArchivos(driveClient, id)));
    const archivos = listas.flat();
    const nuevoIndice = new Map();

    for (const archivo of archivos) {
      const match = String(archivo.name || '').match(/\d{7,8}/);
      if (!match) continue;
      const dni = match[0];
      const enriquecido = enriquecerArchivo(archivo, folderMap, dni);
      if (!nuevoIndice.has(dni)) nuevoIndice.set(dni, []);
      nuevoIndice.get(dni).push(enriquecido);
    }

    mapaCarpetas = folderMap;
    todasLasCarpetasIds = folderIds;
    indiceCertificados = nuevoIndice;
    indiceListo = true;
    console.log(`[certificados] Índice actualizado: ${archivos.length} archivos en ${folderIds.length} carpeta(s)/subcarpeta(s), ${nuevoIndice.size} DNIs indexados`);
  } catch (err) {
    console.error('[certificados] Error al reconstruir índice:', err.message);
    // Si falla, se mantiene el índice anterior en memoria
  }
}

export function iniciarRefrescoPeriodico(driveClient, carpetaConstanciasId) {
  reconstruirIndice(driveClient, carpetaConstanciasId); // carga inicial
  setInterval(() => reconstruirIndice(driveClient, carpetaConstanciasId), CACHE_REFRESH_MS);
}

/**
 * Busca certificados por DNI o código. Devuelve { status: 'success'|'not_found', results: [...] }
 */
export async function buscarCertificados(driveClient, carpetaConstanciasId, dniOCodigo) {
  const rawStr = String(dniOCodigo || '').trim();
  if (!rawStr || rawStr.length < 3) {
    return { status: 'not_found', results: [] };
  }

  const dniLimpio = rawStr.replace(/\D/g, '').trim();
  const termSanitized = rawStr.replace(/['"\\]/g, '').trim();

  // 1) Camino rápido: índice en memoria (<50ms)
  if (indiceListo) {
    if (dniLimpio && indiceCertificados.has(dniLimpio)) {
      return { status: 'success', results: indiceCertificados.get(dniLimpio) };
    }
    if (indiceCertificados.has(termSanitized)) {
      return { status: 'success', results: indiceCertificados.get(termSanitized) };
    }
  }

  if (!driveClient) {
    return { status: 'not_found', results: [] };
  }

  const terminos = [];
  if (dniLimpio && dniLimpio.length >= 4) terminos.push(dniLimpio);
  if (termSanitized && termSanitized !== dniLimpio && termSanitized.length >= 3) terminos.push(termSanitized);
  if (terminos.length === 0) {
    return { status: 'not_found', results: [] };
  }

  // 2) Fallback a Drive en paralelo sobre carpetas conocidas
  const carpetas = todasLasCarpetasIds.length > 0
    ? todasLasCarpetasIds
    : obtenerCarpetasConfiguradas(carpetaConstanciasId);

  const nameClause = terminos.map(t => `name contains '${t}'`).join(' or ');

  const intentos = [];
  if (carpetas.length > 0) {
    const parentClause = carpetas.map(id => `'${id}' in parents`).join(' or ');
    intentos.push(
      driveClient.files.list({
        q: `(${parentClause}) and (${nameClause}) and mimeType = 'application/pdf' and trashed = false`,
        fields: CAMPOS_DRIVE,
        pageSize: 20
      }),
      driveClient.files.list({
        q: `(${parentClause}) and (${nameClause}) and mimeType != 'application/vnd.google-apps.folder' and trashed = false`,
        fields: CAMPOS_DRIVE,
        pageSize: 20
      })
    );
  }

  // Fallback global (toda la cuenta) como último recurso
  intentos.push(
    driveClient.files.list({
      q: `(${nameClause}) and mimeType = 'application/pdf' and trashed = false`,
      fields: CAMPOS_DRIVE,
      pageSize: 20
    })
  );

  const resultados = await Promise.allSettled(intentos);
  for (const r of resultados) {
    if (r.status === 'fulfilled' && r.value?.data?.files && r.value.data.files.length > 0) {
      const enriquecidos = r.value.data.files.map(f => enriquecerArchivo(f, mapaCarpetas, dniLimpio || termSanitized));
      return { status: 'success', results: enriquecidos };
    }
  }

  return { status: 'not_found', results: [] };
}

/**
 * Formatea respuesta para el comando #certificado / #constancia en WhatsApp
 */
export async function responderCertificadosWhatsApp(driveClient, carpetaConstanciasId, textoMensaje = '', domainName = 'prensi.macrointell.com.ar') {
  const argumento = String(textoMensaje || '')
    .replace(/^#\s*\S+\s*/i, '')
    .trim();

  const dniLimpio = argumento.replace(/\D/g, '');
  const consulta = dniLimpio.length >= 6 ? dniLimpio : argumento;

  if (!consulta || consulta.length < 4) {
    return [
      '📜 *BUSCADOR DE CERTIFICADOS Y CONSTANCIAS DRE X-A / X-B*',
      '',
      'Para consultar o validar tus certificados por WhatsApp, enviá el comando seguido de tu número de DNI (sin puntos):',
      '• `#certificado 35123456`',
      '• `#constancia 35123456`',
      '',
      `🌐 También podés consultarlos en el portal web:\nhttps://${domainName}/certificados`
    ].join('\n');
  }

  const res = await buscarCertificados(driveClient, carpetaConstanciasId, consulta);
  if (res.status !== 'success' || !res.results || res.results.length === 0) {
    return [
      `⚠️ *No se encontraron constancias registradas para:* \`${consulta}\``,
      '',
      'Verificá que el número de DNI esté bien escrito (sin puntos ni espacios). Si participaste recientemente de una jornada o capacitación, recordá que la carga puede demorar unos días.',
      '',
      `🌐 *Portal de consultas:*\nhttps://${domainName}/certificados`
    ].join('\n');
  }

  const lineas = [
    `✅ *CERTIFICADOS ENCONTRADOS (${res.results.length})*`,
    `🆔 *Consulta:* ${consulta}`,
    ''
  ];

  res.results.forEach((item, idx) => {
    const titulo = String(item.name || 'Certificado').replace(/\.pdf$/i, '');
    const fechaStr = item.createdTime ? new Date(item.createdTime).toLocaleDateString('es-AR') : 'Oficial DRE';
    lineas.push(`📄 *${idx + 1}. ${titulo}*`);
    if (item.evento) lineas.push(`   🏷️ Evento: ${item.evento}`);
    lineas.push(`   📅 Registro: ${fechaStr}`);
    lineas.push(`   ⬇️ Descargar PDF: ${item.webContentLink || item.webViewLink}`);
    lineas.push('');
  });

  lineas.push(`🔗 *Enlace oficial de validación:*`);
  lineas.push(`https://${domainName}/certificados?verificar=${encodeURIComponent(consulta)}`);

  return lineas.join('\n');
}
