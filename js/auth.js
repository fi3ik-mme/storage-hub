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
    requestToken({ prompt: '' });
  }

  async function ensureValidToken(userId) {
    const user = users.find((u) => u.id === userId);
    if (!user) throw new Error('User not found');

    if (user.scopes && user.scopes !== CONFIG.SCOPES) {
      return new Promise((resolve, reject) => {
        const prev = onAuthCallback;
        onAuthCallback = (result) => {
          onAuthCallback = prev;
          if (result.success) resolve(getToken(userId));
          else reject(new Error(result.error || 'Additional Google Drive access is required'));
        };
        reauthorizeUser(userId);
      });
    }

    if (user.expiresAt > Date.now() + 60_000) {
      const driveOk = await verifyDriveAccess(user.accessToken);
      if (driveOk) return user.accessToken;
    }

    return new Promise((resolve, reject) => {
      const prev = onAuthCallback;
      onAuthCallback = (result) => {
        onAuthCallback = prev;
        if (result.success) {
          resolve(getToken(userId));
        } else {
          reject(new Error(result.error || 'Session expired — sign in again'));
        }
      };
      requestToken({ prompt: user.expiresAt > Date.now() ? '' : 'consent', hint: user.email });
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

  function getAvatarUrl(picture) {
    return picture || DEFAULT_AVATAR;
  }

  function applyAvatarFallback(img) {
    img.addEventListener('error', () => {
      img.onerror = null;
      img.src = DEFAULT_AVATAR;
    }, { once: true });
  }

  return {
    DEFAULT_AVATAR,
    init,
    signIn,
    addUser,
    trySilentSignIn,
    ensureValidToken,
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
    getAvatarUrl,
    applyAvatarFallback,
  };
})();
