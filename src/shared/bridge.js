/**
 * NemesisWorkspace — pont entre la WebView et l'application Android.
 *
 * L'assemblage natif expose `window.NemesisHost` (interface JavaScript
 * `@JavascriptInterface`). Tant que l'APK n'est pas construit, le même
 * contrat fonctionne dans un navigateur grâce à des solutions de repli
 * (`<input type="file">`, téléchargement, File System Access API).
 *
 * Contrat natif attendu :
 *
 *   NemesisHost.isNative            -> true
 *   NemesisHost.platform            -> "android" | "desktop"
 *   NemesisHost.version             -> "1.0.0"
 *   NemesisHost.pickFiles(jsonArgs) -> JSON [{ name, bytes (base64) }]
 *   NemesisHost.saveFile(jsonArgs)  -> JSON { name, location }
 *   NemesisHost.shareFile(jsonArgs) -> JSON { shared: true }
 *   NemesisHost.openExternal(url)   -> void
 *   NemesisHost.setTheme(jsonTheme) -> void
 *   NemesisHost.cloudConnect(json)  -> JSON { account, token }
 *   NemesisHost.cloudUpload(json)   -> JSON { ok }
 *   NemesisHost.cloudDownload(json) -> JSON { name, bytes (base64) }
 *   NemesisHost.cloudStatus()       -> JSON { connected, account }
 */

const host = () => (typeof window !== 'undefined' ? window.NemesisHost : null);

/**
 * Une valeur de l'hôte, qu'elle soit exposée comme propriété (objet JS) ou
 * comme méthode (`@JavascriptInterface` côté Android n'expose que des
 * méthodes : `isNative()` et non `isNative`). Les deux formes se lisent ici.
 */
function value(name) {
  const native = host();
  if (!native) return undefined;
  const found = native[name];
  return typeof found === 'function' ? found.call(native) : found;
}

export function isNative() {
  try {
    return !!value('isNative');
  } catch {
    return false;
  }
}

export function platform() {
  try {
    return value('platform') || 'web';
  } catch {
    return 'web';
  }
}

export function hostVersion() {
  try {
    return value('version') || '';
  } catch {
    return '';
  }
}

/* ------------------------------------------------------------------ */
/* base64 <-> octets (l'interface Android ne transporte que du texte)  */
/* ------------------------------------------------------------------ */

export function bytesToBase64(bytes) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  const step = 0x8000;
  for (let i = 0; i < view.length; i += step) {
    binary += String.fromCharCode.apply(null, view.subarray(i, i + step));
  }
  return btoa(binary);
}

export function base64ToBytes(text) {
  const binary = atob(String(text || ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

const safeJson = (value, fallback) => {
  if (value == null || value === '') return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};

/* ------------------------------------------------------------------ */
/* Import / export de fichiers                                          */
/* ------------------------------------------------------------------ */

/**
 * Ouvrir le sélecteur de fichiers du système.
 * @returns {Promise<Array<{name: string, bytes: Uint8Array}>>}
 */
export async function pickDeviceFiles({ accept = [], multiple = true } = {}) {
  const native = host();
  if (native?.pickFiles) {
    const result = safeJson(
      await native.pickFiles(JSON.stringify({ accept, multiple })),
      [],
    );
    const list = Array.isArray(result) ? result : result?.files || [];
    return list
      .filter((item) => item && item.bytes)
      .map((item) => ({ name: item.name || 'fichier', bytes: base64ToBytes(item.bytes) }));
  }

  // Navigateur : un champ fichier invisible, résolu à la sélection.
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = !!multiple;
    if (accept.length) input.accept = accept.join(',');
    input.style.display = 'none';
    let settled = false;
    const finish = (files) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(files);
    };
    input.addEventListener('change', async () => {
      const files = await Promise.all(
        Array.from(input.files || []).map(async (file) => ({
          name: file.name,
          bytes: new Uint8Array(await file.arrayBuffer()),
        })),
      );
      finish(files);
    });
    // Un navigateur sans événement « cancel » laisse la promesse en attente :
    // le focus revenu sur la page et un champ toujours vide signifient l'abandon.
    window.addEventListener(
      'focus',
      () => setTimeout(() => { if (!input.files?.length) finish([]); }, 1500),
      { once: true },
    );
    document.body.appendChild(input);
    input.click();
  });
}

/**
 * Enregistrer un fichier sur l'appareil (Téléchargements sur Android, dossier
 * choisi sur ordinateur).
 * @returns {Promise<{name: string, location?: string}|null>}
 */
