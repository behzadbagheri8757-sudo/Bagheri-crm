/* js/intelligence/watch_lifecycle.js — Watch Lifecycle + Reason/Note (V1)
   ============================================================
   Additive layer ON TOP of existing Watch generation.

   Does NOT modify:
     extractWatchObservations, extractSkuWatchObservations,
     thresholds, suppression, priority, action scoring,
     seller_feedback / recordFeedback, CRM writes.

   Responsibilities:
     - Persist Watch occurrences (IndexedDB bagheri_watch_db + localStorage)
     - Reconcile generation output → active / auto-resolved
     - Record seller Reason + optional Note (does NOT resolve)
     - Export/restore bundle for Backup

   Public API:
     reconcileWatchLifecycle([customerId]) -> Promise<Occurrence[]>
     getActiveWatchOccurrences([customerId]) -> Occurrence[]
     getWatchLifecycleSummary() -> { active, unreviewed }
     recordWatchReason(occurrenceId, reasonCode, comment) -> Occurrence|null
     exportWatchLifecycleBundle() -> Promise<object|null>
     restoreWatchLifecycleBundle(bundle) -> Promise<boolean>
     WATCH_REASON_OPTIONS
   ============================================================ */
'use strict';

(function (global) {

  var WATCH_DB_NAME = 'bagheri_watch_db';
  var WATCH_DB_VERSION = 1;
  var WATCH_STORE = 'watch_occurrences';
  var WATCH_LS_KEY = 'bagheri_watch_occurrences_v1';

  /** V1 reason codes — data capture only; never resolves or scores. */
  var WATCH_REASON_OPTIONS = [
    { code: 'still_stock', label: 'موجودی مشتری هنوز کافی است' },
    { code: 'price', label: 'قیمت' },
    { code: 'competitor', label: 'خرید از رقیب' },
    { code: 'no_need', label: 'فعلاً نیاز ندارد' },
    { code: 'quality', label: 'مشکل کیفیت' },
    { code: 'other', label: 'سایر' }
  ];

  var VALID_REASON_CODES = Object.create(null);
  for (var ri = 0; ri < WATCH_REASON_OPTIONS.length; ri++) {
    VALID_REASON_CODES[WATCH_REASON_OPTIONS[ri].code] = true;
  }

  // id -> occurrence (session source of truth after hydrate)
  var _mem = Object.create(null);
  var _idb = null;
  var _hydrated = false;

  function _nowISO() {
    return new Date().toISOString();
  }

  function _uid() {
    return 'wo_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 9);
  }

  function _normPid(productId) {
    if (productId == null || productId === '' || productId === 'multi') return null;
    return String(productId);
  }

  function _identityKey(customerId, watchCategory, productId) {
    var pid = _normPid(productId);
    return String(customerId) + '|' + String(watchCategory) + '|' + (pid || '');
  }

  function _loadLS() {
    try {
      if (typeof localStorage === 'undefined' || !localStorage) return;
      var raw = localStorage.getItem(WATCH_LS_KEY);
      if (!raw) return;
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return;
      var keys = Object.keys(parsed);
      for (var i = 0; i < keys.length; i++) {
        var row = parsed[keys[i]];
        if (row && row.id) _mem[row.id] = row;
      }
      _hydrated = true;
    } catch (e) { /* ignore corrupt */ }
  }

  function _saveLS() {
    try {
      if (typeof localStorage === 'undefined' || !localStorage) return;
      localStorage.setItem(WATCH_LS_KEY, JSON.stringify(_mem));
    } catch (e) { /* quota */ }
  }

  function _openIdb(cb) {
    if (typeof indexedDB === 'undefined' || !indexedDB) {
      if (cb) cb(null);
      return;
    }
    try {
      var req = indexedDB.open(WATCH_DB_NAME, WATCH_DB_VERSION);
      req.onupgradeneeded = function (ev) {
        var db = ev.target.result;
        if (!db.objectStoreNames.contains(WATCH_STORE)) {
          var store = db.createObjectStore(WATCH_STORE, { keyPath: 'id' });
          try {
            store.createIndex('by_customer', 'customerId', { unique: false });
            store.createIndex('by_status', 'status', { unique: false });
          } catch (idxErr) { /* ignore */ }
        }
      };
      req.onsuccess = function (ev) {
        _idb = ev.target.result;
        if (cb) cb(_idb);
      };
      req.onerror = function () { if (cb) cb(null); };
    } catch (e) {
      if (cb) cb(null);
    }
  }

  function _idbPut(rec) {
    if (!_idb || !rec) return;
    try {
      var tx = _idb.transaction(WATCH_STORE, 'readwrite');
      tx.objectStore(WATCH_STORE).put(rec);
    } catch (e) { /* ignore */ }
  }

  function _idbClearAndPutAll(rows, cb) {
    if (!_idb) {
      if (cb) cb(false);
      return;
    }
    try {
      var tx = _idb.transaction(WATCH_STORE, 'readwrite');
      var store = tx.objectStore(WATCH_STORE);
      store.clear();
      for (var i = 0; i < rows.length; i++) {
        if (rows[i] && rows[i].id) store.put(rows[i]);
      }
      tx.oncomplete = function () { if (cb) cb(true); };
      tx.onerror = function () { if (cb) cb(false); };
      tx.onabort = function () { if (cb) cb(false); };
    } catch (e) {
      if (cb) cb(false);
    }
  }

  function _idbHydrate(cb) {
    if (!_idb) {
      if (cb) cb();
      return;
    }
    try {
      var tx = _idb.transaction(WATCH_STORE, 'readonly');
      var req = tx.objectStore(WATCH_STORE).getAll();
      req.onsuccess = function () {
        var rows = req.result || [];
        for (var i = 0; i < rows.length; i++) {
          var row = rows[i];
          if (row && row.id) _mem[row.id] = row;
        }
        _hydrated = true;
        _saveLS();
        if (cb) cb();
      };
      req.onerror = function () { if (cb) cb(); };
    } catch (e) {
      if (cb) cb();
    }
  }

  function _persist(rec) {
    if (!rec || !rec.id) return;
    _mem[rec.id] = rec;
    _saveLS();
    _idbPut(rec);
  }

  _loadLS();
  _openIdb(function (db) {
    if (db) _idbHydrate(function () {});
  });

  function _allOccurrences() {
    var keys = Object.keys(_mem);
    var out = [];
    for (var i = 0; i < keys.length; i++) {
      if (_mem[keys[i]]) out.push(_mem[keys[i]]);
    }
    return out;
  }

  function _activeByIdentity(customerId) {
    var map = Object.create(null);
    var rows = _allOccurrences();
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (!r || r.status !== 'active') continue;
      if (customerId && String(r.customerId) !== String(customerId)) continue;
      var k = _identityKey(r.customerId, r.watchCategory, r.productId);
      // Prefer newest if duplicate active (should not happen; safety)
      if (!map[k] || String(r.lastEvaluatedAt || r.firstDetectedAt || '') > String(map[k].lastEvaluatedAt || map[k].firstDetectedAt || '')) {
        map[k] = r;
      }
    }
    return map;
  }

  function _mkOccurrence(watch, now) {
    return {
      id: _uid(),
      customerId: watch.customerId,
      productId: _normPid(watch.productId),
      watchCategory: watch.category,
      level: watch.level || 'low',
      generatedReason: watch.reason || '',
      status: 'active',
      firstDetectedAt: now,
      lastEvaluatedAt: now,
      snoozeUntil: null,
      reason: null,
      resolution: null
    };
  }

  /**
   * Reconcile Watch generation output with stored occurrences.
   * - Existing active match → refresh level/reason/lastEvaluatedAt
   * - New watch → new occurrence
   * - Active without current watch → auto-resolve (condition cleared)
   * Never re-activates a resolved occurrence; new condition = new id.
   */
  // W-BUG-02 fix: an inactive customer must (a) never have a *new* Watch
  // generated for them, and (b) have any pre-existing active Watch
  // auto-resolved. To satisfy both with the existing auto-resolve
  // mechanism below, inactive customers are still included in the
  // reconcile pass (so any stale actives get cleaned up), but their
  // `watches` are forced empty instead of calling extractWatchObservations
  // — the auto-resolve loop then naturally clears anything of theirs that
  // was active, since it will not appear in `seenKeys`.
  function _isCustomerActive(cid) {
    if (typeof data === 'undefined' || !Array.isArray(data.customers)) return true;
    var c = data.customers.find(function (x) { return x && x.id === cid; });
    if (!c) return false; // unknown/removed customer: treat as inactive (generate nothing, allow cleanup)
    return c.active !== false;
  }

  function reconcileWatchLifecycle(customerId) {
    return new Promise(function (resolve) {
      function run() {
        var customerIds = [];
        if (customerId) {
          customerIds = [customerId];
        } else if (typeof data !== 'undefined' && Array.isArray(data.customers)) {
          for (var i = 0; i < data.customers.length; i++) {
            var c = data.customers[i];
            // Include inactive customers too (see _isCustomerActive note
            // above) so their stale active Watches still get auto-resolved.
            if (c && c.id) customerIds.push(c.id);
          }
        }

        var now = _nowISO();
        var touched = [];

        for (var ci = 0; ci < customerIds.length; ci++) {
          var cid = customerIds[ci];
          var watches = [];
          if (_isCustomerActive(cid) && typeof extractWatchObservations === 'function') {
            try {
              watches = extractWatchObservations(cid) || [];
            } catch (eW) {
              watches = [];
            }
          }

          var activeMap = _activeByIdentity(cid);
          var seenKeys = Object.create(null);

          for (var wi = 0; wi < watches.length; wi++) {
            var w = watches[wi];
            if (!w || !w.category) continue;
            var key = _identityKey(cid, w.category, w.productId);
            seenKeys[key] = true;
            var existing = activeMap[key];
            if (existing) {
              existing.level = w.level || existing.level;
              existing.generatedReason = w.reason || existing.generatedReason;
              existing.lastEvaluatedAt = now;
              if (w.productName != null) existing.productName = w.productName;
              _persist(existing);
              touched.push(existing);
            } else {
              var created = _mkOccurrence(w, now);
              if (w.productName != null) created.productName = w.productName;
              _persist(created);
              touched.push(created);
            }
          }

          // Auto-resolve actives whose condition is gone
          var actKeys = Object.keys(activeMap);
          for (var ai = 0; ai < actKeys.length; ai++) {
            var ak = actKeys[ai];
            if (seenKeys[ak]) continue;
            var stale = activeMap[ak];
            if (!stale || stale.status !== 'active') continue;
            stale.status = 'resolved';
            stale.lastEvaluatedAt = now;
            stale.resolution = {
              type: 'auto',
              resolvedAt: now,
              note: null
            };
            // Keep reason + note history intact
            _persist(stale);
          }
        }

        resolve(touched);
      }

      // Ensure hydrate has at least tried; memory already has LS data.
      if (_hydrated || !_idb) {
        run();
      } else {
        _idbHydrate(function () { run(); });
      }
    });
  }

  function getActiveWatchOccurrences(customerId) {
    var rows = _allOccurrences();
    var out = [];
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (!r || r.status !== 'active') continue;
      if (customerId && String(r.customerId) !== String(customerId)) continue;
      out.push(r);
    }
    // Sort: unreviewed first, then level desc
    var levelRank = { high: 3, medium: 2, low: 1 };
    out.sort(function (a, b) {
      var ar = a.reason ? 1 : 0;
      var br = b.reason ? 1 : 0;
      if (ar !== br) return ar - br;
      var la = levelRank[a.level] || 0;
      var lb = levelRank[b.level] || 0;
      if (lb !== la) return lb - la;
      return String(b.lastEvaluatedAt || '').localeCompare(String(a.lastEvaluatedAt || ''));
    });
    return out;
  }

  function getWatchLifecycleSummary() {
    var rows = getActiveWatchOccurrences();
    var unreviewed = 0;
    for (var i = 0; i < rows.length; i++) {
      if (!rows[i].reason) unreviewed++;
    }
    return { active: rows.length, unreviewed: unreviewed };
  }

  /**
   * Record seller reason + optional note. Does NOT resolve the Watch.
   * Status stays 'active'; badge becomes «بررسی شده».
   */
  function recordWatchReason(occurrenceId, reasonCode, comment) {
    if (!occurrenceId) return null;
    var rec = _mem[occurrenceId];
    if (!rec) return null;
    if (rec.status !== 'active') return null;
    var code = reasonCode ? String(reasonCode) : null;
    if (code && !VALID_REASON_CODES[code]) {
      // Allow unknown codes only as 'other' for safety
      code = 'other';
    }
    rec.reason = {
      code: code,
      comment: comment ? String(comment).slice(0, 500) : '',
      recordedAt: _nowISO()
    };
    _persist(rec);
    return rec;
  }

  // W-BUG-03 fix: a real manual Dismiss action. 'dismissed' was already a
  // recognized status in the schema/validators (backup.js, restore below)
  // but nothing ever set it — a seller had no way to close a Watch they
  // had reviewed and judged irrelevant, short of it auto-resolving on its
  // own (which some categories, e.g. LINE_DROP_WATCH on a discontinued
  // line, never do). This does not touch recordWatchReason — a reason can
  // still be recorded before/independently of a dismiss — and uses a
  // distinct resolution.type ('manual_dismiss') so it is never confused
  // with the automatic reconcile resolution ('auto') above.
  function dismissWatchOccurrence(occurrenceId, note) {
    if (!occurrenceId) return null;
    var rec = _mem[occurrenceId];
    if (!rec) return null;
    if (rec.status !== 'active') return null;
    var now = _nowISO();
    rec.status = 'dismissed';
    rec.lastEvaluatedAt = now;
    rec.resolution = {
      type: 'manual_dismiss',
      resolvedAt: now,
      note: note ? String(note).slice(0, 500) : null
    };
    // Reason/comment history (if any was recorded earlier) is untouched.
    _persist(rec);
    return rec;
  }

  function exportWatchLifecycleBundle() {
    return new Promise(function (resolve) {
      function pack() {
        var occurrences = _allOccurrences();
        resolve({
          version: 1,
          dbVersion: WATCH_DB_VERSION,
          occurrences: occurrences
        });
      }
      if (_hydrated || !_idb) pack();
      else _idbHydrate(function () { pack(); });
    });
  }

  function restoreWatchLifecycleBundle(bundle) {
    return new Promise(function (resolve) {
      if (!bundle || typeof bundle !== 'object') {
        resolve(false);
        return;
      }
      var rows = Array.isArray(bundle.occurrences) ? bundle.occurrences : [];
      // Soft validation: keep well-formed rows only
      var cleaned = [];
      for (var i = 0; i < rows.length; i++) {
        var r = rows[i];
        if (!r || r.id == null || r.customerId == null || !r.watchCategory) continue;
        if (r.status !== 'active' && r.status !== 'resolved' && r.status !== 'dismissed') {
          r.status = 'resolved';
        }
        cleaned.push(r);
      }
      _mem = Object.create(null);
      for (var j = 0; j < cleaned.length; j++) {
        _mem[cleaned[j].id] = cleaned[j];
      }
      _saveLS();
      if (!_idb) {
        resolve(true);
        return;
      }
      _idbClearAndPutAll(cleaned, function (ok) {
        resolve(!!ok || cleaned.length === 0);
      });
    });
  }

  function clearWatchLifecycle() {
    _mem = Object.create(null);
    try {
      if (typeof localStorage !== 'undefined' && localStorage) {
        localStorage.removeItem(WATCH_LS_KEY);
      }
    } catch (e) { /* ignore */ }
    if (_idb) {
      try {
        var tx = _idb.transaction(WATCH_STORE, 'readwrite');
        tx.objectStore(WATCH_STORE).clear();
      } catch (e2) { /* ignore */ }
    }
  }

  /** Label helper for UI */
  function watchReasonLabel(code) {
    for (var i = 0; i < WATCH_REASON_OPTIONS.length; i++) {
      if (WATCH_REASON_OPTIONS[i].code === code) return WATCH_REASON_OPTIONS[i].label;
    }
    return code || '—';
  }

  global.WATCH_REASON_OPTIONS = WATCH_REASON_OPTIONS;
  global.reconcileWatchLifecycle = reconcileWatchLifecycle;
  global.getActiveWatchOccurrences = getActiveWatchOccurrences;
  global.getWatchLifecycleSummary = getWatchLifecycleSummary;
  global.recordWatchReason = recordWatchReason;
  global.dismissWatchOccurrence = dismissWatchOccurrence;
  global.exportWatchLifecycleBundle = exportWatchLifecycleBundle;
  global.restoreWatchLifecycleBundle = restoreWatchLifecycleBundle;
  global.clearWatchLifecycle = clearWatchLifecycle;
  global.watchReasonLabel = watchReasonLabel;
  global.WATCH_LIFECYCLE_PARAMS = {
    dbName: WATCH_DB_NAME,
    dbVersion: WATCH_DB_VERSION,
    store: WATCH_STORE,
    lsKey: WATCH_LS_KEY
  };

})(typeof window !== 'undefined' ? window : this);
