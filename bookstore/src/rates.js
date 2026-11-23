// Approximate US-dollar price shown under the Egyptian-pound price (payment is always in EGP).
// Fetched on the server, cached for 6 hours; a second free source is used if the first fails.
// Set SHOW_USD=false to turn the dollar price off.
const SOURCES = [
  {
    name: 'ExchangeRate-API',
    url: 'https://open.er-api.com/v6/latest/USD',
    pick: (d) => d && d.result === 'success' && d.rates && d.rates.EGP,
    // Their free tier asks for this credit wherever the rates are used.
    attribution: { text: 'Rates By Exchange Rate API', href: 'https://www.exchangerate-api.com' },
  },
  {
    name: 'currency-api',
    url: 'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json',
    pick: (d) => d && d.usd && d.usd.egp,
    attribution: null,
  },
];

const FRESH_MS = 6 * 60 * 60 * 1000;
const RETRY_MS = 15 * 60 * 1000;
let cache = null; // { egpPerUsd, at, source, attribution }
let lastTry = 0;
let inflight = null;

const enabled = () => process.env.SHOW_USD !== 'false';

async function fetchRate() {
  for (const s of SOURCES) {
    try {
      const res = await fetch(s.url, { signal: AbortSignal.timeout(5000), headers: { accept: 'application/json' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const rate = Number(s.pick(await res.json()));
      // Sanity check: ignore obviously broken numbers.
      if (!(rate > 1 && rate < 10000)) throw new Error(`bad rate ${rate}`);
      return { egpPerUsd: rate, at: new Date().toISOString(), source: s.name, attribution: s.attribution };
    } catch (e) {
      console.warn(`[rates] ${s.name} failed: ${e.message}`);
    }
  }
  return null;
}

function refresh() {
  if (!inflight) {
    lastTry = Date.now();
    inflight = fetchRate().then((r) => { if (r) cache = r; return cache; }).finally(() => { inflight = null; });
  }
  return inflight;
}

/** Current rate, or null if none is available. Never makes a page wait more than ~2.5s. */
async function usdRate() {
  if (!enabled()) return null;
  const stale = !cache || Date.now() - Date.parse(cache.at) > FRESH_MS;
  const first = lastTry === 0;
  // After a failed attempt, wait 15 minutes before trying again (pages never wait on a retry).
  if (stale && (first || Date.now() - lastTry > RETRY_MS)) {
    const job = refresh();
    if (first) await Promise.race([job, new Promise((r) => setTimeout(r, 2500))]);
  }
  return cache;
}

module.exports = { usdRate, _reset: () => { cache = null; lastTry = 0; inflight = null; } };
