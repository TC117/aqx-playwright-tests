import { expect, type Locator, type Page } from '@playwright/test';
import { parseUiNumber, requireUiNumber } from '../../helpers/numbers';
import type { PositionRow, Side } from '../../models/trading';
import { ClosePositionDialog } from './ClosePositionDialog';
import { EditPositionDialog } from './EditPositionDialog';
import { submitTradeRequest, TRADE_API } from './tradeRequests';

/**
 * The assets tables render at most this many rows: with 60 or 75 fabricated positions the tab
 * said "(60)" / "(75)" but only the first 30 rows existed, also after scrolling.
 */
export const RENDERED_ROW_LIMIT = 30;

/** Count in a tab label such as "Open Positions (3)". */
export function tabCount(label: string): number {
  const match = /\((\d+)\)/.exec(label);
  if (!match) throw new Error(`No count in the tab label "${label}"`);
  return Number(match[1]);
}

/** Regex matching exactly `text` (after trimming). */
export function exactly(text: string): RegExp {
  return new RegExp(`^\\s*${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`);
}

/**
 * Assets module > "Open Positions (N)" tab.
 *
 * Verified with no positions: columns are Open Date, Order No., Symbol, Type, Profit/Loss, ROI%,
 * Volume, Units, Margin Used, Entry Price, Current Price, Take Profit, Stop Loss, Swap, Comment,
 * Track, Edit, Share, Close. Empty state: "You have no open positions."
 * Verified with fabricated positions (mocked reads): rows `asset-open-list-item`, cells
 * `asset-open-column-*`; Type shows BUY / SELL; prices use the symbol's digits; a missing SL/TP
 * (0) shows `--`; Profit/Loss is signed (`+68.50`, `-12.34`). The tab count is the length of the
 * list the server returned, not `/counts`. Row buttons: `asset-open-button-edit` and
 * `asset-open-button-close` (enabled by the row's `editable` / `closable` flags).
 * Owner: positions and bulk work (R4, R5).
 */
export class OpenPositions {
  readonly tab: Locator;
  readonly rows: Locator;
  readonly emptyState: Locator;
  readonly headers: Locator;
  /** Close dialog, shown after a row's close button while One-Click Trading is off. */
  readonly closeDialog: ClosePositionDialog;

  constructor(protected readonly page: Page) {
    this.tab = page.getByTestId('tab-asset-order-type-open-positions');
    this.rows = page.getByTestId('asset-open-list-item');
    this.emptyState = page.getByText('You have no open positions.');
    // Header cells of the table that holds the empty state or the rows.
    this.headers = page
      .getByRole('table')
      .filter({ has: this.emptyState.or(this.rows) })
      .locator('thead th');
    this.closeDialog = new ClosePositionDialog(page);
  }

  async open(): Promise<void> {
    await this.tab.click();
    await expect(this.rows.first().or(this.emptyState)).toBeVisible();
  }

  /** Count shown in the tab label, e.g. 3 for "Open Positions (3)". */
  async count(): Promise<number> {
    return tabCount(await this.tab.innerText());
  }

  /**
   * Order No. of every row currently listed (the tab must be open). Waits until the table shows as
   * many rows as the tab label counts, so a list that is still loading is not read half-way.
   */
  async orderIds(): Promise<string[]> {
    await expect(this.rows.first().or(this.emptyState)).toBeVisible();
    await expect
      .poll(
        async () => (await this.rows.count()) === Math.min(await this.count(), RENDERED_ROW_LIMIT),
        { message: 'the table should list as many positions as the tab label counts' },
      )
      .toBe(true);
    const ids = await this.rows.getByTestId('asset-open-column-order-id').allInnerTexts();
    return ids.map((id) => id.trim());
  }

  /** The row of one position, found by its Order No. */
  row(orderId: string): Locator {
    return this.rows.filter({
      has: this.page
        .getByTestId('asset-open-column-order-id')
        .filter({ hasText: exactly(orderId) }),
    });
  }

