/* js/computation-bank.js — execution-scoped derived-data bank.
 *
 * A context is created at the start of a render/reconcile execution and
 * discarded when that execution finishes. It never writes to storage and it
 * never survives a data refresh. The small public surface is intentional:
 * callers pass the context explicitly to pure calculation layers.
 */
'use strict';

var RECEIVABLE_ATTENTION_DEFAULTS = {
  amountFloor: 10000000,
  daysFloor: 10
};

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
      },
      receivableAttention: function (opts) {
        opts = opts || {};
        var amountFloor = Number.isFinite(Number(opts.amountFloor))
          ? Number(opts.amountFloor)
          : RECEIVABLE_ATTENTION_DEFAULTS.amountFloor;
        var daysFloor = Number.isFinite(Number(opts.daysFloor))
          ? Number(opts.daysFloor)
          : RECEIVABLE_ATTENTION_DEFAULTS.daysFloor;
        var memoKey = amountFloor + '|' + daysFloor;

        return memo('receivableAttention', memoKey, function () {
          var out = { count: 0, totalBalance: 0, rows: [], byCustomerId: {} };
          var customers = Array.isArray(source.customers) ? source.customers : [];

          for (var i = 0; i < customers.length; i++) {
            var c = customers[i];
            if (!c || c.active === false) continue;

            var t = null;
            try {
              t = (typeof customerTotals === 'function')
                ? customerTotals(c.id, ctx)
                : null;
            } catch (e) { t = null; }
            if (!t || !(t.balance >= amountFloor)) continue;

            var lastDate = null;
            var refKind = 'payment';

            var pays = ctx.customerPayments(c.id) || [];
            for (var p = 0; p < pays.length; p++) {
              var pay = pays[p];
              if (!pay || !pay.date) continue;
              if (['cash', 'card', 'transfer'].indexOf(pay.method) === -1) continue;
              if (!lastDate || String(pay.date) > String(lastDate)) lastDate = String(pay.date);
            }

            var chks = ctx.customerChecks(c.id) || [];
            for (var k = 0; k < chks.length; k++) {
              var ch = chks[k];
              if (!ch || ch.status !== 'cleared') continue;
              var d = ch.dueDate || ch.date;
              if (!d) continue;
              if (!lastDate || String(d) > String(lastDate)) lastDate = String(d);
            }

            if (!lastDate) {
              refKind = 'no_payment_history';
              var invs = ctx.customerInvoices(c.id) || [];
              for (var v = 0; v < invs.length; v++) {
                var inv = invs[v];
                if (!inv || !inv.date) continue;
                if (!lastDate || String(inv.date) > String(lastDate)) lastDate = String(inv.date);
              }
            }
            if (!lastDate) continue;

            var days = (typeof daysAgo === 'function') ? daysAgo(lastDate) : null;
            if (days == null || !isFinite(days) || days < daysFloor) continue;

            var row = {
              customerId: c.id,
              name: c.name || '—',
              balance: t.balance,
              refDate: lastDate,
              refKind: refKind,
              daysSince: Math.round(days)
            };
            out.rows.push(row);
            out.byCustomerId[c.id] = row;
          }

          out.rows.sort(function (a, b) {
            return b.balance - a.balance
              || b.daysSince - a.daysSince
              || String(a.name).localeCompare(String(b.name), 'fa');
          });
          out.count = out.rows.length;
          out.totalBalance = out.rows.reduce(function (s, r) { return s + r.balance; }, 0);
          return out;
        });
      }
    };

    return ctx;
  }

  global.createComputationContext = createComputationContext;
})(typeof window !== 'undefined' ? window : this);