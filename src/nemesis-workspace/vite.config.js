import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import nemesisShared from '../../dev/nemesis-shared.mjs';

/**
 * NemesisWorkspace — configuration de l'accueil.
 *
 * L'accueil vit à côté des trois éditeurs, qui ont chacun leur propre
 * `vite.config.js` et leurs dépendances. Il ne charge que la couche partagée
 * (`src/shared/`), publiée sous l'adresse `/shared/` : c'est la même adresse
 * que celle qu'utilisent les HTML des éditeurs, afin que l'ensemble construit
 * (`dist/shared`, `dist/documents`, `dist/spreadsheet`, `dist/presentation`)
 * se serve depuis un seul dossier, comme le fera l'application Android.
 *
 * Pour un aperçu complet, voir `dev/preview.mjs` : il sert les quatre projets
 * construits sous une seule origine, ce qui donne exactement la navigation de
 * l'application finale.
 */

const projectRoot = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [nemesisShared()],
  base: './',
  build: {
    // Le paquet embarqué dans l'application tourne aussi sur des moteurs
    // anciens (Chromium de Chromebook, WebView d'Android 8) : la cible reste
    // donc modeste pour qu'aucune syntaxe récente ne casse la page.
    target: 'es2017',
    cssTarget: 'safari15',
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    host: '0.0.0.0',
    port: 4200,
    strictPort: true,
    fs: { allow: [projectRoot] },
  },
  preview: {
    host: '0.0.0.0',
    port: 4200,
    strictPort: true,
  },
});
