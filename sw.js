importScripts('./js/app-version.js');

const CACHE_NAME = `mikus-drive-${APP_VERSION}`;

const SHELL_ASSETS = [
  './',
  './index.html',
  './notepad.html',
  './github-oauth-callback.html',
  './404.html',
  './privacy.html',
  './terms.html',
  './css/style.css',
  './js/app-version.js',
  './js/base-path.js',
  './js/config.js',
  './js/site-config.js',
  './js/auth.js',
  './js/drive.js',
  './js/localdisk.js',
  './js/githubdisk.js',
  './js/localuser.js',
  './js/dialog.js',
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

const NETWORK_FIRST_PATHS = /\.(html?|css|js|webmanifest)$|\/$/;

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

function isNetworkFirst(url) {
  const path = url.pathname;
  return NETWORK_FIRST_PATHS.test(path) || path.endsWith('/sw.js');
}

async function clearOldCaches() {
  const keys = await caches.keys();
  await Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)));
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const copy = response.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    throw new Error('Offline and no cache');
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const copy = response.clone();
    caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
  }
  return response;
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(clearOldCaches().then(() => self.clients.claim()));
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data?.type === 'CLEAR_CACHES') {
    event.waitUntil(
      caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
    );
  }
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (isApiRequest(url)) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(async (response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(shellPath(url.pathname), copy));
            return response;
          }
          const cached = await caches.match(shellPath(url.pathname));
          return cached || caches.match('./index.html');
        })
        .catch(async () => {
          const cached = await caches.match(shellPath(url.pathname));
          return cached || caches.match('./index.html');
        })
    );
    return;
  }

  if (isNetworkFirst(url)) {
    event.respondWith(networkFirst(request));
    return;
  }

  event.respondWith(cacheFirst(request));
});
