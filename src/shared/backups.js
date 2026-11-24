/**
 * NemesisWorkspace — sauvegardes locales des documents.
 *
 * Les fichiers vivent déjà dans le stockage de l'application (IndexedDB, sous
 * la forme que les éditeurs connaissent). En plus de cela, chaque
 * enregistrement dépose une copie datée dans « Sauvegardes/<nom>/ », et
 * l'utilisateur peut restaurer ou exporter n'importe quelle version.
 *
 * Ce module est partagé : le SDK local l'appelle à chaque écriture, et
 * l'accueil le réutilise pour la liste des versions. Tout se passe sur place —
 * aucun service, aucun compte.
 */

import { mimeFor, resolvePath } from './local-sdk.js';
import { saveDeviceFile } from './bridge.js';
import { getStorageConfig } from './config.js';

export const BACKUP_ROOT = 'Sauvegardes';

/** Les dossiers dont le contenu mérite une version (les trois éditeurs). */
const BACKED_UP = /^(Documents|Spreadsheets|Presentations)\//;

/** Le chemin app-visible : « Documents/x.docx », quel que soit l'absolu fourni. */
const friendlyPath = (path) =>
  String(path)
    .replace(/\\/g, '/')
    .replace(/^\/user\/AppData\/nemesisworkspace\//, '')
    .replace(/^\/user\//, '')
    .replace(/^~\//, '')
    .replace(/^\/+/, '');

/** « Documents/Rapport.docx » → nom de dossier lisible. */
const backupFolderFor = (path) =>
  `${BACKUP_ROOT}/${friendlyPath(path).replace(/\//g, '__')}`;

const pad = (value) => String(value).padStart(2, '0');

function stamp(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}h${pad(date.getMinutes())}m${pad(date.getSeconds())}s`;
}

/**
 * Accès au système de fichiers. Le SDK peut être installé pendant que ce
 * module se charge (ils s'importent l'un l'autre) : on ne le fige jamais.
 */
const fs = () => globalThis.puter?.fs || globalThis.window?.puter?.fs;

/** Les versions conservées pour un chemin, de la plus récente à l'ancienne. */
export async function listBackups(path) {
  const folder = backupFolderFor(path);
  try {
    const items = await fs().readdir(folder);
    return items
      .filter((item) => !item.is_dir)
      .sort((a, b) => (Number(b.modified) || 0) - (Number(a.modified) || 0));
  } catch {
    return [];
  }
}

/** Le vrai chemin d'un fichier, quel que soit le chemin relatif fourni. */
/**
 * Déposer une copie de sauvegarde si la dernière version est plus vieille que
 * l'intervalle configuré. Ne lève jamais : une sauvegarde ratée ne doit pas
 * empêcher un enregistrement.
 */
export async function maybeBackup(path) {
  if (!BACKED_UP.test(friendlyPath(path))) return null;
  const settings = getStorageConfig();
  if (!settings.autoBackup) return null;
  try {
    const versions = await listBackups(path);
    const newest = versions[0];
    const intervalMs = Math.max(1, Number(settings.backupEveryMin) || 30) * 60_000;
    if (newest && Date.now() - (Number(newest.modified) || 0) * 1000 < intervalMs) return null;

    const created = await backupNow(path);
    const keep = Math.max(1, Number(settings.keepPerFile) || 10);
    const after = await listBackups(path);
    for (const stale of after.slice(keep)) await fs().delete(stale.path).catch(() => {});
    return created;
  } catch (error) {
    console.warn('[Nemesis] sauvegarde ignorée', error);
    return null;
  }
}

/** Sauvegarder tout de suite, sans attendre l'intervalle. */
export async function backupNow(path) {
  const blob = await fs().read(path);
  const name = String(path).split('/').pop();
  const folder = backupFolderFor(path);
  return fs().write(`${folder}/${stamp()} ${name}`, blob, {
    overwrite: false,
    dedupeName: true,
    createMissingParents: true,
  });
}

/** Restaurer une version : elle remplace le fichier d'origine. */
export async function restoreBackup(versionPath, targetPath) {
  const blob = await fs().read(versionPath);
  await fs().write(targetPath, blob, { overwrite: true, dedupeName: false, createMissingParents: true });
  return targetPath;
}

/** Retirer toutes les versions d'un document (quand le document disparaît). */
export async function dropBackups(path) {
  const folder = resolvePath(backupFolderFor(path));
  try {
    await fs().delete(folder, { recursive: true });
    return true;
  } catch {
    return false;
  }
}

/** Exporter une version vers l'appareil (Téléchargements sur Android). */
export async function exportVersion(versionPath, name) {
  const blob = await fs().read(versionPath);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const fileName = name || String(versionPath).split('/').pop();
  return saveDeviceFile({ name: fileName, bytes, mime: mimeFor(fileName) });
}

/** Taille totale des sauvegardes, pour l'écran Paramètres. */
export async function backupsUsage() {
  try {
    const folders = await fs().readdir(BACKUP_ROOT);
    let files = 0;
    let bytes = 0;
    for (const entry of folders) {
      if (!entry.is_dir) {
        files += 1;
        bytes += Number(entry.size) || 0;
        continue;
      }
      const inner = await fs().readdir(entry.path).catch(() => []);
      const children = inner.filter((item) => !item.is_dir);
      files += children.length;
      bytes += children.reduce((sum, item) => sum + (Number(item.size) || 0), 0);
    }
    return { files, bytes };
  } catch {
    return { files: 0, bytes: 0 };
  }
}

/** Vider le dossier des sauvegardes. */
export async function clearBackups() {
  try {
    await fs().delete(resolvePath(BACKUP_ROOT), { recursive: true });
    return true;
  } catch {
    return false;
  }
}
