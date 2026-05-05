/**
 * billingService.ts — RevenueCat-based IAP (iOS + Android)
 *
 * Replaces the legacy custom NativeBilling Capacitor plugin.
 * Product ID remains: pro_function
 * Recommended entitlement name: pro (map pro_function to the "pro" entitlement in RevenueCat).
 *
 * Public SDK keys (appl_... / goog_...) are publishable keys and can live in code/env.
 * Inject through Vite env:
 *   VITE_REVENUECAT_IOS_KEY
 *   VITE_REVENUECAT_ANDROID_KEY
 */

import {
  Purchases,
  LOG_LEVEL,
  PURCHASES_ERROR_CODE,
  type CustomerInfo,
  type PurchasesPackage,
  type PurchasesStoreProduct,
} from "@revenuecat/purchases-capacitor";

export const PRODUCT_ID = "pro_function";
export const ENTITLEMENT_ID = "pro"; // RevenueCat dashboard entitlement identifier
const PRO_STORAGE_KEY = "peipeigo_is_pro";

// Place your RevenueCat public SDK keys here (appl_xxx / goog_xxx).
// These are publishable keys and are safe for frontend code.
// Location: RevenueCat dashboard → Project settings → API keys → Public SDK keys
// You may also use Vite env: VITE_REVENUECAT_IOS_KEY / VITE_REVENUECAT_ANDROID_KEY
const IOS_API_KEY =
  (import.meta as any).env?.VITE_REVENUECAT_IOS_KEY || ""; // e.g. "appl_xxxxxxxxxxxxxxxxxxxxxxxx"
const ANDROID_API_KEY =
  (import.meta as any).env?.VITE_REVENUECAT_ANDROID_KEY || ""; // e.g. "goog_xxxxxxxxxxxxxxxxxxxxxxxx"

let configured = false;
let configuring: Promise<void> | null = null;

// ── Errors ──────────────────────────────────────────────────
export class BillingError extends Error {
  code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.name = "BillingError";
    this.code = code;
  }
}
export const PURCHASE_CANCELLED = "PURCHASE_CANCELLED";

