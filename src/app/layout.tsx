import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Providers } from "~/app/providers";
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
        {/* Warm up DNS/TLS to the media gateways NFTs are most commonly hosted on,
            so the very first request to each doesn't pay the full handshake cost. */}
        <link rel="preconnect" href="https://arweave.net" crossOrigin="anonymous" />
        <link rel="preconnect" href="https://turbo-gateway.com" crossOrigin="anonymous" />
        <link rel="preconnect" href="https://permagate.io" crossOrigin="anonymous" />
        <link rel="preconnect" href="https://gateway.irys.xyz" crossOrigin="anonymous" />
        <link rel="preconnect" href="https://nftstorage.link" crossOrigin="anonymous" />
        <link rel="preconnect" href="https://w3s.link" crossOrigin="anonymous" />
        <link rel="preconnect" href="https://gateway.ipfs.io" crossOrigin="anonymous" />
        <link rel="preconnect" href="https://ipfs.io" crossOrigin="anonymous" />
        <link rel="preconnect" href="https://gateway.pinata.cloud" crossOrigin="anonymous" />
        <link rel="dns-prefetch" href="https://dweb.link" />
      </head>
      <body>
        <MiniKitContextProvider>
          <Providers>{children}</Providers>
        </MiniKitContextProvider>
      </body>
    </html>
  );
}