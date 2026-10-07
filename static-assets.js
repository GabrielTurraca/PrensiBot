// static-assets.js — ESM (el proyecto usa "type": "module" en package.json)
//
// Nota sobre compresión: como el Caddyfile ya tiene `encode zstd gzip` activo,
// este archivo NO comprime nada — solo sirve el archivo y define el Cache-Control.
// Duplicar la compresión acá sería trabajo de más sin beneficio.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2'
};

/**
 * Sirve cualquier archivo dentro de ./public. Usar como rama final dentro
 * de iniciarHttpServer, después de las rutas existentes (/ , /index.html,
 * /api/certificados, etc.) para que actúe como fallback de assets estáticos:
 *
 *   const server = http.createServer((req, res) => {
 *     if (req.url === '/' || req.url === '/index.html') {
 *       // ... lógica existente que sirve index.html ...
 *     } else if (req.url.startsWith('/api/')) {
 *       // ... rutas de API existentes ...
 *     } else {
 *       servirArchivoEstatico(req, res);
 *     }
 *   });
 */
const PAGINA_404_HTML = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>404 - Página no encontrada | DRE Regiones X-A y X-B</title>
  <link rel="stylesheet" href="/styles.css">
</head>
<body class="bg-slate-50 text-slate-900 min-h-screen flex items-center justify-center font-sans p-4">
  <div class="max-w-md w-full bg-white p-8 rounded-3xl border border-slate-200 shadow-xl text-center space-y-5">
    <div class="w-16 h-16 bg-red-100 text-red-600 rounded-2xl flex items-center justify-center mx-auto text-2xl font-black">404</div>
    <div class="space-y-2">
      <h1 class="text-xl font-bold text-slate-900">Página no encontrada</h1>
      <p class="text-xs text-slate-500">La ruta solicitada no existe o no se encuentra disponible. Podés volver al inicio o consultar las secciones principales.</p>
    </div>
    <div class="pt-2 flex flex-col gap-2">
      <a href="/supervisores" class="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition-colors">👤 Directorio de Supervisores</a>
      <a href="/instituciones" class="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-xl text-xs font-bold transition-colors">🏠 Volver al Inicio</a>
    </div>
  </div>
</body>
</html>`;

export function servirArchivoEstatico(req, res) {
  const urlPath = decodeURIComponent(req.url.split('?')[0]);
  const rutaSolicitada = urlPath === '/' ? '/index.html' : urlPath;
  const rutaAbsoluta = path.normalize(path.join(PUBLIC_DIR, rutaSolicitada));

  // Evita path traversal (ej: /../../etc/passwd)
  if (!rutaAbsoluta.startsWith(PUBLIC_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Prohibido');
  }

  fs.readFile(rutaAbsoluta, (err, data) => {
    if (err) {
      const ext = path.extname(rutaAbsoluta);
      if (!ext || ext === '.html') {
        res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(PAGINA_404_HTML);
      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('No encontrado');
      }
    }
    const ext = path.extname(rutaAbsoluta);
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.setHeader('Content-Type', contentType);
    res.setHeader(
      'Cache-Control',
      ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable'
    );
    res.writeHead(200);
    res.end(data);
  });
}
