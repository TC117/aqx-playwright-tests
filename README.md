# Technical Assessment – QA Automation

Automated tests for the Aquariux **AQX Trader** web demo, written with Playwright Test and
TypeScript. They run against the live demo platform on a demo account with virtual funds.

> **Market status during the assessment.** On the last day of the 2-day window (Sunday
> 2026-11-08) every instrument on the demo was closed: 35 symbols `CLOSED`, and XTIUSD
> `OFFQUOTES` despite its weekend session. Live order execution could not run. As the brief asks,
> the trading scenarios are written in full and **skip with the reason "market is closed"** until
> the platform reports the market open. Everything that does not need an execution runs today,
> against the live site or with the server's read replies replaced: see [Coverage](#coverage).

## Functional scope

| #   | Requirement                                                  |
| --- | ------------------------------------------------------------ |
| R1  | Buy/Sell market orders with Stop Loss and Take Profit        |
| R2  | Buy/Sell market orders with One-Click Trading enabled        |
| R3  | Pending orders with supported order types and expiry options |
| R4  | View, modify, partially close and close open positions       |
| R5  | Bulk close / delete of supported orders                      |
| R6  | Trading transactions, order notifications and order history  |
| R7  | Order details and transaction status across trading records  |

- [docs/testcase-final.md](docs/testcase-final.md): test design (108 cases, priorities,
  traceability, automation strategy, assumptions). Test titles start with the case id, e.g.
  `TC-MKT-04 …`.
- [docs/platform-notes.md](docs/platform-notes.md): what was learned about the platform (API,
  rules, exact messages) and **findings worth a second look**, such as a double click sending two
  One-Click orders.

## How the suite is organised

Each kind of test is a Playwright project, so it runs only where it makes sense:

| Project    | Folder           | Login | What it checks                                                                                                                                        |
| ---------- | ---------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `setup`    | `tests/`         | –     | Logs in, or reuses a session the server still accepts, and saves it                                                                                   |
| `smoke`    | `tests/smoke`    | no    | Login page                                                                                                                                            |
| `terminal` | `tests/terminal` | yes   | Anything that works in any market state: validation, Trade Details maths, settings, closed-market behaviour, records already on the account           |
| `mocked`   | `tests/mocked`   | yes   | The real web app with the server's **read** replies replaced: order requests, dialogs, tables, history and notifications. No order reaches the server |
| `trading`  | `tests/trading`  | yes   | Real orders on the demo account; each test skips while its market is closed                                                                           |

```
src/
  api/AqxApi.ts          Read-only client for the platform's own REST API
  config/env.ts          Typed settings from the environment / .env.local
  fixtures/test.ts       `test` with fixtures: api, tradePage, orders, symbol
  helpers/               Market status, order price maths, number parsing, OrderTracker, mocked market
  models/trading.ts      Shared types (orders, table rows, notifications)
  pages/                 LoginPage, TradePage and its components (order panel, tables, dialogs, ...)
tests/                   setup, smoke, terminal, mocked, trading
docs/                    Test design and platform notes
.github/workflows/       CI
```

## Setup

Requires Node.js 20+.

```bash
npm ci
npx playwright install chromium
cp .env.example .env.local   # then fill in BASE_URL and the demo account credentials
```

Register a demo account at <https://www.aquariux.com/solutions/trader/>. Settings are read from
real environment variables first, then `.env.local`, then `.env` (both files are git-ignored).
Without credentials every logged-in test skips with a clear reason. Trading tests place real (demo) orders only with `ALLOW_TRADING=true`; otherwise they skip and say so.

## Running tests

| Command                                                       | What it does                                            |
| ------------------------------------------------------------- | ------------------------------------------------------- |
| `npm run test:safe`                                           | smoke + terminal + mocked: never places an order        |
| `npm run test:trading`                                        | Real demo orders (they skip while the market is closed) |
| `npm test`                                                    | Every project                                           |
| `npm run test:headed`                                         | Visible browser                                         |
| `npm run report`                                              | Open the last HTML report                               |
| `npm run typecheck` / `npm run lint` / `npm run format:check` | Static checks                                           |

Filter by requirement or kind with tags, e.g. `npx playwright test --grep @R4` or
`--grep @market-open`.

## Coverage

Counts of tests per requirement and project (a test can serve two requirements). `terminal` and
`mocked` ran green on 2026-11-08; `trading` skipped because every market was closed.

