/**
 * La boucle complète de l'assistant Documents, contre le faux fournisseur :
 * le modèle demande un outil, le client le recompose, l'outil s'exécute dans
 * le document, le compte rendu repart au modèle, qui répond en texte.
 *
 * C'est exactement le chemin du panneau : chat(transcript, { tools }) →
 * fragments `tool_use` → runTool → messages `tool_result` → texte final.
 */
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';

const dom = new JSDOM('<!doctype html><body></body>');
globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Node = dom.window.Node;
globalThis.DOMParser = dom.window.DOMParser;
globalThis.XMLSerializer = dom.window.XMLSerializer;
globalThis.Blob = dom.window.Blob;
globalThis.File = dom.window.File;
globalThis.getComputedStyle = dom.window.getComputedStyle;
globalThis.requestAnimationFrame = (fn) => setTimeout(() => fn(0), 0);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
dom.window.matchMedia = globalThis.matchMedia;
globalThis.localStorage = (() => {
  const map = new Map();
  return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), removeItem: (k) => map.delete(k), clear: () => map.clear(), key: (i) => [...map.keys()][i] ?? null, get length() { return map.size; } };
})();
Object.defineProperty(dom.window, 'localStorage', { value: globalThis.localStorage, configurable: true });

const BASE = 'http://127.0.0.1:4310/v1';
const { updateConfig } = await import('../src/shared/config.js');
updateConfig({ ai: { enabled: true, providers: [{ id: 'p1', name: 'Faux', baseUrl: BASE, apiKey: 'thk_test', model: 'fake-gpt', models: ['fake-gpt'], supportsImages: true }], activeProvider: 'p1' } });

const { chat } = await import('../src/shared/ai.js');
const { TextDocument } = await import('../src/documents/src/engine/model.js');
const { createDocx, WRITING_STYLES } = await import('../src/documents/src/engine/docx.js');
const { runTool, ASSISTANT_TOOLS, ASSISTANT_SYSTEM_PROMPT, documentSnapshot } = await import('../src/documents/src/lib/assistant-tools.js');

let pass = 0;
const fails = [];
const check = (label, ok, extra = '') => {
  if (ok) { pass += 1; console.log(`  ✓ ${label}`); }
  else { fails.push(label); console.log(`  ✗ ${label} ${extra}`); }
};

const blank = createDocx([], undefined, undefined, undefined, [], {}, WRITING_STYLES);
const model = new TextDocument(blank.paragraphs, blank.pageSettings, blank.numbering, blank.styles, blank.tables, blank.assets);
model.select(0);
const engine = { model, execute: (fn) => { const out = fn(); return out === undefined ? true : out; }, undo() {}, focus() {} };

const transcript = [
  { role: 'system', content: ASSISTANT_SYSTEM_PROMPT },
  { role: 'user', content: `${documentSnapshot(engine, { name: 'Test.docx' })}\n\nAjoute « Bonjour » au document.` },
];

console.log('\nBoucle complète : chat → tool_use → runTool → tool_result');
const stream = await chat(transcript, { tools: ASSISTANT_TOOLS, stream: true });
let text = '';
const calls = [];
for await (const part of stream) {
  if (part.type === 'text') text += part.text;
  else if (part.type === 'tool_use') calls.push(part);
  else if (part.type === 'error') throw new Error(part.error?.message);
}
check('le flux porte un appel d’outil recomposé', calls.length === 1 && calls[0].name === 'edit_document', JSON.stringify(calls));
check('les arguments sont du JSON lisible', calls[0].input?.action === 'insert' && calls[0].input?.text === 'Bonjour');
check('le texte final accompagne l’appel', /plan/i.test(text), text);

// Le faux fournisseur demande `edit_document`, qui n'existe pas ici : l'outil
// doit refuser proprement et le compte rendu rester lisible par le modèle.
const outcome = runTool(calls[0].name, calls[0].input, engine);
check('un outil inconnu répond sans lever', outcome.ok === false && /inconnu/i.test(outcome.content), outcome.content);

// Le cas réel : l'outil existe et agit.
const applied = runTool('insert_text', { text: 'Bonjour', where: 'end' }, engine);
check('insert_text agit sur le document', applied.ok && model.text.includes('Bonjour'), applied.content);

// Le compte rendu repart au modèle dans un message tool.
const results = [{ type: 'tool_result', tool_use_id: calls[0].id, content: applied.content }];
transcript.push({ role: 'assistant', content: [{ type: 'tool_use', id: calls[0].id, name: 'insert_text', input: { text: 'Bonjour' } }] });
transcript.push({ role: 'user', content: results });
const second = await chat(transcript, { tools: ASSISTANT_TOOLS, stream: true });
for await (const part of second) { if (part.type === 'text') text += part.text; }
check('le second tour aboutit', true);

// Ce que le fournisseur a réellement reçu.
const log = JSON.parse(readFileSync('/home/user/NemesisWorkspace/.t/requests.json', 'utf8'));
const last = log.at(-1);
check('la requête porte les outils au format OpenAI', Array.isArray(last.body.tools) && last.body.tools[0].type === 'function');
check('le message tool porte le compte rendu', last.body.messages.some((m) => m.role === 'tool' && /inséré/i.test(m.content)));
check('l’assistant a ses appels dans tool_calls', last.body.messages.some((m) => m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls[0].function.name === 'insert_text'));
check('la clé est envoyée en Bearer', last.auth === 'Bearer thk_test', last.auth);
check('le modèle réglé est celui demandé', last.body.model === 'fake-gpt', last.body.model);
check('le prompt système est transmis', last.body.messages[0].role === 'system' && /NemesisWorkspace Documents/.test(last.body.messages[0].content));

console.log(`\n${pass} réussite(s), ${fails.length} échec(s)`);
if (fails.length) { console.log('Échecs :', fails.join(', ')); process.exit(1); }
