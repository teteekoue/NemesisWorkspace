/**
 * NemesisWorkspace — client pour tout fournisseur compatible « OpenAI v1 ».
 *
 * Les trois éditeurs parlent à `puter.ai.chat(messages, options)`. Ce module
 * expose exactement la même forme : un objet `{ message: { role, content,
 * tool_calls }, usage, finish_reason }`, ou — quand `stream: true` — un
 * itérateur asynchrone qui produit les mêmes fragments que le SDK Puter :
 *
 *   { type: 'text', text }            un morceau de réponse
 *   { type: 'reasoning' }             le modèle réfléchit (thinking)
 *   { type: 'tool_use', id, name, input }   un appel d'outil
 *   { type: 'usage', usage }          compteurs de tokens
 *
 * Aucune requête ne part si le fournisseur n'est pas configuré : le message
 * d'erreur explique quoi remplir dans Paramètres.
 */

import { aiIsConfigured, getAiConfig } from './config.js';

const trimSlash = (url) => String(url || '').replace(/\/+$/, '');

/** « chat completions » à partir de l'endpoint saisi (avec ou sans /v1). */
export function chatCompletionsUrl(baseUrl) {
  let url = trimSlash(baseUrl);
  if (!url) return '';
  // Un endpoint collé en entier (« …/chat/completions ») est respecté.
  if (/\/chat\/completions$/i.test(url)) return url;
  // La plupart des fournisseurs veulent /v1 ; Ollama et LM Studio aussi.
  if (/\/v\d+$/i.test(url)) return `${url}/chat/completions`;
  return `${url}/v1/chat/completions`;
}

function headersFor(ai) {
  const headers = { 'Content-Type': 'application/json' };
  if (ai.apiKey) headers.Authorization = `Bearer ${ai.apiKey}`;
  for (const line of String(ai.extraHeaders || '').split(/\r?\n/)) {
    const index = line.indexOf(':');
    if (index > 0) headers[line.slice(0, index).trim()] = line.slice(index + 1).trim();
  }
  return headers;
}

/** Le prompt peut être une chaîne, une liste d'objets OpenAI, ou un objet `{ messages }`. */
function toMessages(prompt, ai) {
  let messages;
  if (Array.isArray(prompt)) messages = prompt;
  else if (prompt && typeof prompt === 'object' && Array.isArray(prompt.messages)) messages = prompt.messages;
  else messages = [{ role: 'user', content: prompt ?? '' }];
  if (ai.systemPrompt && !messages.some((message) => message.role === 'system')) {
    return [{ role: 'system', content: ai.systemPrompt }, ...messages];
  }
  return messages;
}

function temperatureFor(ai, options) {
  if (options.temperature != null) return Number(options.temperature);
  const value = Number(ai.temperature);
  return Number.isFinite(value) ? value : undefined;
}

function errorFrom(response, body) {
  const detail = body?.error?.message || body?.error || body?.message || '';
  const label = {
    401: 'Clé API refusée (401). Vérifiez la clé dans Paramètres ▸ Intelligence artificielle.',
    403: 'Accès refusé (403) par le fournisseur IA.',
    404: "Endpoint introuvable (404). Vérifiez l'adresse du fournisseur (elle doit finir par /v1).",
    429: 'Quota ou débit dépassé (429) chez le fournisseur IA. Réessayez dans un instant.',
    500: 'Le fournisseur IA a rencontré une erreur (500).',
    502: 'Passerelle du fournisseur IA en erreur (502).',
    503: 'Le fournisseur IA est indisponible (503).',
  }[response.status];
  return Object.assign(
    new Error(label || `Le fournisseur IA a répondu ${response.status}${detail ? ` : ${detail}` : ''}`),
    { code: response.status, detail },
  );
}

/**
 * Envoyer une conversation. Résout soit la réponse complète, soit un flux
 * asynchrone quand `stream: true` (comme le SDK d'origine).
 */
export async function chat(prompt, options = {}) {
  const ai = getAiConfig();
  if (!aiIsConfigured(ai)) {
    throw Object.assign(
      new Error(
        "Aucun fournisseur d'IA n'est configuré. Ouvrez Paramètres ▸ Intelligence artificielle pour ajouter une clé API.",
      ),
      { code: 'ai_not_configured' },
    );
  }

  const url = chatCompletionsUrl(ai.baseUrl);
  const model = options.model || ai.model;
  const messages = toMessages(prompt, ai);

  const body = {
    model,
    messages,
    temperature: temperatureFor(ai, options),
    max_tokens: options.max_tokens ?? options.maxTokens ?? ai.maxTokens ?? undefined,
    stream: !!options.stream,
  };
  if (options.tools?.length) {
    body.tools = options.tools;
    body.tool_choice = options.tool_choice || 'auto';
  }
  if (options.response_format) body.response_format = options.response_format;
  // Paramètres propres au raisonnement : n'envoyer que si l'utilisateur les a activés.
  if (ai.thinking && options.reasoning !== false) {
    body.reasoning = { effort: options.reasoning_effort || 'medium' };
    body.include_reasoning = true;
  }
  for (const key of ['top_p', 'presence_penalty', 'frequency_penalty', 'stop', 'seed']) {
    if (options[key] != null) body[key] = options[key];
  }
  // Un champ undefined n'a rien à faire dans le JSON.
  for (const key of Object.keys(body)) if (body[key] === undefined) delete body[key];

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: headersFor(ai),
      body: JSON.stringify(body),
      signal: options.signal,
    });
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    throw Object.assign(
      new Error(
        `Impossible de joindre le fournisseur IA (${url}). Vérifiez l'adresse et la connexion réseau.`,
      ),
      { code: 'network', cause: error },
    );
  }

  if (!response.ok) {
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      /* corps non JSON */
    }
    throw errorFrom(response, payload);
  }

  if (body.stream) {
    if (!response.body) throw new Error("Le fournisseur IA n'a pas renvoyé de flux.");
    return streamFrom(response, { model, maxTokens: body.max_tokens });
  }

  const payload = await response.json();
  const choice = payload.choices?.[0] || {};
  return {
    success: true,
    model: payload.model || model,
    message: choice.message || { role: 'assistant', content: '' },
    usage: payload.usage,
    finish_reason: choice.finish_reason,
  };
}

