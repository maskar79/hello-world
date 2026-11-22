const test = require('node:test');
const assert = require('node:assert');
const { setupEnv, start, customer } = require('./helpers');

setupEnv({ PAYMENT_PROVIDER: 'mock' });
const app = require('../server');
const { parseBoundary } = require('../src/pricing');

test('promo code rules', async (t) => {
  const { server, req } = await start(app);
  t.after(() => server.close());
  const quote = (code, items = ['book1']) => req('POST', '/api/quote', { items, promoCode: code });
  const freeCheckout = (code) => req('POST', '/api/checkout', { items: ['bundle-all'], promoCode: code, customer });

  await t.test('single-use code works once, then is refused', async () => {
    assert.equal((await freeCheckout('once')).status, 200);
    const again = await freeCheckout('ONCE');
    assert.equal(again.status, 400);
    assert.match(again.json.error, /استنفاد/);
  });

  await t.test('two people racing for a single-use code: exactly one wins', async () => {
    const results = await Promise.all(Array.from({ length: 4 }, () => freeCheckout('RACE1')));
    assert.equal(results.filter((r) => r.status === 200).length, 1);
  });

  await t.test('campaign codes have no use limit', async () => {
    for (let i = 0; i < 2; i += 1) { // few: checkout is rate-limited to 10/min per IP
      const r = await req('POST', '/api/checkout', { items: ['book1'], promoCode: 'HALF50', customer });
      assert.equal(r.status, 200);
    }
    assert.equal((await quote('HALF50')).json.total, 225); // half of 450
  });

  await t.test('start date, end date and switched-off codes', async () => {
    assert.equal((await quote('NOTYET')).status, 400);
    assert.match((await quote('ENDED')).json.error, /منتهي/);
    assert.equal((await quote('OFF')).status, 400);
  });

  await t.test('plain dates mean Cairo time, including summer time', () => {
    // Winter (UTC+2) and summer (UTC+3)
    assert.equal(parseBoundary('2027-01-15', true).toISOString(), '2027-01-15T21:59:59.000Z');
    assert.equal(parseBoundary('2027-01-15', false).toISOString(), '2027-01-14T22:00:00.000Z');
    assert.equal(parseBoundary('2027-07-15', true).toISOString(), '2027-07-15T20:59:59.000Z');
    assert.equal(parseBoundary('2027-07-15T12:00:00Z', true).toISOString(), '2027-07-15T12:00:00.000Z');
  });
});
