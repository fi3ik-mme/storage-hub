const GithubDisk = (() => {
  const ROOT_ID = 'root';
  const FOLDER_MIME = 'application/x-github-folder';
  const ID_PREFIX = 'github:';
  const STORAGE_KEY = 'storage_hub_github_disks';
  const LEGACY_STORAGE_KEY = 'mikus_drive_github_disks';
  const OAUTH_MESSAGE_SOURCE = 'storage-hub-github-oauth';
  const API_BASE = 'https://api.github.com';
  // GitHub docs: recommend repos under 1 GB; repos above ~100 GB may be blocked.
  const RECOMMENDED_REPO_SIZE_BYTES = 1024 * 1024 * 1024;
  const MAX_REPO_SIZE_BYTES = 100 * 1024 * 1024 * 1024;

  let disks = [];
  const repoTreeCache = new Map();
  const pendingByFolder = new Map();
  const saveStateByPath = new Map();
  const moveStateByPath = new Map();
  const pendingConfirmTimers = new Map();
  const saveConfirmTimers = new Map();
  const moveConfirmTimers = new Map();
  let listChangeListener = null;
  let saveStateListener = null;

  function setSaveStateListener(listener) {
    saveStateListener = typeof listener === 'function' ? listener : null;
  }

  function getFileSaveState(diskId, filePath) {
    return saveStateByPath.get(saveStateKey(diskId, filePath)) || null;
  }

  function saveStateKey(diskId, filePath) {
    return `${diskId}\0${normalizePath(filePath)}`;
  }

  function getPendingStatusLabel(status, options = {}) {
    if (status === 'syncing') return 'Uploading…';
    if (status === 'saving') return 'Saving…';
    if (status === 'moving') return 'Moving…';
    if (status === 'pending') {
      if (options.kind === 'save') return 'Pending save…';
      if (options.kind === 'move') return 'Pending movement…';
      return 'Pending on GitHub…';
    }
    if (status === 'error') return options.error || 'Failed';
    return 'Syncing…';
  }

  function moveStateKey(diskId, sourcePath) {
    return `${diskId}\0${normalizePath(sourcePath)}`;
  }

  function getActiveMoves(diskId) {
    const prefix = `${diskId}\0`;
    const moves = [];
    for (const [key, state] of moveStateByPath.entries()) {
      if (key.startsWith(prefix)) moves.push(state);
    }
    return moves;
  }

  function findActiveMoveForPath(diskId, filePath) {
    const path = normalizePath(filePath);
    if (!path) return null;
    for (const move of getActiveMoves(diskId)) {
      const source = normalizePath(move.sourcePath);
      if (!source) continue;
      if (path === source || path.startsWith(`${source}/`) || source.startsWith(`${path}/`)) {
        return move;
      }
    }
    return null;
  }

  function notifySaveStateChange(diskId, filePath) {
    const state = getFileSaveState(diskId, filePath);
    saveStateListener?.(diskId, filePath, state);
    notifyListChange(diskId);
  }
  function setListChangeListener(listener) {
    listChangeListener = typeof listener === 'function' ? listener : null;
  }

  function notifyListChange(diskId) {
    listChangeListener?.(diskId);
  }

  function invalidateRepoTree(diskId) {
    if (diskId) repoTreeCache.delete(diskId);
    else repoTreeCache.clear();
  }

  function pendingFolderKey(diskId, parentId) {
    const parent = !parentId || parentId === ROOT_ID ? ROOT_ID : normalizePath(parentId);
    return `${diskId}\0${parent}`;
  }

  function addPending(diskId, parentId, meta) {
    const tempId = `pending:${crypto.randomUUID()}`;
    const key = pendingFolderKey(diskId, parentId);
    const list = pendingByFolder.get(key) || [];
    list.push({
      tempId,
      name: meta.name,
      isFolder: !!meta.isFolder,
      mimeType: meta.mimeType || (meta.isFolder ? FOLDER_MIME : inferMimeType(meta.name)),
      size: meta.size || 0,
      status: meta.status || 'syncing',
      kind: meta.kind || 'create',
      error: null,
      expectedPath: meta.expectedPath || null,
      sourcePath: meta.sourcePath || null,
    });
    pendingByFolder.set(key, list);
    notifyListChange(diskId);
    return tempId;
  }

  function findPendingEntry(tempId) {
    for (const [key, list] of pendingByFolder.entries()) {
      const entry = list.find((item) => item.tempId === tempId);
      if (!entry) continue;
      const [diskId, parentId] = key.split('\0');
      return { key, entry, diskId, parentId };
    }
    return null;
  }

  function resolvePending(tempId) {
    for (const [key, list] of pendingByFolder.entries()) {
      const idx = list.findIndex((entry) => entry.tempId === tempId);
      if (idx === -1) continue;
      list.splice(idx, 1);
      if (!list.length) pendingByFolder.delete(key);
      else pendingByFolder.set(key, list);
      notifyListChange(key.split('\0')[0]);
      return;
    }
  }

  function failPending(tempId, message) {
    for (const [key, list] of pendingByFolder.entries()) {
      const entry = list.find((item) => item.tempId === tempId);
      if (!entry) continue;
      entry.status = 'error';
      entry.error = message || 'Upload failed';
      notifyListChange(key.split('\0')[0]);
      return;
    }
  }

  function getPendingEntries(diskId, parentId) {
    return (pendingByFolder.get(pendingFolderKey(diskId, parentId)) || []).slice();
  }

  function mapPendingFile(diskId, parentId, entry) {
    const parent = !parentId || parentId === ROOT_ID ? ROOT_ID : normalizePath(parentId);
    const mimeType = entry.mimeType || (entry.isFolder ? FOLDER_MIME : inferMimeType(entry.name));
    const isError = entry.status === 'error';
    const statusLabel = getPendingStatusLabel(entry.status, { kind: entry.kind || 'create', error: entry.error });
    return {
      id: entry.tempId,
      name: entry.name,
      isFolder: !!entry.isFolder,
      mimeType,
      icon: entry.isFolder ? '📁' : mimeType === 'application/json' ? '📋' : mimeType.startsWith('text/') ? '📝' : '📄',
      parents: [parent],
      parentId: parent,
      size: entry.size || 0,
      sizeFormatted: entry.size ? formatSize(entry.size) : '—',
      dateFormatted: statusLabel,
      typeName: entry.isFolder ? 'Folder' : 'File',
      pending: true,
      pendingStatus: entry.status,
      pendingKind: entry.kind || 'create',
      pendingError: entry.error,
    };
  }

  function applyMoveStateToFiles(diskId, files) {
    return files.map((file) => {
      if (file.pending) return file;
      const moveState = findActiveMoveForPath(diskId, file.id);
      if (!moveState) return file;
      return {
        ...file,
        pending: true,
        pendingStatus: moveState.status,
        pendingKind: 'move',
        pendingError: moveState.error,
        dateFormatted: getPendingStatusLabel(moveState.status, {
          kind: 'move',
          error: moveState.error,
        }),
      };
    });
  }

  function resolveMove(diskId, sourcePath) {
    const key = moveStateKey(diskId, sourcePath);
    const moveState = moveStateByPath.get(key);
    if (!moveState) return;
    if (moveState.destPendingId) resolvePending(moveState.destPendingId);
    moveStateByPath.delete(key);
    moveConfirmTimers.delete(key);
    notifyListChange(diskId);
  }

  function isSourcePathGoneFromTree(tree, sourcePath, isFolder) {
    const path = normalizePath(sourcePath);
    if (!path) return true;
    if (isFolder) {
      return !tree.some((entry) => {
        const entryPath = entry.path || '';
        return entryPath === path
          || entryPath === `${path}/.keep`
          || entryPath.startsWith(`${path}/`);
      });
    }
    return !tree.some((entry) => entry.type === 'blob' && entry.path === path);
  }

  async function confirmMoveOnServer(diskId, sourcePath) {
    const key = moveStateKey(diskId, sourcePath);
    const moveState = moveStateByPath.get(key);
    if (!moveState || (moveState.status !== 'pending' && moveState.status !== 'moving')) return false;

    const disk = getDisk(diskId);
    if (!disk) {
      resolveMove(diskId, sourcePath);
      return true;
    }

    const destPath = normalizePath(moveState.destPath);
    try {
      const tree = await getRepoTree(disk, { force: true });
      const destVisible = isPathVisibleInTree(tree, destPath, moveState.isFolder);
      const sourceGone = isSourcePathGoneFromTree(tree, moveState.sourcePath, moveState.isFolder);
      if (destVisible && sourceGone) {
        resolveMove(diskId, sourcePath);
        invalidateRepoTree(diskId);
        return true;
      }
    } catch {
      // GitHub may still be updating — keep polling.
    }
    return false;
  }

  function scheduleMoveConfirmation(diskId, sourcePath) {
    const key = moveStateKey(diskId, sourcePath);
    if (moveConfirmTimers.has(key)) return;

    let attempts = 0;
    const maxAttempts = 90;

    const tick = async () => {
      attempts += 1;
      const moveState = moveStateByPath.get(key);
      if (!moveState || (moveState.status !== 'pending' && moveState.status !== 'moving')) {
        moveConfirmTimers.delete(key);
        return;
      }

      const confirmed = await confirmMoveOnServer(diskId, sourcePath);
      if (confirmed) {
        moveConfirmTimers.delete(key);
        return;
      }

      if (attempts >= maxAttempts) {
        moveState.status = 'error';
        moveState.error = 'Timed out waiting for GitHub to confirm the move';
        if (moveState.destPendingId) failPending(moveState.destPendingId, moveState.error);
        notifyListChange(diskId);
        moveConfirmTimers.delete(key);
        return;
      }

      moveConfirmTimers.set(key, setTimeout(tick, 2000));
    };

    moveConfirmTimers.set(key, setTimeout(tick, 1000));
  }

  async function runPendingMove(diskId, sourcePath, toParentId, meta, action) {
    const key = moveStateKey(diskId, sourcePath);
    const destPendingId = addPending(diskId, toParentId, {
      name: meta.name,
      isFolder: meta.isFolder,
      mimeType: meta.mimeType,
      size: meta.size || 0,
      status: 'moving',
      kind: 'move',
      sourcePath: normalizePath(sourcePath),
      expectedPath: normalizePath(meta.destPath),
    });

    moveStateByPath.set(key, {
      status: 'moving',
      sourcePath: normalizePath(sourcePath),
      destPath: normalizePath(meta.destPath),
      destParentId: toParentId,
      destPendingId,
      name: meta.name,
      isFolder: !!meta.isFolder,
      mimeType: meta.mimeType,
      error: null,
    });
    notifyListChange(diskId);

    try {
      await action();
      const moveState = moveStateByPath.get(key);
      if (moveState) moveState.status = 'pending';
      invalidateRepoTree(diskId);
      markPendingAwaitingConfirmation(destPendingId, meta.destPath, meta.isFolder);
      scheduleMoveConfirmation(diskId, sourcePath);
      confirmMoveOnServer(diskId, sourcePath);
      notifyListChange(diskId);
      return { id: meta.destPath, name: meta.name, isFolder: !!meta.isFolder };
    } catch (err) {
      failPending(destPendingId, err?.message || String(err));
      moveStateByPath.set(key, {
        ...moveStateByPath.get(key),
        status: 'error',
        error: err?.message || String(err),
      });
      notifyListChange(diskId);
      throw err;
    }
  }

  function applySaveStateToFiles(diskId, files) {
    return files.map((file) => {
      if (file.isFolder || file.pending) return file;
      const saveState = getFileSaveState(diskId, file.id);
      if (!saveState) return file;
      return {
        ...file,
        pending: true,
        pendingStatus: saveState.status,
        pendingError: saveState.error,
        pendingKind: 'save',
        dateFormatted: getPendingStatusLabel(saveState.status, {
          kind: 'save',
          error: saveState.error,
        }),
      };
    });
  }

  function resolveFileSave(diskId, filePath) {
    const key = saveStateKey(diskId, filePath);
    if (!saveStateByPath.has(key)) return;
    saveStateByPath.delete(key);
    saveConfirmTimers.delete(key);
    notifySaveStateChange(diskId, filePath);
  }

  async function confirmFileSaveOnServer(diskId, filePath) {
    const key = saveStateKey(diskId, filePath);
    const saveState = saveStateByPath.get(key);
    if (!saveState || saveState.status !== 'pending') return false;

    const disk = getDisk(diskId);
    if (!disk) {
      resolveFileSave(diskId, filePath);
      return true;
    }

    const path = normalizePath(filePath);
    try {
      if (saveState.expectedSha) {
        const meta = await getFileContentMeta(disk, path);
        if (meta?.sha === saveState.expectedSha) {
          resolveFileSave(diskId, filePath);
          invalidateRepoTree(diskId);
          return true;
        }
      } else {
        const tree = await getRepoTree(disk, { force: true });
        if (isPathVisibleInTree(tree, path, false)) {
          resolveFileSave(diskId, filePath);
          invalidateRepoTree(diskId);
          return true;
        }
      }
    } catch {
      // GitHub may still be updating — keep polling.
    }
    return false;
  }

  function scheduleFileSaveConfirmation(diskId, filePath) {
    const key = saveStateKey(diskId, filePath);
    if (saveConfirmTimers.has(key)) return;

    let attempts = 0;
    const maxAttempts = 90;

    const tick = async () => {
      attempts += 1;
      const saveState = saveStateByPath.get(key);
      if (!saveState || saveState.status !== 'pending') {
        saveConfirmTimers.delete(key);
        return;
      }

      const confirmed = await confirmFileSaveOnServer(diskId, filePath);
      if (confirmed) {
        saveConfirmTimers.delete(key);
        return;
      }

      if (attempts >= maxAttempts) {
        saveState.status = 'error';
        saveState.error = 'Timed out waiting for GitHub to confirm the save';
        notifySaveStateChange(diskId, filePath);
        saveConfirmTimers.delete(key);
        return;
      }

      saveConfirmTimers.set(key, setTimeout(tick, 2000));
    };

    saveConfirmTimers.set(key, setTimeout(tick, 1000));
  }

  function markFileSavePending(diskId, filePath, expectedSha) {
    const key = saveStateKey(diskId, filePath);
    const existing = saveStateByPath.get(key);
    if (!existing) return;
    existing.status = 'pending';
    existing.expectedSha = expectedSha || null;
    saveStateByPath.set(key, existing);
    notifySaveStateChange(diskId, filePath);
    scheduleFileSaveConfirmation(diskId, filePath);
    confirmFileSaveOnServer(diskId, filePath);
  }

  async function runPendingFileSave(diskId, filePath, meta, action) {
    const path = normalizePath(filePath);
    const key = saveStateKey(diskId, path);
    saveStateByPath.set(key, {
      status: 'saving',
      error: null,
      expectedSha: null,
      kind: 'save',
      name: meta?.name || path.split('/').pop(),
      size: meta?.size || 0,
    });
    notifySaveStateChange(diskId, path);

    try {
      const result = await action();
      markFileSavePending(diskId, path, result?.expectedSha || null);
      return result;
    } catch (err) {
      saveStateByPath.set(key, {
        status: 'error',
        error: err?.message || String(err),
        expectedSha: null,
        kind: 'save',
        name: meta?.name || path.split('/').pop(),
        size: meta?.size || 0,
      });
      notifySaveStateChange(diskId, path);
      throw err;
    }
  }

  function mergePendingFiles(diskId, parentId, files) {
    const withSaveState = applySaveStateToFiles(diskId, files);
    const withMoveState = applyMoveStateToFiles(diskId, withSaveState);
    reconcilePendingWithServer(diskId, parentId, withMoveState);
    const pending = getPendingEntries(diskId, parentId);
    if (!pending.length) return withMoveState;
    const names = new Set(withMoveState.map((file) => file.name.toLowerCase()));
    const extras = pending
      .filter((entry) => {
        if (names.has(entry.name.toLowerCase())) return false;
        return entry.status === 'syncing'
          || entry.status === 'moving'
          || entry.status === 'pending'
          || entry.status === 'error';
      })
      .map((entry) => mapPendingFile(diskId, parentId, entry));
    return [...withMoveState, ...extras].sort((a, b) => {
      if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }

  function buildExpectedPath(parentId, name) {
    const parentPath = normalizePath(parentId);
    return parentPath ? `${parentPath}/${name}` : name;
  }

  function reconcilePendingWithServer(diskId, parentId, files) {
    const key = pendingFolderKey(diskId, parentId);
    const list = pendingByFolder.get(key);
    if (!list?.length) return;

    const names = new Set(files.map((file) => file.name.toLowerCase()));
    let changed = false;

    for (let i = list.length - 1; i >= 0; i -= 1) {
      const entry = list[i];
      if ((entry.status === 'pending' || entry.status === 'syncing' || entry.status === 'moving') && names.has(entry.name.toLowerCase())) {
        pendingConfirmTimers.delete(entry.tempId);
        list.splice(i, 1);
        changed = true;
      }
    }

    if (!list.length) pendingByFolder.delete(key);
    else pendingByFolder.set(key, list);
    if (changed) notifyListChange(diskId);
  }

  function isPathVisibleInTree(tree, expectedPath, isFolder) {
    const path = normalizePath(expectedPath);
    if (!path) return false;
    if (isFolder) {
      return tree.some((entry) => {
        const entryPath = entry.path || '';
        return entryPath === path
          || entryPath === `${path}/.keep`
          || entryPath.startsWith(`${path}/`);
      });
    }
    return tree.some((entry) => entry.type === 'blob' && entry.path === path);
  }

  async function confirmPendingOnServer(diskId, tempId) {
    const located = findPendingEntry(tempId);
    if (!located || located.entry.status !== 'pending') return false;

    const disk = getDisk(diskId);
    if (!disk) {
      resolvePending(tempId);
      return true;
    }

    const expectedPath = located.entry.expectedPath || buildExpectedPath(located.parentId, located.entry.name);
    try {
      const tree = await getRepoTree(disk, { force: true });
      if (isPathVisibleInTree(tree, expectedPath, located.entry.isFolder)) {
        resolvePending(tempId);
        invalidateRepoTree(diskId);
        notifyListChange(diskId);
        return true;
      }
    } catch {
      // GitHub may still be updating — keep polling.
    }
    return false;
  }

  function schedulePendingConfirmation(diskId, tempId) {
    if (pendingConfirmTimers.has(tempId)) return;

    let attempts = 0;
    const maxAttempts = 90;

    const tick = async () => {
      attempts += 1;
      const located = findPendingEntry(tempId);
      if (!located || located.entry.status !== 'pending') {
        pendingConfirmTimers.delete(tempId);
        return;
      }

      const confirmed = await confirmPendingOnServer(diskId, tempId);
      if (confirmed) {
        pendingConfirmTimers.delete(tempId);
        return;
      }

      if (attempts >= maxAttempts) {
        failPending(tempId, 'Timed out waiting for GitHub to list this item');
        pendingConfirmTimers.delete(tempId);
        return;
      }

      pendingConfirmTimers.set(tempId, setTimeout(tick, 2000));
    };

    pendingConfirmTimers.set(tempId, setTimeout(tick, 1000));
  }

  function markPendingAwaitingConfirmation(tempId, expectedPath, isFolder) {
    const located = findPendingEntry(tempId);
    if (!located) return;
    located.entry.status = 'pending';
    located.entry.expectedPath = normalizePath(expectedPath);
    located.entry.isFolder = !!isFolder;
    notifyListChange(located.diskId);
    schedulePendingConfirmation(located.diskId, tempId);
    confirmPendingOnServer(located.diskId, tempId);
  }

  async function runPendingMutation(diskId, parentId, meta, action) {
    const tempId = addPending(diskId, parentId, meta);
    try {
      const result = await action();
      const expectedPath = result?.id
        ? normalizePath(result.id)
        : buildExpectedPath(parentId, meta.name);
      invalidateRepoTree(diskId);
      markPendingAwaitingConfirmation(tempId, expectedPath, meta.isFolder);
      notifyListChange(diskId);
      return result;
    } catch (err) {
      failPending(tempId, err?.message || String(err));
      throw err;
    }
  }

  function isBrowserViewableFile(file) {
    if (!file || file.isFolder || file.pending) return false;
    const mime = String(file.mimeType || '').toLowerCase();
    const name = String(file.name || '').toLowerCase();
    if (mime.startsWith('image/')) return true;
    if (mime === 'application/pdf') return true;
    if (mime === 'text/html') return true;
    if (mime.startsWith('video/') || mime.startsWith('audio/')) return true;
    return /\.(png|jpe?g|gif|webp|svg|bmp|ico|avif|pdf|mp4|webm|mp3|wav|ogg|html?)$/i.test(name);
  }

  function getRepoWebUrl(diskId) {
    const disk = getDisk(diskId);
    if (!disk) throw new Error('GitHub storage not found');
    const base = disk.repoHtmlUrl || `https://github.com/${disk.owner}/${disk.repo}`;
    const branch = disk.branch || 'main';
    return `${base}/tree/${branch}`;
  }

  function getItemWebUrl(diskId, itemId, isFolder = false) {
    const disk = getDisk(diskId);
    if (!disk) throw new Error('GitHub storage not found');
    const path = normalizePath(itemId);
    if (String(itemId).startsWith('pending:')) {
      throw new Error('Item is not available on GitHub yet');
    }
    if (!path || path === ROOT_ID) return getRepoWebUrl(diskId);
    const base = disk.repoHtmlUrl || `https://github.com/${disk.owner}/${disk.repo}`;
    const branch = disk.branch || 'main';
    const encodedPath = encodeRepoPath(path);
    return isFolder
      ? `${base}/tree/${branch}/${encodedPath}`
      : `${base}/blob/${branch}/${encodedPath}`;
  }

  function getFileViewUrl(diskId, fileId) {
    const disk = getDisk(diskId);
    if (!disk) throw new Error('GitHub storage not found');
    const path = normalizePath(fileId);
    if (!path || String(fileId).startsWith('pending:')) {
      throw new Error('File is not available to open yet');
    }
    const encodedPath = encodeRepoPath(path);
    const branch = disk.branch || 'main';
    if (disk.private) {
      return `https://github.com/${disk.owner}/${disk.repo}/blob/${branch}/${encodedPath}`;
    }
    return `https://raw.githubusercontent.com/${disk.owner}/${disk.repo}/${branch}/${encodedPath}`;
  }

  function loadDisks() {
    try {
      if (typeof StorageMigrate !== 'undefined') {
        StorageMigrate.migrateLocalStorageKey(STORAGE_KEY, [LEGACY_STORAGE_KEY]);
      } else if (!localStorage.getItem(STORAGE_KEY) && localStorage.getItem(LEGACY_STORAGE_KEY)) {
        localStorage.setItem(STORAGE_KEY, localStorage.getItem(LEGACY_STORAGE_KEY));
      }
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{"disks":[]}');
      disks = (raw.disks || []).map((disk) => ({
        ...disk,
        id: disk.id || `${ID_PREFIX}${disk.owner}/${disk.repo}`,
      }));
    } catch {
      disks = [];
    }
  }

  function saveDisks() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ disks }));
  }

  function init() {
    loadDisks();
  }

  function isGithubId(id) {
    return typeof id === 'string' && id.startsWith(ID_PREFIX);
  }

  function getDisks() {
    return disks.slice();
  }

  function getDisk(diskId) {
    return disks.find((d) => d.id === diskId) || null;
  }

  function getDiskByName(name) {
    return disks.find((d) => d.name === name) || null;
  }

  function ensureConfigured() {
    const clientId = CONFIG.GITHUB_CLIENT_ID || '';
    if (!clientId || clientId === 'YOUR_GITHUB_CLIENT_ID') {
      throw new Error('Set CONFIG.GITHUB_CLIENT_ID in js/config.js to enable GitHub storage');
    }
  }

  function resolveAssetUrl(path) {
    if (!path) return path;
    if (/^https?:/i.test(path) || path.startsWith('data:') || path.startsWith('blob:')) return path;
    return typeof BasePath !== 'undefined' ? BasePath.prefixRelativeAsset(path) : path;
  }

  function randomString(size = 64) {
    const bytes = new Uint8Array(size);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }

  function toBase64Url(bytes) {
    let str = '';
    bytes.forEach((b) => {
      str += String.fromCharCode(b);
    });
    return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }

  async function createCodeChallenge(codeVerifier) {
    const data = new TextEncoder().encode(codeVerifier);
    const digest = await crypto.subtle.digest('SHA-256', data);
    return toBase64Url(new Uint8Array(digest));
  }

  function isGithubPagesHost() {
    return /(^|\.)github\.io$/i.test(location.hostname);
  }

  function getAppDirectoryFromLocation() {
    const path = location.pathname.replace(/\/+$/, '') || '/';
    if (/\.html$/i.test(path)) {
      return path.slice(0, path.lastIndexOf('/')) || '';
    }
    return path === '/' ? '' : path;
  }

  function getOAuthRedirectUri() {
    if (CONFIG.GITHUB_REDIRECT_URI) {
      return String(CONFIG.GITHUB_REDIRECT_URI).replace(/\/$/, '');
    }

    let basePath = '';
    if (isGithubPagesHost()) {
      basePath = typeof BasePath !== 'undefined' ? BasePath.get() : '';
    } else {
      basePath = getAppDirectoryFromLocation();
    }

    const path = basePath ? `${basePath}/github-oauth-callback.html` : '/github-oauth-callback.html';
    return new URL(path, location.origin).href.replace(/\/$/, '');
  }

  function getAllowedOAuthMessageOrigins() {
    const origins = new Set([location.origin]);
    try {
      origins.add(new URL(getOAuthRedirectUri()).origin);
    } catch {
      // ignore invalid redirect URI
    }
    return origins;
  }

  function createOAuthState() {
    return `${location.origin}|${randomString(24)}`;
  }

  function getOAuthRedirectUriHelp() {
    return `Set this exact URL as Authorization callback URL in your GitHub OAuth App:\n${getOAuthRedirectUri()}`;
  }

  function getTokenExchangeUrl() {
    if (CONFIG.GITHUB_TOKEN_EXCHANGE_URL) {
      return String(CONFIG.GITHUB_TOKEN_EXCHANGE_URL).replace(/\/$/, '');
    }

    let basePath = '';
    if (isGithubPagesHost()) {
      basePath = typeof BasePath !== 'undefined' ? BasePath.get() : '';
    } else {
      basePath = getAppDirectoryFromLocation();
    }

    const path = basePath ? `${basePath}/api/github/oauth/token` : '/api/github/oauth/token';
    return new URL(path, location.origin).href;
  }

  function isIdePreviewServer() {
    return location.port === '63342';
  }

  function getIdePreviewHelp() {
    return (
      'IntelliJ/WebStorm preview (port 63342) cannot host the OAuth token proxy.\n\n' +
      'Easiest: retry and choose "Use personal access token" (repo scope).\n\n' +
      'For OAuth popup instead:\n' +
      '  1. Run: python3 serve.py and open http://localhost:8080\n' +
      '  2. Or set GITHUB_TOKEN_EXCHANGE_URL in js/config.js to a deployed proxy (see README)\n' +
      '  3. Register this callback URL in your GitHub OAuth App:\n' +
      `     ${getOAuthRedirectUri()}`
    );
  }

  function prefersPatSignIn() {
    if (CONFIG.GITHUB_USE_PAT) return true;
    if (CONFIG.GITHUB_TOKEN_EXCHANGE_URL) return false;
    return isIdePreviewServer();
  }

  function buildPopupClosedError() {
    if (isIdePreviewServer()) {
      return `GitHub sign-in popup closed before authorization finished.\n\n${getIdePreviewHelp()}`;
    }
    return (
      'GitHub sign-in popup closed before authorization finished.\n\n' +
      'Allow popups for this site. If you approved access on GitHub, retry once.\n\n' +
      getOAuthRedirectUriHelp()
    );
  }

  function getTokenExchangeHelp() {
    if (isGithubPagesHost() && !CONFIG.GITHUB_TOKEN_EXCHANGE_URL) {
      return (
        'GitHub blocks browser token exchange (CORS). GitHub Pages is static hosting,\n' +
        'so you need a token proxy (see README → "GitHub OAuth token proxy").\n\n' +
        'Set GITHUB_TOKEN_EXCHANGE_URL in js/config.js to your deployed proxy URL.\n\n' +
        'For local development run: python3 serve.py and open http://localhost:8080'
      );
    }
    return getTokenProxyUnavailableHelp();
  }

  function getTokenProxyUnavailableHelp() {
    const proxyUrl = getTokenExchangeUrl();
    const lines = [];

    if (isIdePreviewServer()) {
      lines.push(
        'You are on IntelliJ/WebStorm preview (port 63342).',
        'This server cannot run the OAuth token proxy.',
        '',
        'Easiest: retry and choose "Use personal access token" (repo scope).',
        '',
        'For OAuth popup instead, run python3 serve.py and open http://localhost:8080,',
        'or set GITHUB_TOKEN_EXCHANGE_URL in js/config.js to a deployed proxy (see README).',
        '',
        `Token proxy not reachable: ${proxyUrl}`,
      );
    } else if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
      lines.push(
        'The GitHub token proxy is not running.',
        '',
        'Use the project dev server (not python3 -m http.server):',
        '  python3 serve.py',
        '',
        'Then open http://localhost:8080 and register this callback URL in GitHub:',
        '  http://localhost:8080/github-oauth-callback.html',
        '',
        `Expected token proxy: ${proxyUrl}`,
      );
    } else {
      lines.push(
        'GitHub blocks browser token exchange (CORS).',
        '',
        'For local development run: python3 serve.py',
        'then open http://localhost:8080',
        '',
        `Expected token proxy: ${proxyUrl}`,
      );
    }
    return lines.join('\n');
  }

  async function ensureTokenExchangeReachable() {
    if (isGithubPagesHost() && !CONFIG.GITHUB_TOKEN_EXCHANGE_URL) {
      throw new Error(getTokenExchangeHelp());
    }

    const url = getTokenExchangeUrl();
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ client_id: 'reachability-check' }),
      });
      const json = await res.json().catch(() => null);
      if (!json || typeof json !== 'object') {
        throw new Error('invalid proxy response');
      }
    } catch (err) {
      const message = err?.message || String(err);
      if (!/invalid proxy response|failed to fetch|networkerror|load failed/i.test(message)) {
        throw err;
      }
      throw new Error(`GitHub token proxy is not reachable.\n\n${getTokenProxyUnavailableHelp()}`);
    }
  }

  async function exchangeCodeForToken(code, codeVerifier, redirectUri, clientId) {
    const url = getTokenExchangeUrl();
    let tokenRes;
    try {
      tokenRes = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          client_id: clientId,
          code,
          redirect_uri: redirectUri,
          code_verifier: codeVerifier,
        }),
      });
    } catch (err) {
      const message = err?.message || String(err);
      if (/failed to fetch|networkerror|load failed/i.test(message)) {
        throw new Error(`GitHub sign-in failed (${message}).\n\n${getTokenExchangeHelp()}`);
      }
      throw err;
    }

    const tokenJson = await tokenRes.json().catch(() => ({}));
    if (!tokenRes.ok || !tokenJson.access_token) {
      const detail = tokenJson.error_description || tokenJson.error || `HTTP ${tokenRes.status}`;
      if (/incorrect_client_credentials/i.test(`${tokenJson.error || ''} ${detail}`)) {
        throw new Error(
          `${detail}\n\n` +
          'GitHub rejected the OAuth app credentials.\n' +
          '1. Confirm GITHUB_CLIENT_ID in js/config.js matches your GitHub OAuth App.\n' +
          '2. Confirm .github_secret contains that app\'s client secret.\n' +
          '3. Restart python3 serve.py after changing .github_secret (old processes ignore updates).'
        );
      }
      if (tokenRes.status === 404) {
        throw new Error(`${detail}\n\n${getTokenExchangeHelp()}`);
      }
      throw new Error(detail || 'Failed to obtain GitHub access token');
    }
    return tokenJson.access_token;
  }

  function waitForOauthCode(popup, state) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const storageKey = `storage_hub_github_oauth_${state}`;

      const finish = (fn) => {
        if (settled) return;
        settled = true;
        cleanup();
        fn();
      };

      const handlePayload = (data) => {
        if (!data || data.source !== OAUTH_MESSAGE_SOURCE) return;
        if (data.state !== state) {
          finish(() => reject(new Error('Invalid GitHub OAuth state')));
          return;
        }
        if (data.error) {
          finish(() => reject(new Error(data.error_description || data.error || 'GitHub authorization failed')));
          return;
        }
        if (!data.code) {
          finish(() => reject(new Error('GitHub did not return an authorization code')));
          return;
        }
        finish(() => resolve(data.code));
      };

      const timeout = setTimeout(() => {
        finish(() => reject(new Error('GitHub sign-in timed out')));
      }, 120000);

      const onMessage = (event) => {
        if (!getAllowedOAuthMessageOrigins().has(event.origin)) return;
        handlePayload(event.data);
      };

      let channel;
      try {
        channel = new BroadcastChannel('storage-hub-github-oauth');
        channel.onmessage = (event) => handlePayload(event.data);
      } catch {
        // BroadcastChannel not available
      }

      const onStorage = (event) => {
        if (event.key !== storageKey) return;
        try {
          handlePayload(JSON.parse(event.newValue || '{}'));
        } catch {
          // ignore malformed payload
        }
      };

      let closeTimer = null;
      const interval = setInterval(() => {
        if (!popup || popup.closed) {
          clearInterval(interval);
          closeTimer = setTimeout(() => {
            finish(() => reject(new Error(buildPopupClosedError())));
          }, 1500);
        }
      }, 200);

      function cleanup() {
        clearTimeout(timeout);
        clearInterval(interval);
        if (closeTimer) clearTimeout(closeTimer);
        window.removeEventListener('message', onMessage);
        window.removeEventListener('storage', onStorage);
        if (channel) {
          try {
            channel.close();
          } catch {
            // ignore
          }
        }
        try {
          localStorage.removeItem(storageKey);
        } catch {
          // ignore
        }
      }

      window.addEventListener('message', onMessage);
      window.addEventListener('storage', onStorage);

      try {
        const legacyKey = `mikus_github_oauth_${state}`;
        const cached = localStorage.getItem(storageKey) || localStorage.getItem(legacyKey);
        if (cached) handlePayload(JSON.parse(cached));
      } catch {
        // ignore
      }
    });
  }

  async function oauthSignIn() {
    ensureConfigured();
    await ensureTokenExchangeReachable();
    const clientId = CONFIG.GITHUB_CLIENT_ID;
    const state = createOAuthState();
    const codeVerifier = randomString(48);
    const codeChallenge = await createCodeChallenge(codeVerifier);
    const redirectUri = getOAuthRedirectUri();
    const scope = CONFIG.GITHUB_SCOPES || 'repo';

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      scope,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });

    const popup = window.open(
      `https://github.com/login/oauth/authorize?${params}`,
      'storage_hub_github_oauth',
      'width=560,height=720'
    );

    if (!popup) {
      throw new Error('Could not open GitHub sign-in popup. Please allow popups for this site.');
    }

    let code;
    try {
      code = await waitForOauthCode(popup, state);
    } catch (err) {
      if (/redirect_uri|misconfigured/i.test(err.message || '')) {
        throw new Error(`${err.message}\n\n${getOAuthRedirectUriHelp()}`);
      }
      throw err;
    }
    popup.close();

    return exchangeCodeForToken(code, codeVerifier, redirectUri, clientId);
  }

  function getPatSignInMessageHtml() {
    const classicUrl = 'https://github.com/settings/tokens/new?scopes=repo&description=Storage%20Hub';
    const tokensUrl = 'https://github.com/settings/tokens';

    return (
      '<p class="app-dialog-lead">Use a <strong>classic</strong> token (<code>ghp_…</code>) so the app can create a private <code>Drive-1</code> repository for you.</p>' +

      '<section class="app-dialog-section">' +
      '<h3 class="app-dialog-section-title">Classic token</h3>' +
      '<p class="app-dialog-section-link">' +
      '<a href="' + classicUrl + '" target="_blank" rel="noopener noreferrer">Generate classic token on GitHub</a>' +
      '</p>' +
      '<p class="app-dialog-section-label">Required permission</p>' +
      '<ul class="app-dialog-perms">' +
      '<li><code>repo</code> — full control of private repositories</li>' +
      '</ul>' +
      '<p class="app-dialog-section-label">How to enable</p>' +
      '<ol class="app-dialog-steps">' +
      '<li>Open the link above (or <a href="' + tokensUrl + '" target="_blank" rel="noopener noreferrer">GitHub → Settings → Developer settings → Personal access tokens</a>).</li>' +
      '<li>Click <strong>Generate new token</strong> → <strong>Generate new token (classic)</strong>.</li>' +
      '<li>Enter a note (e.g. <em>Storage Hub</em>) and choose an expiration.</li>' +
      '<li>Under scopes, check <strong>repo</strong> (full control of private repositories).</li>' +
      '<li>Do <strong>not</strong> use a fine-grained token (<code>github_pat_…</code>) — only classic (<code>ghp_…</code>) can auto-create repos.</li>' +
      '<li><code>public_repo</code> alone is not enough; private <code>Drive-1</code> repos need the full <code>repo</code> scope.</li>' +
      '<li>Click <strong>Generate token</strong>, copy the token (<code>ghp_…</code>) — GitHub shows it only once.</li>' +
      '<li>Paste the token in the field below and click <strong>Connect</strong>.</li>' +
      '</ol>' +
      '</section>'
    );
  }

  function isFineGrainedPatToken(token) {
    return /^github_pat_/i.test(String(token || '').trim());
  }

  function isPatRepoCreateError(err) {
    const msg = (err?.message || String(err)).toLowerCase();
    return /resource not accessible by personal access token|must use a classic personal access token|fine-grained personal access token/i.test(msg);
  }

  function parseRepoInput(input, defaultOwner) {
    const trimmed = String(input || '').trim();
    if (!trimmed) throw new Error('Repository name cannot be empty');

    let path = trimmed
      .replace(/^https?:\/\/(?:www\.)?github\.com\//i, '')
      .replace(/\.git$/i, '')
      .replace(/\/+$/, '');
    const parts = path.split('/').filter(Boolean);
    if (parts.length >= 2) {
      return { owner: parts[0], repo: parts[parts.length - 1] };
    }
    if (parts.length === 1) {
      return { owner: defaultOwner, repo: parts[0] };
    }
    throw new Error('Enter repository as owner/repo, a repo name, or a github.com/owner/repo URL');
  }

  function getExistingRepoMessageHtml(reason = '') {
    const reasonBlock = reason
      ? '<p class="app-dialog-section-note">' + reason + '</p>'
      : '<p class="app-dialog-section-note">Fine-grained tokens cannot create repositories via the GitHub API.</p>';

    return (
      reasonBlock +
      '<p class="app-dialog-lead">Connect an existing private repository.</p>' +
      '<ol class="app-dialog-steps">' +
      '<li>Open <a href="https://github.com/new" target="_blank" rel="noopener noreferrer">github.com/new</a> and create an empty private repository (or pick one you already have).</li>' +
      '<li>Make sure your token has <strong>Contents: Read and write</strong> on that repository.</li>' +
      '<li>Enter the repository name below (<code>owner/repo</code> or just <code>repo-name</code>).</li>' +
      '</ol>'
    );
  }

  async function connectExistingRepository(token, profile, reason = '') {
    if (typeof Dialog === 'undefined') {
      throw new Error('Connect an existing GitHub repository (dialog not loaded)');
    }

    const result = await Dialog.form({
      title: 'Connect existing GitHub repository',
      messageHtml: getExistingRepoMessageHtml(reason),
      fields: [
        {
          id: 'repo',
          label: 'Repository',
          placeholder: 'owner/repo or Drive-1',
          hint: 'Use a private repo you can write to',
        },
      ],
      submitLabel: 'Connect',
    });
    if (!result) throw new Error('GitHub sign-in cancelled');

    const { owner, repo } = parseRepoInput(result.repo, profile.login);
    const diskId = `${ID_PREFIX}${owner}/${repo}`;
    if (getDisk(diskId)) {
      throw new Error(`GitHub storage "${repo}" is already connected`);
    }

    let repoData;
    try {
      repoData = await apiRequest(
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
        token
      );
    } catch (err) {
      const detail = err?.message || String(err);
      throw new Error(
        `Could not access ${owner}/${repo}.\n\n` +
        'Check the repository name and that your token has Contents: Read and write on that repo.\n\n' +
        detail
      );
    }

    if (!repoData?.permissions?.push && !repoData?.permissions?.admin) {
      throw new Error(
        `Token does not have write access to ${owner}/${repo}.\n\n` +
        'Grant Contents: Read and write on that repository in your token settings.'
      );
    }

    return repoData;
  }

  async function resolveRepositoryForDisk(token, profile) {
    if (isFineGrainedPatToken(token)) {
      return connectExistingRepository(
        token,
        profile,
        'Fine-grained tokens cannot auto-create Drive repositories.'
      );
    }

    try {
      return await createDriveRepository(token);
    } catch (err) {
      if (isPatRepoCreateError(err) || isRepoCreatePermissionError(err)) {
        return connectExistingRepository(
          token,
          profile,
          'This token cannot create new repositories. Use a classic token with the repo scope, or connect an existing repository.'
        );
      }
      if (/repository creation failed|could not create a drive repository/i.test(err?.message || '')) {
        return connectExistingRepository(
          token,
          profile,
          'Automatic repository creation failed. You can connect an existing private repo instead.'
        );
      }
      throw err;
    }
  }

  async function signInWithPersonalAccessToken() {
    ensureConfigured();
    if (typeof Dialog === 'undefined') {
      throw new Error('GitHub personal access token sign-in is unavailable (dialog not loaded)');
    }

    const result = await Dialog.form({
      title: 'Connect GitHub storage',
      messageHtml: getPatSignInMessageHtml(),
      fields: [
        {
          id: 'token',
          label: 'Personal access token',
          type: 'password',
          placeholder: 'ghp_…',
        },
      ],
      submitLabel: 'Connect',
    });
    if (!result) throw new Error('GitHub sign-in cancelled');

    const token = String(result.token || '').trim();
    if (!token) throw new Error('Token cannot be empty');

    try {
      await getAuthenticatedUser(token);
    } catch (err) {
      const detail = err?.message || String(err);
      throw new Error(`Invalid GitHub token: ${detail}`);
    }
    return token;
  }

  async function acquireAccessToken() {
    if (prefersPatSignIn()) {
      return signInWithPersonalAccessToken();
    }

    try {
      await ensureTokenExchangeReachable();
      return await oauthSignIn();
    } catch (err) {
      const message = err?.message || String(err);
      if (!/token proxy|not reachable|GITHUB_TOKEN_EXCHANGE|static hosting/i.test(message)) {
        throw err;
      }
      if (typeof Dialog === 'undefined') throw err;

      const choice = await Dialog.choose({
        title: 'GitHub sign-in',
        message: `${message}\n\nConnect with a personal access token instead (no proxy needed).`,
        buttons: [
          { id: 'pat', label: 'Use personal access token', primary: true },
          { id: 'cancel', label: 'Cancel' },
        ],
      });
      if (choice !== 'pat') throw err;
      return signInWithPersonalAccessToken();
    }
  }

  function formatGitHubApiError(payload, status) {
    const parts = [];
    if (payload?.message) parts.push(payload.message);
    const details = (payload?.errors || [])
      .map((entry) => entry.message || entry.code)
      .filter(Boolean);
    if (details.length) parts.push(details.join('; '));
    return parts.join(' — ') || `GitHub API error (${status})`;
  }

  function isRepoNameTakenError(err) {
    const msg = (err?.message || String(err)).toLowerCase();
    return /name already exists|already exists on this account/.test(msg);
  }

  function isRepoCreatePermissionError(err) {
    const msg = (err?.message || String(err)).toLowerCase();
    return isPatRepoCreateError(err)
      || /insufficient scope|must have push access|admin access to this repository|repository creation failed.*forbidden/i.test(msg);
  }

  async function apiRequest(path, token, options = {}) {
    let res;
    try {
      res = await fetch(`${API_BASE}${path}`, {
        method: options.method || 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: options.accept || 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          ...(options.headers || {}),
        },
        body: options.body,
        redirect: options.raw ? 'follow' : 'manual',
      });
    } catch (err) {
      const message = err?.message || String(err);
      throw new Error(/failed to fetch|networkerror|load failed/i.test(message)
        ? `GitHub API request failed (${message}). Check your network connection.`
        : message);
    }
    if (!res.ok) {
      const err = await readJsonResponse(res).catch(() => ({}));
      throw new Error(formatGitHubApiError(err, res.status));
    }
    if (options.raw) return res;
    if (res.status === 204) return null;
    if (res.status === 301 || res.status === 302 || res.status === 303 || res.status === 307 || res.status === 308) {
      throw new Error('GitHub redirected this request unexpectedly. Try downloading the file instead.');
    }
    return readJsonResponse(res);
  }

  async function getAuthenticatedUser(token) {
    return apiRequest('/user', token);
  }

  async function createDriveRepository(token) {
    const existingNames = new Set(disks.map((d) => d.repo));
    let n = 1;
    while (existingNames.has(`Drive-${n}`)) n += 1;

    for (let i = 0; i < 50; i += 1) {
      const name = `Drive-${n + i}`;
      try {
        return await apiRequest('/user/repos', token, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name,
            private: true,
            auto_init: true,
            description: `Storage repository created by ${typeof SITE !== 'undefined' ? SITE.name : 'Storage Hub'}`,
          }),
        });
      } catch (err) {
        if (isRepoNameTakenError(err)) continue;
        throw err;
      }
    }
    throw new Error(
      'Could not create a Drive repository automatically after 50 attempts.\n\n' +
      'Create an empty private repo at github.com/new (e.g. Drive-1), then connect it manually.'
    );
  }

  function upsertDiskFromRepo(profile, repo, token) {
    const id = `${ID_PREFIX}${repo.owner.login}/${repo.name}`;
    const existing = getDisk(id);
    const disk = {
      id,
      name: repo.name,
      owner: repo.owner.login,
      repo: repo.name,
      branch: repo.default_branch || 'main',
      token,
      accountLogin: profile.login,
      accountName: profile.name || profile.login,
      accountAvatar: resolveAssetUrl(profile.avatar_url || ''),
      createdAt: existing?.createdAt || Date.now(),
      repoHtmlUrl: repo.html_url,
      private: !!repo.private,
    };
    if (existing) {
      Object.assign(existing, disk);
    } else {
      disks.push(disk);
    }
    saveDisks();
    return getDisk(id);
  }

  async function createDisk() {
    const token = await acquireAccessToken();
    const profile = await getAuthenticatedUser(token);
    const repo = await resolveRepositoryForDisk(token, profile);
    return upsertDiskFromRepo(profile, repo, token);
  }

  async function removeDisk(diskId) {
    disks = disks.filter((d) => d.id !== diskId);
    saveDisks();
  }

  function encodeRepoPath(path) {
    if (!path) return '';
    return path
      .split('/')
      .map((part) => encodeURIComponent(part))
      .join('/');
  }

  function b64EncodeUtf8(text) {
    const bytes = new TextEncoder().encode(text || '');
    return b64EncodeBytes(bytes);
  }

  function b64EncodeBytes(bytes) {
    const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    let out = '';
    const chunk = 0x8000;
    for (let i = 0; i < view.length; i += chunk) {
      out += String.fromCharCode(...view.subarray(i, i + chunk));
    }
    return btoa(out);
  }

  function isTextFileMime(mimeType = '', name = '') {
    const mime = String(mimeType).toLowerCase();
    const lower = String(name).toLowerCase();
    if (mime.startsWith('text/') || mime === 'application/json') return true;
    return /\.(txt|md|csv|json|log|xml|yml|yaml|html|htm|css|js|ts|tsx|jsx|py|sh|bat|sql)$/i.test(lower);
  }

  function b64DecodeUtf8(input) {
    const bytes = b64DecodeBytes(input);
    return new TextDecoder().decode(bytes);
  }

  function b64DecodeBytes(input) {
    const binary = atob((input || '').replace(/\n/g, ''));
    return Uint8Array.from(binary, (c) => c.charCodeAt(0));
  }

  async function readJsonResponse(res) {
    const contentType = (res.headers.get('content-type') || '').toLowerCase();
    if (contentType.includes('json') || contentType.includes('javascript')) {
      return res.json();
    }
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`GitHub API returned non-JSON response (${contentType || 'unknown'})`);
    }
  }

  function getParentPath(path) {
    if (!path) return '';
    const idx = path.lastIndexOf('/');
    return idx === -1 ? '' : path.slice(0, idx);
  }

  function normalizePath(idOrPath) {
    if (!idOrPath || idOrPath === ROOT_ID) return '';
    return idOrPath.replace(/^\/+|\/+$/g, '');
  }

  function inferMimeType(name = '') {
    const lower = name.toLowerCase();
    if (lower.endsWith('.json')) return 'application/json';
    if (lower.endsWith('.txt') || lower.endsWith('.md') || lower.endsWith('.csv') || lower.endsWith('.log')) {
      return 'text/plain';
    }
    if (lower.endsWith('.png')) return 'image/png';
    if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
    if (lower.endsWith('.pdf')) return 'application/pdf';
    return 'application/octet-stream';
  }

  function formatSize(bytes = 0) {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let size = Number(bytes) || 0;
    let idx = 0;
    while (size >= 1024 && idx < units.length - 1) {
      size /= 1024;
      idx += 1;
    }
    return `${size.toFixed(idx === 0 ? 0 : 1)} ${units[idx]}`;
  }

  function formatDate(ts) {
    if (!ts) return '—';
    return new Date(ts).toLocaleString();
  }

  async function getRepoTree(disk, { force = false } = {}) {
    if (!force && repoTreeCache.has(disk.id)) {
      return repoTreeCache.get(disk.id);
    }
    const data = await apiRequest(
      `/repos/${encodeURIComponent(disk.owner)}/${encodeURIComponent(disk.repo)}/git/trees/${encodeURIComponent(disk.branch)}?recursive=1`,
      disk.token
    );
    const tree = data.tree || [];
    repoTreeCache.set(disk.id, tree);
    return tree;
  }

  async function listFiles(diskId, parentId = ROOT_ID) {
    const disk = getDisk(diskId);
    if (!disk) throw new Error('GitHub storage not found');
    const tree = await getRepoTree(disk);
    const base = normalizePath(parentId);
    const folders = new Map();
    const files = [];

    tree.forEach((entry) => {
      if (entry.type !== 'blob' && entry.type !== 'tree') return;
      const path = entry.path || '';
      if (!path || path.endsWith('/.keep') || path === '.keep') return;

      if (base) {
        if (path === base) return;
        if (!path.startsWith(`${base}/`)) return;
      }

      const relative = base ? path.slice(base.length + 1) : path;
      if (!relative) return;
      const [first, ...rest] = relative.split('/');
      if (!first || first === '.keep') return;

      if (rest.length > 0) {
        const folderPath = base ? `${base}/${first}` : first;
        if (!folders.has(folderPath)) {
          folders.set(folderPath, {
            id: folderPath,
            name: first,
            isFolder: true,
            mimeType: FOLDER_MIME,
            icon: '📁',
            parents: [base || ROOT_ID],
            parentId: base || ROOT_ID,
            size: 0,
            sizeFormatted: '',
            dateFormatted: '—',
            typeName: 'Folder',
            webViewLink: getItemWebUrl(diskId, folderPath, true),
          });
        }
        return;
      }

      if (entry.type === 'tree') {
        const folderPath = base ? `${base}/${first}` : first;
        if (!folders.has(folderPath)) {
          folders.set(folderPath, {
            id: folderPath,
            name: first,
            isFolder: true,
            mimeType: FOLDER_MIME,
            icon: '📁',
            parents: [base || ROOT_ID],
            parentId: base || ROOT_ID,
            size: 0,
            sizeFormatted: '',
            dateFormatted: '—',
            typeName: 'Folder',
            webViewLink: getItemWebUrl(diskId, folderPath, true),
          });
        }
        return;
      }

      const mimeType = inferMimeType(first);
      const filePath = base ? `${base}/${first}` : first;
      files.push({
        id: filePath,
        name: first,
        isFolder: false,
        mimeType,
        icon: mimeType === 'application/json' ? '📋' : mimeType.startsWith('text/') ? '📝' : mimeType.startsWith('image/') ? '🖼️' : '📄',
        parents: [base || ROOT_ID],
        parentId: base || ROOT_ID,
        size: entry.size || 0,
        sizeFormatted: formatSize(entry.size || 0),
        dateFormatted: '—',
        typeName: mimeType === 'application/json' ? 'JSON file' : mimeType.startsWith('image/') ? 'Image' : 'File',
        viewUrl: getFileViewUrl(diskId, filePath),
        webViewLink: getItemWebUrl(diskId, filePath, false),
      });
    });

    return mergePendingFiles(diskId, parentId, [...folders.values(), ...files].sort((a, b) => {
      if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
      return a.name.localeCompare(b.name);
    }));
  }

  async function listTrash() {
    return [];
  }

  async function getFileContentMeta(disk, path) {
    const apiPath = `/repos/${encodeURIComponent(disk.owner)}/${encodeURIComponent(disk.repo)}/contents/${encodeRepoPath(path)}?ref=${encodeURIComponent(disk.branch)}`;
    const res = await fetch(`${API_BASE}${apiPath}`, {
      headers: {
        Authorization: `Bearer ${disk.token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      redirect: 'manual',
    });

    if (res.status === 301 || res.status === 302 || res.status === 303 || res.status === 307 || res.status === 308) {
      const downloadUrl = res.headers.get('location');
      const tree = await getRepoTree(disk);
      const entry = tree.find((e) => e.type === 'blob' && e.path === path);
      return {
        type: 'file',
        name: path.split('/').pop() || path,
        path,
        sha: entry?.sha || null,
        size: entry?.size ?? null,
        encoding: null,
        content: null,
        download_url: downloadUrl,
      };
    }

    if (!res.ok) {
      const err = await readJsonResponse(res).catch(() => ({}));
      throw new Error(err.message || `GitHub API error (${res.status})`);
    }

    return readJsonResponse(res);
  }

  async function fetchGithubDownloadBlob(disk, downloadUrl, mimeType) {
    const res = await fetch(downloadUrl, {
      headers: {
        Authorization: `Bearer ${disk.token}`,
        Accept: 'application/octet-stream',
      },
    });
    if (!res.ok) {
      throw new Error(`GitHub download failed (${res.status})`);
    }
    return new Blob([await res.arrayBuffer()], { type: mimeType });
  }

  async function putFileContent(disk, path, content, message, sha = null) {
    return apiRequest(
      `/repos/${encodeURIComponent(disk.owner)}/${encodeURIComponent(disk.repo)}/contents/${encodeRepoPath(path)}`,
      disk.token,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message,
          content: b64EncodeUtf8(content),
          branch: disk.branch,
          ...(sha ? { sha } : {}),
        }),
      }
    );
  }

  async function putFileBlob(disk, path, blob, message, sha = null) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (bytes.length > 100 * 1024 * 1024) {
      throw new Error('GitHub storage supports files up to 100 MB');
    }
    return apiRequest(
      `/repos/${encodeURIComponent(disk.owner)}/${encodeURIComponent(disk.repo)}/contents/${encodeRepoPath(path)}`,
      disk.token,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message,
          content: b64EncodeBytes(bytes),
          branch: disk.branch,
          ...(sha ? { sha } : {}),
        }),
      }
    );
  }

  async function createFolder(diskId, parentId, name) {
    return runPendingMutation(diskId, parentId, { name, isFolder: true }, async () => {
      const disk = getDisk(diskId);
      if (!disk) throw new Error('GitHub storage not found');
      const parentPath = normalizePath(parentId);
      const folderPath = parentPath ? `${parentPath}/${name}` : name;
      await putFileContent(disk, `${folderPath}/.keep`, '', `Create folder ${folderPath}`);
      return {
        id: folderPath,
        name,
        isFolder: true,
        mimeType: FOLDER_MIME,
        parents: [parentPath || ROOT_ID],
        parentId: parentPath || ROOT_ID,
      };
    });
  }

  async function createFile(diskId, parentId, name, mimeType, content = '') {
    return runPendingMutation(diskId, parentId, { name, mimeType, size: new TextEncoder().encode(content || '').length }, async () => {
      const disk = getDisk(diskId);
      if (!disk) throw new Error('GitHub storage not found');
      const parentPath = normalizePath(parentId);
      const filePath = parentPath ? `${parentPath}/${name}` : name;
      await putFileContent(disk, filePath, content, `Create file ${filePath}`);
      return {
        id: filePath,
        name,
        mimeType: mimeType || inferMimeType(name),
        parents: [parentPath || ROOT_ID],
        parentId: parentPath || ROOT_ID,
        viewUrl: getFileViewUrl(diskId, filePath),
      };
    });
  }

  async function createFileFromBlob(diskId, parentId, name, mimeType, blob) {
    const size = blob?.size || 0;
    return runPendingMutation(diskId, parentId, { name, mimeType, size }, async () => {
      const disk = getDisk(diskId);
      if (!disk) throw new Error('GitHub storage not found');
      const parentPath = normalizePath(parentId);
      const filePath = parentPath ? `${parentPath}/${name}` : name;
      const resolvedMime = mimeType || inferMimeType(name);
      if (isTextFileMime(resolvedMime, name)) {
        const text = await blob.text();
        await putFileContent(disk, filePath, text, `Create file ${filePath}`);
      } else {
        await putFileBlob(disk, filePath, blob, `Create file ${filePath}`);
      }
      return {
        id: filePath,
        name,
        mimeType: resolvedMime,
        parents: [parentPath || ROOT_ID],
        parentId: parentPath || ROOT_ID,
        viewUrl: getFileViewUrl(diskId, filePath),
      };
    });
  }

  async function getTextFileContent(diskId, fileId) {
    const disk = getDisk(diskId);
    if (!disk) throw new Error('GitHub storage not found');
    const path = normalizePath(fileId);
    const meta = await getFileContentMeta(disk, path);
    if (meta.type !== 'file') throw new Error('Item is not a file');
    if (meta.encoding === 'base64' && meta.content) {
      return b64DecodeUtf8(meta.content);
    }
    const blob = await downloadFile(diskId, fileId);
    return blob.text();
  }

  async function updateFileContent(diskId, fileId, content, _mimeType) {
    const disk = getDisk(diskId);
    if (!disk) throw new Error('GitHub storage not found');
    const path = normalizePath(fileId);
    const meta = await getFileContentMeta(disk, path);
    await runPendingFileSave(
      diskId,
      path,
      { name: path.split('/').pop(), size: new TextEncoder().encode(content || '').length },
      async () => {
        const response = await putFileContent(disk, path, content, `Update file ${path}`, meta.sha);
        invalidateRepoTree(diskId);
        return { expectedSha: response?.content?.sha || null };
      }
    );
  }

  async function renameFile(diskId, fileId, name) {
    const disk = getDisk(diskId);
    if (!disk) throw new Error('GitHub storage not found');
    const oldPath = normalizePath(fileId);
    const parent = getParentPath(oldPath);
    const newPath = parent ? `${parent}/${name}` : name;
    await moveFile(diskId, oldPath, parent || ROOT_ID, parent || ROOT_ID, newPath);
  }

  async function isGithubFolder(diskId, path) {
    const normalized = normalizePath(path);
    if (!normalized) return false;
    const children = await listFiles(diskId, normalized);
    if (children.length > 0) return true;
    const disk = getDisk(diskId);
    if (!disk) return false;
    const tree = await getRepoTree(disk);
    return tree.some((entry) => {
      const entryPath = entry.path || '';
      return entryPath === `${normalized}/.keep` || entryPath.startsWith(`${normalized}/`);
    });
  }

  async function makeUniqueCopyName(diskId, parentId, name) {
    const siblings = await listFiles(diskId, parentId);
    const exists = (candidate) => siblings.some((file) => file.name.toLowerCase() === candidate.toLowerCase());
    if (!exists(name)) return name;

    const match = name.match(/^(.*?)(\.[^.]+)?$/);
    const stem = match?.[1] || name;
    const ext = match?.[2] || '';
    let candidate = `${stem} (copy)${ext}`;
    let counter = 2;
    while (exists(candidate)) {
      candidate = `${stem} (copy ${counter})${ext}`;
      counter += 1;
    }
    return candidate;
  }

  async function putFileFromBlob(disk, path, blob, message) {
    const fileName = path.split('/').pop() || '';
    const mimeType = inferMimeType(fileName);
    if (isTextFileMime(mimeType, fileName)) {
      const text = await blob.text();
      return putFileContent(disk, path, text, message);
    }
    return putFileBlob(disk, path, blob, message);
  }

  async function deleteFile(diskId, fileId) {
    const disk = getDisk(diskId);
    if (!disk) throw new Error('GitHub storage not found');
    const targetPath = normalizePath(fileId);
    const tree = await getRepoTree(disk);
    const paths = tree
      .filter((e) => e.type === 'blob' && (e.path === targetPath || e.path.startsWith(`${targetPath}/`)))
      .map((e) => e.path);

    if (!paths.length) {
      const meta = await getFileContentMeta(disk, targetPath);
      if (meta.type === 'file') paths.push(targetPath);
    }

    for (const path of paths) {
      const meta = await getFileContentMeta(disk, path);
      await apiRequest(
        `/repos/${encodeURIComponent(disk.owner)}/${encodeURIComponent(disk.repo)}/contents/${encodeRepoPath(path)}`,
        disk.token,
        {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: `Delete ${path}`,
            sha: meta.sha,
            branch: disk.branch,
          }),
        }
      );
    }
    invalidateRepoTree(diskId);
    notifyListChange(diskId);
  }

  async function trashFile(diskId, fileId) {
    await deleteFile(diskId, fileId);
  }

  async function restoreFile(_diskId, _fileId) {
    throw new Error('GitHub storage does not support Recycle Bin restore');
  }

  async function copyFile(diskId, fileId, parentId) {
    const disk = getDisk(diskId);
    if (!disk) throw new Error('GitHub storage not found');
    const sourcePath = normalizePath(fileId);
    const destParent = normalizePath(parentId);
    const sourceName = sourcePath.split('/').pop();

    if (await isGithubFolder(diskId, sourcePath)) {
      const destName = await makeUniqueCopyName(diskId, parentId, sourceName);
      const folder = await createFolder(diskId, parentId, destName);
      const children = await listFiles(diskId, sourcePath);
      for (const child of children) {
        await copyFile(diskId, child.id, folder.id);
      }
      return folder;
    }

    const destName = await makeUniqueCopyName(diskId, parentId, sourceName);
    const blob = await downloadFile(diskId, sourcePath);
    return runPendingMutation(
      diskId,
      parentId,
      { name: destName, mimeType: inferMimeType(destName), size: blob.size },
      async () => {
        const destPath = destParent ? `${destParent}/${destName}` : destName;
        await putFileFromBlob(disk, destPath, blob, `Copy ${sourcePath} to ${destPath}`);
        return {
          id: destPath,
          name: destName,
          mimeType: inferMimeType(destName),
          parents: [destParent || ROOT_ID],
          parentId: destParent || ROOT_ID,
          viewUrl: getFileViewUrl(diskId, destPath),
          webViewLink: getItemWebUrl(diskId, destPath, false),
        };
      }
    );
  }

  async function executeGithubMove(diskId, sourcePath, oldParent, toParent, explicitTargetPath = null) {
    const disk = getDisk(diskId);
    if (!disk) throw new Error('GitHub storage not found');
    const tree = await getRepoTree(disk);
    const files = tree
      .filter((e) => e.type === 'blob' && (e.path === sourcePath || e.path.startsWith(`${sourcePath}/`)))
      .map((e) => e.path);

    if (!files.length) {
      const fileName = sourcePath.split('/').pop();
      const targetPath = explicitTargetPath || (toParent ? `${toParent}/${fileName}` : fileName);
      const blob = await downloadFile(diskId, sourcePath);
      await putFileFromBlob(disk, targetPath, blob, `Move ${sourcePath} to ${targetPath}`);
      const meta = await getFileContentMeta(disk, sourcePath);
      await apiRequest(
        `/repos/${encodeURIComponent(disk.owner)}/${encodeURIComponent(disk.repo)}/contents/${encodeRepoPath(sourcePath)}`,
        disk.token,
        {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: `Delete ${sourcePath}`,
            sha: meta.sha,
            branch: disk.branch,
          }),
        }
      );
      return;
    }

    for (const oldPath of files) {
      const relative = sourcePath ? oldPath.slice(sourcePath.length).replace(/^\/+/, '') : oldPath;
      let baseTarget = '';
      if (explicitTargetPath) {
        baseTarget = explicitTargetPath;
      } else {
        const sourceName = sourcePath.split('/').pop();
        baseTarget = toParent ? `${toParent}/${sourceName}` : sourceName;
      }
      const newPath = relative ? `${baseTarget}/${relative}` : baseTarget;
      const blob = await downloadFile(diskId, oldPath);
      await putFileFromBlob(disk, newPath, blob, `Move ${oldPath} to ${newPath}`);
    }

    const deletePaths = files.sort((a, b) => b.length - a.length);
    for (const path of deletePaths) {
      const meta = await getFileContentMeta(disk, path);
      await apiRequest(
        `/repos/${encodeURIComponent(disk.owner)}/${encodeURIComponent(disk.repo)}/contents/${encodeRepoPath(path)}`,
        disk.token,
        {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: `Delete ${path}`,
            sha: meta.sha,
            branch: disk.branch,
          }),
        }
      );
    }

    if (oldParent) {
      const keepPath = `${oldParent}/.keep`;
      try {
        const keepMeta = await getFileContentMeta(disk, keepPath);
        await apiRequest(
          `/repos/${encodeURIComponent(disk.owner)}/${encodeURIComponent(disk.repo)}/contents/${encodeRepoPath(keepPath)}`,
          disk.token,
          {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              message: `Cleanup ${keepPath}`,
              sha: keepMeta.sha,
              branch: disk.branch,
            }),
          }
        );
      } catch {
        // ignore
      }
    }
  }

  async function moveFile(diskId, fileId, fromParentId, toParentId, explicitTargetPath = null) {
    const sourcePath = normalizePath(fileId);
    const toParent = normalizePath(toParentId);
    const oldParent = normalizePath(fromParentId);
    const sourceName = sourcePath.split('/').pop();
    const targetPath = explicitTargetPath || (toParent ? `${toParent}/${sourceName}` : sourceName);
    const isFolder = await isGithubFolder(diskId, sourcePath);

    return runPendingMove(
      diskId,
      sourcePath,
      toParentId,
      {
        name: sourceName,
        isFolder,
        mimeType: isFolder ? FOLDER_MIME : inferMimeType(sourceName),
        size: 0,
        destPath: targetPath,
      },
      async () => executeGithubMove(diskId, sourcePath, oldParent, toParent, explicitTargetPath)
    );
  }

  async function downloadFile(diskId, fileId) {
    const disk = getDisk(diskId);
    if (!disk) throw new Error('GitHub storage not found');
    const path = normalizePath(fileId);
    const fileName = path.split('/').pop() || '';
    const mimeType = inferMimeType(fileName);
    const meta = await getFileContentMeta(disk, path);

    if (meta.type && meta.type !== 'file') {
      throw new Error('Item is not a file');
    }

    if (meta.encoding === 'base64' && meta.content) {
      return new Blob([b64DecodeBytes(meta.content)], { type: mimeType });
    }

    if (meta.download_url) {
      return fetchGithubDownloadBlob(disk, meta.download_url, mimeType);
    }

    const rawRes = await apiRequest(
      `/repos/${encodeURIComponent(disk.owner)}/${encodeURIComponent(disk.repo)}/contents/${encodeRepoPath(path)}?ref=${encodeURIComponent(disk.branch)}`,
      disk.token,
      { accept: 'application/vnd.github.raw', raw: true }
    );
    return new Blob([await rawRes.arrayBuffer()], { type: mimeType });
  }

  async function getFolderPath(_diskId, folderId) {
    const path = normalizePath(folderId);
    const crumbs = [{ id: ROOT_ID, name: 'My Drive' }];
    if (!path) return crumbs;
    let current = '';
    path.split('/').forEach((part) => {
      current = current ? `${current}/${part}` : part;
      crumbs.push({ id: current, name: part });
    });
    return crumbs;
  }

  async function getFileProperties(diskId, fileId) {
    const disk = getDisk(diskId);
    if (!disk) throw new Error('GitHub storage not found');
    const path = normalizePath(fileId);
    const meta = await getFileContentMeta(disk, path);
    const isFolder = meta.type === 'dir';
    let githubLink = '—';
    try {
      githubLink = getItemWebUrl(diskId, path, isFolder);
    } catch {
      // Item may still be syncing.
    }
    return [
      { section: 'File' },
      ['Name', meta.name || path.split('/').pop() || ''],
      ['Path', meta.path || path],
      ['Type', isFolder ? 'Folder' : 'File'],
      ['Size', meta.size != null ? formatSize(meta.size) : '—'],
      ['SHA', meta.sha || '—'],
      ['Storage', `${disk.owner}/${disk.repo}`],
      ['GitHub link', githubLink],
      ['Repository URL', disk.repoHtmlUrl || `https://github.com/${disk.owner}/${disk.repo}`],
    ];
  }

  async function getStorageQuota(diskId) {
    const disk = getDisk(diskId);
    if (!disk) throw new Error('GitHub storage not found');
    const repo = await apiRequest(
      `/repos/${encodeURIComponent(disk.owner)}/${encodeURIComponent(disk.repo)}`,
      disk.token
    );
    const usage = (repo.size || 0) * 1024;
    const limit = RECOMMENDED_REPO_SIZE_BYTES;
    const available = Math.max(0, limit - usage);
    const usageFormatted = formatSize(usage);
    const limitFormatted = formatSize(limit);
    const maxLimitFormatted = formatSize(MAX_REPO_SIZE_BYTES);
    return {
      usage,
      limit,
      maxLimit: MAX_REPO_SIZE_BYTES,
      available,
      usageFormatted,
      limitFormatted,
      maxLimitFormatted,
      availableFormatted: formatSize(available),
      label: `${usageFormatted} used · ${limitFormatted} recommended (GitHub max ${maxLimitFormatted})`,
      shortLabel: `${usageFormatted} / ${limitFormatted}`,
    };
  }

  function isNotepadFile(file) {
    const mime = (file.mimeType || '').toLowerCase();
    const name = (file.name || '').toLowerCase();
    if (mime === 'text/plain' || mime === 'application/json') return true;
    return /\.(txt|json)$/i.test(name);
  }

  async function buildNotepadFilePath(diskId, file) {
    const disk = getDisk(diskId);
    const segments = [disk?.name || 'GitHub Storage', 'My Drive'];
    const path = normalizePath(file.id || file.path || file.name);
    if (path) {
      path.split('/').forEach((part) => segments.push(part));
    } else if (file.name) {
      segments.push(file.name);
    }
    return `/${segments.join('/')}`;
  }

  async function resolveFileByPath(segments) {
    if (!segments?.length) throw new Error('Invalid file path');
    const disk = getDiskByName(segments[0]);
    if (!disk) throw new Error('GitHub storage not found');
    const parts = segments[1] === 'My Drive' ? segments.slice(2) : segments.slice(1);
    const path = parts.join('/');
    const files = await listFiles(disk.id, getParentPath(path) || ROOT_ID);
    const file = files.find((f) => f.name === parts[parts.length - 1]);
    if (!file) throw new Error('File not found');
    return { diskId: disk.id, file };
  }

  return {
    ROOT_ID,
    FOLDER_MIME,
    ID_PREFIX,
    init,
    getOAuthRedirectUri,
    getOAuthRedirectUriHelp,
    getTokenExchangeUrl,
    getTokenExchangeHelp,
    prefersPatSignIn,
    signInWithPersonalAccessToken,
    acquireAccessToken,
    isGithubId,
    isBrowserViewableFile,
    getFileViewUrl,
    getItemWebUrl,
    getRepoWebUrl,
    invalidateRepoTree,
    setListChangeListener,
    setSaveStateListener,
    getFileSaveState,
    getDisks,
    getDisk,
    getDiskByName,
    createDisk,
    removeDisk,
    listFiles,
    listTrash,
    createFolder,
    createFile,
    createFileFromBlob,
    isTextFileMime,
    renameFile,
    trashFile,
    restoreFile,
    deleteFile,
    moveFile,
    copyFile,
    getTextFileContent,
    updateFileContent,
    downloadFile,
    getFolderPath,
    getFileProperties,
    getStorageQuota,
    isNotepadFile,
    buildNotepadFilePath,
    resolveFileByPath,
    formatSize,
    formatDate,
  };
})();
