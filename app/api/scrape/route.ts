const CRAWL_LIMITS = {
  maxPages: 10,
  maxDepth: 2,
  concurrency: 2,
  delayMs: 750,
  timeoutMs: 15_000,
  maxResponseBytes: 2_000_000,
  maxRedirects: 5,
  retries: 1,
} as const;

const MAX_TEXT_LENGTH = 50_000;
const MAX_LINKS_PER_PAGE = 200;
const MAX_HEADINGS_PER_PAGE = 80;
const RETRYABLE_STATUS_CODES = new Set([408, 425, 429, 500, 502, 503, 504]);
const SKIPPED_FILE_EXTENSIONS = /\.(?:7z|avi|avif|bmp|css|csv|docx?|eot|epub|exe|gif|gz|ico|jpe?g|js|json|m4a|mov|mp3|mp4|mpeg|ogg|otf|pdf|png|pptx?|rar|rss|svg|tar|tiff?|ttf|txt|wav|webm|webp|woff2?|xlsx?|xml|zip)$/i;
const TRACKING_PARAMETER = /^(?:utm_[a-z]+|fbclid|gclid|dclid|msclkid|mc_cid|mc_eid)$/i;

type QueueItem = {
  url: URL;
  depth: number;
};

type FetchResult = {
  response: Response;
  finalUrl: URL;
  redirects: number;
};

type LoadedPage = FetchResult & {
  html: string;
  contentType: string;
  attempts: number;
  durationMs: number;
};

type CrawlError = {
  order: number;
  url: string;
  depth: number;
  attempts: number;
  message: string;
};

class ScrapeFailure extends Error {
  retryable: boolean;

  constructor(message: string, retryable = false) {
    super(message);
    this.name = "ScrapeFailure";
    this.retryable = retryable;
  }
}

function jsonError(error: string, status: number) {
  return Response.json({ error }, { status });
}

function normalizeUrl(value: unknown, base?: URL): URL {
  if (typeof value !== "string" || !value.trim()) throw new ScrapeFailure("Enter a website URL to scrape.");
  const input = value.trim();
  const withProtocol = base || /^[a-z][a-z\d+.-]*:\/\//i.test(input) ? input : `https://${input}`;
  let url: URL;
  try {
    url = new URL(withProtocol, base);
  } catch {
    throw new ScrapeFailure("Enter a valid website URL.");
  }
  if (!["http:", "https:"].includes(url.protocol)) throw new ScrapeFailure("Only HTTP and HTTPS websites can be scraped.");
  if (url.username || url.password) throw new ScrapeFailure("URLs containing usernames or passwords are not allowed.");
  if (isPrivateHostname(url.hostname)) throw new ScrapeFailure("Local and private network addresses cannot be scraped.");
  url.hash = "";
  return url;
}

function canonicalizeUrl(value: string, base: URL): URL | null {
  let url: URL;
  try {
    url = normalizeUrl(value, base);
  } catch {
    return null;
  }

  const sortedParameters = [...url.searchParams.entries()]
    .filter(([name]) => !TRACKING_PARAMETER.test(name))
    .sort(([leftName, leftValue], [rightName, rightValue]) => leftName.localeCompare(rightName) || leftValue.localeCompare(rightValue));
  url.search = "";
  for (const [name, parameterValue] of sortedParameters) url.searchParams.append(name, parameterValue);
  return url;
}

function isPrivateHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!host || host === "localhost" || host === "metadata" || host === "metadata.google.internal" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".lan")) return true;
  if (host === "::" || host === "::1" || host.startsWith("fc") || host.startsWith("fd") || /^fe[89ab]/.test(host)) return true;
  if (host.startsWith("::ffff:")) return isPrivateHostname(host.slice(7));

  const octets = host.split(".");
  if (octets.length !== 4 || octets.some((part) => !/^\d+$/.test(part) || Number(part) > 255)) return false;
  const [a, b] = octets.map(Number);
  return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19));
}

function isCrawlablePage(url: URL, scopeOrigin: string): boolean {
  return url.origin === scopeOrigin && !SKIPPED_FILE_EXTENSIONS.test(url.pathname);
}

