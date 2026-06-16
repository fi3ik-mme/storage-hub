const Auth = (() => {
  const STORAGE_KEY = 'mikus_drive_users';
  const LEGACY_STORAGE_KEY = 'my_google_users';
  const DEFAULT_AVATAR = 'assets/default-avatar.svg';

  let tokenClient = null;
  let onAuthCallback = null;
  let users = [];
  let activeUserId = null;
  let consentRetryCount = 0;

  function loadUsers() {
    try {
      if (!localStorage.getItem(STORAGE_KEY) && localStorage.getItem(LEGACY_STORAGE_KEY)) {
        localStorage.setItem(STORAGE_KEY, localStorage.getItem(LEGACY_STORAGE_KEY));
      }
      const data = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      users = data.users || [];
      activeUserId = data.activeUserId || users[0]?.id || null;
    } catch {
      users = [];
      activeUserId = null;
    }
  }

  function saveUsers() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ users, activeUserId }));
  }

  function needsScopeUpgrade() {
    return users.some((u) => !u.scopes || u.scopes !== CONFIG.SCOPES);
  }

  async function verifyDriveAccess(token) {
    try {
      const res = await fetch(
        'https://www.googleapis.com/drive/v3/about?fields=storageQuota,user',
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (res.status === 403) {
        const err = await res.json().catch(() => ({}));
        if (/insufficient.*scope/i.test(err.error?.message || '')) return false;
      }
      return res.ok;
    } catch {
      return false;
    }
  }

  function init(callback) {
    onAuthCallback = callback;
    loadUsers();

    const tryInit = () => {
      if (!window.google?.accounts?.oauth2) {
        setTimeout(tryInit, 100);
        return;
      }

      tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: CONFIG.CLIENT_ID,
        scope: CONFIG.SCOPES,
        callback: handleTokenResponse,
      });

      callback({ initialized: true });
    };

    tryInit();
  }

  async function handleTokenResponse(response) {
    if (response.error) {
      onAuthCallback?.({ error: response.error });
      return;
    }

    if (!response.access_token) {
      onAuthCallback?.({ error: 'No access token received' });
      return;
    }

    const token = response.access_token;
    const expiresIn = response.expires_in || 3600;

    try {
      const profile = await fetchProfile(token);
      const driveOk = await verifyDriveAccess(token);

      if (!driveOk) {
        if (consentRetryCount < 1) {
          consentRetryCount += 1;
          requestToken({ prompt: 'consent', hint: profile.email });
          return;
        }
        onAuthCallback?.({
          error: 'Google Drive access is required. Please allow all requested permissions.',
        });
        return;
      }

      consentRetryCount = 0;

      const existing = users.find((u) => u.email === profile.email);
      const user = {
        id: profile.id || profile.email,
        email: profile.email,
        name: profile.name || profile.email,
        picture: profile.picture || '',
        accessToken: token,
        expiresAt: Date.now() + expiresIn * 1000,
        scopes: CONFIG.SCOPES,
      };

      if (existing) {
        Object.assign(existing, user);
        activeUserId = existing.id;
      } else {
        users.push(user);
        activeUserId = user.id;
      }

      saveUsers();
      onAuthCallback?.({ success: true, user, isNew: !existing });
    } catch (err) {
      onAuthCallback?.({ error: err.message || 'Failed to complete sign-in' });
    }
  }

  async function fetchProfile(token) {
    try {
      const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const p = await res.json();
        return {
          id: p.id,
          email: p.email,
          name: p.name,
          picture: p.picture,
        };
      }
    } catch {
      // fall through to Drive about API
    }

    const aboutRes = await fetch(
      'https://www.googleapis.com/drive/v3/about?fields=user',
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!aboutRes.ok) {
      throw new Error('Failed to fetch user profile — check Drive API is enabled');
    }
    const about = await aboutRes.json();
    const u = about.user;
    return {
      id: u.permissionId || u.emailAddress,
      email: u.emailAddress,
      name: u.displayName || u.emailAddress,
      picture: u.photoLink || '',
    };
  }

  function requestToken({ prompt = 'consent', hint = '' } = {}) {
    if (!tokenClient) {
      onAuthCallback?.({ error: 'Google auth is not ready yet — please try again' });
      return;
    }
    const options = { prompt };
    if (hint) options.hint = hint;
    tokenClient.requestAccessToken(options);
  }

  function signIn() {
    consentRetryCount = 0;
    requestToken({ prompt: 'consent' });
  }

  function addUser() {
    consentRetryCount = 0;
    requestToken({ prompt: 'consent select_account' });
  }

  function reauthorizeUser(userId) {
    const user = users.find((u) => u.id === userId);
    if (!user) return;
    consentRetryCount = 0;
    requestToken({ prompt: 'consent', hint: user.email });
  }

  function trySilentSignIn() {
    if (needsScopeUpgrade()) return;
    const user = getActiveUser() || users[0];
    if (!user) return;
    requestToken({ prompt: '', hint: user.email });
  }

  function isTokenFresh(user) {
    return !!user?.accessToken && user.expiresAt > Date.now() + 60_000;
  }

  async function tryGetValidToken(userId) {
    const user = users.find((u) => u.id === userId);
    if (!isTokenFresh(user)) return null;
    const driveOk = await verifyDriveAccess(user.accessToken);
    return driveOk ? user.accessToken : null;
  }

  async function ensureValidToken(userId) {
    const user = users.find((u) => u.id === userId);
    if (!user) throw new Error('User not found');

    const cached = await tryGetValidToken(userId);
    if (cached) return cached;

    const err = new Error('Google sign-in required — right-click the Google drive in the sidebar and choose Re-login');
    err.code = 'AUTH_REQUIRED';
    throw err;
  }

  async function refreshTokenInteractive(userId) {
    const user = users.find((u) => u.id === userId);
    if (!user) throw new Error('User not found');

    return new Promise((resolve, reject) => {
      const prev = onAuthCallback;
      onAuthCallback = (result) => {
        onAuthCallback = prev;
        if (result.success) resolve(getToken(userId));
        else reject(new Error(result.error || 'Sign-in failed'));
      };

      const needsConsent = user.scopes && user.scopes !== CONFIG.SCOPES;
      requestToken({
        prompt: needsConsent ? 'consent' : 'select_account',
        hint: user.email,
      });
    });
  }

  function getActiveUser() {
    return users.find((u) => u.id === activeUserId) || null;
  }

  function getToken(userId) {
    const id = userId || activeUserId;
    return users.find((u) => u.id === id)?.accessToken || null;
  }

  function getUsers() {
    return [...users];
  }

  function setActiveUser(userId) {
    if (users.some((u) => u.id === userId)) {
      activeUserId = userId;
      saveUsers();
    }
  }

  function removeUser(userId) {
    const user = users.find((u) => u.id === userId);
    if (user?.accessToken) {
      google.accounts.oauth2.revoke(user.accessToken, () => {});
    }
    users = users.filter((u) => u.id !== userId);
    if (activeUserId === userId) {
      activeUserId = users[0]?.id || null;
    }
    saveUsers();
  }

  function signOutAll() {
    users.forEach((u) => {
      if (u.accessToken) google.accounts.oauth2.revoke(u.accessToken, () => {});
    });
    users = [];
    activeUserId = null;
    localStorage.removeItem(STORAGE_KEY);
  }

  function hasUsers() {
    return users.length > 0;
  }

  function formatDisplayEmail(email) {
    if (!email) return 'Unknown';
    if (email.toLowerCase().endsWith('@gmail.com')) {
      return email.slice(0, -'@gmail.com'.length);
    }
    return email;
  }

  function resolveAssetUrl(href) {
    if (!href) return href;
    if (/^https?:/i.test(href) || href.startsWith('data:') || href.startsWith('blob:')) {
      return href;
    }
    if (typeof BasePath !== 'undefined') {
      return BasePath.prefixRelativeAsset(href);
    }
    return href;
  }

  function getDefaultAvatarUrl() {
    return resolveAssetUrl(DEFAULT_AVATAR);
  }

  function isUsablePicture(picture) {
    return typeof picture === 'string' && picture.trim().length > 0;
  }

  function getAvatarUrl(picture) {
    if (!isUsablePicture(picture)) return getDefaultAvatarUrl();
    return resolveAssetUrl(picture.trim());
  }

  function isDefaultAvatarImg(img) {
    if (!img?.src) return false;
    try {
      return new URL(img.src, location.href).href === new URL(getDefaultAvatarUrl(), location.href).href;
    } catch {
      return img.src.includes('default-avatar');
    }
  }

  function swapAvatarToFallback(img) {
    const fallback = getDefaultAvatarUrl();
    if (!isDefaultAvatarImg(img)) {
      img.removeAttribute('srcset');
      img.src = fallback;
    }
  }

  function applyAvatarFallback(img) {
    if (!img || img.dataset.avatarFallbackBound) return;
    img.dataset.avatarFallbackBound = '1';

    if (img.complete && img.naturalWidth === 0 && img.src && !isDefaultAvatarImg(img)) {
      swapAvatarToFallback(img);
      return;
    }

    img.addEventListener('error', () => swapAvatarToFallback(img), { once: true });
  }

  function applyAvatarFallbacks(root = document) {
    root.querySelectorAll('img.user-drive-avatar, img.sidebar-user-avatar, img.avatar-img')
      .forEach(applyAvatarFallback);
  }

  function checkAvatarUrl(url) {
    const fallback = getDefaultAvatarUrl();
    if (!isUsablePicture(url)) return Promise.resolve(fallback);

    const resolved = resolveAssetUrl(url.trim());
    if (resolved === fallback) return Promise.resolve(fallback);

    return new Promise((resolve) => {
      const probe = new Image();
      probe.onload = () => resolve(resolved);
      probe.onerror = () => resolve(fallback);
      probe.src = resolved;
    });
  }

  return {
    DEFAULT_AVATAR,
    init,
    signIn,
    addUser,
    trySilentSignIn,
    tryGetValidToken,
    isTokenFresh,
    ensureValidToken,
    refreshTokenInteractive,
    signOutAll,
    reauthorizeUser,
    needsScopeUpgrade,
    getActiveUser,
    getToken,
    getUsers,
    setActiveUser,
    removeUser,
    hasUsers,
    formatDisplayEmail,
    getDefaultAvatarUrl,
    getAvatarUrl,
    applyAvatarFallback,
    applyAvatarFallbacks,
    checkAvatarUrl,
  };
})();
