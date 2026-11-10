/* Dalal Street League (DSL) by FinDeependence · Created by CA Deep Dalal
   Prototype app: sign-up, wallet with owner-approved top-ups, contests against simulated opponents, owner report.
   Everything is stored in this browser (localStorage). A server replaces this storage in the next step. */
(function () {
  'use strict';
  var E = window.DSL.E, U = window.DSL_UNIVERSE, KEY = 'dsl.v1';
  var BY = {}; U.forEach(function (u) { BY[u.s] = u; });
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var num = function (n, d) { return Number(n).toLocaleString('en-IN', { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 }); };
  var inr = function (n) { return (n < 0 ? '-' : '') + '₹' + num(Math.abs(n), Math.abs(n) % 1 ? 2 : 0); };
  var px2 = function (n) { return '₹' + num(n, 2); };
  var fmtDate = function (d) { return new Date(d + 'T00:00:00Z').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }); };
  var fmtTs = function (t) { return new Date(t).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); };
  var pct = function (n) { return '<span class="' + (n > 0 ? 'up' : n < 0 ? 'down' : '') + '">' + (n > 0 ? '+' : '') + num(n, 2) + '%</span>'; };

  // ---------- storage ----------
  function blank() { return { v: 1, owner: { pin: '', upi: '', payee: 'CA Deep Dalal' }, users: [], session: null, txns: [], requests: [], contests: [], sim: {}, seq: 1 }; }
  var S = blank(), storageOk = true;
  try { var raw = localStorage.getItem(KEY); if (raw) { var o = JSON.parse(raw); if (o && o.v === 1) S = Object.assign(blank(), o); } } catch (e) { storageOk = false; }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { storageOk = false; } }
  var nid = function () { return S.seq++; };
  var ownerIn = false;
  try { ownerIn = sessionStorage.getItem('dsl.owner') === '1'; } catch (e) { /* ignore */ }

  // ---------- state ----------
  var view = 'play', draft = null, fk = 'h2h', fd = 'day', q = '', sec = '', mq = '', ownerTab = 'report';
  var prices = E.samplePrices(U, E.istToday()), P = E.priceView(prices, S.sim);
  var me = function () { return S.users.find(function (u) { return u.id === S.session; }) || null; };
  var balance = function (uid) { return E.r2(S.txns.reduce(function (a, t) { return t.uid === uid ? a + t.amt : a; }, 0)); };
  var touch = function (u) { if (u) u.lastActive = Date.now(); };
  var txn = function (uid, type, amt, extra) { S.txns.push(Object.assign({ id: nid(), uid: uid, type: type, amt: amt, ts: Date.now() }, extra || {})); };
  var cname = function (c) { return E.KINDS[c.kind].label + ' · ' + inr(c.entry) + ' · ' + E.DURATIONS[c.duration]; };

  // ---------- small UI helpers (same pattern as the FinDeependence IPO Deal Desk) ----------
  var tt;
  function toast(msg, err) { var t = $('#toast'); t.textContent = msg; t.className = 'show' + (err ? ' err' : ''); clearTimeout(tt); tt = setTimeout(function () { t.className = ''; }, err ? 5200 : 2600); }
  var closeModal = function () {};
  function modal(html, onMount) {
    var m = $('#modal'), b = $('#modalBody');
    b.innerHTML = html; m.hidden = false;
    var key = function (e) { if (e.key === 'Escape') close(); };
    function close() { m.hidden = true; b.innerHTML = ''; document.removeEventListener('keydown', key); }
    document.addEventListener('keydown', key);
    m.onclick = function (e) { if (e.target === m) close(); };
    b.querySelectorAll('[data-close]').forEach(function (x) { x.onclick = close; });
    closeModal = close;
    if (onMount) onMount(b, close);
    var f = b.querySelector('input,select,button.primary'); if (f) f.focus();
    return close;
  }
  function confirmBox(msg, yes, label) {
    modal('<h2>Please confirm</h2><p>' + msg + '</p><div class="row" style="justify-content:flex-end"><button data-close>Cancel</button><button class="primary" id="cfYes">' + esc(label || 'Yes') + '</button></div>', function (b, close) {
      $('#cfYes', b).onclick = function () { close(); yes(); };
    });
  }
  var pill = function (cls, txt) { return '<span class="pill ' + cls + '">' + esc(txt) + '</span>'; };
  var fact = function (label, val, hint) { return '<div class="fact"><small>' + esc(label) + '</small><b>' + val + '</b>' + (hint ? '<span class="hint">' + esc(hint) + '</span>' : '') + '</div>'; };

  // ---------- prices ----------
  function refreshView() { P = E.priceView(prices, S.sim); }
  function loadPrices(manual) {
    return fetch('data/prices.json?t=' + Date.now(), { cache: 'no-store' }).then(function (r) { if (!r.ok) throw new Error('none'); return r.json(); }).then(function (j) {
      if (j && j.closes && Object.keys(j.closes).length) { prices = j; refreshView(); var n = settleAll(); render(); if (manual) toast('Prices updated' + (n ? ' · ' + n + ' contest(s) settled' : '')); }
      else if (manual) toast('No new prices yet');
    }).catch(function () { if (manual) toast('Live price file not available yet. Sample prices are in use.', true); });
  }
  // The game's calendar day. Normally today (IST); after simulated closing days it moves ahead with them.
  var gameToday = function () { var t = E.istToday(); return P.last > t ? P.last : t; };
  var chg = function (s) { var a = P.px[s], b = P.prev[s]; return a > 0 && b > 0 ? E.r2((a / b - 1) * 100) : 0; };
  var stocks = function () { return U.filter(function (u) { return P.px[u.s] > 0; }); };

  // ---------- settlement ----------
  function settleAll() {
    var n = 0;
    S.contests.forEach(function (c) {
      if (c.status !== 'live') return;
      var sd = E.settleDate(c.end, P.dates); if (!sd) return;
      var close = P.closes[sd];
      var res = E.settle(c.kind, c.entry, c.entries.map(function (e) { return E.value(e.holdings, e.cash, close); }));
      c.result = { date: sd, sim: !!P.simDates[sd], rows: res.rows, paid: res.paid, commission: res.commission, gross: res.gross, ts: Date.now() };
      c.status = 'settled';
      res.rows.forEach(function (r) { var e = c.entries[r.idx]; if (e.uid && r.prize > 0) txn(e.uid, 'prize', r.prize, { cid: c.id }); });
      n++;
    });
    if (n) save();
    return n;
  }
  // Standings right now (live contest) or final (settled).
  function standings(c) {
    if (c.status === 'settled') return c.result.rows;
    return E.settle(c.kind, c.entry, c.entries.map(function (e) { return E.value(e.holdings, e.cash, P.px); })).rows;
  }

  // ---------- render shell ----------
  function render() {
    document.querySelectorAll('#tabs button').forEach(function (b) { b.classList.toggle('on', b.dataset.v === view); });
    var u = me();
    $('#playerbar').innerHTML = u
      ? '<div class="who">Hi, ' + esc(u.name) + ' <span class="muted small">' + esc(u.mobile) + '</span></div><div class="row"><span class="bal" title="Wallet balance">Wallet ' + inr(balance(u.id)) + '</span><button data-act="go" data-v="wallet">Add money</button><button data-act="logout">Log out</button></div>'
      : '';
    var note = [];
    if (!storageOk) note.push('<div class="notice">Your browser is blocking storage, so nothing will be remembered after you close this page. Open the app in a normal (not private) window.</div>');
    var simN = Object.keys(P.simDates).length;
    if (P.sample) note.push('<div class="notice"><b>Sample prices.</b> The official NSE price file has not been loaded yet, so the prices shown are samples for trying the app, not real market prices.' + (simN ? ' ' + simN + ' simulated closing day(s) added by the owner.' : '') + ' <button data-act="refresh">Check for prices</button></div>');
    else note.push('<div class="notice ok"><b>Prices:</b> ' + (P.live ? 'delayed quotes (about 15 min) as of ' + esc(fmtTs(P.quoteTime)) : 'official NSE closing prices of ' + fmtDate(P.last)) + '. Winners are always decided on official closing prices.' + (simN ? ' <b>' + simN + ' simulated day(s) are active (owner demo).</b>' : '') + ' <button data-act="refresh">Refresh</button></div>');
    $('#notices').innerHTML = note.join('');
    var v = $('#view');
    if (view === 'play') v.innerHTML = !u ? authHtml() : draft ? builderHtml() : lobbyHtml();
    else if (view === 'mine') v.innerHTML = !u ? authHtml() : mineHtml();
    else if (view === 'wallet') v.innerHTML = !u ? authHtml() : walletHtml();
    else if (view === 'market') v.innerHTML = marketHtml();
    else if (view === 'rules') v.innerHTML = rulesHtml();
    else v.innerHTML = ownerHtml();
  }

  // ---------- sign up / log in ----------
  function authHtml() {
    return '<div class="panel auth"><div class="lbl2">Welcome</div><h2 class="big">Join Dalal Street League</h2>' +
      '<p class="muted">Build a stock portfolio with virtual coins and beat your rival on closing prices.</p>' +
      '<form class="form" id="signup" novalidate><label>Full name<input name="name" autocomplete="name" required></label>' +
      '<label>Email<input name="email" type="email" autocomplete="email" required></label>' +
      '<label>Mobile number (10 digits)<input name="mobile" inputmode="numeric" maxlength="10" autocomplete="tel-national" required></label>' +
      '<label class="check" style="flex-direction:row;align-items:flex-start;gap:8px;text-transform:none;letter-spacing:0;font-size:13px"><input type="checkbox" name="age" style="margin-top:3px"> I am 18 or older and I accept the game rules.</label>' +
      '<div class="row"><button class="primary" type="submit">Create my account</button><button type="button" data-act="loginBox">I already have an account</button></div></form></div>';
  }
  function doSignup(f) {
    var name = f.name.value.trim().replace(/\s+/g, ' '), email = f.email.value.trim().toLowerCase(), mobile = f.mobile.value.replace(/\D/g, '');
    if (name.length < 2) return toast('Enter your full name.', true);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return toast('Enter a valid email address.', true);
    if (!/^[6-9]\d{9}$/.test(mobile)) return toast('Enter a valid 10-digit Indian mobile number.', true);
    if (!f.age.checked) return toast('Please confirm you are 18 or older.', true);
    if (S.users.some(function (u) { return u.email === email || u.mobile === mobile; })) return toast('This email or mobile is already registered. Use "I already have an account".', true);
    var u = { id: nid(), name: name, email: email, mobile: mobile, joined: Date.now(), lastActive: Date.now() };
    S.users.push(u); S.session = u.id; save(); afterLogin(); toast('Welcome, ' + name + '!');
  }
  function loginBox() {
    modal('<h2>Log in</h2><form class="form" id="login" novalidate style="grid-template-columns:1fr"><label>Email<input name="email" type="email" required></label><label>Mobile number<input name="mobile" inputmode="numeric" maxlength="10" required></label><div class="row"><button type="button" data-close>Cancel</button><button class="primary" type="submit">Log in</button></div></form>', function (b, close) {
      $('#login', b).onsubmit = function (ev) {
        ev.preventDefault();
        var email = this.email.value.trim().toLowerCase(), mobile = this.mobile.value.replace(/\D/g, '');
        var u = S.users.find(function (x) { return x.email === email && x.mobile === mobile; });
        if (!u) return toast('No account matches this email and mobile on this device.', true);
        S.session = u.id; touch(u); save(); close(); afterLogin(); toast('Welcome back, ' + u.name + '!');
      };
    });
  }
  function afterLogin() { if (invite) { startDraft(invite.kind, invite.entry, invite.duration, true); invite = null; } render(); }

  // ---------- lobby ----------
  function seg(id, opts, cur) { return '<div class="seg" data-seg="' + id + '">' + opts.map(function (o) { return '<button data-act="seg" data-id="' + id + '" data-val="' + o[0] + '" class="' + (o[0] === cur ? 'on' : '') + '" data-cat="">' + esc(o[1]) + '</button>'; }).join('') + '</div>'; }
  function lobbyHtml() {
    var k = E.KINDS[fk], end = E.endDate(gameToday(), fd);
    var cards = k.entries.map(function (en) {
      var t = E.prizeTable(fk, en);
      return '<div class="ccard"><div class="top"><div><div class="lbl2">Entry</div><div class="entry">' + inr(en) + '</div></div><div class="win">' + (fk === 'h2h' ? 'Winner gets<br>' + inr(t.prizes[0]) : '1st prize ' + inr(t.prizes[0]) + '<br>' + t.winners + ' winners') + '</div></div>' +
        '<div class="meta">' + fact('Coins to invest', num(E.COINS[en])) + fact('Players', String(k.size)) + fact('Ends at close of', fmtDate(end)) + fact('Prize pool', inr(t.prizeTotal)) + '</div>' +
        '<div class="row"><button class="primary" data-act="play" data-entry="' + en + '">Play</button>' + (fk === 'h2h' ? '<button data-act="invite" data-entry="' + en + '">Challenge a friend</button>' : '<button data-act="prizes" data-entry="' + en + '">Prize table</button>') + '</div></div>';
    }).join('');
    return '<div class="lbl2">Pick a contest</div><h2 class="big">' + esc(k.label) + ' · ' + esc(E.DURATIONS[fd]) + '</h2>' +
      '<div class="filters">' + seg('fk', Object.keys(E.KINDS).map(function (x) { return [x, E.KINDS[x].label]; }), fk) + seg('fd', Object.keys(E.DURATIONS).map(function (x) { return [x, E.DURATIONS[x]]; }), fd) + '</div>' +
      '<div class="cards">' + cards + '</div>' +
      '<p class="muted small" style="margin-top:12px">Prototype: your opponents are simulated players (marked SIM) who pick stocks at the same prices as you. Real player-vs-player matches start when the server is added.</p>';
  }
  function prizeBox(kind, entry) {
    var t = E.prizeTable(kind, entry);
    modal('<h2>' + esc(E.KINDS[kind].label) + ' · ' + inr(entry) + ' entry</h2><div class="tbl"><table><thead><tr><th>Rank</th><th class="num">Prize each</th></tr></thead><tbody>' +
      t.bands.map(function (b) { return '<tr><td>' + (b.from === b.to ? 'Rank ' + b.from : 'Rank ' + b.from + ' to ' + b.to) + '</td><td class="num">' + inr(b.each) + '</td></tr>'; }).join('') +
      '<tr class="tot"><td>Total prizes (' + t.winners + ' winners of ' + t.size + ')</td><td class="num">' + inr(t.prizeTotal) + '</td></tr></tbody></table></div><p class="muted small">If players finish on exactly the same value, they share the prizes of the ranks they cover equally.</p><div class="row" style="justify-content:flex-end"><button data-close>Close</button></div>');
  }
  var invite = null;
  function inviteBox(entry) {
    var link = location.origin + location.pathname + '?c=h2h-' + entry + '-' + fd;
    var msg = 'I challenge you on Dalal Street League by FinDeependence! 1 vs 1, ' + inr(entry) + ' entry, ' + E.DURATIONS[fd].toLowerCase() + ' contest. Pick your stocks: ' + link;
    modal('<h2>Challenge a friend</h2><p>Send this link. Your friend signs up, picks stocks for the same ' + inr(entry) + ' contest, and the better portfolio at the close wins ' + inr(E.H2H_PRIZE[entry]) + '.</p><div class="upi" id="invLink">' + esc(link) + '</div>' +
      '<p class="muted small">Prototype: the link opens the same contest for your friend, but each of you is matched with a simulated opponent until the server is added.</p>' +
      '<div class="row" style="justify-content:flex-end"><button data-close>Close</button><button id="invCopy">Copy link</button><a class="fakebtn" target="_blank" rel="noopener" href="https://wa.me/?text=' + encodeURIComponent(msg) + '">Share on WhatsApp</a><button class="primary" id="invPlay">Pick my stocks</button></div>', function (b, close) {
      $('#invCopy', b).onclick = function () { (navigator.clipboard ? navigator.clipboard.writeText(link) : Promise.reject()).then(function () { toast('Link copied'); }, function () { toast('Select the link and copy it.', true); }); };
      $('#invPlay', b).onclick = function () { close(); startDraft('h2h', entry, fd, true); render(); };
    });
  }

  // ---------- team builder ----------
  function startDraft(kind, entry, duration, friend) {
    if (!E.KINDS[kind] || E.KINDS[kind].entries.indexOf(entry) < 0 || !E.DURATIONS[duration]) return;
    draft = { kind: kind, entry: entry, duration: duration, coins: E.COINS[entry], friend: !!friend, h: {} };
    view = 'play'; q = ''; sec = '';
  }
  var draftHoldings = function () { return Object.keys(draft.h).map(function (s) { return { s: s, q: draft.h[s], p: P.px[s] }; }); };
  function stockBtn(u, inTeam) {
    var c = chg(u.s);
    return '<button class="stock-btn' + (inTeam ? ' in' : '') + '" data-act="buy" data-s="' + esc(u.s) + '"><span class="nm">' + esc(u.s) + '</span><span class="px">' + px2(P.px[u.s]) + '</span><span class="sub">' + esc(u.n) + '</span><span class="chg ' + (c > 0 ? 'up' : c < 0 ? 'down' : '') + '">' + (c > 0 ? '+' : '') + num(c, 2) + '%</span></button>';
  }
  function railList() {
    var s = q.trim().toLowerCase();
    var list = stocks().filter(function (u) { return (!sec || u.sec === sec) && (!s || u.s.toLowerCase().indexOf(s) >= 0 || u.n.toLowerCase().indexOf(s) >= 0); });
    return list.length ? list.map(function (u) { return stockBtn(u, !!draft.h[u.s]); }).join('') : '<p class="muted small">No stock matches.</p>';
  }
  function builderHtml() {
    var hs = draftHoldings(), cost = E.cost(hs), left = E.r2(draft.coins - cost), t = E.prizeTable(draft.kind, draft.entry);
    var secs = Array.from(new Set(U.map(function (u) { return u.sec; }))).sort();
    var rows = hs.map(function (h) {
      return '<tr><td><b>' + esc(h.s) + '</b><br><span class="muted small">' + esc(BY[h.s].n) + '</span></td><td class="num">' + num(h.q) + '</td><td class="num">' + px2(h.p) + '</td><td class="num">' + num(h.q * h.p, 2) + '</td><td class="num">' + num(h.q * h.p / draft.coins * 100, 1) + '%</td><td><button data-act="buy" data-s="' + esc(h.s) + '">Change</button> <button class="danger" data-act="drop" data-s="' + esc(h.s) + '">Remove</button></td></tr>';
    }).join('');
    var err = E.validate(hs, draft.coins);
    return '<div class="apply"><aside class="rail"><div class="rail-head"><h2>Stocks</h2><select id="secSel" aria-label="Sector"><option value="">All sectors</option>' + secs.map(function (x) { return '<option' + (x === sec ? ' selected' : '') + '>' + esc(x) + '</option>'; }).join('') + '</select></div>' +
      '<input type="search" id="stockSearch" placeholder="Search stock" aria-label="Search stock" value="' + esc(q) + '"><div class="ipo-list" id="stockRail">' + railList() + '</div></aside>' +
      '<div class="panel"><div class="panel-head"><div><div class="lbl2">Build your portfolio' + (draft.friend ? ' · friend challenge' : '') + '</div><h2>' + esc(E.KINDS[draft.kind].label) + ' · ' + inr(draft.entry) + ' · ' + esc(E.DURATIONS[draft.duration]) + '</h2></div><button data-act="cancelDraft">Back to contests</button></div>' +
      '<div class="facts">' + fact('Coins given', num(draft.coins)) + fact('Invested', num(cost, 2)) + fact('Coins left', '<span class="' + (left < 0 ? 'down' : '') + '">' + num(left, 2) + '</span>', 'Unused coins stay as cash') + fact(draft.kind === 'h2h' ? 'You win' : '1st prize', inr(t.prizes[0])) + fact('Ends at close of', fmtDate(E.endDate(gameToday(), draft.duration))) + '</div>' +
      '<div class="meter' + (left < 0 ? ' over' : '') + '"><i style="width:' + Math.min(100, cost / draft.coins * 100) + '%"></i></div>' +
      (hs.length ? '<div class="tbl"><table><thead><tr><th>Stock</th><th class="num">Shares</th><th class="num">Buy price</th><th class="num">Coins</th><th class="num">Weight</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>'
        : '<div class="empty"><b>No stocks yet</b><span>Tap a stock on the list to buy it with your coins. Pick at least ' + E.MIN_STOCKS + '.</span></div>') +
      '<div class="backup"><p class="muted">' + (err ? esc(err) : 'Ready. Entry of ' + inr(draft.entry) + ' is taken from your wallet when you confirm. Picks cannot be changed afterwards.') + '</p><button class="primary" data-act="confirmJoin"' + (err ? ' disabled' : '') + '>Confirm and pay ' + inr(draft.entry) + '</button></div></div></div>';
  }
  function buyBox(sym) {
    var u = BY[sym], p = P.px[sym]; if (!u || !(p > 0)) return;
    var others = E.cost(draftHoldings().filter(function (h) { return h.s !== sym; })), avail = E.r2(draft.coins - others), max = Math.floor(avail / p), cur = draft.h[sym] || 0;
    modal('<h2>' + esc(u.n) + '</h2><p class="muted">' + esc(sym) + ' · ' + esc(u.sec) + ' · price ' + px2(p) + ' ' + pct(chg(sym)) + '</p>' +
      '<div class="facts">' + fact('Coins available', num(avail, 2)) + fact('Most you can buy', num(max) + ' shares') + '</div>' +
      (max < 1 ? '<p class="down">You do not have enough coins left for one share. Remove or reduce another stock first.</p>' : '') +
      '<form class="form" id="buyForm" novalidate><label>Number of shares<input name="qty" type="number" min="0" max="' + max + '" step="1" value="' + (cur || '') + '" inputmode="numeric"></label><label>Coins used<input name="amt" readonly value=""></label>' +
      '<div class="full"><div class="lbl2" style="margin-bottom:6px">Quick pick (share of your coins)</div><div class="chips">' + [10, 20, 25, 33, 50].map(function (x) { return '<button type="button" data-pc="' + x + '">' + x + '%</button>'; }).join('') + '<button type="button" data-pc="max">Max</button></div></div>' +
      '<div class="full row" style="justify-content:flex-end"><button type="button" data-close>Cancel</button>' + (cur ? '<button type="button" class="danger" id="buyDrop">Remove</button>' : '') + '<button class="primary" type="submit">' + (cur ? 'Update' : 'Add to portfolio') + '</button></div></form>', function (b, close) {
      var f = $('#buyForm', b), show = function () { var n = Math.floor(Number(f.qty.value) || 0); f.amt.value = n > 0 ? num(n * p, 2) : ''; };
      f.qty.oninput = show; show();
      b.querySelectorAll('[data-pc]').forEach(function (x) { x.onclick = function () { var n = x.dataset.pc === 'max' ? max : Math.min(max, Math.floor(draft.coins * Number(x.dataset.pc) / 100 / p)); f.qty.value = n; show(); }; });
      if (cur) $('#buyDrop', b).onclick = function () { delete draft.h[sym]; close(); render(); };
      f.onsubmit = function (ev) {
        ev.preventDefault();
        var n = Number(f.qty.value);
        if (!(n >= 0) || n !== Math.floor(n)) return toast('Enter a whole number of shares.', true);
        if (n > max) return toast('You can buy at most ' + num(max) + ' shares with the coins left.', true);
        if (n === 0) delete draft.h[sym]; else draft.h[sym] = n;
        close(); render();
      };
    });
  }
  var BOT_NAMES = ['Aarav', 'Vivaan', 'Ishita', 'Kavya', 'Rohan', 'Sneha', 'Arjun', 'Meera', 'Kunal', 'Riya', 'Harsh', 'Pooja', 'Nikhil', 'Tanvi', 'Yash', 'Diya', 'Manav', 'Neha', 'Parth', 'Jiya', 'Dhruv', 'Aditi', 'Karan', 'Simran', 'Varun', 'Anaya'];
  function confirmJoin() {
    var u = me(), hs = draftHoldings(), err = E.validate(hs, draft.coins);
    if (err) return toast(err, true);
    var bal = balance(u.id);
    if (bal < draft.entry) {
      return modal('<h2>Add money to play</h2><p>This contest needs ' + inr(draft.entry) + ' and your wallet has ' + inr(bal) + '. Your stock picks are kept while you add money.</p><div class="row" style="justify-content:flex-end"><button data-close>Not now</button><button class="primary" id="goWallet">Go to wallet</button></div>', function (b, close) { $('#goWallet', b).onclick = function () { close(); view = 'wallet'; render(); }; });
    }
    var d = draft, t = E.prizeTable(d.kind, d.entry);
    confirmBox('Join <b>' + esc(E.KINDS[d.kind].label) + ' · ' + esc(E.DURATIONS[d.duration]) + '</b> for <b>' + inr(d.entry) + '</b>? Your ' + hs.length + ' stocks are locked until the close of ' + fmtDate(E.endDate(gameToday(), d.duration)) + '.', function () {
      var today = gameToday(), id = nid(), rand = E.rng(E.hash(id + ':' + u.id + ':' + Date.now()));
      var c = { id: id, kind: d.kind, entry: d.entry, duration: d.duration, coins: d.coins, size: t.size, start: today, end: E.endDate(today, d.duration), status: 'live', friend: d.friend, created: Date.now(), priceDate: P.last,
        entries: [{ uid: u.id, name: u.name, holdings: hs, cash: E.r2(d.coins - E.cost(hs)) }] };
      for (var i = 1; i < t.size; i++) {
        var b = E.botHoldings(d.coins, P.px, rand);
        c.entries.push({ bot: true, name: BOT_NAMES[Math.floor(rand() * BOT_NAMES.length)] + ' ' + (10 + Math.floor(rand() * 90)), holdings: b.holdings, cash: b.cash });
      }
      S.contests.push(c); txn(u.id, 'entry', -d.entry, { cid: id }); touch(u); save();
      draft = null; view = 'mine'; render(); toast('You are in! Result at the close of ' + fmtDate(c.end) + '.');
    }, 'Confirm and pay ' + inr(d.entry));
  }

  // ---------- my contests ----------
  function myRow(c, uid) { var i = c.entries.findIndex(function (e) { return e.uid === uid; }); return standings(c).find(function (r) { return r.idx === i; }); }
  function mineHtml() {
    var u = me(), list = S.contests.filter(function (c) { return c.entries.some(function (e) { return e.uid === u.id; }); }).sort(function (a, b) { return b.created - a.created; });
    if (!list.length) return '<div class="panel empty"><b>No contests yet</b><span>Join your first contest to see it here.</span><button class="primary" data-act="go" data-v="play">See contests</button></div>';
    var card = function (c) {
      var r = myRow(c, u.id), live = c.status === 'live';
      return '<div class="ccard"><div class="top"><div><div class="lbl2">' + esc(E.KINDS[c.kind].label) + ' · ' + esc(E.DURATIONS[c.duration]) + '</div><div class="entry">' + inr(c.entry) + '</div></div><div>' + (live ? pill('live', 'Live') : r.prize > 0 ? pill('won', 'Won ' + inr(r.prize)) : pill('done', 'Finished')) + (c.status === 'settled' && c.result.sim ? ' ' + pill('sim', 'Demo close') : '') + '</div></div>' +
        '<div class="meta">' + fact(live ? 'Rank now' : 'Final rank', r.rank + ' of ' + c.size) + fact('Return', pct(E.returnPct(r.value, c.coins))) + fact('Portfolio', num(r.value, 2)) + fact(live ? 'Ends at close of' : 'Settled on', fmtDate(live ? c.end : c.result.date)) + '</div>' +
        '<div class="row"><button data-act="detail" data-id="' + c.id + '">View leaderboard</button></div></div>';
    };
    var live = list.filter(function (c) { return c.status === 'live'; }), done = list.filter(function (c) { return c.status !== 'live'; });
    return '<div class="lbl2">My contests</div><h2 class="big">' + live.length + ' live · ' + done.length + ' finished</h2>' +
      (live.length ? '<h3 class="sec">Live</h3><div class="cards">' + live.map(card).join('') + '</div>' : '') + (done.length ? '<h3 class="sec">Finished</h3><div class="cards">' + done.map(card).join('') + '</div>' : '');
  }
  function detailBox(id, uid) {
    var c = S.contests.find(function (x) { return x.id === id; }); if (!c) return;
    var live = c.status === 'live', rows = standings(c), mi = c.entries.findIndex(function (e) { return e.uid === uid; }), ref = live ? P.px : P.closes[c.result.date];
    var show = rows.filter(function (r, i) { return i < 15 || r.idx === mi; });
    var lb = show.map(function (r) {
      var e = c.entries[r.idx];
      return '<tr class="' + (r.idx === mi ? 'me' : '') + '"><td>' + r.rank + (r.tied ? ' (tie)' : '') + '</td><td>' + esc(e.name) + (e.bot ? ' ' + pill('sim', 'SIM') : '') + (r.idx === mi ? ' (you)' : '') + '</td><td class="num">' + num(r.value, 2) + '</td><td class="num">' + pct(E.returnPct(r.value, c.coins)) + '</td><td class="num">' + (r.prize > 0 ? inr(r.prize) : '–') + '</td></tr>';
    }).join('');
    var mine = mi >= 0 ? c.entries[mi] : null;
    var hold = mine ? mine.holdings.map(function (h) {
      var now = ref && ref[h.s] > 0 ? ref[h.s] : h.p;
      return '<tr><td><b>' + esc(h.s) + '</b></td><td class="num">' + num(h.q) + '</td><td class="num">' + px2(h.p) + '</td><td class="num">' + px2(now) + '</td><td class="num">' + pct(E.r2((now / h.p - 1) * 100)) + '</td><td class="num">' + num(E.r2(h.q * (now - h.p)), 2) + '</td></tr>';
    }).join('') : '';
    modal('<h2>' + esc(cname(c)) + ' ' + (live ? pill('live', 'Live') : pill('done', 'Finished')) + '</h2>' +
      '<p class="muted">' + (live ? 'Standings at the latest prices. The final result uses the official closing prices of ' + fmtDate(c.end) + '.' : 'Final result on closing prices of ' + fmtDate(c.result.date) + (c.result.sim ? ' (simulated demo close)' : '') + '.') + '</p>' +
      '<div class="tbl"><table><thead><tr><th>Rank</th><th>Player</th><th class="num">Portfolio</th><th class="num">Return</th><th class="num">' + (live ? 'Prize if it ended now' : 'Prize') + '</th></tr></thead><tbody>' + lb + '</tbody></table></div>' +
      (rows.length > show.length ? '<p class="muted small">Showing the top 15 and your position, out of ' + rows.length + ' players.</p>' : '') +
      (mine ? '<h3 class="sec">' + (mi >= 0 && uid === S.session ? 'Your portfolio' : 'Portfolio') + '</h3><div class="tbl"><table><thead><tr><th>Stock</th><th class="num">Shares</th><th class="num">Buy</th><th class="num">' + (live ? 'Now' : 'Close') + '</th><th class="num">Change</th><th class="num">Gain / loss</th></tr></thead><tbody>' + hold + '<tr class="tot"><td colspan="5">Cash not invested</td><td class="num">' + num(mine.cash, 2) + '</td></tr></tbody></table></div>' : '') +
      '<div class="row" style="justify-content:flex-end;margin-top:12px"><button data-close>Close</button></div>');
  }

  // ---------- wallet ----------
  var TX = { topup: 'Money added', entry: 'Contest entry', prize: 'Prize won', withdraw: 'Withdrawal', refund: 'Withdrawal returned' };
  function walletHtml() {
    var u = me(), tx = S.txns.filter(function (t) { return t.uid === u.id; }).sort(function (a, b) { return b.id - a.id; }), sum = function (ty) { return tx.reduce(function (a, t) { return t.type === ty ? a + t.amt : a; }, 0); };
    var rq = S.requests.filter(function (r) { return r.uid === u.id; }).sort(function (a, b) { return b.id - a.id; });
    return '<div class="lbl2">Wallet</div><h2 class="big">' + inr(balance(u.id)) + ' available</h2>' +
      '<div class="tiles">' + fact('Money added', inr(sum('topup'))) + fact('Entries paid', inr(-sum('entry'))) + fact('Prizes won', inr(sum('prize'))) + fact('Withdrawn', inr(-(sum('withdraw') + sum('refund')))) + '</div>' +
      '<div class="row" style="margin-bottom:14px"><button class="primary" data-act="addMoney">Add money</button><button data-act="withdraw">Withdraw</button></div>' +
      '<h3 class="sec">Requests</h3>' + (rq.length ? '<div class="tbl"><table><thead><tr><th>Date</th><th>Type</th><th class="num">Amount</th><th>Reference</th><th>Status</th></tr></thead><tbody>' + rq.map(function (r) {
        return '<tr><td>' + esc(fmtTs(r.ts)) + '</td><td>' + (r.kind === 'topup' ? 'Add money' : 'Withdraw') + '</td><td class="num">' + inr(r.amt) + '</td><td>' + esc(r.ref) + '</td><td>' + pill(r.status, r.status === 'pending' ? 'Waiting for approval' : r.status === 'approved' ? (r.kind === 'topup' ? 'Added' : 'Paid') : 'Rejected') + '</td></tr>';
      }).join('') + '</tbody></table></div>' : '<p class="muted">No requests yet.</p>') +
      '<h3 class="sec">Wallet history</h3>' + (tx.length ? '<div class="tbl"><table><thead><tr><th>Date</th><th>Details</th><th class="num">Amount</th></tr></thead><tbody>' + tx.map(function (t) {
        var c = t.cid && S.contests.find(function (x) { return x.id === t.cid; });
        return '<tr><td>' + esc(fmtTs(t.ts)) + '</td><td>' + TX[t.type] + (c ? ' · ' + esc(cname(c)) : '') + '</td><td class="num ' + (t.amt > 0 ? 'up' : 'down') + '">' + (t.amt > 0 ? '+' : '') + inr(t.amt) + '</td></tr>';
      }).join('') + '</tbody></table></div>' : '<p class="muted">Nothing here yet. Add money to join your first contest.</p>');
  }
  function addMoneyBox() {
    var u = me();
    if (!S.owner.upi) return modal('<h2>Add money</h2><p>Top-ups are not open yet: the owner has not set the UPI ID for payments. Please check again soon.</p><div class="row" style="justify-content:flex-end"><button data-close>Close</button></div>');
    if (S.requests.filter(function (r) { return r.uid === u.id && r.kind === 'topup' && r.status === 'pending'; }).length >= 3) return toast('You already have 3 top-ups waiting for approval.', true);
    modal('<h2>Add money</h2><ol class="steps"><li>Enter the amount you want to add.</li><li>Pay exactly that amount to this UPI ID from any UPI app:</li></ol><div class="upi">' + esc(S.owner.upi) + '<br><span class="muted small" style="font-weight:500">Name: ' + esc(S.owner.payee) + '</span></div>' +
      '<ol class="steps" start="3"><li>Enter the 12-digit UPI reference number (UTR) from your payment and send the request.</li><li>Your wallet is credited after ' + esc(S.owner.payee) + ' confirms the payment was received.</li></ol>' +
      '<form class="form" id="topForm" novalidate><label>Amount (₹)<input name="amt" type="number" min="49" max="20000" step="1" inputmode="numeric" placeholder="e.g. 500"></label><label>UPI reference no. (UTR)<input name="utr" inputmode="numeric" maxlength="12" placeholder="12 digits"></label>' +
      '<div class="full row" style="justify-content:flex-end"><button type="button" data-close>Cancel</button><a class="fakebtn" id="upiLink" href="#">Open UPI app</a><button class="primary" type="submit">Send request</button></div></form>', function (b, close) {
      var f = $('#topForm', b), amt = function () { var n = Number(f.amt.value); return n >= 49 && n <= 20000 && n === Math.floor(n) ? n : 0; };
      $('#upiLink', b).onclick = function (ev) {
        var a = amt(); if (!a) { ev.preventDefault(); return toast('Enter a whole amount between ₹49 and ₹20,000 first.', true); }
        this.href = 'upi://pay?pa=' + encodeURIComponent(S.owner.upi) + '&pn=' + encodeURIComponent(S.owner.payee) + '&am=' + a + '&cu=INR&tn=' + encodeURIComponent('DSL wallet ' + u.mobile);
      };
      f.onsubmit = function (ev) {
        ev.preventDefault();
        var a = amt(), utr = f.utr.value.replace(/\D/g, '');
        if (!a) return toast('Enter a whole amount between ₹49 and ₹20,000.', true);
        if (!/^\d{12}$/.test(utr)) return toast('Enter the 12-digit UPI reference number from your payment.', true);
        if (S.requests.some(function (r) { return r.kind === 'topup' && r.ref === utr && r.status !== 'rejected'; })) return toast('This UPI reference number has already been used.', true);
        S.requests.push({ id: nid(), uid: u.id, kind: 'topup', amt: a, ref: utr, status: 'pending', ts: Date.now() }); touch(u); save(); close(); render(); toast('Request sent. Your wallet is credited once the payment is confirmed.');
      };
    });
  }
  function withdrawBox() {
    var u = me(), bal = balance(u.id);
    if (bal < 50) return toast('You need at least ₹50 in your wallet to withdraw.', true);
    modal('<h2>Withdraw</h2><p>Available: <b>' + inr(bal) + '</b>. The amount is held now and paid to your UPI ID by ' + esc(S.owner.payee) + '.</p><form class="form" id="wdForm" novalidate><label>Amount (₹)<input name="amt" type="number" min="50" max="' + Math.floor(bal) + '" step="1" inputmode="numeric"></label><label>Your UPI ID<input name="upi" placeholder="name@bank" autocapitalize="none"></label><div class="full row" style="justify-content:flex-end"><button type="button" data-close>Cancel</button><button class="primary" type="submit">Request withdrawal</button></div></form>', function (b, close) {
      $('#wdForm', b).onsubmit = function (ev) {
        ev.preventDefault();
        var a = Number(this.amt.value), upi = this.upi.value.trim();
        if (!(a >= 50) || a !== Math.floor(a)) return toast('Enter a whole amount of ₹50 or more.', true);
        if (a > balance(u.id)) return toast('You cannot withdraw more than your balance.', true);
        if (!/^[\w.\-]{2,}@[A-Za-z][\w]{1,}$/.test(upi)) return toast('Enter a valid UPI ID, like name@bank.', true);
        var id = nid();
        S.requests.push({ id: id, uid: u.id, kind: 'withdraw', amt: a, ref: upi, status: 'pending', ts: Date.now() }); txn(u.id, 'withdraw', -a, { rid: id }); touch(u); save(); close(); render(); toast('Withdrawal requested.');
      };
    });
  }

  // ---------- market ----------
  function marketRows() {
    var s = mq.trim().toLowerCase();
    var list = stocks().filter(function (u) { return !s || u.s.toLowerCase().indexOf(s) >= 0 || u.n.toLowerCase().indexOf(s) >= 0 || u.sec.toLowerCase().indexOf(s) >= 0; });
    return list.map(function (u) { return '<tr><td><b>' + esc(u.s) + '</b></td><td>' + esc(u.n) + '</td><td>' + esc(u.sec) + '</td><td class="num">' + px2(P.px[u.s]) + '</td><td class="num">' + pct(chg(u.s)) + '</td></tr>'; }).join('') || '<tr><td colspan="5" class="muted">No stock matches.</td></tr>';
  }
  function marketHtml() {
    return '<div class="lbl2">Market</div><h2 class="big">' + stocks().length + ' stocks you can pick</h2><div class="filters"><input type="search" id="mktSearch" class="grow" placeholder="Search by name, symbol or sector" aria-label="Search stocks" value="' + esc(mq) + '"></div>' +
      '<div class="tbl"><table><thead><tr><th>Symbol</th><th>Company</th><th>Sector</th><th class="num">Price</th><th class="num">Change</th></tr></thead><tbody id="mktBody">' + marketRows() + '</tbody></table></div>';
  }

  // ---------- rules ----------
  function rulesHtml() {
    var tbl = function (kind) {
      var k = E.KINDS[kind];
      return '<div class="tbl"><table><thead><tr><th>Entry</th><th class="num">Coins</th>' + (kind === 'h2h' ? '<th class="num">Winner gets</th>' : E.prizeTable(kind, k.entries[0]).bands.map(function (b) { return '<th class="num">' + (b.from === b.to ? 'Rank ' + b.from : 'Rank ' + b.from + '–' + b.to) + '</th>'; }).join('')) + '</tr></thead><tbody>' +
        k.entries.map(function (en) { var t = E.prizeTable(kind, en); return '<tr><td>' + inr(en) + '</td><td class="num">' + num(E.COINS[en]) + '</td>' + t.bands.map(function (b) { return '<td class="num">' + inr(b.each) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div>';
    };
    return '<div class="lbl2">How it works</div><h2 class="big">Rules and prizes</h2><div class="two"><div class="panel"><h3 class="sec" style="margin-top:0">How to play</h3><ol class="steps">' +
      '<li>Sign up with your name, email and mobile number.</li><li>Add money to your wallet. You pay to the UPI ID shown and your wallet is credited once the payment is confirmed.</li>' +
      '<li>Pick a contest: 1 vs 1, League of 10 or Mega League 50, for a day, a week or a month.</li><li>You get virtual coins (1 coin = ₹1 of buying power in the game). Buy at least ' + E.MIN_STOCKS + ' stocks at the latest price. Coins you do not use stay as cash.</li>' +
      '<li>Your picks are locked when you confirm. On the last day, every portfolio is valued at the official NSE closing prices.</li><li>The highest portfolio value wins. Prizes go straight to the winners\' wallets.</li></ol>' +
      '<h3 class="sec">Fair play</h3><ul class="plain"><li>Everyone in a contest gets the same number of coins.</li><li>If players finish on exactly the same value, they share the prizes of the ranks they cover equally.</li><li>If the market is closed on the last day, the next trading day\'s closing prices are used.</li><li>Coins are only for the game. They cannot be withdrawn and are not real shares.</li></ul></div>' +
      '<div><h3 class="sec" style="margin-top:0">1 vs 1</h3>' + tbl('h2h') + '<h3 class="sec">League of 10 (top 3 win)</h3>' + tbl('l10') + '<h3 class="sec">Mega League 50 (top 15 win)</h3>' + tbl('m50') + '<p class="muted small" style="margin-top:10px">Prizes are for full contests. Dalal Street League keeps the rest of the entries as its platform fee.</p></div></div>';
  }

  // ---------- owner ----------
  function ownerHtml() {
    if (!S.owner.pin) return '<div class="panel auth"><div class="lbl2">Owner</div><h2 class="big">Set your owner PIN</h2><p class="muted">Only the maker of Dalal Street League uses this tab. Choose a 4 to 6 digit PIN to lock it.</p><form class="form" id="pinSet" novalidate><label>New PIN<input name="p1" type="password" inputmode="numeric" maxlength="6" autocomplete="new-password"></label><label>Repeat PIN<input name="p2" type="password" inputmode="numeric" maxlength="6" autocomplete="new-password"></label><div class="row"><button class="primary" type="submit">Save PIN</button></div></form></div>';
    if (!ownerIn) return '<div class="panel auth"><div class="lbl2">Owner</div><h2 class="big">Owner access</h2><form class="form" id="pinIn" novalidate><label>Owner PIN<input name="p" type="password" inputmode="numeric" maxlength="6" autocomplete="current-password"></label><div class="row"><button class="primary" type="submit">Unlock</button></div></form></div>';
    var tabs = [['report', 'Report'], ['requests', 'Money requests'], ['players', 'Players'], ['contests', 'Contests'], ['settings', 'Settings & tools']];
    var pend = S.requests.filter(function (r) { return r.status === 'pending'; }).length;
    return '<div class="panel-head"><div><div class="lbl2">Owner · CA Deep Dalal</div><h2 class="big" style="margin-bottom:0">Dalal Street League control room</h2></div><button data-act="ownerLock">Lock</button></div>' +
      '<nav class="tabs sub">' + tabs.map(function (t) { return '<button data-act="otab" data-t="' + t[0] + '" class="' + (ownerTab === t[0] ? 'on' : '') + '">' + t[1] + (t[0] === 'requests' && pend ? ' (' + pend + ')' : '') + '</button>'; }).join('') + '</nav><div style="margin-top:12px">' +
      (ownerTab === 'report' ? reportHtml() : ownerTab === 'requests' ? requestsHtml() : ownerTab === 'players' ? playersHtml() : ownerTab === 'contests' ? contestsHtml() : settingsHtml()) + '</div>';
  }
  function stats() {
    var now = Date.now(), wk = 7 * 864e5, sumT = function (ty) { return S.txns.reduce(function (a, t) { return t.type === ty ? a + t.amt : a; }, 0); };
    var settled = S.contests.filter(function (c) { return c.status === 'settled'; }), live = S.contests.filter(function (c) { return c.status === 'live'; });
    var inLive = {}; live.forEach(function (c) { c.entries.forEach(function (e) { if (e.uid) inLive[e.uid] = 1; }); });
    var byKind = Object.keys(E.KINDS).map(function (k) {
      var cs = settled.filter(function (c) { return c.kind === k; });
      return { kind: k, label: E.KINDS[k].label, played: cs.length, live: live.filter(function (c) { return c.kind === k; }).length, gross: cs.reduce(function (a, c) { return a + c.result.gross; }, 0), paid: cs.reduce(function (a, c) { return a + c.result.paid; }, 0), commission: cs.reduce(function (a, c) { return a + c.result.commission; }, 0) };
    });
    return { players: S.users.length, active: S.users.filter(function (u) { return now - u.lastActive < wk; }).length, newWeek: S.users.filter(function (u) { return now - u.joined < wk; }).length, inLive: Object.keys(inLive).length,
      total: S.contests.length, live: live.length, settled: settled.length, byKind: byKind,
      gross: byKind.reduce(function (a, k) { return a + k.gross; }, 0), paid: byKind.reduce(function (a, k) { return a + k.paid; }, 0), commission: byKind.reduce(function (a, k) { return a + k.commission; }, 0),
      liveCommission: live.reduce(function (a, c) { return a + E.prizeTable(c.kind, c.entry).commission; }, 0),
      topups: sumT('topup'), entries: -sumT('entry'), prizes: sumT('prize'), withdrawn: -(sumT('withdraw') + sumT('refund')) - S.requests.reduce(function (a, r) { return r.kind === 'withdraw' && r.status === 'pending' ? a + r.amt : a; }, 0),
      float: E.r2(S.users.reduce(function (a, u) { return a + balance(u.id); }, 0)), pendTop: S.requests.filter(function (r) { return r.kind === 'topup' && r.status === 'pending'; }), pendWd: S.requests.filter(function (r) { return r.kind === 'withdraw' && r.status === 'pending'; }) };
  }
  function reportHtml() {
    var s = stats(), max = Math.max.apply(null, s.byKind.map(function (k) { return k.commission; }).concat([1]));
    var sumA = function (a) { return a.reduce(function (x, r) { return x + r.amt; }, 0); };
    return '<h3 class="sec" style="margin-top:0">Players</h3><div class="tiles">' + fact('Registered players', num(s.players), s.newWeek + ' joined in the last 7 days') + fact('Active players', num(s.active), 'Logged in or played in the last 7 days') + fact('Playing right now', num(s.inLive), 'Players in a live contest') + '</div>' +
      '<h3 class="sec">Contests</h3><div class="tiles">' + fact('Contests played', num(s.total), s.live + ' live · ' + s.settled + ' finished') + fact('Entries collected', inr(s.gross), 'All seats of finished contests') + fact('Prizes paid', inr(s.paid)) + fact('Your commission earned', '<span class="up">' + inr(s.commission) + '</span>', 'Finished contests') + fact('Commission coming', inr(s.liveCommission), 'From live contests') + '</div>' +
      '<div class="tbl"><table><thead><tr><th>Contest type</th><th class="num">Finished</th><th class="num">Live</th><th class="num">Entries</th><th class="num">Prizes</th><th class="num">Commission</th><th>Share</th></tr></thead><tbody>' + s.byKind.map(function (k) {
        return '<tr><td>' + esc(k.label) + '</td><td class="num">' + k.played + '</td><td class="num">' + k.live + '</td><td class="num">' + inr(k.gross) + '</td><td class="num">' + inr(k.paid) + '</td><td class="num">' + inr(k.commission) + '</td><td><div class="bar-cell"><i style="width:' + Math.round(k.commission / max * 120) + 'px"></i></div></td></tr>';
      }).join('') + '<tr class="tot"><td>Total</td><td class="num">' + s.settled + '</td><td class="num">' + s.live + '</td><td class="num">' + inr(s.gross) + '</td><td class="num">' + inr(s.paid) + '</td><td class="num">' + inr(s.commission) + '</td><td></td></tr></tbody></table></div>' +
      '<p class="muted small" style="margin-top:8px">Prototype note: opponents are simulated, so "Entries collected" and "Commission" count every seat as if a real player had paid for it. The wallet numbers below count only real players on this device.</p>' +
      '<h3 class="sec">Wallet money (real players)</h3><div class="tiles">' + fact('Top-ups approved', inr(s.topups)) + fact('Entry fees paid by players', inr(s.entries)) + fact('Prizes credited to players', inr(s.prizes)) + fact('Withdrawals paid', inr(s.withdrawn)) + fact('Money owed to players', inr(s.float), 'Total of all wallet balances') + fact('Top-ups waiting', s.pendTop.length + ' · ' + inr(sumA(s.pendTop))) + fact('Withdrawals waiting', s.pendWd.length + ' · ' + inr(sumA(s.pendWd))) + '</div>' +
      '<div class="row"><button data-act="csv" data-k="players">Download players (CSV)</button><button data-act="csv" data-k="contests">Download contests (CSV)</button><button data-act="csv" data-k="txns">Download wallet ledger (CSV)</button></div>';
  }
  function requestsHtml() {
    var name = function (uid) { var u = S.users.find(function (x) { return x.id === uid; }); return u ? esc(u.name) + '<br><span class="muted small">' + esc(u.mobile) + '</span>' : 'Unknown'; };
    var pend = S.requests.filter(function (r) { return r.status === 'pending'; }), done = S.requests.filter(function (r) { return r.status !== 'pending'; }).sort(function (a, b) { return b.id - a.id; }).slice(0, 50);
    var row = function (r, act) {
      return '<tr><td>' + esc(fmtTs(r.ts)) + '</td><td>' + name(r.uid) + '</td><td>' + (r.kind === 'topup' ? 'Add money' : 'Withdraw') + '</td><td class="num">' + inr(r.amt) + '</td><td>' + (r.kind === 'topup' ? 'UTR ' : 'Pay to ') + esc(r.ref) + '</td><td>' + (act ? '<button class="primary" data-act="approve" data-id="' + r.id + '">' + (r.kind === 'topup' ? 'Payment received, add to wallet' : 'I have paid this') + '</button> <button class="danger" data-act="reject" data-id="' + r.id + '">Reject</button>' : pill(r.status, r.status)) + '</td></tr>';
    };
    var head = '<thead><tr><th>Date</th><th>Player</th><th>Type</th><th class="num">Amount</th><th>Reference</th><th></th></tr></thead>';
    return '<h3 class="sec" style="margin-top:0">Waiting for you</h3>' + (pend.length ? '<p class="muted">For a top-up, check your UPI app for the same amount and reference number before you approve. For a withdrawal, pay the player first, then mark it paid.</p><div class="tbl"><table>' + head + '<tbody>' + pend.map(function (r) { return row(r, true); }).join('') + '</tbody></table></div>' : '<p class="muted">Nothing is waiting.</p>') +
      '<h3 class="sec">Recently handled</h3>' + (done.length ? '<div class="tbl"><table>' + head + '<tbody>' + done.map(function (r) { return row(r, false); }).join('') + '</tbody></table></div>' : '<p class="muted">None yet.</p>');
  }
  function decide(id, ok) {
    var r = S.requests.find(function (x) { return x.id === id; }); if (!r || r.status !== 'pending') return;
    var u = S.users.find(function (x) { return x.id === r.uid; }), who = u ? esc(u.name) : 'this player';
    var msg = r.kind === 'topup'
      ? (ok ? 'Add <b>' + inr(r.amt) + '</b> to ' + who + '\'s wallet? Only do this after you see the payment (UTR ' + esc(r.ref) + ') in your UPI app.' : 'Reject this top-up of <b>' + inr(r.amt) + '</b>? Nothing is added to the wallet.')
      : (ok ? 'Confirm you have paid <b>' + inr(r.amt) + '</b> to ' + esc(r.ref) + '?' : 'Reject this withdrawal? <b>' + inr(r.amt) + '</b> goes back to ' + who + '\'s wallet.');
    confirmBox(msg, function () {
      r.status = ok ? 'approved' : 'rejected'; r.doneTs = Date.now();
      if (r.kind === 'topup' && ok) txn(r.uid, 'topup', r.amt, { rid: r.id });
      if (r.kind === 'withdraw' && !ok) txn(r.uid, 'refund', r.amt, { rid: r.id });
      save(); render(); toast(ok ? 'Done.' : 'Rejected.');
    }, ok ? 'Yes, confirm' : 'Yes, reject');
  }
  function playersHtml() {
    if (!S.users.length) return '<p class="muted">No players have signed up yet.</p>';
    var now = Date.now();
    return '<div class="tbl"><table><thead><tr><th>Player</th><th>Email</th><th>Mobile</th><th>Joined</th><th>Last active</th><th class="num">Contests</th><th class="num">Entries paid</th><th class="num">Prizes won</th><th class="num">Wallet</th></tr></thead><tbody>' + S.users.map(function (u) {
      var n = S.contests.filter(function (c) { return c.entries.some(function (e) { return e.uid === u.id; }); }).length, s = function (ty) { return S.txns.reduce(function (a, t) { return t.uid === u.id && t.type === ty ? a + t.amt : a; }, 0); };
      return '<tr><td><b>' + esc(u.name) + '</b> ' + (now - u.lastActive < 7 * 864e5 ? pill('live', 'Active') : pill('done', 'Inactive')) + '</td><td>' + esc(u.email) + '</td><td>' + esc(u.mobile) + '</td><td>' + esc(fmtTs(u.joined)) + '</td><td>' + esc(fmtTs(u.lastActive)) + '</td><td class="num">' + n + '</td><td class="num">' + inr(-s('entry')) + '</td><td class="num">' + inr(s('prize')) + '</td><td class="num">' + inr(balance(u.id)) + '</td></tr>';
    }).join('') + '</tbody></table></div>';
  }
  function contestsHtml() {
    if (!S.contests.length) return '<p class="muted">No contests have been played yet.</p>';
    return '<div class="tbl"><table><thead><tr><th>#</th><th>Contest</th><th>Player</th><th>Started</th><th>Ends / settled</th><th>Status</th><th class="num">Entries</th><th class="num">Prizes</th><th class="num">Commission</th><th></th></tr></thead><tbody>' + S.contests.slice().sort(function (a, b) { return b.id - a.id; }).map(function (c) {
      var t = E.prizeTable(c.kind, c.entry), real = c.entries.filter(function (e) { return e.uid; }), done = c.status === 'settled';
      return '<tr><td>' + c.id + '</td><td>' + esc(cname(c)) + '</td><td>' + esc(real.map(function (e) { return e.name; }).join(', ')) + '</td><td>' + fmtDate(c.start) + '</td><td>' + fmtDate(done ? c.result.date : c.end) + '</td><td>' + (done ? pill('done', 'Finished') + (c.result.sim ? ' ' + pill('sim', 'Demo') : '') : pill('live', 'Live')) + '</td><td class="num">' + inr(t.gross) + '</td><td class="num">' + (done ? inr(c.result.paid) : '–') + '</td><td class="num">' + (done ? inr(c.result.commission) : '(' + inr(t.commission) + ')') + '</td><td><button data-act="detail" data-id="' + c.id + '" data-uid="' + (real[0] ? real[0].uid : '') + '">Open</button></td></tr>';
    }).join('') + '</tbody></table></div>';
  }
  function settingsHtml() {
    var simN = Object.keys(S.sim).length, live = S.contests.filter(function (c) { return c.status === 'live'; }).length;
    return '<div class="two"><div class="panel"><h3 class="sec" style="margin-top:0">Payments</h3><form class="form" id="upiForm" novalidate style="grid-template-columns:1fr"><label>UPI ID players pay to<input name="upi" value="' + esc(S.owner.upi) + '" placeholder="yourname@bank" autocapitalize="none"></label><label>Name shown to players<input name="payee" value="' + esc(S.owner.payee) + '"></label><div class="row"><button class="primary" type="submit">Save payment details</button></div></form>' +
      '<h3 class="sec">Owner PIN</h3><form class="form" id="pinChange" novalidate style="grid-template-columns:1fr"><label>New PIN (4 to 6 digits)<input name="p1" type="password" inputmode="numeric" maxlength="6" autocomplete="new-password"></label><div class="row"><button type="submit">Change PIN</button></div></form></div>' +
      '<div class="panel"><h3 class="sec" style="margin-top:0">Demo tools (prototype only)</h3><p class="muted">Real contests settle by themselves when the official closing prices of the last day arrive. To try the full flow today, you can add simulated closing days. Contests settled this way are marked "Demo".</p>' +
      '<div class="facts">' + fact('Last price day', fmtDate(P.last)) + fact('Simulated days', String(simN)) + fact('Live contests', String(live)) + '</div>' +
      '<div class="row"><button data-act="simDay">Simulate next closing day</button><button data-act="simAll"' + (live ? '' : ' disabled') + '>Fast-forward until all contests finish</button><button data-act="simClear"' + (simN ? '' : ' disabled') + '>Remove simulated days</button></div>' +
      '<h3 class="sec">Reset</h3><p class="muted">Deletes every player, wallet, contest and setting stored in this browser.</p><button class="danger" data-act="reset">Erase all prototype data</button></div></div>';
  }
  function simulate(untilAll) {
    var guard = 0, added = 0;
    do {
      var next = E.nextWeekday(P.last), rand = E.rng(E.hash('sim:' + next + ':' + Date.now()));
      S.sim[next] = E.simulateDay(P.closes[P.last], rand); added++; refreshView(); settleAll();
    } while (untilAll && S.contests.some(function (c) { return c.status === 'live'; }) && ++guard < 40);
    save(); render(); toast(added + ' simulated closing day(s) added.');
  }
  function csv(kind) {
    var rows;
    if (kind === 'players') rows = [['Name', 'Email', 'Mobile', 'Joined', 'Last active', 'Wallet balance']].concat(S.users.map(function (u) { return [u.name, u.email, u.mobile, new Date(u.joined).toISOString(), new Date(u.lastActive).toISOString(), balance(u.id)]; }));
    else if (kind === 'contests') rows = [['Contest no.', 'Type', 'Entry', 'Duration', 'Players', 'Start', 'End', 'Status', 'Settled on', 'Demo close', 'Entries collected', 'Prizes paid', 'Commission']].concat(S.contests.map(function (c) { var r = c.result || {}; return [c.id, E.KINDS[c.kind].label, c.entry, E.DURATIONS[c.duration], c.size, c.start, c.end, c.status, r.date || '', r.sim ? 'yes' : '', r.gross || '', r.paid == null ? '' : r.paid, r.commission == null ? '' : r.commission]; }));
    else rows = [['Txn no.', 'Date', 'Player', 'Mobile', 'Type', 'Amount', 'Contest no.']].concat(S.txns.map(function (t) { var u = S.users.find(function (x) { return x.id === t.uid; }) || {}; return [t.id, new Date(t.ts).toISOString(), u.name || '', u.mobile || '', TX[t.type], t.amt, t.cid || '']; }));
    var cell = function (v) { v = String(v == null ? '' : v); if (/^[=+\-@]/.test(v) && isNaN(Number(v))) v = "'" + v; return '"' + v.replace(/"/g, '""') + '"'; };
    var blob = new Blob(['﻿' + rows.map(function (r) { return r.map(cell).join(','); }).join('\r\n')], { type: 'text/csv' }), a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'DSL_FinDeependence_' + kind + '_' + E.istToday() + '.csv'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  }
  var pinOk = function (p) { return /^\d{4,6}$/.test(p); };

  // ---------- events ----------
  document.addEventListener('click', function (ev) {
    var tab = ev.target.closest('#tabs button'); if (tab) { view = tab.dataset.v; render(); window.scrollTo(0, 0); return; }
    var b = ev.target.closest('[data-act]'); if (!b) return;
    var a = b.dataset.act, u = me();
    if (a === 'go') { view = b.dataset.v; render(); }
    else if (a === 'logout') { S.session = null; draft = null; save(); view = 'play'; render(); }
    else if (a === 'refresh') loadPrices(true);
    else if (a === 'loginBox') loginBox();
    else if (a === 'seg') { if (b.dataset.id === 'fk') fk = b.dataset.val; else fd = b.dataset.val; render(); }
    else if (a === 'play') { startDraft(fk, Number(b.dataset.entry), fd, false); render(); window.scrollTo(0, 0); }
    else if (a === 'prizes') prizeBox(fk, Number(b.dataset.entry));
    else if (a === 'invite') inviteBox(Number(b.dataset.entry));
    else if (a === 'buy') buyBox(b.dataset.s);
    else if (a === 'drop') { delete draft.h[b.dataset.s]; render(); }
    else if (a === 'cancelDraft') { draft = null; render(); }
    else if (a === 'confirmJoin') confirmJoin();
    else if (a === 'detail') detailBox(Number(b.dataset.id), b.dataset.uid ? Number(b.dataset.uid) : (u && u.id));
    else if (a === 'addMoney') addMoneyBox();
    else if (a === 'withdraw') withdrawBox();
    else if (a === 'ownerLock') { ownerIn = false; try { sessionStorage.removeItem('dsl.owner'); } catch (e) { /* ignore */ } render(); }
    else if (!ownerIn) return;
    else if (a === 'otab') { ownerTab = b.dataset.t; render(); }
    else if (a === 'approve') decide(Number(b.dataset.id), true);
    else if (a === 'reject') decide(Number(b.dataset.id), false);
    else if (a === 'csv') csv(b.dataset.k);
    else if (a === 'simDay') simulate(false);
    else if (a === 'simAll') simulate(true);
    else if (a === 'simClear') confirmBox('Remove the simulated closing days? Contests that already finished keep their result.', function () { S.sim = {}; save(); refreshView(); render(); }, 'Remove');
    else if (a === 'reset') confirmBox('Erase <b>all</b> players, wallets, contests and settings stored in this browser? This cannot be undone.', function () { S = blank(); save(); ownerIn = false; draft = null; refreshView(); view = 'play'; render(); toast('All prototype data erased.'); }, 'Erase everything');
  });
  document.addEventListener('submit', function (ev) {
    var f = ev.target;
    if (f.id === 'signup') { ev.preventDefault(); doSignup(f); }
    else if (f.id === 'pinSet') { ev.preventDefault(); if (!pinOk(f.p1.value)) return toast('The PIN must be 4 to 6 digits.', true); if (f.p1.value !== f.p2.value) return toast('The two PINs do not match.', true); S.owner.pin = f.p1.value; ownerIn = true; try { sessionStorage.setItem('dsl.owner', '1'); } catch (e) { /* ignore */ } save(); render(); toast('Owner PIN saved.'); }
    else if (f.id === 'pinIn') { ev.preventDefault(); if (f.p.value !== S.owner.pin) return toast('Wrong PIN.', true); ownerIn = true; try { sessionStorage.setItem('dsl.owner', '1'); } catch (e) { /* ignore */ } render(); }
    else if (f.id === 'upiForm' && ownerIn) { ev.preventDefault(); var upi = f.upi.value.trim(), payee = f.payee.value.trim(); if (!/^[\w.\-]{2,}@[A-Za-z][\w]{1,}$/.test(upi)) return toast('Enter a valid UPI ID, like name@bank.', true); if (payee.length < 2) return toast('Enter the name players will see.', true); S.owner.upi = upi; S.owner.payee = payee; save(); render(); toast('Payment details saved.'); }
    else if (f.id === 'pinChange' && ownerIn) { ev.preventDefault(); if (!pinOk(f.p1.value)) return toast('The PIN must be 4 to 6 digits.', true); S.owner.pin = f.p1.value; save(); f.reset(); toast('PIN changed.'); }
  });
  document.addEventListener('input', function (ev) {
    var t = ev.target;
    if (t.id === 'stockSearch') { q = t.value; $('#stockRail').innerHTML = railList(); }
    else if (t.id === 'mktSearch') { mq = t.value; $('#mktBody').innerHTML = marketRows(); }
  });
  document.addEventListener('change', function (ev) { if (ev.target.id === 'secSel') { sec = ev.target.value; $('#stockRail').innerHTML = railList(); } });

  // ---------- start ----------
  (function () {
    var m = /[?&]c=(h2h|l10|m50)-(\d+)-(day|week|month)\b/.exec(location.search);
    if (m && E.KINDS[m[1]].entries.indexOf(Number(m[2])) >= 0) { invite = { kind: m[1], entry: Number(m[2]), duration: m[3] }; fk = m[1]; fd = m[3]; }
  })();
  var u0 = me(); if (u0) { touch(u0); save(); if (invite) { startDraft(invite.kind, invite.entry, invite.duration, true); invite = null; } }
  settleAll(); render();
  loadPrices(false);
  setInterval(function () { if (!document.hidden && $('#modal').hidden && !draft) loadPrices(false); }, 5 * 60 * 1000);
})();
