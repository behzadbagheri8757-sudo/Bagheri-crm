/* js/views/prospects.js — SPA Prospects list view (Phase 8).
   Extracted from prospects.html. Reuses prospectState, PROSPECT_RANK_INFO,
   prospectComputeScore, prospectScoreToRank, prospectRouteName,
   prospectNeighborhoodName, prospectFaDate, queueProspectTargetMilestoneMessage,
   setProspectDailyTargetValue, ensureProspectDailyTarget.
   No new financial logic.
*/
'use strict';

(function (global) {
  let pQuery = '';
  let pFilter = 'all'; // all | active | converted | A+ | A | B
  let pSort = 'score_desc'; // score_desc | score_asc | name | newest
  let pLocFilter = { regionId: '', routeId: '', neighborhoodId: '', unassigned: false };

  let searchHandler = null;
  let chipHandlers = [];
  let sortHandler = null;
  let listClickHandler = null;
  let fabHandler = null;
  let targetBtnHandler = null;
  function rankPill(rank) {
    // Shared helper (prospect-scoring.js): an incomplete V2 prospect has
    // rank === null and must render as "ناقص", never fall back to "D".
    return prospectRankBadgeHTML(rank);
  }

  function navigateToProspect(id) {
    AppRouter.navigate('/prospect', { id: id });
  }

  function navigateToEvaluation(shopId) {
    const params = shopId ? { shopId: shopId } : {};
    AppRouter.navigate('/evaluation', params);
  }

  function renderTargetCard() {
    const el = document.getElementById('prospect-target');
    if (!el) return;
    const dt = prospectState.dailyTarget || { target: 0, count: 0 };
    /* Presentation-only: iOS-like Hero Activity Card.
       Logic (target/count/percentage/remaining) and edit flow unchanged.
       Progress bar stays empty while count is 0 (is-idle). */
    if (!dt.target) {
      el.innerHTML = `<div class="prospect-daily-target is-unset">
        <div class="pdt-head">
          <span class="pdt-label">هدف ارزیابی امروز</span>
          <button type="button" class="pdt-edit" id="set-target-btn">تنظیم</button>
        </div>
        <div class="pdt-unset-msg">هنوز هدفی تنظیم نشده</div>
      </div>`;
    } else {
      const count = Number(dt.count) || 0;
      const target = Number(dt.target) || 0;
      const pctRaw = target > 0 ? (count / target) * 100 : 0;
      const pct = Math.min(100, Math.round(pctRaw * 10) / 10);
      const pctLabel = Math.min(100, Math.round(pctRaw));
      const idle = count <= 0;
      const barW = idle ? 0 : Math.min(100, Math.max(0, pct));
      const remaining = Math.max(0, target - count);
      el.innerHTML = `<div class="prospect-daily-target${idle ? ' is-idle' : ' is-active'}">
        <div class="pdt-head">
          <span class="pdt-label">هدف ارزیابی امروز</span>
          <span class="pdt-pct">${pctLabel}٪</span>
        </div>
        <div class="pdt-hero">
          <span class="pdt-count">${count}</span>
          <span class="pdt-caption">ارزیابی انجام شد</span>
          <span class="pdt-of">از ${target}</span>
        </div>
        <div class="pdt-bar-wrap"><div class="pdt-bar" role="progressbar" aria-valuenow="${count}" aria-valuemin="0" aria-valuemax="${target}"><span style="width:${barW}%"></span></div></div>
        <div class="pdt-foot">
          <span class="pdt-remain">${remaining} ارزیابی باقی مانده</span>
          <button type="button" class="pdt-edit" id="set-target-btn">ویرایش</button>
        </div>
      </div>`;
    }
    const b = document.getElementById('set-target-btn');
    if (b) {
      targetBtnHandler = function () {
        openSheet(`
          <h3>هدف ارزیابی امروز</h3>
          <div class="field"><label for="prospect-target-input">تعداد هدف</label><input id="prospect-target-input" type="text" inputmode="numeric" value="${esc(String(dt.target || 20))}"></div>
          <div class="btn-row"><button type="button" class="btn" id="prospect-target-save">ذخیره</button></div>
        `);
        const input = document.getElementById('prospect-target-input');
        const save = document.getElementById('prospect-target-save');
        if(input) setTimeout(function(){ input.focus(); input.select(); }, 0);
        if(save) save.onclick = function(){
          const n = parseInt(faToEnDigits(input ? input.value : ''), 10);
          if(!n || n <= 0){ showToast('عدد معتبر وارد کن'); if(input){ input.setAttribute('aria-invalid','true'); input.focus(); } return; }
          save.disabled = true;
          setProspectDailyTargetValue(n).then(function(){
            closeModal();
            renderTargetCard();
            showToast('تارگت ذخیره شد');
          }).catch(function(err){
            console.error(err);
            save.disabled = false;
            showToast('ذخیره تارگت ناموفق بود');
          });
        };
      };
      b.onclick = targetBtnHandler;
    }
  }

  function renderProspectListOnly() {
    const list = document.getElementById('prospect-list');
    const sum = document.getElementById('prospect-summary');
    if (!list || !sum) return;
    let rows = prospectState.shops.slice();
    const q = (pQuery || '').trim().toLowerCase();
    if (q) rows = rows.filter(s => (s.name || '').toLowerCase().includes(q));
    if (pFilter === 'active') rows = rows.filter(s => s.status !== 'converted');
    else if (pFilter === 'converted') rows = rows.filter(s => s.status === 'converted');
    else if (['A+', 'A', 'B', 'C', 'D'].includes(pFilter)) rows = rows.filter(s => s.latestRank === pFilter);

    if (pLocFilter.unassigned) {
      rows = rows.filter(s => !s.locationId);
    } else if (pLocFilter.neighborhoodId) {
      rows = rows.filter(s => s.locationId === pLocFilter.neighborhoodId);
    } else if (pLocFilter.routeId) {
      const neighIds = listNeighborhoods(pLocFilter.routeId).map(n => n.id);
      rows = rows.filter(s => s.locationId === pLocFilter.routeId || (s.locationId && neighIds.indexOf(s.locationId) !== -1));
    } else if (pLocFilter.regionId) {
      const routeIds = listRoutes(pLocFilter.regionId).map(r => r.id);
      let neighIds = [];
      routeIds.forEach(rid => { neighIds = neighIds.concat(listNeighborhoods(rid).map(n => n.id)); });
      rows = rows.filter(s => s.locationId && (routeIds.indexOf(s.locationId) !== -1 || neighIds.indexOf(s.locationId) !== -1));
    }

    if (pSort === 'score_asc') rows.sort((a,b) => a.latestScore - b.latestScore);
    else if (pSort === 'name') rows.sort((a,b) => (a.name || '').localeCompare(b.name || '', 'fa'));
    else if (pSort === 'newest') rows.sort((a,b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
    else rows.sort((a,b) => b.latestScore - a.latestScore);

    sum.innerHTML = `<div class="card"><div class="label">تعداد</div><div class="value">${rows.length}</div></div>
      <div class="card"><div class="label">کل مغازه‌ها</div><div class="value">${prospectState.shops.length}</div></div>`;

    if (!rows.length) {
      list.innerHTML = `<div class="empty">${prospectState.shops.length ? 'موردی پیدا نشد' : 'هنوز مغازه‌ای ثبت نشده. با + یا «ثبت مغازه» شروع کنید.'}</div>`;
      return;
    }
    list.innerHTML = rows.map(s => {
      const converted = s.status === 'converted';
      return `
      <a class="ledger-row tx-row" data-open-prospect="${esc(s.id)}" style="text-decoration:none;color:inherit;">
        <span class="name">
          <span class="tx-row-title">${esc(s.name)}${converted ? ' <span class="badge pending" style="font-size:.7em;">تبدیل‌شده</span>' : ''}</span>
          <span class="sub">${esc(getLocationDisplayString(s.locationId))} · ${prospectFaDate(s.updatedAt)}</span>
        </span>
        <span class="filler"></span>
        <span class="amount tx-row-amount">
          <span class="tx-row-total">${s.latestScore}</span>
          <span class="tx-row-meta">${rankPill(s.latestRank)}</span>
        </span>
      </a>`;
    }).join('');
    // Click listener is bound once in drawProspectsPage (not on every list re-render).
  }

  function renderProspectLocFilterOptionsHTML() {
    const regions = listRegions();
    const routes = pLocFilter.regionId ? listRoutes(pLocFilter.regionId) : [];
    const neighs = pLocFilter.routeId ? listNeighborhoods(pLocFilter.routeId) : [];
    const opt = function (list, selId) {
      return '<option value="">— همه —</option>' + list.map(function (x) {
        return '<option value="' + esc(x.id) + '" ' + (x.id === selId ? 'selected' : '') + '>' + esc(x.name) + '</option>';
      }).join('');
    };
    return (
      '<div class="field"><label>منطقه</label><select id="p-loc-filter-region">' + opt(regions, pLocFilter.regionId) + '</select></div>' +
      '<div class="field"><label>مسیر</label><select id="p-loc-filter-route" ' + (!pLocFilter.regionId ? 'disabled' : '') + '>' + opt(routes, pLocFilter.routeId) + '</select></div>' +
      '<div class="field"><label>محله</label><select id="p-loc-filter-neigh" ' + (!pLocFilter.routeId ? 'disabled' : '') + '>' + opt(neighs, pLocFilter.neighborhoodId) + '</select></div>'
    );
  }

  function drawProspectsPage(root) {
    const chip = function (id, label) {
      return `<button type="button" class="chip ${pFilter === id ? 'active' : ''}" data-pf="${id}">${label}</button>`;
    };
    root.innerHTML = `
      <h2 class="section-title">مشتریان بالقوه</h2>
      <div class="prospect-subnav">
        <a class="btn small secondary" data-nav-evaluation href="#/evaluation">ثبت مغازه + ارزیابی</a>
        <a class="btn small secondary" data-nav-routes href="#/locations">موقعیت‌ها</a>
      </div>
      <div id="prospect-target" class="cards" style="margin-bottom:12px;"></div>
      <div class="field"><input id="prospect-search" placeholder="جستجوی نام مغازه..." value="${esc(pQuery)}" autocomplete="off"></div>
      <div class="chip-row" id="prospect-chips">
        ${chip('all','همه')}
        ${chip('active','فعال')}
        ${chip('converted','تبدیل‌شده')}
        ${chip('A+','رتبه A+')}
        ${chip('A','رتبه A')}
        ${chip('B','رتبه B')}
      </div>
      <div class="tx-toolbar">
        <label class="tx-toolbar-label" for="prospect-sort">مرتب‌سازی</label>
        <select id="prospect-sort" class="tx-toolbar-select">
          <option value="score_desc" ${pSort === 'score_desc' ? 'selected' : ''}>بیشترین امتیاز</option>
          <option value="score_asc" ${pSort === 'score_asc' ? 'selected' : ''}>کمترین امتیاز</option>
          <option value="name" ${pSort === 'name' ? 'selected' : ''}>نام</option>
          <option value="newest" ${pSort === 'newest' ? 'selected' : ''}>جدیدترین</option>
        </select>
      </div>
      <div id="prospect-summary" class="cards" style="margin-bottom:10px;"></div>
      <div id="p-loc-filter-row" class="field-ops-loc">${renderProspectLocFilterOptionsHTML()}</div>
      <div class="chip-row" style="margin-bottom:8px;">
        <button type="button" class="chip ${pLocFilter.unassigned ? 'active' : ''}" id="p-loc-filter-unassigned">بدون موقعیت</button>
      </div>
      <div id="prospect-list" class="tx-list"></div>
    `;

    const searchEl = document.getElementById('prospect-search');
    searchHandler = function (e) {
      pQuery = e.target.value;
      renderProspectListOnly();
    };
    searchEl.addEventListener('input', searchHandler);

    chipHandlers = [];
    document.querySelectorAll('#prospect-chips [data-pf]').forEach(function (btn) {
      const fn = function () {
        pFilter = btn.getAttribute('data-pf');
        document.querySelectorAll('#prospect-chips [data-pf]').forEach(function (b) {
          b.classList.toggle('active', b.getAttribute('data-pf') === pFilter);
        });
        renderProspectListOnly();
      };
      btn.addEventListener('click', fn);
      chipHandlers.push({ el: btn, fn: fn });
    });

    const sortEl = document.getElementById('prospect-sort');
    sortHandler = function (e) {
      pSort = e.target.value;
      renderProspectListOnly();
    };
    sortEl.addEventListener('change', sortHandler);

    function wireProspectLocFilterSelects() {
      const regionSel = document.getElementById('p-loc-filter-region');
      const routeSel = document.getElementById('p-loc-filter-route');
      const neighSel = document.getElementById('p-loc-filter-neigh');
      const unassignedBtn = document.getElementById('p-loc-filter-unassigned');
      if (regionSel) regionSel.addEventListener('change', function () {
        pLocFilter.regionId = regionSel.value;
        pLocFilter.routeId = '';
        pLocFilter.neighborhoodId = '';
        pLocFilter.unassigned = false;
        const row = document.getElementById('p-loc-filter-row');
        row.innerHTML = renderProspectLocFilterOptionsHTML();
        wireProspectLocFilterSelects();
        if (unassignedBtn) unassignedBtn.classList.remove('active');
        renderProspectListOnly();
      });
      if (routeSel) routeSel.addEventListener('change', function () {
        pLocFilter.routeId = routeSel.value;
        pLocFilter.neighborhoodId = '';
        pLocFilter.unassigned = false;
        const row = document.getElementById('p-loc-filter-row');
        row.innerHTML = renderProspectLocFilterOptionsHTML();
        wireProspectLocFilterSelects();
        if (unassignedBtn) unassignedBtn.classList.remove('active');
        renderProspectListOnly();
      });
      if (neighSel) neighSel.addEventListener('change', function () {
        pLocFilter.neighborhoodId = neighSel.value;
        pLocFilter.unassigned = false;
        if (unassignedBtn) unassignedBtn.classList.remove('active');
        renderProspectListOnly();
      });
    }
    wireProspectLocFilterSelects();

    const pUnassignedBtn = document.getElementById('p-loc-filter-unassigned');
    if (pUnassignedBtn) {
      pUnassignedBtn.addEventListener('click', function () {
        pLocFilter.unassigned = !pLocFilter.unassigned;
        if (pLocFilter.unassigned) {
          pLocFilter.regionId = '';
          pLocFilter.routeId = '';
          pLocFilter.neighborhoodId = '';
          const row = document.getElementById('p-loc-filter-row');
          row.innerHTML = renderProspectLocFilterOptionsHTML();
          wireProspectLocFilterSelects();
        }
        pUnassignedBtn.classList.toggle('active', pLocFilter.unassigned);
        renderProspectListOnly();
      });
    }

    // Navigation buttons
    root.querySelector('[data-nav-evaluation]').addEventListener('click', function (e) {
      e.preventDefault();
      navigateToEvaluation(null);
    });
    root.querySelector('[data-nav-routes]').addEventListener('click', function (e) {
      e.preventDefault();
      AppRouter.navigate('/locations');
    });

    // Delegated list click — once per draw (same pattern as Customers/Checks)
    const listEl = document.getElementById('prospect-list');
    listClickHandler = function (e) {
      const row = e.target.closest('[data-open-prospect]');
      if (!row) return;
      e.preventDefault();
      navigateToProspect(row.getAttribute('data-open-prospect'));
    };
    if (listEl) listEl.addEventListener('click', listClickHandler);

    renderTargetCard();
    renderProspectListOnly();
  }

  function mount(root, params) {
    let refreshToken = null;
    if (!root) return function () {};

    const fab = document.getElementById('fab');
    if (fab) {
      fab.style.display = 'block';
      fabHandler = function () {
        navigateToEvaluation(null);
      };
      fab.onclick = fabHandler;
    }
    const nav = document.getElementById('nav');
    if (nav) nav.style.display = '';

    pQuery = '';
    pFilter = 'all';
    pSort = 'score_desc';
    pLocFilter = { regionId: '', routeId: '', neighborhoodId: '', unassigned: false };
    drawProspectsPage(root);

    refreshToken = ViewHost.setRefresh(renderProspectListOnly);
    return function unmount() {
      ViewHost.clearRefresh(refreshToken);
      refreshToken = null;
      if (searchHandler) {
        const se = document.getElementById('prospect-search');
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
        const so = document.getElementById('prospect-sort');
        if (so) so.removeEventListener('change', sortHandler);
      }
      sortHandler = null;

      if (listClickHandler) {
        const list = document.getElementById('prospect-list');
        if (list) list.removeEventListener('click', listClickHandler);
      }
      listClickHandler = null;

      if (fab) {
        fab.style.display = 'none';
        fab.onclick = null;
      }
      fabHandler = null;
      targetBtnHandler = null;
      root.innerHTML = '';
    };
  }

  global.ProspectsView = { mount: mount, unmount: function () {} };
})(typeof window !== 'undefined' ? window : this);