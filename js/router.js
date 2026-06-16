const Router = (() => {
  const ROOT_LABEL = typeof SITE !== 'undefined' ? SITE.name : 'Mikus Drive';
  let suppressRoute = false;
  let onNavigate = null;
  let basePath;

  function detectBasePath() {
    if (basePath !== undefined) return basePath;

    if (typeof BasePath !== 'undefined') {
      basePath = BasePath.get();
      return basePath;
    }

    if (typeof BasePath !== 'undefined') {
      basePath = BasePath.get();
      return basePath;
    }

    const pathname = location.pathname;
    if (pathname.endsWith('/index.html')) {
      basePath = pathname.slice(0, -'/index.html'.length).replace(/\/$/, '');
      return basePath;
    }
    if (pathname.endsWith('/notepad.html')) {
      basePath = pathname.slice(0, -'/notepad.html'.length).replace(/\/$/, '');
      return basePath;
    }

    basePath = '';
    return basePath;
  }

  function getBasePath() {
    return detectBasePath();
  }

  function init(navigateCallback) {
    onNavigate = navigateCallback;
    window.addEventListener('popstate', handleRouteEvent);
  }

  function handleRouteEvent() {
    if (suppressRoute) return;
    const segments = getInitialSegments();
    onNavigate?.(segments);
  }

  function segmentsToPath(urlSegments) {
    const base = getBasePath();
    if (!urlSegments?.length) return base || '/';
    const encoded = urlSegments.map((s) => encodeURIComponent(s)).join('/');
    return base ? `${base}/${encoded}` : `/${encoded}`;
  }

  function parsePathToSegments(pathname) {
    let rest = pathname || location.pathname;
    if (rest.endsWith('/index.html')) {
      rest = rest.slice(0, -'/index.html'.length);
    }

    const base = detectBasePath();
    if (base && (rest === base || rest.startsWith(`${base}/`))) {
      rest = rest.slice(base.length);
    }
    rest = rest.replace(/^\//, '').replace(/\/$/, '');
    if (!rest) return [];

    return rest.split('/').map((s) => decodeURIComponent(s));
  }

  function parseHashToSegments(hash) {
    const raw = (hash || '').replace(/^#\/?/, '').trim();
    if (!raw) return [];

    const legacyFolder = raw.match(/^user\/([^/]+)\/folder\/(.+)$/);
    if (legacyFolder) {
      return ['__legacy__', decodeURIComponent(legacyFolder[1]), decodeURIComponent(legacyFolder[2])];
    }
    const legacySection = raw.match(/^user\/([^/]+)\/(shared|starred|recent|trash)$/);
    if (legacySection) {
      return ['__legacy__', decodeURIComponent(legacySection[1]), legacySection[2]];
    }
    const legacyUser = raw.match(/^user\/([^/]+)$/);
    if (legacyUser) {
      return ['__legacy__', decodeURIComponent(legacyUser[1])];
    }
    if (raw === 'my-google' || raw === 'home') return [];

    const parts = raw.split('/').map((s) => decodeURIComponent(s));
    if (parts[0] === ROOT_LABEL) return parts.slice(1);
    return parts;
  }

  function segmentsEqual(a, b) {
    if (!a || !b) return false;
    if (a.length !== b.length) return false;
    return a.every((seg, i) => seg === b[i]);
  }

  function syncUrl(urlSegments, usePush = false) {
    const path = segmentsToPath(urlSegments);
    if (location.pathname === path && !location.hash && !location.search) return;

    suppressRoute = true;
    if (usePush) {
      history.pushState(null, '', path);
    } else {
      history.replaceState(null, '', path);
    }
    suppressRoute = false;
  }

  function getShareableUrl(urlSegments) {
    return `${location.origin}${segmentsToPath(urlSegments)}`;
  }

  function getInitialSegments() {
    if (location.hash) return parseHashToSegments(location.hash);
    return parsePathToSegments(location.pathname);
  }

  function hasInitialRoute() {
    return Boolean(location.hash) || parsePathToSegments(location.pathname).length > 0;
  }

  function migrateHashToPath() {
    if (!location.hash) return null;
    const segments = parseHashToSegments(location.hash);
    syncUrl(segments, false);
    return segments;
  }

  return {
    ROOT_LABEL,
    init,
    getBasePath,
    segmentsToPath,
    parsePathToSegments,
    parseHashToSegments,
    segmentsEqual,
    syncUrl,
    getShareableUrl,
    getInitialSegments,
    hasInitialRoute,
    migrateHashToPath,
  };
})();
