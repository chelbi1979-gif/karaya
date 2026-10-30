/* =====================================================================
   karaya-boot.js — Fenêtre unique : boutons LANGUE (ع/FR) + CLOUD
   =====================================================================
   POURQUOI CE FICHIER EXISTE (et pourquoi l'interface le perdait) :
   index.html charge <script src="karaya-boot.js"> en fin de page.
   Si ce fichier est absent du bundle PyInstaller/PyArmor, la requête
   renvoie 404 : les boutons « ع/FR » et « ☁️ » n'existent plus dans la
   barre supérieure, et le module karaya-i18n.js n'est jamais piloté.
   => C'est exactement le symptôme « la traduction ar/fr et le cloud
      disparaissent ».

   RÈGLES DE CONCEPTION (à ne pas casser) :
     * Aucune logique Supabase ici      -> karaya-store.js
     * Aucune synthèse de requête ici   -> karaya-store.js
     * Aucun accès aux <input> par leur libellé : uniquement des ids
       stables (#kb-url, #kb-anon, ...). C'était la cause des champs
       vides au redémarrage.
     * La configuration (URL + clé anon) est saisie UNE SEULE FOIS :
       elle est écrite dans localStorage ET dans
       %APPDATA%\Karaya\cloud.json via pywebview (save_cloud_config).
       Au démarrage suivant, refresh() la relit : plus rien à saisir.
   ===================================================================== */
