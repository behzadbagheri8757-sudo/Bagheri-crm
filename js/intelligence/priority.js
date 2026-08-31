/* js/intelligence/priority.js — Priority Engine (Patch-only, on top of
   Signal Engine + Risk Engine).
   ============================================================
   READ-ONLY layer:

     calculateCustomerRisk(cid)   [js/intelligence/risk.js]
           |
     THIS FILE (priority.js)
           |
        { customerId, priorityScore, priorityLevel, riskScore,
          riskLevel, signals, primarySignal, reason }

   Rules followed (per spec):
   - Priority base = risk score (risk stays the dominant driver).
   - Category tie-break order used ONLY to pick a stable primarySignal
     and to break ties between customers with equal priorityScore in
     calculateAllCustomerPriorities() — it never inflates the score
     itself, so a purely-opportunity customer (risk 0) can never
     outrank an at-risk customer.
   - Opportunity signals contribute 0 to priorityScore, exactly like
     in the Risk Engine, but remain visible in `signals` for a future
     Action Engine.
   - Fully read-only: no writes to data/IndexedDB/customers/etc.
   - openingBalance is never read here.
   ============================================================ */
'use strict';

(function (global) {

  // Lower index = more urgent / wins tie-break.
  const TIE_BREAK_ORDER = [
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
    'PURCHASE_GROWTH',
  ];

  function _tieBreakRank(category) {
    const idx = TIE_BREAK_ORDER.indexOf(category);
    return idx === -1 ? TIE_BREAK_ORDER.length : idx; // unknown categories rank last
  }

  function _levelFromScore(score) {
    if (score >= 75) return 'urgent';
    if (score >= 50) return 'high';
    if (score >= 25) return 'normal';
    return 'low';
  }

  /* Pick the single most important signal for display purposes, using
     the fixed tie-break order across ALL signals (risk + opportunity),
     so a customer with only PURCHASE_GROWTH still gets a sensible
     primarySignal even though it contributes no risk. */
  function _pickPrimarySignal(signals) {
    if (!signals || !signals.length) return null;
    let best = null;
    let bestRank = Infinity;
    signals.forEach(function (s) {
      const r = _tieBreakRank(s.category);
      if (r < bestRank) {
        bestRank = r;
        best = s;
      }
    });
    return best;
  }

  /* Short, user-displayable reason: combine up to the top 2 signals
     (by tie-break order), preferring risk signals when any exist. */
  function _buildReason(signals, riskScore) {
    if (!signals || !signals.length) return 'بدون Signal فعال';

    const ordered = signals.slice().sort(function (a, b) {
      return _tieBreakRank(a.category) - _tieBreakRank(b.category);
    });

    const pool = riskScore > 0
      ? ordered.filter(function (s) { return s.type === 'risk'; })
      : ordered;

    if (!pool.length) return 'بدون Signal فعال';

    const top = pool.slice(0, 2).map(function (s) { return s.reason; });
    return top.join(' + ');
  }

  function calculateCustomerPriority(cid) {
    const risk = (typeof calculateCustomerRisk === 'function')
      ? calculateCustomerRisk(cid)
      : { customerId: cid, score: 0, level: 'low', signals: [] };

    const priorityScore = risk.score; // risk remains the sole numeric driver
    const priorityLevel = _levelFromScore(priorityScore);
    const primarySignal = _pickPrimarySignal(risk.signals);
    const reason = _buildReason(risk.signals, risk.score);

    return {
      customerId: cid,
      priorityScore: priorityScore,
      priorityLevel: priorityLevel,
      riskScore: risk.score,
      riskLevel: risk.level,
      signals: risk.signals,
      primarySignal: primarySignal,
      reason: reason,
    };
  }

  /* Reads existing customers, computes priority for each, sorts by
     priorityScore desc — with the fixed category tie-break order as a
     secondary key so equal-score customers still land in a stable,
     meaningful order. Nothing is stored. */
  function calculateAllCustomerPriorities() {
    if (typeof data === 'undefined' || !Array.isArray(data.customers)) return [];

    const customers = data.customers.filter(function (c) { return c && c.active !== false; });

    const results = customers.map(function (c) {
      return calculateCustomerPriority(c.id);
    });

    results.sort(function (a, b) {
      if (b.priorityScore !== a.priorityScore) return b.priorityScore - a.priorityScore;
      const ra = a.primarySignal ? _tieBreakRank(a.primarySignal.category) : TIE_BREAK_ORDER.length;
      const rb = b.primarySignal ? _tieBreakRank(b.primarySignal.category) : TIE_BREAK_ORDER.length;
      return ra - rb;
    });

    return results;
  }

  global.calculateCustomerPriority = calculateCustomerPriority;
  global.calculateAllCustomerPriorities = calculateAllCustomerPriorities;

})(typeof window !== 'undefined' ? window : this);
