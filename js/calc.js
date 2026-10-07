/* calc.js — balances, profit, inventory value, filters (read-only derived data)
   Phase 0 extract: no logic changes.
*/
// ---------- derived calculations ----------
function customerInvoices(cid, ctx){
  return ctx && typeof ctx.customerInvoices === 'function'
    ? ctx.customerInvoices(cid)
    : data.invoices.filter(i=>i.customerId===cid);
}
function customerPayments(cid, ctx){
  return ctx && typeof ctx.customerPayments === 'function'
    ? ctx.customerPayments(cid)
    : data.payments.filter(p=>p.customerId===cid);
}
function customerChecks(cid, ctx){
  return ctx && typeof ctx.customerChecks === 'function'
    ? ctx.customerChecks(cid)
    : data.checks.filter(c=>c.customerId===cid);
}

// برای هشدار «برگشت بیشتر از فروش قبلی»: مجموع فروخته‌شده و مجموع قبلاً برگشت‌داده‌شده‌ی
// یک کالای مشخص به یک مشتری مشخص
function productSoldQtyToCustomer(cid, productId, ctx){
  return customerInvoices(cid, ctx).reduce((s,inv)=>
    s + inv.items.filter(it=>it.productId===productId).reduce((a,it)=>a+(it.qty||0),0), 0);
}
function productReturnedQtyByCustomer(cid, productId, ctx){
  return customerPayments(cid, ctx).filter(p=>p.method==='return').reduce((s,p)=>
    s + (p.returnItems||[]).filter(ri=>ri.productId===productId).reduce((a,ri)=>a+(ri.qty||0),0), 0);
}
function productReturnAvailableQty(cid, productId, ctx){
  return Math.max(0, productSoldQtyToCustomer(cid, productId, ctx) - productReturnedQtyByCustomer(cid, productId, ctx));
}

function customerTotals(cid, ctx){
  const calculate = function(){
    const invTotal = customerInvoices(cid, ctx).reduce((s,i)=>s+i.total,0);
    const payTotal = customerPayments(cid, ctx).reduce((s,p)=>s+p.amount,0);
    const checkTotal = customerChecks(cid, ctx).reduce((s,c)=>s+c.amount,0);
    const cashOnlyTotal = customerPayments(cid, ctx).filter(p=>['cash','card','transfer'].includes(p.method)).reduce((s,p)=>s+p.amount,0);
    const discountTotal = customerPayments(cid, ctx).filter(p=>p.method==='discount').reduce((s,p)=>s+p.amount,0);
    const returnTotal = customerPayments(cid, ctx).filter(p=>p.method==='return').reduce((s,p)=>s+p.amount,0);
    const c = ctx && typeof ctx.customerById === 'function'
      ? ctx.customerById(cid)
      : data.customers.find(x=>x.id===cid);
    const openingBalance = c ? (c.openingBalance||0) : 0;
    const balance = openingBalance + invTotal - payTotal - checkTotal;
    return { invTotal, payTotal, checkTotal, cashOnlyTotal, discountTotal, returnTotal, openingBalance, balance };
  };
  return ctx && typeof ctx.memo === 'function'
    ? ctx.memo('customerTotals', cid, calculate)
    : calculate();
}

// تخفیف کلی فاکتور: مبلغ ثابت (پیش‌فرض/قدیمی) یا درصد از جمع جزء فاکتور
function invoiceDiscountAmount(inv){
  if(inv.discountType==='percent'){
    const subtotal = (inv.items||[]).reduce((s,it)=>s+it.qty*it.price-(it.discount||0),0);
    const pct = Math.min(100, Math.max(0, Number(inv.discount)||0));
    return subtotal*pct/100;
  }
  return inv.discount||0;
}

/** مبلغ ثبت‌شده روی خود فاکتور (فیلدهای cash/card/transfer/check) — بدون تغییر منطق ذخیره */
function invoiceOnRecordPaid(inv){
  return (inv.cashPaid||0) + (inv.cardPaid||0) + (inv.transferPaid||0) + (inv.checkPaid||0);
}

/**
 * تخصیص یک دریافت بدون مقصد (بدون invoiceId) به بدهی‌های باز یک مشتری:
 * اول مانده اولیه، بعد قدیمی‌ترین فاکتورهای باز، به ترتیب.
 * "مصرف‌شده" بر اساس debtAllocations ثبت‌شدهٔ *بقیهٔ* دریافت‌های بدون‌مقصد همان مشتری
 * محاسبه می‌شود (رکورد excludeId از محاسبه کنار گذاشته می‌شود — برای ویرایش خودِ همان رکورد).
 * ds پارامتری است (نه data سراسری) تا هم از calc.js/app.js (روی data زندهٔ اپ) و هم از
 * db.js normalizeData (روی دیتاست در حال migrate، قبل از اینکه data سراسری ست شود) قابل فراخوانی باشد.
 * خروجی: آرایه‌ای از {type:'opening'|'invoice'|'surplus', invoiceId?, amount}.
 * این تابع فقط «محاسبه» می‌کند؛ ذخیره‌کردن نتیجه روی رکورد به عهدهٔ صدا‌زننده است.
 */
function buildDebtAllocationForAmount(ds, cid, amount, excludeId){
  const customers = (ds && ds.customers) || [];
  const invoices = (ds && ds.invoices) || [];
  const payments = (ds && ds.payments) || [];
  const checks = (ds && ds.checks) || [];

  const invs = invoices
    .filter(i => i.customerId === cid)
    .slice()
    .sort((a,b)=> (a.date||'').localeCompare(b.date||'')
      || String(a.number||'').localeCompare(String(b.number||''))
      || String(a.id||'').localeCompare(String(b.id||'')));

  // مصرف‌شدهٔ هر بدهی طبق تخصیص‌های از قبل ثبت‌شدهٔ سایر دریافت‌های بدون‌مقصد.
  let consumedOpening = 0;
  const consumedByInvoice = {};
  const tally = function(list){
    (list||[]).forEach(function(x){
      if(x.customerId !== cid) return;
      if(x.invoiceId) return; // پرداخت/چک با مقصد مشخص، بیرون از این محاسبه است
      if(excludeId && x.id === excludeId) return;
      if(!Array.isArray(x.debtAllocations)) return;
      x.debtAllocations.forEach(function(a){
        if(a.type === 'opening') consumedOpening += a.amount||0;
        else if(a.type === 'invoice' && a.invoiceId) consumedByInvoice[a.invoiceId] = (consumedByInvoice[a.invoiceId]||0) + (a.amount||0);
      });
    });
  };
  tally(payments);
  tally(checks);

  let remaining = Number(amount)||0;
  const allocations = [];

  const cust = customers.find(x=>x.id===cid);
  const openingBalance = cust ? (Number(cust.openingBalance)||0) : 0;
  const remOpening = Math.max(0, openingBalance - consumedOpening);
  if(remOpening > 1e-9 && remaining > 1e-9){
    const take = Math.min(remOpening, remaining);
    allocations.push({type:'opening', amount: take});
    remaining -= take;
  }

  for(let idx=0; idx<invs.length; idx++){
    if(remaining <= 1e-9) break;
    const inv = invs[idx];
    const base = invoiceOnRecordPaid(inv);
    const already = consumedByInvoice[inv.id]||0;
    const invDebt = Math.max(0, (inv.total||0) - base - already);
    if(invDebt <= 1e-9) continue;
    const take = Math.min(invDebt, remaining);
    allocations.push({type:'invoice', invoiceId: inv.id, amount: take});
    remaining -= take;
  }

  // بدهی‌ای برای پوشش نمانده (پیش‌پرداخت/مازاد) — فقط برای شفافیت ذخیره می‌شود،
  // در هیچ محاسبهٔ دیگری مصرف نمی‌شود.
  if(remaining > 1e-9){
    allocations.push({type:'surplus', amount: remaining});
  }
  return allocations;
}

/** نسخهٔ آماده‌به‌کار روی data زندهٔ اپ (نه دیتاست در حال migrate). */
function computeDebtAllocationForAmount(cid, amount, excludeId){
  return buildDebtAllocationForAmount(typeof data !== 'undefined' ? data : null, cid, amount, excludeId);
}

/**
 * محاسبهٔ زندهٔ تخصیص بدهی یک مشتری، مستقیماً از داده‌های اصلی (فاکتورها، پرداخت‌ها،
 * چک‌ها، مانده افتتاحیه) — بدون هیچ وابستگی به debtAllocations ذخیره‌شده روی رکوردها
 * (آن فیلد فقط برای audit/نمایش نگه داشته می‌شود و دیگر منبع محاسبه نیست).
 *
 * قاعده: پرداخت متصل (invoiceId دارد) → فقط همان فاکتور (از طریق فیلدهای خودِ فاکتور،
 * یعنی invoiceOnRecordPaid؛ اینجا دوباره شمرده نمی‌شود). پرداخت/چکِ بدون‌مقصد →
 * ابتدا مانده افتتاحیه، سپس قدیمی‌ترین فاکتور باز، به ترتیب؛ باقیمانده = اعتبار مشتری.
 *
 * «برگشت از فروش»ِ بدون‌مقصد (method==='return', بدون invoiceId) در این FIFO شرکت
 * نمی‌کند — دقیقاً هم‌سو با app.js که هرگز برای چنین رکوردی debtAllocations نمی‌سازد
 * (فقط cash/card/transfer/discount واجد شرایط تخصیص بدهی شناخته می‌شوند). چنین
 * برگشتی صرفاً اعتبار سطح‌مشتری است (از طریق customerTotals.payTotal، که تغییر
 * نکرده) و به فاکتور خاصی نسبت داده نمی‌شود.
 *
 * Event sorting: date → id (نه number، چون number لزوماً شمارهٔ فاکتور نیست).
 * Invoice sorting: date → number → id.
 *
 * خروجی: {invRemain: {invoiceId: مانده‌ی آن فاکتور بعد از FIFو (پیش از احتساب
 * برگشتِ متصل)}, openingRemaining, credit}.
 */
