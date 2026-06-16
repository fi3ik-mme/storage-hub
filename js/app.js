const App = (() => {
  const ROOT_ID = 'home';
  const ROOT_NAME = typeof SITE !== 'undefined' ? SITE.name : 'Mikus Drive';
  const TREE_PAGE_SIZE = 10;

  const state = {
    level: 'home',
    currentUserId: null,
    currentFolderId: Drive.ROOT_ID,
    view: 'grid',
    section: 'my-drive',
    files: [],
    breadcrumbs: [{ id: ROOT_ID, name: ROOT_NAME }],
    history: [{ level: 'home', userId: null, folderId: null, section: 'my-drive' }],
    historyIndex: 0,
    selectedId: null,
    expandedRoot: true,
    expandedUsers: new Set(),
    expandedFolders: new Set(),
    treeChildren: {},
    treeVisibleCount: {},
    userQuotas: {},
  };

  let urlPushPending = false;
  let initialRouteApplied = false;

  const USER_SECTIONS = [
    { id: 'my-drive', icon: '📁', label: 'My Drive' },
    { id: 'recent', icon: '🕐', label: 'Recent' },
    { id: 'shared', icon: '👥', label: 'Shared with me' },
    { id: 'starred', icon: '⭐', label: 'Starred' },
    { id: 'trash', icon: '🗑️', label: 'Recycle Bin' },
  ];

  const LOCAL_DISK_SECTIONS = [
    { id: 'my-drive', icon: '📁', label: 'My Drive' },
    { id: 'trash', icon: '🗑️', label: 'Recycle Bin' },
  ];

  const GITHUB_DISK_SECTIONS = [
    { id: 'my-drive', icon: '📁', label: 'My Drive' },
  ];

  const SECTION_LABELS = {
    shared: 'Shared with me',
    starred: 'Starred',
    recent: 'Recent',
    trash: 'Recycle Bin',
  };

  const SECTION_BY_LABEL = Object.fromEntries(
    Object.entries(SECTION_LABELS).map(([id, label]) => [label, id])
  );

  const $ = (sel) => document.querySelector(sel);

  function show(el) { el.classList.remove('hidden'); }
  function hide(el) { el.classList.add('hidden'); }

  function setLoading(on) {
    on ? show($('#loading')) : hide($('#loading'));
  }

  function showError(msg) {
    const el = $('#error');
    if (msg) {
      el.textContent = msg;
      show(el);
    } else {
      hide(el);
    }
  }

  function showStatus(msg) {
    $('#status-selected').textContent = msg || '';
  }

  function isCurrentLocalDrive() {
    return LocalDisk.isLocalId(state.currentUserId);
  }

  function isCurrentGithubDrive() {
    return GithubDisk.isGithubId(state.currentUserId);
  }

  function isLocalOrGithubDrive(id) {
    return LocalDisk.isLocalId(id) || GithubDisk.isGithubId(id);
  }

  function buildFileContext(file) {
    if (file.isLocalDisk) {
      return {
        type: 'local-disk',
        diskId: file.userId,
        disk: LocalDisk.getDisk(file.userId),
      };
    }
    if (file.isGithubDisk) {
      return {
        type: 'github-disk',
        diskId: file.userId,
        disk: GithubDisk.getDisk(file.userId),
      };
    }
    if (file.isUserDrive) {
      return {
        type: 'user',
        userId: file.userId,
        user: Auth.getUsers().find((u) => u.id === file.userId),
      };
    }
    return {
      type: file.isFolder ? 'folder' : 'file',
      file,
      userId: file.userId || state.currentUserId,
      folderId: state.currentFolderId,
      section: state.level === 'home' ? 'my-drive' : state.section,
    };
  }

  function attachFileContextMenu(el, file) {
    const openMenu = () => {
      selectFile(file.id);
      ContextMenu.showContext(buildFileContext(file));
    };

    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      selectFile(file.id);
      ContextMenu.show(e, buildFileContext(file));
    });

    attachLongPress(el, openMenu);

    el.querySelector('.item-more-btn')?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openMenu();
    });
  }

  function attachLongPress(el, callback) {
    let pressTimer = null;
    let longPressFired = false;
    let startX = 0;
    let startY = 0;

    const clearPress = () => {
      if (pressTimer) clearTimeout(pressTimer);
      pressTimer = null;
    };

    el.addEventListener('touchstart', (e) => {
      if (e.target.closest('.item-more-btn, .tree-item-more')) return;
      longPressFired = false;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      pressTimer = setTimeout(() => {
        longPressFired = true;
        if (navigator.vibrate) navigator.vibrate(12);
        callback();
      }, 480);
    }, { passive: true });

    el.addEventListener('touchmove', (e) => {
      const touch = e.touches[0];
      if (Math.abs(touch.clientX - startX) > 12 || Math.abs(touch.clientY - startY) > 12) {
        clearPress();
      }
    }, { passive: true });

    el.addEventListener('touchend', clearPress, { passive: true });
    el.addEventListener('touchcancel', clearPress, { passive: true });

    el.addEventListener('click', (e) => {
      if (!longPressFired) return;
      e.preventDefault();
      e.stopPropagation();
      longPressFired = false;
    }, true);
  }

  function createItemMoreButton(label) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'item-more-btn';
    btn.setAttribute('aria-label', label || 'Actions');
    btn.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/></svg>';
    return btn;
  }

  function addTreeMoreButton(row, getContext) {
    if (!row || row.querySelector('.tree-item-more')) return;
    const btn = createItemMoreButton('Actions');
    btn.classList.add('tree-item-more');
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      ContextMenu.showContext(getContext());
    });
    row.appendChild(btn);
    attachLongPress(row, () => ContextMenu.showContext(getContext()));
  }

  function getCurrentAreaContext() {
    if (state.selectedId) {
      const file = state.files.find((f) => f.id === state.selectedId);
      if (file) return buildFileContext(file);
    }
    if (state.level === 'home') return { type: 'root' };
    if (state.level === 'drive' && state.currentUserId) {
      return {
        type: 'empty',
        userId: state.currentUserId,
        folderId: state.currentFolderId,
        section: state.section,
      };
    }
    return null;
  }

  function openMobileAreaMenu() {
    const ctx = getCurrentAreaContext();
    if (ctx) ContextMenu.showContext(ctx);
  }

  function snapshot() {
    return {
      level: state.level,
      userId: state.currentUserId,
      folderId: state.currentFolderId,
      section: state.section,
    };
  }

  function pushHistory() {
    state.history = state.history.slice(0, state.historyIndex + 1);
    state.history.push(snapshot());
    state.historyIndex = state.history.length - 1;
    urlPushPending = true;
  }

  function resetHistoryToCurrent() {
    state.history = [snapshot()];
    state.historyIndex = 0;
  }

  function getUrlSegments() {
    if (state.level === 'home') return [];

    const segments = [];
    if (LocalDisk.isLocalId(state.currentUserId)) {
      const disk = LocalDisk.getDisk(state.currentUserId);
      if (!disk) return segments;
      segments.push(disk.name);
      if (state.section !== 'my-drive') {
        segments.push(SECTION_LABELS[state.section] || state.section);
        return segments;
      }
      segments.push('My Drive');
      if (state.currentFolderId !== LocalDisk.ROOT_ID && state.breadcrumbs.length > 2) {
        state.breadcrumbs.slice(2)
          .filter((crumb) => crumb.id !== LocalDisk.ROOT_ID && crumb.name !== 'My Drive')
          .forEach((crumb) => segments.push(crumb.name));
      }
      return segments;
    }

    if (GithubDisk.isGithubId(state.currentUserId)) {
      const disk = GithubDisk.getDisk(state.currentUserId);
      if (!disk) return segments;
      segments.push(disk.name);
      segments.push('My Drive');
      if (state.currentFolderId !== GithubDisk.ROOT_ID && state.breadcrumbs.length > 2) {
        state.breadcrumbs.slice(2)
          .filter((crumb) => crumb.id !== GithubDisk.ROOT_ID && crumb.name !== 'My Drive')
          .forEach((crumb) => segments.push(crumb.name));
      }
      return segments;
    }

    const user = Auth.getUsers().find((u) => u.id === state.currentUserId);
    if (!user) return segments;

    segments.push(userLabel(user));

    if (state.section !== 'my-drive') {
      segments.push(SECTION_LABELS[state.section] || state.section);
      return segments;
    }

    segments.push('My Drive');
    if (state.currentFolderId !== Drive.ROOT_ID && state.breadcrumbs.length > 2) {
      state.breadcrumbs.slice(2)
        .filter((crumb) => crumb.id !== Drive.ROOT_ID && crumb.name !== 'My Drive')
        .forEach((crumb) => segments.push(crumb.name));
    }
    return segments;
  }

  async function resolveFolderPath(token, folderNames, rootId = Drive.ROOT_ID, listFn = Drive.listFiles) {
    let parentId = rootId;
    for (const name of folderNames) {
      const items = await listFn(token, parentId);
      const folder = items.find((f) => f.isFolder && f.name === name);
      if (!folder) throw new Error(`Folder not found: ${name}`);
      parentId = folder.id;
    }
    return parentId;
  }

  async function routeFromSegments(segments) {
    if (!segments?.length) return { level: 'home' };

    if (segments[0] === '__legacy__') {
      const [, userId, second] = segments;
      const user = Auth.getUsers().find((u) => u.id === userId);
      if (!user) return { level: 'home' };
      if (!second) {
        return { level: 'drive', userId: user.id, section: 'my-drive', folderId: Drive.ROOT_ID };
      }
      if (['shared', 'starred', 'recent', 'trash'].includes(second)) {
        return { level: 'drive', userId: user.id, section: second, folderId: Drive.ROOT_ID };
      }
      return { level: 'drive', userId: user.id, section: 'my-drive', folderId: second };
    }

    let parts = segments;
    if (parts[0] === Router.ROOT_LABEL) parts = parts.slice(1);
    if (!parts.length) return { level: 'home' };

    const localDisk = LocalDisk.getDiskByName(parts[0]);
    if (localDisk) {
      if (parts.length === 1) {
        return {
          level: 'drive',
          userId: localDisk.id,
          section: 'my-drive',
          folderId: LocalDisk.ROOT_ID,
        };
      }
      const second = parts[1];
      if (SECTION_BY_LABEL[second]) {
        return {
          level: 'drive',
          userId: localDisk.id,
          section: SECTION_BY_LABEL[second],
          folderId: LocalDisk.ROOT_ID,
        };
      }
      let folderNames = second === 'My Drive' ? parts.slice(2) : parts.slice(1);
      if (second === 'My Drive' && folderNames[0] === 'My Drive') {
        folderNames = folderNames.slice(1);
      }
      let folderId = LocalDisk.ROOT_ID;
      if (folderNames.length > 0) {
        folderId = await resolveFolderPath(
          localDisk.id,
          folderNames,
          LocalDisk.ROOT_ID,
          (diskId, parentId) => LocalDisk.listFiles(diskId, parentId)
        );
      }
      return {
        level: 'drive',
        userId: localDisk.id,
        section: 'my-drive',
        folderId,
      };
    }

    const githubDisk = GithubDisk.getDiskByName(parts[0]);
    if (githubDisk) {
      if (parts.length === 1) {
        return {
          level: 'drive',
          userId: githubDisk.id,
          section: 'my-drive',
          folderId: GithubDisk.ROOT_ID,
        };
      }
      const second = parts[1];
      let folderNames = second === 'My Drive' ? parts.slice(2) : parts.slice(1);
      if (second === 'My Drive' && folderNames[0] === 'My Drive') {
        folderNames = folderNames.slice(1);
      }
      let folderId = GithubDisk.ROOT_ID;
      if (folderNames.length > 0) {
        folderId = await resolveFolderPath(
          githubDisk.id,
          folderNames,
          GithubDisk.ROOT_ID,
          (diskId, parentId) => GithubDisk.listFiles(diskId, parentId)
        );
      }
      return {
        level: 'drive',
        userId: githubDisk.id,
        section: 'my-drive',
        folderId,
      };
    }

    const user = Auth.getUsers().find((u) => userLabel(u) === parts[0]);
    if (!user) return null;

    if (parts.length === 1) {
      return { level: 'drive', userId: user.id, section: 'my-drive', folderId: Drive.ROOT_ID };
    }

    const second = parts[1];
    if (SECTION_BY_LABEL[second]) {
      return {
        level: 'drive',
        userId: user.id,
        section: SECTION_BY_LABEL[second],
        folderId: Drive.ROOT_ID,
      };
    }

    let folderNames = second === 'My Drive' ? parts.slice(2) : parts.slice(1);
    if (second === 'My Drive' && folderNames[0] === 'My Drive') {
      folderNames = folderNames.slice(1);
    }
    let folderId = Drive.ROOT_ID;

    if (folderNames.length > 0) {
      const token = await Auth.tryGetValidToken(user.id);
      if (token) {
        folderId = await resolveFolderPath(token, folderNames);
      }
    }

    return {
      level: 'drive',
      userId: user.id,
      section: 'my-drive',
      folderId,
    };
  }

  async function applyRoute(route, addToHistory = false) {
    if (!route) return;

    if (route.level === 'home') {
      state.level = 'home';
      state.currentUserId = null;
      state.currentFolderId = Drive.ROOT_ID;
      state.section = 'my-drive';
      state.expandedUsers.clear();
      if (addToHistory) pushHistory();
      else resetHistoryToCurrent();
      await loadCurrentLocation();
      return;
    }

    const isLocal = LocalDisk.isLocalId(route.userId);
    const isGithub = GithubDisk.isGithubId(route.userId);
    const user = isLocal
      ? LocalDisk.getDisk(route.userId)
      : isGithub
        ? GithubDisk.getDisk(route.userId)
        : Auth.getUsers().find((u) => u.id === route.userId);
    if (!user) {
      await applyRoute({ level: 'home' }, false);
      return;
    }

    state.level = 'drive';
    state.currentUserId = route.userId;
    state.currentFolderId = route.folderId || (isLocal ? LocalDisk.ROOT_ID : isGithub ? GithubDisk.ROOT_ID : Drive.ROOT_ID);
    state.section = route.section || 'my-drive';
    state.expandedUsers.clear();
    state.expandedUsers.add(route.userId);
    if (!isLocal && !isGithub) Auth.setActiveUser(route.userId);
    if (addToHistory) pushHistory();
    else resetHistoryToCurrent();
    await loadCurrentLocation();
  }

  async function applySegments(segments, addToHistory = false) {
    const route = await routeFromSegments(segments);
    if (!route) {
      await applyRoute({ level: 'home' }, false);
      return;
    }
    await applyRoute(route, addToHistory);
  }

  function restoreHistory(entry) {
    state.level = entry.level;
    state.currentUserId = entry.userId;
    state.currentFolderId = entry.folderId
      || (LocalDisk.isLocalId(entry.userId) ? LocalDisk.ROOT_ID : GithubDisk.isGithubId(entry.userId) ? GithubDisk.ROOT_ID : Drive.ROOT_ID);
    state.section = entry.section;
  }

  function updateNavButtons() {
    $('#btn-back').disabled = state.historyIndex <= 0;
    $('#btn-forward').disabled = state.historyIndex >= state.history.length - 1;

    $('#btn-up').disabled = state.level === 'home';
  }

  function userLabel(user) {
    return Auth.formatDisplayEmail(user.email);
  }

  function getQuotaLabel(userId) {
    return state.userQuotas[userId]?.label || '…';
  }

  function getQuotaShort(userId) {
    return state.userQuotas[userId]?.shortLabel || '…';
  }

  function usersAsFileItems() {
    return Auth.getUsers().map((u) => ({
      id: `user:${u.id}`,
      name: userLabel(u),
      isFolder: true,
      isUserDrive: true,
      userId: u.id,
      picture: u.picture,
      quotaLabel: getQuotaShort(u.id),
      typeName: 'User Drive',
      sizeFormatted: getQuotaShort(u.id),
      dateFormatted: '—',
    }));
  }

  function localDisksAsFileItems() {
    return LocalDisk.getDisks().map((disk) => ({
      id: `local:${disk.id}`,
      name: disk.name,
      isFolder: true,
      isLocalDisk: true,
      userId: disk.id,
      quotaLabel: getQuotaShort(disk.id),
      typeName: 'Local Storage',
      sizeFormatted: getQuotaShort(disk.id),
      dateFormatted: '—',
    }));
  }

  function githubDisksAsFileItems() {
    return GithubDisk.getDisks().map((disk) => ({
      id: `github:${disk.id}`,
      name: disk.name,
      isFolder: true,
      isGithubDisk: true,
      userId: disk.id,
      picture: disk.accountAvatar,
      quotaLabel: getQuotaShort(disk.id),
      typeName: 'GitHub Repo',
      sizeFormatted: getQuotaShort(disk.id),
      dateFormatted: '—',
    }));
  }

  function homeDriveItems() {
    return [...usersAsFileItems(), ...localDisksAsFileItems(), ...githubDisksAsFileItems()];
  }

  function isScopeError(message) {
    return /insufficient.*scope/i.test(message || '');
  }

  async function refreshUserQuotas(preloadedTokens = {}) {
    const users = Auth.getUsers();
    const localDisks = LocalDisk.getDisks();
    const githubDisks = GithubDisk.getDisks();
    await Promise.all([
      ...users.map(async (user) => {
        try {
          if (user.scopes && user.scopes !== CONFIG.SCOPES) {
            throw Object.assign(new Error('Scopes outdated'), { code: 'INSUFFICIENT_SCOPES' });
          }
          const token = preloadedTokens[user.id] || await Auth.tryGetValidToken(user.id);
          if (!token) {
            const needsReauth = !Auth.isTokenFresh(user)
              || (user.scopes && user.scopes !== CONFIG.SCOPES);
            state.userQuotas[user.id] = {
              label: needsReauth ? 'Re-login for storage' : 'Storage unavailable',
              shortLabel: '—',
              needsReauth,
            };
            return;
          }
          state.userQuotas[user.id] = await Drive.getStorageQuota(token);
        } catch (err) {
          if (err.code === 'INSUFFICIENT_SCOPES' || isScopeError(err.message)) {
            state.userQuotas[user.id] = {
              label: 'Re-login for storage',
              shortLabel: '—',
              needsReauth: true,
            };
          } else {
            state.userQuotas[user.id] = {
              label: 'Storage unavailable',
              shortLabel: '—',
            };
          }
        }
      }),
      ...localDisks.map(async (disk) => {
        try {
          state.userQuotas[disk.id] = await LocalDisk.getStorageQuota(disk.id);
        } catch {
          state.userQuotas[disk.id] = {
            label: 'Storage unavailable',
            shortLabel: '—',
          };
        }
      }),
      ...githubDisks.map(async (disk) => {
        try {
          state.userQuotas[disk.id] = await GithubDisk.getStorageQuota(disk.id);
        } catch {
          state.userQuotas[disk.id] = {
            label: 'Storage unavailable',
            shortLabel: '—',
          };
        }
      }),
    ]);

    document.querySelectorAll('.tree-user-quota').forEach((el) => {
      const userId = el.dataset.userId;
      const quota = state.userQuotas[userId];
      el.textContent = getQuotaLabel(userId);
      el.classList.toggle('tree-user-quota-reauth', !!quota?.needsReauth);
    });

    if (state.level === 'home') {
      state.files = homeDriveItems();
      renderCurrentView();
    }
  }

  async function ejectLocalDisk(diskId) {
    await LocalDisk.removeDisk(diskId);
    delete state.userQuotas[diskId];
    clearTreeCache(diskId);
    state.expandedUsers.delete(diskId);

    if (state.currentUserId === diskId) {
      state.currentUserId = null;
      navigateToMyGoogle();
      showExplorer();
      return;
    }

    renderSidebarTree();
    if (state.level === 'home') {
      state.files = homeDriveItems();
      renderCurrentView();
    }
  }

  async function ejectGithubDisk(diskId) {
    await GithubDisk.removeDisk(diskId);
    delete state.userQuotas[diskId];
    clearTreeCache(diskId);
    state.expandedUsers.delete(diskId);

    if (state.currentUserId === diskId) {
      state.currentUserId = null;
      navigateToMyGoogle();
      showExplorer();
      return;
    }

    renderSidebarTree();
    if (state.level === 'home') {
      state.files = homeDriveItems();
      renderCurrentView();
    }
  }

  async function ejectAllDrives() {
    const localIds = LocalDisk.getDisks().map((d) => d.id);
    const githubIds = GithubDisk.getDisks().map((d) => d.id);
    for (const diskId of localIds) {
      await LocalDisk.removeDisk(diskId);
      delete state.userQuotas[diskId];
      clearTreeCache(diskId);
    }
    for (const diskId of githubIds) {
      await GithubDisk.removeDisk(diskId);
      delete state.userQuotas[diskId];
      clearTreeCache(diskId);
    }
    Auth.signOutAll();
    navigateToMyGoogle();
    showExplorer();
  }

  function signOutUser(userId) {
    Auth.removeUser(userId);
    delete state.userQuotas[userId];
    clearTreeCache(userId);
    state.expandedUsers.delete(userId);

    if (state.currentUserId === userId) {
      state.currentUserId = null;
      navigateToMyGoogle();
      showExplorer();
      return;
    }

    renderSidebarTree();
    if (state.level === 'home') {
      state.files = homeDriveItems();
      renderCurrentView();
    }
  }

  function renderUserAvatar(picture, className) {
    const src = escapeHtml(Auth.getAvatarUrl(picture));
    const cls = escapeHtml(`${className} avatar-img`.trim());
    return `<img src="${src}" alt="" class="${cls}" loading="lazy" />`;
  }

  function renderLocalStorageIcon(sizeClass = '') {
    const size = sizeClass === 'user-drive-avatar' ? 48
      : sizeClass === 'file-icon-wrap--small' ? 20
        : sizeClass === 'file-icon-wrap--tiny' ? 18
          : sizeClass ? 40 : 22;
    const cls = `local-storage-icon ${sizeClass}`.trim();
    return `<svg class="${cls}" viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true">
      <path fill="currentColor" d="M20 2H4c-1 0-2 .9-2 2v3.01c0 .72.43 1.34 1 1.62V20c0 1.1 1.1 2 2 2h12c1.1 0 2-.9 2-2V8.63c.57-.28 1-.9 1-1.62V4c0-1.1-1-2-2-2zm-5 14H9v-2h6v2zm5-6H4V5h16v5z"/>
    </svg>`;
  }

  function renderGoogleDriveIcon(user, className = 'user-drive-avatar') {
    return renderUserAvatar(user?.picture, className);
  }

  function renderBreadcrumbs() {
    const container = $('#breadcrumbs');
    container.innerHTML = '';

    state.breadcrumbs.forEach((crumb, i) => {
      if (i > 0) {
        const sep = document.createElement('span');
        sep.className = 'breadcrumb-sep';
        sep.textContent = '›';
        container.appendChild(sep);
      }

      const isLast = i === state.breadcrumbs.length - 1;
      const el = document.createElement('span');
      el.className = isLast ? 'breadcrumb-current' : 'breadcrumb-item';
      el.textContent = crumb.name;
      if (!isLast) {
        el.addEventListener('click', () => navigateToCrumb(crumb));
      }
      container.appendChild(el);
    });
  }

  function navigateToCrumb(crumb) {
    if (crumb.id === ROOT_ID) {
      navigateToMyGoogle();
    } else if (LocalDisk.getDisk(crumb.id)) {
      navigateToLocalDisk(crumb.id, LocalDisk.ROOT_ID);
    } else if (GithubDisk.getDisk(crumb.id)) {
      navigateToGithubDisk(crumb.id, GithubDisk.ROOT_ID);
    } else if (crumb.id.startsWith('user:')) {
      navigateToUser(crumb.id.slice(5), Drive.ROOT_ID);
    } else if (crumb.id === Drive.ROOT_ID || crumb.id === LocalDisk.ROOT_ID || crumb.id === GithubDisk.ROOT_ID) {
      if (LocalDisk.isLocalId(state.currentUserId)) {
        navigateToLocalDisk(state.currentUserId, LocalDisk.ROOT_ID);
      } else if (GithubDisk.isGithubId(state.currentUserId)) {
        navigateToGithubDisk(state.currentUserId, GithubDisk.ROOT_ID);
      } else {
        navigateToUser(state.currentUserId, Drive.ROOT_ID);
      }
    } else if (['shared', 'starred', 'recent', 'trash'].includes(crumb.id)) {
      state.level = 'drive';
      state.section = crumb.id;
      state.currentFolderId = Drive.ROOT_ID;
      pushHistory();
      loadCurrentLocation();
    } else {
      navigateToFolder(crumb.id);
    }
  }

  function getFileTypeIcon(file) {
    return file.icon || Drive.getDefaultIcon(file.mimeType) || '📄';
  }

  function renderFileIcon(file, sizeClass = '') {
    if (file.isUserDrive) {
      const user = Auth.getUsers().find((u) => u.id === file.userId);
      return renderGoogleDriveIcon(user || { picture: file.picture }, 'user-drive-avatar');
    }
    if (file.isLocalDisk) {
      return renderLocalStorageIcon(sizeClass || 'user-drive-avatar');
    }
    if (file.isGithubDisk) {
      return renderUserAvatar(file.picture || GithubDisk.getDisk(file.userId)?.accountAvatar, 'user-drive-avatar');
    }

    const fallback = getFileTypeIcon(file);
    const previewSrc = !file.isFolder && (file.thumbnailLink || file.iconLink);

    if (!previewSrc) {
      return `<span class="file-type-fallback ${sizeClass}">${fallback}</span>`;
    }

    const src = escapeHtml(previewSrc);
    const wrapClass = `file-icon-wrap ${sizeClass}`.trim();
    return `<span class="${wrapClass}">
      <span class="file-type-fallback">${fallback}</span>
      <img src="${src}" alt="" loading="lazy" onload="this.classList.add('loaded')" onerror="this.remove()" />
    </span>`;
  }

  function renderGrid() {
    const grid = $('#file-grid');
    grid.innerHTML = '';

    state.files.forEach((file) => {
      const item = document.createElement('div');
      item.className = 'file-item' + (file.id === state.selectedId ? ' selected' : '');
      item.dataset.id = file.id;
      const quotaHtml = (file.isUserDrive || file.isLocalDisk)
        ? `<span class="file-quota">${escapeHtml(file.quotaLabel || '…')}</span>`
        : '';
      item.innerHTML = `
        <button type="button" class="item-more-btn" aria-label="Actions for ${escapeHtml(file.name)}">
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/></svg>
        </button>
        <div class="file-icon">${renderFileIcon(file)}</div>
        <span class="file-name">${escapeHtml(file.name)}</span>
        ${quotaHtml}
      `;
      item.addEventListener('click', () => selectFile(file.id));
      item.addEventListener('dblclick', () => openFile(file));
      attachFileContextMenu(item, file);
      bindDragDropForWorkspaceItem(item, file);
      grid.appendChild(item);
    });
    Auth.applyAvatarFallbacks(grid);
  }

  function renderList() {
    const body = $('#file-list-body');
    body.innerHTML = '';

    state.files.forEach((file) => {
      const row = document.createElement('div');
      row.className = 'list-row' + (file.id === state.selectedId ? ' selected' : '');
      row.dataset.id = file.id;
      row.innerHTML = `
        <span class="col-name">
          <span class="list-icon">${renderFileIcon(file, 'file-icon-wrap--small')}</span>
          <span class="list-name-text">${escapeHtml(file.name)}</span>
        </span>
        <span class="col-modified">${file.dateFormatted}</span>
        <span class="col-size">${file.sizeFormatted}</span>
        <span class="col-type">${file.typeName}</span>
        <button type="button" class="item-more-btn" aria-label="Actions for ${escapeHtml(file.name)}">
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/></svg>
        </button>
      `;
      row.addEventListener('click', () => selectFile(file.id));
      row.addEventListener('dblclick', () => openFile(file));
      attachFileContextMenu(row, file);
      bindDragDropForWorkspaceItem(row, file);
      body.appendChild(row);
    });
    Auth.applyAvatarFallbacks(body);
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function selectFile(id) {
    state.selectedId = id;
    renderCurrentView();
    const file = state.files.find((f) => f.id === id);
    $('#status-selected').textContent = file ? file.name : '';
  }

  async function downloadLocalFile(file) {
    const blob = await LocalDisk.downloadFile(state.currentUserId, file.id);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    a.click();
    URL.revokeObjectURL(url);
    showStatus(`Downloading "${file.name}"`);
  }

  function openFile(file, userId = state.currentUserId, options = {}) {
    if (file.isUserDrive) {
      navigateToUser(file.userId, Drive.ROOT_ID);
    } else if (file.isLocalDisk) {
      navigateToLocalDisk(file.userId, LocalDisk.ROOT_ID);
    } else if (file.isGithubDisk) {
      navigateToGithubDisk(file.userId, GithubDisk.ROOT_ID);
    } else if (file.isFolder && state.section !== 'trash') {
      navigateToFolder(file.id);
    } else if (
      userId
      && (
        Drive.isNotepadFile(file)
        || (LocalDisk.isLocalId(userId) && LocalDisk.isNotepadFile(file))
        || (GithubDisk.isGithubId(userId) && GithubDisk.isNotepadFile(file))
      )
      && (options.fromTree || state.section === 'my-drive')
    ) {
      Notepad.openInTab(file, userId).catch(showError);
    } else if (userId && LocalDisk.isLocalId(userId) && !file.isFolder) {
      const prevUserId = state.currentUserId;
      state.currentUserId = userId;
      downloadLocalFile(file).catch(showError).finally(() => {
        state.currentUserId = prevUserId;
      });
    } else if (userId && GithubDisk.isGithubId(userId) && !file.isFolder) {
      GithubDisk.downloadFile(userId, file.id).then((blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = file.name;
        a.click();
        URL.revokeObjectURL(url);
      }).catch(showError);
    } else if (file.webViewLink) {
      window.open(file.webViewLink, '_blank');
    }
  }

  function renderCurrentView() {
    if (state.view === 'grid') {
      show($('#file-grid'));
      hide($('#file-list'));
      renderGrid();
    } else {
      hide($('#file-grid'));
      show($('#file-list'));
      renderList();
    }

    if (state.files.length === 0) {
      show($('#empty-state'));
    } else {
      hide($('#empty-state'));
    }

    const count = state.files.length;
    $('#status-count').textContent = `${count} item${count !== 1 ? 's' : ''}`;
  }

  function setView(view) {
    state.view = view;
    $('#btn-view-grid').classList.toggle('active', view === 'grid');
    $('#btn-view-list').classList.toggle('active', view === 'list');
    renderCurrentView();
  }

  function folderKey(userId, folderId) {
    return `${userId}:${folderId}`;
  }

  function toDiskNavId(diskId) {
    return diskId.replace(':', '-');
  }

  function fromDiskNavId(navId) {
    return navId.replace(/^local-/, 'local:');
  }

  function toGithubNavId(diskId) {
    return encodeURIComponent(diskId);
  }

  function fromGithubNavId(navId) {
    return decodeURIComponent(navId);
  }

  function folderNavId(userId, folderId) {
    return `folder|${userId}|${folderId}`;
  }

  function parseFolderNav(nav) {
    if (!nav?.startsWith('folder|')) return null;
    const parts = nav.split('|');
    if (parts.length < 3) return null;
    return { userId: parts[1], folderId: parts.slice(2).join('|') };
  }

  function getDriveRootId() {
    if (isCurrentLocalDrive()) return LocalDisk.ROOT_ID;
    if (isCurrentGithubDrive()) return GithubDisk.ROOT_ID;
    return Drive.ROOT_ID;
  }

  function getActiveNavId() {
    if (state.level === 'home') return 'home';
    if (!state.currentUserId) return 'home';
    const drivePrefix = isCurrentLocalDrive() ? 'disk' : isCurrentGithubDrive() ? 'github' : 'user';
    if (state.section === 'my-drive') {
      const rootId = getDriveRootId();
      if (state.currentFolderId !== rootId) {
        return folderNavId(state.currentUserId, state.currentFolderId);
      }
      return `${drivePrefix}:${state.currentUserId}:my-drive`;
    }
    return `${drivePrefix}:${state.currentUserId}:${state.section}`;
  }

  function setSidebarActive(itemId) {
    document.querySelectorAll('.sidebar-item').forEach((el) => el.classList.remove('active'));
    const el = document.querySelector(`[data-nav="${itemId}"]`);
    el?.classList.add('active');
  }

  function isUserExpanded(userId) {
    return state.expandedUsers.has(userId);
  }

  function isFolderExpanded(userId, folderId) {
    return state.expandedFolders.has(folderKey(userId, folderId));
  }

  function createTreeToggle({ type, userId, folderId, expanded }) {
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'tree-toggle';
    toggle.dataset.treeToggle = type;
    if (userId) toggle.dataset.userId = userId;
    if (folderId) toggle.dataset.folderId = folderId;
    toggle.setAttribute('aria-expanded', String(expanded));
    toggle.setAttribute('aria-label', expanded ? 'Collapse' : 'Expand');
    toggle.innerHTML = '<span class="tree-chevron" aria-hidden="true"></span>';
    return toggle;
  }

  function createTreeSpacer() {
    const spacer = document.createElement('span');
    spacer.className = 'tree-toggle-spacer';
    spacer.setAttribute('aria-hidden', 'true');
    return spacer;
  }

  function clearTreeCache(userId) {
    Object.keys(state.treeChildren).forEach((key) => {
      if (key.startsWith(`${userId}:`)) {
        delete state.treeChildren[key];
        delete state.treeVisibleCount[key];
      }
    });
  }

  async function loadTreeChildren(userId, token, parentId) {
    const key = folderKey(userId, parentId);
    if (state.treeChildren[key]) return state.treeChildren[key];

    const files = LocalDisk.isLocalId(userId)
      ? await LocalDisk.listFiles(userId, parentId)
      : GithubDisk.isGithubId(userId)
        ? await GithubDisk.listFiles(userId, parentId)
        : await Drive.listFiles(token, parentId);
    state.treeChildren[key] = files.map((f) => ({
      id: f.id,
      name: f.name,
      isFolder: f.isFolder,
      icon: f.icon,
      webViewLink: f.webViewLink,
      mimeType: f.mimeType,
      parents: f.parents || [],
      typeName: f.typeName,
      sizeFormatted: f.sizeFormatted,
      dateFormatted: f.dateFormatted,
    }));
    if (!state.treeVisibleCount[key]) {
      state.treeVisibleCount[key] = TREE_PAGE_SIZE;
    }
    return state.treeChildren[key];
  }

  function showMoreTreeItems(key) {
    const total = state.treeChildren[key]?.length || 0;
    const current = state.treeVisibleCount[key] || TREE_PAGE_SIZE;
    state.treeVisibleCount[key] = Math.min(current + TREE_PAGE_SIZE, total);
    renderSidebarTree();
  }

  function findTreeItem(userId, itemId) {
    for (const key of Object.keys(state.treeChildren)) {
      if (!key.startsWith(`${userId}:`)) continue;
      const item = state.treeChildren[key].find((i) => i.id === itemId);
      if (item) return item;
    }
    return null;
  }

  function findTreeFile(userId, fileId) {
    return findTreeItem(userId, fileId);
  }

  async function syncTreeWithCurrentPath(userId, token) {
    if (state.section !== 'my-drive') return;

    const rootId = LocalDisk.isLocalId(userId)
      ? LocalDisk.ROOT_ID
      : GithubDisk.isGithubId(userId)
        ? GithubDisk.ROOT_ID
        : Drive.ROOT_ID;
    state.expandedUsers.add(userId);
    state.expandedFolders.add(folderKey(userId, rootId));
    await loadTreeChildren(userId, token, rootId);

    if (state.currentFolderId === rootId) return;

    const path = LocalDisk.isLocalId(userId)
      ? await LocalDisk.getFolderPath(userId, state.currentFolderId)
      : GithubDisk.isGithubId(userId)
        ? await GithubDisk.getFolderPath(userId, state.currentFolderId)
        : await Drive.getFolderPath(token, state.currentFolderId);
    for (const crumb of path) {
      await loadTreeChildren(userId, token, crumb.id);
      if (crumb.id !== rootId) {
        state.expandedFolders.add(folderKey(userId, crumb.id));
      }
    }
  }

  function renderTreeMoreButton(key, container) {
    const total = state.treeChildren[key]?.length || 0;
    const limit = state.treeVisibleCount[key] || TREE_PAGE_SIZE;
    if (total <= limit) return;

    const li = document.createElement('li');
    li.className = 'tree-more-node';
    const row = document.createElement('div');
    row.className = 'tree-row';
    row.appendChild(createTreeSpacer());

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'sidebar-item tree-more-item';
    btn.dataset.treeMore = key;
    const remaining = total - limit;
    btn.textContent = '…';
    btn.title = `Show more (${remaining} item${remaining !== 1 ? 's' : ''})`;
    row.appendChild(btn);
    li.appendChild(row);
    container.appendChild(li);
  }

  function renderTreeNodes(userId, parentId, container) {
    const key = folderKey(userId, parentId);
    const items = state.treeChildren[key] || [];
    const limit = state.treeVisibleCount[key] || TREE_PAGE_SIZE;
    const visible = items.slice(0, limit);

    visible.forEach((item) => {
      if (item.isFolder) {
        const expanded = isFolderExpanded(userId, item.id);
        const li = document.createElement('li');
        li.className = 'tree-folder-node' + (expanded ? '' : ' collapsed');

        const row = document.createElement('div');
        row.className = 'tree-row';

        const toggle = createTreeToggle({
          type: 'folder',
          userId,
          folderId: item.id,
          expanded,
        });

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'sidebar-item tree-folder-item';
        btn.dataset.nav = folderNavId(userId, item.id);
        btn.innerHTML = `
          <span class="sidebar-icon">📁</span>
          <span class="tree-folder-label">${escapeHtml(item.name)}</span>
        `;

        row.appendChild(toggle);
        row.appendChild(btn);
        bindDragDropForTreeItem(btn, { ...item, isFolder: true }, userId);
        addTreeMoreButton(row, () => ({
          type: 'folder',
          file: { ...item, isFolder: true },
          userId,
          folderId: item.id,
          section: 'my-drive',
        }));
        li.appendChild(row);

        const childUl = document.createElement('ul');
        childUl.className = 'tree-children tree-level-folder';
        if (expanded) {
          renderTreeNodes(userId, item.id, childUl);
        }
        li.appendChild(childUl);
        container.appendChild(li);
        return;
      }

      const li = document.createElement('li');
      li.className = 'tree-file-node';
      const row = document.createElement('div');
      row.className = 'tree-row';
      row.appendChild(createTreeSpacer());

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'sidebar-item tree-file-item';
      btn.dataset.nav = `file|${userId}|${item.id}`;
      btn.innerHTML = `
        <span class="sidebar-icon">${renderFileIcon(item, 'file-icon-wrap--tiny')}</span>
        <span class="tree-file-label">${escapeHtml(item.name)}</span>
      `;
      row.appendChild(btn);
      bindDragDropForTreeItem(btn, item, userId);
      addTreeMoreButton(row, () => ({
        type: 'file',
        file: item,
        userId,
        folderId: item.parentId || item.parents?.[0] || (LocalDisk.isLocalId(userId) ? LocalDisk.ROOT_ID : GithubDisk.isGithubId(userId) ? GithubDisk.ROOT_ID : Drive.ROOT_ID),
        section: 'my-drive',
      }));
      li.appendChild(row);
      container.appendChild(li);
    });

    renderTreeMoreButton(key, container);
  }

  function renderSidebarTree() {
    ContextMenu.hide();
    const rootNode = $('#tree-root-node');
    rootNode.classList.toggle('collapsed', !state.expandedRoot);
    rootNode.querySelector('[data-tree-toggle="root"]')?.setAttribute(
      'aria-expanded',
      String(state.expandedRoot)
    );

    const list = $('#sidebar-tree-users');
    list.innerHTML = '';

    const users = Auth.getUsers();

    users.forEach((user) => {
      const expanded = isUserExpanded(user.id);
      const userNav = `user:${user.id}`;

      const li = document.createElement('li');
      li.className = 'tree-user-node' + (expanded ? '' : ' collapsed');

      const row = document.createElement('div');
      row.className = 'tree-row';

      const toggle = createTreeToggle({
        type: 'user',
        userId: user.id,
        expanded,
      });

      const userBtn = document.createElement('button');
      userBtn.type = 'button';
      userBtn.className = 'sidebar-item user-drive-item tree-user-btn';
      userBtn.dataset.nav = userNav;

      const img = document.createElement('img');
      img.className = 'sidebar-user-avatar avatar-img';
      img.alt = userLabel(user);
      img.src = Auth.getAvatarUrl(user.picture);
      Auth.applyAvatarFallback(img);

      const info = document.createElement('div');
      info.className = 'tree-user-info';

      const label = document.createElement('span');
      label.className = 'sidebar-user-label';
      label.textContent = userLabel(user);

      const quota = document.createElement('span');
      quota.className = 'tree-user-quota';
      quota.dataset.userId = user.id;
      quota.dataset.reauthUser = user.id;
      quota.textContent = getQuotaLabel(user.id);
      if (state.userQuotas[user.id]?.needsReauth) {
        quota.classList.add('tree-user-quota-reauth');
      }

      info.appendChild(label);
      info.appendChild(quota);
      userBtn.appendChild(img);
      userBtn.appendChild(info);
      attachDropTarget(userBtn, () => ({
        destUserId: user.id,
        destParentId: Drive.ROOT_ID,
      }));
      row.appendChild(toggle);
      row.appendChild(userBtn);
      addTreeMoreButton(row, () => ({ type: 'user', userId: user.id, user }));

      const children = document.createElement('ul');
      children.className = 'tree-children tree-level-2';

      USER_SECTIONS.forEach((section) => {
        const sectionLi = document.createElement('li');
        sectionLi.className = 'tree-section-node';

        if (section.id === 'my-drive') {
          const myDriveExpanded = isFolderExpanded(user.id, Drive.ROOT_ID);
          sectionLi.classList.toggle('collapsed', !myDriveExpanded);

          const sectionRow = document.createElement('div');
          sectionRow.className = 'tree-row';

          const sectionToggle = createTreeToggle({
            type: 'my-drive',
            userId: user.id,
            folderId: Drive.ROOT_ID,
            expanded: myDriveExpanded,
          });

          const sectionBtn = document.createElement('button');
          sectionBtn.type = 'button';
          sectionBtn.className = 'sidebar-item tree-child-item';
          sectionBtn.dataset.nav = `user:${user.id}:my-drive`;
          sectionBtn.innerHTML = `
            <span class="sidebar-icon">${section.icon}</span>
            <span>${section.label}</span>
          `;

          sectionRow.appendChild(sectionToggle);
          sectionRow.appendChild(sectionBtn);
          sectionLi.appendChild(sectionRow);

          const folderTree = document.createElement('ul');
          folderTree.className = 'tree-children tree-level-3';
          if (myDriveExpanded) {
            renderTreeNodes(user.id, Drive.ROOT_ID, folderTree);
          }
          sectionLi.appendChild(folderTree);
        } else {
          const sectionRow = document.createElement('div');
          sectionRow.className = 'tree-row';
          sectionRow.appendChild(createTreeSpacer());

          const sectionBtn = document.createElement('button');
          sectionBtn.type = 'button';
          sectionBtn.className = 'sidebar-item tree-child-item';
          sectionBtn.dataset.nav = `user:${user.id}:${section.id}`;
          sectionBtn.innerHTML = `
            <span class="sidebar-icon">${section.icon}</span>
            <span>${section.label}</span>
          `;

          sectionRow.appendChild(sectionBtn);
          sectionLi.appendChild(sectionRow);
        }

        children.appendChild(sectionLi);
      });

      li.appendChild(row);
      li.appendChild(children);
      list.appendChild(li);
    });

    LocalDisk.getDisks().forEach((disk) => {
      const expanded = isUserExpanded(disk.id);
      const diskNav = `disk:${toDiskNavId(disk.id)}`;

      const li = document.createElement('li');
      li.className = 'tree-user-node tree-local-node' + (expanded ? '' : ' collapsed');

      const row = document.createElement('div');
      row.className = 'tree-row';

      const toggle = createTreeToggle({
        type: 'local-disk',
        userId: disk.id,
        expanded,
      });

      const diskBtn = document.createElement('button');
      diskBtn.type = 'button';
      diskBtn.className = 'sidebar-item local-drive-item tree-user-btn';
      diskBtn.dataset.nav = diskNav;

      const icon = document.createElement('span');
      icon.className = 'sidebar-icon local-storage-icon-wrap';
      icon.innerHTML = renderLocalStorageIcon();

      const info = document.createElement('div');
      info.className = 'tree-user-info';

      const label = document.createElement('span');
      label.className = 'sidebar-user-label';
      label.textContent = disk.name;

      const quota = document.createElement('span');
      quota.className = 'tree-user-quota';
      quota.dataset.userId = disk.id;
      quota.textContent = getQuotaLabel(disk.id);

      info.appendChild(label);
      info.appendChild(quota);
      diskBtn.appendChild(icon);
      diskBtn.appendChild(info);
      attachDropTarget(diskBtn, () => ({
        destUserId: disk.id,
        destParentId: LocalDisk.ROOT_ID,
      }));
      row.appendChild(toggle);
      row.appendChild(diskBtn);
      addTreeMoreButton(row, () => ({ type: 'local-disk', diskId: disk.id, disk }));

      const children = document.createElement('ul');
      children.className = 'tree-children tree-level-2';

      LOCAL_DISK_SECTIONS.forEach((section) => {
        const sectionLi = document.createElement('li');
        sectionLi.className = 'tree-section-node';

        if (section.id === 'my-drive') {
          const myDriveExpanded = isFolderExpanded(disk.id, LocalDisk.ROOT_ID);
          sectionLi.classList.toggle('collapsed', !myDriveExpanded);

          const sectionRow = document.createElement('div');
          sectionRow.className = 'tree-row';

          const sectionToggle = createTreeToggle({
            type: 'my-drive',
            userId: disk.id,
            folderId: LocalDisk.ROOT_ID,
            expanded: myDriveExpanded,
          });

          const sectionBtn = document.createElement('button');
          sectionBtn.type = 'button';
          sectionBtn.className = 'sidebar-item tree-child-item';
          sectionBtn.dataset.nav = `${diskNav}:my-drive`;
          sectionBtn.innerHTML = `
            <span class="sidebar-icon">${section.icon}</span>
            <span>${section.label}</span>
          `;

          sectionRow.appendChild(sectionToggle);
          sectionRow.appendChild(sectionBtn);
          sectionLi.appendChild(sectionRow);

          const folderTree = document.createElement('ul');
          folderTree.className = 'tree-children tree-level-3';
          if (myDriveExpanded) {
            renderTreeNodes(disk.id, LocalDisk.ROOT_ID, folderTree);
          }
          sectionLi.appendChild(folderTree);
        } else {
          const sectionRow = document.createElement('div');
          sectionRow.className = 'tree-row';
          sectionRow.appendChild(createTreeSpacer());

          const sectionBtn = document.createElement('button');
          sectionBtn.type = 'button';
          sectionBtn.className = 'sidebar-item tree-child-item';
          sectionBtn.dataset.nav = `${diskNav}:${section.id}`;
          sectionBtn.innerHTML = `
            <span class="sidebar-icon">${section.icon}</span>
            <span>${section.label}</span>
          `;

          sectionRow.appendChild(sectionBtn);
          sectionLi.appendChild(sectionRow);
        }

        children.appendChild(sectionLi);
      });

      li.appendChild(row);
      li.appendChild(children);
      list.appendChild(li);
    });

    GithubDisk.getDisks().forEach((disk) => {
      const expanded = isUserExpanded(disk.id);
      const diskNav = `github:${toGithubNavId(disk.id)}`;

      const li = document.createElement('li');
      li.className = 'tree-user-node tree-local-node' + (expanded ? '' : ' collapsed');

      const row = document.createElement('div');
      row.className = 'tree-row';

      const toggle = createTreeToggle({
        type: 'github-disk',
        userId: disk.id,
        expanded,
      });

      const diskBtn = document.createElement('button');
      diskBtn.type = 'button';
      diskBtn.className = 'sidebar-item user-drive-item tree-user-btn';
      diskBtn.dataset.nav = diskNav;

      const img = document.createElement('img');
      img.className = 'sidebar-user-avatar avatar-img';
      img.alt = disk.name;
      img.src = disk.accountAvatar || Auth.getDefaultAvatarUrl();
      Auth.applyAvatarFallback(img);

      const info = document.createElement('div');
      info.className = 'tree-user-info';

      const label = document.createElement('span');
      label.className = 'sidebar-user-label';
      label.textContent = disk.name;

      const quota = document.createElement('span');
      quota.className = 'tree-user-quota';
      quota.dataset.userId = disk.id;
      quota.textContent = getQuotaLabel(disk.id);

      info.appendChild(label);
      info.appendChild(quota);
      diskBtn.appendChild(img);
      diskBtn.appendChild(info);
      attachDropTarget(diskBtn, () => ({
        destUserId: disk.id,
        destParentId: GithubDisk.ROOT_ID,
      }));
      row.appendChild(toggle);
      row.appendChild(diskBtn);
      addTreeMoreButton(row, () => ({ type: 'github-disk', diskId: disk.id, disk }));

      const children = document.createElement('ul');
      children.className = 'tree-children tree-level-2';

      GITHUB_DISK_SECTIONS.forEach((section) => {
        const sectionLi = document.createElement('li');
        sectionLi.className = 'tree-section-node';
        const myDriveExpanded = isFolderExpanded(disk.id, GithubDisk.ROOT_ID);
        sectionLi.classList.toggle('collapsed', !myDriveExpanded);

        const sectionRow = document.createElement('div');
        sectionRow.className = 'tree-row';

        const sectionToggle = createTreeToggle({
          type: 'my-drive',
          userId: disk.id,
          folderId: GithubDisk.ROOT_ID,
          expanded: myDriveExpanded,
        });

        const sectionBtn = document.createElement('button');
        sectionBtn.type = 'button';
        sectionBtn.className = 'sidebar-item tree-child-item';
        sectionBtn.dataset.nav = `${diskNav}:my-drive`;
        sectionBtn.innerHTML = `
          <span class="sidebar-icon">${section.icon}</span>
          <span>${section.label}</span>
        `;

        sectionRow.appendChild(sectionToggle);
        sectionRow.appendChild(sectionBtn);
        sectionLi.appendChild(sectionRow);

        const folderTree = document.createElement('ul');
        folderTree.className = 'tree-children tree-level-3';
        if (myDriveExpanded) {
          renderTreeNodes(disk.id, GithubDisk.ROOT_ID, folderTree);
        }
        sectionLi.appendChild(folderTree);
        children.appendChild(sectionLi);
      });

      li.appendChild(row);
      li.appendChild(children);
      list.appendChild(li);
    });

    setSidebarActive(getActiveNavId());
  }

  async function handleTreeToggle(toggle) {
    ContextMenu.hide();
    const type = toggle.dataset.treeToggle;

    if (type === 'root') {
      state.expandedRoot = !state.expandedRoot;
      renderSidebarTree();
      return;
    }

    if (type === 'user' || type === 'local-disk' || type === 'github-disk') {
      const userId = toggle.dataset.userId;
      if (state.expandedUsers.has(userId)) {
        state.expandedUsers.delete(userId);
      } else {
        state.expandedUsers.clear();
        state.expandedUsers.add(userId);
      }
      renderSidebarTree();
      return;
    }

    if (type === 'my-drive' || type === 'folder') {
      const userId = toggle.dataset.userId;
      const folderId = toggle.dataset.folderId;
      const key = folderKey(userId, folderId);

      if (state.expandedFolders.has(key)) {
        state.expandedFolders.delete(key);
        renderSidebarTree();
        return;
      }

      state.expandedFolders.add(key);
      try {
        if (LocalDisk.isLocalId(userId)) {
          await loadTreeChildren(userId, null, folderId);
        } else if (GithubDisk.isGithubId(userId)) {
          await loadTreeChildren(userId, null, folderId);
        } else {
          const token = await Auth.tryGetValidToken(userId);
          if (!token) throw new Error('Google sign-in required — right-click the Google drive in the sidebar and choose Re-login');
          await loadTreeChildren(userId, token, folderId);
        }
        renderSidebarTree();
      } catch (err) {
        state.expandedFolders.delete(key);
        showError(err.message);
      }
    }
  }

  function dedupeBreadcrumbs(crumbs) {
    return crumbs.filter((crumb, i) => i === 0 || crumb.name !== crumbs[i - 1].name);
  }

  async function buildBreadcrumbs(token, folderId, user) {
    const isLocal = LocalDisk.isLocalId(user.id);
    const isGithub = GithubDisk.isGithubId(user.id);
    const driveLabel = isLocal || isGithub ? user.name : userLabel(user);
    const driveCrumbId = isLocal || isGithub ? user.id : `user:${user.id}`;
    const rootId = isLocal ? LocalDisk.ROOT_ID : isGithub ? GithubDisk.ROOT_ID : Drive.ROOT_ID;

    if (state.section !== 'my-drive') {
      return dedupeBreadcrumbs([
        { id: ROOT_ID, name: ROOT_NAME },
        { id: driveCrumbId, name: driveLabel },
        { id: state.section, name: SECTION_LABELS[state.section] || state.section },
      ]);
    }

    const drivePath = isLocal
      ? await LocalDisk.getFolderPath(user.id, folderId)
      : isGithub
        ? await GithubDisk.getFolderPath(user.id, folderId)
        : await Drive.getFolderPath(token, folderId);
    const foldersAfterUser = folderId === rootId ? [] : drivePath.slice(1);

    return dedupeBreadcrumbs([
      { id: ROOT_ID, name: ROOT_NAME },
      { id: driveCrumbId, name: driveLabel },
      ...foldersAfterUser,
    ]);
  }

  function isMobileLayout() {
    return window.matchMedia('(max-width: 768px)').matches;
  }

  function closeSidebar() {
    $('.sidebar')?.classList.remove('open');
    $('#sidebar-overlay')?.classList.add('hidden');
    document.body.classList.remove('sidebar-open');
  }

  function openSidebar() {
    $('.sidebar')?.classList.add('open');
    $('#sidebar-overlay')?.classList.remove('hidden');
    document.body.classList.add('sidebar-open');
  }

  function toggleSidebar() {
    if ($('.sidebar')?.classList.contains('open')) closeSidebar();
    else openSidebar();
  }

  async function loadCurrentLocation() {
    if (isMobileLayout()) closeSidebar();
    setLoading(true);
    showError(null);
    state.selectedId = null;
    $('#status-selected').textContent = '';

    try {
      if (state.level === 'home') {
        renderSidebarTree();
        state.files = homeDriveItems();
        state.breadcrumbs = [{ id: ROOT_ID, name: ROOT_NAME }];
        setSidebarActive('home');
        refreshUserQuotas();
      } else {
        const userId = state.currentUserId || Auth.getActiveUser()?.id;
        if (!userId) throw new Error('No drive selected');

        if (LocalDisk.isLocalId(userId)) {
          const disk = LocalDisk.getDisk(userId);
          if (!disk) throw new Error('Local storage not found');
          state.currentUserId = userId;

          let files;
          if (state.section === 'trash') {
            files = await LocalDisk.listTrash(userId);
          } else {
            files = await LocalDisk.listFiles(userId, state.currentFolderId);
          }

          state.files = files;
          state.breadcrumbs = await buildBreadcrumbs(null, state.currentFolderId, disk);
          await syncTreeWithCurrentPath(userId, null);
          renderSidebarTree();
          refreshUserQuotas();
        } else if (GithubDisk.isGithubId(userId)) {
          const disk = GithubDisk.getDisk(userId);
          if (!disk) throw new Error('GitHub storage not found');
          state.currentUserId = userId;
          state.files = await GithubDisk.listFiles(userId, state.currentFolderId);
          state.breadcrumbs = await buildBreadcrumbs(null, state.currentFolderId, disk);
          await syncTreeWithCurrentPath(userId, null);
          renderSidebarTree();
          refreshUserQuotas();
        } else {
          const token = await Auth.tryGetValidToken(userId);
          if (!token) {
            throw new Error('Google sign-in required — right-click the Google drive in the sidebar and choose Re-login');
          }
          const user = Auth.getUsers().find((u) => u.id === userId);
          Auth.setActiveUser(userId);
          state.currentUserId = userId;

          let files;
          switch (state.section) {
            case 'shared':
              files = await Drive.listShared(token);
              break;
            case 'starred':
              files = await Drive.listStarred(token);
              break;
            case 'recent':
              files = await Drive.listRecent(token);
              break;
            case 'trash':
              files = await Drive.listTrash(token);
              break;
            default:
              files = await Drive.listFiles(token, state.currentFolderId);
          }

          state.files = files;
          state.breadcrumbs = await buildBreadcrumbs(token, state.currentFolderId, user);
          await syncTreeWithCurrentPath(userId, token);
          renderSidebarTree();
          refreshUserQuotas({ [userId]: token });
        }
      }

      renderBreadcrumbs();
      renderCurrentView();
      updateNavButtons();
    } catch (err) {
      if (!isScopeError(err.message)) {
        showError(err.message);
      }
    } finally {
      setLoading(false);
      Router.syncUrl(getUrlSegments(), urlPushPending);
      urlPushPending = false;
    }
  }

  function navigateToMyGoogle() {
    state.level = 'home';
    state.currentUserId = null;
    state.currentFolderId = Drive.ROOT_ID;
    state.section = 'my-drive';
    state.expandedUsers.clear();
    pushHistory();
    loadCurrentLocation();
  }

  function navigateToUser(userId, folderId = Drive.ROOT_ID) {
    state.level = 'drive';
    state.currentUserId = userId;
    state.currentFolderId = folderId;
    state.section = 'my-drive';
    state.expandedUsers.clear();
    state.expandedUsers.add(userId);
    Auth.setActiveUser(userId);
    pushHistory();
    loadCurrentLocation();
  }

  function navigateToLocalDisk(diskId, folderId = LocalDisk.ROOT_ID) {
    state.level = 'drive';
    state.currentUserId = diskId;
    state.currentFolderId = folderId;
    state.section = 'my-drive';
    state.expandedUsers.clear();
    state.expandedUsers.add(diskId);
    pushHistory();
    loadCurrentLocation();
  }

  function navigateToGithubDisk(diskId, folderId = GithubDisk.ROOT_ID) {
    state.level = 'drive';
    state.currentUserId = diskId;
    state.currentFolderId = folderId;
    state.section = 'my-drive';
    state.expandedUsers.clear();
    state.expandedUsers.add(diskId);
    pushHistory();
    loadCurrentLocation();
  }

  function navigateToFolder(folderId) {
    if (state.level !== 'drive') return;
    state.currentFolderId = folderId;
    state.section = 'my-drive';
    pushHistory();
    loadCurrentLocation();
  }

  function navigateBack() {
    if (state.historyIndex <= 0) return;
    state.historyIndex--;
    restoreHistory(state.history[state.historyIndex]);
    loadCurrentLocation();
  }

  function navigateForward() {
    if (state.historyIndex >= state.history.length - 1) return;
    state.historyIndex++;
    restoreHistory(state.history[state.historyIndex]);
    loadCurrentLocation();
  }

  function navigateUp() {
    if (state.level === 'home') return;

    if (state.section !== 'my-drive') {
      state.section = 'my-drive';
      state.currentFolderId = getDriveRootId();
      pushHistory();
      loadCurrentLocation();
      return;
    }

    const rootId = getDriveRootId();
    if (state.currentFolderId !== rootId) {
      const parent = state.breadcrumbs[state.breadcrumbs.length - 2];
      if (parent.id.startsWith('user:')) {
        navigateToUser(parent.id.slice(5), Drive.ROOT_ID);
      } else if (LocalDisk.getDisk(parent.id)) {
        navigateToLocalDisk(parent.id, LocalDisk.ROOT_ID);
      } else if (GithubDisk.getDisk(parent.id)) {
        navigateToGithubDisk(parent.id, GithubDisk.ROOT_ID);
      } else {
        navigateToFolder(parent.id);
      }
      return;
    }

    navigateToMyGoogle();
  }

  function switchUserSection(userId, section) {
    state.level = 'drive';
    state.currentUserId = userId;
    state.section = section;
    state.currentFolderId = LocalDisk.isLocalId(userId) ? LocalDisk.ROOT_ID : GithubDisk.isGithubId(userId) ? GithubDisk.ROOT_ID : Drive.ROOT_ID;
    state.expandedUsers.clear();
    state.expandedUsers.add(userId);
    if (!isLocalOrGithubDrive(userId)) {
      Auth.setActiveUser(userId);
    }
    pushHistory();
    loadCurrentLocation();
  }

  function handleTreeNav(nav) {
    ContextMenu.hide();
    if (nav === 'home') {
      navigateToMyGoogle();
      return;
    }

    const diskSectionMatch = nav.match(/^disk:([^:]+):(my-drive|trash)$/);
    if (diskSectionMatch) {
      switchUserSection(fromDiskNavId(diskSectionMatch[1]), diskSectionMatch[2]);
      return;
    }

    const githubSectionMatch = nav.match(/^github:([^:]+):(my-drive)$/);
    if (githubSectionMatch) {
      switchUserSection(fromGithubNavId(githubSectionMatch[1]), githubSectionMatch[2]);
      return;
    }

    const diskMatch = nav.match(/^disk:([^:]+)$/);
    if (diskMatch) {
      navigateToLocalDisk(fromDiskNavId(diskMatch[1]), LocalDisk.ROOT_ID);
      return;
    }

    const githubMatch = nav.match(/^github:([^:]+)$/);
    if (githubMatch) {
      navigateToGithubDisk(fromGithubNavId(githubMatch[1]), GithubDisk.ROOT_ID);
      return;
    }

    const folderMatch = parseFolderNav(nav);
    if (folderMatch) {
      if (LocalDisk.isLocalId(folderMatch.userId)) {
        navigateToLocalDisk(folderMatch.userId, folderMatch.folderId);
      } else if (GithubDisk.isGithubId(folderMatch.userId)) {
        navigateToGithubDisk(folderMatch.userId, folderMatch.folderId);
      } else {
        navigateToUser(folderMatch.userId, folderMatch.folderId);
      }
      return;
    }

    const fileMatch = nav.match(/^file\|([^|]+)\|(.+)$/);
    if (fileMatch) {
      const [, userId, fileId] = fileMatch;
      const file = findTreeFile(userId, fileId);
      if (file) {
        if (file.isFolder) {
          if (LocalDisk.isLocalId(userId)) navigateToLocalDisk(userId, file.id);
          else if (GithubDisk.isGithubId(userId)) navigateToGithubDisk(userId, file.id);
          else navigateToUser(userId, file.id);
        } else {
          openFile(file, userId, { fromTree: true });
        }
      }
      return;
    }

    const sectionMatch = nav.match(/^user:([^:]+):(my-drive|shared|starred|recent|trash)$/);
    if (sectionMatch) {
      switchUserSection(sectionMatch[1], sectionMatch[2]);
      return;
    }

    if (nav.startsWith('user:')) {
      navigateToUser(nav.slice(5), Drive.ROOT_ID);
    }
  }

  async function showExplorer() {
    hide($('#login-screen'));
    show($('#explorer'));

    if (!initialRouteApplied && Router.hasInitialRoute()) {
      initialRouteApplied = true;
      const segments = Router.migrateHashToPath() || Router.getInitialSegments();
      await applySegments(segments, false);
      return;
    }

    loadCurrentLocation();
  }

  function hasMountedDrives() {
    return Auth.hasUsers() || LocalDisk.getDisks().length > 0 || GithubDisk.getDisks().length > 0;
  }

  function showLogin() {
    show($('#login-screen'));
    hide($('#explorer'));
  }

  function showLoginError(msg) {
    const el = $('#login-error');
    if (msg) {
      el.textContent = msg;
      show(el);
    } else {
      el.textContent = '';
      hide(el);
    }
  }

  let fallbackLoginTimer = null;

  function cancelFallbackLogin() {
    if (fallbackLoginTimer) {
      clearTimeout(fallbackLoginTimer);
      fallbackLoginTimer = null;
    }
  }

  function getFileParentId(file, userId) {
    return file.parentId || file.parents?.[0] || (LocalDisk.isLocalId(userId) ? LocalDisk.ROOT_ID : GithubDisk.isGithubId(userId) ? GithubDisk.ROOT_ID : Drive.ROOT_ID);
  }

  const DRAG_MIME = 'application/x-mikus-drive-item';

  function getDescendantFolderIds(userId, folderId) {
    const ids = new Set([folderId]);
    const walk = (parentId) => {
      const key = folderKey(userId, parentId);
      (state.treeChildren[key] || []).forEach((child) => {
        if (child.isFolder) {
          ids.add(child.id);
          walk(child.id);
        }
      });
    };
    walk(folderId);
    return ids;
  }

  function canDropItem(payload, target) {
    const { userId: sourceUserId, parentId: sourceParentId, item } = payload;
    const { destUserId, destParentId } = target;
    if (!item || !destUserId || destParentId == null) return false;
    if (item.id === destParentId) return false;
    if (sourceUserId === destUserId && sourceParentId === destParentId && !item.isFolder) return false;
    if (item.isFolder && sourceUserId === destUserId) {
      const descendants = getDescendantFolderIds(sourceUserId, item.id);
      if (descendants.has(destParentId)) return false;
    }
    return true;
  }

  function attachDragSource(el, file, userId, parentId) {
    if (file.isUserDrive || file.isLocalDisk || file.isGithubDisk) return;
    el.draggable = true;
    el.addEventListener('dragstart', (e) => {
      const payload = {
        userId,
        parentId,
        item: {
          id: file.id,
          name: file.name,
          isFolder: !!file.isFolder,
          mimeType: file.mimeType,
          parents: file.parents,
          parentId: file.parentId,
        },
      };
      e.dataTransfer.setData(DRAG_MIME, JSON.stringify(payload));
      e.dataTransfer.effectAllowed = 'move';
      el.classList.add('drag-source');
    });
    el.addEventListener('dragend', () => {
      el.classList.remove('drag-source');
      document.querySelectorAll('.drop-target-active').forEach((node) => {
        node.classList.remove('drop-target-active');
      });
    });
  }

  function attachDropTarget(el, getTarget) {
    el.addEventListener('dragover', (e) => {
      if (![...e.dataTransfer.types].includes(DRAG_MIME)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      el.classList.add('drop-target-active');
    });
    el.addEventListener('dragleave', (e) => {
      if (!el.contains(e.relatedTarget)) el.classList.remove('drop-target-active');
    });
    el.addEventListener('drop', async (e) => {
      el.classList.remove('drop-target-active');
      if (![...e.dataTransfer.types].includes(DRAG_MIME)) return;
      e.preventDefault();
      e.stopPropagation();
      const raw = e.dataTransfer.getData(DRAG_MIME);
      if (!raw) return;
      let payload;
      try {
        payload = JSON.parse(raw);
      } catch {
        return;
      }
      const target = getTarget();
      if (!target || !canDropItem(payload, target)) return;
      await handleItemDrop(payload, target);
    });
  }

  async function handleItemDrop(payload, target) {
    if (state.level !== 'home' && state.section !== 'my-drive') {
      showError('Drag and drop is only available in My Drive.');
      return;
    }
    const { userId: sourceUserId, parentId: sourceParentId, item } = payload;
    try {
      setLoading(true);
      await ContextMenu.transferItems(
        [item],
        sourceUserId,
        sourceParentId,
        target.destUserId,
        target.destParentId,
        'cut'
      );
      showStatus(`Moved "${item.name}"`);
    } catch (err) {
      showError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function bindDragDropForWorkspaceItem(el, file) {
    if (file.isUserDrive) {
      attachDropTarget(el, () => ({
        destUserId: file.userId,
        destParentId: Drive.ROOT_ID,
      }));
      return;
    }
    if (file.isLocalDisk) {
      attachDropTarget(el, () => ({
        destUserId: file.userId,
        destParentId: LocalDisk.ROOT_ID,
      }));
      return;
    }
    if (file.isGithubDisk) {
      attachDropTarget(el, () => ({
        destUserId: file.userId,
        destParentId: GithubDisk.ROOT_ID,
      }));
      return;
    }
    if (state.section !== 'my-drive' || !state.currentUserId) return;
    const userId = state.currentUserId;
    const parentId = getFileParentId(file, userId);
    attachDragSource(el, file, userId, parentId);
    if (file.isFolder) {
      attachDropTarget(el, () => ({
        destUserId: userId,
        destParentId: file.id,
      }));
    }
  }

  function bindDragDropForTreeItem(el, file, userId) {
    const parentId = getFileParentId(file, userId);
    attachDragSource(el, file, userId, parentId);
    if (file.isFolder) {
      attachDropTarget(el, () => ({
        destUserId: userId,
        destParentId: file.id,
      }));
    }
  }

  function scheduleFallbackLogin() {
    cancelFallbackLogin();
    fallbackLoginTimer = setTimeout(() => {
      if (!hasMountedDrives()) showExplorer();
    }, 4000);
  }

  function bindEvents() {
    $('#btn-sidebar-toggle')?.addEventListener('click', toggleSidebar);
    $('#sidebar-overlay')?.addEventListener('click', closeSidebar);

    $('#btn-sign-in').addEventListener('click', () => Auth.signIn());
    $('#btn-add-user')?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const rect = e.currentTarget.getBoundingClientRect();
      ContextMenu.showAddDiskMenu(rect.left, rect.bottom + 4);
    });

    $('#btn-sign-out').addEventListener('click', () => {
      ejectAllDrives();
    });

    $('#btn-back').addEventListener('click', navigateBack);
    $('#btn-forward').addEventListener('click', navigateForward);
    $('#btn-up').addEventListener('click', navigateUp);
    $('#btn-refresh').addEventListener('click', () => {
      if (state.currentUserId) clearTreeCache(state.currentUserId);
      loadCurrentLocation();
    });

    $('#btn-copy-url').addEventListener('click', async () => {
      try {
        const url = Router.getShareableUrl(getUrlSegments());
        await navigator.clipboard.writeText(url);
        showStatus('Link copied to clipboard');
      } catch {
        showError('Failed to copy link');
      }
    });

    $('#btn-view-grid').addEventListener('click', () => setView('grid'));
    $('#btn-view-list').addEventListener('click', () => setView('list'));
    $('#btn-mobile-menu')?.addEventListener('click', (e) => {
      e.stopPropagation();
      openMobileAreaMenu();
    });

    addTreeMoreButton($('#nav-home')?.closest('.tree-row'), () => ({ type: 'root' }));

    $('.content').addEventListener('contextmenu', (e) => {
      if (e.target.closest('.file-item, .list-row, .item-more-btn')) return;
      if (state.level === 'home') {
        ContextMenu.show(e, { type: 'root' });
        return;
      }
      if (state.level !== 'drive' || !state.currentUserId) return;
      ContextMenu.show(e, {
        type: 'empty',
        userId: state.currentUserId,
        folderId: state.currentFolderId,
        section: state.section,
      });
    });

    $('.sidebar-tree-section').addEventListener('mousedown', (e) => {
      if (e.target.closest('.sidebar-add-btn')) return;
      ContextMenu.hide();
    });
    $('.sidebar-tree-section').addEventListener('focusin', () => ContextMenu.hide());

    $('.sidebar-tree-section').addEventListener('contextmenu', (e) => {
      const rootBtn = e.target.closest('.tree-root-item');
      if (rootBtn) {
        e.preventDefault();
        ContextMenu.show(e, { type: 'root' });
        return;
      }

      const localBtn = e.target.closest('.local-drive-item');
      if (localBtn) {
        e.preventDefault();
        const diskMatch = localBtn.dataset.nav?.match(/^disk:([^:]+)$/);
        if (diskMatch) {
          const disk = LocalDisk.getDisk(fromDiskNavId(diskMatch[1]));
          if (disk) {
            ContextMenu.show(e, { type: 'local-disk', diskId: disk.id, disk });
          }
        }
        return;
      }

      const githubBtn = e.target.closest('.tree-user-btn[data-nav^="github:"]');
      if (githubBtn) {
        e.preventDefault();
        const diskMatch = githubBtn.dataset.nav?.match(/^github:([^:]+)$/);
        if (diskMatch) {
          const disk = GithubDisk.getDisk(fromGithubNavId(diskMatch[1]));
          if (disk) {
            ContextMenu.show(e, { type: 'github-disk', diskId: disk.id, disk });
          }
        }
        return;
      }

      const userBtn = e.target.closest('.tree-user-btn');
      if (userBtn) {
        e.preventDefault();
        const userId = userBtn.dataset.nav?.slice(5);
        const user = Auth.getUsers().find((u) => u.id === userId);
        if (user) {
          ContextMenu.show(e, { type: 'user', userId: user.id, user });
        }
        return;
      }

      const folderBtn = e.target.closest('.tree-folder-item');
      const fileBtn = e.target.closest('.tree-file-item');
      if (!folderBtn && !fileBtn) return;
      e.preventDefault();

      const nav = (folderBtn || fileBtn).dataset.nav;
      const folderMatch = parseFolderNav(nav);
      const fileMatch = nav?.match(/^file\|([^|]+)\|(.+)$/);

      if (folderMatch) {
        const { userId, folderId } = folderMatch;
        const item = findTreeItem(userId, folderId);
        if (item) {
          ContextMenu.show(e, {
            type: 'folder',
            file: { ...item, isFolder: true },
            userId,
            folderId,
            section: 'my-drive',
          });
        }
        return;
      }

      if (fileMatch) {
        const [, userId, fileId] = fileMatch;
        const file = findTreeItem(userId, fileId);
        if (file) {
          ContextMenu.show(e, {
            type: 'file',
            file,
            userId,
            folderId: file.parentId || file.parents?.[0] || (LocalDisk.isLocalId(userId) ? LocalDisk.ROOT_ID : GithubDisk.isGithubId(userId) ? GithubDisk.ROOT_ID : Drive.ROOT_ID),
            section: 'my-drive',
          });
        }
      }
    });

    $('.sidebar-tree-section').addEventListener('click', async (e) => {
      const reauthEl = e.target.closest('.tree-user-quota-reauth');
      if (reauthEl?.dataset.reauthUser) {
        e.preventDefault();
        const userId = reauthEl.dataset.reauthUser;
        Auth.setActiveUser(userId);
        renderSidebarTree();
        Auth.refreshTokenInteractive(userId)
          .then(() => {
            refreshUserQuotas();
            const user = Auth.getUsers().find((u) => u.id === userId);
            showStatus(`Signed in as ${userLabel(user)}`);
          })
          .catch((err) => showError(err.message));
        return;
      }

      const moreBtn = e.target.closest('[data-tree-more]');
      if (moreBtn) {
        e.preventDefault();
        showMoreTreeItems(moreBtn.dataset.treeMore);
        return;
      }

      const toggle = e.target.closest('[data-tree-toggle]');
      if (toggle) {
        e.preventDefault();
        e.stopPropagation();
        handleTreeToggle(toggle);
        return;
      }

      const navBtn = e.target.closest('[data-nav]');
      if (navBtn?.dataset.nav) {
        handleTreeNav(navBtn.dataset.nav);
      }
    });

    document.addEventListener('keydown', (e) => {
      if (!$('#explorer') || $('#explorer').classList.contains('hidden')) return;
      const file = getSelectedFile();
      const ctx = file && !file.isUserDrive && !file.isLocalDisk && !file.isGithubDisk ? buildFileContext(file) : null;

      if (e.ctrlKey || e.metaKey) {
        if (e.key === 'c' && ctx) {
          e.preventDefault();
          ContextMenu.runAction('copy', ctx);
        }
        if (e.key === 'x' && ctx && state.section === 'my-drive') {
          e.preventDefault();
          ContextMenu.runAction('cut', ctx);
        }
        if (e.key === 'v' && state.level === 'drive' && state.section === 'my-drive') {
          e.preventDefault();
          ContextMenu.runAction('paste', {
            type: 'empty',
            userId: state.currentUserId,
            folderId: state.currentFolderId,
            section: state.section,
          });
        }
      }

      if (!ctx) return;

      if (e.key === 'F2' && state.section === 'my-drive') {
        e.preventDefault();
        ContextMenu.runAction('rename', ctx);
      }
      if (e.key === 'Delete') {
        e.preventDefault();
        const action = state.section === 'trash' ? 'delete-forever' : 'delete';
        if (state.section === 'my-drive' || state.section === 'trash') {
          ContextMenu.runAction(action, ctx);
        }
      }
    });
  }

  function getSelectedFile() {
    return state.files.find((f) => f.id === state.selectedId);
  }

  async function init() {
    Dialog.init();
    LocalUser.init();
    try {
      await LocalDisk.init();
    } catch (err) {
      showError(err.message);
    }
    GithubDisk.init();

    ContextMenu.init({
      openFile,
      navigateToUser,
      navigateToLocalDisk,
      navigateToGithubDisk,
      navigateToMyGoogle,
      refresh: () => loadCurrentLocation(),
      refreshUserQuotas,
      clearTreeCache,
      showError,
      showStatus,
      signOutUser,
      ejectLocalDisk,
      ejectGithubDisk,
      ejectAllDrives,
      signOutAll: () => {
        ejectAllDrives();
      },
      getUserQuota: (userId) => state.userQuotas[userId] || null,
      setUserQuota: (userId, quota) => {
        state.userQuotas[userId] = quota;
      },
    });

    Router.init(async (segments) => {
      if (!$('#explorer') || $('#explorer').classList.contains('hidden')) return;
      if (Router.segmentsEqual(segments, getUrlSegments())) return;
      await applySegments(segments, false);
    });

    bindEvents();

    if (isMobileLayout()) state.view = 'list';

    if (CONFIG.CLIENT_ID === 'YOUR_CLIENT_ID.apps.googleusercontent.com') {
      $('#btn-sign-in').disabled = true;
      document.querySelector('.login-hint').textContent =
        'Set your OAuth Client ID in js/config.js (see README.md).';
    }

    Auth.init((result) => {
      if (result.success) {
        cancelFallbackLogin();
        showLoginError(null);
        LocalUser.seedFromGoogleIfNeeded();
        showExplorer();
        renderSidebarTree();
        refreshUserQuotas();
        return;
      }

      if (result.error) {
        cancelFallbackLogin();
        if (hasMountedDrives()) {
          showExplorer();
        } else {
          showExplorer();
          const silentErrors = ['popup_closed_by_user', 'access_denied', 'interaction_required'];
          if (!silentErrors.includes(result.error)) {
            showError(`Sign-in failed: ${result.error}`);
          }
        }
        return;
      }

      if (result.initialized) {
        LocalUser.seedFromGoogleIfNeeded();
        showExplorer();
      }
    });
  }

  return { init };
})();

document.addEventListener('DOMContentLoaded', () => {
  App.init().catch((err) => console.error(err));
});
