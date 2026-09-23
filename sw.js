/* sw.js — App Shell only. Never touches IndexedDB or CRM business data.
 *
 * Goal: one successful online visit → full shell in Cache Storage →
 * entire CRM usable offline through the SPA shell.
 *
 * CACHE_NAME: bump on every deploy that changes static assets.
 */
'use strict';

/* CHANGED: v56 -> v57 (More bottom sheet converted to a dedicated full-page
   SPA route #/more. New view js/views/more.js added to the precache list;
   old More sheet code and CSS left in place for rollback. No other shell
   asset changed.) */
/* CHANGED: v55 -> v56 (global typography weight retuning: all UI font-weight tokens/literals
   lowered by one 100-weight tier, floor 400, so the app is visually balanced with iPhone
   "Bold Text" accessibility setting ON, which is the user's real-world baseline. Print/export
   invoice document typography intentionally left unchanged. No font-family, font-size,
   line-height, layout, or business logic changed.) */
/* CHANGED: v53 -> v54 (surgical retry-orphan graph preservation, validation focus, header geometry, in-app confirmations, and scoped hint/touch fixes). Previous v53 behavior is otherwise preserved.
   The build also retains the v53 scroll-linked header geometry and native-style tab selection.
   */
/* Legacy v53 note: Header geometry, semantic Back, and native-style tab selection refined as a continuous,
   scroll-linked --header-progress custom property instead of a threshold
   class toggle with its own CSS transition — the old version kept
   animating for ~220ms after scroll stopped/reversed, which read as a
   snap/lag; verified via headless scroll test: progress now tracks
   scrollY 1:1 and reverses identically. Removed the now-duplicate "داشبورد"
   <h2> inside Dashboard's own content — the header already shows it as the
   page title since the brand-name/page-title fix) */
/* CHANGED: v63 -> v64 (Computation Bank is now part of the offline app shell. Added js/computation-bank.js to PRECACHE_URLS and bumped the shell cache version so the execution-scoped bank is available offline. No business logic changed.)
   */
/* CHANGED: v61 -> v62 (offline-shell fix only: css/shamsi-calendar.css and
   js/shamsi-calendar.js are loaded by index.html on every page load but were
   missing from PRECACHE_URLS, so a freshly-activated cache version had no
   guarantee they'd be cached before the first offline use. Added both to the
   precache list; no other asset, route, or business logic touched.) */
const CACHE_NAME = 'baqeri-shell-v64';

/** App Shell — paths relative to this SW (same directory as index.html). */
const PRECACHE_URLS = [
  './index.html',
  './css/app.css',
  './css/visual-grammar.css',
  './css/visual-grammar-components.css',
  './css/visual-grammar-pages.css',
  './css/shamsi-calendar.css',
  './js/shamsi-calendar.js',
  './js/models.js',
  './js/ui.js',
  './js/db.js',
  './js/location.js',
  './js/calc.js',
  './js/computation-bank.js',
  './js/stock.js',
  './js/backup.js',
  './js/pin-lock.js',
  './js/icons.js',
  './js/nav.js',
  './js/app.js',
  './js/prospect-scoring.js',
  './js/prospect-db.js',
  './js/prospect-core.js',
  './js/game-config.js',
  './js/game-logic.js',
  './js/sw-register.js',
  './js/router.js',
  './js/view.host.js',
  './js/views/dashboard.js',
  './js/views/reports.js',
  './js/views/products.js',
  './js/views/inventory.js',
  './js/views/customers.js',
  './js/views/customer.js',
  './js/views/payments.js',
  './js/views/invoices.js',
  './js/views/suppliers.js',
  './js/views/supplier.js',
  './js/views/visits.js',
  './js/views/prospects.js',
  './js/views/prospect.js',
  './js/views/prospect-routes.js',
  './js/views/locations.js',
  './js/views/evaluation.js',
  './js/views/checks.js',
  './js/views/invoice.js',
  './js/views/game-center.js',
  './js/views/settings.js',
  './js/views/more.js',
  './vendor/xlsx.full.min.js',
  './vendor/html2canvas.min.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './icons/icon-152.png',
  './logo-export.png',
  './fonts/Vazirmatn[wght].woff2',
  './js/intelligence/persistence.js',
  './js/intelligence/feedback.js',
  './js/intelligence/baseline_manager.js',
  './js/intelligence/seasonality.js',
  './js/intelligence/interpretation.js',
  './js/intelligence/signals.js',
  './js/intelligence/sku_intelligence.js',
  './js/intelligence/risk.js',
  './js/intelligence/priority.js',
  './js/intelligence/action.js',
  './js/intelligence/watch_lifecycle.js',
  './js/views/watches.js',
];

/** Critical SPA shell/assets that must exist for install to be considered successful. */
const CRITICAL_SHELLS = [
  './index.html',
  './css/app.css',
  './js/db.js',
  './js/nav.js',
  './js/app.js',
  './js/models.js',
  './js/ui.js',
  './js/router.js',
  './js/view.host.js',
  './js/views/dashboard.js'
];

/**
 * Precache each URL individually.
 * One 404 must NOT wipe the whole install (unlike cache.addAll all-or-nothing).
 * Install fails only if a critical shell is missing.
 */