function customerFifoAllocation(cid){
  const invs = customerInvoices(cid)
    .slice()
    .sort((a,b)=> (a.date||'').localeCompare(b.date||'')
      || String(a.number||'').localeCompare(String(b.number||''))
      || String(a.id||'').localeCompare(String(b.id||'')));

  const cust = data.customers.find(x=>x.id===cid);
  const openingBalance = cust ? (Number(cust.openingBalance)||0) : 0;
  let openingRemaining = Math.max(0, openingBalance);

  // Contract change (intentional): previously linked payment/check records were
  // represented only by invoiceOnRecordPaid(inv), so any amount above the target
  // invoice never entered FIFO.  The new contract keeps invoiceOnRecordPaid as the
  // hard recorded-payment cap, then sends genuine overflow from each linked event,
  // at that event's own date, through the same FIFO used by unlinked receipts. This
  // prevents the explainability bug where customer balance is settled but an older
  // invoice remains open.
  const invRemain = {};
  const linkedState = {};
  invs.forEach(function(inv){
    const recordCap = Math.max(0, Number(invoiceOnRecordPaid(inv))||0);
    invRemain[inv.id] = Math.max(0, (Number(inv.total)||0) - recordCap);
    linkedState[inv.id] = { recordCap: recordCap, consumed: 0, eventTotal: 0 };
  });

  const events = [];
  const pushEvent = function(ev){
    const amount = Number(ev.amount)||0;
    if(!(amount>1e-9)) return;
    events.push(ev);
  };

  // Only the four ordinary payment methods enter FIFO. Return remains governed by
  // linkedReturn and the existing return/profit/inventory logic.
  (data.payments||[]).forEach(function(p){
    if(p.customerId!==cid || !['cash','card','transfer','discount'].includes(p.method)) return;
    pushEvent({
      kind: 'payment',
      date: p.date||'',
      id: String(p.id||''),
      amount: Number(p.amount)||0,
      invoiceId: p.invoiceId || null,
      method: p.method
    });
  });
  (data.checks||[]).forEach(function(c){
    if(c.customerId!==cid) return;
    // Checks are ordered by dueDate only; check.date is intentionally ignored.
    pushEvent({
      kind: 'check',
      date: c.dueDate||'',
      id: String(c.id||''),
      amount: Number(c.amount)||0,
      invoiceId: c.invoiceId || null
    });
  });
  events.sort((a,b)=> a.date.localeCompare(b.date) || a.id.localeCompare(b.id));

  // Audit only: linked event amounts and invoiceOnRecordPaid are two views of the same payment stream.
  // They are never two amounts to add together. Do not mutate data.
  const linkedByInvoice = {};
  events.forEach(function(ev){
    if(!ev.invoiceId || !Object.prototype.hasOwnProperty.call(linkedState, ev.invoiceId)) return;
    linkedByInvoice[ev.invoiceId] = (linkedByInvoice[ev.invoiceId]||0) + ev.amount;
  });
  const linkedMismatches = [];
  const orphanLinkedEvents = [];
  invs.forEach(function(inv){
    const state = linkedState[inv.id];
    const eventTotal = linkedByInvoice[inv.id]||0;
    state.eventTotal = eventTotal;
    if(Math.abs(eventTotal - state.recordCap) > 1e-9){
      linkedMismatches.push({
        invoiceId: inv.id,
        invoiceNumber: inv.number,
        invoiceOnRecordPaid: state.recordCap,
        linkedEventTotal: eventTotal,
        difference: eventTotal - state.recordCap
      });
    }
  });

  let credit = 0;
  const allocations = [];
  const auditTolerance = 1e-9;

  const applyFifo = function(amount, eventDate, excludedInvoiceId){
    let remaining = Number(amount)||0;
    let openingAllocated = 0;
    const invoiceAllocations = [];

    if(remaining>auditTolerance && openingRemaining>auditTolerance){
      const take = Math.min(openingRemaining, remaining);
      openingRemaining -= take;
      remaining -= take;
      openingAllocated = take;
    }

    for(let idx=0; idx<invs.length && remaining>auditTolerance; idx++){
      const inv = invs[idx];
      if(inv.id===excludedInvoiceId) continue;
      // A receipt at T may only cover an invoice dated <= T.
      if((inv.date||'') > eventDate) continue;
      const rem = invRemain[inv.id];
      if(!(rem>auditTolerance)) continue;
      const take = Math.min(rem, remaining);
      invRemain[inv.id] = rem - take;
      remaining -= take;
      invoiceAllocations.push({invoiceId: inv.id, amount: take});
    }

    return {remaining: remaining, opening: openingAllocated, invoices: invoiceAllocations};
  };

  events.forEach(function(ev){
    let eventRemaining = ev.amount;
    let targetAllocated = 0;
    let openingAllocated = 0;
    let invoiceAllocations = [];
    let discrepancy = false;

    if(ev.invoiceId && !Object.prototype.hasOwnProperty.call(linkedState, ev.invoiceId)){
      // A dangling invoiceId is not a valid unlinked receipt. Keep it visible in
      // audit and do not invent a target, FIFO allocation, or customer credit.
      orphanLinkedEvents.push({kind:ev.kind, id:ev.id, date:ev.date, invoiceId:ev.invoiceId, amount:ev.amount});
      allocations.push({kind:ev.kind, id:ev.id, date:ev.date, invoiceId:ev.invoiceId, amount:ev.amount, targetInvoice:0, opening:0, invoices:[], credit:0, discrepancy:true});
      return;
    }

    if(ev.invoiceId && Object.prototype.hasOwnProperty.call(linkedState, ev.invoiceId)){
      const state = linkedState[ev.invoiceId];
      const targetInv = invs.find(function(inv){ return inv.id===ev.invoiceId; });
      const targetRemaining = targetInv
        ? Math.max(0, (Number(targetInv.total)||0) - state.consumed)
        : 0;
      const capRemaining = Math.max(0, state.recordCap - state.consumed);
      targetAllocated = Math.min(eventRemaining, targetRemaining, capRemaining);
      state.consumed += targetAllocated;
      eventRemaining -= targetAllocated;

      // If this event exceeds the remaining recorded-payment cap, the excess is
      // a source-data discrepancy, not a new payment. Do not invent FIFO/credit.
      if(ev.amount > capRemaining + auditTolerance){
        discrepancy = true;
        eventRemaining = 0;
      } else if(eventRemaining>auditTolerance){
        const fifo = applyFifo(eventRemaining, ev.date, ev.invoiceId);
        openingAllocated = fifo.opening;
        invoiceAllocations = fifo.invoices;
        eventRemaining = fifo.remaining;
      }
    } else {
      const fifo = applyFifo(eventRemaining, ev.date, null);
      openingAllocated = fifo.opening;
      invoiceAllocations = fifo.invoices;
      eventRemaining = fifo.remaining;
    }

    if(eventRemaining>auditTolerance) credit += eventRemaining;

    allocations.push({
      kind: ev.kind,
      id: ev.id,
      date: ev.date,
      invoiceId: ev.invoiceId,
      amount: ev.amount,
      targetInvoice: targetAllocated,
      opening: openingAllocated,
      invoices: invoiceAllocations,
      credit: eventRemaining>auditTolerance ? eventRemaining : 0,
      discrepancy: discrepancy
    });
  });

  return {
    invRemain: invRemain,
    openingRemaining: openingRemaining,
    credit: credit,
    audit: {
      linkedMismatches: linkedMismatches,
      orphanLinkedEvents: orphanLinkedEvents,
      tolerance: auditTolerance
    },
    allocations: allocations
  };
}


/**
 * ردیابی زندهٔ تخصیص مبالغ یک فاکتور — فقط read-only، بدون ذخیره یا mutation.
 * خروجی مستقیماً از customerFifoAllocation و داده‌های فعلی ساخته می‌شود.
 */
