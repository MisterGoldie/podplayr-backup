import { NextRequest, NextResponse } from 'next/server';

/**
 * Browser/mini-app DNS often cannot resolve OpenSea CDNs (i.seadn.io,
 * openseauserdata.com → ERR_NAME_NOT_RESOLVED). Fetch from the server and
 * stream back same-origin so cards + playback work in Farcaster webviews.
 */
const ALLOWED_HOSTS = [
  'i.seadn.io',
  'i2.seadn.io',
  'i2c.seadn.io',
  'img.seadn.io',
  'raw.seadn.io',
  'raw2.seadn.io',
  'openseauserdata.com',
  'www.openseauserdata.com',
];

const isAllowed = (hostname: string): boolean => {
  const host = hostname.toLowerCase();
  return ALLOWED_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
};

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get('url');
  if (!raw) {
    return NextResponse.json({ error: 'Missing url' }, { status: 400 });
  }

  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return NextResponse.json({ error: 'Invalid url' }, { status: 400 });
  }

  if (target.protocol !== 'https:' || !isAllowed(target.hostname)) {
    return NextResponse.json({ error: 'Host not allowed' }, { status: 403 });
  }

  try {
    const range = req.headers.get('range');
    const upstream = await fetch(target.toString(), {
      headers: {
        Accept: req.headers.get('accept') || '*/*',
        ...(range ? { Range: range } : {}),
        'User-Agent': 'PODPlayr-media-proxy/1.0',
      },
      // Avoid Next fetch cache poisoning large media
      cache: 'no-store',
    });

    if (!upstream.ok && upstream.status !== 206) {
      return NextResponse.json(
        { error: `Upstream ${upstream.status}` },
        { status: upstream.status === 404 ? 404 : 502 }
      );
    }

    const headers = new Headers();
    const pass = [
      'content-type',
      'content-length',
      'content-range',
      'accept-ranges',
      'etag',
      'last-modified',
    ];
    for (const key of pass) {
      const value = upstream.headers.get(key);
      if (value) headers.set(key, value);
    }
    headers.set('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
    headers.set('Access-Control-Allow-Origin', '*');

    return new NextResponse(upstream.body, {
      status: upstream.status,
      headers,
    });
  } catch (error) {
    console.error('[media-proxy] fetch failed', target.toString(), error);
    return NextResponse.json({ error: 'Upstream fetch failed' }, { status: 502 });
  }
}
