interface OptimizedImage {
  file: File;
  width: number;
  height: number;
  size: number;
}

export const optimizeImage = async (file: File, maxWidth = 680, maxHeight = 560, quality = 0.85): Promise<OptimizedImage> => {
  // Validate file type to ensure it's actually an image
  const validImageTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml'];
  if (!file || !validImageTypes.includes(file.type)) {
    return Promise.reject(new Error('Invalid image file type'));
  }
  
  return new Promise((resolve, reject) => {
    const img = new Image();
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    if (!ctx) {
      reject(new Error('Failed to get canvas context'));
      return;
    }

    img.onload = () => {
      // Calculate dimensions while maintaining aspect ratio
      let width = img.width;
      let height = img.height;
      
      if (width > maxWidth || height > maxHeight) {
        const ratio = Math.min(maxWidth / width, maxHeight / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }

      // Set canvas size
      canvas.width = width;
      canvas.height = height;

      // Draw and optimize
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);

      // Convert to blob
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error('Failed to create blob'));
            return;
          }

          // Create optimized file
          const optimizedFile = new File(
            [blob],
            file.name.replace(/\.[^/.]+$/, "") + '.jpg',
            { type: 'image/jpeg' }
          );

          resolve({
            file: optimizedFile,
            width,
            height,
            size: optimizedFile.size
          });
        },
        'image/jpeg',
        quality
      );
    };

    img.onerror = () => {
      reject(new Error('Failed to load image'));
    };

    // Load image from file - create object URL with proper cleanup
    const objectUrl = URL.createObjectURL(file);
    
    // SECURITY: Validate object URL before assigning to prevent XSS
    try {
      // Use URL constructor to validate - this prevents XSS by ensuring proper URL format
      const url = new URL(objectUrl);
      
      // Only allow blob: URLs (for local files) and data: URLs for images
      if (url.protocol === 'blob:' || (url.protocol === 'data:' && url.pathname.startsWith('image/'))) {
        // Assign to src property using the validated URL string
        // Use the string representation of the URL object to prevent XSS
        img.src = url.href;
      } else {
        URL.revokeObjectURL(objectUrl);
        reject(new Error('Invalid image source protocol'));
        return;
      }
    } catch (error) {
      // Invalid URL format
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Invalid image source format'));
      return;
    }
    
    // Add onload handler to revoke the URL after image is loaded
    const originalOnload = img.onload;
    img.onload = (event) => {
      // Call the original onload handler first
      if (originalOnload) {
        // @ts-ignore - TypeScript doesn't like reassigning event handlers
        originalOnload.call(img, event);
      }
      
      // Clean up the object URL to prevent memory leaks
      URL.revokeObjectURL(objectUrl);
    };
  });
};

export function getOptimizedImageUrl(url: string, options: {
  width?: number;
  height?: number;
  quality?: number;
  format?: 'webp' | 'jpeg' | 'png' | 'avif';
  isMobile?: boolean;
} = {}): string {
  if (!url) return '';
  
  // Don't try to optimize data URLs or relative URLs
  if (url.startsWith('data:') || url.startsWith('/')) {
    return url;
  }
  
  const {
    width = options.isMobile ? 400 : 800,
    height = options.isMobile ? 400 : 800,
    quality = options.isMobile ? 70 : 85,
    format = 'webp',
    isMobile = false
  } = options;

  // For IPFS URLs: Use an IPFS gateway that supports image optimization
  if (typeof url === 'string' && url.startsWith('ipfs://')) {
    const ipfsHash = url.replace('ipfs://', '');
    return `https://cloudflare-ipfs.com/ipfs/${ipfsHash}?img-width=${width}&img-height=${height}&img-format=${format}&img-quality=${quality}`;
  }
  
  // For Arweave URLs
  if (typeof url === 'string' && url.startsWith('ar://')) {
    const arweaveHash = url.replace('ar://', '');
    return `https://arweave.net/${arweaveHash}`;
  }

  // For normal HTTP URLs that don't support optimization parameters, just return the URL
  return url;
}
