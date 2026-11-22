// Catalog loading, promo validation and server-side price calculation.
// The browser never decides the price: everything is recomputed here.
const fs = require('fs');
const path = require('path');
const store = require('./store');

const DATA = path.join(__dirname, '..', 'data');
const readJson = (f) => JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8'));

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

function lookupPromo(code) {
  if (!code) return null;
  const normalized = String(code).trim().toUpperCase();
  const promo = readJson('promos.json').codes.find((p) => p.code.toUpperCase() === normalized);
  if (!promo || !promo.active) throw new PricingError('كود الخصم غير صحيح');
  if (promo.expiresAt && new Date(promo.expiresAt) < new Date()) throw new PricingError('كود الخصم منتهي الصلاحية');
  if (promo.maxUses != null && store.promoUses(promo.code) >= promo.maxUses)
    throw new PricingError('تم استنفاد عدد مرات استخدام هذا الكود');
  return promo;
}

/**
 * @param {string[]} itemIds product ids (books and/or bundles)
 * @param {string} [promoCode]
 */
function priceCart(itemIds, promoCode) {
  if (!Array.isArray(itemIds) || itemIds.length === 0) throw new PricingError('السلة فارغة');
  let products = [...new Set(itemIds.map(String))].map((id) => {
    const p = findProduct(id);
    if (!p) throw new PricingError('منتج غير معروف');
    return p;
  });

  // Drop individual books already covered by a bundle in the cart.
  const covered = new Set(products.filter((p) => p.kind === 'bundle').flatMap((p) => p.bookIds));
  products = products.filter((p) => p.kind === 'bundle' || !covered.has(p.id));

  const lines = products.map((p) => ({ id: p.id, title: p.title, kind: p.kind, price: p.price, bookIds: p.bookIds }));
  const subtotal = lines.reduce((s, l) => s + l.price, 0);

  let discount = 0;
  const promo = lookupPromo(promoCode);
  if (promo) {
    const eligible = lines
      .filter((l) => promo.appliesTo === 'all' || (Array.isArray(promo.appliesTo) && promo.appliesTo.includes(l.id)))
      .reduce((s, l) => s + l.price, 0);
    if (eligible === 0) throw new PricingError('هذا الكود لا ينطبق على المنتجات في السلة');
    discount = promo.type === 'percent' ? Math.round((eligible * promo.value) / 100) : Math.min(promo.value, eligible);
  }

  const total = Math.max(0, subtotal - discount);
  const bookIds = [...new Set(lines.flatMap((l) => l.bookIds))];
  return { lines, bookIds, subtotal, discount, total, promoCode: promo ? promo.code : null };
}

module.exports = { catalog, findProduct, priceCart, PricingError };
