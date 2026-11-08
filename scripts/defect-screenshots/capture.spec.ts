import fs from 'node:fs';
import path from 'node:path';
import { test, expect, type Locator, type Page } from '@playwright/test';
import { TradePage } from '../../src/pages/TradePage';
import { chooseOption, type OrderPanel } from '../../src/pages/components/OrderPanel';

/**
 * Screenshots for docs/defects.md, taken on the live demo while the market is closed.
 *
 * Read-only by design: it types into the order form, opens pickers and clicks Bulk Close on an
 * empty list, the same steps as the manual checks. It never clicks the place button, refuses to
 * run on anything but a demo account or with One-Click Trading on (a BUY/SELL click would then
 * place an order), and never logs in. Each capture soft-checks that the defect is still there, so
 * a fixed defect shows up as a failure instead of a misleading picture.
 */

const OUT_DIR = path.resolve(__dirname, '../../docs/defects');
const SYMBOL = 'EURUSD';
const OVERLAY = 'defect-highlight-overlay';
const NO_SESSION =
  'No valid saved session. Run `npx playwright test --project=setup` (with .env.local filled in) first.';

let tradePage: TradePage;
let fullViewport: { width: number; height: number };

test.beforeAll(() => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
});

test.beforeEach(async ({ page }) => {
  const viewport = page.viewportSize();
  if (!viewport) throw new Error('No viewport size');
  fullViewport = viewport;
  tradePage = new TradePage(page);
  try {
    await tradePage.open();
  } catch (error) {
    if (/\/login/.test(page.url())) throw new Error(NO_SESSION, { cause: error });
    throw error;
  }
  await expect(tradePage.account.typeTag, 'only a demo account may be used').toHaveText(/demo/i);
  await expect(
    page.getByTestId('tab-one-click-trading'),
    'One-Click Trading must be off: a BUY/SELL click would place an order',
  ).toHaveCount(0);
  await tradePage.selectSymbol(SYMBOL);
  await tradePage.orderPanel.openTradeForm();
});

/** The order panel: the innermost element holding its tabs and the place button. */
function panelOf(page: Page): Locator {
  return page
    .locator('div')
    .filter({ has: page.getByTestId('tab-trade') })
    .filter({ has: page.getByTestId('trade-button-order') })
    .last();
}

const detail = (page: Page, id: string): Locator =>
  panelOf(page).getByTestId(`trade-details-${id}`);

/** A picture of the whole order panel, from its tabs to the place button. */
function shootPanel(page: Page, name: string, highlight: Highlight[]): Promise<void> {
  const panel = tradePage.orderPanel;
  return shoot(page, name, [panel.tradeTab, panel.specificationTab, panel.placeButton], highlight, {
    paddingTop: 2,
  });
}

/** Size of one point, from "One point equals: 0.0001". */
async function pointOf(panel: OrderPanel): Promise<{ point: number; digits: number }> {
  const text = await panel.onePointEquals.innerText();
  const match = /(\d+\.(\d+))/.exec(text);
  if (!match) throw new Error(`Cannot read the point size from "${text}"`);
  return { point: Number(match[1]), digits: match[2]!.length };
}

/** Waits until an element stops moving (the panel animates when Trade Details opens). */
async function settled(locator: Locator): Promise<void> {
  let last = '';
  await expect
    .poll(
      async () => {
        const now = JSON.stringify(await locator.boundingBox());
        const same = now === last;
        last = now;
        return same;
      },
      { intervals: [250], message: 'the element should stop moving' },
    )
    .toBe(true);
}

/**
 * Opens the "Trade Details" block. It sits at the bottom of the panel and stays in the DOM while
 * collapsed (only covered), so its height tells whether it is open.
 */
async function openTradeDetails(page: Page): Promise<void> {
  const block = panelOf(page).getByTestId('trade-details');
  const height = async () => (await block.boundingBox())?.height ?? 0;
  if ((await height()) < 60) await tradePage.orderPanel.tradeDetailsHeader.click();
  await expect.poll(height, { message: 'Trade Details should open' }).toBeGreaterThan(120);
  await settled(block);
}

/**
 * The panel keeps Trade Details and the place button at the bottom of the window. Shortens the
 * window so they sit just under `formEnd`, instead of leaving an empty gap in the picture.
 */
