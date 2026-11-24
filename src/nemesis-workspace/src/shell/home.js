/**
 * NemesisWorkspace — l'accueil.
 *
 * C'est l'écran que l'on voit en ouvrant l'application : le mur, la marque, et
 * trois portes d'entrée vers les éditeurs. En dessous, ce que l'on a fait
 * récemment ; à droite, les sauvegardes locales — parce qu'un logiciel de
 * bureau doit dire lui-même où sont les copies de secours.
 */

import { el, icon, toast, modal, humanBytes, confirmDialog } from '../ui/dom.js';
import {
  FOLDERS,
  listAllFiles,
  kindOf,
  editorHomeUrl,
  formatDate,
  formatSize,
  workspaceStatus,
} from './workspace.js';
import { openFile, openApp, importFiles, exportFile, shareFileTo, duplicateFile, renameFile, deleteFile, saveVersion, ACCEPT } from './files.js';
import { loadWorkspace, markOpened, saveWorkspace, openedAt } from './store.js';
import { listBackups, backupsUsage, restoreBackup, exportVersion, BACKUP_ROOT } from '../backups/backups.js';
import { openSettings } from '../settings/settings.js';
import { getAiConfig, aiIsConfigured, loadConfig } from '../../../shared/config.js';
import { remember } from '../../../shared/prefs.js';

/* ------------------------------------------------------------------ */
/* Description des applications                                        */
/* ------------------------------------------------------------------ */

const APPS = [
  {
    kind: 'documents',
    name: 'Documents',
    tagline: 'Traitement de texte',
    formats: '.docx · .dotx',
    description: 'Rapports, lettres, mémoires. Une mise en page complète, des styles, des tables et des images — dans un vrai fichier Word.',
    icon: './brand/icon-documents.png',
    verb: 'Écrire',
  },
  {
    kind: 'spreadsheet',
    name: 'Tableur',
    tagline: 'Feuilles de calcul',
    formats: '.xlsx · .csv',
    description: 'Budgets, listes, analyses. Formules, graphiques et tableaux croisés, avec la compatibilité Excel.',
    icon: './brand/icon-spreadsheet.png',
    verb: 'Calculer',
  },
  {
    kind: 'presentation',
    name: 'Présentation',
    tagline: 'Diapositives',
    formats: '.pptx · .ppsx',
    description: 'Exposés, réunions, cours. Des diapositives soignées, des thèmes, des transitions — au format PowerPoint.',
    icon: './brand/icon-presentation.png',
    verb: 'Présenter',
  },
];

const FILTERS = [
  { id: 'all', label: 'Tout' },
  { id: 'documents', label: 'Documents' },
  { id: 'spreadsheet', label: 'Tableur' },
  { id: 'presentation', label: 'Présentation' },
];

/* ------------------------------------------------------------------ */
/* État de l'écran                                                     */
/* ------------------------------------------------------------------ */

const state = {
  files: [],
  loading: true,
  filter: loadWorkspace().filter || 'all',
  query: '',
  sort: 'recent',
};

/** Les fichiers, avec la date d'ouverture locale quand elle est plus récente. */
function decorate(files) {
  return files.map((file) => {
    const opened = openedAt(file.path);
    return { ...file, opened, modified: Math.max(file.modified || 0, Math.floor(opened / 1000)) };
  });
}

/* ------------------------------------------------------------------ */
/* Fragments                                                           */
/* ------------------------------------------------------------------ */

function iconFor(kind, size = 20) {
  return icon(kind === 'spreadsheet' ? 'sheet' : kind === 'presentation' ? 'slide' : 'doc', size);
}

function appCard(app, counts) {
  const count = counts[app.kind] || 0;
  return el(
    `button.app-card.is-${app.kind}`,
    {
      type: 'button',
      onclick: () => openApp(app.kind),
      title: `Ouvrir ${app.name}`,
    },
    el(
      'div.app-top',
      {},
      el('img.app-icon', { src: app.icon, alt: '' }),
      el(
        'div.app-heading',
        {},
        el('div.app-name', {}, app.name),
        el('div.app-kind', {}, `${app.tagline} · ${app.formats}`),
      ),
    ),
    el('p.app-desc', {}, app.description),
    el(
      'div.app-foot',
      {},
      el(
        'span.app-count',
        {},
        icon('layers', 14),
        count ? `${count} fichier${count > 1 ? 's' : ''}` : 'Aucun fichier',
      ),
      el('span.app-open', {}, app.verb, icon('chevron', 14)),
    ),
  );
}

