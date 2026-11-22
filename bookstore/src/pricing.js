// Catalog loading, promo validation and server-side price calculation.
// The browser never decides the price: everything is recomputed here.
const fs = require('fs');
const path = require('path');
const store = require('./store');

const DATA = path.join(__dirname, '..', 'data');
const readJson = (f) => JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8'));
// PROMOS_FILE lets tests use their own codes without touching the real list.
const readPromos = () =>
  JSON.parse(fs.readFileSync(process.env.PROMOS_FILE || path.join(DATA, 'promos.json'), 'utf8')).codes;

// Offset of Cairo time from UTC (in minutes) at a given instant; handles summer time.
function cairoOffsetMinutes(date) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: 'Africa/Cairo', hourCycle: 'h23', year: 'numeric', month: '2-digit',
      day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(date).map((x) => [x.type, x.value])
  );
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return Math.round((asUtc - date.getTime()) / 60000);
}

/**
 * "2026-12-31" means that day in Cairo: start of day for startsAt, end of day for expiresAt.
 * A full date-time (e.g. "2026-12-31T18:00:00+02:00") is used exactly as written.
 */
function parseBoundary(value, endOfDay) {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value).trim());
  if (!m) return new Date(value);
  const wall = Date.UTC(+m[1], +m[2] - 1, +m[3], endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0);
  return new Date(wall - cairoOffsetMinutes(new Date(wall)) * 60000);
}

// Re-read on every call so edits to the JSON files apply without a restart.
function catalog() {
  return readJson('catalog.json');
}

function findProduct(id) {
  const c = catalog();
  const book = c.books.find((b) => b.id === id);
  if (book) return { ...book, kind: 'book', bookIds: [book.id] };
  const bundle = c.bundles.find((b) => b.id === id);
  if (bundle) return { ...bundle, kind: 'bundle' };
  return null;
}

class PricingError extends Error {}

async function lookupPromo(code) {
  if (!code) return null;
  const normalized = String(code).trim().toUpperCase();
  const promo = readPromos().find((p) => p.code && p.code.toUpperCase() === normalized);
  if (!promo || promo.active === false) throw new PricingError('كود الخصم غير صحيح');
  const now = new Date();
  const starts = parseBoundary(promo.startsAt, false);
  const expires = parseBoundary(promo.expiresAt, true);
  if (starts && now < starts) throw new PricingError('كود الخصم غير صحيح'); // not live yet: don't reveal it exists
  if (expires && now > expires) throw new PricingError('كود الخصم منتهي الصلاحية');
  if (promo.maxUses != null && (await store.promoUses(promo.code)) >= promo.maxUses)
    throw new PricingError('تم استنفاد عدد مرات استخدام هذا الكود');
  return promo;
}

/**
 * @param {string[]} itemIds product ids (books and/or bundles)
 * @param {string} [promoCode]
 */
async function priceCart(itemIds, promoCode) {
  if (!Array.isArray(itemIds) || itemIds.length === 0) throw new PricingError('السلة فارغة');
  let products = [...new Set(itemIds.map(String))].map((id) => {
    const p = findProduct(id);
    if (!p) throw new PricingError('منتج غير معروف');
    // A part marked "soon" can't be bought, alone or through a bundle that still lists it.
    const books = catalog().books;
    if (p.bookIds.some((bid) => (books.find((b) => b.id === bid) || {}).status === 'soon'))
      throw new PricingError('هذا الجزء لم يصدر بعد');
    return p;
  });

  // Drop individual books already covered by a bundle in the cart.
  const covered = new Set(products.filter((p) => p.kind === 'bundle').flatMap((p) => p.bookIds));
  products = products.filter((p) => p.kind === 'bundle' || !covered.has(p.id));

  const lines = products.map((p) => ({ id: p.id, title: p.title, kind: p.kind, price: p.price, bookIds: p.bookIds }));
  const subtotal = lines.reduce((s, l) => s + l.price, 0);

  let discount = 0;
  const promo = await lookupPromo(promoCode);
  if (promo) {
    const eligible = lines
      .filter((l) => promo.appliesTo === 'all' || (Array.isArray(promo.appliesTo) && promo.appliesTo.includes(l.id)))
      .reduce((s, l) => s + l.price, 0);
    if (eligible === 0) throw new PricingError('هذا الكود لا ينطبق على المنتجات في السلة');
    discount = promo.type === 'percent' ? Math.round((eligible * promo.value) / 100) : Math.min(promo.value, eligible);
  }

  const total = Math.max(0, subtotal - discount);
  const bookIds = [...new Set(lines.flatMap((l) => l.bookIds))];
  return {
    lines, bookIds, subtotal, discount, total,
    promoCode: promo ? promo.code : null,
    promoMaxUses: promo && promo.maxUses != null ? promo.maxUses : null,
  };
}

module.exports = { catalog, findProduct, priceCart, PricingError, parseBoundary };
