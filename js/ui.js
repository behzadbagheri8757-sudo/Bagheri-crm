/* ui.js — shared UI helpers (toast, modal/sheet, formatting)
   Phase 0 extract: no logic changes.
   Shamsi rebuild: unified close lifecycle, handle drag dismissal, Escape,
   focus restoration, data-shamsi-mode="calendar" dispatch, and a bridge to
   js/shamsi-calendar.js. All other helpers are preserved byte-for-byte.
*/
// ---------- small utilities ----------
function uid(){ return Date.now().toString(36) + Math.random().toString(36).slice(2,7); }
function faToEnDigits(str){
  if(str===null || str===undefined) return '';
  const map = {'۰':'0','۱':'1','۲':'2','۳':'3','۴':'4','۵':'5','۶':'6','۷':'7','۸':'8','۹':'9',
               '٠':'0','١':'1','٢':'2','٣':'3','٤':'4','٥':'5','٦':'6','٧':'7','٨':'8','٩':'9',
               '٫':'.','،':'','٬':'',',':''};
  // ارقام فارسی/عربی + جداکننده‌های هزار (٬ و ,) و اعشار فارسی
  return String(str).replace(/[۰-۹٠-٩٫،٬,]/g, ch=>map[ch]!==undefined?map[ch]:ch);
}
function fmtQtyDisplay(n){
  var num = Number(n) || 0;
  return String(Math.round(num * 100) / 100);
}

function enToFaDigits(str){
  const map = {'0':'۰','1':'۱','2':'۲','3':'۳','4':'۴','5':'۵','6':'۶','7':'۷','8':'۸','9':'۹'};
  return String(str).replace(/[0-9]/g, ch=>map[ch]||ch);
}

/* Final UI consistency: render visible numeric text in Persian digits across the app.
   Inputs and stored data are untouched; this is display-only. */
function normalizeVisibleDigits(root){
  const target = root || document.getElementById('main') || document.body;
  if(!target || typeof document === 'undefined') return;
  const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT);
  const skip = new Set(['SCRIPT','STYLE','INPUT','TEXTAREA']);
  const nodes = [];
  let node;
  while((node = walker.nextNode())){
    const el = node.parentElement;
    if(el && !skip.has(el.tagName) && /[0-9]/.test(node.nodeValue) && !/[A-Za-z]/.test(node.nodeValue)) nodes.push(node);
  }
  nodes.forEach(function(n){ n.nodeValue = enToFaDigits(n.nodeValue); });
}

(function bindVisibleDigitNormalization(){
  function start(){
    const target = document.body;
    if(!target || typeof MutationObserver === 'undefined') return;
    const observer = new MutationObserver(function(mutations){
      mutations.forEach(function(m){
        m.addedNodes && Array.from(m.addedNodes).forEach(function(n){
          if(n.nodeType === 1 || n.nodeType === 3) {
            normalizeVisibleDigits(n.nodeType === 1 ? n : n.parentElement);
          }
        });
      });
    });
    observer.observe(target, {childList:true, subtree:true});
    normalizeVisibleDigits(target);
  }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, {once:true});
  else start();
})();
function numVal(el){
  if(!el) return 0;
  // faToEnDigits جداکننده‌ها را حذف می‌کند تا parseFloat روی "4,000,000" مقدار 4000000 بدهد
  return parseFloat(faToEnDigits(el.value))||0;
}

/**
 * فرمت زنده مبلغ هنگام تایپ: جداکننده سه‌رقمی، حفظ سبک رقم (فارسی/انگلیسی).
 * فقط رشته نمایش را می‌سازد؛ مقدار عددی از طریق numVal/faToEnDigits خوانده می‌شود.
 */
function formatLiveAmount(str){
  if(str===null || str===undefined) return '';
  const raw = String(str);
  if(!raw) return '';
  const preferFa = /[۰-۹]/.test(raw);
  let cleaned = faToEnDigits(raw).replace(/[^\d.]/g, '');
  if(!cleaned) return '';
  const dot = cleaned.indexOf('.');
  let intPart = dot >= 0 ? cleaned.slice(0, dot) : cleaned;
  let fracPart = dot >= 0 ? cleaned.slice(dot + 1).replace(/\./g, '') : null;
  intPart = intPart.replace(/^0+(?=\d)/, '');
  if(intPart === '' && fracPart !== null) intPart = '0';
  if(intPart === '') return '';
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  let out = fracPart !== null ? (grouped + '.' + fracPart) : grouped;
  if(preferFa) out = enToFaDigits(out).replace(/,/g, '٬');
  return out;
}

/** تعداد ارقام (و نقطه اعشار) قبل از موقعیت cursor برای حفظ محل مکان‌نما */
function _countNumericChars(str){
  return faToEnDigits(str).replace(/[^\d.]/g, '').length;
}

function reformatAmountInputEl(el){
  if(!el || el.tagName !== 'INPUT') return;
  const oldVal = el.value;
  const sel = (typeof el.selectionStart === 'number') ? el.selectionStart : oldVal.length;
  const digitsBefore = _countNumericChars(oldVal.slice(0, sel));
  const formatted = formatLiveAmount(oldVal);
  if(formatted === oldVal) return;
  el.value = formatted;
  // مکان‌نما را بعد از همان تعداد رقم قرار بده
  let pos = formatted.length;
  let seen = 0;
  for(let i = 0; i < formatted.length; i++){
    if(/[\d۰-۹٠-٩.]/.test(formatted[i])){
      seen++;
      if(seen >= digitsBefore){
        pos = i + 1;
        break;
      }
    }
  }
  try{ el.setSelectionRange(pos, pos); }catch(e){}
}

