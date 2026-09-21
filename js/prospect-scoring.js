/* prospect-scoring.js — independent shop evaluation scoring (not CRM finance) */
const PROSPECT_APP_VERSION = '1.0';
const PROSPECT_SCORING_VERSION = 1;

const PROSPECT_QUESTIONS = [
  { id:'q1', label:'نوع و اندازه مغازه', weight:10, options:[
    {key:'super_big',     label:'سوپر بزرگ', score:10},
    {key:'resto_active',  label:'رستوران / آشپزخانه پرکار', score:8},
    {key:'super_small',   label:'سوپر کوچک', score:6},
    {key:'nuts_shop',     label:'آجیل و خشکبارفروشی', score:4},
    {key:'other_ok',      label:'سایر — مناسب', score:2},
    {key:'other_bad',     label:'سایر — نامناسب', score:1},
  ]},
  { id:'q2', label:'حجم فعلی فروش حبوبات و خشکبار', weight:18, options:[
    {key:'huge', label:'خیلی زیاد', score:18},
    {key:'high', label:'زیاد', score:14},
    {key:'mid',  label:'متوسط', score:9},
    {key:'low',  label:'کم', score:4},
    {key:'none', label:'تقریباً صفر', score:1},
  ]},
  { id:'q3', label:'وضعیت تأمین‌کننده فعلی', weight:10, options:[
    {key:'none_fixed', label:'تأمین‌کننده ثابت ندارد', score:10},
    {key:'has_fixed',  label:'تأمین‌کننده ثابت دارد', score:3},
  ]},
  { id:'q4', label:'رضایت از تأمین‌کننده فعلی', weight:9, options:[
    {key:'no_supplier',  label:'تأمین‌کننده ثابت ندارد', score:9},
    {key:'very_unhappy', label:'خیلی ناراضی', score:8},
    {key:'unhappy',      label:'ناراضی', score:6},
    {key:'neutral',      label:'بی‌تفاوت', score:4},
    {key:'happy',        label:'راضی', score:2},
    {key:'very_happy',   label:'خیلی راضی', score:1},
  ]},
  { id:'q5', label:'دسترسی به تصمیم‌گیرنده', weight:8, options:[
    {key:'owner_present', label:'صاحب مغازه بود', score:8},
    {key:'manager_full',  label:'مسئول خرید بود', score:6},
    {key:'needs_coord',   label:'نیاز به هماهنگی دارد', score:3},
    {key:'absent',        label:'تصمیم‌گیرنده حضور نداشت', score:1},
  ]},
  { id:'q6', label:'تمایل به امتحان تأمین‌کننده جدید', weight:12, options:[
    {key:'eager',      label:'مشتاق', score:12},
    {key:'interested', label:'علاقه‌مند', score:8},
    {key:'hesitant',   label:'هنوز تردید دارد', score:4},
    {key:'closed',     label:'کاملاً بسته و مخالف', score:0},
  ]},
  { id:'q7', label:'شرایط پرداخت', weight:16, options:[
    {key:'cash_weekly',  label:'نقدی / تسویه هفتگی', score:16},
    {key:'next_invoice', label:'تسویه تا فاکتور بعدی', score:11},
    {key:'d15_30',       label:'چک یا تسویه ۱۵ تا ۳۰ روزه', score:6},
    {key:'long_or_bad',  label:'چک/طلب بالای ۳۰ روز یا مشکل‌دار', score:1},
  ]},
  { id:'q8', label:'فضای نمایش و نگهداری کالا', weight:6, options:[
    {key:'dedicated', label:'فضای اختصاصی حبوبات و خشکبار', score:6},
    {key:'partial',   label:'فقط برای حبوبات یا خشکبار جا دارد', score:4},
    {key:'mid_low',   label:'فضای متوسط یا کم', score:2},
    {key:'none',      label:'فضای مناسب برای این کالاها ندارد', score:0},
  ]},
  { id:'q9', label:'موقعیت مکانی و ترافیک مشتری', weight:6, options:[
    {key:'main',   label:'خیابان اصلی / کنار جاده', score:6},
    {key:'dense',  label:'داخل محله پرجمعیت / پرمصرف', score:4},
    {key:'normal', label:'محله یا موقعیت معمولی', score:2},
    {key:'quiet',  label:'جای خلوت', score:1},
  ]},
  { id:'q10', label:'احتمال سفارش تکراری', weight:5, options:[
    {key:'very_high', label:'بسیار بالا', score:5},
    {key:'high',      label:'بالا', score:3},
    {key:'mid_low',   label:'متوسط / پایین', score:1},
    {key:'unknown',   label:'نامشخص', score:0},
  ]},
];

