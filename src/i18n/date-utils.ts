import { format, Locale } from "date-fns";
import { enUS } from "date-fns/locale";

const locales: Record<string, Locale> = {
  en: enUS,
};

// Date format patterns per locale
const dateFormats: Record<string, string> = {
  en: "MM/dd/yyyy",
};

const shortDateFormats: Record<string, string> = {
  en: "MM/dd",
};

export function getLocale(language: string): Locale {
  return locales[language] || enUS;
}

export function formatDate(date: Date, language: string): string {
  const locale = getLocale(language);
  const formatStr = dateFormats[language] || "MM/dd/yyyy";
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
