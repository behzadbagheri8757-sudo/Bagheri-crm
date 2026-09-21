/* js/views/evaluation.js — SPA Evaluation V2 form view.
   Creates a NEW prospect: Profile → Business Type → Q1..Q4 → Summary.
   Reuses PROSPECT_PROFILES, PROSPECT_BUSINESS_TYPES, PROSPECT_QUESTIONS_V2,
   PROSPECT_VISIT_TAGS, prospectComputeScoreV2, prospectRankBadgeHTML,
   createProspectShopV2, queueProspectTargetMilestoneMessage.
   No new financial logic.

   Evaluation is a CURRENT SNAPSHOT (spec §4) — this view only ever creates
   the initial Snapshot. Re-visiting an EXISTING prospect never re-runs this
   full form again; that is the lightweight Follow-up Visit sheet opened
   from the Prospect Detail view (js/views/prospect.js), which can optionally
   edit one Snapshot answer instead of repeating all four questions.

   UX: one question at a time with auto-advance on option tap (same
   interaction the legacy Evaluation used), now preceded by a Profile step
   and a Business Type step per the V2 spec.
*/
'use strict';

(function (global) {
  // step: 0=profile, 1=businessType, 2..5=Q1..Q4, 6=summary
  const STEP_PROFILE = 0;
  const STEP_TYPE = 1;
  const STEP_Q_FIRST = 2;
  const STEP_Q_COUNT = 4; // fixed for both profiles (spec §7, §8)
  const STEP_SUMMARY = STEP_Q_FIRST + STEP_Q_COUNT; // 6

  let formState = {
    name: '',
    routeId: null,
    neighborhoodId: null,
    locationId: null,
    profile: null,
    businessType: null,
    answers: {},
    tags: [],
    step: STEP_PROFILE,
  };

  let handlers = []; // {el, type, fn} — all cleared on unmount

  // Working context for NEW evaluations only. This is UI/session preference data,
  // not Prospect data, so keep it outside IndexedDB and outside the Prospect schema.
  const EVAL_WORKING_LOCATION_KEY = 'baqeri_evaluation_working_location_v1';

  function getWorkingEvaluationLocation() {
    try {
      const id = localStorage.getItem(EVAL_WORKING_LOCATION_KEY);
      if (id && typeof getLocationById === 'function' && getLocationById(id)) return id;
    } catch (e) {}
    return null;
  }
  function setWorkingEvaluationLocation(locationId) {
    if (!locationId) return;
    try { localStorage.setItem(EVAL_WORKING_LOCATION_KEY, String(locationId)); } catch (e) {}
  }
  function applyLocationToFormState(locationId) {
    formState.locationId = locationId || null;
    if (formState.locationId && typeof getLocationHierarchy === 'function') {
      const h = getLocationHierarchy(formState.locationId);
      formState.routeId = h && h.route ? h.route.id : null;
      formState.neighborhoodId = h && h.neighborhood ? h.neighborhood.id : null;
    } else {
      formState.routeId = null;
      formState.neighborhoodId = null;
    }
  }

  function navigateToProspect(id, opts) {
    const justCreated = !!(opts && opts.justCreated);
    AppRouter.navigate('/prospect', justCreated ? { id: id, justCreated: '1' } : { id: id });
  }

  function currentQuestions() {
    return (formState.profile && PROSPECT_QUESTIONS_V2[formState.profile]) || [];
  }

  function on(el, type, fn) {
    if (!el) return;
    el.addEventListener(type, fn);
    handlers.push({ el: el, type: type, fn: fn });
  }
  function clearHandlers() {
    handlers.forEach(function (h) {
      try { h.el.removeEventListener(h.type, h.fn); } catch (e) {}
    });
    handlers = [];
  }

  function goToStep(step) {
    const max = STEP_SUMMARY;
    if (step < STEP_PROFILE) step = STEP_PROFILE;
    if (step > max) step = max;
    formState.step = step;
  }

  // ---- per-step renderers ----

  function renderIdentitySection() {
    return `
      <div class="field"><label>نام مغازه</label><input id="eval-shop-name" value="${esc(formState.name)}" autocomplete="off"></div>
      <div class="eval-location-context card" style="margin-top:10px;margin-bottom:14px;">
        <div class="eval-location-context-main">
          <span class="eval-location-pin" aria-hidden="true">${(typeof AppIcons !== 'undefined' && AppIcons.render) ? AppIcons.render('mapPin', { size: 18 }) : ''}</span>
          <span class="eval-location-context-text">${esc(formState.locationId ? getLocationDisplayString(formState.locationId) : 'محدوده انتخاب نشده')}</span>
        </div>
        <button type="button" class="btn secondary small" id="eval-change-location">تغییر</button>
      </div>
    `;
  }

  function renderProfileStep() {
    const cards = PROSPECT_PROFILES.map(function (p) {
      const active = formState.profile === p.key;
      return `<button type="button" class="eval-profile-card${active ? ' selected' : ''}" data-profile="${esc(p.key)}">
        <span class="eval-profile-card-label">${esc(p.label)}</span>
      </button>`;
    }).join('');
    return `
      ${renderIdentitySection()}
      <div class="eval-step-label">پروفایل کسب‌وکار</div>
      <div class="eval-profile-grid">${cards}</div>
    `;
  }

  function renderTypeStep() {
    const types = (formState.profile && PROSPECT_BUSINESS_TYPES[formState.profile]) || [];
    const chips = types.map(function (t) {
      const active = formState.businessType === t.key;
      return `<button type="button" class="chip-opt${active ? ' selected' : ''}" data-biztype="${esc(t.key)}">${esc(t.label)}</button>`;
    }).join('');
    return `
      <div class="eval-step-label">نوع کسب‌وکار</div>
      <div class="chip-wrap eval-q-options field-eval-opts">${chips}</div>
      <div class="eval-back-row"><button type="button" class="btn secondary small" id="eval-step-back">مرحله قبلی</button></div>
    `;
  }

  function renderQuestionStep() {
    const questions = currentQuestions();
    const qIdx = formState.step - STEP_Q_FIRST; // 0-based within this profile's questions
    const q = questions[qIdx];
    if (!q) return '<div class="empty">پروفایل انتخاب نشده</div>';
    const opts = q.options.map(function (o) {
      const active = formState.answers[q.id] === o.key;
      return `<button type="button" class="chip-opt eval-q-opt${active ? ' selected' : ''}${o.unknown ? ' eval-q-opt-unknown' : ''}" data-qid="${esc(q.id)}" data-value="${esc(o.key)}">${esc(o.label)}</button>`;
    }).join('');
    return `
      <div class="eval-progress-bar" aria-hidden="true">
        <div class="eval-progress-fill" style="width:${((qIdx + (formState.answers[q.id] ? 1 : 0)) / STEP_Q_COUNT) * 100}%"></div>
      </div>
      <div class="eval-one-q card visit-card-enter field-eval-card">
        <div class="eval-q-progress">سؤال ${enToFaDigits(String(qIdx + 1))} از ${enToFaDigits(String(STEP_Q_COUNT))}</div>
        <div class="q-title">${esc(q.label)}</div>
        ${q.hint ? `<div class="sub eval-q-hint">${esc(q.hint)}</div>` : ''}
        <div class="chip-wrap eval-q-options field-eval-opts">${opts}</div>
        <div class="eval-back-row"><button type="button" class="btn secondary small" id="eval-step-back">${qIdx === 0 ? 'نوع کسب‌وکار' : 'سؤال قبلی'}</button></div>
      </div>
    `;
  }

  function openSummaryNameEditSheet(root) {
    openSheet(`
      <h3>ویرایش نام فروشگاه</h3>
      <div class="field" style="margin-top:10px;">
        <label>نام فروشگاه</label>
        <input id="eval-summary-name" value="${esc(formState.name)}" autocomplete="off">
      </div>
      <div class="btn-row" style="margin-top:14px;">
        <button type="button" class="btn" id="eval-summary-name-save">ذخیره نام</button>
      </div>
    `);

    const input = document.getElementById('eval-summary-name');
    const saveBtn = document.getElementById('eval-summary-name-save');
    if (input) input.focus();
    if (saveBtn) saveBtn.addEventListener('click', function () {
      formState.name = input ? input.value : formState.name;
      closeModal();
      drawEvaluation(root);
    });
  }

  function openSummaryQuestionEditSheet(root, questionId) {
    const questions = currentQuestions();
    const q = questions.find(function (item) { return item.id === questionId; });
    if (!q) return;
    const currentValue = formState.answers[q.id] || null;
    const options = q.options.map(function (o) {
      return `<button type="button" class="chip-opt snapshot-edit-option${o.key === currentValue ? ' selected' : ''}" data-summary-edit-value="${esc(o.key)}">${esc(o.label)}</button>`;
    }).join('');

    openSheet(`
      <h3>ویرایش پاسخ ارزیابی</h3>
      <div class="sub" style="margin-bottom:10px;">${esc(q.shortLabel || q.label)}</div>
      <div class="chip-wrap" id="eval-summary-edit-options">${options}</div>
      <div class="btn-row" style="margin-top:14px;">
        <button type="button" class="btn" id="eval-summary-answer-save">ثبت تغییر</button>
      </div>
    `);

    let selectedValue = currentValue;
    document.querySelectorAll('#eval-summary-edit-options [data-summary-edit-value]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        selectedValue = btn.getAttribute('data-summary-edit-value');
        document.querySelectorAll('#eval-summary-edit-options [data-summary-edit-value]').forEach(function (b) {
          b.classList.toggle('selected', b === btn);
        });
      });
    });

    const saveBtn = document.getElementById('eval-summary-answer-save');
    if (saveBtn) saveBtn.addEventListener('click', function () {
      if (selectedValue != null) formState.answers[q.id] = selectedValue;
      closeModal();
      drawEvaluation(root);
    });
  }

  function renderSummaryStep() {
    const result = prospectComputeScoreV2(formState.profile, formState.answers);
    const questions = currentQuestions();
    const isIncomplete = result.knownCount <= 2;
    const missingItems = [];
    if (!formState.name.trim()) missingItems.push('نام فروشگاه وارد نشده');
    if (!formState.locationId) missingItems.push('موقعیت انتخاب نشده');
    if (result.knownCount < STEP_Q_COUNT) {
      const remaining = STEP_Q_COUNT - result.knownCount;
      missingItems.push(`${enToFaDigits(String(result.knownCount))} سؤال پاسخ داده شده؛ ${enToFaDigits(String(remaining))} سؤال باقی مانده`);
    }
    const missingHtml = missingItems.length
      ? `<div class="eval-incomplete-note" style="margin-top:8px;">${missingItems.map(function (item) { return `<div class="sub">${esc(item)}</div>`; }).join('')}</div>`
      : '';
    const tagHtml = PROSPECT_VISIT_TAGS.map(function (t) {
      return `<button type="button" class="chip-opt${formState.tags.includes(t.key) ? ' selected' : ''}" data-tag="${esc(t.key)}">${esc(t.label)}</button>`;
    }).join('');
    const answerRows = questions.map(function (q, idx) {
      const key = formState.answers[q.id];
      const opt = key ? q.options.find(function (o) { return o.key === key; }) : null;
      const answerLabel = opt ? opt.label : '—';
      return `<div class="answer-row answer-row-editable" data-jump-q="${esc(String(idx))}">
        <div class="answer-q"><span class="answer-index">${String(idx + 1).padStart(2, '0')}</span><span>${esc(q.shortLabel || q.label)}</span></div>
        <div class="answer-a">${esc(answerLabel)} <span class="answer-edit-hint">ویرایش</span></div>
      </div>`;
    }).join('');

    const scoreBlockHtml = isIncomplete
      ? `<div class="eval-summary-score-row">${missingHtml}</div>`
      : `<div class="live-score">
           <div><div class="num">${enToFaDigits(String(result.score))}</div>
             <div class="sub">${enToFaDigits(String(result.knownCount))} از ${enToFaDigits(String(STEP_Q_COUNT))} سؤال</div></div>
           <div style="text-align:left">${prospectRankBadgeHTML(result.rank)}</div>
         </div>`;

    return `
      <div class="eval-progress-bar" aria-hidden="true"><div class="eval-progress-fill" style="width:100%"></div></div>
      <div class="card eval-summary-identity" style="margin-bottom:12px;">
        <div class="eval-summary-identity-row">
          <div>
            <div class="tx-row-title">${esc(formState.name.trim() || 'بدون نام')}</div>
            <div class="sub">${esc(formState.locationId ? getLocationDisplayString(formState.locationId) : 'محدوده انتخاب نشده')}</div>
          </div>
          <button type="button" class="btn secondary small" id="eval-jump-profile">ویرایش نام</button>
        </div>
      </div>
      ${isIncomplete ? '' : missingHtml}
      ${scoreBlockHtml}
      <details class="tx-details" open style="margin-top:12px;">
        <summary>پاسخ‌ها</summary>
        <div class="card evaluation-answers-card" style="margin-top:8px;">${answerRows}</div>
      </details>
      <div class="card" style="margin-top:12px;">
        <div class="label" style="margin-bottom:8px;">نتیجه این ویزیت (اختیاری)</div>
        <div class="chip-wrap">${tagHtml}</div>
      </div>
      <div class="btn-row tx-actions-primary" style="margin-top:14px;">
        <button type="button" class="btn secondary small" id="eval-step-back">بازگشت به سؤالات</button>
        <button type="button" class="btn" id="save-eval">ثبت مغازه</button>
      </div>
    `;
  }

  function saveEnabled() {
    return formState.name.trim().length > 0 && !!formState.locationId && !!formState.profile;
  }

  function stepBodyHtml() {
    if (formState.step === STEP_PROFILE) return renderProfileStep();
    if (formState.step === STEP_TYPE) return renderTypeStep();
    if (formState.step === STEP_SUMMARY) return renderSummaryStep();
    return renderQuestionStep();
  }

  function drawEvaluation(root) {
    root.innerHTML = `
      <div class="btn-row" style="margin-bottom:10px;">
        <a class="btn secondary small" href="#/prospects">← لیست</a>
      </div>
      <h2 class="section-title">ارزیابی مشتری بالقوه</h2>
      ${stepBodyHtml()}
    `;

    clearHandlers();

    if (formState.step === STEP_PROFILE) {
      on(document.getElementById('eval-shop-name'), 'input', function (e) {
        formState.name = e.target.value;
      });
      on(document.getElementById('eval-change-location'), 'click', function () {
        const idPrefix = 'eval-context-loc';
        openSheet(
          '<h3>محدوده ارزیابی</h3>' +
          '<div class="sub" style="margin-bottom:10px;">محدوده جدید را انتخاب کن؛ انتخاب مسیر یا محله همان لحظه فعال می‌شود.</div>' +
          renderLocationPickerHTML(idPrefix, formState.locationId)
        );
        wireLocationPicker(idPrefix);
        const regionSel = document.getElementById(idPrefix + '-region');
        const routeSel = document.getElementById(idPrefix + '-route');
        const neighSel = document.getElementById(idPrefix + '-neigh');
        const applyContext = function () {
          const locationId = (neighSel && neighSel.value) || (routeSel && routeSel.value) || null;
          if (!locationId) return;
          applyLocationToFormState(locationId);
          setWorkingEvaluationLocation(locationId);
          const label = document.querySelector('.eval-location-context-text');
          if (label) label.textContent = getLocationDisplayString(locationId);
        };
        [regionSel, routeSel, neighSel].forEach(function (el) {
          if (el) el.addEventListener('change', applyContext);
        });
      });
      root.querySelectorAll('[data-profile]').forEach(function (btn) {
        on(btn, 'click', function () {
          const newProfile = btn.getAttribute('data-profile');
          if (formState.profile !== newProfile) {
            // Switching profile invalidates the previous question set
            // (spec §19: Retail answers must never mix with Food Service).
            formState.profile = newProfile;
            formState.businessType = null;
            formState.answers = {};
          }
          goToStep(STEP_TYPE);
          drawEvaluation(root);
        });
      });
    } else if (formState.step === STEP_TYPE) {
      on(document.getElementById('eval-step-back'), 'click', function () {
        goToStep(STEP_PROFILE);
        drawEvaluation(root);
      });
      root.querySelectorAll('[data-biztype]').forEach(function (btn) {
        on(btn, 'click', function () {
          formState.businessType = btn.getAttribute('data-biztype');
          root.querySelectorAll('[data-biztype]').forEach(function (b) {
            b.classList.toggle('selected', b === btn);
          });
          setTimeout(function () {
            goToStep(STEP_Q_FIRST);
            drawEvaluation(root);
          }, 150);
        });
      });
    } else if (formState.step === STEP_SUMMARY) {
      on(document.getElementById('eval-step-back'), 'click', function () {
        goToStep(STEP_Q_FIRST + STEP_Q_COUNT - 1);
        drawEvaluation(root);
      });
      on(document.getElementById('eval-jump-profile'), 'click', function () {
        openSummaryNameEditSheet(root);
      });
      root.querySelectorAll('[data-jump-q]').forEach(function (row) {
        on(row, 'click', function () {
          const idx = parseInt(row.getAttribute('data-jump-q'), 10) || 0;
          const q = currentQuestions()[idx];
          if (q) openSummaryQuestionEditSheet(root, q.id);
        });
      });
      root.querySelectorAll('[data-tag]').forEach(function (btn) {
        on(btn, 'click', function () {
          const value = btn.getAttribute('data-tag');
          const i = formState.tags.indexOf(value);
          if (i >= 0) formState.tags.splice(i, 1); else formState.tags.push(value);
          btn.classList.toggle('selected');
        });
      });
      const saveBtn = document.getElementById('save-eval');
      if (saveBtn) {
        saveBtn.disabled = !saveEnabled();
        on(saveBtn, 'click', function () {
          if (saveBtn.disabled) return;
          saveBtn.disabled = true;
          (async function () {
            try {
              const shop = await createProspectShopV2({
                name: formState.name,
                routeId: formState.routeId,
                neighborhoodId: formState.neighborhoodId,
                locationId: formState.locationId,
                profile: formState.profile,
                businessType: formState.businessType,
                answers: formState.answers,
                tags: formState.tags,
              });
              if (typeof queueProspectTargetMilestoneMessage === 'function') {
                queueProspectTargetMilestoneMessage(prospectState.dailyTarget);
              }
              showToast('مغازه ثبت شد');
              navigateToProspect(shop.id, { justCreated: true });
            } catch (e) {
              console.error(e);
              showToast('خطا در ذخیره');
              saveBtn.disabled = false;
            }
          })();
        });
      }
    } else {
      // Question step
      on(document.getElementById('eval-step-back'), 'click', function () {
        const qIdx = formState.step - STEP_Q_FIRST;
        goToStep(qIdx === 0 ? STEP_TYPE : formState.step - 1);
        drawEvaluation(root);
      });
      root.querySelectorAll('.eval-q-opt').forEach(function (btn) {
        on(btn, 'click', function () {
          const qid = btn.getAttribute('data-qid');
          const value = btn.getAttribute('data-value');
          formState.answers[qid] = value;
          root.querySelectorAll('[data-qid="' + qid + '"]').forEach(function (b) {
            b.classList.toggle('selected', b.getAttribute('data-value') === value);
          });
          // Auto-advance to next question (or summary after last) — same
          // brief-delay pattern the legacy Evaluation used, so the tap
          // feedback stays visible before the view changes (spec §22).
          setTimeout(function () {
            goToStep(formState.step + 1);
            drawEvaluation(root);
          }, 180);
        });
      });
    }
  }

  function mount(root, params) {
    let refreshToken = null;
    if (!root) return function () {};

    const nav = document.getElementById('nav');
    if (nav) nav.style.display = '';

    // This view only creates NEW prospects (spec §4, §13: re-visiting an
    // existing prospect is a lightweight Follow-up Visit, handled from the
    // Prospect Detail view instead of here).
    formState = {
      name: '',
      routeId: null,
      neighborhoodId: null,
      locationId: null,
      profile: null,
      businessType: null,
      answers: {},
      tags: [],
      step: STEP_PROFILE,
    };
    applyLocationToFormState(getWorkingEvaluationLocation());

    drawEvaluation(root);
    refreshToken = ViewHost.setRefresh(function () { drawEvaluation(root); });

    return function unmount() {
      ViewHost.clearRefresh(refreshToken);
      refreshToken = null;
      clearHandlers();
      if (window.__evalLocationCleanup) {
        try { window.__evalLocationCleanup(); } catch (e) {}
        window.__evalLocationCleanup = null;
      }
      root.innerHTML = '';
    };
  }

  global.EvaluationView = { mount: mount, unmount: function () {} };
})(typeof window !== 'undefined' ? window : this);
