/**
 * Le panneau Documents, tel que la personne le voit : on l'ouvre, on tape une
 * demande, on envoie — et on regarde ce qui s'affiche. Contre le faux
 * fournisseur, avec le vrai client partagé.
 *
 * C'est le test qui manquait : les outils marchaient, le panneau pas.
 */
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/documents/' });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
for (const name of ['HTMLElement', 'Node', 'DOMParser', 'XMLSerializer', 'Blob', 'File', 'FileReader', 'getComputedStyle']) {
  globalThis[name] = dom.window[name];
}
globalThis.requestAnimationFrame = (fn) => setTimeout(() => fn(0), 0);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
// Node a son propre AbortController : jsdom refuse un signal qui n'est pas le sien.
globalThis.AbortController = dom.window.AbortController;
globalThis.AbortSignal = dom.window.AbortSignal;
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
dom.window.matchMedia = globalThis.matchMedia;
const store = new Map();
Object.defineProperty(dom.window, 'localStorage', { configurable: true, value: {
  getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k), clear: () => store.clear(), key: (i) => [...store.keys()][i] ?? null, get length() { return store.size; },
} });
globalThis.localStorage = dom.window.localStorage;

const { updateConfig } = await import('../src/shared/config.js');
updateConfig({ ai: { enabled: true, providers: [{ id: 'p1', name: 'Faux', baseUrl: 'http://127.0.0.1:4310/v1', apiKey: 'thk_test', model: 'fake-gpt', models: ['fake-gpt'] }], activeProvider: 'p1' } });

const { createAssistantPane } = await import('../src/documents/src/views/assistant-pane.js');
const { TextDocument } = await import('../src/documents/src/engine/model.js');
const { createDocx, WRITING_STYLES } = await import('../src/documents/src/engine/docx.js');

let pass = 0;
const fails = [];
const check = (label, ok, extra = '') => {
  if (ok) { pass += 1; console.log(`  ✓ ${label}`); }
  else { fails.push(label); console.log(`  ✗ ${label} ${extra}`); }
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (fn()) return true; await wait(50); }
  return false;
}

const blank = createDocx([], undefined, undefined, undefined, [], {}, WRITING_STYLES);
const model = new TextDocument(blank.paragraphs, blank.pageSettings, blank.numbering, blank.styles, blank.tables, blank.assets);
model.select(0);
const engine = { model, session: { path: null, body: model }, execute: (fn) => { const out = fn(); return out === undefined ? true : out; }, undo() {}, redo() {}, focus() {} };

const api = createAssistantPane({ editor: () => engine, pkg: () => null, error: null, available: () => true });
const pane = api.pane;
document.body.append(api.fab, api.titleButton, pane.node);

console.log('\nDocuments — le panneau, pas seulement les outils');
check('le panneau se monte', !!pane?.node);
const input = pane.node.querySelector('.as-input');
const form = pane.node.querySelector('.as-form');
const send = pane.node.querySelector('.as-send');
check('il a un champ et un bouton d’envoi', !!input && !!send, `${!!input} / ${!!send}`);
check('le fil et le composeur sont deux zones', !!pane.node.querySelector('.as-conversation .as-log') && !!form);

pane.open();
check('il s’ouvre', pane.isOpen);

// Une demande simple : l'assistant doit répondre, pas tourner sans fin.
input.value = 'Ajoute une introduction à ce document.';
form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
check('le message de la personne s’affiche', await until(() => !!pane.node.querySelector('.as-message.is-me')), 'aucune bulle');
const replied = await until(() => !!pane.node.querySelector('.as-message.is-assistant .as-answer, .as-message.is-assistant .as-steps'), 12000);
check('l’assistant répond (le tour se termine)', replied, pane.node.querySelector('.as-log')?.textContent?.slice(0, 220));
check('le bouton d’envoi est réactivé', send.disabled === false, 'il est resté désactivé : le tour ne s’est jamais terminé');

// Une erreur doit s'afficher, pas laisser tourner.
api.destroy?.();
const api2 = createAssistantPane({ editor: () => engine, pkg: () => null, error: null, available: () => true, chat: async () => { throw Object.assign(new Error('Clé API refusée (401). Vérifiez la clé dans Paramètres.'), { code: 401 }); } });
const pane2 = api2.pane;
document.body.append(api2.fab, api2.titleButton, pane2.node);
api2.open();
const input2 = pane2.node.querySelector('.as-input');
pane2.node.querySelector('.as-form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
await wait(100);
input2.value = 'Bonjour';
pane2.node.querySelector('.as-form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
const shown = await until(() => /401|refus|clé/i.test(pane2.node.querySelector('.as-log')?.textContent || ''), 8000);
check('une erreur du fournisseur s’affiche dans le fil', shown, pane2.node.querySelector('.as-log')?.textContent?.slice(0, 200));
check('et le panneau redevient utilisable', pane2.node.querySelector('.as-send').disabled === false);

console.log(`\n${pass} réussite(s), ${fails.length} échec(s)`);
if (fails.length) { console.log('Échecs :', fails.join(', ')); process.exit(1); }
