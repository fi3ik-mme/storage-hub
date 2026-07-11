const BasePath = (() => {
  const APP_ROOT_KEY = 'storage_hub_app_root';
  const LEGACY_APP_ROOT_KEY = 'mikus_drive_app_root';

  function getConfigured() {
    if (typeof CONFIG !== 'undefined' && CONFIG.BASE_PATH != null && CONFIG.BASE_PATH !== '') {
      return String(CONFIG.BASE_PATH).replace(/\/$/, '');
    }
    if (typeof SITE !== 'undefined' && SITE.basePath) {
      return String(SITE.basePath).replace(/\/$/, '');
    }
    return '';
  }

  function readStoredRoot() {
    try {
      if (typeof StorageMigrate !== 'undefined') {
        StorageMigrate.migrateSessionStorageKey(APP_ROOT_KEY, [LEGACY_APP_ROOT_KEY]);
      } else if (!sessionStorage.getItem(APP_ROOT_KEY) && sessionStorage.getItem(LEGACY_APP_ROOT_KEY)) {
        sessionStorage.setItem(APP_ROOT_KEY, sessionStorage.getItem(LEGACY_APP_ROOT_KEY));
      }
      const stored = sessionStorage.getItem(APP_ROOT_KEY);
      return stored != null ? stored : null;
    } catch {
      return null;
    }
  }

  function persistRoot(root) {
    const normalized = root ? String(root).replace(/\/$/, '') : '';
    try {
      sessionStorage.setItem(APP_ROOT_KEY, normalized);
    } catch {
      // sessionStorage unavailable
    }
    return normalized;
  }

  function looksLikeDriveRouteSegment(segment) {
    return segment.includes('@') || (segment.includes('.') && !segment.includes(' '));
  }

  function matchesConfiguredBase(pathname, configured) {
    return !!configured && (pathname === configured || pathname.startsWith(`${configured}/`));
  }

  function readValidatedStoredRoot(pathname = location.pathname) {
    const stored = readStoredRoot();
    if (stored === null) return null;
    return isPlausibleAppRoot(stored, pathname) ? stored : null;
  }

  function isProductionDeployHost() {
    const configured = getConfigured();
    if (/\.github\.io$/i.test(location.hostname)) return true;
    return !!configured && matchesConfiguredBase(location.pathname, configured);
  }

  function isPlausibleAppRoot(root, pathname) {
    if (!root) return true;

    const configured = getConfigured();
    if (configured && root === configured) {
      if (matchesConfiguredBase(pathname, configured)) return true;
      if (/\.github\.io$/i.test(location.hostname)) return true;
      return false;
    }

    const bare = pathname.replace(/\/+$/, '') || '/';
    if (bare === '/' || bare === root) return true;

    if (pathname.endsWith('/index.html') || pathname.endsWith('/notepad.html')) {
      const fromPage = pathname
        .replace(/\/index\.html$/, '')
        .replace(/\/notepad\.html$/, '')
        .replace(/\/$/, '');
      if (fromPage === root) return true;
    }

    const parts = pathname.replace(/\/$/, '').split('/').filter(Boolean);
    if (parts.length >= 2 && `/${parts[0]}` === root && !looksLikeDriveRouteSegment(parts[1])) {
      return false;
    }

    return pathname === root || pathname.startsWith(`${root}/`);
  }

  function inferRootFromPathname(pathname) {
    const parts = pathname.replace(/\/$/, '').split('/').filter(Boolean);
    if (parts.length === 0) return '';

    if (looksLikeDriveRouteSegment(parts[0])) return '';

    // Only treat the first segment as a deploy folder when the second segment is a drive identity
    // (email / domain-like name). SPA routes like /Drive-1/My Drive are not deploy roots.
    if (parts.length >= 2 && looksLikeDriveRouteSegment(parts[1])) {
      return `/${parts[0]}`;
    }

    return '';
  }

  function detectEarlyRoot(pathname = location.pathname) {
    const configured = getConfigured();

    if (matchesConfiguredBase(pathname, configured)) {
      return configured;
    }

    if (pathname.endsWith('/index.html')) {
      return pathname.slice(0, -'/index.html'.length).replace(/\/$/, '');
    }
    if (pathname.endsWith('/notepad.html') || /\/notepad\.html\/+$/.test(pathname)) {
      return pathname.replace(/\/notepad\.html\/?$/, '').replace(/\/$/, '');
    }

    try {
      const stored = sessionStorage.getItem(APP_ROOT_KEY);
      if (stored !== null && isPlausibleAppRoot(stored, pathname)) {
        return stored;
      }
    } catch {
      // sessionStorage unavailable
    }

    return inferRootFromPathname(pathname);
  }

  function fromScriptPath() {
    const scripts = document.querySelectorAll('script[src*="base-path.js"]');
    const script = scripts[scripts.length - 1];
    if (!script?.src) return '';

    try {
      const path = new URL(script.src, location.origin).pathname;
      const match = path.match(/^(.*)\/js\/base-path\.js$/);
      return match ? match[1].replace(/\/$/, '') : '';
    } catch {
      return '';
    }
  }

  function fromStylesheet() {
    const link = document.querySelector('link[rel="stylesheet"][href*="style.css"]');
    if (!link) return '';

    const hrefAttr = link.getAttribute('href') || '';
    if (hrefAttr && !hrefAttr.startsWith('/') && !/^https?:/i.test(hrefAttr)) {
      return '';
    }

    try {
      const path = new URL(link.href, location.origin).pathname;
      const match = path.match(/^(.*)\/css\/style\.css$/);
      return match ? match[1].replace(/\/$/, '') : '';
    } catch {
      return '';
    }
  }

  function get() {
    const pathname = location.pathname;
    const configured = getConfigured();

    if (isProductionDeployHost() && matchesConfiguredBase(pathname, configured)) {
      return persistRoot(configured);
    }

    if (pathname.endsWith('/index.html')) {
      return persistRoot(pathname.slice(0, -'/index.html'.length).replace(/\/$/, ''));
    }
    if (pathname.endsWith('/notepad.html') || /\/notepad\.html\/+$/.test(pathname)) {
      return persistRoot(pathname.replace(/\/notepad\.html\/?$/, '').replace(/\/$/, ''));
    }

    const fromScript = fromScriptPath();
    if (fromScript && !isProductionDeployHost()) {
      return persistRoot(fromScript);
    }

    const stored = readValidatedStoredRoot(pathname);
    if (stored !== null) return persistRoot(stored);

    if (fromScript) return persistRoot(fromScript);

    const inferred = inferRootFromPathname(pathname);
    if (inferred) return persistRoot(inferred);

    const fromCss = fromStylesheet();
    if (fromCss) return persistRoot(fromCss);

    return persistRoot('');
  }

  function url(path = '') {
    const base = get();
    const clean = path.startsWith('/') ? path : `/${path}`;
    return base ? `${base}${clean}` : clean;
  }

  function prefixRelativeAsset(href) {
    if (!href || /^https?:/i.test(href)) return href;
    if (href.startsWith('/')) return href;
    const base = get();
    if (base) return `${base}/${href}`;
    return `/${href}`;
  }

  function getEntryPath(page = 'index.html') {
    const base = get();
    const file = page.startsWith('/') ? page.slice(1) : page;
    return base ? `${base}/${file}` : `/${file}`;
  }

  function ensureEntryPath() {
    if (typeof location === 'undefined') return;

    const pathname = location.pathname;
    if (pathname.endsWith('/index.html')) return;
    if (/\/notepad\.html\/+$/.test(pathname)) {
      location.replace(
        `${pathname.replace(/\/notepad\.html\/+$/, '/notepad.html')}${location.search}${location.hash}`
      );
      return;
    }
    if (pathname.endsWith('/notepad.html')) return;

    const base = get();
    const bare = pathname.replace(/\/+$/, '') || '/';
    const needsEntry = bare === '/' || (base && bare === base);
    if (!needsEntry) return;

    const entry = getEntryPath('index.html');
    const target = `${entry}${location.search}${location.hash}`;
    if (`${pathname}${location.search}${location.hash}` !== target) {
      location.replace(target);
    }
  }

  function redirectBareRootIfNeeded() {
    if (typeof location === 'undefined') return false;

    const pathname = location.pathname;
    if (pathname.endsWith('/index.html') || pathname.endsWith('/notepad.html')) return false;

    const root = detectEarlyRoot();
    const bare = pathname.replace(/\/+$/, '') || '/';
    if (bare !== '/' && !(root && bare === root)) return false;

    const entry = root ? `${root}/index.html` : '/index.html';
    const target = `${entry}${location.search}${location.hash}`;
    if (`${pathname}${location.search}${location.hash}` === target) return false;

    location.replace(target);
    return true;
  }

  function bootstrapHeadAssets() {
    const version = typeof APP_VERSION !== 'undefined' ? `?v=${APP_VERSION}` : '';
    ensureEntryPath();
    const base = get();
    const baseHref = base ? `${base}/` : '/';

    let baseEl = document.querySelector('base[data-storage-hub-root]');
    if (!baseEl) {
      baseEl = document.createElement('base');
      baseEl.setAttribute('data-storage-hub-root', '1');
      document.head.prepend(baseEl);
    }
    if (baseEl.getAttribute('href') !== baseHref) {
      baseEl.href = baseHref;
    }

    const cssHref = `${prefixRelativeAsset('css/style.css')}${version}`;
    let cssLink = document.querySelector('link[data-storage-hub-css]');
    if (!cssLink) {
      cssLink = document.createElement('link');
      cssLink.rel = 'stylesheet';
      cssLink.setAttribute('data-storage-hub-css', '1');
      document.head.appendChild(cssLink);
    }
    if (cssLink.getAttribute('href') !== cssHref) {
      cssLink.href = cssHref;
    }

    document.querySelectorAll('link[href]:not([data-storage-hub-css])').forEach((el) => {
      const value = el.getAttribute('href');
      if (!value || value.startsWith('/') || /^https?:/i.test(value)) return;
      const resolved = prefixRelativeAsset(value);
      if (el.getAttribute('href') !== resolved) {
        el.setAttribute('href', resolved);
      }
    });

    return base;
  }

  function bootstrapEarlyRoot() {
    if (typeof document === 'undefined') return '';

    const root = detectEarlyRoot();
    const baseHref = root ? `${root}/` : '/';
    let baseEl = document.querySelector('base[data-storage-hub-root]');
    if (!baseEl) {
      baseEl = document.createElement('base');
      baseEl.setAttribute('data-storage-hub-root', '1');
      document.head.appendChild(baseEl);
    }
    if (baseEl.getAttribute('href') !== baseHref) {
      baseEl.href = baseHref;
    }

    return root;
  }

  return { get, url, getEntryPath, ensureEntryPath, redirectBareRootIfNeeded, prefixRelativeAsset, fromStylesheet, bootstrapEarlyRoot, bootstrapHeadAssets };
})();
