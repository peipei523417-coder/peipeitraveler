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
} from "@revenuecat/purchases-capacitor";

export const PRODUCT_ID = "pro_function";
export const ENTITLEMENT_ID = "pro"; // RevenueCat dashboard entitlement identifier
const REQUIRED_OFFERING_ID = "default";
const ALLOWED_PACKAGE_IDS = new Set(["lifetime", "src_lifetime", "$rc_lifetime"]);
const LEGACY_PRO_STORAGE_KEY = "peipeigo_is_pro";

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
  purgeLegacyProCache();
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

/**
 * Ensure RevenueCat appUserID matches our auth user id.
 * Call this BEFORE purchase / restore / checkEntitlements.
 * Returns { before, after } for diagnostics.
 */
export async function ensureRevenueCatLogin(authUserId: string | null | undefined): Promise<{ before: string | null; after: string | null; loggedIn: boolean }> {
  if (!isNativePlatform()) return { before: null, after: null, loggedIn: false };
  await ensureConfigured();
  let before: string | null = null;
  try {
    const res = await Purchases.getAppUserID();
    before = res?.appUserID ?? null;
  } catch (e: any) {
    console.warn("[Billing][DIAG] getAppUserID failed:", e?.message || e);
  }
  if (!authUserId) {
    console.log("[Billing][DIAG] ensureRevenueCatLogin: no authUserId provided, current appUserID =", before);
    return { before, after: before, loggedIn: false };
  }
  if (before === authUserId) {
    console.log("[Billing][DIAG] ensureRevenueCatLogin: appUserID already matches authUserId =", authUserId);
    return { before, after: before, loggedIn: false };
  }
  try {
    const result = await Purchases.logIn({ appUserID: authUserId });
    console.log("[Billing][DIAG] Purchases.logIn called", JSON.stringify({
      authUserId,
      before,
      created: (result as any)?.created,
    }));
    let after: string | null = authUserId;
    try {
      const res = await Purchases.getAppUserID();
      after = res?.appUserID ?? authUserId;
    } catch {}
    return { before, after, loggedIn: true };
  } catch (e: any) {
    console.error("[Billing][DIAG] Purchases.logIn FAILED:", e?.message || e);
    return { before, after: before, loggedIn: false };
  }
}

// ── Helpers ─────────────────────────────────────────────────
function entitlementActive(info: CustomerInfo | undefined | null): boolean {
  const ent = info?.entitlements?.active?.[ENTITLEMENT_ID];
  return !!ent;
}

function enforceActiveProEntitlement(customerInfo: CustomerInfo | undefined | null, source: string): boolean {
  const active = entitlementActive(customerInfo);
  const activeKeys = Object.keys(customerInfo?.entitlements?.active || {});
  console.log("[Billing][DIAG]", source, "active entitlements:", activeKeys.join(",") || "(none)", "pro=", active);
  return active;
}

