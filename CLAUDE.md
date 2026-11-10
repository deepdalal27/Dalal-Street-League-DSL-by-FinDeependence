# Dalal Street League (DSL) by FinDeependence

Always brand as **FinDeependence**, with the round logo (`site/logo_circle.png`) and **"Created by CA Deep Dalal"** (byline: CA Deep Dalal · Chartered Accountant · Fund Manager). UI tokens are the same as the FinDeependence IPO Deal Desk: navy header `#0E2740`, paper background `#F6F2E8`, green `#3C9A08` primary, teal `#2C8F93` labels, Bricolage Grotesque headings, Inter body, JetBrains Mono labels and numbers, 14px panels.

## Code map
- `site/js/engine.js` — contest catalogue, prize and commission maths, tie rules, portfolio scoring, contest dates, price view (tested in `test/engine.test.js`).
- `site/js/app.js` — the app: sign-up, wallet and owner-approved top-ups, lobby, portfolio builder, leaderboards, owner control room. State lives in localStorage (`dsl.v1`) until a server is added.
- `site/data/universe.js` — stocks players can pick (NSE symbols; `p` is a sample price only).
- `scripts/sync-prices.js` + `scripts/prices-lib.js` — GitHub Actions sync writing `site/data/prices.json` (official NSE closes + delayed quotes).
- No build step. `npm test` runs the engine tests; `npm start` serves `site/`.
