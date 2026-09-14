/**
 * Project-level dual-currency support.
 *
 * CANONICAL RULE: `itinerary_items.price` is ALWAYS a TWD integer, exactly as
 * every existing (and older) app version writes it. Local-currency amounts are
 * NEVER persisted — they are derived on the fly from
 * `price × project.exchangeRate`.
 *
 * exchange_rate definition (fixed): 1 TWD = exchange_rate × local currency.
 *
 * Every helper here is fail-safe: missing / null / non-positive / non-finite
 * rate => `null`, and callers fall back to the existing TWD-only UI.
 */

export interface CurrencyOption {
  code: string;
  symbol: string;
}

/** Common travel currencies offered in the picker (order matters for the UI). */
export const COMMON_CURRENCIES: CurrencyOption[] = [
  { code: "JPY", symbol: "¥" },
  { code: "KRW", symbol: "₩" },
  { code: "USD", symbol: "$" },
  { code: "EUR", symbol: "€" },
  { code: "GBP", symbol: "£" },
  { code: "CNY", symbol: "¥" },
  { code: "HKD", symbol: "HK$" },
  { code: "THB", symbol: "฿" },
  { code: "VND", symbol: "₫" },
  { code: "SGD", symbol: "S$" },
  { code: "MYR", symbol: "RM" },
  { code: "AUD", symbol: "A$" },
];

export interface ProjectCurrency {
  code: string;
  name: string;
  symbol: string;
  /** 1 TWD = rate × local currency. Guaranteed finite and > 0. */
  rate: number;
  isCustom: boolean;
}

/** Shape of the currency-related fields as stored on a project. */
export interface ProjectCurrencyFields {
  localCurrencyCode?: string | null;
  localCurrencyName?: string | null;
  localCurrencySymbol?: string | null;
  exchangeRate?: number | null;
  isCustomCurrency?: boolean | null;
}

/** Localized currency display name, e.g. JPY -> 日圓 / Japanese Yen. */
export function currencyDisplayName(code: string, locale?: string): string {
  if (!code) return "";
  try {
    const dn = new (Intl as any).DisplayNames([locale || "zh-TW"], { type: "currency" });
    return dn.of(code.toUpperCase()) || code.toUpperCase();
  } catch {
    return code.toUpperCase();
  }
}

/**
 * Returns the usable dual-currency config for a project, or `null` when the
 * project must stay TWD-only (old projects, incomplete custom currency,
 * invalid rate, ...).
 */
export function resolveProjectCurrency(
  project: ProjectCurrencyFields | null | undefined,
  locale?: string
): ProjectCurrency | null {
  if (!project) return null;

  const rawRate = project.exchangeRate;
  const rate = typeof rawRate === "number" ? rawRate : Number(rawRate);
  if (!Number.isFinite(rate) || rate <= 0) return null;

  const isCustom = !!project.isCustomCurrency;
  const code = (project.localCurrencyCode || "").trim();
  const name = (project.localCurrencyName || "").trim();
  const symbol = (project.localCurrencySymbol || "").trim();

  if (isCustom) {
    // Custom currency needs a display name and a symbol to be usable.
    const label = name || code;
    if (!label || !symbol) return null;
    return { code: code || label, name: label, symbol, rate, isCustom: true };
  }

  if (!code) return null;
  const known = COMMON_CURRENCIES.find((c) => c.code === code.toUpperCase());
  const finalSymbol = symbol || known?.symbol || code.toUpperCase();
  return {
    code: code.toUpperCase(),
    name: name || currencyDisplayName(code, locale),
    symbol: finalSymbol,
    rate,
    isCustom: false,
  };
}

/** TWD -> local currency. Display-only, rounded to an integer. */
export function twdToLocal(twd: number, rate: number): number {
  if (!Number.isFinite(twd) || !Number.isFinite(rate) || rate <= 0) return 0;
  const v = Math.round(twd * rate);
  return Number.isFinite(v) ? v : 0;
}

/** local currency -> TWD. Rounded to an integer to match the existing schema. */
export function localToTwd(local: number, rate: number): number {
  if (!Number.isFinite(local) || !Number.isFinite(rate) || rate <= 0) return 0;
  const v = Math.round(local / rate);
  return Number.isFinite(v) ? v : 0;
}

export function formatTwd(amount: number): string {
  const n = Number.isFinite(amount) ? amount : 0;
  return `NT$${n.toLocaleString()}`;
}

export function formatLocal(amount: number, symbol: string): string {
  const n = Number.isFinite(amount) ? amount : 0;
  return `${symbol}${n.toLocaleString()}`;
}

/** "NT$412 ≈ ¥1,998" */
export function formatDual(twd: number, currency: ProjectCurrency): string {
  return `${formatTwd(twd)} ≈ ${formatLocal(twdToLocal(twd, currency.rate), currency.symbol)}`;
}
