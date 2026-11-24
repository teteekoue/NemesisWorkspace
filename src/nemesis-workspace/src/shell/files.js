/**
 * NemesisWorkspace — actions sur les fichiers de l'espace de travail.
 *
 * L'accueil ne réimplémente pas les éditeurs : il importe, duplique, exporte
 * et supprime les fichiers que ceux-ci ont écrits, avec les mêmes conventions
 * de chemins. Tout passe par `window.puter.fs`, c'est-à-dire le stockage local.
 */

import { pickDeviceFiles, saveDeviceFile, shareFile, isNative } from '../../../shared/bridge.js';
import { toast, confirmDialog } from '../ui/dom.js';
import { FOLDERS, kindOf, editorUrlFor } from './workspace.js';
import { markOpened, markForgotten, saveWorkspace, loadWorkspace } from './store.js';
import { maybeBackup, dropBackups, listBackups, backupNow } from '../backups/backups.js';

const fs = () => window.puter?.fs;

const MIME = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  dotx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.template',
  docm: 'application/vnd.ms-word.document.macroEnabled.12',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xlsm: 'application/vnd.ms-excel.sheet.macroEnabled.12',
  csv: 'text/csv',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  ppsx: 'application/vnd.openxmlformats-officedocument.presentationml.slideshow',
};

/** Les extensions que chaque éditeur sait ouvrir, pour le sélecteur d'import. */
export const ACCEPT = {
  documents: '.docx,.dotx,.docm',
  spreadsheet: '.xlsx,.xlsm,.csv',
  presentation: '.pptx,.ppsx',
};

const baseName = (path) => String(path || '').split('/').pop() || '';
const dirName = (path) => String(path || '').replace(/\/[^/]*$/, '');
const extOf = (name) => String(name || '').toLowerCase().split('.').pop() || '';

/** Un nom disponible dans le dossier : « Nom (1).docx », « Nom (2).docx »… */
async function freePath(folder, name) {
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const candidate = `${folder}/${attempt ? `${stem} (${attempt})${ext}` : name}`;
    try {
      await fs().stat(candidate);
    } catch {
      return candidate;
    }
  }
  return `${folder}/${stem} (${Date.now()})${ext}`;
}

/** Ouvrir le fichier dans son éditeur, en notant l'ouverture. */
export function openFile(file) {
  const url = editorUrlFor(file.kind, file.path);
  if (!url) {
    toast("Aucun éditeur ne sait ouvrir ce fichier.", { kind: 'error' });
    return;
  }
  markOpened(file);
  saveWorkspace({ lastApp: file.kind });
  location.href = url;
}

/** Lancer un éditeur sur son écran d'accueil (nouveau fichier). */
export function openApp(kind) {
  saveWorkspace({ lastApp: kind });
  location.href = kind === 'presentation' ? '../presentation/index.html#/home' : `../${kind}/index.html`;
}

/** Importer des fichiers choisis sur l'appareil dans le dossier de l'éditeur. */
export async function importFiles(kind, { accept = ACCEPT[kind] } = {}) {
  const folder = FOLDERS[kind];
  if (!folder) return [];
  const picked = await pickDeviceFiles({
    accept: accept ? accept.split(',').map((value) => value.trim()) : [],
    multiple: true,
  });
  if (!picked?.length) return [];

  const imported = [];
  for (const item of picked) {
    const name = baseName(item.name);
    const path = await freePath(folder, name);
    await fs().write(path, new Blob([item.bytes], { type: MIME[extOf(name)] || 'application/octet-stream' }), {
      overwrite: false,
      dedupeName: false,
      createMissingParents: true,
    });
    imported.push({
      name,
      path,
      kind: kindOf(name) || kind,
      size: item.bytes?.length || item.bytes?.byteLength || 0,
      modified: Math.floor(Date.now() / 1000),
    });
  }
  toast(
    imported.length === 1 ? `« ${imported[0].name} » importé` : `${imported.length} fichiers importés`,
    { kind: 'ok' },
  );
  return imported;
}

/** Exporter une copie vers l'appareil. */
export async function exportFile(file) {
  const blob = await fs().read(file.path);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  await saveDeviceFile({
    name: file.name,
    bytes,
    mime: blob.type || MIME[extOf(file.name)] || 'application/octet-stream',
  });
  toast(`« ${file.name} » exporté`, { kind: 'ok' });
}

/** Partager via le système (feuille de partage Android, ou Web Share). */
export async function shareFileTo(file) {
  const blob = await fs().read(file.path);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  await shareFile({ name: file.name, bytes, mime: blob.type || MIME[extOf(file.name)] || '' });
}

/** Dupliquer un fichier à côté de lui. */
export async function duplicateFile(file) {
  const dot = file.name.lastIndexOf('.');
  const stem = dot > 0 ? file.name.slice(0, dot) : file.name;
  const ext = dot > 0 ? file.name.slice(dot) : '';
  const copyName = `${stem} — copie${ext}`;
  const target = await freePath(FOLDERS[file.kind] || dirName(file.path), copyName);
  const blob = await fs().read(file.path);
  const written = await fs().write(target, blob, {
    overwrite: false,
    dedupeName: false,
    createMissingParents: true,
  });
  toast(`Copie créée : « ${baseName(written?.path || target)} »`, { kind: 'ok' });
  return {
    name: baseName(written?.path || target),
    path: written?.path || target,
    kind: file.kind,
  };
}

/** Renommer un fichier (en gardant son extension). */
export async function renameFile(file, nextName) {
  const ext = extOf(file.name);
  let name = String(nextName || '').trim();
  if (!name) return null;
  if (!name.toLowerCase().endsWith(`.${ext}`)) name = `${name}.${ext}`;
  if (name === file.name) return null;
  const folder = dirName(file.path);
  let target = `${folder}/${name}`;
  try {
    await fs().stat(target);
    target = await freePath(folder, name);
  } catch {
    /* libre */
  }
  await fs().rename(file.path, target);
  markForgotten(file.path);
  toast('Fichier renommé', { kind: 'ok' });
  return { ...file, name: baseName(target), path: target };
}

/** Supprimer un fichier et ses versions de sauvegarde. */
export async function deleteFile(file, { ask = true } = {}) {
  if (ask) {
    const versions = (await listBackups(file.path)).length;
    const ok = await confirmDialog({
      title: `Supprimer « ${file.name} » ?`,
      message: versions
        ? `Le document et ses ${versions} version${versions > 1 ? 's' : ''} de sauvegarde seront supprimés de cet appareil. Cette action est définitive.`
        : 'Le document sera supprimé de cet appareil. Cette action est définitive.',
      confirmLabel: 'Supprimer',
      danger: true,
    });
    if (!ok) return false;
  }
  await fs().delete(file.path, { recursive: false });
  await dropBackups(file.path);
  markForgotten(file.path);
  toast(`« ${file.name} » supprimé`, { kind: 'ok' });
  return true;
}

/** Enregistrer une version de sauvegarde tout de suite. */
export async function saveVersion(file) {
  await backupNow(file.path);
  await maybeBackup(file.path).catch(() => {});
  toast('Version de sauvegarde créée', { kind: 'ok' });
}

/** Vrai si l'appareil peut accueillir un export direct (Android). */
export const canExport = () => true;
export const exportTarget = () => (isNative() ? 'Documents/NemesisWorkspace' : 'votre dossier Téléchargements');

export { loadWorkspace };
