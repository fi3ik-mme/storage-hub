const ContextMenu = (() => {
  const NEW_FILE_TYPES = [
    { type: 'txt', label: 'Text document (.txt)', icon: '📝', ext: '.txt', mimeType: 'text/plain', content: '', defaultName: 'New Text Document.txt' },
    { type: 'json', label: 'JSON (.json)', icon: '{ }', ext: '.json', mimeType: 'application/json', content: '{\n  \n}\n', defaultName: 'New JSON.json' },
  ];

  const NEW_GOOGLE_TYPES = [
    { type: 'gdoc', label: 'Google Docs', icon: '📄', mimeType: 'application/vnd.google-apps.document', defaultName: 'Untitled document' },
    { type: 'gsheet', label: 'Google Sheets', icon: '📊', mimeType: 'application/vnd.google-apps.spreadsheet', defaultName: 'Untitled spreadsheet' },
    { type: 'gslides', label: 'Google Slides', icon: '📽️', mimeType: 'application/vnd.google-apps.presentation', defaultName: 'Untitled presentation' },
    { type: 'gform', label: 'Google Form', icon: '📋', mimeType: 'application/vnd.google-apps.form', defaultName: 'Untitled form' },
    { type: 'gdrawing', label: 'Google Drawing', icon: '🎨', mimeType: 'application/vnd.google-apps.drawing', defaultName: 'Untitled drawing' },
    { type: 'gsite', label: 'Google Site', icon: '🌐', mimeType: 'application/vnd.google-apps.site', defaultName: 'Untitled site' },
  ];

  function getFileTypeDef(fileType) {
    return NEW_FILE_TYPES.find((t) => t.type === fileType)
      || NEW_GOOGLE_TYPES.find((t) => t.type === fileType);
  }

  function getClipboardSourceLabel() {
    if (!clipboard?.userId) return null;
    if (LocalDisk.isLocalId(clipboard.userId)) {
      return LocalDisk.getDisk(clipboard.userId)?.name || 'Local storage';
    }
    if (GithubDisk.isGithubId(clipboard.userId)) {
      return GithubDisk.getDisk(clipboard.userId)?.name || 'GitHub storage';
    }
    const user = Auth.getUsers().find((u) => u.id === clipboard.userId);
    return user ? Auth.formatDisplayEmail(user.email) : null;
  }

  const USER_SERVICE_LINKS = [
    { label: 'Gmail', icon: '📧', url: (email) => `https://mail.google.com/mail/?authuser=${encodeURIComponent(email)}` },
    { label: 'Contacts', icon: '👤', url: (email) => `https://contacts.google.com/?authuser=${encodeURIComponent(email)}` },
    { label: 'Calendar', icon: '📅', url: (email) => `https://calendar.google.com/calendar/?authuser=${encodeURIComponent(email)}` },
    { label: 'Google Drive', icon: '📁', url: (email) => `https://drive.google.com/?authuser=${encodeURIComponent(email)}` },
    { label: 'Photos', icon: '🖼️', url: (email) => `https://photos.google.com/?authuser=${encodeURIComponent(email)}` },
    { label: 'Keep', icon: '📝', url: (email) => `https://keep.google.com/?authuser=${encodeURIComponent(email)}` },
    { label: 'Meet', icon: '🎥', url: (email) => `https://meet.google.com/?authuser=${encodeURIComponent(email)}` },
    { label: 'Chat', icon: '💬', url: (email) => `https://chat.google.com/?authuser=${encodeURIComponent(email)}` },
    { label: 'Google Account', icon: '⚙️', url: (email) => `https://myaccount.google.com/?authuser=${encodeURIComponent(email)}` },
  ];

  let menuEl = null;
  let backdropEl = null;
  let propsEl = null;
  let clipboard = null;
  let context = null;
  let app = null;

  function init(handlers) {
    app = handlers;
    menuEl = document.getElementById('context-menu');
    backdropEl = document.getElementById('context-menu-backdrop');
    propsEl = document.getElementById('props-dialog');

    document.addEventListener('click', (e) => {
      if (
        e.target.closest('#context-menu')
        || e.target.closest('#app-dialog')
        || e.target.closest('.item-more-btn')
        || e.target.closest('.sidebar-add-btn')
        || e.target.closest('[data-tree-more]')
      ) return;
      hide();
    });
    document.addEventListener('contextmenu', (e) => {
      if (!e.target.closest('#explorer')) return;
      if (e.target.closest('#context-menu')) return;
    });
    window.addEventListener('resize', hide);
    window.addEventListener('scroll', hide, true);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') hide();
    });

    backdropEl?.addEventListener('click', hide);

    menuEl?.addEventListener('click', (e) => {
      if (e.target.closest('[data-action="close-sheet"]')) {
        hide();
        return;
      }
      const btn = e.target.closest('[data-action]');
      if (!btn || btn.disabled) return;
      e.stopPropagation();
      executeAction(btn.dataset.action, btn.dataset.url, btn.dataset.fileType);
    });

    propsEl?.querySelector('.props-close')?.addEventListener('click', hideProps);
    propsEl?.addEventListener('click', (e) => {
      if (e.target === propsEl) hideProps();
    });
  }

  function hide() {
    menuEl?.classList.add('hidden');
    menuEl?.classList.remove('context-menu--sheet');
    backdropEl?.classList.add('hidden');
    document.body.classList.remove('ctx-open');
    context = null;
  }

  function hideProps() {
    propsEl?.classList.add('hidden');
  }

  function isLocalCtx(ctx = context) {
    const id = ctx?.diskId || ctx?.file?.userId || ctx?.userId;
    return LocalDisk.isLocalId(id);
  }

  function isGithubCtx(ctx = context) {
    const id = ctx?.diskId || ctx?.file?.userId || ctx?.userId;
    return GithubDisk.isGithubId(id);
  }

  function getDriveId(ctx = context) {
    return ctx?.diskId || ctx?.file?.userId || ctx?.userId;
  }

  function canEditDrive() {
    if (context?.file?.isUserDrive || context?.file?.isLocalDisk || context?.file?.isGithubDisk) return false;
    if (isLocalCtx() || isGithubCtx()) return context?.section === 'my-drive';
    return context?.section === 'my-drive' && !context?.file?.isUserDrive;
  }

  function canEditTrash() {
    return context?.section === 'trash' && !!context?.file;
  }

  function getContextUser(ctx = context) {
    if (ctx?.user) return ctx.user;
    const userId = ctx?.file?.userId || ctx?.userId;
    return Auth.getUsers().find((u) => u.id === userId) || null;
  }

  function getContextLocalDisk(ctx = context) {
    if (ctx?.disk) return ctx.disk;
    const diskId = getDriveId(ctx);
    return LocalDisk.getDisk(diskId);
  }

  function getContextGithubDisk(ctx = context) {
    if (ctx?.disk) return ctx.disk;
    const diskId = getDriveId(ctx);
    return GithubDisk.getDisk(diskId);
  }

  function buildAddDiskMenuItems() {
    return [
      { action: 'add-google-drive', label: 'Google Drive', icon: '☁️' },
      { action: 'add-local-disk', label: 'Local Storage', icon: '🗄️' },
      { action: 'add-github-repo', label: 'GitHub repo', icon: '🐙' },
    ];
  }

  function buildRootMenuItems() {
    const userCount = Auth.getUsers().length;
    const localCount = LocalDisk.getDisks().length;
    const githubCount = GithubDisk.getDisks().length;
    return [
      { action: 'open', label: `Open ${typeof SITE !== 'undefined' ? SITE.name : 'Mikus Drive'}`, icon: '🏠' },
      { sep: true },
      { header: 'Add storage' },
      ...buildAddDiskMenuItems(),
      {
        action: 'eject-all',
        label: 'Eject all drives',
        icon: '⏏️',
        disabled: userCount === 0 && localCount === 0 && githubCount === 0,
      },
      { sep: true },
      { action: 'root-info', label: 'General information', icon: 'ℹ️' },
      { sep: true },
      { action: 'refresh', label: 'Refresh', icon: '🔄' },
    ];
  }

  function buildLocalDiskMenuItems() {
    return [
      { action: 'open', label: 'Open My Drive', icon: '📂' },
      { sep: true },
      { action: 'local-disk-info', label: 'General information', icon: 'ℹ️' },
      { action: 'local-disk-details', label: 'Detailed information', icon: '📋' },
      { sep: true },
      { action: 'rename-local-disk', label: 'Rename', icon: '✏️' },
      { sep: true },
      { action: 'eject-local-disk', label: 'Eject (Remove)', icon: '🗑️' },
      { sep: true },
      { action: 'refresh', label: 'Refresh', icon: '🔄' },
    ];
  }

  function buildGithubDiskMenuItems() {
    return [
      { action: 'open', label: 'Open My Drive', icon: '📂' },
      { sep: true },
      { action: 'github-disk-info', label: 'General information', icon: 'ℹ️' },
      { action: 'github-disk-details', label: 'Detailed information', icon: '📋' },
      { sep: true },
      { action: 'eject-github-disk', label: 'Eject', icon: '⏏️' },
      { sep: true },
      { action: 'refresh', label: 'Refresh', icon: '🔄' },
    ];
  }

  function buildUserMenuItems(user) {
    const items = [
      { action: 'open', label: 'Open My Drive', icon: '📂' },
      { sep: true },
      { action: 'user-info', label: 'General information', icon: 'ℹ️' },
      { action: 'user-details', label: 'Detailed information', icon: '📋' },
      { sep: true },
      { header: 'Google services' },
      ...USER_SERVICE_LINKS.map((svc) => ({
        action: 'open-service',
        label: svc.label,
        icon: svc.icon,
        url: svc.url(user.email),
      })),
      { sep: true },
      { action: 'copy-email', label: 'Copy email', icon: '📎' },
      { sep: true },
      { action: 'reauth-user', label: 'Re-login', icon: '🔑' },
      { action: 'sign-out-user', label: 'Eject (Log Out)', icon: '⏏️' },
      { sep: true },
      { action: 'refresh', label: 'Refresh', icon: '🔄' },
    ];
    return items;
  }

  function buildItems() {
    const items = [];
    const file = context?.file;
    const isEmpty = context?.type === 'empty';
    const isUser = context?.type === 'user' || file?.isUserDrive;
    const isLocalDisk = context?.type === 'local-disk' || file?.isLocalDisk;
    const isGithubDisk = context?.type === 'github-disk' || file?.isGithubDisk;

    if (context?.type === 'add-disk') {
      return buildAddDiskMenuItems();
    }

    if (context?.type === 'root') {
      return buildRootMenuItems();
    }

    if (isLocalDisk) {
      const disk = getContextLocalDisk();
      return disk ? buildLocalDiskMenuItems(disk) : [{ action: 'open', label: 'Open', icon: '📂' }];
    }

    if (isGithubDisk) {
      const disk = getContextGithubDisk();
      return disk ? buildGithubDiskMenuItems(disk) : [{ action: 'open', label: 'Open', icon: '📂' }];
    }

    if (isUser) {
      const user = getContextUser();
      return user ? buildUserMenuItems(user) : [{ action: 'open', label: 'Open', icon: '📂' }];
    }

    if (!isEmpty && file) {
      items.push({ action: 'open', label: 'Open', icon: '📂' });
      if (!file.isFolder) {
        items.push({ action: 'open-tab', label: 'Open in new tab', icon: '🔗' });
      }
      items.push({ sep: true });
    }

    if (canEditDrive() && !isEmpty) {
      items.push({ action: 'cut', label: 'Cut', icon: '✂️', shortcut: 'Ctrl+X' });
      items.push({ action: 'copy', label: 'Copy', icon: '📋', shortcut: 'Ctrl+C' });
    }

    if (canEditDrive() && (isEmpty || file?.isFolder)) {
      const canPaste = clipboard?.items?.length;
      const sourceLabel = getClipboardSourceLabel();
      const crossUser = canPaste && clipboard.userId !== context.userId;
      items.push({
        action: 'paste',
        label: crossUser ? `Paste from ${sourceLabel}` : 'Paste',
        icon: '📥',
        shortcut: 'Ctrl+V',
        disabled: !canPaste,
      });
    }

    if (canEditDrive()) {
      if (!isEmpty) items.push({ sep: true });
      if (isEmpty || file?.isFolder) {
        items.push({ action: 'new-folder', label: 'New folder', icon: '📁+' });
        items.push({ sep: true });
        items.push({ header: 'New file' });
        NEW_FILE_TYPES.forEach((type) => {
          items.push({
            action: 'new-file',
            label: type.label,
            icon: type.icon,
            fileType: type.type,
          });
        });
        if (!isLocalCtx() && !isGithubCtx()) {
          items.push({ sep: true });
          items.push({ header: 'Google Workspace' });
          NEW_GOOGLE_TYPES.forEach((type) => {
            items.push({
              action: 'new-file',
              label: type.label,
              icon: type.icon,
              fileType: type.type,
            });
          });
        }
      }
      if (!isEmpty) {
        items.push({ action: 'rename', label: 'Rename', icon: '✏️', shortcut: 'F2' });
        items.push({ action: 'delete', label: 'Move to Recycle Bin', icon: '🗑️', shortcut: 'Del' });
      }
    }

    if (canEditTrash() && !isEmpty) {
      items.push({ sep: true });
      items.push({ action: 'restore', label: 'Restore', icon: '♻️' });
      items.push({ action: 'delete-forever', label: 'Delete permanently', icon: '🗑️', shortcut: 'Del' });
    }

    if (!isEmpty && file && !file.isFolder) {
      items.push({ sep: true });
      items.push({ action: 'download', label: 'Download', icon: '⬇️' });
    }

    if (!isEmpty && file?.webViewLink) {
      items.push({ action: 'copy-link', label: 'Copy link', icon: '🔗' });
    }

    if (!isEmpty && file) {
      items.push({ sep: true });
      items.push({ action: 'properties', label: 'Properties', icon: 'ℹ️' });
    }

    if (isEmpty || file) {
      items.push({ sep: true });
      items.push({ action: 'refresh', label: 'Refresh', icon: '🔄' });
    }

    return items;
  }

  function isMobileSheet() {
    return window.matchMedia('(max-width: 768px)').matches;
  }

  function getMenuTitle(ctx = context) {
    if (!ctx) return 'Actions';
    if (ctx.type === 'add-disk') return 'Add storage';
    if (ctx.type === 'root') return typeof SITE !== 'undefined' ? SITE.name : 'Mikus Drive';
    if (ctx.type === 'empty') return 'Folder actions';
    if ((ctx.type === 'local-disk' || ctx.file?.isLocalDisk) && (ctx.disk || getContextLocalDisk(ctx))) {
      return (ctx.disk || getContextLocalDisk(ctx)).name;
    }
    if ((ctx.type === 'github-disk' || ctx.file?.isGithubDisk) && (ctx.disk || getContextGithubDisk(ctx))) {
      return (ctx.disk || getContextGithubDisk(ctx)).name;
    }
    if (ctx.type === 'user' && ctx.user) return Auth.formatDisplayEmail(ctx.user.email);
    if (ctx.file?.name) return ctx.file.name;
    return 'Actions';
  }

  function renderMenuItemsHtml(items) {
    return items
      .map((item) => {
        if (item.sep) return '<div class="ctx-sep"></div>';
        if (item.header) return `<div class="ctx-header">${escapeHtml(item.header)}</div>`;
        const urlAttr = item.url ? ` data-url="${escapeHtml(item.url)}"` : '';
        const fileTypeAttr = item.fileType ? ` data-file-type="${escapeHtml(item.fileType)}"` : '';
        const shortcut = item.shortcut ? `<span class="ctx-shortcut">${item.shortcut}</span>` : '';
        return `<button type="button" class="ctx-item${item.disabled ? ' disabled' : ''}" data-action="${item.action}"${item.disabled ? ' disabled' : ''}${urlAttr}${fileTypeAttr}>
          <span class="ctx-icon">${item.icon}</span>
          <span class="ctx-label">${escapeHtml(item.label)}</span>${shortcut}
        </button>`;
      })
      .join('');
  }

  function renderMenu(x, y) {
    const items = buildItems();
    const sheet = isMobileSheet();
    const title = getMenuTitle();

    if (sheet) {
      menuEl.innerHTML = `
        <div class="ctx-sheet-header">
          <span class="ctx-sheet-title">${escapeHtml(title)}</span>
          <button type="button" class="ctx-sheet-close" data-action="close-sheet" aria-label="Close">✕</button>
        </div>
        <div class="ctx-sheet-body">${renderMenuItemsHtml(items)}</div>
      `;
      menuEl.classList.add('context-menu--sheet');
      menuEl.classList.remove('hidden');
      menuEl.style.left = '';
      menuEl.style.top = '';
      backdropEl?.classList.remove('hidden');
      document.body.classList.add('ctx-open');
      return;
    }

    menuEl.innerHTML = renderMenuItemsHtml(items);
    menuEl.classList.remove('context-menu--sheet');
    menuEl.classList.remove('hidden');
    backdropEl?.classList.add('hidden');
    document.body.classList.remove('ctx-open');

    const rect = menuEl.getBoundingClientRect();
    const maxX = window.innerWidth - rect.width - 8;
    const maxY = window.innerHeight - rect.height - 8;
    menuEl.style.left = `${Math.min(x ?? 8, maxX)}px`;
    menuEl.style.top = `${Math.min(y ?? 8, maxY)}px`;
  }

  function show(e, ctx) {
    if (e?.preventDefault) e.preventDefault();
    if (e?.stopPropagation) e.stopPropagation();
    context = ctx;
    renderMenu(e?.clientX, e?.clientY);
  }

  function showContext(ctx) {
    context = ctx;
    renderMenu(null, null);
  }

  function showAddDiskMenu(x, y) {
    context = { type: 'add-disk' };
    renderMenu(x, y);
  }

  async function getToken(ctx) {
    return Auth.ensureValidToken(ctx.userId);
  }

  function targetParentId(ctx) {
    if (ctx.type === 'empty') return ctx.folderId;
    if (ctx.file?.isFolder) return ctx.file.id;
    return ctx.folderId;
  }

  function formatDateTime(ts) {
    if (!ts) return '—';
    return new Date(ts).toLocaleString();
  }

  function buildGeneralUserRows(user) {
    const active = Auth.getActiveUser();
    return [
      { section: 'Account' },
      ['Display name', user.name],
      ['Email', user.email],
      ['Label', Auth.formatDisplayEmail(user.email)],
      ['Active in app', active?.id === user.id ? 'Yes' : 'No'],
      { section: 'Profile' },
      ['Photo', user.picture || '—'],
    ];
  }

  async function buildDetailedUserRows(user) {
    const rows = buildGeneralUserRows(user);
    const quota = await resolveUserQuota(user.id);

    rows.push(
      { section: 'Session' },
      ['User ID', user.id],
      ['Token expires', formatDateTime(user.expiresAt)],
      ['Token status', user.expiresAt > Date.now() ? 'Valid' : 'Expired'],
      ['Scopes', user.scopes || CONFIG.SCOPES],
      { section: 'Storage' },
      ['Used', quota?.usageFormatted || '—'],
      ['Limit', quota?.limitFormatted || '—'],
      ['Available', quota?.availableFormatted || '—'],
      ['Summary', quota?.label || '—']
    );

    return rows;
  }

  function formatBytes(bytes) {
    if (!bytes) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let size = bytes;
    let unit = 0;
    while (size >= 1024 && unit < units.length - 1) {
      size /= 1024;
      unit += 1;
    }
    return `${size.toFixed(unit > 0 ? 1 : 0)} ${units[unit]}`;
  }

  async function resolveUserQuota(userId) {
    let quota = app.getUserQuota?.(userId);
    if (quota && !quota.needsReauth && quota.usage != null) return quota;

    try {
      const token = await Auth.ensureValidToken(userId);
      quota = await Drive.getStorageQuota(token);
      app.setUserQuota?.(userId, quota);
      return quota;
    } catch {
      return app.getUserQuota?.(userId) || null;
    }
  }

  async function buildRootMetricsRows() {
    const users = Auth.getUsers();
    const localDisks = LocalDisk.getDisks();
    const githubDisks = GithubDisk.getDisks();
    const active = Auth.getActiveUser();
    const localProfile = LocalUser.getProfile();
    const rows = [
      { section: typeof SITE !== 'undefined' ? SITE.name : 'Mikus Drive' },
      ['Location', 'Root'],
      ['Mounted drives', String(users.length + localDisks.length + githubDisks.length)],
      ['Google drives', String(users.length)],
      ['Local storage volumes', String(localDisks.length)],
      ['GitHub storage repos', String(githubDisks.length)],
      ['Active drive', active ? Auth.formatDisplayEmail(active.email) : '—'],
      { section: 'Local profile' },
      ['Name', localProfile.name],
      ['Local storage owned', String(localDisks.length + githubDisks.length)],
      { section: 'Google drives' },
    ];

    let totalUsage = 0;
    let totalLimit = 0;
    let limitCount = 0;
    let usageCount = 0;

    for (const user of users) {
      const quota = await resolveUserQuota(user.id);
      const label = Auth.formatDisplayEmail(user.email);
      rows.push([label, quota?.label || '—']);
      if (quota?.usage != null) {
        totalUsage += quota.usage;
        usageCount += 1;
      }
      if (quota?.limit > 0) {
        totalLimit += quota.limit;
        limitCount += 1;
      }
    }

    rows.push({ section: 'Combined storage' });
    rows.push(['Drives reporting usage', `${usageCount} / ${users.length}`]);
    rows.push(['Total used', usageCount ? formatBytes(totalUsage) : '—']);

    if (limitCount > 0 && limitCount === users.length) {
      const totalFree = Math.max(0, totalLimit - totalUsage);
      rows.push(['Total capacity', formatBytes(totalLimit)]);
      rows.push(['Total free', formatBytes(totalFree)]);
      rows.push(['Summary', `${formatBytes(totalFree)} free · ${formatBytes(totalLimit)}`]);
    } else {
      rows.push(['Total capacity', '—']);
      rows.push(['Note', 'Per-drive limits differ or need re-login']);
    }

    if (localDisks.length) {
      rows.push({ section: 'Local storage' });
      for (const disk of localDisks) {
        const quota = await LocalDisk.getStorageQuota(disk.id);
        rows.push([disk.name, quota.label || '—']);
      }
    }

    if (githubDisks.length) {
      rows.push({ section: 'GitHub storage' });
      for (const disk of githubDisks) {
        const quota = await GithubDisk.getStorageQuota(disk.id);
        rows.push([disk.name, quota.label || '—']);
      }
    }

    return rows;
  }

  async function showRootProperties() {
    propsEl.querySelector('.props-title').textContent = typeof SITE !== 'undefined' ? SITE.name : 'Mikus Drive';
    propsEl.querySelector('.props-body').innerHTML = '<div class="props-loading">Loading metrics…</div>';
    propsEl.classList.remove('hidden');

    try {
      const rows = await buildRootMetricsRows();
      propsEl.querySelector('.props-body').innerHTML = renderPropsRows(rows);
    } catch (err) {
      propsEl.querySelector('.props-body').innerHTML =
        `<div class="props-error">${escapeHtml(err.message)}</div>`;
    }
  }

  async function showUserProperties(mode, ctx) {
    const user = getContextUser(ctx);
    if (!user) return;

    propsEl.querySelector('.props-title').textContent = Auth.formatDisplayEmail(user.email);
    propsEl.querySelector('.props-body').innerHTML = '<div class="props-loading">Loading…</div>';
    propsEl.classList.remove('hidden');

    try {
      const rows = mode === 'details'
        ? await buildDetailedUserRows(user)
        : buildGeneralUserRows(user);
      propsEl.querySelector('.props-body').innerHTML = renderPropsRows(rows);
    } catch (err) {
      propsEl.querySelector('.props-body').innerHTML =
        `<div class="props-error">${escapeHtml(err.message)}</div>`;
    }
  }

  async function executeAction(action, actionUrl, fileType) {
    const ctx = context;
    if (!ctx) return;
    menuEl?.classList.add('hidden');

    const file = ctx.file;
    const user = getContextUser(ctx);

    try {
      switch (action) {
        case 'open':
          if (ctx.type === 'root') {
            app.navigateToMyGoogle?.();
          } else if (ctx.type === 'local-disk' || file?.isLocalDisk) {
            app.navigateToLocalDisk?.(getDriveId(ctx));
          } else if (ctx.type === 'github-disk' || file?.isGithubDisk) {
            app.navigateToGithubDisk?.(getDriveId(ctx));
          } else if (ctx.type === 'user' || file?.isUserDrive) {
            app.navigateToUser(user?.id || file?.userId || ctx.userId);
          } else {
            app.openFile(file);
          }
          break;
        case 'add-local-disk':
          await createLocalDisk();
          break;
        case 'add-google-drive':
        case 'add-user':
          Auth.addUser();
          break;
        case 'add-github-repo':
          await createGithubDisk();
          break;
        case 'local-disk-info':
          await showLocalDiskProperties('general', ctx);
          break;
        case 'local-disk-details':
          await showLocalDiskProperties('details', ctx);
          break;
        case 'github-disk-info':
          await showGithubDiskProperties('general', ctx);
          break;
        case 'github-disk-details':
          await showGithubDiskProperties('details', ctx);
          break;
        case 'rename-local-disk': {
          const disk = getContextLocalDisk(ctx);
          if (!disk) break;
          const name = await Dialog.prompt('Name:', disk.name, { title: 'Rename local storage' });
          if (!name?.trim() || name.trim() === disk.name) break;
          await LocalDisk.renameDisk(disk.id, name.trim());
          app.refresh?.();
          app.showStatus(`Renamed to "${name.trim()}"`);
          break;
        }
        case 'eject-local-disk': {
          const disk = getContextLocalDisk(ctx);
          if (!disk) break;
          if (await Dialog.confirm(
            `Eject (Remove) "${disk.name}"? All files stored in this volume will be deleted.`,
            { title: 'Eject (Remove)', confirmLabel: 'Remove', danger: true }
          )) {
            await app.ejectLocalDisk?.(disk.id);
          }
          break;
        }
        case 'eject-github-disk': {
          const disk = getContextGithubDisk(ctx);
          if (!disk) break;
          if (await Dialog.confirm(
            `Eject "${disk.name}"? GitHub token and mounted storage metadata will be removed.`,
            { title: 'Eject GitHub storage', confirmLabel: 'Eject', danger: true }
          )) {
            await app.ejectGithubDisk?.(disk.id);
          }
          break;
        }
        case 'eject-all': {
          const hasUsers = Auth.getUsers().length > 0;
          const hasLocal = LocalDisk.getDisks().length > 0;
          const hasGithub = GithubDisk.getDisks().length > 0;
          if (!hasUsers && !hasLocal && !hasGithub) break;
          if (await Dialog.confirm(
            'Eject all drives? Google accounts will be signed out and local/GitHub storage mounts removed.',
            { title: 'Eject all drives', confirmLabel: 'Eject all', danger: true }
          )) {
            await app.ejectAllDrives?.();
          }
          break;
        }
        case 'root-info':
          await showRootProperties();
          break;
        case 'user-info':
          await showUserProperties('general', ctx);
          break;
        case 'user-details':
          await showUserProperties('details', ctx);
          break;
        case 'open-service':
          if (actionUrl) window.open(actionUrl, '_blank', 'noopener');
          break;
        case 'copy-email':
          if (user?.email) {
            await navigator.clipboard.writeText(user.email);
            app.showStatus('Email copied');
          }
          break;
        case 'reauth-user':
          if (user) {
            Auth.setActiveUser(user.id);
            await Auth.refreshTokenInteractive(user.id);
            app.refreshUserQuotas?.();
            app.showStatus(`Signed in as ${Auth.formatDisplayEmail(user.email)}`);
          }
          break;
        case 'sign-out-user':
          if (user && await Dialog.confirm(
            `Sign out ${Auth.formatDisplayEmail(user.email)}?`,
            { title: 'Sign out', confirmLabel: 'Sign out', danger: true }
          )) {
            app.signOutUser(user.id);
          }
          break;
        case 'open-tab':
          if (file?.webViewLink) {
            window.open(file.webViewLink, '_blank');
          } else if (
            ctx.section === 'my-drive'
            && (
              Drive.isNotepadFile(file)
              || (LocalDisk.isLocalId(ctx.userId) && LocalDisk.isNotepadFile(file))
              || (GithubDisk.isGithubId(ctx.userId) && GithubDisk.isNotepadFile(file))
            )
          ) {
            await Notepad.openInTab(file, ctx.userId);
          }
          break;
        case 'cut':
          clipboard = { mode: 'cut', userId: ctx.userId, items: [file], parentId: file.parents?.[0] || ctx.folderId };
          app.showStatus(`Cut "${file.name}" — paste into any user folder`);
          break;
        case 'copy':
          clipboard = { mode: 'copy', userId: ctx.userId, items: [file] };
          app.showStatus(`Copied "${file.name}" — paste into any user folder`);
          break;
        case 'paste':
          await pasteItems(ctx);
          break;
        case 'new-folder':
          await createFolder(ctx);
          break;
        case 'new-file':
          await createNewFile(fileType, ctx);
          break;
        case 'rename':
          await renameItem(ctx);
          break;
        case 'delete':
          await trashItem(ctx);
          break;
        case 'restore':
          await restoreItem(ctx);
          break;
        case 'delete-forever':
          await deleteForever(ctx);
          break;
        case 'download':
          await downloadFile(ctx);
          break;
        case 'copy-link':
          if (file?.webViewLink) {
            await navigator.clipboard.writeText(file.webViewLink);
            app.showStatus('Link copied');
          }
          break;
        case 'properties':
          await showProperties(ctx);
          break;
        case 'refresh':
          if (ctx.type === 'root' && app.refreshUserQuotas) {
            await app.refreshUserQuotas();
          }
          app.refresh();
          break;
      }
    } catch (err) {
      app.showError(err.message);
    } finally {
      context = null;
    }
  }

  async function createLocalDisk() {
    const storage = await LocalDisk.getBrowserStorage();
    const allocatable = await LocalDisk.getAllocatableSize();
    const maxMb = Math.floor(allocatable / (1024 * 1024));
    const defaultMb = maxMb > 0 ? Math.min(maxMb, 1024) : 0;

    const storageMessage = storage.supported
      ? [
          `Total storage available to this app: ${storage.quotaFormatted}`,
          `Currently used by this app: ${storage.usageFormatted}`,
          `Available for allocation: ${LocalDisk.formatSize(allocatable)}`,
          '',
          'Choose a storage size between 0 (no fixed limit) and the maximum below.',
        ].join('\n')
      : [
          'Browser storage information is unavailable on this device.',
          'You can still set a storage size between 0 (no limit) and a custom maximum in megabytes.',
        ].join('\n');

    const values = await Dialog.form({
      title: 'Create local storage',
      message: storageMessage,
      fields: [
        { id: 'name', label: 'Storage name', value: 'Local Storage' },
        {
          id: 'sizeMb',
          label: 'Storage size',
          type: 'range',
          min: 0,
          max: maxMb,
          step: 1,
          value: defaultMb,
          formatValue: (mb) => (mb <= 0 ? 'No limit' : LocalDisk.formatSize(mb * 1024 * 1024)),
          hint: maxMb > 0
            ? `0 = no fixed limit. Maximum: ${LocalDisk.formatSize(allocatable)}`
            : '0 = no fixed limit. No additional space is currently available to allocate.',
        },
      ],
      submitLabel: 'Create',
    });

    if (!values) return;

    const name = values.name?.trim();
    if (!name) return;

    const sizeMb = Math.max(0, Math.floor(Number(values.sizeMb) || 0));
    const sizeLimit = sizeMb > 0 ? sizeMb * 1024 * 1024 : 0;
    const disk = await LocalDisk.createDisk(name, sizeLimit);
    app.refresh?.();
    const sizeLabel = sizeLimit ? LocalDisk.formatSize(sizeLimit) : 'no limit';
    app.showStatus(`Created local storage "${disk.name}" (${sizeLabel})`);
  }

  async function createGithubDisk() {
    const disk = await GithubDisk.createDisk();
    app.refresh?.();
    app.showStatus(`Connected GitHub storage "${disk.name}"`);
  }

  function buildGeneralLocalDiskRows(disk, quota) {
    return [
      { section: 'Local storage' },
      ['Name', disk.name],
      ['Type', 'Local storage'],
      ['Storage', 'Browser (IndexedDB + localStorage)'],
      ['Size limit', disk.sizeLimit ? LocalDisk.formatSize(disk.sizeLimit) : 'No limit'],
      ['Created', formatDateTime(disk.createdAt)],
      { section: 'Usage' },
      ['Used', quota?.usageFormatted || '—'],
      ['Limit', quota?.limitFormatted || '—'],
      ['Available', quota?.availableFormatted || '—'],
      ['Summary', quota?.label || '—'],
    ];
  }

  async function buildDetailedLocalDiskRows(disk) {
    const quota = await LocalDisk.getStorageQuota(disk.id);
    const storage = await LocalDisk.getBrowserStorage();
    const allocatable = await LocalDisk.getAllocatableSize(disk.id);
    const entries = await LocalDisk.listFiles(disk.id, LocalDisk.ROOT_ID);
    const trash = await LocalDisk.listTrash(disk.id);

    return [
      ...buildGeneralLocalDiskRows(disk, quota),
      { section: 'Device storage' },
      ['App quota', storage.quotaFormatted],
      ['App usage', storage.usageFormatted],
      ['Available to allocate', LocalDisk.formatSize(allocatable)],
      { section: 'Contents' },
      ['Files and folders', String(entries.length)],
      ['Items in Recycle Bin', String(trash.length)],
      { section: 'Technical' },
      ['Storage ID', disk.id],
      ['Root folder ID', LocalDisk.ROOT_ID],
      ['Persistence', 'localStorage (metadata) + IndexedDB (files)'],
    ];
  }

  async function showLocalDiskProperties(mode, ctx) {
    const disk = getContextLocalDisk(ctx);
    if (!disk) return;

    propsEl.querySelector('.props-title').textContent = disk.name;
    propsEl.querySelector('.props-body').innerHTML = '<div class="props-loading">Loading…</div>';
    propsEl.classList.remove('hidden');

    try {
      const rows = mode === 'details'
        ? await buildDetailedLocalDiskRows(disk)
        : buildGeneralLocalDiskRows(disk, await LocalDisk.getStorageQuota(disk.id));
      propsEl.querySelector('.props-body').innerHTML = renderPropsRows(rows);
    } catch (err) {
      propsEl.querySelector('.props-body').innerHTML =
        `<div class="props-error">${escapeHtml(err.message)}</div>`;
    }
  }

  function buildGeneralGithubDiskRows(disk, quota) {
    return [
      { section: 'GitHub storage' },
      ['Name', disk.name],
      ['Type', 'GitHub repository'],
      ['Repository', `${disk.owner}/${disk.repo}`],
      ['Branch', disk.branch || 'main'],
      ['Created', formatDateTime(disk.createdAt)],
      { section: 'Account' },
      ['Login', disk.accountLogin || '—'],
      ['Display name', disk.accountName || disk.accountLogin || '—'],
      { section: 'Usage' },
      ['Used', quota?.usageFormatted || '—'],
      ['Limit', quota?.limitFormatted || '—'],
      ['Summary', quota?.label || '—'],
    ];
  }

  async function showGithubDiskProperties(mode, ctx) {
    const disk = getContextGithubDisk(ctx);
    if (!disk) return;
    propsEl.querySelector('.props-title').textContent = disk.name;
    propsEl.querySelector('.props-body').innerHTML = '<div class="props-loading">Loading…</div>';
    propsEl.classList.remove('hidden');
    try {
      const quota = await GithubDisk.getStorageQuota(disk.id);
      const rows = buildGeneralGithubDiskRows(disk, quota);
      if (mode === 'details') {
        rows.push(
          { section: 'Technical' },
          ['Storage ID', disk.id],
          ['Repository URL', disk.repoHtmlUrl || `https://github.com/${disk.owner}/${disk.repo}`],
          ['OAuth scope', CONFIG.GITHUB_SCOPES || 'repo']
        );
      }
      propsEl.querySelector('.props-body').innerHTML = renderPropsRows(rows);
    } catch (err) {
      propsEl.querySelector('.props-body').innerHTML = `<div class="props-error">${escapeHtml(err.message)}</div>`;
    }
  }

  async function transferItems(items, sourceUserId, sourceParentId, destUserId, destParentId, mode = 'cut') {
    const crossDrive = sourceUserId !== destUserId;
    const sourceLocal = LocalDisk.isLocalId(sourceUserId);
    const destLocal = LocalDisk.isLocalId(destUserId);
    const sourceGithub = GithubDisk.isGithubId(sourceUserId);
    const destGithub = GithubDisk.isGithubId(destUserId);

    if (sourceGithub || destGithub) {
      if (crossDrive) {
        throw new Error('Copy/move between GitHub storage and other drives is not supported yet');
      }
      for (const item of items) {
        if (mode === 'copy') {
          await GithubDisk.copyFile(destUserId, item.id, destParentId);
        } else {
          const fromParent = sourceParentId || item.parents?.[0] || item.parentId || GithubDisk.ROOT_ID;
          await GithubDisk.moveFile(destUserId, item.id, fromParent, destParentId);
        }
      }
      app.clearTreeCache?.(destUserId);
      await app.refresh();
      return;
    }

    for (const item of items) {
      if (sourceLocal && destLocal) {
        if (crossDrive) {
          await copyLocalItemToDisk(sourceUserId, destUserId, item, destParentId);
          if (mode === 'cut') {
            await LocalDisk.deleteFile(sourceUserId, item.id);
          }
        } else if (mode === 'copy') {
          await LocalDisk.copyFile(destUserId, item.id, destParentId);
        } else {
          const fromParent = sourceParentId || item.parents?.[0] || item.parentId;
          await LocalDisk.moveFile(destUserId, item.id, fromParent, destParentId);
        }
      } else if (!sourceLocal && !destLocal) {
        const destToken = await Auth.ensureValidToken(destUserId);
        const sourceToken = crossDrive ? await Auth.ensureValidToken(sourceUserId) : destToken;
        if (crossDrive) {
          await Drive.copyItemToUser(sourceToken, destToken, item.id, destParentId, item);
          if (mode === 'cut') {
            await Drive.trashFile(sourceToken, item.id);
          }
        } else if (mode === 'copy') {
          await Drive.copyFile(destToken, item.id, destParentId);
        } else {
          const fromParent = sourceParentId || item.parents?.[0];
          await Drive.moveFile(destToken, item.id, fromParent, destParentId);
        }
      } else if (!sourceLocal && destLocal) {
        const sourceToken = await Auth.ensureValidToken(sourceUserId);
        await copyGoogleItemToLocal(sourceToken, destUserId, item, destParentId);
        if (mode === 'cut') {
          await Drive.trashFile(sourceToken, item.id);
        }
      } else {
        const destToken = await Auth.ensureValidToken(destUserId);
        await copyLocalItemToGoogle(sourceUserId, destToken, item, destParentId);
        if (mode === 'cut') {
          await LocalDisk.deleteFile(sourceUserId, item.id);
        }
      }
    }

    app.clearTreeCache?.(destUserId);
    if (crossDrive) app.clearTreeCache?.(sourceUserId);
    await app.refresh();
  }

  async function pasteItems(ctx) {
    if (!clipboard?.items?.length) return;

    const destId = getDriveId(ctx);
    const parentId = targetParentId(ctx);
    const crossDrive = clipboard.userId !== destId;

    await transferItems(
      clipboard.items,
      clipboard.userId,
      clipboard.parentId,
      destId,
      parentId,
      clipboard.mode
    );

    if (clipboard.mode === 'cut') clipboard = null;
    app.showStatus(crossDrive ? 'Pasted from another drive' : 'Paste complete');
  }

  async function copyLocalItemToDisk(sourceDiskId, destDiskId, item, parentId) {
    if (item.isFolder || item.mimeType === LocalDisk.FOLDER_MIME) {
      const folder = await LocalDisk.createFolder(destDiskId, parentId, item.name);
      const children = await LocalDisk.listFiles(sourceDiskId, item.id);
      for (const child of children) {
        await copyLocalItemToDisk(sourceDiskId, destDiskId, child, folder.id);
      }
      return folder;
    }
    const content = await LocalDisk.getTextFileContent(sourceDiskId, item.id);
    return LocalDisk.createFile(destDiskId, parentId, item.name, item.mimeType, content);
  }

  async function copyGoogleItemToLocal(sourceToken, destDiskId, item, parentId) {
    if (item.isFolder) {
      const folder = await LocalDisk.createFolder(destDiskId, parentId, item.name);
      const children = await Drive.listFiles(sourceToken, item.id);
      for (const child of children) {
        await copyGoogleItemToLocal(sourceToken, destDiskId, child, folder.id);
      }
      return folder;
    }
    const blob = await Drive.downloadFile(sourceToken, item.id, item.mimeType);
    const content = await blob.text();
    return LocalDisk.createFile(destDiskId, parentId, item.name, item.mimeType || 'text/plain', content);
  }

  async function copyLocalItemToGoogle(sourceDiskId, destToken, item, parentId) {
    if (item.isFolder || item.mimeType === LocalDisk.FOLDER_MIME) {
      const folder = await Drive.createFolder(destToken, parentId, item.name);
      const children = await LocalDisk.listFiles(sourceDiskId, item.id);
      for (const child of children) {
        await copyLocalItemToGoogle(sourceDiskId, destToken, child, folder.id);
      }
      return folder;
    }
    const content = await LocalDisk.getTextFileContent(sourceDiskId, item.id);
    return Drive.createFile(destToken, parentId, item.name, item.mimeType || 'text/plain', content);
  }

  async function createFolder(ctx) {
    const driveId = getDriveId(ctx);
    const name = await Dialog.prompt('New folder name:', '', { title: 'New folder' });
    if (!name?.trim()) return;
    if (isLocalCtx(ctx)) {
      await LocalDisk.createFolder(driveId, targetParentId(ctx), name.trim());
    } else if (isGithubCtx(ctx)) {
      await GithubDisk.createFolder(driveId, targetParentId(ctx), name.trim());
    } else {
      const token = await getToken(ctx);
      await Drive.createFolder(token, targetParentId(ctx), name.trim());
    }
    app.clearTreeCache?.(driveId);
    await app.refresh();
    app.showStatus(`Created folder "${name.trim()}"`);
  }

  async function createNewFile(fileType, ctx) {
    const driveId = getDriveId(ctx);
    const type = getFileTypeDef(fileType);
    if (!type) return;

    let name = await Dialog.prompt('Name:', type.defaultName, { title: 'New file' });
    if (!name?.trim()) return;
    name = name.trim();

    const parentId = targetParentId(ctx);
    let created;

    if (isLocalCtx(ctx)) {
      if (type.ext && !name.toLowerCase().endsWith(type.ext)) name += type.ext;
      created = await LocalDisk.createFile(driveId, parentId, name, type.mimeType, type.content);
      app.clearTreeCache?.(driveId);
      await app.refresh();
      app.showStatus(`Created "${name}"`);
      if (LocalDisk.isNotepadFile(created)) {
        try {
          await Notepad.openInTab(created, driveId);
        } catch (err) {
          app.showError(err.message);
        }
      }
      return;
    }

    if (isGithubCtx(ctx)) {
      if (type.ext && !name.toLowerCase().endsWith(type.ext)) name += type.ext;
      if (type.mimeType.startsWith('application/vnd.google-apps.')) {
        throw new Error('Google Workspace files are not supported in GitHub storage');
      }
      created = await GithubDisk.createFile(driveId, parentId, name, type.mimeType, type.content);
      app.clearTreeCache?.(driveId);
      await app.refresh();
      app.showStatus(`Created "${name}"`);
      if (GithubDisk.isNotepadFile(created)) {
        try {
          await Notepad.openInTab(created, driveId);
        } catch (err) {
          app.showError(err.message);
        }
      }
      return;
    }

    const token = await getToken(ctx);
    if (type.mimeType.startsWith('application/vnd.google-apps.')) {
      created = await Drive.createGoogleApp(token, parentId, name, type.mimeType);
      app.clearTreeCache?.(driveId);
      await app.refresh();
      app.showStatus(`Created "${name}"`);
      if (created.webViewLink) window.open(created.webViewLink, '_blank');
      return;
    }

    if (type.ext && !name.toLowerCase().endsWith(type.ext)) name += type.ext;
    created = await Drive.createFile(token, parentId, name, type.mimeType, type.content);
    app.clearTreeCache?.(driveId);
    await app.refresh();
    app.showStatus(`Created "${name}"`);

    if (Drive.isNotepadFile(created)) {
      try {
        await Notepad.openInTab(created, driveId);
      } catch (err) {
        app.showError(err.message);
      }
    }
  }

  async function renameItem(ctx) {
    const driveId = getDriveId(ctx);
    const file = ctx.file;
    const name = await Dialog.prompt('Rename:', file.name, { title: 'Rename' });
    if (!name?.trim() || name.trim() === file.name) return;
    if (isLocalCtx(ctx)) {
      await LocalDisk.renameFile(driveId, file.id, name.trim());
    } else if (isGithubCtx(ctx)) {
      await GithubDisk.renameFile(driveId, file.id, name.trim());
    } else {
      const token = await getToken(ctx);
      await Drive.renameFile(token, file.id, name.trim());
    }
    app.clearTreeCache?.(driveId);
    await app.refresh();
    app.showStatus(`Renamed to "${name.trim()}"`);
  }

  async function trashItem(ctx) {
    const driveId = getDriveId(ctx);
    const file = ctx.file;
    if (!await Dialog.confirm(
      `Move "${file.name}" to Recycle Bin?`,
      { title: 'Move to Recycle Bin', confirmLabel: 'Move to Recycle Bin', danger: true }
    )) return;
    if (isLocalCtx(ctx)) {
      await LocalDisk.trashFile(driveId, file.id);
    } else if (isGithubCtx(ctx)) {
      await GithubDisk.trashFile(driveId, file.id);
    } else {
      const token = await getToken(ctx);
      await Drive.trashFile(token, file.id);
    }
    app.clearTreeCache?.(driveId);
    await app.refresh();
    app.showStatus(`Moved "${file.name}" to Recycle Bin`);
  }

  async function restoreItem(ctx) {
    const driveId = getDriveId(ctx);
    const file = ctx.file;
    if (isLocalCtx(ctx)) {
      await LocalDisk.restoreFile(driveId, file.id);
    } else if (isGithubCtx(ctx)) {
      await GithubDisk.restoreFile(driveId, file.id);
    } else {
      const token = await getToken(ctx);
      await Drive.restoreFile(token, file.id);
    }
    await app.refresh();
    app.showStatus(`Restored "${file.name}"`);
  }

  async function deleteForever(ctx) {
    const driveId = getDriveId(ctx);
    const file = ctx.file;
    if (!await Dialog.confirm(
      `Permanently delete "${file.name}"? This cannot be undone.`,
      { title: 'Delete permanently', confirmLabel: 'Delete', danger: true }
    )) return;
    if (isLocalCtx(ctx)) {
      await LocalDisk.deleteFile(driveId, file.id);
    } else if (isGithubCtx(ctx)) {
      await GithubDisk.deleteFile(driveId, file.id);
    } else {
      const token = await getToken(ctx);
      await Drive.deleteFile(token, file.id);
    }
    await app.refresh();
    app.showStatus(`Deleted "${file.name}" permanently`);
  }

  async function downloadFile(ctx) {
    const driveId = getDriveId(ctx);
    const file = ctx.file;
    const blob = isLocalCtx(ctx)
      ? await LocalDisk.downloadFile(driveId, file.id)
      : isGithubCtx(ctx)
        ? await GithubDisk.downloadFile(driveId, file.id)
        : await Drive.downloadFile(await getToken(ctx), file.id, file.mimeType);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    a.click();
    URL.revokeObjectURL(url);
    app.showStatus(`Downloading "${file.name}"`);
  }

  function renderPropsRows(rows) {
    return rows
      .map((row) => {
        if (row.section) {
          return `<div class="props-section">${escapeHtml(row.section)}</div>`;
        }
        const [key, val] = row;
        const value = val == null || val === '' ? '—' : String(val);
        const isLink = /^https?:\/\//.test(value);
        const valHtml = isLink
          ? `<a href="${escapeHtml(value)}" target="_blank" rel="noopener">${escapeHtml(value)}</a>`
          : escapeHtml(value);
        return `<div class="props-row"><span class="props-key">${escapeHtml(key)}</span><span class="props-val">${valHtml}</span></div>`;
      })
      .join('');
  }

  async function showProperties(ctx) {
    const file = ctx?.file;
    if (!file?.id) return;

    propsEl.querySelector('.props-title').textContent = file.name;
    propsEl.querySelector('.props-body').innerHTML = '<div class="props-loading">Loading properties…</div>';
    propsEl.classList.remove('hidden');

    try {
      const rows = isLocalCtx(ctx)
        ? await LocalDisk.getFileProperties(getDriveId(ctx), file.id)
        : isGithubCtx(ctx)
          ? await GithubDisk.getFileProperties(getDriveId(ctx), file.id)
          : await Drive.getFileProperties(await Auth.ensureValidToken(ctx.userId), file.id);
      propsEl.querySelector('.props-body').innerHTML = renderPropsRows(rows);
    } catch (err) {
      propsEl.querySelector('.props-body').innerHTML =
        `<div class="props-error">${escapeHtml(err.message)}</div>`;
    }
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function getClipboard() {
    return clipboard;
  }

  function runAction(action, ctx) {
    context = ctx;
    return executeAction(action);
  }

  return { init, show, showContext, showAddDiskMenu, hide, getClipboard, runAction, transferItems };
})();
