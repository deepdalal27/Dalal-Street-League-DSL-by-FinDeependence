// Run by GitHub Actions after the price sync: settles contests whose last day has official closing prices,
// starts contests whose entries have closed, and refunds contests nobody else joined. Ranking and prizes come from site/js/engine.js, the same code the app shows.
const E = require('../site/js/engine.js');
const DB = require('./supabase-lib.js');

async function settleAll(db, log) {
  const out = { started: 0, settled: 0, cancelled: 0, failed: 0 };
  // 1. Entries closed: contests with 2+ players start, the rest are cancelled and refunded.
  const lock = await db.rpc('dsl_lock_due');
  out.started = lock.started; out.cancelled = lock.cancelled;
  if (lock.started || lock.cancelled) log(`Entries closed: ${lock.started} contest(s) started, ${lock.cancelled} cancelled and refunded`);
  // 2. Settle live contests whose last day has official closing prices.
  const dates = (await db.select('dsl_prices?select=d&order=d.asc')).map((r) => r.d);
  if (!dates.length) { log('No closing prices in the database yet.'); return out; }
  const last = dates[dates.length - 1];
  const due = await db.select(`dsl_contests?select=id,kind,entry,duration,joined,end_date&status=eq.live&end_date=lte.${last}&order=id.asc`);
  const closeCache = {};
  for (const c of due) {
    try {
      const sd = E.settleDate(c.end_date, dates);
      if (!sd) continue;
      if (!closeCache[sd]) closeCache[sd] = (await db.select(`dsl_prices?select=closes&d=eq.${sd}`))[0].closes;
      const entries = await db.select(`dsl_entries?select=id,holdings,cash&contest_id=eq.${c.id}&order=id.asc`);
      const res = E.settle(c.entry, c.duration, entries.map((e) => E.value(e.holdings, Number(e.cash), closeCache[sd])));
      const rows = res.rows.map((r) => ({ entry_id: entries[r.idx].id, value: r.value, rank: r.rank, prize: r.prize }));
      const done = await db.rpc('dsl_apply_settlement', { p_cid: c.id, p_date: sd, p_rows: rows });
      log(`#${c.id} ${c.kind} ${c.entry} x ${entries.length} players: settled on ${sd}, prizes ${done.paid}, commission ${done.commission}`);
      out.settled++;
    } catch (e) { out.failed++; log(`#${c.id}: FAILED, ${e.message}`); }
  }
  return out;
}

module.exports = { settleAll };

if (require.main === module) {
  if (!DB.ready()) { console.log('SUPABASE_URL / SUPABASE_SERVICE_KEY not set; nothing settled.'); process.exit(0); }
  settleAll(DB, console.log).then((r) => { console.log(`Done. Started ${r.started}, settled ${r.settled}, cancelled ${r.cancelled}, failed ${r.failed}.`); process.exit(r.failed ? 1 : 0); })
    .catch((e) => { console.error(e.message); process.exit(1); });
}
