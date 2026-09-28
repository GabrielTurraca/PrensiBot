// supervisores-optimizado.js (ESM)
// Consulta la planilla de supervisores de Google Sheets (usando GViz CSV con fallback a Google Sheets API v4),
// estructura los datos por Región > Nivel y mantiene una caché en memoria de 10 minutos.

import { google } from "googleapis";

const SUPERVISORES_SHEET_ID = process.env.SUPERVISORES_SHEET_ID || '1X369rO-LEQSRZ202wrq4xOw9Z5e2xiiV-T0pBSX-pss';
const SHEET_GID = process.env.SUPERVISORES_SHEET_GID || '1559143719';
const SHEET_TABS = (process.env.SUPERVISORES_SHEET_TABS || '')
  .split(',').map((s) => s.trim()).filter(Boolean);

const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutos
const FETCH_TIMEOUT_MS = 10 * 1000;  // 10 segundos timeout

// ---------- Utilidades de texto ----------
const sinAcentos = (s = '') => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const norm = (s = '') => sinAcentos(String(s)).toLowerCase().trim();

// ---------- Parser CSV (soporta comillas y saltos de línea) ----------
function parseCSV(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else cell += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      rows.push(row); row = [];
    } else cell += c;
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((v) => v.trim() !== ''));
}

// ---------- Mapeo flexible de columnas ----------
const ALIASES = {
  region: ['region', 'regional', 'reg', 'region educativa', 'regional educativa'],
  nivel: ['nivel', 'nivel educativo', 'modalidad', 'nivel/modalidad', 'nivel / modalidad', 'nivel o modalidad'],
  nombre: ['nombre', 'apellido y nombre', 'apellido y nombres', 'supervisor', 'supervisor/a', 'nombre y apellido', 'supervisores'],
  cargo: ['cargo', 'funcion', 'rol', 'cargo/funcion'],
  circuito: ['circuito', 'zona', 'supervision', 'sector', 'circuito/zona'],
  sede: ['sede', 'localidad', 'ciudad', 'domicilio', 'sede/localidad'],
  email: ['email', 'e-mail', 'correo', 'mail', 'correo electronico', 'correo electrónico', 'email institucional'],
  telefono: ['telefono', 'tel', 'celular', 'whatsapp', 'contacto', 'nro de contacto', 'telefono de contacto', 'telefono celular', 'teléfono celular'],
};

function mapearColumnas(headerRow) {
  const idx = {};
  headerRow.forEach((h, i) => {
    const rawKey = norm(h);
    const keyClean = rawKey.replace(/\s*\/\s*/g, '/');
    for (const [campo, lista] of Object.entries(ALIASES)) {
      if (idx[campo] === undefined) {
        const match = lista.some(alias => {
          const aClean = norm(alias).replace(/\s*\/\s*/g, '/');
          return keyClean === aClean || keyClean.includes(aClean) || aClean.includes(keyClean);
        });
        if (match) idx[campo] = i;
      }
    }
  });
  return idx;
}

// ---------- Normalización de Región y Nivel ----------
export function normalizarRegion(valor = '') {
  const v = norm(valor).replace(/[\s_]/g, '');
  if (/x-?a/.test(v)) return 'Región X-A';
  if (/x-?b/.test(v)) return 'Región X-B';
  return null;
}

const NIVELES = [
  [/inicial/, 'Nivel Inicial'],
  [/primari/, 'Nivel Primario'],
  [/secundari/, 'Nivel Secundario'],
  [/especial/, 'Educación Especial'],
  [/fisica/, 'Educación Física'],
  [/tecnic|tecnolog|formacion profesional|ept/, 'Educación Técnica'],
  [/superior/, 'Nivel Superior'],
  [/adulto|jovenes y adultos|eja/, 'Jóvenes y Adultos'],
  [/artistic|arte/, 'Educación Artística'],
];

export function normalizarNivel(valor = '') {
  const v = norm(valor);
  if (!v) return 'Otros';
  for (const [re, nombre] of NIVELES) if (re.test(v)) return nombre;
  return valor.trim();
}

const limpiarTel = (t = '') => String(t).replace(/[^\d+]/g, '');

