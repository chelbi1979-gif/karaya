# -*- coding: utf-8 -*-
"""
lanceur_pro.py — Lanceur de « نظام إدارة الكراء »
======================================================================

CE QUI A CHANGÉ (et pourquoi la version compilée perdait l'interface)
---------------------------------------------------------------------
1) RESSOURCES (_MEIPASS)
   En onefile, PyInstaller extrait les fichiers dans sys._MEIPASS. Tout
   chemin calculé avec __file__ ou os.getcwd() pointe alors dans le
   dossier temporaire du bootloader ou dans « C:\\Windows\\System32 »
   (raccourci Inno Setup) -> index.html « introuvable », ou index.html
   trouvé mais karaya-*.js absents -> pas de bouton langue / cloud.
   => resource_path() unique, basé sur sys._MEIPASS.

2) PLUS DE FENÊTRE D'ERREUR BLOQUANTE
   L'ancienne version affichait une MessageBox « Fichiers web manquants »
   AVANT d'ouvrir la fenêtre : l'utilisateur voyait une erreur et
   l'application semblait cassée. Désormais : on journalise, on avertit
   sans bloquer, et l'application démarre toujours.

3) SERVEUR LOCAL
   Toujours http://127.0.0.1:<port> (origine réelle -> CORS, localStorage,
   SDK Supabase, service worker). Le dossier servi est celui des
   ressources extraites. Repli file:// seulement en dernier recours.

4) SYNCHRONISATION AUTOMATIQUE
   sync.py n'est plus un script séparé à lancer à la main : un thread
   démon démarre avec l'application, pousse les données locales et
   journalise proprement. L'API JS expose en plus :
       cloud_sync_now() / cloud_sync_state() / app_info()

5) COMPATIBILITÉ PYARMOR / PYINSTALLER / INNO SETUP
   Aucun chemin dépendant du CWD, aucun import tierce obligatoire
   (sync.py = bibliothèque standard), journal karaya.log toujours actif.
"""

import functools
import http.server
import os
import shutil
import socketserver
import sys
import threading
import traceback

# --- certificats HTTPS : indispensable en version compilée ---------------
try:
    import certifi

    _CA = certifi.where()
    os.environ.setdefault("SSL_CERT_FILE", _CA)
    os.environ.setdefault("REQUESTS_CA_BUNDLE", _CA)
except Exception:
    _CA = ""

try:
    import webview
except Exception:                                     # pragma: no cover
    webview = None

from db_bridge import Api, log_line, _ressource_dir, _appdata_dir

try:
    import sync as ksync
except Exception as _exc:                              # ne bloque jamais
    ksync = None
    try:
        log_line("sync.py indisponible : %s" % _exc)
    except Exception:
        pass

APP_TITLE = u"نظام إدارة الكراء"
APP_VERSION = "3.0"
INDEX = "index.html"
# karaya-boot.js est INDISPENSABLE : c'est lui qui crée les boutons
# langue (ع/FR) et cloud (☁️). Sans lui, l'interface « perd » la
# traduction et le cloud — c'était le symptôme constaté.
MODULES = [
    "karaya-keys.js",
    "karaya-i18n.js",
    "karaya-license.js",
    "karaya-store.js",
    "karaya-boot.js",
    "karaya-cloud.js",
]
# manifest.webmanifest n'existe plus : renommé manifest.json (PWABuilder).
# Les icônes sont copiées aussi, sinon le manifest du bundle pointe sur des
# fichiers absents du dossier _MEIPASS (404 dans la console WebView).
OPTIONNELS = [
    "sw.js",
    "manifest.json",
    "icon-192.png",
    "icon-512.png",
    "icon-maskable-192.png",
    "icon-maskable-512.png",
    "apple-touch-icon.png",
    "favicon-32.png",
]
RESSOURCES_WEB = [INDEX] + MODULES


