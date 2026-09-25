/* router.js — pure hash router for SPA shell (Phase 2).
   Routing itself is 100% hash-driven (location.hash + hashchange) — no
   pushState-based routing. history.replaceState is used ONLY to tag the
   current history entry with a navigation-sequence number so push/pop
   direction can be detected later (see navSeq/lastSeq below); it never
   creates a navigation entry or drives routing.
   Does not touch business logic, IndexedDB, or MPA pages.
*/
'use strict';

(function (global) {
  const routes = new Map();
  let currentCleanup = null;
  let started = false;
  let resolving = false;
  const scrollPositions = new Map();

  /* --- Push/pop direction detection (Navigation Motion Patch) ---
     Every navigate() call tags the resulting history entry with an
     incrementing navSeq (and an isBack flag for explicit back-intent
     calls, e.g. the header Back button). resolve() compares the entry's
     navSeq against the last one it saw to tell forward navigation apart
     from a real browser/gesture Back — this works for both cases because
     assigning location.hash always creates a new entry (tagged via
     replaceState right after), while browser Back/Forward simply restores
     an older/newer entry with whatever navSeq it was tagged with. */
  let navSeq = 0;
  let lastSeq = 0;
  let activeGhost = null;
  let activeGhostTimer = null;

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

  /* Cancel/remove any in-flight route-ghost (Navigation Motion Patch).
     Called at the start of every resolve() so rapid navigation never
     accumulates ghost layers, timers, or leaves a stale one on screen —
     see spec section 5 (Transition Interruption). */
  function clearActiveGhost() {
    if (activeGhostTimer) {
      clearTimeout(activeGhostTimer);
      activeGhostTimer = null;
    }
    if (activeGhost) {
      try { activeGhost.remove(); } catch (e) {}
      activeGhost = null;
    }
  }

  /* Snapshot the outgoing page (a static HTML clone, not the live node) so
     it can keep appearing to slide away while the router destroys/replaces
     the real #main underneath for the incoming route. Purely decorative:
     aria-hidden + inert + pointer-events:none, cleaned up automatically. */
  function createRouteGhost(main, direction) {
    try {
      const rect = main.getBoundingClientRect();
      if (!rect.width || !rect.height) return null;
      const ghost = document.createElement('div');
      ghost.className = 'route-ghost ' + (direction === 'forward' ? 'route-ghost-under' : 'route-ghost-over');
      ghost.setAttribute('aria-hidden', 'true');
      try { ghost.inert = true; } catch (e) {}
      ghost.style.top = rect.top + 'px';
      ghost.style.left = rect.left + 'px';
      ghost.style.width = rect.width + 'px';
      ghost.style.height = rect.height + 'px';
      ghost.innerHTML = main.innerHTML;
      // Strip ids from the clone: it briefly coexists with the live #main,
      // and it must never be an addressable duplicate of anything real.
      try {
        var idEls = ghost.querySelectorAll('[id]');
        for (var i = 0; i < idEls.length; i++) { idEls[i].removeAttribute('id'); }
      } catch (e) {}
      document.body.appendChild(ghost);
      return ghost;
    } catch (e) {
      return null;
    }
  }

  // Canvas background hook (iOS 26 two-tier patch). Independent of the
  // .vg-route-* namespace by design — see css/visual-grammar.css. Only ever
  // touches these two class names on <html>, never anything else.
  var WHITE_CANVAS_ROUTES = ['/customers', '/products', '/invoices', '/suppliers', '/visits'];
  function applyCanvasClass(path) {
    try {
      var root = document.documentElement;
      if (!root) return;
      var isWhite = WHITE_CANVAS_ROUTES.indexOf(path) !== -1;
      root.classList.remove('vg-canvas-white', 'vg-canvas-grouped');
      root.classList.add(isWhite ? 'vg-canvas-white' : 'vg-canvas-grouped');
    } catch (e) { /* ignore */ }
  }

  function resolve() {
    if (resolving) return;
    resolving = true;
    try {
      const hash = location.hash || '#/';
      const { path, params } = parseHash();
      applyCanvasClass(path);
      const handler = routes.get(path);

      /* --- Direction detection (Navigation Motion Patch) ---
         See navSeq/lastSeq comment near the top of this file. Must run
         before unmountCurrent()/mount so it reflects the entry we are
         actually resolving to, and before the ghost snapshot decision. */
      let direction = 'none';
      try {
        const st = history.state;
        if (st && typeof st.navSeq === 'number') {
          if (st.isBack) direction = 'back';
          else if (st.navSeq > lastSeq) direction = 'forward';
          else if (st.navSeq < lastSeq) direction = 'back';
          lastSeq = st.navSeq;
        }
      } catch (e) { /* ignore */ }

      let reducedMotion = false;
      try {
        reducedMotion = !!(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches);
      } catch (e) { /* ignore */ }

      // A route change must not leave a sheet mounted over the new route.
      // If a save is in flight, let its continuation finish first; its own
      // success/error path owns the sheet lifecycle.
      if(!(global.__sheetSaveInFlight > 0)){
        try { if(typeof global.closeModal === 'function') global.closeModal(); } catch(_e) {}
      }

      const main = document.getElementById('main');
      const shouldAnimate = !!(handler && main && main.firstChild && direction !== 'none' && !reducedMotion);

      // Cancel any transition still in flight before starting a new one —
      // exactly one active ghost/animation at a time (spec section 5).
      clearActiveGhost();
      if (main) {
        main.classList.remove('route-push-enter', 'route-pop-enter', 'route-anim-run');
      }

      // Snapshot the outgoing page BEFORE unmountCurrent()/mount touch the
      // live #main — the ghost is a static clone, decoupled from the real
      // node, so it keeps rendering correctly regardless of what happens
      // to #main right afterward.
      let ghost = null;
      if (shouldAnimate) {
        ghost = createRouteGhost(main, direction);
      }

      unmountCurrent();

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
          if (shouldAnimate) {
            /* Set the starting off-screen transform BEFORE the incoming
               view writes its content, so nothing flashes in place first. */
            main.classList.add(direction === 'forward' ? 'route-push-enter' : 'route-pop-enter');
          }
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
          if (shouldAnimate) {
            /* Double rAF: guarantees the browser has actually painted the
               off-screen starting transform before we flip to the animated
               end-state, so the transition always has something to animate
               from (single rAF can coalesce with the current frame). */
            requestAnimationFrame(function () {
              requestAnimationFrame(function () {
                try { main.classList.add('route-anim-run'); } catch (e) {}
                if (ghost) { try { ghost.classList.add('route-anim-run'); } catch (e) {} }
              });
            });
            clearTimeout(resolve._transitionTimer);
            resolve._transitionTimer = setTimeout(function () {
              try { main.classList.remove('route-push-enter', 'route-pop-enter', 'route-anim-run'); } catch (e) {}
            }, 340);
            activeGhost = ghost;
            activeGhostTimer = setTimeout(function () {
              try { if (ghost) ghost.remove(); } catch (e) {}
              if (activeGhost === ghost) { activeGhost = null; activeGhostTimer = null; }
            }, 340);
          } else if (ghost) {
            // Defensive only: ghost is created solely when shouldAnimate.
            try { ghost.remove(); } catch (e) {}
          }
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
   * @param {object} [opts] - opts.isBack:true marks this call as an explicit
   *   back-intent navigation (e.g. the header Back button), which always
   *   resolves to a 'back' transition regardless of navSeq ordering — see
   *   navigateBack() below and the navSeq comment near the top of this file.
   */
  function navigate(path, queryObj, opts) {
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
    try {
      navSeq++;
      history.replaceState({ navSeq: navSeq, isBack: !!(opts && opts.isBack) }, '', location.hash);
    } catch (e) { /* ignore — direction detection just falls back to 'none' */ }
  }

  /** Explicit back-intent navigation (e.g. header Back button), which always
   *  transitions as a 'back' (pop) regardless of navSeq ordering. */
  function navigateBack(path, queryObj) {
    navigate(path, queryObj, { isBack: true });
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
    navigateBack: navigateBack,
    resolve: resolve,
    start: start,
    getCurrent: getCurrent,
    parseHash: parseHash
  };
})(typeof window !== 'undefined' ? window : this);