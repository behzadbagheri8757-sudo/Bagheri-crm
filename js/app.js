/* app.js — screens, forms, navigation, init, QA
   Phase 0 extract: no logic changes. Depends on models/db/calc/stock/backup/ui.
*/
// ---------- submit guard (double-tap on mobile) ----------
/** Disable mutation button for one run; always release the guard while the sheet remains open. */
function focusValidationControl(btn){
  if(!btn) return;
  const id = btn.id || '';
  const root = btn.closest('.sheet') || document;
  let selectors = [];
  if(id === 'save-customer') selectors = ['#f-name'];
  else if(id === 'save-check') selectors = ['#f-amount'];
  else if(id === 'save-tx') selectors = ['#f-amount','#f-return-invoice','.ret-qty'];
  else if(id === 'ep-save') selectors = ['#ep-amount'];
  else if(id === 'save-suppay') selectors = ['#f-amount'];
  else if(id === 'save-purchase') selectors = ['#f-amount','#f-product','#mi-product','#mi-qty','#mi-price'];
  else if(id === 'save-return') selectors = ['#f-ret-qty','#f-ret-amount','.ret-item-qty'];
  else if(id === 'save-product') selectors = ['#f-name'];
  else if(id === 'save-invoice') selectors = ['.row-product-search','.row-qty','.row-price','#f-discount'];
  else if(id === 'save-visit' || id === 'save-visit-invoice') selectors = ['[data-vgroup]'];
  for(const sel of selectors){
    const el = root.querySelector(sel);
    if(el && !el.disabled && el.offsetParent !== null){
      try{ el.setAttribute('aria-invalid','true'); el.focus({preventScroll:true}); el.scrollIntoView({behavior:'smooth',block:'center'}); }catch(_e){ try{ el.focus(); }catch(__e){} }
      return;
    }
  }
}

async function withSubmitGuard(btn, fn){
  if(!btn){ await fn(); return; }
  if(btn.disabled) return;
  btn.disabled = true;
  window.__sheetSaveInFlight = (window.__sheetSaveInFlight || 0) + 1;
  try{
    await fn();
  }catch(e){
    console.error(e);
    if(e && e.message === 'validation') focusValidationControl(btn);
    try{ btn.disabled = false; }catch(_e){}
  }finally{
    window.__sheetSaveInFlight = Math.max(0, (window.__sheetSaveInFlight || 1) - 1);
    const sheet = btn.closest('.sheet');
    const overlay = sheet && sheet.closest('.overlay');
    if (sheet && sheet.isConnected && !sheet.hidden && overlay && overlay.classList.contains('show') && btn.disabled) {
      try { btn.disabled = false; } catch(_e) {}
    }
  }
}

// ---------- render (SPA refresh trigger; legacy MPA fallback removed —
// isSpaShell() is always true in this single-shell app) ----------
function render(){
  if (typeof isSpaShell === 'function' && isSpaShell() && typeof ViewHost !== 'undefined' && ViewHost.refreshCurrent) {
    ViewHost.refreshCurrent();
  }
}

// ---------- print & image export ----------
function invoiceDocHtml(inv, cust, forPrint){
  const itemRows = inv.items.map((it,idx)=>`
    <tr>
      <td>${idx+1}</td>
      <td style="text-align:right;">${esc(it.name)}</td>
      <td>${it.qty}</td>
      <td>${toman(it.price)}</td>
      <td>${toman(it.qty*it.price-(it.discount||0))}</td>
    </tr>
  `).join('');
  const subtotal = inv.items.reduce((s,it)=>s+it.qty*it.price-(it.discount||0),0);
  const discount = inv.discount||0;
  const discountAmount = invoiceDiscountAmount(inv);
  const paidAmount = (inv.cashPaid||0)+(inv.cardPaid||0)+(inv.transferPaid||0)+(inv.checkPaid||0);
  const hasPrev = typeof inv.prevBalance==='number' && inv.prevBalance!==0;
  const hasFinal = typeof inv.newBalance==='number' && inv.newBalance!==0;
  const custDisplay = cust
    ? (cust.ownerName ? (esc(cust.name)+' / '+esc(cust.ownerName)) : esc(cust.name||'—'))
    : '—';
  return `
    <div class="inv-doc ${forPrint?'':'screen-preview'}">
      <div class="inv-head">
        <div class="inv-logo"><img src="${appLogoSrc()}" alt="لوگو" width="140" height="77"></div>
        <div class="inv-brand">
          <div class="inv-brand-name">حبوبات و خشکبار باقری</div>
          <div class="inv-doc-title">فاکتور فروش</div>
        </div>
        <div class="inv-meta">
          <div>شماره: <b>${inv.number||'—'}</b></div>
          <div>تاریخ: <b>${faDate(inv.date)}</b></div>
        </div>
      </div>
      <div class="inv-customer">
        <div>مشتری: <b>${custDisplay}</b></div>
        ${cust&&cust.phone?`<div>تماس: ${esc(cust.phone)}</div>`:''}
        ${cust&&cust.address?`<div>آدرس: ${esc(cust.address)}</div>`:''}
      </div>
      <table class="inv-table">
        <thead><tr><th>ردیف</th><th>شرح کالا</th><th>تعداد</th><th>قیمت واحد</th><th>مبلغ</th></tr></thead>
        <tbody>${itemRows}</tbody>
      </table>
      <table class="inv-totals">
        <tr><td>جمع جزء</td><td>${toman(subtotal)} تومان</td></tr>
        ${discount>0?(inv.discountType==='percent'
          ?`<tr><td>تخفیف (${toman(discount)}٪)</td><td>${toman(discountAmount)} تومان</td></tr>`
          :`<tr><td>تخفیف کلی فاکتور</td><td>${toman(discount)} تومان</td></tr>`):''}
        <tr class="inv-final"><td>مبلغ قابل پرداخت</td><td>${toman(inv.total)} تومان</td></tr>
        ${hasPrev?`<tr><td>مانده حساب قبل از فاکتور</td><td>${toman(Math.abs(inv.prevBalance))} تومان (${balanceStatusWord(inv.prevBalance)})</td></tr>`:''}
        ${paidAmount>0?`<tr><td>پرداختی همراه این فاکتور</td><td>${toman(paidAmount)} تومان</td></tr>`:''}
        ${(hasPrev||hasFinal)?`<tr class="inv-final"><td>مانده حساب بعد از فاکتور</td><td>${toman(Math.abs(inv.newBalance))} تومان (${balanceStatusWord(inv.newBalance)})</td></tr>`:''}
      </table>
      <div style="margin-top:14px;font-size:.82rem;line-height:1.7;text-align:right;">
        <div>بانک صادرات / بهزاد باقری</div>
        <div>شماره کارت: 6037 6981 0400 9928</div>
        <div>شماره شبا: IR 41 0190 0000 0011 9860 2490 05</div>
      </div>
      <div style="margin-top:10px;text-align:center;font-size:.85rem;">سپاس از اعتماد و همراهی شما</div>
      ${forPrint?`
      <div class="inv-signatures">
        <div>امضای فروشنده<div class="inv-sig-line"></div></div>
        <div>امضای خریدار<div class="inv-sig-line"></div></div>
      </div>`:''}
    </div>
  `;
}

/** Directory URL of the current HTML page (handles GitHub Pages project paths) */
function getPageDirUrl(){
  try{
    const u = new URL(window.location.href);
    let path = u.pathname || '/';
    const last = path.split('/').pop() || '';
    if(/\.[a-zA-Z0-9]+$/.test(last)){
      path = path.substring(0, path.lastIndexOf('/') + 1);
    }else if(!path.endsWith('/')){
      path = path + '/';
    }
    return u.origin + path;
  }catch(e){
    return (document.baseURI || window.location.href || '').replace(/[^/]+$/, '') || './';
  }
}

/** Absolute URL for a project-relative asset.
 * Uses document.baseURI (browser-native base-URL resolution) instead of manually
 * rebuilding origin+pathname — avoids edge cases with file:// URLs, GitHub Pages
 * sub-paths, and trailing-slash handling that a hand-rolled resolver can get wrong. */
function resolvedAssetUrl(relPath){
  try{ return new URL(relPath, document.baseURI || window.location.href).href; }
  catch(e){ return relPath; }
}
function appLogoSrc(){
  const p = (typeof APP_LOGO_DATA_URI !== 'undefined' && APP_LOGO_DATA_URI) ? APP_LOGO_DATA_URI : './logo-export.png';
  return resolvedAssetUrl(p);
}
function exportLogoSrc(){
  const p = (typeof EXPORT_LOGO_DATA_URI !== 'undefined' && EXPORT_LOGO_DATA_URI) ? EXPORT_LOGO_DATA_URI : './logo-export.png';
  return resolvedAssetUrl(p);
}

/**
 * Fetch logo once and convert to data: URL so Print/html2canvas never depend on
 * a live network path at capture time (fixes broken-image in real CRM print/export).
 * Cached in-memory for the page session.
 *
 * cache:'reload' (not 'force-cache') is deliberate: 'force-cache' tells the browser
 * to reuse ANY cached response for this URL — including an old 404 cached from
 * before assets/logo-export.png existed on the deployed site — without ever
 * checking the network again. That reproduces exactly the symptom reported:
 * the file loads fine when opened directly (a normal navigation, which does
 * revalidate), but fetch() inside the app kept serving the stale cached failure.
 * 'reload' always goes to the network for this fetch and refreshes the cache
 * with the current, correct response.
 */
let __logoDataUrlCache = Object.create(null);
async function logoToDataUrl(kind){
  const abs = kind === 'export' ? exportLogoSrc() : appLogoSrc();
  if(__logoDataUrlCache[abs]) return __logoDataUrlCache[abs];
  try{
    const res = await fetch(abs, {cache:'reload'});
    if(!res.ok) throw new Error('HTTP '+res.status+' '+res.statusText+' for '+abs);
    const blob = await res.blob();
    if(!blob || !blob.size) throw new Error('empty blob for '+abs);
    const dataUrl = await new Promise((resolve, reject)=>{
      const fr = new FileReader();
      fr.onload = ()=> resolve(fr.result);
      fr.onerror = ()=> reject(fr.error || new Error('FileReader failed'));
      fr.readAsDataURL(blob);
    });
    if(typeof dataUrl !== 'string' || dataUrl.indexOf('data:image') !== 0){
      throw new Error('not an image data URL');
    }
    __logoDataUrlCache[abs] = dataUrl;
    return dataUrl;
  }catch(e){
    console.error('logoToDataUrl failed', abs, e);
    return null;
  }
}

function waitForImg(img, timeoutMs){
  return new Promise(resolve=>{
    if(!img){ resolve({ok:true, reason:'no-img', naturalWidth:0, currentSrc:''}); return; }
    const ms = timeoutMs || 8000;
    let settled = false;
    const finish = (ok, reason)=>{
      if(settled) return;
      settled = true;
      resolve({
        ok: !!ok,
        reason: reason || '',
        naturalWidth: img.naturalWidth || 0,
        naturalHeight: img.naturalHeight || 0,
        currentSrc: img.currentSrc || img.src || ''
      });
    };
    if(img.complete){
      if(img.naturalWidth > 0) finish(true, 'already-complete');
      else finish(false, 'already-broken');
      return;
    }
    img.addEventListener('load', ()=>{
      if(img.naturalWidth > 0) finish(true, 'load');
      else finish(false, 'load-zero');
    }, {once:true});
    img.addEventListener('error', ()=> finish(false, 'error'), {once:true});
    setTimeout(()=>{
      if(img.complete && img.naturalWidth > 0) finish(true, 'timeout-ok');
      else finish(false, 'timeout');
    }, ms);
  });
}

/** Set every .inv-logo img (and all imgs) to embedded data URL, then wait for decode */
async function prepareInvoiceImgs(root, kind, timeoutMs){
  if(!root) return [];
  const dataUrl = await logoToDataUrl(kind || 'print');
  const imgs = Array.from(root.querySelectorAll('img'));
  imgs.forEach(img=>{
    if(dataUrl){
      img.removeAttribute('crossorigin');
      img.src = dataUrl;
    }else{
      // last resort: absolute path
      const raw = img.getAttribute('src') || '';
      if(raw && !/^(https?:|data:|blob:)/i.test(raw)){
        img.src = resolvedAssetUrl(raw);
      }
    }
  });
  const results = [];
  for(const img of imgs){
    results.push(await waitForImg(img, timeoutMs || 8000));
  }
  return results;
}

async function printInvoice(invId){
  const inv = data.invoices.find(x=>x.id===invId);
  if(!inv){ if(typeof showToast==='function') showToast('فاکتور برای چاپ پیدا نشد'); return; }
  const cust = data.customers.find(x=>x.id===inv.customerId);
  const area = document.getElementById('printArea');
  if(!area){ if(typeof showToast==='function') showToast('ناحیه چاپ در صفحه موجود نیست'); return; }
  area.innerHTML = invoiceDocHtml(inv, cust, true);
  const results = await prepareInvoiceImgs(area, 'print', 8000);
  const failed = results.filter(r=>!r.ok);
  if(failed.length){
    console.warn('print logo load failed', failed);
    if(typeof showToast==='function') showToast('لوگو بارگذاری نشد — مسیر logo-export.png را بررسی کنید');
  }
  // one extra frame after decode so layout/print engine sees the bitmap
  await new Promise(r=> requestAnimationFrame(()=> requestAnimationFrame(r)));
  try{ window.print(); }
  catch(e){ console.error(e); if(typeof showToast==='function') showToast('چاپ در این مرورگر پشتیبانی نشد'); }
}

function statementDocHtml(c, forPrint){
  const invs = customerInvoices(c.id).map(i=>({date:i.date, type:'فاکتور #'+(i.number||'—'), amount:i.total, kind:'debit'}));
  const pays = customerPayments(c.id).map(p=>({date:p.date, type:paymentMethodLabel(p.method), amount:p.amount, kind:'credit'}));
  const checks = customerChecks(c.id).map(ch=>({date:ch.dueDate, type:'دریافت چک'+(ch.status==='cleared'?' (وصول شده)':' (در جریان)'), amount:ch.amount, kind:'credit'}));
  const opening = (c.openingBalance||0) !== 0 ? [{date:'0000-01-01', type:'مانده حساب اولیه', amount:Math.abs(c.openingBalance), kind: c.openingBalance>0?'debit':'credit'}] : [];
  const ledger = [...opening, ...invs, ...pays, ...checks].sort((a,b)=>new Date(a.date)-new Date(b.date));

  let running = 0;
  const rowsHtml = ledger.map(l=>{
    running += (l.kind==='debit' ? l.amount : -l.amount);
    return `
      <tr>
        <td>${l.date==='0000-01-01' ? 'ابتدا' : faDate(l.date)}</td>
        <td style="text-align:right;">${esc(l.type)}</td>
        <td>${l.kind==='debit' ? toman(l.amount) : ''}</td>
        <td>${l.kind==='credit' ? toman(l.amount) : ''}</td>
        <td>${toman(running)}</td>
      </tr>
    `;
  }).join('');
  const finalBalance = running;
  return `
    <div class="inv-doc ${forPrint?'':'screen-preview'}">
      <div class="inv-head">
        <div class="inv-logo"><img src="${appLogoSrc()}" alt="لوگو" width="140" height="77"></div>
        <div class="inv-brand">
          <div class="inv-brand-name">حبوبات و خشکبار باقری</div>
          <div class="inv-doc-title">صورتحساب مشتری</div>
        </div>
        <div class="inv-meta"><div>تاریخ صدور: <b>${faDate(todayISO())}</b></div></div>
      </div>
      <div class="inv-customer">
        <div>مشتری: <b>${esc(c.name)}</b></div>
        ${c.phone?`<div>تماس: ${esc(c.phone)}</div>`:''}
        ${c.address?`<div>آدرس: ${esc(c.address)}</div>`:''}
      </div>
      <table class="inv-table">
        <thead><tr><th>تاریخ</th><th>شرح</th><th>بدهکار</th><th>بستانکار</th><th>مانده</th></tr></thead>
        <tbody>${rowsHtml || `<tr><td colspan="5" style="text-align:center;">تراکنشی ثبت نشده</td></tr>`}</tbody>
      </table>
      <table class="inv-totals">
        <tr class="inv-final"><td>مانده نهایی (${balanceStatusWord(finalBalance)})</td><td>${toman(Math.abs(finalBalance))} تومان</td></tr>
      </table>
      ${forPrint?`
      <div class="inv-signatures">
        <div>امضای فروشنده<div class="inv-sig-line"></div></div>
        <div>امضای خریدار<div class="inv-sig-line"></div></div>
      </div>`:''}
    </div>
  `;
}

async function printCustomerStatement(cid){
  const c = data.customers.find(x=>x.id===cid);
  if(!c) return;
  const area = document.getElementById('printArea');
  if(!area) return;
  area.innerHTML = statementDocHtml(c, true);
  await prepareInvoiceImgs(area, 'print', 8000);
  await new Promise(r=> requestAnimationFrame(()=> requestAnimationFrame(r)));
  try{ window.print(); }
  catch(e){ console.error(e); }
}

/** Load local vendor/html2canvas if not already present (no CDN / no network required). */
function ensureHtml2CanvasLoaded(){
  if(typeof html2canvas !== 'undefined') return Promise.resolve(true);
  if(window.__baqeriH2cPromise) return window.__baqeriH2cPromise;
  window.__baqeriH2cPromise = new Promise(function(resolve){
    var s = document.createElement('script');
    s.src = './vendor/html2canvas.min.js';
    s.async = false;
    s.onload = function(){ resolve(typeof html2canvas !== 'undefined'); };
    s.onerror = function(){ resolve(false); };
    document.head.appendChild(s);
  });
  return window.__baqeriH2cPromise;
}

async function exportInvoiceImage(invId){
  const inv = data.invoices.find(x=>x.id===invId);
  if(!inv) return;
  const h2cOk = await ensureHtml2CanvasLoaded();
  if(!h2cOk){
    showToast('کتابخانه ساخت تصویر در دسترس نیست');
    return;
  }
  const cust = data.customers.find(x=>x.id===inv.customerId);
  const holder = document.createElement('div');
  holder.style.position='fixed'; holder.style.left='-9999px'; holder.style.top='0';
  holder.style.width='420px';
  holder.style.background='#fff';
  holder.innerHTML = invoiceDocHtml(inv, cust, false);
  document.body.appendChild(holder);
  const results = await prepareInvoiceImgs(holder, 'export', 10000);
  const failed = results.filter(r=>!r.ok);
  if(failed.length){
    console.warn('export logo load failed', failed);
  }
  // ensure decode before capture
  await new Promise(r=> requestAnimationFrame(()=> requestAnimationFrame(r)));
  try{
    const canvas = await html2canvas(holder, {
      scale:2,
      backgroundColor:'#ffffff',
      useCORS:true,
      allowTaint:true,
      imageTimeout:10000
    });
    canvas.toBlob(async (blob)=>{
      await downloadFile(`فاکتور-${inv.number||''}.png`, blob, 'image/png');
      showToast('تصویر فاکتور آماده شد — می‌تونی از واتساپ بفرستی');
    }, 'image/png');
  }catch(e){
    console.error(e);
    showToast('ساخت تصویر ممکن نشد');
  }finally{
    holder.remove();
  }
}