function invoiceAllocationTrace(invId){
  const inv = (data.invoices||[]).find(function(x){ return x.id===invId; });
  if(!inv) return null;

  const cid = inv.customerId;
  const alloc = typeof customerFifoAllocation === 'function' ? customerFifoAllocation(cid) : null;
  if(!alloc) return null;

  const allocs = Array.isArray(alloc.allocations) ? alloc.allocations : [];
  const incoming = [];
  const outgoing = [];
  const linkedEventObservedAmounts = [];
  const eps = 1e-9;

  allocs.forEach(function(a){
    const eventAmount = Number(a.amount)||0;
    const targetAmount = Number(a.targetInvoice)||0;

    if(a.invoiceId===invId && eventAmount>eps){
      linkedEventObservedAmounts.push(eventAmount);
      if(targetAmount>eps){
        incoming.push({
          kind: a.kind,
          eventId: a.id,
          date: a.date,
          amount: targetAmount,
          path: 'linked',
          fromInvoiceId: null,
          fromInvoiceNumber: null,
          fromInvoiceDate: null
        });
      }

      const outgoingAmount = Math.max(0, eventAmount-targetAmount);
      if(outgoingAmount>eps){
        const destinations = [];
        (a.invoices||[]).forEach(function(x){
          const amount = Number(x.amount)||0;
          if(!(amount>eps)) return;
          destinations.push({
            type: 'invoice',
            invoiceId: x.invoiceId,
            invoiceNumber: null,
            invoiceDate: null,
            amount: amount
          });
        });
        const opening = Number(a.opening)||0;
        if(opening>eps){
          destinations.push({
            type: 'opening',
            invoiceId: null,
            invoiceNumber: null,
            invoiceDate: null,
            amount: opening
          });
        }
        const credit = Number(a.credit)||0;
        if(credit>eps){
          destinations.push({
            type: 'credit',
            invoiceId: null,
            invoiceNumber: null,
            invoiceDate: null,
            amount: credit
          });
        }
        outgoing.push({
          kind: a.kind,
          eventId: a.id,
          date: a.date,
          amount: outgoingAmount,
          destinations: destinations
        });
      }
    }

    (a.invoices||[]).forEach(function(x){
      const amount = Number(x.amount)||0;
      if(x.invoiceId!==invId || !(amount>eps)) return;
      incoming.push({
        kind: a.kind,
        eventId: a.id,
        date: a.date,
        amount: amount,
        path: a.invoiceId ? 'overflow' : 'unlinked',
        fromInvoiceId: a.invoiceId || null,
        fromInvoiceNumber: null,
        fromInvoiceDate: null
      });
    });
  });

  (data.payments||[]).forEach(function(p){
    if(p.customerId!==cid || p.invoiceId!==invId || p.method!=='return') return;
    const amount = Number(p.amount)||0;
    if(!(amount>eps)) return;
    incoming.push({
      kind: 'return',
      eventId: p.id,
      date: p.date||'',
      amount: amount,
      path: 'linkedReturn',
      fromInvoiceId: null,
      fromInvoiceNumber: null,
      fromInvoiceDate: null
    });
  });

  incoming.forEach(function(x){
    if(!x.fromInvoiceId) return;
    const source = (data.invoices||[]).find(function(i){ return i.id===x.fromInvoiceId; });
    if(source){
      x.fromInvoiceNumber = source.number==null ? null : source.number;
      x.fromInvoiceDate = source.date==null ? null : source.date;
    }
  });

  outgoing.forEach(function(x){
    x.destinations.forEach(function(d){
      if(d.type!=='invoice') return;
      const dest = (data.invoices||[]).find(function(i){ return i.id===d.invoiceId; });
      if(dest){
        d.invoiceNumber = dest.number==null ? null : dest.number;
        d.invoiceDate = dest.date==null ? null : dest.date;
      }
    });
  });

  const sortRows = function(a,b){
    return String(a.date||'').localeCompare(String(b.date||''))
      || String(a.eventId||'').localeCompare(String(b.eventId||''))
      || String(a.path||'').localeCompare(String(b.path||''));
  };
  incoming.sort(sortRows);
  outgoing.sort(function(a,b){
    return String(a.date||'').localeCompare(String(b.date||''))
      || String(a.eventId||'').localeCompare(String(b.eventId||''));
  });

  const sum = function(list){
    return list.reduce(function(s,x){ return s + (Number(x.amount)||0); }, 0);
  };
  const onRecord = Number(invoiceOnRecordPaid(inv))||0;
  const linkedEventObservedTotal = linkedEventObservedAmounts.reduce(function(s,x){ return s+x; }, 0);
  const legacyOnInvoice = Math.max(0, onRecord-linkedEventObservedTotal);
  const incomingTotal = sum(incoming);
  const incomingLinkedTotal = sum(incoming.filter(function(x){ return x.path==='linked'; }));
  const incomingLinkedReturnTotal = sum(incoming.filter(function(x){ return x.path==='linkedReturn'; }));
  const outgoingTotal = sum(outgoing);
  const effectivePaid = Number(invoiceEffectivePaid(inv))||0;
  const remain = Number(invoiceEffectiveRemain(inv))||0;

  return {
    invoiceId: inv.id,
    invoiceNumber: inv.number,
    invoiceDate: inv.date,
    total: inv.total,
    onRecord: onRecord,
    linkedEventObservedTotal: linkedEventObservedTotal,
    legacyOnInvoice: legacyOnInvoice,
    incoming: incoming,
    incomingTotal: incomingTotal,
    incomingLinkedTotal: incomingLinkedTotal,
    incomingLinkedReturnTotal: incomingLinkedReturnTotal,
    outgoing: outgoing,
    outgoingTotal: outgoingTotal,
    effectivePaid: effectivePaid,
    remain: remain,
    auditOnly: {
      allocAudit: alloc.audit || null,
      onRecordVsLinkedEventsDifference: onRecord-linkedEventObservedTotal,
      incomingVsEffectivePaidDifference: effectivePaid-incomingTotal
    },
    live: true
  };
}

/**
 * پوشش واقعی فاکتور: مبلغ روی خود فاکتور (invoiceOnRecordPaid؛ بدون تغییر) +
 * سهمی که از FIFوی زندهٔ همین مشتری (customerFifoAllocation) واقعاً به این فاکتور
 * رسیده + مجموع «برگشت از فروش»های متصل مستقیم به همین فاکتور.
 * پرداخت/چکِ متصل (invoiceId دارد، method !== 'return') در محاسبه دوباره شمرده
 * نمی‌شود، چون همان مبلغ از قبل در invoiceOnRecordPaid(inv) نمایش داده شده است.
 * برگشتِ متصل استثناست: در invoiceOnRecordPaid نیست، پس اینجا مستقیم اضافه می‌شود.
 * اگر برگشتِ متصل از مانده‌ی همین فاکتور بیشتر باشد، مازاد آن (طبق قرارداد) به
 * فاکتور دیگری منتقل یا اینجا دوباره حساب نمی‌شود؛ صرفاً به‌عنوان اعتبار سطح‌مشتری
 * در customerTotals.balance (که مبلغ خام هر پرداخت را بدون توجه به invoiceId جمع
 * می‌زند) منعکس است.
 */
function invoiceEffectivePaid(inv){
  if(!inv) return 0;
  const onRec = invoiceOnRecordPaid(inv);
  const cid = inv.customerId;
  if(!cid || typeof data === 'undefined' || !data) return onRec;

  const alloc = customerFifoAllocation(cid);
  const preFifoRemain = Math.max(0, (inv.total||0) - onRec);
  const postFifoRemain = Object.prototype.hasOwnProperty.call(alloc.invRemain, inv.id)
    ? alloc.invRemain[inv.id]
    : preFifoRemain;
  const fifoApplied = preFifoRemain - postFifoRemain;

  let linkedReturn = 0;
  (data.payments||[]).forEach(function(p){
    if(p.customerId===cid && p.invoiceId===inv.id && p.method==='return'){
      linkedReturn += Number(p.amount)||0;
    }
  });

  return onRec + fifoApplied + linkedReturn;
}

/**
 * وقتی یک فاکتور واقعاً حذف می‌شود (نه ویرایش)، اگر پیش‌تر دریافت/چک بدون‌مقصدی بخشی
 * از تخصیص خودش را به همین فاکتور داده بود، آن بخش را به‌جای اشارهٔ ناموجود به یک
 * فاکتور حذف‌شده، «مازاد/بدون‌مقصد» علامت می‌زند. به فاکتور دیگری منتقلش نمی‌کند (تا
 * تخصیص‌های ثبت‌شدهٔ بقیهٔ فاکتورها دست‌نخورده بماند) و به‌سادگی هم حذفش نمی‌کند (که
 * جمع تخصیصِ آن دریافت را کمتر از مبلغ واقعی‌اش نشان می‌داد).
 * فقط باید از مسیر واقعیِ حذف فاکتور صدا زده شود — هرگز از چرخهٔ ویرایش فاکتور
 * (revertInvoicePayments+pushInvoicePayments) که همان invoiceId را دوباره استفاده می‌کند.
 */
function releaseDebtAllocationsForDeletedInvoice(invoiceId){
  if(!invoiceId || typeof data === 'undefined' || !data) return;
  const release = function(list){
    (list||[]).forEach(function(x){
      if(x.invoiceId) return; // خودِ پرداخت/چکِ لینک‌شده به فاکتور، جای دیگری مدیریت می‌شود
      if(!Array.isArray(x.debtAllocations)) return;
      x.debtAllocations.forEach(function(a){
        if(a.type === 'invoice' && a.invoiceId === invoiceId){
          a.type = 'surplus';
          delete a.invoiceId;
        }
      });
    });
  };
  release(data.payments);
  release(data.checks);
}

function invoiceEffectiveRemain(inv){
  return Math.max(0, (inv.total||0) - invoiceEffectivePaid(inv));
}

