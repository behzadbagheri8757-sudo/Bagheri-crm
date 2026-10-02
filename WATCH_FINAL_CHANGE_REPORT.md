# گزارش نهایی پیاده‌سازی قرارداد Watch — BAGHERI

تاریخ آزمون: 2026-10-01
نسخه مبنا: `BAGHERI-v71-DarkMode-motion-audit-patched(1).zip`
داده آزمون: `baqeri-backup-2026-10-01 2.json`

## حکم اجرا
پیاده‌سازی نهایی قرارداد Watch روی **کپی پروژه** انجام شد. فایل اصلی پروژه و بکاپ اصلی دست‌کاری نشدند.

نتیجهٔ کلی آزمون‌های کدی/داده‌ای: **PASS**.

یک محدودیت باقی است: آزمون UI واقعی Safari روی iPhone و انتخاب فایل از Share Sheet/Files در این محیط اجرا نشد. مسیر کد Backup/Restore و Watch Lifecycle به‌صورت runtime در VM و با بکاپ واقعی آزمون شد.

## فایل‌های تغییرکرده

1. `js/intelligence/watch_lifecycle.js`
2. `js/intelligence/signals.js`
3. `js/intelligence/sku_intelligence.js`
4. `js/views/customer.js`
5. `js/views/watches.js`
6. `js/app.js`
7. `js/backup.js`

هیچ فایل مالی، FIFO، Priority، Action یا threshold/family/unit تغییر نکرده است.

## ۱. تغییرات Watch Lifecycle

### `watch_lifecycle.js`

- `reconcileWatchLifecycle()` اکنون بین سه وضعیت متمایز می‌کند:
  - Watch خام واقعاً دیگر تولید نمی‌شود → `resolution.type = condition_cleared`
  - Watch خام هنوز وجود دارد ولی به‌دلیل Signal تأییدشده از خروجی Watch فیلتر شده → `resolution.type = alert_superseded`
  - Watch خام هنوز وجود دارد و قابل نمایش است → همان occurrence ادامه پیدا می‌کند.
- نبودن Watch در یک اجرای reconcile، وقتی علت آن را نمی‌توان اثبات کرد، دیگر به‌صورت خودکار «حل شد» ثبت نمی‌شود.
- خرید جدید دیگر به‌تنهایی suppression را آزاد نمی‌کند.
- تشدید فقط برای `dismiss` می‌تواند همان occurrence را دوباره فعال کند؛ occurrence جدید ساخته نمی‌شود. `still_stock`، `follow_up_later` و `not_wanted` با صرف تشدید آزاد نمی‌شوند.
- رفع واقعی شرط، برای `dismiss`، `still_stock` و `follow_up_later` چرخه را آزاد می‌کند تا اگر مسئله بعداً واقعاً شکل گرفت، occurrence جدید ساخته شود. `not_wanted` تا لغو صریح باقی می‌ماند.
- occurrence اکنون evidence، source و watchComponents واقعیِ همان محاسبه را نگه می‌دارد؛ برای occurrenceهای قدیمی evidence جعلی ساخته نمی‌شود.
- `follow_up_later` با `getPendingWatchFollowUps()` قابل بازیابی است و تا نتیجه یا لغو صریح باقی می‌ماند.
- `completeWatchFollowUp()` نتیجهٔ صریح را ثبت می‌کند؛ لغو پیگیری از مسیر `reverseWatchDecision()` جداست و هرگز به `not_wanted` تبدیل نمی‌شود.

توابع اصلی بعد از تغییر:
- `reconcileWatchLifecycle()` خط 528
- `_releaseReasonFor()` خط 412
- `_mkOccurrence()` خط 456
- `getPendingWatchFollowUps()` خط 804
- `completeWatchFollowUp()` خط 967
- `restoreWatchLifecycleBundle()` خط 1014

## ۲. Evidence واقعی Watch

### `signals.js`

برای Watchهای حسابی، بدون تغییر شرط تولید، evidence واقعی اضافه شد:

- `PURCHASE_DECLINE_WATCH`: فروش دورهٔ قبل/فعلی و درصد کاهش واقعی.
- `BEHIND_PATTERN_WATCH`: فاصلهٔ فعلی، فاصلهٔ معمول و نسبت آن.
- `BASKET_SHRINK_WATCH`: تعداد فاکتورهای دو نیمه و کالاهای واقعاً دارای افت همراه با earlyQty/lateQty.
- `KEY_PRODUCT_LOST_WATCH`: کالاهای واقعاً حذف‌شده و earlyQty/lateQty.

