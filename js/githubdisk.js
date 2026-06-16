const GithubDisk = (() => {
  const ROOT_ID = 'root';
  const FOLDER_MIME = 'application/x-github-folder';
  const ID_PREFIX = 'github:';
  const STORAGE_KEY = 'mikus_drive_github_disks';
  const OAUTH_MESSAGE_SOURCE = 'mikus-drive-github-oauth';
  const API_BASE = 'https://api.github.com';

  let disks = [];

  function loadDisks() {
    try {
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

  function getOAuthRedirectUri() {
    const path = typeof BasePath !== 'undefined'
      ? BasePath.url('/github-oauth-callback.html')
      : '/github-oauth-callback.html';
    return new URL(path, location.origin).href;
  }

  function waitForOauthCode(popup, state) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error('GitHub sign-in timed out'));
      }, 120000);

      const interval = setInterval(() => {
        if (!popup || popup.closed) {
          cleanup();
          reject(new Error('GitHub sign-in popup was closed'));
        }
      }, 500);

      const onMessage = (event) => {
        if (event.origin !== location.origin) return;
        const data = event.data || {};
        if (data.source !== OAUTH_MESSAGE_SOURCE) return;
        if (data.state !== state) {
          cleanup();
          reject(new Error('Invalid GitHub OAuth state'));
          return;
        }
        if (data.error) {
          cleanup();
          reject(new Error(data.error_description || data.error || 'GitHub authorization failed'));
          return;
        }
        cleanup();
        resolve(data.code);
      };

      function cleanup() {
        clearTimeout(timeout);
        clearInterval(interval);
        window.removeEventListener('message', onMessage);
      }

      window.addEventListener('message', onMessage);
    });
  }

  async function oauthSignIn() {
    ensureConfigured();
    const clientId = CONFIG.GITHUB_CLIENT_ID;
    const state = randomString(24);
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
      'mikus_github_oauth',
      'width=560,height=720'
    );

    if (!popup) {
      throw new Error('Could not open GitHub sign-in popup. Please allow popups for this site.');
    }

    const code = await waitForOauthCode(popup, state);
    popup.close();

    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
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
    const tokenJson = await tokenRes.json().catch(() => ({}));
    if (!tokenRes.ok || !tokenJson.access_token) {
      throw new Error(tokenJson.error_description || tokenJson.error || 'Failed to obtain GitHub access token');
    }
    return tokenJson.access_token;
  }

  async function apiRequest(path, token, options = {}) {
    const res = await fetch(`${API_BASE}${path}`, {
      method: options.method || 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: options.accept || 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(options.headers || {}),
      },
      body: options.body,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || `GitHub API error (${res.status})`);
    }
    if (options.raw) return res;
    if (res.status === 204) return null;
    return res.json();
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
            description: `Storage repository created by ${typeof SITE !== 'undefined' ? SITE.name : 'Mikus Drive'}`,
          }),
        });
      } catch (err) {
        if (/name already exists/i.test(err.message || '')) continue;
        throw err;
      }
    }
    throw new Error('Could not create Drive repository automatically');
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
    const token = await oauthSignIn();
    const profile = await getAuthenticatedUser(token);
    const repo = await createDriveRepository(token);
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
    let out = '';
    bytes.forEach((b) => {
      out += String.fromCharCode(b);
    });
    return btoa(out);
  }

  function b64DecodeUtf8(input) {
    const binary = atob((input || '').replace(/\n/g, ''));
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
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

  async function getRepoTree(disk) {
    const data = await apiRequest(
      `/repos/${encodeURIComponent(disk.owner)}/${encodeURIComponent(disk.repo)}/git/trees/${encodeURIComponent(disk.branch)}?recursive=1`,
      disk.token
    );
    return data.tree || [];
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
          });
        }
        return;
      }

      const mimeType = inferMimeType(first);
      files.push({
        id: base ? `${base}/${first}` : first,
        name: first,
        isFolder: false,
        mimeType,
        parents: [base || ROOT_ID],
        parentId: base || ROOT_ID,
        size: entry.size || 0,
        sizeFormatted: formatSize(entry.size || 0),
        dateFormatted: '—',
        typeName: mimeType === 'application/json' ? 'JSON file' : 'File',
      });
    });

    const result = [...folders.values(), ...files];
    result.sort((a, b) => {
      if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    return result;
  }

  async function listTrash() {
    return [];
  }

  async function getFileContentMeta(disk, path) {
    return apiRequest(
      `/repos/${encodeURIComponent(disk.owner)}/${encodeURIComponent(disk.repo)}/contents/${encodeRepoPath(path)}?ref=${encodeURIComponent(disk.branch)}`,
      disk.token
    );
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

  async function createFolder(diskId, parentId, name) {
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
  }

  async function createFile(diskId, parentId, name, mimeType, content = '') {
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
    };
  }

  async function getTextFileContent(diskId, fileId) {
    const disk = getDisk(diskId);
    if (!disk) throw new Error('GitHub storage not found');
    const path = normalizePath(fileId);
    const meta = await getFileContentMeta(disk, path);
    if (meta.type !== 'file') throw new Error('Item is not a file');
    if (meta.encoding === 'base64') return b64DecodeUtf8(meta.content || '');
    const rawRes = await apiRequest(
      `/repos/${encodeURIComponent(disk.owner)}/${encodeURIComponent(disk.repo)}/contents/${encodeRepoPath(path)}?ref=${encodeURIComponent(disk.branch)}`,
      disk.token,
      { accept: 'application/vnd.github.raw', raw: true }
    );
    return rawRes.text();
  }

  async function updateFileContent(diskId, fileId, content, _mimeType) {
    const disk = getDisk(diskId);
    if (!disk) throw new Error('GitHub storage not found');
    const path = normalizePath(fileId);
    const meta = await getFileContentMeta(disk, path);
    await putFileContent(disk, path, content, `Update file ${path}`, meta.sha);
  }

  async function renameFile(diskId, fileId, name) {
    const disk = getDisk(diskId);
    if (!disk) throw new Error('GitHub storage not found');
    const oldPath = normalizePath(fileId);
    const parent = getParentPath(oldPath);
    const newPath = parent ? `${parent}/${name}` : name;
    await moveFile(diskId, oldPath, parent || ROOT_ID, parent || ROOT_ID, newPath);
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
  }

  async function trashFile(diskId, fileId) {
    await deleteFile(diskId, fileId);
  }

  async function restoreFile() {
    throw new Error('GitHub storage does not support Recycle Bin restore');
  }

  async function copyFile(diskId, fileId, parentId) {
    const disk = getDisk(diskId);
    if (!disk) throw new Error('GitHub storage not found');
    const sourcePath = normalizePath(fileId);
    const name = sourcePath.split('/').pop();
    const destParent = normalizePath(parentId);
    const destPath = destParent ? `${destParent}/${name}` : name;
    const content = await getTextFileContent(diskId, sourcePath);
    await putFileContent(disk, destPath, content, `Copy ${sourcePath} to ${destPath}`);
  }

  async function moveFile(diskId, fileId, fromParentId, toParentId, explicitTargetPath = null) {
    const disk = getDisk(diskId);
    if (!disk) throw new Error('GitHub storage not found');
    const sourcePath = normalizePath(fileId);
    const oldParent = normalizePath(fromParentId);
    const toParent = normalizePath(toParentId);
    const tree = await getRepoTree(disk);
    const files = tree
      .filter((e) => e.type === 'blob' && (e.path === sourcePath || e.path.startsWith(`${sourcePath}/`)))
      .map((e) => e.path);

    if (!files.length) {
      const fileName = sourcePath.split('/').pop();
      const targetPath = explicitTargetPath || (toParent ? `${toParent}/${fileName}` : fileName);
      const content = await getTextFileContent(diskId, sourcePath);
      await putFileContent(disk, targetPath, content, `Move ${sourcePath} to ${targetPath}`);
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
      const content = await getTextFileContent(diskId, oldPath);
      await putFileContent(disk, newPath, content, `Move ${oldPath} to ${newPath}`);
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

  async function downloadFile(diskId, fileId) {
    const disk = getDisk(diskId);
    if (!disk) throw new Error('GitHub storage not found');
    const path = normalizePath(fileId);
    const rawRes = await apiRequest(
      `/repos/${encodeURIComponent(disk.owner)}/${encodeURIComponent(disk.repo)}/contents/${encodeRepoPath(path)}?ref=${encodeURIComponent(disk.branch)}`,
      disk.token,
      { accept: 'application/vnd.github.raw', raw: true }
    );
    const buf = await rawRes.arrayBuffer();
    return new Blob([buf], { type: inferMimeType(path.split('/').pop() || '') });
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
    return [
      { section: 'File' },
      ['Name', meta.name || path.split('/').pop() || ''],
      ['Path', meta.path || path],
      ['Type', meta.type === 'dir' ? 'Folder' : 'File'],
      ['Size', meta.size != null ? formatSize(meta.size) : '—'],
      ['SHA', meta.sha || '—'],
      ['Storage', `${disk.owner}/${disk.repo}`],
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
    const usageFormatted = formatSize(usage);
    return {
      usage,
      limit: null,
      available: null,
      usageFormatted,
      limitFormatted: 'No limit',
      availableFormatted: '—',
      label: `${usageFormatted} used · GitHub repository`,
      shortLabel: usageFormatted,
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
    isGithubId,
    getDisks,
    getDisk,
    getDiskByName,
    createDisk,
    removeDisk,
    listFiles,
    listTrash,
    createFolder,
    createFile,
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
