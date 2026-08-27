/* js/views/visits.js — SPA Visits view (Phase 8).
   Extracted from visits.html. Reuses VISIT_RESULTS, VISIT_REASONS,
   VISIT_OPPORTUNITIES, VISIT_THREATS, VISIT_NEXT_ACTIONS.
   No new financial logic.
*/
'use strict';

(function (global) {
  let visitQuery = '';
  let visitFilter = 'all'; // all | ordered | noorder | closed | just
  let visitSort = 'newest'; // newest | oldest

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

  function collectVisits() {
    const items = [];
    (data.customers || []).forEach(c => {
      (c.visits || []).forEach(v => {
        items.push({
          customerId: c.id,
          customerName: c.name || '—',
          phone: c.phone || '',
          region: c.region || '',
          visit: v,
        });
      });
    });
    return items;
  }

  function resultClass(result) {
    if (result === VISIT_RESULTS[0]) return 'accent-olive';
    if (result === VISIT_RESULTS[2]) return 'accent-amber';
    if (result === VISIT_RESULTS[1]) return 'accent-rust';
    return '';
  }

  function renderVisitListOnly() {
    const listEl = document.getElementById('visit-list');
    const sumEl = document.getElementById('visit-summary');
    if (!listEl || !sumEl) return;

    let rows = collectVisits();
    const q = (visitQuery || '').trim().toLowerCase();
    if (q) {
      rows = rows.filter(r =>
        (r.customerName || '').toLowerCase().includes(q) ||
        (r.phone || '').includes(q) ||
        (r.region || '').toLowerCase().includes(q) ||
        (r.visit.result || '').toLowerCase().includes(q)
      );
    }

    if (visitFilter === 'ordered') rows = rows.filter(r => r.visit.result === VISIT_RESULTS[0] || r.visit.ordered === true);
    else if (visitFilter === 'noorder') rows = rows.filter(r => r.visit.result === VISIT_RESULTS[1]);
    else if (visitFilter === 'closed') rows = rows.filter(r => r.visit.result === VISIT_RESULTS[2]);
    else if (visitFilter === 'just') rows = rows.filter(r => r.visit.result === VISIT_RESULTS[3]);

    if (visitSort === 'oldest') {
      rows.sort((a,b) => (a.visit.date||'').localeCompare(b.visit.date||'') || (a.visit.time||'').localeCompare(b.visit.time||''));
    } else {
      rows.sort((a,b) => (b.visit.date||'').localeCompare(a.visit.date||'') || (b.visit.time||'').localeCompare(a.visit.time||''));
    }

    const totalAll = collectVisits().length;
    const orderedN = rows.filter(r => r.visit.result === VISIT_RESULTS[0] || r.visit.ordered).length;
    sumEl.innerHTML = `
      <div class="card"><div class="label">تعداد (فیلتر)</div><div class="value">${rows.length}</div></div>
      <div class="card"><div class="label">کل ویزیت‌ها</div><div class="value">${totalAll}</div></div>
      <div class="card wide"><div class="label">سفارش‌گرفته در فیلتر فعلی</div><div class="value accent-olive">${orderedN}</div></div>
    `;

    if (!rows.length) {
      listEl.innerHTML = `<div class="empty">${totalAll ? 'موردی پیدا نشد' : 'هنوز ویزیتی ثبت نشده. با + ثبت کنید.'}</div>`;
      return;
    }

    listEl.innerHTML = rows.map(r => {
      const v = r.visit;
      const cls = resultClass(v.result);
      const scoreBit = (typeof v.score === 'number')
        ? `<span class="sub">امتیاز ارزیابی: ${v.score} از ۱۰۰</span>`
        : '';
      const extraBits = [];
      if (v.reason) extraBits.push('دلیل: ' + v.reason);
      if (v.nextAction) extraBits.push('اقدام: ' + v.nextAction);
      if (v.opportunity) extraBits.push('فرصت (مشاهده): ' + v.opportunity);
      if (v.threat) extraBits.push('تهدید (مشاهده): ' + v.threat);
      if (Array.isArray(v.tags) && v.tags.length) extraBits.push('برچسب: ' + v.tags.join('، '));
      if (v.note) extraBits.push(v.note);
      const extraHtml = extraBits.map(x => `<span class="sub">${esc(x)}</span>`).join('');
      return `<a class="ledger-row" href="#/customer?id=${encodeURIComponent(r.customerId)}" style="text-decoration:none;color:inherit;">
        <span class="name">${esc(r.customerName)}
          <span class="sub">${faDate(v.date)}${v.time ? ' — ' + esc(v.time) : ''}${r.region ? ' — ' + esc(r.region) : ''}</span>
          <span class="sub ${cls}">${esc(v.result || 'ویزیت')}</span>
          ${scoreBit}
          ${extraHtml}
        </span>
        <span class="filler"></span>
        <span class="amount ${cls}" style="font-size:.8rem;">${v.ordered || v.result === VISIT_RESULTS[0] ? 'سفارش' : 'ویزیت'}</span>
      </a>`;
    }).join('');
  }

  function openNewVisitPicker() {
    if (!data.customers.length) {
      openSheet(`<h3>مشتری ندارید</h3><div class="empty">اول از بخش مشتریان، یک مشتری ثبت کنید.</div>
        <div class="btn-row"><a class="btn secondary" href="#/customers">رفتن به مشتریان</a></div>`);
      return;
    }
    const opts = data.customers.slice().sort((a,b)=>(a.name||'').localeCompare(b.name||'','fa'))
      .map(c=>`<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
    openSheet(`
      <h3>ثبت ویزیت</h3>
      <div class="field"><label>مشتری</label><select id="visit-pick-customer">${opts}</select></div>
      <div class="btn-row"><button class="btn" id="visit-pick-go">ادامه</button></div>
    `);
    document.getElementById('visit-pick-go').onclick = ()=>{
      const cid = document.getElementById('visit-pick-customer').value;
      closeModal();
      if (typeof openAddVisit === 'function') openAddVisit(cid);
    };
  }

  function drawVisitsPage(root) {
    const chip = function (id, label) {
      return `<button type="button" class="chip ${visitFilter === id ? 'active' : ''}" data-vf="${id}">${label}</button>`;
    };
    root.innerHTML = `
      <h2 class="section-title">ویزیت و ارزیابی</h2>
      <div class="field"><input id="visit-search" placeholder="جستجوی نام مشتری، منطقه، نتیجه..." value="${esc(visitQuery)}" autocomplete="off"></div>
      <div class="chip-row" id="visit-chips">
        ${chip('all','همه')}
        ${chip('ordered','سفارش گرفته شد')}
        ${chip('noorder','سفارش گرفته نشد')}
        ${chip('closed','فروشگاه بسته بود')}
        ${chip('just','فقط بازدید')}
      </div>
      <div class="field">
        <label>مرتب‌سازی</label>
        <select id="visit-sort">
          <option value="newest" ${visitSort === 'newest' ? 'selected' : ''}>جدیدترین</option>
          <option value="oldest" ${visitSort === 'oldest' ? 'selected' : ''}>قدیمی‌ترین</option>
        </select>
      </div>
      <div id="visit-summary" class="cards" style="margin-bottom:12px;"></div>
      <div id="visit-list"></div>
    `;

    const searchEl = document.getElementById('visit-search');
    searchHandler = function (e) {
      visitQuery = e.target.value;
      renderVisitListOnly();
    };
    searchEl.addEventListener('input', searchHandler);

    chipHandlers = [];
    document.querySelectorAll('#visit-chips [data-vf]').forEach(function (btn) {
      const fn = function () {
        visitFilter = btn.getAttribute('data-vf');
        document.querySelectorAll('#visit-chips [data-vf]').forEach(function (b) {
          b.classList.toggle('active', b.getAttribute('data-vf') === visitFilter);
        });
        renderVisitListOnly();
      };
      btn.addEventListener('click', fn);
      chipHandlers.push({ el: btn, fn: fn });
    });

    const sortEl = document.getElementById('visit-sort');
    sortHandler = function (e) {
      visitSort = e.target.value;
      renderVisitListOnly();
    };
    sortEl.addEventListener('change', sortHandler);

    renderVisitListOnly();
  }

  function mount(root, params) {
    let refreshToken = null;
    if (!root) return function () {};

    const fab = document.getElementById('fab');
    if (fab) {
      fab.style.display = 'block';
      fabHandler = function () {
        openNewVisitPicker();
      };
      fab.onclick = fabHandler;
    }
    const nav = document.getElementById('nav');
    if (nav) nav.style.display = '';

    visitQuery = '';
    visitFilter = 'all';
    visitSort = 'newest';
    drawVisitsPage(root);

    refreshToken = ViewHost.setRefresh(renderVisitListOnly);
    return function unmount() {
      ViewHost.clearRefresh(refreshToken);
      refreshToken = null;
      if (searchHandler) {
        const se = document.getElementById('visit-search');
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
        const so = document.getElementById('visit-sort');
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

  global.VisitsView = { mount: mount, unmount: function () {} };
})(typeof window !== 'undefined' ? window : this);