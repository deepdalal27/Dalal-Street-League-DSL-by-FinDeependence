// Run by GitHub Actions: refreshes site/data/prices.json for Dalal Street League.
//   closes  -> official NSE closing prices by date (kept for 75 days; contests are settled on these)
//   quotes  -> delayed quotes during market hours (only used as the buying price)
//   site/data/universe.json -> the stocks players can pick (Nifty 500) with Large / Mid / Small cap, refreshed once a day
const fs = require('fs');
const path = require('path');
const E = require('../site/js/engine.js');
const FALLBACK = require('../site/data/universe.js');
const L = require('./prices-lib.js');
const DB = require('./supabase-lib.js');

const FILE = path.join(__dirname, '..', 'site', 'data', 'prices.json');
const UFILE = path.join(__dirname, '..', 'site', 'data', 'universe.json');
const KEEP_DAYS = 75, LOOK_BACK = 10;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  // 0. Stock list. Refreshed when it is a day old; on failure the last good list (or the built-in one) stays.
  const oldU = fs.existsSync(UFILE) ? JSON.parse(fs.readFileSync(UFILE, 'utf8')) : null;
  let U = oldU ? oldU.stocks : FALLBACK;
  if (!oldU || Date.now() - new Date(oldU.updated).getTime() > 20 * 3600e3) {
    try {
      const list = await L.fetchUniverse();
      if (list.length < 400) throw new Error('only ' + list.length + ' stocks');
      U = list;
      fs.writeFileSync(UFILE, JSON.stringify({ updated: new Date().toISOString(), source: 'NSE: Nifty 100 (Large), Nifty Midcap 150 (Mid), Nifty Smallcap 250 (Small)', stocks: list }));
      console.log(`Stock list: ${list.length} stocks (${['L', 'M', 'S'].map((c) => list.filter((u) => u.c === c).length).join(' / ')} large / mid / small)`);
    } catch (e) { console.log('Stock list not refreshed: ' + e.message); }
  }
  const old = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, 'utf8')) : {};
  // Keep pricing every stock priced before too, so portfolios already in contests can always be valued.
  const lastOld = old.closes ? Object.keys(old.closes).sort().pop() : null;
  const symbols = Array.from(new Set(U.map((u) => u.s).concat(lastOld ? Object.keys(old.closes[lastOld]) : [])));
  const data = { source: 'nse', updated: old.updated || null, closes: old.source === 'nse' && old.closes ? old.closes : {}, quotes: old.source === 'nse' ? old.quotes || null : null };
  const before = JSON.stringify(data);
  const today = E.istToday();
  let failed = 0;

  // 1. Official closes: any weekday in the last LOOK_BACK days that we do not have yet.
  for (let i = LOOK_BACK; i >= 0; i--) {
    const d = E.addDays(today, -i);
    if (!E.isWeekday(d) || data.closes[d]) continue;
    try {
      const r = await L.fetchBhavcopy(d, symbols);
      if (r) { data.closes[d] = r.closes; console.log(`${d}: ${Object.keys(r.closes).length} closing prices`); }
      else console.log(`${d}: no file (holiday or not published yet)`);
    } catch (e) { failed++; console.log(`${d}: failed, ${e.message}`); }
    await sleep(400);
  }
  // 1b. Stocks added to the list: fetch the latest two days again so they have a price and a day's change straight away.
  for (const d of Object.keys(data.closes).sort().slice(-2)) {
    const missing = symbols.filter((x) => !(data.closes[d][x] > 0)).length;
    if (missing < 20) continue;
    try { const r = await L.fetchBhavcopy(d, symbols); if (r) { data.closes[d] = Object.assign({}, data.closes[d], r.closes); console.log(`${d}: refreshed, ${Object.keys(data.closes[d]).length} closing prices`); } }
    catch (e) { console.log(`${d}: refresh failed, ${e.message}`); }
    await sleep(400);
  }
  for (const d of Object.keys(data.closes)) if (d < E.addDays(today, -KEEP_DAYS)) delete data.closes[d];
  const dates = Object.keys(data.closes).sort(), last = dates[dates.length - 1];

  // 2. Delayed quotes: only while today's official close is not in yet, on a weekday between 09:15 and 16:00 IST.
  const ist = new Date(Date.now() + 5.5 * 3600e3), mins = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  if (last && E.isWeekday(today) && last < today && mins >= 9 * 60 + 15 && mins <= 16 * 60) {
    const px = {}; let newest = 0;
    for (let i = 0; i < symbols.length; i += 16) {
      const res = await Promise.all(symbols.slice(i, i + 16).map((s) => L.fetchQuote(s).catch(() => null)));
      res.forEach((q, k) => { if (q && E.istToday(q.time) === today) { px[symbols[i + k]] = q.price; newest = Math.max(newest, q.time); } });
      await sleep(250);
    }
    const n = Object.keys(px).length;
    console.log(`quotes: ${n} of ${symbols.length}`);
    if (n >= symbols.length * 0.6) data.quotes = { date: today, time: new Date(newest).toISOString(), px };
  } else if (data.quotes && last && data.quotes.date <= last) data.quotes = null; // the official close replaces the day's quotes

  if (!dates.length) { console.log('No closing prices available; prices.json left unchanged.'); process.exit(failed ? 1 : 0); }
  if (JSON.stringify(data) !== before) {
    data.updated = new Date().toISOString();
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(data));
    console.log(`Saved. Latest close: ${last}. Days kept: ${dates.length}.`);
  } else console.log('No change.');

  // 3. Copy to the Supabase database the app reads: days it does not have yet, plus the latest three (in case NSE corrected a file).
  if (!DB.ready()) { console.log('SUPABASE_URL / SUPABASE_SERVICE_KEY not set; database not updated.'); return; }
  const have = new Set((await DB.select('dsl_prices?select=d')).map((r) => r.d));
  const send = dates.filter((d, i) => !have.has(d) || i >= dates.length - 3);
  await DB.upsert('dsl_prices', send.map((d) => ({ d, closes: data.closes[d] })));
  const q = data.quotes;
  await DB.upsert('dsl_quotes', [{ id: 1, d: q ? q.date : null, t: q ? q.time : null, px: q ? q.px : null }]);
  console.log(`Database: ${send.length} day(s) sent, quotes ${q ? 'as of ' + q.time : 'cleared'}.`);
})().catch((e) => { console.error(e); process.exit(1); });
