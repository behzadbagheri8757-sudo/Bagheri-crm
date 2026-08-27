/* js/views/checks.js — SPA Checks view (Phase 9).
   Extracted from checks.html. Reuses check status helpers, openAddCheck,
   openCustomerDetail, openInvoiceDetail as-is. No new financial logic.
*/
'use strict';

(function (global) {
  let chkQuery = '';
  let chkFilter = 'all'; // all | pending | cleared | dueSoon
  let chkSort = 'dueAsc'; // dueAsc | dueDesc | amountDesc | newest

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

  function navigateToInvoice(invId) {
    if (
      typeof isSpaShell === 'function' &&
      isSpaShell() &&
      typeof AppRouter !== 'undefined' &&
      AppRouter.navigate
    ) {
      AppRouter.navigate('/invoice', { id: invId });
    } else {
      location.href = '#/invoice?id=' + encodeURIComponent(invId);
    }
  }

  function checkStatusLabel(ch) {
    if (ch.status === 'cleared') {
      return { label: 'وصول‌شده', cls: 'accent-olive', key: 'cleared' };
    }
    return { label: 'در جریان', cls: 'accent-amber', key: 'pending' };
  }

  function isDueSoon(ch) {
    if (ch.status === 'cleared') return false;
    try {
      const due = new Date(ch.dueDate);
      const diffDays = (due - new Date()) / 86400000;
      return diffDays <= 3;
    } catch (e) {
      return false;
    }
  }

  function renderCheckListOnly() {
    const listEl = document.getElementById('check-list');
    const sumEl = document.getElementById('check-summary');
    if (!listEl || !sumEl) return;

    let rows = (data.checks || []).slice().map(ch => {
      const cust = data.customers.find(c => c.id === ch.customerId);
      const inv = ch.invoiceId ? data.invoices.find(i => i.id === ch.invoiceId) : null;
      const st = checkStatusLabel(ch);
      return {
        ch, cust, inv, st,
        dueSoon: isDueSoon(ch),
        partyName: cust ? cust.name : '—',
      };
    });

    const q = (chkQuery || '').trim().toLowerCase();
    if (q) {
      rows = rows.filter(r =>
        (r.partyName || '').toLowerCase().includes(q) ||
        String(r.ch.checkNumber || '').toLowerCase().includes(q) ||
        String(r.ch.amount || '').includes(q) ||
        String(r.inv && r.inv.number || '').includes(q)
      );
    }

    if (chkFilter === 'pending') rows = rows.filter(r => r.st.key === 'pending');
    else if (chkFilter === 'cleared') rows = rows.filter(r => r.st.key === 'cleared');
    else if (chkFilter === 'dueSoon') rows = rows.filter(r => r.dueSoon);

    if (chkSort === 'dueDesc') rows.sort((a,b) => (b.ch.dueDate || '').localeCompare(a.ch.dueDate || ''));
    else if (chkSort === 'amountDesc') rows.sort((a,b) => (b.ch.amount || 0) - (a.ch.amount || 0));
    else if (chkSort === 'newest') rows.sort((a,b) => String(b.ch.id).localeCompare(String(a.ch.id)));
    else rows.sort((a,b) => (a.ch.dueDate || '').localeCompare(b.ch.dueDate || ''));

    const totalAll = rows.reduce((s,r) => s + (r.ch.amount || 0), 0);
    const pendingSum = rows.filter(r => r.st.key === 'pending').reduce((s,r) => s + (r.ch.amount || 0), 0);
    sumEl.innerHTML = `
      <div class="card"><div class="label">تعداد (فیلتر)</div><div class="value">${rows.length}</div></div>
      <div class="card"><div class="label">جمع مبالغ</div><div class="value">${toman(totalAll)} ت</div></div>
      <div class="card wide"><div class="label">جمع در جریان (در فیلتر فعلی)</div><div class="value accent-amber">${toman(pendingSum)} ت</div></div>
    `;

    if (!rows.length) {
      listEl.innerHTML = `<div class="empty">${(data.checks || []).length ? 'موردی پیدا نشد' : 'هنوز چکی ثبت نشده. با + ثبت کنید.'}</div>`;
      return;
    }

    listEl.innerHTML = rows.map(r => {
      const ch = r.ch;
      const partyHref = '#/customer?id=' + encodeURIComponent(ch.customerId);
      const invLink = ch.invoiceId
        ? ` <a href="#/invoice?id=${encodeURIComponent(ch.invoiceId)}" style="color:var(--olive-dark);">فاکتور #${esc(String(r.inv ? r.inv.number : '—'))}</a>`
        : '';
      const dueCls = r.dueSoon ? 'accent-rust' : '';
      return `<div class="ledger-row" style="cursor:default;align-items:flex-start;">
        <span class="name" style="flex:1;min-width:0;">
          <a href="${partyHref}" style="text-decoration:none;color:inherit;font-weight:700;">${esc(r.partyName)}</a>
          <span class="sub">${ch.checkNumber ? 'شماره: ' + esc(ch.checkNumber) + ' — ' : ''}سررسید: <span class="${dueCls}">${faDate(ch.dueDate)}</span>${invLink}</span>
          ${r.dueSoon && r.st.key === 'pending' ? '<span class="sub accent-rust">سررسید نزدیک (۳ روز)</span>' : ''}
        </span>
        <span class="filler"></span>
        <span class="amount" style="text-align:left;">
          ${toman(ch.amount)} ت
          <span class="sub" style="display:block;margin-top:4px;">
            <button type="button" class="btn small secondary" data-toggle-check="${esc(ch.id)}" style="padding:4px 8px;font-size:.7rem;">${r.st.label}</button>
          </span>
        </span>
      </div>`;
    }).join('');
  }

  function openNewCheckPicker() {
    if (!data.customers.length) {
      openSheet(`<h3>مشتری ندارید</h3><div class="empty">اول از بخش مشتریان، یک مشتری ثبت کنید.</div>
        <div class="btn-row"><a class="btn secondary" href="#/customers">رفتن به مشتریان</a></div>`);
      return;
    }
    const opts = data.customers.slice().sort((a,b) => (a.name || '').localeCompare(b.name || '', 'fa'))
      .map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
    openSheet(`
      <h3>ثبت چک</h3>
      <div class="field"><label>مشتری</label><select id="chk-pick-customer">${opts}</select></div>
      <div class="btn-row"><button class="btn" id="chk-pick-go">ادامه</button></div>
    `);
    document.getElementById('chk-pick-go').onclick = function () {
      const cid = document.getElementById('chk-pick-customer').value;
      closeModal();
      if (typeof openAddCheck === 'function') openAddCheck(cid);
    };
  }

  function drawChecksPage(root) {
    const chip = function (id, label) {
      return `<button type="button" class="chip ${chkFilter === id ? 'active' : ''}" data-cf="${id}">${label}</button>`;
    };
    root.innerHTML = `
      <h2 class="section-title">چک‌ها</h2>
      <div class="field"><input id="check-search" placeholder="جستجوی مشتری، شماره چک، مبلغ..." value="${esc(chkQuery)}" autocomplete="off"></div>
      <div class="chip-row" id="check-chips">
        ${chip('all','همه')}
        ${chip('pending','در جریان')}
        ${chip('cleared','وصول‌شده')}
        ${chip('dueSoon','سررسید نزدیک')}
      </div>
      <div class="field">
        <label>مرتب‌سازی</label>
        <select id="check-sort">
          <option value="dueAsc" ${chkSort === 'dueAsc' ? 'selected' : ''}>نزدیک‌ترین سررسید</option>
          <option value="dueDesc" ${chkSort === 'dueDesc' ? 'selected' : ''}>دورترین سررسید</option>
          <option value="amountDesc" ${chkSort === 'amountDesc' ? 'selected' : ''}>بیشترین مبلغ</option>
          <option value="newest" ${chkSort === 'newest' ? 'selected' : ''}>جدیدترین ثبت</option>
        </select>
      </div>
      <div id="check-summary" class="cards" style="margin-bottom:12px;"></div>
      <div class="empty" style="padding:0 0 8px;text-align:right;font-size:.78rem;">برای تغییر وضعیت وصول، روی دکمه وضعیت هر چک بزنید (همان منطق فعلی برنامه).</div>
      <div id="check-list"></div>
    `;

    const searchEl = document.getElementById('check-search');
    searchHandler = function (e) {
      chkQuery = e.target.value;
      renderCheckListOnly();
    };
    searchEl.addEventListener('input', searchHandler);

    chipHandlers = [];
    document.querySelectorAll('#check-chips [data-cf]').forEach(function (btn) {
      const fn = function () {
        chkFilter = btn.getAttribute('data-cf');
        document.querySelectorAll('#check-chips [data-cf]').forEach(function (b) {
          b.classList.toggle('active', b.getAttribute('data-cf') === chkFilter);
        });
        renderCheckListOnly();
      };
      btn.addEventListener('click', fn);
      chipHandlers.push({ el: btn, fn: fn });
    });

    const sortEl = document.getElementById('check-sort');
    sortHandler = function (e) {
      chkSort = e.target.value;
      renderCheckListOnly();
    };
    sortEl.addEventListener('change', sortHandler);

    // Delegated event for status toggle (survives list re-render)
    const listEl = document.getElementById('check-list');
    listEl.addEventListener('click', async function (e) {
      const btn = e.target.closest('[data-toggle-check]');
      if (!btn) return;
      if (btn.disabled) return;
      e.preventDefault();
      e.stopPropagation();
      const id = btn.getAttribute('data-toggle-check');
      const chk = data.checks.find(x => x.id === id);
      if (!chk) return;
      btn.disabled = true;
      const prev = chk.status;
      chk.status = chk.status === 'cleared' ? 'pending' : 'cleared';
      try {
        await saveData();
        showToast(chk.status === 'cleared' ? 'چک وصول شد' : 'چک به حالت در جریان برگشت');
        renderCheckListOnly();
      } catch (err) {
        chk.status = prev;
        try { btn.disabled = false; } catch (_e) {}
      }
    });

    renderCheckListOnly();
  }

  function mount(root, params) {
    let refreshToken = null;
    if (!root) return function () {};

    const fab = document.getElementById('fab');
    if (fab) {
      fab.style.display = 'block';
      fabHandler = function () {
        openNewCheckPicker();
      };
      fab.onclick = fabHandler;
    }
    const nav = document.getElementById('nav');
    if (nav) nav.style.display = '';

    chkQuery = '';
    chkFilter = 'all';
    chkSort = 'dueAsc';
    drawChecksPage(root);

    refreshToken = ViewHost.setRefresh(renderCheckListOnly);
    return function unmount() {
      ViewHost.clearRefresh(refreshToken);
      refreshToken = null;
      if (searchHandler) {
        const se = document.getElementById('check-search');
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
        const so = document.getElementById('check-sort');
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

  global.ChecksView = { mount: mount, unmount: function () {} };
})(typeof window !== 'undefined' ? window : this);