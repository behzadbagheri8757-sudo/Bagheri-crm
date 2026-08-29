/* js/views/customers.js — SPA Customers list view (Phase 4).
   Extracted from customers.html. Reuses customerTotals/data.customers as-is.
   No new financial logic; behavior mirrors the MPA page 1:1.
*/
'use strict';

(function (global) {
  let custQuery = '';
  let custFilter = 'all'; // all | debt | settled | credit
  let custSortByDebt = false;
  let locFilter = { regionId: '', routeId: '', neighborhoodId: '', unassigned: false };

  let searchHandler = null;
  let sortHandler = null;
  let chipHandlers = [];
  let listClickHandler = null;
  let locFilterHandler = null;
  let locUnassignedHandler = null;
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

    if (locFilter.unassigned) {
      rows = rows.filter(function (x) { return !x.c.locationId; });
    } else if (locFilter.neighborhoodId) {
      rows = rows.filter(function (x) { return x.c.locationId === locFilter.neighborhoodId; });
    } else if (locFilter.routeId) {
      const neighIds = listNeighborhoods(locFilter.routeId).map(function (n) { return n.id; });
      rows = rows.filter(function (x) { return x.c.locationId && neighIds.indexOf(x.c.locationId) !== -1; });
    } else if (locFilter.regionId) {
      const routeIds = listRoutes(locFilter.regionId).map(function (r) { return r.id; });
      let neighIds = [];
      routeIds.forEach(function (rid) { neighIds = neighIds.concat(listNeighborhoods(rid).map(function (n) { return n.id; })); });
      rows = rows.filter(function (x) { return x.c.locationId && neighIds.indexOf(x.c.locationId) !== -1; });
    }

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

  function renderLocFilterOptionsHTML() {
    const regions = listRegions();
    const routes = locFilter.regionId ? listRoutes(locFilter.regionId) : [];
    const neighs = locFilter.routeId ? listNeighborhoods(locFilter.routeId) : [];
    const opt = function (list, selId) {
      return '<option value="">— همه —</option>' + list.map(function (x) {
        return '<option value="' + esc(x.id) + '" ' + (x.id === selId ? 'selected' : '') + '>' + esc(x.name) + '</option>';
      }).join('');
    };
    return (
      '<div class="field"><label>منطقه</label><select id="loc-filter-region">' + opt(regions, locFilter.regionId) + '</select></div>' +
      '<div class="field"><label>مسیر</label><select id="loc-filter-route" ' + (!locFilter.regionId ? 'disabled' : '') + '>' + opt(routes, locFilter.routeId) + '</select></div>' +
      '<div class="field"><label>محله</label><select id="loc-filter-neigh" ' + (!locFilter.routeId ? 'disabled' : '') + '>' + opt(neighs, locFilter.neighborhoodId) + '</select></div>'
    );
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
      '<div id="loc-filter-row">' + renderLocFilterOptionsHTML() + '</div>' +
      '<div class="chip-row" style="margin-bottom:8px;">' +
      '<button type="button" class="chip ' + (locFilter.unassigned ? 'active' : '') + '" id="loc-filter-unassigned">بدون موقعیت</button>' +
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

    function wireLocFilterSelects() {
      const regionSel = document.getElementById('loc-filter-region');
      const routeSel = document.getElementById('loc-filter-route');
      const neighSel = document.getElementById('loc-filter-neigh');
      if (regionSel) regionSel.addEventListener('change', function () {
        locFilter.regionId = regionSel.value;
        locFilter.routeId = '';
        locFilter.neighborhoodId = '';
        locFilter.unassigned = false;
        const row = document.getElementById('loc-filter-row');
        row.innerHTML = renderLocFilterOptionsHTML();
        wireLocFilterSelects();
        document.getElementById('loc-filter-unassigned').classList.remove('active');
        renderCustomerListOnly();
      });
      if (routeSel) routeSel.addEventListener('change', function () {
        locFilter.routeId = routeSel.value;
        locFilter.neighborhoodId = '';
        locFilter.unassigned = false;
        const row = document.getElementById('loc-filter-row');
        row.innerHTML = renderLocFilterOptionsHTML();
        wireLocFilterSelects();
        document.getElementById('loc-filter-unassigned').classList.remove('active');
        renderCustomerListOnly();
      });
      if (neighSel) neighSel.addEventListener('change', function () {
        locFilter.neighborhoodId = neighSel.value;
        locFilter.unassigned = false;
        document.getElementById('loc-filter-unassigned').classList.remove('active');
        renderCustomerListOnly();
      });
    }
    locFilterHandler = wireLocFilterSelects;
    wireLocFilterSelects();

    const unassignedBtn = document.getElementById('loc-filter-unassigned');
    locUnassignedHandler = function () {
      locFilter.unassigned = !locFilter.unassigned;
      if (locFilter.unassigned) {
        locFilter.regionId = '';
        locFilter.routeId = '';
        locFilter.neighborhoodId = '';
        const row = document.getElementById('loc-filter-row');
        row.innerHTML = renderLocFilterOptionsHTML();
        wireLocFilterSelects();
      }
      unassignedBtn.classList.toggle('active', locFilter.unassigned);
      renderCustomerListOnly();
    };
    unassignedBtn.addEventListener('click', locUnassignedHandler);

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
    locFilter = { regionId: '', routeId: '', neighborhoodId: '', unassigned: false };
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
