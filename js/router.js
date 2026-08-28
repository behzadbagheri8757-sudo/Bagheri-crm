/* router.js — pure hash router for SPA shell (Phase 2).
   No pushState / replaceState. Uses location.hash + hashchange only.
   Does not touch business logic, IndexedDB, or MPA pages.
*/
'use strict';

(function (global) {
  const routes = new Map();
  let currentCleanup = null;
  let started = false;
  let resolving = false;
  const scrollPositions = new Map();

  function normalizePath(raw) {
    if (!raw || raw === '') return '/';
    let p = String(raw).trim();
    if (p.charAt(0) !== '/') p = '/' + p;
    // strip trailing slash except root
    if (p.length > 1 && p.charAt(p.length - 1) === '/') p = p.slice(0, -1);
    return p;
  }

  /** Parse hash: "#/dashboard?id=1" → { path: "/dashboard", params: { id: "1" } } */
  function parseHash() {
    const hash = (location.hash || '').replace(/^#/, '');
    const qIdx = hash.indexOf('?');
    let pathPart = qIdx >= 0 ? hash.slice(0, qIdx) : hash;
    let queryPart = qIdx >= 0 ? hash.slice(qIdx + 1) : '';
    const path = normalizePath(pathPart || '/');
    const params = {};
    if (queryPart) {
      try {
        const sp = new URLSearchParams(queryPart);
        sp.forEach(function (v, k) {
          params[k] = v;
        });
      } catch (e) { /* ignore */ }
    }
    return { path: path, params: params };
  }

  function registerRoute(path, handler) {
    routes.set(normalizePath(path), handler);
  }

  function unmountCurrent() {
    if (typeof currentCleanup === 'function') {
      try {
        currentCleanup();
      } catch (e) {
        console.warn('[router] unmount cleanup error', e);
      }
      currentCleanup = null;
    }
  }

  function resolve() {
    if (resolving) return;
    resolving = true;
    try {
      const hash = location.hash || '#/';
      const { path, params } = parseHash();
      const handler = routes.get(path);
      unmountCurrent();

      const main = document.getElementById('main');
      if (!handler) {
        if (main) {
          main.innerHTML = '<div class="empty" role="alert"><h2 class="section-title">صفحه پیدا نشد</h2><p>مسیر موردنظر در برنامه ثبت نشده است.</p><button type="button" class="btn secondary" data-router-home>بازگشت به داشبورد</button></div>';
          const home = main.querySelector('[data-router-home]');
          if (home) home.addEventListener('click', function () { navigate('/dashboard'); });
        }
        return;
      }

      try {
        if (main) {
          main.setAttribute('aria-busy', 'true');
          main.classList.add('route-transition');
        }
        const result = handler(params);
        if (typeof result === 'function') currentCleanup = result;
      } catch (e) {
        console.error('[router] route mount error', path, e);
        currentCleanup = null;
        if (main) {
          main.innerHTML = '<div class="empty" role="alert"><h2 class="section-title">خطا در بارگذاری صفحه</h2><p>این بخش نتوانست بارگذاری شود.</p><button type="button" class="btn secondary" data-router-retry>تلاش دوباره</button></div>';
          const retry = main.querySelector('[data-router-retry]');
          if (retry) retry.addEventListener('click', function () { resolve(); });
        }
      } finally {
        if (main) {
          main.removeAttribute('aria-busy');
          // FIX: Delay removal of route-transition so CSS animation paints
          requestAnimationFrame(function () {
            main.classList.remove('route-transition');
          });
        }
        const saved = scrollPositions.get(hash);
        requestAnimationFrame(function () {
          try { window.scrollTo(0, saved != null ? saved : 0); } catch (e) {}
        });
      }
    } finally {
      resolving = false;
    }
  }

  /**
   * Navigate to a hash path. Does not use History API pushState.
   * Setting location.hash triggers hashchange → resolve.
   * Same-path navigate is a no-op (avoids duplicate mount).
   */
  function navigate(path, queryObj) {
    let p = normalizePath(path);
    let q = '';
    if (queryObj && typeof queryObj === 'object') {
      const sp = new URLSearchParams();
      Object.keys(queryObj).forEach(function (k) {
        if (queryObj[k] != null && queryObj[k] !== '') sp.set(k, String(queryObj[k]));
      });
      const s = sp.toString();
      if (s) q = '?' + s;
    }
    const next = '#' + p + q;
    const cur = location.hash || '#/';
    if (cur === next || cur === '#' + p + q) {
      if (typeof ViewHost !== 'undefined' && ViewHost.refreshCurrent) ViewHost.refreshCurrent();
      return;
    }
    try { scrollPositions.set(cur, window.scrollY || window.pageYOffset || 0); } catch (e) {}
    location.hash = p + q;
    // hashchange will call resolve; if hash is already same in some browsers, force resolve
  }

  function start() {
    if (started) return;
    started = true;
    // FIX 2 (audit P2): when we set the default hash ourselves below, some
    // browsers fire a hashchange for it in addition to the synchronous
    // resolve() we call right after — causing the initial route (Dashboard)
    // to mount, unmount, and mount again on cold start. This flag makes the
    // router skip exactly one upcoming hashchange (the redundant one caused
    // by our own `location.hash = '/'` assignment below), while leaving every
    // other hashchange — including one that never arrives in browsers that
    // don't fire it for this case — completely unaffected. It is a one-shot
    // flag consumed by the very first hashchange event after start(), so it
    // can never suppress a later, real user navigation.
    let suppressNextHashchangeOnce = false;
    window.addEventListener('hashchange', function () {
      if (suppressNextHashchangeOnce) {
        suppressNextHashchangeOnce = false;
        return;
      }
      resolve();
    });
    // Initial: if no hash, set default without firing duplicate if possible
    if (!location.hash || location.hash === '#') {
      suppressNextHashchangeOnce = true;
      location.hash = '/';
      // Safety net: if this browser never fires hashchange for the
      // assignment above, the flag must not linger and wrongly swallow the
      // user's first *real* navigation later. Any hashchange task queued by
      // the assignment above is queued before this setTimeout(0) task, so by
      // the time this runs the flag has already been consumed if it was
      // going to be; otherwise this safely resets it to false.
      setTimeout(function () { suppressNextHashchangeOnce = false; }, 0);
      // Covers browsers where the hashchange above never fires at all.
      resolve();
    } else {
      resolve();
    }
  }

  function getCurrent() {
    return parseHash();
  }

  global.AppRouter = {
    registerRoute: registerRoute,
    navigate: navigate,
    resolve: resolve,
    start: start,
    getCurrent: getCurrent,
    parseHash: parseHash
  };
})(typeof window !== 'undefined' ? window : this);