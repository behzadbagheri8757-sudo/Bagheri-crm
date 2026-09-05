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
      autoHtml = '<div class="empty" style="padding:8px 0;">هنوز بکاپ خودکاری ذخیره نشده (هر ۱۲ ساعت حداکثر یک نسخه، تا ۵ نسخه).</div>';
    } else {
      autoHtml = autoList.slice().reverse().map(function (item) {
        const when = item.ts ? new Date(item.ts).toLocaleString('fa-IR') : '—';
        return `<div class="auto-backup-row">
          <span class="name" style="font-size:.85rem;">${esc(when)}</span>
          <button type="button" class="btn small secondary" data-auto-key="${esc(item.key)}">بازیابی این نسخه</button>
        </div>`;
      }).join('');
    }

    root.innerHTML = `
      <h2 class="section-title">تنظیمات</h2>
      <p class="tx-hint">مدیریت داده‌ها، پشتیبان‌گیری و امنیت برنامه.</p>

      <div class="settings-section mgmt-section">
        <h3 class="mgmt-section-title">داده و بکاپ</h3>
        <div class="settings-warn">
          فایل JSON را در جایی امن نگه دارید (Files / ابر / کامپیوتر). روی iPhone معمولاً برگه Share و «Save to Files» باز می‌شود.
        </div>
        <div class="btn-row tx-actions-primary">
          <button type="button" class="btn" id="export-json">دریافت Backup (JSON)</button>
          <button type="button" class="btn secondary" id="export-excel">خروجی اکسل</button>
        </div>
      </div>

      <div class="settings-section mgmt-section">
        <h3 class="mgmt-section-title">بازیابی از فایل</h3>
        <div class="settings-warn">
          بازیابی، اطلاعات فعلی را <b>جایگزین</b> می‌کند. قبل از آن، یک نسخه برای «برگشت از بازیابی» ذخیره می‌شود.
        </div>
        <div class="field"><label>انتخاب فایل بکاپ JSON</label>
          <input type="file" id="import-file" accept="application/json,.json">
        </div>
        <div class="btn-row">
          <button type="button" class="btn danger" id="do-import">بازیابی و جایگزینی</button>
          <button type="button" class="btn secondary" id="undo-import" ${canUndo ? '' : 'disabled'}>
            بازگشت به نسخه قبل از آخرین بازیابی
          </button>
        </div>
        <div class="sub" style="margin-top:8px;font-size:.78rem;">
          ${canUndo
            ? 'نسخهٔ قبل از آخرین Restore در دسترس است و می‌توانید برگردید.'
            : 'هنوز نسخهٔ قبل از Restore ذخیره نشده (بعد از یک بازیابی موفق فعال می‌شود).'}
        </div>
      </div>

      <div class="settings-section mgmt-section">
        <h3 class="mgmt-section-title">بکاپ خودکار داخلی</h3>
        <div class="sub" style="margin-bottom:8px;font-size:.8rem;line-height:1.5;">
          برنامه در صورت استفاده، حداکثر هر ۱۲ ساعت یک نسخه از داده‌های CRM، FIFO، هدف فروش، ProspectScout و Intelligence داخل IndexedDB نگه می‌دارد (تا ۵ نسخه). این جایگزین Backup فایل JSON نیست.
        </div>
        <div class="card">${autoHtml}</div>
      </div>

      <div class="settings-section mgmt-section">
        <h3 class="mgmt-section-title">موقعیت مکانی</h3>
        <div class="sub" style="margin-bottom:8px;font-size:.8rem;line-height:1.5;">
          مدیریت ساختار منطقه › مسیر › محله، مشترک بین مشتریان و مغازه‌های بالقوه.
        </div>
        <div class="btn-row">
          <a class="btn small secondary" href="#/locations">مدیریت موقعیت مکانی</a>
        </div>
      </div>

      <details class="tx-details mgmt-section">
        <summary>آمار دادهٔ فعلی</summary>
        <div class="cards" style="margin-top:10px;">
          <div class="card"><div class="label">مشتریان</div><div class="value">${enToFaDigits(String((data.customers || []).length))}</div></div>
          <div class="card"><div class="label">کالاها</div><div class="value">${enToFaDigits(String((data.products || []).length))}</div></div>
          <div class="card"><div class="label">فاکتورها</div><div class="value">${enToFaDigits(String((data.invoices || []).length))}</div></div>
          <div class="card"><div class="label">تأمین‌کنندگان</div><div class="value">${enToFaDigits(String((data.suppliers || []).length))}</div></div>
          <div class="card"><div class="label">پرداخت‌ها</div><div class="value">${enToFaDigits(String((data.payments || []).length))}</div></div>
          <div class="card"><div class="label">چک‌ها</div><div class="value">${enToFaDigits(String((data.checks || []).length))}</div></div>
          <div class="card wide"><div class="label">ویزیت مشتریان</div><div class="value">${enToFaDigits(String(visitCount))}</div></div>
        </div>
      </details>

      <div class="settings-section mgmt-section">
        <h3 class="mgmt-section-title">امنیت — قفل PIN</h3>
        <div class="sub" style="margin-bottom:8px;font-size:.8rem;line-height:1.5;">
          با فعال‌سازی PIN، بعد از خروج از برنامه یا رفتن به پس‌زمینه، برای ورود دوباره باید کد شش‌رقمی را وارد کنید. PIN روی همین دستگاه در localStorage ذخیره می‌شود (هش‌شده) و داخل Backup نیست.
        </div>
        <div id="pin-settings-status" class="card" style="margin-bottom:10px;"></div>
        <div class="btn-row">
          <button type="button" class="btn small" id="pin-set-btn">تنظیم PIN</button>
          <button type="button" class="btn small secondary" id="pin-change-btn">تغییر PIN</button>
          <button type="button" class="btn small secondary" id="pin-clear-btn">حذف PIN</button>
          <button type="button" class="btn small secondary" id="pin-lock-now-btn">قفل اکنون</button>
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
        ? '<div class="label">وضعیت</div><div class="value accent-olive" style="font-size:.95rem;">PIN فعال است</div>'
        : '<div class="label">وضعیت</div><div class="value" style="font-size:.95rem;">PIN تنظیم نشده</div>';
    }
    refreshPinStatus();

    // Export JSON
    const exportJsonBtn = document.getElementById('export-json');
    exportJsonHandler = function () {
      if (typeof exportBackupJSON === 'function') exportBackupJSON();
      else showToast('تابع بکاپ در دسترس نیست');
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
      const ok = confirm(
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
      if (!confirm('به حالت قبل از آخرین بازیابی برگردیم؟')) return;
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
        <div class="cards" style="margin-top:4px;">
          <div class="card wide"><div class="label">نام</div>
            <div class="value" style="font-size:1rem;">حبوبات و خشکبار باقری — دفتر حساب</div></div>
          <div class="card"><div class="label">نسخه معماری</div>
            <div class="value" style="font-size:.95rem;">چندصفحه‌ای · فاز ۹</div></div>
          <div class="card"><div class="label">schemaVersion</div>
            <div class="value">${esc(enToFaDigits(String(schema)))}</div></div>
          <div class="card wide"><div class="label">ذخیره‌سازی محلی</div>
            <div class="value" style="font-size:.9rem;">${esc(storageStatusLabel())}</div>
            <div class="sub" style="margin-top:4px;">DB: baqeriDB · store: appdata · کلید: main</div>
          </div>
          <div class="card"><div class="label">سری فاکتور</div><div class="value">${esc(enToFaDigits(String(seq)))}</div></div>
        </div>
        <div class="report-note" style="font-size:.78rem;color:var(--ink-soft);margin-top:12px;line-height:1.55;">
          برنامه آفلاین است. داده‌ها روی همین دستگاه ذخیره می‌شوند. برای امنیت، به‌طور منظم Backup بگیرید.
        </div>
      `);
    };
    techRow.onclick = techInfoHandler;

    // PIN settings
    (function bindPinSettings() {
      const setBtn = document.getElementById('pin-set-btn');
      const changeBtn = document.getElementById('pin-change-btn');
      const clearBtn = document.getElementById('pin-clear-btn');
      const lockBtn = document.getElementById('pin-lock-now-btn');

      pinSetHandler = async function () {
        if (!window.pinLock) { showToast('ماژول PIN در دسترس نیست'); return; }
        if (window.pinLock.isPinSet()) { showToast('PIN از قبل فعال است؛ از «تغییر» استفاده کنید'); return; }
        const a = prompt('PIN شش‌رقمی جدید:');
        if (a == null) return;
        const b = prompt('تکرار PIN:');
        if (b == null) return;
        if (String(a).replace(/\D/g, '').slice(0, 6) !== String(b).replace(/\D/g, '').slice(0, 6)) {
          showToast('دو PIN یکسان نیستند');
          return;
        }
        try {
          await window.pinLock.setPin(a);
          showToast('PIN ذخیره شد');
          refreshPinStatus();
        } catch (e) {
          showToast(e && e.message ? e.message : 'خطا در تنظیم PIN');
        }
      };
      setBtn.onclick = pinSetHandler;

      pinChangeHandler = async function () {
        if (!window.pinLock) { showToast('ماژول PIN در دسترس نیست'); return; }
        if (!window.pinLock.isPinSet()) { showToast('ابتدا PIN را تنظیم کنید'); return; }
        const oldP = prompt('PIN فعلی:');
        if (oldP == null) return;
        const n1 = prompt('PIN جدید (۶ رقم):');
        if (n1 == null) return;
        const n2 = prompt('تکرار PIN جدید:');
        if (n2 == null) return;
        if (String(n1).replace(/\D/g, '').slice(0, 6) !== String(n2).replace(/\D/g, '').slice(0, 6)) {
          showToast('دو PIN جدید یکسان نیستند');
          return;
        }
        try {
          await window.pinLock.changePin(oldP, n1);
          showToast('PIN تغییر کرد');
          refreshPinStatus();
        } catch (e) {
          showToast(e && e.message ? e.message : 'خطا در تغییر PIN');
        }
      };
      changeBtn.onclick = pinChangeHandler;

      pinClearHandler = async function () {
        if (!window.pinLock) { showToast('ماژول PIN در دسترس نیست'); return; }
        if (!window.pinLock.isPinSet()) { showToast('PIN فعال نیست'); return; }
        const cur = prompt('برای حذف PIN، PIN فعلی را وارد کنید:');
        if (cur == null) return;
        try {
          await window.pinLock.clearPin(cur);
          showToast('PIN حذف شد');
          refreshPinStatus();
        } catch (e) {
          showToast(e && e.message ? e.message : 'خطا در حذف PIN');
        }
      };
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