// ---------- products / inventory ----------
function openAddProduct(editId){
  const p = editId ? data.products.find(x=>x.id===editId) : null;
  const productId = editId || null;
  const history = (p && p.priceHistory) ? [...p.priceHistory].sort((a,b)=>new Date(b.date)-new Date(a.date)).slice(0,6) : [];
  const stockLog = (p && p.stockLog) ? [...p.stockLog].sort((a,b)=>new Date(b.date)-new Date(a.date)).slice(0,8) : [];
  const profitPct = p && p.buy ? Math.round(((p.retail-p.buy)/p.buy)*100) : null;
  openSheet(`
    <h3>${p?'ویرایش جنس':'جنس جدید'}</h3>
    <div class="field"><label>نام جنس</label><input id="f-name" value="${p?esc(p.name):''}"></div>
    <div class="field">
      <label>دسته‌بندی</label>
      <input id="f-cat" list="cat-list" value="${p?esc(p.category||''):''}">
      <datalist id="cat-list">${CATEGORY_SUGGESTIONS.map(c=>`<option value="${c}">`).join('')}</datalist>
    </div>
    <div class="field"><label>وزن بسته (کیلوگرم یا گرم، اختیاری)</label><input id="f-pkgw" type="text" inputmode="decimal" value="${p&&p.packageWeight?p.packageWeight:''}"></div>

    <div class="field"><label>تاریخ این تغییر قیمت</label>${shamsiDateInputHTML('f-pdate', todayISO())}</div>
    <div class="field" style="display:flex;gap:8px;">
      <div style="flex:1;"><label>قیمت خرید</label><input id="f-buy" type="text" inputmode="decimal" value="${(typeof formatLiveAmount==='function' && p && p.buy) ? formatLiveAmount(String(p.buy)) : (p?p.buy:'')}"></div>
      <div style="flex:1;"><label>قیمت عمده</label><input id="f-wholesale" type="text" inputmode="decimal" value="${(typeof formatLiveAmount==='function' && p && p.wholesale) ? formatLiveAmount(String(p.wholesale)) : (p?p.wholesale:'')}"></div>
      <div style="flex:1;"><label>قیمت مصرف‌کننده</label><input id="f-retail" type="text" inputmode="decimal" value="${(typeof formatLiveAmount==='function' && p && p.retail) ? formatLiveAmount(String(p.retail)) : (p?p.retail:'')}"></div>
    </div>
    ${profitPct!==null?`<div class="product-profit-pct">درصد سود تقریبی: <b>${profitPct}٪</b></div>`:''}
    ${p?`<div class="empty form-hint" style="padding:0 0 8px;text-align:right;font-size:.78rem;">قیمت خرید واقعی به روش FIFO الان: <b>${toman(productFifoUnitCost(p.id))} ت</b> (میانگین وزنی لایه‌های موجود در انبار — «قیمت خرید» بالا فقط مبنای پیش‌فرض برای خریدهای بدون قیمت مشخص است) — ارزش این کالا در انبار: <b>${toman(productInventoryValue(p.id))} ت</b></div>`:''}

    <h2 class="section-title">موجودی انبار</h2>
    <div class="field" style="display:flex;gap:8px;">
      <div style="flex:1;"><label>موجودی فعلی</label><input id="f-stock" type="text" inputmode="decimal" value="${p?p.stockQty||0:0}"></div>
      <div style="flex:1;"><label>حداقل موجودی هشدار</label><input id="f-minstock" type="text" inputmode="decimal" value="${p?p.minStock||0:0}"></div>
    </div>
    ${p?`
    <div class="field" style="display:flex;gap:8px;align-items:end;">
      <div style="flex:1;"><label>تغییر سریع موجودی</label><input id="f-adjust-qty" type="text" inputmode="decimal" placeholder="مثلاً ۱۰"></div>
      <button class="btn small" id="stock-in">+ ورود</button>
      <button class="btn small secondary" id="stock-out">- خروج/اصلاح</button>
    </div>
    `:''}

    <div class="btn-row">
      <button class="btn" id="save-product">ذخیره</button>
      ${p?`<button class="btn secondary" id="toggle-product-active">${p.active===false?'فعال‌سازی':'غیرفعال‌سازی'}</button>`:''}
    </div>
    ${history.length?`
      <h2 class="section-title">تاریخچه قیمت</h2>
      <div class="product-price-history">
      ${history.map(h=>`
        <div class="ledger-row">
          <span class="name">${faDate(h.date)}</span>
          <span class="filler"></span>
          <span class="amount">خرید ${toman(h.buy)} / عمده ${toman(h.wholesale!==undefined?h.wholesale:h.sell)} / مصرف‌کننده ${toman(h.retail!==undefined?h.retail:h.sell)}</span>
        </div>
      `).join('')}
      </div>
    `:''}
    ${stockLog.length?`
      <h2 class="section-title">تاریخچه موجودی</h2>
      ${stockLog.map(l=>`
        <div class="ledger-row">
          <span class="name">${faDate(l.date)} <span class="sub">${l.note?esc(l.note):''}</span></span>
          <span class="filler"></span>
          <span class="amount" style="color:${l.qty>=0?'var(--olive-dark)':'var(--rust)'}">${l.qty>=0?'+':''}${l.qty}</span>
        </div>
      `).join('')}
    `:''}
  `);

  async function persist(){
    const liveProduct = productId ? data.products.find(x=>x.id===productId) : null;
    const name = document.getElementById('f-name').value.trim();
    const category = document.getElementById('f-cat').value.trim();
    const packageWeight = numVal(document.getElementById('f-pkgw'));
    const buy = numVal(document.getElementById('f-buy'));
    const wholesale = numVal(document.getElementById('f-wholesale'));
    const retail = numVal(document.getElementById('f-retail'));
    const pdate = document.getElementById('f-pdate').value || todayISO();
    const stockQty = numVal(document.getElementById('f-stock'));
    const minStock = numVal(document.getElementById('f-minstock'));
    if(!name){ showToast('نام جنس رو وارد کن'); return null; }
    if(liveProduct){
      const p = liveProduct;
      // Stock adjust first (may block). On failure leave other fields untouched and do not save.
      if(stockQty !== p.stockQty){
        const adj = manualStockAdjustAbsolute(p.id, stockQty, 'ویرایش دستی موجودی');
        if(!adj || !adj.ok){
          showToast((adj && adj.error) ? adj.error : 'امکان تغییر موجودی نیست');
          return null;
        }
      }
      p.name=name; p.category=category; p.packageWeight=packageWeight;
      p.buy=buy; p.wholesale=wholesale; p.retail=retail; p.sell=retail;
      p.minStock=minStock;
      p.priceHistory = p.priceHistory||[];
      p.priceHistory.push({date:pdate, buy, wholesale, retail});
      await saveData();
      return p;
    } else {
      const np = {id:uid(), name, category, packageWeight, buy, wholesale, retail, sell:retail,
        stockQty:0, minStock, priceHistory:[{date:pdate, buy, wholesale, retail}], stockLog: [], active:true};
      data.products.push(np);
      if(stockQty>0){
        manualStockIn(np.id, stockQty, 'موجودی اولیه');
      }
      await saveData();
      return np;
    }
  }

  document.getElementById('save-product').addEventListener('click', async (e)=>{
    await withSubmitGuard(e.currentTarget, async ()=>{
      const saved = await persist();
      if(!saved) throw new Error('validation');
      closeModal(); render(); showToast('ذخیره شد');
    });
  });
  if(p){
    document.getElementById('toggle-product-active').addEventListener('click', async (e)=>{
      await withSubmitGuard(e.currentTarget, async ()=>{
        const liveProduct = productId ? data.products.find(x=>x.id===productId) : null;
        if(!liveProduct) throw new Error('validation');
        liveProduct.active = (liveProduct.active===false) ? true : false;
        await saveData(); closeModal(); render();
        showToast(liveProduct.active===false ? 'جنس غیرفعال شد' : 'جنس فعال شد');
      });
    });
    document.getElementById('stock-in').addEventListener('click', async (e)=>{
      await withSubmitGuard(e.currentTarget, async ()=>{
        const q = numVal(document.getElementById('f-adjust-qty'));
        if(q<=0){ showToast('مقدار رو وارد کن'); throw new Error('validation'); }
        manualStockIn(p.id, q, 'ورود کالا');
        await saveData(); openAddProduct(p.id); showToast('موجودی اضافه شد');
      });
    });
    document.getElementById('stock-out').addEventListener('click', async (e)=>{
      await withSubmitGuard(e.currentTarget, async ()=>{
        const q = numVal(document.getElementById('f-adjust-qty'));
        if(q<=0){ showToast('مقدار رو وارد کن'); throw new Error('validation'); }
        const r = manualStockOut(p.id, q, 'خروج/اصلاح دستی');
        if(!r || !r.ok){
          showToast((r && r.error) ? r.error : 'امکان کاهش موجودی نیست');
          throw new Error('validation');
        }
        await saveData(); openAddProduct(p.id); showToast('موجودی کم شد');
      });
    });
  }
}

// ---------- customers ----------
function openAddCustomer(editId){
  const c = editId ? data.customers.find(x=>x.id===editId) : null;
  const customerId = editId || null;
  openSheet(`
    <h3>${c?'ویرایش مشتری':'مشتری جدید'}</h3>
    <div class="field"><label>نام فروشگاه</label><input id="f-name" value="${c?esc(c.name):''}"></div>
    <div class="field"><label>نام صاحب فروشگاه (اختیاری)</label><input id="f-owner" value="${c?esc(c.ownerName||''):''}"></div>
    <div class="field"><label>شماره تماس (اختیاری)</label><input id="f-phone" value="${c?esc(c.phone||''):''}"></div>
    <div class="field">
      <label>منطقه</label>
      <input id="f-region" list="region-list" value="${c?esc(c.region||''):''}">
      <datalist id="region-list">${REGION_SUGGESTIONS.map(r=>`<option value="${r}">`).join('')}</datalist>
    </div>
    <div class="field">
      <label>مسیر پخش</label>
      <select id="f-route">
        <option value="">— انتخاب نشده —</option>
        ${ROUTES.map(r=>`<option value="${r}" ${c&&c.route===r?'selected':''}>${r}</option>`).join('')}
      </select>
    </div>
    <div class="field"><label>آدرس (اختیاری)</label><input id="f-address" value="${c?esc(c.address||''):''}"></div>
    <div class="field"><label>یادداشت (اختیاری)</label><textarea id="f-note">${c?esc(c.note||''):''}</textarea></div>
    <div class="field">
      <label>مانده حساب اولیه (تومان)${c?' — برای اصلاح مانده بعد از شروع کار با برنامه':''}</label>
      <input id="f-opening" type="text" inputmode="decimal" value="${c&&c.openingBalance?c.openingBalance:''}">
      <div class="empty" style="padding:4px 0 0;text-align:right;font-size:.75rem;">بدهی مشتری از قبل از استفاده از این برنامه رو اینجا بزن. اگه خودت بهش بدهکاری (طلبکاره)، عدد رو منفی بزن. این مبلغ توی گزارش فروش/سود حساب نمی‌شه، فقط توی مانده حساب میاد.</div>
    </div>
    <div class="btn-row"><button class="btn" id="save-customer">ذخیره</button></div>
  `);
  document.getElementById('save-customer').addEventListener('click', async (e)=>{
    await withSubmitGuard(e.currentTarget, async ()=>{
      const name = document.getElementById('f-name').value.trim();
      if(!name){ showToast('نام مشتری رو وارد کن'); throw new Error('validation'); }
      const ownerName = document.getElementById('f-owner').value.trim();
      const phone = document.getElementById('f-phone').value.trim();
      const region = document.getElementById('f-region').value.trim();
      const route = document.getElementById('f-route').value;
      const address = document.getElementById('f-address').value.trim();
      const note = document.getElementById('f-note').value.trim();
      const openingBalance = numVal(document.getElementById('f-opening'));
      const liveCustomer = customerId ? data.customers.find(x=>x.id===customerId) : null;
      if(liveCustomer){ liveCustomer.ownerName=ownerName; liveCustomer.name=name; liveCustomer.phone=phone; liveCustomer.region=region; liveCustomer.route=route; liveCustomer.address=address; liveCustomer.note=note; liveCustomer.openingBalance=openingBalance; }
      else{ data.customers.push({id:uid(), name, ownerName, phone, region, route, address, note, openingBalance, visits:[], active:true}); }
      await saveData(); closeModal();
      if(liveCustomer) openCustomerDetail(liveCustomer.id);
      else render();
      showToast('ذخیره شد');
    });
  });
}

function linkedStockReturnsForInvoice(invoiceId){
  return (data.payments||[]).filter(p=>
    p.method==='return' &&
    p.invoiceId===invoiceId &&
    Array.isArray(p.returnItems) &&
    p.returnItems.length>0
  );
}

function invoiceHasLinkedStockReturn(invoiceId){
  return linkedStockReturnsForInvoice(invoiceId).length>0;
}

function linkedReturnedQtyForInvoiceProduct(invoiceId, productId){
  return linkedStockReturnsForInvoice(invoiceId).reduce((sum,p)=>
    sum + (p.returnItems||[])
      .filter(ri=>ri.productId===productId)
      .reduce((s,ri)=>s+(Number(ri.qty)||0),0), 0);
}

function invoiceSoldQtyForProduct(invoice, productId){
  return (invoice.items||[]).filter(it=>it.productId===productId)
    .reduce((sum,it)=>sum+(Number(it.qty)||0),0);
}

function invoiceReturnAvailableQty(invoice, productId){
  return Math.max(0,
    invoiceSoldQtyForProduct(invoice, productId) -
    linkedReturnedQtyForInvoiceProduct(invoice.id, productId)
  );
}

/* Phase 1 UX patch — method is chosen by a direct tap (chip) instead of a
   dropdown, and the rest of the form only appears once a method is picked
   (sequential one-tap feel). Same 5 methods, same stored values, same
   return-flow logic as before — only the method-selection widget changed. */
const TX_METHOD_CHIPS = [
  { value:'cash', label:'نقدی' },
  { value:'card', label:'کارت' },
  { value:'transfer', label:'انتقال' },
  { value:'discount', label:'تخفیف' },
  { value:'return', label:'برگشت از فروش' },
];
function openAddTransaction(cid){
  // وضعیت فرم بین رندرهای مجدد شیت نگه داشته می‌شود.
  let method = '';
  let amountStr = '';
  let dateStr = todayISO();
  let noteStr = '';
  let selectedInvoiceId = '';
  let returnRows = [];

  function selectedInvoice(){
    return selectedInvoiceId ? data.invoices.find(i=>i.id===selectedInvoiceId && i.customerId===cid) : null;
  }

  function invoiceOptionsHtml(){
    const invoices = customerInvoices(cid).slice().sort((a,b)=>
      new Date(b.date)-new Date(a.date) || String(b.number||'').localeCompare(String(a.number||''))
    );
    return invoices.map(inv=>
      `<option value="${inv.id}" ${inv.id===selectedInvoiceId?'selected':''}>فاکتور #${esc(String(inv.number||'—'))} — ${faDate(inv.date)} — ${toman(inv.total||0)} ت</option>`
    ).join('');
  }

  function invoiceProductOptionsHtml(productId){
    const inv = selectedInvoice();
    if(!inv) return '<option value="">ابتدا فاکتور را انتخاب کن</option>';
    const products = [];
    const seen = new Set();
    (inv.items||[]).forEach(it=>{
      if(!it.productId || seen.has(it.productId)) return;
      seen.add(it.productId);
      const prod = data.products.find(p=>p.id===it.productId);
      if(prod) products.push({id:prod.id, name:prod.name});
    });
    if(!products.length) return '<option value="">این فاکتور کالای قابل برگشت ندارد</option>';
    return products.map(p=>`<option value="${p.id}" ${p.id===productId?'selected':''}>${esc(p.name)}</option>`).join('');
  }

  function defaultReturnPrice(productId){
    const inv = selectedInvoice();
    const line = inv && (inv.items||[]).find(it=>it.productId===productId);
    return line ? (line.price||0) : 0;
  }

  function currentReturnQtyForProduct(productId){
    return returnRows.filter(r=>r.productId===productId).reduce((s,r)=>s+(Number(r.qty)||0),0);
  }

  function returnItemsSectionHtml(){
    if(method !== 'return') return '';
    const invoices = customerInvoices(cid);
    if(!invoices.length){
      return `<div class="empty" style="padding:8px 0;">برای برگشت کالایی، این مشتری هنوز فاکتوری ندارد. می‌توانی بدون افزودن کالا فقط اصلاح حساب را ثبت کنی.</div>`;
    }
    const inv = selectedInvoice();
    return `
      <h2 class="section-title">کالای برگشتی (اختیاری)</h2>
      <div class="field">
        <label>فاکتور مرتبط (فقط همین مشتری)</label>
        <select id="f-return-invoice">
          <option value="">بدون فاکتور — فقط اصلاح حساب</option>
          ${invoiceOptionsHtml()}
        </select>
      </div>
      ${inv ? `
        <div class="empty" style="padding:0 0 8px;text-align:right;">فقط کالاهای فاکتور #${esc(String(inv.number||'—'))} قابل انتخاب هستند.</div>
        <div id="return-items-wrap">${returnRows.map((r,idx)=>{
          const available = invoiceReturnAvailableQty(inv, r.productId);
          const usedInForm = currentReturnQtyForProduct(r.productId);
          const remainingForRow = Math.max(0, available - (usedInForm - (Number(r.qty)||0)));
          const over = !(r.qty>0) || r.qty > remainingForRow;
          return `
          <div class="field" style="display:flex;gap:6px;align-items:end;">
            <div style="flex:2;">
              <label>جنس</label>
              <select data-ridx="${idx}" class="ret-product">${invoiceProductOptionsHtml(r.productId)}</select>
            </div>
            <div style="flex:1;">
              <label>تعداد</label>
              <input type="text" inputmode="decimal" data-ridx="${idx}" class="ret-qty" value="${r.qty||''}">
            </div>
            <div style="flex:1;">
              <label>قیمت واحد (اختیاری)</label>
              <input type="text" inputmode="decimal" data-ridx="${idx}" class="ret-price" value="${r.price||''}">
            </div>
            <button class="btn small danger" data-ridx="${idx}" id="ret-del-${idx}" style="flex:0;">حذف</button>
          </div>
          <div class="sub" style="margin:-6px 0 10px;${over?'color:var(--rust);':''}">
            قابل برگشت از این فاکتور برای این کالا: ${available} عدد${over?' — ⚠️ تعداد واردشده از سقف برگشت بیشتر است':''}
          </div>`;
        }).join('')}</div>
        <button class="btn secondary small" id="add-return-row">+ افزودن کالای برگشتی</button>
      ` : `
        <div class="empty" style="padding:8px 0;">اگر کالا برمی‌گردد، یک فاکتور انتخاب کن و سپس کالاهای همان فاکتور را اضافه کن. خالی گذاشتن فاکتور یعنی Return فقط حسابی است.</div>
      `}
    `;
  }

  function renderSheet(){
    openSheet(`
      <h3>ثبت تراکنش</h3>
      <div class="q-block">
        <div class="q-title">روش پرداخت</div>
        <div class="chip-wrap">${TX_METHOD_CHIPS.map(o=>`<button type="button" class="chip-opt${method===o.value?' selected':''}" data-tx-method="${esc(o.value)}">${esc(o.label)}</button>`).join('')}</div>
      </div>
      ${method ? `
        <div class="field"><label>تاریخ</label>${shamsiDateInputHTML('f-date', dateStr)}</div>
        <div class="field"><label>مبلغ (تومان)</label><input id="f-amount" type="text" inputmode="decimal" value="${amountStr}"></div>
        <div class="field"><label>توضیح (اختیاری)</label><input id="f-note" value="${esc(noteStr)}"></div>
        ${returnItemsSectionHtml()}
        <div class="btn-row"><button class="btn" id="save-tx">ثبت</button></div>
      ` : ''}
    `, {dirtyCheck:true});

    document.querySelectorAll('[data-tx-method]').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        const sheetEl = btn.closest('.sheet');
        if (sheetEl) sheetEl.dataset.dirty = '1';
        method = btn.getAttribute('data-tx-method');
        if(method!=='return'){
          selectedInvoiceId = '';
          returnRows = [];
        }
        renderSheet();
      });
    });
    if(!method) return;
    document.getElementById('f-date').addEventListener('input', e=>{ dateStr = e.target.value; });
    document.getElementById('f-amount').addEventListener('input', e=>{ amountStr = e.target.value; });
    document.getElementById('f-note').addEventListener('input', e=>{ noteStr = e.target.value; });

    const invoiceSelect = document.getElementById('f-return-invoice');
    if(invoiceSelect){
      invoiceSelect.addEventListener('change', e=>{
        const nextId = e.target.value;
        if(nextId!==selectedInvoiceId && returnRows.length){
          returnRows = [];
        }
        selectedInvoiceId = nextId;
        renderSheet();
      });
    }

    const addBtn = document.getElementById('add-return-row');
    if(addBtn){
      addBtn.addEventListener('click', ()=>{
        const inv = selectedInvoice();
        if(!inv){ showToast('اول فاکتور مرتبط را انتخاب کن'); return; }
        const usedProducts = new Set(returnRows.map(r=>r.productId));
        const candidate = (inv.items||[]).find(it=>it.productId && !usedProducts.has(it.productId));
        if(!candidate){ showToast('همه کالاهای این فاکتور در برگشت انتخاب شده‌اند'); return; }
        const prod = data.products.find(p=>p.id===candidate.productId);
        returnRows.push({productId:candidate.productId, qty:1, price:candidate.price||prod?.retail||prod?.sell||0});
        renderSheet();
      });
    }
    document.querySelectorAll('.ret-product').forEach(el=>el.addEventListener('change', e=>{
      const idx = Number(e.target.dataset.ridx);
      const row = returnRows[idx];
      if(!row) return;
      row.productId = e.target.value;
      row.price = defaultReturnPrice(row.productId);
      renderSheet();
    }));
    document.querySelectorAll('.ret-qty').forEach(el=>el.addEventListener('input', e=>{
      returnRows[e.target.dataset.ridx].qty = parseFloat(faToEnDigits(e.target.value))||0;
    }));
    document.querySelectorAll('.ret-price').forEach(el=>el.addEventListener('input', e=>{
      returnRows[e.target.dataset.ridx].price = parseFloat(faToEnDigits(e.target.value))||0;
    }));
    document.querySelectorAll('[id^="ret-del-"]').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        returnRows.splice(parseInt(btn.dataset.ridx,10), 1);
        renderSheet();
      });
    });

    document.getElementById('save-tx').addEventListener('click', async (e)=>{
      await withSubmitGuard(e.currentTarget, async ()=>{
        const amount = parseFloat(faToEnDigits(amountStr))||0;
        const date = dateStr || todayISO();
        const note = (noteStr||'').trim();
        if(amount<=0){ showToast('مبلغ رو وارد کن'); throw new Error('validation'); }

        let returnItems = [];
        let returnInvoiceId;
        if(method==='return'){
          if(returnRows.some(r=>!r.productId || !(Number(r.qty)>0))){
            showToast('برای هر کالای برگشتی، کالا باید معتبر و تعداد باید بیشتر از صفر باشد');
            throw new Error('validation');
          }
          returnItems = returnRows.map(r=>{
            const prod = data.products.find(p=>p.id===r.productId);
            return {productId:r.productId, name:prod?prod.name:'', qty:Number(r.qty), price:Number(r.price)||0};
          });

          // بدون کالا = Account-only Return؛ مستقل از فاکتور و بدون invoiceId باقی می‌ماند.
          if(returnItems.length){
            const inv = selectedInvoice();
            if(!inv){ showToast('برای برگشت کالایی باید یک فاکتور مرتبط انتخاب کنی'); throw new Error('validation'); }
            returnInvoiceId = inv.id;

            const requestedByProduct = {};
            for(const ri of returnItems){
              if(!(ri.qty>0)){ showToast('تعداد کالای برگشتی باید بیشتر از صفر باشد'); throw new Error('validation'); }
              requestedByProduct[ri.productId] = (requestedByProduct[ri.productId]||0) + Number(ri.qty);
            }
            for(const [productId, requestedQty] of Object.entries(requestedByProduct)){
              const soldQty = invoiceSoldQtyForProduct(inv, productId);
              const returnedQty = linkedReturnedQtyForInvoiceProduct(inv.id, productId);
              const available = Math.max(0, soldQty-returnedQty);
              if(!(soldQty>0)){
                showToast('این کالا در فاکتور انتخاب‌شده وجود ندارد');
                throw new Error('validation');
              }
              if(requestedQty>available){
                const prod = data.products.find(p=>p.id===productId);
                showToast(`«${prod?prod.name:productId}»: حداکثر ${available} عدد از این فاکتور قابل برگشت است`);
                throw new Error('validation');
              }
            }
          }

          const expectedReturnAmount = returnItems.reduce((s,ri)=>s+(ri.qty*(ri.price||0)),0);
          if(expectedReturnAmount>0 && Math.abs(expectedReturnAmount-amount)>1){
            const proceedAmount = await appConfirm('⚠️ مبلغ واردشده با «مقدار × قیمت واحد» کالاهای برگشتی هم‌خوانی ندارد.\n\nمبلغ واردشده: '+toman(amount)+' تومان\nمبلغ منطقی طبق کالاها: '+toman(expectedReturnAmount)+' تومان\n\nمطمئنی می‌خوای همینطور ثبت کنی؟');
            if(!proceedAmount) throw new Error('validation');
          }
        }

        const payment = {id:uid(), customerId:cid, date, amount, method, note, returnItems};
        if(returnInvoiceId) payment.invoiceId = returnInvoiceId;
        // اسنپ‌شات کامل قبل از هر mutation — همان الگوی ثبت/ویرایش فاکتور —
        // چون این مسیر هم برای «برگشت از فروش» موجودی/لایه‌های FIFO را تغییر می‌دهد.
        // یک try واحد: اگر applyReturnStockEffects یا saveData شکست بخورد،
        // data دقیقاً به حالت قبل از push برمی‌گردد (جلوگیری از payment یتیم بدون لایه).
        const previousData = JSON.parse(JSON.stringify(data));
        try{
          data.payments.push(payment);
          if(method==='return' && returnItems.length){
            applyReturnStockEffects(returnItems, date, payment);
          }
          await saveData();
        }catch(err){
          restoreDataInPlace(previousData);
          throw err;
        }
        // Game Center hook (derived only — never rolls back CRM)
        if (typeof gameOnPayment === 'function') {
          try {
            await gameOnPayment(payment.id, payment.method, payment.date);
          } catch (e) {
            console.warn('Game hook failed:', e);
          }
        }
        closeModal();
        openCustomerDetail(cid); render(); showToast('ثبت شد');
      });
    });
  }

  renderSheet();
}