function customerProfit(cid, ctx, skipMemo){
  if(ctx && typeof ctx.memo === 'function' && !skipMemo){
    return ctx.memo('customerProfit', cid, function(){ return customerProfit(cid, ctx, true); });
  }
  // سود فاکتورها (با تخفیف ردیف و تخفیف کلی)
  let s = customerInvoices(cid, ctx).reduce((sum,inv)=>{
    const itemsProfit = inv.items.reduce((a,it)=>a + (it.price - (it.buyPrice||0)) * it.qty - (it.discount||0), 0);
    return sum + itemsProfit - invoiceDiscountAmount(inv);
  },0);
  // کسر حاشیه برگشت از فروش: (قیمت برگشت − قیمت خرید) × تعداد — فقط وقتی returnItems ثبت شده
  customerPayments(cid, ctx).filter(p=>p.method==='return').forEach(p=>{
    (p.returnItems||[]).forEach(ri=>{
      if(!(ri.qty>0)) return;
      const prod = ctx && typeof ctx.productById === 'function'
        ? ctx.productById(ri.productId)
        : data.products.find(x=>x.id===ri.productId);
      // FIX (audit H-1): cost basis must come from the actual invoice this return is
      // linked to (payment.invoiceId) — not "last sold anywhere" — so it matches the
      // FIFO cost stock.js already computed for this exact return. Falls back to the
      // previous "last sold" behavior only for legacy/account-only returns with no
      // linked invoice (payment.invoiceId missing), so old data keeps working.
      let sourceItem = null;
      let buyCostTotal = 0;
      let allocatedQty = 0;
      if(p.invoiceId){
        const srcInv = data.invoices.find(i=>i.id===p.invoiceId);
        if(srcInv){
          const items = (srcInv.items||[]).filter(it=>it.productId===ri.productId);
          // Match stock.js return allocation order: all original FIFO allocations
          // for this product, in invoice-line order, skipping previous returns.
          const allocs = [];
          items.forEach(it=>{
            if(Array.isArray(it.costAllocations)) it.costAllocations.forEach(a=>{
              const q=Number(a.qty)||0; const uc=Number(a.unitCost)||0;
              if(q>0) allocs.push({qty:q, unitCost:uc});
            });
          });
          if(allocs.length){
            let skip=0;
            for(const x of customerPayments(cid, ctx)){
              if(x.method!=='return' || x.invoiceId!==p.invoiceId) continue;
              if(x.id===p.id) break;
              (x.returnItems||[]).forEach(xri=>{ if(xri.productId===ri.productId) skip += Number(xri.qty)||0; });
            }
            let need=Number(ri.qty)||0;
            for(const a of allocs){
              if(skip>=a.qty){ skip-=a.qty; continue; }
              const take=Math.min(need, a.qty-skip);
              if(take>0){ buyCostTotal += take*a.unitCost; allocatedQty += take; need -= take; }
              skip=0;
              if(need<=1e-9) break;
            }
          }
          sourceItem = items[0] || null;
        }
      }
      if(!sourceItem){
         const sold = customerInvoices(cid, ctx).flatMap(inv=>inv.items.filter(it=>it.productId===ri.productId));
        sourceItem = sold.length ? sold[sold.length-1] : null;
      }
      const qty=Number(ri.qty)||0;
      const sell = (ri.price>0) ? Number(ri.price) : (sourceItem ? Number(sourceItem.price)||0 : 0);
      if(allocatedQty>0){
        const qtyForCost=Math.min(qty,allocatedQty);
        s -= (sell * qtyForCost) - buyCostTotal;
        if(qtyForCost < qty){
          const fallbackBuy=(sourceItem && sourceItem.buyPrice!==undefined) ? (Number(sourceItem.buyPrice)||0) : (prod ? (Number(prod.buy)||0) : 0);
          s -= (sell - fallbackBuy) * (qty-qtyForCost);
        }
      } else {
        const buy=(sourceItem && sourceItem.buyPrice!==undefined) ? (Number(sourceItem.buyPrice)||0) : (prod ? (Number(prod.buy)||0) : 0);
        s -= (sell - buy) * qty;
      }
    });
  });
  // کسر تراکنش «تخفیف (کاهش بدهی)» از سود گزارش‌شده
  s -= customerPayments(cid, ctx).filter(p=>p.method==='discount').reduce((a,p)=>a+(p.amount||0),0);
  return s;
}

function customerStats(cid, ctx, skipMemo){
  if(ctx && typeof ctx.memo === 'function' && !skipMemo){
    return ctx.memo('customerStats', cid, function(){ return customerStats(cid, ctx, true); });
  }
  const invs = customerInvoices(cid, ctx);
  const pays = customerPayments(cid, ctx);
  const t = customerTotals(cid, ctx);
  const sortedInvs = invs.slice().sort((a,b)=>new Date(a.date)-new Date(b.date));
  const lastInvoice = sortedInvs[sortedInvs.length-1];
  const firstInvoice = sortedInvs[0];
  const lastPayment = pays.slice().sort((a,b)=>new Date(b.date)-new Date(a.date))[0];
  return {
    count: invs.length,
    avgInvoice: invs.length ? t.invTotal/invs.length : 0,
    firstInvoiceDate: firstInvoice ? firstInvoice.date : null,
    lastInvoiceDate: lastInvoice ? lastInvoice.date : null,
    lastPaymentDate: lastPayment ? lastPayment.date : null,
    profit: customerProfit(cid, ctx),
    daysSinceLast: lastInvoice ? daysAgo(lastInvoice.date) : Infinity,
  };
}

function customerStatus(cid, ctx){
  const c = data.customers.find(function(x){ return x.id === cid; });
  if(c && c.active === false) return 'inactive';
  const st = customerStats(cid, ctx);
  if(st.count===0) return 'new';
  if(st.daysSinceLast > 60) return 'lost';
  if(st.daysSinceLast > 21) return 'inactive';
  return 'active';
}

function supplierTotals(sid){
  const s = data.suppliers.find(x=>x.id===sid);
  if(!s) return {purchaseTotal:0, payTotal:0, returnTotal:0, balance:0};
  const purchaseTotal = (s.purchases||[]).reduce((a,p)=>a+p.amount,0);
  const returnTotal = (s.purchases||[]).reduce((a,p)=>a+(p.returns||[]).reduce((b,r)=>b+(r.amount||0),0),0);
  const payTotal = (s.payments||[]).reduce((a,p)=>a+p.amount,0);
  const openingBalance = s.openingBalance||0;
  return { purchaseTotal, payTotal, returnTotal, openingBalance, balance: openingBalance + purchaseTotal - payTotal - returnTotal };
}

// قیمت خرید یک کالا به روش FIFO: میانگین وزنیِ لایه‌های باز (چیزی که واقعاً در انبار مانده و نوبت مصرفشه).
// اگر کالا هیچ لایه‌ی بازی نداشته باشه (هنوز خریدی/ورودی ثبت نشده)، برمی‌گرده به فیلد دستی p.buy.
function productFifoUnitCost(pid){
  const layers = (data.inventoryLayers||[]).filter(l=>l.productId===pid && l.status==='open' && (l.qtyRemaining||0)>0);
  if(!layers.length){
    const prod = data.products.find(p=>p.id===pid);
    return prod ? (prod.buy||0) : 0;
  }
  const qty = layers.reduce((s,l)=>s+(l.qtyRemaining||0),0);
  const val = layers.reduce((s,l)=>s+(l.qtyRemaining||0)*(l.unitCost||0),0);
  return qty>0 ? val/qty : 0;
}
// ارزش ریالی موجودی یک کالای مشخص، از لایه‌های FIFO باز (زیرمجموعه‌ی همون چیزی که inventoryValue() جمع می‌زنه)
function productInventoryValue(pid){
  return (data.inventoryLayers||[]).filter(l=>l.productId===pid && l.status==='open')
    .reduce((s,l)=>s+(l.qtyRemaining||0)*(l.unitCost||0), 0);
}

function inventoryValue(){
  // FIFO: ارزش انبار از لایه‌های قابل مصرف (open + qtyRemaining>0)
  const layers = (data.inventoryLayers||[]);
  if(layers.length){
    return layers.reduce((s,l)=>{
      if(l.status!=='open') return s;
      const q = l.qtyRemaining||0;
      if(!(q>0)) return s;
      return s + q * (l.unitCost||0);
    }, 0);
  }
  // fallback legacy قبل از migration
  return data.products.reduce((s,p)=>s + (p.stockQty||0)*(p.buy||0), 0);
}

// یک نقطه‌ی واحد برای خوندن اقلام یک خرید: چندقلمی جدید، یا تک‌کالای قدیمی، یا بدون کالا
function purchaseLines(p){
  if(Array.isArray(p.items) && p.items.length) return p.items;
  if(p.productId && p.qty>0) return [{productId:p.productId, name:(data.products.find(x=>x.id===p.productId)||{}).name||'', qty:p.qty}];
  return [];
}
// مقدار قابل‌برگشت (qty) برای یک خرید — سازگار با تک‌قلمی و چندقلمی
function purchaseReturnRemainingQty(p){
  const already = (p.returns||[]).reduce((a,r)=>a+(Number(r.qty)||0),0);
  if(p.productId){
    return Math.max(0, (Number(p.qty)||0) - already);
  }
  const lines = purchaseLines(p);
  if(lines.length){
    const purchased = lines.reduce((s,l)=>s+(Number(l.qty)||0),0);
    return Math.max(0, purchased - already);
  }
  return 0;
}
function purchaseReturnRemainingAmount(p){
  const already = (p.returns||[]).reduce((a,r)=>a+(Number(r.amount)||0),0);
  return Math.max(0, (Number(p.amount)||0) - already);
}
// مقدار قابل‌برگشتِ یک قلمِ مشخص از یک خرید چندقلمی (با احتساب برگشت‌های قبلی همون قلم)
function purchaseLineRemainingQty(p, itemId){
  const line = (p.items||[]).find(it=>it.id===itemId);
  if(!line) return 0;
  const already = (p.returns||[]).reduce((a,r)=>a+((r.items||[]).filter(x=>x.itemId===itemId).reduce((b,x)=>b+(Number(x.qty)||0),0)),0);
  return Math.max(0, (Number(line.qty)||0) - already);
}
// اثر موجودی خرید تامین‌کننده (ایجاد) — فقط روی خطوط دارای productId و qty>0
function lowStockProducts(){
  return data.products.filter(p => (p.minStock||0) > 0 && (p.stockQty||0) <= p.minStock);
}

function isSameMonth(iso, ref){
  // Shamsi/Jalali month for «این ماه» — storage remains Gregorian YYYY-MM-DD
  if(typeof isSameJalaliMonth === 'function') return isSameJalaliMonth(iso, ref);
  const d = new Date(iso), r = ref;
  return d.getFullYear()===r.getFullYear() && d.getMonth()===r.getMonth();
}
function isSameDay(iso, ref){
  // Same civil day (Gregorian local == same real day as Shamsi «امروز»)
  const p = (typeof parseISODateParts === 'function') ? parseISODateParts(iso) : null;
  if(p && ref && !isNaN(ref.getTime())){
    return p.y === ref.getFullYear() && p.m === (ref.getMonth()+1) && p.d === ref.getDate();
  }
  const d = new Date(iso);
  return d.toDateString() === ref.toDateString();
}

