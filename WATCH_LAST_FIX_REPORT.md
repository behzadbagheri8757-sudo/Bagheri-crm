# Final Watch micro-fix audit — 2026-10-02

Scope: only the requested corrections to the previously delivered Watch patch. No thresholds, windows, families, units, Alert generation, Priority, or Action logic were changed.

## Changes

### 1. Follow-up result must hold the same subject while raw Watch remains
`completeWatchFollowUp()` no longer writes `suppression.releasedAt` for `price`, `competitor`, `no_need`, `quality`, or `other`.

Instead it stores:
- `suppression.type = "follow_up_result"`
- `suppression.resultCode = <actual cause>`
- `suppression.resultComment = <actual note>`
- `releasedAt = null`

The existing reconcile logic can release this hold only when the raw Watch condition is genuinely absent and the raw generator completed successfully. It is not converted to `not_wanted` and is not a permanent global mute.

### 2. `recordWatchReason('dismiss')` is rejected
`dismiss` is an explicit lifecycle operation, not a reason. `recordWatchReason()` now returns `null` for `dismiss`; `dismissWatchOccurrence()` remains the only close path. This prevents a UI/data path from claiming that a Watch was closed when it merely stored a reason.

### 3. BASKET_SHRINK_WATCH display follows its actual evidence
Customer and Watches views now derive the displayed title from `evidence.affectedProducts`, naming the actual affected products and the real comparison: first half of invoices versus second half. The raw generator and thresholds are untouched.

### 4. Quantity display
The existing unit source remains product master data: `packageWeight > 0` means the registered sale is package-based and displays `بسته`; `packageWeight = 0` displays `کیلو`. No product name is inspected to infer a unit. The real backup confirms examples such as عدس روس (`packageWeight=0`) and کشمش پلویی (`packageWeight=8.5`).

All newly composed display strings are escaped at their HTML insertion points.

## Tests

| Test | Result | Evidence |
|---|---|---|
| follow_up_later → price → reconcile with raw Watch still active | PASS | Same occurrence count; no new ID; `suppression.type=follow_up_result`, `resultCode=price`, `releasedAt=null` |
| competitor | PASS | Same assertions |
| no_need | PASS | Same assertions |
| quality | PASS | Same assertions |
| other | PASS | Same assertions |
| follow_up_later → raw Watch disappears → next encounter | PASS | `getPendingWatchFollowUps('c1')` still returns the original occurrence ID after reconcile with empty raw Watch output |
| explicit dismiss path | PASS | `recordWatchReason(id,'dismiss',...) === null`; `dismissWatchOccurrence()` closes it and the next unchanged reconcile does not recreate it |
| genuine condition clear → recurrence | PASS | Hold is released with `releasedBy='condition_cleared'`; when the raw condition genuinely reappears, a new occurrence ID is created |
| BASKET evidence label + HTML escaping | PASS | Actual affected product names are included; `<` and `&` are escaped before HTML insertion |
| registered quantity unit source | PASS | Backup data: عدس روس `packageWeight=0`; کشمش پلویی `packageWeight=8.5` |
| all JS syntax | PASS | `node --check` passed for every `js/**/*.js` file in the final build |

## Deep audit findings

- No remaining assignment of `releasedAt = now` exists inside `completeWatchFollowUp()` for the five factual causes.
- The only direct `releasedAt = now` in the lifecycle is `_releaseSuppression()`, which is the centralized release mechanism used by actual lifecycle transitions.
- No `recordWatchReason(..., 'dismiss', ...)` path remains; explicit dismiss uses `dismissWatchOccurrence()`.
- No new 14-day rule, 50% rule, two-reconcile rule, competitor option, or threshold modification was introduced by this correction.
- The previous Alert/condition-clear separation remains intact: raw Watch generation is checked before a true `condition_cleared` release is allowed.

## Files changed in this micro-fix

1. `js/intelligence/watch_lifecycle.js`
2. `js/views/customer.js`
3. `js/views/watches.js`

`WATCH_LAST_FIX.diff` contains only these changes relative to the previously delivered corrected ZIP.
