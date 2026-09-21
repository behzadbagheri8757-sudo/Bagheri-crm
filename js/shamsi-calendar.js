/* ==========================================================================
   js/shamsi-calendar.js — Shamsi Calendar Grid Picker
   Independent calendar-grid UI. Uses only helpers defined in js/ui.js:
     gregorianToJalali, jalaliToGregorian, jalaliMonthLength,
     isoToJalali, jalaliToISO, parseISODateParts,
     todayISO, enToFaDigits, esc, SHAMSI_MONTH_NAMES, bindSheetDragToDismiss
   Storage contract: hidden input keeps Gregorian YYYY-MM-DD.
   Exposes: window.ShamsiCalendar.open(fieldEl)
   Must be loaded after js/ui.js. If it is missing, openShamsiCalendarPicker()
   in js/ui.js logs a visible console.warn and falls back to the wheel picker.
   ========================================================================== */
(function(global){
  'use strict';

  // Persian week — first column is شنبه (Saturday), last is جمعه (Friday).
  var WEEKDAY_LABELS = ['شنبه','یکشنبه','دوشنبه','سه‌شنبه','چهارشنبه','پنجشنبه','جمعه'];

  /** Column index 0..6 where 0 = Saturday, 6 = Friday. */
  function getJalaliWeekday(jy, jm, jd){
    var g = jalaliToGregorian(jy, jm, jd);
    var d = new Date(g[0], g[1] - 1, g[2]);
    // JS getDay(): 0=Sun..6=Sat → Saturday-first column index: (getDay()+1)%7
    return (d.getDay() + 1) % 7;
  }

  /** Returns a flat list of 42 cells (6 rows × 7 cols) for the given month. */
  function buildGridModel(jy, jm){
    var dim = jalaliMonthLength(jy, jm);
    var firstWeekday = getJalaliWeekday(jy, jm, 1); // 0 = Saturday

    var py = jy, pm = jm - 1;
    if(pm < 1){ pm = 12; py -= 1; }
    var pDim = jalaliMonthLength(py, pm);

    var ny = jy, nm = jm + 1;
    if(nm > 12){ nm = 1; ny += 1; }

    var cells = [];
    // Previous-month trailing days
    for(var i = 0; i < firstWeekday; i++){
      cells.push({ jy: py, jm: pm, jd: pDim - firstWeekday + 1 + i, outside: true });
    }
    // Current-month days
    for(var d = 1; d <= dim; d++){
      cells.push({ jy: jy, jm: jm, jd: d, outside: false });
    }
    // Next-month leading days to fill 42 cells
    var nextDay = 1;
    while(cells.length < 42){
      cells.push({ jy: ny, jm: nm, jd: nextDay++, outside: true });
    }
    return cells;
  }

  function openCalendarForField(fieldEl){
    if(!fieldEl || !fieldEl.closest) return;
    var root = fieldEl.closest('[data-shamsi-root]');
    if(!root) return;
    var hid = root.querySelector('[data-shamsi-hidden]');
    if(!hid) return;

    var previousActive = document.activeElement;

    var iso = (hid.value && parseISODateParts(hid.value)) ? String(hid.value).slice(0, 10) : todayISO();
    var j = isoToJalali(iso) || gregorianToJalali(
      new Date().getFullYear(), new Date().getMonth() + 1, new Date().getDate()
    );
    var viewJy = j[0], viewJm = j[1];
    var selJy = j[0], selJm = j[1], selJd = j[2];

    var tIso = todayISO();
    var tJ = isoToJalali(tIso) || gregorianToJalali(
      new Date().getFullYear(), new Date().getMonth() + 1, new Date().getDate()
    );

    // Single-instance guard shared with the wheel picker (same container id).
    var prev = document.getElementById('shamsi-sheet-root');
    if(prev) prev.remove();

    var overlay = document.createElement('div');
    overlay.id = 'shamsi-sheet-root';
    overlay.className = 'shamsi-sheet-overlay';
    overlay.innerHTML =
      '<div class="shamsi-sheet shamsi-calendar-sheet" role="dialog" aria-modal="true" aria-labelledby="shamsi-sheet-title">' +
        '<div class="shamsi-sheet-handle" aria-hidden="true"></div>' +
        '<div class="shamsi-sheet-toolbar">' +
          '<button type="button" class="shamsi-sheet-btn" data-shamsi-cancel="1">لغو</button>' +
          '<span class="shamsi-sheet-title" id="shamsi-sheet-title">انتخاب تاریخ</span>' +
          '<button type="button" class="shamsi-sheet-btn shamsi-sheet-done" data-shamsi-done="1">تأیید</button>' +
        '</div>' +
        '<div class="shamsi-calendar">' +
          '<div class="shamsi-calendar-header">' +
            '<button type="button" class="shamsi-calendar-nav" data-shamsi-prev="1" aria-label="ماه قبل">‹</button>' +
            '<div class="shamsi-calendar-title" data-shamsi-title="1"></div>' +
            '<button type="button" class="shamsi-calendar-nav" data-shamsi-next="1" aria-label="ماه بعد">›</button>' +
          '</div>' +
          '<div class="shamsi-calendar-weekdays" aria-hidden="true">' +
            WEEKDAY_LABELS.map(function(w){ return '<span>' + w + '</span>'; }).join('') +
          '</div>' +
          '<div class="shamsi-calendar-grid" role="grid"></div>' +
        '</div>' +
      '</div>';

    document.body.appendChild(overlay);

    var sheetEl = overlay.querySelector('.shamsi-sheet');
    var handleEl = overlay.querySelector('.shamsi-sheet-handle');
    var titleEl = overlay.querySelector('[data-shamsi-title]');
    var gridEl = overlay.querySelector('.shamsi-calendar-grid');

    function renderGrid(){
      titleEl.textContent = SHAMSI_MONTH_NAMES[viewJm - 1] + ' ' + enToFaDigits(String(viewJy));
      var cells = buildGridModel(viewJy, viewJm);
      var html = '';
      for(var i = 0; i < cells.length; i++){
        var c = cells[i];
        var isSel = (c.jy === selJy && c.jm === selJm && c.jd === selJd);
        var isToday = (c.jy === tJ[0] && c.jm === tJ[1] && c.jd === tJ[2]);
        var cls = 'shamsi-calendar-day';
        if(c.outside) cls += ' is-outside';
        if(isToday) cls += ' is-today';
        if(isSel) cls += ' is-selected';
        html += '<button type="button" class="' + cls + '"' +
                ' data-jy="' + c.jy + '" data-jm="' + c.jm + '" data-jd="' + c.jd + '"' +
                ' data-outside="' + (c.outside ? '1' : '0') + '">' +
                enToFaDigits(String(c.jd)) + '</button>';
      }
      gridEl.innerHTML = html;
    }

    renderGrid();

    requestAnimationFrame(function(){
      overlay.classList.add('show');
    });

    function goPrev(){
      viewJm -= 1;
      if(viewJm < 1){ viewJm = 12; viewJy -= 1; }
      renderGrid();
    }
    function goNext(){
      viewJm += 1;
      if(viewJm > 12){ viewJm = 1; viewJy += 1; }
      renderGrid();
    }

    overlay.querySelector('[data-shamsi-prev]').addEventListener('click', goPrev);
    overlay.querySelector('[data-shamsi-next]').addEventListener('click', goNext);

    gridEl.addEventListener('click', function(e){
      var btn = e.target.closest ? e.target.closest('.shamsi-calendar-day') : null;
      if(!btn) return;
      var cjy = parseInt(btn.getAttribute('data-jy'), 10);
      var cjm = parseInt(btn.getAttribute('data-jm'), 10);
      var cjd = parseInt(btn.getAttribute('data-jd'), 10);
      selJy = cjy; selJm = cjm; selJd = cjd;
      if(cjy !== viewJy || cjm !== viewJm){
        viewJy = cjy; viewJm = cjm;
      }
      renderGrid();
    });

    // Horizontal swipe on the grid to change month. Horizontal intent is
    // required; a mostly-vertical gesture is ignored so page/grid scrolling
    // is not hijacked.
    var sx = 0, sy = 0, tracking = false, intentLocked = false, isHorizontal = false;
    var SWIPE_THRESHOLD = 40;
    gridEl.addEventListener('touchstart', function(e){
      if(e.touches.length !== 1) return;
      tracking = true;
      intentLocked = false;
      isHorizontal = false;
      sx = e.touches[0].clientX;
      sy = e.touches[0].clientY;
    }, { passive: true });
    gridEl.addEventListener('touchmove', function(e){
      if(!tracking || e.touches.length !== 1) return;
      var dx = e.touches[0].clientX - sx;
      var dy = e.touches[0].clientY - sy;
      if(!intentLocked && (Math.abs(dx) > 8 || Math.abs(dy) > 8)){
        intentLocked = true;
        isHorizontal = Math.abs(dx) > Math.abs(dy);
      }
    }, { passive: true });
    gridEl.addEventListener('touchend', function(e){
      if(!tracking) return;
      tracking = false;
      if(!intentLocked || !isHorizontal) return;
      var touch = e.changedTouches[0];
      var dx = touch.clientX - sx;
      if(Math.abs(dx) < SWIPE_THRESHOLD) return;
      if(dx > 0) goPrev(); else goNext();
    }, { passive: true });
    gridEl.addEventListener('touchcancel', function(){ tracking = false; }, { passive: true });

    // Unified close lifecycle.
    var closed = false;
    function onKey(e){
      if(e.key === 'Escape' || e.keyCode === 27){
        e.preventDefault();
        close(false);
      }
    }
    function close(applyValues){
      if(closed) return;
      closed = true;
      document.removeEventListener('keydown', onKey, true);

      if(applyValues){
        var newIso = jalaliToISO(selJy, selJm, selJd);
        var old = hid.value;
        hid.value = newIso;
        var field = root.querySelector('[data-shamsi-field]');
        if(field) field.value = enToFaDigits(selJy + '/' + selJm + '/' + selJd);
        if(old !== newIso){
          try{
            hid.dispatchEvent(new Event('input', { bubbles: true }));
            hid.dispatchEvent(new Event('change', { bubbles: true }));
          }catch(e){}
        }
      }

      overlay.classList.remove('show');
      setTimeout(function(){
        if(overlay.parentNode) overlay.remove();
        if(previousActive && typeof previousActive.focus === 'function'){
          try{ previousActive.focus(); }catch(e){}
        }
      }, 340);
    }

    overlay.addEventListener('click', function(e){
      if(e.target === overlay) close(false);
    });
    overlay.querySelector('[data-shamsi-cancel]').addEventListener('click', function(e){
      e.preventDefault(); close(false);
    });
    overlay.querySelector('[data-shamsi-done]').addEventListener('click', function(e){
      e.preventDefault(); close(true);
    });
    document.addEventListener('keydown', onKey, true);

    if(typeof bindSheetDragToDismiss === 'function'){
      bindSheetDragToDismiss(sheetEl, handleEl, function(){ close(false); });
    }

    requestAnimationFrame(function(){
      var done = overlay.querySelector('[data-shamsi-done]');
      if(done){ try{ done.focus(); }catch(e){} }
    });
  }

  global.ShamsiCalendar = {
    open: openCalendarForField,
    // Exposed for tests / debugging only.
    _buildGridModel: buildGridModel,
    _getJalaliWeekday: getJalaliWeekday
  };
})(typeof window !== 'undefined' ? window : this);