function globalTotals(ctx, skipMemo){
  if(ctx && typeof ctx.memo === 'function' && !skipMemo){
    return ctx.memo('globalTotals', 'all', function(){ return globalTotals(ctx, true); });
  }
  const totalSales = data.invoices.reduce((s,i)=>s+i.total,0);
  // همان منطق customerProfit برای همه مشتریان (فاکتور − حاشیه برگشت − تخفیف تراکنشی)
  const totalProfit = data.customers.reduce((s,c)=>s + customerProfit(c.id, ctx), 0);
  const totalReceived = data.payments.filter(p=>['cash','card','transfer'].includes(p.method)).reduce((s,p)=>s+p.amount,0);
  const outstandingChecks = data.checks.filter(c=>c.status!=='cleared').reduce((s,c)=>s+c.amount,0);
  const customerDebt = data.customers.reduce((s,c)=>{
    const t = customerTotals(c.id, ctx);
    return s + Math.max(t.balance,0);
  },0);
  const supplierDebt = data.suppliers.reduce((s,sp)=>s+supplierTotals(sp.id).balance,0);

  const now = new Date();
  const todaySales = data.invoices.filter(i=>isSameDay(i.date, now)).reduce((s,i)=>s+i.total,0);
  const todayCount = data.invoices.filter(i=>isSameDay(i.date, now)).length;
  const monthSales = data.invoices.filter(i=>isSameMonth(i.date, now)).reduce((s,i)=>s+i.total,0);
  const monthCount = data.invoices.filter(i=>isSameMonth(i.date, now)).length;

  return { totalSales, totalProfit, totalReceived, outstandingChecks, customerDebt, supplierDebt,
    todaySales, todayCount, monthSales, monthCount };
}

function checksDueSoon(){
  const now = new Date();
  return data.checks.filter(c=>{
    if(c.status==='cleared') return false;
    const due = new Date(c.dueDate);
    const diffDays = (due - now)/86400000;
    return diffDays <= 3;
  }).sort((a,b)=> new Date(a.dueDate)-new Date(b.dueDate));
}

/* ============================================================
   کشمش پلویی — سازگاری گزارش با دو قرارداد قدیمی/جدید ثبت qty (READ-ONLY)
   قدیمی: qty همان وزن به کیلوگرم است (مثلاً 8.5 / 17 / 25.5).
   جدید: qty تعداد بسته/کارتن است (1 / 2 / 3 ...) و فیلد weight همان ردیف
   (که در زمان ثبت فاکتور برابر packageWeight × qty محاسبه و ذخیره شده)
   وزن واقعی به کیلوگرم است.
   تشخیص: هر ردیفی که weight>0 دارد فقط با روش جدید (qty=تعداد بسته) ساخته
   شده، چون این فیلد فقط توسط کدی محاسبه می‌شود که qty را «تعداد بسته»
   می‌داند؛ نبودن/صفر بودن weight یعنی ردیف قدیمی است و qty خودش کیلوگرم
   است. این هیچ داده‌ای را تغییر نمی‌دهد؛ فقط در محاسبه‌ی گزارش استفاده
   می‌شود. تطبیق کالا با productId انجام می‌شود؛ نام فقط fallback است
   (برای رکوردهای یتیم بدون productId).
   ============================================================ */
const RAISIN_PILAF_NAME = 'کشمش پلویی';

function _raisinPilafProductIds(){
  const ids = new Set();
  (data.products||[]).forEach(p=>{ if((p.name||'').trim() === RAISIN_PILAF_NAME) ids.add(p.id); });
  return ids;
}
function _isRaisinPilafItem(it, raisinIds){
  if(!it) return false;
  if(it.productId) return raisinIds.has(it.productId);
  return (it.name||'').trim() === RAISIN_PILAF_NAME;
}
/** وزن واقعی به کیلوگرم برای یک ردیف فروش این کالا (برای گزارش «پرفروش‌ترین کالاها»). */
function _raisinPilafKg(it){
  if(it.weight && it.weight > 0) return it.weight;
  return it.qty || 0;
}
/** تعداد بسته/کارتن برای یک ردیف فروش این کالا (برای تاریخچه خرید مشتری). */
function _raisinPilafPackages(it){
  if(it.weight && it.weight > 0) return it.qty || 0;
  const prod = (data.products||[]).find(p=>p.id===it.productId);
  const pw = prod && prod.packageWeight;
  if(!pw) return it.qty || 0;
  return Math.round(((it.qty||0) / pw) * 100) / 100;
}

function topProducts(limit){
  const map = {};
  const raisinIds = _raisinPilafProductIds();
  data.invoices.forEach(inv=>inv.items.forEach(it=>{
    if(!map[it.productId]) map[it.productId] = {productId: it.productId, name:it.name, qty:0, revenue:0, qtyUnit:'count'};
    if(_isRaisinPilafItem(it, raisinIds)){
      map[it.productId].qty += _raisinPilafKg(it);
      map[it.productId].qtyUnit = 'kg';
    } else {
      map[it.productId].qty += it.qty;
    }
    map[it.productId].revenue += it.qty*it.price - (it.discount||0);
  }));
  return Object.values(map).sort((a,b)=>b.qty-a.qty).slice(0, limit||5);
}
function topCustomers(limit){
  return data.customers.map(c=>({ c, t: customerTotals(c.id) }))
    .sort((a,b)=>b.t.invTotal-a.t.invTotal)
    .slice(0, limit||5)
    .filter(x=>x.t.invTotal>0);
}
function debtorList(limit){
  return data.customers.map(c=>({ c, t: customerTotals(c.id) }))
    .filter(x=>x.t.balance>0)
    .sort((a,b)=>b.t.balance-a.t.balance)
    .slice(0, limit||10000);
}
function inactiveCustomers(){
  return data.customers.filter(c=>{
    const status = customerStatus(c.id);
    return status==='inactive' || status==='lost';
  }).map(c=>({c, st:customerStats(c.id)})).sort((a,b)=>b.st.daysSinceLast-a.st.daysSinceLast);
}

/* ============================================================
   Customer Behavior — pure derived metrics (READ-ONLY)
   Purchase truth = invoices (all-time baseline). Visits = observation only.
   No metrics stored in DB. No financial side effects.
   ============================================================ */

function _behaviorSalesInRange(invs, startISO, endISO){
  return invs.reduce((s, inv)=>{
    const d = inv.date || '';
    if(startISO && d < startISO) return s;
    if(endISO && d > endISO) return s;
    return s + (inv.total || 0);
  }, 0);
}

/** Sales-return payments only (method==='return'). READ-ONLY. Does not touch stock/FIFO. */
function _behaviorReturnPayments(cid, ctx){
  return (typeof customerPayments === 'function' ? customerPayments(cid, ctx) : [])
    .filter(p => p && p.method === 'return');
}

function _behaviorReturnsInRange(returns, startISO, endISO, invs){
  // BUGFIX (proven by runtime repro): a return should offset the sales
  // bucket that contains the ORIGINAL sale, not whichever period the
  // return itself happens to fall in. Previously this used the return's
  // own date only, so returning an old invoice today could silently
  // corrupt the CURRENT period's totals (observed producing a negative
  // "sales30" figure) even though nothing about the current period
  // actually changed. When the return is linked to its original invoice
  // (p.invoiceId) and that invoice is resolvable, use the invoice's date
  // instead. Falls back to the return's own date when unresolvable
  // (e.g. account-only returns with no invoiceId), preserving prior
  // behavior for that case.
  var invById = null;
  if (Array.isArray(invs)) {
    invById = {};
    for (var i = 0; i < invs.length; i++) {
      if (invs[i] && invs[i].id) invById[invs[i].id] = invs[i];
    }
  }
  return returns.reduce((s, p)=>{
    var refDate = p.date || '';
    if (invById && p.invoiceId && invById[p.invoiceId] && invById[p.invoiceId].date) {
      refDate = invById[p.invoiceId].date;
    }
    if(startISO && refDate < startISO) return s;
    if(endISO && refDate > endISO) return s;
    return s + (p.amount || 0);
  }, 0);
}

function _behaviorISODaysAgo(n){
  const ref = new Date();
  const d = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate() - n);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

/**
 * Visit cadence (days) from consecutive customer visit gaps.
 * <2 visits → null. Median gap, clamped to 1..90. Read-only.
 */
function visitCadence(cid, ctx, skipMemo){
  if (ctx && typeof ctx.memo === 'function' && !skipMemo) {
    return ctx.memo('visitCadence', cid, function(){ return visitCadence(cid, ctx, true); });
  }
  if(!cid || typeof data === 'undefined' || !Array.isArray(data.customers)) return null;
  const cust = data.customers.find(function(c){ return c && c.id === cid; });
  const visits = (cust && Array.isArray(cust.visits)) ? cust.visits : [];
  if(visits.length < 2) return null;

  const sorted = visits.slice().sort(function(a, b){
    return String(a.date || '').localeCompare(String(b.date || '')) ||
      String(a.time || '').localeCompare(String(b.time || ''));
  });

  const gaps = [];
  for(let i = 1; i < sorted.length; i++){
    const d0 = sorted[i - 1].date;
    const d1 = sorted[i].date;
    if(!d0 || !d1) continue;
    let days = null;
    const p0 = (typeof parseISODateParts === 'function') ? parseISODateParts(String(d0).slice(0, 10)) : null;
    const p1 = (typeof parseISODateParts === 'function') ? parseISODateParts(String(d1).slice(0, 10)) : null;
    if(p0 && p1){
      const t0 = new Date(p0.y, p0.m - 1, p0.d).getTime();
      const t1 = new Date(p1.y, p1.m - 1, p1.d).getTime();
      if(!isNaN(t0) && !isNaN(t1)) days = Math.round((t1 - t0) / 86400000);
    } else {
      const t0 = new Date(d0).getTime();
      const t1 = new Date(d1).getTime();
      if(!isNaN(t0) && !isNaN(t1)) days = Math.round((t1 - t0) / 86400000);
    }
    if(days != null && isFinite(days) && days >= 0) gaps.push(days);
  }
  if(!gaps.length) return null;

  gaps.sort(function(a, b){ return a - b; });
  const mid = Math.floor(gaps.length / 2);
  let median;
  if(gaps.length % 2 === 1) median = gaps[mid];
  else median = Math.round((gaps[mid - 1] + gaps[mid]) / 2);

  if(!isFinite(median) || median < 1) return 1;
  if(median > 90) return 90;
  return median;
}

