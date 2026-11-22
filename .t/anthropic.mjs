/**
 * Vérifie que les conversations écrites au format Anthropic (Présentation,
 * Tableur) passent correctement par un fournisseur OpenAI v1.
 */
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

const { updateConfig, makeProvider } = await import('../src/shared/config.js');
const ai = await import('../src/shared/ai.js');

const provider = makeProvider({
  name: 'Faux', preset: 'custom', baseUrl: 'http://127.0.0.1:4310/v1',
  apiKey: 'thk_test', models: ['fake-gpt'], model: 'fake-gpt',
});
updateConfig({ ai: { enabled: true, providers: [provider], activeProvider: provider.id } });

// --- Conversation « Présentation » : outils Anthropic, tours d'outils ---
const transcript = [
  { role: 'user', content: 'Ajoute une diapositive de titre.' },
  {
    role: 'assistant',
    content: [
      { type: 'text', text: 'Je regarde la présentation.' },
      { type: 'tool_use', id: 'tu_1', name: 'get_deck', input: { slide: 1 } },
    ],
  },
  {
    role: 'user',
    content: [{ type: 'tool_result', tool_use_id: 'tu_1', content: '{"slides":3}' }],
  },
];
const iterable = await ai.chat(transcript, {
  stream: true,
  model: 'claude-opus-5-5',
  tools: [{ name: 'get_deck', description: 'Lit la présentation', input_schema: { type: 'object', properties: {} } }],
});
const parts = [];
for await (const p of iterable) parts.push(p);
console.log('1. fragments          :', parts.map((p) => p.type).join(' → '));

const { readFileSync } = await import('node:fs');
const sent = JSON.parse(readFileSync('/home/user/NemesisWorkspace/.t/requests.json', 'utf8')).at(-1).body;
console.log('2. rôles envoyés      :', sent.messages.map((m) => m.role).join(' → '));
const assistant = sent.messages.find((m) => m.role === 'assistant');
console.log('3. tool_calls OpenAI  :', JSON.stringify(assistant.tool_calls?.[0]?.function));
const toolMsg = sent.messages.find((m) => m.role === 'tool');
console.log('4. message tool       :', toolMsg.tool_call_id, '/', toolMsg.content);
console.log('5. modèle             :', sent.model);