(function () {
  'use strict';

  var VERSION = '2.0';
  var built = false;
  var autoTimer = null;
  var lastSyncAt = '';

  function $(id) { return document.getElementById(id); }
  function val(id) { var e = $(id); return e ? String(e.value || '').trim() : ''; }
  function store() { return window.KStore || null; }
  function cloudApi() { return window.KarayaCloud || null; }
  function pyapi() { return (window.pywebview && window.pywebview.api) ? window.pywebview.api : null; }
  function app() { return window.KarayaApp || null; }
  function t(ar) {
    try { return (window.I18N && window.I18N.tr) ? window.I18N.tr(ar) : ar; } catch (e) { return ar; }
  }

  /* ---------- DB de l'application (exposée par index.html) ---------- */
  function getDB() {
    var a = app();
    try { return a && a.getDB ? a.getDB() : null; } catch (e) { return null; }
  }
  function setDB(d) {
    var a = app();
    if (!a || !a.setDB) return false;
    try { return !!a.setDB(d); } catch (e) { return false; }
  }

  /* ---------- traductions des libellés de cette fenêtre ---------- */
  function addI18n() {
    if (!window.I18N || !window.I18N.add) return;
    window.I18N.add({
      'اللغة': 'Langue',
      'ربط السحابة': 'Connexion cloud',
      'عنوان المشروع': 'URL du projet',
      'المفتاح العام': 'Clé anon (publique)',
      'البريد الإلكتروني': 'E-mail',
      'كلمة المرور': 'Mot de passe',
      'إنشاء حساب جديد': 'Créer le compte',
      'حفظ الإعدادات': 'Enregistrer',
      'اختبار الاتصال': 'Tester',
      'مزامنة الآن': 'Synchroniser',
      'إغلاق': 'Fermer',
      'يُدخل مرة واحدة فقط ثم يُحفظ تلقائيا': 'Saisi une seule fois, puis mémorisé',
      'السحابة': 'Cloud',
      'غير مضبوطة': 'non configurée',
      'متصلة': 'connectée',
      'محلية': 'locale',
      'لم يتم ضبط السحابة بعد': 'Cloud pas encore configuré',
      'تم الإرسال إلى السحابة': 'Envoyé vers le cloud',
      'تم التحديث من السحابة': 'Mis à jour depuis le cloud',
      'كل شيء محدّث': 'Tout est à jour',
      'جاري الاتصال…': 'Connexion…',
      'جاري المزامنة…': 'Synchronisation…',
      'تعذر الاتصال': 'Connexion impossible',
      'أدخل عنوان المشروع و المفتاح العام': 'Renseignez l’URL et la clé anon',
      'النسخة السحابية أحدث. استبدال البيانات المحلية بالنسخة السحابية ؟\n(إلغاء = الاحتفاظ بالمحلي وإرساله)': 'La version cloud est plus récente. Remplacer les données locales par la version cloud ?\n(Annuler = garder le local et l’envoyer)',
      'تم حفظ الإعدادات — لن تُطلب مرة أخرى': 'Réglages enregistrés — ils ne seront plus demandés',
      'مطلوب البريد و كلمة المرور لأول اتصال': 'E-mail + mot de passe requis pour la première connexion',
      'اتصال': 'Connexion',
      'فصل': 'Déconnecter'
    });
  }

  /* ---------- styles ---------- */
  function addCss() {
    if ($('kb-css')) return;
    var st = document.createElement('style');
    st.id = 'kb-css';
    st.textContent =
      '.kb-bg{position:fixed;inset:0;background:rgba(31,23,32,.55);display:flex;align-items:center;justify-content:center;z-index:99990;padding:14px}' +
      '.kb-card{background:#fff;border-radius:16px;width:100%;max-width:540px;max-height:92vh;overflow:auto;box-shadow:0 26px 60px -22px rgba(0,0,0,.5);border:1px solid #ecdfe6}' +
      '.kb-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:13px 15px;border-bottom:1px solid #ecdfe6;background:#fdf2f8;position:sticky;top:0}' +
      '.kb-head h3{margin:0;font-size:15px;font-weight:800;color:#9d174d}' +
      '.kb-x{border:0;background:#fff;color:#7c6f77;border-radius:9px;width:30px;height:30px;font-size:15px;cursor:pointer}' +
      '.kb-body{padding:13px 15px}' +
      '.kb-f{margin-bottom:10px}' +
      '.kb-f label{display:block;font-size:12px;font-weight:700;color:#7c6f77;margin-bottom:4px}' +
      '.kb-f input{width:100%;box-sizing:border-box;padding:9px 11px;border:1px solid #ecdfe6;border-radius:10px;font-size:13px;font-family:inherit;color:#1f1720;background:#fff}' +
      '.kb-f input:focus{outline:0;border-color:#9d174d;box-shadow:0 0 0 3px #fdf2f8}' +
      '.kb-chk{display:flex;align-items:center;gap:7px;font-size:12.5px;color:#7c6f77;margin:2px 0 10px}' +
      '.kb-hint{font-size:11.5px;color:#7c6f77;background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:7px 9px;margin-bottom:11px;line-height:1.5}' +
      '.kb-row{display:flex;flex-wrap:wrap;gap:8px;margin-top:4px}' +
      '.kb-btn{border:1px solid #ecdfe6;background:#fff;color:#1f1720;border-radius:10px;padding:8px 13px;font-size:12.5px;font-weight:700;font-family:inherit;cursor:pointer}' +
      '.kb-btn.pri{background:#9d174d;border-color:#9d174d;color:#fff}' +
      '.kb-btn.ok{background:#ecfdf5;border-color:#a7f3d0;color:#047857}' +
      '.kb-btn.dan{background:#fef2f2;border-color:#fecaca;color:#b91c1c}' +
      '.kb-btn[disabled]{opacity:.55;cursor:not-allowed}' +
      /* champs secrets rendus en points : le champ n'est plus de type
         "password", donc Chrome/Samsung Pass ne proposent plus rien */
      '.kb-txtsec,[data-karaya-secret]{-webkit-text-security:disc!important}' +
      'input::-webkit-credentials-auto-fill-button{display:none!important;visibility:hidden!important}' +
      '.kb-st{margin-top:11px;font-size:12px;border-radius:10px;padding:8px 10px;background:#f7f4f6;color:#7c6f77;min-height:18px;line-height:1.5;word-break:break-word;direction:ltr;text-align:left}' +
      '.kb-st.ok{background:#ecfdf5;color:#047857}' +
      '.kb-st.err{background:#fef2f2;color:#b91c1c}' +
      '.kb-st.warn{background:#fffbeb;color:#b45309}' +
      '#btnCloud.kb-on{background:#ecfdf5!important;color:#047857!important;border-color:#a7f3d0!important}' +
      '#btnCloud.kb-off{background:#f7f4f6!important;color:#7c6f77!important}';
    document.head.appendChild(st);
  }

  function setStatus(msg, kind) {
    var el = $('kb-status');
    if (!el) return;
    el.className = 'kb-st' + (kind ? ' ' + kind : '');
    el.textContent = msg || '';
  }

  /* ---------- persistance minimale (sans connexion) ---------- */
  function persistCfg() {
    var s = store();
    var url = val('kb-url'), anon = val('kb-anon'), email = val('kb-email');
    if (!url || !anon) { setStatus(t('أدخل عنوان المشروع و المفتاح العام'), 'warn'); return false; }
    if (s && s.saveCfg) s.saveCfg({ url: url, anon: anon, email: email, mode: 'hybrid' });
    var p = pyapi();
    if (p && p.save_cloud_config) {
      try {
        Promise.resolve(p.save_cloud_config(url, anon, email, true)).catch(function () { });
      } catch (e) { }
    }
    return true;
  }

  /* ---------- synchronisation ---------- */
  function doSync(silent) {
    var s = store();
    if (!s) { if (!silent) setStatus('KStore absent', 'err'); return Promise.resolve(null); }
    if (!s.isConfigured()) {
      if (!silent) setStatus(t('لم يتم ضبط السحابة بعد'), 'warn');
      return Promise.resolve(null);
    }
    if (!silent) setStatus(t('جاري المزامنة…'));
    return s.sync(getDB()).then(function (r) {
      if (!r) return null;
      if (r.ok && r.action === 'pull' && r.db) {
        setDB(r.db);
        if (s.markSynced) s.markSynced(r.rev, r.db);
        lastSyncAt = new Date().toLocaleTimeString();
        if (!silent) setStatus(t('تم التحديث من السحابة') + ' — ' + lastSyncAt, 'ok');
      } else if (r.ok && r.action === 'push') {
        if (s.markSynced) s.markSynced(r.rev || s.state.rev, getDB());
        lastSyncAt = new Date().toLocaleTimeString();
        if (!silent) setStatus(t('تم الإرسال إلى السحابة') + ' — ' + lastSyncAt, 'ok');
      } else if (r.ok && r.action === 'merged') {
        /* fusion intelligente : le résultat combiné est appliqué en local
           ET envoyé au cloud — rien n'est perdu des deux côtés */
        setDB(r.db);
        if (s.markSynced) s.markSynced(r.rev || s.state.rev, r.db);
        lastSyncAt = new Date().toLocaleTimeString();
        if (!silent) {
          var n = r.stats ? (r.stats.fromCloud + r.stats.updatedByCloud + r.stats.fromLocal + r.stats.updatedByLocal) : 0;
          setStatus(t('دمج ذكي تم') + ' (' + n + ') — ' + lastSyncAt, 'ok');
        }
      } else if (r.ok && r.action === 'conflict') {
        var keep = window.confirm(t('النسخة السحابية أحدث. استبدال البيانات المحلية بالنسخة السحابية ؟\n(إلغاء = الاحتفاظ بالمحلي وإرساله)'));
        if (keep) {
          setDB(r.db);
          if (s.markSynced) s.markSynced(r.rev);
          setStatus(t('تم التحديث من السحابة'), 'ok');
        } else if (s.markDirty) {
          s.markDirty();
          s.push(getDB());
          setStatus(t('تم الإرسال إلى السحابة'), 'ok');
        }
      } else if (!r.ok) {
        if (!silent) setStatus(r.error || 'erreur', 'err');
      } else if (!silent) {
        setStatus(t('كل شيء محدّث'), 'ok');
      }
      paintBadge();
      return r;
    }).catch(function (e) {
      if (!silent) setStatus(String(e && e.message || e), 'err');
      paintBadge();
      return null;
    });
  }

  function btnBusy(on) {
    ['kb-connect', 'kb-save', 'kb-test', 'kb-sync'].forEach(function (id) {
      var b = $(id); if (b) b.disabled = !!on;
    });
  }

  /* ---------- actions de la fenêtre ---------- */
  function onConnect() {
    var c = cloudApi(), s = store();
    var o = {
      url: val('kb-url'), anon: val('kb-anon'), email: val('kb-email'),
      password: ($('kb-pass') ? $('kb-pass').value : ''),
      signUp: !!($('kb-signup') && $('kb-signup').checked)
    };
    if (!o.url || !o.anon) { setStatus(t('أدخل عنوان المشروع و المفتاح العام'), 'warn'); return; }
    persistCfg();                       /* enregistré même si le mot de passe est faux */
    if (!c || !s) { setStatus('KStore / KarayaCloud absents', 'err'); return; }
    btnBusy(true);
    setStatus(t('جاري الاتصال…'));
    c.connect(o).then(function (r) {
      btnBusy(false);
      setStatus((r && r.email ? r.email : '') + ' ✓', 'ok');
      if ($('kb-pass')) $('kb-pass').value = '';
      prefill();
      paintBadge();
      return doSync(false);
    }).catch(function (e) {
      btnBusy(false);
      var m = String(e && e.message || e);
      if (/password|E-mail/i.test(m) && !o.password) m = t('مطلوب البريد و كلمة المرور لأول اتصال');
      setStatus(m, 'err');
      paintBadge();
    });
  }

  function onDisconnect() {
    var c = cloudApi();
    if (!c) return;
    c.disconnect().then(function () {
      setStatus(t('محلية'), 'warn');
      if ($('kb-pass')) $('kb-pass').value = '';
      prefill();
      paintBadge();
    });
  }

  function onTest() {
    var c = cloudApi();
    if (!c) { setStatus('KarayaCloud absent', 'err'); return; }
    persistCfg();
    btnBusy(true);
    setStatus(t('جاري الاتصال…'));
    c.test().then(function (r) {
      btnBusy(false);
      if (r && r.ok) {
        setStatus('OK — table ' + 'karaya_docs' + (r.exists ? ' / doc présent (rev ' + r.rev + ')' : ' / vide'), 'ok');
      } else if (r && r.schema) {
        setStatus('Table karaya_docs ABSENTE : exécutez le SQL fourni dans Supabase → SQL Editor.\n' + (r.error || ''), 'err');
      } else {
        setStatus((r && r.error) || 'erreur', 'err');
      }
    }).catch(function (e) {
      btnBusy(false);
      setStatus(String(e && e.message || e), 'err');
    });
  }

  function onSaveOnly() {
    if (persistCfg()) setStatus(t('تم حفظ الإعدادات — لن تُطلب مرة أخرى'), 'ok');
  }

  /* ---------- fenêtre ---------- */
  function openPanel() {
    build();
    var bg = $('kb-modal');
    if (bg) { bg.style.display = 'flex'; prefill(); }
  }
  function closePanel() {
    var bg = $('kb-modal');
    if (bg) bg.style.display = 'none';
  }

  function prefill() {
    var s = store();
    var c = (s && s.cfg) ? s.cfg() : {};
    if ($('kb-url') && !$('kb-url').value && c.url) $('kb-url').value = c.url;
    if ($('kb-anon') && !$('kb-anon').value && c.anon) $('kb-anon').value = c.anon;
    if ($('kb-email') && !$('kb-email').value && c.email) $('kb-email').value = c.email;
    paintBadge();
  }

  function build() {
    if (built && $('kb-modal')) return;
    built = true;
    addCss();
    addI18n();
    var bg = document.createElement('div');
    bg.id = 'kb-modal';
    bg.className = 'kb-bg';
    bg.style.display = 'none';
    bg.innerHTML =
      '<div class="kb-card" role="dialog" aria-modal="true">' +
      '  <div class="kb-head"><h3>☁️ ' + t('ربط السحابة') + '</h3>' +
      '    <button class="kb-x" id="kb-close" type="button" aria-label="' + t('إغلاق') + '">✕</button></div>' +
      '  <div class="kb-body">' +
      '    <div class="kb-hint">' + t('يُدخل مرة واحدة فقط ثم يُحفظ تلقائيا') + '</div>' +
      '    <div class="kb-f"><label for="kb-url">' + t('عنوان المشروع') + ' (https://xxx.supabase.co)</label>' +
      '      <input id="kb-url" type="text" dir="ltr" autocomplete="off" spellcheck="false" placeholder="https://xxxxx.supabase.co"></div>' +
      '    <div class="kb-f"><label for="kb-anon">' + t('المفتاح العام') + ' (anon)</label>' +
      '      <input id="kb-anon" type="text" dir="ltr" autocomplete="off" spellcheck="false" data-lpignore="true" data-1p-ignore="true" data-bwignore="true" data-form-type="other" placeholder="eyJhbGciOi..."></div>' +
      '    <div class="kb-f"><label for="kb-email">' + t('البريد الإلكتروني') + '</label>' +
      '      <input id="kb-email" type="text" inputmode="email" dir="ltr" autocomplete="off" spellcheck="false" data-lpignore="true" data-1p-ignore="true" data-bwignore="true" data-form-type="other"></div>' +
      '    <div class="kb-f"><label for="kb-pass">' + t('كلمة المرور') + '</label>' +
      '      <input id="kb-pass" type="text" class="kb-txtsec" dir="ltr" autocomplete="off" spellcheck="false" autocorrect="off" autocapitalize="off" data-lpignore="true" data-1p-ignore="true" data-bwignore="true" data-form-type="other"></div>' +
      '    <label class="kb-chk"><input id="kb-signup" type="checkbox"> ' + t('إنشاء حساب جديد') + '</label>' +
      '    <div class="kb-row">' +
      '      <button class="kb-btn ok" id="kb-connect" type="button">' + t('اتصال') + '</button>' +
      '      <button class="kb-btn" id="kb-save" type="button">' + t('حفظ الإعدادات') + '</button>' +
      '      <button class="kb-btn" id="kb-test" type="button">' + t('اختبار الاتصال') + '</button>' +
      '      <button class="kb-btn pri" id="kb-sync" type="button">' + t('مزامنة الآن') + '</button>' +
      '      <button class="kb-btn dan" id="kb-disconnect" type="button">' + t('فصل') + '</button>' +
      '    </div>' +
      '    <div class="kb-st" id="kb-status"></div>' +
      '  </div>' +
      '</div>';
    document.body.appendChild(bg);
    bg.addEventListener('click', function (e) { if (e.target === bg) closePanel(); });
    $('kb-close').addEventListener('click', closePanel);
    $('kb-connect').addEventListener('click', onConnect);
    $('kb-save').addEventListener('click', onSaveOnly);
    $('kb-test').addEventListener('click', onTest);
    $('kb-sync').addEventListener('click', function () { doSync(false); });
    $('kb-disconnect').addEventListener('click', onDisconnect);
    ['kb-url', 'kb-anon', 'kb-email'].forEach(function (id) {
      var e = $(id); if (e) e.addEventListener('change', persistCfg);
    });
  }

  /* ---------- boutons de la barre supérieure ---------- */
  function mount() {
    addCss();
    addI18n();
    var bar = document.querySelector('.topactions') || document.querySelector('.topbar');
    if (!bar) return;

    if (!document.getElementById('btnLang')) {
      var lb = document.createElement('button');
      lb.className = 'icobtn';
      lb.id = 'btnLang';
      lb.type = 'button';
      lb.style.cssText = 'background:#eff6ff;color:#1d4ed8;border-color:#bfdbfe;font-weight:800;font-size:12px;min-width:38px';
      lb.title = 'اللغة / Langue';
      lb.textContent = curLang() === 'fr' ? 'ع' : 'FR';
      lb.addEventListener('click', function () {
        var next = curLang() === 'fr' ? 'ar' : 'fr';
        try { window.dispatchEvent(new CustomEvent('karaya:langchange-request', { detail: next })); } catch (e) { }
        if (window.I18N && window.I18N.set) { try { window.I18N.set(next); } catch (e) { } }
        lb.textContent = next === 'fr' ? 'ع' : 'FR';
        paintBadge();
      });
      bar.appendChild(lb);
    }

    if (!document.getElementById('btnCloud')) {
      var cb = document.createElement('button');
      cb.className = 'icobtn kb-off';
      cb.id = 'btnCloud';
      cb.type = 'button';
      cb.title = 'السحابة — Cloud';
      cb.textContent = '☁️';
      cb.addEventListener('click', openPanel);
      bar.appendChild(cb);
    }
    build();
    prefill();
    paintBadge();
  }

  function curLang() {
    try { return (window.I18N && window.I18N.lang) || 'ar'; } catch (e) { return 'ar'; }
  }

  function paintBadge() {
    var b = document.getElementById('btnCloud');
    if (!b) return;
    var s = store();
    var st = (s && s.state) ? s.state : null;
    var on = !!(st && st.online);
    b.classList.toggle('kb-on', on);
    b.classList.toggle('kb-off', !on);
    var txt = on ? t('متصلة') : t('محلية');
    if (on && lastSyncAt) txt += ' ' + lastSyncAt;
    b.title = t('السحابة') + ' — ' + txt;
  }

  /* ---------- démarrage ---------- */
  function startAuto() {
    if (autoTimer) clearInterval(autoTimer);
    autoTimer = setInterval(function () {
      var s = store();
      if (!s || !s.isConfigured()) return;
      /* CORRECTIF : avant, on exigeait state.online. Si le poste demarrait
         hors ligne, online restait false et la synchro automatique ne
         partait PLUS JAMAIS, meme apres le retour du reseau. sync() sait
         echouer proprement, on la lance donc des que le cloud est configure. */
      if (document.hidden) return;
      doSync(true);
    }, 90000);
  }

  function boot() {
    try { mount(); } catch (e) { }
    startAuto();                     /* démarré AVANT le test : sinon jamais lancé */
    var c = cloudApi();
    if (!c) return;
    /* 1) récupérer la config mémorisée côté Python (survit à une
          réinstallation / à un localStorage vidé) puis restaurer la session */
    try {
      c.refresh().then(function (r) {
        prefill();
        paintBadge();
        var s = store();
        if (s && s.state && s.state.online) doSync(true);
        else if (r && r.configured) setStatus(t('محلية'), 'warn');
      }).catch(function () { });
    } catch (e) { }
  }

  /* enregistrement des données distantes (realtime) */
  function wire() {
    var s = store();
    if (!s || !s.onRemote) return;
    try {
      s.onRemote(function (payload, meta) {
        if (!payload) return;
        if (setDB(payload)) {
          /* on memorise la revision distante : sans cela, cfg.rev restait
             en retard et le prochain sync renvoyait le local par-dessus
             le distant (ecrasement silencieux des donnees de l'autre poste). */
          try { if (s.markSynced && meta && meta.rev) s.markSynced(meta.rev); } catch (e) { }
          lastSyncAt = new Date().toLocaleTimeString();
          setStatus(t('تم التحديث من السحابة'), 'ok');
          paintBadge();
        }
      });
    } catch (e) { }
    try {
      if (s.bindDB) s.bindDB(getDB);
    } catch (e) { }
  }

  window.KarayaBoot = {
    version: VERSION,
    build: mount,
    open: openPanel,
    close: closePanel,
    sync: function () { return doSync(false); },
    status: function () { var s = store(); return s ? s.statusText() : ''; }
  };

  function ready() {
    addI18n();
    try { mount(); } catch (e) { }
    try { wire(); } catch (e) { }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready);
  else ready();
  window.addEventListener('pywebviewready', function () { ready(); boot(); });
  window.addEventListener('karaya:cloud-connected', function () { prefill(); paintBadge(); doSync(true); });
  window.addEventListener('karaya:lang', function () {
    var lb = document.getElementById('btnLang');
    if (lb) lb.textContent = curLang() === 'fr' ? 'ع' : 'FR';
    paintBadge();
  });
  setTimeout(boot, 1200);
  setTimeout(ready, 2500);

  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) { paintBadge(); }
  });
})();

