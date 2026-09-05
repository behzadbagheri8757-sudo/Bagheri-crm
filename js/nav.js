/* nav.js — SPA navigation & boot
   UI/Navigation only. Does not change accounting logic.
   Production Freeze: SPA-only navigation.
*/
/** SPA shell is the only supported application shell. */
function isSpaShell() {
  try {
    return !!(document.documentElement && document.documentElement.getAttribute('data-spa-shell') === '1');
  } catch (e) {
    return false;
  }
}

/** Dashboard href: hash on SPA shell, classic page elsewhere. */
function spaDashboardHref() { return '#/dashboard'; }

const NAV_ITEMS = [
  { id: 'dashboard', href: '#/dashboard',     label: 'داشبورد', spaPath: '/dashboard' },
  { id: 'customers', href: '#/customers', label: 'مشتریان', spaPath: '/customers' },
  { id: 'products',  href: '#/products',  label: 'اجناس', spaPath: '/products' },
  { id: 'inventory', href: '#/inventory', label: 'انبار', spaPath: '/inventory' },
  { id: 'suppliers', href: '#/suppliers', label: 'تامین‌کننده‌ها', spaPath: '/suppliers' },
  { id: 'invoices',  href: '#/invoices',  label: 'فاکتورها', spaPath: '/invoices' },
  { id: 'payments',  href: '#/payments',  label: 'پرداخت‌ها', spaPath: '/payments' },
  { id: 'checks',    href: '#/checks',    label: 'چک‌ها', spaPath: '/checks' },
  { id: 'visits',    href: '#/visits',    label: 'ویزیت', spaPath: '/visits' },
  { id: 'prospects', href: '#/prospects', label: 'ارزیابی مغازه', spaPath: '/prospects' },
  { id: 'reports',   href: '#/reports',   label: 'گزارش‌ها', spaPath: '/reports' },
  { id: 'settings',  href: '#/settings',  label: 'تنظیمات', spaPath: '/settings' },
];

/** Primary mobile bottom bar (5 items). */
const BOTTOM_NAV_ITEMS = [
  {
    id: 'dashboard',
    href: '#/dashboard',
    spaPath: '/dashboard',
    label: 'داشبورد',
    icon: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l-2 0l9 -9l9 9l-2 0"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-7"/><path d="M9 21v-6a2 2 0 0 1 2 -2h2a2 2 0 0 1 2 2v6"/></svg>'
  },
  {
    id: 'customers',
    href: '#/customers',
    spaPath: '/customers',
    label: 'مشتریان',
    icon: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round"><path d="M9 7m-4 0a4 4 0 1 0 8 0a4 4 0 1 0 -8 0"/><path d="M3 21v-2a4 4 0 0 1 4 -4h4a4 4 0 0 1 4 4v2"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/><path d="M21 21v-2a4 4 0 0 0 -3 -3.87"/></svg>'
  },
  {
    id: 'products',
    href: '#/products',
    spaPath: '/products',
    label: 'اجناس',
    icon: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l8 4.5l0 9l-8 4.5l-8 -4.5l0 -9l8 -4.5"/><path d="M12 12l8 -4.5"/><path d="M12 12l0 9"/><path d="M12 12l-8 -4.5"/><path d="M16 5.25l-8 4.5"/></svg>'
  },
  {
    id: 'invoices',
    href: '#/invoices',
    spaPath: '/invoices',
    label: 'فاکتورها',
    icon: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3v4a1 1 0 0 0 1 1h4"/><path d="M17 21h-10a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2z"/><path d="M9 7l1 0"/><path d="M9 13l6 0"/><path d="M13 17l2 0"/></svg>'
  },
  {
    id: 'more',
    href: '#more',
    label: 'بیشتر',
    icon: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0"/><path d="M12 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0"/><path d="M19 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0"/></svg>'
  },
];