| Req | terminal | mocked | trading | What is checked                                                                                                                                                                                                                                                               |
| --- | -------- | ------ | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | 12       | 9      | 9       | Exact SL/TP validation for Buy and Sell; points → price; Trade Details (margin, trade volume, tick value, potential loss/gain, risk:reward) from the symbol spec and leverage; the exact order request and confirmation dialog; fill price within the quotes around the click |
| R2  | 7        | 9      | 5       | Terms dialog, Cancel and Agree (UI and server setting), setting survives a reload; no confirmation and exactly one request; server error, rejection and network failure; double-click (known issue)                                                                           |
| R3  | 12       | 17     | 27      | Order types and expiry options match the symbol spec; SL/TP against the order price; calendar and time picker on the server clock; exact request per type × side × expiry; closed market blocks all six                                                                       |
| R4  | 3        | 5      | 6       | Columns and empty state; every field of a position; floating P/L from Bid/Ask; Edit and Close dialog validation; modify, partial close (same Order No.) and close on the real server                                                                                          |
| R5  | 4        | 7      | 4       | Menus and dialog texts; each bulk kind sends exactly the matching items; empty lists do nothing; live bulk actions only when the account holds nothing but the test's own orders                                                                                              |
| R6  | 10       | 6      | 3       | The deposit as a BALANCE record matching the API; balance = sum of booked records; date-range presets; notification tabs against the API                                                                                                                                      |
| R7  | 6        | 6      | 3       | Account figures agree between header, dropdown and API; one position lifecycle agrees across Positions History, Orders & Deals, notifications and Order Details                                                                                                               |

Totals: smoke 1, terminal 45, mocked 44, trading 48.

## Design decisions

- **Real platform first; mock only what the server reports.** `mocked` tests replace read replies
  (market status, positions, history, notifications) so the UI can be checked in states the demo
  cannot produce today. Write requests are answered in the browser or aborted, never sent. A
  mocked test proves what the UI shows and sends, not what the server decides.
- **The platform decides whether the market is open.** `skipUnlessMarketOpen` reads the symbol's
  status from the platform's API. A test never infers "closed" from missing prices, so an outage
  while the market is open still fails.
- **Own your orders.** The account is shared, so a trading test snapshots the Order No. list,
  treats exactly one new number as its own (`OrderTracker`) and removes only that at the end, one
  item at a time. Bulk-action tests skip unless the account holds nothing but their own orders.
- **Safety guards.** Real orders need `ALLOW_TRADING=true`, and the `orders` fixture refuses to trade on anything but a demo account. Tests
  that switch One-Click Trading on switch it off again in teardown, even after a failure.
- **Values, not visibility.** Tests compare prices, volumes, SL/TP, Order No., states and money
  across the order panel, the tables, notifications, history and the API. Expected numbers come
  from the symbol specification and the account (API), not from hard-coded values. Fill prices
  are checked as a range because the market moves.
- **Robust against the app's own timing.** The order form resets when the symbol's specification
  arrives or One-Click Trading changes, the tables render lazily and show at most 30 rows, the
  search box can drop a keystroke: page objects wait for the right signal or re-read and retry,
  never sleep.
- **One login.** Setup reuses the saved session while the server accepts it, because each login
  ends an older session of the account.
- **Serial, no retries.** One shared account → `workers: 1`; a retry could place a second order →
  `retries: 0`.
- **Locators.** The app's own `data-testid` attributes first, then roles and text scoped to a
  container. No generated CSS classes, no XPath for elements, no `force` clicks.

## CI

[`.github/workflows/tests.yml`](.github/workflows/tests.yml) runs type check, lint and format,
then `smoke`, `terminal` and `mocked` on every push to `main` and every pull request. Credentials
come from the `TRADER_USERNAME` / `TRADER_PASSWORD` repository secrets; without them the
logged-in tests skip. The `trading` project runs only on a manual run with "trading" ticked, which also sets `ALLOW_TRADING=true`. All
runs share one concurrency group because they share one demo account. The HTML report is
uploaded as an artifact.

## Assumptions and environment limitations

- **Demo account** with virtual funds: balance 1,000,000 USD, leverage 1:100, expires
  2026-12-06. After that date a login failure means a new demo account is needed.
- **Instrument:** EURUSD by default (4 digits, min 0.01 lot, step 0.01, max 100, contract
  100,000). Override with `DEFAULT_SYMBOL` or `test.use({ symbol })`.
- **Market closed** for the whole final day, so `trading` tests were written and reviewed but not
  executed. Their page objects are the same ones the `terminal` and `mocked` tests exercise; what
  remains unverified is the real server's behaviour (fills, rejection codes, record wording).
- **Shared account:** tests run serially and own their orders; bulk-action tests skip if anything
  else is open. One-Click Trading is an account-wide setting; tests restore it.
- **Hedging** is assumed (a Buy and a Sell on the same symbol can be open together).
- **Not automated:** behaviour that needs the market to move (SL/TP hits, pending triggers),
  re-login (it would end other sessions), and anything outside the brief (registration,
  deposits, charts, mobile).
