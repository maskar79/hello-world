# متجر الكتب الإلكترونية (PDF) — دفع عبر Paymob

موقع عربي لبيع ٤ كتب PDF، فيه:

- صفحة رئيسية بتعرض الكتب. لما الزائر يضغط على كتاب بتظهر نبذة تشويقية واقتباس وأهم النقاط.
- **بندل** (المجموعة الكاملة) بسعر خاص. لو حد ضاف البندل، الكتب المفردة اللي جواه بتتشال من السلة تلقائيًا.
- **أكواد خصم**: نسبة مئوية (مثلًا 50%)، أو مبلغ ثابت، أو 100% يعني مجانًا من غير ما يروح لبوابة الدفع.
- **الدفع عن طريق Paymob**: كروت، ومحافظ زي فودافون كاش، وغيرها حسب الـ integrations المفعّلة عندك.
- **زر التحميل بيفضل معطّل** لحد ما Paymob تأكد الدفع، والتأكيد ده بيتحقق منه بتوقيع HMAC. بعد التأكيد الزر بيتفعّل تلقائيًا.
- ملفات الـ PDF محمية: مش متاحة للزوار أصلًا. التحميل بيتم برابط سري خاص بكل طلب، ومعاه حد أقصى لعدد مرات التحميل.
- لوحة إدارة على `/admin`: رفع ملفات الكتب، ومتابعة المبيعات.

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
| ملفات الـ PDF | من صفحة `/admin` على الموقع، أو محليًا في `private/books/` **(لا ترفعها على GitHub)** |
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

## الرفع على Render

ملف `render.yaml` الموجود في جذر الريبو بيجهّز كل حاجة لوحده: السيرفر، وقرص دائم للطلبات والكتب، والإعدادات.

1. اعمل حساب على [render.com](https://render.com) وادخل بحساب GitHub.
2. **New → Blueprint** → اختار الريبو `hello-world` والفرع اللي فيه الكود → **Apply**.
3. Render هيطلب منك القيم دي:
   - `ADMIN_PASSWORD`: كلمة سر طويلة للوحة الإدارة.
   - مفاتيح Paymob الأربعة. **لو لسه ما عندكش حساب Paymob سيبهم فاضيين**: الموقع هيشتغل عادي، وزرار الدفع هيقول إن الدفع مش متاح لحد ما تضيفهم.
4. استنى لحد ما الـ Deploy يخلص. هيظهر لك رابط زي `https://author-bookstore.onrender.com`.
5. افتح `https://<الرابط>/admin` → ادخل بكلمة السر → **ارفع ملفات الـ PDF الأربعة** من هناك.
6. لما مفاتيح Paymob تبقى جاهزة: Render → الخدمة → **Environment** → حطها → Save (الموقع بيعيد التشغيل لوحده).
   وفي Paymob اضبط الـ callbacks على رابط Render:
   `https://<الرابط>/api/paymob/callback` و `https://<الرابط>/api/paymob/return`.
7. (اختياري) دومين خاص بيك: Render → **Settings → Custom Domains**. بعد ما تضيفه، حط `BASE_URL=https://your-domain.com` في Environment، وعدّل الـ callbacks في Paymob.

**ملاحظة عن التكلفة:** الخطة المجانية في Render مش بتدعم الأقراص الدائمة، وكل الطلبات والكتب المرفوعة بتتمسح مع كل إعادة تشغيل. عشان كده `render.yaml` بيستخدم خطة **Starter** المدفوعة، ومعاها قرص 1GB. راجع الأسعار الحالية في صفحة Render قبل ما توافق.

### استضافة أخرى

أي سيرفر Node.js ينفع (Railway، Fly.io، VPS). المهم إن `DB_PATH` و `BOOKS_DIR` يكونوا على قرص دائم.

## كيف يعمل الأمان

- السعر بيتحسب على السيرفر بس. المتصفح مش بيحدد السعر.
- الطلب مش بيتعلّم "مدفوع" غير بعد ما توقيع HMAC من Paymob يتأكد، **وكمان** المبلغ المدفوع يطابق قيمة الطلب.
- كل طلب ليه رابط سري عشوائي، ومن غيره محدش يقدر يشوف الطلب أو يحمّل منه.
- الحد الأقصى للتحميل لكل كتاب بيتظبط من `MAX_DOWNLOADS_PER_BOOK` (الافتراضي 10).
