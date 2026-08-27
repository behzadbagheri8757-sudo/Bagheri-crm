/**
 * Sales Game Center — V1 Core Logic
 * ---------------------------------
 * Persistence (gameMeta / gameLedger) + Ledger (claim/reverse) + Derived Stats
 *
 * این ماژول هیچ UI، Route، Nav یا Hook روی mutationهای CRM ندارد.
 * CRM = Source of Truth | Game = Derived Consumer Layer
 *
 * وابستگی‌های سراسری مورد انتظار (از پروژه موجود):
 *   GAME_CONFIG, dbGet, dbPut, data, prospectState,
 *   todayISO, getMonthlySalesTarget, commandCenterMetrics, customerInvoices
 *
 * هیچ منطق مالی / FIFO / موجودی را تغییر نمی‌دهد.
 */
(function (global) {
  'use strict';

  // ====================================================================
  // Helpers
  // ====================================================================

  function _cfg() {
    if (typeof GAME_CONFIG === 'undefined' || !GAME_CONFIG) {
      throw new Error('GAME_CONFIG is not loaded');
    }
    return GAME_CONFIG;
  }

  function _uid() {
    if (typeof uid === 'function') return uid();
    return 'g_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 9);
  }

  function _today() {
    if (typeof todayISO === 'function') return todayISO();
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  /** Extract YYYY-MM-DD from various date shapes (Gregorian local or ISO timestamp). */
  function _dateOnly(raw) {
    if (!raw) return '';
    const s = String(raw).trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    try {
      const d = new Date(s);
      if (!isNaN(d.getTime())) {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return y + '-' + m + '-' + day;
      }
    } catch (e) { /* ignore */ }
    return '';
  }

  function _parseYMD(iso) {
    const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    return { y: +m[1], m: +m[2], d: +m[3] };
  }

  /** Local weekday: 0=Sun … 5=Fri … 6=Sat */
  function _weekdayOfISO(iso) {
    const p = _parseYMD(iso);
    if (!p) return null;
    return new Date(p.y, p.m - 1, p.d).getDay();
  }

  function _isRestDay(iso) {
    const cfg = _cfg();
    const wd = _weekdayOfISO(iso);
    return wd === (cfg.continuity && cfg.continuity.restWeekday);
  }

  /** Previous calendar day YYYY-MM-DD (local). */
  function _prevDay(iso) {
    const p = _parseYMD(iso);
    if (!p) return null;
    const d = new Date(p.y, p.m - 1, p.d);
    d.setDate(d.getDate() - 1);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function _monthKeyFromMetrics() {
    if (typeof commandCenterMetrics === 'function') {
      const m = commandCenterMetrics(new Date());
      if (m && m.jy && m.jm) {
        return 'j' + m.jy + '-' + String(m.jm).padStart(2, '0');
      }
    }
    const t = _today();
    return t.slice(0, 7);
  }

  // ====================================================================
  // Persistence
  // ====================================================================

  function _metaKey() { return _cfg().storage.metaKey; }
  function _ledgerKey() { return _cfg().storage.ledgerKey; }

  function _defaultMeta() {
    return {
      schemaVersion: 1,
      lastActiveDate: null,
      currentStreak: 0,
      bestStreak: 0,
      monthlyTargetClaimedFor: null,
      dailyQuestTargets: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
  }

  /**
   * dbGet returns {key, value} shape from baqeriDB store.
   */
  async function _readRaw(key) {
    if (typeof dbGet !== 'function') {
      console.warn('[game] dbGet unavailable');
      return null;
    }
    try {
      const row = await dbGet(key);
      if (row == null) return null;
      if (row && typeof row === 'object' && 'value' in row) return row.value;
      return row;
    } catch (e) {
      console.warn('[game] dbGet failed', key, e);
      return null;
    }
  }

  async function _writeRaw(key, value) {
    if (typeof dbPut !== 'function') {
      console.warn('[game] dbPut unavailable');
      return false;
    }
    try {
      await dbPut(key, value);
      return true;
    } catch (e) {
      console.warn('[game] dbPut failed', key, e);
      return false;
    }
  }

  async function gameLoadMeta() {
    const raw = await _readRaw(_metaKey());
    if (!raw || typeof raw !== 'object') {
      const meta = _defaultMeta();
      await _writeRaw(_metaKey(), meta);
      return meta;
    }
    // light migration
    if (!raw.schemaVersion) raw.schemaVersion = 1;
    if (typeof raw.currentStreak !== 'number') raw.currentStreak = 0;
    if (typeof raw.bestStreak !== 'number') raw.bestStreak = 0;
    if (raw.lastActiveDate === undefined) raw.lastActiveDate = null;
    if (raw.monthlyTargetClaimedFor === undefined) raw.monthlyTargetClaimedFor = null;
    if (raw.dailyQuestTargets === undefined) raw.dailyQuestTargets = null;
    return raw;
  }

  async function gameSaveMeta(meta) {
    meta.updatedAt = new Date().toISOString();
    await _writeRaw(_metaKey(), meta);
    return meta;
  }

  async function gameLoadLedger() {
    const raw = await _readRaw(_ledgerKey());
    if (!Array.isArray(raw)) {
      await _writeRaw(_ledgerKey(), []);
      return [];
    }
    return raw;
  }

  async function gameSaveLedger(ledger) {
    await _writeRaw(_ledgerKey(), ledger);
    return ledger;
  }

  /** Full reset of game state (does not touch CRM). */
  async function gameReset() {
    const meta = _defaultMeta();
    await _writeRaw(_metaKey(), meta);
    await _writeRaw(_ledgerKey(), []);
    return { meta: meta, ledger: [] };
  }

  // ====================================================================
  // Ledger: claim / reverse / totals
  // ====================================================================

  function _activeEntries(ledger) {
    return (ledger || []).filter(function (e) { return e && !e.reversed; });
  }

  function gameHasClaim(ledger, key) {
    return _activeEntries(ledger).some(function (e) { return e.key === key; });
  }

  function gameFindEntry(ledger, key) {
    for (var i = ledger.length - 1; i >= 0; i--) {
      if (ledger[i] && ledger[i].key === key) return ledger[i];
    }
    return null;
  }

  /**
   * Claim XP once for a unique key.
   * @returns {{ok:boolean, entry?:object, reason?:string}}
   */
  async function gameClaim(opts) {
    const key = opts && opts.key;
    const type = opts && opts.type;
    const xp = Number(opts && opts.xp) || 0;
    const entityId = (opts && opts.entityId) != null ? String(opts.entityId) : '';
    const date = (opts && opts.date) || _today();

    if (!key) return { ok: false, reason: 'missing_key' };
    if (xp <= 0) return { ok: false, reason: 'non_positive_xp' };

    const ledger = await gameLoadLedger();
    if (gameHasClaim(ledger, key)) {
      return { ok: false, reason: 'already_claimed', entry: gameFindEntry(ledger, key) };
    }

    const entry = {
      id: _uid(),
      key: key,
      type: type || 'unknown',
      entityId: entityId,
      xp: xp,
      date: _dateOnly(date) || _today(),
      createdAt: new Date().toISOString(),
      reversed: false
    };
    ledger.push(entry);
    await gameSaveLedger(ledger);
    return { ok: true, entry: entry };
  }

  /**
   * Reverse a previously claimed reward by key.
   * Does not remove the row — marks reversed so history remains auditable.
   */
  async function gameReverse(key) {
    if (!key) return { ok: false, reason: 'missing_key' };
    const ledger = await gameLoadLedger();
    const entry = gameFindEntry(ledger, key);
    if (!entry) return { ok: false, reason: 'not_found' };
    if (entry.reversed) return { ok: false, reason: 'already_reversed', entry: entry };
    entry.reversed = true;
    entry.reversedAt = new Date().toISOString();
    await gameSaveLedger(ledger);
    return { ok: true, entry: entry };
  }

  function gameTotalXp(ledger) {
    return _activeEntries(ledger).reduce(function (s, e) { return s + (Number(e.xp) || 0); }, 0);
  }

  function gameXpOnDate(ledger, date) {
    const d = _dateOnly(date) || _today();
    return _activeEntries(ledger).filter(function (e) { return e.date === d; })
      .reduce(function (s, e) { return s + (Number(e.xp) || 0); }, 0);
  }

  // ====================================================================
  // Derived stats from CRM + ProspectScout
  // ====================================================================

  function _crmData() {
    return (typeof data !== 'undefined' && data) ? data : { customers: [], invoices: [], payments: [] };
  }

  function _prospectShops() {
    if (typeof prospectState !== 'undefined' && prospectState && Array.isArray(prospectState.shops)) {
      return prospectState.shops;
    }
    return [];
  }

  function _rewardPaymentMethods() {
    const cfg = _cfg();
    return (cfg.payment && cfg.payment.rewardMethods) || ['cash', 'card', 'transfer'];
  }

  /**
   * Count real CRM/Prospect activity for a local calendar day.
   * Pure derived — does not write ledger.
   */
  function gameDeriveDayCounts(dateISO) {
    const day = _dateOnly(dateISO) || _today();
    const d = _crmData();
    const methods = _rewardPaymentMethods();

    let evaluation = 0;
    _prospectShops().forEach(function (shop) {
      (shop.visits || []).forEach(function (v) {
        if (_dateOnly(v.date) === day) evaluation++;
      });
    });

    let customerVisit = 0;
    (d.customers || []).forEach(function (c) {
      (c.visits || []).forEach(function (v) {
        if (_dateOnly(v.date) === day) customerVisit++;
      });
    });

    let invoice = 0;
    (d.invoices || []).forEach(function (inv) {
      if (_dateOnly(inv.date) === day) invoice++;
    });

    let payment = 0;
    (d.payments || []).forEach(function (p) {
      if (_dateOnly(p.date) === day && methods.indexOf(p.method) >= 0) payment++;
    });

    return {
      date: day,
      evaluation: evaluation,
      customerVisit: customerVisit,
      invoice: invoice,
      payment: payment,
      totalValid: evaluation + customerVisit + invoice + payment
    };
  }

  /**
   * Qualified conversions: customers linked from prospect with >= minInvoices invoices.
   * Returns list of { customerId, prospectShopId, invoiceCount }.
   */
  function gameDeriveQualifiedConversions() {
    const cfg = _cfg();
    const minInv = (cfg.conversion && cfg.conversion.minInvoicesForReward) || 2;
    const d = _crmData();
    const out = [];
    (d.customers || []).forEach(function (c) {
      if (!c.prospectShopId) return;
      var invCount;
      if (typeof customerInvoices === 'function') {
        invCount = customerInvoices(c.id).length;
      } else {
        invCount = (d.invoices || []).filter(function (i) { return i.customerId === c.id; }).length;
      }
      if (invCount >= minInv) {
        out.push({
          customerId: c.id,
          prospectShopId: c.prospectShopId,
          invoiceCount: invCount
        });
      }
    });
    return out;
  }

  function gameDeriveMonthlyTarget() {
    var target = 0;
    if (typeof getMonthlySalesTarget === 'function') {
      target = Number(getMonthlySalesTarget()) || 0;
    }
    var mtdSales = 0;
    var monthKey = _monthKeyFromMetrics();
    if (typeof commandCenterMetrics === 'function') {
      var m = commandCenterMetrics(new Date());
      mtdSales = Number(m && m.mtdSales) || 0;
    }
    return {
      monthKey: monthKey,
      target: target,
      mtdSales: mtdSales,
      reached: target > 0 && mtdSales >= target,
      ratio: target > 0 ? Math.min(1, mtdSales / target) : 0
    };
  }

  /**
   * Daily quest progress derived from real counts (config targets).
   */
  /**
   * True daily-random targets. The random draw happens only when a date has
   * no persisted target set yet; after that, every render/reload returns the
   * exact same targets for that calendar day.
   *
   * We deliberately do NOT derive targets from the date. That would be
   * deterministic rather than random.
   */
  var _dailyTargetPromises = Object.create(null);

  function _secureRandomInt(min, max) {
    min = Math.ceil(Math.max(0, Number(min) || 0));
    max = Math.floor(Math.max(min, Number(max) || min));
    if (max <= min) return min;

    // Rejection sampling avoids modulo bias when crypto is available.
    if (typeof crypto !== 'undefined' && crypto && typeof crypto.getRandomValues === 'function') {
      var range = max - min + 1;
      var limit = Math.floor(0x100000000 / range) * range;
      var buf = new Uint32Array(1);
      var n;
      do {
        crypto.getRandomValues(buf);
        n = buf[0];
      } while (n >= limit);
      return min + (n % range);
    }

    // Fallback for very old/limited environments. Still non-deterministic.
    return min + Math.floor(Math.random() * (max - min + 1));
  }

  async function _ensureDailyQuestTargets(day) {
    if (_dailyTargetPromises[day]) return _dailyTargetPromises[day];

    _dailyTargetPromises[day] = (async function () {
      var meta = await gameLoadMeta();
      var stored = meta.dailyQuestTargets;
      if (stored && stored.date === day && stored.targets && typeof stored.targets === 'object') {
        return stored.targets;
      }

      var targets = {};
      (_cfg().dailyQuests || []).forEach(function (q) {
        var minT = q.min != null ? Number(q.min) : Number(q.target) || 0;
        var maxT = q.max != null ? Number(q.max) : minT;
        targets[q.id] = _secureRandomInt(minT, maxT);
      });

      // Persist the complete set as one object so the three missions are born
      // together and stay fixed until the next calendar day.
      meta.dailyQuestTargets = {
        date: day,
        targets: targets,
        generatedAt: new Date().toISOString(),
        randomSource: (typeof crypto !== 'undefined' && crypto && typeof crypto.getRandomValues === 'function')
          ? 'crypto.getRandomValues' : 'Math.random-fallback'
      };
      await gameSaveMeta(meta);
      return targets;
    })();

    try {
      return await _dailyTargetPromises[day];
    } finally {
      delete _dailyTargetPromises[day];
    }
  }

  /**
   * Daily quest progress. Targets are persisted per calendar day.
   * The function is synchronous by design for existing callers; use
   * gameGetSnapshot/gameMaybeClaimDailyQuests, which hydrate the daily target
   * set before deriving quests.
   */
  function gameDeriveDailyQuests(dateISO, targetSet) {
    const cfg = _cfg();
    const day = _dateOnly(dateISO) || _today();
    const counts = gameDeriveDayCounts(day);
    const quests = (cfg.dailyQuests || []).map(function (q) {
      var current = 0;
      if (q.type === 'evaluation') current = counts.evaluation;
      else if (q.type === 'customerVisit') current = counts.customerVisit;
      else if (q.type === 'invoice') current = counts.invoice;

      var minT = q.min != null ? Number(q.min) : Number(q.target) || 0;
      var maxT = q.max != null ? Number(q.max) : minT;
      var target = targetSet && targetSet[q.id] != null
        ? Number(targetSet[q.id])
        : minT;
      target = Math.min(maxT, Math.max(minT, target));

      return {
        id: q.id,
        label: q.label,
        type: q.type,
        target: target,
        current: current,
        complete: target > 0 && current >= target
      };
    });
    const allComplete = quests.length > 0 && quests.every(function (q) { return q.complete; });
    return { date: day, quests: quests, allComplete: allComplete };
  }

  async function gameGetDailyQuests(dateISO) {
    const day = _dateOnly(dateISO) || _today();
    const targets = await _ensureDailyQuestTargets(day);
    return gameDeriveDailyQuests(day, targets);
  }

  /**
   * Active day? totalValid >= minValidActivities
   */
  function gameIsActiveDay(dateISO) {
    const cfg = _cfg();
    const min = (cfg.continuity && cfg.continuity.minValidActivities) || 5;
    const counts = gameDeriveDayCounts(dateISO);
    return {
      date: counts.date,
      active: counts.totalValid >= min,
      totalValid: counts.totalValid,
      minRequired: min,
      counts: counts
    };
  }

  // ====================================================================
  // Continuity (streak) — uses meta + derived active days
  // ====================================================================

  /**
   * Recompute streak walking backward from today using derived Active Days.
   * Friday (rest day) is skipped and does not break the chain.
   * Updates meta.lastActiveDate / currentStreak / bestStreak.
   */
  async function gameRecomputeContinuity(optDate) {
    const cfg = _cfg();
    const today = _dateOnly(optDate) || _today();
    const meta = await gameLoadMeta();
    const min = (cfg.continuity && cfg.continuity.minValidActivities) || 5;

    // Walk back up to ~60 calendar days to rebuild streak (cheap counts)
    var streak = 0;
    var cursor = today;
    var guard = 0;
    var lastActive = null;

    // A streak represents completed active days. If today is not active yet,
    // do not erase yesterday's completed streak just because today's work is
    // still in progress. Once today becomes active it is included.
    // Friday/rest day is skipped and never breaks the chain.
    while (guard < 90) {
      guard++;
      if (_isRestDay(cursor)) {
        cursor = _prevDay(cursor);
        if (!cursor) break;
        continue;
      }
      var counts = gameDeriveDayCounts(cursor);
      if (counts.totalValid >= min) {
        streak++;
        if (!lastActive) lastActive = cursor;
        cursor = _prevDay(cursor);
        if (!cursor) break;
      } else {
        // Today may simply be unfinished. Preserve the chain already completed
        // through the previous calendar day; for an older missed day this ends it.
        if (cursor === today) {
          cursor = _prevDay(cursor);
          if (!cursor) break;
          continue;
        }
        break;
      }
    }

    meta.currentStreak = streak;
    if (lastActive) meta.lastActiveDate = lastActive;
    if (streak > (meta.bestStreak || 0)) meta.bestStreak = streak;
    await gameSaveMeta(meta);

    return {
      currentStreak: meta.currentStreak,
      bestStreak: meta.bestStreak,
      lastActiveDate: meta.lastActiveDate,
      todayActive: gameIsActiveDay(today).active
    };
  }

  /**
   * Continuity XP for a given active day (idempotent via ledger key).
   * Formula: base + min(streakAtClaim, maxDays) * perDay
   * Note: call after recompute so streak is current.
   */
  async function gameMaybeClaimContinuity(dateISO) {
    const cfg = _cfg();
    const day = _dateOnly(dateISO) || _today();
    if (_isRestDay(day)) {
      return { ok: false, reason: 'rest_day' };
    }
    const active = gameIsActiveDay(day);
    if (!active.active) {
      return { ok: false, reason: 'not_active' };
    }

    const prefixes = cfg.ledgerKeys || {};
    const key = (prefixes.continuity || 'continuity') + ':' + day;

    const meta = await gameLoadMeta();
    const streak = Math.max(1, Number(meta.currentStreak) || 1);
    const base = Number(cfg.xp.continuityBase) || 0;
    const per = Number(cfg.xp.continuityPerStreakDay) || 0;
    const maxDays = Number(cfg.xp.continuityMaxStreakBonusDays) || 0;
    const bonusDays = Math.min(Math.max(streak - 1, 0), maxDays);
    const xp = base + bonusDays * per;

    return gameClaim({
      key: key,
      type: 'continuity',
      entityId: day,
      xp: xp,
      date: day
    });
  }

  // ====================================================================
  // Quest claims (idempotent)
  // ====================================================================

  async function gameMaybeClaimDailyQuests(dateISO) {
    const cfg = _cfg();
    const day = _dateOnly(dateISO) || _today();
    const derived = await gameGetDailyQuests(day);
    const prefixes = cfg.ledgerKeys || {};
    const results = [];

    for (var i = 0; i < derived.quests.length; i++) {
      var q = derived.quests[i];
      if (!q.complete) {
        results.push({ questId: q.id, ok: false, reason: 'incomplete' });
        continue;
      }
      var key = (prefixes.dailyQuest || 'dailyQuest') + ':' + day + ':' + q.id;
      var r = await gameClaim({
        key: key,
        type: 'dailyQuest',
        entityId: q.id,
        xp: Number(cfg.xp.dailyQuestEach) || 0,
        date: day
      });
      results.push({ questId: q.id, claim: r });
    }

    var allResult = null;
    if (derived.allComplete) {
      var allKey = (prefixes.dailyAll || 'dailyAll') + ':' + day;
      allResult = await gameClaim({
        key: allKey,
        type: 'dailyAll',
        entityId: day,
        xp: Number(cfg.xp.dailyQuestAllBonus) || 0,
        date: day
      });
    }

    return { date: day, quests: results, allBonus: allResult };
  }

  // ====================================================================
  // Event claim helpers (for future hooks — safe to call; no-op if duplicate)
  // ====================================================================

  async function gameOnEvaluation(shopId, visitId, dateISO) {
    const cfg = _cfg();
    const prefixes = cfg.ledgerKeys || {};
    const key = (prefixes.evaluation || 'eval') + ':' + shopId + ':' + visitId;
    return gameClaim({
      key: key,
      type: 'evaluation',
      entityId: String(shopId) + ':' + String(visitId),
      xp: Number(cfg.xp.evaluation) || 0,
      date: dateISO || _today()
    });
  }

  async function gameOnCustomerVisit(customerId, visitId, dateISO) {
    const cfg = _cfg();
    const prefixes = cfg.ledgerKeys || {};
    const key = (prefixes.customerVisit || 'visit') + ':' + customerId + ':' + visitId;
    return gameClaim({
      key: key,
      type: 'customerVisit',
      entityId: String(customerId) + ':' + String(visitId),
      xp: Number(cfg.xp.customerVisit) || 0,
      date: dateISO || _today()
    });
  }

  async function gameOnInvoice(invoiceId, dateISO) {
    const cfg = _cfg();
    const prefixes = cfg.ledgerKeys || {};
    const key = (prefixes.invoice || 'invoice') + ':' + invoiceId;
    return gameClaim({
      key: key,
      type: 'invoice',
      entityId: String(invoiceId),
      xp: Number(cfg.xp.invoice) || 0,
      date: dateISO || _today()
    });
  }

  async function gameOnPayment(paymentId, method, dateISO) {
    const cfg = _cfg();
    const methods = _rewardPaymentMethods();
    if (methods.indexOf(method) < 0) {
      return { ok: false, reason: 'method_not_rewarded' };
    }
    const prefixes = cfg.ledgerKeys || {};
    const key = (prefixes.payment || 'payment') + ':' + paymentId;
    return gameClaim({
      key: key,
      type: 'payment',
      entityId: String(paymentId),
      xp: Number(cfg.xp.payment) || 0,
      date: dateISO || _today()
    });
  }

  /**
   * Claim conversion for qualified customers not yet rewarded.
   * Idempotent per customerId (or prospectShopId).
   */
  async function gameMaybeClaimConversions() {
    const cfg = _cfg();
    const prefixes = cfg.ledgerKeys || {};
    const list = gameDeriveQualifiedConversions();
    const out = [];
    for (var i = 0; i < list.length; i++) {
      var item = list[i];
      var key = (prefixes.conversion || 'conversion') + ':' + item.customerId;
      var r = await gameClaim({
        key: key,
        type: 'conversion',
        entityId: item.customerId,
        xp: Number(cfg.xp.qualifiedConversion) || 0,
        date: _today()
      });
      out.push({ customerId: item.customerId, prospectShopId: item.prospectShopId, claim: r });
    }
    return out;
  }

  async function gameMaybeClaimMonthlyTarget() {
    const cfg = _cfg();
    const mt = gameDeriveMonthlyTarget();
    if (!mt.reached) {
      return { ok: false, reason: 'target_not_reached', monthly: mt };
    }
    const meta = await gameLoadMeta();
    if (meta.monthlyTargetClaimedFor === mt.monthKey) {
      return { ok: false, reason: 'already_claimed_meta', monthly: mt };
    }
    const prefixes = cfg.ledgerKeys || {};
    const key = (prefixes.monthlyTarget || 'monthlyTarget') + ':' + mt.monthKey;
    const r = await gameClaim({
      key: key,
      type: 'monthlyTarget',
      entityId: mt.monthKey,
      xp: Number(cfg.xp.monthlySalesTarget) || 0,
      date: _today()
    });
    if (r.ok) {
      meta.monthlyTargetClaimedFor = mt.monthKey;
      await gameSaveMeta(meta);
    }
    return { claim: r, monthly: mt };
  }

  /**
   * Reverse invoice XP when CRM deletes an invoice (to be called from future hook).
   */
  async function gameOnInvoiceDeleted(invoiceId) {
    const cfg = _cfg();
    const prefixes = cfg.ledgerKeys || {};
    const key = (prefixes.invoice || 'invoice') + ':' + invoiceId;
    return gameReverse(key);
  }

  async function gameOnPaymentDeleted(paymentId) {
    const cfg = _cfg();
    const prefixes = cfg.ledgerKeys || {};
    const key = (prefixes.payment || 'payment') + ':' + paymentId;
    return gameReverse(key);
  }

  // ====================================================================
  // Snapshot for future UI (morning / evening)
  // ====================================================================

  /**
   * Full derived + ledger snapshot for a day. Safe to call anytime.
   * Does not auto-claim (callers decide); optional autoClaim flag.
   */
  async function gameGetSnapshot(opts) {
    opts = opts || {};
    const day = _dateOnly(opts.date) || _today();
    const autoClaim = !!opts.autoClaim;

    await gameRecomputeContinuity(day);

    if (autoClaim) {
      await gameMaybeClaimDailyQuests(day);
      await gameMaybeClaimContinuity(day);
      await gameMaybeClaimConversions();
      await gameMaybeClaimMonthlyTarget();
    }

    const ledger = await gameLoadLedger();
    const meta = await gameLoadMeta();
    const counts = gameDeriveDayCounts(day);
    const quests = await gameGetDailyQuests(day);
    const monthly = gameDeriveMonthlyTarget();
    const active = gameIsActiveDay(day);

    return {
      date: day,
      isRestDay: _isRestDay(day),
      counts: counts,
      activeDay: active,
      quests: quests,
      monthly: monthly,
      continuity: {
        currentStreak: meta.currentStreak,
        bestStreak: meta.bestStreak,
        lastActiveDate: meta.lastActiveDate,
        todayActive: active.active
      },
      xp: {
        total: gameTotalXp(ledger),
        today: gameXpOnDate(ledger, day)
      },
      meta: meta,
      ledgerCount: ledger.length,
      activeLedgerCount: _activeEntries(ledger).length
    };
  }

  // ====================================================================
  // Public API
  // ====================================================================

  const GameLogic = {
    // persistence
    loadMeta: gameLoadMeta,
    saveMeta: gameSaveMeta,
    loadLedger: gameLoadLedger,
    saveLedger: gameSaveLedger,
    reset: gameReset,

    // ledger
    claim: gameClaim,
    reverse: gameReverse,
    hasClaim: function (ledger, key) { return gameHasClaim(ledger, key); },
    totalXp: gameTotalXp,
    xpOnDate: gameXpOnDate,

    // derived
    deriveDayCounts: gameDeriveDayCounts,
    deriveDailyQuests: gameDeriveDailyQuests,
    getDailyQuests: gameGetDailyQuests,
    deriveQualifiedConversions: gameDeriveQualifiedConversions,
    deriveMonthlyTarget: gameDeriveMonthlyTarget,
    isActiveDay: gameIsActiveDay,

    // continuity / claims
    recomputeContinuity: gameRecomputeContinuity,
    maybeClaimContinuity: gameMaybeClaimContinuity,
    maybeClaimDailyQuests: gameMaybeClaimDailyQuests,
    maybeClaimConversions: gameMaybeClaimConversions,
    maybeClaimMonthlyTarget: gameMaybeClaimMonthlyTarget,

    // event helpers (for Phase 3 hooks)
    onEvaluation: gameOnEvaluation,
    onCustomerVisit: gameOnCustomerVisit,
    onInvoice: gameOnInvoice,
    onPayment: gameOnPayment,
    onInvoiceDeleted: gameOnInvoiceDeleted,
    onPaymentDeleted: gameOnPaymentDeleted,

    // snapshot
    getSnapshot: gameGetSnapshot
  };

  global.GameLogic = GameLogic;

  // Also expose individual functions for optional direct use
  global.gameLoadMeta = gameLoadMeta;
  global.gameLoadLedger = gameLoadLedger;
  global.gameClaim = gameClaim;
  global.gameReverse = gameReverse;
  global.gameGetSnapshot = gameGetSnapshot;
  global.gameReset = gameReset;
  global.gameOnEvaluation = gameOnEvaluation;
  global.gameOnCustomerVisit = gameOnCustomerVisit;
  global.gameOnInvoice = gameOnInvoice;
  global.gameOnPayment = gameOnPayment;
  global.gameOnInvoiceDeleted = gameOnInvoiceDeleted;
  global.gameOnPaymentDeleted = gameOnPaymentDeleted;
  global.gameDeriveDayCounts = gameDeriveDayCounts;
  global.gameDeriveDailyQuests = gameDeriveDailyQuests;
  global.gameRecomputeContinuity = gameRecomputeContinuity;

})(typeof window !== 'undefined' ? window : globalThis);
