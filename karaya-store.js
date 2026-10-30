/* =====================================================================
   karaya-store.js — Une seule interface de stockage, 3 moteurs :
     local   : localStorage + pont Python (Windows / mobile local)  [défaut]
     cloud   : Supabase du CLIENT (Postgres + Realtime + Storage)
     hybrid  : local d'abord, puis synchronisation cloud

   CORRECTIFS (version compilée PyArmor + PyInstaller / WebView2) :
     * Le SDK n'est plus chargé par import() dynamique (bloqué quand la
       page est ouverte en file:// — origine "null" => CORS). Il est
       chargé par une balise <script> classique, avec délai de garde.
     * client() est RECRÉÉ si l'URL ou la clé anon change (avant, un
       ancien client restait en mémoire et pointait sur l'ancien projet).
     * sync(db) : une seule fonction qui décide (pull / push) et renvoie
       un résultat exploitable par l'interface.
     * Les erreurs réseau sont renvoyées en clair (plus d'échec muet).
   ===================================================================== */
(function () {
  'use strict';

  var CFGKEY = 'karaya_cloud_cfg_v1';   /* {url, anon, email, mode} */
  var DOCTBL = 'karaya_docs';
  var BUCKET = 'karaya';
  var DOCID  = 'main';
  var SDKURL = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';

  function cfg() {
    try { return JSON.parse(localStorage.getItem(CFGKEY) || '{}') || {}; } catch (e) { return {}; }
  }
  function saveCfg(o) {
    var c = cfg();
    for (var k in o) { if (o[k] !== undefined && o[k] !== null) c[k] = o[k]; }
    try { localStorage.setItem(CFGKEY, JSON.stringify(c)); } catch (e) { }
    return c;
  }
  function clearCfg() { try { localStorage.removeItem(CFGKEY); } catch (e) { } }

  function normalizeUrl(u) {
    u = String(u || '').trim().replace(/\/+$/, '');
    if (!u) return '';
    if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
    return u;
  }

  function deviceId() {
    try {
      if (window.KLicense && typeof window.KLicense.deviceId === 'function') return window.KLicense.deviceId();
    } catch (e) { }
    var v = '';
    try { v = localStorage.getItem('karaya_device_id') || ''; } catch (e) { }
    if (!v) {
      v = 'dev-' + Math.random().toString(36).slice(2, 10);
      try { localStorage.setItem('karaya_device_id', v); } catch (e) { }
    }
    return v;
  }

  /* ================= SMART MERGE / UPSERT =================
     Objectif : il ne doit plus jamais être possible d'effacer le cloud
     par erreur ou par une fausse manipulation.
       * Fusion enregistrement par enregistrement, clé stable = id.
       * UPSERT uniquement : un enregistrement présent dans le cloud mais
         absent du local est CONSERVÉ, jamais supprimé.
       * Les suppressions volontaires passent par des « tombstones »
         (DB._tombstones) : elles se propagent aux autres appareils, et
         un enregistrement modifié après sa suppression est ressuscité.
       * Les enregistrements sans id sont identifiés par l'empreinte de
         leur contenu (dédoublonnage, aucune perte).
       * En cas d'égalité (pas d'horodatage exploitable), la copie locale
         gagne si des modifications locales sont en attente, sinon la
         copie du cloud.
       * Index de la dernière état synchronisé (karaya_sync_index_v1) :
         sert à distinguer « supprimé volontairement » de « jamais vu ».
     ========================================================= */
  var TABLES = ['articles', 'clients', 'locs', 'lines', 'users', 'depense', 'caisse_ctrl'];
  var IDXKEY = 'karaya_sync_index_v1';

  function toTs(v) {
    if (v === undefined || v === null || v === '') return 0;
    if (v instanceof Date) return v.getTime();
    var s = String(v).trim();
    if (!s) return 0;
    var n = Number(s);
    if (isFinite(n) && /^-?\d+(\.\d+)?$/.test(s)) {
      if (n > 1e12) return n;          /* epoch ms */
      if (n > 1e9) return n * 1000;    /* epoch s */
    }
    var m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
    if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] || 0, +m[5] || 0, +m[6] || 0);
    var m2 = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
    if (m2) return Date.UTC(+m2[3], +m2[2] - 1, +m2[1], +m2[4] || 0, +m2[5] || 0, +m2[6] || 0);
    var d = Date.parse(s);
    return isNaN(d) ? 0 : d;
  }
  function recTs(r) {
    if (!r || typeof r !== 'object') return 0;
    return Math.max(toTs(r.updatedAt), toTs(r.updated_at), toTs(r.modifiedAt),
      toTs(r._upd), toTs(r.createdAt), toTs(r.created_at));
  }
  function recKey(r) {
    if (!r || typeof r !== 'object') return '';
    var id = r.id || r._id || r.uid || '';
    return id ? String(id) : '';
  }
  function stableJSON(v) {
    try {
      return JSON.stringify(v, function (k, o) {
        if (o && typeof o === 'object' && !Array.isArray(o)) {
          var out = {};
          Object.keys(o).sort().forEach(function (kk) { out[kk] = o[kk]; });
          return out;
        }
        return o;
      });
    } catch (e) { return ''; }
  }
  function hashStr(s) {
    var h = 5381, i;
    for (i = 0; i < s.length; i++) { h = ((h << 5) + h + s.charCodeAt(i)) | 0; }
    return 'h' + (h >>> 0).toString(36) + '-' + s.length.toString(36);
  }
  /* « base vide » = aucun enregistrement réel. Le compte admin par
     défaut (u1 / « admin », sans mot de passe haché) NE compte PAS :
     une installation fraîche est donc bien considérée comme vide. */
  function isEmptyDB(db) {
    if (!db || typeof db !== 'object') return true;
    for (var i = 0; i < TABLES.length; i++) {
      var tname = TABLES[i], a = db[tname];
      if (!Array.isArray(a)) continue;
      if (!a.length) continue;
      if (tname === 'users') {
        var real = a.filter(function (u) {
          if (!u || typeof u !== 'object') return false;
          return !(String(u.id || '') === 'u1' &&
                   String(u.nom || '').trim().toLowerCase() === 'admin' && !u.pwd_hash);
        });
        if (real.length) return false;
        continue;
      }
      return false;
    }
    return true;
  }
  function loadIndex() {
    try { return JSON.parse(localStorage.getItem(IDXKEY) || 'null') || null; } catch (e) { return null; }
  }
  function saveIndex(db) {
    var idx = {};
    TABLES.forEach(function (tname) {
      var a = db && db[tname], ids = [];
      if (Array.isArray(a)) a.forEach(function (r) { var k = recKey(r); if (k) ids.push(k); });
      idx[tname] = ids;
    });
    try { localStorage.setItem(IDXKEY, JSON.stringify(idx)); } catch (e) { }
    return idx;
  }
  function tombMap(db, tname) {
    var t = (db && db._tombstones && db._tombstones[tname]) || {};
    var out = {}, lim = Date.now() - 90 * 24 * 3600 * 1000;
    Object.keys(t).forEach(function (k) {
      var ts = toTs(t[k]);
      if (ts && ts < lim) return;              /* tombstone expirée */
      out[k] = t[k] || new Date().toISOString();
    });
    return out;
  }
  function laterIso(a, b) { return toTs(a) >= toTs(b) ? a : (b || a); }

  function mergeDB(local, remote, opts) {
    opts = opts || {};
    var stats = { fromCloud: 0, fromLocal: 0, updatedByLocal: 0, updatedByCloud: 0,
      deletedLocal: 0, deletedCloud: 0, resurrected: 0, unchanged: 0 };
    var idx = loadIndex();
    var firstRun = !idx;
    var out = {};
    if (local && typeof local === 'object') {
      Object.keys(local).forEach(function (k) { if (k !== '_tombstones') out[k] = local[k]; });
    }
    var tombs = {}, tombChanged = false;

    TABLES.forEach(function (tname) {
      var la = (local && Array.isArray(local[tname])) ? local[tname] : [];
      var ra = (remote && Array.isArray(remote[tname])) ? remote[tname] : [];
      var lt = tombMap(local, tname), rt = tombMap(remote, tname);
      var byKey = {}, order = [], anonSeen = {}, res = [];
      function pushAnon(r) {
        var h = hashStr(stableJSON(r));
        if (!anonSeen[h]) { anonSeen[h] = 1; res.push(r); }
      }
      la.forEach(function (r) {
        if (!r || typeof r !== 'object') return;
        var k = recKey(r);
        if (!k) { pushAnon(r); return; }
        if (!byKey[k]) { byKey[k] = r; order.push(k); }
      });
      /* suppressions locales depuis la dernière synchro → tombstones */
      if (idx && Array.isArray(idx[tname])) {
        idx[tname].forEach(function (id) {
          if (byKey[id] || lt[id]) return;
          lt[id] = new Date().toISOString();
          stats.deletedLocal++;
          tombChanged = true;
        });
      }
      /* tombstones du cloud : fusion + application */
      Object.keys(rt).forEach(function (id) {
        if (lt[id]) {
          var n = laterIso(lt[id], rt[id]);
          if (n !== lt[id]) { lt[id] = n; tombChanged = true; }
          return;
        }
        lt[id] = rt[id];
        tombChanged = true;
      });
      var rkeys = {}, dead = {};
      ra.forEach(function (r) { var k = recKey(r); if (k) rkeys[k] = 1; });
      order.forEach(function (k) {
        var t = lt[k] ? toTs(lt[k]) : 0;
        if (t && recTs(byKey[k]) > t) {
          delete lt[k]; tombChanged = true; stats.resurrected++; res.push(byKey[k]);
        } else if (t) { dead[k] = 1; }
        else { res.push(byKey[k]); }
      });
      ra.forEach(function (r) {
        if (!r || typeof r !== 'object') return;
        var k = recKey(r);
        if (!k) { pushAnon(r); return; }
        if (rt[k]) {                             /* supprimé côté cloud */
          if (byKey[k] && !dead[k]) {
            if (recTs(byKey[k]) > toTs(rt[k])) {
              delete lt[k]; tombChanged = true; stats.resurrected++;
            } else { dead[k] = 1; stats.deletedCloud++; }
          }
          return;
        }
        if (lt[k]) {                             /* suppression locale connue */
          if (recTs(r) > toTs(lt[k])) {
            delete lt[k]; tombChanged = true; stats.resurrected++;
            res.push(r); stats.fromCloud++;
          }
          return;
        }
        if (!byKey[k] || dead[k]) {
          if (!byKey[k]) { res.push(r); stats.fromCloud++; }
          return;
        }
        var a = byKey[k], b = r, ta = recTs(a), tb = recTs(b);
        if (stableJSON(a) === stableJSON(b)) { stats.unchanged++; return; }
        var takeLocal;
        if (ta && tb) takeLocal = ta >= tb;
        else if (ta && !tb) takeLocal = true;
        else if (!ta && tb) takeLocal = false;
        else takeLocal = !!opts.preferLocalOnTie;
        if (takeLocal) { stats.updatedByLocal++; }
        else {
          for (var i = 0; i < res.length; i++) {
            if (res[i] === a) { res[i] = b; break; }
          }
          stats.updatedByCloud++;
        }
      });
      /* enregistrements présents uniquement en local */
      order.forEach(function (k) { if (!rkeys[k] && !dead[k] && !lt[k]) stats.fromLocal++; });
      out[tname] = res;
      if (Object.keys(lt).length || tombChanged) tombs[tname] = lt;
    });
    if (Object.keys(tombs).length) out._tombstones = tombs;

    /* clés présentes uniquement dans le cloud (info, meta, tables
       inconnues...) : toujours conservées, jamais perdues */
    if (remote && typeof remote === 'object') {
      Object.keys(remote).forEach(function (k) {
        if (k === '_tombstones' || out[k] !== undefined) return;
        var rv = remote[k];
        if (rv && typeof rv === 'object' && !Array.isArray(rv)) {
          out[k] = Object.assign({}, rv);
          stats.fromCloud++;
        } else {
          out[k] = rv;
          stats.fromCloud++;
        }
      });
    }
    var changed = (stats.fromCloud + stats.updatedByCloud + stats.deletedCloud +
                   stats.resurrected + stats.updatedByLocal + stats.deletedLocal) > 0 || tombChanged;
    if (firstRun) {
      /* au premier lancement, l'index est créé sans rien déclarer modifié */
      changed = (stats.fromCloud + stats.updatedByCloud + stats.deletedCloud + stats.resurrected) > 0;
    }
    return { db: out, stats: stats, changed: changed };
  }

  /* ---------------- chargement du SDK (balise <script>) ---------------- */
  var sbP = null;
  function loadSDK() {
    if (sbP) return sbP;
    sbP = new Promise(function (resolve) {
      function done() {
        resolve((window.supabase && typeof window.supabase.createClient === 'function')
          ? window.supabase.createClient : null);
      }
      if (window.supabase && typeof window.supabase.createClient === 'function') return done();
      var s = document.createElement('script');
      s.src = SDKURL;
      s.async = true;
      s.onload = done;
      s.onerror = function () { resolve(null); };
      document.head.appendChild(s);
      setTimeout(function () {
        if (!(window.supabase && typeof window.supabase.createClient === 'function')) resolve(null);
      }, 15000);
    });
    return sbP;
  }

  var sb = null, sbUrl = '', sbKey = '';
  function client() {
    var c = cfg();
    var url = normalizeUrl(c.url), key = String(c.anon || '').trim();
    if (!url || !key) return Promise.resolve(null);
    if (sb && sbUrl === url && sbKey === key) return Promise.resolve(sb);
    return loadSDK().then(function (create) {
      if (!create) return null;
      try {
        sb = create(url, key, {
          auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
        });
        sbUrl = url; sbKey = key;
        return sb;
      } catch (e) { return null; }
    });
  }

  /* ---------------- état observable ---------------- */
  var S = {
    mode: 'local', online: false, rev: 0, lastSync: '', device: deviceId(),
    email: '', error: '', listeners: [], statusListeners: []
  };
  function emitStatus() {
    S.statusListeners.forEach(function (f) { try { f(S); } catch (e) { } });
  }
  function onRemote(fn) { S.listeners.push(fn); }
  function onStatus(fn) { S.statusListeners.push(fn); try { fn(S); } catch (e) { } }

  function statusText() {
    if (S.mode === 'local' && !S.online) {
      return cfg().url ? 'Cloud configuré — session à renouveler' : 'Local (cloud non configuré)';
    }
    return 'Cloud connecté' + (S.email ? ' (' + S.email + ')' : '') +
      (S.lastSync ? ' — ' + S.lastSync : '');
  }

  /* ---------------- écriture locale ---------------- */
  var PUSHKEY = 'karaya_db_v2';
  var dbRef = null;           /* fourni par l'app : () => DB */
  function bindDB(getter) { dbRef = getter; }

  /* ---------------- push (local -> cloud) ----------------
     PUSH = UPSERT INTELLIGENT : avant d'écrire, on relit la ligne du
     cloud et on FUSIONNE enregistrement par enregistrement. Les données
     du cloud ne peuvent plus être écrasées par une fausse manipulation.
     GARDE-FOU : une base locale VIDE n'est jamais envoyée si le cloud
     contient des données. */
  var pending = null, pushing = false, pushTimer = null;
  function push(db) {
    pending = (db === undefined) ? null : db;
    if (!pending) {
      try { pending = dbRef ? dbRef() : null; } catch (e) { pending = null; }
    }
    clearTimeout(pushTimer);
    pushTimer = setTimeout(function () { flush(); }, 900);
    return Promise.resolve(true);
  }
  function flush() {
    if (pending === null) { try { pending = dbRef ? dbRef() : null; } catch (e) { } }
    if (pushing || pending === null) return Promise.resolve(false);
    if (!isConfigured()) { S.error = ''; return Promise.resolve(false); }
    var payload = pending;
    pushing = true;
    return client().then(function (c) {
      if (!c) { pushing = false; throw new Error('Supabase non configuré'); }
      return c.auth.getUser().then(function (u) {
        var owner = u && u.data && u.data.user && u.data.user.id;
        if (!owner) throw new Error('Session absente : reconnectez-vous');
        /* 1) relecture du cloud pour fusionner (jamais d'écrasement) */
        return c.from(DOCTBL).select('payload').eq('doc_id', DOCID).maybeSingle().then(function (row) {
          if (row && row.error) throw new Error(row.error.message || 'lecture refusée');
          var remotePayload = (row && row.data && row.data.payload) ? row.data.payload : null;
          var toSend = payload;
          /* GARDE-FOU anti-effacement : local vide + cloud plein → BLOQUÉ */
          if (isEmptyDB(payload) && remotePayload && !isEmptyDB(remotePayload)) {
            pushing = false;
            pending = null;
            S.online = true;
            S.error = 'ENVOI BLOQUÉ : base locale vide alors que le cloud contient des données. Lancez « Synchroniser » pour récupérer les données du cloud.';
            emitStatus();
            try { window.dispatchEvent(new CustomEvent('karaya:push-blocked', { detail: { reason: 'empty-local' } })); } catch (e) { }
            return false;
          }
          if (remotePayload && !isEmptyDB(payload)) {
            var m = mergeDB(payload, remotePayload, { preferLocalOnTie: true });
            if (m.changed) {
              toSend = m.db;
              try { window.dispatchEvent(new CustomEvent('karaya:merged', { detail: { db: m.db, stats: m.stats } })); } catch (e) { }
            }
          }
          /* 2) écriture du résultat FUSIONNÉ (upsert) */
          return c.from(DOCTBL).upsert({
            doc_id: DOCID, owner: owner, payload: toSend,
            rev: (Number(S.rev) || 0) + 1,
            updated_at: new Date().toISOString(),
            device: S.device
          }, { onConflict: 'doc_id' }).select('rev').single();
        });
      }).then(function (r) {
        if (r === false) return false;                  /* envoi bloqué */
        if (r && r.error) throw new Error(r.error.message || 'écriture refusée');
        pushing = false;
        if (r && r.data && r.data.rev) S.rev = r.data.rev;
        pending = null;
        saveCfg({ rev: Number(S.rev) || 0, dirty: '' });   /* état synchronisé */
        S.online = true; S.error = '';
        S.lastSync = new Date().toLocaleTimeString();
        if (window.pywebview && window.pywebview.api && window.pywebview.api.mark_cloud_sync) {
          try { window.pywebview.api.mark_cloud_sync(); } catch (e) { }
        }
        emitStatus();
        return true;
      });
    }).catch(function (e) {
      pushing = false;
      pending = payload;                 /* on réessaiera au prochain push */
      S.online = false; S.error = String(e && e.message || e);
      emitStatus();
      return false;
    });
  }

  /* ---------------- pull ---------------- */
  function pull() {
    return client().then(function (c) {
      if (!c) return null;
      return c.from(DOCTBL).select('payload,rev,updated_at,device')
        .eq('doc_id', DOCID).maybeSingle();
    }).then(function (r) {
      if (!r) return null;
      if (r.error) throw new Error(r.error.message || 'lecture refusée');
      if (!r.data) return null;
      S.rev = Number(r.data.rev || 0);
      S.online = true; S.error = '';
      S.lastSync = new Date().toLocaleTimeString();
      emitStatus();
      return { db: r.data.payload, rev: r.data.rev, at: r.data.updated_at, device: r.data.device };
    }).catch(function (e) {
      S.online = false; S.error = String(e && e.message || e);
      emitStatus();
      throw e;
    });
  }

  /* ---------------- synchronisation intelligente (SMART MERGE) ----------------
     IMPORTANT : la révision locale est lue AVANT le pull.
     (Avant, pull() écrasait S.rev : la comparaison était toujours
      « égale » et les données locales écrasaient celles du cloud.)
     La révision est mémorisée dans la config → elle survit au redémarrage.

     NOUVEAU (anti-effacement) :
       * local vide + cloud plein → le push est REFUSÉ, le contenu du
         cloud est récupéré en local (auto-restauration, rien n'est effacé).
       * les deux côtés pleins → fusion enregistrement par enregistrement
         (upsert) : le cloud ne perd JAMAIS d'enregistrement.
       * suppressions volontaires → tombstones propagées aux appareils. */
  function sync(db) {
    var local = (db === undefined || db === null) ? (dbRef ? dbRef() : null) : db;
    var c0 = cfg();
    var lrev = Number(c0.rev || 0);
    if (S.rev) lrev = Math.max(lrev, Number(S.rev) || 0);
    var dirty = (c0.dirty === '1');

    return pull().then(function (remote) {
      if (!remote || !remote.db) {
        if (!local) return { ok: false, error: 'Aucune donnée locale' };
        return flush2(local).then(function (ok) {
          return ok ? { ok: true, action: 'push', rev: S.rev }
                    : { ok: false, error: S.error || 'envoi impossible' };
        });
      }
      var rrev = Number(remote.rev || 0);
      var cloudEmpty = isEmptyDB(remote.db);

      /* GARDE-FOU : local vide + cloud non vide → on n'écrase RIEN.
         Les données du cloud sont récupérées en local. */
      if (isEmptyDB(local) && !cloudEmpty) {
        return { ok: true, action: 'pull', db: remote.db, rev: rrev, note: 'local-empty-guard' };
      }
      /* cloud vide : le local fait référence, envoi direct autorisé */
      if (cloudEmpty && !isEmptyDB(local)) {
        return flush2(local).then(function (ok) {
          return ok ? { ok: true, action: 'push', rev: S.rev, note: 'cloud-empty' }
                    : { ok: false, error: S.error || 'envoi impossible' };
        });
      }
      /* les deux côtés ont des données → fusion intelligente */
      var m = mergeDB(local, remote.db, { preferLocalOnTie: dirty });
      if (m.changed) {
        return flush2(m.db).then(function (ok) {
          return ok ? { ok: true, action: 'merged', db: m.db, rev: S.rev, stats: m.stats }
                    : { ok: false, error: S.error || 'envoi impossible', db: m.db, stats: m.stats };
        });
      }
      if (rrev > lrev && !dirty) {
        return { ok: true, action: 'pull', db: remote.db, rev: rrev };
      }
      /* fusion sans différence : on pousse quand même pour resynchroniser
         les révisions (cas « modifications locales en attente ») */
      return flush2(local).then(function (ok) {
        return ok ? { ok: true, action: 'push', rev: S.rev }
                  : { ok: false, error: S.error || 'envoi impossible' };
      });
    }).catch(function (e) {
      return { ok: false, error: String(e && e.message || e) };
    });
  }
  function flush2(db) { pending = db; return flush(); }

  /* appelés par l'interface après application (ou refus) d'un pull.
     markSynced(rev, db) reconstruit aussi l'index des identifiants
     synchronisés (base de détection des suppressions volontaires). */
  function markSynced(rev, db) {
    saveCfg({ rev: Number(rev) || 0, dirty: '' });
    try { saveIndex(db || (dbRef ? dbRef() : null)); } catch (e) { }
  }
  function markDirty() { saveCfg({ dirty: '1' }); }
  function isConfigured() { var c = cfg(); return !!(c.url && c.anon); }

  /* ---------------- realtime ---------------- */
  var chan = null;
  function subscribe() {
    client().then(function (c) {
      if (!c) return;
      if (chan) { try { c.removeChannel(chan); } catch (e) { } chan = null; }
      chan = c.channel('karaya_doc_main')
        .on('postgres_changes',
          { event: '*', schema: 'public', table: DOCTBL, filter: 'doc_id=eq.' + DOCID },
          function (p) {
            var row = p && p.new;
            if (!row || !row.payload) return;
            if (row.device && row.device === S.device) return;      /* écho */
            S.rev = Number(row.rev || S.rev);
            S.lastSync = new Date().toLocaleTimeString();
            S.online = true;
            emitStatus();
            S.listeners.forEach(function (f) {
              try { f(row.payload, { rev: row.rev, device: row.device }); } catch (e) { }
            });
          })
        .subscribe();
    });
  }

  /* ---------------- connexion / déconnexion ---------------- */
  function connect(o) {
    o = o || {};
    var url = normalizeUrl(o.url), key = String(o.anon || '').trim();
    if (!url || !key) return Promise.reject(new Error('URL Supabase et clé anon obligatoires'));
    saveCfg({ url: url, anon: key, email: o.email || '' });
    sb = null; sbP = null; sbUrl = ''; sbKey = ''; chan = null;

    return client().then(function (c) {
      if (!c) throw new Error('SDK Supabase indisponible (pas d\'accès Internet ?)');
      return c.auth.getSession().then(function (s) {
        if (s && s.data && s.data.session) return s.data.session;
        if (!o.email || !o.password) {
          throw new Error('E-mail et mot de passe requis pour la première connexion');
        }
        if (o.signUp) {
          return c.auth.signUp({ email: o.email, password: o.password }).then(function (r) {
            if (r.error) throw new Error(r.error.message);
            if (r.data && r.data.session) return r.data.session;
            return c.auth.signInWithPassword({ email: o.email, password: o.password })
              .then(function (r2) {
                if (r2.error) throw new Error(r2.error.message);
                return r2.data.session;
              });
          });
        }
        return c.auth.signInWithPassword({ email: o.email, password: o.password })
          .then(function (r) {
            if (r.error) throw new Error(r.error.message);
            return r.data.session;
          });
      });
    }).then(function (sess) {
      S.mode = 'hybrid'; S.online = true; S.error = '';
      S.email = (sess && sess.user && sess.user.email) || o.email || '';
      S.device = deviceId();
      saveCfg({ mode: 'hybrid', email: S.email });
      S.rev = Number(cfg().rev || 0);
      subscribe();
      emitStatus();
      try {
        window.dispatchEvent(new CustomEvent('karaya:cloud-connected', { detail: { email: S.email } }));
      } catch (e) { }
      return { ok: true, email: S.email, userId: sess && sess.user && sess.user.id };
    }).catch(function (e) {
      S.mode = 'local'; S.online = false; S.error = String(e && e.message || e);
      emitStatus();
      throw e;
    });
  }

  /* « فصل / Déconnecter » : on ferme la SESSION, mais on GARDE l'URL du
     projet et la clé anon. Objectif : la configuration ne doit être saisie
     qu'UNE SEULE fois dans la vie du poste (exigence client).
     Pour vraiment tout oublier, utiliser forgetCfg(). */
  function disconnect() {
    if (chan && sb) { try { sb.removeChannel(chan); } catch (e) { } }
    chan = null;
    if (sb) { try { sb.auth.signOut(); } catch (e) { } }
    sb = null; sbUrl = ''; sbKey = ''; sbP = null;
    S.mode = 'local'; S.online = false; S.email = ''; S.error = ''; S.rev = 0;
    saveCfg({ mode: 'local', email: '', dirty: '' });
    emitStatus();
    return Promise.resolve({ ok: true, kept: true });
  }
  /* oubli TOTAL (URL + clé + session) : réservé à un changement de projet */
  function forgetCfg() {
    clearCfg();
    if (chan && sb) { try { sb.removeChannel(chan); } catch (e) { } }
    chan = null;
    if (sb) { try { sb.auth.signOut(); } catch (e) { } }
    sb = null; sbUrl = ''; sbKey = ''; sbP = null;
    S.mode = 'local'; S.online = false; S.email = ''; S.error = ''; S.rev = 0;
    emitStatus();
    return Promise.resolve({ ok: true });
  }

  function health() {
    return client().then(function (c) {
      if (!c) return { ok: false, error: 'URL / clé anon non configurées' };
      return c.from(DOCTBL).select('rev').eq('doc_id', DOCID).maybeSingle().then(function (r) {
        if (r.error) {
          var m = r.error.message || '';
          if (/does not exist|relation|schema|could not find/i.test(m)) {
            return { ok: false, schema: true, error: m };
          }
          return { ok: false, error: m };
        }
        return { ok: true, exists: !!r.data, rev: r.data ? Number(r.data.rev || 0) : 0 };
      });
    }).catch(function (e) { return { ok: false, error: String(e && e.message || e) }; });
  }

  function uploadAsset(name, blob) {
    return client().then(function (c) {
      if (!c) throw new Error('non connecté');
      return c.auth.getUser().then(function (u) {
        var uid = u.data.user.id;
        var path = uid + '/' + String(name).replace(/[^\w.\-]/g, '_');
        return c.storage.from(BUCKET).upload(path, blob, { upsert: true }).then(function (r) {
          if (r.error) throw new Error(r.error.message);
          return c.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
        });
      });
    });
  }

  function initDB() {
    var c = cfg();
    S.device = deviceId();
    S.email = c.email || '';
    S.rev = Number(c.rev || 0);
    if (!c.url || !c.anon) { S.mode = 'local'; S.online = false; emitStatus(); return Promise.resolve(S); }
    return client().then(function (cl) {
      if (!cl) { S.mode = 'local'; emitStatus(); return S; }
      return cl.auth.getSession().then(function (s) {
        if (!s || !s.data || !s.data.session) {
          S.mode = 'local'; S.online = false; emitStatus(); return S;
        }
        S.mode = 'hybrid'; S.online = true;
        S.email = (s.data.session.user && s.data.session.user.email) || S.email;
        subscribe(); emitStatus();
        return S;
      });
    }).catch(function () { S.mode = 'local'; emitStatus(); return S; });
  }

  window.KStore = {
    state: S, cfg: cfg, saveCfg: saveCfg, clearCfg: clearCfg,
    connect: connect, disconnect: disconnect, forgetCfg: forgetCfg, initDB: initDB,
    health: health, pull: pull, push: push, flush: flush, sync: sync,
    markSynced: markSynced, markDirty: markDirty,
    onRemote: onRemote, onStatus: onStatus, bindDB: bindDB,
    uploadAsset: uploadAsset, normalizeUrl: normalizeUrl, client: client,
    statusText: statusText, deviceId: deviceId, isConfigured: isConfigured,
    mergeDB: mergeDB, isEmptyDB: isEmptyDB, saveIndex: saveIndex
  };
})();
