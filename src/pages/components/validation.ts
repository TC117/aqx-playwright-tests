/**
 * Inline validation texts of the order panel and the Edit / Close dialogs, e.g. "Stop Loss must be
 * less than Sell Price.", "Please enter a valid volume." or "Minimum volume is 0.01.". Broad on
 * purpose: a check that no message is shown should also catch one that was not seen before.
 */
export const VALIDATION_TEXT = /must be|^Please enter|^(Minimum|Maximum) .+ is /;
