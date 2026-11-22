/**
 * NemesisWorkspace — l'onglet Paramètres.
 *
 * Trois familles de réglages, toutes facultatives sauf la première :
 *
 *   Général      apparence, langue, comportement de l'accueil
 *   Sauvegardes  copies locales automatiques, espace occupé, purge
 *   Cloud        compte facultatif (Google Drive, OneDrive, WebDAV…)
 *   IA           un fournisseur compatible OpenAI v1 : endpoint, clé, modèles
 *
 * Rien ne part sur le réseau tant que l'utilisateur n'a pas lui-même saisi un
 * endpoint ni lancé un test : l'application est locale par défaut.
 */

import { el, icon, toast, field, toggleRow, modal, humanBytes, confirmDialog } from '../ui/dom.js';
import {
  AI_PRESETS,
  CLOUD_PRESETS,
  findAiPreset,
  findCloudPreset,
  getAiConfig,
  loadConfig,
  updateConfig,
} from '../../../shared/config.js';
import { listModels, testConnection } from '../../../shared/ai.js';
import { isNative, platform, cloudConnect } from '../../../shared/bridge.js';
import { backupsUsage, clearBackups, BACKUP_ROOT } from '../backups/backups.js';

/* ------------------------------------------------------------------ */
/* Aides                                                               */
/* ------------------------------------------------------------------ */

/** Écrit un réglage avec un léger délai, pour ne pas marteler le stockage. */
let saveTimer = 0;
let pending = null;
function queueSave(patch) {
  pending = pending ? deepMerge(pending, patch) : patch;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const value = pending;
    pending = null;
    updateConfig(value);
  }, 240);
}

function deepMerge(base, patch) {
  const out = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    out[key] =
      value && typeof value === 'object' && !Array.isArray(value) && base[key] && typeof base[key] === 'object'
        ? deepMerge(base[key], value)
        : value;
  }
  return out;
}

/** Enregistre immédiatement (interrupteurs, sélections). */
const saveNow = (patch) => updateConfig(patch);

const textInput = ({ value = '', placeholder = '', type = 'text', onInput, spellcheck = false }) =>
  el('input.input', {
    type,
    value,
    placeholder,
    spellcheck,
    autocomplete: 'off',
    oninput: (event) => onInput?.(event.target.value),
  });

const numberInput = ({ value, min, max, step = 1, onInput }) =>
  el('input.input', {
    type: 'number',
    value: value ?? '',
    min,
    max,
    step,
    oninput: (event) => onInput?.(event.target.value === '' ? '' : Number(event.target.value)),
  });

function section(title, intro, ...body) {
  return el('section.settings-section', {}, el('h3', {}, title), intro ? el('p.settings-intro', {}, intro) : null, ...body);
}

function note(text, kind = '') {
  return el(`div${kind ? `.settings-note.is-${kind}` : '.settings-note'}`, {}, icon(kind === 'warn' ? 'warning' : 'info', 15), el('span', {}, text));
}

/* ------------------------------------------------------------------ */
/* Général                                                             */
/* ------------------------------------------------------------------ */

function generalPane() {
  const config = loadConfig();

  const themes = [
    { id: 'system', label: 'Système', iconName: 'monitor' },
    { id: 'light', label: 'Clair', iconName: 'sun' },
    { id: 'dark', label: 'Sombre', iconName: 'moon' },
  ];

  const themeButtons = themes.map((theme) =>
    el(
      `button.theme-tile${config.theme === theme.id ? '.is-on' : ''}`,
      {
        type: 'button',
        onclick: (event) => {
          saveNow({ theme: theme.id });
          for (const node of event.currentTarget.parentElement.children) node.classList.remove('is-on');
          event.currentTarget.classList.add('is-on');
          window.dispatchEvent(new CustomEvent('nemesis:theme', { detail: theme.id }));
        },
      },
      icon(theme.iconName, 22),
      el('span', {}, theme.label),
    ),
  );

  return el(
    'div.settings-pane',
    {},
    section('Apparence', "L'espace de travail suit le système par défaut.") ,
    el('div.theme-grid', {}, ...themeButtons),
    section(
      'Langue',
      "L'interface est en français. Les éditeurs gardent leur propre correcteur.",
    ),
    field('Langue de l’interface', el('select.select', { disabled: true }, el('option', {}, 'Français (fr)')), 'D’autres langues suivront ; les documents restent dans la langue de votre choix.'),
    section('Démarrage'),
    toggleRow({
      title: 'Ouvrir sur la dernière application utilisée',
      description: "L'accueil reste la porte d'entrée ; ce réglage ne fait que mettre sa tuile en avant.",
      checked: config.home?.preferLastApp !== false,
      onChange: (value) => saveNow({ home: { preferLastApp: value } }),
    }),
    toggleRow({
      title: 'Demander confirmation avant de supprimer',
      description: 'Un document supprimé depuis les récents part avec ses sauvegardes.',
      checked: config.home?.confirmDelete !== false,
      onChange: (value) => saveNow({ home: { confirmDelete: value } }),
    }),
  );
}

