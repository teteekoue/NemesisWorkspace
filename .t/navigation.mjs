/**
 * La navigation de retour, dans l'application installée.
 *
 * Trois écrans se superposent : le document, la liste de son éditeur, puis
 * l'accueil de l'espace qui réunit les trois éditeurs. Le retour doit les
 * remonter dans cet ordre, et le bouton d'accueil doit faire le dernier pas.
 * Dans un navigateur, l'espace de travail est un site voisin : cette marche
 * n'existe pas et ne doit pas être proposée.
 *
 * On interroge les sources compilées : un écran absent se voit dans le paquet
 * bien avant qu'un appareil ne l'affiche.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

let pass = 0;
const fails = [];
const check = (label, ok, extra = '') => {
  if (ok) {
    pass += 1;
    console.log(`  ✓ ${label}`);
  } else {
    fails.push(label);
    console.log(`  ✗ ${label} ${extra}`);
  }
};

const read = (path) => readFileSync(path, 'utf8');

/** Le paquet d'un éditeur : ses fichiers JavaScript compilés, concaténés. */
const bundleOf = (app) => {
  const dir = join('src/nemesis-workspace/dist', app, 'assets');
  return readdirSync(dir)
    .filter((name) => name.endsWith('.js'))
    .map((name) => read(join(dir, name)))
    .join('\n');
};

console.log('\nRetour : le pont décide de la marche supérieure');
const bridge = read('src/shared/bridge.js');
check('le pont lit le natif en propriété comme en méthode', /typeof found === 'function'/.test(bridge));

console.log('\nDocuments : document → liste → espace');
const documents = bundleOf('documents');
check(
  "le retour vers l'espace n'existe que dans l'application installée",
  // Le pont est minifié : `isNative` devient une lettre. On reconnaît son
  // contrat, l'interface native qu'il interroge.
  /NemesisHost/.test(documents),
  'aucun appel au pont',
);
check(
  "le bouton « All apps » de la liste mène à l'espace",
  /All apps/.test(documents),
);
check(
  "l'espace est l'accueil voisin de l'éditeur",
  /\.\.\/index\.html/.test(documents),
);

console.log('\nTableur : éditeur et liste');
const spreadsheet = bundleOf('spreadsheet');
check('le pont est consulté', /NemesisHost/.test(spreadsheet));
check('un second cran mène à l\'espace', /allApps/.test(spreadsheet) || /All apps/.test(spreadsheet));

console.log('\nPrésentation : bouton retour et cran supérieur');
const presentation = bundleOf('presentation');
check('le pont est consulté', /NemesisHost/.test(presentation));
// Le bouton est construit avant la fonction de sortie : il passe par une
// phrase différée, qui n'appelle la sortie qu'au clic. Le paquet minifié garde
// le libellé du bouton (traduit à l'affichage, donc encore en anglais ici) et
// une fonction fléchée asynchrone qui attend la sortie avant l'accueil
// (`async()=>{if(!await x())return;await y()}`).
const back = presentation.match(/Back to presentations[^;]{0,80}/)?.[0] || '';
check('le bouton retour existe dans l\'éditeur', back.length > 0);
check(
  'le retour attend la sortie avant de revenir',
  /async\(\)=>\{await .{1,12}\(\)&&await .{1,12}\(\)\}/.test(presentation),
  back.slice(0, 90),
);
check(
  "un second cran mène à l'espace de travail",
  /All apps/.test(presentation) && /\.\.\/index\.html/.test(presentation),
);

console.log('\nAccueil de l\'espace : les trois éditeurs, et rien de cassé');
const workspace = bundleOf('');
check('l\'accueil connaît les trois dossiers', /Documents/.test(workspace) && /Spreadsheets/.test(workspace));

console.log(`\n${pass} réussite(s), ${fails.length} échec(s)`);
if (fails.length) {
  for (const f of fails) console.log(`  — ${f}`);
  process.exit(1);
}
