require('dotenv').config();
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');

const store = require('./src/store');
const paymob = require('./src/paymob');
const { catalog, priceCart, PricingError } = require('./src/pricing');
const { stampPdf } = require('./src/stamp');

const PORT = process.env.PORT || 3000;
// On Render, RENDER_EXTERNAL_URL is set automatically.
const BASE_URL = (process.env.BASE_URL || process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const IS_PROD = process.env.NODE_ENV === 'production';
const PROVIDER = process.env.PAYMENT_PROVIDER || (IS_PROD ? 'paymob' : 'mock');
const BOOKS_DIR = process.env.BOOKS_DIR || path.join(__dirname, 'private', 'books');
const MAX_DOWNLOADS = parseInt(process.env.MAX_DOWNLOADS_PER_BOOK || '10', 10);
// On hosts without a persistent disk (e.g. Render free), uploaded files would vanish on restart,
// so the books ship inside the (private) repo instead and admin uploads are turned off.
const UPLOADS_ENABLED = process.env.ALLOW_BOOK_UPLOADS !== 'false';
// Stamp every downloaded copy with the buyer's details (set STAMP_PDFS=false to turn off).
const STAMP_PDFS = process.env.STAMP_PDFS !== 'false';

if (PROVIDER === 'mock' && IS_PROD) {
  console.error('Refusing to start: PAYMENT_PROVIDER=mock is not allowed in production.');
  process.exit(1);
}
// The site can go live before Paymob is set up: paid checkout is simply unavailable until then.
const PAYMOB_READY = ['PAYMOB_SECRET_KEY', 'PAYMOB_PUBLIC_KEY', 'PAYMOB_HMAC_SECRET', 'PAYMOB_INTEGRATION_IDS']
  .every((k) => process.env[k]);
if (PROVIDER === 'paymob' && !PAYMOB_READY) {
  console.warn('WARNING: Paymob keys are missing — paid checkout is disabled until they are set.');
}
fs.mkdirSync(BOOKS_DIR, { recursive: true });
if (IS_PROD && !process.env.DATABASE_URL && !process.env.DB_PATH) {
  console.warn('WARNING: no DATABASE_URL — orders are stored in a local file and may be lost on restart.');
}

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(express.json({ limit: '50kb' }));

// Express 4 doesn't forward rejected promises to the error handler; this does.
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer', // order links carry a secret token
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy':
      "default-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; script-src 'self'; frame-ancestors 'none'",
  });
  next();
});

// --- tiny in-memory rate limiter (per IP) ---
const hits = new Map();
function rateLimit(max, windowMs) {
  return (req, res, next) => {
    const key = `${req.path}:${req.ip}`;
    const now = Date.now();
    const rec = hits.get(key) || { n: 0, reset: now + windowMs };
    if (now > rec.reset) Object.assign(rec, { n: 0, reset: now + windowMs });
    rec.n += 1;
    hits.set(key, rec);
    if (rec.n > max) return res.status(429).json({ error: 'محاولات كثيرة، حاول بعد دقيقة' });
    next();
  };
}

// --- helpers ---
const newId = () => 'ord_' + crypto.randomBytes(8).toString('hex');
const newToken = () => crypto.randomBytes(24).toString('base64url');
const orderLink = (o) => `/order.html?id=${o.id}&t=${o.token}`;

