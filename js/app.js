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

  function buildFileContext(file) {
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

  async function resolveFolderPath(token, folderNames) {
    let parentId = Drive.ROOT_ID;
    for (const name of folderNames) {
      const items = await Drive.listFiles(token, parentId);
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
      const token = await Auth.ensureValidToken(user.id);
      folderId = await resolveFolderPath(token, folderNames);
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

    const user = Auth.getUsers().find((u) => u.id === route.userId);
    if (!user) {
      await applyRoute({ level: 'home' }, false);
      return;
    }

    state.level = 'drive';
    state.currentUserId = route.userId;
    state.currentFolderId = route.folderId || Drive.ROOT_ID;
    state.section = route.section || 'my-drive';
    state.expandedUsers.clear();
    state.expandedUsers.add(route.userId);
    Auth.setActiveUser(route.userId);
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
    state.currentFolderId = entry.folderId || Drive.ROOT_ID;
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

  function isScopeError(message) {
    return /insufficient.*scope/i.test(message || '');
  }

  async function refreshUserQuotas(preloadedTokens = {}) {
    const users = Auth.getUsers();
    await Promise.all(
      users.map(async (user) => {
        try {
          if (user.scopes && user.scopes !== CONFIG.SCOPES) {
            throw Object.assign(new Error('Scopes outdated'), { code: 'INSUFFICIENT_SCOPES' });
          }
          const token = preloadedTokens[user.id] || await Auth.ensureValidToken(user.id);
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
      })
    );

    document.querySelectorAll('.tree-user-quota').forEach((el) => {
      const userId = el.dataset.userId;
      const quota = state.userQuotas[userId];
      el.textContent = getQuotaLabel(userId);
      el.classList.toggle('tree-user-quota-reauth', !!quota?.needsReauth);
    });

    if (state.level === 'home') {
      state.files = usersAsFileItems();
      renderCurrentView();
    }
  }

  function signOutUser(userId) {
    Auth.removeUser(userId);
    delete state.userQuotas[userId];
    clearTreeCache(userId);
    state.expandedUsers.delete(userId);

    if (state.currentUserId === userId) {
      state.currentUserId = null;
      if (Auth.hasUsers()) {
        navigateToMyGoogle();
      } else {
        showLogin();
      }
      return;
    }

    renderSidebarTree();
    if (state.level === 'home') {
      state.files = usersAsFileItems();
      renderCurrentView();
    }
  }

  function renderUserAvatar(picture, className) {
    const src = escapeHtml(Auth.getAvatarUrl(picture));
    return `<img src="${src}" alt="" class="${className}" onerror="this.onerror=null;this.src='${Auth.DEFAULT_AVATAR}'" />`;
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
    } else if (crumb.id.startsWith('user:')) {
      navigateToUser(crumb.id.slice(5), Drive.ROOT_ID);
    } else if (crumb.id === Drive.ROOT_ID) {
      navigateToUser(state.currentUserId, Drive.ROOT_ID);
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
      return renderUserAvatar(file.picture, 'user-drive-avatar');
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
      const quotaHtml = file.isUserDrive
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
      grid.appendChild(item);
    });
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
      body.appendChild(row);
    });
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

  function openFile(file) {
    if (file.isUserDrive) {
      navigateToUser(file.userId, Drive.ROOT_ID);
    } else if (file.isFolder && state.section !== 'trash') {
      navigateToFolder(file.id);
    } else if (Drive.isNotepadFile(file) && state.section === 'my-drive' && state.currentUserId) {
      Notepad.openInTab(file, state.currentUserId).catch(showError);
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

  function getActiveNavId() {
    if (state.level === 'home') return 'home';
    if (!state.currentUserId) return 'home';
    if (state.section === 'my-drive') {
      if (state.currentFolderId !== Drive.ROOT_ID) {
        return `folder:${state.currentUserId}:${state.currentFolderId}`;
      }
      return `user:${state.currentUserId}:my-drive`;
    }
    return `user:${state.currentUserId}:${state.section}`;
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

    const files = await Drive.listFiles(token, parentId);
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

    state.expandedUsers.add(userId);
    state.expandedFolders.add(folderKey(userId, Drive.ROOT_ID));
    await loadTreeChildren(userId, token, Drive.ROOT_ID);

    if (state.currentFolderId === Drive.ROOT_ID) return;

    const path = await Drive.getFolderPath(token, state.currentFolderId);
    for (const crumb of path) {
      await loadTreeChildren(userId, token, crumb.id);
      if (crumb.id !== Drive.ROOT_ID) {
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
        btn.dataset.nav = `folder:${userId}:${item.id}`;
        btn.innerHTML = `
          <span class="sidebar-icon">📁</span>
          <span class="tree-folder-label">${escapeHtml(item.name)}</span>
        `;

        row.appendChild(toggle);
        row.appendChild(btn);
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
      btn.dataset.nav = `file:${userId}:${item.id}`;
      btn.innerHTML = `
        <span class="sidebar-icon">${renderFileIcon(item, 'file-icon-wrap--tiny')}</span>
        <span class="tree-file-label">${escapeHtml(item.name)}</span>
      `;
      row.appendChild(btn);
      addTreeMoreButton(row, () => ({
        type: 'file',
        file: item,
        userId,
        folderId: item.parents?.[0] || Drive.ROOT_ID,
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
      img.className = 'sidebar-user-avatar';
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

      const logoutLi = document.createElement('li');
      const logoutRow = document.createElement('div');
      logoutRow.className = 'tree-row';
      logoutRow.appendChild(createTreeSpacer());
      const logoutBtn = document.createElement('button');
      logoutBtn.type = 'button';
      logoutBtn.className = 'sidebar-item tree-logout-item';
      logoutBtn.dataset.logoutUser = user.id;
      logoutBtn.innerHTML = '<span class="sidebar-icon">🚪</span><span>Sign out</span>';
      logoutRow.appendChild(logoutBtn);
      logoutLi.appendChild(logoutRow);
      children.appendChild(logoutLi);

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

    if (type === 'user') {
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
        const token = await Auth.ensureValidToken(userId);
        await loadTreeChildren(userId, token, folderId);
        renderSidebarTree();
      } catch (err) {
        state.expandedFolders.delete(key);
        showError(err.message);
      }
    }
  }

  function updateActiveUserFooter() {
    const user = Auth.getActiveUser();
    const footer = $('#sidebar-user-footer');
    if (!user) {
      hide(footer);
      return;
    }
    show(footer);
    const avatar = $('#user-avatar');
    avatar.src = Auth.getAvatarUrl(user.picture);
    avatar.alt = userLabel(user);
    Auth.applyAvatarFallback(avatar);
    $('#user-name').textContent = userLabel(user);
  }

  function dedupeBreadcrumbs(crumbs) {
    return crumbs.filter((crumb, i) => i === 0 || crumb.name !== crumbs[i - 1].name);
  }

  async function buildBreadcrumbs(token, folderId, user) {
    if (state.section !== 'my-drive') {
      return dedupeBreadcrumbs([
        { id: ROOT_ID, name: ROOT_NAME },
        { id: `user:${user.id}`, name: userLabel(user) },
        { id: state.section, name: SECTION_LABELS[state.section] || state.section },
      ]);
    }

    const drivePath = await Drive.getFolderPath(token, folderId);
    const foldersAfterUser = folderId === Drive.ROOT_ID ? [] : drivePath.slice(1);

    return dedupeBreadcrumbs([
      { id: ROOT_ID, name: ROOT_NAME },
      { id: `user:${user.id}`, name: userLabel(user) },
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
    updateActiveUserFooter();

    try {
      if (state.level === 'home') {
        renderSidebarTree();
        state.files = usersAsFileItems();
        state.breadcrumbs = [{ id: ROOT_ID, name: ROOT_NAME }];
        setSidebarActive('home');
        refreshUserQuotas();
      } else {
        const userId = state.currentUserId || Auth.getActiveUser()?.id;
        if (!userId) throw new Error('No user selected');

        const token = await Auth.ensureValidToken(userId);
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
      state.currentFolderId = Drive.ROOT_ID;
      pushHistory();
      loadCurrentLocation();
      return;
    }

    if (state.currentFolderId !== Drive.ROOT_ID) {
      const parent = state.breadcrumbs[state.breadcrumbs.length - 2];
      if (parent.id.startsWith('user:')) {
        navigateToUser(parent.id.slice(5), Drive.ROOT_ID);
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
    state.currentFolderId = Drive.ROOT_ID;
    state.expandedUsers.clear();
    state.expandedUsers.add(userId);
    Auth.setActiveUser(userId);
    pushHistory();
    loadCurrentLocation();
  }

  function handleTreeNav(nav) {
    ContextMenu.hide();
    if (nav === 'home') {
      navigateToMyGoogle();
      return;
    }

    const folderMatch = nav.match(/^folder:([^:]+):(.+)$/);
    if (folderMatch) {
      navigateToUser(folderMatch[1], folderMatch[2]);
      return;
    }

    const fileMatch = nav.match(/^file:([^:]+):(.+)$/);
    if (fileMatch) {
      const file = findTreeFile(fileMatch[1], fileMatch[2]);
      if (file?.webViewLink) window.open(file.webViewLink, '_blank');
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

  function scheduleFallbackLogin() {
    cancelFallbackLogin();
    fallbackLoginTimer = setTimeout(() => {
      if (!Auth.hasUsers()) showLogin();
    }, 4000);
  }

  function bindEvents() {
    $('#btn-sidebar-toggle')?.addEventListener('click', toggleSidebar);
    $('#sidebar-overlay')?.addEventListener('click', closeSidebar);

    $('#btn-sign-in').addEventListener('click', () => Auth.signIn());
    $('#btn-add-user').addEventListener('click', () => Auth.addUser());

    $('#btn-sign-out').addEventListener('click', () => {
      Auth.signOutAll();
      showLogin();
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

    $('.sidebar-tree-section').addEventListener('mousedown', () => ContextMenu.hide());
    $('.sidebar-tree-section').addEventListener('focusin', () => ContextMenu.hide());

    $('.sidebar-tree-section').addEventListener('contextmenu', (e) => {
      const rootBtn = e.target.closest('.tree-root-item');
      if (rootBtn) {
        e.preventDefault();
        ContextMenu.show(e, { type: 'root' });
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
      const folderMatch = nav?.match(/^folder:([^:]+):(.+)$/);
      const fileMatch = nav?.match(/^file:([^:]+):(.+)$/);

      if (folderMatch) {
        const [, userId, folderId] = folderMatch;
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
            folderId: file.parents?.[0] || Drive.ROOT_ID,
            section: 'my-drive',
          });
        }
      }
    });

    $('.sidebar-tree-section').addEventListener('click', (e) => {
      const logoutBtn = e.target.closest('[data-logout-user]');
      if (logoutBtn) {
        e.preventDefault();
        signOutUser(logoutBtn.dataset.logoutUser);
        return;
      }

      const reauthEl = e.target.closest('.tree-user-quota-reauth');
      if (reauthEl?.dataset.reauthUser) {
        e.preventDefault();
        Auth.reauthorizeUser(reauthEl.dataset.reauthUser);
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
      const ctx = file && !file.isUserDrive ? buildFileContext(file) : null;

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

  function init() {
    ContextMenu.init({
      openFile,
      navigateToUser,
      navigateToMyGoogle,
      refresh: () => loadCurrentLocation(),
      refreshUserQuotas,
      clearTreeCache,
      showError,
      showStatus,
      signOutUser,
      signOutAll: () => {
        Auth.signOutAll();
        showLogin();
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
        showExplorer();
        refreshUserQuotas();
        return;
      }

      if (result.error) {
        cancelFallbackLogin();
        if (Auth.hasUsers()) {
          showExplorer();
        } else {
          showLogin();
          const silentErrors = ['popup_closed_by_user', 'access_denied', 'interaction_required'];
          if (!silentErrors.includes(result.error)) {
            showLoginError(`Sign-in failed: ${result.error}`);
          }
        }
        return;
      }

      if (result.initialized) {
        if (Auth.hasUsers()) {
          showExplorer();
          if (Auth.needsScopeUpgrade()) {
            const user = Auth.getActiveUser();
            if (user) Auth.reauthorizeUser(user.id);
          } else {
            Auth.trySilentSignIn();
          }
        } else {
          showLogin();
        }
      }
    });
  }

  return { init };
})();

document.addEventListener('DOMContentLoaded', App.init);