/** Secondary destinations opened from «بیشتر». */
const MORE_NAV_ITEMS = [
  { id: 'inventory', href: '#/inventory', label: 'انبار', spaPath: '/inventory' },
  { id: 'suppliers', href: '#/suppliers', label: 'تأمین‌کنندگان', spaPath: '/suppliers' },
  { id: 'payments',  href: '#/payments',  label: 'پرداخت‌ها', spaPath: '/payments' },
  { id: 'checks',    href: '#/checks',    label: 'چک‌ها', spaPath: '/checks' },
  { id: 'visits',    href: '#/visits',    label: 'ویزیت مشتریان', spaPath: '/visits' },
  { id: 'prospects', href: '#/prospects', label: 'ارزیابی مغازه‌ها', spaPath: '/prospects' },
  { id: 'game',      href: '#/game',      label: 'مرکز بازی فروش', spaPath: '/game' },
  { id: 'reports',   href: '#/reports',   label: 'گزارش‌ها', spaPath: '/reports' },
  { id: 'settings',  href: '#/settings',  label: 'تنظیمات و Backup', spaPath: '/settings' },
];

function renderSharedNav(activeId){
  const nav = document.getElementById('nav');
  if(!nav) return;
  const spa = isSpaShell();
  nav.innerHTML = NAV_ITEMS.map(t => {
    const active = t.id === activeId ? ' active' : '';
    let href = t.spaPath ? '#' + t.spaPath : t.href;
    return `<a class="nav-link${active}" href="${href}" data-spa-path="${t.spaPath || ''}">${t.label}</a>`;
  }).join('');
  nav.setAttribute('aria-label', 'منوی بالای صفحه');
  nav.querySelectorAll('a[data-spa-path]').forEach(function (a) {
      const path = a.getAttribute('data-spa-path');
      if (!path) return;
      a.addEventListener('click', function (e) {
        e.preventDefault();
        if (typeof AppRouter !== 'undefined' && AppRouter.navigate) AppRouter.navigate(path);
        else location.hash = path;
      });
  });
}

function ensureBottomNavDOM(){
  if(!document.getElementById('bottom-nav')){
    const bar = document.createElement('nav');
    bar.id = 'bottom-nav';
    bar.className = 'bottom-nav';
    bar.setAttribute('aria-label', 'منوی پایین');
    document.body.appendChild(bar);
  }
  if(!document.getElementById('more-sheet-root')){
    const root = document.createElement('div');
    root.id = 'more-sheet-root';
    root.innerHTML = `
      <div class="more-overlay" id="more-overlay" hidden></div>
      <div class="more-sheet" id="more-sheet" hidden role="dialog" aria-modal="true" aria-label="منوی بیشتر">
        <div class="more-sheet-handle"></div>
        <div class="more-sheet-title">بیشتر</div>
        <div class="more-sheet-list" id="more-sheet-list"></div>
        <button type="button" class="btn secondary more-sheet-close" id="more-sheet-close">بستن</button>
      </div>`;
    document.body.appendChild(root);
    document.getElementById('more-overlay').addEventListener('click', closeMoreSheet);
    document.getElementById('more-sheet-close').addEventListener('click', closeMoreSheet);
    bindMoreSheetDragToDismiss();
  }
}

// Native-feel swipe-down-to-dismiss, started from the sheet's drag handle only
// (keeps list-item taps below untouched). Presentation-only; just calls the
// existing closeMoreSheet().
function bindMoreSheetDragToDismiss(){
  const sheet = document.getElementById('more-sheet');
  const handle = sheet && sheet.querySelector('.more-sheet-handle');
  if(!sheet || !handle) return;
  let startY = 0, deltaY = 0, dragging = false;
  handle.addEventListener('touchstart', function(e){
    dragging = true;
    startY = e.touches[0].clientY;
    sheet.style.transition = 'none';
  }, {passive:true});
  handle.addEventListener('touchmove', function(e){
    if(!dragging) return;
    deltaY = e.touches[0].clientY - startY;
    if(deltaY > 0) sheet.style.transform = 'translateY(' + deltaY + 'px)';
  }, {passive:true});
  handle.addEventListener('touchend', function(){
    if(!dragging) return;
    dragging = false;
    sheet.style.transition = '';
    sheet.style.transform = '';
    if(deltaY > 60) closeMoreSheet();
    deltaY = 0;
  });
}

function isMoreSectionActive(activeId){
  return MORE_NAV_ITEMS.some(t => t.id === activeId);
}

