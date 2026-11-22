/**
 * NemesisWorkspace — accès défensif au stockage du navigateur.
 *
 * Dans une iframe d'aperçu, un navigateur en mode privé ou une WebView qui
 * n'a pas encore accordé l'accès, `localStorage` peut **lever** dès qu'on le
 * lit (`SecurityError`). Comme l'accueil lit ses préférences avant d'afficher
 * quoi que ce soit, une exception ici donnerait une page blanche : tout passe
 * donc par ces deux fonctions, qui ne lèvent jamais.
 *
 * Les réglages non enregistrables ne sont pas une panne : l'application
 * fonctionne, elle oublie simplement la préférence.
 */

let warned = false;

function storage() {
  try {
    const candidate = globalThis.localStorage;
    if (!candidate) return null;
    // Lire une clé sonde l'accès réel : c'est là que le navigateur refuse.
    candidate.getItem('nemesis:probe');
    return candidate;
  } catch {
    if (!warned) {
      warned = true;
      console.warn('[Nemesis] stockage des préférences indisponible : les réglages ne seront pas mémorisés.');
    }
    return null;
  }
}

/** Lire une préférence, ou `null` si le stockage est fermé. */
export function prefer(key) {
  try {
    return storage()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

/** Écrire une préférence. Renvoie `false` quand le stockage refuse. */
export function remember(key, value) {
  try {
    const store = storage();
    if (!store) return false;
    if (value == null) store.removeItem(key);
    else store.setItem(key, String(value));
    return true;
  } catch {
    return false;
  }
}

/** Vrai si les préférences peuvent être conservées sur cet appareil. */
export function storageAvailable() {
  return storage() !== null;
}
