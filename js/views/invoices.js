/* js/views/invoices.js — SPA Invoices view (Phase 6).
   Extracted from invoices.html. Reuses invoiceEffectivePaid, invoiceEffectiveRemain,
   invoicePayStatus, openAddInvoice, openInvoiceDetail, openCustomerDetail as-is.
   No new financial logic.
*/
'use strict';

(function (global) {
  let invQuery = '';
  let invFilter = 'all'; // all | paid | debt
  let invSort = 'newest'; // newest | oldest | amountDesc | amountAsc

  let searchHandler = null;
  let chipHandlers = [];
  let sortHandler = null;
  let fabHandler = null;

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

  function invoicePaidAmount(inv) {
    return typeof invoiceEffectivePaid === 'function' ? invoiceEffectivePaid(inv) : invoiceOnRecordPaid(inv);
  }
  function invoiceRemain(inv) {
    return typeof invoiceEffectiveRemain === 'function' ? invoiceEffectiveRemain(inv) : Math.max(0, (inv.total||0) - invoicePaidAmount(inv));
  }
  function invoicePayStatus(inv) {
    const paid = invoicePaidAmount(inv);
    const total = inv.total||0;
    if (total <= 0) return { key:'paid', label:'—', cls:'' };
    if (paid <= 0) return { key:'debt', label:'پرداخت‌نشده', cls:'accent-rust' };
    if (paid + 0.5 >= total) return { key:'paid', label:'تسویه روی فاکتور', cls:'accent-olive' };
    return { key:'debt', label:'پرداخت جزئی', cls:'accent-amber' };
  }

  function renderInvoiceListOnly() {
    const listEl = document.getElementById('invoice-list');
    if (!listEl) return;

    let rows = (data.invoices || []).slice();
    const q = (invQuery || '').trim().toLowerCase();
    if (q) {
      rows = rows.filter(inv => {
        const cust = data.customers.find(c => c.id === inv.customerId);
        const name = (cust && cust.name) || '';
        return String(inv.number || '').includes(q) || name.toLowerCase().includes(q);
      });
    }

    rows = rows.map(inv => {
      const st = invoicePayStatus(inv);
      const paid = invoicePaidAmount(inv);
      const remain = invoiceRemain(inv);
      const cust = data.customers.find(c => c.id === inv.customerId);
      return { inv, st, paid, remain, custName: cust ? cust.name : '—' };
    });

    if (invFilter === 'paid') rows = rows.filter(x => x.st.key === 'paid');
    else if (invFilter === 'debt') rows = rows.filter(x => x.st.key === 'debt');

    if (invSort === 'oldest') rows.sort((a,b)=> (a.inv.date||'').localeCompare(b.inv.date||'') || String(a.inv.number).localeCompare(String(b.inv.number)));
    else if (invSort === 'amountDesc') rows.sort((a,b)=> (b.inv.total||0)-(a.inv.total||0));
    else if (invSort === 'amountAsc') rows.sort((a,b)=> (a.inv.total||0)-(b.inv.total||0));
    else rows.sort((a,b)=> (b.inv.date||'').localeCompare(a.inv.date||'') || String(b.inv.number).localeCompare(String(a.inv.number)));

    if (!rows.length) {
      listEl.innerHTML = `<div class="empty">${(data.invoices||[]).length?'موردی پیدا نشد':'هنوز فاکتوری ثبت نشده. با + فاکتور جدید بزنید.'}</div>`;
    } else {
      listEl.innerHTML = rows.map(({inv, st, paid, remain, custName}) => `
        <a class="ledger-row" href="#/invoice?id=${encodeURIComponent(inv.id)}" style="text-decoration:none;color:inherit;">
          <span class="name">#${esc(String(inv.number||''))}
            <span class="sub">${esc(custName)} — ${faDate(inv.date)} — <span class="${st.cls}">${st.label}</span></span>
            <span class="sub">پرداخت‌شده: ${toman(paid)} ت — مانده فاکتور: ${toman(Math.max(0, remain))} ت</span>
          </span>
          <span class="filler"></span>
          <span class="amount">${toman(inv.total)} ت</span>
        </a>
      `).join('');
    }
  }

  function openNewInvoicePicker() {
    if (!data.customers.length) {
      openSheet(`<h3>مشتری ندارید</h3><div class="empty">اول از بخش مشتریان، یک مشتری ثبت کنید.</div>
        <div class="btn-row"><a class="btn secondary" href="#/customers">رفتن به مشتریان</a></div>`);
      return;
    }
    const opts = data.customers.slice().sort((a,b)=>(a.name||'').localeCompare(b.name||'','fa'))
      .map(c=>`<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
    openSheet(`
      <h3>فاکتور جدید</h3>
      <div class="field"><label>مشتری</label><select id="inv-pick-customer">${opts}</select></div>
      <div class="btn-row"><button class="btn" id="inv-pick-go">ادامه</button></div>
    `);
    document.getElementById('inv-pick-go').onclick = ()=>{
      const cid = document.getElementById('inv-pick-customer').value;
      closeModal();
      if (typeof openAddInvoice === 'function') openAddInvoice(cid);
    };
  }

  function drawInvoicesPage(root) {
    const chip = function (id, label) {
      return `<button type="button" class="chip ${invFilter===id?'active':''}" data-if="${id}">${label}</button>`;
    };
    root.innerHTML = `
      <h2 class="section-title">فاکتورها</h2>
      <div class="field"><input id="invoice-search" placeholder="جستجوی شماره فاکتور یا نام مشتری..." value="${esc(invQuery)}" autocomplete="off"></div>
      <div class="chip-row" id="invoice-chips">
        ${chip('all','همه')}
        ${chip('paid','پرداخت‌شده')}
        ${chip('debt','بدهکار')}
      </div>
      <div class="field">
        <label>مرتب‌سازی</label>
        <select id="invoice-sort">
          <option value="newest" ${invSort==='newest'?'selected':''}>جدیدترین</option>
          <option value="oldest" ${invSort==='oldest'?'selected':''}>قدیمی‌ترین</option>
          <option value="amountDesc" ${invSort==='amountDesc'?'selected':''}>بیشترین مبلغ</option>
          <option value="amountAsc" ${invSort==='amountAsc'?'selected':''}>کمترین مبلغ</option>
        </select>
      </div>
      <div id="invoice-list"></div>
    `;

    const searchEl = document.getElementById('invoice-search');
    searchHandler = function (e) {
      invQuery = e.target.value;
      renderInvoiceListOnly();
    };
    searchEl.addEventListener('input', searchHandler);

    chipHandlers = [];
    document.querySelectorAll('#invoice-chips [data-if]').forEach(function (btn) {
      const fn = function () {
        invFilter = btn.getAttribute('data-if');
        document.querySelectorAll('#invoice-chips [data-if]').forEach(function (b) {
          b.classList.toggle('active', b.getAttribute('data-if') === invFilter);
        });
        renderInvoiceListOnly();
      };
      btn.addEventListener('click', fn);
      chipHandlers.push({ el: btn, fn: fn });
    });

    const sortEl = document.getElementById('invoice-sort');
    sortHandler = function (e) {
      invSort = e.target.value;
      renderInvoiceListOnly();
    };
    sortEl.addEventListener('change', sortHandler);

    renderInvoiceListOnly();
  }

  function mount(root, params) {
    let refreshToken = null;
    if (!root) return function () {};

    const fab = document.getElementById('fab');
    if (fab) {
      fab.style.display = 'block';
      fabHandler = function () {
        openNewInvoicePicker();
      };
      fab.onclick = fabHandler;
    }
    const nav = document.getElementById('nav');
    if (nav) nav.style.display = '';

    invQuery = '';
    invFilter = 'all';
    invSort = 'newest';
    drawInvoicesPage(root);

    refreshToken = ViewHost.setRefresh(renderInvoiceListOnly);

    return function unmount() {
      ViewHost.clearRefresh(refreshToken);
      refreshToken = null;
      if (searchHandler) {
        const se = document.getElementById('invoice-search');
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
        const so = document.getElementById('invoice-sort');
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

  global.InvoicesView = { mount: mount, unmount: function () {} };
})(typeof window !== 'undefined' ? window : this);