function pinBottomNav(){
  const el = document.getElementById('bottom-nav');
  if(!el) return;
  try{
    if(window.visualViewport){
      const vv = window.visualViewport;
      const gap = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      el.style.setProperty('bottom', gap + 'px', 'important');
    }else{
      el.style.setProperty('bottom', '0px', 'important');
    }
  }catch(e){
    /* ignore — bar still uses CSS bottom:0 */
  }
}

function ensureBottomNavPinned(){
  if(ensureBottomNavPinned._bound) return;
  ensureBottomNavPinned._bound = true;
  let ticking = false;
  function schedule(){
    if(ticking) return;
    ticking = true;
    requestAnimationFrame(function(){
      ticking = false;
      pinBottomNav();
    });
  }
  window.addEventListener('resize', schedule, {passive:true});
  window.addEventListener('scroll', schedule, {passive:true});
  if(window.visualViewport){
    window.visualViewport.addEventListener('resize', schedule, {passive:true});
    window.visualViewport.addEventListener('scroll', schedule, {passive:true});
  }
  window.addEventListener('pageshow', schedule, {passive:true});
  window.addEventListener('orientationchange', function(){
    setTimeout(schedule, 50);
  }, {passive:true});
}

function renderBottomNav(activeId){
  ensureBottomNavDOM();
  const bar = document.getElementById('bottom-nav');
  if(!bar) return;
  const moreActive = isMoreSectionActive(activeId);
  const spa = isSpaShell();
  bar.innerHTML = BOTTOM_NAV_ITEMS.map(t => {
    let active = false;
    if(t.id === 'more') active = moreActive;
    else active = t.id === activeId;
    const cls = 'bottom-nav-item' + (active ? ' active' : '');
    if(t.id === 'more'){
      return `<button type="button" class="${cls}" data-bottom-more="1" aria-label="بیشتر">
        <span class="bn-ico">${t.icon}</span>
        <span class="bn-label">${t.label}</span>
      </button>`;
    }
    let href = t.href;
    if (spa && t.spaPath) href = '#' + t.spaPath;
    return `<a class="${cls}" href="${href}" data-spa-path="${t.spaPath || ''}">
      <span class="bn-ico">${t.icon}</span>
      <span class="bn-label">${t.label}</span>
    </a>`;
  }).join('');

  if (spa) {
    bar.querySelectorAll('a[data-spa-path]').forEach(function (a) {
      const path = a.getAttribute('data-spa-path');
      if (!path) return;
      a.addEventListener('click', function (e) {
        e.preventDefault();
        if (typeof AppRouter !== 'undefined' && AppRouter.navigate) AppRouter.navigate(path);
        else location.hash = path;
      });
    });
  }

  const moreBtn = bar.querySelector('[data-bottom-more]');
  if(moreBtn){
    moreBtn.addEventListener('click', function(e){
      e.preventDefault();
      openMoreSheet(activeId);
    });
  }

  fillMoreSheetList(activeId);

  ensureBottomNavPinned();
  pinBottomNav();
}

function fillMoreSheetList(activeId){
  const list = document.getElementById('more-sheet-list');
  if(!list) return;
  const spa = isSpaShell();
  list.innerHTML = MORE_NAV_ITEMS.map(t => {
    const active = t.id === activeId ? ' active' : '';
    let href = t.href;
    if (spa && t.spaPath) href = '#' + t.spaPath;
    return `<a class="more-sheet-item${active}" href="${href}" data-spa-path="${t.spaPath || ''}">${t.label}</a>`;
  }).join('');
  if (spa) {
    list.querySelectorAll('a[data-spa-path]').forEach(function (a) {
      const path = a.getAttribute('data-spa-path');
      if (!path) return;
      a.addEventListener('click', function (e) {
        e.preventDefault();
        closeMoreSheet();
        if (typeof AppRouter !== 'undefined' && AppRouter.navigate) AppRouter.navigate(path);
        else location.hash = path;
      });
    });
  }
}

let _moreSheetHideTimer = null;

