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

  function calculateCustomerRisk(cid) {
    const signals = (typeof extractCustomerSignals === 'function')
      ? (extractCustomerSignals(cid) || [])
      : [];

    const riskSignals = signals.filter(function (s) { return s && s.type === 'risk'; });

    let score = 0;
    riskSignals.forEach(function (s) {
      // Prefer severityPoints when present (SKU intelligence F7 / Risk Contract).
      if (s && typeof s.severityPoints === 'number' && isFinite(s.severityPoints)) {
        score += s.severityPoints;
      } else {
        score += SEVERITY_POINTS[s.severity] || 0;
      }
    });
    if (score > 100) score = 100;

    return {
      customerId: cid,
      score: score,
      level: _levelFromScore(score),
      signals: signals, // full signal set (risk + opportunity) passed through untouched
    };
  }

  global.calculateCustomerRisk = calculateCustomerRisk;

})(typeof window !== 'undefined' ? window : this);
