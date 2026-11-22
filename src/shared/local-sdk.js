/**
 * NemesisWorkspace — remplaçant local du SDK Puter (`window.puter`).
 *
 * Les trois éditeurs ont été écrits contre le SDK hébergé de Puter. Ce module
 * fournit la même API, mais **entièrement sur l'appareil** :
 *
 *   fs      un système de fichiers virtuel dans IndexedDB
 *   kv      un magasin clé/valeur par appareil
 *   ui      les dialogues d'ouverture / enregistrement, sur les fichiers locaux
 *   ai      votre propre fournisseur (compatible OpenAI v1), depuis Paramètres
 *   auth    un profil local, sans compte ni réseau
 *   workers appels serveur simulés (la collaboration est hors ligne)
 *
 * Ce qui dépend d'un serveur n'est jamais contredit : `auth` est toujours
 * « connecté » localement, `ai` répond depuis Paramètres, et la
 * collaboration signale simplement qu'elle n'est pas disponible hors ligne.
 *
 * Charger ce fichier avant le script principal de l'application :
 *   <script src="/shared/local-sdk.js"></script>
 */

import { pickDeviceFiles, saveDeviceFile, shareFile, openExternal, isNative } from './bridge.js';
import { getAiConfig, aiIsConfigured } from './config.js';
import { chat as aiChat } from './ai.js';
import { maybeBackup } from './backups.js';

/* ================================================================== */
/* 1. Charges utiles binaires hors du chemin critique                  */
/* ================================================================== */

const DB_NAME = 'nemesis-fs';
const DB_VERSION = 1;
const META_STORE = 'meta';
const BLOB_STORE = 'blobs';
const KV_STORE = 'kv';

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE, { keyPath: 'path' });
      if (!db.objectStoreNames.contains(BLOB_STORE)) db.createObjectStore(BLOB_STORE);
      if (!db.objectStoreNames.contains(KV_STORE)) db.createObjectStore(KV_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB indisponible'));
  });
  return dbPromise;
}

async function tx(store, mode, run) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(store, mode);
    const object = transaction.objectStore(store);
    let result;
    try {
      result = run(object);
    } catch (error) {
      reject(error);
      return;
    }
    transaction.oncomplete = () => resolve(result);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error('Transaction annulée'));
  });
}

const getRequest = (store, key) =>
  new Promise((resolve, reject) => {
    const request = store.get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

/* ================================================================== */
/* 2. Chemins                                                          */
/* ================================================================== */

/** Le dossier racine que le SDK d'origine renvoie pour un chemin relatif. */
const USER_ROOT = '/user';
const APP_ROOT = '/user/AppData/nemesisworkspace';

const strip = (path) => String(path ?? '').replace(/\\/g, '/').replace(/\/+$/, '');
const baseName = (path) => strip(path).split('/').pop() || '';
const dirName = (path) => {
  const full = strip(path);
  const index = full.lastIndexOf('/');
  return index <= 0 ? '/' : full.slice(0, index);
};

/**
 * Toute adresse devient un chemin absolu sous /user. Les chemins relatifs
 * sont rangés sous AppData/nemesisworkspace, exactement comme le SDK
 * d'origine le fait pour les données d'une application.
 */
export function resolvePath(path) {
  let full = strip(path);
  if (!full) return APP_ROOT;
  if (full === '~') full = USER_ROOT;
  else if (full.startsWith('~/')) full = `${USER_ROOT}/${full.slice(2)}`;
  else if (!full.startsWith('/')) full = `${APP_ROOT}/${full}`;
  return full;
}

/** L'adresse à rapporter : le chemin demandé quand il est relatif, sinon l'absolu. */
const reported = (asked, absolute) => {
  const text = strip(asked);
  return text && !text.startsWith('/') && !text.startsWith('~') ? text : absolute;
};

class FsError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'PuterFsError';
    this.code = code;
  }
}

const notFound = (path) => new FsError(`${path} does not exist`, 'subject_does_not_exist');
const exists = (path) => new FsError(`${path} already exists`, 'item_with_same_name_exists');
const notDirectory = (path) => new FsError(`${path} is not a directory`, 'not_a_directory');
const isDirectory = (path) => new FsError(`${path} is a directory`, 'is_a_directory');

/* ================================================================== */
/* 3. Métadonnées, contenu, horodatages                                 */
/* ================================================================== */

