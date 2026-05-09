/**
 * billingService.ts — RevenueCat-based IAP (iOS + Android)
 *
 * 取代舊的 NativeBilling 自製 Capacitor plugin。
 * Product ID 維持: pro_function
 * Entitlement 名稱建議: pro (在 RevenueCat dashboard 設定，把 pro_function 掛到 "pro" entitlement)
 *
 * 公開 SDK key（appl_... / goog_...）為 publishable key，可直接放程式碼/env。
 * 透過 Vite env 注入：
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

// ⚠️ 把你的 RevenueCat **public** SDK key 填在這裡（appl_xxx / goog_xxx）。
// 這些是 publishable key，可以安全放在前端程式碼中。
// 取得位置：RevenueCat dashboard → Project settings → API keys → Public SDK keys
// 也可改用 Vite env：VITE_REVENUECAT_IOS_KEY / VITE_REVENUECAT_ANDROID_KEY
const IOS_API_KEY =
  (import.meta as any).env?.VITE_REVENUECAT_IOS_KEY || ""; // ← 例如 "appl_xxxxxxxxxxxxxxxxxxxxxxxx"
const ANDROID_API_KEY =
  (import.meta as any).env?.VITE_REVENUECAT_ANDROID_KEY || ""; // ← 例如 "goog_xxxxxxxxxxxxxxxxxxxxxxxx"

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

// ── Cache helpers (僅 UI 加速顯示，不作為權限判斷依據) ────────
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
        `缺少 RevenueCat ${platform.toUpperCase()} API Key（VITE_REVENUECAT_${platform.toUpperCase()}_KEY）`,
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
        `RevenueCat 初始化失敗：${err?.message || err}`,
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

/** 嘗試找出 pro_function 的 package；找不到則回傳 null */
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
      `取得商品資訊失敗：${err?.message || err}`,
      err?.code || "FETCH_OFFERINGS_FAILED"
    );
  }
}

/** 直接抓商品資訊（fallback 用） */
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

/** 購買 pro_function — 開啟原生付款表單；回傳 true 表示已取得 entitlement */
export async function purchasePro(): Promise<boolean> {
  if (!isNativePlatform()) {
    throw new BillingError("購買僅在 iOS / Android App 中可用", "WEB_NOT_SUPPORTED");
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

  // Fallback：嘗試直接用 productId 購買（部分版本支援）
  const product = await getProductDetails();
  if (!product) {
    const msg = `找不到商品 ${PRODUCT_ID}，請確認 App Store Connect / Google Play Console 與 RevenueCat dashboard 的 Product ID 是否一致`;
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
  const code = err?.code ?? err?.errorCode;
  const msg = err?.message || String(err);
  const underlying =
    err?.underlyingErrorMessage ||
    err?.underlyingError?.message ||
    err?.underlyingError ||
    err?.readableErrorCode ||
    null;
  console.error(
    "[Billing][DIAG] Purchase error:",
    JSON.stringify({
      code,
      message: msg,
      readableErrorCode: err?.readableErrorCode,
      underlyingError: underlying,
      userCancelled: err?.userCancelled,
      raw: (() => {
        try { return JSON.parse(JSON.stringify(err)); } catch { return String(err); }
      })(),
    })
  );
  if (
    code === PURCHASES_ERROR_CODE?.PURCHASE_CANCELLED_ERROR ||
    err?.userCancelled === true ||
    /cancel/i.test(msg)
  ) {
    throw new BillingError("使用者取消購買", PURCHASE_CANCELLED);
  }
  const detail = [
    `購買失敗：${msg}`,
    code != null ? `code=${code}` : null,
    err?.readableErrorCode ? `readable=${err.readableErrorCode}` : null,
    underlying ? `underlying=${typeof underlying === "string" ? underlying : JSON.stringify(underlying)}` : null,
  ]
    .filter(Boolean)
    .join(" | ");
  throw new BillingError(detail, code != null ? String(code) : "PURCHASE_FAILED");
}

/** 恢復購買 — App Store 審查必備 */
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
      `恢復購買失敗：${msg}${code ? ` (code: ${code})` : ""}`,
      code || "RESTORE_FAILED"
    );
  }
}

/** 檢查目前 entitlement 狀態 — 唯一可信的 PRO 判斷依據 */
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
