package com.peitravel.smartplanner;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

/**
 * v1.0.36 — Simplified MainActivity.
 *
 * Deep link flow:
 * 1. Chrome Custom Tab redirects to com.peitravel.smartplanner://auth/callback?access_token=…
 * 2. Android resolves the intent to this activity (via AndroidManifest intent-filter).
 * 3. Capacitor receives the URL via appUrlOpen event.
 * 4. DeepLinkHandler in JS extracts tokens and calls setSession().
 *
 * No URL reconstruction needed — tokens are already in query parameters.
 */
public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Register billing plugin BEFORE super.onCreate
        registerPlugin(NativeBillingPlugin.class);
        super.onCreate(savedInstanceState);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
    }
}
