/**
 * Le panneau Tableur tel que la personne le voit : on l'ouvre, on écrit, on
 * envoie, et on regarde. Le symptôme rapporté était « ça tourne en boucle sans
 * réponse » : le tour doit se terminer, et le bouton revenir.
 *
 * Le classeur est un vrai Workbook du projet, réduit à ce que l'agent lit.
 */
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/spreadsheet/' });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
for (const name of ['HTMLElement', 'Node', 'DOMParser', 'XMLSerializer', 'Blob', 'File', 'FileReader', 'getComputedStyle', 'Event', 'CustomEvent', 'KeyboardEvent']) {
  globalThis[name] = dom.window[name];
}
globalThis.requestAnimationFrame = (fn) => setTimeout(() => fn(0), 0);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
globalThis.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
dom.window.matchMedia = globalThis.matchMedia;
globalThis.AbortController = dom.window.AbortController;
globalThis.AbortSignal = dom.window.AbortSignal;
const store = new Map();
Object.defineProperty(dom.window, 'localStorage', { configurable: true, value: {
  getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k), clear: () => store.clear(), key: (i) => [...store.keys()][i] ?? null, get length() { return store.size; },
} });
globalThis.localStorage = dom.window.localStorage;

const { updateConfig } = await import('../src/shared/config.js');
updateConfig({ ai: { enabled: true, providers: [{ id: 'p1', name: 'Faux', baseUrl: 'http://127.0.0.1:4310/v1', apiKey: 'thk_test', model: 'fake-gpt', models: ['fake-gpt'] }], activeProvider: 'p1' } });
const { installLocalSdk } = await import('../src/shared/local-sdk.js');
installLocalSdk({ force: true });

const { createAiPanel } = await import('../src/spreadsheet/src/ui/aipanel.js');
const { Workbook } = await import('../src/spreadsheet/src/core/workbook.js');

let pass = 0;
const fails = [];
const check = (label, ok, extra = '') => {
  if (ok) { pass += 1; console.log(`  ✓ ${label}`); }
  else { fails.push(label); console.log(`  ✗ ${label} ${extra}`); }
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 12000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (fn()) return true; await wait(50); }
  return false;
}

const wb = new Workbook();
const ctx = {
  wb,
  doc: { name: 'Classeur' },
  subscribe: () => () => {},
  historyTop: null,
  grid: null,
  selection: () => ({ sheetId: wb.sheets[0].id, range: { r1: 0, c1: 0, r2: 0, c2: 0 } }),
  onUndo: () => {},
};
const env = {
  sheetId: () => wb.sheets[0].id,
  selection: () => ({ r1: 0, c1: 0, r2: 0, c2: 0 }),
  whenIdle: () => null,
  select: () => {},
};
let panel;
try {
  panel = createAiPanel(ctx, env, { onToggle: () => {}, onBusy: () => {} });
} catch (error) {
  console.log('\nTableur — le panneau');
  console.log('  ✗ le panneau se monte :', error.message);
  process.exit(1);
}
const node = panel.el;
document.body.append(node);

console.log('\nTableur — le panneau');
check('le panneau se monte', !!node);
const input = node.querySelector('.ai-input');
const form = node.querySelector('.ai-composer');
const send = node.querySelector('.ai-send');
check('il a un champ et un bouton d’envoi', !!input && !!send, `${!!input} / ${!!send}`);
check('l’envoi est désactivé tant que le champ est vide', send.disabled === true);

panel.open?.();
input.value = 'Construis un budget simple';
input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
check('l’envoi s’active quand on écrit', await until(() => send.disabled === false, 2000), 'il reste désactivé');

form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
check('le message s’affiche', await until(() => !!node.querySelector('.ai-user')), 'aucune bulle');
const answered = await until(() => /plan/i.test(node.querySelector('.ai-log')?.textContent || '') || !!node.querySelector('.ai-step'), 12000);
check('le tour se termine avec une réponse', answered, node.querySelector('.ai-log')?.textContent?.slice(0, 200));
check('le bouton d’envoi revient', await until(() => send.disabled === false, 3000), 'il est resté bloqué : c’est le symptôme signalé');

console.log(`\n${pass} réussite(s), ${fails.length} échec(s)`);
if (fails.length) { console.log('Échecs :', fails.join(', ')); process.exit(1); }
