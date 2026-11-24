/**
 * Ce qui reste sous la barre de saisie, et ce qui est dans l'en-tête.
 * Le panneau ne doit plus rien empiler sous le champ : ni compte de mots, ni
 * mention de confidentialité, ni nom de fournisseur.
 */
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url:'http://localhost/documents/' });
globalThis.window = dom.window; globalThis.document = dom.window.document;
Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});
for (const n of ['HTMLElement','Node','DOMParser','XMLSerializer','Blob','File','FileReader','getComputedStyle','Event','CustomEvent','KeyboardEvent']) globalThis[n]=dom.window[n];
globalThis.requestAnimationFrame=(f)=>setTimeout(()=>f(0),0); globalThis.cancelAnimationFrame=(i)=>clearTimeout(i);
globalThis.ResizeObserver=class{observe(){}unobserve(){}disconnect(){}};
globalThis.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}}); dom.window.matchMedia=globalThis.matchMedia;
globalThis.AbortController=dom.window.AbortController; globalThis.AbortSignal=dom.window.AbortSignal;
const store=new Map();
Object.defineProperty(dom.window,'localStorage',{configurable:true,value:{getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>store.delete(k),clear:()=>store.clear(),key:i=>[...store.keys()][i]??null,get length(){return store.size;}}});
globalThis.localStorage=dom.window.localStorage;

const { updateConfig } = await import('../src/shared/config.js');
updateConfig({ ai:{ enabled:true, providers:[{id:'p1',name:'tokenharbor',baseUrl:'http://127.0.0.1:4310/v1',apiKey:'t',model:'deepseek-v4.1-flash:free',models:['deepseek-v4.1-flash:free']}], activeProvider:'p1' } });

const { createAssistantPane } = await import('../src/documents/src/views/assistant-pane.js');
const { TextDocument } = await import('../src/documents/src/engine/model.js');
const { createDocx, WRITING_STYLES } = await import('../src/documents/src/engine/docx.js');
const blank = createDocx([], undefined, undefined, undefined, [], {}, WRITING_STYLES);
const model = new TextDocument(blank.paragraphs, blank.pageSettings, blank.numbering, blank.styles, blank.tables, blank.assets);
model.select(0);
const engine = { model, session:{path:null,body:model}, execute:(f)=>{const o=f();return o===undefined?true:o;}, undo(){}, redo(){}, focus(){} };

let pass=0; const fails=[];
const check=(l,ok,x='')=>{ if(ok){pass++;console.log(`  ✓ ${l}`);} else {fails.push(l);console.log(`  ✗ ${l} ${x}`);} };

const api = createAssistantPane({ editor:()=>engine, pkg:()=>null, error:null, available:()=>true });
document.body.append(api.fab, api.titleButton, api.pane.node);
api.open();
const pane = api.pane.node;
const form = pane.querySelector('.as-form');

console.log('\nDocuments — sous la barre de saisie');
const box = form.querySelector('.as-box');
const strays = [...form.children].filter((child) => child !== box && !child.hidden);
check('le composeur ne contient que la carte de saisie', strays.length === 0, strays.map((n) => n.className || n.tagName).join(', '));
check('plus de mention de confidentialité', !/sent to your AI provider/i.test(form.textContent));
check('plus de compte de mots sous le champ', !/whole document \(|Sends the/i.test(form.textContent), JSON.stringify(form.textContent.slice(0, 120)));

// Ce qui a été déplacé l'a bien été.
const head = pane.querySelector('.canvas-panel-heading');
check('le fournisseur est dans l’en-tête', !!head.querySelector('.as-provider-line'), 'absent');
check('son nom est lisible', /tokenharbor/i.test(head.querySelector('.as-provider-line')?.textContent || ''), head.textContent);
check('le modèle est au survol', /deepseek-v4\.1-flash:free/.test(head.querySelector('.as-provider-line')?.title || ''), 'title vide');
const scope = form.querySelector('.as-scope');
check('le compte de mots est dans la pastille de portée', /\d/.test(scope?.textContent || ''), scope?.textContent);
check('la pastille garde les deux choix', scope?.querySelectorAll('.as-scope-option').length === 2);
check('aucun nœud ne déborde du formulaire', [...form.querySelectorAll('*')].every((n) => !n.classList.contains('as-context') || n.classList.contains('visually-hidden')));

console.log(`\n${pass} réussite(s), ${fails.length} échec(s)`);
if (fails.length) { console.log('Échecs :', fails.join(', ')); process.exit(1); }
