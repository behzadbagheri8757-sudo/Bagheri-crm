/* js/views/customer.js — SPA Customer detail view (Phase 4).
   Extracted from customer.html. Uses customerTotals/customerProfit/customerBehavior
   and existing mutation APIs (openAddInvoice/openAddTransaction/openAddCheck/openAddVisit/
   openAddCustomer) exactly as the MPA page does. No new financial logic.
*/
'use strict';

(function (global) {
  /* Same defensive helper as payments view — customer payment rows call this. */
  if (typeof global.paymentMethodLabel !== 'function') {
    global.paymentMethodLabel = function paymentMethodLabel(method) {
      var map = {
        cash: 'نقد',
        card: 'کارت',
        transfer: 'انتقال',
        return: 'برگشت',
        check: 'چک',
        discount: 'تخفیف',
        supplier: 'پرداخت به تامین‌کننده'
      };
      if (method == null || method === '') return '—';
      return map[method] || String(method);
    };
  }

  let currentCustomerId = null;
  let rootEl = null;
  function customersHref() {
    return '#/customers';
  }

  function navigateToCustomer(cid) {
    AppRouter.navigate('/customer', { id: cid });
  }

  function invoicePayStatus(inv) {
    const paid =
      typeof invoiceEffectivePaid === 'function'
        ? invoiceEffectivePaid(inv)
        : (inv.cashPaid || 0) + (inv.cardPaid || 0) + (inv.transferPaid || 0) + (inv.checkPaid || 0);
    const total = inv.total || 0;
    if (total <= 0) return { label: '—', cls: '' };
    if (paid <= 0) return { label: 'پرداخت‌نشده', cls: 'accent-rust' };
    if (paid + 0.5 >= total) return { label: 'تسویه روی فاکتور', cls: 'accent-olive' };
    return { label: 'پرداخت جزئی', cls: 'accent-amber' };
  }

  /* --- خلاصهٔ وضعیت (برای مرور سریع بین دو مغازه) ---
     فقط از خروجی customerBehavior() تغذیه می‌شود، هیچ متریکی را دوباره
     محاسبه یا تغییر نمی‌دهد. صرفاً نتایج موجود را برای تصمیم سریع کنار هم می‌گذارد. */
  function customerBehaviorSummary(bb) {
    if (!bb) return null;
    if (bb.invoiceCount < 2) {
      return {
        level: 'insufficient',
        lines: [
          bb.invoiceCount === 0
            ? 'هنوز فاکتوری برای این مشتری ثبت نشده است.'
            : 'فقط یک فاکتور ثبت شده — برای تشخیص الگوی خرید حداقل ۲ فاکتور لازم است.'
        ]
      };
    }
    const risk = [];
    const good = [];
    if (bb.behindPattern === true) {
      risk.push(
        'از الگوی معمول خرید عقب افتاده — ' +
          Math.round(bb.daysSinceLast) +
          ' روز از آخرین خرید گذشته (الگو: هر ' +
          Math.round(bb.avgIntervalDays) +
          ' روز)'
      );
    } else if (bb.behindPattern === false) {
      good.push('در محدودهٔ الگوی معمول خرید است');
    }
    if (bb.amountTrend === 'down') {
      risk.push('روند مبلغ خرید در ۳۰ روز اخیر کاهشی است');
    } else if (bb.amountTrend === 'up') {
      good.push('روند مبلغ خرید در ۳۰ روز اخیر افزایشی است');
    }
    if (bb.decliningProducts && bb.decliningProducts.length) {
      risk.push(
        'افت خرید در: ' +
          bb.decliningProducts
            .slice(0, 2)
            .map(function (p) {
              return p.name;
            })
            .join('، ')
      );
    }
    if (bb.consecutiveNoOrder >= 2) {
      risk.push('آخرین ' + bb.consecutiveNoOrder + ' ویزیت بدون سفارش بوده');
    }
    if (bb.conversionRate != null && bb.visitCount >= 2 && bb.conversionRate >= 0.5) {
      good.push('نرخ تبدیل ویزیت به سفارش بالا: ' + Math.round(bb.conversionRate * 100) + '٪');
    }
    let level = 'normal';
    if (risk.length >= 2) level = 'risk';
    else if (risk.length === 1) level = 'watch';
    else if (good.length) level = 'good';
    const reminder = bb.topProducts && bb.topProducts[0] ? 'کالای اصلی: ' + bb.topProducts[0].name : null;
    const action = bb.lastNextAction ? 'اقدام یادداشت‌شده از ویزیت قبل: ' + bb.lastNextAction : null;
    return { level: level, risk: risk, good: good, reminder: reminder, action: action };
  }

  /* --- Watch / Early Warning Layer (frozen spec §15) ---
     Runs BOTH extractCustomerSignals() (Confirmed) and
     extractWatchObservations() (Watch), as required by the spec.
     NOTE: this codebase does not currently render extractCustomerSignals()
     anywhere in the Customer View (it is only used by app.js for the
     "no purchase reason" prompt on invoices) — there was no existing
     Confirmed display here to preserve. To satisfy "Confirmed signals
     طبق منطق فعلی نمایش داده شوند" + "UI باید distinction واضح داشته
     باشد", a minimal read-only Confirmed list (active signals only,
     using the signals' own existing reason/productName fields — no new
     business logic) is shown alongside the new Watch list. This is an
     explicitly reported interpretation, not a silent guess. No action
     buttons are added for either list. */
  /* ============================================================
     PRODUCT REJECTION INSIGHT (UI-only, read-only)
     Source: customerBehavior(cid).offeredProductStats
     Not a Watch / Alert / Score / Recommendation / Action.
     Threshold configurable via localStorage key below.
     ============================================================ */
  var PRODUCT_REJECTION_THRESHOLD_KEY = 'baqeri_product_rejection_threshold_v1';
  var PRODUCT_REJECTION_THRESHOLD_DEFAULT = 3;

  function getProductRejectionThreshold() {
    try {
      if (typeof localStorage !== 'undefined' && localStorage) {
        var raw = localStorage.getItem(PRODUCT_REJECTION_THRESHOLD_KEY);
        if (raw != null && raw !== '') {
          var n = Number(raw);
          if (Number.isFinite(n) && n >= 1) return Math.floor(n);
        }
      }
    } catch (e) { /* ignore */ }
    return PRODUCT_REJECTION_THRESHOLD_DEFAULT;
  }

  function setProductRejectionThreshold(value) {
    var n = Math.floor(Number(value));
    if (!Number.isFinite(n) || n < 1) n = PRODUCT_REJECTION_THRESHOLD_DEFAULT;
    try {
      if (typeof localStorage !== 'undefined' && localStorage) {
        localStorage.setItem(PRODUCT_REJECTION_THRESHOLD_KEY, String(n));
      }
    } catch (e) { /* ignore */ }
    return n;
  }

  var REJECTION_REASON_LABELS = {
    price: 'قیمت',
    quality: 'کیفیت',
    competitor: 'رقیب',
    unavailable: 'ناموجود',
    no_need: 'عدم نیاز',
    still_stock: 'موجود داشت',
    other: 'سایر'
  };

  function rejectionReasonLabel(code) {
    if (!code) return '—';
    return REJECTION_REASON_LABELS[code] || String(code);
  }

  /**
   * Build rejection insights for ONE customer from offeredProductStats.
   * Only products with rejectedCount >= threshold are returned.
   * Pure / read-only — does not write DB or mutate CRM.
   */
  function buildProductRejectionInsights(customerId, threshold, ctx) {
    var out = [];
    if (!customerId || typeof customerBehavior !== 'function') return out;
    var thr = (threshold != null && Number.isFinite(Number(threshold)))
      ? Math.floor(Number(threshold))
      : getProductRejectionThreshold();
    if (thr < 1) thr = PRODUCT_REJECTION_THRESHOLD_DEFAULT;

    var b;
    try { b = customerBehavior(customerId, ctx); } catch (e) { return out; }
    if (!b || !Array.isArray(b.offeredProductStats)) return out;

    for (var i = 0; i < b.offeredProductStats.length; i++) {
      var st = b.offeredProductStats[i];
      if (!st || st.productId == null) continue;
      var rejected = Number(st.rejectedCount) || 0;
      var offered = Number(st.offeredCount) || 0;
      if (rejected < thr) continue; // 1st and 2nd never shown
      if (offered < 1) continue;

      var ratio = rejected / offered;
      // Contract from calc.js: use st.rejectionReasons only (not topRejectionReason/reasonCounts)
      var topReason = null;
      if (st.rejectionReasons && typeof st.rejectionReasons === 'object') {
        var bestCode = null;
        var bestN = -1;
        var codes = Object.keys(st.rejectionReasons).sort(); // alphabetical deterministic tie-break
        for (var c = 0; c < codes.length; c++) {
          var n = Number(st.rejectionReasons[codes[c]]);
          if (!Number.isFinite(n) || n <= 0) continue;
          if (n > bestN) { bestN = n; bestCode = codes[c]; }
        }
        topReason = bestCode;
      }

      var name = st.productName || null;
      if (!name && typeof data !== 'undefined' && Array.isArray(data.products)) {
        var p = data.products.find(function (x) { return x && x.id === st.productId; });
        if (p) name = p.name;
      }

      out.push({
        productId: st.productId,
        productName: name || String(st.productId),
        offeredCount: offered,
        rejectedCount: rejected,
        rejectionRatio: ratio,
        topRejectionReason: topReason,
        lastOfferedDate: st.lastOfferedDate || null,
        stillStockSources: st.stillStockSources || null
      });
    }

    // Sort: most rejections first, then name (deterministic)
    out.sort(function (a, b) {
      if (b.rejectedCount !== a.rejectedCount) return b.rejectedCount - a.rejectedCount;
      return String(a.productName || '').localeCompare(String(b.productName || ''), 'fa');
    });
    return out;
  }

  /* Human cause phrase used after «به‌خاطر». Presentation text only. */
  var REJECTION_CAUSE = {
    price: 'قیمت', quality: 'کیفیت', competitor: 'خرید از رقیب',
    unavailable: 'نبود موجودی', no_need: 'نیاز نداشتن', still_stock: 'داشتن موجودی'
  };

  function dominantStockSource(ss) {
    if (!ss) return null;
    var best = null, bn = 0;
    ['competitor', 'ours', 'unknown'].forEach(function (k) {
      var n = Number(ss[k]) || 0;
      if (n > bn) { bn = n; best = k; }
    });
    return best;
  }

  /* One human sentence for a rejection insight.
     short=true  -> single sentence for the top-of-page topic list.
     short=false -> detail list: count/cause sentence + stock-source sentence when stored. */
  function rejectionSentence(it, short) {
    var P = global.BagheriPresent;
    if (!P || !it) return '';
    var src = dominantStockSource(it.stillStockSources);
    var stockTxt = src ? P.stockSentence(src) : '';
    if (short && stockTxt && it.topRejectionReason === 'still_stock') return stockTxt;
    var cause = REJECTION_CAUSE[it.topRejectionReason];
    var base = P.n0(it.rejectedCount) + ' بار از ' + P.n0(it.offeredCount) + ' پیشنهاد رد شده' + (cause ? '؛ بیشتر به‌خاطر ' + cause : '') + '.';
    if (short) return base;
    return stockTxt ? base + ' ' + stockTxt : base;
  }

  function productRejectionInsightsHtml(customerId, ctx) {
    var items = [];
    try {
      items = buildProductRejectionInsights(customerId, undefined, ctx);
    } catch (e) {
      return '';
    }
    if (!items.length) return ''; // hide section entirely
    var P = global.BagheriPresent;

    var rows = items.map(function (it) {
      return '<div class="ledger-row customer-static-row">' +
        '<span class="name">' + esc(it.productName) +
          '<span class="sub">' + esc(rejectionSentence(it, false)) + '</span></span>' +
        '<span class="filler"></span>' +
        '<span class="amount customer-static-value">' +
          esc(P ? P.n0(it.rejectedCount) : String(it.rejectedCount)) + ' بار رد شده</span></div>';
    }).join('');

    return '<details class="customer-rejection-details">' +
      '<summary class="customer-behavior-summary">کالاهای ردشده توسط مشتری (' + esc(P ? P.n0(items.length) : String(items.length)) + ')</summary>' +
      '<div class="dash-activity customer-rejection-list">' + rows + '</div></details>';
  }

  /* ============================================================
     Delivery patch — Customer Detail presentation
     Level 0: one human sentence.  Level 1: short list / summary.
     Level 2: raw evidence inside a single «جزئیات» disclosure.
     Nothing here generates, scores or resolves a Watch/Signal.
     ============================================================ */
  function levelClass(level) {
    return level === 'critical' ? 'watch-level-critical' : level === 'high' ? 'watch-level-high' : level === 'medium' ? 'watch-level-medium' : 'watch-level-low';
  }
  function levelLabel(level) {
    return level === 'critical' ? 'بحرانی' : level === 'high' ? 'زیاد' : level === 'medium' ? 'متوسط' : 'کم';
  }

  var POSITIVE_SIGNAL_CATEGORIES = ['PURCHASE_GROWTH'];

  var CONFIRMED_TITLES = {
    PURCHASE_DECLINE_MILD: 'خرید کمتر شده',
    PURCHASE_DECLINE_SEVERE: 'خرید به‌طور محسوسی کمتر شده',
    BEHIND_PATTERN: 'از زمان معمول خرید عقب افتاده',
    BASKET_SHRINK: 'افت مقدار خرید',
    KEY_PRODUCT_LOST: 'کالای کلیدی خریده نشده',
    PAYMENT_OVERDUE: 'پرداخت معوق',
    CHECK_BOUNCED: 'چک برگشتی',
    CONSECUTIVE_NO_ORDER: 'ویزیت‌های اخیر بدون سفارش',
    VISIT_CONVERSION_LOW: 'نرخ سفارش از ویزیت پایین است',
    VISIT_OVERDUE: 'زمان ویزیت گذشته',
    LONG_NO_VISIT: 'مدت زیادی ویزیت نشده',
    SKU_DELAY: 'دیرتر از معمول خریده شده',
    SKU_QUANTITY_DROP: 'مقدار خرید کمتر شده',
    SKU_FREQUENCY_DROP: 'کمتر از قبل خریده می‌شود',
    LINE_DROP: 'در سبد اخیر کم‌رنگ شده',
    COMBINED_SKU_DETERIORATION: 'چند نشانه کاهش در یک کالا',
    MULTI_SKU_DECLINE: 'کاهش هم‌زمان چند کالا',
    SKU_CHURN: 'خرید این کالا متوقف شده'
  };
  /* Presentation-only grouping so the same subject (e.g. a Confirmed signal and its
     earlier Watch) is shown once. Not a business rule; source data is never changed. */
  var TOPIC_GROUPS = {
    PURCHASE_DECLINE_MILD: 'volume', PURCHASE_DECLINE_SEVERE: 'volume', BASKET_SHRINK: 'volume',
    MULTI_SKU_DECLINE: 'volume', PURCHASE_DECLINE_WATCH: 'volume', BASKET_SHRINK_WATCH: 'volume',
    BEHIND_PATTERN: 'timing', BEHIND_PATTERN_WATCH: 'timing',
    KEY_PRODUCT_LOST: 'keylost', KEY_PRODUCT_LOST_WATCH: 'keylost',
    PAYMENT_OVERDUE: 'money', CHECK_BOUNCED: 'money',
    CONSECUTIVE_NO_ORDER: 'visits', VISIT_CONVERSION_LOW: 'visits',
    VISIT_OVERDUE: 'visitgap', LONG_NO_VISIT: 'visitgap'
  };

  /* Reads existing Truth only (same sources the page used before). */
  function loadWatchData(cid, ctx) {
    var out = { activeConfirmed: [], occs: [] };
    if (typeof extractCustomerSignals !== 'function' && typeof extractWatchObservations !== 'function' && typeof getActiveWatchOccurrences !== 'function') return out;

    var confirmed = [];
    if (typeof extractCustomerSignals === 'function') {
      try { confirmed = extractCustomerSignals(cid, ctx) || []; } catch (e) { confirmed = []; }
    }
    out.activeConfirmed = confirmed.filter(function (s) { return s && s.status === 'active'; });

    var occs = [];
    if (typeof getActiveWatchOccurrences === 'function') {
      try { occs = getActiveWatchOccurrences(cid) || []; } catch (eOcc) { occs = []; }
    }
    // Fallback to raw generation if lifecycle absent. Guarded against inactive customers
    // (W-BUG-02): this path bypasses reconcileWatchLifecycle's active-customer check.
    var custIsActive = true;
    if (typeof data !== 'undefined' && Array.isArray(data.customers)) {
      var custRec = data.customers.find(function (x) { return x && x.id === cid; });
      custIsActive = !!(custRec && custRec.active !== false);
    }
    if (!occs.length && custIsActive && typeof extractWatchObservations === 'function') {
      try {
        var raw = extractWatchObservations(cid, confirmed, ctx) || [];
        if (typeof filterSuppressedWatchObservations === 'function') {
          try { raw = filterSuppressedWatchObservations(cid, raw, ctx) || []; } catch (eF) { /* fail-open */ }
        }
        occs = raw.map(function (w) {
          return {
            id: null,
            customerId: cid,
            productId: w.productId,
            productName: w.productName,
            watchCategory: w.category,
            level: w.level,
            generatedReason: w.reason,
            reason: null,
            evidence: w.evidence || null,
            watchComponents: w.watchComponents || null,
            status: 'active'
          };
        });
      } catch (e2) { occs = []; }
    }
    // Presentation-level de-duplication (new array; source objects untouched).
    var seen = Object.create(null);
    out.occs = occs.filter(function (o) {
      if (!o) return false;
      var k = o.id || ((o.watchCategory || '') + '|' + (o.productId || ''));
      if (seen[k]) return false;
      seen[k] = true;
      return true;
    });
    return out;
  }

  function watchTitleText(o) {
    var P = global.BagheriPresent;
    var label = P ? P.watchLabel(o.watchCategory) : (o.generatedReason || '');
    return o.productName ? (o.productName + ' · ' + label) : label;
  }

  /* ---- Pending follow-ups: surfaced near the top; raw evidence stays behind «جزئیات». ---- */
  function pendingFollowUpHtml(cid) {
    if (typeof getPendingWatchFollowUps !== 'function') return '';
    var P = global.BagheriPresent;
    var rows = [];
    try { rows = getPendingWatchFollowUps(cid) || []; } catch (e) { rows = []; }
    if (!rows.length) return '';
    var html = rows.map(function (o) {
      var sentence = P ? P.watchSentence(o) : (o.generatedReason || '');
      return '<div class="watch-followup-row bp-followup" data-followup-id="' + esc(o.id) + '">' +
        '<div class="watch-followup-main">' +
          '<div class="bp-row-title">' + esc(o.productName || 'همان موضوع قبلی') + '</div>' +
          (sentence ? '<div class="bp-row-text">' + esc(sentence) + '</div>' : '') +
          (o.reason && o.reason.comment ? '<div class="bp-row-note">یادداشت قبلی: ' + esc(o.reason.comment) + '</div>' : '') +
          (P ? P.detailsHtml(P.watchDetailLines(o)) : '') +
        '</div>' +
        '<div class="watch-followup-actions"><button type="button" class="btn secondary small" data-followup-complete="' + esc(o.id) + '">ثبت نتیجه</button>' +
        '<button type="button" class="btn secondary small" data-followup-cancel="' + esc(o.id) + '">لغو پیگیری</button></div></div>';
    }).join('');
    return '<div class="card wide watch-followup-card"><div class="label">پیگیری‌های منتظر</div>' + html + '</div>';
  }

  /* ---- P0: a few genuinely different, important topics. Hidden when there are none. ---- */
  function customerFocusHtml(cid, ctx, wd) {
    var P = global.BagheriPresent;
    var result = { html: '', groups: {} };
    if (!P) return result;
    var cands = [];
    var order = 0;

    wd.activeConfirmed.forEach(function (sg) {
      if (!sg || sg.type !== 'risk') return;
      var grp = TOPIC_GROUPS[sg.category];
      var key = sg.productId ? 'p:' + sg.productId : 'c:' + (grp || sg.category);
      var label = CONFIRMED_TITLES[sg.category] || 'نیاز به بررسی';
      cands.push({
        key: key, group: grp || null, order: order++, src: 2,
        rank: P.lvRank(sg.severity), level: sg.severity,
        title: sg.productName ? (sg.productName + ' · ' + label) : label,
        text: sg.reason || '', occId: null,
        lowConf: (typeof sg.confidence === 'number' && sg.confidence < 0.5)
      });
    });
    wd.occs.forEach(function (o) {
      var grp = TOPIC_GROUPS[o.watchCategory];
      var key = o.productId ? 'p:' + o.productId : 'c:' + (grp || o.watchCategory);
      cands.push({
        key: key, group: grp || null, order: order++, src: 1,
        rank: P.lvRank(o.level), level: o.level,
        title: watchTitleText(o), text: P.watchSentence(o), occId: o.id || null, lowConf: false
      });
    });
    var rejItems = [];
    try { rejItems = buildProductRejectionInsights(cid, undefined, ctx) || []; } catch (eR) { rejItems = []; }
    rejItems.forEach(function (it) {
      cands.push({
        key: 'rej:' + it.productId, group: null, order: order++, src: 0,
        rank: 1, level: 'low',
        title: it.productName + ' · چند بار رد شده',
        text: rejectionSentence(it, true), occId: null, lowConf: false
      });
    });

    // Keep the strongest candidate per subject, then the top 3 overall.
    var best = Object.create(null);
    cands.forEach(function (c) {
      var cur = best[c.key];
      var score = c.rank * 10 + c.src;
      if (!cur || score > cur.score) best[c.key] = { c: c, score: score };
    });
    // Fold a stored stock-source answer into the topic of the same product (one subject, one block).
    var stockByPid = Object.create(null);
    rejItems.forEach(function (it) {
      var src = dominantStockSource(it.stillStockSources);
      if (src) stockByPid[it.productId] = P.stockSentence(src);
    });
    var topics = Object.keys(best).map(function (k) { return best[k]; })
      .sort(function (a, b) { return (b.score - a.score) || (a.c.order - b.c.order); })
      .slice(0, 3)
      .map(function (x) { return x.c; })
      .filter(function (t) { return t.text || t.title; });
    topics.forEach(function (t) {
      var pid = t.key.indexOf('p:') === 0 ? t.key.slice(2) : (t.key.indexOf('rej:') === 0 ? t.key.slice(4) : null);
      if (pid && stockByPid[pid] && t.text.indexOf(stockByPid[pid]) < 0) t.text = (t.text ? t.text + ' ' : '') + stockByPid[pid];
    });
    if (!topics.length) return result;

    topics.forEach(function (t) { if (t.group) result.groups[t.group] = true; });
    result.html = '<div class="bp-focus">' +
      '<div class="bp-focus-head">الان مهم است</div>' +
      '<div class="bp-focus-list">' + topics.map(function (t) {
        var tap = !!t.occId;
        return '<div class="bp-topic' + (tap ? ' is-tap' : '') + '"' + (tap ? ' data-watch-occ="' + esc(t.occId) + '" role="button" tabindex="0"' : '') + '>' +
          '<span class="bp-topic-dot is-' + esc(t.level || 'low') + '" aria-hidden="true"></span>' +
          '<div class="bp-topic-main">' +
            '<div class="bp-topic-title">' + esc(t.title) + (t.lowConf ? ' <span class="bp-topic-flag">اطمینان پایین</span>' : '') + '</div>' +
            (t.text ? '<div class="bp-topic-text">' + esc(t.text) + '</div>' : '') +
          '</div>' +
          (tap ? '<span class="bp-topic-chev" aria-hidden="true">›</span>' : '') +
        '</div>';
      }).join('') + '</div></div>';
    return result;
  }

  /* ---- Level 2: full list of confirmed signals + early warnings, collapsed by default. ---- */
  function intelligenceWatchHtml(cid, ctx, wd) {
    wd = wd || loadWatchData(cid, ctx);
    var P = global.BagheriPresent;
    var activeConfirmed = wd.activeConfirmed, occs = wd.occs;
    if (!occs.length && !activeConfirmed.length) return '';

    var confirmedHtml = '';
    if (activeConfirmed.length) {
      var crows = activeConfirmed.map(function (sg) {
        /* فقط سیگنال‌هایی که واقعاً خبر خوب‌اند سبز می‌شوند. type==='opportunity'
           به‌تنهایی کافی نیست: «مدت زیادی ویزیت نشده» و (در حالت بازطبقه‌بندی)
           «کالای کلیدی خریده نشده/افت سبد» هم opportunity هستند ولی خبر خوب نیستند. */
        var isGood = sg.type === 'opportunity' && POSITIVE_SIGNAL_CATEGORIES.indexOf(sg.category) !== -1;
        var cls = isGood ? 'watch-level-opportunity' : levelClass(sg.severity);
        var lbl = isGood ? 'فرصت' : levelLabel(sg.severity);
        return '<div class="watch-confirmed-row">' +
          '<span class="bp-conf-text">' + (sg.productName ? '<strong>' + esc(sg.productName) + '</strong> — ' : '') + esc(sg.reason || '') + '</span>' +
          '<span class="watch-level-label ' + cls + '">' + esc(lbl) + '</span>' +
          '</div>';
      }).join('');
      confirmedHtml = '<div class="card wide watch-confirmed-card">' +
        '<div class="label">تأییدشده</div>' +
        '<div class="watch-confirmed-list">' + crows + '</div></div>';
    }

    var watchHtml = '';
    if (occs.length) {
      var wrows = occs.map(function (o) {
        var sentence = P ? P.watchSentence(o) : (o.generatedReason || '');
        var reviewed = !!o.reason;
        var reasonBit = '';
        if (reviewed && o.reason) {
          var rlabel = (typeof watchReasonLabel === 'function') ? watchReasonLabel(o.reason.code) : (o.reason.code || '');
          reasonBit = '<div class="bp-row-note">علت ثبت‌شده: ' + esc(rlabel) + (o.reason.comment ? (' — ' + esc(o.reason.comment)) : '') + '</div>';
        }
        var clickable = o.id ? (' data-watch-occ="' + esc(o.id) + '" role="button" tabindex="0"') : '';
        return '<div class="watch-occ-item">' +
          '<div class="watch-occ-row bp-occ"' + clickable + '>' +
            '<div class="bp-occ-main">' +
              '<div class="bp-row-title">' + esc(watchTitleText(o)) + '</div>' +
              (sentence ? '<div class="bp-row-text">' + esc(sentence) + '</div>' : '') +
              reasonBit +
            '</div>' +
            '<div class="bp-occ-side"><span class="watch-level-label ' + levelClass(o.level) + '">' + esc(levelLabel(o.level)) + '</span>' +
              (reviewed ? '<span class="watch-reviewed">بررسی شده</span>' : '') + '</div>' +
          '</div>' +
          (P ? P.detailsHtml(P.watchDetailLines(o)) : '') +
        '</div>';
      }).join('');
      watchHtml = '<div class="card wide watch-lifecycle-card" id="watch-lifecycle-card">' +
        '<div class="label">هشدارهای زودهنگام</div>' +
        '<div class="report-note watch-note">برای ثبت پاسخ، روی هر مورد بزنید.</div>' +
        '<div class="watch-occ-list">' + wrows + '</div></div>';
    }

    var total = occs.length + activeConfirmed.length;
    return '<details class="customer-watch-details">' +
      '<summary class="customer-behavior-summary">همه نشانه‌ها و هشدارها (' + esc(P ? P.n0(total) : String(total)) + ')</summary>' +
      '<div class="customer-detail-watch-body">' + confirmedHtml + watchHtml + '</div></details>';
  }

  /* Short Level-1 glance for the behavior section. Uses only values customerBehavior() already returns. */
  function behaviorGlanceHtml(b, groups) {
    var P = global.BagheriPresent;
    if (!P || !b) return '';
    var lines = [];
    if (b.amountTrend === 'up') lines.push('خرید ۳۰ روز اخیر نسبت به ۳۰ روز قبل بیشتر شده.');
    else if (b.amountTrend === 'down' && !groups.volume) lines.push('خرید ۳۰ روز اخیر نسبت به ۳۰ روز قبل کمتر شده.');
    if (b.behindPattern === true && !groups.timing && b.daysSinceLast != null && b.avgIntervalDays != null) {
      lines.push(P.n0(b.daysSinceLast) + ' روز از آخرین خرید گذشته؛ این مشتری معمولاً هر ' + P.n0(b.avgIntervalDays) + ' روز خرید می‌کند.');
    }
    var vis = b.visitInvoiceStats;
    if (vis && vis.linkedInvoiceCount > 0 && b.visitCount > 0) {
      var line = 'از ' + P.n0(b.visitCount) + ' ویزیت ثبت‌شده، ' + P.n0(vis.linkedInvoiceCount) + ' فاکتور از همان ویزیت صادر شده';
      if (vis.avgDaysBetweenVisitAndInvoice != null) {
        line += vis.avgDaysBetweenVisitAndInvoice < 0.5 ? '؛ معمولاً همان روز.' : '؛ معمولاً حدود ' + P.n1(vis.avgDaysBetweenVisitAndInvoice) + ' روز بعد.';
      } else line += '.';
      lines.push(line);
    }
    if (b.lastNextAction) lines.push('اقدام بعدی از ویزیت قبل: ' + b.lastNextAction);
    if (b.topProducts && b.topProducts.length) {
      lines.push('کالاهای اصلی: ' + b.topProducts.slice(0, 3).map(function (x) { return x.name; }).join('، '));
    }
    if (!lines.length) return '';
    return '<div class="bp-glance">' + lines.map(function (l) { return '<div class="bp-glance-line">' + esc(l) + '</div>'; }).join('') + '</div>';
  }

  function watchSheetContextHtml(o) {
    var P = global.BagheriPresent;
    if (!P || !o) return '';
    var sentence = P.watchSentence(o);
    return (sentence ? '<div class="bp-row-text bp-sheet-text">' + esc(sentence) + '</div>' : '') + P.detailsHtml(P.watchDetailLines(o));
  }

  function openWatchReasonSheet(occurrenceId, onDone) {
    if (!occurrenceId || typeof recordWatchReason !== 'function') return;
    var options = (typeof getWatchResponseOptions === 'function')
      ? getWatchResponseOptions(occurrenceId)
      : (typeof WATCH_REASON_OPTIONS !== 'undefined' && Array.isArray(WATCH_REASON_OPTIONS))
      ? WATCH_REASON_OPTIONS
      : [
          { code: 'still_stock', label: 'هنوز موجودی دارد' },
          { code: 'price', label: 'قیمت' },
          { code: 'competitor', label: 'خرید از رقیب' },
          { code: 'no_need', label: 'فعلاً نیاز ندارد' },
          { code: 'quality', label: 'مشکل کیفیت' },
          { code: 'other', label: 'سایر' }
        ];
    var optsHtml = options.map(function (o) {
      return '<button type="button" class="btn secondary small" data-watch-reason="' + esc(o.code) + '" style="width:100%;margin-bottom:6px;text-align:right;">' +
        esc(o.label) + '</button>';
    }).join('');
    if (typeof openSheet !== 'function') return;
    openSheet(
      '<div class="sheet-title">ثبت علت هشدار</div>' +
      '<div class="report-note" style="margin-bottom:10px;">سه پاسخ اول هشدار را می‌بندند و همان مورد را فوراً برنمی‌گردانند؛ سایر علت‌ها فقط ثبت می‌شوند.</div>' +
      '<div id="watch-reason-list">' + optsHtml + '</div>' +
      '<div class="field" style="margin-top:10px;"><label>یادداشت (اختیاری)</label>' +
      '<input type="text" id="watch-reason-note" autocomplete="off" placeholder="توضیح کوتاه..."></div>' +
      '<div class="btn-row" style="margin-top:12px;justify-content:space-between;">' +
      '<button type="button" class="btn secondary" id="watch-dismiss-btn">بستن هشدار</button>' +
      '<button type="button" class="btn secondary" id="watch-reason-cancel">انصراف</button></div>'
    );
    var cancel = document.getElementById('watch-reason-cancel');
    if (cancel) cancel.onclick = function () { if (typeof closeModal === 'function') closeModal(); };
    var dismissBtn = document.getElementById('watch-dismiss-btn');
    if (dismissBtn) {
      dismissBtn.onclick = function () {
        if (typeof dismissWatchOccurrence !== 'function') return;
        var noteEl = document.getElementById('watch-reason-note');
        var note = noteEl ? noteEl.value : '';
        try {
          dismissWatchOccurrence(occurrenceId, note);
          if (typeof showToast === 'function') showToast('هشدار بسته شد');
        } catch (err) {
          console.error(err);
          if (typeof showToast === 'function') showToast('بستن هشدار ممکن نشد');
        }
        if (typeof closeModal === 'function') closeModal();
        if (typeof onDone === 'function') onDone();
      };
    }
    var list = document.getElementById('watch-reason-list');
    if (list) {
      list.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-watch-reason]');
        if (!btn) return;
        var code = btn.getAttribute('data-watch-reason');
        var noteEl = document.getElementById('watch-reason-note');
        var note = noteEl ? noteEl.value : '';
        try {
          recordWatchReason(occurrenceId, code, note);
          if (typeof showToast === 'function') showToast('علت ثبت شد');
        } catch (err) {
          console.error(err);
          if (typeof showToast === 'function') showToast('ثبت علت ممکن نشد');
        }
        if (typeof closeModal === 'function') closeModal();
        if (typeof onDone === 'function') onDone();
      });
    }
  }

  function openWatchFollowUpSheet(occurrenceId, cid, onDone) {
    if (!occurrenceId || typeof getPendingWatchFollowUps !== 'function' || typeof openSheet !== 'function') return;
    var pending = [];
    try { pending = getPendingWatchFollowUps(cid) || []; } catch (e) { pending = []; }
    var occ = pending.find(function (x) { return x && x.id === occurrenceId; });
    if (!occ) return;
    var options = [
      { code: 'still_stock', label: 'هنوز موجودی دارد' },
      { code: 'not_wanted', label: 'این محصول را نمی‌خواهد' },
      { code: 'dismiss', label: 'بررسی شد، فعلاً پیگیری نمی‌خواهم' },
      { code: 'price', label: 'قیمت' },
      { code: 'competitor', label: 'خرید از رقیب' },
      { code: 'no_need', label: 'فعلاً نیاز ندارد' },
      { code: 'quality', label: 'مشکل کیفیت' },
      { code: 'other', label: 'سایر' }
    ].filter(function (x) { return x.code !== 'not_wanted' || !!occ.productId; });
    var buttons = options.map(function (o) { return '<button type="button" class="btn secondary small" data-followup-result="' + esc(o.code) + '" style="width:100%;margin-bottom:6px;text-align:right;">' + esc(o.label) + '</button>'; }).join('');
    openSheet('<div class="sheet-title">ثبت نتیجه پیگیری</div>' + watchSheetContextHtml(occ) + '<div id="watch-followup-results">' + buttons + '</div>' + '<div class="field" style="margin-top:10px;"><label>یادداشت (اختیاری)</label><input id="watch-followup-note" type="text" autocomplete="off"></div>' + '<div class="btn-row" style="margin-top:10px;"><button type="button" class="btn secondary" id="watch-followup-cancel-sheet">انصراف</button></div>');
    var cancel = document.getElementById('watch-followup-cancel-sheet');
    if (cancel) cancel.onclick = function () { if (typeof closeModal === 'function') closeModal(); };
    var list = document.getElementById('watch-followup-results');
    if (list) list.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-followup-result]'); if (!btn) return;
      var note = document.getElementById('watch-followup-note');
      var code = btn.getAttribute('data-followup-result');
      var result = null;
      if (code === 'dismiss') {
        // Explicit completion of the pending follow-up; do not turn it into not_wanted.
        result = typeof completeWatchFollowUp === 'function' ? completeWatchFollowUp(occurrenceId, 'dismiss', note ? note.value : '') : null;
      } else if (typeof completeWatchFollowUp === 'function') {
        result = completeWatchFollowUp(occurrenceId, code, note ? note.value : '');
      }
      if (typeof showToast === 'function') showToast(result ? 'نتیجه پیگیری ثبت شد' : 'ثبت نتیجه ممکن نشد');
      if (typeof closeModal === 'function') closeModal();
      if (typeof onDone === 'function') onDone();
    });
  }

  function bindWatchFollowUps(root, cid) {
    if (!root) return;
    root.querySelectorAll('[data-followup-complete]').forEach(function (el) {
      el.addEventListener('click', function () {
        openWatchFollowUpSheet(el.getAttribute('data-followup-complete'), cid, function () { drawCustomerPage(rootEl || root); });
      });
    });
    root.querySelectorAll('[data-followup-cancel]').forEach(function (el) {
      el.addEventListener('click', function () {
        if (typeof reverseWatchDecision !== 'function') return;
        var id = el.getAttribute('data-followup-cancel');
        var ok = false;
        try { ok = !!reverseWatchDecision(id); } catch (e) { ok = false; }
        if (typeof showToast === 'function') showToast(ok ? 'پیگیری لغو شد' : 'لغو پیگیری ممکن نشد');
        drawCustomerPage(rootEl || root);
      });
    });
  }

  function bindWatchLifecycleRows(root) {
    if (!root) return;
    root.querySelectorAll('[data-watch-occ]').forEach(function (el) {
      el.addEventListener('click', function () {
        var id = el.getAttribute('data-watch-occ');
        openWatchReasonSheet(id, function () {
          if (typeof drawCustomerPage === 'function') drawCustomerPage(rootEl || root);
        });
      });
    });
  }

  function drawCustomerPage(root, ctx) {
    if (!root) return;
    root.classList.add('customer-detail-view'); // UPDATED: Added for CSS scoping

    const id = currentCustomerId;

    if (!id) {
      root.innerHTML =
        '<div class="empty">شناسه مشتری مشخص نشده است.</div>' +
        '<div class="btn-row"><a class="btn secondary" href="' +
        customersHref() +
        '">بازگشت به لیست مشتریان</a></div>';
      return;
    }
    const c = data.customers.find(function (x) {
      return x.id === id;
    });
    if (!c) {
      root.innerHTML =
        '<div class="empty">مشتری با این شناسه پیدا نشد.</div>' +
        '<div class="btn-row"><a class="btn secondary" href="' +
        customersHref() +
        '">بازگشت به لیست مشتریان</a></div>';
      return;
    }

    if (typeof setHeaderTitle === 'function') {
      setHeaderTitle(c.name, { isRoot: false });
    }

    const t = customerTotals(c.id, ctx);
    const profit = customerProfit(c.id, ctx);
    const word = balanceStatusWord(t.balance);
    const color = t.balance > 0 ? 'accent-rust' : t.balance < 0 ? 'accent-olive' : 'accent-olive';
    const balanceLine = t.balance === 0 ? word : word + ': ' + toman(Math.abs(t.balance)) + ' ت';

    /* Unified Summary — visually combines three EXISTING, already-frozen
       outputs (calculateCustomerPriority → riskLevel + customerStory,
       and calculateCustomerAction → next action) into ONE decision block.
       No new score, no new health model, no new thresholds: this is a
       read-only merge of data the system already computes elsewhere
       (the same functions power the Dashboard Action Queue). */
    let unifiedSummaryHtml = '';
    let recommendedAction = null;
    let customerRiskLevel = null;
    let customerHealthLabel = 'وضعیت عادی';
    {
      let priority = null, action = null;
      try { if (typeof calculateCustomerPriority === 'function') priority = calculateCustomerPriority(c.id, { ctx: ctx }); } catch (eP) { priority = null; }
      try { if (typeof calculateCustomerAction === 'function') action = calculateCustomerAction(c.id, priority, { ctx: ctx }); } catch (eA) { action = null; }
      recommendedAction = action && action.actionType !== 'no_action' ? action : null;
      const riskLevel = priority ? priority.riskLevel : null;
      customerRiskLevel = riskLevel;
      customerHealthLabel = riskLevel === 'critical' ? 'نیاز به رسیدگی فوری' : riskLevel === 'high' ? 'نیاز به توجه' : riskLevel === 'medium' ? 'قابل بررسی' : 'وضعیت عادی';
      const storyText = (priority && priority.customerStory && priority.customerStory.summary) ? priority.customerStory.summary : '';
      if (storyText) {
        unifiedSummaryHtml =
          '<div class="cust-summary ' + (riskLevel ? 'radar-risk-' + esc(riskLevel) : '') + '">' +
          '<div class="cust-summary-label">خلاصه وضعیت</div><div class="cust-summary-story">' + esc(storyText) + '</div>' +
          '</div>';
      }
    }

    // P0 (what matters now) + follow-ups waiting for this customer — presentation of existing Truth.
    const watchData = loadWatchData(c.id, ctx);
    var attRow = null;
    try {
      if (ctx && typeof ctx.receivableAttention === 'function') {
        var attData = ctx.receivableAttention();
        attRow = (attData.byCustomerId && attData.byCustomerId[c.id]) ? attData.byCustomerId[c.id] : null;
      }
    } catch (eAtt) { attRow = null; }
    const focus = customerFocusHtml(c.id, ctx, watchData);
    const followUpTopHtml = pendingFollowUpHtml(c.id);

    const invs = customerInvoices(c.id, ctx)
      .slice()
      .sort(function (a, b) {
        return (b.date || '').localeCompare(a.date || '') || String(b.number).localeCompare(String(a.number));
      });
    const pays = customerPayments(c.id, ctx)
      .slice()
      .sort(function (a, b) {
        return (b.date || '').localeCompare(a.date || '');
      });
    const chks = customerChecks(c.id, ctx)
      .slice()
      .sort(function (a, b) {
        return (b.dueDate || '').localeCompare(a.dueDate || '');
      });
    const visits = (c.visits || []).slice().sort(function (a, b) {
      return (b.date || '').localeCompare(a.date || '') || (b.time || '').localeCompare(a.time || '');
    });

    const invRows = invs.length
      ? invs
          .map(function (inv) {
            const st = invoicePayStatus(inv);
            return (
              '<a class="ledger-row customer-invoice-row" href="#/invoice?id=' +
              encodeURIComponent(inv.id) +
              '" style="text-decoration:none;color:inherit;">' +
              '<span class="name">#' +
              esc(String(inv.number || '')) +
              '<span class="sub">' +
              faDate(inv.date) +
              ' — <span class="' +
              st.cls +
              '">' +
              st.label +
              '</span></span></span>' +
              '<span class="filler"></span>' +
              '<span class="amount">' +
              toman(inv.total) +
              ' ت</span></a>'
            );
          })
          .join('')
      : '<div class="empty" style="padding:12px 0;">فاکتوری ثبت نشده</div>';

    const payRows = pays.length
      ? pays
          .map(function (p) {
            const method = paymentMethodLabel(p.method);
            return (
              '<div class="ledger-row">' +
              '<span class="name">' +
              esc(method) +
              (p.note ? '<span class="sub">' + esc(p.note) + '</span>' : '') +
              '<span class="sub">' +
              faDate(p.date) +
              '</span></span>' +
              '<span class="filler"></span>' +
              '<span class="amount">' +
              toman(p.amount) +
              ' ت</span></div>'
            );
          })
          .join('')
      : '<div class="empty" style="padding:12px 0;">پرداختی ثبت نشده</div>';

    const chkRows = chks.length
      ? chks
          .map(function (ch) {
            const st = ch.status === 'cleared' ? 'پاس‌شده' : 'در جریان';
            const stCls = ch.status === 'cleared' ? 'accent-olive' : 'accent-amber';
            return (
              '<div class="ledger-row">' +
              '<span class="name">' +
              esc(ch.checkNumber || 'چک') +
              '<span class="sub">سررسید: ' +
              faDate(ch.dueDate) +
              ' — <span class="' +
              stCls +
              '">' +
              st +
              '</span></span></span>' +
              '<span class="filler"></span>' +
              '<span class="amount">' +
              toman(ch.amount) +
              ' ت</span></div>'
            );
          })
          .join('')
      : '<div class="empty" style="padding:12px 0;">چکی ثبت نشده</div>';

    const visitRows = visits.length
      ? visits
          .slice(0, 30)
          .map(function (v) {
            const scoreBit = typeof v.score === 'number' ? ' — امتیاز: ' + v.score + ' از ۱۰۰' : '';
            const extraBits = [];
            if (v.reason) extraBits.push('دلیل: ' + v.reason);
            if (v.opportunity) extraBits.push('فرصت (مشاهده): ' + v.opportunity);
            if (v.threat) extraBits.push('تهدید (مشاهده): ' + v.threat);
            if (v.nextAction) extraBits.push('اقدام بعدی: ' + v.nextAction);
            if (Array.isArray(v.tags) && v.tags.length) extraBits.push('برچسب: ' + v.tags.join('، '));
            if (Array.isArray(v.offeredProducts) && v.offeredProducts.length) {
              var rxMap = { accepted: 'قبول', rejected: 'رد', deferred: 'بعداً' };
              var rrMap = { price: 'قیمت', quality: 'کیفیت', competitor: 'رقیب', unavailable: 'ناموجود', no_need: 'عدم نیاز', still_stock: 'موجود داشت', other: 'سایر' };
              var bits = v.offeredProducts.map(function (op) {
                var prod = (data.products || []).find(function (p) { return p.id === op.productId; });
                var name = prod ? prod.name : (op.productId || '—');
                var s = name + ' (' + (rxMap[op.reaction] || op.reaction || '—') + ')';
                if (op.reaction === 'rejected' && op.rejectionReason) s += ' — ' + (rrMap[op.rejectionReason] || op.rejectionReason);
                return s;
              });
              extraBits.push('پیشنهاد: ' + bits.join('؛ '));
            }
            if (v.note) extraBits.push(v.note);
            const extraHtml = extraBits
              .map(function (x) {
                return '<span class="sub customer-visit-row-detail">' + esc(x) + '</span>';
              })
              .join('');
            const ordered = v.ordered || v.result === (typeof VISIT_RESULTS !== 'undefined' && VISIT_RESULTS[0]);
            return (
              '<div class="ledger-row" style="cursor:default;">' +
              '<span class="name">' +
              esc(v.result || 'ویزیت') +
              '<span class="sub">' +
              faDate(v.date) +
              (v.time ? ' — ' + esc(v.time) : '') +
              scoreBit +
              '</span>' +
              extraHtml +
              '</span>' +
              '<span class="filler"></span>' +
              '<span class="amount ' +
              (ordered ? 'accent-olive' : '') +
              '">' +
              (ordered ? 'سفارش' : 'ویزیت') +
              '</span></div>'
            );
          })
          .join('')
      : '<div class="empty" style="padding:12px 0;">ویزیتی ثبت نشده</div>';

    let behaviorHtml = '';
    if (typeof customerBehavior === 'function') {
      const b = customerBehavior(c.id, ctx);
      // customerBehaviorSummary's own bullet lines now render lower on the
      // page, inside "جزئیات کامل رفتار خرید" progressive disclosure —
      // the headline decision (risk/opportunity + next action) already
      // moved up into the Unified Summary block above the fold.
      let summaryHtml = '';
      const summary = customerBehaviorSummary(b);
      if (summary && summary.level === 'insufficient') {
        summaryHtml =
          '<div class="card wide" style="margin-bottom:10px;">' +
          '<div class="label">خلاصهٔ رفتار خرید</div>' +
          '<div class="value" style="font-size:.9rem;">' +
          esc(summary.lines[0]) +
          '</div></div>';
      } else if (summary) {
        const badgeMap = {
          risk: ['نیاز به توجه', 'accent-rust'],
          watch: ['قابل بررسی', 'accent-amber'],
          good: ['وضعیت مطلوب', 'accent-olive'],
          normal: ['عادی', '']
        };
        const bm = badgeMap[summary.level] || badgeMap.normal;
        const noteLines = summary.risk.concat(summary.good);
        const extraLines = [summary.reminder, summary.action].filter(Boolean);
        summaryHtml =
          '<div class="card wide" style="margin-bottom:10px;">' +
          '<div class="label">خلاصهٔ رفتار خرید</div>' +
          '<div class="value ' +
          bm[1] +
          '" style="font-size:1.05rem;">' +
          esc(bm[0]) +
          '</div>' +
          (noteLines.length
            ? '<div style="font-size:.85rem;line-height:1.9;margin-top:8px;color:var(--ink);">' +
              noteLines
                .map(function (x) {
                  return '• ' + esc(x);
                })
                .join('<br>') +
              '</div>'
            : '') +
          (extraLines.length
            ? '<div style="font-size:.85rem;line-height:1.9;margin-top:8px;padding-top:8px;border-top:1px dotted var(--line);color:var(--ink);">' +
              extraLines
                .map(function (x) {
                  return esc(x);
                })
                .join('<br>') +
              '</div>'
            : '') +
          '</div>';
      }

      const trendLabel =
        b.amountTrend === 'up' ? 'سیگنال افزایش' : b.amountTrend === 'down' ? 'سیگنال کاهش' : b.amountTrend === 'flat' ? 'تقریباً ثابت' : null;
      const trendCls = b.amountTrend === 'up' ? 'accent-olive' : b.amountTrend === 'down' ? 'accent-rust' : '';
      const intervalText = b.avgIntervalDays != null ? Math.round(b.avgIntervalDays * 10) / 10 + ' روز' : 'اطلاعات کافی نیست';
      const gapText = b.daysSinceLast != null ? Math.round(b.daysSinceLast) + ' روز' : '—';
      const behindHtml =
        b.behindPattern === true
          ? '<div class="card wide"><div class="label">نشانه</div><div class="value accent-amber" style="font-size:.95rem;">از الگوی معمول خرید عقب افتاده</div></div>'
          : b.behindPattern === false
            ? '<div class="card wide"><div class="label">وضعیت فاصله</div><div class="value accent-olive" style="font-size:.95rem;">در محدوده الگوی معمول</div></div>'
            : '';
      const topProdHtml =
        b.topProducts && b.topProducts.length
          ? b.topProducts
              .map(function (p) {
                return (
                  '<div class="ledger-row" style="cursor:default;"><span class="name">' +
                  esc(p.name) +
                  '<span class="sub">تعداد: ' +
                  fmtQtyDisplay(p.qty) +
                  '</span></span><span class="filler"></span><span class="amount">' +
                  toman(p.revenue) +
                  ' ت</span></div>'
                );
              })
              .join('')
          : '<div class="empty" style="padding:8px 0;">اطلاعات کافی نیست</div>';
      const decliningHtml =
        b.decliningProducts && b.decliningProducts.length
          ? b.decliningProducts
              .map(function (p) {
                return (
                  '<div class="ledger-row" style="cursor:default;"><span class="name">' +
                  esc(p.name) +
                  '<span class="sub">قبلاً ' +
                  fmtQtyDisplay(p.earlyQty) +
                  ' ← اخیراً ' +
                  fmtQtyDisplay(p.lateQty) +
                  '</span></span></div>'
                );
              })
              .join('')
          : '';
      const lv = b.lastVisit;
      const lastVisitBits = [];
      if (lv) {
        lastVisitBits.push(esc(lv.result || 'ویزیت'));
        if (lv.reason) lastVisitBits.push('دلیل: ' + esc(lv.reason));
        if (lv.nextAction) lastVisitBits.push('اقدام بعدی: ' + esc(lv.nextAction));
        if (lv.opportunity) lastVisitBits.push('فرصت (مشاهده): ' + esc(lv.opportunity));
        if (lv.threat) lastVisitBits.push('تهدید (مشاهده): ' + esc(lv.threat));
        if (Array.isArray(lv.tags) && lv.tags.length) lastVisitBits.push('برچسب: ' + esc(lv.tags.join('، ')));
      }
      const convText =
        b.conversionRate != null
          ? Math.round(b.conversionRate * 100) + '٪ (' + b.orderedCount + ' از ' + b.visitCount + ')'
          : b.visitCount
            ? '—'
            : 'ویزیتی ثبت نشده';

      behaviorHtml =
        '<h3 class="sub-title">رفتار خرید و هوش تجاری</h3>' +
        behaviorGlanceHtml(b, focus.groups) +
        intelligenceWatchHtml(c.id, ctx, watchData) +
        '<details class="customer-behavior-details">' +
        '<summary class="customer-behavior-summary">تحلیل رفتار خرید</summary>' +
        summaryHtml +
        '<div class="cards">' +
        '<div class="card"><div class="label">اولین خرید</div><div class="value">' +
        (b.firstInvoiceDate ? faDate(b.firstInvoiceDate) : '—') +
        '</div></div>' +
        '<div class="card"><div class="label">آخرین خرید</div><div class="value">' +
        (b.lastInvoiceDate ? faDate(b.lastInvoiceDate) : '—') +
        '</div></div>' +
        '<div class="card"><div class="label">تعداد فاکتور</div><div class="value">' +
        b.invoiceCount +
        '</div></div>' +
        '<div class="card"><div class="label">میانگین مبلغ فاکتور</div><div class="value">' +
        (b.avgInvoice != null ? toman(b.avgInvoice) + ' ت' : '—') +
        '</div></div>' +
        '<div class="card"><div class="label">الگوی معمول خرید</div><div class="value">' +
        esc(String(intervalText)) +
        '</div></div>' +
        '<div class="card"><div class="label">فاصله از آخرین خرید</div><div class="value">' +
        esc(String(gapText)) +
        '</div></div>' +
        '<div class="card"><div class="label">خرید خالص ۳۰ روز</div><div class="value">' +
        toman(b.sales30 || 0) +
        ' ت</div></div>' +
        '<div class="card"><div class="label">خرید خالص ۹۰ روز</div><div class="value">' +
        toman(b.sales90 || 0) +
        ' ت</div></div>' +
        (b.returnTotal > 0
          ? '<div class="card wide"><div class="label">جمع برگشت از فروش (کل سابقه)</div><div class="value">' +
            toman(b.returnTotal) +
            ' ت</div></div>'
          : '') +
        (trendLabel
          ? '<div class="card wide"><div class="label">روند مبلغ (۳۰ روز اخیر نسبت به ۳۰ روز قبل)</div><div class="value ' +
            trendCls +
             '">' +
            trendLabel +
            '</div></div>'
          : '<div class="card wide"><div class="label">روند مبلغ</div><div class="value">اطلاعات کافی نیست</div></div>') +
        behindHtml +
        '<div class="card"><div class="label">تعداد ویزیت</div><div class="value">' +
        b.visitCount +
        '</div></div>' +
        '<div class="card"><div class="label">نرخ تبدیل ویزیت به سفارش</div><div class="value">' +
        esc(String(convText)) +
        '</div></div>' +
        '</div>' +
        '<div class="sub-title customer-detail-subtitle">کالاهای اصلی مشتری</div>' +
        '<div class="customer-tx-list customer-top-products">' + topProdHtml + '</div>' +
        (decliningHtml ? '<div class="sub-title customer-detail-subtitle customer-detail-subtitle-secondary">کالاهای با کاهش خرید (نسبت به نیمه اول سابقه)</div><div class="customer-tx-list customer-declining-products">' + decliningHtml + '</div>' : '') +
        (lv
          ? '<div class="card customer-last-visit-card">' +
            '<div class="label">آخرین ویزیت — ' +
            faDate(lv.date) +
            (lv.time ? ' ' + esc(lv.time) : '') +
            '</div>' +
            '<div class="customer-last-visit-body">' +
            lastVisitBits.join('<br>') +
            '</div></div>'
          : '<div class="empty customer-empty">ویزیتی ثبت نشده</div>') +
        '</details>';
    }

    /* Presentation helper: one labelled row of the identity block (label muted, value primary). */
    function cdMeta(label, value) {
      return '<div class="cd-meta-row"><span class="cd-meta-k">' + label + '</span><span class="cd-meta-v">' + esc(String(value)) + '</span></div>';
    }

    root.innerHTML =
      '<div class="btn-row" style="margin-bottom:10px;">' +
      '<a class="btn secondary small" href="' +
      customersHref() +
      '">← مشتریان</a></div>' +
      '<div class="card customer-identity-card">' +
      '<div class="customer-identity-name">' +
      esc(c.name) +
      '</div>' +
      '<div class="customer-identity-meta">' +
      (c.ownerName ? cdMeta('مسئول فروشگاه', c.ownerName) : '') +
      (c.phone ? cdMeta('تلفن', c.phone) : '') +
      (c.locationId
        ? cdMeta('موقعیت', getLocationDisplayString(c.locationId))
        : ((c.region ? cdMeta('منطقه', c.region) : '') +
           (c.route ? cdMeta('مسیر', c.route) : ''))) +
      (c.address ? cdMeta('آدرس', c.address) : '') +
      (c.note ? cdMeta('یادداشت', c.note) : '') +
      '</div>' +
      '<div class="bp-customer-health"><span class="bp-customer-health-label">وضعیت مشتری</span><span class="bp-customer-health-value ' + (customerRiskLevel ? 'radar-risk-' + esc(customerRiskLevel) : '') + '">' + esc(customerHealthLabel) + '</span></div>' +
      '<div class="customer-balance-block">' +
      '<div class="label">مانده حساب</div>' +
      '<div class="value ' +
      color +
      ' customer-balance-value">' +
      balanceLine +
      '</div></div>' +
      (attRow
        ? '<div class="bp-customer-attention">' +
            '<span class="bp-attention-icon" aria-hidden="true"></span>' +
            '<span>نیازمند پیگیری — ' +
              toman(attRow.balance) + ' ت' +
              (attRow.refKind === 'no_payment_history'
                ? '، ' + toman(attRow.daysSince) + ' روز از آخرین فاکتور، بدون پرداخت'
                : '، ' + toman(attRow.daysSince) + ' روز از آخرین پرداخت') +
            '</span>' +
          '</div>'
        : '') +
      unifiedSummaryHtml +
      '</div>' +
      focus.html +
      followUpTopHtml +
      (recommendedAction
        ? '<div class="cust-recommended-action">' +
          '<div class="cust-recommended-action-label">اقدام پیشنهادی</div>' +
          '<button type="button" class="btn cust-recommended-action-btn" id="cust-recommended-action">' +
          esc(recommendedAction.action) +
          '</button></div>'
        : '') +
      '<h3 class="sub-title">عملیات</h3>' +
      '<div class="btn-row cust-actions-primary" style="margin-bottom:8px;">' +
      '<button type="button" class="btn" id="act-invoice">ثبت فاکتور</button>' +
      '<button type="button" class="btn secondary" id="act-pay">ثبت پرداخت</button>' +
      '<button type="button" class="btn secondary" id="act-visit">ثبت ویزیت</button>' +
      '</div>' +
      '<details class="bp-customer-secondary-actions"><summary>سایر عملیات</summary>' +
      '<div class="btn-row cust-actions-secondary" style="margin-bottom:16px;">' +
      '<button type="button" class="btn small secondary" id="act-check">ثبت چک</button>' +
      '<button type="button" class="btn small secondary" id="act-edit">ویرایش مشتری</button>' +
      '<button type="button" class="btn small secondary" id="act-location">اختصاص موقعیت</button>' +
      '<button type="button" class="btn small secondary" id="act-print-statement">صورت‌حساب</button>' +
      '<button type="button" class="btn small secondary" id="act-toggle-active">' + (c.active === false ? 'فعال‌سازی مشتری' : 'غیرفعال‌سازی مشتری') + '</button>' +
      '</div></details>' +
      '<h3 class="sub-title">خلاصه مالی</h3>' +
      '<div class="cards cust-metrics">' +
      '<div class="card"><div class="label">مجموع خرید (فاکتورها)</div><div class="value">' +
      toman(t.invTotal) +
      ' ت</div></div>' +
      '<div class="card"><div class="label">مجموع پرداخت‌ها</div><div class="value">' +
      toman(t.payTotal) +
      ' ت</div></div>' +
      '<div class="card"><div class="label">جمع چک‌ها</div><div class="value">' +
      toman(t.checkTotal) +
      ' ت</div></div>' +
      '<div class="card"><div class="label">مانده اولیه</div><div class="value">' +
      toman(t.openingBalance) +
      ' ت</div></div>' +
      '<div class="card"><div class="label">تعداد فاکتور</div><div class="value">' +
      invs.length +
      '</div></div>' +
      '<div class="card"><div class="label">سود مشتری</div><div class="value">' +
      toman(profit) +
      ' ت</div></div>' +
      '</div>' +
      behaviorHtml +
      productRejectionInsightsHtml(c.id, ctx) +
      '<h3 class="sub-title">فاکتورها (' +
      invs.length +
      ')</h3>' +
      '<div class="customer-tx-list customer-invoice-list">' + invRows + '</div>' +
      '<h3 class="sub-title">پرداخت‌ها (' +
      pays.length +
      ')</h3>' +
      '<div class="customer-tx-list customer-payment-list">' + payRows + '</div>' +
      '<h3 class="sub-title">چک‌ها (' +
      chks.length +
      ')</h3>' +
      '<div class="customer-tx-list customer-check-list">' + chkRows + '</div>' +
      '<h3 class="sub-title">ویزیت‌ها و ارزیابی‌ها (' +
      visits.length +
      ')</h3>' +
      '<div class="btn-row" style="margin-bottom:8px;">' +
      '<button type="button" class="btn small" id="act-visit-section">ثبت ویزیت برای این مشتری</button>' +
      '<a class="btn small secondary" href="#/visits">همه ویزیت‌ها</a>' +
      '</div>' +
      '<div class="customer-tx-list customer-visit-list">' + visitRows + '</div>';

    document.getElementById('act-invoice').onclick = function () {
      openAddInvoice(c.id);
    };
    document.getElementById('act-pay').onclick = function () {
      openAddTransaction(c.id);
    };
    document.getElementById('act-visit').onclick = function () {
      openAddVisit(c.id);
    };
    const visitSecBtn = document.getElementById('act-visit-section');
    if (visitSecBtn)
      visitSecBtn.onclick = function () {
        openAddVisit(c.id);
      };
    document.getElementById('act-check').onclick = function () {
      openAddCheck(c.id);
    };
    document.getElementById('act-edit').onclick = function () {
      openAddCustomer(c.id);
    };
    document.getElementById('act-location').onclick = function () {
      openLocationAssignSheet({
        title: 'اختصاص موقعیت — ' + c.name,
        currentLocationId: c.locationId || null,
        onSave: async function (locationId) {
          await setCustomerLocation(c.id, locationId);
          showToast('موقعیت ذخیره شد');
          render();
        },
      });
    };
    const printBtn = document.getElementById('act-print-statement');
    if (printBtn) {
      printBtn.onclick = function () {
        if (typeof printCustomerStatement === 'function') printCustomerStatement(c.id);
      };
    }
    const recommendedBtn = document.getElementById('cust-recommended-action');
    if (recommendedBtn && recommendedAction) {
      recommendedBtn.onclick = function () {
        const type = recommendedAction.actionType;
        if (type === 'visit' || type === 'follow_up') {
          openAddVisit(c.id);
        } else if (type === 'check_followup') {
          openAddCheck(c.id);
        } else if (type === 'payment_followup') {
          openAddTransaction(c.id);
        } else {
          // For action types without a dedicated existing form (e.g. investigate,
          // manager_review, call), expose the existing explanation rather than
          // inventing a new workflow.
          const target = root.querySelector('.customer-behavior-details');
          if (target) target.open = true;
          if (target && typeof target.scrollIntoView === 'function') {
            target.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        }
      };
    }

    const toggleActiveBtn = document.getElementById('act-toggle-active');
    if (toggleActiveBtn) {
      toggleActiveBtn.onclick = async function (ev) {
        await withSubmitGuard(ev.currentTarget, async () => {
          const willDeactivate = c.active !== false;
          const msg = willDeactivate
            ? 'این مشتری غیرفعال شود؟ اطلاعات، فاکتورها، پرداخت‌ها، چک‌ها و سوابق او حذف نخواهد شد.'
            : 'مشتری «' + c.name + '» دوباره فعال شود؟';
          if (!(await appConfirm(msg))) throw new Error('validation');
          c.active = (c.active === false) ? true : false;
          await saveData();
          drawCustomerPage(rootEl || root);
          showToast(c.active === false ? 'مشتری غیرفعال شد' : 'مشتری فعال شد');
        });
      };
    }
    bindWatchLifecycleRows(root);
    bindWatchFollowUps(root, id);
  }


  /* Central quick view for the Customers list. Presentation-only: it reuses
     the frozen Priority/Watch/Balance outputs and existing action APIs. */
  function openCustomerQuickView(cid) {
    var c = (data.customers || []).find(function (x) { return x && x.id === cid; });
    if (!c) return;
    var ctx = typeof createComputationContext === 'function'
      ? createComputationContext({ data: data })
      : { aggregatePairMapCache: Object.create(null) };
    var totals = customerTotals(cid, ctx) || { balance: 0 };
    var priority = null;
    try { priority = typeof calculateCustomerPriority === 'function' ? calculateCustomerPriority(cid, { ctx: ctx }) : null; } catch (e) { priority = null; }
    var story = priority && priority.customerStory && priority.customerStory.summary ? priority.customerStory.summary : '';
    var riskLevel = priority ? priority.riskLevel : null;
    var health = riskLevel === 'critical' ? 'نیاز به رسیدگی فوری' : riskLevel === 'high' ? 'نیاز به توجه' : riskLevel === 'medium' ? 'قابل بررسی' : 'وضعیت عادی';
    var watchData = loadWatchData(cid, ctx);
    var focus = customerFocusHtml(cid, ctx, watchData).html || '';
    // Quick View is deliberately non-destructive: no occurrence opens from here.
    focus = focus
      .replace(/\sdata-watch-occ="[^"]*"/g, '')
      .replace(/\srole="button"/g, '')
      .replace(/\stabindex="0"/g, '')
      .replace(/\sclass="bp-topic is-tap"/g, ' class="bp-topic"')
      .replace(/<span class="bp-topic-chev"[^>]*>.*?<\/span>/g, '');

    var overlay = document.createElement('div');
    overlay.className = 'bp-qv-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.innerHTML =
      '<div class="bp-qv-card" role="document">' +
        '<button type="button" class="bp-qv-close" aria-label="بستن">×</button>' +
        '<div class="bp-qv-head">' +
          '<div class="bp-qv-name">' + esc(c.name || 'مشتری') + '</div>' +
          (c.ownerName ? '<div class="bp-qv-meta">' + esc(c.ownerName) + '</div>' : '') +
          (c.phone ? '<div class="bp-qv-meta">' + esc(c.phone) + '</div>' : '') +
          '<div class="bp-qv-balance ' + (totals.balance > 0 ? 'is-debt' : '') + '">' + esc(balanceStatusWord(totals.balance)) + (totals.balance !== 0 ? ': ' + toman(Math.abs(totals.balance)) + ' ت' : '') + '</div>' +
          '<div class="bp-qv-health radar-risk-' + esc(riskLevel || 'normal') + '">' + esc(health) + '</div>' +
        '</div>' +
        (story ? '<div class="bp-qv-story"><div class="bp-qv-section-label">خلاصه وضعیت</div><div>' + esc(story) + '</div></div>' : '') +
        (focus ? '<div class="bp-qv-focus">' + focus + '</div>' : '') +
        '<div class="bp-qv-actions">' +
          '<button type="button" class="btn primary" data-action="visit">ثبت ویزیت</button>' +
          '<button type="button" class="btn secondary" data-action="invoice">ثبت فاکتور</button>' +
          '<button type="button" class="btn secondary" data-action="payment">ثبت پرداخت</button>' +
        '</div>' +
        '<button type="button" class="bp-qv-full">مشاهده پروفایل کامل ›</button>' +
      '</div>';
    var modalRoot = document.getElementById('modalRoot');
    if (!modalRoot) return;
    modalRoot.innerHTML = '';
    modalRoot.appendChild(overlay);
    try { document.body.classList.add('modal-open'); } catch(_e) {}

    var card = overlay.querySelector('.bp-qv-card');
    var previousFocus = document.activeElement;
    var closed = false;
    function close() {
      if (closed) return;
      closed = true;
      overlay.classList.add('is-closing');
      setTimeout(function () {
        try { document.body.classList.remove('modal-open'); } catch(_e) {}
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        if (previousFocus && typeof previousFocus.focus === 'function') previousFocus.focus();
      }, 180);
      document.removeEventListener('keydown', onKeydown);
    }
    function onKeydown(e) { if (e.key === 'Escape') { e.preventDefault(); close(); } }
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay || e.target.closest('.bp-qv-close')) { e.preventDefault(); close(); return; }
      var action = e.target.closest('[data-action]');
      if (action) {
        e.preventDefault();
        var type = action.getAttribute('data-action');
        close();
        setTimeout(function () {
          if (type === 'visit' && typeof openAddVisit === 'function') openAddVisit(cid);
          else if (type === 'invoice' && typeof openAddInvoice === 'function') openAddInvoice(cid);
          else if (type === 'payment' && typeof openAddTransaction === 'function') openAddTransaction(cid);
        }, 185);
        return;
      }
      if (e.target.closest('.bp-qv-full') || e.target.closest('.bp-topic')) {
        e.preventDefault();
        close();
        setTimeout(function () { if (typeof AppRouter !== 'undefined' && AppRouter.navigate) AppRouter.navigate('/customer', { id: cid }); }, 185);
      }
    });
    document.addEventListener('keydown', onKeydown);
    requestAnimationFrame(function () { overlay.classList.add('is-open'); });
    var closeBtn = overlay.querySelector('.bp-qv-close');
    if (closeBtn) closeBtn.focus();

    // Lightweight downward swipe-to-close; no document-level gesture handling.
    var startY = null;
    if (card) {
      card.addEventListener('touchstart', function (e) { if (e.touches && e.touches[0]) startY = e.touches[0].clientY; }, { passive: true });
      card.addEventListener('touchend', function (e) {
        if (startY == null || !e.changedTouches || !e.changedTouches[0]) return;
        if (e.changedTouches[0].clientY - startY > 70) close();
        startY = null;
      }, { passive: true });
    }
  }

  function mount(root, params) {
    let refreshToken = null;
    if (!root) return function () {};
    rootEl = root;

    const nav = document.getElementById('nav');
    if (nav) nav.style.display = '';

    currentCustomerId = params && params.id ? params.id : null;
    function refreshCustomer() {
      // Per-cycle, RAM-only Context: shared only so that reconcileWatchLifecycle's
      // Watch-observation pass and the subsequent Priority/Signals pass (both of
      // which independently derive the same per-customer SKU aggregation) don't
      // recompute _aggregatePairMap twice for the same data snapshot. Discarded
      // after this refreshCustomer() call; never persisted, never reused elsewhere.
      var ctx = typeof createComputationContext === 'function'
        ? createComputationContext({ data: data })
        : { aggregatePairMapCache: Object.create(null) };
      function paint() { drawCustomerPage(rootEl || root, ctx); }
      // Paint immediately so the page is never blank if lifecycle reconcile hangs.
      paint();
      if (typeof reconcileWatchLifecycle === 'function' && currentCustomerId) {
        reconcileWatchLifecycle(currentCustomerId, ctx).then(paint).catch(function () { paint(); });
      }
    }
    refreshCustomer();
    refreshToken = ViewHost.setRefresh(refreshCustomer);

    return function unmount() {
      ViewHost.clearRefresh(refreshToken);
      refreshToken = null;
      currentCustomerId = null;
      root.classList.remove('customer-detail-view'); // UPDATED: Added for CSS scoping cleanup
      root.innerHTML = '';
      rootEl = null;
    };
  }

  global.CustomerView = { mount: mount, unmount: function () {} };
  global.openCustomerQuickView = openCustomerQuickView;
  // Test / settings seams for Product Rejection Insight (UI-only)
  global.getProductRejectionThreshold = getProductRejectionThreshold;
  global.setProductRejectionThreshold = setProductRejectionThreshold;
  global.buildProductRejectionInsights = buildProductRejectionInsights;

})(typeof window !== 'undefined' ? window : this);
