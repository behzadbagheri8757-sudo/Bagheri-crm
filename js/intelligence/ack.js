/* js/intelligence/ack.js — SellerAck (تصدیق فروشنده)
   ============================================================
   Single source of truth for a seller's recorded decision about a
   customer/product. Feeds four layers from ONE record:
     Risk     (risk.js     via applyAcksToSignals -> ackRiskDelta)
     Priority (priority.js via signal.ackPriorityDelta, bounded ±15)
     Action   (action.js   via getActiveAcksForCustomer)
     Watch    (watch_lifecycle.js tombstone kept as local cache, mirrored)

   Storage: bagheri_intelligence_db / store `seller_acks` (IDB v4)
            + localStorage mirror `bagheri_seller_acks_v1`.

   Rules:
   - Additive only. Never deletes legacy feedback / watch / visit data.
   - Fail-open everywhere: an ACK error must never break a render or a save.
   - IMMEDIATE categories (CHECK_BOUNCED, PAYMENT_OVERDUE) are never
     suppressed or reduced by an ACK.
   - Until migrateLegacyAcknowledgments() has completed once
     (flag bagheri_acks_migrated_v1), the ACK layer is dormant for
     Risk/Priority/Action (fallbackToLegacy) — behaviour == pre-ACK.
   ============================================================ */
'use strict';