/**
 * Days the customer is overdue relative to their visit cadence.
 * No cadence → 0. Read-only.
 */
function visitOverdueDays(cid, ctx, skipMemo){
  if (ctx && typeof ctx.memo === 'function' && !skipMemo) {
    return ctx.memo('visitOverdueDays', cid, function(){ return visitOverdueDays(cid, ctx, true); });
  }
  const cadence = visitCadence(cid, ctx);
  if(!cadence) return 0;
  if(!cid || typeof data === 'undefined' || !Array.isArray(data.customers)) return 0;
  const cust = data.customers.find(function(c){ return c && c.id === cid; });
  const visits = (cust && Array.isArray(cust.visits)) ? cust.visits : [];
  if(!visits.length) return 0;

  const sorted = visits.slice().sort(function(a, b){
    return String(b.date || '').localeCompare(String(a.date || '')) ||
      String(b.time || '').localeCompare(String(a.time || ''));
  });
  const lastDate = sorted[0] && sorted[0].date;
  if(!lastDate) return 0;
  const daysSince = (typeof daysAgo === 'function') ? daysAgo(lastDate) : null;
  if(daysSince == null || !isFinite(daysSince)) return 0;
  return Math.max(0, daysSince - cadence);
}

/* Valid rejection reason codes — mirrors REJECTION_REASON_CHIPS in app.js /
   the rr label map in views/visits.js & views/customer.js. Kept local to
   calc.js (read-only lookup only); not a new stored schema. */
var _BEHAVIOR_VALID_REJECTION_REASONS = { price:1, quality:1, competitor:1, unavailable:1, no_need:1, still_stock:1, other:1 };
/* Valid stockSource codes when rejectionReason === 'still_stock'. Independent from rejectionReason=competitor. */
var _BEHAVIOR_VALID_STOCK_SOURCES = { ours:1, competitor:1, unknown:1 };

/** Same date-diff mechanism as the avgIntervalDays block above (parseISODateParts,
 * falling back to new Date(iso) on parse failure) — no new timezone handling invented.
 * Returns days from isoFrom to isoTo (isoTo - isoFrom), or null if either date is unparsable. */
function _behaviorDaysDiff(isoFrom, isoTo){
  const p0 = (typeof parseISODateParts === 'function') ? parseISODateParts(isoFrom) : null;
  const p1 = (typeof parseISODateParts === 'function') ? parseISODateParts(isoTo) : null;
  let t0, t1;
  if(p0 && p1){
    t0 = new Date(p0.y, p0.m - 1, p0.d).getTime();
    t1 = new Date(p1.y, p1.m - 1, p1.d).getTime();
  } else {
    t0 = new Date(isoFrom).getTime();
    t1 = new Date(isoTo).getTime();
  }
  if(isNaN(t0) || isNaN(t1)) return null;
  return Math.round((t1 - t0) / 86400000);
}

/* PHASE 1 — Product Offered + Customer Reaction + Rejection Reason.
 * Pure derived read from data.customers[].visits[].offeredProducts[]. Never mutates data,
 * never counts accepted/deferred as a sale/order. */
function _behaviorOfferedProductStats(visits){
  const map = {}; // productId -> stat entry
  const order = [];
  (visits || []).forEach(v=>{
    if(!Array.isArray(v.offeredProducts)) return;
    v.offeredProducts.forEach(op=>{
      if(!op || !op.productId) return; // skip: no productId
      const pid = op.productId;
      if(!map[pid]){
        const prod = (data.products || []).find(p=>p.id===pid);
        map[pid] = {
          productId: pid,
          productName: prod ? (prod.name || pid) : pid,
          offeredCount: 0,
          acceptedCount: 0,
          rejectedCount: 0,
          deferredCount: 0,
          rejectionReasons: {},
          stillStockSources: { ours: 0, competitor: 0, unknown: 0 },
          lastOfferedDate: null,
        };
        order.push(pid);
      }
      const st = map[pid];
      st.offeredCount++;
      if(op.reaction === 'accepted'){
        st.acceptedCount++;
      } else if(op.reaction === 'deferred'){
        st.deferredCount++;
      } else if(op.reaction === 'rejected'){
        st.rejectedCount++;
        const reason = op.rejectionReason;
        if(reason && _BEHAVIOR_VALID_REJECTION_REASONS[reason]){
          st.rejectionReasons[reason] = (st.rejectionReasons[reason] || 0) + 1;
        }
        // still_stock + stockSource breakdown (independent from rejectionReason=competitor)
        if(reason === 'still_stock' && op.stockSource && _BEHAVIOR_VALID_STOCK_SOURCES[op.stockSource]){
          st.stillStockSources[op.stockSource] = (st.stillStockSources[op.stockSource] || 0) + 1;
        }
        // invalid/empty reason: counted in rejectedCount above, just not aggregated by reason
      }
      if(v.date && (!st.lastOfferedDate || v.date > st.lastOfferedDate)){
        st.lastOfferedDate = v.date;
      }
    });
  });
  return order.map(pid=>map[pid]);
}

/* PHASE 2 — Visit ↔ Invoice contextual attribution.
 * Pure derived read from data.invoices[] + this customer's own visits (ownership preserved:
 * only visits already scoped to this customer are searched). Never mutates data, never
 * changes invoiceCount/sales30/sales90/visitCount/conversionRate. */
function _behaviorVisitInvoiceStats(invs, visits){
  const empty = {
    linkedInvoiceCount: 0,
    avgDaysBetweenVisitAndInvoice: null,
    minDays: null,
    maxDays: null,
    lastDays: null,
    lastInvoiceDate: null,
    lastVisitDate: null,
  };
  if(!Array.isArray(invs) || !invs.length || !Array.isArray(visits) || !visits.length) return empty;

  const links = []; // in ascending invoice order (invs is pre-sorted ascending by date/number)
  invs.forEach(inv=>{
    const vid = inv.visitId;
    if(!vid || typeof vid !== 'string' || !vid.trim()) return; // no/invalid visitId
    const visit = visits.find(v=>v.id === vid);
    if(!visit) return; // not resolvable within this customer's own visits → not linked
    const days = _behaviorDaysDiff(visit.date, inv.date);
    if(days === null) return; // unparsable dates → not linked
    if(days < 0) return; // invoice.date < visit.date → excluded from valid attribution, no new rule invented
    links.push({ days, invoiceDate: inv.date, visitDate: visit.date });
  });

  if(!links.length) return empty;

  const daysList = links.map(l=>l.days);
  const sum = daysList.reduce((a,b)=>a+b, 0);
  const last = links[links.length - 1];

  return {
    linkedInvoiceCount: links.length,
    avgDaysBetweenVisitAndInvoice: sum / links.length,
    minDays: Math.min.apply(null, daysList),
    maxDays: Math.max.apply(null, daysList),
    lastDays: last.days,
    lastInvoiceDate: last.invoiceDate,
    lastVisitDate: last.visitDate,
  };
}

/**
 * Runtime derived behavior profile for sales decisions.
 * Purchase truth = invoices minus sales-returns (payments method==='return').
 * Visits = observation only. Returns null when data is insufficient. Never mutates data.
 */
