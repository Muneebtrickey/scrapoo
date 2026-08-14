import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const origin = `${protocol}://${host}`;

  return {
    metadataBase: new URL(origin),
    title: { default: "Scrapoo — Simple Web Scraper", template: "%s · Scrapoo" },
    description: "Paste a public webpage URL and get clean, downloadable page data.",
    icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
    openGraph: {
      title: "Scrapoo — Simple Web Scraper",
      description: "Paste a URL. Get the page data.",
      url: origin,
      siteName: "Scrapoo",
      images: [{ url: `${origin}/og.png`, width: 1536, height: 1024, alt: "Scrapoo simple web scraper" }],
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title: "Scrapoo — Simple Web Scraper",
      description: "Paste a URL. Get the page data.",
      images: [`${origin}/og.png`],
    },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
