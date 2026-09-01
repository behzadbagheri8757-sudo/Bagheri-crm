/* js/intelligence/feedback.js — Seller Feedback (P-03)
   ============================================================
   READ-ONLY w.r.t. CRM data. Independent Intelligence storage only.

   Public API:
     recordFeedback(customerId, productId, signalCategory, reasonCode, comment)
     getFeedbackForSignal(signal)
     applyFeedbackToSignal(signal)
     requestFeedbackForCustomer(customerId)

   Storage:
     Memory + localStorage key bagheri_intelligence_seller_feedback
     IndexedDB bagheri_intelligence_db / store seller_feedback
     Never writes CRM / customers / invoices / checks.

   Reason codes (P-03):
     competitor_bought  → riskModifier +20 (negative evidence)
     still_stock        → riskModifier -30 (reducing evidence)
     unknown            → modifier 0, no change

   Does NOT change signal status (P-02). Does NOT remove signals.
   Does NOT alter sourceLevel (P-01).
   ============================================================ */
'use strict';

(function (global) {

  var FEEDBACK_PARAMS = {
    lsKey: 'bagheri_intelligence_seller_feedback',
    idbName: 'bagheri_intelligence_db',
    idbStore: 'seller_feedback',
    idbVersion: 3
  };

  var REASON_MODIFIERS = {
    competitor_bought: 20,
    still_stock: -30,
    // V1 No-Purchase Reason — neutral modifiers (data collection only)
    no_need: 0,
    price_issue: 0,
    liquidity: 0
  };

  var REASON_ACTION_HINT = {
    competitor_bought: 'احتمال خرید از رقیب',
    still_stock: 'موجودی نزد مشتری',
    no_need: 'فعلاً نیاز ندارد',
    price_issue: 'قیمت مناسب نیست',
    liquidity: 'نقدینگی ندارد'
  };

  // in-memory list of feedback records
  var _mem = [];
  var _idb = null;

  function _nowISO() {
    return new Date().toISOString();
  }

  function _uid() {
    return 'fb_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  function _loadLS() {
    try {
      if (typeof localStorage === 'undefined' || !localStorage) return;
      var raw = localStorage.getItem(FEEDBACK_PARAMS.lsKey);
      if (!raw) return;
      var parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) _mem = parsed;
    } catch (e) { /* ignore */ }
  }

  function _saveLS() {
    try {
      if (typeof localStorage === 'undefined' || !localStorage) return;
      localStorage.setItem(FEEDBACK_PARAMS.lsKey, JSON.stringify(_mem));
    } catch (e) { /* ignore */ }
  }

  function _openIdb(cb) {
    if (typeof indexedDB === 'undefined' || !indexedDB) {
      if (cb) cb(null);
      return;
    }
    try {
      var req = indexedDB.open(FEEDBACK_PARAMS.idbName, FEEDBACK_PARAMS.idbVersion);
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
      var tx = _idb.transaction(FEEDBACK_PARAMS.idbStore, 'readwrite');
      tx.objectStore(FEEDBACK_PARAMS.idbStore).put(rec);
    } catch (e) { /* ignore */ }
  }

  function _idbHydrate(cb) {
    if (!_idb) { if (cb) cb(); return; }
    try {
      var tx = _idb.transaction(FEEDBACK_PARAMS.idbStore, 'readonly');
      var req = tx.objectStore(FEEDBACK_PARAMS.idbStore).getAll();
      req.onsuccess = function () {
        var rows = req.result || [];
        // merge by id
        var byId = Object.create(null);
        for (var i = 0; i < _mem.length; i++) byId[_mem[i].id] = _mem[i];
        for (var j = 0; j < rows.length; j++) {
          if (rows[j] && rows[j].id) byId[rows[j].id] = rows[j];
        }
        _mem = Object.keys(byId).map(function (k) { return byId[k]; });
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

  /**
   * Record structured seller feedback.
   * Optional 6th arg `source` (e.g. 'visit' | 'invoice') is additive and
   * ignored by older callers. Does not affect scoring — only metadata.
   */
  function recordFeedback(customerId, productId, signalCategory, reasonCode, comment, source) {
    if (!customerId || !signalCategory) return null;
    var rec = {
      id: _uid(),
      customerId: customerId,
      productId: (productId != null && productId !== '') ? productId : null,
      signalCategory: signalCategory,
      reasonCode: reasonCode || null,
      comment: comment || '',
      createdAt: _nowISO()
    };
    if (source != null && source !== '') {
      rec.source = String(source);
    }
    _mem.push(rec);
    _saveLS();
    _idbPut(rec);
    return rec;
  }

  function getFeedbackForSignal(signal) {
    if (!signal || !signal.customerId || !signal.category) return null;
    var cid = signal.customerId;
    var cat = signal.category;
    var pid = signal.productId != null ? signal.productId : null;
    // latest matching feedback (most recent createdAt)
    var best = null;
    for (var i = 0; i < _mem.length; i++) {
      var f = _mem[i];
      if (!f || f.customerId !== cid || f.signalCategory !== cat) continue;
      // productId: if signal has productId, require match; if signal has none, match null/empty feedback
      var fPid = f.productId != null ? f.productId : null;
      if (pid != null && pid !== '') {
        if (fPid !== pid) continue;
      } else {
        if (fPid != null && fPid !== '') continue;
      }
      if (!best || String(f.createdAt) > String(best.createdAt)) best = f;
    }
    return best;
  }

  /**
   * Attach feedback evidence + riskModifier to a signal in place.
   * Never changes status, sourceLevel, type, or removes the signal.
   */
  function applyFeedbackToSignal(signal) {
    if (!signal) return signal;
    var fb = getFeedbackForSignal(signal);
    if (!fb) {
      // no feedback → leave signal unchanged (modifier absent = 0)
      return signal;
    }
    var code = fb.reasonCode;
    var modifier = 0;
    if (code && Object.prototype.hasOwnProperty.call(REASON_MODIFIERS, code)) {
      modifier = REASON_MODIFIERS[code];
    }
    signal.feedback = {
      id: fb.id,
      reasonCode: code,
      comment: fb.comment || '',
      createdAt: fb.createdAt
    };
    signal.riskModifier = modifier;
    if (code && REASON_ACTION_HINT[code]) {
      signal.feedbackHint = REASON_ACTION_HINT[code];
    }
    return signal;
  }

  /**
   * Apply feedback to every signal in an array (in place).
   */
  function applyFeedbackToSignals(signals) {
    if (!signals || !signals.length) return signals || [];
    for (var i = 0; i < signals.length; i++) {
      applyFeedbackToSignal(signals[i]);
    }
    return signals;
  }

  /**
   * API for future UI: list signals that could use seller feedback
   * for a customer (does not create UI).
   */
  function requestFeedbackForCustomer(customerId) {
    if (!customerId) return [];
    var signals = [];
    if (typeof extractCustomerSignals === 'function') {
      try {
        signals = extractCustomerSignals(customerId) || [];
      } catch (e) {
        signals = [];
      }
    }
    // only actionable risk/opportunity without existing feedback of known reason
    var out = [];
    for (var i = 0; i < signals.length; i++) {
      var s = signals[i];
      if (!s || !s.category) continue;
      if (s.feedback && s.feedback.reasonCode) continue;
      out.push({
        customerId: s.customerId,
        productId: s.productId != null ? s.productId : null,
        category: s.category,
        type: s.type,
        status: s.status,
        reason: s.reason
      });
    }
    return out;
  }

  function clearIntelligenceFeedback() {
    _mem = [];
    try {
      if (typeof localStorage !== 'undefined' && localStorage) {
        localStorage.removeItem(FEEDBACK_PARAMS.lsKey);
      }
    } catch (e) { /* ignore */ }
    if (_idb) {
      try {
        var tx = _idb.transaction(FEEDBACK_PARAMS.idbStore, 'readwrite');
        tx.objectStore(FEEDBACK_PARAMS.idbStore).clear();
      } catch (e2) { /* ignore */ }
    }
  }

  global.recordFeedback = recordFeedback;
  global.getFeedbackForSignal = getFeedbackForSignal;
  global.applyFeedbackToSignal = applyFeedbackToSignal;
  global.applyFeedbackToSignals = applyFeedbackToSignals;
  global.requestFeedbackForCustomer = requestFeedbackForCustomer;
  global.clearIntelligenceFeedback = clearIntelligenceFeedback;
  global.FEEDBACK_PARAMS = FEEDBACK_PARAMS;
  global.REASON_MODIFIERS = REASON_MODIFIERS;

})(typeof window !== 'undefined' ? window : this);
