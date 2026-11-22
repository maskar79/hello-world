# خطوات تشغيل الموقع (Go-Live)

الفرع اللي فيه الكود: `claude/israeli-books-ecommerce-qt3zrq` في ريبو `hello-world`.
كل الخطوات دي مجانية، ما عدا رسوم Paymob على كل عملية دفع.

---

## ١) GitHub: خلّي الريبو Private (قبل أي حاجة تانية)

1. افتح الريبو `hello-world` على GitHub.
2. **Settings** → **General** → انزل لآخر الصفحة لحد **Danger Zone** → **Change visibility** → **Make private** → أكّد.

ليه؟ الكتب وأكواد الخصم هتبقى جوه الريبو. لو هو Public، أي حد يقدر ينزّلهم.

## ٢) GitHub: ارفع ملفات الـ PDF

1. في الريبو، غيّر الفرع من القائمة اللي فوق على الشمال لـ `claude/israeli-books-ecommerce-qt3zrq`.
2. افتح الفولدر `bookstore` ← `private` ← `books`.
3. **Add file** → **Upload files** → اسحب الملفات بالأسماء دي بالظبط:
   - `book1.pdf` (الجزء الأول)
   - `book2.pdf` (الجزء الثاني)
   - `book3.pdf` (الجزء الثالث)
4. **Commit changes**، وخليه على نفس الفرع.

حجم الملف الواحد لازم يكون أقل من 25MB. ملفاتك من 10 لـ15MB، فكده تمام.

## ٣) أكواد الخصم

افتح `bookstore/data/promos.json` على نفس الفرع، واضغط على أيقونة القلم:
- `HALF50` (50%) و`SAVE10` (10%) و`SAVE100` (100 جنيه على المجموعة): غيّرها أو سيبها زي ما تحب.
- `FRIEND-7KQ2X` (مجاني، مرة واحدة): **غيّر الكود ده لكود جديد من عندك**، لأنه كان ظاهر قبل كده. نفس الكلام لأي كود هدية بعد كده: اعمله عشوائي وصعب التخمين.

## ٤) Neon: قاعدة البيانات (مجانية)

