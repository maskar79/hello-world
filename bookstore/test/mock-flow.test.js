const test = require('node:test');
const assert = require('node:assert');
const { setupEnv, start, customer } = require('./helpers');

setupEnv({ PAYMENT_PROVIDER: 'mock', MAX_DOWNLOADS_PER_BOOK: '2' });
const app = require('../server');

test('store flow with mock gateway', async (t) => {
  const { server, req } = await start(app);
  t.after(() => server.close());

  await t.test('catalog hides file names', async () => {
    const r = await req('GET', '/api/catalog');
    assert.equal(r.json.books.length, 4);
    assert.ok(r.json.books.every((b) => !('file' in b)));
  });

  await t.test('pricing: single, bundle dedupe, promos', async () => {
    let r = await req('POST', '/api/quote', { items: ['book1', 'book2'] });
    assert.equal(r.json.total, 700);
    r = await req('POST', '/api/quote', { items: ['book1', 'bundle-all'] });
    assert.deepEqual(r.json.lines.map((l) => l.id), ['bundle-all']);
    assert.equal(r.json.total, 1000);
    assert.equal(r.json.bookIds.length, 4);
    r = await req('POST', '/api/quote', { items: ['bundle-all'], promoCode: 'half50' });
    assert.equal(r.json.total, 500);
    r = await req('POST', '/api/quote', { items: ['bundle-all'], promoCode: 'SAVE100' });
    assert.equal(r.json.total, 900);
    r = await req('POST', '/api/quote', { items: ['book1'], promoCode: 'SAVE100' });
    assert.equal(r.status, 400); // promo restricted to bundle
    r = await req('POST', '/api/quote', { items: ['book1'], promoCode: 'NOPE' });
    assert.equal(r.status, 400);
    r = await req('POST', '/api/quote', { items: ['hacked'] });
    assert.equal(r.status, 400);
  });

  await t.test('download locked until paid, then works with limits', async () => {
    const c = await req('POST', '/api/checkout', { items: ['book2'], customer });
    assert.equal(c.status, 200);
    const link = new URL(c.json.orderLink, 'http://x');
    const id = link.searchParams.get('id');
    const tok = link.searchParams.get('t');

    let o = await req('GET', `/api/orders/${id}?t=${tok}`);
    assert.equal(o.json.status, 'pending');
    assert.equal(o.json.downloads[0].url, null);

    assert.equal((await req('GET', `/download/${id}/book2?t=${tok}`)).status, 402);
    assert.equal((await req('GET', `/api/orders/${id}?t=wrong`)).status, 404);

    const done = await req('POST', '/api/mock/complete', { id, t: tok, result: 'success' });
    assert.equal(done.status, 200);
    o = await req('GET', `/api/orders/${id}?t=${tok}`);
    assert.equal(o.json.status, 'paid');
    assert.ok(o.json.downloads[0].url);

    const d = await req('GET', o.json.downloads[0].url);
    assert.equal(d.status, 200);
    assert.ok(d.text.startsWith('%PDF'));
    assert.match(d.headers.get('content-disposition'), /attachment/);
    assert.equal((await req('GET', `/download/${id}/book1?t=${tok}`)).status, 403); // not purchased
    assert.equal((await req('GET', `/download/${id}/book2?t=wrong`)).status, 404);
    await req('GET', o.json.downloads[0].url);
    assert.equal((await req('GET', `/download/${id}/book2?t=${tok}`)).status, 429); // limit 2
  });

  await t.test('failed payment keeps downloads locked', async () => {
    const c = await req('POST', '/api/checkout', { items: ['book3'], customer });
    const link = new URL(c.json.orderLink, 'http://x');
    const [id, tok] = [link.searchParams.get('id'), link.searchParams.get('t')];
    await req('POST', '/api/mock/complete', { id, t: tok, result: 'failed' });
    const o = await req('GET', `/api/orders/${id}?t=${tok}`);
    assert.equal(o.json.status, 'failed');
    assert.equal((await req('GET', `/download/${id}/book3?t=${tok}`)).status, 402);
  });

  await t.test('100% promo is instantly paid, no gateway', async () => {
    const c = await req('POST', '/api/checkout', { items: ['bundle-all'], promoCode: 'GIFT100', customer });
    assert.ok(c.json.redirect.startsWith('/order.html'));
    const link = new URL(c.json.orderLink, 'http://x');
    const o = await req('GET', `/api/orders/${link.searchParams.get('id')}?t=${link.searchParams.get('t')}`);
    assert.equal(o.json.status, 'paid');
    assert.equal(o.json.total, 0);
    assert.equal(o.json.downloads.length, 4);
  });

  await t.test('checkout validates customer', async () => {
    const r = await req('POST', '/api/checkout', { items: ['book1'], customer: { ...customer, email: 'bad' } });
    assert.equal(r.status, 400);
  });

  await t.test('admin requires password', async () => {
    assert.equal((await req('GET', '/api/admin/orders')).status, 401);
    const r = await req('GET', '/api/admin/orders', null, { Authorization: 'Bearer secret-admin' });
    assert.equal(r.status, 200);
    assert.ok(r.json.length >= 3);
  });

  await t.test('private books folder is not publicly served', async () => {
    assert.equal((await req('GET', '/private/books/book1.pdf')).status, 404);
    assert.equal((await req('GET', '/book1.pdf')).status, 404);
  });
});
