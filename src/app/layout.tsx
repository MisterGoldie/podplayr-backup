import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Providers } from "~/app/providers";
import { Space_Grotesk } from 'next/font/google';
import { MiniKitContextProvider } from '../components/providers/MiniKitProvider';
import { getAppUrl } from '~/lib/miniapp';

const appUrl = getAppUrl();

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
        <link rel="preconnect" href="https://auth.farcaster.xyz" />
        <link rel="preconnect" href="https://image.mux.com" />
        <link rel="preconnect" href="https://stream.mux.com" crossOrigin="anonymous" />
        <link rel="preconnect" href="https://firestore.googleapis.com" />
        <link rel="preconnect" href="https://arweave.net" crossOrigin="anonymous" />
        <link rel="dns-prefetch" href="https://turbo-gateway.com" />
        <link rel="dns-prefetch" href="https://permagate.io" />
        <link rel="dns-prefetch" href="https://gateway.pinata.cloud" />
        <link rel="dns-prefetch" href="https://w3s.link" />
      </head>
      <body>
        <MiniKitContextProvider>
          <Providers>{children}</Providers>
        </MiniKitContextProvider>
      </body>
    </html>
  );
}