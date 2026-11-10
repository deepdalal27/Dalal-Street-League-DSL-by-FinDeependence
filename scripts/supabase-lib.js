// Dalal Street League · tiny Supabase REST client for the GitHub Actions jobs (service key, never shipped to the browser).
const URL_ = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const KEY = process.env.SUPABASE_SERVICE_KEY || '';
const ready = () => !!(URL_ && KEY);

async function call(method, path, body, prefer) {
  const headers = { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' };
  if (prefer) headers.Prefer = prefer;
  const r = await fetch(URL_ + '/rest/v1/' + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30000) });
  const text = await r.text();
  if (!r.ok) { let m = text; try { m = JSON.parse(text).message || text; } catch (e) { /* keep text */ } throw new Error(`Supabase ${r.status} on ${path.split('?')[0]}: ${m}`); }
  return text ? JSON.parse(text) : null;
}
const select = (path) => call('GET', path);
const upsert = (table, rows) => call('POST', table, rows, 'resolution=merge-duplicates,return=minimal');
const rpc = (fn, args) => call('POST', 'rpc/' + fn, args || {});

module.exports = { ready, select, upsert, rpc };
