import type { Metadata } from 'next';
import App from '~/app/app';
import { getLiveUrl, getServerAppUrl, miniAppMetadataTags } from '~/lib/miniapp';
import { LIVE_TITLE } from '~/data/liveStream';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const appUrl = await getServerAppUrl();
  const liveUrl = getLiveUrl(appUrl);
  const imageUrl = `${appUrl}/liveshare.png`;

  return {
    title: `${LIVE_TITLE} on PODPLAYR`,
    description: 'Watch PODPLAYR Live',
    openGraph: {
      title: LIVE_TITLE,
      description: 'Watch PODPLAYR Live',
      images: [imageUrl],
      url: liveUrl,
    },
    other: miniAppMetadataTags({
      imageUrl,
      buttonTitle: 'Watch livestream',
      launchUrl: liveUrl,
    }),
  };
}

export default function LivePage() {
  return (
    <main>
      <App />
    </main>
  );
}
