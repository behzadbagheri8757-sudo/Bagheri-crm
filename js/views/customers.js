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

  /* Priority/story lookup — cached for the current view state and only
     recomputed when the underlying data actually changes (mount, or a
     ViewHost data-refresh), never on every keystroke/filter/sort click.
     Read-only use of the existing frozen Priority Engine; no new
     scoring, no new thresholds (see spec §9.6 performance rule). */
  let custPriorityMap = null;
  function buildPriorityLookup() {
    const map = Object.create(null);
    if (typeof calculateAllCustomerPriorities !== 'function') return map;
    let list = [];
    try { list = calculateAllCustomerPriorities() || []; } catch (e) { return map; }
    list.forEach(function (p) { if (p && p.customerId) map[p.customerId] = p; });
    return map;
  }

  function renderCustomerListOnly() {
    const listEl = document.getElementById('customer-list');
    if (!listEl) return;

    if (!custPriorityMap) custPriorityMap = buildPriorityLookup();
    const priorityMap = custPriorityMap;
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
      rows = rows.filter(function (x) { return x.c.locationId === locFilter.routeId || (x.c.locationId && neighIds.indexOf(x.c.locationId) !== -1); });
    } else if (locFilter.regionId) {
      const routeIds = listRoutes(locFilter.regionId).map(function (r) { return r.id; });
      let neighIds = [];
      routeIds.forEach(function (rid) { neighIds = neighIds.concat(listNeighborhoods(rid).map(function (n) { return n.id; })); });
      rows = rows.filter(function (x) { return x.c.locationId && (routeIds.indexOf(x.c.locationId) !== -1 || neighIds.indexOf(x.c.locationId) !== -1); });
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
        const color = t.balance > 0 ? 'accent-rust' : t.balance < 0 ? 'accent-olive' : 'accent-olive';

        // One compact status badge + one activity metric. These are read-only
        // presentations of existing frozen outputs; no new scoring/thresholds.
        const pr = priorityMap[c.id] || null;
        const riskLevel = pr ? pr.riskLevel : null;
        const riskCls = riskLevel ? 'radar-risk-' + riskLevel : '';
        const behavior = (typeof customerBehavior === 'function')
          ? (function(){ try { return customerBehavior(c.id) || {}; } catch(e){ return {}; } })()
          : {};
        const watchCount = (typeof getActiveWatchOccurrences === 'function')
          ? (function(){ try { return (getActiveWatchOccurrences(c.id) || []).length; } catch(e){ return 0; } })()
          : 0;
        const status = (typeof customerStatus === 'function') ? customerStatus(c.id) : null;

        let badgeLabel = 'فعال';
        let badgeTone = 'neutral';
        if (riskLevel === 'critical') { badgeLabel = 'فوری'; badgeTone = 'danger'; }
        else if (riskLevel === 'high') { badgeLabel = 'پیگیری'; badgeTone = 'warning'; }
        else if (behavior.behindPattern === true) { badgeLabel = 'عقب‌افتاده'; badgeTone = 'warning'; }
        else if (status === 'lost') { badgeLabel = 'از دست رفته'; badgeTone = 'muted'; }
        else if (status === 'inactive') { badgeLabel = 'غیرفعال'; badgeTone = 'muted'; }
        else if (status === 'new') { badgeLabel = 'جدید'; badgeTone = 'neutral'; }
        else if (status === 'active') { badgeLabel = 'فعال'; badgeTone = 'success'; }

        const days = (typeof customerStats === 'function')
          ? (function(){ try { return customerStats(c.id).daysSinceLast; } catch(e){ return Infinity; } })()
          : Infinity;
        const daysText = Number.isFinite(days)
          ? ('آخرین خرید: ' + Math.max(0, Math.round(days)) + ' روز پیش')
          : 'هنوز خریدی ثبت نشده';
        const watchTitle = watchCount > 0 ? 'هشدار فعال: ' + watchCount + ' مورد' : '';

        return (
          '<a class="ledger-row customer-list-row ' + riskCls + '" data-open-customer="' +
          esc(c.id) +
          '" href="' +
          customerHref(c.id) +
          '" style="text-decoration:none;color:inherit;"' +
          (watchTitle ? ' title="' + esc(watchTitle) + '"' : '') + '>' +
          '<span class="name">' +
          esc(c.name) +
          '<span class="sub customer-row-meta">' + esc(daysText) + '</span>' +
          '</span>' +
          '<span class="customer-row-status badge tone-' + badgeTone + '">' + esc(badgeLabel) + '</span>' +
          (watchCount > 0 ? '<span class="customer-row-watch" aria-label="هشدار فعال" title="' + esc(watchTitle) + '"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"></circle><path d="M12 8.5v4.5M12 16.5h.01"></path></svg></span>' : '<span class="customer-row-watch-placeholder" aria-hidden="true"></span>') +
          '<span class="customer-row-balance ' + color + '">' +
          '<span class="customer-row-balance-label">' + esc(word) + '</span>' +
          (t.balance !== 0 ? '<span class="customer-row-balance-value">' + toman(Math.abs(t.balance)) + ' ت</span>' : '') +
          '</span></a>'
        );
      })
      .join('');
  }

  function renderLocationFilterSheet() {
    const regions = listRegions();
    const routes = locFilter.regionId ? listRoutes(locFilter.regionId) : (data.routes || []).slice().sort((a,b)=>(a.name||'').localeCompare(b.name||'','fa'));
    const neighs = locFilter.routeId ? listNeighborhoods(locFilter.routeId) : [];
    const opt = function (list, selId, allLabel) {
      return '<option value="">' + allLabel + '</option>' + list.map(function (x) {
        return '<option value="' + esc(x.id) + '" ' + (x.id === selId ? 'selected' : '') + '>' + esc(x.name) + '</option>';
      }).join('');
    };
    openSheet(
      '<h3>فیلتر مشتریان</h3>' +
      '<div class="field"><label>مسیر</label><select id="customer-filter-route">' + opt(routes, locFilter.routeId, 'همه مسیرها') + '</select></div>' +
      '<div class="field"><label>منطقه</label><select id="customer-filter-region">' + opt(regions, locFilter.regionId, 'همه مناطق') + '</select></div>' +
      '<div class="field"><label>محله</label><select id="customer-filter-neigh" ' + (!locFilter.routeId ? 'disabled' : '') + '>' + opt(neighs, locFilter.neighborhoodId, 'همه محله‌ها') + '</select></div>' +
      '<div class="btn-row" style="margin-top:4px;"><button type="button" class="btn small secondary" id="customer-filter-clear">پاک کردن فیلتر</button></div>'
    );

    const routeSel = document.getElementById('customer-filter-route');
    const regionSel = document.getElementById('customer-filter-region');
    const neighSel = document.getElementById('customer-filter-neigh');
    const clearBtn = document.getElementById('customer-filter-clear');

    function refreshSheet(keepOpen) {
      if (!keepOpen) return;
      renderLocationFilterSheet();
    }
    if (routeSel) routeSel.addEventListener('change', function () {
      locFilter.routeId = routeSel.value;
      locFilter.neighborhoodId = '';
      locFilter.unassigned = false;
      if (locFilter.routeId) {
        const r = getRoute(locFilter.routeId);
        locFilter.regionId = r ? r.regionId : '';
      }
      renderCustomerListOnly();
      refreshSheet(true);
    });
    if (regionSel) regionSel.addEventListener('change', function () {
      locFilter.regionId = regionSel.value;
      if (locFilter.routeId) {
        const r = getRoute(locFilter.routeId);
        if (!r || r.regionId !== locFilter.regionId) locFilter.routeId = '';
      }
      locFilter.neighborhoodId = '';
      locFilter.unassigned = false;
      renderCustomerListOnly();
      refreshSheet(true);
    });
    if (neighSel) neighSel.addEventListener('change', function () {
      locFilter.neighborhoodId = neighSel.value;
      locFilter.unassigned = false;
      renderCustomerListOnly();
    });
    if (clearBtn) clearBtn.addEventListener('click', function () {
      locFilter = { regionId:'', routeId:'', neighborhoodId:'', unassigned:false };
      renderCustomerListOnly();
      closeModal();
      updateLocationFilterIndicator();
    });
  }

  function updateLocationFilterIndicator() {
    const el = document.getElementById('customer-filter-indicator');
    const btn = document.getElementById('customer-filter');
    if (!el || !btn) return;
    const count = (locFilter.regionId ? 1 : 0) + (locFilter.routeId ? 1 : 0) + (locFilter.neighborhoodId ? 1 : 0) + (locFilter.unassigned ? 1 : 0);
    el.innerHTML = count
      ? '<span>فیلتر: ' + esc(getLocationDisplayString(locFilter.neighborhoodId || locFilter.routeId || locFilter.regionId)) + '</span><button type="button" class="chip" id="customer-filter-clear-inline">×</button>'
      : '';
    btn.classList.toggle('active', count > 0);
    const clear = document.getElementById('customer-filter-clear-inline');
    if (clear) clear.onclick = function () {
      locFilter = { regionId:'', routeId:'', neighborhoodId:'', unassigned:false };
      updateLocationFilterIndicator();
      renderCustomerListOnly();
    };
  }

  function drawCustomersPage(root) {
    const chip = function (id, label) {
      return '<button type="button" class="chip ' + (custFilter === id ? 'active' : '') + '" data-filter="' + id + '">' + label + '</button>';
    };
    root.innerHTML =
      '<h2 class="section-title">مشتریان</h2>' +
      '<div class="field"><input id="customer-search" placeholder="جستجوی نام، آدرس، تلفن، منطقه و…" value="' + esc(custQuery) + '" autocomplete="off"></div>' +
      '<div class="chip-row" id="customer-chips">' + chip('all','همه') + chip('debt','بدهکار') + chip('settled','تسویه') + chip('credit','بستانکار') + '</div>' +
      '<div class="btn-row" style="margin-bottom:8px;align-items:center;flex-wrap:wrap;">' +
      '<button type="button" class="btn small secondary" id="customer-filter">فیلتر</button>' +
      '<button type="button" class="btn small secondary" id="sort-debt">' + (custSortByDebt ? '✓ ' : '') + 'مرتب‌سازی بر اساس بدهی</button>' +
      '</div>' +
      '<div id="customer-filter-indicator" class="customer-filter-indicator" aria-live="polite"></div>' +
      '<div id="customer-list"></div>';

    const searchEl = document.getElementById('customer-search');
    searchHandler = function (e) { custQuery = e.target.value; renderCustomerListOnly(); };
    searchEl.addEventListener('input', searchHandler);

    chipHandlers = [];
    document.querySelectorAll('#customer-chips [data-filter]').forEach(function (btn) {
      const fn = function () {
        custFilter = btn.getAttribute('data-filter');
        document.querySelectorAll('#customer-chips [data-filter]').forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-filter') === custFilter); });
        renderCustomerListOnly();
      };
      btn.addEventListener('click', fn); chipHandlers.push({el:btn, fn:fn});
    });

    const filterBtn = document.getElementById('customer-filter');
    filterBtn.addEventListener('click', renderLocationFilterSheet);

    const sortBtn = document.getElementById('sort-debt');
    sortHandler = function () { custSortByDebt = !custSortByDebt; sortBtn.textContent = (custSortByDebt ? '✓ ' : '') + 'مرتب‌سازی بر اساس بدهی'; renderCustomerListOnly(); };
    sortBtn.addEventListener('click', sortHandler);

    const list = document.getElementById('customer-list');
    listClickHandler = function (e) {
      const row = e.target.closest('[data-open-customer]');
      if (!row) return;
      if (typeof isSpaShell === 'function' && isSpaShell()) { e.preventDefault(); navigateToCustomer(row.getAttribute('data-open-customer')); }
    };
    list.addEventListener('click', listClickHandler);
    updateLocationFilterIndicator();
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
    custPriorityMap = null; // fresh on entering the page
    drawCustomersPage(root);

    // A real data refresh (invoice/payment/visit recorded elsewhere) can
    // change risk/story output — invalidate the cache then, not on every
    // keystroke render.
    refreshToken = ViewHost.setRefresh(function () {
      custPriorityMap = null;
      renderCustomerListOnly();
    });

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
