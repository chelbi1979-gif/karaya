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

  /* ---------------- push (local -> cloud) ---------------- */
  var pending = null, pushing = false, pushTimer = null;
  function push(db) {
    pending = (db === undefined) ? null : db;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(function () { flush(); }, 900);
    if (!pending) {
      try { pending = dbRef ? dbRef() : null; } catch (e) { pending = null; }
    }
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
        return c.from(DOCTBL).upsert({
          doc_id: DOCID, owner: owner, payload: payload,
          rev: (Number(S.rev) || 0) + 1,
          updated_at: new Date().toISOString(),
          device: S.device
        }, { onConflict: 'doc_id' }).select('rev').single();
      }).then(function (r) {
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

  /* ---------------- synchronisation intelligente ----------------
     IMPORTANT : la révision locale est lue AVANT le pull.
     (Avant, pull() écrasait S.rev : la comparaison était toujours
      « égale » et les données locales écrasaient celles du cloud.)
     La révision est mémorisée dans la config → elle survit au redémarrage. */
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
      /* cloud plus récent, et aucune modification locale en attente */
      if (rrev > lrev && !dirty) {
        return { ok: true, action: 'pull', db: remote.db, rev: rrev };
      }
      if (!local) return { ok: true, action: 'pull', db: remote.db, rev: rrev };
      /* cloud plus récent MAIS modifications locales : conflit à arbitrer */
      if (rrev > lrev && dirty) {
        return { ok: true, action: 'conflict', db: remote.db, rev: rrev, localRev: lrev };
      }
      return flush2(local).then(function (ok) {
        return ok ? { ok: true, action: 'push', rev: S.rev }
                  : { ok: false, error: S.error || 'envoi impossible' };
      });
    }).catch(function (e) {
      return { ok: false, error: String(e && e.message || e) };
    });
  }
  function flush2(db) { pending = db; return flush(); }

  /* appelés par l'interface après application (ou refus) d'un pull */
  function markSynced(rev) { saveCfg({ rev: Number(rev) || 0, dirty: '' }); }
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
    statusText: statusText, deviceId: deviceId, isConfigured: isConfigured
  };
})();
