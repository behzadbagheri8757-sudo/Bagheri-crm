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
  { id: 'suppliers', href: '#/suppliers',  label: 'تامین‌کننده‌ها', spaPath: '/suppliers' },
  { id: 'invoices',  href: '#/invoices',  label: 'فاکتورها', spaPath: '/invoices' },
  { id: 'payments',  href: '#/payments',  label: 'پرداخت‌ها', spaPath: '/payments' },
  { id: 'checks',    href: '#/checks',    label: 'چک‌ها', spaPath: '/checks' },
  { id: 'visits',    href: '#/visits',    label: 'ویزیت', spaPath: '/visits' },
  { id: 'prospects', href: '#/prospects', label: 'ارزیابی مغازه', spaPath: '/prospects' },
  { id: 'reports',   href: '#/reports',   label: 'گزارش‌ها', spaPath: '/reports' },
  { id: 'settings',  href: '#/settings',  label: 'تنظیمات', spaPath: '/settings' },
];

/** Primary mobile bottom bar (5 items).
 * iconKey references js/icons.js (AppIcons) — the single icon registry.
 * Each key has an outline (inactive) + solid (active) pair, matching the
 * SF-Symbols-style state change iOS tab bars use, instead of a single
 * fixed-weight glyph. */
const BOTTOM_NAV_ITEMS = [
  { id: 'dashboard', href: '#/dashboard', spaPath: '/dashboard', label: 'داشبورد',  iconKey: 'home' },
  { id: 'customers', href: '#/customers', spaPath: '/customers', label: 'مشتریان',  iconKey: 'users' },
  { id: 'products',  href: '#/products',  spaPath: '/products',  label: 'اجناس',    iconKey: 'cube' },
  { id: 'invoices',  href: '#/invoices',  spaPath: '/invoices',  label: 'فاکتورها', iconKey: 'invoice' },
  { id: 'more',      href: '#/more',      spaPath: '/more',      label: 'بیشتر',    iconKey: 'more' },
];

/** Secondary destinations opened from «بیشتر». iconKey references js/icons.js. */
const MORE_NAV_ITEMS = [
  { id: 'watches',   href: '#/watches',   label: 'هشدارهای زودهنگام', spaPath: '/watches', iconKey: 'checklist' },
  { id: 'inventory', href: '#/inventory', label: 'انبار', spaPath: '/inventory', iconKey: 'warehouse' },
  { id: 'suppliers', href: '#/suppliers', label: 'تأمین‌کنندگان', spaPath: '/suppliers', iconKey: 'truck' },
  { id: 'payments',  href: '#/payments',  label: 'پرداخت‌ها', spaPath: '/payments', iconKey: 'banknotes' },
  { id: 'checks',    href: '#/checks',    label: 'چک‌ها', spaPath: '/checks', iconKey: 'cheque' },
  { id: 'visits',    href: '#/visits',    label: 'ویزیت مشتریان', spaPath: '/visits', iconKey: 'visit' },
  { id: 'prospects', href: '#/prospects', label: 'ارزیابی مغازه‌ها', spaPath: '/prospects', iconKey: 'buildingStorefront' },
  { id: 'game',      href: '#/game',      label: 'مرکز بازی فروش', spaPath: '/game', iconKey: 'trophy' },
  { id: 'reports',   href: '#/reports',   label: 'گزارش‌ها', spaPath: '/reports', iconKey: 'chartBar' },
  { id: 'settings',  href: '#/settings',  label: 'تنظیمات و پشتیبان', spaPath: '/settings', iconKey: 'cog' },
];

/** Renders an icon by key via the central AppIcons registry, falling back to
 * an empty string if icons.js failed to load (never throws, never blocks nav). */
function navIcon(iconKey, active){
  try {
    return (typeof AppIcons !== 'undefined' && AppIcons.render) ? AppIcons.render(iconKey, { active: !!active, size: 22 }) : '';
  } catch (e) { return ''; }
}

