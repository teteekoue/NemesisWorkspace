/**
 * NemesisWorkspace : aucune télémétrie. La fonction reste, sans effet, pour ne
 * pas toucher les appelants ; elle documente au passage que rien ne part.
 */
export function trackEvent() {
  /* rien n'est envoyé : l'application est locale. */
}

const EXPORT_FORMATS = new Set(['xlsx', 'xls', 'xlsm', 'csv', 'tsv', 'ods', 'html', 'pdf', 'svg', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp']);

export function trackExport(filename, method) {
  const extension = /\.([a-z0-9]+)$/i.exec(String(filename))?.[1].toLowerCase();
  trackEvent('Spreadsheet Exported', { format: EXPORT_FORMATS.has(extension) ? extension : 'other', method });
}