const nowSeconds = () => Math.floor(Date.now() / 1000);
const uid = () => `nw-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

async function readMeta(path) {
  return tx(META_STORE, 'readonly', (store) => getRequest(store, path));
}

async function allMeta() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction(META_STORE, 'readonly').objectStore(META_STORE).getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

async function putMeta(meta) {
  await tx(META_STORE, 'readwrite', (store) => store.put(meta));
}

async function deleteMeta(path) {
  await tx(META_STORE, 'readwrite', (store) => store.delete(path));
}

async function readBlob(path) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction(BLOB_STORE, 'readonly').objectStore(BLOB_STORE).get(path);
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error);
  });
}

async function writeBlob(path, value) {
  await tx(BLOB_STORE, 'readwrite', (store) => store.put(value, path));
}

async function deleteBlob(path) {
  await tx(BLOB_STORE, 'readwrite', (store) => store.delete(path));
}

/** Le contenu d'un fichier, sous forme de Blob typé. */
function blobOf(value, name) {
  if (value instanceof Blob) return value;
  const type = mimeFor(name);
  if (value instanceof ArrayBuffer) return new Blob([value], { type });
  if (ArrayBuffer.isView(value)) return new Blob([value.buffer], { type });
  if (typeof value === 'string') return new Blob([value], { type: type || 'text/plain' });
  return new Blob([value ?? ''], { type });
}

/** Le type MIME d'un fichier d'après son extension. */
export function mimeFor(name) {
  const ext = String(name || '').toLowerCase().split('.').pop();
  return (
    {
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      dotx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.template',
      docm: 'application/vnd.ms-word.document.macroEnabled.12',
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      pdf: 'application/pdf',
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      webp: 'image/webp',
      svg: 'image/svg+xml',
      bmp: 'image/bmp',
      txt: 'text/plain',
      md: 'text/markdown',
      html: 'text/html',
      csv: 'text/csv',
      json: 'application/json',
    }[ext] || 'application/octet-stream'
  );
}

/* ================================================================== */
/* 4. Dossiers implicites et API fs                                    */
/* ================================================================== */

/** Créer les dossiers manquants d'un chemin (comme createMissingParents). */
async function ensureParents(path) {
  const parent = dirName(path);
  if (!parent || parent === '/') return;
  const existing = await readMeta(parent);
  if (existing) {
    if (!existing.isDir) throw notDirectory(parent);
    return;
  }
  await ensureParents(parent);
  await putMeta({
    path: parent,
    name: baseName(parent),
    isDir: true,
    size: 0,
    uid: uid(),
    created: nowSeconds(),
    modified: nowSeconds(),
  });
}

function publicItem(meta, asked) {
  const at = reported(asked, meta.path);
  return {
    name: meta.name,
    path: at,
    is_dir: !!meta.isDir,
    isDir: !!meta.isDir,
    size: meta.size ?? 0,
    uid: meta.uid,
    modified: meta.modified,
    created: meta.created,
    mime: meta.isDir ? 'directory' : mimeFor(meta.name),
    // Certains écrans relisent directement le fichier depuis l'élément.
    read: () => fsApi.read(at),
    write: (data, options) => fsApi.write(at, data, options),
  };
}

/** Dédoublonner un nom : « Rapport.docx » puis « Rapport (1).docx ». */
function withSuffix(name, attempt) {
  if (!attempt) return name;
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return `${name} (${attempt})`;
  return `${name.slice(0, dot)} (${attempt})${name.slice(dot)}`;
}

/**
 * Le cœur des écritures : toutes les options du SDK d'origine sont honorées
 * (overwrite, dedupeName, createMissingParents), car les éditeurs comptent
 * sur elles pour ne jamais perdre un fichier.
 */
async function writePath(asked, data, options = {}) {
  const path = resolvePath(asked);
  const parent = dirName(path);
  if (options.createMissingParents !== false) await ensureParents(path);
  const parentMeta = await readMeta(parent);
  if (!parentMeta || !parentMeta.isDir) throw notFound(parent);

  let target = path;
  const existing = await readMeta(path);
  if (existing?.isDir) throw isDirectory(path);
  if (existing && !options.overwrite) {
    if (!options.dedupeName) throw exists(path);
    const name = baseName(path);
    let attempt = 1;
    do {
      target = `${parent === '/' ? '' : parent}/${withSuffix(name, attempt)}`;
      attempt += 1;
    } while (await readMeta(target));
  }

  const blob = blobOf(data, baseName(target));
  const previous = target === path ? existing : await readMeta(target);
  const meta = {
    path: target,
    name: baseName(target),
    isDir: false,
    size: blob.size,
    uid: previous?.uid || uid(),
    created: previous?.created || nowSeconds(),
    modified: nowSeconds(),
  };
  await writeBlob(target, blob);
  await putMeta(meta);
  // Le dossier parent vient de changer de date.
  if (parentMeta) await putMeta({ ...parentMeta, modified: meta.modified });

  // Une copie datée, sur place, pour que la perte d'un fichier ne soit jamais
  // définitive. En arrière-plan : l'enregistrement ne l'attend pas, et un
  // archivage raté n'invalide jamais l'écriture.
  if (!(options.skipBackup)) {
    setTimeout(() => {
      maybeBackup(target).catch(() => {});
    }, 0);
  }
  return publicItem(meta, asked);
}

const fsApi = {
  /** Lister un dossier. */
  async readdir(asked = '.') {
    const path = resolvePath(asked);
    const meta = await readMeta(path);
    if (!meta) throw notFound(asked);
    if (!meta.isDir) throw notDirectory(asked);
    // Chaque entrée est annoncée avec son propre chemin : le chemin demandé
    // quand il est relatif (« Documents/x.docx »), l'absolu sinon.
    const askedText = strip(asked);
    const relative = askedText && !askedText.startsWith('/') && !askedText.startsWith('~') && askedText !== '.';
    return (await allMeta())
      .filter((item) => dirName(item.path) === path)
      .map((item) =>
        publicItem(item, relative ? `${askedText.replace(/\/+$/, '')}/${item.name}` : item.path),
      );
  },

  /** Lire un fichier (Blob). */
  async read(asked) {
    const path = resolvePath(asked);
    const meta = await readMeta(path);
    if (!meta) throw notFound(asked);
    if (meta.isDir) throw isDirectory(asked);
    const blob = await readBlob(path);
    if (!blob) return new Blob([], { type: mimeFor(meta.name) });
    return blob.type ? blob : new Blob([blob], { type: mimeFor(meta.name) });
  },

  write(asked, data, options) {
    return writePath(asked, data, options);
  },

  /** Créer un dossier (sans erreur s'il existe déjà). */
  async mkdir(asked) {
    const path = resolvePath(asked);
    const existing = await readMeta(path);
    if (existing) {
      if (!existing.isDir) throw exists(path);
      return publicItem(existing, asked);
    }
    await ensureParents(path);
    const meta = { path, name: baseName(path), isDir: true, size: 0, uid: uid(), created: nowSeconds(), modified: nowSeconds() };
    await putMeta(meta);
    return publicItem(meta, asked);
  },

  /** État d'un fichier, par chemin ou par `{ uid }`. */
  async stat(target) {
    if (target && typeof target === 'object' && target.uid) {
      const found = (await allMeta()).find((item) => item.uid === target.uid);
      if (!found) throw notFound(target.uid);
      return publicItem(found, found.path);
    }
    const path = resolvePath(target);
    const meta = await readMeta(path);
    if (!meta) throw notFound(target);
    return publicItem(meta, target);
  },

  /** Supprimer un fichier, ou un dossier avec `{ recursive: true }`. */
  async delete(asked, options = {}) {
    const path = resolvePath(asked);
    const meta = await readMeta(path);
    if (!meta) throw notFound(asked);
    const victims = [path];
    if (meta.isDir) {
      const children = (await allMeta()).filter((item) => item.path.startsWith(`${path}/`));
      if (children.length && !options.recursive) throw new FsError(`${asked} is not empty`, 'directory_not_empty');
      for (const child of children) victims.push(child.path);
    }
    for (const victim of victims) {
      const entry = await readMeta(victim);
      if (entry?.isDir) await deleteMeta(victim);
      else {
        await deleteBlob(victim);
        await deleteMeta(victim);
      }
    }
    return true;
  },

  /** Renommer / déplacer. Refuse d'écraser une autre entrée. */
  async rename(asked, newName) {
    const path = resolvePath(asked);
    const meta = await readMeta(path);
    if (!meta) throw notFound(asked);
    let target;
    if (String(newName).includes('/')) target = resolvePath(newName);
    else target = `${dirName(path) === '/' ? '' : dirName(path)}/${newName}`;
    if (target === path) return publicItem(meta, asked);
    if (await readMeta(target)) throw exists(target);
    await ensureParents(target);

    const moving = [meta, ...(meta.isDir ? (await allMeta()).filter((item) => item.path.startsWith(`${path}/`)) : [])];
    for (const item of moving) {
      const nextPath = `${target}${item.path.slice(path.length)}`;
      const next = { ...item, path: nextPath, name: baseName(nextPath), modified: nowSeconds() };
      if (!item.isDir) {
        const blob = await readBlob(item.path);
        if (blob) await writeBlob(nextPath, blob);
        await deleteBlob(item.path);
      }
      await putMeta(next);
      await deleteMeta(item.path);
    }
    return publicItem({ ...meta, path: target, name: baseName(target) }, newName);
  },

  /** Copier un fichier. */
  async copy(asked, destination) {
    const source = resolvePath(asked);
    const meta = await readMeta(source);
    if (!meta || meta.isDir) throw notFound(asked);
    const blob = await readBlob(source);
    return writePath(destination || `${dirName(source)}/${meta.name}`, blob ?? new Blob([]), {
      overwrite: false,
      dedupeName: true,
      createMissingParents: true,
    });
  },

  /** Déplacer un fichier. */
  async move(asked, destination) {
    const source = resolvePath(asked);
    const meta = await readMeta(source);
    if (!meta) throw notFound(asked);
    const target = resolvePath(destination);
    await ensureParents(target);
    const blob = meta.isDir ? null : await readBlob(source);
    if (blob) await writeBlob(target, blob);
    await putMeta({ ...meta, path: target, name: baseName(target), modified: nowSeconds() });
    await deleteBlob(source);
    await deleteMeta(source);
    return publicItem({ ...meta, path: target, name: baseName(target) }, destination);
  },

  /** Adresse de lecture d'un fichier (objet URL, révoquable par l'appelant). */
  async getReadURL(asked) {
    const path = resolvePath(asked);
    const blob = await readBlob(path);
    if (!blob) throw notFound(asked);
    return URL.createObjectURL(blob);
  },

  /**
   * Partages : sans serveur, un fichier reste privé. L'API répond comme la
   * version en ligne pour que les écrans de partage expliquent la situation
   * au lieu de planter.
   */
  async share() {
    throw new FsError(
      'Le partage et la collaboration demandent un serveur. NemesisWorkspace fonctionne ici entièrement hors ligne.',
      'sharing_unavailable',
    );
  },
  async unshare() {
    return true;
  },
  async getShares() {
    return [];
  },
  async listShared() {
    return { items: [], shared_with_me: [], shared_by_me: [] };
  },
  async getShareLink() {
    return '';
  },
};

/* ================================================================== */
/* 5. Magasin clé/valeur (kv)                                          */
/* ================================================================== */

async function kvRead(key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction(KV_STORE, 'readonly').objectStore(KV_STORE).get(key);
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error);
  });
}

async function kvWrite(key, value) {
  await tx(KV_STORE, 'readwrite', (store) => store.put(value, key));
  return true;
}

const kvApi = {
  async get(key) {
    return kvRead(String(key));
  },
  async set(key, value) {
    return kvWrite(String(key), value);
  },
  async del(key) {
    await tx(KV_STORE, 'readwrite', (store) => store.delete(String(key)));
    return true;
  },
  async incr(key, amount = 1) {
    const current = Number(await kvRead(String(key))) || 0;
    const next = current + Number(amount || 1);
    await kvWrite(String(key), next);
    return next;
  },
  async decr(key, amount = 1) {
    return kvApi.incr(key, -Number(amount || 1));
  },
  async list(pattern = '*') {
    const db = await openDb();
    const keys = await new Promise((resolve, reject) => {
      const request = db.transaction(KV_STORE, 'readonly').objectStore(KV_STORE).getAllKeys();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
    if (!pattern || pattern === '*') return keys;
    const regex = new RegExp(`^${String(pattern).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);
    return keys.filter((key) => regex.test(key));
  },
  flush() {
    return true;
  },
};