function createRequestRateLimiter() {
  let nextRequestAt = Date.now();
  return async () => {
    const now = Date.now();
    const scheduledAt = Math.max(now, nextRequestAt);
    nextRequestAt = scheduledAt + CRAWL_LIMITS.delayMs;
    const waitMs = scheduledAt - now;
    if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
  };
}

async function fetchWithRedirectChecks(initialUrl: URL, scopeOrigin?: string): Promise<FetchResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CRAWL_LIMITS.timeoutMs);
  let currentUrl = initialUrl;

  try {
    for (let redirectCount = 0; redirectCount <= CRAWL_LIMITS.maxRedirects; redirectCount += 1) {
      if (isPrivateHostname(currentUrl.hostname)) throw new ScrapeFailure("The page redirected to a private address, so it was skipped.");
      if (scopeOrigin && currentUrl.origin !== scopeOrigin) throw new ScrapeFailure("The page redirected outside the starting website, so it was skipped.");

      let response: Response;
      try {
        response = await fetch(currentUrl, {
          redirect: "manual",
          signal: controller.signal,
          headers: {
            "Accept": "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.2",
            "Accept-Language": "en-US,en;q=0.8",
            "User-Agent": "Scrapoo/1.0 (+https://scrapoo.app)",
          },
        });
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") throw new ScrapeFailure("The page exceeded the 15-second timeout.", true);
        throw new ScrapeFailure("The page could not be reached.", true);
      }

      if (![301, 302, 303, 307, 308].includes(response.status)) {
        if (RETRYABLE_STATUS_CODES.has(response.status)) {
          await response.body?.cancel();
          throw new ScrapeFailure(`The page returned HTTP ${response.status}.`, true);
        }
        return { response, finalUrl: currentUrl, redirects: redirectCount };
      }

      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location) throw new ScrapeFailure("The page returned an invalid redirect.");
      if (redirectCount === CRAWL_LIMITS.maxRedirects) throw new ScrapeFailure("The page exceeded the 5-redirect limit.");
      currentUrl = normalizeUrl(location, currentUrl);
    }
  } finally {
    clearTimeout(timer);
  }

  throw new ScrapeFailure("The page exceeded the 5-redirect limit.");
}

async function readLimitedBody(response: Response): Promise<string> {
  const declaredSize = Number(response.headers.get("content-length") || 0);
  if (declaredSize > CRAWL_LIMITS.maxResponseBytes) throw new ScrapeFailure("The page exceeded the 2 MB size limit.");
  if (!response.body) return "";

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > CRAWL_LIMITS.maxResponseBytes) {
      await reader.cancel();
      throw new ScrapeFailure("The page exceeded the 2 MB size limit.");
    }
    chunks.push(value);
  }

  const combined = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(combined);
}

async function loadPage(url: URL, scopeOrigin: string | undefined, waitForRequestSlot: () => Promise<void>): Promise<LoadedPage> {
  const startedAt = Date.now();
  let lastError = new ScrapeFailure("The page could not be scraped.");

  for (let attempt = 1; attempt <= CRAWL_LIMITS.retries + 1; attempt += 1) {
    await waitForRequestSlot();
    try {
      const fetched = await fetchWithRedirectChecks(url, scopeOrigin);
      if (!fetched.response.ok) {
        await fetched.response.body?.cancel();
        throw new ScrapeFailure(`The page returned HTTP ${fetched.response.status}.`);
      }

      const contentType = fetched.response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() || "unknown";
      if (!contentType.startsWith("text/html") && !contentType.startsWith("application/xhtml+xml") && !contentType.startsWith("text/plain")) {
        await fetched.response.body?.cancel();
        throw new ScrapeFailure(`The URL returned ${contentType}, not a webpage.`);
      }

      const html = await readLimitedBody(fetched.response);
      return { ...fetched, html, contentType, attempts: attempt, durationMs: Date.now() - startedAt };
    } catch (error) {
      lastError = error instanceof ScrapeFailure ? error : new ScrapeFailure("The page could not be scraped.", true);
      if (!lastError.retryable || attempt > CRAWL_LIMITS.retries) {
        Object.assign(lastError, { attempts: attempt });
        throw lastError;
      }
    }
  }

  throw lastError;
}

