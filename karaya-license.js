/* =====================================================================
   karaya-license.js — Licence UNIQUE, hors-ligne, valable sur TOUTES
   les éditions (Windows, Mobile local, Cloud GitHub+Supabase).

   Deux formats acceptés :
     1) ANCIEN format (déjà payé par vos clients Windows) : la clé
        "mots" dérivée du numéro de disque.  Réimplémenté à l'identique
        de db_bridge.py  →  aucune réactivation nécessaire.
     2) NOUVEAU format K2 :  K2-<PAYLOAD>-<SIGNATURE>
        payload = base32( serial | edition | exp | client )
        signature = RSA-2048 / SHA-256 (clé privée : vous seul)
        Vérifiée avec la clé PUBLIQUE (karaya-keys.js) : aucun secret
        dans le code livré → impossible de générer une clé en copiant
        l'application.
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

  var LSK = 'karaya_licence_v2';
  function readLic() { try { return JSON.parse(localStorage.getItem(LSK) || '{}') || {}; } catch (e) { return {}; } }
  function writeLic(o) { try { localStorage.setItem(LSK, JSON.stringify(o || {})); } catch (e) { } }

  /* ---------- API publique ---------- */
  var KL = {
    EDITIONS: EDITIONS,
    nbs: nbs,
    legacyKeyFor: legacyKeyFor,
    parseK2: parseK2,
    verifyK2: verifyK2,

    /* Renvoie { ok, kind:'legacy'|'k2', editions, serial, client, exp } */
    check: function (opts) {
      opts = opts || {};
      var st = readLic();
      var code = (opts.key || st.key || '').trim();
      var serial = cleanSerial(opts.serial || st.serial || '');

      if (/^K2-/i.test(code)) {
        return verifyK2(code).then(function (r) {
          if (!r.ok) return { ok: false, kind: 'k2', reason: r.reason };
          var L = r.license;
          if (serial && L.serial && cleanSerial(L.serial) !== serial) {
            return { ok: false, kind: 'k2', reason: 'serial' };
          }
          writeLic({ key: code, serial: serial || L.serial, kind: 'k2', at: new Date().toISOString() });
          return { ok: true, kind: 'k2', editions: L.edition, serial: serial || L.serial, client: L.client, exp: L.exp };
        });
      }
      /* ancien format : couvre TOUTES les éditions (un seul paiement) */
      if (code && serial) {
        var want = legacyKeyFor(serial);
        if (want && code.toUpperCase() === want) {
          writeLic({ key: code.toUpperCase(), serial: serial, kind: 'legacy', at: new Date().toISOString() });
          return Promise.resolve({ ok: true, kind: 'legacy', editions: EDITIONS.ALL, serial: serial, client: '', exp: '0' });
        }
      }
      return Promise.resolve({ ok: false, kind: 'none', reason: code ? 'invalid' : 'empty' });
    },

    save: function (key, serial, kind) {
      var o = readLic();
      o.key = String(key || '').trim();
      o.serial = cleanSerial(serial || o.serial || '');
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
    }
  };
  window.KLicense = KL;
})();
