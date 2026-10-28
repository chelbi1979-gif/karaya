/* =====================================================================
   karaya-cloud.js — Passerelle de compatibilité (version corrigée)
   =====================================================================
   AVANT : ce fichier dupliquait la logique de la fenêtre cloud
   (recherche des champs par libellé, pré-remplissage, écoute du clic
   « اتصال », du clic « فصل », création d'un 2e client Supabase).
   Résultat : deux moteurs se disputaient les mêmes champs, et le
   pré-remplissage pouvait viser des <input> déjà détruits par un
   re-rendu de la fenêtre — d'où des champs vides au redémarrage.

   APRÈS : une seule source de vérité.
     * karaya-boot.js  = la fenêtre (champs, boutons, statut)
     * karaya-store.js = Supabase (session, push, pull, realtime)
     * karaya-cloud.js = simple façade window.KarayaCloud, sans aucun
       accès direct au DOM. Aucun conflit possible.
   ===================================================================== */
(function () {
  'use strict';

  function store() { return window.KStore || null; }
  function api() {
    return (window.pywebview && window.pywebview.api) ? window.pywebview.api : null;
  }

  window.KarayaCloud = {
    /* Config actuellement connue (localStorage, miroir de Python) */
    config: function () {
      var s = store();
      return s ? s.cfg() : {};
    },

    /* État lisible : { mode, online, email, lastSync, error } */
    state: function () {
      var s = store();
      return s ? s.state : { mode: 'local', online: false };
    },

    /* Recharger la config depuis Python puis tenter de restaurer
       la session Supabase (sans rien demander à l'utilisateur). */
    refresh: function () {
      var p = api(), s = store();
      if (!p || !p.get_cloud_config) return Promise.resolve(null);
      return p.get_cloud_config().then(function (r) {
        if (r && r.ok && r.configured && s) {
          s.saveCfg({ url: r.supabase_url, anon: r.supabase_anon_key, email: r.supabase_email });
          return s.initDB().then(function () { return r; });
        }
        return r;
      });
    },

    /* Connexion : o = {url, anon, email, password, signUp} */
    connect: function (o) {
      var s = store();
      if (!s) return Promise.reject(new Error('Window.KStore absent'));
      return s.connect(o).then(function (r) {
        var p = api();
        if (p && p.save_cloud_config) {
          try { p.save_cloud_config(o.url, o.anon, o.email || '', true); } catch (e) { }
        }
        return r;
      });
    },

    /* « فصل » : ferme la session SANS effacer URL + clé anon.
       La configuration reste en localStorage et dans
       %APPDATA%\Karaya\cloud.json : rien à ressaisir au redémarrage. */
    disconnect: function () {
      var s = store();
      return s ? s.disconnect() : Promise.resolve({ ok: true });
    },

    /* oubli TOTAL : URL + clé + session (changement de projet Supabase) */
    forget: function () {
      var s = store(), p = api();
      var done = s && s.forgetCfg ? s.forgetCfg() : (s ? s.disconnect() : Promise.resolve());
      if (p && p.clear_cloud_config) {
        try { Promise.resolve(p.clear_cloud_config()).catch(function () { }); } catch (e) { }
      }
      return done;
    },

    /* Synchronisation (pull puis push selon les révisions) */
    sync: function (db) {
      var s = store();
      if (!s) return Promise.reject(new Error('Window.KStore absent'));
      return s.sync(db);
    },

    test: function () {
      var s = store();
      if (!s) return Promise.resolve({ ok: false, error: 'Window.KStore absent' });
      return s.health();
    },

    statusText: function () {
      var s = store();
      return s ? s.statusText() : '';
    }
  };
})();
