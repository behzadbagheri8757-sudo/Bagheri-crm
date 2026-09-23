/* js/computation-bank.js — execution-scoped derived-data bank.
 *
 * A context is created at the start of a render/reconcile execution and
 * discarded when that execution finishes. It never writes to storage and it
 * never survives a data refresh. The small public surface is intentional:
 * callers pass the context explicitly to pure calculation layers.
 */
'use strict';

(function (global) {
  function createComputationContext(options) {
    options = options || {};
    var source = options.data || global.data || {};
    var values = Object.create(null);

    function memo(bucket, key, producer) {
      var group = values[bucket];
      if (!group) group = values[bucket] = Object.create(null);
      var normalized = String(key == null ? '__default__' : key);
      if (Object.prototype.hasOwnProperty.call(group, normalized)) return group[normalized];
      var value = producer();
      group[normalized] = value;
      return value;
    }

    var ctx = {
      data: source,
      values: values,
      memo: memo,
      aggregatePairMapCache: Object.create(null),

      customerInvoices: function (cid) {
        return memo('customerInvoices', cid, function () {
          return (source.invoices || []).filter(function (row) {
            return row && row.customerId === cid;
          });
        });
      },
      customerPayments: function (cid) {
        return memo('customerPayments', cid, function () {
          return (source.payments || []).filter(function (row) {
            return row && row.customerId === cid;
          });
        });
      },
      customerChecks: function (cid) {
        return memo('customerChecks', cid, function () {
          return (source.checks || []).filter(function (row) {
            return row && row.customerId === cid;
          });
        });
      },
      customerById: function (cid) {
        return memo('customerById', cid, function () {
          return (source.customers || []).find(function (row) {
            return row && row.id === cid;
          }) || null;
        });
      },
      productById: function (pid) {
        return memo('productById', pid, function () {
          return (source.products || []).find(function (row) {
            return row && row.id === pid;
          }) || null;
        });
      }
    };

    return ctx;
  }

  global.createComputationContext = createComputationContext;
})(typeof window !== 'undefined' ? window : this);