function tokenOk(order, token) {
  if (!order || !token) return false;
  const a = Buffer.from(order.token);
  const b = Buffer.from(String(token));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function publicOrder(o) {
  const books = catalog().books;
  return {
    id: o.id,
    status: o.status,
    createdAt: o.createdAt,
    paidAt: o.paidAt || null,
    lines: o.lines.map(({ id, title, price }) => ({ id, title, price })),
    subtotal: o.subtotal,
    discount: o.discount,
    total: o.total,
    promoCode: o.promoCode,
    downloads: o.bookIds.map((bid) => {
      const b = books.find((x) => x.id === bid) || { title: bid };
      const used = o.downloads[bid] || 0;
      return {
        bookId: bid,
        title: b.title,
        color: b.color,
        remaining: Math.max(0, MAX_DOWNLOADS - used),
        url: o.status === 'paid' && used < MAX_DOWNLOADS ? `/download/${o.id}/${bid}?t=${o.token}` : null,
      };
    }),
  };
}

// Idempotent and atomic: Paymob's callback and the browser redirect can both arrive,
// even at the same moment; only the first one flips the order (and counts the promo use).
async function markPaid(order, info = {}, opts = {}) {
  if (order.status === 'paid') return 'already';
  const paid = { ...order, status: 'paid', paidAt: new Date().toISOString(), payment: { ...order.payment, ...info } };
  const result = await store.markPaid(paid, opts);
  if (result === 'paid') {
    Object.assign(order, paid);
    console.log(`[paid] ${order.id} ${order.total} EGP${order.promoCode ? ` (code ${order.promoCode})` : ''}`);
  }
  return result;
}

async function markFailed(order, info = {}) {
  if (order.status === 'paid') return;
  order.status = 'failed';
  order.payment = { ...order.payment, ...info };
  await store.saveOrder(order); // no-op if the order was paid in the meantime
}

// --- public API ---
app.get('/api/catalog', (req, res) => {
  const c = catalog();
  res.json({
    currency: c.currency,
    provider: PROVIDER,
    books: c.books.map(({ file, ...b }) => b), // never expose file names
    bundles: c.bundles,
  });
});

app.post('/api/quote', rateLimit(30, 60_000), ah(async (req, res) => {
  try {
    const q = await priceCart(req.body.items, req.body.promoCode);
    res.json(q);
  } catch (e) {
    if (e instanceof PricingError) return res.status(400).json({ error: e.message });
    throw e;
  }
}));

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_RE = /^\+?[0-9]{10,15}$/;

app.post('/api/checkout', rateLimit(10, 60_000), ah(async (req, res) => {
  const { items, promoCode, customer = {} } = req.body;
  const name = String(customer.name || '').trim().slice(0, 100);
  const email = String(customer.email || '').trim().toLowerCase().slice(0, 150);
  const phone = String(customer.phone || '').replace(/[\s-]/g, '');
  if (name.length < 2) return res.status(400).json({ error: 'من فضلك اكتب الاسم' });
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'البريد الإلكتروني غير صحيح' });
  if (!PHONE_RE.test(phone)) return res.status(400).json({ error: 'رقم الموبايل غير صحيح' });

  let quote;
  try {
    quote = await priceCart(items, promoCode);
  } catch (e) {
    if (e instanceof PricingError) return res.status(400).json({ error: e.message });
    throw e;
  }

  const order = {
    id: newId(),
    token: newToken(),
    status: 'pending',
    createdAt: new Date().toISOString(),
    customer: { name, email, phone },
    ...quote,
    downloads: {},
    payment: { provider: PROVIDER },
  };
  await store.saveOrder(order);

  // 100% discount → no payment needed.
  if (order.total === 0) {
    // Claims the code atomically: a single-use code works for exactly one person.
    if ((await markPaid(order, { provider: 'free-promo' }, { enforcePromoLimit: true })) === 'exhausted') {
      await markFailed(order, { error: 'promo-exhausted' });
      return res.status(400).json({ error: 'تم استنفاد عدد مرات استخدام هذا الكود' });
    }
    return res.json({ orderId: order.id, redirect: orderLink(order), orderLink: orderLink(order) });
  }

  if (PROVIDER === 'mock') {
    return res.json({ orderId: order.id, redirect: `/mock-pay.html?id=${order.id}&t=${order.token}`, orderLink: orderLink(order) });
  }

  if (!PAYMOB_READY) {
    await markFailed(order, { error: 'payments-not-configured' });
    return res.status(503).json({ error: 'الدفع الإلكتروني غير متاح حاليًا، حاول لاحقًا' });
  }

  try {
    const checkout = await paymob.createCheckout(order, BASE_URL);
    order.paymob = { intentionId: checkout.intentionId, orderId: checkout.orderId };
    await store.saveOrder(order);
    res.json({ orderId: order.id, redirect: checkout.url, orderLink: orderLink(order) });
  } catch (e) {
    console.error(e);
    await markFailed(order, { error: 'gateway' });
    res.status(502).json({ error: 'تعذر الاتصال ببوابة الدفع، حاول مرة أخرى' });
  }
}));

app.get('/api/orders/:id', ah(async (req, res) => {
  const order = await store.getOrder(req.params.id);
  if (!tokenOk(order, req.query.t)) return res.status(404).json({ error: 'الطلب غير موجود' });
  res.json(publicOrder(order));
}));

