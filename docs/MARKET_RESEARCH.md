# Web scraper market pain points

Research snapshot: August 13, 2026. This review combines verified-review summaries, individual user reports, public issue trackers, and vendor release notes. Individual comments are anecdotal; repeated patterns across sources were treated as product signals rather than universal facts.

## What users repeatedly struggle with

| Market issue | Evidence found | Scrapoo product response |
| --- | --- | --- |
| Cost becomes difficult to predict at scale | [G2's Apify review summary](https://www.g2.com/products/apify/reviews) says high-volume pricing can become expensive. One detailed review specifically calls pre-run compute estimation guesswork. [G2's pros/cons rollup](https://www.g2.com/products/apify/reviews?qs=pros-and-cons) groups 88 mentions under pricing concerns. | A mandatory per-project spend cap, cost forecast before each request, `budget_stopped` status, and a `BUDGET_CAP_REACHED` event. |
| Powerful products still have a steep learning curve | G2's Apify pros/cons rollup groups 58 mentions around a steep learning curve. | A small default configuration, safe presets, plain-language event codes, and CSS selectors only when the user wants custom extraction. |
| Failures are vague and debugging is trial-and-error | A May 2026 verified Apify review describes vague deployment errors, repeated trial-and-error commits, lagging docs, and a sluggish dashboard for large portfolios. | Structured crawl events with stable codes, target URL, response status, context, and partial results retained after failures. |
| Site layout changes break extraction silently | Practitioners discussing multi-step scraping report that tools work until the HTML layout shifts, after which maintenance returns. | Per-field coverage metrics, a health threshold, stored samples, and `SELECTOR_DRIFT` warnings instead of silently exporting null-filled rows. |
| SDK options and platform behavior can diverge | [Firecrawl's release history](https://github.com/firecrawl/firecrawl/releases) notes Python SDK timeout, retry, and backoff parameters that had been accepted but silently ignored, alongside fixes for change tracking and PDF timeouts. | Server-side validation, explicit persisted run configuration, versioned extractor output, and tests around policy controls. |
| AI extraction can fail schema validation | [Firecrawl issue #1294](https://github.com/firecrawl/firecrawl/issues/1294) shows self-hosted extraction failing when model output does not satisfy the expected schema. | Deterministic CSS/semantic extraction first, type coercion that preserves the original value on mismatch, and field-by-field health rather than all-or-nothing output. |
| Crawlers can hang or exhaust shared resources | Crawlee's public issue tracker includes work on shared CPU/memory autoscaling budgets and crawler lifecycle ownership; an older [queue issue](https://github.com/apify/crawlee/issues/582) documents crawls stuck without finishing. | Hard page, depth, response-size, cost, redirect, retry, and worker time limits; late acknowledgements; partial-run finalization. |
| Anti-bot responses are expensive and poorly explained | G2 defines modern scraper tools partly by JavaScript and CAPTCHA handling, while public reviews repeatedly discuss IP bans, proxy management, and blocks as operational overhead. | Block classification, separate blocked-request counts, backoff for 429/5xx responses, optional browser rendering, and no false promise that every site can or should be bypassed. |
| Compliance and acceptable-use surprises interrupt projects | Public proxy-service reviews include accounts or use cases being disabled after compliance review. | Robots support enabled by default, domain scoping, an identifiable user agent, private-network blocking, and no built-in CAPTCHA bypass. |

## Product principles derived from the research

1. Never spend without a visible ceiling.
2. Never return a mystery failure when a stable reason code is possible.
3. Never treat a completed HTTP request as proof that extraction is healthy.
4. Preserve partial data and an audit trail when a run stops.
5. Default to responsible crawling: declared identity, domain limits, robots policy, delays, and no private-network access.
6. Keep the common path simple while making controls explicit for expert users.

## Deliberate non-goals for the first release

- Scrapoo does not bypass CAPTCHAs or promise universal anti-bot evasion.
- It does not scrape authenticated or private data without an explicit, auditable credential design.
- It does not use an LLM as the only extraction method.
- It does not hide proxy/browser costs behind a single opaque success metric.
