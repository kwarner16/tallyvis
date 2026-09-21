/** A short, human-presentable stand-in for a quote's full database id — used on both the dashboard's quote detail page and the customer-facing quote view, so a customer and the business staring at the same quote see the same short number. */
export function formatQuoteNumber(id: string): string {
  return id.split("_").pop()?.slice(0, 8).toUpperCase() ?? id;
}
