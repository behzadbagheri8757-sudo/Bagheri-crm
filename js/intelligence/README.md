# Bagheri CRM Intelligence — Final Integrated Layer (P-01 … P-08)

## Authoritative modules (one version each)

| File | Patches included |
|------|------------------|
| signals.js | P-01, P-02, P-03, P-06 |
| sku_intelligence.js | P-05, P-06 |
| risk.js | P-01, P-02, P-03 |
| priority.js | P-04, P-08 |
| action.js | P-03, P-07, P-08 |
| persistence.js | P-02, P-05-fix (IDB v3) |
| feedback.js | P-03, P-05-fix (IDB v3) |
| baseline_manager.js | P-05, P-05-fix |
| seasonality.js | P-06 |
| interpretation.js | P-08 |

## Recommended script load order

```html
<script src="js/intelligence/persistence.js"></script>
<script src="js/intelligence/feedback.js"></script>
<script src="js/intelligence/baseline_manager.js"></script>
<script src="js/intelligence/seasonality.js"></script>
<script src="js/intelligence/interpretation.js"></script>
<script src="js/intelligence/signals.js"></script>
<script src="js/intelligence/sku_intelligence.js"></script>
<script src="js/intelligence/risk.js"></script>
<script src="js/intelligence/priority.js"></script>
<script src="js/intelligence/action.js"></script>
```

Shared IndexedDB: `bagheri_intelligence_db` version **3**  
Stores: `occurrences`, `seller_feedback`, `baseline_cache`

P-09 / P-10 were intentionally not implemented.
