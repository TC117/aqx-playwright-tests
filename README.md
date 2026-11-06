# Technical Assessment – QA Automation

Automated tests for a trading platform (Aquariux AQX Trader demo environment),
written with Playwright (TypeScript) and Python.

## Functional scope

1. Buy/Sell market orders with Stop Loss and Take Profit
2. Buy/Sell market orders with One-Click Trading enabled
3. Pending orders with supported order types and expiry options
4. View, modify, partially close and close open positions
5. Bulk close / delete of supported orders
6. Trading transactions, order notifications and order history
7. Order details and transaction status across trading records

## Tech stack

- [Playwright Test](https://playwright.dev) with TypeScript (strict mode)
- Page Object Model, page objects exposed as Playwright fixtures
- ESLint (`typescript-eslint`, `eslint-plugin-playwright`) and Prettier

## Project structure

```
src/
  config/env.ts        Typed settings loaded from .env.local / .env
  fixtures/test.ts     Playwright `test` extended with page objects
  pages/               Page objects (BasePage, LoginPage, ...)
tests/
  auth.setup.ts        Logs in once and saves the session to .auth/user.json
  smoke/               Checks that run without a logged-in session
  trading/             Trading scenarios, reuse the saved session
playwright.config.ts   Projects: setup -> trading, plus smoke
```

## Setup

Requires Node.js 20+.

```bash
npm ci
npx playwright install chromium
cp .env.example .env.local   # then fill in BASE_URL and the demo account credentials
```

## Running tests

| Command                | What it does                           |
| ---------------------- | -------------------------------------- |
| `npm test`             | Run every project                      |
| `npm run test:smoke`   | Smoke checks only (no login needed)    |
| `npm run test:trading` | Log in, then run the trading scenarios |
| `npm run test:headed`  | Run with a visible browser             |
| `npm run report`       | Open the last HTML report              |
| `npm run typecheck`    | TypeScript type check                  |
| `npm run lint`         | ESLint                                 |

Settings are read from real environment variables first, then `.env.local`, then `.env`
(both files are git-ignored). Tests that need the web trader skip themselves with a clear
reason when the credentials are missing.

## Design notes

- **Serial execution.** All tests share one demo account, so orders and positions created by
  one test are visible to the others. `workers: 1` keeps the account state predictable.
- **Log in once.** The `setup` project signs in and stores the browser state; the `trading`
  project depends on it and starts already logged in.
- **Failure evidence.** Traces, screenshots and videos are kept for failed tests only.

## Status

Framework base is in place. `LoginPage` uses the app's own `data-testid` attributes
(`login-user-id`, `login-password`, `login-submit`, `tab-login-account-type-demo`), checked
against the live login page (the site root redirects to `/web/login`). Assumptions and environment limitations will be
documented here as the trading scenarios are implemented.
