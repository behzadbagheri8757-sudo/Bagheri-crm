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
    AppRouter.navigate('/watch', { id: occId });
  }

  function navigateToWatches() {
    AppRouter.navigate('/watches');
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

  /* Level 0: one human sentence. Level 2: raw evidence lines inside a single «جزئیات»
     disclosure (nothing is dropped — it just no longer sits on the first level).
     Both come from js/app.js → BagheriPresent (presentation only). */
  function humanSentence(o) {
    var P = global.BagheriPresent;
    if (P) return P.watchSentence(o);
    return (o && o.generatedReason) || '';
  }

  function watchEvidenceText(o) {
    var P = global.BagheriPresent;
    return P ? P.detailsHtml(P.watchDetailLines(o)) : '';
  }

  /* Existing stored severity only — never recalculated. */
  function levelLabel(level) {
    return level === 'high' ? 'زیاد' : level === 'medium' ? 'متوسط' : level === 'low' ? 'کم' : (level || '—');
  }
  function levelColor(level) {
    return level === 'high' ? '#B3261E' : level === 'medium' ? '#C77700' : '#6B7280';
  }

  /* Human label for the watch type (presentation text only; falls back to a neutral phrase). */
  function categoryLabel(cat) {
    var P = global.BagheriPresent;
    return P ? P.watchLabel(cat) : (cat ? 'تغییر در رفتار خرید' : '—');
  }

  function watchReasonSheet(occurrenceId, onDone) {
    if (!occurrenceId || typeof recordWatchReason !== 'function' || typeof openSheet !== 'function') return;
    var options = (typeof getWatchResponseOptions === 'function')
      ? getWatchResponseOptions(occurrenceId)
      : ((typeof WATCH_REASON_OPTIONS !== 'undefined' && Array.isArray(WATCH_REASON_OPTIONS)) ? WATCH_REASON_OPTIONS : []);
    var optsHtml = options.map(function (o) {
      return '<button type="button" class="btn secondary small watch-reason-option" data-watch-reason="' + esc(o.code) + '">' + esc(o.label) + '</button>';
    }).join('');
    openSheet(
      '<div class="sheet-title">ثبت علت هشدار</div>' +
      '<div class="report-note watch-sheet-note">سه پاسخ اول هشدار را می‌بندند و همان مورد را فوراً برنمی‌گردانند؛ سایر علت‌ها فقط ثبت می‌شوند.</div>' +
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

  /* ---------- Filters (Watches page) ----------
     همه‌ی فیلترها فقط «نمایش» را محدود می‌کنند؛ هیچ Watch ای ساخته/تغییر داده نمی‌شود.
       attention : هشدارهای فعال با شدت «زیاد» (همان سطح ذخیره‌شده؛ بازمحاسبه نمی‌شود)
       unvisited : هشدارهای فعالِ مشتری‌ای که هنوز هیچ ویزیتی برایش ثبت نشده
       check_due : هشدارهای فعالِ مشتری‌ای که چک وصول‌نشده‌ی معوق یا تا ۳ روز آینده دارد
                   (همان تعریف صفحه‌ی چک‌ها: فقط status==='cleared' تسویه است)
       followup  : خودِ موردهایی که فروشنده «بعداً پیگیری می‌کنم» زده — این‌ها status فعال
                   ندارند و در فهرست عادی نیستند، پس فهرستشان جداست و ردیف‌هایشان به
                   صفحه‌ی مشتری می‌رود (جزئیات هشدار فقط برای هشدار فعال کار می‌کند). */
  var WATCH_FILTERS = [
    { id: 'all',       label: 'همه' },
    { id: 'attention', label: 'نیازمند توجه' },
    { id: 'unvisited', label: 'ندیده‌شده' },
    { id: 'check_due', label: 'چک سررسید' },
    { id: 'followup',  label: 'پیگیری باز' }
  ];
  var WATCH_FILTER_HINTS = {
    all: 'هر مورد یک نشانه است، نه لزوماً یک مشکل قطعی',
    attention: 'هشدارهایی که شدتشان «زیاد» است',
    unvisited: 'مشتریانی که هنوز ویزیت نشده‌اند',
    check_due: 'مشتریانی که چک معوق یا نزدیک سررسید دارند',
    followup: 'مواردی که قرار شد بعداً پیگیری کنی'
  };
  var watchFilter = 'all';

  function isActiveCustomer(cid) {
    if (typeof data === 'undefined' || !Array.isArray(data.customers)) return false;
    var c = data.customers.find(function (x) { return x && x.id === cid; });
    return !!c && c.active !== false;
  }

  /* مشتری‌هایی که چک وصول‌نشده‌ی معوق/تا ۳ روز آینده دارند (نیمه‌شب محلی، مثل صفحه‌ی چک‌ها). */
  function customerIdsWithCheckDue() {
    var ids = Object.create(null);
    if (typeof data === 'undefined' || !Array.isArray(data.checks)) return ids;
    var todayMs = new Date(todayISO() + 'T00:00:00').getTime();
    data.checks.forEach(function (ch) {
      if (!ch || ch.status === 'cleared' || !ch.dueDate || !ch.customerId) return;
      var dueMs = new Date(String(ch.dueDate).slice(0, 10) + 'T00:00:00').getTime();
      if (!isFinite(dueMs)) return;
      if (Math.round((dueMs - todayMs) / 86400000) <= 3) ids[ch.customerId] = true;
    });
    return ids;
  }

  function customerIdsNeverVisited() {
    var ids = Object.create(null);
    if (typeof data === 'undefined' || !Array.isArray(data.customers)) return ids;
    data.customers.forEach(function (c) {
      if (c && !(Array.isArray(c.visits) && c.visits.length)) ids[c.id] = true;
    });
    return ids;
  }

  function buildFilterSets(occs) {
    var dueIds = customerIdsWithCheckDue();
    var unvisitedIds = customerIdsNeverVisited();
    var followUps = [];
    if (typeof getPendingWatchFollowUps === 'function') {
      try {
        followUps = (getPendingWatchFollowUps() || []).filter(function (o) { return o && isActiveCustomer(o.customerId); });
      } catch (e) { followUps = []; }
    }
    return {
      all: occs,
      attention: occs.filter(function (o) { return o.level === 'high'; }),
      unvisited: occs.filter(function (o) { return !!unvisitedIds[o.customerId]; }),
      check_due: occs.filter(function (o) { return !!dueIds[o.customerId]; }),
      followup: followUps
    };
  }

  function filtersHtml(sets) {
    return '<div class="bp-watch-filters" id="watch-filters" role="group" aria-label="فیلتر هشدارها">' +
      WATCH_FILTERS.map(function (f) {
        var n = sets[f.id].length;
        var on = watchFilter === f.id;
        return '<button type="button" class="chip bp-watch-chip' + (on ? ' active' : '') + (n === 0 && !on ? ' is-zero' : '') + '"' +
          ' data-watch-filter="' + f.id + '" aria-pressed="' + (on ? 'true' : 'false') + '">' +
          '<span class="bp-watch-chip-label">' + f.label + '</span>' +
          '<span class="bp-watch-chip-count">' + faDigits(n) + '</span>' +
        '</button>';
      }).join('') +
    '</div>';
  }

  function renderWatchList(root) {
    if (!root) return;
    var occs = [];
    if (typeof getActiveWatchOccurrences === 'function') {
      try { occs = getActiveWatchOccurrences() || []; } catch (e) { occs = []; }
    }
    var sets = buildFilterSets(occs);
    if (!sets.all.length && !sets.followup.length) {
      root.innerHTML =
        '<div class="watch-page-head"><div><h2 class="section-title">هشدارهای زودهنگام</h2><div class="watch-page-hint">مواردی که فعلاً نیاز به بررسی دارند</div></div></div>' +
        '<div class="empty watch-empty">هشدار فعالی نیست</div>';
      return;
    }

    var isFollowUp = watchFilter === 'followup';
    var shown = sets[watchFilter] || sets.all;

    var groups = Object.create(null), order = [];
    shown.slice().sort(function (a, b) {
      var an = customerNameById(a.customerId), bn = customerNameById(b.customerId);
      var cmp = an.localeCompare(bn, 'fa');
      return cmp || String(a.id || '').localeCompare(String(b.id || ''));
    }).forEach(function (o) {
      var key = String(o.customerId || '');
      if (!groups[key]) { groups[key] = { cid: o.customerId, name: customerNameById(o.customerId), items: [] }; order.push(key); }
      groups[key].items.push(o);
    });

    var html = order.map(function (key) {
      var g = groups[key];
      var rows = g.items.map(function (o) {
        var prodName = productNameForOccurrence(o);
        var catLabel = categoryLabel(o.watchCategory);
        var sentence = humanSentence(o);
        var reviewed = !!o.reason;
        var target = isFollowUp
          ? ' data-watch-customer="' + esc(o.customerId) + '"'
          : ' data-watch-id="' + esc(o.id) + '"';
        return '<div class="watch-list-row tx-row"' + target + ' role="link" tabindex="0">' +
          '<div class="watch-list-main">' +
            '<div class="watch-list-title tx-row-title">' + esc(prodName || catLabel) + '</div>' +
            (sentence ? '<div class="watch-list-text">' + esc(sentence) + '</div>' : '') +
          '</div>' +
          '<div class="watch-list-meta">' +
            '<span class="watch-severity-badge watch-severity-' + esc(o.level || 'low') + '">' + esc(levelLabel(o.level)) + '</span>' +
            (reviewed && !isFollowUp ? '<span class="watch-reviewed-badge is-reviewed">علت ثبت شده</span>' : '') +
          '</div>' +
        '</div>';
      }).join('');
      return '<section class="watch-customer-group">' +
        '<div class="watch-customer-head"><span class="watch-customer-name">' + esc(g.name) + '</span><span class="watch-customer-count">' + faDigits(g.items.length) + ' مورد</span></div>' +
        '<div class="watch-customer-items">' + rows + '</div>' +
      '</section>';
    }).join('');

    if (!shown.length) {
      html = '<div class="empty watch-empty">' + (watchFilter === 'all' ? 'هشدار فعالی نیست' : 'موردی با این فیلتر پیدا نشد') + '</div>';
    }

    var prevBar = root.querySelector('#watch-filters');
    var prevScroll = prevBar ? prevBar.scrollLeft : 0;

    root.innerHTML =
      '<div class="watch-page-head"><div><h2 class="section-title">هشدارهای زودهنگام</h2><div class="watch-page-hint">' + esc(WATCH_FILTER_HINTS[watchFilter] || WATCH_FILTER_HINTS.all) + '</div></div><span class="watch-total-count">' + faDigits(shown.length) + '</span></div>' +
      filtersHtml(sets) +
      html;

    var bar = root.querySelector('#watch-filters');
    if (bar) {
      if (prevScroll) bar.scrollLeft = prevScroll;
      // چیپ فعال همیشه در دید باشد (مثلاً با ورود از لینک ?filter=followup)
      var activeChip = bar.querySelector('.chip.active');
      if (activeChip && !prevScroll && typeof activeChip.scrollIntoView === 'function') {
        try { activeChip.scrollIntoView({ block: 'nearest', inline: 'center' }); } catch (eS) {}
      }
    }

    function go(el) {
      var chipEl = el.closest('[data-watch-filter]');
      if (chipEl) {
        var next = chipEl.getAttribute('data-watch-filter');
        if (next && next !== watchFilter) { watchFilter = next; renderWatchList(root); }
        return true;
      }
      var row = el.closest('[data-watch-id]');
      if (row) { navigateToWatch(row.getAttribute('data-watch-id')); return true; }
      var crow = el.closest('[data-watch-customer]');
      if (crow) { AppRouter.navigate('/customer', { id: crow.getAttribute('data-watch-customer') }); return true; }
      return false;
    }

    if (listClickHandler) root.removeEventListener('click', listClickHandler);
    listClickHandler = function (e) {
      if (go(e.target)) e.preventDefault();
    };
    root.addEventListener('click', listClickHandler);
    if (listKeydownHandler) root.removeEventListener('keydown', listKeydownHandler);
    listKeydownHandler = function (e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      if (go(e.target)) e.preventDefault();
    };
    root.addEventListener('keydown', listKeydownHandler);
  }

  function watchesMount(root, params) {
    if (!root) return function () {};
    listRootEl = root;
    var cancelled = false;

    var incomingWatchFilter = params && params.filter;
    watchFilter = WATCH_FILTERS.some(function (f) { return f.id === incomingWatchFilter; }) ? incomingWatchFilter : 'all';

    var nav = document.getElementById('nav');
    if (nav) nav.style.display = '';
    var ctx = typeof createComputationContext === 'function'
      ? createComputationContext({ data: data })
      : null;

    function refresh() {
      if (cancelled) return;
      ctx = typeof createComputationContext === 'function'
        ? createComputationContext({ data: data })
        : null;
      renderWatchList(root);
    }

    // Reconcile first (existing lifecycle logic; fail-open) so a direct
    // deep link to #/watches shows current data, same as the Dashboard does.
    if (typeof reconcileWatchLifecycle === 'function') {
      reconcileWatchLifecycle(null, ctx).then(refresh).catch(function (e) {
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
    var custName = customerNameById(occ.customerId), prodName = productNameForOccurrence(occ), catLabel = categoryLabel(occ.watchCategory), sentence = humanSentence(occ);
    var reasonHtml = occ.reason ? '<div class="watch-detail-block"><div class="label">علت ثبت‌شده</div><div class="watch-detail-value">' + esc((typeof watchReasonLabel === 'function') ? watchReasonLabel(occ.reason.code) : occ.reason.code) + (occ.reason.comment ? ' — ' + esc(occ.reason.comment) : '') + '</div></div>' : '';
    root.innerHTML =
      '<div class="watch-detail-top"><button type="button" class="btn secondary small" data-watch-back>‹&nbsp; بازگشت به هشدارها</button></div>' +
      '<div class="card wide watch-detail-card" data-watch-open-customer="' + esc(occ.customerId) + '" role="link" tabindex="0">' +
        '<div class="watch-detail-head"><div class="watch-detail-customer"><div class="watch-detail-kicker">مشتری</div><div class="watch-detail-customer-name">' + esc(custName) + '</div></div><span class="watch-severity-badge watch-severity-' + esc(occ.level || 'low') + '">' + esc(levelLabel(occ.level)) + '</span></div>' +
        (prodName ? '<div class="watch-detail-block"><div class="label">محصول</div><div class="watch-detail-value">' + esc(prodName) + '</div></div>' : '') +
        '<div class="watch-detail-block"><div class="label">موضوع</div><div class="watch-detail-value">' + esc(catLabel) + '</div></div>' +
        '<div class="watch-detail-block watch-detail-reason"><div class="label">چرا نمایش داده شده؟</div><div class="watch-detail-value">' + esc(sentence || 'نشانه‌ای از تغییر در رفتار خرید مشاهده شده است.') + '</div></div>' +
        reasonHtml +
        watchEvidenceText(occ) +
      '</div>' +
      '<div class="watch-detail-actions tx-actions-primary">' +
        '<button type="button" class="btn primary" data-watch-reason-open="' + esc(occ.id) + '">' + (occ.reason ? 'ویرایش علت' : 'ثبت علت') + '</button>' +
        '<button type="button" class="btn secondary" data-watch-dismiss="' + esc(occ.id) + '">بستن هشدار</button>' +
      '</div>' +
      '<div class="watch-detail-footnote">علت‌های «قیمت»، «رقیب» و مانند آن فقط ثبت می‌شوند؛ «هنوز موجودی دارد»، «این محصول را نمی‌خواهد» و «بعداً پیگیری می‌کنم» هشدار را می‌بندند.</div>';
  }

  function watchDetailMount(root, params) {
    if (!root) return function () {};
    detailRootEl = root;
    detailOccId = params && params.id ? params.id : null;
    var cancelled = false;

    var nav = document.getElementById('nav');
    if (nav) nav.style.display = '';
    var ctx = typeof createComputationContext === 'function'
      ? createComputationContext({ data: data })
      : null;

    function refresh() {
      if (cancelled) return;
      ctx = typeof createComputationContext === 'function'
        ? createComputationContext({ data: data })
        : null;
      renderWatchDetail(root, detailOccId);
    }

    if (typeof reconcileWatchLifecycle === 'function') {
      reconcileWatchLifecycle(null, ctx).then(refresh).catch(function (e) {
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
      if (reasonBtn) { e.preventDefault(); watchReasonSheet(reasonBtn.getAttribute('data-watch-reason-open'), function () {
        // A closing decision leaves nothing active to show here -> back to the list.
        if (findActiveOccurrence(detailOccId)) refresh(); else navigateToWatches();
      }); return; }
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
        if (cid) { AppRouter.navigate('/customer', {id: cid}); }
      }
    }
    root.addEventListener('click', onDetailClick);
    function onDetailKeydown(e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      var card = e.target.closest('[data-watch-open-customer]');
      if (!card) return;
      e.preventDefault();
      var cid = card.getAttribute('data-watch-open-customer');
      if (cid) { AppRouter.navigate('/customer', {id: cid}); }
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
