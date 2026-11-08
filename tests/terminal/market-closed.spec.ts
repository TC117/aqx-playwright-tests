import type { SymbolDetail, TradingSession } from '../../src/api/AqxApi';
import { hasCredentials, MISSING_CREDENTIALS_REASON } from '../../src/config/env';
import { expect, test } from '../../src/fixtures/test';
import { skipUnlessMarketClosed } from '../../src/helpers/market';
import { roundTo } from '../../src/helpers/numbers';
import {
  executionPrice,
  levelsAround,
  marketLevels,
  pendingPrices,
} from '../../src/helpers/orderLevels';
import type { PendingOrderType, Side } from '../../src/models/trading';
import { serverClock, type ServerClock } from '../../src/pages/components/OrderPanel';

/*
 * Behaviour while the symbol's market is closed (weekends, holidays, outside the sessions).
 * These tests run only then; `skipUnlessMarketClosed` decides from the server's market status.
 * Every order is filled in completely and validly, so the market state is the only reason the
 * terminal can refuse it.
 */

/** Session fields the API returns but `AqxApi` does not type yet. */
interface Session extends TradingSession {
  openDay?: number;
  closeDay?: number;
}

interface ScheduleDetail extends SymbolDetail {
  tradingSessions: Session[];
  /** True on a trading holiday. */
  holiday?: boolean;
}

const SIDES: Side[] = ['BUY', 'SELL'];
const PENDING_TYPES: PendingOrderType[] = ['Limit', 'Stop', 'Stop Limit'];
/** API day numbers: 1 = Monday … 7 = Sunday. */
const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const MINUTES_PER_DAY = 24 * 60;
const MINUTES_PER_WEEK = 7 * MINUTES_PER_DAY;

/** The Specification tab's label for a UTC offset, e.g. `GMT +0200`. */
function gmtLabel(offsetMs: number): string {
  const minutes = Math.round(Math.abs(offsetMs) / 60_000);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `GMT ${offsetMs < 0 ? '-' : '+'}${pad(Math.floor(minutes / 60))}${pad(minutes % 60)}`;
}

function minuteOfDay(time: string): number {
  const [h = 0, m = 0] = time.split(':').map(Number);
  return h * 60 + m;
}

/** True when the server clock falls inside one of the symbol's weekly sessions. */
function insideSessions(sessions: Session[], clock: ServerClock): boolean {
  const weekday = new Date(Date.UTC(clock.year, clock.month - 1, clock.day)).getUTCDay() || 7;
  const now = (weekday - 1) * MINUTES_PER_DAY + clock.hour * 60 + clock.minute;
  return sessions.some((s) => {
    const start = ((s.openDay ?? s.dayOfWeek) - 1) * MINUTES_PER_DAY + minuteOfDay(s.openTime);
    let end = ((s.closeDay ?? s.dayOfWeek) - 1) * MINUTES_PER_DAY + minuteOfDay(s.closeTime);
    if (end <= start) end += MINUTES_PER_WEEK;
    return [now, now + MINUTES_PER_WEEK].some((t) => t >= start && t < end);
  });
}

/** True when the schedule says the market should be trading at `clock`. */
function scheduledOpen(detail: ScheduleDetail, clock: ServerClock): boolean {
  return insideSessions(detail.tradingSessions, clock) && !detail.holiday;
}

test.describe(
  'R1 Market orders while the market is closed',
  { tag: ['@R1', '@market-closed'] },
  () => {
    test.skip(!hasCredentials, MISSING_CREDENTIALS_REASON);

    test.beforeEach(async ({ api, symbol }) => {
      await skipUnlessMarketClosed(api, symbol);
    });

    test('TC-MKT-17 Buy and Sell market orders cannot be placed while the market is closed', async ({
      tradePage,
      api,
      symbol,
    }) => {
      const spec = await api.symbolDetail(symbol);
      const server = await api.symbol(symbol);
      const countsBefore = await api.orderCounts();
      const panel = tradePage.orderPanel;
      await panel.openTradeForm();

      const quote = await panel.quote();
      // No new quotes arrive, so the panel shows the server's last Bid/Ask.
      expect(quote).toEqual({
        bid: roundTo(server.bid, spec.digits),
        ask: roundTo(server.ask, spec.digits),
      });

      for (const side of SIDES) {
        await test.step(side, async () => {
          await panel.fillMarketOrder({
            side,
            volume: spec.minContractLotSize,
            ...marketLevels(side, quote, spec, spec.stopsLevel + 50),
          });
          await expect(panel.validation).toHaveCount(0);
          await expect(panel.placeButton).toBeDisabled();
          await expect(panel.placeButton).toHaveText(/^market closed$/i);
        });
      }
      expect(await api.orderCounts(), 'no position or pending order was created').toEqual(
        countsBefore,
      );
    });

    test('TC-MKT-17 Trading hours in Specification match the symbol sessions and explain the closed market', async ({
      tradePage,
      api,
      symbol,
    }) => {
      const detail = (await api.symbolDetail(symbol)) as ScheduleDetail;
      const panel = tradePage.orderPanel;
      const offset = await panel.serverTimeOffsetMs();

      const hours = await panel.tradingHours();

      // The time zone label agrees with the server clock in the top bar.
      expect(hours.timeZone).toBe(gmtLabel(offset));
      expect(hours.sessions).toEqual(
        detail.tradingSessions.map((s) => ({
          day: DAY_NAMES[s.dayOfWeek - 1],
          hours: `${s.openTime} - ${s.closeTime}`,
        })),
      );
      const now = serverClock(new Date(), offset);
      expect(
        scheduledOpen(detail, now),
        `server time ${now.date} ${now.time} should be outside the trading sessions (or a holiday)`,
      ).toBe(false);
    });
  },
);

test.describe(
  'R3 Pending orders while the market is closed',
  { tag: ['@R3', '@market-closed'] },
  () => {
    test.skip(!hasCredentials, MISSING_CREDENTIALS_REASON);

    test.beforeEach(async ({ api, symbol }) => {
      await skipUnlessMarketClosed(api, symbol);
    });

    test('TC-PND-23 No pending order type can be placed while the market is closed', async ({
      tradePage,
      api,
      symbol,
    }) => {
      const spec = await api.symbolDetail(symbol);
      const countsBefore = await api.orderCounts();
      const panel = tradePage.orderPanel;
      await panel.openTradeForm();
      const quote = await panel.quote();

      for (const type of PENDING_TYPES) {
        for (const side of SIDES) {
          await test.step(`${side} ${type}`, async () => {
            const prices = pendingPrices(
              type,
              side,
              quote,
              spec,
              spec.stopsLevel + 100,
              spec.stopsLevel + 50,
            );
            await panel.fillPendingOrder({
              type,
              side,
              volume: spec.minContractLotSize,
              ...prices,
              ...levelsAround(side, executionPrice(prices), spec, spec.stopsLevel + 50),
            });
            await expect(panel.validation).toHaveCount(0);
            await expect(panel.placeButton).toBeDisabled();
            await expect(panel.placeButton).toHaveText(/^market closed$/i);
          });
        }
      }
      expect(await api.orderCounts(), 'no pending order was created').toEqual(countsBefore);
    });
  },
);