// Cache helpers (UI speed only; not an authorization source)
export function getLocalProStatus(): boolean {
  try {
    return localStorage.getItem(PRO_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}
export function setLocalProStatus(isPro: boolean): void {
  try {
    localStorage.setItem(PRO_STORAGE_KEY, isPro ? "true" : "false");
  } catch {
    /* ignore */
  }
}

// ── Platform detection ──────────────────────────────────────
function isNativePlatform(): boolean {
  return (
    typeof (window as any)?.Capacitor !== "undefined" &&
    (window as any)?.Capacitor?.isNativePlatform?.() === true
  );
}
function getPlatform(): "ios" | "android" | "web" {
  const cap = (window as any)?.Capacitor;
  const p = cap?.getPlatform?.();
  if (p === "ios" || p === "android") return p;
  return "web";
}

// ── Configure ───────────────────────────────────────────────
export async function initBilling(): Promise<void> {
  console.log("[Billing][DIAG] PRODUCT_ID =", PRODUCT_ID, " ENTITLEMENT =", ENTITLEMENT_ID);
  if (!isNativePlatform()) {
    console.log("[Billing] Web environment — RevenueCat skipped");
    return;
  }
  if (configured) return;
  if (configuring) return configuring;

  configuring = (async () => {
    const platform = getPlatform();
    const apiKey = platform === "ios" ? IOS_API_KEY : ANDROID_API_KEY;

    if (!apiKey) {
      console.error(
        "[Billing][DIAG] Missing RevenueCat API key for",
        platform,
        "— set VITE_REVENUECAT_IOS_KEY / VITE_REVENUECAT_ANDROID_KEY in .env"
      );
      throw new BillingError(
        `Missing RevenueCat ${platform.toUpperCase()} API key (VITE_REVENUECAT_${platform.toUpperCase()}_KEY)`,
        "MISSING_RC_KEY"
      );
    }

    try {
      await Purchases.setLogLevel({ level: LOG_LEVEL.DEBUG });
      await Purchases.configure({ apiKey });
      configured = true;
      console.log("[Billing][DIAG] RevenueCat configured for", platform);
    } catch (err: any) {
      console.error("[Billing][DIAG] RevenueCat configure ERROR:", err?.message || err, err);
      throw new BillingError(
        `RevenueCat initialization failed: ${err?.message || err}`,
        err?.code || "RC_CONFIGURE_FAILED"
      );
    }
  })();

  try {
    await configuring;
  } finally {
    configuring = null;
  }
}

async function ensureConfigured() {
  if (!configured) await initBilling();
}

// ── Helpers ─────────────────────────────────────────────────
function entitlementActive(info: CustomerInfo | undefined | null): boolean {
  const ent = info?.entitlements?.active?.[ENTITLEMENT_ID];
  return !!ent;
}

// ── Public API ──────────────────────────────────────────────

/** Try to find the pro_function package; return null when not found. */
export async function getProPackage(): Promise<PurchasesPackage | null> {
  await ensureConfigured();
  try {
    const offerings = await Purchases.getOfferings();
    console.log(
      "[Billing][DIAG] offerings:",
      JSON.stringify({
        current: offerings.current?.identifier,
        allKeys: Object.keys(offerings.all || {}),
      })
    );

    const candidates: PurchasesPackage[] = [];
    if (offerings.current?.availablePackages?.length) {
      candidates.push(...offerings.current.availablePackages);
    }
    for (const key of Object.keys(offerings.all || {})) {
      const o = offerings.all[key];
      if (o?.availablePackages) candidates.push(...o.availablePackages);
    }

    const match = candidates.find(
      (p) => p?.product?.identifier === PRODUCT_ID
    );
    if (match) {
      console.log(
        "[Billing][DIAG] matched package:",
        match.identifier,
        "product:",
        match.product.identifier,
        "price:",
        match.product.priceString
      );
      return match;
    }
    console.warn(
      "[Billing][DIAG] No package matching",
      PRODUCT_ID,
      "in offerings. Available products:",
      candidates.map((p) => p.product?.identifier).join(", ") || "(none)"
    );
    return null;
  } catch (err: any) {
    console.error("[Billing][DIAG] getOfferings ERROR:", err?.message || err, err);
    throw new BillingError(
      `Failed to fetch product information: ${err?.message || err}`,
      err?.code || "FETCH_OFFERINGS_FAILED"
    );
  }
}

/** Fetch product details directly for fallback. */
export async function getProductDetails(): Promise<PurchasesStoreProduct | null> {
  await ensureConfigured();
  try {
    const result = await Purchases.getProducts({ productIdentifiers: [PRODUCT_ID] });
    console.log("[Billing][DIAG] getProducts result:", JSON.stringify(result));
    return result.products?.[0] || null;
  } catch (err: any) {
    console.error("[Billing][DIAG] getProducts ERROR:", err?.message || err, err);
    return null;
  }
}

/** Purchase pro_function through the native purchase sheet; true means entitlement is active. */
export async function purchasePro(): Promise<boolean> {
  if (!isNativePlatform()) {
    throw new BillingError("Purchases are only available in the iOS / Android app", "WEB_NOT_SUPPORTED");
  }
  await ensureConfigured();

  const pkg = await getProPackage();
  if (pkg) {
    try {
      const { customerInfo } = await Purchases.purchasePackage({ aPackage: pkg });
      const ok = entitlementActive(customerInfo);
      console.log("[Billing][DIAG] purchasePackage success, entitlement active =", ok);
      setLocalProStatus(ok);
      return ok;
    } catch (err: any) {
      handlePurchaseError(err);
    }
  }

  // Fallback: try purchasing directly by productId when supported.
  const product = await getProductDetails();
  if (!product) {
    const msg = `Product ${PRODUCT_ID} was not found. Confirm the Product ID matches in App Store Connect / Google Play Console and RevenueCat.`;
    console.error("[Billing][DIAG]", msg);
    throw new BillingError(msg, "PRODUCT_NOT_FOUND");
  }
  try {
    const { customerInfo } = await Purchases.purchaseStoreProduct({ product });
    const ok = entitlementActive(customerInfo);
    console.log("[Billing][DIAG] purchaseStoreProduct success, entitlement active =", ok);
    setLocalProStatus(ok);
    return ok;
  } catch (err: any) {
    handlePurchaseError(err);
  }
  return false;
}

function handlePurchaseError(err: any): never {
  const code = err?.code || err?.errorCode;
  const msg = err?.message || String(err);
  console.error("[Billing][DIAG] Purchase error:", msg, "code:", code, err);
  if (
    code === PURCHASES_ERROR_CODE?.PURCHASE_CANCELLED_ERROR ||
    err?.userCancelled === true ||
    /cancel/i.test(msg)
  ) {
    throw new BillingError("User cancelled purchase", PURCHASE_CANCELLED);
  }
  throw new BillingError(
    `Purchase failed: ${msg}${code ? ` (code: ${code})` : ""}`,
    code || "PURCHASE_FAILED"
  );
}

/** Restore purchases — required for App Store review. */
export async function restorePurchases(): Promise<boolean> {
  if (!isNativePlatform()) return getLocalProStatus();
  await ensureConfigured();
  try {
    const { customerInfo } = await Purchases.restorePurchases();
    const ok = entitlementActive(customerInfo);
    console.log("[Billing][DIAG] restorePurchases entitlement active =", ok);
    setLocalProStatus(ok);
    return ok;
  } catch (err: any) {
    const code = err?.code || err?.errorCode;
    const msg = err?.message || String(err);
    console.error("[Billing][DIAG] Restore error:", msg, "code:", code, err);
    throw new BillingError(
      `Restore purchases failed: ${msg}${code ? ` (code: ${code})` : ""}`,
      code || "RESTORE_FAILED"
    );
  }
}

/** Check current entitlement status — the only trusted PRO source. */
export async function checkEntitlements(): Promise<boolean> {
  if (!isNativePlatform()) return false;
  try {
    await ensureConfigured();
    const { customerInfo } = await Purchases.getCustomerInfo();
    const ok = entitlementActive(customerInfo);
    setLocalProStatus(ok);
    return ok;
  } catch (err: any) {
    console.error("[Billing][DIAG] checkEntitlements error:", err?.message || err, err);
    return false;
  }
}