برای BASKET_SHRINK و KEY_PRODUCT_LOST متن UI از حالت کلی به سؤال قابل استفاده برای گفت‌وگو با مشتری تبدیل شده، ولی threshold و rule تولید دست‌نخورده مانده است.

### `sku_intelligence.js`

Evidence واقعی برای:

- تأخیر: currentGap / typicalCycle
- مقدار: recentQuantity / typicalQuantity
- دفعات: recentFrequency / expectedFrequency
- حضور در سبد: historicalPresenceRate / currentBasketPresence
- Combined SKU: evidence مؤلفه‌های واقعی

اطلاعات مورد نیاز از metricهای موجود استخراج شده‌اند؛ هیچ مقدار جدیدی حدس زده نشده است.

## ۳. UI مشتری و Watch

### `customer.js`

- evidence زیر هر Watch نمایش داده می‌شود.
- BASKET_SHRINK و KEY_PRODUCT_LOST سؤال کاربردی و مشتری‌محور دارند.
- `follow_up_later` در کارت «پیگیری‌های منتظر» برای همان مشتری باقی می‌ماند.
- نتیجهٔ پیگیری و «لغو پیگیری» دو مسیر جدا دارند.

### `watches.js`

- evidence واقعی در لیست و جزئیات Watch نمایش داده می‌شود.
- تبدیل Alert به‌عنوان «رفع مشکل» نمایش داده نمی‌شود؛ lifecycle آن را `alert_superseded` نگه می‌دارد.

### `app.js`

در شروع ویزیت مشتری، follow-upهای pending همان مشتری نمایش داده می‌شوند. ثبت خود ویزیت به‌تنهایی follow-up را نمی‌بندد.

## ۴. بکاپ و سازگاری داده

بکاپ واقعی بررسی‌شده:

| وضعیت | تعداد |
|---|---:|
| کل occurrence | 250 |
| active | 30 |
| resolved | 204 |
| dismissed | 16 |

تفکیک active:

- `BASKET_SHRINK_WATCH`: 11
- `KEY_PRODUCT_LOST_WATCH`: 5
- `SKU_DELAY_WATCH`: 5
- `BEHIND_PATTERN_WATCH`: 1
- `SKU_FREQUENCY_DROP_WATCH`: 4
- `COMBINED_SKU_WATCH`: 2
- `LINE_DROP_WATCH`: 2

هر 16 مورد dismissed در بکاپ اولیه `suppression` نداشتند.

Migration فقط از اطلاعاتی که خود رکورد واقعاً دارد استفاده می‌کند:

- 3 مورد دارای `reason.code = still_stock` → suppression از نوع `still_stock`
- 13 مورد بدون تصمیم صریح قابل استخراج یا با dismiss عمومی → suppression از نوع `dismiss`
- هیچ `not_wanted` یا `follow_up_later` برای 16 رکورد قدیمی جعل نشده است.

`backup.js` اکنون bundle نسخهٔ 1 و 2 را می‌پذیرد. خروجی جدید Watch Lifecycle نسخهٔ 2 است؛ `dbVersion` همان 1 مانده چون store/IndexedDB schema جدیدی ساخته نشده است.

بکاپ قدیمی با 250 occurrence restore شد، migration انجام شد و خروجی جدید با 250 occurrence و version=2 صادر شد.

## ۵. بازتولید چهار بازگشت گزارش‌شده

### شمال مارکت

- `LINE_DROP_WATCH` برای «کشمش پلو ۸ کیلو»: dismiss در 08:28:04؛ occurrence جدید در 09:14:37.
- `LINE_DROP_WATCH` برای «تخمه دورسفید»: dismiss در 08:28:21؛ occurrence جدید در 09:14:37.
- فاصلهٔ بازگشت حدود 46 دقیقه بود.
- بکاپ برای مشتری شمال مارکت invoiceهای واقعی بعدی را نیز دارد؛ از جمله 26 سپتامبر و 29 سپتامبر.

### سوپر سعید

- `SKU_FREQUENCY_DROP_WATCH` برای «لوبیا چیتی»: dismiss در 16:09:25.777؛ occurrence جدید در 16:09:47.931.
- `BASKET_SHRINK_WATCH`: dismiss در 16:09:44.075؛ occurrence جدید در 16:09:47.931.
- فاصلهٔ بازگشت حدود 22.2 و 3.9 ثانیه بود.

