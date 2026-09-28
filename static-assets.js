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
export function servirArchivoEstatico(req, res) {
  const urlPath = decodeURIComponent(req.url.split('?')[0]);
  const rutaSolicitada = urlPath === '/' ? '/index.html' : urlPath;
  const rutaAbsoluta = path.normalize(path.join(PUBLIC_DIR, rutaSolicitada));

  // Evita path traversal (ej: /../../etc/passwd)
  if (!rutaAbsoluta.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end('Prohibido');
  }

  fs.readFile(rutaAbsoluta, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('No encontrado');
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
