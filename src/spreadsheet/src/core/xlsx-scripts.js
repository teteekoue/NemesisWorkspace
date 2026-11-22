/**
 * A workbook's scripts in an .xlsx: one JSON part of the app's own, /puter/scripts.json, reached from the package's
 * relationships by a relationship type of the app's own. A program that does not know the type leaves the part
 * alone (the package format says a consumer ignores relationships it does not understand), so the file opens
 * everywhere as it would without it, and this app reads its scripts back.
 */
import { normalizeScripts, serializeScripts } from './scripts.js';

// NemesisWorkspace : l'identifiant est propre à l'application. Un tableur qui
// ne connaît pas ce type de relation ignore simplement la partie, comme
// l'exige le format OOXML ; les classeurs écrits avant ce changement (marqués
// « https://puter.com/… ») restent lisibles via les marqueurs ci-dessous.
export const SCRIPTS_RELATIONSHIP = 'https://nemesisworkspace.app/spreadsheet/relationships/scripts';
const LEGACY_RELATIONSHIPS = ['https://puter.com/spreadsheet/relationships/scripts'];
export const SCRIPTS_PART = '/nemesis/scripts.json';
export const SCRIPTS_CONTENT_TYPE = 'application/vnd.nemesisworkspace.spreadsheet.scripts+json';
const FORMAT = 'nemesisworkspace-spreadsheet-scripts';
const LEGACY_FORMATS = ['puter-spreadsheet-scripts'];

const escapeAttr = (text) => String(text).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** Add the scripts part to a package being written; `get`/`set` read and write its parts by path. */
export function writeXlsxScripts(wb, { get, set, contentType }) {
  if (!wb.scripts?.length) return;
  set(SCRIPTS_PART, JSON.stringify({ format: FORMAT, version: 1, scripts: serializeScripts(wb) }));
  contentType(SCRIPTS_PART, SCRIPTS_CONTENT_TYPE);
  const rels = get('/_rels/.rels');
  if (!rels || rels.includes(SCRIPTS_RELATIONSHIP)) return;
  const taken = new Set([...rels.matchAll(/\bId="([^"]*)"/g)].map((m) => m[1]));
  let id = 'rIdNemesisScripts';
  for (let n = 2; taken.has(id); n++) id = `rIdNemesisScripts${n}`;
  const rel = `<Relationship Id="${escapeAttr(id)}" Type="${SCRIPTS_RELATIONSHIP}" Target="${SCRIPTS_PART.slice(1)}"/>`;
  set('/_rels/.rels', rels.replace('</Relationships>', `${rel}</Relationships>`));
}

/** The scripts in a package read with its parts kept (`files`: path → { content }), or undefined when it has none. */
export function readXlsxScripts(files) {
  if (!files) return undefined;
  const text = (path) => {
    const part = files[path] || files[`/${path}`];
    if (!part?.content) return '';
    return typeof part.content === 'string' ? part.content : new TextDecoder().decode(part.content);
  };
  const rels = text('_rels/.rels');
  let target = null;
  for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
    const marked = [SCRIPTS_RELATIONSHIP, ...LEGACY_RELATIONSHIPS].some((type) => m[0].includes(`"${type}"`));
    if (!marked) continue;
    target = /\bTarget="([^"]*)"/.exec(m[0])?.[1] || null;
    break;
  }
  if (!target) return undefined;
  try {
    const data = JSON.parse(text(target.replace(/^\//, '')));
    if (![FORMAT, ...LEGACY_FORMATS].includes(data?.format) || !Array.isArray(data.scripts)) return undefined;
    return normalizeScripts(data.scripts);
  } catch {
    return undefined;
  }
}