/** آیا این input باید فرمت مبلغ زنده بگیرد؟ */
function isLiveAmountInput(el){
  if(!el || el.tagName !== 'INPUT') return false;
  if(el.type === 'date' || el.type === 'time' || el.type === 'checkbox' || el.type === 'file') return false;
  if(el.getAttribute('inputmode') !== 'decimal') return false;
  // فیلدهای تعداد/موجودی/وزن را فرمت مبلغی نکن (جداکننده روی qty معمولاً لازم نیست و ریسک UX دارد)
  const id = (el.id || '').toLowerCase();
  const cls = (el.className && String(el.className)) || '';
  if(/qty|stock|minstock|pkgw|weight|adjust/.test(id)) return false;
  if(/\b(row-qty|ret-qty|mi-qty)\b/.test(cls)) return false;
  return true;
}

// یک‌بار روی document: فرمت هنگام تایپ برای inputهای مبلغ (بدون نیاز به تغییر app.js)
(function bindLiveAmountFormatting(){
  function onInput(e){
    const el = e.target;
    if(!isLiveAmountInput(el)) return;
    reformatAmountInputEl(el);
  }
  if(typeof document !== 'undefined'){
    if(document.readyState === 'loading'){
      document.addEventListener('DOMContentLoaded', function(){
        document.addEventListener('input', onInput, true);
      });
    }else{
      document.addEventListener('input', onInput, true);
    }
  }
})();
/* iOS-style clear (×) button for editable text/numeric inputs (UI-only).
   One shared floating button, positioned over the focused input, so it works
   for dynamically (re)rendered forms without touching any form markup.
   Clearing sets value='' and fires a normal bubbling 'input' event, exactly
   like the user deleting the text, so existing live formatting / invoice
   calculations / dirty-tracking run unchanged. Opt out with data-no-clear. */
