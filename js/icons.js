/* icons.js — CENTRAL ICON SYSTEM
   SF Symbols geometry + local fallback.

   Runtime model:
   1) Render immediately from the bundled Heroicons fallback, so the UI never
      waits for a network request and never goes blank offline.
   2) When online, fetch the mapped SF Symbols SVGs once from the public
      sfsymbols-svg export, cache their inner SVG markup in localStorage.
   3) On later launches the cached SF geometry is used synchronously; the
      network is only needed to refresh a missing symbol.

   This keeps the PWA offline-first while replacing the visible icon geometry
   with the actual SF Symbols SVG exports once they have been cached.

   v3 — real ink-bounds normalization:
   The previous approach scaled every SF SVG uniformly about its viewBox
   center by a fixed 1.18 factor. That failed two ways on device:
     - SF exports carry ~25-30% internal padding, so 1.18 was too small;
     - the ink is not necessarily centered in its own viewBox, so scaling
       about the viewBox center amplified any pre-existing offset, which
       showed up as the glyph drifting up-and-left after replacement.
   v3 instead measures each fetched SF SVG's real ink bounds once (via
   getBBox() in an off-screen live container), then rewrites its viewBox to
   a canonical square centered on the measured ink center with a fixed
   padding ratio derived from the Heroicon reference in this same file.
   No per-symbol offsets, no guesses, no layout or CSS changes.
*/
(function (global) {
  'use strict';

  var SF_BASE = 'https://cdn.jsdelivr.net/gh/brendanballon/sfsymbols-svg@master/symbols/';
  /* Bumped v2 -> v3: v2 caches contain SVGs scaled about viewBox center
     (not ink center), which is the wrong geometry. v3 caches contain
     SVGs normalized to a canonical square about the measured ink center. */
  var SF_CACHE_KEY = 'baqeri_sf_symbols_v5';

  /* Canonical padding fraction applied around the measured ink on every
     side of the longest side. Chosen so the ink occupies ~87.9% of the
     canonical viewBox, matching the Heroicon fallbacks' own ink-to-viewBox
     ratio (Heroicons sit from ~2.25 to ~21.75 in a 0 0 24 24 viewBox with
     stroke-width 1.6, i.e. (19.5 + 1.6)/24 ≈ 0.879). Reference-derived,
     not a guess about SF geometry. */
  var SF_CANONICAL_PADDING = 0.069;

  /* Semantic app key -> SF Symbol name.
     The .fill variant is used for active state. */
  var SF_SYMBOLS = {
    home: ['house', 'house.fill'],
    users: ['person.2', 'person.2.fill'],
    cube: ['shippingbox', 'shippingbox.fill'],
    documentText: ['doc', 'doc.fill'],
    more: ['ellipsis.circle', 'ellipsis.circle.fill'],
    archiveBox: ['archivebox', 'archivebox.fill'],
    truck: ['truck.box', 'truck.box.fill'],
    banknotes: ['banknote', 'banknote.fill'],
    documentCheck: ['checkmark.seal', 'checkmark.seal.fill'],
    mapPin: ['mappin', 'mappin'],
    invoice: ['doc', 'doc.fill'],
    visit: ['calendar', 'calendar.fill'],
    buildingStorefront: ['storefront', 'storefront.fill'],
    trophy: ['trophy', 'trophy.fill'],
    chartBar: ['chart.bar', 'chart.bar.fill'],
    cog: ['gearshape', 'gearshape.fill']
  };

  /* Bundled fallback. Kept complete so first-run/offline rendering is safe. */
  var FALLBACK_ICONS = {
    home: {
      outline: '<path stroke-linecap="round" stroke-linejoin="round" d="m2.25 12 8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25"/>',
      solid: '<path d="M11.47 3.841a.75.75 0 0 1 1.06 0l8.69 8.69a.75.75 0 1 0 1.06-1.061l-8.689-8.69a2.25 2.25 0 0 0-3.182 0l-8.69 8.69a.75.75 0 1 0 1.061 1.06l8.69-8.689Z"/><path d="m12 5.432 8.159 8.159c.03.03.06.058.091.086v6.198c0 1.035-.84 1.875-1.875 1.875H15a.75.75 0 0 1-.75-.75v-4.5a.75.75 0 0 0-.75-.75h-3a.75.75 0 0 0-.75.75V21a.75.75 0 0 1-.75.75H5.625a1.875 1.875 0 0 1-1.875-1.875v-6.198a2.29 2.29 0 0 0 .091-.086L12 5.432Z"/>'
    },
    users: {
      outline: '<path stroke-linecap="round" stroke-linejoin="round" d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z"/>',
      solid: '<path d="M4.5 6.375a4.125 4.125 0 1 1 8.25 0 4.125 4.125 0 0 1-8.25 0ZM14.25 8.625a3.375 3.375 0 1 1 6.75 0 3.375 3.375 0 0 1-6.75 0ZM1.5 19.125a7.125 7.125 0 0 1 14.25 0v.003l-.001.119a.75.75 0 0 1-.363.63 13.067 13.067 0 0 1-6.761 1.873c-2.472 0-4.786-.684-6.76-1.873a.75.75 0 0 1-.364-.63l-.001-.122ZM17.25 19.128l-.001.144a2.25 2.25 0 0 1-.233.96 10.088 10.088 0 0 0 5.06-1.01.75.75 0 0 0 .42-.643 4.875 4.875 0 0 0-6.957-4.611 8.586 8.586 0 0 1 1.71 5.157v.003Z"/>'
    },
    cube: { outline: '<path stroke-linecap="round" stroke-linejoin="round" d="m21 7.5-9-5.25L3 7.5m18 0-9 5.25m9-5.25v9l-9 5.25M3 7.5l9 5.25M3 7.5v9l9 5.25m0-9v9"/>', solid: '<path d="M12.378 1.602a.75.75 0 0 0-.756 0L3 6.632l9 5.25 9-5.25-8.622-5.03ZM21.75 7.93l-9 5.25v9l8.628-5.032a.75.75 0 0 0 .372-.648V7.93ZM11.25 22.18v-9l-9-5.25v8.57a.75.75 0 0 0 .372.648l8.628 5.033Z"/>' },
    documentText: { outline: '<path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z"/>', solid: '<path fill-rule="evenodd" clip-rule="evenodd" d="M5.625 1.5c-1.036 0-1.875.84-1.875 1.875v17.25c0 1.035.84 1.875 1.875 1.875h12.75c1.035 0 1.875-.84 1.875-1.875V12.75A3.75 3.75 0 0 0 16.5 9h-1.875a1.875 1.875 0 0 1-1.875-1.875V5.25A3.75 3.75 0 0 0 9 1.5H5.625ZM7.5 15a.75.75 0 0 1 .75-.75h7.5a.75.75 0 0 1 0 1.5h-7.5A.75.75 0 0 1 7.5 15Zm.75 2.25a.75.75 0 0 0 0 1.5H12a.75.75 0 0 0 0-1.5H8.25Z"/>' },
    more: { outline: '<path stroke-linecap="round" stroke-linejoin="round" d="M8.625 12a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"/>', solid: '<path fill-rule="evenodd" clip-rule="evenodd" d="M12 2.25c-5.385 0-9.75 4.365-9.75 9.75s4.365 9.75 9.75 9.75 9.75-4.365 9.75-9.75S17.385 2.25 12 2.25Zm0 8.625a1.125 1.125 0 1 0 0 2.25 1.125 1.125 0 0 0 0-2.25ZM15.375 12a1.125 1.125 0 1 1 2.25 0 1.125 1.125 0 0 1-2.25 0ZM7.5 10.875a1.125 1.125 0 1 0 0 2.25 1.125 1.125 0 0 0 0-2.25Z"/>' },
    archiveBox: { outline: '<path stroke-linecap="round" stroke-linejoin="round" d="m20.25 7.5-.625 10.632a2.25 2.25 0 0 1-2.247 2.118H6.622a2.25 2.25 0 0 1-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125Z"/>', solid: '<path fill-rule="evenodd" clip-rule="evenodd" d="M3.375 3.75A1.875 1.875 0 0 0 15 5.625v1.5c0 .621.504 1.125 1.125 1.125h.245l.624 10.96A3.375 3.375 0 0 0 6.865 22.5h10.27a3.375 3.375 0 0 0 3.371-3.29l.624-10.96h.245A1.125 1.125 0 0 0 22.5 7.125v-1.5a1.875 1.875 0 0 0-1.875-1.875H3.375Zm2.79 6.75h11.67l-.65 8.624a1.125 1.125 0 0 1-1.122 1.041H7.937a1.125 1.125 0 0 1-1.122-1.041L6.165 10.5Zm3.46 3a.75.75 0 0 1 .75-.75h3.25a.75.75 0 0 1 0 1.5h-3.25a.75.75 0 0 1-.75-.75Z"/>' },
    truck: { outline: '<path stroke-linecap="round" stroke-linejoin="round" d="M8.25 18.75a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 0 1-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m3 0h1.125c.621 0 1.129-.504 1.09-1.124a17.902 17.902 0 0 0-3.213-9.193 2.056 2.056 0 0 0-1.58-.86H14.25M16.5 18.75h-2.25m0-11.177v-.958c0-.568-.422-1.048-.987-1.106a48.554 48.554 0 0 0-10.026 0 1.106 1.106 0 0 0-.987 1.106v7.635m12-6.677v6.677m0 4.5v-4.5m0 0h-12"/>', solid: '<path fill-rule="evenodd" clip-rule="evenodd" d="M2.25 5.625A1.875 1.875 0 0 1 4.125 3.75H14.25a1.875 1.875 0 0 1 1.875 1.875V7.5h2.29c.675 0 1.31.36 1.65.944l2.44 4.18c.12.206.183.44.183.678v4.073A1.875 1.875 0 0 1 20.813 19.25h-.126a3.375 3.375 0 1 1-6.375 0H8.688a3.375 3.375 0 1 1-6.375 0h-.063A1.875 1.875 0 0 1 .375 17.375V7.5c0-1.036.84-1.875 1.875-1.875ZM17.25 10.5v3h3.05l-1.75-3h-1.3ZM5.5 20.25a1.875 1.875 0 1 0 0-3.75 1.875 1.875 0 0 0 0 3.75Zm11.812 0a1.875 1.875 0 1 0 0-3.75 1.875 1.875 0 0 0 0 3.75Z"/>' },
    banknotes: { outline: '<path stroke-linecap="round" stroke-linejoin="round" d="M2.25 18.75a60.07 60.07 0 0 1 15.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 0 1 3 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 0 0-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 0 1-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 0 0 3 15h-.75M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm3 0h.008v.008H18V10.5Zm-12 0h.008v.008H6V10.5Z"/>', solid: '<path fill-rule="evenodd" clip-rule="evenodd" d="M2.25 4.5A2.25 2.25 0 0 0 0 6.75v7.5a2.25 2.25 0 0 0 2.25 2.25h15.5A2.25 2.25 0 0 0 20 14.25v-7.5A2.25 2.25 0 0 0 17.75 4.5H2.25Zm7.75 2.25a3.75 3.75 0 1 0 0 7.5 3.75 3.75 0 0 0 0-7.5ZM3.75 8.25a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5Zm12.5 4.5a.75.75 0 1 1 0 1.5.75.75 0 0 1 0 1.5Z"/>' },
    documentCheck: { outline: '<path stroke-linecap="round" stroke-linejoin="round" d="M10.125 2.25h-4.5c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125v-9M10.125 2.25h.375a9 9 0 0 1 9 9v.375M10.125 2.25A3.375 3.375 0 0 1 13.5 5.625v1.5c0 .621.504 1.125 1.125 1.125h1.5a3.375 3.375 0 0 1 3.375 3.375M9 15l2.25 2.25L15 12"/>', solid: '<path fill-rule="evenodd" clip-rule="evenodd" d="M5.625 1.5A1.875 1.875 0 0 0 3.75 3.375v17.25c0 1.036.84 1.875 1.875 1.875h12.75a1.875 1.875 0 0 0 1.875-1.875V10.5a3.75 3.75 0 0 0-3.75-3.75h-1.875A1.875 1.875 0 0 1 14.75 4.875V3.375A1.875 1.875 0 0 0 12.875 1.5H5.625Zm3.75 13.5 1.5 1.5 3.75-4.5 1.125 1.125-4.875 5.625-2.625-2.625L9.375 15Z"/>' },
    mapPin: { outline: '<path stroke-linecap="round" stroke-linejoin="round" d="M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"/><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1 1 15 0Z"/>', solid: '<path fill-rule="evenodd" clip-rule="evenodd" d="M12 22.5s7.5-4.108 7.5-12a7.5 7.5 0 1 0-15 0c0 7.892 7.5 12 7.5 12Zm0-9a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"/>' },
    buildingStorefront: { outline: '<path stroke-linecap="round" stroke-linejoin="round" d="M13.5 21v-7.5a.75.75 0 0 1 .75-.75h3a.75.75 0 0 1 .75.75V21m-4.5 0H2.36m11.14 0H18m0 0h3.64m-1.39 0V9.349M3.75 21V9.349m0 0a3.001 3.001 0 0 0 3.75-.615A2.993 2.993 0 0 0 9.75 9.75c.896 0 1.7-.393 2.25-1.016a2.993 2.993 0 0 0 2.25 1.016c.896 0 1.7-.393 2.25-1.015a3.001 3.001 0 0 0 3.75.614m-16.5 0a3.004 3.004 0 0 1-.621-4.72l1.189-1.19A1.5 1.5 0 0 1 5.378 3h13.243a1.5 1.5 0 0 1 1.06.44l1.19 1.189a3 3 0 0 1-.621 4.72M6.75 18h3.75a.75.75 0 0 0 .75-.75V13.5a.75.75 0 0 0-.75-.75H6.75a.75.75 0 0 0-.75.75v3.75c0 .414.336.75.75.75Z"/>', solid: '<path fill-rule="evenodd" clip-rule="evenodd" d="M5.378 3h13.244a2.25 2.25 0 0 1 1.59.659l1.19 1.19a3.75 3.75 0 0 1-.777 5.893V20.25h.75a.75.75 0 0 1 0 1.5H2.625a.75.75 0 0 1 0-1.5h.75V10.742a3.75 3.75 0 0 1-.777-5.893l1.19-1.19A2.25 2.25 0 0 1 5.378 3Zm1.247 10.5a.75.75 0 0 0-.75.75v4.5h12.25v-4.5a.75.75 0 0 0-.75-.75h-3.5a.75.75 0 0 0-.75.75v4.5h-1.25v-4.5a.75.75 0 0 0-.75-.75h-3.5Z"/>' },
    trophy: { outline: '<path stroke-linecap="round" stroke-linejoin="round" d="M16.5 18.75h-9m9 0a3 3 0 0 1 3 3h-15a3 3 0 0 1 3-3m9 0v-3.375c0-.621-.503-1.125-1.125-1.125h-.871M7.5 18.75v-3.375c0-.621.504-1.125 1.125-1.125h.872m5.007 0H9.497m5.007 0a7.454 7.454 0 0 1-.982-3.172M9.497 14.25a7.454 7.454 0 0 0 .981-3.172M5.25 4.236c-.982.143-1.954.317-2.916.52A6.003 6.003 0 0 0 7.73 9.728M5.25 4.236V4.5c0 2.108.966 3.99 2.48 5.228M5.25 4.236V2.721C7.456 2.41 9.71 2.25 12 2.25c2.291 0 4.545.16 6.75.47v1.516M7.73 9.728a6.726 6.726 0 0 0 2.748 1.35m8.272-6.842V4.5c0 2.108-.966 3.99-2.48 5.228m2.48-5.492a46.32 46.32 0 0 1 2.916.52 6.003 6.003 0 0 1-5.395 4.972m0 0a6.726 6.726 0 0 1-2.749 1.35m0 0a6.772 6.772 0 0 1-3.044 0"/>', solid: '<path fill-rule="evenodd" clip-rule="evenodd" d="M6 3.75h12v1.5h2.25a2.25 2.25 0 0 1 2.22 2.62 7.5 7.5 0 0 1-5.97 6.14 6.76 6.76 0 0 1-2.25 2.05V18h3a2.25 2.25 0 0 1 2.25 2.25v1.5H4.5v-1.5A2.25 2.25 0 0 1 6.75 18h3v-1.94a6.76 6.76 0 0 1-2.25-2.05 7.5 7.5 0 0 1-5.97-6.14A2.25 2.25 0 0 1 3.75 5.25H6v-1.5Zm-2.25 3a.75.75 0 0 0-.74.87 5.25 5.25 0 0 0 3.4 4.23A7.48 7.48 0 0 1 6 8.25v-1.5H3.75Zm14.25 0v1.5a7.48 7.48 0 0 1-.41 3.6 5.25 5.25 0 0 0 3.4-4.23.75.75 0 0 0-.74-.87H18Z"/>' },
    chartBar: { outline: '<path stroke-linecap="round" stroke-linejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z"/>', solid: '<path fill-rule="evenodd" clip-rule="evenodd" d="M3 13.125A1.875 1.875 0 0 1 4.875 11.25h2.25A1.875 1.875 0 0 1 9 13.125V19.5a1.875 1.875 0 0 1-1.875 1.875h-2.25A1.875 1.875 0 0 1 3 19.5v-6.375Zm6.75-4.5A1.875 1.875 0 0 1 11.625 6.75h2.25a1.875 1.875 0 0 1 1.875 1.875V19.5a1.875 1.875 0 0 1-1.875 1.875h-2.25A1.875 1.875 0 0 1 9.75 19.5V8.625Zm6.75-4.5A1.875 1.875 0 0 1 18.375 2.25h2.25A1.875 1.875 0 0 1 22.5 4.125V19.5a1.875 1.875 0 0 1-1.875 1.875h-2.25A1.875 1.875 0 0 1 16.5 19.5V4.125Z"/>' },
    cog: { outline: '<path stroke-linecap="round" stroke-linejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z"/><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"/>', solid: '<path fill-rule="evenodd" clip-rule="evenodd" d="M9.594 3.94A1.875 1.875 0 0 1 11.445 2.25h1.11a1.875 1.875 0 0 1 1.851 1.69l.147.885c.19.07.374.146.555.23l.806-.302a1.875 1.875 0 0 1 2.28.817l.555.962a1.875 1.875 0 0 1-.434 2.383l-.69.568c.012.2.012.4 0 .6l.69.568a1.875 1.875 0 0 1 .434 2.383l-.555.962a1.875 1.875 0 0 1-2.28.817l-.806-.302c-.181.084-.365.16-.555.23l-.147.885a1.875 1.875 0 0 1-1.851 1.69h-1.11a1.875 1.875 0 0 1-1.851-1.69l-.147-.885a7.46 7.46 0 0 1-.555-.23l-.806.302a1.875 1.875 0 0 1-2.28-.817l-.555-.962a1.875 1.875 0 0 1 .434-2.383l.69-.568a5.16 5.16 0 0 1 0-.6l-.69-.568a1.875 1.875 0 0 1-.434-2.383l.555-.962a1.875 1.875 0 0 1 2.28-.817l.806.302c.181-.084.365-.16.555-.23.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z"/>' }
  };

  var sfCache = {};
  try { sfCache = JSON.parse(global.localStorage.getItem(SF_CACHE_KEY) || '{}') || {}; } catch (e) { sfCache = {}; }

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function round2(n) {
    return Math.round(n * 100) / 100;
  }

  /* Off-screen SVG container used only for measuring a fetched SF symbol's
     real ink bounds once, before the normalized form is cached. Reused
     across symbols. Uses position:fixed;left:-10000px (off-screen but
     still laid out) — display:none or visibility:hidden would break
     getBBox() in some WebKit versions. */
  var _measureWrapper = null;
  function _getMeasureWrapper() {
    if (!global.document || !global.document.body) return null;
    if (_measureWrapper && _measureWrapper.parentNode) return _measureWrapper;
    var svgNS = 'http://www.w3.org/2000/svg';
    _measureWrapper = global.document.createElementNS(svgNS, 'svg');
    _measureWrapper.setAttribute('xmlns', svgNS);
    _measureWrapper.setAttribute('width', '100');
    _measureWrapper.setAttribute('height', '100');
    _measureWrapper.style.cssText =
      'position:fixed;left:-10000px;top:-10000px;width:100px;height:100px;overflow:hidden;pointer-events:none;';
    global.document.body.appendChild(_measureWrapper);
    return _measureWrapper;
  }

  /* Measure the actual ink bounds of `inner` rendered under `viewBox` in
     the SVG's own coordinate system. Returns { x, y, width, height } or
     null when measurement is unavailable (no DOM, getBBox throws, or the
     bounds are degenerate). No side effects on the caller's SVG. */
  function measureSvgInkBounds(viewBox, inner) {
    var wrapper = _getMeasureWrapper();
    if (!wrapper) return null;
    try {
      while (wrapper.firstChild) wrapper.removeChild(wrapper.firstChild);
      wrapper.setAttribute('viewBox', viewBox);
      wrapper.innerHTML = inner;
      void wrapper.getBoundingClientRect();
      var svgNS = 'http://www.w3.org/2000/svg';
      var g = global.document.createElementNS(svgNS, 'g');
      while (wrapper.firstChild) g.appendChild(wrapper.firstChild);
      wrapper.appendChild(g);
      void wrapper.getBoundingClientRect();
      var bb = null;
      try {
        if (typeof g.getBBox === 'function') bb = g.getBBox();
      } catch (eBb) {
        bb = null;
      }
      while (wrapper.firstChild) wrapper.removeChild(wrapper.firstChild);
      if (!bb) return null;
      var bx = Number(bb.x), by = Number(bb.y), bw = Number(bb.width), bh = Number(bb.height);
      if (!isFinite(bx) || !isFinite(by) || !isFinite(bw) || !isFinite(bh)) return null;
      if (!(bw > 0) || !(bh > 0)) return null;
      return { x: bx, y: by, width: bw, height: bh };
    } catch (e) {
      try { while (wrapper.firstChild) wrapper.removeChild(wrapper.firstChild); } catch (eClean) {}
      return null;
    }
  }

  /* Turn a raw SF SVG document into the cached normalized form
     { viewBox, inner }:
       - fill="black" / fill="#000" / fill="#000000" -> fill="currentColor"
       - strip any width / height attributes on inner elements
       - measure the true ink bounds once (getBBox in a hidden container)
       - rewrite the viewBox to a canonical SQUARE centered on the ink
         center with SF_CANONICAL_PADDING of padding on every side of the
         longest side; the outer SVG element box therefore stays the same
         nominal size at every render while the visible ink footprint
         matches the Heroicon fallbacks'.
     If measurement is unavailable, the original viewBox is preserved and
     no scaling is applied — never reintroduce the drift the earlier
     viewBox-center scale caused. */
  function normalizeSvg(text) {
    var m = String(text || '').match(/<svg\b([^>]*)>([\s\S]*?)<\/svg>/i);
    if (!m) return null;
    var attrs = m[1] || '';
    var originalViewBox = (attrs.match(/viewBox\s*=\s*["']([^"']+)["']/i) || [])[1] || '0 0 100 100';
    var inner = m[2]
      .replace(/\sfill\s*=\s*["'](?:#(?:000|000000)|black)["']/gi, ' fill="currentColor"')
      .replace(/\s(?:width|height)\s*=\s*["'][^"']*["']/gi, '');

    var ink = measureSvgInkBounds(originalViewBox, inner);
    if (!ink) {
      return { viewBox: originalViewBox, inner: inner };
    }

    var longSide = Math.max(ink.width, ink.height);
    if (!(longSide > 0)) {
      return { viewBox: originalViewBox, inner: inner };
    }
    var padded = longSide * (1 + 2 * SF_CANONICAL_PADDING);
    var inkCx = ink.x + ink.width / 2;
    var inkCy = ink.y + ink.height / 2;
    var canonVx = inkCx - padded / 2;
    var canonVy = inkCy - padded / 2;
    var canonicalViewBox =
      round2(canonVx) + ' ' + round2(canonVy) + ' ' + round2(padded) + ' ' + round2(padded);

    return { viewBox: canonicalViewBox, inner: inner };
  }

  function cacheSave() {
    try { global.localStorage.setItem(SF_CACHE_KEY, JSON.stringify(sfCache)); } catch (e) {}
  }

  function cacheKey(name, active) {
    var pair = SF_SYMBOLS[name];
    return pair ? (active ? pair[1] : pair[0]) : '';
  }

  function cachedMarkup(name, active) {
    var key = cacheKey(name, active);
    return key && sfCache[key] ? sfCache[key] : null;
  }

  function render(name, opts) {
    opts = opts || {};
    var def = FALLBACK_ICONS[name];
    if (!def) return '';
    var active = !!opts.active;
    var size = opts.size || 22;
    var cached = cachedMarkup(name, active);
    var markup = cached ? cached.inner : (active && def.solid ? def.solid : def.outline);
    var viewBox = cached ? cached.viewBox : '0 0 24 24';
    var attrs = cached ? 'fill="currentColor"' : (active && def.solid ? 'fill="currentColor"' : 'fill="none" stroke="currentColor" stroke-width="1.6"');
    var vbParts = String(viewBox).trim().split(/\s+/);
    var vbW = parseFloat(vbParts[2]) || 24;
    var vbH = parseFloat(vbParts[3]) || 24;
    var scale = size / Math.min(vbW, vbH);
    var w = Math.round(vbW * scale * 100) / 100;
    var h = Math.round(vbH * scale * 100) / 100;
    return '<svg class="app-icon app-icon-' + escapeHtml(name) + '" viewBox="' + escapeHtml(viewBox) + '" width="' + w + '" height="' + h + '" ' + attrs + ' data-app-icon-name="' + escapeHtml(name) + '" data-app-icon-active="' + (active ? '1' : '0') + '" data-app-icon-size="' + size + '" aria-hidden="true" focusable="false">' + markup + '</svg>';
  }

  /* V61 semantic fallbacks. SF_SYMBOLS is intentionally unchanged. */
  FALLBACK_ICONS.creditcard = FALLBACK_ICONS.banknotes;
  FALLBACK_ICONS.bank = FALLBACK_ICONS.banknotes;
  FALLBACK_ICONS.warehouse = { outline: '<path stroke-linecap="round" stroke-linejoin="round" d="M4 20V10L12 4L20 10V20Z"/><path stroke-linecap="round" stroke-linejoin="round" d="M9 20V14H15V20"/>', solid: '<path fill-rule="evenodd" clip-rule="evenodd" d="M4 20V10L12 4L20 10V20Z M9 20V14H15V20Z"/>' };
  FALLBACK_ICONS.invoice = FALLBACK_ICONS.documentText;
  FALLBACK_ICONS.cheque = { outline: '<path stroke-linecap="round" stroke-linejoin="round" d="M3 7H21V17H3Z M6 10.5H18 M14 14.5L15.2 13.5L16.4 14.5L17.6 13.5L18.6 14.3"/>', solid: '<path fill-rule="evenodd" clip-rule="evenodd" d="M3 7H21V17H3Z M6 10H18V11H6Z"/>' };
  FALLBACK_ICONS.visit = FALLBACK_ICONS.documentCheck;
  FALLBACK_ICONS.target = { outline: '<circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="12" cy="12" r="4.5" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/>', solid: '<path fill-rule="evenodd" clip-rule="evenodd" d="M12 2.25a9.75 9.75 0 1 0 9.75 9.75A9.75 9.75 0 0 0 12 2.25Zm0 5a4.75 4.75 0 1 1-4.75 4.75A4.75 4.75 0 0 1 12 7.25Zm0 3a1.75 1.75 0 1 0 1.75 1.75A1.75 1.75 0 0 0 12 10.25Z"/>' };
  FALLBACK_ICONS.growth = { outline: '<path d="M3 17l6-6 4 4 8-8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M15 7h6v6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>', solid: '<path d="M3 18a1 1 0 0 1-.707-1.707l6-6a1 1 0 0 1 1.414 0L13 13.586l7.293-7.293A1 1 0 0 1 21.707 7.707l-8 8a1 1 0 0 1-1.414 0L9 12.414l-5.293 5.293A1 1 0 0 1 3 18Z"/>' };
  FALLBACK_ICONS.chartDoc = FALLBACK_ICONS.chartBar;
  FALLBACK_ICONS.checklist = FALLBACK_ICONS.documentCheck;
  FALLBACK_ICONS.plusCircle = { outline: '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M12 8v8M8 12h8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>', solid: '<path fill-rule="evenodd" clip-rule="evenodd" d="M12 2.25a9.75 9.75 0 1 0 9.75 9.75A9.75 9.75 0 0 0 12 2.25Zm1 6.75a1 1 0 1 0-2 0v2h-2a1 1 0 1 0 0 2h2v2a1 1 0 1 0 2 0v-2h2a1 1 0 1 0 0-2h-2V9Z"/>' };
  FALLBACK_ICONS.basket = FALLBACK_ICONS.archiveBox;
  FALLBACK_ICONS.gamepad = FALLBACK_ICONS.trophy;
  FALLBACK_ICONS.clipboard = FALLBACK_ICONS.documentCheck;
  FALLBACK_ICONS.flame = { outline: '<path d="M12 22a7 7 0 0 0 7-7c0-3.4-2.2-6.2-4.5-8.7.1 2.3-.7 3.6-1.8 4.6.1-3.9-1.9-6.9-4.2-8.9.1 3.5-1 5.9-2.3 7.8C5.1 11.8 5 13.1 5 15a7 7 0 0 0 7 7Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>', solid: '<path d="M12 22a7 7 0 0 0 7-7c0-3.4-2.2-6.2-4.5-8.7.1 2.3-.7 3.6-1.8 4.6.1-3.9-1.9-6.9-4.2-8.9.1 3.5-1 5.9-2.3 7.8C5.1 11.8 5 13.1 5 15a7 7 0 0 0 7 7Z"/>' };
  FALLBACK_ICONS.bolt = { outline: '<path d="M13 3 5 13h6l-1 8 8-11h-6l1-7Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>', solid: '<path d="M13.5 2.5a.75.75 0 0 1 .65 1.14L10.94 10H16a.75.75 0 0 1 .61 1.19l-8 11a.75.75 0 0 1-1.34-.55l1.02-7.14H4a.75.75 0 0 1-.59-1.22l8-10a.75.75 0 0 1 1.09-.78l1 .0Z"/>' };
  FALLBACK_ICONS.checkmark = { outline: '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="m8 12 2.5 2.5L16 9" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>', solid: '<path fill-rule="evenodd" clip-rule="evenodd" d="M12 2.25a9.75 9.75 0 1 0 9.75 9.75A9.75 9.75 0 0 0 12 2.25Zm4.03 7.78a.75.75 0 0 0-1.06-1.06l-3.72 3.72-1.22-1.22a.75.75 0 0 0-1.06 1.06l1.75 1.75a.75.75 0 0 0 1.06 0l4.25-4.25Z"/>' };
  FALLBACK_ICONS.medal = FALLBACK_ICONS.trophy;
  FALLBACK_ICONS.flag = { outline: '<path d="M6 21V4m0 0c4-3 7 3 12 0v9c-5 3-8-3-12 0" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>', solid: '<path d="M5.25 21a.75.75 0 0 0 1.5 0V14.5c3.8-2.1 7.3 3 11.25.3V4.2c0-.6-.67-.94-1.14-.58-3.72 2.8-7.1-2.2-11.11-.25A.75.75 0 0 0 5.25 4v17Z"/>' };
  FALLBACK_ICONS.urgencyCritical = { outline: '<path d="M12 9v4m0 4h.01M10.36 3.59 2.25 17.13a1.91 1.91 0 0 0 1.64 2.87h16.22a1.91 1.91 0 0 0 1.64-2.87L13.64 3.59a1.91 1.91 0 0 0-3.28 0Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>', solid: '<path fill-rule="evenodd" clip-rule="evenodd" d="M12 3a1.75 1.75 0 0 1 1.5.85l8.1 13.54A1.75 1.75 0 0 1 20.1 20H3.9a1.75 1.75 0 0 1-1.5-2.61l8.1-13.54A1.75 1.75 0 0 1 12 3Zm0 5.5a.75.75 0 0 0-.75.75v4a.75.75 0 0 0 1.5 0v-4A.75.75 0 0 0 12 8.5Zm0 8a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"/>' };
  FALLBACK_ICONS.urgencyHigh = { outline: '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M12 12c2-3 0-7-1-8 0 3-2 5-3 6.2C6.8 11.4 6 13.2 6 15a6 6 0 0 0 12 0c0-1.5-1.1-3.8-1.5-4.5.25 1.53.25 2.5-1 3.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>', solid: '<path d="M12 22a7 7 0 0 0 7-7c0-2.2-1.1-4.4-2.4-6.2-.1 1.1-.5 2.1-1.4 2.8.1-3-1.4-6.4-4.3-9.1.2 3.8-1.2 5.8-2.5 7.5C7.3 11.3 6 13.2 6 15a6 6 0 0 0 6 7Z"/>' };
  FALLBACK_ICONS.urgencyMedium = { outline: '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M12 7v5l3 3" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>', solid: '<path fill-rule="evenodd" clip-rule="evenodd" d="M12 2.25a9.75 9.75 0 1 0 9.75 9.75A9.75 9.75 0 0 0 12 2.25Zm1 4.75a1 1 0 1 0-2 0v5c0 .27.11.52.3.7l3 3a1 1 0 0 0 1.4-1.4L13 11.59V7Z"/>' };
  FALLBACK_ICONS.urgencyLow = { outline: '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M12 11v5m0-8h.01" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>', solid: '<path fill-rule="evenodd" clip-rule="evenodd" d="M12 2.25a9.75 9.75 0 1 0 9.75 9.75A9.75 9.75 0 0 0 12 2.25Zm1 5.75a1 1 0 1 0-2 0v.01a1 1 0 1 0 2 0V8Zm0 3a1 1 0 0 0-2 0v5a1 1 0 1 0 2 0v-5Z"/>' };

  function has(name) { return Object.prototype.hasOwnProperty.call(FALLBACK_ICONS, name); }

  function refreshMountedIcons() {
    if (!global.document || !global.document.querySelectorAll) return;
    global.document.querySelectorAll('[data-app-icon-name]').forEach(function (node) {
      var name = node.getAttribute('data-app-icon-name');
      var active = node.getAttribute('data-app-icon-active') === '1';
      if (!cachedMarkup(name, active)) return;
      var next = render(name, { active: active, size: parseInt(node.getAttribute('data-app-icon-size') || node.getAttribute('width') || '22', 10) || 22 });
      if (next) node.outerHTML = next;
    });
  }

  function fetchSymbol(symbolName) {
    if (!symbolName || sfCache[symbolName]) return Promise.resolve(true);
    return fetch(SF_BASE + encodeURIComponent(symbolName) + '.svg', { cache: 'force-cache' })
      .then(function (r) { if (!r.ok) throw new Error('SF SVG ' + r.status); return r.text(); })
      .then(function (text) {
        var normalized = normalizeSvg(text);
        if (!normalized) throw new Error('Invalid SF SVG');
        sfCache[symbolName] = normalized;
        cacheSave();
        return true;
      })
      .catch(function () { return false; });
  }

  function preloadSfIcons() {
    var names = [];
    Object.keys(SF_SYMBOLS).forEach(function (key) {
      SF_SYMBOLS[key].forEach(function (symbol) { if (!sfCache[symbol]) names.push(symbol); });
    });
    if (!names.length) { refreshMountedIcons(); return Promise.resolve(true); }
    return Promise.all(names.map(fetchSymbol)).then(function () {
      refreshMountedIcons();
      return true;
    });
  }

  global.AppIcons = {
    render: render,
    has: has,
    ICONS: FALLBACK_ICONS,
    SF_SYMBOLS: SF_SYMBOLS,
    SF_CACHE_KEY: SF_CACHE_KEY,
    preloadSfIcons: preloadSfIcons,
    refreshMountedIcons: refreshMountedIcons
  };

  /* Never block initial paint. Cached symbols render immediately; uncached
     symbols are upgraded in the background when the network is available. */
  try {
    if (global.document && global.document.readyState === 'loading') {
      global.document.addEventListener('DOMContentLoaded', preloadSfIcons, { once: true });
    } else {
      setTimeout(preloadSfIcons, 0);
    }
  } catch (e) {}
})(window);
