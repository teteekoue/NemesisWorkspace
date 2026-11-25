/**
 * NemesisWorkspace — l'interface en français.
 *
 * Les trois éditeurs affichent leurs onglets, rubans, boutons, menus et
 * dialogues en anglais. Traduire chaque fichier aurait voulu dire toucher des
 * milliers d'endroits, et le moindre oubli aurait laissé un bouton en anglais.
 * Tout ce qui s'affiche passe pourtant par un seul chemin : `el()` crée les
 * éléments, et y écrit le texte, les `title` et les `aria-label`.
 *
 * Ce module traduit donc **à l'affichage**, en un seul endroit : les textes
 * des onglets et des rubans, les libellés des boutons, les entrées de menu,
 * les titres de dialogues et leurs champs. Le contenu des documents, lui,
 * n'est jamais touché : un fichier garde son texte, ses noms de styles et ses
 * formules exactement tels qu'ils sont.
 *
 * Les phrases absentes du dictionnaire restent en anglais : elles s'ajoutent
 * au fur et à mesure, sans rien casser.
 */

/* ------------------------------------------------------------------ */
/* Le vocabulaire                                                      */
/* ------------------------------------------------------------------ */

/**
 * Un mot ou une phrase, et sa traduction. La casse d'origine est conservée :
 * « Save » et « SAVE » donnent « Enregistrer » et « ENREGISTRER ».
 */