/* ================================================================== */
/* 6. Dialogues de fichiers (ui)                                       */
/* ================================================================== */

const ACCEPT_MIME = {
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.csv': 'text/csv',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
};

const mimeOfExtension = (ext) => ACCEPT_MIME[String(ext).toLowerCase()] || '';

/** Un fichier choisi trouve sa place dans un dossier de l'application. */
async function importIntoFolder(folder, file) {
  await fsApi.mkdir(folder).catch(() => {});
  const item = await writePath(`${folder}/${file.name}`, new Blob([file.bytes], { type: mimeFor(file.name) }), {
    overwrite: false,
    dedupeName: true,
    createMissingParents: true,
  });
  return item;
}

/**
 * Le dialogue d'ouverture. Le sélecteur système s'ouvre, puis le fichier est
 * importé dans le dossier de l'application correspondant, pour que les
 * écrans qui listent les fichiers le retrouvent comme les autres.
 */
async function showOpenFilePicker(options = {}) {
  const accept = options.accept || ['.docx', '.xlsx', '.pptx'];
  const extensions = accept.filter((value) => value.startsWith('.'));
  const mimes = accept.filter((value) => value.includes('/'));
  const files = await pickDeviceFiles({
    accept: [...extensions, ...mimes, ...extensions.map(mimeOfExtension).filter(Boolean)],
    multiple: !!options.multiple,
  });
  if (!files.length) {
    // Annulation : le SDK d'origine ne résout jamais ce cas. `undefined` est
    // ce que les trois applications attendent derrière leur propre garde.
    return undefined;
  }
  const folderFor = (name) => {
    if (/\.(docx|dotx|docm|hwp|hwpx|md|txt|html?)$/i.test(name)) return 'Documents';
    if (/\.(xlsx|xlsm|xls|csv|ods|tsv)$/i.test(name)) return 'Spreadsheets';
    if (/\.(pptx|ppsx|odp)$/i.test(name)) return 'Presentations';
    if (/\.(png|jpe?g|gif|webp|bmp)$/i.test(name)) return 'Pictures';
    return 'Imports';
  };
  const imported = [];
  for (const file of files) imported.push(await importIntoFolder(folderFor(file.name), file));
  return options.multiple ? imported : imported[0];
}

