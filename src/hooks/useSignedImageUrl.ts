import { useState, useEffect } from 'react';
import { getSignedImageUrl } from '@/lib/supabase-storage';

/**
 * Module-level cache for signed URLs.
 * Persists across component mounts so returning to a screen doesn't
 * re-trigger image loading flashes. Keyed by the original storage path.
 */
interface CacheEntry {
  url: string;
  expiresAt: number; // epoch ms
}
const signedUrlCache = new Map<string, CacheEntry>();
// Refresh slightly before actual expiry to be safe
const SAFETY_MARGIN_MS = 60 * 1000;

function getCached(key: string): string | undefined {
  const entry = signedUrlCache.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt - SAFETY_MARGIN_MS < Date.now()) {
    signedUrlCache.delete(key);
    return undefined;
  }
  return entry.url;
}

function setCached(key: string, url: string, expiresIn: number) {
  signedUrlCache.set(key, {
    url,
    expiresAt: Date.now() + expiresIn * 1000,
  });
}

/**
 * Hook to convert a stored image URL to a signed URL for private bucket access
 */
export function useSignedImageUrl(imageUrl: string | undefined, expiresIn: number = 3600): string | undefined {
  const [signedUrl, setSignedUrl] = useState<string | undefined>(() => {
    if (!imageUrl) return undefined;
    if (!imageUrl.includes('/project-images/') || imageUrl.includes('token=')) {
      return imageUrl;
    }
    return getCached(imageUrl);
  });

  useEffect(() => {
    if (!imageUrl) {
      setSignedUrl(undefined);
      return;
    }

    if (!imageUrl.includes('/project-images/') || imageUrl.includes('token=')) {
      setSignedUrl(imageUrl);
      return;
    }

    const cached = getCached(imageUrl);
    if (cached) {
      setSignedUrl(cached);
      return;
    }

    let isMounted = true;
    getSignedImageUrl(imageUrl, expiresIn).then((url) => {
      if (!isMounted) return;
      if (url) {
        setCached(imageUrl, url, expiresIn);
        setSignedUrl(url);
      } else {
        setSignedUrl(imageUrl);
      }
    });

    return () => {
      isMounted = false;
    };
  }, [imageUrl, expiresIn]);

  return signedUrl;
}

/**
 * Hook to convert multiple image URLs to signed URLs
 */
export function useSignedImageUrls(imageUrls: (string | undefined)[], expiresIn: number = 3600): (string | undefined)[] {
  const computeInitial = () =>
    imageUrls.map((url) => {
      if (!url) return undefined;
      if (!url.includes('/project-images/') || url.includes('token=')) return url;
      return getCached(url);
    });

  const [signedUrls, setSignedUrls] = useState<(string | undefined)[]>(computeInitial);

  useEffect(() => {
    let isMounted = true;

    Promise.all(
      imageUrls.map(async (url) => {
        if (!url) return undefined;
        if (!url.includes('/project-images/') || url.includes('token=')) return url;
        const cached = getCached(url);
        if (cached) return cached;
        const signed = await getSignedImageUrl(url, expiresIn);
        if (signed) {
          setCached(url, signed, expiresIn);
          return signed;
        }
        return url;
      })
    ).then((urls) => {
      if (isMounted) setSignedUrls(urls);
    });

    return () => {
      isMounted = false;
    };
  }, [JSON.stringify(imageUrls), expiresIn]);

  return signedUrls;
}
