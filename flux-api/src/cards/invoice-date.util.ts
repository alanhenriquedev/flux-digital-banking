export const INVOICE_CLOSING_DAY = 25;
export const INVOICE_DUE_DAY = 10;

export function computeClosingDate(now: Date): Date {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const isAfterClosing = now.getUTCDate() >= INVOICE_CLOSING_DAY;

  return isAfterClosing
    ? new Date(Date.UTC(year, month + 1, INVOICE_CLOSING_DAY))
    : new Date(Date.UTC(year, month, INVOICE_CLOSING_DAY));
}

export function computeDueDate(closing: Date): Date {
  return new Date(Date.UTC(closing.getUTCFullYear(), closing.getUTCMonth() + 1, INVOICE_DUE_DAY));
}