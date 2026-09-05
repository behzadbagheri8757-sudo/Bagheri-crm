/* js/views/reports.js — SPA Reports view (Phase 3).
   Extracted from reports.html. Read-only calc helpers. No finance logic changes.
*/
'use strict';

(function (global) {
  let reportPeriod = 'all';
  let reportAccordionState = { customers: false, suppliers: false, inventory: false, invoices: false };
  let bodyClickHandler = null;
  let chipHandlers = [];

  function toggleReportAccordion(key) {
    if (!(key in reportAccordionState)) return;
    reportAccordionState[key] = !reportAccordionState[key];
    const header = document.querySelector('.report-accordion-header[data-racc-toggle="' + key + '"]');
    const content = document.getElementById('racc-' + key);
    if (header) {
      header.classList.toggle('is-open', reportAccordionState[key]);
      header.setAttribute('aria-expanded', reportAccordionState[key] ? 'true' : 'false');
    }
    if (content) content.hidden = !reportAccordionState[key];
  }

  function reportAccordionSection(key, titleHtml, innerHtml) {
    const isOpen = !!reportAccordionState[key];
    return (
      '<div class="report-section report-accordion">' +
      '<button type="button" class="report-accordion-header ' +
      (isOpen ? 'is-open' : '') +
      '" data-racc-toggle="' +
      key +
      '" aria-expanded="' +
      (isOpen ? 'true' : 'false') +
      '" aria-controls="racc-' +
      key +
      '">' +
      '<h3>' +
      titleHtml +
      '</h3>' +
      '<span class="report-accordion-chevron" aria-hidden="true"></span>' +
      '</button>' +
      '<div class="report-accordion-content" id="racc-' +
      key +
      '" ' +
      (isOpen ? '' : 'hidden') +
      '>' +
      innerHtml +
      '</div></div>'
    );
  }

  function startOfWeek(ref) {
    const d = new Date(ref);
    const day = d.getDay();
    const diff = (day + 1) % 7;
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - diff);
    return d;
  }

  function invoiceInPeriod(inv, period, now) {
    if (period === 'all') return true;
    if (period === 'today') return isSameDay(inv.date, now);
    if (period === 'month') return isSameMonth(inv.date, now);
    if (period === 'week') {
      const d = new Date(inv.date);
      const start = startOfWeek(now);
      const end = new Date(start);
      end.setDate(end.getDate() + 7);
      return d >= start && d < end;
    }
    return true;
  }

  /** Same period rules as invoiceInPeriod, applied to payment.date (not invoice date). */
  function paymentInPeriod(p, period, now) {
    if (period === 'all') return true;
    if (period === 'today') return isSameDay(p.date, now);
    if (period === 'month') return isSameMonth(p.date, now);
    if (period === 'week') {
      const d = new Date(p.date);
      const start = startOfWeek(now);
      const end = new Date(start);
      end.setDate(end.getDate() + 7);
      return d >= start && d < end;
    }
    return true;
  }

  function periodInvoiceGrossProfit(invoices) {
    return invoices.reduce(function (sum, inv) {
      const itemsProfit = (inv.items || []).reduce(function (a, it) {
        return a + ((it.price || 0) - (it.buyPrice || 0)) * (it.qty || 0) - (it.discount || 0);
      }, 0);
      return sum + itemsProfit - invoiceDiscountAmount(inv);
    }, 0);
  }

  function renderReportsBodyOnly() {
    const body = document.getElementById('reports-body');
    if (!body) return;

    const now = new Date();
    const g = globalTotals();
    const invsAll = data.invoices || [];
    const invsPeriod = invsAll.filter(function (i) {
      return invoiceInPeriod(i, reportPeriod, now);
    });
    const periodSales = invsPeriod.reduce(function (s, i) {
      return s + (i.total || 0);
    }, 0);
    const periodCount = invsPeriod.length;
    const periodAvg = periodCount ? periodSales / periodCount : 0;
    const periodGrossProfit = periodInvoiceGrossProfit(invsPeriod);

    // دریافتی دوره: فقط cash/card/transfer — همان روش globalTotals().totalReceived
    // ولی فیلتر روی payment.date (نه تاریخ فاکتور)
    const periodReceived = (data.payments || [])
      .filter(function (p) {
        return (
          ['cash', 'card', 'transfer'].includes(p.method) &&
          paymentInPeriod(p, reportPeriod, now)
        );
      })
      .reduce(function (s, p) {
        return s + (p.amount || 0);
      }, 0);

    let paidCount = 0,
      openCount = 0;
    invsPeriod.forEach(function (inv) {
      const paid =
        typeof invoiceEffectivePaid === 'function'
          ? invoiceEffectivePaid(inv)
          : (inv.cashPaid || 0) + (inv.cardPaid || 0) + (inv.transferPaid || 0) + (inv.checkPaid || 0);
      const remain = (inv.total || 0) - paid;
      if (remain <= 0.5) paidCount++;
      else openCount++;
    });

    const customers = data.customers || [];
    let debtors = 0,
      settled = 0,
      creditors = 0;
    customers.forEach(function (c) {
      const bal = customerTotals(c.id).balance;
      if (bal > 0.5) debtors++;
      else if (bal < -0.5) creditors++;
      else settled++;
    });
    const topDebtors = debtorList(8);

    const suppliers = data.suppliers || [];
    let supDebtTotal = 0,
      supWithDebt = 0;
    const topSuppliers = suppliers
      .map(function (s) {
        const t = supplierTotals(s.id);
        if (t.balance > 0.5) {
          supDebtTotal += t.balance;
          supWithDebt++;
        }
        return { s: s, t: t };
      })
      .filter(function (x) {
        return x.t.balance > 0.5;
      })
      .sort(function (a, b) {
        return b.t.balance - a.t.balance;
      })
      .slice(0, 8);

    const products = data.products || [];
    const invVal = inventoryValue();
    const low = lowStockProducts();
    const zero = products.filter(function (p) {
      return (p.stockQty || 0) === 0;
    });
    const negative = products.filter(function (p) {
      return (p.stockQty || 0) < 0;
    });

    const topSellingProducts = topProducts(8);
    const topByValue = topProducts(9999)
      .slice()
      .sort(function (a, b) {
        return b.revenue - a.revenue;
      })
      .slice(0, 5);

    const periodLabel = { today: 'امروز', week: 'این هفته', month: 'این ماه', all: 'همه زمان‌ها' }[reportPeriod];

    const invLink = '#/inventory';
    const prodLink = '#/products';

    body.innerHTML =
      '<div class="report-section">' +
      '<h3>خلاصه فروش — ' +
      esc(periodLabel) +
      '</h3>' +
      '<div class="cards">' +
      '<div class="card"><div class="label">فروش دوره</div><div class="value">' +
      toman(periodSales) +
      ' ت</div></div>' +
      '<div class="card"><div class="label">تعداد فاکتور</div><div class="value">' +
      periodCount +
      '</div></div>' +
      '<div class="card"><div class="label">میانگین فاکتور</div><div class="value">' +
      toman(periodAvg) +
      ' ت</div></div>' +
      '<div class="card"><div class="label">فروش امروز</div><div class="value">' +
      toman(g.todaySales) +
      ' ت</div></div>' +
      '<div class="card"><div class="label">فروش این ماه</div><div class="value">' +
      toman(g.monthSales) +
      ' ت</div></div>' +
      '<div class="card"><div class="label">فروش کل</div><div class="value">' +
      toman(g.totalSales) +
      ' ت</div></div>' +
      '</div></div>' +
      '<div class="report-section">' +
      '<h3>سود</h3>' +
      '<div class="cards">' +
      '<div class="card wide"><div class="label">سود کل (منطق customerProfit روی همه مشتریان)</div>' +
      '<div class="value accent-olive">' +
      toman(g.totalProfit) +
      ' ت</div></div>' +
      '<div class="card wide"><div class="label">سود ناخالص فاکتورهای دوره «' +
      esc(periodLabel) +
      '»</div>' +
      '<div class="value">' +
      toman(periodGrossProfit) +
      ' ت</div>' +
      '<div class="report-note">همان فرمول ردیف فاکتور (قیمت − buyPrice تاریخی − تخفیف). برگشت/تخفیف تراکنشی فقط در «سود کل» لحاظ شده است.</div>' +
      '</div>' +
      '<div class="card"><div class="label">دریافت نقد/کارت/انتقال — ' +
      esc(periodLabel) +
      '</div><div class="value">' +
      toman(periodReceived) +
      ' ت</div></div>' +
      '<div class="card"><div class="label">چک در جریان</div><div class="value accent-amber">' +
      toman(g.outstandingChecks) +
      ' ت</div></div>' +
      '</div></div>' +
      '<div class="report-section report-top-products">' +
      '<h3>پرفروش‌ترین کالاها</h3>' +
      (topSellingProducts.length
        ? '<div class="rtp-list">' +
          topSellingProducts
            .map(function (p, idx) {
              return (
                '<div class="ledger-row tx-row rtp-row"><span class="rtp-rank">' +
                (idx + 1) +
                '</span><span class="name"><span class="tx-row-title">' +
                esc(p.name) +
                '</span><span class="sub">تعداد: ' +
                enToFaDigits(String(p.qty)) +
                (p.qtyUnit === 'kg' ? ' کیلوگرم' : '') +
                '</span></span><span class="filler"></span><span class="amount tx-row-amount"><span class="tx-row-total">' +
                toman(p.revenue) +
                ' ت</span></span></div>'
              );
            })
            .join('') +
          '</div>'
        : '<div class="empty" style="padding:8px 0;">فروشی ثبت نشده</div>') +
      '</div>' +
      '<div class="report-section report-top-products">' +
      '<h3>پرفروش‌ترین کالاها بر اساس ارزش فروش</h3>' +
      (topByValue.length
        ? '<div class="rtp-list">' +
          topByValue
            .map(function (p, idx) {
              return (
                '<div class="ledger-row tx-row rtp-row"><span class="rtp-rank">' +
                (idx + 1) +
                '</span><span class="name"><span class="tx-row-title">' +
                esc(p.name) +
                '</span><span class="sub">تعداد: ' +
                enToFaDigits(String(p.qty)) +
                (p.qtyUnit === 'kg' ? ' کیلوگرم' : '') +
                '</span></span><span class="filler"></span><span class="amount tx-row-amount"><span class="tx-row-total">' +
                toman(p.revenue) +
                ' ت</span></span></div>'
              );
            })
            .join('') +
          '</div>' +
          '<div class="report-note">بر اساس مجموع مبلغ واقعی فروش هر کالا (qty × قیمت − تخفیف ردیف)؛ فقط ترتیب نمایش متفاوت است، منطق مبلغ همان منطق فعلی سیستم است.</div>'
        : '<div class="empty" style="padding:8px 0;">فروشی ثبت نشده</div>') +
      '</div>' +
      reportAccordionSection(
        'customers',
        'مشتریان',
        '<div class="cards">' +
          '<div class="card"><div class="label">تعداد کل</div><div class="value">' +
          customers.length +
          '</div></div>' +
          '<div class="card"><div class="label">بدهکار</div><div class="value accent-rust">' +
          debtors +
          '</div></div>' +
          '<div class="card"><div class="label">تسویه</div><div class="value">' +
          settled +
          '</div></div>' +
          '<div class="card"><div class="label">بستانکار</div><div class="value accent-olive">' +
          creditors +
          '</div></div>' +
          '<div class="card wide"><div class="label">مجموع بدهی مشتریان</div>' +
          '<div class="value accent-rust">' +
          toman(g.customerDebt) +
          ' ت</div></div></div>' +
          (topDebtors.length
            ? '<div class="sub-title" style="margin-top:12px;">بیشترین بدهی</div>' +
              topDebtors
                .map(function (x) {
                  return (
                    '<a class="ledger-row tx-row debt-row" href="#/customer?id=' +
                    encodeURIComponent(x.c.id) +
                    '"><span class="name">' +
                    esc(x.c.name) +
                    '<span class="sub">' +
                    balanceStatusWord(x.t.balance) +
                    '</span></span><span class="filler"></span><span class="amount accent-rust">' +
                    toman(x.t.balance) +
                    ' ت</span></a>'
                  );
                })
                .join('')
            : '<div class="empty" style="padding:8px 0;">بدهکاری ثبت نشده</div>')
      ) +
      reportAccordionSection(
        'suppliers',
        'تأمین‌کنندگان',
        '<div class="cards">' +
          '<div class="card"><div class="label">تعداد</div><div class="value">' +
          suppliers.length +
          '</div></div>' +
          '<div class="card"><div class="label">دارای بدهی</div><div class="value">' +
          supWithDebt +
          '</div></div>' +
          '<div class="card wide"><div class="label">مجموع بدهی به تأمین‌کنندگان</div>' +
          '<div class="value accent-rust">' +
          toman(g.supplierDebt) +
          ' ت</div></div></div>' +
          (topSuppliers.length
            ? topSuppliers
                .map(function (x) {
                  return (
                    '<a class="ledger-row tx-row debt-row" href="#/supplier?id=' +
                    encodeURIComponent(x.s.id) +
                    '"><span class="name">' +
                    esc(x.s.name) +
                    '</span><span class="filler"></span><span class="amount accent-rust">' +
                    toman(x.t.balance) +
                    ' ت</span></a>'
                  );
                })
                .join('')
            : '<div class="empty" style="padding:8px 0;">بدهی تأمین‌کننده نیست</div>')
      ) +
      reportAccordionSection(
        'inventory',
        'انبار',
        '<div class="cards">' +
          '<div class="card"><div class="label">تعداد کالا</div><div class="value">' +
          products.length +
          '</div></div>' +
          '<div class="card wide"><div class="label">ارزش موجودی (qty × buy)</div>' +
          '<div class="value">' +
          toman(invVal) +
          ' ت</div></div>' +
          '<div class="card"><div class="label">کم‌موجود</div><div class="value accent-amber">' +
          low.length +
          '</div></div>' +
          '<div class="card"><div class="label">ناموجود</div><div class="value">' +
          zero.length +
          '</div></div>' +
          '<div class="card"><div class="label">موجودی منفی</div><div class="value accent-rust">' +
          negative.length +
          '</div></div></div>' +
          (low.length
            ? '<div class="sub-title" style="margin-top:10px;">کالاهای کم‌موجود</div>' +
              low
                .slice(0, 10)
                .map(function (p) {
                  return (
                    '<div class="ledger-row" style="cursor:default;"><span class="name">' +
                    esc(p.name) +
                    '<span class="sub">حداقل: ' +
                    (p.minStock || 0) +
                    '</span></span><span class="filler"></span><span class="amount accent-amber">' +
                    (p.stockQty || 0) +
                    '</span></div>'
                  );
                })
                .join('')
            : '') +
          (negative.length
            ? '<div class="sub-title" style="margin-top:10px;">موجودی منفی</div>' +
              negative
                .slice(0, 10)
                .map(function (p) {
                  return (
                    '<div class="ledger-row" style="cursor:default;"><span class="name">' +
                    esc(p.name) +
                    '</span><span class="filler"></span><span class="amount accent-rust">' +
                    p.stockQty +
                    '</span></div>'
                  );
                })
                .join('')
            : '') +
          '<div class="btn-row" style="margin-top:10px;">' +
          '<a class="btn small secondary" href="' +
          invLink +
          '">رفتن به انبار</a>' +
          '<a class="btn small secondary" href="' +
          prodLink +
          '">لیست کالاها</a></div>'
      ) +
      reportAccordionSection(
        'invoices',
        'فاکتورها — ' + esc(periodLabel),
        '<div class="cards">' +
          '<div class="card"><div class="label">تعداد در دوره</div><div class="value">' +
          periodCount +
          '</div></div>' +
          '<div class="card"><div class="label">پرداخت‌شده / بدون مانده</div><div class="value accent-olive">' +
          paidCount +
          '</div></div>' +
          '<div class="card"><div class="label">دارای مانده</div><div class="value accent-rust">' +
          openCount +
          '</div></div>' +
          '<div class="card wide"><div class="label">جمع مبلغ فاکتورهای دوره</div>' +
          '<div class="value">' +
          toman(periodSales) +
          ' ت</div></div></div>' +
          '<div class="btn-row" style="margin-top:10px;">' +
          '<a class="btn small secondary" href="#/invoices">همه فاکتورها</a></div>'
      );
  }


  function renderReportsSummary() {
    const el = document.getElementById('reports-summary');
    if (!el) return;
    const m = typeof commandCenterMetrics === 'function' ? commandCenterMetrics(new Date()) : {mtdSales:globalTotals().monthSales,mtdProfit:globalTotals().totalProfit,salesDeltaPct:null,profitDeltaPct:null};
    const g = globalTotals();
    const invVal = inventoryValue();
    function delta(pct){
      if(pct===null || pct===undefined || !isFinite(pct)) return 'بدون مقایسه';
      const n=Math.round(pct*10)/10;
      return n>0 ? '↑ '+n+'٪ نسبت به بازه مشابه' : n<0 ? '↓ '+Math.abs(n)+'٪ نسبت به بازه مشابه' : '۰٪ بدون تغییر';
    }
    function cls(pct){ return pct>0 ? 'up' : pct<0 ? 'down' : ''; }
    el.innerHTML =
      '<div class="report-summary-title">خلاصه مدیریتی — ماه جاری تا امروز</div>' +
      '<div class="report-summary">' +
      '<div class="report-summary-card sales"><div class="report-summary-label">فروش ماه</div><div class="report-summary-value sales">'+toman(m.mtdSales)+' ت</div><div class="report-summary-meta '+cls(m.salesDeltaPct)+'">'+delta(m.salesDeltaPct)+'</div></div>' +
      '<div class="report-summary-card profit"><div class="report-summary-label">سود ماه</div><div class="report-summary-value profit">'+toman(m.mtdProfit)+' ت</div><div class="report-summary-meta '+cls(m.profitDeltaPct)+'">'+delta(m.profitDeltaPct)+'</div></div>' +
      '<div class="report-summary-card debt"><div class="report-summary-label">مطالبات مشتریان</div><div class="report-summary-value debt">'+toman(g.customerDebt)+' ت</div><div class="report-summary-meta">'+debtorList(9999).length+' بدهکار فعال</div></div>' +
      '<div class="report-summary-card inventory"><div class="report-summary-label">ارزش موجودی</div><div class="report-summary-value">'+toman(invVal)+' ت</div><div class="report-summary-meta">وضعیت فعلی انبار</div></div>' +
      '</div>';
  }

  function drawReportsPage(root) {
    const chip = function (id, label) {
      return (
        '<button type="button" class="chip ' +
        (reportPeriod === id ? 'active' : '') +
        '" data-rp="' +
        id +
        '">' +
        label +
        '</button>'
      );
    };
    root.innerHTML =
      '<h2 class="section-title">گزارش‌ها</h2>' +
      '<p class="tx-hint">خلاصه‌ای از فروش، سود، دریافت‌ها و وضعیت فعلی حساب‌ها و انبار.</p>' +
      '<div id="reports-summary"></div>' +
      '<div class="field"><label>بازه زمانی (فروش و فاکتور)</label>' +
      '<div class="chip-row" id="report-period-chips">' +
      chip('today', 'امروز') +
      chip('week', 'این هفته') +
      chip('month', 'این ماه') +
      chip('all', 'همه') +
      '</div>' +
      '<div class="report-note">مانده مشتری، تأمین‌کننده و ارزش انبار همیشه بر اساس وضعیت فعلی حساب است (وابسته به بازه نیست).</div></div>' +
      '<div id="reports-body" class="mgmt-reports-body"></div>';

    chipHandlers = [];
    document.querySelectorAll('#report-period-chips [data-rp]').forEach(function (btn) {
      const fn = function () {
        reportPeriod = btn.getAttribute('data-rp');
        document.querySelectorAll('#report-period-chips [data-rp]').forEach(function (b) {
          b.classList.toggle('active', b.getAttribute('data-rp') === reportPeriod);
        });
        renderReportsBodyOnly();
      };
      btn.addEventListener('click', fn);
      chipHandlers.push({ el: btn, fn: fn });
    });

    const bodyEl = document.getElementById('reports-body');
    bodyClickHandler = function (e) {
      const btn = e.target.closest('[data-racc-toggle]');
      if (!btn) return;
      toggleReportAccordion(btn.getAttribute('data-racc-toggle'));
    };
    bodyEl.addEventListener('click', bodyClickHandler);

    renderReportsBodyOnly();
    renderReportsSummary();
  }

  function mount(root, params) {
    if (!root) return function () {};
    let refreshToken = null;
    const fab = document.getElementById('fab');
    if (fab) {
      fab.style.display = 'none';
      fab.onclick = null;
    }
    const nav = document.getElementById('nav');
    if (nav) nav.style.display = '';

    reportPeriod = 'all';
    reportAccordionState = { customers: false, suppliers: false, inventory: false, invoices: false };
    drawReportsPage(root);

    // Mutation → render() → ViewHost.refreshCurrent() refreshes report body while still on Reports
    if (typeof ViewHost !== 'undefined' && ViewHost.setRefresh) {
      refreshToken = ViewHost.setRefresh(function(){ renderReportsBodyOnly(); renderReportsSummary(); });
    }

    return function unmount() {
      if (typeof ViewHost !== 'undefined' && ViewHost.clearRefresh) {
        ViewHost.clearRefresh(refreshToken);
      }
      refreshToken = null;
      chipHandlers.forEach(function (h) {
        try {
          h.el.removeEventListener('click', h.fn);
        } catch (e) {}
      });
      chipHandlers = [];
      const bodyEl = document.getElementById('reports-body');
      if (bodyEl && bodyClickHandler) {
        try {
          bodyEl.removeEventListener('click', bodyClickHandler);
        } catch (e) {}
      }
      bodyClickHandler = null;
      root.innerHTML = '';
    };
  }

  global.ReportsView = { mount: mount, unmount: function () {} };
})(typeof window !== 'undefined' ? window : this);