function openMoreSheet(activeId){
  ensureBottomNavDOM();
  const overlay = document.getElementById('more-overlay');
  const sheet = document.getElementById('more-sheet');
  if(!overlay || !sheet) return;
  // Cancel any pending hide-after-transition timer from a just-closed sheet —
  // otherwise a rapid close→reopen (tap close, immediately tap "بیشتر" again)
  // leaves that timer alive, and it later fires `hidden = true` on the sheet
  // we just reopened, making it silently disappear a moment after opening.
  if(_moreSheetHideTimer){ clearTimeout(_moreSheetHideTimer); _moreSheetHideTimer = null; }
  fillMoreSheetList(activeId);
  overlay.hidden = false;
  sheet.hidden = false;
  requestAnimationFrame(() => {
    overlay.classList.add('show');
    sheet.classList.add('show');
  });
  document.body.classList.add('more-open');
  try{ window.__scrollLock && window.__scrollLock.lock(); }catch(_e){}
}

function closeMoreSheet(){
  const overlay = document.getElementById('more-overlay');
  const sheet = document.getElementById('more-sheet');
  if(overlay){ overlay.classList.remove('show'); }
  if(sheet){ sheet.classList.remove('show'); }
  document.body.classList.remove('more-open');
  try{ window.__scrollLock && window.__scrollLock.unlock(); }catch(_e){}
  if(_moreSheetHideTimer){ clearTimeout(_moreSheetHideTimer); }
  _moreSheetHideTimer = setTimeout(() => {
    _moreSheetHideTimer = null;
    if(overlay) overlay.hidden = true;
    if(sheet) sheet.hidden = true;
  }, 200);
}

function canAppHistoryBack(){
  try{
    const ref = document.referrer || '';
    if(!ref) return false;
    const u = new URL(ref);
    return u.origin === location.origin;
  }catch(e){
    return false;
  }
}

function goAppBack(e){
  if(e && typeof e.preventDefault === 'function') e.preventDefault();
  if(canAppHistoryBack() && window.history.length > 1){
    window.history.back();
    return;
  }
  if (typeof AppRouter !== 'undefined' && AppRouter.navigate) AppRouter.navigate('/dashboard');
  else location.hash = '#/dashboard';
}

function ensureHeaderDate(){
  const el = document.getElementById('header-date');
  if(!el) return;
  try{
    const iso = (typeof todayISO === 'function') ? todayISO() : null;
    if(!iso || typeof isoToJalali !== 'function'){
      el.textContent = '';
      return;
    }
    const j = isoToJalali(iso);
    if(!j){ el.textContent = ''; return; }
    const jy = j[0], jm = j[1], jd = j[2];
    const monthName = (typeof SHAMSI_MONTH_NAMES !== 'undefined' && SHAMSI_MONTH_NAMES[jm - 1])
      ? SHAMSI_MONTH_NAMES[jm - 1]
      : String(jm);
    const FA_WEEKDAYS = ['یکشنبه','دوشنبه','سه‌شنبه','چهارشنبه','پنجشنبه','جمعه','شنبه'];
    const now = new Date();
    const weekday = FA_WEEKDAYS[now.getDay()] || '';
    const dayStr = (typeof enToFaDigits === 'function') ? enToFaDigits(String(jd)) : String(jd);
    const yearStr = (typeof enToFaDigits === 'function') ? enToFaDigits(String(jy)) : String(jy);
    el.textContent = weekday
      ? (weekday + '، ' + dayStr + ' ' + monthName + ' ' + yearStr)
      : (dayStr + ' ' + monthName + ' ' + yearStr);
  }catch(e){
    el.textContent = '';
  }
}

function ensureAppBackButton(activeId){
  const header = document.querySelector('header');
  if(!header) return;

  ensureHeaderDate();

  const existing = header.querySelector('.app-back');
  const isDash = !activeId || activeId === 'dashboard' ||
    /(?:^|\/)index\.html(?:$|\?)/i.test(location.pathname) ||
    document.body.classList.contains('page-dashboard');

  if(isDash){
    if(existing) existing.remove();
    header.classList.remove('has-back');
    return;
  }

  if(existing){
    return;
  }

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'app-back';
  btn.setAttribute('aria-label', 'بازگشت');
  btn.innerHTML = '<span class="app-back-ico" aria-hidden="true">›</span><span class="app-back-txt">بازگشت</span>';
  btn.addEventListener('click', goAppBack);
  header.insertBefore(btn, header.firstChild);
  header.classList.add('has-back');
}

