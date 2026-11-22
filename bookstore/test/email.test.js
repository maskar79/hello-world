const test = require('node:test');
const assert = require('node:assert');
const { setupEnv, start, customer } = require('./helpers');

setupEnv({
  PAYMENT_PROVIDER: 'mock', RESEND_API_KEY: 're_test', MAIL_FROM_EMAIL: 'books@example.com',
  MAIL_REPLY_TO: 'author@example.com', CONTACT_WHATSAPP: '+971 50 000 0000', BASE_URL: 'https://shop.example',
});
const app = require('../server');

// Capture outgoing email API calls; everything else uses the real fetch.
const realFetch = global.fetch;
const sent = [];
let failNext = false;
global.fetch = async (url, opts) => {
  const u = String(url);
  if (u.startsWith('https://api.resend.com/') || u.startsWith('https://api.brevo.com/')) {
    if (failNext) { failNext = false; return new Response(JSON.stringify({ message: 'boom' }), { status: 500 }); }
    sent.push({ url: u, headers: opts.headers, body: JSON.parse(opts.body) });
    return new Response(JSON.stringify({ id: 'em_' + sent.length, messageId: 'm' + sent.length }), { status: 200 });
  }
  return realFetch(url, opts);
};
const settle = () => Promise.all([...app.emailJobs]);

test('order confirmation email', async (t) => {
  const { server, req } = await start(app);
  t.after(() => server.close());
  const auth = { Authorization: 'Bearer secret-admin' };

  async function buy(items, promoCode) {
    const c = await req('POST', '/api/checkout', { items, promoCode, customer });
    const l = new URL(c.json.orderLink, 'http://x');
    return { id: l.searchParams.get('id'), tok: l.searchParams.get('t') };
  }

  await t.test('no email before payment, one email after, never twice', async () => {
    const { id, tok } = await buy(['book2']);
    await settle();
    assert.equal(sent.length, 0);
    await req('POST', '/api/mock/complete', { id, t: tok, result: 'success' });
    await req('POST', '/api/mock/complete', { id, t: tok, result: 'success' }); // duplicate confirmation
    await settle();
    assert.equal(sent.length, 1);
    const m = sent[0];
    assert.equal(m.headers.Authorization, 'Bearer re_test');
    assert.deepEqual(m.body.to, [customer.email]);
    assert.equal(m.body.reply_to, 'author@example.com');
    assert.match(m.body.from, /<books@example\.com>$/);
    assert.match(m.body.subject, /جاهزة للتحميل/);
    assert.ok(m.body.html.includes(`https://shop.example/order.html?id=${id}&amp;t=${tok}`));
    assert.ok(m.body.text.includes(`https://shop.example/order.html?id=${id}&t=${tok}`));
    assert.ok(m.body.html.includes('https://shop.example/covers/part2-email.jpg'));
    assert.ok(m.body.html.includes('wa.me/971500000000'));
    const o = await req('GET', `/api/orders/${id}?t=${tok}`);
    assert.equal(o.json.emailTo, 'b•••@example.com');
    const admin = await req('GET', '/api/admin/orders', null, auth);
    assert.equal(admin.json.find((x) => x.id === id).email, 'sent');
  });

  await t.test('declined payment sends nothing', async () => {
    const before = sent.length;
    const { id, tok } = await buy(['book3']);
    await req('POST', '/api/mock/complete', { id, t: tok, result: 'failed' });
    await settle();
    assert.equal(sent.length, before);
  });

  await t.test('free gift order is emailed too', async () => {
    const before = sent.length;
    await buy(['bundle-all'], 'GIFT100');
    await settle();
    assert.equal(sent.length, before + 1);
    assert.match(sent.at(-1).body.subject, /هديتك/);
    assert.match(sent.at(-1).body.html, /مجانًا/);
  });

  await t.test('a failed send is recorded and can be resent from admin', async () => {
    failNext = true;
    const { id, tok } = await buy(['book1']);
    await req('POST', '/api/mock/complete', { id, t: tok, result: 'success' });
    await settle();
    let admin = await req('GET', '/api/admin/orders', null, auth);
    assert.equal(admin.json.find((x) => x.id === id).email, 'failed');
    const r = await req('POST', `/api/admin/orders/${id}/resend-email`, null, auth);
    assert.equal(r.status, 200);
    assert.equal(r.json.email.status, 'sent');
    assert.equal((await req('POST', `/api/admin/orders/${id}/resend-email`)).status, 401);
  });

  await t.test('Brevo is used when its key is set instead', async () => {
    delete process.env.RESEND_API_KEY;
    process.env.BREVO_API_KEY = 'xkeysib-test';
    const { id, tok } = await buy(['book1']);
    await req('POST', '/api/mock/complete', { id, t: tok, result: 'success' });
    await settle();
    const m = sent.at(-1);
    assert.match(m.url, /api\.brevo\.com/);
    assert.equal(m.headers['api-key'], 'xkeysib-test');
    assert.deepEqual(m.body.sender, { name: 'إسراءيل', email: 'books@example.com' });
    assert.equal(m.body.to[0].email, customer.email);
    assert.equal(m.body.replyTo.email, 'author@example.com');
  });
});
