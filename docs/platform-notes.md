# AQX Trader demo – platform notes

What was learned about the web trader while building the suite (2026-11-06 to 2026-11-08). It
answers most of the open questions in [testcase-final.md §11](testcase-final.md#11-open-questions)
and records behaviour worth a second look.

How each fact was obtained:

- **Live:** seen on the real demo account (markets were closed on the last day).
- **Mocked:** seen in the real web app with the server's _read_ responses replaced
  (`tests/mocked`); order writes were answered in the browser or aborted, never sent.
- **Inferred:** from the app's own JavaScript or field names; not yet seen working.

## Account and session

| Fact                                                                                                                                            | How  |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| Demo account, MT5, balance 1,000,000 USD, leverage 1:100, stop-out 70 %, margin call 90 %                                                       | Live |
| The initial deposit is a `BALANCE` row in Positions History (`orderType` 6, `deposit` 1,000,000)                                                | Live |
| The API uses a bearer token; it differs from the `token` value in localStorage, so the suite saves the header the app sends                     | Live |
| The last selected symbol and some display settings are saved on the server for the account, so a page opens on whatever was picked last         | Live |
| Server time is UTC+2 (`/api/config/v1/company/user` → `serverTimezone`); history dates are in server time, the date-range picker in device time | Live |

## Market status

| Fact                                                                                                                                            | How    |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| `GET /api/market/v1/symbols/all` gives `status` and `marketStatus` per symbol (`TRADING`, `CLOSED`, `OFFQUOTES`)                                | Live   |
| On Sunday 2026-11-08 all 36 symbols were closed; XTIUSD has weekend sessions but was `OFFQUOTES`                                                | Live   |
| While closed, the place button reads "Market Closed" and is disabled for every order type                                                       | Live   |
| The order panel is tradable when the symbol is `TRADING` with `tradableExeMode` true in the symbol REST replies; the price socket is not needed | Mocked |
| Prices stream over SockJS + STOMP 1.2 (`/websocket/…`), topics per account and per symbol; no frames arrive while closed                        | Live   |

## Orders

| Fact                                                                                                                                                                                                                                 | How    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| Market order: `POST /api/trade/trade/v1/market` `{orderType 0 BUY / 1 SELL, symbol, lotSize, fillPolicy 0, indicate "PRICE", stopLoss?, takeProfit?}`                                                                                | Mocked |
| Pending order: `POST /api/trade/trade/v1/limit` `{orderType, symbol, lotSize, price, priceTrigger, fillPolicy, indicate, stopLoss?, takeProfit?, expiration?, tradeExpiry}`                                                          | Mocked |
| Modify: `PATCH /api/trade/trade/v1/market` and `/limit`; close: `PUT /api/trade/trade/v1`; delete pending: `DELETE /api/trade/trade/v1?symbol=&orderId=`; bulk: `PUT /api/trade/trade/v1/bulk`, `PUT /api/trade/trade/v1/limit/bulk` | Mocked |
| Order types (enum, as sent in requests and rendered in tables): 0 BUY, 1 SELL, 2 BUY LIMIT, 3 SELL LIMIT, 4 BUY STOP, 5 SELL STOP, 6 BALANCE, 7 CREDIT, 8/9 STOP LIMIT                                                               | Mocked |
| Order Type offers Market, Limit, Stop and Stop Limit on EURUSD, the same list as `orderTypes` in the symbol detail                                                                                                                   | Live   |
| Expiry options: Good Till Canceled (default), Good Till Day, Specified Date and Time, Specified Date (the symbol detail's `expirationTypes`)                                                                                         | Live   |
| "Specified Date and Time" sends the picked moment in epoch ms; "Specified Date" sends 00:00 of that day in server time (GMT+2); the calendar starts at today in server time and disables past days                                   | Mocked |
| Trading hours on the Specification tab ("GMT +0200", Mon–Fri 00:00 – 24:00 for EURUSD) match `tradingSessions` in the symbol detail                                                                                                  | Live   |
| Fill policy: Fill or Kill for market orders, Return for pending orders                                                                                                                                                               | Live   |
| SL/TP can be entered as a price or in points                                                                                                                                                                                         | Live   |
| EURUSD: 4 digits, point 0.0001, contract 100,000, min 0.01, step 0.01, max 100 lots                                                                                                                                                  | Live   |
| Trade Details: margin = lots × contract size × price ÷ leverage; amount per tick = units × point                                                                                                                                     | Live   |
| The confirmation dialog is "Order Confirmation" (`trade-confirmation-*`); it is skipped while One-Click Trading is on                                                                                                                | Mocked |

## One-Click Trading

| Fact                                                                                                                                       | How  |
| ------------------------------------------------------------------------------------------------------------------------------------------ | ---- |
| Stored on the server per account: `OCT_ENABLE` preference, `[]` before first use, then `value "true"/"false"`                              | Live |
| The terms dialog appears on every activation; CANCEL sends nothing; AGREE shows "One-Click Trading activated." and opens a "One Click" tab | Live |
| Switching off shows no dialog and no toast                                                                                                 | Live |
| The One Click panel has volume, BUY (Ask) and SELL (Bid) only; SL/TP need the Trade form                                                   | Live |

## Positions, pending orders and bulk actions

| Fact                                                                                                                       | How    |
| -------------------------------------------------------------------------------------------------------------------------- | ------ |
| The tables render at most 30 rows; the tab label still counts all items                                                    | Mocked |
| Floating P/L is recalculated in the browser from the live Bid (Buy) / Ask (Sell)                                           | Mocked |
| A missing SL/TP is sent as 0 and shown as `--`                                                                             | Mocked |
| Pending rows reuse the Open Positions edit/close button ids; the Edit dialogs reuse the order panel's input ids            | Mocked |
| Bulk Close: All / Profitable / Loss Positions; Bulk Delete: All / Limit / Stop Orders; "Up to 30 … can be closed/deleted." | Mocked |
| With nothing listed, the bulk buttons do nothing (no menu, no message)                                                     | Live   |
| The browser decides which items a bulk action covers (by the P/L it shows) and sends them in one request                   | Mocked |

## Records and notifications

| Fact                                                                                                                                                        | How           |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| Positions History: one row per close (`lotSize / totalLotSize`), Order No. = `positionId`                                                                   | Mocked        |
| Orders & Deals: one row per order with state FILLED / CANCELED / REJECTED / EXPIRED; deals expand under it as In / Out                                      | Mocked        |
| Notification tabs are Positions, System and Information (kept 30 / 30 / 10 days); order items are "Position Created" / "Position Closed" with the Order No. | Live / Mocked |
| Clicking an order notification opens "Order Details" (`/api/trade/order/v1/details?orderId=`)                                                               | Mocked        |
| Not seen yet: whether the history tables list more than 30 rows. TC-HIS-13 (mocked) records it; the history checks accept both until then                   | Open          |
| Date-range presets: All, Last 7 / 30 / 90 days, This year, Last year, Custom                                                                                | Live          |

## Messages

| Situation                                                       | Text                                                                                                 |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Buy, SL above the Bid / TP below the Bid                        | "Stop Loss must be less than Sell Price." / "Take Profit must be greater than Sell Price."           |
| Sell, SL below the Ask / TP above the Ask                       | "Stop Loss must be greater than Buy Price." / "Take Profit must be less than Buy Price."             |
| Buy pending order, SL / TP on the wrong side of the order price | "Stop Loss must be less than price." / "Take Profit must be greater than price." (mirrored for Sell) |
| Pending order without a price                                   | "Please enter a valid price."                                                                        |
| Volume 0 or empty                                               | "Please enter a valid volume."                                                                       |
| Volume below the minimum                                        | "Minimum volume is 0.01."                                                                            |
| Rejection `10016` / `10015`                                     | "Invalid Stop loss or Take profit" / "Invalid Price submitted."                                      |
| Order accepted                                                  | "Position has been created." / "Order has been created."                                             |
| Close volume above the position                                 | "Maximum volume is 0.05." (the position's volume)                                                    |
| Server error (HTTP 500)                                         | "Something went wrong. Please contact customer support."                                             |
| Network failure                                                 | "Network error. Please try again later."                                                             |
| Rejection `MT4_1004`                                            | "Insufficient balance"                                                                               |
| Failed bulk request                                             | "Order action failed"                                                                                |

## Findings worth a second look

1. **Double click sends two One-Click orders** (TC-OCT-08, mocked). While the first order is
   unanswered the BUY button stays enabled with no busy state; a second click sends a second
   order. On a slow network this could open duplicate positions. Kept as an expected failure.
2. **No time-out for an unanswered order.** An order request that never gets an answer shows
   nothing for at least 70 s.
3. **HTTP 200 with an error code counts as success.** The client judges order replies by HTTP
   status only, so a 200 reply carrying an error `code` shows "Position has been created.".
4. **Close volume below the minimum or off the step is not validated in the browser** (0.005 and
   0.015 enable CONFIRM); only the server can refuse it.
5. **Stops level is not validated in the browser.** An SL 8–10 points from the price gets no
   message although the points field says "Min: 50"; neither is the side of a pending price (a Buy
   Limit above the Ask) or the stop/limit relation of a Stop Limit. The server has to refuse them.
   A pending price of 0 is accepted as 0.0000 without a message.
6. **Bulk buttons give no feedback when the list is empty.**
7. **Margin Level shows 0.00 % with no margin used** (a level of "--" would be expected).
8. **Number formats differ between columns:** commission uses price digits ("-0.4200"), swap two
   decimals, and a swap of 0 shows "--".
9. **Volume is changed without telling the user.** Off-step values are cut to the step (0.015 →
   0.01) and values above the maximum are capped (101 → 100).
10. **Trade Volume is not refreshed when the side changes:** it keeps the price of the side that
    was selected when the volume was typed. Est. Margin always uses the Ask, also for a Sell.
11. **The order form resets** to an empty Market order whenever One-Click Trading is switched in any
    session of the account, and when the symbol's specification loads. Anything typed is lost; the
    suite re-reads and refills its inputs.
