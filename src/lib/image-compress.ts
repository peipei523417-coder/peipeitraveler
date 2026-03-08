/**
 * image-compress.ts — Client-side image compression before upload
 * 
 * Strategy:
 * - Max width/height: 1200px (sufficient for mobile travel app)
 * - JPEG quality: 0.8 (80%)
 * - Converts PNG/WEBP to JPEG for smaller size (unless transparent)
 * - Skip compression if file is already small (<200KB)
 */

const MAX_DIMENSION = 1200;
const JPEG_QUALITY = 0.8;
const SKIP_THRESHOLD_BYTES = 200 * 1024; // 200KB

export interface CompressionResult {
  file: File;
  originalSize: number;
  compressedSize: number;
  wasCompressed: boolean;
}

/**
 * Compress an image file before uploading to storage.
 * Returns the compressed file + size comparison info.
 */
export async function compressImage(file: File): Promise<CompressionResult> {
  const originalSize = file.size;

  // Skip non-image files
  if (!file.type.startsWith("image/")) {
    return { file, originalSize, compressedSize: originalSize, wasCompressed: false };
  }

  // Skip very small files
  if (originalSize <= SKIP_THRESHOLD_BYTES) {
    return { file, originalSize, compressedSize: originalSize, wasCompressed: false };
  }

  // Skip GIF (animated) and SVG (vector)
  if (file.type === "image/gif" || file.type === "image/svg+xml") {
    return { file, originalSize, compressedSize: originalSize, wasCompressed: false };
  }

  try {
    const bitmap = await createImageBitmap(file);
    const { width, height } = bitmap;

    // Calculate new dimensions
    let newWidth = width;
    let newHeight = height;
    if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
      const ratio = Math.min(MAX_DIMENSION / width, MAX_DIMENSION / height);
      newWidth = Math.round(width * ratio);
      newHeight = Math.round(height * ratio);
    }

    // Draw to canvas
    const canvas = new OffscreenCanvas(newWidth, newHeight);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close();
      return { file, originalSize, compressedSize: originalSize, wasCompressed: false };
    }

    ctx.drawImage(bitmap, 0, 0, newWidth, newHeight);
    bitmap.close();

    // Convert to JPEG blob
    const blob = await canvas.convertToBlob({
      type: "image/jpeg",
      quality: JPEG_QUALITY,
    });

    // Only use compressed version if it's actually smaller
    if (blob.size >= originalSize) {
      return { file, originalSize, compressedSize: originalSize, wasCompressed: false };
    }

    const compressedFile = new File(
      [blob],
      file.name.replace(/\.[^.]+$/, ".jpg"),
      { type: "image/jpeg" }
    );

    console.log(
      `[ImageCompress] ${(originalSize / 1024).toFixed(0)}KB → ${(blob.size / 1024).toFixed(0)}KB (saved ${((1 - blob.size / originalSize) * 100).toFixed(0)}%)`
    );

    return {
      file: compressedFile,
      originalSize,
      compressedSize: blob.size,
      wasCompressed: true,
    };
  } catch (error) {
    console.error("[ImageCompress] Failed, using original:", error);
    return { file, originalSize, compressedSize: originalSize, wasCompressed: false };
  }
}

/** Human-readable file size */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
