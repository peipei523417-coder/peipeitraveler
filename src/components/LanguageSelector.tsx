import { useTranslation } from "react-i18next";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Globe } from "lucide-react";
import { languageNames, SupportedLanguage } from "@/i18n/translations";

export function LanguageSelector() {
  const { i18n } = useTranslation();
  const currentLanguage = i18n.language;

  const handleLanguageChange = (lang: string) => {
    i18n.changeLanguage(lang);
  };

  // Normalize language code to find the best match
  const normalizedLanguage = Object.keys(languageNames).find(
    (lang) => currentLanguage.startsWith(lang) || currentLanguage.split("-")[0] === lang.split("-")[0]
  ) || "en";

  return (
    <div className="flex items-center gap-2">
      <Globe className="w-4 h-4 text-muted-foreground" />
      <Select value={normalizedLanguage} onValueChange={handleLanguageChange}>
        <SelectTrigger className="w-auto min-w-[120px] rounded-xl">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {(Object.entries(languageNames) as [SupportedLanguage, string][]).map(
            ([code, name]) => (
              <SelectItem key={code} value={code}>
                {name}
              </SelectItem>
            )
          )}
        </SelectContent>
      </Select>
    </div>
  );
}