1. ادخل [neon.tech](https://neon.tech) واعمل حساب.
2. **Create project** → الـ Region: **AWS Europe Central 1 (Frankfurt)**.
3. من **Connection string** انسخ الرابط. شكله كده:
   `postgresql://...@ep-....eu-central-1.aws.neon.tech/neondb?sslmode=require`

احتفظ بيه، هتحتاجه في الخطوة الجاية. ده سرّي، ما تبعتهوش لحد.

## ٥) Render: تشغيل الموقع (مجاني)

1. ادخل [render.com](https://render.com) بحساب GitHub.
2. اسمح لـ Render يشوف الريبو: لما يطلب صلاحيات GitHub، اختار `hello-world` (هو Private دلوقتي).
3. **New** → **Blueprint** → اختار `hello-world` → الفرع `claude/israeli-books-ecommerce-qt3zrq` → Render هيقرأ ملف `render.yaml` لوحده.
4. هيطلب منك القيم دي:
   - `DATABASE_URL`: الرابط اللي نسخته من Neon.
   - `ADMIN_PASSWORD`: كلمة سر طويلة من عندك للوحة الإدارة.
   - مفاتيح `PAYMOB_...` الأربعة: **سيبها فاضية دلوقتي**.
5. **Apply** واستنى 3 لـ5 دقايق. هيظهر لك رابط زي `https://author-bookstore.onrender.com`.
6. افتح `الرابط/admin` وادخل بكلمة السر، واتأكد إن:
   - الأجزاء التلاتة عليها علامة ✓ خضرا (يعني الملفات وصلت).
   - مفيش تحذير أحمر عن قاعدة البيانات.
   - الدفع مكتوب إنه «غير مفعّل بعد». ده طبيعي لحد خطوة ٦.

**تجربة أولى من غير فلوس:** اعمل كود مجاني للتجربة في `promos.json` (مثلًا `TEST-K8P3Q` بـ100% و`"maxUses": 1`). اشتري بيه جزء من الموقع، ونزّل الكتاب، وافتحه واتأكد إن اسمك وإيميلك مكتوبين في آخر كل صفحة. بعدها امسح الكود.

## ٥.٥) إيميل التأكيد بعد الشراء

بعد ما الدفع يتأكد، الموقع بيبعت للمشتري إيميل فيه أغلفة كتبه وزرار «حمّل كتبك الآن» ورابطه الشخصي.
لو المشتري ردّ على الإيميل، الرد بيوصل على `MAIL_REPLY_TO` (Goyalla@gmail.com).
لحد ما تعمل الخطوة دي الموقع شغال عادي، بس من غير إيميلات.

**الطريقة المنصوح بيها: دومين خاص + Resend** (مجاني لحد 3,000 إيميل في الشهر)
1. اشتري دومين، مثلًا `israeel-books.com`، من Namecheap أو Cloudflare. سعره تقريبًا 10–15 دولار في السنة.
   هتستخدمه كمان كرابط للموقع (خطوة ٨)، بدل `onrender.com`.
2. ادخل [resend.com](https://resend.com) واعمل حساب → **Domains** → **Add Domain** → اكتب الدومين.
3. Resend هيديك كام سطر DNS (TXT وMX). ضيفهم في إعدادات الدومين عند الشركة اللي اشتريته منها، واستنى لحد ما يظهر جنبه **Verified**.
4. **API Keys** → **Create API Key** → انسخه (سري).
5. في Render → **Environment** حط:
   - `RESEND_API_KEY`: المفتاح.
   - `MAIL_FROM_EMAIL`: مثلًا `books@israeel-books.com`.
6. **Save**. هتلاقي في `/admin` سطر «إيميل التأكيد بعد الشراء مفعّل ✓».

**بديل من غير دومين: Brevo** (أسهل، بس الإيميلات ممكن تروح Spam)
1. ادخل [brevo.com](https://www.brevo.com) واعمل حساب → **Senders** → ضيف `Goyalla@gmail.com` وأكّده من الإيميل اللي هيوصلك.
2. **SMTP & API** → **API Keys** → **Generate** → انسخه.
3. في Render: حط `BREVO_API_KEY` والمفتاح، و`MAIL_FROM_EMAIL=Goyalla@gmail.com`، وسيب `RESEND_API_KEY` فاضي.

ملحوظة: Brevo بيستبدل عنوان Gmail بعنوان من عنده، لأن Gmail مش بيسمح لحد يبعت باسمه، وده بيخلي الإيميلات أكتر عرضة إنها تروح Spam. عشان كده الدومين الخاص أحسن.

**جرّب:** اشتري بكود مجاني على إيميلك، واتأكد إن الإيميل وصل وإن الزرار بيفتح صفحة التحميل. لو لقيته في Spam، علّمه «ليس Spam».
**في لوحة الإدارة:** فيه عمود «الإيميل» لكل طلب (أُرسل / فشل)، وزرار «إعادة الإرسال» لو حد قال إن الإيميل ما وصلوش.

## ٦) Paymob: تفعيل الدفع

1. سجّل حساب تاجر على [paymob.com](https://paymob.com/en/eg). هيطلبوا منك مستندات للتحقق من هويتك، ودي ممكن تاخد كام يوم.
2. اطلب منهم تفعيل:
   - **Online Card Payments** (فيزا/ماستركارد)، ومعاها **international cards** عشان الناس اللي برة مصر.
   - **Mobile Wallets** (فودافون كاش وغيره)، لو عايزها.
3. من لوحة تحكم Paymob هات:
   - **Secret Key** و**Public Key** (من Settings / Developers / API Keys).
   - **HMAC Secret**.
   - رقم الـ **Integration ID** لكل طريقة دفع (الكارت، والمحفظة).
4. في إعدادات **كل** Integration في Paymob حط:
   - **Transaction processed callback**: `https://الرابط/api/paymob/callback`
   - **Transaction response callback**: `https://الرابط/api/paymob/return`
5. في Render: افتح الخدمة → **Environment** → حط:
   - `PAYMOB_SECRET_KEY`
   - `PAYMOB_PUBLIC_KEY`
   - `PAYMOB_HMAC_SECRET`
   - `PAYMOB_INTEGRATION_IDS`: الأرقام مفصولة بفاصلة، مثلًا `1234567,7654321`.
6. **Save Changes**، والموقع هيعيد التشغيل لوحده.

**ابدأ بمفاتيح Test Mode الأول** وجرّب بكروت الاختبار بتاعة Paymob. لما كل حاجة تشتغل، غيّرها بمفاتيح Live.
**أول عملية حقيقية:** اعمل كود خصم مؤقت يخلّي السعر حوالي 10 جنيه (`"type": "fixed"`, `"value": 340`, `"appliesTo": ["book2"]`, `"maxUses": 1`). ادفع بكارتك واتأكد إن التحميل اشتغل، وبعدها امسح الكود.

## ٧) UptimeRobot: عشان الموقع ما ينامش (اختياري ومهم)

1. [uptimerobot.com](https://uptimerobot.com) → حساب مجاني.
2. **New monitor** → **HTTP(s)** → الرابط: `https://الرابط/api/catalog` → كل **5 minutes**.

## ٨) دومين خاص (اختياري)

1. في Render: **Settings** → **Custom Domains**، وضيف الدومين بتاعك.
2. ضيف في **Environment**: `BASE_URL=https://الدومين-بتاعك`.
3. غيّر رابطي الـ callback في Paymob للدومين الجديد.

---

## بعد التشغيل

- **أي تعديل في الأسعار أو الأكواد أو النصوص:** عدّل الملف على GitHub (نفس الفرع) → Commit → Render هيحدّث الموقع خلال دقايق.
- **الجزء الرابع لما يجهز:** ابعت الغلاف والنصوص، أو اعمل الآتي:
  1. ارفع `book4.pdf`.
  2. في `bookstore/data/catalog.json` امسح سطر `"status": "soon"`.
  3. ضيف `"book4"` لـ `bookIds` بتاعة المجموعة.
  4. ضيف الغلاف `public/covers/part4.webp`.
- **المبيعات:** `الرابط/admin`.
- **صفحة كل جزء:** `الرابط/part-1` و`/part-2` و`/part-3`. ده الرابط اللي تحطه في بوستات السوشيال ميديا.
- **صفحات العينة:** دلوقتي صور مؤقتة. ابعت لي أرقام الصفحات اللي عايزها من كل جزء، وأنا أطلّعها من الـ PDF وعليها كلمة «عينة» (`scripts/make-samples.py`).
- **عدّاد التحميل على الكروت:** بيبدأ من الرقم اللي في `downloadsBase` في `data/catalog.json`، وبيزيد عليه كل تحميل حقيقي. لو عايزه يعرض التحميلات الحقيقية بس، خلّي `downloadsBase` صفر.
- **روابط السوشيال ميديا (يوتيوب، فيسبوك، تيك توك، تيليجرام):** دلوقتي بتفتح الصفحة الرئيسية لكل موقع. لما صفحاتك تجهز ابعت لي الروابط، أو غيّرها بنفسك في `public/index.html` و`public/order.html` (دوّر على `youtube.com` و`facebook.com` و`tiktok.com` و`t.me`).
