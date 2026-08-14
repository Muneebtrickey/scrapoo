"use client";

import { useState } from "react";

type CrawlLimits = {
  maxPages: number;
  maxDepth: number;
  concurrency: number;
  delayMs: number;
  timeoutMs: number;
  maxResponseBytes: number;
  maxRedirects: number;
  retries: number;
};

type ScrapedPage = {
  order: number;
  requestedUrl: string;
  finalUrl: string;
  depth: number;
  statusCode: number;
  contentType: string;
  durationMs: number;
  attempts: number;
  redirects: number;
  title: string;
  description: string;
  headings: string[];
  links: string[];
  text: string;
  textTruncated: boolean;
  wordCount: number;
};

type CrawlError = {
  order: number;
  url: string;
  depth: number;
  attempts: number;
  message: string;
};

type CrawlResult = {
  requestedUrl: string;
  siteOrigin: string;
  scrapedAt: string;
  durationMs: number;
  config: CrawlLimits;
  summary: {
    discoveredPages: number;
    attemptedPages: number;
    succeededPages: number;
    failedPages: number;
    pagesWithReadableText: number;
    totalHeadings: number;
    totalLinks: number;
    totalWords: number;
    maxDepthReached: number;
  };
  pages: ScrapedPage[];
  errors: CrawlError[];
};

