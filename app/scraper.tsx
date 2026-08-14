"use client";

import { useState } from "react";

type ScrapeResult = {
  requestedUrl: string;
  finalUrl: string;
  statusCode: number;
  contentType: string;
  durationMs: number;
  scrapedAt: string;
  title: string;
  description: string;
  headings: string[];
  links: string[];
  text: string;
};

function downloadResult(result: ScrapeResult) {
  const file = new Blob([JSON.stringify(result, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(file);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `scrapoo-${new URL(result.finalUrl).hostname}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function Scraper() {
  const [url, setUrl] = useState("");
  const [result, setResult] = useState<ScrapeResult | null>(null);
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
      const payload = await response.json() as ScrapeResult & { error?: string };
      if (!response.ok) throw new Error(payload.error || "The page could not be scraped.");
      setResult(payload);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The page could not be scraped.");
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
          <span className="eyebrow">Simple website scraping</span>
          <h1>Paste a URL.<br /><em>Get the page data.</em></h1>
          <p>Scrapoo extracts the useful content from a public webpage and gives it back to you as clean, downloadable data.</p>
        </div>

        <form className="scrape-form" onSubmit={scrape}>
          <label htmlFor="scrape-url">Webpage URL</label>
          <div className="url-row">
            <span className="protocol" aria-hidden="true">↗</span>
            <input
              id="scrape-url"
              name="url"
              type="url"
              inputMode="url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://example.com/page"
              required
            />
            <button type="submit" disabled={loading}>
              {loading ? <><i className="spinner" /> Scraping…</> : <>Scrape page <span>→</span></>}
            </button>
          </div>
          <p className="form-note">Public HTTP and HTTPS pages only. Results are limited to one page per request.</p>
        </form>

        {error && <div className="error-message" role="alert"><span>!</span><p><b>Scrape failed</b>{error}</p></div>}

        {!result && !error && (
          <section className="empty-result" aria-label="What Scrapoo extracts">
            <div className="empty-icon" aria-hidden="true"><i /><i /><i /></div>
            <div>
              <h2>Your scraped data will appear here</h2>
              <p>Each result includes the page title, meta description, headings, links, and readable text.</p>
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
                <span className="success-label"><i /> Scrape complete</span>
                <h2>{result.title || "Untitled page"}</h2>
                <a href={result.finalUrl} target="_blank" rel="noreferrer">{result.finalUrl}</a>
              </div>
              <div className="result-actions">
                <button type="button" onClick={copyResult}>{copied ? "Copied" : "Copy JSON"}</button>
                <button className="download-button" type="button" onClick={() => downloadResult(result)}>Download JSON</button>
              </div>
            </div>

            <div className="result-meta" aria-label="Scrape information">
              <span><b>{result.statusCode}</b> HTTP status</span>
              <span><b>{result.headings.length}</b> headings</span>
              <span><b>{result.links.length}</b> links</span>
              <span><b>{result.durationMs} ms</b> fetch time</span>
            </div>

            <div className="result-grid">
              <article className="result-card overview-card">
                <span className="card-kicker">Page details</span>
                <dl>
                  <div><dt>Title</dt><dd>{result.title || "No title found"}</dd></div>
                  <div><dt>Description</dt><dd>{result.description || "No meta description found"}</dd></div>
                  <div><dt>Content type</dt><dd>{result.contentType}</dd></div>
                </dl>
              </article>

              <article className="result-card headings-card">
                <span className="card-kicker">Headings</span>
                {result.headings.length ? (
                  <ol>{result.headings.map((heading, index) => <li key={`${heading}-${index}`}><span>{String(index + 1).padStart(2, "0")}</span>{heading}</li>)}</ol>
                ) : <p className="no-data">No headings found on this page.</p>}
              </article>

              <article className="result-card text-card">
                <span className="card-kicker">Readable page text</span>
                <pre>{result.text || "No readable text found on this page."}</pre>
              </article>

              <article className="result-card links-card">
                <span className="card-kicker">Links</span>
                {result.links.length ? (
                  <ul>{result.links.map((link) => <li key={link}><a href={link} target="_blank" rel="noreferrer">{link}</a></li>)}</ul>
                ) : <p className="no-data">No links found on this page.</p>}
              </article>
            </div>
          </section>
        )}
      </section>

      <footer>
        <span>Scrapoo</span>
        <p>Only scrape pages you are allowed to access.</p>
      </footer>
    </main>
  );
}
