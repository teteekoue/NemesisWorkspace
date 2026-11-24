/**
 * NemesisWorkspace — la compatibilité des moteurs anciens, en tête de page.
 *
 * `src/shared/compat.js` doit s'exécuter **avant** le moindre module : sur une
 * vue système ancienne, le premier bloc qui appelle `Object.fromEntries` fait
 * sinon échouer toute la page. Un module ne suffit pas, car son exécution est
 * différée derrière les autres modules de la page ; ce greffon insère donc le
 * raccord en script classique, juste après `<head>`, où il passe en premier.
 *
 * Les quatre applications embarquées l'utilisent ; le contenu reste dans un
 * seul fichier, lisible et vérifiable.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const COMPAT_FILE = fileURLToPath(new URL('../src/shared/compat.js', import.meta.url));

export default function compatHead() {
  return {
    name: 'nemesis-compat-head',
    enforce: 'post',
    transformIndexHtml(html) {
      if (html.includes('data-nemesis-compat')) return html;
      // Le fichier est du JavaScript simple, sans balise : il s'insère tel quel.
      const source = readFileSync(COMPAT_FILE, 'utf8').replace(/<\/script/gi, '<\\/script');
      const tag = `<script data-nemesis-compat>\n${source}\n</script>`;
      return html.replace(/<head([^>]*)>/i, (whole) => `${whole}\n  ${tag}`);
    },
  };
}
