## Fix: Linked payment overflow FIFO allocation

**Date:** 2026-09-27
**Files changed:** js/calc.js (customerFifoAllocation only)

**Contract change (intentional):**
- Previously: linked payment/check overflow above invoice total was NOT distributed.
- Now: overflow enters FIFO at its own event date, targeting opening balance
  and eligible invoices (date <= event date).

**What did NOT change:**
- customerTotals().balance formula
- invoiceOnRecordPaid() semantics
- return/linkedReturn logic
- inventory/stock FIFO
- profit calculations
- debtAllocations (audit-only)

**New audit fields on customerFifoAllocation():**
- audit.linkedMismatches: invoiceOnRecordPaid vs sum(linked events)
- audit.orphanLinkedEvents: linked events pointing to missing invoices
- allocations[]: per-event detail

**Regression verified on:** 27-customer real backup