/**
 * Le dialogue d'enregistrement. Sur Android, la feuille système enregistre
 * une copie dans Téléchargements / le dossier choisi ; dans tous les cas le
 * fichier reste rangé dans le dossier de l'application.
 */
async function showSaveFilePicker(data, suggestedName = 'Fichier') {
  const name = String(suggestedName || 'Fichier').trim() || 'Fichier';
  const bytes = new Uint8Array(
    await (data instanceof Blob ? data.arrayBuffer() : blobOf(data, name).arrayBuffer()),
  );
  const folder = /\.pptx$/i.test(name) ? 'Presentations' : /\.xlsx$/i.test(name) ? 'Spreadsheets' : 'Documents';
  const item = await writePath(`${folder}/${name}`, new Blob([bytes], { type: mimeFor(name) }), {
    overwrite: false,
    dedupeName: true,
    createMissingParents: true,
  });
  try {
    // La copie sur l'appareil peut être refusée : le fichier de l'application
    // reste en place dans tous les cas.
    await saveDeviceFile({ name: item.name, bytes, mime: mimeFor(item.name) });
  } catch {
    /* annulé par l'utilisateur */
  }
  return { path: item.path, name: item.name, uid: item.uid, modified: item.modified };
}

/** Un sélecteur de dossier : l'assemblage natif ne l'expose pas encore. */
async function showDirectoryPicker() {
  return { path: APP_ROOT, name: 'nemesisworkspace', is_dir: true };
}

