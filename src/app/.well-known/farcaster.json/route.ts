export async function GET() {
  const config = {
    accountAssociation: {
      header: "eyJmaWQiOjEwOTkxNzksInR5cGUiOiJjdXN0b2R5Iiwia2V5IjoiMHg5YmEyMjgwNmNEOEY2NTEzMUU1YWQwMEUwMTdGQjhCMUFlM0EyZmFBIn0",
      payload: "eyJkb21haW4iOiJwb2RwbGF5ci54eXoifQ",
      signature: "MHhkMDVjZjE1NjRiYjZhNWIwMmQ0Nzk2ZjEyNjU3M2UyOTU0OTY4N2IwZjkwMWJlNWJhMjFhOTYyNDY1MzZkMTU4NjM2YWVhZGQzYWI2ZDE1NDIwNDJjOTdiYzY3ZjJiNjcxNjMyYzlmMWUzNTU2YjVlYWE1MjIxYWI3MmMyMGZkNjFj"
    },
    frame: {
      version: "1", // Required: Must be '1'
      name: "PODPLAYR", // Required: Mini App name (max 32 chars)
      homeUrl: "https://podplayr.xyz", // Required: Default launch URL
      iconUrl: "https://podplayr.xyz/icon.png", // Required: 1024x1024px PNG, no alpha
      imageUrl: "https://podplayr.xyz/image.png", // [DEPRECATED] Default share image
      buttonTitle: "Enter PODPLAYR", // [DEPRECATED] Default button title
      splashImageUrl: "https://podplayr.xyz/splash.png", // Loading screen image
      splashBackgroundColor: "#551B83", // Loading screen bg color
      subtitle: "Enjoy media NFTs on the web", // Short description under app name
      description: "PODPLAYR is a unified platform for discovering, playing, and sharing media content contained within Non-Fungible Tokens", // Promotional message
      primaryCategory: "entertainment", // Primary category of app
      tags: ["music", "nft", "audio", "player", "web3"], // Up to 5 descriptive tags
      heroImageUrl: "https://podplayr.xyz/hero.png", // Promotional display image
      tagline: "The Ultimate NFT Audio Player", // Marketing tagline
      ogTitle: "PODPLAYR - Web3 Media Player", // Open Graph title
      ogDescription: "Listen to and share media NFTs across all platforms", // Open Graph description
      ogImageUrl: "https://podplayr.xyz/og-image.png", // Open Graph promotional image
      noindex: false // Include in search results
    }
  };

  return Response.json(config);
}