/* =====================================================================
   karaya-boot.js — MODULE 2 (ajouté) : MODE KIOSQUE + SAUVEGARDE DATÉE
   =====================================================================
   Ce bloc est AJOUTÉ à la fin de karaya-boot.js. Il ne remplace rien :
   les boutons ع/FR et ☁️ continuent de fonctionner exactement comme avant.

   DEUX RÔLES
   ---------------------------------------------------------------------
   A) MODE KIOSQUE (tablette de magasin confiée à des employés)
        * aucune demande de permission « Notifications » n'est faite ici
          (et il n'y en avait aucune dans index.html : vérifié) ;
        * la traduction automatique du navigateur est neutralisée :
          <html translate="no">, <meta name="google" content="notranslate">,
          et tout champ créé dynamiquement reçoit translate="no" ;
        * les gestionnaires de mots de passe (Chrome, Samsung Pass, 1Password,
          Bitwarden) ne proposent plus d'enregistrer le mot de passe
          admin / utilisateur : autocomplete="off" + attributs data-*-ignore
          + verrou readOnly au focus (technique « readonly trick »).
     ⚠️ Ce qui NE PEUT PAS être forcé : Edge/Safari peuvent encore afficher
        une bulle de leur côté. Le `readonly` trick et autocomplete="off"
        suppriment la très grande majorité des bulles sur Chrome/Android.

   B) SAUVEGARDE JSON PAR DATE, dans un sous-dossier de l'application
        1. window.AndroidBridge  (Kotlin, cf. KarayaNativeBridge.kt)
             → filesDir/backups/AAAA-MM-JJ.json   (privé, atomique, rotation)
        2. sinon File System Access API (Chrome) → dossier choisi une fois
        3. sinon OPFS (navigator.storage.getDirectory) → /backups/AAAA-MM-JJ.json
        4. en permanence : copie de secours localStorage (7 derniers jours)
        5. export manuel : téléchargement (ou MediaStore via le pont)

   API PUBLIQUE
     window.KarayaBackup.saveNow()      → sauvegarde immédiate
     window.KarayaBackup.engine()       → 'android' | 'fsa' | 'opfs' | 'download'
     window.KarayaBackup.list()         → Promise<[{date,bytes}]>
     window.KarayaBackup.export(date?)  → export vers Téléchargements
     window.KarayaBackup.last            → dernière sauvegarde

   DÉCLENCHEURS : à chaque enregistrement (événement 'karaya:saved' émis par
   save() dans index.html), toutes les 10 min, au passage en arrière-plan,
   et 3 s après le démarrage.
   ===================================================================== */