async function fitPanelTo(page: Page, formEnd: Locator): Promise<void> {
  const block = panelOf(page).getByTestId('trade-details');
  await page.setViewportSize(fullViewport);
  await settled(block);
  const end = await formEnd.boundingBox();
  const bottom = await block.boundingBox();
  if (!end || !bottom) throw new Error('Cannot measure the order panel');
  const height = Math.ceil(end.y + end.height + 24 + (fullViewport.height - bottom.y));
  await page.setViewportSize({
    width: fullViewport.width,
    height: Math.min(fullViewport.height, height),
  });
  await settled(block);
}

/**
 * Highlights each element, or one box around all elements of `around`, cut to the visible part
 * of `within` (a scrolling list hides some of its items).
 */
type Highlight = Locator | { around: Locator; within?: Locator };

/** Draws red boxes in a layer above the page, so no container can clip them. */
async function drawHighlights(highlights: Highlight[]): Promise<void> {
  for (const highlight of highlights) {
    const union = 'around' in highlight;
    const locator = union ? highlight.around : highlight;
    const limit = union && highlight.within ? await highlight.within.boundingBox() : null;
    await locator.evaluateAll(
      (elements, [className, joinAll, bounds]) => {
        const rects = elements
          .map((el) => el.getBoundingClientRect())
          .filter((r) => r.width > 0 && r.height > 0)
          .map((r) => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom }));
        let boxes = rects;
        if (joinAll && rects.length) {
          boxes = [
            {
              left: Math.min(...rects.map((r) => r.left)),
              top: Math.min(...rects.map((r) => r.top)),
              right: Math.max(...rects.map((r) => r.right)),
              bottom: Math.max(...rects.map((r) => r.bottom)),
            },
          ];
        }
        if (bounds) {
          boxes = boxes.map((b) => ({
            left: Math.max(b.left, bounds.x),
            top: Math.max(b.top, bounds.y),
            right: Math.min(b.right, bounds.x + bounds.width),
            bottom: Math.min(b.bottom, bounds.y + bounds.height),
          }));
        }
        for (const box of boxes) {
          const frame = document.createElement('div');
          frame.className = className;
          Object.assign(frame.style, {
            position: 'fixed',
            left: `${box.left - 4}px`,
            top: `${box.top - 4}px`,
            width: `${box.right - box.left + 8}px`,
            height: `${box.bottom - box.top + 8}px`,
            border: '3px solid #e11d48',
            borderRadius: '6px',
            boxSizing: 'border-box',
            pointerEvents: 'none',
            zIndex: '2147483647',
          });
          document.body.appendChild(frame);
        }
      },
      [OVERLAY, union, limit] as const,
    );
  }
}

/**
 * Saves a screenshot of the smallest area holding every `area` element, with red boxes around
 * the `highlight` elements (drawn for the picture only and removed right after). `paddingTop`
 * is kept small for pictures that start at the panel tabs, so the top bar's clock is not cut in
 * half.
 */
async function shoot(
  page: Page,
  name: string,
  area: Locator[],
  highlight: Highlight[] = [],
  { padding = 12, paddingTop = padding }: { padding?: number; paddingTop?: number } = {},
): Promise<void> {
  const boxes = await Promise.all(
    area.map(async (locator) => {
      const box = await locator.first().boundingBox();
      if (!box) throw new Error(`${name}: an element of the area is not visible`);
      return box;
    }),
  );
  const viewport = page.viewportSize();
  if (!viewport) throw new Error('No viewport size');
  const left = Math.max(0, Math.min(...boxes.map((b) => b.x)) - padding);
  const top = Math.max(0, Math.min(...boxes.map((b) => b.y)) - paddingTop);
  const right = Math.min(viewport.width, Math.max(...boxes.map((b) => b.x + b.width)) + padding);
  const bottom = Math.min(viewport.height, Math.max(...boxes.map((b) => b.y + b.height)) + padding);

  await drawHighlights(highlight);
  try {
    await page.screenshot({
      path: path.join(OUT_DIR, `${name}.png`),
      clip: { x: left, y: top, width: right - left, height: bottom - top },
      animations: 'disabled',
    });
  } finally {
    await page.evaluate(
      (className) => document.querySelectorAll(`.${className}`).forEach((el) => el.remove()),
      OVERLAY,
    );
  }
}