function downloadResult(result: CrawlResult) {
  const file = new Blob([JSON.stringify(result, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(file);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `scrapoo-${new URL(result.siteOrigin).hostname}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function formatDuration(durationMs: number) {
  return durationMs >= 1_000 ? `${(durationMs / 1_000).toFixed(1)} s` : `${durationMs} ms`;
}

export function Scraper() {
  const [url, setUrl] = useState("");
  const [result, setResult] = useState<CrawlResult | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  async function scrape(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setResult(null);
    setCopied(false);

    try {
      const response = await fetch("/api/scrape", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const payload = await response.json() as CrawlResult & { error?: string };
      if (!response.ok) throw new Error(payload.error || "The website could not be scraped.");
      setResult(payload);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The website could not be scraped.");
    } finally {
      setLoading(false);
    }
  }

  async function copyResult() {
    if (!result) return;
    await navigator.clipboard.writeText(JSON.stringify(result, null, 2));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  return (
    <main className="site-shell">
      <header className="site-header">
        <a className="brand" href="#top" aria-label="Scrapoo home">
          <span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>
          <span>scrapoo</span>
        </a>
        <span className="header-label"><i /> Web scraper</span>
      </header>

      <section className="scraper-area" id="top">
        <div className="intro">
          <span className="eyebrow">Focused website crawling</span>
          <h1>Paste a URL.<br /><em>Scrape up to 10 pages.</em></h1>
          <p>Scrapoo follows links on the same website, extracts the useful content, and returns clean data for every page it reaches.</p>
        </div>

        <form className="scrape-form" onSubmit={scrape}>
          <label htmlFor="scrape-url">Website URL</label>
          <div className="url-row">
            <span className="protocol" aria-hidden="true">↗</span>
            <input
              id="scrape-url"
              name="url"
              type="url"
              inputMode="url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://example.com"
              required
            />
            <button type="submit" disabled={loading}>
              {loading ? <><i className="spinner" /> Crawling…</> : <>Scrape website <span>→</span></>}
            </button>
          </div>
          <p className="form-note">Public HTTP and HTTPS pages only. Scrapoo stays on the website you enter.</p>
        </form>

        <ul className="limits-grid" aria-label="Crawl limits">
          <li><b>10</b><span>pages maximum</span></li>
          <li><b>2</b><span>crawl depth</span></li>
          <li><b>2</b><span>concurrent requests</span></li>
          <li><b>750 ms</b><span>delay between pages</span></li>
          <li><b>15 s</b><span>timeout per page</span></li>
          <li><b>2 MB</b><span>maximum page size</span></li>
          <li><b>5</b><span>maximum redirects</span></li>
          <li><b>1</b><span>automatic retry</span></li>
        </ul>

        {error && <div className="error-message" role="alert"><span>!</span><p><b>Crawl failed</b>{error}</p></div>}

        {!result && !error && (
          <section className="empty-result" aria-label="What Scrapoo extracts">
            <div className="empty-icon" aria-hidden="true"><i /><i /><i /></div>
            <div>
              <h2>Your crawled pages will appear here</h2>
              <p>Each page includes its title, meta description, headings, links, and readable text.</p>
            </div>
            <ul aria-label="Extracted fields">
              <li><span>01</span> Page details</li>
              <li><span>02</span> Headings</li>
              <li><span>03</span> Links</li>
              <li><span>04</span> Page text</li>
            </ul>
          </section>
        )}

        {result && (
          <section className="results" aria-live="polite">
            <div className="result-heading">
              <div>
                <span className={`success-label ${result.summary.failedPages ? "partial" : ""}`}><i /> {result.summary.failedPages ? "Crawl completed with warnings" : "Crawl complete"}</span>
                <h2>{result.summary.succeededPages} {result.summary.succeededPages === 1 ? "page" : "pages"} scraped from {new URL(result.siteOrigin).hostname}</h2>
                <a href={result.requestedUrl} target="_blank" rel="noreferrer">{result.requestedUrl}</a>
              </div>
              <div className="result-actions">
                <button type="button" onClick={copyResult}>{copied ? "Copied" : "Copy JSON"}</button>
                <button className="download-button" type="button" onClick={() => downloadResult(result)}>Download JSON</button>
              </div>
            </div>

            <div className="result-meta" aria-label="Crawl summary">
              <span><b>{result.summary.succeededPages}/{result.summary.attemptedPages}</b> pages scraped</span>
              <span><b>{result.summary.failedPages}</b> pages failed</span>
              <span><b>{result.summary.totalWords.toLocaleString()}</b> words extracted</span>
              <span><b>{formatDuration(result.durationMs)}</b> crawl time</span>
            </div>

            {result.errors.length > 0 && (
              <section className="crawl-warnings" aria-label="Pages that could not be scraped">
                <span className="card-kicker">Pages skipped</span>
                <ul>{result.errors.map((item) => <li key={`${item.order}-${item.url}`}><span>!</span><div><a href={item.url} target="_blank" rel="noreferrer">{item.url}</a><p>{item.message} · {item.attempts} {item.attempts === 1 ? "attempt" : "attempts"}</p></div></li>)}</ul>
              </section>
            )}

            <div className="page-results">
              {result.pages.map((page) => (
                <article className="page-result" key={`${page.order}-${page.finalUrl}`}>
                  <div className="page-result-heading">
                    <div>
                      <span className="page-number">Page {page.order + 1} · Depth {page.depth}</span>
                      <h3>{page.title || "Untitled page"}</h3>
                      <a href={page.finalUrl} target="_blank" rel="noreferrer">{page.finalUrl}</a>
                    </div>
                    <span className="http-status">HTTP {page.statusCode}</span>
                  </div>

                  {page.description && <p className="page-description">{page.description}</p>}

                  <dl className="page-stats">
                    <div><dt>Words</dt><dd>{page.wordCount.toLocaleString()}</dd></div>
                    <div><dt>Headings</dt><dd>{page.headings.length}</dd></div>
                    <div><dt>Links</dt><dd>{page.links.length}</dd></div>
                    <div><dt>Attempts</dt><dd>{page.attempts}</dd></div>
                    <div><dt>Redirects</dt><dd>{page.redirects}</dd></div>
                    <div><dt>Fetch time</dt><dd>{formatDuration(page.durationMs)}</dd></div>
                  </dl>

                  <details>
                    <summary>View extracted content <span>＋</span></summary>
                    <div className="page-content">
                      <section>
                        <span className="card-kicker">Headings</span>
                        {page.headings.length ? <ol>{page.headings.map((heading, index) => <li key={`${heading}-${index}`}><span>{String(index + 1).padStart(2, "0")}</span>{heading}</li>)}</ol> : <p>No headings found.</p>}
                      </section>
                      <section>
                        <span className="card-kicker">Readable page text</span>
                        <pre>{page.text || "No readable text found."}</pre>
                        {page.textTruncated && <p className="truncated-note">Text was capped at 50,000 characters for a reliable export.</p>}
                      </section>
                      <section>
                        <span className="card-kicker">Links</span>
                        {page.links.length ? <ul className="page-links">{page.links.map((link) => <li key={link}><a href={link} target="_blank" rel="noreferrer">{link}</a></li>)}</ul> : <p>No links found.</p>}
                      </section>
                    </div>
                  </details>
                </article>
              ))}
            </div>
          </section>
        )}
      </section>

      <footer>
        <span>Scrapoo</span>
        <p>Only scrape websites you are allowed to access.</p>
      </footer>
    </main>
  );
}
