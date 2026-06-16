const BasePath = (() => {
  const APP_ROOT_KEY = 'mikus_drive_app_root';

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

  function inferRootFromPathname(pathname) {
    const parts = pathname.replace(/\/$/, '').split('/').filter(Boolean);
    if (parts.length === 0) return '';

    if (looksLikeDriveRouteSegment(parts[0])) return '';

    if (parts.length >= 2 && looksLikeDriveRouteSegment(parts[1])) {
      return `/${parts[0]}`;
    }

    if (parts.length === 1 && !looksLikeDriveRouteSegment(parts[0])) {
      return `/${parts[0]}`;
    }

    return '';
  }

  function fromStylesheet() {
    const link = document.querySelector('link[rel="stylesheet"][href*="style.css"]');
    if (!link) return '';

    const hrefAttr = link.getAttribute('href') || '';
    // Relative stylesheet on a deep SPA URL resolves under the route and yields a false base.
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

    if (configured && (pathname === configured || pathname.startsWith(`${configured}/`))) {
      return persistRoot(configured);
    }

    if (pathname.endsWith('/index.html')) {
      return persistRoot(pathname.slice(0, -'/index.html'.length).replace(/\/$/, ''));
    }
    if (pathname.endsWith('/notepad.html')) {
      return persistRoot(pathname.slice(0, -'/notepad.html'.length).replace(/\/$/, ''));
    }

    const stored = readStoredRoot();
    if (stored !== null) return stored;

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
    if (!href || href.startsWith('/') || /^https?:/i.test(href)) return href;
    const base = get();
    return base ? `${base}/${href}` : href;
  }

  return { get, url, prefixRelativeAsset, fromStylesheet };
})();
