import type { AqxApi, SymbolDetail } from '../../src/api/AqxApi';
import { hasCredentials, MISSING_CREDENTIALS_REASON } from '../../src/config/env';
import { expect, test } from '../../src/fixtures/test';
import { formatPrice, roundTo } from '../../src/helpers/numbers';
import {
  closePrice,
  executionPrice,
  levelsAround,
  marketLevels,
  openPrice,
  opposite,
  pendingPrices,
  profit,
  towardsProfit,
  wrongSideMarketLevels,
} from '../../src/helpers/orderLevels';
import type { OrderType, PendingOrderType, Quote, Side } from '../../src/models/trading';
import { calendarDayLabel, serverClock } from '../../src/pages/components/OrderPanel';

/*
 * Order entry without execution: what the order panel offers for each order type, its own
 * validation of SL/TP, price and volume, and its pre-trade numbers, compared with the symbol spec
 * and the account read from the API. Every check works whether the market is open or closed:
 * prices come from the live quote, read before and after wherever it could move in between.
 */

/** Fields of `/symbol/detail` used here that `AqxApi` does not type yet. */
interface SymbolRules extends SymbolDetail {
  orderTypes: string[];
  expirationTypes: string[];
  tradeFillPolicy: Record<FillPolicyKey, number[]>;
  /** Account-currency value of one unit of the quote currency. */
  quoteCurrencyExchangeRate: number;
  /** Initial margin in percent of notional / leverage. */
  marginPercentage: number;
}

type FillPolicyKey =
  'marketFillPolicy' | 'limitFillPolicy' | 'stopFillPolicy' | 'stopLimitFillPolicy';

const ORDER_TYPE_LABEL: Record<string, OrderType> = {
  MARKET: 'Market',
  LIMIT: 'Limit',
  STOP: 'Stop',
  STOP_LIMIT: 'Stop Limit',
};
const EXPIRY_LABEL: Record<string, string> = {
  GTC: 'Good Till Canceled',
  GTD: 'Good Till Day',
  SPECIFIED_TIMESTAMP: 'Specified Date and Time',
  SPECIFIED_DAY: 'Specified Date',
};
/** Fill policy codes as the web trader numbers them: FOK = 0, IOC = 1, RETURN = 2. */
const FILL_POLICY_LABEL = ['Fill or Kill', 'Immediate or Cancel', 'Return'];
const FILL_POLICY_OF: Record<OrderType, FillPolicyKey> = {
  Market: 'marketFillPolicy',
  Limit: 'limitFillPolicy',
  Stop: 'stopFillPolicy',
  'Stop Limit': 'stopLimitFillPolicy',
};
const ORDER_TYPES: OrderType[] = ['Market', 'Limit', 'Stop', 'Stop Limit'];
const PENDING_TYPES: PendingOrderType[] = ['Limit', 'Stop', 'Stop Limit'];

/** Exact inline messages, recorded on the live demo on 2026-11-08. */
const MARKET_SIDE_MESSAGES: Record<Side, string[]> = {
  BUY: ['Stop Loss must be less than Sell Price.', 'Take Profit must be greater than Sell Price.'],
  SELL: ['Stop Loss must be greater than Buy Price.', 'Take Profit must be less than Buy Price.'],
};
const PENDING_SIDE_MESSAGES: Record<Side, string[]> = {
  BUY: ['Stop Loss must be less than price.', 'Take Profit must be greater than price.'],
  SELL: ['Stop Loss must be greater than price.', 'Take Profit must be less than price.'],
};

async function symbolRules(api: AqxApi, symbol: string): Promise<SymbolRules> {
  return (await api.symbolDetail(symbol)) as SymbolRules;
}

function decimalsOf(n: number): number {
  return (String(n).split('.')[1] ?? '').length;
}

/** Asserts `actual` lies between the smallest and largest of `bounds`, give or take `tolerance`. */
function expectBetween(actual: number | null, bounds: number[], tolerance: number, what: string) {
  expect(actual, what).not.toBeNull();
  expect(Number(actual), what).toBeGreaterThanOrEqual(Math.min(...bounds) - tolerance - 1e-9);
  expect(Number(actual), what).toBeLessThanOrEqual(Math.max(...bounds) + tolerance + 1e-9);
}

