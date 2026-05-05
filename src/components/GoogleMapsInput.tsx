import { useState, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { MapPin, ExternalLink, Check, Link2 } from "lucide-react";

interface GoogleMapsInputProps {
  value: string;
  onChange: (url: string) => void;
  placeName?: string;
  onPlaceNameChange?: (name: string) => void;
}

// Smart parser for Google Maps URLs - extracts place name
function parseGoogleMapsUrl(url: string): { isValid: boolean; placeName?: string } {
  if (!url || url.trim() === "") {
    return { isValid: false };
  }
  
  const trimmedUrl = url.trim();
  
  // Check if it's a valid Google Maps URL
  const googleMapsPatterns = [
    /google\.(com|com\.tw|co\.[a-z]+)\/maps/i,
    /maps\.google\.(com|com\.tw|co\.[a-z]+)/i,
    /goo\.gl\/maps/i,
    /maps\.app\.goo\.gl/i,
  ];
  
  const isGoogleMapsUrl = googleMapsPatterns.some(pattern => pattern.test(trimmedUrl));
  
  if (!isGoogleMapsUrl) {
    return { isValid: false };
  }
  
  // Try to extract place name from various URL formats
  let placeName: string | undefined;
  
  // Pattern 1: /place/PlaceName/ format
  const placeMatch = trimmedUrl.match(/\/place\/([^/@]+)/);
  if (placeMatch) {
    placeName = decodeURIComponent(placeMatch[1].replace(/\+/g, ' '));
  }
  
  // Pattern 2: ?q=PlaceName or query=PlaceName
  if (!placeName) {
    const queryMatch = trimmedUrl.match(/[?&](?:q|query)=([^&]+)/);
    if (queryMatch) {
      placeName = decodeURIComponent(queryMatch[1].replace(/\+/g, ' '));
    }
  }
  
  // Pattern 3: /search/PlaceName/
  if (!placeName) {
    const searchMatch = trimmedUrl.match(/\/search\/([^/@]+)/);
    if (searchMatch) {
      placeName = decodeURIComponent(searchMatch[1].replace(/\+/g, ' '));
    }
  }
  
  return { 
    isValid: true, 
    placeName: placeName || undefined 
  };
}

export function GoogleMapsInput({ value, onChange, placeName, onPlaceNameChange }: GoogleMapsInputProps) {
  const [inputValue, setInputValue] = useState(value);
  const [parseResult, setParseResult] = useState<{ isValid: boolean; placeName?: string }>({ isValid: false });

  useEffect(() => {
    setInputValue(value);
    if (value) {
      const result = parseGoogleMapsUrl(value);
      setParseResult(result);
    }
  }, [value]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setInputValue(newValue);
    
    if (newValue.trim() === "") {
      setParseResult({ isValid: false });
      onChange("");
      return;
    }
    
    const result = parseGoogleMapsUrl(newValue);
    setParseResult(result);
    
    if (result.isValid) {
      onChange(newValue);
      if (result.placeName) {
        onPlaceNameChange?.(result.placeName);
      }
    } else {
      onChange(newValue);
    }
  };

  const openLink = () => {
    if (inputValue && parseResult.isValid) {
      window.open(inputValue, "_blank", "noopener,noreferrer");
    }
  };

  return (
    <div className="space-y-2">
      <div className="relative">
        <Link2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          value={inputValue}
          onChange={handleInputChange}
          placeholder="貼上 Google Maps 連結..."
          className="pl-10 pr-10 rounded-xl h-11"
        />
        {parseResult.isValid && (
          <Check className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-green-500" />
        )}
      </div>
      
      {/* Status indicator */}
      {inputValue && (
        <div className="flex items-center gap-2 text-sm">
          {parseResult.isValid ? (
            <>
              <Check className="w-4 h-4 text-green-500" />
              <span className="text-green-600">
                連結有效 {parseResult.placeName && `- ${parseResult.placeName}`}
              </span>
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
              <span className="text-amber-600">請貼上有效的 Google Maps 連結</span>
            </>
          )}
        </div>
      )}
    </div>
  );
}
