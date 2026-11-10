const test = require('node:test');
const assert = require('node:assert');
const E = require('../site/js/engine.js');
const U = require('../site/data/universe.js');
const L = require('../scripts/prices-lib.js');

const all = [];
for (const k in E.KINDS) for (const e of E.KINDS[k].entries) all.push([k, e]);

test('the example from the brief: Rs 49 entry, 50,000 coins, winner gets Rs 90', () => {
  const t = E.prizeTable('h2h', 49);
  assert.equal(E.COINS[49], 50000); assert.equal(t.prizes[0], 90); assert.equal(t.commission, 8);
});

test('every contest: DSL commission is positive, every prize is a whole rupee above the entry', () => {
  for (const [k, e] of all) {
    const t = E.prizeTable(k, e);
    assert.equal(t.prizeTotal + t.commission, t.gross);
    assert.ok(t.commission > 0, `${k} ${e}`);
    assert.ok(E.COINS[e] > 0);
    for (const p of t.prizes) { assert.equal(p, Math.floor(p)); if (p) assert.ok(p > e, `${k} ${e} prize ${p}`); }
    for (let i = 1; i < t.prizes.length; i++) assert.ok(t.prizes[i] <= t.prizes[i - 1]);
  }
  assert.equal(E.prizeTable('m50', 99).winners, 15);
  assert.equal(E.prizeTable('l10', 99).winners, 3);
});

test('settlement pays exactly the prize table when there are no ties', () => {
  for (const [k, e] of all) {
    const t = E.prizeTable(k, e), values = Array.from({ length: t.size }, (_, i) => 1000 + i);
    const r = E.settle(k, e, values);
    assert.equal(r.paid, t.prizeTotal); assert.equal(r.commission, t.commission);
    assert.equal(r.rows[0].idx, t.size - 1); assert.equal(r.rows[0].rank, 1); assert.equal(r.rows[0].prize, t.prizes[0]);
  }
});

test('ties share prizes, money always adds up and commission never drops below the designed amount', () => {
  const r = E.settle('h2h', 49, [50000, 50000]);
  assert.deepEqual(r.rows.map((x) => x.prize), [45, 45]); assert.equal(r.commission, 8);
  const rand = E.rng(7);
  for (let n = 0; n < 400; n++) {
    const [k, e] = all[Math.floor(rand() * all.length)], t = E.prizeTable(k, e);
    const values = Array.from({ length: t.size }, () => 100 + Math.floor(rand() * 6)); // many ties
    const s = E.settle(k, e, values);
    assert.equal(s.rows.length, t.size);
    assert.equal(s.rows.reduce((a, x) => a + x.prize, 0), s.paid);
    assert.equal(s.paid + s.commission, t.gross);
    assert.ok(s.commission >= t.commission);
    for (const a of s.rows) for (const b of s.rows) { if (a.value > b.value) assert.ok(a.prize >= b.prize && a.rank < b.rank); if (a.value === b.value) assert.equal(a.prize, b.prize); }
  }
});

test('portfolio value, return and validation', () => {
  const h = [{ s: 'A', q: 10, p: 100 }, { s: 'B', q: 5, p: 200 }, { s: 'C', q: 1, p: 50 }];
  assert.equal(E.cost(h), 2050);
  assert.equal(E.value(h, 950, { A: 110, B: 190, C: 50 }), 1100 + 950 + 50 + 950);
  assert.equal(E.value(h, 0, { A: 110 }), 1100 + 1000 + 50); // a missing close falls back to the buy price
  assert.equal(E.returnPct(3090, 3000), 3);
  assert.equal(E.validate(h, 3000), null);
  assert.match(E.validate(h.slice(0, 2), 3000), /at least 3/);
  assert.match(E.validate(h, 2000), /more coins/);
  assert.match(E.validate([{ s: 'A', q: 1.5, p: 1 }, h[1], h[2]], 3000), /whole number/);
});

test('contest dates skip weekends and settle on the first close on or after the end date', () => {
  assert.equal(E.endDate('2026-11-10', 'day'), '2026-11-11');   // Tue -> Wed
  assert.equal(E.endDate('2026-11-13', 'day'), '2026-11-16');   // Fri -> Mon
  assert.equal(E.endDate('2026-11-14', 'day'), '2026-11-16');   // Sat -> Mon
  assert.equal(E.endDate('2026-11-10', 'week'), '2026-11-17');
  assert.equal(E.endDate('2026-11-08', 'week'), '2026-11-16');  // Sun + 7 = Sun -> Mon
  assert.equal(E.endDate('2026-11-10', 'month'), '2026-12-10');
  assert.equal(E.settleDate('2026-11-11', ['2026-11-09', '2026-11-10']), null);
  assert.equal(E.settleDate('2026-11-11', ['2026-11-10', '2026-11-12', '2026-11-13']), '2026-11-12'); // holiday on the 11th
  assert.equal(E.istToday(Date.UTC(2026, 10, 10, 19, 0)), '2026-11-11'); // 00:30 IST next day
});

test('simulated opponents always hold a valid portfolio within budget', () => {
  const px = {}; U.forEach((u) => { px[u.s] = u.p; });
  const rand = E.rng(42);
  for (const coins of Object.values(E.COINS)) for (let i = 0; i < 200; i++) {
    const b = E.botHoldings(coins, px, rand);
    assert.equal(E.validate(b.holdings, coins), null);
    assert.ok(b.cash >= 0); assert.equal(E.r2(b.cash + E.cost(b.holdings)), coins);
  }
});

