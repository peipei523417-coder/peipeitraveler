/**
 * billingService.ts - Cross-platform In-App Purchase Service
 * 
 * Handles Apple App Store & Google Play billing via Capacitor plugin.
 * Product ID: pro_function
 * 
 * Security: No API keys stored in code. All payment flows use
 * native Apple/Google payment sheets exclusively.
 */

const PRODUCT_ID = "pro_function";
const PRO_STORAGE_KEY = "peipeigo_is_pro";

// Dynamic import to avoid errors on web
let PurchasesPlugin: any = null;

async function getPurchasesPlugin() {
  if (PurchasesPlugin) return PurchasesPlugin;
  try {
    const mod = await import("@capgo/capacitor-purchases");
    PurchasesPlugin = mod.CapacitorPurchases;
    return PurchasesPlugin;
  } catch {
    console.warn("[Billing] Native purchases plugin not available (web environment)");
    return null;
  }
}

/**
 * Check if running on a native platform (iOS/Android)
 */
function isNativePlatform(): boolean {
  return typeof (window as any)?.Capacitor !== "undefined" &&
    (window as any)?.Capacitor?.isNativePlatform?.() === true;
}

/**
 * Read PRO status from localStorage (instant, offline-capable)
 */
export function getLocalProStatus(): boolean {
  try {
    return localStorage.getItem(PRO_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

/**
 * Save PRO status to localStorage
 */
export function setLocalProStatus(isPro: boolean): void {
  try {
    localStorage.setItem(PRO_STORAGE_KEY, isPro ? "true" : "false");
  } catch {
    console.error("[Billing] Failed to save PRO status to localStorage");
  }
}

/**
 * Initialize the billing plugin (call once at app startup on native)
 */
export async function initBilling(): Promise<void> {
  if (!isNativePlatform()) {
    console.log("[Billing] Web environment — skipping native billing init");
    return;
  }

  try {
    const plugin = await getPurchasesPlugin();
    if (!plugin) return;
    
    // RevenueCat / native plugin will be configured in native layer
    // No API keys exposed in JS code
    console.log("[Billing] Native billing plugin initialized");
  } catch (error) {
    console.error("[Billing] Init error:", error);
  }
}

/**
 * Purchase the PRO subscription/product
 * Opens the native Apple/Google payment sheet — no custom UI
 * 
 * @returns true if purchase succeeded
 */
export async function purchasePro(): Promise<boolean> {
  if (!isNativePlatform()) {
    // Web fallback: simulate purchase for testing
    console.log("[Billing] Web environment — simulating purchase");
    setLocalProStatus(true);
    return true;
  }

  try {
    const plugin = await getPurchasesPlugin();
    if (!plugin) return false;

    // Get available packages
    const offerings = await plugin.getOfferings();
    const currentOffering = offerings?.current;
    
    if (!currentOffering) {
      console.error("[Billing] No offerings available");
      return false;
    }

    // Find the pro_function product
    const proPackage = currentOffering.availablePackages?.find(
      (pkg: any) => pkg.product?.identifier === PRODUCT_ID
    ) || currentOffering.availablePackages?.[0];

    if (!proPackage) {
      console.error("[Billing] Product not found:", PRODUCT_ID);
      return false;
    }

    // This opens the NATIVE payment sheet (Apple/Google)
    const result = await plugin.purchasePackage({ aPackage: proPackage });
    
    if (result?.customerInfo) {
      const isActive = Object.keys(result.customerInfo.entitlements?.active || {}).length > 0;
      if (isActive) {
        setLocalProStatus(true);
        return true;
      }
    }

    return false;
  } catch (error: any) {
    // User cancelled is not an error
    if (error?.code === "1" || error?.message?.includes("cancelled")) {
      console.log("[Billing] Purchase cancelled by user");
      return false;
    }
    console.error("[Billing] Purchase error:", error);
    return false;
  }
}

/**
 * Restore previous purchases — REQUIRED for iOS App Store review
 * Without this, Apple will reject the app.
 * 
 * @returns true if PRO entitlement was found and restored
 */
export async function restorePurchases(): Promise<boolean> {
  if (!isNativePlatform()) {
    // Web: check localStorage
    return getLocalProStatus();
  }

  try {
    const plugin = await getPurchasesPlugin();
    if (!plugin) return false;

    const result = await plugin.restorePurchases();
    
    if (result?.customerInfo) {
      const isActive = Object.keys(result.customerInfo.entitlements?.active || {}).length > 0;
      setLocalProStatus(isActive);
      return isActive;
    }

    return false;
  } catch (error) {
    console.error("[Billing] Restore error:", error);
    return false;
  }
}

/**
 * Check current entitlement status from the store
 */
export async function checkEntitlements(): Promise<boolean> {
  if (!isNativePlatform()) {
    return getLocalProStatus();
  }

  try {
    const plugin = await getPurchasesPlugin();
    if (!plugin) return getLocalProStatus();

    const info = await plugin.getCustomerInfo();
    
    if (info?.customerInfo) {
      const isActive = Object.keys(info.customerInfo.entitlements?.active || {}).length > 0;
      setLocalProStatus(isActive);
      return isActive;
    }

    return getLocalProStatus();
  } catch (error) {
    console.error("[Billing] Check entitlements error:", error);
    return getLocalProStatus();
  }
}
