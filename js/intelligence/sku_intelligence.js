/* js/intelligence/sku_intelligence.js — Customer × SKU Intelligence V1
   ============================================================
   Deterministic pipeline per Developer Handoff Specification.
   READ-ONLY. No persistent cache (F2). No ML. No invented business rules.

   Public API:
     extractSkuSignals(customerId) -> Signal[]

   Data sources: data.invoices, data.payments, data.products
   Allowed helpers: customerInvoices, customerPayments, customerBehavior,
                    customerTotals, customerProfit, todayISO, daysAgo
   Must NOT call extractCustomerSignals (no circular dependency).
   ============================================================ */
'use strict';

(function (global) {

  /* ---------------------------------------------------------
     Parameter registry (configurable; calibrate with real data).
     F7 values are fixed by contract; all others are calibration knobs.
     --------------------------------------------------------- */
  var SKU_PARAMS = {
    recentWindowSize: 3,
    trendWindow: 3,
    basketWindowSize: 5,
    // BUGFIX (proven by runtime repro): was 2. With exactly 2 purchases
    // there is only ONE interval, so "typicalCycle" (a median) is a
    // single sample with zero measurable variance — it looks perfectly
    // "stable" and can produce a critical-severity SKU_DELAY signal from
    // essentially no pattern at all. Raised to 3 so at least 2 intervals
    // exist before a cycle is treated as "typical" (matches the existing
    // minimumPurchaseCountForFrequency=3 precedent in this same file).
    minimumPurchaseCountForTiming: 3,
    minimumPurchaseCountForQuantity: 2,
    minimumPurchaseCountForFrequency: 3,
    timingSensitivity: 0.5,
    quantityDropSensitivity: 0.3,
    spendDropSensitivity: 0.3,
    basketDropSensitivity: 0.5,
    frequencyDropSensitivity: 0.3,
    trendSensitivity: 0.25,
    minImportanceForSignal: 0.05,
    minBasketPresence: 0.15,
    minSkuCountForAccountSignal: 2,
    groupingWindowDays: 60,
    BASELINE_SHIFT_SENSITIVITY: 0.4,
    SEVERITY_IMPORTANCE_BASE: 0.5,
    SEVERITY_IMPORTANCE_FACTOR: 0.5,
    importanceWeights: { revenue: 0.4, frequency: 0.3, basket: 0.2, profit: 0.1 },
    confidenceWeights: { history: 0.35, stability: 0.25, completeness: 0.15, outliers: 0.1, shift: 0.15 },
    minPurchaseCountForHighConfidence: 6,
    frequencyWindowMultiplier: 1.5,
    minConfidenceForGrouping: 0.5,
    lowHistoryConfidenceFactor: 0.7
  };

  var SEVERITY_POINTS = {
    critical: 100,
    high: 70,
    medium: 40,
    low: 20
  };

  /* ---------------------------------------------------------
     Pure helpers
     --------------------------------------------------------- */
  function _nowISO() {
    return new Date().toISOString();
  }

  function _today() {
    if (typeof todayISO === 'function') return todayISO();
    return new Date().toISOString().slice(0, 10);
  }

  function _daysAgo(iso) {
    if (typeof daysAgo === 'function') {
      var d = daysAgo(iso);
      return (d != null && isFinite(d)) ? d : null;
    }
    if (!iso) return null;
    var t = new Date(String(iso).slice(0, 10)).getTime();
    if (isNaN(t)) return null;
    return Math.floor((Date.now() - t) / 86400000);
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

  function _mad(arr, med) {
    if (!arr || !arr.length || med == null || !isFinite(med)) return null;
    var devs = arr.map(function (v) { return Math.abs(v - med); });
    return _median(devs);
  }

  function _mean(arr) {
    if (!arr || !arr.length) return null;
    var s = 0;
    for (var i = 0; i < arr.length; i++) s += arr[i];
    return s / arr.length;
  }

  function _clamp01(x) {
    if (x == null || !isFinite(x)) return 0;
    if (x < 0) return 0;
    if (x > 1) return 1;
    return x;
  }

  function _productName(productId) {
    if (typeof data === 'undefined' || !Array.isArray(data.products)) return productId || '';
    var p = data.products.find(function (x) { return x && x.id === productId; });
    return (p && p.name) ? p.name : (productId || '');
  }

  function _productActive(productId) {
    if (typeof data === 'undefined' || !Array.isArray(data.products)) return true;
    var p = data.products.find(function (x) { return x && x.id === productId; });
    if (!p) return true;
    return p.active !== false;
  }

  function _productStock(productId) {
    if (typeof data === 'undefined' || !Array.isArray(data.products)) return null;
    var p = data.products.find(function (x) { return x && x.id === productId; });
    if (!p) return null;
    return typeof p.stockQty === 'number' ? p.stockQty : null;
  }

  /* ---------------------------------------------------------
     Stage 1 — Aggregation (fresh every call — F2)
     --------------------------------------------------------- */
  function _aggregatePairMap(customerId) {
    var map = Object.create(null);
    if (typeof data === 'undefined') return map;

    function ensure(pid) {
      var key = customerId + '|' + pid;
      if (!map[key]) {
        map[key] = {
          customerId: customerId,
          productId: pid,
          purchases: [],
          returns: []
        };
      }
      return map[key];
    }

    var invoices = Array.isArray(data.invoices) ? data.invoices : [];
    for (var i = 0; i < invoices.length; i++) {
      var inv = invoices[i];
      if (!inv || inv.customerId !== customerId) continue;
      var items = inv.items || [];
      // Merge duplicate SKU lines within same invoice
      var byPid = Object.create(null);
      for (var j = 0; j < items.length; j++) {
        var it = items[j];
        if (!it || !it.productId) continue; // V1 productId-only
        if (!(it.qty > 0)) continue; // Zero Quantity
        if (!byPid[it.productId]) {
          byPid[it.productId] = { qty: 0, revenue: 0 };
        }
        byPid[it.productId].qty += it.qty;
        byPid[it.productId].revenue += (it.qty * (it.price || 0)) - (it.discount || 0);
      }
      var pids = Object.keys(byPid);
      for (var k = 0; k < pids.length; k++) {
        var pid = pids[k];
        var m = byPid[pid];
        var pair = ensure(pid);
        pair.purchases.push({
          date: inv.date,
          qty: m.qty,
          revenue: m.revenue,
          unitPrice: m.qty > 0 ? (m.revenue / m.qty) : null,
          invoiceId: inv.id
        });
      }
    }

    var payments = Array.isArray(data.payments) ? data.payments : [];
    for (var r = 0; r < payments.length; r++) {
      var pay = payments[r];
      if (!pay || pay.customerId !== customerId) continue;
      if (pay.method !== 'return') continue;
      var rItems = pay.returnItems || [];
      for (var ri = 0; ri < rItems.length; ri++) {
        var ret = rItems[ri];
        if (!ret || !ret.productId) continue;
        if (!(ret.qty > 0)) continue;
        var pairR = ensure(ret.productId);
        pairR.returns.push({
          date: pay.date,
          qty: ret.qty,
          price: ret.price || 0,
          invoiceId: pay.invoiceId || null
        });
      }
    }

    // Sort purchases by date ascending
    var keys = Object.keys(map);
    for (var x = 0; x < keys.length; x++) {
      map[keys[x]].purchases.sort(function (a, b) {
        return String(a.date || '').localeCompare(String(b.date || ''));
      });
      map[keys[x]].returns.sort(function (a, b) {
        return String(a.date || '').localeCompare(String(b.date || ''));
      });
    }
    return map;
  }

  /* ---------------------------------------------------------
     Stage 2 — Baseline (F1 zero-interval)
     --------------------------------------------------------- */
  function _computeBaseline(purchases, windowSize) {
    var events = purchases || [];
    if (windowSize != null && windowSize > 0 && events.length > windowSize) {
      events = events.slice(events.length - windowSize);
    }
    var count = events.length;
    var qtys = events.map(function (e) { return e.qty; });
    var revs = events.map(function (e) { return e.revenue; });
    var intervals = [];
    for (var i = 1; i < events.length; i++) {
      var diff = _dateDiffDays(events[i].date, events[i - 1].date);
      if (diff != null && diff > 0) intervals.push(diff); // F1: only > 0
    }
    var typicalCycle = intervals.length ? _median(intervals) : null;
    var typicalQuantity = qtys.length ? _median(qtys) : null;
    var typicalSpend = revs.length ? _median(revs) : null;

    var cycleMad = (typicalCycle != null) ? _mad(intervals, typicalCycle) : null;
    var qtyMad = (typicalQuantity != null) ? _mad(qtys, typicalQuantity) : null;
    var intervalStab = (typicalCycle > 0 && cycleMad != null) ? (1 - _clamp01(cycleMad / typicalCycle)) : 0.5;
    var qtyStab = (typicalQuantity > 0 && qtyMad != null) ? (1 - _clamp01(qtyMad / typicalQuantity)) : 0.5;
    var patternStability = (intervalStab + qtyStab) / 2;

    var firstDate = events.length ? events[0].date : null;
    var lastDate = events.length ? events[events.length - 1].date : null;
    var spanDays = (firstDate && lastDate) ? _dateDiffDays(lastDate, firstDate) : null;
    var typicalFrequency = (spanDays != null && spanDays > 0) ? (count / spanDays) : null;

    return {
      purchaseCount: count,
      intervals: intervals,
      typicalCycle: typicalCycle,
      typicalQuantity: typicalQuantity,
      typicalSpend: typicalSpend,
      patternStability: patternStability,
      typicalFrequency: typicalFrequency,
      firstDate: firstDate,
      lastDate: lastDate
    };
  }

  /* ---------------------------------------------------------
     Stage 3 — Current state (F3 event-based recent window)
     --------------------------------------------------------- */
  function _computeCurrent(pair, historical, recent, customerInvoicesList) {
    var purchases = pair.purchases;
    var last = purchases.length ? purchases[purchases.length - 1] : null;
    var daysSinceLast = last ? _daysAgo(last.date) : null;
    var currentGap = null;
    if (historical.typicalCycle != null && historical.typicalCycle > 0 && daysSinceLast != null) {
      currentGap = daysSinceLast - historical.typicalCycle;
    }

    var recentQty = recent.typicalQuantity;
    var recentSp = recent.typicalSpend;

    var freqWindowDays = null;
    if (historical.typicalCycle != null && historical.typicalCycle > 0) {
      freqWindowDays = historical.typicalCycle * SKU_PARAMS.frequencyWindowMultiplier;
      freqWindowDays = Math.max(30, freqWindowDays);
    } else {
      freqWindowDays = 30;
    }
    var recentFrequency = 0;
    if (freqWindowDays != null) {
      for (var i = 0; i < purchases.length; i++) {
        var d = _daysAgo(purchases[i].date);
        if (d != null && d <= freqWindowDays) recentFrequency++;
      }
    }

    var invs = customerInvoicesList || [];

    // Compute historicalPresenceRate first (needed below to size the
    // basket window adaptively).
    var histPresenceCount = 0;
    for (var h = 0; h < invs.length; h++) {
      var its = invs[h].items || [];
      for (var jj = 0; jj < its.length; jj++) {
        if (its[jj] && its[jj].productId === pair.productId && its[jj].qty > 0) {
          histPresenceCount++;
          break;
        }
      }
    }
    var historicalPresenceRate = invs.length ? (histPresenceCount / invs.length) : null;

    // BUGFIX (proven by runtime repro): basketWindowSize is a fixed
    // lookback (5 invoices). For any SKU whose natural purchase cadence
    // is longer than that window (e.g. bought roughly every 6+ invoices —
    // a perfectly normal, healthy slow-moving SKU), currentBasketPresence
    // reads 0% almost every time it's checked, purely because the window
    // is shorter than the SKU's own cycle — not because anything changed.
    // Widen the window just enough that, at this SKU's own historical
    // rate, at least one occurrence would normally be expected. Never
    // shrinks the window below the configured basketWindowSize, so normal-
    // cadence SKUs (the common case) are completely unaffected.
    var basketWindow = SKU_PARAMS.basketWindowSize;
    if (historicalPresenceRate != null && historicalPresenceRate > 0) {
      var neededForOneExpected = Math.ceil(1 / historicalPresenceRate);
      if (neededForOneExpected > basketWindow) basketWindow = neededForOneExpected;
    }

    var sortedInvs = invs.slice().sort(function (a, b) {
      return String(b.date || '').localeCompare(String(a.date || ''));
    });
    var windowInvs = sortedInvs.slice(0, basketWindow);
    var presenceCount = 0;
    for (var w = 0; w < windowInvs.length; w++) {
      var items = windowInvs[w].items || [];
      for (var ii = 0; ii < items.length; ii++) {
        if (items[ii] && items[ii].productId === pair.productId && items[ii].qty > 0) {
          presenceCount++;
          break;
        }
      }
    }
    var currentBasketPresence = windowInvs.length ? (presenceCount / windowInvs.length) : 0;

    return {
      daysSinceLastPurchase: daysSinceLast,
      currentGap: currentGap,
      recentQuantity: recentQty,
      recentSpend: recentSp,
      recentFrequency: recentFrequency,
      currentBasketPresence: currentBasketPresence,
      historicalPresenceRate: historicalPresenceRate,
      lastPurchaseDate: last ? last.date : null
    };
  }

  /* ---------------------------------------------------------
     Stage 6 — Importance (F5 profit weight redistribution)
     --------------------------------------------------------- */
  function _computeImportance(pair, historical, customerId, totalCustomerRevenue, totalCustomerProfit, totalInvoices) {
    var skuRevenue = 0;
    for (var i = 0; i < pair.purchases.length; i++) skuRevenue += pair.purchases[i].revenue || 0;

    var revenueShare = (totalCustomerRevenue > 0) ? _clamp01(skuRevenue / totalCustomerRevenue) : 0;
    var frequencyShare = (totalInvoices > 0) ? _clamp01(pair.purchases.length / totalInvoices) : 0;
    var basketShare = 0;
    if (totalInvoices > 0) {
      var present = 0;
      var invs = (typeof customerInvoices === 'function') ? customerInvoices(customerId) : [];
      for (var j = 0; j < invs.length; j++) {
        var items = invs[j].items || [];
        for (var k = 0; k < items.length; k++) {
          if (items[k] && items[k].productId === pair.productId && items[k].qty > 0) {
            present++;
            break;
          }
        }
      }
      basketShare = _clamp01(present / totalInvoices);
    }

    var profitShare = null;
    var profitAvailable = false;
    if (totalCustomerProfit != null && isFinite(totalCustomerProfit) && totalCustomerProfit > 0) {
      // Approximate SKU profit from purchase events if buyPrice present on products
      var skuProfit = 0;
      var anyBuy = false;
      var prod = (typeof data !== 'undefined' && Array.isArray(data.products))
        ? data.products.find(function (x) { return x && x.id === pair.productId; })
        : null;
      var buy = prod ? (prod.buy || prod.buyPrice || 0) : 0;
      if (buy > 0) {
        anyBuy = true;
        for (var p = 0; p < pair.purchases.length; p++) {
          var ev = pair.purchases[p];
          skuProfit += (ev.revenue || 0) - (buy * (ev.qty || 0));
        }
      }
      if (anyBuy) {
        profitShare = _clamp01(Math.max(0, skuProfit) / totalCustomerProfit);
        profitAvailable = true;
      }
    }

    var w = SKU_PARAMS.importanceWeights;
    var wr = w.revenue, wf = w.frequency, wb = w.basket, wp = w.profit;
    if (!profitAvailable) {
      // F5: drop profit weight and renormalize remaining
      var remaining = wr + wf + wb;
      if (remaining > 0) {
        wr = wr / remaining;
        wf = wf / remaining;
        wb = wb / remaining;
      }
      wp = 0;
      profitShare = 0;
    }

    var importance = _clamp01(
      wr * revenueShare +
      wf * frequencyShare +
      wb * basketShare +
      wp * (profitShare || 0)
    );
    return importance;
  }

  /* ---------------------------------------------------------
     Stage 4/5/8 — Deviations, trend, confidence
     --------------------------------------------------------- */
  function _baselineShiftPenalty(historical, recent) {
    var penalty = 0;
    var sens = SKU_PARAMS.BASELINE_SHIFT_SENSITIVITY;
    function rel(h, r) {
      if (h == null || !(h > 0) || r == null || !isFinite(r)) return null;
      return Math.abs(r - h) / h;
    }
    var cShift = rel(historical.typicalCycle, recent.typicalCycle);
    var qShift = rel(historical.typicalQuantity, recent.typicalQuantity);
    if (cShift != null && cShift > sens) penalty = Math.max(penalty, _clamp01(cShift));
    if (qShift != null && qShift > sens) penalty = Math.max(penalty, _clamp01(qShift));
    return penalty;
  }

  function _computeConfidence(historical, recent, pair) {
    var cw = SKU_PARAMS.confidenceWeights;
    var historyScore = _clamp01(historical.purchaseCount / SKU_PARAMS.minPurchaseCountForHighConfidence);
    if (historical.purchaseCount < 4) {
      historyScore *= SKU_PARAMS.lowHistoryConfidenceFactor;
    }
    var stabilityScore = _clamp01(historical.patternStability);
    var complete = 0;
    var total = pair.purchases.length || 1;
    var withRev = 0;
    for (var i = 0; i < pair.purchases.length; i++) {
      if (pair.purchases[i].revenue != null) withRev++;
    }
    complete = withRev / total;
    var outlierScore = 1; // simplified: no heavy outlier analysis in V1
    var shiftPen = _baselineShiftPenalty(historical, recent);
    var shiftScore = 1 - shiftPen;

    return _clamp01(
      cw.history * historyScore +
      cw.stability * stabilityScore +
      cw.completeness * complete +
      cw.outliers * outlierScore +
      cw.shift * shiftScore
    );
  }

  function _trendClass(historical, recent) {
    var sens = SKU_PARAMS.trendSensitivity;
    var worsening = false;
    var improving = false;
    if (historical.typicalQuantity > 0 && recent.typicalQuantity != null) {
      var qRatio = recent.typicalQuantity / historical.typicalQuantity;
      if (qRatio < 1 - sens) worsening = true;
      if (qRatio > 1 + sens) improving = true;
    }
    if (historical.typicalCycle > 0 && recent.typicalCycle != null && recent.typicalCycle > 0) {
      var cRatio = recent.typicalCycle / historical.typicalCycle;
      if (cRatio > 1 + sens) worsening = true; // lengthening cycle
      if (cRatio < 1 - sens) improving = true;
    }
    if (worsening && !improving) return 'worsening';
    if (improving && !worsening) return 'improving';
    return 'stable';
  }

  /* ---------------------------------------------------------
     Stage 7 — Context
     --------------------------------------------------------- */
  function _netRecentQty(pair, recentWindowSize) {
    var purchases = pair.purchases;
    var startIdx = Math.max(0, purchases.length - recentWindowSize);
    var windowPurchases = purchases.slice(startIdx);
    var gross = 0;
    var earliest = null;
    for (var i = 0; i < windowPurchases.length; i++) {
      gross += windowPurchases[i].qty || 0;
      if (!earliest || String(windowPurchases[i].date) < String(earliest)) {
        earliest = windowPurchases[i].date;
      }
    }
    var returned = 0;
    if (earliest) {
      for (var r = 0; r < pair.returns.length; r++) {
        var ret = pair.returns[r];
        if (String(ret.date || '') >= String(earliest)) returned += ret.qty || 0;
      }
    }
    return Math.max(0, gross - returned);
  }

  function _accountWideDecline(customerId) {
    if (typeof customerBehavior !== 'function') return false;
    try {
      var b = customerBehavior(customerId);
      if (!b) return false;
      if (b.amountTrend === 'down') return true;
      var declining = Array.isArray(b.decliningProducts) ? b.decliningProducts : [];
      if (declining.length >= SKU_PARAMS.minSkuCountForAccountSignal) return true;
      return false;
    } catch (e) {
      return false;
    }
  }

  /* ---------------------------------------------------------
     Severity + points (F7)
     --------------------------------------------------------- */
  function _severityFromDeviation(strength, importance) {
    // strength roughly [0,1+]; map to severity bands (deterministic, no extra business invention)
    if (strength >= 1.0) return 'critical';
    if (strength >= 0.6) return 'high';
    if (strength >= 0.3) return 'medium';
    return 'low';
  }

  function _severityPoints(severity, importance) {
    var base = SEVERITY_POINTS[severity] || 0;
    var b = SKU_PARAMS.SEVERITY_IMPORTANCE_BASE;
    var f = SKU_PARAMS.SEVERITY_IMPORTANCE_FACTOR;
    var imp = (importance != null && isFinite(importance)) ? _clamp01(importance) : 0;
    return base * (b + f * imp);
  }

  function _mkSkuSignal(opts) {
    var severity = opts.severity || 'medium';
    var importance = opts.importance != null ? opts.importance : 0;
    var conf = opts.confidence != null ? opts.confidence : 0.5;
    return {
      id: 'sig_' + opts.customerId + '_sku_' + opts.productId + '_' + opts.category,
      customerId: opts.customerId,
      productId: opts.productId,
      productName: opts.productName || _productName(opts.productId),
      type: opts.type || 'risk',
      category: opts.category,
      severity: severity,
      importance: importance,
      confidence: conf,
      severityPoints: _severityPoints(severity, importance),
      value: opts.value,
      unit: opts.unit,
      reason: opts.reason,
      detectedAt: _nowISO(),
      actionable: opts.actionable !== false,
      actionHint: opts.actionHint || null,
      contextFlags: opts.contextFlags || {},
      evidence: opts.evidence || {},
      source: 'sku_intelligence'
    };
  }

  /* ---------------------------------------------------------
     Stage 9–11 — Eligibility, combination, signal build
     --------------------------------------------------------- */
  function _analyzePair(pair, customerId, custInvs, totalRev, totalProfit, accountDecline) {
    var historical = _computeBaseline(pair.purchases, null);
    if (historical.purchaseCount < 1) return null;

    // P-05: maintained baseline via baseline_manager (persistent shift detection).
    // Signal-generation semantics otherwise unchanged — only the source of
    // typicalCycle / typicalQuantity for the established baseline is managed.
    if (typeof updateBaselineIfShifted === 'function') {
      try {
        updateBaselineIfShifted(customerId, pair.productId, pair.purchases);
      } catch (eBaseUp) { /* fail-open */ }
    }
    if (typeof getBaseline === 'function') {
      try {
        var managed = getBaseline(customerId, pair.productId);
        if (managed) {
          if (managed.typicalCycle != null && isFinite(managed.typicalCycle) && managed.typicalCycle > 0) {
            historical.typicalCycle = managed.typicalCycle;
          }
          if (managed.typicalQuantity != null && isFinite(managed.typicalQuantity) && managed.typicalQuantity > 0) {
            historical.typicalQuantity = managed.typicalQuantity;
          }
        }
      } catch (eBaseGet) { /* fail-open */ }
    }

    var recent = _computeBaseline(pair.purchases, SKU_PARAMS.recentWindowSize);
    var current = _computeCurrent(pair, historical, recent, custInvs);
    var importance = _computeImportance(pair, historical, customerId, totalRev, totalProfit, custInvs.length);
    var confidence = _computeConfidence(historical, recent, pair);
    var trend = _trendClass(historical, recent);
    var stockQty = _productStock(pair.productId);
    var stockOut = (stockQty != null && stockQty <= 0);
    var productName = _productName(pair.productId);

    if (!_productActive(pair.productId)) return null;

    var candidates = [];

    // Timing deviation
    if (
      historical.purchaseCount >= SKU_PARAMS.minimumPurchaseCountForTiming &&
      historical.typicalCycle != null &&
      historical.typicalCycle > 0 &&
      current.currentGap != null &&
      current.currentGap > 0
    ) {
      var timingThresh = historical.typicalCycle * SKU_PARAMS.timingSensitivity;
      if (current.currentGap > timingThresh) {
        var timingStrength = current.currentGap / historical.typicalCycle;
        candidates.push({
          dim: 'timing',
          category: 'SKU_DELAY',
          strength: timingStrength,
          value: current.daysSinceLastPurchase,
          unit: 'days',
          reason: 'مشتری معمولاً «' + productName + '» را هر ' + Math.round(historical.typicalCycle) +
            ' روز می‌خرد؛ آخرین خرید ' + Math.round(current.daysSinceLastPurchase) + ' روز پیش بوده است',
          actionHint: 'Visit',
          evidence: {
            daysSinceLast: current.daysSinceLastPurchase,
            typicalCycle: historical.typicalCycle,
            currentGap: current.currentGap
          }
        });
      }
    }

    // Quantity deviation (F3: use actual recent events, not forced zero)
    if (
      historical.purchaseCount >= SKU_PARAMS.minimumPurchaseCountForQuantity &&
      historical.typicalQuantity != null &&
      historical.typicalQuantity > 0 &&
      recent.typicalQuantity != null
    ) {
      var netQty = _netRecentQty(pair, SKU_PARAMS.recentWindowSize);
      // BUGFIX (proven by runtime repro, prior session): netQty is a SUM
      // across up to recentWindowSize purchase events, while
      // historical.typicalQuantity is a MEDIAN SINGLE-EVENT quantity.
      // Comparing them directly (sum vs. per-event baseline) was a
      // unit/scale mismatch: qtyRatio came out >= 0.7 almost every time
      // more than one recent purchase existed, regardless of returns, so
      // returnsExplain was wrongly true and masked real quantity
      // declines. Normalize netQty to the same per-purchase-event scale
      // before comparing.
      var netQtyWindowCount = Math.min(SKU_PARAMS.recentWindowSize, pair.purchases.length);
      var netQtyPerEvent = netQtyWindowCount > 0 ? (netQty / netQtyWindowCount) : netQty;
      var compareQty = netQtyPerEvent; // prefer net (per-event) for returns context
      // If net is near baseline but gross recent is low → returns explain it
      var qtyRatio = compareQty / historical.typicalQuantity;
      // Also consider median recent event qty
      var eventRatio = recent.typicalQuantity / historical.typicalQuantity;
      var effectiveRatio = Math.max(qtyRatio, eventRatio); // conservative: use less severe
      // Actually for drop detection use the lower of the two (more drop) only if returns don't neutralize
      // BUGFIX (proven by runtime repro): "returnsExplain" never actually
      // checked whether any return exists for this SKU — it only compared
      // ratios. That meant a single large outlier order in the recent
      // window could itself push qtyRatio back above threshold and mask a
      // genuine, sustained per-order quantity decline (e.g. baseline 20,
      // recent orders 100/12/12 — a real drop to ~12 — with zero returns
      // involved at all). Require an actual recorded return before
      // "returns explain it" is allowed to suppress the signal.
      var hasReturnsInPeriod = !!(pair.returns && pair.returns.length > 0);
      var returnsExplain = hasReturnsInPeriod &&
        (eventRatio < 1 - SKU_PARAMS.quantityDropSensitivity) &&
        (qtyRatio >= 1 - SKU_PARAMS.quantityDropSensitivity);
      if (!returnsExplain && eventRatio < 1 - SKU_PARAMS.quantityDropSensitivity) {
        var qtyStrength = 1 - eventRatio;
        candidates.push({
          dim: 'quantity',
          category: 'SKU_QUANTITY_DROP',
          strength: qtyStrength,
          value: Math.round((1 - eventRatio) * 1000) / 10,
          unit: '%',
          reason: 'مقدار خرید «' + productName + '» از حدود ' +
            (Math.round(historical.typicalQuantity * 100) / 100) + ' به حدود ' +
            (Math.round(recent.typicalQuantity * 100) / 100) + ' کاهش یافته است',
          actionHint: 'Investigate',
          evidence: {
            typicalQuantity: historical.typicalQuantity,
            recentQuantity: recent.typicalQuantity,
            netRecentQty: netQty
          }
        });
      }
    }

    // Spend deviation
    if (
      historical.purchaseCount >= SKU_PARAMS.minimumPurchaseCountForQuantity &&
      historical.typicalSpend != null &&
      historical.typicalSpend > 0 &&
      recent.typicalSpend != null
    ) {
      var spendRatio = recent.typicalSpend / historical.typicalSpend;
      if (spendRatio < 1 - SKU_PARAMS.spendDropSensitivity) {
        // Only emit separate spend if quantity drop not already covering similar magnitude
        var hasQty = candidates.some(function (c) { return c.dim === 'quantity'; });
        if (!hasQty) {
          candidates.push({
            dim: 'spend',
            category: 'SKU_QUANTITY_DROP', // fold into quantity category per handoff
            strength: 1 - spendRatio,
            value: Math.round((1 - spendRatio) * 1000) / 10,
            unit: '%',
            reason: 'مبلغ خرید «' + productName + '» نسبت به الگوی معمول کاهش یافته است',
            actionHint: 'Investigate',
            evidence: {
              typicalSpend: historical.typicalSpend,
              recentSpend: recent.typicalSpend
            }
          });
        }
      }
    }

    // Basket / line drop
    if (
      historical.purchaseCount >= SKU_PARAMS.minimumPurchaseCountForQuantity &&
      current.historicalPresenceRate != null &&
      current.historicalPresenceRate >= SKU_PARAMS.minBasketPresence &&
      current.currentBasketPresence <= (1 - SKU_PARAMS.basketDropSensitivity) * current.historicalPresenceRate
    ) {
      candidates.push({
        dim: 'basket',
        category: 'LINE_DROP',
        strength: current.historicalPresenceRate - current.currentBasketPresence,
        value: Math.round(current.currentBasketPresence * 100),
        unit: '%',
        reason: '«' + productName + '» دیگر در سبد خریدهای اخیر مشتری دیده نمی‌شود',
        actionHint: 'Visit',
        evidence: {
          historicalPresenceRate: current.historicalPresenceRate,
          currentBasketPresence: current.currentBasketPresence
        }
      });
    }

    // Frequency deviation
    if (
      historical.purchaseCount >= SKU_PARAMS.minimumPurchaseCountForFrequency &&
      historical.typicalFrequency != null &&
      historical.typicalFrequency > 0 &&
      historical.typicalCycle != null &&
      historical.typicalCycle > 0
    ) {
      var expectedInWindow = historical.typicalFrequency *
        (historical.typicalCycle * SKU_PARAMS.frequencyWindowMultiplier);
      if (expectedInWindow > 0) {
        var freqRatio = current.recentFrequency / expectedInWindow;
        if (freqRatio < 1 - SKU_PARAMS.frequencyDropSensitivity) {
          candidates.push({
            dim: 'frequency',
            category: 'SKU_FREQUENCY_DROP',
            strength: 1 - freqRatio,
            value: current.recentFrequency,
            unit: 'count',
            reason: 'تعداد خرید «' + productName + '» در بازه اخیر کمتر از الگوی معمول است',
            actionHint: 'Call Today',
            evidence: {
              recentFrequency: current.recentFrequency,
              expectedFrequency: expectedInWindow
            }
          });
        }
      }
    }

    // Stock suppression (context)
    if (stockOut) {
      candidates = candidates.filter(function (c) {
        return c.dim !== 'timing' && c.dim !== 'quantity' && c.dim !== 'spend';
      });
    }

    // Importance gate
    if (importance < SKU_PARAMS.minImportanceForSignal) {
      return null;
    }

    if (!candidates.length) return null;

    // Combine multiple dimensions on same SKU
    var category;
    var dims = candidates.map(function (c) { return c.dim; });
    var uniqueDims = dims.filter(function (d, i) { return dims.indexOf(d) === i; });
    if (uniqueDims.length >= 2) {
      category = 'COMBINED_SKU_DETERIORATION';
    } else {
      category = candidates[0].category;
    }

    var maxStrength = 0;
    var reasons = [];
    var evidence = {};
    var actionHint = candidates[0].actionHint;
    var value = candidates[0].value;
    var unit = candidates[0].unit;
    for (var c = 0; c < candidates.length; c++) {
      if (candidates[c].strength > maxStrength) maxStrength = candidates[c].strength;
      reasons.push(candidates[c].reason);
      for (var ek in candidates[c].evidence) {
        if (Object.prototype.hasOwnProperty.call(candidates[c].evidence, ek)) {
          evidence[ek] = candidates[c].evidence[ek];
        }
      }
    }
    if (category === 'COMBINED_SKU_DETERIORATION') {
      actionHint = 'Manager Review';
    }

    var severity = _severityFromDeviation(maxStrength, importance);
    if (trend === 'worsening' && severity === 'low') severity = 'medium';
    if (trend === 'worsening' && severity === 'medium') severity = 'high';

    return {
      signal: _mkSkuSignal({
        customerId: customerId,
        productId: pair.productId,
        productName: productName,
        category: category,
        severity: severity,
        importance: importance,
        confidence: confidence,
        value: value,
        unit: unit,
        reason: reasons.join('؛ '),
        actionHint: actionHint,
        contextFlags: {
          stock: stockOut,
          accountDecline: !!accountDecline,
          returns: pair.returns.length > 0
        },
        evidence: evidence
      }),
      productId: pair.productId,
      dims: uniqueDims,
      strength: maxStrength
    };
  }

  /* ---------------------------------------------------------
     Public entry: extractSkuSignals (F2 freshness)
     --------------------------------------------------------- */
  function extractSkuSignals(customerId) {
    var out = [];
    if (!customerId) return out;
    if (typeof data === 'undefined') return out;

    // F2: rebuild aggregation from current data every call
    var map = _aggregatePairMap(customerId);
    var keys = Object.keys(map);
    if (!keys.length) return out;

    var custInvs = (typeof customerInvoices === 'function') ? customerInvoices(customerId) : [];
    var totalRev = 0;
    try {
      if (typeof customerTotals === 'function') {
        var t = customerTotals(customerId);
        if (t && typeof t.invTotal === 'number') totalRev = t.invTotal;
      }
    } catch (e) {}
    var totalProfit = null;
    try {
      if (typeof customerProfit === 'function') {
        totalProfit = customerProfit(customerId);
      }
    } catch (e2) {}

    var accountDecline = _accountWideDecline(customerId);
    var pairResults = [];

    for (var i = 0; i < keys.length; i++) {
      var pair = map[keys[i]];
      if (!pair.purchases.length) continue;
      var result = _analyzePair(pair, customerId, custInvs, totalRev, totalProfit, accountDecline);
      if (result && result.signal) pairResults.push(result);
    }

    // Multi-SKU Decline grouping
    if (
      accountDecline &&
      pairResults.length >= SKU_PARAMS.minSkuCountForAccountSignal
    ) {
      var qtyLike = pairResults.filter(function (r) {
        if (!(r.signal && r.signal.confidence >= SKU_PARAMS.minConfidenceForGrouping)) return false;
        return r.dims.indexOf('quantity') >= 0 ||
          r.dims.indexOf('frequency') >= 0 ||
          r.dims.indexOf('basket') >= 0 ||
          r.signal.category === 'COMBINED_SKU_DETERIORATION' ||
          r.signal.category === 'SKU_QUANTITY_DROP' ||
          r.signal.category === 'LINE_DROP' ||
          r.signal.category === 'SKU_FREQUENCY_DROP';
      });
      if (qtyLike.length >= SKU_PARAMS.minSkuCountForAccountSignal) {
        var names = qtyLike.map(function (r) { return r.signal.productName || r.productId; });
        var avgImp = 0;
        var avgConf = 0;
        var maxStr = 0;
        for (var q = 0; q < qtyLike.length; q++) {
          avgImp += qtyLike[q].signal.importance || 0;
          avgConf += qtyLike[q].signal.confidence || 0;
          if (qtyLike[q].strength > maxStr) maxStr = qtyLike[q].strength;
        }
        avgImp /= qtyLike.length;
        avgConf /= qtyLike.length;
        var multiSeverity = _severityFromDeviation(maxStr, avgImp);
        if (multiSeverity === 'low' || multiSeverity === 'medium') multiSeverity = 'high';

        var multi = _mkSkuSignal({
          customerId: customerId,
          productId: 'multi',
          productName: names.join('، '),
          category: 'MULTI_SKU_DECLINE',
          severity: multiSeverity,
          importance: avgImp,
          confidence: avgConf,
          value: qtyLike.length,
          unit: 'count',
          reason: 'کاهش خرید در چند محصول (' + names.join('، ') + ') همراه با افت کلی حساب',
          actionHint: 'Manager Review',
          contextFlags: { accountDecline: true },
          evidence: { affectedProductIds: qtyLike.map(function (r) { return r.productId; }) }
        });
        // Suppress individuals that were grouped
        var groupedIds = Object.create(null);
        for (var g = 0; g < qtyLike.length; g++) groupedIds[qtyLike[g].productId] = true;
        pairResults = pairResults.filter(function (r) { return !groupedIds[r.productId]; });
        out.push(multi);
      }
    }

    for (var o = 0; o < pairResults.length; o++) {
      out.push(pairResults[o].signal);
    }
    return out;
  }

  global.extractSkuSignals = extractSkuSignals;
  global.SKU_PARAMS = SKU_PARAMS;

  /* ============================================================
     WATCH / EARLY WARNING LAYER — SKU side (frozen spec §7-9).
     Read-only. Does NOT call extractCustomerSignals/extractSkuSignals,
     persistence, risk, or action. Does NOT call updateBaselineIfShifted/
     getBaseline (baseline_manager.js): those are Confirmed-pipeline-owned
     (P-05) and would additionally write to localStorage/IndexedDB as a
     side effect of merely computing metrics — reusing them here would
     make Watch dependent on Confirmed state and no longer strictly
     read-only, so raw historical.typicalCycle/typicalQuantity from
     _computeBaseline are used directly instead. This is a deliberate,
     reported deviation from "همان baseline منطقی که _analyzePair استفاده
     می‌کند" in the strict sense of reusing the *managed* baseline; the
     same aggregation/median baseline *algorithm* is reused exactly.
     ============================================================ */

  /* Public contract (spec §7): exact fields only, plus purchaseCount —
     added because the Watch rules in this same file need it to apply
     each rule's minimum-purchase-count gate (spec §8), and the contract
     does not forbid additional fields. Reported explicitly, not guessed
     silently. */
  function _extractSkuRawMetrics(customerId) {
    var out = [];
    if (!customerId || typeof data === 'undefined') return out;
    var map = _aggregatePairMap(customerId);
    var keys = Object.keys(map);
    if (!keys.length) return out;
    var custInvs = (typeof customerInvoices === 'function') ? customerInvoices(customerId) : [];

    for (var i = 0; i < keys.length; i++) {
      var pair = map[keys[i]];
      if (!pair.purchases.length) continue;

      var historical = _computeBaseline(pair.purchases, null);
      if (historical.purchaseCount < 1) continue;
      var recent = _computeBaseline(pair.purchases, SKU_PARAMS.recentWindowSize);
      var current = _computeCurrent(pair, historical, recent, custInvs);

      var eventRatio = null;
      if (historical.typicalQuantity != null && historical.typicalQuantity > 0 && recent.typicalQuantity != null) {
        eventRatio = recent.typicalQuantity / historical.typicalQuantity;
      }

      var freqRatio = null;
      if (
        historical.typicalFrequency != null && historical.typicalFrequency > 0 &&
        historical.typicalCycle != null && historical.typicalCycle > 0
      ) {
        var expectedInWindow = historical.typicalFrequency * (historical.typicalCycle * SKU_PARAMS.frequencyWindowMultiplier);
        if (expectedInWindow > 0) freqRatio = current.recentFrequency / expectedInWindow;
      }

      var presenceDrop = null;
      if (current.historicalPresenceRate != null) {
        presenceDrop = current.historicalPresenceRate - current.currentBasketPresence;
      }

      out.push({
        productId: pair.productId,
        productName: _productName(pair.productId),
        typicalCycle: historical.typicalCycle,
        currentGap: current.currentGap,
        eventRatio: eventRatio,
        freqRatio: freqRatio,
        presenceDrop: presenceDrop,
        historicalPresenceRate: current.historicalPresenceRate,
        currentBasketPresence: current.currentBasketPresence,
        purchaseCount: historical.purchaseCount
      });
    }
    return out;
  }

  var WATCH_LEVEL_RANK = { low: 1, medium: 2, high: 3 };
  function _watchLevelMax(a, b) {
    return (WATCH_LEVEL_RANK[b] || 0) > (WATCH_LEVEL_RANK[a] || 0) ? b : a;
  }

  /* SKU Watch rules (spec §8) + Combined SKU Watch collapsing (spec §9). */
  function extractSkuWatchObservations(customerId) {
    var out = [];
    if (!customerId) return out;
    var raw;
    try { raw = _extractSkuRawMetrics(customerId) || []; } catch (eRaw) { raw = []; }
    if (!raw.length) return out;

    for (var i = 0; i < raw.length; i++) {
      var m = raw[i];
      var components = [];

      // A) SKU_DELAY_WATCH
      if (
        m.purchaseCount >= SKU_PARAMS.minimumPurchaseCountForTiming &&
        m.typicalCycle != null && m.typicalCycle > 0 &&
        m.currentGap != null && m.currentGap > 0
      ) {
        var delayRatio = m.currentGap / m.typicalCycle;
        if (delayRatio >= 0.20) {
          components.push({
            category: 'SKU_DELAY_WATCH',
            level: delayRatio >= 0.40 ? 'high' : (delayRatio >= 0.30 ? 'medium' : 'low'),
            deviationStrength: Math.min(1, m.currentGap / (0.5 * m.typicalCycle)),
            reason: 'تأخیر زودهنگام در خرید «' + m.productName + '» نسبت به الگوی معمول مشاهده می‌شود'
          });
        }
      }

      // B) SKU_QUANTITY_DROP_WATCH
      if (m.purchaseCount >= SKU_PARAMS.minimumPurchaseCountForQuantity && m.eventRatio != null && m.eventRatio < 0.85) {
        components.push({
          category: 'SKU_QUANTITY_DROP_WATCH',
          level: m.eventRatio < 0.75 ? 'medium' : 'low',
          deviationStrength: Math.min(1, (1 - m.eventRatio) / 0.3),
          reason: 'کاهش زودهنگام در مقدار خرید «' + m.productName + '» مشاهده می‌شود'
        });
      }

      // C) SKU_FREQUENCY_DROP_WATCH
      if (m.purchaseCount >= SKU_PARAMS.minimumPurchaseCountForFrequency && m.freqRatio != null && m.freqRatio < 0.85) {
        components.push({
          category: 'SKU_FREQUENCY_DROP_WATCH',
          level: m.freqRatio < 0.75 ? 'medium' : 'low',
          deviationStrength: Math.min(1, (1 - m.freqRatio) / 0.3),
          reason: 'کاهش زودهنگام در تعداد دفعات خرید «' + m.productName + '» مشاهده می‌شود'
        });
      }

      // D) LINE_DROP_WATCH
      if (m.presenceDrop != null && m.presenceDrop >= 0.30) {
        components.push({
          category: 'LINE_DROP_WATCH',
          level: m.presenceDrop >= 0.45 ? 'medium' : 'low',
          deviationStrength: Math.min(1, m.presenceDrop / 0.5),
          reason: '«' + m.productName + '» به‌تدریج از سبد خریدهای اخیر کم‌رنگ‌تر شده است'
        });
      }

      if (!components.length) continue;

      if (components.length >= 2) {
        var level = 'low';
        var deviationStrength = 0;
        var watchComponents = [];
        var reasons = [];
        for (var c = 0; c < components.length; c++) {
          level = _watchLevelMax(level, components[c].level);
          if (components[c].deviationStrength > deviationStrength) deviationStrength = components[c].deviationStrength;
          watchComponents.push(components[c].category);
          reasons.push(components[c].reason);
        }
        out.push({
          customerId: customerId,
          productId: m.productId,
          productName: m.productName,
          category: 'COMBINED_SKU_WATCH',
          level: level,
          reason: reasons.join('؛ '),
          deviationStrength: deviationStrength,
          source: 'sku',
          watchComponents: watchComponents
        });
      } else {
        var comp = components[0];
        out.push({
          customerId: customerId,
          productId: m.productId,
          productName: m.productName,
          category: comp.category,
          level: comp.level,
          reason: comp.reason,
          deviationStrength: comp.deviationStrength,
          source: 'sku',
          watchComponents: null
        });
      }
    }
    return out;
  }

  global._extractSkuRawMetrics = _extractSkuRawMetrics;
  global.extractSkuWatchObservations = extractSkuWatchObservations;

})(typeof window !== 'undefined' ? window : this);
