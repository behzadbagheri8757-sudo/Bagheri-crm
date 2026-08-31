/* js/intelligence/baseline_manager.js — Baseline Shift Detection (P-05)
   ============================================================
   Intelligence-owned baseline cache per customerId + productId.

   Public API:
     getBaseline(customerId, productId)
     updateBaselineIfShifted(customerId, productId, recentPurchases)

   Calibration (Patch Plan placeholders):
     baselineShiftMinPurchases = 8
     baselineShiftDeviationThreshold = 0.40 (40%)

   Rules:
     - Single outlier MUST NOT change baseline
     - Persistent new pattern (≥ minPurchases, ≥ 40% deviation) updates baseline
     - Storage: memory + localStorage + IndexedDB store baseline_cache
     - Never writes CRM core data
   ============================================================ */
'use strict';

(function (global) {

  var BASELINE_PARAMS = {
    minPurchases: 8,
    deviationThreshold: 0.40,
    lsKey: 'bagheri_intelligence_baseline_cache',
    idbName: 'bagheri_intelligence_db',
    idbStore: 'baseline_cache',
    idbVersion: 3
  };

  // key -> baseline record
  var _mem = Object.create(null);
  var _idb = null;

  function _key(customerId, productId) {
    return String(customerId) + '|' + String(productId || '');
  }

  function _dateDiffDays(laterIso, earlierIso) {
    if (!laterIso || !earlierIso) return null;
    var a = new Date(String(laterIso).slice(0, 10)).getTime();
    var b = new Date(String(earlierIso).slice(0, 10)).getTime();
    if (isNaN(a) || isNaN(b)) return null;
    return Math.round((a - b) / 86400000);
  }

  function _median(arr) {
    if (!arr || !arr.length) return null;
    var s = arr.slice().sort(function (x, y) { return x - y; });
    var m = Math.floor(s.length / 2);
    if (s.length % 2) return s[m];
    return (s[m - 1] + s[m]) / 2;
  }

  function _computeStats(purchases) {
    var events = (purchases || []).slice().sort(function (a, b) {
      return String(a.date || '').localeCompare(String(b.date || ''));
    });
    var intervals = [];
    for (var i = 1; i < events.length; i++) {
      var d = _dateDiffDays(events[i].date, events[i - 1].date);
      if (d != null && d > 0) intervals.push(d);
    }
    var qtys = [];
    for (var q = 0; q < events.length; q++) {
      if (events[q] && events[q].qty != null && isFinite(events[q].qty)) {
        qtys.push(events[q].qty);
      }
    }
    return {
      purchaseCount: events.length,
      typicalCycle: intervals.length ? _median(intervals) : null,
      typicalQuantity: qtys.length ? _median(qtys) : null,
      intervalCount: intervals.length,
      intervals: intervals
    };
  }

  function _loadLS() {
    try {
      if (typeof localStorage === 'undefined' || !localStorage) return;
      var raw = localStorage.getItem(BASELINE_PARAMS.lsKey);
      if (!raw) return;
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return;
      var keys = Object.keys(parsed);
      for (var i = 0; i < keys.length; i++) {
        _mem[keys[i]] = parsed[keys[i]];
      }
    } catch (e) { /* ignore */ }
  }

  function _saveLS() {
    try {
      if (typeof localStorage === 'undefined' || !localStorage) return;
      localStorage.setItem(BASELINE_PARAMS.lsKey, JSON.stringify(_mem));
    } catch (e) { /* ignore */ }
  }

  function _openIdb(cb) {
    if (typeof indexedDB === 'undefined' || !indexedDB) {
      if (cb) cb(null);
      return;
    }
    try {
      var req = indexedDB.open(BASELINE_PARAMS.idbName, BASELINE_PARAMS.idbVersion);
      req.onupgradeneeded = function (ev) {
        var db = ev.target.result;
        // Shared bagheri_intelligence_db schema (v3): ensure all Intelligence stores.
        if (!db.objectStoreNames.contains('occurrences')) {
          db.createObjectStore('occurrences', { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains('seller_feedback')) {
          db.createObjectStore('seller_feedback', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('baseline_cache')) {
          db.createObjectStore('baseline_cache', { keyPath: 'key' });
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
      var tx = _idb.transaction(BASELINE_PARAMS.idbStore, 'readwrite');
      tx.objectStore(BASELINE_PARAMS.idbStore).put(rec);
    } catch (e) { /* ignore */ }
  }

  function _idbHydrate(cb) {
    if (!_idb) { if (cb) cb(); return; }
    try {
      var tx = _idb.transaction(BASELINE_PARAMS.idbStore, 'readonly');
      var req = tx.objectStore(BASELINE_PARAMS.idbStore).getAll();
      req.onsuccess = function () {
        var rows = req.result || [];
        for (var i = 0; i < rows.length; i++) {
          var row = rows[i];
          if (row && row.key) _mem[row.key] = row;
        }
        _saveLS();
        if (cb) cb();
      };
      req.onerror = function () { if (cb) cb(); };
    } catch (e) {
      if (cb) cb();
    }
  }

  _loadLS();
  _openIdb(function (db) {
    if (db) _idbHydrate(function () {});
  });

  function _store(customerId, productId, stats, reason) {
    var k = _key(customerId, productId);
    var rec = {
      key: k,
      customerId: customerId,
      productId: productId,
      typicalCycle: stats.typicalCycle,
      typicalQuantity: stats.typicalQuantity,
      purchaseCount: stats.purchaseCount,
      updatedAt: new Date().toISOString(),
      reason: reason || 'establish'
    };
    _mem[k] = rec;
    _saveLS();
    _idbPut(rec);
    return rec;
  }

  /**
   * Retrieve stored baseline for customerId + productId.
   * Returns null if none established.
   */
  function getBaseline(customerId, productId) {
    if (!customerId || productId == null || productId === '') return null;
    var rec = _mem[_key(customerId, productId)];
    return rec || null;
  }

  /**
   * Evaluate recent purchases against stored baseline.
   * Establishes baseline when missing and history is sufficient.
   * Updates baseline only when a persistent shift is detected
   * (≥ minPurchases in recent window AND ≥ 40% deviation).
   * A single outlier does not change the baseline.
   *
   * @param {string} customerId
   * @param {string} productId
   * @param {Array} recentPurchases - full purchase history for the pair
   *        (sorted or unsorted; manager sorts internally)
   * @returns {object|null} current baseline record after evaluation
   */
  function updateBaselineIfShifted(customerId, productId, recentPurchases) {
    if (!customerId || productId == null || productId === '') return null;
    var purchases = Array.isArray(recentPurchases) ? recentPurchases : [];
    if (!purchases.length) return getBaseline(customerId, productId);

    var allStats = _computeStats(purchases);
    var existing = getBaseline(customerId, productId);
    var minP = BASELINE_PARAMS.minPurchases;
    var thresh = BASELINE_PARAMS.deviationThreshold;

    // Insufficient history: do not fabricate a baseline
    if (allStats.purchaseCount < minP) {
      return existing;
    }

    // Establish initial baseline from full history when none exists
    if (!existing) {
      return _store(customerId, productId, allStats, 'establish');
    }

    // Recent window = last minPurchases events (persistent new pattern window)
    var sorted = purchases.slice().sort(function (a, b) {
      return String(a.date || '').localeCompare(String(b.date || ''));
    });
    var recentSlice = sorted.slice(Math.max(0, sorted.length - minP));
    var recentStats = _computeStats(recentSlice);

    // Need enough recent purchases and at least one interval
    if (recentStats.purchaseCount < minP || recentStats.intervalCount < 1) {
      return existing;
    }

    var shifted = false;
    var cycleDev = null;
    var qtyDev = null;

    if (
      existing.typicalCycle != null && existing.typicalCycle > 0 &&
      recentStats.typicalCycle != null && recentStats.typicalCycle > 0
    ) {
      cycleDev = Math.abs(recentStats.typicalCycle - existing.typicalCycle) / existing.typicalCycle;
      if (cycleDev >= thresh) shifted = true;
    }

    if (
      !shifted &&
      existing.typicalQuantity != null && existing.typicalQuantity > 0 &&
      recentStats.typicalQuantity != null && recentStats.typicalQuantity > 0
    ) {
      qtyDev = Math.abs(recentStats.typicalQuantity - existing.typicalQuantity) / existing.typicalQuantity;
      if (qtyDev >= thresh) shifted = true;
    }

    if (!shifted) return existing;

    // Persistent shift confirmed → update stored baseline to recent pattern
    return _store(customerId, productId, {
      purchaseCount: allStats.purchaseCount,
      typicalCycle: recentStats.typicalCycle != null ? recentStats.typicalCycle : existing.typicalCycle,
      typicalQuantity: recentStats.typicalQuantity != null ? recentStats.typicalQuantity : existing.typicalQuantity
    }, 'shift');
  }

  function clearBaselineCache() {
    _mem = Object.create(null);
    try {
      if (typeof localStorage !== 'undefined' && localStorage) {
        localStorage.removeItem(BASELINE_PARAMS.lsKey);
      }
    } catch (e) { /* ignore */ }
    if (_idb) {
      try {
        var tx = _idb.transaction(BASELINE_PARAMS.idbStore, 'readwrite');
        tx.objectStore(BASELINE_PARAMS.idbStore).clear();
      } catch (e2) { /* ignore */ }
    }
  }

  // Test seam: count stored keys
  function _baselineCacheSize() {
    return Object.keys(_mem).length;
  }

  global.getBaseline = getBaseline;
  global.updateBaselineIfShifted = updateBaselineIfShifted;
  global.clearBaselineCache = clearBaselineCache;
  global.BASELINE_PARAMS = BASELINE_PARAMS;
  global._baselineCacheSize = _baselineCacheSize;

})(typeof window !== 'undefined' ? window : this);
