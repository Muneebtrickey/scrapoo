import type { Metadata } from "next";
import { ScrapooDashboard } from "./scrapoo-dashboard";

export const metadata: Metadata = {
  title: "Crawl control",
  description: "Monitor resilient crawls, extraction health, and spend from one control plane.",
};

export default function Home() {
  return <ScrapooDashboard />;
}
