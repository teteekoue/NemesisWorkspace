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

// 4. Les mesures du panneau : une en-tête compacte et un champ de deux lignes.
//    L'en-tête prenait 44 px (documents) et 49 px (présentation) ; il prend
//    la hauteur de la barre de menus (34 px) partout.
const headHeight = (css) => {
  // « height:34px » ou la variable de la barre de menus, qui vaut 34 px.
  const rule = /\.(?:ai-head|as-pane \.canvas-panel-heading)\s*\{[^}]*\}/.exec(css);
  if (!rule) return null;
  const px = /height:\s*(\d+)px/.exec(rule[0]);
  if (px) return Number(px[1]);
  return /height:\s*var\(--(?:editor-)?menubar-h/.test(rule[0]) ? 34 : null;
};
const inputBox = (css) => {
  const rule = /\.(?:ai-input|as-input)\s*\{[^}]*\}/.exec(css);
  const min = rule && /min-height:\s*(?:calc\(([\d.]+)em[^)]*\)|(\d+)px)/.exec(rule[0]);
  const minPx = min ? (min[2] ? Number(min[2]) : Math.round(Number(min[1]) * 14)) : null;
  const max = rule && /max-height:\s*(\d+)px/.exec(rule[0]);
  return { min: minPx, max: max ? Number(max[1]) : null };
};
for (const [app, css] of [['documents', documents], ['spreadsheet', spreadsheet], ['presentation', cssOf('presentation')]]) {
  const h = headHeight(css);
  check(`${app} : en-tête de 34 px`, h === 34, `mesuré ${h}`);
  const box = inputBox(css);
  check(`${app} : champ de deux lignes (min ≤ 44 px)`, box.min != null && box.min <= 44, JSON.stringify(box));
  check(`${app} : champ plafonné à 128 px`, box.max === 128, JSON.stringify(box));
}

// 5. Rien sous la barre de saisie : ni mention légale, ni compte de mots.
//    Creuser le bas du panneau gênait l'organisation, dans les trois éditeurs.
const clean = {
  documents: !/\.as-disclaimer/.test(documents),
  spreadsheet: !/\.ai-disclaimer/.test(spreadsheet),
  presentation: !/\.ai-privacy/.test(cssOf('presentation')),
};
for (const [app, ok] of Object.entries(clean)) {
  check(`${app} : aucune mention sous la barre de saisie`, ok, 'une règle de mention subsiste');
}

console.log(`\n${pass} réussite(s), ${fails.length} échec(s)`);
if (fails.length) { console.log('Échecs :', fails.join(', ')); process.exit(1); }
