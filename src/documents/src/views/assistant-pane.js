/**
 * The Assistant pane: a conversation with Puter's AI beside the pages, about
 * and for this document. Above the box the person chooses what goes with a
 * message, the selected text or the whole document, and the chip says how
 * much that is; nothing else is sent. Replies that are text for the document
 * show what they would insert or replace, and land only when the person
 * applies them, as one change Undo takes back (the reply offers Undo too).
 *
 * The pane, its button on the Home tab and the floating button beside the
 * pages are offered only where Puter's AI is available.
 */
import { el, isComposing, MOD_KEY, shortcutCode } from '../ui/dom.js';
import { clipText } from '../core/text.js';
import { toast } from '../ui/toast.js';
import * as P from '../lib/puter.js';
import { aiActionById, askAi, answerParagraphs, readableText, insertableText, listItems } from '../lib/ai.js';
import { assistantPrompt, readReply, assistantError, SUGGESTIONS, MAX_ASSISTANT_CHARS } from '../lib/assistant.js';
import { ASSISTANT_TOOLS, ASSISTANT_SYSTEM_PROMPT, documentSnapshot, runTool } from '../lib/assistant-tools.js';
import { sidePane, hint } from './review-ui.js';
import { commandIconEl } from '../ui/ribbon.js';
import { activeProvider } from '../../../shared/config.js';
import { aiSupportsImages } from '../../../shared/ai.js';

/** Le fournisseur que les requêtes vont utiliser, pour l'afficher sous la saisie. */
function providerInfo() {
  try {
    const provider = activeProvider();
    if (!provider || !provider.baseUrl || !provider.model) return null;
    return { name: provider.name, model: provider.model };
  } catch {
    return null;
  }
}

