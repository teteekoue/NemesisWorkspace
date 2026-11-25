/**
 * add_slide / move_slide : la position annoncée est-elle la position réelle ?
 *
 * Le modèle dit « la diapositive va en position N » et l'outil répond
 * « Added slide N ». Si le deck ne range pas la diapositive à cet endroit, le
 * contenu se retrouve décalé — exactement ce que l'utilisateur voit.
 */
import { readFileSync } from 'node:fs';
import { JSDOM } from '../src/documents/node_modules/jsdom/lib/api.js';

const dom = new JSDOM('<!doctype html><body></body>');
globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
globalThis.DOMParser = dom.window.DOMParser;
globalThis.XMLSerializer = dom.window.XMLSerializer;
globalThis.Blob = dom.window.Blob;
globalThis.getComputedStyle = dom.window.getComputedStyle;

const P = await import('../src/presentation/lib/pptx/src/index.ts');
const model = await import('../src/presentation/src/model.js');
const { runTool } = await import('../src/presentation/src/assistant-tools.js');

const bytes = new Uint8Array(readFileSync(new URL('../src/presentation/lib/pptx/test/fixtures/minimal/two-slides.pptx', import.meta.url)));
const pres = await P.loadPresentation(bytes);

// Le texte tel que l'éditeur l'affiche, tous objets confondus.
const slideText = (deck, s) => P.getSlideShapes(s).map((sh) => { try { return model.displayShapeText(deck, sh); } catch { return ''; } }).join(' ');
const slideTitles = (deck) => P.getSlides(deck).map((s, i) => `${i + 1}:${slideText(deck, s).slice(0, 24) || '(vide)'}`);

let pass = 0;
const fails = [];
const check = (label, ok, extra = '') => {
  if (ok) { pass += 1; console.log(`  ✓ ${label}`); }
  else { fails.push(label); console.log(`  ✗ ${label} ${extra}`); }
};

// Un env minimal : les modifications s'appliquent directement sur le deck.
let current = pres;
const env = {
  pres: () => current,
  slideIndex: () => 0,
  selectionIds: () => [],
  theme: () => 'studio',
  edit: async (fn) => {
    const out = fn(current);
    return { applied: true, result: out };
  },
  withTextBody: (obj) => obj,
  setText: () => {},
  textColor: () => '#000000',
  fitTable: () => {},
  applyTheme: () => {},
  select: () => {},
};

console.log('\nPrésentation — position des diapositives');
const before = P.getSlides(pres).length;
check('le deck de test a des diapositives', before >= 2, `(${before})`);

// add_slide en position 2 : elle doit se retrouver en 2.
const added = await runTool('add_slide', { layout: 'title', title: 'MA POSITION', position: 2 }, env);
const after = P.getSlides(pres);
const at = after.findIndex((s) => slideText(pres, s).includes('MA POSITION'));
check('la diapositive ajoutée est bien dans le deck', at >= 0, `positions : ${slideTitles(pres).join(' | ')}`);
check('elle est en position 2, comme annoncé', at === 1, `elle est en position ${at + 1} — réponse de l'outil : ${added.content}`);

// add_slide sans position : après la diapositive courante.
const added2 = await runTool('add_slide', { layout: 'title', title: 'SUIVANTE' }, env);
const at2 = P.getSlides(pres).findIndex((s) => slideText(pres, s).includes('SUIVANTE'));
// Une suite se pose à la file : après celle que l'assistant vient de placer.
check('sans position, elle suit celle qui vient d’être posée', at2 === 2, `elle est en ${at2 + 1} — ${added2.content}`);

// move_slide : la diapositive 1 part à la fin, c'est bien elle qu'on retrouve là.
const firstText = slideText(pres, P.getSlides(pres)[0]);
await runTool('move_slide', { slide: 1, to: P.getSlides(pres).length }, env);
const lastText = slideText(pres, P.getSlides(pres).at(-1));
check('move_slide place la diapositive 1 à la fin', lastText === firstText, `fin = « ${lastText.slice(0, 24)} », attendu « ${firstText.slice(0, 24)} »`);

// Le vrai scénario de l'assistant : construire un deck diapo après diapo.
const deck = await P.loadPresentation(new Uint8Array(readFileSync(new URL('../src/presentation/lib/pptx/test/fixtures/minimal/two-slides.pptx', import.meta.url))));
const base = P.getSlides(deck).length;
const deckEnv = { ...env, pres: () => deck, edit: async (fn) => ({ applied: true, result: fn(deck) }) };
const titles = ['UN', 'DEUX', 'TROIS', 'QUATRE'];
// Comme le modèle le fait vraiment : pas de position, il compte sur l'outil.
for (const title of titles) {
  await runTool('add_slide', { layout: 'title', title }, deckEnv);
}
const order = titles.map((t) => P.getSlides(deck).findIndex((s) => slideText(deck, s).includes(t)));
// La première se pose juste après la diapositive courante (la 1re), les autres à sa suite.
const wanted = titles.map((_, i) => 1 + i);
check('quatre diapositives sans position gardent l’ordre du plan', order.every((at, i) => at === wanted[i]), `positions : ${order.map((n) => n + 1).join(', ')} (attendu ${wanted.map((n) => n + 1).join(', ')})`);
check('aucune diapositive perdue', P.getSlides(deck).length === base + titles.length, `${P.getSlides(deck).length} au lieu de ${base + titles.length}`);

console.log(`\n${pass} réussite(s), ${fails.length} échec(s)`);
if (fails.length) process.exit(1);
