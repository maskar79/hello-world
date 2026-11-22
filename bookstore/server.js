require('dotenv').config();
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');

const store = require('./src/store');
const paymob = require('./src/paymob');
const { catalog, priceCart, PricingError } = require('./src/pricing');

const PORT = process.env.PORT || 3000;
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const IS_PROD = process.env.NODE_ENV === 'production';
const PROVIDER = process.env.PAYMENT_PROVIDER || (IS_PROD ? 'paymob' : 'mock');
const BOOKS_DIR = process.env.BOOKS_DIR || path.join(__dirname, 'private', 'books');
const MAX_DOWNLOADS = parseInt(process.env.MAX_DOWNLOADS_PER_BOOK || '10', 10);

if (PROVIDER === 'mock' && IS_PROD) {
  console.error('Refusing to start: PAYMENT_PROVIDER=mock is not allowed in production.');
  process.exit(1);
}
if (PROVIDER === 'paymob' && !process.env.PAYMOB_HMAC_SECRET) {
  console.error('Refusing to start: PAYMOB_HMAC_SECRET is required to verify payments.');
  process.exit(1);
}

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(express.json({ limit: '50kb' }));

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

function markPaid(order, info = {}) {
  if (order.status === 'paid') return; // idempotent: callback + redirect can both arrive
  order.status = 'paid';
  order.paidAt = new Date().toISOString();
  order.payment = { ...order.payment, ...info };
  if (order.promoCode) store.incrementPromo(order.promoCode);
  store.saveOrder(order);
  console.log(`[paid] ${order.id} ${order.total} EGP ${order.customer.email}`);
}

