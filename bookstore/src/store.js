// Minimal JSON-file database (orders + promo usage). Single-process, synchronous writes.
const fs = require('fs');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'db.json');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

let db = { orders: {}, promoUses: {} };
if (fs.existsSync(DB_PATH)) {
  db = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  db.orders ||= {};
  db.promoUses ||= {};
}

function save() {
  const tmp = DB_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_PATH);
}

module.exports = {
  getOrder: (id) => db.orders[id] || null,
  findOrderByPaymobOrderId: (pid) =>
    Object.values(db.orders).find((o) => o.paymob && String(o.paymob.orderId) === String(pid)) || null,
  saveOrder(order) {
    db.orders[order.id] = order;
    save();
  },
  allOrders: () => Object.values(db.orders).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  promoUses: (code) => db.promoUses[code] || 0,
  incrementPromo(code) {
    db.promoUses[code] = (db.promoUses[code] || 0) + 1;
    save();
  },
};