/* ------------------------------------------------------------------ */
/* Sauvegardes                                                         */
/* ------------------------------------------------------------------ */

function storagePane() {
  const config = loadConfig();
  const storage = { ...config.storage };
  const usageLine = el('div.usage-bar', {}, el('span', {}, 'Calcul de l’espace occupé…'));

  backupsUsage().then((usage) => {
    usageLine.replaceChildren(
      el('span', {}, el('strong', {}, humanBytes(usage.bytes)), el('br'), el('span.muted.small', {}, `${usage.files} version${usage.files > 1 ? 's' : ''} de sauvegarde`)),
      el(
        'button.btn.btn-sm',
        {
          type: 'button',
          onclick: async () => {
            if (!(await confirmDialog({ title: 'Vider les sauvegardes ?', message: `Toutes les versions de ${BACKUP_ROOT} seront supprimées. Les documents actuels ne sont pas touchés.`, confirmLabel: 'Vider', danger: true }))) return;
            await clearBackups();
            toast('Sauvegardes supprimées', { kind: 'ok' });
            storagePaneRefresh();
          },
        },
        icon('trash', 15),
        'Vider',
      ),
    );
  });

  const storagePaneRefresh = () => {
    backupsUsage().then((usage) => {
      usageLine.firstElementChild.innerHTML = '';
      usageLine.replaceChildren(
        el('span', {}, el('strong', {}, humanBytes(usage.bytes)), el('br'), el('span.muted.small', {}, `${usage.files} version${usage.files > 1 ? 's' : ''} de sauvegarde`)),
        el('button.btn.btn-sm', { type: 'button', disabled: true }, 'Aucune'),
      );
    });
  };

  return el(
    'div.settings-pane',
    {},
    section('Sauvegardes locales', 'Chaque enregistrement peut déposer une copie datée dans « Sauvegardes », sur cet appareil, hors de portée d’un service extérieur.'),
    toggleRow({
      title: 'Sauvegarde automatique',
      description: 'Une version datée à chaque enregistrement, selon l’intervalle ci-dessous.',
      checked: storage.autoBackup,
      onChange: (value) => saveNow({ storage: { autoBackup: value } }),
    }),
    el(
      'div.field-row',
      {},
      field(
        'Intervalle minimal (minutes)',
        numberInput({ value: storage.backupEveryMin, min: 1, max: 1440, onInput: (value) => queueSave({ storage: { backupEveryMin: value } }) }),
        'Deux enregistrements rapprochés ne créent qu’une version.',
      ),
      field(
        'Versions gardées par fichier',
        numberInput({ value: storage.keepPerFile, min: 1, max: 100, onInput: (value) => queueSave({ storage: { keepPerFile: value } }) }),
        'Les plus anciennes sont éliminées en premier.',
      ),
    ),
    section('Export', 'Une copie hors de l’application, dans le dossier Téléchargements de l’appareil.'),
    toggleRow({
      title: 'Exporter une copie à chaque enregistrement',
      description: isNative() ? 'Sur Android, la copie est déposée dans Documents/NemesisWorkspace.' : 'Dans le navigateur, un téléchargement est proposé.',
      checked: storage.exportToDevice,
      onChange: (value) => saveNow({ storage: { exportToDevice: value } }),
    }),
    usageLine,
  );
}

/* ------------------------------------------------------------------ */
/* Intelligence artificielle                                           */
/* ------------------------------------------------------------------ */