function fileRow(file) {
  const row = el(
    'button.file-row',
    {
      type: 'button',
      onclick: () => openFile(file),
      title: `Ouvrir « ${file.name} »`,
    },
    el(`span.file-glyph.is-${file.kind}`, {}, iconFor(file.kind, 18)),
    el(
      'span.file-copy',
      {},
      el('span.file-name', {}, file.name),
      el(
        'span.file-meta',
        {},
        el('span', {}, appName(file.kind)),
        el('span.dot-sep'),
        el('span', {}, file.modified ? `Modifié ${formatDate(file.modified).toLowerCase()}` : 'Date inconnue'),
        el('span.dot-sep'),
        el('span', {}, formatSize(file.size)),
      ),
    ),
  );

  const action = (name, label, handler, danger) => {
    const button = el(
      `button.icon-btn${danger ? '.is-danger' : ''}`,
      {
        type: 'button',
        title: label,
        'aria-label': label,
        onclick: (event) => {
          event.stopPropagation();
          Promise.resolve(handler()).catch((error) => toast(error?.message || 'Action impossible', { kind: 'error' }));
        },
      },
      icon(name, 16),
    );
    return button;
  };

  row.append(
    el(
      'span.file-actions',
      {},
      action('clock', 'Versions de sauvegarde', () => openVersions(file)),
      action('edit', 'Renommer', () => renameDialog(file)),
      action('copy', 'Dupliquer', () => duplicateFile(file).then(() => refresh())),
      action('download', 'Exporter', () => exportFile(file)),
      action('share', 'Partager', () => shareFileTo(file)),
      action('trash', 'Supprimer', async () => {
        const removed = await deleteFile(file);
        if (removed) refresh();
      }, true),
    ),
  );
  return row;
}

const appName = (kind) => (kind === 'documents' ? 'Documents' : kind === 'spreadsheet' ? 'Tableur' : 'Présentation');

/* ------------------------------------------------------------------ */
/* Vues secondaires                                                    */
/* ------------------------------------------------------------------ */

/** Les versions de sauvegarde d'un document. */
export async function openVersions(file) {
  const listHost = el('div.backup-list');
  const dialog = modal({
    title: `Versions de « ${file.name} »`,
    subtitle: 'Copies enregistrées sur cet appareil. Restaurer remplace le document actuel.',
    wide: false,
    render: () => listHost,
  });

  const paint = async () => {
    const versions = await listBackups(file.path);
    if (!versions.length) {
      listHost.replaceChildren(
        el(
          'div.empty-state',
          {},
          icon('clock', 26),
          el('strong', {}, 'Aucune version pour l’instant'),
          el('p', {}, `Une copie est déposée automatiquement à chaque enregistrement, au plus une toutes les ${loadConfig().storage.backupEveryMin} minutes.`),
          el(
            'button.btn.btn-sm',
            {
              type: 'button',
              onclick: async () => {
                await saveVersion(file);
                paint();
              },
            },
            icon('plus', 15),
            'Créer une version maintenant',
          ),
        ),
      );
      return;
    }
    listHost.replaceChildren(
      ...versions.map((version) =>
        el(
          'div.backup-row',
          {},
          icon('clock', 15),
          el('span.backup-when', {}, version.name),
          el('span.backup-size', {}, formatSize(version.size)),
          el(
            'button.btn.btn-sm',
            {
              type: 'button',
              onclick: async (event) => {
                const button = event.currentTarget;
                button.disabled = true;
                try {
                  await restoreBackup(version.path, file.path);
                  toast(`Version restaurée dans « ${file.name} »`, { kind: 'ok' });
                  await maybeSnapshot(file);
                  paint();
                  refresh();
                } catch (error) {
                  toast(error.message, { kind: 'error' });
                } finally {
                  button.disabled = false;
                }
              },
            },
            'Restaurer',
          ),
          el(
            'button.icon-btn',
            {
              type: 'button',
              title: 'Exporter cette version',
              onclick: () => exportVersion(version.path, `${version.name}`).catch((error) => toast(error.message, { kind: 'error' })),
            },
            icon('download', 15),
          ),
        ),
      ),
      el(
        'div.test-line',
        { style: { marginTop: '12px' } },
        el(
          'button.btn.btn-sm',
          { type: 'button', onclick: async () => { await saveVersion(file); paint(); } },
          icon('plus', 15),
          'Créer une version',
        ),
      ),
    );
  };

  // Avant de restaurer, on garde l'état actuel : rien ne doit être perdu.
  const maybeSnapshot = async () => {
    try {
      await saveVersion(file);
    } catch {
      /* la restauration a réussi, c'est l'essentiel */
    }
  };

  await paint();
  return dialog;
}

