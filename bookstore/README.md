# متجر الكتب الإلكترونية (PDF) — دفع عبر Paymob

موقع عربي لبيع ٤ كتب PDF، فيه:

- صفحة رئيسية بتعرض الكتب. لما الزائر يضغط على كتاب بتظهر نبذة تشويقية واقتباس وأهم النقاط.
- **بندل** (المجموعة الكاملة) بسعر خاص. لو حد ضاف البندل، الكتب المفردة اللي جواه بتتشال من السلة تلقائيًا.
- **أكواد خصم**: نسبة مئوية (مثلًا 50%)، أو مبلغ ثابت، أو 100% يعني مجانًا من غير ما يروح لبوابة الدفع.
- **الدفع عن طريق Paymob**: كروت، ومحافظ زي فودافون كاش، وغيرها حسب الـ integrations المفعّلة عندك.
- **زر التحميل بيفضل معطّل** لحد ما Paymob تأكد الدفع، والتأكيد ده بيتحقق منه بتوقيع HMAC. بعد التأكيد الزر بيتفعّل تلقائيًا.
- ملفات الـ PDF محمية: مش متاحة للزوار أصلًا. التحميل بيتم برابط سري خاص بكل طلب، ومعاه حد أقصى لعدد مرات التحميل.
- لوحة مبيعات بسيطة على `/admin`.

## التشغيل محليًا (للتجربة)

```bash
cd bookstore
npm install
cp .env.example .env        # PAYMENT_PROVIDER=mock = بوابة دفع وهمية للتجربة
npm run sample-pdfs         # ملفات PDF تجريبية (لو لسه ما حطيتش كتبك)
npm start                   # http://localhost:3000
npm test                    # الاختبارات
```

## تجهيز المحتوى

| ماذا | أين |
|---|---|
| عناوين الكتب، الأسعار، النبذة، الاقتباس، النقاط، لون الغلاف | `data/catalog.json` |
| صورة غلاف حقيقية | ضع الصورة في `public/covers/` واكتب `"cover": "/covers/book1.jpg"` |
| ملفات الـ PDF | `private/books/book1.pdf` … `book4.pdf` **(على السيرفر فقط، لا ترفعها على GitHub)** |
| أكواد الخصم | `data/promos.json` |

أي تعديل في ملفات `data/` بيشتغل فورًا من غير ما تعيد تشغيل السيرفر.

### أكواد الخصم (`data/promos.json`)

```json
{ "code": "HALF50",  "type": "percent", "value": 50,  "appliesTo": "all", "maxUses": null, "expiresAt": null, "active": true }
{ "code": "GIFT100", "type": "percent", "value": 100, "appliesTo": "all", "maxUses": 10,   "expiresAt": null, "active": true }
{ "code": "SAVE100", "type": "fixed",   "value": 100, "appliesTo": ["bundle-all"], "maxUses": null, "expiresAt": "2027-12-31T23:59:59Z", "active": true }
```

- `appliesTo`: إما `"all"` أو قائمة بمنتجات معينة (مثلًا `["book1", "bundle-all"]`).
- `maxUses`: عدد مرات الاستخدام، وبيتحسب بس على الطلبات اللي اتدفعت فعلًا.

## ربط Paymob (للتشغيل الحقيقي)

1. افتح حساب على [Paymob](https://accept.paymob.com) وفعّل طرق الدفع اللي عايزها (Card، Mobile Wallet…).
2. من لوحة التحكم انسخ: **Secret Key** و **Public Key** و **HMAC Secret**، وأرقام الـ **Integration IDs**.
3. في `.env` على السيرفر:
   ```
   NODE_ENV=production
   PAYMENT_PROVIDER=paymob
   BASE_URL=https://your-domain.com
   PAYMOB_SECRET_KEY=...
   PAYMOB_PUBLIC_KEY=...
   PAYMOB_HMAC_SECRET=...
   PAYMOB_INTEGRATION_IDS=1234567,7654321
   ADMIN_PASSWORD=كلمة-سر-طويلة
   ```
4. في إعدادات كل Integration في Paymob، اضبط:
   - **Transaction processed callback**: `https://your-domain.com/api/paymob/callback`
   - **Transaction response callback**: `https://your-domain.com/api/paymob/return`

   (الموقع كمان بيبعت الرابطين دول مع كل عملية دفع.)
5. جرّب الأول بمفاتيح **Test mode** وكروت الاختبار بتاعة Paymob، وبعدها حوّل للمفاتيح الحقيقية.

## الاستضافة

الموقع محتاج سيرفر Node.js (يعني GitHub Pages مش هتنفع). أي خدمة من دول مناسبة: Render، Railway، Fly.io، أو VPS.
المهم:
- ارفع ملفات الـ PDF على السيرفر نفسه في `private/books/`، أو حدد مكانها بـ `BOOKS_DIR`.
- الطلبات بتتحفظ في `data/db.json`. لازم المكان ده يكون على **قرص دائم** (persistent disk)، أو تحدد مكانه بـ `DB_PATH`.

## كيف يعمل الأمان

- السعر بيتحسب على السيرفر بس. المتصفح مش بيحدد السعر.
- الطلب مش بيتعلّم "مدفوع" غير بعد ما توقيع HMAC من Paymob يتأكد، **وكمان** المبلغ المدفوع يطابق قيمة الطلب.
- كل طلب ليه رابط سري عشوائي، ومن غيره محدش يقدر يشوف الطلب أو يحمّل منه.
- الحد الأقصى للتحميل لكل كتاب بيتظبط من `MAX_DOWNLOADS_PER_BOOK` (الافتراضي 10).