function renderSharedNav(activeId){
  const nav = document.getElementById('nav');
  if(!nav) return;
  // SPA shell uses floating bottom nav + More sheet only.
  // Do not render the legacy top text navigation into #nav.
  if(isSpaShell()){
    nav.innerHTML = '';
    nav.removeAttribute('aria-label');
    return;
  }
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
// (keeps list-item taps below untouched). Delegates to the shared gesture
// helper in js/ui.js (bindSheetDragToDismiss) so the More sheet and every
// generic openSheet() sheet share one drag algorithm instead of two.
function bindMoreSheetDragToDismiss(){
  const sheet = document.getElementById('more-sheet');
  const handle = sheet && sheet.querySelector('.more-sheet-handle');
  if(!sheet || !handle) return;
  if(typeof bindSheetDragToDismiss === 'function'){
    bindSheetDragToDismiss(sheet, handle, closeMoreSheet);
  }
}

function isMoreSectionActive(activeId){
  if(activeId === 'more') return true;
  if(MORE_NAV_ITEMS.some(t => t.id === activeId)) return true;
  return activeId === 'watches';
}

function pinBottomNav(){
  const el = document.getElementById('bottom-nav');
  if(!el) return;
  try{ el.style.removeProperty('bottom'); }catch(e){}
}

/* iOS 26-style tab-bar minimization: hide secondary labels while the user
   scrolls down, restore them on upward scroll. This is intentionally a
   navigation-only interaction; it never changes route state or page data. */
function bindBottomNavMinimizeOnScroll(){
  if(bindBottomNavMinimizeOnScroll._bound) return;
  bindBottomNavMinimizeOnScroll._bound = true;

  var lastY = window.scrollY || window.pageYOffset || 0;
  var progress = 0;
  var ticking = false;

  /* Directional hysteresis: collapse needs a larger accumulated downward
     movement than expansion needs upward movement. This makes the bar behave
     like iOS 26 `onScrollDown`: once collapsed it re-opens from a deliberate
     upward gesture, without reacting to small finger jitter. */
  var collapseThreshold = 50;
  var expandThreshold = 20;
  var direction = 0;
  var directionDistance = 0;

  var navigationResyncPending = false;
  var navigationResyncToken = 0;

  function reduceMotion(){
    try{
      return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    }catch(_e){ return false; }
  }

  function setProgress(next, immediate){
    progress = Math.max(0, Math.min(1, next));
    if(progress === 0) directionDistance = 0;
    var bar = document.getElementById('bottom-nav');
    if(!bar) return;
    bar.style.setProperty('--bn-minimize-progress', progress.toFixed(3));
    bar.classList.toggle('is-minimized', progress >= .98);
    if(immediate || reduceMotion()) bar.style.setProperty('--bn-minimize-duration', '0ms');
    else bar.style.setProperty('--bn-minimize-duration', '180ms');
    requestAnimationFrame(function(){
      var current = document.getElementById('bottom-nav');
      if(current && typeof positionBnIndicator === 'function') positionBnIndicator(current, false);
    });
  }

  function apply(){
    ticking = false;
    var bar = document.getElementById('bottom-nav');
    if(!bar) return;

    var y = window.scrollY || window.pageYOffset || 0;
    var dy = y - lastY;
    lastY = y;

    if(y <= 8){
      direction = 0;
      directionDistance = 0;
      setProgress(0, false);
      return;
    }

    if(Math.abs(dy) < 1) return;

    var nextDirection = dy > 0 ? 1 : -1;

    /* A direction change starts a fresh hysteresis window. We deliberately
       do not carry distance across the reversal: otherwise a few pixels of
       opposite movement could consume the remainder of the old direction's
       threshold and cause a visible flicker. */
    if(nextDirection !== direction){
      direction = nextDirection;
      directionDistance = 0;
    }

    directionDistance += Math.abs(dy);

    if(nextDirection > 0){
      /* Downward scroll: collapse only after ~50px of accumulated travel. */
      if(progress < 0.98 && directionDistance >= collapseThreshold){
        directionDistance = 0;
        setProgress(1, false);
      }
    }else{
      /* Upward scroll: reopen after ~20px, regardless of how far down the
         page is. This is the key onScrollDown direction-reversal behavior. */
      if(progress > 0 && directionDistance >= expandThreshold){
        directionDistance = 0;
        setProgress(0, false);
      }
    }
  }

  function schedule(){
    if(ticking) return;
    ticking = true;
    requestAnimationFrame(apply);
  }

  /* Navigation can rebuild the bottom bar before router.js restores the
     destination page's scroll position. A single rAF here is therefore too
     early: renderBottomNav() queues first, router.scrollTo() queues second.
     resetAfterNavigation uses a two-rAF settle point so the minimize state is
     corrected only after that scroll restoration has actually landed. The
     correction is intentionally coupled to the indicator reposition call in
     renderBottomNav(), so the indicator never measures the old minimized
     geometry and then gets corrected underneath its travel animation. */
  function resetAfterNavigation(){
    navigationResyncPending = true;
    var token = ++navigationResyncToken;

    requestAnimationFrame(function(){
      requestAnimationFrame(function(){
        if(token !== navigationResyncToken || !navigationResyncPending) return;
        navigationResyncPending = false;

        var y = window.scrollY || window.pageYOffset || 0;
        lastY = y;
        /* A route change is a fresh interaction context: always restore the
           full navigation bar before the destination indicator is measured.
           Subsequent user scrolling immediately resumes from the real y. */
        setProgress(0, false);
      });
    });
  }

  function expandFromInteraction(){
    setProgress(0, false);
  }

  window.addEventListener('scroll', schedule, {passive:true});
  if(window.visualViewport) window.visualViewport.addEventListener('scroll', schedule, {passive:true});
  document.addEventListener('click', function(e){
    /* Tab taps are handled by their own per-item click listeners, which call
       e.preventDefault() and drive navigation. If this event has already
       been consumed by such a listener, we must NOT also run the generic
       un-minimize path here: it queues a non-animated positionBnIndicator()
       that would land the indicator on the destination tab before the
       animated tab-tap motion can run, leaving the real animation with
       distance = 0 (invisible). Clicks that reach a bottom-nav-item without
       having been preventDefault'd (non-SPA fallback or future items that
       don't handle their own click) still un-minimize as before. */
    if(e.defaultPrevented) return;
    var target = e.target && e.target.closest ? e.target.closest('#bottom-nav .bottom-nav-item') : null;
    if(target) expandFromInteraction();
  }, {passive:true});

  bindBottomNavMinimizeOnScroll.setProgress = setProgress;
  bindBottomNavMinimizeOnScroll.resetAfterNavigation = resetAfterNavigation;
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
      /* Reposition indicator without animation on viewport changes */
      var bar = document.getElementById('bottom-nav');
      if(bar && typeof positionBnIndicator === 'function'){
        positionBnIndicator(bar, false);
      }
    });
  }
  window.addEventListener('resize', schedule, {passive:true});
  if(window.visualViewport){
    window.visualViewport.addEventListener('resize', schedule, {passive:true});
  }
  window.addEventListener('pageshow', schedule, {passive:true});
  window.addEventListener('orientationchange', function(){
    setTimeout(schedule, 50);
  }, {passive:true});
}

/* Single persistent liquid/glass indicator for bottom nav.
   One element moves between tabs; not per-item backgrounds.

   Motion model: this is deliberately edge-driven rather than a centered
   translate with a width pulse. The destination is approached by two
   independently behaving edges: the leading edge launches first and
   overshoots slightly, while the trailing edge follows with a short lag.
   A short arrival pinch + rebound then lets the whole capsule settle.
   This makes the deformation read as a small piece of elastic material,
   not as a flat capsule sliding from one tab to another.

   WAAPI (not CSS transitions) is used so a move can be interrupted
   mid-flight. commitStyles() bakes the exact current width/transform into
   inline styles before the next move starts, preserving continuity on
   rapid repeated taps. */
var _bnIndicatorState = { ready: false, gestureBound: false, pointer: null };

function ensureBnIndicator(bar){
  var ind = bar.querySelector('.bn-indicator');
  if(!ind){
    ind = document.createElement('span');
    ind.className = 'bn-indicator';
    ind.setAttribute('aria-hidden', 'true');
    ind.style.transformOrigin = '50% 50%';
    ind.style.scale = '1';
    bar.insertBefore(ind, bar.firstChild);
  }
  return ind;
}

function _bnClearIndicatorMotionClasses(ind){
  ind.classList.remove('is-traveling', 'is-settling', 'is-lifted');
  if(ind._bnSettleTimer){
    clearTimeout(ind._bnSettleTimer);
    ind._bnSettleTimer = null;
  }
}

function _bnReduceMotion(){
  try{ return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); }
  catch(_e){ return false; }
}

/* Fast spring used for the press-lift and the final settle. */
function _bnPressSpring(t){
  t = Math.max(0, Math.min(1, t));
  var c = 1.70158;
  var x = t - 1;
  return 1 + (c + 1) * x * x * x + c * x * x;
}

/* Damped spring used for the actual travel. The position is sampled into
   WAAPI frames so the animation stays on the compositor and can be
   interrupted without losing the exact current geometry. */
