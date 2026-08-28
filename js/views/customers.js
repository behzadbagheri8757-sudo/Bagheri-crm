/* js/views/customers.js — SPA Customers list view (Phase 4).
   Extracted from customers.html. Reuses customerTotals/data.customers as-is.
   No new financial logic; behavior mirrors the MPA page 1:1.
*/
'use strict';

(function (global) {
  let custQuery = '';
  let custFilter = 'all'; // all | debt | settled | credit
  let custSortByDebt = false;

  let searchHandler = null;
  let sortHandler = null;
  let chipHandlers = [];
  let listClickHandler = null;
  function customerHref(cid) {
    return typeof isSpaShell === 'function' && isSpaShell()
      ? '#/customer?id=' + encodeURIComponent(cid)
      : '#/customer?id=' + encodeURIComponent(cid);
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

  function renderCustomerListOnly() {
    const listEl = document.getElementById('customer-list');
    if (!listEl) return;

    let rows = (data.customers || []).slice();
    const q = (custQuery || '').trim().toLowerCase();
    if (q) {
      rows = rows.filter(function (c) {
        return (
          (c.name || '').toLowerCase().includes(q) ||
          (c.phone || '').includes(q) ||
          (c.region || '').toLowerCase().includes(q) ||
          (c.ownerName || '').toLowerCase().includes(q) ||
          (c.address || '').toLowerCase().includes(q)
        );
      });
    }

    rows = rows.map(function (c) {
      return { c: c, t: customerTotals(c.id) };
    });

    if (custFilter === 'debt') rows = rows.filter(function (x) { return x.t.balance > 0; });
    else if (custFilter === 'settled') rows = rows.filter(function (x) { return x.t.balance === 0; });
    else if (custFilter === 'credit') rows = rows.filter(function (x) { return x.t.balance < 0; });

    if (custSortByDebt) {
      rows.sort(function (a, b) { return b.t.balance - a.t.balance; });
    } else {
      rows.sort(function (a, b) { return (a.c.name || '').localeCompare(b.c.name || '', 'fa'); });
    }

    if (!rows.length) {
      listEl.innerHTML =
        '<div class="empty">' +
        ((data.customers || []).length
          ? 'موردی با این فیلتر پیدا نشد'
          : 'هنوز مشتری ثبت نشده است. با دکمه + مشتری جدید اضافه کنید.') +
        '</div>';
      return;
    }

    listEl.innerHTML = rows
      .map(function (x) {
        const c = x.c;
        const t = x.t;
        const word = balanceStatusWord(t.balance);
        const color = t.balance > 0 ? 'accent-rust' : t.balance < 0 ? 'accent-olive' : '';
        const amt = t.balance === 0 ? word : word + ': ' + toman(Math.abs(t.balance)) + ' ت';
        const subParts = [];
        if (c.phone) subParts.push(c.phone);
        if (c.region) subParts.push(c.region);
        if (c.address) subParts.push(c.address);
        const sub = subParts.join(' — ');
        return (
          '<a class="ledger-row" data-open-customer="' +
          esc(c.id) +
          '" href="' +
          customerHref(c.id) +
          '" style="text-decoration:none;color:inherit;">' +
          '<span class="name">' +
          esc(c.name) +
          (sub ? '<span class="sub">' + esc(sub) + '</span>' : '') +
          '</span>' +
          '<span class="filler"></span>' +
          '<span class="amount ' +
          color +
          '">' +
          amt +
          '</span></a>'
        );
      })
      .join('');
  }

  function drawCustomersPage(root) {
    const chip = function (id, label) {
      return (
        '<button type="button" class="chip ' +
        (custFilter === id ? 'active' : '') +
        '" data-filter="' +
        id +
        '">' +
        label +
        '</button>'
      );
    };
    root.innerHTML =
      '<h2 class="section-title">مشتریان</h2>' +
      '<div class="field"><input id="customer-search" placeholder="جستجوی نام، تلفن، منطقه، آدرس..." value="' +
      esc(custQuery) +
      '" autocomplete="off"></div>' +
      '<div class="chip-row" id="customer-chips">' +
      chip('all', 'همه') +
      chip('debt', 'بدهکار') +
      chip('settled', 'تسویه') +
      chip('credit', 'بستانکار') +
      '</div>' +
      '<div class="btn-row" style="margin-bottom:8px;">' +
      '<button type="button" class="btn small secondary" id="sort-debt">' +
      (custSortByDebt ? '✓ ' : '') +
      'مرتب‌سازی بر اساس بدهی</button>' +
      '</div>' +
      '<div id="customer-list"></div>';

    const searchEl = document.getElementById('customer-search');
    searchHandler = function (e) {
      custQuery = e.target.value;
      renderCustomerListOnly();
    };
    searchEl.addEventListener('input', searchHandler);

    chipHandlers = [];
    document.querySelectorAll('#customer-chips [data-filter]').forEach(function (btn) {
      const fn = function () {
        custFilter = btn.getAttribute('data-filter');
        document.querySelectorAll('#customer-chips [data-filter]').forEach(function (b) {
          b.classList.toggle('active', b.getAttribute('data-filter') === custFilter);
        });
        renderCustomerListOnly();
      };
      btn.addEventListener('click', fn);
      chipHandlers.push({ el: btn, fn: fn });
    });

    const sortBtn = document.getElementById('sort-debt');
    sortHandler = function () {
      custSortByDebt = !custSortByDebt;
      sortBtn.textContent = (custSortByDebt ? '✓ ' : '') + 'مرتب‌سازی بر اساس بدهی';
      renderCustomerListOnly();
    };
    sortBtn.addEventListener('click', sortHandler);

    const list = document.getElementById('customer-list');
    listClickHandler = function (e) {
      const row = e.target.closest('[data-open-customer]');
      if (!row) return;
      if (typeof isSpaShell === 'function' && isSpaShell()) {
        e.preventDefault();
        navigateToCustomer(row.getAttribute('data-open-customer'));
      }
      // else: plain MPA <a href="#/customer?id=..."> navigates normally
    };
    list.addEventListener('click', listClickHandler);

    renderCustomerListOnly();
  }

  function mount(root, params) {
    let refreshToken = null;
    if (!root) return function () {};
    const fab = document.getElementById('fab');
    if (fab) {
      fab.style.display = 'block';
      fab.onclick = function () {
        if (typeof openAddCustomer === 'function') openAddCustomer();
      };
    }
    const nav = document.getElementById('nav');
    if (nav) nav.style.display = '';

    custQuery = '';
    custFilter = (params && ['debt', 'settled', 'credit'].indexOf(params.filter) !== -1) ? params.filter : 'all';
    custSortByDebt = false;
    drawCustomersPage(root);

    refreshToken = ViewHost.setRefresh(renderCustomerListOnly);

    // openAddCustomer/openAddTransaction/etc. call render() after save — bind to list-only refresh.
    return function unmount() {
      ViewHost.clearRefresh(refreshToken);
      refreshToken = null;
      if (searchHandler) {
        const se = document.getElementById('customer-search');
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
        const sb = document.getElementById('sort-debt');
        if (sb) sb.removeEventListener('click', sortHandler);
      }
      sortHandler = null;

      if (listClickHandler) {
        const list = document.getElementById('customer-list');
        if (list) list.removeEventListener('click', listClickHandler);
      }
      listClickHandler = null;

      if (fab) {
        fab.style.display = 'none';
        fab.onclick = null;
      }
      root.innerHTML = '';
    };
  }

  global.CustomersView = { mount: mount, unmount: function () {} };
})(typeof window !== 'undefined' ? window : this);
