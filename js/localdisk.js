const LocalDisk = (() => {
  const ROOT_ID = 'root';
  const FOLDER_MIME = 'application/x-local-folder';
  const STORAGE_KEY = 'storage_hub_local_disks';
  const LEGACY_STORAGE_KEY = 'mikus_drive_local_disks';
  const DB_NAME = 'storage_hub_local';
  const LEGACY_DB_NAME = 'mikus_drive_local';
  const DB_VERSION = 2;
  const ID_PREFIX = 'local:';

  let db = null;
  let dbPromise = null;
  let disks = [];

  function isLocalId(id) {
    return typeof id === 'string' && id.startsWith(ID_PREFIX);
  }

  function makeDiskId() {
    return `${ID_PREFIX}${crypto.randomUUID()}`;
  }

  function makeEntryId() {
    return crypto.randomUUID();
  }

  function loadDisks() {
    try {
      if (typeof StorageMigrate !== 'undefined') {
        StorageMigrate.migrateLocalStorageKey(STORAGE_KEY, [LEGACY_STORAGE_KEY]);
      } else if (!localStorage.getItem(STORAGE_KEY) && localStorage.getItem(LEGACY_STORAGE_KEY)) {
        localStorage.setItem(STORAGE_KEY, localStorage.getItem(LEGACY_STORAGE_KEY));
      }
      const data = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{"disks":[]}');
      disks = (data.disks || []).map((disk) => ({
        ...disk,
        sizeLimit: Number(disk.sizeLimit) || 0,
      }));
    } catch {
      disks = [];
    }
  }

  function saveDisks() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ disks }));
  }

  function deleteDatabase() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.deleteDatabase(DB_NAME);
      req.onsuccess = () => resolve();
      req.onblocked = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  function attachDbHandlers(database) {
    database.onversionchange = () => {
      database.close();
      db = null;
      dbPromise = null;
    };
    database.onclose = () => {
      db = null;
      dbPromise = null;
    };
  }

  function runUpgrade(database, transaction) {
    let store;
    if (!database.objectStoreNames.contains('entries')) {
      store = database.createObjectStore('entries', { keyPath: 'id' });
    } else {
      store = transaction.objectStore('entries');
    }
    if (!store.indexNames.contains('diskId')) {
      store.createIndex('diskId', 'diskId', { unique: false });
    }
    if (!store.indexNames.contains('parentId')) {
      store.createIndex('parentId', 'parentId', { unique: false });
    }
  }

  function requestOpen() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        runUpgrade(e.target.result, e.target.transaction);
      };
      req.onsuccess = () => {
        db = req.result;
        attachDbHandlers(db);
        resolve(db);
      };
      req.onerror = () => reject(req.error);
    });
  }

  async function migrateLegacyIndexedDbIfNeeded() {
    const countEntries = (dbName) => new Promise((resolve) => {
      const req = indexedDB.open(dbName);
      req.onsuccess = () => {
        const database = req.result;
        if (!database.objectStoreNames.contains('entries')) {
          database.close();
          resolve(0);
          return;
        }
        const tx = database.transaction('entries', 'readonly');
        const countReq = tx.objectStore('entries').count();
        countReq.onsuccess = () => {
          database.close();
          resolve(countReq.result || 0);
        };
        countReq.onerror = () => {
          database.close();
          resolve(0);
        };
      };
      req.onerror = () => resolve(0);
    });

    const openLegacyDb = () => new Promise((resolve, reject) => {
      const req = indexedDB.open(LEGACY_DB_NAME);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

    const newCount = await countEntries(DB_NAME);
    if (newCount > 0) return;

    const legacyCount = await countEntries(LEGACY_DB_NAME);
    if (legacyCount === 0) return;

    let legacyDb;
    try {
      legacyDb = await openLegacyDb();
    } catch {
      return;
    }

    const entries = await new Promise((resolve, reject) => {
      const tx = legacyDb.transaction('entries', 'readonly');
      const getAll = tx.objectStore('entries').getAll();
      getAll.onsuccess = () => resolve(getAll.result || []);
      getAll.onerror = () => reject(getAll.error);
    });
    legacyDb.close();
    if (!entries.length) return;

    const database = await requestOpen();
    await new Promise((resolve, reject) => {
      const tx = database.transaction('entries', 'readwrite');
      const store = tx.objectStore('entries');
      entries.forEach((entry) => store.put(entry));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function openDbOnce() {
    await migrateLegacyIndexedDbIfNeeded();
    try {
      return await requestOpen();
    } catch (err) {
      db = null;
      await deleteDatabase();
      return requestOpen();
    }
  }

  async function openDb() {
    if (db) return db;
    if (!dbPromise) {
      dbPromise = openDbOnce().catch((err) => {
        db = null;
        dbPromise = null;
        throw err;
      });
    }
    return dbPromise;
  }

  async function withStore(storeName, mode, fn) {
    const database = await openDb();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(storeName, mode);
      const store = transaction.objectStore(storeName);
      transaction.oncomplete = () => {};
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error('IndexedDB transaction aborted'));

      Promise.resolve(fn(store))
        .then(resolve)
        .catch((err) => {
          transaction.abort();
          reject(err);
        });
    });
  }

  function idbRequest(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function getAllEntries(diskId) {
    return withStore('entries', 'readonly', async (store) => {
      const results = await idbRequest(store.index('diskId').getAll(diskId));
      return results || [];
    });
  }

  async function getEntry(id) {
    return withStore('entries', 'readonly', async (store) => {
      const result = await idbRequest(store.get(id));
      return result || null;
    });
  }

  async function getDiskUsage(diskId) {
    const entries = await getAllEntries(diskId);
    return entries
      .filter((e) => !e.trashed)
      .reduce((sum, e) => sum + (e.size || 0), 0);
  }

  function getReservedSize(excludeDiskId = null) {
    return disks.reduce((sum, disk) => {
      if (disk.id === excludeDiskId || !disk.sizeLimit) return sum;
      return sum + disk.sizeLimit;
    }, 0);
  }

  async function getBrowserStorage() {
    let quota = 0;
    let usage = 0;

    if (navigator.storage?.estimate) {
      try {
        const estimate = await navigator.storage.estimate();
        quota = estimate.quota || 0;
        usage = estimate.usage || 0;
      } catch {
        quota = 0;
        usage = 0;
      }
    }

    const available = Math.max(0, quota - usage);
    return {
      quota,
      usage,
      available,
      quotaFormatted: formatSize(quota),
      usageFormatted: formatSize(usage),
      availableFormatted: formatSize(available),
      supported: !!navigator.storage?.estimate,
    };
  }

  async function getAllocatableSize(excludeDiskId = null) {
    const { quota, usage } = await getBrowserStorage();
    if (!quota) return 10 * 1024 * 1024 * 1024;

    const reserved = getReservedSize(excludeDiskId);
    return Math.max(0, Math.min(quota - usage, quota - reserved));
  }

  async function checkDiskQuota(diskId, additionalBytes = 0) {
    const disk = getDisk(diskId);
    if (!disk?.sizeLimit) return;

    const usage = await getDiskUsage(diskId);
    if (usage + additionalBytes > disk.sizeLimit) {
      throw new Error(
        `Storage size limit reached (${formatSize(usage)} of ${formatSize(disk.sizeLimit)} used)`
      );
    }
  }

  async function putEntry(entry) {
    const existing = await getEntry(entry.id);
    const oldSize = existing?.size || 0;
    const newSize = entry.size || 0;
    const delta = Math.max(0, newSize - oldSize);
    if (delta > 0) await checkDiskQuota(entry.diskId, delta);

    await withStore('entries', 'readwrite', async (store) => {
      await idbRequest(store.put(entry));
    });
    return entry;
  }

  async function deleteEntry(id) {
    await withStore('entries', 'readwrite', async (store) => {
      await idbRequest(store.delete(id));
    });
  }

  async function deleteAllForDisk(diskId) {
    const entries = await getAllEntries(diskId);
    if (!entries.length) return;
    await withStore('entries', 'readwrite', async (store) => {
      await Promise.all(entries.map((entry) => idbRequest(store.delete(entry.id))));
    });
  }

  function formatSize(bytes) {
    if (bytes == null || Number.isNaN(bytes)) return '—';
    if (bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = Number(bytes);
    let i = 0;
    while (size >= 1024 && i < units.length - 1) {
      size /= 1024;
      i += 1;
    }
    return `${size.toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
  }

  function formatDate(ts) {
    if (!ts) return '—';
    return new Date(ts).toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function getIcon(entry) {
    if (entry.mimeType === FOLDER_MIME) return '📁';
    const mime = entry.mimeType || '';
    if (mime.startsWith('image/')) return '🖼️';
    if (mime.startsWith('video/')) return '🎬';
    if (mime.startsWith('audio/')) return '🎵';
    if (mime.startsWith('text/') || mime === 'application/json') return '📝';
    return '📄';
  }

  function getTypeName(mime) {
    if (mime === FOLDER_MIME) return 'Folder';
    if (mime === 'application/json') return 'JSON';
    if (mime?.startsWith('text/')) return 'Text file';
    if (mime?.startsWith('image/')) return 'Image';
    return 'File';
  }

  function mapEntry(entry) {
    return {
      id: entry.id,
      name: entry.name,
      mimeType: entry.mimeType,
      parents: entry.parentId ? [entry.parentId] : [],
      parentId: entry.parentId,
      isFolder: entry.mimeType === FOLDER_MIME,
      icon: getIcon(entry),
      size: entry.size || 0,
      sizeFormatted: formatSize(entry.size),
      dateFormatted: formatDate(entry.modifiedAt),
      typeName: getTypeName(entry.mimeType),
      modifiedTime: new Date(entry.modifiedAt).toISOString(),
      createdTime: new Date(entry.createdAt).toISOString(),
      trashed: !!entry.trashed,
      trashedTime: entry.trashedAt ? new Date(entry.trashedAt).toISOString() : null,
    };
  }

  function init() {
    loadDisks();
    return openDb();
  }

  function getDisks() {
    return disks.slice();
  }

  function getDisk(diskId) {
    return disks.find((d) => d.id === diskId) || null;
  }

  function getDiskByName(name) {
    const found = disks.find((d) => d.name === name);
    if (found) return found;
    if (name === 'Local Disk') return disks.find((d) => d.name === 'Local Storage') || null;
    if (name === 'Local Storage') return disks.find((d) => d.name === 'Local Disk') || null;
    return null;
  }

  async function createDisk(name, sizeLimit = 0) {
    const trimmed = name?.trim();
    if (!trimmed) throw new Error('Storage name is required');
    if (disks.some((d) => d.name === trimmed)) {
      throw new Error(`A storage volume named "${trimmed}" already exists`);
    }

    const limit = Math.max(0, Number(sizeLimit) || 0);
    const allocatable = await getAllocatableSize();
    if (limit > allocatable) {
      throw new Error(`Storage size cannot exceed ${formatSize(allocatable)} (available for allocation)`);
    }

    const disk = {
      id: makeDiskId(),
      name: trimmed,
      sizeLimit: limit,
      createdAt: Date.now(),
    };
    disks.push(disk);
    saveDisks();
    return disk;
  }

  async function renameDisk(diskId, name) {
    const trimmed = name?.trim();
    if (!trimmed) throw new Error('Storage name is required');
    const disk = getDisk(diskId);
    if (!disk) throw new Error('Storage not found');
    if (disks.some((d) => d.id !== diskId && d.name === trimmed)) {
      throw new Error(`A storage volume named "${trimmed}" already exists`);
    }
    disk.name = trimmed;
    saveDisks();
    return disk;
  }

  async function removeDisk(diskId) {
    disks = disks.filter((d) => d.id !== diskId);
    saveDisks();
    await deleteAllForDisk(diskId);
  }

  async function listFiles(diskId, folderId = ROOT_ID, { trashed = false } = {}) {
    const entries = await getAllEntries(diskId);
    return entries
      .filter((e) => e.parentId === folderId && !!e.trashed === trashed)
      .sort((a, b) => {
        const aFolder = a.mimeType === FOLDER_MIME;
        const bFolder = b.mimeType === FOLDER_MIME;
        if (aFolder !== bFolder) return aFolder ? -1 : 1;
        return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
      })
      .map((e) => ({ ...mapEntry(e), userId: diskId }));
  }

  async function listTrash(diskId) {
    const entries = await getAllEntries(diskId);
    return entries
      .filter((e) => e.trashed)
      .sort((a, b) => (b.trashedAt || 0) - (a.trashedAt || 0))
      .map((e) => ({ ...mapEntry(e), userId: diskId }));
  }

  async function createFolder(diskId, parentId, name) {
    const now = Date.now();
    const entry = {
      id: makeEntryId(),
      diskId,
      parentId,
      name: name.trim(),
      mimeType: FOLDER_MIME,
      content: null,
      size: 0,
      createdAt: now,
      modifiedAt: now,
      trashed: false,
      trashedAt: null,
    };
    await putEntry(entry);
    return mapEntry(entry);
  }

  async function createFile(diskId, parentId, name, mimeType, content = '') {
    const text = typeof content === 'string' ? content : '';
    const now = Date.now();
    const entry = {
      id: makeEntryId(),
      diskId,
      parentId,
      name: name.trim(),
      mimeType,
      content: text,
      size: new TextEncoder().encode(text).length,
      createdAt: now,
      modifiedAt: now,
      trashed: false,
      trashedAt: null,
    };
    await putEntry(entry);
    return mapEntry(entry);
  }

  async function findSiblingByName(diskId, parentId, name) {
    const siblings = await listFiles(diskId, parentId);
    return siblings.find((item) => item.name.toLowerCase() === name.toLowerCase()) || null;
  }

  async function replaceFile(diskId, parentId, name, mimeType, content = '') {
    const existing = await findSiblingByName(diskId, parentId, name);
    if (!existing || existing.isFolder) throw new Error('File not found');
    const entry = await getEntry(existing.id);
    const text = typeof content === 'string' ? content : '';
    entry.mimeType = mimeType;
    entry.content = text;
    entry.size = new TextEncoder().encode(text).length;
    entry.modifiedAt = Date.now();
    await putEntry(entry);
    return mapEntry(entry);
  }

  async function renameFile(diskId, fileId, name) {
    const entry = await getEntry(fileId);
    if (!entry || entry.diskId !== diskId) throw new Error('File not found');
    entry.name = name.trim();
    entry.modifiedAt = Date.now();
    await putEntry(entry);
    return mapEntry(entry);
  }

  async function trashFile(diskId, fileId) {
    const entry = await getEntry(fileId);
    if (!entry || entry.diskId !== diskId) throw new Error('File not found');
    entry.trashed = true;
    entry.trashedAt = Date.now();
    entry.modifiedAt = Date.now();
    await putEntry(entry);
    if (entry.mimeType === FOLDER_MIME) {
      await trashChildren(diskId, fileId);
    }
    return mapEntry(entry);
  }

  async function trashChildren(diskId, folderId) {
    const entries = await getAllEntries(diskId);
    const children = entries.filter((e) => e.parentId === folderId && !e.trashed);
    for (const child of children) {
      child.trashed = true;
      child.trashedAt = Date.now();
      child.modifiedAt = Date.now();
      await putEntry(child);
      if (child.mimeType === FOLDER_MIME) {
        await trashChildren(diskId, child.id);
      }
    }
  }

  async function restoreFile(diskId, fileId) {
    const entry = await getEntry(fileId);
    if (!entry || entry.diskId !== diskId) throw new Error('File not found');
    entry.trashed = false;
    entry.trashedAt = null;
    entry.modifiedAt = Date.now();
    await putEntry(entry);
    return mapEntry(entry);
  }

  async function deleteFile(diskId, fileId) {
    const entry = await getEntry(fileId);
    if (!entry || entry.diskId !== diskId) throw new Error('File not found');
    if (entry.mimeType === FOLDER_MIME) {
      await deleteChildren(diskId, fileId);
    }
    await deleteEntry(fileId);
  }

  async function deleteChildren(diskId, folderId) {
    const entries = await getAllEntries(diskId);
    const children = entries.filter((e) => e.parentId === folderId);
    for (const child of children) {
      if (child.mimeType === FOLDER_MIME) {
        await deleteChildren(diskId, child.id);
      }
      await deleteEntry(child.id);
    }
  }

  async function moveFile(diskId, fileId, fromParentId, toParentId) {
    const entry = await getEntry(fileId);
    if (!entry || entry.diskId !== diskId) throw new Error('File not found');
    entry.parentId = toParentId;
    entry.modifiedAt = Date.now();
    await putEntry(entry);
    return mapEntry(entry);
  }

  async function copyFile(diskId, fileId, parentId) {
    const entry = await getEntry(fileId);
    if (!entry || entry.diskId !== diskId) throw new Error('File not found');
    if (entry.mimeType === FOLDER_MIME) {
      const folder = await createFolder(diskId, parentId, `${entry.name} (copy)`);
      const children = (await getAllEntries(diskId)).filter(
        (e) => e.parentId === fileId && !e.trashed
      );
      for (const child of children) {
        await copyEntryRecursive(diskId, child, folder.id);
      }
      return folder;
    }
    return copyEntryRecursive(diskId, entry, parentId, `${entry.name} (copy)`);
  }

  async function copyEntryRecursive(diskId, entry, parentId, nameOverride) {
    const now = Date.now();
    const copy = {
      id: makeEntryId(),
      diskId,
      parentId,
      name: nameOverride || entry.name,
      mimeType: entry.mimeType,
      content: entry.content,
      size: entry.size || 0,
      createdAt: now,
      modifiedAt: now,
      trashed: false,
      trashedAt: null,
    };
    await putEntry(copy);
    if (entry.mimeType === FOLDER_MIME) {
      const children = (await getAllEntries(diskId)).filter(
        (e) => e.parentId === entry.id && !e.trashed
      );
      for (const child of children) {
        await copyEntryRecursive(diskId, child, copy.id);
      }
    }
    return mapEntry(copy);
  }

  async function getTextFileContent(diskId, fileId) {
    const entry = await getEntry(fileId);
    if (!entry || entry.diskId !== diskId) throw new Error('File not found');
    return entry.content || '';
  }

  async function updateFileContent(diskId, fileId, content, mimeType = 'text/plain') {
    const entry = await getEntry(fileId);
    if (!entry || entry.diskId !== diskId) throw new Error('File not found');
    const text = typeof content === 'string' ? content : '';
    entry.content = text;
    entry.size = new TextEncoder().encode(text).length;
    entry.mimeType = mimeType || entry.mimeType;
    entry.modifiedAt = Date.now();
    await putEntry(entry);
    return mapEntry(entry);
  }

  async function downloadFile(diskId, fileId) {
    const entry = await getEntry(fileId);
    if (!entry || entry.diskId !== diskId) throw new Error('File not found');
    const content = entry.content || '';
    return new Blob([content], { type: entry.mimeType || 'application/octet-stream' });
  }

  async function getFolderPath(diskId, folderId) {
    if (folderId === ROOT_ID) return [{ id: ROOT_ID, name: 'My Drive' }];

    const path = [];
    let currentId = folderId;

    while (currentId && currentId !== ROOT_ID) {
      const entry = await getEntry(currentId);
      if (!entry) break;
      path.unshift({ id: entry.id, name: entry.name });
      currentId = entry.parentId;
    }

    path.unshift({ id: ROOT_ID, name: 'My Drive' });
    return path;
  }

  async function getFileProperties(diskId, fileId) {
    const entry = await getEntry(fileId);
    if (!entry || entry.diskId !== diskId) throw new Error('File not found');
    const disk = getDisk(diskId);
    const parentPath = entry.parentId === ROOT_ID
      ? `${disk?.name || 'Local storage'} › My Drive`
      : `${disk?.name || 'Local storage'} › My Drive › ${(await getFolderPath(diskId, entry.parentId)).slice(1).map((p) => p.name).join(' › ')}`;

    return [
      { section: 'General' },
      ['Name', entry.name],
      ['Type', getTypeName(entry.mimeType)],
      ['MIME type', entry.mimeType],
      ['Size', formatSize(entry.size)],
      ['Location', parentPath],
      { section: 'Dates' },
      ['Created', formatDate(entry.createdAt)],
      ['Modified', formatDate(entry.modifiedAt)],
      ['Trashed', entry.trashed ? 'Yes' : 'No'],
      { section: 'Technical' },
      ['ID', entry.id],
      ['Disk', disk?.name || diskId],
      ['Storage', 'Local (browser)'],
    ];
  }

  async function getStorageQuota(diskId) {
    const disk = getDisk(diskId);
    const usage = await getDiskUsage(diskId);
    const usageFormatted = formatSize(usage);
    const limit = disk?.sizeLimit || 0;

    if (limit > 0) {
      const available = Math.max(0, limit - usage);
      const availableFormatted = formatSize(available);
      return {
        usage,
        limit,
        available,
        usageFormatted,
        limitFormatted: formatSize(limit),
        availableFormatted,
        label: `${usageFormatted} used · ${availableFormatted} free of ${formatSize(limit)}`,
        shortLabel: `${usageFormatted} / ${formatSize(limit)}`,
      };
    }

    const browser = await getBrowserStorage();
    const allocatable = await getAllocatableSize(diskId);
    const availableFormatted = formatSize(allocatable);

    return {
      usage,
      limit: browser.quota || null,
      available: allocatable,
      usageFormatted,
      limitFormatted: browser.quota ? browser.quotaFormatted : 'No limit',
      availableFormatted,
      label: browser.supported
        ? `${usageFormatted} used · ${availableFormatted} available on device`
        : `${usageFormatted} used · No disk limit`,
      shortLabel: browser.supported
        ? `${usageFormatted} · ${availableFormatted} free`
        : usageFormatted,
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
    const segments = [disk?.name || 'Local storage', 'My Drive'];
    const parentId = file.parentId || file.parents?.[0] || ROOT_ID;

    if (parentId !== ROOT_ID) {
      const path = await getFolderPath(diskId, parentId);
      path.slice(1).forEach((crumb) => {
        if (crumb.name !== 'My Drive') segments.push(crumb.name);
      });
    }

    segments.push(file.name);
    return `/${segments.join('/')}`;
  }

  async function resolveFileByPath(segments) {
    if (segments.length < 3) throw new Error('Invalid file path');

    const disk = getDiskByName(segments[0]);
    if (!disk) throw new Error('Local storage not found');

    const fileName = segments[segments.length - 1];
    const folderNames = segments[1] === 'My Drive'
      ? segments.slice(2, -1)
      : segments.slice(1, -1);

    let parentId = ROOT_ID;
    for (const name of folderNames) {
      const items = await listFiles(disk.id, parentId);
      const folder = items.find((f) => f.isFolder && f.name === name);
      if (!folder) throw new Error(`Folder not found: ${name}`);
      parentId = folder.id;
    }

    const items = await listFiles(disk.id, parentId);
    const file = items.find((f) => !f.isFolder && f.name === fileName);
    if (!file) throw new Error(`File not found: ${fileName}`);
    return { diskId: disk.id, file };
  }

  return {
    ROOT_ID,
    FOLDER_MIME,
    ID_PREFIX,
    isLocalId,
    init,
    getDisks,
    getDisk,
    getDiskByName,
    getBrowserStorage,
    getAllocatableSize,
    getReservedSize,
    createDisk,
    renameDisk,
    removeDisk,
    listFiles,
    listTrash,
    createFolder,
    createFile,
    replaceFile,
    findSiblingByName,
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