(function (global) {

  var ACK_PARAMS = {
    lsKey: 'bagheri_seller_acks_v1',
    idbName: 'bagheri_intelligence_db',
    idbStore: 'seller_acks',
    idbVersion: 4,
    migratedKey: 'bagheri_acks_migrated_v1',
    migratingKey: 'bagheri_acks_migrating_v1',
    priorityCap: 15
  };

  var DAY = 24 * 60 * 60 * 1000;

  // Never suppressed / reduced by an ACK (spec §7: stay immediate).
  var ACK_IMMEDIATE_CATEGORIES = { CHECK_BOUNCED: true, PAYMENT_OVERDUE: true };

  var VALID_DECISIONS = {
    still_stock: true, no_need: true, not_wanted: true, follow_up_later: true,
    price: true, competitor: true, quality: true, other: true,
    dismiss: true, unavailable: true, visit_reviewed: true
  };

  // Codes used by older modules → ACK decision vocabulary.
  var DECISION_ALIASES = {
    competitor_bought: 'competitor',
    price_issue: 'price',
    liquidity: 'other'
  };

  var SUPPRESS_DECISIONS = { still_stock: true, no_need: true, not_wanted: true, dismiss: true, unavailable: true };
  var CHANGE_DECISIONS = { price: true, quality: true };

  // Durations are the owner's FINAL values (they override the blueprint):
  //   still_stock 7 · no_need 14 · not_wanted 14 · price 5 · competitor 7 · follow_up_later = seller date | 5
  //   unavailable 7 · visit_reviewed 7 · quality / other / dismiss / unknown reason 7.
  // still_stock effects depend on stockSource + main product -> see _effectsFor().
  var AFFECT_TABLE = {
    still_stock:     { action: 'suppress',  riskDelta: -30, priorityDelta: -5, watch: 'close', durationDays: 7 },
    no_need:         { action: 'suppress',  riskDelta: -30, priorityDelta: -5, watch: 'close', durationDays: 14 },
    not_wanted:      { action: 'suppress',  riskDelta: -40, priorityDelta: -8, watch: 'close', durationDays: 14 },
    follow_up_later: { action: 'follow_up', riskDelta: -10, priorityDelta: -3, watch: 'defer', durationDays: 5 },
    price:           { action: 'change_to', riskDelta: 0,   priorityDelta: 0,  watch: 'keep',  durationDays: 5,
                       actionText: 'پیگیری قیمت', actionType: 'follow_up' },
    competitor:      { action: 'change_to', riskDelta: 10,  priorityDelta: 5,  watch: 'keep',  durationDays: 7,
                       actionText: 'بازگرداندن مشتری — خرید از رقیب', actionType: 'visit', keepAlert: true },
    quality:         { action: 'change_to', riskDelta: 0,   priorityDelta: 0,  watch: 'keep',  durationDays: 7,
                       actionText: 'بررسی کیفیت / شکایت', actionType: 'investigate' },
    other:           { action: 'keep',      riskDelta: 0,   priorityDelta: 0,  watch: 'keep',  durationDays: 7 },
    dismiss:         { action: 'suppress',  riskDelta: -30, priorityDelta: -5, watch: 'close', durationDays: 7 },
    unavailable:     { action: 'suppress',  riskDelta: 0,   priorityDelta: 0,  watch: 'keep',  durationDays: 7 },
    visit_reviewed:  { action: 'reviewed',  riskDelta: 0,   priorityDelta: -5, watch: 'keep',  durationDays: 7 }
  };

  var _mem = [];
  var _idb = null;
  var _watchSyncDepth = 0;
  var _migrating = false;

  /* ---------- helpers ---------- */

  function _nowISO() { return new Date().toISOString(); }
  function _uid() { return 'ack_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8); }
  function _warn() { try { console.warn.apply(console, arguments); } catch (e) { /* ignore */ } }

  function _addDays(date, n) { return new Date(date.getTime() + n * DAY); }

  function _parseISO(s) {
    if (!s) return null;
    var str = String(s);
    var d = /^\d{4}-\d{2}-\d{2}$/.test(str) ? new Date(str + 'T23:59:59') : new Date(str);
    return isNaN(d.getTime()) ? null : d;
  }

  function normalizeDecision(code) {
    if (code == null) return null;
    var c = String(code);
    if (Object.prototype.hasOwnProperty.call(DECISION_ALIASES, c)) c = DECISION_ALIASES[c];
    return VALID_DECISIONS[c] ? c : null;
  }

  function decisionCategoryOf(decision) {
    if (SUPPRESS_DECISIONS[decision]) return 'suppress';
    if (decision === 'follow_up_later') return 'defer';
    if (CHANGE_DECISIONS[decision]) return 'change';
    if (decision === 'competitor') return 'boost';
    return 'neutral';
  }

  function computeAckExpiresAt(decision, createdAtISO, followUpDate) {
    var base = _parseISO(createdAtISO) || new Date();
    if (decision === 'follow_up_later') {
      var f = _parseISO(followUpDate);
      if (f && f.getTime() > base.getTime()) return f.toISOString();
    }
    var row = AFFECT_TABLE[decision];
    return _addDays(base, row ? row.durationDays : 14).toISOString();
  }

  function _familyOf(productId, ctx) {
    if (productId == null || productId === '' || productId === 'multi') return null;
    try {
      if (typeof resolveFamilyId === 'function') return resolveFamilyId(productId, ctx);
    } catch (e) { /* fail-open */ }
    return productId;
  }

  /* ---------- storage ---------- */

  function _loadLS() {
    try {
      if (typeof localStorage === 'undefined' || !localStorage) return;
      var raw = localStorage.getItem(ACK_PARAMS.lsKey);
      if (!raw) return;
      var parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) _mem = parsed.filter(function (r) { return r && r.id; });
    } catch (e) { /* ignore corrupt */ }
  }

  function _saveLS() {
    try {
      if (typeof localStorage === 'undefined' || !localStorage) return;
      localStorage.setItem(ACK_PARAMS.lsKey, JSON.stringify(_mem));
    } catch (e) { _warn('ACK localStorage save failed', e); }
  }

  function _ensureStores(db) {
    // Shared bagheri_intelligence_db schema (v4). Every opener creates ALL stores.
    if (!db.objectStoreNames.contains('occurrences')) db.createObjectStore('occurrences', { keyPath: 'key' });
    if (!db.objectStoreNames.contains('seller_feedback')) db.createObjectStore('seller_feedback', { keyPath: 'id' });
    if (!db.objectStoreNames.contains('baseline_cache')) db.createObjectStore('baseline_cache', { keyPath: 'key' });
    if (!db.objectStoreNames.contains('seller_acks')) {
      var st = db.createObjectStore('seller_acks', { keyPath: 'id' });
      try {
        st.createIndex('by_customer_status', ['customerId', 'status'], { unique: false });
        st.createIndex('by_expiry', 'expiresAt', { unique: false });
      } catch (e) { /* ignore */ }
    }
  }

  function _openIdb(cb) {
    if (typeof indexedDB === 'undefined' || !indexedDB) { if (cb) cb(null); return; }
    try {
      var req = indexedDB.open(ACK_PARAMS.idbName, ACK_PARAMS.idbVersion);
      req.onupgradeneeded = function (ev) { _ensureStores(ev.target.result); };
      req.onsuccess = function (ev) { _idb = ev.target.result; if (cb) cb(_idb); };
      req.onerror = function () { if (cb) cb(null); };
    } catch (e) { if (cb) cb(null); }
  }

  function _idbPut(rec) {
    if (!_idb || !rec) return;
    try {
      if (!_idb.objectStoreNames.contains(ACK_PARAMS.idbStore)) return;
      _idb.transaction(ACK_PARAMS.idbStore, 'readwrite').objectStore(ACK_PARAMS.idbStore).put(rec);
    } catch (e) { /* ignore: LS mirror still holds it */ }
  }

  function _idbHydrate(cb) {
    if (!_idb || !_idb.objectStoreNames.contains(ACK_PARAMS.idbStore)) { if (cb) cb(); return; }
    try {
      var req = _idb.transaction(ACK_PARAMS.idbStore, 'readonly').objectStore(ACK_PARAMS.idbStore).getAll();
      req.onsuccess = function () {
        var rows = req.result || [];
        var byId = Object.create(null);
        for (var i = 0; i < _mem.length; i++) byId[_mem[i].id] = _mem[i];     // LS mirror is fresher
        for (var j = 0; j < rows.length; j++) if (rows[j] && rows[j].id && !byId[rows[j].id]) byId[rows[j].id] = rows[j];
        _mem = Object.keys(byId).map(function (k) { return byId[k]; });
        _saveLS();
        if (cb) cb();
      };
      req.onerror = function () { if (cb) cb(); };
    } catch (e) { if (cb) cb(); }
  }

  function _persist(rec) { _saveLS(); _idbPut(rec); }

  /* ---------- state flags ---------- */

  function isAckLayerActive() {
    try {
      return typeof localStorage !== 'undefined' && !!localStorage && !!localStorage.getItem(ACK_PARAMS.migratedKey);
    } catch (e) { return false; }
  }

  function ackWatchSyncActive() { return _watchSyncDepth > 0; }

  /* ---------- effects ---------- */

  // still_stock splits by where the stock is (owner rules §7):
  //   ours        -> suppress (7d)
  //   competitor + MAIN product     -> keep alert, Watch stays, "return customer", risk +10, priority +5
  //   competitor + non-main product -> alert deferred 7d, "check competitor purchase", no risk rise, no priority rise
  //   unknown / not stated by a visit -> deferred 7d, "ask: do they have ours or a competitor's"
  // A still_stock WITHOUT a valid stockSource (invoice prompt / Watch reason / legacy rows) is 'unknown'
  // (owner decision): 7d deferral + the ask-text, with a small temporary Risk reduction.
  var TXT_STOCK_UNKNOWN = 'مشتری گفت جنس دارد؛ در پیگیری بعدی بپرس از ما دارد یا از رقیب.';
  var TXT_STOCK_COMPETITOR_NONMAIN = 'بررسی خرید از رقیب';

  function _effectsFor(decision, info) {
    info = info || {};
    var t = AFFECT_TABLE[decision] || AFFECT_TABLE.other;
    var e = {
      action: t.action,
      actionText: t.actionText || null,
      actionType: t.actionType || null,
      riskDelta: t.riskDelta,
      priorityDelta: t.priorityDelta,
      watch: t.watch,
      keepAlert: !!t.keepAlert,
      urgency: null
    };
    if (decision === 'still_stock' && info.stockSource === 'competitor') {
      if (info.isMain !== false) {            // main product (or undeterminable => safe side: do NOT hide)
        e.action = 'change_to'; e.actionText = AFFECT_TABLE.competitor.actionText; e.actionType = 'visit';
        e.riskDelta = 10; e.priorityDelta = 5; e.watch = 'keep'; e.keepAlert = true;
      } else {
        e.action = 'change_to'; e.actionText = TXT_STOCK_COMPETITOR_NONMAIN; e.actionType = 'investigate';
        e.riskDelta = 0; e.priorityDelta = 0; e.watch = 'defer'; e.urgency = 'low';
      }
    } else if (decision === 'still_stock' && info.stockSource === 'unknown') {
      e.action = 'change_to'; e.actionText = TXT_STOCK_UNKNOWN; e.actionType = 'follow_up';
      e.riskDelta = -10; e.priorityDelta = 0; e.watch = 'defer'; e.urgency = 'low';   // temporary, partial reduction (not zero)
    } else if (decision === 'other') {
      e.urgency = 'low';
    } else if (decision === 'visit_reviewed') {
      e.urgency = 'low';
    }
    return e;
  }

  // "Main product" = the family is among the customer's top products (calc.js customerBehavior.topProducts,
  // top 5 by quantity). Undeterminable => treated as main (never hide a competitor purchase by mistake).
  function _isMainProduct(customerId, familyId) {
    try {
      if (typeof customerBehavior !== 'function' || !familyId) return true;
      var b = customerBehavior(customerId);
      var list = (b && b.topProducts) || [];
      if (!list.length) return true;
      for (var i = 0; i < list.length; i++) {
        if (list[i] && list[i].productId && _familyOf(list[i].productId) === familyId) return true;
      }
      return false;
    } catch (e) { return true; }
  }

  function _isLive(a, nowMs) {
    if (!a || a.status !== 'active') return false;
    var exp = _parseISO(a.expiresAt);
    return !exp || exp.getTime() > nowMs;
  }

  /* ---------- Watch mirror (tombstone stays the Watch cache) ---------- */

  function _findWatchOccurrence(customerId, familyId, ctx) {
    if (typeof getActiveWatchOccurrences !== 'function' || !familyId) return null;
    try {
      var occ = getActiveWatchOccurrences(customerId) || [];
      for (var i = 0; i < occ.length; i++) {
        var o = occ[i];
        if (!o || o.status !== 'active') continue;
        if (o.productId == null || o.productId === '') continue;
        if (_familyOf(o.productId, ctx) === familyId) return o;
      }
    } catch (e) { /* fail-open */ }
    return null;
  }

  function _syncWatchFromAck(ack, ctx) {
    // visit / invoice decisions mirror into the matching Watch (same tombstone path as the Watch UI).
    // Only product ACKs touch Watch; 'keep' effects (price/quality/competitor-main/other) leave it active.
    if (ack.source === 'watch' || ack.scope !== 'product') return;
    var w = ack.effects && ack.effects.watch;
    if (w !== 'close' && w !== 'defer') return;
    var occ = _findWatchOccurrence(ack.customerId, ack.familyId, ctx);
    if (!occ || typeof recordWatchReason !== 'function') return;
    _watchSyncDepth++;
    try {
      if (w === 'defer') {
        recordWatchReason(occ.id, 'follow_up_later', ack.note || '', String(ack.followUpDate || ack.expiresAt).slice(0, 10));
      } else if (ack.decision === 'still_stock' || ack.decision === 'not_wanted') {
        recordWatchReason(occ.id, ack.decision, ack.note || '');
      } else if (typeof dismissWatchOccurrence === 'function') {
        if (ack.decision === 'no_need') recordWatchReason(occ.id, 'no_need', ack.note || '');
        dismissWatchOccurrence(occ.id, ack.note || '');
      }
      ack.watchOccurrenceId = occ.id;
    } catch (e) { _warn('ACK→Watch sync failed', e); }
    finally { _watchSyncDepth--; }
  }

  function _releaseWatchFor(ack) {
    var occId = ack.source === 'watch' ? ack.sourceId : ack.watchOccurrenceId;
    if (!occId || typeof reverseWatchDecision !== 'function') return;
    _watchSyncDepth++;
    try { reverseWatchDecision(occId); } catch (e) { /* best-effort */ }
    finally { _watchSyncDepth--; }
  }

  /* ---------- public API ---------- */

  function createAck(params) {
    try {
      params = params || {};
      var decision = normalizeDecision(params.decision);
      if (!params.customerId || !decision) { _warn('createAck: missing customerId or invalid decision', params); return null; }
      var source = params.source;
      if (['visit', 'invoice', 'watch', 'legacy_migration'].indexOf(source) < 0) { _warn('createAck: invalid source', source); return null; }

      var familyId = (params.familyId != null && params.familyId !== '') ? params.familyId : _familyOf(params.productId);
      // A product decision NEVER turns itself into an account-level ACK. Account scope is only
      // ever explicit (visit_reviewed, or a caller passing scope:'account' on purpose).
      var scope = params.scope || (familyId ? 'product' : null);
      if (!scope) { _warn('createAck: product decision without a resolvable product', params); return null; }
      if (scope === 'account') familyId = null;
      if (decision === 'visit_reviewed' && scope !== 'account') { _warn('visit_reviewed must be account scope'); return null; }
      var stockSource = (decision === 'still_stock')
        ? ((params.stockSource === 'ours' || params.stockSource === 'competitor') ? params.stockSource : 'unknown')
        : null;
      var isMain = (stockSource === 'competitor') ? _isMainProduct(params.customerId, familyId) : null;

      var createdAt = params.createdAt ? (_parseISO(params.createdAt) || new Date()).toISOString() : _nowISO();
      var followUpDate = decision === 'follow_up_later' ? (params.followUpDate || null) : null;

      var ack = {
        id: _uid(),
        customerId: params.customerId,
        familyId: familyId,
        productId: params.productId != null && params.productId !== '' ? params.productId : null,
        scope: scope,
        decision: decision,
        decisionCategory: decisionCategoryOf(decision),
        source: source,
        sourceId: params.sourceId != null ? params.sourceId : null,
        sourceContext: params.sourceContext || {},
        note: params.note ? String(params.note).slice(0, 500) : '',
        followUpDate: followUpDate,
        createdAt: createdAt,
        expiresAt: computeAckExpiresAt(decision, createdAt, followUpDate),
        status: 'active',
        reversedAt: null,
        reversedReason: null,
        stockSource: stockSource,
        isMainProduct: isMain,
        effects: _effectsFor(decision, { stockSource: stockSource, isMain: isMain })
      };
      if (params.legacyKey) ack.legacyKey = String(params.legacyKey);   // dedupe vs. legacy migration

      // An ACK whose whole life is already in the past (legacy migration) is stored as expired.
      if (_parseISO(ack.expiresAt) && _parseISO(ack.expiresAt).getTime() <= Date.now()) ack.status = 'expired';

      // 'other' never supersedes by default; everything else replaces older same-scope decisions (P2).
      var supersede = params.supersedeExisting != null ? !!params.supersedeExisting : decision !== 'other';
      if (supersede && ack.status === 'active') {
        for (var i = 0; i < _mem.length; i++) {
          var o = _mem[i];
          if (!o || o.status !== 'active' || o.customerId !== ack.customerId || o.scope !== ack.scope) continue;
          if (ack.scope === 'product' && o.familyId !== ack.familyId) continue;
          if (ack.scope === 'account' && o.decision !== ack.decision) continue;   // account ACKs only replace their own kind
          if (o.decision === 'other') continue;
          o.status = 'superseded';
          o.reversedAt = _nowISO();
          o.reversedReason = 'superseded_by_newer';
          _persist(o);
        }
      }

      if (ack.status === 'active') _syncWatchFromAck(ack, params.ctx || null);
      _mem.push(ack);
      _persist(ack);
      return ack;
    } catch (e) {
      console.error('createAck failed (fail-open)', e);
      return null;
    }
  }

  function getActiveAcksForCustomer(customerId, options) {
    try {
      options = options || {};
      if (!customerId) return [];
      var now = Date.now();
      var out = [];
      for (var i = 0; i < _mem.length; i++) {
        var a = _mem[i];
        if (!a || a.customerId !== customerId) continue;
        var live = _isLive(a, now);
        var ok = live ||
          (options.includeExpired && (a.status === 'expired' || (a.status === 'active' && !live))) ||
          (options.includeReversed && (a.status === 'reversed' || a.status === 'superseded'));
        if (!ok) continue;
        if (options.familyId != null && a.scope === 'product' && a.familyId !== options.familyId) continue;
        out.push(a);
      }
      out.sort(function (x, y) { return String(y.createdAt).localeCompare(String(x.createdAt)); });
      return out;
    } catch (e) { return []; }
  }

  // Which signals an ACK may touch:
  //  - product ACK : only signals of the SAME product/family. Never account-level signals
  //                  (PURCHASE_DECLINE_*), never IMMEDIATE categories.
  //  - account ACK : only account-level signals (explicit scope='account'), never IMMEDIATE.
  //  - visit_reviewed (account scope, explicit): every ordinary non-immediate alert of the customer,
  //                  EXCEPT a signal whose product has a live "keep the alert" ACK (competitor on a main product).
  function _isAccountLevelSignal(signal) {
    if (!signal) return false;
    if (signal.sourceLevel === 'account') return true;
    return typeof signal.category === 'string' && signal.category.indexOf('PURCHASE_DECLINE') === 0;
  }

  function getAckEffectForSignal(signal, acks) {
    if (!signal || !acks || !acks.length) return null;
    if (ACK_IMMEDIATE_CATEGORIES[signal.category]) return null;
    var fam = (signal.familyId != null && signal.familyId !== '') ? signal.familyId : signal.productId;
    var acct = _isAccountLevelSignal(signal);
    var decided = [];      // product / account decisions
    var reviewed = null;   // newest visit_reviewed
    for (var i = 0; i < acks.length; i++) {
      var a = acks[i];
      if (!a || a.status !== 'active') continue;
      if (a.decision === 'visit_reviewed') {
        if (a.scope === 'account' && (!reviewed || String(a.createdAt) > String(reviewed.createdAt))) reviewed = a;
        continue;
      }
      if (a.scope === 'product') {
        if (acct) continue;                                  // product ACK never touches account-level signals
        if (fam == null || fam === '' || a.familyId !== fam) continue;
      } else if (!acct) {
        continue;                                            // account ACK only touches account-level signals
      }
      decided.push(a);
    }
    var keepAlert = decided.some(function (a) { return a.effects && a.effects.keepAlert; });
    if (keepAlert) reviewed = null;                          // competitor on a main product is never "reviewed away"
    if (!decided.length && !reviewed) return null;

    var r = { riskDelta: null, priorityDelta: 0, actionEffect: 'keep', actionText: null, actionType: null,
              urgency: null, ackIds: [], priorityById: {}, decision: null, expiresAt: null, scope: null,
              reviewed: null };
    var newest = null;
    decided.forEach(function (a) {
      r.riskDelta = (r.riskDelta || 0) + a.effects.riskDelta;     // only real decisions replace feedback riskModifier
      r.priorityDelta += a.effects.priorityDelta;
      r.ackIds.push(a.id);
      r.priorityById[a.id] = a.effects.priorityDelta;
      if (!newest || String(a.createdAt) > String(newest.createdAt)) newest = a;
    });
    if (newest) {
      r.actionEffect = newest.effects.action;
      r.actionText = newest.effects.actionText;
      r.actionType = newest.effects.actionType;
      r.urgency = newest.effects.urgency || null;
      r.decision = newest.decision;
      r.expiresAt = newest.expiresAt;
      r.scope = newest.scope;
    }
    if (reviewed) {
      r.ackIds.push(reviewed.id);
      r.priorityDelta += reviewed.effects.priorityDelta;
      r.priorityById[reviewed.id] = reviewed.effects.priorityDelta;
      r.reviewed = { createdAt: reviewed.createdAt, expiresAt: reviewed.expiresAt, id: reviewed.id };
    }
    return r;
  }

  function applyAcksToSignals(signals, acks) {
    if (!signals) return null;
    if (!acks || !acks.length) return signals;
    try {
      for (var i = 0; i < signals.length; i++) {
        var s = signals[i];
        var eff = getAckEffectForSignal(s, acks);
        if (!eff) continue;
        if (eff.riskDelta !== null) s.ackRiskDelta = (s.ackRiskDelta || 0) + eff.riskDelta;
        s.ackPriorityDelta = (s.ackPriorityDelta || 0) + eff.priorityDelta;
        s.ackIds = eff.ackIds;
        s.ackPriorityById = Object.assign(s.ackPriorityById || {}, eff.priorityById);
        if (eff.decision) {
          s.ackDecision = eff.decision;
          s.ackExpiresAt = eff.expiresAt;
          s.ackScope = eff.scope;
          s.ackActionEffect = eff.actionEffect;
          s.ackUrgency = eff.urgency;
          if (eff.actionEffect === 'change_to') { s.ackActionText = eff.actionText; s.ackActionType = eff.actionType; }
        }
        if (eff.reviewed) s.ackReviewed = eff.reviewed;
      }
    } catch (e) { /* fail-open */ }
    return signals;
  }

  function reverseAck(ackId, reason) {
    try {
      for (var i = 0; i < _mem.length; i++) {
        var a = _mem[i];
        if (!a || a.id !== ackId) continue;
        if (a.status !== 'active') return false;
        a.status = 'reversed';
        a.reversedAt = _nowISO();
        a.reversedReason = reason || 'seller_reversal';
        _persist(a);
        _releaseWatchFor(a);
        return true;
      }
    } catch (e) { /* fail-open */ }
    return false;
  }

  // Called by watch_lifecycle.reverseWatchDecision: the Watch side was reversed, mirror it.
  function ackReverseForWatch(occurrenceId) {
    var n = 0;
    try {
      for (var i = 0; i < _mem.length; i++) {
        var a = _mem[i];
        if (!a || a.status !== 'active') continue;
        if (a.sourceId === occurrenceId || a.watchOccurrenceId === occurrenceId) {
          a.status = 'reversed';
          a.reversedAt = _nowISO();
          a.reversedReason = 'seller_reversal';
          _persist(a);
          n++;
        }
      }
    } catch (e) { /* best-effort */ }
    return n;
  }

  function expireAcks() {
    var n = 0;
    try {
      var now = Date.now();
      for (var i = 0; i < _mem.length; i++) {
        var a = _mem[i];
        if (!a || a.status !== 'active') continue;
        var exp = _parseISO(a.expiresAt);
        if (exp && exp.getTime() <= now) {
          a.status = 'expired';
          _persist(a);
          _releaseWatchFor(a);       // expiry and tombstone stay in step
          n++;
        }
      }
      if (n) console.info('expireAcks: expired', n);
    } catch (e) { /* fail-open */ }
    return n;
  }

  // A purchase of the family ends the premise of a suppress/defer decision.
  function reconcileAcksAfterInvoice(customerId, invoiceItems) {
    var out = { superseded: [] };
    try {
      if (!customerId || !Array.isArray(invoiceItems) || !invoiceItems.length) return out;
      var fams = Object.create(null);
      invoiceItems.forEach(function (it) {
        if (!it || !it.productId || !(Number(it.qty) > 0)) return;
        var f = _familyOf(it.productId);
        if (f != null) fams[f] = true;
      });
      for (var i = 0; i < _mem.length; i++) {
        var a = _mem[i];
        if (!a || a.status !== 'active' || a.customerId !== customerId || a.scope !== 'product') continue;
        if (a.decisionCategory !== 'suppress' && a.decisionCategory !== 'defer') continue;
        if (!fams[a.familyId]) continue;
        a.status = 'superseded';
        a.reversedAt = _nowISO();
        a.reversedReason = 'condition_cleared';
        a.note = (a.note ? a.note + ' | ' : '') + 'product purchased on invoice';
        _persist(a);
        _releaseWatchFor(a);
        out.superseded.push(a.id);
      }
    } catch (e) { /* fail-open */ }
    return out;
  }

  /* ---------- legacy migration (idempotent, additive) ---------- */

  function _hasAck(customerId, familyId, sourceId, decision, source) {
    for (var i = 0; i < _mem.length; i++) {
      var a = _mem[i];
      if (a && a.customerId === customerId && a.familyId === familyId && a.decision === decision &&
          a.source === source && (a.sourceId || null) === (sourceId || null) && a.legacyKey) return true;
    }
    return false;
  }

  function _legacyAck(p, stats) {
    // A legacy row without a valid date cannot be dated; it must never become a brand-new live ACK
    // (createAck would otherwise fall back to "now" and give it a future expiry).
    if (!p.createdAt || !_parseISO(p.createdAt)) {
      stats.skipped++;
      return;
    }
    var decision = normalizeDecision(p.decision);
    if (!p.customerId || !decision) { stats.skipped++; return; }
    var fam = _familyOf(p.productId);
    var legacyKey = p.legacyKey;
    for (var i = 0; i < _mem.length; i++) if (_mem[i] && _mem[i].legacyKey === legacyKey) { stats.skipped++; return; }
    var ack = createAck({
      customerId: p.customerId, productId: p.productId, familyId: fam,
      scope: fam ? 'product' : 'account', decision: decision,
      source: 'legacy_migration', sourceId: p.sourceId || null,
      sourceContext: { legacySource: p.legacySource },
      note: p.note, createdAt: p.createdAt, stockSource: p.stockSource, supersedeExisting: false
    });
    if (!ack) { stats.errors++; return; }
    ack.legacyKey = legacyKey;
    ack.legacySource = p.legacySource;
    // Legacy rows replay history: older decisions never shadow newer ones.
    _persist(ack);
    stats.migrated++;
  }

  function migrateLegacyAcknowledgments(opts) {
    opts = opts || {};
    var stats = { migrated: 0, skipped: 0, errors: 0 };
    try {
      if (_migrating) return stats;
      if (isAckLayerActive() && !opts.force) return stats;
      _migrating = true;
      try { localStorage.setItem(ACK_PARAMS.migratingKey, String(Date.now())); } catch (e) { /* ignore */ }
      var total = 0;
      var t0 = _watchSyncDepth;
      _watchSyncDepth++;               // legacy replay must NOT re-touch Watch tombstones
      try {
        // 1) seller_feedback
        var fbRows = [];
        try { fbRows = JSON.parse(localStorage.getItem('bagheri_intelligence_seller_feedback') || '[]') || []; } catch (e1) { fbRows = []; }
        fbRows.forEach(function (f) {
          total++;
          try {
            _legacyAck({ legacyKey: 'fb:' + f.id, legacySource: 'feedback', customerId: f.customerId, productId: f.productId,
              decision: f.reasonCode, note: f.comment, createdAt: f.createdAt, sourceId: null }, stats);
          } catch (e) { stats.errors++; }
        });
        // 2) watch occurrences with a seller reason / decision
        var wmap = {};
        try { wmap = JSON.parse(localStorage.getItem('bagheri_watch_occurrences_v1') || '{}') || {}; } catch (e2) { wmap = {}; }
        Object.keys(wmap).forEach(function (k) {
          var r = wmap[k];
          if (!r || !r.id) return;
          var code = (r.suppression && r.suppression.type) || (r.reason && r.reason.code) || null;
          if (!code) return;
          total++;
          try {
            _legacyAck({ legacyKey: 'watch:' + r.id, legacySource: 'watch', customerId: r.customerId, productId: r.productId,
              decision: code, note: r.reason && r.reason.comment, sourceId: r.id,
              createdAt: (r.suppression && r.suppression.decidedAt) || (r.reason && r.reason.recordedAt) }, stats);
          } catch (e) { stats.errors++; }
        });
        // 3) visits (rejected offers)
        var custs = (typeof data !== 'undefined' && data && Array.isArray(data.customers)) ? data.customers : [];
        custs.forEach(function (c) {
          (c && Array.isArray(c.visits) ? c.visits : []).forEach(function (v) {
            (v && Array.isArray(v.offeredProducts) ? v.offeredProducts : []).forEach(function (op) {
              if (!op || op.reaction !== 'rejected' || !op.rejectionReason) return;
              total++;
              try {
                _legacyAck({ legacyKey: 'visit:' + (v.id || v.date) + ':' + op.productId, legacySource: 'visit', customerId: c.id,
                  productId: op.productId, decision: op.rejectionReason, stockSource: op.stockSource || null, sourceId: v.id || null,
                  createdAt: (v.date || '') + 'T' + (v.time || '00:00') + ':00' }, stats);
              } catch (e) { stats.errors++; }
            });
          });
        });
      } finally { _watchSyncDepth = t0; }
      var failRatio = total ? stats.errors / total : 0;
      if (failRatio <= 0.5) {
        try {
          localStorage.setItem(ACK_PARAMS.migratedKey, String(Date.now()));
          localStorage.removeItem(ACK_PARAMS.migratingKey);
        } catch (e3) { /* ignore */ }
      } else {
        _warn('migrateLegacyAcknowledgments: >50% errors, flag not set', stats);
      }
    } catch (e) {
      console.error('migrateLegacyAcknowledgments failed', e);
      stats.errors++;
    } finally { _migrating = false; }
    return stats;
  }

  /* ---------- backup helpers ---------- */

  function exportAcks() { return _mem.slice(); }

  function replaceAllAcks(rows) {
    _mem = Array.isArray(rows) ? rows.filter(function (r) { return r && r.id; }) : [];
    _saveLS();
    if (_idb && _idb.objectStoreNames.contains(ACK_PARAMS.idbStore)) {
      try {
        var tx = _idb.transaction(ACK_PARAMS.idbStore, 'readwrite');
        var st = tx.objectStore(ACK_PARAMS.idbStore);
        st.clear();
        _mem.forEach(function (r) { st.put(r); });
      } catch (e) { /* LS mirror authoritative */ }
    }
  }

  /* ---------- small UI helper (customer + watch pages) ---------- */

  var DECISION_LABELS = {
    still_stock: 'هنوز موجودی دارد', no_need: 'فعلاً نیاز ندارد', not_wanted: 'این محصول را نمی‌خواهد',
    follow_up_later: 'بعداً پیگیری شود', price: 'مشکل قیمت', competitor: 'خرید از رقیب',
    quality: 'مشکل کیفیت', other: 'سایر', dismiss: 'نادیده گرفته شد', unavailable: 'موجودی ما کافی نبود', visit_reviewed: 'ویزیت بررسی شد'
  };

  function _esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function ackListHtml(customerId, familyId) {
    var acks = getActiveAcksForCustomer(customerId, familyId != null ? { familyId: familyId } : null);
    if (!acks.length) return '';
    var rows = acks.map(function (a) {
      var pname = '';
      if (a.productId && typeof data !== 'undefined' && data && Array.isArray(data.products)) {
        var p = data.products.find(function (x) { return x && x.id === a.productId; });
        if (p && p.name) pname = p.name;
      }
      var exp = a.expiresAt ? String(a.expiresAt).slice(0, 10) : '';
      var expTxt = exp ? (typeof faDate === 'function' ? faDate(exp) : exp) : '';
      var cr = a.createdAt ? String(a.createdAt).slice(0, 10) : '';
      var crTxt = cr ? (typeof faDate === 'function' ? faDate(cr) : cr) : '';
      return '<div class="ack-row" style="display:flex;align-items:center;gap:8px;justify-content:space-between;padding:6px 0;">' +
        '<span class="ack-text" style="font-size:0.88rem;">' + _esc(DECISION_LABELS[a.decision] || a.decision) +
        (pname ? ' — ' + _esc(pname) : '') +
        '<br><span class="sub">ثبت: ' + _esc(crTxt) + (expTxt ? ' · انقضا: ' + _esc(expTxt) : '') + '</span></span>' +
        '<button type="button" class="btn small secondary" data-ack-reverse="' + _esc(a.id) + '">لغو تصمیم ثبت‌شده</button></div>';
    }).join('');
    return '<div class="ack-card" data-ack-card="1" style="border:1px solid var(--border);border-radius:10px;padding:8px 12px;margin:8px 0;">' +
      '<div style="font-size:0.9rem;font-weight:500;">تصمیم‌های ثبت‌شده فروشنده</div>' + rows + '</div>';
  }

  function bindAckReverse(root, onDone) {
    if (!root || !root.querySelectorAll) return;
    root.querySelectorAll('[data-ack-reverse]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (btn.disabled) return;
        btn.disabled = true;
        var ok = reverseAck(btn.getAttribute('data-ack-reverse'), 'seller_reversal');
        if (typeof showToast === 'function') showToast(ok ? 'تصمیم لغو شد' : 'لغو انجام نشد');
        if (typeof onDone === 'function') onDone(ok);
      });
    });
  }

  /* ---------- boot ---------- */

  _loadLS();
  _openIdb(function (db) { if (db) _idbHydrate(function () {}); });

  global.ACK_PARAMS = ACK_PARAMS;
  global.AFFECT_TABLE = AFFECT_TABLE;
  global.ACK_IMMEDIATE_CATEGORIES = ACK_IMMEDIATE_CATEGORIES;
  global.ackNormalizeDecision = normalizeDecision;
  global.computeAckExpiresAt = computeAckExpiresAt;
  global.createAck = createAck;
  global.getActiveAcksForCustomer = getActiveAcksForCustomer;
  global.getAckEffectForSignal = getAckEffectForSignal;
  global.applyAcksToSignals = applyAcksToSignals;
  global.reverseAck = reverseAck;
  global.expireAcks = expireAcks;
  global.ackReverseForWatch = ackReverseForWatch;
  global.reconcileAcksAfterInvoice = reconcileAcksAfterInvoice;
  global.migrateLegacyAcknowledgments = migrateLegacyAcknowledgments;
  global.isAckLayerActive = isAckLayerActive;
  global.ackWatchSyncActive = ackWatchSyncActive;
  global.exportAcks = exportAcks;
  global.replaceAllAcks = replaceAllAcks;
  global.ackListHtml = ackListHtml;
  global.bindAckReverse = bindAckReverse;
  global.ensureAckStores = _ensureStores;
  global.ACK_DECISION_LABELS = DECISION_LABELS;   // single source of the Persian decision wording (UI reads this)

})(typeof window !== 'undefined' ? window : this);
