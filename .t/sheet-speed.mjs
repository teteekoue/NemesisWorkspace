/**
 * Où passe le temps quand on envoie un message dans le Tableur ?
 * On chronomètre chaque étape : le flux, l'outil, le rendu.
 */
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<!doctype html><body></body>', { url:'http://localhost/spreadsheet/' });
globalThis.window = dom.window; globalThis.document = dom.window.document;
Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});
for (const n of ['HTMLElement','Node','DOMParser','XMLSerializer','Blob','File','FileReader','getComputedStyle','Event','CustomEvent']) globalThis[n]=dom.window[n];
globalThis.requestAnimationFrame=(f)=>setTimeout(()=>f(0),0); globalThis.cancelAnimationFrame=(i)=>clearTimeout(i);
globalThis.ResizeObserver=class{observe(){}unobserve(){}disconnect(){}};
globalThis.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}}); dom.window.matchMedia=globalThis.matchMedia;
globalThis.AbortController=dom.window.AbortController; globalThis.AbortSignal=dom.window.AbortSignal;
const store=new Map();
Object.defineProperty(dom.window,'localStorage',{configurable:true,value:{getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>store.delete(k),clear:()=>store.clear(),key:i=>[...store.keys()][i]??null,get length(){return store.size;}}});
globalThis.localStorage=dom.window.localStorage;

const { updateConfig } = await import('../src/shared/config.js');
updateConfig({ ai:{ enabled:true, providers:[{id:'p1',name:'Faux',baseUrl:'http://127.0.0.1:4310/v1',apiKey:'t',model:'fake-gpt',models:['fake-gpt']}], activeProvider:'p1' } });
const { installLocalSdk } = await import('../src/shared/local-sdk.js'); installLocalSdk({force:true});
const lib = await import('../src/spreadsheet/src/lib/puter.js');
const { createAgent, TOOLS_HINT } = await import('../src/spreadsheet/src/core/aiagent.js').catch(()=>({}));

const msg = [{ role:'user', content:'Construis un budget' }];
let t = Date.now();
const parts = [];
for await (const p of lib.aiChatStream(msg, { model:'fake-gpt', tools:[{type:'function',function:{name:'x',parameters:{}}}], maxTokens:100 })) parts.push(p);
console.log(`flux complet : ${Date.now()-t} ms, ${parts.length} fragments`);

// Le même, dix fois de suite : le coût d'un tour dépend-il du nombre de tours ?
const seconds = [];
for (let i=0;i<5;i++){ const s=Date.now(); for await (const _ of lib.aiChatStream(msg,{model:'fake-gpt'})) {} seconds.push(Date.now()-s); }
console.log('cinq tours :', seconds.join(' / '), 'ms');

// La taille du prompt envoyé par l'agent (un historiqve qui enfle ralentit tout).
const mod = await import('../src/spreadsheet/src/core/aiagent.js');
const requestMessages = mod.requestMessages;
let history = [];
for (let i=0;i<20;i++){
  history.push({ role:'user', content:'Message '+i });
  history.push({ role:'assistant', content:'Réponse '+i });
}
const built = requestMessages(history);
console.log(`20 tours : ${built.length} messages envoyés, ${JSON.stringify(built).length} octets`);
