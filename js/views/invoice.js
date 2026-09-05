/* js/views/invoice.js — SPA Invoice detail view (Phase 9).
   Extracted from invoice.html. Reuses invoiceEffectivePaid, invoiceEffectiveRemain,
   invoicePayStatus, printInvoice, exportInvoiceImage, openEditInvoice,
   revertInvoiceStockEffects, revertInvoicePayments, invoiceHasLinkedStockReturn.
   No new financial logic.
*/
'use strict';

(function (global) {
  let currentInvoiceId = null;
  let rootEl = null;
  let actionHandlersBound = false;

  function navigateToInvoices() {
    if (
      typeof isSpaShell === 'function' &&
      isSpaShell() &&
      typeof AppRouter !== 'undefined' &&
      AppRouter.navigate
    ) {
      AppRouter.navigate('/invoices');
    } else {
      location.href = '#/invoices';
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

  function navigateToInvoice(invId) {
    if (
      typeof isSpaShell === 'function' &&
      isSpaShell() &&
      typeof AppRouter !== 'undefined' &&
      AppRouter.navigate
    ) {
      AppRouter.navigate('/invoice', { id: invId });
    } else {
      location.href = '#/invoice?id=' + encodeURIComponent(invId);
    }
  }

  function invoicePaidAmount(inv) {
    return typeof invoiceEffectivePaid === 'function' ? invoiceEffectivePaid(inv) : invoiceOnRecordPaid(inv);
  }

  function invoiceRemain(inv) {
    return typeof invoiceEffectiveRemain === 'function' ? invoiceEffectiveRemain(inv) : Math.max(0, (inv.total || 0) - invoicePaidAmount(inv));
  }

  function invoicePayStatus(inv) {
    const paid = invoicePaidAmount(inv);
    const total = inv.total || 0;
    if (total <= 0) return { label: '—', cls: '' };
    if (paid <= 0) return { label: 'پرداخت‌نشده', cls: 'accent-rust' };
    if (paid + 0.5 >= total) return { label: 'تسویه روی فاکتور', cls: 'accent-olive' };
    return { label: 'پرداخت جزئی', cls: 'accent-amber' };
  }

  function drawInvoicePage(root) {
    if (!root) return;
    const id = currentInvoiceId;

    if (!id) {
      root.innerHTML = `<div class="empty">شناسه فاکتور مشخص نشده.</div>
        <div class="btn-row"><a class="btn secondary" href="#/invoices">بازگشت به فاکتورها</a></div>`;
      return;
    }

    const inv = data.invoices.find(x => x.id === id);
    if (!inv) {
      root.innerHTML = `<div class="empty">فاکتور پیدا نشد (احتمالاً حذف شده).</div>
        <div class="btn-row"><a class="btn secondary" href="#/invoices">بازگشت به فاکتورها</a></div>`;
      return;
    }

    const cust = data.customers.find(c => c.id === inv.customerId);
    const paid = invoicePaidAmount(inv);
    const remain = invoiceRemain(inv);
    const st = invoicePayStatus(inv);
    const hasSnapshot = typeof inv.prevBalance === 'number';

    /* G5: optional Visit↔Invoice relationship (invoice side only; independent workflows) */
    let linkedVisitLabel = '';
    if (inv.visitId && cust) {
      const lv = (cust.visits || []).find(function (v) { return v.id === inv.visitId; });
      if (lv) {
        linkedVisitLabel = (typeof faDate === 'function' ? faDate(lv.date) : lv.date) +
          (lv.time ? ' ' + lv.time : '') +
          (lv.result ? ' — ' + lv.result : '');
      } else {
        linkedVisitLabel = 'ویزیت مرتبط (شناسه ثبت‌شده)';
      }
    }
    const customerVisits = (cust && Array.isArray(cust.visits)) ? cust.visits.slice().sort(function (a, b) {
      return (b.date || '').localeCompare(a.date || '') || (b.time || '').localeCompare(a.time || '');
    }) : [];


    const invProfit = (inv.items || []).reduce(function (a, it) {
      return a + ((it.price || 0) - (it.buyPrice || 0)) * (it.qty || 0) - (it.discount || 0);
    }, 0) - ((inv.discountType === 'percent') ? 0 : (inv.discount || 0));

    const itemRows = (inv.items || []).map(function (it, idx) {
      const line = (it.qty || 0) * (it.price || 0) - (it.discount || 0);
      const prod = data.products.find(p => p.id === it.productId);
      const unit = prod && prod.packageWeight ? ('بسته ' + prod.packageWeight) : 'عدد';
      return `<div class="ledger-row" style="align-items:flex-start;cursor:default;">
        <span class="name">${idx + 1}. ${esc(it.name || '—')}
          <span class="sub">${it.qty} ${esc(String(unit))} × ${toman(it.price)} ت${it.discount ? ' — تخفیف ردیف: ' + toman(it.discount) + ' ت' : ''}</span>
        </span>
        <span class="filler"></span>
        <span class="amount">${toman(line)} ت</span>
      </div>`;
    }).join('') || '<div class="empty">اقلامی ثبت نشده</div>';

    const hist = (inv.editHistory && inv.editHistory.length) ? `
      <h3 class="sub-title">تاریخچه ویرایش</h3>
      ${inv.editHistory.slice().reverse().map(function (h) {
        return `<div class="ledger-row" style="display:block;cursor:default;">
          <span class="sub" style="display:block;margin-bottom:4px;">${faDate(String(h.editedAt).slice(0, 10)) + ' ' + String(h.editedAt).slice(11, 16)}</span>
          <span class="name" style="font-weight:400;">جمع قبل: ${toman(h.before && h.before.total)} ت ← جمع بعد: ${toman(h.after && h.after.total)} ت</span>
        </div>`;
      }).join('')}
    ` : '';

    root.innerHTML = `
      <div class="btn-row" style="margin-bottom:10px;">
        <a class="btn secondary small" href="#/invoices">← فاکتورها</a>
        ${cust ? `<a class="btn secondary small" href="#/customer?id=${encodeURIComponent(cust.id)}">مشتری</a>` : ''}
      </div>

      <!-- IDENTITY -->
      <div class="tx-identity card">
        <div class="tx-identity-title">فاکتور #${esc(String(inv.number || ''))}</div>
        <div class="tx-identity-meta">
          <span>${esc(cust ? cust.name : '—')}</span>
          <span class="tx-dot">·</span>
          <span>${faDate(inv.date)}</span>
          <span class="tx-dot">·</span>
          <span class="${st.cls}">${st.label}</span>
        </div>
      </div>

      <!-- FINANCIAL SUMMARY -->
      <div class="tx-finance cards">
        <div class="card wide">
          <div class="label">مبلغ کل</div>
          <div class="value">${toman(inv.total)} ت</div>
        </div>
        <div class="card">
          <div class="label">پرداخت‌شده</div>
          <div class="value">${toman(paid)} ت</div>
        </div>
        <div class="card">
          <div class="label">مانده</div>
          <div class="value ${remain > 0.5 ? 'accent-rust' : 'accent-olive'}">${toman(Math.max(0, remain))} ت</div>
        </div>
      </div>

      <!-- PRIMARY ACTIONS -->
      <div class="btn-row tx-actions-primary" style="margin-bottom:14px;">
        <button type="button" class="btn" data-inv-action="print">چاپ</button>
        <button type="button" class="btn secondary" data-inv-action="edit">ویرایش</button>
        <button type="button" class="btn secondary" data-inv-action="image">تصویر</button>
        <button type="button" class="btn small danger" data-inv-action="del">حذف</button>
      </div>

      <!-- ITEMS -->
      <h3 class="sub-title">اقلام</h3>
      <div class="tx-items">${itemRows}</div>

      <!-- PAYMENT DETAILS (progressive) -->
      <details class="tx-details">
        <summary>جزئیات پرداخت و سود</summary>
        <div class="cards" style="margin-top:10px;margin-bottom:8px;">
          ${inv.discount ? `<div class="card"><div class="label">تخفیف فاکتور${inv.discountType === 'percent' ? ' (%)' : ''}</div><div class="value">${toman(inv.discount)}${inv.discountType === 'percent' ? ' %' : ' ت'}</div></div>` : ''}
          <div class="card"><div class="label">نقد</div><div class="value" style="font-size:1rem;">${toman(inv.cashPaid || 0)}</div></div>
          <div class="card"><div class="label">کارت</div><div class="value" style="font-size:1rem;">${toman(inv.cardPaid || 0)}</div></div>
          <div class="card"><div class="label">انتقال</div><div class="value" style="font-size:1rem;">${toman(inv.transferPaid || 0)}</div></div>
          <div class="card"><div class="label">چک</div><div class="value" style="font-size:1rem;">${toman(inv.checkPaid || 0)}</div></div>
          ${hasSnapshot ? `
            <div class="card"><div class="label">مانده قبلی مشتری</div><div class="value" style="font-size:1rem;">${toman(inv.prevBalance)} ت</div></div>
            <div class="card"><div class="label">مانده بعد از فاکتور</div><div class="value" style="font-size:1rem;">${toman(Math.abs(inv.newBalance || 0))} ت ${balanceStatusWord(inv.newBalance || 0)}</div></div>
          ` : ''}
          <div class="card wide"><div class="label">سود اقلام این فاکتور</div><div class="value accent-amber">${toman(invProfit)} ت</div></div>
        </div>
      </details>

      <!-- SECONDARY: visit link -->
      <details class="tx-details">
        <summary>ارتباط با ویزیت (اختیاری)</summary>
        <div class="card" style="margin-top:10px;margin-bottom:8px;">
          <div class="label">ویزیت مرتبط با این فاکتور</div>
          <div style="font-size:.88rem;margin-top:6px;line-height:1.7;">
            ${inv.visitId
              ? ('<b>' + esc(linkedVisitLabel) + '</b>' +
                 ' <button type="button" class="btn small secondary" data-inv-action="unlink-visit" style="margin-right:8px;">حذف ارتباط</button>')
              : '<span class="sub">متصل نیست — ویزیت و فاکتور رویدادهای مستقل‌اند؛ فقط در صورت نیاز وصل کنید.</span>'}
          </div>
          ${!inv.visitId && customerVisits.length ? (
            '<div class="field" style="margin-top:10px;"><label>اتصال به ویزیت این مشتری</label>' +
            '<select id="inv-link-visit"><option value="">— انتخاب ویزیت —</option>' +
            customerVisits.map(function (v) {
              const lab = (typeof faDate === 'function' ? faDate(v.date) : v.date) +
                (v.time ? ' ' + v.time : '') + (v.result ? ' — ' + v.result : '');
              return '<option value="' + esc(v.id) + '">' + esc(lab) + '</option>';
            }).join('') +
            '</select></div>' +
            '<div class="btn-row"><button type="button" class="btn small secondary" data-inv-action="link-visit">ثبت ارتباط</button></div>'
          ) : (!inv.visitId ? '<div class="empty" style="padding:8px 0;">برای این مشتری ویزیتی ثبت نشده</div>' : '')}
        </div>
      </details>

      ${hist}
    
    `;

    // Action buttons (delegated)
    if (!actionHandlersBound) {
      actionHandlersBound = true;
      root.addEventListener('click', function (e) {
        const btn = e.target.closest('[data-inv-action]');
        if (!btn) return;
        e.preventDefault();
        e.stopPropagation();

        const action = btn.getAttribute('data-inv-action');
        const invId = currentInvoiceId;
        const inv = (data.invoices || []).find(x => x.id === invId);
        if (!inv) {
          showToast('فاکتور پیدا نشد');
          return;
        }

        try {
          if (action === 'print') {
            if (typeof printInvoice !== 'function') {
              showToast('تابع چاپ در دسترس نیست');
              return;
            }
            printInvoice(inv.id);
          } else if (action === 'image') {
            if (typeof exportInvoiceImage !== 'function') {
              showToast('تابع خروجی تصویر در دسترس نیست');
              return;
            }
            Promise.resolve(exportInvoiceImage(inv.id)).catch(function (err) {
              console.error(err);
              showToast('خطا در خروجی تصویر');
            });
          } else if (action === 'edit') {
            if (typeof openEditInvoice !== 'function') {
              showToast('تابع ویرایش در دسترس نیست');
              return;
            }
            openEditInvoice(inv.id, inv.customerId);
          } else if (action === 'link-visit') {
            (async function () {
              const sel = document.getElementById('inv-link-visit');
              const vid = sel && sel.value;
              if (!vid) { showToast('یک ویزیت انتخاب کنید'); return; }
              inv.visitId = vid;
              try {
                await saveData();
                showToast('ارتباط با ویزیت ثبت شد');
                drawInvoicePage(rootEl || root);
              } catch (err) {
                console.error(err);
                showToast('ذخیره نشد');
              }
            })();
          } else if (action === 'unlink-visit') {
            (async function () {
              if (!confirm('ارتباط این فاکتور با ویزیت حذف شود؟ (خود ویزیت و فاکتور حذف نمی‌شوند)')) return;
              delete inv.visitId;
              try {
                await saveData();
                showToast('ارتباط حذف شد');
                drawInvoicePage(rootEl || root);
              } catch (err) {
                console.error(err);
                showToast('ذخیره نشد');
              }
            })();
          } else if (action === 'del') {
            (async function () {
              if (typeof invoiceHasLinkedStockReturn === 'function' && invoiceHasLinkedStockReturn(inv.id)) {
                showToast('این فاکتور دارای برگشت از فروش است و برای حفظ یکپارچگی موجودی قابل حذف نیست');
                return;
              }
              if (!confirm('با حذف این فاکتور، موجودی انبار و حساب مشتری اصلاح خواهد شد. ادامه می‌دهید؟')) return;
              const previousData = JSON.parse(JSON.stringify(data));
              if (typeof revertInvoiceStockEffects === 'function') revertInvoiceStockEffects(inv);
              if (typeof revertInvoicePayments === 'function') revertInvoicePayments(inv);
              data.invoices = data.invoices.filter(function (x) { return x.id !== inv.id; });
              try {
                await saveData();
              } catch (saveErr) {
                data = previousData;
                throw saveErr;
              }
              if (typeof gameOnInvoiceDeleted === 'function') {
                try {
                  await gameOnInvoiceDeleted(inv.id);
                } catch (e) {
                  console.warn('Game hook failed:', e);
                }
              }
              showToast('فاکتور حذف شد؛ موجودی و حساب مشتری اصلاح شد');
              navigateToInvoices();
            })().catch(function (err) {
              console.error(err);
              showToast('خطا در حذف فاکتور');
            });
          }
        } catch (err) {
          console.error('invoice action failed', action, err);
          showToast('خطا: ' + (err && err.message ? err.message : String(err)));
        }
      });
    }
  }

  function mount(root, params) {
    let refreshToken = null;
    if (!root) return function () {};
    rootEl = root;

    const nav = document.getElementById('nav');
    if (nav) nav.style.display = '';

    currentInvoiceId = params && params.id ? params.id : null;
drawInvoicePage(root);

    refreshToken = ViewHost.setRefresh(()=>drawInvoicePage(rootEl));

    return function unmount() {
      ViewHost.clearRefresh(refreshToken);
      refreshToken = null;
// Do not remove actionHandlersBound flag (event listener is on root, cleaned when root.innerHTML is cleared)
      currentInvoiceId = null;
      root.innerHTML = '';
      rootEl = null;
    };
  }

  global.InvoiceView = { mount: mount, unmount: function () {} };
})(typeof window !== 'undefined' ? window : this);