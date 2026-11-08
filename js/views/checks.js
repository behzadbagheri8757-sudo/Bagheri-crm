/* js/views/checks.js — SPA Checks view (Phase 9).
   Extracted from checks.html. Reuses check status helpers, openAddCheck,
   openCustomerDetail, openInvoiceDetail as-is. No new financial logic.
*/
'use strict';

(function (global) {
  let chkQuery = '';
  let chkFilter = 'all'; // all | pending | cleared | dueSoon | overdue
  let chkSort = 'dueAsc'; // dueAsc | dueDesc | amountDesc | newest
  let chkSide = 'customer'; // customer (دریافتی از مشتری) | supplier (پرداختی به تامین‌کننده)

  let searchHandler = null;
  let chipHandlers = [];
  let sortHandler = null;
  let fabHandler = null;
  function navigateToCustomer(cid) {
    AppRouter.navigate('/customer', { id: cid });
  }

  function navigateToInvoice(invId) {
    AppRouter.navigate('/invoice', { id: invId });
  }

  function checkStatusLabel(ch) {
    if (ch.status === 'cleared') {
      return { label: 'وصول‌شده', cls: 'accent-olive', key: 'cleared' };
    }
    return { label: 'در جریان', cls: 'accent-amber', key: 'pending' };
  }

  /* تفاوت روز تقویمی تا سررسید (نسبت به نیمه‌شب امروز به وقت محلی).
     منفی = معوق، ۰ = امروز، مثبت = آینده، null = تاریخ نامعتبر/نامشخص.
     همهٔ برچسب‌ها و فیلترها از همین یک تابع استفاده می‌کنند تا با هم ناسازگار نشوند. */
  function dueDiffDays(ch) {
    if (!ch || !ch.dueDate) return null;
    const dueMs = new Date(String(ch.dueDate).slice(0, 10) + 'T00:00:00').getTime();
    if (!isFinite(dueMs)) return null;
    const todayMs = new Date(todayISO() + 'T00:00:00').getTime();
    return Math.round((dueMs - todayMs) / 86400000);
  }

  function isDueSoon(ch) {
    if (ch.status === 'cleared') return false;
    const diff = dueDiffDays(ch);
    return diff !== null && diff >= 0 && diff <= 3;
  }

  function isOverdue(ch) {
    if (ch.status === 'cleared') return false;
    const diff = dueDiffDays(ch);
    return diff !== null && diff < 0;
  }

  /* چک‌های پرداختی به تامین‌کننده — فقط‌خواندنی؛ تغییر وضعیت/ویرایش در صفحهٔ همان تامین‌کننده انجام می‌شود
     (با تأیید و بدون چرخهٔ ناخواسته). منبع داده: supplierCheckEntries() در calc.js. */
  const SUP_STATUS = {
    pending: { label: 'در جریان', cls: 'accent-amber' },
    cleared: { label: 'پرداخت‌شده', cls: 'accent-olive' },
    bounced: { label: 'برگشتی', cls: 'accent-rust' }
  };
  function renderSupplierCheckList(listEl, sumEl) {
    let rows = (typeof supplierCheckEntries === 'function' ? supplierCheckEntries() : []).map((e, i) => ({
      e, i,
      dueSoon: e.status === 'pending' && e.dueDiff !== null && e.dueDiff >= 0 && e.dueDiff <= 3,
      overdue: e.status === 'pending' && e.dueDiff !== null && e.dueDiff < 0
    }));
    const total = rows.length;
    const q = (chkQuery || '').trim().toLowerCase();
    if (q) {
      rows = rows.filter(r =>
        (r.e.supplier.name || '').toLowerCase().includes(q) ||
        String(r.e.payment.checkNumber || '').toLowerCase().includes(q) ||
        String(r.e.face || '').includes(q)
      );
    }
    if (chkFilter === 'pending' || chkFilter === 'cleared' || chkFilter === 'bounced') rows = rows.filter(r => r.e.status === chkFilter);
    else if (chkFilter === 'dueSoon') rows = rows.filter(r => r.dueSoon);
    else if (chkFilter === 'overdue') rows = rows.filter(r => r.overdue);

    const dueOf = r => String(r.e.payment.dueDate || '');
    if (chkSort === 'dueDesc') rows.sort((a, b) => dueOf(b).localeCompare(dueOf(a)));
    else if (chkSort === 'amountDesc') rows.sort((a, b) => b.e.face - a.e.face);
    else if (chkSort === 'newest') rows.sort((a, b) => String(b.e.payment.date || '').localeCompare(String(a.e.payment.date || '')) || (b.i - a.i));
    else rows.sort((a, b) => dueOf(a).localeCompare(dueOf(b)));

    const sum = list => list.reduce((s, r) => s + r.e.face, 0);
    sumEl.innerHTML = `
      <div class="card"><div class="label">تعداد چک (فیلتر)</div><div class="value">${enToFaDigits(String(rows.length))}</div></div>
      <div class="card"><div class="label">جمع مبالغ</div><div class="value">${toman(sum(rows))} ت</div></div>
      <div class="card wide"><div class="label">جمع در جریان (در فیلتر فعلی)</div><div class="value accent-amber">${toman(sum(rows.filter(r => r.e.status === 'pending')))} ت</div></div>
    `;
    if (!rows.length) {
      listEl.innerHTML = `<div class="empty">${total ? 'موردی پیدا نشد' : 'هنوز چکی به تامین‌کننده‌ای پرداخت نشده.'}</div>`;
      return;
    }
    listEl.innerHTML = rows.map(r => {
      const e = r.e, p = e.payment, st = SUP_STATUS[e.status];
      const warn = r.overdue ? 'سررسید گذشته' : (r.dueSoon ? 'سررسید نزدیک' : '');
      const dueCls = (r.dueSoon || r.overdue) ? 'accent-rust' : '';
      return `<a class="ledger-row tx-row" href="#/supplier?id=${encodeURIComponent(e.supplier.id)}" style="text-decoration:none;color:inherit;align-items:flex-start;">
        <span class="name" style="flex:1;min-width:0;">
          <span class="tx-row-title">${esc(e.supplier.name || '—')}</span>
          <span class="sub">${p.checkNumber ? 'ش ' + esc(p.checkNumber) + ' · ' : ''}سررسید <span class="${dueCls}">${faDate(p.dueDate)}</span></span>
          ${warn ? '<span class="sub accent-rust">' + warn + '</span>' : ''}
        </span>
        <span class="filler"></span>
        <span class="amount tx-row-amount">
          <span class="tx-row-total">${toman(e.face)} ت</span>
          <span class="tx-row-meta ${st.cls}">${st.label}</span>
        </span>
      </a>`;
    }).join('');
  }

  function renderCheckListOnly() {
    const listEl = document.getElementById('check-list');
    const sumEl = document.getElementById('check-summary');
    if (!listEl || !sumEl) return;
    if (chkSide === 'supplier') { renderSupplierCheckList(listEl, sumEl); return; }

    let rows = (data.checks || []).slice().map((ch, idx) => {
      const cust = data.customers.find(c => c.id === ch.customerId);
      const inv = ch.invoiceId ? data.invoices.find(i => i.id === ch.invoiceId) : null;
      const st = checkStatusLabel(ch);
      return {
        ch, cust, inv, st, idx,
        dueSoon: isDueSoon(ch),
        overdue: isOverdue(ch),
        partyName: cust ? cust.name : '—',
      };
    });

    const q = (chkQuery || '').trim().toLowerCase();
    if (q) {
      rows = rows.filter(r =>
        (r.partyName || '').toLowerCase().includes(q) ||
        String(r.ch.checkNumber || '').toLowerCase().includes(q) ||
        String(r.ch.amount || '').includes(q) ||
        String(r.inv && r.inv.number || '').includes(q)
      );
    }

    if (chkFilter === 'pending') rows = rows.filter(r => r.st.key === 'pending');
    else if (chkFilter === 'cleared') rows = rows.filter(r => r.st.key === 'cleared');
    else if (chkFilter === 'dueSoon') rows = rows.filter(r => r.dueSoon);
    else if (chkFilter === 'overdue') rows = rows.filter(r => r.overdue);

    if (chkSort === 'dueDesc') rows.sort((a,b) => (b.ch.dueDate || '').localeCompare(a.ch.dueDate || ''));
    else if (chkSort === 'amountDesc') rows.sort((a,b) => (b.ch.amount || 0) - (a.ch.amount || 0));
    // «جدیدترین ثبت» = ترتیب واقعی ثبت در data.checks (نه مقایسهٔ رشتهٔ id که برای ثبت‌های هم‌میلی‌ثانیه تصادفی بود)
    else if (chkSort === 'newest') rows.sort((a,b) => b.idx - a.idx);
    else rows.sort((a,b) => (a.ch.dueDate || '').localeCompare(b.ch.dueDate || ''));

    const totalAll = rows.reduce((s,r) => s + (r.ch.amount || 0), 0);
    const pendingSum = rows.filter(r => r.st.key === 'pending').reduce((s,r) => s + (r.ch.amount || 0), 0);
    sumEl.innerHTML = `
      <div class="card"><div class="label">تعداد چک (فیلتر)</div><div class="value">${enToFaDigits(String(rows.length))}</div></div>
      <div class="card"><div class="label">جمع مبالغ</div><div class="value">${toman(totalAll)} ت</div></div>
      <div class="card wide"><div class="label">جمع در جریان (در فیلتر فعلی)</div><div class="value accent-amber">${toman(pendingSum)} ت</div></div>
    `;

    if (!rows.length) {
      listEl.innerHTML = `<div class="empty">${(data.checks || []).length ? 'موردی پیدا نشد' : 'هنوز چکی ثبت نشده. با + ثبت کنید.'}</div>`;
      return;
    }

    listEl.innerHTML = rows.map(r => {
      const ch = r.ch;
      const partyHref = '#/customer?id=' + encodeURIComponent(ch.customerId);
      const invLink = ch.invoiceId
        ? ` · <a href="#/invoice?id=${encodeURIComponent(ch.invoiceId)}" class="tx-inline-link">فاکتور #${esc(String(r.inv ? r.inv.number : '—'))}</a>`
        : '';
      const dueCls = (r.dueSoon || r.overdue) ? 'accent-rust' : '';
      const statusCls = r.st.key === 'cleared' ? 'accent-olive' : ((r.dueSoon || r.overdue) ? 'accent-rust' : 'accent-amber');
      return `<div class="ledger-row tx-row" style="cursor:default;align-items:flex-start;">
        <span class="name" style="flex:1;min-width:0;">
          <a href="${partyHref}" class="tx-row-title" style="text-decoration:none;color:inherit;">${esc(r.partyName)}</a>
          <span class="sub">${ch.checkNumber ? 'ش ' + esc(ch.checkNumber) + ' · ' : ''}سررسید <span class="${dueCls}">${faDate(ch.dueDate)}</span>${invLink}</span>
          ${r.dueSoon && r.st.key === 'pending' ? '<span class="sub accent-rust">سررسید نزدیک</span>' : ''}
          ${r.overdue && r.st.key === 'pending' ? '<span class="sub accent-rust">سررسید گذشته</span>' : ''}
        </span>
        <span class="filler"></span>
        <span class="amount tx-row-amount">
          <span class="tx-row-total">${toman(ch.amount)} ت</span>
          <button type="button" class="btn small secondary tx-status-btn ${statusCls}" data-toggle-check="${esc(ch.id)}">${r.st.label}</button>
        </span>
      </div>`;
    }).join('');
  }

  function openNewCheckPicker() {
    if (!data.customers.length) {
      openSheet(`<h3>مشتری ندارید</h3><div class="empty">اول از بخش مشتریان، یک مشتری ثبت کنید.</div>
        <div class="btn-row"><a class="btn secondary" href="#/customers">رفتن به مشتریان</a></div>`);
      return;
    }
    const opts = data.customers.filter(c => c.active !== false).slice().sort((a,b) => (a.name || '').localeCompare(b.name || '', 'fa'))
      .map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
    openSheet(`
      <h3>ثبت چک</h3>
      <div class="field"><label>مشتری</label><select id="chk-pick-customer">${opts}</select></div>
      <div class="btn-row"><button class="btn" id="chk-pick-go">ادامه</button></div>
    `);
    document.getElementById('chk-pick-go').onclick = function () {
      const cid = document.getElementById('chk-pick-customer').value;
      closeModal();
      if (typeof openAddCheck === 'function') openAddCheck(cid);
    };
  }

  function drawChecksPage(root) {
    const chip = function (id, label) {
      return `<button type="button" class="chip ${chkFilter === id ? 'active' : ''}" data-cf="${id}">${label}</button>`;
    };
    const isSup = chkSide === 'supplier';
    const sideChip = function (id, label) {
      return `<button type="button" class="chip ${chkSide === id ? 'active' : ''}" data-side="${id}">${label}</button>`;
    };
    root.innerHTML = `
      <div class="chip-row" id="check-sides">
        ${sideChip('customer', 'دریافتی از مشتری')}
        ${sideChip('supplier', 'پرداختی به تامین‌کننده')}
      </div>
      <div class="field"><input id="check-search" placeholder="${isSup ? 'جستجوی تامین‌کننده، شماره چک، مبلغ...' : 'جستجوی مشتری، شماره چک، مبلغ...'}" value="${esc(chkQuery)}" autocomplete="off"></div>
      <div class="chip-row" id="check-chips">
        ${chip('all','همه')}
        ${chip('pending','در جریان')}
        ${chip('cleared', isSup ? 'پرداخت‌شده' : 'وصول‌شده')}
        ${isSup ? chip('bounced','برگشتی') : ''}
        ${chip('dueSoon','سررسید نزدیک')}
        ${chip('overdue','چک سررسیدگذشته')}
      </div>
      <div class="tx-toolbar">
        <label class="tx-toolbar-label" for="check-sort">مرتب‌سازی</label>
        <select id="check-sort" class="tx-toolbar-select">
          <option value="dueAsc" ${chkSort === 'dueAsc' ? 'selected' : ''}>نزدیک‌ترین سررسید</option>
          <option value="dueDesc" ${chkSort === 'dueDesc' ? 'selected' : ''}>دورترین سررسید</option>
          <option value="amountDesc" ${chkSort === 'amountDesc' ? 'selected' : ''}>بیشترین مبلغ</option>
          <option value="newest" ${chkSort === 'newest' ? 'selected' : ''}>جدیدترین ثبت</option>
        </select>
      </div>
      <div id="check-summary" class="cards" style="margin-bottom:12px;"></div>
      <p class="tx-hint">${isSup ? 'برای تغییر وضعیت یا ویرایش چک، روی ردیف بزنید تا صفحهٔ همان تامین‌کننده باز شود.' : 'برای تغییر وضعیت وصول، روی دکمه وضعیت هر چک بزنید.'}</p>
      <div id="check-list" class="tx-list"></div>
    `;

    document.querySelectorAll('#check-sides [data-side]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const next = btn.getAttribute('data-side');
        if (next === chkSide) return;
        chkSide = next;
        chkFilter = 'all';
        chkQuery = '';
        const fabEl = document.getElementById('fab');
        if (fabEl) fabEl.style.display = chkSide === 'customer' ? 'block' : 'none';   // «+ ثبت چک» فقط برای چک مشتری
        drawChecksPage(root);
      });
    });

    const searchEl = document.getElementById('check-search');
    searchHandler = function (e) {
      chkQuery = e.target.value;
      renderCheckListOnly();
    };
    searchEl.addEventListener('input', searchHandler);

    chipHandlers = [];
    document.querySelectorAll('#check-chips [data-cf]').forEach(function (btn) {
      const fn = function () {
        chkFilter = btn.getAttribute('data-cf');
        document.querySelectorAll('#check-chips [data-cf]').forEach(function (b) {
          b.classList.toggle('active', b.getAttribute('data-cf') === chkFilter);
        });
        renderCheckListOnly();
      };
      btn.addEventListener('click', fn);
      chipHandlers.push({ el: btn, fn: fn });
    });

    const sortEl = document.getElementById('check-sort');
    sortHandler = function (e) {
      chkSort = e.target.value;
      renderCheckListOnly();
    };
    sortEl.addEventListener('change', sortHandler);

    // Delegated event for status toggle (survives list re-render)
    const listEl = document.getElementById('check-list');
    listEl.addEventListener('click', async function (e) {
      const btn = e.target.closest('[data-toggle-check]');
      if (!btn) return;
      if (btn.disabled) return;
      e.preventDefault();
      e.stopPropagation();
      const id = btn.getAttribute('data-toggle-check');
      const chk = data.checks.find(x => x.id === id);
      if (!chk) return;
      if(!(await appConfirm(chk.status === 'cleared' ? 'وضعیت این چک به «در جریان» برگردد؟' : 'این چک به‌عنوان «وصول‌شده» ثبت شود؟'))) return;
      await withSubmitGuard(btn, async function(){
        const prev = chk.status;
        chk.status = chk.status === 'cleared' ? 'pending' : 'cleared';
        try {
          await saveData();
          showToast(chk.status === 'cleared' ? 'چک وصول شد' : 'چک به حالت در جریان برگشت');
          renderCheckListOnly();
        } catch (err) {
          chk.status = prev;
          throw err;
        }
      });
    });

    renderCheckListOnly();
  }

  function mount(root, params) {
    let refreshToken = null;
    if (!root) return function () {};

    const fab = document.getElementById('fab');
    if (fab) {
      fab.style.display = 'block';
      fabHandler = function () {
        openNewCheckPicker();
      };
      fab.onclick = fabHandler;
    }
    const nav = document.getElementById('nav');
    if (nav) nav.style.display = '';

    chkQuery = '';
    chkSide = (params && params.side === 'supplier') ? 'supplier' : 'customer';
    if (fab) fab.style.display = chkSide === 'customer' ? 'block' : 'none';
    var validChkFilters = chkSide === 'supplier'
      ? ['all', 'pending', 'cleared', 'bounced', 'dueSoon', 'overdue']
      : ['all', 'pending', 'cleared', 'dueSoon', 'overdue'];
    var incomingFilter = params && params.filter;
    chkFilter = (incomingFilter && validChkFilters.indexOf(incomingFilter) !== -1)
      ? incomingFilter
      : 'all';
    chkSort = 'dueAsc';
    drawChecksPage(root);

    refreshToken = ViewHost.setRefresh(renderCheckListOnly);
    return function unmount() {
      ViewHost.clearRefresh(refreshToken);
      refreshToken = null;
      if (searchHandler) {
        const se = document.getElementById('check-search');
        if (se) se.removeEventListener('input', searchHandler);
      }
      searchHandler = null;

      chipHandlers.forEach(function (h) {
        try {
          h.el.removeEventListener('click', h.fn);
        } catch (e) {}
      });
      chipHandlers = [];

      if (sortHandler) {
        const so = document.getElementById('check-sort');
        if (so) so.removeEventListener('change', sortHandler);
      }
      sortHandler = null;

      if (fab) {
        fab.style.display = 'none';
        fab.onclick = null;
      }
      fabHandler = null;
      root.innerHTML = '';
    };
  }

  global.ChecksView = { mount: mount, unmount: function () {} };
})(typeof window !== 'undefined' ? window : this);