const WORDS = {
  /* Onglets principaux */
  File: 'Fichier', Home: 'Accueil', Draw: 'Dessin',
  'Page Layout': 'Mise en page', Layout: 'Mise en page', References: 'Références',
  Mailings: 'Publipostage', Review: 'Révision', View: 'Affichage', Help: 'Aide',
  Design: 'Création', Animation: 'Animation', Animations: 'Animations',
  Transitions: 'Transitions', 'Slide Show': 'Diaporama', Format: 'Format',
  Data: 'Données', Formulas: 'Formules', 'Table Design': 'Création de tableau',

  /* Groupes de ruban (Documents) */
  Clipboard: 'Presse-papiers', Font: 'Police', Paragraph: 'Paragraphe',
  Styles: 'Styles', Editing: 'Édition', Illustrations: 'Illustrations',
  Links: 'Liens', 'Header & Footer': 'En-tête et pied de page',
  'Header and Footer': 'En-tête et pied de page', Text: 'Texte', Symbols: 'Symboles',
  'Page Setup': 'Mise en page', Themes: 'Thèmes', 'Page Background': 'Arrière-plan de page',
  Table: 'Tableau', Tables: 'Tableaux', Arrangement: 'Organisation',
  'Table of Contents': 'Table des matières', Footnotes: 'Notes de bas de page',
  Citations: 'Citations', Bibliography: 'Bibliographie', Captions: 'Légendes',
  Index: 'Index', 'Table of Authorities': 'Table des références',
  Create: 'Créer', Start: 'Commencer', 'Mail Merge': 'Publipostage',
  'Write & Insert Fields': 'Champs', 'Preview Results': 'Aperçu des résultats',
  Finish: 'Terminer', Proofing: 'Vérification', Comments: 'Commentaires',
  Tracking: 'Suivi', Changes: 'Modifications', Compare: 'Comparer',
  Protect: 'Protéger', Views: 'Affichages', Show: 'Afficher', Zoom: 'Zoom',
  Window: 'Fenêtre', Macros: 'Macros', 'Page Style': 'Mise en page',
  'Sheet': 'Feuille', Cells: 'Cellules', 'Charts': 'Graphiques',
  'Number': 'Nombre', 'Alignment': 'Alignement',
  'Layout': 'Disposition', 'Slides': 'Diapositives', 'Media': 'Média',
  'Picture Format': 'Format de l’image', 'Shape Format': 'Format de la forme',
  'Chart Design': 'Création de graphique', 'SmartArt Design': 'Création SmartArt',
  'Drawing': 'Dessin', 'Ink': 'Encre', 'Colors': 'Couleurs',

  /* Presse-papiers et édition */
  Paste: 'Coller', Cut: 'Couper', Copy: 'Copier', Duplicate: 'Dupliquer',
  'Format Painter': 'Reproduire la mise en forme', Undo: 'Annuler',
  Redo: 'Rétablir', Repeat: 'Répéter', Find: 'Rechercher', 'Replace': 'Remplacer',
  Select: 'Sélectionner', 'Select All': 'Tout sélectionner', Clear: 'Effacer',
  Delete: 'Supprimer', Remove: 'Retirer', 'Clear All': 'Tout effacer',
  'Undo history': 'Historique des annulations', 'Undo History': 'Historique des annulations',
  'Cut, Copy, Paste': 'Couper, copier, coller',

  /* Fichier */
  New: 'Nouveau', Open: 'Ouvrir', Save: 'Enregistrer', 'Save As': 'Enregistrer sous',
  'Save a Copy': 'Enregistrer une copie', 'Save as PDF': 'Enregistrer en PDF',
  'Download a Copy': 'Télécharger une copie', Print: 'Imprimer', 'Print Preview': 'Aperçu avant impression',
  Close: 'Fermer', Exit: 'Quitter', 'New Document': 'Nouveau document',
  'New Spreadsheet': 'Nouveau classeur', 'New Presentation': 'Nouvelle présentation',
  'Open File': 'Ouvrir un fichier', 'Open Recent': 'Ouvrir récent',
  Export: 'Exporter', 'Export as PDF': 'Exporter en PDF', Share: 'Partager',
  Options: 'Options', Settings: 'Paramètres', Account: 'Compte', About: 'À propos',
  'Keyboard shortcuts': 'Raccourcis clavier', 'Keyboard Shortcuts': 'Raccourcis clavier',
  'Download .docx': 'Télécharger le .docx', 'Download .xlsx': 'Télécharger le .xlsx',
  'Download .pptx': 'Télécharger le .pptx', Rename: 'Renommer', Move: 'Déplacer',
  'Make a copy': 'Faire une copie', 'Version history': 'Historique des versions',

  /* Police */
  Bold: 'Gras', Italic: 'Italique', Underline: 'Souligné', Strikethrough: 'Barré',
  Strike: 'Barré', 'Double strikethrough': 'Double barré', Subscript: 'Indice',
  Superscript: 'Exposant', 'Small caps': 'Petites majuscules', 'All caps': 'Majuscules',
  Uppercase: 'Majuscules', Lowercase: 'Minuscules', 'Capitalize Each Word': 'Première lettre en majuscule',
  'Change Case': 'Modifier la casse', 'Text Color': 'Couleur du texte',
  'Font Color': 'Couleur de police', Highlight: 'Surlignage', 'Text Highlight Color': 'Surligneur',
  'Clear Formatting': 'Effacer la mise en forme', 'Clear All Formatting': 'Effacer toute la mise en forme',
  'Grow Font': 'Agrandir la police', 'Shrink Font': 'Réduire la police',
  'Increase Font Size': 'Agrandir la police', 'Decrease Font Size': 'Réduire la police',
  'Font Size': 'Taille de police', 'Font Family': 'Police',
  'Character Spacing': 'Espacement des caractères', Kerning: 'Crénage',
  'Text Effects': 'Effets de texte', 'Font Dialog': 'Police',
  'Advanced': 'Avancé', 'Character': 'Caractère',

  /* Paragraphe */
  'Align Left': 'Aligner à gauche', 'Align Center': 'Centrer',
  'Align Right': 'Aligner à droite', Justify: 'Justifier', 'Justified': 'Justifié',
  Left: 'Gauche', Center: 'Centré', Right: 'Droite', 'Top': 'Haut', 'Bottom': 'Bas',
  Middle: 'Milieu', Direction: 'Sens', 'Text Direction': 'Sens du texte',
  'Left to Right': 'De gauche à droite', 'Right to Left': 'De droite à gauche',
  Bullets: 'Puces', Numbering: 'Numérotation', 'Multilevel List': 'Liste à plusieurs niveaux',
  'Bullet': 'Puce', 'Numbered List': 'Liste numérotée',
  'Line Spacing': 'Interligne', 'Line and Paragraph Spacing': 'Interligne et espacement',
  'Space Before': 'Espace avant', 'Space After': 'Espace après',
  'Increase Indent': 'Augmenter le retrait', 'Decrease Indent': 'Diminuer le retrait',
  Indent: 'Retrait', Outdent: 'Retrait négatif', 'Paragraph Dialog': 'Paragraphe',
  'Borders': 'Bordures', 'Shading': 'Trame de fond', 'Paragraph Shading': 'Trame du paragraphe',
  'Paragraph Borders': 'Bordures du paragraphe', 'Borders and Shading': 'Bordures et trame',
  'Sort': 'Trier', 'Tabs': 'Tabulations', 'Keep with next': 'Paragraphes solidaires',
  'Keep lines together': 'Lignes solidaires', 'Widow/Orphan control': 'Éviter les veuves et orphelines',

  /* Styles et mise en page */
  Normal: 'Normal', 'Title': 'Titre', 'Subtitle': 'Sous-titre', 'Heading': 'Titre',
  'Heading 1': 'Titre 1', 'Heading 2': 'Titre 2', 'Heading 3': 'Titre 3',
  'Heading 4': 'Titre 4', 'Heading 5': 'Titre 5', 'Heading 6': 'Titre 6',
  'Quote': 'Citation', 'Intense Quote': 'Citation intense', Caption: 'Légende',
  'No Spacing': 'Sans interligne', 'Apply Styles': 'Appliquer les styles',
  'Styles Pane': 'Volet des styles', 'More Styles': 'Autres styles',
  'Create a Style': 'Créer un style', 'Clear Style': 'Effacer le style',
  Margins: 'Marges', Orientation: 'Orientation', Portrait: 'Portrait',
  Landscape: 'Paysage', Size: 'Taille', Paper: 'Papier', Columns: 'Colonnes',
  'Page Color': 'Couleur de page', 'Watermark': 'Filigrane',
  'Page Borders': 'Bordures de page', 'Indent and Spacing': 'Retrait et espacement',
  'Line Numbers': 'Numéros de ligne', Hyphenation: 'Césure', Breaks: 'Sauts',
  'Page Break': 'Saut de page', 'Blank Page': 'Page blanche',
  'Cover Page': 'Page de garde', 'Section Break': 'Saut de section',
  'Insert Page Break': 'Insérer un saut de page',

  /* Insertion */
  Table: 'Tableau', 'Insert Table': 'Insérer un tableau', 'Table of contents': 'Table des matières', Pictures: 'Images',
  'Image': 'Image', Picture: 'Image', 'Insert Image': 'Insérer une image',
  Shapes: 'Formes', 'Insert Shape': 'Insérer une forme', 'Icons': 'Icônes',
  'Text Box': 'Zone de texte', 'Insert Text Box': 'Insérer une zone de texte',
  'WordArt': 'WordArt', 'Chart': 'Graphique', 'Insert Chart': 'Insérer un graphique',
  'SmartArt': 'SmartArt', 'Screenshot': 'Capture d’écran', 'Online Pictures': 'Images en ligne',
  'Header': 'En-tête', 'Footer': 'Pied de page', 'Page Number': 'Numéro de page',
  'Page Numbers': 'Numéros de page', 'Link': 'Lien', 'Hyperlink': 'Lien hypertexte',
  'Bookmark': 'Signet', 'Bookmarks': 'Signets', 'Cross-reference': 'Renvoi',
  'Comment': 'Commentaire', 'Symbol': 'Symbole', 'Symbols': 'Symboles',
  'Date & Time': 'Date et heure', 'Field': 'Champ', 'Equation': 'Équation',
  'Insert Equation': 'Insérer une équation', 'Signature Line': 'Ligne de signature',
  'Object': 'Objet', 'Embed': 'Incorporer', 'Frame': 'Cadre', 'Media': 'Média',
  'Video': 'Vidéo', 'Audio': 'Audio', 'Insert Video': 'Insérer une vidéo',
  'Bookmark Manager': 'Gestionnaire de signets', 'Go To': 'Atteindre',
  'Insert Link': 'Insérer un lien', 'Edit Link': 'Modifier le lien',
  'Table of Contents': 'Table des matières', 'Tables of Contents': 'Tables des matières',
  'Insert Table of Contents': 'Insérer une table des matières',
  'Footnote': 'Note de bas de page', 'Endnote': 'Note de fin',
  'Insert Footnote': 'Insérer une note de bas de page', 'Insert Endnote': 'Insérer une note de fin',

  /* Révision */
  'Spelling': 'Orthographe', 'Spelling & Grammar': 'Orthographe et grammaire',
  'Spell Check': 'Vérification orthographique', 'Grammar': 'Grammaire',
  'Word Count': 'Statistiques', 'Thesaurus': 'Dictionnaire des synonymes',
  'Translate': 'Traduire', 'Language': 'Langue', 'Track Changes': 'Suivi des modifications',
  'New Comment': 'Nouveau commentaire', 'Delete Comment': 'Supprimer le commentaire',
  'Show Comments': 'Afficher les commentaires', 'Next': 'Suivant', 'Previous': 'Précédent',
  'Accept': 'Accepter', 'Reject': 'Refuser', 'Accept All': 'Tout accepter',
  'Reject All': 'Tout refuser', 'Previous Change': 'Modification précédente',
  'Next Change': 'Modification suivante', 'Restrict Editing': 'Restreindre la modification',
  'Mark as Final': 'Marquer comme final', 'Dictate': 'Dicter', 'Dictation': 'Dictée',
  Voice: 'Voix', Read: 'Lire', 'Read Aloud': 'Lire à voix haute',

  /* Affichage */
  'Print Layout': 'Page', 'Read Mode': 'Lecture', 'Web Layout': 'Web',
  'Outline': 'Plan', 'Draft': 'Brouillon', 'Ruler': 'Règle',
  'Gridlines': 'Quadrillage', 'Navigation Pane': 'Volet de navigation',
  'Zoom In': 'Zoom avant', 'Zoom Out': 'Zoom arrière', 'Zoom 100%': 'Zoom 100 %',
  'Fit to Window': 'Ajuster à la fenêtre', 'Fit to Page': 'Ajuster à la page',
  'One Page': 'Une page', 'Multiple Pages': 'Plusieurs pages', 'Page Width': 'Largeur de page',
  'Two Pages': 'Deux pages', 'New Window': 'Nouvelle fenêtre', 'Arrange All': 'Réorganiser tout',
  'Split': 'Fractionner', 'Full Screen': 'Plein écran', 'Dark Mode': 'Mode sombre',

  /* Dialogues : actions et champs communs */
  Cancel: 'Annuler', Apply: 'Appliquer', OK: 'OK', 'Close': 'Fermer',
  Preview: 'Aperçu', Name: 'Nom', Width: 'Largeur', Height: 'Hauteur',
  Color: 'Couleur', Style: 'Style', 'None': 'Aucun', 'Mixed': 'Mixte',
  Default: 'Par défaut', Custom: 'Personnalisé', Automatic: 'Automatique',
  All: 'Tous', Other: 'Autre', More: 'Plus', Less: 'Moins',
  'Add': 'Ajouter', Edit: 'Modifier', Done: 'Terminé', Reset: 'Réinitialiser',
  'Restore': 'Restaurer', 'Retry': 'Réessayer', 'Continue': 'Continuer',
  'Back': 'Retour', 'Next': 'Suivant', 'Finish': 'Terminer', 'Skip': 'Ignorer',
  'Yes': 'Oui', 'No': 'Non', 'On': 'Activé', 'Off': 'Désactivé',
  'Show': 'Afficher', 'Hide': 'Masquer', 'Show All': 'Tout afficher',
  'Loading…': 'Chargement…', 'Loading': 'Chargement', 'Ready': 'Prêt',
  'Saving': 'Enregistrement', 'Saved': 'Enregistré', 'Unsaved': 'Non enregistré',
  'Unsaved changes': 'Modifications non enregistrées', 'Error': 'Erreur',
  'Warning': 'Avertissement', 'Search': 'Rechercher', 'Search…': 'Rechercher…',
  'Filter': 'Filtrer', 'Sort': 'Trier', 'Refresh': 'Actualiser',
  'Align': 'Aligner', 'Arrange': 'Organiser', 'Position': 'Position',
  'Size & Position': 'Taille et position', 'Rotation': 'Rotation',
  'Bring Forward': 'Avancer', 'Send Backward': 'Reculer',
  'Bring to Front': 'Mettre au premier plan', 'Send to Back': 'Mettre en arrière-plan',
  'Group': 'Grouper', 'Ungroup': 'Dissocier', 'Wrap Text': 'Habillage du texte',
  'Crop': 'Rogner', 'Rotate': 'Pivoter', 'Flip': 'Retourner',
  'Transparency': 'Transparence', 'Opacity': 'Opacité', 'Shadow': 'Ombre',
  'Outline': 'Contour', 'Fill': 'Remplissage', 'Gradient': 'Dégradé',
  'Effects': 'Effets', 'Presets': 'Styles prédéfinis', 'Spacing': 'Espacement',

  /* Aide et états */
  'Help': 'Aide', 'What’s New': 'Nouveautés', 'Feedback': 'Commentaires',
  'Privacy': 'Confidentialité', 'Terms': 'Conditions', 'Sign in': 'Se connecter',
  'Sign out': 'Se déconnecter', 'Sign In': 'Se connecter', 'Sign Out': 'Se déconnecter',
  'Connected': 'Connecté', 'Disconnected': 'Déconnecté', 'Offline': 'Hors ligne',
  'Online': 'En ligne', 'Unknown': 'Inconnu', 'Required': 'Obligatoire',
  'Optional': 'Facultatif', 'Enabled': 'Activé', 'Disabled': 'Désactivé',
  'Copied': 'Copié', 'Copy failed': 'La copie a échoué', 'Delete failed': 'La suppression a échoué',
  'Rename failed': 'Le renommage a échoué', 'Save failed': 'L’enregistrement a échoué',
  'Saved as': 'Enregistré sous', 'Saving…': 'Enregistrement…',
  'All Documents': 'Tous les documents', 'All apps': 'Toutes les applications',
  'Back to documents': 'Retour aux documents',
  'Back to all spreadsheets': 'Retour aux classeurs',
  'Back to presentations': 'Retour aux présentations',
  'New Document': 'Nouveau document', 'Recent': 'Récents',
  'Templates': 'Modèles', 'Blank document': 'Document vide',
  'Blank presentation': 'Présentation vide', 'Blank spreadsheet': 'Classeur vide',
  'Title': 'Titre', 'Subject': 'Objet', 'Author': 'Auteur', 'Date': 'Date',
  'Today': 'Aujourd’hui', 'Yesterday': 'Hier', 'Modified': 'Modifié',
  'Created': 'Créé', 'Folder': 'Dossier', 'File name': 'Nom du fichier',
  'Save in': 'Enregistrer dans', 'Location': 'Emplacement', 'Destination': 'Destination',
  'Choose a folder': 'Choisir un dossier', 'Device storage': 'Stockage de l’appareil',
  'Format': 'Format', 'File type': 'Type de fichier',

  /* Compléments : les mots qui reviennent dans les rubans et les menus */
  Section: 'Section', Contents: 'Contenu', Note: 'Note', Pages: 'Pages',
  Illustrations: 'Illustrations', People: 'Personnes', Emoji: 'Émoji',
  Single: 'Simple', Double: 'Double', Solid: 'Continu', Dashed: 'Tirets',
  Dotted: 'Pointillés', Thick: 'Épais', Wavy: 'Ondulé', Tight: 'Serré',
  Normal: 'Normal', Loose: 'Relâché', Wide: 'Large', Original: 'Original',
  Fixed: 'Fixe', Decimal: 'Décimal', Commas: 'Virgules', Bar: 'Barre',
  Dots: 'Points', Dashes: 'Tirets', Disc: 'Disque', Circle: 'Cercle',
  Square: 'Carré', Dash: 'Tiret', Figure: 'Figure', Length: 'Longueur',
  Published: 'Publié', Weight: 'Épaisseur', Units: 'Unités', Focus: 'Focus',
  Editor: 'Éditeur', Immersive: 'Immersif', Orientation: 'Orientation',
  'One column': 'Une colonne', 'Two columns': 'Deux colonnes',
  'Three columns': 'Trois colonnes', 'Merge cells': 'Fusionner les cellules',
  'Split cells': 'Fractionner les cellules', 'Update Fields': 'Mettre les champs à jour',
  'Ribbon display options': 'Options d’affichage du ruban',
  'Auto-hide the Ribbon': 'Masquer automatiquement le ruban',
  'Document Formatting': 'Mise en forme du document',
  'Document Fonts': 'Polices du document', 'Keep Source Formatting': 'Conserver la mise en forme d’origine',
  'Border options': 'Options de bordure', 'Match case': 'Respecter la casse',
  'Regular expression': 'Expression régulière', 'Special characters': 'Caractères spéciaux',
  'Measured in inches': 'En pouces', Inches: 'Pouces', Centimeters: 'Centimètres',
  'Measurement units': 'Unités de mesure', 'Autocorrect as you type': 'Correction automatique',
  'Typing': 'Saisie', AutoCorrect: 'Correction automatique', AutoFormat: 'Mise en forme automatique',
  'Widow and orphan control': 'Éviter les veuves et orphelines',
  'Page break before': 'Saut de page avant', 'Page setup': 'Mise en page',
  'Fit the page width': 'Ajuster à la largeur de la page',
  'In line with text': 'Aligné sur le texte', 'Freeform': 'Libre',
  'Solid fill': 'Remplissage uni', 'Picture Fill': 'Remplissage par image',
  'Line Spacing': 'Interligne', 'Shading': 'Trame de fond',
  'Sort A to Z': 'Trier de A à Z', 'Sort Z to A': 'Trier de Z à A',
  'Smallest number first': 'Du plus petit au plus grand',
  'Largest number first': 'Du plus grand au plus petit',
  'Outside borders only': 'Bordures extérieures seulement',
  'Improve the writing': 'Améliorer le texte', 'Fix spelling and grammar': 'Corriger l’orthographe',
  'Make it shorter': 'Raccourcir', 'Make it longer': 'Allonger',
  'Simplify the language': 'Simplifier le texte', 'Make it more formal': 'Rendre plus formel',
  'Make it more casual': 'Rendre plus familier', Summarize: 'Résumer',
  'Turn into bullet points': 'Mettre sous forme de puces',
  'Summarize the document': 'Résumer le document', 'List the main points': 'Lister les points clés',
  'Suggest improvements': 'Proposer des améliorations',
  'Manage my templates': 'Gérer mes modèles', 'Last saved here': 'Enregistré ici récemment',
  'Typing': 'Saisie', 'A to Z': 'De A à Z', 'Z to A': 'De Z à A',
  'Text': 'Texte', 'Background': 'Arrière-plan', 'Frame': 'Cadre',
  'Shadow': 'Ombre', 'Reflection': 'Reflet', 'Glow': 'Lueur',
  'Soft Edges': 'Bords adoucis', '3-D Format': 'Format 3D', 'Artistic Effects': 'Effets artistiques',
  'Color Saturation': 'Saturation', 'Color Tone': 'Teinte', 'Recolor': 'Recolorer',
  'Change Picture': 'Changer l’image', 'Compress Pictures': 'Compresser les images',
  'Alt Text': 'Texte de remplacement', 'Selection Pane': 'Volet Sélection',

  /* Rubans : ce que l'on clique dans Accueil, Insertion, Mise en page… */
  AutoText: 'Texte automatique', 'Quick Parts': 'Composants rapides', 'Drop Cap': 'Lettrine',
  Diagram: 'Diagramme', 'SmartArt': 'SmartArt', 'WordArt': 'WordArt',
  'Shape Styles': 'Styles de forme', 'Image Properties': 'Propriétés de l’image',
  'Formatting Pane': 'Volet de mise en forme', 'Reveal Formatting': 'Afficher la mise en forme',
  'Style Inspector': 'Inspecteur de style', 'Merge Formatting': 'Fusionner la mise en forme',
  'Unformatted text': 'Texte non mis en forme', 'HTML format': 'Format HTML',
  'Document Property': 'Propriété du document', 'Menu bar': 'Barre de menus',
  'Customize Quick Access Toolbar': 'Personnaliser la barre d’accès rapide',
  'Page number designs': 'Modèles de numéro de page', 'Cover pages': 'Pages de garde',
  'Current Position': 'Position actuelle', 'One': 'Un', 'Two': 'Deux', 'Three': 'Trois',
  'Last modified': 'Dernière modification', Download: 'Télécharger',
  'Options': 'Options', 'Orientation': 'Orientation', 'Page': 'Page', 'Pages': 'Pages',
  'Zoom': 'Zoom', 'Focus': 'Focus', 'Download a copy': 'Télécharger une copie',
  'Open in a new window': 'Ouvrir dans une nouvelle fenêtre', 'New folder': 'Nouveau dossier',
  'Upload': 'Importer', 'Link': 'Lien', 'Unlink': 'Supprimer le lien',
  'Table of Figures': 'Table des illustrations', 'Enclosure': 'Pièce jointe',
  'Style Set': 'Jeu de styles', 'Fonts': 'Polices', 'Colors': 'Couleurs',
  'Paragraph Spacing': 'Espacement des paragraphes', 'Effects': 'Effets',

  /* Relevé sur l'écran réel : ce qui restait en anglais */
  Modifier: 'Modifier', Tools: 'Outils', Accessibility: 'Accessibilité',
  'Not saved yet': 'Pas encore enregistré', Editing: 'Édition',
  'Texte mode': 'Mode texte', 'Text mode': 'Mode texte',
  'Volet des styles': 'Volet des styles',
  'Unnamed document': 'Document sans nom', Untitled: 'Sans titre',
  'Untitled document': 'Document sans titre', 'No document open': 'Aucun document ouvert',
  'Home & Tools': 'Accueil et outils', 'Text Tools': 'Outils de texte',
  'Text tools': 'Outils de texte', 'Formatting Pane': 'Volet de mise en forme',
  'Remplacer': 'Remplacer',

  'Références': 'Références', 'Révision': 'Révision', 'Affichage': 'Affichage',
  'Création': 'Création', 'Disposition': 'Disposition', 'Diaporama': 'Diaporama',
  'Fichier': 'Fichier', 'Accueil': 'Accueil', 'Insertion': 'Insertion',
  'Dessin': 'Dessin', 'Format': 'Format', 'Tableau': 'Tableau', 'Aide': 'Aide',
  'Outils': 'Outils', 'Modifier': 'Modifier', 'Données': 'Données',
  'Formules': 'Formules', 'Vérification': 'Vérification', 'Commentaires': 'Commentaires',
  'Statistiques': 'Statistiques', 'Synonymes': 'Synonymes', 'Langue': 'Langue',
  'Accessibilité': 'Accessibilité',
  // L'onglet « Insert » de la suite : c'est un nom d'onglet, pas un verbe.
  Insert: 'Insertion',
};