test('price view: real closes win over simulated days, delayed quotes only when newer than the last close', () => {
  const prices = { source: 'nse', closes: { '2026-11-09': { A: 100 }, '2026-11-10': { A: 110 } }, quotes: { date: '2026-11-10', time: 't', px: { A: 999 } } };
  let v = E.priceView(prices, { '2026-11-10': { A: 1 }, '2026-11-11': { A: 120 } });
  assert.equal(v.closes['2026-11-10'].A, 110); assert.equal(v.last, '2026-11-11'); assert.deepEqual(Object.keys(v.simDates), ['2026-11-11']); assert.equal(v.live, false);
  prices.quotes.date = '2026-11-11';
  v = E.priceView(prices, {});
  assert.equal(v.live, true); assert.equal(v.px.A, 999); assert.equal(v.prev.A, 110);
  const s = E.priceView(E.samplePrices(U, '2026-11-14'), {});
  assert.equal(s.sample, true); assert.equal(s.last, '2026-11-13'); assert.equal(Object.keys(s.px).length, U.length);
});

test('stock list has unique symbols and sample prices', () => {
  assert.equal(new Set(U.map((u) => u.s)).size, U.length);
  for (const u of U) assert.ok(u.s && u.n && u.sec && u.p > 0);
});

test('NSE bhavcopy parser reads official closes for the wanted symbols', () => {
  const csv = 'SYMBOL, SERIES, DATE1, PREV_CLOSE, OPEN_PRICE, HIGH_PRICE, LOW_PRICE, LAST_PRICE, CLOSE_PRICE, AVG_PRICE, TTL_TRD_QNTY, TURNOVER_LACS, NO_OF_TRADES, DELIV_QTY, DELIV_PER\n' +
    'RELIANCE, EQ, 10-Nov-2026, 1280.00, 1285.00, 1299.00, 1281.10, 1291.00, 1290.55, 1290.10, 5000000, 64505.00, 150000, 2500000, 50.00\n' +
    'RELIANCE, BL, 10-Nov-2026, 1280.00, 1285.00, 1285.00, 1285.00, 1285.00, 1285.00, 1285.00, 100, 1.28, 1, -, -\n' +
    'M&M, EQ, 10-Nov-2026, 3040.00, 3050.00, 3070.00, 3030.00, 3055.00, 3052.30, 3050.00, 900000, 27450.00, 60000, 400000, 44.44\n' +
    'SOMEBOND, N1, 10-Nov-2026, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 10, 0.1, 1, 10, 100\n' +
    'OTHER, EQ, 10-Nov-2026, 10, 10, 10, 10, 10, 10.5, 10, 10, 0.1, 1, 10, 100\n';
  const r = L.parseBhavcopy(csv, ['RELIANCE', 'M&M']);
  assert.equal(r.date, '2026-11-10');
  assert.deepEqual(r.closes, { RELIANCE: 1290.55, 'M&M': 3052.3 });
  assert.throws(() => L.parseBhavcopy('<html>Access denied</html>\nx', null));
  assert.equal(L.bhavUrl('2026-11-10'), 'https://nsearchives.nseindia.com/products/content/sec_bhavdata_full_10112026.csv');
  assert.deepEqual(L.parseYahooChart({ chart: { result: [{ meta: { regularMarketPrice: 1290.549, regularMarketTime: 1794300000 } }] } }), { price: 1290.55, time: 1794300000000 });
  assert.equal(L.parseYahooChart({ chart: { result: null } }), null);
});

test('database contest catalogue (supabase/setup.sql) matches the engine', () => {
  const sql = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'supabase', 'setup.sql'), 'utf8');
  const block = sql.split('-- TYPES-BEGIN')[1].split('-- TYPES-END')[0].trim().split('\n').map((l) => l.trim().replace(/,$/, ''));
  const want = all.map(([k, e]) => { const t = E.prizeTable(k, e); return `('${k}', ${e}, ${t.size}, ${E.COINS[e]}, '${JSON.stringify(t.prizes)}'::jsonb, ${t.commission})`; });
  assert.deepEqual(block, want);
});

test('settlement job: settles full contests with engine results, cancels unfilled ones, skips contests without a closing day', async () => {
  const { settleAll } = require('../scripts/settle.js');
  const calls = [];
  const entries = { 1: [{ id: 11, holdings: [{ s: 'A', q: 10, p: 100 }], cash: 49000 }, { id: 12, holdings: [{ s: 'B', q: 10, p: 100 }], cash: 49000 }] };
  const db = {
    select: async (p) => {
      if (p.startsWith('dsl_prices?select=d&')) return [{ d: '2026-11-10' }, { d: '2026-11-12' }];
      if (p.startsWith('dsl_contests')) return [{ id: 1, kind: 'h2h', entry: 49, size: 2, end_date: '2026-11-11', status: 'live' }, { id: 2, kind: 'l10', entry: 99, size: 10, end_date: '2026-11-12', status: 'open' }];
      if (p.startsWith('dsl_prices?select=closes&d=eq.2026-11-12')) return [{ closes: { A: 90, B: 120 } }];
      if (p.startsWith('dsl_entries') && p.includes('contest_id=eq.1')) return entries[1];
      throw new Error('unexpected ' + p);
    },
    rpc: async (fn, args) => { calls.push([fn, args]); return fn === 'dsl_cancel_contest' ? 1 : { paid: 90, commission: 8 }; }
  };
  const out = await settleAll(db, () => {});
  assert.deepEqual(out, { settled: 1, cancelled: 1, failed: 0 });
  assert.deepEqual(calls[0], ['dsl_apply_settlement', { p_cid: 1, p_date: '2026-11-12', p_rows: [{ entry_id: 12, value: 50200, rank: 1, prize: 90 }, { entry_id: 11, value: 49900, rank: 2, prize: 0 }] }]);
  assert.deepEqual(calls[1], ['dsl_cancel_contest', { p_cid: 2 }]);
});
