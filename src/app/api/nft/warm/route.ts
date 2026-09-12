import { NextRequest, NextResponse } from 'next/server';
import { isOnChainNftIdentity } from '~/lib/nft';
import { resolvePlayableNftForEmbed } from '~/lib/resolvePlayableNft';

/**
 * Pre-resolves an NFT into the embed cache so the first person to open a
 * shared cast doesn't pay the cold Base/Ethereum race (~12s).
 *
 * Called fire-and-forget by `shareNftToFarcaster` as the composer opens, so
 * resolution happens while the user is still typing their cast.
 *
 * Deliberately does NOT accept NFT data from the client — it only takes an
 * identity and resolves server-side. Letting callers push metadata straight
 * into a shared cache would poison the OG tags and playback URLs everyone
 * else reads.
 */

// The cold resolve is the whole point of this route; give it room.
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { contract?: unknown; tokenId?: unknown };
    const contract = typeof body.contract === 'string' ? body.contract : '';
    const tokenId = typeof body.tokenId === 'string' ? body.tokenId : '';

    if (!isOnChainNftIdentity(contract, tokenId)) {
      return NextResponse.json({ warmed: false }, { status: 400 });
    }

    const nft = await resolvePlayableNftForEmbed(contract, tokenId);
    return NextResponse.json(
      { warmed: true, playable: !!nft },
      { headers: { 'Cache-Control': 'private, no-store' } }
    );
  } catch (error) {
    console.warn('[podplayr:warm] embed pre-warm failed', error);
    return NextResponse.json({ warmed: false }, { status: 200 });
  }
}