function aiPane() {
  const ai = { ...getAiConfig() };
  const models = [...(ai.models || [])];

  const statusSlot = el('div');
  const chipsSlot = el('div.model-chips');
  const modelSelect = el('select.select');
  const baseUrlInput = textInput({
    value: ai.baseUrl,
    placeholder: 'https://api.exemple.com/v1',
    onInput: (value) => queueSave({ ai: { baseUrl: value.trim(), preset: 'custom' } }),
  });
  const keyInput = el('input.input', {
    type: 'password',
    value: ai.apiKey,
    placeholder: 'sk-…',
    autocomplete: 'off',
    oninput: (event) => queueSave({ ai: { apiKey: event.target.value.trim() } }),
  });

  const paintModels = (selected) => {
    const list = [...new Set(models)];
    modelSelect.replaceChildren(
      ...(list.length ? list : [ai.model].filter(Boolean)).map((name) =>
        el('option', { value: name, selected: name === selected }, name),
      ),
      list.length ? null : el('option', { value: '', disabled: true, selected: !selected }, 'Aucun modèle pour l’instant'),
    );
    chipsSlot.replaceChildren(
      ...list.map((name) =>
        el(
          `button.model-chip${name === selected ? '.is-on' : ''}`,
          {
            type: 'button',
            title: `Choisir ${name}`,
            onclick: () => {
              selected = name;
              saveNow({ ai: { model: name } });
              paintModels(name);
            },
          },
          icon(name === selected ? 'check' : 'brain', 13),
          name,
          el(
            'span.chip-x',
            {
              role: 'button',
              'aria-label': `Retirer ${name}`,
              onclick: (event) => {
                event.stopPropagation();
                const index = models.indexOf(name);
                if (index >= 0) models.splice(index, 1);
                const next = selected === name ? models[0] || '' : selected;
                saveNow({ ai: { models, model: next } });
                paintModels(next);
              },
            },
            '×',
          ),
        ),
      ),
      el(
        'button.model-chip.add',
        {
          type: 'button',
          onclick: () => addModelDialog((name) => {
            if (!models.includes(name)) models.push(name);
            saveNow({ ai: { models, model: ai.model || name } });
            paintModels(selected || name);
          }),
        },
        icon('plus', 13),
        'Ajouter un modèle',
      ),
    );
  };

  const applyPreset = (presetId) => {
    const preset = findAiPreset(presetId);
    const nextModels = preset.models?.length ? [...preset.models] : models;
    models.splice(0, models.length, ...nextModels);
    const model = nextModels.includes(ai.model) ? ai.model : nextModels[0] || '';
    saveNow({
      ai: {
        preset: preset.id,
        baseUrl: preset.baseUrl || baseUrlInput.value.trim(),
        models: nextModels,
        model,
        supportsImages: !!preset.vision,
        thinking: !!preset.thinking,
      },
    });
    baseUrlInput.value = preset.baseUrl || baseUrlInput.value;
    paintModels(model);
    toast(`Fournisseur « ${preset.label} » sélectionné`, { kind: 'ok' });
  };

  const showStatus = (textNode, kind) => {
    statusSlot.replaceChildren(
      el('div.test-line', {}, textNode, kind === 'busy' ? el('span.spinner') : null),
    );
  };

  const fetchModels = async () => {
    showStatus(el('span.test-result', {}, 'Interrogation du fournisseur…'), 'busy');
    try {
      const found = await listModels({
        baseUrl: baseUrlInput.value.trim(),
        apiKey: keyInput.value.trim(),
      });
      if (!found.length) throw new Error('Le fournisseur n’a renvoyé aucun modèle.');
      for (const name of found) if (!models.includes(name)) models.push(name);
      const chosen = models.includes(ai.model) ? ai.model : found[0];
      saveNow({ ai: { models, model: chosen } });
      paintModels(chosen);
      showStatus(el('span.test-result.is-ok', {}, `${found.length} modèles récupérés.`));
      toast(`${found.length} modèles disponibles`, { kind: 'ok' });
    } catch (error) {
      showStatus(el('span.test-result.is-error', {}, error?.message || 'Échec de la récupération.'), 'error');
    }
  };

  const testAi = async () => {
    showStatus(el('span.test-result', {}, 'Test en cours…'), 'busy');
    try {
      const reply = await testConnection();
      showStatus(el('span.test-result.is-ok', {}, `Connexion réussie — réponse : « ${String(reply).slice(0, 40)} »`), 'ok');
      saveNow({ ai: { enabled: true } });
    } catch (error) {
      showStatus(el('span.test-result.is-error', {}, error?.message || 'Échec du test.'), 'error');
    }
  };

  paintModels(ai.model);

  const presetSelect = el(
    'select.select',
    {
      onchange: (event) => applyPreset(event.target.value),
    },
    ...AI_PRESETS.map((preset) => el('option', { value: preset.id, selected: preset.id === ai.preset }, preset.label)),
  );

  return el(
    'div.settings-pane',
    {},
    section(
      'Intelligence artificielle',
      'Facultative et entièrement à votre charge : votre clé, votre fournisseur, votre facture. Sans configuration, l’application reste parfaitement utilisable — les fonctions d’écriture assistée sont simplement masquées.',
    ),
    note(
      'Compatible OpenAI v1 : OpenAI, Groq, Mistral, OpenRouter, DeepSeek, Together, Ollama ou LM Studio sur votre réseau local, ou n’importe quel endpoint maison.',
    ),
    toggleRow({
      title: 'Activer l’assistance IA dans les éditeurs',
      description: 'Affiche « Rédiger avec l’IA » dans Documents, Tableur et Présentation.',
      checked: ai.enabled,
      onChange: (value) => saveNow({ ai: { enabled: value } }),
    }),
    field('Fournisseur', presetSelect, 'Choisir un fournisseur pré-remplit l’endpoint et ses modèles ; « Personnalisé » laisse tout libre.'),
    field(
      'Endpoint (API compatible OpenAI v1)',
      baseUrlInput,
      'L’adresse de base, sans /chat/completions. Un /v1 est ajouté automatiquement si besoin.',
    ),
    field(
      'Clé API',
      el('div.input-with-action', {}, keyInput, el('button.icon-btn', {
        type: 'button',
        title: 'Afficher ou masquer la clé',
        onclick: (event) => {
          const shown = keyInput.type === 'text';
          keyInput.type = shown ? 'password' : 'text';
          event.currentTarget.replaceChildren(icon(shown ? 'eye' : 'eyeOff', 17));
        },
      }, icon('eye', 17))),
      'Stockée uniquement sur cet appareil (localStorage). Rien n’est envoyé à NemesisWorkspace.',
    ),
    el(
      'div.test-line',
      {},
      el('button.btn.btn-sm', { type: 'button', onclick: fetchModels }, icon('refresh', 15), 'Récupérer les modèles'),
      el('button.btn.btn-sm', { type: 'button', onclick: testAi }, icon('sparkles', 15), 'Tester la connexion'),
    ),
    statusSlot,
    field('Modèle utilisé par défaut', modelSelect, models.length ? 'La liste vient du fournisseur ; vous pouvez retirer un modèle d’un clic.' : 'Récupérez la liste, ou ajoutez un modèle à la main.'),
    chipsSlot,
    section('Paramètres avancés', 'Les valeurs par défaut conviennent à la plupart des fournisseurs.'),
    el(
      'div.field-row',
      {},
      field('Fenêtre de contexte (tokens)', numberInput({ value: ai.contextTokens, min: 1024, step: 1024, onInput: (v) => queueSave({ ai: { contextTokens: v } }) }), 'Sert à tronquer les longues conversations.'),
      field('Réponse maximale (tokens)', numberInput({ value: ai.maxTokens, min: 64, step: 256, onInput: (v) => queueSave({ ai: { maxTokens: v } }) }), 'Limite la longueur de chaque réponse.'),
    ),
    field(
      'Températures',
      el('div.field-row', {},
        el('label.sub-field', {}, el('span.field-hint', {}, 'Précision ← → Créativité'), numberInput({ value: ai.temperature, min: 0, max: 2, step: 0.1, onInput: (v) => queueSave({ ai: { temperature: v } }) })),
        el('label.sub-field', {}, el('span.field-hint', {}, 'top_p (facultatif)'), numberInput({ value: ai.topP ?? '', min: 0, max: 1, step: 0.05, onInput: (v) => queueSave({ ai: { topP: v } }) })),
      ),
    ),
    toggleRow({
      title: 'Modèle de raisonnement (thinking)',
      description: 'Envoie « reasoning.effort » et affiche le raisonnement dans la réponse.',
      checked: ai.thinking,
      onChange: (value) => saveNow({ ai: { thinking: value } }),
    }),
    toggleRow({
      title: 'Le modèle accepte les images',
      description: 'Autorise l’envoi d’images de la présentation ou du document au fournisseur.',
      checked: ai.supportsImages,
      onChange: (value) => saveNow({ ai: { supportsImages: value } }),
    }),
    field(
      'Consigne système (facultative)',
      el('textarea.textarea', {
        placeholder: 'Ex. : Réponds en français, style concis, sans emphase.',
        rows: 3,
        oninput: (event) => queueSave({ ai: { systemPrompt: event.target.value } }),
      }, ai.systemPrompt || ''),
      'Ajoutée à chaque conversation, avant vos messages.',
    ),
    field(
      'En-têtes HTTP supplémentaires',
      el('textarea.textarea', {
        placeholder: 'HTTP-Referer: https://…\nX-Custom: valeur',
        rows: 2,
        spellcheck: false,
        oninput: (event) => queueSave({ ai: { extraHeaders: event.target.value } }),
      }, ai.extraHeaders || ''),
      'Une ligne par en-tête, au format « Nom: valeur ». Utile pour OpenRouter.',
    ),
  );
}

