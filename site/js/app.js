/* Dalal Street League (DSL) by FinDeependence · Created by CA Deep Dalal
   The app: sign-up, wallet with owner-approved top-ups, contests between real players, owner control room.
   Data lives in Supabase (see supabase/setup.sql). Players can only read their own rows; every change goes through a database function. */
(function () {
  'use strict';
  var E = window.DSL.E, U = [], CFG = window.DSL_CONFIG, BY = {};
  // Stock list: the Nifty 500 from site/data/universe.json (written by the daily sync), else the built-in list.
  var CAPS = { L: 'Large', M: 'Mid', S: 'Small' };
  function setUniverse(list) { U = list.filter(function (u) { return u && u.s; }); BY = {}; U.forEach(function (u) { if (!CAPS[u.c]) u.c = 'L'; BY[u.s] = u; }); }
  setUniverse(window.DSL_UNIVERSE);
  function loadUniverse() {
    return fetch('data/universe.json', { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { if (j && j.stocks && j.stocks.length >= 100) setUniverse(j.stocks); }, function () {});
  }
  var nameOf = function (s) { return BY[s] ? BY[s].n : s; };
  var capPill = function (c) { return '<span class="cap cap-' + c + '">' + CAPS[c] + '</span>'; };
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var num = function (n, d) { return Number(n).toLocaleString('en-IN', { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 }); };
  var inr = function (n) { n = Number(n) || 0; return (n < 0 ? '-' : '') + '₹' + num(Math.abs(n), Math.abs(n) % 1 ? 2 : 0); };
  var px2 = function (n) { return '₹' + num(n, 2); };
  var fmtDate = function (d) { return new Date(d + 'T00:00:00Z').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }); };
  var fmtTs = function (t) { return new Date(t).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' }); };   // always Indian time
  var pct = function (n) { return '<span class="' + (n > 0 ? 'up' : n < 0 ? 'down' : '') + '">' + (n > 0 ? '+' : '') + num(n, 2) + '%</span>'; };

  var sb = window.supabase.createClient(CFG.url, CFG.anon);
  // Supabase calls resolve to { data, error }; turn an error into a thrown one.
  function q(p) { return p.then(function (r) { if (r.error) throw r.error; return r.data; }); }
  function errMsg(e) {
    var m = (e && e.message) || String(e);
    if (/failed to fetch|networkerror|load failed/i.test(m)) return 'Could not reach the server. Check your internet connection and try again.';
    if (/invalid login credentials/i.test(m)) return 'Wrong email or password.';
    if (/^user already registered|email.*already been registered/i.test(m)) return 'This email is already registered. Use "I already have an account".';
    if (/email not confirmed/i.test(m)) return 'Please confirm your email first (check your inbox), then log in.';
    if (/dsl_profiles_mobile_key|database error saving new user/i.test(m)) return 'This mobile number is already registered.';
    if (/jwt expired|invalid jwt/i.test(m)) return 'Your session has expired. Please log in again.';
    return m;
  }

  // ---------- state ----------
  var view = 'play', draft = null, capF = '', mcap = '', msort = 'az', lbDays = 7, LB = {}, fk = 'h2h', fd = 'day', cSize = 5, cEntry = 99, sq = '', sec = '', mq = '', ownerTab = 'report', busy = false, booted = false;
  var P = null;                                     // price view (null until prices load)
  var D = { user: null, profile: null, balance: 0, settings: { upi: '', payee: 'CA Deep Dalal' }, txns: [], requests: [], entries: [], open: [] };
  var O = { report: null, requests: [], players: [], contests: [] };   // owner data
  var closeCache = {};
  var me = function () { return D.profile; };
  var isOwner = function () { return !!(D.profile && D.profile.is_owner); };
  var isOpen = function (c) { return c.status === 'open' && Date.now() < new Date(c.lock_at).getTime(); };          // still taking entries
  var kname = function (c) { return c.kind === 'custom' ? 'Private tournament of ' + c.size : E.KINDS[c.kind].label; };
  var rankName = function (b) { return b.from === b.to ? 'Rank ' + b.from : 'Ranks ' + b.from + ' to ' + b.to; };
  var cname = function (c) { return kname(c) + ' · ' + inr(c.entry) + ' · ' + E.DURATIONS[c.duration]; };

  // ---------- small UI helpers (same pattern as the FinDeependence IPO Deal Desk) ----------
  var tt;
  function toast(msg, err) { var t = $('#toast'); t.textContent = msg; t.className = 'show' + (err ? ' err' : ''); clearTimeout(tt); tt = setTimeout(function () { t.className = ''; }, err ? 5200 : 2600); }
  var fail = function (e) { toast(errMsg(e), true); };
  function modal(html, onMount) {
    var m = $('#modal'), b = $('#modalBody');
    b.innerHTML = html; m.hidden = false;
    var key = function (e) { if (e.key === 'Escape') close(); };
    function close() { m.hidden = true; b.innerHTML = ''; document.removeEventListener('keydown', key); }
    document.addEventListener('keydown', key);
    m.onclick = function (e) { if (e.target === m) close(); };
    b.querySelectorAll('[data-close]').forEach(function (x) { x.onclick = close; });
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
  // Run one server action at a time; ignore double taps.
  function act(fn, done) {
    if (busy) return Promise.resolve();
    busy = true; document.body.classList.add('busy');
    var end = function () { busy = false; document.body.classList.remove('busy'); };
    return fn().then(function (r) { end(); if (done) done(r); }, function (e) { end(); fail(e); });
  }

  // ---------- loading ----------
  function loadPrices() {
    return Promise.all([
      q(sb.from('dsl_prices').select('d,closes').order('d', { ascending: false }).limit(2)),
      q(sb.from('dsl_quotes').select('d,t,px').eq('id', 1).maybeSingle())
    ]).then(function (r) {
      var rows = r[0], qt = r[1];
      if (!rows.length) { P = null; return; }
      var closes = {}; rows.forEach(function (x) { closes[x.d] = x.closes; closeCache[x.d] = x.closes; });
      P = E.priceView({ source: 'nse', closes: closes, quotes: qt && qt.px && qt.d ? { date: qt.d, time: qt.t, px: qt.px } : null }, {});
    });
  }
  function closesOn(d) {
    if (closeCache[d]) return Promise.resolve(closeCache[d]);
    return q(sb.from('dsl_prices').select('closes').eq('d', d).maybeSingle()).then(function (r) { closeCache[d] = r ? r.closes : {}; return closeCache[d]; });
  }
  function loadOpen() {
    return q(sb.from('dsl_contests').select('kind,entry,duration,end_date,joined,size,lock_at,status').eq('status', 'open').eq('private', false)).then(function (r) { D.open = r; });
  }
  function loadMe() {
    if (!D.user) { D.profile = null; return Promise.resolve(); }
    var uid = D.user.id;
    return Promise.all([
      q(sb.from('dsl_profiles').select('*').eq('id', uid).maybeSingle()),
      q(sb.rpc('dsl_my_balance')),
      q(sb.from('dsl_settings').select('upi,payee').eq('id', 1).maybeSingle()),
      q(sb.from('dsl_txns').select('*').eq('uid', uid).order('id', { ascending: false }).limit(200)),
      q(sb.from('dsl_requests').select('*').eq('uid', uid).order('id', { ascending: false }).limit(50)),
      q(sb.from('dsl_entries').select('id,contest_id,holdings,cash,value,rank,prize,created,c:dsl_contests(*)').eq('uid', uid).order('id', { ascending: false }).limit(100)),
      loadOpen()
    ]).then(function (r) {
      D.profile = r[0]; D.balance = r[1] || 0; if (r[2]) D.settings = r[2]; D.txns = r[3]; D.requests = r[4]; D.entries = r[5];
    });
  }
  function loadOwner() {
    if (!isOwner()) return Promise.resolve();
    return Promise.all([
      q(sb.rpc('dsl_owner_report')),
      q(sb.from('dsl_requests').select('*,p:dsl_profiles(name,mobile)').order('id', { ascending: false }).limit(200)),
      q(sb.rpc('dsl_owner_players')),
      q(sb.from('dsl_contests').select('*,dsl_entries(name)').order('id', { ascending: false }).limit(300))
    ]).then(function (r) { O.report = r[0]; O.requests = r[1]; O.players = r[2]; O.contests = r[3]; });
  }
  function reload() { return Promise.all([loadPrices(), loadMe()]).then(function () { return view === 'owner' ? loadOwner() : null; }); }
  var chg = function (s) { var a = P.px[s], b = P.prev[s]; return a > 0 && b > 0 ? E.r2((a / b - 1) * 100) : 0; };
  var stocks = function () { return P ? U.filter(function (u) { return P.px[u.s] > 0; }) : []; };

  // ---------- render shell ----------
  function render() {
    var u = me();
    document.querySelectorAll('#tabs button').forEach(function (b) { b.classList.toggle('on', b.dataset.v === view); if (b.dataset.v === 'owner') b.hidden = !isOwner(); });
    $('#playerbar').innerHTML = u
      ? '<div class="who">Hi, ' + esc(u.name.split(' ')[0]) + ' <span class="lvl" title="Your level">' + esc(level(myStats().xp).name) + '</span></div><div class="row"><span class="bal" title="Wallet balance">Wallet ' + inr(D.balance) + '</span><button data-act="go" data-v="wallet">Add money</button><button data-act="logout">Log out</button></div>'
      : '';
    var note = '';
    if (booted && !P) note = '<div class="notice"><b>Prices are not loaded yet.</b> Stock prices arrive from NSE after the first price update. Contests open as soon as they are in. <button data-act="refresh">Check again</button></div>';
    else if (booted) note = '<div class="notice ok"><b>Prices:</b> ' + (P.live ? 'delayed quotes (about 15 min) as of ' + esc(fmtTs(P.quoteTime)) : 'official NSE closing prices of ' + fmtDate(P.last)) + '. Winners are always decided on official closing prices. <button data-act="refresh">Refresh</button></div>';
    if (D.user && booted && !u) note += '<div class="notice">Your account has no player profile. Please log out and sign up again with your name and mobile number.</div>';
    $('#notices').innerHTML = note;
    var v = $('#view');
    if (!booted) v.innerHTML = '<div class="panel empty"><span>Loading Dalal Street League…</span></div>';
    else if (view === 'play') v.innerHTML = !u ? authHtml() : draft ? builderHtml() : heroHtml() + lobbyHtml();
    else if (view === 'mine') v.innerHTML = !u ? authHtml() : mineHtml();
    else if (view === 'leaders') v.innerHTML = !u ? authHtml() : leadersHtml();
    else if (view === 'wallet') v.innerHTML = !u ? authHtml() : walletHtml();
    else if (view === 'market') v.innerHTML = marketHtml();
    else if (view === 'rules') v.innerHTML = rulesHtml();
    else v.innerHTML = isOwner() ? ownerHtml() : authHtml();
  }

  // ---------- sign up / log in ----------
  function authHtml() {
    if (D.user) return '<div class="panel empty"><span>This section needs a player profile.</span><button data-act="logout">Log out</button></div>';
    return '<div class="panel auth"><div class="lbl2">Welcome</div><h2 class="big">Join Dalal Street League</h2>' +
      '<p class="muted">Build a stock portfolio with virtual coins and beat your rival on closing prices.</p>' +
      '<form class="form" id="signup" novalidate><label>Full name<input name="name" autocomplete="name" required></label>' +
      '<label>Email<input name="email" type="email" autocomplete="email" required></label>' +
      '<label>Mobile number (10 digits)<input name="mobile" inputmode="numeric" maxlength="10" autocomplete="tel-national" required></label>' +
      '<label>Choose a password (at least 6 characters)<input name="password" type="password" autocomplete="new-password" required></label>' +
      '<label class="check" style="flex-direction:row;align-items:flex-start;gap:8px;text-transform:none;letter-spacing:0;font-size:13px"><input type="checkbox" name="age" style="margin-top:3px"> I am 18 or older and I accept the game rules.</label>' +
      '<div class="row"><button class="primary" type="submit">Create my account</button><button type="button" data-act="loginBox">I already have an account</button></div></form></div>';
  }
  function doSignup(f) {
    var name = f.name.value.trim().replace(/\s+/g, ' '), email = f.email.value.trim().toLowerCase(), mobile = f.mobile.value.replace(/\D/g, ''), pw = f.password.value;
    if (name.length < 2 || name.length > 60) return toast('Enter your full name.', true);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return toast('Enter a valid email address.', true);
    if (!/^[6-9]\d{9}$/.test(mobile)) return toast('Enter a valid 10-digit Indian mobile number.', true);
    if (pw.length < 6) return toast('Choose a password of at least 6 characters.', true);
    if (!f.age.checked) return toast('Please confirm you are 18 or older.', true);
    act(function () {
      return q(sb.rpc('dsl_mobile_taken', { p_mobile: mobile })).then(function (taken) {
        if (taken) throw new Error('This mobile number is already registered. Use "I already have an account".');
        return q(sb.auth.signUp({ email: email, password: pw, options: { data: { name: name, mobile: mobile, ref: refCode || '' } } }));
      }).then(function (r) {
        if (!r.session) return { confirm: true };
        D.user = r.session.user; return reload();
      });
    }, function (r) {
      if (r && r.confirm) return modal('<h2>Check your email</h2><p>Your account is created. Open the confirmation link we sent to <b>' + esc(email) + '</b>, then log in here.</p><div class="row" style="justify-content:flex-end"><button class="primary" data-close>OK</button></div>');
      afterLogin(); if (me()) toast('Welcome, ' + me().name + '!');
    });
  }
  function loginBox() {
    modal('<h2>Log in</h2><form class="form" id="login" novalidate style="grid-template-columns:1fr"><label>Email<input name="email" type="email" autocomplete="email" required></label><label>Password<input name="password" type="password" autocomplete="current-password" required></label><div class="row"><button type="button" data-close>Cancel</button><button type="button" id="forgot">Forgot password</button><button class="primary" type="submit">Log in</button></div></form>', function (b, close) {
      var f = $('#login', b);
      f.onsubmit = function (ev) {
        ev.preventDefault();
        var email = f.email.value.trim().toLowerCase(), pw = f.password.value;
        if (!email || !pw) return toast('Enter your email and password.', true);
        act(function () { return q(sb.auth.signInWithPassword({ email: email, password: pw })).then(function (r) { D.user = r.user; return q(sb.rpc('dsl_touch')); }).then(reload); },
          function () { close(); afterLogin(); if (me()) toast('Welcome back, ' + me().name + '!'); });
      };
      $('#forgot', b).onclick = function () {
        var email = f.email.value.trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return toast('Type your email above first.', true);
        act(function () { return q(sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname })); }, function () { close(); toast('If this email is registered, a reset link is on its way.'); });
      };
    });
  }
  function newPasswordBox() {
    modal('<h2>Set a new password</h2><form class="form" id="newPw" novalidate style="grid-template-columns:1fr"><label>New password (at least 6 characters)<input name="password" type="password" autocomplete="new-password"></label><div class="row"><button class="primary" type="submit">Save password</button></div></form>', function (b, close) {
      $('#newPw', b).onsubmit = function (ev) {
        ev.preventDefault(); var pw = this.password.value;
        if (pw.length < 6) return toast('Choose a password of at least 6 characters.', true);
        act(function () { return q(sb.auth.updateUser({ password: pw })); }, function () { close(); toast('Password changed.'); });
      };
    });
  }
  var inviteCode = null, refCode = null;
  function afterLogin() {
    setTimeout(showResults, 0);
    if (inviteCode && me()) { var code = inviteCode; inviteCode = null; openChallenge(code); }
    render();
  }
  function openChallenge(code) {
    q(sb.rpc('dsl_challenge_info', { p_code: code })).then(function (i) {
      if (!i) return toast('This invite link is not valid.', true);
      if (i.mine) { view = 'mine'; render(); return toast('You are already in this contest.'); }
      if (!i.open) return toast('This contest is full or its entries have closed.', true);
      startDraft(i.kind, i.entry, i.duration, { code: code, end: i.end_date, by: i.by, size: i.size }); render();
    }, fail);
  }

  // ---------- lobby ----------
  function seg(id, opts, cur) { return '<div class="seg">' + opts.map(function (o) { return '<button data-act="seg" data-id="' + id + '" data-val="' + o[0] + '" class="' + (o[0] === cur ? 'on' : '') + '" data-cat="">' + esc(o[1]) + '</button>'; }).join('') + '</div>'; }
  function lobbyHtml() {
    var end = E.endDate(E.istToday(), fd), lock = E.lockAt(E.istToday());
    var filters = '<div class="filters">' + seg('fk', Object.keys(E.KINDS).map(function (x) { return [x, E.KINDS[x].label]; }), fk) + seg('fd', Object.keys(E.DURATIONS).map(function (x) { return [x, E.DURATIONS[x]]; }), fd) + '</div>';
    var foot = '<p class="muted small" style="margin-top:12px">You play against real players. Entries close at ' + esc(fmtTs(lock)) + ' (when the market next opens). The contest then runs with everyone who joined, and prizes follow the number of players. If nobody else joins, your entry comes back in full.</p>' + inviteAppHtml();
    if (fk === 'custom') return '<div class="lbl2">Play with people you know</div><h2 class="big">Private tournament · ' + esc(E.DURATIONS[fd]) + '</h2>' + filters + customHtml(end) + foot;
    var k = E.KINDS[fk];
    var cards = E.ENTRIES.map(function (en) {
      var t = E.prizePlan(k.size, en, fd), same = function (c) { return c.kind === fk && c.entry === en && c.duration === fd && c.end_date === end && isOpen(c); };
      var mineIn = D.entries.some(function (e) { return !e.c.private && same(e.c); });
      var waiting = D.open.filter(same).reduce(function (a, c) { return a + c.joined; }, 0);
      return '<div class="ccard"><div class="top"><div><div class="lbl2">Entry</div><div class="entry">' + inr(en) + '</div></div><div class="win">' + (fk === 'h2h' ? 'Winner gets<br>' + inr(t.prizes[0]) : '1st prize up to ' + inr(t.prizes[0]) + '<br>' + t.winners + ' of ' + k.size + ' win') + '</div></div>' +
        '<div class="meta">' + fact('Coins to invest', num(E.COINS[en])) + fact('Players', (fk === 'h2h' ? '' : 'Up to ') + k.size, waiting ? waiting + ' joined so far' + (mineIn ? ' (you too)' : '') : 'Be the first to join') + fact('Ends at close of', fmtDate(end)) + fact(fk === 'h2h' ? 'Prize' : 'Prizes if full', inr(t.prizeTotal)) + '</div>' +
        '<div class="row"><button class="primary" data-act="play" data-entry="' + en + '"' + (P ? '' : ' disabled') + '>Play</button>' + (fk === 'h2h' ? '<button data-act="invite" data-entry="' + en + '"' + (P ? '' : ' disabled') + '>Challenge a friend</button>' : '<button data-act="prizes" data-entry="' + en + '">Prize table</button>') + '</div></div>';
    }).join('');
    return '<div class="lbl2">Pick a contest</div><h2 class="big">' + esc(k.label) + ' · ' + esc(E.DURATIONS[fd]) + '</h2>' + filters + '<div class="cards">' + cards + '</div>' + foot;
  }
  function planTable(t) {
    return '<div class="tbl"><table><thead><tr><th>Rank</th><th class="num">Prize each</th><th class="num">Times the entry</th></tr></thead><tbody>' +
      t.bands.map(function (b) { return '<tr><td>' + rankName(b) + '</td><td class="num">' + inr(b.each) + '</td><td class="num">' + num(b.each / t.entry, 2) + 'x</td></tr>'; }).join('') +
      '<tr class="tot"><td>' + t.winners + ' of ' + t.n + ' players win</td><td class="num">' + inr(t.prizeTotal) + '</td><td></td></tr></tbody></table></div>';
  }
  function customHtml(end) {
    var t = E.prizePlan(cSize, cEntry, fd);
    return '<div class="two"><div class="panel"><h3 class="sec" style="margin-top:0">Set up your tournament</h3><p class="muted">Only people with your link can join. You choose the seats and the entry; everyone gets the same coins.</p>' +
      '<div class="form" style="background:transparent;border:none;padding:0"><label>Number of players (2 to 100)<input id="cSize" type="number" min="2" max="100" step="1" value="' + cSize + '" inputmode="numeric"></label>' +
      '<label>Entry for each player<select id="cEntry">' + E.ENTRIES.map(function (en) { return '<option value="' + en + '"' + (en === cEntry ? ' selected' : '') + '>' + inr(en) + ' · ' + num(E.COINS[en]) + ' coins</option>'; }).join('') + '</select></label></div>' +
      '<div class="facts">' + fact('Length', esc(E.DURATIONS[fd])) + fact('Ends at close of', fmtDate(end)) + fact('Coins each', num(E.COINS[cEntry])) + '</div>' +
      '<div class="row"><button class="primary" data-act="customGo"' + (P ? '' : ' disabled') + '>Pick my stocks and get the link</button></div></div>' +
      '<div><h3 class="sec" style="margin-top:0">Prizes with all ' + cSize + ' players</h3><div id="cPlan">' + planTable(t) + '</div><p class="muted small" style="margin-top:8px">If fewer friends join, the tournament still runs and the prize table adjusts to the number of players.</p></div></div>';
  }
  function inviteAppHtml() {
    var u = me(); if (!u || !u.ref_code) return '';
    var link = location.origin + location.pathname + '?ref=' + encodeURIComponent(u.ref_code);
    var msg = 'Play Dalal Street League by FinDeependence with me: build a stock portfolio with virtual coins and beat your rivals. ' + link;
    return '<div class="panel" style="margin-top:16px"><div class="lbl2">Invite friends</div><p style="margin:6px 0 10px">Share your link. Friends who sign up with it are counted as invited by you.</p><div class="upi" id="refLink">' + esc(link) + '</div>' +
      '<div class="row" style="margin-top:10px"><button data-act="copy" data-text="' + esc(link) + '">Copy link</button><a class="fakebtn" target="_blank" rel="noopener" href="https://wa.me/?text=' + encodeURIComponent(msg) + '">Share on WhatsApp</a></div></div>';
  }
  function prizeBox(n, entry, duration, note) {
    var t = E.prizePlan(n, entry, duration);
    modal('<h2>' + inr(entry) + ' entry · ' + n + ' players · ' + esc(E.DURATIONS[duration]) + '</h2>' + planTable(t) +
      '<p class="muted small">' + esc(note || '') + ' If players finish on exactly the same value, they share the prizes of the ranks they cover equally.</p><div class="row" style="justify-content:flex-end"><button data-close>Close</button></div>');
  }
  var challengeLink = function (code) { return location.origin + location.pathname + '?j=' + encodeURIComponent(code); };
  function copyText(text) { (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(function () { toast('Link copied'); }, function () { toast('Select the link and copy it.', true); }); }
  function shareBox(c) {
    var link = challengeLink(c.code), what = c.size === 2 ? '1 vs 1' : (c.private ? 'a private tournament of up to ' : 'a league of up to ') + c.size + ' players';
    var msg = 'Join me on Dalal Street League by FinDeependence! ' + what.charAt(0).toUpperCase() + what.slice(1) + ', ' + inr(c.entry) + ' entry, ' + E.DURATIONS[c.duration].toLowerCase() + ' contest. Pick your stocks before ' + fmtTs(c.lock_at) + ': ' + link;
    modal('<h2>Invite friends to this contest</h2><p>Anyone who opens this link joins the same contest: ' + esc(what) + ', ' + inr(c.entry) + ' entry, ending at the close of ' + fmtDate(c.end_date) + '.</p><div class="upi" id="invLink">' + esc(link) + '</div>' +
      '<p class="muted small">Entries close at ' + esc(fmtTs(c.lock_at)) + '. The contest runs with everyone who joined by then; if nobody else joins, your entry comes back in full.</p>' +
      '<div class="row" style="justify-content:flex-end;margin-top:12px"><button data-close>Close</button><button data-act="copy" data-text="' + esc(link) + '">Copy link</button><a class="fakebtn" target="_blank" rel="noopener" href="https://wa.me/?text=' + encodeURIComponent(msg) + '">Share on WhatsApp</a></div>');
  }

  // ---------- portfolio builder ----------
  function startDraft(kind, entry, duration, opt) {
    opt = opt || {};
    var size = E.KINDS[kind] && (E.KINDS[kind].size || opt.size);
    if (!size || size < E.MIN_SIZE || size > E.MAX_SIZE || E.ENTRIES.indexOf(entry) < 0 || !E.DURATIONS[duration] || !P) return;
    draft = { kind: kind, entry: entry, duration: duration, size: size, coins: E.COINS[entry], private: !!opt.private, code: opt.code || null, by: opt.by || null, end: opt.end || E.endDate(E.istToday(), duration), h: {} };
    view = 'play'; sq = ''; sec = '';
  }
  var draftHoldings = function () { return Object.keys(draft.h).filter(function (s) { return P.px[s] > 0; }).map(function (s) { return { s: s, q: draft.h[s], p: P.px[s] }; }); };
  function stockBtn(u, inTeam) {
    var c = chg(u.s);
    return '<button class="stock-btn' + (inTeam ? ' in' : '') + '" data-act="buy" data-s="' + esc(u.s) + '"><span class="nm">' + esc(u.s) + ' ' + capPill(u.c) + '</span><span class="px">' + px2(P.px[u.s]) + '</span><span class="sub">' + esc(u.n) + '</span><span class="chg ' + (c > 0 ? 'up' : c < 0 ? 'down' : '') + '">' + (c > 0 ? '+' : '') + num(c, 2) + '%</span></button>';
  }
  function railList() {
    var s = sq.trim().toLowerCase();
    var list = stocks().filter(function (u) { return (!capF || u.c === capF) && (!sec || u.sec === sec) && (!s || u.s.toLowerCase().indexOf(s) >= 0 || u.n.toLowerCase().indexOf(s) >= 0); });
    var shown = list.slice(0, 150);
    return list.length ? shown.map(function (u) { return stockBtn(u, !!draft.h[u.s]); }).join('') + (list.length > shown.length ? '<p class="muted small">Showing 150 of ' + list.length + '. Search or filter to find more.</p>' : '') : '<p class="muted small">No stock matches.</p>';
  }
  function builderHtml() {
    var hs = draftHoldings(), cost = E.cost(hs), left = E.r2(draft.coins - cost), t = E.prizePlan(draft.size, draft.entry, draft.duration);
    var secs = Array.from(new Set(U.map(function (u) { return u.sec; }))).sort();
    var rows = hs.map(function (h) {
      return '<tr><td><b>' + esc(h.s) + '</b> ' + (BY[h.s] ? capPill(BY[h.s].c) : '') + '<br><span class="muted small">' + esc(nameOf(h.s)) + '</span></td><td class="num">' + num(h.q) + '</td><td class="num">' + px2(h.p) + '</td><td class="num">' + num(h.q * h.p, 2) + '</td><td class="num">' + num(h.q * h.p / draft.coins * 100, 1) + '%</td><td><button data-act="buy" data-s="' + esc(h.s) + '">Change</button> <button class="danger" data-act="drop" data-s="' + esc(h.s) + '">Remove</button></td></tr>';
    }).join('');
    var err = E.validate(hs, draft.coins), tag = draft.code ? ' · invited by ' + esc(draft.by || 'a friend') : draft.private ? ' · private' : '';
    var capChips = '<div class="chips capchips">' + [['', 'All']].concat(Object.keys(CAPS).map(function (c) { return [c, CAPS[c] + ' cap']; })).map(function (x) { return '<button data-act="capF" data-c="' + x[0] + '" class="' + (capF === x[0] ? 'on' : '') + '">' + x[1] + '</button>'; }).join('') + '</div>';
    var last = lastPortfolio();
    var tools = '<div class="row" style="margin:-4px 0 12px">' + (hs.length >= 2 ? '<button data-act="split">Split coins equally</button>' : '') + (last ? '<button data-act="reuse">Reuse my last portfolio</button>' : '') + (hs.length ? '<button class="danger" data-act="clearAll">Clear all</button>' : '') + '</div>';
    return '<div class="apply"><aside class="rail"><div class="rail-head"><h2>Stocks</h2><select id="secSel" aria-label="Sector"><option value="">All sectors</option>' + secs.map(function (x) { return '<option' + (x === sec ? ' selected' : '') + '>' + esc(x) + '</option>'; }).join('') + '</select></div>' +
      capChips + '<input type="search" id="stockSearch" placeholder="Search ' + stocks().length + ' stocks" aria-label="Search stock" value="' + esc(sq) + '"><div class="ipo-list" id="stockRail">' + railList() + '</div></aside>' +
      '<div class="panel"><div class="panel-head"><div><div class="lbl2">Build your portfolio' + tag + '</div><h2>' + esc(kname(draft)) + ' · ' + inr(draft.entry) + ' · ' + esc(E.DURATIONS[draft.duration]) + '</h2></div><button data-act="cancelDraft">Back to contests</button></div>' +
      '<div class="facts">' + fact('Coins given', num(draft.coins)) + fact('Invested', num(cost, 2)) + fact('Coins left', '<span class="' + (left < 0 ? 'down' : '') + '">' + num(left, 2) + '</span>', 'Unused coins stay as cash') + fact(draft.size === 2 ? 'You win' : '1st prize if full', inr(t.prizes[0])) + fact('Ends at close of', fmtDate(draft.end)) + '</div>' +
      '<div class="meter' + (left < 0 ? ' over' : '') + '"><i style="width:' + Math.min(100, cost / draft.coins * 100) + '%"></i></div>' + capMix(hs, draft.coins) + tools +
      (hs.length ? '<div class="tbl"><table><thead><tr><th>Stock</th><th class="num">Shares</th><th class="num">Buy price</th><th class="num">Coins</th><th class="num">Weight</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>'
        : '<div class="empty"><b>No stocks yet</b><span>Tap a stock on the list to buy it with your coins. Pick at least ' + E.MIN_STOCKS + '.</span></div>') +
      '<div class="backup"><p class="muted">' + (err ? esc(err) : 'Ready. Entry of ' + inr(draft.entry) + ' is taken from your wallet when you confirm. You buy at the price at that moment, and picks cannot be changed afterwards.') + '</p><button class="primary" data-act="confirmJoin"' + (err ? ' disabled' : '') + '>Confirm and pay ' + inr(draft.entry) + '</button></div></div></div>';
  }
  // Coins split by market-cap group, as a stacked bar.
  function capMix(hs, coins) {
    if (!hs.length) return '';
    var by = { L: 0, M: 0, S: 0 }; hs.forEach(function (h) { by[BY[h.s] ? BY[h.s].c : 'L'] += h.q * h.p; });
    var seg = function (c) { var w = by[c] / coins * 100; return w > 0 ? '<i class="cap-' + c + '" style="width:' + w + '%"></i>' : ''; };
    return '<div class="mix"><div class="mixbar">' + seg('L') + seg('M') + seg('S') + '</div><div class="mixkey">' + Object.keys(CAPS).map(function (c) { return '<span><b class="dot cap-' + c + '"></b>' + CAPS[c] + ' ' + num(by[c] / coins * 100, 0) + '%</span>'; }).join('') + '</div></div>';
  }
  // The portfolio of the player's latest contest, as share of coins per stock.
  function lastPortfolio(e) {
    e = e || D.entries[0]; if (!e || !e.holdings || !e.holdings.length) return null;
    return { weights: e.holdings.map(function (h) { return { s: h.s, w: h.q * h.p / e.c.coins }; }) };
  }
  function applyWeights(lp) {
    draft.h = {};
    lp.weights.forEach(function (x) { var p = P.px[x.s]; if (p > 0) { var q = Math.floor(x.w * draft.coins / p); if (q > 0) draft.h[x.s] = q; } });
  }
  function splitEqually() {
    var syms = Object.keys(draft.h).filter(function (s) { return P.px[s] > 0; }); if (!syms.length) return;
    var each = draft.coins / syms.length; draft.h = {};
    syms.forEach(function (s) { var q = Math.floor(each / P.px[s]); if (q > 0) draft.h[s] = q; });
    // Spend what rounding left over: one share at a time to the stock that has the least so far.
    var spent = function () { return E.cost(draftHoldings()); };
    for (var k = 0; k < 500; k++) {
      var left = draft.coins - spent(), pick = null;
      Object.keys(draft.h).forEach(function (s) { if (P.px[s] <= left && (!pick || draft.h[s] * P.px[s] < draft.h[pick] * P.px[pick])) pick = s; });
      if (!pick) break;
      draft.h[pick]++;
    }
    if (Object.keys(draft.h).length < syms.length) toast('Some stocks cost more than an equal share of your coins and were left out.', true);
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
  function confirmJoin() {
    var hs = draftHoldings(), err = E.validate(hs, draft.coins);
    if (err) return toast(err, true);
    var lim = limitInfo();
    if (lim.limit != null && lim.spent + draft.entry > lim.limit) return toast('This entry would take you over your daily limit of ' + inr(lim.limit) + '. You can change it in your wallet.', true);
    if (D.balance < draft.entry) {
      return modal('<h2>Add money to play</h2><p>This contest needs ' + inr(draft.entry) + ' and your wallet has ' + inr(D.balance) + '. Your stock picks are kept while you add money.</p><div class="row" style="justify-content:flex-end"><button data-close>Not now</button><button class="primary" id="goWallet">Go to wallet</button></div>', function (b, close) { $('#goWallet', b).onclick = function () { close(); view = 'wallet'; render(); }; });
    }
    var d = draft;
    confirmBox('Join <b>' + esc(kname(d)) + ' · ' + esc(E.DURATIONS[d.duration]) + '</b> for <b>' + inr(d.entry) + '</b>? Your ' + hs.length + ' stocks are locked until the close of ' + fmtDate(d.end) + '.', function () {
      var res;
      act(function () {
        return q(sb.rpc('dsl_join', { p_kind: d.kind, p_entry: d.entry, p_duration: d.duration, p_picks: hs.map(function (h) { return { s: h.s, q: h.q }; }), p_private: d.private, p_code: d.code, p_size: d.kind === 'custom' && !d.code ? d.size : null }))
          .then(function (r) { res = r; return reload(); });
      }, function () {
        draft = null; view = 'mine'; render();
        if (res.private && res.joined < res.size && !d.code) shareBox({ code: res.code, entry: d.entry, duration: d.duration, end_date: res.end_date, size: res.size, private: true, lock_at: res.lock_at });
        else toast(res.joined >= res.size ? 'You are in and the contest is full. Result at the close of ' + fmtDate(res.end_date) + '.' : 'You are in! ' + res.joined + ' of ' + res.size + ' joined. Invite friends from My Contests.');
      });
    }, 'Confirm and pay ' + inr(d.entry));
  }

  // ---------- my contests ----------
  var myValue = function (e) { return e.c.status === 'settled' && e.value != null ? Number(e.value) : E.value(e.holdings, Number(e.cash), P ? P.px : null); };
  function statusPill(c, e) {
    if (c.status === 'open') return isOpen(c) ? pill('pending', 'Open ' + c.joined + '/' + c.size) : pill('pending', 'Entries closed');
    if (c.status === 'live') return pill('live', 'Live');
    if (c.status === 'cancelled') return pill('done', 'Cancelled · refunded');
    return e && e.prize > 0 ? pill('won', 'Won ' + inr(e.prize)) : pill('done', 'Finished');
  }
  function mineHtml() {
    var list = D.entries;
    if (!list.length) return statsHtml() + '<div class="panel empty" style="margin-top:16px"><b>No contests yet</b><span>Join your first contest to see it here.</span><button class="primary" data-act="go" data-v="play">See contests</button></div>';
    var card = function (e) {
      var c = e.c, v = myValue(e), done = c.status === 'settled', mv = moveOf(e, v);
      return '<div class="ccard"><div class="top"><div><div class="lbl2">' + esc(kname(c)) + ' · ' + esc(E.DURATIONS[c.duration]) + (c.private && c.kind !== 'custom' ? ' · private' : '') + '</div><div class="entry">' + inr(c.entry) + '</div></div><div>' + statusPill(c, e) + '</div></div>' +
        '<div class="meta">' + fact(done ? 'Final rank' : 'Players', done ? e.rank + ' of ' + c.joined : c.joined + (c.status === 'open' ? ' of ' + c.size : '')) + fact('Return', pct(E.returnPct(v, c.coins)) + mv) + fact('Portfolio', num(v, 2)) + fact(done ? 'Settled on' : 'Ends at close of', fmtDate(done ? c.settle_date : c.end_date)) + '</div>' +
        '<div class="row"><button data-act="detail" data-id="' + c.id + '">' + (c.status === 'open' ? 'View my portfolio' : 'View leaderboard') + '</button>' + (isOpen(c) && c.code ? '<button class="primary" data-act="share" data-id="' + c.id + '">Invite friends</button>' : '') + (done || c.status === 'cancelled' ? '<button data-act="again" data-id="' + c.id + '">Play again</button>' : '') + '</div></div>';
    };
    var run = list.filter(function (e) { return e.c.status === 'open' || e.c.status === 'live'; }), done = list.filter(function (e) { return e.c.status === 'settled' || e.c.status === 'cancelled'; });
    return statsHtml() + '<div class="lbl2" style="margin-top:22px">My contests</div><h2 class="big">' + run.length + ' running · ' + done.length + ' finished</h2>' +
      (run.length ? '<h3 class="sec">Running</h3><div class="cards">' + run.map(card).join('') + '</div>' : '') + (done.length ? '<h3 class="sec">Finished</h3><div class="cards">' + done.map(card).join('') + '</div>' : '');
  }
  function detailBox(cid) {
    var mineE = D.entries.find(function (e) { return e.contest_id === cid; }), c = mineE ? mineE.c : O.contests.find(function (x) { return x.id === cid; });
    if (!c) return;
    var uid = D.user.id;
    act(function () {
      return Promise.all([q(sb.from('dsl_entries').select('id,uid,name,holdings,cash,value,rank,prize').eq('contest_id', cid).order('id')), c.status === 'settled' ? closesOn(c.settle_date) : Promise.resolve(P ? P.px : {})]);
    }, function (r) {
      var es = r[0], ref = r[1], rows;
      if (c.status === 'settled') rows = es.map(function (e, i) { return { idx: i, value: Number(e.value), rank: e.rank, prize: e.prize }; }).sort(function (a, b) { return a.rank - b.rank || a.idx - b.idx; });
      else if (c.status === 'live' && es.length === c.joined && es.length >= 2) rows = E.settle(c.entry, c.duration, es.map(function (e) { return E.value(e.holdings, Number(e.cash), ref); })).rows;
      else rows = es.map(function (e, i) { return { idx: i, value: E.value(e.holdings, Number(e.cash), ref), rank: null, prize: 0 }; });
      var mi = es.findIndex(function (e) { return e.uid === uid; }), show = rows.filter(function (x, i) { return i < 15 || x.idx === mi; });
      var lb = show.map(function (x) {
        var e = es[x.idx];
        return '<tr class="' + (x.idx === mi ? 'me' : '') + '"><td>' + (x.rank == null ? '–' : x.rank) + '</td><td>' + esc(e.name) + (x.idx === mi ? ' (you)' : '') + '</td><td class="num">' + num(x.value, 2) + '</td><td class="num">' + pct(E.returnPct(x.value, c.coins)) + '</td><td class="num">' + (x.prize > 0 ? inr(x.prize) : '–') + '</td></tr>';
      }).join('');
      var pe = mi >= 0 ? es[mi] : null;
      var hold = pe ? pe.holdings.map(function (h) {
        var now = ref && ref[h.s] > 0 ? ref[h.s] : h.p;
        return '<tr><td><b>' + esc(h.s) + '</b></td><td class="num">' + num(h.q) + '</td><td class="num">' + px2(h.p) + '</td><td class="num">' + px2(now) + '</td><td class="num">' + pct(E.r2((now / h.p - 1) * 100)) + '</td><td class="num">' + num(E.r2(h.q * (now - h.p)), 2) + '</td></tr>';
      }).join('') : '';
      var info = c.status === 'open' ? (isOpen(c) ? c.joined + ' of ' + c.size + ' seats taken. Entries close at ' + fmtTs(c.lock_at) + '. Other portfolios stay hidden until then.' : 'Entries have closed with ' + c.joined + ' player(s). ' + (c.joined >= 2 ? 'The contest is starting.' : 'Nobody else joined, so your entry is being returned.'))
        : c.status === 'live' ? c.joined + ' players. Standings at the latest prices; the final result uses the official closing prices of ' + fmtDate(c.end_date) + '.'
        : c.status === 'cancelled' ? 'Nobody else joined this contest, so it was cancelled and the entry was returned in full.'
        : 'Final result on the official closing prices of ' + fmtDate(c.settle_date) + '.';
      var planNow = c.status === 'open' && c.joined >= 2 ? '<h3 class="sec">Prizes if it starts with ' + c.joined + ' players</h3>' + planTable(E.prizePlan(c.joined, c.entry, c.duration)) : '';
      modal('<h2>' + esc(cname(c)) + ' ' + statusPill(c, pe) + '</h2><p class="muted">' + info + '</p>' +
        '<div class="tbl"><table><thead><tr><th>Rank</th><th>Player</th><th class="num">Portfolio</th><th class="num">Return</th><th class="num">' + (c.status === 'live' ? 'Prize if it ended now' : 'Prize') + '</th></tr></thead><tbody>' + lb + '</tbody></table></div>' +
        (rows.length > show.length ? '<p class="muted small">Showing the top 15 and your position, out of ' + rows.length + ' players.</p>' : '') + planNow +
        (pe ? '<h3 class="sec">Your portfolio</h3><div class="tbl"><table><thead><tr><th>Stock</th><th class="num">Shares</th><th class="num">Buy</th><th class="num">' + (c.status === 'settled' ? 'Close' : 'Now') + '</th><th class="num">Change</th><th class="num">Gain / loss</th></tr></thead><tbody>' + hold + '<tr class="tot"><td colspan="5">Cash not invested</td><td class="num">' + num(pe.cash, 2) + '</td></tr></tbody></table></div>' : '') +
        '<div class="row" style="justify-content:flex-end;margin-top:12px"><button data-close>Close</button></div>');
    });
  }

  // ---------- wallet ----------
  var TX = { topup: 'Money added', entry: 'Contest entry', prize: 'Prize won', withdraw: 'Withdrawal', refund: 'Withdrawal returned', entry_refund: 'Entry returned (contest cancelled)' };
  function walletHtml() {
    var tx = D.txns, sum = function (ty) { return tx.reduce(function (a, t) { return t.type === ty ? a + t.amt : a; }, 0); };
    var cOf = function (cid) { var e = D.entries.find(function (x) { return x.contest_id === cid; }); return e ? e.c : null; };
    return '<div class="lbl2">Wallet</div><h2 class="big">' + inr(D.balance) + ' available</h2>' +
      '<div class="tiles">' + fact('Money added', inr(sum('topup'))) + fact('Entries paid', inr(-(sum('entry') + sum('entry_refund')))) + fact('Prizes won', inr(sum('prize'))) + fact('Withdrawn or on hold', inr(-(sum('withdraw') + sum('refund')))) + '</div>' +
      '<div class="row" style="margin-bottom:14px"><button class="primary" data-act="addMoney">Add money</button><button data-act="withdraw">Withdraw</button></div>' + recordHtml(sum) + limitHtml() +
      '<h3 class="sec">Requests</h3>' + (D.requests.length ? '<div class="tbl"><table><thead><tr><th>Date</th><th>Type</th><th class="num">Amount</th><th>Reference</th><th>Status</th></tr></thead><tbody>' + D.requests.map(function (r) {
        return '<tr><td>' + esc(fmtTs(r.ts)) + '</td><td>' + (r.kind === 'topup' ? 'Add money' : 'Withdraw') + '</td><td class="num">' + inr(r.amt) + '</td><td>' + esc(r.ref) + '</td><td>' + pill(r.status, r.status === 'pending' ? 'Waiting for approval' : r.status === 'approved' ? (r.kind === 'topup' ? 'Added' : 'Paid') : 'Rejected') + '</td></tr>';
      }).join('') + '</tbody></table></div>' : '<p class="muted">No requests yet.</p>') +
      '<h3 class="sec">Wallet history</h3>' + (tx.length ? '<div class="tbl"><table><thead><tr><th>Date</th><th>Details</th><th class="num">Amount</th></tr></thead><tbody>' + tx.map(function (t) {
        var c = t.cid && cOf(t.cid);
        return '<tr><td>' + esc(fmtTs(t.ts)) + '</td><td>' + (TX[t.type] || esc(t.type)) + (c ? ' · ' + esc(cname(c)) : '') + '</td><td class="num ' + (t.amt > 0 ? 'up' : 'down') + '">' + (t.amt > 0 ? '+' : '') + inr(t.amt) + '</td></tr>';
      }).join('') + '</tbody></table></div>' : '<p class="muted">Nothing here yet. Add money to join your first contest.</p>');
  }
  function addMoneyBox() {
    var u = me(), S = D.settings;
    if (!S.upi) return modal('<h2>Add money</h2><p>Top-ups are not open yet: the owner has not set the UPI ID for payments. Please check again soon.</p><div class="row" style="justify-content:flex-end"><button data-close>Close</button></div>');
    modal('<h2>Add money</h2><ol class="steps"><li>Enter the amount you want to add.</li><li>Pay exactly that amount to this UPI ID from any UPI app:</li></ol><div class="upi">' + esc(S.upi) + '<br><span class="muted small" style="font-weight:500">Name: ' + esc(S.payee) + '</span></div>' +
      '<ol class="steps" start="3"><li>Enter the 12-digit UPI reference number (UTR) from your payment and send the request.</li><li>Your wallet is credited after ' + esc(S.payee) + ' confirms the payment was received.</li></ol>' +
      '<form class="form" id="topForm" novalidate><label>Amount (₹)<input name="amt" type="number" min="49" max="20000" step="1" inputmode="numeric" placeholder="e.g. 500"></label><label>UPI reference no. (UTR)<input name="utr" inputmode="numeric" maxlength="12" placeholder="12 digits"></label>' +
      '<div class="full row" style="justify-content:flex-end"><button type="button" data-close>Cancel</button><a class="fakebtn" id="upiLink" href="#">Open UPI app</a><button class="primary" type="submit">Send request</button></div></form>', function (b, close) {
      var f = $('#topForm', b), amt = function () { var n = Number(f.amt.value); return n >= 49 && n <= 20000 && n === Math.floor(n) ? n : 0; };
      $('#upiLink', b).onclick = function (ev) {
        var a = amt(); if (!a) { ev.preventDefault(); return toast('Enter a whole amount between ₹49 and ₹20,000 first.', true); }
        this.href = 'upi://pay?pa=' + encodeURIComponent(S.upi) + '&pn=' + encodeURIComponent(S.payee) + '&am=' + a + '&cu=INR&tn=' + encodeURIComponent('DSL wallet ' + u.mobile);
      };
      f.onsubmit = function (ev) {
        ev.preventDefault();
        var a = amt(), utr = f.utr.value.replace(/\D/g, '');
        if (!a) return toast('Enter a whole amount between ₹49 and ₹20,000.', true);
        if (!/^\d{12}$/.test(utr)) return toast('Enter the 12-digit UPI reference number from your payment.', true);
        act(function () { return q(sb.rpc('dsl_request_topup', { p_amt: a, p_utr: utr })).then(reload); }, function () { close(); render(); toast('Request sent. Your wallet is credited once the payment is confirmed.'); });
      };
    });
  }
  function withdrawBox() {
    if (D.balance < 50) return toast('You need at least ₹50 in your wallet to withdraw.', true);
    modal('<h2>Withdraw</h2><p>Available: <b>' + inr(D.balance) + '</b>. The amount is held now and paid to your UPI ID by ' + esc(D.settings.payee) + '.</p><form class="form" id="wdForm" novalidate><label>Amount (₹)<input name="amt" type="number" min="50" max="' + Math.floor(D.balance) + '" step="1" inputmode="numeric"></label><label>Your UPI ID<input name="upi" placeholder="name@bank" autocapitalize="none"></label><div class="full row" style="justify-content:flex-end"><button type="button" data-close>Cancel</button><button class="primary" type="submit">Request withdrawal</button></div></form>', function (b, close) {
      $('#wdForm', b).onsubmit = function (ev) {
        ev.preventDefault();
        var a = Number(this.amt.value), upi = this.upi.value.trim();
        if (!(a >= 50) || a !== Math.floor(a)) return toast('Enter a whole amount of ₹50 or more.', true);
        if (a > D.balance) return toast('You cannot withdraw more than your balance.', true);
        if (!/^[A-Za-z0-9._-]{2,}@[A-Za-z][A-Za-z0-9]{1,}$/.test(upi)) return toast('Enter a valid UPI ID, like name@bank.', true);
        act(function () { return q(sb.rpc('dsl_request_withdraw', { p_amt: a, p_upi: upi })).then(reload); }, function () { close(); render(); toast('Withdrawal requested.'); });
      };
    });
  }

  // ---------- market ----------
  function marketList() {
    var s2 = mq.trim().toLowerCase();
    var list = stocks().filter(function (u) { return (!mcap || u.c === mcap) && (!s2 || u.s.toLowerCase().indexOf(s2) >= 0 || u.n.toLowerCase().indexOf(s2) >= 0 || u.sec.toLowerCase().indexOf(s2) >= 0); });
    if (msort === 'up') list.sort(function (a, b) { return chg(b.s) - chg(a.s); });
    else if (msort === 'down') list.sort(function (a, b) { return chg(a.s) - chg(b.s); });
    return list;
  }
  function marketRows() {
    var list = marketList(), shown = list.slice(0, 200);
    return shown.map(function (u) { return '<tr><td><b>' + esc(u.s) + '</b></td><td>' + esc(u.n) + '</td><td>' + capPill(u.c) + '</td><td>' + esc(u.sec) + '</td><td class="num">' + px2(P.px[u.s]) + '</td><td class="num">' + pct(chg(u.s)) + '</td></tr>'; }).join('') +
      (list.length > shown.length ? '<tr><td colspan="6" class="muted">Showing 200 of ' + list.length + '. Search or filter to narrow the list.</td></tr>' : '') || '<tr><td colspan="6" class="muted">No stock matches.</td></tr>';
  }
  function marketHtml() {
    if (!P) return '<div class="panel empty"><b>Prices are not loaded yet</b><span>The stock list appears after the first price update.</span></div>';
    var all = stocks(), cnt = function (c) { return all.filter(function (u) { return u.c === c; }).length; };
    var up = all.filter(function (u) { return chg(u.s) > 0; }).length, down = all.filter(function (u) { return chg(u.s) < 0; }).length;
    return '<div class="lbl2">Market</div><h2 class="big">' + all.length + ' stocks you can pick</h2>' +
      '<div class="tiles">' + Object.keys(CAPS).map(function (c) { return fact(CAPS[c] + ' cap', num(cnt(c)) + ' stocks', c === 'L' ? 'Top 100 companies by market value' : c === 'M' ? 'Companies 101 to 250' : 'Companies 251 to 500'); }).join('') + fact('Last session', '<span class="up">' + up + ' up</span> · <span class="down">' + down + ' down</span>') + '</div>' +
      '<div class="filters"><div class="chips capchips">' + [['', 'All']].concat(Object.keys(CAPS).map(function (c) { return [c, CAPS[c] + ' cap']; })).map(function (x) { return '<button data-act="mcap" data-c="' + x[0] + '" class="' + (mcap === x[0] ? 'on' : '') + '">' + x[1] + '</button>'; }).join('') + '</div>' +
      '<select id="mSort" aria-label="Sort"><option value="az"' + (msort === 'az' ? ' selected' : '') + '>A to Z</option><option value="up"' + (msort === 'up' ? ' selected' : '') + '>Biggest gainers</option><option value="down"' + (msort === 'down' ? ' selected' : '') + '>Biggest fallers</option></select>' +
      '<input type="search" id="mktSearch" class="grow" placeholder="Search by name, symbol or sector" aria-label="Search stocks" value="' + esc(mq) + '"></div>' +
      '<div class="tbl"><table><thead><tr><th>Symbol</th><th>Company</th><th>Cap</th><th>Sector</th><th class="num">Price</th><th class="num">Change</th></tr></thead><tbody id="mktBody">' + marketRows() + '</tbody></table></div>' +
      '<p class="muted small" style="margin-top:8px">Large, mid and small cap follow the NSE indices: Nifty 100, Nifty Midcap 150 and Nifty Smallcap 250.</p>';
  }

  // ---------- engagement: levels, badges, home summary, results, leaderboard ----------
  var LEVELS = [[0, 'Rookie Trader'], [50, 'Swing Trader'], [150, 'Market Analyst'], [350, 'Portfolio Pro'], [700, 'Bull Runner'], [1200, 'Dalal Street Legend']];
  function level(xp) {
    var i = 0; while (i + 1 < LEVELS.length && xp >= LEVELS[i + 1][0]) i++;
    var next = LEVELS[i + 1];
    return { n: i + 1, name: LEVELS[i][1], from: LEVELS[i][0], to: next ? next[0] : null, nextName: next ? next[1] : null, pct: next ? Math.round((xp - LEVELS[i][0]) / (next[0] - LEVELS[i][0]) * 100) : 100 };
  }
  function myStats() {
    var fin = D.entries.filter(function (e) { return e.c.status === 'settled'; }), st = { played: fin.length, wins: 0, firsts: 0, podium: 0, prizes: 0, best: null, bestRank: null, durs: {}, diverse: false, friends: 0 };
    fin.forEach(function (e) {
      if (e.prize > 0) { st.wins++; st.prizes += e.prize; }
      if (e.rank === 1) st.firsts++;
      if (e.rank <= 3 && e.c.joined >= 5) st.podium++;
      var r = E.returnPct(Number(e.value), e.c.coins); if (st.best == null || r > st.best) st.best = r;
      st.durs[e.c.duration] = 1;
    });
    D.entries.forEach(function (e) {
      var caps = {}; (e.holdings || []).forEach(function (h) { if (BY[h.s]) caps[BY[h.s].c] = 1; });
      if (caps.L && caps.M && caps.S) st.diverse = true;
      if (e.c.private && e.c.joined >= 2) st.friends++;
    });
    st.xp = 10 * st.played + 20 * st.wins + 40 * st.firsts + 30 * st.podium;
    return st;
  }
  var BADGES = [
    ['first', 'First trade', 'Finish your first contest', function (st) { return st.played >= 1; }],
    ['win', 'In the money', 'Win a prize', function (st) { return st.wins >= 1; }],
    ['champ', 'Champion', 'Finish first in a contest', function (st) { return st.firsts >= 1; }],
    ['podium', 'Podium', 'Top 3 in a contest of 5 or more', function (st) { return st.podium >= 1; }],
    ['diverse', 'Diversifier', 'Hold large, mid and small caps together', function (st) { return st.diverse; }],
    ['friends', 'Squad', 'Play a private contest with friends', function (st) { return st.friends >= 1; }],
    ['all', 'All seasons', 'Finish a daily, a weekly and a monthly contest', function (st) { return st.durs.day && st.durs.week && st.durs.month; }],
    ['ten', 'Regular', 'Finish 10 contests', function (st) { return st.played >= 10; }],
    ['five', 'Five-time winner', 'Win 5 prizes', function (st) { return st.wins >= 5; }]
  ];
  function statsHtml() {
    var st = myStats(), lv = level(st.xp), got = BADGES.filter(function (b) { return b[3](st); }).length;
    return '<div class="panel stats"><div class="lvlhead"><div><div class="lbl2">Level ' + lv.n + '</div><h2 class="big" style="margin:2px 0 6px">' + esc(lv.name) + '</h2>' +
      '<div class="xp"><i style="width:' + lv.pct + '%"></i></div><p class="muted small" style="margin:6px 0 0">' + (lv.to ? num(st.xp) + ' / ' + num(lv.to) + ' points to ' + esc(lv.nextName) : num(st.xp) + ' points · top level') + '</p></div>' +
      '<div class="tiles" style="margin:0;flex:1">' + fact('Contests', num(st.played)) + fact('Prizes won', num(st.wins), st.played ? num(st.wins / st.played * 100, 0) + '% of contests' : '') + fact('First places', num(st.firsts)) + fact('Best return', st.best == null ? '–' : pct(st.best)) + '</div></div>' +
      '<h3 class="sec">Badges · ' + got + ' of ' + BADGES.length + '</h3><div class="badges">' + BADGES.map(function (b) { var on = b[3](st); return '<div class="badge' + (on ? ' on' : '') + '" title="' + esc(b[2]) + '"><span class="ico ico-' + b[0] + '"></span><b>' + esc(b[1]) + '</b><small>' + esc(b[2]) + '</small></div>'; }).join('') + '</div>' +
      '<p class="muted small" style="margin:10px 0 0">Points: 10 per finished contest, 20 per prize, 30 per podium, 40 per first place.</p></div>';
  }
  // Change in a running contest's portfolio value since the player last looked (kept for this browser tab).
  var lastSeen = {};
  try { lastSeen = JSON.parse(sessionStorage.getItem('dsl.last') || '{}'); } catch (e) { lastSeen = {}; }
  function moveOf(e, v) {
    if (e.c.status !== 'live' && e.c.status !== 'open') return '';
    var k = String(e.contest_id), was = lastSeen[k]; lastSeen[k] = v;
    try { sessionStorage.setItem('dsl.last', JSON.stringify(lastSeen)); } catch (x) { /* ignore */ }
    if (was == null || Math.abs(v - was) < 0.01) return '';
    return ' <span class="mv ' + (v > was ? 'up' : 'down') + '">' + (v > was ? '▲' : '▼') + '</span>';
  }
  function countdown(ms) {
    if (ms <= 0) return 'now';
    var m = Math.floor(ms / 60000), h = Math.floor(m / 60), d = Math.floor(h / 24);
    var p2 = function (n) { return (n < 10 ? '0' : '') + n; }, sec = Math.floor(ms / 1000) % 60;
    return d ? d + 'd ' + (h % 24) + 'h ' + p2(m % 60) + 'm' : h ? h + 'h ' + p2(m % 60) + 'm ' + p2(sec) + 's' : m + 'm ' + p2(sec) + 's';
  }
  var QUICK = [['h2h', 49, 'day'], ['l10', 99, 'day'], ['m50', 49, 'week']];
  function heroHtml() {
    var u = me(), st = myStats(), lv = level(st.xp), lock = E.lockAt(E.istToday());
    var run = D.entries.filter(function (e) { return e.c.status === 'live' || e.c.status === 'open'; });
    var combos = [], seen = {};
    D.entries.forEach(function (e) { var c = e.c, k = c.kind + c.entry + c.duration; if (!c.private && !seen[k] && combos.length < 3) { seen[k] = 1; combos.push([c.kind, c.entry, c.duration]); } });
    QUICK.forEach(function (x) { var k = x.join(''); if (!seen[k] && combos.length < 3) { seen[k] = 1; combos.push(x); } });
    var quick = combos.map(function (x) {
      var t = E.prizePlan(E.KINDS[x[0]].size, x[1], x[2]);
      return '<button class="qp" data-act="quick" data-k="' + x[0] + '" data-e="' + x[1] + '" data-d="' + x[2] + '"' + (P ? '' : ' disabled') + '><b>' + esc(E.KINDS[x[0]].label) + ' · ' + inr(x[1]) + '</b><span>' + esc(E.DURATIONS[x[2]]) + ' · 1st ' + inr(t.prizes[0]) + '</span></button>';
    }).join('');
    var live = run.slice(0, 4).map(function (e) {
      var v = myValue(e);
      return '<button class="lv" data-act="detail" data-id="' + e.c.id + '"><span>' + esc(kname(e.c)) + ' · ' + inr(e.c.entry) + '</span><b>' + pct(E.returnPct(v, e.c.coins)) + '</b>' + statusPill(e.c, e) + '</button>';
    }).join('');
    return '<div class="hero"><div class="hero-top"><div><div class="lbl2" style="color:#7FD3D6">Level ' + lv.n + ' · ' + esc(lv.name) + '</div><h2>' + (st.played ? 'Back on Dalal Street, ' : 'Welcome, ') + esc(u.name.split(' ')[0]) + '</h2>' +
      '<div class="xp dark"><i style="width:' + lv.pct + '%"></i></div></div>' +
      '<div class="clock"><small>Today\'s entries close in</small><b id="cd" data-t="' + lock.getTime() + '">' + countdown(lock.getTime() - Date.now()) + '</b><small>' + esc(fmtTs(lock)) + ' · market open</small></div></div>' +
      (live ? '<div class="lbl2" style="color:#7FD3D6;margin-top:14px">Your running contests</div><div class="lvrow">' + live + '</div>' : '') +
      '<div class="lbl2" style="color:#7FD3D6;margin-top:14px">' + (D.entries.length ? 'Play again' : 'Quick start') + '</div><div class="qprow">' + quick + '</div></div>';
  }
  // Show each newly finished contest once, with the result.
  function seenKey() { return 'dsl.seen.' + (D.user ? D.user.id : ''); }
  function showResults() {
    if (!me() || draft || !$('#modal').hidden) return;
    var seen = {}; try { seen = JSON.parse(localStorage.getItem(seenKey()) || '{}'); } catch (e) { seen = {}; }
    var fresh = D.entries.filter(function (e) { return e.c.status === 'settled' && !seen[e.contest_id] && Date.now() - new Date(e.c.settled_at).getTime() < 7 * 864e5; });
    D.entries.forEach(function (e) { if (e.c.status === 'settled') seen[e.contest_id] = 1; });
    try { localStorage.setItem(seenKey(), JSON.stringify(seen)); } catch (x) { /* ignore */ }
    if (!fresh.length) return;
    var e = fresh.slice().sort(function (a, b) { return b.prize - a.prize || a.rank - b.rank; })[0], c = e.c, r = E.returnPct(Number(e.value), c.coins), won = e.prize > 0;
    var conf = won ? '<div class="confetti" aria-hidden="true">' + Array.from({ length: 36 }, function (_, i) { return '<i style="left:' + (i * 2.8 % 100) + '%;animation-delay:' + (i % 9) * 0.12 + 's;background:' + ['#3C9A08', '#7FD3D6', '#F4D35E', '#1D5FA8', '#D2452F'][i % 5] + '"></i>'; }).join('') + '</div>' : '';
    modal(conf + '<div class="result"><div class="lbl2">' + esc(cname(c)) + '</div><div class="rank">' + (e.rank === 1 ? '1st' : e.rank === 2 ? '2nd' : e.rank === 3 ? '3rd' : e.rank + 'th') + '<small> of ' + c.joined + '</small></div>' +
      (won ? '<p class="prize">You won ' + inr(e.prize) + '</p><p class="muted">It is already in your wallet.</p>' : '<p class="muted" style="font-size:16px">No prize this time.</p>') +
      '<div class="facts" style="margin-top:12px">' + fact('Your return', pct(r)) + fact('Portfolio', num(Number(e.value), 2)) + fact('Settled on', fmtDate(c.settle_date)) + '</div>' +
      (fresh.length > 1 ? '<p class="muted small">' + (fresh.length - 1) + ' more result(s) are in My Contests.</p>' : '') +
      '<div class="row" style="justify-content:center;margin-top:10px"><button data-close>Close</button><button data-act="detail" data-id="' + c.id + '">See leaderboard</button><button class="primary" data-act="again" data-id="' + c.id + '">Play again</button></div></div>');
  }
  function playAgain(cid) {
    var e = D.entries.find(function (x) { return x.contest_id === cid; }); if (!e || !P) return;
    var c = e.c;
    if (c.kind === 'custom') startDraft('custom', c.entry, c.duration, { private: true, size: c.size });
    else startDraft(c.kind, c.entry, c.duration, { private: c.private });
    if (!draft) return;
    var lp = lastPortfolio(e); if (lp) applyWeights(lp);
    view = 'play'; render(); window.scrollTo(0, 0); toast('Same contest, same stocks at today\'s prices. Change anything before you confirm.');
  }
  function leadersHtml() {
    var rows = LB[lbDays];
    var head = '<div class="lbl2">Leaderboard</div><h2 class="big">Top traders · ' + (lbDays === 7 ? 'this week' : lbDays === 30 ? 'this month' : 'all time') + '</h2><div class="filters">' + seg('lb', [['7', 'This week'], ['30', 'This month'], ['0', 'All time']], String(lbDays || 0)) + '</div>';
    if (!rows) return head + '<div class="panel empty"><span>Loading…</span></div>';
    if (!rows.length) return head + '<div class="panel empty"><b>No finished contests yet</b><span>Finish a contest to appear here.</span><button class="primary" data-act="go" data-v="play">Play now</button></div>';
    var mine = rows.find(function (r) { return r.is_me; });
    return head + (mine ? '<div class="notice ok">You are <b>#' + mine.pos + '</b> with ' + num(mine.points) + ' points.</div>' : '<div class="notice">You are not on this board yet. Finish a contest to get points.</div>') +
      '<div class="tbl"><table><thead><tr><th>#</th><th>Player</th><th class="num">Points</th><th class="num">Contests</th><th class="num">Prizes</th><th class="num">Podiums</th><th class="num">Best return</th></tr></thead><tbody>' +
      rows.map(function (r) { return '<tr class="' + (r.is_me ? 'me' : '') + '"><td>' + (r.pos <= 3 ? ['🥇', '🥈', '🥉'][r.pos - 1] : r.pos) + '</td><td>' + esc(r.name) + (r.is_me ? ' (you)' : '') + '</td><td class="num"><b>' + num(r.points) + '</b></td><td class="num">' + r.played + '</td><td class="num">' + r.wins + '</td><td class="num">' + r.top3 + '</td><td class="num">' + pct(Number(r.best_return)) + '</td></tr>'; }).join('') +
      '</tbody></table></div><p class="muted small" style="margin-top:8px">Points for each finished contest: 100 for first place down to 0 for last, by position among the players who joined. Skill counts more than spending: a ₹49 contest and a ₹1,000 contest score the same.</p>';
  }
  function loadLeaders() {
    var d = lbDays;
    return q(sb.rpc('dsl_leaderboard', { p_days: d || null })).then(function (r) { LB[d] = r; if (view === 'leaders') render(); }, fail);
  }
  // ---------- responsible play ----------
  function limitInfo() {
    var p = me() || {}, now = Date.now(), nextAt = p.day_limit_next_at ? new Date(p.day_limit_next_at).getTime() : null;
    var limit = nextAt && nextAt <= now ? p.day_limit_next : p.day_limit;
    var start = new Date(E.istToday() + 'T00:00:00+05:30').getTime();
    var spent = D.txns.reduce(function (a, t) { return (t.type === 'entry' || t.type === 'entry_refund') && new Date(t.ts).getTime() >= start ? a - t.amt : a; }, 0);
    return { limit: limit == null ? null : limit, spent: spent, pending: nextAt && nextAt > now ? { to: p.day_limit_next, at: nextAt } : null };
  }
  function recordHtml(sum) {
    var paid = -(sum('entry') + sum('entry_refund')), won = sum('prize'), net = won - paid;
    return '<div class="panel" style="margin-bottom:14px"><h3 class="sec" style="margin-top:0">Your record</h3><div class="tiles" style="margin-bottom:0">' + fact('Entries paid', inr(paid)) + fact('Prizes won', inr(won)) + fact('Net result', '<span class="' + (net > 0 ? 'up' : net < 0 ? 'down' : '') + '">' + (net > 0 ? '+' : '') + inr(net) + '</span>', 'Prizes minus entries, all time') + '</div></div>';
  }
  function limitHtml() {
    var l = limitInfo();
    return '<div class="panel" style="margin-bottom:14px"><h3 class="sec" style="margin-top:0">Daily entry limit</h3><p class="muted" style="margin-top:0">Set the most you want to spend on entries in a day. Lowering it works at once; raising or removing it takes effect after 24 hours.</p>' +
      '<div class="facts">' + fact('Your limit', l.limit == null ? 'No limit' : inr(l.limit)) + fact('Spent today', inr(l.spent)) + (l.pending ? fact('Change pending', l.pending.to == null ? 'No limit' : inr(l.pending.to), 'From ' + fmtTs(l.pending.at)) : '') + '</div>' +
      '<form class="row" id="limitForm" novalidate><input name="lim" type="number" min="49" max="100000" step="1" inputmode="numeric" placeholder="e.g. 200" style="width:140px"><button class="primary" type="submit">Save limit</button>' + (l.limit != null ? '<button type="button" data-act="noLimit">Remove limit</button>' : '') + '</form></div>';
  }

  // ---------- rules ----------
  function rulesHtml() {
    var tbl = function (n) {
      var cols = E.prizePlan(n, E.ENTRIES[0], fd).bands;
      return '<div class="tbl"><table><thead><tr><th>Entry</th>' + cols.map(function (b) { return '<th class="num">' + (n === 2 ? 'Winner gets' : rankName(b)) + '</th>'; }).join('') + '</tr></thead><tbody>' +
        E.ENTRIES.map(function (en) { var t = E.prizePlan(n, en, fd); return '<tr><td>' + inr(en) + '</td>' + t.bands.map(function (b) { return '<td class="num">' + inr(b.each) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div>';
    };
    var small = function (n) { var t = E.prizePlan(n, 99, fd); return '<tr><td>' + n + ' players</td><td class="num">' + t.winners + '</td><td class="num">' + inr(t.prizes[0]) + ' (' + num(t.prizes[0] / 99, 2) + 'x)</td><td class="num">' + inr(t.prizes[t.winners - 1]) + '</td></tr>'; };
    return '<div class="lbl2">How it works</div><h2 class="big">Rules and prizes</h2><div class="two"><div class="panel"><h3 class="sec" style="margin-top:0">How to play</h3><ol class="steps">' +
      '<li>Sign up with your name, email and mobile number.</li><li>Add money to your wallet. You pay to the UPI ID shown and your wallet is credited once the payment is confirmed.</li>' +
      '<li>Pick a contest: 1 vs 1, League of 10, Mega League 50, or your own private tournament for 2 to 100 friends. Each runs for a day, a week or a month.</li><li>You get virtual coins (1 coin = ₹1 of buying power in the game). Buy at least ' + E.MIN_STOCKS + ' stocks at the latest price. Coins you do not use stay as cash.</li>' +
      '<li>Invite friends with the contest link. Entries close when the market next opens (09:15 am on the next trading day).</li><li>On the last day, every portfolio is valued at the official NSE closing prices. The highest value wins and prizes go straight to the winners\' wallets.</li></ol>' +
      '<h3 class="sec">How prizes are set</h3><ul class="plain"><li>About 4 in every 10 players win a prize.</li><li>The harder the finish, the bigger the prize: everyone in the top 20% of a league gets at least 1.9 times the entry, more than a 1 vs 1 win pays.</li><li>The next 20% get their entry back plus 15%.</li><li>Longer contests pay more: a weekly prize is higher than a daily one, and a monthly prize is higher still.</li><li>A contest runs with the players who joined when entries closed, and the prize table follows that number. If nobody else joined, the entry is returned in full.</li><li>If players finish on exactly the same value, they share the prizes of the ranks they cover equally.</li></ul>' +
      '<h3 class="sec">Fair play</h3><ul class="plain"><li>Everyone in a contest gets the same number of coins.</li><li>Other players cannot see your stocks until entries close.</li><li>If the market is closed on the last day, the next trading day\'s closing prices are used.</li><li>Coins are only for the game. They cannot be withdrawn and are not real shares.</li></ul></div>' +
      '<div><div class="filters">' + seg('fd', Object.keys(E.DURATIONS).map(function (x) { return [x, E.DURATIONS[x]]; }), fd) + '</div><h3 class="sec" style="margin-top:0">1 vs 1 · ' + esc(E.DURATIONS[fd]) + '</h3>' + tbl(2) + '<h3 class="sec">League of 10, when full (4 win)</h3>' + tbl(10) + '<h3 class="sec">Mega League 50, when full (20 win)</h3><div class="tbl"><table><thead><tr><th>Rank</th>' + E.ENTRIES.map(function (en) { return '<th class="num">' + inr(en) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      E.prizePlan(50, 99, fd).prizes.slice(0, 11).map(function (x, i) { return '<tr><td>' + (i === 10 ? 'Ranks 11 to 20' : 'Rank ' + (i + 1)) + '</td>' + E.ENTRIES.map(function (en) { return '<td class="num">' + inr(E.prizePlan(50, en, fd).prizes[i]) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div>' +
      '<h3 class="sec">Other sizes (₹99 entry)</h3><div class="tbl"><table><thead><tr><th>Players</th><th class="num">Winners</th><th class="num">1st prize</th><th class="num">Last prize</th></tr></thead><tbody>' + [3, 5, 8, 20, 30, 100].map(small).join('') + '</tbody></table></div>' +
      '<p class="muted small" style="margin-top:10px">Dalal Street League keeps the rest of the entries as its platform fee.</p></div></div>';
  }

  // ---------- owner ----------
  function ownerHtml() {
    var tabs = [['report', 'Report'], ['requests', 'Money requests'], ['players', 'Players'], ['contests', 'Contests'], ['settings', 'Settings']];
    var pend = O.requests.filter(function (r) { return r.status === 'pending'; }).length;
    return '<div class="panel-head"><div><div class="lbl2">Owner · CA Deep Dalal</div><h2 class="big" style="margin-bottom:0">Dalal Street League control room</h2></div><button data-act="ownerRefresh">Refresh</button></div>' +
      '<nav class="tabs sub">' + tabs.map(function (t) { return '<button data-act="otab" data-t="' + t[0] + '" class="' + (ownerTab === t[0] ? 'on' : '') + '">' + t[1] + (t[0] === 'requests' && pend ? ' (' + pend + ')' : '') + '</button>'; }).join('') + '</nav><div style="margin-top:12px">' +
      (!O.report ? '<p class="muted">Loading…</p>' : ownerTab === 'report' ? reportHtml() : ownerTab === 'requests' ? requestsHtml() : ownerTab === 'players' ? playersHtml() : ownerTab === 'contests' ? contestsHtml() : settingsHtml()) + '</div>';
  }
  function reportHtml() {
    var s = O.report, kinds = Object.keys(E.KINDS).map(function (k) { return s.by_kind.find(function (x) { return x.kind === k; }) || { kind: k, settled: 0, running: 0, gross: 0, paid: 0, commission: 0 }; });
    var max = Math.max.apply(null, kinds.map(function (k) { return k.commission; }).concat([1]));
    return '<h3 class="sec" style="margin-top:0">Players</h3><div class="tiles">' + fact('Registered players', num(s.players), s.new_week + ' joined in the last 7 days · ' + (s.invited || 0) + ' came by invite') + fact('Active players', num(s.active), 'Logged in or played in the last 7 days') + fact('Playing right now', num(s.in_live), 'Players in a running contest') + '</div>' +
      '<h3 class="sec">Contests</h3><div class="tiles">' + fact('Contests created', num(s.total), s.open + ' taking entries · ' + s.live + ' live · ' + s.settled + ' finished · ' + s.cancelled + ' cancelled') + fact('Entries collected', inr(s.gross), 'Finished contests') + fact('Prizes paid', inr(s.paid)) + fact('Your commission earned', '<span class="up">' + inr(s.commission) + '</span>', 'Finished contests') + fact('Commission coming', inr(s.commission_coming), 'From live contests') + '</div>' +
      '<div class="tbl"><table><thead><tr><th>Contest type</th><th class="num">Finished</th><th class="num">Running</th><th class="num">Entries</th><th class="num">Prizes</th><th class="num">Commission</th><th>Share</th></tr></thead><tbody>' + kinds.map(function (k) {
        return '<tr><td>' + esc(E.KINDS[k.kind].label) + '</td><td class="num">' + k.settled + '</td><td class="num">' + k.running + '</td><td class="num">' + inr(k.gross) + '</td><td class="num">' + inr(k.paid) + '</td><td class="num">' + inr(k.commission) + '</td><td><div class="bar-cell"><i style="width:' + Math.round(k.commission / max * 120) + 'px"></i></div></td></tr>';
      }).join('') + '<tr class="tot"><td>Total</td><td class="num">' + s.settled + '</td><td class="num">' + (s.open + s.live) + '</td><td class="num">' + inr(s.gross) + '</td><td class="num">' + inr(s.paid) + '</td><td class="num">' + inr(s.commission) + '</td><td></td></tr></tbody></table></div>' +
      '<h3 class="sec">Wallet money</h3><div class="tiles">' + fact('Top-ups approved', inr(s.topups)) + fact('Entry fees paid', inr(s.entries), 'After refunds of cancelled contests') + fact('Prizes credited', inr(s.prizes)) + fact('Withdrawals paid', inr(s.withdrawn)) + fact('Money owed to players', inr(s.float), 'Total of all wallet balances') + fact('Top-ups waiting', s.pend_top_n + ' · ' + inr(s.pend_top_amt)) + fact('Withdrawals waiting', s.pend_wd_n + ' · ' + inr(s.pend_wd_amt)) + '</div>' +
      '<div class="row"><button data-act="csv" data-k="players">Download players (CSV)</button><button data-act="csv" data-k="contests">Download contests (CSV)</button><button data-act="csv" data-k="txns">Download wallet ledger (CSV)</button></div>';
  }
  function requestsHtml() {
    var name = function (r) { return r.p ? esc(r.p.name) + '<br><span class="muted small">' + esc(r.p.mobile) + '</span>' : 'Unknown'; };
    var pend = O.requests.filter(function (r) { return r.status === 'pending'; }).reverse(), done = O.requests.filter(function (r) { return r.status !== 'pending'; }).slice(0, 50);
    var row = function (r, a) {
      return '<tr><td>' + esc(fmtTs(r.ts)) + '</td><td>' + name(r) + '</td><td>' + (r.kind === 'topup' ? 'Add money' : 'Withdraw') + '</td><td class="num">' + inr(r.amt) + '</td><td>' + (r.kind === 'topup' ? 'UTR ' : 'Pay to ') + esc(r.ref) + '</td><td>' + (a ? '<button class="primary" data-act="approve" data-id="' + r.id + '">' + (r.kind === 'topup' ? 'Payment received, add to wallet' : 'I have paid this') + '</button> <button class="danger" data-act="reject" data-id="' + r.id + '">Reject</button>' : pill(r.status, r.status)) + '</td></tr>';
    };
    var head = '<thead><tr><th>Date</th><th>Player</th><th>Type</th><th class="num">Amount</th><th>Reference</th><th></th></tr></thead>';
    return '<h3 class="sec" style="margin-top:0">Waiting for you</h3>' + (pend.length ? '<p class="muted">For a top-up, check your UPI app for the same amount and reference number before you approve. For a withdrawal, pay the player first, then mark it paid.</p><div class="tbl"><table>' + head + '<tbody>' + pend.map(function (r) { return row(r, true); }).join('') + '</tbody></table></div>' : '<p class="muted">Nothing is waiting.</p>') +
      '<h3 class="sec">Recently handled</h3>' + (done.length ? '<div class="tbl"><table>' + head + '<tbody>' + done.map(function (r) { return row(r, false); }).join('') + '</tbody></table></div>' : '<p class="muted">None yet.</p>');
  }
  function decide(id, ok) {
    var r = O.requests.find(function (x) { return x.id === id; }); if (!r || r.status !== 'pending') return;
    var who = r.p ? esc(r.p.name) : 'this player';
    var msg = r.kind === 'topup'
      ? (ok ? 'Add <b>' + inr(r.amt) + '</b> to ' + who + '\'s wallet? Only do this after you see the payment (UTR ' + esc(r.ref) + ') in your UPI app.' : 'Reject this top-up of <b>' + inr(r.amt) + '</b>? Nothing is added to the wallet.')
      : (ok ? 'Confirm you have paid <b>' + inr(r.amt) + '</b> to ' + esc(r.ref) + '?' : 'Reject this withdrawal? <b>' + inr(r.amt) + '</b> goes back to ' + who + '\'s wallet.');
    confirmBox(msg, function () {
      act(function () { return q(sb.rpc('dsl_owner_decide', { p_rid: id, p_ok: ok })).then(reload); }, function () { render(); toast(ok ? 'Done.' : 'Rejected.'); });
    }, ok ? 'Yes, confirm' : 'Yes, reject');
  }
  function playersHtml() {
    if (!O.players.length) return '<p class="muted">No players have signed up yet.</p>';
    var now = Date.now();
    return '<div class="tbl"><table><thead><tr><th>Player</th><th>Email</th><th>Mobile</th><th>Joined</th><th>Last active</th><th class="num">Contests</th><th class="num">Entries paid</th><th class="num">Prizes won</th><th class="num">Wallet</th><th>Invited by</th><th class="num">Friends invited</th></tr></thead><tbody>' + O.players.map(function (u) {
      return '<tr><td><b>' + esc(u.name) + '</b> ' + (now - new Date(u.last_active) < 7 * 864e5 ? pill('live', 'Active') : pill('done', 'Inactive')) + '</td><td>' + esc(u.email) + '</td><td>' + esc(u.mobile) + '</td><td>' + esc(fmtTs(u.joined)) + '</td><td>' + esc(fmtTs(u.last_active)) + '</td><td class="num">' + u.contests + '</td><td class="num">' + inr(u.entries_paid) + '</td><td class="num">' + inr(u.prizes) + '</td><td class="num">' + inr(u.balance) + '</td><td>' + esc(u.invited_by || '–') + '</td><td class="num">' + u.friends_invited + '</td></tr>';
    }).join('') + '</tbody></table></div>';
  }
  function contestsHtml() {
    if (!O.contests.length) return '<p class="muted">No contests have been created yet.</p>';
    return '<div class="tbl"><table><thead><tr><th>#</th><th>Contest</th><th>Players</th><th>Started</th><th>Ends / settled</th><th>Status</th><th class="num">Entries</th><th class="num">Prizes</th><th class="num">Commission</th><th></th></tr></thead><tbody>' + O.contests.map(function (c) {
      var fee = c.joined >= 2 ? E.prizePlan(c.joined, c.entry, c.duration).minCommission : 0, done = c.status === 'settled', names = (c.dsl_entries || []).map(function (e) { return e.name; });
      return '<tr><td>' + c.id + '</td><td>' + esc(cname(c)) + (c.private && c.kind !== 'custom' ? ' · private' : '') + '</td><td>' + c.joined + '/' + c.size + (names.length <= 3 ? ' · ' + esc(names.join(', ')) : '') + '</td><td>' + fmtDate(c.start_date) + '</td><td>' + fmtDate(done ? c.settle_date : c.end_date) + '</td><td>' + statusPill(c) + '</td><td class="num">' + inr(c.status === 'cancelled' ? 0 : c.entry * c.joined) + '</td><td class="num">' + (done ? inr(c.paid) : '–') + '</td><td class="num">' + (done ? inr(c.commission) : c.status === 'live' ? '(' + inr(fee) + ')' : '–') + '</td><td><button data-act="detail" data-id="' + c.id + '">Open</button></td></tr>';
    }).join('') + '</tbody></table></div>';
  }
  function settingsHtml() {
    return '<div class="two"><div class="panel"><h3 class="sec" style="margin-top:0">Payments</h3><form class="form" id="upiForm" novalidate style="grid-template-columns:1fr"><label>UPI ID players pay to<input name="upi" value="' + esc(D.settings.upi) + '" placeholder="yourname@bank" autocapitalize="none"></label><label>Name shown to players<input name="payee" value="' + esc(D.settings.payee) + '"></label><div class="row"><button class="primary" type="submit">Save payment details</button></div></form></div>' +
      '<div class="panel"><h3 class="sec" style="margin-top:0">How results are decided</h3><ul class="plain"><li>Prices update by themselves from NSE on every trading day.</li><li>Each evening, after the official closing prices arrive, finished contests are settled and prizes are added to the winners\' wallets.</li><li>Contests that did not fill are cancelled and refunded at the same time.</li></ul><p class="muted small">Last official closing prices loaded: ' + (P ? fmtDate(P.last) : 'none yet') + '.</p></div></div>';
  }
  function csv(kind) {
    var make = function (rows) {
      var cell = function (v) { v = String(v == null ? '' : v); if (/^[=+\-@]/.test(v) && isNaN(Number(v))) v = "'" + v; return '"' + v.replace(/"/g, '""') + '"'; };
      var blob = new Blob(['﻿' + rows.map(function (r) { return r.map(cell).join(','); }).join('\r\n')], { type: 'text/csv' }), a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = 'DSL_FinDeependence_' + kind + '_' + E.istToday() + '.csv'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
    };
    if (kind === 'players') make([['Name', 'Email', 'Mobile', 'Joined', 'Last active', 'Contests', 'Entries paid', 'Prizes won', 'Wallet balance', 'Invited by', 'Friends invited']].concat(O.players.map(function (u) { return [u.name, u.email, u.mobile, u.joined, u.last_active, u.contests, u.entries_paid, u.prizes, u.balance, u.invited_by || '', u.friends_invited]; })));
    else if (kind === 'contests') make([['Contest no.', 'Type', 'Entry', 'Duration', 'Private', 'Joined', 'Seats', 'Start', 'End', 'Status', 'Settled on', 'Entries collected', 'Prizes paid', 'Commission']].concat(O.contests.map(function (c) { return [c.id, kname(c), c.entry, E.DURATIONS[c.duration], c.private ? 'yes' : '', c.joined, c.size, c.start_date, c.end_date, c.status, c.settle_date || '', c.gross == null ? '' : c.gross, c.paid == null ? '' : c.paid, c.commission == null ? '' : c.commission]; })));
    else act(function () { return q(sb.from('dsl_txns').select('*,p:dsl_profiles(name,mobile)').order('id', { ascending: false }).limit(5000)); }, function (tx) {
      make([['Txn no.', 'Date', 'Player', 'Mobile', 'Type', 'Amount', 'Contest no.']].concat(tx.map(function (t) { return [t.id, t.ts, t.p ? t.p.name : '', t.p ? t.p.mobile : '', TX[t.type] || t.type, t.amt, t.cid || '']; })));
    });
  }

  // ---------- events ----------
  function go(v) {
    view = v; render(); window.scrollTo(0, 0);
    if (v === 'leaders' && me()) loadLeaders();
    if (v === 'owner' && isOwner()) loadOwner().then(render, fail);
  }
  function signedOut() { D.user = null; D.profile = null; D.entries = []; D.txns = []; D.requests = []; D.balance = 0; O.report = null; O.requests = []; draft = null; view = 'play'; }
  document.addEventListener('click', function (ev) {
    var tab = ev.target.closest('#tabs button'); if (tab) return go(tab.dataset.v);
    var b = ev.target.closest('[data-act]'); if (!b || busy) return;
    var a = b.dataset.act;
    if (a === 'go') go(b.dataset.v);
    else if (a === 'logout') act(function () { return sb.auth.signOut().then(signedOut); }, render);
    else if (a === 'refresh') act(reload, function () { render(); toast(P ? 'Prices updated.' : 'No prices yet.'); });
    else if (a === 'loginBox') loginBox();
    else if (a === 'seg') {
      if (b.dataset.id === 'lb') { lbDays = Number(b.dataset.val); render(); if (!LB[lbDays]) loadLeaders(); return; }
      if (b.dataset.id === 'fk') fk = b.dataset.val; else fd = b.dataset.val; render();
    }
    else if (a === 'capF') { capF = b.dataset.c; render(); }
    else if (a === 'mcap') { mcap = b.dataset.c; render(); }
    else if (a === 'split') { splitEqually(); render(); }
    else if (a === 'reuse') { var lp = lastPortfolio(); if (lp) { applyWeights(lp); render(); toast('Your last portfolio, bought at today\'s prices.'); } }
    else if (a === 'clearAll') { draft.h = {}; render(); }
    else if (a === 'quick') { startDraft(b.dataset.k, Number(b.dataset.e), b.dataset.d); render(); window.scrollTo(0, 0); }
    else if (a === 'again') { var mm = $('#modal'); if (!mm.hidden) { mm.hidden = true; $('#modalBody').innerHTML = ''; } playAgain(Number(b.dataset.id)); }
    else if (a === 'noLimit') act(function () { return q(sb.rpc('dsl_set_day_limit', { p_limit: null })).then(function (r) { return reload().then(function () { return r; }); }); }, function (r) { render(); toast(r.pending ? 'Your limit will be removed in 24 hours.' : 'Limit removed.'); });
    else if (a === 'play') { startDraft(fk, Number(b.dataset.entry), fd); render(); window.scrollTo(0, 0); }
    else if (a === 'copy') copyText(b.dataset.text);
    else if (a === 'customGo') {
      var n = Number($('#cSize').value);
      if (!(n >= E.MIN_SIZE && n <= E.MAX_SIZE) || n !== Math.floor(n)) return toast('Choose between ' + E.MIN_SIZE + ' and ' + E.MAX_SIZE + ' players.', true);
      cSize = n; startDraft('custom', cEntry, fd, { private: true, size: n }); render(); window.scrollTo(0, 0); toast('Pick your stocks first. You get the link for your friends after you confirm.');
    }
    else if (a === 'invite') { startDraft('h2h', Number(b.dataset.entry), fd, { private: true }); render(); window.scrollTo(0, 0); toast('Pick your stocks first. You get the link for your friend after you confirm.'); }
    else if (a === 'prizes') prizeBox(E.KINDS[fk].size, Number(b.dataset.entry), fd, 'Prizes when all ' + E.KINDS[fk].size + ' seats are taken. With fewer players the table adjusts to the number who joined.');
    else if (a === 'buy') buyBox(b.dataset.s);
    else if (a === 'drop') { delete draft.h[b.dataset.s]; render(); }
    else if (a === 'cancelDraft') { draft = null; render(); }
    else if (a === 'confirmJoin') confirmJoin();
    else if (a === 'detail') { var md = $('#modal'); if (!md.hidden) { md.hidden = true; $('#modalBody').innerHTML = ''; } detailBox(Number(b.dataset.id)); }
    else if (a === 'share') { var e = D.entries.find(function (x) { return x.contest_id === Number(b.dataset.id); }); if (e) shareBox(e.c); }
    else if (a === 'addMoney') addMoneyBox();
    else if (a === 'withdraw') withdrawBox();
    else if (!isOwner()) return;
    else if (a === 'otab') { ownerTab = b.dataset.t; render(); }
    else if (a === 'ownerRefresh') act(reload, render);
    else if (a === 'approve') decide(Number(b.dataset.id), true);
    else if (a === 'reject') decide(Number(b.dataset.id), false);
    else if (a === 'csv') csv(b.dataset.k);
  });
  document.addEventListener('submit', function (ev) {
    var f = ev.target;
    if (f.id === 'signup') { ev.preventDefault(); doSignup(f); }
    else if (f.id === 'limitForm') {
      ev.preventDefault(); var n = Number(f.lim.value);
      if (!(n >= 49 && n <= 100000) || n !== Math.floor(n)) return toast('Choose a whole amount between ₹49 and ₹1,00,000.', true);
      act(function () { return q(sb.rpc('dsl_set_day_limit', { p_limit: n })).then(function (r) { return reload().then(function () { return r; }); }); }, function (r) { render(); toast(r.pending ? 'A higher limit takes effect in 24 hours.' : 'Daily limit set to ' + inr(n) + '.'); });
    }
    else if (f.id === 'upiForm' && isOwner()) {
      ev.preventDefault(); var upi = f.upi.value.trim(), payee = f.payee.value.trim();
      if (!/^[A-Za-z0-9._-]{2,}@[A-Za-z][A-Za-z0-9]{1,}$/.test(upi)) return toast('Enter a valid UPI ID, like name@bank.', true);
      if (payee.length < 2) return toast('Enter the name players will see.', true);
      act(function () { return q(sb.rpc('dsl_owner_set_payment', { p_upi: upi, p_payee: payee })).then(reload); }, function () { render(); toast('Payment details saved.'); });
    }
  });
  document.addEventListener('input', function (ev) {
    var t = ev.target;
    if (t.id === 'stockSearch') { sq = t.value; $('#stockRail').innerHTML = railList(); }
    else if (t.id === 'mktSearch') { mq = t.value; $('#mktBody').innerHTML = marketRows(); }
    else if (t.id === 'cSize') { var n = Number(t.value); if (n >= E.MIN_SIZE && n <= E.MAX_SIZE && n === Math.floor(n)) { cSize = n; $('#cPlan').innerHTML = planTable(E.prizePlan(cSize, cEntry, fd)); $('#cPlan').previousElementSibling.textContent = 'Prizes with all ' + cSize + ' players'; } }
  });
  document.addEventListener('change', function (ev) {
    if (ev.target.id === 'secSel') { sec = ev.target.value; $('#stockRail').innerHTML = railList(); }
    else if (ev.target.id === 'cEntry') { cEntry = Number(ev.target.value); render(); }
    else if (ev.target.id === 'mSort') { msort = ev.target.value; $('#mktBody').innerHTML = marketRows(); }
  });

  // ---------- start ----------
  (function () {
    var m = /[?&]j=([A-Za-z0-9]{6,12})\b/.exec(location.search); if (m) inviteCode = m[1].toUpperCase();
    var r = /[?&]ref=([A-Za-z0-9]{6,12})\b/.exec(location.search);
    try { if (r) sessionStorage.setItem('dsl.ref', r[1].toUpperCase()); refCode = sessionStorage.getItem('dsl.ref'); } catch (e) { refCode = r ? r[1].toUpperCase() : null; }
  })();
  sb.auth.onAuthStateChange(function (event, session) {
    if (event === 'PASSWORD_RECOVERY') setTimeout(newPasswordBox, 0);
    if (event === 'SIGNED_OUT' && D.user) { signedOut(); render(); }
    if (session && session.user) D.user = session.user;
  });
  render();
  sb.auth.getSession().then(function (r) {
    D.user = r.data && r.data.session ? r.data.session.user : null;
    return Promise.all([reload(), loadUniverse()]);
  }).then(function () {
    booted = true;
    if (me()) sb.rpc('dsl_touch').then(function () {});
    afterLogin(); showResults();
  }, function (e) { booted = true; render(); fail(e); });
  // Quiet refresh every minute while the page is open and nobody is typing.
  setInterval(function () {
    var ae = document.activeElement;
    if (document.hidden || busy || !booted || !$('#modal').hidden || (ae && /^(INPUT|SELECT|TEXTAREA)$/.test(ae.tagName))) return;
    reload().then(function () { render(); showResults(); }, function () {});
  }, 60 * 1000);
  // Entries-close countdown on the home summary.
  setInterval(function () { var el = document.getElementById('cd'); if (el) el.textContent = countdown(Number(el.dataset.t) - Date.now()); }, 1000);
})();
