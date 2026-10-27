/* =====================================================================
   karaya-boot.js — Câblage : langue, licence unifiée, cloud + migration
   Chargé APRÈS le script principal : accès direct à DB / save() / toast()
   ===================================================================== */
(function () {
  'use strict';
  var T = function (ar, fr) { return (window.I18N && I18N.lang === 'fr') ? fr : ar; };
  function $(id) { return document.getElementById(id); }

  /* ---------------- 1. Bouton de langue dans la barre ---------------- */
  function langButton() {
    var bar = document.querySelector('.topactions');
    if (!bar || $('btnLang')) return;
    var b = document.createElement('button');
    b.id = 'btnLang'; b.className = 'icobtn'; b.type = 'button';
    b.style.cssText = 'background:#eff6ff;color:#1d4ed8;border-color:#bfdbfe;font-weight:800';
    b.textContent = (window.I18N && I18N.lang === 'fr') ? 'FR' : 'ع';
    b.title = T('تغيير اللغة — Français', 'Changer la langue — العربية');
    b.onclick = function () {
      var next = (I18N.lang === 'fr') ? 'ar' : 'fr';
      I18N.set(next);
      b.textContent = next === 'fr' ? 'FR' : 'ع';
      b.title = T('تغيير اللغة — Français', 'Changer la langue — العربية');
      if ($('kcloudOverlay') && !$('kcloudOverlay').classList.contains('hidden')) renderCloud();
    };
    bar.insertBefore(b, bar.firstChild);
  }

  /* ---------------- 2. Bouton Cloud ---------------- */
  function cloudButton() {
    var bar = document.querySelector('.topactions');
    if (!bar || $('btnCloud')) return;
    var b = document.createElement('button');
    b.id = 'btnCloud'; b.className = 'icobtn'; b.type = 'button';
    b.style.cssText = 'background:#eef2ff;color:#3730a3;border-color:#c7d2fe';
    b.textContent = '☁️';
    b.title = T('النسخ السحابي — المزامنة', 'Cloud & synchronisation');
    b.onclick = openCloud;
    bar.insertBefore(b, bar.firstChild);
  }

  /* ---------------- 3. Feuille de style de la fenêtre cloud ---------- */
  function style() {
    if ($('kcloudStyle')) return;
    var s = document.createElement('style');
    s.id = 'kcloudStyle';
    s.textContent = [
      '.kc-overlay{position:fixed;inset:0;background:rgba(31,23,32,.55);z-index:9999;display:flex;align-items:flex-start;justify-content:center;overflow:auto;padding:18px}',
      '.kc-overlay.hidden{display:none}',
      '.kc-card{background:#fff;border-radius:16px;max-width:720px;width:100%;padding:18px;box-shadow:0 20px 60px rgba(0,0,0,.25);font-family:Cairo,Noto Naskh Arabic,system-ui,sans-serif}',
      '.kc-card h3{margin:0 0 4px;color:#9d174d;font-size:19px}',
      '.kc-sub{color:#7c6f77;font-size:12.5px;margin-bottom:12px;line-height:1.5}',
      '.kc-row{display:flex;gap:8px;flex-wrap:wrap;margin:8px 0}',
      '.kc-row>*{flex:1;min-width:150px}',
      '.kc-card input,.kc-card select{padding:9px 10px;border:1px solid #ecdfe6;border-radius:10px;font:inherit;font-size:13px;background:#fff;width:100%;box-sizing:border-box}',
      '.kc-card label{font-size:12px;font-weight:700;color:#7c6f77;display:block;margin-bottom:3px}',
      '.kc-btn{padding:10px 14px;border-radius:10px;border:1px solid #ecdfe6;background:#fff;font:inherit;font-weight:700;font-size:13px;cursor:pointer}',
      '.kc-btn.p{background:#9d174d;color:#fff;border-color:transparent}',
      '.kc-btn.g{background:#ecfdf5;color:#047857;border-color:#a7f3d0}',
      '.kc-btn.d{background:#fef2f2;color:#b91c1c;border-color:#fecaca}',
      '.kc-btn:disabled{opacity:.5;cursor:not-allowed}',
      '.kc-badge{display:inline-block;padding:3px 9px;border-radius:999px;font-size:11.5px;font-weight:800}',
      '.kc-b-ok{background:#ecfdf5;color:#047857}.kc-b-off{background:#fef2f2;color:#b91c1c}.kc-b-wait{background:#fffbeb;color:#b45309}',
      '.kc-step{background:#fdf2f8;border:1px solid #f9a8d4;border-radius:12px;padding:10px 12px;margin:10px 0;font-size:12.5px;line-height:1.6}',
      '.kc-step b{color:#9d174d}',
      '.kc-out{background:#0f172a;color:#a7f3d0;font-family:ui-monospace,monospace;font-size:11.5px;padding:10px;border-radius:10px;max-height:160px;overflow:auto;white-space:pre-wrap;word-break:break-all}',
      '.kc-close{float:right;border:0;background:#f7f4f6;color:#7c6f77;border-radius:8px;width:30px;height:30px;font-size:16px;cursor:pointer}',
      '.kc-tab{display:flex;gap:6px;margin:6px 0 12px;flex-wrap:wrap}',
      '.kc-tab button{flex:0 0 auto;padding:7px 13px;border-radius:999px;border:1px solid #ecdfe6;background:#fff;font:inherit;font-size:12.5px;font-weight:700;cursor:pointer;color:#7c6f77}',
      '.kc-tab button.on{background:#9d174d;color:#fff;border-color:transparent}',
      'html[dir=ltr] .kc-card{direction:ltr;text-align:left}',
      'html[dir=ltr] body{font-family:Cairo,system-ui,sans-serif}',
      'html[dir=ltr] .topbar,html[dir=ltr] .screenhead,html[dir=ltr] .tile,html[dir=ltr] table{direction:ltr}',
      'html[dir=ltr] .back{transform:scaleX(-1)}'
    ].join('\n');
    document.head.appendChild(s);
  }

  /* ---------------- 4. Fenêtre Cloud / Licence / Migration ----------- */
  var tab = 'cloud';

  function overlay() {
    if ($('kcloudOverlay')) return $('kcloudOverlay');
    var d = document.createElement('div');
    d.id = 'kcloudOverlay'; d.className = 'kc-overlay hidden';
    d.innerHTML = '<div class="kc-card" id="kcCard"></div>';
    d.addEventListener('click', function (e) { if (e.target === d) closeCloud(); });
    document.body.appendChild(d);
    return d;
  }
  function openCloud() { style(); overlay().classList.remove('hidden'); renderCloud(); }
  function closeCloud() { if ($('kcloudOverlay')) $('kcloudOverlay').classList.add('hidden'); }
  window.openCloud = openCloud;

  function tabs() {
    return '<div class="kc-tab">' +
      '<button class="' + (tab === 'cloud' ? 'on' : '') + '" onclick="KBOOT.tab(\'cloud\')">☁️ ' + T('النسخ السحابي', 'Cloud') + '</button>' +
      '<button class="' + (tab === 'lic' ? 'on' : '') + '" onclick="KBOOT.tab(\'lic\')">🔑 ' + T('الترخيص', 'Licence') + '</button>' +
      '<button class="' + (tab === 'mig' ? 'on' : '') + '" onclick="KBOOT.tab(\'mig\')">🚀 ' + T('الترحيل', 'Migration') + '</button>' +
      '</div>';
  }

  function licBlock() {
    var st = (window.KLicense ? KLicense.state() : {});
    var line = st.key
      ? '<span class="kc-badge kc-b-ok">' + T('مفعّل', 'Activée') + '</span> ' + (st.kind === 'k2' ? 'K2' : T('صيغة قديمة', 'ancien format'))
      : '<span class="kc-badge kc-b-off">' + T('غير مفعّل', 'Non activée') + '</span>';
    return '<div class="kc-step"><b>' + T('حالة الترخيص', 'État de la licence') + ' :</b> ' + line +
      '<br>' + T('رقم الجهاز', 'Identifiant appareil') + ' : <code>' + (window.KLicense ? KLicense.deviceId() : '-') + '</code>' +
      (st.serial ? '<br>' + T('الرقم التسلسلي', 'Numéro de série') + ' : <code>' + st.serial + '</code>' : '') +
      '<br><span style="color:#7c6f77">' + T('دفعة واحدة — نفس المفتاح يشتغل على Windows و الهاتف و السحابة.', 'Un seul paiement — la même clé couvre Windows, mobile et cloud.') + '</span></div>';
  }

  function renderCloud() {
    var c = $('kcCard'); if (!c) return;
    var S = window.KStore ? KStore.state : { mode: 'local', online: false };
    var cfg = window.KStore ? KStore.cfg() : {};
    var badge = S.mode === 'local'
      ? '<span class="kc-badge kc-b-wait">' + T('محلي فقط', 'Local uniquement') + '</span>'
      : (S.online ? '<span class="kc-badge kc-b-ok">' + T('متصل و متزامن', 'Connecté & synchronisé') + '</span>'
                  : '<span class="kc-badge kc-b-off">' + T('غير متصل', 'Hors ligne') + '</span>');

    var head = '<button class="kc-close" onclick="KBOOT.close()">✕</button>' +
      '<h3>☁️ ' + T('النسخ السحابي و المزامنة', 'Cloud & synchronisation') + '</h3>' +
      '<div class="kc-sub">' + T(
        'حسابك أنت : GitHub + Supabase. لا يمر أي شيء عبرنا. مجاني في الاستعمال العادي.',
        'Votre propre compte : GitHub + Supabase. Rien ne passe par nous. Gratuit en usage normal.') +
      '<br>' + badge + ' &nbsp; <small style="color:#7c6f77">' + (S.lastSync ? T('آخر مزامنة', 'Dernière synchro') + ' : ' + S.lastSync : '') + '</small></div>';

    var body = tabs();

    if (tab === 'cloud') {
      body += licBlock();
      body += '<div class="kc-row"><div><label>Supabase URL</label><input id="kcUrl" placeholder="https://xxxxx.supabase.co" value="' + (cfg.url || '') + '"></div></div>' +
        '<div class="kc-row"><div><label>anon public key</label><input id="kcAnon" placeholder="eyJhbGciOi..." value="' + (cfg.anon || '') + '"></div></div>' +
        '<div class="kc-row"><div><label>' + T('البريد', 'E-mail') + '</label><input id="kcEmail" type="email" value="' + (cfg.email || '') + '"></div>' +
        '<div><label>' + T('كلمة السر', 'Mot de passe') + '</label><input id="kcPass" type="password" placeholder="••••••"></div></div>' +
        '<div class="kc-row">' +
        '<button class="kc-btn" onclick="KBOOT.test()">🔍 ' + T('اختبار', 'Tester') + '</button>' +
        '<button class="kc-btn p" onclick="KBOOT.login(false)">🔓 ' + T('اتصال', 'Se connecter') + '</button>' +
        '<button class="kc-btn" onclick="KBOOT.login(true)">＋ ' + T('حساب جديد', 'Créer un compte') + '</button>' +
        '</div>' +
        '<div class="kc-row">' +
        '<button class="kc-btn g" onclick="KBOOT.sync()">🔄 ' + T('مزامنة الآن', 'Synchroniser') + '</button>' +
        '<button class="kc-btn d" onclick="KBOOT.logout()">🚪 ' + T('فصل', 'Déconnecter') + '</button>' +
        '</div>' +
        '<div class="kc-step">' + T(
          '① أنشئ مشروعا مجانيا في supabase.com ② SQL Editor — نفّذ ملف schema.sql ③ الصق هنا الرابط و المفتاح anon ④ أنشئ حسابا ⑤ اضغط « ترحيل ».',
          '① Créez un projet gratuit sur supabase.com ② SQL Editor — exécutez schema.sql ③ Collez ici l\'URL et la clé anon ④ Créez un compte ⑤ Cliquez « Migrer ».') + '</div>' +
        '<div id="kcOut" class="kc-out" style="display:none"></div>';
    }

    if (tab === 'lic') {
      body += '<div class="kc-step">' + T(
        'أدخل مفتاحك. الصيغة القديمة (كلمات) ما زالت مقبولة كما هي — لا حاجة لإعادة التفعيل.',
        'Saisissez votre clé. L\'ancien format (mots) reste accepté tel quel — aucune réactivation nécessaire.') + '</div>' +
        '<div class="kc-row"><div><label>' + T('الرقم التسلسلي (لصيغة قديمة)', 'Numéro de série (ancien format)') + '</label><input id="kcSerial" value="' + ((KLicense.state().serial) || '') + '"></div></div>' +
        '<div class="kc-row"><div><label>' + T('المفتاح', 'Clé') + '</label><input id="kcKey" value="' + ((KLicense.state().key) || '') + '" placeholder="K2-… ' + T('أو الكلمات', 'ou mots') + '"></div></div>' +
        '<div class="kc-row"><button class="kc-btn p" onclick="KBOOT.activate()">✅ ' + T('تفعيل', 'Activer') + '</button>' +
        '<button class="kc-btn" onclick="KBOOT.copyDev()">📋 ' + T('نسخ رقم الجهاز', 'Copier l\'identifiant') + '</button></div>' +
        licBlock() +
        '<div id="kcOut" class="kc-out" style="display:none"></div>';
    }

    if (tab === 'mig') {
      var counts = (typeof DB === 'object' && DB) ? ['articles', 'clients', 'locs', 'lines', 'depense', 'caisse_ctrl', 'users']
        .map(function (k) { return k + ' : ' + ((DB[k] || []).length); }).join(' · ') : '';
      body += '<div class="kc-step"><b>' + T('ما يوجد محليا', 'Contenu local') + ' :</b><br>' + (counts || '—') +
        '<br><b>' + T('الحجم', 'Taille') + ' :</b> ' + Math.round(JSON.stringify((typeof DB === 'object' && DB) ? DB : {}).length / 1024) + ' Ko</div>' +
        '<div class="kc-sub">' + T(
          'الترحيل ينسخ بياناتك إلى سحابتك ثم يفعّل المزامنة. لا يُحذف أي شيء محليا.',
          'La migration copie vos données vers votre cloud puis active la synchronisation. Rien n\'est supprimé en local.') + '</div>' +
        '<div class="kc-row"><button class="kc-btn g" onclick="KBOOT.migrate()">🚀 ' + T('ترحيل بياناتي إلى السحابة', 'Migrer mes données vers le cloud') + '</button></div>' +
        '<div class="kc-row"><button class="kc-btn" onclick="KBOOT.exportJson()">⬇️ ' + T('تصدير نسخة JSON', 'Exporter un JSON') + '</button>' +
        '<button class="kc-btn" onclick="KBOOT.pushAssets()">🖼️ ' + T('رفع الصور', 'Envoyer les images') + '</button></div>' +
        '<div id="kcOut" class="kc-out" style="display:none"></div>';
    }

    c.innerHTML = head + body;
  }
  function out(msg, keep) {
    var o = $('kcOut'); if (!o) return;
    o.style.display = 'block';
    o.textContent = keep ? (o.textContent + '\n' + msg) : msg;
    o.scrollTop = o.scrollHeight;
  }

  var KBOOT = {
    close: closeCloud,
    tab: function (t) { tab = t; renderCloud(); },

    test: function () {
      if (!window.KStore) return out('KStore absent');
      KStore.saveCfg({ url: KStore.normalizeUrl($('kcUrl').value), anon: $('kcAnon').value.trim() });
      out(T('جار الاختبار…', 'Test en cours…'));
      KStore.health().then(function (r) {
        if (r.ok) out('✅ ' + T('الاتصال ناجح. الوثيقة موجودة', 'Connexion OK. Document') + ' : ' + (r.exists ? 'rev ' + r.rev : T('جديدة', 'nouveau')));
        else if (r.schema) out('⚠️ ' + T('الاتصال ناجح لكن الجدول غير موجود — نفّذ schema.sql', 'Connexion OK mais table absente — exécutez schema.sql'));
        else out('❌ ' + (r.error || '?'));
      });
    },

    login: function (signUp) {
      var o = { url: $('kcUrl').value, anon: $('kcAnon').value.trim(), email: $('kcEmail').value.trim(), password: $('kcPass').value, signUp: !!signUp };
      if (!o.url || !o.anon) return out(T('أدخل URL و anon key', 'Renseignez l\'URL et la clé anon'));
      if (!o.email || !o.password) return out(T('أدخل البريد و كلمة السر', 'Renseignez e-mail et mot de passe'));
      out(T('جار الاتصال…', 'Connexion…'));
      KStore.connect(o).then(function (r) {
        out('✅ ' + T('متصل', 'Connecté') + ' : ' + r.email);
        renderCloud();
      }).catch(function (e) { out('❌ ' + (e.message || e)); });
    },

    sync: function () {
      out(T('جار المزامنة…', 'Synchronisation…'));
      if (window.KStore) KStore.push((typeof DB === 'object') ? DB : {});
      var p = (window.KStore && KStore.flush) ? KStore.flush() : Promise.resolve(false);
      Promise.resolve(p).then(function () { return KStore.pull(); }).then(function (r) {
        out(r ? ('✅ rev ' + r.rev + ' · ' + (r.at || '')) : '⚠️ ' + T('لا شيء في السحابة بعد', 'Rien encore dans le cloud'));
      }).catch(function (e) { out('❌ ' + (e.message || e)); });
    },

    logout: function () { if (window.KStore) KStore.disconnect(); renderCloud(); },

    activate: function () {
      var serial = $('kcSerial') ? $('kcSerial').value.trim() : '';
      var key = $('kcKey') ? $('kcKey').value.trim() : '';
      out(T('جار التحقق…', 'Vérification…'));
      KLicense.check({ key: key, serial: serial }).then(function (r) {
        if (r.ok) {
          out('✅ ' + T('تم التفعيل', 'Activée') + ' — ' + (r.kind === 'k2' ? 'K2' : T('صيغة قديمة', 'ancien format')) +
            ' · ' + T('الإصدارات', 'éditions') + ' : ' + r.editions);
          renderCloud();
        } else {
          var why = { empty: T('أدخل مفتاحا', 'Saisissez une clé'), invalid: T('مفتاح غير صحيح', 'Clé invalide'),
            signature: T('توقيع غير صالح', 'Signature invalide'), expired: T('منتهي الصلاحية', 'Expirée'),
            serial: T('الرقم التسلسلي لا يطابق', 'Numéro de série différent'), format: T('صيغة غير معروفة', 'Format inconnu') }[r.reason] || r.reason;
          out('❌ ' + why);
        }
      });
    },

    copyDev: function () {
      var v = KLicense.deviceId();
      (navigator.clipboard ? navigator.clipboard.writeText(v) : Promise.reject()).then(function () { out('📋 ' + v); })
        .catch(function () { out('📋 ' + v); });
    },

    migrate: function () {
      if (!window.KStore || KStore.state.mode === 'local') return out('⚠️ ' + T('اتصل أولا', 'Connectez-vous d\'abord'));
      var db = (typeof DB === 'object') ? DB : null;
      if (!db) return out('❌ ' + T('لا توجد بيانات', 'Aucune donnée'));
      out(T('① رفع البيانات…', '① Envoi des données…'));
      KStore.push(db);
      KStore.flush().then(function (ok) {
        if (!ok) { out('❌ ' + T('فشل الرفع', 'Échec de l\'envoi')); return; }
        out(T('② التحقق من السحابة…', '② Vérification…'));
        return KStore.pull().then(function (r) {
          if (!r) { out('⚠️ ' + T('لم يتم العثور على الوثيقة', 'Document introuvable')); return; }
          var n = (r.db && r.db.articles) ? r.db.articles.length : 0;
          out('✅ ' + T('تم الترحيل. عدد المنتوجات في السحابة', 'Migration OK. Articles dans le cloud') + ' : ' + n);
          out('✅ ' + T('المزامنة في الوقت الحقيقي مفعّلة الآن بين هذا الجهاز و باقي أجهزتك.', 'Synchronisation temps réel active entre cet appareil et vos autres appareils.'));
          if (typeof toast === 'function') toast(T('✅ تم الترحيل إلى السحابة', '✅ Migration cloud réussie'), 'ok');
        });
      }).catch(function (e) { out('❌ ' + (e.message || e)); });
    },

    exportJson: function () {
      try {
        var txt = JSON.stringify((typeof DB === 'object') ? DB : {}, null, 1);
        var a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([txt], { type: 'application/json' }));
        a.download = 'karaya_export_' + new Date().toISOString().slice(0, 10) + '.json';
        a.click();
        out('✅ ' + T('تم التصدير', 'Export généré'));
      } catch (e) { out('❌ ' + e); }
    },

    pushAssets: function () {
      if (!window.KStore || KStore.state.mode === 'local') return out('⚠️ ' + T('اتصل أولا', 'Connectez-vous d\'abord'));
      if (!DB || !Array.isArray(DB.articles)) return out('❌ ' + T('لا توجد منتوجات', 'Aucun article'));
      var items = DB.articles.filter(function (a) { return a && typeof a.img === 'string' && a.img.indexOf('data:image') === 0; });
      if (!items.length) return out('ℹ️ ' + T('لا توجد صور مدمجة', 'Aucune image intégrée'));
      out(T('جار رفع', 'Envoi de') + ' ' + items.length + ' ' + T('صورة…', 'image(s)…'));
      var i = 0, ok = 0;
      (function next() {
        if (i >= items.length) { out('✅ ' + ok + '/' + items.length + ' ' + T('صورة', 'images')); if (typeof save === 'function') save(); return; }
        var a = items[i++];
        fetch(a.img).then(function (r) { return r.blob(); }).then(function (b) {
          return KStore.uploadAsset('art_' + (a.id || a.num || i) + '.jpg', b);
        }).then(function (url) { a.img = url; ok++; })
          .catch(function () { }).then(next);
      })();
    }
  };
  window.KBOOT = KBOOT;

  /* ---------------- 5. Synchronisation entrante ---------------- */
  var applying = false;
  function applyRemote(db, meta) {
    if (!db || !db.articles) return;
    if (applying) return;
    applying = true;
    try {
      /* fusion non destructive : on remplace, le cloud est la référence */
      if (typeof DB === 'object') {
        Object.keys(db).forEach(function (k) { DB[k] = db[k]; });
        if (typeof normalizeDB === 'function') normalizeDB();
        try { localStorage.setItem('karaya_db_v2', JSON.stringify(DB)); } catch (e) { }
        if (typeof renderStoreBadge === 'function') { try { renderStoreBadge(); } catch (e) { } }
        var cur = document.querySelector('.screen.active');
        if (cur) { var n = cur.id.replace('s-', ''); if (n) { try { go(n); } catch (e) { } } }
        if (typeof toast === 'function') toast(T('☁️ تم التحديث من السحابة', '☁️ Mis à jour depuis le cloud'), 'ok');
      }
    } finally { applying = false; }
  }

  /* ---------------- 6. Démarrage ---------------- */
  function boot() {
    style();
    if (window.I18N) I18N.apply(document.body);
    langButton();
    cloudButton();

    if (window.KStore) {
      KStore.onRemote(applyRemote);
      KStore.onStatus(function (S) {
        var b = $('btnCloud');
        if (b) b.style.opacity = (S.mode === 'local') ? '0.65' : '1';
      });
      /* relais de chaque save() vers le cloud (si connecté) */
      if (typeof window.save === 'function' && !window.__kSavePatched) {
        window.__kSavePatched = true;
        var base = window.save;
        window.save = function () {
          var r = base.apply(this, arguments);
          try { if (KStore.state.mode !== 'local') KStore.push(DB); } catch (e) { }
          return r;
        };
      }
      setTimeout(function () {
        KStore.initDB().then(function () {
          if (KStore.state.mode !== 'local') {
            KStore.pull().then(function (r) { if (r && r.db) applyRemote(r.db, r); });
          }
        });
      }, 1200);
    }

    /* rappel de licence si l'application tourne hors Windows (mobile/cloud) */
    setTimeout(function () {
      if (window.KLicense && !KLicense.state().key) {
        var py = (window.pywebview && window.pywebview.api);
        if (!py) { tab = 'lic'; openCloud(); }
      }
    }, 2600);
  }

  /* re-rendu de la langue : les fenêtres ouvertes suivent */
  window.addEventListener('karaya:lang', function () {
    var b = $('btnLang');
    if (b) b.textContent = (I18N.lang === 'fr') ? 'FR' : 'ع';
    if ($('kcloudOverlay') && !$('kcloudOverlay').classList.contains('hidden')) renderCloud();
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
