/* view.host.js — centralized SPA view refresh registry (Phase 10) */
'use strict';
(function (global) {
  let current = null;
  let serial = 0;
  function setRefresh(refresh) {
    const token = ++serial;
    current = { token, refresh: typeof refresh === 'function' ? refresh : null };
    return token;
  }
  function clearRefresh(token) {
    if (current && (token == null || current.token === token)) current = null;
  }
  function refreshCurrent() {
    if (!current || typeof current.refresh !== 'function') return false;
    try { current.refresh(); return true; }
    catch (e) { console.error('[ViewHost] refresh failed', e); return false; }
  }
  global.ViewHost = { setRefresh, clearRefresh, refreshCurrent };
})(typeof window !== 'undefined' ? window : this);
