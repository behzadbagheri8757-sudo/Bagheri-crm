/* js/intelligence/seasonality.js — Seasonality Handling (P-06)
   ============================================================
   Goal: Suppress false decline signals during historically known
   seasonal low periods. Does NOT update baselines (P-05).
   Does NOT change status (P-02) or sourceLevel (P-01).

   Public API:
     getSeasonalFactor(customerId, productId, date) -> number
       0 = neutral (insufficient history / not a low season)
       (0, 1] = how far below the customer's typical monthly demand
               this calendar month has been historically

     adjustSignalForSeasonality(signal) -> signal (mutated in place)

   Calibration (Patch Plan placeholders):
     seasonalComparisonHistoryMonths = 12
     seasonalSuppressionFactor = 0.8

   Data: READ-ONLY data.invoices. No CRM writes.
   ============================================================ */
'use strict';

(function (global) {

  var SEASONALITY_PARAMS = {
    historyMonths: 12,
    suppressionFactor: 0.8,
    // Tolerance: observed decline may be up to this multiple of the
    // historical seasonal drop and still count as "within expected range".
    expectedRangeMultiplier: 1.25
  };

  // Decline-related categories only (Patch Plan: only decline signals affected).
  var DECLINE_CATEGORIES = {
    PURCHASE_DECLINE_SEVERE: true,
    PURCHASE_DECLINE_MILD: true,
    SKU_QUANTITY_DROP: true,
    SKU_FREQUENCY_DROP: true,
    SKU_DELAY: true,
    LINE_DROP: true,
    COMBINED_SKU_DETERIORATION: true,
    MULTI_SKU_DECLINE: true,
    KEY_PRODUCT_LOST: true,
    BASKET_SHRINK: true
  };

  function _dateOnly(iso) {
    if (!iso) return null;
    return String(iso).slice(0, 10);
  }

  function _monthKey(iso) {
    var d = _dateOnly(iso);
    if (!d || d.length < 7) return null;
    return d.slice(0, 7); // YYYY-MM
  }

  function _calendarMonth(iso) {
    var d = _dateOnly(iso);
    if (!d || d.length < 7) return null;
    return parseInt(d.slice(5, 7), 10); // 1..12
  }

  function _monthsBetween(earlierIso, laterIso) {
    var a = _dateOnly(earlierIso);
    var b = _dateOnly(laterIso);
    if (!a || !b) return null;
    var ay = parseInt(a.slice(0, 4), 10);
    var am = parseInt(a.slice(5, 7), 10);
    var by = parseInt(b.slice(0, 4), 10);
    var bm = parseInt(b.slice(5, 7), 10);
    if (!isFinite(ay) || !isFinite(am) || !isFinite(by) || !isFinite(bm)) return null;
    return (by - ay) * 12 + (bm - am);
  }

  function _invoiceAmount(inv, productId) {
    if (!inv) return 0;
    var items = inv.items || [];
    if (productId != null && productId !== '' && productId !== 'multi') {
      var sum = 0;
      for (var i = 0; i < items.length; i++) {
        var it = items[i];
        if (!it || it.productId !== productId) continue;
        if (!(it.qty > 0)) continue;
        sum += (it.qty * (it.price || 0)) - (it.discount || 0);
      }
      return sum;
    }
    // Account-level: prefer invoice total fields if present, else sum items
    if (typeof inv.total === 'number' && isFinite(inv.total)) return inv.total;
    if (typeof inv.amount === 'number' && isFinite(inv.amount)) return inv.amount;
    var t = 0;
    for (var j = 0; j < items.length; j++) {
      var x = items[j];
      if (!x || !(x.qty > 0)) continue;
      t += (x.qty * (x.price || 0)) - (x.discount || 0);
    }
    return t;
  }

  /**
   * Build monthly demand series for customer (+ optional product).
   * Returns { months: { 'YYYY-MM': amount }, spanMonths, overallMean, byCalMonth: {1..12: mean} }
   * or null if insufficient.
   */
  function _buildMonthlySeries(customerId, productId) {
    if (typeof data === 'undefined' || !Array.isArray(data.invoices)) return null;
    var byMonth = Object.create(null);
    var minDate = null;
    var maxDate = null;

    for (var i = 0; i < data.invoices.length; i++) {
      var inv = data.invoices[i];
      if (!inv || inv.customerId !== customerId) continue;
      var mk = _monthKey(inv.date);
      if (!mk) continue;
      var amt = _invoiceAmount(inv, productId);
      if (!byMonth[mk]) byMonth[mk] = 0;
      byMonth[mk] += amt;
      if (!minDate || mk < minDate) minDate = mk + '-01';
      if (!maxDate || mk > maxDate) maxDate = mk + '-01';
    }

    var keys = Object.keys(byMonth);
    if (!keys.length || !minDate || !maxDate) return null;

    var span = _monthsBetween(minDate, maxDate);
    if (span == null || span < SEASONALITY_PARAMS.historyMonths) return null;

    // Only months with observed invoice data contribute to means.
    // Missing months are unknown — not treated as zero demand.
    var allVals = [];
    var calBuckets = {}; // 1..12 -> [amounts]
    var fkeys = Object.keys(byMonth);
    for (var fi = 0; fi < fkeys.length; fi++) {
      var fk = fkeys[fi];
      var v = byMonth[fk];
      allVals.push(v);
      var cm = parseInt(fk.slice(5, 7), 10);
      if (!calBuckets[cm]) calBuckets[cm] = [];
      calBuckets[cm].push(v);
    }
    var span = _monthsBetween(minDate, maxDate);

    if (!allVals.length) return null;
    var sum = 0;
    for (var s = 0; s < allVals.length; s++) sum += allVals[s];
    var overallMean = sum / allVals.length;
    if (!(overallMean > 0)) return null;

    var byCalMonth = {};
    for (var cm2 = 1; cm2 <= 12; cm2++) {
      var arr = calBuckets[cm2];
      if (!arr || !arr.length) {
        byCalMonth[cm2] = null;
        continue;
      }
      var cs = 0;
      for (var a = 0; a < arr.length; a++) cs += arr[a];
      byCalMonth[cm2] = cs / arr.length;
    }

    return {
      overallMean: overallMean,
      byCalMonth: byCalMonth,
      spanMonths: span
    };
  }

  /**
   * @returns {number} 0 neutral; (0,1] strength of historical seasonal low for this month
   */
  function getSeasonalFactor(customerId, productId, date) {
    if (!customerId) return 0;
    var series = _buildMonthlySeries(customerId, productId != null ? productId : null);
    if (!series) return 0;

    var cm = _calendarMonth(date || (typeof todayISO === 'function' ? todayISO() : new Date().toISOString()));
    if (!cm) return 0;

    var monthMean = series.byCalMonth[cm];
    if (monthMean == null) return 0;

    // Low season only when this calendar month is historically below overall mean
    if (!(monthMean < series.overallMean)) return 0;

    var drop = (series.overallMean - monthMean) / series.overallMean;
    if (!(drop > 0)) return 0;
    if (drop > 1) drop = 1;
    return drop;
  }

  function _isDeclineSignal(signal) {
    return !!(signal && signal.category && DECLINE_CATEGORIES[signal.category]);
  }

  /**
   * Adjust a decline signal if the current period is a historical seasonal low
   * and the observed decline is within expected seasonal variation.
   * Non-decline signals are left unchanged.
   * Never changes status, sourceLevel, or baseline.
   */
  function adjustSignalForSeasonality(signal) {
    if (!signal || !_isDeclineSignal(signal)) return signal;
    // Idempotent: do not adjust the same signal twice
    if (signal.seasonalFactor !== undefined || signal.seasonallySuppressed !== undefined) {
      return signal;
    }

    var cid = signal.customerId;
    var pid = signal.productId != null ? signal.productId : null;
    var when = signal.detectedAt || (typeof todayISO === 'function' ? todayISO() : new Date().toISOString());

    var factor = getSeasonalFactor(cid, pid, when);
    signal.seasonalFactor = factor;

    if (!(factor > 0)) {
      // Not a historical low season (or insufficient history)
      return signal;
    }

    // Expected seasonal drop as percentage points (0..100)
    var expectedDropPct = factor * 100;

    // Only percentage-based decline measurements may be seasonally suppressed.
    // Counts/quantities must NOT be treated as fake percentages.
    if (signal.unit !== '%' || typeof signal.value !== 'number' || !isFinite(signal.value)) {
      signal.seasonallySuppressed = false;
      return signal;
    }
    var observedPct = signal.value;

    // Within historical seasonal variation?
    var withinExpected = observedPct <= expectedDropPct * SEASONALITY_PARAMS.expectedRangeMultiplier;

    if (!withinExpected) {
      // Genuine decline beyond seasonal expectation — keep detectable
      signal.seasonallySuppressed = false;
      return signal;
    }

    // P-03 evidence: competitor purchase is a real loss signal — never suppress.
    // Uses existing feedback shape from feedback.js (signal.feedback.reasonCode).
    if (signal.feedback && signal.feedback.reasonCode === 'competitor_bought') {
      signal.seasonallySuppressed = false;
      return signal;
    }

    // Suppress false seasonal decline contribution (do not delete signal).
    signal.seasonallySuppressed = true;
    var keep = 1 - SEASONALITY_PARAMS.suppressionFactor; // 0.2 retained
    if (typeof signal.severityPoints === 'number' && isFinite(signal.severityPoints)) {
      signal.severityPoints = signal.severityPoints * keep;
    }
    // Soften severity label for downstream display without removing the signal
    if (signal.severity === 'critical') signal.severity = 'high';
    else if (signal.severity === 'high') signal.severity = 'medium';
    else if (signal.severity === 'medium') signal.severity = 'low';

    if (!signal.reason || signal.reason.indexOf('فصلی') === -1) {
      signal.reason = (signal.reason || '') + ' (کاهش فصلی مورد انتظار)';
    }

    return signal;
  }

  global.getSeasonalFactor = getSeasonalFactor;
  global.adjustSignalForSeasonality = adjustSignalForSeasonality;
  global.SEASONALITY_PARAMS = SEASONALITY_PARAMS;

})(typeof window !== 'undefined' ? window : this);