function precacheShell() {
  return caches.open(CACHE_NAME).then(function (cache) {
    return Promise.all(
      PRECACHE_URLS.map(function (url) {
        return fetch(url, { cache: 'reload' })
          .then(function (response) {
            if (!response || !response.ok) {
              throw new Error('HTTP ' + (response && response.status));
            }
            return cache.put(url, response);
          })
          .then(function () {
            return { url: url, ok: true };
          })
          .catch(function (err) {
            console.error('[SW] precache failed:', url, err && err.message);
            return { url: url, ok: false, err: String(err && err.message || err) };
          });
      })
    ).then(function (results) {
      var failed = results.filter(function (r) { return !r.ok; });
      var criticalFailed = failed.filter(function (r) {
        return CRITICAL_SHELLS.indexOf(r.url) !== -1;
      });
      if (failed.length) {
        console.warn('[SW] precache non-critical failures:', failed.length);
      }
      if (criticalFailed.length) {
        console.error('[SW] CRITICAL precache failures:', criticalFailed);
        return Promise.reject(new Error(
          'Critical shell missing: ' + criticalFailed.map(function (r) { return r.url; }).join(', ')
        ));
      }
      return results;
    });
  });
}

self.addEventListener('install', function (event) {
  // Activate as soon as install succeeds so the SAME day offline session
  // can use the precache (first-install readiness).
  // clients.claim is in activate — does not reload an open page by itself.
  event.waitUntil(
    precacheShell().then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.map(function (key) {
          if (key !== CACHE_NAME && key.indexOf('baqeri-shell-') === 0) {
            return caches.delete(key);
          }
        })
      );
    }).then(function () {
      // Take control of open pages so the next navigation is offline-capable
      // without requiring a second visit. Does not force reload mid-form.
      return self.clients.claim();
    })
  );
});

/** Last path segment of a URL (for fallback cache lookup). */
function fileNameFromUrl(url) {
  var path = (url && url.pathname) ? url.pathname : '';
  var i = path.lastIndexOf('/');
  return i >= 0 ? path.slice(i + 1) : path;
}

/**
 * Fallback when cache.match(request) misses due to absolute vs relative key differences.
 * Prefer a key whose pathname equals the request pathname; otherwise first same file name.
 */
function matchByFileName(cache, fileName, requestUrl) {
  if (!fileName) return Promise.resolve(undefined);
  var reqPath = '';
  try {
    if (requestUrl) reqPath = new URL(requestUrl).pathname;
  } catch (e) {}
  return cache.keys().then(function (keys) {
    var fallback = null;
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      try {
        var u = new URL(key.url);
        if (fileNameFromUrl(u) !== fileName) continue;
        if (reqPath && u.pathname === reqPath) {
          return cache.match(key);
        }
        if (!fallback) fallback = key;
      } catch (e) { /* ignore bad key */ }
    }
    return fallback ? cache.match(fallback) : undefined;
  });
}

/** Resolve every document navigation to the SPA shell. Hash routes are client-side. */
function respondNavigate(request) {
  return caches.open(CACHE_NAME).then(function (cache) {
    return cache.match('./index.html', { ignoreSearch: true }).then(function (cached) {
      if (cached) return cached;
      return fetch(request).then(function (response) {
        if (response && response.ok) {
          try { cache.put('./index.html', response.clone()); } catch (e) {}
        }
        return response;
      }).catch(function () {
        return new Response(
          'آفلاین — App Shell هنوز روی این دستگاه آماده نشده. یک‌بار با اینترنت برنامه را باز کنید و دوباره تلاش کنید.',
          { status: 503, statusText: 'Offline', headers: { 'Content-Type': 'text/plain; charset=utf-8' } }
        );
      });
    });
  });
}

/** Cache-first for static assets (JS/CSS/vendor/icons/logo). */
function respondStatic(request) {
  var url = new URL(request.url);
  var name = fileNameFromUrl(url);

  return caches.open(CACHE_NAME).then(function (cache) {
    return cache.match(request, { ignoreSearch: true }).then(function (cached) {
      if (cached) return cached;

      // Try pathname key (covers some absolute/relative storage differences)
      return cache.match(url.pathname, { ignoreSearch: true }).then(function (byPath) {
        if (byPath) return byPath;

        return matchByFileName(cache, name, request.url).then(function (byName) {
          if (byName) return byName;

          return fetch(request)
            .then(function (response) {
              if (response && response.ok) {
                try {
                  cache.put(request, response.clone());
                } catch (e) { /* ignore */ }
              }
              return response;
            })
            .catch(function () {
              return new Response('', { status: 503, statusText: 'Offline' });
            });
        });
      });
    });
  });
}

self.addEventListener('fetch', function (event) {
  var request = event.request;
  if (request.method !== 'GET') {
    return;
  }

  var url;
  try {
    url = new URL(request.url);
  } catch (e) {
    return;
  }

  // Same-origin only
  if (url.origin !== self.location.origin) {
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(respondNavigate(request));
    return;
  }

  event.respondWith(respondStatic(request));
});

// Optional: page can postMessage({type:'SKIP_WAITING'}) for controlled updates later
self.addEventListener('message', function (event) {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
