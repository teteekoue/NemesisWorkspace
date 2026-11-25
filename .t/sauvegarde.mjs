/**
 * Sauvegarder un fichier ouvert réécrit son original.
 *
 * Le défaut signalé : l'application écrivait sa copie interne, et le fichier
 * ouvert gardait l'ancienne version. Ce contrôle suit les appels réels de la
 * couche locale au pont natif, avec un original simulé.
 */
import { JSDOM } from '../src/documents/node_modules/jsdom/lib/api.js';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://app/' });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.self = dom.window;
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
globalThis.Blob = dom.window.Blob;
globalThis.File = dom.window.File;
// jsdom n'implémente pas `arrayBuffer` sur ses Blob ; le navigateur, si.
if (!dom.window.Blob.prototype.arrayBuffer) {
  dom.window.Blob.prototype.arrayBuffer = function arrayBuffer() {
    return new Promise((resolve, reject) => {
      const lecteur = new dom.window.FileReader();
      lecteur.onload = () => resolve(lecteur.result);
      lecteur.onerror = () => reject(lecteur.error);
      lecteur.readAsArrayBuffer(this);
    });
  };
}
// Un IndexedDB en mémoire, suffisant pour la couche locale.
function memoireIndexedDB() {
  const magasins = new Map();
  const base = () => {
    const db = {
      objectStoreNames: { contains: (nom) => magasins.has(nom) },
      createObjectStore: (nom) => { magasins.set(nom, new Map()); return {}; },
      transaction: (nom) => {
        const contenu = magasins.get(nom) || new Map();
        const tx = { oncomplete: null, onerror: null, onabort: null, error: null };
        const objet = {
          put: (valeur, cle) => { contenu.set(cle ?? valeur.path ?? valeur.key, structuredClone(valeur)); return { onsuccess: null, onerror: null }; },
          get: (cle) => { const r = { onsuccess: null, onerror: null, result: contenu.get(cle) }; setTimeout(() => r.onsuccess && r.onsuccess(), 0); return r; },
          delete: (cle) => { contenu.delete(cle); return {}; },
          clear: () => contenu.clear(),
          getAll: () => { const r = { onsuccess: null, result: [...contenu.values()] }; setTimeout(() => r.onsuccess && r.onsuccess(), 0); return r; },
          openCursor: () => { const r = { onsuccess: null, result: null }; setTimeout(() => r.onsuccess && r.onsuccess(), 0); return r; },
        };
        tx.objectStore = () => objet;
        setTimeout(() => tx.oncomplete && tx.oncomplete(), 0);
        return tx;
      },
    };
    return db;
  };
  return {
    open: () => {
      const requete = { onupgradeneeded: null, onsuccess: null, onerror: null };
      setTimeout(() => {
        const db = base();
        requete.result = db;
        if (requete.onupgradeneeded) requete.onupgradeneeded();
        if (requete.onsuccess) requete.onsuccess();
      }, 0);
      return requete;
    },
  };
}
globalThis.indexedDB = memoireIndexedDB();

let ok = 0;
const echecs = [];
const check = (condition, message) => {
  if (condition) { ok += 1; console.log(`  ✓ ${message}`); }
  else { echecs.push(message); console.log(`  ✗ ${message}`); }
};

// Un original connu de l'application : « rapport.docx » vient de l'appareil.
const ecrits = [];
const feuilles = [];
dom.window.NemesisHost = {
  isNative: () => true,
  saveToSource: (json) => {
    const args = JSON.parse(json);
    ecrits.push({ name: args.name, taille: args.bytes.length });
    return JSON.stringify({ linked: true, name: args.name, location: args.name });
  },
  saveFileAs: (uri, json) => {
    const args = JSON.parse(json);
    feuilles.push({ name: args.name, uri });
    return JSON.stringify({ linked: true, name: args.name, location: args.name });
  },
  hasSource: (name) => name === 'rapport.docx',
};

const { installLocalSdk, nemesisLocalSdk } = await import('../src/shared/local-sdk.js');
installLocalSdk();

console.log('\nUn fichier venu de l’appareil');
{
  const blob = new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'text/plain' });
  await nemesisLocalSdk.fs.write('Documents/rapport.docx', blob, { overwrite: true });
  check(ecrits.length === 1, 'l’original est réécrit à la sauvegarde');
  check(ecrits[0]?.name === 'rapport.docx', 'c’est bien le fichier ouvert qui est réécrit');
}

console.log('\nUn fichier créé dans l’application');
{
  const avant = ecrits.length;
  const blob = new Blob([new Uint8Array([5, 6])], { type: 'text/plain' });
  await nemesisLocalSdk.fs.write('Documents/note.docx', blob, { overwrite: true });
  check(ecrits.length === avant, 'sans original, rien n’est réécrit en aveugle');
}

console.log('\nEnregistrer sous demande une destination');
{
  const avant = feuilles.length;
  const blob = new Blob([new Uint8Array([7, 8, 9])], { type: 'application/pdf' });
  const written = await nemesisLocalSdk.ui.showSaveFilePicker(blob, 'export.pdf');
  check(feuilles.length === avant + 1, 'la feuille de destination s’ouvre');
  check(feuilles.at(-1)?.name === 'export.pdf', 'le nom proposé est celui du fichier');
  check(written?.name === 'export.pdf', 'la réponse décrit le fichier écrit');
}

console.log('\nChaque format retrouve son dossier');
{
  const { readdir } = nemesisLocalSdk.fs;
  await nemesisLocalSdk.ui.showSaveFilePicker(new Blob(['a,b\n1,2']), 'Tableau.csv');
  const feuillesCsv = await readdir('Spreadsheets').catch(() => []);
  check(feuillesCsv.some((f) => f.name === 'Tableau.csv'), 'un .csv va dans les classeurs, pas dans les documents');
  await nemesisLocalSdk.ui.showSaveFilePicker(new Blob(['x']), 'Diapos.pdf');
  const docs = await readdir('Documents').catch(() => []);
  check(docs.some((f) => f.name === 'Diapos.pdf'), 'un PDF exporté reste un document');
}

console.log(`\n${ok} réussite(s), ${echecs.length} échec(s)`);
process.exit(echecs.length ? 1 : 0);