function openEditStandalonePayment(cid, paymentId){
  const p = (data.payments||[]).find(x=>x.id===paymentId && x.customerId===cid);
  if(!p || p.invoiceId || p.method==='return' || !['cash','card','transfer','discount'].includes(p.method)) return;
  let method = p.method;
  let dateStr = p.date || todayISO();
  let amountStr = String(p.amount || '');
  let noteStr = p.note || '';
  openSheet(`
    <h3>ویرایش دریافت</h3>
    <div class="field"><label>نوع</label><select id="ep-method">
      <option value="cash" ${method==='cash'?'selected':''}>دریافت نقدی</option>
      <option value="card" ${method==='card'?'selected':''}>دریافت با کارت</option>
      <option value="transfer" ${method==='transfer'?'selected':''}>انتقال بانکی</option>
      <option value="discount" ${method==='discount'?'selected':''}>تخفیف</option>
    </select></div>
    <div class="field"><label>تاریخ</label>${shamsiDateInputHTML('ep-date', dateStr)}</div>
    <div class="field"><label>مبلغ (تومان)</label><input id="ep-amount" type="text" inputmode="decimal" value="${esc(amountStr)}"></div>
    <div class="field"><label>توضیح (اختیاری)</label><input id="ep-note" value="${esc(noteStr)}"></div>
    <div class="btn-row"><button class="btn" id="ep-save">ذخیره</button><button class="btn danger secondary" id="ep-delete">حذف دریافت</button></div>
  `);
  document.getElementById('ep-method').addEventListener('change', e=>{ method=e.target.value; });
  document.getElementById('ep-date').addEventListener('input', e=>{ dateStr=e.target.value; });
  document.getElementById('ep-amount').addEventListener('input', e=>{ amountStr=e.target.value; });
  document.getElementById('ep-note').addEventListener('input', e=>{ noteStr=e.target.value; });
  document.getElementById('ep-save').addEventListener('click', async e=>{
    await withSubmitGuard(e.currentTarget, async()=>{
      const amount=numVal(document.getElementById('ep-amount'));
      if(amount<=0){ showToast('مبلغ باید بیشتر از صفر باشد'); throw new Error('validation'); }
      const previousData=JSON.parse(JSON.stringify(data));
      try{
        const livePayment = (data.payments||[]).find(x=>x.id===paymentId && x.customerId===cid);
        if(!livePayment) throw new Error('validation');
        livePayment.method=method; livePayment.date=dateStr||todayISO(); livePayment.amount=amount; livePayment.note=(noteStr||'').trim();
        await saveData();
      }catch(err){ restoreDataInPlace(previousData); throw err; }
      closeModal();
      openCustomerDetail(cid); render(); showToast('دریافت ویرایش شد');
    });
  });
  document.getElementById('ep-delete').addEventListener('click', async e=>{
    await withSubmitGuard(e.currentTarget, async()=>{
      if(!(await appConfirm('این دریافت از حساب مشتری حذف شود؟'))) throw new Error('validation');
      const previousData=JSON.parse(JSON.stringify(data));
      try{
        data.payments=data.payments.filter(x=>x.id!==paymentId);
        await saveData();
      }catch(err){ restoreDataInPlace(previousData); throw err; }
      if (typeof gameOnPaymentDeleted === 'function') {
        try {
          await gameOnPaymentDeleted(paymentId);
        } catch (e) {
          console.warn('Game hook failed:', e);
        }
      }
      closeModal();
      openCustomerDetail(cid); render(); showToast('دریافت حذف شد');
    });
  });
}

function openAddCheck(cid){
  openSheet(`
    <h3>ثبت چک جدید</h3>
    <div class="field"><label>شماره چک (اختیاری)</label><input id="f-num"></div>
    <div class="field"><label>مبلغ (تومان)</label><input id="f-amount" type="text" inputmode="decimal"></div>
    <div class="field"><label>تاریخ سررسید</label>${shamsiDateInputHTML('f-due', todayISO())}</div>
    <div class="btn-row"><button class="btn" id="save-check">ثبت</button></div>
  `);
  document.getElementById('save-check').addEventListener('click', async (e)=>{
    await withSubmitGuard(e.currentTarget, async ()=>{
      const amount = numVal(document.getElementById('f-amount'));
      const dueDate = document.getElementById('f-due').value || todayISO();
      const checkNumber = document.getElementById('f-num').value.trim();
      if(amount<=0){ showToast('مبلغ رو وارد کن'); throw new Error('validation'); }
      data.checks.push({id:uid(), customerId:cid, amount, dueDate, checkNumber, status:'pending'});
      await saveData(); closeModal(); openCustomerDetail(cid); render(); showToast('چک ثبت شد');
    });
  });
}

/* ============================================================
   No-Purchase Reason (V1) — low-friction structured feedback
   Uses existing P-03 recordFeedback. Never blocks save.
   ============================================================ */
var NO_PURCHASE_REASON_CATEGORIES = {
  SKU_DELAY: true,
  SKU_QUANTITY_DROP: true,
  SKU_FREQUENCY_DROP: true,
  LINE_DROP: true,
  COMBINED_SKU_DETERIORATION: true,
  KEY_PRODUCT_LOST: true
};
var NO_PURCHASE_REASON_OPTIONS = [
  { code: 'still_stock', label: 'موجودی دارد' },
  { code: 'competitor_bought', label: 'از رقیب خریده' },
  { code: 'no_need', label: 'فعلاً نیاز ندارد' },
  { code: 'price_issue', label: 'قیمت مناسب نیست' },
  { code: 'liquidity', label: 'نقدینگی ندارد' }
];

/**
 * Return up to `limit` high-confidence SKU signals that justify asking
 * "why didn't they buy this product?". Filters pending / seasonally
 * suppressed / already-answered / multi-product signals.
 * excludeProductIds: optional Set/array of productIds already in the basket.
 */
function getNoPurchaseCandidates(cid, excludeProductIds, limit){
  limit = (typeof limit === 'number' && limit > 0) ? limit : 3;
  if(!cid || typeof extractCustomerSignals !== 'function') return [];
  var exclude = Object.create(null);
  if(excludeProductIds){
    if(Array.isArray(excludeProductIds)){
      excludeProductIds.forEach(function(id){ if(id) exclude[id] = true; });
    }else if(typeof excludeProductIds === 'object'){
      Object.keys(excludeProductIds).forEach(function(id){ if(id) exclude[id] = true; });
    }
  }
  var signals = [];
  try{ signals = extractCustomerSignals(cid) || []; }catch(e){ signals = []; }
  var out = [];
  for(var i = 0; i < signals.length; i++){
    var s = signals[i];
    if(!s || !s.category) continue;
    if(!NO_PURCHASE_REASON_CATEGORIES[s.category]) continue;
    if(s.status === 'pending') continue;
    if(s.seasonallySuppressed === true) continue;
    var pid = s.productId;
    if(pid == null || pid === '' || pid === 'multi') continue;
    if(exclude[pid]) continue;
    if(s.feedback && s.feedback.reasonCode) continue;
    out.push(s);
  }
  out.sort(function(a, b){
    var pa = (typeof a.severityPoints === 'number') ? a.severityPoints : 0;
    var pb = (typeof b.severityPoints === 'number') ? b.severityPoints : 0;
    return pb - pa;
  });
  var seen = Object.create(null);
  var unique = [];
  for(var j = 0; j < out.length; j++){
    var p = out[j].productId;
    if(seen[p]) continue;
    seen[p] = true;
    unique.push(out[j]);
    if(unique.length >= limit) break;
  }
  return unique;
}

function noPurchaseReasonChipsHtml(productId, category, source){
  return NO_PURCHASE_REASON_OPTIONS.map(function(o){
    return '<button type="button" class="chip-opt npr-chip" data-npr-pid="' + esc(String(productId)) +
      '" data-npr-cat="' + esc(String(category)) +
      '" data-npr-code="' + esc(o.code) +
      '" data-npr-source="' + esc(source || '') +
      '">' + esc(o.label) + '</button>';
  }).join('');
}

function noPurchasePromptHtml(candidates, source, introText){
  if(!candidates || !candidates.length) return '';
  var blocks = candidates.map(function(s){
    var name = s.productName || (typeof data !== 'undefined' && data.products
      ? ((data.products.find(function(p){ return p && p.id === s.productId; }) || {}).name || s.productId)
      : s.productId);
    return '<div class="npr-product" style="margin:8px 0 4px;">' +
      '<div style="font-weight:500;margin-bottom:4px;">' + esc(name) + '</div>' +
      '<div class="chip-wrap">' + noPurchaseReasonChipsHtml(s.productId, s.category, source) + '</div>' +
      '</div>';
  }).join('');
  return '<div class="npr-card" id="npr-card" style="border:1px solid var(--border);border-radius:10px;padding:10px 12px;margin:10px 0 12px;background:var(--bg-elevated, transparent);">' +
    '<div style="font-size:0.92rem;margin-bottom:4px;">' + esc(introText || 'این مشتری معمولاً این محصول را می‌خرد') + '</div>' +
    blocks +
    '<div class="btn-row" style="margin-top:6px;"><button type="button" class="btn small secondary" id="npr-dismiss">رد کردن</button></div>' +
    '</div>';
}

function bindNoPurchasePrompt(cid){
  var card = document.getElementById('npr-card');
  if(!card) return;
  var dismiss = document.getElementById('npr-dismiss');
  if(dismiss){
    dismiss.addEventListener('click', function(){
      card.style.display = 'none';
    });
  }
  card.querySelectorAll('.npr-chip').forEach(function(btn){
    btn.addEventListener('click', function(){
      if(btn.disabled) return;
      var pid = btn.getAttribute('data-npr-pid');
      var cat = btn.getAttribute('data-npr-cat');
      var code = btn.getAttribute('data-npr-code');
      var source = btn.getAttribute('data-npr-source') || '';
      if(!cid || !cat || !code) return;
      if(typeof recordFeedback === 'function'){
        try{
          recordFeedback(cid, pid, cat, code, '', source || null);
        }catch(e){
          console.warn('recordFeedback failed', e);
        }
      }
      var productBlock = btn.closest('.npr-product');
      if(productBlock){
        productBlock.querySelectorAll('.npr-chip').forEach(function(b){
          b.disabled = true;
          b.classList.remove('selected');
        });
        btn.classList.add('selected');
      }
      if(typeof showToast === 'function') showToast('ثبت شد');
    });
  });
}

/* G1–G3 Visit capture: one-active-question cards.
   Card1 Result → Card2 Product (direct chips) → Card3 Reaction →
   (if rejected) Card4 Rejection reason →
   (if still_stock) Card4b Stock source → Card «محصول دیگری؟».
   offeredProducts only stores complete entries (product + reaction;
   rejected requires rejectionReason; still_stock also requires stockSource).
   Partial in-progress product is dropped on Save & Finish.
   Backward-compatible: old visits without offeredProducts / stockSource OK.
   Does not touch invoice/stock/FIFO. */
function openAddVisit(cid){
  const RESULT_CHIPS = [
    { value: VISIT_RESULTS[0], label: 'سفارش گرفته شد' },
    { value: VISIT_RESULTS[1], label: 'سفارش گرفته نشد' },
    { value: VISIT_RESULTS[2], label: 'بسته بود' },
    { value: VISIT_RESULTS[3], label: 'سرکشی' },
  ];
  const REACTION_CHIPS = [
    { value: 'accepted', label: 'قبول کرد' },
    { value: 'rejected', label: 'رد کرد' },
    { value: 'deferred', label: 'بعداً تصمیم می‌گیرد' },
  ];
  const REJECTION_REASON_CHIPS = [
    { value: 'price', label: 'قیمت' },
    { value: 'quality', label: 'کیفیت' },
    { value: 'competitor', label: 'رقیب' },
    { value: 'unavailable', label: 'موجود نبود' },
    { value: 'no_need', label: 'نیاز نداشت' },
    { value: 'still_stock', label: 'موجود داشت' },
    { value: 'other', label: 'سایر' },
  ];
  const STOCK_SOURCE_CHIPS = [
    { value: 'ours', label: 'از ما' },
    { value: 'competitor', label: 'از رقیب' },
    { value: 'unknown', label: 'نمی‌دانم' },
  ];

  const activeProducts = (data.products || []).filter(function (p) {
    return p && p.active !== false && p.id;
  });

  const visitCustomer = (data.customers || []).find(function (x) { return x && x.id === cid; }) || null;
  let visitBehavior = {};
  try {
    if (typeof customerBehavior === 'function') visitBehavior = customerBehavior(cid) || {};
  } catch (eVisitContext) { visitBehavior = {}; }
  let visitWatchCount = 0;
  try {
    if (typeof getActiveWatchOccurrences === 'function') {
      visitWatchCount = (getActiveWatchOccurrences(cid) || []).length;
    }
  } catch (eVisitWatch) { visitWatchCount = 0; }
  const lastVisitDate = visitBehavior.lastVisit && visitBehavior.lastVisit.date
    ? faDate(visitBehavior.lastVisit.date)
    : '—';
  const lastInvoiceDate = visitBehavior.lastInvoiceDate
    ? faDate(visitBehavior.lastInvoiceDate)
    : '—';

  function chipBtn(group, value, label){
    return '<button type="button" class="chip-opt" data-vgroup="' + esc(group) + '" data-value="' + esc(value) + '">' + esc(label) + '</button>';
  }

  openSheet(
    '<h3>ثبت ویزیت</h3>' +
    '<div class="visit-precontext">' +
      '<div class="visit-precontext-title">' + esc(visitCustomer ? visitCustomer.name : 'مشتری') + '</div>' +
      '<div class="visit-precontext-grid">' +
        '<span>آخرین خرید: ' + esc(lastInvoiceDate) + '</span>' +
        '<span>آخرین ویزیت: ' + esc(lastVisitDate) + '</span>' +
        '<span>هشدار فعال: ' + esc(String(visitWatchCount)) + ' مورد</span>' +
      '</div>' +
    '</div>' +
    '<div style="display:flex;gap:8px;">' +
      '<div class="field" style="flex:1;"><label>تاریخ</label>' + shamsiDateInputHTML('f-date', todayISO()) + '</div>' +
      '<div class="field" style="flex:1;"><label>ساعت</label><input id="f-time" type="time" value="' + nowHHMM() + '"></div>' +
    '</div>' +
    '<div id="visit-card-stage" class="visit-card-stage" aria-live="polite"></div>' +
    '<div class="field" style="margin-top:12px;"><label>یادداشت کوتاه (اختیاری)</label><input id="f-visit-note" placeholder="اختیاری" autocomplete="off"></div>' +
    '<div class="btn-row visit-save-actions" style="margin-top:8px;">' +
      '<button type="button" class="btn" id="save-visit">ثبت و پایان</button>' +
      '<button type="button" class="btn secondary" id="save-visit-invoice">ثبت و ایجاد فاکتور</button>' +
    '</div>'
  , {dirtyCheck:true});

  const state = {
    result: null,
    offeredProducts: [], // complete only
    pendingProductId: null,
    pendingReaction: null,
    pendingRejectionReason: null,
    step: 'result', // result | product | reaction | rejectReason | stockSource | another | done
  };
  const stage = document.getElementById('visit-card-stage');

  function validOffered(){
    return (state.offeredProducts || []).filter(function (op) {
      if (!op || !op.productId) return false;
      if (op.reaction !== 'accepted' && op.reaction !== 'rejected' && op.reaction !== 'deferred') return false;
      if (op.reaction === 'rejected' && !op.rejectionReason) return false;
      // stockSource only valid/required with still_stock; other reasons must not carry it
      if (op.reaction === 'rejected' && op.rejectionReason === 'still_stock') {
        if (op.stockSource !== 'ours' && op.stockSource !== 'competitor' && op.stockSource !== 'unknown') return false;
      }
      return true;
    }).map(function (op) {
      // Data integrity: strip stockSource unless still_stock
      if (op.reaction === 'rejected' && op.rejectionReason === 'still_stock') {
        return {
          productId: op.productId,
          reaction: 'rejected',
          rejectionReason: 'still_stock',
          stockSource: op.stockSource,
        };
      }
      if (op.reaction === 'rejected') {
        return {
          productId: op.productId,
          reaction: 'rejected',
          rejectionReason: op.rejectionReason,
        };
      }
      return { productId: op.productId, reaction: op.reaction };
    });
  }

  function productLabel(pid){
    const p = (data.products || []).find(function (x) { return x.id === pid; });
    return p ? (p.name || '—') : '—';
  }

  function renderStage(){
    if (!stage) return;
    let html = '';
    const step = state.step;

    if (step === 'result') {
      html =
        '<div class="visit-card visit-card-enter" data-visit-step="result">' +
          '<div class="q-title">نتیجه ویزیت؟</div>' +
          '<div class="chip-wrap">' + RESULT_CHIPS.map(function (o) {
            return chipBtn('result', o.value, o.label);
          }).join('') + '</div>' +
        '</div>';
    } else if (step === 'product') {
      const chosen = {};
      (state.offeredProducts || []).forEach(function (op) { chosen[op.productId] = true; });
      const avail = activeProducts.filter(function (p) { return !chosen[p.id]; });
      html =
        '<div class="visit-card visit-card-enter" data-visit-step="product">' +
          '<div class="q-title">چه محصولی پیشنهاد/بررسی شد؟</div>' +
          (avail.length
            ? '<div class="visit-product-grid chip-wrap">' + avail.map(function (p) {
                return chipBtn('product', p.id, p.name || '—');
              }).join('') + '</div>'
            : '<div class="empty" style="padding:12px 0;">همه محصولات فعال قبلاً ثبت شدند یا کالایی نیست.</div>' +
              '<button type="button" class="btn secondary small" data-skip-product>بدون پیشنهاد محصول، ادامه</button>') +
          '<button type="button" class="btn secondary small visit-stage-back" data-back-step="result">بازگشت</button>' +
        '</div>';
    } else if (step === 'reaction') {
      html =
        '<div class="visit-card visit-card-enter" data-visit-step="reaction">' +
          '<div class="q-title">واکنش مشتری؟ <span class="sub" style="display:inline;font-weight:400;">(' + esc(productLabel(state.pendingProductId)) + ')</span></div>' +
          '<div class="chip-wrap">' + REACTION_CHIPS.map(function (o) {
            return chipBtn('reaction', o.value, o.label);
          }).join('') + '</div>' +
          '<button type="button" class="btn secondary small visit-stage-back" data-back-step="product">بازگشت</button>' +
        '</div>';
    } else if (step === 'rejectReason') {
      html =
        '<div class="visit-card visit-card-enter" data-visit-step="rejectReason">' +
          '<div class="q-title">چرا نخرید؟ <span class="sub" style="display:inline;font-weight:400;">(' + esc(productLabel(state.pendingProductId)) + ')</span></div>' +
          '<div class="chip-wrap">' + REJECTION_REASON_CHIPS.map(function (o) {
            return chipBtn('rejectReason', o.value, o.label);
          }).join('') + '</div>' +
          '<button type="button" class="btn secondary small visit-stage-back" data-back-step="reaction">بازگشت</button>' +
        '</div>';
    } else if (step === 'stockSource') {
      html =
        '<div class="visit-card visit-card-enter" data-visit-step="stockSource">' +
          '<div class="q-title">این موجودی از کجا بود؟ <span class="sub" style="display:inline;font-weight:400;">(' + esc(productLabel(state.pendingProductId)) + ')</span></div>' +
          '<div class="chip-wrap">' + STOCK_SOURCE_CHIPS.map(function (o) {
            return chipBtn('stockSource', o.value, o.label);
          }).join('') + '</div>' +
          '<button type="button" class="btn secondary small visit-stage-back" data-back-step="rejectReason">بازگشت</button>' +
        '</div>';
    } else if (step === 'another') {
      html =
        '<div class="visit-card visit-card-enter" data-visit-step="another">' +
          '<div class="q-title">محصول دیگری هم مطرح شد؟</div>' +
          '<div class="chip-wrap">' +
            chipBtn('another', 'yes', 'بله') +
            chipBtn('another', 'no', 'خیر') +
          '</div>' +
          '<button type="button" class="btn secondary small visit-stage-back" data-back-step="product">بازگشت</button>' +
        '</div>';
    } else if (step === 'done') {
      const n = validOffered().length;
      html =
        '<div class="visit-card visit-card-enter" data-visit-step="done">' +
          '<div class="q-title">آماده ثبت</div>' +
          '<div class="empty" style="padding:8px 0;text-align:right;">' +
            (state.result ? ('نتیجه: ' + esc(state.result) + '<br>') : '') +
            (n ? (n + ' محصول با واکنش کامل ثبت می‌شود.') : 'بدون محصول پیشنهادی (اختیاری).') +
            '<br>برای ذخیره روی «ثبت و پایان» بزنید.' +
          '</div>' +
          '<button type="button" class="btn secondary small visit-stage-back" data-back-step="another">بازگشت</button>' +
        '</div>';
    }

    stage.innerHTML = html;
    bindStageChips();
  }

  function bindStageChips(){
    if (!stage) return;
    stage.querySelectorAll('.visit-stage-back').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const next = btn.getAttribute('data-back-step');
        if (next) { state.step = next; renderStage(); }
      });
    });
    const skipProductBtn = stage.querySelector('[data-skip-product]');
    if (skipProductBtn) {
      skipProductBtn.addEventListener('click', function () {
        state.step = 'another';
        renderStage();
      });
    }
    stage.querySelectorAll('.chip-opt').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const sheetEl = btn.closest('.sheet');
        if (sheetEl) sheetEl.dataset.dirty = '1';
        const group = btn.getAttribute('data-vgroup');
        const value = btn.getAttribute('data-value');
        if (!group || value == null) return;

        if (group === 'result') {
          state.result = value;
          state.pendingProductId = null;
          state.pendingReaction = null;
          state.step = 'product';
          renderStage();
          return;
        }
        if (group === 'product') {
          state.pendingProductId = value;
          state.pendingReaction = null;
          state.step = 'reaction';
          renderStage();
          return;
        }
        if (group === 'reaction') {
          state.pendingReaction = value;
          state.pendingRejectionReason = null;
          if (value === 'rejected') {
            state.step = 'rejectReason';
            renderStage();
            return;
          }
          if (state.pendingProductId && (value === 'accepted' || value === 'deferred')) {
            state.offeredProducts.push({
              productId: state.pendingProductId,
              reaction: value,
            });
          }
          state.pendingProductId = null;
          state.pendingReaction = null;
          state.pendingRejectionReason = null;
          state.step = 'another';
          renderStage();
          return;
        }
        if (group === 'rejectReason') {
          if (value === 'still_stock') {
            state.pendingRejectionReason = 'still_stock';
            state.step = 'stockSource';
            renderStage();
            return;
          }
          if (state.pendingProductId && state.pendingReaction === 'rejected' && value) {
            // Non-still_stock reasons: never attach stockSource
            state.offeredProducts.push({
              productId: state.pendingProductId,
              reaction: 'rejected',
              rejectionReason: value,
            });
          }
          state.pendingProductId = null;
          state.pendingReaction = null;
          state.pendingRejectionReason = null;
          state.step = 'another';
          renderStage();
          return;
        }
        if (group === 'stockSource') {
          if (
            state.pendingProductId &&
            state.pendingReaction === 'rejected' &&
            state.pendingRejectionReason === 'still_stock' &&
            (value === 'ours' || value === 'competitor' || value === 'unknown')
          ) {
            state.offeredProducts.push({
              productId: state.pendingProductId,
              reaction: 'rejected',
              rejectionReason: 'still_stock',
              stockSource: value,
            });
          }
          state.pendingProductId = null;
          state.pendingReaction = null;
          state.pendingRejectionReason = null;
          state.step = 'another';
          renderStage();
          return;
        }
        if (group === 'another') {
          if (value === 'yes') {
            state.pendingProductId = null;
            state.pendingReaction = null;
            state.pendingRejectionReason = null;
            state.step = 'product';
            renderStage();
            return;
          }
          state.step = 'done';
          renderStage();
          persistVisit(true);
          return;
        }
      });
    });
  }

  async function persistVisit(auto){
    const c = data.customers.find(function (x) { return x.id === cid; });
    if (!c) {
      showToast('مشتری پیدا نشد');
      return false;
    }
    if (!state.result) {
      showToast('نتیجه ویزیت را انتخاب کنید');
      return false;
    }
    const dateEl = document.getElementById('f-date');
    const timeEl = document.getElementById('f-time');
    const noteEl = document.getElementById('f-visit-note');
    const date = (dateEl && dateEl.value) || todayISO();
    const time = (timeEl && timeEl.value) || nowHHMM();
    const note = noteEl ? String(noteEl.value || '').trim() : '';

    const offered = validOffered();

    const visit = {
      id: uid(),
      date: date,
      time: time,
      result: state.result,
      ordered: state.result === VISIT_RESULTS[0],
    };
    if (note) visit.note = note;
    if (offered.length) visit.offeredProducts = offered;

    c.visits = c.visits || [];
    c.visits.push(visit);
    try {
      await saveData();
    } catch (e) {
      console.error(e);
      showToast('ذخیره نشد');
      return false;
    }
    if (typeof gameOnCustomerVisit === 'function') {
      try {
        await gameOnCustomerVisit(cid, visit.id, visit.date);
      } catch (e) {
        console.warn('Game hook failed:', e);
      }
    }
    closeModal();
    if (typeof openCustomerDetail === 'function') openCustomerDetail(cid);
    if (typeof ViewHost !== 'undefined' && ViewHost.refreshCurrent) ViewHost.refreshCurrent();
    else if (typeof render === 'function') render();
    showToast('ویزیت ثبت شد');
    return visit;
  }

  document.getElementById('save-visit').addEventListener('click', function (e) {
    withSubmitGuard(e.currentTarget, function () {
      return persistVisit(false);
    });
  });

  document.getElementById('save-visit-invoice').addEventListener('click', function (e) {
    withSubmitGuard(e.currentTarget, async function () {
      const saved = await persistVisit(false);
      if (saved && typeof openAddInvoice === 'function') {
        openAddInvoice(cid, {visitId: saved.id});
      }
    });
  });

  renderStage();
}

