// Run by GitHub Actions after the price sync: settles contests whose last day has official closing prices,
// and cancels (refunds) contests that did not fill. Ranking and prizes come from site/js/engine.js, the same code the app shows.
const E = require('../site/js/engine.js');
const DB = require('./supabase-lib.js');

async function settleAll(db, log) {
  const dates = (await db.select('dsl_prices?select=d&order=d.asc')).map((r) => r.d);
  if (!dates.length) { log('No closing prices in the database yet.'); return { settled: 0, cancelled: 0, failed: 0 }; }
  const last = dates[dates.length - 1];
  const due = await db.select(`dsl_contests?select=id,kind,entry,size,end_date,status&status=in.(open,live)&end_date=lte.${last}&order=id.asc`);
  const out = { settled: 0, cancelled: 0, failed: 0 };
  const closeCache = {};
  for (const c of due) {
    try {
      const sd = E.settleDate(c.end_date, dates);
      if (!sd) continue;
      if (c.status === 'open') {
        const n = await db.rpc('dsl_cancel_contest', { p_cid: c.id });
        log(`#${c.id} ${c.kind} ${c.entry}: not full, cancelled and ${n} entr${n === 1 ? 'y' : 'ies'} refunded`);
        out.cancelled++; continue;
      }
      if (!closeCache[sd]) closeCache[sd] = (await db.select(`dsl_prices?select=closes&d=eq.${sd}`))[0].closes;
      const entries = await db.select(`dsl_entries?select=id,holdings,cash&contest_id=eq.${c.id}&order=id.asc`);
      const res = E.settle(c.kind, c.entry, entries.map((e) => E.value(e.holdings, Number(e.cash), closeCache[sd])));
      const rows = res.rows.map((r) => ({ entry_id: entries[r.idx].id, value: r.value, rank: r.rank, prize: r.prize }));
      const done = await db.rpc('dsl_apply_settlement', { p_cid: c.id, p_date: sd, p_rows: rows });
      log(`#${c.id} ${c.kind} ${c.entry}: settled on ${sd}, prizes ${done.paid}, commission ${done.commission}`);
      out.settled++;
    } catch (e) { out.failed++; log(`#${c.id}: FAILED, ${e.message}`); }
  }
  return out;
}

module.exports = { settleAll };

if (require.main === module) {
  if (!DB.ready()) { console.log('SUPABASE_URL / SUPABASE_SERVICE_KEY not set; nothing settled.'); process.exit(0); }
  settleAll(DB, console.log).then((r) => { console.log(`Done. Settled ${r.settled}, cancelled ${r.cancelled}, failed ${r.failed}.`); process.exit(r.failed ? 1 : 0); })
    .catch((e) => { console.error(e.message); process.exit(1); });
}
