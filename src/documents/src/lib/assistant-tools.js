/**
 * Les outils de l'assistant Documents.
 *
 * Jusqu'ici l'assistant ne savait que proposer du texte, que la personne
 * insérait à la main. Avec des outils, il travaille dans le document comme
 * dans les deux autres éditeurs : il lit, il écrit, il met en forme, il
 * structure — et chaque action est une seule étape annulable.
 *
 * Le contrat est celui du client partagé : `chat(messages, { tools })` rend
 * des fragments `{ type:'tool_use', id, name, input }`, et l'appelant renvoie
 * un message `tool_result` par appel. Tous les outils répondent en texte.
 */

/** Le schéma d'un outil, au format OpenAI (le client partagé le garde tel quel). */
const tool = (name, description, properties = {}, required = []) => ({
  type: 'function',
  function: {
    name,
    description,
    parameters: { type: 'object', properties, required, additionalProperties: false },
  },
});

const text = (description) => ({ type: 'string', description });
const num = (description) => ({ type: 'number', description });

export const ASSISTANT_TOOLS = [
  tool(
    'read_document',
    'Read the document: its paragraphs, their styles (Title, Heading 1…), and its tables. Call it before changing anything so you know what is there.',
    {
      from: num('First paragraph to read, 1-based (default: 1).'),
      count: num('How many paragraphs to read (default: 60).'),
    },
  ),
  tool(
    'replace_selection',
    'Replace the text the person has selected. Use it for a rewrite of what they picked.',
    { text: text('The new text. Plain text; "\\n" starts a new paragraph.') },
    ['text'],
  ),
  tool(
    'insert_text',
    'Insert text at the caret, or after the selection. Paragraphs are separated by "\\n".',
    {
      text: text('The text to insert.'),
      where: text('"cursor" (default), "start" of the document, or "end" of the document.'),
    },
    ['text'],
  ),
  tool(
    'set_paragraph',
    'Turn the paragraphs touched by the selection (or the current paragraph) into a style: Title, Subtitle, Heading 1 to 3, Quote, or Normal. This is how you build a document from A to Z: a Title, then Headings, then body text.',
    {
      style: text('One of: Title, Subtitle, Heading 1, Heading 2, Heading 3, Quote, Normal.'),
    },
    ['style'],
  ),
  tool(
    'set_format',
    'Format the selected text (or the current paragraph): bold, italic, underline, font size, alignment, line spacing.',
    {
      bold: { type: 'boolean', description: 'Bold on/off.' },
      italic: { type: 'boolean', description: 'Italic on/off.' },
      underline: { type: 'boolean', description: 'Underline on/off.' },
      fontSize: num('Font size in points, e.g. 12.'),
      align: text('"left", "center", "right" or "justify".'),
      lineSpacing: num('Line spacing as a multiple, e.g. 1.5.'),
    },
  ),
  tool(
    'set_list',
    'Make the touched paragraphs a bulleted or numbered list, or turn the list off.',
    { kind: text('"bullet", "number" or "none".') },
    ['kind'],
  ),
  tool(
    'insert_table',
    'Insert a table at the caret.',
    {
      rows: num('Number of rows, 1 to 50.'),
      columns: num('Number of columns, 1 to 12.'),
      header: text('Optional first-row header cells, separated by "|".'),
    },
    ['rows', 'columns'],
  ),
  tool(
    'insert_page_break',
    'Insert a page break at the caret.',
  ),
  tool(
    'find_and_replace',
    'Replace some text everywhere in the document. Use it for a wording change across the whole document.',
    {
      find: text('The exact text to look for.'),
      replace: text('What to put in its place.'),
      all: { type: 'boolean', description: 'Replace every occurrence (default true).' },
    },
    ['find', 'replace'],
  ),
];

export const TOOL_NAMES = new Set(ASSISTANT_TOOLS.map((item) => item.function.name));

