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
  if (!isNativePlatform()) {
    console.log("[Billing] Web environment — native billing skipped");
    return;
  }
  console.log("[Billing] Native billing ready (direct StoreKit / Google Play)");
}

/**
 * Purchase pro_function — opens the NATIVE payment sheet.
 * Returns true on success.
 */
export async function purchasePro(): Promise<boolean> {
  if (!isNativePlatform()) {
    console.log("[Billing] Web — simulating purchase");
    setLocalProStatus(true);
    return true;
  }

  try {
    const result = await NativeBilling.purchase({ productId: PRODUCT_ID });
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
    console.error("[Billing] Purchase error:", error);
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
 * Check current entitlement (reads local cache; native re-validates on app launch)
 */
export async function checkEntitlements(): Promise<boolean> {
  return getLocalProStatus();
}