/** Every value `pick` gives for the quotes read before and after an action. */
function overQuotes(quotes: Quote[], pick: (q: Quote) => number): number[] {
  return quotes.map(pick);
}

test.describe('R1 Market order form', { tag: ['@R1'] }, () => {
  test.skip(!hasCredentials, MISSING_CREDENTIALS_REASON);

  test('TC-MKT-01 Order panel shows the quote with the symbol digits and the symbol trading rules', async ({
    tradePage,
    api,
    symbol,
  }) => {
    const spec = await symbolRules(api, symbol);
    const panel = tradePage.orderPanel;
    await panel.openTradeForm();
    await panel.selectOrderType('Market');

    const withDigits = new RegExp(`^\\d+\\.\\d{${spec.digits}}$`);
    await expect(panel.liveBid).toHaveText(withDigits);
    await expect(panel.liveAsk).toHaveText(withDigits);
    const quote = await panel.quote();
    expect(quote.ask, 'Ask is never below Bid').toBeGreaterThanOrEqual(quote.bid);

    await expect(panel.onePointEquals).toHaveText(`One point equals: ${spec.pointStep}`);
    await expect(panel.volume).toHaveAttribute('placeholder', `Min: ${spec.minContractLotSize}`);
    await expect(panel.units).toHaveText(
      `Min: ${Math.round(spec.minContractLotSize * spec.contractSize)}`,
    );
    // The minimum SL/TP distance in points is the symbol's stops level.
    await expect(panel.stopLossPoints).toHaveAttribute('placeholder', `Min: ${spec.stopsLevel}`);
    await expect(panel.takeProfitPoints).toHaveAttribute('placeholder', `Min: ${spec.stopsLevel}`);
  });

  const wrongSideCase: Record<Side, string> = { BUY: 'TC-MKT-08', SELL: 'TC-MKT-09' };
  for (const side of ['BUY', 'SELL'] as const) {
    test(`${wrongSideCase[side]} ${side} refuses SL and TP on the wrong side of the market with exact messages`, async ({
      tradePage,
      api,
      symbol,
    }) => {
      const spec = await symbolRules(api, symbol);
      const panel = tradePage.orderPanel;
      const distance = spec.stopsLevel + 50;
      await panel.openTradeForm();
      await panel.selectOrderType('Market');
      await panel.chooseSide(side);
      await panel.setNumber(panel.volume, spec.minContractLotSize);
      const quote = await panel.quote();

      await test.step('SL and TP on the wrong side are refused', async () => {
        const wrong = wrongSideMarketLevels(side, quote, spec, distance);
        await panel.setNumber(panel.stopLossPrice, wrong.stopLoss);
        await panel.setNumber(panel.takeProfitPrice, wrong.takeProfit);
        await expect(panel.validation).toHaveText(MARKET_SIDE_MESSAGES[side]);
      });

      await test.step('the same levels are valid for the other side', async () => {
        await panel.chooseSide(opposite(side));
        await expect(panel.validation).toHaveCount(0);
      });

      await test.step('levels on the right side clear the messages', async () => {
        await panel.chooseSide(side);
        const valid = marketLevels(side, quote, spec, distance);
        await panel.setNumber(panel.stopLossPrice, valid.stopLoss);
        await panel.setNumber(panel.takeProfitPrice, valid.takeProfit);
        await expect(panel.validation).toHaveCount(0);
      });
    });
  }

  for (const side of ['BUY', 'SELL'] as const) {
    test(`TC-MKT-07 ${side} SL and TP entered in points become prices that many points from the closing price`, async ({
      tradePage,
      api,
      symbol,
    }) => {
      const spec = await symbolRules(api, symbol);
      const panel = tradePage.orderPanel;
      const slPoints = spec.stopsLevel + 20;
      const tpPoints = spec.stopsLevel + 40;
      await panel.openTradeForm();
      await panel.selectOrderType('Market');
      await panel.chooseSide(side);
      await panel.setNumber(panel.volume, spec.minContractLotSize);

      const before = await panel.quote();
      await panel.setNumber(panel.stopLossPoints, slPoints);
      await panel.setNumber(panel.takeProfitPoints, tpPoints);
      const quotes = [before, await panel.quote()];

      // Points count from the closing price: Bid for a Buy, Ask for a Sell.
      const expected = quotes.map((q) =>
        levelsAround(side, closePrice(side, q), spec, slPoints, tpPoints),
      );
      expectBetween(
        Number(await panel.stopLossPrice.inputValue()),
        expected.map((l) => l.stopLoss),
        0,
        'Stop Loss price',
      );
      expectBetween(
        Number(await panel.takeProfitPrice.inputValue()),
        expected.map((l) => l.takeProfit),
        0,
        'Take Profit price',
      );
      await expect(panel.validation).toHaveCount(0);
    });
  }

  test('TC-MKT-11 Volume field refuses 0, text and values below the minimum, and corrects the rest', async ({
    tradePage,
    api,
    symbol,
  }) => {
    const spec = await symbolRules(api, symbol);
    const { minContractLotSize: min, maxContractLotSize: max, lotSizeStep: step } = spec;
    const stepDecimals = decimalsOf(step);
    const belowMin = String(roundTo(min / 10, stepDecimals + 1));
    const cases: { typed: string; kept: string; messages: string[]; why: string }[] = [
      { typed: '0', kept: '0', messages: ['Please enter a valid volume.'], why: 'zero' },
      { typed: 'abc', kept: '', messages: ['Please enter a valid volume.'], why: 'text' },
      {
        typed: belowMin,
        kept: belowMin,
        messages: [`Minimum volume is ${min}.`],
        why: 'below min',
      },
      {
        // Not a multiple of the step: cut down to the step.
        typed: String(roundTo(min + step * 1.5, stepDecimals + 1)),
        kept: String(roundTo(min + step, stepDecimals)),
        messages: [],
        why: 'off step',
      },
      { typed: String(max + 1), kept: String(max), messages: [], why: 'above max' },
      { typed: String(min), kept: String(min), messages: [], why: 'minimum' },
    ];
    const panel = tradePage.orderPanel;
    await panel.openTradeForm();
    await panel.selectOrderType('Market');

    for (const c of cases) {
      await test.step(`${c.why}: "${c.typed}"`, async () => {
        await panel.typeText(panel.volume, c.typed);
        await expect(panel.volume).toHaveValue(c.kept);
        await expect(panel.validation).toHaveText(c.messages);
      });
    }
    await expect(panel.units).toHaveText(String(Math.round(min * spec.contractSize)));
  });

  test('TC-MKT-14 SL and TP prices are rounded to the symbol digits', async ({
    tradePage,
    api,
    symbol,
  }) => {
    const spec = await symbolRules(api, symbol);
    const panel = tradePage.orderPanel;
    await panel.openTradeForm();
    await panel.selectOrderType('Market');
    await panel.chooseSide('BUY');
    const valid = marketLevels('BUY', await panel.quote(), spec, spec.stopsLevel + 50);
    // Two extra decimals, chosen away from .5 so the rounding direction is unambiguous.
    const extra = spec.digits + 2;
    const typedSl = roundTo(valid.stopLoss - 0.37 * spec.pointStep, extra);
    const typedTp = roundTo(valid.takeProfit + 0.62 * spec.pointStep, extra);

    await panel.typeText(panel.stopLossPrice, typedSl.toFixed(extra));
    await panel.typeText(panel.takeProfitPrice, typedTp.toFixed(extra));

    await expect(panel.stopLossPrice).toHaveValue(
      formatPrice(roundTo(typedSl, spec.digits), spec.digits),
    );
    await expect(panel.takeProfitPrice).toHaveValue(
      formatPrice(roundTo(typedTp, spec.digits), spec.digits),
    );
  });

  const detailsCase: Record<Side, string> = { BUY: 'TC-MKT-04', SELL: 'TC-MKT-05' };
  for (const side of ['BUY', 'SELL'] as const) {
    test(`${detailsCase[side]} Trade Details of a ${side} with SL and TP follow the symbol spec and the account leverage`, async ({
      tradePage,
      api,
      symbol,
    }) => {
      const spec = await symbolRules(api, symbol);
      const account = await api.account();
      const panel = tradePage.orderPanel;
      const volume = Math.min(
        roundTo(spec.minContractLotSize * 50, decimalsOf(spec.lotSizeStep)),
        spec.maxContractLotSize,
      );
      const units = volume * spec.contractSize;
      // Converts quote-currency amounts into the account currency (1 for EURUSD on a USD account).
      const rate = spec.quoteCurrencyExchangeRate;

      await panel.openTradeForm();
      await panel.selectOrderType('Market');
      await panel.chooseSide(side);
      await panel.setNumber(panel.volume, volume);
      const before = await panel.quote();
      const levels = marketLevels(side, before, spec, spec.stopsLevel + 60, spec.stopsLevel + 90);
      await panel.setNumber(panel.stopLossPrice, levels.stopLoss);
      await panel.setNumber(panel.takeProfitPrice, levels.takeProfit);
      const details = await panel.tradeDetails();
      const quotes = [before, await panel.quote()];
      const pnlAt = (exit: number): number[] =>
        overQuotes(quotes, (q) => profit(side, openPrice(side, q), exit, units) * rate);

      await expect(panel.tradeDetailsHeader).toHaveText(`Trade Details (${account.baseCurrency})`);
      // Notional at the open price. The side is chosen before the volume on purpose: switching
      // side afterwards leaves Trade Volume at the old side's price until the volume changes.
      expectBetween(
        details.tradeVolume,
        overQuotes(quotes, (q) => openPrice(side, q) * units * rate),
        0.01,
        'Trade Volume',
      );
      // Seen on 2026-11-08: the margin uses the Ask for both sides, so a Sell's margin is not
      // Trade Volume / leverage. Anything valued between Bid and Ask is accepted.
      const marginFactor = spec.marginPercentage / 100 / account.leverage;
      expectBetween(
        details.marginRequired,
        quotes.flatMap((q) => [q.bid, q.ask].map((p) => p * units * rate * marginFactor)),
        0.01,
        `Est. Margin Required = volume x contract size x price / leverage ${account.leverage}`,
      );
      expectBetween(
        details.amountPerTick,
        [units * spec.pointStep * rate],
        0.005,
        'Amount Per Tick',
      );
      expectBetween(details.potentialLoss, pnlAt(levels.stopLoss), 0.01, 'Potential Loss');
      expectBetween(details.potentialGain, pnlAt(levels.takeProfit), 0.01, 'Potential Gain');
      expect(details.potentialLoss, 'a Stop Loss on the right side is a loss').toBeLessThan(0);
      expectBetween(
        details.riskReward,
        [Math.abs(Number(details.potentialGain) / Number(details.potentialLoss))],
        0.01,
        'Risk:Reward',
      );
    });
  }
});