(function bindInputClearButton(){
  if(typeof document === 'undefined') return;
  var OK_TYPES = ['text','tel','number','email','url'];
  // Fields narrower than NARROW get the compact 22px button + 26px end
  // padding (has-input-clear-sm). Covers the invoice qty field (74-76px) and
  // the price field at <=360px (88px); the price field at 96px keeps 30px/34px.
  var SIZE = 30, SIZE_SM = 22, NARROW = 90, MIN_W = 40;
  // Follow loop: runs only while the button may still be moving, and stops
  // once the geometry has been identical for `need` consecutive frames.
  // Viewport-driven changes (iOS keyboard show/hide, focus) use the longer
  // window because the keyboard animation outlasts the short one and can
  // move things without emitting further events; both are bounded.
  var STABLE_FRAMES = 10, STABLE_FRAMES_VIEWPORT = 40;
  var need = STABLE_FRAMES;
  var btn = null, cur = null, mo = null, loop = 0, stable = 0, lastKey = '';
  // Measured difference between where position:fixed actually renders the
  // button and where we asked for it (iOS visual-viewport quirks); see place().
  var corrX = 0, corrY = 0;

  function eligible(el){
    if(!el || el.tagName !== 'INPUT') return false;
    var t = (el.getAttribute('type') || 'text').toLowerCase();
    if(OK_TYPES.indexOf(t) === -1) return false;
    if(el.readOnly || el.disabled) return false;
    if(el.getAttribute('inputmode') === 'none') return false;
    if(el.hasAttribute('data-no-clear') || el.hasAttribute('data-shamsi-field') || el.classList.contains('pin-input-real')) return false;
    return true;
  }

  function ensureBtn(){
    if(btn) return btn;
    btn = document.createElement('span');
    btn.className = 'input-clear-btn';
    btn.setAttribute('role', 'button');
    btn.setAttribute('aria-label', 'پاک کردن');
    btn.hidden = true;
    btn.innerHTML = '<svg viewBox="0 0 18 18" aria-hidden="true"><circle cx="9" cy="9" r="9" fill="#8E8E93"/><path d="M6.2 6.2l5.6 5.6M11.8 6.2l-5.6 5.6" stroke="#fff" stroke-width="1.8" stroke-linecap="round" fill="none"/></svg>';
    // Keep focus/keyboard on the input: block focus-stealing default actions.
    function keep(e){ e.preventDefault(); }
    btn.addEventListener('mousedown', keep);
    btn.addEventListener('touchstart', keep, {passive:false});
    btn.addEventListener('pointerdown', function(e){ e.preventDefault(); clearCurrent(); });
    btn.addEventListener('click', function(e){ e.preventDefault(); e.stopPropagation(); });
    document.body.appendChild(btn);
    return btn;
  }

  // Hard hide: input lost focus / eligibility / value, or was removed.
  function hide(){
    if(loop){ cancelAnimationFrame(loop); loop = 0; }
    stable = 0; lastKey = ''; need = STABLE_FRAMES; corrX = corrY = 0;
    if(cur){ cur.classList.remove('has-input-clear'); cur.classList.remove('has-input-clear-sm'); }
    if(btn) btn.hidden = true;
    if(mo) mo.disconnect();
  }

  function clipped(el, r){
    // true when the input is scrolled out of view inside any clipping ancestor
    var cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    var top = 0, left = 0, bottom = window.innerHeight, right = window.innerWidth;
    // Visible area may extend past the layout viewport while the visual
    // viewport is panned/offset (iOS keyboard). Only ever widen the bounds:
    // a transient viewport change must not soft-hide a valid input.
    var vv = window.visualViewport;
    if(vv){
      bottom = Math.max(bottom, vv.offsetTop + vv.height);
      right = Math.max(right, vv.offsetLeft + vv.width);
    }
    for(var p = el.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement){
      var cs = getComputedStyle(p);
      if(cs.overflowY === 'visible' && cs.overflowX === 'visible') continue;
      var pr = p.getBoundingClientRect();
      if(pr.top > top) top = pr.top;
      if(pr.left > left) left = pr.left;
      if(pr.bottom < bottom) bottom = pr.bottom;
      if(pr.right < right) right = pr.right;
    }
    return cy < top || cy > bottom || cx < left || cx > right;
  }

  // Positions the button from the input's CURRENT rect. Returns a geometry
  // key (used to detect when movement has settled) or null after a hard hide.
  // A transiently clipped / off-screen / collapsed input only hides the
  // button softly: state, observer and follow loop stay alive so it comes
  // back on its own when the input reappears (sheet/row animations).
  function update(){
    var el = cur;
    if(!el || !el.isConnected || document.activeElement !== el){
      var a = document.activeElement;
      if(a && a !== el && eligible(a)){
        if(el){ el.classList.remove('has-input-clear'); el.classList.remove('has-input-clear-sm'); }
        el = cur = a;
      } else { hide(); return null; }
    }
    if(el.value === ''){ hide(); return null; }
    // Apply the end-padding class BEFORE measuring: for auto-width inputs it
    // changes the box, and the button must be placed against the final rect.
    el.classList.add('has-input-clear');
    var r = el.getBoundingClientRect();
    var narrow = r.width < NARROW;
    el.classList.toggle('has-input-clear-sm', narrow);
    var b = ensureBtn();
    if(!mo && typeof MutationObserver !== 'undefined') mo = new MutationObserver(follow);
    if(mo) mo.observe(document.body, {childList:true, subtree:true}); // idempotent
    var vk = '';
    var vv = window.visualViewport;
    if(vv) vk = '|' + Math.round(vv.offsetTop) + '|' + Math.round(vv.offsetLeft) + '|' + Math.round(vv.height) + '|' + Math.round(vv.width) + '|' + Math.round(vv.scale * 100);
    var key = Math.round(r.top * 2) + '|' + Math.round(r.left * 2) + '|' + Math.round(r.width * 2) + '|' + Math.round(r.height * 2) + vk;
    if(r.width < MIN_W || r.height < 20 || clipped(el, r)){
      b.hidden = true;
      return 'h|' + key;
    }
    var size = narrow ? SIZE_SM : SIZE;
    var rtl = getComputedStyle(el).direction === 'rtl';
    b.style.width = b.style.height = size + 'px';
    b.hidden = false;
    place(b, rtl ? r.left + 2 : r.right - size - 2, r.top + (r.height - size) / 2);
    return 's|' + Math.round(corrX * 2) + '|' + Math.round(corrY * 2) + '|' + key;
  }

  // Put the button's rect at (x, y) in getBoundingClientRect() space, the
  // same space the input was measured in. position:fixed and that space can
  // disagree while the visual viewport is offset/animating (iOS keyboard), so
  // instead of trusting the CSS coordinates we read back where the button
  // really landed and fold the difference into a correction. The first write
  // reuses the last known correction, so a steady state costs one write + one
  // read; a residual (< 0.5px is ignored) triggers a single re-write.
  function place(b, x, y){
    b.style.left = (x + corrX) + 'px';
    b.style.top = (y + corrY) + 'px';
    var br = b.getBoundingClientRect();
    var ex = br.left - x, ey = br.top - y;
    if(Math.abs(ex) > 0.5 || Math.abs(ey) > 0.5){
      corrX -= ex; corrY -= ey;
      b.style.left = (x + corrX) + 'px';
      b.style.top = (y + corrY) + 'px';
    }
  }

  function tick(){
    loop = 0;
    var key = update();
    if(key === null) return;                 // hard hide: loop ends
    if(key === lastKey) stable++; else { stable = 0; lastKey = key; }
    if(stable < need) loop = requestAnimationFrame(tick);
    else need = STABLE_FRAMES;               // settled: loop ends, window resets
  }

  // (Re)start following. Never creates a second loop: an already-running
  // loop just has its stability counter reset. Pass exactly `true` for
  // viewport-driven triggers (keyboard) to use the longer settle window —
  // strict compare because this is also used directly as an event/observer
  // callback, which passes an Event/record list as the first argument.
  function follow(long){
    stable = 0;
    if(long === true) need = STABLE_FRAMES_VIEWPORT;
    if(!loop) loop = requestAnimationFrame(tick);
  }

  function clearCurrent(){
    var el = cur;
    if(!el || !el.isConnected) { follow(); return; }
    if(el.value !== ''){
      el.value = '';
      el.dispatchEvent(new Event('input', {bubbles:true}));
    }
    // A handler may have re-rendered the field; update() re-adopts the focused one.
    try{ if(el.isConnected && document.activeElement !== el) el.focus({preventScroll:true}); }catch(_e){}
    update();
    follow();
  }

  document.addEventListener('focusin', function(e){
    var t = e.target;
    if(eligible(t) && cur !== t){
      // New input: drop the previous input's state and never show the button
      // at the previous input's coordinates, even for one frame.
      if(cur){ cur.classList.remove('has-input-clear'); cur.classList.remove('has-input-clear-sm'); }
      if(btn) btn.hidden = true;
      cur = t;
      lastKey = '';
    }
    if(cur) update();   // position immediately from the current rect
    follow(true);       // ...then keep following (through the iOS keyboard animation)
  }, true);
  document.addEventListener('focusout', function(){ follow(true); }, true);
  document.addEventListener('input', function(e){ if(e.target === cur) follow(); }, true);
  document.addEventListener('scroll', function(){ if(cur) follow(); }, {capture:true, passive:true});
  ['transitionrun','transitionstart','transitionend'].forEach(function(n){
    document.addEventListener(n, function(){ if(cur) follow(); }, true);
  });
  window.addEventListener('resize', function(){ if(cur) follow(); });
  if(window.visualViewport){
    window.visualViewport.addEventListener('resize', function(){ if(cur) follow(true); });
    window.visualViewport.addEventListener('scroll', function(){ if(cur) follow(true); });
  }
})();

