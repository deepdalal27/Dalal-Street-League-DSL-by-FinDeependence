# Dalal Street League (DSL) by FinDeependence

Always brand as **FinDeependence**, with the round logo (`site/logo_circle.png`) and **"Created by CA Deep Dalal"** (byline: CA Deep Dalal · Chartered Accountant · Fund Manager). UI tokens are the same as the FinDeependence IPO Deal Desk: navy header `#0E2740`, paper background `#F6F2E8`, green `#3C9A08` primary, teal `#2C8F93` labels, Bricolage Grotesque headings, Inter body, JetBrains Mono labels and numbers, 14px panels.

## Code map
- `site/js/engine.js` — contest catalogue, prize and commission maths, tie rules, portfolio scoring, contest dates, price view (tested in `test/engine.test.js`).
- `site/js/app.js` — the app (Supabase client): sign-up, wallet, lobby, portfolio builder, leaderboards, owner control room.
- `site/js/config.js` — Supabase URL and anon key (public). The service key is only a GitHub secret (`SUPABASE_SERVICE_KEY`); never commit it.
- `supabase/setup.sql` — tables, row-level security and every money/contest function. Idempotent. `dsl_rake_bp()` and `dsl_coins()` must match the engine (a test checks this). After any change the owner must re-run the file in the Supabase SQL Editor; say so in your summary.
- `site/data/universe.json` — the Nifty 500 with cap group `c` (L/M/S), written daily by the sync. `site/data/universe.js` is the built-in fallback (`p` is a sample price only).
- `scripts/sync-prices.js` + `scripts/prices-lib.js` — NSE closes + delayed quotes to `site/data/prices.json` and the database. `scripts/settle.js` — settlement and refunds via `scripts/supabase-lib.js`.
- No build step. `npm test` runs the unit tests; `npm start` serves `site/`.
- Money is whole rupees in `dsl_txns`; a wallet balance is always the sum of its rows. Never add a way for the browser to write tables directly.
- Contest model: entries close at `lock_at` (09:15 IST next weekday); `dsl_lock_due()` starts contests with 2+ players and refunds the rest; prizes are `E.prizePlan(joined, entry, duration)`.
- Engagement features stay honest: no fake scarcity or countdowns, no prompts to chase losses; the daily entry limit (`dsl_set_day_limit`) must keep working.