const PROSPECT_VISIT_TAGS = [
  {key:'price_list',      label:'اطلاعات گرفت — لیست قیمت / شماره'},
  {key:'sample',          label:'گفت سربزن'},
  {key:'owner_absent',    label:'تصمیم‌گیرنده نبود'},
  {key:'rejected',        label:'رد کرد'},
  {key:'became_customer', label:'خرید کرد'},
];

const PROSPECT_RANK_INFO = {
  'A+': {color:'#0F7A4A', desc:'اولویت مطلق – ویزیت فوری و پیگیری سنگین'},
  'A':  {color:'#2E9A5C', desc:'اولویت بالا – پیگیری جدی در ۷ روز آینده'},
  'B':  {color:'#3B7DD8', desc:'متوسط رو به بالا – پیگیری عادی'},
  'C':  {color:'#D98A22', desc:'اولویت پایین – فقط در صورت آزاد بودن زمان'},
  'D':  {color:'#C64B4B', desc:'فعلاً ارزش پیگیری ندارد'},
};

function prospectScoreToRank(score){
  if(score>=90) return 'A+';
  if(score>=75) return 'A';
  if(score>=55) return 'B';
  if(score>=35) return 'C';
  return 'D';
}
function prospectComputeScore(answers){
  let total=0;
  PROSPECT_QUESTIONS.forEach(q=>{
    const opt = q.options.find(o=>o.key===answers[q.id]);
    if(opt) total += opt.score;
  });
  return total;
}
function prospectAnsweredCount(answers){
  return PROSPECT_QUESTIONS.filter(q=>answers[q.id]).length;
}
function prospectNowISO(){ return new Date().toISOString(); }
function prospectTodayStr(){
  const d = new Date();
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}
function prospectFaDate(iso){
  try{ return new Date(iso).toLocaleDateString('fa-IR'); }catch(e){ return (iso||'').slice(0,10); }
}
function prospectFaDateTime(iso){
  try{
    const d = new Date(iso);
    return d.toLocaleDateString('fa-IR')+' '+d.toLocaleTimeString('fa-IR',{hour:'2-digit',minute:'2-digit'});
  }catch(e){ return iso||''; }
}

/* ==========================================================================
   PROSPECT EVALUATION V2 — profile-aware snapshot scoring model.
   Independent of the legacy 10-question model above (PROSPECT_QUESTIONS,
   prospectComputeScore, prospectScoreToRank). Legacy data/functions are left
   untouched for backward compatibility; do not mix the two models.
   ========================================================================== */
const PROSPECT_SCORING_VERSION_V2 = 2;

const PROSPECT_PROFILES = [
  { key: 'retail', label: 'مواد غذایی' },
  { key: 'foodservice', label: 'رستوران / کافه / آشپزخانه' },
];

const PROSPECT_BUSINESS_TYPES = {
  retail: [
    { key: 'supermarket', label: 'سوپرمارکت' },
    { key: 'hypermarket', label: 'هایپرمارکت / فروشگاه بزرگ' },
    { key: 'nuts_shop', label: 'آجیل و خشکبارفروشی' },
    { key: 'grocery', label: 'بقالی / خواربارفروشی' },
    { key: 'other', label: 'سایر' },
  ],
  foodservice: [
    { key: 'restaurant', label: 'رستوران' },
    { key: 'kitchen', label: 'آشپزخانه' },
    { key: 'catering', label: 'کیترینگ' },
    { key: 'cafe', label: 'کافه / صبحانه‌سرا' },
    { key: 'other', label: 'سایر' },
  ],
};

