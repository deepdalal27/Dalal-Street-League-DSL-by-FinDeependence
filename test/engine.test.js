const test = require('node:test');
const assert = require('node:assert');
const E = require('../site/js/engine.js');
const U = require('../site/data/universe.js');
const L = require('../scripts/prices-lib.js');

const DUR = ['day', 'week', 'month'];
const every = (fn) => { for (const d of DUR) for (const e of E.ENTRIES) for (let n = E.MIN_SIZE; n <= E.MAX_SIZE; n++) fn(E.prizePlan(n, e, d), n, e, d); };

test('commission: lower for longer contests, higher with more players, never below the designed rate', () => {
  assert.equal(E.rakeBp(2, 'day'), 1200); assert.equal(E.rakeBp(2, 'week'), 1000); assert.equal(E.rakeBp(2, 'month'), 800);
  assert.equal(E.rakeBp(10, 'day'), 1400); assert.equal(E.rakeBp(50, 'day'), 1700); assert.equal(E.rakeBp(100, 'month'), 1400);
  for (const d of DUR) for (let n = 3; n <= 100; n++) assert.ok(E.rakeBp(n, d) >= E.rakeBp(n - 1, d));
  every((t, n, e, d) => {
    assert.equal(t.prizeTotal + t.commission, t.gross);
    assert.ok(t.commission >= t.minCommission && t.minCommission >= t.gross * E.rakeBp(n, d) / 10000, `${n} ${e} ${d}`);
    assert.ok(t.commission > 0);
  });
  // more players in the same contest: DSL earns more in rupees
  for (const d of DUR) for (const e of E.ENTRIES) for (let n = 3; n <= 100; n++) assert.ok(E.prizePlan(n, e, d).commission > E.prizePlan(n - 1, e, d).commission, `${n} ${e} ${d}`);
});

test('prize plan: about 40% win, every prize beats the entry, harder finishes pay more than a 1 vs 1 win', () => {
  every((t, n, e, d) => {
    const h2h = E.prizePlan(2, e, d).prizes[0];
    for (let i = 0; i < n; i++) {
      assert.equal(t.prizes[i], Math.floor(t.prizes[i]));
      if (i) assert.ok(t.prizes[i] <= t.prizes[i - 1]);
      if (t.prizes[i]) assert.ok(t.prizes[i] > e, `${n} ${e} ${d} rank ${i + 1}`);
    }
    assert.equal(t.prizes.filter((p) => p > 0).length, t.winners);
    if (n >= 4) assert.ok(t.winners >= Math.floor(0.4 * n) && t.winners <= Math.ceil(0.4 * n) + 1, `${n} winners ${t.winners}`);
    if (n >= 3) { const top = Math.max(1, Math.floor((2 * n + 5) / 10)); for (let i = 0; i < top; i++) assert.ok(t.prizes[i] > h2h, `${n} ${e} ${d}: rank ${i + 1} must beat the 1 vs 1 prize`); }
  });
  assert.equal(E.prizePlan(10, 99, 'day').winners, 4); assert.equal(E.prizePlan(50, 99, 'day').winners, 20);
});

test('longer contests pay the players more', () => {
  for (const e of E.ENTRIES) for (let n = 2; n <= 100; n++) {
    const d = E.prizePlan(n, e, 'day'), w = E.prizePlan(n, e, 'week'), m = E.prizePlan(n, e, 'month');
    assert.ok(d.prizes[0] < w.prizes[0] && w.prizes[0] < m.prizes[0], `${n} ${e}`);
    assert.ok(d.prizeTotal < w.prizeTotal && w.prizeTotal < m.prizeTotal);
  }
  assert.deepEqual(DUR.map((d) => E.prizePlan(2, 49, d).prizes[0]), [86, 88, 90]);
  assert.equal(E.COINS[49], 50000);
});

test('settlement pays exactly the prize plan when there are no ties', () => {
  every((t, n, e, d) => {
    if (n > 12 && n % 9) return;
    const r = E.settle(e, d, Array.from({ length: n }, (_, i) => 1000 + i));
    assert.equal(r.paid, t.prizeTotal); assert.equal(r.commission, t.commission);
    assert.equal(r.rows[0].idx, n - 1); assert.equal(r.rows[0].rank, 1); assert.equal(r.rows[0].prize, t.prizes[0]);
  });
});

test('ties share prizes, money always adds up and commission never drops below the designed amount', () => {
  const r = E.settle(49, 'day', [50000, 50000]);
  assert.deepEqual(r.rows.map((x) => x.prize), [43, 43]); assert.equal(r.commission, 12);
  const rand = E.rng(7);
  for (let k = 0; k < 600; k++) {
    const e = E.ENTRIES[Math.floor(rand() * E.ENTRIES.length)], d = DUR[Math.floor(rand() * 3)], n = 2 + Math.floor(rand() * 99), t = E.prizePlan(n, e, d);
    const values = Array.from({ length: n }, () => 100 + Math.floor(rand() * 6)); // many ties
    const s = E.settle(e, d, values);
    assert.equal(s.rows.length, n);
    assert.equal(s.rows.reduce((a, x) => a + x.prize, 0), s.paid);
    assert.equal(s.paid + s.commission, t.gross);
    assert.ok(s.commission >= t.commission && s.paid <= t.pool);
    for (const a of s.rows) for (const b of s.rows) { if (a.value > b.value) assert.ok(a.prize >= b.prize && a.rank < b.rank); if (a.value === b.value) assert.equal(a.prize, b.prize); }
  }
});

