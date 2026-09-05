/* js/views/inventory.js — SPA Inventory view (Phase 3).
   Extracted from inventory.html. Uses inventoryValue/lowStockProducts/stockLog as-is.
*/
'use strict';

(function (global) {
  let listClickHandler = null;
  function invStatus(p) {
    const q = Number(p.stockQty) || 0;
    const min = Number(p.minStock) || 0;
    if (q < 0) return { label: 'منفی', cls: 'accent-red' };
    if (q === 0) return { label: 'ناموجود', cls: 'accent-rust' };
    if (min > 0 && q <= min) return { label: 'کم', cls: 'accent-amber' };
    return { label: 'کافی', cls: 'accent-olive' };
  }

  function stockTypeLabel(type) {
    const map = {
      in: 'ورود',
      out: 'خروج',
      sale: 'فروش (فاکتور)',
      return: 'برگشت فروش',
      adjust: 'اصلاح دستی'
    };
    return map[type] || type || 'حرکت';
  }

  function collectStockLog(limit) {
    const items = [];
    (data.products || []).forEach(function (p) {
      (p.stockLog || []).forEach(function (l) {
        items.push({
          productId: p.id,
          name: p.name,
          date: l.date,
          type: l.type,
          qty: l.qty,
          note: l.note || ''
        });
      });
    });
    items.sort(function (a, b) {
      return (b.date || '').localeCompare(a.date || '');
    });
    return items.slice(0, limit || 40);
  }

  function drawInventoryPage(root) {
    const products = (data.products || []).slice().sort(function (a, b) {
      return (a.name || '').localeCompare(b.name || '', 'fa');
    });
    const totalVal = inventoryValue();
    const zeroN = products.filter(function (p) {
      return (Number(p.stockQty) || 0) === 0;
    }).length;
    const negN = products.filter(function (p) {
      return (Number(p.stockQty) || 0) < 0;
    }).length;
    const lowList = lowStockProducts();
    const lowN = lowList.length;
    const logRows = collectStockLog(40);

    const stockList =
      products
        .slice()
        .sort(function (a, b) {
          const aOff = a.active === false ? 1 : 0;
          const bOff = b.active === false ? 1 : 0;
          if (aOff !== bOff) return aOff - bOff;
          return (a.name || '').localeCompare(b.name || '', 'fa');
        })
        .map(function (p) {
          const st = invStatus(p);
          const val = (typeof productInventoryValue === 'function') ? productInventoryValue(p.id) : (Number(p.stockQty) || 0) * (Number(p.buy) || 0);
          const unit = p.packageWeight ? 'بسته ' + p.packageWeight : 'عدد';
          const qtyCls = (Number(p.stockQty) || 0) < 0 ? 'accent-red' : '';
          const isOff = p.active === false;
          // Visual-only: dim row + compact OFF badge. No behavior change.
          const inactiveBadge = isOff
            ? ' <span class="badge pending" style="display:inline-block;vertical-align:middle;font-size:.72em;padding:1px 7px;margin-right:4px;opacity:1;">غیرفعال</span>'
            : '';
          const offStyle = isOff
            ? 'cursor:pointer;opacity:.42;filter:grayscale(.35);'
            : 'cursor:pointer;';
          return (
            '<div class="ledger-row" data-edit-product="' +
            esc(p.id) +
            '" style="' +
            offStyle +
            '">' +
            '<span class="name">' +
            esc(p.name) +
            inactiveBadge +
            '<span class="sub">واحد: ' +
            esc(String(unit)) +
            ' — <span class="' +
            st.cls +
            '">' +
            st.label +
            '</span>' +
            (p.minStock ? ' — حداقل ' + p.minStock : '') +
            '</span></span>' +
            '<span class="filler"></span>' +
            '<span class="amount ' +
            qtyCls +
            '">' +
            (p.stockQty || 0) +
            '<span class="sub" style="display:block;">' +
            toman(val) +
            ' ت</span></span></div>'
          );
        })
        .join('') || '<div class="empty">کالایی ثبت نشده</div>';

    const logHtml = logRows.length
      ? logRows
          .map(function (l) {
            const qty = Number(l.qty) || 0;
            const signCls = qty < 0 ? 'accent-red' : 'accent-olive';
            return (
              '<div class="ledger-row"><span class="name">' +
              esc(l.name) +
              '<span class="sub">' +
              faDate(l.date) +
              ' — ' +
              esc((l.type === 'sale' && /فروش \(فاکتور[^)]*null[^)]*\)/.test(String(l.note || ''))) ? 'فروش (فاکتور)' : stockTypeLabel(l.type)) +
              (l.note && !(l.type === 'sale' && /null/.test(String(l.note))) ? ' — ' + esc(l.note) : '') +
              '</span></span><span class="filler"></span>' +
              '<span class="amount ' +
              signCls +
              '">' +
              (qty > 0 ? '+' + qty : qty) +
              '</span></div>'
            );
          })
          .join('')
      : '<div class="empty">هنوز گردش موجودی ثبت نشده</div>';

    const prodHref = '#/products';

    root.innerHTML =
      '<h2 class="section-title">موجودی انبار</h2>' +
      '<div class="btn-row" style="margin-bottom:10px;">' +
      '<a class="btn secondary small" href="' +
      prodHref +
      '">مدیریت کالاها</a></div>' +
      '<div class="cards" style="margin-bottom:14px;">' +
      '<div class="card"><div class="label">تعداد کالا</div><div class="value">' +
      products.length +
      '</div></div>' +
      '<div class="card"><div class="label">ارزش کل موجودی</div><div class="value">' +
      toman(totalVal) +
      ' ت</div></div>' +
      '<div class="card"><div class="label">ناموجود</div><div class="value accent-rust">' +
      zeroN +
      '</div></div>' +
      '<div class="card"><div class="label">کم‌موجود</div><div class="value accent-amber">' +
      lowN +
      '</div></div>' +
      (negN
        ? '<div class="card wide"><div class="label">هشدار موجودی منفی</div><div class="value accent-red">' +
          negN +
          ' کالا</div></div>'
        : '') +
      '</div>' +
      '<h3 class="sub-title">موجودی کالاها</h3>' +
      '<div class="empty" style="padding:0 0 8px;text-align:right;font-size:.78rem;">برای اصلاح موجودی روی هر کالا بزنید (همان فرم فعلی ورود/خروج/ویرایش).</div>' +
      stockList +
      '<h3 class="sub-title">گردش اخیر انبار</h3>' +
      logHtml;

    listClickHandler = function (e) {
      const row = e.target.closest('[data-edit-product]');
      if (!row) return;
      if (typeof openAddProduct === 'function') openAddProduct(row.getAttribute('data-edit-product'));
    };
    root.addEventListener('click', listClickHandler);
  }

  function mount(root, params) {
    let refreshToken = null;
    if (!root) return function () {};
    const fab = document.getElementById('fab');
    if (fab) {
      fab.style.display = 'block';
      fab.onclick = function () {
        if (typeof openAddProduct === 'function') openAddProduct();
      };
    }
    const nav = document.getElementById('nav');
    if (nav) nav.style.display = '';

    drawInventoryPage(root);

    refreshToken = ViewHost.setRefresh((()=>{ if(listClickHandler){ try{root.removeEventListener('click', listClickHandler);}catch(e){} listClickHandler=null;} drawInventoryPage(root); }));



    return function unmount() {
      ViewHost.clearRefresh(refreshToken);
      refreshToken = null;
      if (listClickHandler) {
        try {
          root.removeEventListener('click', listClickHandler);
        } catch (e) {}
      }
      listClickHandler = null;
      if (fab) {
        fab.style.display = 'none';
        fab.onclick = null;
      }
      root.innerHTML = '';
    };
  }

  global.InventoryView = { mount: mount, unmount: function () {} };
})(typeof window !== 'undefined' ? window : this);
