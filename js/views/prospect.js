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
  // True only immediately after this shop was just created from the New-Evaluation
  // flow (Evaluation → Result). Used solely to redirect the "ثبت ویزیت / ارزیابی
  // جدید" action to a fresh evaluation instead of re-opening this same shop.
  // Does not affect the normal "re-evaluate an existing prospect" path.
  let cameFromNewEvaluation = false;
  function rankPill(rank) {
    const safeRank = (rank || 'D').toString().replace(/[^A-Z+\-]/g, '');
    return `<span class="rank-pill rank-pill-${safeRank}">${esc(safeRank)}</span>`;
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
      location.href = shopId ? ('#/evaluation?shopId=' + encodeURIComponent(shopId)) : '#/evaluation';
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

  // Presentation-only helpers for the evaluation detail screen.
  // They do not alter Prospect data, scoring, or persistence.
  const EVALUATION_SHORT_LABELS = {
    q1: 'نوع و اندازه',
    q2: 'حجم فروش فعلی',
    q3: 'تأمین‌کننده فعلی',
    q4: 'رضایت از تأمین‌کننده',
    q5: 'دسترسی به تصمیم‌گیرنده',
    q6: 'تمایل به تأمین‌کننده جدید',
    q7: 'شرایط پرداخت',
    q8: 'نگهداری/نمایش کالا',
    q9: 'موقعیت مکانی',
    q10: 'احتمال تکرار سفارش',
  };

  function formatEvaluationAnswer(q, raw) {
    if (raw === null || raw === undefined || raw === '') return '—';
    const values = Array.isArray(raw) ? raw : String(raw).split('/').map(function (v) { return v.trim(); }).filter(Boolean);
    const labels = values.map(function (value) {
      const opt = q.options.find(function (o) { return o.key === value; });
      return opt ? opt.label : value;
    }).filter(function (value) { return value && value !== 'undefined' && value !== 'null'; });
    return labels.length ? labels.join(' · ') : '—';
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
      answersHtml = PROSPECT_QUESTIONS.map(function (q, idx) {
        const answer = formatEvaluationAnswer(q, last.answers ? last.answers[q.id] : null);
        const shortLabel = EVALUATION_SHORT_LABELS[q.id] || q.label;
        return `<div class="answer-row">
          <div class="answer-q"><span class="answer-index">${String(idx + 1).padStart(2, '0')}</span><span>${esc(shortLabel)}</span></div>
          <div class="answer-a">${esc(answer)}</div>
        </div>`;
      }).join('');
    }
    const latestResultTags = last ? (last.tags || []).map(function (tk) {
      const t = PROSPECT_VISIT_TAGS.find(function (x) { return x.key === tk; });
      return t ? t.label : tk;
    }).filter(function (v) { return v && v !== 'undefined' && v !== 'null'; }) : [];
    const latestResultHtml = latestResultTags.length
      ? latestResultTags.map(function (v) { return `<span class="prospect-result-chip">${esc(v)}</span>`; }).join('')
      : '<span class="sub">نتیجه‌ای ثبت نشده</span>';

    const visitRows = shop.visits.slice().reverse().map(v => {
      const tags = (v.tags || []).map(tk => {
        const t = PROSPECT_VISIT_TAGS.find(x => x.key === tk);
        return t ? t.label : tk;
      }).join('، ');
      return `<div class="ledger-row tx-row" style="cursor:default;">
        <span class="name">
          <span class="tx-row-title">${prospectFaDateTime(v.date)}</span>
          <span class="sub">${tags ? esc(tags) : 'بدون برچسب'}</span>
        </span>
        <span class="filler"></span>
        <span class="amount tx-row-amount">
          <span class="tx-row-total">${v.score}</span>
          <span class="tx-row-meta">${rankPill(v.rank)}</span>
        </span>
      </div>`;
    }).join('') || '<div class="empty">ویزیتی ثبت نشده</div>';

    root.innerHTML = `
      <div class="btn-row" style="margin-bottom:10px;">
        <a class="btn secondary small" href="#/prospects">← لیست مغازه‌ها</a>
      </div>
      ${shop.status === 'converted' ? `<div class="converted-banner">✅ این مغازه به مشتری تبدیل شده است.</div>` : ''}

      <!-- IDENTITY + SCORE -->
      <div class="tx-identity card field-prospect-head">
        <div class="tx-identity-title">${esc(shop.name)}</div>
        <div class="tx-identity-meta">
          <span>📍 ${esc(getLocationDisplayString(shop.locationId))}</span>
        </div>
        <div class="field-score-row">
          <span class="field-score-value">${shop.latestScore}</span>
          <span class="field-score-meta">امتیاز · ${rankPill(shop.latestRank)}</span>
        </div>
        <div class="sub" style="margin-top:6px;">${esc(info.desc)}</div>
      </div>

      <!-- PRIMARY ACTIONS -->
      <div class="btn-row tx-actions-primary" style="margin-bottom:14px;">
        <button type="button" class="btn small" id="btn-add-visit">ثبت ویزیت / ارزیابی</button>
        <button type="button" class="btn small secondary" id="btn-assign-location">موقعیت</button>
        ${shop.status !== 'converted'
          ? `<button type="button" class="btn small secondary" id="btn-convert">تبدیل به مشتری</button>`
          : (shop.linkedCustomerId
              ? `<button type="button" class="btn small secondary" id="btn-linked-customer">پرونده مشتری</button>`
              : '')}
      </div>

      ${last ? `
        <div class="prospect-result-card">
          <div class="prospect-result-title"><span aria-hidden="true">✓</span> نتیجه ویزیت</div>
          <div class="prospect-result-content">${latestResultHtml}</div>
        </div>
        <details class="tx-details" open>
          <summary>پاسخ‌های آخرین ارزیابی</summary>
          <div class="card evaluation-answers-card" style="margin-top:8px;">${answersHtml}</div>
        </details>
      ` : ''}
      <h3 class="sub-title">سوابق ویزیت / ارزیابی (${shop.visits.length})</h3>
      <div class="tx-list">${visitRows}</div>
    `;

    const addVisitBtn = document.getElementById('btn-add-visit');
    if (addVisitBtn) {
      addVisitBtn.onclick = function () {
        if (cameFromNewEvaluation) {
          navigateToEvaluation(); // start a genuinely new evaluation; Working Location is preserved by evaluation.js
        } else {
          navigateToEvaluation(shop.id);
        }
      };
    }

    const assignLocBtn = document.getElementById('btn-assign-location');
    if (assignLocBtn) {
      assignLocBtn.onclick = function () {
        openLocationAssignSheet({
          title: 'اختصاص موقعیت — ' + shop.name,
          currentLocationId: shop.locationId || null,
          onSave: async function (locationId) {
            await setProspectLocation(shop.id, locationId);
            showToast('موقعیت ذخیره شد');
            drawProspectDetail(root);
          },
        });
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
    cameFromNewEvaluation = !!(params && (params.justCreated === '1' || params.justCreated === true));
drawProspectDetail(root);

    refreshToken = ViewHost.setRefresh(()=>drawProspectDetail(rootEl));

    return function unmount() {
      ViewHost.clearRefresh(refreshToken);
      refreshToken = null;
      currentProspectId = null;
      cameFromNewEvaluation = false;
      root.innerHTML = '';
      rootEl = null;
    };
  }

  global.ProspectView = { mount: mount, unmount: function () {} };
})(typeof window !== 'undefined' ? window : this);
