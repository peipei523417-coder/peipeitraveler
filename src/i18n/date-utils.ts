import { format, Locale } from "date-fns";
import { zhTW, enUS, es, ko, ja } from "date-fns/locale";

const locales: Record<string, Locale> = {
  "zh-TW": zhTW,
  en: enUS,
  es: es,
  ko: ko,
  ja: ja,
};

// Date format patterns per locale
const dateFormats: Record<string, string> = {
  "zh-TW": "yyyy/MM/dd",
  en: "MM/dd/yyyy",
  es: "dd/MM/yyyy",
  ko: "yyyy.MM.dd",
  ja: "yyyy/MM/dd",
};

const shortDateFormats: Record<string, string> = {
  "zh-TW": "MM/dd",
  en: "MM/dd",
  es: "dd/MM",
  ko: "MM/dd",
  ja: "MM/dd",
};

export function getLocale(language: string): Locale {
  return locales[language] || zhTW;
}

export function formatDate(date: Date, language: string): string {
  const locale = getLocale(language);
  const formatStr = dateFormats[language] || "yyyy/MM/dd";
  return format(date, formatStr, { locale });
}

export function formatShortDate(date: Date, language: string): string {
  const locale = getLocale(language);
  const formatStr = shortDateFormats[language] || "MM/dd";
  return format(date, formatStr, { locale });
}

export function formatDayOfWeek(date: Date, language: string): string {
  const locale = getLocale(language);
  return format(date, "EEE", { locale });
}
