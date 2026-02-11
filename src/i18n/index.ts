import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { translations, languageNames, SupportedLanguage } from "./translations";

// Smart language detection with region awareness
function getDefaultLanguage(): SupportedLanguage {
  const browserLang = navigator.language || "en";
  
  // Check for exact match first (e.g., zh-TW)
  const exactMatch = Object.keys(languageNames).find(
    (lang) => browserLang.toLowerCase().startsWith(lang.toLowerCase())
  );
  if (exactMatch) return exactMatch as SupportedLanguage;
  
  // Check for language code match (e.g., zh -> zh-TW, en -> en)
  const langCode = browserLang.split("-")[0].toLowerCase();
  
  // Map common language codes to our supported languages
  const langMap: Record<string, SupportedLanguage> = {
    zh: "zh-TW",
    en: "en",
    es: "es",
    ko: "ko",
    ja: "ja",
    fr: "fr",
    de: "de",
  };
  
  if (langMap[langCode]) return langMap[langCode];
  
  // Default to English for unsupported languages
  return "en";
}

// Get stored language or detect from browser
function getInitialLanguage(): SupportedLanguage {
  const stored = localStorage.getItem("i18nextLng");
  if (stored && Object.keys(languageNames).includes(stored)) {
    return stored as SupportedLanguage;
  }
  return getDefaultLanguage();
}

i18n
  .use(initReactI18next)
  .init({
    resources: translations,
    lng: getInitialLanguage(),
    fallbackLng: "en",
    interpolation: {
      escapeValue: false,
    },
  });

// Save language preference when changed
i18n.on("languageChanged", (lng) => {
  localStorage.setItem("i18nextLng", lng);
});

export default i18n;
