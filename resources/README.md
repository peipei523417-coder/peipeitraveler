# App 圖示與啟動畫面資源

請將以下圖片放入此資料夾：

## App Icon (應用程式圖示)

- `icon.png` - 1024x1024 像素，PNG 格式，無透明背景

## Splash Screen (啟動畫面)

- `splash.png` - 2732x2732 像素，PNG 格式，圖示置中

## 使用方式

放入圖片後，在專案根目錄執行：

```bash
npm install -g @capacitor/assets
npx capacitor-assets generate
```

這會自動產生所有尺寸的圖示和啟動畫面。

## 資料夾結構

放置完成後，結構應如下：

```
resources/
├── icon.png          # 主要圖示 (1024x1024)
├── splash.png        # 啟動畫面 (2732x2732)
└── README.md
```