let closeHandler = null;

const uiApi = {
  showOpenFilePicker,
  showSaveFilePicker,
  showDirectoryPicker,
  /** Recherche : les écrans qui l'utilisent reçoivent une liste vide. */
  async search() {
    return [];
  },
  /** Titre de fenêtre : ignoré en WebView, suivi par l'assemblage natif plus tard. */
  setWindowTitle() {},
  onWindowClose(handler) {
    closeHandler = handler;
  },
  onLaunchedWithItems() {},
  /** Notification discrète : déléguée à l'interface de l'application si elle existe. */
  async alert(title, message) {
    const api = globalThis.NemesisUI;
    if (api?.alert) return api.alert(title, message);
    console.info(`[Nemesis] ${title}\n${message}`);
    return true;
  },
  async share({ title, text, url } = {}) {
    if (navigator.share) {
      try {
        await navigator.share({ title, text, url: url || location.href });
        return true;
      } catch {
        return false;
      }
    }
    if (url) openExternal(url);
    return false;
  },
};

/* ================================================================== */
/* 7. Profil local (auth) — aucun compte, aucun réseau                 */
/* ================================================================== */

const LOCAL_USER = { username: 'local', uuid: 'nemesis-local', email: '', is_local: true };

const authApi = {
  async isSignedIn() {
    return true;
  },
  async getUser() {
    return { ...LOCAL_USER };
  },
  async signIn() {
    return { ...LOCAL_USER };
  },
  async signOut() {
    // Rien à fermer : le profil local est toujours là.
    return true;
  },
  onAuth() {},
  onSignIn() {},
  onSignOut() {},
};

