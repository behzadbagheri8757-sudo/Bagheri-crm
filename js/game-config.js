/**
 * Sales Game Center — V1 Configuration
 * ------------------------------------
 * تمام وزن‌ها، آستانه‌ها و قوانین بازی در این فایل متمرکز هستند.
 * منطق game-logic نباید اعداد را hard-code کند؛ فقط از این config بخواند.
 *
 * CRM = Source of Truth
 * Game = Derived Behavior Layer
 *
 * هیچ منطق مالی / FIFO / موجودی / پرداخت در این فایل وجود ندارد.
 */
(function (global) {
  'use strict';

  const GAME_CONFIG = {
    /** نسخه schema تنظیمات (برای migration آینده) */
    version: 1,

    // ------------------------------------------------------------------
    // XP weights (اعداد کوچک و قابل تنظیم)
    // ------------------------------------------------------------------
    xp: {
      evaluation: 1,              // هر visit ارزیابی Prospect
      customerVisit: 2,           // ویزیت مشتری موجود
      qualifiedConversion: 10,    // تبدیل Prospect → Customer با حداقل ۲ فاکتور
      invoice: 10,                // ایجاد فاکتور جدید (نه ویرایش)
      payment: 12,                // پرداخت واقعی (cash / card / transfer)

      dailyQuestEach: 5,          // تکمیل هر Daily Quest
      dailyQuestAllBonus: 10,     // تکمیل هر ۳ Quest در یک روز

      /** پایه Active Day + بونوس تداوم */
      continuityBase: 2,
      /**
       * بونوس تداوم: برای streak روزهای Active متوالی (بدون احتساب جمعه)
       * فرمول پیشنهادی در logic: base + min(streak, maxStreakBonusDays) * perDay
       */
      continuityPerStreakDay: 1,
      continuityMaxStreakBonusDays: 7,  // سقف بونوس تداوم (انفجار XP جلوگیری)

      monthlySalesTarget: 25      // یک‌بار در هر ماه پس از رسیدن به Target
    },

    // ------------------------------------------------------------------
    // Daily Quests (ثابت V1 — حداکثر ۳)
    // progress از داده واقعی CRM/Prospect مشتق می‌شود
    // ------------------------------------------------------------------
    dailyQuests: [
      {
        id: 'evaluation',
        label: 'ارزیابی',
        type: 'evaluation',
        target: 15,   // minimum / fallback
        min: 15,
        max: 25
      },
      {
        id: 'customerVisit',
        label: 'ویزیت مشتری',
        type: 'customerVisit',
        target: 5,
        min: 5,
        max: 10
      },
      {
        id: 'sales',
        label: 'فروش',
        type: 'invoice',
        target: 3,
        min: 3,
        max: 7
      }
    ],

    // ------------------------------------------------------------------
    // Continuity / Active Day
    // ------------------------------------------------------------------
    continuity: {
      /** حداقل تعداد فعالیت معتبر برای Active Day */
      minValidActivities: 5,

      /**
       * انواع فعالیت معتبر برای Active Day
       * (با typeهای ledger هماهنگ باشند)
       */
      validActivityTypes: [
        'evaluation',
        'customerVisit',
        'invoice',
        'payment'
      ],

      /**
       * جمعه = روز استراحت
       * در محاسبه شکستن streak لحاظ نشود (نه اجباری Active، نه Break)
       * 5 = Friday در getDay() استاندارد JS (0=Sun ... 6=Sat)
       */
      restWeekday: 5
    },

    // ------------------------------------------------------------------
    // Conversion
    // ------------------------------------------------------------------
    conversion: {
      /** حداقل تعداد فاکتور واقعی برای واجد شرایط بودن Conversion XP */
      minInvoicesForReward: 2
    },

    // ------------------------------------------------------------------
    // Payment
    // ------------------------------------------------------------------
    payment: {
      /** فقط این methodها XP مثبت می‌گیرند */
      rewardMethods: ['cash', 'card', 'transfer']
      // return / discount → بدون XP مثبت
    },

    // ------------------------------------------------------------------
    // Ledger key prefixes (برای idempotency)
    // ------------------------------------------------------------------
    ledgerKeys: {
      evaluation: 'eval',
      customerVisit: 'visit',
      invoice: 'invoice',
      payment: 'payment',
      conversion: 'conversion',
      dailyQuest: 'dailyQuest',
      dailyAll: 'dailyAll',
      continuity: 'continuity',
      monthlyTarget: 'monthlyTarget'
    },

    // ------------------------------------------------------------------
    // Storage keys (داخل baqeriDB / appdata — جدا از data مالی)
    // ------------------------------------------------------------------
    storage: {
      metaKey: 'gameMeta',
      ledgerKey: 'gameLedger'
    },

    // ------------------------------------------------------------------
    // UI / Route (مرجع؛ منطق view جداست)
    // ------------------------------------------------------------------
    route: '/game',
    navLabel: 'مرکز بازی فروش'
  };

  // Freeze shallow برای جلوگیری از تغییر تصادفی در runtime
  Object.freeze(GAME_CONFIG.xp);
  Object.freeze(GAME_CONFIG.dailyQuests);
  Object.freeze(GAME_CONFIG.continuity);
  Object.freeze(GAME_CONFIG.conversion);
  Object.freeze(GAME_CONFIG.payment);
  Object.freeze(GAME_CONFIG.ledgerKeys);
  Object.freeze(GAME_CONFIG.storage);
  Object.freeze(GAME_CONFIG);

  global.GAME_CONFIG = GAME_CONFIG;
})(typeof window !== 'undefined' ? window : globalThis);