/* ------------------------------------------------------------------ */
/* La traduction                                                       */
/* ------------------------------------------------------------------ */

/** Les expressions les plus longues d'abord : « Bring to Front » avant « Front ». */
const PHRASES = Object.keys(WORDS).sort((a, b) => {
  // Le nombre de mots d'abord : « Table of Contents » avant « Table » et
  // « Contents », même quand le mot seul est plus long.
  const words = (text) => text.split(/\s+/).length;
  return words(b) - words(a) || b.length - a.length;
});

/** Applique la casse du texte d'origine à sa traduction. */
function matchCase(source, translated) {
  if (source === source.toUpperCase() && source !== source.toLowerCase()) return translated.toUpperCase();
  if (source[0] === source[0]?.toUpperCase() && source.slice(1) === source.slice(1).toLowerCase()) {
    return translated[0].toUpperCase() + translated.slice(1);
  }
  return translated;
}

const escaped = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Le motif de chaque expression, construit une fois. */
const PATTERNS = PHRASES.map((phrase) => ({
  phrase,
  pattern: new RegExp(`(^|[^\\p{L}\\p{N}])(${escaped(phrase)})(?![\\p{L}\\p{N}])`, 'gu'),
}));

/** La traduction d'un texte affiché, ou le texte lui-même s'il n'est pas au dictionnaire. */
export function french(text) {
  if (typeof text !== 'string' || !text.trim()) return text;
  // Un texte déjà français n'a rien à traduire.
  if (!/[A-Za-z]/.test(text)) return text;
  const held = [];
  let out = text;
  for (const { phrase, pattern } of PATTERNS) {
    if (!out.toLowerCase().includes(phrase.toLowerCase())) continue;
    out = out.replace(pattern, (match, before, found) => {
      // Un marqueur garde la place de la traduction jusqu'à la fin : sans lui,
      // « Table of Contents » deviendrait « Tableau des matières », le mot
      // « Table » ayant été traduit avant la phrase entière.
      const index = held.length;
      held.push(matchCase(found, WORDS[phrase]));
      return `${before}\u0000${index}\u0000`;
    });
  }
  return out.replace(/\u0000(\d+)\u0000/g, (match, index) => held[Number(index)]);
}

