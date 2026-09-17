import type { Metadata } from 'next';
import App from '~/app/app';
import { getNftUrl, getServerAppUrl, miniAppMetadataTags } from '~/lib/miniapp';
import { findFeaturedNftByIdentity } from '~/data/featuredNfts';
import { resolvePlayableNftForEmbed } from '~/lib/resolvePlayableNft';
import { NFT_BOOTSTRAP_SCRIPT_ID, serializeNftBootstrap } from '~/lib/nftBootstrap';

interface Props {
  params: Promise<{ contract: string; tokenId: string }>;
}

function ogImageUrl(appUrl: string, contract: string, tokenId: string): string {
  return `${appUrl}/api/og?contract=${encodeURIComponent(contract)}&tokenId=${encodeURIComponent(tokenId)}&ogv=thumb7`;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { contract, tokenId } = await params;
  const appUrl = await getServerAppUrl();
  const nftUrl = getNftUrl(contract, tokenId, appUrl);

  const featured = findFeaturedNftByIdentity(contract, tokenId);
  const nft = await resolvePlayableNftForEmbed(contract, tokenId);

  const resolveOgImage = (img: string) =>
    img.startsWith('/') ? `${appUrl}${img}` : img;

  const ogImage = featured
    ? resolveOgImage(nft?.image || '') || `${appUrl}/image.png`
    : ogImageUrl(appUrl, contract, tokenId);

  const name = nft?.name || 'PODPLAYR';
  const description =
    nft?.description || nft?.metadata?.description || 'Listen to this NFT on PODPLAYR';

  return {
    title: nft ? `${name} on PODPLAYR` : 'PODPLAYR',
    description,
    openGraph: {
      title: name,
      description,
      images: [ogImage],
      url: nftUrl,
    },
    other: miniAppMetadataTags({
      imageUrl: ogImage,
      buttonTitle: nft ? '▶️ Play Now' : 'Enter PODPLAYR',
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