function _bnSpring(t, zeta, delay){
  var tt = delay > 0 ? (t - delay) / (1 - delay) : t;
  if(tt <= 0) return 0;
  if(tt >= 1) tt = 1;
  var tau = tt * 6.5;
  if(zeta >= 1){
    var a = Math.sqrt(zeta*zeta - 1);
    return 1 - Math.exp(-zeta*tau) * (Math.cosh(a*tau) + (zeta/Math.max(a,1e-6))*Math.sinh(a*tau));
  }
  var wd = Math.sqrt(1 - zeta*zeta);
  return 1 - Math.exp(-zeta*tau) * (Math.cos(wd*tau) + (zeta/wd)*Math.sin(wd*tau));
}

function _bnSmoothStep(t){
  t = Math.max(0, Math.min(1, t));
  return t * t * (3 - 2 * t);
}

/* Smooth single-peak "bump": exactly 0 at t=0 and t=1, normalized to a peak
   of exactly 1 at t = a/(a+b). This is a plain polynomial (t^a * (1-t)^b),
   so it is infinitely differentiable everywhere in [0,1] — there is no
   internal point where its own velocity hits zero. That property is the
   whole fix for the old "move / stop / move / stop" rhythm: the previous
   envelope was stitched from separate smoothstep segments, each of which
   has zero velocity at both of ITS OWN endpoints — meaning velocity
   actually passed through zero at every single phase boundary. A bump
   built this way has no such seams; the only zero-velocity points are the
   two ends of the whole travel, which is where they belong (rest states). */
function _bnBump(t, a, b){
  t = t < 0 ? 0 : (t > 1 ? 1 : t);
  var peakT = a / (a + b);
  var peakVal = Math.pow(peakT, a) * Math.pow(1 - peakT, b);
  if(peakVal <= 0) return 0;
  return Math.pow(t, a) * Math.pow(1 - t, b) / peakVal;
}

/* One continuous envelope for the entire travel — no phase boundaries, no
   piecewise stitching:
     - g(t): overall isotropic "lift off the surface" grow. A wide bump
       (peak ≈0.40) that returns to exactly 0 by t=1. This single curve
       covers BOTH take-off and landing — there's no seam between them
       because it's the same formula throughout.
     - d(t): directional stretch layered on top of g. A narrower, sharper
       bump (peak ≈0.375) that has mostly resolved before the landing
       window, so scaleX/scaleY reconverge to an isotropic, still-slightly-
       enlarged shape well before arrival. This relative shape — not a
       hand-placed boundary — is what keeps the landing free of any dip
       below 1.00: by the last ~25% of the travel d(t) is negligible next to
       g(t), so sy = 1+g-d is guaranteed to recover above 1 and then ease
       down to exactly 1 as g(t) itself fades to 0.
   sx = 1+g+d, sy = 1+g-d: the stretch is a pure perturbation around the
   same growing baseline, so grow and directional stretch read as one
   material deforming, not two separate effects. */
function _bnJellyEnvelope(t){
  var g = 0.049 * _bnBump(t, 2, 3);
  var d = 0.0914 * _bnBump(t, 3, 5);
  return { sx: 1 + g + d, sy: 1 + g - d };
}

/* Vertical jump arc, independent of the size envelope. Built from the same
   bump primitive, so it too reaches exactly 0 at t=1 — the same instant
   horizontal travel reaches its destination (see _bnEaseOutCubic in
   _bnAnimateIndicatorToItem, which also resolves to exactly 1 at t=1).
   Arc-end and horizontal-arrival are therefore always simultaneous by
   construction, for any travel distance/duration, with no separate tuning
   needed. */
function _bnJumpArc(t){
  return -6 * _bnBump(t, 2, 3);
}

function _bnTargetKey(item){
  if(!item) return '';
  if(item.hasAttribute('data-bottom-more')) return 'more';
  return item.getAttribute('data-spa-path') || item.getAttribute('href') || '';
}

/* Press feedback is intentionally separate from travel. It gives the
   current indicator a physical "lift" immediately on touch-down, then lets
   the route travel animation take over. CSS individual `scale` composes with
   the translate/scaleX/scaleY transform used by the travel animation. */
function _bnLiftIndicator(ind){
  if(!ind || _bnReduceMotion() || typeof ind.animate !== 'function') return;
  if(ind._bnLiftAnim){ try{ ind._bnLiftAnim.cancel(); }catch(_e){} }
  ind.classList.add('is-lifted');
  ind.style.scale = '1';
  ind._bnLiftAnim = ind.animate(
    [{scale:'1'}, {scale:'1.10'}],
    {duration:110, easing:'cubic-bezier(.34,1.56,.64,1)', fill:'forwards'}
  );
}

function _bnReleaseLift(ind){
  if(!ind || _bnReduceMotion() || typeof ind.animate !== 'function') return;
  if(ind._bnLiftAnim){ try{ ind._bnLiftAnim.cancel(); }catch(_e){} }
  ind.classList.remove('is-lifted');
  ind._bnLiftAnim = ind.animate(
    [{scale:'1.10'}, {scale:'1'}],
    {duration:150, easing:'cubic-bezier(.34,1.56,.64,1)', fill:'forwards'}
  );
  ind._bnLiftAnim.onfinish = function(){
    if(ind._bnLiftAnim === this){
      try{ this.commitStyles(); }catch(_e){}
      try{ this.cancel(); }catch(_e2){}
      ind.style.scale = '1';
      ind._bnLiftAnim = null;
    }
  };
}

/* Very short, subtle zoom on the destination tab's icon, fired right when
   the indicator arrives so the two settle at roughly the same moment. Reads
   the *live* DOM at call time (not a reference captured earlier), because
   renderBottomNav() rebuilds the tab markup on every route change and any
   node captured before that would already be detached. */
function _bnPulseActiveIcon(bar){
  if(_bnReduceMotion()) return;
  var activeItem = bar.querySelector('.bottom-nav-item.active');
  var iconEl = activeItem && (activeItem.querySelector('.bn-ico svg') || activeItem.querySelector('.bn-ico'));
  if(!iconEl || typeof iconEl.animate !== 'function') return;
  iconEl.animate(
    [{ transform: 'scale(1)' }, { transform: 'scale(1.14)' }, { transform: 'scale(1)' }],
    { duration: 200, easing: 'cubic-bezier(.34,1.56,.64,1)' }
  );
}

/* Ease-out cubic: nonzero velocity at t=0 (movement starts immediately, no
   perceptible pause after touch-down) and zero velocity at t=1 (soft,
   snap-free arrival). Replaces the old ease-in-out smoothstep, which had
   zero velocity at BOTH ends and read as a small hesitation before the
   indicator actually started moving. */