test('DEF-02 a Stop Loss of 0 is accepted and treated as no Stop Loss', async ({ page }) => {
  const panel = tradePage.orderPanel;
  await panel.selectOrderType('Market');
  await panel.chooseSide('BUY');
  await panel.setNumber(panel.volume, 0.01);

  await panel.typeText(panel.stopLossPrice, '0');
  await openTradeDetails(page);
  await fitPanelTo(page, panel.takeProfitPoints);

  await expect.soft(panel.stopLossPrice).toHaveValue(/^0\.0+$/);
  await expect.soft(panel.validation).toHaveCount(0);
  await shootPanel(page, 'DEF-02-stop-loss-zero', [
    panel.stopLossPrice,
    panel.stopLossPoints,
    detail(page, 'potential-loss'),
    detail(page, 'risk-reward'),
  ]);
});

test('DEF-03 the stops level is not checked in the order form', async ({ page }) => {
  const panel = tradePage.orderPanel;
  await panel.selectOrderType('Market');
  await panel.chooseSide('BUY');
  await panel.setNumber(panel.volume, 0.01);
  const { point, digits } = await pointOf(panel);
  const { bid } = await panel.quote();

  await panel.typeText(panel.stopLossPrice, (bid - 8 * point).toFixed(digits));
  await openTradeDetails(page);
  await fitPanelTo(page, panel.takeProfitPoints);

  expect.soft(Number(await panel.stopLossPoints.inputValue())).toBeLessThan(50);
  await expect.soft(panel.validation).toHaveCount(0);
  // The empty Take Profit Points field still shows the "Min: 50" hint.
  await shootPanel(page, 'DEF-03-stop-loss-inside-stops-level', [
    panel.liveBid,
    panel.stopLossPrice,
    panel.stopLossPoints,
    panel.takeProfitPoints,
  ]);
});

test('DEF-04 a pending price on the wrong side of the market, or 0, is accepted', async ({
  page,
}) => {
  const panel = tradePage.orderPanel;
  await panel.selectOrderType('Limit');
  await panel.chooseSide('BUY');
  await panel.setNumber(panel.volume, 0.01);
  const { point, digits } = await pointOf(panel);
  const { ask } = await panel.quote();

  await panel.typeText(panel.price, (ask + 59 * point).toFixed(digits));
  await openTradeDetails(page);
  await fitPanelTo(page, panel.expiry);
  await expect.soft(panel.validation).toHaveCount(0);
  await shootPanel(page, 'DEF-04-buy-limit-above-ask', [panel.buySide, panel.price]);

  await panel.typeText(panel.price, '0');
  await expect.soft(panel.price).toHaveValue(/^0\.0+$/);
  await expect.soft(panel.validation).toHaveCount(0);
  await shootPanel(page, 'DEF-04-pending-price-zero', [
    panel.price,
    detail(page, 'trade-size'),
    detail(page, 'margin-required'),
  ]);
});

test('DEF-05 an invalid volume is silently replaced when the user leaves the field', async ({
  page,
}) => {
  const panel = tradePage.orderPanel;
  await panel.selectOrderType('Market');
  const area = [panel.tradeTab, panel.specificationTab, panel.volume, panel.units];

  await panel.volume.fill('');
  await panel.volume.pressSequentially('0.015');
  await shoot(page, 'DEF-05-volume-typed', area, [panel.volume], { padding: 6, paddingTop: 2 });

  await panel.volume.blur();
  await expect.soft(panel.volume).toHaveValue('0.01');
  await expect.soft(panel.validation).toHaveCount(0);
  await shoot(page, 'DEF-05-volume-after-tab', area, [panel.volume, panel.units], {
    padding: 6,
    paddingTop: 2,
  });

  await panel.typeText(panel.volume, '101');
  await expect.soft(panel.volume).toHaveValue('100');
  await expect.soft(panel.validation).toHaveCount(0);
  await shoot(page, 'DEF-05-volume-101', area, [panel.volume, panel.units], {
    padding: 6,
    paddingTop: 2,
  });
});

test('DEF-06 Trade Details mix the Bid and the Ask', async ({ page }) => {
  const panel = tradePage.orderPanel;
  const tradeVolume = detail(page, 'trade-size');
  const margin = detail(page, 'margin-required');
  await panel.selectOrderType('Market');

  await panel.chooseSide('SELL');
  await panel.setNumber(panel.volume, 5);
  await openTradeDetails(page);
  await fitPanelTo(page, panel.takeProfitPoints);
  await shootPanel(page, 'DEF-06-sell-margin-uses-ask', [panel.sellSide, tradeVolume, margin]);

  // textContent, as toHaveText compares it (innerText adds a line break after the label).
  const sellTradeVolume = (await tradeVolume.textContent()) ?? '';
  await panel.chooseSide('BUY');
  await expect
    .soft(tradeVolume, 'Trade Volume keeps the Bid-based value')
    .toHaveText(sellTradeVolume);
  await shootPanel(page, 'DEF-06-buy-keeps-sell-trade-volume', [panel.buySide, tradeVolume]);

  await panel.selectOrderType('Limit');
  await panel.setNumber(panel.volume, 5);
  const { point, digits } = await pointOf(panel);
  const { ask } = await panel.quote();
  await panel.typeText(panel.price, (ask + 59 * point).toFixed(digits));
  await openTradeDetails(page);
  await fitPanelTo(page, panel.expiry);
  await shootPanel(page, 'DEF-06-limit-margin-uses-market-ask', [
    panel.buySide,
    panel.price,
    tradeVolume,
    margin,
  ]);
});