// ---------- Descarga (Google Sheets API OAuth2 con Fallback a GViz) ----------
async function descargarCSV(tab, sheetsClient) {
  // Usar Google Sheets API v4 OAuth2 primero si está disponible (rápido, <300ms)
  if (sheetsClient) {
    try {
      const range = tab ? `'${tab}'!A1:Z1000` : 'A1:Z1000';
      const response = await sheetsClient.spreadsheets.values.get({
        spreadsheetId: SUPERVISORES_SHEET_ID,
        range,
      });
      if (response.data && response.data.values && response.data.values.length > 0) {
        return response.data.values;
      }
    } catch (apiErr) {
      console.warn('[supervisores] Error con Google Sheets API, intentando fallback GViz:', apiErr.message);
    }
  }

  // Fallback con GViz public CSV export (timeout 5s)
  try {
    const url = new URL(`https://docs.google.com/spreadsheets/d/${SUPERVISORES_SHEET_ID}/gviz/tq`);
    url.searchParams.set('tqx', 'out:csv');
    if (SHEET_GID) url.searchParams.set('gid', SHEET_GID);
    if (tab) url.searchParams.set('sheet', tab);

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (res.ok) {
        const csvText = await res.text();
        if (csvText && csvText.trim().length > 10) {
          return parseCSV(csvText);
        }
      }
    } finally {
      clearTimeout(timer);
    }
  } catch (e) {
    console.warn('[supervisores] GViz public CSV export falló:', e.message);
  }

  throw new Error('No se pudo obtener la planilla de supervisores mediante Google Sheets API ni GViz.');
}

function estructurar(rows, regionPorDefecto = null) {
  if (!rows || rows.length < 2) return [];
  const idx = mapearColumnas(rows[0]);
  
  // Si no se encuentra la columna por alias, usar heurística o primera columna con datos
  let nombreIdx = idx.nombre;
  if (nombreIdx === undefined) {
    // Buscar la columna con encabezado "supervisor" o mayor coincidencia
    rows[0].forEach((h, i) => {
      const n = norm(h);
      if (n.includes('nombre') || n.includes('supervisor') || n.includes('apellido')) {
        nombreIdx = i;
      }
    });
  }
  if (nombreIdx === undefined) nombreIdx = 0; // Fallback a columna A

  const get = (r, campo) => {
    const colIndex = idx[campo];
    return (colIndex !== undefined && r[colIndex]) ? String(r[colIndex]).trim() : '';
  };

  const out = [];
  for (const r of rows.slice(1)) {
    const nombre = r[nombreIdx] ? String(r[nombreIdx]).trim() : '';
    if (!nombre || norm(nombre) === 'nombre' || norm(nombre) === 'supervisor') continue;
    
    const region = normalizarRegion(get(r, 'region')) || regionPorDefecto || 'Región X-A';
    out.push({
      region,
      nivel: normalizarNivel(get(r, 'nivel')),
      nombre,
      cargo: get(r, 'cargo') || 'Supervisor/a',
      circuito: get(r, 'circuito'),
      sede: get(r, 'sede'),
      email: get(r, 'email').toLowerCase(),
      telefono: limpiarTel(get(r, 'telefono')),
    });
  }
  return out;
}

function agrupar(lista) {
  const data = {};
  for (const s of lista) {
    const { region, nivel, ...resto } = s;
    ((data[region] ||= {})[nivel] ||= []).push(resto);
  }
  
  // Orden estable: Regiones X-A, X-B primero; supervisores por nombre.
  const ordenado = {};
  for (const reg of Object.keys(data).sort()) {
    ordenado[reg] = {};
    for (const niv of Object.keys(data[reg]).sort((a, b) => a.localeCompare(b, 'es'))) {
      ordenado[reg][niv] = data[reg][niv].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
    }
  }
  return ordenado;
}

// ---------- Caché en memoria (10 min) ----------
let cache = { payload: null, expira: 0 };
let enVuelo = null;

async function cargar(sheetsClient = null) {
  const tabs = SHEET_TABS.length ? SHEET_TABS : [null];
  const partes = await Promise.all(
    tabs.map(async (tab) => {
      const rows = await descargarCSV(tab, sheetsClient);
      return estructurar(rows, tab ? normalizarRegion(tab) : null);
    })
  );
  const planos = partes.flat();
  return {
    status: 'success',
    updatedAt: new Date().toISOString(),
    total: planos.length,
    data: agrupar(planos),
  };
}

export async function obtenerSupervisores(sheetsClient = null, { forzar = false } = {}) {
  const ahora = Date.now();
  if (!forzar && cache.payload && ahora < cache.expira) return cache.payload;
  if (enVuelo) return enVuelo;

  enVuelo = cargar(sheetsClient)
    .then((payload) => {
      cache = { payload, expira: Date.now() + CACHE_TTL_MS };
      return payload;
    })
    .catch((err) => {
      console.error('[supervisores] Error al actualizar catálogo:', err.message);
      if (cache.payload) return { ...cache.payload, stale: true };
      throw err;
    })
    .finally(() => { enVuelo = null; });
  return enVuelo;
}

