/* =====================================================================
   karaya-license.js — Licence UNIQUE, hors-ligne, valable sur TOUTES
   les éditions (Windows, Mobile local, Cloud GitHub+Supabase).

   DEUX CAS D'USAGE (version 3.0) :
     1) DESKTOP (app PC packagée : pywebview / file://)
        → identifiant = empreinte matérielle (n° de disque) fournie par
          le pont Python (db_bridge.drive_serial).
        → clé ANCIENNE (mots) ou clé K2 : activation illimitée.
        → le mode essai NE s'applique JAMAIS sur desktop.

     2) WEB / MOBILE (GitHub Pages, PWA, téléphone sans PC)
        → aucune empreinte Windows disponible.
        → identifiant = E-MAIL (normalisé : trim + minuscules) ou, à
          défaut, un UUID stable du navigateur (localStorage).
        → ESSAI : 10 enregistrements (contrats / locations) maximum,
          compteur 'karaya_trial_count' dans localStorage.
        → au-delà : blocage de l'ajout + demande d'activation.
        → la clé reste vérifiée par RSA-2048 / SHA-256 avec la clé
          PUBLIQUE de karaya-keys.js : aucun secret dans le livrable.

   API PUBLIQUE (window.KLicense) :
     platform()               'desktop' | 'web' | 'mobile'
     identity()               e-mail normalisé, sinon UUID
     trial()                  { used, max, remaining, exhausted }
     checkLicenseOrTrial(o)   Promise<{ ok, mode, ... }>
     noteSaveDone(g)          incrémente le compteur d'essai (1 seule fois)
     activate(id, key)        activation Web/Mobile (RSA ou legacy)
     check({key, id|serial})  vérification (compat. ascendante)
     verifySaved()            revérifie la clé mémorisée
     status()                 état lisible pour l'interface
     resetTrial()             (support / tests)

   COMPATIBILITÉ : les clients Windows déjà activés ne sont pas impactés.
   ===================================================================== */
