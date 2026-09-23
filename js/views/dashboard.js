/* js/views/dashboard.js — Daily Command Center
   UI/derived metrics only. Existing accounting logic remains authoritative.
*/
'use strict';

(function (global) {
  const ICON_MAP = { invoice:'invoice', users:'users', box:'cube', card:'creditcard', truck:'truck', bank:'bank', visit:'visit', chart:'chartBar', gear:'cog', warehouse:'warehouse', shop:'buildingStorefront', target:'target', growth:'growth', game:'trophy', actions:'checklist', summary:'chartDoc', quick:'plusCircle', invoiceSection:'invoice', visitSection:'visit' };
  const URGENCY_ICON_MAP = { critical:'urgencyCritical', high:'urgencyHigh', medium:'urgencyMedium', low:'urgencyLow' };
  function dashboardIcon(key, size) { var name=ICON_MAP[key]||key; return (typeof AppIcons!=='undefined' && AppIcons.render) ? AppIcons.render(name,{size:size||20}) : ''; }
  function urgencyIcon(level) { return dashboardIcon(URGENCY_ICON_MAP[level]||URGENCY_ICON_MAP.low,20); }

  function dashSectionHead(ico, title, href, action, badge) {
    return '<div class="dashboard-block-head"><div class="dash-section-label"><span class="dash-section-ico" aria-hidden="true">' + ico + '</span><span>' + title + '</span>' + (badge || '') + '</div>' + (href ? '<a class="section-action" href="' + href + '">' + action + '</a>' : '') + '</div>';
  }

  function normalizeDigits(v) {
    return String(v || '').replace(/[۰-۹]/g, function (d) { return String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)); }).replace(/[٠-٩]/g, function (d) { return String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)); });
  }

  function money(v) { return toman(Math.round(Number(v) || 0)) + ' ت'; }

  function deltaHtml(pct) {
    if (pct === null || pct === undefined || !isFinite(pct)) return '<span class="kpi-delta flat">بدون مقایسه</span>';
    const n = Math.round(pct * 10) / 10;
    if (n > 0) return '<span class="kpi-delta up">↑ ' + esc(String(n).replace('-', '')) + '٪</span> <span>نسبت به بازه مشابه</span>';
    if (n < 0) return '<span class="kpi-delta down">↓ ' + esc(String(Math.abs(n))) + '٪</span> <span>نسبت به بازه مشابه</span>';
    return '<span class="kpi-delta flat">۰٪</span> <span>بدون تغییر</span>';
  }

  function dashTile(href, ico, title, sub) {
    return '<a class="dash-tile" href="' + href + '"><span class="dash-ico">' + ico + '</span><span class="dash-title">' + title + '</span>' + (sub ? '<span class="dash-sub">' + sub + '</span>' : '') + '</a>';
  }

  /* Quick Actions: opens a tiny customer picker, then delegates to the existing
     global add-* functions (openAddInvoice/openAddTransaction/openAddVisit).
     No new business logic — same pattern as invoices.js's openNewInvoicePicker. */
  function quickActionPickCustomer(title, fn) {
    if (!data.customers || !data.customers.length) {
      if (typeof openSheet === 'function') {
        openSheet('<h3>مشتری ندارید</h3><div class="empty">اول از بخش مشتریان، یک مشتری ثبت کنید.</div>' +
          '<div class="btn-row"><a class="btn secondary" href="#/customers">رفتن به مشتریان</a></div>');
      }
      return;
    }
    const opts = data.customers.slice().sort(function (a, b) { return (a.name || '').localeCompare(b.name || '', 'fa'); })
      .map(function (c) { return '<option value="' + esc(c.id) + '">' + esc(c.name) + '</option>'; }).join('');
    openSheet(
      '<h3>' + esc(title) + '</h3>' +
      '<div class="field"><label>مشتری</label><select id="qa-pick-customer">' + opts + '</select></div>' +
      '<div class="btn-row"><button class="btn" id="qa-pick-go">ادامه</button></div>'
    );
    const goBtn = document.getElementById('qa-pick-go');
    if (goBtn) goBtn.onclick = function () {
      const cid = document.getElementById('qa-pick-customer').value;
      closeModal();
      if (typeof fn === 'function') fn(cid);
    };
  }

  function quickActionsHtml() {
    const gameShortcut = '<a class="section-action" href="#/game">Sales Game ←</a>';
  function qaIco(name) { return dashboardIcon(name, 20); }

  return '<div class="dashboard-block dash-quick-actions-block">' +
      '<div class="dashboard-block-head"><div class="dash-section-label"><span class="dash-section-ico" aria-hidden="true">' + dashboardIcon('quick',20) + '</span><span>اقدام سریع</span></div>' + gameShortcut + '</div>' +
      '<div class="dash-quick-actions dash-qa-bar">' +
        '<button type="button" class="dash-qa-btn" data-qa="invoice"><span class="dash-qa-ico" aria-hidden="true">' + qaIco('invoice') + '</span><span class="dash-qa-label">فاکتور جدید</span></button>' +
        '<button type="button" class="dash-qa-btn" data-qa="payment"><span class="dash-qa-ico" aria-hidden="true">' + qaIco('card') + '</span><span class="dash-qa-label">ثبت دریافت</span></button>' +
        '<button type="button" class="dash-qa-btn" data-qa="visit"><span class="dash-qa-ico" aria-hidden="true">' + qaIco('visit') + '</span><span class="dash-qa-label">ثبت ویزیت</span></button>' +
        '<a class="dash-qa-btn" href="#/evaluation"><span class="dash-qa-ico" aria-hidden="true">' + qaIco('shop') + '</span><span class="dash-qa-label">ارزیابی مغازه</span></a>' +
      '</div>' +
    '</div>';
  }

  function bindQuickActions(root) {
    const wrap = root.querySelector('.dash-quick-actions');
    if (!wrap) return;
    wrap.addEventListener('click', function (e) {
      const btn = e.target.closest('[data-qa]');
      if (!btn) return;
      const kind = btn.getAttribute('data-qa');
      if (kind === 'invoice') quickActionPickCustomer('فاکتور جدید — انتخاب مشتری', function (cid) { if (typeof openAddInvoice === 'function') openAddInvoice(cid); });
      else if (kind === 'payment') quickActionPickCustomer('ثبت دریافت — انتخاب مشتری', function (cid) { if (typeof openAddTransaction === 'function') openAddTransaction(cid); });
      else if (kind === 'visit') quickActionPickCustomer('ثبت ویزیت — انتخاب مشتری', function (cid) { if (typeof openAddVisit === 'function') openAddVisit(cid); });
    });
  }


  /* «کارهای پیشنهادی امروز» — pure UI read of the existing Action Engine.
     No decision logic here: sorting, urgency, action text and reason all
     come from calculateAllCustomerActions() as-is. This function only
     looks up the customer's name (read-only) and renders the existing
     dashboard-block/ledger-row markup used elsewhere on this page. */
  function todaysActionsHtml(ctx) {
    // Prefer unified queue; fall back to legacy customer-only actions.
    let items = [];
    try {
      if (typeof calculateAllActions === 'function') {
        items = (calculateAllActions(ctx) || []).filter(function (a) {
          return a && a.actionType !== 'no_action';
        });
      } else if (typeof calculateAllCustomerActions === 'function') {
        items = (calculateAllCustomerActions(ctx) || []).filter(function (a) {
          return a && a.actionType !== 'no_action';
        });
      }
    } catch (e) { return ''; }
    if (!items.length) {
      return '<div class="dashboard-block">' +
        dashSectionHead(dashboardIcon('actions',20), 'کارهای پیشنهادی امروز', '', '') +
        '<div class="dash-activity">' +
          '<div class="empty" style="padding:18px 8px;text-align:center;">' +
            '<div style="font-weight:600;color:#1F2937;margin-bottom:4px;">امروز کار ضروری نداری</div>' +
            '<div class="sub" style="opacity:.85;">وضعیت مشتری‌ها و پتانسیل‌ها تحت کنترل است.</div>' +
          '</div>' +
        '</div></div>';
    }

    // Max Top 5 by unifiedScore (already sorted by calculateAllActions)
    items = items.slice(0, 5);

    const visibleItems = items.slice(0, 2);
    const hiddenItems = items.slice(2);

    function renderRow(a) {
      const isProspect = a.type === 'prospect';
      const name = a.name || (function () {
        if (a.customerId && typeof data !== 'undefined') {
          const cust = (data.customers || []).find(function (c) { return c.id === a.customerId; });
          return cust ? cust.name : '—';
        }
        return '—';
      })();
      const badge = isProspect ? 'پتانسیل' : 'مشتری';
      const urgency = a.urgency || 'low';
      const icon = urgencyIcon(urgency);
      const actionText = a.action || '';
      const why = a.reason || '';
      const whyNow = a.whyNow || '';
      const href = isProspect
        ? ('#/prospect?id=' + encodeURIComponent(a.prospectId || ''))
        : ('#/customer?id=' + encodeURIComponent(a.customerId || ''));
      const lines = [];
      lines.push('<span class="action-person">' + esc(name) +
        '</span> <span class="action-badge">' + esc(badge) + '</span>');
      if (actionText) {
        lines.push('<span class="action-main">' + esc(actionText) + '</span>');
      }
      if (why) {
        lines.push('<span class="action-why"><span class="action-meta-label">چرا:</span> ' + esc(why) + '</span>');
      }
      if (whyNow) {
        lines.push('<span class="action-why-now"><span class="action-meta-label-now">الان:</span> ' + esc(whyNow) + '</span>');
      }
      return '<a class="ledger-row action-row action-row-' + esc(urgency) + '" href="' + href + '">' +
        '<span class="amount action-urgency action-urgency-' + esc(urgency) + '" aria-label="اولویت ' + esc(urgency) + '">' + icon + '</span>' +
        '<span class="name action-content">' + lines.join('') + '</span>' +
        '<span class="filler"></span>' +
      '</a>';
    }

    const visibleRows = visibleItems.map(renderRow).join('');
    let hiddenBlock = '';
    if (hiddenItems.length) {
      const hiddenRows = hiddenItems.map(renderRow).join('');
      hiddenBlock =
        '<div class="dash-action-more" data-action-more hidden>' + hiddenRows + '</div>' +
        '<button type="button" class="dash-action-toggle" data-action-toggle aria-expanded="false">' +
          '<span data-action-toggle-label>نمایش ' + enToFaDigits(String(hiddenItems.length)) + ' کار دیگر</span>' +
          '<span class="dash-action-toggle-ico" aria-hidden="true">›</span>' +
        '</button>';
    }

    const riskCount = items.filter(function (a) {
      return a && (a.urgency === 'critical' || a.urgency === 'high');
    }).length;
    const riskBadge = riskCount > 0
      ? '<span class="dash-risk-badge" title="تعداد موارد بحرانی/پراهمیت در همین لیست">' + riskCount + ' مورد مهم</span>'
      : '';

    return '<div class="dashboard-block">' + dashSectionHead(dashboardIcon('actions',20), 'کارهای پیشنهادی امروز', '', '', riskBadge) + '<div class="dash-activity dash-action-queue">' + visibleRows + hiddenBlock + '</div></div>';
  }

  /* Toggles the collapsed remainder of the Action Queue (items 3-5).
     Presentation-only: does not alter which actions exist, their order, or count. */
  function bindActionQueueToggle(root) {
    const btn = root.querySelector('[data-action-toggle]');
    const more = root.querySelector('[data-action-more]');
    const label = root.querySelector('[data-action-toggle-label]');
    if (!btn || !more) return;
    const hiddenCount = more.querySelectorAll('.action-row').length;
    btn.addEventListener('click', function () {
      const expanded = btn.getAttribute('aria-expanded') === 'true';
      if (expanded) {
        more.hidden = true;
        btn.setAttribute('aria-expanded', 'false');
        btn.classList.remove('is-open');
        if (label) label.textContent = 'نمایش ' + hiddenCount + ' کار دیگر';
      } else {
        more.hidden = false;
        btn.setAttribute('aria-expanded', 'true');
        btn.classList.add('is-open');
        if (label) label.textContent = 'نمایش کمتر';
      }
    });
  }

  /* --- Watch / Early Warning + Lifecycle (additive) ---
     Generation still comes from extractWatchObservations via
     reconcileWatchLifecycle. The Dashboard no longer lists individual
     Watch rows here — it shows one compact summary card that links to
     the full Watch List (#/watches). Per-occurrence rendering now lives
     in js/views/watches.js (WatchesView / WatchDetailView), which reads
     the same existing public Watch API used below. */
  function faDigits(n) {
    return String(n).replace(/[0-9]/g, function (d) { return '۰۱۲۳۴۵۶۷۸۹'[d]; });
  }

  function watchSummaryHtml(ctx) {
    var count = 0;
    var haveCount = false;

    if (typeof getWatchLifecycleSummary === 'function') {
      try {
        var summary = getWatchLifecycleSummary();
        if (summary && typeof summary.active === 'number') {
          count = summary.active;
          haveCount = true;
        }
      } catch (eS) { /* fall through to fallback below */ }
    }

    if (!haveCount && typeof extractWatchObservations === 'function' && typeof data !== 'undefined' && Array.isArray(data.customers)) {
      // Fallback when lifecycle module not loaded (mirrors prior behavior)
      var customers = data.customers.filter(function (c) { return c && c.active !== false; });
      for (var ci = 0; ci < customers.length; ci++) {
         try { count += (extractWatchObservations(customers[ci].id, undefined, ctx) || []).length; } catch (e) { /* skip */ }
      }
      haveCount = true;
    }

    if (!count) return '';

    return '<div class="dashboard-block">' + dashSectionHead(dashboardIcon('actions',20), 'هشدارهای زودهنگام', '', '') +
      '<a class="dash-watch-compact" href="#/watches">' +
        '<span class="dash-watch-compact-ico" aria-hidden="true">' + dashboardIcon('actions',20) + '</span>' +
        '<span class="dash-watch-compact-body">' +
          '<span class="dash-watch-compact-count">' + faDigits(count) + ' مورد</span>' +
          '<span class="dash-watch-compact-label">هشدارهای فعال</span>' +
        '</span>' +
        '<span class="dash-watch-compact-chevron" aria-hidden="true">‹</span>' +
      '</a>' +
      '</div>';
  }

  function recentInvoicesHtml(ctx) {
    const invs = (data.invoices || []).slice().sort(function (a, b) {
      return (b.date || '').localeCompare(a.date || '') || String(b.number || '').localeCompare(String(a.number || ''));
    }).slice(0, 5);
    if (!invs.length) return '';
    const rows = invs.map(function (inv) {
      const cust = ctx && typeof ctx.customerById === 'function'
        ? ctx.customerById(inv.customerId)
        : (data.customers || []).find(function (c) { return c.id === inv.customerId; });
      return '<a class="ledger-row" href="#/invoice?id=' + encodeURIComponent(inv.id) + '"><span class="name">فاکتور #' + esc(String(inv.number || '')) + '<span class="sub">' + esc(cust ? cust.name : '—') + ' — ' + faDate(inv.date) + '</span></span><span class="filler"></span><span class="amount">' + money(inv.total) + '</span></a>';
    }).join('');
    /* Inner section only — parent .dash-activity-group provides the surface */
    return '<div class="dash-activity-section">' + dashSectionHead(dashboardIcon('invoiceSection',20), 'آخرین فاکتورها', '#/invoices', 'همه ←') + '<div class="dash-activity">' + rows + '</div></div>';
  }

  function recentVisitsHtml() {
    const items = [];
    (data.customers || []).forEach(function (c) {
      (c.visits || []).forEach(function (v) { items.push({ customerId: c.id, name: c.name, date: v.date, time: v.time, result: v.result }); });
    });
    items.sort(function (a, b) { return (b.date || '').localeCompare(a.date || '') || (b.time || '').localeCompare(a.time || ''); });
    const top = items.slice(0, 5);
    if (!top.length) return '';
    const rows = top.map(function (v) {
      return '<a class="ledger-row" href="#/customer?id=' + encodeURIComponent(v.customerId) + '"><span class="name">' + esc(v.name) + '<span class="sub">' + faDate(v.date) + (v.time ? ' ' + esc(v.time) : '') + (v.result ? ' — ' + esc(v.result) : '') + '</span></span><span class="filler"></span><span class="amount">ویزیت</span></a>';
    }).join('');
    /* Inner section only — parent .dash-activity-group provides the surface */
    return '<div class="dash-activity-section">' + dashSectionHead(dashboardIcon('visitSection',20), 'آخرین ویزیت‌ها', '#/visits', 'همه ←') + '<div class="dash-activity">' + rows + '</div></div>';
  }

  function targetHtml(metrics) {
    const target = typeof getMonthlySalesTarget === 'function' ? getMonthlySalesTarget() : 0;
    const sales = Number(metrics.mtdSales) || 0;
    const pct = target > 0 ? Math.round((sales / target) * 100) : 0;
    const capped = Math.min(100, Math.max(0, pct));
    const done = target > 0 && sales >= target;

    // Figures + pace/status line: derived only from existing commandCenterMetrics
    // (jy/jm/jd) and the existing jalaliMonthLength() helper. No new data source.
    let figuresHtml = '';
    let statusRowHtml = '';
    if (target > 0) {
      figuresHtml = '<div class="dmt-figures"><span class="dmt-figures-num">' + toman(sales) + '</span>' +
        ' <span class="dmt-figures-sep">از</span> ' +
        '<span class="dmt-figures-num">' + toman(target) + '</span>' +
        ' <span class="dmt-figures-unit">تومان</span></div>';

      if (!done) {
        const monthLen = (metrics.jy && metrics.jm && typeof jalaliMonthLength === 'function')
          ? jalaliMonthLength(metrics.jy, metrics.jm) : null;
        const remaining = Math.max(0, target - sales);
        let paceHtml = '';
        let statusMeta = null;
        if (monthLen) {
          const daysLeft = Math.max(0, monthLen - (metrics.jd || 0));
          const expectedFraction = Math.min(1, (metrics.jd || 0) / monthLen);
          const expectedSales = target * expectedFraction;
          if (sales >= expectedSales * 1.05) statusMeta = { cls: 'ahead', icon: '↑', text: 'جلوتر از برنامه' };
          else if (sales <= expectedSales * 0.95) statusMeta = { cls: 'behind', icon: '⚠', text: 'عقب‌تر از برنامه' };
          else statusMeta = { cls: 'ontrack', icon: '✓', text: 'روی برنامه' };
          if (daysLeft > 0) {
            const requiredDaily = Math.round(remaining / daysLeft);
            paceHtml = '<span class="dmt-pace">نیاز روزانه ' + toman(requiredDaily) + ' ت' +
              ' <span class="dmt-pace-days">(' + enToFaDigits(String(daysLeft)) + ' روز مانده)</span></span>';
          }
        }
        if (statusMeta) {
          statusRowHtml = '<div class="dmt-status-row">' +
            '<span class="dmt-status-chip dmt-status-' + statusMeta.cls + '">' + statusMeta.icon + ' ' + statusMeta.text + '</span>' +
            paceHtml +
            '</div>';
        }
      }
    }

    return (
      '<div class="dash-target-block">' +
        '<div class="dash-target-fab-row">' +
          '<button type="button" class="dash-target-fab" data-monthly-target aria-label="تنظیم هدف فروش">' +
            dashboardIcon('target',20) +
          '</button>' +
        '</div>' +
        '<div class="dash-monthly-target ' + (done ? 'is-done' : '') + '">' +
          '<div class="dmt-top">' +
            '<div class="dmt-heading">' +
              '<span class="dmt-growth" aria-hidden="true">' + dashboardIcon('growth',20) + '</span>' +
              '<span class="dmt-title">هدف فروش این ماه</span>' +
            '</div>' +
          '</div>' +
          figuresHtml +
          '<div class="dmt-row">' +
            '<div class="dmt-progress"><div class="dmt-bar"><span style="width:' + capped + '%"></span></div></div>' +
            '<span class="dmt-pct">' + (target > 0 ? pct + '٪' : '—') + '</span>' +
          '</div>' +
          statusRowHtml +
        '</div>' +
      '</div>'
    );
  }

  function bindMonthlyTarget(root, refresh) {
    const btn = root.querySelector('[data-monthly-target]');
    if (!btn) return;
    btn.addEventListener('click', function (e) {
      e.preventDefault(); e.stopPropagation();
      const current = typeof getMonthlySalesTarget === 'function' ? getMonthlySalesTarget() : 0;
      openSheet(
        '<div class="sheet-title">هدف فروش این ماه</div>' +
        '<div class="field"><label>مبلغ هدف (تومان)</label>' +
        '<input id="monthly-target-input" type="text" inputmode="decimal" autocomplete="off" value="' + (current ? formatAmountForInput(current) : '') + '">' +
        '</div>' +
        '<div style="display:flex;gap:8px;margin-top:12px;justify-content:flex-end">' +
        '<button type="button" class="btn" id="monthly-target-cancel">انصراف</button>' +
        '<button type="button" class="btn primary" id="monthly-target-save">ذخیره</button>' +
        '</div>'
      );
      const input = document.getElementById('monthly-target-input');
      if(input && typeof reformatAmountInputEl === 'function') reformatAmountInputEl(input);
      if(input) input.focus();
      const save = document.getElementById('monthly-target-save');
      const cancel = document.getElementById('monthly-target-cancel');
      if(cancel) cancel.addEventListener('click', closeModal);
      if(save) save.addEventListener('click', function(){
        const raw = input ? input.value : '';
        const normalized = normalizeDigits(raw).replace(/[,_\s٬]/g, '');
        const value = Number(normalized);
        if (!(value > 0)) { if (typeof showToast === 'function') showToast('هدف باید بیشتر از صفر باشد'); return; }
        if (typeof setMonthlySalesTarget === 'function') setMonthlySalesTarget(value);
        closeModal();
        refresh();
      });
    });
  }

  function formatAmountForInput(value){
    try { return Number(value).toLocaleString('fa-IR'); } catch(e) { return String(value || ''); }
  }

  async function renderInto(root, isStale, ctx) {
    // Lifecycle reconcile before painting Watch summary (additive; fail-open)
    if (typeof reconcileWatchLifecycle === 'function') {
      try { await reconcileWatchLifecycle(null, ctx); } catch (eRec) { console.warn('watch lifecycle reconcile failed', eRec); }
    }
    const metrics = typeof commandCenterMetrics === 'function' ? commandCenterMetrics(new Date(), ctx) : { mtdSales: globalTotals(ctx).monthSales, mtdProfit: 0, salesDeltaPct: null, profitDeltaPct: null };
    const g = globalTotals(ctx);
    const invVal = inventoryValue();
    if (typeof isStale === 'function' && isStale()) return;

    /* Semantic composition (presentation only):
         A. Today's Focus  — target + action queue (primary attention)
         B. Financial Health — profit / inventory / debt (one surface, stacked rows)
         C. Quick Actions — tools (de-emphasized)
         D. Recent Activity — invoices + visits (one activity surface)
         Data sources, helpers, IDs, and event bindings are unchanged. */
     const focusActions = todaysActionsHtml(ctx);
     const activityInvoices = recentInvoicesHtml(ctx);
    const activityVisits = recentVisitsHtml();
    const activityBody = activityInvoices + activityVisits;
    const activityBlock = activityBody
      ? ('<div class="dashboard-block dash-activity-group">' +
          '<div class="dashboard-block-head"><div class="dash-section-label"><span class="dash-section-ico" aria-hidden="true">' + dashboardIcon('summary',20) + '</span><span>فعالیت اخیر</span></div></div>' +
          activityBody +
        '</div>')
      : '';

    root.innerHTML =
      '<div class="dashboard-shell">' +
      '<div class="dashboard-eyebrow">مرکز فرماندهی روزانه</div>' +

      /* A — Today's Focus */
      '<div class="dash-focus">' +
        '<div class="dash-focus-target">' + targetHtml(metrics) + '</div>' +
        '<div class="dash-focus-actions">' + focusActions + '</div>' +
      '</div>' +

      /* B — Financial Health (same metrics; stacked rows for mobile) */
      '<div class="dashboard-block dash-health">' +
        '<div class="dashboard-block-head"><div class="dash-section-label"><span class="dash-section-ico" aria-hidden="true">' + dashboardIcon('card',20) + '</span><span>وضعیت مالی</span></div></div>' +
        '<div class="dash-health-surface">' +
          '<div class="dash-health-row"><span class="dash-health-label">سود این ماه</span><span class="dash-health-value">' + money(metrics.mtdProfit) + '</span></div>' +
          '<div class="dash-health-row"><span class="dash-health-label">ارزش موجودی</span><span class="dash-health-value">' + money(invVal) + '</span></div>' +
          '<a class="dash-health-row dash-health-link" href="#/customers?filter=debt"><span class="dash-health-label">بدهی مشتریان</span><span class="dash-health-value debt">' + money(g.customerDebt) + '</span></a>' +
        '</div>' +
      '</div>' +

      /* C — Quick Actions (tools) */
      quickActionsHtml() +

      /* D — Recent Activity */
      activityBlock +
      '</div>';

     bindMonthlyTarget(root, function () { renderInto(root, isStale, ctx); });
    bindActionQueueToggle(root);
    bindQuickActions(root);
  }

  function mount(root, params) {
    if (!root) return function () {};
    const nav = document.getElementById('nav');
    if (nav) nav.style.display = 'none';
    let cancelled = false;
    let refreshToken = null;
    const isStale = function () { return cancelled; };
    function refreshDashboard() {
      var ctx = typeof createComputationContext === 'function'
        ? createComputationContext({ data: data })
        : null;
      renderInto(root, isStale, ctx).catch(function (e) { if (!cancelled) console.error('DashboardView refresh failed', e); });
    }
    refreshDashboard();
    if (typeof ViewHost !== 'undefined' && ViewHost.setRefresh) refreshToken = ViewHost.setRefresh(refreshDashboard);
    return function unmount() {
      cancelled = true;
      if (typeof ViewHost !== 'undefined' && ViewHost.clearRefresh) ViewHost.clearRefresh(refreshToken);
      refreshToken = null;
      if (nav) nav.style.display = '';
      root.innerHTML = '';
    };
  }

  global.DashboardView = { mount: mount, unmount: function () {} };
})(typeof window !== 'undefined' ? window : this);