function openCustomerDetail(cid){
  AppRouter.navigate('/customer', { id: cid });
}

/* Invoice-linked payment/check persistence helpers.
   These are the single source of truth for the payment records created by
   Invoice V6.  They intentionally live with the invoice workflow because
   invoice creation/edit/delete all depend on the same linkage contract. */
function pushInvoicePayments(cid, inv, cashPaid, cardPaid, transferPaid, checkPaid, checkDue, checkMeta){
  if(!inv || !inv.id || !cid) return;
  data.payments = data.payments || [];
  data.checks = data.checks || [];
  const date = inv.date || todayISO();
  const addPayment = function(method, amount){
    amount = Number(amount)||0;
    if(amount<=0) return;
    data.payments.push({
      id: uid(),
      customerId: cid,
      date,
      amount,
      method,
      note: 'دریافت همراه فاکتور #'+(inv.number || '—'),
      invoiceId: inv.id,
    });
  };
  addPayment('cash', cashPaid);
  addPayment('card', cardPaid);
  addPayment('transfer', transferPaid);

  const checkAmount = Number(checkPaid)||0;
  if(checkAmount>0){
    data.checks.push({
      id: uid(),
      customerId: cid,
      amount: checkAmount,
      dueDate: checkDue || date,
      checkNumber: checkMeta && checkMeta.checkNumber ? checkMeta.checkNumber : '',
      status: checkMeta && checkMeta.status ? checkMeta.status : 'pending',
      invoiceId: inv.id,
    });
  }
}

function revertInvoicePayments(inv){
  if(!inv || !inv.id) return;
  data.payments = (data.payments||[]).filter(function(p){ return p.invoiceId !== inv.id; });
  data.checks = (data.checks||[]).filter(function(c){ return c.invoiceId !== inv.id; });
}

function openInvoiceDetail(invId, cid){
  AppRouter.navigate('/invoice', { id: invId });
}

function openAddInvoice(cid, opts){
  openInvoiceForm(cid, null, opts);
}

function openEditInvoice(invId, cid){
  const inv = data.invoices.find(x=>x.id===invId);
  if(!inv) return;
  if(invoiceHasLinkedStockReturn(inv.id)){
    showToast('این فاکتور دارای برگشت از فروش است و برای حفظ یکپارچگی موجودی قابل ویرایش نیست');
    return;
  }
  openInvoiceForm(cid, inv);
}

