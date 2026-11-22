/**
 * L'envoi du message dans Documents : ce que fait le bouton, pas à pas.
 * On observe chaque étape (clic → submit → reply) pour voir laquelle ne se
 * produit pas, plutôt que de deviner.
 */
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/documents/' });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
for (const n of ['HTMLElement','Node','DOMParser','XMLSerializer','Blob','File','FileReader','getComputedStyle','Event','CustomEvent','MouseEvent','KeyboardEvent']) globalThis[n] = dom.window[n];
globalThis.requestAnimationFrame = (fn) => setTimeout(() => fn(0), 0);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
globalThis.ResizeObserver = class { observe(){} unobserve(){} disconnect(){} };
globalThis.matchMedia = () => ({ matches:false, addEventListener(){}, removeEventListener(){} });
dom.window.matchMedia = globalThis.matchMedia;
globalThis.AbortController = dom.window.AbortController;
globalThis.AbortSignal = dom.window.AbortSignal;
const store = new Map();
Object.defineProperty(dom.window, 'localStorage', { configurable:true, value:{ getItem:k=>store.get(k)??null, setItem:(k,v)=>store.set(k,String(v)), removeItem:k=>store.delete(k), clear:()=>store.clear(), key:i=>[...store.keys()][i]??null, get length(){return store.size;} } });
globalThis.localStorage = dom.window.localStorage;

const { updateConfig } = await import('../src/shared/config.js');
updateConfig({ ai:{ enabled:true, providers:[{ id:'p1', name:'Faux', baseUrl:'http://127.0.0.1:4310/v1', apiKey:'thk_test', model:'fake-gpt', models:['fake-gpt'] }], activeProvider:'p1' } });

// On espionne le client : combien d'appels, avec quelles options.
const realAi = await import('../src/shared/ai.js');
const calls = [];
const spyChat = async (prompt, options) => { calls.push({ prompt, options }); return realAi.chat(prompt, options); };

const { createAssistantPane } = await import('../src/documents/src/views/assistant-pane.js');
const { TextDocument } = await import('../src/documents/src/engine/model.js');
const { createDocx, WRITING_STYLES } = await import('../src/documents/src/engine/docx.js');
const blank = createDocx([], undefined, undefined, undefined, [], {}, WRITING_STYLES);
const model = new TextDocument(blank.paragraphs, blank.pageSettings, blank.numbering, blank.styles, blank.tables, blank.assets);
model.select(0);
const engine = { model, session:{ path:null, body:model }, execute:(fn)=>{const o=fn(); return o===undefined?true:o;}, undo(){}, redo(){}, focus(){} };

const api = createAssistantPane({ editor:()=>engine, pkg:()=>null, error:null, available:()=>true, chat: spyChat });
document.body.append(api.fab, api.titleButton, api.pane.node);
api.open();

const pane = api.pane.node;
const input = pane.querySelector('.as-input');
const send = pane.querySelector('.as-send');
const form = pane.querySelector('.as-form');

console.log('\nDocuments — l’envoi, étape par étape');
console.log('  champ :', !!input, '| bouton :', !!send, '| formulaire :', !!form);

// 1. Le CLIC sur le bouton (ce que fait la personne).
input.value = 'Écris une introduction.';
send.click();
await new Promise(r=>setTimeout(r,300));
console.log(`  après un clic sur le bouton : ${calls.length} appel(s) au fournisseur, ${pane.querySelectorAll('.as-message').length} message(s)`);
if (!calls.length) console.log('  → le clic ne déclenche rien : le bouton n’est pas dans le formulaire, ou type=submit ne soumet pas');

// 2. La touche Entrée.
const before = calls.length;
input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key:'Enter', bubbles:true, cancelable:true }));
await new Promise(r=>setTimeout(r,300));
console.log(`  après Entrée : ${calls.length - before} nouvel appel`);

// 3. Le submit du formulaire, directement.
const before2 = calls.length;
form.dispatchEvent(new dom.window.Event('submit', { bubbles:true, cancelable:true }));
await new Promise(r=>setTimeout(r,1500));
console.log(`  après submit du formulaire : ${calls.length - before2} nouvel appel`);
if (calls.length) console.log('  options reçues :', JSON.stringify(Object.keys(calls.at(-1).options||{})));
const log = pane.querySelector('.as-log');
console.log('  contenu du fil :', JSON.stringify((log?.textContent||'').slice(0,160)));
