/* js/intelligence/priority.js — Priority Engine (P-04)
   ============================================================
   READ-ONLY layer on top of Risk Engine:

     calculateCustomerRisk(cid)
           |
     THIS FILE
           |
        { customerId, priorityScore, priorityLevel, riskScore,
          riskLevel, signals, primarySignal, reason, breakdown }

   P-04 composite (placeholder weights — not final business weights):
     priorityScore =
         0.6 * Risk
       + 0.2 * Economic
       + 0.1 * Opportunity
       + 0.1 * Timing
     clamped to [0, 100]

   Components (all 0..100 before weighting):
     Risk        — from Risk Engine (P-01 dominance, P-02 active gate,
                   P-03 riskModifier already applied). Never re-implemented.
     Economic    — relative revenue importance via customerTotals.invTotal
                   percentile among active customers (read-only).
     Opportunity — max severity points of type==='opportunity' signals
                   (active preferred; missing status treated active).
     Timing      — visit overdue / days since last visit using existing
                   helpers only (visitOverdueDays, customerBehavior, daysAgo).

   P-01 / P-02 / P-03 are not modified here.
   Opportunity never becomes risk. Pending risk does not inflate Risk.
   ============================================================ */
'use strict';

(function (global) {

  // Placeholder weights (Patch Plan) — not claimed as final business weights.
  var W_RISK = 0.6;
  var W_ECONOMIC = 0.2;
  var W_OPPORTUNITY = 0.1;
  var W_TIMING = 0.1;

  var TIE_BREAK_ORDER = [
    'CHECK_BOUNCED',
    'PAYMENT_OVERDUE',
    'PURCHASE_DECLINE_SEVERE',
    'MULTI_SKU_DECLINE',
    'COMBINED_SKU_DETERIORATION',
    'BEHIND_PATTERN',
    'CONSECUTIVE_NO_ORDER',
    'SKU_DELAY',
    'SKU_QUANTITY_DROP',
    'SKU_FREQUENCY_DROP',
    'LINE_DROP',
    'PURCHASE_DECLINE_MILD',
    'KEY_PRODUCT_LOST',
    'BASKET_SHRINK',
    'LONG_NO_VISIT',
    'VISIT_OVERDUE',
    'VISIT_CONVERSION_LOW',
    'PURCHASE_GROWTH'
  ];

  var SEVERITY_POINTS = {
    critical: 100,
    high: 70,
    medium: 40,
    low: 20
  };

  function _tieBreakRank(category) {
    var idx = TIE_BREAK_ORDER.indexOf(category);
    return idx === -1 ? TIE_BREAK_ORDER.length : idx;
  }

  function _levelFromScore(score) {
    if (score >= 75) return 'urgent';
    if (score >= 50) return 'high';
    if (score >= 25) return 'normal';
    return 'low';
  }

  function _isActive(s) {
    if (!s) return false;
    if (s.status == null || s.status === undefined) return true;
    return s.status === 'active';
  }

  function _signalBasePoints(s) {
    if (s && typeof s.severityPoints === 'number' && isFinite(s.severityPoints)) {
      return s.severityPoints;
    }
    return SEVERITY_POINTS[s && s.severity] || 0;
  }

  /* ---- Economic Importance (0..100) ----
     Uses customerTotals(cid).invTotal when available.
     Rank among active customers → map to score:
       top 20% → 100, mid 60% → 60, bottom 20% → 30, unknown → 50.
     Same idea as action.js impact map — no invented commercial data. */
  function _economicScore(cid) {
    if (typeof data === 'undefined' || !Array.isArray(data.customers)) return 50;
    if (typeof customerTotals !== 'function') return 50;

    var rows = [];
    for (var i = 0; i < data.customers.length; i++) {
      var c = data.customers[i];
      if (!c || c.active === false) continue;
      var invTotal = null;
      try {
        var t = customerTotals(c.id);
        if (t && typeof t.invTotal === 'number' && isFinite(t.invTotal)) invTotal = t.invTotal;
      } catch (e) { /* ignore */ }
      rows.push({ id: c.id, invTotal: invTotal });
    }

    var ranked = rows.filter(function (r) { return r.invTotal != null; })
      .sort(function (a, b) { return (b.invTotal || 0) - (a.invTotal || 0); });

    if (!ranked.length) return 50;

    var myIdx = -1;
    for (var j = 0; j < ranked.length; j++) {
      if (ranked[j].id === cid) { myIdx = j; break; }
    }
    if (myIdx === -1) return 50;

    // Rank position: top/bottom quintile by index (handles small N).
    var n = ranked.length;
    var band = Math.max(1, Math.ceil(n * 0.2));
    if (myIdx < band) return 100;
    if (myIdx >= n - band) return 30;
    return 60;
  }

  /* ---- Opportunity (0..100) ----
     Max points among type==='opportunity' signals.
     Opportunity is not a risk driver; P-02 active gate applies to Risk
     only — opportunity component uses any opportunity signal present. */
  function _opportunityScore(signals) {
    if (!signals || !signals.length) return 0;
    var maxPts = 0;
    for (var i = 0; i < signals.length; i++) {
      var s = signals[i];
      if (!s || s.type !== 'opportunity') continue;
      var pts = _signalBasePoints(s);
      if (pts > maxPts) maxPts = pts;
    }
    if (maxPts > 100) maxPts = 100;
    return maxPts;
  }

  /* ---- Timing (0..100) ----
     Prefer visitOverdueDays(cid) when available.
     Fallback: customerBehavior.lastVisit + daysAgo.
     Mapping: 0 overdue → 10 baseline; >7 → 50; >14 → 80; >30 → 100. */
  function _timingScore(cid) {
    var overdue = null;
    if (typeof visitOverdueDays === 'function') {
      try {
        var v = visitOverdueDays(cid);
        if (v != null && isFinite(v)) overdue = v;
      } catch (e) { /* ignore */ }
    }

    if (overdue == null && typeof customerBehavior === 'function') {
      try {
        var b = customerBehavior(cid);
        if (b && b.lastVisit && b.lastVisit.date && typeof daysAgo === 'function') {
          var d = daysAgo(b.lastVisit.date);
          if (d != null && isFinite(d) && d !== Infinity) overdue = d;
        }
      } catch (e2) { /* ignore */ }
    }

    if (overdue == null || !isFinite(overdue) || overdue < 0) return 10;
    if (overdue > 30) return 100;
    if (overdue > 14) return 80;
    if (overdue > 7) return 50;
    if (overdue > 0) return 30;
    return 10;
  }

  function _pickPrimarySignal(signals) {
    if (!signals || !signals.length) return null;
    var bestActiveRisk = null, bestActiveRiskRank = Infinity;
    var bestRisk = null, bestRiskRank = Infinity;
    var bestAny = null, bestAnyRank = Infinity;

    for (var i = 0; i < signals.length; i++) {
      var s = signals[i];
      if (!s || !s.category) continue;
      var r = _tieBreakRank(s.category);
      if (r < bestAnyRank) { bestAnyRank = r; bestAny = s; }
      if (s.type === 'risk') {
        if (r < bestRiskRank) { bestRiskRank = r; bestRisk = s; }
        if (_isActive(s) && r < bestActiveRiskRank) {
          bestActiveRiskRank = r;
          bestActiveRisk = s;
        }
      }
    }
    return bestActiveRisk || bestRisk || bestAny;
  }

  function _buildReason(signals, riskScore) {
    if (!signals || !signals.length) return 'بدون Signal فعال';
    var ordered = signals.slice().sort(function (a, b) {
      return _tieBreakRank(a.category) - _tieBreakRank(b.category);
    });
    var pool;
    if (riskScore > 0) {
      var activeRisk = ordered.filter(function (s) {
        return s && s.type === 'risk' && _isActive(s);
      });
      pool = activeRisk.length
        ? activeRisk
        : ordered.filter(function (s) { return s && s.type === 'risk'; });
    } else {
      pool = ordered;
    }
    if (!pool.length) return 'بدون Signal فعال';
    return pool.slice(0, 2).map(function (s) { return s.reason; }).join(' + ');
  }

  function calculateCustomerPriority(cid) {
    var risk = (typeof calculateCustomerRisk === 'function')
      ? calculateCustomerRisk(cid)
      : { customerId: cid, score: 0, level: 'low', signals: [] };

    var signals = risk.signals || [];
    var riskComponent = (typeof risk.score === 'number' && isFinite(risk.score)) ? risk.score : 0;
    var economicComponent = _economicScore(cid);
    var opportunityComponent = _opportunityScore(signals);
    var timingComponent = _timingScore(cid);

    var weighted =
      W_RISK * riskComponent +
      W_ECONOMIC * economicComponent +
      W_OPPORTUNITY * opportunityComponent +
      W_TIMING * timingComponent;

    var priorityScore = Math.round(weighted * 10) / 10;
    if (priorityScore > 100) priorityScore = 100;
    if (priorityScore < 0) priorityScore = 0;

    // No signals at all → hard zero (compatibility with prior behaviour)
    if (!signals.length && riskComponent === 0) {
      priorityScore = 0;
    }

    var primarySignal = _pickPrimarySignal(signals);
    var reason = _buildReason(signals, riskComponent);
    var priorityLevel = _levelFromScore(priorityScore);

    // P-08: explanatory story layer — does not affect score/level
    var customerStory = null;
    if (typeof buildCustomerStory === 'function') {
      try {
        customerStory = buildCustomerStory(cid);
      } catch (eStory) {
        customerStory = null;
      }
    }

    return {
      customerId: cid,
      priorityScore: priorityScore,
      priorityLevel: priorityLevel,
      riskScore: risk.score,
      riskLevel: risk.level,
      signals: signals,
      primarySignal: primarySignal,
      reason: reason,
      breakdown: {
        risk: riskComponent,
        economic: economicComponent,
        opportunity: opportunityComponent,
        timing: timingComponent,
        weights: {
          risk: W_RISK,
          economic: W_ECONOMIC,
          opportunity: W_OPPORTUNITY,
          timing: W_TIMING
        },
        weighted: priorityScore
      },
      customerStory: customerStory
    };
  }

  function calculateAllCustomerPriorities() {
    if (typeof data === 'undefined' || !Array.isArray(data.customers)) return [];

    var customers = data.customers.filter(function (c) { return c && c.active !== false; });
    var results = customers.map(function (c) {
      return calculateCustomerPriority(c.id);
    });

    results.sort(function (a, b) {
      if (b.priorityScore !== a.priorityScore) return b.priorityScore - a.priorityScore;
      var ra = a.primarySignal ? _tieBreakRank(a.primarySignal.category) : TIE_BREAK_ORDER.length;
      var rb = b.primarySignal ? _tieBreakRank(b.primarySignal.category) : TIE_BREAK_ORDER.length;
      return ra - rb;
    });

    return results;
  }

  global.calculateCustomerPriority = calculateCustomerPriority;
  global.calculateAllCustomerPriorities = calculateAllCustomerPriorities;

})(typeof window !== 'undefined' ? window : this);
