/* js/views/suppliers.js — SPA Suppliers list view (Phase 7).
   Extracted from suppliers.html. Reuses supplierTotals, openAddSupplier,
   openSupplierDetail as-is. No new financial logic.
*/
'use strict';

(function (global) {
  let supQuery = '';
  let supFilter = 'all'; // all | debt | settled | credit
  let supSort = 'name'; // name | debtDesc | debtAsc

  let searchHandler = null;
  let chipHandlers = [];
  let sortHandler = null;
  let fabHandler = null;
  function navigateToSupplier(sid) {
    if (
      typeof isSpaShell === 'function' &&
      isSpaShell() &&
      typeof AppRouter !== 'undefined' &&
      AppRouter.navigate
    ) {
      AppRouter.navigate('/supplier', { id: sid });
    } else {
      location.href = '#/supplier?id=' + encodeURIComponent(sid);
    }
  }

  function renderSupplierListOnly() {
    const listEl = document.getElementById('supplier-list');
    if (!listEl) return;

    let rows = (data.suppliers || []).slice();
    const q = (supQuery || '').trim().toLowerCase();
    if (q) {
      rows = rows.filter(s =>
        (s.name || '').toLowerCase().includes(q) ||
        (s.phone || '').includes(q)
      );
    }

    rows = rows.map(s => {
      const t = supplierTotals(s.id);
      const purchaseCount = (s.purchases || []).length;
      return { s, t, purchaseCount };
    });

    if (supFilter === 'debt') rows = rows.filter(x => x.t.balance > 0);
    else if (supFilter === 'settled') rows = rows.filter(x => x.t.balance === 0);
    else if (supFilter === 'credit') rows = rows.filter(x => x.t.balance < 0);

    if (supSort === 'debtDesc') rows.sort((a,b) => b.t.balance - a.t.balance);
    else if (supSort === 'debtAsc') rows.sort((a,b) => a.t.balance - b.t.balance);
    else rows.sort((a,b) => (a.s.name || '').localeCompare(b.s.name || '', 'fa'));

    if (!rows.length) {
      listEl.innerHTML = `<div class="empty">${(data.suppliers || []).length ? 'موردی پیدا نشد' : 'هنوز تامین‌کننده‌ای ثبت نشده. با + اضافه کنید.'}</div>`;
    } else {
      listEl.innerHTML = rows.map(({s, t, purchaseCount}) => {
        const word = balanceStatusWord(t.balance);
        const color = t.balance > 0 ? 'accent-rust' : (t.balance < 0 ? 'accent-olive' : '');
        const amt = t.balance === 0 ? word : (word + ': ' + toman(Math.abs(t.balance)) + ' ت');
        const metaBits = [];
        if (s.phone) metaBits.push(s.phone);
        if (purchaseCount) metaBits.push(purchaseCount + ' خرید');
        const meta = metaBits.length ? `<span class="sub">${esc(metaBits.join(' · '))}</span>` : '';
        return `<a class="ledger-row tx-row" data-open-supplier="${esc(s.id)}" style="text-decoration:none;color:inherit;">
          <span class="name">
            <span class="tx-row-title">${esc(s.name)}${s.active === false ? ' <span class="badge pending">غیرفعال</span>' : ''}</span>
            ${meta}
          </span>
          <span class="filler"></span>
          <span class="amount tx-row-amount ${color}">
            <span class="tx-row-total" style="font-size:.88rem;">${amt}</span>
          </span>
        </a>`;
      }).join('');
    }
  }

  function drawSuppliersPage(root) {
    const chip = function (id, label) {
      return `<button type="button" class="chip ${supFilter === id ? 'active' : ''}" data-sf="${id}">${label}</button>`;
    };
    root.innerHTML = `
      <h2 class="section-title">تامین‌کنندگان</h2>
      <div class="field"><input id="supplier-search" placeholder="جستجوی نام یا تلفن..." value="${esc(supQuery)}" autocomplete="off"></div>
      <div class="chip-row" id="supplier-chips">
        ${chip('all', 'همه')}
        ${chip('debt', 'بدهکار')}
        ${chip('settled', 'تسویه')}
        ${chip('credit', 'بستانکار')}
      </div>
      <div class="tx-toolbar">
        <label class="tx-toolbar-label" for="supplier-sort">مرتب‌سازی</label>
        <select id="supplier-sort" class="tx-toolbar-select">
          <option value="name" ${supSort === 'name' ? 'selected' : ''}>نام</option>
          <option value="debtDesc" ${supSort === 'debtDesc' ? 'selected' : ''}>بیشترین بدهی</option>
          <option value="debtAsc" ${supSort === 'debtAsc' ? 'selected' : ''}>کمترین بدهی</option>
        </select>
      </div>
      <div id="supplier-list" class="tx-list"></div>
    `;

    const searchEl = document.getElementById('supplier-search');
    searchHandler = function (e) {
      supQuery = e.target.value;
      renderSupplierListOnly();
    };
    searchEl.addEventListener('input', searchHandler);

    chipHandlers = [];
    document.querySelectorAll('#supplier-chips [data-sf]').forEach(function (btn) {
      const fn = function () {
        supFilter = btn.getAttribute('data-sf');
        document.querySelectorAll('#supplier-chips [data-sf]').forEach(function (b) {
          b.classList.toggle('active', b.getAttribute('data-sf') === supFilter);
        });
        renderSupplierListOnly();
      };
      btn.addEventListener('click', fn);
      chipHandlers.push({ el: btn, fn: fn });
    });

    const sortEl = document.getElementById('supplier-sort');
    sortHandler = function (e) {
      supSort = e.target.value;
      renderSupplierListOnly();
    };
    sortEl.addEventListener('change', sortHandler);

    // Delegated click for row navigation
    const list = document.getElementById('supplier-list');
    list.addEventListener('click', function (e) {
      const row = e.target.closest('[data-open-supplier]');
      if (row) {
        e.preventDefault();
        navigateToSupplier(row.getAttribute('data-open-supplier'));
      }
    });

    renderSupplierListOnly();
  }

  function mount(root, params) {
    let refreshToken = null;
    if (!root) return function () {};

    const fab = document.getElementById('fab');
    if (fab) {
      fab.style.display = 'block';
      fabHandler = function () {
        if (typeof openAddSupplier === 'function') openAddSupplier();
      };
      fab.onclick = fabHandler;
    }
    const nav = document.getElementById('nav');
    if (nav) nav.style.display = '';

    supQuery = '';
    supFilter = 'all';
    supSort = 'name';
    drawSuppliersPage(root);

    refreshToken = ViewHost.setRefresh(renderSupplierListOnly);
    return function unmount() {
      ViewHost.clearRefresh(refreshToken);
      refreshToken = null;
      if (searchHandler) {
        const se = document.getElementById('supplier-search');
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
        const so = document.getElementById('supplier-sort');
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

  global.SuppliersView = { mount: mount, unmount: function () {} };
})(typeof window !== 'undefined' ? window : this);