export function precalentarSupervisores(sheetsClient = null) {
  obtenerSupervisores(sheetsClient).catch(() => {});
}

// ---------- Filtros (API y bot) ----------
export function filtrarSupervisores(payload, { region, nivel, q } = {}) {
  if (!payload || !payload.data) return payload;
  const reg = region ? normalizarRegion(region) : null;
  const niv = nivel ? norm(nivel) : null;
  const texto = q ? norm(q) : null;
  const data = {};
  
  for (const [r, niveles] of Object.entries(payload.data)) {
    if (reg && r !== reg) continue;
    for (const [n, lista] of Object.entries(niveles)) {
      if (niv && !norm(n).includes(niv)) continue;
      const filtrados = texto
        ? lista.filter((s) => norm([s.nombre, s.cargo, s.circuito, s.sede].join(' ')).includes(texto))
        : lista;
      if (filtrados.length) ((data[r] ||= {})[n] ||= []).push(...filtrados);
    }
  }
  return { ...payload, data };
}

// ---------- Formato WhatsApp ----------
const MAX_WA = 3500;

const NIVEL_CLAVES = ['inicial', 'primari', 'secundari', 'especial', 'fisica', 'tecnic', 'superior', 'adult', 'artistic'];
const PALABRAS_RELLENO = new Set(['educacion', 'nivel', 'region', 'regional', 'de', 'del']);

function detectarNivel(token) {
  const t = norm(token);
  if (t.length < 3) return null;
  return NIVEL_CLAVES.find((k) => k.startsWith(t) || t.startsWith(k)) || null;
}

export function parsearArgumentosBot(texto = '') {
  const limpio = texto
    .replace(/^#\S+\s*/, '')
    .replace(/\bx\s+([ab])\b/gi, 'x-$1') // "x b" -> "x-b"
    .trim();
  const partes = limpio.split(/\s+/).filter(Boolean);
  const args = { region: null, nivel: null, q: null };
  const resto = [];
  for (const p of partes) {
    if (PALABRAS_RELLENO.has(norm(p))) continue;
    if (!args.region && normalizarRegion(p)) args.region = p;
    else if (!args.nivel && detectarNivel(p)) args.nivel = detectarNivel(p);
    else resto.push(p);
  }
  args.q = resto.join(' ') || null;
  return args;
}

export async function responderSupervisoresWhatsApp(textoMensaje = '', sheetsClient = null) {
  const args = parsearArgumentosBot(textoMensaje);
  const base = await obtenerSupervisores(sheetsClient);
  const hayFiltro = args.region || args.nivel || args.q;

  if (!hayFiltro) {
    const lineas = ['👤 *DIRECTORIO DE SUPERVISORES DRE X-A / X-B*', ''];
    for (const [reg, niveles] of Object.entries(base.data)) {
      lineas.push(`📍 *${reg}*`);
      for (const [niv, lista] of Object.entries(niveles)) lineas.push(`   • ${niv}: ${lista.length} supervisor(es)`);
      lineas.push('');
    }
    lineas.push('💡 *Consultá por filtro enviando:*');
    lineas.push('• `#supervisores X-A`');
    lineas.push('• `#supervisores Secundario`');
    lineas.push('• `#supervisores X-B Primario`');
    lineas.push('• `#supervisores <nombre o localidad>`');
    return lineas.join('\n');
  }

  const res = filtrarSupervisores(base, args);
  const lineas = [];
  let total = 0;
  for (const [reg, niveles] of Object.entries(res.data)) {
    lineas.push(`📍 *${reg}*`);
    for (const [niv, lista] of Object.entries(niveles)) {
      lineas.push(`\n🏫 *${niv}*`);
      for (const s of lista) {
        total++;
        const extra = [s.cargo, s.circuito, s.sede].filter(Boolean).join(' · ');
        lineas.push(`• *${s.nombre}*${extra ? `\n   └ ${extra}` : ''}`);
        if (s.telefono) lineas.push(`   📞 ${s.telefono}`);
        if (s.email) lineas.push(`   ✉️ ${s.email}`);
      }
    }
    lineas.push('');
  }
  if (!total) return '⚠️ No encontré supervisores con ese criterio. Probá enviando `#supervisores` para ver las opciones disponibles.';

  let msg = lineas.join('\n').trim();
  if (msg.length > MAX_WA) {
    msg = msg.slice(0, MAX_WA).replace(/\n[^\n]*$/, '') +
      '\n\n… Hay más resultados. Especificá mejor la búsqueda (ej: `#supervisores X-A Primario`) o consultá en el portal web.';
  }
  return msg;
}
