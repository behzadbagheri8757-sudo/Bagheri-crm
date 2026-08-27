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

   Unified Daily Work Queue (additive):
     calculateAllActions() merges customer + prospect actions with
     unifiedScore = urgency + impact + timing. Fully read-only.
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
    'VISIT_OVERDUE',
    'VISIT_CONVERSION_LOW',
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
    VISIT_OVERDUE: {
      actionType: 'visit',
      urgency: 'medium',
      action: 'ویزیت حضوری — از الگوی ویزیت عقب افتاده',
    },
    VISIT_CONVERSION_LOW: {
      actionType: 'visit',
      urgency: 'low',
      action: 'بررسی نرخ تبدیل ویزیت به سفارش',
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
  const URGENCY_SCORE = { critical: 40, high: 30, medium: 20, low: 10 };
  const PROSPECT_IMPACT = { 'A+': 30, 'A': 20, 'B': 10, 'C': 0, 'D': 0 };

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

  function _customerImpactMap() {
    const map = Object.create(null);
    if (typeof data === 'undefined' || !Array.isArray(data.customers)) return map;
    if (typeof customerTotals !== 'function') {
      data.customers.forEach(function (c) {
        if (c && c.id) map[c.id] = 15;
      });
      return map;
    }
    const rows = [];
    data.customers.forEach(function (c) {
      if (!c || c.active === false) return;
      let invTotal = null;
      try {
        const t = customerTotals(c.id);
        if (t && typeof t.invTotal === 'number' && isFinite(t.invTotal)) invTotal = t.invTotal;
      } catch (e) {}
      rows.push({ id: c.id, invTotal: invTotal });
    });
    const ranked = rows.filter(function (r) { return r.invTotal != null; })
      .sort(function (a, b) { return (b.invTotal || 0) - (a.invTotal || 0); });
    const n = ranked.length;
    ranked.forEach(function (r, i) {
      if (n === 0) { map[r.id] = 15; return; }
      const pct = (i + 1) / n;
      if (pct <= 0.2) map[r.id] = 30;
      else if (pct <= 0.8) map[r.id] = 20;
      else map[r.id] = 10;
    });
    rows.forEach(function (r) {
      if (map[r.id] == null) map[r.id] = 15;
    });
    return map;
  }

  function _customerTiming(cid) {
    const overdue = (typeof visitOverdueDays === 'function') ? visitOverdueDays(cid) : 0;
    if (overdue > 14) return 30;
    if (overdue > 7) return 25;
    return 10;
  }

  function _customerWhyNow(cid) {
    const overdue = (typeof visitOverdueDays === 'function') ? visitOverdueDays(cid) : 0;
    if (overdue > 0) return 'ویزیت ' + Math.round(overdue) + ' روز عقب‌افتاده';
    if (typeof customerBehavior === 'function') {
      try {
        const b = customerBehavior(cid);
        if (b && b.lastVisit && b.lastVisit.date && typeof daysAgo === 'function') {
          const d = daysAgo(b.lastVisit.date);
          if (d != null && isFinite(d) && d !== Infinity) {
            return d === 0 ? 'ویزیت امروز' : (Math.round(d) + ' روز از آخرین ویزیت');
          }
        }
      } catch (e) {}
    }
    return 'نیاز به پیگیری';
  }

  function _prospectTiming(days) {
    if (days == null || !isFinite(days)) return 10;
    if (days > 14) return 25;
    return 10;
  }

  function _buildProspectActions() {
    const out = [];
    if (typeof prospectState === 'undefined' || !Array.isArray(prospectState.shops)) return out;

    prospectState.shops.forEach(function (shop) {
      if (!shop || shop.status === 'converted') return;
      if (shop.status && shop.status !== 'active') return;

      const rank = shop.latestRank || 'D';
      const days = (typeof daysSinceLastEvaluation === 'function')
        ? daysSinceLastEvaluation(shop.id)
        : null;

      if (days != null && days <= 3) return;

      if (rank === 'C' || rank === 'D') {
        if (days == null || days <= 30) return;
      }

      const impact = PROSPECT_IMPACT[rank] != null ? PROSPECT_IMPACT[rank] : 0;
      const urgency = 'medium';
      const urgencyPts = URGENCY_SCORE[urgency] || 20;
      const timingPts = _prospectTiming(days);
      const unifiedScore = urgencyPts + impact + timingPts;
      const daysLabel = (days != null && isFinite(days)) ? Math.round(days) : '—';

      out.push({
        type: 'prospect',
        prospectId: shop.id,
        customerId: null,
        name: shop.name || '—',
        action: 'ارزیابی مجدد مغازه',
        actionType: 'prospect_followup',
        urgency: urgency,
        reason: 'رتبه ' + rank + (shop.latestScore != null ? (' — امتیاز ' + shop.latestScore) : ''),
        whyNow: daysLabel + ' روز از ارزیابی گذشته',
        priorityScore: impact,
        unifiedScore: unifiedScore,
        primarySignal: null,
        riskLevel: 'low',
      });
    });
    return out;
  }

  function calculateAllActions() {
    const impactMap = _customerImpactMap();
    const actions = [];

    if (typeof data !== 'undefined' && Array.isArray(data.customers)) {
      data.customers.forEach(function (c) {
        if (!c || c.active === false) return;
        const base = calculateCustomerAction(c.id);
        if (!base || base.actionType === 'no_action') return;

        const urgencyPts = URGENCY_SCORE[base.urgency] || 10;
        const impactPts = impactMap[c.id] != null ? impactMap[c.id] : 15;
        const timingPts = _customerTiming(c.id);
        const unifiedScore = urgencyPts + impactPts + timingPts;
        const whyNow = _customerWhyNow(c.id);

        actions.push({
          type: 'customer',
          customerId: c.id,
          prospectId: null,
          name: c.name || '—',
          action: base.action,
          actionType: base.actionType,
          urgency: base.urgency,
          reason: base.reason,
          whyNow: whyNow,
          priorityScore: base.priorityScore || 0,
          unifiedScore: unifiedScore,
          primarySignal: base.primarySignal || null,
          riskLevel: base.riskLevel || 'low',
        });
      });
    }

    const prospectActions = _buildProspectActions();
    for (let i = 0; i < prospectActions.length; i++) actions.push(prospectActions[i]);

    actions.sort(function (a, b) {
      if (b.unifiedScore !== a.unifiedScore) return b.unifiedScore - a.unifiedScore;
      if (b.priorityScore !== a.priorityScore) return b.priorityScore - a.priorityScore;
      return String(a.name || '').localeCompare(String(b.name || ''), 'fa');
    });

    return actions;
  }

  global.calculateCustomerAction = calculateCustomerAction;
  global.calculateAllCustomerActions = calculateAllCustomerActions;
  global.calculateAllActions = calculateAllActions;

})(typeof window !== 'undefined' ? window : this);
