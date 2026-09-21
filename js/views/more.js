/* js/views/more.js — Full-page More route (#/more).
   Navigation-only. Replaces the old More bottom sheet as the primary
   entry point for secondary destinations.

   Uses the existing AppIcons registry (js/icons.js) and the existing
   hash router (js/router.js). No business logic, no data access,
   no modal/sheet, no scroll-lock, no financial calculation.

   Approved information architecture (5 groups, 10 destinations):
     1. عملیات میدانی       (3): هشدارهای زودهنگام، ویزیت مشتریان، ارزیابی مغازه‌ها
     2. عملکرد فروش          (1): مرکز بازی فروش
     3. عملکرد مالی          (3): پرداخت‌ها، گزارش‌ها، چک‌ها
     4. مدیریت و پشتیبانی    (2): انبار، تأمین‌کنندگان
     5. تنظیمات              (1): پشتیبان‌گیری و تنظیمات

   Rhythm: 3 → 1 → 3 → 2 → 1
*/
'use strict';

(function (global) {
  const GROUPS = [
    {
      title: 'عملیات میدانی',
      items: [
        { label: 'هشدارهای زودهنگام', href: '#/watches',   iconKey: 'checklist' },
        { label: 'ویزیت مشتریان',    href: '#/visits',    iconKey: 'visit' },
        { label: 'ارزیابی مغازه‌ها',  href: '#/prospects', iconKey: 'buildingStorefront' },
      ],
    },
    {
      title: 'عملکرد فروش',
      items: [
        { label: 'مرکز بازی فروش', href: '#/game', iconKey: 'trophy' },
      ],
    },
    {
      title: 'عملکرد مالی',
      items: [
        { label: 'پرداخت‌ها', href: '#/payments', iconKey: 'banknotes' },
        { label: 'گزارش‌ها',  href: '#/reports',  iconKey: 'chartBar' },
        { label: 'چک‌ها',     href: '#/checks',   iconKey: 'cheque' },
      ],
    },
    {
      title: 'مدیریت و پشتیبانی',
      items: [
        { label: 'انبار',         href: '#/inventory', iconKey: 'warehouse' },
        { label: 'تأمین‌کنندگان', href: '#/suppliers', iconKey: 'truck' },
      ],
    },
    {
      title: 'تنظیمات',
      items: [
        { label: 'پشتیبان‌گیری و تنظیمات', href: '#/settings', iconKey: 'cog' },
      ],
    },
  ];

  // Canonical project chevron — same inline SVG used in js/nav.js
  // (fillMoreSheetList → .more-sheet-item-chevron) and, as a mask-image,
  // in css/app.css (a.ledger-row:not(.action-row)::after). Path
  // "m15 18-6-6 6-6" draws a "<" shape (tip pointing to the left edge),
  // which is the correct forward direction in this RTL layout.
  const CHEVRON_SVG =
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="m15 18-6-6 6-6"/>' +
    '</svg>';

  function iconHtml(iconKey) {
    try {
      if (typeof AppIcons !== 'undefined' && typeof AppIcons.render === 'function') {
        return AppIcons.render(iconKey, { size: 22 });
      }
    } catch (e) { /* ignore — falls back to empty string */ }
    return '';
  }

  function rowHtml(item) {
    const spaPath = item.href.replace(/^#/, '');
    return '<a class="more-row" href="' + item.href + '" data-spa-path="' + spaPath + '">' +
      '<span class="more-row-icon" aria-hidden="true">' + iconHtml(item.iconKey) + '</span>' +
      '<span class="more-row-title">' + item.label + '</span>' +
      '<span class="more-row-chevron" aria-hidden="true">' + CHEVRON_SVG + '</span>' +
    '</a>';
  }

  function groupHtml(group) {
    return '<section class="more-group">' +
      '<h2 class="more-group-title">' + group.title + '</h2>' +
      '<div class="more-group-card">' + group.items.map(rowHtml).join('') + '</div>' +
    '</section>';
  }

  function draw(root) {
    if (!root) return;
    root.innerHTML = '<div class="more-page">' + GROUPS.map(groupHtml).join('') + '</div>';

    // Explicit SPA navigation (defensive: plain hash hrefs work too, but
    // going through AppRouter preserves the scroll-position bookkeeping
    // used by every other primary-nav destination in the app).
    if (typeof isSpaShell === 'function' && isSpaShell() &&
        typeof AppRouter !== 'undefined' && AppRouter.navigate) {
      root.querySelectorAll('a[data-spa-path]').forEach(function (a) {
        a.addEventListener('click', function (e) {
          e.preventDefault();
          AppRouter.navigate(a.getAttribute('data-spa-path'));
        });
      });
    }
  }

  function mount(root, params) {
    if (!root) return function () {};

    const fab = document.getElementById('fab');
    if (fab) { fab.style.display = 'none'; fab.onclick = null; }

    draw(root);

    return function unmount() {
      root.innerHTML = '';
    };
  }

  global.MoreView = { mount: mount, unmount: function () {} };
})(typeof window !== 'undefined' ? window : this);
