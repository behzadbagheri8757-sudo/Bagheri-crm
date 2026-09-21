/* js/views/settings.js — SPA Settings view (Phase 9).
   Extracted from settings.html. Reuses exportBackupJSON, exportExcel,
   importBackupJSON, undoLastRestore, getAutoBackupList, restoreFromAutoBackup,
   dbGet, dbPut, dbDelete, countCustomerVisits, storageStatusLabel,
   hasPreRestoreSnapshot, openProspectScoutDbForBackup, etc.
   No new financial logic.
*/
'use strict';

(function (global) {
  let exportJsonHandler = null;
  let exportExcelHandler = null;
  let importBtnHandler = null;
  let importFileHandler = null;
  let undoBtnHandler = null;
  let pinSetHandler = null;
  let pinChangeHandler = null;
  let pinClearHandler = null;
  let pinLockNowHandler = null;
  let techInfoHandler = null;
  let autoBackupHandlers = [];
  function countCustomerVisits() {
    return (data.customers || []).reduce(function (s, c) {
      return s + ((c.visits || []).length);
    }, 0);
  }

  function storageStatusLabel() {
    try {
      if (typeof indexedDB === 'undefined') return 'IndexedDB در دسترس نیست';
      return 'IndexedDB فعال (baqeriDB)';
    } catch (e) {
      return 'نامشخص';
    }
  }

  async function hasPreRestoreSnapshot() {
    try {
      const snap = await dbGet(PRERESTORE_KEY);
      return !!(snap && snap.value);
    } catch (e) {
      return false;
    }
  }

  async function renderSettingsPage(root, isStale) {
    if (!root) return;

    const visitCount = countCustomerVisits();
    let autoList = [];
    try { autoList = await getAutoBackupList(); } catch (e) { autoList = []; }
    if (typeof isStale === 'function' && isStale()) return;
    const canUndo = await hasPreRestoreSnapshot();
    if (typeof isStale === 'function' && isStale()) return;

    let autoHtml = '';
    if (!autoList.length) {
      autoHtml = '<div class="empty settings-empty">هنوز نسخه پشتیبان خودکاری ذخیره نشده (هر ۱۲ ساعت حداکثر یک نسخه، تا ۵ نسخه).</div>';
    } else {
      autoHtml = autoList.slice().reverse().map(function (item) {
        const when = item.ts ? new Date(item.ts).toLocaleString('fa-IR') : '—';
        return `<div class="auto-backup-row">
          <span class="name auto-backup-name">${esc(when)}</span>
          <button type="button" class="btn small secondary" data-auto-key="${esc(item.key)}">بازیابی این نسخه</button>
        </div>`;
      }).join('');
    }

    root.innerHTML = `
      <p class="tx-hint">مدیریت داده‌ها، پشتیبان‌گیری و امنیت برنامه.</p>

      <div class="mgmt-section">
        <h3 class="mgmt-section-title">داده و پشتیبان‌گیری</h3>
        <div class="settings-section">
          <div class="settings-warn">
            فایل JSON را در جایی امن نگه دارید (Files / ابر). روی iPhone معمولاً Share → Save to Files.
          </div>
          <div class="btn-row tx-actions-primary">
            <button type="button" class="btn" id="export-json">دریافت فایل پشتیبان</button>
            <button type="button" class="btn secondary settings-action-link" id="export-excel">خروجی اکسل</button>
          </div>
        </div>
      </div>

      <div class="mgmt-section">
        <h3 class="mgmt-section-title">بازیابی از فایل</h3>
        <div class="settings-section">
          <div class="settings-warn">
            بازیابی اطلاعات فعلی را <b>جایگزین</b> می‌کند؛ قبلش نسخهٔ برگشت ذخیره می‌شود.
          </div>
          <div class="field"><label>انتخاب فایل پشتیبان JSON</label>
            <input type="file" id="import-file" accept="application/json,.json">
          </div>
          <div class="btn-row">
            <button type="button" class="btn danger" id="do-import">بازیابی و جایگزینی</button>
            <button type="button" class="btn secondary settings-action-link" id="undo-import" ${canUndo ? '' : 'disabled'}>
              بازگشت به نسخه قبل از آخرین بازیابی
            </button>
          </div>
          <div class="sub settings-restore-note">
            ${canUndo
              ? 'نسخهٔ قبل از آخرین Restore در دسترس است و می‌توانید برگردید.'
              : 'هنوز نسخهٔ قبل از Restore ذخیره نشده (بعد از یک بازیابی موفق فعال می‌شود).'}
          </div>
        </div>
      </div>

      <div class="mgmt-section">
        <h3 class="mgmt-section-title">پشتیبان خودکار داخلی</h3>
        <div class="settings-section">
          <div class="sub settings-description">
            برنامه در صورت استفاده، حداکثر هر ۱۲ ساعت یک نسخه از داده‌های CRM، FIFO، هدف فروش، ProspectScout و Intelligence داخل IndexedDB نگه می‌دارد (تا ۵ نسخه). این جایگزین فایل پشتیبان JSON نیست.
          </div>
          <div class="card">${autoHtml}</div>
        </div>
      </div>

      <div class="mgmt-section">
        <h3 class="mgmt-section-title">موقعیت مکانی</h3>
        <div class="settings-section">
          <div class="sub settings-description">
            مدیریت ساختار منطقه › مسیر › محله، مشترک بین مشتریان و مغازه‌های بالقوه.
          </div>
          <div class="btn-row">
            <a class="btn small secondary settings-action-link" href="#/locations">مدیریت موقعیت مکانی</a>
          </div>
        </div>
      </div>

      <details class="tx-details mgmt-section">
        <summary>آمار دادهٔ فعلی</summary>
        <div class="cards settings-stats">
          <div class="card"><div class="label">مشتریان</div><div class="value">${enToFaDigits(String((data.customers || []).length))}</div></div>
          <div class="card"><div class="label">کالاها</div><div class="value">${enToFaDigits(String((data.products || []).length))}</div></div>
          <div class="card"><div class="label">فاکتورها</div><div class="value">${enToFaDigits(String((data.invoices || []).length))}</div></div>
          <div class="card"><div class="label">تأمین‌کنندگان</div><div class="value">${enToFaDigits(String((data.suppliers || []).length))}</div></div>
          <div class="card"><div class="label">پرداخت‌ها</div><div class="value">${enToFaDigits(String((data.payments || []).length))}</div></div>
          <div class="card"><div class="label">چک‌ها</div><div class="value">${enToFaDigits(String((data.checks || []).length))}</div></div>
          <div class="card wide"><div class="label">ویزیت مشتریان</div><div class="value">${enToFaDigits(String(visitCount))}</div></div>
        </div>
      </details>

      <div class="mgmt-section">
        <h3 class="mgmt-section-title">امنیت — قفل PIN</h3>
        <div class="settings-section">
          <div class="sub settings-description">
            با فعال‌سازی PIN، بعد از خروج از برنامه یا رفتن به پس‌زمینه، برای ورود دوباره باید کد شش‌رقمی را وارد کنید. PIN روی همین دستگاه در localStorage ذخیره می‌شود (هش‌شده) و داخل فایل پشتیبان نیست.
          </div>
          <div id="pin-settings-status" class="card pin-status"></div>
          <div class="btn-row">
            <button type="button" class="btn small" id="pin-set-btn">تنظیم PIN</button>
            <button type="button" class="btn small secondary" id="pin-change-btn">تغییر PIN</button>
            <button type="button" class="btn small secondary" id="pin-clear-btn">حذف PIN</button>
            <button type="button" class="btn small secondary" id="pin-lock-now-btn">قفل اکنون</button>
          </div>
        </div>
      </div>

      <div class="settings-section mgmt-section">
        <div class="settings-tech-row" id="open-tech-info" role="button" tabindex="0">
          <span class="tech-label">اطلاعات فنی</span>
          <span class="tech-chevron">‹</span>
        </div>
      </div>
    `;

    // Refresh PIN status
    function refreshPinStatus() {
      const statusEl = document.getElementById('pin-settings-status');
      if (!statusEl) return;
      const set = window.pinLock && typeof window.pinLock.isPinSet === 'function' && window.pinLock.isPinSet();
      statusEl.innerHTML = set
         ? '<div class="label">وضعیت</div><div class="value accent-olive settings-status-value">PIN فعال است</div>'
         : '<div class="label">وضعیت</div><div class="value settings-status-value">PIN تنظیم نشده</div>';
    }
    refreshPinStatus();

    // Export JSON
    const exportJsonBtn = document.getElementById('export-json');
    exportJsonHandler = function () {
      if (typeof exportBackupJSON === 'function') exportBackupJSON();
      else showToast('تابع پشتیبان‌گیری در دسترس نیست');
    };
    exportJsonBtn.onclick = exportJsonHandler;

    // Export Excel
    const exportExcelBtn = document.getElementById('export-excel');
    exportExcelHandler = function () {
      if (typeof exportExcel === 'function') exportExcel();
      else showToast('تابع اکسل در دسترس نیست');
    };
    exportExcelBtn.onclick = exportExcelHandler;

    // Import file
    const importFile = document.getElementById('import-file');
    importFileHandler = function () {
      // just store reference, handled by import button
    };
    importFile.onchange = importFileHandler;

    // Import button
    const importBtn = document.getElementById('do-import');
    importBtnHandler = async function () {
      const f = document.getElementById('import-file').files[0];
      if (!f) { showToast('فایل را انتخاب کنید'); return; }
      const ok = await appConfirm(
        'اطلاعات فعلی با محتوای این فایل جایگزین شود؟\n\n' +
        'قبل از جایگزینی، وضعیت فعلی برای «برگشت از بازیابی» ذخیره می‌شود.\n' +
        'فایل: ' + f.name
      );
      if (!ok) return;
      if (typeof importBackupJSON === 'function') {
        await importBackupJSON(f);
        location.reload();
      } else {
        showToast('تابع بازیابی در دسترس نیست');
      }
    };
    importBtn.onclick = importBtnHandler;

    // Undo import
    const undoBtn = document.getElementById('undo-import');
    undoBtnHandler = async function () {
      if (!(await hasPreRestoreSnapshot())) {
        showToast('نسخه‌ی قبل از بازیابی موجود نیست');
        return;
      }
      if (!(await appConfirm('به حالت قبل از آخرین بازیابی برگردیم؟'))) return;
      if (typeof undoLastRestore === 'function') {
        await undoLastRestore();
        location.reload();
      } else {
        showToast('تابع برگشت در دسترس نیست');
      }
    };
    undoBtn.onclick = undoBtnHandler;

    // Auto-backup restore buttons
    autoBackupHandlers = [];
    root.querySelectorAll('[data-auto-key]').forEach(function (btn) {
      const handler = async function () {
        if (typeof restoreFromAutoBackup === 'function') {
          await restoreFromAutoBackup(btn.getAttribute('data-auto-key'));
          location.reload();
        } else {
          showToast('تابع بازیابی خودکار در دسترس نیست');
        }
      };
      btn.addEventListener('click', handler);
      autoBackupHandlers.push({ el: btn, handler: handler });
    });

    // Technical info
    const techRow = document.getElementById('open-tech-info');
    techInfoHandler = function () {
      const schema = data.schemaVersion != null ? data.schemaVersion : '—';
      const seq = data.invoiceSeq != null ? data.invoiceSeq : '—';
      openSheet(`
        <h3>اطلاعات فنی</h3>
        <div class="cards settings-tech-stats">
          <div class="card wide"><div class="label">نام</div>
             <div class="value">حبوبات و خشکبار باقری — دفتر حساب</div></div>
          <div class="card"><div class="label">نسخه معماری</div>
             <div class="value">تک‌صفحه‌ای (SPA)</div></div>
          <div class="card"><div class="label">schemaVersion</div>
            <div class="value">${esc(enToFaDigits(String(schema)))}</div></div>
          <div class="card wide"><div class="label">ذخیره‌سازی محلی</div>
             <div class="value">${esc(storageStatusLabel())}</div>
             <div class="sub settings-storage-meta">DB: baqeriDB · store: appdata · کلید: main</div>
          </div>
          <div class="card"><div class="label">سری فاکتور</div><div class="value">${esc(enToFaDigits(String(seq)))}</div></div>
        </div>
        <div class="report-note settings-tech-note">
          برنامه آفلاین است. داده‌ها روی همین دستگاه ذخیره می‌شوند. برای امنیت، به‌طور منظم پشتیبان‌گیری کنید.
        </div>
      `);
    };
    techRow.onclick = techInfoHandler;

    // PIN settings — app-owned sheet UI (no browser dialog).
    (function bindPinSettings() {
      const setBtn = document.getElementById('pin-set-btn');
      const changeBtn = document.getElementById('pin-change-btn');
      const clearBtn = document.getElementById('pin-clear-btn');
      const lockBtn = document.getElementById('pin-lock-now-btn');

      function openPinSheet(mode) {
        if (!window.pinLock) { showToast('ماژول PIN در دسترس نیست'); return; }
        if (mode === 'set' && window.pinLock.isPinSet()) { showToast('PIN از قبل فعال است؛ از «تغییر» استفاده کنید'); return; }
        if ((mode === 'change' || mode === 'clear') && !window.pinLock.isPinSet()) { showToast('PIN فعال نیست'); return; }
        const title = mode === 'set' ? 'تنظیم PIN' : (mode === 'change' ? 'تغییر PIN' : 'حذف PIN');
        let fields = '';
        if(mode !== 'set') fields += '<div class="field"><label for="pin-current">PIN فعلی</label><input id="pin-current" type="tel" inputmode="numeric" maxlength="6" autocomplete="off"></div>';
        if(mode !== 'clear') fields += '<div class="field"><label for="pin-new">PIN جدید (۶ رقم)</label><input id="pin-new" type="tel" inputmode="numeric" maxlength="6" autocomplete="new-password"></div>';
        if(mode !== 'clear') fields += '<div class="field"><label for="pin-confirm">تکرار PIN</label><input id="pin-confirm" type="tel" inputmode="numeric" maxlength="6" autocomplete="new-password"></div>';
        openSheet('<h3>'+title+'</h3>'+fields+'<div class="btn-row"><button type="button" class="btn" id="pin-sheet-save">'+(mode === 'clear' ? 'حذف PIN' : 'ذخیره')+'</button></div>');
        const save = document.getElementById('pin-sheet-save');
        const first = document.getElementById(mode === 'set' ? 'pin-new' : 'pin-current');
        if(first) setTimeout(function(){ first.focus(); }, 0);
        if(save) save.onclick = async function(){
          const current = document.getElementById('pin-current');
          const n1 = document.getElementById('pin-new');
          const n2 = document.getElementById('pin-confirm');
          const clean = function(el){ return String(el ? el.value : '').replace(/\D/g,'').slice(0,6); };
          if(mode !== 'clear'){
            if(clean(n1).length !== 6){ showToast('PIN باید ۶ رقم باشد'); if(n1){ n1.setAttribute('aria-invalid','true'); n1.focus(); } return; }
            if(clean(n1) !== clean(n2)){ showToast('دو PIN جدید یکسان نیستند'); if(n2){ n2.setAttribute('aria-invalid','true'); n2.focus(); } return; }
          }
          if(mode !== 'set' && clean(current).length !== 6){ showToast('PIN فعلی باید ۶ رقم باشد'); if(current){ current.setAttribute('aria-invalid','true'); current.focus(); } return; }
          save.disabled = true;
          try{
            if(mode === 'set') await window.pinLock.setPin(clean(n1));
            else if(mode === 'change') await window.pinLock.changePin(clean(current), clean(n1));
            else await window.pinLock.clearPin(clean(current));
            closeModal();
            refreshPinStatus();
            showToast(mode === 'clear' ? 'PIN حذف شد' : (mode === 'change' ? 'PIN تغییر کرد' : 'PIN ذخیره شد'));
          }catch(e){
            save.disabled = false;
            showToast(e && e.message ? e.message : 'خطا در عملیات PIN');
          }
        };
      }

      pinSetHandler = function(){ openPinSheet('set'); };
      pinChangeHandler = function(){ openPinSheet('change'); };
      pinClearHandler = function(){ openPinSheet('clear'); };
      setBtn.onclick = pinSetHandler;
      changeBtn.onclick = pinChangeHandler;
      clearBtn.onclick = pinClearHandler;

      pinLockNowHandler = function () {
        if (!window.pinLock) { showToast('ماژول PIN در دسترس نیست'); return; }
        if (!window.pinLock.isPinSet()) { showToast('ابتدا PIN را تنظیم کنید'); return; }
        window.pinLock.lock();
        window.pinLock.ensureUnlocked();
      };
      lockBtn.onclick = pinLockNowHandler;
    })();
  }

  function mount(root, params) {
    let refreshToken = null;
    if (!root) return function () {};

    const nav = document.getElementById('nav');
    if (nav) nav.style.display = '';

    // Remove FAB if present
    const fab = document.getElementById('fab');
    if (fab) {
      fab.style.display = 'none';
      fab.onclick = null;
    }

    let cancelled = false;
    const isStale = function () { return cancelled; };

    renderSettingsPage(root, isStale);

    refreshToken = ViewHost.setRefresh(()=>renderSettingsPage(root, isStale));




    return function unmount() {
      cancelled = true;
      ViewHost.clearRefresh(refreshToken);
      refreshToken = null;
      // Remove auto-backup handlers
      autoBackupHandlers.forEach(function (h) {
        try {
          h.el.removeEventListener('click', h.handler);
        } catch (e) {}
      });
      autoBackupHandlers = [];

      // Remove button handlers
      const btnIds = ['export-json', 'export-excel', 'do-import', 'undo-import', 'open-tech-info',
        'pin-set-btn', 'pin-change-btn', 'pin-clear-btn', 'pin-lock-now-btn'];
      btnIds.forEach(function (id) {
        const el = document.getElementById(id);
        if (el) el.onclick = null;
      });

      const importFile = document.getElementById('import-file');
      if (importFile) importFile.onchange = null;

      exportJsonHandler = null;
      exportExcelHandler = null;
      importBtnHandler = null;
      importFileHandler = null;
      undoBtnHandler = null;
      pinSetHandler = null;
      pinChangeHandler = null;
      pinClearHandler = null;
      pinLockNowHandler = null;
      techInfoHandler = null;
      root.innerHTML = '';
    };
  }

  global.SettingsView = { mount: mount, unmount: function () {} };
})(typeof window !== 'undefined' ? window : this);