function esc(s){
  return String(s===undefined||s===null?'':s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function toman(n){ return (Math.round(n||0)).toLocaleString('fa-IR'); }
function balanceStatusWord(balance){
  if(balance>0) return 'بدهکار';
  if(balance<0) return 'بستانکار';
  return 'تسویه شده';
}
function balanceStatusText(balance, amountText){
  return balance===0 ? balanceStatusWord(balance) : (balanceStatusWord(balance)+': '+amountText);
}
/** Local calendar date as YYYY-MM-DD (not UTC — avoids Iran midnight offset). */
function todayISO(){
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}
function nowHHMM(){ const d=new Date(); return String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0'); }

/* ---------- Shamsi/Jalali helpers (UI + period only; storage stays Gregorian YYYY-MM-DD) ---------- */
const SHAMSI_MONTH_NAMES = ['فروردین','اردیبهشت','خرداد','تیر','مرداد','شهریور','مهر','آبان','آذر','دی','بهمن','اسفند'];

/** Parse YYYY-MM-DD without UTC shift. Returns {y,m,d} or null. */
function parseISODateParts(iso){
  if(!iso) return null;
  const m = String(iso).trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if(!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  if(!(y>=1200 && y<=3500) || !(mo>=1 && mo<=12) || !(d>=1 && d<=31)) return null;
  return { y, m: mo, d };
}
function isoFromParts(y, m, d){
  return y + '-' + String(m).padStart(2,'0') + '-' + String(d).padStart(2,'0');
}

/** Gregorian Y/M/D → Jalali [jy, jm, jd] (standard civil algorithm). */
function gregorianToJalali(gy, gm, gd){
  const g_d_m = [0,31,59,90,120,151,181,212,243,273,304,334];
  let gy2 = (gm > 2) ? (gy + 1) : gy;
  let days = 355666 + (365 * gy) + Math.floor((gy2 + 3) / 4) - Math.floor((gy2 + 99) / 100)
    + Math.floor((gy2 + 399) / 400) + gd + g_d_m[gm - 1];
  let jy = -1595 + (33 * Math.floor(days / 12053));
  days %= 12053;
  jy += 4 * Math.floor(days / 1461);
  days %= 1461;
  if(days > 365){
    jy += Math.floor((days - 1) / 365);
    days = (days - 1) % 365;
  }
  const jm = (days < 186) ? 1 + Math.floor(days / 31) : 7 + Math.floor((days - 186) / 30);
  const jd = 1 + ((days < 186) ? (days % 31) : ((days - 186) % 30));
  return [jy, jm, jd];
}

/** Jalali Y/M/D → Gregorian [gy, gm, gd]. */
function jalaliToGregorian(jy, jm, jd){
  jy = parseInt(jy, 10); jm = parseInt(jm, 10); jd = parseInt(jd, 10);
  const jy2 = jy + 1595;
  let days = -355668 + (365 * jy2) + Math.floor(jy2 / 33) * 8 + Math.floor(((jy2 % 33) + 3) / 4) + jd
    + ((jm < 7) ? ((jm - 1) * 31) : (((jm - 7) * 30) + 186));
  let gy = 400 * Math.floor(days / 146097);
  days %= 146097;
  if(days > 36524){
    gy += 100 * Math.floor(--days / 36524);
    days %= 36524;
    if(days >= 365) days++;
  }
  gy += 4 * Math.floor(days / 1461);
  days %= 1461;
  if(days > 365){
    gy += Math.floor((days - 1) / 365);
    days = (days - 1) % 365;
  }
  let gd = days + 1;
  const sal_a = [0,31,((gy % 4 === 0 && gy % 100 !== 0) || (gy % 400 === 0)) ? 29 : 28,31,30,31,30,31,31,30,31,30,31];
  let gm = 1;
  for(; gm < 13 && gd > sal_a[gm]; gm++) gd -= sal_a[gm];
  return [gy, gm, gd];
}

function isJalaliLeap(jy){
  const r = jy % 33;
  return r === 1 || r === 5 || r === 9 || r === 13 || r === 17 || r === 22 || r === 26 || r === 30;
}
function jalaliMonthLength(jy, jm){
  if(jm <= 6) return 31;
  if(jm <= 11) return 30;
  return isJalaliLeap(jy) ? 30 : 29;
}

/** YYYY-MM-DD → [jy,jm,jd] or null */
function isoToJalali(iso){
  const p = parseISODateParts(iso);
  if(!p) return null;
  return gregorianToJalali(p.y, p.m, p.d);
}
/** jy,jm,jd → YYYY-MM-DD */
function jalaliToISO(jy, jm, jd){
  const g = jalaliToGregorian(+jy, +jm, +jd);
  return isoFromParts(g[0], g[1], g[2]);
}

function faDate(iso){
  if(!iso) return '—';
  // Prefer pure conversion so date-only ISO never shifts via UTC midnight
  const j = isoToJalali(String(iso).slice(0, 10));
  if(j){
    return enToFaDigits(j[0] + '/' + j[1] + '/' + j[2]);
  }
  try{ return new Date(iso).toLocaleDateString('fa-IR'); }catch(e){ return iso; }
}

/**
 * Shamsi month equality for period filters («این ماه»).
 * iso: YYYY-MM-DD string; ref: Date (usually new Date()).
 */
function isSameJalaliMonth(iso, ref){
  const p = parseISODateParts(iso);
  if(!p || !ref || isNaN(ref.getTime())) return false;
  const a = gregorianToJalali(p.y, p.m, p.d);
  const b = gregorianToJalali(ref.getFullYear(), ref.getMonth() + 1, ref.getDate());
  return a[0] === b[0] && a[1] === b[1];
}

/**
 * HTML for a Shamsi date field — single field like native input.
 * Tap opens the wheel picker by default, or the calendar grid when
 * opts.mode === 'calendar'. Hidden input keeps Gregorian YYYY-MM-DD
 * (same id) for existing .value readers.
 * Backward compatible: existing 2-arg callers are unchanged.
 */
function shamsiDateInputHTML(id, valueISO, opts){
  const iso = (valueISO && parseISODateParts(valueISO)) ? String(valueISO).slice(0,10) : todayISO();
  const j = isoToJalali(iso) || gregorianToJalali(
    new Date().getFullYear(), new Date().getMonth()+1, new Date().getDate()
  );
  const label = enToFaDigits(j[0] + '/' + j[1] + '/' + j[2]);
  const modeAttr = (opts && opts.mode) ? (' data-shamsi-mode="' + esc(opts.mode) + '"') : '';
  return `<div class="shamsi-date" data-shamsi-root="1"${modeAttr}>
    <input type="hidden" id="${esc(id)}" value="${esc(iso)}" data-shamsi-hidden="1">
    <input type="text" class="shamsi-date-field" data-shamsi-field="1" readonly inputmode="none" value="${esc(label)}" aria-label="تاریخ شمسی">
  </div>`;
}

/* ==========================================================================
   Shamsi Wheel Picker
   - Visual order (left → right in RTL pages): Year | Month | Day
   - Container uses direction:ltr so DOM order (y, m, d) maps to that visual
     order; each column re-establishes direction:rtl for its own content.
   - Single-instance guard: only one shamsi sheet may exist at a time
     (shared id with the calendar picker for mutual exclusion).
   - Unified close lifecycle: cancel / done / backdrop / drag / Escape all
     funnel through one close(apply) function; the closed flag prevents
     double-close and no timer or listener survives past DOM removal.
   - Focus restoration: the trigger's focus is captured on open and restored
     on close.
   ========================================================================== */

function _shamsiPadWheel(col, countBefore){
  // spacer items so first/last can center in the highlight band
  let html = '';
  for(let i = 0; i < countBefore; i++) html += '<div class="shamsi-wheel-item shamsi-wheel-spacer" aria-hidden="true"></div>';
  return html;
}

function _shamsiBuildWheelHTML(part, values, selected, labels){
  // values: array of numbers; labels optional parallel strings
  const spacers = 2;
  let html = _shamsiPadWheel(part, spacers);
  for(let i = 0; i < values.length; i++){
    const v = values[i];
    const lab = labels ? labels[i] : enToFaDigits(String(v));
    const sel = (v === selected) ? ' data-selected="1"' : '';
    html += `<div class="shamsi-wheel-item" data-v="${v}"${sel}>${lab}</div>`;
  }
  html += _shamsiPadWheel(part, spacers);
  return html;
}

function _shamsiItemH(){
  return 36;
}

function _shamsiScrollToValue(col, value){
  if(!col) return;
  const item = col.querySelector('.shamsi-wheel-item[data-v="' + value + '"]');
  if(!item) return;
  const h = _shamsiItemH();
  // center item in column (2 spacers * h offset already in DOM)
  const top = item.offsetTop - (col.clientHeight / 2) + (h / 2);
  col.scrollTop = Math.max(0, top);
}

function _shamsiReadWheel(col){
  if(!col) return null;
  const h = _shamsiItemH();
  const mid = col.scrollTop + col.clientHeight / 2;
  const items = col.querySelectorAll('.shamsi-wheel-item[data-v]');
  let best = null, bestDist = Infinity;
  items.forEach(function(it){
    const c = it.offsetTop + h / 2;
    const d = Math.abs(c - mid);
    if(d < bestDist){ bestDist = d; best = it; }
  });
  if(!best) return null;
  return parseInt(best.getAttribute('data-v'), 10);
}

function _shamsiSnapWheel(col){
  const v = _shamsiReadWheel(col);
  if(v != null) _shamsiScrollToValue(col, v);
  return v;
}

function _shamsiUpdateSelected(col){
  const v = _shamsiReadWheel(col);
  if(v == null) return;
  col.querySelectorAll('.shamsi-wheel-item[data-v]').forEach(function(it){
    const iv = parseInt(it.getAttribute('data-v'), 10);
    if(iv === v) it.setAttribute('data-selected', '1');
    else it.removeAttribute('data-selected');
  });
}

function _shamsiFillDayCol(dayCol, jy, jm, jd){
  const dim = jalaliMonthLength(jy, jm);
  if(jd > dim) jd = dim;
  if(jd < 1) jd = 1;
  const vals = [];
  for(let d = 1; d <= dim; d++) vals.push(d);
  dayCol.innerHTML = _shamsiBuildWheelHTML('d', vals, jd, null);
  _shamsiScrollToValue(dayCol, jd);
  _shamsiUpdateSelected(dayCol);
  return jd;
}

function openShamsiPicker(fieldEl){
  if(!fieldEl || !fieldEl.closest) return;
  const root = fieldEl.closest('[data-shamsi-root]');
  if(!root) return;
  const hid = root.querySelector('[data-shamsi-hidden]');
  if(!hid) return;

  // Capture the trigger so focus can be returned on close.
  const previousActive = document.activeElement;

  const iso = (hid.value && parseISODateParts(hid.value)) ? String(hid.value).slice(0, 10) : todayISO();
  const j = isoToJalali(iso) || gregorianToJalali(
    new Date().getFullYear(), new Date().getMonth() + 1, new Date().getDate()
  );
  let jy = j[0], jm = j[1], jd = j[2];

  // Single-instance guard: remove any other shamsi sheet (wheel OR calendar).
  const prev = document.getElementById('shamsi-sheet-root');
  if(prev) prev.remove();

  const yVals = [];
  for(let y = jy + 5; y >= jy - 15; y--) yVals.push(y);
  const mVals = [1,2,3,4,5,6,7,8,9,10,11,12];
  const mLabs = SHAMSI_MONTH_NAMES.slice();

  const overlay = document.createElement('div');
  overlay.id = 'shamsi-sheet-root';
  overlay.className = 'shamsi-sheet-overlay';
  overlay.innerHTML =
    '<div class="shamsi-sheet" role="dialog" aria-modal="true" aria-labelledby="shamsi-sheet-title">' +
      '<div class="shamsi-sheet-handle" aria-hidden="true"></div>' +
      '<div class="shamsi-sheet-toolbar">' +
        '<button type="button" class="shamsi-sheet-btn" data-shamsi-cancel="1">لغو</button>' +
        '<span class="shamsi-sheet-title" id="shamsi-sheet-title">تاریخ</span>' +
        '<button type="button" class="shamsi-sheet-btn shamsi-sheet-done" data-shamsi-done="1">تأیید</button>' +
      '</div>' +
      '<div class="shamsi-wheels-wrap">' +
        '<div class="shamsi-wheels-highlight" aria-hidden="true"></div>' +
        '<div class="shamsi-wheels">' +
          '<div class="shamsi-wheel" data-shamsi-wheel="y"></div>' +
          '<div class="shamsi-wheel" data-shamsi-wheel="m"></div>' +
          '<div class="shamsi-wheel" data-shamsi-wheel="d"></div>' +
        '</div>' +
      '</div>' +
    '</div>';

  document.body.appendChild(overlay);

  const sheetEl = overlay.querySelector('.shamsi-sheet');
  const handleEl = overlay.querySelector('.shamsi-sheet-handle');
  const yCol = overlay.querySelector('[data-shamsi-wheel="y"]');
  const mCol = overlay.querySelector('[data-shamsi-wheel="m"]');
  const dCol = overlay.querySelector('[data-shamsi-wheel="d"]');

  yCol.innerHTML = _shamsiBuildWheelHTML('y', yVals, jy, yVals.map(function(y){ return enToFaDigits(String(y)); }));
  mCol.innerHTML = _shamsiBuildWheelHTML('m', mVals, jm, mLabs);
  _shamsiFillDayCol(dCol, jy, jm, jd);

  // initial scroll + entry animation after layout
  requestAnimationFrame(function(){
    overlay.classList.add('show');
    requestAnimationFrame(function(){
      _shamsiScrollToValue(yCol, jy);
      _shamsiScrollToValue(mCol, jm);
      _shamsiScrollToValue(dCol, jd);
      _shamsiUpdateSelected(yCol);
      _shamsiUpdateSelected(mCol);
      _shamsiUpdateSelected(dCol);
    });
  });

  const scrollTimers = {};
  function onWheelScroll(ev){
    const col = ev.currentTarget;
    const part = col.getAttribute('data-shamsi-wheel');
    clearTimeout(scrollTimers[part]);
    scrollTimers[part] = setTimeout(function(){
      delete scrollTimers[part];
      const v = _shamsiSnapWheel(col);
      _shamsiUpdateSelected(col);
      if(part === 'y' && v != null) jy = v;
      if(part === 'm' && v != null) jm = v;
      if(part === 'd' && v != null) jd = v;
      if(part === 'y' || part === 'm'){
        jd = _shamsiFillDayCol(dCol, jy, jm, jd);
      }
    }, 80);
  }
  yCol.addEventListener('scroll', onWheelScroll, { passive: true });
  mCol.addEventListener('scroll', onWheelScroll, { passive: true });
  dCol.addEventListener('scroll', onWheelScroll, { passive: true });

  let closed = false;

  function onKey(e){
    if(e.key === 'Escape' || e.keyCode === 27){
      e.preventDefault();
      close(false);
    }
  }

  function cleanup(){
    Object.keys(scrollTimers).forEach(function(k){
      clearTimeout(scrollTimers[k]);
      delete scrollTimers[k];
    });
    document.removeEventListener('keydown', onKey, true);
  }

  function close(applyValues){
    if(closed) return;
    closed = true;
    cleanup();

    if(applyValues){
      jy = _shamsiSnapWheel(yCol) || jy;
      jm = _shamsiSnapWheel(mCol) || jm;
      jd = _shamsiSnapWheel(dCol) || jd;
      const dim = jalaliMonthLength(jy, jm);
      if(jd > dim) jd = dim;
      if(jd < 1) jd = 1;
      const newIso = jalaliToISO(jy, jm, jd);
      const old = hid.value;
      hid.value = newIso;
      const field = root.querySelector('[data-shamsi-field]');
      if(field) field.value = enToFaDigits(jy + '/' + jm + '/' + jd);
      if(old !== newIso){
        try{
          hid.dispatchEvent(new Event('input', { bubbles: true }));
          hid.dispatchEvent(new Event('change', { bubbles: true }));
        }catch(e){}
      }
    }

    overlay.classList.remove('show');

    // Remove after exit animation finishes; guard against double removal.
    setTimeout(function(){
      if(overlay.parentNode) overlay.remove();
      if(previousActive && typeof previousActive.focus === 'function'){
        try{ previousActive.focus(); }catch(e){}
      }
    }, 340);
  }

  overlay.__closeFn = function(){ close(false); };

  overlay.addEventListener('click', function(e){
    if(e.target === overlay) close(false);
  });
  overlay.querySelector('[data-shamsi-cancel]').addEventListener('click', function(e){
    e.preventDefault();
    close(false);
  });
  overlay.querySelector('[data-shamsi-done]').addEventListener('click', function(e){
    e.preventDefault();
    close(true);
  });
  document.addEventListener('keydown', onKey, true);

  if(typeof bindSheetDragToDismiss === 'function'){
    bindSheetDragToDismiss(sheetEl, handleEl, function(){ close(false); });
  }

  requestAnimationFrame(function(){
    const done = overlay.querySelector('[data-shamsi-done]');
    if(done){ try{ done.focus(); }catch(e){} }
  });
}

/* Bridge to the calendar-grid picker in js/shamsi-calendar.js.
   If the module is not on the page, we log a visible warning (not a silent
   fallback) and open the wheel picker so the field still functions. */
function openShamsiCalendarPicker(fieldEl){
  if(window.ShamsiCalendar && typeof window.ShamsiCalendar.open === 'function'){
    window.ShamsiCalendar.open(fieldEl);
    return;
  }
  try{ console.warn('[shamsi] js/shamsi-calendar.js is not loaded; falling back to wheel picker. Add the <script> tag after js/ui.js.'); }catch(e){}
  openShamsiPicker(fieldEl);
}

/** Tap on a Shamsi date field opens a picker.
    - root[data-shamsi-mode="calendar"] → calendar grid
    - otherwise → wheel picker */
(function bindShamsiDateDelegation(){
  if(typeof document === 'undefined') return;
  function onClick(e){
    const t = e.target;
    if(!t || !t.closest) return;
    const field = t.closest('[data-shamsi-field]');
    if(!field) return;
    e.preventDefault();
    const root = field.closest('[data-shamsi-root]');
    const mode = root && root.getAttribute('data-shamsi-mode');
    if(mode === 'calendar'){
      openShamsiCalendarPicker(field);
    } else {
      openShamsiPicker(field);
    }
  }
  function bind(){
    document.addEventListener('click', onClick, true);
  }
  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }
})();

function daysAgo(iso){
  if(!iso) return Infinity;
  const p = parseISODateParts(iso);
  if(p){
    const t = new Date(p.y, p.m - 1, p.d).getTime();
    if(!isNaN(t)) return Math.floor((Date.now() - t) / 86400000);
  }
  const d = new Date(iso);
  if(isNaN(d)) return Infinity;
  return Math.floor((Date.now()-d.getTime())/86400000);
}
function showToast(msg, opts){
  opts = opts || {};
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.toggle('error', opts.type === 'error');
  t.classList.add('show');
  clearTimeout(showToast._h);
  showToast._h = setTimeout(()=>t.classList.remove('show'), opts.type === 'error' ? 4500 : 2000);
}


// ---------- body scroll lock (position:fixed technique) ----------
// NOTE: this is used ONLY by the More Menu (nav.js), which has no text
// inputs/keyboard interaction. It must NOT be used by openSheet/closeModal
// below: sheets like "New Invoice" contain real inputs, and pinning body
// via position:fixed breaks iOS's native "scroll focused input above the
// keyboard" behavior plus the existing body.keyboard-open/--keyboard-height
// mechanism (setupVisualViewportKeyboardGuard in nav.js), causing the sheet
// to be cut off under the keyboard and the layout to jitter as visualViewport
// events fight the frozen body. Modal/Sheet uses the simpler class-based
// lock further below instead (body.modal-open{overflow:hidden} in app.css) —
// it doesn't fully stop background touch-scroll but does not conflict with
// the keyboard, so it's the correct trade-off for forms with inputs.
(function(){
  let lockCount = 0;
  let savedScrollY = 0;
  window.__scrollLock = {
    lock(){
      if(lockCount === 0){
        savedScrollY = window.scrollY || window.pageYOffset || 0;
        const b = document.body.style;
        b.position = 'fixed';
        b.top = (-savedScrollY) + 'px';
        b.left = '0';
        b.right = '0';
        b.width = '100%';
      }
      lockCount++;
    },
    unlock(){
      if(lockCount === 0) return;
      lockCount--;
      if(lockCount === 0){
        const b = document.body.style;
        b.position = '';
        b.top = '';
        b.left = '';
        b.right = '';
        b.width = '';
        window.scrollTo(0, savedScrollY);
      }
    }
  };
})();

// ---------- modals / sheets ----------
// Shared drag-to-dismiss gesture for any bottom sheet: started only from a
// dedicated handle element (so scrolling the sheet's own content is never
// hijacked), with a real-world velocity check in addition to distance, so a
// quick short flick dismisses even if it didn't travel far — the way an iOS
// sheet responds to a flick vs. a slow drag. Presentation-only: it flips
// classes/inline transform and calls the dismiss callback; no data/state.
function bindSheetDragToDismiss(sheetEl, handleEl, dismissFn){
  if(!sheetEl || !handleEl) return;
  let startY = 0, startT = 0, lastY = 0, lastT = 0, velocity = 0, deltaY = 0, dragging = false;
  handleEl.addEventListener('touchstart', function(e){
    dragging = true;
    startY = lastY = e.touches[0].clientY;
    startT = lastT = e.timeStamp;
    velocity = 0;
    deltaY = 0; // a previous cancelled gesture must not leak into this one
    sheetEl.style.transition = 'none';
  }, {passive:true});
  handleEl.addEventListener('touchmove', function(e){
    if(!dragging) return;
    const y = e.touches[0].clientY;
    const t = e.timeStamp;
    deltaY = y - startY;
    if(deltaY > 0){
      sheetEl.style.transform = 'translateY(' + deltaY + 'px)';
    } else {
      // Rubber-band resistance when dragging upward past the open position —
      // it should feel like it's stretching, not slide further up.
      sheetEl.style.transform = 'translateY(' + (deltaY * 0.15) + 'px)';
    }
    const dt = t - lastT;
    if(dt > 0) velocity = (y - lastY) / dt; // px/ms, +down / -up
    lastY = y; lastT = t;
  }, {passive:true});
  handleEl.addEventListener('touchend', function(){
    if(!dragging) return;
    dragging = false;
    sheetEl.style.transition = '';
    sheetEl.style.transform = '';
    const shouldDismiss = deltaY > 60 || (deltaY > 16 && velocity > 0.5);
    if(shouldDismiss) dismissFn();
    deltaY = 0; velocity = 0;
  });
  // OS-interrupted gesture: touchend never fires. Same cleanup as the
  // non-dismiss path of touchend; never dismisses.
  handleEl.addEventListener('touchcancel', function(){
    if(!dragging) return;
    dragging = false;
    sheetEl.style.transition = '';
    sheetEl.style.transform = '';
    deltaY = 0; velocity = 0;
  }, {passive:true});
}

let _modalHideTimer = null;

/* In-app confirmation layer. It sits above an existing sheet when needed, so
   destructive actions can be confirmed without replacing/dismissing an
   in-flight form or changing its state. */
function appConfirm(message, confirmLabel){
  confirmLabel = confirmLabel || 'تأیید';
  return new Promise(function(resolve){
    const root = document.getElementById('modalRoot');
    if(!root){ resolve(false); return; }
    const layer = document.createElement('div');
    layer.className = 'confirm-overlay';
    layer.setAttribute('role','alertdialog');
    layer.setAttribute('aria-modal','true');
    layer.innerHTML = '<div class="confirm-card"><div class="confirm-message"></div><div class="btn-row"><button type="button" class="btn secondary" data-confirm-cancel>انصراف</button><button type="button" class="btn danger" data-confirm-ok>'+esc(confirmLabel)+'</button></div></div>';
    layer.querySelector('.confirm-message').textContent = String(message || 'ادامه می‌دهید؟');
    root.appendChild(layer);
    let settled = false;
    function finish(value){
      if(settled) return;
      settled = true;
      layer.remove();
      resolve(value);
    }
    layer.querySelector('[data-confirm-cancel]').addEventListener('click', function(){ finish(false); });
    layer.querySelector('[data-confirm-ok]').addEventListener('click', function(){ finish(true); });
    layer.addEventListener('click', function(e){ if(e.target === layer) finish(false); });
    requestAnimationFrame(function(){
      const ok = layer.querySelector('[data-confirm-ok]');
      if(ok) ok.focus();
    });
  });
}


function closeModal(){
  const overlay = document.getElementById('overlay');
  const root = document.getElementById('modalRoot');
  if(!overlay){ if(root) root.innerHTML=''; return; }
  const invoiceBottomNav = document.getElementById('bottom-nav');
  if (invoiceBottomNav && invoiceBottomNav.dataset.invoiceHiddenPrev != null) {
    invoiceBottomNav.hidden = invoiceBottomNav.dataset.invoiceHiddenPrev === '1';
    delete invoiceBottomNav.dataset.invoiceHiddenPrev;
  }
  overlay.classList.remove('show');
  const sheetEl = overlay.querySelector('.sheet');
  if(sheetEl) sheetEl.classList.remove('show');
  try{ document.body.classList.remove('modal-open'); }catch(_e){}
  if(_modalHideTimer){ clearTimeout(_modalHideTimer); }
  _modalHideTimer = setTimeout(() => {
    _modalHideTimer = null;
    root.innerHTML = '';
    if(window.scrollX) window.scrollTo(0, window.scrollY);
  }, 300);
}

function openSheet(html, opts){
  opts = opts || {};
  const root = document.getElementById('modalRoot');

  // Generic sheets can also re-render in response to a control change.
  // Replace only the sheet content so the visible sheet/overlay never
  // closes and reopens during an in-sheet interaction.
  const existingGenericSheet = document.querySelector('#modalRoot .overlay.show .sheet:not(.inv-sheet-host)');
  if(existingGenericSheet && typeof html === 'string'){
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    const keep = Array.from(existingGenericSheet.children).filter(function(el){
      return el.id === 'closeX' || el.classList.contains('sheet-handle');
    });
    Array.from(existingGenericSheet.children).forEach(function(el){
      if(keep.indexOf(el) === -1) el.remove();
    });
    const frag = document.createDocumentFragment();
    Array.from(tmp.childNodes).forEach(function(n){ frag.appendChild(n); });
    existingGenericSheet.appendChild(frag);
    return;
  }

  // Invoice V6 re-renders its form when a row is added/removed or a payment
  // control changes. Re-presenting the whole sheet causes the visible
  // close/reopen jump on iPhone. When an invoice sheet is already open,
  // replace only its content shell and keep the existing overlay/sheet
  // presentation alive. Other sheets keep the original behavior.
  const existingInvoiceSheet = document.querySelector('#modalRoot .sheet.inv-sheet-host .inv-sheet-v2');
  if(existingInvoiceSheet && typeof html === 'string' && html.indexOf('class="inv-sheet-v2"') !== -1){
    const oldBody = existingInvoiceSheet.querySelector('.inv-body');
    const oldScrollTop = oldBody ? oldBody.scrollTop : 0;
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    const next = tmp.firstElementChild;
    if(next && next.classList.contains('inv-sheet-v2')){
      existingInvoiceSheet.replaceWith(next);
      requestAnimationFrame(function(){
        const body = document.querySelector('#modalRoot .sheet.inv-sheet-host .inv-body');
        if(body) body.scrollTop = oldScrollTop;
      });
      return;
    }
  }
  if(_modalHideTimer){ clearTimeout(_modalHideTimer); _modalHideTimer = null; }
  // مطمئن شو هر Modal قبلی کاملاً پاک شده (نه فقط مخفی) قبل از ساختن Modal جدید،
  // و یک reflow اجباری بین پاک‌شدن و رندر جدید انجام بده تا ظاهر (گوشه‌های گرد و غیره) بعد از باز/بسته‌شدن‌های مکرر خراب نشه
  root.innerHTML = '';
  void root.offsetHeight;
  root.innerHTML = `
    <div class="overlay" id="overlay">
      <div class="sheet" style="position:relative;">
        <div class="sheet-handle"></div>
        <button class="close-x" id="closeX" aria-label="بستن">×</button>
        ${html}
      </div>
    </div>`;
  try{ document.body.classList.add('modal-open'); }catch(_e){}
  const overlay = document.getElementById('overlay');
  const sheet = overlay.querySelector('.sheet');
  if (opts.dirtyCheck) {
    sheet.dataset.dirtyCheck = '1';
    sheet.dataset.dirty = '0';
    sheet.addEventListener('input', function(){ sheet.dataset.dirty = '1'; });
    sheet.addEventListener('change', function(){ sheet.dataset.dirty = '1'; });
  }
  requestAnimationFrame(() => {
    overlay.classList.add('show');
    sheet.classList.add('show');
  });
  overlay.addEventListener('click', async (e)=>{ if(e.target.id==='overlay'){ if(sheet.dataset.dirtyCheck === '1' && sheet.dataset.dirty === '1'){ if(await appConfirm('تغییرات ذخیره‌نشده از بین می‌رود؟')) closeModal(); } else closeModal(); } });
  overlay.addEventListener('touchmove', function(e){
    if(!e.target.closest('.sheet')) e.preventDefault();
  }, {passive:false});
  document.getElementById('closeX').addEventListener('click', async function(){ if(sheet.dataset.dirtyCheck === '1' && sheet.dataset.dirty === '1'){ if(await appConfirm('تغییرات ذخیره‌نشده از بین می‌رود؟')) closeModal(); } else closeModal(); });
  bindSheetDragToDismiss(sheet, sheet.querySelector('.sheet-handle'), async function(){ if(sheet.dataset.dirtyCheck === '1' && sheet.dataset.dirty === '1'){ if(await appConfirm('تغییرات ذخیره‌نشده از بین می‌رود؟')) closeModal(); } else closeModal(); });
}
