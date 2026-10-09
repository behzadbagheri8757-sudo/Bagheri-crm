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
  let listClickHandler = null;
  let listKeyHandler = null;

  // Display labels for a visit's offeredProducts (same wording as the visit form).
  const OFFER_REACTION_LABEL = { accepted: 'قبول کرد', rejected: 'رد کرد', deferred: 'بعداً تصمیم می‌گیرد' };
  const OFFER_REASON_LABEL = {
    price: 'قیمت', quality: 'کیفیت', competitor: 'رقیب', unavailable: 'موجود نبود',
    no_need: 'نیاز نداشت', still_stock: 'موجود داشت', other: 'سایر',
  };
  const OFFER_STOCK_SOURCE_LABEL = { ours: 'از ما', competitor: 'از رقیب', unknown: 'نمی‌دانم' };

  function offerMeta(op) {
    const parts = [OFFER_REACTION_LABEL[op.reaction] || ''];
    if (op.reaction === 'rejected') {
      if (OFFER_REASON_LABEL[op.rejectionReason]) parts.push(OFFER_REASON_LABEL[op.rejectionReason]);
      if (op.rejectionReason === 'still_stock' && OFFER_STOCK_SOURCE_LABEL[op.stockSource]) {
        parts.push(OFFER_STOCK_SOURCE_LABEL[op.stockSource]);
      }
    }
    return parts.filter(Boolean).join(' · ');
  }

  // Expandable list of the products offered in this visit (display only).
  function offeredDetailsHtml(v) {
    const offers = Array.isArray(v.offeredProducts) ? v.offeredProducts.filter(op => op && op.productId) : [];
    if (!offers.length) return '';
    return '<details class="row-details"><summary>پیشنهادهای این ویزیت (' + enToFaDigits(String(offers.length)) + ' مورد)</summary>' +
      '<div class="row-details-list">' +
        offers.map(op => {
          const prod = (data.products || []).find(p => p.id === op.productId) || {};
          return '<div class="row-details-item">' +
            '<span class="row-details-name">' + esc(prod.name || 'کالا') + '</span>' +
            '<span class="row-details-meta">' + esc(offerMeta(op)) + '</span>' +
          '</div>';
        }).join('') +
      '</div></details>';
  }

  function navigateToCustomer(cid) {
    AppRouter.navigate('/customer', { id: cid });
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
    const hideDuplicateTotal = visitFilter === 'all' && rows.length === totalAll;
    sumEl.innerHTML = `
      <div class="card"><div class="label">تعداد ویزیت (فیلتر)</div><div class="value">${enToFaDigits(String(rows.length))}</div></div>
      ${hideDuplicateTotal ? '' : `<div class="card"><div class="label">کل ویزیت‌ها</div><div class="value">${enToFaDigits(String(totalAll))}</div></div>`}
      <div class="card wide"><div class="label">سفارش‌گرفته در فیلتر فعلی</div><div class="value accent-olive">${enToFaDigits(String(orderedN))}</div></div>
    `;

    if (!rows.length) {
      listEl.innerHTML = `<div class="empty">${totalAll ? 'موردی پیدا نشد' : 'هنوز ویزیتی ثبت نشده. با + ثبت کنید.'}</div>`;
      return;
    }

    listEl.innerHTML = rows.map(r => {
      const v = r.visit;
      const cls = resultClass(v.result);
      const ordered = v.ordered || v.result === VISIT_RESULTS[0];
      // Every present context field gets its own line (nextAction, reason, note).
      const ctxLines = [v.nextAction, v.reason, v.note].filter(Boolean)
        .map(t => `<span class="sub tx-row-ctx">${esc(t)}</span>`).join('');
      const offersHtml = offeredDetailsHtml(v);
      const scoreBit = (typeof v.score === 'number')
        ? ` · امتیاز ${v.score}`
        : '';
      // <div> (not <a>) so a <details> can live inside; navigation is delegated
      // from #visit-list (see drawVisitsPage) and ignores clicks inside the details.
      return `<div class="ledger-row tx-row${offersHtml ? ' has-row-details' : ''}" data-visit-customer="${esc(r.customerId)}" role="link" tabindex="0">
        <span class="name">
          <span class="tx-row-title">${esc(r.customerName)}</span>
          <span class="sub">${faDate(v.date)}${v.time ? ' ' + esc(v.time) : ''}${r.region ? ' · ' + esc(r.region) : ''}${scoreBit}</span>
          <span class="sub ${cls}">${esc(v.result || 'ویزیت')}</span>
          ${ctxLines}
          ${offersHtml}
        </span>
        <span class="filler"></span>
      </div>`;
    }).join('');
  }

  function openNewVisitPicker() {
    if (!data.customers.length) {
      openSheet(`<h3>مشتری ندارید</h3><div class="empty">اول از بخش مشتریان، یک مشتری ثبت کنید.</div>
        <div class="btn-row"><a class="btn secondary" href="#/customers">رفتن به مشتریان</a></div>`);
      return;
    }
    const opts = data.customers.filter(c => c.active !== false).slice().sort((a,b)=>(a.name||'').localeCompare(b.name||'','fa'))
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
      <div class="field"><input id="visit-search" placeholder="جستجوی نام مشتری، منطقه، نتیجه..." value="${esc(visitQuery)}" autocomplete="off"></div>
      <div class="chip-row" id="visit-chips">
        ${chip('all','همه')}
        ${chip('ordered','سفارش گرفته شد')}
        ${chip('noorder','سفارش گرفته نشد')}
        ${chip('closed','فروشگاه بسته بود')}
        ${chip('just','فقط بازدید')}
      </div>
      <div class="tx-toolbar">
        <label class="tx-toolbar-label" for="visit-sort">مرتب‌سازی</label>
        <select id="visit-sort" class="tx-toolbar-select">
          <option value="newest" ${visitSort === 'newest' ? 'selected' : ''}>جدیدترین</option>
          <option value="oldest" ${visitSort === 'oldest' ? 'selected' : ''}>قدیمی‌ترین</option>
        </select>
      </div>
      <div id="visit-summary" class="cards" style="margin-bottom:12px;"></div>
      <div id="visit-list" class="tx-list"></div>
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

    // Delegated row navigation. Clicks/keys inside the <details> only toggle it.
    const listEl = document.getElementById('visit-list');
    listClickHandler = function (e) {
      if (e.target.closest('.row-details')) return;
      const row = e.target.closest('[data-visit-customer]');
      if (!row) return;
      e.preventDefault();
      navigateToCustomer(row.getAttribute('data-visit-customer'));
    };
    listKeyHandler = function (e) {
      if (e.key !== 'Enter' || !e.target.matches || !e.target.matches('[data-visit-customer]')) return;
      e.preventDefault();
      navigateToCustomer(e.target.getAttribute('data-visit-customer'));
    };
    listEl.addEventListener('click', listClickHandler);
    listEl.addEventListener('keydown', listKeyHandler);

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

      const le = document.getElementById('visit-list');
      if (le) {
        if (listClickHandler) le.removeEventListener('click', listClickHandler);
        if (listKeyHandler) le.removeEventListener('keydown', listKeyHandler);
      }
      listClickHandler = null;
      listKeyHandler = null;

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