  async read(orderId: string): Promise<PositionRow> {
    const row = this.row(orderId);
    await expect(row, `position ${orderId} should be listed once`).toHaveCount(1);
    const cell = async (name: string): Promise<string> =>
      (await row.getByTestId(`asset-open-column-${name}`).innerText()).trim();
    return {
      orderId: await cell('order-id'),
      symbol: await cell('symbol'),
      side: toSide(await cell('order-type')),
      volume: requireUiNumber(await cell('volume'), 'Volume'),
      entryPrice: requireUiNumber(await cell('entry-price'), 'Entry Price'),
      currentPrice: parseUiNumber(await cell('current-price')),
      stopLoss: parseUiNumber(await cell('stop-loss')),
      takeProfit: parseUiNumber(await cell('take-profit')),
      profit: parseUiNumber(await cell('profit')),
    };
  }

  /** Opens the Edit dialog of a position without changing anything. */
  async openEdit(orderId: string): Promise<EditPositionDialog> {
    const dialog = new EditPositionDialog(this.page);
    await this.row(orderId).getByTestId('asset-open-button-edit').click();
    await expect(dialog.root).toBeVisible();
    await expect(dialog.orderId).toHaveText(orderId);
    return dialog;
  }

  /**
   * Changes SL and/or TP through the Edit dialog. Pass `null` to remove a value. Resolves once the
   * server accepted the change and the row shows it.
   */
  async edit(
    orderId: string,
    changes: { stopLoss?: number | null; takeProfit?: number | null },
  ): Promise<void> {
    const dialog = await this.openEdit(orderId);
    await dialog.fill(changes);
    await dialog.submit(orderId);
    const row = this.row(orderId);
    for (const [key, column] of [
      ['stopLoss', 'stop-loss'],
      ['takeProfit', 'take-profit'],
    ] as const) {
      const expected = changes[key];
      if (expected === undefined) continue;
      await expect
        .poll(
          async () =>
            parseUiNumber(await row.getByTestId(`asset-open-column-${column}`).innerText()),
          {
            message: `position ${orderId} should show the new ${key}`,
          },
        )
        .toBe(expected);
    }
  }

  /**
   * Closes a position, fully or (with `volume`) partially, through the Close dialog. With One-Click
   * Trading on, the close button closes the whole position at once, so a partial close then
   * fails. Resolves once the server accepted and the row is gone (full) or shows less volume.
   */
  async close(orderId: string, options: { volume?: number } = {}): Promise<void> {
    const row = this.row(orderId);
    await expect(row, `position ${orderId} should be listed once`).toHaveCount(1);
    const volumeBefore = (await row.getByTestId('asset-open-column-volume').innerText()).trim();
    const dialog = this.closeDialog;
    let dialogShown = false;
    await submitTradeRequest(this.page, {
      action: `Closing position ${orderId}`,
      trigger: row.getByTestId('asset-open-button-close'),
      // With One-Click Trading off the click opens the Close dialog, where the volume is chosen.
      confirm: dialog.root,
      matches: (r) =>
        r.method() === 'PUT' &&
        new URL(r.url()).pathname === TRADE_API.closeOrDelete &&
        String((r.postDataJSON() as { orderId?: unknown } | null)?.orderId) === orderId,
      errors: dialog.errors,
      completeDialog: async () => {
        dialogShown = true;
        if (options.volume === undefined) await dialog.useMaxVolume();
        else await dialog.setVolume(options.volume);
        await dialog.confirmButton.click();
      },
    });
    if (!dialogShown && options.volume !== undefined) {
      throw new Error(
        `One-Click Trading closed position ${orderId} in full; a partial close needs it off`,
      );
    }
    await expect(dialog.root).toBeHidden();
    if (options.volume === undefined) {
      await expect(row, `position ${orderId} should leave the list`).toHaveCount(0);
    } else {
      // The platform may keep the Order No. with less volume or list the rest under a new one.
      await expect
        .poll(
          async () =>
            (await row.count()) === 0 ||
            (await row.getByTestId('asset-open-column-volume').innerText()).trim() !== volumeBefore,
          { message: `position ${orderId} should show the reduced volume` },
        )
        .toBe(true);
    }
  }
}

function toSide(text: string): Side {
  const side = text.trim().toUpperCase();
  if (side !== 'BUY' && side !== 'SELL') throw new Error(`Unexpected position type "${text}"`);
  return side;
}