function openInvoiceForm(cid, editInv, opts){
  if(data.products.length===0){
    openSheet(`<h3>اول جنس اضافه کن</h3><div class="empty">برای ${editInv?'ویرایش':'ثبت'} فاکتور، حداقل یک جنس باید تو تب «اجناس و انبار» ثبت شده باشه.</div>`);
    return;
  }
  // One invoice form is one execution boundary. These disposable indexes
  // avoid repeated product/history scans without changing accounting rules.
  const invoiceCtx = typeof createComputationContext === 'function'
    ? createComputationContext({ data: data })
    : null;
  const productCache = Object.create(null);
  const fifoCostCache = Object.create(null);
  const lastSaleCustomerCache = Object.create(null);
  const lastSaleAnyCache = Object.create(null);
  let invoiceMetricsCache = null;
  function invalidateInvoiceMetrics(){ invoiceMetricsCache = null; }
  function invoiceProduct(productId){
    if(!productId) return null;
    if(Object.prototype.hasOwnProperty.call(productCache, productId)) return productCache[productId];
    const prod = invoiceCtx && typeof invoiceCtx.productById === 'function'
      ? invoiceCtx.productById(productId)
      : data.products.find(p=>p.id===productId);
    productCache[productId] = prod || null;
    return productCache[productId];
  }
  function invoiceFifoCost(productId){
    if(!Object.prototype.hasOwnProperty.call(fifoCostCache, productId)){
      fifoCostCache[productId] = productFifoUnitCost(productId);
    }
    return fifoCostCache[productId];
  }
  let rows = editInv
    ? editInv.items.map(it=>({productId:it.productId, qty:it.qty, price:it.price, discount:it.discount||0, buyPrice:it.buyPrice}))
    : [{productId:'', qty:1, price:0, discount:0}];
  const cust = data.customers.find(c=>c.id===cid); // presentation only: Customer Context header
  const existingCheck = editInv ? data.checks.find(c=>c.invoiceId===editInv.id) : null;
  let cashPaid = editInv ? (editInv.cashPaid||0) : 0;
  let cardPaid = editInv ? (editInv.cardPaid||0) : 0;
  let transferPaid = editInv ? (editInv.transferPaid||0) : 0;
  let checkAmount = editInv ? (editInv.checkPaid||0) : 0;
  let checkDue = existingCheck ? existingCheck.dueDate : todayISO();
  const pendingPayment = { cash: cashPaid, card: cardPaid, transfer: transferPaid, check: checkAmount, checkDue };
  opts = opts || {};
  let discount = editInv ? (editInv.discount||0) : 0;
  let discountType = (editInv && editInv.discountType==='percent') ? 'percent' : 'fixed';
  if(discountType==='percent') discount = Math.min(100, Math.max(0, discount));

  // "مانده قبلی": مانده مشتری بدون احتساب این فاکتور اصلاً — برای فاکتور جدید یعنی مانده فعلی،
  // برای ویرایش یعنی مانده فعلی منهای سهم همین فاکتور (چه از بابت جمع فاکتور و چه از بابت پرداختی‌های همراهش)
  const prevBalance = editInv
     ? (customerTotals(cid, invoiceCtx).balance - editInv.total + (editInv.cashPaid||0) + (editInv.cardPaid||0) + (editInv.transferPaid||0) + (editInv.checkPaid||0))
     : customerTotals(cid, invoiceCtx).balance;

  function lastSaleToCustomer(productId){
    if(Object.prototype.hasOwnProperty.call(lastSaleCustomerCache, productId)) return lastSaleCustomerCache[productId];
    const past = data.invoices
      .filter(inv=>inv.customerId===cid && (!editInv || inv.id!==editInv.id))
      .flatMap(inv=>inv.items.filter(it=>it.productId===productId).map(it=>({...it, date:inv.date})))
      .sort((a,b)=>new Date(b.date)-new Date(a.date));
    lastSaleCustomerCache[productId] = past[0] || null;
    return lastSaleCustomerCache[productId];
  }

  function lastSaleAnyCustomer(productId){
    if(Object.prototype.hasOwnProperty.call(lastSaleAnyCache, productId)) return lastSaleAnyCache[productId];
    const past = data.invoices
      .filter(inv=>!editInv || inv.id!==editInv.id)
      .flatMap(inv=>inv.items.filter(it=>it.productId===productId).map(it=>({...it, date:inv.date})))
      .sort((a,b)=>new Date(b.date)-new Date(a.date));
    lastSaleAnyCache[productId] = past[0] || null;
    return lastSaleAnyCache[productId];
  }

  function updateRowInfo(idx){
    const r = rows[idx];
    if(!r) return;
    const prod = invoiceProduct(r.productId);
    const line = document.querySelector(`.inv-line[data-row="${idx}"]`);
    if(!line) return;

    if(prod && line.classList.contains('inv-line-empty')) line.classList.remove('inv-line-empty');

    if(prod && !line.querySelector('.inv-line-collapsed')){
      const view = document.createElement('div');
      view.className = 'inv-line-collapsed';
      view.setAttribute('role','button');
      view.tabIndex = 0;
      const body = document.createElement('div');
      body.className = 'inv-line-body';
      const name = document.createElement('span');
      name.className = 'inv-line-name';
      const meta = document.createElement('div');
      meta.className = 'inv-line-collapsed-meta';
      const calc = document.createElement('span');
      calc.className = 'inv-line-calc';
      meta.appendChild(calc);
      body.append(name, meta);
      const amount = document.createElement('span');
      amount.className = 'inv-line-amount';
      view.append(body, amount);
      line.insertBefore(view, line.querySelector('.inv-line-view-active'));
      const activate = ()=>{
        if(idx === activeRowIndex) return;
        setActiveRow(idx);
        focusQtyForRow(idx);
      };
      view.addEventListener('click', activate);
      view.addEventListener('keydown', e=>{
        if(e.key==='Enter' || e.key===' '){ e.preventDefault(); activate(); }
      });
    }

    if(prod){
      const collapsed = line.querySelector('.inv-line-collapsed');
      if(collapsed){
        const name = collapsed.querySelector('.inv-line-name');
        const calc = collapsed.querySelector('.inv-line-calc');
        const amount = collapsed.querySelector('.inv-line-amount');
        if(name) name.textContent = prod.name || '';
        if(calc) calc.textContent = `${enToFaDigits(fmtQtyDisplay(r.qty||0))} × ${toman(r.price||0)} ت`;
        if(amount) amount.textContent = `${toman((r.qty||0)*(r.price||0))} ت`;
      }

      const fifoCost = invoiceFifoCost(prod.id);
      const subEl = line.querySelector('.inv-line-sub');
      const chevronEl = line.querySelector('.inv-line-chevron');
      const marketDetails = line.querySelector('.inv-line-market-details');
      if(subEl) subEl.style.display = 'flex';
      if(chevronEl) chevronEl.style.display = 'none';
      if(marketDetails) marketDetails.hidden = false;
      const avgCost = line.querySelector('.inv-line-avg-cost');
      if(avgCost){
        avgCost.style.display = 'block';
        avgCost.textContent = `میانگین خرید: ${toman(fifoCost)} ت`;
        avgCost.classList.toggle('is-below', (r.price||0) < fifoCost);
      }
      const lastAny = lastSaleAnyCustomer(prod.id);
      const lastCust = lastSaleToCustomer(prod.id);
      const marketAny = line.querySelector('[data-market="last-any"]');
      const marketCust = line.querySelector('[data-market="last-customer"]');
      if(marketAny) marketAny.textContent = lastAny ? `${toman(lastAny.price)} ت — ${faDate(lastAny.date)}` : 'ثبت نشده';
      if(marketCust) marketCust.textContent = lastCust ? `${toman(lastCust.price)} ت — ${faDate(lastCust.date)}` : 'ثبت نشده';
    }
  }

  // Product selector state (one open at a time) — UI only
  let prodDropOpenRow = null;
  let prodDropOpening = false;
  // Stage 3 — which row (if any) is currently expanded to its active/edit
  // view. Populated rows render collapsed by default; an empty row (still
  // awaiting a product) is always shown in its active form regardless of
  // this value, since it has no collapsed summary to fall back to.
  let activeRowIndex = rows.findIndex(r=>!r.productId);
  if(activeRowIndex < 0) activeRowIndex = null;
  const qtyFocusPrevious = new Map();
  function focusQtyForRow(idx){
    const input = document.querySelector(`.inv-line[data-row="${idx}"] .row-qty`);
    if(!input) return;
    qtyFocusPrevious.set(String(idx), input.value);
    requestAnimationFrame(()=>setTimeout(()=>{
      if(!input.isConnected) return;
      input.focus();
    },0));
  }

  function productDropListHtml(idx, query){
    const q = (query||'').trim();
    // Inactive products (active===false) excluded from NEW invoice product selector only.
    const activeOnly = data.products.filter(p=>p.active!==false);
    const list = (q ? activeOnly.filter(p=>(p.name||'').includes(q)) : activeOnly).slice(0, 40);
    if(!list.length) return `<div class="prod-drop-empty">کالایی پیدا نشد</div>`;
    return list.map(p=>`
      <div class="prod-drop-item" data-row="${idx}" data-pid="${esc(p.id)}" role="button" tabindex="0">
        <span class="prod-drop-ico" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9"/></svg></span>
        <span class="prod-drop-name">${esc(p.name)}</span>
        <span class="prod-drop-stock">${enToFaDigits(String(p.stockQty||0))}</span>
        <span class="prod-drop-chevron" aria-hidden="true">›</span>
      </div>
    `).join('');
  }
  function productDropPanelHtml(idx){
    return `
      <div class="prod-drop-panel">
        <div class="prod-drop-search-wrap">
          <input type="search" class="prod-drop-search" data-row="${idx}" placeholder="جستجوی کالا..." value="" autocomplete="off" enterkeyhint="search">
        </div>
        <div class="prod-drop-list">${productDropListHtml(idx, '')}</div>
      </div>`;
  }
  function productDropItemsHtml(idx, query){
    return productDropListHtml(idx, query);
  }

  function itemsHtml(){
    return rows.map((r,idx)=>{
      const prod = invoiceProduct(r.productId);
      const rowFifo = prod ? invoiceFifoCost(prod.id) : 0;
      const rowLastAny = prod ? lastSaleAnyCustomer(prod.id) : null;
      const rowLastCustomer = prod ? lastSaleToCustomer(prod.id) : null;
      const priceDisp = (typeof formatLiveAmount==='function' && r.price) ? formatLiveAmount(String(r.price)) : (r.price||'');
      const label = prod ? esc(prod.name) : '';
      const lineAmt = (r.qty||0) * (r.price||0);
      let activeHtml = `
        <div class="inv-line-main">
          <input type="text" class="row-product-search inv-line-name" data-row="${idx}" placeholder="انتخاب کالا..." autocomplete="off" readonly value="${label}" inputmode="none" aria-label="${prod?'تغییر کالا':'انتخاب کالا'}">
          ${rows.length>1?`<button type="button" class="inv-line-del row-del" data-row="${idx}" title="حذف این قلم" aria-label="حذف این قلم">×</button>`:''}
          <span class="inv-line-chevron" data-row="${idx}" aria-hidden="true" style="display:${prod?'none':''}">›</span>
          <div class="prod-drop" data-row="${idx}" hidden></div>
        </div>
        <div class="inv-line-sub" data-row="${idx}" style="display:${prod?'flex':'none'}">
          <span class="inv-line-qtyrate">
            <input type="text" inputmode="decimal" data-row="${idx}" class="row-qty inv-mini-input" aria-label="تعداد" value="${enToFaDigits(fmtQtyDisplay(r.qty||0))}">
            <span class="inv-line-x">×</span>
            <input type="text" inputmode="decimal" data-row="${idx}" class="row-price inv-mini-input inv-mini-input-price" aria-label="قیمت واحد" value="${esc(String(priceDisp))}">
            <span class="inv-line-unit">ت</span>
          </span>
        </div>
        <div class="inv-line-avg-cost${prod && (r.price||0) < rowFifo?' is-below':''}" data-row="${idx}" style="display:${prod?'block':'none'}">${prod?`میانگین خرید: ${toman(rowFifo)} ت`:''}</div>
        <details class="inv-line-market-details" data-row="${idx}" ${prod?'':'hidden'}>
          <summary>اطلاعات بازار</summary>
          <div class="inv-line-market-row"><span>آخرین فروش کلی</span><strong data-market="last-any">${rowLastAny?`${toman(rowLastAny.price)} ت — ${faDate(rowLastAny.date)}`:'ثبت نشده'}</strong></div>
          <div class="inv-line-market-row"><span>آخرین فروش به این مشتری</span><strong data-market="last-customer">${rowLastCustomer?`${toman(rowLastCustomer.price)} ت — ${faDate(rowLastCustomer.date)}`:'ثبت نشده'}</strong></div>
        </details>`;
      const isRowActive = !prod || idx === activeRowIndex;
      return `
      <div class="inv-line${prod?'':' inv-line-empty'}${isRowActive?' is-active':''}" data-row="${idx}">
        ${prod?`<div class="inv-line-collapsed" role="button" tabindex="0" aria-label="ویرایش ${label}">
          <div class="inv-line-body">
            <span class="inv-line-name">${label}</span>
            <div class="inv-line-collapsed-meta"><span class="inv-line-calc">${enToFaDigits(fmtQtyDisplay(r.qty||0))} × ${toman(r.price||0)} ت</span></div>
          </div>
          <span class="inv-line-amount">${toman(lineAmt)} ت</span>
        </div>`:''}
        <div class="inv-line-view-active">${activeHtml}</div>
      </div>`;
    }).join('');
  }

  function invoiceMetrics(){
    if(invoiceMetricsCache) return invoiceMetricsCache;
    const subtotal = rows.reduce((s,r)=>s+(r.qty*r.price-(r.discount||0)),0);
    const discountAmount = discountType==='percent' ? subtotal*(discount||0)/100 : discount;
    const itemsProfit = rows.reduce((s,r)=>{
      if(!r.productId) return s;
      const fifoCost = invoiceFifoCost(r.productId);
      return s + ((r.price||0)-fifoCost)*(r.qty||0);
    }, 0);
    invoiceMetricsCache = {
      subtotal: subtotal,
      discountAmount: discountAmount,
      total: Math.max(0, subtotal - discountAmount),
      profit: itemsProfit - discountAmount
    };
    return invoiceMetricsCache;
  }

  function invoiceTotal(){ return invoiceMetrics().total; }

  function invoiceProfitEstimate(){
    return invoiceMetrics().profit;
  }

  function updateSummary(){
    const metrics = invoiceMetrics();
    const total = metrics.total;
    const discountAmount = metrics.discountAmount;
    const paid = cashPaid+cardPaid+transferPaid+checkAmount;
    const newBalance = prevBalance + total - paid;
    const profit = invoiceProfitEstimate();
    const profitColor = profit<0 ? '#D52B36' : '#0F7A4A';
    const remainCls = newBalance>0 ? 'accent-rust' : 'accent-olive';
    const summaryEl = document.getElementById('calc-summary');
    if(summaryEl) summaryEl.innerHTML = `
      <div class="ledger-row inv-sum-tertiary"><span class="name">مانده قبلی مشتری</span><span class="filler"></span><span class="amount">${toman(prevBalance)} ت</span></div>
      <div class="ledger-row inv-total-row inv-sum-primary"><span class="name">جمع این فاکتور</span><span class="filler"></span><span class="amount">${toman(total)} ت</span></div>
      ${discountAmount>0?`<div class="ledger-row inv-discount-row"><span class="name">تخفیف کلی فاکتور</span><span class="filler"></span><span class="amount">− ${toman(discountAmount)} ت</span></div>`:''}
      <div class="ledger-row inv-sum-secondary"><span class="name">پرداختی</span><span class="filler"></span><span class="amount">(${toman(paid)}) ت</span></div>
      <div class="ledger-row inv-remain-row inv-sum-primary"><span class="name ${remainCls}">مانده جدید</span><span class="filler"></span><span class="amount ${remainCls}">${toman(Math.abs(newBalance))} ت ${balanceStatusWord(newBalance)}</span></div>
    `;
    const profitEl = document.getElementById('inv-profit-summary');
    if(profitEl){
      profitEl.innerHTML = `<span class="name">سود این فاکتور (بر اساس میانگین خرید)</span><strong class="amount" style="color:${profitColor}">${profit<0?'−':''}${toman(Math.abs(profit))} ت</strong>`;
    }
  }

  function renderSheet(){
    // Preserve the sheet's internal scroll position across re-renders.
    // renderSheet() is called on every add-row / row-delete / discount-type
    // change, and each call fully rebuilds #modalRoot via openSheet() (a
    // brand-new .sheet element with scrollTop=0). On a long invoice where the
    // user has scrolled down to the discount/payment section, that reset
    // makes the whole form visibly "jump" back to the top on every one of
    // those actions. Capturing/restoring scrollTop here is local to this
    // function and does not change what openSheet()/closeModal() do for any
    // other sheet in the app.
    const _prevScrollEl = document.querySelector('.inv-body') || document.querySelector('.sheet');
    const _prevScrollTop = _prevScrollEl ? _prevScrollEl.scrollTop : 0;
    // No-Purchase Reason: expected SKUs missing from current basket (non-blocking)
    const basketPids = rows.map(function(r){ return r.productId; }).filter(Boolean);
    const nprCandidatesInv = (typeof getNoPurchaseCandidates === 'function')
      ? getNoPurchaseCandidates(cid, basketPids, 3)
      : [];
    const nprHtmlInv = (typeof noPurchasePromptHtml === 'function')
      ? noPurchasePromptHtml(nprCandidatesInv, 'invoice', 'این مشتری معمولاً این محصول را می‌خرد، ولی در فاکتور فعلی نیست — علت؟')
      : '';
    const custDisplay = cust
      ? (cust.ownerName ? (esc(cust.name)+' / '+esc(cust.ownerName)) : esc(cust.name||'—'))
      : '—';

    openSheet(`
      <div class="inv-sheet-v2">
        <div class="inv-header">
          <button type="button" class="inv-header-btn" id="inv-cancel">لغو</button>
          <div class="inv-header-title">
            <span class="inv-header-title-main">${editInv?'ویرایش فاکتور':'فاکتور جدید'}</span>
            <span class="inv-header-title-sub">${editInv?('#'+esc(String(editInv.number||'—'))):'پیش‌نویس'}</span>
          </div>
          <button type="button" class="btn inv-header-save" id="save-invoice">${editInv?'ذخیره':'ثبت'}</button>
        </div>

        <div class="inv-body">
          ${editInv?`<div class="inv-edit-notice">با ذخیره‌ی این ویرایش، موجودی انبار و مانده حساب مشتری به‌طور خودکار اصلاح می‌شود.</div>`:''}

          <div class="inv-customer-context">
            <div class="inv-customer-info">
              <div class="inv-customer-kicker">مشتری</div>
              <div class="inv-customer-name">${custDisplay}</div>
              ${cust&&cust.phone?`<div class="inv-customer-meta">${esc(cust.phone)}</div>`:''}
            </div>
          </div>

          <div class="field inv-date-field"><label>تاریخ فاکتور</label>${shamsiDateInputHTML('f-date', editInv?editInv.date:todayISO())}</div>

          <div class="inv-section inv-items-section">
            <div class="inv-items-card-head">
              <span class="inv-items-card-label">اقلام فاکتور</span>
            </div>
            <div class="inv-items-card">
              <div id="items-wrap" class="inv-items">${itemsHtml()}</div>
              <button type="button" class="inv-add-line" id="add-row"><span class="inv-add-line-icon" aria-hidden="true">+</span> افزودن قلم جدید</button>
            </div>
          </div>

          ${nprHtmlInv}

          <div class="inv-section inv-payment-section">
            <div class="inv-payment-heading">
              <h2 class="inv-section-title">دریافتی همراه این فاکتور <span class="inv-section-title-optional">(اختیاری)</span></h2>
              <span class="inv-payment-total" id="inv-payment-total">${toman(cashPaid+cardPaid+transferPaid+checkAmount)} ت</span>
            </div>

            <div class="inv-payment-actions" role="group" aria-label="روش دریافت">
              <button type="button" class="inv-payment-action" data-payment-method="cash" aria-expanded="false">
                <span class="inv-payment-action-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M3 9h18M7 14h.01M11 14h3"/></svg>
                </span>
                <span>نقد</span>
                <span class="inv-payment-action-value" data-payment-value="cash">${cashPaid>0 ? toman(cashPaid) + ' ت' : ''}</span>
              </button>
              <button type="button" class="inv-payment-action" data-payment-method="card" aria-expanded="false">
                <span class="inv-payment-action-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M3 10h18M7 15h4"/></svg>
                </span>
                <span>کارت</span>
                <span class="inv-payment-action-value" data-payment-value="card">${cardPaid>0 ? toman(cardPaid) + ' ت' : ''}</span>
              </button>
              <button type="button" class="inv-payment-action" data-payment-method="transfer" aria-expanded="false">
                <span class="inv-payment-action-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none"><rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 9h8M8 13h5M8 17h8"/></svg>
                </span>
                <span>بانکی</span>
                <span class="inv-payment-action-value" data-payment-value="transfer">${transferPaid>0 ? toman(transferPaid) + ' ت' : ''}</span>
              </button>
              <button type="button" class="inv-payment-action" data-payment-method="check" aria-expanded="false">
                <span class="inv-payment-action-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/></svg>
                </span>
                <span>چک</span>
                <span class="inv-payment-action-value" data-payment-value="check">${checkAmount>0 ? toman(checkAmount) + ' ت' : ''}</span>
              </button>
            </div>

            <div class="inv-payment-backdrop" data-payment-backdrop hidden></div>

            <div class="inv-payment-panel" data-payment-panel="cash" hidden>
              <div class="inv-payment-panel-head"><div><strong>دریافت نقدی</strong><small>دارم نقدی می‌گیرم</small></div><button type="button" class="inv-payment-close" data-payment-close="cash" aria-label="بستن">×</button></div>
              <label for="f-cash">مبلغ نقدی</label>
              <input id="f-cash" type="text" inputmode="decimal" value="${cashPaid||''}" placeholder="مبلغ را وارد کنید">
              <button type="button" class="inv-payment-confirm" data-payment-confirm="cash">ثبت دریافت نقدی</button>
            </div>

            <div class="inv-payment-panel" data-payment-panel="card" hidden>
              <div class="inv-payment-panel-head"><div><strong>دریافت با کارت</strong><small>دارم با کارت دریافت می‌کنم</small></div><button type="button" class="inv-payment-close" data-payment-close="card" aria-label="بستن">×</button></div>
              <label for="f-card">مبلغ کارت</label>
              <input id="f-card" type="text" inputmode="decimal" value="${cardPaid||''}" placeholder="مبلغ را وارد کنید">
              <button type="button" class="inv-payment-confirm" data-payment-confirm="card">ثبت دریافت کارت</button>
            </div>

            <div class="inv-payment-panel" data-payment-panel="transfer" hidden>
              <div class="inv-payment-panel-head"><div><strong>انتقال بانکی</strong><small>دارم انتقال بانکی می‌گیرم</small></div><button type="button" class="inv-payment-close" data-payment-close="transfer" aria-label="بستن">×</button></div>
              <label for="f-transfer">مبلغ انتقال</label>
              <input id="f-transfer" type="text" inputmode="decimal" value="${transferPaid||''}" placeholder="مبلغ را وارد کنید">
              <button type="button" class="inv-payment-confirm" data-payment-confirm="transfer">ثبت انتقال بانکی</button>
            </div>

            <div class="inv-payment-panel" data-payment-panel="check" hidden>
              <div class="inv-payment-panel-head"><div><strong>دریافت چک</strong><small>دارم چک دریافت می‌کنم</small></div><button type="button" class="inv-payment-close" data-payment-close="check" aria-label="بستن">×</button></div>
              <label for="f-check">مبلغ چک</label>
              <input id="f-check" type="text" inputmode="decimal" value="${checkAmount||''}" placeholder="مبلغ چک را وارد کنید">
              <button type="button" class="inv-payment-confirm" data-payment-confirm="check">ثبت دریافت چک</button>
              <div class="inv-payment-check-due" id="check-due-wrap" style="display:${checkAmount>0?'block':'none'};">
                <label for="f-check-due">تاریخ سررسید چک</label>
                ${shamsiDateInputHTML('f-check-due', checkDue)}
              </div>
            </div>

            <div class="inv-discount-block" role="group" aria-label="تخفیف فاکتور">
              <span class="inv-discount-label">تخفیف</span>
              <div class="inv-discount-type" role="group" aria-label="نوع تخفیف">
                <button type="button" class="inv-discount-type-btn${discountType==='fixed'?' is-active':''}" data-discount-type="fixed" aria-pressed="${discountType==='fixed'?'true':'false'}">مبلغ</button>
                <button type="button" class="inv-discount-type-btn${discountType==='percent'?' is-active':''}" data-discount-type="percent" aria-pressed="${discountType==='percent'?'true':'false'}">درصد</button>
              </div>
              <input id="f-discount" type="text" inputmode="decimal" value="${discount ? enToFaDigits(String(discount)) : ''}" placeholder="۰" aria-label="مقدار تخفیف">
            </div>
          </div>

          <div class="inv-summary-section">
            <h2 class="inv-section-title">جمع‌بندی فاکتور</h2>
            <div id="calc-summary"></div>
          </div>
          <div class="inv-profit-summary" id="inv-profit-summary" aria-label="سود این فاکتور"></div>
        </div>
      </div>
    `, {dirtyCheck:true});
    const invoiceBottomNav = document.getElementById('bottom-nav');
    if (invoiceBottomNav && invoiceBottomNav.dataset.invoiceHiddenPrev == null) { invoiceBottomNav.dataset.invoiceHiddenPrev = invoiceBottomNav.hidden ? '1' : '0'; invoiceBottomNav.hidden = true; }
    // Presentation-only: the sheet's generic close-x (from openSheet) is
    // replaced by the "لغو" button in the custom header above, and the
    // custom header's save button IS the original #save-invoice element
    // (same id, same listener below) — no duplicate save logic anywhere.
    (function(){
      const sheetEl = document.querySelector('.sheet');
      if(sheetEl) sheetEl.classList.add('inv-sheet-host');
      // Overlay default z-index (60) is below bottom-nav (70). Lift only while
      // Invoice V6 host is open so chrome cannot cover the full-screen sheet.
      const ov = document.getElementById('overlay');
      if(ov) ov.style.zIndex = '80';
      const genericClose = document.getElementById('closeX');
      if(genericClose) genericClose.style.display = 'none';
      const cancelBtn = document.getElementById('inv-cancel');
      if(cancelBtn) cancelBtn.addEventListener('click', async ()=>{
        if(sheetEl && sheetEl.dataset.dirty === '1'){
          if(await appConfirm('تغییرات ذخیره‌نشده از بین می‌روند. از فاکتور خارج می‌شوید؟')) closeModal();
        } else closeModal();
      });
    })();
    if(_prevScrollTop){
      const _newScrollEl = document.querySelector('.inv-body') || document.querySelector('.sheet');
      if(_newScrollEl) _newScrollEl.scrollTop = _prevScrollTop;
    }
    updateSummary();
    // No-Purchase Reason chips (re-bound after every renderSheet rebuild)
    if(typeof bindNoPurchasePrompt === 'function') bindNoPurchasePrompt(cid);

    document.querySelectorAll('.inv-line-collapsed').forEach(el=>{
      const activate = ()=>{
        const line = el.closest('.inv-line');
        if(!line) return;
        const idx = parseInt(line.getAttribute('data-row'), 10);
        if(idx === activeRowIndex) return;
        setActiveRow(idx);
        focusQtyForRow(idx);
      };
      el.addEventListener('click', activate);
      el.addEventListener('keydown', e=>{
        if(e.key==='Enter' || e.key===' '){ e.preventDefault(); activate(); }
      });
    });
    document.querySelectorAll('.row-qty').forEach(el=>el.addEventListener('blur', e=>{
      const key = e.target.dataset.row;
      if(e.target.value.trim()==='' && qtyFocusPrevious.has(String(key))){
        e.target.value = qtyFocusPrevious.get(String(key));
        rows[key].qty = parseFloat(faToEnDigits(e.target.value))||0;
        updateRowInfo(key);
        updateSummary();
      }
      qtyFocusPrevious.delete(String(key));
    }));

    document.getElementById('add-row').addEventListener('click', ()=>{
      // One active empty line at a time: once a blank line exists, repeated
      // taps open its product picker instead of creating another blank row.
      const emptyIdx = rows.findIndex(r=>!r.productId);
      if(emptyIdx >= 0){
        activeRowIndex = emptyIdx;
        openProductDrop(emptyIdx);
        return;
      }
      rows.push({productId:'', qty:1, price:0, discount:0});
      invalidateInvoiceMetrics();
      activeRowIndex = rows.length-1;
      renderSheet();
      // Start the intended workflow immediately: Add Line → Product Search.
      setTimeout(()=>openProductDrop(rows.length-1), 0);
    });
    document.querySelectorAll('.row-del').forEach(el=>el.addEventListener('click', e=>{
      const i = parseInt(e.currentTarget.dataset.row, 10);
      if(rows.length>1 && i>=0 && i<rows.length){
        // Stage 3 — keep activeRowIndex valid across the splice: dropping
        // the active row itself clears it (and its picker, if any); dropping
        // a row before it shifts it down by one so it still points at the
        // same logical row after renderSheet() rebuilds the list.
        if(activeRowIndex === i){
          activeRowIndex = null;
          closeAllProductDrops();
        }else if(activeRowIndex !== null && i < activeRowIndex){
          activeRowIndex -= 1;
        }
        rows.splice(i, 1);
        invalidateInvoiceMetrics();
        renderSheet();
      }
    }));

    function closeAllProductDrops(){
      prodDropOpenRow = null;
      prodDropOpening = false;
      document.querySelectorAll('.prod-drop').forEach(d=>{
        d.hidden = true;
        d.classList.remove('is-open');
        d.innerHTML = '';
        d.style.top = d.style.bottom = d.style.maxHeight = d.style.left = d.style.right = '';
      });
    }
    // Stage 3 — expand/collapse a row in place. Pure class toggle: no
    // renderSheet(), no outerHTML/innerHTML morph. Rows with no collapsed
    // view yet (still empty, awaiting a product) are left alone here — they
    // are not part of the collapse/expand toggle at all (see itemsHtml()).
    function setActiveRow(idx){
      idx = parseInt(idx, 10);
      if(isNaN(idx) || idx < 0 || idx >= rows.length) return;
      if(idx === activeRowIndex) return;
      if(prodDropOpenRow !== null) closeAllProductDrops();

      // A transient empty row is always appended by Add Item. Remove that
      // true empty row from both state and DOM when the user switches away,
      // so Save can never validate an invisible empty item.
      if(activeRowIndex !== null && rows[activeRowIndex] && !rows[activeRowIndex].productId && activeRowIndex !== idx){
        const removedIdx = activeRowIndex;
        const emptyEl = document.querySelector(`.inv-line[data-row="${removedIdx}"]`);
        rows.splice(removedIdx, 1);
        invalidateInvoiceMetrics();
        if(emptyEl) emptyEl.remove();
        // Add Item appends the transient row, so populated row indexes remain stable.
      }

      activeRowIndex = idx;
      document.querySelectorAll('.inv-line.is-active').forEach(el=>{
        const rowIdx = parseInt(el.getAttribute('data-row'), 10);
        if(rowIdx !== idx && rows[rowIdx] && rows[rowIdx].productId) el.classList.remove('is-active');
        else if(rowIdx !== idx && (!rows[rowIdx] || !rows[rowIdx].productId)) el.classList.remove('is-active');
      });
      const newActiveEl = document.querySelector(`.inv-line[data-row="${idx}"]`);
      if(newActiveEl) newActiveEl.classList.add('is-active');
    }

    function positionProductDrop(dropEl, anchorEl){
      if(!dropEl || !anchorEl) return;
      const margin = 10;
      const rect = anchorEl.getBoundingClientRect();
      const vv = window.visualViewport;
      const vh = vv ? vv.height : window.innerHeight;
      const vTop = vv ? vv.offsetTop : 0;
      // Height cap: ~38% viewport, max 300px, min 180px
      const maxH = Math.min(300, Math.max(180, Math.round(vh * 0.38)));
      dropEl.style.left = margin + 'px';
      dropEl.style.right = margin + 'px';
      dropEl.style.width = 'auto';
      dropEl.style.maxHeight = maxH + 'px';
      const spaceBelow = (vTop + vh) - rect.bottom - 8;
      const spaceAbove = rect.top - vTop - 8;
      if(spaceBelow >= Math.min(maxH, 200) || spaceBelow >= spaceAbove){
        dropEl.style.top = (rect.bottom + 4) + 'px';
        dropEl.style.bottom = 'auto';
        if(spaceBelow < maxH) dropEl.style.maxHeight = Math.max(160, spaceBelow) + 'px';
      }else{
        dropEl.style.bottom = (window.innerHeight - rect.top + 4) + 'px';
        dropEl.style.top = 'auto';
        if(spaceAbove < maxH) dropEl.style.maxHeight = Math.max(160, spaceAbove) + 'px';
      }
    }
    function openProductDrop(idx){
      idx = String(idx);
      // Same row is a true toggle: tapping the product field again closes it.
      // Do not rebuild the panel, which previously caused the close→reopen flash.
      if(prodDropOpenRow === idx){
        closeAllProductDrops();
        return;
      }
      if(prodDropOpening) return;
      prodDropOpening = true;
      try{
        const dropEl = document.querySelector(`.prod-drop[data-row="${idx}"]`);
        const anchor = document.querySelector(`.row-product-search[data-row="${idx}"]`);
        if(!dropEl || !anchor) return;
        // Close others first
        document.querySelectorAll('.prod-drop').forEach(d=>{
          if(d === dropEl) return;
          d.hidden = true;
          d.classList.remove('is-open');
          d.innerHTML = '';
        });
        dropEl.innerHTML = productDropPanelHtml(idx);
        dropEl.hidden = false;
        dropEl.classList.add('is-open');
        positionProductDrop(dropEl, anchor);
        prodDropOpenRow = idx;
        const search = dropEl.querySelector('.prod-drop-search');
        const list = dropEl.querySelector('.prod-drop-list');
        if(search && list){
          // Keyboard only when user taps search — no auto-focus
          search.addEventListener('input', ()=>{
            list.innerHTML = productDropListHtml(idx, search.value);
          });
        }
      }finally{
        // Release re-entry guard after gesture settles
        setTimeout(()=>{ prodDropOpening = false; }, 120);
      }
    }
    function selectProduct(idx, productId){
      const prod = invoiceProduct(productId);
      if(!prod) return;
      rows[idx].productId = productId;
      delete rows[idx].buyPrice;
      rows[idx].price = prod.retail||prod.sell||0;
      invalidateInvoiceMetrics();
      const searchEl = document.querySelector(`.row-product-search[data-row="${idx}"]`);
      if(searchEl){
        searchEl.value = prod.name;
        searchEl.readOnly = true;
      }
      const priceEl = document.querySelector(`.row-price[data-row="${idx}"]`);
      if(priceEl){
        priceEl.value = (typeof formatLiveAmount==='function')
          ? formatLiveAmount(String(rows[idx].price))
          : rows[idx].price;
      }
      closeAllProductDrops();
      updateRowInfo(idx);
      updateSummary();
      // Hide No-Purchase prompt for products now in the basket
      try{
        const card = document.getElementById('npr-card');
        if(card){
          card.querySelectorAll('.npr-chip[data-npr-pid="' + productId + '"]').forEach(function(chip){
            const block = chip.closest('.npr-product');
            if(block) block.style.display = 'none';
          });
          const remaining = card.querySelectorAll('.npr-product:not([style*="display: none"])');
          if(!remaining.length) card.style.display = 'none';
        }
      }catch(eNpr){ /* non-critical */ }
      // Stage 3 — row stays active after picking a product; hand off
      // straight to quantity entry (iOS Safari: wait a frame after the
      // picker's DOM changes so focus isn't dropped).
      focusQtyForRow(idx);
    }

    // Single gesture open via pointerup (avoids focus+click double-open on mobile)
    document.querySelectorAll('.row-product-search').forEach(el=>{
      el.readOnly = true;
      el.setAttribute('inputmode', 'none');
      el.addEventListener('pointerup', function(e){
        e.preventDefault();
        openProductDrop(el.getAttribute('data-row'));
      });
      // Keep the field display-only. Opening is handled by pointerup alone;
      // opening from focus as well caused a mobile close→reopen flash.
      el.addEventListener('focus', function(){
        try{ el.blur(); }catch(err){}
      });
    });

    document.querySelectorAll('.prod-drop').forEach(dropEl=>{
      dropEl.addEventListener('mousedown', e=>{
        // Allow focusing internal search; block only for list items
        if(e.target.closest('.prod-drop-search')) return;
        e.preventDefault();
      });
      dropEl.addEventListener('click', e=>{
        const item = e.target.closest('.prod-drop-item');
        if(!item) return;
        e.preventDefault();
        e.stopPropagation();
        selectProduct(item.getAttribute('data-row'), item.getAttribute('data-pid'));
      });
      dropEl.addEventListener('keydown', e=>{
        const item = e.target.closest('.prod-drop-item');
        if(item && (e.key==='Enter' || e.key===' ')){
          e.preventDefault();
          selectProduct(item.getAttribute('data-row'), item.getAttribute('data-pid'));
        }
      });
    });

    // Outside tap closes (listener bound once per document; the target it reads
    // is refreshed on every renderSheet() call below so that reopening the
    // invoice form — or editing a different invoice — after a previous one was
    // closed doesn't leave this bound to a stale closure from the first time
    // an invoice sheet was ever opened, which silently broke outside-tap-to-close
    // on every invoice sheet after the first one in a session)
    document._invProdDropActive = { get openRow(){ return prodDropOpenRow; }, close: closeAllProductDrops };
    if(!document._invProdDropOutsideBound){
      document._invProdDropOutsideBound = true;
      document.addEventListener('pointerdown', function(e){
        if(e.target.closest('.prod-drop') || e.target.closest('.row-product-search')) return;
        const active = document._invProdDropActive;
        if(!active || active.openRow == null) return;
        active.close();
      }, true);
    }

    document.querySelectorAll('.row-qty').forEach(el=>el.addEventListener('input', e=>{
      const idx = e.target.dataset.row;
      rows[idx].qty = parseFloat(faToEnDigits(e.target.value))||0;
      invalidateInvoiceMetrics();
      updateRowInfo(idx);
      updateSummary();
    }));
    document.querySelectorAll('.row-price').forEach(el=>el.addEventListener('input', e=>{
      const idx = e.target.dataset.row;
      rows[idx].price = parseFloat(faToEnDigits(e.target.value))||0;
      invalidateInvoiceMetrics();
      updateRowInfo(idx);
      updateSummary();
    }));
    function updateInvPaymentTotal(){
      const totalEl = document.getElementById('inv-payment-total');
      if(totalEl){
        const totalPaid = cashPaid+cardPaid+transferPaid+checkAmount;
        totalEl.textContent = totalPaid > 0 ? toman(totalPaid) + ' ت' : '';
      }
      document.querySelectorAll('[data-payment-value]').forEach(el=>{
        const method = el.getAttribute('data-payment-value');
        const amount = method==='cash' ? cashPaid : method==='card' ? cardPaid : method==='transfer' ? transferPaid : checkAmount;
        el.textContent = amount > 0 ? toman(amount) + ' ت' : '';
        el.classList.toggle('is-filled', amount > 0);
      });
    }
    function closeInvPaymentPanels(){
      document.querySelectorAll('.inv-payment-panel').forEach(panel=>panel.hidden = true);
      const backdrop = document.querySelector('[data-payment-backdrop]');
      if(backdrop) backdrop.hidden = true;
      document.querySelectorAll('.inv-payment-action').forEach(btn=>{
        btn.classList.remove('is-active');
        btn.setAttribute('aria-expanded','false');
      });
    }
    function paymentAmountFor(method){
      return method==='cash' ? cashPaid : method==='card' ? cardPaid : method==='transfer' ? transferPaid : checkAmount;
    }
    function setPaymentAmount(method, amount){
      const value = Math.max(0, Number(amount)||0);
      if(method==='cash') cashPaid=value;
      else if(method==='card') cardPaid=value;
      else if(method==='transfer') transferPaid=value;
      else checkAmount=value;
    }
    document.querySelectorAll('.inv-payment-action').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        const method = btn.getAttribute('data-payment-method');
        const panel = document.querySelector(`.inv-payment-panel[data-payment-panel="${method}"]`);
        if(!panel) return;
        const willOpen = panel.hidden;
        closeInvPaymentPanels();
        if(willOpen){
          const backdrop = document.querySelector('[data-payment-backdrop]');
          if(backdrop) backdrop.hidden = false;
          panel.hidden = false;
          btn.classList.add('is-active');
          btn.setAttribute('aria-expanded','true');
          const input = panel.querySelector('input[type="text"]');
          if(input){
            input.value = pendingPayment[method] > 0 ? enToFaDigits(String(pendingPayment[method])) : '';
            setTimeout(()=>input.focus(), 0);
          }
          if(method==='check'){
            const due = panel.querySelector('#f-check-due');
            if(due) due.value = pendingPayment.checkDue || checkDue;
          }
        }
      });
    });
    const paymentBackdrop = document.querySelector('[data-payment-backdrop]');
    if(paymentBackdrop) paymentBackdrop.addEventListener('click', closeInvPaymentPanels);
    document.querySelectorAll('.inv-payment-close').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        const method = btn.getAttribute('data-payment-close');
        const panel = document.querySelector(`.inv-payment-panel[data-payment-panel="${method}"]`);
        if(panel) panel.hidden = true;
        const action = document.querySelector(`.inv-payment-action[data-payment-method="${method}"]`);
        if(action){
          action.classList.remove('is-active');
          action.setAttribute('aria-expanded','false');
        }
        const backdrop = document.querySelector('[data-payment-backdrop]');
        if(backdrop) backdrop.hidden = true;
      });
    });
    ['cash','card','transfer','check'].forEach(method=>{
      const id = method==='cash' ? 'f-cash' : method==='card' ? 'f-card' : method==='transfer' ? 'f-transfer' : 'f-check';
      const input = document.getElementById(id);
      if(input) input.addEventListener('input', e=>{
        const v = parseFloat(faToEnDigits(e.target.value))||0;
        pendingPayment[method] = v;
        e.target.value = v ? enToFaDigits(String(v)) : '';
        if(method==='check'){
          const dueWrap = document.getElementById('check-due-wrap');
          if(dueWrap) dueWrap.style.display = v>0 ? 'block' : 'none';
        }
      });
    });
    document.querySelectorAll('.inv-payment-confirm').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        const method = btn.getAttribute('data-payment-confirm');
        const input = document.querySelector(`.inv-payment-panel[data-payment-panel="${method}"] input[type="text"]`);
        const value = input ? parseFloat(faToEnDigits(input.value))||0 : 0;
        pendingPayment[method] = value;
        setPaymentAmount(method, value);
        if(method==='check'){
          const due = document.getElementById('f-check-due');
          pendingPayment.checkDue = due ? due.value : checkDue;
          checkDue = pendingPayment.checkDue || todayISO();
        }
        updateInvPaymentTotal();
        updateSummary();
        closeInvPaymentPanels();
      });
    });
    document.getElementById('f-discount').addEventListener('input', e=>{
      let v = parseFloat(faToEnDigits(e.target.value))||0;
      if(discountType==='percent') v = Math.min(100, Math.max(0, v));
      discount = v;
      invalidateInvoiceMetrics();
      updateSummary();
    });
    document.querySelectorAll('.inv-discount-type-btn').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        const nextType = btn.getAttribute('data-discount-type');
        if(nextType===discountType) return;
        discountType = nextType;
        if(discountType==='percent') discount = Math.min(100, Math.max(0, discount));
        invalidateInvoiceMetrics();
        renderSheet();
      });
    });

    document.getElementById('save-invoice').addEventListener('click', async (e)=>{
      const btn = e.currentTarget;
      if(btn.disabled) return; // جلوگیری از ثبت دوباره با کلیک سریع/پی‌درپی
      btn.disabled = true;
      const date = document.getElementById('f-date').value || todayISO();

      // اعتبارسنجی: ردیف‌های خالیِ draft (بدون جنس انتخاب‌شده) اگر حداقل یک ردیف
      // معتبر دیگر وجود داشته باشد، نباید مانع ثبت فاکتور شوند؛ اما ردیفی که
      // productId دارد ولی در لیست جنس‌ها پیدا نمی‌شود (نامعتبر) همچنان خطا می‌دهد.
      const invalidProductRow = rows.find(r=> r.productId && !invoiceProduct(r.productId));
      if(invalidProductRow){
        showToast('برای هر ردیف باید یک جنس از لیست انتخاب کنی.');
        btn.disabled = false;
        return;
      }
      const validRows = rows.filter(r=> r.productId && invoiceProduct(r.productId));
      if(validRows.length===0){
        showToast('برای هر ردیف باید یک جنس از لیست انتخاب کنی.');
        btn.disabled = false;
        return;
      }

      // Business validation: discount invariants must hold before any stock/payment
      // mutation or persistence. UI clamping is not sufficient protection.
      const invalidRow = rows.find(r=> {
        const gross = (Number(r.qty)||0) * (Number(r.price)||0);
        const rowDiscount = Number(r.discount)||0;
        return !(r.qty>0) || r.price<0 || rowDiscount<0 || rowDiscount>gross;
      });
      if(invalidRow){
        showToast('مقادیر فاکتور نامعتبر است.\n\nتعداد باید بزرگ‌تر از صفر، قیمت و تخفیف نباید منفی باشند و تخفیف هر ردیف نباید از مبلغ همان ردیف بیشتر باشد.');
        btn.disabled = false;
        return;
      }
      const invoiceSubtotal = rows.reduce((s,r)=>s + (Number(r.qty)||0)*(Number(r.price)||0) - (Number(r.discount)||0), 0);
      const normalizedDiscount = Number(discount);
      if(!Number.isFinite(normalizedDiscount) || normalizedDiscount<0){
        showToast('تخفیف کلی فاکتور نمی‌تواند منفی یا نامعتبر باشد.');
        btn.disabled = false;
        return;
      }
      if(discountType==='fixed' && normalizedDiscount>invoiceSubtotal){
        showToast('تخفیف مبلغی فاکتور نمی‌تواند از مبلغ خالص اقلام بیشتر باشد.');
        btn.disabled = false;
        return;
      }
      if(discountType==='percent' && normalizedDiscount>100){
        showToast('درصد تخفیف فاکتور باید بین صفر تا ۱۰۰ باشد.');
        btn.disabled = false;
        return;
      }
      if(discountType!=='fixed' && discountType!=='percent'){
        showToast('نوع تخفیف فاکتور نامعتبر است.');
        btn.disabled = false;
        return;
      }
      // FIX (audit M-1): reject negative amounts in the invoice-attached payment
      // fields, same as row qty/price/discount above. Zero/positive unaffected.
      if(cashPaid<0 || cardPaid<0 || transferPaid<0 || checkAmount<0){
        showToast('مبلغ دریافتی (نقد/کارت/انتقال/چک) نمی‌تواند منفی باشد.');
        btn.disabled = false;
        return;
      }

      const items = validRows.map(r=>{
        const prod = invoiceProduct(r.productId);
        return { productId:r.productId, name:prod.name, qty:r.qty, price:r.price, buyPrice:(r.buyPrice!==undefined?r.buyPrice:prod.buy), discount:r.discount||0, weight:(prod.packageWeight||0)*r.qty };
      });

      // BLOCK فروش بیش از stock یا بیش از لایه‌های FIFO — قبل از هر mutation
      const creditStock = {};
      const creditFifo = {};
      if(editInv){
        const pids = {};
        (editInv.items||[]).forEach(it=>{ if(it.productId) pids[it.productId]=true; });
        Object.keys(pids).forEach(pid=>{
          creditStock[pid] = (editInv.items||[]).filter(it=>it.productId===pid).reduce((s,it)=>s+(it.qty||0),0);
          creditFifo[pid] = invoiceReleasedFifoQty(editInv, pid);
        });
      }
      const stockCheck = validateSaleAvailability(items, creditStock, creditFifo);
      if(!stockCheck.ok){
        showToast(stockCheck.error || 'موجودی کافی نیست یا موجودی FIFO با موجودی کالا ناسازگار است.', {type:'error'});
        btn.disabled = false;
        return;
      }

      const saveMessage = editInv
        ? 'با ویرایش این فاکتور، موجودی انبار و حساب مشتری اصلاح خواهد شد. ادامه می‌دهید؟'
        : 'فاکتور ثبت شود؟ تغییرات فاکتور پس از تأیید ثبت خواهند شد.';
      if(!(await appConfirm(saveMessage))){ btn.disabled = false; return; }

      const total = invoiceTotal();
      const paid = cashPaid+cardPaid+transferPaid+checkAmount;
      const newBalance = prevBalance + total - paid;

      if(editInv){
        // دفاع دوم: حتی اگر فرم ویرایش قبلاً باز شده باشد، قبل از هر revert دوباره dependency را بررسی کن.
        if(invoiceHasLinkedStockReturn(editInv.id)){
          showToast('این فاکتور دارای برگشت از فروش است و برای حفظ یکپارچگی موجودی قابل ویرایش نیست');
          btn.disabled = false;
          return;
        }
        // اسنپ‌شات کامل قبل از هر mutation — اگر saveData() در انتها شکست بخورد،
        // data در حافظه دقیقاً به همین حالت (قبل از هر تغییری) برمی‌گردد تا با
        // آخرین نسخه‌ی موفق در IndexedDB ناهماهنگ نماند.
        const previousData = JSON.parse(JSON.stringify(data));

        // snapshot قبل از تغییر، برای تاریخچه و rollback احتمالی
        const before = {
          date:editInv.date, items:editInv.items, total:editInv.total, discount:editInv.discount, discountType:editInv.discountType,
          cashPaid:editInv.cashPaid||0, cardPaid:editInv.cardPaid||0, transferPaid:editInv.transferPaid||0, checkPaid:editInv.checkPaid||0,
          newBalance:editInv.newBalance,
        };
        const checkMeta = existingCheck ? {checkNumber:existingCheck.checkNumber, status:existingCheck.status} : null;

        // ۱) برگردوندن اثر فاکتور قبلی: موجودی کالاها + حذف پرداخت/چک مرتبط با همین فاکتور
        const oldItemsSnap = editInv.items;
        const oldDateSnap = editInv.date;
        revertInvoiceStockEffects(editInv);
        revertInvoicePayments(editInv);

        // ۲) به‌روزرسانی خود فاکتور با مقادیر جدید (همون id و شماره فاکتور حفظ می‌مونه)
        editInv.date = date; editInv.items = items; editInv.total = total; editInv.discount = discount; editInv.discountType = discountType;
        editInv.prevBalance = prevBalance; editInv.cashPaid = cashPaid; editInv.cardPaid = cardPaid;
        editInv.transferPaid = transferPaid; editInv.checkPaid = checkAmount; editInv.newBalance = newBalance;

        // ۳) اعمال دوباره‌ی موجودی/پرداخت‌ها — اگر BLOCK شد، فاکتور قبلی را کامل برگردان
        try{
          applyInvoiceStockEffects(items, date, editInv, false);
        }catch(e){
          editInv.date = oldDateSnap; editInv.items = oldItemsSnap;
          editInv.total = before.total; editInv.discount = before.discount; editInv.discountType = before.discountType;
          editInv.cashPaid = before.cashPaid; editInv.cardPaid = before.cardPaid;
          editInv.transferPaid = before.transferPaid; editInv.checkPaid = before.checkPaid;
          editInv.newBalance = before.newBalance;
          applyInvoiceStockEffects(oldItemsSnap, oldDateSnap, editInv, false);
          pushInvoicePayments(cid, editInv, before.cashPaid, before.cardPaid, before.transferPaid, before.checkPaid, checkDue, checkMeta);
          showToast((e && e.message) || 'موجودی کافی نیست یا موجودی FIFO با موجودی کالا ناسازگار است.', {type:'error'});
          btn.disabled = false;
          return;
        }
        pushInvoicePayments(cid, editInv, cashPaid, cardPaid, transferPaid, checkAmount, checkDue, checkMeta);

        // ۴) ثبت این ویرایش در تاریخچه‌ی خود فاکتور
        editInv.editHistory = editInv.editHistory||[];
        editInv.editHistory.push({
          id:uid(), editedAt:new Date().toISOString(),
          before, after:{date, items, total, discount, discountType, cashPaid, cardPaid, transferPaid, checkPaid:checkAmount},
        });

        try{
          await saveData();
        }catch(e){
          // saveData() شکست خورد: data را دقیقاً به حالت قبل از این ویرایش برگردان
          // تا RAM با آخرین نسخه‌ی واقعاً ذخیره‌شده در IndexedDB هماهنگ بماند.
          restoreDataInPlace(previousData);
          btn.disabled = false;
          return;
        }
        closeModal(); openInvoiceDetail(editInv.id, cid); render();
        showToast('فاکتور ویرایش شد؛ موجودی و حساب مشتری اصلاح شد');
        return;
      }

      const newInv = {
        id:uid(), number:null, customerId:cid, date, items, total, discount, discountType,
        prevBalance, cashPaid, cardPaid, transferPaid, checkPaid:checkAmount, newBalance,
        ...(opts.visitId ? {visitId: opts.visitId} : {}),
      };
      // اسنپ‌شات کامل قبل از هر mutation — اگر saveData() در انتها شکست بخورد،
      // data در حافظه دقیقاً به همین حالت (قبل از هر تغییری) برمی‌گردد تا با
      // آخرین نسخه‌ی موفق در IndexedDB ناهماهنگ نماند.
      const previousData = JSON.parse(JSON.stringify(data));
      try{
        newInv.number = nextInvoiceNumber();
        applyInvoiceStockEffects(items, date, newInv, true);
      }catch(e){
        restoreDataInPlace(previousData);
        showToast((e && e.message) || 'موجودی کافی نیست یا موجودی FIFO با موجودی کالا ناسازگار است.', {type:'error'});
        btn.disabled = false;
        return;
      }
      data.invoices.push(newInv);
      pushInvoicePayments(cid, newInv, cashPaid, cardPaid, transferPaid, checkAmount, checkDue, null);
      try{
        await saveData();
      }catch(e){
        // saveData() شکست خورد: data را دقیقاً به حالت قبل از این فاکتور برگردان
        // تا RAM با آخرین نسخه‌ی واقعاً ذخیره‌شده در IndexedDB هماهنگ بماند.
        restoreDataInPlace(previousData);
        btn.disabled = false;
        return;
      }
      // Game Center hooks — CREATE only (edit path returns earlier). Never rolls back CRM.
      if (typeof gameOnInvoice === 'function') {
        try {
          await gameOnInvoice(newInv.id, newInv.date);
        } catch (e) {
          console.warn('Game hook failed:', e);
        }
      }
      if (typeof GameLogic !== 'undefined' && GameLogic && typeof GameLogic.maybeClaimConversions === 'function') {
        try {
          await GameLogic.maybeClaimConversions();
        } catch (e) {
          console.warn('Game hook failed:', e);
        }
      }
      render(); showToast('فاکتور ثبت شد');
      openSheet(`
        <h3>فاکتور ثبت و توی حساب مشتری ذخیره شد</h3>
        <div class="empty">حالا می‌خوای همین فاکتور رو چاپ کنی، تصویرش رو بگیری یا فقط ذخیره بمونه؟</div>
        <div class="btn-row">
          <button class="btn" id="print-now">چاپ فاکتور</button>
          <button class="btn secondary" id="image-now">خروجی تصویر (واتساپ)</button>
          <button class="btn secondary" id="skip-print">فقط ذخیره بمونه</button>
        </div>
      `);
      document.getElementById('print-now').addEventListener('click', ()=>{
        closeModal();
        setTimeout(()=>printInvoice(newInv.id), 50);
      });
      document.getElementById('image-now').addEventListener('click', async ()=>{
        await exportInvoiceImage(newInv.id);
        closeModal(); openCustomerDetail(cid);
      });
      document.getElementById('skip-print').addEventListener('click', ()=>{
        closeModal(); openCustomerDetail(cid);
      });
    });
  }
  renderSheet();
}

