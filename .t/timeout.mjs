/**
 * Un fournisseur muet ne doit pas bloquer l'interface.
 *
 * Deux cas réels : la connexion s'ouvre et rien n'arrive (le panneau restait
 * « en train de répondre » indéfiniment), et le flux s'arrête au milieu.
 * On vérifie aussi que Stop (signal de l'appelant) marche toujours.
 */
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><body></body>');
globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
const store = new Map();
Object.defineProperty(dom.window, 'localStorage', { configurable: true, value: {
  getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k), clear: () => store.clear(), key: (i) => [...store.keys()][i] ?? null, get length() { return store.size; },
} });
globalThis.localStorage = dom.window.localStorage;

// Des limites courtes, pour ne pas attendre une minute par cas.
globalThis.__nemesisAiTimeouts = { firstByte: 1500, idle: 1500 };

const { createServer } = await import('node:http');
const server = createServer((req, res) => {
  if (req.url.endsWith('/models')) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"data":[{"id":"muet"}]}'); return; }
  if (req.url.includes('/muet-total')) { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); return; } // rien, jamais
  if (req.url.includes('/muet-flux')) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Bon' } }] })}\n\n`);
    return; // puis plus rien : le flux s'arrête au milieu
  }
  res.writeHead(404); res.end();
});
await new Promise((r) => server.listen(4312, '127.0.0.1', r));

const { updateConfig } = await import('../src/shared/config.js');
updateConfig({ ai: { enabled: true, providers: [{ id: 'p', name: 'Muet', baseUrl: 'http://127.0.0.1:4312/v1', apiKey: 'k', model: 'muet', models: ['muet'] }], activeProvider: 'p' } });
const { chat } = await import('../src/shared/ai.js');

const base = 'http://127.0.0.1:4312/v1';
const withUrl = (url) => updateConfig({ ai: { enabled: true, providers: [{ id: 'p', name: 'Muet', baseUrl: url, apiKey: 'k', model: 'muet', models: ['muet'] }], activeProvider: 'p' } });

let pass = 0;
const fails = [];
const check = (label, ok, extra = '') => {
  if (ok) { pass += 1; console.log(`  ✓ ${label}`); }
  else { fails.push(label); console.log(`  ✗ ${label} ${extra}`); }
};
const timed = async (fn) => { const t = Date.now(); try { return { value: await fn(), ms: Date.now() - t }; } catch (error) { return { error, ms: Date.now() - t }; } };

console.log('\nIA — un fournisseur qui ne répond pas');

// 1. Rien ne vient du tout.
withUrl(`${base}/muet-total`);
let r = await timed(async () => { for await (const _ of await chat('bonjour', { stream: true })) { /* rien */ } });
check('le flux muet lève une erreur de délai', r.error?.code === 'timeout', `${r.error?.code} — ${r.error?.message}`);
check('il le fait vite (pas de blocage)', r.ms < 6000, `${r.ms} ms`);

// 2. Le flux s'arrête au milieu.
withUrl(`${base}/muet-flux`);
const seen = [];
r = await timed(async () => { for await (const part of await chat('bonjour', { stream: true })) seen.push(part); });
check('le flux interrompu lève une erreur de délai', r.error?.code === 'timeout', `${r.error?.code} — ${r.error?.message}`);
check('le texte déjà reçu a été livré', seen.some((p) => p.type === 'text' && p.text === 'Bon'), JSON.stringify(seen));
check('puis il s’arrête sans traîner', r.ms < 6000, `${r.ms} ms`);

// 3. Stop (le signal de l'appelant) marche toujours.
withUrl(`${base}/muet-total`);
const stop = new AbortController();
setTimeout(() => stop.abort(), 200);
r = await timed(async () => { for await (const _ of await chat('bonjour', { stream: true, signal: stop.signal })) { /* rien */ } });
check('Stop interrompt le flux', !!r.error, `aucune erreur levée`);
check('Stop n’est pas confondu avec un délai', r.error?.code !== 'timeout', `code ${r.error?.code}`);

console.log(`\n${pass} réussite(s), ${fails.length} échec(s)`);
server.close();
if (fails.length) { console.log('Échecs :', fails.join(', ')); process.exit(1); }
