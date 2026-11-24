/**
 * Vérifie la pipeline IA partagée contre le faux fournisseur :
 * fournisseur actif, images, outils façon Anthropic, flux d'outil, texte.
 */
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost:4200/' });
const store = new Map();
const localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key),
  clear: () => store.clear(),
  key: (i) => [...store.keys()][i] || null,
  get length() { return store.size; },
};
global.window = dom.window;
global.document = dom.window.document;
global.localStorage = localStorage;
Object.defineProperty(dom.window, 'localStorage', { value: localStorage, configurable: true });
global.CustomEvent = dom.window.CustomEvent;
Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });

const { updateConfig, loadConfig, activeProvider, makeProvider } = await import('../src/shared/config.js');
const ai = await import('../src/shared/ai.js');

// Deux fournisseurs enregistrés, le second actif.
const providerA = makeProvider({ name: 'Local A', preset: 'custom', baseUrl: 'http://127.0.0.1:4999/v1', apiKey: 'k-a', models: ['a-model'], model: 'a-model' });
const providerB = makeProvider({
  name: 'Faux', preset: 'custom', baseUrl: 'http://127.0.0.1:4310/v1', apiKey: 'thk_test',
  models: ['fake-gpt', 'fake-vision'], model: 'fake-gpt', supportsImages: true,
});
updateConfig({ ai: { enabled: true, providers: [providerA, providerB], activeProvider: providerB.id } });

const config = loadConfig();
console.log('1. fournisseurs       :', config.ai.providers.map((p) => p.name).join(', '));
console.log('2. actif              :', activeProvider(config.ai).name);
console.log('3. prêt               :', ai.aiAvailable(), '/ modèle :', ai.aiModel(), '/ images :', ai.aiSupportsImages());

// Liste des modèles du fournisseur actif.
const models = await ai.listModels();
console.log('4. modèles du serveur :', models.join(', '));

// Un échange avec outils (format Anthropic) et une image.
const iterable = await ai.chat(
  [
    { role: 'system', content: 'Tu es un assistant.' },
    { role: 'user', content: [
      { type: 'text', text: 'Crée un document.' },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgo=' } },
    ] },
  ],
  {
    stream: true,
    // Le modèle « Puter » que les éditeurs demandent ne doit pas être transmis.
    model: 'claude-opus-5-5',
    tools: [
      { name: 'edit_document', description: 'Modifie le document', input_schema: { type: 'object', properties: { action: { type: 'string' } } } },
    ],
  },
);
const parts = [];
for await (const part of iterable) parts.push(part);
console.log('5. fragments reçus    :', parts.map((p) => p.type).join(' → '));
const call = parts.find((p) => p.type === 'tool_use');
console.log('6. outil recomposé    :', call?.name, JSON.stringify(call?.input));
console.log('7. texte              :', parts.filter((p) => p.type === 'text').map((p) => p.text).join(''));

const sent = JSON.parse((await import('node:fs')).readFileSync('/home/user/NemesisWorkspace/.t/requests.json', 'utf8'));
const last = sent.at(-1);
console.log('8. modèle envoyé      :', last.body.model);
console.log('9. auth envoyée       :', last.auth);
console.log('10. outil en OpenAI   :', JSON.stringify(last.body.tools?.[0]).slice(0, 90));
const userContent = last.body.messages.find((m) => m.role === 'user')?.content;
console.log('11. image convertie   :', Array.isArray(userContent) && userContent.some((p) => p.type === 'image_url' && p.image_url.url.startsWith('data:image/png;base64,')));

// Un échange non configuré doit échouer avec un message clair.
updateConfig({ ai: { enabled: false } });
try {
  await ai.chat('ping');
} catch (error) {
  console.log('12. désactivé         :', error.code, '—', error.message.slice(0, 60));
}
