const test = require('node:test');
const assert = require('node:assert');
const { setupEnv, start } = require('./helpers');

setupEnv({ PAYMENT_PROVIDER: 'mock' });
process.env.SHOW_USD = 'true';
const app = require('../server');
const rates = require('../src/rates');

// Fake the two exchange-rate sources; everything else uses the real fetch.
const realFetch = global.fetch;
let mode = 'ok';
const calls = [];
global.fetch = async (url, opts) => {
  const u = String(url);
  if (u.includes('open.er-api.com')) {
    calls.push('er');
    if (mode === 'ok') return new Response(JSON.stringify({ result: 'success', rates: { EGP: 50 } }));
    return new Response('nope', { status: 503 });
  }
  if (u.includes('currency-api')) {
    calls.push('fallback');
    if (mode === 'down') return new Response('nope', { status: 503 });
    return new Response(JSON.stringify({ usd: { egp: 48 } }));
  }
  return realFetch(url, opts);
};

test('approximate dollar prices', async (t) => {
  const { server, req } = await start(app);
  t.after(() => server.close());

  await t.test('catalog carries the daily rate with its credit link', async () => {
    rates._reset(); mode = 'ok';
    const c = (await req('GET', '/api/catalog')).json;
    assert.equal(c.usd.egpPerUsd, 50);
    assert.equal(c.usd.attribution.text, 'Rates By Exchange Rate API');
  });

  await t.test('falls back to the second source', async () => {
    rates._reset(); mode = 'fallback';
    const c = (await req('GET', '/api/catalog')).json;
    assert.equal(c.usd.egpPerUsd, 48);
    assert.equal(c.usd.attribution, null);
  });

  await t.test('no dollar price when both sources are down, and no retry storm', async () => {
    rates._reset(); mode = 'down'; calls.length = 0;
    const c = (await req('GET', '/api/catalog')).json;
    assert.equal(c.usd, null);
    await req('GET', '/api/catalog');
    await req('GET', '/api/catalog');
    assert.equal(calls.length, 2); // one attempt per source, then it waits 15 minutes
  });

  await t.test('can be switched off', async () => {
    process.env.SHOW_USD = 'false';
    assert.equal((await req('GET', '/api/catalog')).json.usd, null);
    process.env.SHOW_USD = 'true';
  });
});