// Shared building blocks reused by both profiles (Q3 / Q4-style options are
// scored identically across profiles per spec; Q4 point values differ by
// weight so are not shared).
function _pv2UnknownOption() {
  return { key: 'unknown', label: 'اطلاعات کافی ندارم', score: 0, unknown: true };
}
function _pv2VolumeOptions() {
  return [
    { key: 'very_high', label: 'خیلی زیاد', score: 30 },
    { key: 'high', label: 'زیاد', score: 22 },
    { key: 'mid', label: 'متوسط', score: 15 },
    { key: 'low', label: 'کم', score: 7 },
    { key: 'almost_zero', label: 'تقریباً صفر', score: 0 },
    _pv2UnknownOption(),
  ];
}
function _pv2SupplierSwitchOptions() {
  return [
    { key: 'no_supplier', label: 'تأمین‌کننده ثابت ندارد / فعالانه دنبال است', score: 25 },
    { key: 'unhappy_ready', label: 'ناراضی و آماده تعویض', score: 21 },
    { key: 'somewhat_unhappy', label: 'نسبتاً ناراضی / قابل مذاکره', score: 15 },
    { key: 'happy_but_willing', label: 'راضی ولی حاضر به امتحان', score: 8 },
    { key: 'fully_satisfied', label: 'کاملاً راضی / بدون قصد تعویض', score: 0 },
    _pv2UnknownOption(),
  ];
}

const PROSPECT_QUESTIONS_V2 = {
  retail: [
    {
      id: 'q1', weight: 30,
      label: 'پتانسیل فروش حبوبات و خشکبار',
      shortLabel: 'پتانسیل فروش',
      hint: 'پتانسیل دسته حبوبات و خشکبار مشخصاً — نه شلوغی کلی مغازه.',
      options: _pv2VolumeOptions(),
    },
    {
      id: 'q2', weight: 25,
      label: 'ظرفیت واقعی مغازه',
      shortLabel: 'ظرفیت مغازه',
      hint: 'ظرفیت مفید برای محصولات باقری، نه متراژ کلی مغازه.',
      options: [
        { key: 'large_suitable', label: 'بزرگ و کاملاً مناسب', score: 25 },
        { key: 'mid_suitable', label: 'متوسط و مناسب', score: 19 },
        { key: 'small_usable', label: 'کوچک ولی قابل استفاده', score: 12 },
        { key: 'very_small', label: 'خیلی کوچک / محدود', score: 5 },
        { key: 'unsuitable', label: 'نامناسب برای محصولات باقری', score: 0 },
        _pv2UnknownOption(),
      ],
    },
    {
      id: 'q3', weight: 25,
      label: 'فرصت تعویض تأمین‌کننده',
      shortLabel: 'فرصت تعویض تأمین‌کننده',
      options: _pv2SupplierSwitchOptions(),
    },
    {
      id: 'q4', weight: 20,
      label: 'دسترسی به تصمیم‌گیرنده',
      shortLabel: 'دسترسی به تصمیم‌گیرنده',
      options: [
        { key: 'present_negotiable', label: 'حضور دارد و قابل مذاکره است', score: 20 },
        { key: 'accessible_coord', label: 'قابل دسترسی ولی نیاز به هماهنگی دارد', score: 15 },
        { key: 'hard_unclear', label: 'دسترسی سخت / نامشخص', score: 8 },
        { key: 'unavailable', label: 'فعلاً در دسترس نیست', score: 3 },
        { key: 'unknown_person', label: 'تصمیم‌گیرنده مشخص نیست', score: 0 },
        _pv2UnknownOption(),
      ],
    },
  ],
  foodservice: [
    {
      id: 'q1', weight: 30,
      label: 'پتانسیل فروش حبوبات و خشکبار',
      shortLabel: 'پتانسیل فروش',
      hint: 'پتانسیل دسته حبوبات و خشکبار مشخصاً — نه شلوغی کلی کسب‌وکار.',
      options: _pv2VolumeOptions(),
    },
    {
      id: 'q2', weight: 30,
      label: 'انطباق محصولات باقری',
      shortLabel: 'انطباق محصولات',
      hint: 'آیا سبد محصولات باقری واقعاً با نیاز خرید این کسب‌وکار جور است؟',
      options: [
        { key: 'excellent_fit', label: 'انطباق کامل با نیاز خرید', score: 30 },
        { key: 'strong_fit', label: 'انطباق زیاد', score: 22 },
        { key: 'partial_fit', label: 'انطباق نسبی', score: 14 },
        { key: 'weak_fit', label: 'انطباق کم', score: 6 },
        { key: 'no_fit', label: 'اصلاً منطبق نیست', score: 0 },
        _pv2UnknownOption(),
      ],
    },
    {
      id: 'q3', weight: 25,
      label: 'فرصت تعویض تأمین‌کننده',
      shortLabel: 'فرصت تعویض تأمین‌کننده',
      options: _pv2SupplierSwitchOptions(),
    },
    {
      id: 'q4', weight: 15,
      label: 'دسترسی به تصمیم‌گیرنده',
      shortLabel: 'دسترسی به تصمیم‌گیرنده',
      options: [
        { key: 'present_negotiable', label: 'حضور دارد و قابل مذاکره است', score: 15 },
        { key: 'accessible_coord', label: 'قابل دسترسی ولی نیاز به هماهنگی دارد', score: 11 },
        { key: 'hard_unclear', label: 'دسترسی سخت / نامشخص', score: 6 },
        { key: 'unavailable', label: 'فعلاً در دسترس نیست', score: 2 },
        { key: 'unknown_person', label: 'تصمیم‌گیرنده مشخص نیست', score: 0 },
        _pv2UnknownOption(),
      ],
    },
  ],
};

