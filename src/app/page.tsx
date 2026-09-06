import type { Metadata } from 'next';
import App from './app';
import { getServerAppUrl, miniAppMetadataTags, socialShareMetadata } from '~/lib/miniapp';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const appUrl = await getServerAppUrl();
  const title = 'PODPLAYR';
  const description = 'Listen & Watch NFTs on PODPLAYR';
  const ogImage = `${appUrl}/image.png`;
  return {
    title,
    description,
    ...socialShareMetadata({
      title,
      description,
      imageUrl: ogImage,
      pageUrl: appUrl,
    }),
    other: miniAppMetadataTags({
      imageUrl: ogImage,
      buttonTitle: '▶️ Enter PODPLAYR',
      launchUrl: appUrl,
    }),
  };
}

export default function Home() {
  return (
    <main>
      <App />
    </main>
  );
}
