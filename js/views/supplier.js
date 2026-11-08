/* js/views/supplier.js — SPA Supplier detail view.
   Page = identity + balance → attention → metrics → actions → collapsed history
   (purchases / payments / checks / returns). Every row opens a clean sheet with its details and actions;
   the page itself carries no tiny inline buttons.
   Reuses supplierTotals, supplierCheckEntries helpers, purchaseLines, purchaseReturnRemainingQty/Amount,
   purchaseLineRemainingQty, applyPurchaseStockEffects, applyPurchaseReturnStockEffects, adjustPurchaseLayerQty,
   deleteOrVoidPurchase as-is. Every write goes through commitWithRollback (snapshot → mutate → saveData → restore on failure).
*/
'use strict';

(function (global) {
  let currentSupplierId = null;
  let rootEl = null;
  let rootClickHandler = null;
  let rootKeyHandler = null;

  const CHECK_LABEL = { pending: 'در جریان', cleared: 'پرداخت‌شده', bounced: 'برگشتی' };
  const CHECK_TONE = { pending: 'amber', cleared: 'olive', bounced: 'rust' };
  // Manual transitions. «برگشتی» is final (it re-adds the debt); a wrong one is fixed by deleting the check and registering it again.
  const CHECK_NEXT = { pending: ['cleared', 'bounced'], cleared: ['pending'], bounced: [] };
  const DUE_SOON_DAYS = 3;

  function suppliersHref() { return '#/suppliers'; }
  function fa(n) { return enToFaDigits(String(n)); }
  function currentSupplier() { return (data.suppliers || []).find(x => x && x.id === currentSupplierId) || null; }

  /* ---------- shared helpers ---------- */
  // Snapshot → mutate → saveData; any failure (including a validation throw) restores the snapshot in place.
  async function commitWithRollback(mutate) {
    const previousData = JSON.parse(JSON.stringify(data));
    try {
      const result = mutate();
      await saveData();
      return result;
    } catch (err) {
      restoreDataInPlace(previousData);
      throw err;
    }
  }

  function checkStatus(p) { return p.status === 'cleared' ? 'cleared' : (p.status === 'bounced' ? 'bounced' : 'pending'); }
  function checkFace(p) { return typeof p.faceAmount === 'number' ? p.faceAmount : (p.amount || 0); }
  // Payments are addressed by id when they have one (older ones may not) — never by a position in a sorted copy.
  function payKey(p, realIdx) { return p && p.id ? 'id:' + p.id : 'ix:' + realIdx; }
  function findPayment(s, key) {
    const list = s.payments || [];
    if (String(key).indexOf('id:') === 0) {
      const id = String(key).slice(3);
      const i = list.findIndex(x => x && x.id === id);
      return i < 0 ? null : { p: list[i], index: i };
    }
    const i = parseInt(String(key).slice(3), 10);
    return list[i] ? { p: list[i], index: i } : null;
  }
  function reasonLabel(v) {
    const list = (typeof PURCHASE_RETURN_REASONS !== 'undefined') ? PURCHASE_RETURN_REASONS : [];
    const r = list.find(x => x.value === v);
    return r ? r.label : '';
  }
  function productOf(id) { return (data.products || []).find(x => x && x.id === id) || null; }
  function unitOf(prod) { return prod && prod.packageWeight ? 'بسته' : 'واحد'; }

  function purchaseStocked(p) { return !!(p.productId || (Array.isArray(p.items) && p.items.length)); }
  function purchaseItemCount(p) { return (Array.isArray(p.items) && p.items.length) ? p.items.length : (p.productId ? 1 : 0); }
  function purchaseReturnedTotal(p) { return (p.returns || []).reduce((a, r) => a + (r.amount || 0), 0); }
  // Row title = what was bought (not «N قلم»): first two names, then «و N قلم دیگر».
  function purchaseTitle(p) {
    if (Array.isArray(p.items) && p.items.length) {
      const names = p.items.map(it => it.name || (productOf(it.productId) || {}).name || 'کالا');
      return names.length <= 2 ? names.join('، ') : names.slice(0, 2).join('، ') + ' و ' + fa(names.length - 2) + ' قلم دیگر';
    }
    if (p.productId) return (productOf(p.productId) || {}).name || 'کالا';
    return p.desc || 'خرید';
  }
  function purchaseLinesView(p) {
    if (Array.isArray(p.items) && p.items.length) {
      return p.items.map(it => {
        const prod = productOf(it.productId);
        const qty = Number(it.qty) || 0;
        const unitCost = Number(it.unitCost) || (qty ? (Number(it.lineAmount) || 0) / qty : 0);
        return { id: it.id || null, productId: it.productId, name: it.name || (prod || {}).name || 'کالا', qty, unit: unitOf(prod), unitCost, amount: Number(it.lineAmount) || qty * unitCost };
      });
    }
    if (p.productId && p.qty > 0) {
      const prod = productOf(p.productId);
      return [{ id: null, productId: p.productId, name: (prod || {}).name || 'کالا', qty: Number(p.qty) || 0, unit: unitOf(prod), unitCost: (Number(p.amount) || 0) / p.qty, amount: Number(p.amount) || 0 }];
    }
    return [];
  }
  // A purchase whose stock was already sold/returned cannot be deleted without leaving the ledger and the
  // warehouse disagreeing, so deletion is only offered while none of its layers has been consumed.
  function purchaseConsumed(purchaseId) {
    return (typeof ensureInventoryLayers === 'function' ? ensureInventoryLayers() : [])
      .some(l => l.purchaseId === purchaseId && ((l.qtyOriginal || 0) - (l.qtyRemaining || 0)) > 0);
  }

  // One attention line, same hierarchy as Quick View: bounced (danger) > overdue > due within 3 days (warning).
  // «برگشتی» only counts while the supplier balance is still open (a settled bounced check is history, not an alert).
  function supplierAttention(s, balance) {
    const checks = (s.payments || []).filter(p => p && p.method === 'check');
    const sum = list => list.reduce((a, p) => a + checkFace(p), 0);
    const bounced = checks.filter(p => checkStatus(p) === 'bounced');
    if (bounced.length && balance > 0) {
      return { level: 'danger', text: fa(bounced.length) + ' چک برگشتی — ' + toman(sum(bounced)) + ' ت دوباره به بدهی اضافه شده' };
    }
    const pending = checks.filter(p => checkStatus(p) === 'pending' && supplierCheckDueDiff(p) !== null);
    const overdue = pending.filter(p => supplierCheckDueDiff(p) < 0);
    if (overdue.length) return { level: 'warning', text: fa(overdue.length) + ' چک پرداختی سررسیدگذشته — ' + toman(sum(overdue)) + ' ت' };
    const soon = pending.filter(p => { const d = supplierCheckDueDiff(p); return d >= 0 && d <= DUE_SOON_DAYS; });
    if (soon.length) {
      const nearest = Math.min.apply(null, soon.map(supplierCheckDueDiff));
      return { level: 'warning', text: 'چک پرداختی با سررسید ' + (nearest === 0 ? 'امروز' : fa(nearest) + ' روز دیگر') + (soon.length > 1 ? ' (' + fa(soon.length) + ' چک)' : '') + ' — ' + toman(sum(soon)) + ' ت' };
    }
    return null;
  }

  /* Full-screen host for the purchase form — the same shell the invoice form uses (header / body / total chip).
     Presentation only; invoice code and its protected CSS are untouched. */
  function hostFullSheet(onCancel) {
    const sheetEl = document.querySelector('#modalRoot .sheet');
    if (sheetEl) sheetEl.classList.add('inv-sheet-host');
    const nav = document.getElementById('bottom-nav');
    if (nav && nav.dataset.invoiceHiddenPrev == null) { nav.dataset.invoiceHiddenPrev = nav.hidden ? '1' : '0'; nav.hidden = true; }
    const ov = document.getElementById('overlay');
    if (ov) ov.style.zIndex = '80';
    const x = document.getElementById('closeX');
    if (x) x.style.display = 'none';
    const head = document.querySelector('#modalRoot .inv-header');
    const body = document.querySelector('#modalRoot .inv-body');
    if (head && body) body.style.setProperty('--inv-header-h', head.offsetHeight + 'px');
    const cancel = document.getElementById('pf-cancel');
    if (cancel) cancel.addEventListener('click', async function () {
      if (await window.__requestAppExit('purchase-cancel')) closeModal();
    });
  }

  /* Return-from-purchase sheets (single + multi-item) — logic unchanged; buttons now live in the purchase sheet. */
  function bindPurchaseReturnButtons(s) {
    // Re-attach return buttons (single and multi-item) after re-render
    document.querySelectorAll('[data-return-purchase]').forEach(btn => {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        const purchaseId = this.getAttribute('data-return-purchase');
        const purchase = (s.purchases || []).find(p => p.id === purchaseId);
        if (!purchase) return;

        const isMultiItem = !purchase.productId && Array.isArray(purchase.items) && purchase.items.length > 0;
        const returnedAmountSoFar = (purchase.returns || []).reduce((a, r) => a + (r.amount || 0), 0);
        const remainingAmount = purchaseReturnRemainingAmount(purchase);

        if (isMultiItem) {
          openSheet(`
            <h3>برگشت خرید از ${esc(s.name)}</h3>
            <div class="empty" style="padding:0 0 8px;text-align:right;">${faDate(purchase.date)} — مبلغ کل: ${toman(purchase.amount)} ت${returnedAmountSoFar > 0 ? ` — قبلاً برگشت‌شده: ${toman(returnedAmountSoFar)} ت` : ''}</div>
            <div class="field"><label>تاریخ برگشت</label>${shamsiDateInputHTML('f-ret-date', todayISO())}</div>
            <div id="ret-item-rows">
            ${(purchase.items || []).map(it => {
              // G4: display actual returnable under FIFO+stock (not merely purchase−returned)
              const remLineQty = (typeof purchaseLineActualReturnableQty === 'function')
                ? purchaseLineActualReturnableQty(purchase, it.id)
                : purchaseLineRemainingQty(purchase, it.id);
              if (remLineQty <= 0) {
                return `<div class="field" style="opacity:.55;">
                  <label>${esc(it.name)} (خریداری‌شده: ${it.qty} — <span class="accent-rust">۰ قابل‌برگشت</span>؛ موجودی این خرید مصرف شده)</label>
                  <input class="ret-item-qty" data-item-id="${esc(it.id)}" data-product-id="${esc(it.productId)}" data-unit-cost="${it.unitCost}" data-max="0" type="text" inputmode="decimal" disabled value="">
                </div>`;
              }
              return `<div class="field">
                <label>${esc(it.name)} (خریداری‌شده: ${it.qty}، حداکثر قابل‌برگشت: ${remLineQty})</label>
                <input class="ret-item-qty" data-item-id="${esc(it.id)}" data-product-id="${esc(it.productId)}" data-unit-cost="${it.unitCost}" data-max="${remLineQty}" type="text" inputmode="decimal" placeholder="تعداد برگشتی (اختیاری)">
              </div>`;
            }).join('')}
            </div>
            <div class="empty" style="padding:4px 0;text-align:right;">مبلغ برگشتی (خودکار): <b id="ret-multi-total">۰</b> تومان</div>
            <div class="btn-row"><button class="btn" id="save-return">ثبت برگشت</button></div>
          `);

          function updateMultiRetTotal() {
            let t = 0;
            document.querySelectorAll('.ret-item-qty').forEach(inp => {
              const q = numVal(inp);
              const uc = parseFloat(inp.dataset.unitCost) || 0;
              if (q > 0) t += Math.round(q * uc);
            });
            document.getElementById('ret-multi-total').textContent = toman(t);
          }
          document.querySelectorAll('.ret-item-qty').forEach(inp => {
            inp.addEventListener('input', updateMultiRetTotal);
          });

          document.getElementById('save-return').addEventListener('click', async function (ev) {
            await withSubmitGuard(ev.currentTarget, async () => {
              const date = document.getElementById('f-ret-date').value || todayISO();
              const lineReturns = [];
              let overStock = null;
              document.querySelectorAll('.ret-item-qty').forEach(inp => {
                const q = numVal(inp);
                if (q <= 0) return;
                const max = parseFloat(inp.dataset.max) || 0;
                const prod = data.products.find(x => x.id === inp.dataset.productId);
                if (prod && q > (prod.stockQty || 0)) { overStock = prod; }
                lineReturns.push({ itemId: inp.dataset.itemId, productId: inp.dataset.productId, qty: q, unitCost: parseFloat(inp.dataset.unitCost) || 0, max });
              });
              if (lineReturns.length === 0) { showToast('حداقل مقدار برگشتی یک قلم رو وارد کن'); throw new Error('validation'); }
              const badLine = lineReturns.find(l => l.qty > l.max);
              if (badLine) { showToast('مقدار برگشتی از باقیمانده‌ی قابل‌برگشت این قلم بیشتره.\n\nباقیمانده قابل‌برگشت: ' + badLine.max); throw new Error('validation'); }
              if (overStock) { showToast('موجودی واقعی «' + overStock.name + '» در انبار فقط ' + (overStock.stockQty || 0) + ' عدد است.\n\nمقدار برگشتی نمی‌تواند از موجودی واقعی قابل‌برگشت بیشتر باشد.'); throw new Error('validation'); }
              const totalAmount = lineReturns.reduce((a, l) => a + Math.round(l.qty * l.unitCost), 0);
              if (totalAmount <= 0) { showToast('مبلغ برگشتی رو وارد کن'); throw new Error('validation'); }
              const liveRemainingAmount = purchaseReturnRemainingAmount(purchase);
              if (totalAmount > liveRemainingAmount) { showToast('مبلغ برگشتی از مبلغ باقیمانده‌ی این خرید بیشتره.\n\nمبلغ باقیمانده قابل‌برگشت: ' + toman(liveRemainingAmount) + ' تومان'); throw new Error('validation'); }
              if (!(await appConfirm('با ثبت این برگشت، موجودی انبار و بدهی به تامین‌کننده اصلاح خواهد شد. ادامه می‌دهید؟'))) throw new Error('validation');
              const totalQty = lineReturns.reduce((a, l) => a + l.qty, 0);
              const retLines = lineReturns.map(l => ({ productId: l.productId, qty: l.qty, itemId: l.itemId }));
              const lineItemsSnap = lineReturns.map(l => ({ itemId: l.itemId, productId: l.productId, qty: l.qty, amount: Math.round(l.qty * l.unitCost) }));
              function commitMultiReturn(returnReason) {
                return (async function () {
                  const previousData = JSON.parse(JSON.stringify(data));
                  const retResult = applyPurchaseReturnStockEffects(purchase, retLines, s.name, date);
                  if (!retResult.ok) { showToast(retResult.error || 'برگشت خرید ممکن نشد'); throw new Error('validation'); }
                  purchase.returns = purchase.returns || [];
                  const rec = {
                    id: uid(),
                    date: date,
                    qty: totalQty,
                    amount: totalAmount,
                    items: lineItemsSnap,
                  };
                  if (returnReason) rec.returnReason = returnReason;
                  purchase.returns.push(rec);
                  try { await saveData(); } catch (saveErr) { restoreDataInPlace(previousData); throw saveErr; }
                  closeModal();
                  drawSupplierPage(rootEl);
                  showToast('برگشت خرید ثبت شد');
                })();
              }
              if (typeof openPurchaseReturnReasonPicker === 'function') {
                openPurchaseReturnReasonPicker(function (returnReason) {
                  withSubmitGuard(document.getElementById('save-return'), function () {
                    return commitMultiReturn(returnReason);
                  });
                });
              } else {
                await commitMultiReturn(null);
              }
            });
          });
          return;
        }

        // Single-item return
        const remainingQtyAcct = purchaseReturnRemainingQty(purchase);
        const remainingQty = (typeof purchaseActualReturnableQty === 'function')
          ? purchaseActualReturnableQty(purchase)
          : remainingQtyAcct;
        openSheet(`
          <h3>برگشت خرید از ${esc(s.name)}</h3>
          <div class="empty" style="padding:0 0 8px;text-align:right;">${faDate(purchase.date)} — مبلغ کل: ${toman(purchase.amount)} ت${returnedAmountSoFar > 0 ? ` — قبلاً برگشت‌شده: ${toman(returnedAmountSoFar)} ت` : ''}</div>
          <div class="field"><label>تاریخ برگشت</label>${shamsiDateInputHTML('f-ret-date', todayISO())}</div>
          ${purchase.productId ? (remainingQty > 0
            ? `<div class="field"><label>مقدار برگشتی (حداکثر ${remainingQty})</label><input id="f-ret-qty" type="text" inputmode="decimal"></div>`
            : `<div class="empty" style="padding:8px 0;text-align:right;color:var(--color-danger);">موجودی قابل‌برگشت از این خرید: ۰ (همه مصرف/فروخته شده)</div>`)
            : ''}
          <div class="field"><label>مبلغ برگشتی (تومان، حداکثر ${toman(remainingAmount)})</label><input id="f-ret-amount" type="text" inputmode="decimal" ${purchase.productId && remainingQty <= 0 ? 'disabled' : ''}></div>
          <div class="btn-row"><button class="btn" id="save-return" ${purchase.productId && remainingQty <= 0 ? 'disabled' : ''}>ثبت برگشت</button></div>
        `);
        if (purchase.productId) {
          document.getElementById('f-ret-qty').addEventListener('input', function () {
            const q = numVal(document.getElementById('f-ret-qty'));
            const unitPrice = (purchase.amount && purchase.qty) ? purchase.amount / purchase.qty : 0;
            if (unitPrice > 0) document.getElementById('f-ret-amount').value = Math.round(q * unitPrice);
          });
        }
        document.getElementById('save-return').addEventListener('click', async function (ev) {
          await withSubmitGuard(ev.currentTarget, async () => {
            const date = document.getElementById('f-ret-date').value || todayISO();
            const qty = purchase.productId ? numVal(document.getElementById('f-ret-qty')) : 0;
            const amount = numVal(document.getElementById('f-ret-amount'));
            if (amount <= 0) { showToast('مبلغ برگشتی رو وارد کن'); throw new Error('validation'); }
            if (purchase.productId && qty <= 0) { showToast('مقدار برگشتی رو وارد کن'); throw new Error('validation'); }
            const liveRemainingQty = purchaseReturnRemainingQty(purchase);
            const liveRemainingAmount = purchaseReturnRemainingAmount(purchase);
            if (qty > 0 && qty > liveRemainingQty) {
              showToast('مقدار برگشتی از باقیمانده‌ی قابل‌برگشت این خرید بیشتره.\n\nباقیمانده قابل‌برگشت: ' + liveRemainingQty);
              throw new Error('validation');
            }
            if (purchase.productId && qty > 0) {
              const realStockProd = data.products.find(x => x.id === purchase.productId);
              if (realStockProd && qty > (realStockProd.stockQty || 0)) {
                showToast('موجودی واقعی «' + realStockProd.name + '» در انبار فقط ' + (realStockProd.stockQty || 0) + ' عدد است.\n\nمقدار برگشتی نمی‌تواند از موجودی واقعی قابل‌برگشت بیشتر باشد.');
                throw new Error('validation');
              }
            }
            if (amount > liveRemainingAmount) {
              showToast('مبلغ برگشتی از مبلغ باقیمانده‌ی این خرید بیشتره.\n\nمبلغ باقیمانده قابل‌برگشت: ' + toman(liveRemainingAmount) + ' تومان');
              throw new Error('validation');
            }
            if (!(await appConfirm((purchase.productId ? 'با ثبت این برگشت، موجودی انبار و بدهی به تامین‌کننده اصلاح خواهد شد.' : 'با ثبت این برگشت، فقط بدهی به تامین‌کننده کم می‌شود (موجودی خودکار اصلاح نمی‌شود).') + ' ادامه می‌دهید؟'))) throw new Error('validation');
            function commitSingleReturn(returnReason) {
              return (async function () {
                const previousData = JSON.parse(JSON.stringify(data));
                if (purchase.productId && qty > 0) {
                  const retResult = applyPurchaseReturnStockEffects(purchase, [{ productId: purchase.productId, qty: qty }], s.name, date);
                  if (!retResult.ok) { showToast(retResult.error || 'برگشت خرید ممکن نشد'); throw new Error('validation'); }
                }
                purchase.returns = purchase.returns || [];
                const rec = { id: uid(), date: date, qty: qty, amount: amount };
                if (returnReason) rec.returnReason = returnReason;
                purchase.returns.push(rec);
                try { await saveData(); } catch (saveErr) { restoreDataInPlace(previousData); throw saveErr; }
                closeModal();
                drawSupplierPage(rootEl);
                showToast('برگشت خرید ثبت شد');
              })();
            }
            if (typeof openPurchaseReturnReasonPicker === 'function') {
              openPurchaseReturnReasonPicker(function (returnReason) {
                withSubmitGuard(document.getElementById('save-return'), function () {
                  return commitSingleReturn(returnReason);
                });
              });
            } else {
              await commitSingleReturn(null);
            }
          });
        });
      });
    });
  }

  /* ======================================================================
     Purchase sheet — header: supplier + date · title: «N قلم کالا» · items · returns · totals · actions
     ====================================================================== */
  function openPurchaseSheet(s, purchaseId) {
    const p = (s.purchases || []).find(x => x.id === purchaseId);
    if (!p) return;
    const locked = !!purchaseCanBeEditedOrDeleted(p);
    const ret = purchaseReturnedTotal(p);
    const net = (p.amount || 0) - ret;
    const count = purchaseItemCount(p);
    const lines = purchaseLinesView(p);

    let canReturn = purchaseReturnRemainingAmount(p) > 0;
    if (canReturn && purchaseStocked(p) && typeof purchaseActualReturnableQty === 'function') canReturn = purchaseActualReturnableQty(p) > 0;

    const itemsHtml = lines.length
      ? '<div class="sup-group"><div class="sup-group-title">اقلام</div>' + lines.map(l =>
          '<div class="sup-line"><div class="sup-line-main"><span class="sup-line-name">' + esc(l.name) + '</span>' +
          '<span class="sup-line-meta">' + fa(l.qty) + ' ' + l.unit + ' × ' + toman(l.unitCost) + ' ت</span></div>' +
          '<span class="sup-line-amount">' + toman(l.amount) + ' ت</span></div>').join('') + '</div>'
      : '<div class="sup-group"><div class="sup-group-title">شرح</div><div class="sup-line"><div class="sup-line-main"><span class="sup-line-name">خرید بدون کالا (فقط مبلغ کل)</span>' +
        (p.desc ? '<span class="sup-line-meta">' + esc(p.desc) + '</span>' : '') + '</div></div></div>';

    const returns = (p.returns || []).slice().sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
    const returnsHtml = returns.length
      ? '<div class="sup-group"><div class="sup-group-title">برگشت‌ها (' + fa(returns.length) + ')</div>' + returns.map(r => {
          const what = Array.isArray(r.items) && r.items.length
            ? r.items.map(i => esc(((productOf(i.productId) || {}).name || 'کالا')) + ' × ' + fa(i.qty)).join('، ')
            : (r.qty > 0 ? fa(r.qty) + ' ' + unitOf(productOf(p.productId)) : '');
          const why = reasonLabel(r.returnReason);
          return '<div class="sup-line"><div class="sup-line-main"><span class="sup-line-name">' + faDate(r.date) +
            (why ? ' <span class="sup-chip">' + esc(why) + '</span>' : '') + '</span>' +
            (what ? '<span class="sup-line-meta">' + what + '</span>' : '') + '</div>' +
            '<span class="sup-line-amount is-minus">− ' + toman(r.amount || 0) + ' ت</span></div>';
        }).join('') + '</div>'
      : '';

    openSheet(`
      <div class="sup-sheet">
        <div class="sup-sheet-head">
          <div class="sup-sheet-top"><span class="sup-sheet-supplier">${esc(s.name)}</span><span class="sup-sheet-date">${faDate(p.date)}</span></div>
          <h3 class="sup-sheet-title">${count ? 'خرید ' + fa(count) + ' قلم کالا' : esc(p.desc || 'خرید')}</h3>
          ${count && p.desc ? '<div class="sup-sheet-note">' + esc(p.desc) + '</div>' : ''}
        </div>
        ${itemsHtml}
        ${returnsHtml}
        <div class="sup-totals">
          <div class="sup-total-row"><span>جمع خرید</span><span>${toman(p.amount || 0)} ت</span></div>
          ${ret ? '<div class="sup-total-row"><span>برگشت از خرید</span><span class="is-minus">− ' + toman(ret) + ' ت</span></div>' : ''}
          <div class="sup-total-row is-final"><span>خالص خرید</span><span>${toman(net)} ت</span></div>
        </div>
        <div class="sup-sheet-actions">
          ${canReturn ? '<button type="button" class="btn secondary sup-act" data-return-purchase="' + esc(p.id) + '">برگشت خرید</button>' : ''}
          ${locked ? '' : '<button type="button" class="btn secondary sup-act" id="sp-edit">ویرایش</button><button type="button" class="btn danger sup-act" id="sp-del">حذف خرید</button>'}
        </div>
      </div>
    `);
    bindPurchaseReturnButtons(s);
    if (!locked) {
      document.getElementById('sp-edit').addEventListener('click', () => openPurchaseEditSheet(s, p.id));
      document.getElementById('sp-del').addEventListener('click', ev => deletePurchase(s, p.id, ev.currentTarget));
    }
  }

  async function deletePurchase(s, purchaseId, btn) {
    const p = (s.purchases || []).find(x => x.id === purchaseId);
    if (!p) return;
    if (purchaseStocked(p) && purchaseConsumed(p.id)) {
      showToast('بخشی از کالای این خرید فروخته یا برگشت خورده؛ حذف ممکن نیست.\nبرای اصلاح، «برگشت خرید» را ثبت کن.');
      return;
    }
    const hasReturns = (p.returns || []).length > 0;
    const msg = 'این خرید به مبلغ ' + toman(p.amount || 0) + ' تومان حذف شود؟\nبدهی به تامین‌کننده کم می‌شود' +
      (purchaseStocked(p) ? ' و موجودی انبار همین خرید هم برمی‌گردد' : '') + (hasReturns ? ' (برگشت‌های ثبت‌شدهٔ این خرید هم حذف می‌شوند)' : '') + '.';
    if (!(await appConfirm(msg))) return;
    await withSubmitGuard(btn, async () => {
      await commitWithRollback(() => {
        const r = hardDeletePurchaseLayers(p.id);
        if (!r || !r.ok) { showToast((r && r.error) || 'حذف خرید ممکن نشد'); throw new Error('validation'); }
        const idx = (s.purchases || []).findIndex(x => x.id === p.id);
        if (idx >= 0) s.purchases.splice(idx, 1);
      });
      closeModal();
      drawSupplierPage(rootEl);
      showToast('خرید حذف شد');
    });
  }


  function purchaseCanBeEditedOrDeleted(p) {
    if (!p) return 'خرید پیدا نشد.';
    if ((p.returns || []).length) return 'این خرید برگشت‌خورده است و قابل ویرایش یا حذف نیست.';
    if (purchaseStocked(p) && purchaseConsumed(p.id)) return 'بخشی از کالای این خرید مصرف یا فروخته شده است و قابل ویرایش یا حذف نیست.';
    return '';
  }

  function openPurchaseEditSheet(s, purchaseId) {
    const p = (s.purchases || []).find(x => x.id === purchaseId);
    if (!p) return;
    const blocked = purchaseCanBeEditedOrDeleted(p);
    if (blocked) { showToast(blocked); return; }

    const stocked = purchaseStocked(p);
    const lines = purchaseLinesView(p);
    const returned = purchaseReturnedTotal(p);
    let model = stocked ? lines.map(l => ({
      id: l.id, productId: l.productId, name: l.name, qty: String(l.qty), price: l.unitCost, unit: l.unit, expanded: false
    })) : [];

    openSheet(`
      <div class="inv-sheet-v2 pf-sheet">
        <div class="inv-header">
          <button type="button" class="inv-header-btn" id="pe-cancel">لغو</button>
          <div class="inv-header-title">
            <span class="inv-header-title-main">ویرایش خرید</span>
            <span class="inv-header-title-sub">${esc(s.name)}</span>
          </div>
          <button type="button" class="btn inv-header-save" id="pe-save">ذخیره</button>
        </div>
        <div class="inv-body">
          <div class="inv-total-chip"><span class="inv-total-chip-label">جمع خرید</span><strong class="inv-total-chip-value" id="pe-total">${toman(p.amount || 0)} ت</strong></div>
          <div class="inv-section">
            <h2 class="inv-section-title">مشخصات خرید</h2>
            <div class="inv-rows">
              ${stocked ? `<div class="inv-row"><span class="inv-row-label">تاریخ خرید</span><span class="inv-row-value">${faDate(p.date)}</span></div>` :
                `<div class="inv-row inv-row-date"><span class="inv-row-label">تاریخ خرید</span>${shamsiDateInputHTML('pe-date', p.date || todayISO())}</div>`}
              <div class="inv-row"><label class="inv-row-label" for="pe-desc">توضیح <small>(اختیاری)</small></label><input id="pe-desc" class="pf-row-input" value="${esc(p.desc || '')}"></div>
            </div>
          </div>
          ${stocked ? `<div class="inv-section inv-items-section">
            <h2 class="inv-section-title">اقلام خرید</h2>
            <div class="inv-items-card"><div id="pe-lines"></div></div>
            <div class="empty sup-edit-note">قیمت واحد ثابت می‌ماند؛ با تغییر تعداد، جمع خرید محاسبه می‌شود.</div>
          </div>` : `<div class="inv-section">
            <div class="inv-rows"><div class="inv-row"><label class="inv-row-label" for="pe-amount">مبلغ کل (تومان)</label><input id="pe-amount" type="text" inputmode="decimal" value="${p.amount || ''}"></div></div>
          </div>`}
        </div>
      </div>
    `, { dirtyCheck: true });
    hostFullSheet();

    const $ = id => document.getElementById(id);
    const lineHtml = (l, i) => {
      const qty = numVal({ value: l.qty });
      const amount = qty * (Number(l.price) || 0);
      return `<div class="inv-line${l.expanded ? ' is-active' : ''}" data-i="${i}">
        <div class="inv-line-collapsed" role="button" tabindex="0" aria-label="ویرایش ${esc(l.name)}" ${l.expanded ? 'hidden' : ''}>
          <div class="inv-line-body"><span class="inv-line-name">${esc(l.name)}</span></div>
          <div class="inv-line-figures"><span class="inv-line-amount">${toman(amount)} ت</span><span class="inv-line-calc">${fa(qty)} × ${toman(l.price)} ت</span></div>
        </div>
        <div class="inv-line-view-active" ${l.expanded ? '' : 'hidden'}>
          <div class="inv-line-main"><div class="row-product-search inv-line-name">${esc(l.name)}</div></div>
          <div class="inv-line-sub" style="display:flex"><span class="inv-line-qtyrate">
            <input type="text" inputmode="decimal" class="pe-qty inv-mini-input" value="${esc(l.qty)}" data-i="${i}" aria-label="تعداد">
            <span class="inv-line-x">×</span><span class="inv-mini-input">${toman(l.price)} ت</span>
          </span></div>
        </div>
      </div>`;
    };
    function renderEditLines() {
      $('pe-lines').innerHTML = model.map(lineHtml).join('');
      $('pe-total').textContent = toman(model.reduce((sum, l) => sum + numVal({value:l.qty}) * (Number(l.price)||0), 0)) + ' ت';
      $('pe-lines').querySelectorAll('.pe-qty').forEach(el => el.addEventListener('input', () => {
        const i = Number(el.dataset.i);
        model[i].qty = el.value;
        const row = el.closest('.inv-line');
        const qty = numVal(el), price = Number(model[i].price) || 0;
        const summary = row && row.querySelector('.inv-line-collapsed');
        if (summary) {
          summary.querySelector('.inv-line-amount').textContent = toman(qty * price) + ' ت';
          summary.querySelector('.inv-line-calc').textContent = fa(qty) + ' × ' + toman(price) + ' ت';
        }
        $('pe-total').textContent = toman(model.reduce((sum, l) => sum + numVal({value:l.qty}) * (Number(l.price)||0), 0)) + ' ت';
      }));
      $('pe-lines').querySelectorAll('.inv-line-collapsed').forEach(el => {
        const activate = () => { const i = Number(el.closest('.inv-line').dataset.i); model.forEach((l, n) => l.expanded = n === i); renderEditLines(); };
        el.addEventListener('click', activate);
        el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); } });
      });
    }
    if (stocked) renderEditLines();

    $('pe-cancel').addEventListener('click', async () => { if (await window.__requestAppExit('purchase-edit-cancel')) closeModal(); });
    $('pe-save').addEventListener('click', async function (ev) {
      await withSubmitGuard(ev.currentTarget, async () => {
        const desc = ($('pe-desc').value || '').trim();
        if (!stocked) {
          const amount = numVal($('pe-amount'));
          if (!(amount > 0)) { showToast('مبلغ رو وارد کن'); throw new Error('validation'); }
          if (amount < returned) { showToast('مبلغ خرید نمی‌تواند کمتر از جمع برگشت‌های ثبت‌شده باشد'); throw new Error('validation'); }
          await commitWithRollback(() => { p.amount = amount; p.date = $('pe-date').value || p.date || todayISO(); p.desc = desc; });
        } else {
          const qtys = model.map(l => numVal({value:l.qty}));
          if (qtys.some(q => !(q > 0))) { showToast('تعداد همه اقلام باید بیشتر از صفر باشد'); throw new Error('validation'); }
          await commitWithRollback(() => {
            const isItems = Array.isArray(p.items) && p.items.length;
            const unitLegacy = (!isItems && p.qty > 0) ? (Number(p.amount) || 0) / p.qty : 0;
            lines.forEach((l, i) => {
              if (qtys[i] === l.qty) return;
              const r = adjustPurchaseLayerQty(p.id, l.productId, qtys[i], l.id);
              if (!r || !r.ok) { showToast((r && r.error) || 'ویرایش تعداد ممکن نشد'); throw new Error('validation'); }
            });
            p.amount = isItems
              ? p.items.reduce((a, it) => a + (Number(it.lineAmount) || (Number(it.qty) || 0) * (Number(it.unitCost) || 0)), 0)
              : Math.round(unitLegacy * (Number(p.qty) || 0));
            if (p.amount < returned) { showToast('مبلغ خرید نمی‌تواند کمتر از جمع برگشت‌های ثبت‌شده باشد'); throw new Error('validation'); }
            p.desc = desc;
          });
        }
        closeModal(); drawSupplierPage(rootEl); showToast('خرید ویرایش شد');
      });
    });
  }


  /* ======================================================================
     Payment + check sheets
     ====================================================================== */
  function openPaymentSheet(s, key) {
    const f = findPayment(s, key);
    if (!f || f.p.method === 'check') return;
    const p = f.p;
    openSheet(`
      <div class="sup-sheet">
        <div class="sup-sheet-head">
          <div class="sup-sheet-top"><span class="sup-sheet-supplier">${esc(s.name)}</span><span class="sup-sheet-date">${faDate(p.date)}</span></div>
          <h3 class="sup-sheet-title">پرداخت نقد / کارت / انتقال</h3>
        </div>
        <div class="sup-totals"><div class="sup-total-row is-final"><span>مبلغ</span><span>${toman(p.amount)} ت</span></div></div>
        ${p.note ? '<div class="sup-group"><div class="sup-group-title">توضیح</div><div class="sup-line"><span class="sup-line-name">' + esc(p.note) + '</span></div></div>' : ''}
        <div class="sup-sheet-actions">
          <button type="button" class="btn secondary sup-act" id="sp-edit">ویرایش</button>
          <button type="button" class="btn danger sup-act" id="sp-del">حذف پرداخت</button>
        </div>
      </div>`);
    document.getElementById('sp-del').addEventListener('click', ev => deletePayment(s, key, ev.currentTarget));
    document.getElementById('sp-edit').addEventListener('click', () => openEditSupplierPaymentSheet(s, key));
  }

  function openEditSupplierPaymentSheet(s, key) {
    const f = findPayment(s, key);
    if (!f || f.p.method === 'check') return;
    const p = f.p;
    openSheet(`
      <h3>ویرایش پرداخت</h3>
      <div class="field"><label>مبلغ (تومان)</label><input id="sep-amount" type="text" inputmode="decimal" value="${p.amount || ''}"></div>
      <div class="field"><label>تاریخ پرداخت</label>${shamsiDateInputHTML('sep-date', p.date || todayISO())}</div>
      <div class="field"><label>توضیح</label><input id="sep-note" value="${esc(p.note || '')}"></div>
      <div class="btn-row"><button class="btn" id="save-sup-pay-edit">ذخیره</button></div>
    `, { dirtyCheck: true });
    document.getElementById('save-sup-pay-edit').addEventListener('click', async function (ev) {
      await withSubmitGuard(ev.currentTarget, async () => {
        const amount = numVal(document.getElementById('sep-amount'));
        if (amount <= 0) { showToast('مبلغ را وارد کن'); throw new Error('validation'); }
        await commitWithRollback(() => {
          const again = findPayment(s, key);
          if (!again) { showToast('پرداخت پیدا نشد'); throw new Error('validation'); }
          again.p.amount = amount;
          again.p.date = document.getElementById('sep-date').value || todayISO();
          again.p.note = (document.getElementById('sep-note').value || '').trim();
        });
        closeModal();
        drawSupplierPage(rootEl);
        showToast('پرداخت ویرایش شد');
      });
    });
  }

  async function deletePayment(s, key, btn) {
    const f = findPayment(s, key);
    if (!f) return;
    const p = f.p;
    const isCheck = p.method === 'check';
    const isBounced = isCheck && checkStatus(p) === 'bounced';
    const label = isCheck ? ('چک' + (p.checkNumber ? (' #' + p.checkNumber) : '')) : 'پرداخت';
    const msg = isBounced
      ? '«' + label + '» برگشتی است و در محاسبه بدهی اثری ندارد؛ فقط سابقه حذف می‌شود. ادامه می‌دهید؟'
      : '«' + label + '» به مبلغ ' + toman(isCheck ? checkFace(p) : p.amount) + ' تومان حذف شود؟\nمانده حساب تامین‌کننده اصلاح می‌شود.';
    if (!(await appConfirm(msg))) return;
    await withSubmitGuard(btn, async () => {
      await commitWithRollback(() => {
        const again = findPayment(s, key);
        if (!again) { showToast('پرداخت پیدا نشد'); throw new Error('validation'); }
        s.payments.splice(again.index, 1);
      });
      closeModal();
      drawSupplierPage(rootEl);
      showToast('حذف شد');
    });
  }

  function openCheckSheet(s, key) {
    const f = findPayment(s, key);
    if (!f || f.p.method !== 'check') return;
    const p = f.p;
    const st = checkStatus(p);
    const diff = supplierCheckDueDiff(p);
    const dueNote = st !== 'pending' || diff === null ? '' : (diff < 0 ? fa(-diff) + ' روز از سررسید گذشته' : (diff === 0 ? 'سررسید امروز است' : fa(diff) + ' روز تا سررسید'));
    const kv = (k, v) => v ? '<div class="sup-kv-row"><span class="sup-kv-k">' + k + '</span><span class="sup-kv-v">' + v + '</span></div>' : '';
    const next = CHECK_NEXT[st];

    openSheet(`
      <div class="sup-sheet">
        <div class="sup-sheet-head">
          <div class="sup-sheet-top"><span class="sup-sheet-supplier">${esc(s.name)}</span><span class="sup-badge is-${CHECK_TONE[st]}">${CHECK_LABEL[st]}</span></div>
          <h3 class="sup-sheet-title">چک ${p.checkNumber ? 'شماره ' + esc(p.checkNumber) : 'پرداختی'}</h3>
        </div>
        <div class="sup-totals"><div class="sup-total-row is-final"><span>مبلغ چک</span><span>${toman(checkFace(p))} ت</span></div></div>
        <div class="sup-group">
          ${kv('تاریخ صدور', faDate(p.issueDate || p.date))}
          ${kv('تاریخ سررسید', p.dueDate ? faDate(p.dueDate) + (dueNote ? ' <span class="sup-kv-warn">· ' + dueNote + '</span>' : '') : '')}
          ${kv('بانک', p.bank ? esc(p.bank) : '')}
          ${kv('توضیح', p.note ? esc(p.note) : '')}
        </div>
        ${st === 'bounced' ? '<div class="sup-sheet-note">چک برگشتی قطعی است و مبلغ آن در بدهی حساب است. برای اصلاح، چک را حذف و دوباره ثبت کن.</div>' : ''}
        <div class="sup-sheet-actions">
          ${next.indexOf('cleared') >= 0 ? '<button type="button" class="btn sup-act" data-check-to="cleared">ثبت «پرداخت‌شده»</button>' : ''}
          ${next.indexOf('pending') >= 0 ? '<button type="button" class="btn secondary sup-act" data-check-to="pending">برگرداندن به «در جریان»</button>' : ''}
          ${next.indexOf('bounced') >= 0 ? '<button type="button" class="btn danger sup-act" data-check-to="bounced">ثبت «برگشتی»</button>' : ''}
          <button type="button" class="btn secondary sup-act" id="sc-edit">ویرایش مشخصات</button>
          <button type="button" class="btn danger sup-act" id="sc-del">حذف چک</button>
        </div>
      </div>`);
    document.querySelectorAll('[data-check-to]').forEach(btn => btn.addEventListener('click', ev => changeCheckStatus(s, key, btn.getAttribute('data-check-to'), ev.currentTarget)));
    document.getElementById('sc-edit').addEventListener('click', () => openCheckEditSheet(s, key));
    document.getElementById('sc-del').addEventListener('click', ev => deletePayment(s, key, ev.currentTarget));
  }

  async function changeCheckStatus(s, key, to, btn) {
    const f = findPayment(s, key);
    if (!f) return;
    const p = f.p;
    const cur = checkStatus(p);
    if (CHECK_NEXT[cur].indexOf(to) < 0) { showToast('این تغییر وضعیت مجاز نیست'); return; }
    const face = checkFace(p);
    const msg = to === 'cleared'
      ? 'این چک به مبلغ ' + toman(face) + ' تومان «پرداخت‌شده» ثبت شود؟'
      : (to === 'bounced'
        ? 'این چک «برگشتی» ثبت شود؟\nمبلغ ' + toman(face) + ' تومان دوباره به بدهی شما به این تامین‌کننده اضافه می‌شود.\nاین وضعیت قطعی است و برنمی‌گردد.'
        : 'وضعیت این چک به «در جریان» برگردد؟');
    if (!(await appConfirm(msg))) return;
    await withSubmitGuard(btn, async () => {
      await commitWithRollback(() => {
        const again = findPayment(s, key);
        if (!again || CHECK_NEXT[checkStatus(again.p)].indexOf(to) < 0) {
          showToast('وضعیت این چک قابل تغییر به این حالت نیست');
          throw new Error('validation');
        }
        again.p.faceAmount = checkFace(again.p);
        again.p.status = to;
        again.p.amount = (to === 'bounced') ? 0 : again.p.faceAmount;   // bounced = not paid → back in the balance
      });
      closeModal();
      drawSupplierPage(rootEl);
      showToast(to === 'cleared' ? 'چک پرداخت‌شده شد' : (to === 'bounced' ? 'چک برگشتی شد — به بدهی اضافه شد' : 'چک در جریان شد'));
    });
  }

  function openCheckEditSheet(s, key) {
    const f = findPayment(s, key);
    if (!f || f.p.method !== 'check') return;
    const p = f.p;
    openSheet(`
      <h3>ویرایش مشخصات چک</h3>
      <div class="field"><label>مبلغ (تومان)</label><input id="f-amount" type="text" inputmode="decimal" value="${checkFace(p) || ''}"></div>
      <div class="field"><label>تاریخ صدور</label>${shamsiDateInputHTML('f-date', p.issueDate || p.date || todayISO())}</div>
      <div class="field"><label>تاریخ سررسید</label>${shamsiDateInputHTML('f-due', p.dueDate || todayISO())}</div>
      <div class="field"><label>شماره چک</label><input id="f-check-num" value="${esc(p.checkNumber || '')}"></div>
      <div class="field"><label>بانک</label><input id="f-bank" value="${esc(p.bank || '')}"></div>
      <div class="field"><label>توضیح</label><input id="f-note" value="${esc(p.note || '')}"></div>
      <div class="empty sup-edit-note">وضعیت چک از صفحهٔ جزئیات و با تأیید تغییر می‌کند.</div>
      <div class="btn-row"><button class="btn" id="save-sup-check-edit">ذخیره</button></div>
    `, { dirtyCheck: true });
    document.getElementById('save-sup-check-edit').addEventListener('click', async function (ev) {
      await withSubmitGuard(ev.currentTarget, async () => {
        const amount = numVal(document.getElementById('f-amount'));
        if (amount <= 0) { showToast('مبلغ رو وارد کن'); throw new Error('validation'); }
        const _iss = document.getElementById('f-date').value || todayISO();
        const _due = document.getElementById('f-due').value || _iss;
        if (_due < _iss) { showToast('تاریخ سررسید نمی‌تواند قبل از تاریخ صدور باشد'); throw new Error('validation'); }
        await commitWithRollback(() => {
          const again = findPayment(s, key);
          if (!again) { showToast('چک پیدا نشد'); throw new Error('validation'); }
          const q = again.p;
          q.faceAmount = amount;
          q.amount = (checkStatus(q) === 'bounced') ? 0 : amount;   // status itself is NOT editable here
          q.issueDate = _iss;
          q.date = q.issueDate;
          q.dueDate = _due;
          q.checkNumber = (document.getElementById('f-check-num').value || '').trim();
          q.bank = (document.getElementById('f-bank').value || '').trim();
          q.note = (document.getElementById('f-note').value || '').trim();
        });
        closeModal();
        drawSupplierPage(rootEl);
        showToast('چک ویرایش شد');
      });
    });
  }

  /* ======================================================================
     Purchase form — invoice-style full sheet: header (لغو · title · ثبت) → floating total →
     supplier → items card (product · qty · unit price · line total) → details → summary
     ====================================================================== */

  function openAddPurchaseSheet(s) {
    const products = (data.products || []).filter(p => p && p.active !== false)
      .slice().sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'fa'));
    let mode = 'items';
    let model = [{ productId: '', qty: 1, price: 0, expanded: true, queryOpen: false }];

    openSheet(`
      <div class="inv-sheet-v2 pf-sheet">
        <div class="inv-header">
          <button type="button" class="inv-header-btn" id="pf-cancel">لغو</button>
          <div class="inv-header-title"><span class="inv-header-title-main">خرید جدید</span><span class="inv-header-title-sub">${esc(s.name)}</span></div>
          <button type="button" class="btn inv-header-save" id="pf-save">ثبت</button>
        </div>
        <div class="inv-body">
          <div class="inv-total-chip" role="status" aria-live="polite"><span class="inv-total-chip-label">جمع این خرید</span><strong class="inv-total-chip-value" id="pf-total">۰ ت</strong></div>
          <div class="inv-section">
            <h2 class="inv-section-title">تأمین‌کننده</h2>
            <div class="inv-rows">
              <div class="inv-row"><span class="inv-row-label">نام</span><span class="inv-row-value">${esc(s.name)}</span></div>
              ${s.phone ? '<div class="inv-row"><span class="inv-row-label">تلفن</span><span class="inv-row-value">' + esc(s.phone) + '</span></div>' : ''}
            </div>
          </div>
          <div class="inv-section">
            <h2 class="inv-section-title">مشخصات خرید</h2>
            <div class="inv-rows">
              <div class="inv-row inv-row-date"><span class="inv-row-label">تاریخ خرید</span>${shamsiDateInputHTML('f-date', todayISO())}</div>
              <div class="inv-row"><label class="inv-row-label" for="f-desc">توضیح <small>(اختیاری)</small></label><input id="f-desc" class="pf-row-input" placeholder="مثلاً شماره بار"></div>
            </div>
          </div>
          <div class="inv-section inv-items-section">
            <div class="inv-items-card-head pf-items-head">
              <span class="inv-items-card-label" id="pf-items-label">اقلام خرید</span>
              <button type="button" class="pf-link" id="pf-mode">فقط مبلغ کل (بدون کالا)</button>
            </div>
            <div class="inv-items-card">
              <div id="pf-lines"></div>
              <div id="pf-amount-wrap" class="pf-amount" hidden>
                <label for="pf-amount">مبلغ کل خرید (تومان)</label>
                <input id="pf-amount" type="text" inputmode="decimal" placeholder="مبلغ را وارد کنید">
                <small>این خرید فقط روی بدهی اثر می‌گذارد و موجودی انبار تغییر نمی‌کند.</small>
              </div>
              <button type="button" class="inv-add-line" id="pf-add"><span class="inv-add-line-icon" aria-hidden="true">+</span> افزودن قلم جدید</button>
            </div>
          </div>
          <div class="inv-section pf-summary"><div class="sup-totals">
            <div class="sup-total-row"><span>تعداد اقلام</span><span id="pf-count">۰</span></div>
            <div class="sup-total-row is-final"><span>جمع کل خرید</span><span id="pf-sum">۰ ت</span></div>
          </div></div>
        </div>
      </div>
    `, { dirtyCheck: true });
    hostFullSheet();

    const $ = id => document.getElementById(id);
    const prodOf = id => products.find(p => p.id === id);
    const lineHtml = (l, i) => {
      const prod = prodOf(l.productId);
      const amount = (Number(l.qty)||0) * (Number(l.price)||0);
      const complete = !!(prod && Number(l.qty)>0 && Number(l.price)>0);
      return `<div class="inv-line${complete && !l.expanded ? '' : ' is-active'}${prod ? '' : ' inv-line-empty'}" data-i="${i}">
        ${complete ? `<div class="inv-line-collapsed" role="button" tabindex="0" aria-label="ویرایش ${esc(prod.name)}" ${l.expanded ? 'hidden' : ''}>
          <div class="inv-line-body"><span class="inv-line-name">${esc(prod.name)}</span></div>
          <div class="inv-line-figures"><span class="inv-line-amount">${toman(amount)} ت</span><span class="inv-line-calc">${fa(l.qty)} × ${toman(l.price)} ت</span></div>
        </div>` : ''}
        <div class="inv-line-view-active" ${complete && !l.expanded ? 'hidden' : ''}>
          <div class="inv-line-main">
            <input type="text" class="row-product-search inv-line-name" readonly inputmode="none" autocomplete="off" placeholder="انتخاب کالا..." value="${prod ? esc(prod.name) : ''}" aria-label="انتخاب کالا">
            ${model.length > 1 ? `<button type="button" class="inv-line-del row-del" data-del="${i}" aria-label="حذف این قلم">×</button>` : ''}
            <span class="inv-line-chevron" aria-hidden="true">›</span>
            <div class="prod-drop" ${l.queryOpen ? '' : 'hidden'}>
              <div class="prod-drop-panel">
                <div class="prod-drop-search-wrap"><input type="search" class="prod-drop-search" data-search="${i}" placeholder="جستجوی کالا..." value="${esc(l.query || '')}" autocomplete="off"></div>
                <div class="prod-drop-list">${productListHtml(i, l.query || '')}</div>
              </div>
            </div>
          </div>
          <div class="inv-line-sub" style="${prod ? 'display:flex' : 'display:none'}">
            <span class="inv-line-qtyrate">
              <input type="text" inputmode="decimal" class="pf-qty inv-mini-input" data-i="${i}" aria-label="تعداد" value="${esc(String(l.qty))}">
              <span class="inv-line-x">×</span>
              <input type="text" inputmode="decimal" class="pf-price inv-mini-input inv-mini-input-price" data-i="${i}" aria-label="قیمت واحد" value="${esc(String(l.price))}">
              <span class="inv-line-unit">ت</span>
            </span>
          </div>
          ${prod ? `<div class="inv-line-avg-cost">موجودی فعلی: ${fa(prod.stockQty||0)} ${unitOf(prod)}</div>` : ''}
        </div>
      </div>`;
    };
    function productListHtml(i, query) {
      const q = String(query || '').trim();
      const matches = products.filter(p => !q || String(p.name || '').toLocaleLowerCase().includes(q.toLocaleLowerCase())).slice(0, 50);
      return matches.length ? matches.map(p => `<div class="prod-drop-item" data-pick="${i}" data-pid="${esc(p.id)}" role="button" tabindex="0">
        <span class="prod-drop-ico" aria-hidden="true">◈</span><span class="prod-drop-main"><span class="prod-drop-name">${esc(p.name)}</span></span>
        <span class="prod-drop-stock">${fa(p.stockQty||0)}</span><span class="prod-drop-chevron">›</span></div>`).join('') : '<div class="prod-drop-empty">کالایی پیدا نشد</div>';
    }
    function updateTotals() {
      const total = mode === 'amount' ? numVal($('pf-amount')) : model.reduce((sum,l)=>sum+(Number(l.qty)||0)*(Number(l.price)||0),0);
      const count = mode === 'amount' ? 0 : model.filter(l => l.productId).length;
      $('pf-total').textContent = toman(total) + ' ت';
      $('pf-sum').textContent = toman(total) + ' ت';
      $('pf-count').textContent = mode === 'amount' ? 'بدون کالا' : fa(count);
    }
    function renderLines(focusSearch) {
      $('pf-lines').innerHTML = model.map(lineHtml).join('');
      updateTotals();
      if (focusSearch) {
        const input = $('pf-lines').querySelector(`.prod-drop-search[data-search="${focusSearch.index}"]`);
        if (input) input.focus();
      }
    }
    function applyMode() {
      const amountOnly = mode === 'amount';
      $('pf-lines').hidden = amountOnly; $('pf-add').hidden = amountOnly; $('pf-amount-wrap').hidden = !amountOnly;
      $('pf-items-label').textContent = amountOnly ? 'مبلغ کل' : 'اقلام خرید';
      $('pf-mode').textContent = amountOnly ? 'ثبت با اقلام کالا' : 'فقط مبلغ کل (بدون کالا)';
      updateTotals();
    }
    $('pf-lines').addEventListener('focusin', e => {
      if (e.target.classList.contains('pf-qty') || e.target.classList.contains('pf-price')) {
        const i = Number(e.target.dataset.i);
        if (model[i] && model[i].queryOpen) {
          model[i].queryOpen = false;
          const drop = e.target.closest('.inv-line').querySelector('.prod-drop');
          if (drop) { drop.hidden = true; drop.classList.remove('is-open'); }
        }
      }
    });
    $('pf-lines').addEventListener('input', e => {
      const i = Number(e.target.dataset.i);
      if (e.target.classList.contains('pf-qty') || e.target.classList.contains('pf-price')) {
        const l = model[i]; if (!l) return;
        const numeric = parseFloat(faToEnDigits(e.target.value)) || 0;
        if (e.target.classList.contains('pf-qty')) l.qty = numeric;
        else l.price = numeric;
        updateTotals();
        const row = e.target.closest('.inv-line');
        const prod = prodOf(l.productId);
        if (prod && Number(l.qty)>0 && Number(l.price)>0) {
          const summary = row.querySelector('.inv-line-collapsed');
          if (summary) {
            summary.querySelector('.inv-line-amount').textContent = toman(Number(l.qty)*Number(l.price)) + ' ت';
            summary.querySelector('.inv-line-calc').textContent = fa(Number(l.qty)) + ' × ' + toman(Number(l.price)) + ' ت';
          }
        }
      } else if (e.target.classList.contains('prod-drop-search')) {
        const idx = Number(e.target.dataset.search); model[idx].query = e.target.value;
        const list = e.target.closest('.prod-drop-panel').querySelector('.prod-drop-list');
        list.innerHTML = productListHtml(idx, e.target.value);
      }
    });
    $('pf-lines').addEventListener('click', e => {
      const pick = e.target.closest('[data-pick]');
      if (pick) {
        const i = Number(pick.dataset.pick), l = model[i];
        l.productId = pick.dataset.pid; l.queryOpen = false; l.query = '';
        l.expanded = true; renderLines();
        const qty = $('pf-lines').querySelector(`.pf-qty[data-i="${i}"]`);
        if (qty) qty.focus();
        return;
      }
      const del = e.target.closest('[data-del]');
      if (del) {
        model.splice(Number(del.dataset.del), 1); renderLines(); return;
      }
      const collapsed = e.target.closest('.inv-line-collapsed');
      if (collapsed) {
        const i = Number(collapsed.closest('.inv-line').dataset.i);
        model.forEach((l,n)=>l.expanded=n===i); renderLines(); return;
      }
      const productInput = e.target.closest('.row-product-search');
      if (productInput) {
        const i = Number(productInput.closest('.inv-line').dataset.i);
        model[i].queryOpen = true; model.forEach((l,n)=>{if(n!==i)l.queryOpen=false;});
        renderLines({index:i}); return;
      }
      const activeRow = e.target.closest('.inv-line.is-active');
      if (activeRow && !e.target.closest('input, button, .prod-drop, .inv-line-qtyrate, .inv-line-del, .row-product-search')) {
        const i = Number(activeRow.dataset.i);
        if (model[i] && model[i].productId) {
          model[i].expanded = false;
          model[i].queryOpen = false;
          renderLines();
          return;
        }
      }
    });
    $('pf-lines').addEventListener('keydown', e => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.closest('[data-pick]')) { e.preventDefault(); e.target.closest('[data-pick]').click(); }
      if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('inv-line-collapsed')) { e.preventDefault(); e.target.click(); }
    });
    $('pf-amount').addEventListener('input', updateTotals);
    $('pf-add').addEventListener('click', () => {
      const emptyIdx = model.findIndex(l => !l.productId);
      if (emptyIdx >= 0) {
        const i = emptyIdx;
        model.forEach((l, n) => { l.expanded = n === i; l.queryOpen = n === i; });
        renderLines({index: i});
        const row = $('pf-lines').querySelector(`.inv-line[data-i="${i}"]`);
        if (row) row.scrollIntoView({ block: 'center', behavior: 'smooth' });
        return;
      }
      model.push({ productId:'', qty:1, price:0, expanded:true, queryOpen:true });
      model.forEach((l, n) => { if(n !== model.length-1) l.expanded = false; });
      renderLines({index:model.length-1});
      const rows = $('pf-lines').querySelectorAll('.inv-line');
      if (rows.length && rows[rows.length-1].scrollIntoView) rows[rows.length-1].scrollIntoView({block:'center',behavior:'smooth'});
    });
    $('pf-mode').addEventListener('click', () => { mode = mode === 'items' ? 'amount' : 'items'; applyMode(); });
    $('pf-save').addEventListener('click', async function (ev) {
      await withSubmitGuard(ev.currentTarget, async () => {
        const date = $('f-date').value || todayISO();
        const desc = ($('f-desc').value || '').trim();
        let purchase;
        if (mode === 'items') {
          if (!model.length) { showToast('حداقل یک قلم کالا اضافه کن'); throw new Error('validation'); }
          for (const l of model) {
            if (!l.productId || !prodOf(l.productId)) { showToast('برای همهٔ اقلام کالا را انتخاب کن'); throw new Error('validation'); }
            if (!(Number(l.qty)>0)) { showToast('تعداد همه اقلام باید بیشتر از صفر باشد'); throw new Error('validation'); }
            if (!(Number(l.price)>0)) { showToast('قیمت واحد همه اقلام باید بیشتر از صفر باشد'); throw new Error('validation'); }
          }
          const items = model.map(l => ({ id:uid(), productId:l.productId, name:prodOf(l.productId).name||'', qty:Number(l.qty), unitCost:Number(l.price), lineAmount:Number(l.qty)*Number(l.price) }));
          purchase = { id:uid(), date, amount:items.reduce((a,it)=>a+it.lineAmount,0), desc, productId:'', qty:0, items };
        } else {
          const amount = numVal($('pf-amount'));
          if (!(amount>0)) { showToast('مبلغ رو وارد کن'); $('pf-amount').focus(); throw new Error('validation'); }
          purchase = { id:uid(), date, amount, desc, productId:'', qty:0 };
        }
        await commitWithRollback(() => { s.purchases=s.purchases||[]; s.purchases.push(purchase); applyPurchaseStockEffects(purchase,s.name); });
        closeModal(); drawSupplierPage(rootEl); showToast('خرید ثبت شد');
      });
    });
    if (!document._pfDropOutsideBound) {
      document._pfDropOutsideBound = true;
      document.addEventListener('pointerdown', function(e) {
        if (e.target.closest('.prod-drop') || e.target.closest('.row-product-search')) return;
        document.querySelectorAll('.prod-drop').forEach(d => {
          d.hidden = true;
          d.classList.remove('is-open');
        });
        if (document._activePurchaseModel) {
          document._activePurchaseModel.forEach(l => { l.queryOpen = false; });
        }
      }, true);
    }
    document._activePurchaseModel = model;
    renderLines();
    applyMode();
    if (model[0]) { model[0].queryOpen = true; renderLines({index:0}); }
  }


  function openAddPaymentSheet(s) {
    openSheet(`
      <h3>پرداخت به ${esc(s.name)}</h3>
      <div class="field">
        <label>روش پرداخت</label>
        <select id="f-method">
          <option value="cash">نقد / کارت / انتقال</option>
          <option value="check">چک</option>
        </select>
      </div>
      <div class="field"><label>مبلغ (تومان)</label><input id="f-amount" type="text" inputmode="decimal"></div>
      <div class="field"><label>تاریخ پرداخت / صدور</label>${shamsiDateInputHTML('f-date', todayISO())}</div>
      <div id="check-fields" style="display:none;">
        <div class="field"><label>تاریخ سررسید</label>${shamsiDateInputHTML('f-due', todayISO())}</div>
        <div class="field"><label>شماره چک</label><input id="f-check-num"></div>
        <div class="field"><label>بانک</label><input id="f-bank"></div>
      </div>
      <div class="field"><label>توضیح (اختیاری)</label><input id="f-note"></div>
      <div class="btn-row"><button class="btn" id="save-suppay">ثبت</button></div>
    `, { dirtyCheck: true });

    const methodEl = document.getElementById('f-method');
    const checkFields = document.getElementById('check-fields');
    methodEl.addEventListener('change', function () {
      checkFields.style.display = this.value === 'check' ? '' : 'none';
    });

    document.getElementById('save-suppay').addEventListener('click', async function (ev) {
      await withSubmitGuard(ev.currentTarget, async () => {
        const amount = numVal(document.getElementById('f-amount'));
        const date = document.getElementById('f-date').value || todayISO();
        const method = methodEl.value;
        const note = (document.getElementById('f-note').value || '').trim();
        if (amount <= 0) { showToast('مبلغ رو وارد کن'); throw new Error('validation'); }
        let rec;
        if (method === 'check') {
          const due = document.getElementById('f-due').value || date;
          if (due < date) { showToast('تاریخ سررسید نمی‌تواند قبل از تاریخ صدور باشد'); throw new Error('validation'); }
          rec = {
            id: uid(), date: date, amount: amount, faceAmount: amount, method: 'check',
            checkNumber: (document.getElementById('f-check-num').value || '').trim(),
            bank: (document.getElementById('f-bank').value || '').trim(),
            issueDate: date, dueDate: due,
            status: 'pending', note: note,
          };
        } else {
          rec = { id: uid(), date: date, amount: amount, method: 'cash', note: note };
        }
        await commitWithRollback(() => { s.payments = s.payments || []; s.payments.push(rec); });
        closeModal();
        drawSupplierPage(rootEl);
        showToast('پرداخت ثبت شد');
      });
    });
  }

  function openEditSupplierSheet(s) {
    openSheet(`
      <h3>ویرایش تامین‌کننده</h3>
      <div class="field"><label>نام</label><input id="f-name" value="${esc(s.name)}"></div>
      <div class="field"><label>شماره تماس</label><input id="f-phone" value="${esc(s.phone || '')}"></div>
      <div class="field">
        <label>مانده بدهی اولیه (تومان) — برای اصلاح مانده</label>
        <input id="f-opening" type="text" inputmode="decimal" value="${s.openingBalance || ''}">
      </div>
      <div class="btn-row"><button class="btn" id="save-sup-edit">ذخیره</button></div>
    `, { dirtyCheck: true });
    document.getElementById('save-sup-edit').addEventListener('click', async function (ev) {
      await withSubmitGuard(ev.currentTarget, async () => {
        const name = document.getElementById('f-name').value.trim();
        if (!name) { showToast('نام رو وارد کن'); throw new Error('validation'); }
        await commitWithRollback(() => {
          s.name = name;
          s.phone = document.getElementById('f-phone').value.trim();
          s.openingBalance = numVal(document.getElementById('f-opening'));
        });
        closeModal();
        drawSupplierPage(rootEl);
        showToast('ذخیره شد');
      });
    });
  }

  async function toggleSupplierActive(s, btn) {
    await withSubmitGuard(btn, async () => {
      const willDeactivate = s.active !== false;
      const msg = willDeactivate
        ? 'این تأمین‌کننده غیرفعال شود؟ اطلاعات و سوابق خرید و پرداخت حذف نخواهد شد.'
        : 'تامین‌کننده «' + s.name + '» دوباره فعال شود؟';
      if (!(await appConfirm(msg))) throw new Error('validation');
      await commitWithRollback(() => { s.active = (s.active === false) ? true : false; });
      drawSupplierPage(rootEl);
      showToast(s.active === false ? 'تأمین‌کننده غیرفعال شد' : 'تأمین‌کننده فعال شد');
    });
  }

  /* ======================================================================
     Page
     ====================================================================== */
  function drawSupplierPage(root) {
    if (!root) return;
    const id = currentSupplierId;

    if (!id) {
      root.innerHTML = `<div class="empty">شناسه تامین‌کننده مشخص نشده است.</div>
        <div class="btn-row"><a class="btn secondary" href="${suppliersHref()}">بازگشت به لیست</a></div>`;
      return;
    }
    const s = currentSupplier();
    if (!s) {
      root.innerHTML = `<div class="empty">تامین‌کننده پیدا نشد.</div>
        <div class="btn-row"><a class="btn secondary" href="${suppliersHref()}">بازگشت به لیست</a></div>`;
      return;
    }

    const t = supplierTotals(s.id);
    const word = balanceStatusWord(t.balance);
    const color = t.balance > 0 ? 'accent-rust' : 'accent-olive';
    const balanceLine = t.balance === 0 ? word : (word + ': ' + toman(Math.abs(t.balance)) + ' ت');
    const attention = supplierAttention(s, t.balance);

    // newest first; ties keep the later-registered one first (stable, independent of id strings)
    const purchases = (s.purchases || []).map((p, i) => ({ p, i }))
      .sort((a, b) => String(b.p.date || '').localeCompare(String(a.p.date || '')) || (b.i - a.i)).map(x => x.p);
    const payEntries = (s.payments || []).map((p, idx) => ({ p, idx, key: payKey(p, idx) }))
      .sort((a, b) => String(b.p.date || '').localeCompare(String(a.p.date || '')) || (b.idx - a.idx));
    const cashEntries = payEntries.filter(e => e.p.method !== 'check');
    const checkEntries = payEntries.filter(e => e.p.method === 'check');
    const returnEntries = [];
    purchases.forEach(p => (p.returns || []).forEach(r => returnEntries.push({ p, r })));
    returnEntries.sort((a, b) => String(b.r.date || '').localeCompare(String(a.r.date || '')));

    const chev = '<span class="sup-chev" aria-hidden="true"></span>';
    const empty = txt => '<div class="empty" style="padding:12px 0;">' + txt + '</div>';

    const purchaseRows = purchases.length ? purchases.map(p => {
      const ret = purchaseReturnedTotal(p);
      const net = (p.amount || 0) - ret;
      const n = purchaseItemCount(p);
      return `<div class="ledger-row tx-row sup-row" role="button" tabindex="0" data-open-purchase="${esc(p.id)}">
        <span class="name">
          <span class="tx-row-title">${faDate(p.date)}</span>
          <span class="sub">${n ? fa(n) + ' قلم کالا' : 'بدون کالا'}${ret ? ' · برگشت ' + toman(ret) + ' ت' : ''}</span>
        </span>
        <span class="filler"></span>
        <span class="amount tx-row-amount"><span class="tx-row-total">${toman(net)} ت</span>${chev}</span>
      </div>`;
    }).join('') : empty('خریدی ثبت نشده');

    const cashRows = cashEntries.length ? cashEntries.map(e => `<div class="ledger-row tx-row sup-row" role="button" tabindex="0" data-open-pay="${esc(e.key)}">
        <span class="name">
          <span class="tx-row-title">پرداخت نقد / کارت / انتقال</span>
          <span class="sub">${faDate(e.p.date)}${e.p.note ? ' · ' + esc(e.p.note) : ''}</span>
        </span>
        <span class="filler"></span>
        <span class="amount tx-row-amount"><span class="tx-row-total">${toman(e.p.amount)} ت</span>${chev}</span>
      </div>`).join('') : empty('پرداختی ثبت نشده');

    const checkRows = checkEntries.length ? checkEntries.map(e => {
      const st = checkStatus(e.p);
      const diff = supplierCheckDueDiff(e.p);
      const warn = st === 'pending' && diff !== null && diff < 0 ? 'سررسید گذشته' : (st === 'pending' && diff !== null && diff <= DUE_SOON_DAYS ? 'سررسید نزدیک' : '');
      return `<div class="ledger-row tx-row sup-row" role="button" tabindex="0" data-open-check="${esc(e.key)}">
        <span class="name">
          <span class="tx-row-title">چک${e.p.checkNumber ? ' · ش ' + esc(e.p.checkNumber) : ''}</span>
          <span class="sub">سررسید ${e.p.dueDate ? faDate(e.p.dueDate) : '—'}${warn ? ' · <span class="accent-rust">' + warn + '</span>' : ''}</span>
        </span>
        <span class="filler"></span>
        <span class="amount tx-row-amount"><span class="tx-row-total">${toman(checkFace(e.p))} ت</span><span class="sup-badge is-${CHECK_TONE[st]}">${CHECK_LABEL[st]}</span>${chev}</span>
      </div>`;
    }).join('') : empty('چکی ثبت نشده');

    const returnRows = returnEntries.length ? returnEntries.map(({ p, r }) => {
      const why = reasonLabel(r.returnReason);
      return `<div class="ledger-row tx-row sup-row" role="button" tabindex="0" data-open-purchase="${esc(p.id)}">
        <span class="name">
          <span class="tx-row-title">${esc(purchaseTitle(p))}</span>
          <span class="sub">${faDate(r.date)}${why ? ' · <span class="sup-chip">' + esc(why) + '</span>' : ''}</span>
        </span>
        <span class="filler"></span>
        <span class="amount tx-row-amount"><span class="tx-row-total">− ${toman(r.amount || 0)} ت</span>${chev}</span>
      </div>`;
    }).join('') : empty('برگشتی ثبت نشده');

    const section = (title, n, rows) => `<details class="cd-history-details sup-history"><summary class="customer-behavior-summary">${title} (${fa(n)})</summary><div class="tx-list">${rows}</div></details>`;

    root.innerHTML = `
      <div class="btn-row" style="margin-bottom:10px;">
        <a class="btn secondary small" href="${suppliersHref()}">← تامین‌کنندگان</a>
      </div>

      <div class="card sup-identity">
        <div class="sup-identity-name">${esc(s.name)}${s.active === false ? ' <span class="badge tone-muted">غیرفعال</span>' : ''}</div>
        <div class="sup-balance">
          <div class="label">مانده حساب</div>
          <div class="value ${color} sup-balance-value">${balanceLine}</div>
        </div>
        <div class="sup-meta">
          <div class="cd-meta-row"><span class="cd-meta-k">تلفن</span><span class="cd-meta-v">${s.phone ? esc(s.phone) : '—'}</span></div>
        </div>
      </div>

      ${attention ? '<div class="sup-alert is-' + attention.level + '" role="alert">' + esc(attention.text) + '</div>' : ''}

      <div class="cards sup-metrics">
        <div class="card"><div class="label">جمع خرید</div><div class="value">${toman(t.purchaseTotal)} ت</div></div>
        <div class="card"><div class="label">پرداخت‌ها</div><div class="value">${toman(t.payTotal)} ت</div></div>
        <div class="card"><div class="label">برگشت از خرید</div><div class="value">${toman(t.returnTotal)} ت</div></div>
        <div class="card"><div class="label">مانده اولیه</div><div class="value">${toman(t.openingBalance)} ت</div></div>
      </div>

      <div class="sup-actions">
        <button type="button" class="btn" data-sup-act="add-purchase">+ خرید جدید</button>
        <button type="button" class="btn secondary" data-sup-act="add-pay">+ پرداخت</button>
      </div>
      <div class="sup-actions-secondary">
        <button type="button" class="sup-link" data-sup-act="edit">ویرایش مشخصات</button>
        <button type="button" class="sup-link" data-sup-act="toggle">${s.active === false ? 'فعال‌سازی' : 'غیرفعال‌سازی'}</button>
      </div>

      ${section('خریدها', purchases.length, purchaseRows)}
      ${section('پرداخت‌ها', cashEntries.length, cashRows)}
      ${section('چک‌های پرداختی', checkEntries.length, checkRows)}
      ${section('برگشت‌ها', returnEntries.length, returnRows)}
    `;
  }

  // One delegated listener pair for the whole view (the root element survives re-renders).
  function onRootClick(ev) {
    const s = currentSupplier();
    if (!s) return;
    const act = ev.target.closest('[data-sup-act]');
    if (act) {
      const a = act.getAttribute('data-sup-act');
      if (a === 'add-purchase') openAddPurchaseSheet(s);
      else if (a === 'add-pay') openAddPaymentSheet(s);
      else if (a === 'edit') openEditSupplierSheet(s);
      else if (a === 'toggle') toggleSupplierActive(s, act);
      return;
    }
    const pu = ev.target.closest('[data-open-purchase]');
    if (pu) { openPurchaseSheet(s, pu.getAttribute('data-open-purchase')); return; }
    const pay = ev.target.closest('[data-open-pay]');
    if (pay) { openPaymentSheet(s, pay.getAttribute('data-open-pay')); return; }
    const chk = ev.target.closest('[data-open-check]');
    if (chk) { openCheckSheet(s, chk.getAttribute('data-open-check')); }
  }
  function onRootKey(ev) {
    if (ev.key !== 'Enter' && ev.key !== ' ') return;
    const row = ev.target.closest && ev.target.closest('.sup-row');
    if (!row || ev.target !== row) return;
    ev.preventDefault();
    row.click();
  }

  function mount(root, params) {
    let refreshToken = null;
    if (!root) return function () {};
    rootEl = root;

    const nav = document.getElementById('nav');
    if (nav) nav.style.display = '';

    currentSupplierId = params && params.id ? params.id : null;
    root.classList.add('supplier-detail-view');   // CSS scoping (same pattern as customer-detail-view)
    rootClickHandler = onRootClick;
    rootKeyHandler = onRootKey;
    root.addEventListener('click', rootClickHandler);
    root.addEventListener('keydown', rootKeyHandler);
    drawSupplierPage(root);

    refreshToken = ViewHost.setRefresh(() => drawSupplierPage(rootEl));

    return function unmount() {
      ViewHost.clearRefresh(refreshToken);
      refreshToken = null;
      root.removeEventListener('click', rootClickHandler);
      root.removeEventListener('keydown', rootKeyHandler);
      rootClickHandler = null;
      rootKeyHandler = null;
      root.classList.remove('supplier-detail-view');
      currentSupplierId = null;
      root.innerHTML = '';
      rootEl = null;
    };
  }

  global.SupplierView = { mount: mount, unmount: function () {} };

})(typeof window !== 'undefined' ? window : this);