function getQueryParam(name){
  try{
    return new URLSearchParams(window.location.search).get(name);
  }catch(e){
    return null;
  }
}

async function bootPage(activeId, afterLoad){
  try{
    /* PIN gate (minimal): unlock before any CRM render. Does not touch data/FIFO. */
    try{
      var pinConfigured = false;
      try{ pinConfigured = !!(localStorage.getItem('baqeri_pin_lock_v1')); }catch(_e){}
      if(pinConfigured){
        if(!window.pinLock || typeof window.pinLock.ensureUnlocked !== 'function'){
          document.body.innerHTML = '<div style="padding:24px;text-align:center;font-family:sans-serif;direction:rtl;">قفل PIN فعال است اما ماژول قفل بارگذاری نشد. صفحه را دوباره باز کنید.</div>';
          return;
        }
        await window.pinLock.ensureUnlocked();
      } else if(window.pinLock && typeof window.pinLock.ensureUnlocked === 'function'){
        await window.pinLock.ensureUnlocked();
      }
    }catch(pinErr){
      console.error('pin lock gate failed', pinErr);
      document.body.innerHTML = '<div style="padding:24px;text-align:center;font-family:sans-serif;direction:rtl;">خطا در قفل PIN. صفحه را دوباره باز کنید.</div>';
      return;
    }
    
    // iOS Foundation: Setup Keyboard Guard
    setupVisualViewportKeyboardGuard();

    await loadData();
    renderSharedNav(activeId);
    renderBottomNav(activeId);
    ensureAppBackButton(activeId);
    if(typeof afterLoad === 'function'){
      await afterLoad();
    }
  }catch(e){
    console.error('bootPage failed', e);
    if(typeof showToast === 'function'){
      showToast('خطا در بارگذاری اطلاعات');
    }
    const main = document.getElementById('main');
    if(main){
      main.innerHTML = `<div class="empty">خطا در بارگذاری اطلاعات. صفحه را دوباره باز کنید.</div>`;
    }
  }
}

function pageShellNote(title, detail){
  return `
    <h2 class="section-title">${title}</h2>
    <div class="page-skeleton-note">
      ${detail || 'این صفحه در مرحله ۱ فقط اسکلت معماری است. امکانات کامل در مراحل بعد منتقل می‌شوند.'}
    </div>
  `;
}

function waitForCrmDataLoad() {
  return new Promise(function (resolve) {
    var retrying = false;
    function paint() {
      var main = document.getElementById('main');
      if (!main) {
        resolve();
        return;
      }
      main.innerHTML =
        '<div class="empty" style="padding:28px 16px;text-align:center;direction:rtl;">' +
        '<div style="font-size:1.05rem;font-weight:600;margin-bottom:8px;">خطا در بارگذاری اطلاعات</div>' +
        '<div style="opacity:.85;margin-bottom:16px;line-height:1.6;">داده‌های CRM خوانده نشد. برنامه با حالت خالی باز نمی‌شود تا از نمایش نادرست جلوگیری شود.</div>' +
        '<button type="button" class="btn" id="crm-load-retry">تلاش مجدد</button>' +
        '</div>';
      var btn = document.getElementById('crm-load-retry');
      if (!btn) return;
      btn.addEventListener('click', function onRetry() {
        if (retrying) return;
        retrying = true;
        btn.disabled = true;
        btn.textContent = 'در حال تلاش…';
        Promise.resolve()
          .then(function () {
            return loadData();
          })
          .then(function () {
            retrying = false;
            resolve();
          })
          .catch(function (err) {
            console.error('loadData retry failed', err);
            retrying = false;
            paint();
          });
      });
    }
    paint();
  });
}

