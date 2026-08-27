/* js/views/prospect-routes.js — SPA Prospect routes view (Phase 8).
   Extracted from prospect-routes.html. Reuses prospectState,
   addProspectRoute, deleteProspectRoute, addProspectNeighborhood.
   No new financial logic.
*/
'use strict';

(function (global) {
  let addRouteHandler = null;
  function navigateToProspects() {
    if (
      typeof isSpaShell === 'function' &&
      isSpaShell() &&
      typeof AppRouter !== 'undefined' &&
      AppRouter.navigate
    ) {
      AppRouter.navigate('/prospects');
    } else {
      location.href = '#/prospects';
    }
  }

  function drawRoutes(root) {
    const routes = prospectState.routes;
    root.innerHTML = `
      <div class="btn-row" style="margin-bottom:10px;">
        <a class="btn secondary small" href="#/prospects">← مغازه‌های بالقوه</a>
      </div>
      <h2 class="section-title">مسیرها</h2>
      <div class="field"><label>مسیر جدید</label>
        <div class="btn-row">
          <input id="new-route" placeholder="مثلاً: مسیر غرب" style="flex:1;">
          <button type="button" class="btn small" id="add-route">افزودن</button>
        </div>
      </div>
      <div id="route-list"></div>
    `;

    const list = document.getElementById('route-list');
    if (!routes.length) {
      list.innerHTML = '<div class="empty">هنوز مسیری نیست</div>';
    } else {
      list.innerHTML = routes.map(r => {
        const count = prospectState.shops.filter(s => s.routeId === r.id).length;
        const neigh = (r.neighborhoods || []).map(n =>
          `<span class="badge" style="margin:2px;">${esc(n.name)}</span>`
        ).join(' ') || '<span class="sub">بدون محله</span>';
        return `<div class="card" style="margin-bottom:10px;" data-route="${esc(r.id)}">
          <div style="font-weight:800;">${esc(r.name)} <span class="sub">(${count} مغازه)</span></div>
          <div style="margin:8px 0;">${neigh}</div>
          <div class="btn-row">
            <button type="button" class="btn small secondary" data-add-neigh="${esc(r.id)}">+ محله</button>
            <button type="button" class="btn small danger" data-del-route="${esc(r.id)}">حذف مسیر</button>
          </div>
        </div>`;
      }).join('');
    }

    // Add route handler
    const addBtn = document.getElementById('add-route');
    addRouteHandler = function () {
      const name = (document.getElementById('new-route').value || '').trim();
      if (!name) { showToast('نام مسیر را وارد کن'); return; }
      addProspectRoute(name).then(() => {
        showToast('مسیر اضافه شد');
        drawRoutes(root);
      });
    };
    addBtn.onclick = addRouteHandler;

    // Delegated events for delete and add neighborhood
    list.addEventListener('click', function (e) {
      const delBtn = e.target.closest('[data-del-route]');
      if (delBtn) {
        const id = delBtn.getAttribute('data-del-route');
        if (!confirm('این مسیر حذف شود؟')) return;
        deleteProspectRoute(id).then(() => {
          showToast('حذف شد');
          drawRoutes(root);
        });
        return;
      }
      const neighBtn = e.target.closest('[data-add-neigh]');
      if (neighBtn) {
        const routeId = neighBtn.getAttribute('data-add-neigh');
        const name = prompt('نام محله / خیابان:');
        if (!name || !name.trim()) return;
        addProspectNeighborhood(routeId, name.trim()).then(() => {
          showToast('محله اضافه شد');
          drawRoutes(root);
        });
      }
    });
  }

  function mount(root, params) {
    let refreshToken = null;
    if (!root) return function () {};

    const nav = document.getElementById('nav');
    if (nav) nav.style.display = '';

    drawRoutes(root);

    refreshToken = ViewHost.setRefresh(()=>drawRoutes(root));



    return function unmount() {
      ViewHost.clearRefresh(refreshToken);
      refreshToken = null;
      if (addRouteHandler) {
        const addBtn = document.getElementById('add-route');
        if (addBtn) addBtn.onclick = null;
      }
      addRouteHandler = null;
      root.innerHTML = '';
    };
  }

  global.ProspectRoutesView = { mount: mount, unmount: function () {} };
})(typeof window !== 'undefined' ? window : this);