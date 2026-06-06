const CACHE_NAME = 'mikus-drive-v1';

const SHELL_ASSETS = [
  './',
  './index.html',
  './notepad.html',
  './404.html',
  './privacy.html',
  './terms.html',
  './css/style.css',
  './js/base-path.js',
  './js/config.js',
  './js/auth.js',
  './js/drive.js',
  './js/router.js',
  './js/notepad.js',
  './js/contextmenu.js',
  './js/app.js',
  './js/register-sw.js',
  './assets/default-avatar.svg',
  './assets/logo.svg',
  './assets/favicon.svg',
  './assets/logo-512.png',
  './assets/logo-192.png',
  './assets/logo-180.png',
  './assets/logo-128.png',
  './assets/logo-72.png',
  './assets/logo-48.png',
  './assets/favicon-32.png',
  './assets/favicon-16.png',
  './manifest.webmanifest',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

function isApiRequest(url) {
  return (
    url.hostname.endsWith('googleapis.com') ||
    url.hostname.endsWith('google.com') ||
    url.hostname.endsWith('gstatic.com')
  );
}

function shellPath(pathname) {
  if (pathname.endsWith('notepad.html') || pathname.includes('notepad')) {
    return './notepad.html';
  }
  return './index.html';
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (isApiRequest(url)) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(shellPath(url.pathname), copy));
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(shellPath(url.pathname));
          return cached || caches.match('./index.html');
        })
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (!response.ok) return response;
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        return response;
      });
    })
  );
});
