import type { Metadata } from 'next';
import App from '~/app/app';
import { getNftUrl, getServerAppUrl, miniAppMetadataTags, socialShareMetadata } from '~/lib/miniapp';
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
      ...socialShareMetadata({
        title: 'PODPLAYR',
        description: 'Listen & Watch NFTs on PODPLAYR',
        imageUrl: `${appUrl}/image.png`,
        pageUrl: appUrl,
      }),
      other: miniAppMetadataTags({
        imageUrl: `${appUrl}/image.png`,
        buttonTitle: 'Enter PODPLAYR',
        launchUrl: appUrl,
      }),
    };
  }

  const name = nft.name || 'PODPLAYR';
  const description = nft.description || nft.metadata?.description || 'Listen to this NFT on PODPLAYR';
  // Same-origin card for Twitter + Farcaster. Raw IPFS/Pinata covers work in
  // Warpcast but Twitterbot cannot fetch them.
  const ogImage = `${appUrl}/api/og?contract=${encodeURIComponent(contract)}&tokenId=${encodeURIComponent(tokenId)}&ogv=thumb8`;

  return {
    title: `${name} on PODPLAYR`,
    description,
    ...socialShareMetadata({
      title: name,
      description,
      imageUrl: ogImage,
      pageUrl: nftUrl,
    }),
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