هر چهار مورد با fixture استخراج‌شده از occurrence واقعی بازتولید شدند: پس از migration، occurrence dismissed با همان identity دوباره active نشد.

نکتهٔ مهم: occurrenceهای active قدیمی که خودشان در بکاپ تاریخی موجودند عمداً حذف یا جعل نشده‌اند؛ دادهٔ تاریخی حفظ شده است. اصلاح از چرخهٔ بعدی reconcile به بعد اعمال می‌شود.

## ۶. جدول آزمون

| آزمون | نتیجه | شاهد |
|---|---|---|
| reconcile چندباره بدون دادهٔ تازه | PASS | همان occurrence ID حفظ شد |
| refresh/reconcile بدون تغییر تجاری | PASS | occurrence جدید ساخته نشد |
| تشدید همان موضوع | PASS | برای dismiss همان occurrence دوباره فعال شد؛ ID جدید ساخته نشد |
| خرید به‌تنهایی رفع محسوب نشود | PASS | release بر اساس purchase حذف شد |
| still_stock با تشدید آزاد نشود | PASS | suppression باقی ماند |
| follow_up_later بعد از reconcile باقی بماند | PASS | `getPendingWatchFollowUps()` همچنان همان مورد را برگرداند |
| نتیجهٔ follow-up | PASS | `completeWatchFollowUp()` pending را بست |
| لغو follow-up ≠ not_wanted | PASS | `reverseWatchDecision()` suppression را آزاد کرد و code=`not_wanted` نساخت |
| not_wanted محدود به مشتری/خانواده | PASS | مشتری/خانوادهٔ دیگر تحت تأثیر قرار نگرفت |
| Watch → Alert | PASS | `alert_superseded` ثبت شد، نه `condition_cleared` |
| Alert ادامه‌دار duplicate نسازد | PASS | occurrence count ثابت ماند |
| حذف Alert در حالی که raw Watch هنوز هست | PASS | همان occurrence دوباره active شد |
| رفع واقعی شرط | PASS | `condition_cleared` ثبت شد |
| بازگشت پس از رفع | PASS | occurrence جدید با ID جدید ایجاد شد |
| evidence حسابی | PASS | evidence واقعی به BASKET/KEY/PURCHASE/BEHIND اضافه شد |
| evidence SKU | PASS | evidence واقعی برای SKU_DELAY تولید شد |
| raw Watch semantics قبل/بعد signals | PASS | category/level/reason/productId در fixture برابر بود |
| raw Watch semantics قبل/بعد SKU | PASS | category/level/reason/identity در fixture برابر بود |
| restore بکاپ قدیمی | PASS | 250 occurrence restore و migration شد |
| export جدید | PASS | version=2 و 250 occurrence |
| backup bridge | PASS | validator نسخه 1/2 و restore/export bridge اجرا شد |
| syntax همه فایل‌های تغییرکرده | PASS | `node --check` برای 7 فایل |
| UI واقعی Safari/iPhone | اجرا نشده | این محیط Safari واقعی ندارد |
| انتخاب فایل واقعی از Files/Share Sheet | اجرا نشده | به محیط دستگاه وابسته است |

## ۷. محدودیت‌های باقی‌مانده

1. چهار مورد بازگشت تاریخی در خود بکاپ همچنان به‌عنوان occurrenceهای active تاریخی وجود دارند؛ حذف آن‌ها بدون تصمیم صریح دربارهٔ پاکسازی تاریخچه، جعل/تغییر دادهٔ تاریخی محسوب می‌شد. اصلاح جلوی بازتولید جدید را می‌گیرد.
2. evidence برای occurrenceهای قدیمی که در دادهٔ ذخیره‌شده وجود نداشته، retroactively ساخته نشده است. evidence فقط از محاسبهٔ جدید به بعد ثبت می‌شود.
3. تست UI روی Safari/iPhone واقعی اجرا نشده است؛ بنابراین نمایش پیکسلی/تعامل لمسی تأییدشده محسوب نمی‌شود.

## ۸. Diff

فایل کامل diff در همین بسته با نام:

`WATCH_FINAL_DIFF.patch`

قرار داده شده است.

## نتیجه

پیاده‌سازی روی کپی پروژه انجام شده، thresholds/window/family/unit/Alert/Priority/Action دست‌نخورده مانده‌اند، و آزمون‌های runtime مربوط به lifecycle، evidence، migration، Alert supersession، scope و backup bridge PASS شده‌اند.
