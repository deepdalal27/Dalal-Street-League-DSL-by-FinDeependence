# Dalal Street League (DSL) by FinDeependence

**Created by CA Deep Dalal · Chartered Accountant · Fund Manager**

A stock market fantasy league. A player gets virtual coins (1 coin = ₹1 of buying power in the game), builds a portfolio of NSE stocks, and the best portfolio on the official closing prices of the last day wins.

This is the **working prototype**: the whole game runs in the browser and is stored on the device. Opponents are simulated players. Real player-vs-player matches, OTP sign-up and a shared database come with the server in the next step.

## What is in the prototype
- **Sign-up / log-in** with name, email and mobile number.
- **Wallet**: the player enters an amount, pays it to the owner's UPI ID, and sends the UPI reference number. The owner approves the request in the Owner tab and the wallet is credited. Withdrawals work the same way in reverse.
- **Contests**: 1 vs 1, League of 10 and Mega League 50, each as a daily, weekly or monthly contest.
- **Portfolio builder**: buy at least 3 stocks with the coins, at the latest price.
- **Leaderboards**, automatic settlement on closing prices, prizes credited to wallets.
- **Owner tab** (PIN locked): players, active players, contests played, commission earned, money requests, CSV downloads, and demo tools to simulate closing days.

## Contests, prizes and DSL commission
| Contest | Entry → coins | Prizes | DSL commission |
|---|---|---|---|
| 1 vs 1 | ₹49 → 50,000 · ₹99 → 1,00,000 · ₹199 → 2,00,000 · ₹499 → 5,00,000 · ₹1,000 → 10,00,000 | Winner gets ₹90 / ₹180 / ₹360 / ₹900 / ₹1,800 | ₹8 / ₹18 / ₹38 / ₹98 / ₹200 per match |
| League of 10 | ₹49, ₹99, ₹199, ₹499 | Top 3 share 50% / 30% / 20% of the prize pool | 15% of entries |
| Mega League 50 | ₹49, ₹99, ₹199, ₹499 | Top 15 win: rank 1 28%, rank 2 16%, rank 3 10%, ranks 4–10 4% each, ranks 11–15 3.6% each | 20% of entries |

Ties share the prizes of the ranks they cover. Amounts that cannot be split into whole rupees stay with DSL, so commission is never below the designed amount. Exact figures: Rules & Prizes tab, or `site/js/engine.js`.

## Prices
- `scripts/sync-prices.js` runs on GitHub Actions and writes `site/data/prices.json`.
- **Official closing prices** come from the NSE daily bhavcopy file. Contests are always settled on these.
- **Delayed quotes** (about 15 minutes, Yahoo Finance) are used during market hours only as the buying price.
- Until the first sync has run, the app shows clearly labelled **sample prices**.

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
