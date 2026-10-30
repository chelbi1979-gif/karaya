package com.karaya.app

/* =====================================================================
   KarayaNativeBridge.kt — pont JavaScript ⇄ Kotlin
   =====================================================================
   RÔLE : donner à karaya-boot.js (window.AndroidBridge) la possibilité
   d'écrire un JSON de sauvegarde daté dans un sous-dossier PRIVÉ de
   l'application :
        /data/data/com.karaya.app/files/backups/AAAA-MM-JJ.json
   (aucune permission Android n'est nécessaire : c'est filesDir, propre
    à l'application, effacé seulement à la désinstallation.)

   ⚠️ IMPORTANT À LIRE AVANT D'INSTALLER
   ---------------------------------------------------------------------
   Un APK généré par PWABuilder en mode TWA (Trusted Web Activity) ne
   contient AUCUNE WebView pilotée par vous : c'est Chrome qui affiche
   la page, dans un autre processus. addJavascriptInterface() n'y existe
   donc pas et window.AndroidBridge restera indéfini : c'est normal.

   Trois façons d'avoir ce pont, de la plus simple à la plus intégrée :
     1) ce fichier + MainActivity (WebView locale)  ← pont réel, testé ici
     2) Capacitor (le plugin Filesystem écrit déjà dans l'app)
     3) TWA seul → pas de pont : karaya-boot.js basculera automatiquement
        sur OPFS + export (téléchargement) — voir le repli dans boot.js.

   Pour le cas (1), dans build.gradle :
        android { defaultConfig { minSdkVersion 23 } }
   Dans AndroidManifest.xml :
        <uses-permission android:name="android.permission.INTERNET"/>
        <application android:usesCleartextTraffic="false" ...>
          <activity android:name=".MainActivity"
                    android:configChanges="orientation|screenSize|keyboardHidden"
                    android:exported="true">
            <intent-filter>
              <action android:name="android.intent.action.MAIN"/>
              <category android:name="android.intent.category.LAUNCHER"/>
            </intent-filter>
          </activity>
        </application>
   ===================================================================== */

import android.annotation.SuppressLint
import android.content.ContentValues
import android.content.Context
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.provider.MediaStore
import android.view.View
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.appcompat.app.AppCompatActivity
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/* =====================================================================
   1. L'ACTIVITÉ : une WebView, un pont, l'URL de l'application
   ===================================================================== */
class MainActivity : AppCompatActivity() {

    private lateinit var web: WebView
    private lateinit var bridge: KarayaBridge

    @SuppressLint("SetJavaScriptEnabled", "AddJavascriptInterface")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        web = WebView(this)
        setContentView(web)

        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true          // localStorage : indispensable
            databaseEnabled = true
            loadWithOverviewMode = true
            useWideViewPort = true
            builtInZoomControls = false
            mediaPlaybackRequiresUserGesture = false
            cacheMode = WebSettings.LOAD_DEFAULT
            // sécurité : la page ne doit pas lire les fichiers du téléphone
            allowFileAccess = false
            allowContentAccess = false
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            }
        }

        CookieManager.getInstance().setAcceptCookie(true)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            CookieManager.getInstance().setAcceptThirdPartyCookies(web, true)
        }

        bridge = KarayaBridge(this)
        // ⇐ le nom "AndroidBridge" est celui que karaya-boot.js détecte
        web.addJavascriptInterface(bridge, "AndroidBridge")

        // WebChromeClient par défaut : on ne demande AUCUNE permission
        // (ni notification, ni géoloc) — rien ne s'affiche à l'utilisateur.
        web.webChromeClient = WebChromeClient()

        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(v: WebView, r: WebResourceRequest): Boolean {
                val host = r.url.host ?: return true
                // on reste dans l'app pour l'origine de l'application
                return !(host == "chelbi1979-gif.github.io" || host.endsWith("github.io"))
            }
        }

        web.loadUrl(START_URL)
    }

    override fun onBackPressed() {
        if (web.canGoBack()) web.goBack() else super.onBackPressed()
    }

    override fun onPause() { super.onPause(); web.onPause() }
    override fun onResume() { super.onResume(); web.onResume() }

    companion object {
        // même URL que le manifest.json (start_url)
        const val START_URL = "https://chelbi1979-gif.github.io/karaya/"
    }
}

/* =====================================================================
   2. LE PONT : méthodes @JavascriptInterface appelées par boot.js
   ---------------------------------------------------------------------
   Toutes les méthodes renvoient une CHAÎNE JSON (synchrone, comme l'exige
   Android) : {"ok":true,...} ou {"ok":false,"error":"..."}.
   ===================================================================== */
class KarayaBridge(private val ctx: Context) {

    private val root: File
        get() = File(ctx.filesDir, SUBDIR).apply { if (!exists()) mkdirs() }

    private fun today(): String =
        SimpleDateFormat("yyyy-MM-dd", Locale.FRANCE).format(Date())

    /* --- test de présence (boot.js peut l'appeler avant tout) --- */
    @JavascriptInterface
    fun ping(): String = """{"ok":true,"engine":"karaya-kotlin","api":1,"dir":"${root.absolutePath}"}"""

    @JavascriptInterface
    fun appDir(): String = root.absolutePath

