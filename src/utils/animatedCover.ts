/** Server/client-safe detection: artwork MIME is separate from playback MIME. */
export function isAnimatedImage(value?: string | null): boolean {
  return !!value && /^(?:image\/)?(?:gif|apng)(?:;|$)/i.test(value.trim());
}

export function animatedCoverUrl(options: {
  image?: { contentType?: string; cachedUrl?: string; originalUrl?: string } | null;
  imageFormat?: string;
  metaImage?: string | null;
  metaImageUrl?: string | null;
}): string | null {
  const { image } = options;
  const animatedUrl = (url?: string | null) => !!url && /\.(gif|apng)(?:[?#]|$)/i.test(url);
  // Alchemy's thumbnailUrl/pngUrl are static even when the original is a GIF.
  if (isAnimatedImage(image?.contentType)) {
    return image?.cachedUrl || image?.originalUrl || options.metaImage || options.metaImageUrl || null;
  }
  if (isAnimatedImage(options.imageFormat)) {
    return options.metaImage || image?.originalUrl || options.metaImageUrl || null;
  }
  return [image?.originalUrl, options.metaImage, options.metaImageUrl, image?.cachedUrl]
    .find(animatedUrl) || null;
}