/* ------------------------------------------------------------------ */
/* Cloud facultatif                                                    */
/* ------------------------------------------------------------------ */

function cloudPane() {
  const config = loadConfig();
  const cloud = { ...config.cloud };
  const preset = findCloudPreset(cloud.provider);
  const fieldsSlot = el('div');
  const statusSlot = el('div');

  const paintFields = (providerId) => {
    const current = findCloudPreset(providerId);
    if (providerId === 'none') {
      fieldsSlot.replaceChildren(note('Aucun compte cloud : tout reste sur cet appareil. C’est le mode recommandé.'));
      return;
    }
    fieldsSlot.replaceChildren(
      note(current.hint || 'Renseignez les identifiants de votre application.', 'warn'),
      field('Adresse du service', textInput({
        value: cloud.endpoint || current.endpoint,
        placeholder: current.endpoint || 'https://…',
        onInput: (value) => queueSave({ cloud: { endpoint: value.trim() } }),
      })),
      field('Compte (adresse e-mail)', textInput({
        value: cloud.account,
        placeholder: 'vous@exemple.com',
        onInput: (value) => queueSave({ cloud: { account: value.trim() } }),
      })),
      field('Identifiant client OAuth', textInput({
        value: cloud.clientId,
        placeholder: 'xxxx.apps.googleusercontent.com',
        onInput: (value) => queueSave({ cloud: { clientId: value.trim() } }),
      }), 'Créé chez le fournisseur (Google Cloud Console, Azure, Dropbox…).'),
      field('Dossier distant', textInput({
        value: cloud.folder,
        placeholder: 'NemesisWorkspace',
        onInput: (value) => queueSave({ cloud: { folder: value.trim() } }),
      })),
      toggleRow({
        title: 'Synchroniser après chaque enregistrement',
        description: 'Envoie la nouvelle version vers le dossier distant.',
        checked: cloud.autoSync,
        onChange: (value) => saveNow({ cloud: { autoSync: value } }),
      }),
      el(
        'div.test-line',
        {},
        el('button.btn.btn-sm', {
          type: 'button',
          onclick: async () => {
            statusSlot.replaceChildren(el('div.test-line', {}, el('span.test-result', {}, 'Ouverture de l’autorisation…'), el('span.spinner')));
            try {
              const result = await cloudConnect({ provider: providerId, endpoint: cloud.endpoint, clientId: cloud.clientId });
              updateConfig({ cloud: { token: result?.token || '', account: result?.account || cloud.account } });
              statusSlot.replaceChildren(el('div.test-line', {}, el('span.test-result.is-ok', {}, 'Compte connecté.')));
            } catch (error) {
              statusSlot.replaceChildren(el('div.test-line', {}, el('span.test-result.is-error', {}, error.message)));
            }
          },
        }, icon('cloud', 15), 'Connecter le compte'),
        cloud.token ? el('span.status-pill.is-ok', {}, el('span.status-dot'), 'Connecté') : null,
      ),
      statusSlot,
    );
  };

  paintFields(cloud.provider);

  return el(
    'div.settings-pane',
    {},
    section(
      'Compte cloud (facultatif)',
      'Une roue de secours, pas une dépendance : NemesisWorkspace fonctionne sans aucun compte. Si vous en ajoutez un, les fichiers y sont copiés en plus de rester ici — « au cas où ».',
    ),
    field(
      'Fournisseur',
      el('select.select', {
        onchange: (event) => {
          const providerId = event.target.value;
          cloud.provider = providerId;
          saveNow({ cloud: { provider: providerId, endpoint: findCloudPreset(providerId).endpoint } });
          paintFields(providerId);
        },
      }, ...CLOUD_PRESETS.map((item) => el('option', { value: item.id, selected: item.id === cloud.provider }, item.label))),
    ),
    fieldsSlot,
    section('Sauvegarde hors appareil', 'Pour ne rien perdre en cas de perte du téléphone, sans compte cloud.'),
    el('p.settings-intro', {}, 'L’accueil permet d’exporter n’importe quel document — ou l’intégralité de l’espace de travail — vers le stockage de l’appareil, une carte SD ou une clé USB.'),
  );
}

