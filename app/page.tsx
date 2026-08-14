import type { Metadata } from "next";
import { Scraper } from "./scraper";

export const metadata: Metadata = {
  title: "Scrape up to 10 website pages",
  description: "Crawl up to 10 same-site pages and extract titles, descriptions, headings, links, and readable text.",
};

export default function Home() {
  return <Scraper />;
}