/**
 * Lire un flux « text/event-stream » d'OpenAI et produire les fragments
 * attendus par les éditeurs. Les appels d'outils arrivent par morceaux
 * (index, identifiant, nom, puis arguments en plusieurs chaînes) : ils sont
 * recomposés avant d'être émis.
 */
async function* streamFrom(response, { model, maxTokens }) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const calls = new Map();
  let sentReasoning = false;
  let usage = null;

  const finishCalls = function* () {
    for (const call of [...calls.values()].sort((a, b) => a.index - b.index)) {
      yield { type: 'tool_use', id: call.id, name: call.name, input: call.input };
    }
    calls.clear();
  };

  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';
      for (const line of lines) {
        const text = line.trim();
        if (!text || !text.startsWith('data:')) continue;
        const data = text.slice(5).trim();
        if (data === '[DONE]') {
          yield* finishCalls();
          return;
        }
        let part;
        try {
          part = JSON.parse(data);
        } catch {
          continue;
        }
        if (part.error) {
          yield { type: 'error', error: { message: part.error.message || 'Erreur du fournisseur IA' } };
          return;
        }
        if (part.model) model = part.model;
        if (part.usage) usage = part.usage;
        const choice = part.choices?.[0];
        if (!choice) continue;
        const delta = choice.delta || choice.message || {};

        // Certains fournisseurs (DeepSeek, OpenRouter) exposent le raisonnement.
        const reasoning = delta.reasoning_content ?? delta.reasoning;
        if (reasoning && !sentReasoning) {
          sentReasoning = true;
          yield { type: 'reasoning' };
        }
        const content = delta.content;
        if (typeof content === 'string' && content) yield { type: 'text', text: content };
        else if (Array.isArray(content)) {
          for (const piece of content) if (piece?.text) yield { type: 'text', text: piece.text };
        }

        for (const call of delta.tool_calls || []) {
          const index = call.index ?? calls.size;
          const current = calls.get(index) || { index, id: '', name: '', args: '', input: {} };
          if (call.id) current.id = call.id;
          if (call.function?.name) current.name = call.function.name;
          if (call.function?.arguments) current.args += call.function.arguments;
          calls.set(index, current);
        }
        if (choice.finish_reason) {
          for (const call of calls.values()) {
            if (call.args) {
              try {
                call.input = call.args.trim() ? JSON.parse(call.args) : {};
              } catch {
                call.input = { __unreadable: call.args };
              }
            }
          }
          yield* finishCalls();
          if (choice.finish_reason === 'length') {
            yield { type: 'cut' };
          }
        }
      }
    }
    yield* finishCalls();
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* déjà libéré */
    }
    if (usage) yield { type: 'usage', usage, model, maxTokens };
  }
}

/** Vérifier une configuration sans consommer de tokens (liste des modèles). */
export async function listModels({ baseUrl, apiKey, extraHeaders } = {}) {
  const ai = getAiConfig();
  const url = trimSlash(baseUrl ?? ai.baseUrl);
  if (!url) throw new Error("Renseignez d'abord l'endpoint du fournisseur.");
  const root = /\/v\d+$/.test(url) ? url : `${url}/v1`;
  const headers = { 'Content-Type': 'application/json' };
  const key = apiKey ?? ai.apiKey;
  if (key) headers.Authorization = `Bearer ${key}`;
  for (const line of String(extraHeaders ?? ai.extraHeaders ?? '').split(/\r?\n/)) {
    const index = line.indexOf(':');
    if (index > 0) headers[line.slice(0, index).trim()] = line.slice(index + 1).trim();
  }
  const response = await fetch(`${root}/models`, { headers });
  if (!response.ok) throw errorFrom(response, await response.json().catch(() => null));
  const payload = await response.json();
  return (payload.data || payload.models || [])
    .map((item) => (typeof item === 'string' ? item : item.id || item.name))
    .filter(Boolean);
}

/** Une réponse de test courte, pour confirmer qu'une clé fonctionne. */
export async function testConnection() {
  const reply = await chat([
    { role: 'system', content: 'Réponds uniquement par le mot OK.' },
    { role: 'user', content: 'Ping' },
  ], { temperature: 0, max_tokens: 16 });
  const content = reply?.message?.content;
  return typeof content === 'string' ? content : JSON.stringify(content);
}
