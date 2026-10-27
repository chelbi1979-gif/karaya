/* =====================================================================
   karaya-store.js — Une seule interface de stockage, 3 moteurs :
     local   : localStorage + pont Python (Windows / mobile local)  [défaut]
     cloud   : Supabase du CLIENT (Postgres + Realtime + Storage)
     hybrid  : local d'abord, puis synchronisation cloud
   Aucune dépendance obligatoire : supabase-js est chargé à la demande
   (uniquement si le client active le cloud).
   ===================================================================== */
(function () {
  'use strict';

  var CFGKEY = 'karaya_cloud_cfg_v1';   /* {url, anon, email, mode} */
  var DOCTBL = 'karaya_docs';
  var BUCKET = 'karaya';
  var DOCID = 'main';

  function cfg() {
    try { return JSON.parse(localStorage.getItem(CFGKEY) || '{}') || {}; } catch (e) { return {}; }
  }
  function saveCfg(o) {
    var c = cfg(); for (var k in o) c[k] = o[k];
    try { localStorage.setItem(CFGKEY, JSON.stringify(c)); } catch (e) { }
    return c;
  }
  function clearCfg() { try { localStorage.removeItem(CFGKEY); } catch (e) { } }

  var sb = null, sbP = null;
  function loadSDK() {
    if (sbP) return sbP;
    sbP = import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm')
      .then(function (m) { return m.createClient || (m.default && m.default.createClient); })
      .catch(function () { return null; });
    return sbP;
  }
  function client() {
    var c = cfg();
    if (!c.url || !c.anon) return Promise.resolve(null);
    if (sb) return Promise.resolve(sb);
    return loadSDK().then(function (create) {
      if (!create) return null;
      sb = create(c.url, c.anon, { auth: { persistSession: true, autoRefreshToken: true } });
      return sb;
    });
  }

  /* ---------------- état observable ---------------- */
  var S = {
    mode: 'local', online: false, rev: 0, lastSync: '', device: '', email: '',
    listeners: [],            /* cb(remoteDb, meta) */
    statusListeners: []
  };
  function emitStatus() { S.listeners.forEach(function () { }); S.statusListeners.forEach(function (f) { try { f(S); } catch (e) { } }); }
  function onRemote(fn) { S.listeners.push(fn); }
  function onStatus(fn) { S.statusListeners.push(fn); try { fn(S); } catch (e) { } }

  /* ---------------- écriture locale ---------------- */
  var PUSHKEY = 'karaya_db_v2';
  var dbRef = null;           /* fourni par l'app : () => DB */
  function bindDB(getter) { dbRef = getter; }

  /* ---------------- push (local -> cloud) ---------------- */
  var pending = null, pushing = false, pushTimer = null;
  function push(db) {
    pending = db;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(function () { flush(); }, 900);
  }
  function flush() {
    if (pushing || !pending || S.mode === 'local') return Promise.resolve(false);
    pushing = true;
    var payload = pending; pending = null;
    return client().then(function (c) {
      if (!c) { pushing = false; return false; }
      var uid = (c.auth.getUser ? null : null);
      return c.auth.getUser().then(function (u) {
        var owner = u && u.data && u.data.user && u.data.user.id;
        if (!owner) { pushing = false; throw new Error('non connecté'); }
        return c.from(DOCTBL).upsert({
          doc_id: DOCID, owner: owner, payload: payload,
          rev: (S.rev || 0) + 1, updated_at: new Date().toISOString(),
          device: S.device
        }, { onConflict: 'doc_id' }).select('rev').single();
      }).then(function (r) {
        pushing = false; pending = null;
        if (r && r.data) S.rev = r.data.rev;
        S.online = true; S.lastSync = new Date().toLocaleTimeString();
        emitStatus();
        return true;
      }).catch(function (e) {
        pushing = false; pending = payload;   /* on réessaiera */
        S.online = false; emitStatus();
        return false;
      });
    });
  }

  /* ---------------- pull ---------------- */
  function pull() {
    return client().then(function (c) {
      if (!c) return null;
      return c.from(DOCTBL).select('payload,rev,updated_at,device').eq('doc_id', DOCID).maybeSingle();
    }).then(function (r) {
      if (!r || !r.data) return null;
      S.rev = r.data.rev || 0; S.online = true; S.lastSync = new Date().toLocaleTimeString();
      emitStatus();
      return { db: r.data.payload, rev: r.data.rev, at: r.data.updated_at, device: r.data.device };
    }).catch(function () { S.online = false; emitStatus(); return null; });
  }

  /* ---------------- realtime ---------------- */
  var chan = null;
  function subscribe() {
    if (S.mode === 'local') return;
    client().then(function (c) {
      if (!c || chan) return;
      chan = c.channel('karaya_doc_main')
        .on('postgres_changes', { event: '*', schema: 'public', table: DOCTBL, filter: 'doc_id=eq.' + DOCID },
          function (p) {
            var row = p && p.new;
            if (!row || !row.payload) return;
            if (row.device && row.device === S.device) return;      /* echo */
            S.rev = row.rev || S.rev; S.lastSync = new Date().toLocaleTimeString(); S.online = true;
            emitStatus();
            S.listeners.forEach(function (f) { try { f(row.payload, { rev: row.rev, device: row.device }); } catch (e) { } });
          })
        .subscribe();
    });
  }

  /* ---------------- connexion / migration ---------------- */
  function normalizeUrl(u) {
    u = String(u || '').trim().replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
    if (!/\.supabase\.co$/i.test(u)) u = u;    /* on n'impose rien de plus */
    return u;
  }
  function connect(o) {
    /* o = {url, anon, email, password} */
    saveCfg({ url: normalizeUrl(o.url), anon: String(o.anon || '').trim(), email: o.email || '' });
    sb = null; sbP = null; chan = null;
    return client().then(function (c) {
      if (!c) throw new Error('SDK indisponible (pas de connexion internet ?)');
      return c.auth.getSession();
    }).then(function (s) {
      if (s && s.data && s.data.session) return s.data.session;
      return client().then(function (c) {
        if (o.signUp) {
          return c.auth.signUp({ email: o.email, password: o.password }).then(function (r) {
            if (r.error) throw new Error(r.error.message);
            if (r.data && r.data.session) return r.data.session;
            return c.auth.signInWithPassword({ email: o.email, password: o.password }).then(function (r2) {
              if (r2.error) throw new Error(r2.error.message);
              return r2.data.session;
            });
          });
        }
        return c.auth.signInWithPassword({ email: o.email, password: o.password }).then(function (r) {
          if (r.error) throw new Error(r.error.message);
          return r.data.session;
        });
      });
    }).then(function (sess) {
      S.mode = 'hybrid'; S.email = (sess && sess.user && sess.user.email) || o.email || '';
      saveCfg({ mode: 'hybrid', email: S.email });
      S.device = window.KLicense ? window.KLicense.deviceId() : 'dev';
      subscribe();
      emitStatus();
      return { ok: true, email: S.email, userId: sess && sess.user && sess.user.id };
    });
  }
  function disconnect() {
    if (chan && sb) { try { sb.removeChannel(chan); } catch (e) { } }
    chan = null;
    if (sb) { try { sb.auth.signOut(); } catch (e) { } }
    S.mode = 'local'; S.online = false; clearCfg(); emitStatus();
  }
  function health() {
    return client().then(function (c) {
      if (!c) return { ok: false, error: 'non configuré' };
      return c.from(DOCTBL).select('rev').eq('doc_id', DOCID).maybeSingle().then(function (r) {
        if (r.error) {
          if (/does not exist|relation|schema/i.test(r.error.message || '')) return { ok: false, schema: true, error: r.error.message };
          return { ok: false, error: r.error.message };
        }
        return { ok: true, exists: !!r.data, rev: r.data ? r.data.rev : 0 };
      });
    }).catch(function (e) { return { ok: false, error: String(e) }; });
  }
  function uploadAsset(name, blob) {
    return client().then(function (c) {
      if (!c) throw new Error('non connecté');
      return c.auth.getUser().then(function (u) {
        var uid = u.data.user.id;
        var path = uid + '/' + String(name).replace(/[^\w.\-]/g, '_');
        return c.storage.from(BUCKET).upload(path, blob, { upsert: true }).then(function (r) {
          if (r.error) throw new Error(r.error.message);
          var pub = c.storage.from(BUCKET).getPublicUrl(path);
          return pub.data.publicUrl;
        });
      });
    });
  }
  function initDB() {
    var c = cfg();
    S.device = window.KLicense ? window.KLicense.deviceId() : 'dev';
    if (!c.url || !c.anon) { S.mode = 'local'; emitStatus(); return Promise.resolve(S); }
    S.mode = 'hybrid'; S.email = c.email || '';
    return client().then(function (cl) {
      if (!cl) { S.mode = 'local'; emitStatus(); return S; }
      return cl.auth.getSession().then(function (s) {
        if (!s || !s.data || !s.data.session) { S.mode = 'local'; emitStatus(); return S; }
        subscribe(); S.online = true; emitStatus(); return S;
      });
    }).catch(function () { S.mode = 'local'; emitStatus(); return S; });
  }

  window.KStore = {
    state: S, cfg: cfg, saveCfg: saveCfg, connect: connect, disconnect: disconnect,
    health: health, pull: pull, push: push, flush: flush, initDB: initDB,
    onRemote: onRemote, onStatus: onStatus, bindDB: bindDB,
    uploadAsset: uploadAsset, normalizeUrl: normalizeUrl,
    client: client
  };
})();
