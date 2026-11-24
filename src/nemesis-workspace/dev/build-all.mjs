#!/usr/bin/env node
/**
 * Construire la suite entière dans un seul dossier.
 *
 * Le résultat est celui que l'application Android empaquette :
 *
 *   dist/index.html          l'accueil (NemesisWorkspace)
 *   dist/documents/          le traitement de texte
 *   dist/spreadsheet/        le tableur
 *   dist/presentation/       les diapositives
 *   dist/shared/             la couche partagée (SDK local, IA, config)
 *   dist/brand/              le logo et les icônes
 *
 * Chaque éditeur est construit par son propre projet (ses dépendances, sa
 * configuration Vite) puis copié ici. L'accueil est construit le dernier : son
 * dossier `dist` est la racine de l'ensemble.
 */

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const srcRoot = resolve(here, '..', '..');
const workspaceRoot = resolve(here, '..');
const out = join(workspaceRoot, 'dist');

const APPS = [
  { dir: 'documents', label: 'Documents' },
  { dir: 'spreadsheet', label: 'Tableur' },
  { dir: 'presentation', label: 'Présentation' },
];

const run = (command, args, cwd) => {
  console.log(`\n▸ ${command} ${args.join(' ')}  (${cwd})`);
  execFileSync(command, args, { cwd, stdio: 'inherit', env: { ...process.env, NODE_ENV: 'production' } });
};

const hasModules = (dir) => existsSync(join(dir, 'node_modules'));

// 1. Les trois éditeurs.
for (const app of APPS) {
  const cwd = join(srcRoot, app.dir);
  if (!existsSync(cwd)) {
    console.warn(`[build] ${app.label} absent — ignoré`);
    continue;
  }
  if (!hasModules(cwd)) {
    console.log(`[build] installation des dépendances de ${app.label}…`);
    run('npm', ['ci', '--no-audit', '--no-fund'], cwd);
  }
  run('npm', ['run', 'build'], cwd);
}

// 2. L'accueil, qui devient la racine.
console.log('\n▸ accueil NemesisWorkspace');
if (!hasModules(workspaceRoot)) run('npm', ['install', '--no-audit', '--no-fund'], workspaceRoot);
run('npm', ['run', 'build'], workspaceRoot);

// 3. Rassembler.
for (const app of APPS) {
  const built = join(srcRoot, app.dir, 'dist');
  if (!existsSync(built)) {
    console.warn(`[build] ${app.label} n'a pas produit de dist — ignoré`);
    continue;
  }
  const target = join(out, app.dir);
  rmSync(target, { recursive: true, force: true });
  cpSync(built, target, { recursive: true });
  console.log(`[build] ${app.label} → dist/${app.dir}/`);
}

// La couche partagée n'est pas un bundle : les éditeurs l'importent telle
// quelle, et les modules ES du navigateur suffisent (aucune syntaxe exotique).
const sharedTarget = join(out, 'shared');
rmSync(sharedTarget, { recursive: true, force: true });
cpSync(join(srcRoot, 'shared'), sharedTarget, { recursive: true });
console.log('[build] couche partagée → dist/shared/');

// Une page d'attente quand un éditeur n'a pas pu être construit.
for (const app of APPS) {
  const indexPath = join(out, app.dir, 'index.html');
  if (existsSync(indexPath)) continue;
  mkdirSync(join(out, app.dir), { recursive: true });
  writeFileSync(
    indexPath,
    `<!doctype html><meta charset="utf-8"><title>${app.label} — indisponible</title>` +
      `<style>body{font-family:system-ui;padding:40px;line-height:1.6;max-width:52ch}</style>` +
      `<h1>${app.label}</h1><p>Cet éditeur n’a pas encore été construit. Lancez <code>node dev/build-all.mjs</code>.</p>` +
      `<p><a href="../">Retour à l’accueil</a></p>`,
  );
}

console.log(`\n[build] terminé : ${out}\n[build] aperçu : node dev/preview.mjs`);