(function () {
  'use strict';

  /* ---------- tables du keygen d'origine (db_bridge.py) ---------- */
  var CH = ['', 'DG', 'GH', 'HJ', 'ER', 'VF', 'BG', 'LL', 'OI', 'KK',
            'AZ', 'ZE', 'TR', 'N', 'PO', 'QA', 'WX', 'GF', 'NB', 'TY'];
  var DZ = ['', 'IU', 'POT', 'QZ', 'VC', 'TRE', 'BGF', '', 'MK'];

  function accessRound(x) {
    var f = Math.floor(x), diff = x - f;
    if (diff < 0.5) return f;
    if (diff > 0.5) return f + 1;
    return (f % 2 === 0) ? f : f + 1;
  }
  function centaineDizaine(v) {
    var s = '';
    if (v >= 100) { s = CH[Math.floor(v / 100)]; v = v % 100; s += 'GFDT'; }
    if (v <= 19) { if (v > 0) s += CH[v]; }
    else {
      var d = Math.floor(v / 10), u = v % 10;
      if (d <= 5) s += DZ[d];
      else if (d === 6 || d === 7) s += DZ[6];
      else s += DZ[8];
      if (d === 7 || d === 9) u += 10;
      if (u !== 0) s += CH[u];
    }
    return s;
  }
  function nbs(nb) {
    nb = parseFloat(nb);
    if (isNaN(nb)) return '';
    var out = (nb >= 1) ? '' : 'MO';
    if (nb >= 1) {
      var v = Math.floor(nb / 1000000);
      if (v > 0) out = centaineDizaine(v) + 'TYY';
      v = Math.floor(Math.floor(nb) % 1000000 / 1000);
      if (v > 0) out = out + centaineDizaine(v) + 'TYY';
      v = Math.floor(nb) % 1000;
      if (v > 0) out = out + centaineDizaine(v);
    }
    out += 'NBHG';
    var c = Math.floor((nb - Math.floor(nb)) * 100 + 0.5);
    if (c > 0) out = out + 'DF' + centaineDizaine(c) + 'JHG';
    return out.replace(/ /g, '').toUpperCase();
  }
  function cleanSerial(s) {
    s = String(s == null ? '' : s).trim().replace(/\s/g, '');
    var neg = s.charAt(0) === '-';
    var d = s.replace(/[^0-9]/g, '');
    return (neg && d) ? ('-' + d) : d;
  }
  /* identifiant de licence :
       - e-mail  -> trim + minuscules
       - numérique (n° de disque) -> chiffres seuls
       - UUID / autre -> tel quel en minuscules (ne pas réduire aux chiffres) */
  function cleanId(s) {
    s = String(s == null ? '' : s).trim();
    if (!s) return '';
    if (s.indexOf('@') >= 0) return s.toLowerCase().replace(/\s+/g, '');
    if (/^[\d\s-]+$/.test(s)) return cleanSerial(s);
    return s.toLowerCase();
  }
  function isEmail(s) { return String(s || '').indexOf('@') > 0; }
  /* clé attendue pour un numéro de série (ancien système) */
  function legacyKeyFor(serial) {
    var s = cleanSerial(serial);
    if (!s || s === '-') return '';
    var cle = parseFloat(s);
    if (isNaN(cle)) return '';
    var nb = (cle <= 0) ? accessRound(cle / -45) : accessRound(cle / 45);
    return nbs(nb);
  }

  /* ---------- base32 (RFC4648, sans I/O/0/1) ---------- */
  var B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  function b32enc(bytes) {
    var bits = 0, val = 0, out = '';
    for (var i = 0; i < bytes.length; i++) {
      val = (val << 8) | bytes[i]; bits += 8;
      while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; }
    }
    if (bits > 0) out += B32[(val << (5 - bits)) & 31];
    return out;
  }
  function b32dec(str) {
    var bits = 0, val = 0, out = [];
    str = String(str).toUpperCase().replace(/[^A-Z2-7]/g, '');
    for (var i = 0; i < str.length; i++) {
      val = (val << 5) | B32.indexOf(str[i]); bits += 5;
      if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; }
    }
    return new Uint8Array(out);
  }
  function b64uToBuf(s) {
    s = String(s).replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    var bin = atob(s), a = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
    return a;
  }

  var EDITIONS = { DESKTOP: 1, MOBILE: 2, CLOUD: 4, ALL: 7 };

  /* ---------- vérification K2 ---------- */
  function parseK2(code) {
    /* NB: ne JAMAIS mettre la clé en majuscules : la signature base64url
       dépend de la casse. Seul le préfixe K2 est insensible à la casse. */
    var m = String(code || '').replace(/\s/g, '').match(/^[Kk]2-([A-Za-z2-7]+)-([A-Za-z0-9_\-]+)$/);
    if (!m) return null;
    var payload = m[1].toUpperCase(), sig = m[2];
    var raw;
    try { raw = new TextDecoder().decode(b32dec(payload)); } catch (e) { return null; }
    var p = raw.split('|');
    if (p.length < 4) return null;
    return { serial: p[0], edition: parseInt(p[1], 10) || 0, exp: p[2] || '0', client: p[3] || '', payload: payload.toUpperCase(), sig: sig };
  }
  function verifyK2(code) {
    var k = parseK2(code);
    if (!k) return Promise.resolve({ ok: false, reason: 'format' });
    if (!window.KARAYA_PUBKEY) return Promise.resolve({ ok: false, reason: 'nopub' });
    if (!(window.crypto && window.crypto.subtle)) return Promise.resolve({ ok: false, reason: 'nocrypto' });
    var data = new TextEncoder().encode('K2|' + k.payload);
    return window.crypto.subtle.importKey('jwk', window.KARAYA_PUBKEY,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify'])
      .then(function (key) {
        return window.crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64uToBuf(k.sig), data);
      })
      .then(function (ok) {
        if (!ok) return { ok: false, reason: 'signature' };
        if (k.exp && k.exp !== '0') {
          var ymd = k.exp.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3');
          if (new Date(ymd + 'T23:59:59') < new Date()) return { ok: false, reason: 'expired' };
        }
        return { ok: true, license: k };
      })
      .catch(function (e) { return { ok: false, reason: 'error', detail: String(e) }; });
  }

  /* ---- stockage tolerant -------------------------------------------
     Si localStorage refuse l'écriture (Safari navigation privée, quota
     dépassé, WebView sans storage), l'ancien code avalait l'erreur et le
     compteur d'essai restait à 0 : aucune limite n'était jamais atteinte.
     On garde donc une copie en mémoire pour la session courante. */
  var _mem = {};
  function lsGet(k) {
    try { var v = localStorage.getItem(k); if (v !== null) return v; } catch (e) { }
    return (k in _mem) ? _mem[k] : null;
  }
  function lsSet(k, v) {
    _mem[k] = String(v);
    try { localStorage.setItem(k, String(v)); return true; } catch (e) { return false; }
  }

  var LSK = 'karaya_licence_v2';
  function readLic() { try { return JSON.parse(lsGet(LSK) || '{}') || {}; } catch (e) { return {}; } }
  function writeLic(o) { lsSet(LSK, JSON.stringify(o || {})); }

  /* ==================================================================
     PLATEFORME — Desktop (empreinte disque) vs Web/Mobile (essai)
     ================================================================== */
  /* un téléphone reste un téléphone, même si l'app est packagée en file://
     (Capacitor / WebView / « mobile local ») : sinon platform() renvoyait
     'desktop' et l'essai de 10 enregistrements ne s'appliquait JAMAIS. */
  function isMobileUA() {
    var ua = '';
    try { ua = String(navigator.userAgent || ''); } catch (e) { }
    if (/android|iphone|ipad|ipod|mobile|silk|kindle|opera mini|windows phone/i.test(ua)) return true;
    try { if (navigator.maxTouchPoints > 1 && /macintosh/i.test(ua)) return true; } catch (e) { }
    return false;
  }
  function platform() {
    try {
      if (window.pywebview && window.pywebview.api) return 'desktop';
      if (window.KARAYA_PLATFORM === 'desktop' || window.KARAYA_PLATFORM === 'web' || window.KARAYA_PLATFORM === 'mobile') {
        return window.KARAYA_PLATFORM;
      }
      /* AVANT le test file: — c'était la cause du mode essai inopérant */
      if (isMobileUA()) return 'mobile';
      /* bundle PC ouvert en file:// dans WebView2 : pas de pont encore prêt */
      if (location.protocol === 'file:') return 'desktop';
    } catch (e) { }
    return 'web';
  }
  function isDesktop() { return platform() === 'desktop'; }

  /* ==================================================================
     IDENTITÉ — e-mail normalisé, sinon UUID stable du navigateur
     ================================================================== */
  var UUIDK = 'karaya_user_uuid';
  var MAILK = 'karaya_user_email';
  function uuid() {
    var v = '';
    try { v = localStorage.getItem(UUIDK) || ''; } catch (e) { }
    if (v) return v;
    try {
      if (window.crypto && window.crypto.randomUUID) v = window.crypto.randomUUID();
    } catch (e) { }
    if (!v) {
      var a = new Uint8Array(16);
      try { (window.crypto || {}).getRandomValues(a); } catch (e) { for (var i = 0; i < 16; i++) a[i] = (i * 37 + 11) & 255; }
      a[6] = (a[6] & 0x0f) | 0x40; a[8] = (a[8] & 0x3f) | 0x80;
      var h = '';
      for (var j = 0; j < 16; j++) h += ('0' + a[j].toString(16)).slice(-2);
      v = h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
    }
    try { localStorage.setItem(UUIDK, v); } catch (e) { }
    return v;
  }
  function savedEmail() {
    var v = '';
    try { v = localStorage.getItem(MAILK) || ''; } catch (e) { }
    if (v) return String(v).trim().toLowerCase();
    var st = readLic();
    if (isEmail(st.id)) return String(st.id).trim().toLowerCase();
    return '';
  }
  function setEmail(e) {
    e = String(e == null ? '' : e).trim().toLowerCase();
    try { if (e) localStorage.setItem(MAILK, e); else localStorage.removeItem(MAILK); } catch (x) { }
    var st = readLic();
    if (e) { st.id = e; writeLic(st); }
    return e;
  }
  /* identifiant de licence de CET appareil */
  function identity() {
    var e = savedEmail();
    return e || uuid();
  }

  /* ==================================================================
     ESSAI — 10 enregistrements (contrats / locations)
     ================================================================== */
  var TRIALK = 'karaya_trial_count';
  var TRIAL_MAX = 10;

  function trialCount() {
    var n = 0;
    try { n = parseInt(lsGet(TRIALK) || '0', 10); } catch (e) { n = 0; }
    if (!isFinite(n) || isNaN(n) || n < 0) n = 0;
    return n;
  }
  function setTrialCount(n) {
    n = Math.max(0, parseInt(n, 10) || 0);
    lsSet(TRIALK, n);
    return n;
  }
  function trialInfo() {
    var used = trialCount();
    return {
      used: used, max: TRIAL_MAX,
      remaining: Math.max(0, TRIAL_MAX - used),
      exhausted: used >= TRIAL_MAX
    };
  }

  /* ==================================================================
     API PUBLIQUE
     ================================================================== */
  var KL = {
    version: '3.0',
    EDITIONS: EDITIONS,
    TRIAL_MAX: TRIAL_MAX,
    nbs: nbs,
    legacyKeyFor: legacyKeyFor,
    parseK2: parseK2,
    verifyK2: verifyK2,
    cleanId: cleanId,

    platform: platform,
    isDesktop: isDesktop,
    identity: identity,
    setEmail: setEmail,
    savedEmail: savedEmail,
    uuid: uuid,

    trial: trialInfo,
    trialCount: trialCount,
    resetTrial: function () { return setTrialCount(0); },

    /* Renvoie { ok, kind:'legacy'|'k2', editions, serial, id, client, exp } */
    check: function (opts) {
      opts = opts || {};
      var st = readLic();
      var code = String(opts.key || st.key || '').trim();
      var idRaw = opts.id || opts.serial || st.id || st.serial || '';
      var id = cleanId(idRaw);
      var serial = cleanSerial(idRaw);

      if (/^K2-/i.test(code)) {
        return verifyK2(code).then(function (r) {
          if (!r.ok) return { ok: false, kind: 'k2', reason: r.reason };
          var L = r.license;
          /* comparaison insensible à la casse pour un e-mail, stricte pour un n° */
          if (id && L.serial && cleanId(L.serial) !== id) {
            return { ok: false, kind: 'k2', reason: 'serial' };
          }
          var useId = id || cleanId(L.serial);
          writeLic({
            key: code, id: useId, serial: serial || cleanSerial(L.serial),
            kind: 'k2', editions: L.edition || 0, verified: true,
            at: new Date().toISOString()
          });
          return { ok: true, kind: 'k2', editions: L.edition, id: useId, serial: serial || cleanSerial(L.serial), client: L.client, exp: L.exp };
        });
      }
      /* ancien format (n° de série numérique) : couvre TOUTES les éditions */
      if (code && serial) {
        var want = legacyKeyFor(serial);
        if (want && code.toUpperCase() === want) {
          writeLic({
            key: code.toUpperCase(), id: serial, serial: serial, kind: 'legacy',
            editions: EDITIONS.ALL, verified: true, at: new Date().toISOString()
          });
          return Promise.resolve({ ok: true, kind: 'legacy', editions: EDITIONS.ALL, id: serial, serial: serial, client: '', exp: '0' });
        }
      }
      return Promise.resolve({ ok: false, kind: 'none', reason: code ? 'invalid' : 'empty' });
    },

    save: function (key, serial, kind) {
      var o = readLic();
      o.key = String(key || '').trim();
      o.serial = cleanSerial(serial || o.serial || '');
      o.id = cleanId(serial || o.id || '');
      o.kind = kind || o.kind || '';
      o.at = new Date().toISOString();
      writeLic(o);
      return o;
    },
    state: function () { return readLic(); },
    /* l'édition courante est-elle couverte ? */
    allows: function (edition, ed) {
      if (!edition || !edition.ok) return false;
      return ((edition.editions || 0) & (ed)) !== 0;
    },
    /* identifiant stable de l'appareil (mobile / cloud, sans n° de disque) */
    deviceId: function () {
      var k = 'karaya_device_id';
      var v = '';
      try { v = localStorage.getItem(k) || ''; } catch (e) { }
      if (!v) {
        var a = new Uint8Array(16);
        (window.crypto || {}).getRandomValues ? window.crypto.getRandomValues(a) : a.forEach(function (_, i) { a[i] = i * 7 + 3; });
        v = b32enc(a);
        try { localStorage.setItem(k, v); } catch (e) { }
      }
      return v;
    },

    /* ---------------- LE POINT D'ENTRÉE DU MODE ESSAI ---------------- */
    /* Desktop  : toujours autorisé (le pont Python garde son propre verrou).
       Web/Mob  : licence vérifiée, sinon essai 10, sinon blocage.          */
    checkLicenseOrTrial: function (opts) {
      opts = opts || {};
      var plat = platform();
      if (plat === 'desktop') {
        return Promise.resolve({
          ok: true, mode: 'desktop', platform: plat, licensed: true, trial: trialInfo()
        });
      }
      var st = readLic();
      var pre = st.key
        ? KL.verifyStored()
        : Promise.resolve({ ok: false, kind: 'none', reason: 'empty' });
      return pre.then(function (r) {
        var t = trialInfo();
        if (r && r.ok) {
          return { ok: true, mode: 'licensed', platform: plat, licensed: true, id: identity(), trial: t, kind: r.kind, editions: r.editions };
        }
        if (t.exhausted) {
          return {
            ok: false, mode: 'trial-exhausted', platform: plat, licensed: false,
            used: t.used, max: t.max, remaining: 0, trial: t
          };
        }
        return {
          ok: true, mode: 'trial', platform: plat, licensed: false,
          used: t.used, max: t.max, remaining: t.remaining, trial: t
        };
      });
    },

    /* à appeler UNIQUEMENT après un enregistrement réussi.
       Desktop : ne touche JAMAIS au compteur d'essai. */
    noteSaveDone: function (g) {
      if (isDesktop()) return trialInfo();
      if (!g || g.mode !== 'trial') return trialInfo();
      return trialInfoAfter(setTrialCount((g.used || trialCount()) + 1));
    },

    /* activation Web/Mobile : e-mail (ou UUID) + clé RSA / legacy */
    activate: function (id, key) {
      var ident = String(id || '').trim();
      if (!ident) return Promise.resolve({ ok: false, reason: 'id' });
      if (isEmail(ident)) setEmail(ident);
      else { var st = readLic(); st.id = ident; writeLic(st); }
      return KL.check({ key: key, id: ident }).then(function (r) {
        if (r && r.ok) {
          var o = readLic();
          o.key = String(key || '').trim();
          o.id = cleanId(ident);
          o.kind = r.kind;
          o.editions = r.editions || 0;
          o.verified = true;
          o.at = new Date().toISOString();
          writeLic(o);
        }
        return r;
      });
    },

    /* Vérifie la clé MÉMORISÉE sans la relier à l'identité courante :
       une clé achetée une fois reste valable sur toutes les éditions
       (Windows, mobile, cloud) — c'est la promesse du produit.
       Le lien à l'e-mail n'est exigé qu'à l'ACTIVATION (activate()). */
    verifyStored: function () {
      var st = readLic();
      if (!st.key) return Promise.resolve({ ok: false, reason: 'empty' });
      var code = String(st.key).trim();
      if (/^K2-/i.test(code)) {
        return verifyK2(code).then(function (r) {
          if (!r.ok) return { ok: false, kind: 'k2', reason: r.reason };
          var L = r.license;
          /* deux e-mails différents = clé d'un autre client */
          if (isEmail(st.id) && isEmail(L.serial) &&
              String(st.id).toLowerCase() !== String(L.serial).toLowerCase()) {
            return { ok: false, kind: 'k2', reason: 'serial' };
          }
          return { ok: true, kind: 'k2', editions: L.edition, id: st.id || cleanId(L.serial), exp: L.exp };
        });
      }
      var serial = cleanSerial(st.serial || st.id || '');
      if (serial) {
        var want = legacyKeyFor(serial);
        if (want && code.toUpperCase() === want) {
          return Promise.resolve({ ok: true, kind: 'legacy', editions: EDITIONS.ALL, id: serial, exp: '0' });
        }
      }
      return Promise.resolve({ ok: false, kind: 'none', reason: 'invalid' });
    },
    verifySaved: function () { return KL.verifyStored(); },
    markUnverified: function () {
      var o = readLic(); o.verified = false; writeLic(o); return o;
    },

    /* état complet, synchrone, pour l'interface */
    status: function () {
      var st = readLic();
      var t = trialInfo();
      return {
        platform: platform(),
        id: identity(),
        email: savedEmail(),
        key: st.key || '',
        licensed: !!st.verified,
        kind: st.kind || '',
        editions: st.editions || 0,
        trial: t
      };
    }
  };

  function trialInfoAfter() {
    var used = trialCount();
    return { used: used, max: TRIAL_MAX, remaining: Math.max(0, TRIAL_MAX - used), exhausted: used >= TRIAL_MAX };
  }

  window.KLicense = KL;
})();
