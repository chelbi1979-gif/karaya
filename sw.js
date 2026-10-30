/* sw.js — cache hors-ligne de l'application (mode cloud / mobile) */
/* v21 : Smart Merge / Upsert — le cloud ne peut plus être écrasé
   (fusion enregistrement par enregistrement + garde-fou base vide).
   Avec l'ancien code, caches.addAll() échoue si UN SEUL fichier manque
   (par ex. apple-touch-icon.png ou favicon-32.png absents du dépôt) :
   l'installation du service worker était alors rejetée EN ENTIER et
   l'application n'était jamais disponible hors-ligne. On ajoute donc
   chaque fichier séparément, en ignorant les erreurs 404. */
const CACHE = 'karaya-v21';
const ASSETS = [
  './',
  './index.html',
  './karaya-i18n.js',
  './karaya-keys.js',
  './karaya-license.js',
  './karaya-store.js',
  './karaya-boot.js',
  './karaya-cloud.js',
  './manifest.json'
];
/* fichiers facultatifs : leur absence ne doit pas casser l'installation */
const OPTIONAL = [
  './icon-192.png', './icon-512.png', './icon-maskable-192.png',
  './icon-maskable-512.png', './favicon-32.png', './apple-touch-icon.png'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c =>
      Promise.all(
        ASSETS.map(u => c.add(u).catch(() => {}))
          .concat(OPTIONAL.map(u => c.add(u).catch(() => {})))
      )
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (u.origin !== location.origin) return;             /* Supabase / CDN : réseau direct */
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request).then(r => {
      const cp = r.clone();
      caches.open(CACHE).then(c => c.put(e.request, cp)).catch(() => {});
      return r;
    }).catch(() => caches.match(e.request).then(m => m || (u.pathname.endsWith('/') ? caches.match('./index.html') : null)))
  );
});
