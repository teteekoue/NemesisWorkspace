# NemesisWorkspace

Une suite bureautique **100 % locale** : traitement de texte (`.docx`), tableur
(`.xlsx`) et présentation (`.pptx`) réunis derrière un accueil unique. Aucun
compte, aucun serveur : les fichiers vivent sur l'appareil.

```
src/nemesis-workspace/     l'accueil (cet écran)
src/documents/             traitement de texte
src/spreadsheet/           tableur
src/presentation/          présentation
src/shared/                couche commune : stockage local, IA, réglages, pont natif
dev/nemesis-shared.mjs     plugin Vite qui résout « /shared/… » dans chaque projet
```

## Démarrer

```bash
cd src/nemesis-workspace
npm install
npm run build:all      # construit les quatre projets dans src/nemesis-workspace/dist
npm run preview        # http://localhost:4200
```

`build:all` installe au besoin les dépendances des trois éditeurs (il peut
prendre quelques minutes la première fois), puis assemble :

```
dist/index.html      accueil
dist/documents/      traitement de texte
dist/spreadsheet/    tableur
dist/presentation/   présentation
dist/shared/         couche partagée
dist/brand/          logo et icônes
```

C'est ce dossier `dist/` que l'application Android empaquette.

## Ce qui a changé par rapport aux éditeurs d'origine

- **Aucun service distant.** Le SDK hébergé (compte, stockage, IA, e-mail,
  collaboration) est remplacé par `src/shared/local-sdk.js` : un système de
  fichiers dans IndexedDB (`nemesis-fs`), un magasin clé/valeur, des dialogues
  d'ouverture/enregistrement branchés sur l'appareil, et un profil local
  toujours « connecté » — sans réseau.
- **Sauvegardes locales.** Chaque enregistrement dans `Documents/`,
  `Spreadsheets/` ou `Presentations/` dépose une version datée dans
  `Sauvegardes/<nom>/`, dédoublonnée par intervalle et élaguée par nombre.
  L'accueil les liste, les restaure et les exporte.
- **IA facultative et réelle.** `src/shared/ai.js` parle à n'importe quel
  endpoint compatible OpenAI v1 : clé API, endpoint, liste des modèles
  récupérée depuis le fournisseur, fenêtre de contexte, raisonnement,
  support des images, en-têtes supplémentaires. Sans configuration, les
  fonctions d'assistance sont masquées, le reste fonctionne.
- **Réglages** (⚙︎ sur l'accueil) : apparence, sauvegardes, IA, compte cloud
  facultatif, à propos.
- **Ouverture d'une présentation depuis l'accueil** : `?open=<chemin>`, lu au
  démarrage par `presentation/src/cloud.js`, puisque cet éditeur n'a pas de
  route par fichier.

## Étape suivante : l'APK

L'application Android n'est pas encore construite. La cible est une activité
Kotlin avec une `WebView` servie par `WebViewAssetLoader` sur
`https://appassets.androidplatform.net/`, chargeant `dist/index.html`, plus
`window.NemesisHost` (interface `@JavascriptInterface`) pour les fichiers de
l'appareil, le partage, le thème et — facultativement — le cloud. Le contrat
exact attendu est documenté en tête de `src/shared/bridge.js` ; les repli web
(`<input type=file>`, téléchargement, File System Access API) permettent déjà
d'utiliser l'ensemble dans un navigateur.
