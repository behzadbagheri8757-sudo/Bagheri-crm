/* sw-register.js — register App Shell service worker.
 * Does not alter bootPage, loadData, or business logic.
 * Does not force reload on controllerchange (safe for mid-invoice).
 */
(function () {
  if (!('serviceWorker' in navigator)) {
    return;
  }

  function register() {
    navigator.serviceWorker
      .register('./sw.js', { scope: './' })
      .then(function (reg) {
        function notifyUpdate() {
          if (typeof showToast === 'function') {
            showToast('نسخه جدید برنامه آماده است؛ بعد از پایان کار برنامه را ببندید و دوباره باز کنید.');
          }
        }
        if (reg.waiting && navigator.serviceWorker.controller) notifyUpdate();
        reg.addEventListener('updatefound', function () {
          var installing = reg.installing;
          if (!installing) return;
          installing.addEventListener('statechange', function () {
            if (installing.state === 'installed' && navigator.serviceWorker.controller) notifyUpdate();
          });
        });
        if (navigator.serviceWorker.controller) {
          console.info('[SW] controlling — offline shell should be active');
        } else {
          console.info('[SW] registered — control after activate/claim');
        }
      })
      .catch(function (err) {
        console.warn('[SW] registration failed', err);
      });
  }

  if (document.readyState === 'complete') {
    register();
  } else {
    window.addEventListener('load', register);
  }
})();