test('entries close at 09:15 IST on the next weekday', () => {
  assert.equal(E.lockAt('2026-11-10').toISOString(), '2026-11-11T03:45:00.000Z');
  assert.equal(E.lockAt('2026-11-13').toISOString(), '2026-11-16T03:45:00.000Z');   // Friday -> Monday
  assert.equal(E.lockAt('2026-11-14').toISOString(), '2026-11-16T03:45:00.000Z');   // Saturday -> Monday
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

test('database fee and coin functions (supabase/setup.sql) match the engine', () => {
  const sql = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'supabase', 'setup.sql'), 'utf8');
  const fee = sql.split('function public.dsl_rake_bp')[1].split('$$;')[0];
  for (const d of DUR) assert.ok(fee.includes(`when '${d}' then ${E.RAKE_TIME[d]}`), d);
  const sizes = [...fee.matchAll(/when p_n <= (\d+) then (\d+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
  const last = Number(/else (\d+) end\);/.exec(fee)[1]);
  assert.deepEqual(sizes.concat([[100, last]]), E.RAKE_SIZE);
  const coins = sql.split('function public.dsl_coins')[1].split('$$;')[0];
  assert.deepEqual([...coins.matchAll(/when (\d+) then (\d+)/g)].map((m) => [Number(m[1]), Number(m[2])]), E.ENTRIES.map((e) => [e, E.COINS[e]]));
  assert.ok(sql.includes('entry in (' + E.ENTRIES.join(', ') + ')'));
});

test('settlement job: closes entries first, then settles live contests with engine results for the players who joined', async () => {
  const { settleAll } = require('../scripts/settle.js');
  const calls = [];
  const entries = [{ id: 11, holdings: [{ s: 'A', q: 10, p: 100 }], cash: 99000 }, { id: 12, holdings: [{ s: 'B', q: 10, p: 100 }], cash: 99000 }, { id: 13, holdings: [{ s: 'A', q: 20, p: 100 }], cash: 98000 }];
  const db = {
    select: async (p) => {
      if (p.startsWith('dsl_prices?select=d&')) return [{ d: '2026-11-10' }, { d: '2026-11-12' }];
      if (p.startsWith('dsl_contests')) { assert.ok(p.includes('status=eq.live')); return [{ id: 1, kind: 'l10', entry: 99, duration: 'week', joined: 3, end_date: '2026-11-11' }]; }
      if (p.startsWith('dsl_prices?select=closes&d=eq.2026-11-12')) return [{ closes: { A: 90, B: 120 } }];
      if (p.startsWith('dsl_entries') && p.includes('contest_id=eq.1')) return entries;
      throw new Error('unexpected ' + p);
    },
    rpc: async (fn, args) => { calls.push([fn, args]); return fn === 'dsl_lock_due' ? { started: 1, cancelled: 2 } : { paid: 264, commission: 33 }; }
  };
  const out = await settleAll(db, () => {});
  assert.deepEqual(out, { started: 1, settled: 1, cancelled: 2, failed: 0 });
  assert.equal(calls[0][0], 'dsl_lock_due');
  const prize = E.prizePlan(3, 99, 'week').prizes[0];
  assert.deepEqual(calls[1], ['dsl_apply_settlement', { p_cid: 1, p_date: '2026-11-12', p_rows: [{ entry_id: 12, value: 100200, rank: 1, prize }, { entry_id: 11, value: 99900, rank: 2, prize: 0 }, { entry_id: 13, value: 99800, rank: 3, prize: 0 }] }]);
});

test('NSE index list parser reads symbols, names, industry and the cap group', () => {
  const csv = '﻿Company Name,Industry,Symbol,Series,ISIN Code\r\n' +
    'Reliance Industries Ltd.,Oil Gas & Consumable Fuels,RELIANCE,EQ,INE002A01018\r\n' +
    '"Mahindra & Mahindra, Ltd.",Automobile and Auto Components,M&M,EQ,INE101A01026\r\n' +
    'Some Bond Ltd.,Financial Services,SOMEBOND,N1,INE000000000\r\n';
  assert.deepEqual(L.parseIndexCsv(csv, 'L'), [
    { s: 'RELIANCE', n: 'Reliance Industries', sec: 'Oil Gas & Consumable Fuels', c: 'L' },
    { s: 'M&M', n: 'Mahindra & Mahindra', sec: 'Automobile and Auto Components', c: 'L' }
  ]);
  assert.throws(() => L.parseIndexCsv('<html>blocked</html>', 'M'));
  assert.deepEqual(L.splitCsv('a,"b, c","d ""e"""'), ['a', 'b, c', 'd "e"']);
});

test('built-in stock list has unique symbols and a cap group for each', () => {
  for (const u of U) assert.ok(['L', 'M', 'S'].includes(u.c), u.s);
});
