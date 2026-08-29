/* js/views/products.js — SPA Products view (Phase 3).
   Extracted from products.html. Preserves search/filter/sort and openAddProduct.
*/
'use strict';

(function (global) {
  let prodQuery = '';
  let prodFilter = 'all';
  let prodSort = 'name';
  let searchHandler = null;
  let sortHandler = null;
  let chipHandlers = [];
  let listClickHandler = null;
  function productStatus(p) {
    const q = Number(p.stockQty) || 0;
    const min = Number(p.minStock) || 0;
    if (q < 0) return { key: 'neg', label: 'موجودی منفی', cls: 'accent-red' };
    if (q === 0) return { key: 'zero', label: 'ناموجود', cls: 'accent-rust' };
    if (min > 0 && q <= min) return { key: 'low', label: 'کم‌موجود', cls: 'accent-amber' };
    return { key: 'ok', label: 'موجود', cls: 'accent-olive' };
  }

  function productValue(p) {
    if (typeof productInventoryValue === 'function') return productInventoryValue(p.id);
    return (Number(p.stockQty) || 0) * (Number(p.buy) || 0);
  }

  function renderProductListOnly() {
    const list = document.getElementById('product-list');
    if (!list) return;

    let rows = (data.products || []).slice();
    const q = (prodQuery || '').trim().toLowerCase();
    if (q) {
      rows = rows.filter(function (p) {
        return (
          (p.name || '').toLowerCase().includes(q) ||
          (p.category || '').toLowerCase().includes(q)
        );
      });
    }

    rows = rows.map(function (p) {
      return { p: p, st: productStatus(p), val: productValue(p) };
    });

    if (prodFilter === 'in')
      rows = rows.filter(function (x) {
        return (Number(x.p.stockQty) || 0) > 0;
      });
    else if (prodFilter === 'low')
      rows = rows.filter(function (x) {
        return x.st.key === 'low';
      });
    else if (prodFilter === 'zero')
      rows = rows.filter(function (x) {
        return x.st.key === 'zero';
      });
    else if (prodFilter === 'neg')
      rows = rows.filter(function (x) {
        return x.st.key === 'neg';
      });

    if (prodSort === 'stockDesc')
      rows.sort(function (a, b) {
        return (b.p.stockQty || 0) - (a.p.stockQty || 0);
      });
    else if (prodSort === 'stockAsc')
      rows.sort(function (a, b) {
        return (a.p.stockQty || 0) - (b.p.stockQty || 0);
      });
    else if (prodSort === 'valueDesc')
      rows.sort(function (a, b) {
        return b.val - a.val;
      });
    else
      rows.sort(function (a, b) {
        return (a.p.name || '').localeCompare(b.p.name || '', 'fa');
      });

    if (!rows.length) {
      list.innerHTML =
        '<div class="empty">' +
        ((data.products || []).length
          ? 'موردی پیدا نشد'
          : 'هنوز کالایی ثبت نشده. با + کالا اضافه کنید.') +
        '</div>';
    } else {
      list.innerHTML = rows
        .map(function (x) {
          const p = x.p;
          const st = x.st;
          const val = x.val;
          const unit = p.packageWeight ? 'بسته ' + p.packageWeight : 'عدد';
          const inactive = p.active === false ? ' <span class="badge">غیرفعال</span>' : '';
          return (
            '<div class="ledger-row" data-edit-product="' +
            esc(p.id) +
            '" style="cursor:pointer;">' +
            '<span class="name">' +
            esc(p.name) +
            inactive +
            '<span class="sub">' +
            esc(p.category || '—') +
            ' — واحد: ' +
            esc(String(unit)) +
            ' — خرید: ' +
            toman(p.buy) +
            ' / فروش: ' +
            toman(p.retail || p.sell || 0) +
            '</span>' +
            '<span class="sub ' +
            st.cls +
            '">' +
            st.label +
            (st.key === 'low' && p.minStock ? ' (حداقل ' + p.minStock + ')' : '') +
            '</span></span>' +
            '<span class="filler"></span>' +
            '<span class="amount">' +
            (p.stockQty || 0) +
            '<span class="sub" style="display:block;">ارزش: ' +
            toman(val) +
            ' ت</span></span></div>'
          );
        })
        .join('');
    }
  }

  function drawProductsPage(root) {
    const invHref = '#/inventory';
    const chip = function (id, label) {
      return (
        '<button type="button" class="chip ' +
        (prodFilter === id ? 'active' : '') +
        '" data-pf="' +
        id +
        '">' +
        label +
        '</button>'
      );
    };
    root.innerHTML =
      '<h2 class="section-title">کالا و اجناس</h2>' +
      '<div class="btn-row" style="margin-bottom:10px;">' +
      '<a class="btn secondary small" href="' +
      invHref +
      '">مشاهده انبار</a></div>' +
      '<div class="field"><input id="product-search" placeholder="جستجوی نام یا دسته‌بندی..." value="' +
      esc(prodQuery) +
      '" autocomplete="off"></div>' +
      '<div class="chip-row" id="product-chips">' +
      chip('all', 'همه') +
      chip('in', 'موجود') +
      chip('low', 'کم‌موجود') +
      chip('zero', 'ناموجود') +
      chip('neg', 'منفی') +
      '</div>' +
      '<div class="field"><label>مرتب‌سازی</label>' +
      '<select id="product-sort">' +
      '<option value="name"' +
      (prodSort === 'name' ? ' selected' : '') +
      '>نام</option>' +
      '<option value="stockDesc"' +
      (prodSort === 'stockDesc' ? ' selected' : '') +
      '>بیشترین موجودی</option>' +
      '<option value="stockAsc"' +
      (prodSort === 'stockAsc' ? ' selected' : '') +
      '>کمترین موجودی</option>' +
      '<option value="valueDesc"' +
      (prodSort === 'valueDesc' ? ' selected' : '') +
      '>ارزش موجودی</option>' +
      '</select></div>' +
      '<div id="product-list"></div>';

    const searchEl = document.getElementById('product-search');
    searchHandler = function (e) {
      prodQuery = e.target.value;
      renderProductListOnly();
    };
    searchEl.addEventListener('input', searchHandler);

    chipHandlers = [];
    document.querySelectorAll('#product-chips [data-pf]').forEach(function (btn) {
      const fn = function () {
        prodFilter = btn.getAttribute('data-pf');
        document.querySelectorAll('#product-chips [data-pf]').forEach(function (b) {
          b.classList.toggle('active', b.getAttribute('data-pf') === prodFilter);
        });
        renderProductListOnly();
      };
      btn.addEventListener('click', fn);
      chipHandlers.push({ el: btn, fn: fn });
    });

    const sortEl = document.getElementById('product-sort');
    sortHandler = function (e) {
      prodSort = e.target.value;
      renderProductListOnly();
    };
    sortEl.addEventListener('change', sortHandler);

    const list = document.getElementById('product-list');
    listClickHandler = function (e) {
      const row = e.target.closest('[data-edit-product]');
      if (!row) return;
      if (typeof openAddProduct === 'function') openAddProduct(row.getAttribute('data-edit-product'));
    };
    list.addEventListener('click', listClickHandler);

    renderProductListOnly();
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

    prodQuery = '';
    prodFilter = 'all';
    prodSort = 'name';
    drawProductsPage(root);

    refreshToken = ViewHost.setRefresh(renderProductListOnly);

    // openAddProduct calls render() after save — bind to list-only refresh



    return function unmount() {
      ViewHost.clearRefresh(refreshToken);
      refreshToken = null;
      if (searchHandler) {
        const se = document.getElementById('product-search');
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
        const so = document.getElementById('product-sort');
        if (so) so.removeEventListener('change', sortHandler);
      }
      sortHandler = null;
      if (listClickHandler) {
        const list = document.getElementById('product-list');
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

  global.ProductsView = { mount: mount, unmount: function () {} };
})(typeof window !== 'undefined' ? window : this);
