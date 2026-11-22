const test = require('node:test');
const assert = require('node:assert');
const { setupEnv, start, customer } = require('./helpers');

// Production deploy before Paymob keys are added: site works, paid checkout is disabled.
setupEnv({ NODE_ENV: 'production', PAYMENT_PROVIDER: 'paymob', RENDER_EXTERNAL_URL: 'https://x.onrender.com' });
for (const k of ['PAYMOB_SECRET_KEY', 'PAYMOB_PUBLIC_KEY', 'PAYMOB_HMAC_SECRET', 'PAYMOB_INTEGRATION_IDS']) delete process.env[k];
const app = require('../server');

test('runs without Paymob keys', async (t) => {
  const { server, req } = await start(app);
  t.after(() => server.close());
  assert.equal((await req('GET', '/api/catalog')).status, 200);
  const paid = await req('POST', '/api/checkout', { items: ['book1'], customer });
  assert.equal(paid.status, 503);
  const free = await req('POST', '/api/checkout', { items: ['book1'], promoCode: 'GIFT100', customer });
  assert.equal(free.status, 200);
  assert.equal((await req('POST', '/api/paymob/callback?hmac=x', { type: 'TRANSACTION', obj: {} })).status, 503);
  const admin = await req('GET', '/api/admin/books', null, { Authorization: 'Bearer secret-admin' });
  assert.equal(admin.json.payments, 'not-configured');
});
