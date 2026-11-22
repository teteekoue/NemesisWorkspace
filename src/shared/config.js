/**
 * NemesisWorkspace — configuration de l'espace de travail.
 *
 * Une seule source de vérité, partagée par l'accueil et par les trois
 * éditeurs (Documents, Tableur, Présentation). Tout est stocké en clair dans
 * le localStorage de l'origine : aucun réglage ne quitte l'appareil.
 *
 *  - `ai`     fournisseur compatible OpenAI v1 (endpoint, clé, modèles, options)
 *  - `cloud`  compte cloud facultatif (Google Drive, WebDAV…) — l'assemblage
 *             natif Android se charge de l'OAuth ; en WebView, on garde la
 *             configuration pour l'étape suivante.
 *  - `storage` sauvegardes locales automatiques
 */

import { prefer, remember } from './prefs.js';

export const CONFIG_KEY = 'nemesis:config:v1';
export const CONFIG_EVENT = 'nemesis:config';

/** Fournisseurs connus : tout ce qui parle l'API « chat completions » d'OpenAI v1. */
export const AI_PRESETS = [
  {
    id: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1', 'gpt-4.1-mini', 'o4-mini'],
    vision: true,
    thinking: false,
  },
  {
    id: 'groq',
    label: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'qwen-2.5-32b'],
    vision: false,
    thinking: false,
  },
  {
    id: 'mistral',
    label: 'Mistral AI',
    baseUrl: 'https://api.mistral.ai/v1',
    models: ['mistral-large-latest', 'mistral-small-latest', 'open-mistral-nemo'],
    vision: true,
    thinking: false,
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    models: ['anthropic/claude-sonnet-4', 'openai/gpt-4o-mini', 'google/gemini-2.0-flash-001'],
    vision: true,
    thinking: false,
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    vision: false,
    thinking: true,
  },
  {
    id: 'together',
    label: 'Together AI',
    baseUrl: 'https://api.together.xyz/v1',
    models: ['meta-llama/Llama-3.3-70B-Instruct-Turbo', 'Qwen/Qwen2.5-72B-Instruct-Turbo'],
    vision: false,
    thinking: false,
  },
  {
    id: 'ollama',
    label: 'Ollama (local)',
    baseUrl: 'http://localhost:11434/v1',
    models: ['llama3.2', 'qwen2.5', 'phi4'],
    vision: true,
    thinking: false,
  },
  {
    id: 'lmstudio',
    label: 'LM Studio (local)',
    baseUrl: 'http://localhost:1234/v1',
    models: ['local-model'],
    vision: false,
    thinking: false,
  },
  {
    id: 'custom',
    label: 'Personnalisé (OpenAI v1)',
    baseUrl: '',
    models: [],
    vision: false,
    thinking: false,
  },
];

export const CLOUD_PRESETS = [
  { id: 'none', label: 'Aucun (100 % local)', endpoint: '', hint: '' },
  {
    id: 'gdrive',
    label: 'Google Drive',
    endpoint: 'https://www.googleapis.com/drive/v3',
    hint: "L'autorisation Google s'ouvre depuis l'application Android : renseignez l'identifiant client OAuth créé dans Google Cloud Console.",
  },
  {
    id: 'onedrive',
    label: 'Microsoft OneDrive',
    endpoint: 'https://graph.microsoft.com/v1.0/me/drive',
    hint: "L'autorisation Microsoft s'ouvre depuis l'application Android (Azure App Registration).",
  },
  {
    id: 'dropbox',
    label: 'Dropbox',
    endpoint: 'https://api.dropboxapi.com/2',
    hint: 'Nécessite une application Dropbox (App key / secret) pour la connexion Android.',
  },
  {
    id: 'webdav',
    label: 'WebDAV / Nextcloud',
    endpoint: '',
    hint: 'Adresse du dossier WebDAV, par exemple https://moncloud.fr/remote.php/dav/files/moi/NemesisWorkspace',
  },
];

