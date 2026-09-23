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
    'MULTI_SKU_DECLINE',
    'COMBINED_SKU_DETERIORATION',
    'BEHIND_PATTERN',
    'CONSECUTIVE_NO_ORDER',
    'SKU_DELAY',
    'SKU_QUANTITY_DROP',
    'SKU_FREQUENCY_DROP',
    'LINE_DROP',
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
    MULTI_SKU_DECLINE: {
      actionType: 'manager_review',
      urgency: 'high',
      action: 'بررسی مدیر — افت چندمحصولی حساب',
    },
    COMBINED_SKU_DETERIORATION: {
      actionType: 'manager_review',
      urgency: 'high',
      action: 'بررسی مدیر — چند مشکل همزمان روی یک محصول',
    },
    SKU_DELAY: {
      actionType: 'visit',
      urgency: 'high',
      action: 'ویزیت حضوری برای بررسی تأخیر خرید محصول',
    },
    SKU_QUANTITY_DROP: {
      actionType: 'investigate',
      urgency: 'medium',
      action: 'بررسی علت کاهش مقدار خرید محصول',
    },
    SKU_FREQUENCY_DROP: {
      actionType: 'call',
      urgency: 'medium',
      action: 'تماس امروز درباره کاهش تعداد خرید محصول',
    },
    LINE_DROP: {
      actionType: 'visit',
      urgency: 'medium',
      action: 'ویزیت حضوری برای بررسی حذف محصول از سبد',
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
      // BUGFIX (proven by runtime repro): this selection ignored two
      // explicit flags that upstream stages compute for exactly this
      // purpose — persistence.js's s.status ("pending" = not yet
      // confirmed by a second occurrence; immediate categories are
      // already 'active' on first hit, so they are unaffected) and
      // seasonality.js's s.seasonallySuppressed (explicitly marked as a
      // likely false decline). Without these checks, a single unconfirmed
      // or seasonally-explained detection could still generate a concrete
      // operational action. Missing/undefined status is still treated as
      // active, matching the existing convention in risk.js/priority.js.
      if (s.status === 'pending') return;
      if (s.seasonallySuppressed === true) return;
      const r = _actionPriorityRank(s.category);
      if (r < bestRank) {
        bestRank = r;
        best = s;
      }
    });
    return best;
  }

  /* P-07: operational contexts — only from real data; never invent. */
  function stockContext(productId) {
    if (productId == null || productId === '' || productId === 'multi') return null;
    if (typeof data === 'undefined' || !Array.isArray(data.products)) return null;
    var p = null;
    for (var i = 0; i < data.products.length; i++) {
      if (data.products[i] && data.products[i].id === productId) {
        p = data.products[i];
        break;
      }
    }
    if (!p || typeof p.stockQty !== 'number' || !isFinite(p.stockQty)) return null;
    if (p.stockQty <= 0) return 'موجودی انبار تمام است';
    return null; // positive stock is not actionable context for the allowed samples
  }

  function visitContext(customerId, ctx) {
    if (!customerId) return null;
    // Prefer existing visitOverdueDays helper when present
    if (typeof visitOverdueDays === 'function') {
      try {
        var overdue = visitOverdueDays(customerId, ctx);
        if (overdue != null && isFinite(overdue) && overdue > 0) {
          // "ویزیت نزدیک" only when slightly overdue / due soon — keep short
          if (overdue <= 7) return 'در ویزیت بعدی';
          return null; // large overdue already covered by action reason/whyNow
        }
        if (overdue === 0) return 'در ویزیت بعدی';
      } catch (e) { /* ignore */ }
    }
    // Fallback: visitCadence + last visit if both available
    if (typeof visitCadence === 'function' && typeof customerBehavior === 'function' && typeof daysAgo === 'function') {
      try {
        var cadence = visitCadence(customerId, ctx);
        var b = customerBehavior(customerId, ctx);
        if (cadence && b && b.lastVisit && b.lastVisit.date) {
          var days = daysAgo(b.lastVisit.date);
          if (days != null && isFinite(days) && days >= 0) {
            var buffer = Math.min(7, cadence * 0.5);
            // due soon: within cadence window (not heavily overdue)
            if (days <= cadence + buffer && days >= Math.max(0, cadence - buffer)) {
              return 'در ویزیت بعدی';
            }
          }
        }
      } catch (e2) { /* ignore */ }
    }
    return null;
  }

  function feedbackContext(signal) {
    if (!signal) return null;
    // Prefer fields already attached by P-03
    if (signal.feedbackHint) return signal.feedbackHint;
    if (signal.feedback && signal.feedback.reasonCode === 'competitor_bought') {
      return 'از رقیب خریداری شده';
    }
    if (signal.feedback && signal.feedback.reasonCode === 'still_stock') {
      return 'موجودی نزد مشتری';
    }
    // Live lookup only if API exists and nothing attached yet
    if (typeof getFeedbackForSignal === 'function') {
      try {
        var fb = getFeedbackForSignal(signal);
        if (!fb || !fb.reasonCode) return null;
        if (fb.reasonCode === 'competitor_bought') return 'از رقیب خریداری شده';
        if (fb.reasonCode === 'still_stock') return 'موجودی نزد مشتری';
      } catch (e) { /* ignore */ }
    }
    return null;
  }

  function _applyCurrentContextFilter(cid, signals, ctx) {
    if (!Array.isArray(signals) || !signals.length) return signals || [];

    const skuCategories = {
      SKU_DELAY: true,
      SKU_QUANTITY_DROP: true,
      SKU_FREQUENCY_DROP: true,
      LINE_DROP: true,
      COMBINED_SKU_DETERIORATION: true,
    };

    let customer = null;
    if (ctx && typeof ctx.customerById === 'function') {
      customer = ctx.customerById(cid);
    } else if (typeof data !== 'undefined' && Array.isArray(data.customers)) {
      for (let i = 0; i < data.customers.length; i++) {
        if (data.customers[i] && data.customers[i].id === cid) {
          customer = data.customers[i];
          break;
        }
      }
    }

    const visits = customer && Array.isArray(customer.visits) ? customer.visits : [];

    function validISODate(value) {
      return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
    }

    function latestProductContext(productId) {
      let latest = null;
      for (let vi = 0; vi < visits.length; vi++) {
        const visit = visits[vi];
        if (!visit || !validISODate(visit.date) || !Array.isArray(visit.offeredProducts)) continue;
        for (let oi = 0; oi < visit.offeredProducts.length; oi++) {
          const op = visit.offeredProducts[oi];
          if (!op || op.productId !== productId) continue;
          if (!latest || visit.date > latest.date || (visit.date === latest.date && vi > latest.visitIndex) ||
              (visit.date === latest.date && vi === latest.visitIndex && oi > latest.offerIndex)) {
            latest = {
              date: visit.date,
              visitIndex: vi,
              offerIndex: oi,
              reaction: op.reaction,
              rejectionReason: op.rejectionReason,
            };
          }
        }
      }
      return latest;
    }

    function latestNoOrderVisit() {
      let latest = null;
      for (let vi = 0; vi < visits.length; vi++) {
        const visit = visits[vi];
        if (!visit || !validISODate(visit.date)) continue;
        const noOrder = visit.ordered === false ||
          (typeof VISIT_RESULTS !== 'undefined' && visit.result !== VISIT_RESULTS[0]);
        if (!noOrder) continue;
        if (!latest || visit.date > latest.date || (visit.date === latest.date && vi > latest.visitIndex)) {
          latest = { date: visit.date, visitIndex: vi };
        }
      }
      return latest;
    }

    const noOrderVisit = latestNoOrderVisit();
    let laterInvoiceExists = false;
    if (noOrderVisit && typeof data !== 'undefined' && Array.isArray(data.invoices)) {
      for (let i = 0; i < data.invoices.length; i++) {
        const invoice = data.invoices[i];
        if (!invoice || invoice.customerId !== cid || !validISODate(invoice.date)) continue;
        if (invoice.date > noOrderVisit.date) {
          laterInvoiceExists = true;
          break;
        }
      }
    }

    return signals.filter(function (signal) {
      if (!signal || !signal.category) return true;

      if (skuCategories[signal.category] && signal.productId != null && signal.productId !== '' && signal.productId !== 'multi') {
        const context = latestProductContext(signal.productId);
        if (context && context.reaction === 'rejected' &&
            (context.rejectionReason === 'still_stock' || context.rejectionReason === 'unavailable')) {
          return false;
        }
      }

      if (signal.category === 'CONSECUTIVE_NO_ORDER' && laterInvoiceExists) {
        return false;
      }

      return true;
    });
  }

  function calculateCustomerAction(cid, precomputedPriority, opts, skipMemo) {
    opts = opts || {};
    var ctx = opts.ctx || null;
    if (ctx && typeof ctx.memo === 'function' && !skipMemo) {
      return ctx.memo('customerActions', cid, function () {
        return calculateCustomerAction(cid, precomputedPriority, opts, true);
      });
    }
    const priority = precomputedPriority || (
      (typeof calculateCustomerPriority === 'function')
        ? calculateCustomerPriority(cid, opts)
        : { customerId: cid, priorityScore: 0, riskLevel: 'low', signals: [] }
    );

    const actionCandidates = _applyCurrentContextFilter(cid, priority.signals, ctx);
    const winner = _pickActionSignal(actionCandidates);

    if (!winner) {
      return Object.assign({
        customerId: cid,
        primarySignal: null,
        priorityScore: priority.priorityScore || 0,
        riskLevel: priority.riskLevel || 'low',
      }, NO_ACTION_RESULT_BASE);
    }

    const rule = ACTION_RULES[winner.category];
    var actionText = rule.action;
    // SKU signals: include product name in action message when available.
    if (winner.productName && (
      winner.category === 'SKU_DELAY' ||
      winner.category === 'SKU_QUANTITY_DROP' ||
      winner.category === 'SKU_FREQUENCY_DROP' ||
      winner.category === 'LINE_DROP' ||
      winner.category === 'COMBINED_SKU_DETERIORATION' ||
      winner.category === 'MULTI_SKU_DECLINE'
    )) {
      actionText = rule.action + ' («' + winner.productName + '»)';
    }

    // P-07: append real operational contexts only (short, non-duplicative).
    var contexts = [];
    var sc = stockContext(winner.productId);
    var vc = visitContext(cid, ctx);
    var fc = feedbackContext(winner);
    if (sc) contexts.push(sc);
    if (vc) contexts.push(vc);
    if (fc) contexts.push(fc);
    // Avoid repeating the same phrase already present in actionText
    for (var ci = 0; ci < contexts.length; ci++) {
      if (actionText.indexOf(contexts[ci]) === -1) {
        actionText = actionText + ' — ' + contexts[ci];
      }
    }

    // P-08: attach customer story if available (type/urgency unchanged)
    var story = null;
    if (priority.customerStory && priority.customerStory.summary) {
      story = priority.customerStory;
    } else if (typeof buildCustomerStory === 'function') {
      try {
        story = buildCustomerStory(cid, ctx);
      } catch (eSt) {
        story = null;
      }
    }

    return {
      customerId: cid,
      action: actionText,
      actionType: rule.actionType,
      urgency: rule.urgency,
      reason: winner.reason,
      primarySignal: winner,
      priorityScore: priority.priorityScore,
      riskLevel: priority.riskLevel,
      customerStory: story
    };
  }

  const URGENCY_RANK = { critical: 4, high: 3, medium: 2, low: 1 };
  const URGENCY_SCORE = { critical: 40, high: 30, medium: 20, low: 10 };
  const PROSPECT_IMPACT = { 'A+': 30, 'A': 20, 'B': 10, 'C': 0, 'D': 0 };

  function calculateAllCustomerActions(ctx, skipMemo) {
    if (ctx && typeof ctx.memo === 'function' && !skipMemo) {
      return ctx.memo('allCustomerActions', 'all', function () {
        return calculateAllCustomerActions(ctx, true);
      });
    }
    if (typeof data === 'undefined' || !Array.isArray(data.customers)) return [];
    const economicRankMap = (typeof _buildEconomicRankMap === 'function') ? _buildEconomicRankMap(ctx) : null;
    const customers = data.customers.filter(function (c) { return c && c.active !== false; });
    const results = customers.map(function (c) {
      return calculateCustomerAction(c.id, null, { economicRankMap: economicRankMap, ctx: ctx });
    });
    results.sort(function (a, b) {
      const ua = URGENCY_RANK[a.urgency] || 0;
      const ub = URGENCY_RANK[b.urgency] || 0;
      if (ub !== ua) return ub - ua;
      return (b.priorityScore || 0) - (a.priorityScore || 0);
    });
    return results;
  }

  function _customerImpactMap(ctx, skipMemo) {
    if (ctx && typeof ctx.memo === 'function' && !skipMemo) {
      return ctx.memo('customerImpactMap', 'all', function () {
        return _customerImpactMap(ctx, true);
      });
    }
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
        const t = customerTotals(c.id, ctx);
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

  function _customerTiming(cid, ctx) {
    const overdue = (typeof visitOverdueDays === 'function') ? visitOverdueDays(cid, ctx) : 0;
    if (overdue > 14) return 30;
    if (overdue > 7) return 25;
    return 10;
  }

  function _customerWhyNow(cid, ctx) {
    const overdue = (typeof visitOverdueDays === 'function') ? visitOverdueDays(cid, ctx) : 0;
    if (overdue > 0) return 'ویزیت ' + Math.round(overdue) + ' روز عقب‌افتاده';
    if (typeof customerBehavior === 'function') {
      try {
        const b = customerBehavior(cid, ctx);
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

  function calculateAllActions(ctx, skipMemo) {
    if (ctx && typeof ctx.memo === 'function' && !skipMemo) {
      return ctx.memo('allActions', 'all', function () {
        return calculateAllActions(ctx, true);
      });
    }
    const impactMap = _customerImpactMap(ctx);
    const economicRankMap = (typeof _buildEconomicRankMap === 'function') ? _buildEconomicRankMap(ctx) : null;
    const actions = [];

    if (typeof data !== 'undefined' && Array.isArray(data.customers)) {
      data.customers.forEach(function (c) {
        if (!c || c.active === false) return;
        const base = calculateCustomerAction(c.id, null, { economicRankMap: economicRankMap, ctx: ctx });
        if (!base || base.actionType === 'no_action') return;

        const urgencyPts = URGENCY_SCORE[base.urgency] || 10;
        const impactPts = impactMap[c.id] != null ? impactMap[c.id] : 15;
        const timingPts = _customerTiming(c.id, ctx);
        const unifiedScore = urgencyPts + impactPts + timingPts;
        const whyNow = _customerWhyNow(c.id, ctx);

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
