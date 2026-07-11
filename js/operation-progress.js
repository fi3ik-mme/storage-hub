const OperationProgress = (() => {
  const STORAGE_KEY = 'storage_hub_operation_stats';
  const ACTIVE = new Map();
  const ITEM_TRACKS = new Map();

  const DEFAULTS = {
    'github:create': { baseMs: 4500, perKbMs: 2 },
    'github:update': { baseMs: 4000, perKbMs: 2 },
    'github:delete': { baseMs: 12000, perKbMs: 0 },
    'github:move': { baseMs: 5500, perKbMs: 1.5 },
    'github:save': { baseMs: 4200, perKbMs: 2 },
    'google:upload': { baseMs: 2200, perKbMs: 1.2 },
    'google:download': { baseMs: 1800, perKbMs: 1 },
    'google:delete': { baseMs: 1400, perKbMs: 0 },
    'google:trash': { baseMs: 1200, perKbMs: 0 },
    'local:write': { baseMs: 350, perKbMs: 0.08 },
    'local:delete': { baseMs: 250, perKbMs: 0 },
    'cross:local->local:copy': { baseMs: 1200, perKbMs: 0.5 },
    'cross:local->local:cut': { baseMs: 1400, perKbMs: 0.5 },
    'cross:local->google:copy': { baseMs: 5000, perKbMs: 2.5 },
    'cross:local->google:cut': { baseMs: 5500, perKbMs: 2.5 },
    'cross:local->github:copy': { baseMs: 7000, perKbMs: 3 },
    'cross:local->github:cut': { baseMs: 7500, perKbMs: 3 },
    'cross:google->local:copy': { baseMs: 4500, perKbMs: 2 },
    'cross:google->local:cut': { baseMs: 5000, perKbMs: 2 },
    'cross:google->github:copy': { baseMs: 8000, perKbMs: 3.5 },
    'cross:google->github:cut': { baseMs: 8500, perKbMs: 3.5 },
    'cross:github->local:copy': { baseMs: 6000, perKbMs: 2.5 },
    'cross:github->local:cut': { baseMs: 6500, perKbMs: 2.5 },
    'cross:github->google:copy': { baseMs: 7000, perKbMs: 3 },
    'cross:github->google:cut': { baseMs: 7500, perKbMs: 3 },
    'cross:github->github:copy': { baseMs: 6500, perKbMs: 2.5 },
    'cross:github->github:cut': { baseMs: 7000, perKbMs: 2.5 },
    _default: { baseMs: 3500, perKbMs: 1.5 },
  };

  function key(...parts) {
    return parts.filter(Boolean).join(':');
  }

  function crossKey(sourceKind, destKind, mode = 'copy') {
    return key('cross', `${sourceKind}->${destKind}`, mode);
  }

  function loadStats() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  function saveStats(stats) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(stats));
    } catch {
      // Ignore quota errors.
    }
  }

  function estimateMs(operationKey, size = 0) {
    const stats = loadStats()[operationKey];
    const defaults = DEFAULTS[operationKey] || DEFAULTS._default;
    let base = stats?.avgMs || defaults.baseMs;
    const perKb = defaults.perKbMs || 0;

    if (size > 0 && stats?.avgBytes > 0 && stats?.avgMs > 0) {
      const scaled = stats.avgMs * (size / stats.avgBytes);
      base = Math.max(base, scaled);
    } else if (size > 0 && perKb > 0) {
      base += (size / 1024) * perKb;
    }

    return Math.max(800, Math.round(base));
  }

  function recordDuration(operationKey, durationMs, size = 0, success = true) {
    if (!success || !Number.isFinite(durationMs) || durationMs <= 0) return;
    const stats = loadStats();
    const entry = stats[operationKey] || {
      count: 0,
      totalMs: 0,
      avgMs: 0,
      totalBytes: 0,
      avgBytes: 0,
    };
    entry.count += 1;
    entry.totalMs += durationMs;
    entry.avgMs = entry.totalMs / entry.count;
    if (size > 0) {
      entry.totalBytes += size;
      entry.avgBytes = entry.totalBytes / entry.count;
    }
    stats[operationKey] = entry;
    saveStats(stats);
  }

  function start(itemId, operationKey, options = {}) {
    if (!itemId || !operationKey) return null;
    finish(itemId, false);
    const track = {
      itemId,
      operationKey,
      startedAt: performance.now(),
      size: Number(options.size) || 0,
    };
    ACTIVE.set(itemId, track);
    ITEM_TRACKS.set(itemId, itemId);
    return itemId;
  }

  function finish(itemId, success = true) {
    const track = ACTIVE.get(itemId);
    if (!track) return;
    const durationMs = performance.now() - track.startedAt;
    recordDuration(track.operationKey, durationMs, track.size, success);
    ACTIVE.delete(itemId);
    ITEM_TRACKS.delete(itemId);
  }

  function transfer(fromId, toId) {
    const track = ACTIVE.get(fromId);
    if (!track || !toId || fromId === toId) return false;
    ACTIVE.delete(fromId);
    ITEM_TRACKS.delete(fromId);
    track.itemId = toId;
    ACTIVE.set(toId, track);
    ITEM_TRACKS.set(toId, toId);
    return true;
  }

  function snapshotFromStartedAt(operationKey, startedAt, size = 0) {
    if (!operationKey || !startedAt) return null;
    const elapsedMs = performance.now() - startedAt;
    const estimatedMs = estimateMs(operationKey, size);
    const ratio = elapsedMs / estimatedMs;
    const percent = Math.min(95, Math.max(4, Math.round(ratio * 100)));
    const remainingMs = Math.max(0, Math.round(estimatedMs - elapsedMs));
    return {
      percent,
      elapsedMs: Math.round(elapsedMs),
      estimatedMs,
      remainingMs,
      operationKey,
    };
  }

  function getSnapshot(itemId) {
    const track = ACTIVE.get(itemId);
    if (!track) return null;
    const elapsedMs = performance.now() - track.startedAt;
    const estimatedMs = estimateMs(track.operationKey, track.size);
    const ratio = elapsedMs / estimatedMs;
    const percent = Math.min(95, Math.max(4, Math.round(ratio * 100)));
    const remainingMs = Math.max(0, Math.round(estimatedMs - elapsedMs));
    return {
      percent,
      elapsedMs: Math.round(elapsedMs),
      estimatedMs,
      remainingMs,
      operationKey: track.operationKey,
    };
  }

  function findSnapshotForFile(fileId, file = null) {
    if (!fileId) return null;
    const candidates = [fileId, `transfer:${fileId}`];
    for (const id of candidates) {
      const snap = getSnapshot(id);
      if (snap) return { id, ...snap };
    }
    if (file?.pendingStartedAt && file?.pendingOperationKey) {
      const snap = snapshotFromStartedAt(
        file.pendingOperationKey,
        file.pendingStartedAt,
        file.pendingSize || file.size || 0
      );
      if (snap) return { id: fileId, ...snap };
    }
    return null;
  }

  function hasActive() {
    return ACTIVE.size > 0;
  }

  function formatEta(ms) {
    if (!Number.isFinite(ms) || ms <= 0) return '';
    if (ms < 1000) return '<1s';
    const seconds = Math.ceil(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.ceil(seconds / 60);
    return `${minutes}m`;
  }

  return {
    key,
    crossKey,
    start,
    finish,
    transfer,
    getSnapshot,
    snapshotFromStartedAt,
    findSnapshotForFile,
    estimateMs,
    hasActive,
    formatEta,
  };
})();
