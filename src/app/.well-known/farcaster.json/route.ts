import { getServerAppUrl } from '~/lib/miniapp';

/** The domain the accountAssociation signature below was issued for. The
 * signature is bound to this exact domain, so it can only be served when we're
 * actually running there. */
const VERIFIED_DOMAIN = 'podplayr.xyz';

const accountAssociation = {
  header: "eyJmaWQiOjEwOTkxNzksInR5cGUiOiJjdXN0b2R5Iiwia2V5IjoiMHg5YmEyMjgwNmNEOEY2NTEzMUU1YWQwMEUwMTdGQjhCMUFlM0EyZmFBIn0",
  payload: "eyJkb21haW4iOiJwb2RwbGF5ci54eXoifQ",
  signature: "MHhkMDVjZjE1NjRiYjZhNWIwMmQ0Nzk2ZjEyNjU3M2UyOTU0OTY4N2IwZjkwMWJlNWJhMjFhOTYyNDY1MzZkMTU4NjM2YWVhZGQzYWI2ZDE1NDIwNDJjOTdiYzY3ZjJiNjcxNjMyYzlmMWUzNTU2YjVlYWE1MjIxYWI3MmMyMGZkNjFj"
};

export async function GET() {
  // Derive every URL from the host actually serving this request. Hardcoding
  // the production domain broke tunnel/preview deploys: the client launches a
  // deep link on the tunnel domain, reads a manifest claiming it lives at
  // podplayr.xyz, treats that as a mismatch and bounces the webview to
  // homeUrl — which looked like shared NFT links "routing to the homepage".
  const appUrl = await getServerAppUrl();
  const isVerifiedDomain = new URL(appUrl).hostname === VERIFIED_DOMAIN;

  const config = {
    // The signature only validates for podplayr.xyz. Serving it from any other
    // host makes the manifest invalid rather than merely unverified, so send
    // an unassociated (dev/preview) manifest off-domain instead.
    ...(isVerifiedDomain ? { accountAssociation } : {}),
    baseBuilder: {
      allowedAddresses: ["0x389355CBa617EA0b305e5105DC483251c80960d1"]
    },
    frame: {
      version: "1", // Required: Must be '1'
      name: "PODPLAYR", // Required: Mini App name (max 32 chars)
      homeUrl: appUrl, // Required: Default launch URL
      iconUrl: `${appUrl}/icon.png`, // Required: 1024x1024px PNG, no alpha
      imageUrl: `${appUrl}/image.png`, // [DEPRECATED] Default share image
      buttonTitle: "Enter PODPLAYR", // [DEPRECATED] Default button title
      splashImageUrl: `${appUrl}/splash.png`, // Loading screen image
      splashBackgroundColor: "#551B83", // Loading screen bg color
      subtitle: "Enjoy media NFTs on the web", // Short description under app name
      description: "PODPLAYR is a unified platform for discovering, playing, and sharing media content contained within Non-Fungible Tokens", // Promotional message
      primaryCategory: "entertainment", // Primary category of app
      tags: ["music", "nft", "audio", "player", "web3"], // Up to 5 descriptive tags
      heroImageUrl: `${appUrl}/hero.png`, // Promotional display image
      tagline: "The Ultimate NFT Audio Player", // Marketing tagline
      ogTitle: "PODPLAYR - Web3 Media Player", // Open Graph title
      ogDescription: "Listen to and share media NFTs across all platforms", // Open Graph description
      ogImageUrl: `${appUrl}/og-image.png`, // Open Graph promotional image
      noindex: false // Include in search results
    }
  };

  return Response.json(config);
}