/* ------------------------------------------------------------------ */
/* À propos                                                            */
/* ------------------------------------------------------------------ */

function aboutPane() {
  return el(
    'div.settings-pane',
    {},
    section('NemesisWorkspace', 'Une suite bureautique qui vous appartient.'),
    el(
      'div.about-grid',
      {},
      el('div.about-hero', {},
        el('img.about-logo', { src: './brand/nemesisworkspace-logo.png', alt: 'Logo NemesisWorkspace' }),
        el('div', {},
          el('strong', {}, 'NemesisWorkspace'),
          el('p.muted.small', {}, 'Documents · Tableur · Présentation'),
          el('p.muted.small', {}, 'Version 1.0.0 — local-first'),
        ),
      ),
      el('div', {},
        el('p.settings-intro', {}, 'Vos fichiers restent sur votre appareil, dans le stockage interne de l’application. Aucun compte, aucun serveur, aucune télémétrie.'),
        el('div.foot-badges', {},
          el('span.foot-badge', {}, icon('shield', 12), '100 % local'),
          el('span.foot-badge', {}, icon('database', 12), 'IndexedDB'),
          el('span.foot-badge', {}, icon('key', 12), 'IA à votre clé'),
        ),
      ),
    ),
    section('Environnement'),
    el('p.settings-intro.mono', {}, `Plateforme : ${platform()}${isNative() ? ' (natif)' : ' (web)'}`),
    section('Licences'),
    el('p.settings-intro', {}, 'Cette suite reprend les éditeurs de l’écosystème Puter, sous AGPL-3.0. Le code de NemesisWorkspace reste ouvert : toute redistribution doit conserver la même licence.'),
  );
}

