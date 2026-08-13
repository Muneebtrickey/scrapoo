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
    title: { default: "Scrapoo — resilient crawl control", template: "%s · Scrapoo" },
    description: "A professional web scraper control plane with extraction health, cost guards, and explainable failures.",
    icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
    openGraph: {
      title: "Scrapoo — resilient crawl control",
      description: "Know what changed. Control what you spend.",
      url: origin,
      siteName: "Scrapoo",
      images: [{ url: `${origin}/og.png`, width: 1536, height: 1024, alt: "Scrapoo resilient crawl control" }],
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title: "Scrapoo — resilient crawl control",
      description: "Know what changed. Control what you spend.",
      images: [`${origin}/og.png`],
    },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
