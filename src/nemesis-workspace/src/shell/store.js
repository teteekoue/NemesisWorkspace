/**
 * NemesisWorkspace — mémoire de l'accueil.
 *
 * Deux petites choses seulement sont gardées ici, et uniquement sur
 * l'appareil :
 *
 *  - quand chaque fichier a été ouvert pour la dernière fois (pour classer
 *    les récents même si l'horodatage du système de fichiers est grossier) ;
 *  - comment l'accueil s'est présenté la dernière fois.
 *
 * Les fichiers eux-mêmes ne sont jamais copiés : leur source de vérité reste
 * le système de fichiers local, lu à chaque affichage.
 */

import { prefer, remember } from '../../../shared/prefs.js';

const KEY = 'nemesis:workspace:v1';

const DEFAULTS = {
  /** { [chemin]: horodatage en millisecondes } */
  opened: {},
  /** Le dernier document ouvert, pour la carte « Reprendre ». */
  last: null,
  /** Filtre de la liste des récents. */
  filter: 'all',
  /** La dernière application lancée, mise en avant sur l'accueil. */
  lastApp: '',
};

let cache = null;

export function loadWorkspace() {
  if (cache) return cache;
  try {
    const raw = prefer(KEY);
    cache = raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS };
  } catch {
    cache = { ...DEFAULTS };
  }
  if (typeof cache.opened !== 'object' || !cache.opened) cache.opened = {};
  return cache;
}

export function saveWorkspace(patch) {
  const next = { ...loadWorkspace(), ...patch };
  cache = next;
  try {
    remember(KEY, JSON.stringify(next));
  } catch {
    /* stockage plein ou navigation privée : l'accueil reste utilisable */
  }
  return next;
}

/** Noter qu'un fichier vient d'être ouvert depuis l'espace de travail. */
export function markOpened(file) {
  const state = loadWorkspace();
  const opened = { ...state.opened };
  // On ne garde que les 200 dernières entrées : au-delà, ce n'est plus « récent ».
  opened[file.path] = Date.now();
  const trimmed = Object.entries(opened)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 200);
  saveWorkspace({
    opened: Object.fromEntries(trimmed),
    last: { path: file.path, name: file.name, kind: file.kind, at: Date.now() },
    lastApp: file.kind,
  });
}

/** Oublier un fichier (supprimé ou renommé). */
export function markForgotten(path) {
  const state = loadWorkspace();
  const opened = { ...state.opened };
  delete opened[path];
  saveWorkspace({
    opened,
    last: state.last?.path === path ? null : state.last,
  });
}

/** La date de dernière ouverture, si elle est plus récente que le fichier. */
export function openedAt(path) {
  return Number(loadWorkspace().opened[path]) || 0;
}

/** La dernière ouverture, si le fichier existe toujours. */
export function lastOpened() {
  const state = loadWorkspace();
  if (!state.last) return null;
  return state.last;
}
