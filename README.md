# Dalal Street League (DSL) by FinDeependence

**Created by CA Deep Dalal · Chartered Accountant · Fund Manager**

A stock market fantasy league. A player gets virtual coins (1 coin = ₹1 of buying power in the game), builds a portfolio of NSE stocks, and the best portfolio on the official closing prices of the last day wins.

Players sign up, add money to a wallet, and play each other. Accounts, wallets and contests live in a free Supabase project; the app itself is a static site on GitHub Pages.

## What it does
- **Sign-up / log-in** with name, email, mobile number and a password.
- **Wallet**: the player enters an amount, pays it to the owner's UPI ID, and sends the UPI reference number. The owner approves the request in the Owner tab and the wallet is credited. Withdrawals work the same way in reverse.
- **Contests between real players**: 1 vs 1, League of 10 and Mega League 50, each daily, weekly or monthly. A 1 vs 1 can also be a private challenge sent to a friend by link.
- **Portfolio builder**: buy at least 3 stocks with the coins. The server takes the price at the moment of joining.
- **Settlement**: every evening the GitHub Actions job values all portfolios on the official NSE closing prices, pays prizes into wallets, and refunds contests that did not fill.
- **Owner tab** (owner account only): players, active players, contests, commission earned, money requests, CSV downloads.

## One-time setup
1. **Supabase → SQL Editor**: paste all of `supabase/setup.sql` and press Run. It ends with "Dalal Street League database is ready."
2. **Supabase → Authentication → Sign In / Providers → Email**: turn **Confirm email** off (the free plan sends only a couple of emails per hour).
3. **Supabase → Authentication → URL Configuration**: set **Site URL** to the app address (used by "Forgot password").
4. **Supabase → Settings → API**: copy the `service_role` key. **GitHub → repo Settings → Secrets and variables → Actions → New repository secret**: name `SUPABASE_SERVICE_KEY`, value = that key. Never put this key anywhere else.
5. **GitHub → Actions → "Update prices and settle contests" → Run workflow** once, so prices reach the database.
6. Open the app, sign up with your own email, then in the Supabase SQL Editor run `select dsl_make_owner('your@email.com');` and reload the app. The Owner tab appears; set your UPI ID under Settings.

## Security model
- Players can only read their own profile, wallet and requests. Other players' portfolios are hidden until a contest is full.
- Nobody can write to a table from the browser. Money and contests change only through database functions that check everything again on the server (balance, prices, coins, duplicate UPI references).
- Settlement and refunds can only be run with the service key, which exists only as a GitHub secret.

## Contests, prizes and DSL commission
| Contest | Entry → coins | Prizes | DSL commission |
|---|---|---|---|
| 1 vs 1 | ₹49 → 50,000 · ₹99 → 1,00,000 · ₹199 → 2,00,000 · ₹499 → 5,00,000 · ₹1,000 → 10,00,000 | Winner gets ₹90 / ₹180 / ₹360 / ₹900 / ₹1,800 | ₹8 / ₹18 / ₹38 / ₹98 / ₹200 per match |
| League of 10 | ₹49, ₹99, ₹199, ₹499 | Top 3 share 50% / 30% / 20% of the prize pool | 15% of entries |
| Mega League 50 | ₹49, ₹99, ₹199, ₹499 | Top 15 win: rank 1 28%, rank 2 16%, rank 3 10%, ranks 4–10 4% each, ranks 11–15 3.6% each | 20% of entries |

A contest that does not fill by its last day is cancelled and every entry is refunded. Ties share the prizes of the ranks they cover. Amounts that cannot be split into whole rupees stay with DSL, so commission is never below the designed amount. Exact figures: Rules & Prizes tab, or `site/js/engine.js`.

## Prices
- `scripts/sync-prices.js` runs on GitHub Actions, writes `site/data/prices.json` and copies prices into the database.
- **Official closing prices** come from the NSE daily bhavcopy file. Contests are always settled on these.
- **Delayed quotes** (about 15 minutes, Yahoo Finance) are used during market hours only as the buying price.
- `scripts/settle.js` then settles finished contests with the same engine code the app uses.

## Run it
```bash
npm start
```
```bash
npm test
```
To publish: GitHub → Settings → Pages → Deploy from branch `main`, folder `/ (root)`.

## Before taking real money
Paid-entry online games with cash prizes are prohibited in India under the Promotion and Regulation of Online Gaming Act, 2025, whichever way the money is collected. Take legal advice before accepting any real payment through this app.

A simulation game played with virtual coins. For education only. Not investment advice.