async function bootSpaShell() {
  try {
    try {
      var pinConfigured = false;
      try {
        pinConfigured = !!(localStorage.getItem('baqeri_pin_lock_v1'));
      } catch (_e) {}
      if (pinConfigured) {
        if (!window.pinLock || typeof window.pinLock.ensureUnlocked !== 'function') {
          document.body.innerHTML =
            '<div style="padding:24px;text-align:center;font-family:sans-serif;direction:rtl;">قفل PIN فعال است اما ماژول قفل بارگذاری نشد. صفحه را دوباره باز کنید.</div>';
          return;
        }
        await window.pinLock.ensureUnlocked();
      } else if (window.pinLock && typeof window.pinLock.ensureUnlocked === 'function') {
        await window.pinLock.ensureUnlocked();
      }
    } catch (pinErr) {
      console.error('pin lock gate failed', pinErr);
      document.body.innerHTML =
        '<div style="padding:24px;text-align:center;font-family:sans-serif;direction:rtl;">خطا در قفل PIN. صفحه را دوباره باز کنید.</div>';
      return;
    }

    // iOS Foundation: Setup Keyboard Guard
    setupVisualViewportKeyboardGuard();

    try {
      await loadData();
      if (typeof hydrateMonthlySalesTarget === 'function') await hydrateMonthlySalesTarget();
    } catch (loadErr) {
      console.error('bootSpaShell loadData failed', loadErr);
      await waitForCrmDataLoad();
    }

    if (typeof loadProspectData === 'function') {
      try {
        await loadProspectData();
      } catch (pe) {
        console.warn('loadProspectData failed (CRM continues)', pe);
      }
    }

    renderSharedNav('dashboard');
    renderBottomNav('dashboard');
    ensureAppBackButton('dashboard');

    if (typeof AppRouter === 'undefined' || !AppRouter.registerRoute) {
      console.error('AppRouter missing');
      const main = document.getElementById('main');
      if (main) main.innerHTML = '<div class="empty">Router بارگذاری نشد.</div>';
      return;
    }

    function spaActiveIdFromPath(path) {
      if (path === '/' || path === '/dashboard') return 'dashboard';
      if (path === '/products') return 'products';
      if (path === '/inventory') return 'inventory';
      if (path === '/reports') return 'reports';
      if (path === '/customers' || path === '/customer') return 'customers';
      if (path === '/payments') return 'payments';
      if (path === '/invoices' || path === '/invoice') return 'invoices';
      if (path === '/suppliers' || path === '/supplier') return 'suppliers';
      if (path === '/visits') return 'visits';
      if (path === '/prospects' || path === '/prospect' || path === '/prospect-routes' || path === '/evaluation') return 'prospects';
      if (path === '/checks') return 'checks';
      if (path === '/game') return 'game';
      if (path === '/settings') return 'settings';
      return 'dashboard';
    }

    function makeViewHandler(View, activeId) {
      return function (params) {
        renderSharedNav(activeId);
        renderBottomNav(activeId);
        ensureAppBackButton(activeId);
        const root = document.getElementById('main');
        if (!root || !View || typeof View.mount !== 'function') return function () {};
        return View.mount(root, params || {});
      };
    }

    AppRouter.registerRoute('/', makeViewHandler(typeof DashboardView !== 'undefined' ? DashboardView : null, 'dashboard'));
    AppRouter.registerRoute('/dashboard', makeViewHandler(typeof DashboardView !== 'undefined' ? DashboardView : null, 'dashboard'));
    AppRouter.registerRoute('/products', makeViewHandler(typeof ProductsView !== 'undefined' ? ProductsView : null, 'products'));
    AppRouter.registerRoute('/inventory', makeViewHandler(typeof InventoryView !== 'undefined' ? InventoryView : null, 'inventory'));
    AppRouter.registerRoute('/reports', makeViewHandler(typeof ReportsView !== 'undefined' ? ReportsView : null, 'reports'));
    AppRouter.registerRoute('/customers', makeViewHandler(typeof CustomersView !== 'undefined' ? CustomersView : null, 'customers'));
    AppRouter.registerRoute('/customer', makeViewHandler(typeof CustomerView !== 'undefined' ? CustomerView : null, 'customers'));
    AppRouter.registerRoute('/payments', makeViewHandler(typeof PaymentsView !== 'undefined' ? PaymentsView : null, 'payments'));
    AppRouter.registerRoute('/invoices', makeViewHandler(typeof InvoicesView !== 'undefined' ? InvoicesView : null, 'invoices'));
    AppRouter.registerRoute('/invoice', makeViewHandler(typeof InvoiceView !== 'undefined' ? InvoiceView : null, 'invoices'));
    AppRouter.registerRoute('/suppliers', makeViewHandler(typeof SuppliersView !== 'undefined' ? SuppliersView : null, 'suppliers'));
    AppRouter.registerRoute('/supplier', makeViewHandler(typeof SupplierView !== 'undefined' ? SupplierView : null, 'suppliers'));
    AppRouter.registerRoute('/visits', makeViewHandler(typeof VisitsView !== 'undefined' ? VisitsView : null, 'visits'));
    AppRouter.registerRoute('/prospects', makeViewHandler(typeof ProspectsView !== 'undefined' ? ProspectsView : null, 'prospects'));
    AppRouter.registerRoute('/prospect', makeViewHandler(typeof ProspectView !== 'undefined' ? ProspectView : null, 'prospects'));
    AppRouter.registerRoute('/prospect-routes', makeViewHandler(typeof LocationsView !== 'undefined' ? LocationsView : null, 'settings'));
    AppRouter.registerRoute('/evaluation', makeViewHandler(typeof EvaluationView !== 'undefined' ? EvaluationView : null, 'prospects'));
    AppRouter.registerRoute('/checks', makeViewHandler(typeof ChecksView !== 'undefined' ? ChecksView : null, 'checks'));
    AppRouter.registerRoute('/game', makeViewHandler(typeof GameCenterView !== 'undefined' ? GameCenterView : null, 'game'));
    AppRouter.registerRoute('/settings', makeViewHandler(typeof SettingsView !== 'undefined' ? SettingsView : null, 'settings'));
    AppRouter.registerRoute('/locations', makeViewHandler(typeof LocationsView !== 'undefined' ? LocationsView : null, 'settings'));
    AppRouter.registerRoute('/watches', makeViewHandler(typeof WatchesView !== 'undefined' ? WatchesView : null, 'watches'));
    AppRouter.registerRoute('/watch', makeViewHandler(typeof WatchDetailView !== 'undefined' ? WatchDetailView : null, 'watches'));
    AppRouter.start();
  } catch (e) {
    console.error('bootSpaShell failed', e);
    if (typeof showToast === 'function') showToast('خطا در بارگذاری اطلاعات');
    const main = document.getElementById('main');
    if (main) {
      main.innerHTML = '<div class="empty">خطا در بارگذاری اطلاعات. صفحه را دوباره باز کنید.</div>';
    }
  }
}

