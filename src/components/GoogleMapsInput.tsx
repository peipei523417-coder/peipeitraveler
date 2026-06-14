import { useState, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { MapPin, ExternalLink, Check, Link2 } from "lucide-react";
import {
  sanitizeMapUrl,
  detectMapProvider,
  getMapProviderLabel,
} from "@/utils/mapLink";
import { openMapUrl } from "@/lib/maps-url";

interface GoogleMapsInputProps {
  value: string;
  onChange: (url: string) => void;
  placeName?: string;
  onPlaceNameChange?: (name: string) => void;
}

// Best-effort place-name extraction. Only attempted for Google Maps; Naver/Amap
// share URLs don't expose stable place-name segments so we skip them.
function extractGooglePlaceName(url: string): string | undefined {
  const place = url.match(/\/place\/([^/@]+)/);
  if (place) return decodeURIComponent(place[1].replace(/\+/g, " "));
  const q = url.match(/[?&](?:q|query)=([^&]+)/);
  if (q) return decodeURIComponent(q[1].replace(/\+/g, " "));
  const search = url.match(/\/search\/([^/@]+)/);
  if (search) return decodeURIComponent(search[1].replace(/\+/g, " "));
  return undefined;
}

export function GoogleMapsInput({ value, onChange, onPlaceNameChange }: GoogleMapsInputProps) {
  // We keep two states: the raw text the user sees (may include pasted
  // address/newlines), and the sanitized URL that gets stored upstream.
  const [inputValue, setInputValue] = useState(value);
  const [sanitized, setSanitized] = useState<string | null>(sanitizeMapUrl(value));

  useEffect(() => {
    setInputValue(value);
    setSanitized(sanitizeMapUrl(value));
  }, [value]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    setInputValue(raw);

    if (raw.trim() === "") {
      setSanitized(null);
      onChange("");
      return;
    }

    const clean = sanitizeMapUrl(raw);
    setSanitized(clean);

    if (clean) {
      // Persist ONLY the clean URL upstream — never the surrounding text.
      onChange(clean);
      if (detectMapProvider(clean) === "google") {
        const name = extractGooglePlaceName(clean);
        if (name) onPlaceNameChange?.(name);
      }
    } else {
      // No valid https URL detected — do NOT persist the raw text (which may
      // contain place names/addresses/newlines). Clear upstream value; the
      // user sees an inline error and the raw text stays only in local state.
      onChange("");
    }
  };

  const openLink = () => {
    if (sanitized) {
      // Always open the sanitized URL — never the raw input.
      openMapUrl(sanitized);
    }
  };

  const providerLabel = sanitized ? getMapProviderLabel(sanitized) : null;

  return (
    <div className="space-y-2">
      <div className="relative">
        <Link2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          value={inputValue}
          onChange={handleInputChange}
          placeholder="支援 Google Maps、Naver Map、高德地圖"
          className="pl-10 pr-10 rounded-xl h-11 placeholder:text-xs"
        />
        {sanitized && (
          <Check className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-green-500" />
        )}
      </div>

      {inputValue && (
        <div className="flex items-center gap-2 text-sm">
          {sanitized && providerLabel ? (
            <>
              <Check className="w-4 h-4 text-green-500" />
              <span className="text-green-600">{providerLabel}連結有效</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={openLink}
                className="ml-auto gap-1 h-7 text-xs"
              >
                <ExternalLink className="w-3 h-3" />
                開啟地圖
              </Button>
            </>
          ) : (
            <>
              <MapPin className="w-4 h-4 text-amber-500" />
              <span className="text-amber-600">找不到有效地圖連結</span>
            </>
          )}
        </div>
      )}
    </div>
  );
}
