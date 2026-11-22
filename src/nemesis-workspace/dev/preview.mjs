#!/usr/bin/env node
/**
 * Aperçu unifié de NemesisWorkspace.
 *
 * L'application Android servira un seul dossier : l'accueil à la racine, les
 * trois éditeurs dans des sous-dossiers, et la couche partagée sous /shared.
 * Ce serveur reproduit exactement cela en développement, à partir des quatre
 * projets *construits* :
 *
 *   dist-documents      →  /documents/
 *   dist-spreadsheet    →  /spreadsheet/
 *   dist-presentation   →  /presentation/
 *   dist (accueil)      →  /
 *   src/shared          →  /shared/   (source, non construite)
 *
 * Rien n'est réécrit : les bundles des éditeurs ont `base: './'` et leurs
 * adresses relatives fonctionnent quel que soit le sous-dossier.
 */

import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const root = resolve(here, '..', '..'); // src/
const workspaceDist = join(here, '..', 'dist');
const PORT = Number(process.env.PORT || 4200);

const MOUNTS = [
  { prefix: '/documents/', dir: join(root, 'documents', 'dist') },
  { prefix: '/spreadsheet/', dir: join(root, 'spreadsheet', 'dist') },
  { prefix: '/presentation/', dir: join(root, 'presentation', 'dist') },
  { prefix: '/shared/', dir: join(root, 'shared') },
  { prefix: '/', dir: workspaceDist },
];

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.wasm': 'application/wasm',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

const missing = (dir) => !existsSync(dir);

/**
 * Une dépendance partagée, une fois compilée, vit sous /shared/ avec son
 * extension d'origine : « config.js » peut importer « ./ai.js », et le
 * navigateur demande alors /shared/ai.js — que ce serveur ne connaît pas
 * puisqu'il vient du bundle de l'éditeur, non d'un fichier. On le sert donc
 * depuis la source : chaque module de src/shared est autonome.
 */
const sharedSource = (urlPath) =>
  join(root, 'shared', urlPath.slice('/shared/'.length));

function resolveFile(urlPath) {
  const mount = MOUNTS.find((candidate) => urlPath.startsWith(candidate.prefix));
  if (!mount) return null;
  const relative = decodeURIComponent(urlPath.slice(mount.prefix.length));
  let file = normalize(join(mount.dir, relative));
  if (!file.startsWith(mount.dir)) return null; // tentative de remontée
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  if (!existsSync(file)) {
    // Une adresse sans extension est une route de l'application : son HTML.
    const html = join(mount.dir, 'index.html');
    if (!extname(relative) && existsSync(html)) return html;
    return null;
  }
  return file;
}

const server = createServer((req, res) => {
  const url = new URL(req.url || '/', 'http://local');
  const file = resolveFile(url.pathname);
  if (!file && url.pathname.startsWith('/shared/')) {
    const fallback = sharedSource(url.pathname);
    if (existsSync(fallback) && !statSync(fallback).isDirectory()) {
      res.writeHead(200, { 'Content-Type': TYPES[extname(fallback)] || 'text/javascript; charset=utf-8', 'Cache-Control': 'no-cache' });
      createReadStream(fallback).pipe(res);
      return;
    }
  }
  if (!file) {
    if (url.pathname === '/favicon.ico') {
      res.writeHead(204).end();
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`Introuvable : ${url.pathname}\n\nLancez « node dev/build-all.mjs » pour construire les quatre projets.`);
    return;
  }
  const type = TYPES[extname(file).toLowerCase()] || 'application/octet-stream';
  res.writeHead(200, {
    'Content-Type': type,
    'Cache-Control': 'no-cache',
    // L'aperçu est servi dans une iframe : rien ici ne doit l'interdire.
    'X-Content-Type-Options': 'nosniff',
  });
  createReadStream(file).pipe(res);
});

const ready = MOUNTS.slice(0, 4).filter((mount) => missing(mount.dir));
if (ready.length) {
  console.warn(
    `[aperçu] dossiers construits manquants :\n${ready.map((mount) => `  - ${mount.dir}`).join('\n')}\n` +
      'Lancez « node dev/build-all.mjs » (ou le script npm « build:all ») avant l’aperçu.',
  );
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[aperçu] NemesisWorkspace sur http://0.0.0.0:${PORT}`);
  console.log(`[aperçu] accueil : /  · documents : /documents/  · tableur : /spreadsheet/  · présentation : /presentation/`);
});
