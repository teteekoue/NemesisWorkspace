package com.nemesisworkspace.app

import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.content.res.Configuration
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.print.PrintAttributes
import android.print.PrintManager
import android.util.Base64
import android.util.Log
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.webkit.ConsoleMessage
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.webkit.WebViewAssetLoader
import org.json.JSONArray
import org.json.JSONObject
import org.json.JSONTokener
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

/**
 * NemesisWorkspace — l'écran unique de l'application.
 *
 * L'interface des trois éditeurs est compilée dans les ressources de
 * l'application et servie depuis `https://appassets.androidplatform.net/` :
 * rien n'est chargé depuis Internet. L'application s'ouvre donc et travaille
 * hors connexion, et une mise à jour distante ne peut pas changer son
 * comportement. Seul l'assistant parle au réseau, vers le fournisseur d'IA que
 * la personne a configuré.
 *
 * Sur un appareil de bureau (Chromebook, tablette en fenêtre, écran externe),
 * la fenêtre est déjà large : les éditeurs y prennent leur mise en page de
 * bureau, avec clavier et souris. Cette activité laisse simplement la fenêtre
 * grandir, transmet les zones sûres (encoche, barre système, clavier) et les
 * raccourcis qui ne sont pas les leurs.
 */
class MainActivity : AppCompatActivity() {

    private lateinit var web: WebView
    private val ui = Handler(Looper.getMainLooper())

    /* Le contrat de `bridge.js` est synchrone : `NemesisHost.pickFiles(...)`
       rend une chaîne JSON. Les méthodes sont donc appelées sur le fil de la
       passerelle JavaScript, qui attend la réponse de l'écran système pendant
       que l'interface continue de vivre sur le fil principal. */
    private val pendingPick = AtomicReference<CountDownLatch?>(null)
    private val picked = AtomicReference<String?>(null)
    private val pendingSave = AtomicReference<CountDownLatch?>(null)
    private val saved = AtomicReference<String?>(null)

    /**
     * Le fichier d'origine de chaque fichier importé, quand il a été choisi
     * dans l'interface système et que l'application peut le réécrire.
     *
     * Sans cela, modifier un document ne modifiait que la copie rangée dans
     * l'application : le fichier de l'utilisateur gardait l'ancienne version.
     * La clé est le nom du fichier importé, la valeur son adresse d'origine.
     */
    private val sourceUris = java.util.concurrent.ConcurrentHashMap<String, Uri>()
    private val pendingSaveAs = AtomicReference<CountDownLatch?>(null)
    private val savedAs = AtomicReference<String?>(null)
    private val pendingSaveName = AtomicReference<String?>(null)

    private lateinit var assetLoader: WebViewAssetLoader

    /* La dictée : la vue intégrée n'a pas de reconnaissance vocale, celle du
       système en a une. L'interface demande une écoute, le système reconnaît,
       et chaque phrase reconnue revient à la page qui l'insère dans le texte. */
    private var listening = false
    private var pendingDictation = 0
    private var speech: SpeechRecognizer? = null
    private var speechLanguage = "fr-FR"
    private var microphoneRequested = false