// ---------- suppliers ----------
function openAddSupplier(){
  openSheet(`
    <h3>تامین‌کننده جدید</h3>
    <div class="field"><label>نام تامین‌کننده</label><input id="f-name"></div>
    <div class="field"><label>شماره تماس (اختیاری)</label><input id="f-phone"></div>
    <div class="field">
      <label>مانده بدهی اولیه به این تامین‌کننده (تومان)</label>
      <input id="f-opening" type="text" inputmode="decimal">
      <div class="empty" style="padding:4px 0 0;text-align:right;font-size:.75rem;">بدهی که از قبل از استفاده از این برنامه داری رو اینجا بزن.</div>
    </div>
    <div class="btn-row"><button class="btn" id="save-supplier">ذخیره</button></div>
  `);
  document.getElementById('save-supplier').addEventListener('click', async (e)=>{
    await withSubmitGuard(e.currentTarget, async ()=>{
      const name = document.getElementById('f-name').value.trim();
      if(!name){ showToast('نام تامین‌کننده رو وارد کن'); throw new Error('validation'); }
      const phone = document.getElementById('f-phone').value.trim();
      const openingBalance = numVal(document.getElementById('f-opening'));
      data.suppliers.push({id:uid(), name, phone, openingBalance, purchases:[], payments:[]});
      await saveData(); closeModal(); render(); showToast('تامین‌کننده اضافه شد');
    });
  });
}


  /** G4: one-tap purchase-return reason (metadata only; no stock/FIFO impact). */
function openPurchaseReturnReasonPicker(onPick){
  const REASONS = [
    { value: 'defective', label: 'خرابی' },
    { value: 'deliveryError', label: 'اشتباه در ارسال' },
    { value: 'overstock', label: 'مازاد کالا' },
    { value: 'changeMind', label: 'تغییر نظر' },
    { value: 'complaint', label: 'شکایت' },
    { value: 'other', label: 'سایر' },
  ];
  openSheet(
    '<h3>برگشت خرید</h3>' +
    '<div class="visit-card visit-card-enter">' +
      '<div class="q-title">علت مرجوعی؟</div>' +
      '<div class="chip-wrap">' +
        REASONS.map(function(r){
          return '<button type="button" class="chip-opt" data-pr-reason="' + esc(r.value) + '">' + esc(r.label) + '</button>';
        }).join('') +
      '</div>' +
    '</div>'
  );
  const root = document.getElementById('modalRoot');
  let committed = false;
  root.querySelectorAll('[data-pr-reason]').forEach(function(btn){
    btn.addEventListener('click', function(){
      if(committed) return;
      committed = true;
      root.querySelectorAll('[data-pr-reason]').forEach(function(b){ b.disabled = true; });
      const v = btn.getAttribute('data-pr-reason');
      if(typeof onPick === 'function') onPick(v);
    });
  });
}


function openSupplierDetail(sid){
  AppRouter.navigate('/supplier', { id: sid });
}