/* ================================================================== */
/* 8. IA — votre fournisseur, configuré dans Paramètres                 */
/* ================================================================== */

const aiApi = {
  async chat(prompt, options) {
    return aiChat(prompt, options);
  },
  async txt2img() {
    throw new Error(
      "Ce fournisseur ne génère pas d'image depuis NemesisWorkspace. Choisissez une image sur l'appareil pour ce placement.",
    );
  },
  async txt2speech() {
    throw new Error("La synthèse vocale n'est pas activée.");
  },
  canChat() {
    return aiIsConfigured(getAiConfig());
  },
};

/* ================================================================== */
/* 9. Simulateurs de services serveur                                  */
/* ================================================================== */

const offline = (what) => ({
  async exec() {
    throw new Error(`${what} demande un serveur : cette fonction n'est pas disponible en mode hors ligne.`);
  },
  async create() {
    throw new Error(`${what} demande un serveur : cette fonction n'est pas disponible en mode hors ligne.`);
  },
  async list() {
    return [];
  },
});

const workersApi = offline('La collaboration');
const shareApi = {
  async withSelf() {
    throw new Error('Le partage demande un serveur : NemesisWorkspace fonctionne hors ligne.');
  },
  async whoIsSignedIn() {
    return { username: 'local' };
  },
};

const emailApi = {
  async send() {
    throw new Error("L'envoi d'e-mails n'est pas configuré dans cette version.");
  },
  async sendTransactional() {
    throw new Error("L'envoi d'e-mails n'est pas configuré dans cette version.");
  },
};

const hostingApi = {
  async create() {
    throw new Error("La publication en ligne n'est pas disponible hors ligne.");
  },
  async update() {
    throw new Error("La publication en ligne n'est pas disponible hors ligne.");
  },
  async delete() {
    return true;
  },
};

/* ================================================================== */
/* 10. L'objet puter                                                   */
/* ================================================================== */

export const nemesisLocalSdk = {
  /** Un profil local, jamais un compte distant. */
  env: 'web',
  authToken: 'nemesis-local',
  appID: 'nemesisworkspace',
  fs: fsApi,
  kv: kvApi,
  ui: uiApi,
  auth: authApi,
  ai: aiApi,
  workers: workersApi,
  share: shareApi,
  email: emailApi,
  hosting: hostingApi,
  print() {
    globalThis.print?.();
  },
  /** Fermer : retour à l'accueil de l'espace de travail. */
  exit() {
    if (!isNative()) location.hash = '';
  },
  /** Jamais de fenêtre de connexion. */
  async signIn() {
    return authApi.signIn();
  },
  async signOut() {
    return true;
  },
  onAuth: null,
  isLocal: true,
};

/** Installer le SDK local (si aucun autre SDK n'est déjà présent). */
export function installLocalSdk({ force = false } = {}) {
  if (typeof window === 'undefined') return nemesisLocalSdk;
  if (force || typeof window.puter === 'undefined') window.puter = nemesisLocalSdk;
  return window.puter;
}

/**
 * Une seule copie du SDK par page : si ce script est chargé deux fois (une
 * par un bundler, une par une balise), le premier passage gagne.
 */
if (typeof window !== 'undefined') {
  window.__nemesisLocalSdkLoaded = true;
  installLocalSdk();
}

/** Partager un fichier local par la feuille Android (utilisé par l'accueil). */
export { shareFile };