/* ------------------------------------------------------------------ */
/* Fenêtre                                                             */
/* ------------------------------------------------------------------ */

const TABS = [
  { id: 'general', label: 'Général', iconName: 'monitor', pane: generalPane },
  { id: 'storage', label: 'Sauvegardes', iconName: 'database', pane: storagePane },
  { id: 'ai', label: 'Intelligence artificielle', iconName: 'sparkles', pane: aiPane },
  { id: 'cloud', label: 'Compte cloud', iconName: 'cloud', pane: cloudPane },
  { id: 'about', label: 'À propos', iconName: 'info', pane: aboutPane },
];

/** Ouvrir les paramètres, éventuellement sur un onglet précis. */
export function openSettings({ tab = 'general' } = {}) {
  const paneHost = el('div');
  const nav = el('div.settings-nav', { role: 'tablist' });

  const show = (id) => {
    const entry = TABS.find((item) => item.id === id) || TABS[0];
    for (const button of nav.children) button.classList.toggle('is-on', button.dataset.tab === entry.id);
    paneHost.replaceChildren(entry.pane());
  };

  for (const entry of TABS) {
    nav.append(
      el(
        'button',
        { type: 'button', role: 'tab', dataset: { tab: entry.id }, onclick: () => show(entry.id) },
        icon(entry.iconName, 16),
        entry.label,
      ),
    );
  }

  modal({
    title: 'Paramètres',
    subtitle: 'Tout est facultatif — sauf ce que vous voulez bien activer.',
    wide: true,
    render: () => {
      show(tab);
      return el('div.settings', {}, nav, paneHost);
    },
  });
}

/** Le petit dialogue « ajouter un modèle ». */
function addModelDialog(onAdd) {
  const input = el('input.input', { placeholder: 'nom-du-modele', spellcheck: false });
  const form = el(
    'form',
    {
      onsubmit: (event) => {
        event.preventDefault();
        const name = input.value.trim();
        if (!name) return;
        onAdd(name);
        dialog.close();
      },
    },
    field('Identifiant du modèle', input, 'Exactement comme le fournisseur l’écrit, par exemple gpt-4.1-mini.'),
    el('div.modal-actions', {},
      el('button.btn', { type: 'button', onclick: () => dialog.close() }, 'Annuler'),
      el('button.btn.btn-primary', { type: 'submit' }, 'Ajouter'),
    ),
  );
  const dialog = modal({ title: 'Ajouter un modèle', render: () => form });
  return dialog;
}