// --- Paymob webhooks ---
async function findOrderForTxn(merchantOrderId, paymobOrderId) {
  return (merchantOrderId && (await store.getOrder(String(merchantOrderId)))) ||
    (paymobOrderId && (await store.findOrderByPaymobOrderId(paymobOrderId))) || null;
}

async function applyTxn(order, { success, pending, amountCents, txnId }) {
  if (!order) return;
  if (success && !pending) {
    if (Number(amountCents) !== order.total * 100) {
      console.warn(`[amount mismatch] ${order.id}: got ${amountCents}, expected ${order.total * 100}`);
      return;
    }
    await markPaid(order, { transactionId: txnId });
  } else if (!pending) {
    await markFailed(order, { transactionId: txnId });
  }
}

// Server-to-server: the authoritative confirmation.
app.post('/api/paymob/callback', ah(async (req, res) => {
  if (!PAYMOB_READY) return res.sendStatus(503);
  const obj = req.body && req.body.obj;
  if (!obj || req.body.type !== 'TRANSACTION') return res.sendStatus(200);
  if (!paymob.verifyProcessedCallback(obj, req.query.hmac)) {
    console.warn('[paymob] invalid HMAC on callback');
    return res.sendStatus(401);
  }
  const order = await findOrderForTxn(obj.order && obj.order.merchant_order_id, obj.order && obj.order.id);
  await applyTxn(order, { success: obj.success === true, pending: obj.pending === true, amountCents: obj.amount_cents, txnId: obj.id });
  res.sendStatus(200);
}));

// Browser redirect after paying: verify, update, then send the buyer to their order page.
app.get('/api/paymob/return', ah(async (req, res) => {
  const q = req.query;
  const valid = PAYMOB_READY && paymob.verifyRedirectQuery(q);
  const order = await findOrderForTxn(q.merchant_order_id, q.order);
  if (!order) return res.redirect('/?payment=unknown');
  if (valid) {
    await applyTxn(order, { success: q.success === 'true', pending: q.pending === 'true', amountCents: q.amount_cents, txnId: q.id });
  }
  res.redirect(orderLink(order));
}));

// --- Mock gateway (local testing only) ---
if (PROVIDER === 'mock') {
  app.post('/api/mock/complete', ah(async (req, res) => {
    const order = await store.getOrder(String(req.body.id || ''));
    if (!tokenOk(order, req.body.t)) return res.status(404).json({ error: 'not found' });
    if (req.body.result === 'success') await markPaid(order, { transactionId: 'mock_' + Date.now() });
    else await markFailed(order, { transactionId: 'mock_' + Date.now() });
    res.json({ redirect: orderLink(order) });
  }));
} else {
  app.get('/mock-pay.html', (req, res) => res.sendStatus(404));
}

// --- Protected downloads ---
app.get('/download/:orderId/:bookId', ah(async (req, res) => {
  const order = await store.getOrder(req.params.orderId);
  if (!tokenOk(order, req.query.t)) return res.status(404).send('Not found');
  if (order.status !== 'paid') return res.status(402).send('لم يتم تأكيد الدفع بعد');
  const bookId = req.params.bookId;
  if (!order.bookIds.includes(bookId)) return res.status(403).send('هذا الكتاب غير موجود في طلبك');
  if ((order.downloads[bookId] || 0) >= MAX_DOWNLOADS) return res.status(429).send('تم تجاوز الحد الأقصى لمرات التحميل، تواصل معنا');

  const book = catalog().books.find((b) => b.id === bookId);
  const filePath = path.join(BOOKS_DIR, path.basename(book.file));
  if (!fs.existsSync(filePath)) {
    console.error(`[missing file] ${filePath}`);
    return res.status(500).send('الملف غير متاح حاليًا، تواصل معنا');
  }

  // Personalize this copy with the buyer's name, email and order number on every page.
  const original = await fs.promises.readFile(filePath);
  let body = original;
  if (STAMP_PDFS) {
    try {
      body = Buffer.from(await stampPdf(original, {
        name: order.customer.name, email: order.customer.email, orderId: order.id,
        date: new Date(order.paidAt || order.createdAt),
      }));
    } catch (e) {
      // The buyer has paid, so they still get the book; fix the source PDF (e.g. remove its password).
      console.error(`[stamp failed] ${book.file}: ${e.message} — sent unstamped copy for ${order.id}`);
    }
  }

  if (!(await store.incrementDownload(order.id, bookId, MAX_DOWNLOADS)))
    return res.status(429).send('تم تجاوز الحد الأقصى لمرات التحميل، تواصل معنا');
  res.set('Cache-Control', 'private, no-store');
  res.attachment(`${book.title}.pdf`);
  res.type('application/pdf');
  res.send(body);
}));

