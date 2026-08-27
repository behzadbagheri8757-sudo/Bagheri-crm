/* js/views/prospect.js — SPA Prospect detail view (Phase 8).
   Extracted from prospect.html. Reuses prospectState, PROSPECT_QUESTIONS,
   PROSPECT_RANK_INFO, PROSPECT_VISIT_TAGS, prospectRouteName,
   prospectNeighborhoodName, prospectFaDate, prospectFaDateTime,
   convertProspectToCustomer, PROSPECT_SCORING_VERSION.
   No new financial logic.
*/
'use strict';

(function (global) {
  let currentProspectId = null;
  let rootEl = null;
  function rankPill(rank) {
    const info = PROSPECT_RANK_INFO[rank] || PROSPECT_RANK_INFO['D'];
    return `<span class="rank-pill" style="background:${info.color}">${esc(rank)}</span>`;
  }

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

  function navigateToEvaluation(shopId) {
    if (
      typeof isSpaShell === 'function' &&
      isSpaShell() &&
      typeof AppRouter !== 'undefined' &&
      AppRouter.navigate
    ) {
      AppRouter.navigate('/evaluation', { shopId: shopId });
    } else {
      location.href = '#/evaluation?shopId=' + encodeURIComponent(shopId);
    }
  }

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

  function drawProspectDetail(root) {
    if (!root) return;
    const id = currentProspectId;

    if (!id) {
      root.innerHTML = `<div class="empty">شناسه مشخص نیست</div><a class="btn secondary" href="#/prospects">بازگشت</a>`;
      return;
    }
    const shop = prospectState.shops.find(s => s.id === id);
    if (!shop) {
      root.innerHTML = `<div class="empty">مغازه پیدا نشد</div><a class="btn secondary" href="#/prospects">بازگشت</a>`;
      return;
    }

    const last = shop.visits.length ? shop.visits[shop.visits.length - 1] : null;
    const info = PROSPECT_RANK_INFO[shop.latestRank] || PROSPECT_RANK_INFO['D'];

    let answersHtml = '';
    if (last) {
      answersHtml = PROSPECT_QUESTIONS.map(q => {
        const opt = q.options.find(o => o.key === last.answers[q.id]);
        return `<div class="answer-row"><span class="q">${esc(q.label)}</span><span class="a">${opt ? esc(opt.label) : '—'}</span></div>`;
      }).join('');
    }

    const visitRows = shop.visits.slice().reverse().map(v => {
      const tags = (v.tags || []).map(tk => {
        const t = PROSPECT_VISIT_TAGS.find(x => x.key === tk);
        return t ? t.label : tk;
      }).join('، ');
      return `<div class="ledger-row" style="cursor:default;">
        <span class="name">${prospectFaDateTime(v.date)}
          <span class="sub">${tags ? esc(tags) : 'بدون برچسب'}</span>
        </span>
        <span class="filler"></span>
        <span class="amount">${v.score} ${rankPill(v.rank)}</span>
      </div>`;
    }).join('') || '<div class="empty">ویزیتی ثبت نشده</div>';

    root.innerHTML = `
      <div class="btn-row" style="margin-bottom:10px;">
        <a class="btn secondary small" href="#/prospects">← لیست مغازه‌ها</a>
      </div>
      ${shop.status === 'converted' ? `<div class="converted-banner">✅ این مغازه به مشتری تبدیل شده است.</div>` : ''}
      <div class="card" style="margin-bottom:12px;">
        <div style="font-size:1.2rem;font-weight:800;">${esc(shop.name)}</div>
        <div style="font-size:.88rem;margin-top:6px;line-height:1.7;">
          <div>مسیر: ${esc(prospectRouteName(shop.routeId))}</div>
          <div>محله: ${esc(prospectNeighborhoodName(shop.routeId, shop.neighborhoodId))}</div>
          <div style="margin-top:8px;">امتیاز: <b>${shop.latestScore}</b> ${rankPill(shop.latestRank)}</div>
          <div class="sub" style="margin-top:4px;">${esc(info.desc)}</div>
        </div>
      </div>
      <div class="btn-row" style="margin-bottom:14px;">
        <button type="button" class="btn small" id="btn-add-visit">ثبت ویزیت / ارزیابی جدید</button>
        ${shop.status !== 'converted'
          ? `<button type="button" class="btn small secondary" id="btn-convert">تبدیل به مشتری</button>`
          : (shop.linkedCustomerId
              ? `<button type="button" class="btn small secondary" id="btn-linked-customer">پرونده مشتری</button>`
              : '')}
      </div>
      ${last ? `<h3 class="sub-title">پاسخ‌های آخرین ارزیابی</h3><div class="card">${answersHtml}</div>` : ''}
      <h3 class="sub-title">سوابق ویزیت / ارزیابی (${shop.visits.length})</h3>
      ${visitRows}
    `;

    const addVisitBtn = document.getElementById('btn-add-visit');
    if (addVisitBtn) {
      addVisitBtn.onclick = function () {
        navigateToEvaluation(shop.id);
      };
    }

    const convertBtn = document.getElementById('btn-convert');
    if (convertBtn) {
      convertBtn.onclick = async function () {
        if (!confirm('مغازه «' + shop.name + '» به مشتری CRM تبدیل شود؟\nسوابق ارزیابی در همین بخش باقی می‌ماند.')) return;
        try {
          const res = await convertProspectToCustomer(shop.id);
          showToast(res.created ? 'مشتری جدید ساخته شد' : 'قبلاً تبدیل شده بود');
          drawProspectDetail(root);
        } catch (e) {
          console.error(e);
          showToast(e.message || 'خطا در تبدیل');
        }
      };
    }

    const linkedBtn = document.getElementById('btn-linked-customer');
    if (linkedBtn) {
      linkedBtn.onclick = function () {
        if (shop.linkedCustomerId) {
          navigateToCustomer(shop.linkedCustomerId);
        }
      };
    }
  }

  function mount(root, params) {
    let refreshToken = null;
    if (!root) return function () {};
    rootEl = root;

    const nav = document.getElementById('nav');
    if (nav) nav.style.display = '';

    currentProspectId = params && params.id ? params.id : null;
drawProspectDetail(root);

    refreshToken = ViewHost.setRefresh(()=>drawProspectDetail(rootEl));

    return function unmount() {
      ViewHost.clearRefresh(refreshToken);
      refreshToken = null;
      currentProspectId = null;
      root.innerHTML = '';
      rootEl = null;
    };
  }

  global.ProspectView = { mount: mount, unmount: function () {} };
})(typeof window !== 'undefined' ? window : this);