# Dalal Street League (DSL) by FinDeependence

**Created by CA Deep Dalal · Chartered Accountant · Fund Manager**

A stock market fantasy league. A player gets virtual coins (1 coin = ₹1 of buying power in the game), builds a portfolio of NSE stocks, and the best portfolio on the official closing prices of the last day wins.

Players sign up, add money to a wallet, and play each other. Accounts, wallets and contests live in a free Supabase project; the app itself is a static site on GitHub Pages.

## What it does
- **Sign-up / log-in** with name, email, mobile number and a password.
- **Wallet**: the player enters an amount, pays it to the owner's UPI ID, and sends the UPI reference number. The owner approves the request in the Owner tab and the wallet is credited. Withdrawals work the same way in reverse.
- **Contests between real players**: 1 vs 1, League of 10, Mega League 50 and private tournaments for 2 to 100 friends, each daily, weekly or monthly.
- **Invite links**: one for the app (the owner sees who invited whom) and one for every contest.
- **Stocks**: the Nifty 500, tagged Large cap (Nifty 100), Mid cap (Nifty Midcap 150) and Small cap (Nifty Smallcap 250). The list refreshes daily from NSE into `site/data/universe.json`.
- **Portfolio builder**: buy at least 3 stocks with the coins, filter by cap, see the large/mid/small mix, split coins equally or reuse the last portfolio. The server takes the price at the moment of joining.
- **Player experience**: home summary with level, entries-close countdown, running contests and one-tap replays; result screen for each finished contest; levels and badges; weekly, monthly and all-time leaderboard (points by finishing position, not by money spent).
- **Responsible play**: each player can set a daily entry limit (lowering is immediate, raising waits 24 hours, enforced by the database) and sees their honest net result in the wallet.
- **Settlement**: every evening the GitHub Actions job values all portfolios on the official NSE closing prices, pays prizes into wallets, and refunds contests nobody else joined.
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
Contests: **1 vs 1**, **League of 10**, **Mega League 50**, and **private tournaments** of 2 to 100 players that a player sets up for friends. Entries: ₹49, ₹99, ₹199, ₹499, ₹1,000 (50,000 to 10,00,000 coins). Each runs daily, weekly or monthly. Every contest has an invite link.

**Entries close at 09:15 IST on the next trading day.** The contest then runs with the players who joined, and the prize plan is the one for that number of players. A contest nobody else joined is refunded in full.

**DSL commission** (share of all entries; the rest is the prize pool):

| Players who joined | Daily | Weekly | Monthly |
|---|---|---|---|
| 2 | 12% | 10% | 8% |
| 3 to 5 | 13% | 11% | 9% |
| 6 to 10 | 14% | 12% | 10% |
| 11 to 25 | 15% | 13% | 11% |
| 26 to 50 | 17% | 15% | 13% |
| 51 to 100 | 18% | 16% | 14% |

- Longer contests pay players more (money is locked longer). Daily contests repeat about 20 times a month, so they still earn the most per rupee over time.
- More players means a higher rate on a bigger total.

**Prize plan** for n players:
- About 40% of players win.
- Top tier (about the top 20%): at least 1.9x the entry each, more than any 1 vs 1 win, with the rest of the pool weighted heavily to the top ranks (1/rank²).
- Saver tier (the next 20%): entry back plus 15%.
- 1 vs 1: the winner takes the pool (₹49 entry pays ₹86 daily, ₹88 weekly, ₹90 monthly).
- Ties share the prizes of the ranks they cover. Amounts that cannot be paid in whole rupees stay with DSL, so commission is never below the table above.

Examples at ₹99 entry, daily: League of 10 full pays ₹387 / ₹237 / ₹113 / ₹113 (DSL ₹140). Mega League 50 full pays ₹896 for 1st down to ₹195 for 10th and ₹113 for ranks 11 to 20 (DSL ₹846).

All numbers live in `site/js/engine.js` (`RAKE_TIME`, `RAKE_SIZE`, `TOP_BP`, `SAVER_BP`); the fee table is mirrored in `dsl_rake_bp()` in `supabase/setup.sql`, and a test checks they match. **After changing `supabase/setup.sql`, run it again in the Supabase SQL Editor.**

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
