/* js/views/evaluation.js — SPA Evaluation form view (Phase 8).
   Extracted from evaluation.html. Reuses PROSPECT_QUESTIONS,
   PROSPECT_VISIT_TAGS, PROSPECT_RANK_INFO, prospectComputeScore,
   prospectScoreToRank, prospectAnsweredCount, prospectState,
   createProspectShop, addProspectVisit, queueProspectTargetMilestoneMessage.
   No new financial logic.
*/
'use strict';

(function (global) {
  let formState = {
    mode: 'new', // new | visit
    shopId: null,
    name: '',
    routeId: null,
    neighborhoodId: null,
    locationId: null,
    answers: {},
    tags: [],
  };

  let routeHandlers = [];
  let questionHandlers = [];
  let tagHandlers = [];
  let saveHandler = null;

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

  function navigateToProspect(id, opts) {
    const justCreated = !!(opts && opts.justCreated);
    if (
      typeof isSpaShell === 'function' &&
      isSpaShell() &&
      typeof AppRouter !== 'undefined' &&
      AppRouter.navigate
    ) {
      AppRouter.navigate('/prospect', justCreated ? { id: id, justCreated: '1' } : { id: id });
    } else {
      location.href = '#/prospect?id=' + encodeURIComponent(id) + (justCreated ? '&justCreated=1' : '');
    }
  }

  function updateLive() {
    const score = prospectComputeScore(formState.answers);
    const rank = prospectScoreToRank(score);
    const info = PROSPECT_RANK_INFO[rank];
    const n = prospectAnsweredCount(formState.answers);
    const val = document.getElementById('live-score-value');
    const sub = document.getElementById('live-score-sub');
    const rk = document.getElementById('live-score-rank');
    if (val) val.textContent = score;
    if (sub) sub.textContent = n + ' از ' + PROSPECT_QUESTIONS.length + ' سؤال';
    if (rk) { rk.textContent = rank; rk.style.background = info.color; }
    const btn = document.getElementById('save-eval');
    if (btn) {
      const nameOk = formState.mode === 'visit' ? true : formState.name.trim().length > 0;
      const ansOk = n === PROSPECT_QUESTIONS.length;
      const routeOk = formState.mode === 'visit' ? true : !!formState.locationId;
      btn.disabled = !(nameOk && ansOk && routeOk);
    }
  }

  function drawEvaluation(root) {
    const shopId = formState.shopId;

    const isVisit = formState.mode === 'visit';

    const qHtml = PROSPECT_QUESTIONS.map((q, idx) => {
      const opts = q.options.map(o =>
        `<button type="button" class="chip-opt ${formState.answers[q.id] === o.key ? 'selected' : ''}" data-group="${q.id}" data-value="${esc(o.key)}">${esc(o.label)}</button>`
      ).join('');
      return `<div class="q-block"><div class="q-title">${idx + 1}. ${esc(q.label)}</div><div class="chip-wrap">${opts}</div></div>`;
    }).join('');

    const tagHtml = PROSPECT_VISIT_TAGS.map(t =>
      `<button type="button" class="chip-opt ${formState.tags.includes(t.key) ? 'selected' : ''}" data-group="tags" data-value="${esc(t.key)}" data-multi="1">${esc(t.label)}</button>`
    ).join('');

    const score = prospectComputeScore(formState.answers);
    const rank = prospectScoreToRank(score);
    const info = PROSPECT_RANK_INFO[rank];

    root.innerHTML = `
      <div class="btn-row" style="margin-bottom:10px;">
        <a class="btn secondary small" href="#/prospects">← لیست</a>
      </div>
      <h2 class="section-title">${isVisit ? 'ثبت ویزیت / ارزیابی' : 'ثبت مغازه + ارزیابی'}</h2>
      ${isVisit
        ? `<div class="card" style="margin-bottom:12px;"><b>${esc(formState.name)}</b>
            <div class="sub">${esc(getLocationDisplayString(formState.locationId))}</div></div>`
        : `<div class="field"><label>نام مغازه</label><input id="shop-name" value="${esc(formState.name)}" autocomplete="off"></div>
           <div class="eval-location-context card" style="margin-top:10px;">
             <div class="eval-location-context-main">
               <span class="eval-location-pin" aria-hidden="true">📍</span>
               <span class="eval-location-context-text">${esc(formState.locationId ? getLocationDisplayString(formState.locationId) : 'محدوده انتخاب نشده')}</span>
             </div>
             <button type="button" class="btn secondary small" id="eval-change-location">تغییر</button>
           </div>`
      }
      <div class="live-score">
        <div><div class="num" id="live-score-value">${score}</div>
          <div class="sub" id="live-score-sub">${prospectAnsweredCount(formState.answers)} از ${PROSPECT_QUESTIONS.length} سؤال</div></div>
        <div style="text-align:left"><span class="rank-badge" id="live-score-rank" style="background:${info.color}">${rank}</span>
          <div class="sub" style="margin-top:4px;max-width:160px;">${esc(info.desc)}</div></div>
      </div>
      <div class="card">${qHtml}</div>
      <div class="card" style="margin-top:12px;">
        <div class="label" style="margin-bottom:8px;">نتیجه این ویزیت (اختیاری)</div>
        <div class="chip-wrap">${tagHtml}</div>
      </div>
      <div class="btn-row" style="margin-top:14px;">
        <button type="button" class="btn" id="save-eval" disabled>${isVisit ? 'ثبت ویزیت' : 'ثبت مغازه'}</button>
      </div>
    `;

    // Name input (new mode only)
    if (!isVisit) {
      const nameIn = document.getElementById('shop-name');
      if (nameIn) {
        nameIn.addEventListener('input', function (e) {
          formState.name = e.target.value;
          updateLive();
        });
      }
    }

    if (!isVisit) {
      const changeLocationBtn = document.getElementById('eval-change-location');
      if (changeLocationBtn) {
        changeLocationBtn.addEventListener('click', function () {
          const idPrefix = 'eval-context-loc';
          const current = formState.locationId || null;
          openSheet(
            '<h3>محدوده ارزیابی</h3>' +
            '<div class="sub" style="margin-bottom:10px;">محدوده جدید را انتخاب کن؛ انتخاب مسیر یا محله همان لحظه فعال می‌شود.</div>' +
            renderLocationPickerHTML(idPrefix, current)
          );
          wireLocationPicker(idPrefix);
          const regionSel = document.getElementById(idPrefix+'-region');
          const routeSel = document.getElementById(idPrefix+'-route');
          const neighSel = document.getElementById(idPrefix+'-neigh');
          const applyContext = function () {
            const locationId = (neighSel && neighSel.value) || (routeSel && routeSel.value) || null;
            if (!locationId) return;
            applyLocationToFormState(locationId);
            setWorkingEvaluationLocation(locationId);
            const label = document.querySelector('.eval-location-context-text');
            if (label) label.textContent = getLocationDisplayString(locationId);
            updateLive();
          };
          [regionSel, routeSel, neighSel].forEach(function (el) {
            if (el) el.addEventListener('change', applyContext);
          });
        });
      }
    }

    // Clear previous handlers
    routeHandlers = [];
    questionHandlers = [];
    tagHandlers = [];

    // Event delegation for all chip-opt buttons
    root.querySelectorAll('.chip-opt').forEach(el => {
      const handler = function () {
        const group = el.getAttribute('data-group');
        const value = el.getAttribute('data-value');
        const multi = el.getAttribute('data-multi') === '1';

        if (group === 'tags') {
          const i = formState.tags.indexOf(value);
          if (i >= 0) formState.tags.splice(i, 1);
          else formState.tags.push(value);
          el.classList.toggle('selected');
          return;
        }
        if (group.startsWith('q')) {
          formState.answers[group] = value;
          root.querySelectorAll('[data-group="' + group + '"]').forEach(b =>
            b.classList.toggle('selected', b.getAttribute('data-value') === value)
          );
          updateLive();
        }
      };
      el.addEventListener('click', handler);
      // Store for cleanup
      if (el.getAttribute('data-group') === 'route') routeHandlers.push({ el, handler });
      else if (el.getAttribute('data-group') === 'tags') tagHandlers.push({ el, handler });
      else if (el.getAttribute('data-group') === 'neighborhood') routeHandlers.push({ el, handler });
      else if (el.getAttribute('data-group') && el.getAttribute('data-group').startsWith('q')) {
        questionHandlers.push({ el, handler });
      }
    });

    // Save button
    const saveBtn = document.getElementById('save-eval');
    saveHandler = function () {
      if (saveBtn.disabled) return;
      saveBtn.disabled = true;
      (async function () {
        try {
          if (formState.mode === 'visit') {
            const shop = await addProspectVisit(formState.shopId, {
              answers: formState.answers,
              tags: formState.tags,
            });
            if (typeof queueProspectTargetMilestoneMessage === 'function') {
              queueProspectTargetMilestoneMessage(prospectState.dailyTarget);
            }
            showToast('ویزیت ثبت شد');
            navigateToProspect(shop.id);
          } else {
            const shop = await createProspectShop({
              name: formState.name,
              routeId: formState.routeId,
              neighborhoodId: formState.neighborhoodId,
              locationId: formState.locationId,
              answers: formState.answers,
              tags: formState.tags,
            });
            if (typeof queueProspectTargetMilestoneMessage === 'function') {
              queueProspectTargetMilestoneMessage(prospectState.dailyTarget);
            }
            showToast('مغازه ثبت شد');
            navigateToProspect(shop.id, { justCreated: true });
          }
        } catch (e) {
          console.error(e);
          showToast('خطا در ذخیره');
          saveBtn.disabled = false;
        }
      })();
    };
    saveBtn.onclick = saveHandler;

    updateLive();
  }

  function mount(root, params) {
    let refreshToken = null;
    if (!root) return function () {};

    const nav = document.getElementById('nav');
    if (nav) nav.style.display = '';

    // Reset form state
    const shopId = params && params.shopId ? params.shopId : null;
    if (shopId) {
      const shop = prospectState.shops.find(s => s.id === shopId);
      if (shop) {
        formState.mode = 'visit';
        formState.shopId = shopId;
        formState.name = shop.name;
        formState.routeId = shop.routeId;
        formState.neighborhoodId = shop.neighborhoodId;
        formState.locationId = shop.locationId || null;
      } else {
        formState.mode = 'new';
        formState.shopId = null;
        formState.name = '';
        formState.routeId = null;
        formState.neighborhoodId = null;
        applyLocationToFormState(getWorkingEvaluationLocation());
      }
    } else {
      formState.mode = 'new';
      formState.shopId = null;
      formState.name = '';
      formState.routeId = null;
      formState.neighborhoodId = null;
      applyLocationToFormState(getWorkingEvaluationLocation());
    }
    formState.answers = {};
    formState.tags = [];

    drawEvaluation(root);

    refreshToken = ViewHost.setRefresh(()=>drawEvaluation(root));



    return function unmount() {
      ViewHost.clearRefresh(refreshToken);
      refreshToken = null;
      // Remove all event listeners
      routeHandlers.forEach(function (h) {
        try { h.el.removeEventListener('click', h.handler); } catch (e) {}
      });
      routeHandlers = [];

      questionHandlers.forEach(function (h) {
        try { h.el.removeEventListener('click', h.handler); } catch (e) {}
      });
      questionHandlers = [];

      tagHandlers.forEach(function (h) {
        try { h.el.removeEventListener('click', h.handler); } catch (e) {}
      });
      tagHandlers = [];

      if (window.__evalLocationCleanup) {
        try { window.__evalLocationCleanup(); } catch (e) {}
        window.__evalLocationCleanup = null;
      }
      if (saveHandler) {
        const btn = document.getElementById('save-eval');
        if (btn) btn.onclick = null;
      }
      saveHandler = null;
      root.innerHTML = '';
    };
  }

  global.EvaluationView = { mount: mount, unmount: function () {} };
})(typeof window !== 'undefined' ? window : this);