/**
 * billingService.ts - Direct Native Billing (No RevenueCat)
 *
 * Connects directly to Apple StoreKit / Google Play Billing
 * via a custom Capacitor plugin — zero third-party keys required.
 *
 * Product ID: pro_function
 */

import { registerPlugin } from "@capacitor/core";

const PRODUCT_ID = "pro_function";
const PRO_STORAGE_KEY = "peipeigo_is_pro";

// ── Custom native plugin interface ──────────────────────────
interface NativeBillingPlugin {
  /** Fetch product details from the store */
  getProducts(options: { productIds: string[] }): Promise<{ products: any[] }>;
  /** Launch the native payment sheet for a product */
  purchase(options: { productId: string }): Promise<{ success: boolean; transactionId?: string }>;
  /** Query the store for previously completed purchases */
  restorePurchases(): Promise<{ purchases: { productId: string; transactionId: string }[] }>;
}

/**
 * Register the plugin — on native it calls Swift/Kotlin,
 * on web it falls back to the stub below.
 */
const NativeBilling = registerPlugin<NativeBillingPlugin>("NativeBilling", {
  web: () => import("./billingWeb").then((m) => new m.NativeBillingWeb()),
});

// ── LocalStorage helpers ────────────────────────────────────
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
    console.error("[Billing] Failed to persist PRO status");
  }
}

// ── Platform detection ──────────────────────────────────────
function isNativePlatform(): boolean {
  return (
    typeof (window as any)?.Capacitor !== "undefined" &&
    (window as any)?.Capacitor?.isNativePlatform?.() === true
  );
}

// ── Public API ──────────────────────────────────────────────

/** No-op on web; native plugin self-initialises */
export async function initBilling(): Promise<void> {
  console.log("[Billing][DIAG] Configured PRODUCT_ID =", PRODUCT_ID);
  if (!isNativePlatform()) {
    console.log("[Billing] Web environment — native billing skipped");
    return;
  }
  console.log("[Billing] Native billing ready (direct StoreKit / Google Play)");
  // Probe the store on startup to verify product availability
  try {
    const probe = await NativeBilling.getProducts({ productIds: [PRODUCT_ID] });
    console.log("[Billing][DIAG] fetchProducts result:", JSON.stringify(probe));
    if (!probe?.products || probe.products.length === 0) {
      console.warn("[Billing][DIAG] Store returned 0 products for", PRODUCT_ID,
        "— check App Store Connect / Play Console: product exists, status=Ready/Approved, agreements signed, sandbox tester, bundle id matches.");
    } else {
      console.log("[Billing][DIAG] Store returned", probe.products.length, "product(s):",
        probe.products.map((p: any) => `${p.productId} (${p.price ?? "no price"})`).join(", "));
    }
  } catch (err: any) {
    console.error("[Billing][DIAG] fetchProducts ERROR:", err?.message || err, err);
  }
}

/**
 * Purchase pro_function — opens the NATIVE payment sheet.
 * Returns true on success.
 */
export async function purchasePro(): Promise<boolean> {
  console.log("[Billing][DIAG] purchasePro() invoked with PRODUCT_ID =", PRODUCT_ID);
  if (!isNativePlatform()) {
    console.log("[Billing] Web — purchases only available on iOS/Android");
    return false;
  }

  // Pre-flight: verify the store actually knows this product
  try {
    const probe = await NativeBilling.getProducts({ productIds: [PRODUCT_ID] });
    console.log("[Billing][DIAG] pre-purchase fetchProducts:", JSON.stringify(probe));
    if (!probe?.products || probe.products.length === 0) {
      console.error("[Billing][DIAG] Cannot purchase — store has no product for ID:", PRODUCT_ID);
    }
  } catch (err: any) {
    console.error("[Billing][DIAG] pre-purchase fetchProducts ERROR:", err?.message || err, err);
  }

  try {
    const result = await NativeBilling.purchase({ productId: PRODUCT_ID });
    console.log("[Billing][DIAG] purchase result:", JSON.stringify(result));
    if (result.success) {
      setLocalProStatus(true);
      return true;
    }
    return false;
  } catch (error: any) {
    if (error?.message?.includes("cancel")) {
      console.log("[Billing] Purchase cancelled by user");
      return false;
    }
    console.error("[Billing][DIAG] Purchase error:", error?.message || error, error);
    return false;
  }
}

/**
 * Restore purchases — REQUIRED for iOS App Store review.
 * Queries the store for historical receipts of pro_function.
 */
export async function restorePurchases(): Promise<boolean> {
  if (!isNativePlatform()) {
    return getLocalProStatus();
  }

  try {
    const result = await NativeBilling.restorePurchases();
    const hasPro = result.purchases.some((p) => p.productId === PRODUCT_ID);
    setLocalProStatus(hasPro);
    return hasPro;
  } catch (error) {
    console.error("[Billing] Restore error:", error);
    return false;
  }
}

/**
 * Check current entitlement — verified via native store only.
 * localStorage is NOT trusted as a source of PRO entitlement.
 * On web, always returns false (no native receipts available).
 * On native, queries the store for an active pro_function purchase.
 */
export async function checkEntitlements(): Promise<boolean> {
  if (!isNativePlatform()) {
    return false;
  }
  try {
    const result = await NativeBilling.restorePurchases();
    const hasPro = result.purchases.some((p) => p.productId === PRODUCT_ID);
    setLocalProStatus(hasPro);
    return hasPro;
  } catch (error) {
    console.error("[Billing] checkEntitlements error:", error);
    return false;
  }
}
