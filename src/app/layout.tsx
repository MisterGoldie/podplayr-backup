import type { Metadata, Viewport } from "next";
import "~/app/globals.css";
import "~/styles/mobile.css"; // Import mobile-specific styles
import { Providers } from "~/app/providers";
import Script from 'next/script';
import { Space_Grotesk } from 'next/font/google';
import { MiniKitContextProvider } from '../components/providers/MiniKitProvider';

const appUrl = process.env.NEXT_PUBLIC_URL;

// Frame configuration following Farcaster Mini App spec
const frameConfig = {
  version: "next",
  imageUrl: `${appUrl}/image.png`,
  button: {
    title: "▶️ Enter PODPLAYR",
    action: {
      type: "launch_frame",
      name: "PODPLAYR",
      url: appUrl,
      splashImageUrl: `${appUrl}/splash.png`,
      splashBackgroundColor: "#000000"
    }
  }
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export const metadata: Metadata = {
  title: "PODPLAYR",
  description: "Listen & Watch NFTs on PODPLAYR",
  openGraph: {
    title: "PODPLAYR",
    description: "Listen & Watch NFTs on PODPLAYR",
    images: [`${appUrl}/image.png`],
  },
  other: {
    'fc:frame': JSON.stringify(frameConfig)
  }
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
          <Providers>{children}</Providers>
        </MiniKitContextProvider>
      </body>
    </html>
  );
}