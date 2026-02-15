/**
 * billingWeb.ts - Web fallback stub for NativeBilling plugin.
 * Used only during browser development / testing.
 */

import { WebPlugin } from "@capacitor/core";

export class NativeBillingWeb extends WebPlugin {
  async getProducts(_options: { productIds: string[] }) {
    console.log("[BillingWeb] getProducts (stub)");
    return { products: [{ productId: "pro_function", price: "$4.99" }] };
  }

  async purchase(_options: { productId: string }) {
    console.log("[BillingWeb] purchase (stub) — simulating success");
    return { success: true, transactionId: "web-test-" + Date.now() };
  }

  async restorePurchases() {
    console.log("[BillingWeb] restorePurchases (stub)");
    const isPro = localStorage.getItem("peipeigo_is_pro") === "true";
    return {
      purchases: isPro
        ? [{ productId: "pro_function", transactionId: "web-restored" }]
        : [],
    };
  }
}