function _bnEaseOutCubic(t){
  var u = 1 - (t < 0 ? 0 : (t > 1 ? 1 : t));
  return 1 - u*u*u;
}

function _bnEaseOutQuad(t){
  var u = 1 - (t < 0 ? 0 : (t > 1 ? 1 : t));
  return 1 - u * u;
}

/* Reads the indicator's actual rendered transform (translate + scale)
   straight off its computed matrix. Used only when a travel animation is
   interrupted mid-flight by another tap: without this, the new travel would
   silently start its scale channel over at 1.00 even though the indicator
   was still visibly stretched from the animation just cancelled, producing
   a visible size "snap" at the exact moment of interruption. */
function _bnReadCurrentTransform(ind){
  try{
    var m = new DOMMatrixReadOnly(window.getComputedStyle(ind).transform);
    return { tx:m.m41, ty:m.m42, sx:m.a, sy:m.d };
  }catch(_e){
    return { tx:0, ty:0, sx:1, sy:1 };
  }
}

/* Animate immediately toward the tab under the finger.

   Technique: FLIP. The indicator's static box (left/top/width/height) is
   set to the DESTINATION slot immediately, and the entire remaining visual
   gap is expressed as a single `transform` (translate + scaleX/scaleY),
   animated with WAAPI. This is what actually makes the deformation visible:
   animating left/top/width per frame forces a layout + backdrop-filter
   repaint on every sample, which — especially with two blurred glass
   surfaces stacked — reliably drops frames on-device. A transform-only
   animation stays entirely on the compositor, so every sampled frame
   actually renders.

   `transform` is the ONLY channel driving the indicator during travel —
   press-lift (the separate CSS `scale` property) is intentionally not
   engaged for a cross-tab tap (see bindBottomNavIndicatorGestures below),
   so there is never a second, competing transform source on the element
   while it's in flight. */
function _bnAnimateIndicatorToItem(bar, item){
  var ind = ensureBnIndicator(bar);
  if(!item || _bnReduceMotion() || typeof ind.animate !== 'function') return;

  var barRect = bar.getBoundingClientRect();
  var targetRect = item.getBoundingClientRect();
  /* Use the destination item's live rendered box. During minimization this
     is smaller than the rest-state box; hard-coding 48px makes the jelly jump
     vertically when its container changes height. */
  var targetW = Math.round(targetRect.width);
  var targetH = Math.round(targetRect.height);
  var targetLeft = targetRect.left - barRect.left + (targetRect.width - targetW)/2;
  var targetTop = targetRect.top - barRect.top + (targetRect.height - targetH)/2;

  /* The static box the indicator was sitting in before this call. */
  var prevLeft = parseFloat(ind.style.left);
  var prevTop = parseFloat(ind.style.top);
  if(isNaN(prevLeft)) prevLeft = targetLeft;
  if(isNaN(prevTop)) prevTop = targetTop;

  if(ind._bnIconTimer){ clearTimeout(ind._bnIconTimer); ind._bnIconTimer = null; }
  if(ind._bnAnim){
    try{ ind._bnAnim.commitStyles(); }catch(_e){}
    try{ ind._bnAnim.cancel(); }catch(_e2){}
    ind._bnAnim = null;
  }

  /* Exact visual transform at the moment of interruption (identity if the
     indicator was idle — the common case). */
  var cur = _bnReadCurrentTransform(ind);

  /* Lock the static box to the destination now; everything else is a pure
     transform animation from here on. */
  ind.style.left = targetLeft + 'px';
  ind.style.top = targetTop + 'px';
  ind.style.width = targetW + 'px';
  ind.style.height = targetH + 'px';

  var offsetX = (prevLeft + cur.tx) - targetLeft;
  var offsetY = (prevTop + cur.ty) - targetTop;
  var startSx = cur.sx, startSy = cur.sy;

  var distanceRatio = Math.max(0, Math.min(1, Math.abs(offsetX) / Math.max(1, barRect.width * .82)));
  /* Responsive first: just long enough for take-off/stretch/jump/landing to
     each register as part of one continuous event, not a slow-motion
     replay. */
  var durationMs = Math.round(260 + 180 * distanceRatio);

  /* If this travel inherited a non-1.00 scale from an animation that was
     just interrupted, fold that discrepancy out smoothly over the first
     ~22% of the NEW travel instead of resetting it to 1.00 instantly — this
     is the fix for the rapid-tab-switching scale snap. In the common case
     (indicator was idle, startSx=startSy=1) this term is simply zero. */
  var fadeSpan = 0.22;

  var N = 54;
  var frames = [];
  for(var i=0;i<=N;i++){
    var t = i/N;
    var pos = _bnEaseOutCubic(t);
    var env = _bnJellyEnvelope(t);
    var liftY = _bnJumpArc(t);
    var fade = t >= fadeSpan ? 0 : (1 - _bnSmoothStep(t / fadeSpan));
    var sx = env.sx + (startSx - 1) * fade;
    var sy = env.sy + (startSy - 1) * fade;
    var tx = offsetX * (1 - pos);
    var ty = offsetY * (1 - pos) + liftY;

    /* Subtle dynamic depth cue, sampled on the exact same t used for the
       geometry above so it is deterministic and locked to this travel's
       own lifecycle: 0 at take-off (t=0) and 0 at arrival (t=1), peaking
       at the travel's midpoint. Only the two OUTER shadow layers' alpha
       and blur radius are perturbed; their y-offsets (1px / 5px) and every
       inset layer stay exactly as authored in CSS and are never touched. */
    var shadowT = _bnBump(t, 2, 2);
    var nearAlpha = (0.10 + 0.06 * shadowT).toFixed(3);
    var farAlpha = (0.08 + 0.06 * shadowT).toFixed(3);
    var nearBlur = (2 + 2 * shadowT).toFixed(2);
    var farBlur = (12 + 4 * shadowT).toFixed(2);
    var shadow =
      '0 1px ' + nearBlur + 'px rgba(15, 23, 42, ' + nearAlpha + '), ' +
      '0 5px ' + farBlur + 'px rgba(15, 23, 42, ' + farAlpha + '), ' +
      'inset 0 1px 0 rgba(255, 255, 255, 0.60), ' +
      'inset 0 -1px 0 rgba(15, 23, 42, 0.06)';

    frames.push({
      transform:'translate3d(' + tx.toFixed(2) + 'px,' + ty.toFixed(2) + 'px,0) scaleX(' + sx.toFixed(4) + ') scaleY(' + sy.toFixed(4) + ')',
      boxShadow: shadow,
      offset:t
    });
  }

  var anim = ind.animate(frames, {
    duration:durationMs,
    easing:'linear',
    fill:'forwards'
  });
  ind._bnAnim = anim;
  ind._bnTargetKey = _bnTargetKey(item);
  _bnClearIndicatorMotionClasses(ind);
  ind.classList.add('is-traveling');

  /* The destination icon's zoom starts DURING the landing window — not
     after the travel animation fully finishes — so the two read as one
     coordinated landing rather than "jelly stops, then icon reacts". The
     delay is derived from this travel's own duration, so it stays in sync
     regardless of how far the indicator is traveling. Guarded by the timer
     handle above so an interrupting tap cancels a stale, still-pending
     pulse for the old destination. */
  ind._bnIconTimer = setTimeout(function(){
    ind._bnIconTimer = null;
    _bnPulseActiveIcon(bar);
  }, Math.round(durationMs * 0.72));

  anim.onfinish = function(){
    try{ anim.commitStyles(); }catch(_e){}
    try{ anim.cancel(); }catch(_e2){}
    if(ind._bnAnim === anim) ind._bnAnim = null;
    ind.style.transform = 'translate3d(0,0,0) scaleX(1) scaleY(1)';
    ind.style.scale = '1';
    /* The last sampled frame already equals the exact base shadow, but
       commitStyles() just pinned that as an inline value; remove it so
       control reverts to the normal CSS classes (is-settling, then idle)
       instead of leaving a permanent inline box-shadow override. */
    ind.style.removeProperty('box-shadow');
    ind.classList.remove('is-traveling');
    ind.classList.add('is-settling');
    if(ind._bnSettleTimer) clearTimeout(ind._bnSettleTimer);
    ind._bnSettleTimer = setTimeout(function(){
      ind.classList.remove('is-settling');
      ind._bnSettleTimer = null;
      ind._bnTargetKey = '';
    }, 180);
  };
  anim.oncancel = function(){
    if(ind._bnAnim === anim) ind._bnAnim = null;
    ind.style.removeProperty('box-shadow');
    ind.classList.remove('is-traveling');
  };
}

