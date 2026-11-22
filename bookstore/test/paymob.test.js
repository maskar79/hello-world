const test = require('node:test');
const assert = require('node:assert');
const { setupEnv, start, customer } = require('./helpers');

const HMAC = 'test-hmac-secret';
setupEnv({
  PAYMENT_PROVIDER: 'paymob', PAYMOB_HMAC_SECRET: HMAC, PAYMOB_SECRET_KEY: 'sk_test',
  PAYMOB_PUBLIC_KEY: 'pk_test', PAYMOB_INTEGRATION_IDS: '111,222', BASE_URL: 'https://shop.example',
});
const app = require('../server');
const paymob = require('../src/paymob');

// Stub only the outgoing Paymob API call; local requests use the real fetch.
const realFetch = global.fetch;
let lastIntention;
global.fetch = async (url, opts) => {
  if (String(url).startsWith('https://accept.paymob.com/v1/intention/')) {
    lastIntention = { url, opts, body: JSON.parse(opts.body) };
    return new Response(JSON.stringify({ id: 'pi_1', client_secret: 'cs_1', intention_order_id: 9001 }), { status: 201 });
  }
  return realFetch(url, opts);
};

function txn(order, overrides = {}) {
  return {
    id: 555, pending: false, amount_cents: order.amount, success: true, is_auth: false, is_capture: false,
    is_standalone_payment: true, is_voided: false, is_refunded: false, is_3d_secure: true, integration_id: 111,
    has_parent_transaction: false, owner: 42, created_at: '2026-11-22T10:00:00.000Z', currency: 'EGP',
    error_occured: false, source_data: { pan: '2346', type: 'card', sub_type: 'MasterCard' },
    order: { id: 9001, merchant_order_id: order.id }, ...overrides,
  };
}
const signObj = (obj) => paymob.sign(paymob.HMAC_FIELDS.map((f) => {
  const v = f.split('.').reduce((o, k) => o?.[k], obj); return v == null ? '' : String(v);
}).join(''), HMAC);

test('paymob integration', async (t) => {
  const { server, req } = await start(app);
  t.after(() => server.close());

  async function newOrder(items = ['bundle-all'], promoCode) {
    const c = await req('POST', '/api/checkout', { items, promoCode, customer });
    assert.equal(c.status, 200, c.text);
    const link = new URL(c.json.orderLink, 'http://x');
    return { c, id: link.searchParams.get('id'), tok: link.searchParams.get('t') };
  }

  await t.test('creates intention with correct amount and URLs', async () => {
    const { c, id } = await newOrder(['bundle-all'], 'HALF50');
    assert.match(c.json.redirect, /^https:\/\/accept\.paymob\.com\/unifiedcheckout\/\?publicKey=pk_test&clientSecret=cs_1$/);
    assert.equal(lastIntention.opts.headers.Authorization, 'Token sk_test');
    assert.equal(lastIntention.body.amount, 50000);
    assert.deepEqual(lastIntention.body.payment_methods, [111, 222]);
    assert.equal(lastIntention.body.special_reference, id);
    assert.equal(lastIntention.body.notification_url, 'https://shop.example/api/paymob/callback');
    assert.equal(lastIntention.body.items.reduce((s, i) => s + i.amount * i.quantity, 0), 50000);
  });

  await t.test('rejects callback with bad HMAC', async () => {
    const { id, tok } = await newOrder();
    const obj = txn({ id, amount: 100000 });
    const r = await req('POST', '/api/paymob/callback?hmac=deadbeef', { type: 'TRANSACTION', obj });
    assert.equal(r.status, 401);
    assert.equal((await req('GET', `/api/orders/${id}?t=${tok}`)).json.status, 'pending');
  });

  await t.test('ignores amount mismatch', async () => {
    const { id, tok } = await newOrder();
    const obj = txn({ id, amount: 100 });
    const r = await req('POST', `/api/paymob/callback?hmac=${signObj(obj)}`, { type: 'TRANSACTION', obj });
    assert.equal(r.status, 200);
    assert.equal((await req('GET', `/api/orders/${id}?t=${tok}`)).json.status, 'pending');
  });

  await t.test('valid callback marks paid and unlocks downloads', async () => {
    const { id, tok } = await newOrder();
    const obj = txn({ id, amount: 100000 });
    const r = await req('POST', `/api/paymob/callback?hmac=${signObj(obj)}`, { type: 'TRANSACTION', obj });
    assert.equal(r.status, 200);
    const o = (await req('GET', `/api/orders/${id}?t=${tok}`)).json;
    assert.equal(o.status, 'paid');
    assert.equal((await req('GET', o.downloads[0].url)).status, 200);
  });

  await t.test('declined callback marks failed', async () => {
    const { id, tok } = await newOrder();
    const obj = txn({ id, amount: 100000 }, { success: false });
    await req('POST', `/api/paymob/callback?hmac=${signObj(obj)}`, { type: 'TRANSACTION', obj });
    assert.equal((await req('GET', `/api/orders/${id}?t=${tok}`)).json.status, 'failed');
  });

  await t.test('browser redirect verifies HMAC and forwards to order page', async () => {
    const { id, tok } = await newOrder(['book1']);
    const obj = txn({ id, amount: 45000 });
    const q = {
      amount_cents: '45000', created_at: obj.created_at, currency: 'EGP', error_occured: 'false',
      has_parent_transaction: 'false', id: '555', integration_id: '111', is_3d_secure: 'true', is_auth: 'false',
      is_capture: 'false', is_refunded: 'false', is_standalone_payment: 'true', is_voided: 'false', order: '9001',
      owner: '42', pending: 'false', 'source_data.pan': '2346', 'source_data.sub_type': 'MasterCard',
      'source_data.type': 'card', success: 'true', merchant_order_id: id,
    };
    // forged redirect → not paid
    let r = await req('GET', '/api/paymob/return?' + new URLSearchParams({ ...q, hmac: 'x' }));
    assert.equal(r.status, 302);
    assert.equal((await req('GET', `/api/orders/${id}?t=${tok}`)).json.status, 'pending');
    q.hmac = paymob.sign(paymob.HMAC_FIELDS.map((f) => q[f === 'order.id' ? 'order' : f]).join(''), HMAC);
    r = await req('GET', '/api/paymob/return?' + new URLSearchParams(q));
    assert.equal(r.headers.get('location'), `/order.html?id=${id}&t=${tok}`);
    assert.equal((await req('GET', `/api/orders/${id}?t=${tok}`)).json.status, 'paid');
  });

  await t.test('mock endpoints are disabled', async () => {
    assert.equal((await req('POST', '/api/mock/complete', {})).status, 404);
    assert.equal((await req('GET', '/mock-pay.html')).status, 404);
  });
});
