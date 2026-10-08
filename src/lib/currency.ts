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

// ---------------------------------------------------------------------------
// Original-amount bookkeeping (itinerary_items.original_amount & co).
// The original amount + currency + rate snapshot is the source of truth when
// present; `price` (TWD integer) is a compatibility mirror derived by the DB.
// ---------------------------------------------------------------------------

/** Fraction digits used for a currency. TWD is kept integer (app convention). */
export function currencyDecimals(code?: string | null): number {
  const c = (code || "").toUpperCase();
  if (!c || c === "TWD") return 0;
  if (c.length !== 3) return 2;
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency: c }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    return 2;
  }
}

/** Round half-away-from-zero to `d` decimals, robust against float noise. */
export function roundTo(n: number, d: number): number {
  if (!Number.isFinite(n)) return 0;
  const f = Math.pow(10, d);
  return Math.sign(n) * Math.round(Math.abs(n) * f + 1e-9) / f;
}

/** Parse user input like "7.92" without truncation; null when invalid/empty. */
export function parseAmountInput(value: string, decimals: number): number | null {
  const v = (value || "").trim().replace(/,/g, "");
  if (!v) return null;
  if (!/^\d*\.?\d*$/.test(v) || v === ".") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  return roundTo(n, decimals);
}

export function formatAmount(amount: number, decimals: number): string {
  const n = Number.isFinite(amount) ? amount : 0;
  return n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: decimals });
}

export interface AmountFields {
  price?: number | null;
  persons?: number | null;
  originalAmount?: number | null;
  originalCurrency?: string | null;
  exchangeRateSnapshot?: number | null;
}

function hasOriginal(i: AmountFields): boolean {
  return (
    typeof i.originalAmount === "number" && Number.isFinite(i.originalAmount) && i.originalAmount > 0 &&
    !!i.originalCurrency &&
    typeof i.exchangeRateSnapshot === "number" && i.exchangeRateSnapshot > 0
  );
}

/** Unrounded TWD value of an item (total, not per person). */
export function itemTwdExact(i: AmountFields): number {
  if (hasOriginal(i)) {
    if (i.originalCurrency!.toUpperCase() === "TWD") return i.originalAmount!;
    return i.originalAmount! / i.exchangeRateSnapshot!;
  }
  return typeof i.price === "number" && i.price > 0 ? i.price : 0;
}

/**
 * Unrounded amount of an item in the project's local currency. Items recorded
 * in that currency return their exact original amount (independent of later
 * project-rate changes); others convert their TWD value with the project rate.
 */
export function itemLocalExact(i: AmountFields, currency: ProjectCurrency): number {
  if (hasOriginal(i) && i.originalCurrency!.toUpperCase() === currency.code.toUpperCase()) {
    return i.originalAmount!;
  }
  return itemTwdExact(i) * currency.rate;
}

function personsOf(i: AmountFields): number {
  const p = Number(i.persons);
  return Number.isFinite(p) && p >= 1 ? p : 1;
}

export interface AmountTotals {
  /** Rounded TWD total (rounded once, at the end). */
  twd: number;
  /** Rounded local total, or null when the project is TWD-only. */
  local: number | null;
}

/** Per-person totals: per-item shares are summed exactly, rounded once. */
export function sumPerPerson(items: AmountFields[], currency: ProjectCurrency | null): AmountTotals {
  let twd = 0;
  let local = 0;
  for (const i of items) {
    const p = personsOf(i);
    twd += itemTwdExact(i) / p;
    if (currency) local += itemLocalExact(i, currency) / p;
  }
  return {
    twd: Math.round(roundTo(twd, 6)),
    local: currency ? roundTo(local, currencyDecimals(currency.code)) : null,
  };
}

/** Display numbers for a single item (total + per person). */
export function itemAmounts(i: AmountFields, currency: ProjectCurrency | null) {
  const p = personsOf(i);
  const twd = itemTwdExact(i);
  const dec = currency ? currencyDecimals(currency.code) : 0;
  const local = currency ? itemLocalExact(i, currency) : null;
  return {
    persons: p,
    twd: Math.round(roundTo(twd, 6)),
    twdPer: Math.round(roundTo(twd / p, 6)),
    local: local === null ? null : roundTo(local, dec),
    localPer: local === null ? null : roundTo(local / p, dec),
    decimals: dec,
  };
}
