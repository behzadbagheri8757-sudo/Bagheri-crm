/* js/views/watches.js — SPA Watch List + Watch Detail (UX patch).
   Presentation/navigation layer only. Reads existing Watch data via the
   existing public Watch Lifecycle API (getActiveWatchOccurrences,
   reconcileWatchLifecycle, watchReasonLabel). Does NOT generate, score,
   or resolve Watches, and does NOT duplicate js/views/customer.js's
   per-customer Watch reason-recording UI.
*/
'use strict';

(function (global) {

  /* ---------- shared helpers ---------- */

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function watchesHref() {
    return '#/watches';
  }

  function watchDetailHref(occId) {
    return '#/watch?id=' + encodeURIComponent(occId || '');
  }

  function navigateToWatch(occId) {
    if (
      typeof isSpaShell === 'function' &&
      isSpaShell() &&
      typeof AppRouter !== 'undefined' &&
      AppRouter.navigate
    ) {
      AppRouter.navigate('/watch', { id: occId });
    } else {
      location.href = watchDetailHref(occId);
    }
  }

  function navigateToWatches() {
    if (
      typeof isSpaShell === 'function' &&
      isSpaShell() &&
      typeof AppRouter !== 'undefined' &&
      AppRouter.navigate
    ) {
      AppRouter.navigate('/watches');
    } else {
      location.href = watchesHref();
    }
  }

  function customerNameById(cid) {
    if (typeof data === 'undefined' || !Array.isArray(data.customers)) return '—';
    var c = data.customers.find(function (x) { return x && x.id === cid; });
    return (c && c.name) ? c.name : '—';
  }

  function productNameForOccurrence(o) {
    if (!o) return null;
    if (o.productName) return o.productName;
    if (o.productId && typeof data !== 'undefined' && Array.isArray(data.products)) {
      var p = data.products.find(function (x) { return x && x.id === o.productId; });
      if (p && p.name) return p.name;
    }
    return null;
  }

  /* Existing stored severity only — never recalculated. */
  function levelLabel(level) {
    return level === 'high' ? 'زیاد' : level === 'medium' ? 'متوسط' : level === 'low' ? 'کم' : (level || '—');
  }
  function levelColor(level) {
    return level === 'high' ? '#B3261E' : level === 'medium' ? '#C77700' : '#6B7280';
  }

  /* Local presentational label only (UI text), not a business rule.
     Falls back to the raw stored category string for anything unmapped,
     so no meaning is invented for codes not listed here. */
  function categoryLabel(cat) {
    switch (cat) {
      case 'PURCHASE_DECLINE_WATCH': return 'کاهش خرید (نشانه اولیه)';
      case 'BEHIND_PATTERN_WATCH': return 'عقب‌افتادگی از الگوی خرید (نشانه اولیه)';
      case 'BASKET_SHRINK_WATCH': return 'کوچک شدن سبد خرید (نشانه اولیه)';
      case 'KEY_PRODUCT_LOST_WATCH': return 'از دست رفتن محصول کلیدی (نشانه اولیه)';
      case 'SKU_DELAY_WATCH': return 'تأخیر در خرید کالا';
      case 'SKU_QUANTITY_DROP_WATCH': return 'کاهش مقدار خرید کالا';
      case 'SKU_FREQUENCY_DROP_WATCH': return 'کاهش تناوب خرید کالا';
      case 'LINE_DROP_WATCH': return 'کم‌رنگ شدن محصول در سبد';
      case 'COMBINED_SKU_WATCH': return 'تضعیف چند کالا با هم';
      default: return cat ? 'هشدار رفتاری' : '—';
    }
  }

  function watchReasonSheet(occurrenceId, onDone) {
    if (!occurrenceId || typeof recordWatchReason !== 'function' || typeof openSheet !== 'function') return;
    var options = (typeof WATCH_REASON_OPTIONS !== 'undefined' && Array.isArray(WATCH_REASON_OPTIONS))
      ? WATCH_REASON_OPTIONS : [];
    var optsHtml = options.map(function (o) {
      return '<button type="button" class="btn secondary small watch-reason-option" data-watch-reason="' + esc(o.code) + '">' + esc(o.label) + '</button>';
    }).join('');
    openSheet(
      '<div class="sheet-title">ثبت علت هشدار</div>' +
      '<div class="report-note watch-sheet-note">علت را ثبت کنید؛ این کار هشدار را حذف نمی‌کند.</div>' +
      '<div class="watch-reason-options">' + optsHtml + '</div>' +
      '<div class="field watch-sheet-note-field"><label>یادداشت (اختیاری)</label><input type="text" id="watch-detail-reason-note" autocomplete="off" placeholder="توضیح کوتاه..."></div>' +
      '<div class="btn-row watch-sheet-actions"><button type="button" class="btn secondary" id="watch-detail-dismiss">بستن هشدار</button><button type="button" class="btn secondary" id="watch-detail-cancel">انصراف</button></div>'
    );
    var cancel = document.getElementById('watch-detail-cancel');
    if (cancel) cancel.onclick = function () { if (typeof closeModal === 'function') closeModal(); };
    var dismiss = document.getElementById('watch-detail-dismiss');
    if (dismiss) dismiss.onclick = function () {
      if (typeof dismissWatchOccurrence !== 'function') return;
      var noteEl = document.getElementById('watch-detail-reason-note');
      try {
        dismissWatchOccurrence(occurrenceId, noteEl ? noteEl.value : '');
        if (typeof showToast === 'function') showToast('هشدار بسته شد');
      } catch (e) {
        console.error(e);
        if (typeof showToast === 'function') showToast('بستن هشدار ممکن نشد');
      }
      if (typeof closeModal === 'function') closeModal();
      if (typeof onDone === 'function') onDone();
    };
    var list = document.querySelector('.watch-reason-options');
    if (list) list.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-watch-reason]');
      if (!btn) return;
      var noteEl = document.getElementById('watch-detail-reason-note');
      try {
        recordWatchReason(occurrenceId, btn.getAttribute('data-watch-reason'), noteEl ? noteEl.value : '');
        if (typeof showToast === 'function') showToast('علت ثبت شد');
      } catch (err) {
        console.error(err);
        if (typeof showToast === 'function') showToast('ثبت علت ممکن نشد');
      }
      if (typeof closeModal === 'function') closeModal();
      if (typeof onDone === 'function') onDone();
    });
  }

  /* ---------- WatchesView (list) ---------- */

  var listRootEl = null;
  var listClickHandler = null;
  var listKeydownHandler = null;

  function faDigits(n) { return String(n).replace(/[0-9]/g, function (d) { return '۰۱۲۳۴۵۶۷۸۹'[d]; }); }

  function renderWatchList(root) {
    if (!root) return;
    var occs = [];
    if (typeof getActiveWatchOccurrences === 'function') {
      try { occs = getActiveWatchOccurrences() || []; } catch (e) { occs = []; }
    }
    if (!occs.length) {
      root.innerHTML =
        '<div class="watch-page-head"><div><h2 class="section-title">هشدارهای زودهنگام</h2><div class="watch-page-hint">مواردی که فعلاً نیاز به بررسی دارند</div></div></div>' +
        '<div class="empty watch-empty">هشدار فعالی نیست</div>';
      return;
    }

    var groups = Object.create(null), order = [];
    occs.slice().sort(function (a, b) {
      var an = customerNameById(a.customerId), bn = customerNameById(b.customerId);
      var cmp = an.localeCompare(bn, 'fa');
      return cmp || String(a.id || '').localeCompare(String(b.id || ''));
    }).forEach(function (o) {
      var key = String(o.customerId || '');
      if (!groups[key]) { groups[key] = { name: customerNameById(o.customerId), items: [] }; order.push(key); }
      groups[key].items.push(o);
    });

    var html = order.map(function (key) {
      var g = groups[key];
      var rows = g.items.map(function (o) {
        var prodName = productNameForOccurrence(o);
        var catLabel = categoryLabel(o.watchCategory);
        var reviewed = !!o.reason;
        return '<div class="watch-list-row tx-row" data-watch-id="' + esc(o.id) + '" role="link" tabindex="0">' +
          '<div class="watch-list-main">' +
            '<div class="watch-list-title tx-row-title">' + esc(prodName || catLabel) + '</div>' +
            (prodName ? '<div class="watch-list-sub">' + esc(catLabel) + '</div>' : '') +
          '</div>' +
          '<div class="watch-list-meta">' +
            '<span class="watch-severity-badge watch-severity-' + esc(o.level || 'low') + '">' + esc(levelLabel(o.level)) + '</span>' +
            '<span class="watch-reviewed-badge ' + (reviewed ? 'is-reviewed' : '') + '">' + (reviewed ? 'علت ثبت شده' : 'نیاز به بررسی') + '</span>' +
          '</div>' +
        '</div>';
      }).join('');
      return '<section class="watch-customer-group">' +
        '<div class="watch-customer-head"><span class="watch-customer-name">' + esc(g.name) + '</span><span class="watch-customer-count">' + faDigits(g.items.length) + ' مورد</span></div>' +
        '<div class="watch-customer-items">' + rows + '</div>' +
      '</section>';
    }).join('');

    root.innerHTML =
      '<div class="watch-page-head"><div><h2 class="section-title">هشدارهای زودهنگام</h2><div class="watch-page-hint">هر مورد یک نشانه است، نه لزوماً یک مشکل قطعی</div></div><span class="watch-total-count">' + faDigits(occs.length) + '</span></div>' +
      html;

    if (listClickHandler) root.removeEventListener('click', listClickHandler);
    listClickHandler = function (e) {
      var row = e.target.closest('[data-watch-id]');
      if (!row) return;
      e.preventDefault();
      navigateToWatch(row.getAttribute('data-watch-id'));
    };
    root.addEventListener('click', listClickHandler);
    if (listKeydownHandler) root.removeEventListener('keydown', listKeydownHandler);
    listKeydownHandler = function (e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      var row = e.target.closest('[data-watch-id]');
      if (!row) return;
      e.preventDefault();
      navigateToWatch(row.getAttribute('data-watch-id'));
    };
    root.addEventListener('keydown', listKeydownHandler);
  }

  function watchesMount(root, params) {
    if (!root) return function () {};
    listRootEl = root;
    var cancelled = false;

    var nav = document.getElementById('nav');
    if (nav) nav.style.display = '';

    function refresh() {
      if (cancelled) return;
      renderWatchList(root);
    }

    // Reconcile first (existing lifecycle logic; fail-open) so a direct
    // deep link to #/watches shows current data, same as the Dashboard does.
    if (typeof reconcileWatchLifecycle === 'function') {
      reconcileWatchLifecycle().then(refresh).catch(function (e) {
        console.warn('watch lifecycle reconcile failed', e);
        refresh();
      });
    } else {
      refresh();
    }

    var refreshToken = (typeof ViewHost !== 'undefined' && ViewHost.setRefresh) ? ViewHost.setRefresh(refresh) : null;

    return function unmount() {
      cancelled = true;
      if (typeof ViewHost !== 'undefined' && ViewHost.clearRefresh) ViewHost.clearRefresh(refreshToken);
      if (listClickHandler) { root.removeEventListener('click', listClickHandler); listClickHandler = null; }
      if (listKeydownHandler) { root.removeEventListener('keydown', listKeydownHandler); listKeydownHandler = null; }
      root.innerHTML = '';
      listRootEl = null;
    };
  }

  global.WatchesView = { mount: watchesMount, unmount: function () {} };

  /* ---------- WatchDetailView ---------- */

  var detailRootEl = null;
  var detailOccId = null;

  /* Public-API-only lookup: getActiveWatchOccurrences() has no id filter,
     so we search the full active list. (There is no getOccurrenceById in
     the existing public API, and private Lifecycle state is out of scope.) */
  function findActiveOccurrence(id) {
    if (!id || typeof getActiveWatchOccurrences !== 'function') return null;
    var occs = [];
    try { occs = getActiveWatchOccurrences() || []; } catch (e) { occs = []; }
    for (var i = 0; i < occs.length; i++) {
      if (occs[i] && occs[i].id === id) return occs[i];
    }
    return null;
  }

  function renderWatchDetail(root, id) {
    if (!root) return;
    var occ = null;
    try { occ = findActiveOccurrence(id); } catch (e) { occ = null; }
    if (!id || !occ) {
      root.innerHTML = '<div class="watch-page-head"><div><h2 class="section-title">جزئیات هشدار</h2></div></div><div class="empty">این هشدار پیدا نشد یا دیگر فعال نیست.</div><div class="btn-row"><a class="btn secondary" href="' + watchesHref() + '">بازگشت به هشدارها</a></div>';
      return;
    }
    var custName = customerNameById(occ.customerId), prodName = productNameForOccurrence(occ), catLabel = categoryLabel(occ.watchCategory);
    var reasonHtml = occ.reason ? '<div class="watch-detail-block"><div class="label">علت ثبت‌شده</div><div class="watch-detail-value">' + esc((typeof watchReasonLabel === 'function') ? watchReasonLabel(occ.reason.code) : occ.reason.code) + (occ.reason.comment ? ' — ' + esc(occ.reason.comment) : '') + '</div></div>' : '';
    root.innerHTML =
      '<div class="watch-detail-top"><button type="button" class="btn secondary small" data-watch-back>‹&nbsp; بازگشت به هشدارها</button></div>' +
      '<div class="card wide watch-detail-card" data-watch-open-customer="' + esc(occ.customerId) + '" role="link" tabindex="0">' +
        '<div class="watch-detail-head"><div class="watch-detail-customer"><div class="watch-detail-kicker">مشتری</div><div class="watch-detail-customer-name">' + esc(custName) + '</div></div><span class="watch-severity-badge watch-severity-' + esc(occ.level || 'low') + '">' + esc(levelLabel(occ.level)) + '</span></div>' +
        (prodName ? '<div class="watch-detail-block"><div class="label">محصول</div><div class="watch-detail-value">' + esc(prodName) + '</div></div>' : '') +
        '<div class="watch-detail-block"><div class="label">نوع هشدار</div><div class="watch-detail-value">' + esc(catLabel) + '</div></div>' +
        '<div class="watch-detail-block watch-detail-reason"><div class="label">چرا این مورد نمایش داده شده؟</div><div class="watch-detail-value">' + esc(occ.generatedReason || 'نشانه‌ای از تغییر در رفتار خرید مشاهده شده است.') + '</div></div>' +
        reasonHtml +
      '</div>' +
      '<div class="watch-detail-actions tx-actions-primary">' +
        '<button type="button" class="btn primary" data-watch-reason-open="' + esc(occ.id) + '">' + (occ.reason ? 'ویرایش علت' : 'ثبت علت') + '</button>' +
        '<button type="button" class="btn secondary" data-watch-dismiss="' + esc(occ.id) + '">بستن هشدار</button>' +
      '</div>' +
      '<div class="watch-detail-footnote">ثبت علت، هشدار را حذف نمی‌کند؛ فقط کمک می‌کند وضعیت مشتری را بهتر ثبت کنید.</div>';
  }

  function watchDetailMount(root, params) {
    if (!root) return function () {};
    detailRootEl = root;
    detailOccId = params && params.id ? params.id : null;
    var cancelled = false;

    var nav = document.getElementById('nav');
    if (nav) nav.style.display = '';

    function refresh() {
      if (cancelled) return;
      renderWatchDetail(root, detailOccId);
    }

    if (typeof reconcileWatchLifecycle === 'function') {
      reconcileWatchLifecycle().then(refresh).catch(function (e) {
        console.warn('watch lifecycle reconcile failed', e);
        refresh();
      });
    } else {
      refresh();
    }

    var refreshToken = (typeof ViewHost !== 'undefined' && ViewHost.setRefresh) ? ViewHost.setRefresh(refresh) : null;

    function onDetailClick(e) {
      var back = e.target.closest('[data-watch-back]');
      if (back) { e.preventDefault(); navigateToWatches(); return; }
      var reasonBtn = e.target.closest('[data-watch-reason-open]');
      if (reasonBtn) { e.preventDefault(); watchReasonSheet(reasonBtn.getAttribute('data-watch-reason-open'), refresh); return; }
      var dismissBtn = e.target.closest('[data-watch-dismiss]');
      if (dismissBtn) {
        e.preventDefault();
        if (typeof dismissWatchOccurrence !== 'function') return;
        try { dismissWatchOccurrence(dismissBtn.getAttribute('data-watch-dismiss'), ''); if (typeof showToast === 'function') showToast('هشدار بسته شد'); }
        catch (err) { console.error(err); if (typeof showToast === 'function') showToast('بستن هشدار ممکن نشد'); }
        navigateToWatches();
        return;
      }
      var card = e.target.closest('[data-watch-open-customer]');
      if (card && !e.target.closest('button,a')) {
        var cid = card.getAttribute('data-watch-open-customer');
        if (cid) { if (typeof isSpaShell === 'function' && isSpaShell() && typeof AppRouter !== 'undefined' && AppRouter.navigate) AppRouter.navigate('/customer', {id: cid}); else location.href = '#/customer?id=' + encodeURIComponent(cid); }
      }
    }
    root.addEventListener('click', onDetailClick);
    function onDetailKeydown(e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      var card = e.target.closest('[data-watch-open-customer]');
      if (!card) return;
      e.preventDefault();
      var cid = card.getAttribute('data-watch-open-customer');
      if (cid) { if (typeof isSpaShell === 'function' && isSpaShell() && typeof AppRouter !== 'undefined' && AppRouter.navigate) AppRouter.navigate('/customer', {id: cid}); else location.href = '#/customer?id=' + encodeURIComponent(cid); }
    }
    root.addEventListener('keydown', onDetailKeydown);

    return function unmount() {
      cancelled = true;
      if (typeof ViewHost !== 'undefined' && ViewHost.clearRefresh) ViewHost.clearRefresh(refreshToken);
      root.removeEventListener('click', onDetailClick);
      root.removeEventListener('keydown', onDetailKeydown);
      root.innerHTML = '';
      detailRootEl = null;
      detailOccId = null;
    };
  }

  global.WatchDetailView = { mount: watchDetailMount, unmount: function () {} };

})(typeof window !== 'undefined' ? window : this);