const DEFAULTS = {
  version: 1,
  /** Apparence de l'espace de travail : 'system' | 'light' | 'dark'. */
  theme: 'system',
  locale: 'fr',
  storage: {
    /** Copie de sécurité automatique des fichiers à chaque enregistrement. */
    autoBackup: true,
    /** Intervalle minimal entre deux sauvegardes d'un même fichier (minutes). */
    backupEveryMin: 30,
    /** Nombre de versions conservées par fichier. */
    keepPerFile: 10,
    /** Export automatique d'une copie hors de l'application (dossier Téléchargements Android). */
    exportToDevice: false,
  },
  cloud: {
    provider: 'none',
    endpoint: '',
    account: '',
    clientId: '',
    /** Jeton d'accès — rempli par l'assemblage Android après OAuth. */
    token: '',
    autoSync: false,
    folder: 'NemesisWorkspace',
  },
  ai: {
    enabled: false,
    preset: '',
    baseUrl: '',
    apiKey: '',
    models: [],
    model: '',
    /** En-têtes supplémentaires, « Nom: valeur » séparés par des retours à la ligne. */
    extraHeaders: '',
    temperature: 0.7,
    maxTokens: 4096,
    /** Fenêtre de contexte annoncée par le fournisseur (tokens), informative. */
    contextTokens: 8192,
    /** Paramètres non standard transmis au fournisseur (raisonnement). */
    thinking: false,
    supportsImages: false,
    systemPrompt: '',
  },
};

const clone = (value) => JSON.parse(JSON.stringify(value));

/** Fusion profonde tolérante aux trous : les défauts comblent ce qui manque. */
function merge(base, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return patch ?? base;
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value && typeof value === 'object' && !Array.isArray(value) && base && typeof base[key] === 'object' && !Array.isArray(base[key])) {
      out[key] = merge(base[key], value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

export function defaultConfig() {
  return clone(DEFAULTS);
}

export function loadConfig() {
  try {
    const raw = prefer(CONFIG_KEY);
    if (!raw) return defaultConfig();
    return merge(defaultConfig(), JSON.parse(raw));
  } catch {
    return defaultConfig();
  }
}

const listeners = new Set();

/** Prévenir les vues (accueil, éditeurs) qu'un réglage a changé. */
export function onConfigChange(handler) {
  listeners.add(handler);
  return () => listeners.delete(handler);
}

export function saveConfig(next) {
  const value = merge(defaultConfig(), next);
  try {
    remember(CONFIG_KEY, JSON.stringify(value));
  } catch (error) {
    console.warn('[Nemesis] configuration non enregistrée', error);
  }
  for (const handler of listeners) {
    try {
      handler(value);
    } catch (error) {
      console.warn('[Nemesis] abonné à la configuration en erreur', error);
    }
  }
  try {
    window.dispatchEvent(new CustomEvent(CONFIG_EVENT, { detail: value }));
  } catch {
    /* pas de window (tests) */
  }
  return value;
}

/** Modifier une section (« ai », « cloud », « storage ») ou la racine d'un coup. */
export function updateConfig(patch) {
  const current = loadConfig();
  return saveConfig(merge(current, patch));
}

export function getAiConfig() {
  return loadConfig().ai;
}

export function getCloudConfig() {
  return loadConfig().cloud;
}

export function getStorageConfig() {
  return loadConfig().storage;
}

/** Vrai quand un fournisseur IA est assez configuré pour être proposé aux éditeurs. */
export function aiIsConfigured(ai = getAiConfig()) {
  return !!(ai.enabled && ai.baseUrl && ai.model);
}

/** Fournisseur préréglé correspondant à l'identifiant, ou le préréglage « personnalisé ». */
export function findAiPreset(id) {
  return AI_PRESETS.find((preset) => preset.id === id) || AI_PRESETS[AI_PRESETS.length - 1];
}

export function findCloudPreset(id) {
  return CLOUD_PRESETS.find((preset) => preset.id === id) || CLOUD_PRESETS[0];
}

/** La clé API ne doit jamais être affichée entièrement dans l'interface. */
export function maskSecret(secret) {
  const text = String(secret || '');
  if (text.length <= 8) return text ? '••••' : '';
  return `${text.slice(0, 4)}••••••${text.slice(-4)}`;
}
