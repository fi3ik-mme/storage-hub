const MikusCache = (() => {
  const VERSION_KEY = 'mikus_drive_app_version';

  // App shell cache only — never clear Google sessions, local storage volumes, or profiles.
  const PRESERVED_LOCAL_STORAGE_KEYS = [
    'mikus_drive_users',
    'my_google_users',
    'mikus_drive_local_disks',
    'mikus_drive_local_user',
    VERSION_KEY,
  ];

  async function clearAllCaches() {
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
    }
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({ type: 'CLEAR_CACHES' });
    }
  }

  async function unregisterServiceWorkers() {
    if (!('serviceWorker' in navigator)) return;
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((reg) => reg.unregister()));
  }

  async function invalidateAppCaches() {
    await clearAllCaches();
    if (typeof APP_VERSION !== 'undefined') {
      localStorage.setItem(VERSION_KEY, APP_VERSION);
    }
  }

  function reloadIfNeeded() {
    if (sessionStorage.getItem('mikus_sw_reload') === '1') {
      sessionStorage.removeItem('mikus_sw_reload');
      return;
    }
    sessionStorage.setItem('mikus_sw_reload', '1');
    location.reload();
  }

  async function handleVersionChange() {
    if (typeof APP_VERSION === 'undefined') return false;
    const stored = localStorage.getItem(VERSION_KEY);
    if (!stored) {
      localStorage.setItem(VERSION_KEY, APP_VERSION);
      return false;
    }
    if (stored === APP_VERSION) return false;

    await invalidateAppCaches();
    reloadIfNeeded();
    return true;
  }

  async function register() {
    if (!('serviceWorker' in navigator)) return;

    if (await handleVersionChange()) return;

    const base = typeof BasePath !== 'undefined' ? BasePath.get() : '';
    const prefix = base ? `${base}/` : '/';

    try {
      const registration = await navigator.serviceWorker.register(`${prefix}sw.js`, { scope: prefix });

      if (typeof APP_VERSION !== 'undefined') {
        localStorage.setItem(VERSION_KEY, APP_VERSION);
      }

      registration.addEventListener('updatefound', () => {
        const worker = registration.installing;
        if (!worker) return;
        worker.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) {
            worker.postMessage({ type: 'SKIP_WAITING' });
          }
        });
      });

      navigator.serviceWorker.addEventListener('controllerchange', () => {
        clearAllCaches().then(reloadIfNeeded);
      });

      if (registration.waiting && navigator.serviceWorker.controller) {
        registration.waiting.postMessage({ type: 'SKIP_WAITING' });
      }

      registration.update();
    } catch {
      // Service worker optional (e.g. file:// or blocked context)
    }
  }

  return {
    clearAllCaches,
    unregisterServiceWorkers,
    invalidateAppCaches,
    preservedLocalStorageKeys: PRESERVED_LOCAL_STORAGE_KEYS,
    register,
  };
})();

window.MikusDrive = window.MikusDrive || {};
window.MikusDrive.clearCache = () => MikusCache.invalidateAppCaches().then(() => location.reload());

window.addEventListener('load', () => {
  MikusCache.register();
});