/** Vrai quand le texte contient au moins un mot que le dictionnaire connaît. */
export function hasFrench(text) {
  if (typeof text !== 'string' || !text.trim()) return false;
  return PHRASES.some((phrase) => text.toLowerCase().includes(phrase.toLowerCase()));
}

/** Le nombre d'expressions connues, pour les tests et le diagnostic. */
export const frenchTermCount = PHRASES.length;

/**
 * Les attributs qui portent du texte visible : le titre au survol, et le nom
 * lu par les lecteurs d'écran (qui sert aussi de libellé à certains boutons).
 */
const TEXT_ATTRIBUTES = ['title', 'aria-label', 'aria-description', 'alt', 'placeholder'];

/** Traduit les textes d'un élément déjà construit, et de tout ce qu'il contient. */
export function frenchElement(node) {
  if (!node) return;
  if (node.nodeType === 3) {
    const translated = french(node.nodeValue);
    if (translated !== node.nodeValue) node.nodeValue = translated;
    return;
  }
  if (node.nodeType !== 1) return;
  for (const attribute of TEXT_ATTRIBUTES) {
    if (!node.hasAttribute?.(attribute)) continue;
    const value = node.getAttribute(attribute);
    const translated = french(value);
    if (translated !== value) node.setAttribute(attribute, translated);
  }
  for (const child of node.childNodes || []) frenchElement(child);
}

/**
 * Traduire une page entière, y compris ce que l'interface ajoute ensuite :
 * les menus s'ouvrent, les dialogues se construisent, les listes se
 * remplissent après le premier affichage.
 */
export function frenchPage(target = globalThis.document) {
  if (!target?.body) return () => {};
  const seen = new WeakSet();
  const visit = (root) => {
    if (!root || seen.has(root)) return;
    seen.add(root);
    if (root.nodeType === 1) frenchElement(root);
    else frenchElement(root);
  };
  visit(target.body);

  const Observer = globalThis.MutationObserver;
  if (!Observer) return () => {};
  const observer = new Observer((records) => {
    for (const record of records) {
      if (record.type === 'characterData') {
        const translated = french(record.target.nodeValue);
        if (translated !== record.target.nodeValue) record.target.nodeValue = translated;
      } else if (record.type === 'attributes') {
        const value = record.target.getAttribute?.(record.attributeName);
        if (value == null) continue;
        const translated = french(value);
        if (translated !== value) record.target.setAttribute(record.attributeName, translated);
      } else {
        for (const added of record.addedNodes) visit(added);
      }
    }
  });
  observer.observe(target.documentElement || target.body, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: TEXT_ATTRIBUTES,
  });
  return () => observer.disconnect();
}