# ---------------------------------------------------------------------------
#  Chemin des ressources (une seule source de vérité)
# ---------------------------------------------------------------------------
def resource_path(*parts):
    """Chemin d'une ressource embarquée : sys._MEIPASS si gelé, sinon script."""
    base = getattr(sys, "_MEIPASS", "") or os.path.dirname(os.path.abspath(__file__))
    return os.path.join(base, *parts) if parts else base


def _exe_dir():
    try:
        if getattr(sys, "frozen", False):
            return os.path.dirname(os.path.abspath(sys.executable))
    except Exception:
        pass
    return os.path.dirname(os.path.abspath(__file__))


# ---------------------------------------------------------------------------
#  Messages (jamais bloquants avant l'ouverture de la fenêtre)
# ---------------------------------------------------------------------------
def _message(titre, texte, icone=0x10):
    try:
        import ctypes
        ctypes.windll.user32.MessageBoxW(None, texte, titre, icone)
        return True
    except Exception:
        try:
            print(texte)
        except Exception:
            pass
        return False


def _erreur_fatale(message, detail=""):
    log_line("ERREUR FATALE: %s | %s" % (message, detail))
    texte = message + ("\n\n" + detail if detail else "")
    texte += "\n\nJournal : " + os.path.join(_appdata_dir(), "data", "karaya.log")
    _message(APP_TITLE, texte, 0x10)


def _avertissement(message, detail=""):
    log_line("AVERTISSEMENT: %s | %s" % (message, detail))
    _message(APP_TITLE, message + ("\n\n" + detail if detail else ""), 0x30)


# ---------------------------------------------------------------------------
#  Localisation du dossier web
# ---------------------------------------------------------------------------
def _dossiers_candidats():
    candidats = []
    if getattr(sys, "frozen", False):
        candidats.append(getattr(sys, "_MEIPASS", ""))
        d = _exe_dir()
        candidats += [d, os.path.join(d, "_internal"), os.path.join(d, "web")]
    ici = os.path.dirname(os.path.abspath(__file__))
    candidats += [ici, os.path.join(ici, "obf"), os.path.dirname(ici),
                  os.path.join(ici, "web")]
    candidats.append(_ressource_dir())
    candidats.append(os.path.join(_appdata_dir(), "web"))
    out = []
    for d in candidats:
        if d and os.path.isdir(d) and d not in out:
            out.append(d)
    return out


def _chercher_fichier(nom, dossier, profondeur=3):
    direct = os.path.join(dossier, nom)
    if os.path.isfile(direct):
        return direct
    if profondeur <= 0:
        return ""
    try:
        for entree in sorted(os.listdir(dossier)):
            sous = os.path.join(dossier, entree)
            if os.path.isdir(sous):
                trouve = _chercher_fichier(nom, sous, profondeur - 1)
                if trouve:
                    return trouve
    except Exception:
        pass
    return ""


def localiser_web():
    """Retourne (dossier_web, manquants). Jamais d'exception."""
    dossier_index = ""
    for d in _dossiers_candidats():
        if os.path.isfile(os.path.join(d, INDEX)):
            dossier_index = d
            break
    if not dossier_index:
        return "", RESSOURCES_WEB[:]

    manquants = [m for m in MODULES if not os.path.isfile(os.path.join(dossier_index, m))]
    if not manquants:
        log_line("web = %s (complet)" % dossier_index)
        return dossier_index, []

    # modules dispersés (bundle PyArmor/PyInstaller) : on tente de les réunir
    trouves = {}
    for nom in MODULES:
        for d in _dossiers_candidats():
            chemin = _chercher_fichier(nom, d)
            if chemin:
                trouves[nom] = chemin
                break
    if len(trouves) < len(MODULES):
        absents = [m for m in MODULES if m not in trouves]
        log_line("modules absents du bundle : %s" % ", ".join(absents))
        return dossier_index, absents

    cible = os.path.join(_appdata_dir(), "web")
    try:
        os.makedirs(cible, exist_ok=True)
        for nom in RESSOURCES_WEB + OPTIONNELS:
            src = trouves.get(nom) or os.path.join(dossier_index, nom)
            if os.path.isfile(src):
                shutil.copy2(src, os.path.join(cible, nom))
        log_line("web réuni dans %s" % cible)
        return cible, []
    except Exception as exc:
        log_line("échec copie web : %s" % exc)
        return dossier_index, [m for m in MODULES if m not in trouves]


