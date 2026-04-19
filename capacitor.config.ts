import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.peipeigo.travel',
  appName: 'PeiPeiGoTravel',
  webDir: 'dist',
  ios: {
    contentInset: 'automatic',
    scheme: 'PeiPeiGoTravel',
    zoomEnabled: true,
  },
  android: {
    allowMixedContent: true,
    zoomEnabled: true,
  }
};

export default config;
