const os = require('os');
const fs = require('fs');
const path = require('path');

function setupEnv(extra) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bookstore-'));
  Object.assign(process.env, { DB_PATH: path.join(tmp, 'db.json'), BOOKS_DIR: path.join(tmp, 'books'), NODE_ENV: 'test', ADMIN_PASSWORD: 'secret-admin', SHOW_USD: 'false', PROMOS_FILE: path.join(__dirname, 'fixtures', 'promos.json') }, extra);
  // Run the whole suite against PostgreSQL with: TEST_DATABASE_URL=postgres://... npm test
  if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  require('../scripts/make-sample-pdfs.js');
}

async function start(app) {
  await app.ready;
  const server = app.listen(0);
  server.on('close', () => app.store.end && app.store.end());
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const req = async (method, url, body, headers = {}) => {
    const res = await fetch(base + url, {
      method, redirect: 'manual',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    const buf = Buffer.from(await res.arrayBuffer());
    const text = buf.toString('utf8');
    let json; try { json = JSON.parse(text); } catch { json = null; }
    return { status: res.status, json, text, buf, headers: res.headers };
  };
  return { server, base, req };
}

const customer = { name: 'Test Buyer', email: 'buyer@example.com', phone: '01012345678' };
module.exports = { setupEnv, start, customer };
