/* Dalal Street League (DSL) by FinDeependence · Created by CA Deep Dalal
   Game engine: contest catalogue, prize and commission maths, portfolio scoring, dates. Tested in test/engine.test.js. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else { root.DSL = root.DSL || {}; root.DSL.E = factory(); }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var E = {};

  E.MIN_STOCKS = 3;
  E.DURATIONS = { day: 'Daily', week: 'Weekly', month: 'Monthly' };
  // In-game coins for each entry amount (1 coin = Rs 1 of virtual buying power).
  E.COINS = { 49: 50000, 99: 100000, 199: 200000, 499: 500000, 1000: 1000000 };
  // 1 vs 1: fixed winner prize. DSL commission = both entries minus the prize.
  E.H2H_PRIZE = { 49: 90, 99: 180, 199: 360, 499: 900, 1000: 1800 };
  // Leagues: commission (rake) is taken first, the rest is split by rank. split = [fromRank, toRank, share of prize pool for EACH rank].
  E.KINDS = {
    h2h: { label: '1 vs 1', size: 2, entries: [49, 99, 199, 499, 1000] },
    l10: { label: 'League of 10', size: 10, entries: [49, 99, 199, 499], rake: 0.15, split: [[1, 1, 0.5], [2, 2, 0.3], [3, 3, 0.2]] },
    m50: { label: 'Mega League 50', size: 50, entries: [49, 99, 199, 499], rake: 0.20, split: [[1, 1, 0.28], [2, 2, 0.16], [3, 3, 0.10], [4, 10, 0.04], [11, 15, 0.036]] }
  };

  // Prize table for a full contest. prizes[i] = whole-rupee prize for rank i+1.
  E.prizeTable = function (kind, entry) {
    var k = E.KINDS[kind];
    if (!k || k.entries.indexOf(entry) < 0) throw new Error('Unknown contest ' + kind + ' ' + entry);
    var gross = entry * k.size, prizes = [], bands = [], i;
    for (i = 0; i < k.size; i++) prizes.push(0);
    if (kind === 'h2h') {
      prizes[0] = E.H2H_PRIZE[entry];
      bands.push({ from: 1, to: 1, each: prizes[0] });
    } else {
      var pool = Math.floor(gross * (1 - k.rake));
      k.split.forEach(function (b) {
        var each = Math.floor(pool * b[2]);
        for (var r = b[0]; r <= b[1]; r++) prizes[r - 1] = each;
        bands.push({ from: b[0], to: b[1], each: each });
      });
    }
    var total = prizes.reduce(function (a, b) { return a + b; }, 0);
    return { kind: kind, entry: entry, size: k.size, gross: gross, prizes: prizes, bands: bands, prizeTotal: total, commission: gross - total, winners: prizes.filter(function (p) { return p > 0; }).length };
  };

  var r2 = function (n) { return Math.round(n * 100) / 100; };
  E.r2 = r2;

  // Rank players by final portfolio value (highest first). Players with the same value share the prizes of the ranks they cover.
  // Whatever cannot be split into whole rupees stays with DSL, so commission never goes below the designed amount.
  E.settle = function (kind, entry, values) {
    var t = E.prizeTable(kind, entry);
    if (values.length !== t.size) throw new Error('Contest needs ' + t.size + ' players, got ' + values.length);
    var order = values.map(function (v, i) { return { idx: i, value: r2(v) }; }).sort(function (a, b) { return b.value - a.value || a.idx - b.idx; });
    var rows = [], paid = 0, i = 0;
    while (i < order.length) {
      var j = i;
      while (j + 1 < order.length && order[j + 1].value === order[i].value) j++;
      var sum = 0, n = j - i + 1, p;
      for (p = i; p <= j; p++) sum += t.prizes[p];
      var each = Math.floor(sum / n);
      for (p = i; p <= j; p++) { rows.push({ idx: order[p].idx, value: order[p].value, rank: i + 1, tied: n > 1, prize: each }); paid += each; }
      i = j + 1;
    }
    return { rows: rows, paid: paid, commission: t.gross - paid, gross: t.gross };
  };

  // ---- Portfolio ----
  // holdings: [{ s: symbol, q: whole shares, p: buy price }]
  E.cost = function (holdings) { return r2(holdings.reduce(function (a, h) { return a + h.q * h.p; }, 0)); };
  E.value = function (holdings, cash, px) {
    return r2(holdings.reduce(function (a, h) { var c = px && px[h.s] > 0 ? px[h.s] : h.p; return a + h.q * c; }, cash));
  };
  E.returnPct = function (value, coins) { return r2((value / coins - 1) * 100); };
  E.validate = function (holdings, coins) {
    if (holdings.some(function (h) { return !(h.q > 0) || h.q !== Math.floor(h.q) || !(h.p > 0); })) return 'Every stock needs a whole number of shares.';
    if (holdings.length < E.MIN_STOCKS) return 'Pick at least ' + E.MIN_STOCKS + ' different stocks.';
    if (E.cost(holdings) > coins + 1e-9) return 'Your picks cost more coins than you have.';
    return null;
  };

  // ---- Dates (IST calendar days as YYYY-MM-DD) ----
  var toD = function (s) { return new Date(s + 'T00:00:00Z'); };
  var toS = function (d) { return d.toISOString().slice(0, 10); };
  E.istToday = function (now) { return toS(new Date((now == null ? Date.now() : +now) + 5.5 * 3600e3)); };
  E.addDays = function (s, n) { var d = toD(s); d.setUTCDate(d.getUTCDate() + n); return toS(d); };
  E.isWeekday = function (s) { var w = toD(s).getUTCDay(); return w !== 0 && w !== 6; };
  E.onOrAfterWeekday = function (s) { while (!E.isWeekday(s)) s = E.addDays(s, 1); return s; };
  E.onOrBeforeWeekday = function (s) { while (!E.isWeekday(s)) s = E.addDays(s, -1); return s; };
  E.nextWeekday = function (s) { return E.onOrAfterWeekday(E.addDays(s, 1)); };
  // Last day of a contest joined on `today`. Winners are decided on that day's closing prices.
  E.endDate = function (today, duration) {
    if (duration === 'day') return E.nextWeekday(today);
    if (duration === 'week') return E.onOrAfterWeekday(E.addDays(today, 7));
    if (duration === 'month') return E.onOrAfterWeekday(E.addDays(today, 30));
    throw new Error('Unknown duration ' + duration);
  };
  // First day with closing prices on or after the end date (covers market holidays).
  E.settleDate = function (end, dates) {
    var d = dates.filter(function (x) { return x >= end; }).sort();
    return d.length ? d[0] : null;
  };

  // ---- Deterministic random (simulated opponents and demo price days) ----
  E.rng = function (seed) {
    var a = seed >>> 0;
    return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  };
  E.hash = function (str) { var h = 2166136261; for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
  var tick = function (n) { return Math.max(0.05, Math.round(n * 20) / 20); };
  E.tick = tick;

  // A simulated opponent: 3 to 8 random stocks, random weights, whole shares, never over budget.
  E.botHoldings = function (coins, px, rand) {
    var syms = Object.keys(px).filter(function (s) { return px[s] > 0 && px[s] <= coins / 4; });
    var n = Math.min(syms.length, 3 + Math.floor(rand() * 6)), pick = [], w = [], tot = 0, i;
    while (pick.length < n) { var s = syms[Math.floor(rand() * syms.length)]; if (pick.indexOf(s) < 0) pick.push(s); }
    for (i = 0; i < n; i++) { w.push(0.5 + rand()); tot += w[i]; }
    var invest = coins * (0.85 + rand() * 0.15), holdings = [];
    for (i = 0; i < n; i++) {
      var q = Math.floor(invest * w[i] / tot / px[pick[i]]);
      if (q < 1) q = 1;
      holdings.push({ s: pick[i], q: q, p: px[pick[i]] });
    }
    while (E.cost(holdings) > coins) { // trim the largest position until it fits
      holdings.sort(function (a, b) { return b.q * b.p - a.q * a.p; });
      if (holdings[0].q > 1) holdings[0].q--; else holdings.shift();
    }
    return { holdings: holdings, cash: r2(coins - E.cost(holdings)) };
  };

  // Demo only: next day's closing prices as a random move of up to about 3% per stock.
  E.simulateDay = function (px, rand) {
    var out = {};
    Object.keys(px).forEach(function (s) { out[s] = tick(px[s] * (1 + (rand() * 2 - 1) * 0.03)); });
    return out;
  };

  // Sample prices used until the first real price sync has run. Clearly labelled in the app.
  E.samplePrices = function (universe, today) {
    var last = E.onOrBeforeWeekday(today), prev = E.onOrBeforeWeekday(E.addDays(last, -1)), closes = {};
    closes[last] = {}; closes[prev] = {};
    universe.forEach(function (u) {
      closes[last][u.s] = u.p;
      closes[prev][u.s] = tick(u.p * (1 + (E.rng(E.hash(u.s))() * 2 - 1) * 0.015));
    });
    return { source: 'sample', updated: null, closes: closes, quotes: null };
  };

  // One view of prices for the app: real closes (plus demo days), and delayed quotes when they are newer than the last close.
  E.priceView = function (prices, sim) {
    var closes = {}, simDates = {}, d;
    for (d in (sim || {})) { closes[d] = sim[d]; simDates[d] = true; }
    for (d in prices.closes) { closes[d] = prices.closes[d]; delete simDates[d]; }
    var dates = Object.keys(closes).sort(), last = dates[dates.length - 1], prevD = dates[dates.length - 2];
    var q = prices.quotes, live = !!(q && q.date > last && q.px), px = {}, prev = {}, s;
    for (s in closes[last]) px[s] = closes[last][s];
    if (live) { for (s in q.px) if (q.px[s] > 0) px[s] = q.px[s]; prev = closes[last]; }
    else if (prevD) prev = closes[prevD];
    return { closes: closes, dates: dates, last: last, px: px, prev: prev, live: live, quoteTime: live ? q.time : null, simDates: simDates, sample: prices.source === 'sample' };
  };

  return E;
});
