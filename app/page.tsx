import type { Metadata } from "next";
import { Scraper } from "./scraper";

export const metadata: Metadata = {
  title: "Scrape a webpage",
  description: "Paste a public webpage URL and extract its title, headings, links, and readable text.",
};

export default function Home() {
  return <Scraper />;
}
