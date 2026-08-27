/* js/intelligence/signals.js — Signal Engine (MVP, Patch-only).
   ============================================================
   READ-ONLY layer on top of the existing system:

     Existing Data (data.customers/invoices/checks/...)
           |
     Existing calc.js (customerBehavior, customerInvoices, ...)
           |
     THIS FILE (signals.js)
           |
        Signal[]

   Rules followed (per spec):
   - Does not mutate any data.
   - Does not write to IndexedDB.
   - Does not change calc.js, the DB schema, or existing UI.
   - Only reads from customerBehavior(cid) and, where explicitly
     allowed, data.checks / data.customers.
   - No PAYMENT_PATTERN_BREAK, no Cross-sell, no Basket Growth,
     no AI/ML, no invented thresholds beyond what was specified.

   Public API:
     extractCustomerSignals(cid) -> Signal[]

   Signal shape:
     {
       id, customerId, type, category, severity,
       value, unit, reason, confidence, detectedAt,
       actionable, source
     }
   ============================================================ */
'use strict';

(function (global) {

  /* ---------------------------------------------------------
     Small local helpers (kept private to this file — no
     collisions with existing globals, nothing exported besides
     extractCustomerSignals).
     --------------------------------------------------------- */

  function _nowISO() {
    // Consistent with the rest of the app's date handling (todayISO
    // is date-only); detectedAt should carry a real timestamp for
    // traceability, so use a full ISO datetime instead.
    return new Date().toISOString();
  }

  function _round(n, dp) {
    const m = Math.pow(10, dp || 0);
    return Math.round((n + Number.EPSILON) * m) / m;
  }

  function _pctChange(from, to) {
    // ((from - to) / from) * 100  -- caller decides direction (decline vs growth)
    if (!from) return null;
    return ((from - to) / from) * 100;
  }

  function _fa(n) {
    // Persian-friendly integer for reason strings; keep plain if not finite.
    if (!isFinite(n)) return String(n);
    return String(Math.round(n));
  }

  function _mkSignal(cid, category, opts) {
    return {
      id: 'sig_' + cid + '_' + category,
      customerId: cid,
      type: opts.type,
      category: category,
      severity: opts.severity,
      value: opts.value,
      unit: opts.unit,
      reason: opts.reason,
      confidence: opts.confidence != null ? opts.confidence : 0.9,
      detectedAt: _nowISO(),
      actionable: opts.actionable !== false,
      source: opts.source || 'customerBehavior',
    };
  }

  /* ---------------------------------------------------------
     1-3: Purchase decline / growth (based on sales30 vs salesPrev30)
     --------------------------------------------------------- */
  function _purchaseTrendSignals(cid, b, out) {
    if (!(b.salesPrev30 > 0)) return; // false-positive rule: no signal if no baseline

    const declinePct = _pctChange(b.salesPrev30, b.sales30); // positive => decline
    const growthPct = _pctChange(b.sales30, 0) != null
      ? ((b.sales30 - b.salesPrev30) / b.salesPrev30) * 100
      : null;

    if (declinePct != null && declinePct >= 30) {
      out.push(_mkSignal(cid, 'PURCHASE_DECLINE_SEVERE', {
        type: 'risk',
        severity: 'critical',
        value: _round(declinePct, 1),
        unit: '%',
        reason: 'خرید ' + _fa(declinePct) + '٪ کاهش یافته است',
        confidence: 0.9,
      }));
      return; // duplication rule: severe suppresses mild
    }

    if (declinePct != null && declinePct >= 15 && declinePct < 30) {
      out.push(_mkSignal(cid, 'PURCHASE_DECLINE_MILD', {
        type: 'risk',
        severity: 'medium',
        value: _round(declinePct, 1),
        unit: '%',
        reason: 'خرید ' + _fa(declinePct) + '٪ کاهش یافته است',
        confidence: 0.85,
      }));
    }

    if (growthPct != null && growthPct >= 20) {
      out.push(_mkSignal(cid, 'PURCHASE_GROWTH', {
        type: 'opportunity',
        severity: 'high',
        value: _round(growthPct, 1),
        unit: '%',
        reason: 'خرید ' + _fa(growthPct) + '٪ رشد داشته است',
        confidence: 0.85,
      }));
    }
  }

  /* ---------------------------------------------------------
     4: BEHIND_PATTERN — reuse existing behavior flag as-is
     --------------------------------------------------------- */
  function _behindPatternSignal(cid, b, out) {
    if (b.behindPattern !== true) return; // covers false/null/undefined
    out.push(_mkSignal(cid, 'BEHIND_PATTERN', {
      type: 'risk',
      severity: 'high',
      value: b.daysSinceLast,
      unit: 'days',
      reason: 'از الگوی معمول خرید مشتری عقب افتاده است',
      confidence: 0.85,
    }));
  }

  /* ---------------------------------------------------------
     5: CONSECUTIVE_NO_ORDER
     --------------------------------------------------------- */
  function _consecutiveNoOrderSignal(cid, b, out) {
    if (!(b.visitCount >= 2)) return; // false-positive rule
    if (!(b.consecutiveNoOrder >= 2)) return;
    out.push(_mkSignal(cid, 'CONSECUTIVE_NO_ORDER', {
      type: 'risk',
      severity: 'high',
      value: b.consecutiveNoOrder,
      unit: 'count',
      reason: _fa(b.consecutiveNoOrder) + ' ویزیت متوالی بدون سفارش',
      confidence: 0.9,
    }));
  }

  /* ---------------------------------------------------------
     6: BASKET_SHRINK
     --------------------------------------------------------- */
  function _basketShrinkSignal(cid, b, out) {
    if (!(b.invoiceCount >= 4)) return;
    const declining = Array.isArray(b.decliningProducts) ? b.decliningProducts : [];
    if (!(declining.length >= 1)) return;
    out.push(_mkSignal(cid, 'BASKET_SHRINK', {
      type: 'risk',
      severity: 'medium',
      value: declining.length,
      unit: 'count',
      reason: 'تنوع سبد خرید کاهش یافته است',
      confidence: 0.75,
    }));
  }

  /* ---------------------------------------------------------
     7: KEY_PRODUCT_LOST
     Uses only fields that actually exist on decliningProducts:
     name, productId, earlyQty, lateQty (see calc.js).
     A product only "existed before" if it appears in
     decliningProducts with earlyQty > 0 (i.e. it was actually
     purchased in the earlier half of the customer's history).
     --------------------------------------------------------- */
  function _keyProductLostSignal(cid, b, out) {
    const declining = Array.isArray(b.decliningProducts) ? b.decliningProducts : [];
    const lost = declining.filter(function (p) {
      return p && p.earlyQty >= 5 && p.lateQty === 0;
    });
    if (!lost.length) return;

    // decliningProducts (from calc.js) doesn't carry invoice-level
    // presence counts, only aggregated early/late qty — so the
    // ">50% of prior-period invoices" importance boost described in
    // the spec cannot be computed from the data actually available.
    // Per instructions ("اگر ساختار کافی نیست، حدس نزن")، این بخش
    // پیاده‌سازی نشد و confidence بر همان مبنای earlyQty/lateQty ثابت می‌ماند.
    const names = lost.map(function (p) { return p.name; }).filter(Boolean);
    const reason = names.length === 1
      ? 'محصول کلیدی «' + names[0] + '» دیگر خریداری نمی‌شود'
      : 'محصولات کلیدی (' + names.join('، ') + ') دیگر خریداری نمی‌شوند';

    out.push(_mkSignal(cid, 'KEY_PRODUCT_LOST', {
      type: 'risk',
      severity: 'high',
      value: lost.length,
      unit: 'count',
      reason: reason,
      confidence: 0.8,
    }));
  }

  /* ---------------------------------------------------------
     8: LONG_NO_VISIT
     --------------------------------------------------------- */
  function _longNoVisitSignal(cid, b, out) {
    // Fallback only when visit cadence is unavailable.
    if (typeof visitCadence === 'function' && visitCadence(cid)) return;
    if (!b.lastVisit) return;
    if (b.invoiceCount < 2) return;

    const lastVisitDate = b.lastVisit.date;
    if (!lastVisitDate) return;
    const days = (typeof daysAgo === 'function') ? daysAgo(lastVisitDate) : null;
    if (days == null || !isFinite(days)) return;
    if (days < 45) return;

    out.push(_mkSignal(cid, 'LONG_NO_VISIT', {
      type: 'risk',
      severity: 'medium',
      value: days,
      unit: 'days',
      reason: _fa(days) + ' روز است که مشتری ویزیت نشده است',
      confidence: 0.85,
    }));
  }

  /* ---------------------------------------------------------
     VISIT_OVERDUE — cadence-based (when cadence exists).
     Buffer = min(7, cadence * 0.5). Does not replace LONG_NO_VISIT
     fallback for customers without cadence.
     --------------------------------------------------------- */
  function _visitOverdueSignal(cid, b, out) {
    if (typeof visitCadence !== 'function') return;
    const cadence = visitCadence(cid);
    if (!cadence) return;

    let daysSince = null;
    if (b && b.lastVisit && b.lastVisit.date) {
      daysSince = (typeof daysAgo === 'function') ? daysAgo(b.lastVisit.date) : null;
    }
    if (daysSince == null || !isFinite(daysSince)) {
      if (typeof data !== 'undefined' && Array.isArray(data.customers)) {
        const cust = data.customers.find(function (c) { return c && c.id === cid; });
        const visits = (cust && Array.isArray(cust.visits)) ? cust.visits.slice() : [];
        if (visits.length) {
          visits.sort(function (a, b2) {
            return String(b2.date || '').localeCompare(String(a.date || ''));
          });
          if (visits[0] && visits[0].date) {
            daysSince = (typeof daysAgo === 'function') ? daysAgo(visits[0].date) : null;
          }
        }
      }
    }
    if (daysSince == null || !isFinite(daysSince)) return;

    const buffer = Math.min(7, cadence * 0.5);
    if (daysSince <= cadence + buffer) return;

    const overdue = Math.max(0, daysSince - cadence);
    const severity = overdue > (2 * cadence) ? 'high' : 'medium';

    out.push(_mkSignal(cid, 'VISIT_OVERDUE', {
      type: 'risk',
      severity: severity,
      value: overdue,
      unit: 'days',
      reason: 'ویزیت ' + _fa(overdue) + ' روز از الگوی معمول عقب افتاده است',
      confidence: 0.8,
    }));
  }

  /* ---------------------------------------------------------
     VISIT_CONVERSION_LOW — low-severity; does not override stronger signals.
     visitCount >= 3 and conversionRate < 0.5
     --------------------------------------------------------- */
  function _visitConversionLowSignal(cid, b, out) {
    if (!b) return;
    if (!(b.visitCount >= 3)) return;
    if (!(typeof b.conversionRate === 'number' && b.conversionRate < 0.5)) return;
    if (out.some(function (s) { return s && s.category === 'VISIT_CONVERSION_LOW'; })) return;

    out.push(_mkSignal(cid, 'VISIT_CONVERSION_LOW', {
      type: 'risk',
      severity: 'low',
      value: _round((b.conversionRate || 0) * 100, 0),
      unit: '%',
      reason: 'ویزیت‌های اخیر به سفارش تبدیل نشده‌اند — بررسی کنید',
      confidence: 0.75,
    }));
  }

  /* ---------------------------------------------------------
     Conditional payment signals — only when data.checks exists
     and is non-empty. Uses data.checks + data.customers directly
     (as explicitly allowed by the spec), never mutated.
     --------------------------------------------------------- */
  function _paymentSignals(cid, out) {
    if (typeof data === 'undefined' || !Array.isArray(data.checks) || data.checks.length === 0) {
      return;
    }
    const today = (typeof todayISO === 'function') ? todayISO() : new Date().toISOString().slice(0, 10);
    const custChecks = data.checks.filter(function (c) { return c && c.customerId === cid; });
    if (!custChecks.length) return;

    const bounced = custChecks.filter(function (c) { return c.status === 'bounced'; });
    if (bounced.length) {
      out.push(_mkSignal(cid, 'CHECK_BOUNCED', {
        type: 'risk',
        severity: 'critical',
        value: bounced.length,
        unit: 'count',
        reason: bounced.length === 1
          ? 'یک چک برگشتی دارد'
          : _fa(bounced.length) + ' چک برگشتی دارد',
        confidence: 0.95,
        source: 'data.checks',
      }));
    }

    const overdue = custChecks.filter(function (c) {
      return c.status === 'pending' && c.dueDate && c.dueDate < today;
    });
    if (overdue.length) {
      out.push(_mkSignal(cid, 'PAYMENT_OVERDUE', {
        type: 'risk',
        severity: 'high',
        value: overdue.length,
        unit: 'count',
        reason: overdue.length === 1
          ? 'یک چک سررسیدگذشته و وصول‌نشده دارد'
          : _fa(overdue.length) + ' چک سررسیدگذشته و وصول‌نشده دارد',
        confidence: 0.9,
        source: 'data.checks',
      }));
    }
  }

  /* ---------------------------------------------------------
     Main entry point
     --------------------------------------------------------- */
  function extractCustomerSignals(cid) {
    const out = [];
    if (!cid) return out;
    if (typeof customerBehavior !== 'function') return out;

    const b = customerBehavior(cid);
    if (!b) return out;

    // Signals 1-3 require at least a comparable previous-30-day baseline;
    // customerBehavior() itself returns 0 (not null) when there's no data,
    // and the false-positive rule (#10) already guards on salesPrev30 > 0.
    _purchaseTrendSignals(cid, b, out);
    _behindPatternSignal(cid, b, out);
    _consecutiveNoOrderSignal(cid, b, out);
    _basketShrinkSignal(cid, b, out);
    _keyProductLostSignal(cid, b, out);
    _visitOverdueSignal(cid, b, out);
    _longNoVisitSignal(cid, b, out);
    _visitConversionLowSignal(cid, b, out);

    // openingBalance is intentionally never inspected here — signals are
    // based only on actual recorded behavior (invoices/visits/checks),
    // never on the pre-existing opening balance itself (spec #7).
    _paymentSignals(cid, out);

    return out;
  }

  global.extractCustomerSignals = extractCustomerSignals;

})(typeof window !== 'undefined' ? window : this);
