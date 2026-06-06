const Notepad = (() => {
  let rootEl = null;
  let editorEl = null;
  let titleEl = null;
  let modifiedEl = null;
  let positionEl = null;
  let statusEl = null;
  let wrapBtn = null;
  let app = null;
  let isStandalone = false;

  const state = {
    fileId: null,
    fileName: '',
    mimeType: 'text/plain',
    userId: null,
    filePath: '',
    dirty: false,
    wordWrap: true,
    loading: false,
  };

  function getNotepadBasePath() {
    if (typeof BasePath !== 'undefined') return BasePath.get();
    if (typeof Router !== 'undefined') return Router.getBasePath();
    return '';
  }

  function buildEditorUrl(filePath) {
    const base = getNotepadBasePath();
    const page = base ? `${base}/notepad.html` : '/notepad.html';
    const params = new URLSearchParams({ file: filePath });
    return `${page}?${params}`;
  }

  function syncBrowserUrl() {
    if (!isStandalone || !state.filePath) return;
    const url = buildEditorUrl(state.filePath);
    if (location.pathname + location.search !== url) {
      history.replaceState(null, '', url);
    }
  }

  async function updateFilePathInUrl() {
    if (!isStandalone || !state.userId || !state.fileId) return;
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
    wrapBtn = document.getElementById('notepad-wrap-toggle');

    rootEl?.querySelector('.notepad-close')?.addEventListener('click', () => close());
    if (!isStandalone) {
      rootEl?.addEventListener('click', (e) => {
        if (e.target === rootEl) close();
      });
    }

    editorEl?.addEventListener('input', () => {
      state.dirty = true;
      updateStatus();
    });
    editorEl?.addEventListener('click', updateCaretStatus);
    editorEl?.addEventListener('keyup', updateCaretStatus);
    editorEl?.addEventListener('scroll', updateCaretStatus);

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

    document.addEventListener('click', (e) => {
      if (!isActive()) return;
      if (e.target.closest('.notepad-menubar')) return;
      closeAllMenus();
    });

    document.addEventListener('keydown', handleKeydown);
  }

  function initStandalone() {
    init({
      showError: (msg) => alert(msg),
      showStatus: (msg) => {
        if (!statusEl) return;
        statusEl.textContent = msg;
        setTimeout(() => {
          if (statusEl.textContent === msg) statusEl.textContent = '';
        }, 3000);
      },
    });

    Auth.init(async (result) => {
      if (!result.initialized) return;
      await loadFromUrl();
    });
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
        app.showError(`User not signed in. Open ${typeof SITE !== 'undefined' ? SITE.name : 'Mikus Drive'} and sign in first.`);
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
        return;
      } catch (err) {
        app.showError(err.message);
        return;
      }
    }

    const segments = Drive.parseNotepadFilePath(fileParam);
    const user = Auth.getUsers().find((u) => Auth.formatDisplayEmail(u.email) === segments[0]);
    if (!user) {
      app.showError(`User not signed in. Open ${typeof SITE !== 'undefined' ? SITE.name : 'Mikus Drive'} and sign in first.`);
      return;
    }

    try {
      const token = await Auth.ensureValidToken(user.id);
      const meta = await Drive.resolveFileByPath(token, segments);
      if (!Drive.isNotepadFile(meta)) {
        app.showError('Only .txt and .json files can be opened in Notepad.');
        return;
      }
      state.filePath = fileParam.startsWith('/') ? fileParam : `/${fileParam}`;
      syncBrowserUrl();
      await open(meta, user.id);
    } catch (err) {
      app.showError(err.message);
    }
  }

  function closeAllMenus() {
    rootEl?.querySelectorAll('.notepad-menu.open').forEach((menu) => {
      menu.classList.remove('open');
    });
    if (document.activeElement?.closest?.('.notepad-menu-dropdown')) {
      document.activeElement.blur();
    }
  }

  function isActive() {
    return isStandalone || (rootEl && !rootEl.classList.contains('hidden'));
  }

  function handleKeydown(e) {
    if (!isActive()) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      if (rootEl?.querySelector('.notepad-menu.open')) {
        closeAllMenus();
        return;
      }
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
        findText();
      }
      if (e.key === 'h') {
        e.preventDefault();
        replaceText();
      }
      if (e.key === 'w') {
        e.preventDefault();
        close();
      }
    }
  }

  function setWordWrap(enabled) {
    state.wordWrap = enabled;
    editorEl.classList.toggle('notepad-editor--wrap', enabled);
    editorEl.wrap = enabled ? 'soft' : 'off';
    wrapBtn?.classList.toggle('active', enabled);
    wrapBtn?.setAttribute('aria-pressed', String(enabled));
  }

  function updateStatus() {
    modifiedEl.textContent = state.dirty ? '*' : '';
    const suffix = state.dirty ? '*' : '';
    const title = `${state.fileName}${suffix} - Notepad`;
    titleEl.textContent = title;
    document.title = title;
    updateCaretStatus();
  }

  function updateCaretStatus() {
    const text = editorEl.value;
    const pos = editorEl.selectionStart;
    const before = text.slice(0, pos);
    const lines = before.split('\n');
    const line = lines.length;
    const col = lines[lines.length - 1].length + 1;
    positionEl.textContent = `Ln ${line}, Col ${col}`;
  }

  async function openInTab(file, userId) {
    const user = Auth.getUsers().find((u) => u.id === userId);
    if (!user) throw new Error('User not found');
    const token = await Auth.ensureValidToken(userId);
    const filePath = await Drive.buildNotepadFilePath(
      token,
      Auth.formatDisplayEmail(user.email),
      file
    );
    window.open(buildEditorUrl(filePath), '_blank', 'noopener');
  }

  async function open(file, userId) {
    state.fileId = file.id;
    state.fileName = file.name;
    state.mimeType = file.mimeType || 'text/plain';
    state.userId = userId;
    state.dirty = false;
    state.loading = true;

    updateStatus();
    editorEl.value = '';
    editorEl.disabled = true;
    modifiedEl.textContent = '';
    positionEl.textContent = 'Loading…';
    if (!isStandalone) rootEl.classList.remove('hidden');
    setWordWrap(state.wordWrap);

    try {
      const token = await Auth.ensureValidToken(userId);
      const content = await Drive.getTextFileContent(token, file.id);
      editorEl.value = content;
      state.dirty = false;
      updateStatus();
    } catch (err) {
      app.showError(err.message);
      await close(true);
    } finally {
      editorEl.disabled = false;
      state.loading = false;
      if (!state.filePath) await updateFilePathInUrl();
      editorEl.focus();
    }
  }

  async function save() {
    if (state.loading || !state.fileId) return;
    try {
      const token = await Auth.ensureValidToken(state.userId);
      await Drive.updateFileContent(token, state.fileId, editorEl.value, state.mimeType);
      state.dirty = false;
      updateStatus();
      app.showStatus(`Saved "${state.fileName}"`);
      app.clearTreeCache?.(state.userId);
    } catch (err) {
      app.showError(err.message);
    }
  }

  async function saveAs() {
    const name = prompt('Save as:', state.fileName);
    if (!name?.trim()) return;

    const trimmed = name.trim();
    try {
      const token = await Auth.ensureValidToken(state.userId);
      if (trimmed !== state.fileName) {
        await Drive.renameFile(token, state.fileId, trimmed);
        state.fileName = trimmed;
      }
      await Drive.updateFileContent(token, state.fileId, editorEl.value, state.mimeType);
      state.dirty = false;
      updateStatus();
      await updateFilePathInUrl();
      app.showStatus(`Saved as "${trimmed}"`);
      app.clearTreeCache?.(state.userId);
      await app.refresh?.();
    } catch (err) {
      app.showError(err.message);
    }
  }

  function findText() {
    const query = prompt('Find:');
    if (!query) return;

    const text = editorEl.value;
    const start = editorEl.selectionEnd;
    let idx = text.indexOf(query, start);
    if (idx === -1) idx = text.indexOf(query, 0);
    if (idx === -1) {
      alert('Cannot find "' + query + '"');
      return;
    }
    editorEl.focus();
    editorEl.setSelectionRange(idx, idx + query.length);
    updateCaretStatus();
  }

  function replaceText() {
    const query = prompt('Find:');
    if (!query) return;
    const replacement = prompt('Replace with:', '');
    if (replacement == null) return;

    if (!editorEl.value.includes(query)) {
      alert('Cannot find "' + query + '"');
      return;
    }
    editorEl.value = editorEl.value.split(query).join(replacement);
    state.dirty = true;
    updateStatus();
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
    const start = editorEl.selectionStart;
    const end = editorEl.selectionEnd;
    const value = editorEl.value;
    editorEl.value = value.slice(0, start) + text + value.slice(end);
    const pos = start + text.length;
    editorEl.setSelectionRange(pos, pos);
    editorEl.focus();
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
      if (confirm('Save changes to ' + state.fileName + '?')) {
        await save();
      } else if (!confirm('Discard unsaved changes?')) {
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
        findText();
        break;
      case 'replace':
        replaceText();
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
        alert(`${typeof SITE !== 'undefined' ? SITE.name : 'Mikus Drive'} Notepad\nA simple text editor for .txt and .json Drive files.`);
        break;
    }
  }

  return { init, initStandalone, open, openInTab, isOpen: isActive, close };
})();
