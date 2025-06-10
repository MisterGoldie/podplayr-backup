import { Metadata } from "next";

const appUrl = process.env.NEXT_PUBLIC_URL;

const frame = {
  version: "next",
  imageUrl: `${appUrl}/image.png`,
  button: {
    title: "Enter PODPLAYR",
    action: {
      type: "launch_frame",
      name: "PODPLAYR",
      url: appUrl,
      splashImageUrl: `${appUrl}/splash.png`,
      splashBackgroundColor: "#000000",
    },
  },
};

export const revalidate = 300;

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: "PODPLAYR",
    openGraph: {
      title: "PODPLAYR",
      description: "Listen & Watch NFTs on PODPLAYR",
      images: [
        {
          url: `${appUrl}/image.png`,
          width: 1200,
          height: 630,
          alt: "PODPLAYR Media Player",
        },
      ],
    },
    other: {
      "fc:frame": JSON.stringify(frame),
    },
  };
} 