/** L'onglet Paramètres ▸ IA : liste, ajout, sélection, test. */
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost:4200/' });
const store = new Map();
const localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
  key: (i) => [...store.keys()][i] || null,
  get length() { return store.size; },
};
global.window = dom.window;
global.document = dom.window.document;
global.localStorage = localStorage;
Object.defineProperty(dom.window, 'localStorage', { value: localStorage, configurable: true });
global.CustomEvent = dom.window.CustomEvent;
global.Node = dom.window.Node;
global.HTMLElement = dom.window.HTMLElement;
global.requestAnimationFrame = (fn) => setTimeout(fn, 0);
global.matchMedia = () => ({ matches: false, addEventListener() {} });
dom.window.matchMedia = global.matchMedia;

const { openSettings } = await import('../src/nemesis-workspace/src/settings/settings.js');
const { loadConfig } = await import('../src/shared/config.js');

openSettings({ tab: 'ai' });
await new Promise((r) => setTimeout(r, 400));

const pane = document.querySelector('.settings-pane');
console.log('1. liste vide          :', !!pane.querySelector('.provider-detail .empty-state'));

// Ajouter un fournisseur.
pane.querySelector('.provider-row.add').click();
await new Promise((r) => setTimeout(r, 200));
console.log('2. fournisseur ajouté  :', loadConfig().ai.providers.length, '— actif :', loadConfig().ai.activeProvider !== '');

// Remplir les champs comme le ferait l'utilisateur.
const inputs = [...pane.querySelectorAll('.provider-detail input.input')];
const nameInput = inputs[0];
const urlInput = inputs.find((i) => i.type === 'url');
const keyInput = inputs.find((i) => i.type === 'password');
nameInput.value = 'TokenHarbor';
nameInput.dispatchEvent(new dom.window.Event('input'));
nameInput.dispatchEvent(new dom.window.Event('change'));
urlInput.value = 'https://tokenharbor.ai/v1';
urlInput.dispatchEvent(new dom.window.Event('input'));
urlInput.dispatchEvent(new dom.window.Event('change'));
keyInput.value = 'thk_live_test';
keyInput.dispatchEvent(new dom.window.Event('input'));
keyInput.dispatchEvent(new dom.window.Event('change'));
await new Promise((r) => setTimeout(r, 200));

const configured = loadConfig().ai.providers[0];
console.log('3. nom enregistré      :', configured.name);
console.log('4. endpoint enregistré :', configured.baseUrl);
console.log('5. clé enregistrée     :', configured.apiKey === 'thk_live_test');
console.log('6. masque dans l’UI    :', keyInput.type === 'password');

// Enregistrement vérifié après relecture depuis le stockage.
console.log('7. relu du stockage    :', JSON.parse(localStorage.getItem('nemesis:config:v1')).ai.providers[0].name);

// Deuxième fournisseur + bascule.
pane.querySelector('.provider-row.add').click();
await new Promise((r) => setTimeout(r, 150));
const rows = pane.querySelectorAll('.provider-row');
console.log('8. deux fournisseurs   :', loadConfig().ai.providers.length);
rows[0].click();
await new Promise((r) => setTimeout(r, 150));
console.log('9. actif après bascule :', loadConfig().ai.activeProvider === loadConfig().ai.providers[0].id);
