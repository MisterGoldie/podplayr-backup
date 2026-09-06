import type { Metadata } from 'next';
import App from '~/app/app';
import { getProfileUrl, getServerAppUrl, miniAppMetadataTags, socialShareMetadata } from '~/lib/miniapp';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ fid: string }> | { fid: string };
}

function parseFid(value: string): number | null {
  const fid = Number(value);
  return Number.isInteger(fid) && fid !== 0 ? fid : null;
}

async function fetchProfileName(fid: number): Promise<{ username?: string; displayName?: string }> {
  const neynarKey = process.env.NEXT_PUBLIC_NEYNAR_API_KEY || process.env.NEYNAR_API_KEY;
  if (!neynarKey) return {};

  try {
    const response = await fetch(
      `https://api.neynar.com/v2/farcaster/user/bulk?fids=${fid}`,
      {
        headers: {
          accept: 'application/json',
          api_key: neynarKey,
        },
        next: { revalidate: 300 },
      }
    );
    if (!response.ok) return {};
    const data = await response.json();
    const user = data.users?.[0];
    if (!user) return {};
    return {
      username: user.username,
      displayName: user.display_name || user.username,
    };
  } catch {
    return {};
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { fid: fidParam } = await Promise.resolve(params);
  const fid = parseFid(fidParam);
  const appUrl = await getServerAppUrl();

  if (!fid || fid < 0) {
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

  const profile = await fetchProfileName(fid);
  const profileUrl = getProfileUrl(fid, appUrl);
  const title = profile.displayName
    ? `${profile.displayName} on PODPLAYR`
    : 'PODPLAYR profile';
  const description = profile.username
    ? `Listen to @${profile.username}'s media NFTs on PODPLAYR`
    : 'Listen to media NFTs on PODPLAYR';
  const ogImage = `${appUrl}/api/og/profile?fid=${fid}&ogv=pfp3`;

  return {
    title,
    description,
    ...socialShareMetadata({
      title,
      description,
      imageUrl: ogImage,
      pageUrl: profileUrl,
    }),
    other: miniAppMetadataTags({
      imageUrl: ogImage,
      buttonTitle: 'Open profile',
      launchUrl: profileUrl,
    }),
  };
}

export default function ProfilePage() {
  return (
    <main>
      <App />
    </main>
  );
}
