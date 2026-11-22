const os = require('os');
const fs = require('fs');
const path = require('path');

function setupEnv(extra) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bookstore-'));
  Object.assign(process.env, { DB_PATH: path.join(tmp, 'db.json'), BOOKS_DIR: path.join(tmp, 'books'), NODE_ENV: 'test', ADMIN_PASSWORD: 'secret-admin' }, extra);
  require('../scripts/make-sample-pdfs.js');
}

async function start(app) {
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const req = async (method, url, body, headers = {}) => {
    const res = await fetch(base + url, {
      method, redirect: 'manual',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json; try { json = JSON.parse(text); } catch { json = null; }
    return { status: res.status, json, text, headers: res.headers };
  };
  return { server, base, req };
}

const customer = { name: 'Test Buyer', email: 'buyer@example.com', phone: '01012345678' };
module.exports = { setupEnv, start, customer };