/* Setup Visual Viewport Keyboard Guard (iOS) */
function setupVisualViewportKeyboardGuard() {
  if (setupVisualViewportKeyboardGuard._bound) return;
  setupVisualViewportKeyboardGuard._bound = true;

  function update() {
    try {
      if (window.visualViewport) {
        const vv = window.visualViewport;
        const keyboardHeight = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
        const isOpen = keyboardHeight > 80;

        document.body.classList.toggle('keyboard-open', isOpen);
        document.body.style.setProperty('--keyboard-height', keyboardHeight + 'px');
        document.body.style.setProperty('--vv-height', Math.round(vv.height) + 'px');
        if (typeof pinBottomNav === 'function') pinBottomNav();
      }
    } catch (e) {}
  }

  window.addEventListener('resize', update, { passive: true });
  window.addEventListener('scroll', update, { passive: true });
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', update, { passive: true });
    window.visualViewport.addEventListener('scroll', update, { passive: true });
  }
  document.addEventListener('focusin', function (e) {
    var t = e.target;
    if (!t || !t.tagName) return;
    var tag = t.tagName.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || t.isContentEditable) {
      setTimeout(update, 50);
      setTimeout(update, 300);
    }
  }, true);
  document.addEventListener('focusout', function () {
    setTimeout(update, 50);
    setTimeout(update, 300);
  }, true);
  update();
}