/** Ce que l'assistant reçoit avant chaque message : un aperçu du document. */
export function documentSnapshot(engine, selectionInfo) {
  const model = engine?.model;
  if (!model) return '';
  const paragraphs = model.paragraphs || [];
  const heading = (paragraph) => {
    const name = model.styles?.definitions?.[paragraph.styleId]?.name || '';
    return name && name !== 'Normal' ? ` [${name}]` : '';
  };
  const outline = paragraphs
    .slice(0, 40)
    .map((paragraph, at) => {
      const runs = (paragraph.runs || []).map((run) => run.text || '').join('');
      return `${at + 1}.${heading(paragraph)} ${runs.slice(0, 90)}`.trim();
    })
    .join('\n');
  return [
    '<document_state>',
    `Nom : ${selectionInfo?.name || 'sans titre'}`,
    `Paragraphes : ${paragraphs.length}`,
    selectionInfo?.selectionText
      ? `Sélection (${selectionInfo.selectionText.length} caractères) : « ${selectionInfo.selectionText.slice(0, 300)} »`
      : 'Aucune sélection.',
    'Début du document :',
    outline,
    '</document_state>',
  ].join('\n');
}

export const ASSISTANT_SYSTEM_PROMPT = `Tu es l'assistant intégré à NemesisWorkspace Documents, un traitement de texte qui produit de vrais fichiers .docx, entièrement hors ligne sur l'appareil de la personne.

## Ce que tu peux faire
Tu modifies le document avec tes outils. Tu peux le créer de A à Z — un titre, des sous-titres, des paragraphes, des listes, des tableaux — ou changer précisément un passage, une mise en forme, un mot.

## Comment travailler
- Regarde avant d'agir : utilise read_document au début d'une tâche de rédaction ou de révision, et lis ce que tu as fait après.
- Pour un document complet, construis-le dans l'ordre : insert_text pour le corps, set_paragraph pour les niveaux de titre, set_list pour les listes, insert_table pour les tableaux. Un titre (« style Title »), des sections (« Heading 1 »), du texte normal.
- Écris dans la langue de la personne. Sois précis, concret, sans remplissage.
- Ne décris pas ce que tu ferais : fais-le, puis dis en une ou deux phrases ce qui a été fait.
- N'invente pas de faits, de chiffres, de noms propres ni de citations. Si une information manque, laisse une indication claire entre crochets, par exemple [à compléter : date].
- Les tableaux restent simples : un en-tête, des lignes de données.

## Forme
Réponds toujours dans la langue de la personne, en texte simple, sans Markdown (pas de **, pas de #).`;

/**
 * Exécute un appel d'outil dans le document. Résout `{ ok, content }` : le
 * contenu est ce que le modèle lit en retour.
 */
