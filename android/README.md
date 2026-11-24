# NemesisWorkspace — application Android

Documents, feuilles de calcul et présentations dans une seule application
installable, sans compte et sans connexion obligatoire.

Le paquet est publié dans les versions GitHub du dépôt :
`android-v1.0.0` → `NemesisWorkspace-1.0.0-universal.apk`, avec
`SHA256SUMS.txt` et `NOTES.md`.

## Ce que contient le paquet

L'interface des trois éditeurs est **compilée puis embarquée** dans le paquet,
et servie à la page depuis les ressources de l'application
(`https://appassets.androidplatform.net/`). Aucun écran n'est chargé depuis
Internet : l'application s'ouvre et travaille hors connexion, et une mise à
jour distante ne peut pas changer son comportement.

Ce qui sort sur le réseau vient de la personne elle-même : l'assistant envoie
ses requêtes au fournisseur d'IA configuré, et un lien choisi s'ouvre dans le
navigateur. Tout le reste est HTTPS ; seul un serveur d'IA local
(Ollama, LM Studio…) peut être en HTTP, sur `localhost` / `127.0.0.1`.

## Un seul paquet, toutes les architectures

L'application ne contient **aucun code natif** : l'interface est du JavaScript
compilé, et Android exécute le reste avec sa propre machine virtuelle. Un
paquet par architecture aurait donc exactement le même contenu. Ce paquet
unique s'installe aussi bien sur un **Chromebook Intel (x86)**, sur un
téléphone **arm64-v8a** que sur un appareil **armeabi-v7a**.

S'il fallait un jour ajouter une bibliothèque native, la découpe par
architecture redeviendrait nécessaire : le contrôle de la construction
signale explicitement son apparition.

Sur un appareil de bureau — Chromebook, tablette avec clavier, écran externe —
la fenêtre est large, les éditeurs prennent leur mise en page de bureau, et le
clavier comme la souris sont pris en charge. Le bouton retour ferme d'abord ce
que l'interface a ouvert, puis revient dans l'historique, et ne quitte
qu'ensuite.

## Ce que la construction vérifie avant de publier

À chaque envoi, `.github/workflows/android.yml` :

1. compile les trois éditeurs et l'accueil depuis les sources
   (`node dev/build-all.mjs`), puis les embarque ;
2. construit le paquet signé ;
3. vérifie, pour ce paquet : **signature** (`apksigner verify`),
   **alignement** (`zipalign -c -P 16`), **manifeste** (`aapt2 dump badging`,
   point d'entrée, SDK), et la **présence des trois éditeurs** embarqués ;
4. **installe et lance** l'application sur un appareil virtuel **x86** —
   l'architecture des Chromebooks — puis contrôle qu'elle démarre
   (`am start -W`, `Status: ok`), que l'interface a réellement monté son
   contenu (journal de l'application), et que l'écran n'est pas uni
   (capture d'écran analysée) ;
5. publie le paquet, `SHA256SUMS.txt` et `NOTES.md` dans une version GitHub ;
6. **retélécharge l'asset publié** et vérifie qu'il a la même empreinte et
   qu'il est toujours signé.

## Signature

La clé de publication accompagne le code (`keystore/`). Elle ne sert qu'à
authentifier les mises à jour : chaque version publiée est signée de la même
main, sans dépendre d'un réglage propre à la forge. Le mot de passe la protège
au repos.

Si le dépôt définit `ANDROID_KEYSTORE_BASE64` (et, au besoin,
`ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`),
cette clé prend le pas : c'est le chemin à suivre pour tourner une clé.

## Construire soi-même

```sh
cd src/nemesis-workspace && node dev/build-all.mjs   # les trois éditeurs
cp -R src/nemesis-workspace/dist/. android/app/src/main/assets/
cd android && ./gradlew assembleRelease
```

Le paquet produit se trouve dans
`android/app/build/outputs/apk/release/NemesisWorkspace-<version>-universal.apk`.

## Le pont avec l'interface

`window.NemesisHost` — décrit dans `src/shared/bridge.js` — relie la page au
système : choix et enregistrement de fichiers, partage, lien externe, thème,
impression. L'impression passe par le service d'impression d'Android, où
« Enregistrer au format PDF » est une imprimante comme une autre.

Sur un appareil dont le moteur de rendu n'a jamais été mis à jour, les
méthodes de DOM récentes (`replaceChildren`, `append`…) sont complétées au
démarrage : sans elles, l'écran resterait vide.