function markFailed(order, info = {}) {
  if (order.status === 'paid') return;
  order.status = 'failed';
  order.payment = { ...order.payment, ...info };
  store.saveOrder(order);
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

app.post('/api/quote', rateLimit(30, 60_000), (req, res) => {
  try {
    const q = priceCart(req.body.items, req.body.promoCode);
    res.json(q);
  } catch (e) {
    if (e instanceof PricingError) return res.status(400).json({ error: e.message });
    throw e;
  }
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_RE = /^\+?[0-9]{10,15}$/;

app.post('/api/checkout', rateLimit(10, 60_000), async (req, res) => {
  const { items, promoCode, customer = {} } = req.body;
  const name = String(customer.name || '').trim().slice(0, 100);
  const email = String(customer.email || '').trim().toLowerCase().slice(0, 150);
  const phone = String(customer.phone || '').replace(/[\s-]/g, '');
  if (name.length < 2) return res.status(400).json({ error: 'من فضلك اكتب الاسم' });
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'البريد الإلكتروني غير صحيح' });
  if (!PHONE_RE.test(phone)) return res.status(400).json({ error: 'رقم الموبايل غير صحيح' });

  let quote;
  try {
    quote = priceCart(items, promoCode);
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
  store.saveOrder(order);

  // 100% discount → no payment needed.
  if (order.total === 0) {
    markPaid(order, { provider: 'free-promo' });
    return res.json({ orderId: order.id, redirect: orderLink(order), orderLink: orderLink(order) });
  }

  if (PROVIDER === 'mock') {
    return res.json({ orderId: order.id, redirect: `/mock-pay.html?id=${order.id}&t=${order.token}`, orderLink: orderLink(order) });
  }

  try {
    const checkout = await paymob.createCheckout(order, BASE_URL);
    order.paymob = { intentionId: checkout.intentionId, orderId: checkout.orderId };
    store.saveOrder(order);
    res.json({ orderId: order.id, redirect: checkout.url, orderLink: orderLink(order) });
  } catch (e) {
    console.error(e);
    markFailed(order, { error: 'gateway' });
    res.status(502).json({ error: 'تعذر الاتصال ببوابة الدفع، حاول مرة أخرى' });
  }
});

app.get('/api/orders/:id', (req, res) => {
  const order = store.getOrder(req.params.id);
  if (!tokenOk(order, req.query.t)) return res.status(404).json({ error: 'الطلب غير موجود' });
  res.json(publicOrder(order));
});

// --- Paymob webhooks ---
function findOrderForTxn(merchantOrderId, paymobOrderId) {
  return (merchantOrderId && store.getOrder(merchantOrderId)) || (paymobOrderId && store.findOrderByPaymobOrderId(paymobOrderId)) || null;
}

function applyTxn(order, { success, pending, amountCents, txnId }) {
  if (!order) return;
  if (success && !pending) {
    if (Number(amountCents) !== order.total * 100) {
      console.warn(`[amount mismatch] ${order.id}: got ${amountCents}, expected ${order.total * 100}`);
      return;
    }
    markPaid(order, { transactionId: txnId });
  } else if (!pending) {
    markFailed(order, { transactionId: txnId });
  }
}

// Server-to-server: the authoritative confirmation.
app.post('/api/paymob/callback', (req, res) => {
  const obj = req.body && req.body.obj;
  if (!obj || req.body.type !== 'TRANSACTION') return res.sendStatus(200);
  if (!paymob.verifyProcessedCallback(obj, req.query.hmac)) {
    console.warn('[paymob] invalid HMAC on callback');
    return res.sendStatus(401);
  }
  const order = findOrderForTxn(obj.order && obj.order.merchant_order_id, obj.order && obj.order.id);
  applyTxn(order, { success: obj.success === true, pending: obj.pending === true, amountCents: obj.amount_cents, txnId: obj.id });
  res.sendStatus(200);
});

// Browser redirect after paying: verify, update, then send the buyer to their order page.
app.get('/api/paymob/return', (req, res) => {
  const q = req.query;
  const valid = paymob.verifyRedirectQuery(q);
  const order = findOrderForTxn(q.merchant_order_id, q.order);
  if (!order) return res.redirect('/?payment=unknown');
  if (valid) {
    applyTxn(order, { success: q.success === 'true', pending: q.pending === 'true', amountCents: q.amount_cents, txnId: q.id });
  }
  res.redirect(orderLink(order));
});

// --- Mock gateway (local testing only) ---
if (PROVIDER === 'mock') {
  app.post('/api/mock/complete', (req, res) => {
    const order = store.getOrder(req.body.id);
    if (!tokenOk(order, req.body.t)) return res.status(404).json({ error: 'not found' });
    if (req.body.result === 'success') markPaid(order, { transactionId: 'mock_' + Date.now() });
    else markFailed(order, { transactionId: 'mock_' + Date.now() });
    res.json({ redirect: orderLink(order) });
  });
} else {
  app.get('/mock-pay.html', (req, res) => res.sendStatus(404));
}

// --- Protected downloads ---
app.get('/download/:orderId/:bookId', (req, res) => {
  const order = store.getOrder(req.params.orderId);
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
  order.downloads[bookId] = (order.downloads[bookId] || 0) + 1;
  store.saveOrder(order);
  res.set('Cache-Control', 'private, no-store');
  res.download(filePath, `${book.title}.pdf`);
});

// --- Admin (read-only sales view) ---
app.get('/api/admin/orders', (req, res) => {
  const pass = process.env.ADMIN_PASSWORD;
  const given = (req.get('authorization') || '').replace(/^Bearer /, '');
  if (!pass || given.length !== pass.length || !crypto.timingSafeEqual(Buffer.from(given), Buffer.from(pass)))
    return res.status(401).json({ error: 'unauthorized' });
  res.json(
    store.allOrders().map((o) => ({
      id: o.id, status: o.status, createdAt: o.createdAt, paidAt: o.paidAt, customer: o.customer,
      items: o.lines.map((l) => l.title), subtotal: o.subtotal, discount: o.discount, total: o.total,
      promoCode: o.promoCode, downloads: o.downloads, link: BASE_URL + orderLink(o),
    }))
  );
});

app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

app.use((err, req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'حدث خطأ غير متوقع' });
});

if (require.main === module) {
  app.listen(PORT, () => console.log(`Bookstore running on ${BASE_URL} (payments: ${PROVIDER})`));
}

module.exports = app;
