package com.peitravel.smartplanner;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Register the NativeBilling plugin BEFORE super.onCreate
        registerPlugin(NativeBillingPlugin.class);
        super.onCreate(savedInstanceState);
    }

    /**
     * Called when a deep link fires (both cold-start and existing activity).
     *
     * Handles TWO URL formats:
     * 1. intent:// URLs → tokens come as S. (String) extras
     * 2. Custom scheme URLs (com.peitravel.smartplanner://...) → tokens in query params
     *
     * For BOTH cases, we reconstruct the URL with tokens in query parameters
     * so Capacitor's appUrlOpen event can parse them reliably.
     * NOTE: We use query params (?key=val) NOT fragment (#key=val) because
     * Android/Chrome strips fragments from custom scheme URIs.
     */
    @Override
    protected void onNewIntent(Intent intent) {
        if (intent != null && intent.getData() != null) {
            String accessToken = null;
            String refreshToken = null;
            Uri originalData = intent.getData();

            // Method 1: Try intent extras (from intent:// URLs)
            accessToken = intent.getStringExtra("access_token");
            refreshToken = intent.getStringExtra("refresh_token");

            // Method 2: Try query parameters (from custom scheme URLs)
            if (accessToken == null || refreshToken == null) {
                accessToken = originalData.getQueryParameter("access_token");
                refreshToken = originalData.getQueryParameter("refresh_token");
            }

            // If we found tokens, reconstruct URL with query params for Capacitor
            if (accessToken != null && refreshToken != null) {
                String scheme = originalData.getScheme();
                String host = originalData.getHost();
                if (scheme == null) scheme = "com.peitravel.smartplanner";
                if (host == null) host = "oauth-callback";

                String reconstructedUrl = scheme + "://" + host
                    + "?access_token=" + Uri.encode(accessToken)
                    + "&refresh_token=" + Uri.encode(refreshToken);

                intent.setData(Uri.parse(reconstructedUrl));
            }
        }
        super.onNewIntent(intent);
    }
}
