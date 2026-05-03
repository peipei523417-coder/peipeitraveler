package com.peitravel.smartplanner;

import android.util.Log;

import com.android.billingclient.api.*;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.ArrayList;
import java.util.List;

/**
 * NativeBillingPlugin - Direct Google Play Billing integration.
 * No RevenueCat, no third-party keys.
 * Product ID: pro_function
 */
@CapacitorPlugin(name = "NativeBilling")
public class NativeBillingPlugin extends Plugin implements PurchasesUpdatedListener {

    private static final String TAG = "NativeBilling";
    private BillingClient billingClient;
    private PluginCall pendingPurchaseCall;

    @Override
    public void load() {
        billingClient = BillingClient.newBuilder(getContext())
                .setListener(this)
                .enablePendingPurchases()
                .build();

        billingClient.startConnection(new BillingClientStateListener() {
            @Override
            public void onBillingSetupFinished(BillingResult result) {
                if (result.getResponseCode() == BillingClient.BillingResponseCode.OK) {
                    Log.i(TAG, "Google Play Billing connected");
                } else {
                    Log.e(TAG, "Billing setup failed: " + result.getDebugMessage());
                }
            }

            @Override
            public void onBillingServiceDisconnected() {
                Log.w(TAG, "Billing service disconnected");
            }
        });
    }

    // ── getProducts ─────────────────────────────────────────
    @PluginMethod
    public void getProducts(PluginCall call) {
        JSArray ids = call.getArray("productIds");
        if (ids == null) {
            call.reject("productIds is required");
            return;
        }

        List<QueryProductDetailsParams.Product> productList = new ArrayList<>();
        try {
            for (int i = 0; i < ids.length(); i++) {
                productList.add(
                    QueryProductDetailsParams.Product.newBuilder()
                        .setProductId(ids.getString(i))
                        .setProductType(BillingClient.ProductType.INAPP)
                        .build()
                );
            }
        } catch (Exception e) {
            call.reject("Invalid productIds", e);
            return;
        }

        QueryProductDetailsParams params = QueryProductDetailsParams.newBuilder()
                .setProductList(productList)
                .build();

        billingClient.queryProductDetailsAsync(params, (billingResult, productDetailsList) -> {
            if (billingResult.getResponseCode() != BillingClient.BillingResponseCode.OK) {
                call.reject("Query failed: " + billingResult.getDebugMessage());
                return;
            }
            JSObject ret = new JSObject();
            JSArray products = new JSArray();
            for (ProductDetails d : productDetailsList) {
                JSObject p = new JSObject();
                p.put("productId", d.getProductId());
                p.put("name", d.getName());
                p.put("description", d.getDescription());
                if (d.getOneTimePurchaseOfferDetails() != null) {
                    p.put("price", d.getOneTimePurchaseOfferDetails().getFormattedPrice());
                }
                products.put(p);
            }
            ret.put("products", products);
            call.resolve(ret);
        });
    }

    // ── purchase ────────────────────────────────────────────
    @PluginMethod
    public void purchase(PluginCall call) {
        String productId = call.getString("productId");
        if (productId == null) {
            call.reject("productId is required");
            return;
        }

        pendingPurchaseCall = call;

        List<QueryProductDetailsParams.Product> productList = new ArrayList<>();
        productList.add(
            QueryProductDetailsParams.Product.newBuilder()
                .setProductId(productId)
                .setProductType(BillingClient.ProductType.INAPP)
                .build()
        );

        QueryProductDetailsParams params = QueryProductDetailsParams.newBuilder()
                .setProductList(productList)
                .build();

        billingClient.queryProductDetailsAsync(params, (billingResult, productDetailsList) -> {
            if (billingResult.getResponseCode() != BillingClient.BillingResponseCode.OK
                    || productDetailsList.isEmpty()) {
                pendingPurchaseCall = null;
                call.reject("Product not found: " + productId);
                return;
            }

            ProductDetails details = productDetailsList.get(0);
            BillingFlowParams flowParams = BillingFlowParams.newBuilder()
                    .setProductDetailsParamsList(List.of(
                        BillingFlowParams.ProductDetailsParams.newBuilder()
                            .setProductDetails(details)
                            .build()
                    ))
                    .build();

            getActivity().runOnUiThread(() ->
                billingClient.launchBillingFlow(getActivity(), flowParams)
            );
        });
    }

    // ── PurchasesUpdatedListener callback ───────────────────
    @Override
    public void onPurchasesUpdated(BillingResult billingResult, List<Purchase> purchases) {
        if (pendingPurchaseCall == null) return;

        if (billingResult.getResponseCode() == BillingClient.BillingResponseCode.OK
                && purchases != null && !purchases.isEmpty()) {

            Purchase purchase = purchases.get(0);

            // Acknowledge the purchase (required by Google)
            if (purchase.getPurchaseState() == Purchase.PurchaseState.PURCHASED
                    && !purchase.isAcknowledged()) {
                AcknowledgePurchaseParams ackParams = AcknowledgePurchaseParams.newBuilder()
                        .setPurchaseToken(purchase.getPurchaseToken())
                        .build();
                billingClient.acknowledgePurchase(ackParams, ackResult -> {
                    Log.i(TAG, "Purchase acknowledged: " + ackResult.getResponseCode());
                });
            }

            JSObject ret = new JSObject();
            ret.put("success", true);
            ret.put("transactionId", purchase.getOrderId());
            pendingPurchaseCall.resolve(ret);

        } else if (billingResult.getResponseCode() == BillingClient.BillingResponseCode.USER_CANCELED) {
            pendingPurchaseCall.reject("cancel");
        } else {
            pendingPurchaseCall.reject("Purchase failed: " + billingResult.getDebugMessage());
        }

        pendingPurchaseCall = null;
    }

    // ── restorePurchases ────────────────────────────────────
    @PluginMethod
    public void restorePurchases(PluginCall call) {
        billingClient.queryPurchasesAsync(
            QueryPurchasesParams.newBuilder()
                .setProductType(BillingClient.ProductType.INAPP)
                .build(),
            (billingResult, purchaseList) -> {
                if (billingResult.getResponseCode() != BillingClient.BillingResponseCode.OK) {
                    call.reject("Restore failed: " + billingResult.getDebugMessage());
                    return;
                }

                JSObject ret = new JSObject();
                JSArray arr = new JSArray();
                for (Purchase p : purchaseList) {
                    if (p.getPurchaseState() == Purchase.PurchaseState.PURCHASED) {
                        for (String pid : p.getProducts()) {
                            JSObject item = new JSObject();
                            item.put("productId", pid);
                            item.put("transactionId", p.getOrderId());
                            arr.put(item);
                        }
                    }
                }
                ret.put("purchases", arr);
                call.resolve(ret);
            }
        );
    }
}
