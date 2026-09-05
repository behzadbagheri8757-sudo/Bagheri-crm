# Bagheri CRM — Final Deep Audit

Date: 2026-09-05

## Scope

Audited the current freeze candidate across:
- UI changes from the final polish pass
- JavaScript syntax / package integrity
- invoice, payment, customer-balance calculations
- FIFO inventory and stock mutations
- purchase/sale/return/revert paths
- backup validation and restore state coverage
- Intelligence storage boundaries and risk/priority logic
- Service Worker asset coverage

## Verified fixes

- Invoice sticky summary/footer is absent from the current source.
- Visit and Invoice customer pickers are present in the current source and retain direct customer-context paths from Customer Detail.
- Dashboard `.biz-stat-value` and generic `.card .value` have overflow-safe wrapping.
- Blue/Orange theme remains in place; final theme overrides keep primary Blue and use `accent-dark` for the target percentage. Bottom-nav active accent glow is intentionally soft.
- Customer list uses `فوری` rather than `عاجل` and uses a vector warning icon rather than the old warning emoji in the customer-row indicator.
- Customer detail uses `مسئول فروشگاه` rather than `صاحب فروشگاه`.
- Product and invoice dense summaries have dedicated stacked layout classes.
- Stock movement display suppresses the `فاکتور null#` artifact.
- Quick-action icon frames are reduced to a lighter floating treatment.

## Regression checks

- All project JavaScript files pass `node --check`.
- Final ZIP passes `unzip -t`.
- Targeted runtime tests pass for:
  - multi-layer FIFO purchase/sale/revert
  - FIFO COGS allocation
  - customer balance calculation
  - exact FIFO return cost basis / return profit
  - backup reference validation
  - Game Center validation

## Important defect found and corrected in this audit

### Numeric type coercion at the persistence boundary

`normalizeData()` previously preserved numeric-looking strings from imported/legacy JSON. That is unsafe in JavaScript because expressions such as `0 + "1000" + 300` become string concatenation and can corrupt financial totals.

A targeted runtime test reproduced this with string-valued:
- product buy price
- stock quantity
- customer opening balance
- invoice total
- invoice item quantity

The resulting customer balance became `10000300` instead of `1300`.

`normalizeData()` has now been hardened to coerce financial and inventory numeric fields to finite Numbers at the data boundary while preserving existing legacy fallbacks.

After the fix:
- the same imported data produces numeric fields
- customer balance is `1300`
- FIFO purchase/sale/revert tests still pass
- return-profit test still passes

This was a real data-integrity defect, not a cosmetic issue, so the project should not be frozen without this correction.

## Remaining verified warnings

### 1. Visual QA on real iPhone Safari is environment-limited

The supplied source can be statically and headlessly checked, but the execution environment blocks local/file browser navigation. Therefore a real-device Safari render could not be honestly certified here.

The CSS/source checks cover the responsive rules, but final real-device visual confirmation remains recommended.

### 2. Number-style consistency is not literally complete everywhere

The project contains a display-only digit normalizer, but it intentionally skips text nodes containing letters. Therefore mixed Persian/English digits can still occur in some composite strings, for example quantities followed by units and some summary counters.

This is a UI consistency issue, not a financial calculation issue. It should be treated as a final polish item rather than a data-integrity blocker.

### 3. Backup semantic validation remains intentionally conservative

Backup validation checks IDs, references, numeric ranges, dates for several subsystem records, inventory-layer constraints, Intelligence records, ProspectScout records, and Game Center state. It does not attempt to validate every historical CRM field semantically, because an over-aggressive validator could reject legitimate legacy backups.

### 4. Watch Lifecycle backup remains best-effort

Watch Lifecycle is restored additively and its restore failure is currently logged rather than making the entire CRM backup restore fail. This is an architectural warning: if Watch Lifecycle is considered mandatory backup state, its restore should eventually participate in the same journaled semantic transaction as CRM/Prospect/Intelligence/Game/Target.

## Intelligence audit conclusion

The Intelligence modules remain read-only with respect to CRM business data. They use their own storage layers and do not mutate customers, invoices, payments, checks, suppliers, or inventory. Risk scoring observes active risk signals, preserves opportunity signals separately, applies account-vs-SKU dominance, persistence, and feedback modifiers as designed.

## Financial / inventory conclusion

No calculation regression was found in the targeted tests after the numeric-boundary correction. FIFO sale allocation, stock decrement, invoice revert, exact return cost allocation, customer balance, and inventory valuation remain internally consistent for the tested scenarios.

## Freeze recommendation

**NOT YET A CLEAN ZERO-WARNING FREEZE.**

The major newly discovered data-integrity issue has been corrected. The remaining items are:
1. real-device Safari visual confirmation;
2. minor mixed-digit UI consistency;
3. conservative backup validation warning;
4. Watch Lifecycle backup being best-effort.

No evidence was found of a regression in the core Invoice / Payment / Stock / FIFO / Customer Balance / Intelligence logic after the correction.
