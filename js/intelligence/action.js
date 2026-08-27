/* js/intelligence/action.js — Action Engine (Patch-only, on top of
   Signal Engine + Risk Engine + Priority Engine).
   ============================================================
   READ-ONLY layer:

     calculateCustomerPriority(cid)   [js/intelligence/priority.js]
           |
     THIS FILE (action.js)
           |
        { customerId, action, actionType, urgency, reason,
          primarySignal, priorityScore, riskLevel }

   Rules followed (per spec):
   - Fully read-only: no writes to data/IndexedDB/customers/invoices/
     payments/checks/inventory.
   - Does not modify signals.js / risk.js / priority.js.
   - The winning signal (and therefore actionType/urgency) is chosen
     using the fixed Action-priority order given in the spec — this
     order is DELIBERATELY separate from (and slightly different to)
     priority.js's own tie-break order; each engine owns its own
     ordering, so priority.js was left untouched.
   - An opportunity signal (PURCHASE_GROWTH) can only ever win when no
     risk signal is present at all — it never dilutes or overrides a
     risk-driven action.
   - No signal at all => no_action / low.
   ============================================================ */
'use strict';

(function (global) {

  // Fixed action-selection order, exactly as specified for this engine.
  const ACTION_PRIORITY_ORDER = [
    'CHECK_BOUNCED',
    'PAYMENT_OVERDUE',
    'PURCHASE_DECLINE_SEVERE',
    'BEHIND_PATTERN',
    'CONSECUTIVE_NO_ORDER',
    'KEY_PRODUCT_LOST',
    'BASKET_SHRINK',
    'PURCHASE_DECLINE_MILD',
    'LONG_NO_VISIT',
    'PURCHASE_GROWTH',
  ];

  // category -> { actionType, urgency, action (Persian, user-facing) }
  const ACTION_RULES = {
    CHECK_BOUNCED: {
      actionType: 'check_followup',
      urgency: 'critical',
      action: 'پیگیری فوری چک برگشتی',
    },
    PAYMENT_OVERDUE: {
      actionType: 'payment_followup',
      urgency: 'high',
      action: 'پیگیری وصول مطالبات سررسیدگذشته',
    },
    PURCHASE_DECLINE_SEVERE: {
      actionType: 'visit',
      urgency: 'high',
      action: 'ویزیت حضوری برای بررسی افت شدید خرید',
    },
    BEHIND_PATTERN: {
      actionType: 'visit',
      urgency: 'high',
      action: 'ویزیت حضوری — مشتری از الگوی خرید عقب افتاده',
    },
    CONSECUTIVE_NO_ORDER: {
      actionType: 'visit',
      urgency: 'high',
      action: 'ویزیت حضوری برای شکستن روند بدون‌سفارشی',
    },
    KEY_PRODUCT_LOST: {
      actionType: 'visit',
      urgency: 'medium',
      action: 'ویزیت حضوری برای بررسی توقف خرید محصول کلیدی',
    },
    BASKET_SHRINK: {
      actionType: 'visit',
      urgency: 'medium',
      action: 'ویزیت حضوری برای بررسی کوچک‌شدن سبد خرید',
    },
    PURCHASE_DECLINE_MILD: {
      actionType: 'visit',
      urgency: 'medium',
      action: 'ویزیت حضوری برای بررسی کاهش خفیف خرید',
    },
    LONG_NO_VISIT: {
      actionType: 'visit',
      urgency: 'medium',
      action: 'ویزیت حضوری — مدتی است مشتری دیده نشده',
    },
    PURCHASE_GROWTH: {
      actionType: 'follow_up',
      urgency: 'low',
      action: 'پیگیری تلفنی برای تثبیت و تقویت رشد خرید',
    },
  };

  const NO_ACTION_RESULT_BASE = {
    action: 'اقدامی لازم نیست',
    actionType: 'no_action',
    urgency: 'low',
    reason: 'بدون Signal فعال',
  };

  function _actionPriorityRank(category) {
    const idx = ACTION_PRIORITY_ORDER.indexOf(category);
    return idx === -1 ? ACTION_PRIORITY_ORDER.length : idx;
  }

  /* Pick the winning signal using ONLY the categories this engine
     knows how to act on (i.e. the 10 listed above). Any signal with
     an unrecognized category is ignored for action-selection purposes
     (it still isn't lost — it stays inside the untouched `signals`
     array coming from priority.js, but this engine has no rule for it
     and so cannot responsibly turn it into an action). */
  function _pickActionSignal(signals) {
    if (!signals || !signals.length) return null;
    let best = null;
    let bestRank = Infinity;
    signals.forEach(function (s) {
      if (!s || !ACTION_RULES[s.category]) return;
      const r = _actionPriorityRank(s.category);
      if (r < bestRank) {
        bestRank = r;
        best = s;
      }
    });
    return best;
  }

  function calculateCustomerAction(cid) {
    const priority = (typeof calculateCustomerPriority === 'function')
      ? calculateCustomerPriority(cid)
      : { customerId: cid, priorityScore: 0, riskLevel: 'low', signals: [] };

    const winner = _pickActionSignal(priority.signals);

    if (!winner) {
      return Object.assign({
        customerId: cid,
        primarySignal: null,
        priorityScore: priority.priorityScore || 0,
        riskLevel: priority.riskLevel || 'low',
      }, NO_ACTION_RESULT_BASE);
    }

    const rule = ACTION_RULES[winner.category];

    return {
      customerId: cid,
      action: rule.action,
      actionType: rule.actionType,
      urgency: rule.urgency,
      reason: winner.reason,
      primarySignal: winner,
      priorityScore: priority.priorityScore,
      riskLevel: priority.riskLevel,
    };
  }

  const URGENCY_RANK = { critical: 4, high: 3, medium: 2, low: 1 };

  /* Reads existing customers, computes an action for each, sorts by
     urgency desc then priorityScore desc. Nothing is stored. */
  function calculateAllCustomerActions() {
    if (typeof data === 'undefined' || !Array.isArray(data.customers)) return [];

    const customers = data.customers.filter(function (c) { return c && c.active !== false; });

    const results = customers.map(function (c) {
      return calculateCustomerAction(c.id);
    });

    results.sort(function (a, b) {
      const ua = URGENCY_RANK[a.urgency] || 0;
      const ub = URGENCY_RANK[b.urgency] || 0;
      if (ub !== ua) return ub - ua;
      return (b.priorityScore || 0) - (a.priorityScore || 0);
    });

    return results;
  }

  global.calculateCustomerAction = calculateCustomerAction;
  global.calculateAllCustomerActions = calculateAllCustomerActions;

})(typeof window !== 'undefined' ? window : this);
