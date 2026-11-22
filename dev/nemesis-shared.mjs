/**
 * Vite plugin: resolves the public `/shared/…` address to `src/shared/…`.
 *
 * Every app's HTML loads the local SDK before its own entry:
 *
 *   <script type="module" src="/shared/local-sdk.js"></script>
 *
 * Inside an editor's Vite root that address has no file behind it, so the
 * build would fail to resolve it. This plugin points the address at the
 * repository's shared layer, in dev and in build alike; the resulting module
 * graph is bundled with the app, so a built app never needs a `/shared`
 * directory at runtime.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SHARED_DIR = fileURLToPath(new URL('../src/shared/', import.meta.url));

export default function nemesisShared() {
  return {
    name: 'nemesis-shared',
    enforce: 'pre',
    resolveId(source) {
      if (!source.startsWith('/shared/')) return null;
      const file = resolve(SHARED_DIR, source.slice('/shared/'.length));
      if (!file.startsWith(SHARED_DIR)) return null;
      return existsSync(file) ? file : null;
    },
  };
}
