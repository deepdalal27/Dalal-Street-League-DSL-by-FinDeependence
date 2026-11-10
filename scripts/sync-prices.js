// Run by GitHub Actions: refreshes site/data/prices.json for Dalal Street League.
//   closes  -> official NSE closing prices by date (kept for 75 days; contests are settled on these)
//   quotes  -> delayed quotes during market hours (only used as the buying price)
const fs = require('fs');
const path = require('path');
const E = require('../site/js/engine.js');
const U = require('../site/data/universe.js');
const L = require('./prices-lib.js');

const FILE = path.join(__dirname, '..', 'site', 'data', 'prices.json');
const KEEP_DAYS = 75, LOOK_BACK = 10;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const symbols = U.map((u) => u.s);
  const old = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, 'utf8')) : {};
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
  for (const d of Object.keys(data.closes)) if (d < E.addDays(today, -KEEP_DAYS)) delete data.closes[d];
  const dates = Object.keys(data.closes).sort(), last = dates[dates.length - 1];

  // 2. Delayed quotes: only while today's official close is not in yet, on a weekday between 09:15 and 16:00 IST.
  const ist = new Date(Date.now() + 5.5 * 3600e3), mins = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  if (last && E.isWeekday(today) && last < today && mins >= 9 * 60 + 15 && mins <= 16 * 60) {
    const px = {}; let newest = 0;
    for (let i = 0; i < symbols.length; i += 8) {
      const res = await Promise.all(symbols.slice(i, i + 8).map((s) => L.fetchQuote(s).catch(() => null)));
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
})().catch((e) => { console.error(e); process.exit(1); });
