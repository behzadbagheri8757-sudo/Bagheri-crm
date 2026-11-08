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
    AppRouter.navigate('/invoices');
  }

  function navigateToCustomer(cid) {
    AppRouter.navigate('/customer', { id: cid });
  }

  function navigateToInvoice(invId) {
    AppRouter.navigate('/invoice', { id: invId });
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

  /* ---- «خلاصه حساب شما» — read-only narrative.
     Only reads existing records/functions; nothing is saved or recomputed officially.
     Live balance comes ONLY from customerTotals(...).balance (passed in).
     prevBalance/newBalance are historical snapshots, never mixed with the live balance. ---- */
  const ACCT_EPS = 0.5; // same tolerance the project uses for invoice remain / paid checks
  const PAY_LABEL = { cash: 'نقد', card: 'کارت', transfer: 'انتقال' };

  function acctNum(x) { return typeof x === 'number' && isFinite(x); }
  function acctDay(d) { return String(d || '').slice(0, 10); }
  function acctDate(d) { return esc(typeof faDate === 'function' ? faDate(acctDay(d)) : acctDay(d)); }
  function acctByDate(a, b) {
    return acctDay(a.date || a.dueDate).localeCompare(acctDay(b.date || b.dueDate)) ||
      String(a.number || '').localeCompare(String(b.number || '')) ||
      String(a.id || '').localeCompare(String(b.id || ''));
  }
  function acctSum(list, pick) {
    return list.reduce(function (s, x) { return s + (Number(pick(x)) || 0); }, 0);
  }
  function acctMoney(n, cls) {
    return '<b' + (cls ? ' class="' + cls + '"' : '') + '>' + toman(n) + ' ت</b>';
  }
  /* بدهکار / بستانکار / صفر — returns {word, amount, cls} */
  function acctBalance(bal) {
    if (bal > ACCT_EPS) return { word: 'بدهکار', amount: bal, cls: 'accent-rust' };
    if (bal < -ACCT_EPS) return { word: 'بستانکار', amount: -bal, cls: 'accent-olive' };
    return { word: '', amount: 0, cls: '' };
  }
  function acctRow(html, sub, first) {
    return '<div class="ledger-row" style="cursor:default;align-items:flex-start;' +
      (first ? '' : 'border-top:1px solid var(--vg-color-divider);') + '">' +
      '<span class="name" style="font-weight:400;line-height:1.8;">' + html +
      (sub ? '<span class="sub" style="display:block;">' + sub + '</span>' : '') + '</span></div>';
  }
  function acctHeading(text) {
    return '<div class="sub" style="margin:12px 0 0;font-weight:600;">' + esc(text) + '</div>';
  }
  /* A tappable row (plain <details>, existing look): sentence + list of real records. */
  function acctExpandable(sentenceHtml, sub, itemsHtml, first) {
    return '<details style="' + (first ? '' : 'border-top:1px solid var(--vg-color-divider);') + '">' +
      '<summary style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;min-height:52px;padding:12px 2px;cursor:pointer;">' +
      '<span class="name" style="font-weight:400;line-height:1.8;">' + sentenceHtml +
      (sub ? '<span class="sub" style="display:block;">' + sub + '</span>' : '') + '</span>' +
      '<span class="sub" aria-hidden="true" style="flex:none;">‹</span></summary>' +
      '<div style="margin:0 0 8px;padding:0 10px;background:var(--vg-color-surface-soft);border-radius:10px;">' + itemsHtml + '</div>' +
      '</details>';
  }
  function acctItem(title, sub, amount, first) {
    return '<div class="ledger-row" style="cursor:default;min-height:44px;padding:8px 0;' +
      (first ? '' : 'border-top:1px solid var(--vg-color-divider);') + '">' +
      '<span class="name" style="font-weight:400;">' + title +
      (sub ? '<span class="sub" style="display:block;">' + sub + '</span>' : '') + '</span>' +
      '<span class="filler"></span><span class="amount">' + toman(amount) + ' ت</span></div>';
  }
  function acctList(items) {
    return items.map(function (it, i) { return acctItem(it.title, it.sub, it.amount, i === 0); }).join('');
  }

  function buildAccountSummary(inv, cust, ctx, liveBalance, hasAlloc) {
    const cid = cust.id;
    const invDay = acctDay(inv.date);
    const total = Number(inv.total) || 0;

    const allInvs = customerInvoices(cid, ctx);

    const pays = customerPayments(cid, ctx);
    const checks = customerChecks(cid, ctx);
    const positive = function (x) { return (Number(x.amount) || 0) > 0; };
    const cashLike = pays.filter(function (p) { return PAY_LABEL[p.method] && positive(p); });

    /* Records already counted inside invoiceOnRecordPaid(inv): this invoice's own linked
       cash/card/transfer payments and checks (calc.js contract). They are never added again.
       Linked return / discount records are NOT part of invoiceOnRecordPaid, so they stay visible. */
    const isOwnOnRecordPay = function (p) { return p.invoiceId === inv.id && !!PAY_LABEL[p.method]; };

    /* ---- on the invoice itself ---- */
    const nonCheckOnRec = (inv.cashPaid || 0) + (inv.cardPaid || 0) + (inv.transferPaid || 0);
    const checkOnRec = inv.checkPaid || 0;
    const onRec = invoiceOnRecordPaid(inv);
    const hasPrev = acctNum(inv.prevBalance);
    const hasNew = acctNum(inv.newBalance);
    const snapOk = !(hasPrev && hasNew) ||
      Math.abs(inv.prevBalance + total - onRec - inv.newBalance) <= ACCT_EPS;

    const rowsInvoice = [];
    const pushInv = function (html, sub) { rowsInvoice.push(html, sub || ''); };
    if (total > ACCT_EPS) pushInv('این بار ' + acctMoney(total) + ' خرید کردید.');
    if (nonCheckOnRec > ACCT_EPS) {
      const keys = ['cash', 'card', 'transfer'].filter(function (k) { return (inv[k + 'Paid'] || 0) > 0; });
      pushInv('پرداخت ثبت‌شده روی این فاکتور: ' + acctMoney(nonCheckOnRec, 'accent-olive'),
        keys.length > 1
          ? keys.map(function (k) { return PAY_LABEL[k] + ' ' + toman(inv[k + 'Paid']); }).join(' · ')
          : (keys[0] ? PAY_LABEL[keys[0]] : ''));
    }
    if (checkOnRec > ACCT_EPS) {
      const dues = checks.filter(function (c) { return c.invoiceId === inv.id && c.dueDate; })
        .map(function (c) { return acctDate(c.dueDate); });
      pushInv('چک ثبت‌شده روی این فاکتور: ' + acctMoney(checkOnRec, 'accent-amber'),
        'منظورشده در حساب' + (dues.length ? ' · سررسید ' + dues.join('، ') : ''));
    }
    const prevHtml = hasPrev ? (function () {
      const b = acctBalance(inv.prevBalance);
      return b.word
        ? 'قبل از این خرید، ' + acctMoney(b.amount, b.cls) + ' ' + b.word + ' بودید.'
        : 'قبل از این خرید، حساب شما صفر بود.';
    })() : '';
    const newHtml = hasNew ? (function () {
      const b = acctBalance(inv.newBalance);
      return 'مانده پس از ثبت این خرید: ' + (b.word ? acctMoney(b.amount, b.cls) + ' ' + b.word : '<b>صفر</b>');
    })() : '';

    const toRows = function (pairs) {
      const out = [];
      for (let k = 0; k < pairs.length; k += 2) out.push(acctRow(pairs[k], pairs[k + 1], out.length === 0));
      return out.join('');
    };
    let atHtml = '';
    if (snapOk) {
      const pairs = [];
      if (prevHtml) pairs.push(prevHtml, '');
      Array.prototype.push.apply(pairs, rowsInvoice);
      if (newHtml) pairs.push(newHtml, '');
      if (pairs.length) atHtml = acctHeading('هنگام ثبت این خرید') + '<div>' + toRows(pairs) + '</div>';
    } else {
      /* Snapshot disagrees with itself: invoice facts and historical balances are shown independently. */
      if (rowsInvoice.length) atHtml += acctHeading('این فاکتور') + '<div>' + toRows(rowsInvoice) + '</div>';
      const bal = [];
      if (prevHtml) bal.push(prevHtml, '');
      if (newHtml) bal.push(newHtml, '');
      if (bal.length) atHtml += acctHeading('مانده‌ها هنگام ثبت (جدا از ردیف‌های بالا)') + '<div>' + toRows(bal) + '</div>';
    }

    /* ---- after this invoice's date (strictly later days only; same-day order is unknowable) ---- */
    const after = [];
    const same = [];
    const addGroup = function (arr, sentenceHtml, sub, itemsHtml) {
      arr.push(acctExpandable(sentenceHtml, sub, itemsHtml, arr.length === 0));
    };
    const byMethodItems = function (list) {
      return acctList(list.map(function (p) { return { title: esc(PAY_LABEL[p.method] || (p.method === 'discount' ? 'تخفیف' : 'برگشت کالا')), sub: acctDate(p.date), amount: p.amount }; }));
    };
    const invItems = function (list) {
      return acctList(list.map(function (i) {
        return {
          title: '<a class="tx-inline-link" href="#/invoice?id=' + encodeURIComponent(i.id) + '">فاکتور #' + esc(String(i.number || '—')) + '</a>',
          sub: acctDate(i.date), amount: i.total
        };
      }));
    };
    let sumInv = 0, sumCash = 0, sumDisc = 0, sumRet = 0, sumChk = 0, sameAny = false;
    if (invDay) {
      const otherInvs = allInvs.filter(function (i) { return i.id !== inv.id; });
      const notOwn = function (p) { return !isOwnOnRecordPay(p); };
      const laterInvs = otherInvs.filter(function (i) { return acctDay(i.date) > invDay; }).sort(acctByDate);
      const laterOf = function (m) { return pays.filter(function (p) { return p.method === m && positive(p) && notOwn(p) && acctDay(p.date) > invDay; }).sort(acctByDate); };
      const laterCash = cashLike.filter(function (p) { return notOwn(p) && acctDay(p.date) > invDay; }).sort(acctByDate);
      const laterDisc = laterOf('discount');
      const laterRet = laterOf('return');
      const laterChecks = checks.filter(function (c) { return c.invoiceId !== inv.id && acctDay(c.dueDate) > invDay && positive(c); }).sort(acctByDate);

      sumInv = acctSum(laterInvs, function (i) { return i.total; });
      sumCash = acctSum(laterCash, function (p) { return p.amount; });
      sumDisc = acctSum(laterDisc, function (p) { return p.amount; });
      sumRet = acctSum(laterRet, function (p) { return p.amount; });
      sumChk = acctSum(laterChecks, function (c) { return c.amount; });

      if (sumInv > ACCT_EPS) addGroup(after, 'بعد از تاریخ این خرید، ' + acctMoney(sumInv) + ' خرید دیگر داشتید.', '', invItems(laterInvs));
      if (sumCash > ACCT_EPS) addGroup(after, 'بعد از تاریخ این خرید، ' + acctMoney(sumCash, 'accent-olive') + ' پرداخت کردید.', '', byMethodItems(laterCash));
      if (sumDisc > ACCT_EPS) addGroup(after, 'تخفیف: ' + acctMoney(sumDisc, 'accent-amber'), 'ثبت‌شده بعد از تاریخ این خرید', byMethodItems(laterDisc));
      if (sumRet > ACCT_EPS) addGroup(after, 'برگشت کالا: ' + acctMoney(sumRet, 'accent-amber'), 'ثبت‌شده بعد از تاریخ این خرید', byMethodItems(laterRet));
      if (sumChk > ACCT_EPS) {
        addGroup(after, 'چک‌های منظورشده در حساب: ' + acctMoney(sumChk, 'accent-amber'), 'سررسید بعد از تاریخ این خرید',
          acctList(laterChecks.map(function (c) {
            return { title: 'چک' + (c.checkNumber ? ' ' + esc(String(c.checkNumber)) : ''), sub: 'سررسید ' + acctDate(c.dueDate), amount: c.amount };
          })));
      }

      const sameDayPay = function (p) { return notOwn(p) && positive(p) && acctDay(p.date) === invDay; };
      const sameInvs = otherInvs.filter(function (i) { return acctDay(i.date) === invDay; }).sort(acctByDate);
      const sameCash = cashLike.filter(sameDayPay).sort(acctByDate);
      const sameDisc = pays.filter(function (p) { return p.method === 'discount' && sameDayPay(p); }).sort(acctByDate);
      const sameRet = pays.filter(function (p) { return p.method === 'return' && sameDayPay(p); }).sort(acctByDate);
      const note = 'ترتیب نسبت به این فاکتور مشخص نیست';
      const sInv = acctSum(sameInvs, function (i) { return i.total; });
      const sCash = acctSum(sameCash, function (p) { return p.amount; });
      const sDisc = acctSum(sameDisc, function (p) { return p.amount; });
      const sRet = acctSum(sameRet, function (p) { return p.amount; });
      if (sInv > ACCT_EPS) addGroup(same, 'فاکتورهای دیگر در همین تاریخ: ' + acctMoney(sInv), note, invItems(sameInvs));
      if (sCash > ACCT_EPS) addGroup(same, 'پرداخت‌های ثبت‌شده در همین تاریخ: ' + acctMoney(sCash, 'accent-olive'), note, byMethodItems(sameCash));
      if (sDisc > ACCT_EPS) addGroup(same, 'تخفیف در همین تاریخ: ' + acctMoney(sDisc, 'accent-amber'), note, byMethodItems(sameDisc));
      if (sRet > ACCT_EPS) addGroup(same, 'برگشت کالا در همین تاریخ: ' + acctMoney(sRet, 'accent-amber'), note, byMethodItems(sameRet));
      sameAny = same.length > 0;
    }

    /* Read-only check: do the rows above actually lead from the historical balance to the live one?
       Only then are they presented as one continuous story. Otherwise they stay independent records. */
    const live = acctNum(liveBalance) ? acctBalance(liveBalance) : null;
    const storyOk = !!(invDay && live && hasNew && snapOk && !sameAny &&
      Math.abs(inv.newBalance + sumInv - sumCash - sumDisc - sumRet - sumChk - liveBalance) <= ACCT_EPS);

    /* ---- last real receipt (cash/card/transfer only) ---- */
    let lastPayRow = '';
    if (cashLike.length) {
      const lp = cashLike.slice().sort(acctByDate).pop();
      lastPayRow = acctRow('آخرین پرداخت شما: ' + acctMoney(lp.amount, 'accent-olive'),
        esc(PAY_LABEL[lp.method]) + ' · ' + acctDate(lp.date), true);
    }

    /* ---- live balance (single source: customerTotals().balance) ---- */
    const liveHero = live ? (
      '<div style="margin-top:12px;padding:14px;border-radius:12px;background:var(--vg-color-surface-soft);text-align:center;">' +
      '<div class="label">الان</div>' +
      '<div class="value ' + live.cls + '" style="font-size:1.45rem;">' + (live.word ? toman(live.amount) + ' ت' : '۰ ت') + '</div>' +
      '<div class="sub">' + (live.word ? (live.word === 'بدهکار' ? 'بدهکارید' : 'بستانکارید') : 'مانده حساب شما صفر است') + '</div>' +
      '</div>') : '';

    const allocBtn = hasAlloc
      ? '<div class="btn-row" style="margin-top:10px;"><button type="button" class="btn secondary small" data-inv-action="open-alloc">جزئیات تسویه همین فاکتور</button></div>'
      : '';

    const inner =
      atHtml +
      (after.length ? acctHeading(storyOk ? 'از آن تاریخ تا الان' : 'رکوردهای ثبت‌شده بعد از تاریخ این خرید') + '<div>' + after.join('') + '</div>' : '') +
      (same.length ? acctHeading('در همین تاریخ') + '<div>' + same.join('') + '</div>' : '') +
      (lastPayRow ? '<div style="margin-top:12px;border-top:1px solid var(--vg-color-divider);">' + lastPayRow + '</div>' : '') +
      liveHero + allocBtn;

    return '<div class="inv-surface" style="padding-top:12px;padding-bottom:14px;">' +
      '<div style="font-size:.95rem;font-weight:700;">خلاصه حساب شما</div>' + inner + '</div>';
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

    if (typeof setHeaderTitle === 'function') {
      setHeaderTitle('#' + (inv.number || '—'), { isRoot: false });
    }

    const cust = data.customers.find(c => c.id === inv.customerId);
    const paid = invoicePaidAmount(inv);
    const remain = invoiceRemain(inv);
    const st = invoicePayStatus(inv);
    const hasSnapshot = typeof inv.prevBalance === 'number';

    /* One computation context and ONE customerTotals call per render.
       Everything about the new card is inside try: a failure here must never break the invoice page. */
    let allocTrace = null;
    try {
      allocTrace = typeof invoiceAllocationTrace === 'function' ? invoiceAllocationTrace(inv.id) : null;
    } catch (e) {
      allocTrace = null;
    }
    let acctHtml = '';
    if (cust) {
      try {
        const acctCtx = typeof createComputationContext === 'function' ? createComputationContext({ data: data }) : null;
        const liveBalance = customerTotals(cust.id, acctCtx).balance;
        acctHtml = buildAccountSummary(inv, cust, acctCtx, liveBalance, !!allocTrace);
      } catch (e) {
        console.error('account summary failed', e);
        acctHtml = '';
      }
    }

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


    const invItemsProfit = (inv.items || []).reduce(function (a, it) {
      return a + ((it.price || 0) - (it.buyPrice || 0)) * (it.qty || 0) - (it.discount || 0);
    }, 0);
    // Use the canonical invoice-level discount calculation so percentage and
    // fixed discounts are treated identically to reports/customerProfit.
    const invProfit = invItemsProfit - invoiceDiscountAmount(inv);

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
      <div class="inv-surface">${inv.editHistory.slice().reverse().map(function (h) {
        return `<div class="ledger-row" style="display:block;cursor:default;">
          <span class="sub" style="display:block;margin-bottom:4px;">${faDate(String(h.editedAt).slice(0, 10)) + ' ' + String(h.editedAt).slice(11, 16)}</span>
          <span class="name" style="font-weight:400;">جمع قبل: ${toman(h.before && h.before.total)} ت ← جمع بعد: ${toman(h.after && h.after.total)} ت</span>
        </div>`;
      }).join('')}</div>
    ` : '';

    const payCards = `
          ${inv.discount ? `<div class="card"><div class="label">تخفیف فاکتور${inv.discountType === 'percent' ? ' (%)' : ''}</div><div class="value">${toman(inv.discount)}${inv.discountType === 'percent' ? ' %' : ' ت'}</div></div>` : ''}
          ${inv.cashPaid ? `<div class="card"><div class="label">نقد</div><div class="value" style="font-size:1rem;">${toman(inv.cashPaid)} ت</div></div>` : ''}
          ${inv.cardPaid ? `<div class="card"><div class="label">کارت</div><div class="value" style="font-size:1rem;">${toman(inv.cardPaid)} ت</div></div>` : ''}
          ${inv.transferPaid ? `<div class="card"><div class="label">انتقال</div><div class="value" style="font-size:1rem;">${toman(inv.transferPaid)} ت</div></div>` : ''}
          ${inv.checkPaid ? `<div class="card"><div class="label">چک</div><div class="value" style="font-size:1rem;">${toman(inv.checkPaid)} ت</div></div>` : ''}
          ${hasSnapshot ? `
            <div class="card"><div class="label">مانده قبلی مشتری</div><div class="value" style="font-size:1rem;">${toman(inv.prevBalance)} ت</div></div>
            <div class="card"><div class="label">مانده بعد از فاکتور</div><div class="value" style="font-size:1rem;">${toman(Math.abs(inv.newBalance || 0))} ت ${balanceStatusWord(inv.newBalance || 0)}</div></div>
          ` : ''}
    `.trim();

    root.innerHTML = `<div class="inv-detail">
      <div class="btn-row" style="margin-bottom:10px;">
        <a class="btn secondary small" href="#/invoices">← فاکتورها</a>
        ${cust ? `<a class="btn secondary small" href="#/customer?id=${encodeURIComponent(cust.id)}&fromInv=${encodeURIComponent(inv.id)}">مشتری</a>` : ''}
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

      <!-- ACCOUNT SUMMARY (customer-facing story) -->
      ${acctHtml}

      <!-- PRIMARY ACTIONS -->
      <div class="btn-row tx-actions-primary" style="margin-bottom:14px;">
        <button type="button" class="btn" data-inv-action="print">چاپ</button>
        <button type="button" class="btn secondary" data-inv-action="edit">ویرایش</button>
        <button type="button" class="btn secondary" data-inv-action="image">تصویر</button>
      </div>

      <!-- ITEMS -->
      <h3 class="sub-title">اقلام</h3>
      <div class="tx-items inv-surface">${itemRows}</div>

      <!-- MORE DETAILS (payment breakdown, settlement trace, visit link) -->
      <details class="tx-details" id="inv-more-details">
        <summary>جزئیات بیشتر</summary>
        ${payCards ? `<h3 class="sub-title" style="margin-top:10px;">پرداخت</h3><div class="cards" style="margin-bottom:8px;">${payCards}</div>` : ''}
      ${(() => {
        const tr = allocTrace;
        if (!tr) return '';

        const fmtDate = function(d){ return typeof faDate === 'function' ? faDate(d) : (d || '—'); };
        const escText = function(x){ return esc(x == null ? '' : String(x)); };
        const incomingRows = tr.incoming.map(function(x){
          let label = '';
          if(x.path === 'linked') label = 'پرداخت ثبت‌شده برای همین فاکتور';
          else if(x.path === 'overflow') label = 'مازاد پرداخت فاکتور #' + escText(x.fromInvoiceNumber);
          else if(x.path === 'unlinked') label = 'پرداخت بدون مقصد مشتری';
          else if(x.path === 'linkedReturn') label = 'برگشت از فروش لینک‌شده';
          const badge = x.path === 'linkedReturn' ? '<span class="sub accent-amber" style="margin-right:6px;">نه دریافت نقدی</span>' : '';
          return '<div class="ledger-row ' + (x.path === 'linkedReturn' ? 'accent-amber' : 'accent-olive') + '" style="cursor:default;">' +
            '<span class="name">' + label + '<span class="sub">' + escText(fmtDate(x.date)) + ' · ' + escText(x.kind) + ' · ' + escText(x.eventId) + '</span></span>' +
            '<span class="filler"></span>' + badge + '<span class="amount">' + toman(x.amount) + ' ت</span></div>';
        }).join('');
        const outgoingRows = tr.outgoing.map(function(x){
          const labels = x.destinations.map(function(d){
            if(d.type === 'invoice') return 'به فاکتور #' + escText(d.invoiceNumber);
            if(d.type === 'opening') return 'به مانده افتتاحیه';
            return 'به اعتبار مشتری';
          }).join(', ');
          return '<div class="ledger-row accent-amber" style="cursor:default;">' +
            '<span class="name">' + escText(fmtDate(x.date)) + '<span class="sub">' + labels + '</span></span>' +
            '<span class="filler"></span><span class="amount">' + toman(x.amount) + ' ت</span></div>';
        }).join('');
        const legacyText = tr.legacyOnInvoice > 0 ?
          '<div class="ledger-row accent-rust" style="display:block;cursor:default;">' +
          '<span class="name">مبلغ ثبت‌شده بدون ریزتراکنش: ' + toman(tr.legacyOnInvoice) + ' ت</span>' +
          '<span class="sub" style="display:block;margin-top:4px;">— بخشی از مبلغ روی فاکتور ثبت شده است، اما ریزتراکنش قابل‌نمایش آن در داده‌های فعلی موجود نیست.</span>' +
          '</div>' : '';
        const finalRows = '<div class="ledger-row" style="cursor:default;"><span class="label">مبلغ تسویه‌شده فاکتور</span><span class="filler"></span><span class="amount">' + toman(tr.effectivePaid) + ' ت</span></div>' +
          '<div class="ledger-row" style="cursor:default;"><span class="label">مانده فاکتور</span><span class="filler"></span><span class="amount">' + toman(tr.remain) + ' ت</span></div>';

        let body = '';
        if(tr.onRecord === 0 && tr.incomingTotal === 0 && tr.legacyOnInvoice === 0){
          body = '<div class="empty" style="padding:8px 0;">هنوز پرداختی به این فاکتور تخصیص نیافته است.</div>';
        } else if(tr.incomingTotal === 0 && tr.legacyOnInvoice > 0){
          body = '<div class="ledger-row" style="cursor:default;"><span class="label">پرداخت ثبت‌شده روی فاکتور</span><span class="filler"></span><span class="amount">' + toman(tr.onRecord) + ' ت</span></div>' + finalRows + legacyText;
        } else if(tr.outgoingTotal > 0){
          body = '<div class="ledger-row" style="cursor:default;"><span class="label">پرداخت ثبت‌شده روی فاکتور</span><span class="filler"></span><span class="amount">' + toman(tr.onRecord) + ' ت</span></div>' +
            '<div class="ledger-row accent-olive" style="cursor:default;"><span class="label">تخصیص‌یافته برای همین فاکتور</span><span class="filler"></span><span class="amount">' + toman(tr.incomingLinkedTotal) + ' ت</span></div>' +
            '<div class="ledger-row accent-amber" style="cursor:default;"><span class="label">مبالغ منتقل‌شده به بدهی‌های دیگر</span><span class="filler"></span><span class="amount">' + toman(tr.outgoingTotal) + ' ت</span></div>' +
            '<div class="sub" style="display:block;margin:8px 0 4px;">جزئیات مبالغ منتقل‌شده:</div>' + outgoingRows +
            (tr.incomingLinkedReturnTotal > 0 ? '<div class="ledger-row accent-amber" style="cursor:default;"><span class="label">برگشت از فروش لینک‌شده <span class="sub">نه دریافت نقدی</span></span><span class="filler"></span><span class="amount">' + toman(tr.incomingLinkedReturnTotal) + ' ت</span></div>' : '') +
            finalRows + legacyText;
        } else {
          body = '<div class="sub-title" style="margin:8px 0;">مبالغ مؤثر در تسویه</div>' + incomingRows +
            (tr.incomingTotal === tr.effectivePaid ? finalRows : '<div class="ledger-row" style="cursor:default;"><span class="label">جمع مبالغ مؤثر در تسویه</span><span class="filler"></span><span class="amount">' + toman(tr.incomingTotal) + ' ت</span></div>' + finalRows) + legacyText;
        }

        return '<div id="inv-alloc-section">' +
          '<h3 class="sub-title">ریز تسویه فاکتور</h3>' +
          '<div style="margin-bottom:8px;">' + body + '</div>' +
          '<div class="sub" style="display:block;line-height:1.7;margin-top:10px;">این مسیر بر اساس داده‌ها و قواعد تخصیص فعلی محاسبه شده است.<br>با ویرایش یا حذف اسناد و تراکنش‌های گذشته، یا ثبت سندی با تاریخ گذشته،<br>ممکن است تغییر کند؛ ثبت فاکتور جدید با تاریخ آینده آن را تغییر نمی‌دهد.</div>' +
          '</div>';
      })()}
        <h3 class="sub-title">ارتباط با ویزیت (اختیاری)</h3>
        <div class="card" style="margin-bottom:8px;">
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

      <!-- PRIVATE: profit stays out of the customer-facing details -->
      <details class="tx-details">
        <summary>سود این فاکتور (فقط برای شما)</summary>
        <div class="cards" style="margin-top:10px;margin-bottom:8px;">
          <div class="card wide"><div class="label">سود اقلام این فاکتور</div><div class="value">${toman(invProfit)} ت</div></div>
        </div>
      </details>

      <!-- DANGER ZONE -->
      <div style="margin-top:24px;margin-bottom:16px;padding-top:16px;border-top:1px solid var(--vg-color-divider);">
        <button type="button" class="btn danger" style="width:100%;" data-inv-action="del">حذف فاکتور</button>
      </div>
    </div>`;

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
          } else if (action === 'open-alloc') {
            const sec = (rootEl || root).querySelector('#inv-alloc-section');
            if (!sec) { showToast('ریز تسویه در دسترس نیست'); return; }
            const more = sec.closest('details');
            if (more) more.open = true;
            sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
                drawInvoicePage(rootEl || root);
                showToast('ذخیره نشد');
              }
            })();
          } else if (action === 'unlink-visit') {
            (async function () {
              if (!(await appConfirm('ارتباط این فاکتور با ویزیت حذف شود؟ (خود ویزیت و فاکتور حذف نمی‌شوند)'))) return;
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
              if (!(await appConfirm('با حذف این فاکتور، موجودی انبار و حساب مشتری اصلاح خواهد شد. ادامه می‌دهید؟'))) return;
              const previousData = JSON.parse(JSON.stringify(data));
              if (typeof revertInvoiceStockEffects === 'function') revertInvoiceStockEffects(inv);
              if (typeof revertInvoicePayments === 'function') revertInvoicePayments(inv);
              data.invoices = data.invoices.filter(function (x) { return x.id !== inv.id; });
              // این فاکتور دیگر وجود ندارد — اگر دریافت بدون‌مقصدی قبلاً بخشی از خودش را
              // به همین فاکتور تخصیص داده بود، آن بخش را «بدون‌مقصد» علامت می‌زند تا به یک
              // شناسهٔ حذف‌شده اشاره نکند (تخصیص‌های بقیهٔ فاکتورها دست‌نخورده می‌ماند).
              if (typeof releaseDebtAllocationsForDeletedInvoice === 'function') releaseDebtAllocationsForDeletedInvoice(inv.id);
              try {
                await saveData();
              } catch (saveErr) {
                restoreDataInPlace(previousData);
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