function decodeEntities(value: string): string {
  const named: Record<string, string> = {
    amp: "&", apos: "'", bull: "•", copy: "©", gt: ">", hellip: "…", ldquo: "“", lsquo: "‘",
    lt: "<", mdash: "—", middot: "·", nbsp: " ", ndash: "–", quot: '"', rdquo: "”", reg: "®",
    rsquo: "’", trade: "™",
  };
  return value.replace(/&(#\d+|#x[\da-f]+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] === "#") {
      const hex = entity[1]?.toLowerCase() === "x";
      const codePoint = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isFinite(codePoint) && codePoint > 0 ? String.fromCodePoint(codePoint) : match;
    }
    return named[entity.toLowerCase()] ?? match;
  });
}

function cleanInlineHtml(value: string): string {
  return decodeEntities(value.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function extractAttribute(tag: string, attribute: string): string {
  const pattern = new RegExp(`\\b${attribute}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i");
  const match = tag.match(pattern);
  return decodeEntities(match?.[1] ?? match?.[2] ?? match?.[3] ?? "").trim();
}

function firstElementText(html: string, tagName: string): string {
  const match = html.match(new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i"));
  return match ? cleanInlineHtml(match[1]) : "";
}

function extractDescription(html: string): string {
  let openGraphDescription = "";
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = match[0];
    const name = extractAttribute(tag, "name").toLowerCase();
    const property = extractAttribute(tag, "property").toLowerCase();
    if (name === "description") return extractAttribute(tag, "content");
    if (property === "og:description") openGraphDescription ||= extractAttribute(tag, "content");
  }
  return openGraphDescription;
}

function extractHeadings(html: string): string[] {
  const headings: string[] = [];
  for (const match of html.matchAll(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/gi)) {
    const heading = cleanInlineHtml(match[1]);
    if (heading) headings.push(heading);
    if (headings.length >= MAX_HEADINGS_PER_PAGE) break;
  }
  return headings;
}

function extractLinks(html: string, baseUrl: URL): string[] {
  const links = new Set<string>();
  for (const match of html.matchAll(/<a\b[^>]*>/gi)) {
    const href = extractAttribute(match[0], "href");
    if (!href || href.startsWith("#") || /^(?:javascript|mailto|tel|data):/i.test(href)) continue;
    const link = canonicalizeUrl(href, baseUrl);
    if (link) links.add(link.toString());
    if (links.size >= MAX_LINKS_PER_PAGE) break;
  }
  return [...links];
}

function extractReadableText(html: string): { text: string; truncated: boolean } {
  const mainContent = html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1] ?? html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)?.[1];
  let content = mainContent ?? html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? html;
  content = content
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|template|iframe|canvas)\b[^>]*>[\s\S]*?<\/\1>/gi, " ");
  if (!mainContent) content = content.replace(/<(nav|header|footer|aside)\b[^>]*>[\s\S]*?<\/\1>/gi, " ");
  const normalized = decodeEntities(content
    .replace(/<\/?(?:p|div|section|article|main|header|footer|aside|nav|li|h[1-6]|br|tr|blockquote|figcaption|dt|dd)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " "))
    .split(/\r?\n/)
    .map((line) => line.replace(/[\t ]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
  return { text: normalized.slice(0, MAX_TEXT_LENGTH), truncated: normalized.length > MAX_TEXT_LENGTH };
}

function wordCount(text: string): number {
  return text ? text.split(/\s+/).filter(Boolean).length : 0;
}

function extractPage(loaded: LoadedPage, depth: number, order: number) {
  const headings = extractHeadings(loaded.html);
  const links = extractLinks(loaded.html, loaded.finalUrl);
  const readable = extractReadableText(loaded.html);
  return {
    order,
    requestedUrl: loaded.finalUrl.toString(),
    finalUrl: loaded.finalUrl.toString(),
    depth,
    statusCode: loaded.response.status,
    contentType: loaded.contentType,
    durationMs: loaded.durationMs,
    attempts: loaded.attempts,
    redirects: loaded.redirects,
    title: firstElementText(loaded.html, "title"),
    description: extractDescription(loaded.html),
    headings,
    links,
    text: readable.text,
    textTruncated: readable.truncated,
    wordCount: wordCount(readable.text),
  };
}

export async function POST(request: Request) {
  const crawlStartedAt = Date.now();
  let requestedUrl: URL;
  try {
    const payload = await request.json() as { url?: unknown };
    requestedUrl = normalizeUrl(payload.url);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Send a valid JSON request.", 400);
  }

  const queue: QueueItem[] = [{ url: requestedUrl, depth: 0 }];
  const seen = new Set([requestedUrl.toString()]);
  const pages: ReturnType<typeof extractPage>[] = [];
  const errors: CrawlError[] = [];
  const active = new Set<Promise<void>>();
  const waitForRequestSlot = createRequestRateLimiter();
  let scheduledPages = 0;
  let discoveredPages = 1;
  let scopeOrigin: string | undefined;

  const processPage = async (item: QueueItem, order: number) => {
    try {
      const loaded = await loadPage(item.url, item.depth === 0 ? undefined : scopeOrigin, waitForRequestSlot);
      if (!scopeOrigin) scopeOrigin = loaded.finalUrl.origin;
      const page = extractPage(loaded, item.depth, order);
      page.requestedUrl = item.url.toString();
      pages.push(page);

      if (item.depth >= CRAWL_LIMITS.maxDepth || !scopeOrigin) return;
      for (const rawLink of page.links) {
        if (scheduledPages + queue.length >= CRAWL_LIMITS.maxPages) break;
        const link = canonicalizeUrl(rawLink, loaded.finalUrl);
        if (!link || !isCrawlablePage(link, scopeOrigin) || seen.has(link.toString())) continue;
        seen.add(link.toString());
        queue.push({ url: link, depth: item.depth + 1 });
        discoveredPages += 1;
      }
    } catch (error) {
      const failure = error instanceof Error ? error : new Error("The page could not be scraped.");
      const attempts = typeof (failure as Error & { attempts?: unknown }).attempts === "number" ? (failure as Error & { attempts: number }).attempts : 1;
      errors.push({ order, url: item.url.toString(), depth: item.depth, attempts, message: failure.message });
    }
  };

  while ((queue.length > 0 || active.size > 0) && (scheduledPages < CRAWL_LIMITS.maxPages || active.size > 0)) {
    while (queue.length > 0 && active.size < CRAWL_LIMITS.concurrency && scheduledPages < CRAWL_LIMITS.maxPages) {
      const item = queue.shift();
      if (!item) break;
      const order = scheduledPages;
      scheduledPages += 1;
      const task = processPage(item, order).finally(() => active.delete(task));
      active.add(task);
    }
    if (active.size > 0) await Promise.race(active);
  }

  pages.sort((left, right) => left.order - right.order);
  errors.sort((left, right) => left.order - right.order);
  const uniqueLinks = new Set(pages.flatMap((page) => page.links));
  const pagesWithReadableText = pages.filter((page) => page.wordCount > 0).length;

  return Response.json({
    requestedUrl: requestedUrl.toString(),
    siteOrigin: scopeOrigin ?? requestedUrl.origin,
    scrapedAt: new Date().toISOString(),
    durationMs: Date.now() - crawlStartedAt,
    config: CRAWL_LIMITS,
    summary: {
      discoveredPages,
      attemptedPages: scheduledPages,
      succeededPages: pages.length,
      failedPages: errors.length,
      pagesWithReadableText,
      totalHeadings: pages.reduce((total, page) => total + page.headings.length, 0),
      totalLinks: uniqueLinks.size,
      totalWords: pages.reduce((total, page) => total + page.wordCount, 0),
      maxDepthReached: Math.max(0, ...pages.map((page) => page.depth), ...errors.map((error) => error.depth)),
    },
    pages,
    errors,
  });
}
