/** `text` with every regular-expression metacharacter escaped, e.g. for symbols like `US30.cash`. */
export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Regex matching exactly `text` (after trimming). */
export function exactly(text: string): RegExp {
  return new RegExp(`^\\s*${escapeRegExp(text)}\\s*$`);
}
