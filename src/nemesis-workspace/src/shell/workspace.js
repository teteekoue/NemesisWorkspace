/**
 * NemesisWorkspace — l'état de l'espace de travail.
 *
 * L'accueil lit les trois dossiers de l'application (Documents, Spreadsheets,
 * Presentations) que les éditeurs remplissent eux-mêmes, et en tire les
 * fichiers récents. Aucun index séparé : la source de vérité reste le
 * système de fichiers local.
 */

import { resolvePath } from '../../../shared/local-sdk.js';
import { getAiConfig, getCloudConfig, aiIsConfigured } from '../../../shared/config.js';

export const FOLDERS = {
  documents: 'Documents',
  spreadsheet: 'Spreadsheets',
  presentation: 'Presentations',
};

const EMPTY = { name: '', path: '', kind: '', size: 0, modified: 0, uid: '' };

const describe = (folder) => {
  const match = folder.match(/^(Documents|Spreadsheets|Presentations)$/);
  return match ? match[1] : folder.replace(/\/+$/, '').split('/').pop();
};

/** Tous les fichiers des trois dossiers, du plus récent au plus ancien. */
export async function listAllFiles() {
  const fs = window.puter?.fs;
  if (!fs) return [];
  const seen = new Map();
  for (const [kind, folder] of Object.entries(FOLDERS)) {
    let items = [];
    try {
      items = await fs.readdir(folder);
    } catch {
      continue;
    }
    for (const item of items) {
      if (item.is_dir) continue;
      if (!/\.(docx|dotx|docm|xlsx|xlsm|csv|pptx|ppsx)$/i.test(item.name)) continue;
      const path = item.path || `${folder}/${item.name}`;
      if (seen.has(path)) continue;
      seen.set(path, {
        ...EMPTY,
        name: item.name,
        path,
        kind,
        size: Number(item.size) || 0,
        modified: Number(item.modified || item.created) || 0,
        uid: item.uid || '',
      });
    }
  }
  return [...seen.values()].sort((a, b) => b.modified - a.modified);
}

/** L'extension seule, pour les libellés et les icônes. */
export function extensionOf(name) {
  return String(name || '').toLowerCase().split('.').pop() || '';
}

/** Le type d'éditeur qui sait ouvrir un fichier, d'après son extension. */
export function kindOf(name) {
  const ext = extensionOf(name);
  if (['docx', 'dotx', 'docm'].includes(ext)) return 'documents';
  if (['xlsx', 'xlsm', 'csv', 'ods', 'tsv'].includes(ext)) return 'spreadsheet';
  if (['pptx', 'ppsx', 'odp'].includes(ext)) return 'presentation';
  return '';
}

/** Adresse de l'éditeur qui ouvre ce fichier, dans son propre dossier. */
export function editorUrlFor(kind, path) {
  const file = path ? encodeURIComponent(path) : '';
  if (kind === 'documents') return `../documents/index.html#/edit/${file}`;
  if (kind === 'spreadsheet') return `../spreadsheet/index.html#/edit/${file}`;
  // Presentation n'a pas de route par fichier : il ouvre le fichier nommé
  // dans « ?open= » au démarrage, puis nettoie son adresse.
  if (kind === 'presentation') return `../presentation/index.html?open=${file}`;
  return '';
}

export function editorHomeUrl(kind) {
  if (kind === 'documents') return '../documents/index.html#/home';
  if (kind === 'spreadsheet') return '../spreadsheet/index.html#/home';
  if (kind === 'presentation') return '../presentation/index.html#/home';
  return '';
}

/** Ce que la barre de statut affiche : l'état réel des services configurés. */
export function workspaceStatus() {
  const ai = getAiConfig();
  const cloud = getCloudConfig();
  return {
    aiConfigured: aiIsConfigured(ai),
    aiLabel: ai.model || '',
    cloudConnected: cloud.provider !== 'none' && !!cloud.token,
    cloudProvider: cloud.provider,
    offline: !navigator.onLine,
  };
}

/** Date courte et lisible. */
export function formatDate(value) {
  const ms = Number(value) > 1e12 ? Number(value) : Number(value) * 1000;
  if (!ms) return '';
  const date = new Date(ms);
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  if (sameDay) return `Aujourd'hui, ${date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return 'Hier';
  return date.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: date.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
}

/** Taille lisible. */
export function formatSize(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} o`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(0)} Ko`;
  return `${(value / (1024 * 1024)).toFixed(1)} Mo`;
}

/** Le libellé d'un dossier pour l'interface. */
export const folderLabel = (folder) => describe(folder);
