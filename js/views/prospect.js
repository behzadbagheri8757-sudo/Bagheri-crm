/* js/views/prospect.js — SPA Prospect detail view.
   Reuses prospectState, PROSPECT_QUESTIONS (legacy), PROSPECT_QUESTIONS_V2,
   PROSPECT_RANK_INFO, PROSPECT_VISIT_TAGS, PROSPECT_FOLLOWUP_OUTCOMES,
   prospectRankBadgeHTML, prospectFaDate, prospectFaDateTime,
   convertProspectToCustomer, addFollowUpVisit.
   No new financial logic.

   V2 prospects (spec §35, §36) keep two clearly separate things on screen:
   the CURRENT SNAPSHOT (profile, type, current score/rank, current answers)
   and the VISIT HISTORY (a log of past events — each one date + outcome +
   note + any targeted Snapshot edit it made). A past Visit Event is never
   confused with current Snapshot state.

   Legacy (V1) prospects have no Snapshot — they keep showing their latest
   full-evaluation visit the way they always did.
*/
'use strict';

(function (global) {
  let currentProspectId = null;
  let rootEl = null;
  function rankPill(rank) { return prospectRankBadgeHTML(rank); }

  function navigateToProspects() {
    AppRouter.navigate('/prospects');
  }

  function navigateToCustomer(cid) {
    AppRouter.navigate('/customer', { id: cid });
  }

  // Presentation-only helpers for the legacy (V1) evaluation detail screen.
  // They do not alter Prospect data, scoring, or persistence.
  const LEGACY_SHORT_LABELS = {
    q1: 'نوع و اندازه', q2: 'حجم فروش فعلی', q3: 'تأمین‌کننده فعلی',
    q4: 'رضایت از تأمین‌کننده', q5: 'دسترسی به تصمیم‌گیرنده',
    q6: 'تمایل به تأمین‌کننده جدید', q7: 'شرایط پرداخت',
    q8: 'نگهداری/نمایش کالا', q9: 'موقعیت مکانی', q10: 'احتمال تکرار سفارش',
  };

  function formatLegacyAnswer(q, raw) {
    if (raw === null || raw === undefined || raw === '') return '—';
    const values = Array.isArray(raw) ? raw : String(raw).split('/').map(function (v) { return v.trim(); }).filter(Boolean);
    const labels = values.map(function (value) {
      const opt = q.options.find(function (o) { return o.key === value; });
      return opt ? opt.label : value;
    }).filter(function (value) { return value && value !== 'undefined' && value !== 'null'; });
    return labels.length ? labels.join(' · ') : '—';
  }

  function outcomeLabel(key) {
    const o = (typeof PROSPECT_FOLLOWUP_OUTCOMES !== 'undefined' ? PROSPECT_FOLLOWUP_OUTCOMES : []).find(function (x) { return x.key === key; });
    if (o) return o.label;
    const t = PROSPECT_VISIT_TAGS.find(function (x) { return x.key === key; });
    if (t) return t.label;
    return internalHistoryLabel(key);
  }

  function snapshotQuestion(shop, questionId) {
    if (!shop || !shop.snapshot || typeof PROSPECT_QUESTIONS_V2 === 'undefined') return null;
    const qs = PROSPECT_QUESTIONS_V2[shop.snapshot.profile] || [];
    return qs.find(function (q) { return q.id === questionId; }) || null;
  }

  function snapshotOptionLabel(question, value) {
    if (value === null || value === undefined || value === '') return '—';
    const opt = question && question.options ? question.options.find(function (o) { return o.key === value; }) : null;
    return opt ? opt.label : String(value);
  }

  function internalHistoryLabel(value) {
    const map = {
      no_supplier: 'تأمین‌کننده ثابت ندارد',
      visit_evaluation_response: 'پاسخ ارزیابی ویزیت',
      visit_evaluation: 'ارزیابی ویزیت',
      supplier: 'تأمین‌کننده',
      interviewer: 'مصاحبه‌کننده',
      speak: 'گفت‌وگو',
      context: 'زمینه',
      pre: 'قبلی',
      fee: 'هزینه',
    };
    return map[value] || value;
  }

  function visitCanEdit(v) {
    if (!v || v.type !== 'followup' || !v.date) return false;
    const ts = new Date(v.date).getTime();
    if (!isFinite(ts)) return false;
    const age = Date.now() - ts;
    return age >= 0 && age <= (3 * 60 * 60 * 1000);
  }

  // ---------------- Snapshot block (V2 only) ----------------

  function renderSnapshotCard(shop) {
    const snap = shop.snapshot;
    const profileLabel = (PROSPECT_PROFILES.find(function (p) { return p.key === snap.profile; }) || {}).label || snap.profile || '—';
    const typeList = PROSPECT_BUSINESS_TYPES[snap.profile] || [];
    const typeLabel = (typeList.find(function (t) { return t.key === snap.businessType; }) || {}).label || '—';
    const questions = PROSPECT_QUESTIONS_V2[snap.profile] || [];
    const isIncomplete = snap.knownCount <= 2;

    const answerRows = questions.map(function (q, idx) {
      const key = snap.answers ? snap.answers[q.id] : null;
      const opt = key ? q.options.find(function (o) { return o.key === key; }) : null;
      return `<button type="button" class="answer-row answer-row-editable snapshot-answer-row" data-snapshot-q="${esc(q.id)}">
        <span class="answer-q"><span class="answer-index">${String(idx + 1).padStart(2, '0')}</span><span>${esc(q.shortLabel || q.label)}</span></span>
        <span class="answer-a">${esc(opt ? opt.label : '—')} <span class="answer-edit-hint">ویرایش</span></span>
      </button>`;
    }).join('');

    const scoreHtml = isIncomplete
      ? `<div class="eval-incomplete-note" style="margin-top:8px;">
           <div class="eval-incomplete-title">پروسپکت ناقص است</div>
           <div class="sub">${enToFaDigits(String(snap.knownCount))} از ۴ سؤال پاسخ داده شده</div>
         </div>`
      : `<div class="field-score-row">
           <span class="field-score-value">${snap.score}</span>
           <span class="field-score-meta">امتیاز · ${rankPill(snap.rank)}</span>
         </div>`;

    return `
      <div class="tx-identity card field-prospect-head">
        <div class="tx-identity-title">${esc(shop.name)}</div>
        <div class="tx-identity-meta">
          <span>${(typeof AppIcons !== 'undefined' && AppIcons.render) ? AppIcons.render('mapPin', { size: 16 }) : ''} ${esc(getLocationDisplayString(shop.locationId))}</span>
        </div>
        <div class="snapshot-meta-row">
          <span class="badge tone-neutral">${esc(profileLabel)}</span>
          <span class="badge tone-muted">${esc(typeLabel)}</span>
        </div>
        ${scoreHtml}
        <details class="tx-details" style="margin-top:10px;">
          <summary>پاسخ‌های فعلی ارزیابی</summary>
          <div class="card evaluation-answers-card" style="margin-top:8px;">${answerRows}</div>
        </details>
      </div>
    `;
  }

  // ---------------- Legacy (V1) block ----------------

  function renderLegacyCard(shop, last) {
    const info = PROSPECT_RANK_INFO[shop.latestRank] || PROSPECT_RANK_INFO['D'];
    let answersHtml = '';
    if (last) {
      answersHtml = PROSPECT_QUESTIONS.map(function (q, idx) {
        const answer = formatLegacyAnswer(q, last.answers ? last.answers[q.id] : null);
        const shortLabel = LEGACY_SHORT_LABELS[q.id] || q.label;
        return `<div class="answer-row">
          <div class="answer-q"><span class="answer-index">${String(idx + 1).padStart(2, '0')}</span><span>${esc(shortLabel)}</span></div>
          <div class="answer-a">${esc(answer)}</div>
        </div>`;
      }).join('');
    }
    return `
      <div class="tx-identity card field-prospect-head">
        <div class="tx-identity-title">${esc(shop.name)}</div>
        <div class="tx-identity-meta">
          <span>${(typeof AppIcons !== 'undefined' && AppIcons.render) ? AppIcons.render('mapPin', { size: 16 }) : ''} ${esc(getLocationDisplayString(shop.locationId))}</span>
        </div>
        <div class="field-score-row">
          <span class="field-score-value">${shop.latestScore}</span>
          <span class="field-score-meta">امتیاز · ${rankPill(shop.latestRank)}</span>
        </div>
        <div class="sub" style="margin-top:6px;">${esc(info.desc)}</div>
      </div>
      ${last ? `
        <details class="tx-details" open>
          <summary>پاسخ‌های آخرین ارزیابی (مدل قدیمی)</summary>
          <div class="card evaluation-answers-card" style="margin-top:8px;">${answersHtml}</div>
        </details>
      ` : ''}
    `;
  }

  // ---------------- Visit History (both models) ----------------

  function renderVisitHistory(shop) {
    const rows = shop.visits.slice().reverse().map(function (v) {
      const tags = (v.tags || []).map(outcomeLabel).join('، ');
      const editQuestion = v.snapshotEdit ? snapshotQuestion(shop, v.snapshotEdit.questionId) : null;
      const editNote = v.snapshotEdit
        ? `<span class="visit-edit-note">ویرایش پاسخ ارزیابی اولیه: ${esc(editQuestion ? (editQuestion.shortLabel || editQuestion.label) : internalHistoryLabel(v.snapshotEdit.questionId))} — از «${esc(snapshotOptionLabel(editQuestion, v.snapshotEdit.from))}» به «${esc(snapshotOptionLabel(editQuestion, v.snapshotEdit.to))}»</span>`
        : '';
      const nextNote = v.nextFollowUpDate ? `<span class="visit-next-note">پیگیری بعدی: ${esc(prospectFaDate(v.nextFollowUpDate))}</span>` : '';
      const noteNote = v.note ? `<span class="visit-note-text">${esc(v.note)}</span>` : '';
      const editButton = visitCanEdit(v)
        ? `<button type="button" class="btn secondary small visit-history-edit" data-edit-visit="${esc(v.id)}">ویرایش ویزیت</button>`
        : '';
      const scoreCol = (typeof v.score === 'number')
        ? `<span class="tx-row-total">${v.score}</span><span class="tx-row-meta">${rankPill(v.rank)}</span>`
        : `<span class="tx-row-meta">${v.type === 'snapshot_edit' ? 'ویرایش ارزیابی' : (v.type === 'followup' ? 'پیگیری' : '')}</span>`;
      return `<div class="ledger-row tx-row" style="cursor:default;">
        <span class="name">
          <span class="tx-row-title">${prospectFaDateTime(v.date)}</span>
          <span class="sub">${tags ? esc(tags) : (v.type === 'initial' ? 'ارزیابی اولیه' : 'بدون برچسب')}</span>
          ${noteNote ? `<span class="sub">${noteNote}</span>` : ''}
          ${editNote || nextNote ? `<span class="sub">${editNote}${editNote && nextNote ? ' · ' : ''}${nextNote}</span>` : ''}
        </span>
        <span class="filler"></span>
        <span class="amount tx-row-amount">${scoreCol}${editButton ? '<br>' + editButton : ''}</span>
      </div>`;
    }).join('') || '<div class="empty">ویزیتی ثبت نشده</div>';
    return `<h3 class="sub-title">سوابق ویزیت (${shop.visits.length})</h3><div class="tx-list">${rows}</div>`;
  }

  function openSnapshotAnswerEditSheet(shop, questionId, onSaved) {
    const q = snapshotQuestion(shop, questionId);
    if (!q) return;
    const currentValue = shop.snapshot.answers ? shop.snapshot.answers[q.id] : null;
    const options = q.options.map(function (o) {
      return `<button type="button" class="chip-opt snapshot-edit-option${o.key === currentValue ? ' selected' : ''}" data-snapshot-edit-value="${esc(o.key)}">${esc(o.label)}</button>`;
    }).join('');

    openSheet(`
      <h3>ویرایش پاسخ ارزیابی</h3>
      <div class="sub" style="margin-bottom:10px;">${esc(q.shortLabel || q.label)}</div>
      <div class="chip-wrap" id="snapshot-edit-options">${options}</div>
      <div class="btn-row" style="margin-top:14px;">
        <button type="button" class="btn" id="snapshot-edit-save">ثبت تغییر</button>
      </div>
    `);

    let selectedValue = currentValue;
    document.querySelectorAll('#snapshot-edit-options [data-snapshot-edit-value]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        selectedValue = btn.getAttribute('data-snapshot-edit-value');
        document.querySelectorAll('#snapshot-edit-options [data-snapshot-edit-value]').forEach(function (b) {
          b.classList.toggle('selected', b === btn);
        });
      });
    });

    document.getElementById('snapshot-edit-save').addEventListener('click', async function () {
      if (selectedValue === currentValue) { closeModal(); return; }
      try {
        await editProspectSnapshotAnswer(shop.id, q.id, selectedValue);
        closeModal();
        showToast('پاسخ ارزیابی به‌روزرسانی شد');
        if (typeof onSaved === 'function') onSaved();
      } catch (e) {
        console.error(e);
        showToast('خطا در ویرایش پاسخ');
      }
    });
  }

  // ---------------- Follow-up Visit sheet ----------------

  function openFollowUpSheet(shop, onSaved) {
    const isV2 = shop.scoringVersion >= 2 && !!shop.snapshot;
    const questions = isV2 ? (PROSPECT_QUESTIONS_V2[shop.snapshot.profile] || []) : [];
    const outcomeChips = PROSPECT_FOLLOWUP_OUTCOMES.map(function (o) {
      return `<button type="button" class="chip-opt" data-outcome="${esc(o.key)}">${esc(o.label)}</button>`;
    }).join('');
    const questionOptionsHtml = questions.map(function (q) {
      return `<option value="${esc(q.id)}">${esc(q.shortLabel || q.label)}</option>`;
    }).join('');

    openSheet(`
      <h3>ثبت ویزیت پیگیری</h3>
      <div class="sub" style="margin-bottom:10px;">${esc(shop.name)}</div>
      <div class="field">
        <label>نتیجه (اختیاری)</label>
        <div class="chip-wrap" id="ff-outcomes">${outcomeChips}</div>
      </div>
      <div class="field">
        <label>چی گفت؟ چرا؟</label>
        <textarea id="ff-note" rows="2" placeholder="یادداشت آزاد..."></textarea>
      </div>
      <div class="field">
        <label>پیگیری بعدی (اختیاری)</label>
        <div id="ff-next-date-wrap" class="ff-date-field is-empty">
          ${typeof shamsiDateInputHTML === 'function' ? shamsiDateInputHTML('ff-next-date', null) : '<input type="date" id="ff-next-date" aria-label="تاریخ پیگیری بعدی">'}
        </div>
      </div>
      ${isV2 ? `
      <div class="field">
        <label>ویرایش هدفمند یک پاسخ ارزیابی (اختیاری)</label>
        <select id="ff-edit-question">
          <option value="">بدون تغییر</option>
          ${questionOptionsHtml}
        </select>
      </div>
      <div id="ff-edit-options-wrap" style="display:none;" class="field">
        <label id="ff-edit-options-label"></label>
        <div class="chip-wrap" id="ff-edit-options"></div>
      </div>
      ` : ''}
      <div class="btn-row" style="margin-top:14px;">
        <button type="button" class="btn" id="ff-save">ثبت ویزیت</button>
      </div>
    `);

    const selectedOutcomes = [];
    const nextDateInput = document.getElementById('ff-next-date');
    const nextDateWrap = document.getElementById('ff-next-date-wrap');
    function syncNextDateState() {
      nextDateWrap.classList.toggle('is-empty', !nextDateInput.value);
    }
    if (nextDateInput && nextDateInput.type === 'hidden') {
      nextDateInput.value = '';
      const field = nextDateWrap.querySelector('[data-shamsi-field]');
      if (field) field.value = '';
      nextDateInput.addEventListener('input', syncNextDateState);
      nextDateInput.addEventListener('change', syncNextDateState);
    } else if (nextDateInput) {
      nextDateInput.addEventListener('input', syncNextDateState);
      nextDateInput.addEventListener('change', syncNextDateState);
    }
    syncNextDateState();

    document.querySelectorAll('#ff-outcomes [data-outcome]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const key = btn.getAttribute('data-outcome');
        const i = selectedOutcomes.indexOf(key);
        if (i >= 0) selectedOutcomes.splice(i, 1); else selectedOutcomes.push(key);
        btn.classList.toggle('selected');
      });
    });

    let pendingSnapshotEdit = null;
    if (isV2) {
      const qSel = document.getElementById('ff-edit-question');
      const optWrap = document.getElementById('ff-edit-options-wrap');
      const optLabel = document.getElementById('ff-edit-options-label');
      const optHost = document.getElementById('ff-edit-options');
      qSel.addEventListener('change', function () {
        pendingSnapshotEdit = null;
        const qId = qSel.value;
        if (!qId) { optWrap.style.display = 'none'; optHost.innerHTML = ''; return; }
        const q = questions.find(function (x) { return x.id === qId; });
        if (!q) { optWrap.style.display = 'none'; return; }
        optLabel.textContent = q.label;
        const currentValue = shop.snapshot.answers ? shop.snapshot.answers[qId] : null;
        optHost.innerHTML = q.options.map(function (o) {
          return `<button type="button" class="chip-opt${o.key === currentValue ? ' selected' : ''}" data-optvalue="${esc(o.key)}">${esc(o.label)}</button>`;
        }).join('');
        optWrap.style.display = '';
        optHost.querySelectorAll('[data-optvalue]').forEach(function (btn) {
          btn.addEventListener('click', function () {
            optHost.querySelectorAll('[data-optvalue]').forEach(function (b) { b.classList.toggle('selected', b === btn); });
            pendingSnapshotEdit = { questionId: qId, value: btn.getAttribute('data-optvalue') };
          });
        });
      });
    }

    document.getElementById('ff-save').addEventListener('click', function () {
      const note = (document.getElementById('ff-note').value || '').trim();
      const nextFollowUpDate = document.getElementById('ff-next-date').value || null;
      (async function () {
        try {
          await addFollowUpVisit(shop.id, {
            tags: selectedOutcomes,
            note: note,
            nextFollowUpDate: nextFollowUpDate,
            snapshotEdit: pendingSnapshotEdit,
          });
          closeModal();
          showToast('ویزیت ثبت شد');
          if (typeof onSaved === 'function') onSaved();
        } catch (e) {
          console.error(e);
          showToast('خطا در ثبت ویزیت');
        }
      })();
    });
  }

  function openFollowUpEditSheet(shop, visit, onSaved) {
    if (!visitCanEdit(visit)) {
      showToast('مهلت ویرایش این ویزیت تمام شده است');
      return;
    }
    const selectedOutcomes = Array.isArray(visit.tags) ? visit.tags.slice() : [];
    const outcomeChips = PROSPECT_FOLLOWUP_OUTCOMES.map(function (o) {
      return `<button type="button" class="chip-opt${selectedOutcomes.includes(o.key) ? ' selected' : ''}" data-edit-outcome="${esc(o.key)}">${esc(o.label)}</button>`;
    }).join('');
    openSheet(`
      <h3>ویرایش ویزیت پیگیری</h3>
      <div class="sub" style="margin-bottom:10px;">${esc(shop.name)}</div>
      <div class="field">
        <label>نتیجه</label>
        <div class="chip-wrap" id="edit-visit-outcomes">${outcomeChips}</div>
      </div>
      <div class="field">
        <label>چی گفت؟ چرا؟</label>
        <textarea id="edit-visit-note" rows="3" placeholder="یادداشت آزاد...">${esc(visit.note || '')}</textarea>
      </div>
      <div class="field">
        <label>پیگیری بعدی (اختیاری)</label>
        <div id="edit-visit-date-wrap" class="ff-date-field${visit.nextFollowUpDate ? '' : ' is-empty'}">
          ${typeof shamsiDateInputHTML === 'function' ? shamsiDateInputHTML('edit-visit-next-date', visit.nextFollowUpDate || null) : '<input type="date" id="edit-visit-next-date" aria-label="تاریخ پیگیری بعدی">'}
        </div>
      </div>
      <div class="btn-row" style="margin-top:14px;">
        <button type="button" class="btn" id="edit-visit-save">ذخیره ویرایش</button>
      </div>
    `);

    const dateInput = document.getElementById('edit-visit-next-date');
    const dateWrap = document.getElementById('edit-visit-date-wrap');
    if (dateInput && dateInput.type === 'hidden' && !visit.nextFollowUpDate) {
      dateInput.value = '';
      const field = dateWrap.querySelector('[data-shamsi-field]');
      if (field) field.value = '';
    }
    document.querySelectorAll('#edit-visit-outcomes [data-edit-outcome]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const key = btn.getAttribute('data-edit-outcome');
        const i = selectedOutcomes.indexOf(key);
        if (i >= 0) selectedOutcomes.splice(i, 1); else selectedOutcomes.push(key);
        btn.classList.toggle('selected');
      });
    });

    document.getElementById('edit-visit-save').addEventListener('click', async function () {
      const nextDate = dateInput ? (dateInput.value || null) : null;
      try {
        await editProspectFollowUpVisit(shop.id, visit.id, {
          tags: selectedOutcomes,
          note: (document.getElementById('edit-visit-note').value || '').trim(),
          nextFollowUpDate: nextDate,
        });
        closeModal();
        showToast('ویزیت به‌روزرسانی شد');
        if (typeof onSaved === 'function') onSaved();
      } catch (e) {
        console.error(e);
        showToast(e.message || 'خطا در ویرایش ویزیت');
      }
    });
  }

  function drawProspectDetail(root) {
    if (!root) return;
    const id = currentProspectId;

    if (!id) {
      root.innerHTML = `<div class="empty">شناسه مشخص نیست</div><a class="btn secondary" href="#/prospects">بازگشت</a>`;
      return;
    }
    const shop = prospectState.shops.find(function (s) { return s.id === id; });
    if (!shop) {
      root.innerHTML = `<div class="empty">مغازه پیدا نشد</div><a class="btn secondary" href="#/prospects">بازگشت</a>`;
      return;
    }

    const isV2 = shop.scoringVersion >= 2 && !!shop.snapshot;
    const last = shop.visits.length ? shop.visits[shop.visits.length - 1] : null;
    const identityHtml = isV2 ? renderSnapshotCard(shop) : renderLegacyCard(shop, last);
    const latestOutcomeTags = last ? (last.tags || []).map(outcomeLabel).filter(function (v) { return v && v !== 'undefined' && v !== 'null'; }) : [];
    const latestResultHtml = latestOutcomeTags.length
      ? latestOutcomeTags.map(function (v) { return `<span class="prospect-result-chip">${esc(v)}</span>`; }).join('')
      : '<span class="sub">نتیجه‌ای ثبت نشده</span>';

    root.innerHTML = `
      <div class="btn-row" style="margin-bottom:10px;">
        <a class="btn secondary small" href="#/prospects">← لیست مغازه‌ها</a>
      </div>
      ${shop.status === 'converted' ? `<div class="converted-banner">✅ این مغازه به مشتری تبدیل شده است.</div>` : ''}

      ${identityHtml}

      <div class="btn-row tx-actions-primary" style="margin:14px 0;">
        <button type="button" class="btn small" id="btn-add-visit">ثبت ویزیت پیگیری</button>
        <button type="button" class="btn small secondary" id="btn-assign-location">موقعیت</button>
        ${shop.status !== 'converted'
          ? `<button type="button" class="btn small secondary" id="btn-convert">تبدیل به مشتری</button>`
          : (shop.linkedCustomerId ? `<button type="button" class="btn small secondary" id="btn-linked-customer">پرونده مشتری</button>` : '')}
      </div>

      ${last ? `
        <div class="prospect-result-card">
          <div class="prospect-result-title"><span aria-hidden="true">✓</span> آخرین نتیجه</div>
          <div class="prospect-result-content">${latestResultHtml}</div>
        </div>
      ` : ''}

      ${renderVisitHistory(shop)}
    `;

    root.querySelectorAll('[data-snapshot-q]').forEach(function (row) {
      row.addEventListener('click', function () {
        openSnapshotAnswerEditSheet(shop, row.getAttribute('data-snapshot-q'), function () { drawProspectDetail(root); });
      });
    });

    root.querySelectorAll('[data-edit-visit]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const visit = shop.visits.find(function (v) { return v.id === btn.getAttribute('data-edit-visit'); });
        if (visit) openFollowUpEditSheet(shop, visit, function () { drawProspectDetail(root); });
      });
    });

    const addVisitBtn = document.getElementById('btn-add-visit');
    if (addVisitBtn) {
      addVisitBtn.onclick = function () {
        openFollowUpSheet(shop, function () { drawProspectDetail(root); });
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
        if (!(await appConfirm('مغازه «' + shop.name + '» به مشتری CRM تبدیل شود؟\nسوابق ارزیابی در همین بخش باقی می‌ماند.'))) return;
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
        if (shop.linkedCustomerId) navigateToCustomer(shop.linkedCustomerId);
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

    refreshToken = ViewHost.setRefresh(function () { drawProspectDetail(rootEl); });

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
