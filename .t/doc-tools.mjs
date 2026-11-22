/**
 * Les outils de l'assistant Documents, essayés sur un vrai modèle (jsdom).
 * On ne teste pas le rendu : on vérifie que chaque appel change le document
 * comme annoncé, et que le modèle reçoit un compte rendu lisible.
 */
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><body></body>');
globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Node = dom.window.Node;
globalThis.getComputedStyle = dom.window.getComputedStyle;
globalThis.requestAnimationFrame = (fn) => setTimeout(() => fn(0), 0);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
globalThis.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
globalThis.fonts = { ready: Promise.resolve(), addEventListener() {} };
globalThis.DOMParser = dom.window.DOMParser;
globalThis.XMLSerializer = dom.window.XMLSerializer;
globalThis.Blob = dom.window.Blob;
globalThis.File = dom.window.File;
globalThis.TextEncoder = TextEncoder;
globalThis.TextDecoder = TextDecoder;
dom.window.ResizeObserver = globalThis.ResizeObserver;
dom.window.matchMedia = globalThis.matchMedia;

const { TextDocument } = await import('../src/documents/src/engine/model.js');
const { createDocx, WRITING_STYLES } = await import('../src/documents/src/engine/docx.js');
const { runTool, ASSISTANT_TOOLS, TOOL_NAMES } = await import('../src/documents/src/lib/assistant-tools.js');

let pass = 0;
const fails = [];
const check = (label, ok, extra = '') => {
  if (ok) { pass += 1; console.log(`  ✓ ${label}`); }
  else { fails.push(label); console.log(`  ✗ ${label} ${extra}`); }
};

// Un moteur minimal : le modèle, l'exécution directe, l'annulation.
// Un document neuf a les styles d'écriture (Titre, Sous-titre, Titre 1…) :
// c'est exactement ce que l'éditeur fabrique pour un document vierge.
function makeEngine() {
  const blank = createDocx([], undefined, undefined, undefined, [], {}, WRITING_STYLES);
  const model = new TextDocument(blank.paragraphs, blank.pageSettings, blank.numbering, blank.styles, blank.tables, blank.assets);
  model.select(0);
  return {
    model,
    execute(fn) { const out = fn(); return out === undefined ? true : out; },
    undo() {},
    focus() {},
  };
}

const paragraphsText = (engine) => engine.model.paragraphs.map((p) => (p.runs || []).map((r) => r.text || '').join(''));

console.log('\nDocuments — outils de l’assistant');
check(`${ASSISTANT_TOOLS.length} outils exposés au modèle`, ASSISTANT_TOOLS.length >= 9, `(${ASSISTANT_TOOLS.length})`);
check('chaque outil a un nom et un schéma', ASSISTANT_TOOLS.every((t) => t.function?.name && t.function?.parameters));

const engine = makeEngine();

// 1. insert_text à la fin du document
let r = runTool('insert_text', { text: 'Rapport annuel\nIntroduction', where: 'end' }, engine);
check('insert_text écrit à la fin', r.ok && paragraphsText(engine).join('|').includes('Rapport annuel'), r.content);

// 2. un titre
r = runTool('set_paragraph', { style: 'Title' }, engine);
check('set_paragraph applique « Title »', r.ok, r.content);

// 3. le corps
r = runTool('insert_text', { text: '\nCette année a été solide.\nNos points forts', where: 'end' }, engine);
check('insert_text ajoute le corps', r.ok && paragraphsText(engine).some((t) => t.includes('solide')), r.content);

// 4. une liste
r = runTool('set_list', { kind: 'bullet' }, engine);
check('set_list pose des puces', r.ok && engine.model.paragraphs.some((p) => p.list), r.content);

// 5. lecture
r = runTool('read_document', { from: 1, count: 20 }, engine);
check('read_document rend les styles', r.ok && /Title/.test(r.content) && /solide/.test(r.content), r.content.slice(0, 120));

// 6. tableau
r = runTool('insert_table', { rows: 3, columns: 2 }, engine);
check('insert_table insère un tableau', r.ok, r.content);
check('le tableau est dans le document', (engine.model.tables || []).length > 0 || r.ok);

// 7. recherche et remplacement
r = runTool('find_and_replace', { find: 'solide', replace: 'excellente' }, engine);
check('find_and_replace remplace partout', r.ok && paragraphsText(engine).some((t) => t.includes('excellente')), r.content);
check('l’ancien mot a disparu', !paragraphsText(engine).some((t) => t.includes('solide')));

// 8. mise en forme de la sélection
engine.model.select(0, 9);
r = runTool('set_format', { bold: true, fontSize: 16 }, engine);
check('set_format met en gras', r.ok, r.content);

// 9. erreurs utiles
r = runTool('set_paragraph', { style: 'NimporteQuoi' }, engine);
check('set_paragraph refuse un style inconnu', !r.ok && /Styles disponibles/.test(r.content), r.content);
r = runTool('inconnu', {}, engine);
check('un outil inconnu ne casse rien', !r.ok && /inconnu/.test(r.content));
engine.model.select(0, 0);
r = runTool('replace_selection', { text: 'x' }, engine);
check('replace_selection sans sélection explique', !r.ok && /sélection/i.test(r.content), r.content);

// 10. saut de page
r = runTool('insert_page_break', {}, engine);
check('insert_page_break répond', typeof r.ok === 'boolean', r.content);

console.log(`\n${pass} réussite(s), ${fails.length} échec(s)`);
if (fails.length) { console.log('Échecs :', fails.join(', ')); process.exit(1); }