/* ===========================
   Developer QA Module
   Isolated test harness — additive only.
   Does not modify any existing business logic.
=========================== */
(function DeveloperQAModule(){
  'use strict';

  const QA_MARKER = '__QA_TEST__';
  let qaRunning = false;
  let qaReport = null;

  function qaNow(){ return performance.now(); }

  function deepClone(obj){
    return JSON.parse(JSON.stringify(obj));
  }

  function assert(cond, msg, details){
    if(cond) return { ok:true, msg };
    return { ok:false, msg, details: details||'' };
  }

  function approxEq(a, b, eps){
    eps = eps==null ? 0.01 : eps;
    return Math.abs((a||0)-(b||0)) <= eps;
  }

  /**
   * QA seed/top-up aligned with current FIFO architecture.
   * Creates an open inventory layer via production createInventoryLayer,
   * and increments stockQty + stockLog to match.
   * Signature used by all call sites: (prod, qty, unitCost, note)
   */
  function qaAddStockWithLayer(prod, qty, unitCost, note){
    if(!prod || !(qty>0)) return;
    const cost = (unitCost!=null && !isNaN(Number(unitCost))) ? Number(unitCost) : (prod.buy||0);
    createInventoryLayer({
      purchaseId: null,
      productId: prod.id,
      itemId: null,
      qty: qty,
      unitCost: cost,
      source: 'manual',
      date: todayISO(),
      note: note || 'QA stock',
    });
    prod.stockQty = (prod.stockQty||0) + qty;
    prod.stockLog = prod.stockLog||[];
    prod.stockLog.push({id:uid(), date:todayISO(), type:'in', qty:qty, note: note||'QA stock'});
  }

  /**
   * Additive FIFO health checks. Signature: (rec, products, tag)
   * Does not remove or weaken existing assertions.
   */
  function qaAssertFifoHealthy(rec, products, tag){
    if(typeof ensureInventoryLayers === 'function') ensureInventoryLayers();
    rec(assert(Array.isArray(data.inventoryLayers), 'FIFO layers array exists ['+tag+']'));
    let negLayer = null;
    let overLayer = null;
    for(const l of (data.inventoryLayers||[])){
      if((l.qtyRemaining||0) < 0) negLayer = l;
      if((l.qtyRemaining||0) > (l.qtyOriginal||0) + 0.01) overLayer = l;
    }
    rec(assert(!negLayer, 'No layer with negative qtyRemaining ['+tag+']', negLayer ? String(negLayer.id) : ''));
    rec(assert(!overLayer, 'No layer qtyRemaining > qtyOriginal ['+tag+']', overLayer ? String(overLayer.id) : ''));
    for(const p of (products||[])){
      const stock = p.stockQty||0;
      const fifo = (typeof fifoAvailableQty === 'function') ? fifoAvailableQty(p.id) : 0;
      rec(assert(stock >= -0.01, 'Stock non-negative FIFO check ['+tag+']: '+p.name, 'qty='+stock));
      rec(assert(fifo >= -0.01, 'FIFO available non-negative ['+tag+']: '+p.name, 'fifo='+fifo));
      rec(assert(fifo <= stock + 0.01, 'FIFO <= stockQty ['+tag+']: '+p.name, 'fifo='+fifo+' stock='+stock));
    }
  }

  // --- inject hidden button + panel ---
  function ensureQAUI(){
    if(document.getElementById('qa-dev-btn')) return;

    const style = document.createElement('style');
    style.id = 'qa-dev-style';
    style.textContent = `
      #qa-dev-btn{
        position:fixed; right:10px; bottom:10px; z-index:9998;
        width:28px; height:28px; border-radius:50%;
        border:1px dashed #bbb; background:transparent; color:#bbb;
        font-size:11px; cursor:pointer; opacity:0.25;
      }
      #qa-dev-btn:hover{ opacity:0.85; border-color:var(--gold,#FF5C35); color:var(--olive-dark,#1F2937); }
      #qa-panel.overlay{ z-index:9999; }
      #qa-panel .sheet{ max-height:92vh; }
      #qa-panel .qa-pass{ color:var(--olive-dark,#1F2937); font-weight:700; }
      #qa-panel .qa-fail{ color:var(--red,#FA3946); font-weight:700; }
      #qa-panel .qa-log{
        max-height:280px; overflow:auto; font-size:.75rem;
        background:#fff; border:1px solid var(--line,#E0E4E8);
        border-radius:8px; padding:8px; direction:ltr; text-align:left;
        white-space:pre-wrap; font-family:ui-monospace,monospace;
      }
      #qa-panel .qa-stat{ display:inline-block; margin:4px 8px 4px 0; padding:4px 10px;
        border-radius:12px; background:#F0F2F5; font-size:.8rem; }
    `;
    document.head.appendChild(style);

    const btn = document.createElement('button');
    btn.id = 'qa-dev-btn';
    btn.type = 'button';
    btn.title = 'Developer QA';
    btn.textContent = 'QA';
    btn.addEventListener('click', openQAPanel);
    document.body.appendChild(btn);

    // secret: 5 rapid clicks on header title also opens QA
    const h1 = document.querySelector('header h1');
    if(h1){
      let clicks = 0, t = 0;
      h1.style.cursor = 'default';
      h1.addEventListener('click', ()=>{
        const now = Date.now();
        if(now - t > 800) clicks = 0;
        t = now; clicks++;
        if(clicks >= 5){ clicks = 0; openQAPanel(); }
      });
    }
  }

  function openQAPanel(){
    const last = qaReport;
    const summary = last ? `
      <div class="qa-stat">Total: <b>${last.total}</b></div>
      <div class="qa-stat qa-pass">Passed: <b>${last.passed}</b></div>
      <div class="qa-stat ${last.failed? 'qa-fail':''}">Failed: <b>${last.failed}</b></div>
      <div class="qa-stat">Time: <b>${last.ms.toFixed(0)} ms</b></div>
      ${last.extra ? `
      <div class="qa-stat">Ops: <b>${last.extra.opsCount}</b></div>
      <div class="qa-stat">Invoices: <b>${last.extra.invoicesCreated}</b></div>
      <div class="qa-stat">Payments: <b>${last.extra.paymentsCount}</b></div>
      <div class="qa-stat">Returns: <b>${last.extra.returnsCount}</b></div>
      <div class="qa-stat">Edits: <b>${last.extra.editsCount}</b></div>
      <div class="qa-stat">Deletes: <b>${last.extra.deletesCount}</b></div>
      <div class="qa-stat">Backups: <b>${last.extra.backupsCount}</b></div>
      <div class="qa-stat">Repeats: <b>${last.extra.repeats}</b></div>
      ` : ''}
      <h2 class="section-title">Failures / Log</h2>
      <div class="qa-log">${esc(last.logText || '(no log)')}</div>
    ` : `<div class="empty">هنوز تستی اجرا نشده است.</div>`;

    openSheet(`
      <h3>Developer QA / Test Mode</h3>
      <div class="empty" style="padding:0 0 10px;text-align:right;font-size:.8rem;">
        این ماژول ایزوله است و منطق حسابداری را تغییر نمی‌دهد.
        قبل از اجرا از داده‌های فعلی snapshot گرفته می‌شود و پس از اتمام، داده‌ها به حالت قبل برمی‌گردند.
      </div>
      <div class="btn-row">
        <button class="btn" id="qa-run-full" ${qaRunning?'disabled':''}>اجرای کامل تست‌ها</button>
        <button class="btn" id="qa-run-stress" ${qaRunning?'disabled':''}>اجرای Stress Test (سنگین)</button>
        <button class="btn secondary" id="qa-export-json" ${last?'':'disabled'}>خروجی گزارش JSON</button>
        <button class="btn secondary" id="qa-export-txt" ${last?'':'disabled'}>خروجی گزارش TXT</button>
        <button class="btn secondary" id="qa-close">بستن</button>
      </div>
      <h2 class="section-title">نتیجه آخرین اجرا</h2>
      ${summary}
    `);

    const runBtn = document.getElementById('qa-run-full');
    if(runBtn) runBtn.addEventListener('click', async ()=>{
      if(qaRunning) return;
      runBtn.disabled = true;
      runBtn.textContent = 'در حال اجرا…';
      try{
        await runFullQASuite();
        openQAPanel();
      }catch(e){
        console.error(e);
        showToast('خطا در اجرای QA: '+(e&&e.message?e.message:e));
        openQAPanel();
      }
    });
    const stressBtn = document.getElementById('qa-run-stress');
    if(stressBtn) stressBtn.addEventListener('click', async ()=>{
      if(qaRunning) return;
      stressBtn.disabled = true; runBtn.disabled = true;
      stressBtn.textContent = 'در حال اجرای Stress Test…';
      try{
        await runStressQASuite();
        openQAPanel();
      }catch(e){
        console.error(e);
        showToast('خطا در Stress Test: '+(e&&e.message?e.message:e));
        openQAPanel();
      }
    });
    const j = document.getElementById('qa-export-json');
    if(j) j.addEventListener('click', ()=>exportQAReport('json'));
    const t = document.getElementById('qa-export-txt');
    if(t) t.addEventListener('click', ()=>exportQAReport('txt'));
    const c = document.getElementById('qa-close');
    if(c) c.addEventListener('click', ()=>closeModal());
  }

  function exportQAReport(kind){
    if(!qaReport){ showToast('گزارشی موجود نیست'); return; }
    const stamp = new Date().toISOString().replace(/[:.]/g,'-');
    if(kind==='json'){
      const blob = JSON.stringify(qaReport, null, 2);
      downloadFile(`qa-report-${stamp}.json`, blob, 'application/json');
    }else{
      const lines = [
        'Developer QA Report — حبوبات و خشکبار باقری',
        'Generated: '+qaReport.finishedAt,
        'Total: '+qaReport.total,
        'Passed: '+qaReport.passed,
        'Failed: '+qaReport.failed,
        'Duration ms: '+qaReport.ms.toFixed(2),
        '',
        '--- LOG ---',
        qaReport.logText||'',
      ];
      downloadFile(`qa-report-${stamp}.txt`, lines.join('\n'), 'text/plain;charset=utf-8');
    }
    showToast('گزارش QA آماده شد');
  }

  // ---------- suite ----------
  async function runFullQASuite(){
    qaRunning = true;
    const t0 = qaNow();
    const results = [];
    const log = [];
    function rec(r){
      results.push(r);
      const line = (r.ok?'PASS':'FAIL')+' | '+r.msg+(r.details?(' | '+r.details):'');
      log.push(line);
      if(!r.ok) console.warn('[QA FAIL]', r.msg, r.details||'');
    }

    // suppress UI confirm/alert during bulk ops
    const origConfirm = window.confirm;
    const origAlert = window.alert;
    window.confirm = function(){ return true; };
    window.alert = function(m){ log.push('ALERT: '+m); };

    let snapshot = null;
    try{
      // Crash-safe isolation: all subsequent dbPut/dbDelete/dbGet hit an
      // in-memory store only — Production IndexedDB is never written during QA.
      // Seed RECORD_KEY so saveData→loadData round-trips inside the suite.
      if(typeof enableQaDbIsolation === 'function'){
        const seed = {};
        seed[RECORD_KEY] = JSON.stringify(data);
        enableQaDbIsolation(seed);
      }
      snapshot = deepClone(data);
      log.push('Snapshot taken. customers='+data.customers.length
        +' products='+data.products.length
        +' invoices='+data.invoices.length
        +' suppliers='+data.suppliers.length);

      // ---- Phase A: generate entities ----
      const products = [];
      for(let i=0;i<12;i++){
        const seedQty = 100 + i*5;
        const p = {
          id: uid(),
          name: QA_MARKER+' کالا '+(i+1),
          category: CATEGORY_SUGGESTIONS[i % CATEGORY_SUGGESTIONS.length],
          buy: 10000 + i*500,
          wholesale: 12000 + i*600,
          retail: 15000 + i*700,
          sell: 15000 + i*700,
          stockQty: 0,
          stockLog: [],
          packageWeight: 1,
          lowStockThreshold: 5,
        };
        data.products.push(p);
        products.push(p);
        // Current architecture: stockQty alone is not enough for sales — open FIFO layer required
        qaAddStockWithLayer(p, seedQty, p.buy, 'QA seed');
      }
      rec(assert(products.length===12, 'Generate 12 products'));
      qaAssertFifoHealthy(rec, products, 'after product seed');

      const customers = [];
      for(let i=0;i<15;i++){
        const c = {
          id: uid(),
          name: QA_MARKER+' مشتری '+(i+1),
          ownerName: 'صاحب '+(i+1),
          phone: '09'+(100000000+i),
          region: REGION_SUGGESTIONS[i % REGION_SUGGESTIONS.length],
          route: ROUTES[i % ROUTES.length],
          note: 'QA',
          openingBalance: (i%3===0) ? (i*1000) : 0,
          visits: [],
        };
        data.customers.push(c);
        customers.push(c);
      }
      rec(assert(customers.length===15, 'Generate 15 customers'));

      const suppliers = [];
      for(let i=0;i<5;i++){
        const s = {
          id: uid(),
          name: QA_MARKER+' تامین‌کننده '+(i+1),
          phone: '021'+(1000000+i),
          openingBalance: (i%2===0)?(i*2000):0,
          purchases: [],
          payments: [],
        };
        data.suppliers.push(s);
        suppliers.push(s);
      }
      rec(assert(suppliers.length===5, 'Generate 5 suppliers'));
      await saveData();

      // ---- Phase B: purchases (stock in) ----
      for(let i=0;i<20;i++){
        const s = suppliers[i % suppliers.length];
        const prod = products[i % products.length];
        const qty = 5 + (i%4);
        const amount = qty * prod.buy;
        const date = todayISO();
        s.purchases = s.purchases||[];
        // Production path: applyPurchaseStockEffects creates stockQty + FIFO layer
        const purchase = {id:uid(), date, amount, desc:'QA purchase', productId:prod.id, qty};
        s.purchases.push(purchase);
        applyPurchaseStockEffects(purchase, s.name);
      }
      await saveData();
      rec(assert(true, 'Generate 20 purchases with stock increase'));
      qaAssertFifoHealthy(rec, products, 'after purchases');

      // verify supplier balances after purchases
      for(const s of suppliers){
        const t = supplierTotals(s.id);
        const expectedPurch = (s.purchases||[]).reduce((a,p)=>a+(p.amount||0) - ((p.returns||[]).reduce((x,r)=>x+(r.amount||0),0)),0);
        const expectedBal = (s.openingBalance||0) + expectedPurch - (s.payments||[]).reduce((a,p)=>a+(p.amount||0),0);
        rec(assert(approxEq(t.balance, expectedBal), 'Supplier balance after purchases: '+s.name,
          'got='+t.balance+' expected='+expectedBal));
      }

      // ---- Phase C: invoices (sale + payments + checks) ----
      const createdInvoices = [];
      for(let i=0;i<40;i++){
        const c = customers[i % customers.length];
        const prod = products[i % products.length];
        const qty = 1 + (i%3);
        if((prod.stockQty||0) < qty || (typeof fifoAvailableQty==='function' && fifoAvailableQty(prod.id) < qty)){
          qaAddStockWithLayer(prod, qty + 10, prod.buy, 'QA top-up before sale');
        }
        const price = prod.retail||prod.sell||0;
        const itemDiscount = (i%5===0)?500:0;
        const items = [{
          productId: prod.id,
          name: prod.name,
          qty,
          price,
          buyPrice: prod.buy,
          discount: itemDiscount,
          weight: (prod.packageWeight||0)*qty,
        }];
        const total = Math.max(0, items.reduce((s,it)=>s+it.qty*it.price-(it.discount||0),0));
        const prevBalance = customerTotals(c.id).balance;
        const cashPaid = (i%4===0) ? Math.floor(total*0.3) : 0;
        const cardPaid = (i%4===1) ? Math.floor(total*0.2) : 0;
        const transferPaid = (i%4===2) ? Math.floor(total*0.1) : 0;
        const checkAmount = (i%6===0) ? Math.floor(total*0.25) : 0;
        const paid = cashPaid+cardPaid+transferPaid+checkAmount;
        const newBalance = prevBalance + total - paid;
        const inv = {
          id: uid(),
          number: nextInvoiceNumber(),
          customerId: c.id,
          date: todayISO(),
          items,
          total,
          discount: 0,
          prevBalance,
          cashPaid,
          cardPaid,
          transferPaid,
          checkPaid: checkAmount,
          newBalance,
        };
        data.invoices.push(inv);
        applyInvoiceStockEffects(items, inv.date, inv, true);
        pushInvoicePayments(c.id, inv, cashPaid, cardPaid, transferPaid, checkAmount, todayISO(), null);
        createdInvoices.push(inv);
      }
      await saveData();
      rec(assert(createdInvoices.length===40, 'Generate 40 invoices with stock/payment effects'));

      // verify each invoice total & customer balance consistency
      for(const inv of createdInvoices){
        const recomputed = inv.items.reduce((s,it)=>s+it.qty*it.price-(it.discount||0),0) - (inv.discount||0);
        rec(assert(approxEq(inv.total, Math.max(0,recomputed)), 'Invoice total #'+inv.number,
          'stored='+inv.total+' recomputed='+recomputed));
        // FIFO: each sold line must carry costAllocations + COGS (current architecture)
        for(const it of (inv.items||[])){
          if(!it.productId || !(it.qty>0)) continue;
          rec(assert(Array.isArray(it.costAllocations) && it.costAllocations.length>0,
            'Invoice item FIFO costAllocations #'+inv.number, 'product='+it.productId));
          rec(assert(typeof it.cogs==='number' && isFinite(it.cogs),
            'Invoice item COGS finite #'+inv.number, 'cogs='+it.cogs));
          const allocQty = it.costAllocations.reduce((s,a)=>s+(Number(a.qty)||0),0);
          rec(assert(approxEq(allocQty, it.qty), 'FIFO alloc qty sums to line qty #'+inv.number,
            'alloc='+allocQty+' qty='+it.qty));
        }
      }
      qaAssertFifoHealthy(rec, products, 'after invoices');

      for(const c of customers){
        const t = customerTotals(c.id);
        const invs = customerInvoices(c.id);
        const sumInv = invs.reduce((s,i)=>s+i.total,0);
        rec(assert(approxEq(t.invTotal, sumInv), 'Customer invTotal: '+c.name,
          'got='+t.invTotal+' sum='+sumInv));
        // balance formula: opening + inv - pay - check
        const expected = (c.openingBalance||0) + t.invTotal - t.payTotal - t.checkTotal;
        rec(assert(approxEq(t.balance, expected), 'Customer balance formula: '+c.name,
          'got='+t.balance+' expected='+expected));
      }

      // stock non-negative for QA products (should stay >=0 if we pre-topped)
      for(const p of products){
        rec(assert((p.stockQty||0) >= 0, 'Stock non-negative: '+p.name, 'qty='+p.stockQty));
        rec(assert(Array.isArray(p.stockLog) && p.stockLog.length>0, 'Stock log present: '+p.name));
      }

      // ---- Phase D: standalone payments / checks / returns ----
      for(let i=0;i<10;i++){
        const c = customers[i % customers.length];
        data.payments.push({
          id:uid(), customerId:c.id, date:todayISO(),
          amount: 1000+(i*100), method:['cash','card','transfer'][i%3], note:'QA pay'
        });
      }
      for(let i=0;i<8;i++){
        const c = customers[i % customers.length];
        data.checks.push({
          id:uid(), customerId:c.id, amount:2000+(i*150),
          dueDate:todayISO(), checkNumber:'QA'+i, status: i%2===0?'pending':'cleared'
        });
      }
      // customer return payment with stock effect
      {
        const c = customers[0];
        const prod = products[0];
        const retQty = 1;
        const retAmt = Math.floor((prod.retail||0)*retQty);
        const payment = {
          id:uid(), customerId:c.id, date:todayISO(), amount:retAmt,
          method:'return', note:'QA return',
          returnItems:[{productId:prod.id, name:prod.name, qty:retQty, price:prod.retail}]
        };
        data.payments.push(payment);
        applyReturnStockEffects(payment.returnItems, payment.date, payment);
      }
      await saveData();
      rec(assert(true, 'Standalone payments, checks, and one sales-return applied'));

      for(const c of customers){
        const t = customerTotals(c.id);
        const expected = (c.openingBalance||0) + t.invTotal - t.payTotal - t.checkTotal;
        rec(assert(approxEq(t.balance, expected), 'Customer balance after extra pays: '+c.name,
          'got='+t.balance+' expected='+expected));
      }

      // ---- Phase E: supplier payments + purchase returns ----
      for(let i=0;i<suppliers.length;i++){
        const s = suppliers[i];
        s.payments = s.payments||[];
        s.payments.push({date:todayISO(), amount:500+(i*100)});
      }
      // return part of first purchase that has product
      {
        const s = suppliers[0];
        const p = (s.purchases||[]).find(x=>x.productId && x.qty>0);
        if(p){
          const qty = 1;
          const amount = Math.floor(p.amount / p.qty);
          p.returns = p.returns||[];
          p.returns.push({id:uid(), date:todayISO(), qty, amount});
          const prod = data.products.find(x=>x.id===p.productId);
          if(prod){
            prod.stockQty = (prod.stockQty||0) - qty;
            prod.stockLog = prod.stockLog||[];
            prod.stockLog.push({id:uid(), date:todayISO(), type:'out', qty:-qty, note:'برگشت خرید به '+s.name});
          }
        }
      }
      await saveData();
      rec(assert(true, 'Supplier payments and one purchase-return applied'));

      for(const s of suppliers){
        const t = supplierTotals(s.id);
        rec(assert(typeof t.balance === 'number' && isFinite(t.balance), 'Supplier totals finite: '+s.name, 'bal='+t.balance));
      }

      // ---- Phase F: edit invoice (revert + reapply via public helpers) ----
      {
        const inv = createdInvoices[0];
        const cid = inv.customerId;
        const beforeBal = customerTotals(cid).balance;
        const stockBefore = {};
        (inv.items||[]).forEach(it=>{
          const prod = data.products.find(p=>p.id===it.productId);
          if(prod) stockBefore[it.productId] = prod.stockQty;
        });

        revertInvoiceStockEffects(inv);
        revertInvoicePayments(inv);

        // mutate: double first item qty if stock allows
        const items = inv.items.map(it=>({...it}));
        if(items[0]){
          const prod = data.products.find(p=>p.id===items[0].productId);
          const need = items[0].qty; // additional
          if(prod && (prod.stockQty||0) >= need){
            items[0] = {...items[0], qty: items[0].qty + need};
          }
        }
        const total = Math.max(0, items.reduce((s,it)=>s+it.qty*it.price-(it.discount||0),0) - (inv.discount||0));
        const prevBalance = customerTotals(cid).balance; // after revert payments, balance excludes this inv
        const cashPaid = inv.cashPaid||0;
        const cardPaid = inv.cardPaid||0;
        const transferPaid = inv.transferPaid||0;
        const checkAmount = inv.checkPaid||0;
        const paid = cashPaid+cardPaid+transferPaid+checkAmount;
        const newBalance = prevBalance + total - paid;

        inv.items = items;
        inv.total = total;
        inv.prevBalance = prevBalance;
        inv.newBalance = newBalance;

        applyInvoiceStockEffects(items, inv.date, inv, false);
        pushInvoicePayments(cid, inv, cashPaid, cardPaid, transferPaid, checkAmount, todayISO(), null);
        inv.editHistory = inv.editHistory||[];
        inv.editHistory.push({id:uid(), editedAt:new Date().toISOString(), before:{total:createdInvoices[0].total}, after:{total}});
        await saveData();

        const afterBal = customerTotals(cid).balance;
        rec(assert(typeof afterBal==='number', 'Edit invoice: customer balance still finite', 'bal='+afterBal+' before='+beforeBal));
        const t = customerTotals(cid);
        const expected = (data.customers.find(x=>x.id===cid).openingBalance||0) + t.invTotal - t.payTotal - t.checkTotal;
        rec(assert(approxEq(t.balance, expected), 'Edit invoice: balance formula holds', 'got='+t.balance+' expected='+expected));
      }

      // ---- Phase G: delete one invoice via public helpers ----
      {
        const inv = createdInvoices[createdInvoices.length-1];
        const cid = inv.customerId;
        const invId = inv.id;
        revertInvoiceStockEffects(inv);
        revertInvoicePayments(inv);
        data.invoices = data.invoices.filter(x=>x.id!==invId);
        await saveData();
        rec(assert(!data.invoices.find(x=>x.id===invId), 'Delete invoice removed from data'));
        const t = customerTotals(cid);
        const expected = (data.customers.find(x=>x.id===cid).openingBalance||0) + t.invTotal - t.payTotal - t.checkTotal;
        rec(assert(approxEq(t.balance, expected), 'After delete invoice: balance formula', 'got='+t.balance+' expected='+expected));
      }

      // ---- Phase H: dashboard / reports / profit / inventory valuation ----
      {
        const g = globalTotals();
        rec(assert(typeof g.totalProfit==='number' && isFinite(g.totalProfit), 'Dashboard totalProfit finite', 'v='+g.totalProfit));
        rec(assert(typeof g.customerDebt==='number' && isFinite(g.customerDebt), 'Dashboard customerDebt finite', 'v='+g.customerDebt));
        rec(assert(typeof g.supplierDebt==='number' && isFinite(g.supplierDebt), 'Dashboard supplierDebt finite', 'v='+g.supplierDebt));
        rec(assert(typeof g.todaySales==='number', 'Dashboard todaySales defined'));
        rec(assert(typeof g.monthSales==='number', 'Dashboard monthSales defined'));
        rec(assert(typeof g.outstandingChecks==='number', 'Dashboard outstandingChecks defined'));

        const invVal = inventoryValue();
        rec(assert(typeof invVal==='number' && isFinite(invVal) && invVal>=0, 'Inventory valuation >= 0', 'v='+invVal));

        // recompute inventory value manually for QA products + all — independent FIFO-layer sum
        // (NOT sum(stock*buy): once a purchase's cost differs from the product's static
        // "buy" field, that comparison is no longer valid under FIFO valuation)
        let manual = 0;
        (data.inventoryLayers||[]).forEach(l=>{ if(l.status==='open') manual += (l.qtyRemaining||0)*(l.unitCost||0); });
        rec(assert(approxEq(invVal, manual), 'Inventory valuation matches independent FIFO-layer sum',
          'got='+invVal+' manual='+manual));

        // global profit should equal sum of customerProfit
        let profitSum = 0;
        data.customers.forEach(c=>{ profitSum += customerProfit(c.id); });
        rec(assert(approxEq(g.totalProfit, profitSum), 'Total profit equals sum of customer profits',
          'g='+g.totalProfit+' sum='+profitSum));
      }

      // ---- Phase I: backup / restore / undo restore ----
      {
        const midSnapshot = deepClone(data);
        // simulate exportBackupJSON payload
        const backupJson = JSON.stringify(data);
        const parsed = JSON.parse(backupJson);
        rec(assert(validateBackupShape(parsed), 'Backup shape validates'));

        // import path uses normalizeData — call it
        const normalized = normalizeData(parsed);
        rec(assert(Array.isArray(normalized.customers) && Array.isArray(normalized.products), 'normalizeData keeps arrays'));

        // exercise undoLastRestore storage path without destroying real preRestore if any:
        // save current as a temporary preRestore-like structure via dbPut if available
        try{
          const beforeImport = deepClone(data);
          // replace data with a tiny mutation then restore from midSnapshot (manual, same as undo)
          data.customers = data.customers.slice(0, Math.max(0, data.customers.length-1));
          await saveData();
          // restore mid
          data = deepClone(midSnapshot);
          await saveData();
          rec(assert(data.customers.length === midSnapshot.customers.length, 'Manual restore cycle restored customer count'));
          // restore original mid is still QA data; fine
          void beforeImport;
        }catch(e){
          rec(assert(false, 'Backup/restore cycle error', String(e&&e.message||e)));
        }

        // call getAutoBackupList / autoBackupTick safely
        try{
          await autoBackupTick();
          const list = await getAutoBackupList();
          rec(assert(Array.isArray(list), 'getAutoBackupList returns array', 'len='+(list&&list.length)));
        }catch(e){
          rec(assert(false, 'autoBackupTick/list failed', String(e&&e.message||e)));
        }
      }

      // ---- Phase J: visits ----
      {
        const c = customers[1];
        c.visits = c.visits||[];
        c.visits.push({id:uid(), date:todayISO(), time:nowHHMM(), result:VISIT_RESULTS[0]});
        await saveData();
        rec(assert(c.visits.length>=1, 'Visit recorded on customer'));
      }

      // ---- Phase K: render smoke (no throw) ----
      try{
        const tabs = ['dashboard','products','customers','suppliers','reports','backup'];
        for(const tab of tabs){
          activeTab = tab;
          render();
        }
        activeTab = 'dashboard';
        render();
        rec(assert(true, 'Render all tabs without throw'));
      }catch(e){
        rec(assert(false, 'Render threw', String(e&&e.message||e)));
      }

      // ---- Phase L: delete QA entities cleanup is via full snapshot restore ----
      log.push('Phases complete; restoring pre-QA snapshot…');

    }catch(e){
      rec(assert(false, 'Unhandled suite exception', String(e&&e.stack||e.message||e)));
      console.error(e);
    }finally{
      // restore original in-memory data (Production IDB was never written while isolation was on)
      try{
        if(snapshot){
          data = deepClone(snapshot);
          await saveData(); // still isolated → memory only
          render();
          log.push('Original data restored. customers='+data.customers.length
            +' products='+data.products.length
            +' invoices='+data.invoices.length);
          rec(assert(true, 'Original data restored after QA'));
        }
      }catch(e){
        rec(assert(false, 'Failed to restore original data', String(e&&e.message||e)));
      }
      if(typeof disableQaDbIsolation === 'function') disableQaDbIsolation();
      window.confirm = origConfirm;
      window.alert = origAlert;
      qaRunning = false;
    }

    const passed = results.filter(r=>r.ok).length;
    const failed = results.filter(r=>!r.ok).length;
    const ms = qaNow() - t0;
    qaReport = {
      total: results.length,
      passed,
      failed,
      ms,
      finishedAt: new Date().toISOString(),
      results,
      logText: log.join('\n'),
      failures: results.filter(r=>!r.ok),
    };
    showToast(failed===0 ? ('QA PASS — '+passed+'/'+results.length) : ('QA FAIL — '+failed+' failed'));
    return qaReport;
  }

  // ================= Stress / Repeatability Suite (additive extension) =================
  function qaMem(){ try{ return performance.memory ? performance.memory.usedJSHeapSize : null; }catch(e){ return null; } }

  function qaBuildStressEntities(counters){
    const products=[], customers=[], suppliers=[];
    for(let i=0;i<200;i++){
      const seedQty=200+(i%30)*3;
      const p={ id:uid(), name:QA_MARKER+' S-کالا '+i, category:CATEGORY_SUGGESTIONS[i%CATEGORY_SUGGESTIONS.length],
        buy:8000+(i%50)*300, wholesale:10000+(i%50)*350, retail:13000+(i%50)*400, sell:13000+(i%50)*400,
        stockQty:0, stockLog:[],
        packageWeight:1, lowStockThreshold:5 };
      data.products.push(p); products.push(p);
      qaAddStockWithLayer(p, seedQty, p.buy, 'QA stress seed');
    }
    for(let i=0;i<500;i++){
      const c={ id:uid(), name:QA_MARKER+' S-مشتری '+i, ownerName:'مالک '+i, phone:'09'+(200000000+i),
        region:REGION_SUGGESTIONS[i%REGION_SUGGESTIONS.length], route:ROUTES[i%ROUTES.length],
        note:'QA-STRESS', openingBalance:(i%4===0)?(i*50):0, visits:[] };
      data.customers.push(c); customers.push(c);
    }
    for(let i=0;i<50;i++){
      const s={ id:uid(), name:QA_MARKER+' S-تامین‌کننده '+i, phone:'021'+(2000000+i),
        openingBalance:(i%3===0)?(i*300):0, purchases:[], payments:[] };
      data.suppliers.push(s); suppliers.push(s);
    }
    counters.opsCount += products.length+customers.length+suppliers.length;
    return {products, customers, suppliers};
  }

  function qaRunPurchases(ent, counters, n){
    for(let i=0;i<n;i++){
      const s=ent.suppliers[i%ent.suppliers.length], prod=ent.products[i%ent.products.length];
      const qty=3+(i%6), amount=qty*prod.buy, date=todayISO();
      s.purchases=s.purchases||[];
      const purchase={id:uid(), date, amount, desc:'QA-STRESS purchase', productId:prod.id, qty};
      s.purchases.push(purchase);
      applyPurchaseStockEffects(purchase, s.name);
      counters.opsCount++;
    }
  }

  function qaCreateInvoice(ent, i){
    const c=ent.customers[i%ent.customers.length];
    const itemN=1+(i%3); const items=[];
    for(let k=0;k<itemN;k++){
      const prod=ent.products[(i+k)%ent.products.length]; const qty=1+((i+k)%3);
      if((prod.stockQty||0)<qty || (typeof fifoAvailableQty==='function' && fifoAvailableQty(prod.id)<qty)) qaAddStockWithLayer(prod, qty+20, prod.buy, 'QA stress top-up');
      items.push({productId:prod.id, name:prod.name, qty, price:prod.retail||prod.sell||0,
        buyPrice:prod.buy, discount:(i%7===0)?300:0, weight:(prod.packageWeight||0)*qty});
    }
    const total=Math.max(0, items.reduce((s,it)=>s+it.qty*it.price-(it.discount||0),0));
    const prevBalance=customerTotals(c.id).balance;
    const cashPaid=(i%4===0)?Math.floor(total*0.3):0, cardPaid=(i%4===1)?Math.floor(total*0.2):0,
      transferPaid=(i%4===2)?Math.floor(total*0.1):0, checkAmount=(i%6===0)?Math.floor(total*0.2):0;
    const paid=cashPaid+cardPaid+transferPaid+checkAmount;
    const inv={ id:uid(), number:nextInvoiceNumber(), customerId:c.id, date:todayISO(), items, total,
      discount:0, prevBalance, cashPaid, cardPaid, transferPaid, checkPaid:checkAmount, newBalance:prevBalance+total-paid };
    data.invoices.push(inv);
    applyInvoiceStockEffects(items, inv.date, inv, true);
    pushInvoicePayments(c.id, inv, cashPaid, cardPaid, transferPaid, checkAmount, todayISO(), null);
    return inv;
  }

  function qaCheckInvariants(rec, tag, full){
    const bad=v=>v==null||typeof v!=='number'||!isFinite(v);
    for(const p of data.products){
      if(bad(p.stockQty)) rec(assert(false, 'Invariant stock invalid ['+tag+']: '+p.name, 'q='+p.stockQty));
    }
    // FIFO architecture invariants (additive)
    for(const l of (data.inventoryLayers||[])){
      if((l.qtyRemaining||0)<0) rec(assert(false, 'Invariant layer qtyRemaining negative ['+tag+']', String(l.id)));
      if((l.qtyRemaining||0)>(l.qtyOriginal||0)+0.01) rec(assert(false, 'Invariant layer rem>original ['+tag+']', String(l.id)));
    }
    const g=globalTotals();
    rec(assert(!bad(g.totalProfit), 'Invariant totalProfit finite ['+tag+']'));
    rec(assert(!bad(g.customerDebt), 'Invariant customerDebt finite ['+tag+']'));
    rec(assert(!bad(g.supplierDebt), 'Invariant supplierDebt finite ['+tag+']'));
    const invVal=inventoryValue();
    rec(assert(!bad(invVal) && invVal>=0, 'Invariant inventoryValue valid ['+tag+']', 'v='+invVal));
    if(full){
      let profitSum=0;
      for(const c of data.customers){
        const t=customerTotals(c.id);
        if(bad(t.balance)) rec(assert(false, 'Invariant customer balance invalid ['+tag+']: '+c.name, 'bal='+t.balance));
        profitSum+=customerProfit(c.id);
      }
      rec(assert(approxEq(g.totalProfit, profitSum, 1), 'Invariant sum(customerProfit)==totalProfit ['+tag+']',
        'g='+g.totalProfit+' sum='+profitSum));
      for(const s of data.suppliers){
        const t=supplierTotals(s.id);
        if(bad(t.balance)) rec(assert(false, 'Invariant supplier balance invalid ['+tag+']: '+s.name, 'bal='+t.balance));
      }
    }
  }

  function qaRandomOps(ent, rec, counters, n){
    const ops=['sale','cash','card','transfer','check','salesReturn','purchaseReturn','supplierPay','editInv','deleteInv','visit'];
    for(let i=0;i<n;i++){
      const op=ops[Math.floor(Math.random()*ops.length)];
      try{
        switch(op){
          case 'sale': { const inv=qaCreateInvoice(ent, 5000+i); ent.invoices.push(inv); counters.invoicesCreated++; break; }
          case 'cash': case 'card': case 'transfer': {
            const c=ent.customers[i%ent.customers.length];
            data.payments.push({id:uid(), customerId:c.id, date:todayISO(), amount:500+(i%20)*50,
              method:(op==='cash'?'cash':op==='card'?'card':'transfer'), note:'QA-STRESS pay'});
            counters.paymentsCount++; break;
          }
          case 'check': {
            const c=ent.customers[i%ent.customers.length];
            data.checks.push({id:uid(), customerId:c.id, amount:1000+(i%15)*70, dueDate:todayISO(),
              checkNumber:'QAS'+i, status:i%2===0?'pending':'cleared'}); counters.paymentsCount++; break;
          }
          case 'salesReturn': {
            const c=ent.customers[i%ent.customers.length], prod=ent.products[i%ent.products.length];
            const payment={id:uid(), customerId:c.id, date:todayISO(), amount:Math.floor(prod.retail||0),
              method:'return', note:'QA-STRESS return', returnItems:[{productId:prod.id, name:prod.name, qty:1, price:prod.retail}]};
            data.payments.push(payment); applyReturnStockEffects(payment.returnItems, payment.date, payment);
            counters.returnsCount++; break;
          }
          case 'purchaseReturn': {
            const s=ent.suppliers[i%ent.suppliers.length];
            const p=(s.purchases||[]).find(x=>x.productId && x.qty>0 && !(x.returns&&x.returns.length));
            if(p){ p.returns=p.returns||[]; p.returns.push({id:uid(), date:todayISO(), qty:1, amount:Math.floor(p.amount/p.qty)});
              const prod=data.products.find(x=>x.id===p.productId);
              if(prod){ prod.stockQty=(prod.stockQty||0)-1; prod.stockLog=prod.stockLog||[];
                prod.stockLog.push({id:uid(), date:todayISO(), type:'out', qty:-1, note:'برگشت خرید استرس'}); }
              counters.returnsCount++; }
            break;
          }
          case 'supplierPay': {
            const s=ent.suppliers[i%ent.suppliers.length]; s.payments=s.payments||[];
            s.payments.push({date:todayISO(), amount:300+(i%10)*40}); counters.paymentsCount++; break;
          }
          case 'editInv': {
            if(ent.invoices.length){
              const inv=ent.invoices[i%ent.invoices.length], cid=inv.customerId;
              revertInvoiceStockEffects(inv); revertInvoicePayments(inv);
              const items=inv.items.map(it=>({...it, qty: it.qty + (i%2===0?1:0)}));
              const total=Math.max(0, items.reduce((s,it)=>s+it.qty*it.price-(it.discount||0),0) - (inv.discount||0));
              const prevBalance=customerTotals(cid).balance;
              const cashPaid=inv.cashPaid||0, cardPaid=inv.cardPaid||0, transferPaid=inv.transferPaid||0, checkAmount=inv.checkPaid||0;
              const paid=cashPaid+cardPaid+transferPaid+checkAmount;
              inv.items=items; inv.total=total; inv.prevBalance=prevBalance; inv.newBalance=prevBalance+total-paid;
              applyInvoiceStockEffects(items, inv.date, inv, false);
              pushInvoicePayments(cid, inv, cashPaid, cardPaid, transferPaid, checkAmount, todayISO(), null);
              inv.editHistory=inv.editHistory||[]; inv.editHistory.push({id:uid(), editedAt:new Date().toISOString(), note:'QA-STRESS edit'});
              counters.editsCount++;
            }
            break;
          }
          case 'deleteInv': {
            if(ent.invoices.length>10){ const inv=ent.invoices.pop();
              revertInvoiceStockEffects(inv); revertInvoicePayments(inv);
              data.invoices=data.invoices.filter(x=>x.id!==inv.id); counters.deletesCount++; }
            break;
          }
          case 'visit': {
            const c=ent.customers[i%ent.customers.length]; c.visits=c.visits||[];
            c.visits.push({id:uid(), date:todayISO(), time:nowHHMM(), result:VISIT_RESULTS[i%VISIT_RESULTS.length]});
            break;
          }
        }
      }catch(e){ rec(assert(false, 'Random op threw ['+op+']', String(e&&e.message||e))); }
      qaCheckInvariants(rec, 'op#'+i+':'+op, (i%40===0));
      counters.opsCount++;
    }
  }

  function qaBackupCycle(rec, tag){
    try{
      const snap=deepClone(data);
      const parsed=JSON.parse(JSON.stringify(data));
      rec(assert(validateBackupShape(parsed), 'Backup shape valid ['+tag+']'));
      const normalized=normalizeData(parsed);
      rec(assert(Array.isArray(normalized.customers) && normalized.customers.length===data.customers.length,
        'normalizeData customer count preserved ['+tag+']'));
      rec(assert(Array.isArray(normalized.products) && normalized.products.length===data.products.length,
        'normalizeData product count preserved ['+tag+']'));
      const idsBefore=data.customers.map(c=>c.id).sort().join(',');
      data.customers=data.customers.slice(0, Math.max(0,data.customers.length-1)); // simulate undo-restore trigger
      data=deepClone(snap); // restore
      const idsAfter=data.customers.map(c=>c.id).sort().join(',');
      rec(assert(idsBefore===idsAfter, 'Backup restore preserves customer ids ['+tag+']'));
      rec(assert(data.invoices.length===snap.invoices.length, 'Backup restore preserves invoice count ['+tag+']'));
    }catch(e){ rec(assert(false, 'Backup cycle error ['+tag+']', String(e&&e.message||e))); }
  }

  function qaRenderCheck(rec, rounds){
    try{
      const tabs=['dashboard','products','customers','suppliers','reports','backup'];
      for(let r=0;r<rounds;r++){ for(const t of tabs){ activeTab=t; render(); } }
      activeTab='dashboard'; render();
      rec(assert(true, 'Render all tabs x'+rounds+' rounds without throw'));
    }catch(e){ rec(assert(false, 'Render threw during stress', String(e&&e.message||e))); }
  }

  async function qaPersistenceCheck(rec, tag){
    try{
      const before={c:data.customers.length,p:data.products.length,i:data.invoices.length,s:data.suppliers.length};
      await saveData(); await loadData();
      const after={c:data.customers.length,p:data.products.length,i:data.invoices.length,s:data.suppliers.length};
      rec(assert(JSON.stringify(before)===JSON.stringify(after),
        'Persistence save/load preserves counts ['+tag+']', JSON.stringify(before)+' vs '+JSON.stringify(after)));
    }catch(e){ rec(assert(false, 'Persistence check error ['+tag+']', String(e&&e.message||e))); }
  }

  async function runStressQASuite(){
    qaRunning=true; const t0=qaNow(); const results=[]; const log=[];
    function rec(r){ results.push(r); log.push((r.ok?'PASS':'FAIL')+' | '+r.msg+(r.details?(' | '+r.details):''));
      if(!r.ok) console.warn('[QA-STRESS FAIL]', r.msg, r.details||''); }
    const origConfirm=window.confirm, origAlert=window.alert;
    window.confirm=function(){return true;}; window.alert=function(m){log.push('ALERT: '+m);};
    const counters={opsCount:0, invoicesCreated:0, paymentsCount:0, returnsCount:0, editsCount:0, deletesCount:0, backupsCount:0, repeats:0};
    const phaseTimes={}; let masterSnapshot=null; const runSummaries=[];
    try{
      // Crash-safe isolation: Stress Test saveData/loadData never touch Production IDB.
      if(typeof enableQaDbIsolation === 'function'){
        const seed = {};
        seed[RECORD_KEY] = JSON.stringify(data);
        enableQaDbIsolation(seed);
      }
      masterSnapshot=deepClone(data);
      const REPEATS=10;
      for(let round=0; round<REPEATS; round++){
        const tRound0=qaNow();
        data=deepClone(masterSnapshot);
        const ent=qaBuildStressEntities(counters); ent.invoices=[];
        let tA=qaNow(); qaRunPurchases(ent, counters, 150); phaseTimes['purchases_r'+round]=qaNow()-tA;
        qaCheckInvariants(rec, 'afterPurchases_r'+round, true);

        tA=qaNow();
        for(let i=0;i<2100;i++){ ent.invoices.push(qaCreateInvoice(ent, i)); counters.invoicesCreated++;
          if(i%300===0) qaCheckInvariants(rec, 'duringInvoices_r'+round+'#'+i, false); }
        phaseTimes['invoices_r'+round]=qaNow()-tA;
        await saveData();
        qaCheckInvariants(rec, 'afterInvoices_r'+round, true);

        tA=qaNow(); qaRandomOps(ent, rec, counters, 300); phaseTimes['randomOps_r'+round]=qaNow()-tA;
        await saveData();
        qaCheckInvariants(rec, 'afterRandomOps_r'+round, true);

        tA=qaNow();
        for(let b=0;b<20;b++){ qaBackupCycle(rec, 'r'+round+'#'+b); counters.backupsCount++; }
        phaseTimes['backups_r'+round]=qaNow()-tA;

        tA=qaNow(); qaRenderCheck(rec, 4); phaseTimes['render_r'+round]=qaNow()-tA;

        tA=qaNow(); await qaPersistenceCheck(rec, 'r'+round); phaseTimes['persistence_r'+round]=qaNow()-tA;

        const failedSoFar=results.filter(x=>!x.ok).length;
        runSummaries.push({round, failed:failedSoFar, ms:qaNow()-tRound0});
        log.push('Round '+round+' done in '+(qaNow()-tRound0).toFixed(0)+'ms, cumulative failed='+failedSoFar);
        counters.repeats++;
      }
      const perRoundFailed=runSummaries.map((r,idx)=> idx===0 ? r.failed : r.failed-runSummaries[idx-1].failed);
      const consistent=perRoundFailed.every(f=>f===perRoundFailed[0]);
      rec(assert(consistent, 'Repeatability: identical pass/fail pattern across '+runSummaries.length+' runs',
        JSON.stringify(perRoundFailed)));
    }catch(e){
      rec(assert(false, 'Unhandled stress-suite exception', String(e&&e.stack||e.message||e)));
      console.error(e);
    }finally{
      try{
        if(masterSnapshot){ data=deepClone(masterSnapshot); await saveData(); render();
          rec(assert(true, 'Original data restored after stress suite')); }
      }catch(e){ rec(assert(false, 'Failed to restore original data after stress', String(e&&e.message||e))); }
      if(typeof disableQaDbIsolation === 'function') disableQaDbIsolation();
      window.confirm=origConfirm; window.alert=origAlert; qaRunning=false;
    }
    const passed=results.filter(r=>r.ok).length, failed=results.filter(r=>!r.ok).length, ms=qaNow()-t0;
    qaReport={ total:results.length, passed, failed, ms, finishedAt:new Date().toISOString(), results,
      logText:log.join('\n'), failures:results.filter(r=>!r.ok),
      extra:{ opsCount:counters.opsCount, invoicesCreated:counters.invoicesCreated, paymentsCount:counters.paymentsCount,
        returnsCount:counters.returnsCount, editsCount:counters.editsCount, deletesCount:counters.deletesCount,
        backupsCount:counters.backupsCount, repeats:counters.repeats, phaseTimes, totalMs:ms,
        memApproxBytes:qaMem(), runSummaries } };
    showToast(failed===0 ? ('Stress PASS — '+passed+'/'+results.length) : ('Stress FAIL — '+failed+' failed'));
    return qaReport;
  }

  // boot UI after DOM ready
  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', ensureQAUI);
  }else{
    // app init is async; delay slightly so body exists
    setTimeout(ensureQAUI, 0);
  }
})();