export async function saveDeviceFile({ name, bytes, mime }) {
  const native = host();
  const payload = { name, mime: mime || 'application/octet-stream' };
  if (native?.saveFile) {
    const result = safeJson(
      await native.saveFile(JSON.stringify({ ...payload, bytes: bytesToBase64(bytes) })),
      null,
    );
    return result ? { name: result.name || name, location: result.location || '' } : null;
  }

  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: name,
        types: mime ? [{ description: name.split('.').pop().toUpperCase(), accept: { [mime]: [`.${name.split('.').pop()}`] } }] : undefined,
      });
      const writable = await handle.createWritable();
      await writable.write(bytes);
      await writable.close();
      return { name: handle.name || name, location: '' };
    } catch (error) {
      if (error?.name === 'AbortError') return null;
    }
  }

  const blob = new Blob([bytes], { type: mime || 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 20000);
  return { name, location: 'Téléchargements' };
}

/**
 * Écrire le fichier à l'endroit d'où il vient.
 *
 * C'est ce que la sauvegarde attend d'une application de bureau : le fichier
 * que la personne a ouvert est celui qu'elle retrouve en le rouvrant. Sans
 * original connu (un fichier créé dans l'application), la réponse le dit et
 * l'appelant demande où enregistrer.
 *
 * @returns {Promise<{linked: boolean, name?: string, location?: string}>}
 */
export async function saveToSourceFile({ name, bytes, mime }) {
  const native = host();
  if (!native?.saveToSource) return { linked: false };
  const result = safeJson(
    await native.saveToSource(
      JSON.stringify({ name, mime: mime || 'application/octet-stream', bytes: bytesToBase64(bytes) }),
    ),
    null,
  );
  return { linked: !!result?.linked, name: result?.name || name, location: result?.location || '' };
}

/**
 * « Enregistrer sous » : la feuille de destination du système. `uri` désigne
 * l'original à réécrire quand il est connu ; sinon la feuille s'ouvre et le
 * dossier choisi devient celui du fichier.
 */
export async function saveDeviceFileAs({ name, bytes, mime, uri = '' }) {
  const native = host();
  if (!native?.saveFileAs) return saveDeviceFile({ name, bytes, mime });
  const result = safeJson(
    await native.saveFileAs(
      uri,
      JSON.stringify({ name, mime: mime || 'application/octet-stream', bytes: bytesToBase64(bytes) }),
    ),
    null,
  );
  if (!result?.linked) return null;
  return { name: result.name || name, location: result.location || '' };
}

/** Le nom sous lequel un fichier importé garde son original sur l'appareil. */
export function hasSourceFile(name) {
  const native = host();
  try {
    return !!(native?.hasSource && native.hasSource(String(name || '')));
  } catch {
    return false;
  }
}

/** Partager un fichier par la feuille de partage Android. */
export async function shareFile({ name, bytes, mime }) {
  const native = host();
  if (native?.shareFile) {
    await native.shareFile(
      JSON.stringify({ name, mime: mime || 'application/octet-stream', bytes: bytesToBase64(bytes) }),
    );
    return true;
  }
  if (navigator.canShare) {
    const file = new File([bytes], name, { type: mime || 'application/octet-stream' });
    if (navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: name });
        return true;
      } catch {
        return false;
      }
    }
  }
  return false;
}

/** Ouvrir un lien hors de l'application (navigateur système). */
export function openExternal(url) {
  const native = host();
  if (native?.openExternal) {
    native.openExternal(String(url));
    return;
  }
  window.open(url, '_blank', 'noopener');
}

/** L'application native peut suivre le thème clair / sombre. */
export function setNativeTheme(theme) {
  const native = host();
  try {
    native?.setTheme?.(theme);
  } catch {
    /* aucune coquille native */
  }
}

/** Quitter la fenêtre (retour à l'accueil sur Android). */
export function exitToHost() {
  const native = host();
  if (native?.exit) {
    native.exit();
    return true;
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* Cloud facultatif                                                    */
/* ------------------------------------------------------------------ */

const notNative = () =>
  new Error(
    "La connexion à un compte cloud se finalise dans l'application Android (ou avec un client OAuth Web). Aucune synchronisation n'a été effectuée.",
  );

export async function cloudStatus() {
  const native = host();
  if (!native?.cloudStatus) return { connected: false, account: '' };
  return safeJson(await native.cloudStatus(), { connected: false, account: '' });
}

export async function cloudConnect(options) {
  const native = host();
  if (!native?.cloudConnect) throw notNative();
  return safeJson(await native.cloudConnect(JSON.stringify(options)), null);
}

export async function cloudUpload(options) {
  const native = host();
  if (!native?.cloudUpload) throw notNative();
  return safeJson(
    await native.cloudUpload(JSON.stringify({ ...options, bytes: bytesToBase64(options.bytes) })),
    null,
  );
}

export async function cloudDownload(options) {
  const native = host();
  if (!native?.cloudDownload) throw notNative();
  const result = safeJson(await native.cloudDownload(JSON.stringify(options)), null);
  if (!result?.bytes) return null;
  return { name: result.name || options.name, bytes: base64ToBytes(result.bytes) };
}
