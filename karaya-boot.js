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
      'مطلوب البريد و كلمة المرور لأول اتصال': 'E-mail + mot de passe requis pour la première connexion'
    });
  }

  /* ---------- styles ---------- */
  function addCss() {
    if ($('kb-css')) return;
    var st = document.createElement('style');
    st.id = 'kb-css';
    st.textContent =
      '.kb-bg{position:fixed;inset:0;background:rgba(31,23,32,.55);display:flex;align-items:center;justify-content:center;z-index:99999;padding:14px}' +
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
        if (s.markSynced) s.markSynced(r.rev);
        lastSyncAt = new Date().toLocaleTimeString();
        if (!silent) setStatus(t('تم التحديث من السحابة') + ' — ' + lastSyncAt, 'ok');
      } else if (r.ok && r.action === 'push') {
        if (s.markSynced) s.markSynced(r.rev || s.state.rev);
        lastSyncAt = new Date().toLocaleTimeString();
        if (!silent) setStatus(t('تم الإرسال إلى السحابة') + ' — ' + lastSyncAt, 'ok');
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
      '      <input id="kb-anon" type="password" dir="ltr" autocomplete="off" spellcheck="false" placeholder="eyJhbGciOi..."></div>' +
      '    <div class="kb-f"><label for="kb-email">' + t('البريد الإلكتروني') + '</label>' +
      '      <input id="kb-email" type="email" dir="ltr" autocomplete="username" spellcheck="false"></div>' +
      '    <div class="kb-f"><label for="kb-pass">' + t('كلمة المرور') + '</label>' +
      '      <input id="kb-pass" type="password" dir="ltr" autocomplete="current-password"></div>' +
      '    <label class="kb-chk"><input id="kb-signup" type="checkbox"> ' + t('إنشاء حساب جديد') + '</label>' +
      '    <div class="kb-row">' +
      '      <button class="kb-btn ok" id="kb-connect" type="button">اتصال</button>' +
      '      <button class="kb-btn" id="kb-save" type="button">' + t('حفظ الإعدادات') + '</button>' +
      '      <button class="kb-btn" id="kb-test" type="button">' + t('اختبار الاتصال') + '</button>' +
      '      <button class="kb-btn pri" id="kb-sync" type="button">' + t('مزامنة الآن') + '</button>' +
      '      <button class="kb-btn dan" id="kb-disconnect" type="button">فصل</button>' +
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
      if (!s.state || !s.state.online) return;
      if (document.hidden) return;
      doSync(true);
    }, 90000);
  }

  function boot() {
    try { mount(); } catch (e) { }
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
    startAuto();
  }

  /* enregistrement des données distantes (realtime) */
  function wire() {
    var s = store();
    if (!s || !s.onRemote) return;
    try {
      s.onRemote(function (payload) {
        if (!payload) return;
        if (setDB(payload)) {
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
