// Paymob (Egypt) — Unified Intention API + HMAC verification.
// Docs: https://developers.paymob.com/egypt
const crypto = require('crypto');

const BASE = process.env.PAYMOB_BASE_URL || 'https://accept.paymob.com';

// Field order defined by Paymob for the transaction HMAC (alphabetical).
const HMAC_FIELDS = [
  'amount_cents', 'created_at', 'currency', 'error_occured', 'has_parent_transaction', 'id',
  'integration_id', 'is_3d_secure', 'is_auth', 'is_capture', 'is_refunded', 'is_standalone_payment',
  'is_voided', 'order.id', 'owner', 'pending', 'source_data.pan', 'source_data.sub_type',
  'source_data.type', 'success',
];

const str = (v) => (v === undefined || v === null ? '' : typeof v === 'boolean' ? String(v) : String(v));
const get = (obj, p) => p.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);

function safeEqual(a, b) {
  const ba = Buffer.from(String(a || ''), 'utf8');
  const bb = Buffer.from(String(b || ''), 'utf8');
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

function sign(concatenated, secret) {
  return crypto.createHmac('sha512', secret).update(concatenated).digest('hex');
}

/** Server-to-server "transaction processed" callback (POST JSON, hmac in query string). */
function verifyProcessedCallback(obj, hmac, secret = process.env.PAYMOB_HMAC_SECRET) {
  const concatenated = HMAC_FIELDS.map((f) => str(get(obj, f))).join('');
  return safeEqual(sign(concatenated, secret), hmac);
}

/** Browser "transaction response" redirect (GET query params). `order.id` is sent as `order`. */
function verifyRedirectQuery(query, secret = process.env.PAYMOB_HMAC_SECRET) {
  const concatenated = HMAC_FIELDS.map((f) => str(query[f === 'order.id' ? 'order' : f])).join('');
  return safeEqual(sign(concatenated, secret), query.hmac);
}

/** Create a payment intention and return the hosted checkout URL. */
async function createCheckout(order, baseUrl) {
  const integrationIds = String(process.env.PAYMOB_INTEGRATION_IDS || '')
    .split(',').map((s) => parseInt(s.trim(), 10)).filter(Boolean);
  if (!process.env.PAYMOB_SECRET_KEY || !process.env.PAYMOB_PUBLIC_KEY || integrationIds.length === 0)
    throw new Error('Paymob is not configured (PAYMOB_SECRET_KEY / PAYMOB_PUBLIC_KEY / PAYMOB_INTEGRATION_IDS)');

  const [first, ...rest] = order.customer.name.trim().split(/\s+/);
  const amountCents = order.total * 100;
  const body = {
    amount: amountCents,
    currency: 'EGP',
    payment_methods: integrationIds,
    special_reference: order.id,
    notification_url: `${baseUrl}/api/paymob/callback`,
    redirection_url: `${baseUrl}/api/paymob/return`,
    // Single line item = order total, so discounts always add up exactly.
    items: [{ name: 'كتب إلكترونية', amount: amountCents, description: order.lines.map((l) => l.title).join(' + ').slice(0, 250), quantity: 1 }],
    billing_data: {
      first_name: first || 'NA', last_name: rest.join(' ') || 'NA',
      email: order.customer.email, phone_number: order.customer.phone,
      apartment: 'NA', street: 'NA', building: 'NA', floor: 'NA',
      city: 'NA', state: 'NA', country: 'EG',
    },
    extras: { order_id: order.id },
  };

  const res = await fetch(`${BASE}/v1/intention/`, {
    method: 'POST',
    headers: { Authorization: `Token ${process.env.PAYMOB_SECRET_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.client_secret) {
    throw new Error(`Paymob intention failed (${res.status}): ${JSON.stringify(data).slice(0, 500)}`);
  }
  return {
    intentionId: data.id,
    orderId: data.intention_order_id,
    url: `${BASE}/unifiedcheckout/?publicKey=${encodeURIComponent(process.env.PAYMOB_PUBLIC_KEY)}&clientSecret=${encodeURIComponent(data.client_secret)}`,
  };
}

module.exports = { createCheckout, verifyProcessedCallback, verifyRedirectQuery, HMAC_FIELDS, sign };