// --- Admin ---
function requireAdmin(req, res, next) {
  const pass = process.env.ADMIN_PASSWORD;
  const given = (req.get('authorization') || '').replace(/^Bearer /, '');
  if (!pass || given.length !== pass.length || !crypto.timingSafeEqual(Buffer.from(given), Buffer.from(pass)))
    return res.status(401).json({ error: 'unauthorized' });
  next();
}

app.get('/api/admin/books', requireAdmin, (req, res) => {
  res.json({
    payments: PROVIDER === 'mock' ? 'mock' : PAYMOB_READY ? 'paymob' : 'not-configured',
    uploadsEnabled: UPLOADS_ENABLED,
    storage: store.kind,
    books: catalog().books.map((b) => {
      const f = path.join(BOOKS_DIR, path.basename(b.file));
      const st = fs.existsSync(f) ? fs.statSync(f) : null;
      return { id: b.id, title: b.title, file: b.file, uploaded: !!st, size: st ? st.size : 0, updatedAt: st ? st.mtime : null };
    }),
  });
});

// Upload a book PDF straight from the admin page (raw body, streamed to disk).
const MAX_UPLOAD = 300 * 1024 * 1024;
app.put('/api/admin/books/:bookId', requireAdmin, (req, res) => {
  if (!UPLOADS_ENABLED) return res.status(403).json({ error: 'الرفع من هنا متوقف على هذا السيرفر — ارفع الكتب على GitHub' });
  const book = catalog().books.find((b) => b.id === req.params.bookId);
  if (!book) return res.status(404).json({ error: 'كتاب غير معروف' });
  if (Number(req.get('content-length') || 0) > MAX_UPLOAD) return res.status(413).json({ error: 'الملف أكبر من 300MB' });
  const dest = path.join(BOOKS_DIR, path.basename(book.file));
  const tmp = `${dest}.${crypto.randomBytes(6).toString('hex')}.uploading`; // unique per upload
  const out = fs.createWriteStream(tmp);
  let size = 0;
  let head = Buffer.alloc(0);
  let aborted = false;
  const fail = (code, error) => {
    if (aborted) return;
    aborted = true;
    req.unpipe(out);
    out.destroy();
    fs.rm(tmp, { force: true }, () => {});
    res.status(code).json({ error });
  };
  req.on('data', (chunk) => {
    size += chunk.length;
    if (head.length < 5) head = Buffer.concat([head, chunk]).subarray(0, 5);
    if (size > MAX_UPLOAD) fail(413, 'الملف أكبر من 300MB');
  });
  req.pipe(out);
  out.on('finish', () => {
    if (aborted) return;
    if (head.toString('latin1') !== '%PDF-') return fail(400, 'الملف ليس PDF');
    fs.rename(tmp, dest, (err) => {
      if (err) return fail(500, 'تعذر حفظ الملف');
      console.log(`[upload] ${book.file} ${size} bytes`);
      res.json({ ok: true, size });
    });
  });
  out.on('error', () => fail(500, 'تعذر حفظ الملف'));
  req.on('error', () => fail(400, 'انقطع الرفع'));
});

app.get('/api/admin/orders', requireAdmin, ah(async (req, res) => {
  res.json(
    (await store.allOrders()).map((o) => ({
      id: o.id, status: o.status, createdAt: o.createdAt, paidAt: o.paidAt, customer: o.customer,
      items: o.lines.map((l) => l.title), subtotal: o.subtotal, discount: o.discount, total: o.total,
      promoCode: o.promoCode, downloads: o.downloads, link: BASE_URL + orderLink(o),
    }))
  );
}));

app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

app.use((err, req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'حدث خطأ غير متوقع' });
});

// Fail fast if the database is unreachable or misconfigured.
app.ready = store.init();

if (require.main === module) {
  app.ready
    .then(() => app.listen(PORT, () => console.log(`Bookstore running on ${BASE_URL} (payments: ${PROVIDER}, storage: ${store.kind})`)))
    .catch((e) => {
      console.error('Could not connect to the database:', e.message);
      process.exit(1);
    });
}

module.exports = app;
module.exports.store = store;