# ---------------------------------------------------------------------------
#  Serveur HTTP local
# ---------------------------------------------------------------------------
# MIME corrects : sans cela .webmanifest part en application/octet-stream
# et le manifeste est ignoré par le moteur (WebView2 / navigateur).
try:
    import mimetypes
    mimetypes.add_type("application/manifest+json", ".webmanifest")
    mimetypes.add_type("application/manifest+json", ".json")
    mimetypes.add_type("text/javascript", ".js")
except Exception:
    pass


class _HandlerSilencieux(http.server.SimpleHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Access-Control-Allow-Origin", "*")
        try:
            http.server.SimpleHTTPRequestHandler.end_headers(self)
        except Exception:
            pass

    def copyfile(self, source, outputfile):
        try:
            shutil.copyfileobj(source, outputfile)
        except (BrokenPipeError, ConnectionResetError):
            pass


class _Serveur(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


def demarrer_serveur_web(dossier):
    if not dossier or not os.path.isdir(dossier):
        return None, ""
    handler = functools.partial(_HandlerSilencieux, directory=dossier)
    for port in range(8731, 8790):
        try:
            httpd = _Serveur(("127.0.0.1", port), handler)
        except OSError:
            continue
        except Exception as exc:
            log_line("serveur web: %s" % exc)
            return None, ""
        try:
            threading.Thread(target=httpd.serve_forever, daemon=True).start()
        except Exception as exc:
            log_line("serveur web (thread): %s" % exc)
            return None, ""
        url = "http://127.0.0.1:%d/index.html" % port
        log_line("serveur web: %s -> %s" % (dossier, url))
        return httpd, url
    log_line("serveur web: aucun port libre entre 8731 et 8789")
    return None, ""


# ---------------------------------------------------------------------------
#  API exposée à JavaScript = Api (db_bridge) + points d'entrée cloud
# ---------------------------------------------------------------------------
class ApiPlus(Api):
    """Ajoute la synchronisation à l'API existante, sans toucher db_bridge."""

    def __init__(self, base_path=None):
        Api.__init__(self, base_path)
        self._sync_state = {"ok": None, "action": "", "at": "", "error": "", "rev": 0}
        self._sync_stop = None

    # --- lecture de la base locale (jamais d'exception vers JS) ---
    def local_db(self):
        try:
            r = self.db_load()
            return r.get("db") if isinstance(r, dict) else None
        except Exception as exc:
            log_line("local_db: %s" % exc)
            return None

    # --- exposé à JS ---
    def cloud_sync_now(self):
        if ksync is None:
            return {"ok": False, "error": "module sync.py absent du bundle"}
        try:
            res = ksync.sync_once(self.local_db())
        except Exception as exc:
            res = {"ok": False, "error": "%s" % exc}
        self._sync_state = {
            "ok": bool(res.get("ok")), "action": res.get("action", ""),
            "error": res.get("error", ""), "rev": res.get("rev", 0),
            "at": __import__("time").strftime("%H:%M:%S"),
        }
        return res

    def cloud_sync_state(self):
        return dict(self._sync_state)

    def cloud_health(self):
        if ksync is None:
            return {"ok": False, "error": "module sync.py absent du bundle"}
        try:
            return ksync.health()
        except Exception as exc:
            return {"ok": False, "error": "%s" % exc}

    def app_info(self):
        dossier, manquants = localiser_web()
        return {
            "version": APP_VERSION, "frozen": bool(getattr(sys, "frozen", False)),
            "meipass": getattr(sys, "_MEIPASS", ""), "exe": _exe_dir(),
            "web": dossier, "missing": manquants, "certifi": _CA,
            "sync": ksync is not None, "data": _appdata_dir(),
        }


# ---------------------------------------------------------------------------
#  Démarrage de la synchronisation de fond
# ---------------------------------------------------------------------------
def demarrer_sync_auto(api):
    if ksync is None:
        log_line("sync auto: module absent")
        return None
    try:
        th, stop = ksync.start_background(get_local=api.local_db, interval=ksync.INTERVAL)
        api._sync_stop = stop
        log_line("sync auto: thread %s" % th.name)
        return stop
    except Exception as exc:
        log_line("sync auto indisponible : %s" % exc)
        return None


# ---------------------------------------------------------------------------
#  Compatibilité anciens noms
# ---------------------------------------------------------------------------
def trouver_index():
    dossier, _ = localiser_web()
    return os.path.join(dossier, INDEX) if dossier else ""


def verifier_ressources(chemin_html):
    dossier = os.path.dirname(chemin_html)
    return [m for m in MODULES if not os.path.isfile(os.path.join(dossier, m))]


# ---------------------------------------------------------------------------
#  main
# ---------------------------------------------------------------------------
def main():
    log_line("=== Karaya %s | frozen=%s | _MEIPASS=%s ==="
             % (APP_VERSION, bool(getattr(sys, "frozen", False)),
                getattr(sys, "_MEIPASS", "")))

    if webview is None:
        _erreur_fatale("Le module 'pywebview' est introuvable.",
                       "Réinstallez l'application (pip install pywebview).")
        return 1

    dossier_web, manquants = localiser_web()
    if not dossier_web:
        _erreur_fatale(
            "index.html est introuvable dans l'application.",
            "Emplacements examinés :\n- " + "\n- ".join(_dossiers_candidats()[:6]))
        return 1

    chemin_html = os.path.join(dossier_web, INDEX)
    if manquants:
        # Avertissement NON bloquant : la fenêtre s'ouvre quand même.
        log_line("modules manquants : %s" % ", ".join(manquants))
        if "karaya-boot.js" in manquants:
            _avertissement(
                "karaya-boot.js est absent du paquet : les boutons Langue "
                "et Cloud ne pourront pas être créés.",
                "Dossier : " + dossier_web + "\n\n"
                "Reconstruisez avec le .spec corrigé :\n"
                "    pyarmor gen -O obf lanceur_pro.py db_bridge.py sync.py\n"
                "    pyinstaller --noconfirm --clean Karaya_onefile.spec")
    else:
        log_line("index.html = %s" % chemin_html)

    try:
        api = ApiPlus()
    except Exception as exc:
        _erreur_fatale("Impossible d'initialiser la base de données.", "%s" % exc)
        return 1

    serveur, url_web = demarrer_serveur_web(dossier_web)
    if url_web:
        url = url_web
    else:
        url = "file:///" + chemin_html.replace(os.sep, "/")
        log_line("serveur indisponible -> repli sur %s" % url)

    storage_dir = os.path.join(_appdata_dir(), "storage")
    try:
        os.makedirs(storage_dir, exist_ok=True)
    except Exception:
        storage_dir = ""

    kwargs = dict(title=APP_TITLE, url=url, js_api=api,
                  width=1100, height=800, resizable=True, text_select=True)
    try:
        fenetre = webview.create_window(private_mode=False, storage_path=storage_dir, **kwargs)
    except TypeError:
        log_line("pywebview: private_mode/storage_path non supportés")
        fenetre = webview.create_window(**kwargs)

    stop_sync = demarrer_sync_auto(api)

    def _on_closing():
        try:
            log_line("sauvegarde fermeture: %s" % (api.on_close(),))
        except Exception as exc:
            log_line("sauvegarde fermeture: %s" % exc)
        finally:
            try:
                if stop_sync:
                    stop_sync.set()
            except Exception:
                pass
            try:
                if serveur:
                    serveur.shutdown()
            except Exception:
                pass

    try:
        fenetre.events.closing += _on_closing          # pywebview >= 3.4
    except Exception:
        log_line("events.closing indisponible : atexit sera utilisé")

    webview.start(debug=False)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main() or 0)
    except SystemExit:
        raise
    except Exception:
        _erreur_fatale("Erreur inattendue au démarrage.", traceback.format_exc())
        sys.exit(1)
