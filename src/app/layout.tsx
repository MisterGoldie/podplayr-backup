import type { Metadata } from "next";
import "~/app/globals.css";
import "~/styles/mobile.css"; // Import mobile-specific styles
import { Providers } from "~/app/providers";
import Script from 'next/script';
import { Space_Grotesk } from 'next/font/google';
// Import our client-side protection component
import { DisableWalletConnectClient } from '~/lib/DisableWalletConnectClient';
import { MiniKitContextProvider } from '../components/providers/MiniKitProvider';

const appUrl = process.env.NEXT_PUBLIC_URL;

// Use absolute URLs for frame images to ensure they work in Farcaster
const frame = {
  version: 'vNext',
  // Use the icon we know exists, with absolute URL
  image: `${appUrl || 'https://firmly-organic-kite.ngrok-free.app'}/icons/icon-512x512.png`,
  title: 'PODPLAYR',
  description: 'Listen & Watch NFTs on PODPLAYR',
  buttons: [{
    label: '▶️ Enter PODPLAYR',
    action: {
      type: 'post_redirect',
      target: appUrl || 'https://firmly-organic-kite.ngrok-free.app',
    },
  }],
  postUrl: `${appUrl || 'https://firmly-organic-kite.ngrok-free.app'}/api/frame`,
};

const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  display: 'swap',
});

// Enable HTTP/2 server push for critical assets
const linkHeader = [
  '</styles.css>; rel=preload; as=style',
  '</main.js>; rel=preload; as=script',
  '</favicon.ico>; rel=preload; as=image'
].join(',');

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={spaceGrotesk.className}>
      <head>
        {/* Ensure mobile support with proper viewport */}
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
        
        {/* CRITICAL: Load Farcaster SDK as early as possible and ensure immediate execution */}
        <Script src="https://cdn.farcaster.xyz/frames/sdk.js" strategy="beforeInteractive" />
      </head>
      <body>
        <MiniKitContextProvider>
          {/* Add our client component that protects against WalletConnect double initialization */}
          <DisableWalletConnectClient />
          <Providers>{children}</Providers>
        </MiniKitContextProvider>
      </body>
    </html>
  );
}

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: frame.title,
    description: frame.description,
    viewport: {
      width: 'device-width',
      initialScale: 1,
      maximumScale: 1,
      userScalable: false,
    },
    openGraph: {
      title: frame.title,
      description: frame.description,
      images: [frame.image],
    },
    other: {
      'fc:frame': frame.version,
      'fc:frame:image': frame.image,
      'fc:frame:post_url': frame.postUrl,
      'fc:frame:button:1': frame.buttons[0].label,
      'fc:frame:button:1:action': 'post_redirect',
      'fc:frame:button:1:target': frame.buttons[0].action.target,
      // Add OnchainKit frame data
      'onchainkit:frame': JSON.stringify({
        version: "next",
        imageUrl: process.env.NEXT_PUBLIC_APP_HERO_IMAGE,
        button: {
          title: `Launch ${process.env.NEXT_PUBLIC_ONCHAINKIT_PROJECT_NAME}`,
          action: {
            type: "launch_frame",
            name: process.env.NEXT_PUBLIC_ONCHAINKIT_PROJECT_NAME,
            url: appUrl,
            splashImageUrl: process.env.NEXT_PUBLIC_SPLASH_IMAGE,
            splashBackgroundColor: process.env.NEXT_PUBLIC_SPLASH_BACKGROUND_COLOR,
          },
        },
      }),
    },
  };
}