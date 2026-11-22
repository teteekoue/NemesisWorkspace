/**
 * Le Tableur, de bout en bout : son SDK local (window.puter), son client
 * aiChatStream, et l'agent qui boucle. C'est le chemin exact du panneau.
 *
 * On mesure : la promesse se résout-elle, le texte arrive-t-il, un appel
 * d'outil est-il recomposé, et le tour suivant repart-il ?
 */
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost/spreadsheet/' });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Node = dom.window.Node;
globalThis.getComputedStyle = dom.window.getComputedStyle;
globalThis.fetch = globalThis.fetch;
globalThis.requestAnimationFrame = (fn) => setTimeout(() => fn(0), 0);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
const store = new Map();
Object.defineProperty(dom.window, 'localStorage', { configurable: true, value: {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(), key: (i) => [...store.keys()][i] ?? null, get length() { return store.size; },
} });
globalThis.localStorage = dom.window.localStorage;

const { updateConfig } = await import('../src/shared/config.js');
updateConfig({ ai: { enabled: true, providers: [{ id: 'p1', name: 'Faux', baseUrl: 'http://127.0.0.1:4310/v1', apiKey: 'thk_test', model: 'fake-gpt', models: ['fake-gpt'], supportsImages: true }], activeProvider: 'p1' } });

// Le SDK local s'installe sur window, comme la balise <script> de index.html.
const { installLocalSdk } = await import('../src/shared/local-sdk.js');
installLocalSdk({ force: true });

let pass = 0;
const fails = [];
const check = (label, ok, extra = '') => {
  if (ok) { pass += 1; console.log(`  ✓ ${label}`); }
  else { fails.push(label); console.log(`  ✗ ${label} ${extra}`); }
};

console.log('\nTableur — SDK local et flux');
check('window.puter est le SDK local', window.puter?.isLocal === true);
check('window.puter.ai.chat existe', typeof window.puter.ai.chat === 'function');
check('canChat() voit le fournisseur', window.puter.ai.canChat() === true);

// Le client du tableur, exactement celui du panneau.
let lib;
try {
  lib = await import('../src/spreadsheet/src/lib/puter.js');
} catch (error) {
  console.log('  ✗ import de lib/puter.js :', error.message);
  process.exit(1);
}
check('le tableur expose hasAI()', typeof lib.hasAI === 'function');

const raceTimeout = (promise, ms, label) =>
  Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} : toujours en cours après ${ms} ms`)), ms)),
  ]);

// 1. Un flux simple, avec le texte attendu.
const messages = [{ role: 'user', content: 'Bonjour' }];
const parts = [];
try {
  await raceTimeout((async () => {
    for await (const part of lib.aiChatStream(messages, { model: 'fake-gpt', tools: [{ type: 'function', function: { name: 'x', parameters: {} } }], maxTokens: 100 })) parts.push(part);
  })(), 8000, 'aiChatStream');
  check('le flux se termine', true);
} catch (error) {
  check('le flux se termine', false, error.message);
}
check('le texte arrive', parts.some((p) => p.type === 'text' && /plan/i.test(p.text)), JSON.stringify(parts).slice(0, 160));
check('l’appel d’outil est recomposé', parts.some((p) => p.type === 'tool' && p.name === 'edit_document'), JSON.stringify(parts).slice(0, 200));

// 2. L'agent : sa boucle doit rendre la main.
const agentModule = await import('../src/spreadsheet/src/core/aiagent.js');
check('le module de l’agent expose createAgent', typeof agentModule.createAgent === 'function');

// 3. La vraie boucle de l'agent, avec le vrai client du tableur.
const agent = agentModule.createAgent({
  chat: (msgs, opts) => lib.aiChatStream(msgs, opts),
  runTool: async () => 'ok',
  describe: () => ({ title: 'x' }),
  approve: async () => true,
  snapshot: () => 'Feuille 1 vide.',
  settings: () => ({}),
});
const events = [];
try {
  await raceTimeout(agent.send('Construis un budget', (e) => events.push(e)), 10000, 'agent.send');
  check('agent.send rend la main', true);
} catch (error) {
  check('agent.send rend la main', false, error.message);
}
check('l’agent a émis du texte', events.some((e) => e.type === 'text'), JSON.stringify(events).slice(0, 200));
check('l’agent a émis une étape d’outil', events.some((e) => e.type === 'step'), JSON.stringify(events).slice(0, 200));

console.log(`\n${pass} réussite(s), ${fails.length} échec(s)`);
if (fails.length) { console.log('Échecs :', fails.join(', ')); process.exit(1); }
