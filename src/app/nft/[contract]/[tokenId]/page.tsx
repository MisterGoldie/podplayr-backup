import type { Metadata } from 'next';
import App from '~/app/app';
import { getNftUrl, getServerAppUrl, miniAppMetadataTags } from '~/lib/miniapp';
import { findFeaturedNftByIdentity } from '~/data/featuredNfts';
import { resolvePlayableNftForEmbed } from '~/lib/resolvePlayableNft';
import { NFT_BOOTSTRAP_SCRIPT_ID, serializeNftBootstrap } from '~/lib/nftBootstrap';

interface Props {
  params: Promise<{ contract: string; tokenId: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { contract, tokenId } = await params;
  const appUrl = await getServerAppUrl();
  const nftUrl = getNftUrl(contract, tokenId, appUrl);

  const nft = await resolvePlayableNftForEmbed(contract, tokenId);
  if (!nft) {
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

  const isFeatured = Boolean(findFeaturedNftByIdentity(contract, tokenId));
  const ogImage = isFeatured
    ? resolveOgImage(nft.image || '') || `${appUrl}/image.png`
    : `${appUrl}/api/og?contract=${encodeURIComponent(contract)}&tokenId=${encodeURIComponent(tokenId)}&ogv=thumb7`;

  const name = nft.name || 'PODPLAYR';
  const description = nft.description || nft.metadata?.description || 'Listen to this NFT on PODPLAYR';

  return {
    title: `${name} on PODPLAYR`,
    description,
    openGraph: {
      title: name,
      description,
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

export default async function NFTPage({ params }: Props) {
  const { contract, tokenId } = await params;
  const nft = await resolvePlayableNftForEmbed(contract, tokenId);

  return (
    <main>
      {nft && (
        <script
          id={NFT_BOOTSTRAP_SCRIPT_ID}
          type="application/json"
          dangerouslySetInnerHTML={{ __html: serializeNftBootstrap(nft) }}
        />
      )}
      <App />
    </main>
  );
}