function customerBehavior(cid, ctx, skipMemo){
  if(ctx && typeof ctx.memo === 'function' && !skipMemo){
    return ctx.memo('customerBehavior', cid, function(){ return customerBehavior(cid, ctx, true); });
  }
  const invs = customerInvoices(cid, ctx).slice().sort((a,b)=>
    (a.date||'').localeCompare(b.date||'') || String(a.number||'').localeCompare(String(b.number||'')));
  const returns = _behaviorReturnPayments(cid, ctx);
  const cust = ctx && typeof ctx.customerById === 'function'
    ? ctx.customerById(cid)
    : (data.customers || []).find(c => c.id === cid);
  const visits = ((cust && cust.visits) || []).slice().sort((a,b)=>
    (b.date||'').localeCompare(a.date||'') || (b.time||'').localeCompare(a.time||''));

  const count = invs.length;
  const firstInvoiceDate = count ? invs[0].date : null;
  const lastInvoiceDate = count ? invs[count - 1].date : null;
  const invTotalGross = invs.reduce((s,i)=> s + (i.total||0), 0);
  const returnTotal = returns.reduce((s,p)=> s + (p.amount||0), 0);
  const invTotal = invTotalGross - returnTotal;
  const avgInvoice = count ? invTotal / count : null;

  let avgIntervalDays = null;
  if(count >= 2){
    const intervals = [];
    for(let i = 1; i < count; i++){
      const p0 = (typeof parseISODateParts === 'function') ? parseISODateParts(invs[i-1].date) : null;
      const p1 = (typeof parseISODateParts === 'function') ? parseISODateParts(invs[i].date) : null;
      if(p0 && p1){
        const t0 = new Date(p0.y, p0.m - 1, p0.d).getTime();
        const t1 = new Date(p1.y, p1.m - 1, p1.d).getTime();
        if(!isNaN(t0) && !isNaN(t1)) intervals.push(Math.round((t1 - t0) / 86400000));
      } else {
        const t0 = new Date(invs[i-1].date).getTime();
        const t1 = new Date(invs[i].date).getTime();
        if(!isNaN(t0) && !isNaN(t1)) intervals.push(Math.round((t1 - t0) / 86400000));
      }
    }
    if(intervals.length){
      avgIntervalDays = intervals.reduce((a,b)=>a+b, 0) / intervals.length;
    }
  }

  const daysSinceLastRaw = lastInvoiceDate ? daysAgo(lastInvoiceDate) : null;
  const daysSinceLast = (daysSinceLastRaw != null && isFinite(daysSinceLastRaw)) ? daysSinceLastRaw : null;
  const behindPattern = (avgIntervalDays != null && daysSinceLast != null)
    ? (daysSinceLast > avgIntervalDays + 0.5)
    : null;

  /* Limited-history guard inputs (ADDITIVE — avgIntervalDays / behindPattern above
     keep their legacy meaning for the UI and the Watch layer).
     Based on DISTINCT purchase days: several invoices on one day are ONE purchase
     occasion, so they neither count as extra purchase days nor create 0-day gaps.
     A day counts only if at least one invoice that day has total > 0.
     These are minimum-caution inputs, not a scientific sufficiency measure. */
  const _purchaseDays = [];
  {
    const _seenDays = Object.create(null);
    invs.forEach(function(inv){
      if(!inv || !(inv.total > 0)) return;
      const d = inv.date ? String(inv.date).slice(0, 10) : '';
      if(!d || _seenDays[d]) return;
      if(typeof parseISODateParts === 'function' && !parseISODateParts(d)) return;
      _seenDays[d] = true;
      _purchaseDays.push(d);
    });
    _purchaseDays.sort();
  }
  const purchaseDayCount = _purchaseDays.length;
  const _distinctIntervals = [];
  for(let i = 1; i < _purchaseDays.length; i++){
    const gap = _behaviorDaysDiff(_purchaseDays[i-1], _purchaseDays[i]);
    if(gap != null && gap > 0) _distinctIntervals.push(gap);
  }
  const distinctIntervalCount = _distinctIntervals.length;
  const avgDistinctIntervalDays = distinctIntervalCount
    ? _distinctIntervals.reduce((a,b)=>a+b, 0) / distinctIntervalCount
    : null;
  const behindPatternDistinct = (avgDistinctIntervalDays != null && daysSinceLast != null)
    ? (daysSinceLast > avgDistinctIntervalDays + 0.5)
    : null;

  const today = (typeof todayISO === 'function') ? todayISO() : new Date().toISOString().slice(0,10);
  const d30 = _behaviorISODaysAgo(30);
  const d60 = _behaviorISODaysAgo(60);
  const d90 = _behaviorISODaysAgo(90);
  const d31 = _behaviorISODaysAgo(31);
  const sales30 = _behaviorSalesInRange(invs, d30, today) - _behaviorReturnsInRange(returns, d30, today, invs);
  const sales90 = _behaviorSalesInRange(invs, d90, today) - _behaviorReturnsInRange(returns, d90, today, invs);
  const salesPrev30 = _behaviorSalesInRange(invs, d60, d31) - _behaviorReturnsInRange(returns, d60, d31, invs);

  let amountTrend = null;
  if(count >= 2){
    const a = sales30, b = salesPrev30;
    if(b === 0 && a === 0) amountTrend = 'flat';
    else if(b === 0 && a > 0) amountTrend = 'up';
    else if(a === 0 && b > 0) amountTrend = 'down';
    else if(b > 0){
      const ratio = a / b;
      if(ratio >= 1.15) amountTrend = 'up';
      else if(ratio <= 0.85) amountTrend = 'down';
      else amountTrend = 'flat';
    }
  }

  /* Net product qty/revenue: sold from invoices minus returnItems on return payments.
     کشمش پلویی: در این لیست («کالاهای اصلی مشتری» / تاریخچه خرید) qty باید تعداد
     بسته/کارتن باشد، نه کیلوگرم — رجوع کن به توضیح _raisinPilafPackages در بالای فایل. */
  const prodMap = {};
  const _raisinIdsForBehavior = _raisinPilafProductIds();
  invs.forEach(inv => {
    (inv.items || []).forEach(it => {
      if(!it.productId && !it.name) return;
      const key = it.productId || ('n:' + (it.name || ''));
      if(!prodMap[key]) prodMap[key] = { productId: it.productId || null, name: it.name || '—', qty: 0, revenue: 0 };
      prodMap[key].qty += _isRaisinPilafItem(it, _raisinIdsForBehavior) ? _raisinPilafPackages(it) : (it.qty || 0);
      prodMap[key].revenue += (it.qty || 0) * (it.price || 0) - (it.discount || 0);
    });
  });
  returns.forEach(p => {
    (p.returnItems || []).forEach(ri => {
      if(!ri.productId && !ri.name) return;
      const key = ri.productId || ('n:' + (ri.name || ''));
      if(!prodMap[key]) prodMap[key] = { productId: ri.productId || null, name: ri.name || '—', qty: 0, revenue: 0 };
      prodMap[key].qty -= (ri.qty || 0);
      prodMap[key].revenue -= (ri.qty || 0) * (ri.price || 0);
    });
  });
  // Exclude inactive products from CURRENT intelligence signals only (not historical data).
  const topProductsList = Object.values(prodMap)
    .filter(p => p.qty > 0.0001)
    .filter(p => {
      if(!p.productId) return true;
      const prod = ctx && typeof ctx.productById === 'function'
        ? ctx.productById(p.productId)
        : (data.products || []).find(x => x.id === p.productId);
      return !prod || prod.active !== false;
    })
    .sort((a,b)=> b.qty - a.qty)
    .slice(0, 5);

  let decliningProducts = [];
  if(count >= 4){
    const mid = Math.floor(count / 2);
    const early = invs.slice(0, mid);
    const late = invs.slice(mid);
    const earlyMap = {}, lateMap = {};
    function accSold(list, map){
      list.forEach(inv => (inv.items||[]).forEach(it=>{
        const key = it.productId || ('n:' + (it.name||''));
        if(!map[key]) map[key] = { productId: it.productId||null, name: it.name||'—', qty: 0 };
        /* کشمش پلویی: نرمال‌سازی به تعداد بسته/کارتن تا رکوردهای قدیمی (qty=کیلوگرم)
           و جدید (qty=تعداد بسته) قابل مقایسه باشند — رجوع کن به _raisinPilafPackages بالای فایل. */
        map[key].qty += _isRaisinPilafItem(it, _raisinIdsForBehavior) ? _raisinPilafPackages(it) : (it.qty||0);
      }));
    }
    accSold(early, earlyMap);
    accSold(late, lateMap);
    /* Return allocation follows the same rule as _behaviorReturnsInRange:
       linked returns use the original invoice date; account-only or
       unresolvable returns fall back to the return's own date. */
    const midDate = invs[mid] && invs[mid].date ? invs[mid].date : null;
    let returnInvById = null;
    if(Array.isArray(invs)){
      returnInvById = {};
      invs.forEach(inv => {
        if(inv && inv.id) returnInvById[inv.id] = inv;
      });
    }
    if(midDate){
      returns.forEach(p => {
        let refDate = p.date || '';
        if(returnInvById && p.invoiceId && returnInvById[p.invoiceId] && returnInvById[p.invoiceId].date){
          refDate = returnInvById[p.invoiceId].date;
        }
        const target = refDate < midDate ? earlyMap : lateMap;
        (p.returnItems || []).forEach(ri => {
          const key = ri.productId || ('n:' + (ri.name||''));
          if(!target[key]) target[key] = { productId: ri.productId||null, name: ri.name||'—', qty: 0 };
          target[key].qty -= (ri.qty||0);
        });
      });
    }
    Object.keys(earlyMap).forEach(key => {
      const e = earlyMap[key].qty;
      const l = (lateMap[key] && lateMap[key].qty) || 0;
      if(e >= 2 && l < e * 0.6){
        const pid = earlyMap[key].productId;
        if(pid){
          const prod = ctx && typeof ctx.productById === 'function'
            ? ctx.productById(pid)
            : (data.products || []).find(x => x.id === pid);
          if(prod && prod.active === false) return; // exclude inactive from CURRENT signals
        }
        decliningProducts.push({
          name: earlyMap[key].name,
          productId: earlyMap[key].productId,
          earlyQty: Math.max(0, Math.round(e * 100) / 100),
          lateQty: Math.max(0, Math.round(l * 100) / 100)
        });
      }
    });
    decliningProducts.sort((a,b)=> (b.earlyQty - b.lateQty) - (a.earlyQty - a.lateQty));
    decliningProducts = decliningProducts.slice(0, 5);
  }

  const visitCount = visits.length;
  let orderedCount = 0;
  visits.forEach(v=>{
    if(v.ordered === true || (typeof VISIT_RESULTS !== 'undefined' && v.result === VISIT_RESULTS[0])) orderedCount++;
  });
  const conversionRate = visitCount ? (orderedCount / visitCount) : null;
  const lastVisit = visitCount ? visits[0] : null;
  const lastNextAction = (lastVisit && lastVisit.nextAction) ? lastVisit.nextAction : null;
  let consecutiveNoOrder = 0;
  for(const v of visits){
    const ordered = v.ordered === true || (typeof VISIT_RESULTS !== 'undefined' && v.result === VISIT_RESULTS[0]);
    if(ordered) break;
    consecutiveNoOrder++;
  }

  // PHASE 1 + PHASE 2 — additive, derived-only metadata (see functions above).
  const offeredProductStats = _behaviorOfferedProductStats(visits);
  const visitInvoiceStats = _behaviorVisitInvoiceStats(invs, visits);

  return {
    invoiceCount: count,
    firstInvoiceDate,
    lastInvoiceDate,
    invTotalGross,
    returnTotal,
    invTotal,
    avgInvoice,
    avgIntervalDays,
    daysSinceLast,
    behindPattern,
    purchaseDayCount,
    distinctIntervalCount,
    avgDistinctIntervalDays,
    behindPatternDistinct,
    sales30,
    sales90,
    salesPrev30,
    amountTrend,
    topProducts: topProductsList,
    decliningProducts,
    visitCount,
    orderedCount,
    conversionRate,
    consecutiveNoOrder,
    lastVisit,
    lastNextAction,
    offeredProductStats,
    visitInvoiceStats,
  };
}


