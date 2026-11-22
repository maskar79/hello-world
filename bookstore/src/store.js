// Order storage.
//  - DATABASE_URL set  → PostgreSQL (e.g. Neon free tier). Used in production so orders
//                        survive restarts of a free hosting instance.
//  - otherwise         → a local JSON file (handy for development).
// All state changes that matter (paid, download counts) are atomic, so a payment
// confirmation arriving twice or two parallel downloads can't double-count.
const fs = require('fs');
const path = require('path');

function jsonStore() {
  const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'db.json');
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  let db = { orders: {}, promoUses: {} };
  if (fs.existsSync(DB_PATH)) db = { orders: {}, promoUses: {}, ...JSON.parse(fs.readFileSync(DB_PATH, 'utf8')) };
  const save = () => {
    fs.writeFileSync(DB_PATH + '.tmp', JSON.stringify(db, null, 2));
    fs.renameSync(DB_PATH + '.tmp', DB_PATH);
  };
  const clone = (o) => (o ? structuredClone(o) : null);

  return {
    kind: 'json',
    async init() {},
    async getOrder(id) { return clone(db.orders[id]); },
    async findOrderByPaymobOrderId(pid) {
      return clone(Object.values(db.orders).find((o) => o.paymob && String(o.paymob.orderId) === String(pid)));
    },
    async saveOrder(order) {
      const cur = db.orders[order.id];
      if (cur && cur.status === 'paid') return false; // never overwrite a paid order
      db.orders[order.id] = clone(order);
      save();
      return true;
    },
    async markPaid(order, { enforcePromoLimit = false } = {}) {
      const cur = db.orders[order.id];
      if (!cur || cur.status === 'paid') return 'already';
      const code = order.promoCode;
      if (code && enforcePromoLimit && order.promoMaxUses != null && (db.promoUses[code] || 0) >= order.promoMaxUses)
        return 'exhausted';
      db.orders[order.id] = clone(order);
      if (code) db.promoUses[code] = (db.promoUses[code] || 0) + 1;
      save();
      return 'paid';
    },
    async incrementDownload(orderId, bookId, max) {
      const o = db.orders[orderId];
      if (!o || (o.downloads[bookId] || 0) >= max) return false;
      o.downloads[bookId] = (o.downloads[bookId] || 0) + 1;
      save();
      return true;
    },
    async downloadTotals() {
      const t = {};
      for (const o of Object.values(db.orders)) for (const [bid, n] of Object.entries(o.downloads || {})) t[bid] = (t[bid] || 0) + n;
      return t;
    },
    async setEmail(orderId, email) {
      if (!db.orders[orderId]) return;
      db.orders[orderId].email = email;
      save();
    },
    async allOrders() {
      return Object.values(db.orders).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(clone);
    },
    async promoUses(code) { return db.promoUses[code] || 0; },
  };
}

function pgStore() {
  const { Pool } = require('pg');
  const url = process.env.DATABASE_URL;
  const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
  const pool = new Pool({ connectionString: url, max: 5, ssl: local ? false : { rejectUnauthorized: true } });
  pool.on('error', (e) => console.error('[db] idle client error', e.message));

  return {
    kind: 'postgres',
    async init() {
      // Advisory lock: concurrent instances (e.g. old + new during a deploy) can't race on CREATE TABLE.
      const client = await pool.connect();
      try {
        await client.query('SELECT pg_advisory_lock(727001)');
        await client.query(`
        CREATE TABLE IF NOT EXISTS orders (
          id TEXT PRIMARY KEY,
          status TEXT NOT NULL,
          paymob_order_id TEXT,
          created_at TIMESTAMPTZ NOT NULL,
          data JSONB NOT NULL
        );
        CREATE INDEX IF NOT EXISTS orders_paymob_idx ON orders (paymob_order_id);
        CREATE INDEX IF NOT EXISTS orders_created_idx ON orders (created_at DESC);
        CREATE TABLE IF NOT EXISTS promo_uses (code TEXT PRIMARY KEY, uses INT NOT NULL DEFAULT 0);
      `);
      } finally {
        await client.query('SELECT pg_advisory_unlock(727001)').catch(() => {});
        client.release();
      }
    },
    async getOrder(id) {
      const r = await pool.query('SELECT data FROM orders WHERE id = $1', [id]);
      return r.rows[0] ? r.rows[0].data : null;
    },
    async findOrderByPaymobOrderId(pid) {
      const r = await pool.query('SELECT data FROM orders WHERE paymob_order_id = $1', [String(pid)]);
      return r.rows[0] ? r.rows[0].data : null;
    },
    async saveOrder(o) {
      const r = await pool.query(
        `INSERT INTO orders (id, status, paymob_order_id, created_at, data) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, paymob_order_id = EXCLUDED.paymob_order_id, data = EXCLUDED.data
         WHERE orders.status <> 'paid'`,
        [o.id, o.status, o.paymob ? String(o.paymob.orderId) : null, o.createdAt, o]
      );
      return r.rowCount > 0;
    },
    // enforcePromoLimit: claim a use of the code only if one is left (row-locked, so two people
    // racing for a single-use code can't both get it). Used for free orders; a customer who has
    // already paid money is never refused.
    async markPaid(o, { enforcePromoLimit = false } = {}) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const r = await client.query(
          `UPDATE orders SET status = 'paid', data = $2 WHERE id = $1 AND status <> 'paid'`, [o.id, o]
        );
        if (!r.rowCount) {
          await client.query('ROLLBACK');
          return 'already';
        }
        if (o.promoCode) {
          const limited = enforcePromoLimit && o.promoMaxUses != null;
          const u = await client.query(
            `INSERT INTO promo_uses (code, uses) VALUES ($1, 1)
             ON CONFLICT (code) DO UPDATE SET uses = promo_uses.uses + 1
             WHERE NOT $2::boolean OR promo_uses.uses < $3::int`,
            [o.promoCode, limited, limited ? o.promoMaxUses : 0]
          );
          if (!u.rowCount || (limited && o.promoMaxUses < 1)) {
            await client.query('ROLLBACK');
            return 'exhausted';
          }
        }
        await client.query('COMMIT');
        return 'paid';
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    },
    async incrementDownload(orderId, bookId, max) {
      const r = await pool.query(
        `UPDATE orders
           SET data = jsonb_set(data, ARRAY['downloads', $2::text],
                                to_jsonb(COALESCE((data->'downloads'->>$2::text)::int, 0) + 1))
         WHERE id = $1 AND COALESCE((data->'downloads'->>$2::text)::int, 0) < $3`,
        [orderId, bookId, max]
      );
      return r.rowCount > 0;
    },
    async downloadTotals() {
      const r = await pool.query(
        `SELECT d.key AS book, SUM(d.value::int) AS n FROM orders, jsonb_each_text(data->'downloads') AS d GROUP BY d.key`
      );
      return Object.fromEntries(r.rows.map((x) => [x.book, Number(x.n)]));
    },
    async setEmail(orderId, email) {
      await pool.query(`UPDATE orders SET data = jsonb_set(data, '{email}', $2::jsonb) WHERE id = $1`, [orderId, JSON.stringify(email)]);
    },
    async allOrders() {
      const r = await pool.query('SELECT data FROM orders ORDER BY created_at DESC LIMIT 1000');
      return r.rows.map((x) => x.data);
    },
    async promoUses(code) {
      const r = await pool.query('SELECT uses FROM promo_uses WHERE code = $1', [code]);
      return r.rows[0] ? r.rows[0].uses : 0;
    },
    end: () => pool.end(),
  };
}

module.exports = process.env.DATABASE_URL ? pgStore() : jsonStore();
