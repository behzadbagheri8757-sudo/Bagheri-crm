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
    const gameShortcut = '<a class="section-action" href="#/game">بازی فروش ←</a>';
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
            '<div style="font-weight:600;color:var(--vg-color-text);margin-bottom:4px;">امروز کار ضروری نداری</div>' +
            '<div class="sub" style="opacity:.85;">وضعیت مشتری‌ها و پتانسیل‌ها تحت کنترل است.</div>' +
          '</div>' +
        '</div></div>';
    }

    // Max Top 5 by unifiedScore (already sorted by calculateAllActions)
    items = items.slice(0, 5);

    const visibleItems = items.slice(0, 3);
    const hiddenItems = items.slice(3);

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
    var rows = [];
    try { rows = typeof getActiveWatchOccurrences === 'function' ? (getActiveWatchOccurrences() || []) : []; } catch (e) { rows = []; }
    if (!rows.length) return '';
    rows = rows.slice().sort(function (a, b) {
      var rank = { critical: 4, high: 3, medium: 2, low: 1 };
      return (rank[b.level || b.severity] || 0) - (rank[a.level || a.severity] || 0) || String(b.lastEvaluatedAt || '').localeCompare(String(a.lastEvaluatedAt || ''));
    }).slice(0, 2);
    var total = 0;
    try { var sum = typeof getWatchLifecycleSummary === 'function' ? getWatchLifecycleSummary() : null; total = sum && Number.isFinite(sum.active) ? sum.active : rows.length; } catch (e2) { total = rows.length; }
    function label(o) {
      var product = o && o.productName;
      if (!product && o && o.productId && Array.isArray(data.products)) {
        var p = data.products.find(function (x) { return x && x.id === o.productId; });
        product = p && p.name;
      }
      if (product) return product;
      if (o && o.watchCategory && global.BagheriPresent && global.BagheriPresent.watchLabel) {
        try { return global.BagheriPresent.watchLabel(o.watchCategory); } catch (e) {}
      }
      return 'هشدار نیازمند بررسی';
    }
    function body(o) {
      if (global.BagheriPresent && global.BagheriPresent.watchSentence) {
        try { return global.BagheriPresent.watchSentence(o) || ''; } catch (e) {}
      }
      return (o && o.generatedReason) || 'یک نشانه در رفتار خرید این مشتری دیده شده است.';
    }
    var cards = rows.map(function (o) {
      var cid = o.customerId || '';
      var customer = (data.customers || []).find(function (c) { return c.id === cid; });
      var sev = o.severity || o.level || 'medium';
      var sevLabel = sev === 'critical' ? 'فوری' : sev === 'high' ? 'زیاد' : sev === 'medium' ? 'متوسط' : 'کم';
      return '<a class="bp-dashboard-watch-card" href="#/watch?id=' + encodeURIComponent(o.id || '') + '">' +
        '<span class="bp-dashboard-watch-main"><span class="bp-dashboard-watch-title">' +
          (customer ? '<strong class="bp-watch-customer-name">' + esc(customer.name) + '</strong><span class="bp-watch-sep"> · </span>' : '') +
          esc(label(o)) + '</span>' +
        '<span class="bp-dashboard-watch-reason">' + esc(body(o)) + '</span>' +
        '</span><span class="bp-dashboard-watch-severity">' + esc(sevLabel) + '</span></a>';
    }).join('');
    return '<div class="dashboard-block bp-dashboard-watch-block">' +
      dashSectionHead(dashboardIcon('actions',20), 'هشدارهای زودهنگام', '#/watches', 'همه ' + faDigits(total) + ' مورد') +
      '<div class="bp-dashboard-watch-list">' + cards + '</div>' +
      '</div>';
  }

  function dashboardAlertBar(ctx) {
    var att = { count: 0, totalBalance: 0, rows: [] };
    var overdueChecks = [];
    var dueSoonChecks = [];
    var followups = 0, lowStock = 0;

    try {
      if (ctx && typeof ctx.receivableAttention === 'function') {
        att = ctx.receivableAttention();
      }
    } catch (e1) {}

    try {
      var todayMs = new Date(todayISO() + 'T00:00:00').getTime();
      var allChecks = (typeof data !== 'undefined' && Array.isArray(data.checks)) ? data.checks : [];
      allChecks.forEach(function (c) {
        if (!c || !c.dueDate) return;
        // همان تعریف checkStatusLabel در checks.js: فقط 'cleared' نادیده گرفته می‌شود
        if (c.status === 'cleared') return;

        var dueMs = new Date(c.dueDate + 'T00:00:00').getTime();
        if (!isFinite(dueMs)) return;

        var diffDays = Math.round((dueMs - todayMs) / 86400000);

        if (diffDays < 0) overdueChecks.push(c);
        else if (diffDays <= 3) dueSoonChecks.push(c);
      });
    } catch (e2) {}

    // موارد قبلی نوار (حفظ شده تا رگرسیون ایجاد نشود)
    try {
      followups = typeof getPendingWatchFollowUps === 'function'
        ? (getPendingWatchFollowUps() || []).filter(function (o) {
            // همان قاعده‌ی صفحه‌ی هشدارها: مشتری غیرفعال شمرده نمی‌شود
            var cu = (data.customers || []).find(function (x) { return x && x.id === o.customerId; });
            return !!cu && cu.active !== false;
          }).length
        : 0;
    } catch (e3) {}
    try { lowStock = typeof lowStockProducts === 'function' ? (lowStockProducts() || []).length : 0; } catch (e4) {}

    if (!(att.count || overdueChecks.length || dueSoonChecks.length || followups || lowStock)) return '';

    /* هر مورد یک ردیف کامل (iOS list row): متن راست، مقدار/توضیح کنار آن، فلش در انتها. */
    function row(href, count, label, meta, extraAttr) {
      return '<a class="bp-alert-row" href="' + href + '"' + (extraAttr || '') + '>' +
        '<span class="bp-alert-row-text"><strong>' + faDigits(count) + '</strong> ' + label + '</span>' +
        (meta ? '<span class="bp-alert-row-meta">' + meta + '</span>' : '') +
        '<span class="bp-alert-row-chev" aria-hidden="true"></span>' +
      '</a>';
    }

    var bits = [];
    if (att.count > 0) bits.push(row('#', att.count, 'مشتری نیازمند پیگیری', money(att.totalBalance), ' data-attention="1"'));
    if (overdueChecks.length > 0) bits.push(row('#/checks?filter=overdue', overdueChecks.length, 'چک سررسیدگذشته'));
    if (dueSoonChecks.length > 0) bits.push(row('#/checks?filter=dueSoon', dueSoonChecks.length, 'چک نزدیک سررسید'));
    if (followups) bits.push(row('#/watches?filter=followup', followups, 'پیگیری باز'));
    if (lowStock) bits.push(row('#/inventory', lowStock, 'کالای کم‌موجودی'));

    return '<div class="bp-dashboard-alert" role="status">' +
      '<div class="bp-dashboard-alert-head">' +
        '<span class="bp-dashboard-alert-dot" aria-hidden="true"></span>' +
        '<span class="bp-dashboard-alert-label">نیازمند رسیدگی</span>' +
      '</div>' +
      '<div class="bp-dashboard-alert-items">' + bits.join('') + '</div>' +
    '</div>';
  }

  function openAttentionSheet(ctx) {
    var att = { count: 0, rows: [] };
    try {
      if (ctx && typeof ctx.receivableAttention === 'function') {
        att = ctx.receivableAttention();
      }
    } catch (e) {}
    if (!att.rows.length) return;

    var rowsHtml = att.rows.map(function (r) {
      var line = r.refKind === 'no_payment_history'
        ? faDigits(r.daysSince) + ' روز از آخرین فاکتور، بدون پرداخت'
        : faDigits(r.daysSince) + ' روز از آخرین پرداخت';
      return '<button type="button" class="bp-attention-row" data-attention-cid="' + esc(r.customerId) + '">' +
        '<span class="bp-attention-row-name">' + esc(r.name) + '</span>' +
        '<span class="bp-attention-row-meta">' + money(r.balance) + ' · ' + line + '</span>' +
      '</button>';
    }).join('');

    openSheet(
      '<h3>مشتریان نیازمند پیگیری</h3>' +
      '<div class="empty" style="padding:0 0 10px;text-align:right;font-size:.78rem;">' +
        faDigits(att.count) + ' مشتری با مانده حداقل ۱۰ میلیون تومان و نیازمند بررسی پرداخت' +
      '</div>' +
      '<div class="bp-attention-list">' + rowsHtml + '</div>'
    );

    var root = document.getElementById('modalRoot');
    if (!root) return;
    root.querySelectorAll('[data-attention-cid]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var cid = btn.getAttribute('data-attention-cid');
        try {
          if (typeof closeModal === 'function') closeModal();
        } catch (e) {}
        setTimeout(function () {
          if (typeof openCustomerQuickView === 'function') {
            openCustomerQuickView(cid);
          }
        }, 330);
      });
    });
  }

  function bindAttentionLink(root, ctx) {
    var attLink = root.querySelector('[data-attention]');
    if (!attLink) return;
    attLink.addEventListener('click', function (e) {
      e.preventDefault();
      if (typeof openAttentionSheet === 'function') openAttentionSheet(ctx);
    });
  }

  function todaySnapshotHtml(ctx) {
    var now = new Date();
    var sales = 0, invoices = 0, received = 0, visits = 0;
    try {
      var invs = data.invoices || [];
      invs.forEach(function (i) { if (typeof isSameDay === 'function' && isSameDay(i.date, now)) { sales += Number(i.total) || 0; invoices++; } });
      (data.payments || []).forEach(function (p) { if (typeof isSameDay === 'function' && isSameDay(p.date, now) && ['cash','card','transfer'].indexOf(p.method) !== -1) received += Number(p.amount) || 0; });
      (data.customers || []).forEach(function (c) { (c.visits || []).forEach(function (v) { if (typeof isSameDay === 'function' && isSameDay(v.date, now)) visits++; }); });
    } catch (e) {}
    return '<div class="dashboard-block bp-dashboard-snapshot"><div class="dashboard-block-head"><div class="dash-section-label"><span class="dash-section-ico" aria-hidden="true">' + dashboardIcon('summary',20) + '</span><span>خلاصه امروز</span></div></div>' +
      '<div class="bp-dashboard-snapshot-grid">' +
      '<div class="bp-dashboard-snapshot-item"><span>فروش</span><strong>' + money(sales) + '</strong><small>' + faDigits(invoices) + ' فاکتور</small></div>' +
      '<div class="bp-dashboard-snapshot-item"><span>ویزیت</span><strong>' + faDigits(visits) + '</strong><small>امروز</small></div>' +
      '<div class="bp-dashboard-snapshot-item"><span>دریافتی</span><strong>' + money(received) + '</strong><small>امروز</small></div>' +
      '</div></div>';
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
    const rawPct = target > 0 ? Math.round((sales / target) * 100) : 0;
    const pct = Math.min(100, Math.max(0, rawPct));
    const capped = pct;
    const done = target > 0 && sales >= target;

    function compactMoney(value) {
      const n = Math.abs(Number(value) || 0);
      if (n >= 1000000) {
        const m = n / 1000000;
        const text = Number.isInteger(m) ? String(m) : m.toFixed(1).replace(/\.0$/, '');
        return enToFaDigits(text) + 'M';
      }
      return toman(n);
    }

    /* فقط دکمهٔ آیکون قابل کلیک است؛ بقیهٔ نوار صرفاً نمایشی است. */
    function targetTitleHtml() {
      return '<div class="bp-target-strip-title">' +
        '<button type="button" class="bp-target-strip-settings-btn" data-monthly-target aria-label="تنظیم هدف فروش این ماه">' +
          dashboardIcon('target',20) +
        '</button>' +
        '<strong>هدف فروش این ماه</strong>' +
      '</div>';
    }

    if (!(target > 0)) {
      return '<div class="bp-target-strip is-empty">' +
        '<div class="bp-target-strip-head">' +
          targetTitleHtml() +
          '<button type="button" class="bp-target-strip-settings" data-monthly-target>تنظیم ›</button>' +
        '</div>' +
        '<div class="bp-target-strip-empty-text">هنوز هدفی برای این ماه تعیین نشده</div>' +
      '</div>';
    }

    let status = { cls: 'ontrack', icon: '✓', text: 'روی برنامه' };
    let daysLeft = 0;
    let requiredDaily = 0;
    if (!done) {
      const monthLen = (metrics.jy && metrics.jm && typeof jalaliMonthLength === 'function')
        ? jalaliMonthLength(metrics.jy, metrics.jm) : null;
      if (monthLen) {
        daysLeft = Math.max(0, monthLen - (metrics.jd || 0));
        const expectedFraction = Math.min(1, (metrics.jd || 0) / monthLen);
        const expectedSales = target * expectedFraction;
        if (sales >= expectedSales * 1.05) status = { cls: 'ahead', icon: '↑', text: 'جلوتر از برنامه' };
        else if (sales <= expectedSales * 0.95) status = { cls: 'behind', icon: '⚠', text: 'عقب‌تر از برنامه' };
        requiredDaily = daysLeft > 0 ? Math.round(Math.max(0, target - sales) / daysLeft) : 0;
      }
    }

    const progressClass = pct > 0 ? ' has-progress' : '';

    return '<div class="bp-target-strip ' + (done ? 'is-done' : 'is-' + status.cls) + progressClass + '">' +
      '<div class="bp-target-strip-head">' +
        targetTitleHtml() +
        '<span class="bp-target-strip-status">' + (done ? '✓ رسید' : status.icon + ' ' + status.text) + '</span>' +
      '</div>' +
      '<div class="bp-target-strip-figures">' +
        '<span class="bp-target-strip-sales"><strong class="bp-target-strip-current">' + compactMoney(sales) + '</strong><span class="bp-target-strip-target"> / ' + compactMoney(target) + '</span> <small>تومان</small></span>' +
        '<span class="bp-target-strip-percent"><strong>' + enToFaDigits(String(pct)) + '٪</strong></span>' +
        (done ? '<span class="bp-target-strip-congrats">آفرین!</span>' : '<span>نیاز روزانه <strong>' + compactMoney(requiredDaily) + '</strong> ت</span>') +
      '</div>' +
      '<div class="bp-target-strip-bar"><span style="width:' + capped + '%"></span></div>' +
      (!done && daysLeft > 0 ? '<div class="bp-target-strip-days">' + enToFaDigits(String(daysLeft)) + ' روز مانده</div>' : '') +
    '</div>';
  }

  function bindMonthlyTarget(root, refresh) {
    const targetBtns = root.querySelectorAll('[data-monthly-target]');
    if (!targetBtns.length) return;
    targetBtns.forEach(function (btn) { btn.addEventListener('click', onMonthlyTargetClick); });
    function onMonthlyTargetClick(e) {
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
    }
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
     const alertBar = dashboardAlertBar(ctx);
    const todaySnapshot = todaySnapshotHtml(ctx);
    const focusActions = todaysActionsHtml(ctx);
    const watchSummary = watchSummaryHtml(ctx);
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
      alertBar +
      todaySnapshot +
      targetHtml(metrics) +

      /* A — Today's Focus */
      '<div class="dash-focus">' +
        '<div class="dash-focus-actions">' + focusActions + '</div>' +
      '</div>' +
      watchSummary +

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
    bindAttentionLink(root, ctx);
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