test('DEF-07 the expiry time picker offers hours that have already passed', async ({ page }) => {
  const panel = tradePage.orderPanel;
  await panel.selectOrderType('Limit');
  await chooseOption(panel.expiry, 'Specified Date and Time');
  const serverHour = Number(/ (\d{2}):\d{2}/.exec(await panel.serverTime.innerText())?.[1]);
  test.skip(!serverHour, 'just after midnight no hour of today has passed yet');

  await panel.expiryTime.click();
  const hourLabel = page.getByText('Hour', { exact: true });
  const minuteLabel = page.getByText('Minute', { exact: true });
  const hourColumn = page
    .locator('div')
    .filter({ has: hourLabel })
    .filter({ hasNot: minuteLabel })
    .first();
  await hourColumn.locator('[tabindex="0"]').first().click();
  const hours = hourColumn.getByTestId('options');
  await expect(hours).toBeVisible();

  const pastHours = Array.from({ length: serverHour }, (_, h) => String(h).padStart(2, '0'));
  const past = hours.getByText(new RegExp(`^(${pastHours.join('|')})$`));
  await expect.soft(past).toHaveCount(pastHours.length);
  await shoot(
    page,
    'DEF-07-past-hours-selectable',
    [panel.serverTime, panel.tradeTab, panel.specificationTab, hours, panel.expiryTime],
    [panel.serverTime, { around: past, within: hours }],
  );
  await page.keyboard.press('Escape');
});

test('DEF-08 Specified Date and Time expiry defaults to the current time', async ({ page }) => {
  const panel = tradePage.orderPanel;
  await panel.selectOrderType('Limit');
  await chooseOption(panel.expiry, 'Specified Date and Time');

  const now = /(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})/.exec(await panel.serverTime.innerText());
  if (!now) throw new Error('Cannot read the server time');
  await expect.soft(panel.expiryDate).toHaveText(now[1]!);
  await expect.soft(panel.expiryTime).toHaveText(now[2]!);
  await shoot(
    page,
    'DEF-08-expiry-defaults-to-now',
    [panel.serverTime, panel.tradeTab, panel.specificationTab, panel.expiryDate, panel.expiryTime],
    [panel.serverTime, panel.expiryDate, panel.expiryTime],
  );
});

test('DEF-09 Margin Level shows 0.00% when no margin is used', async ({ page }) => {
  const { account } = tradePage;
  await expect.soft(account.marginLevel).toHaveText(/^0\.00\s*%$/);
  await shoot(
    page,
    'DEF-09-margin-level-header',
    [account.header.getByText('Equity', { exact: true }), account.marginLevel],
    [account.marginLevel],
  );

  await account.openDropdown();
  const marginUsed = account.dropdown.getByTestId('account-info-margin-value');
  const marginLevel = account.dropdown.getByTestId('account-info-margin-level-value');
  await expect.soft(marginUsed).toHaveText(/^\$?0\.00$/);
  await shoot(page, 'DEF-09-margin-level-dropdown', [account.dropdown], [marginUsed, marginLevel]);
  await account.closeDropdown();
});

test('DEF-10 Bulk Close gives no feedback on an empty list', async ({ page }) => {
  const { openPositions, bulk } = tradePage;
  await openPositions.open();
  test.skip((await openPositions.count()) > 0, 'the account has open positions');

  await bulk.closeButton.click();
  // Give a menu, dialog or toast the time to appear before taking the picture.
  await page.waitForTimeout(1_500);
  await expect.soft(bulk.closeOption('all')).toBeHidden();
  await expect.soft(page.getByRole('dialog')).toHaveCount(0);
  await shoot(
    page,
    'DEF-10-bulk-close-empty-list',
    [openPositions.tab, bulk.closeButton, openPositions.emptyState],
    [openPositions.tab, bulk.closeButton],
  );
});
