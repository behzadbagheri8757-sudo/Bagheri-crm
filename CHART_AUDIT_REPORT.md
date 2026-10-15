# BAGHERI — Chart Presentation & Correctness Audit

Base: `Bagheri-crm-round11-invoice-detail-chart-test-v3.zip`

## Scope

Presentation/read-only audit of exactly three charts:
1. Customers list Sparkline
2. Customer detail purchase trend
3. Reports sales trend

No accounting, FIFO, Intelligence, Watch, backup, schema, or data-source logic was changed.

## Findings and fixes

### 1) Customers list Sparkline — FIXED
- Problem: the chart had no visible explanation of what the line represented.
- Problem: the last-point dot sat directly on the SVG edge, making it vulnerable to clipping/white-space on the right.
- Fix: added a single, quiet list-level legend: `روند خرید · ۸ هفته اخیر` so the meaning is explained once rather than repeated on every row.
- Fix: inset chart geometry to x=4..96 and reduced stroke/dot weight; the endpoint is now safely inside the drawable area.
- Fix: SVG overflow is explicitly visible.
- Data basis remains the existing invoice totals returned by `customerInvoices()`; this is presentation only.

### 2) Customer detail trend — FIXED / CLARIFIED
- The plotted series is the same 8-week invoice-total series used by the list Sparkline.
- The previous small text `روند افزایشی/کاهشی/تقریباً ثابت` was based on `customerBehavior.amountTrend`, which is a different 30-day net-sales comparison. That was a semantic mismatch.
- Fix: the small trend label is now derived from the same 8-week chart data (first four weeks vs last four weeks), so the label describes the chart actually shown.
- Added `۸ هفته اخیر` beside the title.
- Accessible chart description now explicitly says it is based on invoice amounts.

### 3) Reports trend — PASS / CLARIFIED
- The chart uses the same daily invoice-total series that feeds the report-period gross sales figure.
- Previous-period dashed line uses the corresponding prior week/month day buckets where the report supports comparison.
- Today intentionally has no intra-day line because invoices contain date-only data.
- All-time uses monthly buckets and the latest 12 months.
- RTL presentation is intentional: the newest point is on the left, matching the Persian report presentation; the chart interaction code uses the same right-origin coordinate system.
- Added a very small subtitle: `مبلغ فاکتورها در هر روز` so the chart's measure is explicit without adding another legend/card.

## State/navigation audit

- `reportPeriod` is module state and is not reset when the Reports view is unmounted/remounted, so switching `امروز / این هفته / این ماه / همه` and navigating away/back does not force the period back to `این ماه`.
- Clicking a period updates only the existing period state and re-renders the report body.
- Chart pointer state is cleared/rebuilt with the report body, preventing stale chart references.
- Event listeners are removed on unmount.

## Static verification

- `node --check` PASS:
  - `js/views/customers.js`
  - `js/views/customer.js`
  - `js/views/reports.js`
- Diff review: only these three JS files plus `css/visual-grammar-pages.css` changed for this patch.
- No Intelligence/Watch identifiers or internal SKU categories were renamed. User-visible SKU wording already remains Persian; internal IDs such as `SKU_DELAY` are intentionally untouched.

## Result

**PASS — presentation patch approved for iPhone visual testing.**

Remaining limitation: this audit did not claim a real-data iPhone runtime test. The exact rendered appearance should still be checked on the user's iPhone/PWA, especially the customer-list Sparkline alignment at the right edge.
