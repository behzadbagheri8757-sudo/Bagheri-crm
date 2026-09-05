/* js/views/customer.js — SPA Customer detail view (Phase 4).
   Extracted from customer.html. Uses customerTotals/customerProfit/customerBehavior
   and existing mutation APIs (openAddInvoice/openAddTransaction/openAddCheck/openAddVisit/
   openAddCustomer) exactly as the MPA page does. No new financial logic.
*/
'use strict';

(function (global) {
  let currentCustomerId = null;
  let rootEl = null;
  function customersHref() {
    return '#/customers';
  }

  function navigateToCustomer(cid) {
    if (
      typeof isSpaShell === 'function' &&
      isSpaShell() &&
      typeof AppRouter !== 'undefined' &&
      AppRouter.navigate
    ) {
      AppRouter.navigate('/customer', { id: cid });
    } else {
      location.href = '#/customer?id=' + encodeURIComponent(cid);
    }
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
  function buildProductRejectionInsights(customerId, threshold) {
    var out = [];
    if (!customerId || typeof customerBehavior !== 'function') return out;
    var thr = (threshold != null && Number.isFinite(Number(threshold)))
      ? Math.floor(Number(threshold))
      : getProductRejectionThreshold();
    if (thr < 1) thr = PRODUCT_REJECTION_THRESHOLD_DEFAULT;

    var b;
    try { b = customerBehavior(customerId); } catch (e) { return out; }
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
        lastOfferedDate: st.lastOfferedDate || null
      });
    }

    // Sort: most rejections first, then name (deterministic)
    out.sort(function (a, b) {
      if (b.rejectedCount !== a.rejectedCount) return b.rejectedCount - a.rejectedCount;
      return String(a.productName || '').localeCompare(String(b.productName || ''), 'fa');
    });
    return out;
  }

  function productRejectionInsightsHtml(customerId) {
    var items = [];
    try {
      items = buildProductRejectionInsights(customerId);
    } catch (e) {
      return '';
    }
    if (!items.length) return ''; // rule 15: hide section entirely

    var rows = items.map(function (it) {
      var reasonTxt = it.topRejectionReason
        ? ('دلیل غالب: ' + rejectionReasonLabel(it.topRejectionReason))
        : 'دلیل غالب: —';
      return '<div class="ledger-row" style="cursor:default;">' +
        '<span class="name">' + esc(it.productName) +
          '<span class="sub">' + reasonTxt + '</span></span>' +
        '<span class="filler"></span>' +
        '<span class="amount" style="font-size:.85rem;font-weight:600;">' +
          esc(String(it.rejectedCount)) + ' بار رد شده</span></div>';
    }).join('');

    return '<h3 class="sub-title">کالاهای ردشده توسط مشتری</h3>' +
      '<div class="dash-activity" style="margin-bottom:14px;">' + rows + '</div>';
  }

  function intelligenceWatchHtml(cid) {
    if (typeof extractCustomerSignals !== 'function' && typeof extractWatchObservations !== 'function' && typeof getActiveWatchOccurrences !== 'function') return '';

    var confirmed = [];
    if (typeof extractCustomerSignals === 'function') {
      try { confirmed = extractCustomerSignals(cid) || []; } catch (e) { confirmed = []; }
    }
    var activeConfirmed = confirmed.filter(function (s) { return s && s.status === 'active'; });

    // Lifecycle occurrences (preferred) — already reconciled by caller when possible
    var occs = [];
    if (typeof getActiveWatchOccurrences === 'function') {
      try { occs = getActiveWatchOccurrences(cid) || []; } catch (eOcc) { occs = []; }
    }
    // Fallback to raw generation if lifecycle absent. Guarded against
    // inactive customers too (W-BUG-02): this path bypasses
    // reconcileWatchLifecycle's own active-customer check entirely, so an
    // inactive customer must never reach it even as a display-only fallback.
    var custIsActive = true;
    if (typeof data !== 'undefined' && Array.isArray(data.customers)) {
      var custRec = data.customers.find(function (x) { return x && x.id === cid; });
      custIsActive = !!(custRec && custRec.active !== false);
    }
    if (!occs.length && custIsActive && typeof extractWatchObservations === 'function') {
      try {
        var raw = extractWatchObservations(cid, confirmed) || [];
        occs = raw.map(function (w, idx) {
          return {
            id: null,
            customerId: cid,
            productId: w.productId,
            productName: w.productName,
            watchCategory: w.category,
            level: w.level,
            generatedReason: w.reason,
            reason: null,
            status: 'active'
          };
        });
      } catch (e2) { occs = []; }
    }

    if (!occs.length && !activeConfirmed.length) return '';

    function levelClass(level) {
      return level === 'critical' ? 'watch-level-critical' : level === 'high' ? 'watch-level-high' : level === 'medium' ? 'watch-level-medium' : 'watch-level-low';
    }
    function levelLabel(level) {
      return level === 'critical' ? 'بحرانی' : level === 'high' ? 'زیاد' : level === 'medium' ? 'متوسط' : 'کم';
    }

    var confirmedHtml = '';
    if (activeConfirmed.length) {
      var crows = activeConfirmed.map(function (s) {
        var label = (s.productName ? ('«' + esc(s.productName) + '» — ') : '') + esc(s.reason || '');
        return '<div style="font-size:.85rem;line-height:1.9;display:flex;justify-content:space-between;gap:8px;">' +
          '<span>• ' + label + '</span>' +
          '<span class="watch-level-label ' + levelClass(s.severity) + '" style="font-weight:600;white-space:nowrap;">' + esc(levelLabel(s.severity)) + '</span>' +
          '</div>';
      }).join('');
      confirmedHtml = '<div class="card wide" style="margin-bottom:10px;">' +
        '<div class="label">هوش تجاری — تأییدشده (CONFIRMED)</div>' +
        '<div style="margin-top:6px;">' + crows + '</div></div>';
    }

    var watchHtml = '';
    if (occs.length) {
      var wrows = occs.map(function (o) {
        var label = (o.productName ? ('«' + esc(o.productName) + '» — ') : '') + esc(o.generatedReason || '');
        var reviewed = !!(o.reason);
        var badge = reviewed
          ? '<span style="color:var(--olive-dark);font-weight:600;font-size:.78rem;">بررسی شده</span>'
          : '<span class="watch-level-unreviewed" style="font-weight:600;font-size:.78rem;">بررسی نشده</span>';
        var reasonBit = '';
        if (reviewed && o.reason) {
          var rlabel = (typeof watchReasonLabel === 'function') ? watchReasonLabel(o.reason.code) : (o.reason.code || '');
          reasonBit = '<div style="font-size:.78rem;color:var(--ink-soft);margin-top:2px;">علت: ' + esc(rlabel) +
            (o.reason.comment ? (' — ' + esc(o.reason.comment)) : '') + '</div>';
        }
        var clickable = o.id
          ? (' data-watch-occ="' + esc(o.id) + '" role="button" tabindex="0" style="cursor:pointer;"')
          : '';
        return '<div class="watch-occ-row"' + clickable + ' style="font-size:.85rem;line-height:1.7;padding:8px 0;border-bottom:1px dotted var(--line);">' +
          '<div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start;">' +
            '<span>• ' + label + '</span>' +
            '<span style="text-align:left;white-space:nowrap;">' + badge +
              '<div class="watch-level-label ' + levelClass(o.level) + '" style="font-weight:600;font-size:.78rem;">' + esc(levelLabel(o.level)) + '</div>' +
            '</span>' +
          '</div>' + reasonBit +
        '</div>';
      }).join('');
      watchHtml = '<div class="card wide" style="margin-bottom:10px;" id="watch-lifecycle-card">' +
        '<div class="label">هشدارهای زودهنگام</div>' +
        '<div class="report-note" style="margin:4px 0 8px;">برای ثبت علت، روی مورد بزنید. ثبت علت، هشدار را حذف نمی‌کند.</div>' +
        '<div style="margin-top:6px;">' + wrows + '</div></div>';
    }

    return confirmedHtml + watchHtml;
  }

  function openWatchReasonSheet(occurrenceId, onDone) {
    if (!occurrenceId || typeof recordWatchReason !== 'function') return;
    var options = (typeof WATCH_REASON_OPTIONS !== 'undefined' && Array.isArray(WATCH_REASON_OPTIONS))
      ? WATCH_REASON_OPTIONS
      : [
          { code: 'still_stock', label: 'موجودی مشتری هنوز کافی است' },
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
      '<div class="report-note" style="margin-bottom:10px;">علت فقط مشاهده است و هشدار را حل‌شده نمی‌کند.</div>' +
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

  function drawCustomerPage(root) {
    if (!root) return;
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

    const t = customerTotals(c.id);
    const profit = customerProfit(c.id);
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
    {
      let priority = null, action = null;
      try { if (typeof calculateCustomerPriority === 'function') priority = calculateCustomerPriority(c.id); } catch (eP) { priority = null; }
      try { if (typeof calculateCustomerAction === 'function') action = calculateCustomerAction(c.id); } catch (eA) { action = null; }
      recommendedAction = action && action.actionType !== 'no_action' ? action : null;
      const riskLevel = priority ? priority.riskLevel : null;
      const storyText = (priority && priority.customerStory && priority.customerStory.summary) ? priority.customerStory.summary : '';
      if (storyText) {
        unifiedSummaryHtml =
          '<div class="cust-summary ' + (riskLevel ? 'radar-risk-' + esc(riskLevel) : '') + '">' +
          '<div class="cust-summary-story">' + esc(storyText) + '</div>' +
          '</div>';
      }
    }

    const invs = customerInvoices(c.id)
      .slice()
      .sort(function (a, b) {
        return (b.date || '').localeCompare(a.date || '') || String(b.number).localeCompare(String(a.number));
      });
    const pays = customerPayments(c.id)
      .slice()
      .sort(function (a, b) {
        return (b.date || '').localeCompare(a.date || '');
      });
    const chks = customerChecks(c.id)
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
              '<a class="ledger-row" href="#/invoice?id=' +
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
              var rrMap = { price: 'قیمت', quality: 'کیفیت', competitor: 'رقیب', unavailable: 'ناموجود', no_need: 'عدم نیاز', other: 'سایر' };
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
                return '<span class="sub">' + esc(x) + '</span>';
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
      const b = customerBehavior(c.id);
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
                  return '🔹 ' + esc(x);
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
                  p.qty +
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
                  p.earlyQty +
                  ' ← اخیراً ' +
                  p.lateQty +
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

      const watchHtmlBlock = intelligenceWatchHtml(c.id);
      behaviorHtml =
        '<h3 class="sub-title">رفتار خرید و هوش تجاری</h3>' +
        (watchHtmlBlock
          ? '<details open style="margin-bottom:12px;">' +
            '<summary style="cursor:pointer;color:var(--olive-dark);font-weight:700;padding:6px 0;list-style:none;">نشانه‌ها و هشدارها ▾</summary>' +
            '<div style="margin-top:8px;">' + watchHtmlBlock + '</div></details>'
          : '') +
        '<details style="margin-bottom:12px;">' +
        '<summary style="cursor:pointer;color:var(--olive-dark);font-weight:700;padding:6px 0;list-style:none;">تحلیل رفتار خرید ▾</summary>' +
        summaryHtml +
        '<div class="cards" style="margin-top:10px;margin-bottom:10px;">' +
        '<div class="card"><div class="label">اولین خرید</div><div class="value" style="font-size:.95rem;">' +
        (b.firstInvoiceDate ? faDate(b.firstInvoiceDate) : '—') +
        '</div></div>' +
        '<div class="card"><div class="label">آخرین خرید</div><div class="value" style="font-size:.95rem;">' +
        (b.lastInvoiceDate ? faDate(b.lastInvoiceDate) : '—') +
        '</div></div>' +
        '<div class="card"><div class="label">تعداد فاکتور</div><div class="value">' +
        b.invoiceCount +
        '</div></div>' +
        '<div class="card"><div class="label">میانگین مبلغ فاکتور</div><div class="value" style="font-size:.95rem;">' +
        (b.avgInvoice != null ? toman(b.avgInvoice) + ' ت' : '—') +
        '</div></div>' +
        '<div class="card"><div class="label">الگوی معمول خرید</div><div class="value" style="font-size:.9rem;">' +
        esc(String(intervalText)) +
        '</div></div>' +
        '<div class="card"><div class="label">فاصله از آخرین خرید</div><div class="value" style="font-size:.95rem;">' +
        esc(String(gapText)) +
        '</div></div>' +
        '<div class="card"><div class="label">خرید خالص ۳۰ روز</div><div class="value" style="font-size:.95rem;">' +
        toman(b.sales30 || 0) +
        ' ت</div></div>' +
        '<div class="card"><div class="label">خرید خالص ۹۰ روز</div><div class="value" style="font-size:.95rem;">' +
        toman(b.sales90 || 0) +
        ' ت</div></div>' +
        (b.returnTotal > 0
          ? '<div class="card wide"><div class="label">جمع برگشت از فروش (کل سابقه)</div><div class="value" style="font-size:.95rem;">' +
            toman(b.returnTotal) +
            ' ت</div></div>'
          : '') +
        (trendLabel
          ? '<div class="card wide"><div class="label">روند مبلغ (۳۰ روز اخیر نسبت به ۳۰ روز قبل)</div><div class="value ' +
            trendCls +
            '" style="font-size:1rem;">' +
            trendLabel +
            '</div></div>'
          : '<div class="card wide"><div class="label">روند مبلغ</div><div class="value" style="font-size:.9rem;">اطلاعات کافی نیست</div></div>') +
        behindHtml +
        '<div class="card"><div class="label">تعداد ویزیت</div><div class="value">' +
        b.visitCount +
        '</div></div>' +
        '<div class="card"><div class="label">نرخ تبدیل ویزیت به سفارش</div><div class="value" style="font-size:.85rem;">' +
        esc(String(convText)) +
        '</div></div>' +
        '</div>' +
        '<div class="sub-title" style="margin-top:4px;">کالاهای اصلی مشتری</div>' +
        topProdHtml +
        (decliningHtml ? '<div class="sub-title" style="margin-top:10px;">کالاهای با کاهش خرید (نسبت به نیمه اول سابقه)</div>' + decliningHtml : '') +
        (lv
          ? '<div class="card" style="margin-top:10px;margin-bottom:12px;">' +
            '<div class="label">آخرین ویزیت — ' +
            faDate(lv.date) +
            (lv.time ? ' ' + esc(lv.time) : '') +
            '</div>' +
            '<div style="font-size:.88rem;line-height:1.7;margin-top:6px;">' +
            lastVisitBits.join('<br>') +
            '</div></div>'
          : '<div class="empty" style="padding:8px 0 12px;">ویزیتی ثبت نشده</div>') +
        '</details>';
    }

    root.innerHTML =
      '<div class="btn-row" style="margin-bottom:10px;">' +
      '<a class="btn secondary small" href="' +
      customersHref() +
      '">← مشتریان</a></div>' +
      '<div class="card" style="margin-bottom:12px;">' +
      '<div style="font-size:1.15rem;font-weight:800;color:var(--olive-dark);margin-bottom:8px;">' +
      esc(c.name) +
      '</div>' +
      '<div style="font-size:.88rem;line-height:1.85;color:var(--ink);">' +
      (c.ownerName ? '<div>مسئول فروشگاه: ' + esc(c.ownerName) + '</div>' : '') +
      (c.phone ? '<div>تلفن: ' + esc(c.phone) + '</div>' : '') +
      (c.locationId
        ? '<div>موقعیت: ' + esc(getLocationDisplayString(c.locationId)) + '</div>'
        : ((c.region ? '<div>منطقه: ' + esc(c.region) + '</div>' : '') +
           (c.route ? '<div>مسیر: ' + esc(c.route) + '</div>' : ''))) +
      (c.address ? '<div>آدرس: ' + esc(c.address) + '</div>' : '') +
      (c.note ? '<div>یادداشت: ' + esc(c.note) + '</div>' : '') +
      '</div>' +
      '<div style="margin-top:12px;padding-top:10px;border-top:1px dotted var(--line);">' +
      '<div class="label">مانده حساب</div>' +
      '<div class="value ' +
      color +
      '" style="font-size:1.25rem;">' +
      balanceLine +
      '</div></div></div>' +
      unifiedSummaryHtml +
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
      '<div class="btn-row cust-actions-secondary" style="margin-bottom:16px;">' +
      '<button type="button" class="btn small secondary" id="act-check">ثبت چک</button>' +
      '<button type="button" class="btn small secondary" id="act-edit">ویرایش مشتری</button>' +
      '<button type="button" class="btn small secondary" id="act-location">اختصاص موقعیت</button>' +
      '<button type="button" class="btn small secondary" id="act-print-statement">🖨️ صورت‌حساب</button>' +
      '<button type="button" class="btn small secondary" id="act-toggle-active">' + (c.active === false ? 'فعال‌سازی مشتری' : 'غیرفعال‌سازی مشتری') + '</button>' +
      '</div>' +
      '<div class="cards" style="margin-bottom:14px;">' +
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
      '<div class="card"><div class="label">سود مشتری</div><div class="value accent-amber">' +
      toman(profit) +
      ' ت</div></div>' +
      '</div>' +
      behaviorHtml +
      productRejectionInsightsHtml(c.id) +
      '<h3 class="sub-title">فاکتورها (' +
      invs.length +
      ')</h3>' +
      invRows +
      '<h3 class="sub-title">پرداخت‌ها (' +
      pays.length +
      ')</h3>' +
      payRows +
      '<h3 class="sub-title">چک‌ها (' +
      chks.length +
      ')</h3>' +
      chkRows +
      '<h3 class="sub-title">ویزیت‌ها و ارزیابی‌ها (' +
      visits.length +
      ')</h3>' +
      '<div class="btn-row" style="margin-bottom:8px;">' +
      '<button type="button" class="btn small" id="act-visit-section">ثبت ویزیت برای این مشتری</button>' +
      '<a class="btn small secondary" href="#/visits">همه ویزیت‌ها</a>' +
      '</div>' +
      visitRows;

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
          const target = root.querySelector('details');
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
          if (!confirm(msg)) throw new Error('validation');
          c.active = (c.active === false) ? true : false;
          await saveData();
          drawCustomerPage(rootEl || root);
          showToast(c.active === false ? 'مشتری غیرفعال شد' : 'مشتری فعال شد');
        });
      };
    }
    bindWatchLifecycleRows(root);
  }

  function mount(root, params) {
    let refreshToken = null;
    if (!root) return function () {};
    rootEl = root;

    const nav = document.getElementById('nav');
    if (nav) nav.style.display = '';

    currentCustomerId = params && params.id ? params.id : null;
    function refreshCustomer() {
      function paint() { drawCustomerPage(rootEl || root); }
      if (typeof reconcileWatchLifecycle === 'function' && currentCustomerId) {
        reconcileWatchLifecycle(currentCustomerId).then(paint).catch(function () { paint(); });
      } else {
        paint();
      }
    }
    refreshCustomer();
    refreshToken = ViewHost.setRefresh(refreshCustomer);

    return function unmount() {
      ViewHost.clearRefresh(refreshToken);
      refreshToken = null;
      currentCustomerId = null;
      root.innerHTML = '';
      rootEl = null;
    };
  }

  global.CustomerView = { mount: mount, unmount: function () {} };
  // Test / settings seams for Product Rejection Insight (UI-only)
  global.getProductRejectionThreshold = getProductRejectionThreshold;
  global.setProductRejectionThreshold = setProductRejectionThreshold;
  global.buildProductRejectionInsights = buildProductRejectionInsights;

})(typeof window !== 'undefined' ? window : this);