function purgeLegacyProCache(): void {
  try {
    localStorage.removeItem(LEGACY_PRO_STORAGE_KEY);
  } catch {
    /* ignore */
  }
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

    if (offerings.current?.identifier !== REQUIRED_OFFERING_ID) {
      console.warn(
        "[Billing][DIAG] Current offering is not default:",
        offerings.current?.identifier || "(none)"
      );
      return null;
    }

    const candidates = offerings.current?.availablePackages || [];

    const match = candidates.find(
      (p) => p?.product?.identifier === PRODUCT_ID && ALLOWED_PACKAGE_IDS.has(p.identifier)
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
      "in default offering packages lifetime/src_lifetime. Available packages:",
      candidates.map((p) => `${p.identifier}:${p.product?.identifier}`).join(", ") || "(none)"
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

/** 收集 offerings/packages/products 完整診斷資訊（給 UI 顯示用） */
export async function collectBillingDiagnostics(): Promise<string> {
  try {
    await ensureConfigured();
    const offerings = await Purchases.getOfferings();
    const currentId = offerings.current?.identifier ?? "(none)";
    const allKeys = Object.keys(offerings.all || {});
    const currentPkgs = (offerings.current?.availablePackages || []).map((p) => ({
      pkg: p.identifier,
      product: p.product?.identifier,
      price: p.product?.priceString,
    }));
    const allPkgs: any[] = [];
    for (const k of allKeys) {
      const o = offerings.all[k];
      for (const p of o?.availablePackages || []) {
        allPkgs.push({ offering: k, pkg: p.identifier, product: p.product?.identifier });
      }
    }
    let entitlements: string[] = [];
    try {
      const { customerInfo } = await Purchases.getCustomerInfo();
      entitlements = Object.keys(customerInfo?.entitlements?.active || {});
    } catch { /* ignore */ }
    let products: any[] = [];
    try {
      const result = await Purchases.getProducts({ productIdentifiers: [PRODUCT_ID] });
      products = (result.products || []).map((p) => ({
        product: p.identifier,
        price: p.priceString,
      }));
    } catch { /* ignore */ }
    return JSON.stringify({
      PRODUCT_ID,
      ENTITLEMENT_ID,
      currentOffering: currentId,
      offerings: allKeys,
      currentPackages: currentPkgs,
      allPackages: allPkgs,
      products,
      activeEntitlements: entitlements,
    }, null, 2);
  } catch (err: any) {
    return `diagnostics failed: ${err?.message || err}`;
  }
}

/** 購買 pro_function — 開啟原生付款表單；回傳 true 表示已取得 entitlement */
export async function purchasePro(opts?: { onAlreadyOwned?: () => void; authUserId?: string | null }): Promise<boolean> {
  if (!isNativePlatform()) {
    throw new BillingError("購買僅在 iOS / Android App 中可用", "WEB_NOT_SUPPORTED");
  }
  await ensureConfigured();
  const loginInfo = await ensureRevenueCatLogin(opts?.authUserId ?? null);
  console.log("[Billing][DIAG] purchasePro login:", JSON.stringify({ platform: getPlatform(), authUserId: opts?.authUserId ?? null, ...loginInfo }));

  const pkg = await getProPackage();
  if (pkg) {
    console.log("[Billing][DIAG] purchasePackage called:", JSON.stringify({
      pkg: pkg.identifier,
      product: pkg.product?.identifier,
      offering: (pkg as any).offeringIdentifier,
    }));
    try {
      const { customerInfo } = await Purchases.purchasePackage({ aPackage: pkg });
      await logCustomerInfoDiagnostics("purchasePackage success", customerInfo);
      const ok = enforceActiveProEntitlement(customerInfo, "purchasePackage success");
      return ok;
    } catch (err: any) {
      // Code 6 = PRODUCT_ALREADY_PURCHASED_ERROR, Code 7 = RECEIPT_ALREADY_IN_USE
      // Also catch ITEM_ALREADY_OWNED string codes from Google Play
      const code = err?.code ?? err?.errorCode;
      const msg = String(err?.message || err || "");
      const isAlreadyOwned =
        code === "6" || code === 6 ||
        code === "7" || code === 7 ||
        code === PURCHASES_ERROR_CODE?.PRODUCT_ALREADY_PURCHASED_ERROR ||
        code === PURCHASES_ERROR_CODE?.RECEIPT_ALREADY_IN_USE_ERROR ||
        /already\s*active|already\s*purchased|ITEM_ALREADY_OWNED/i.test(msg);
      if (isAlreadyOwned) {
        console.warn("[Billing][DIAG] PRODUCT_ALREADY_PURCHASED detected — auto restoring/syncing");
        try { opts?.onAlreadyOwned?.(); } catch {}
        const restored = await syncAndRestoreEntitlement(opts?.authUserId ?? null);
        if (restored) return true;
        throw new BillingError(
          `Google Play 顯示此商品已購買，但目前尚未同步到 PRO 權益。請確認手機 Play 商店帳號與 App 登入帳號一致，或重新登入後再恢復購買。`,
          "ALREADY_PURCHASED_RESTORE_FAILED"
        );
      }
      handlePurchaseError(err);
    }
  }

  const diag = await collectBillingDiagnostics();
  const msg = `找不到可購買的 package（offering=default / package=lifetime|src_lifetime / product=${PRODUCT_ID}）。未取得 RevenueCat active entitlement="${ENTITLEMENT_ID}" 前不會解鎖 PRO。\n\n[診斷]\n${diag}`;
  console.error("[Billing][DIAG]", msg);
  throw new BillingError(msg, "PACKAGE_NOT_FOUND");
}

/** 嘗試 syncPurchases (Android) + restorePurchases，回傳是否取得 entitlement="pro" */
async function syncAndRestoreEntitlement(): Promise<boolean> {
  const platform = getPlatform();
  // Android: syncPurchases asks Google Play for any owned items not yet known to RC
  if (platform === "android") {
    try {
      await Purchases.syncPurchases();
      console.log("[Billing][DIAG] syncPurchases() ok (android)");
    } catch (e: any) {
      console.warn("[Billing][DIAG] syncPurchases failed:", e?.message || e);
    }
  }
  try {
    const { customerInfo } = await Purchases.restorePurchases();
    await logCustomerInfoDiagnostics("restorePurchases (auto after code=6)", customerInfo);
    if (entitlementActive(customerInfo)) return true;
  } catch (e: any) {
    console.warn("[Billing][DIAG] restorePurchases (auto) failed:", e?.message || e);
  }
  // Final: re-fetch customerInfo
  try {
    const { customerInfo } = await Purchases.getCustomerInfo();
    await logCustomerInfoDiagnostics("getCustomerInfo (auto after code=6)", customerInfo);
    return entitlementActive(customerInfo);
  } catch (e: any) {
    console.warn("[Billing][DIAG] getCustomerInfo (auto) failed:", e?.message || e);
    return false;
  }
}

async function logCustomerInfoDiagnostics(source: string, info: CustomerInfo | undefined | null) {
  try {
    const active = info?.entitlements?.active || {};
    console.log("[Billing][DIAG]", source, JSON.stringify({
      PRODUCT_ID,
      ENTITLEMENT_ID,
      appUserId: (info as any)?.originalAppUserId ?? null,
      originalAppUserId: (info as any)?.originalAppUserId ?? null,
      activeEntitlements: Object.keys(active),
      activeProDetail: active[ENTITLEMENT_ID] ? {
        productIdentifier: (active[ENTITLEMENT_ID] as any)?.productIdentifier,
        isActive: (active[ENTITLEMENT_ID] as any)?.isActive,
        willRenew: (active[ENTITLEMENT_ID] as any)?.willRenew,
      } : null,
    }));
  } catch {}
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
  if (!isNativePlatform()) return false;
  await ensureConfigured();
  try {
    const { customerInfo } = await Purchases.restorePurchases();
    const ok = enforceActiveProEntitlement(customerInfo, "restorePurchases");
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
    const ok = enforceActiveProEntitlement(customerInfo, "getCustomerInfo");
    return ok;
  } catch (err: any) {
    console.error("[Billing][DIAG] checkEntitlements error:", err?.message || err, err);
    return false;
  }
}