test.describe('R3 Pending order form', { tag: ['@R3'] }, () => {
  test.skip(!hasCredentials, MISSING_CREDENTIALS_REASON);

  test('TC-PND-01 Order Type offers Market, Limit, Stop and Stop Limit, as the symbol spec says', async ({
    tradePage,
    api,
    symbol,
  }) => {
    const spec = await symbolRules(api, symbol);
    const panel = tradePage.orderPanel;
    await panel.openTradeForm();

    expect(await panel.dropdownOptions(panel.orderType)).toEqual(ORDER_TYPES);
    expect(spec.orderTypes.map((t) => ORDER_TYPE_LABEL[t])).toEqual(ORDER_TYPES);
  });

  test('TC-PND-05 Each order type shows its own price fields and the fill policy from the symbol spec', async ({
    tradePage,
    api,
    symbol,
  }) => {
    const spec = await symbolRules(api, symbol);
    const panel = tradePage.orderPanel;
    await panel.openTradeForm();

    for (const type of ORDER_TYPES) {
      await test.step(type, async () => {
        const fillPolicies = spec.tradeFillPolicy[FILL_POLICY_OF[type]].map(
          (code) => FILL_POLICY_LABEL[code],
        );
        await panel.selectOrderType(type);
        await expect(panel.price).toBeVisible({ visible: type !== 'Market' });
        await expect(panel.stopLimitPrice).toBeVisible({ visible: type === 'Stop Limit' });
        await expect(panel.expiry).toBeVisible({ visible: type !== 'Market' });
        await expect(panel.fillPolicy).toHaveText(String(fillPolicies[0]));
        expect(await panel.dropdownOptions(panel.fillPolicy)).toEqual(fillPolicies);
      });
    }
    // Seen on 2026-11-08 for EURUSD: Fill or Kill for Market, Return for every pending type.
    expect(spec.tradeFillPolicy.marketFillPolicy).toEqual([0]);
  });

  test('TC-PND-25 Expiry offers exactly the symbol expiry types for every pending type', async ({
    tradePage,
    api,
    symbol,
  }) => {
    const spec = await symbolRules(api, symbol);
    const expected = spec.expirationTypes.map((e) => EXPIRY_LABEL[e]);
    expect(expected).toEqual([
      'Good Till Canceled',
      'Good Till Day',
      'Specified Date and Time',
      'Specified Date',
    ]);
    const panel = tradePage.orderPanel;
    await panel.openTradeForm();

    for (const type of PENDING_TYPES) {
      await test.step(type, async () => {
        await panel.selectOrderType(type);
        await expect(panel.expiry).toHaveText('Good Till Canceled');
        expect(await panel.dropdownOptions(panel.expiry)).toEqual(expected);
      });
    }
  });

  for (const side of ['BUY', 'SELL'] as const) {
    test(`TC-PND-11 ${side} pending SL and TP on the wrong side of the order price are refused with exact messages`, async ({
      tradePage,
      api,
      symbol,
    }) => {
      const spec = await symbolRules(api, symbol);
      const panel = tradePage.orderPanel;
      await panel.openTradeForm();
      const quote = await panel.quote();
      const { price } = pendingPrices('Limit', side, quote, spec, spec.stopsLevel + 100);

      await panel.selectOrderType('Limit');
      await panel.chooseSide(side);
      await panel.setNumber(panel.volume, spec.minContractLotSize);
      await panel.setNumber(panel.price, price);

      await test.step('SL and TP on the wrong side of the order price', async () => {
        const wrong = levelsAround(side, price, spec, -(spec.stopsLevel + 20));
        await panel.setNumber(panel.stopLossPrice, wrong.stopLoss);
        await panel.setNumber(panel.takeProfitPrice, wrong.takeProfit);
        await expect(panel.validation).toHaveText(PENDING_SIDE_MESSAGES[side]);
      });

      await test.step('SL and TP on the right side clear the messages', async () => {
        const valid = levelsAround(side, price, spec, spec.stopsLevel + 20);
        await panel.setNumber(panel.stopLossPrice, valid.stopLoss);
        await panel.setNumber(panel.takeProfitPrice, valid.takeProfit);
        await expect(panel.validation).toHaveCount(0);
      });

      await test.step('text in the price field is refused', async () => {
        await panel.typeText(panel.price, 'abc');
        await expect(panel.price).toHaveValue('');
        await expect(panel.validation).toContainText(['Please enter a valid price.']);
      });
    });
  }

  test('TC-PND-08 Pending SL/TP are checked against the order price, not the market price', async ({
    tradePage,
    api,
    symbol,
  }) => {
    const spec = await symbolRules(api, symbol);
    const panel = tradePage.orderPanel;
    const gap = spec.stopsLevel + 20;
    await panel.openTradeForm();
    const quote = await panel.quote();
    const spreadPoints = Math.round((quote.ask - quote.bid) / spec.pointStep);

    await test.step('Buy Limit: a TP below the current Bid but above the order price is accepted', async () => {
      // Far enough below the market that order price + gap is still under the Bid.
      const order = pendingPrices('Limit', 'BUY', quote, spec, 2 * gap + spreadPoints + 50);
      const levels = levelsAround('BUY', order.price, spec, gap);
      expect(levels.takeProfit, 'test data: TP below the Bid').toBeLessThan(quote.bid);
      await panel.fillPendingOrder({
        type: 'Limit',
        side: 'BUY',
        volume: spec.minContractLotSize,
        ...order,
        ...levels,
      });
      await expect(panel.validation).toHaveCount(0);
    });

    await test.step('Buy Stop Limit: SL/TP are checked against the Stop Limit Price', async () => {
      const order = pendingPrices('Stop Limit', 'BUY', quote, spec, 2 * gap, gap);
      const limit = executionPrice(order);
      await panel.fillPendingOrder({
        type: 'Stop Limit',
        side: 'BUY',
        volume: spec.minContractLotSize,
        ...order,
      });
      // Below the stop price but above the limit price: wrong for a Buy that fills at the limit.
      await panel.setNumber(panel.stopLossPrice, towardsProfit('BUY', limit, gap / 2, spec));
      await expect(panel.validation).toHaveText(['Stop Loss must be less than price.']);
      await panel.setNumber(panel.stopLossPrice, towardsProfit('BUY', limit, -gap, spec));
      await expect(panel.validation).toHaveCount(0);
    });
  });

  test('TC-PND-15 The expiry calendar starts at today on the server clock and blocks past days', async ({
    tradePage,
  }) => {
    const panel = tradePage.orderPanel;
    await panel.openTradeForm();
    await panel.selectOrderType('Limit');
    await panel.selectExpiry('Specified Date');
    const offset = await panel.serverTimeOffsetMs();
    const today = serverClock(new Date(), offset);
    const tomorrow = serverClock(new Date(Date.now() + 86_400_000), offset);
    await expect(panel.expiryDate).toHaveText(today.date);

    await panel.expiryDate.click();
    const calendar = panel.expiryCalendar;
    await expect(calendar).toBeVisible();
    await expect(calendar.locator('.react-calendar__navigation__prev-button')).toBeDisabled();
    await expect(calendar.getByRole('button', { name: calendarDayLabel(today) })).toBeEnabled();
    const enabledDays = await calendar
      .locator('.react-calendar__tile:enabled abbr')
      .evaluateAll((days) => days.map((d) => d.getAttribute('aria-label') ?? ''));
    const todayStart = Date.parse(calendarDayLabel(today));
    expect(
      enabledDays.filter((d) => Date.parse(d) < todayStart),
      'past days are enabled',
    ).toEqual([]);

    await calendar.getByRole('button', { name: calendarDayLabel(tomorrow) }).click();
    await expect(panel.expiryDate).toHaveText(tomorrow.date);
  });

  test('TC-PND-14 Specified Date and Time starts at the server time and keeps the picked moment', async ({
    tradePage,
  }) => {
    const panel = tradePage.orderPanel;
    await panel.openTradeForm();
    await panel.selectOrderType('Limit');
    const offset = await panel.serverTimeOffsetMs();
    const minute = 60_000;
    const now = Date.now();

    await panel.selectExpiry('Specified Date and Time');
    // The default is "now" on the server clock; allow the minute to tick over.
    const aroundNow = [now - minute, now, now + minute].map((t) =>
      serverClock(new Date(t), offset),
    );
    await expect(panel.expiryDate).toHaveText(new RegExp(aroundNow.map((c) => c.date).join('|')));
    await expect(panel.expiryTime).toHaveText(new RegExp(aroundNow.map((c) => c.time).join('|')));

    const today = serverClock(new Date(now), offset);
    const target = new Date(Date.UTC(today.year, today.month - 1, today.day + 1, 12, 30) - offset);
    // Selected again because switching One-Click Trading in another session resets the form.
    await panel.selectOrderType('Limit');
    await panel.selectExpiry('Specified Date and Time', target);
    await expect(panel.expiryDate).toHaveText(serverClock(target, offset).date);
    await expect(panel.expiryTime).toHaveText('12:30');
  });
});
