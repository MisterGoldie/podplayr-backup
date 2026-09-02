import type { Metadata } from 'next';
import App from '~/app/app';
import { getNftUrl, getServerAppUrl, miniAppMetadataTags } from '~/lib/miniapp';
import { getNFTMetadata, isOnChainNftIdentity } from '~/lib/nft';
import { findFeaturedNftByIdentity } from '~/data/featuredNfts';

interface Props {
  params: Promise<{ contract: string; tokenId: string }>;
}

type NftPreview = { name: string; description: string; image: string; isFeatured: boolean };

async function resolveNftPreview(contract: string, tokenId: string): Promise<NftPreview | null> {
  // Exact Featured match first, for ANY contract — some curated entries use a
  // real contract with a placeholder hex tokenId that Alchemy misreads as a
  // different token entirely (see findFeaturedNftByIdentity for details).
  const featured = findFeaturedNftByIdentity(contract, tokenId);
  if (featured) {
    return {
      name: featured.name || 'PODPLAYR',
      description: featured.description || featured.metadata?.description || 'Listen on PODPLAYR',
      image: featured.image || '',
      isFeatured: true,
    };
  }

  if (contract === 'pending' || !isOnChainNftIdentity(contract, tokenId)) return null;

  for (const network of ['base', 'ethereum'] as const) {
    try {
      const nft = await getNFTMetadata(contract, tokenId, network);
      return {
        name: nft.name || 'PODPLAYR',
        description: nft.description || 'Listen to this NFT on PODPLAYR',
        image: nft.image || nft.metadata?.image || '',
        isFeatured: false,
      };
    } catch {
      // try next network
    }
  }
  return null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { contract, tokenId } = await params;
  const appUrl = await getServerAppUrl();
  const nftUrl = getNftUrl(contract, tokenId, appUrl);

  const preview = await resolveNftPreview(contract, tokenId);
  if (!preview) {
    return {
      title: 'PODPLAYR',
      other: miniAppMetadataTags({
        imageUrl: `${appUrl}/image.png`,
        buttonTitle: 'Enter PODPLAYR',
        launchUrl: appUrl,
      }),
    };
  }

  const resolveOgImage = (img: string) =>
    img.startsWith('/') ? `${appUrl}${img}` : img;

  const ogImage = preview.isFeatured
    ? resolveOgImage(preview.image) || `${appUrl}/image.png`
    : `${appUrl}/api/og?contract=${encodeURIComponent(contract)}&tokenId=${encodeURIComponent(tokenId)}`;

  return {
    title: `${preview.name} on PODPLAYR`,
    description: preview.description,
    openGraph: {
      title: preview.name,
      description: preview.description,
      images: [ogImage],
      url: nftUrl,
    },
    other: miniAppMetadataTags({
      imageUrl: ogImage,
      buttonTitle: '▶️ Play Now',
      launchUrl: nftUrl,
    }),
  };
}

export default function NFTPage() {
  return (
    <main>
      <App />
    </main>
  );
}