function bindBottomNavIndicatorGestures(bar){
  if(!bar || bar._bnGestureBound) return;
  bar._bnGestureBound = true;

  bar.addEventListener('pointerdown', function(e){
    var item = e.target && e.target.closest ? e.target.closest('.bottom-nav-item') : null;
    if(!item || !bar.contains(item)) return;
    if(e.pointerType === 'mouse' && e.button !== 0) return;

    var ind = ensureBnIndicator(bar);
    var active = bar.querySelector('.bottom-nav-item.active');
    var activeKey = _bnTargetKey(active);
    var targetKey = _bnTargetKey(item);
    _bnIndicatorState.pointer = { id:e.pointerId, activeKey:activeKey, targetKey:targetKey };

    if(targetKey && targetKey === activeKey){
      /* Same-tab tap: no travel is happening, so the lightweight press
         acknowledgment (CSS `scale`, independent of `transform`) is safe. */
      _bnLiftIndicator(ind);
    }
    /* Cross-tab pointerdown intentionally does not move the indicator.
       Indicator moves after the actual route/render transition. */
  }, {passive:true});

  function release(e){
    var state = _bnIndicatorState.pointer;
    if(!state || (e && e.pointerId != null && state.id !== e.pointerId)) return;
    var ind = ensureBnIndicator(bar);
    if(ind.classList.contains('is-lifted')) _bnReleaseLift(ind);
    _bnIndicatorState.pointer = null;
  }

  bar.addEventListener('pointerup', release, {passive:true});
  bar.addEventListener('pointercancel', release, {passive:true});
  bar.addEventListener('lostpointercapture', release, {passive:true});
}

function positionBnIndicator(bar, animate){
  if(!bar) return;
  var ind = ensureBnIndicator(bar);
  bindBottomNavIndicatorGestures(bar);

  /* Incidental scroll/resize/viewport callbacks must never interrupt a
     user-initiated travel animation. Only a real route/tap reposition may
     replace the current move. */
  if(!animate && ind._bnAnim) return;

  /* If touch-down already launched the indicator toward the exact active
     destination, do not kill that animation when the router re-renders. */
  var active = bar.querySelector('.bottom-nav-item.active');
  if(!active){
    ind.style.opacity = '0';
    return;
  }
  var activeKey = _bnTargetKey(active);
  if(ind._bnAnim && ind._bnTargetKey === activeKey){
    return;
  }

  var barRect = bar.getBoundingClientRect();
  var itemRect = active.getBoundingClientRect();
  /* Geometry must follow the live item box. The item is scroll-linked and
     changes height while the bar minimizes, so a fixed 48px indicator becomes
     vertically misaligned during/after a scroll-linked resize. */
  var w = Math.round(itemRect.width);
  var h = Math.round(itemRect.height);
  var left = itemRect.left - barRect.left + (itemRect.width - w)/2;
  var top = itemRect.top - barRect.top + (itemRect.height - h)/2;
  var reduceMotion = _bnReduceMotion();

  if(!animate || reduceMotion || typeof ind.animate !== 'function'){
    if(ind._bnAnim){
      try{ ind._bnAnim.commitStyles(); }catch(_e){}
      try{ ind._bnAnim.cancel(); }catch(_e2){}
      ind._bnAnim = null;
    }
    ind.style.left = left + 'px';
    ind.style.top = top + 'px';
    ind.style.width = w + 'px';
    ind.style.height = h + 'px';
    ind.style.opacity = '1';
    ind.style.transform = 'translate3d(0,0,0) scaleX(1) scaleY(1)';
    ind.style.scale = '1';
    _bnClearIndicatorMotionClasses(ind);
    _bnIndicatorState.ready = true;
    return;
  }

  if(ind._bnAnim){
    try{ ind._bnAnim.commitStyles(); }catch(_e){}
    try{ ind._bnAnim.cancel(); }catch(_e2){}
    ind._bnAnim = null;
  }

  var cur = ind.getBoundingClientRect();
  var left0 = cur.left - barRect.left;
  var top0 = cur.top - barRect.top;
  var right0 = left0 + cur.width;
  if(Math.abs(left0-left)<1 && Math.abs(top0-top)<1 && Math.abs(cur.width-w)<1){
    ind.style.left = left+'px'; ind.style.top=top+'px'; ind.style.width=w+'px'; ind.style.height=h+'px';
    ind.style.transform='translate3d(0,0,0) scaleX(1) scaleY(1)';
    ind.style.scale='1';
    _bnIndicatorState.ready=true;
    return;
  }

  /* Route changes that happen without a pointer-down still get the same
     material travel model. */
  var pseudoItem = active;
  ind.style.scale = '1';
  _bnAnimateIndicatorToItem(bar, pseudoItem);
  _bnIndicatorState.ready = true;
}

