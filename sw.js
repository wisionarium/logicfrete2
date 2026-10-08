const CACHE_NAME = 'logic-frete-cache-v29-droute';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/style.css',
  '/app.js',
  '/data.js',
  '/maps.js',
  '/tracking.js',
  '/supra-bike.png',
  '/icone-180.png',
  '/icone-192.png',
  '/icone-512.png',
  '/apple-touch-icon.png'
];

// Instalação: cache dos arquivos estáticos vitais (à prova de Safari —
// um arquivo falhando não aborta toda a instalação como no cache.addAll puro)
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      console.log('Service Worker: Fazendo cache dos arquivos');
      await Promise.all(
        STATIC_ASSETS.map(async (url) => {
          try {
            const res = await fetch(url, { credentials: 'same-origin' });
            if (res && res.ok) {
              await cache.put(url, res.clone());
            } else {
              console.warn('Service Worker: pular cache (status):', url);
            }
          } catch (err) {
            console.warn('Service Worker: pular cache (rede):', url, err);
          }
        })
      );
    })
  );
  self.skipWaiting();
});

// Ativação: Limpeza de caches antigos
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) {
            console.log('Service Worker: Limpando cache antigo', cache);
            return caches.delete(cache);
          }
          return Promise.resolve(false);
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Interceptador de requisições — seguro para Safari iOS:
// - só GET, só http(s), ignora api e cross-origin
// - navigations: network-first com fallback para /index.html (offline)
// - estáticos same-origin: cache-first com atualização em background
self.addEventListener('fetch', (event) => {
  const req = event.request;

  if (req.method !== 'GET') return;

  let url;
  try {
    url = new URL(req.url);
  } catch (e) {
    return;
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
  if (url.hostname.includes('supabase.co')) return;
  if (url.pathname.startsWith('/api/') || url.pathname.includes('/api')) return;
  if (url.origin !== self.location.origin) return;

  const accept = req.headers.get('accept') || '';
  const isNavigation =
    req.mode === 'navigate' || accept.includes('text/html');

  if (isNavigation) {
    event.respondWith(
      fetch(req)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.ok) {
            const copy = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put('/index.html', copy));
          }
          return networkResponse;
        })
        .catch(() =>
          caches.match('/index.html').then((res) => res || caches.match(req))
        )
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((networkResponse) => {
          if (
            networkResponse &&
            networkResponse.ok &&
            (networkResponse.type === 'basic' || networkResponse.type === 'default')
          ) {
            const copy = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          }
          return networkResponse;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
