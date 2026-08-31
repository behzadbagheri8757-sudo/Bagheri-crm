/* js/intelligence/risk.js — Risk Engine (Patch-only, on top of Signal Engine).
   ============================================================
   READ-ONLY layer:

     extractCustomerSignals(cid)   [js/intelligence/signals.js]
           |
     THIS FILE (risk.js)
           |
        { customerId, score, level, signals }

   Rules followed (per spec):
   - Only signals with type === "risk" affect the score.
   - Opportunity signals never affect risk (they pass through untouched
     for later use by an Action Engine, but contribute 0 to score).
   - Score = sum of risk-signal severity points, capped at 100.
   - No signal => score 0, level "low".
   - Does not mutate any data, does not touch calc.js/signals.js/DB.
   - openingBalance is never read here — risk is driven only by
     signals (which are themselves behavior-based, not balance-based).

   P-01 Double-Counting Prevention:
   - Signals carry sourceLevel: 'account' | 'sku' (set by Signal Engine).
   - If at least one risk signal has sourceLevel === 'account', only
     account-level risk signals contribute to the score.
   - If no account-level risk signal exists, SKU-level risk signals
     contribute (fallback).
   - Signal array is never filtered/mutated — Priority and Action still
     see the full set.

   P-02 Persistence:
   - Only signals with status === 'active' contribute to the score.
   - If status is missing (persistence module absent), treat as active
     for backward compatibility.
   - Pending signals remain in the array for Priority/Action visibility.

   P-03 Seller Feedback:
   - effectivePoints = basePoints + riskModifier (if present)
   - effectivePoints floored at 0; total score capped at 100
   - No feedback => modifier 0 (identical to pre-P-03 behaviour)
   - Does not bypass P-01 dominance or P-02 active gate
   ============================================================ */
'use strict';

(function (global) {

  const SEVERITY_POINTS = {
    critical: 100,
    high: 70,
    medium: 40,
    low: 20,
  };

  function _levelFromScore(score) {
    if (score >= 75) return 'critical';
    if (score >= 50) return 'high';
    if (score >= 25) return 'medium';
    return 'low';
  }

  function _basePoints(s) {
    if (s && typeof s.severityPoints === 'number' && isFinite(s.severityPoints)) {
      return s.severityPoints;
    }
    return SEVERITY_POINTS[s && s.severity] || 0;
  }

  function _signalPoints(s) {
    var base = _basePoints(s);
    var mod = 0;
    if (s && typeof s.riskModifier === 'number' && isFinite(s.riskModifier)) {
      mod = s.riskModifier;
    }
    var effective = base + mod;
    if (effective < 0) effective = 0;
    return effective;
  }

  function _isActiveForRisk(s) {
    // P-02: only active scores. Missing status => active (backward compat
    // when persistence.js is not loaded).
    if (!s) return false;
    if (s.status == null || s.status === undefined) return true;
    return s.status === 'active';
  }

  function calculateCustomerRisk(cid) {
    const signals = (typeof extractCustomerSignals === 'function')
      ? (extractCustomerSignals(cid) || [])
      : [];

    const riskSignals = signals.filter(function (s) {
      return s && s.type === 'risk' && _isActiveForRisk(s);
    });

    // P-01: account-level risk dominates; SKU-level only when no account risk.
    var hasAccountRisk = false;
    for (var i = 0; i < riskSignals.length; i++) {
      if (riskSignals[i].sourceLevel === 'account') {
        hasAccountRisk = true;
        break;
      }
    }

    var scoringPool = riskSignals;
    if (hasAccountRisk) {
      scoringPool = riskSignals.filter(function (s) {
        return s.sourceLevel === 'account';
      });
    }
    // else: no account risk → all remaining risk signals (SKU-level) score

    let score = 0;
    scoringPool.forEach(function (s) {
      score += _signalPoints(s);
    });
    if (score > 100) score = 100;

    return {
      customerId: cid,
      score: score,
      level: _levelFromScore(score),
      signals: signals, // full signal set (risk + opportunity, pending + active)
    };
  }

  global.calculateCustomerRisk = calculateCustomerRisk;

})(typeof window !== 'undefined' ? window : this);
