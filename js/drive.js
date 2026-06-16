const Drive = (() => {
  const FOLDER_MIME = 'application/vnd.google-apps.folder';
  const ROOT_ID = 'root';

  const MIME_ICONS = {
    [FOLDER_MIME]: '📁',
    'application/vnd.google-apps.document': '📄',
    'application/vnd.google-apps.spreadsheet': '📊',
    'application/vnd.google-apps.presentation': '📽️',
    'application/vnd.google-apps.form': '📋',
    'application/vnd.google-apps.drawing': '🎨',
    'application/pdf': '📕',
    'image/': '🖼️',
    'video/': '🎬',
    'audio/': '🎵',
    'text/': '📝',
    'application/zip': '📦',
    'application/x-zip-compressed': '📦',
  };

  function markDriveError(error, status, message) {
    error.status = status;
    if (status === 403 && /insufficient.*scope/i.test(message)) {
      error.code = 'INSUFFICIENT_SCOPES';
    } else if (status === 403 || status === 404) {
      error.code = 'NO_WRITE_ACCESS';
    }
    return error;
  }

  async function apiRequest(path, token, options = {}) {
    const res = await fetch(`https://www.googleapis.com/drive/v3${path}`, {
      headers: { Authorization: `Bearer ${token}`, ...options.headers },
      method: options.method || 'GET',
      body: options.body,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const message = err.error?.message || `Drive API error (${res.status})`;
      throw markDriveError(new Error(message), res.status, message);
    }
    if (options.raw) return res;
    if (res.status === 204) return null;
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }

  async function renameFile(token, fileId, name) {
    return apiRequest(`/files/${fileId}`, token, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
  }

  async function trashFile(token, fileId) {
    return apiRequest(`/files/${fileId}`, token, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trashed: true }),
    });
  }

  async function restoreFile(token, fileId) {
    return apiRequest(`/files/${fileId}`, token, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trashed: false }),
    });
  }

  async function deleteFile(token, fileId) {
    return apiRequest(`/files/${fileId}`, token, { method: 'DELETE' });
  }

  async function createFolder(token, parentId, name) {
    return apiRequest('/files', token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        mimeType: FOLDER_MIME,
        parents: [parentId],
      }),
    });
  }

  async function uploadMultipart(token, metadata, content, mimeType) {
    const boundary = `mygoogle_${Date.now()}`;
    const body =
      `--${boundary}\r\n` +
      `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
      `${JSON.stringify(metadata)}\r\n` +
      `--${boundary}\r\n` +
      `Content-Type: ${mimeType}\r\n\r\n` +
      `${content}\r\n` +
      `--${boundary}--\r\n`;

    const res = await fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,webViewLink,parents',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': `multipart/related; boundary=${boundary}`,
        },
        body,
      }
    );
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const message = err.error?.message || `Drive upload error (${res.status})`;
      throw markDriveError(new Error(message), res.status, message);
    }
    return res.json();
  }

  async function createFile(token, parentId, name, mimeType, content = '') {
    return uploadMultipart(
      token,
      { name, mimeType, parents: [parentId] },
      content,
      mimeType
    );
  }

  async function createGoogleApp(token, parentId, name, mimeType) {
    return apiRequest('/files?fields=id,name,mimeType,webViewLink,parents', token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, mimeType, parents: [parentId] }),
    });
  }

  async function uploadBlobMultipart(token, metadata, blob, contentMime) {
    const boundary = `mygoogle_${Date.now()}`;
    const metaPart = JSON.stringify(metadata);
    const preamble = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metaPart}\r\n--${boundary}\r\nContent-Type: ${contentMime}\r\n\r\n`;
    const closing = `\r\n--${boundary}--\r\n`;
    const body = new Blob([
      new TextEncoder().encode(preamble),
      blob,
      new TextEncoder().encode(closing),
    ]);

    const res = await fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,webViewLink,parents',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': `multipart/related; boundary=${boundary}`,
        },
        body,
      }
    );
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || `Drive upload error (${res.status})`);
    }
    return res.json();
  }

  const GOOGLE_IMPORT_EXPORT = {
    'application/vnd.google-apps.document': {
      export: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      import: 'application/vnd.google-apps.document',
    },
    'application/vnd.google-apps.spreadsheet': {
      export: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      import: 'application/vnd.google-apps.spreadsheet',
    },
    'application/vnd.google-apps.presentation': {
      export: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      import: 'application/vnd.google-apps.presentation',
    },
    'application/vnd.google-apps.drawing': {
      export: 'image/png',
      import: 'application/vnd.google-apps.drawing',
    },
  };

  async function copyItemToUser(sourceToken, destToken, fileId, destParentId, fileMeta) {
    let meta = fileMeta;
    if (!meta?.mimeType || !meta?.name) {
      meta = await apiRequest(`/files/${fileId}?fields=id,name,mimeType`, sourceToken);
    }

    if (meta.mimeType === FOLDER_MIME) {
      const folder = await createFolder(destToken, destParentId, meta.name);
      const children = await listFiles(sourceToken, fileId);
      for (const child of children) {
        await copyItemToUser(sourceToken, destToken, child.id, folder.id, child);
      }
      return folder;
    }

    const googleImport = GOOGLE_IMPORT_EXPORT[meta.mimeType];
    if (googleImport) {
      const res = await apiRequest(
        `/files/${fileId}/export?mimeType=${encodeURIComponent(googleImport.export)}`,
        sourceToken,
        { raw: true }
      );
      const blob = await res.blob();
      return uploadBlobMultipart(
        destToken,
        { name: meta.name, mimeType: googleImport.import, parents: [destParentId] },
        blob,
        googleImport.export
      );
    }

    if (meta.mimeType?.startsWith('application/vnd.google-apps.')) {
      return createGoogleApp(destToken, destParentId, meta.name, meta.mimeType);
    }

    const blob = await downloadFile(sourceToken, fileId, meta.mimeType);
    if (isEditableTextFile(meta)) {
      const text = await blob.text();
      return uploadMultipart(
        destToken,
        { name: meta.name, mimeType: meta.mimeType, parents: [destParentId] },
        text,
        meta.mimeType
      );
    }

    return uploadBlobMultipart(
      destToken,
      { name: meta.name, mimeType: meta.mimeType, parents: [destParentId] },
      blob,
      meta.mimeType || 'application/octet-stream'
    );
  }

  async function getTextFileContent(token, fileId) {
    const res = await apiRequest(`/files/${fileId}?alt=media`, token, { raw: true });
    return res.text();
  }

  async function updateFileContent(token, fileId, content, mimeType = 'text/plain') {
    const res = await fetch(
      `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media&fields=id,name,mimeType,modifiedTime`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': mimeType,
        },
        body: content,
      }
    );
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const message = err.error?.message || `Drive upload error (${res.status})`;
      throw markDriveError(new Error(message), res.status, message);
    }
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }

  function canEditFile(meta) {
    if (!meta) return false;
    if (meta.capabilities && typeof meta.capabilities.canEdit === 'boolean') {
      return meta.capabilities.canEdit;
    }
    return meta.ownedByMe !== false;
  }

  async function canWriteFile(token, fileId) {
    const meta = await getFileMeta(token, fileId);
    return canEditFile(meta);
  }

  function isEditableTextFile(file) {
    const mime = (file.mimeType || '').toLowerCase();
    const name = (file.name || '').toLowerCase();
    if (mime.startsWith('text/')) return true;
    if (['application/json', 'application/xml', 'application/javascript', 'application/rtf'].includes(mime)) {
      return true;
    }
    return /\.(txt|md|markdown|html?|css|js|mjs|cjs|json|xml|csv|rtf|log|ini|cfg|conf|yaml|yml|ts|tsx|jsx|py|sh|bat|sql)$/i.test(name);
  }

  function isNotepadFile(file) {
    const mime = (file.mimeType || '').toLowerCase();
    const name = (file.name || '').toLowerCase();
    if (mime === 'text/plain' || mime === 'application/json') return true;
    return /\.(txt|json)$/i.test(name);
  }

  async function getFileMeta(token, fileId) {
    return apiRequest(
      `/files/${fileId}?fields=id,name,mimeType,webViewLink,parents,capabilities,ownedByMe`,
      token
    );
  }

  function parseNotepadFilePath(raw) {
    const path = (raw || '').trim();
    if (!path) return [];
    const cleaned = path.startsWith('/') ? path.slice(1) : path;
    if (!cleaned) return [];
    return cleaned.split('/').map((s) => decodeURIComponent(s));
  }

  async function buildNotepadFilePath(token, userLabel, file) {
    const segments = [userLabel, 'My Drive'];
    const parentId = file.parents?.[0] || ROOT_ID;

    if (parentId !== ROOT_ID) {
      const path = await getFolderPath(token, parentId);
      path.slice(1).forEach((crumb) => {
        if (crumb.name !== 'My Drive') segments.push(crumb.name);
      });
    }

    segments.push(file.name);
    return `/${segments.join('/')}`;
  }

  async function resolveFileByPath(token, segments) {
    if (segments.length < 3) throw new Error('Invalid file path');

    const fileName = segments[segments.length - 1];
    const folderNames = segments[1] === 'My Drive'
      ? segments.slice(2, -1)
      : segments.slice(1, -1);

    let parentId = ROOT_ID;
    for (const name of folderNames) {
      const items = await listFiles(token, parentId);
      const folder = items.find((f) => f.isFolder && f.name === name);
      if (!folder) throw new Error(`Folder not found: ${name}`);
      parentId = folder.id;
    }

    const items = await listFiles(token, parentId);
    const file = items.find((f) => !f.isFolder && f.name === fileName);
    if (!file) throw new Error(`File not found: ${fileName}`);

    return {
      id: file.id,
      name: file.name,
      mimeType: file.mimeType,
      parents: file.parents,
      webViewLink: file.webViewLink,
    };
  }

  async function copyFile(token, fileId, parentId) {
    return apiRequest(`/files/${fileId}/copy`, token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parents: [parentId] }),
    });
  }

  async function moveFile(token, fileId, fromParentId, toParentId) {
    let remove = fromParentId;
    if (!remove) {
      const meta = await apiRequest(`/files/${fileId}?fields=parents`, token);
      remove = meta.parents?.[0];
    }
    const params = new URLSearchParams({
      addParents: toParentId,
      removeParents: remove || '',
    });
    return apiRequest(`/files/${fileId}?${params}`, token, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
  }

  const EXPORT_MIME = {
    'application/vnd.google-apps.document': 'application/pdf',
    'application/vnd.google-apps.spreadsheet':
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.google-apps.presentation': 'application/pdf',
    'application/vnd.google-apps.drawing': 'application/pdf',
  };

  async function downloadFile(token, fileId, mimeType) {
    const exportMime = EXPORT_MIME[mimeType];
    const path = exportMime
      ? `/files/${fileId}/export?mimeType=${encodeURIComponent(exportMime)}`
      : `/files/${fileId}?alt=media`;
    const res = await apiRequest(path, token, { raw: true });
    return res.blob();
  }

  function getIcon(file) {
    if (file.mimeType === FOLDER_MIME) return MIME_ICONS[FOLDER_MIME];
    for (const [prefix, icon] of Object.entries(MIME_ICONS)) {
      if (prefix.endsWith('/') ? file.mimeType.startsWith(prefix) : file.mimeType === prefix) {
        return icon;
      }
    }
    return '📄';
  }

  function formatSize(bytes) {
    if (!bytes) return '—';
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = Number(bytes);
    let i = 0;
    while (size >= 1024 && i < units.length - 1) {
      size /= 1024;
      i++;
    }
    return `${size.toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
  }

  function formatDate(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function getTypeName(mime) {
    const types = {
      [FOLDER_MIME]: 'Folder',
      'application/vnd.google-apps.document': 'Google Doc',
      'application/vnd.google-apps.spreadsheet': 'Google Sheet',
      'application/vnd.google-apps.presentation': 'Google Slides',
      'application/vnd.google-apps.form': 'Google Form',
      'application/pdf': 'PDF',
    };
    if (types[mime]) return types[mime];
    if (mime.startsWith('image/')) return 'Image';
    if (mime.startsWith('video/')) return 'Video';
    if (mime.startsWith('audio/')) return 'Audio';
    if (mime.startsWith('text/')) return 'Text file';
    const ext = mime.split('/').pop();
    return ext ? ext.toUpperCase() : 'File';
  }

  async function listFolders(token, folderId = ROOT_ID) {
    const q = `'${folderId}' in parents and trashed=false and mimeType='${FOLDER_MIME}'`;
    const fields = 'files(id,name)';
    const path = `/files?q=${encodeURIComponent(q)}&fields=${fields}&orderBy=name&pageSize=200`;
    const data = await apiRequest(path, token);
    return (data.files || []).map((f) => ({ id: f.id, name: f.name }));
  }

  async function listFiles(token, folderId = ROOT_ID) {
    const q = `'${folderId}' in parents and trashed=false`;
    const fields = 'files(id,name,mimeType,modifiedTime,size,iconLink,thumbnailLink,webViewLink,parents)';
    const orderBy = 'folder,name';
    const path = `/files?q=${encodeURIComponent(q)}&fields=${fields}&orderBy=${orderBy}&pageSize=200`;
    const data = await apiRequest(path, token);
    return (data.files || []).map((f) => ({
      ...f,
      parents: f.parents || [],
      isFolder: f.mimeType === FOLDER_MIME,
      icon: getIcon(f),
      sizeFormatted: formatSize(f.size),
      dateFormatted: formatDate(f.modifiedTime),
      typeName: getTypeName(f.mimeType),
    }));
  }

  async function listShared(token) {
    const q = `sharedWithMe=true and trashed=false`;
    const fields = 'files(id,name,mimeType,modifiedTime,size,iconLink,thumbnailLink,webViewLink)';
    const path = `/files?q=${encodeURIComponent(q)}&fields=${fields}&orderBy=folder,name&pageSize=200`;
    const data = await apiRequest(path, token);
    return (data.files || []).map((f) => ({
      ...f,
      isFolder: f.mimeType === FOLDER_MIME,
      icon: getIcon(f),
      sizeFormatted: formatSize(f.size),
      dateFormatted: formatDate(f.modifiedTime),
      typeName: getTypeName(f.mimeType),
    }));
  }

  async function listStarred(token) {
    const q = `starred=true and trashed=false`;
    const fields = 'files(id,name,mimeType,modifiedTime,size,iconLink,thumbnailLink,webViewLink)';
    const path = `/files?q=${encodeURIComponent(q)}&fields=${fields}&orderBy=folder,name&pageSize=200`;
    const data = await apiRequest(path, token);
    return (data.files || []).map((f) => ({
      ...f,
      isFolder: f.mimeType === FOLDER_MIME,
      icon: getIcon(f),
      sizeFormatted: formatSize(f.size),
      dateFormatted: formatDate(f.modifiedTime),
      typeName: getTypeName(f.mimeType),
    }));
  }

  async function listRecent(token) {
    const q = `trashed=false`;
    const fields = 'files(id,name,mimeType,modifiedTime,size,iconLink,thumbnailLink,webViewLink)';
    const path = `/files?q=${encodeURIComponent(q)}&fields=${fields}&orderBy=modifiedTime desc&pageSize=50`;
    const data = await apiRequest(path, token);
    return (data.files || []).map((f) => ({
      ...f,
      isFolder: f.mimeType === FOLDER_MIME,
      icon: getIcon(f),
      sizeFormatted: formatSize(f.size),
      dateFormatted: formatDate(f.modifiedTime),
      typeName: getTypeName(f.mimeType),
    }));
  }

  async function listTrash(token) {
    const q = 'trashed=true';
    const fields = 'files(id,name,mimeType,modifiedTime,size,iconLink,thumbnailLink,webViewLink,trashedTime,parents)';
    const path = `/files?q=${encodeURIComponent(q)}&fields=${fields}&orderBy=folder,modifiedTime desc&pageSize=200`;
    const data = await apiRequest(path, token);
    return (data.files || []).map((f) => ({
      ...f,
      parents: f.parents || [],
      isFolder: f.mimeType === FOLDER_MIME,
      icon: getIcon(f),
      sizeFormatted: formatSize(f.size),
      dateFormatted: formatDate(f.trashedTime || f.modifiedTime),
      typeName: getTypeName(f.mimeType),
    }));
  }

  async function getStorageQuota(token) {
    const data = await apiRequest('/about?fields=storageQuota', token);
    const q = data.storageQuota || {};
    const usage = Number(q.usage || 0);
    const limit = Number(q.limit || 0);
    const hasLimit = limit > 0;
    const available = hasLimit ? Math.max(0, limit - usage) : null;

    const usageFormatted = formatSize(usage);
    const limitFormatted = hasLimit ? formatSize(limit) : 'Unlimited';
    const availableFormatted = hasLimit ? formatSize(available) : 'Unlimited';

    return {
      usage,
      limit,
      available,
      usageFormatted,
      limitFormatted,
      availableFormatted,
      label: hasLimit
        ? `${availableFormatted} free · ${limitFormatted}`
        : `${usageFormatted} used · Unlimited`,
      shortLabel: hasLimit
        ? `${availableFormatted} / ${limitFormatted}`
        : `${usageFormatted} · ∞`,
    };
  }

  function formatUser(user) {
    if (!user) return null;
    const name = user.displayName || user.emailAddress || 'Unknown';
    if (user.me) return `${name} (you)`;
    if (user.emailAddress && user.displayName) {
      return `${name} (${user.emailAddress})`;
    }
    return name;
  }

  function formatUserList(users) {
    if (!users?.length) return null;
    return users.map(formatUser).filter(Boolean).join(', ');
  }

  function yesNo(val) {
    if (val === undefined || val === null) return null;
    return val ? 'Yes' : 'No';
  }

  function formatCapabilities(caps) {
    if (!caps) return null;
    const labels = {
      canEdit: 'Can edit',
      canComment: 'Can comment',
      canCopy: 'Can copy',
      canDownload: 'Can download',
      canReadRevisions: 'Can read revisions',
      canDelete: 'Can delete',
      canTrash: 'Can move to trash',
      canRename: 'Can rename',
      canShare: 'Can share',
      canMoveItemWithinDrive: 'Can move within Drive',
      canMoveItemOutOfDrive: 'Can move out of Drive',
      canAddChildren: 'Can add items inside',
      canRemoveChildren: 'Can remove items inside',
      canListChildren: 'Can list children',
    };
    return Object.entries(labels)
      .filter(([key]) => caps[key])
      .map(([, label]) => label)
      .join(', ') || null;
  }

  async function resolveParentPath(token, parentIds) {
    if (!parentIds?.length) return null;
    const names = await Promise.all(
      parentIds.map(async (id) => {
        if (id === ROOT_ID) return 'My Drive';
        const data = await apiRequest(`/files/${id}?fields=name`, token);
        return data.name;
      })
    );
    return names.join(' › ');
  }

  async function getFileProperties(token, fileId) {
    const fields = [
      'id', 'name', 'mimeType', 'description', 'size', 'quotaBytesUsed',
      'createdTime', 'modifiedTime', 'viewedByMeTime', 'modifiedByMeTime',
      'sharedWithMeTime', 'trashedTime', 'starred', 'trashed', 'explicitlyTrashed',
      'owners', 'lastModifyingUser', 'sharingUser', 'parents',
      'webViewLink', 'webContentLink', 'thumbnailLink', 'iconLink',
      'originalFilename', 'fileExtension', 'md5Checksum', 'sha1Checksum', 'sha256Checksum',
      'version', 'ownedByMe', 'shared', 'viewersCanCopyContent', 'writersCanShare',
      'folderColorRgb', 'capabilities', 'properties', 'appProperties', 'spaces',
    ].join(',');

    const f = await apiRequest(`/files/${fileId}?fields=${fields}`, token);
    const parentPath = await resolveParentPath(token, f.parents);

    const rows = [
      { section: 'General' },
      ['Name', f.name],
      ['Type', getTypeName(f.mimeType)],
      ['MIME type', f.mimeType],
      ['Description', f.description],
      ['Size', f.size ? formatSize(f.size) : null],
      ['Storage used', f.quotaBytesUsed ? formatSize(f.quotaBytesUsed) : null],
      ['Location', parentPath],
      ['File extension', f.fileExtension],
      ['Original filename', f.originalFilename],
      { section: 'People' },
      ['Created by', formatUser(f.owners?.[0])],
      ['Owners', formatUserList(f.owners)],
      ['Last modified by', formatUser(f.lastModifyingUser)],
      ['Shared with me by', formatUser(f.sharingUser)],
      { section: 'Dates' },
      ['Created', formatDate(f.createdTime)],
      ['Modified', formatDate(f.modifiedTime)],
      ['Viewed by me', formatDate(f.viewedByMeTime)],
      ['Modified by me', formatDate(f.modifiedByMeTime)],
      ['Shared with me', formatDate(f.sharedWithMeTime)],
      ['Trashed', formatDate(f.trashedTime)],
      { section: 'Status' },
      ['Starred', yesNo(f.starred)],
      ['Trashed', yesNo(f.trashed)],
      ['Explicitly trashed', yesNo(f.explicitlyTrashed)],
      ['Owned by me', yesNo(f.ownedByMe)],
      ['Shared', yesNo(f.shared)],
      ['Viewers can copy', yesNo(f.viewersCanCopyContent)],
      ['Writers can share', yesNo(f.writersCanShare)],
      { section: 'Technical' },
      ['ID', f.id],
      ['Version', f.version != null ? String(f.version) : null],
      ['MD5', f.md5Checksum],
      ['SHA-1', f.sha1Checksum],
      ['SHA-256', f.sha256Checksum],
      ['Folder color', f.folderColorRgb],
      ['Spaces', f.spaces?.join(', ')],
      ['Capabilities', formatCapabilities(f.capabilities)],
      ['Custom properties', f.properties ? JSON.stringify(f.properties) : null],
      ['App properties', f.appProperties ? JSON.stringify(f.appProperties) : null],
      { section: 'Links' },
      ['View link', f.webViewLink],
      ['Download link', f.webContentLink],
      ['Thumbnail', f.thumbnailLink],
      ['Icon', f.iconLink],
    ];

    return rows;
  }

  async function getFolderPath(token, folderId) {
    if (folderId === ROOT_ID) return [{ id: ROOT_ID, name: 'My Drive' }];

    const path = [];
    let currentId = folderId;

    while (currentId && currentId !== ROOT_ID) {
      const data = await apiRequest(
        `/files/${currentId}?fields=id,name,parents`,
        token
      );
      path.unshift({ id: data.id, name: data.name });
      currentId = data.parents?.[0] || ROOT_ID;
    }

    path.unshift({ id: ROOT_ID, name: 'My Drive' });
    return path;
  }

  return {
    ROOT_ID,
    getDefaultIcon: getIcon,
    listFiles,
    listFolders,
    listShared,
    listStarred,
    listRecent,
    listTrash,
    getFolderPath,
    getFileProperties,
    getStorageQuota,
    renameFile,
    trashFile,
    restoreFile,
    deleteFile,
    createFolder,
    createFile,
    createGoogleApp,
    getTextFileContent,
    updateFileContent,
    isEditableTextFile,
    isNotepadFile,
    getFileMeta,
    canEditFile,
    canWriteFile,
    parseNotepadFilePath,
    buildNotepadFilePath,
    resolveFileByPath,
    copyItemToUser,
    copyFile,
    moveFile,
    downloadFile,
  };
})();
