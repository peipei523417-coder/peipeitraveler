import { Globe } from "lucide-react";

export function LanguageSelector() {
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <Globe className="w-4 h-4" />
      <span>English</span>
    </div>
  );
}
