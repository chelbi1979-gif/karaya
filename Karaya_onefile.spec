# -*- mode: python ; coding: utf-8 -*-
"""
Karaya_onefile.spec — build PyInstaller (compatible PyArmor 8/9)
======================================================================
CHAÎNE DE BUILD CORRECTE (une seule, sans doublon) :

    rmdir /s /q build dist obf
    pyarmor gen -O obf lanceur_pro.py db_bridge.py sync.py
    pyinstaller --noconfirm --clean Karaya_onefile.spec

NE PAS faire :
    pyarmor gen --pack . lanceur_pro.py        <-- construit DÉJÀ un exe
    pyinstaller --noconfirm --clean Karaya_onefile.spec
  parce que --pack fabrique son propre exe (dans dist/) que le second
  build écrase, sans les datas du .spec : d'où « la traduction et le
  cloud disparaissent ». On obfusque D'ABORD (gen -O obf), on package
  ENSUITE avec ce .spec.

CE QUE CE SPEC GARANTIT :
  * tous les fichiers web sont embarqués, y compris karaya-boot.js
    (sans lui : pas de boutons ع/FR ni ☁️) ;
  * l'entrée utilisée est la version OBFUSQUÉE si obf/ existe ;
  * pyarmor_runtime_000000 est inclus comme donnée ET comme import ;
  * certifi est embarqué (CERTIFICATE_VERIFY_FAILED sinon) ;
  * pythonnet/clr sont collectés : sans eux, WebView2 (Edge) n'est pas
    disponible et pywebview bascule sur un backend qui casse le JS.
"""

import os

from PyInstaller.utils.hooks import collect_data_files, collect_submodules

ROOT = os.path.abspath(globals().get("SPECPATH") or os.path.dirname(SPEC))   # noqa: F821
os.chdir(ROOT)

# ---------------------------------------------------------------------------
#  Fichiers web — recherche large (racine, obf/, web/, _internal/)
# ---------------------------------------------------------------------------
ASSETS = [
    "index.html",
    "karaya-i18n.js",
    "karaya-keys.js",
    "karaya-license.js",
    "karaya-store.js",
    "karaya-boot.js",        # INDISPENSABLE (boutons langue + cloud)
    "karaya-cloud.js",
    "sw.js",
    # --- PWA : manifest + icônes (manifest.webmanifest N'EXISTE PLUS) ---
    "manifest.json",
    "icon-192.png",
    "icon-512.png",
    "icon-maskable-192.png",
    "icon-maskable-512.png",
    "apple-touch-icon.png",
    "favicon-32.png",
]
BASES = [".", "obf", "web", "_internal", os.path.join("obf", "web")]

datas = []
MANQUANTS = []
for nom in ASSETS:
    trouve = ""
    for base in BASES:
        src = os.path.join(ROOT, base, nom)
        if os.path.isfile(src):
            trouve = src
            break
    if trouve:
        datas.append((trouve, "."))
    else:
        MANQUANTS.append(nom)

if MANQUANTS:
    raise SystemExit(
        "\n[Karaya] Fichiers web absents du dossier de build : %s\n"
        "Placez-les à côté de Karaya_onefile.spec puis relancez.\n"
        % ", ".join(MANQUANTS))

# ---------------------------------------------------------------------------
#  Entrée : version obfusquée si présente
# ---------------------------------------------------------------------------
ENTRY = os.path.join(ROOT, "lanceur_pro.py")
PATHEX = [ROOT]
obf_entry = os.path.join(ROOT, "obf", "lanceur_pro.py")
if os.path.isfile(obf_entry):
    ENTRY = obf_entry
    PATHEX.insert(0, os.path.join(ROOT, "obf"))

# ---------------------------------------------------------------------------
#  Runtime PyArmor
# ---------------------------------------------------------------------------
rt = ""
for base in ("obf", "."):
    cand = os.path.join(ROOT, base, "pyarmor_runtime_000000")
    if os.path.isdir(cand):
        rt = cand
        break
if rt:
    datas.append((rt, "pyarmor_runtime_000000"))

# ---------------------------------------------------------------------------
#  Données tierces
# ---------------------------------------------------------------------------
datas += collect_data_files("certifi")
try:
    datas += collect_data_files("webview")
except Exception:
    pass

# ---------------------------------------------------------------------------
#  Imports cachés
# ---------------------------------------------------------------------------
hiddenimports = [
    # application
    "db_bridge",
    "sync",
    # interface
    "webview",
    "webview.http",
    "webview.platforms.edgechromium",
    "webview.platforms.winforms",
    "webview.platforms.mshtml",
    "webview.platforms.qt",
    # WebView2 / .NET
    "clr",
    "clr_loader",
    "pythonnet",
    # divers
    "cryptography",
    "cryptography.fernet",
    "sqlite3",
    "http.server",
    "socketserver",
    "ssl",
    "urllib.request",
    "urllib.error",
    "certifi",
]
for mod in ("webview",):
    try:
        hiddenimports += collect_submodules(mod)
    except Exception:
        pass

# Supabase côté Python : FACULTATIF depuis que sync.py utilise la
# bibliothèque standard. On l'embarque seulement s'il est installé
# (aucune erreur s'il est absent).
for mod in ("supabase", "postgrest", "gotrue", "realtime", "storage3", "httpx"):
    try:
        hiddenimports.append(mod)
        hiddenimports += collect_submodules(mod)
    except Exception:
        pass

if rt:
    hiddenimports.append("pyarmor_runtime_000000")

# ---------------------------------------------------------------------------
#  Analyse
# ---------------------------------------------------------------------------
a = Analysis(                                    # noqa: F821
    [ENTRY],
    pathex=PATHEX,
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    # tkinter conservé : c'est le repli de pywebview si Edge WebView2
    # n'est pas installé sur la machine du client.
    excludes=["matplotlib", "numpy", "pandas", "PyQt5", "PyQt6",
              "PySide2", "PySide6", "scipy", "notebook", "IPython",
              "test", "unittest"],
    noarchive=False,
)

pyz = PYZ(a.pure)                                # noqa: F821

exe = EXE(                                       # noqa: F821
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="Karaya",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,                                   # UPX casse pyarmor/crypto
    runtime_tmpdir=None,
    console=False,
    disable_windowed_traceback=False,
    icon=None,
)
