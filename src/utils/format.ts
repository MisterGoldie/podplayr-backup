export const formatPlayCount = (count: number): string => {
  if (count >= 1000000) {
    return `${(count / 1000000).toFixed(1)}M`;
  }
  if (count >= 1000) {
    return `${(count / 1000).toFixed(1)}K`;
  }
  return count.toString();
};

export function getBioText(bio: unknown): string {
  if (!bio) return '';
  if (typeof bio === 'string') return bio;
  if (typeof bio === 'object' && bio !== null && 'text' in bio) {
    const text = (bio as { text?: unknown }).text;
    return typeof text === 'string' ? text : '';
  }
  return '';
} 