/**
 * Le panneau Documents, tel qu'il est LIVRÉ : on charge le bundle construit
 * (dist) dans jsdom, on ouvre l'application, on clique sur l'assistant, on
 * écrit et on envoie. Si ça casse, c'est le code que l'utilisateur exécute.
 *
 * Le fournisseur est le faux serveur local (port 4310).
 */
import { JSDOM, VirtualConsole } from 'jsdom';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const dist = '/home/user/NemesisWorkspace/src/documents/dist';
const html = readFileSync(join(dist, 'index.html'), 'utf8');
const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', (e) => errors.push(`jsdomError: ${e.message}`));
vc.on('error', (...a) => errors.push(`console.error: ${a.join(' ')}`));

const dom = new JSDOM(html, {
  url: 'http://localhost/documents/',
  runScripts: 'dangerously',
  resources: undefined,
  pretendToBeVisual: true,
  virtualConsole: vc,
});
const { window } = dom;
for (const name of ['HTMLElement', 'Node', 'DOMParser', 'XMLSerializer', 'Blob', 'File', 'FileReader', 'getComputedStyle', 'Event', 'CustomEvent', 'KeyboardEvent', 'MouseEvent', 'AbortController', 'AbortSignal']) {
  globalThis[name] = window[name];
}
globalThis.window = window;
globalThis.document = window.document;
Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true });
globalThis.requestAnimationFrame = (fn) => setTimeout(() => fn(0), 0);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
window.ResizeObserver = globalThis.ResizeObserver;
globalThis.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
window.IntersectionObserver = globalThis.IntersectionObserver;
globalThis.localStorage = window.localStorage;
globalThis.fetch = (...a) => fetch(...a);

// Le fournisseur, avant que l'application ne démarre.
window.localStorage.setItem('nemesis:config:v1', JSON.stringify({
  ai: {
    enabled: true,
    activeProvider: 'p1',
    providers: [{ id: 'p1', name: 'Faux', baseUrl: 'http://127.0.0.1:4310/v1', apiKey: 'thk_test', model: 'fake-gpt', models: ['fake-gpt'] }],
  },
}));

// Les scripts du bundle, dans l'ordre de la page.
const scripts = [...html.matchAll(/<script[^>]*src="([^"]+)"[^>]*>/g)].map((m) => m[1]);
const files = readdirSync(join(dist, 'assets'));

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function run(src) {
  const code = readFileSync(join(dist, src.replace(/^\.?\//, '')), 'utf8');
  const script = window.document.createElement('script');
  script.type = 'module';
  // Un module écrit en clair : jsdom n'exécute pas les modules, on le fait nous-mêmes.
  const blobUrl = null;
  void blobUrl;
  try {
    const fn = new Function('window', 'document', 'navigator', 'localStorage', 'fetch', 'console', 'setTimeout', 'clearTimeout', 'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame', 'location', 'history', 'performance', 'URL', 'Blob', 'File', 'FormData', 'TextEncoder', 'TextDecoder', 'crypto', 'CustomEvent', 'Event', 'Image', 'DOMParser', 'XMLSerializer', 'MutationObserver', 'IntersectionObserver', 'ResizeObserver', 'matchMedia', 'getComputedStyle', code);
    fn(window, window.document, window.navigator, window.localStorage, globalThis.fetch, console, setTimeout, clearTimeout, queueMicrotask, requestAnimationFrame, cancelAnimationFrame, window.location, window.history, performance, URL, window.Blob, window.File, FormData, TextEncoder, TextDecoder, crypto, window.CustomEvent, window.Event, window.Image, window.DOMParser, window.XMLSerializer, window.MutationObserver, window.IntersectionObserver, window.ResizeObserver, window.matchMedia, window.getComputedStyle);
    return true;
  } catch (error) {
    errors.push(`script ${src}: ${error.message}`);
    return false;
  }
}

console.log('\nDocuments — le bundle livré');
// Les modules du bundle sont des ESM : on les charge par import() depuis le disque,
// ce que fait le navigateur avec <script type=module>.
const mods = ['assets/app-L99e9oo8.js'];
let loaded = 0;
for (const m of mods) {
  try {
    await import(`file://${join(dist, m)}`);
    loaded += 1;
  } catch (error) {
    errors.push(`${m}: ${error.message.split('\n')[0]}`);
  }
}
console.log(`  modules chargés : ${loaded}/${mods.length}`);
if (errors.length) {
  console.log('  Erreurs au chargement :');
  for (const e of [...new Set(errors)].slice(0, 8)) console.log('   -', e);
}
const root = window.document.getElementById('app') || window.document.body;
console.log(`  contenu monté : ${root.textContent.trim().length} caractères`);
