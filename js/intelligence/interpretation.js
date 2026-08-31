/* js/intelligence/interpretation.js — Customer Story (P-08)
   ============================================================
   Builds a short Persian customer-level story from existing
   Intelligence outputs (signals / risk / priority).

   Does NOT change Risk, Priority formula, Action type, or urgency.
   Does NOT invent signals or CRM data.

   Public API:
     buildCustomerStory(customerId) -> { customerId, summary, themes? }
   ============================================================ */
'use strict';

(function (global) {

  var SEV_RANK = { critical: 4, high: 3, medium: 2, low: 1 };

  function _sevRank(s) {
    if (!s) return 0;
    var r = SEV_RANK[s.severity];
    if (r) return r;
    if (typeof s.severityPoints === 'number' && isFinite(s.severityPoints)) {
      if (s.severityPoints >= 80) return 4;
      if (s.severityPoints >= 50) return 3;
      if (s.severityPoints >= 25) return 2;
      return 1;
    }
    return 0;
  }

  function _pickStrongest(list) {
    if (!list || !list.length) return null;
    var best = list[0];
    for (var i = 1; i < list.length; i++) {
      if (_sevRank(list[i]) > _sevRank(best)) best = list[i];
    }
    return best;
  }

  function _shortLabel(signal) {
    if (!signal) return '';
    var cat = signal.category || '';
    var name = signal.productName ? (' «' + signal.productName + '»') : '';
    switch (cat) {
      case 'PURCHASE_DECLINE_SEVERE':
      case 'PURCHASE_DECLINE_MILD':
        return 'کاهش خرید';
      case 'BEHIND_PATTERN':
        return 'عقب‌ماندگی از الگوی خرید';
      case 'CHECK_BOUNCED':
        return 'چک برگشتی';
      case 'PAYMENT_OVERDUE':
        return 'پرداخت معوق';
      case 'VISIT_OVERDUE':
      case 'LONG_NO_VISIT':
        return 'تأخیر در ویزیت';
      case 'SKU_DELAY':
        return 'تأخیر خرید SKU' + name;
      case 'SKU_QUANTITY_DROP':
        return 'کاهش مقدار SKU' + name;
      case 'SKU_FREQUENCY_DROP':
        return 'کاهش تناوب SKU' + name;
      case 'LINE_DROP':
        return 'حذف خط محصول' + name;
      case 'MULTI_SKU_DECLINE':
      case 'COMBINED_SKU_DETERIORATION':
        return 'تضعیف چند SKU';
      case 'KEY_PRODUCT_LOST':
        return 'از دست رفتن محصول کلیدی';
      case 'BASKET_SHRINK':
        return 'کوچک شدن سبد';
      case 'PURCHASE_GROWTH':
        return 'رشد خرید';
      case 'NEW_PRODUCT_ADOPTION':
        return 'پذیرش محصول جدید';
      case 'REACTIVATION_CANDIDATE':
        return 'فرصت فعال‌سازی مجدد';
      default:
        if (signal.reason) return String(signal.reason).slice(0, 40);
        return cat || 'سیگنال';
    }
  }

  function _isActive(s) {
    // P-02: pending should not drive the story as if confirmed
    if (s && s.status === 'pending') return false;
    return true;
  }

  /**
   * Build a short customer story from existing Intelligence outputs.
   * @returns {{ customerId: string, summary: string, themes: object }}
   */
  function buildCustomerStory(customerId) {
    var empty = { customerId: customerId, summary: '', themes: { risk: null, opportunity: null, observation: null } };
    if (!customerId) return empty;

    var signals = [];
    try {
      if (typeof extractCustomerSignals === 'function') {
        signals = extractCustomerSignals(customerId) || [];
      }
    } catch (e) {
      signals = [];
    }

    // Prefer priority signals if already computed upstream (same set, avoid double work)
    // Still use extractCustomerSignals as source of truth when available.

    var risks = [];
    var opportunities = [];
    var observations = [];

    for (var i = 0; i < signals.length; i++) {
      var s = signals[i];
      if (!s) continue;
      if (!_isActive(s)) continue;
      if (s.seasonallySuppressed) continue; // P-06: do not narrate false seasonal declines
      if (s.type === 'risk') risks.push(s);
      else if (s.type === 'opportunity') opportunities.push(s);
      else observations.push(s);
    }

    var topRisk = _pickStrongest(risks);
    var topOpp = _pickStrongest(opportunities);
    var topObs = _pickStrongest(observations);

    var themes = {
      risk: topRisk ? _shortLabel(topRisk) : null,
      opportunity: topOpp ? _shortLabel(topOpp) : null,
      observation: topObs ? _shortLabel(topObs) : null
    };

    if (!topRisk && !topOpp && !topObs) {
      return { customerId: customerId, summary: '', themes: themes };
    }

    // Max 2 Persian sentences, conservative tone
    var sentences = [];

    if (topRisk) {
      var riskBit = themes.risk;
      if (risks.length > 1) {
        sentences.push(riskBit + ' مشاهده شده و چند سیگنال ریسک هم‌زمان وجود دارد.');
      } else {
        sentences.push(riskBit + ' مشاهده شده است.');
      }
    }

    if (topOpp && sentences.length < 2) {
      sentences.push('فرصت «' + themes.opportunity + '» برای پیگیری وجود دارد.');
    } else if (!topRisk && topObs && sentences.length < 2) {
      sentences.push(themes.observation + ' ثبت شده است.');
    }

    // Cap hard at 2 sentences
    if (sentences.length > 2) sentences = sentences.slice(0, 2);

    return {
      customerId: customerId,
      summary: sentences.join(' '),
      themes: themes
    };
  }

  global.buildCustomerStory = buildCustomerStory;

})(typeof window !== 'undefined' ? window : this);
