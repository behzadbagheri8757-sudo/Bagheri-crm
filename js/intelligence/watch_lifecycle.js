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
     dismissWatchOccurrence(occurrenceId, note) -> Occurrence|null
     filterSuppressedWatchObservations(customerId, watches, ctx) -> watches
     reverseWatchDecision(occurrenceId) -> Occurrence|null
     getWatchResponseOptions(occurrenceId) -> option[]
     exportWatchLifecycleBundle() -> Promise<object|null>
     restoreWatchLifecycleBundle(bundle) -> Promise<boolean>
     getPendingWatchFollowUps([customerId]) -> Occurrence[]
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
    // Decision codes (kind:'decision') CLOSE the current occurrence and leave a
    // suppression marker on it (see "Seller decisions" below). productOnly =
    // only meaningful for a Watch that has a product subject.
    { code: 'still_stock', label: 'هنوز موجودی دارد', kind: 'decision' },
    { code: 'not_wanted', label: 'این محصول را نمی‌خواهد', kind: 'decision', productOnly: true },
    { code: 'follow_up_later', label: 'بعداً پیگیری می‌کنم', kind: 'decision' },
    { code: 'price', label: 'قیمت' },
    { code: 'competitor', label: 'خرید از رقیب' },
    { code: 'no_need', label: 'فعلاً نیاز ندارد' },
    { code: 'quality', label: 'مشکل کیفیت' },
    { code: 'other', label: 'سایر' }
  ];

  var VALID_REASON_CODES = Object.create(null);
  // Internal completion state for an explicitly reviewed follow-up. This is
  // deliberately distinct from 'other' and from 'not_wanted'. It means the
  // seller has reviewed the pending question and does not want to pursue it
  // now; it does not suppress future cycles forever.
  VALID_REASON_CODES.dismiss = true;
  for (var ri = 0; ri < WATCH_REASON_OPTIONS.length; ri++) {
    VALID_REASON_CODES[WATCH_REASON_OPTIONS[ri].code] = true;
  }

  // id -> occurrence (session source of truth after hydrate)
  var _mem = Object.create(null);
  var _idb = null;
  // FIX (LS/IDB Arbitration): recordWatchReason/dismissWatchOccurrence write
  // straight to _mem (see _persist) without waiting for the async IDB
  // hydrate to finish — _loadLS() already sets _hydrated=true synchronously
  // whenever localStorage had prior data, so callers can mutate before
  // _idbHydrate's getAll() resolves. That resolution used to overwrite _mem
  // unconditionally from the (now stale) IDB snapshot, silently reverting a
  // reason/dismissal the seller had just recorded. _dirtyIds tracks every id
  // written via _persist() since load so hydrate never clobbers it.
  var _dirtyIds = Object.create(null);
  var _hydrated = false;
  var _hydratePromise = null;
  var _deferSave = false; // true while reconcileWatchLifecycle batches multiple _persist calls
  var _idbBatchTx = null; // one IDB transaction for a reconcile batch

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

  // Watch identity is Family-aware and resolved at RUNTIME:
  //   watch.productId -> current product -> analysisGroupId -> familyId
  // (familyId = analysisGroupId || productId). Nothing about familyId is
  // stored on the occurrence record; productId/productName remain on the
  // record as "last SKU seen". For products without an analysisGroupId
  // familyId === productId, so identity is unchanged for them.
  function _familyOfPid(pid, ctx) {
    if (pid == null) return null;
    if (typeof resolveFamilyId === 'function') {
      try {
        var f = resolveFamilyId(pid, ctx);
        if (f != null && f !== '') return String(f);
      } catch (e) { /* fall back to productId */ }
    }
    return pid;
  }

  // SKU/family Watches are one subject per customer + product family. The
  // generator may move that subject between these categories as evidence
  // changes (e.g. SKU_DELAY -> COMBINED_SKU); identity must not depend on it.
  var _SKU_IDENTITY_CATS = {
    SKU_DELAY_WATCH: 1, SKU_QUANTITY_DROP_WATCH: 1, SKU_FREQUENCY_DROP_WATCH: 1,
    LINE_DROP_WATCH: 1, COMBINED_SKU_WATCH: 1
  };

  function _identityKey(customerId, watchCategory, productId, ctx) {
    var pid = _familyOfPid(_normPid(productId), ctx);
    var cat = (pid && _SKU_IDENTITY_CATS[String(watchCategory)]) ? 'SKU' : String(watchCategory);
    return String(customerId) + '|' + cat + '|' + (pid || '');
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
    } catch (e) {
      console.error('Watch lifecycle localStorage save failed', e);
    }
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
      var tx = _idbBatchTx || _idb.transaction(WATCH_STORE, 'readwrite');
      var req = tx.objectStore(WATCH_STORE).put(rec);
      req.onerror = function () { console.error('Watch lifecycle IDB put failed', req.error); };
      if (!_idbBatchTx) {
        tx.onerror = function () { console.error('Watch lifecycle IDB transaction failed', tx.error); };
        tx.onabort = function () { console.error('Watch lifecycle IDB transaction aborted', tx.error); };
      }
    } catch (e) {
      console.error('Watch lifecycle IDB put threw', e);
    }
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
      return Promise.resolve();
    }
    if (_hydratePromise) {
      return _hydratePromise.then(function () { if (cb) cb(); });
    }
    _hydratePromise = new Promise(function (resolve) {
      try {
        var tx = _idb.transaction(WATCH_STORE, 'readonly');
        var req = tx.objectStore(WATCH_STORE).getAll();
        req.onsuccess = function () {
          var rows = req.result || [];
          for (var i = 0; i < rows.length; i++) {
            var row = rows[i];
            if (row && row.id && !_dirtyIds[row.id]) _mem[row.id] = row;
          }
          _hydrated = true;
          _saveLS();
          resolve();
          if (cb) cb();
        };
        req.onerror = function () {
          console.error('Watch lifecycle IDB hydrate failed', req.error);
          resolve();
          if (cb) cb();
        };
      } catch (e) {
        console.error('Watch lifecycle IDB hydrate threw', e);
        resolve();
        if (cb) cb();
      }
    });
    return _hydratePromise;
  }

  function _ensureHydrated() {
    if (_hydrated || !_idb) return Promise.resolve();
    return _idbHydrate();
  }

  function _persist(rec) {
    if (!rec || !rec.id) return;
    _mem[rec.id] = rec;
    _dirtyIds[rec.id] = true;
    _idbPut(rec);
    if (!_deferSave) _saveLS();
  }

  // Historical retention (maintenance-only; runs once at bootstrap below,
  // never from reconcileWatchLifecycle/getActiveWatchOccurrences or any
  // other render/reconcile path). A resolved/dismissed occurrence has
  // operational value as a review trail for a while, but not forever —
  // active occurrences are never in scope (see the r.status === 'active'
  // guard in _isRetentionExpired, mirroring the same 'active'-only
  // handling _activeByIdentity/reconcileWatchLifecycle already use
  // elsewhere in this file). 90 days is chosen to stay clearly outside any
  // possible interaction with the Intelligence signal window (see
  // PERSISTENCE_PARAMS.windowDays = 60 days in
  // js/intelligence/persistence.js) plus a seller-review buffer, while
  // still bounding unlimited growth of resolved/dismissed history.
  var WATCH_HISTORY_RETENTION_DAYS = 90;

  function _isRetentionExpired(rec, cutoffMs) {
    if (!rec || rec.status === 'active') return false;
    // An UNRELEASED seller-decision marker is live state, not history: expiring
    // it would silently re-open a suppressed Watch after an arbitrary delay.
    if (rec.suppression && !rec.suppression.releasedAt) return false;
    var resolvedAt = rec.resolution && rec.resolution.resolvedAt;
    if (!resolvedAt) return false; // no resolution timestamp — do not guess, keep it
    var t = Date.parse(resolvedAt);
    if (!isFinite(t)) return false; // unparsable — keep it, do not guess
    return t < cutoffMs;
  }

  function _migrateLegacyDismissedRows() {
    var changed = false;
    var ids = Object.keys(_mem);
    var decisionTypes = { still_stock: true, not_wanted: true, follow_up_later: true };
    for (var i = 0; i < ids.length; i++) {
      var r = _mem[ids[i]];
      if (!r || r.status !== 'dismissed' || r.suppression) continue;
      var rt = r.resolution && r.resolution.type ? String(r.resolution.type) : '';
      var rc = r.reason && r.reason.code ? String(r.reason.code) : '';
      var inferred = decisionTypes[rc] ? rc : (rt === 'manual_dismiss' ? 'dismiss' : null);
      if (!inferred) continue;
      var decidedAt = (r.resolution && r.resolution.resolvedAt) || (r.reason && r.reason.recordedAt) || r.lastEvaluatedAt || r.firstDetectedAt || _nowISO();
      r.suppression = { type: inferred, decidedAt: decidedAt, atInvoiceSeq: null, atDate: String(decidedAt).slice(0, 10), levelAtDecision: r.level || null, releasedAt: null, releasedBy: null, migratedFrom: 'watch_lifecycle_v1' };
      _mem[r.id] = r;
      _dirtyIds[r.id] = true;
      _idbPut(r);
      changed = true;
    }
    if (changed) _saveLS();
    return changed;
  }

  function _sweepExpiredHistory() {
    var cutoffMs = Date.now() - (WATCH_HISTORY_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    var ids = Object.keys(_mem);
    var removedIds = [];
    for (var i = 0; i < ids.length; i++) {
      var id = ids[i];
      if (_isRetentionExpired(_mem[id], cutoffMs)) {
        delete _mem[id];
        delete _dirtyIds[id];
        removedIds.push(id);
      }
    }
    if (removedIds.length) {
      _saveLS();
      if (_idb) {
        try {
          var tx = _idb.transaction(WATCH_STORE, 'readwrite');
          var store = tx.objectStore(WATCH_STORE);
          for (var j = 0; j < removedIds.length; j++) store.delete(removedIds[j]);
          tx.onerror = function () { console.error('Watch lifecycle history GC IDB delete failed', tx.error); };
        } catch (e) {
          console.error('Watch lifecycle history GC IDB delete threw', e);
        }
      }
    }
    return removedIds.length;
  }

  _loadLS();
  _openIdb(function (db) {
    if (db) _idbHydrate(function () { _migrateLegacyDismissedRows(); _sweepExpiredHistory(); });
    else { _migrateLegacyDismissedRows(); _sweepExpiredHistory(); }
  });

  function _allOccurrences() {
    var keys = Object.keys(_mem);
    var out = [];
    for (var i = 0; i < keys.length; i++) {
      if (_mem[keys[i]]) out.push(_mem[keys[i]]);
    }
    return out;
  }

  // ------------------------------------------------------------------
  // Seller decisions (suppression markers)
  // A decision closes the occurrence it was made on and stores
  //   rec.suppression = { type, decidedAt, atInvoiceSeq, atDate,
  //                       levelAtDecision, releasedAt, releasedBy }
  // ON THAT SAME RECORD (no new store, no schema change). While unreleased
  // it blocks re-creation of the same Watch subject:
  //   dismiss / still_stock / follow_up_later -> exact identity key
  //     (customer|category|family)
  //   not_wanted -> customer + product family, any product-scoped category
  // Nothing here is time-based.
  // ------------------------------------------------------------------
  var LEVEL_RANK = { low: 1, medium: 2, high: 3 };

  function _subjectKey(customerId, productId, ctx) {
    var pid = _familyOfPid(_normPid(productId), ctx);
    return pid ? (String(customerId) + '|' + pid) : null;
  }

  function _newTombs() {
    return { byKey: Object.create(null), byFamily: Object.create(null), extra: [] };
  }

  function _releaseSuppression(rec, by) {
    if (!rec || !rec.suppression || rec.suppression.releasedAt) return;
    rec.suppression.releasedAt = _nowISO();
    rec.suppression.releasedBy = by;
    _persist(rec);
  }

  // mutate=false -> read-only (render-time filtering never writes).
  function _addTomb(tombs, r, ctx, mutate) {
    var s = r.suppression;
    if (!s || s.releasedAt || r.status === 'active') return;
    var isNW = s.type === 'not_wanted';
    var kk = isNW ? _subjectKey(r.customerId, r.productId, ctx)
                  : _identityKey(r.customerId, r.watchCategory, r.productId, ctx);
    if (!kk) return;
    var slot = isNW ? tombs.byFamily : tombs.byKey;
    var cur = slot[kk];
    if (!cur) { slot[kk] = r; return; }
    var rTs = String(s.decidedAt || '');
    var cTs = String(cur.suppression.decidedAt || '');
    var loser = rTs > cTs ? cur : r;
    if (rTs > cTs) slot[kk] = r;
    // A pending follow_up_later is never discarded by a collision (old rows
    // with different categories now share one SKU identity); keep it held.
    if (loser.suppression && loser.suppression.type === 'follow_up_later') {
      tombs.extra.push(loser);
      return;
    }
    if (mutate) _releaseSuppression(loser, 'superseded_duplicate');
  }

  function _tombList(tombs) {
    var out = [];
    var k1 = Object.keys(tombs.byKey);
    for (var i = 0; i < k1.length; i++) out.push(tombs.byKey[k1[i]]);
    var k2 = Object.keys(tombs.byFamily);
    for (var j = 0; j < k2.length; j++) out.push(tombs.byFamily[k2[j]]);
    for (var e = 0; e < tombs.extra.length; e++) out.push(tombs.extra[e]);
    return out;
  }

  function _findTombs(tombs, customerId, category, productId, ctx) {
    var out = [];
    var idKey = _identityKey(customerId, category, productId, ctx);
    var t1 = tombs.byKey[idKey];
    if (t1) out.push(t1);
    for (var xe = 0; xe < tombs.extra.length; xe++) {
      var xt = tombs.extra[xe];
      if (_identityKey(xt.customerId, xt.watchCategory, xt.productId, ctx) === idKey) out.push(xt);
    }
    var sk = _subjectKey(customerId, productId, ctx);
    if (sk && tombs.byFamily[sk]) out.push(tombs.byFamily[sk]);
    return out;
  }

  // Seller decisions are not released by purchase alone. A purchase may be
  // small, unrelated to the observed dimension, or simply replenish stock.
  // Only a real disappearance of the raw Watch condition ends the current
  // cycle (handled explicitly by reconcileWatchLifecycle). A manual dismiss is
  // the one decision for which a genuine severity escalation may reopen the
  // current subject: the seller dismissed the present case, not all future
  // important warnings. still_stock/follow_up_later/not_wanted remain held.
  function _releaseReasonFor(tomb, watch, ctx) {
    var s = tomb && tomb.suppression;
    if (!s || s.releasedAt) return null;
    if (s.type === 'dismiss') {
      var was = LEVEL_RANK[s.levelAtDecision] || 0;
      var now = LEVEL_RANK[watch && watch.level] || 0;
      if (was > 0 && now > was) return 'escalated';
    }
    return null;
  }

  function _activeByIdentity(customerId, ctx, tombOut) {
    var map = Object.create(null);
    var rows = _allOccurrences();
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (!r) continue;
      if (r.status !== 'active') {
        if (tombOut && r.suppression && (!customerId || String(r.customerId) === String(customerId))) {
          _addTomb(tombOut, r, ctx, true);
        }
        continue;
      }
      if (customerId && String(r.customerId) !== String(customerId)) continue;
      var k = _identityKey(r.customerId, r.watchCategory, r.productId, ctx);
      var current = map[k];
      var rTs = String(r.lastEvaluatedAt || r.firstDetectedAt || '');
      var cTs = current ? String(current.lastEvaluatedAt || current.firstDetectedAt || '') : '';
      if (!current) {
        map[k] = r;
      } else if (rTs > cTs) {
        current.status = 'resolved';
        current.resolution = { type: 'duplicate_cleanup', resolvedAt: _nowISO(), note: null };
        _persist(current);
        map[k] = r;
      } else {
        r.status = 'resolved';
        r.resolution = { type: 'duplicate_cleanup', resolvedAt: _nowISO(), note: null };
        _persist(r);
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
      resolution: null,
      evidence: watch.evidence ? watch.evidence : null,
      source: watch.source || null,
      watchComponents: watch.watchComponents || null
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
  function _isCustomerActive(cid, ctx) {
    if (ctx && typeof ctx.customerById === 'function') {
      var c = ctx.customerById(cid);
      if (!c) return false;
      return c.active !== false;
    }
    if (typeof data === 'undefined' || !Array.isArray(data.customers)) return true;
    var c2 = data.customers.find(function (x) { return x && x.id === cid; });
    if (!c2) return false;
    return c2.active !== false;
  }

  function _findLatestAlertSuperseded(key, ctx) {
    var rows = _allOccurrences();
    var best = null;
    var bestTs = '';
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (!r || r.status === 'active') continue;
      if (!r.resolution || r.resolution.type !== 'alert_superseded') continue;
      var k = _identityKey(r.customerId, r.watchCategory, r.productId, ctx);
      if (k !== key) continue;
      var ts = String(r.lastEvaluatedAt || r.firstDetectedAt || '');
      if (!best || ts > bestTs) { best = r; bestTs = ts; }
    }
    return best;
  }

  function _markAlertSuperseded(rec, now) {
    if (!rec || rec.status !== 'active') return false;
    rec.status = 'resolved';
    rec.lastEvaluatedAt = now;
    rec.resolution = { type: 'alert_superseded', resolvedAt: now, note: null };
    _persist(rec);
    return true;
  }

  function reconcileWatchLifecycle(customerId, ctx) {
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

        // When reconciling all customers, include customerIds found in existing
        // occurrences so orphaned active occurrences also use the normal path.
        if (!customerId) {
          var occurrences = _allOccurrences();
          for (var oi = 0; oi < occurrences.length; oi++) {
            var occurrence = occurrences[oi];
            if (!occurrence || !occurrence.customerId) continue;
            var occurrenceCid = String(occurrence.customerId);
            var alreadyIncluded = false;
            for (var cji = 0; cji < customerIds.length; cji++) {
              if (String(customerIds[cji]) === occurrenceCid) {
                alreadyIncluded = true;
                break;
              }
            }
            if (!alreadyIncluded) customerIds.push(occurrence.customerId);
          }
        }

        var now = _nowISO();
        var touched = [];
        var persistCount = 0;

        _deferSave = true;
        _idbBatchTx = _idb ? _idb.transaction(WATCH_STORE, 'readwrite') : null;
        if (_idbBatchTx) {
          var batchTx = _idbBatchTx;
          batchTx.onerror = function () { console.error('Watch lifecycle reconcile transaction failed', batchTx.error); };
          batchTx.onabort = function () { console.error('Watch lifecycle reconcile transaction aborted', batchTx.error); };
        }
        try {
          for (var ci = 0; ci < customerIds.length; ci++) {
            var cid = customerIds[ci];
            var custActive = _isCustomerActive(cid, ctx);

            var tombs = _newTombs();
            var activeMap = _activeByIdentity(cid, ctx, tombs);
            var rawWatches = [];
            var visibleWatches = [];
            var extractOk = false;
            var confirmedOk = false;

            if (custActive && typeof extractWatchObservations === 'function') {
              try {
                // First get the raw Watch generation with no confirmed override.
                // This is intentionally the same generator/rules; passing [] only
                // exposes whether a Watch was generated before Alert supersession.
                rawWatches = extractWatchObservations(cid, [], ctx) || [];
                extractOk = true;
              } catch (eRawW) { rawWatches = []; }

              if (extractOk) {
                try {
                  var confirmedForLifecycle = [];
                  if (typeof extractCustomerSignals === 'function') {
                    confirmedForLifecycle = extractCustomerSignals(cid, ctx) || [];
                    confirmedOk = true;
                  }
                  // If confirmed-signal extraction is unavailable/fails, fail open:
                  // do not claim an Alert conversion we cannot prove.
                  visibleWatches = confirmedOk
                    ? (extractWatchObservations(cid, confirmedForLifecycle, ctx) || [])
                    : rawWatches.slice();
                } catch (eVisibleW) {
                  visibleWatches = rawWatches.slice();
                  confirmedOk = false;
                }
              }
            }

            var rawByKey = Object.create(null);
            var visibleByKey = Object.create(null);
            for (var rwi = 0; rwi < rawWatches.length; rwi++) {
              var rw = rawWatches[rwi];
              if (rw && rw.category) rawByKey[_identityKey(cid, rw.category, rw.productId, ctx)] = rw;
            }
            for (var vwi = 0; vwi < visibleWatches.length; vwi++) {
              var vw = visibleWatches[vwi];
              if (vw && vw.category) visibleByKey[_identityKey(cid, vw.category, vw.productId, ctx)] = vw;
            }

            var seenRawKeys = Object.create(null);
            var seenVisibleKeys = Object.create(null);
            var visibleKeys = Object.keys(visibleByKey);

            // Update/create visible Watches. A previously Alert-superseded cycle
            // is reactivated if the same raw Watch remains after the Alert filter
            // disappears; that is continuation of the same issue, not a new cycle.
            for (var vki = 0; vki < visibleKeys.length; vki++) {
              var vk = visibleKeys[vki];
              var w = visibleByKey[vk];
              seenVisibleKeys[vk] = true;
              seenRawKeys[vk] = true;
              var existing = activeMap[vk];
              if (!existing) {
                var alertAnchor = _findLatestAlertSuperseded(vk, ctx);
                if (alertAnchor) {
                  alertAnchor.status = 'active';
                  if (w.category) alertAnchor.watchCategory = w.category;
                  alertAnchor.level = w.level || alertAnchor.level;
                  alertAnchor.generatedReason = w.reason || alertAnchor.generatedReason;
                  alertAnchor.lastEvaluatedAt = now;
                  alertAnchor.resolution = null;
                  alertAnchor.evidence = w.evidence ? w.evidence : (alertAnchor.evidence || null);
                  alertAnchor.source = w.source || alertAnchor.source || null;
                  alertAnchor.watchComponents = w.watchComponents || alertAnchor.watchComponents || null;
                  var anchorPid = _normPid(w.productId);
                  if (anchorPid != null) alertAnchor.productId = anchorPid;
                  if (w.productName != null) alertAnchor.productName = w.productName;
                  _persist(alertAnchor);
                  persistCount++;
                  activeMap[vk] = alertAnchor;
                  existing = alertAnchor;
                }
              }
              if (!existing) {
                // A live seller decision blocks a new cycle. Escalation can release
                // only an ordinary manual dismiss (see _releaseReasonFor).
                var held = false;
                var ts = _findTombs(tombs, cid, w.category, w.productId, ctx);
                for (var ti = 0; ti < ts.length; ti++) {
                  var rel = _releaseReasonFor(ts[ti], w, ctx);
                  if (rel) {
                    _releaseSuppression(ts[ti], rel);
                    persistCount++;
                    // Genuine escalation reopens the SAME occurrence; it is not
                    // a new Watch cycle and must not create a duplicate ID.
                    if (!existing && ts[ti].status !== 'active' && ts[ti].suppression.releasedAt) {
                      existing = ts[ti];
                      existing.status = 'active';
                      existing.resolution = null;
                    }
                  } else held = true;
                }
                if (held && !existing) continue;
              }
              if (existing) {
                if (w.category) existing.watchCategory = w.category;
                existing.level = w.level || existing.level;
                existing.generatedReason = w.reason || existing.generatedReason;
                existing.lastEvaluatedAt = now;
                existing.evidence = w.evidence ? w.evidence : (existing.evidence || null);
                existing.source = w.source || existing.source || null;
                existing.watchComponents = w.watchComponents || existing.watchComponents || null;
                var lastPid = _normPid(w.productId);
                if (lastPid != null) existing.productId = lastPid;
                if (w.productName != null) existing.productName = w.productName;
                _persist(existing);
                persistCount++;
                touched.push(existing);
              } else {
                var created = _mkOccurrence(w, now);
                if (w.productName != null) created.productName = w.productName;
                _persist(created);
                persistCount++;
                touched.push(created);
              }
            }

            // Raw Watch exists but is filtered because an active Confirmed Signal
            // supersedes it. This is a conversion to Alert, NOT condition_cleared.
            // Do not create a new cycle while the raw Watch condition remains.
            if (custActive && extractOk && confirmedOk) {
              var rawKeys = Object.keys(rawByKey);
              for (var rki = 0; rki < rawKeys.length; rki++) {
                var rk = rawKeys[rki];
                seenRawKeys[rk] = true;
                if (visibleByKey[rk]) continue;
                var alertActive = activeMap[rk];
                if (alertActive && alertActive.status === 'active') {
                  if (_markAlertSuperseded(alertActive, now)) persistCount++;
                }
              }
            }

            // A true condition clear is provable only when the RAW Watch generator
            // successfully ran and the raw Watch is absent. A Watch missing only
            // because an Alert filter hid it is therefore never auto-resolved here.
            if (custActive && extractOk) {
              var tl = _tombList(tombs);
              for (var tk = 0; tk < tl.length; tk++) {
                var tr = tl[tk];
                if (!tr.suppression || tr.suppression.releasedAt || tr.suppression.type === 'not_wanted' || tr.suppression.type === 'follow_up_later') continue;
                var tombKey = _identityKey(tr.customerId, tr.watchCategory, tr.productId, ctx);
                if (seenRawKeys[tombKey]) continue;
                _releaseSuppression(tr, 'condition_cleared');
                persistCount++;
              }
            }

            // Auto-resolve active occurrences only when the raw generator has
            // successfully established that the condition is genuinely absent.
            // Inactive/deleted customers generate no Watches, so their active
            // occurrences are closed here (v71 behavior, resolution 'auto').
            if (!custActive || extractOk) {
              var actKeys = Object.keys(activeMap);
              for (var ai = 0; ai < actKeys.length; ai++) {
                var ak = actKeys[ai];
                if (seenRawKeys[ak]) continue;
                var stale = activeMap[ak];
                if (!stale || stale.status !== 'active') continue;
                stale.status = 'resolved';
                stale.lastEvaluatedAt = now;
                stale.resolution = {
                  type: custActive ? 'condition_cleared' : 'auto',
                  resolvedAt: now,
                  note: null
                };
                _persist(stale);
                persistCount++;
              }
            }
          }
        } finally {
          _idbBatchTx = null;
          // Always clear the defer flag, even if something above threw,
          // so a stray exception can never permanently disable localStorage
          // saves for recordWatchReason/dismissWatchOccurrence.
          _deferSave = false;
        }
        // Batched write: one localStorage serialize instead of one per
        // touched/resolved occurrence (IndexedDB puts still happen per-record
        // above via _persist -> _idbPut, unchanged).
        if (persistCount > 0) _saveLS();

        resolve(touched);
      }

      _ensureHydrated().then(run);
    });
  }

  function getActiveWatchOccurrences(customerId) {
    var rows = _allOccurrences();
    var out = [];
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (!r || r.status !== 'active') continue;
      if (customerId && String(r.customerId) !== String(customerId)) continue;
      if (!_isCustomerActive(r.customerId)) continue;
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

  function getPendingWatchFollowUps(customerId) {
    var rows = _allOccurrences();
    var out = [];
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (!r || r.status === 'active' || !r.suppression || r.suppression.releasedAt) continue;
      if (r.suppression.type !== 'follow_up_later') continue;
      if (customerId && String(r.customerId) !== String(customerId)) continue;
      out.push(r);
    }
    out.sort(function (a, b) {
      return String(b.suppression.decidedAt || b.lastEvaluatedAt || '').localeCompare(String(a.suppression.decidedAt || a.lastEvaluatedAt || ''));
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
  function _decisionSnapshot(rec, type) {
    var seq = (typeof data !== 'undefined' && data) ? Number(data.invoiceSeq) : NaN;
    var d = new Date();
    return {
      type: type,
      decidedAt: _nowISO(),
      atInvoiceSeq: isFinite(seq) ? seq : null,
      atDate: d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'),
      levelAtDecision: rec.level || null,
      releasedAt: null,
      releasedBy: null
    };
  }

  /**
   * Record seller reason + optional note.
   * - Plain reasons (price, competitor, ...): data capture only; status stays
   *   'active' (unchanged V1 behavior).
   * - Decision reasons (still_stock, not_wanted, follow_up_later): the
   *   structured code is authoritative; the note is stored beside it in
   *   reason.comment. The occurrence is closed and carries a suppression
   *   marker so the same subject does not regenerate (see "Seller decisions").
   * Both entry points (Customer page, Watch page) call this same function.
   */
  function recordWatchReason(occurrenceId, reasonCode, comment) {
    if (!occurrenceId) return null;
    var rec = _mem[occurrenceId];
    if (!rec) return null;
    if (rec.status !== 'active') return null;
    var code = reasonCode ? String(reasonCode) : null;
    // 'dismiss' is an explicit close action, not a reason code. Never
    // silently reinterpret it as 'other'; callers must use
    // dismissWatchOccurrence() so the lifecycle state is actually closed.
    if (code === 'dismiss') return null;
    if (code && !VALID_REASON_CODES[code]) {
      // Preserve the existing safe fallback for unknown reason codes.
      code = 'other';
    }
    if (code === 'still_stock' || code === 'not_wanted' || code === 'follow_up_later') {
      // not_wanted needs a product subject; never guess one for an
      // account-level Watch.
      if (code === 'not_wanted' && _normPid(rec.productId) == null) return null;
      var prev = rec.reason && rec.reason.comment ? rec.reason.comment : '';
      var text = comment ? String(comment).slice(0, 500) : prev; // never drop an existing note
      var nowD = _nowISO();
      rec.reason = { code: code, comment: text, recordedAt: nowD };
      rec.status = 'dismissed';
      rec.lastEvaluatedAt = nowD;
      rec.resolution = { type: 'seller_' + code, resolvedAt: nowD, note: null };
      rec.suppression = _decisionSnapshot(rec, code);
      _persist(rec);
      return rec;
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
    // Closes ONLY this cycle: the marker stops the same evidence from
    // re-opening it immediately. It can be released only by a real raw-condition
    // clear, an explicit seller reversal, or a genuine severity escalation of
    // this dismissed case.
    rec.suppression = _decisionSnapshot(rec, 'dismiss');
    // Reason/comment history (if any was recorded earlier) is untouched.
    _persist(rec);
    return rec;
  }

  /**
   * Render-time guard for the raw (id:null) fallback in the Customer page:
   * drops observations still covered by a live seller decision. Read-only,
   * one pass over in-memory occurrences; never writes.
   */
  function filterSuppressedWatchObservations(customerId, watches, ctx) {
    if (!Array.isArray(watches) || !watches.length) return watches || [];
    var tombs = _newTombs();
    var rows = _allOccurrences();
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (r && r.suppression && r.status !== 'active' && String(r.customerId) === String(customerId)) {
        _addTomb(tombs, r, ctx, false);
      }
    }
    var out = [];
    for (var j = 0; j < watches.length; j++) {
      var w = watches[j];
      if (!w) continue;
      var ts = _findTombs(tombs, customerId, w.category, w.productId, ctx);
      var held = false;
      for (var k = 0; k < ts.length; k++) {
        if (!_releaseReasonFor(ts[k], w, ctx)) { held = true; break; }
      }
      if (!held) out.push(w);
    }
    return out;
  }

  /** Response options valid for this occurrence (single source for both UIs). */
  function getWatchResponseOptions(occurrenceId) {
    var rec = occurrenceId ? _mem[occurrenceId] : null;
    var hasProduct = !!(rec && _normPid(rec.productId) != null);
    var out = [];
    for (var i = 0; i < WATCH_REASON_OPTIONS.length; i++) {
      var o = WATCH_REASON_OPTIONS[i];
      if (o.productOnly && !hasProduct) continue;
      out.push(o);
    }
    return out;
  }

  /** Complete a pending follow-up with an explicit result. Cancelling is
   * deliberately separate (reverseWatchDecision) and never becomes not_wanted. */
  function completeWatchFollowUp(occurrenceId, resultCode, comment) {
    var rec = _mem[occurrenceId];
    if (!rec || rec.status === 'active' || !rec.suppression || rec.suppression.releasedAt) return null;
    if (rec.suppression.type !== 'follow_up_later') return null;
    var code = resultCode ? String(resultCode) : '';
    if (!VALID_REASON_CODES[code] || code === 'follow_up_later') return null;
    if (code === 'not_wanted' && _normPid(rec.productId) == null) return null;
    var now = _nowISO();
    var text = comment ? String(comment).slice(0, 500) : (rec.reason && rec.reason.comment ? rec.reason.comment : '');
    if (code === 'dismiss') {
      rec.reason = { code: 'dismiss', label: 'بررسی شد، فعلاً پیگیری نمی‌خواهم', comment: text, recordedAt: now };
      rec.resolution = { type: 'follow_up_completed_dismiss', resolvedAt: now, note: null };
      // Completion ends the pending follow-up, but holds this current subject
      // under the ordinary dismiss suppression. It is not not_wanted, and it
      // can still be reopened later by the existing genuine escalation path.
      rec.suppression = _decisionSnapshot(rec, 'dismiss');
      _persist(rec);
      return rec;
    }
    rec.reason = {
      code: code,
      comment: text,
      recordedAt: now
    };
    rec.resolution = { type: 'follow_up_completed', resolvedAt: now, note: null };
    // Completing a follow-up with a factual cause (price/competitor/no_need/
    // quality/other) is still a seller answer to the SAME subject. Do not
    // release the hold while the raw Watch remains active: the next reconcile
    // would otherwise create a new occurrence with a fresh id immediately.
    // This is deliberately not not_wanted and is not a permanent suppression;
    // reconcile may release it only when the raw condition is genuinely clear.
    rec.suppression = _decisionSnapshot(rec, 'follow_up_result');
    rec.suppression.resultCode = code;
    rec.suppression.resultComment = text;
    rec.suppression.releasedAt = null;
    rec.suppression.releasedBy = null;
    _persist(rec);
    return rec;
  }

  /** Explicit seller reversal of a decision (by occurrence id). */
  function reverseWatchDecision(occurrenceId) {
    var rec = _mem[occurrenceId];
    if (!rec || !rec.suppression || rec.suppression.releasedAt) return null;
    _releaseSuppression(rec, 'seller_reversal');
    return rec;
  }

  function exportWatchLifecycleBundle() {
    return new Promise(function (resolve) {
      function pack() {
        var occurrences = _allOccurrences();
        resolve({
          version: 2,
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
      // Soft validation + backward-compatible migration. Old V1 dismissed rows
      // may have resolution/reason data but no suppression marker. We reconstruct
      // only the decision that is already explicit in that row: known seller
      // decision codes remain themselves; all other manual dismissals become the
      // generic 'dismiss' decision. No new business reason/evidence is invented.
      var cleaned = [];
      var decisionTypes = { still_stock: true, not_wanted: true, follow_up_later: true };
      for (var i = 0; i < rows.length; i++) {
        var r = rows[i];
        if (!r || r.id == null || r.customerId == null || !r.watchCategory) continue;
        if (r.status !== 'active' && r.status !== 'resolved' && r.status !== 'dismissed') {
          r.status = 'resolved';
        }
        if (r.status === 'dismissed' && !r.suppression) {
          var rt = r.resolution && r.resolution.type ? String(r.resolution.type) : '';
          var rc = r.reason && r.reason.code ? String(r.reason.code) : '';
          var inferred = decisionTypes[rc] ? rc : (rt === 'manual_dismiss' ? 'dismiss' : null);
          if (inferred) {
            var decidedAt = (r.resolution && r.resolution.resolvedAt) || (r.reason && r.reason.recordedAt) || r.lastEvaluatedAt || r.firstDetectedAt || _nowISO();
            r.suppression = {
              type: inferred,
              decidedAt: decidedAt,
              atInvoiceSeq: null,
              atDate: String(decidedAt).slice(0, 10),
              levelAtDecision: r.level || null,
              releasedAt: null,
              releasedBy: null,
              migratedFrom: 'watch_lifecycle_v1'
            };
          }
        }
        cleaned.push(r);
      }
      _mem = Object.create(null);
      _dirtyIds = Object.create(null);
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
    _dirtyIds = Object.create(null);
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
  global.getPendingWatchFollowUps = getPendingWatchFollowUps;
  global.recordWatchReason = recordWatchReason;
  global.dismissWatchOccurrence = dismissWatchOccurrence;
  global.filterSuppressedWatchObservations = filterSuppressedWatchObservations;
  global.reverseWatchDecision = reverseWatchDecision;
  global.completeWatchFollowUp = completeWatchFollowUp;
  global.getWatchResponseOptions = getWatchResponseOptions;
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
