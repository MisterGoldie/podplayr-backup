import type { Metadata } from 'next';
import App from './app';
import { getServerAppUrl, miniAppMetadataTags } from '~/lib/miniapp';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const appUrl = await getServerAppUrl();
  return {
    title: 'PODPLAYR',
    other: miniAppMetadataTags({
      imageUrl: `${appUrl}/image.png`,
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