function renameDialog(file) {
  const input = el('input.input', { value: file.name.replace(/\.[^.]+$/, ''), spellcheck: false });
  const dialog = modal({
    title: 'Renommer',
    render: (close) =>
      el(
        'form',
        {
          onsubmit: async (event) => {
            event.preventDefault();
            try {
              await renameFile(file, input.value);
              close();
              refresh();
            } catch (error) {
              toast(error.message, { kind: 'error' });
            }
          },
        },
        el('label.field', {}, el('span.field-label', {}, 'Nouveau nom'), input),
        el(
          'div.modal-actions',
          {},
          el('button.btn', { type: 'button', onclick: () => close() }, 'Annuler'),
          el('button.btn.btn-primary', { type: 'submit' }, 'Renommer'),
        ),
      ),
  });
  setTimeout(() => input.select(), 80);
  return dialog;
}

/** Choisir quoi importer, puis où. */
function importDialog() {
  const dialog = modal({
    title: 'Importer un fichier',
    subtitle: 'Depuis cet appareil (téléchargements, carte SD, clé USB).',
    render: (close) =>
      el(
        'div.import-grid',
        {},
        ...APPS.map((app) =>
          el(
            'button.import-choice',
            {
              type: 'button',
              onclick: async () => {
                close();
                try {
                  const imported = await importFiles(app.kind);
                  refresh();
                  if (imported.length === 1) openFile(imported[0]);
                } catch (error) {
                  toast(error?.message || 'Import impossible', { kind: 'error' });
                }
              },
            },
            el('img', { src: app.icon, alt: '' }),
            el('span', {}, `Vers ${app.name}`),
            el('small', {}, ACCEPT[app.kind]),
          ),
        ),
      ),
  });
  return dialog;
}

/* ------------------------------------------------------------------ */
/* Vue sauvegardes (panneau)                                           */
/* ------------------------------------------------------------------ */

function backupsPanel() {
  const body = el('div');
  const dialog = modal({
    title: 'Sauvegardes locales',
    subtitle: `Toutes les versions que l’application garde sur cet appareil, dans « ${BACKUP_ROOT} ».`,
    wide: true,
    render: () => body,
  });

  (async () => {
    const files = state.files;
    const usage = await backupsUsage();
    const rows = [];
    for (const file of files.slice(0, 40)) {
      const versions = await listBackups(file.path);
      if (!versions.length) continue;
      rows.push(
        el(
          'details.backup-group',
          {},
          el(
            'summary',
            {},
            iconFor(file.kind, 15),
            el('span', {}, file.name),
            el('span.muted.small', {}, `${versions.length} version${versions.length > 1 ? 's' : ''}`),
          ),
          el(
            'div.backup-list',
            {},
            ...versions.map((version) =>
              el(
                'div.backup-row',
                {},
                el('span.backup-when', {}, version.name),
                el('span.backup-size', {}, formatSize(version.size)),
                el(
                  'button.icon-btn',
                  {
                    type: 'button',
                    title: 'Exporter cette version',
                    onclick: () => exportVersion(version.path, version.name).catch((error) => toast(error.message, { kind: 'error' })),
                  },
                  icon('download', 15),
                ),
                el(
                  'button.btn.btn-sm',
                  {
                    type: 'button',
                    onclick: async () => {
                      if (!(await confirmDialog({
                        title: 'Restaurer cette version ?',
                        message: `« ${file.name} » sera remplacé par cette version. Une copie de l’état actuel est créée juste avant.`,
                        confirmLabel: 'Restaurer',
                      }))) return;
                      try {
                        await saveVersion(file);
                        await restoreBackup(version.path, file.path);
                        toast('Version restaurée', { kind: 'ok' });
                        dialog.close();
                        refresh();
                      } catch (error) {
                        toast(error.message, { kind: 'error' });
                      }
                    },
                  },
                  'Restaurer',
                ),
              ),
            ),
          ),
        ),
      );
    }

    body.replaceChildren(
      el(
        'div.usage-bar',
        {},
        el('span', {}, el('strong', {}, humanBytes(usage.bytes)), el('br'), el('span.muted.small', {}, `${usage.files} version${usage.files > 1 ? 's' : ''} au total`)),
        el(
          'button.btn.btn-sm',
          { type: 'button', onclick: () => openSettings({ tab: 'storage' }) },
          icon('gear', 15),
          'Régler les sauvegardes',
        ),
      ),
      rows.length
        ? el('div.backup-groups', {}, ...rows)
        : el(
            'div.empty-state',
            {},
            icon('shield', 28),
            el('strong', {}, 'Aucune sauvegarde pour l’instant'),
            el('p', {}, 'Les versions apparaissent dès le premier enregistrement, ou quand vous créez une version à la main depuis les récents.'),
          ),
    );
  })().catch((error) => {
    body.replaceChildren(el('p.modal-text', {}, error.message));
  });

  return dialog;
}

