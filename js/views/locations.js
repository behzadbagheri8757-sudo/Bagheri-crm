/* js/views/locations.js — Location Management (Regions → Routes → Neighborhoods).
   Uses js/location.js (listRegions/putRegion/deleteRegion/... ). No financial
   logic, no changes to Customer/Prospect business logic — CRUD + validation only.
*/
'use strict';

(function (global) {
  let expandedRegion = null; // regionId currently expanded to show its routes
  let expandedRoute = null;  // routeId currently expanded to show its neighborhoods

  let addRegionHandler = null;
  let listClickHandler = null;

  function draw(root) {
    const regions = listRegions();

    const regionBlocks = regions.length
      ? regions.map(function (r) {
          const isOpen = expandedRegion === r.id;
          const routeCount = listRoutes(r.id).length;
          let routesHtml = '';
          if (isOpen) {
            const routes = listRoutes(r.id);
            routesHtml =
              '<div style="margin:10px 0 4px;padding-right:12px;border-right:2px solid var(--line, #ddd);">' +
              '<div class="field"><label>مسیر جدید در «' + esc(r.name) + '»</label>' +
              '<div class="btn-row"><input id="new-route-input" placeholder="مثلاً: مسیر شرق" style="flex:1;">' +
              '<button type="button" class="btn small" data-add-route="' + esc(r.id) + '">افزودن</button></div></div>' +
              (routes.length
                ? routes.map(function (rt) {
                    const rOpen = expandedRoute === rt.id;
                    const neighCount = listNeighborhoods(rt.id).length;
                    let neighHtml = '';
                    if (rOpen) {
                      const neighs = listNeighborhoods(rt.id);
                      neighHtml =
                        '<div style="margin:8px 0 4px;padding-right:12px;border-right:2px solid var(--line, #eee);">' +
                        '<div class="field"><label>محله جدید در «' + esc(rt.name) + '»</label>' +
                        '<div class="btn-row"><input id="new-neigh-input" placeholder="مثلاً: خیابان ساحلی" style="flex:1;">' +
                        '<button type="button" class="btn small" data-add-neigh="' + esc(rt.id) + '">افزودن</button></div></div>' +
                        (neighs.length
                          ? neighs.map(function (n) {
                              return '<div class="ledger-row" data-neigh="' + esc(n.id) + '">' +
                                '<span class="name">' + esc(n.name) + '</span>' +
                                '<span class="filler"></span>' +
                                '<button type="button" class="btn small danger" data-del-neigh="' + esc(n.id) + '">حذف</button>' +
                                '</div>';
                            }).join('')
                          : '<div class="empty" style="padding:6px 0;">هنوز محله‌ای نیست</div>') +
                        '</div>';
                    }
                    return '<div class="card" style="margin-bottom:8px;" data-route="' + esc(rt.id) + '">' +
                      '<div class="btn-row" style="justify-content:space-between;">' +
                      '<button type="button" class="btn small secondary" data-toggle-route="' + esc(rt.id) + '" style="font-weight:800;">' +
                      (rOpen ? '▾ ' : '▸ ') + esc(rt.name) + ' <span class="sub">(' + neighCount + ' محله)</span></button>' +
                      '<button type="button" class="btn small danger" data-del-route="' + esc(rt.id) + '">حذف مسیر</button>' +
                      '</div>' + neighHtml + '</div>';
                  }).join('')
                : '<div class="empty" style="padding:6px 0;">هنوز مسیری نیست</div>') +
              '</div>';
          }
          return '<div class="card" style="margin-bottom:10px;" data-region="' + esc(r.id) + '">' +
            '<div class="btn-row" style="justify-content:space-between;">' +
            '<button type="button" class="btn small secondary" data-toggle-region="' + esc(r.id) + '" style="font-weight:800;">' +
            (isOpen ? '▾ ' : '▸ ') + esc(r.name) + ' <span class="sub">(' + routeCount + ' مسیر)</span></button>' +
            '<button type="button" class="btn small danger" data-del-region="' + esc(r.id) + '">حذف منطقه</button>' +
            '</div>' + routesHtml + '</div>';
        }).join('')
      : '<div class="empty">هنوز منطقه‌ای ثبت نشده</div>';

    root.innerHTML =
      '<div class="btn-row" style="margin-bottom:10px;">' +
      '<a class="btn secondary small" href="#/settings">← تنظیمات</a></div>' +
      '<h2 class="section-title">مدیریت موقعیت مکانی</h2>' +
      '<div class="sub" style="margin-bottom:10px;font-size:.82rem;">' +
      'ساختار مشترک منطقه › مسیر › محله — هم برای مشتریان و هم برای مغازه‌های بالقوه.' +
      '</div>' +
      '<div class="field"><label>منطقه جدید</label>' +
      '<div class="btn-row"><input id="new-region-input" placeholder="مثلاً: نوشهر" style="flex:1;">' +
      '<button type="button" class="btn small" id="add-region-btn">افزودن</button></div></div>' +
      '<div id="region-list">' + regionBlocks + '</div>';

    const addRegionBtn = document.getElementById('add-region-btn');
    addRegionHandler = async function () {
      const input = document.getElementById('new-region-input');
      const name = (input.value || '').trim();
      if (!name) { showToast('نام منطقه را وارد کن'); return; }
      const res = await putRegion({ name });
      if (!res.ok) { showToast(res.reason || 'ذخیره نشد'); return; }
      showToast('منطقه اضافه شد');
      draw(root);
    };
    addRegionBtn.addEventListener('click', addRegionHandler);

    const list = document.getElementById('region-list');
    listClickHandler = async function (e) {
      const toggleRegion = e.target.closest('[data-toggle-region]');
      if (toggleRegion) {
        const id = toggleRegion.getAttribute('data-toggle-region');
        expandedRegion = expandedRegion === id ? null : id;
        expandedRoute = null;
        draw(root);
        return;
      }
      const toggleRoute = e.target.closest('[data-toggle-route]');
      if (toggleRoute) {
        const id = toggleRoute.getAttribute('data-toggle-route');
        expandedRoute = expandedRoute === id ? null : id;
        draw(root);
        return;
      }
      const addRoute = e.target.closest('[data-add-route]');
      if (addRoute) {
        const regionId = addRoute.getAttribute('data-add-route');
        const input = document.getElementById('new-route-input');
        const name = (input && input.value || '').trim();
        if (!name) { showToast('نام مسیر را وارد کن'); return; }
        const res = await putRoute({ regionId, name });
        if (!res.ok) { showToast(res.reason || 'ذخیره نشد'); return; }
        showToast('مسیر اضافه شد');
        draw(root);
        return;
      }
      const addNeigh = e.target.closest('[data-add-neigh]');
      if (addNeigh) {
        const routeId = addNeigh.getAttribute('data-add-neigh');
        const input = document.getElementById('new-neigh-input');
        const name = (input && input.value || '').trim();
        if (!name) { showToast('نام محله را وارد کن'); return; }
        const res = await putNeighborhood({ routeId, name });
        if (!res.ok) { showToast(res.reason || 'ذخیره نشد'); return; }
        showToast('محله اضافه شد');
        draw(root);
        return;
      }
      const delRegion = e.target.closest('[data-del-region]');
      if (delRegion) {
        const id = delRegion.getAttribute('data-del-region');
        if (!confirm('این منطقه حذف شود؟')) return;
        const res = await deleteRegion(id);
        if (!res.ok) { showToast(res.reason || 'حذف نشد'); return; }
        showToast('حذف شد');
        draw(root);
        return;
      }
      const delRoute = e.target.closest('[data-del-route]');
      if (delRoute) {
        const id = delRoute.getAttribute('data-del-route');
        if (!confirm('این مسیر حذف شود؟')) return;
        const res = await deleteRoute(id);
        if (!res.ok) { showToast(res.reason || 'حذف نشد'); return; }
        showToast('حذف شد');
        draw(root);
        return;
      }
      const delNeigh = e.target.closest('[data-del-neigh]');
      if (delNeigh) {
        const id = delNeigh.getAttribute('data-del-neigh');
        if (!confirm('این محله حذف شود؟')) return;
        const res = await deleteNeighborhood(id);
        if (!res.ok) { showToast(res.reason || 'حذف نشد'); return; }
        showToast('حذف شد');
        draw(root);
        return;
      }
    };
    list.addEventListener('click', listClickHandler);
  }

  function mount(root, params) {
    if (!root) return function () {};
    const nav = document.getElementById('nav');
    if (nav) nav.style.display = '';
    expandedRegion = null;
    expandedRoute = null;
    draw(root);

    const refreshToken = ViewHost.setRefresh(function () { draw(root); });

    return function unmount() {
      ViewHost.clearRefresh(refreshToken);
      if (addRegionHandler) {
        const btn = document.getElementById('add-region-btn');
        if (btn) btn.removeEventListener('click', addRegionHandler);
      }
      addRegionHandler = null;
      if (listClickHandler) {
        const list = document.getElementById('region-list');
        if (list) list.removeEventListener('click', listClickHandler);
      }
      listClickHandler = null;
      root.innerHTML = '';
    };
  }

  global.LocationsView = { mount: mount, unmount: function () {} };
})(typeof window !== 'undefined' ? window : this);
