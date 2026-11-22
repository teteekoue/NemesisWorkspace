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
  makeProvider,
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

/**
 * L'onglet Intelligence artificielle.
 *
 * Plusieurs fournisseurs cohabitent : chacun garde son endpoint, sa clé, ses
 * modèles et ses réglages. Un seul est « actif » — celui que les trois
 * éditeurs interrogent. On peut tester un fournisseur sans le sélectionner,
 * et la clé n'est jamais affichée en entier.
 */
function aiPane() {
  const ai = loadConfig().ai;
  const providers = (ai.providers || []).map((item) => makeProvider(item));
  const editing = new Set();
  let activeId = ai.activeProvider || providers[0]?.id || '';

  const listHost = el('div.provider-list');
  const detailHost = el('div.provider-detail');
  const statusSlot = el('div');

  const save = () => {
    updateConfig({
      ai: {
        enabled: ai.enabled,
        providers: providers.map((item) => ({ ...item })),
        activeProvider: activeId,
      },
    });
  };

  const current = () => providers.find((item) => item.id === activeId) || providers[0] || null;

  /* ---- Liste à gauche, détail à droite ---- */

  function paint() {
    listHost.replaceChildren(
      ...providers.map((provider) =>
        el(
          `button.provider-row${provider.id === activeId ? '.is-active' : ''}`,
          { type: 'button', onclick: () => { activeId = provider.id; save(); paint(); } },
          el(
            'span.provider-badge',
            { class: provider.verified ? 'is-ok' : '' },
            icon(provider.verified ? 'check' : 'brain', 14),
          ),
          el(
            'span.provider-copy',
            {},
            el('strong', {}, provider.name || 'Fournisseur'),
            el('small', {}, provider.model ? `${provider.model}` : 'Aucun modèle choisi'),
          ),
          provider.id === activeId ? el('span.active-tag', {}, 'actif') : null,
        ),
      ),
      el(
        'button.provider-row.add',
        { type: 'button', onclick: () => addProvider() },
        icon('plus', 15),
        el('span.provider-copy', {}, el('strong', {}, 'Ajouter un fournisseur')),
      ),
    );
    paintDetail();
  }

  function paintDetail() {
    const provider = current();
    if (!provider) {
      detailHost.replaceChildren(
        el(
          'div.empty-state',
          {},
          icon('sparkles', 26),
          el('strong', {}, 'Aucun fournisseur pour l’instant'),
          el('p', {}, 'Ajoutez-en un : endpoint compatible OpenAI v1, clé API, modèles. Rien ne part tant que vous ne l’activez pas.'),
          el('button.btn.btn-primary.btn-sm', { type: 'button', onclick: () => addProvider() }, 'Ajouter un fournisseur'),
        ),
      );
      return;
    }
    // Les champs sont écrits dans `provider` à chaque frappe ; cette fonction
    // ne fait que consolider le nom (vide → nom par défaut) et rafraîchir.
    const confirmed = () => {
      provider.name = String(nameInput.value || '').trim() || 'Fournisseur';
      save();
      paint();
    };

    const nameInput = el('input.input', {
      value: provider.name,
      placeholder: 'Nom (ex. TokenHarbor)',
      oninput: () => { provider.name = nameInput.value; },
      onchange: confirmed,
    });

    const presetSelect = el(
      'select.select',
      {
        onchange: (event) => {
          const preset = findAiPreset(event.target.value);
          provider.preset = preset.id;
          if (preset.baseUrl) provider.baseUrl = preset.baseUrl;
          if (preset.models?.length) {
            provider.models = [...preset.models];
            provider.model = preset.models[0];
          }
          provider.supportsImages = !!preset.vision;
          provider.thinking = !!preset.thinking;
          save();
          paint();
        },
      },
      ...AI_PRESETS.map((preset) => el('option', { value: preset.id, selected: preset.id === provider.preset }, preset.label)),
    );

    const baseUrlInput = el('input.input', {
      type: 'url',
      value: provider.baseUrl,
      placeholder: 'https://exemple.com/v1',
      spellcheck: false,
      autocomplete: 'off',
      oninput: () => { provider.baseUrl = baseUrlInput.value.trim(); },
      onchange: confirmed,
    });

    const keyInput = el('input.input', {
      type: 'password',
      value: provider.apiKey,
      placeholder: 'sk-… / thk_…',
      autocomplete: 'off',
      spellcheck: false,
      oninput: () => { provider.apiKey = keyInput.value.trim(); },
      onchange: confirmed,
    });

    const modelSelect = el('select.select', {
      onchange: (event) => { provider.model = event.target.value; save(); },
    });
    const paintModels = () => {
      const list = [...new Set(provider.models || [])];
      modelSelect.replaceChildren(
        ...(list.length
          ? list.map((name) => el('option', { value: name, selected: name === provider.model }, name))
          : [el('option', { value: '', selected: !provider.model }, 'Aucun modèle — récupérez la liste')]),
      );
    };
    paintModels();

    const chips = el('div.model-chips');
    const paintChips = () => {
      chips.replaceChildren(
        ...(provider.models || []).map((name) =>
          el(
            'span.model-chip',
            {
              class: name === provider.model ? 'is-on' : '',
              role: 'button',
              tabindex: '0',
              title: `Choisir ${name}`,
              onclick: () => { provider.model = name; save(); paintChips(); paintModels(); },
            },
            icon(name === provider.model ? 'check' : 'brain', 12),
            name,
            el(
              'span.chip-x',
              {
                role: 'button',
                'aria-label': `Retirer ${name}`,
                onclick: (event) => {
                  event.stopPropagation();
                  provider.models = provider.models.filter((item) => item !== name);
                  if (provider.model === name) provider.model = provider.models[0] || '';
                  save();
                  paintChips();
                  paintModels();
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
              if (!provider.models.includes(name)) provider.models.push(name);
              provider.model = provider.model || name;
              save();
              paintChips();
              paintModels();
            }),
          },
          icon('plus', 12),
          'Ajouter',
        ),
      );
    };
    paintChips();

    const testLine = el('div.test-line');
    const fetchModels = async (button) => {
      button.disabled = true;
      testLine.replaceChildren(el('span.test-result', {}, 'Interrogation du fournisseur…'), el('span.spinner'));
      try {
        const found = await listModels({ baseUrl: provider.baseUrl, apiKey: provider.apiKey, extraHeaders: provider.extraHeaders });
        if (!found.length) throw new Error('Le fournisseur n’a renvoyé aucun modèle.');
        provider.models = [...new Set([...provider.models, ...found])];
        provider.model = provider.model || found[0];
        provider.verified = true;
        save();
        paintChips();
        paintModels();
        paint();
        toast(`${found.length} modèles récupérés`, { kind: 'ok' });
      } catch (error) {
        testLine.replaceChildren(el('span.test-result.is-error', {}, error?.message || 'Échec de la récupération.'));
      } finally {
        button.disabled = false;
      }
    };
    const testProvider = async (button) => {
      button.disabled = true;
      testLine.replaceChildren(el('span.test-result', {}, 'Test en cours…'), el('span.spinner'));
      const previous = { enabled: ai.enabled, providers: [...providers], activeProvider: activeId };
      try {
        // Le test passe par ce fournisseur, même s'il n'est pas l'actif.
        updateConfig({
          ai: {
            enabled: true,
            providers: providers.map((item) => ({ ...item })),
            activeProvider: provider.id,
          },
        });
        const reply = await testConnection();
        provider.verified = true;
        save();
        testLine.replaceChildren(
          el('span.test-result.is-ok', {}, `Connexion réussie — réponse : « ${String(reply).slice(0, 40)} »`),
        );
      } catch (error) {
        testLine.replaceChildren(el('span.test-result.is-error', {}, error?.message || 'Échec du test.'));
      } finally {
        button.disabled = false;
        // Un fournisseur testé n'est pas forcément celui qu'on veut garder actif.
        if (previous.activeProvider && previous.activeProvider !== provider.id) {
          updateConfig({
            ai: {
              enabled: previous.enabled,
              providers: providers.map((item) => ({ ...item })),
              activeProvider: previous.activeProvider,
            },
          });
          activeId = previous.activeProvider;
        }
        paint();
      }
    };

    detailHost.replaceChildren(
      el(
        'div.provider-head',
        {},
        el('div', {}, el('h4', {}, provider.name || 'Fournisseur'), el('p.muted.small', {}, provider.baseUrl || 'Endpoint non renseigné')),
        el(
          'div.provider-actions',
          {},
          el('button.btn.btn-sm', { type: 'button', onclick: (e) => testProvider(e.currentTarget) }, icon('sparkles', 14), 'Tester'),
          el('button.btn.btn-sm', { type: 'button', onclick: (e) => fetchModels(e.currentTarget) }, icon('refresh', 14), 'Modèles'),
          el(
            'button.btn.btn-sm.btn-ghost',
            {
              type: 'button',
              title: 'Supprimer ce fournisseur',
              onclick: async () => {
                if (!(await confirmDialog({ title: 'Supprimer ce fournisseur ?', message: `« ${provider.name} » et sa clé seront retirés de cet appareil.`, confirmLabel: 'Supprimer', danger: true }))) return;
                const index = providers.findIndex((item) => item.id === provider.id);
                providers.splice(index, 1);
                activeId = providers[0]?.id || '';
                save();
                paint();
              },
            },
            icon('trash', 14),
          ),
        ),
      ),
      field('Nom du fournisseur', nameInput),
      field('Type (pré-remplit endpoint et modèles)', presetSelect),
      field('Endpoint (compatible OpenAI v1)', baseUrlInput, 'Sans /chat/completions ; /v1 est ajouté si besoin. TokenHarbor : https://tokenharbor.ai/v1'),
      field(
        'Clé API',
        el('div.input-with-action', {}, keyInput, el('button.icon-btn', {
          type: 'button',
          title: 'Afficher ou masquer',
          onclick: (event) => {
            const shown = keyInput.type === 'text';
            keyInput.type = shown ? 'password' : 'text';
            event.currentTarget.replaceChildren(icon(shown ? 'eye' : 'eyeOff', 16));
          },
        }, icon('eye', 16))),
        'Gardée sur cet appareil uniquement. Elle n’est jamais envoyée à NemesisWorkspace.',
      ),
      field('Modèle utilisé', modelSelect),
      chips,
      testLine,
      el(
        'div.field-row',
        {},
        field('Fenêtre de contexte (tokens)', numberInput({
          value: provider.contextTokens, min: 1024, step: 1024,
          onInput: (value) => { provider.contextTokens = value; save(); },
        })),
        field('Réponse maximale (tokens)', numberInput({
          value: provider.maxTokens, min: 64, step: 256,
          onInput: (value) => { provider.maxTokens = value; save(); },
        })),
      ),
      el(
        'div.field-row',
        {},
        field('Température', numberInput({
          value: provider.temperature, min: 0, max: 2, step: 0.1,
          onInput: (value) => { provider.temperature = value; save(); },
        }), '0 = précis, 2 = créatif.'),
        field('En-têtes supplémentaires', el('input.input', {
          value: provider.extraHeaders,
          placeholder: 'HTTP-Referer: …',
          spellcheck: false,
          oninput: (event) => { provider.extraHeaders = event.target.value; },
          onchange: confirmed,
        }), '« Nom: valeur », un par ligne.'),
      ),
      toggleRow({
        title: 'Modèle de raisonnement (thinking)',
        description: 'Envoie « reasoning.effort » et montre le raisonnement quand le modèle le fournit.',
        checked: !!provider.thinking,
        onChange: (value) => { provider.thinking = value; save(); paint(); },
      }),
      toggleRow({
        title: 'Le modèle accepte les images',
        description: 'Permet de joindre une capture ou une photo à une question.',
        checked: !!provider.supportsImages,
        onChange: (value) => { provider.supportsImages = value; save(); paint(); },
      }),
      field('Consigne système (facultative)', el('textarea.textarea', {
        rows: 2,
        placeholder: 'Ex. : Réponds en français, ton concis.',
        oninput: (event) => { provider.systemPrompt = event.target.value; },
        onchange: confirmed,
      }, provider.systemPrompt || '')),
    );
  }

  /** Nouveau fournisseur : nom provisoire, puis on l'édite. */
  function addProvider() {
    const provider = makeProvider({ name: 'Nouveau fournisseur', preset: 'custom', baseUrl: '', models: [], model: '' });
    providers.push(provider);
    activeId = provider.id;
    save();
    paint();
    setTimeout(() => detailHost.querySelector('input.input')?.focus(), 40);
  }

  paint();

  return el(
    'div.settings-pane',
    {},
    section(
      'Intelligence artificielle',
      'Vos clés, vos fournisseurs. Ajoutez-en autant que vous voulez, testez-les, puis choisissez celui qui travaille — les trois éditeurs s’y branchent aussitôt.',
    ),
    toggleRow({
      title: 'Activer l’assistance dans les éditeurs',
      description: 'Fait apparaître l’assistant dans Documents, Tableur et Présentation.',
      checked: ai.enabled,
      onChange: (value) => { ai.enabled = value; save(); },
    }),
    el('div.provider-layout', {}, listHost, detailHost),
    statusSlot,
    section('Assistance', 'Réglages communs aux trois éditeurs.'),
    el(
      'div.field',
      {},
      el('span.field-label', {}, 'Quand demander avant de modifier un document'),
      el(
        'div.seg',
        {},
        ...[
          ['destructive', 'Avant une suppression'],
          ['always', 'À chaque modification'],
          ['never', 'Jamais'],
        ].map(([value, label]) =>
          el(
            'button',
            {
              type: 'button',
              class: (loadConfig().assistant?.approval || 'destructive') === value ? 'is-on' : '',
              onclick: (event) => {
                updateConfig({ assistant: { approval: value } });
                for (const node of event.currentTarget.parentElement.children) node.classList.remove('is-on');
                event.currentTarget.classList.add('is-on');
              },
            },
            label,
          ),
        ),
      ),
      el('span.field-hint', {}, 'Le modèle peut tout faire dans un document ; cette question reste la vôtre.'),
    ),
    note(
      'Compatible OpenAI v1 : OpenAI, Anthropic via passerelle, Groq, Mistral, OpenRouter, DeepSeek, TokenHarbor, Ollama ou LM Studio en local, ou votre propre endpoint.',
      'ok',
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
