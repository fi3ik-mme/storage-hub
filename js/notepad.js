const Notepad = (() => {
  let rootEl = null;
  let editorEl = null;
  let titleEl = null;
  let modifiedEl = null;
  let positionEl = null;
  let statusEl = null;
  let bannerEl = null;
  let wrapBtn = null;
  let findBarEl = null;
  let findInputEl = null;
  let findReplaceEl = null;
  let findStatusEl = null;
  let undoBtn = null;
  let redoBtn = null;
  let loadingEl = null;
  let app = null;
  let isStandalone = false;

  const findState = {
    open: false,
    mode: 'find',
    matchIndex: -1,
  };

  const editHistory = {
    undo: [],
    redo: [],
    pending: null,
    timer: null,
    applying: false,
    maxSize: 100,
  };

  const state = {
    fileId: null,
    fileName: '',
    mimeType: 'text/plain',
    userId: null,
    parentId: null,
    filePath: '',
    dirty: false,
    wordWrap: true,
    loading: false,
  };

  function modKey() {
    return /Mac|iPhone|iPad|iPod/.test(navigator.userAgent) ? '⌘' : 'Ctrl';
  }

  function initKbdLabels() {
    const mod = modKey();
    rootEl?.querySelectorAll('.notepad-kbd').forEach((el) => {
      el.textContent = el.textContent.replace(/^Ctrl/, mod);
    });
    rootEl?.querySelectorAll('.notepad-tool-btn--primary[title="Save"]').forEach((el) => {
      el.title = `Save (${mod}+S)`;
    });
    if (undoBtn) undoBtn.title = `Undo (${mod}+Z)`;
    if (redoBtn) redoBtn.title = `Redo (${mod}+Shift+Z)`;
  }

  function setLoading(visible) {
    loadingEl?.classList.toggle('hidden', !visible);
    if (editorEl) {
      editorEl.setAttribute('aria-busy', String(visible));
      if (visible) editorEl.disabled = true;
    }
  }

  function showBanner(message, isError = false) {
    if (!bannerEl) return;
    bannerEl.textContent = message;
    bannerEl.classList.toggle('notepad-banner--error', isError);
    bannerEl.classList.remove('hidden');
  }

  function hideBanner() {
    bannerEl?.classList.add('hidden');
    bannerEl?.classList.remove('notepad-banner--error');
    if (bannerEl) bannerEl.textContent = '';
  }

  function getNotepadBasePath() {
    if (typeof BasePath !== 'undefined') return BasePath.get();
    if (typeof Router !== 'undefined') return Router.getBasePath();
    return '';
  }

  function getNotepadPagePath() {
    if (typeof BasePath !== 'undefined') return BasePath.url('/notepad.html');
    const base = getNotepadBasePath();
    return base ? `${base}/notepad.html` : '/notepad.html';
  }

  function buildEditorPath(filePath) {
    const params = new URLSearchParams({ file: filePath });
    return `${getNotepadPagePath()}?${params}`;
  }

  function buildEditorUrl(filePath) {
    return new URL(buildEditorPath(filePath), location.origin).href;
  }

  function fixStandaloneNotepadLocation() {
    if (!document.getElementById('notepad-app')) return;

    const normalizedPath = location.pathname.replace(/\/notepad\.html\/+$/, '/notepad.html');
    if (normalizedPath !== location.pathname) {
      location.replace(`${normalizedPath}${location.search}${location.hash}`);
      return;
    }

    if (!normalizedPath.endsWith('/notepad.html')) return;

    const expected = getNotepadPagePath();
    if (normalizedPath === expected) return;

    const redirect = `${expected}${location.search}${location.hash}`;
    if (`${normalizedPath}${location.search}${location.hash}` !== redirect) {
      location.replace(redirect);
    }
  }

  function syncBrowserUrl() {
    if (!isStandalone || !state.filePath) return;
    const pathAndQuery = buildEditorPath(state.filePath);
    const current = location.pathname + location.search;
    if (current !== pathAndQuery) {
      window.history.replaceState(null, '', pathAndQuery);
    }
  }

  async function updateFilePathInUrl() {
    if (!isStandalone || !state.userId || !state.fileId) return;
    if (LocalDisk.isLocalId(state.userId)) {
      state.filePath = await LocalDisk.buildNotepadFilePath(state.userId, {
        id: state.fileId,
        name: state.fileName,
        parentId: state.parentId,
      });
      syncBrowserUrl();
      return;
    }
    if (GithubDisk.isGithubId(state.userId)) {
      state.filePath = await GithubDisk.buildNotepadFilePath(state.userId, {
        id: state.fileId,
        name: state.fileName,
        parentId: state.parentId,
      });
      syncBrowserUrl();
      return;
    }
    const user = Auth.getUsers().find((u) => u.id === state.userId);
    if (!user) return;
    const token = await Auth.ensureValidToken(state.userId);
    const meta = await Drive.getFileMeta(token, state.fileId);
    state.filePath = await Drive.buildNotepadFilePath(
      token,
      Auth.formatDisplayEmail(user.email),
      meta
    );
    syncBrowserUrl();
  }

  function init(handlers) {
    app = handlers;
    rootEl = document.getElementById('notepad-app') || document.getElementById('notepad-dialog');
    isStandalone = Boolean(document.getElementById('notepad-app'));
    editorEl = document.getElementById('notepad-editor');
    titleEl = document.getElementById('notepad-title');
    modifiedEl = document.getElementById('notepad-modified');
    positionEl = document.getElementById('notepad-position');
    statusEl = document.getElementById('notepad-status');
    bannerEl = document.getElementById('notepad-banner');
    wrapBtn = document.getElementById('notepad-wrap-toggle');
    findBarEl = document.getElementById('notepad-find-bar');
    findInputEl = document.getElementById('notepad-find-input');
    findReplaceEl = document.getElementById('notepad-find-replace');
    findStatusEl = document.getElementById('notepad-find-status');
    undoBtn = document.getElementById('notepad-undo-btn');
    redoBtn = document.getElementById('notepad-redo-btn');
    loadingEl = document.getElementById('notepad-loading');

    initKbdLabels();
    initFindBar();

    rootEl?.querySelector('.notepad-close')?.addEventListener('click', () => close());
    if (!isStandalone) {
      rootEl?.addEventListener('click', (e) => {
        if (e.target === rootEl) close();
      });
    }

    editorEl?.addEventListener('input', () => {
      if (editHistory.applying) return;
      state.dirty = true;
      updateStatus();
      scheduleHistoryCommit();
    });
    editorEl?.addEventListener('click', updateCaretStatus);
    editorEl?.addEventListener('keyup', updateCaretStatus);
    editorEl?.addEventListener('select', updateCaretStatus);
    editorEl?.addEventListener('scroll', updateCaretStatus);
    editorEl?.addEventListener('keydown', (e) => {
      if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        insertAtCursor('\t');
      }
    });

    const menubar = rootEl?.querySelector('.notepad-menubar');
    menubar?.addEventListener('click', (e) => {
      const label = e.target.closest('.notepad-menu-label');
      if (label) {
        e.preventDefault();
        e.stopPropagation();
        const menu = label.closest('.notepad-menu');
        const wasOpen = menu.classList.contains('open');
        closeAllMenus();
        if (!wasOpen) menu.classList.add('open');
        return;
      }

      const btn = e.target.closest('[data-notepad-action]');
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      closeAllMenus();
      runAction(btn.dataset.notepadAction);
    });

    rootEl?.addEventListener('click', (e) => {
      const btn = e.target.closest('.notepad-toolbar [data-notepad-action]');
      if (!btn) return;
      e.preventDefault();
      closeAllMenus();
      runAction(btn.dataset.notepadAction);
    });

    document.addEventListener('click', (e) => {
      if (!isActive()) return;
      if (e.target.closest('.notepad-menubar, .notepad-toolbar')) return;
      closeAllMenus();
    });

    document.addEventListener('keydown', handleKeydown);
  }

  async function bootStandalone() {
    try {
      await LocalDisk.init();
      GithubDisk.init();
      GithubDisk.setSaveStateListener((diskId, filePath) => {
        if (!GithubDisk.isGithubId(state.userId) || !state.fileId) return;
        if (diskId !== state.userId || filePath !== state.fileId) return;
        updateStatus();
      });
      await loadFromUrl();
    } catch (err) {
      app.showError(err.message);
    }
  }

  function initStandalone() {
    fixStandaloneNotepadLocation();
    Dialog.init();
    init({
      showError: (msg) => Dialog.alert(msg, { title: 'Notepad' }),
      showStatus: (msg) => {
        if (!statusEl) return;
        statusEl.textContent = msg;
        setTimeout(() => {
          if (statusEl.textContent === msg) updateStatus();
        }, 3000);
      },
    });

    Auth.init(() => {});
    bootStandalone();
  }

  async function loadFromUrl() {
    const params = new URLSearchParams(location.search);
    const fileParam = params.get('file');

    if (!fileParam) {
      app.showError('Missing file path in URL.');
      return;
    }

    const legacyUserId = params.get('user');
    if (legacyUserId && !fileParam.includes('/')) {
      if (!Auth.getUsers().find((u) => u.id === legacyUserId)) {
        app.showError(`User not signed in. Open ${typeof SITE !== 'undefined' ? SITE.name : 'Storage Hub'} and sign in first.`);
        return;
      }
      try {
        const token = await Auth.ensureValidToken(legacyUserId);
        const meta = await Drive.getFileMeta(token, fileParam);
        if (!Drive.isNotepadFile(meta)) {
          app.showError('Only .txt and .json files can be opened in Notepad.');
          return;
        }
        await open(meta, legacyUserId);
        await updateFilePathInUrl();
      } catch (err) {
        app.showError(err.message);
      }
      return;
    }

    const segments = Drive.parseNotepadFilePath(fileParam);
    const localDisk = LocalDisk.getDiskByName(segments[0]);
    if (localDisk) {
      state.filePath = fileParam.startsWith('/') ? fileParam : `/${fileParam}`;
      const handoff = peekNotepadHandoff(state.filePath);
      if (handoff?.userId === localDisk.id) {
        if (!LocalDisk.isNotepadFile(handoff.file)) {
          app.showError('Only .txt and .json files can be opened in Notepad.');
          return;
        }
        takeNotepadHandoff(state.filePath);
        await openResolvedNotepadFile(handoff.file, handoff.userId);
        return;
      }
      try {
        const { diskId, file } = await LocalDisk.resolveFileByPath(segments);
        if (!LocalDisk.isNotepadFile(file)) {
          app.showError('Only .txt and .json files can be opened in Notepad.');
          return;
        }
        syncBrowserUrl();
        await open(file, diskId);
      } catch (err) {
        await openDraftFromPath(segments, localDisk.id, err.message);
      }
      return;
    }

    const githubDisk = GithubDisk.getDiskByName(segments[0]);
    if (githubDisk) {
      state.filePath = fileParam.startsWith('/') ? fileParam : `/${fileParam}`;
      const handoff = peekNotepadHandoff(state.filePath);
      if (handoff?.userId === githubDisk.id) {
        if (!GithubDisk.isNotepadFile(handoff.file)) {
          app.showError('Only .txt and .json files can be opened in Notepad.');
          return;
        }
        takeNotepadHandoff(state.filePath);
        await openResolvedNotepadFile(handoff.file, handoff.userId);
        return;
      }
      try {
        const { diskId, file } = await GithubDisk.resolveFileByPath(segments);
        if (!GithubDisk.isNotepadFile(file)) {
          app.showError('Only .txt and .json files can be opened in Notepad.');
          return;
        }
        syncBrowserUrl();
        await open(file, diskId);
      } catch (err) {
        await openDraftFromPath(segments, githubDisk.id, err.message);
      }
      return;
    }

    const user = Auth.getUsers().find((u) => Auth.formatDisplayEmail(u.email) === segments[0]);
    if (!user) {
      app.showError(`Drive not found. Open ${typeof SITE !== 'undefined' ? SITE.name : 'Storage Hub'} and sign in or add local/GitHub storage first.`);
      return;
    }

    state.filePath = fileParam.startsWith('/') ? fileParam : `/${fileParam}`;
    try {
      const token = await Auth.ensureValidToken(user.id);
      const meta = await Drive.resolveFileByPath(token, segments);
      if (!Drive.isNotepadFile(meta)) {
        app.showError('Only .txt and .json files can be opened in Notepad.');
        return;
      }
      syncBrowserUrl();
      await open(meta, user.id);
    } catch (err) {
      await openDraftFromPath(segments, user.id, err.message);
    }
  }

  async function openDraftFromPath(segments, userId, errorMessage) {
    const fileName = segments[segments.length - 1] || 'Untitled.txt';
    const handoff = state.filePath ? peekNotepadHandoff(state.filePath) : null;
    if (handoff?.userId === userId && handoff.file) {
      takeNotepadHandoff(state.filePath);
      state.fileId = handoff.file.id;
      state.fileName = handoff.file.name || fileName;
      state.mimeType = handoff.file.mimeType || (fileName.toLowerCase().endsWith('.json') ? 'application/json' : 'text/plain');
      state.userId = userId;
      state.parentId = handoff.file.parentId || handoff.file.parents?.[0] || null;
    } else {
      state.fileId = null;
      state.fileName = fileName;
      state.mimeType = fileName.toLowerCase().endsWith('.json') ? 'application/json' : 'text/plain';
      state.userId = userId;
      state.parentId = null;
    }
    state.dirty = false;
    state.loading = false;

    hideBanner();
    updateStatus();
    editorEl.value = '';
    resetHistory();
    editorEl.disabled = false;
    setLoading(false);
    setWordWrap(state.wordWrap);
    showBanner(`${errorMessage} — you can edit and use Save or Save As.`, true);
    app.showStatus('Opened as new draft');
    editorEl.focus();
  }

  function downloadDocument(fileName = state.fileName) {
    const blob = new Blob([editorEl.value], { type: state.mimeType || 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName || 'document.txt';
    a.click();
    URL.revokeObjectURL(url);
  }

  function isNoWriteAccessError(err) {
    if (!err) return false;
    if (err.code === 'NO_WRITE_ACCESS') return true;
    if (err.status === 403 || err.status === 404) return true;
    const msg = (err.message || '').toLowerCase();
    return /permission|forbidden|not found|insufficient|read-only|access denied|writer/.test(msg);
  }

  async function canSaveToCurrentFile() {
    if (!state.fileId || !state.userId) return false;
    if (LocalDisk.isLocalId(state.userId)) return true;
    if (GithubDisk.isGithubId(state.userId)) return true;
    try {
      const token = await Auth.ensureValidToken(state.userId);
      return await Drive.canWriteFile(token, state.fileId);
    } catch {
      return false;
    }
  }

  async function pickSaveDestination() {
    const options = [];
    LocalDisk.getDisks().forEach((disk) => {
      options.push({ kind: 'local', id: disk.id, label: `${disk.name} (Local Storage)` });
    });
    GithubDisk.getDisks().forEach((disk) => {
      options.push({ kind: 'github', id: disk.id, label: `${disk.name} (GitHub repo)` });
    });
    Auth.getUsers().forEach((user) => {
      options.push({
        kind: 'google',
        id: user.id,
        label: `${Auth.formatDisplayEmail(user.email)} (Google Drive)`,
      });
    });

    if (!options.length) {
      await Dialog.alert(
        'No storage is available. Open Storage Hub and sign in or create local storage.',
        { title: 'Save elsewhere' }
      );
      return null;
    }

    if (options.length === 1) return options[0];

    const buttons = options.map((opt, index) => ({ id: String(index), label: opt.label }));
    buttons.push({ id: 'cancel', label: 'Cancel' });
    const pick = await Dialog.choose({
      title: 'Save to storage',
      message: 'Choose where to save this file:',
      buttons,
    });
    if (pick == null || pick === 'cancel') return null;
    return options[Number(pick)] || null;
  }

  function resolveSaveParentId(dest, forceNew) {
    const sameDest = state.userId === dest.id;
    if (dest.kind === 'local') {
      if (!forceNew && sameDest && state.fileId) return state.parentId || LocalDisk.ROOT_ID;
      return sameDest && state.parentId ? state.parentId : LocalDisk.ROOT_ID;
    }
    if (dest.kind === 'github') {
      if (!forceNew && sameDest && state.fileId) return state.parentId || GithubDisk.ROOT_ID;
      return sameDest && state.parentId ? state.parentId : GithubDisk.ROOT_ID;
    }
    if (!forceNew && sameDest && state.fileId) return state.parentId || Drive.ROOT_ID;
    return sameDest && state.parentId ? state.parentId : Drive.ROOT_ID;
  }

  async function saveToAlternateLocation(options = {}) {
    const { forceNew = false } = options;
    const dest = await pickSaveDestination();
    if (!dest) return false;

    const parentId = resolveSaveParentId(dest, forceNew);
    const content = editorEl.value;
    const mimeType = state.mimeType || 'text/plain';
    const name = state.fileName || 'Untitled.txt';

    try {
      if (dest.kind === 'local') {
        const canUpdate = !forceNew && state.fileId && state.userId === dest.id;
        if (canUpdate) {
          await LocalDisk.updateFileContent(dest.id, state.fileId, content, mimeType);
        } else {
          const created = await LocalDisk.createFile(dest.id, parentId, name, mimeType, content);
          state.fileId = created.id;
          state.userId = dest.id;
          state.parentId = parentId;
        }
        state.filePath = await LocalDisk.buildNotepadFilePath(dest.id, {
          id: state.fileId,
          name,
          parentId: state.parentId || parentId,
        });
      } else if (dest.kind === 'github') {
        const canUpdate = !forceNew && state.fileId && state.userId === dest.id;
        if (canUpdate) {
          await GithubDisk.updateFileContent(dest.id, state.fileId, content, mimeType);
        } else {
          const created = await GithubDisk.createFile(dest.id, parentId, name, mimeType, content);
          state.fileId = created.id;
          state.userId = dest.id;
          state.parentId = parentId;
        }
        state.filePath = await GithubDisk.buildNotepadFilePath(dest.id, {
          id: state.fileId,
          name,
          parentId: state.parentId || parentId,
        });
      } else {
        const token = await Auth.ensureValidToken(dest.id);
        const canUpdate = !forceNew
          && state.fileId
          && state.userId === dest.id
          && await Drive.canWriteFile(token, state.fileId);
        if (canUpdate) {
          await Drive.updateFileContent(token, state.fileId, content, mimeType);
        } else {
          const created = await Drive.createFile(token, parentId, name, mimeType, content);
          state.fileId = created.id;
          state.userId = dest.id;
          state.parentId = parentId;
        }
        const user = Auth.getUsers().find((u) => u.id === dest.id);
        state.filePath = await Drive.buildNotepadFilePath(
          token,
          Auth.formatDisplayEmail(user.email),
          { id: state.fileId, name, parentId: state.parentId || parentId }
        );
      }

      hideBanner();
      state.dirty = false;
      updateStatus();
      syncBrowserUrl();
      app.showStatus(`Saved "${name}"`);
      app.clearTreeCache?.(state.userId);
      return true;
    } catch (err) {
      if (isNoWriteAccessError(err)) {
        await promptSaveElsewhere(err.message);
        return false;
      }
      await handleSaveFailure(err);
      return false;
    }
  }

  async function promptSaveElsewhere(reason) {
    const detail = reason
      ? `${reason}\n\nChoose another location to save your changes.`
      : `You can't save changes to "${state.fileName}" in its current location. Choose another place to save.`;
    const action = await Dialog.choose({
      title: 'Save elsewhere',
      message: detail,
      buttons: [
        { id: 'elsewhere', label: 'Choose location…', primary: true },
        { id: 'download', label: 'Download copy' },
        { id: 'cancel', label: 'Cancel' },
      ],
    });
    if (action === 'elsewhere') {
      await saveToAlternateLocation({ forceNew: true });
    } else if (action === 'download') {
      downloadDocument();
      app.showStatus('Download started');
    }
  }

  async function handleSaveFailure(err) {
    if (isNoWriteAccessError(err)) {
      await promptSaveElsewhere(err.message);
      return;
    }
    const action = await Dialog.choose({
      title: 'Save failed',
      message: err.message,
      buttons: [
        { id: 'retry', label: 'Try again', primary: true },
        { id: 'elsewhere', label: 'Save elsewhere…' },
        { id: 'download', label: 'Download copy' },
        { id: 'cancel', label: 'Cancel' },
      ],
    });
    if (action === 'retry') {
      await save();
    } else if (action === 'download') {
      downloadDocument();
      app.showStatus('Download started');
    } else if (action === 'elsewhere') {
      await saveToAlternateLocation({ forceNew: true });
    }
  }

  function closeAllMenus() {
    rootEl?.querySelectorAll('.notepad-menu.open').forEach((menu) => {
      menu.classList.remove('open');
    });
  }

  function isActive() {
    return isStandalone || (rootEl && !rootEl.classList.contains('hidden'));
  }

  function handleKeydown(e) {
    if (!isActive()) return;

    const openMenu = rootEl?.querySelector('.notepad-menu.open');
    if (openMenu && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      const items = [...openMenu.querySelectorAll('.notepad-menu-dropdown button:not([disabled])')];
      if (!items.length) return;
      const current = document.activeElement;
      let idx = items.indexOf(current);
      if (idx === -1) idx = -1;
      idx = e.key === 'ArrowDown'
        ? (idx + 1) % items.length
        : (idx <= 0 ? items.length - 1 : idx - 1);
      items[idx].focus();
      return;
    }

    if (e.key === 'Escape') {
      if (findState.open) {
        e.preventDefault();
        closeFindBar();
        return;
      }
      if (rootEl?.querySelector('.notepad-menu.open')) {
        e.preventDefault();
        closeAllMenus();
        return;
      }
      if (!document.getElementById('app-dialog')?.classList.contains('hidden')) return;
      e.preventDefault();
      close();
      return;
    }

    if (e.ctrlKey || e.metaKey) {
      if (e.key === 's') {
        e.preventDefault();
        closeAllMenus();
        save();
      }
      if (e.key === 'f') {
        e.preventDefault();
        openFindBar('find');
      }
      if (e.key === 'h') {
        e.preventDefault();
        openFindBar('replace');
      }
      if (e.key === 'z' || e.key === 'Z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      }
      if (e.key === 'y') {
        e.preventDefault();
        redo();
      }
      if (e.key === 'w') {
        e.preventDefault();
        close();
      }
    }
  }

  function captureSnapshot() {
    return {
      value: editorEl.value,
      start: editorEl.selectionStart,
      end: editorEl.selectionEnd,
    };
  }

  function resetHistory() {
    editHistory.undo = [];
    editHistory.redo = [];
    editHistory.pending = editorEl ? captureSnapshot() : null;
    clearTimeout(editHistory.timer);
    editHistory.timer = null;
    updateUndoRedoButtons();
  }

  function updateUndoRedoButtons() {
    undoBtn && (undoBtn.disabled = editHistory.undo.length === 0);
    redoBtn && (redoBtn.disabled = editHistory.redo.length === 0);
  }

  function commitHistoryNow() {
    clearTimeout(editHistory.timer);
    editHistory.timer = null;
    if (editHistory.applying || !editorEl) return;
    const current = captureSnapshot();
    if (!editHistory.pending) {
      editHistory.pending = current;
      return;
    }
    if (editHistory.pending.value !== current.value) {
      editHistory.undo.push({ ...editHistory.pending });
      if (editHistory.undo.length > editHistory.maxSize) editHistory.undo.shift();
      editHistory.redo = [];
    }
    editHistory.pending = current;
    updateUndoRedoButtons();
  }

  function scheduleHistoryCommit() {
    if (!editHistory.pending) editHistory.pending = captureSnapshot();
    clearTimeout(editHistory.timer);
    editHistory.timer = setTimeout(commitHistoryNow, 400);
  }

  function pushEditSnapshot() {
    commitHistoryNow();
    const current = captureSnapshot();
    const last = editHistory.undo[editHistory.undo.length - 1];
    if (!last || last.value !== current.value) {
      editHistory.undo.push(current);
      if (editHistory.undo.length > editHistory.maxSize) editHistory.undo.shift();
      editHistory.redo = [];
    }
    editHistory.pending = null;
    updateUndoRedoButtons();
  }

  function applySnapshot(snap) {
    editHistory.applying = true;
    editorEl.value = snap.value;
    const start = Math.min(snap.start, snap.value.length);
    const end = Math.min(snap.end, snap.value.length);
    editorEl.setSelectionRange(start, end);
    editHistory.applying = false;
    editHistory.pending = captureSnapshot();
    state.dirty = true;
    updateStatus();
    updateUndoRedoButtons();
  }

  function undo() {
    commitHistoryNow();
    if (!editHistory.undo.length) return;
    const current = captureSnapshot();
    const prev = editHistory.undo.pop();
    editHistory.redo.push(current);
    applySnapshot(prev);
    closeAllMenus();
  }

  function redo() {
    commitHistoryNow();
    if (!editHistory.redo.length) return;
    const current = captureSnapshot();
    const next = editHistory.redo.pop();
    editHistory.undo.push(current);
    applySnapshot(next);
    closeAllMenus();
  }

  function setWordWrap(enabled) {
    state.wordWrap = enabled;
    editorEl.classList.toggle('notepad-editor--wrap', enabled);
    editorEl.wrap = enabled ? 'soft' : 'off';
    wrapBtn?.classList.toggle('active', enabled);
    wrapBtn?.setAttribute('aria-pressed', String(enabled));
  }

  function initFindBar() {
    findBarEl?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-find-action]');
      if (!btn) return;
      e.preventDefault();
      const action = btn.dataset.findAction;
      if (action === 'close') closeFindBar();
      else if (action === 'next') findNext();
      else if (action === 'prev') findPrevious();
      else if (action === 'replace') replaceCurrent();
      else if (action === 'replace-all') replaceAll();
    });

    findInputEl?.addEventListener('input', () => {
      findState.matchIndex = -1;
      updateFindStatus();
    });

    findInputEl?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (e.shiftKey) findPrevious();
        else findNext();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        closeFindBar();
      }
    });

    findReplaceEl?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        replaceCurrent();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        closeFindBar();
      }
    });
  }

  function getFindQuery() {
    return findInputEl?.value ?? '';
  }

  function getReplaceText() {
    return findReplaceEl?.value ?? '';
  }

  function getMatchPositions(text, query) {
    if (!query) return [];
    const positions = [];
    let idx = 0;
    while (idx <= text.length) {
      const found = text.indexOf(query, idx);
      if (found === -1) break;
      positions.push(found);
      idx = found + Math.max(query.length, 1);
    }
    return positions;
  }

  function setFindBarMode(mode) {
    findState.mode = mode === 'replace' ? 'replace' : 'find';
    findBarEl?.classList.toggle('notepad-find-bar--replace', findState.mode === 'replace');
  }

  function openFindBar(mode = 'find') {
    if (!findBarEl) return;
    closeAllMenus();
    setFindBarMode(mode);
    findState.open = true;
    findState.matchIndex = -1;
    findBarEl.classList.remove('hidden');

    const selected = editorEl?.value.slice(editorEl.selectionStart, editorEl.selectionEnd);
    if (selected && !selected.includes('\n') && findInputEl && !findInputEl.value) {
      findInputEl.value = selected;
    }

    findInputEl?.focus();
    findInputEl?.select();
    updateFindStatus();
  }

  function closeFindBar() {
    findState.open = false;
    findState.matchIndex = -1;
    findBarEl?.classList.add('hidden');
    if (findStatusEl) findStatusEl.textContent = '';
    editorEl?.focus();
  }

  function updateFindStatus() {
    if (!findStatusEl) return;
    const query = getFindQuery();
    if (!query) {
      findStatusEl.textContent = '';
      return;
    }
    const matches = getMatchPositions(editorEl.value, query);
    if (!matches.length) {
      findStatusEl.textContent = 'No matches';
      return;
    }
    const idx = findState.matchIndex >= 0 ? findState.matchIndex + 1 : 0;
    findStatusEl.textContent = `${Math.min(idx, matches.length)} of ${matches.length}`;
  }

  function selectMatchAt(position, query) {
    editorEl.focus();
    editorEl.setSelectionRange(position, position + query.length);
    const matches = getMatchPositions(editorEl.value, query);
    findState.matchIndex = matches.indexOf(position);
    updateFindStatus();
    updateCaretStatus();
  }

  function findNext() {
    const query = getFindQuery();
    if (!query) {
      findInputEl?.focus();
      return;
    }
    const text = editorEl.value;
    const matches = getMatchPositions(text, query);
    if (!matches.length) {
      findState.matchIndex = -1;
      updateFindStatus();
      return;
    }
    const anchor = editorEl.selectionEnd;
    let nextIdx = matches.findIndex((pos) => pos >= anchor);
    if (nextIdx === -1) nextIdx = 0;
    selectMatchAt(matches[nextIdx], query);
  }

  function findPrevious() {
    const query = getFindQuery();
    if (!query) {
      findInputEl?.focus();
      return;
    }
    const text = editorEl.value;
    const matches = getMatchPositions(text, query);
    if (!matches.length) {
      findState.matchIndex = -1;
      updateFindStatus();
      return;
    }
    const anchor = editorEl.selectionStart;
    let prevIdx = -1;
    for (let i = matches.length - 1; i >= 0; i -= 1) {
      if (matches[i] < anchor) {
        prevIdx = i;
        break;
      }
    }
    if (prevIdx === -1) prevIdx = matches.length - 1;
    selectMatchAt(matches[prevIdx], query);
  }

  function replaceCurrent() {
    const query = getFindQuery();
    if (!query) {
      findInputEl?.focus();
      return;
    }
    const replacement = getReplaceText();
    const start = editorEl.selectionStart;
    const end = editorEl.selectionEnd;
    const selected = editorEl.value.slice(start, end);
    if (selected !== query) {
      findNext();
      return;
    }
    pushEditSnapshot();
    editorEl.value = editorEl.value.slice(0, start) + replacement + editorEl.value.slice(end);
    state.dirty = true;
    updateStatus();
    const caret = start + replacement.length;
    editorEl.setSelectionRange(caret, caret);
    findState.matchIndex = -1;
    findNext();
  }

  function replaceAll() {
    const query = getFindQuery();
    if (!query) {
      findInputEl?.focus();
      return;
    }
    const replacement = getReplaceText();
    if (!editorEl.value.includes(query)) {
      findState.matchIndex = -1;
      updateFindStatus();
      return;
    }
    pushEditSnapshot();
    editorEl.value = editorEl.value.split(query).join(replacement);
    state.dirty = true;
    updateStatus();
    findState.matchIndex = -1;
    updateFindStatus();
    app.showStatus?.('Replaced all matches');
  }

  function getGithubSaveStatusText() {
    if (!GithubDisk.isGithubId(state.userId) || !state.fileId) return '';
    const saveState = GithubDisk.getFileSaveState(state.userId, state.fileId);
    if (!saveState) return '';
    if (saveState.status === 'saving') return 'Saving…';
    if (saveState.status === 'pending') return 'Pending save…';
    if (saveState.status === 'error') return saveState.error || 'Save failed';
    return '';
  }

  function updateStatus() {
    modifiedEl.textContent = state.dirty ? '*' : '';
    const saveText = getGithubSaveStatusText();
    if (statusEl) statusEl.textContent = saveText;
    const suffix = state.dirty ? '*' : '';
    const title = `${state.fileName}${suffix} - Notepad`;
    titleEl.textContent = title;
    document.title = title;
    updateCaretStatus();
  }

  function updateCaretStatus() {
    if (!editorEl || !positionEl) return;
    const text = editorEl.value;
    const pos = editorEl.selectionStart;
    const before = text.slice(0, pos);
    const lines = before.split('\n');
    const line = lines.length;
    const col = lines[lines.length - 1].length + 1;
    positionEl.textContent = `Ln ${line}, Col ${col}`;
  }

  const NOTEPAD_HANDOFF_PREFIX = 'storage-hub:notepad-handoff:';
  const NOTEPAD_HANDOFF_TTL_MS = 120000;

  function normalizeNotepadPath(filePath) {
    if (!filePath) return '';
    return filePath.startsWith('/') ? filePath : `/${filePath}`;
  }

  function stashNotepadHandoff(filePath, userId, file) {
    try {
      localStorage.setItem(`${NOTEPAD_HANDOFF_PREFIX}${normalizeNotepadPath(filePath)}`, JSON.stringify({
        userId,
        file: {
          id: file.id,
          name: file.name,
          mimeType: file.mimeType || 'text/plain',
          parentId: file.parentId || file.parents?.[0] || null,
        },
        expires: Date.now() + NOTEPAD_HANDOFF_TTL_MS,
      }));
    } catch {
      // Ignore storage quota or private-mode errors.
    }
  }

  function peekNotepadHandoff(filePath) {
    const key = `${NOTEPAD_HANDOFF_PREFIX}${normalizeNotepadPath(filePath)}`;
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!data?.userId || !data?.file || Date.now() > data.expires) return null;
      return data;
    } catch {
      return null;
    }
  }

  function takeNotepadHandoff(filePath) {
    const key = `${NOTEPAD_HANDOFF_PREFIX}${normalizeNotepadPath(filePath)}`;
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      localStorage.removeItem(key);
      const data = JSON.parse(raw);
      if (!data?.userId || !data?.file || Date.now() > data.expires) return null;
      return data;
    } catch {
      localStorage.removeItem(key);
      return null;
    }
  }

  async function openResolvedNotepadFile(file, diskId) {
    syncBrowserUrl();
    await open(file, diskId);
  }

  async function openInTab(file, userId) {
    const filePath = LocalDisk.isLocalId(userId)
      ? await LocalDisk.buildNotepadFilePath(userId, file)
      : GithubDisk.isGithubId(userId)
        ? await GithubDisk.buildNotepadFilePath(userId, file)
      : await (async () => {
        const user = Auth.getUsers().find((u) => u.id === userId);
        if (!user) throw new Error('User not found');
        const token = await Auth.ensureValidToken(userId);
        return Drive.buildNotepadFilePath(token, Auth.formatDisplayEmail(user.email), file);
      })();
    stashNotepadHandoff(filePath, userId, file);
    window.open(buildEditorUrl(filePath), '_blank', 'noopener');
  }

  async function open(file, userId) {
    state.fileId = file.id;
    state.fileName = file.name;
    state.mimeType = file.mimeType || 'text/plain';
    state.userId = userId;
    state.parentId = file.parentId || file.parents?.[0] || null;
    state.dirty = false;
    state.loading = true;

    hideBanner();
    updateStatus();
    editorEl.value = '';
    setLoading(true);
    modifiedEl.textContent = '';
    positionEl.textContent = 'Ln 1, Col 1';
    if (!isStandalone) rootEl.classList.remove('hidden');
    setWordWrap(state.wordWrap);

    try {
      const content = LocalDisk.isLocalId(userId)
        ? await LocalDisk.getTextFileContent(userId, file.id)
        : GithubDisk.isGithubId(userId)
          ? await GithubDisk.getTextFileContent(userId, file.id)
        : await Drive.getTextFileContent(await Auth.ensureValidToken(userId), file.id);
      editorEl.value = content;
      state.dirty = false;
      updateStatus();
    } catch (err) {
      editorEl.value = '';
      state.dirty = false;
      updateStatus();
      showBanner(`Could not load file: ${err.message}`, true);
    } finally {
      editorEl.disabled = false;
      setLoading(false);
      state.loading = false;
      if (!state.filePath) await updateFilePathInUrl();
      resetHistory();
      editorEl.focus();
    }
  }

  async function save() {
    if (state.loading) return;

    if (!state.fileId) {
      await saveToAlternateLocation();
      return;
    }

    if (!(await canSaveToCurrentFile())) {
      await promptSaveElsewhere(
        `You don't have permission to overwrite "${state.fileName}" in its current location.`
      );
      return;
    }

    try {
      if (LocalDisk.isLocalId(state.userId)) {
        await LocalDisk.updateFileContent(state.userId, state.fileId, editorEl.value, state.mimeType);
      } else if (GithubDisk.isGithubId(state.userId)) {
        await GithubDisk.updateFileContent(state.userId, state.fileId, editorEl.value, state.mimeType);
      } else {
        const token = await Auth.ensureValidToken(state.userId);
        await Drive.updateFileContent(token, state.fileId, editorEl.value, state.mimeType);
      }
      hideBanner();
      state.dirty = false;
      updateStatus();
      if (!state.filePath) await updateFilePathInUrl();
      else syncBrowserUrl();
      app.showStatus(`Saved "${state.fileName}"`);
      app.clearTreeCache?.(state.userId);
    } catch (err) {
      await handleSaveFailure(err);
    }
  }

  async function saveAs() {
    const name = await Dialog.prompt('Save as:', state.fileName, { title: 'Save As' });
    if (!name?.trim()) return;

    const trimmed = name.trim();
    const prevName = state.fileName;
    state.fileName = trimmed;
    state.mimeType = trimmed.toLowerCase().endsWith('.json') ? 'application/json' : 'text/plain';

    if (!state.fileId) {
      await saveToAlternateLocation();
      return;
    }

    if (!(await canSaveToCurrentFile())) {
      await promptSaveElsewhere(
        `You don't have permission to save changes to "${prevName}" in its current location.`
      );
      state.fileName = prevName;
      return;
    }

    try {
      if (LocalDisk.isLocalId(state.userId)) {
        if (trimmed !== prevName) {
          await LocalDisk.renameFile(state.userId, state.fileId, trimmed);
        }
        await LocalDisk.updateFileContent(state.userId, state.fileId, editorEl.value, state.mimeType);
        state.filePath = await LocalDisk.buildNotepadFilePath(state.userId, {
          id: state.fileId,
          name: state.fileName,
          parentId: state.parentId,
        });
      } else if (GithubDisk.isGithubId(state.userId)) {
        if (trimmed !== prevName) {
          await GithubDisk.renameFile(state.userId, state.fileId, trimmed);
        }
        await GithubDisk.updateFileContent(state.userId, state.fileId, editorEl.value, state.mimeType);
        state.filePath = await GithubDisk.buildNotepadFilePath(state.userId, {
          id: state.fileId,
          name: state.fileName,
          parentId: state.parentId,
        });
      } else {
        const token = await Auth.ensureValidToken(state.userId);
        if (trimmed !== prevName) {
          await Drive.renameFile(token, state.fileId, trimmed);
        }
        await Drive.updateFileContent(token, state.fileId, editorEl.value, state.mimeType);
        await updateFilePathInUrl();
      }
      hideBanner();
      state.dirty = false;
      updateStatus();
      syncBrowserUrl();
      app.showStatus(`Saved as "${trimmed}"`);
      app.clearTreeCache?.(state.userId);
      await app.refresh?.();
    } catch (err) {
      state.fileName = prevName;
      await handleSaveFailure(err);
    }
  }

  function selectAll() {
    editorEl.focus();
    editorEl.select();
    updateCaretStatus();
  }

  function insertTimeDate() {
    insertAtCursor(new Date().toLocaleString());
  }

  function insertAtCursor(text) {
    pushEditSnapshot();
    const start = editorEl.selectionStart;
    const end = editorEl.selectionEnd;
    const value = editorEl.value;
    editorEl.value = value.slice(0, start) + text + value.slice(end);
    const pos = start + text.length;
    editorEl.setSelectionRange(pos, pos);
    editorEl.focus();
    editHistory.pending = captureSnapshot();
    state.dirty = true;
    updateStatus();
  }

  function printDoc() {
    const win = window.open('', '_blank');
    if (!win) return;
    win.document.write(
      '<pre style="font:12pt monospace;white-space:pre-wrap;margin:24px;">' +
      editorEl.value.replace(/&/g, '&amp;').replace(/</g, '&lt;') +
      '</pre>'
    );
    win.document.close();
    win.focus();
    win.print();
  }

  async function close(force = false) {
    if (!force && state.dirty) {
      const action = await Dialog.choose({
        title: 'Notepad',
        message: `Save changes to ${state.fileName}?`,
        buttons: [
          { id: 'save', label: 'Save', primary: true },
          { id: 'discard', label: "Don't save" },
          { id: 'cancel', label: 'Cancel' },
        ],
      });
      if (action === 'save') {
        await save();
        if (state.dirty) return;
      } else if (action === 'discard') {
        // continue closing
      } else {
        return;
      }
    }

    if (isStandalone) {
      window.close();
      return;
    }
    hide();
  }

  function hide() {
    closeAllMenus();
    hideBanner();
    rootEl?.classList.add('hidden');
    state.fileId = null;
    state.dirty = false;
    editorEl.value = '';
  }

  async function runAction(action) {
    switch (action) {
      case 'save':
        await save();
        break;
      case 'save-as':
        await saveAs();
        break;
      case 'close':
        await close();
        break;
      case 'find':
        openFindBar('find');
        break;
      case 'replace':
      case 'find-replace':
        openFindBar('replace');
        break;
      case 'undo':
        undo();
        break;
      case 'redo':
        redo();
        break;
      case 'select-all':
        selectAll();
        break;
      case 'time-date':
        insertTimeDate();
        break;
      case 'wrap':
        setWordWrap(!state.wordWrap);
        break;
      case 'print':
        printDoc();
        break;
      case 'about':
        await Dialog.alert(
          'A simple text editor for .txt and .json files on Google Drive, local storage, and GitHub repos.',
          { title: `${typeof SITE !== 'undefined' ? SITE.name : 'Storage Hub'} Notepad` }
        );
        break;
    }
  }

  return { init, initStandalone, open, openInTab, isOpen: isActive, close };
})();
