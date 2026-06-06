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
  let propsEl = null;
  let clipboard = null;
  let context = null;
  let app = null;

  function init(handlers) {
    app = handlers;
    menuEl = document.getElementById('context-menu');
    propsEl = document.getElementById('props-dialog');

    document.addEventListener('click', hide);
    document.addEventListener('contextmenu', (e) => {
      if (!e.target.closest('#explorer')) return;
      if (e.target.closest('#context-menu')) return;
    });
    window.addEventListener('resize', hide);
    window.addEventListener('scroll', hide, true);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') hide();
    });

    menuEl?.addEventListener('click', (e) => {
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
    context = null;
  }

  function hideProps() {
    propsEl?.classList.add('hidden');
  }

  function canEditDrive() {
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

  function buildRootMenuItems() {
    const userCount = Auth.getUsers().length;
    return [
      { action: 'open', label: `Open ${typeof SITE !== 'undefined' ? SITE.name : 'Mikus Drive'}`, icon: '🏠' },
      { sep: true },
      { action: 'add-user', label: 'Add User Drive', icon: '💾' },
      {
        action: 'eject-all',
        label: 'Eject all user drives',
        icon: '⏏️',
        disabled: userCount === 0,
      },
      { sep: true },
      { action: 'root-info', label: 'General information', icon: 'ℹ️' },
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
      { action: 'sign-out-user', label: 'Sign out this user', icon: '🚪' },
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

    if (context?.type === 'root') {
      return buildRootMenuItems();
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

  function renderMenu(x, y) {
    const items = buildItems();
    menuEl.innerHTML = items
      .map((item) => {
        if (item.sep) return '<div class="ctx-sep"></div>';
        if (item.header) return `<div class="ctx-header">${escapeHtml(item.header)}</div>`;
        const disabled = item.disabled ? ' disabled' : '';
        const shortcut = item.shortcut ? `<span class="ctx-shortcut">${item.shortcut}</span>` : '';
        const urlAttr = item.url ? ` data-url="${escapeHtml(item.url)}"` : '';
        const fileTypeAttr = item.fileType ? ` data-file-type="${escapeHtml(item.fileType)}"` : '';
        return `<button type="button" class="ctx-item${disabled}" data-action="${item.action}"${item.disabled ? ' disabled' : ''}${urlAttr}${fileTypeAttr}>
          <span class="ctx-icon">${item.icon}</span>
          <span class="ctx-label">${escapeHtml(item.label)}</span>${shortcut}
        </button>`;
      })
      .join('');

    menuEl.classList.remove('hidden');
    const rect = menuEl.getBoundingClientRect();
    const maxX = window.innerWidth - rect.width - 8;
    const maxY = window.innerHeight - rect.height - 8;
    menuEl.style.left = `${Math.min(x, maxX)}px`;
    menuEl.style.top = `${Math.min(y, maxY)}px`;
  }

  function show(e, ctx) {
    e.preventDefault();
    e.stopPropagation();
    context = ctx;
    renderMenu(e.clientX, e.clientY);
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
    const active = Auth.getActiveUser();
    const rows = [
      { section: typeof SITE !== 'undefined' ? SITE.name : 'Mikus Drive' },
      ['Location', 'Root'],
      ['Mounted drives', String(users.length)],
      ['Active drive', active ? Auth.formatDisplayEmail(active.email) : '—'],
      { section: 'Drives' },
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
          } else if (ctx.type === 'user' || file?.isUserDrive) {
            app.navigateToUser(user?.id || file?.userId || ctx.userId);
          } else {
            app.openFile(file);
          }
          break;
        case 'add-user':
          Auth.addUser();
          break;
        case 'eject-all':
          if (Auth.getUsers().length === 0) break;
          if (confirm('Eject all user drives and sign out every user?')) {
            app.signOutAll?.();
          }
          break;
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
          if (user) Auth.reauthorizeUser(user.id);
          break;
        case 'sign-out-user':
          if (user && confirm(`Sign out ${Auth.formatDisplayEmail(user.email)}?`)) {
            app.signOutUser(user.id);
          }
          break;
        case 'open-tab':
          if (file?.webViewLink) window.open(file.webViewLink, '_blank');
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

  async function pasteItems(ctx) {
    if (!clipboard?.items?.length) return;

    const destUserId = ctx.userId;
    const destToken = await Auth.ensureValidToken(destUserId);
    const parentId = targetParentId(ctx);
    const sourceUserId = clipboard.userId;
    const crossUser = sourceUserId !== destUserId;
    const sourceToken = crossUser ? await Auth.ensureValidToken(sourceUserId) : destToken;

    for (const item of clipboard.items) {
      if (crossUser) {
        await Drive.copyItemToUser(sourceToken, destToken, item.id, parentId, item);
        if (clipboard.mode === 'cut') {
          await Drive.trashFile(sourceToken, item.id);
        }
      } else if (clipboard.mode === 'copy') {
        await Drive.copyFile(destToken, item.id, parentId);
      } else {
        const fromParent = clipboard.parentId || item.parents?.[0];
        await Drive.moveFile(destToken, item.id, fromParent, parentId);
      }
    }

    if (clipboard.mode === 'cut') clipboard = null;
    app.clearTreeCache(destUserId);
    if (crossUser) app.clearTreeCache(sourceUserId);
    await app.refresh();
    app.showStatus(crossUser ? 'Pasted from another user' : 'Paste complete');
  }

  async function createFolder(ctx) {
    const userId = ctx.userId;
    const name = prompt('New folder name:');
    if (!name?.trim()) return;
    const token = await getToken(ctx);
    await Drive.createFolder(token, targetParentId(ctx), name.trim());
    app.clearTreeCache(userId);
    await app.refresh();
    app.showStatus(`Created folder "${name.trim()}"`);
  }

  async function createNewFile(fileType, ctx) {
    const userId = ctx.userId;
    const type = getFileTypeDef(fileType);
    if (!type) return;

    let name = prompt('Name:', type.defaultName);
    if (!name?.trim()) return;
    name = name.trim();

    const token = await getToken(ctx);
    const parentId = targetParentId(ctx);
    let created;

    if (type.mimeType.startsWith('application/vnd.google-apps.')) {
      created = await Drive.createGoogleApp(token, parentId, name, type.mimeType);
      app.clearTreeCache(userId);
      await app.refresh();
      app.showStatus(`Created "${name}"`);
      if (created.webViewLink) window.open(created.webViewLink, '_blank');
      return;
    }

    if (type.ext && !name.toLowerCase().endsWith(type.ext)) name += type.ext;
    created = await Drive.createFile(token, parentId, name, type.mimeType, type.content);
    app.clearTreeCache(userId);
    await app.refresh();
    app.showStatus(`Created "${name}"`);

    if (Drive.isNotepadFile(created)) {
      try {
        await Notepad.openInTab(created, userId);
      } catch (err) {
        app.showError(err.message);
      }
    }
  }

  async function renameItem(ctx) {
    const userId = ctx.userId;
    const file = ctx.file;
    const name = prompt('Rename:', file.name);
    if (!name?.trim() || name.trim() === file.name) return;
    const token = await getToken(ctx);
    await Drive.renameFile(token, file.id, name.trim());
    app.clearTreeCache(userId);
    await app.refresh();
    app.showStatus(`Renamed to "${name.trim()}"`);
  }

  async function trashItem(ctx) {
    const userId = ctx.userId;
    const file = ctx.file;
    if (!confirm(`Move "${file.name}" to Recycle Bin?`)) return;
    const token = await getToken(ctx);
    await Drive.trashFile(token, file.id);
    app.clearTreeCache(userId);
    await app.refresh();
    app.showStatus(`Moved "${file.name}" to Recycle Bin`);
  }

  async function restoreItem(ctx) {
    const file = ctx.file;
    const token = await getToken(ctx);
    await Drive.restoreFile(token, file.id);
    await app.refresh();
    app.showStatus(`Restored "${file.name}"`);
  }

  async function deleteForever(ctx) {
    const file = ctx.file;
    if (!confirm(`Permanently delete "${file.name}"? This cannot be undone.`)) return;
    const token = await getToken(ctx);
    await Drive.deleteFile(token, file.id);
    await app.refresh();
    app.showStatus(`Deleted "${file.name}" permanently`);
  }

  async function downloadFile(ctx) {
    const token = await getToken(ctx);
    const file = ctx.file;
    const blob = await Drive.downloadFile(token, file.id, file.mimeType);
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
      const token = await Auth.ensureValidToken(ctx.userId);
      const rows = await Drive.getFileProperties(token, file.id);
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

  return { init, show, hide, getClipboard, runAction };
})();
