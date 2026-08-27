/* js/views/game-center.js — Sales Game SPA view
   UI/UX polish + Persian localization. Reads GameLogic snapshot only.
*/
'use strict';

(function (global) {
  function esc(s) {
    if (typeof global.esc === 'function') return global.esc(s);
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /** Persian digits, LTR-isolated so RTL does not reverse "0 / 15". */
  function faNum(n) {
    var v = Math.round(Number(n) || 0);
    var s;
    try { s = v.toLocaleString('fa-IR'); }
    catch (e) { s = String(v); }
    return '\u200E' + s + '\u200E';
  }

  function tomanLocal(n) {
    var s;
    if (typeof toman === 'function') s = toman(n);
    else {
      try { s = (Math.round(Number(n) || 0)).toLocaleString('fa-IR'); }
      catch (e) { s = String(Math.round(Number(n) || 0)); }
    }
    return '\u200E' + s + '\u200E';
  }

  var ICO = {
    brand: '<svg class="gc-ico" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 21l8 0"/><path d="M12 17l0 4"/><path d="M7 4l10 0"/><path d="M17 4v8a5 5 0 0 1 -10 0v-8"/><path d="M5 9m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0"/><path d="M19 9m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0"/></svg>',
    brandMark: '<svg class="gc-ico" viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v3m-4 -3v6m8 -6v6"/><path d="M12 18.5l-3 1.5l.5 -3.5l-2 -2l3 -.5l1.5 -3l1.5 3l3 .5l-2 2l.5 3.5z"/></svg>',
    evaluation: '<svg class="gc-ico" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 5h-2a2 2 0 0 0 -2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-12a2 2 0 0 0 -2 -2h-2"/><path d="M9 3m0 2a2 2 0 0 1 2 -2h2a2 2 0 0 1 2 2v0a2 2 0 0 1 -2 2h-2a2 2 0 0 1 -2 -2z"/><path d="M9 14l2 2l4 -4"/></svg>',
    visit: '<svg class="gc-ico" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 11a3 3 0 1 0 6 0a3 3 0 0 0 -6 0"/><path d="M17.657 16.657l-4.243 4.243a2 2 0 0 1 -2.827 0l-4.244 -4.243a8 8 0 1 1 11.314 0z"/></svg>',
    sales: '<svg class="gc-ico" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 21v-16a2 2 0 0 1 2 -2h10a2 2 0 0 1 2 2v16l-3 -2l-2 2l-2 -2l-2 2l-2 -2l-3 2"/><path d="M14 8h-2.5a1.5 1.5 0 0 0 0 3h1a1.5 1.5 0 0 1 0 3h-2.5m2 0v1.5m0 -9v1.5"/></svg>',
    mission: '<svg class="gc-ico" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 5.5l1.5 1.5l2.5 -2.5"/><path d="M3.5 11.5l1.5 1.5l2.5 -2.5"/><path d="M3.5 17.5l1.5 1.5l2.5 -2.5"/><path d="M11 6l9 0"/><path d="M11 12l9 0"/><path d="M11 18l9 0"/></svg>',
    monthly: '<svg class="gc-ico" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0"/><path d="M12 12m-5 0a5 5 0 1 0 10 0a5 5 0 1 0 -10 0"/><path d="M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0 -18 0"/></svg>',
    streak: '<svg class="gc-ico" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 10.941c2.333 -3.308 .167 -7.823 -1 -8.941c0 3.395 -2.235 5.299 -3.667 6.706c-1.43 1.408 -2.333 3.621 -2.333 5.588c0 3.704 3.134 6.706 7 6.706s7 -3.002 7 -6.706c0 -1.712 -1.232 -4.403 -2.333 -5.588c-2.084 3.353 -3.257 3.353 -4.667 2.235"/></svg>',
    xp: '<svg class="gc-ico" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13 3l0 7l6 0l-8 11l0 -7l-6 0l8 -11"/></svg>',
    check: '<svg class="gc-ico" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5l10 -10"/></svg>',
    payment: '<svg class="gc-ico" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 12a3 3 0 1 0 6 0a3 3 0 0 0 -6 0"/><path d="M3 8a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v8a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2z"/><path d="M18 12h.01"/><path d="M6 12h.01"/></svg>'
  };

  function missionIcon(type) {
    if (type === 'evaluation') return ICO.evaluation;
    if (type === 'customerVisit') return ICO.visit;
    if (type === 'invoice') return ICO.sales;
    return ICO.mission;
  }

  function missionTitleFa(item) {
    if (item.type === 'evaluation') return 'ارزیابی';
    if (item.type === 'customerVisit') return 'ویزیت مشتری';
    if (item.type === 'invoice') return 'فروش';
    return item.label || item.id || 'مأموریت';
  }

  function missionCard(item) {
    var t = Math.max(0, Number(item.target) || 0);
    var c = Math.max(0, Number(item.current) || 0);
    var pct = t > 0 ? Math.min(100, (c / t) * 100) : 0;
    var done = t > 0 && c >= t;
    var started = c > 0;
    var state = done ? ' is-complete' : (started ? ' is-active' : ' is-dormant');

    return (
      '<article class="gc-mission' + state + '">' +
        '<div class="gc-mission-row">' +
          '<div class="gc-mission-icon">' + missionIcon(item.type) + '</div>' +
          '<div class="gc-mission-body">' +
            '<div class="gc-mission-head">' +
              '<span class="gc-mission-title">' + esc(missionTitleFa(item)) + '</span>' +
              '<span class="gc-mission-count" dir="ltr">' +
                faNum(c) + ' <span class="gc-slash">/</span> ' + faNum(t) +
              '</span>' +
            '</div>' +
            '<div class="gc-track" role="progressbar" aria-valuenow="' + Math.round(pct) + '" aria-valuemin="0" aria-valuemax="100">' +
              '<div class="gc-track-fill" style="width:' + pct + '%"></div>' +
            '</div>' +
          '</div>' +
          (done
            ? '<div class="gc-mission-done" title="کامل">' + ICO.check + '</div>'
            : '') +
        '</div>' +
      '</article>'
    );
  }

  function monthlyBlock(monthly) {
    monthly = monthly || {};
    var hasTarget = (Number(monthly.target) || 0) > 0;
    var pct = hasTarget ? Math.min(100, (Number(monthly.ratio) || 0) * 100) : 0;
    var reached = !!monthly.reached;
    return (
      '<section class="gc-section">' +
        '<div class="gc-section-head">' +
          '<span class="gc-section-ico">' + ICO.monthly + '</span>' +
          '<h3 class="gc-section-title">هدف فروش ماهانه</h3>' +
        '</div>' +
        '<div class="gc-panel' + (reached ? ' is-reached' : '') + '">' +
          (hasTarget
            ? '<div class="gc-monthly-pct" dir="ltr">' + faNum(Math.round(pct)) + '<span class="gc-pct-sign">٪</span></div>'
            : '<div class="gc-monthly-pct gc-muted-strong">—</div>') +
          '<div class="gc-track gc-track-lg" role="progressbar" aria-valuenow="' + Math.round(pct) + '" aria-valuemin="0" aria-valuemax="100">' +
            '<div class="gc-track-fill" style="width:' + (hasTarget ? pct : 0) + '%"></div>' +
          '</div>' +
          '<div class="gc-monthly-amounts" dir="ltr">' +
            tomanLocal(monthly.mtdSales || 0) +
            ' <span class="gc-slash">/</span> ' +
            tomanLocal(monthly.target || 0) +
            ' <span class="gc-unit">ت</span>' +
          '</div>' +
          '<div class="gc-soft">' +
            (hasTarget ? (reached ? 'هدف ماهانه محقق شد' : 'در مسیر هدف') : 'هدف ماهانه تنظیم نشده') +
          '</div>' +
        '</div>' +
      '</section>'
    );
  }

  function continuityBlock(snap) {
    var cont = snap.continuity || {};
    var status;
    if (snap.isRestDay) status = 'جمعه — روز استراحت';
    else if (cont.todayActive) status = 'امروز فعال';
    else status = 'هنوز فعال نشده';
    return (
      '<section class="gc-section">' +
        '<div class="gc-section-head">' +
          '<span class="gc-section-ico">' + ICO.streak + '</span>' +
          '<h3 class="gc-section-title">تداوم</h3>' +
        '</div>' +
        '<div class="gc-panel gc-panel-inline">' +
          '<div class="gc-hero">' +
            '<span class="gc-hero-num" dir="ltr">' + faNum(cont.currentStreak || 0) + '</span>' +
            '<span class="gc-hero-lab">روز</span>' +
          '</div>' +
          '<div class="gc-inline-meta">' +
            '<span class="gc-pill' + (cont.todayActive && !snap.isRestDay ? ' is-on' : '') + '">' + esc(status) + '</span>' +
            '<span class="gc-soft">بهترین: <span dir="ltr">' + faNum(cont.bestStreak || 0) + '</span></span>' +
          '</div>' +
        '</div>' +
      '</section>'
    );
  }

  function xpBlock(xp) {
    xp = xp || {};
    return (
      '<section class="gc-section">' +
        '<div class="gc-section-head">' +
          '<span class="gc-section-ico">' + ICO.xp + '</span>' +
          '<h3 class="gc-section-title">امتیاز</h3>' +
        '</div>' +
        '<div class="gc-xp-row">' +
          '<div class="gc-panel gc-xp">' +
            '<div class="gc-soft">امتیاز امروز</div>' +
            '<div class="gc-xp-num" dir="ltr">' + faNum(xp.today || 0) + '</div>' +
          '</div>' +
          '<div class="gc-panel gc-xp">' +
            '<div class="gc-soft">امتیاز کل</div>' +
            '<div class="gc-xp-num" dir="ltr">' + faNum(xp.total || 0) + '</div>' +
          '</div>' +
        '</div>' +
      '</section>'
    );
  }

  function renderMorning(snap) {
    var q = (snap.quests && snap.quests.quests) || [];
    var missions = q.map(missionCard).join('');
    return (
      '<div class="gc-shell">' +
        '<section class="gc-section">' +
          '<div class="gc-section-head">' +
            '<span class="gc-section-ico">' + ICO.mission + '</span>' +
            '<h3 class="gc-section-title">مأموریت‌های امروز</h3>' +
          '</div>' +
          '<div class="gc-missions">' +
            (missions || '<div class="empty">مأموریتی تعریف نشده</div>') +
          '</div>' +
        '</section>' +
        monthlyBlock(snap.monthly) +
        continuityBlock(snap) +
        xpBlock(snap.xp) +
        '<p class="gc-hint">صبح مأموریت را ببین → برو بازار. شب نتیجه را اینجا چک کن.</p>' +
      '</div>'
    );
  }

  function renderEvening(snap) {
    var c = snap.counts || {};
    var q = (snap.quests && snap.quests.quests) || [];
    var allQ = snap.quests && snap.quests.allComplete;

    var missionLines = q.map(function (item) {
      return (
        '<div class="gc-line">' +
          '<span class="gc-line-lab">' +
            '<span class="gc-line-ico">' + missionIcon(item.type) + '</span>' +
            esc(missionTitleFa(item)) +
          '</span>' +
          '<span class="gc-line-val' + (item.complete ? ' is-ok' : '') + '" dir="ltr">' +
            faNum(item.current) + ' / ' + faNum(item.target) +
            (item.complete ? ' ✓' : '') +
          '</span>' +
        '</div>'
      );
    }).join('');

    return (
      '<div class="gc-shell">' +
        '<section class="gc-section">' +
          '<div class="gc-section-head"><h3 class="gc-section-title">نتیجه کسب‌وکار</h3></div>' +
          '<div class="gc-panel">' +
            '<div class="gc-kpi-grid">' +
              '<div class="gc-kpi"><div class="gc-kpi-lab">' + ICO.evaluation + '<span class="gc-soft">ارزیابی</span></div><div class="gc-kpi-num" dir="ltr">' + faNum(c.evaluation || 0) + '</div></div>' +
              '<div class="gc-kpi"><div class="gc-kpi-lab">' + ICO.visit + '<span class="gc-soft">ویزیت</span></div><div class="gc-kpi-num" dir="ltr">' + faNum(c.customerVisit || 0) + '</div></div>' +
              '<div class="gc-kpi"><div class="gc-kpi-lab">' + ICO.sales + '<span class="gc-soft">فروش</span></div><div class="gc-kpi-num" dir="ltr">' + faNum(c.invoice || 0) + '</div></div>' +
              '<div class="gc-kpi"><div class="gc-kpi-lab">' + ICO.payment + '<span class="gc-soft">پرداخت</span></div><div class="gc-kpi-num" dir="ltr">' + faNum(c.payment || 0) + '</div></div>' +
            '</div>' +
            '<div class="gc-line gc-line-last">' +
              '<span class="gc-line-lab">فعالیت معتبر امروز</span>' +
              '<span class="gc-line-val" dir="ltr">' + faNum(c.totalValid || 0) + '</span>' +
            '</div>' +
          '</div>' +
        '</section>' +
        monthlyBlock(snap.monthly) +
        '<section class="gc-section">' +
          '<div class="gc-section-head"><h3 class="gc-section-title">فعالیت امروز</h3></div>' +
          '<div class="gc-panel">' +
            missionLines +
            '<div class="gc-line gc-line-last">' +
              '<span class="gc-line-lab">پاداش هر ۳ مأموریت</span>' +
              '<span class="gc-line-val' + (allQ ? ' is-ok' : '') + '">' +
                (allQ ? 'واجد شرایط' : 'هنوز نه') +
              '</span>' +
            '</div>' +
          '</div>' +
        '</section>' +
        xpBlock(snap.xp) +
        continuityBlock(snap) +
      '</div>'
    );
  }

  /** Always open on Morning; user switches via compact toggle. */
  function defaultMode() {
    return 'morning';
  }

  var GameCenterView = {
    mount: function (root) {
      if (!root) return function () {};
      var mode = defaultMode();
      var token = null;
      var unmounted = false;

      async function draw() {
        if (unmounted || !root) return;
        var snap = null;
        var errMsg = '';
        try {
          if (typeof GameLogic === 'undefined' || !GameLogic || typeof GameLogic.getSnapshot !== 'function') {
            errMsg = 'هسته بازی بارگذاری نشده است.';
          } else {
            snap = await GameLogic.getSnapshot({ autoClaim: true });
          }
        } catch (e) {
          console.warn('[GameCenter] snapshot failed', e);
          errMsg = 'خطا در خواندن وضعیت بازی.';
        }
        if (unmounted || !root) return;

        var body = errMsg
          ? '<div class="empty">' + esc(errMsg) + '</div>'
          : (mode === 'morning' ? renderMorning(snap) : renderEvening(snap));

        root.innerHTML =
          '<div class="gc-page">' +
            /* Use div, NOT <header>: global app.css styles ALL header tags as navy app bar */
            '<div class="gc-header">' +
              '<div class="gc-title-row">' +
                '<h1 class="gc-title">Sales Game</h1>' +
                '<span class="gc-title-line" aria-hidden="true"></span>' +
                '<span class="gc-title-mark" aria-hidden="true">' + ICO.brandMark + '</span>' +
              '</div>' +
              '<div class="gc-seg" role="tablist">' +
                '<button type="button" role="tab" class="gc-seg-btn' + (mode === 'morning' ? ' is-active' : '') + '" data-gc-mode="morning" aria-selected="' + (mode === 'morning') + '">صبح</button>' +
                '<button type="button" role="tab" class="gc-seg-btn' + (mode === 'evening' ? ' is-active' : '') + '" data-gc-mode="evening" aria-selected="' + (mode === 'evening') + '">نتیجه</button>' +
              '</div>' +
            '</div>' +
            body +
          '</div>';

        root.querySelectorAll('[data-gc-mode]').forEach(function (btn) {
          btn.addEventListener('click', function () {
            mode = btn.getAttribute('data-gc-mode') || 'morning';
            draw();
          });
        });
      }

      token = typeof ViewHost !== 'undefined' && ViewHost.setRefresh
        ? ViewHost.setRefresh(function () { draw(); })
        : null;

      draw();

      return function unmount() {
        unmounted = true;
        if (token != null && typeof ViewHost !== 'undefined' && ViewHost.clearRefresh) {
          ViewHost.clearRefresh(token);
        }
      };
    }
  };

  global.GameCenterView = GameCenterView;
})(typeof window !== 'undefined' ? window : globalThis);