// Same rank bands as the legacy model for visual/semantic consistency, but
// this function must ONLY be called once the caller has already verified
// knownCount >= 3. It never gets called as a fallback for incomplete
// prospects (see prospectComputeScoreV2 — rank stays null otherwise).
function prospectScoreToRankV2(score) {
  if (score >= 90) return 'A+';
  if (score >= 75) return 'A';
  if (score >= 55) return 'B';
  if (score >= 35) return 'C';
  return 'D';
}

/**
 * Compute the normalized V2 snapshot score for a profile + answers map.
 * "Unknown" (or a missing answer) is excluded from both numerator and
 * denominator — it is not a negative answer, it's absence of data.
 * Returns { score, rank, knownCount, totalQuestions }.
 * score/rank are null when nothing is known yet.
 * rank additionally requires knownCount >= 3 (spec: minimum 3/4 known
 * for a rank; 2 or fewer known = Incomplete, rank MUST stay null).
 */
function prospectComputeScoreV2(profile, answers) {
  const questions = PROSPECT_QUESTIONS_V2[profile];
  const safeAnswers = answers && typeof answers === 'object' ? answers : {};
  if (!questions) return { score: null, rank: null, knownCount: 0, totalQuestions: 0 };

  let knownWeightedScore = 0;
  let knownWeight = 0;
  let knownCount = 0;

  questions.forEach(function (q) {
    const answerKey = safeAnswers[q.id];
    if (answerKey == null) return; // unanswered — excluded
    const opt = q.options.find(function (o) { return o.key === answerKey; });
    if (!opt || opt.unknown) return; // Unknown — excluded, no penalty
    knownWeightedScore += opt.score;
    knownWeight += q.weight;
    knownCount += 1;
  });

  let score = null;
  if (knownWeight > 0) {
    score = Math.round((knownWeightedScore / knownWeight) * 100);
  }
  let rank = null;
  if (knownCount >= 3 && score != null) {
    rank = prospectScoreToRankV2(score);
  }
  return { score: score, rank: rank, knownCount: knownCount, totalQuestions: questions.length };
}

const PROSPECT_FOLLOWUP_OUTCOMES = [
  { key: 'followed_up', label: 'پیگیری شد' },
  { key: 'more_interested', label: 'علاقه‌مندتر شد' },
  { key: 'still_hesitant', label: 'هنوز مردد' },
  { key: 'price_blocker', label: 'مانع قیمت' },
  { key: 'has_stock', label: 'موجودی دارد' },
  { key: 'buys_competitor', label: 'از رقیب خرید می‌کند' },
  { key: 'not_now', label: 'فعلاً نمی‌خواهد' },
  { key: 'ready_to_buy', label: 'آماده خرید' },
  { key: 'decision_maker_absent', label: 'تصمیم‌گیرنده نبود' },
  { key: 'other', label: 'سایر' },
];

/**
 * Shared rank-badge markup used by both the Prospects list and Prospect
 * detail views (also safe for V1/legacy ranks, which are never null).
 * An incomplete V2 prospect (rank === null) MUST NOT render as "D" — it
 * renders a distinct, visually calm "ناقص" (incomplete) badge instead.
 */
function prospectRankBadgeHTML(rank) {
  if (!rank) {
    return '<span class="rank-pill rank-pill-incomplete">ناقص</span>';
  }
  const safeRank = String(rank).replace(/[^A-Z+\-]/g, '') || 'D';
  return '<span class="rank-pill rank-pill-' + safeRank + '">' + safeRank + '</span>';
}
