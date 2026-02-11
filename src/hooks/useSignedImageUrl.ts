import { useState, useEffect } from 'react';
import { getSignedImageUrl } from '@/lib/supabase-storage';

/**
 * Hook to convert a stored image URL to a signed URL for private bucket access
 * @param imageUrl - The original image URL stored in the database
 * @param expiresIn - Expiration time in seconds (default: 1 hour)
 * @returns The signed URL or undefined while loading
 */
export function useSignedImageUrl(imageUrl: string | undefined, expiresIn: number = 3600): string | undefined {
  const [signedUrl, setSignedUrl] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!imageUrl) {
      setSignedUrl(undefined);
      return;
    }

    // If it's already a signed URL or not from our bucket, use as-is
    if (!imageUrl.includes('/project-images/') || imageUrl.includes('token=')) {
      setSignedUrl(imageUrl);
      return;
    }

    let isMounted = true;
    
    getSignedImageUrl(imageUrl, expiresIn).then((url) => {
      if (isMounted) {
        setSignedUrl(url || imageUrl); // Fallback to original if signing fails
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
  const [signedUrls, setSignedUrls] = useState<(string | undefined)[]>(imageUrls.map(() => undefined));

  useEffect(() => {
    let isMounted = true;

    Promise.all(
      imageUrls.map(async (url) => {
        if (!url) return undefined;
        if (!url.includes('/project-images/') || url.includes('token=')) {
          return url;
        }
        return await getSignedImageUrl(url, expiresIn) || url;
      })
    ).then((urls) => {
      if (isMounted) {
        setSignedUrls(urls);
      }
    });

    return () => {
      isMounted = false;
    };
  }, [JSON.stringify(imageUrls), expiresIn]);

  return signedUrls;
}