export function runTool(name, input, engine) {
  try {
    const model = engine?.model;
    if (!model) return { ok: false, content: "Le document n'est pas ouvert." };
    const done = (message) => ({ ok: true, content: message });

    switch (name) {
      case 'read_document': {
        const from = Math.max(1, Math.floor(Number(input.from) || 1));
        const count = Math.min(120, Math.max(1, Math.floor(Number(input.count) || 60)));
        const paragraphs = model.paragraphs.slice(from - 1, from - 1 + count);
        if (!paragraphs.length) return done('Aucun paragraphe dans cette plage.');
        const lines = paragraphs.map((paragraph, at) => {
          const style = model.styles?.definitions?.[paragraph.styleId]?.name || 'Normal';
          const body = (paragraph.runs || []).map((run) => run.text || '').join('');
          return `${from + at} [${style}] ${body}`;
        });
        return done(lines.join('\n'));
      }

      case 'replace_selection': {
        const [start, end] = model.range;
        if (start === end) return { ok: false, content: "Rien n'est sélectionné : sélectionnez le passage à remplacer." };
        const ok = engine.execute(() => model.replace(String(input.text ?? '')));
        return ok ? done('Le passage sélectionné a été remplacé.') : { ok: false, content: "Le remplacement n'a pas pu être appliqué." };
      }

      case 'insert_text': {
        const where = String(input.where || 'cursor').toLowerCase();
        const body = String(input.text ?? '');
        const ok = engine.execute(() => {
          if (where === 'end') model.select(model.text.length);
          else if (where === 'start') model.select(0);
          return model.replace(body);
        });
        return ok ? done('Texte inséré.') : { ok: false, content: "L'insertion n'a pas pu être appliquée." };
      }

      case 'set_paragraph': {
        const wanted = String(input.style || 'Normal').toLowerCase();
        const definitions = Object.values(model.styles?.definitions || {});
        const match =
          definitions.find((definition) => definition.type === 'paragraph' && definition.name?.toLowerCase() === wanted) ||
          definitions.find((definition) => definition.type === 'paragraph' && definition.name?.toLowerCase().includes(wanted));
        if (!match) {
          const names = definitions.filter((d) => d.type === 'paragraph').map((d) => d.name).slice(0, 14).join(', ');
          return { ok: false, content: `Style inconnu. Styles disponibles : ${names}.` };
        }
        const ok = engine.execute(() => model.setParagraphStyle(match.id));
        return ok ? done(`Style « ${match.name} » appliqué.`) : { ok: false, content: 'Le style était déjà celui-là.' };
      }

      case 'set_format': {
        let changed = false;
        engine.execute(() => {
          if (input.bold !== undefined) { model.setRunFormat({ bold: !!input.bold }); changed = true; }
          if (input.italic !== undefined) { model.setRunFormat({ italic: !!input.italic }); changed = true; }
          if (input.underline !== undefined) { model.setRunFormat({ underline: !!input.underline }); changed = true; }
          if (input.fontSize) { model.setFontSize(Number(input.fontSize)); changed = true; }
          if (input.align) {
            const side = { left: 'left', center: 'center', right: 'right', justify: 'justify' }[String(input.align).toLowerCase()];
            if (side) { model.setParagraphAlignment(side); changed = true; }
          }
          if (input.lineSpacing) { model.setParagraphLineSpacing(Number(input.lineSpacing)); changed = true; }
          return changed;
        });
        return changed ? done('Mise en forme appliquée.') : { ok: false, content: 'Aucune mise en forme demandée.' };
      }

      case 'set_list': {
        const kind = String(input.kind || 'bullet').toLowerCase();
        if (kind !== 'none') {
          const ok = engine.execute(() => model.toggleList(kind === 'number' ? 'number' : 'bullet'));
          return ok ? done('Liste appliquée.') : { ok: false, content: "La liste n'a pas pu être appliquée." };
        }
        // Retirer une liste : chaque paragraphe touché perd son marqueur, en une étape.
        const [from, to] = model.range;
        const length = (paragraph) => (paragraph.runs || []).reduce((n, run) => n + (run.text || '').length, 0);
        const targets = [];
        let offset = 0;
        for (const paragraph of model.paragraphs) {
          const starts = offset;
          const ends = offset + length(paragraph) + 1;
          offset = ends;
          if (!paragraph.list) continue;
          const touched = from === to ? from >= starts && from < ends : starts < to && ends > from;
          if (touched) targets.push(paragraph);
        }
        if (!targets.length) return { ok: false, content: 'Ces paragraphes ne sont pas une liste.' };
        engine.execute(() => {
          model.checkpoint();
          for (const paragraph of targets) {
            paragraph.list = null;
            paragraph.listChanged = true;
          }
          model.didChange();
          return true;
        });
        return done('Liste retirée.');
      }

      case 'insert_table': {
        const rows = Math.min(50, Math.max(1, Math.floor(Number(input.rows) || 2)));
        const columns = Math.min(12, Math.max(1, Math.floor(Number(input.columns) || 2)));
        const ok = engine.execute(() => model.insertTable(rows, columns));
        return ok ? done(`Tableau de ${rows} × ${columns} inséré.`) : { ok: false, content: "Le tableau n'a pas pu être inséré." };
      }

      case 'insert_page_break': {
        const ok = engine.execute(() => model.insertPageBreak());
        return ok ? done('Saut de page inséré.') : { ok: false, content: "Le saut de page n'a pas pu être inséré." };
      }

      case 'find_and_replace': {
        const find = String(input.find || '');
        if (!find) return { ok: false, content: 'Aucun texte à chercher.' };
        let count = 0;
        engine.execute(() => {
          model.select(0, model.text.length);
          count = model.replaceMatches({ find }, String(input.replace ?? ''), {}, input.all !== false);
          return count > 0;
        });
        return count ? done(`${count} occurrence(s) remplacée(s).`) : { ok: false, content: 'Ce texte est introuvable.' };
      }

      default:
        return { ok: false, content: `Outil inconnu : ${name}` };
    }
  } catch (error) {
    return { ok: false, content: error?.message || String(error) };
  }
}
