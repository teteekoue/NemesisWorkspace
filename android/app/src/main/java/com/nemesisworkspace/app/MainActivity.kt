package com.nemesisworkspace.app

import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
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
import androidx.core.content.FileProvider
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.webkit.WebViewAssetLoader
import org.json.JSONArray
import org.json.JSONObject
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

    private lateinit var assetLoader: WebViewAssetLoader

    private val openDocument = registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        deliverPick(uri?.let { listOf(it) } ?: emptyList())
    }

    private val openDocuments = registerForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
        deliverPick(uris ?: emptyList())
    }

    private val createDocument = registerForActivityResult(ActivityResultContracts.CreateDocument("application/octet-stream")) { uri ->
        deliverSave(uri)
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
            }

            override fun onPageFinished(view: WebView, url: String) {
                super.onPageFinished(view, url)
                deliverIncoming()
                // Le seul raccord que l'interface attend : l'impression passe
                // par le service d'impression Android, qui sait aussi produire
                // un PDF.
                view.evaluateJavascript(PRINT_BRIDGE, null)
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
    private var editingDocument = false

    /**
     * L'écran affiché est-il celui d'un éditeur (sa liste ou un document),
     * plutôt que l'accueil de l'espace ?
     */
    private var inTool = false

    /** Note l'écran rapporté par l'interface et le laisse dans le journal. */
    private fun reportScreen(report: String?) {
        if (report.isNullOrBlank() || report == "null") return
        Log.i(TAG, "interface prête: $report")
        editingDocument = report.contains("\"editing\":true")
        // Les trois éditeurs vivent sous leur propre page ; l'accueil de
        // l'espace de travail est la racine.
        inTool = Regex("\"path\":\"/(documents|spreadsheet|presentation)/").containsMatchIn(report)
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
        web.evaluateJavascript(BACK_SCRIPT) { result ->
            val handled = result.contains("\"handled\":true")
            Log.i(TAG, "retour : $result (document=$editingDocument)")
            when {
                // Un dialogue ou un menu ouvert se ferme d'abord.
                handled -> Unit
                // Dans un document, le retour remonte à sa liste (l'interface
                // sait le faire, comme son propre bouton).
                editingDocument -> web.evaluateJavascript(LEAVE_DOCUMENT, null)
                // Depuis la liste d'un éditeur, il remonte à l'accueil de
                // l'espace de travail, qui réunit les trois éditeurs.
                inTool -> web.loadUrl("$APP_ORIGIN/index.html")
                // Depuis cet accueil, il quitte l'application.
                else -> finish()
            }
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
                JSONObject()
                    .put("name", displayName(uri) ?: "document")
                    .put("location", "Documents")
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
        if (::web.isInitialized) web.destroy()
        super.onDestroy()
    }

    companion object {
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
                var open = null;
                for (var i = 0; i < candidates.length; i += 1) {
                  var node = candidates[i];
                  if (node.tagName === 'DIALOG' && !node.open) continue;
                  if (!shown(node)) continue;
                  open = node;
                  break;
                }
                if (!open) return JSON.stringify({ handled: false });
                var found = open.tagName.toLowerCase()
                  + (open.className && typeof open.className === 'string' ? '.' + open.className.trim().split(/\s+/).join('.') : '')
                  + (open.id ? '#' + open.id : '');
                document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
                window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
                return JSON.stringify({ handled: true, found: found });
              } catch (e) {
                return JSON.stringify({ handled: false, error: String(e) });
              }
            })()
        """.trimIndent()
    }
}
