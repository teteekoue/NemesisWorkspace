/**
 * L'interface s'affiche en français.
 *
 * Le contrôle porte sur le rendu réel : un élément construit par le `el()` de
 * chaque application doit afficher le texte français, son `title` et son
 * `aria-label` compris. C'est ce que la personne voit, pas l'intention.
 */
import { JSDOM } from '../src/documents/node_modules/jsdom/lib/api.js';

const dom = new JSDOM('<!doctype html><html lang="fr"><body></body></html>');
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.Node = dom.window.Node;
globalThis.MutationObserver = dom.window.MutationObserver;

const { el } = await import('../src/documents/src/ui/dom.js');
const { french, frenchPage, frenchTermCount } = await import('../src/shared/fr.js');

let ok = 0;
const echecs = [];
const check = (condition, message) => {
  if (condition) { ok += 1; console.log(`  ✓ ${message}`); }
  else { echecs.push(message); console.log(`  ✗ ${message}`); }
};

console.log('\nLe vocabulaire de la suite bureautique');
const attendus = [
  ['Save', 'Enregistrer'], ['Save As', 'Enregistrer sous'], ['Open', 'Ouvrir'],
  ['Home', 'Accueil'], ['Insert', 'Insertion'], ['Page Layout', 'Mise en page'],
  ['Review', 'Révision'], ['View', 'Affichage'], ['Cancel', 'Annuler'],
  ['Clipboard', 'Presse-papiers'], ['Font', 'Police'], ['Paragraph', 'Paragraphe'],
  ['Bring to Front', 'Mettre au premier plan'], ['Send to Back', 'Mettre en arrière-plan'],
  ['Table of Contents', 'Table des matières'], ['Track Changes', 'Suivi des modifications'],
  ['Dictate', 'Dicter'], ['Heading 1', 'Titre 1'], ['Print', 'Imprimer'],
];
for (const [anglais, attendu] of attendus) {
  check(french(anglais) === attendu, `${anglais} → ${attendu}`);
}
check(frenchTermCount >= 400, `${frenchTermCount} expressions au dictionnaire`);

console.log('\nLe texte d’un élément, son titre et son libellé');
{
  const button = el('button', { title: 'Save (Ctrl+S)', 'aria-label': 'Save' }, 'Save');
  check(button.textContent === 'Enregistrer', 'le texte affiché est traduit');
  check(button.getAttribute('title') === 'Enregistrer (Ctrl+S)', 'le titre au survol est traduit');
  check(button.getAttribute('aria-label') === 'Enregistrer', 'le libellé lu par le lecteur d’écran est traduit');
}

console.log('\nCe qui ne doit pas être touché');
{
  check(french('Bonjour tout le monde') === 'Bonjour tout le monde', 'un texte déjà français reste intact');
  check(french('1 234,56') === '1 234,56', 'un nombre reste un nombre');
  check(french('') === '', 'un texte vide reste vide');
  const champ = el('input', { type: 'text' });
  check(champ.textContent === '', 'un champ vide ne reçoit aucun texte');
  // Le contenu d'un document n'est jamais traduit : ses noms de styles, ses
  // formules et ses mots restent exactement ce que le fichier contient.
  check(french('=SOMME(A1:A4)') === '=SOMME(A1:A4)', 'une formule de classeur reste intacte');
  check(french('Calibri') === 'Calibri', 'un nom de police reste intact');
}

console.log('\nCe que l’interface ajoute après le premier affichage');
{
  // Un menu s'ouvre plus tard : ses entrées arrivent après le rendu initial.
  const stop = frenchPage(document);
  const menu = document.createElement('div');
  menu.innerHTML = '<button title="Save">Save</button>';
  document.body.append(menu);
  await new Promise((resolve) => setTimeout(resolve, 20));
  const entry = menu.querySelector('button');
  check(entry.textContent === 'Enregistrer', 'une entrée de menu ouverte plus tard est traduite');
  stop();
}

console.log(`\n${ok} réussite(s), ${echecs.length} échec(s)`);
process.exit(echecs.length ? 1 : 0);