function renderBottomNav(activeId){
  ensureBottomNavDOM();
  const bar = document.getElementById('bottom-nav');
  if(!bar) return;
  const moreActive = isMoreSectionActive(activeId);
  const spa = isSpaShell();

  /* Preserve single indicator across re-renders */
  var prevInd = bar.querySelector('.bn-indicator');
  bar.innerHTML = BOTTOM_NAV_ITEMS.map(t => {
    let active = false;
    if(t.id === 'more') active = moreActive;
    else active = t.id === activeId;
    const cls = 'bottom-nav-item' + (active ? ' active' : '');
    const ico = navIcon(t.iconKey, active);
    let href = t.href;
    if (spa && t.spaPath) href = '#' + t.spaPath;
    const ariaCurrent = active ? ' aria-current="page"' : '';
    return `<a class="${cls}" href="${href}" data-spa-path="${t.spaPath || ''}"${ariaCurrent}>
      <span class="bn-ico">${ico}</span>
      <span class="bn-label">${t.label}</span>
    </a>`;
  }).join('');
  if(prevInd){
    bar.insertBefore(prevInd, bar.firstChild);
  } else {
    ensureBnIndicator(bar);
  }
  bindBottomNavIndicatorGestures(bar);

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

  fillMoreSheetList(activeId);

  ensureBottomNavPinned();
  bindBottomNavMinimizeOnScroll();
  pinBottomNav();

  /* Route render happens before router.js queues its scrollTo(). Let the
     navigation resync own the post-scroll settle point, and only then measure
     the indicator. This prevents a minimized old page from producing a zero-
     distance/incorrect-geometry travel on the destination tab. */
  var shouldAnimate = _bnIndicatorState.ready;
  if(typeof bindBottomNavMinimizeOnScroll.resetAfterNavigation === 'function'){
    bindBottomNavMinimizeOnScroll.resetAfterNavigation();
  }
  requestAnimationFrame(function(){
    requestAnimationFrame(function(){
      var current = document.getElementById('bottom-nav');
      if(!current) return;
      positionBnIndicator(current, shouldAnimate);
    });
  });
}

