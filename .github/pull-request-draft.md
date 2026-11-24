## Ce que fait cette branche

Livraison de l'application Android **NemesisWorkspace** (APK signé, construit par GitHub Actions) et correction de la navigation retour signalée sur l'application installée.

### 1. Le bouton retour fonctionne

Ordre appliqué, dans l'application installée uniquement (le navigateur est inchangé) :

**document ouvert → liste de l'éditeur → accueil NemesisWorkspace → sortie**

- La décision est prise **par la page, à l'instant de l'appui** (`MainActivity.BACK_SCRIPT`), et non plus à partir d'un état retenu côté Android qui pouvait décrire un écran déjà remplacé.
- La réponse de la page est relue comme du JSON (elle l'était deux fois : `{"handled":true,...}` restait encodé, donc toute pression sortait de l'application).
- Le bouton de l'interface suit le même chemin (`All apps` dans les trois éditeurs) : documents, tableur, présentations.

Vérifié sur un émulateur x86 1600×1200, à chaque exécution de la CI :

```
retour : {"handled":true,"action":"tool"}
notice::Depuis la liste, le retour ramène à l'accueil de l'espace.
focus mCurrentFocus=…nexuslauncher…   → notice::Le bouton retour quitte l'application depuis l'accueil.
```

### 2. La cause réelle : pages vides sur moteurs anciens

La liste des documents ne s'affichait pas du tout sur la vue système d'Android 8 — d'où un retour qui semblait « ne rien faire ». Trois défauts :

- syntaxe récente refusée par le moteur (`||=`) → cible de compilation **es2017** pour les quatre applications embarquées ;
- API absentes (`Intl.Segmenter`, `Object.hasOwn`, `findLast`, `matchAll`, `structuredClone`, `randomUUID`, `roundRect`, `replaceChildren`, `globalThis`…) → nouveau `src/shared/compat.js`, inséré en **script classique en tête de page** (`dev/compat-head.mjs`), donc avant le moindre module ;
- `hasWorkspaceHome` utilisé sans import dans `src/documents/src/views/editor.js` → la page échouait à l'ouverture.

L'émulateur de la CI tourne désormais sur **Android 26**, le minimum pris en charge, pour que ce genre d'oubli soit détecté.

### 3. Release `android-v1.0.1`

Quatre paquets, tous signés, alignés et vérifiés, puis **retéléchargés** pour comparer empreintes et notes :

| Paquet | Pour |
| --- | --- |
| `NemesisWorkspace-1.0.1-x86.apk` | Chromebooks / PC Intel (prioritaire, testé sur émulateur) |
| `NemesisWorkspace-1.0.1-armeabi-v7a.apk` | téléphones ARM 32 bits |
| `NemesisWorkspace-1.0.1-arm64-v8a.apk` | téléphones ARM 64 bits |
| `NemesisWorkspace-1.0.1-universal.apk` | toutes les machines |

L'interface des trois éditeurs est **compilée et embarquée** dans chaque paquet — jamais servie depuis une origine distante. Aucun code natif n'est embarqué : les quatre fichiers ont donc le même contenu (même SHA-256), ce que les notes de version indiquent explicitement.

### 4. Accueil

`importIncoming()` permet à l'accueil d'ouvrir un fichier reçu depuis un éditeur (rangement dans le bon dossier, puis redirection).

## Vérifications

| Contrôle | Résultat |
| --- | --- |
| CI `Android` (run `45329966755`) | succès, 20 étapes |
| `.t/navigation.mjs` | 11/11 |
| `.t/layout.mjs` | 23/23 |
| `.t/doc-layout.mjs` | 9/9 |
| `.t/slides.mjs` | 7/7 |
| Release `android-v1.0.1` | 4 APK + `NOTES.md` + `SHA256SUMS.txt` |
| Asset publié | empreintes identiques, signatures valides, notes exactes |

## Points d'attention pour la revue

- La compatibilité est un **fichier partagé unique** (`src/shared/compat.js`) injecté par un greffon Vite : aucun code applicatif n'a été dupliqué.
- Les quatre paquets n'ont pas de code natif propre : les découpes par architecture sont conservées parce qu'elles étaient demandées, mais leur contenu est identique — la vérification en CI le dit au lieu de le supposer.
- Le comportement du navigateur (hors application installée) est strictement inchangé : toute la navigation nouvelle est conditionnée par `isNative()`.
