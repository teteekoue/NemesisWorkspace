/**
 * La disposition de l'assistant, vérifiée sur le CSS construit.
 *
 * Le défaut trouvé : documents/canvas-chrome.css empilait la rangée entière
 * en colonne dès 700 px (donc le panneau passait sous la page), alors que le
 * tableur et la présentation gardent leur colonne jusqu'à 640 px. Une seule
 * largeur de bascule vaut pour les trois éditeurs.
 *
 * Ce test lit les CSS livrés et refuse toute requête d'empilement au-dessus
 * de 640 px, et tout panneau qui ne serait pas une colonne à droite.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = '/home/user/NemesisWorkspace/src';
let pass = 0;
const fails = [];
const check = (label, ok, extra = '') => {
  if (ok) { pass += 1; console.log(`  ✓ ${label}`); }
  else { fails.push(label); console.log(`  ✗ ${label} ${extra}`); }
};

const cssOf = (app) => {
  const dir = join(root, app, 'dist', 'assets');
  let out = '';
  for (const file of readdirSync(dir)) {
    if (file.endsWith('.css')) out += readFileSync(join(dir, file), 'utf8');
  }
  return out;
};

console.log('\nDisposition de l’assistant — les CSS livrés');

// 1. Le panneau ne s'empile qu'au seuil des téléphones (640 px), pas avant.
//    On regarde les règles qui, dans une requête de largeur, touchent le
//    panneau lui-même : c'est là que se joue la disposition.
const stacking = (css) => {
  const out = [];
  // On découpe chaque en-tête de requête, puis on lit jusqu'à l'accolade
  // fermante de la requête (le CSS livré est minifié, sans indentation).
  const heads = [...css.matchAll(/@media([^{]*)\{/g)];
  for (const head of heads) {
    // « (max-width: 640px) » en clair, « (width<=640px) » une fois minifié.
    const width = /(?:max-width|width\s*<=)\s*:?\s*\(?\s*(\d+)px/.exec(head[1]);
    if (!width) continue;
    // Le corps de la requête : d'un en-tête au suivant.
    const body = css.slice(head.index + head[0].length, head.index + 4000);
    // Un empilement : le panneau passe en feuille fixe ou prend toute la
    // largeur. Une simple réduction de largeur n'en est pas un.
    // Le sélecteur peut en citer d'autres (.as-pane,.vh-pane{…}).
    const rule = /\.(?:ai|as)-(?:panel|pane)[^{]*\{[^}]*\}/.exec(body.slice(0, 4000));
    if (rule && /(?:position:fixed|width:100%|width:auto|flex-basis:auto)/.test(rule[0])) out.push(Number(width[1]));
  }
  return out;
};
for (const app of ['documents', 'spreadsheet', 'presentation']) {
  const css = cssOf(app);
  const widths = stacking(css);
  const tooEarly = widths.filter((w) => w > 640);
  check(`${app} : le panneau ne s'empile pas au-dessus de 640 px`, tooEarly.length === 0, `trouvé ${[...new Set(tooEarly)].join(', ')}`);
  check(`${app} : il s'empile bien à 640 px`, widths.some((w) => w === 640), widths.length ? `seulement ${[...new Set(widths)].join(', ')}` : 'aucune règle de panneau dans une requête');
}

// 2. Chaque panneau est une colonne à droite, pas un bloc pleine largeur.
const documents = cssOf('documents');
check('documents : le panneau a une largeur de colonne', /\.as-pane\{[^}]*width:380px/.test(documents.replace(/\s+/g, '')) || /\.as-pane\{[^}]*width: *380px/.test(documents), 'largeur absente');
check('documents : le fil et le composeur sont séparés', /\.as-conversation/.test(documents) && /\.as-box\{/.test(documents.replace(/\s+/g, '')), 'structure du panneau absente');

const spreadsheet = cssOf('spreadsheet');
check('tableur : le panneau est une colonne à droite', /\.ai-panel\{[^}]*border-left/.test(spreadsheet.replace(/\s+/g, '')), 'pas de bordure de colonne');

const presentation = cssOf('presentation');
check('présentation : le panneau est une colonne à droite', /\.ai-panel\{[^}]*width:var\(--ai-w\)/.test(presentation.replace(/\s+/g, '')), 'largeur absente');

// 3. Les trois panneaux partagent la même mesure.
const widths = {
  documents: (documents.match(/\.as-pane\{[^}]*?width: *(\d+)px/) || [])[1],
  spreadsheet: (spreadsheet.match(/\.ai-panel\{[^}]*?--ai-w: *(\d+)px/) || [])[1],
  presentation: (presentation.match(/\.ai-panel\{[^}]*?--ai-w: *(\d+)px/) || [])[1],
};
check('les trois panneaux ont une largeur proche', Math.max(...Object.values(widths).map(Number)) - Math.min(...Object.values(widths).map(Number)) <= 30, JSON.stringify(widths));

console.log(`\n${pass} réussite(s), ${fails.length} échec(s)`);
if (fails.length) { console.log('Échecs :', fails.join(', ')); process.exit(1); }