    /* -----------------------------------------------------------------
       saveJson(name, json)
         name : "2026-10-30" ou "2026-10-30.json" ou "karaya_2026-10-30"
         - écrit (en écrasant) le fichier du jour → une seule version par
           date, la plus récente : le disque ne grossit pas indéfiniment.
         - rotation : garde les N derniers jours (90 par défaut).
       ----------------------------------------------------------------- */
    @JavascriptInterface
    fun saveJson(name: String?, json: String?): String {
        return try {
            if (json == null || json.isEmpty()) return err("json vide")
            val date = normalizeDate(name)
            if (date == null) return err("nom de date invalide")

            val f = File(root, "$date.json")
            val tmp = File(root, "$date.json.tmp")
            tmp.writeText(json, Charsets.UTF_8)      // écriture atomique
            if (f.exists()) f.delete()
            if (!tmp.renameTo(f)) { tmp.copyTo(f, overwrite = true); tmp.delete() }

            val pruned = prune(90)
            """{"ok":true,"file":"${f.name}","path":"${f.absolutePath}","bytes":${f.length()},"pruned":$pruned,"date":"$date"}"""
        } catch (e: Exception) {
            err(e.message ?: e.javaClass.simpleName)
        }
    }

    /* Liste les sauvegardes : [{"date":"2026-10-30","bytes":12345,"at":...}] */
    @JavascriptInterface
    fun list(): String {
        return try {
            val arr = JSONArray()
            files().forEach { f ->
                arr.put(JSONObject().apply {
                    put("date", f.name.removeSuffix(".json"))
                    put("bytes", f.length())
                    put("at", f.lastModified())
                })
            }
            JSONObject().put("ok", true).put("dir", root.absolutePath).put("files", arr).toString()
        } catch (e: Exception) { err(e.message ?: "list") }
    }

    /* Relit une sauvegarde (restauration depuis l'app) */
    @JavascriptInterface
    fun read(date: String?): String {
        return try {
            val d = normalizeDate(date) ?: return err("date invalide")
            val f = File(root, "$d.json")
            if (!f.exists()) return err("fichier absent")
            JSONObject().put("ok", true).put("date", d).put("json", f.readText(Charsets.UTF_8)).toString()
        } catch (e: Exception) { err(e.message ?: "read") }
    }

    /* Supprime une sauvegarde */
    @JavascriptInterface
    fun remove(date: String?): String {
        return try {
            val d = normalizeDate(date) ?: return err("date invalide")
            val f = File(root, "$d.json")
            val ok = f.exists() && f.delete()
            JSONObject().put("ok", ok).toString()
        } catch (e: Exception) { err(e.message ?: "remove") }
    }

    /* -----------------------------------------------------------------
       Export d'une sauvegarde vers le dossier « Téléchargements » du
       téléphone (visible par l'utilisateur, sauvegardable sur Drive).
       Aucune permission : MediaStore (API 29+) / chemin public (API < 29)
       ----------------------------------------------------------------- */
    @JavascriptInterface
    fun export(date: String?): String {
        return try {
            val d = normalizeDate(date) ?: return err("date invalide")
            val f = File(root, "$d.json")
            if (!f.exists()) return err("fichier absent")
            val name = "karaya-$d.json"

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                val values = ContentValues().apply {
                    put(MediaStore.Downloads.DISPLAY_NAME, name)
                    put(MediaStore.Downloads.MIME_TYPE, "application/json")
                    put(MediaStore.Downloads.IS_PENDING, 1)
                }
                val uri = ctx.contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
                    ?: return err("MediaStore refusé")
                ctx.contentResolver.openOutputStream(uri)?.use { out ->
                    f.inputStream().use { it.copyTo(out) }
                }
                values.clear(); values.put(MediaStore.Downloads.IS_PENDING, 0)
                ctx.contentResolver.update(uri, values, null, null)
                """{"ok":true,"uri":"$uri"}"""
            } else {
                @Suppress("DEPRECATION")
                val dir = File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), "Karaya")
                if (!dir.exists()) dir.mkdirs()
                val out = File(dir, name)
                f.copyTo(out, overwrite = true)
                """{"ok":true,"path":"${out.absolutePath}"}"""
            }
        } catch (e: Exception) { err(e.message ?: "export") }
    }

    /* -----------------------------------------------------------------
       INFORMATIONS APPAREIL (facultatif, pour la licence)
       ----------------------------------------------------------------- */
    @JavascriptInterface
    fun deviceId(): String {
        // identifiant stable mais non intrusif : pas d'IMEI, pas de compte
        val prefs = ctx.getSharedPreferences("karaya", Context.MODE_PRIVATE)
        var id = prefs.getString("device_id", null)
        if (id == null) {
            id = java.util.UUID.randomUUID().toString()
            prefs.edit().putString("device_id", id).apply()
        }
        return """{"ok":true,"id":"$id","model":"${Build.MODEL}","sdk":${Build.VERSION.SDK_INT}}"""
    }

    /* ============================ interne ============================ */

    private fun files(): List<File> =
        root.listFiles { f -> f.isFile && f.name.endsWith(".json") }
            ?.sortedByDescending { it.name } ?: emptyList()

    private fun prune(keep: Int): Int {
        val all = files()
        if (all.size <= keep) return 0
        var n = 0
        all.drop(keep).forEach { if (it.delete()) n++ }
        return n
    }

    /** "2026-10-30", "2026-10-30.json", "2026_10_30" → "2026-10-30" */
    private fun normalizeDate(name: String?): String? {
        if (name == null) return null
        val m = Regex("(\\d{4})[-_.]?(\\d{2})[-_.]?(\\d{2})").find(name) ?: return null
        return "${m.groupValues[1]}-${m.groupValues[2]}-${m.groupValues[3]}"
    }

    private fun err(msg: String): String =
        JSONObject().put("ok", false).put("error", msg).toString()

    companion object { const val SUBDIR = "backups" }
}
