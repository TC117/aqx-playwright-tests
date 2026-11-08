# Final Test Cases – AQX Trader: Orders & Positions

Final, consolidated test-case set for the QA Automation Technical Assessment, run against the
Aquariux AQX Trader web demo environment.

- **Status:** Final, 2026-11-08 (revised after peer review). Supersedes the two drafts: set 001
  (104 cases, with its automation-feasibility assessment) and set 002
  (88 cases). How the two were merged is described in
  [§12](#12-merge-notes) and [§13](#13-id-mapping).
- **Basis:** the assessment requirements and standard CFD/FX trading rules. The cases were
  written before the trading UI was explored; most open questions are now answered in
  [platform-notes.md](platform-notes.md) (see [§11](#11-open-questions)).

---

## 1. Scope

| #   | Requirement                                                 | Module | Prefix   |
| --- | ----------------------------------------------------------- | ------ | -------- |
| R1  | Buy/Sell market orders with Stop Loss and Take Profit       | M1     | `TC-MKT` |
| R2  | Buy/Sell market orders with One-Click Trading enabled       | M2     | `TC-OCT` |
| R3  | Pending orders: supported order types and expiry options    | M3     | `TC-PND` |
| R4  | View, modify, partially close and close open positions      | M4     | `TC-POS` |
| R5  | Bulk close / bulk delete                                    | M5     | `TC-BLK` |
| R6  | Trading transactions, order notifications, order history    | M6     | `TC-HIS` |
| R7  | Order details and transaction status across trading records | M7     | `TC-DTL` |
| –   | Error handling and resilience (supports R1–R7)              | M8     | `TC-ERR` |

**Out of scope:** account registration, real-money deposits/withdrawals, charts and indicators
(drawn on canvas, not part of the requirements), mobile apps, performance/load testing, live
accounts.

---

## 2. Test environment, data and trading rules

| Item               | Value                                                                                                                                                                                                                                                                                   |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Platform           | AQX Trader web (`BASE_URL` in `.env`), desktop Chrome, viewport 1600×900                                                                                                                                                                                                                |
| Account            | Demo account with virtual funds (expires 2026-12-06), assumed **hedging** (§10)                                                                                                                                                                                                         |
| Primary symbol     | `EURUSD` – FX major, 5 digits, min lot assumed 0.01 (to confirm, §11), tight spread                                                                                                                                                                                                     |
| Secondary symbol   | `XAUUSD` – gold, 2 digits, moves faster (used for SL/TP and pending-trigger cases)                                                                                                                                                                                                      |
| Weekend symbol     | `BTCUSD` or another crypto CFD – only if the demo quotes it 24/7                                                                                                                                                                                                                        |
| Volumes            | `0.01` (min lot), `0.10` (standard – allows a 0.05 partial close), symbol max lot. Written for min lot 0.01 / step 0.01; the symbol-spec helper reads the real values, and if the demo uses min lot 0.1, every volume in this document scales × 10 (0.01 → 0.1, 0.05 → 0.5, 0.10 → 1.0) |
| SL/TP/price offset | `X` = symbol stops level + buffer (e.g. stops level + 50 points), from the live price                                                                                                                                                                                                   |

### Price rules

| Item              | Buy                                 | Sell                                |
| ----------------- | ----------------------------------- | ----------------------------------- |
| Opens at          | Ask                                 | Bid                                 |
| Closes at         | Bid                                 | Ask                                 |
| Valid Stop Loss   | below Bid (by ≥ stops level)        | above Ask (by ≥ stops level)        |
| Valid Take Profit | above Bid (by ≥ stops level)        | below Ask (by ≥ stops level)        |
| Floating P/L      | (Bid − Open) × Lots × Contract size | (Open − Ask) × Lots × Contract size |

| Pending type    | Order price must be                  | Triggers when                     |
| --------------- | ------------------------------------ | --------------------------------- |
| Buy Limit       | below Ask                            | Ask ≤ price                       |
| Sell Limit      | above Bid                            | Bid ≥ price                       |
| Buy Stop        | above Ask                            | Ask ≥ price                       |
| Sell Stop       | below Bid                            | Bid ≤ price                       |
| Buy Stop Limit  | stop above Ask, limit **below** stop | Ask ≥ stop → becomes a Buy Limit  |
| Sell Stop Limit | stop below Bid, limit **above** stop | Bid ≤ stop → becomes a Sell Limit |

For pending orders, SL/TP are validated against the **order price** (the **limit price** for
stop-limit orders), not the current market price.

### Account formulas

- `Required margin = Lots × Contract size × Price / Leverage`, in account currency (some symbols
  may use a fixed or percentage margin – check the symbol info).
- `Equity = Balance + Credit + Floating P/L` (floating P/L includes swap and commission of open
  positions).
- `Free margin = Equity − Used margin`.
- `Margin level = Equity / Used margin × 100%`; shown as empty or "–" while used margin is 0.
- `Net P/L` of a deal = P/L + commission + swap, as booked by the platform.

---

## 3. Conventions

- **Type:** `Pos` positive, `Neg` negative, `Bnd` boundary, `E2E` end-to-end.
- **Priority:** `P1` must pass (core order and money flow), `P2` important, `P3` nice to have.
  Priority is business impact, independent of how the case is run.
- **Run:**
  - `Regular` – automated, part of every run.
  - `Slow` – automated, waits for time or price movement; time-boxed, skips with a reason if the
    price does not move; runs nightly (`@slow`).
  - `Mocked` – automated UI-level check with intercepted server responses or events, real login
    kept (`@mocked`, folder `tests/mocked/`). It proves the UI reacts correctly; it never
    replaces the real test of what the server decides.
  - `Manual` – manual checklist.
  - `A + B` (e.g. `Slow + Mocked`) – the case has two parts, each run as labelled; it is counted
    under both labels in §7.
- **Moving prices:** SL/TP and pending prices are computed from the live quote at run time.
  Fill prices are checked as a range (between the quote before and after the click, plus a
  tolerance), not as exact values. Records are compared with each other (order, notification,
  history) instead of predicting numbers.
- **Tolerances** (defaults, tuned once the platform is explored): fill price within the quote
  range ± 2 × the current spread; money values ± 0.01 in account currency (rounding); P/L ± the
  value of one tick for the position's volume.
- **Unknown product rules:** the expected result states the most common behaviour. A different
  behaviour is logged as a finding and the case is updated once clarified ([§11](#11-open-questions)).
- **Error messages:** expected results say "a clear message" until the UI is explored. The exact
  wording is then recorded per case and asserted, so a changed or generic message is caught.

## 4. Common preconditions

| ID    | Precondition                                                                                                                                                                                                         |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PRE-1 | Logged in to AQX Trader with the demo account, confirmed by the safety guard (§9.1, item 7); free margin is enough for the test (≥ USD 1,000).                                                                       |
| PRE-2 | Market is open for the chosen symbol (except the "market closed" cases).                                                                                                                                             |
| PRE-3 | One-Click Trading is **OFF** (default) unless the test says otherwise. OCT tests switch it back OFF in teardown.                                                                                                     |
| PRE-4 | No leftover positions/pending orders on the test symbols: clean-up before each test removes them (the demo account is used only by these tests). Assertions use the IDs the test itself created.                     |
| PRE-5 | For market-closed cases that need an existing position: a position opened **before** the market closed, tagged so the clean-up step does not close it.                                                               |
| PRE-6 | For `Mocked` parts: real login through the saved session; interception is registered **before** the page is opened (`page.routeWebSocket` only catches sockets opened after it is set); service workers are blocked. |

---

## 5. Test cases

### M1 – Market orders with Stop Loss / Take Profit (R1)

| ID        | Scenario                                    | Type    | Pre                                  | Steps                                                                                                                                                                                             | Expected result                                                                                                                                                                                                                                   | Pri | Run           |
| --------- | ------------------------------------------- | ------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | ------------- |
| TC-MKT-01 | Order panel shows a live quote              | Pos     | PRE-1, 2                             | Select EURUSD, then XAUUSD; watch the quote for 10 s                                                                                                                                              | Bid and Ask shown with the symbol's digits (5 for EURUSD, 2 for XAUUSD); Ask > Bid; spread shown = Ask − Bid; prices update while the market is open                                                                                              | P2  | Regular       |
| TC-MKT-02 | Buy market order, no SL/TP (baseline)       | Pos     | PRE-1..4                             | 1. Select EURUSD<br>2. Order type Market, volume 0.01<br>3. Note Ask, click Buy, confirm, note Ask again                                                                                          | Open price is between the two noted Ask values ± tolerance; new row in Open Positions: EURUSD, Buy, 0.01, SL/TP empty; fill notification; used margin grows by the required margin (§2); balance unchanged (unless commission is charged on open) | P1  | Regular       |
| TC-MKT-03 | Sell market order, no SL/TP (baseline)      | Pos     | PRE-1..4                             | As TC-MKT-02 with Sell, noting Bid                                                                                                                                                                | Open price is between the two noted Bid values ± tolerance; position side Sell; rest as TC-MKT-02                                                                                                                                                 | P1  | Regular       |
| TC-MKT-04 | Buy market order with valid SL and TP       | Pos     | PRE-1..4                             | 1. Read Bid<br>2. SL = Bid − X, TP = Bid + X<br>3. Volume 0.01, click Buy, confirm                                                                                                                | Confirmation shows the entered SL/TP; position shows SL and TP exactly as entered (symbol digits)                                                                                                                                                 | P1  | Regular       |
| TC-MKT-05 | Sell market order with valid SL and TP      | Pos     | PRE-1..4                             | 1. Read Ask<br>2. SL = Ask + X, TP = Ask − X<br>3. Click Sell, confirm                                                                                                                            | As TC-MKT-04 for a Sell position                                                                                                                                                                                                                  | P1  | Regular       |
| TC-MKT-06 | SL only / TP only (4 data rows)             | Pos     | PRE-1..4                             | Place Buy+SL, Buy+TP, Sell+SL, Sell+TP                                                                                                                                                            | Only the entered level is set on the position; the other stays empty                                                                                                                                                                              | P2  | Regular       |
| TC-MKT-07 | SL/TP entered in points/pips (if supported) | Pos     | PRE-1..4                             | Switch SL/TP input to points, enter N points, place Buy                                                                                                                                           | Shown price = reference price ± N × point size; position stores that price                                                                                                                                                                        | P2  | Regular       |
| TC-MKT-08 | Buy with SL above Bid, or TP below Bid      | Neg     | PRE-1..4                             | 1. Buy, SL = Bid + X → try to place<br>2. Buy, TP = Bid − X → try to place                                                                                                                        | Inline validation error or server rejection with a clear message; Buy/confirm blocked; no position created                                                                                                                                        | P1  | Regular       |
| TC-MKT-09 | Sell with SL below Ask, or TP above Ask     | Neg     | PRE-1..4                             | Mirror of TC-MKT-08 for Sell                                                                                                                                                                      | As TC-MKT-08                                                                                                                                                                                                                                      | P1  | Regular       |
| TC-MKT-10 | SL/TP distance near the stops-level limit   | Bnd     | PRE-1..4                             | 1. Read the symbol stops level S<br>2. SL at S − 5 points from the reference price → place<br>3. SL at S + 5 points → place<br>4. SL exactly at the reference price (distance 0) → place          | Inside the limit is rejected; just outside is accepted (the 5-point margin keeps the check stable while price moves). If S = 0, only check that an SL 1 point away is accepted. An SL at distance 0 is always rejected                            | P2  | Regular       |
| TC-MKT-11 | Volume validation                           | Bnd/Neg | PRE-1..4                             | Try volume: 0.01 (min – place it), symbol max (field only – do not submit), 0.001, 0, −0.01, `abc`, 0.015 (not a step multiple), max + step                                                       | 0.01 is placed; max is accepted by the field (submitting it is limited by margin, see TC-MKT-12); all others are blocked by the input or rejected with a message, and no order is sent                                                            | P1  | Regular       |
| TC-MKT-12 | Insufficient free margin                    | Neg     | PRE-1, 2, 4                          | Enter a volume whose required margin > free margin; Buy, confirm. If even the max lot fits, first open max-lot positions until the free margin is below one lot's required margin, then try again | Rejected with an "insufficient margin / not enough money" message; no new position or pending order; balance, equity and used margin unchanged by the rejected order; nothing added to deal history or transactions                               | P1  | Regular       |
| TC-MKT-13 | Confirmation dialog content and Cancel      | Pos     | PRE-1..4                             | 1. Fill a Buy with SL/TP<br>2. Click Buy, check the dialog<br>3. Click Cancel                                                                                                                     | Dialog shows symbol, side, type, volume, SL, TP (and estimated price/margin if shown); Cancel closes it with no order and no notification                                                                                                         | P2  | Regular       |
| TC-MKT-14 | SL/TP precision follows symbol digits       | Bnd     | PRE-1..4                             | Enter SL with too many decimals (EURUSD 6 dp, XAUUSD 3 dp)                                                                                                                                        | Input is limited/rounded to symbol digits or rejected; stored value equals the displayed value                                                                                                                                                    | P3  | Regular       |
| TC-MKT-15 | Position closes when SL is hit              | Pos     | PRE-1..4 (PRE-6 for the mocked part) | Real: open a Buy on XAUUSD with SL just outside the stops level; wait up to 30 min.<br>Mocked: push a "closed by SL" event for an open position                                                   | Real: closed at ≈ SL (slippage allowed); close reason SL; close notification shown; balance reduced by the net loss.<br>Mocked: the row leaves Open Positions and a notification with the close reason appears, without a reload                  | P1  | Slow + Mocked |
| TC-MKT-16 | Position closes when TP is hit              | Pos     | PRE-1..4 (PRE-6 for the mocked part) | As TC-MKT-15 with a close TP                                                                                                                                                                      | As TC-MKT-15 with close reason TP and the balance increased by the net profit                                                                                                                                                                     | P1  | Slow + Mocked |
| TC-MKT-17 | Market order while the market is closed     | Neg     | PRE-1                                | Select a closed symbol (e.g. EURUSD at the weekend); try Buy and Sell                                                                                                                             | Buy/Sell disabled or "market closed" message; no position or pending order created                                                                                                                                                                | P1  | Regular       |

### M2 – Market orders with One-Click Trading (R2)

| ID        | Scenario                                     | Type | Pre                                     | Steps                                                                                                                                                               | Expected result                                                                                                                                          | Pri | Run              |
| --------- | -------------------------------------------- | ---- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | ---------------- |
| TC-OCT-01 | Enable One-Click Trading                     | Pos  | PRE-1, 3                                | Turn the OCT toggle on; accept the disclaimer if shown                                                                                                              | Toggle shows ON. If the account has never accepted OCT, a disclaimer is shown first (first run only)                                                     | P1  | Regular          |
| TC-OCT-02 | Buy with OCT ON                              | Pos  | PRE-1, 2, 4                             | OCT ON, volume 0.01; click Buy once                                                                                                                                 | Order sent immediately with **no** confirmation dialog; Buy position created; fill notification shown                                                    | P1  | Regular          |
| TC-OCT-03 | Sell with OCT ON                             | Pos  | PRE-1, 2, 4                             | As TC-OCT-02 with Sell                                                                                                                                              | As TC-OCT-02 for a Sell position                                                                                                                         | P1  | Regular          |
| TC-OCT-04 | OCT ON with preset volume, SL and TP         | Pos  | PRE-1, 2, 4                             | OCT ON, volume 0.02:<br>1. Buy with SL = Bid − X, TP = Bid + X<br>2. Sell with SL = Ask + X, TP = Ask − X                                                           | Each position has exactly the preset volume, SL and TP                                                                                                   | P2  | Regular          |
| TC-OCT-05 | Turning OCT off brings back the confirmation | Pos  | PRE-1, 2                                | OCT ON → turn it off; click Buy                                                                                                                                     | Confirmation dialog shown again; no order until confirmed                                                                                                | P1  | Regular          |
| TC-OCT-06 | OCT state after refresh and re-login         | Pos  | PRE-1                                   | OCT ON; refresh the page; then log in again in a new browser context                                                                                                | OCT stays ON after refresh and after re-login (saved per user). Any other behaviour is logged as a finding                                               | P2  | Regular          |
| TC-OCT-07 | Validation still applies with OCT ON         | Neg  | PRE-1, 2                                | OCT ON; invalid volume (0) or invalid SL (wrong side); click Buy                                                                                                    | Order blocked/rejected with a message; no position                                                                                                       | P2  | Regular          |
| TC-OCT-08 | Double-click places one order                | Bnd  | PRE-1, 2, 4 (PRE-6 for the mocked part) | Real: OCT ON; double-click Buy (two clicks < 100 ms apart).<br>Mocked: forward the order request to the real server but hold its response for 3 s; double-click Buy | After a refresh, exactly one new position exists in both parts; while the request is in flight the button shows a busy state or ignores the second click | P2  | Regular + Mocked |
| TC-OCT-09 | Separate clicks place one order each         | Pos  | PRE-1, 2, 4                             | OCT ON; click Buy 3 times, each click after the previous fill notification                                                                                          | Exactly 3 positions and 3 fill notifications; no lost or extra orders                                                                                    | P3  | Regular          |
| TC-OCT-10 | Decline the OCT disclaimer                   | Neg  | Account that never enabled OCT          | Turn OCT on; cancel/close the disclaimer                                                                                                                            | OCT stays OFF; Buy still asks for confirmation                                                                                                           | P3  | Manual           |
| TC-OCT-11 | OCT click while the market is closed         | Neg  | PRE-1                                   | OCT ON; closed symbol; click Buy                                                                                                                                    | No order; "market closed" message                                                                                                                        | P3  | Regular          |
| TC-OCT-12 | Server error with OCT ON                     | Neg  | PRE-1, 6                                | OCT ON; answer the order request with a server error (not forwarded); click Buy                                                                                     | Error message shown; no position appears; OCT stays ON; the order is not resent automatically                                                            | P2  | Mocked           |

### M3 – Pending orders: order types and expiry (R3)

| ID        | Scenario                                             | Type | Pre                                                                                                               | Steps                                                                                                                                                                                                                                         | Expected result                                                                                                                                                                                                                                                                                                                          | Pri | Run              |
| --------- | ---------------------------------------------------- | ---- | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | ---------------- |
| TC-PND-01 | Place Buy Limit, Good Till Cancelled                 | Pos  | PRE-1..4                                                                                                          | Type Limit, Buy, price = Ask − X, volume 0.01, expiry GTC; place                                                                                                                                                                              | Row in Pending Orders: EURUSD, Buy Limit, price, 0.01, GTC, status pending; "order placed" notification; no new position; balance and used margin unchanged (no margin until filled)                                                                                                                                                     | P1  | Regular          |
| TC-PND-02 | Place Sell Limit                                     | Pos  | PRE-1..4                                                                                                          | Sell Limit at Bid + X; place                                                                                                                                                                                                                  | As TC-PND-01 for Sell Limit                                                                                                                                                                                                                                                                                                              | P1  | Regular          |
| TC-PND-03 | Place Buy Stop                                       | Pos  | PRE-1..4                                                                                                          | Buy Stop at Ask + X; place                                                                                                                                                                                                                    | As TC-PND-01 for Buy Stop                                                                                                                                                                                                                                                                                                                | P1  | Regular          |
| TC-PND-04 | Place Sell Stop                                      | Pos  | PRE-1..4                                                                                                          | Sell Stop at Bid − X; place                                                                                                                                                                                                                   | As TC-PND-01 for Sell Stop                                                                                                                                                                                                                                                                                                               | P1  | Regular          |
| TC-PND-05 | Place Buy Stop Limit (if supported)                  | Pos  | PRE-1..4                                                                                                          | Stop = Ask + X, limit = stop − Y; place                                                                                                                                                                                                       | Saved with both prices and type Buy Stop Limit; status pending                                                                                                                                                                                                                                                                           | P1  | Regular          |
| TC-PND-06 | Place Sell Stop Limit (if supported)                 | Pos  | PRE-1..4                                                                                                          | Stop = Bid − X, limit = stop + Y; place                                                                                                                                                                                                       | Saved with both prices and type Sell Stop Limit; status pending                                                                                                                                                                                                                                                                          | P1  | Regular          |
| TC-PND-07 | Stop Limit with an invalid stop/limit relation       | Neg  | PRE-1..4                                                                                                          | Limit = stop; Buy Stop Limit with limit above stop; Sell Stop Limit with limit below stop                                                                                                                                                     | Each is rejected with a clear message; no order created                                                                                                                                                                                                                                                                                  | P2  | Regular          |
| TC-PND-08 | SL/TP are validated against the order price          | Pos  | PRE-1..4                                                                                                          | 1. Buy Limit at P = Ask − X, with X > 2 × stops level + spread<br>2. SL = P − Y<br>3. TP between P + stops level and the current Bid<br>4. Place                                                                                              | Accepted: the TP is valid against P although it is below the current Bid; SL/TP saved on the order                                                                                                                                                                                                                                       | P1  | Regular          |
| TC-PND-09 | Order price on the wrong side for the type           | Neg  | PRE-1..4                                                                                                          | Buy Limit above Ask; Buy Stop below Ask; Sell Limit below Bid; Sell Stop above Bid                                                                                                                                                            | Each is rejected with a clear message; no order created                                                                                                                                                                                                                                                                                  | P1  | Regular          |
| TC-PND-10 | Order price near the stops-level limit               | Bnd  | PRE-1..4                                                                                                          | Price at S − 5 points from market, then at S + 5 points (S = stops level)                                                                                                                                                                     | Inside the limit is rejected; just outside is accepted (if S = 0, only the accept check applies)                                                                                                                                                                                                                                         | P2  | Regular          |
| TC-PND-11 | Invalid price, volume or SL/TP                       | Neg  | PRE-1..4                                                                                                          | Price empty, 0, negative, `abc`; volume rules as TC-MKT-11; SL on the wrong side of the order price                                                                                                                                           | All blocked or rejected with a message; no order created                                                                                                                                                                                                                                                                                 | P2  | Regular          |
| TC-PND-12 | Expiry: Good Till Cancelled                          | Pos  | PRE-1..4                                                                                                          | Regular: place a Buy Limit with GTC; refresh; log in again.<br>Manual: check again after the daily rollover                                                                                                                                   | Expiry shown as GTC; order still pending after refresh, re-login and rollover                                                                                                                                                                                                                                                            | P2  | Regular + Manual |
| TC-PND-13 | Expiry: Good Till Day / Today (if supported)         | Pos  | PRE-1..4                                                                                                          | Place a Buy Limit with day expiry; check after the trading-day rollover                                                                                                                                                                       | Expiry shows end of the trading day (server time); after rollover the order leaves Pending and shows **Expired** in history                                                                                                                                                                                                              | P2  | Manual           |
| TC-PND-14 | Expiry: Good Till Specified Date and Time            | Pos  | PRE-1..4                                                                                                          | Choose "Specified Date and Time"; pick tomorrow 12:00; place                                                                                                                                                                                  | Saved and displayed with the same date/time (timezone stated); order pending                                                                                                                                                                                                                                                             | P1  | Regular          |
| TC-PND-15 | Expiry in the past or equal to now                   | Neg  | PRE-1..4                                                                                                          | Pick yesterday; then the current minute; place                                                                                                                                                                                                | Date picker blocks past dates, or the order is rejected with a message                                                                                                                                                                                                                                                                   | P2  | Regular          |
| TC-PND-16 | Expiry picker across day and month end               | Bnd  | PRE-1, 6                                                                                                          | Fix the browser clock to 23:58 on the last day of a month; open the expiry picker; pick the next day. Do not submit (the server judges expiry by real time)                                                                                   | Picker shows the right "today", allows the next day across the month end, labels the timezone and shows the picked value in the order form                                                                                                                                                                                               | P3  | Mocked           |
| TC-PND-17 | Order expires automatically                          | Pos  | PRE-1..4                                                                                                          | Specified expiry = now + 3 min, price far from market; wait until expiry                                                                                                                                                                      | Order leaves Pending Orders; history status **Expired**; expiry notification shown                                                                                                                                                                                                                                                       | P1  | Slow             |
| TC-PND-18 | Modify a pending order                               | Pos  | TC-PND-01                                                                                                         | Edit the order: change price, SL, TP and expiry; save                                                                                                                                                                                         | List shows the new values; order ID unchanged; "order modified" notification                                                                                                                                                                                                                                                             | P1  | Regular          |
| TC-PND-19 | Modify a pending order with invalid values           | Neg  | TC-PND-01                                                                                                         | Edit: price on the wrong side / SL on the wrong side / past expiry; save                                                                                                                                                                      | Change rejected with a message; original values kept                                                                                                                                                                                                                                                                                     | P2  | Regular          |
| TC-PND-20 | Delete (cancel) one pending order                    | Pos  | TC-PND-01                                                                                                         | Click delete/cancel on the row; confirm                                                                                                                                                                                                       | Order removed from Pending Orders; history status **Cancelled**; notification shown                                                                                                                                                                                                                                                      | P1  | Regular          |
| TC-PND-21 | Pending orders are triggered                         | Pos  | PRE-1..4 (PRE-6 for the mocked part)                                                                              | Real: on XAUUSD place a Buy Stop, Sell Stop, Buy Limit and Sell Limit just outside the stops level, all with SL/TP, so any price move reaches one Stop and one Limit; wait up to 30 min.<br>Mocked: push a "filled" event for a pending order | Real: at least one Stop and one Limit fill; each filled order becomes an open position at ≈ its order price with the same SL/TP; history shows **Filled**; fill notification shown; used margin grows only now. Skips with a reason if nothing fills in time.<br>Mocked: the order moves from Pending to Open Positions without a reload | P1  | Slow + Mocked    |
| TC-PND-22 | Stop Limit turns into a Limit order (if supported)   | Pos  | TC-PND-05                                                                                                         | Place a Buy Stop Limit close to market on XAUUSD; wait for Ask to reach the stop price                                                                                                                                                        | Order becomes a Buy Limit at the limit price (same or linked ID); it fills only when Ask ≤ limit price                                                                                                                                                                                                                                   | P3  | Manual           |
| TC-PND-23 | Place a pending order while the market is closed     | Neg  | PRE-1                                                                                                             | Closed symbol; try to place a Buy Limit                                                                                                                                                                                                       | Blocked with a "market closed" message; no order created                                                                                                                                                                                                                                                                                 | P2  | Regular          |
| TC-PND-24 | Expiry: Good Till Specified Date (date only)         | Pos  | PRE-1..4                                                                                                          | Choose "Specified Date"; pick tomorrow; place                                                                                                                                                                                                 | Saved with the picked date and no time; the expiry shown is the end of that trading day (server time, timezone stated); order pending                                                                                                                                                                                                    | P2  | Regular          |
| TC-PND-25 | Every expiry option with every pending type          | Pos  | PRE-1..4                                                                                                          | Data-driven: place each supported pending type (TC-PND-01 … 06) with each expiry option (GTC, Day, Specified Date, Specified Date and Time); check the row; delete it                                                                         | Every combination is accepted, and Pending Orders shows the right type and expiry; no combination is silently switched to another expiry                                                                                                                                                                                                 | P2  | Regular          |
| TC-PND-26 | SL or TP exactly at the order price                  | Bnd  | PRE-1..4                                                                                                          | Buy Stop at P with SL = P, then with TP = P; repeat for a Sell Stop                                                                                                                                                                           | Each is rejected with a clear message (zero distance is never valid); no order created                                                                                                                                                                                                                                                   | P2  | Regular          |
| TC-PND-27 | Prices gap past a pending order or SL at market open | Pos  | Before the weekly close: a Buy Stop and a Sell Stop near the market, and an open position with SL near the market | After the weekly open, if the first price gaps past them, compare the fill and close prices with the order and SL prices                                                                                                                      | A gapped pending order fills at the first available price, not at its order price; a gapped SL closes at the first available price; history shows the actual prices and the slippage shows in P/L                                                                                                                                        | P3  | Manual           |

### M4 – Open positions: view, modify, partial close, close (R4)

| ID        | Scenario                                      | Type    | Pre                      | Steps                                                                                         | Expected result                                                                                                                                                                                                                           | Pri | Run     |
| --------- | --------------------------------------------- | ------- | ------------------------ | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | ------- |
| TC-POS-01 | View open positions                           | Pos     | 1 Buy + 1 Sell           | Open the Open Positions tab                                                                   | Each row shows ID, symbol, side, volume, open price, current price, SL, TP, swap, commission, P/L, open time; values match the orders; P/L updates with price ticks                                                                       | P1  | Regular |
| TC-POS-02 | Floating P/L calculation (Buy and Sell)       | Pos     | 1 Buy + 1 Sell           | For each: read open price, current Bid/Ask, volume, contract size; compare with the P/L shown | Buy uses Bid, Sell uses Ask; P/L = formula in §2 in account currency, within the P/L tolerance                                                                                                                                            | P2  | Regular |
| TC-POS-03 | Add SL/TP to a position that has none         | Pos     | TC-MKT-02                | Edit the position; set a valid SL and TP; save                                                | Row shows the new SL/TP; position ID, volume and open price unchanged; notification shown                                                                                                                                                 | P1  | Regular |
| TC-POS-04 | Change existing SL/TP (Buy and Sell)          | Pos     | TC-MKT-04, 05            | Edit each position; move SL and TP to other valid levels for its side; save                   | New values shown; nothing else changes                                                                                                                                                                                                    | P1  | Regular |
| TC-POS-05 | Remove SL/TP                                  | Pos     | TC-MKT-04                | Edit; clear SL and TP; save                                                                   | SL/TP shown empty; position stays open                                                                                                                                                                                                    | P2  | Regular |
| TC-POS-06 | Modify with invalid SL/TP                     | Neg     | TC-MKT-02                | Edit; SL on the wrong side, then SL inside the stops level; save                              | Rejected with a message; previous SL/TP kept                                                                                                                                                                                              | P1  | Regular |
| TC-POS-07 | Partial close                                 | Pos     | Buy 0.10                 | Close with volume 0.05; confirm                                                               | Remaining 0.05 stays open with the same open price, SL and TP (record whether the ID is kept); used margin drops by half; closed 0.05 appears in history with its realized P/L; balance changes by the net P/L booked for the closed part | P1  | Regular |
| TC-POS-08 | Partial close volume boundaries               | Bnd/Neg | Buy 0.10                 | Close volume: 0.01 (min), 0.10 (full), 0.005, 0, 0.11 (> position), 0.015 (bad step)          | 0.01 accepted; 0.10 acts as a full close; the rest blocked or rejected with a message; position unchanged after a rejection                                                                                                               | P2  | Regular |
| TC-POS-09 | Close one position fully (Buy and Sell)       | Pos     | 1 Buy + 1 Sell           | Click Close on each row; confirm                                                              | Rows removed; close price ≈ Bid for the Buy and ≈ Ask for the Sell; history shows close price, close time and realized P/L; balance changes by the net P/L booked in the deal                                                             | P1  | Regular |
| TC-POS-10 | Cancel the close confirmation                 | Neg     | 1 open Buy               | Click Close; cancel the dialog                                                                | Position still open and unchanged                                                                                                                                                                                                         | P3  | Regular |
| TC-POS-11 | Close with One-Click Trading ON               | Pos     | OCT ON                   | Click Close on the row                                                                        | Position closes immediately without a confirmation dialog. If the dialog still appears, it is logged as a finding                                                                                                                         | P3  | Regular |
| TC-POS-12 | Position details view                         | Pos     | 1 open Buy               | Open the position details (click the row or the details icon)                                 | Details match the list row and the original order                                                                                                                                                                                         | P3  | Regular |
| TC-POS-13 | Modify or close while the market is closed    | Neg     | PRE-5                    | Market closed; try to edit SL/TP and to close the kept position                               | Actions blocked or rejected with "market closed"; position unchanged                                                                                                                                                                      | P2  | Manual  |
| TC-POS-14 | Sort and filter open positions (if supported) | Pos     | ≥ 3 positions, 2 symbols | Sort by open time and P/L; filter by symbol                                                   | Order and filtered rows are correct; totals (if shown) match the visible rows                                                                                                                                                             | P3  | Regular |

### M5 – Bulk close / bulk delete (R5)

| ID        | Scenario                                       | Type | Pre                                                                                                                             | Steps                                                                                                                  | Expected result                                                                                                                                                                       | Pri | Run             |
| --------- | ---------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | --------------- |
| TC-BLK-01 | Close all positions                            | Pos  | ≥ 3 positions, 2 symbols, Buy+Sell                                                                                              | Choose "Close all"; confirm                                                                                            | Open Positions empty; one history record and one notification per position; balance changes by the sum of net P/L                                                                     | P1  | Regular         |
| TC-BLK-02 | Close only profitable positions (if supported) | Pos  | Mix of profit and loss positions (needs price movement – new positions start negative by the spread); PRE-6 for the mocked part | Real: choose "Close profitable"; confirm.<br>Mocked: check the request the UI sends and how it shows the server result | Real: only positions with net P/L > 0 at execution are closed; losing and zero-P/L positions stay open.<br>Mocked: the UI sends the "profitable" action and shows the returned result | P2  | Slow + Mocked   |
| TC-BLK-03 | Close only losing positions (if supported)     | Pos  | As TC-BLK-02                                                                                                                    | As TC-BLK-02 with "Close losing"                                                                                       | Only positions with net P/L < 0 are closed; profitable and zero-P/L positions stay open                                                                                               | P2  | Slow + Mocked   |
| TC-BLK-04 | Close by side or symbol (if supported)         | Pos  | Buy and Sell on 2 symbols                                                                                                       | Close all Buy; then close all for one symbol                                                                           | Only matching positions are closed                                                                                                                                                    | P3  | Regular         |
| TC-BLK-05 | Delete all pending orders                      | Pos  | ≥ 3 pending orders of different types                                                                                           | Choose "Delete all"; confirm                                                                                           | Pending Orders empty; each order shows **Cancelled** in history; notifications shown                                                                                                  | P1  | Regular         |
| TC-BLK-06 | Bulk confirmation shows the count; Cancel      | Neg  | ≥ 2 positions and ≥ 2 pending orders                                                                                            | Choose "Close all", read the dialog, cancel; repeat with "Delete all"                                                  | Each dialog states how many items are affected; after Cancel nothing changes in either list                                                                                           | P2  | Regular         |
| TC-BLK-07 | Bulk action on an empty list                   | Neg  | No positions / no orders                                                                                                        | Look for or click "Close all" / "Delete all"                                                                           | Action disabled or a "nothing to close" message; no error                                                                                                                             | P3  | Regular         |
| TC-BLK-08 | Bulk actions only touch their own list         | Pos  | 2 positions + 2 pending orders                                                                                                  | "Close all" positions; check pending orders. Then "Delete all" orders; check positions                                 | Closing positions leaves pending orders alone; deleting orders leaves positions alone                                                                                                 | P2  | Regular         |
| TC-BLK-09 | Close / delete selected items (if supported)   | Pos  | 3 positions + 3 pending orders                                                                                                  | Select 2 positions → close selected; select 2 orders → delete selected                                                 | Only the selected items are closed/deleted; the others are unchanged; one history record per affected item                                                                            | P2  | Regular         |
| TC-BLK-10 | Bulk close where one item fails                | Neg  | Real: PRE-5 + a position on an open symbol. Mocked: PRE-6, ≥ 3 positions                                                        | Real: "Close all" with one market closed.<br>Mocked: return an error for one item; "Close all"                         | The other items close; the failed item stays open with a clear per-item error; the result summary is accurate                                                                         | P3  | Mocked + Manual |

### M6 – Transactions, notifications, order history (R6)

| ID        | Scenario                               | Type | Pre                                                   | Steps                                                                                                                                                                   | Expected result                                                                                                                                                             | Pri | Run              |
| --------- | -------------------------------------- | ---- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | ---------------- |
| TC-HIS-01 | Notification when a market order fills | Pos  | PRE-1..4                                              | Place a Buy market order                                                                                                                                                | Toast shows symbol, side, volume and fill price; the same event is listed in the notifications panel                                                                        | P1  | Regular          |
| TC-HIS-02 | Notifications for pending order events | Pos  | PRE-1..4                                              | Place, modify and delete a pending order (expiry notification: see TC-PND-17)                                                                                           | One notification per event (placed, modified, cancelled), each showing order ID, symbol, type, side, volume and price                                                       | P2  | Regular          |
| TC-HIS-03 | Notifications for position events      | Pos  | Open position                                         | Modify SL/TP, partial close, full close                                                                                                                                 | One notification per event, each showing position ID, symbol, side, volume and the changed values (new SL/TP, closed volume, close price)                                   | P2  | Regular          |
| TC-HIS-04 | Error notification gives the reason    | Neg  | PRE-1 (PRE-6 for the mocked part)                     | Regular: insufficient margin (TC-MKT-12), invalid stops (TC-MKT-08), market closed (TC-MKT-17).<br>Mocked: server error (TC-ERR-01)                                     | Each shows an error message naming its specific reason; no success toast                                                                                                    | P2  | Regular + Mocked |
| TC-HIS-05 | Notifications panel behaviour          | Pos  | Several events                                        | Open the notifications panel; mark as read / clear (if supported)                                                                                                       | Newest first; read/unread state and clearing work; entries stay after refresh (if the product keeps them)                                                                   | P3  | Regular          |
| TC-HIS-06 | Order history content                  | Pos  | Filled and cancelled orders                           | Open Order History                                                                                                                                                      | Every order listed once with ID, symbol, type, side, volume, price, SL/TP, time and status Filled / Cancelled (Expired rows are checked in TC-PND-17)                       | P1  | Regular          |
| TC-HIS-07 | Closed position (deal) history content | Pos  | Closed and partly closed positions                    | Open position/deal history                                                                                                                                              | Open/close price and time, volume, realized P/L, commission, swap and close reason "manual" are shown (SL/TP close reasons are checked in TC-DTL-08)                        | P1  | Regular          |
| TC-HIS-08 | Trading transactions match the balance | Pos  | Closed positions                                      | Open Transactions; compare with the balance before and after the trades                                                                                                 | Each closed trade has a balance record equal to its realized P/L (plus commission/swap rows if separate); running balance matches the account balance                       | P1  | Regular          |
| TC-HIS-09 | Filter and sort history                | Pos  | History over several days (PRE-6 for the mocked part) | Regular: filter by Today / Last 7 days / custom range and by symbol; sort by time.<br>Mocked: fix the browser clock and return trades at 23:59 and 00:01; check "Today" | Regular: only matching records shown; sorting correct; counts match.<br>Mocked: the 23:59 and 00:01 trades fall on the right days                                           | P2  | Regular + Mocked |
| TC-HIS-10 | Empty history range                    | Neg  | –                                                     | Pick a range with no trades                                                                                                                                             | Empty-state message; no error                                                                                                                                               | P3  | Regular          |
| TC-HIS-11 | History survives refresh and re-login  | Pos  | Some history                                          | Refresh; log in again in a new browser context                                                                                                                          | Same records and values as before                                                                                                                                           | P2  | Regular          |
| TC-HIS-12 | Timestamps are consistent              | Pos  | One closed trade                                      | Compare the times of the same trade in notification, order history, deal history and transactions                                                                       | Same time and timezone everywhere (server or local time, clearly labelled)                                                                                                  | P3  | Regular          |
| TC-HIS-13 | Large history                          | Pos  | PRE-6                                                 | Return 200+ history rows; scroll or page through all of them                                                                                                            | Every returned row is reachable (pagination or scroll); the row count shown equals the rows returned; the page stays responsive (each page or scroll step renders in < 1 s) | P3  | Mocked           |

### M7 – Order details and status across records (R7)

| ID        | Scenario                                         | Type | Pre                                                                | Steps                                                                                                                                                                 | Expected result                                                                                                                                                                                       | Pri | Run     |
| --------- | ------------------------------------------------ | ---- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | ------- |
| TC-DTL-01 | Market order lifecycle across all records        | E2E  | PRE-1..4                                                           | 1. Buy EURUSD 0.10 with SL/TP<br>2. Check toast, Open Positions, details, notifications<br>3. Close it<br>4. Check order history, deal history, transactions, balance | The same order/position ID, symbol, side, volume, prices and SL/TP appear in every record; status moves Open → Closed; realized P/L is identical in deal history, transactions and the balance change | P1  | Regular |
| TC-DTL-02 | Pending order lifecycle across all records       | E2E  | PRE-1..4                                                           | Place Buy Limit → modify → delete; check Pending Orders, notifications and order history after each step                                                              | Status Pending → Pending with the new values (and a "modified" notification) → Cancelled, always with the same order ID                                                                               | P1  | Regular |
| TC-DTL-03 | Partial close across records                     | E2E  | Buy 0.10                                                           | Partial close 0.04, then close the remaining 0.06                                                                                                                     | History holds two close deals (0.04 and 0.06) linked to the original position; volumes add up to 0.10; total net P/L equals the balance change                                                        | P1  | Regular |
| TC-DTL-04 | Account summary stays consistent                 | E2E  | PRE-1, 2; no open positions or pending orders on the whole account | Read Balance, Equity, Margin, Free margin, Margin level; open 2 positions; read again; close them; read again                                                         | Formulas in §2 hold at every step (within tolerance); margin level is empty/"–" while used margin is 0; after closing, used margin returns to 0 and balance = start + net P/L                         | P1  | Regular |
| TC-DTL-05 | Triggered pending order links to its position    | E2E  | TC-PND-21                                                          | After a pending order fills, compare order history and Open Positions                                                                                                 | Order history shows Filled with the fill price; the new position has the same symbol, side, volume and SL/TP, and references the order                                                                | P2  | Slow    |
| TC-DTL-06 | Data consistency after refresh and in 2 tabs     | E2E  | PRE-1, 2                                                           | Open the trader in 2 tabs; place and close an order in tab A; check tab B; then refresh both                                                                          | Tab B shows the new position, then its closure, within 5 s without a reload; after refresh both tabs show identical records                                                                           | P2  | Regular |
| TC-DTL-07 | Position modifications are consistent everywhere | E2E  | PRE-1..4                                                           | Open a Buy with SL/TP; modify SL/TP twice; close it; check notifications, position details and deal history                                                           | Each modification has its own notification with the new values; the closed deal shows the last SL/TP; ID, open price and volume are the same in every record                                          | P2  | Regular |
| TC-DTL-08 | SL/TP close reason is consistent across records  | E2E  | TC-MKT-15 / 16 (real part)                                         | Compare the closed position in the notification, deal history and transactions                                                                                        | Close reason (SL or TP), close price and realized P/L are identical in every record                                                                                                                   | P2  | Slow    |
| TC-DTL-09 | History record details view                      | Pos  | One closed position and one cancelled order                        | Open the details of each record from history                                                                                                                          | Details show ID, type, side, volume, prices, SL/TP, open/close (or cancel) time, commission, swap, P/L and status, matching the history row and the original order                                    | P2  | Regular |

### M8 – Error handling and resilience (supports R1–R7)

| ID        | Scenario                               | Type | Pre                       | Steps                                                                                                                                                     | Expected result                                                                                                                                      | Pri | Run     |
| --------- | -------------------------------------- | ---- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | --- | ------- |
| TC-ERR-01 | Server error when placing an order     | Neg  | PRE-1, 2, 4, 6            | Answer the place-order request with HTTP 500 (or an error event), not forwarded; place a Buy; remove the mock and retry                                   | Clear error message; no position shown; the form keeps the entered values; after the retry exactly one new position exists                           | P2  | Mocked  |
| TC-ERR-02 | Connection lost and restored           | Neg  | PRE-1, 2, 1 open position | Go offline for 10 s (`context.setOffline`), then back online. If the open WebSocket survives `setOffline`, close it through `page.routeWebSocket` instead | A disconnected state is shown; trade buttons are disabled or show an error; after reconnect quotes resume and positions/orders match a fresh reload  | P2  | Regular |
| TC-ERR-03 | Busy state blocks a second confirm     | Bnd  | PRE-1, 2, 4, 6, OCT OFF   | Forward the order request to the real server but hold its response for 3 s; click Confirm twice quickly                                                   | After a refresh, exactly one new position exists; Confirm is disabled or shows a spinner until the response                                          | P3  | Mocked  |
| TC-ERR-04 | Session expired during trading         | Neg  | PRE-1, 2, 4, 6            | Answer the next order request with 401 / session expired, not forwarded; place a Buy; log in again                                                        | The user is asked to log in again; no order reaches the server; after logging in, positions and orders are unchanged                                 | P2  | Mocked  |
| TC-ERR-05 | Response lost after the order executed | Neg  | PRE-1, 2, 4, 6            | Forward the order request to the real server, then drop its response (network error); refresh                                                             | The UI shows an error or "unknown result" message and does not resend the order by itself; after the refresh the executed order appears exactly once | P2  | Mocked  |
| TC-ERR-06 | Submit while offline is not sent later | Neg  | PRE-1, 2, 4               | Go offline (`context.setOffline`); fill a Buy and click Buy/Confirm; go back online; wait 10 s; refresh                                                   | An error or offline message appears at once; nothing is queued: after reconnecting and refreshing, no new position exists                            | P2  | Regular |

---

## 6. Core flows

All 40 P1 cases marked `Regular` are grouped into flows, so each test sets up its data once.

| #   | Flow                                                                                                                              | Cases                                                                              |
| --- | --------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| F1  | Buy → add/modify SL/TP → partial close → full close → check every record                                                          | TC-MKT-02, 04, TC-POS-01, 03, 04, 06, 07, 09, TC-HIS-01, 06, 07, 08, TC-DTL-01, 03 |
| F2  | F1 for a Sell                                                                                                                     | TC-MKT-03, 05, TC-POS-04, 09                                                       |
| F3  | Invalid SL/TP, volume and margin (data-driven; only the 0.01 order of TC-MKT-11 and the margin set-up of TC-MKT-12 need clean-up) | TC-MKT-08, 09, 11, 12                                                              |
| F4  | One-Click Trading: enable → Buy → Sell → disable                                                                                  | TC-OCT-01, 02, 03, 05                                                              |
| F5  | Place all pending order types                                                                                                     | TC-PND-01 … 06                                                                     |
| F6  | Pending order: place → modify → delete                                                                                            | TC-PND-18, 20, TC-DTL-02                                                           |
| F7  | Pending order expiry at a specified date/time (TC-PND-17 waits ~3 min, nightly)                                                   | TC-PND-14 (+ TC-PND-17)                                                            |
| F8  | Pending price and SL/TP rules (valid against the order price; wrong side rejected)                                                | TC-PND-08, 09                                                                      |
| F9  | Bulk: close all positions, delete all orders                                                                                      | TC-BLK-01, 05                                                                      |
| F10 | Account summary before, during and after trades                                                                                   | TC-DTL-04                                                                          |
| F11 | Market closed (runs only while the market is closed)                                                                              | TC-MKT-17                                                                          |

---

## 7. Summary

| Module                     | Total   | P1     | P2     | P3     | Regular | Slow  | Mocked | Manual |
| -------------------------- | ------- | ------ | ------ | ------ | ------- | ----- | ------ | ------ |
| M1 Market orders + SL/TP   | 17      | 11     | 5      | 1      | 15      | 2     | 2      | 0      |
| M2 One-Click Trading       | 12      | 4      | 5      | 3      | 10      | 0     | 2      | 1      |
| M3 Pending orders          | 27      | 13     | 11     | 3      | 21      | 2     | 2      | 4      |
| M4 Positions               | 14      | 6      | 4      | 4      | 13      | 0     | 0      | 1      |
| M5 Bulk operations         | 10      | 2      | 5      | 3      | 7       | 2     | 3      | 1      |
| M6 History & notifications | 13      | 4      | 5      | 4      | 12      | 0     | 3      | 0      |
| M7 Records & details (E2E) | 9       | 4      | 5      | 0      | 7       | 2     | 0      | 0      |
| M8 Errors & resilience     | 6       | 0      | 5      | 1      | 2       | 0     | 4      | 0      |
| **Total**                  | **108** | **44** | **45** | **19** | **87**  | **8** | **16** | **7**  |

A case with two run types (for example `Slow + Mocked`) is counted under each of them.

## 8. Traceability

| Requirement                                    | Test cases                                                                                |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------- |
| R1. Market orders with SL/TP                   | TC-MKT-01 … 17, TC-POS-03 … 06                                                            |
| R2. Market orders with One-Click Trading       | TC-OCT-01 … 12, TC-POS-11                                                                 |
| R3. Pending orders, types and expiry           | TC-PND-01 … 27                                                                            |
| R4. View, modify, partially close, close       | TC-POS-01 … 14                                                                            |
| R5. Bulk close / delete                        | TC-BLK-01 … 10                                                                            |
| R6. Transactions, notifications, order history | TC-HIS-01 … 13                                                                            |
| R7. Order details and status across records    | TC-DTL-01 … 09 (plus the record checks inside TC-MKT-12, TC-PND-20, TC-POS-07, TC-POS-09) |
| Error handling (supports all)                  | TC-ERR-01 … 06, TC-OCT-08, 12                                                             |

---

## 9. Automation strategy

### 9.1 Login prerequisites (must be fixed first)

> **Status (2026-11-08):** items 1–3 and 7 are done: logged-in tests skip without credentials,
> setup waits for the trade screen and saves the API bearer, `LoginPage` uses the app's test
> ids, and trading needs a demo account and `ALLOW_TRADING=true`. Item 4 did not apply (the
> session lives in localStorage). Instead of re-logging in (item 5), setup reuses the saved
> session while the server accepts it. Item 6: retries are off; clean-up removes the test's own
> orders one by one.

1. When `.env` is empty, the `setup` project skips but the `trading` tests **fail** with
   `ENOENT .auth/user.json` instead of skipping as the README says. Trading tests must skip with
   the same reason.
2. `tests/auth.setup.ts` only waits for the password field to disappear. It must wait until the
   trading terminal has loaded before saving the session.
3. `LoginPage` locators are generic guesses; confirm them on the real UI.
4. `storageState` keeps cookies and localStorage, not sessionStorage. If the app keeps its token
   in sessionStorage, save and restore it separately.
5. A full serial run may take 30–60 min (estimate); add a re-login when the session expires.
6. Raise timeouts for `Slow` cases. CI retries can duplicate orders, so clean-up before each test
   removes everything left on the test symbols, including leftovers of a crashed attempt whose
   IDs are unknown.
7. **Safety guard.** Before any trading action, the run checks that the account is a demo
   account (the DEMO badge or account type shown in the terminal) and that trading was enabled
   for the run on purpose (e.g. `ALLOW_TRADING=true` in `.env`). Otherwise the trading tests skip
   with a reason, so orders can never be placed on a live account by mistake.

### 9.2 Test data (seeding)

- **Through the UI** first (works as soon as the page objects exist; about 5–10 s per order).
- **Through the web trader's API** once the protocol is known (REST or WebSocket, where the token
  lives). `page.request` shares the browser's cookies, so the saved session can be reused.
- **Database / back office:** no access on the broker's demo.
- Easy to create: open positions, pending orders far from the market, closed/cancelled history,
  notifications. Hard or impossible: price direction, fills, SL/TP hits, day rollover, market
  closure – these are the `Slow`, `Mocked` and `Manual` cases.
- **Clean-up** closes and deletes items one by one (or through the API), never with bulk close,
  so a bulk-close bug cannot break every test.
- **Separate demo account for CI**, so CI and local runs do not change each other's data.

### 9.3 Handling prices without mocks

- Compute SL/TP and pending prices from the live Bid/Ask, well beyond the stops level.
- Check fill prices as a range (quote before and after the click, plus tolerance).
- Compare records with each other instead of predicting numbers.
- Price-dependent cases wait with a time limit and skip with a reason if the price does not move;
  use a volatile symbol; run them nightly, not on every merge. Place orders on both sides of the
  market where possible, so any move triggers something (TC-PND-21).
- Control with time instead of price where possible (expiry at a specified time).
- **"Market closed" is read from the platform's own signal** (symbol status or trading hours,
  Buy/Sell disabled with a market-closed label), never inferred from missing prices. If no quote
  arrives while the platform says the market is open, the test fails instead of skipping, so an
  outage is not hidden as a skip.

### 9.4 Mock policy

- **Mock only what the server reports to the UI, never what the server decides.** Fills, margin,
  P/L, bulk filters and expiry are decided by the server; a mock only shows the UI reacts
  correctly.
- Mock a case only when all three hold: the behaviour under test is in the frontend, the state
  cannot be created on the real demo, and the protocol is readable (not binary).
- When a mocked case checks "exactly one order", the request is **forwarded** to the real server
  and only its response is delayed or dropped, so the order count comes from the server, not
  from the mock (TC-OCT-08, TC-ERR-03, TC-ERR-05).
- Never mock the price stream while placing real orders: the server would fill at the real price
  and the checks would be meaningless.
- Keep the real login (saved session). Register interception **before** opening the page:
  `page.routeWebSocket` only catches sockets opened after it is set. Block service workers
  (`serviceWorkers: 'block'`) so `page.route` can intercept.
- Tools: `page.route` (REST), `page.routeWebSocket` (WebSocket events), `page.clock` (browser
  time), `context.setOffline` (network loss). HAR replay does not cover WebSocket.
- Re-record real responses regularly and keep one small real-environment check of the response
  format, so mocks do not drift from the real API unnoticed.

### 9.5 Building blocks

- Page objects: order panel, Open Positions, Pending Orders, history (orders, deals,
  transactions, details), notifications, account summary, bulk actions, One-Click toggle.
- Helpers: live quote (Bid/Ask), symbol spec (digits, stops level, min/max/step volume),
  market-status check.
- Fixtures: clean-up of the test symbols; OCT reset.
- Playwright projects: `trading` (real, `Regular`), `mocked` for `tests/mocked/` (depends on
  `setup`, `serviceWorkers: 'block'`), and a nightly run selecting `@slow`.
- Tags: `@p1`, `@p2`, `@p3`, `@slow`, `@mocked`, `@market-open`, `@market-closed`.

### 9.6 Roadmap

1. Fix the login prerequisites (9.1, items 1–2); write the page objects and helpers.
2. **Wave 1:** the 40 P1 `Regular` cases, as the core flows in §6.
3. **Wave 2:** remaining P1 (`Slow`, `Mocked` parts) and P2 `Regular` cases.
4. **Wave 3:** P2/P3 `Mocked` cases, P3 `Regular` cases and the manual checklist.

---

## 10. Assumptions and environment limitations

- **Market hours.** FX, metals and indices are closed at the weekend. While markets are closed,
  any test that needs an execution skips with the reason _"market closed"_ (detected as in §9.3),
  and the market-closed cases (TC-MKT-17, TC-OCT-11, TC-PND-23, the market-closed part of
  TC-HIS-04) run instead. TC-POS-13 and the real part of TC-BLK-10 need a position opened before
  the close (PRE-5) and are run manually. If the demo quotes a crypto CFD 24/7, it is used as the
  weekend symbol.
- **Daily breaks and holidays.** Metals and some indices have a short daily break, and markets
  close on public holidays. The nightly `@slow` run is scheduled outside those windows; the
  market-status check skips anything that still falls into one.
- **Hedging account.** The account is assumed to be hedging (a Buy and a Sell on the same symbol
  can be open at once). If it is netting, cases that need both sides (TC-POS-01, 02, 09,
  TC-BLK-01, 04) use two different symbols.
- **Shared demo account.** Tests run serially (`workers: 1`) and clean up before they start.
- **Moving prices.** Handled as in §9.3; boundary checks keep a few points of margin from the
  limit so price movement does not make them flaky.
- **Time-dependent cases.** SL/TP hits, pending triggers and expiry depend on price movement or
  time; they run in the nightly `@slow` run or manually.
- **Demo vs live.** Virtual funds only; commission, swap and execution on demo may differ from
  live accounts.
- **Account expiry.** The demo account expires on 2026-12-06; after that, login failures mean a
  new demo account is needed.

## 11. Open questions

> **Answered on the live demo (2026-11-08)** – details in [platform-notes.md](platform-notes.md):
> 1 – Market, Limit, Stop and Stop Limit; Good Till Canceled, Good Till Day, Specified Date and
> Time, Specified Date. 2 – both price and points. 3 – `stopsLevel` in the symbol detail; the
> browser does not enforce it. 4 – the terms dialog appears on every activation and the setting is
> stored per account on the server. 6 – All / Profitable / Loss positions, All / Limit / Stop
> orders, at most 30 per action, chosen by the P/L the browser shows. 7 – Positions History holds
> balance operations; Orders & Deals holds orders and deals with their state. 8 – the place button
> is disabled for every order type while closed. 11 – REST with a bearer token, prices over SockJS
>
> - STOMP. 12 – the browser checks the SL/TP side but not the stops level, and calculates the
>   floating P/L. 13 – service workers are blocked in the mocked project. 15 – `status` /
>   `marketStatus` in the symbol list and a "Market Closed" button. 16 – EURUSD min 0.01, step 0.01,
>   max 100. 17 – recorded in platform-notes.md. Still open: 5 (partial-close Order No.), 9, 10, 14
>   (they need executions).

1. Which pending types are offered (Limit, Stop and Stop Limit, or only Stop – public sources
   disagree) and the exact names of the expiry options (expected: Good Till Cancelled, Good Till
   Day, Good Till Specified Date, Good Till Specified Date and Time).
2. Whether SL/TP can be entered in points/pips as well as price.
3. Stops level (minimum SL/TP/pending distance) per symbol, and where it is shown.
4. Whether One-Click Trading also skips the confirmation when closing, whether the setting is saved
   per user or per browser, and whether its disclaimer appears once per account.
5. Whether a partial close keeps the original position ID or creates a new one.
6. Which bulk actions exist (close all / profitable / losing / by symbol / selected, delete all)
   and whether "profitable" uses net or gross P/L.
7. Where "trading transactions" live (separate tab, account statement, or inside history).
8. Whether placing, modifying or deleting pending orders is allowed while the market is closed.
9. Whether pending orders reserve margin before they fill.
10. Whether rejected orders are recorded in order history.
11. How the web trader talks to the server (REST or WebSocket, JSON or binary) and where the
    session token is stored (cookie, localStorage, sessionStorage, memory).
12. Whether the frontend itself validates the stops level and calculates P/L (decides whether
    TC-MKT-10, TC-PND-10 and TC-POS-02 can also have mocked variants).
13. Whether the app uses a service worker.
14. Whether the account is hedging or netting.
15. How the platform shows that a symbol's market is closed (status label, trading hours,
    disabled buttons).
16. Minimum volume and volume step per symbol (0.01 or 0.1 lots), including the One-Click volume.
17. The exact wording of each error message (recorded once, then asserted – §3).

---

## 12. Merge notes

**Base:** set 002 – trading rules, preconditions, table format and the fixes from its peer review.

**Taken from set 001.** The full 104-case list of set 001 was not available here, so its cases
were merged by topic from its automation-feasibility assessment:

- All six pending types as separate cases → TC-PND-01 … 06.
- Double-click with a slow response must create one order (001 OCT-07) → TC-OCT-08; server error
  with OCT ON → TC-OCT-12.
- Bulk close with one failing item, using a mock (001 BLK-08) → TC-BLK-10.
- History with 200+ rows (001 HIS-14) → TC-HIS-13.
- Fixed browser clock for the expiry picker and date filters → TC-PND-16, TC-HIS-09.
- Quote display → TC-MKT-01 (TC-MKT-14, symbol digits, already existed in set 002).
- Server errors, network loss and session expiry → TC-ERR-01 … 04.
- Two layers for price-dependent cases (real nightly test + mocked UI test) → TC-MKT-15, 16,
  TC-PND-21, TC-BLK-02, 03.
- Priority P1, as in set 001, for: insufficient margin (TC-MKT-12), automatic expiry
  (TC-PND-17), transactions vs balance (TC-HIS-08), Stop Limit placement (TC-PND-05, 06).
- Login issues, seeding, price handling and mock policy → §9.
- Core flows → §6.

**Added during the final review:** response lost after execution (TC-ERR-05), history record
details (TC-DTL-09), tolerances (§3), market-status detection (§9.3), hedging/netting and daily
breaks (§10).

**Added in the last review round:** demo/opt-in safety guard (§9.1, item 7), date-only expiry
and the expiry × order-type matrix (TC-PND-24, 25), zero-distance SL/TP (TC-PND-26, TC-MKT-10
step 4), price gaps at market open (TC-PND-27), offline submit (TC-ERR-06), volume scaling for a
0.1 min lot (§2) and recorded error wording (§3).

**Conflicts resolved:**

- Rapid clicks with One-Click Trading: set 001 expected a double-click to create one order,
  set 002 expected one order per quick click. Final: a double-click (in flight) creates one order,
  checked on the real server and with a held response (TC-OCT-08); separate clicks after each
  fill create one order each (TC-OCT-09).
- Insufficient margin: set 001 suggested a mock because a large demo balance may cover the max
  lot. Final: the margin is used up with real positions instead (TC-MKT-12), since the server
  decides margin and §9.4 forbids mocking that.
- Run labels: set 002's `Yes / Partial / Manual` replaced by `Regular / Slow / Mocked / Manual`
  so mocked tests are visible as their own layer.
- IDs: new `TC-<module>-NN` scheme. Old IDs are listed in §13.

## 13. ID mapping

Final ID ← set 002 ID. "new" = added from set 001 or during the merge.

- **M1:** MKT-01 new · MKT-02 ← MO-01 · 03 ← MO-02 · 04 ← MO-03 · 05 ← MO-04 · 06 ← MO-05 ·
  07 ← MO-06 · 08 ← MO-07 · 09 ← MO-08 · 10 ← MO-09 · 11 ← MO-10 · 12 ← MO-11 · 13 ← MO-12 ·
  14 ← MO-13 · 15 ← MO-14 · 16 ← MO-15 · 17 ← MO-16
- **M2:** OCT-01 … 07 ← OCT-01 … 07 · OCT-08 new (takes over the quick-click part of 002
  OCT-08) · OCT-09 ← OCT-08 (clicks now wait for each fill) · OCT-10 ← OCT-09 ·
  OCT-11 ← OCT-10 · OCT-12 new
- **M3:** PND-01 … 04 ← PO-01 … 04 · PND-05, 06, 07 ← PO-05 (split) · PND-08 ← PO-06 ·
  09 ← PO-07 · 10 ← PO-08 · 11 ← PO-09 · 12 ← PO-10 · 13 ← PO-11 · 14 ← PO-12 · 15 ← PO-13 ·
  PND-16 new · 17 ← PO-14 · 18 ← PO-15 · 19 ← PO-16 · 20 ← PO-17 · 21 ← PO-18 (now four orders
  on both sides) · 22 ← PO-20 · 23 ← PO-19 · PND-24 … 27 new
- **M4:** POS-01 … 13 ← POS-01 … 13 · POS-14 new
- **M5:** BLK-01 … 08 ← BULK-01 … 08 · BLK-09 ← BULK-10 · BLK-10 ← BULK-09 (plus a mocked part)
- **M6:** HIS-01 … 12 ← HIST-01 … 12 · HIS-13 new
- **M7:** DTL-01 … 07 ← REC-01 … 07 · DTL-08, 09 new
- **M8:** ERR-01 … 06 new