function fillMoreSheetList(activeId){
  const list = document.getElementById('more-sheet-list');
  if(!list) return;
  const spa = isSpaShell();
  list.innerHTML = MORE_NAV_ITEMS.map(t => {
    const isActive = t.id === activeId;
    let href = t.href;
    if (spa && t.spaPath) href = '#' + t.spaPath;
    const ico = navIcon(t.iconKey, isActive);
    return `<a class="more-sheet-item${isActive ? ' active' : ''}" href="${href}" data-spa-path="${t.spaPath || ''}">
      <span class="more-sheet-item-ico">${ico}</span>
      <span class="more-sheet-item-label">${t.label}</span>
      <svg class="more-sheet-item-chevron" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>
    </a>`;
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

function isBackRoute(path){
  return ['/customer','/invoice','/supplier','/prospect','/evaluation','/prospect-routes','/locations','/watch'].indexOf(path) !== -1;
}

function routeBackTarget(path, params){
  params = params || {};
  switch(path){
    case '/customer':
      return {path:'/customers'};
    case '/invoice': {
      /* If the invoice belongs to a customer, return to that customer rather
         than blindly returning to the invoice list. Otherwise use the list. */
      try{
        const id = params.id;
        const invs = (typeof data !== 'undefined' && Array.isArray(data.invoices)) ? data.invoices : [];
        const inv = invs.find(function(x){ return String(x.id) === String(id); });
        if(inv && inv.customerId != null) return {path:'/customer', params:{id:String(inv.customerId)}};
      }catch(_e){}
      return {path:'/invoices'};
    }
    case '/supplier':
      return {path:'/suppliers'};
    case '/prospect':
      return {path:'/prospects'};
    case '/evaluation':
      return params.id != null ? {path:'/prospect', params:{id:String(params.id)}} : {path:'/prospects'};
    case '/prospect-routes':
      return {path:'/prospects'};
    case '/locations':
      return {path:'/settings'};
    case '/watch':
      return {path:'/watches'};
    default:
      return {path:'/dashboard'};
  }
}

function goAppBack(e){
  if(e && typeof e.preventDefault === 'function') e.preventDefault();
  try{
    const cur = (typeof AppRouter !== 'undefined' && AppRouter.getCurrent) ? AppRouter.getCurrent() : null;
    const path = cur && cur.path ? cur.path : '/dashboard';
    if(!isBackRoute(path)) return;
    const target = routeBackTarget(path, cur.params || {});
    if(typeof AppRouter !== 'undefined' && AppRouter.navigateBack){
      AppRouter.navigateBack(target.path, target.params || null);
      return;
    }
    if(typeof AppRouter !== 'undefined' && AppRouter.navigate){
      AppRouter.navigate(target.path, target.params || null);
      return;
    }
    location.hash = '#' + target.path;
  }catch(_e){
    try{
      if(typeof AppRouter !== 'undefined' && AppRouter.navigate) AppRouter.navigate('/dashboard');
    }catch(__e){}
  }
}

function setHeaderTitle(text, opts){
  const header = document.querySelector('header');
  if(!header) return;
  const h1 = header.querySelector('h1');
  if(h1 && text) h1.textContent = text;
  header.classList.toggle('header-root', !!(opts && opts.isRoot));
  bindHeaderScrollCollapse();
  // Sync condensed state immediately (covers restored scroll position on
  // back-navigation) instead of waiting for the next scroll event, so a
  // page opened already-scrolled doesn't flash a large title first.
  updateHeaderCondensedState();
}

/* Continuous scroll-linked collapse (fixes the earlier snap/lag): progress
   is a plain 0..1 number derived straight from window.scrollY and written
   to a CSS custom property every frame — no class toggle, no CSS
   transition anywhere in this chain, so there is nothing that keeps
   animating after the finger/scroll stops or that fights a direction
   change mid-scroll. COLLAPSE_RANGE is the scroll distance (px) over
   which the large title fully collapses into the compact title. */
var HEADER_COLLAPSE_RANGE = 48;
function updateHeaderCondensedState(){
  const header = document.querySelector('header');
  if(!header) return;
  const y = window.scrollY || window.pageYOffset || 0;
  const progress = Math.max(0, Math.min(1, y / HEADER_COLLAPSE_RANGE));
  header.style.setProperty('--header-progress', String(progress));
}

/* iOS Large Title collapse: the header starts large (Phase 6). As the page
   scrolls, it condenses into a small persistent title bar — the same visual
   language as UINavigationBar's largeTitleDisplayMode, approximated with a
   scroll-driven class toggle since Web/PWA has no native large-title API. */
function bindHeaderScrollCollapse(){
  if(bindHeaderScrollCollapse._bound) return;
  bindHeaderScrollCollapse._bound = true;
  let ticking = false;
  window.addEventListener('scroll', function(){
    if(ticking) return;
    ticking = true;
    requestAnimationFrame(function(){
      updateHeaderCondensedState();
      ticking = false;
    });
  }, {passive:true});
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

function ensureAppBackButton(activeId, routePath){
  const header = document.querySelector('header');
  if(!header) return;

  ensureHeaderDate();

  /* Some legacy/detail views still call this helper with only activeId.
     Resolve the actual SPA route before deciding whether Back belongs here;
     otherwise a later route-local call could accidentally remove the button
     that the router just created. */
  if(!routePath){
    try{
      const cur = (typeof AppRouter !== 'undefined' && AppRouter.getCurrent)
        ? AppRouter.getCurrent() : null;
      routePath = cur && cur.path ? cur.path : '';
    }catch(_e){ routePath = ''; }
  }

  const existing = header.querySelector('.app-back');
  // isDash was previously also true whenever location.pathname contained
  // "index.html" or <body> carried the legacy "page-dashboard" class — both
  // are relics of the old multi-page-HTML architecture and are constant in
  // this single-shell SPA (this file is always served as /index.html and
  // <body class="page-dashboard"> in index.html is never changed at
  // runtime), so isDash was always true and the header back button never
  // rendered on any route. activeId is the one signal the router actually
  // updates per navigation, so it's the only correct check here.
  const isDash = !activeId || activeId === 'dashboard';
  const showBack = !isDash && isBackRoute(routePath || '');

  if(!showBack){
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
  btn.innerHTML = '<span class="app-back-ico" aria-hidden="true"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.15" stroke-linecap="round" stroke-linejoin="round"><path d="m14.5 5-7 7 7 7"/></svg></span><span class="app-back-txt">بازگشت</span>';
  btn.addEventListener('click', goAppBack);
  header.insertBefore(btn, header.firstChild);
  header.classList.add('has-back');
}

/* ---------------------------------------------------------------------
   Pull-to-refresh (Phase 10). Re-reads IndexedDB into the in-memory
   `data` object (loadData() — a pure read, never mutates anything) and
   asks the currently-mounted view to redraw itself via the existing
   ViewHost.setRefresh()/refreshCurrent() registry that all 21 views
   already use for their own "data changed, redraw" path — this gesture
   doesn't invent a new refresh mechanism, it just triggers the one that
   was already there. Falls back to a full route re-resolve only if a
   view hasn't registered a refresh handler.
   Gated to start only when the page is scrolled to the very top and the
   touch didn't begin inside a sheet/overlay/header, so it can never
   fight the sheet drag-to-dismiss gesture or the header's own scroll
   listener.
   --------------------------------------------------------------------- */
function ensurePullToRefreshDOM(){
  if(document.getElementById('ptr-indicator')) return;
  const el = document.createElement('div');
  el.id = 'ptr-indicator';
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = '<span class="ptr-spinner"></span>';
  document.body.appendChild(el);
}

function bindPullToRefresh(){
  if(bindPullToRefresh._bound) return;
  bindPullToRefresh._bound = true;
  ensurePullToRefreshDOM();
  const el = document.getElementById('ptr-indicator');
  if(!el) return;
  const THRESHOLD = 64;
  let startY = 0, pulling = false, dragging = false, refreshing = false;

  function isBlocked(target){
    return !!(target && target.closest && target.closest('.overlay, .more-sheet, .more-overlay, .shamsi-sheet-overlay, #modalRoot, header'));
  }

  window.addEventListener('touchstart', function(e){
    if(refreshing){ pulling = false; return; }
    const y = window.scrollY || window.pageYOffset || 0;
    if(y > 0 || isBlocked(e.target)){ pulling = false; return; }
    pulling = true;
    dragging = false;
    startY = e.touches[0].clientY;
  }, {passive:true});

  window.addEventListener('touchmove', function(e){
    if(!pulling || refreshing) return;
    const dy = e.touches[0].clientY - startY;
    if(dy <= 0){
      if(dragging){ dragging = false; el.style.transform = ''; el.classList.remove('show','ptr-ready'); }
      return;
    }
    dragging = true;
    const pull = Math.min(90, Math.pow(dy, 0.72) * 3); // rubber-band resistance
    el.style.transform = 'translateY(' + pull + 'px) rotate(' + Math.min(220, pull * 2.4) + 'deg)';
    el.classList.add('show');
    el.classList.toggle('ptr-ready', pull >= THRESHOLD * 0.85);
  }, {passive:true});

  window.addEventListener('touchend', function(){
    if(!pulling) return;
    pulling = false;
    if(!dragging) return;
    dragging = false;
    const ready = el.classList.contains('ptr-ready');
    if(ready){
      el.style.transform = 'translateY(0)';
      doRefresh();
    } else {
      el.style.transform = 'translateY(-40px)';
      el.classList.remove('show','ptr-ready');
    }
  });

  async function doRefresh(){
    refreshing = true;
    el.classList.add('show', 'ptr-spinning');
    el.classList.remove('ptr-ready');
    const minVisible = new Promise(function(res){ setTimeout(res, 420); });
    try{
      if(typeof loadData === 'function') await loadData();
      const refreshed = (typeof ViewHost !== 'undefined' && ViewHost.refreshCurrent) ? ViewHost.refreshCurrent() : false;
      if(!refreshed && typeof AppRouter !== 'undefined' && AppRouter.resolve) AppRouter.resolve();
    }catch(err){
      console.error('[pull-to-refresh] reload failed', err);
      if(typeof showToast === 'function') showToast('بروزرسانی ناموفق بود');
    }
    await minVisible;
    el.classList.remove('show', 'ptr-spinning');
    el.style.transform = 'translateY(-40px)';
    refreshing = false;
  }
}

function getQueryParam(name){
  try{
    return new URLSearchParams(window.location.search).get(name);
  }catch(e){
    return null;
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
        '<div style="font-size:1.05rem;font-weight:500;margin-bottom:8px;">خطا در بارگذاری اطلاعات</div>' +
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
      if (path === '/watches' || path === '/watch') return 'watches';
      if (path === '/checks') return 'checks';
      if (path === '/game') return 'game';
      if (path === '/settings') return 'settings';
      if (path === '/more') return 'more';
      return 'dashboard';
    }

    /* Per-route nav titles — iOS large-title convention: the tab bar labels
       already used for BOTTOM_NAV_ITEMS/MORE_NAV_ITEMS are reused for list
       pages so there is exactly one Persian label per section, and detail
       routes (customer/invoice/supplier/prospect/watch) get an honest
       generic detail title since the router has no record loaded yet to
       name it more specifically — a real per-record title (e.g. the
       customer's name) needs to be set by that view itself once it has
       loaded its data; see setHeaderTitle() below, callable from any view.
       Principle: this map holds each screen's own page title, never the
       business/brand name ("حبوبات و خشکبار باقری") — that's identity, not
       a page title, so it must not stand in for Dashboard's title or any
       other route here, even though Dashboard is the app's root/home tab. */
    const PAGE_TITLES = {
      '/': 'داشبورد',
      '/dashboard': 'داشبورد',
      '/products': 'اجناس',
      '/inventory': 'انبار',
      '/reports': 'گزارش‌ها',
      '/customers': 'مشتریان',
      '/customer': 'جزئیات مشتری',
      '/payments': 'پرداخت‌ها',
      '/invoices': 'فاکتورها',
      '/invoice': 'فاکتور',
      '/suppliers': 'تأمین‌کنندگان',
      '/supplier': 'جزئیات تأمین‌کننده',
      '/visits': 'ویزیت مشتریان',
      '/prospects': 'ارزیابی مغازه‌ها',
      '/prospect': 'جزئیات مغازه',
      '/prospect-routes': 'مسیرهای ویزیت',
      '/evaluation': 'ارزیابی مغازه',
      '/checks': 'چک‌ها',
      '/game': 'مرکز بازی فروش',
      '/settings': 'تنظیمات و پشتیبان',
      '/more': 'بیشتر',
      '/locations': 'مناطق و مسیرها',
      '/watches': 'واچ‌ها',
      '/watch': 'جزئیات واچ'
    };

    function makeViewHandler(View, activeId, path) {
      return function (params) {
        renderSharedNav(activeId);
        renderBottomNav(activeId);
        ensureAppBackButton(activeId, path);
        if (typeof setHeaderTitle === 'function') {
          setHeaderTitle(PAGE_TITLES[path] || '', { isRoot: activeId === 'dashboard' && (path === '/' || path === '/dashboard') });
        }
        const root = document.getElementById('main');
        if (!root || !View || typeof View.mount !== 'function') return function () {};
        return View.mount(root, params || {});
      };
    }

    AppRouter.registerRoute('/', makeViewHandler(typeof DashboardView !== 'undefined' ? DashboardView : null, 'dashboard', '/'));
    AppRouter.registerRoute('/dashboard', makeViewHandler(typeof DashboardView !== 'undefined' ? DashboardView : null, 'dashboard', '/dashboard'));
    AppRouter.registerRoute('/products', makeViewHandler(typeof ProductsView !== 'undefined' ? ProductsView : null, 'products', '/products'));
    AppRouter.registerRoute('/inventory', makeViewHandler(typeof InventoryView !== 'undefined' ? InventoryView : null, 'inventory', '/inventory'));
    AppRouter.registerRoute('/reports', makeViewHandler(typeof ReportsView !== 'undefined' ? ReportsView : null, 'reports', '/reports'));
    AppRouter.registerRoute('/customers', makeViewHandler(typeof CustomersView !== 'undefined' ? CustomersView : null, 'customers', '/customers'));
    AppRouter.registerRoute('/customer', makeViewHandler(typeof CustomerView !== 'undefined' ? CustomerView : null, 'customers', '/customer'));
    AppRouter.registerRoute('/payments', makeViewHandler(typeof PaymentsView !== 'undefined' ? PaymentsView : null, 'payments', '/payments'));
    AppRouter.registerRoute('/invoices', makeViewHandler(typeof InvoicesView !== 'undefined' ? InvoicesView : null, 'invoices', '/invoices'));
    AppRouter.registerRoute('/invoice', makeViewHandler(typeof InvoiceView !== 'undefined' ? InvoiceView : null, 'invoices', '/invoice'));
    AppRouter.registerRoute('/suppliers', makeViewHandler(typeof SuppliersView !== 'undefined' ? SuppliersView : null, 'suppliers', '/suppliers'));
    AppRouter.registerRoute('/supplier', makeViewHandler(typeof SupplierView !== 'undefined' ? SupplierView : null, 'suppliers', '/supplier'));
    AppRouter.registerRoute('/visits', makeViewHandler(typeof VisitsView !== 'undefined' ? VisitsView : null, 'visits', '/visits'));
    AppRouter.registerRoute('/prospects', makeViewHandler(typeof ProspectsView !== 'undefined' ? ProspectsView : null, 'prospects', '/prospects'));
    AppRouter.registerRoute('/prospect', makeViewHandler(typeof ProspectView !== 'undefined' ? ProspectView : null, 'prospects', '/prospect'));
    AppRouter.registerRoute('/prospect-routes', makeViewHandler(typeof LocationsView !== 'undefined' ? LocationsView : null, 'settings', '/prospect-routes'));
    AppRouter.registerRoute('/evaluation', makeViewHandler(typeof EvaluationView !== 'undefined' ? EvaluationView : null, 'prospects', '/evaluation'));
    AppRouter.registerRoute('/checks', makeViewHandler(typeof ChecksView !== 'undefined' ? ChecksView : null, 'checks', '/checks'));
    AppRouter.registerRoute('/game', makeViewHandler(typeof GameCenterView !== 'undefined' ? GameCenterView : null, 'game', '/game'));
    AppRouter.registerRoute('/settings', makeViewHandler(typeof SettingsView !== 'undefined' ? SettingsView : null, 'settings', '/settings'));
    AppRouter.registerRoute('/more', makeViewHandler(typeof MoreView !== 'undefined' ? MoreView : null, 'more', '/more'));
    AppRouter.registerRoute('/locations', makeViewHandler(typeof LocationsView !== 'undefined' ? LocationsView : null, 'settings', '/locations'));
    AppRouter.registerRoute('/watches', makeViewHandler(typeof WatchesView !== 'undefined' ? WatchesView : null, 'watches', '/watches'));
    AppRouter.registerRoute('/watch', makeViewHandler(typeof WatchDetailView !== 'undefined' ? WatchDetailView : null, 'watches', '/watch'));
    AppRouter.start();
    bindPullToRefresh();
  } catch (e) {
    console.error('bootSpaShell failed', e);
    if (typeof showToast === 'function') showToast('خطا در بارگذاری اطلاعات');
    const main = document.getElementById('main');
    if (main) {
      main.innerHTML = '<div class="empty" role="alert">خطا در بارگذاری اطلاعات. صفحه را دوباره باز کنید.</div>';
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
