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

        // CRITICAL: Handle cold-start deep links BEFORE super.onCreate()
        // so Capacitor receives the reconstructed URL with tokens.
        // When the app is killed (common when Chrome Custom Tabs takes memory),
        // intent:// tokens are in extras, not in the URL. We must reconstruct
        // the URL before Capacitor processes the initial intent.
        handleOAuthIntent(getIntent());

        super.onCreate(savedInstanceState);
    }

    /**
     * Called when a deep link fires while the activity already exists.
     */
    @Override
    protected void onNewIntent(Intent intent) {
        handleOAuthIntent(intent);
        super.onNewIntent(intent);
    }

    /**
     * Extract OAuth tokens from Intent extras or query params and
     * reconstruct the URL so Capacitor's appUrlOpen can parse them.
     *
     * Handles TWO URL formats:
     * 1. intent:// URLs → tokens come as S. (String) extras
     * 2. Custom scheme URLs → tokens in query params
     *
     * For BOTH cases, reconstructs URL with tokens in query parameters.
     * Uses query params (?key=val) NOT fragment (#key=val) because
     * Android/Chrome strips fragments from custom scheme URIs.
     */
    private void handleOAuthIntent(Intent intent) {
        if (intent == null || intent.getData() == null) return;

        Uri originalData = intent.getData();
        String accessToken = null;
        String refreshToken = null;

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
}