/* ------------------------------------------------------------------ */
/* Rendu principal                                                     */
/* ------------------------------------------------------------------ */

let mounts = {};

function countsByKind(files) {
  const counts = { documents: 0, spreadsheet: 0, presentation: 0 };
  for (const file of files) counts[file.kind] = (counts[file.kind] || 0) + 1;
  return counts;
}

function resumeCard(files) {
  const last = loadWorkspace().last;
  if (!last) return null;
  const file = files.find((item) => item.path === last.path);
  if (!file) return null;
  return el(
    'button.resume-card',
    { type: 'button', onclick: () => openFile(file) },
    el(`div.resume-glyph.file-glyph.is-${file.kind}`, {}, iconFor(file.kind, 20)),
    el(
      'div.resume-copy',
      {},
      el('div', { style: { fontSize: '11px', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-3)', fontWeight: '700' } }, 'Reprendre'),
      el('div.resume-title', {}, file.name),
      el('div.resume-sub', {}, `Dernière ouverture ${formatDate(openedAt(file.path)).toLowerCase()} · ${formatSize(file.size)}`),
    ),
    el('span.app-open', {}, 'Continuer', icon('chevron', 14)),
  );
}

function filesSection() {
  const filtered = state.files
    .filter((file) => state.filter === 'all' || file.kind === state.filter)
    .filter((file) => !state.query || file.name.toLowerCase().includes(state.query.toLowerCase()));

  const toolbar = el(
    'div.files-toolbar',
    {},
    el(
      'div.seg',
      { role: 'tablist', 'aria-label': 'Filtrer par application' },
      ...FILTERS.map((filter) =>
        el(
          'button',
          {
            type: 'button',
            role: 'tab',
            class: state.filter === filter.id ? 'is-on' : '',
            onclick: (event) => {
              state.filter = filter.id;
              saveWorkspace({ filter: filter.id });
              for (const button of event.currentTarget.parentElement.children) button.classList.remove('is-on');
              event.currentTarget.classList.add('is-on');
              renderFilesList();
            },
          },
          filter.label,
        ),
      ),
    ),
    el(
      'label.search-box',
      {},
      icon('search', 15),
      el('input', {
        type: 'search',
        placeholder: 'Rechercher un fichier…',
        value: state.query,
        'aria-label': 'Rechercher un fichier',
        oninput: (event) => {
          state.query = event.target.value;
          renderFilesList();
        },
      }),
    ),
    el(
      'button.btn.btn-sm',
      { type: 'button', onclick: () => importDialog() },
      icon('upload', 15),
      'Importer',
    ),
  );

  const listHost = el('div.file-list');

  function renderFilesList() {
    const inList = filtered;
    if (!inList.length) {
      listHost.replaceChildren(
        el(
          'div.empty-state',
          {},
          icon(state.query ? 'search' : 'folder', 28),
          el('strong', {}, state.query ? 'Aucun fichier ne correspond' : 'Votre espace est vide'),
          el(
            'p',
            {},
            state.query
              ? 'Essayez un autre mot, ou un autre filtre.'
              : 'Choisissez une application ci-dessus pour créer votre premier fichier, ou importez un fichier existant.',
          ),
        ),
      );
      return;
    }
    listHost.replaceChildren(...inList.slice(0, 60).map(fileRow));
  }

  renderFilesList();
  return el('section.files-panel', {}, toolbar, listHost);
}

/** Repeindre les listes après une action. */
export async function refresh() {
  const files = decorate(await listAllFiles());
  state.files = files;
  state.loading = false;
  if (mounts.appsGrid) mounts.appsGrid.replaceChildren(...APPS.map((app) => appCard(app, countsByKind(files))));
  if (mounts.filesHost) mounts.filesHost.replaceChildren(filesSection());
  if (mounts.resumeHost) {
    const card = resumeCard(files);
    mounts.resumeHost.replaceChildren(...(card ? [card] : []));
  }
}

/* ------------------------------------------------------------------ */
/* La coque                                                            */
/* ------------------------------------------------------------------ */

export function mountHome(root) {
  const status = workspaceStatus();
  const ai = getAiConfig();

  const appsGrid = el('div.apps-grid');
  const filesHost = el('div');
  const resumeHost = el('div');

  mounts = { appsGrid, filesHost, resumeHost };

  /* ---------- barre du haut ---------- */

  const themeToggle = el(
    'button.icon-btn',
    {
      type: 'button',
      title: 'Changer de thème',
      'aria-label': 'Changer de thème',
      onclick: () => {
        const current = document.documentElement.dataset.theme;
        const next = current === 'dark' ? 'light' : 'dark';
        document.documentElement.dataset.theme = next;
        remember('nemesis:theme', next);
      },
    },
    icon(document.documentElement.dataset.theme === 'dark' ? 'sun' : 'moon', 18),
  );

  const topbar = el(
    'header.topbar',
    {},
    el(
      'div.brand',
      {},
      el('img.brand-mark', { src: './brand/nemesisworkspace-logo.png', alt: '' }),
      el('div.brand-copy', {}, el('span.brand-name', {}, 'NemesisWorkspace'), el('span.brand-sub', {}, 'Suite bureautique locale')),
    ),
    el('div.topbar-spacer'),
    el(
      'div.topbar-actions',
      {},
      el(
        `span.status-pill${status.offline ? '.is-warn' : '.is-ok'}`,
        { title: status.offline ? 'Hors ligne : tout continue de fonctionner' : 'Aucune connexion requise' },
        el('span.status-dot'),
        el('span.status-label', {}, status.offline ? 'Hors ligne' : 'Local'),
      ),
      el(
        `span.status-pill${aiIsConfigured(ai) ? '.is-ok' : '.is-off'}`,
        {
          title: aiIsConfigured(ai) ? `IA : ${ai.model}` : 'Aucune IA configurée — Paramètres pour en ajouter une',
          role: 'button',
          tabindex: '0',
          style: { cursor: 'pointer' },
          onclick: () => openSettings({ tab: 'ai' }),
        },
        icon('sparkles', 13),
        el('span.status-label', {}, aiIsConfigured(ai) ? ai.model : 'IA'),
      ),
      el(
        `span.status-pill${status.cloudConnected ? '.is-ok' : '.is-off'}`,
        {
          title: status.cloudConnected ? 'Compte cloud connecté' : 'Aucun compte cloud — Paramètres pour en ajouter un',
          role: 'button',
          tabindex: '0',
          style: { cursor: 'pointer' },
          onclick: () => openSettings({ tab: 'cloud' }),
        },
        icon('cloud', 13),
        el('span.status-label', {}, status.cloudConnected ? 'Cloud' : 'Local'),
      ),
      themeToggle,
      el(
        'button.icon-btn',
        { type: 'button', title: 'Sauvegardes', 'aria-label': 'Sauvegardes', onclick: () => backupsPanel() },
        icon('shield', 18),
      ),
      el(
        'button.icon-btn',
        { type: 'button', title: 'Paramètres', 'aria-label': 'Paramètres', onclick: () => openSettings() },
        icon('gear', 18),
      ),
    ),
  );

  /* ---------- héro ---------- */

  const hero = el(
    'section.hero',
    {},
    el(
      'div.hero-copy',
      {},
      el('span.hero-eyebrow', {}, icon('shield', 12), '100 % sur cet appareil'),
      el('h1.hero-title', {}, 'Vos documents, ', el('span.grad', {}, 'chez vous.'),),
      el(
        'p.hero-sub',
        {},
        'Documents, tableur et présentation dans une seule application. Aucun compte, aucun serveur : vos fichiers restent sur votre téléphone, et vous choisissez librement d’y ajouter une IA ou un cloud.',
      ),
    ),
    el('div.hero-meta', {}, icon('database', 14), 'Stockage local ·', el('span', {}, 'Sauvegardes automatiques')),
  );

  /* ---------- sections ---------- */

  const appsSection = el(
    'section',
    {},
    el(
      'div.section-head',
      {},
      el('h2.section-title', {}, 'Choisir une application'),
      el(
        'button.section-link',
        { type: 'button', onclick: () => importDialog() },
        'Importer un fichier existant',
      ),
    ),
    appsGrid,
  );

  const recentHead = el(
    'div.section-head',
    { style: { marginTop: '30px' } },
    el('h2.section-title', {}, 'Fichiers récents'),
    el(
      'button.section-link',
      { type: 'button', onclick: () => backupsPanel() },
      'Voir les sauvegardes',
    ),
  );

  /* ---------- dock ---------- */

  const dock = el(
    'nav.dock',
    { 'aria-label': 'Lanceur' },
    ...APPS.map((app) =>
      el(
        'button.dock-btn',
        { type: 'button', title: app.name, onclick: () => openApp(app.kind) },
        el('img', { src: app.icon, alt: '' }),
        el('span', {}, app.name),
      ),
    ),
    el('div.dock-sep'),
    el(
      'button.dock-btn',
      { type: 'button', title: 'Importer', onclick: () => importDialog() },
      icon('upload', 24),
      el('span', {}, 'Importer'),
    ),
    el(
      'button.dock-btn',
      { type: 'button', title: 'Sauvegardes', onclick: () => backupsPanel() },
      icon('shield', 24),
      el('span', {}, 'Sauvegardes'),
    ),
    el(
      'button.dock-btn',
      { type: 'button', title: 'Paramètres', onclick: () => openSettings() },
      icon('gear', 24),
      el('span', {}, 'Réglages'),
    ),
  );

  /* ---------- pied ---------- */

  const foot = el(
    'footer.shell-foot',
    {},
    el(
      'div.foot-badges',
      {},
      el('span.foot-badge', {}, icon('shield', 12), 'Aucune donnée envoyée'),
      el('span.foot-badge', {}, icon('database', 12), 'Sauvegardes locales'),
      el('span.foot-badge', {}, icon('key', 12), 'IA facultative'),
    ),
    el('span', {}, 'NemesisWorkspace 1.0 · éditeurs sous AGPL-3.0'),
  );

  /* ---------- assemblage ---------- */

  const scroller = el(
    'div.scroll-area',
    {},
    el(
      'main.shell-main',
      {},
      hero,
      resumeHost,
      appsSection,
      recentHead,
      filesHost,
      foot,
    ),
  );

  root.replaceChildren(el('div.app-shell', {}, topbar, scroller, el('div.dock-wrap', {}, dock)));

  // Peindre tout de suite ce qui ne dépend pas du stockage…
  appsGrid.replaceChildren(...APPS.map((app) => appCard(app, {})));
  filesHost.replaceChildren(
    el(
      'div.files-panel',
      {},
      el('div.empty-state', {}, el('span.spinner'), el('strong', {}, 'Ouverture de votre espace…')),
    ),
  );

  // …puis lire le stockage local et repeindre.
  refresh().catch((error) => {
    console.warn('[Nemesis] lecture de l’espace impossible', error);
    filesHost.replaceChildren(
      el(
        'div.files-panel',
        {},
        el(
          'div.empty-state',
          {},
          icon('warning', 26),
          el('strong', {}, 'Stockage local indisponible'),
          el('p', {}, "Le stockage de l'application n'a pas pu être ouvert. Vérifiez que le navigateur autorise IndexedDB ; vos fichiers ne sont pas perdus."),
        ),
      ),
    );
  });

  // Raccourcis clavier discrets, comme un vrai logiciel de bureau.
  window.addEventListener('keydown', (event) => {
    if (event.key === 'k' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      document.querySelector('.search-box input')?.focus();
    }
    if (event.key === ',' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      openSettings();
    }
    if (event.key === 'Escape' && document.activeElement?.matches('.search-box input')) {
      document.activeElement.value = '';
      state.query = '';
      refresh();
    }
  });

  // Garder l'accueil à jour quand on revient de l'éditeur.
  window.addEventListener('pageshow', () => refresh());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refresh();
  });
  window.addEventListener('focus', () => refresh());

  return { refresh };
}