const words = text => (String(text).trim().match(/\S+/gu) || []).length;
const plural = (n, one, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

// `chat` reçoit les options : sans elles, l'agent n'aurait ni outils ni flux.
export function createAssistantPane({ editor, pkg, error, available = () => P.canUseAi(), chat = (prompt, options) => P.aiChat(prompt, options) }) {
  let scope = 'selection', history = [], busy = false, stopped = null;
  // Each reply's Undo button, with whether the reply's step is still the latest one.
  const undoSteps = new Map();
  const pane = sidePane({ title: 'Assistant', label: 'Assistant pane', className: 'as-pane', onOpen: () => { renderContext(); renderEmpty(); fab.setAttribute('aria-expanded', 'true'); titleButton.setAttribute('aria-pressed', 'true'); }, onClose: () => { fab.setAttribute('aria-expanded', 'false'); titleButton.setAttribute('aria-pressed', 'false'); editor()?.focus(); } });
  pane.heading.prepend(el('span.as-mark', { 'aria-hidden': 'true' }, commandIconEl('assistant', 16)));
  // Le fournisseur se lit dans l'en-tête, en pastille : le nom seul, le modèle
  // au survol. Il prenait une ligne sous le champ, qui encombrait le bas.
  const providerLine = el('span.as-provider-line');
  function paintProvider() {
    const provider = providerInfo();
    const ready = !!provider;
    providerLine.classList.toggle('is-missing', !ready);
    providerLine.title = ready
      ? `${provider.name} · ${provider.model}`
      : 'Aucun fournisseur prêt — ouvrez Paramètres ▸ Intelligence artificielle.';
    providerLine.replaceChildren(
      el('span.as-dot', { 'aria-hidden': 'true' }),
      el('span.as-provider-name', {}, ready ? provider.name : 'Aucun fournisseur'),
    );
  }
  // `pane.heading` EST le titre (le <h2>) : la pastille s'y ajoute.
  pane.heading.append(providerLine);
  const newChat = el('button.btn.btn-ghost.btn-sm.as-new', { type: 'button', onclick: () => { stopped = null; busy = false; send.disabled = false; history = []; log.replaceChildren(); renderEmpty(); input.focus(); } }, 'New chat');
  pane.heading.after(newChat);

  const log = el('div.as-log', { role: 'log', 'aria-label': 'Conversation with the assistant', tabIndex: -1 });
  const empty = el('div.as-empty');
  const scopeSelection = el('button.as-scope-option', { type: 'button', role: 'radio', onclick: () => setScope('selection') }, 'Selection');
  const scopeDocument = el('button.as-scope-option', { type: 'button', role: 'radio', onclick: () => setScope('document') }, 'Whole document');
  const scopeGroup = el('div.as-scope', { role: 'radiogroup', 'aria-label': 'Send with your message' }, scopeSelection, scopeDocument);
  // A radio group is one Tab stop, on the checked choice; the arrow keys switch between the choices that are available.
  scopeGroup.addEventListener('keydown', e => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!step || isComposing(e) || e.altKey || e.ctrlKey || e.metaKey) return;
    const choices = [scopeSelection, scopeDocument].filter(option => !option.disabled), at = choices.indexOf(document.activeElement);
    if (at < 0) return;
    e.preventDefault();
    const next = choices[(at + step + choices.length) % choices.length];
    scope = next === scopeSelection ? 'selection' : 'document'; renderContext(); renderEmpty(); next.focus();
  });
  // Rien ne s'affiche sous le champ, mais une région d'annonce dit aux lecteurs
  // d'écran ce que le message emporte (le texte visible est dans les titres).
  const context = el('p.visually-hidden', { 'aria-live': 'polite' });
  const input = el('textarea.as-input', { rows: 2, placeholder: 'Ask about this document, or ask for a draft or a rewrite…', 'aria-label': 'Message the assistant', enterKeyHint: 'send' });
  const send = el('button.as-send', { type: 'submit', 'aria-label': 'Send', title: 'Send (Enter)' }, commandIconEl('arrowUp', 18));
  // Une image jointe à une question : le fournisseur réglé doit l'accepter.
  const attachments = [];
  const attachRow = el('div.as-attachments');
  const fileInput = el('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif', multiple: true, hidden: true });
  const attachButton = el('button.as-attach', { type: 'button', title: 'Joindre une image', 'aria-label': 'Joindre une image', onclick: () => fileInput.click() }, commandIconEl('image', 16));
  fileInput.addEventListener('change', () => {
    for (const file of [...(fileInput.files || [])].slice(0, 4)) {
      const reader = new FileReader();
      reader.onload = () => {
        attachments.push({ name: file.name, media: file.type || 'image/png', data: String(reader.result).split(',')[1] || '' });
        paintAttachments();
      };
      reader.readAsDataURL(file);
    }
    fileInput.value = '';
  });
  function paintAttachments() {
    attachRow.replaceChildren(...attachments.map((item, at) =>
      el('span.as-attachment', {}, el('img', { src: `data:${item.media};base64,${item.data}`, alt: item.name }),
        el('button', { type: 'button', title: 'Retirer', 'aria-label': `Retirer ${item.name}`, onclick: () => { attachments.splice(at, 1); paintAttachments(); } }, '×'))));
  }
  // Le composeur : la carte de saisie seule, rien en dessous. Le compte de
  // mots vit dans la pastille de portée, le fournisseur dans l'en-tête : trois
  // lignes de texte sous le champ encombraient le bas du panneau.
  const form = el('form.as-form', { onsubmit: e => { e.preventDefault(); submit(input.value); } },
    el('div.as-box', {},
      input,
      attachRow,
      el('div.as-box-row', {}, scopeGroup, el('div.as-box-actions', {}, attachButton, send))),
    fileInput);
  // Le champ s'ajuste au texte : deux lignes au repos, jamais plus de huit
  // (le reste défile), et il reprend sa taille une fois le message parti.
  function autoGrow() {
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 128)}px`;
    input.style.overflowY = input.scrollHeight > 128 ? 'auto' : 'hidden';
  }
  input.addEventListener('input', autoGrow);
  autoGrow();
  input.addEventListener('keydown', e => {
    if (isComposing(e)) return;
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(input.value); }
  });
  // Une colonne : le fil défile, le formulaire reste à sa place en bas.
  const conversation = el('div.as-conversation', {}, log);
  pane.body.append(conversation, form);
  paintProvider();
  paintAttachments();
  window.addEventListener('nemesis:config', paintProvider);

  // A small button at the edge of the pages opens the pane (where Puter's AI is available).
  // In the title bar beside Comments, as the other apps' assistants sit in their top bars.
  const titleButton = el('button.ed-pill.as-title-button', { type: 'button', 'aria-label': 'Assistant', title: `Assistant (${MOD_KEY}+Shift+I)`, 'aria-pressed': 'false', hidden: true, onclick: () => toggle() }, commandIconEl('assistant', 16));
  titleButton.addEventListener('mousedown', e => e.preventDefault());
  const fab = el('button.as-fab', { type: 'button', 'aria-label': 'Assistant', title: `Assistant (${MOD_KEY}+Shift+I)`, 'aria-expanded': 'false', hidden: true, onclick: () => toggle() }, commandIconEl('assistant', 20));
  fab.addEventListener('mousedown', e => e.preventDefault());
  // Mod+Shift+I opens and closes the pane from anywhere in the editor.
  const keys = new AbortController();
  window.addEventListener('keydown', e => {
    if (e.defaultPrevented || isComposing(e) || !(e.ctrlKey || e.metaKey) || !e.shiftKey || e.altKey || shortcutCode(e) !== 'KeyI' || !editor()) return;
    e.preventDefault(); toggle();
  }, { signal: keys.signal });

  /* ---- What goes with a message ---- */
  function selection() {
    const engine = editor(); if (!engine) return null;
    if (engine.session.path !== null) return null;
    const [start, end] = engine.model.range;
    if (start === end) return null;
    // `original` is the document's own text, to see whether it changed; `text` is what the assistant reads.
    return { start, end, original: engine.model.text.slice(start, end), text: readableText(engine.model.paragraphs, start, end) };
  }
  function payload() {
    const engine = editor(); if (!engine) return null;
    if (scope === 'selection') { const s = selection(); return s ? { scope, ...s } : null; }
    return { scope, text: readableText(engine.session.body.paragraphs) };
  }
  function setScope(next) { scope = next; renderContext(); renderEmpty(); input.focus(); }
  function renderContext() {
    const s = selection();
    if (scope === 'selection' && !s) scope = 'document';
    scopeSelection.setAttribute('aria-checked', String(scope === 'selection'));
    scopeDocument.setAttribute('aria-checked', String(scope === 'document'));
    scopeSelection.tabIndex = scope === 'selection' ? 0 : -1; scopeDocument.tabIndex = scope === 'document' ? 0 : -1;
    scopeSelection.disabled = !s;
    const p = payload();
    const count = p ? words(p.text) : 0;
    // Le nombre de mots se lit sur l'option choisie, et le titre au survol :
    // une ligne de moins sous le champ.
    scopeSelection.textContent = 'Selection';
    scopeDocument.textContent = `${plural(count, 'word')}`;
    context.textContent = !p ? 'Nothing to send.' : scope === 'selection'
      ? `Sends the ${plural(count, 'word')} you selected.`
      : `Sends the whole document (${plural(count, 'word')}).`;
    scopeSelection.title = s ? `Sends the ${plural(words(s.text), 'word')} you selected` : 'Select a passage first';
    scopeDocument.title = p ? `Sends the whole document (${plural(count, 'word')})` : 'Nothing to send';
    for (const option of [scopeSelection, scopeDocument]) option.classList.remove('is-over');
    if (p && p.text.length > MAX_ASSISTANT_CHARS) (scope === 'selection' ? scopeSelection : scopeDocument).classList.add('is-over');
  }
  function renderEmpty() {
    if (log.querySelector('.as-message')) { empty.remove(); return; }
    const list = scope === 'selection' && selection() ? SUGGESTIONS.selection : SUGGESTIONS.document;
    empty.replaceChildren(el('p.as-empty-title', {}, 'How can I help with this document?'),
      el('div.as-suggestions', {}, ...list.map(s => el('button.as-suggestion', { type: 'button', onclick: () => (s.id ? runAction(s.id, s.label) : submit(s.ask)) }, s.label))),
      hint('The assistant sees only the selection or the whole document, as you choose below.'));
    log.append(empty);
  }

  /* ---- Messages ---- */
  const message = (who, ...children) => { empty.remove(); const node = el(`div.as-message.is-${who}`, {}, ...children); log.append(node); node.scrollIntoView?.({ block: 'nearest' }); return node; };

  /** A reply grows from "Thinking…" in place: the conversation scrolls on to show it down to its end, or from its start when it is taller. */
  function reveal(node) {
    if (!node.isConnected) return;
    const view = log.getBoundingClientRect(), box = node.getBoundingClientRect();
    if (box.bottom > view.bottom) log.scrollTop += Math.min(box.bottom - view.bottom, box.top - view.top);
  }

  async function submit(text) {
    const request = String(text || '').trim();
    if (!request || busy) return;
    const p = payload();
    if (!p) { toast('Select some text, or choose Whole document.', { icon: 'info' }); return; }
    if (p.text.length > MAX_ASSISTANT_CHARS) { toast('That is more text than the assistant takes at once. Select a shorter passage.', { icon: 'alert' }); return; }
    input.value = '';
    autoGrow();
    message('me', el('p', {}, request), el('p.as-sent', {}, scope === 'selection' ? `With ${plural(words(p.text), 'selected word')}` : 'With the whole document'));
    // Avec des images, le message part en contenu multimodal ; sinon, une simple chaîne.
    const prompt = assistantPrompt({ request, text: p.text, scope: p.scope, history });
    const sent = attachments.length
      ? [{ role: 'user', content: [
          { type: 'text', text: prompt },
          ...attachments.map((item) => ({ type: 'image', source: { type: 'base64', media_type: item.media, data: item.data } })),
        ] }]
      : prompt;
    if (attachments.length) {
      message('me', el('div.as-images', {}, ...attachments.map((item) => el('img', { src: `data:${item.media};base64,${item.data}`, alt: item.name }))));
      attachments.length = 0; paintAttachments();
    }
    await reply(async (waiting, token) => {
      try {
        // Sans images, l'agent reçoit la demande et le document, qu'il lit lui-même.
        // Avec images, on garde le contenu multimodal (l'aperçu ci-dessus le montre).
        if (!sent || typeof sent === 'string') {
          const outcome = await askAgent(request, p, waiting, token);
          return { kind: 'answer', text: outcome.text, paragraphs: [outcome.text], agent: true };
        }
        const outcome = await askAgent(prompt, p, waiting, token);
        return { kind: 'answer', text: outcome.text, paragraphs: [outcome.text], agent: true };
      } catch (error) {
        // Un fournisseur qui refuse les outils : on garde l'ancien dialogue,
        // qui propose le texte à insérer sans toucher au document.
        if (/tool|function|unsupported|400|422/i.test(String(error?.message || ''))) {
          const plain = await chat(assistantPrompt({ request, text: p.text, scope: p.scope, history }));
          return readReply(plain);
        }
        throw error;
      }
    }, p, request);
  }

  /** One of the writing assistant's actions on the selection (Improve, Shorten, …). */
  async function runAction(id, label) {
    const action = aiActionById(id); const p = payload();
    if (!action || !p || busy) return;
    message('me', el('p', {}, label), el('p.as-sent', {}, scope === 'selection' ? `With ${plural(words(p.text), 'selected word')}` : 'With the whole document'));
    await reply(async () => { const text = await askAi(action, p.text, { chat }); return { kind: 'text', text, paragraphs: answerParagraphs(text), mode: action.mode }; }, p, label);
  }

  /**
   * Une demande libre, traitée par l'agent : le modèle lit le document, le
   * modifie avec ses outils et répond en une ou deux phrases. Chaque étape
   * s'affiche au fil de l'eau. Si le fournisseur refuse les outils, on
   * retombe sur l'ancien dialogue (conseil + insertion à la main).
   */
  async function askAgent(request, p, waiting, token) {
    const engine = editor();
    let transcript = [];
    const steps = [];
    const stepList = el('div.as-steps');
    waiting.replaceChildren(stepList, el('p.as-thinking', {}, 'Je regarde le document…'));
    const snapshot = documentSnapshot(engine, { name: p.name, selectionText: p.scope === 'selection' ? p.text : '' });
    transcript.push({ role: 'system', content: ASSISTANT_SYSTEM_PROMPT });
    transcript.push({ role: 'user', content: `${snapshot}\n\n${request}` });
    let answer = '';
    for (let round = 0; round < 8; round += 1) {
      if (!isLive(token)) return { text: answer || 'Arrêté.', steps, stopped: true };
      // Le catalogue d'outils ne change pas d'un tour à l'autre : le fournisseur
      // le met en cache au lieu de le relire à chaque message.
      const iterable = await chat(transcript, { tools: ASSISTANT_TOOLS, stream: true, cacheTools: true });
      let text = '';
      const calls = [];
      for await (const part of iterable) {
        if (!isLive(token)) return { text: answer || 'Arrêté.', steps, stopped: true };
        if (part?.type === 'text') { text += part.text; }
        else if (part?.type === 'tool_use') calls.push(part);
        else if (part?.type === 'reasoning') { /* le raisonnement ne s'affiche pas ici */ }
      }
      answer = text.trim() || answer;
      if (!calls.length) break;
      transcript.push({
        role: 'assistant',
        content: [
          ...(text.trim() ? [{ type: 'text', text }] : []),
          ...calls.map((call) => ({ type: 'tool_use', id: call.id, name: call.name, input: call.input || {} })),
        ],
      });
      const results = [];
      for (const call of calls) {
        if (!isLive(token)) return { text: answer || 'Arrêté.', steps, stopped: true };
        const outcome = runTool(call.name, call.input || {}, engine);
        steps.push({ name: call.name, ok: outcome.ok });
        stepList.replaceChildren(...steps.map((step) =>
          el('p.as-step' + (step.ok ? '' : '.is-failed'), {}, step.ok ? '✓ ' : '• ', labelForTool(step.name, step.ok))));
        results.push({
          type: 'tool_result',
          tool_use_id: call.id,
          content: outcome.content,
        });
      }
      transcript.push({ role: 'user', content: results });
      waiting.querySelector('.as-thinking')?.replaceChildren('Je continue…');
    }
    return { text: answer || 'C’est fait.', steps };
  }

  // Le jeton d'arrêt est posé par reply() ; « Stop » le retire.
  const isLive = (token) => !token || stopped === token;

  const TOOL_LABELS = {
    read_document: 'Lecture du document',
    replace_selection: 'Remplacement de la sélection',
    insert_text: 'Ajout de texte',
    set_paragraph: 'Application d’un style',
    set_format: 'Mise en forme',
    set_list: 'Mise en liste',
    insert_table: 'Insertion d’un tableau',
    insert_page_break: 'Saut de page',
    find_and_replace: 'Remplacement dans tout le document',
  };
  const labelForTool = (name, ok) => `${TOOL_LABELS[name] || name}${ok ? '' : ' — impossible'}`;

  async function reply(ask, p, request) {
    busy = true; send.disabled = true;
    const token = stopped = {};
    // A request that never answers (a stalled connection) must not hold the conversation up: Stop lets it go, and the
    // conversation goes on as it was.
    const stop = el('button.btn.btn-ghost.btn-sm.as-stop', { type: 'button', onclick: () => {
      if (stopped !== token) return;
      stopped = null; busy = false; send.disabled = false;
      waiting.replaceChildren(el('p.as-sent', { role: 'status' }, 'Stopped.'));
      input.focus();
    } }, 'Stop');
    const waiting = message('assistant', el('p.as-thinking', {}, 'Thinking…'), el('div.as-actions', {}, stop));
    try {
      const answer = await ask(waiting, token);
      if (stopped !== token) return;
      history.push({ request, reply: answer.text });
      waiting.replaceChildren(...answerView(answer, p));
      reveal(waiting);
    } catch (e) {
      if (stopped !== token) return;
      waiting.classList.add('is-error');
      waiting.replaceChildren(el('p', {}, e?.message && !/AI service|could not answer/i.test(e.message) && e.message.length < 140 ? e.message : assistantError(e)));
      reveal(waiting);
    } finally {
      // A reply that New chat left behind no longer holds the conversation up.
      if (stopped === token) { busy = false; send.disabled = false; }
    }
  }

  function answerView(answer, p) {
    const body = el('div.as-answer', {}, ...answer.paragraphs.map(t => el('p', {}, t)));
    // Une réponse de l'agent : elle a déjà modifié le document, un Undo suffit.
    if (answer.agent) {
      const undo = el('button.btn.btn-ghost.btn-sm', { type: 'button', onclick: () => { editor()?.undo(); undo.disabled = true; } }, 'Annuler');
      return [body, el('div.as-actions', {}, undo)];
    }
    if (answer.kind !== 'text') return [body, actions(answer, p, false)];
    const replacing = p.scope === 'selection' && answer.mode !== 'append';
    const original = replacing ? el('p.as-replaces', {}, `Replaces “${p.text.length > 140 ? `${clipText(p.text, 140).trim()}…` : p.text}”`) : null;
    // replaceChildren would write a missing line out as the word "null": only the parts there are go in.
    return [el('p.as-kind', {}, replacing ? 'Suggested replacement' : 'Suggested text'), body, original, actions(answer, p, true)].filter(Boolean);
  }

  function actions(answer, p, insertable) {
    const row = el('div.as-actions');
    const copy = el('button.btn.btn-ghost.btn-sm', { type: 'button', onclick: () => navigator.clipboard?.writeText(answer.text).then(() => toast('Copied')).catch(() => error(new Error('The clipboard is not available.'))) }, 'Copy');
    const canEdit = () => { const engine = editor(); return !!engine && !pkg()?.readOnly && !engine.viewOnly; };
    const apply = (label, how) => el(`button.btn.btn-sm${how === 'replace' ? '.btn-primary' : '.btn-outline'}`, { type: 'button', disabled: !canEdit(), onclick: e => insert(answer, p, how, row, e.currentTarget) }, label);
    if (insertable) {
      if (p.scope === 'selection' && p.start !== undefined && answer.mode !== 'append') row.append(apply('Replace Selection', 'replace'), apply('Insert Below', 'below'));
      else if (p.scope === 'selection' && p.start !== undefined) row.append(apply('Insert After Selection', 'after'));
      else row.append(apply('Insert at Cursor', 'cursor'));
    } else row.append(apply('Insert at Cursor', 'cursor'));
    row.append(copy);
    return row;
  }

  /** Apply a reply as one undoable change, where the person said. */
  function insert(answer, p, how, row, button) {
    const engine = editor(); if (!engine) return;
    engine.finishComposition();
    if (engine.session.path !== null) engine.editStory(null);
    const model = engine.model;
    if (p.start !== undefined && (how === 'replace' || how === 'below' || how === 'after') && model.text.slice(p.start, p.end) !== p.original) {
      error(new Error('The selected text changed since you asked. Select it again and ask once more.')); return;
    }
    // A reply's "- " and "1. " items go in as bulleted and numbered list paragraphs, not as text with a marker.
    const items = listItems(answer.paragraphs).map(item => ({ ...item, text: insertableText(item.text) }));
    const text = items.map(item => item.text).join('\n');
    const ok = engine.execute(() => {
      const m = engine.model;
      let inserted;
      if (how === 'replace') { m.select(p.start, p.end); inserted = m.replace(text); }
      else if (how === 'below' || how === 'after') {
        // After the selection's last paragraph, as new paragraphs. A selection that takes in its last paragraph's
        // mark (Shift+Down from a paragraph's start) ends in that paragraph, not at the start of the next.
        const last = p.end > p.start && m.text[p.end - 1] === '\n' ? p.end - 1 : p.end;
        const end = how === 'after' ? last : (() => { const at = m.text.indexOf('\n', last); return at < 0 ? m.text.length : at; })();
        m.select(end, end);
        inserted = m.replace(how === 'after' ? ` ${text}` : `\n${text}`);
      } else inserted = m.replace(text);
      if (inserted && items.some(item => item.list)) listParagraphs(m, items, how === 'after');
      return inserted;
    });
    if (!ok) return;
    engine.focus();
    button.disabled = true;
    // The reply's own step, which this Undo takes back only while it is the latest: after another edit it would
    // have undone that edit instead and left the reply in place.
    const step = engine.session.history.at(-1), latest = () => editor() === engine && !!step && engine.session.history.at(-1) === step;
    const undo = el('button.btn.btn-ghost.btn-sm', { type: 'button', onclick: () => {
      if (!latest()) { undo.disabled = true; return; }
      engine.undo(); undoSteps.delete(undo); undo.disabled = true; applied.textContent = 'Undone';
    } }, 'Undo');
    undoSteps.set(undo, latest);
    const applied = el('span.as-applied', { role: 'status' }, how === 'replace' ? 'Replaced' : 'Inserted');
    row.replaceChildren(applied, undo);
  }

  /**
   * Make the inserted items that are list items into list paragraphs. The caret is after the inserted text.
   * The first item is a paragraph of its own only when it starts one (text inserted after a selection, or
   * mid-paragraph, joins the text before it, which stays as it is).
   */
  function listParagraphs(m, items, joined) {
    const end = m.range[1], starts = [];
    let at = end - items.reduce((n, item) => n + item.text.length + 1, -1);
    for (const item of items) { starts.push(at); at += item.text.length + 1; }
    const own = !joined && (starts[0] === 0 || m.text[starts[0] - 1] === '\n');
    for (let i = 0; i < items.length;) {
      let j = i;
      while (j + 1 < items.length && items[j + 1].list === items[i].list) j++;
      const from = i === 0 && !own ? 1 : i;
      if (items[i].list && from <= j) {
        m.select(starts[from], starts[j] + items[j].text.length);
        if (m.listFormatting !== items[i].list) m.toggleList(items[i].list);
      }
      i = j + 1;
    }
    m.select(end);
  }

  function toggle() { if (!available()) return; pane.toggle(); if (pane.isOpen) queueMicrotask(() => input.focus()); }

  return {
    pane, fab, titleButton,
    get available() { return available(); },
    open() { if (!available()) return; pane.open(); queueMicrotask(() => input.focus()); },
    toggle,
    /** The editor's selection moved: what goes with a message follows it. */
    refresh() {
      fab.hidden = titleButton.hidden = !available() || !editor();
      for (const [button, latest] of undoSteps) { if (!button.isConnected) undoSteps.delete(button); else button.disabled = !latest(); }
      if (pane.isOpen && !busy) { renderContext(); if (!log.querySelector('.as-message')) renderEmpty(); }
    },
    commands: {
      assistant: () => toggle(),
      assistantAvailable: () => available(),
    },
    extendMenu(id) {
      if (!['tools', 'view'].includes(id) || !available()) return [];
      return [{ separator: true }, { label: 'Assistant', icon: 'assistant', shortcut: `${MOD_KEY}+Shift+I`, checked: id === 'view' ? pane.isOpen : undefined, disabled: !editor(), onSelect: () => toggle() }];
    },
    destroy() { stopped = null; keys.abort(); pane.destroy(); },
  };
}
