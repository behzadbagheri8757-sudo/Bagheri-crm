# BAGHERI CRM — V60 Icon Fix

## Base
- Input: BAGHERI-CRM-iOS26-EyeFlow-SF-v59.zip
- Scope: icon rendering only; existing Eye Flow fixes preserved.

## What was fixed
1. `js/icons.js` now has a real SF-symbol SVG layer instead of only the local Heroicons registry.
2. All 14 semantic app icon keys have SF Symbol mappings with inactive/active variants.
3. Initial paint remains offline-safe: bundled fallback icons render immediately.
4. When online, SF SVGs are fetched once, normalized, stored in `localStorage`, and mounted icons are refreshed in place.
5. On later launches, cached SF geometry is used synchronously; no network is required for already-cached symbols.
6. If any SF asset cannot be fetched, that icon remains on the bundled fallback rather than disappearing.
7. `sw.js` cache name bumped from `baqeri-shell-v59` to `baqeri-shell-v60`.

## SF mapping
- home → house / house.fill
- users → person.2 / person.2.fill
- cube → shippingbox / shippingbox.fill
- documentText → note.text / note.text
- more → ellipsis.circle / ellipsis.circle.fill
- archiveBox → archivebox / archivebox.fill
- truck → truck.box / truck.box.fill
- banknotes → banknote / banknote.fill
- documentCheck → checkmark.seal / checkmark.seal.fill
- mapPin → mappin / mappin.fill
- buildingStorefront → storefront / storefront.fill
- trophy → trophy / trophy.fill
- chartBar → chart.bar / chart.bar.fill
- cog → gearshape / gearshape.fill

## Verification
- `node --check js/icons.js`: PASS
- `node --check sw.js`: PASS
- Runtime unit simulation with mocked fetch/localStorage/document: PASS
  - 14 fallback icons present
  - 14 SF mappings present
  - active-state marker present
  - fetched SVG cached
  - mounted icon refreshed from cache
  - `fill="currentColor"` normalization works
- Real iPhone/Safari visual runtime QA was not available in this environment, so no device screenshot PASS is claimed.
