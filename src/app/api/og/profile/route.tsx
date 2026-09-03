import { ImageResponse } from 'next/og';
import { NextRequest } from 'next/server';

export const runtime = 'edge';

type ProfileCard = {
  username?: string;
  displayName?: string;
  pfpUrl?: string;
};

async function fetchProfile(fid: number): Promise<ProfileCard> {
  const neynarKey = process.env.NEXT_PUBLIC_NEYNAR_API_KEY || process.env.NEYNAR_API_KEY;
  if (!neynarKey) return {};

  const response = await fetch(
    `https://api.neynar.com/v2/farcaster/user/bulk?fids=${fid}`,
    {
      headers: {
        accept: 'application/json',
        api_key: neynarKey,
      },
    }
  );

  if (!response.ok) return {};

  const data = await response.json();
  const user = data.users?.[0];
  if (!user) return {};

  return {
    username: user.username,
    displayName: user.display_name || user.username,
    pfpUrl: user.pfp_url,
  };
}

export async function GET(request: NextRequest) {
  const fidParam = new URL(request.url).searchParams.get('fid');
  const fid = Number(fidParam);

  if (!Number.isInteger(fid) || fid <= 0) {
    return new Response('Invalid fid', { status: 400 });
  }

  try {
    const profile = await fetchProfile(fid);
    const displayName = profile.displayName || 'PODPLAYR user';
    const username = profile.username ? `@${profile.username}` : `fid:${fid}`;
    const nameSize =
      displayName.length > 28 ? 56 :
      displayName.length > 18 ? 68 :
      84;
    const pfp = 420;

    const image = new ImageResponse(
      (
        <div
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'linear-gradient(180deg, #1E1525 0%, #2D1B69 50%, #4B0082 100%)',
            color: 'white',
            fontFamily: 'sans-serif',
            padding: '48px 56px',
          }}
        >
          <div
            style={{
              display: 'flex',
              fontSize: 36,
              letterSpacing: 6,
              opacity: 0.8,
              marginBottom: 28,
            }}
          >
            PODPLAYR
          </div>
          {profile.pfpUrl ? (
            <img
              src={profile.pfpUrl}
              alt=""
              width={pfp}
              height={pfp}
              style={{
                width: pfp,
                height: pfp,
                borderRadius: pfp / 2,
                objectFit: 'cover',
                border: '8px solid rgba(255,255,255,0.25)',
                marginBottom: 32,
              }}
            />
          ) : (
            <div
              style={{
                width: pfp,
                height: pfp,
                borderRadius: pfp / 2,
                background: 'rgba(255,255,255,0.12)',
                marginBottom: 32,
                display: 'flex',
              }}
            />
          )}
          <div
            style={{
              display: 'flex',
              fontSize: nameSize,
              fontWeight: 700,
              maxWidth: 1040,
              textAlign: 'center',
              lineHeight: 1.15,
            }}
          >
            {displayName}
          </div>
          <div
            style={{
              display: 'flex',
              fontSize: 42,
              opacity: 0.7,
              marginTop: 16,
            }}
          >
            {username}
          </div>
        </div>
      ),
      {
        width: 1200,
        height: 800,
      }
    );

    image.headers.set('Cache-Control', 'public, immutable, no-transform, max-age=300');
    return image;
  } catch (error) {
    console.error('Error generating profile image:', error);
    const fallback = new ImageResponse(
      (
        <div
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'linear-gradient(180deg, #1E1525 0%, #4B0082 100%)',
            color: 'white',
            fontSize: 64,
            fontWeight: 700,
          }}
        >
          PODPLAYR
        </div>
      ),
      { width: 1200, height: 800 }
    );
    fallback.headers.set('Cache-Control', 'public, no-transform, max-age=60');
    return fallback;
  }
}
