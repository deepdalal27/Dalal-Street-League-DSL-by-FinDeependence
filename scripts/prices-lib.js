// Dalal Street League · price sources used by the GitHub Actions sync (scripts/sync-prices.js).
//  1. NSE daily "bhavcopy" file: the official closing price of every stock (decides winners).
//  2. Yahoo Finance chart API: delayed quotes during market hours (used only for buying at the latest price).
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

async function get(url, accept) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: accept || '*/*', 'Accept-Language': 'en-US,en;q=0.9' }, redirect: 'follow', signal: AbortSignal.timeout(30000) });
  return { status: r.status, body: await r.text() };
}

const bhavUrl = (date) => { const [y, m, d] = date.split('-'); return `https://nsearchives.nseindia.com/products/content/sec_bhavdata_full_${d}${m}${y}.csv`; };
const MON = { JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06', JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12' };

// Returns { date: 'YYYY-MM-DD', closes: { SYMBOL: closePrice } } for the wanted symbols, or throws if the file is not a bhavcopy.
function parseBhavcopy(csv, wanted) {
  const lines = String(csv).split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) throw new Error('empty file');
  const head = lines[0].split(',').map((h) => h.trim().toUpperCase());
  const iS = head.indexOf('SYMBOL'), iSer = head.indexOf('SERIES'), iD = head.indexOf('DATE1'), iC = head.indexOf('CLOSE_PRICE');
  if (iS < 0 || iSer < 0 || iD < 0 || iC < 0) throw new Error('unexpected columns: ' + head.slice(0, 6).join('|'));
  const want = wanted ? new Set(wanted) : null, closes = {}, rank = { EQ: 2, BE: 1, BZ: 1 };
  const seen = {};
  let date = null;
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split(',').map((x) => x.trim());
    const sym = c[iS], ser = c[iSer], close = Number(c[iC]);
    if (!rank[ser] || !(close > 0) || (want && !want.has(sym))) continue;
    if (seen[sym] && seen[sym] >= rank[ser]) continue;
    seen[sym] = rank[ser]; closes[sym] = close;
    if (!date) { const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(c[iD]); if (m && MON[m[2].toUpperCase()]) date = `${m[3]}-${MON[m[2].toUpperCase()]}-${m[1].padStart(2, '0')}`; }
  }
  if (!date || !Object.keys(closes).length) throw new Error('no usable rows');
  return { date, closes };
}

async function fetchBhavcopy(date, wanted) {
  const r = await get(bhavUrl(date), 'text/csv');
  if (r.status === 404) return null;                       // holiday, weekend, or not published yet
  if (r.status !== 200) throw new Error('NSE ' + r.status);
  const out = parseBhavcopy(r.body, wanted);
  if (out.date !== date) return null;                     // NSE served another day's file: no trading on this date
  return out;
}

// Returns { price, time } (time in ms) from a Yahoo chart response, or null.
function parseYahooChart(json) {
  const m = json && json.chart && json.chart.result && json.chart.result[0] && json.chart.result[0].meta;
  if (!m || !(m.regularMarketPrice > 0) || !m.regularMarketTime) return null;
  return { price: Math.round(m.regularMarketPrice * 100) / 100, time: m.regularMarketTime * 1000 };
}
async function fetchQuote(symbol) {
  const r = await get(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol + '.NS')}?interval=1d&range=1d`, 'application/json');
  if (r.status !== 200) return null;
  try { return parseYahooChart(JSON.parse(r.body)); } catch (e) { return null; }
}

// ---- Stock list: NSE index constituents ----
// Large cap = Nifty 100, Mid cap = Nifty Midcap 150, Small cap = Nifty Smallcap 250 (together the Nifty 500).
// These follow the SEBI / AMFI definition: top 100 companies by market value are large, 101 to 250 mid, 251 onwards small.
const INDEX_LISTS = [['L', 'ind_nifty100list.csv'], ['M', 'ind_niftymidcap150list.csv'], ['S', 'ind_niftysmallcap250list.csv']];
const INDEX_HOSTS = ['https://nsearchives.nseindia.com/content/indices/', 'https://archives.nseindia.com/content/indices/', 'https://www.niftyindices.com/IndexConstituent/'];

// CSV columns: Company Name,Industry,Symbol,Series,ISIN Code. Company names can contain commas inside quotes.
function splitCsv(line) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
    else if (ch === ',' && !q) { out.push(cur.trim()); cur = ''; }
    else cur += ch;
  }
  out.push(cur.trim());
  return out;
}
function parseIndexCsv(csv, cap) {
  const lines = String(csv).replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  const head = splitCsv(lines[0] || '').map((h) => h.toUpperCase());
  const iN = head.indexOf('COMPANY NAME'), iI = head.indexOf('INDUSTRY'), iS = head.indexOf('SYMBOL'), iSer = head.indexOf('SERIES');
  if (iN < 0 || iS < 0) throw new Error('not an index list');
  const out = [];
  for (let k = 1; k < lines.length; k++) {
    const c = splitCsv(lines[k]);
    if (!c[iS] || (iSer >= 0 && c[iSer] && c[iSer] !== 'EQ')) continue;
    out.push({ s: c[iS], n: c[iN].replace(/,?\s+(Ltd|Limited)\.?$/i, '').trim(), sec: iI >= 0 && c[iI] ? c[iI] : 'Other', c: cap });
  }
  return out;
}
async function fetchUniverse() {
  const seen = new Set(), list = [];
  for (const [cap, file] of INDEX_LISTS) {
    let got = null, last = '';
    for (const host of INDEX_HOSTS) {
      try {
        const r = await get(host + file, 'text/csv');
        if (r.status === 200) { got = parseIndexCsv(r.body, cap); if (got.length) break; }
        last = host + ' ' + r.status;
      } catch (e) { last = host + ' ' + e.message; }
    }
    if (!got || !got.length) throw new Error(`${file}: ${last}`);
    for (const u of got) if (!seen.has(u.s)) { seen.add(u.s); list.push(u); }
  }
  return list;
}

module.exports = { bhavUrl, parseBhavcopy, fetchBhavcopy, parseYahooChart, fetchQuote, splitCsv, parseIndexCsv, fetchUniverse };
