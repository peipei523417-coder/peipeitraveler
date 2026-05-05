# PeiTraveler 原生 App 設定指南

## 基本資訊

| 項目 | 值 |
|------|-----|
| App ID | `com.peipeigo.travel` |
| App 名稱 | `PeiPeiGoTravel` |
| Version Name | `1.0.0` |
| Version Code | `1` |

---

## 第一步：本機設定

```bash
# 1. 拉取最新程式碼
git pull

# 2. 安裝依賴
npm install

# 3. 新增原生平台
npx cap add android
npx cap add ios

# 4. 建置並同步
npm run build
npx cap sync
```

---

## 第二步：Android 設定

### 2.1 版本號 (`android/app/build.gradle`)

找到 `defaultConfig` 區塊，修改：

```gradle
android {
    defaultConfig {
        applicationId "com.peipeigo.travel"
        versionCode 1
        versionName "1.0.0"
        // ... 其他設定
    }
}
```

### 2.2 權限 (`android/app/src/main/AndroidManifest.xml`)

在 `<manifest>` 內、`<application>` 前加入權限（參考 `native-config/android-permissions.xml`）。

---

## 第三步：iOS 設定

### 3.1 版本號 (`ios/App/App/Info.plist`)

```xml
<key>CFBundleShortVersionString</key>
<string>1.0.0</string>

<key>CFBundleVersion</key>
<string>1</string>
```

### 3.2 權限說明 (`ios/App/App/Info.plist`)

加入權限說明（參考 `native-config/ios-info-plist.xml`）。

---

## 第四步：App 圖示與啟動畫面

1. 將圖示放入 `resources/` 資料夾：
   - `icon.png` (1024x1024)
   - `splash.png` (2732x2732)

2. 執行自動產生：
   ```bash
   npm install -g @capacitor/assets
   npx capacitor-assets generate
   ```

---

## 第五步：隱私權政策

在 App Store / Google Play 提交時填入：

```
隱私權政策網址：https://peipeitraveler.lovable.app/privacy-policy
```

或在 App 內設定頁面加入此連結。

---

## 執行 App

```bash
# Android
npx cap run android

# iOS (需要 Mac + Xcode)
npx cap run ios
```

---

## 發布準備

發布前記得：
1. 移除 `capacitor.config.ts` 中的 `server.url` 設定
2. 執行 `npm run build && npx cap sync`
3. 在各平台產生正式版 APK/IPA
