# PeiTraveler Native App Setup Guide

## Basic Information

| Item | Value |
|------|-----|
| App ID | `com.peipeigo.travel` |
| App Name | `PeiPeiGoTravel` |
| Version Name | `1.0.76` |
| Version Code | `76` |

---

## Step 1: Local Setup

```bash
# 1. Pull latest code
git pull

# 2. Install dependencies
npm install

# 3. Add native platforms
npx cap add android
npx cap add ios

# 4. Build and sync
npm run build
npx cap sync
```

---

## Step 2: Android Setup

### 2.1 Version number (`android/app/build.gradle`)

Update the `defaultConfig` block:

```gradle
android {
    defaultConfig {
        applicationId "com.peitravel.smartplanner"
        versionCode 76
        versionName "1.0.76"
    }
}
```

### 2.2 Permissions (`android/app/src/main/AndroidManifest.xml`)

Add permissions inside `<manifest>`, before `<application>` (see `native-config/android-permissions.xml`).

---

## Step 3: iOS Setup

### 3.1 Version number (`ios/App/App.xcodeproj/project.pbxproj`)

```text
MARKETING_VERSION = 6.1.11;
CURRENT_PROJECT_VERSION = 36;
```

### 3.2 Permission descriptions (`ios/App/App/Info.plist`)

Add permission descriptions directly in `Info.plist` (see `native-config/ios-info-plist.xml`).

---

## Step 4: App Icon and Splash Screen

1. Place assets in the `resources/` folder:
   - `icon.png` (1024x1024)
   - `splash.png` (2732x2732)

2. Generate assets:
   ```bash
   npm install -g @capacitor/assets
   npx capacitor-assets generate
   ```

---

## Step 5: Privacy Policy

Use this URL for App Store / Google Play submission:

```
https://peipeigotravel.lovable.app/privacy-policy
```

---

## Run the App

```bash
# Android
npx cap run android

# iOS (requires Mac + Xcode)
npx cap run ios
```

---

## Release Preparation

Before release:
1. Remove any `server.url` setting from `capacitor.config.ts`.
2. Run `npm run build && npx cap sync`.
3. Generate fresh APK/AAB and IPA builds for each platform.
