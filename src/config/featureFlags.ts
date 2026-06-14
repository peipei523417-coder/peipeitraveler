/**
 * Feature flags — central kill switches for major capabilities.
 *
 * NOTE on PRO / RevenueCat:
 *   The PRO architecture (RevenueCat init, billingService, ProContext,
 *   useProStatus, UpgradeProDialog, productId / entitlementId) is intentionally
 *   PRESERVED but disabled. Re-enabling it = flip ENABLE_PRO_FEATURES = true.
 */
export const ENABLE_PRO_FEATURES = false;

/** Free-tier limits (current "stable free" build). */
export const FREE_PROJECT_LIMIT = 4;
export const FREE_DAY_LIMIT = 20;

/** PRO-tier limits (kept for future re-enable). */
export const PRO_PROJECT_LIMIT = 20;
export const PRO_DAY_LIMIT = 20;

/** Days after a project's end_date before automatic deletion. */
export const PROJECT_RETENTION_DAYS = 7;
