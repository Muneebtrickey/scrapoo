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
    title: { default: "Scrapoo — 10-Page Website Scraper", template: "%s · Scrapoo" },
    description: "Paste a website URL and get clean, downloadable data from up to 10 same-site pages.",
    icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
    openGraph: {
      title: "Scrapoo — 10-Page Website Scraper",
      description: "Paste a URL. Scrape up to 10 pages.",
      url: origin,
      siteName: "Scrapoo",
      images: [{ url: `${origin}/og.png`, width: 1536, height: 1024, alt: "Scrapoo website scraper" }],
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title: "Scrapoo — 10-Page Website Scraper",
      description: "Paste a URL. Scrape up to 10 pages.",
      images: [`${origin}/og.png`],
    },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
