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
    'OFFER_DEFERRED_FOLLOWUP',
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
    // Evidence-based opportunity (built in this file from a RECORDED `deferred` visit offer;
    // never persisted, never a Signal). Same urgency tier as PURCHASE_GROWTH.
    OFFER_DEFERRED_FOLLOWUP: {
      actionType: 'follow_up',
      urgency: 'low',
      action: 'پیگیری محصولی که مشتری تصمیمش را به بعد موکول کرده',
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
  function stockContext(productId, signal) {
    if (productId == null || productId === '' || productId === 'multi') return null;
    // Family signals: productId is only the display representative, so stock is
    // decided over the whole Family (any usable member => not out of stock).
    if (signal && signal.familyId != null && signal.familyId !== '' && typeof familyStockOut === 'function') {
      var famMembers = (signal.evidence && Array.isArray(signal.evidence.memberProductIds)) ? signal.evidence.memberProductIds : null;
      return familyStockOut(signal.familyId, famMembers, productId) ? 'موجودی انبار تمام است' : null;
    }
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

    // Family-aware (runtime): an offered product counts if it resolves to the
    // same Family (analysisGroupId||productId) as the signal. productId on
    // the signal stays untouched for display/context.
    const famOf = (typeof makeFamilyResolver === 'function')
      ? makeFamilyResolver(ctx)
      : function (pid) { return pid; };

    function latestProductContext(signal) {
      const productId = signal.productId;
      const familyKey = (signal.familyId != null && signal.familyId !== '')
        ? signal.familyId
        : famOf(productId);
      let latest = null;
      for (let vi = 0; vi < visits.length; vi++) {
        const visit = visits[vi];
        if (!visit || !validISODate(visit.date) || !Array.isArray(visit.offeredProducts)) continue;
        for (let oi = 0; oi < visit.offeredProducts.length; oi++) {
          const op = visit.offeredProducts[oi];
          if (!op || !op.productId) continue;
          if (op.productId !== productId && famOf(op.productId) !== familyKey) continue;
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
        const context = latestProductContext(signal);
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

  /* Minimum weighted coverage of the declining products by recent still_stock /
     no_need visit outcomes for the action to be considered no longer needed.
     Product contract value (80%); the single place to change it. */
  const ACTION_ELIGIBILITY_MIN_COVERAGE = 0.80;

  /* Action Eligibility (read-only, fail-open).
     Runs AFTER the winner is chosen. Signal / Risk / Priority / persistence are
     never touched; this only decides whether the chosen Candidate Action is still
     worth putting in today's queue.

     Scope: PURCHASE_DECLINE_SEVERE only (every other winner is eligible).
     That signal is customer-level and carries no product, so its "topic" is the
     existing customerBehavior().decliningProducts list, each entry weighted by its
     earlyQty. An entry is COVERED when its latest visit offer inside the existing
     episode window (PERSISTENCE_PARAMS.windowDays) is reaction 'rejected' with
     rejectionReason still_stock / no_need (same product, else same Family via the
     existing makeFamilyResolver). accepted / deferred / ordered never cover.
     The action is NOT eligible when coveredWeight / totalWeight >= 80%
     (ACTION_ELIGIBILITY_MIN_COVERAGE) and the customer has not bought any
     declining Family on an invoice dated after the visit that was matched to it.
     Anything not provable (no visits, invalid decliningProducts / earlyQty /
     dates, unresolvable product, missing window, any error) => eligible (fail-open). */
  function _isActionEligible(winnerSignal, cid, ctx) {
    try {
      if (!winnerSignal || winnerSignal.category !== 'PURCHASE_DECLINE_SEVERE') return true;
      if (typeof customerBehavior !== 'function' || typeof daysAgo !== 'function') return true;
      if (typeof PERSISTENCE_PARAMS === 'undefined' || !PERSISTENCE_PARAMS ||
          typeof PERSISTENCE_PARAMS.windowDays !== 'number' ||
          !isFinite(PERSISTENCE_PARAMS.windowDays) || !(PERSISTENCE_PARAMS.windowDays > 0)) return true;
      const windowDays = PERSISTENCE_PARAMS.windowDays;

      const behavior = customerBehavior(cid, ctx);
      const declining = (behavior && Array.isArray(behavior.decliningProducts)) ? behavior.decliningProducts : [];
      if (!declining.length) return true;

      let customer = null;
      if (ctx && typeof ctx.customerById === 'function') {
        customer = ctx.customerById(cid);
      } else if (typeof data !== 'undefined' && Array.isArray(data.customers)) {
        for (let i = 0; i < data.customers.length; i++) {
          if (data.customers[i] && data.customers[i].id === cid) { customer = data.customers[i]; break; }
        }
      }
      const visits = customer && Array.isArray(customer.visits) ? customer.visits : [];
      if (!visits.length) return true;

      const famOf = (typeof makeFamilyResolver === 'function')
        ? makeFamilyResolver(ctx)
        : function (pid) { return pid; };
      const isoRe = /^\d{4}-\d{2}-\d{2}$/;
      const invoices = (typeof data !== 'undefined' && Array.isArray(data.invoices)) ? data.invoices : [];

      let totalWeight = 0;
      let coveredWeight = 0;
      for (let di = 0; di < declining.length; di++) {
        const entry = declining[di];
        const pid = entry && entry.productId;
        const weight = entry && entry.earlyQty;
        if (!pid || typeof weight !== 'number' || !isFinite(weight) || !(weight > 0)) return true;   // not reliable
        const topic = famOf(pid);
        if (topic == null || topic === '') return true;                                              // topic not resolvable
        totalWeight += weight;

        // latest visit offer for this topic (same product, or same Family) inside the window
        let latest = null;
        for (let vi = 0; vi < visits.length; vi++) {
          const visit = visits[vi];
          if (!visit || typeof visit.date !== 'string' || !isoRe.test(visit.date) ||
              !Array.isArray(visit.offeredProducts)) continue;
          const age = daysAgo(visit.date);
          if (age == null || !isFinite(age) || age < 0 || age > windowDays) continue;                // not a recent valid visit
          for (let oi = 0; oi < visit.offeredProducts.length; oi++) {
            const op = visit.offeredProducts[oi];
            if (!op || !op.productId || famOf(op.productId) !== topic) continue;
            const t = String(visit.time || '');
            if (!latest || visit.date > latest.date ||
                (visit.date === latest.date && (t > latest.time ||
                  (t === latest.time && (vi > latest.vi || (vi === latest.vi && oi > latest.oi)))))) {
              latest = { date: visit.date, time: t, vi: vi, oi: oi, op: op };
            }
          }
        }
        if (!latest) continue;                       // no recent related offer => uncovered

        // bought this Family after that visit => the recorded outcome is superseded: keep the action
        for (let ii = 0; ii < invoices.length; ii++) {
          const inv = invoices[ii];
          if (!inv || inv.customerId !== cid || typeof inv.date !== 'string' || !(inv.date > latest.date)) continue;
          const items = Array.isArray(inv.items) ? inv.items : [];
          for (let ti = 0; ti < items.length; ti++) {
            const it = items[ti];
            if (it && it.productId && it.qty > 0 && famOf(it.productId) === topic) return true;
          }
        }

        const op = latest.op;
        if (op.reaction === 'rejected' &&
            (op.rejectionReason === 'still_stock' || op.rejectionReason === 'no_need')) {
          coveredWeight += weight;
        }
      }
      // not eligible only when the weighted coverage reaches the contract threshold
      return !(totalWeight > 0 && (coveredWeight / totalWeight) >= ACTION_ELIGIBILITY_MIN_COVERAGE);
    } catch (e) {
      return true;    // never block an action because of an error
    }
  }


  /* ============================================================
     Recorded-context decision layer (read-only).

     Question answered per customer: "given what has ALREADY been recorded for this
     product (visit outcomes, seller responses on Watch), is this product-specific
     action still eligible, and what recorded fact explains / constrains it?"

     Sources (nothing invented):
       - visits[].offeredProducts[]  reaction + rejectionReason (rejected / deferred / accepted)
       - Watch lifecycle seller responses (getWatchResponsesForCustomer), incl. CLOSED rows
         that hold still_stock / not_wanted / follow_up_later decisions
     Rules:
       - The NEWEST recorded response for the product Family decides (same product, else same
         Family via makeFamilyResolver). An older response never overrides a newer one.
       - It must be CURRENT: visit / plain Watch reasons must fall inside the existing episode
         window (PERSISTENCE_PARAMS.windowDays); an unreleased Watch decision is current until
         the lifecycle releases it (the lifecycle defines no time limit). A purchase of that
         Family dated AFTER the response supersedes it (the situation changed).
       - still_stock / unavailable / no_need / not_wanted / follow_up_later => the product is not
         offered now (signal not eligible). price / competitor / quality / other-with-comment =>
         still eligible, but the recorded obstacle is stated and (price) the action becomes a
         price follow-up. deferred => stated as recorded.
       - Multi-product signals (KEY_PRODUCT_LOST) are dropped only when the recorded responses
         cover >= ACTION_ELIGIBILITY_MIN_COVERAGE of the weight; otherwise the covered products
         are removed from the displayed list.
       - Applied BEFORE winner selection, so an ineligible signal never blocks another candidate.
       - Follow-up TIMING: the data model stores only when a decision was recorded, never a due
         date, so no due date is ever shown or assumed.
     ============================================================ */
  const DEFERRED_OFFER_OPPORTUNITY_ENABLED = true;   // single switch for the opportunity candidate

  const CTX_SUPPRESS_CODES = {
    still_stock: true, unavailable: true, no_need: true, not_wanted: true, follow_up_later: true,
  };
  const CTX_OBSTACLE_LABEL = { price: 'قیمت', competitor: 'رقیب', quality: 'کیفیت' };
  const CTX_PRODUCT_SIGNALS = {
    SKU_DELAY: true, SKU_QUANTITY_DROP: true, SKU_FREQUENCY_DROP: true,
    LINE_DROP: true, COMBINED_SKU_DETERIORATION: true,
  };
  const CTX_NONE = { kind: 'none' };
  const CTX_COMMENT_MAX_CHARS = 48;   // display truncation of a recorded free-text comment

  function _validName(n) {
    if (typeof n !== 'string') return false;
    var t = n.trim();
    return !!t && t !== '—' && t !== '-' && t !== '?' && t !== '؟' && t !== 'undefined' && t !== 'null';
  }

  function _catalogProduct(pid) {
    if (pid == null || typeof data === 'undefined' || !Array.isArray(data.products)) return null;
    for (var i = 0; i < data.products.length; i++) {
      if (data.products[i] && data.products[i].id === pid) return data.products[i];
    }
    return null;
  }

  function _catalogName(pid) {
    var p = _catalogProduct(pid);
    return p && _validName(p.name) ? p.name : null;
  }

  function _fmtDateFa(iso) {
    return (typeof faDate === 'function') ? faDate(iso) : iso;
  }

  function _fmtNumFa(n) {
    var v = Math.round(n * 10) / 10;
    return (typeof enToFaDigits === 'function') ? enToFaDigits(String(v)) : String(v);
  }

  function _namesPhrase(names) {
    var uniq = [];
    (names || []).forEach(function (n) { if (_validName(n) && uniq.indexOf(n) < 0) uniq.push(n); });
    if (!uniq.length) return '';
    var shown = uniq.slice(0, 3).map(function (n) { return '«' + n + '»'; }).join('، ');
    return uniq.length > 3 ? shown + ' و ' + _fmtNumFa(uniq.length - 3) + ' مورد دیگر' : shown;
  }

  function _customerOf(cid, ctx) {
    if (ctx && typeof ctx.customerById === 'function') return ctx.customerById(cid);
    if (typeof data !== 'undefined' && Array.isArray(data.customers)) {
      for (var i = 0; i < data.customers.length; i++) {
        if (data.customers[i] && data.customers[i].id === cid) return data.customers[i];
      }
    }
    return null;
  }

  function _buildRecordedContext(cid, ctx) {
    var famOf = (typeof makeFamilyResolver === 'function')
      ? makeFamilyResolver(ctx)
      : function (pid) { return pid; };
    var windowDays = null;
    if (typeof PERSISTENCE_PARAMS !== 'undefined' && PERSISTENCE_PARAMS &&
        typeof PERSISTENCE_PARAMS.windowDays === 'number' && isFinite(PERSISTENCE_PARAMS.windowDays) &&
        PERSISTENCE_PARAMS.windowDays > 0) windowDays = PERSISTENCE_PARAMS.windowDays;
    var customer = _customerOf(cid, ctx);
    var visits = customer && Array.isArray(customer.visits) ? customer.visits : [];
    var isoRe = /^\d{4}-\d{2}-\d{2}$/;
    var byFam = Object.create(null);
    function add(fam, rec) {
      if (fam == null || fam === '') return;
      (byFam[fam] || (byFam[fam] = [])).push(rec);
    }

    visits.forEach(function (visit) {
      if (!visit || typeof visit.date !== 'string' || !isoRe.test(visit.date) || !Array.isArray(visit.offeredProducts)) return;
      visit.offeredProducts.forEach(function (op) {
        if (!op || !op.productId) return;
        var code = null;
        if (op.reaction === 'rejected') code = op.rejectionReason || null;
        else if (op.reaction === 'deferred') code = 'deferred';
        else if (op.reaction === 'accepted') code = 'accepted';
        if (!code) return;
        add(famOf(op.productId), {
          source: 'visit', code: code, productId: op.productId, comment: '',
          date: visit.date, key: visit.date + 'T' + String(visit.time || '00:00'), held: false,
        });
      });
    });

    if (typeof getWatchResponsesForCustomer === 'function') {
      try {
        (getWatchResponsesForCustomer(cid) || []).forEach(function (w) {
          if (!w || !w.productId || !w.code || typeof w.recordedAt !== 'string') return;
          var d = w.recordedAt.slice(0, 10);
          if (!isoRe.test(d)) return;
          add(famOf(w.productId), {
            source: 'watch', code: w.code, productId: w.productId, comment: w.comment || '',
            date: d, key: w.recordedAt, held: !!w.held,
          });
        });
      } catch (eW) { /* fail open: no Watch context */ }
    }

    Object.keys(byFam).forEach(function (f) {
      byFam[f].sort(function (a, b) { return a.key < b.key ? 1 : (a.key > b.key ? -1 : 0); });
    });

    var lastPurchase = Object.create(null);   // Family -> latest invoice date with qty > 0
    var invoices = (typeof data !== 'undefined' && Array.isArray(data.invoices)) ? data.invoices : [];
    invoices.forEach(function (inv) {
      if (!inv || inv.customerId !== cid || typeof inv.date !== 'string' || !isoRe.test(inv.date)) return;
      (Array.isArray(inv.items) ? inv.items : []).forEach(function (it) {
        if (!it || !it.productId || !(it.qty > 0)) return;
        var f = famOf(it.productId);
        if (f != null && (!lastPurchase[f] || inv.date > lastPurchase[f])) lastPurchase[f] = inv.date;
      });
    });

    function verdict(fam) {
      var list = byFam[fam];
      if (!list || !list.length) return CTX_NONE;
      var r = list[0];                                   // the newest recorded response decides
      if (lastPurchase[fam] && lastPurchase[fam] > r.date) return CTX_NONE;   // superseded by a later purchase
      var current = false;
      if (r.source === 'watch' && r.held) {
        current = true;                                  // unreleased seller decision: held by the lifecycle
      } else if (windowDays != null && typeof daysAgo === 'function') {
        var age = daysAgo(r.date);
        current = (age != null && isFinite(age) && age >= 0 && age <= windowDays);
      }
      if (!current) return CTX_NONE;
      var base = { code: r.code, source: r.source, date: r.date, key: r.key, productId: r.productId, comment: r.comment };
      if (CTX_SUPPRESS_CODES[r.code]) return Object.assign({ kind: 'suppress' }, base);
      if (r.code === 'deferred') return Object.assign({ kind: 'deferred' }, base);
      if (CTX_OBSTACLE_LABEL[r.code] || (r.code === 'other' && r.comment && r.comment.trim())) {
        return Object.assign({ kind: 'obstacle' }, base);
      }
      return CTX_NONE;
    }

    return { famOf: famOf, windowDays: windowDays, byFam: byFam, lastPurchase: lastPurchase, visits: visits, verdict: verdict };
  }

  // Product subjects of a signal (null = not product-specific: never touched by this layer).
  function _signalSubjects(signal, famOf) {
    if (!signal) return null;
    if (CTX_PRODUCT_SIGNALS[signal.category] && signal.productId != null && signal.productId !== '' && signal.productId !== 'multi') {
      var fam = (signal.familyId != null && signal.familyId !== '') ? signal.familyId : famOf(signal.productId);
      return [{ productId: signal.productId, fam: fam, weight: 1, name: signal.productName, earlyQty: null, lateQty: null }];
    }
    if (signal.category === 'KEY_PRODUCT_LOST' && signal.evidence) {
      var list = (Array.isArray(signal.evidence.hardLost) && signal.evidence.hardLost.length)
        ? signal.evidence.hardLost : (signal.evidence.retainedLost || []);
      var out = [];
      list.forEach(function (p) {
        if (!p || !p.productId) return;
        out.push({
          productId: p.productId, fam: famOf(p.productId),
          weight: (typeof p.earlyQty === 'number' && isFinite(p.earlyQty) && p.earlyQty > 0) ? p.earlyQty : 1,
          name: p.name, earlyQty: p.earlyQty, lateQty: p.lateQty,
        });
      });
      return out.length ? out : null;
    }
    return null;
  }

  // Eligibility gate (before winner selection). Never mutates the shared signal objects.
  function _applyRecordedContext(signals, rc) {
    if (!Array.isArray(signals) || !signals.length) return signals || [];
    var out = [];
    signals.forEach(function (sig) {
      var subs = _signalSubjects(sig, rc.famOf);
      if (!subs) { out.push(sig); return; }
      var total = 0, suppressedW = 0, suppressedN = 0;
      var remaining = [], obstacles = [], deferred = [];
      subs.forEach(function (sub) {
        total += sub.weight;
        var v = rc.verdict(sub.fam);
        if (v.kind === 'suppress') { suppressedW += sub.weight; suppressedN++; return; }
        remaining.push(sub);
        if (v.kind === 'obstacle') obstacles.push({ sub: sub, v: v });
        else if (v.kind === 'deferred') deferred.push({ sub: sub, v: v });
      });
      if (total > 0 && (suppressedW / total) >= ACTION_ELIGIBILITY_MIN_COVERAGE) return;   // not eligible now
      if (!suppressedN && !obstacles.length && !deferred.length) { out.push(sig); return; }
      out.push(Object.assign({}, sig, {
        recordedContext: { remaining: remaining, obstacles: obstacles, deferred: deferred, suppressedCount: suppressedN },
      }));
    });
    return out;
  }

  // Opportunity candidate: the newest RECORDED `deferred` visit offer(s) still current & unpurchased.
  function _deferredOfferCandidate(cid, rc) {
    var subjects = [];
    Object.keys(rc.byFam).forEach(function (fam) {
      var v = rc.verdict(fam);
      if (v.kind !== 'deferred' || v.source !== 'visit') return;
      var prod = _catalogProduct(v.productId);
      if (!prod || prod.active === false || !_validName(prod.name)) return;
      subjects.push({ productId: v.productId, name: prod.name, date: v.date, key: v.key });
    });
    if (!subjects.length) return null;
    subjects.sort(function (a, b) { return a.key < b.key ? 1 : (a.key > b.key ? -1 : 0); });
    var newest = subjects[0].date;
    subjects = subjects.filter(function (x) { return x.date === newest; });
    var phrase = _namesPhrase(subjects.map(function (x) { return x.name; }));
    if (!phrase) return null;
    return {
      customerId: cid,
      category: 'OFFER_DEFERRED_FOLLOWUP',
      type: 'opportunity',
      severity: 'low',
      status: 'active',
      sourceLevel: 'account',
      productId: subjects[0].productId,
      productName: subjects[0].name,
      reason: 'مشتری برای ' + phrase + ' در ویزیت ' + _fmtDateFa(newest) + ' گفته بعداً تصمیم می‌گیرد',
      evidence: { offers: subjects },
    };
  }

  function _recordedNextActionContext(rc) {
    if (!rc || rc.windowDays == null || typeof daysAgo !== 'function') return null;
    var latest = null;
    rc.visits.forEach(function (v) {
      if (!v || typeof v.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v.date)) return;
      var key = v.date + 'T' + String(v.time || '00:00');
      if (!latest || key > latest.key) latest = { key: key, visit: v };
    });
    if (!latest || typeof latest.visit.nextAction !== 'string' || !latest.visit.nextAction.trim()) return null;
    var age = daysAgo(latest.visit.date);
    if (age == null || !isFinite(age) || age < 0 || age > rc.windowDays) return null;
    var label = latest.visit.nextAction.trim();
    return { label: label, line: 'اقدام بعدی ثبت‌شده در ویزیت ' + _fmtDateFa(latest.visit.date) + ': ' + label };
  }

  // Product part of the action text + recorded facts. Returns { text, reason, extra[] }.
  function _composeDecisionText(winner, rule, rc) {
    var text = rule.action;
    var reason = winner.reason;
    var extra = [];
    var rcx = winner.recordedContext || null;
    var cat = winner.category;
    var nameOf = function (sub) { return _catalogName(sub.productId) || (_validName(sub.name) ? sub.name : null); };

    if (cat === 'KEY_PRODUCT_LOST') {
      var subs = rcx ? rcx.remaining : (_signalSubjects(winner, rc ? rc.famOf : function (p) { return p; }) || []);
      var kNames = subs.map(nameOf);
      var kPhrase = _namesPhrase(kNames);
      if (kPhrase) text += ' (' + kPhrase + ')';
      if (subs.length === 1 && typeof subs[0].earlyQty === 'number' && typeof subs[0].lateQty === 'number' &&
          isFinite(subs[0].earlyQty) && isFinite(subs[0].lateQty)) {
        extra.push('مقدار خرید در نیمهٔ اخیر سابقه از ' + _fmtNumFa(subs[0].earlyQty) + ' به ' + _fmtNumFa(subs[0].lateQty) + ' رسیده');
      }
      if (rcx && rcx.suppressedCount > 0 && kPhrase) {
        var vn = kNames.filter(_validName);
        reason = vn.length === 1
          ? 'محصول کلیدی «' + vn[0] + '» دیگر خریداری نمی‌شود'
          : 'محصولات کلیدی (' + vn.join('، ') + ') دیگر خریداری نمی‌شوند';
      }
    } else if (cat === 'OFFER_DEFERRED_FOLLOWUP') {
      var oPhrase = _namesPhrase(((winner.evidence && winner.evidence.offers) || []).map(function (o) { return o.name; }));
      if (oPhrase) text += ' (' + oPhrase + ')';
    } else if (_validName(winner.productName) && (CTX_PRODUCT_SIGNALS[cat] || cat === 'MULTI_SKU_DECLINE')) {
      text = rule.action + ' («' + winner.productName + '»)';
    }

    if (rcx) {
      // Every remaining subject carries the same recorded PRICE obstacle: the cause is known, so the
      // action is the price follow-up (an existing next-action label), not a generic "find out why".
      if ((rule.actionType === 'visit' || rule.actionType === 'investigate' || rule.actionType === 'call') &&
          rcx.obstacles.length && !rcx.deferred.length && rcx.obstacles.length === rcx.remaining.length &&
          rcx.obstacles.every(function (o) { return o.v.code === 'price'; })) {
        var pPhrase = _namesPhrase(rcx.obstacles.map(function (o) { return nameOf(o.sub); }));
        text = 'پیگیری قیمت' + (pPhrase ? ' (' + pPhrase + ')' : '');
      }
      var seen = {};
      // with exactly one product left whose name is already in the action text, the name adds nothing
      var prefix = function (sub) {
        var nm = nameOf(sub);
        if (!_validName(nm)) return '';
        if (rcx.remaining.length === 1 && text.indexOf('«' + nm + '»') >= 0) return '';
        return '«' + nm + '»: ';
      };
      rcx.obstacles.slice(0, 2).forEach(function (o) {
        var label = CTX_OBSTACLE_LABEL[o.v.code] || ('«' + o.v.comment.trim().slice(0, CTX_COMMENT_MAX_CHARS) + '»');
        var line = prefix(o.sub) + 'دلیل ثبت‌شده ' +
          (CTX_OBSTACLE_LABEL[o.v.code] ? '«' + label + '»' : label) + ' (' + _fmtDateFa(o.v.date) + ')';
        if (!seen[line]) { seen[line] = true; extra.push(line); }
      });
      rcx.deferred.slice(0, 2).forEach(function (d) {
        var line = prefix(d.sub) + 'مشتری در ویزیت ' + _fmtDateFa(d.v.date) + ' گفته بعداً تصمیم می‌گیرد';
        if (!seen[line]) { seen[line] = true; extra.push(line); }
      });
    }
    return { text: text, reason: reason, extra: extra };
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

    let actionCandidates = _applyCurrentContextFilter(cid, priority.signals, ctx);
    // Recorded-context layer: eligibility BEFORE ranking + one evidence-based opportunity candidate.
    // Fails open: any error leaves the legacy candidates untouched.
    let rcCtx = null;
    try {
      rcCtx = _buildRecordedContext(cid, ctx);
      actionCandidates = _applyRecordedContext(actionCandidates, rcCtx);
      if (DEFERRED_OFFER_OPPORTUNITY_ENABLED) {
        const deferredCandidate = _deferredOfferCandidate(cid, rcCtx);
        if (deferredCandidate) actionCandidates = actionCandidates.concat([deferredCandidate]);
      }
    } catch (eRc) {
      rcCtx = null;
      actionCandidates = _applyCurrentContextFilter(cid, priority.signals, ctx);
    }
    let winner = _pickActionSignal(actionCandidates);
    // Action Eligibility: the winner is chosen first; if it is no longer needed
    // given a recent related visit, the existing NO_ACTION path is used. The next
    // candidate is deliberately NOT promoted, and the signal itself is untouched.
    if (winner && !_isActionEligible(winner, cid, ctx)) {
      winner = null;
    }

    if (!winner) {
      return Object.assign({
        customerId: cid,
        primarySignal: null,
        priorityScore: priority.priorityScore || 0,
        riskLevel: priority.riskLevel || 'low',
      }, NO_ACTION_RESULT_BASE);
    }

    const rule = ACTION_RULES[winner.category];
    // Action text + recorded facts (product names only when real; evidence only when it exists).
    var decision = _composeDecisionText(winner, rule, rcCtx);
    var actionText = decision.text;
    var winnerReason = decision.reason;

    // P-07: append real operational contexts only (short, non-duplicative).
    var contexts = [];
    var sc = stockContext(winner.productId, winner);
    var vc = visitContext(cid, ctx);
    var fc = feedbackContext(winner);
    decision.extra.forEach(function (line) {
      // P-03 already states a competitor purchase: do not say the same thing twice
      if (fc && fc.indexOf('رقیب') >= 0 && line.indexOf('«رقیب»') >= 0) return;
      contexts.push(line);
    });
    if (rcCtx && (rule.actionType === 'visit' || rule.actionType === 'call' ||
        rule.actionType === 'follow_up' || rule.actionType === 'investigate')) {
      var nac = _recordedNextActionContext(rcCtx);
      // skip when the action text already says the same thing (e.g. both are "پیگیری قیمت")
      if (nac && actionText.indexOf(nac.label) < 0) contexts.push(nac.line);
    }
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
      reason: winnerReason,
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