/* ============================================================
   Daily Command Center metrics — pure, date-scoped, read-only.
   Uses the same profit definition as customerProfit(), without
   recalculating FIFO or changing any existing financial function.
   ============================================================ */
function _ccJalaliParts(isoOrDate){
  if(typeof isoOrDate === 'string' && typeof isoToJalali === 'function'){
    const j = isoToJalali(isoOrDate.slice(0,10));
    if(j) return {jy:j[0], jm:j[1], jd:j[2]};
  }
  const d = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate);
  if(isNaN(d.getTime())) return null;
  if(typeof gregorianToJalali === 'function'){
    const j = gregorianToJalali(d.getFullYear(), d.getMonth()+1, d.getDate());
    return {jy:j[0], jm:j[1], jd:j[2]};
  }
  return {jy:d.getFullYear(), jm:d.getMonth()+1, jd:d.getDate()};
}

function _ccInJalaliRange(dateValue, jy, jm, jdMin, jdMax){
  const p = _ccJalaliParts(dateValue);
  return !!p && p.jy===jy && p.jm===jm && p.jd>=jdMin && p.jd<=jdMax;
}

function _ccPreviousJalaliMonth(jy, jm){
  return jm === 1 ? {jy:jy-1, jm:12} : {jy:jy, jm:jm-1};
}

function _ccReturnMarginForPayment(cid, p, ctx){
  let margin = 0;
  (p.returnItems || []).forEach(function(ri){
    if(!(Number(ri.qty)>0)) return;
    const prod = (data.products||[]).find(function(x){ return x.id===ri.productId; });
    let sourceItem = null;
    let buyCostTotal = 0;
    let allocatedQty = 0;
    if(p.invoiceId){
      const srcInv = (data.invoices||[]).find(function(i){ return i.id===p.invoiceId; });
      if(srcInv){
        const items = (srcInv.items||[]).filter(function(it){ return it.productId===ri.productId; });
        // Match customerProfit()/stock.js return allocation order: all original FIFO
        // allocations for this product, in invoice-line order, skipping previous returns.
        const allocs = [];
        items.forEach(function(it){
          if(Array.isArray(it.costAllocations)) it.costAllocations.forEach(function(a){
            const q=Number(a.qty)||0; const uc=Number(a.unitCost)||0;
            if(q>0) allocs.push({qty:q, unitCost:uc});
          });
        });
        if(allocs.length){
          let skip=0;
           for(const x of customerPayments(cid, ctx)){
            if(x.method!=='return' || x.invoiceId!==p.invoiceId) continue;
            if(x.id===p.id) break;
            (x.returnItems||[]).forEach(function(xri){
              if(xri.productId===ri.productId) skip += Number(xri.qty)||0;
            });
          }
          let need=Number(ri.qty)||0;
          for(const a of allocs){
            if(skip>=a.qty){ skip-=a.qty; continue; }
            const take=Math.min(need, a.qty-skip);
            if(take>0){
              buyCostTotal += take*a.unitCost;
              allocatedQty += take;
              need -= take;
            }
            skip=0;
            if(need<=1e-9) break;
          }
        }
        sourceItem = items[0] || null;
      }
    }
    if(!sourceItem){
       const sold = customerInvoices(cid, ctx).flatMap(function(inv){
        return (inv.items||[]).filter(function(it){ return it.productId===ri.productId; });
      });
      sourceItem = sold.length ? sold[sold.length-1] : null;
    }
    const qty=Number(ri.qty)||0;
    const sell = Number(ri.price)>0 ? Number(ri.price) : (sourceItem ? (Number(sourceItem.price)||0) : 0);
    if(allocatedQty>0){
      const qtyForCost=Math.min(qty,allocatedQty);
      margin += (sell * qtyForCost) - buyCostTotal;
      if(qtyForCost < qty){
        const fallbackBuy=(sourceItem && sourceItem.buyPrice!==undefined) ? (Number(sourceItem.buyPrice)||0) : (prod ? (Number(prod.buy)||0) : 0);
        margin += (sell - fallbackBuy) * (qty-qtyForCost);
      }
    } else {
      const buy=(sourceItem && sourceItem.buyPrice!==undefined) ? (Number(sourceItem.buyPrice)||0) : (prod ? (Number(prod.buy)||0) : 0);
      margin += (sell - buy) * qty;
    }
  });
  return margin;
}

function _ccCustomerProfitInJalaliRange(cid, jy, jm, jdMin, jdMax, ctx){
  const invs = customerInvoices(cid, ctx).filter(function(inv){ return _ccInJalaliRange(inv.date, jy, jm, jdMin, jdMax); });
  let profit = invs.reduce(function(sum, inv){
    const itemsProfit = (inv.items||[]).reduce(function(a,it){
      return a + ((Number(it.price)||0) - (Number(it.buyPrice)||0)) * (Number(it.qty)||0) - (Number(it.discount)||0);
    },0);
    return sum + itemsProfit - invoiceDiscountAmount(inv);
  },0);

  customerPayments(cid, ctx).filter(function(p){
    return _ccInJalaliRange(p.date, jy, jm, jdMin, jdMax);
  }).forEach(function(p){
    if(p.method==='return') profit -= _ccReturnMarginForPayment(cid, p, ctx);
    if(p.method==='discount') profit -= Number(p.amount)||0;
  });
  return profit;
}

function _ccProfitInJalaliRange(jy, jm, jdMin, jdMax, ctx){
  return (data.customers||[]).reduce(function(sum,c){
    return sum + _ccCustomerProfitInJalaliRange(c.id, jy, jm, jdMin, jdMax, ctx);
  },0);
}

function commandCenterMetrics(refDate, ctx, skipMemo){
  if(ctx && typeof ctx.memo === 'function' && !skipMemo){
    var metricKey = refDate instanceof Date ? refDate.toISOString() : String(refDate || '');
    return ctx.memo('commandCenterMetrics', metricKey, function(){ return commandCenterMetrics(refDate, ctx, true); });
  }
  const ref = refDate instanceof Date ? refDate : new Date(refDate || Date.now());
  const cur = _ccJalaliParts(ref);
  if(!cur) return {mtdSales:0,mtdProfit:0,mtdCount:0,priorSales:0,priorProfit:0,priorCount:0,priorDayCount:0,salesDeltaPct:null,profitDeltaPct:null};
  const prev = _ccPreviousJalaliMonth(cur.jy, cur.jm);
  const prevMax = Math.min(cur.jd, typeof jalaliMonthLength==='function' ? jalaliMonthLength(prev.jy, prev.jm) : cur.jd);

  let mtdSales = 0, mtdCount = 0, priorSales = 0, priorCount = 0;
  (data.invoices||[]).forEach(function(inv){
    if(_ccInJalaliRange(inv.date, cur.jy, cur.jm, 1, cur.jd)){
      mtdSales += Number(inv.total)||0;
      mtdCount++;
    }
    if(_ccInJalaliRange(inv.date, prev.jy, prev.jm, 1, prevMax)){
      priorSales += Number(inv.total)||0;
      priorCount++;
    }
  });

  const mtdProfit = _ccProfitInJalaliRange(cur.jy, cur.jm, 1, cur.jd, ctx);
  const priorProfit = _ccProfitInJalaliRange(prev.jy, prev.jm, 1, prevMax, ctx);
  const salesDeltaPct = priorSales ? ((mtdSales-priorSales)/priorSales)*100 : (mtdSales ? null : 0);
  const profitDeltaPct = priorProfit ? ((mtdProfit-priorProfit)/Math.abs(priorProfit))*100 : (mtdProfit ? null : 0);

  return { jy:cur.jy, jm:cur.jm, jd:cur.jd, mtdSales, mtdProfit, mtdCount, priorSales, priorProfit, priorCount, priorDayCount:prevMax, salesDeltaPct, profitDeltaPct };
}

var SALES_TARGET_KEY = 'baqeri_sales_target_v1';
var SALES_TARGET_DB_KEY = 'salesTarget';
var _monthlySalesTargetCache = null;
function getMonthlySalesTarget(){
  if(_monthlySalesTargetCache !== null) return Math.max(0, Number(_monthlySalesTargetCache)||0);
  try {
    var raw = localStorage.getItem(SALES_TARGET_KEY);
    if(raw !== null){
      _monthlySalesTargetCache = Math.max(0, Number(raw)||0);
      return _monthlySalesTargetCache;
    }
  } catch(e) {}
  return 0;
}
function setMonthlySalesTarget(n){
  const value = Math.max(0, Number(n)||0);
  _monthlySalesTargetCache = value;
  try { localStorage.setItem(SALES_TARGET_KEY, String(value)); } catch(e) {}
  // Secondary durable copy in IndexedDB. This is settings-only and does not
  // participate in any financial calculation.
  if(typeof dbPut === 'function') dbPut(SALES_TARGET_DB_KEY, value).catch(function(e){ console.warn('monthly sales target db save failed', e); });
  return value;
}
async function hydrateMonthlySalesTarget(){
  if(_monthlySalesTargetCache !== null) return _monthlySalesTargetCache;
  var local = null;
  try {
    var raw = localStorage.getItem(SALES_TARGET_KEY);
    if(raw !== null) local = Math.max(0, Number(raw)||0);
  } catch(e) {}
  if(local !== null){ _monthlySalesTargetCache = local; return local; }
  if(typeof dbGet === 'function'){
    try {
      var row = await dbGet(SALES_TARGET_DB_KEY);
      var value = row && Object.prototype.hasOwnProperty.call(row,'value') ? row.value : row;
      if(value !== null && value !== undefined){
        _monthlySalesTargetCache = Math.max(0, Number(value)||0);
        try { localStorage.setItem(SALES_TARGET_KEY, String(_monthlySalesTargetCache)); } catch(e) {}
        return _monthlySalesTargetCache;
      }
    } catch(e) { console.warn('monthly sales target db load failed', e); }
  }
  _monthlySalesTargetCache = 0;
  return 0;
}