(function () {
  'use strict';

  var CFG = {
    kiosk: true,            /* passez à false pour rendre la main au navigateur */
    readonlyTrick: true,    /* verrou anti-gestionnaire de mots de passe        */
    keepDays: 90,           /* rotation côté Kotlin / FSA                       */
    ringDays: 7,            /* copie localStorage                               */
    debounce: 5000,
    periodic: 600000
  };

  function $(id) { return document.getElementById(id); }
  function app() { return window.KarayaApp || null; }
  function getDB() {
    try { var a = app(); return a && a.getDB ? a.getDB() : null; } catch (e) { return null; }
  }
  function today() {
    var d = new Date(), p = function (n) { return ('0' + n).slice(-2); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
  function nowISO() { return new Date().toISOString(); }

  /* ==================================================================
     A. MODE KIOSQUE
     ================================================================== */
  /* ids/noms qui ressemblent à un secret (clé de licence, mot de passe,
     token, clé anon...) : le gestionnaire de mots de passe de Chrome
     s'y déclenche même sans type="password" → on les neutralise aussi */
  var SECRET_RE = /(^|[_\-])(pwd|passwd|pass|password|motdepasse|key|cle|secret|anon|token|apikey|api[-_]?key|license)($|[_\-])/i;

  function harden(root) {
    /* la règle « points » doit exister AVANT la conversion type=password →
       type=text, sinon le mot de passe s'afficherait en clair une seconde */
    if (!document.getElementById('kb-css-sec') && document.head) {
      try {
        var sst = document.createElement('style');
        sst.id = 'kb-css-sec';
        sst.textContent = '.kb-txtsec,[data-karaya-secret]{-webkit-text-security:disc!important}' +
          'input::-webkit-credentials-auto-fill-button{display:none!important;visibility:hidden!important}';
        document.head.appendChild(sst);
      } catch (e) { }
    }
    if (!root || !root.querySelectorAll) return;
    var sel = 'input, textarea, select, button, form';
    var nodes = root.querySelectorAll(sel);
    for (var i = 0; i < nodes.length; i++) {
      var e = nodes[i];
      if (e.getAttribute && e.getAttribute('translate') !== 'no') {
        try { e.setAttribute('translate', 'no'); } catch (err) { }
      }
      var t = '';
      try { t = (e.getAttribute('type') || '').toLowerCase(); } catch (err) { }
      var looksSecret = false;
      try {
        looksSecret = SECRET_RE.test(e.id || '') || SECRET_RE.test(e.name || '') ||
                      SECRET_RE.test(e.getAttribute('placeholder') || '');
      } catch (err) { }
      if (t === 'password' || (looksSecret && (t === 'text' || t === '' || t === 'email'))) {
        try { e.setAttribute('autocomplete', 'off'); } catch (err) { }
        try { e.setAttribute('name', 'k_' + (e.id || 'f' + i) + '_x'); } catch (err) { }
        try { e.setAttribute('data-lpignore', 'true'); } catch (err) { }
        try { e.setAttribute('data-1p-ignore', 'true'); } catch (err) { }
        try { e.setAttribute('data-bwignore', 'true'); } catch (err) { }
        try { e.setAttribute('data-form-type', 'other'); } catch (err) { }
        try { e.setAttribute('autocorrect', 'off'); } catch (err) { }
        try { e.setAttribute('autocapitalize', 'off'); } catch (err) { }
        try { e.setAttribute('spellcheck', 'false'); } catch (err) { }
        try { e.classList.add('kb-txtsec'); } catch (err) { }
        try { e.setAttribute('data-karaya-secret', 'true'); } catch (err) { }
        /* un <input type=password> reste « détectable » par le gestionnaire
           de mots de passe même avec autocomplete=off : on le convertit en
           champ texte masqué par -webkit-text-security → plus de détection */
        try { if (t === 'password') e.setAttribute('type', 'text'); } catch (err) { }
        if (CFG.readonlyTrick && !e.__kbLock) {
          e.__kbLock = true;
          /* le champ redevient normal dès la 1re frappe / le 1er focus */
          e.addEventListener('focus', function () {
            var el = this;
            el.readOnly = true;
            setTimeout(function () { el.readOnly = false; }, 70);
          }, true);
        }
      }
    }
  }

  function kioskMode() {
    if (!CFG.kiosk) return;
    try {
      document.documentElement.setAttribute('translate', 'no');
      document.documentElement.classList.add('notranslate');
    } catch (e) { }
    try {
      if (!document.querySelector('meta[name="google"][content="notranslate"]')) {
        var m = document.createElement('meta');
        m.name = 'google'; m.content = 'notranslate';
        document.head.appendChild(m);
      }
    } catch (e) { }
    harden(document);
    /* les écrans / fenêtres sont re-rendus en permanence : on surveille */
    try {
      var mo = new MutationObserver(function (muts) {
        for (var i = 0; i < muts.length; i++) {
          var added = muts[i].addedNodes;
          for (var j = 0; j < added.length; j++) {
            if (added[j].nodeType === 1) harden(added[j].parentNode || added[j]);
          }
        }
      });
      mo.observe(document.body, { childList: true, subtree: true });
    } catch (e) { }
    /* on ne demande JAMAIS la permission Notifications (cohérence bureau) */
    try {
      if (window.Notification && Notification.permission === 'default') {
        /* volontairement vide : ne pas appeler requestPermission() */
      }
    } catch (e) { }
  }

  /* ==================================================================
     B. SAUVEGARDE DATÉE
     ================================================================== */
  var lastSave = null, timer = null, busy = false, dirHandle = null;

  function bridge() {
    var b = window.AndroidBridge;
    if (!b) return null;
    try { if (typeof b.ping === 'function') { var p = JSON.parse(b.ping()); if (p && p.ok) return b; } } catch (e) { }
    try { if (typeof b.saveJson === 'function') return b; } catch (e) { }
    return null;
  }

  function payload() {
    var db = getDB();
    if (!db || typeof db !== 'object') return null;
    var c = function (k) { return Array.isArray(db[k]) ? db[k].length : 0; };
    return JSON.stringify({
      app: 'karaya', schema: 'loc-db-v1', version: (window.KarayaApp && KarayaApp.version) || '3.0',
      savedAt: nowISO(), date: today(),
      platform: (window.KLicense && KLicense.platform) ? KLicense.platform() : 'web',
      counts: { articles: c('articles'), clients: c('clients'), locs: c('locs'), lines: c('lines'), users: c('users') },
      db: db
    });
  }

  /* --- copie de secours localStorage (toujours, même sans pont) ------ */
  function ringWrite(json) {
    var k = 'karaya_bk_' + today();
    try { localStorage.setItem(k, json); } catch (e) { return false; }
    try {
      var keys = [];
      for (var i = 0; i < localStorage.length; i++) {
        var kk = localStorage.key(i);
        if (kk && kk.indexOf('karaya_bk_') === 0) keys.push(kk);
      }
      keys.sort();
      while (keys.length > CFG.ringDays) {
        var old = keys.shift();
        if (old !== k) localStorage.removeItem(old);
      }
    } catch (e) { }
    return true;
  }

  /* --- OPFS -------------------------------------------------------- */
  function opfsWrite(json) {
    if (!navigator.storage || !navigator.storage.getDirectory) return Promise.resolve(false);
    return navigator.storage.getDirectory().then(function (rootDir) {
      return rootDir.getDirectoryHandle('backups', { create: true });
    }).then(function (dir) {
      return dir.getFileHandle(today() + '.json', { create: true });
    }).then(function (fh) {
      return fh.createWritable();
    }).then(function (w) {
      return w.write(json).then(function () { return w.close(); });
    }).then(function () { return true; }).catch(function () { return false; });
  }

  /* --- File System Access (dossier choisi par l'utilisateur) -------- */
  function fsaWrite(json) {
    if (!window.showDirectoryPicker) return Promise.resolve(false);
    var p = dirHandle ? Promise.resolve(dirHandle) : Promise.reject(new Error('no-handle'));
    return p.then(function (dir) {
      return dir.getDirectoryHandle('karaya-backups', { create: true });
    }).then(function (dir) {
      return dir.getFileHandle(today() + '.json', { create: true });
    }).then(function (fh) {
      return fh.createWritable();
    }).then(function (w) {
      return w.write(json).then(function () { return w.close(); });
    }).then(function () { return true; }).catch(function () { return false; });
  }

  /* --- téléchargement (dernier recours : TWA sans pont) ------------- */
  function download(json, name) {
    try {
      var b = new Blob([json], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(b);
      a.download = (name || ('karaya-' + today())) + '.json';
      document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
      return true;
    } catch (e) { return false; }
  }

  function engine() {
    if (bridge()) return 'android';
    if (dirHandle && window.showDirectoryPicker) return 'fsa';
    if (navigator.storage && navigator.storage.getDirectory) return 'opfs';
    return 'download';
  }

  /* --- la fonction unique ------------------------------------------- */
  function saveNow(opts) {
    opts = opts || {};
    if (busy) return Promise.resolve(lastSave);
    var json = payload();
    if (!json) { if (opts.verbose) console.warn('[Karaya] rien à sauvegarder (DB vide)'); return Promise.resolve(null); }
    busy = true;
    ringWrite(json);                                   /* filet de sécurité */

    var b = bridge();
    if (b) {
      try {
        var r = JSON.parse(b.saveJson(today(), json));
        busy = false;
        if (r && r.ok) {
          lastSave = { engine: 'android', date: today(), file: r.file, path: r.path, at: nowISO(), bytes: r.bytes };
          console.info('[Karaya] sauvegarde Android →', r.path);
          return Promise.resolve(lastSave);
        }
        console.warn('[Karaya] saveJson refusé :', r && r.error);
      } catch (e) { console.warn('[Karaya] pont Android en erreur', e); }
    }

    return (dirHandle ? fsaWrite(json) : Promise.resolve(false)).then(function (ok1) {
      if (ok1) { busy = false; lastSave = { engine: 'fsa', date: today(), at: nowISO() }; return lastSave; }
      return opfsWrite(json).then(function (ok2) {
        busy = false;
        var eng = ok2 ? 'opfs' : 'download';
        lastSave = { engine: eng, date: today(), at: nowISO() };
        if (ok2) console.info('[Karaya] sauvegarde OPFS backups/' + today() + '.json');
        return lastSave;
      });
    }).catch(function () { busy = false; return lastSave; });
  }

  function schedule(ms) {
    clearTimeout(timer);
    timer = setTimeout(function () { saveNow(); }, ms == null ? CFG.debounce : ms);
  }

  /* --- choix du dossier (une seule fois, sur action de l'utilisateur) */
  function pickFolder() {
    if (!window.showDirectoryPicker) return Promise.resolve({ ok: false, error: 'non supporté' });
    return window.showDirectoryPicker({ mode: 'readwrite', id: 'karaya-backups' }).then(function (dir) {
      dirHandle = dir;
      try { localStorage.setItem('karaya_bk_dir', dir.name || 'dossier'); } catch (e) { }
      return saveNow({ verbose: true }).then(function () { return { ok: true, dir: dir.name }; });
    }).catch(function (e) { return { ok: false, error: String(e && e.message || e) }; });
  }

  function list() {
    var b = bridge();
    if (b && typeof b.list === 'function') {
      try { var r = JSON.parse(b.list()); return Promise.resolve((r && r.files) || []); } catch (e) { }
    }
    if (navigator.storage && navigator.storage.getDirectory) {
      return navigator.storage.getDirectory().then(function (d) { return d.getDirectoryHandle('backups'); })
        .then(function (dir) {
          var out = [];
          var it = dir.values ? dir.values() : null;
          if (!it) return out;
          function step() { return it.next().then(function (r) { if (r.done) return out; if (r.value.kind === 'file') out.push({ date: r.value.name.replace('.json', '') }); return step(); }); }
          return step();
        }).catch(function () { return ringList(); });
    }
    return Promise.resolve(ringList());
  }
  function ringList() {
    var out = [];
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf('karaya_bk_') === 0) out.push({ date: k.replace('karaya_bk_', ''), bytes: (localStorage.getItem(k) || '').length });
      }
    } catch (e) { }
    return out.sort(function (a, b) { return a.date < b.date ? 1 : -1; });
  }

  function exportDay(date) {
    date = date || today();
    var b = bridge();
    if (b && typeof b.export === 'function') {
      try { var r = JSON.parse(b.export(date)); return Promise.resolve(r); } catch (e) { }
    }
    var json = null;
    try { json = localStorage.getItem('karaya_bk_' + date); } catch (e) { }
    if (!json) json = payload();
    if (!json) return Promise.resolve({ ok: false, error: 'aucune donnée' });
    return Promise.resolve({ ok: download(json, 'karaya-' + date) });
  }

  /* ==================================================================
     C. BRANCHEMENTS
     ================================================================== */
  function wire() {
    /* 1) après chaque save() d'index.html */
    window.addEventListener('karaya:saved', function () { schedule(); });
    /* 2) périodique */
    setInterval(function () { saveNow(); }, CFG.periodic);
    /* 3) passage en arrière-plan (le moment où la tablette est posée) */
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) saveNow();
    });
    window.addEventListener('pagehide', function () { saveNow(); });
    window.addEventListener('beforeunload', function () { saveNow(); });
    /* 4) au démarrage */
    setTimeout(function () { saveNow(); }, 3000);
  }

  window.KarayaBackup = {
    saveNow: saveNow,
    engine: engine,
    list: list,
    export: exportDay,
    pickFolder: pickFolder,
    get last() { return lastSave; },
    today: today,
    _cfg: CFG
  };

  kioskMode();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
  else wire();
})();
