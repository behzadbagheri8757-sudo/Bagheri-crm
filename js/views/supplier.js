/* js/views/supplier.js — SPA Supplier detail view (Phase 7).
   Extracted from supplier.html. Reuses supplierTotals, purchaseLines,
   purchaseReturnRemainingQty, purchaseReturnRemainingAmount,
   purchaseLineRemainingQty, applyPurchaseStockEffects,
   applyPurchaseReturnStockEffects, openAddSupplier as-is.
   No new financial logic.
*/
'use strict';

(function (global) {
  let currentSupplierId = null;
  let rootEl = null;
  let operationsSheetOpened = false;

  function suppliersHref() {
    return '#/suppliers';
  }

  function navigateToSupplier(sid) {
    if (
      typeof isSpaShell === 'function' &&
      isSpaShell() &&
      typeof AppRouter !== 'undefined' &&
      AppRouter.navigate
    ) {
      AppRouter.navigate('/supplier', { id: sid });
    } else {
      location.href = '#/supplier?id=' + encodeURIComponent(sid);
    }
  }

  function renderSupplierPurchaseReturn(s) {
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
              if (badLine) { alert('مقدار برگشتی از باقیمانده‌ی قابل‌برگشت این قلم بیشتره.\n\nباقیمانده قابل‌برگشت: ' + badLine.max); throw new Error('validation'); }
              if (overStock) { alert('موجودی واقعی «' + overStock.name + '» در انبار فقط ' + (overStock.stockQty || 0) + ' عدد است.\n\nمقدار برگشتی نمی‌تواند از موجودی واقعی قابل‌برگشت بیشتر باشد.'); throw new Error('validation'); }
              const totalAmount = lineReturns.reduce((a, l) => a + Math.round(l.qty * l.unitCost), 0);
              if (totalAmount <= 0) { showToast('مبلغ برگشتی رو وارد کن'); throw new Error('validation'); }
              const liveRemainingAmount = purchaseReturnRemainingAmount(purchase);
              if (totalAmount > liveRemainingAmount) { alert('مبلغ برگشتی از مبلغ باقیمانده‌ی این خرید بیشتره.\n\nمبلغ باقیمانده قابل‌برگشت: ' + toman(liveRemainingAmount) + ' تومان'); throw new Error('validation'); }
              if (!confirm('با ثبت این برگشت، موجودی انبار و بدهی به تامین‌کننده اصلاح خواهد شد. ادامه می‌دهید؟')) throw new Error('validation');
              const totalQty = lineReturns.reduce((a, l) => a + l.qty, 0);
              const retLines = lineReturns.map(l => ({ productId: l.productId, qty: l.qty, itemId: l.itemId }));
              const lineItemsSnap = lineReturns.map(l => ({ itemId: l.itemId, productId: l.productId, qty: l.qty, amount: Math.round(l.qty * l.unitCost) }));
              function commitMultiReturn(returnReason) {
                return (async function () {
                  const previousData = JSON.parse(JSON.stringify(data));
                  const retResult = applyPurchaseReturnStockEffects(purchase, retLines, s.name, date);
                  if (!retResult.ok) { alert(retResult.error || 'برگشت خرید ممکن نشد'); throw new Error('validation'); }
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
                  try { await saveData(); } catch (saveErr) { data = previousData; throw saveErr; }
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
              alert('مقدار برگشتی از باقیمانده‌ی قابل‌برگشت این خرید بیشتره.\n\nباقیمانده قابل‌برگشت: ' + liveRemainingQty);
              throw new Error('validation');
            }
            if (purchase.productId && qty > 0) {
              const realStockProd = data.products.find(x => x.id === purchase.productId);
              if (realStockProd && qty > (realStockProd.stockQty || 0)) {
                alert('موجودی واقعی «' + realStockProd.name + '» در انبار فقط ' + (realStockProd.stockQty || 0) + ' عدد است.\n\nمقدار برگشتی نمی‌تواند از موجودی واقعی قابل‌برگشت بیشتر باشد.');
                throw new Error('validation');
              }
            }
            if (amount > liveRemainingAmount) {
              alert('مبلغ برگشتی از مبلغ باقیمانده‌ی این خرید بیشتره.\n\nمبلغ باقیمانده قابل‌برگشت: ' + toman(liveRemainingAmount) + ' تومان');
              throw new Error('validation');
            }
            if (!confirm((purchase.productId ? 'با ثبت این برگشت، موجودی انبار و بدهی به تامین‌کننده اصلاح خواهد شد.' : 'با ثبت این برگشت، فقط بدهی به تامین‌کننده کم می‌شود (موجودی خودکار اصلاح نمی‌شود).') + ' ادامه می‌دهید؟')) throw new Error('validation');
            function commitSingleReturn(returnReason) {
              return (async function () {
                const previousData = JSON.parse(JSON.stringify(data));
                if (purchase.productId && qty > 0) {
                  const retResult = applyPurchaseReturnStockEffects(purchase, [{ productId: purchase.productId, qty: qty }], s.name, date);
                  if (!retResult.ok) { alert(retResult.error || 'برگشت خرید ممکن نشد'); throw new Error('validation'); }
                }
                purchase.returns = purchase.returns || [];
                const rec = { id: uid(), date: date, qty: qty, amount: amount };
                if (returnReason) rec.returnReason = returnReason;
                purchase.returns.push(rec);
                try { await saveData(); } catch (saveErr) { data = previousData; throw saveErr; }
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

    // Re-attach payment delete buttons
    document.querySelectorAll('[data-sup-pay-del]').forEach(btn => {
      btn.addEventListener('click', async function (ev) {
        await withSubmitGuard(ev.currentTarget, async () => {
          const pidx = parseInt(this.getAttribute('data-sup-pay-del'), 10);
          const payments = (s.payments || []).slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''));
          const p = payments[pidx];
          if (!p) throw new Error('validation');
          const realIdx = (s.payments || []).indexOf(p);
          if (realIdx < 0) throw new Error('validation');
          const label = p.method === 'check' ? ('چک' + (p.checkNumber ? (' #' + p.checkNumber) : '')) : 'پرداخت';
          if (!confirm('«' + label + '» به مبلغ ' + toman(p.method === 'check' ? (p.faceAmount || p.amount) : p.amount) + ' تومان حذف شود؟\nمانده حساب تامین‌کننده اصلاح می‌شود.')) throw new Error('validation');
          s.payments.splice(realIdx, 1);
          await saveData();
          drawSupplierPage(rootEl);
          showToast('حذف شد');
        });
      });
    });

    // Re-attach check status toggle
    document.querySelectorAll('[data-sup-check-status]').forEach(btn => {
      btn.addEventListener('click', async function () {
        const pidx = parseInt(this.getAttribute('data-sup-check-status'), 10);
        const payments = (s.payments || []).slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''));
        const p = payments[pidx];
        if (!p || p.method !== 'check') return;
        const order = ['pending', 'cleared', 'bounced'];
        const cur = p.status || 'pending';
        const next = order[(order.indexOf(cur) + 1) % order.length];
        const face = typeof p.faceAmount === 'number' ? p.faceAmount : p.amount;
        p.faceAmount = face;
        p.status = next;
        p.amount = (next === 'bounced') ? 0 : face;
        await saveData();
        drawSupplierPage(rootEl);
        showToast(next === 'cleared' ? 'چک پرداخت‌شده شد' : (next === 'bounced' ? 'چک برگشتی شد — از مانده حذف شد' : 'چک در جریان شد'));
      });
    });

    // Re-attach check edit
    document.querySelectorAll('[data-sup-check-edit]').forEach(btn => {
      btn.addEventListener('click', function () {
        const pidx = parseInt(this.getAttribute('data-sup-check-edit'), 10);
        const payments = (s.payments || []).slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''));
        const p = payments[pidx];
        if (!p || p.method !== 'check') return;
        const face = typeof p.faceAmount === 'number' ? p.faceAmount : p.amount;
        openSheet(`
          <h3>ویرایش چک پرداختی</h3>
          <div class="field"><label>مبلغ (تومان)</label><input id="f-amount" type="text" inputmode="decimal" value="${face || ''}"></div>
          <div class="field"><label>تاریخ صدور</label>${shamsiDateInputHTML('f-date', p.issueDate || p.date || todayISO())}</div>
          <div class="field"><label>تاریخ سررسید</label>${shamsiDateInputHTML('f-due', p.dueDate || todayISO())}</div>
          <div class="field"><label>شماره چک</label><input id="f-check-num" value="${esc(p.checkNumber || '')}"></div>
          <div class="field"><label>بانک</label><input id="f-bank" value="${esc(p.bank || '')}"></div>
          <div class="field"><label>توضیح</label><input id="f-note" value="${esc(p.note || '')}"></div>
          <div class="field">
            <label>وضعیت</label>
            <select id="f-status">
              <option value="pending" ${(p.status || 'pending') === 'pending' ? 'selected' : ''}>در جریان</option>
              <option value="cleared" ${p.status === 'cleared' ? 'selected' : ''}>پرداخت‌شده</option>
              <option value="bounced" ${p.status === 'bounced' ? 'selected' : ''}>برگشتی</option>
            </select>
          </div>
          <div class="btn-row"><button class="btn" id="save-sup-check-edit">ذخیره</button></div>
        `);
        document.getElementById('save-sup-check-edit').addEventListener('click', async function () {
          const amount = numVal(document.getElementById('f-amount'));
          if (amount <= 0) { showToast('مبلغ رو وارد کن'); return; }
          const status = document.getElementById('f-status').value || 'pending';
          p.faceAmount = amount;
          p.amount = (status === 'bounced') ? 0 : amount;
          p.status = status;
          p.issueDate = document.getElementById('f-date').value || todayISO();
          p.date = p.issueDate;
          p.dueDate = document.getElementById('f-due').value || p.issueDate;
          p.checkNumber = (document.getElementById('f-check-num').value || '').trim();
          p.bank = (document.getElementById('f-bank').value || '').trim();
          p.note = (document.getElementById('f-note').value || '').trim();
          await saveData();
          closeModal();
          drawSupplierPage(rootEl);
          showToast('چک ویرایش شد');
        });
      });
    });

    // Re-attach "Add Purchase" button
    const addPurchaseBtn = document.getElementById('add-purchase');
    if (addPurchaseBtn) {
      addPurchaseBtn.onclick = function () {
        openAddPurchaseSheet(s);
      };
    }

    // Re-attach "Add Payment" button
    const addPaymentBtn = document.getElementById('add-suppay');
    if (addPaymentBtn) {
      addPaymentBtn.onclick = function () {
        openAddPaymentSheet(s);
      };
    }

    // Re-attach "Edit Supplier" button
    const editBtn = document.getElementById('edit-supplier');
    if (editBtn) {
      editBtn.onclick = function () {
        openEditSupplierSheet(s);
      };
    }

    // Re-attach "Toggle Active" button
    const toggleActiveBtn = document.getElementById('toggle-supplier-active');
    if (toggleActiveBtn) {
      toggleActiveBtn.onclick = async function (ev) {
        await withSubmitGuard(ev.currentTarget, async () => {
          const willDeactivate = s.active !== false;
          const msg = willDeactivate
            ? 'این تأمین‌کننده غیرفعال شود؟ اطلاعات و سوابق خرید و پرداخت حذف نخواهد شد.'
            : 'تامین‌کننده «' + s.name + '» دوباره فعال شود؟';
          if (!confirm(msg)) throw new Error('validation');
          s.active = (s.active === false) ? true : false;
          await saveData();
          drawSupplierPage(rootEl);
          showToast(s.active === false ? 'تأمین‌کننده غیرفعال شد' : 'تأمین‌کننده فعال شد');
        });
      };
    }
  }

  function openAddPurchaseSheet(s) {
    let multiItems = [];
    openSheet(`
      <h3>خرید جدید از ${esc(s.name)}</h3>
      <div class="field"><label>تاریخ</label>${shamsiDateInputHTML('f-date', todayISO())}</div>
      <div id="single-item-fields">
        <div class="field"><label>مبلغ کل خرید (تومان)</label><input id="f-amount" type="text" inputmode="decimal"></div>
        <div class="field">
          <label>کالای مرتبط (اختیاری — برای افزایش خودکار موجودی)</label>
          <select id="f-product">
            <option value="">— بدون کالای مشخص —</option>
            ${data.products.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}
          </select>
        </div>
        <div class="field"><label>تعداد کالا (در صورت انتخاب کالا)</label><input id="f-qty" type="text" inputmode="decimal"></div>
      </div>
      <div class="btn-row"><button class="btn secondary small" id="toggle-multi-item" type="button">+ چند قلم کالا در یک خرید</button></div>
      <div id="multi-item-fields" style="display:none;">
        <div id="multi-item-rows"></div>
        <div class="field" style="display:flex;gap:6px;">
          <select id="mi-product" style="flex:2;">
            <option value="">انتخاب کالا</option>
            ${data.products.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}
          </select>
          <input id="mi-qty" type="text" inputmode="decimal" placeholder="تعداد" style="flex:1;">
          <input id="mi-price" type="text" inputmode="decimal" placeholder="قیمت واحد" style="flex:1;">
        </div>
        <div class="btn-row"><button class="btn secondary small" id="add-item-row" type="button">+ افزودن قلم</button></div>
        <div class="empty" style="padding:4px 0;text-align:right;">جمع کل اقلام (خودکار): <b id="multi-item-total">۰</b> تومان</div>
      </div>
      <div class="field"><label>توضیح (اختیاری)</label><input id="f-desc"></div>
      <div class="btn-row"><button class="btn" id="save-purchase">ثبت</button></div>
    `);

    function renderMultiRows() {
      document.getElementById('multi-item-rows').innerHTML = multiItems.map((it, idx) => `
        <div class="ledger-row supplier-purchase-item-row"><span class="name"><span class="tx-row-title">${esc((data.products.find(x => x.id === it.productId) || {}).name || '?')}</span><span class="sub">${it.qty} ${esc(String((data.products.find(x => x.id === it.productId) || {}).packageWeight ? 'بسته' : 'واحد'))}${(data.products.find(x => x.id === it.productId) || {}).packageWeight ? ' · وزن بسته ' + enToFaDigits(String((data.products.find(x => x.id === it.productId) || {}).packageWeight)) : ''} · قیمت واحد ${toman(it.unitCost)} ت</span></span><span class="filler"></span><span class="amount"><span class="tx-row-total">${toman(it.qty * it.unitCost)} ت</span><br><button class="btn danger small" data-del-item="${idx}" type="button">حذف</button></span></div>
      `).join('');
      document.getElementById('multi-item-total').textContent = toman(multiItems.reduce((s2, it) => s2 + it.qty * it.unitCost, 0));
      document.querySelectorAll('[data-del-item]').forEach(btn => {
        btn.addEventListener('click', function () {
          multiItems.splice(parseInt(this.getAttribute('data-del-item'), 10), 1);
          renderMultiRows();
        });
      });
    }

    document.getElementById('toggle-multi-item').addEventListener('click', function () {
      const single = document.getElementById('single-item-fields');
      const multi = document.getElementById('multi-item-fields');
      const goingMulti = multi.style.display === 'none';
      multi.style.display = goingMulti ? '' : 'none';
      single.style.display = goingMulti ? 'none' : '';
      this.textContent = goingMulti ? '– برگشت به حالت مبلغ کل / یک کالا' : '+ چند قلم کالا در یک خرید';
    });

    document.getElementById('add-item-row').addEventListener('click', function () {
      const productId = document.getElementById('mi-product').value;
      const qty = numVal(document.getElementById('mi-qty'));
      const unitCost = numVal(document.getElementById('mi-price'));
      if (!productId) { showToast('کالا رو انتخاب کن'); return; }
      const prodCheck = data.products.find(x => x.id === productId);
      if (!prodCheck) { showToast('کالای انتخاب‌شده معتبر نیست'); return; }
      if (qty <= 0) { showToast('تعداد رو وارد کن'); return; }
      if (unitCost <= 0) { showToast('قیمت واحد باید بیشتر از صفر باشد'); return; }
      let itemId = uid();
      while (multiItems.some(it => it.id === itemId)) itemId = uid();
      multiItems.push({ id: itemId, productId, qty, unitCost });
      document.getElementById('mi-product').value = '';
      document.getElementById('mi-qty').value = '';
      document.getElementById('mi-price').value = '';
      renderMultiRows();
    });

    document.getElementById('save-purchase').addEventListener('click', async function (ev) {
      await withSubmitGuard(ev.currentTarget, async () => {
        const date = document.getElementById('f-date').value || todayISO();
        const desc = document.getElementById('f-desc').value.trim();
        const isMulti = document.getElementById('multi-item-fields').style.display !== 'none';
        s.purchases = s.purchases || [];
        if (isMulti) {
          if (multiItems.length === 0) { showToast('حداقل یک قلم کالا اضافه کن'); throw new Error('validation'); }
          for (const it of multiItems) {
            if (!it.productId || !data.products.find(x => x.id === it.productId)) { showToast('یکی از کالاها معتبر نیست'); throw new Error('validation'); }
            if (!(it.qty > 0)) { showToast('تعداد همه اقلام باید بیشتر از صفر باشد'); throw new Error('validation'); }
            if (!(it.unitCost > 0)) { showToast('قیمت واحد همه اقلام باید بیشتر از صفر باشد'); throw new Error('validation'); }
          }
          const amount = multiItems.reduce((s2, it) => s2 + it.qty * it.unitCost, 0);
          const usedIds = new Set();
          const items = multiItems.map(it => {
            let id = it.id || uid();
            while (usedIds.has(id)) id = uid();
            usedIds.add(id);
            return {
              id, productId: it.productId, name: (data.products.find(x => x.id === it.productId) || {}).name || '',
              qty: it.qty, unitCost: it.unitCost, lineAmount: it.qty * it.unitCost,
            };
          });
          const purchase = { id: uid(), date, amount, desc, productId: '', qty: 0, items };
          const previousData = JSON.parse(JSON.stringify(data));
          s.purchases.push(purchase);
          applyPurchaseStockEffects(purchase, s.name);
          try { await saveData(); } catch (saveErr) { data = previousData; throw saveErr; }
          closeModal();
          drawSupplierPage(rootEl);
          showToast('خرید ثبت شد');
          return;
        } else {
          const amount = numVal(document.getElementById('f-amount'));
          const productId = document.getElementById('f-product').value;
          const qty = numVal(document.getElementById('f-qty'));
          if (amount <= 0) { showToast('مبلغ رو وارد کن'); throw new Error('validation'); }
          if (productId) {
            const prod = data.products.find(x => x.id === productId);
            if (!prod) { showToast('کالای انتخاب‌شده معتبر نیست'); throw new Error('validation'); }
            if (!(qty > 0)) { showToast('تعداد کالا باید بیشتر از صفر باشد'); throw new Error('validation'); }
          }
          const purchase = { id: uid(), date, amount, desc, productId, qty };
          const previousData = JSON.parse(JSON.stringify(data));
          s.purchases.push(purchase);
          applyPurchaseStockEffects(purchase, s.name);
          try { await saveData(); } catch (saveErr) { data = previousData; throw saveErr; }
          closeModal();
          drawSupplierPage(rootEl);
          showToast('خرید ثبت شد');
        }
      });
    });
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
    `);

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
        s.payments = s.payments || [];
        if (method === 'check') {
          const dueDate = document.getElementById('f-due').value || date;
          const checkNumber = (document.getElementById('f-check-num').value || '').trim();
          const bank = (document.getElementById('f-bank').value || '').trim();
          s.payments.push({
            id: uid(),
            date: date,
            amount: amount,
            faceAmount: amount,
            method: 'check',
            checkNumber: checkNumber,
            bank: bank,
            issueDate: date,
            dueDate: dueDate,
            status: 'pending',
            note: note,
          });
        } else {
          s.payments.push({ id: uid(), date: date, amount: amount, method: 'cash', note: note });
        }
        await saveData();
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
    `);
    document.getElementById('save-sup-edit').addEventListener('click', async function (ev) {
      await withSubmitGuard(ev.currentTarget, async () => {
        const name = document.getElementById('f-name').value.trim();
        if (!name) { showToast('نام رو وارد کن'); throw new Error('validation'); }
        s.name = name;
        s.phone = document.getElementById('f-phone').value.trim();
        s.openingBalance = numVal(document.getElementById('f-opening'));
        await saveData();
        closeModal();
        drawSupplierPage(rootEl);
        showToast('ذخیره شد');
      });
    });
  }

  function drawSupplierPage(root) {
    if (!root) return;
    const id = currentSupplierId;

    if (!id) {
      root.innerHTML = `<div class="empty">شناسه تامین‌کننده مشخص نشده است.</div>
        <div class="btn-row"><a class="btn secondary" href="${suppliersHref()}">بازگشت به لیست</a></div>`;
      return;
    }
    const s = data.suppliers.find(x => x.id === id);
    if (!s) {
      root.innerHTML = `<div class="empty">تامین‌کننده پیدا نشد.</div>
        <div class="btn-row"><a class="btn secondary" href="${suppliersHref()}">بازگشت به لیست</a></div>`;
      return;
    }

    const t = supplierTotals(s.id);
    const word = balanceStatusWord(t.balance);
    const color = t.balance > 0 ? 'accent-rust' : (t.balance < 0 ? 'accent-olive' : 'accent-olive');
    const balanceLine = t.balance === 0 ? word : (word + ': ' + toman(Math.abs(t.balance)) + ' ت');

    const purchases = (s.purchases || []).slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const payments = (s.payments || []).slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''));

    const purchaseRows = purchases.length ? purchases.map(p => {
      const ret = (p.returns || []).reduce((a, r) => a + (r.amount || 0), 0);
      const net = (p.amount || 0) - ret;
      const remainingAmount = (typeof purchaseReturnRemainingAmount === 'function')
        ? purchaseReturnRemainingAmount(p)
        : Math.max(0, (p.amount || 0) - ret);
      // G4: for stocked purchases, only show return if FIFO/stock still allows return
      let canReturn = remainingAmount > 0;
      if (canReturn && (p.productId || (p.items && p.items.length)) && typeof purchaseActualReturnableQty === 'function') {
        canReturn = purchaseActualReturnableQty(p) > 0;
      }
      const itemsHint = (p.items && p.items.length) ? (p.items.length + ' قلم') :
        (p.productId ? ((data.products.find(x => x.id === p.productId) || {}).name || 'کالا') : (p.desc || 'خرید'));
      const retBtn = canReturn
        ? '<button type="button" class="btn secondary small tx-status-btn" data-return-purchase="' + esc(p.id) + '">برگشت</button>'
        : '';
      return `<div class="ledger-row tx-row">
        <span class="name">
          <span class="tx-row-title">${esc(String(itemsHint))}</span>
          <span class="sub">${faDate(p.date)}${ret ? ' · برگشت ' + toman(ret) + ' ت' : ''}</span>
        </span>
        <span class="filler"></span>
        <span class="amount tx-row-amount">
          <span class="tx-row-total">${toman(net)} ت</span>
          ${retBtn}
        </span>
      </div>`;
    }).join('') : '<div class="empty" style="padding:12px 0;">خریدی ثبت نشده</div>';

    const payRows = payments.length ? payments.map((p, pidx) => {
      const isCheck = p.method === 'check';
      const face = isCheck && typeof p.faceAmount === 'number' ? p.faceAmount : p.amount;
      const stLabel = isCheck
        ? ((p.status === 'cleared') ? 'پرداخت‌شده' : (p.status === 'bounced') ? 'برگشتی' : 'در جریان')
        : (p.method === 'cash' ? 'نقد/کارت/انتقال' : 'پرداخت');
      const stCls = isCheck
        ? (p.status === 'cleared' ? 'accent-olive' : (p.status === 'bounced' ? 'accent-rust' : 'accent-amber'))
        : '';
      const checkMeta = isCheck
        ? ((p.checkNumber ? 'ش ' + p.checkNumber : '') +
           (p.dueDate ? (p.checkNumber ? ' · ' : '') + 'سررسید ' + faDate(p.dueDate) : ''))
        : '';
      const delBtn = '<button type="button" class="btn small danger tx-status-btn" data-sup-pay-del="' + pidx + '">حذف</button>';
      const checkBtns = isCheck
        ? ('<button type="button" class="btn small secondary tx-status-btn ' + stCls + '" data-sup-check-status="' + pidx + '">' + stLabel + '</button>' +
           '<button type="button" class="btn small secondary tx-status-btn" data-sup-check-edit="' + pidx + '">ویرایش</button>')
        : ('<span class="tx-row-meta">' + stLabel + '</span>');
      return `<div class="ledger-row tx-row" style="cursor:default;align-items:flex-start;">
        <span class="name">
          <span class="tx-row-title">${isCheck ? 'چک' : 'پرداخت'}</span>
          <span class="sub">${faDate(p.date)}${checkMeta ? ' · ' + esc(checkMeta) : ''}${p.note ? ' · ' + esc(p.note) : ''}</span>
        </span>
        <span class="filler"></span>
        <span class="amount tx-row-amount">
          <span class="tx-row-total">${toman(isCheck ? face : p.amount)} ت</span>
          ${checkBtns}
          ${delBtn}
        </span>
      </div>`;
    }).join('') : '<div class="empty" style="padding:12px 0;">پرداختی ثبت نشده</div>';

    root.innerHTML = `
      <div class="btn-row" style="margin-bottom:10px;">
        <a class="btn secondary small" href="${suppliersHref()}">← تامین‌کنندگان</a>
      </div>

      <!-- IDENTITY -->
      <div class="tx-identity card">
        <div class="tx-identity-title">${esc(s.name)}${s.active === false ? ' <span class="badge pending">غیرفعال</span>' : ''}</div>
        <div class="tx-identity-meta">
          ${s.phone ? '<span>تلفن: ' + esc(s.phone) + '</span>' : '<span class="sub">بدون تلفن</span>'}
        </div>
      </div>

      <!-- FINANCIAL SUMMARY -->
      <div class="tx-finance cards">
        <div class="card wide">
          <div class="label">مانده حساب</div>
          <div class="value ${color}">${balanceLine}</div>
        </div>
        <div class="card"><div class="label">جمع خرید</div><div class="value">${toman(t.purchaseTotal)} ت</div></div>
        <div class="card"><div class="label">پرداخت‌ها</div><div class="value">${toman(t.payTotal)} ت</div></div>
        <div class="card"><div class="label">برگشت از خرید</div><div class="value">${toman(t.returnTotal)} ت</div></div>
        <div class="card"><div class="label">مانده اولیه</div><div class="value">${toman(t.openingBalance)} ت</div></div>
      </div>

      <!-- PRIMARY ACTIONS -->
      <div class="btn-row tx-actions-primary" style="margin-bottom:14px;">
        <button type="button" class="btn small" id="add-purchase">+ خرید جدید</button>
        <button type="button" class="btn small secondary" id="add-suppay">+ پرداخت</button>
        <button type="button" class="btn small secondary" id="edit-supplier">ویرایش</button>
        <button type="button" class="btn small secondary" id="toggle-supplier-active">${s.active === false ? 'فعال‌سازی' : 'غیرفعال‌سازی'}</button>
      </div>

      <!-- PURCHASES -->
      <h3 class="sub-title">خریدها (${purchases.length})</h3>
      <div class="tx-list">${purchaseRows}</div>

      <!-- PAYMENTS -->
      <h3 class="sub-title">پرداخت‌ها (${payments.length})</h3>
      <div class="tx-list">${payRows}</div>
    `;

    // Re-attach all dynamic buttons
    renderSupplierPurchaseReturn(s);
  }

  function mount(root, params) {
    let refreshToken = null;
    if (!root) return function () {};
    rootEl = root;

    const nav = document.getElementById('nav');
    if (nav) nav.style.display = '';

    currentSupplierId = params && params.id ? params.id : null;
    // Register the view refresh callback for mutation-driven UI updates.
drawSupplierPage(root);

    refreshToken = ViewHost.setRefresh(()=>drawSupplierPage(rootEl));

    return function unmount() {
      ViewHost.clearRefresh(refreshToken);
      refreshToken = null;
      currentSupplierId = null;
      root.innerHTML = '';
      rootEl = null;
    };
  }

  global.SupplierView = { mount: mount, unmount: function () {} };
})(typeof window !== 'undefined' ? window : this);