    private val openDocument = registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        deliverPick(uri?.let { listOf(it) } ?: emptyList())
    }

    private val openDocuments = registerForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
        deliverPick(uris ?: emptyList())
    }

    private val createDocument = registerForActivityResult(ActivityResultContracts.CreateDocument("application/octet-stream")) { uri ->
        deliverSave(uri)
    }

    /**
     * « Enregistrer sous » : le système demande où écrire, et l'adresse
     * choisie devient celle du fichier, pour les sauvegardes suivantes.
     */
    private val createDocumentAs = registerForActivityResult(ActivityResultContracts.CreateDocument("application/octet-stream")) { uri ->
        deliverSaveAs(uri)
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode != MICROPHONE_REQUEST) return
        val granted = grantResults.isNotEmpty() && grantResults[0] == PackageManager.PERMISSION_GRANTED
        if (granted && microphoneRequested) listen() else speak("dictateDenied")
        microphoneRequested = false
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // L'interface occupe toute la fenêtre, dessous la barre d'état compris.
        WindowCompat.setDecorFitsSystemWindows(window, false)
        window.statusBarColor = Color.TRANSPARENT
        window.navigationBarColor = Color.TRANSPARENT
        WindowInsetsControllerCompat(window, window.decorView).apply {
            isAppearanceLightStatusBars = false
            isAppearanceLightNavigationBars = false
        }

        // Un document ouvert depuis une autre application est déposé dans le
        // stockage de l'application avant que l'interface ne démarre : elle le
        // retrouve ensuite comme n'importe quel autre fichier.
        pendingIncoming = intent?.let { readIntent(it) }

        assetLoader = WebViewAssetLoader.Builder()
            .setDomain(APP_DOMAIN)
            .addPathHandler("/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        web = WebView(this).apply {
            setBackgroundColor(APP_BACKGROUND)
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT,
            )
        }
        setContentView(web)
        configureWebView()
        applyInsets(web)

        web.addJavascriptInterface(Host(), "NemesisHost")
        web.loadUrl("$APP_ORIGIN/index.html")

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() = backOrExit()
        })
    }

    /* ------------------------------------------------------------------ */
    /* Réglages de la vue                                                  */
    /* ------------------------------------------------------------------ */

    @SuppressLint("SetJavaScriptEnabled")
    private fun configureWebView() {
        val settings = web.settings
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.databaseEnabled = true
        settings.allowFileAccess = false
        settings.allowContentAccess = false
        settings.allowFileAccessFromFileURLs = false
        settings.allowUniversalAccessFromFileURLs = false
        settings.javaScriptCanOpenWindowsAutomatically = true
        settings.setSupportMultipleWindows(false)
        settings.useWideViewPort = true
        // La mise en page est pilotée par la largeur réelle de la fenêtre,
        // jamais par un zoom d'ensemble : c'est ce qui donne aux éditeurs leur
        // disposition de bureau sur un écran large.
        settings.loadWithOverviewMode = false
        settings.builtInZoomControls = false
        settings.displayZoomControls = false
        settings.textZoom = 100
        settings.cacheMode = WebSettings.LOAD_DEFAULT
        settings.setGeolocationEnabled(false)
        settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW

        CookieManager.getInstance().setAcceptCookie(true)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            CookieManager.getInstance().setAcceptThirdPartyCookies(web, false)
        }

        web.isScrollbarFadingEnabled = false
        web.overScrollMode = View.OVER_SCROLL_NEVER

        web.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(
                view: WebView,
                request: WebResourceRequest,
            ): WebResourceResponse? {
                // Les fichiers de l'application viennent de ses ressources.
                // Tout le reste (l'assistant, ses images, le fournisseur d'IA)
                // part normalement sur le réseau.
                return if (request.url.host == APP_DOMAIN) {
                    assetLoader.shouldInterceptRequest(request.url)
                } else {
                    null
                }
            }

            override fun shouldOverrideUrlLoading(
                view: WebView,
                request: WebResourceRequest,
            ): Boolean {
                val url = request.url
                if (url.host == APP_DOMAIN) return false
                if (url.scheme == "http" || url.scheme == "https") {
                    openInBrowser(url)
                    return true
                }
                // mailto:, tel:, intent:… : la main passe au système.
                return try {
                    startActivity(Intent(Intent.ACTION_VIEW, url).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                    true
                } catch (error: ActivityNotFoundException) {
                    true
                }
            }

            /**
             * L'interface change d'écran sans recharger la page (document,
             * liste, accueil) : à chaque nouvelle adresse, ce qu'elle affiche
             * est redemandé, et le retour sait quoi quitter.
             */
            override fun doUpdateVisitedHistory(view: WebView, url: String, isReload: Boolean) {
                super.doUpdateVisitedHistory(view, url, isReload)
                view.evaluateJavascript(SCREEN_REPORT) { report ->
                    reportScreen(report)
                }
            }

            override fun onReceivedError(
                view: WebView,
                request: WebResourceRequest,
                error: android.webkit.WebResourceError,
            ) {
                Log.w(TAG, "échec de chargement ${request.url} : ${error.description}")
            }

            override fun onReceivedHttpError(
                view: WebView,
                request: WebResourceRequest,
                response: WebResourceResponse,
            ) {
                Log.w(TAG, "réponse ${response.statusCode} pour ${request.url}")
            }

            override fun onPageStarted(view: WebView, url: String, favicon: android.graphics.Bitmap?) {
                super.onPageStarted(view, url, favicon)
                // Certains appareils n'ont jamais mis à jour leur moteur de
                // rendu. Les méthodes de DOM récentes sont complétées ici,
                // avant que l'interface ne commence à s'afficher : c'est la
                // différence entre un écran vide et l'application.
                view.evaluateJavascript(COMPATIBILITY, null)
                // La dictée avant tout le reste : l'éditeur décide à son
                // démarrage s'il affiche le bouton.
                view.evaluateJavascript(DICTATION_BRIDGE, null)
            }

            override fun onPageFinished(view: WebView, url: String) {
                super.onPageFinished(view, url)
                deliverIncoming()
                // Le seul raccord que l'interface attend : l'impression passe
                // par le service d'impression Android, qui sait aussi produire
                // un PDF.
                view.evaluateJavascript(PRINT_BRIDGE, null)
                // La dictée, pour les moteurs qui ne l'ont pas.
                view.evaluateJavascript(DICTATION_BRIDGE, null)
                // La langue déclarée par la page suit ce qu'elle affiche : les
                // lecteurs d'écran, la césure et la dictée s'y accordent.
                view.evaluateJavascript("document.documentElement.lang='fr'", null)
                // Ce que l'écran affiche réellement, dans le journal : utile
                // sur un appareil qu'on ne peut pas brancher, et vérifiable par
                // la construction.
                view.evaluateJavascript(SCREEN_REPORT) { report -> reportScreen(report) }
            }
        }

        web.webChromeClient = object : WebChromeClient() {
            override fun onConsoleMessage(message: ConsoleMessage): Boolean {
                // Les messages de la page restent dans le journal du système :
                // une panne d'affichage se diagnostique sans outil spécial.
                val level = message.messageLevel()
                if (level == ConsoleMessage.MessageLevel.ERROR) {
                    Log.w(TAG, "page: ${message.message()} (${message.sourceId()}:${message.lineNumber()})")
                } else {
                    Log.i(TAG, "page: [${level}] ${message.message()}")
                }
                return true
            }

            override fun onShowFileChooser(
                view: WebView,
                filePathCallback: android.webkit.ValueCallback<Array<Uri>>,
                params: FileChooserParams,
            ): Boolean {
                // Un champ fichier de l'interface (une image insérée, un
                // document à importer) ouvre le choix de fichiers d'Android.
                pendingChooser = filePathCallback
                val types = params.acceptTypes
                    .filter { it.isNotBlank() }
                    .map { if (it.startsWith(".")) mimeOf(it) else it }
                    .filter { it.contains("/") }
                    .toTypedArray()
                return try {
                    if (params.mode == FileChooserParams.MODE_OPEN_MULTIPLE) {
                        openDocuments.launch(types.ifEmpty { arrayOf("*/*") })
                    } else {
                        openDocument.launch(types.ifEmpty { arrayOf("*/*") })
                    }
                    true
                } catch (error: ActivityNotFoundException) {
                    pendingChooser = null
                    false
                }
            }
        }
    }

    private var pendingChooser: android.webkit.ValueCallback<Array<Uri>>? = null

    /**
     * L'écran affiché est-il un document en cours d'édition ?
     *
     * C'est ce que le bouton retour doit quitter : un document cède la place à
     * sa liste, puis la liste à l'accueil de l'espace. Sur un accueil, le
     * retour quitte l'application — jamais l'historique de chargement, qui
     * ramènerait une page déjà quittée.
     */
    /** Note l'écran rapporté par l'interface et le laisse dans le journal. */
    private fun reportScreen(report: String?) {
        if (report.isNullOrBlank() || report == "null") return
        Log.i(TAG, "interface prête: $report")
    }

    /** Le document reçu à l'ouverture, en attendant que l'interface soit prête. */
    private var pendingIncoming: JSONObject? = null
    private var incomingDelivered = false

    private fun readIntent(intent: Intent): JSONObject? {
        val uri: Uri = when (intent.action) {
            Intent.ACTION_VIEW -> intent.data ?: return null
            Intent.ACTION_SEND -> {
                @Suppress("DEPRECATION")
                intent.getParcelableExtra(Intent.EXTRA_STREAM) ?: return null
            }
            else -> return null
        }
        return try {
            val name = displayName(uri) ?: "document"
            val bytes = contentResolver.openInputStream(uri)?.use { it.readBytes() } ?: return null
            JSONObject()
                .put("name", name)
                .put("bytes", Base64.encodeToString(bytes, Base64.NO_WRAP))
        } catch (error: Exception) {
            null
        }
    }

    /**
     * Remet le document reçu à l'interface, une seule fois par ouverture :
     * celui qui a ouvert le fichier depuis son courriel ou son gestionnaire de
     * fichiers le retrouve dans son éditeur, pas sur l'accueil.
     */
    private fun deliverIncoming() {
        val payload = pendingIncoming ?: return
        if (incomingDelivered) return
        incomingDelivered = true
        pendingIncoming = null
        web.evaluateJavascript(
            "window.dispatchEvent(new CustomEvent('nemesis:incoming',{detail:$payload}));",
            null,
        )
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        // Un second document ouvert pendant que l'application tourne.
        pendingIncoming = readIntent(intent) ?: return
        incomingDelivered = false
        if (::web.isInitialized) deliverIncoming()
    }

    /* ------------------------------------------------------------------ */
    /* Zones sûres                                                         */
    /* ------------------------------------------------------------------ */

    /**
     * L'interface reçoit les hauteurs des barres système, de l'encoche et du
     * clavier en variables CSS, que ses styles appliquent à l'en-tête et à la
     * zone de saisie. Rien n'est masqué par une barre système.
     */
    private fun applyInsets(view: WebView) {
        // La vue reçue par l'écouteur est un `View` : c'est la nôtre qui sait
        // exécuter du code dans la page.
        ViewCompat.setOnApplyWindowInsetsListener(view) { _, insets ->
            val bars = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout(),
            )
            val keyboard = insets.getInsets(WindowInsetsCompat.Type.ime()).bottom
            val density = resources.displayMetrics.density
            fun css(px: Int) = (px / density).toInt()
            // Le document peut ne pas encore exister (première mesure, avant
            // l'analyse du HTML) : les valeurs sont alors posées à l'arrivée
            // de la page, sans erreur dans le journal.
            val values = "var s=document.documentElement&&document.documentElement.style;if(!s)return;" +
                "s.setProperty('--safe-top','${css(bars.top)}px');" +
                "s.setProperty('--safe-right','${css(bars.right)}px');" +
                "s.setProperty('--safe-bottom','${css(bars.bottom)}px');" +
                "s.setProperty('--safe-left','${css(bars.left)}px');" +
                "s.setProperty('--keyboard','${css(keyboard)}px');"
            view.evaluateJavascript("(function(){try{$values}catch(e){}})();", null)
            view.evaluateJavascript(
                "document.addEventListener('DOMContentLoaded',function(){try{$values}catch(e){}});",
                null,
            )
            insets
        }
        view.requestApplyInsets()
    }

    /* ------------------------------------------------------------------ */
    /* Bureau, fenêtre, clavier                                            */
    /* ------------------------------------------------------------------ */

    /**
     * Un appareil qui se comporte comme un ordinateur : Chromebook, tablette
     * posée sur un clavier, écran externe. La fenêtre y est large et donne la
     * mise en page de bureau dès 1024 points.
     */
    private fun isDesktopLike(): Boolean {
        if (packageManager.hasSystemFeature(PackageManager.FEATURE_PC)) return true
        val widest = maxOf(
            resources.configuration.screenWidthDp,
            resources.configuration.screenHeightDp,
        )
        val keyboard = resources.configuration.keyboard != Configuration.KEYBOARD_NOKEYS
        val smallest = resources.configuration.smallestScreenWidthDp
        return (keyboard && widest >= 900) || (smallest >= 600 && widest >= 1024)
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        // Rotation, redimensionnement de fenêtre, branchement d'un clavier :
        // rien n'est rechargé, la mise en page suit la largeur.
        web.requestLayout()
        web.evaluateJavascript(
            "window.dispatchEvent(new Event('resize'));" +
                "document.dispatchEvent(new Event('nemesis:viewport'));",
            null,
        )
        web.requestApplyInsets()
    }

    override fun onKeyDown(keyCode: Int, event: KeyEvent): Boolean {
        if (keyCode == KeyEvent.KEYCODE_ESCAPE) {
            web.evaluateJavascript(
                "document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));",
                null,
            )
        }
        return super.onKeyDown(keyCode, event)
    }

    /* ------------------------------------------------------------------ */
    /* Retour arrière                                                      */
    /* ------------------------------------------------------------------ */

    /**
     * Le retour ferme d'abord ce que l'interface a ouvert (dialogue, aperçu),
     * puis revient dans l'historique, et ne quitte qu'ensuite.
     */
    private fun backOrExit() {
        // La page décide à l'instant de l'appui : un dialogue se ferme, un
        // document revient à sa liste, la liste à l'accueil de l'espace, et
        // l'accueil quitte l'application. Aucun état retenu côté Android, qui
        // pourrait décrire un écran déjà remplacé.
        web.evaluateJavascript(BACK_SCRIPT) { result ->
            Log.i(TAG, "retour : $result")
            val action = jsonOf(result)?.optString("action").orEmpty()
            when (action) {
                // Un dialogue ou un menu ouvert se ferme d'abord.
                "overlay" -> Unit
                // Le document revient à la liste de son éditeur.
                "document" -> web.evaluateJavascript(LEAVE_DOCUMENT, null)
                // La liste remonte à l'accueil de l'espace de travail.
                "tool" -> web.loadUrl("$APP_ORIGIN/index.html")
                else -> finish()
            }
        }
    }

    /**
     * Le résultat d'`evaluateJavascript` est une chaîne JSON contenant la
     * chaîne renvoyée : il faut la lire deux fois pour obtenir l'objet.
     */
    private fun jsonOf(result: String?): JSONObject? {
        if (result.isNullOrBlank() || result == "null") return null
        return runCatching {
            val inner = JSONTokener(result).nextValue()
            when (inner) {
                is JSONObject -> inner
                is String -> JSONObject(inner)
                else -> null
            }
        }.getOrNull()
    }

    /* ------------------------------------------------------------------ */
    /* Dictée : la reconnaissance vocale du système                        */
    /* ------------------------------------------------------------------ */

    /**
     * Demande le micro une fois, puis écoute. Le système reconnaît la parole ;
     * chaque phrase reconnue est renvoyée à la page, qui l'insère au curseur
     * comme le ferait la dictée d'un navigateur.
     */
    private fun beginListening(language: String) {
        if (!SpeechRecognizer.isRecognitionAvailable(this)) {
            speak("dictateUnavailable")
            return
        }
        speechLanguage = language.ifBlank { java.util.Locale.getDefault().toLanguageTag() }
        if (ContextCompat.checkSelfPermission(this, android.Manifest.permission.RECORD_AUDIO)
            != PackageManager.PERMISSION_GRANTED
        ) {
            microphoneRequested = true
            requestPermissions(arrayOf(android.Manifest.permission.RECORD_AUDIO), MICROPHONE_REQUEST)
            return
        }
        listen()
    }

    private fun listen() {
        if (speech == null) {
            if (!SpeechRecognizer.isRecognitionAvailable(this)) {
                speak("dictateUnavailable")
                return
            }
            speech = SpeechRecognizer.createSpeechRecognizer(this).apply {
                setRecognitionListener(object : RecognitionListener {
                    override fun onReadyForSpeech(params: Bundle?) {}
                    override fun onBeginningOfSpeech() {}
                    override fun onRmsChanged(rmsdB: Float) {}
                    override fun onBufferReceived(buffer: ByteArray?) {}
                    override fun onEndOfSpeech() {}

                    override fun onError(error: Int) {
                        // Le silence n'est pas une panne : on réécoute.
                        if (listening && (error == SpeechRecognizer.ERROR_NO_MATCH || error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT)) {
                            ui.postDelayed({ if (listening) listen() }, 300)
                            return
                        }
                        listening = false
                        when (error) {
                            SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> speak("dictateDenied")
                            SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> speak("dictatingBusy")
                            else -> speak("dictateStopped")
                        }
                    }

                    override fun onResults(results: Bundle?) {
                        val words = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                            ?.firstOrNull().orEmpty()
                        if (words.isNotBlank()) emitDictation(words, true)
                        // Une dictée continue : la phrase suivante est écoutée.
                        if (listening) ui.postDelayed({ if (listening) listen() }, 200)
                    }

                    override fun onPartialResults(partialResults: Bundle?) {
                        val words = partialResults?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                            ?.firstOrNull().orEmpty()
                        if (words.isNotBlank()) emitDictation(words, false)
                    }

                    override fun onEvent(eventType: Int, params: Bundle?) {}
                })
            }
        }
        listening = true
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, speechLanguage)
            putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
            putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, packageName)
            putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
        }
        try {
            speech?.startListening(intent)
        } catch (error: Exception) {
            listening = false
            speak("dictateStopped")
        }
    }

    private fun endListening() {
        listening = false
        try {
            speech?.stopListening()
            speech?.cancel()
        } catch (error: Exception) {
            // Rien à arrêter.
        }
    }

    /** Une phrase reconnue, transmise à la page au fil de l'eau. */
    private fun emitDictation(text: String, final: Boolean) {
        val payload = JSONObject()
            .put("text", text)
            .put("final", final)
        val script = "window.__nemesisDictation&&window.__nemesisDictation($payload);"
        ui.post { web.evaluateJavascript(script, null) }
    }

    /** Ce que l'interface doit savoir pour parler d'elle-même. */
    private fun speak(event: String) {
        ui.post {
            web.evaluateJavascript("window.__nemesisDictationState&&window.__nemesisDictationState('$event');", null)
        }
    }

    /* ------------------------------------------------------------------ */
    /* Liens                                                               */
    /* ------------------------------------------------------------------ */

    private fun openInBrowser(uri: Uri) {
        try {
            startActivity(Intent(Intent.ACTION_VIEW, uri).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        } catch (error: ActivityNotFoundException) {
            toast("Aucun navigateur pour ouvrir ce lien")
        }
    }

    private fun toast(text: String) = Toast.makeText(this, text, Toast.LENGTH_SHORT).show()

    /* ------------------------------------------------------------------ */
    /* Sélecteurs : import et enregistrement                               */
    /* ------------------------------------------------------------------ */

    private fun launchPick(types: Array<String>, multiple: Boolean) {
        ui.post {
            try {
                if (multiple) openDocuments.launch(types) else openDocument.launch(types)
            } catch (error: Exception) {
                deliverPick(emptyList())
            }
        }
    }

    private fun deliverPick(uris: List<Uri>) {
        val chooser = pendingChooser
        if (chooser != null) {
            pendingChooser = null
            chooser.onReceiveValue(uris.toTypedArray())
        }
        val latch = pendingPick.getAndSet(null) ?: return
        val files = JSONArray()
        for (uri in uris) {
            try {
                val name = displayName(uri) ?: defaultName(uri)
                val bytes = contentResolver.openInputStream(uri)?.use { it.readBytes() } ?: ByteArray(0)
                // Le fichier d'origine reste lié à sa copie : une sauvegarde
                // réécrira ce fichier-là, pas seulement la copie interne.
                sourceUris[sourceKey(name)] = uri
                files.put(
                    JSONObject()
                        .put("name", name)
                        .put("bytes", Base64.encodeToString(bytes, Base64.NO_WRAP)),
                )
            } catch (error: Exception) {
                // Un fichier illisible est simplement omis.
            }
        }
        picked.set(files.toString())
        latch.countDown()
    }

    /**
     * L'identité d'un fichier, telle que l'interface la nomme : son nom seul,
     * sans dépendre de la casse du système de fichiers.
     */
    private fun sourceKey(name: String): String = name.trim().lowercase()

    /**
     * Le fichier d'origine d'un nom donné, s'il a été importé depuis le
     * stockage de l'appareil et reste réinscriptible.
     */
    private fun sourceUriFor(name: String): Uri? {
        val uri = sourceUris[sourceKey(name)] ?: return null
        return try {
            contentResolver.openOutputStream(uri, "wt")?.close()
            uri
        } catch (error: Exception) {
            // Le fournisseur ne l'accorde plus : la copie interne reste la
            // seule destination, et l'interface le sait.
            null
        }
    }

    /** Écrit un fichier à l'adresse de son original. Vrai si l'écriture a eu lieu. */
    private fun writeBack(name: String, bytes: ByteArray): Uri? {
        val uri = sourceUriFor(name) ?: return null
        return try {
            contentResolver.openOutputStream(uri, "wt")?.use { out ->
                out.write(bytes)
                out.flush()
            } ?: return null
            uri
        } catch (error: Exception) {
            Log.w(TAG, "réécriture impossible pour $name : ${error.message}")
            null
        }
    }

    private fun deliverSaveAs(uri: Uri?) {
        val latch = pendingSaveAs.getAndSet(null)
        if (latch == null) return
        val name = pendingSaveName.getAndSet(null).orEmpty()
        if (uri == null) {
            savedAs.set(null)
            latch.countDown()
            return
        }
        Thread {
            val answer = try {
                val bytes = pendingBytes.get()
                contentResolver.openOutputStream(uri, "wt")?.use { out ->
                    out.write(bytes)
                    out.flush()
                }
                // Le fichier choisi devient l'original de ce nom : les
                // sauvegardes suivantes l'écrivent là, sans rien demander.
                sourceUris[sourceKey(displayName(uri) ?: name)] = uri
                JSONObject()
                    .put("name", displayName(uri) ?: name)
                    .put("location", displayName(uri) ?: "Documents")
                    .put("linked", true)
                    .toString()
            } catch (error: Exception) {
                Log.w(TAG, "enregistrement sous refusé : ${error.message}")
                null
            }
            pendingBytes.set(ByteArray(0))
            savedAs.set(answer)
            latch.countDown()
        }.start()
    }

    private fun deliverSave(uri: Uri?) {
        val latch = pendingSave.getAndSet(null)
        if (latch == null) return
        if (uri == null) {
            // La feuille système a été fermée : le fichier reste dans
            // l'application, et l'interface le sait.
            saved.set(null)
            latch.countDown()
            return
        }
        Thread {
            val answer = try {
                val bytes = pendingBytes.get()
                contentResolver.openOutputStream(uri)?.use { out -> out.write(bytes) }
                val written = displayName(uri) ?: "document"
                // Ce qui vient d'être écrit à la main devient l'original de
                // ce nom : les sauvegardes suivantes y retournent.
                sourceUris[sourceKey(written)] = uri
                JSONObject()
                    .put("name", written)
                    .put("location", written)
                    .put("linked", true)
                    .toString()
            } catch (error: Exception) {
                null
            }
            pendingBytes.set(ByteArray(0))
            saved.set(answer)
            latch.countDown()
        }.start()
    }

    private val pendingBytes = AtomicReference<ByteArray>(ByteArray(0))

    /**
     * Un nom pour un fichier sans nom : le type déclaré par le fournisseur
     * donne son extension, sinon le nom reste générique mais valide.
     */
    private fun defaultName(uri: Uri): String {
        val extension = mimeTypeOf(uri)?.substringAfterLast('/')
            ?.let { if (it == "jpeg") "jpg" else it }
            ?.takeIf { it.length in 2..5 && it.all(Char::isLetterOrDigit) }
        return if (extension != null) "fichier.$extension" else "fichier"
    }

    private fun mimeTypeOf(uri: Uri): String? =
        try {
            contentResolver.getType(uri)
        } catch (error: Exception) {
            null
        }

    private fun displayName(uri: Uri): String? {
        var name: String? = null
        try {
            contentResolver.query(uri, null, null, null, null)?.use { cursor ->
                val index = cursor.getColumnIndex(android.provider.OpenableColumns.DISPLAY_NAME)
                if (index >= 0 && cursor.moveToFirst()) name = cursor.getString(index)
            }
        } catch (error: Exception) {
            // Certains fournisseurs refusent la requête : le dernier segment
            // du chemin fait l'affaire.
        }
        return name ?: uri.lastPathSegment?.substringAfterLast('/')
    }

    /* ------------------------------------------------------------------ */
    /* Impression                                                          */
    /* ------------------------------------------------------------------ */

    /**
     * L'impression passe par le service d'impression d'Android :
     * « Enregistrer au format PDF » y est une imprimante comme une autre, et
     * le document sort avec sa mise en page.
     */
    private fun printCurrentPage() {
        val name = "NemesisWorkspace-${System.currentTimeMillis()}"
        val adapter = web.createPrintDocumentAdapter(name)
        val manager = getSystemService(PRINT_SERVICE) as PrintManager
        manager.print(name, adapter, PrintAttributes.Builder().build())
    }

    /* ------------------------------------------------------------------ */
    /* Le pont vers l'interface                                            */
    /* ------------------------------------------------------------------ */

    /**
     * `window.NemesisHost` — le contrat décrit dans `src/shared/bridge.js`.
     * Chaque méthode rend du texte JSON ; les fichiers voyagent en base64.
     */
    inner class Host {

        @JavascriptInterface
        fun isNative(): Boolean = true

        /**
         * La page demande de quitter l'application (retour depuis l'accueil
         * de l'espace). C'est elle qui sait quel écran est affiché à
         * l'instant de l'appui ; Android ne fait qu'obéir.
         */
        @JavascriptInterface
        fun exitApp() {
            ui.post { finish() }
        }

        @JavascriptInterface
        fun platform(): String = if (isDesktopLike()) "desktop" else "android"

        @JavascriptInterface
        fun version(): String = BuildConfig.VERSION_NAME

        @JavascriptInterface
        fun pickFiles(json: String): String {
            val args = runCatching { JSONObject(json) }.getOrDefault(JSONObject())
            val accept = args.optJSONArray("accept") ?: JSONArray()
            val types = (0 until accept.length())
                .map { accept.optString(it) }
                .map { if (it.startsWith(".")) mimeOf(it) else it }
                .filter { it.contains("/") }
                .distinct()
                .toTypedArray()
            val latch = CountDownLatch(1)
            picked.set(null)
            pendingPick.set(latch)
            launchPick(types.ifEmpty { arrayOf("*/*") }, args.optBoolean("multiple", true))
            // Cinq minutes : le temps de parcourir ses fichiers.
            latch.await(5, TimeUnit.MINUTES)
            pendingPick.compareAndSet(latch, null)
            return picked.getAndSet(null) ?: "[]"
        }

        @JavascriptInterface
        fun saveFile(json: String): String {
            val args = runCatching { JSONObject(json) }.getOrDefault(JSONObject())
            val name = args.optString("name").ifBlank { "Document" }
            val bytes = runCatching { Base64.decode(args.optString("bytes"), Base64.DEFAULT) }
                .getOrDefault(ByteArray(0))
            pendingBytes.set(bytes)
            val latch = CountDownLatch(1)
            saved.set(null)
            pendingSave.set(latch)
            ui.post {
                try {
                    createDocument.launch(name)
                } catch (error: Exception) {
                    deliverSave(null)
                }
            }
            latch.await(5, TimeUnit.MINUTES)
            pendingSave.compareAndSet(latch, null)
            // La réponse décrit le fichier rangé dans l'application ; la copie
            // sur l'appareil, si elle a eu lieu, est signalée par `location`.
            val copy = saved.getAndSet(null)
            val answer = if (copy != null) JSONObject(copy) else JSONObject()
            if (!answer.has("name")) answer.put("name", name)
            return answer.toString()
        }

        /**
         * Écrit le fichier à l'endroit d'où il vient, sans rien demander.
         * Répond `{ linked: true, name }` quand l'original a été réécrit, et
         * `{ linked: false }` quand il n'y a pas d'original à mettre à jour :
         * l'interface décide alors d'ouvrir la feuille de destination.
         */
        @JavascriptInterface
        fun saveToSource(json: String): String {
            val args = runCatching { JSONObject(json) }.getOrDefault(JSONObject())
            val name = args.optString("name")
            if (name.isBlank()) return JSONObject().put("linked", false).toString()
            val bytes = runCatching { Base64.decode(args.optString("bytes"), Base64.DEFAULT) }
                .getOrDefault(ByteArray(0))
            val uri = writeBack(name, bytes)
                ?: return JSONObject().put("linked", false).toString()
            return JSONObject()
                .put("linked", true)
                .put("name", displayName(uri) ?: name)
                .put("location", displayName(uri) ?: name)
                .toString()
        }

        /**
         * « Enregistrer sous » : la feuille de destination du système s'ouvre,
         * et le dossier choisi reste celui du fichier ensuite.
         */
        @JavascriptInterface
        fun saveFileAs(uri: String, json: String): String {
            val args = runCatching { JSONObject(json) }.getOrDefault(JSONObject())
            val name = args.optString("name").ifBlank { "Document" }
            val bytes = runCatching { Base64.decode(args.optString("bytes"), Base64.DEFAULT) }
                .getOrDefault(ByteArray(0))
            // L'original du nom est réécrit ; sans original, la feuille de
            // destination du système s'ouvre et le dossier choisi reste
            // attaché au fichier pour les sauvegardes suivantes.
            if (uri.isNotBlank()) {
                val back = writeBack(uri, bytes)
                if (back != null) {
                    return JSONObject()
                        .put("linked", true)
                        .put("name", displayName(back) ?: name)
                        .put("location", displayName(back) ?: name)
                        .toString()
                }
            }
            pendingBytes.set(bytes)
            pendingSaveName.set(name)
            val latch = CountDownLatch(1)
            savedAs.set(null)
            pendingSaveAs.set(latch)
            ui.post {
                try {
                    createDocumentAs.launch(name)
                } catch (error: Exception) {
                    deliverSaveAs(null)
                }
            }
            latch.await(5, TimeUnit.MINUTES)
            pendingSaveAs.compareAndSet(latch, null)
            return savedAs.getAndSet(null) ?: JSONObject().put("linked", false).toString()
        }

        /** Commencer à dicter, dans la langue de la personne. */
        @JavascriptInterface
        fun startDictation(language: String) {
            ui.post {
                if (!listening) {
                    listening = true
                    beginListening(language)
                }
            }
        }

        /** Arrêter la dictée. */
        @JavascriptInterface
        fun stopDictation() {
            ui.post {
                listening = false
                endListening()
            }
        }

        /** La reconnaissance vocale du système est-elle disponible ici ? */
        @JavascriptInterface
        fun canDictate(): Boolean {
            val available = SpeechRecognizer.isRecognitionAvailable(this@MainActivity)
            Log.i(TAG, "dictée : reconnaissance du système " + if (available) "disponible" else "absente")
            return available
        }

        /** Le nom sous lequel un fichier importé est connu de l'original. */
        @JavascriptInterface
        fun hasSource(name: String): Boolean = sourceUriFor(name) != null

        @JavascriptInterface
        fun shareFile(json: String): String {
            val args = runCatching { JSONObject(json) }.getOrDefault(JSONObject())
            val name = args.optString("name").ifBlank { "Document" }
            val mime = args.optString("mime").ifBlank { "application/octet-stream" }
            val bytes = runCatching { Base64.decode(args.optString("bytes"), Base64.DEFAULT) }
                .getOrDefault(ByteArray(0))
            return try {
                val folder = File(cacheDir, "shared").apply { mkdirs() }
                val file = File(folder, name.substringAfterLast('/'))
                file.writeBytes(bytes)
                val uri = FileProvider.getUriForFile(this@MainActivity, "$packageName.files", file)
                val send = Intent(Intent.ACTION_SEND).apply {
                    type = mime
                    putExtra(Intent.EXTRA_STREAM, uri)
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                }
                ui.post { startActivity(Intent.createChooser(send, name)) }
                JSONObject().put("shared", true).toString()
            } catch (error: Exception) {
                JSONObject().put("shared", false).toString()
            }
        }

        @JavascriptInterface
        fun openExternal(url: String) {
            val uri = Uri.parse(url)
            if (uri.scheme == "http" || uri.scheme == "https") ui.post { openInBrowser(uri) }
        }

        @JavascriptInterface
        fun setTheme(theme: String) {
            ui.post {
                val dark = theme != "light"
                WindowInsetsControllerCompat(window, window.decorView).apply {
                    isAppearanceLightStatusBars = !dark
                    isAppearanceLightNavigationBars = !dark
                }
                web.setBackgroundColor(if (dark) APP_BACKGROUND else LIGHT_BACKGROUND)
            }
        }

        @JavascriptInterface
        fun exit() {
            ui.post { finish() }
        }

        @JavascriptInterface
        fun print() {
            ui.post { printCurrentPage() }
        }

        /* Les trois applications ne se connectent à aucun compte : la clé du
           fournisseur d'IA reste dans les réglages de l'appareil. */
        @JavascriptInterface
        fun cloudStatus(): String =
            JSONObject().put("connected", false).put("account", "").toString()

        @JavascriptInterface
        fun cloudConnect(@Suppress("UNUSED_PARAMETER") json: String): String =
            JSONObject().put("error", "Aucun compte cloud n'est utilisé par cette application.").toString()

        @JavascriptInterface
        fun cloudUpload(@Suppress("UNUSED_PARAMETER") json: String): String =
            JSONObject().put("ok", false).toString()

        @JavascriptInterface
        fun cloudDownload(@Suppress("UNUSED_PARAMETER") json: String): String =
            JSONObject().put("bytes", "").toString()
    }

    private fun mimeOf(token: String): String {
        val extension = token.lowercase().substringAfterLast('.', "")
        return when (extension) {
            "docx" -> "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            "dotx" -> "application/vnd.openxmlformats-officedocument.wordprocessingml.template"
            "doc", "docm" -> "application/msword"
            "xlsx" -> "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            "xls", "xlsm" -> "application/vnd.ms-excel"
            "pptx" -> "application/vnd.openxmlformats-officedocument.presentationml.presentation"
            "ppt" -> "application/vnd.ms-powerpoint"
            "csv" -> "text/csv"
            "tsv" -> "text/tab-separated-values"
            "md" -> "text/markdown"
            "txt" -> "text/plain"
            "html", "htm" -> "text/html"
            "rtf" -> "application/rtf"
            "odt" -> "application/vnd.oasis.opendocument.text"
            "ods" -> "application/vnd.oasis.opendocument.spreadsheet"
            "odp" -> "application/vnd.oasis.opendocument.presentation"
            "pdf" -> "application/pdf"
            "png" -> "image/png"
            "jpg", "jpeg" -> "image/jpeg"
            "gif" -> "image/gif"
            "webp" -> "image/webp"
            "bmp" -> "image/bmp"
            "svg" -> "image/svg+xml"
            "json" -> "application/json"
            "zip" -> "application/zip"
            else -> "*/*"
        }
    }

    /* ------------------------------------------------------------------ */
    /* Cycle de vie                                                        */
    /* ------------------------------------------------------------------ */

    override fun onResume() {
        super.onResume()
        web.onResume()
        web.resumeTimers()
        web.requestApplyInsets()
    }

    override fun onPause() {
        web.onPause()
        web.pauseTimers()
        super.onPause()
    }

    override fun onDestroy() {
        endListening()
        speech?.destroy()
        speech = null
        if (::web.isInitialized) web.destroy()
        super.onDestroy()
    }

    companion object {
        private const val MICROPHONE_REQUEST = 41
        const val TAG = "NemesisWorkspace"
        const val APP_DOMAIN = "appassets.androidplatform.net"
        const val APP_ORIGIN = "https://$APP_DOMAIN"

        private val APP_BACKGROUND = Color.parseColor("#0A011E")
        private val LIGHT_BACKGROUND = Color.parseColor("#ECEEF8")

        /**
         * Les compléments de DOM absents des moteurs anciens. Chaque méthode
         * n'est définie que si elle manque : sur un appareil à jour, ce script
         * ne change rien.
         */
        private val COMPATIBILITY = """
            (function () {
              if (typeof Element === 'undefined') return;
              var proto = Element.prototype;
              function nodes(list) {
                var out = [];
                for (var i = 0; i < list.length; i += 1) {
                  var item = list[i];
                  out.push(item && item.nodeType ? item : document.createTextNode(String(item)));
                }
                return out;
              }
              if (!proto.replaceChildren) {
                proto.replaceChildren = function () {
                  while (this.firstChild) this.removeChild(this.firstChild);
                  var add = nodes(arguments);
                  for (var i = 0; i < add.length; i += 1) this.appendChild(add[i]);
                };
              }
              if (!proto.append) {
                proto.append = function () {
                  var add = nodes(arguments);
                  for (var i = 0; i < add.length; i += 1) this.appendChild(add[i]);
                };
              }
              if (!proto.prepend) {
                proto.prepend = function () {
                  var add = nodes(arguments);
                  for (var i = 0; i < add.length; i += 1) {
                    this.insertBefore(add[i], this.firstChild);
                  }
                };
              }
              if (!proto.replaceWith) {
                proto.replaceWith = function () {
                  if (!this.parentNode) return;
                  var add = nodes(arguments);
                  for (var i = 0; i < add.length; i += 1) {
                    this.parentNode.insertBefore(add[i], this);
                  }
                  this.parentNode.removeChild(this);
                };
              }
              if (!proto.remove) {
                proto.remove = function () {
                  if (this.parentNode) this.parentNode.removeChild(this);
                };
              }
              if (typeof Element.prototype.toggleAttribute !== 'function') {
                Element.prototype.toggleAttribute = function (name, force) {
                  var on = arguments.length > 1 ? !!force : !this.hasAttribute(name);
                  if (on) this.setAttribute(name, ''); else this.removeAttribute(name);
                  return on;
                };
              }
              if (typeof Object.fromEntries !== 'function') {
                Object.fromEntries = function (entries) {
                  var out = {};
                  entries.forEach(function (pair) { out[pair[0]] = pair[1]; });
                  return out;
                };
              }
              if (typeof String.prototype.replaceAll !== 'function') {
                String.prototype.replaceAll = function (search, replacement) {
                  return this.split(search).join(replacement);
                };
              }
              if (typeof Array.prototype.flat !== 'function') {
                Array.prototype.flat = function (depth) {
                  var level = depth === undefined ? 1 : depth;
                  return level < 1 ? Array.prototype.slice.call(this)
                    : this.reduce(function (acc, item) {
                        return acc.concat(Array.isArray(item) ? item.flat(level - 1) : item);
                      }, []);
                };
              }
              if (typeof Array.prototype.at !== 'function') {
                Array.prototype.at = function (index) {
                  return this[index < 0 ? this.length + index : index];
                };
              }
              // Certains moteurs anciens n'ont pas le découpage en mots :
              // une approximation suffit (les lettres et les chiffres font
              // un mot, tout le reste un séparateur).
              if (typeof Intl !== 'undefined' && typeof Intl.Segmenter !== 'function') {
                var words = function (text) {
                  var out = [];
                  var buffer = '';
                  var start = 0;
                  var word = /[\p{L}\p{N}_]/u;
                  for (var i = 0; i < text.length; i += 1) {
                    var isWord = word.test(text[i]);
                    if (i === 0) { buffer = text[i]; start = 0; continue; }
                    if (isWord === word.test(buffer[buffer.length - 1])) {
                      buffer += text[i];
                    } else {
                      out.push({ segment: buffer, index: start, input: text, isWordLike: word.test(buffer[0]) });
                      buffer = text[i];
                      start = i;
                    }
                  }
                  if (buffer) out.push({ segment: buffer, index: start, input: text, isWordLike: word.test(buffer[0]) });
                  return out;
                };
                var Segmenter = function (locale, options) {
                  this.granularity = options && options.granularity;
                };
                Segmenter.prototype.segment = function (text) {
                  var list = this.granularity === 'word' ? words(String(text))
                    : Array.prototype.map.call(String(text), function (ch, i) {
                        return { segment: ch, index: i, input: String(text) };
                      });
                  list[Symbol.iterator] = function () { return Array.prototype[Symbol.iterator].call(list); };
                  return list;
                };
                Segmenter.supportedLocalesOf = function () { return []; };
                Intl.Segmenter = Segmenter;
              }
              if (typeof Promise.prototype.finally !== 'function') {
                Promise.prototype.finally = function (done) {
                  return this.then(
                    function (value) { done(); return value; },
                    function (error) { done(); throw error; }
                  );
                };
              }
            })();
        """.trimIndent()

        /** `window.print()` n'existe pas dans une vue intégrée : il pointe ici. */
        private const val PRINT_BRIDGE =
            "(()=>{if(window.__nemesisPrintReady)return;window.__nemesisPrintReady=true;" +
                "window.print=function(){" +
                "try{window.NemesisHost.print();}catch(e){console.warn('impression',e);}" +
                "setTimeout(()=>window.dispatchEvent(new Event('afterprint')),600);" +
                "};})();"

        /**
         * La dictée d'un navigateur n'existe pas dans la vue intégrée : celui-ci
         * reçoit à la place la reconnaissance vocale du système, derrière la
         * même interface (`SpeechRecognition`) — l'interface n'a donc rien à
         * changer pour que la dictée fonctionne.
         */
        private val DICTATION_BRIDGE = """
            (function () {
              if (window.__nemesisDictationReady) return;
              if (!window.NemesisHost || !window.NemesisHost.canDictate || !window.NemesisHost.canDictate()) return;
              window.__nemesisDictationReady = true;
              var listeners = {};
              window.__nemesisDictation = function (event) {
                var handler = listeners.result;
                if (!handler) return;
                var list = [{ transcript: event.text, confidence: 1 }];
                list.isFinal = !!event.final;
                handler({ resultIndex: 0, results: [list] });
              };
              window.__nemesisDictationState = function (state) {
                if (state === 'dictateDenied' && listeners.error) listeners.error({ error: 'not-allowed' });
                else if (state === 'dictateUnavailable' && listeners.error) listeners.error({ error: 'service-not-allowed' });
                else if (state === 'dictateStopped' && listeners.end) listeners.end();
              };
              function Reco() {
                this.continuous = true;
                this.interimResults = true;
                this.lang = 'fr-FR';
              }
              Reco.prototype.start = function () {
                window.NemesisHost.startDictation(this.lang || 'fr-FR');
              };
              Reco.prototype.stop = function () {
                window.NemesisHost.stopDictation();
                if (listeners.end) listeners.end();
              };
              Reco.prototype.abort = Reco.prototype.stop;
              Reco.prototype.addEventListener = function (type, handler) {
                listeners[type] = handler;
              };
              Reco.prototype.removeEventListener = function (type, handler) {
                if (listeners[type] === handler) delete listeners[type];
              };
              ['result', 'error', 'end'].forEach(function (name) {
                Object.defineProperty(Reco.prototype, 'on' + name, {
                  get: function () { return listeners[name] || null; },
                  set: function (handler) { listeners[name] = handler; },
                  configurable: true
                });
              });
              window.SpeechRecognition = Reco;
              window.webkitSpeechRecognition = Reco;
            })();
        """.trimIndent()

        /** Ce que l'écran affiche : titre, langue, taille, contenu, nature. */
        private val SCREEN_REPORT = """
            (function(){
              try{
                var cards=document.querySelectorAll('.tile,.card,.app-tile,[data-kind]').length;
                var editing=!!document.querySelector('.ed-header, .editor-header, [data-view="editor"]');
                var root=document.documentElement;
                if(!root||!document.body) return JSON.stringify({pending:true});
                return JSON.stringify({title:document.title,lang:root.lang,
                  width:Math.round(window.innerWidth),height:Math.round(window.innerHeight),
                  cards:cards,body:document.body.innerText.trim().length,
                  root:(document.getElementById('root')||{childElementCount:0}).childElementCount,
                  editing:editing,
                  path:location.pathname,
                  boot:String((window.__nemesisBootError||'')) .slice(0,300),
                  // La première tuile de l'accueil, en points CSS : de quoi
                  // la toucher depuis un appareil automatisé.
                  tuiles:(function(){var t=document.querySelectorAll('.app-card');
                    var a=t[0];if(!a)return null;var r=a.getBoundingClientRect();
                    return t.length+' '+Math.round(r.left+r.width/2)+','+Math.round(r.top+r.height/2);})()});
              }catch(e){return JSON.stringify({error:String(e)});}
            })()
        """.trimIndent()

        /**
         * Quitter le document en cours, comme le bouton de l'interface : le
         * nom accessible de ce bouton est le même dans les trois éditeurs.
         */
        private val LEAVE_DOCUMENT = """
            (function () {
              try {
                var back = document.querySelector(
                  '[aria-label="Back to documents"], [aria-label="Back to all spreadsheets"], [aria-label="Back to presentations"], [aria-label="All Documents"]',
                );
                if (back) { back.click(); return true; }
                // Le classeur et la présentation nomment leur accueil.
                var home = document.querySelector('.qat-btn[aria-label*="Documents"], [data-action="home"]');
                if (home) { home.click(); return true; }
                return false;
              } catch (e) {
                return false;
              }
            })()
        """.trimIndent()

        /**
         * Ce que le retour doit fermer avant de remonter dans l'historique.
         *
         * Un vrai dialogue ouvert (`<dialog open>`, `aria-modal`), un menu en
         * cours, ou le sélecteur des thèmes : l'interface les ferme comme le
         * ferait Échap. Rien d'autre : `aria-expanded="true"` est aussi l'état
         * d'un simple bouton dépliant, et fermer un volet de navigation ne doit
         * pas empêcher le retour de fonctionner.
         */
        private val BACK_SCRIPT = """
            (function () {
              try {
                var shown = function (node) {
                  if (!node || !node.getClientRects) return false;
                  if (node.getClientRects().length === 0) return false;
                  var style = window.getComputedStyle ? window.getComputedStyle(node) : null;
                  return !style || (style.visibility !== 'hidden' && style.display !== 'none');
                };
                var candidates = document.querySelectorAll(
                  '[aria-modal="true"], dialog[open], .popover.is-open, .menu.is-open',
                );
                for (var i = 0; i < candidates.length; i += 1) {
                  var node = candidates[i];
                  if (node.tagName === 'DIALOG' && !node.open) continue;
                  if (!shown(node)) continue;
                  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
                  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
                  return JSON.stringify({ handled: true, action: 'overlay' });
                }
                // Où sommes-nous ? Sur un document ouvert, sur la liste d'un
                // éditeur, ou sur l'accueil de l'espace ? Aucune barre oblique
                // inversée ici : ce texte vit dans une chaîne brute Kotlin.
                var here = location.pathname + location.hash;
                var tool = here.indexOf('/documents/') >= 0
                  || here.indexOf('/spreadsheet/') >= 0
                  || here.indexOf('/presentation/') >= 0;
                if (!tool) return JSON.stringify({ handled: true, action: 'exit' });
                var hash = location.hash || '';
                var editing;
                if (here.indexOf('/documents/') >= 0) {
                  // La liste porte l'adresse vide ou #/ ; le reste est un document.
                  editing = hash.indexOf('#/edit/') === 0 || hash.indexOf('#/new/') === 0;
                } else if (here.indexOf('/spreadsheet/') >= 0) {
                  // Sans adresse, le tableur ouvre directement une feuille neuve.
                  editing = hash === '' || hash === '#'
                    || hash.indexOf('#/edit/') === 0 || hash.indexOf('#/new/') === 0;
                } else {
                  // La présentation nomme sa liste #/home.
                  editing = hash.indexOf('#/') === 0 && hash !== '#/home';
                }
                if (!editing) return JSON.stringify({ handled: true, action: 'tool' });
                return JSON.stringify({ handled: true, action: 'document' });
              } catch (e) {
                return JSON.stringify({ handled: true, action: 'exit', error: String(e) });
              }
            })()
        """.trimIndent()
    }
}
