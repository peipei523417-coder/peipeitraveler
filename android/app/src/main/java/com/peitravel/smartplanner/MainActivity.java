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
     * Called when an intent:// deep link fires while the activity already exists.
     * 
     * The intent:// URL passes tokens as S. (String) extras because Android
     * strips URI fragments during intent parsing. We reconstruct the full URL
     * with tokens in the fragment so Capacitor's appUrlOpen event can parse them.
     */
    @Override
    protected void onNewIntent(Intent intent) {
        if (intent != null && intent.getData() != null) {
            String accessToken = intent.getStringExtra("access_token");
            String refreshToken = intent.getStringExtra("refresh_token");

            if (accessToken != null && refreshToken != null) {
                // Reconstruct URL with tokens in fragment for Capacitor to process
                Uri originalData = intent.getData();
                String scheme = originalData.getScheme();
                String host = originalData.getHost();
                if (scheme == null) scheme = "com.peitravel.smartplanner";
                if (host == null) host = "oauth-callback";

                String reconstructedUrl = scheme + "://" + host
                    + "#access_token=" + Uri.encode(accessToken)
                    + "&refresh_token=" + Uri.encode(refreshToken);

                intent.setData(Uri.parse(reconstructedUrl));
            }
        }
        super.onNewIntent(intent);
    }
}
