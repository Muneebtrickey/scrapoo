const MAX_RESPONSE_BYTES = 1_500_000;
const MAX_TEXT_LENGTH = 30_000;
const MAX_LINKS = 100;
const MAX_HEADINGS = 60;
const MAX_REDIRECTS = 4;
const FETCH_TIMEOUT_MS = 15_000;

type FetchResult = {
  response: Response;
  finalUrl: URL;
};

function jsonError(error: string, status: number) {
  return Response.json({ error }, { status });
}

function normalizeUrl(value: unknown): URL {
  if (typeof value !== "string" || !value.trim()) throw new Error("Enter a webpage URL to scrape.");
  const input = value.trim();
  const withProtocol = /^[a-z][a-z\d+.-]*:\/\//i.test(input) ? input : `https://${input}`;
  let url: URL;
  try {
    url = new URL(withProtocol);
  } catch {
    throw new Error("Enter a valid webpage URL.");
  }
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Only HTTP and HTTPS webpages can be scraped.");
  if (url.username || url.password) throw new Error("URLs containing usernames or passwords are not allowed.");
  if (isPrivateHostname(url.hostname)) throw new Error("Local and private network addresses cannot be scraped.");
  return url;
}

function isPrivateHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".lan")) return true;
  if (host === "::" || host === "::1" || host.startsWith("fc") || host.startsWith("fd") || /^fe[89ab]/.test(host)) return true;
  if (host.startsWith("::ffff:")) return isPrivateHostname(host.slice(7));

  const octets = host.split(".");
  if (octets.length !== 4 || octets.some((part) => !/^\d+$/.test(part) || Number(part) > 255)) return false;
  const [a, b] = octets.map(Number);
  return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19));
}

async function fetchWithRedirectChecks(initialUrl: URL): Promise<FetchResult> {
  let currentUrl = initialUrl;
  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    if (isPrivateHostname(currentUrl.hostname)) throw new Error("The webpage redirected to a private address, so the scrape was stopped.");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(currentUrl, {
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "Accept": "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.2",
          "User-Agent": "Scrapoo/1.0 (+https://scrapoo.app)",
        },
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") throw new Error("The webpage took too long to respond.");
      throw new Error("The webpage could not be reached.");
    } finally {
      clearTimeout(timer);
    }

    if (![301, 302, 303, 307, 308].includes(response.status)) return { response, finalUrl: currentUrl };
    const location = response.headers.get("location");
    if (!location) throw new Error("The webpage returned an invalid redirect.");
    if (redirectCount === MAX_REDIRECTS) throw new Error("The webpage redirected too many times.");
    currentUrl = normalizeUrl(new URL(location, currentUrl).toString());
  }
  throw new Error("The webpage redirected too many times.");
}

async function readLimitedBody(response: Response): Promise<string> {
  const declaredSize = Number(response.headers.get("content-length") || 0);
  if (declaredSize > MAX_RESPONSE_BYTES) throw new Error("The webpage is too large to scrape in one request.");
  if (!response.body) return "";

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error("The webpage is too large to scrape in one request.");
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

function decodeEntities(value: string): string {
  const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
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
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = match[0];
    const name = extractAttribute(tag, "name").toLowerCase();
    const property = extractAttribute(tag, "property").toLowerCase();
    if (name === "description" || property === "og:description") return extractAttribute(tag, "content");
  }
  return "";
}

function extractHeadings(html: string): string[] {
  const headings: string[] = [];
  for (const match of html.matchAll(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/gi)) {
    const heading = cleanInlineHtml(match[1]);
    if (heading) headings.push(heading);
    if (headings.length >= MAX_HEADINGS) break;
  }
  return headings;
}

function extractLinks(html: string, baseUrl: URL): string[] {
  const links = new Set<string>();
  for (const match of html.matchAll(/<a\b[^>]*>/gi)) {
    const href = extractAttribute(match[0], "href");
    if (!href || href.startsWith("#") || /^(?:javascript|mailto|tel|data):/i.test(href)) continue;
    try {
      const link = new URL(href, baseUrl);
      if (["http:", "https:"].includes(link.protocol)) {
        link.hash = "";
        links.add(link.toString());
      }
    } catch {
      continue;
    }
    if (links.size >= MAX_LINKS) break;
  }
  return [...links];
}

function extractReadableText(html: string): string {
  const body = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? html;
  const text = body
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|template)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/?(?:p|div|section|article|main|header|footer|aside|nav|li|h[1-6]|br|tr|blockquote)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  return decodeEntities(text)
    .split(/\r?\n/)
    .map((line) => line.replace(/[\t ]+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
    .slice(0, MAX_TEXT_LENGTH);
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  let requestedUrl: URL;
  try {
    const payload = await request.json() as { url?: unknown };
    requestedUrl = normalizeUrl(payload.url);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Send a valid JSON request.", 400);
  }

  try {
    const { response, finalUrl } = await fetchWithRedirectChecks(requestedUrl);
    if (!response.ok) return jsonError(`The webpage returned HTTP ${response.status}.`, 422);
    const contentType = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() || "unknown";
    if (!contentType.startsWith("text/html") && !contentType.startsWith("application/xhtml+xml") && !contentType.startsWith("text/plain")) {
      return jsonError(`This URL returned ${contentType}, not a webpage.`, 415);
    }
    const html = await readLimitedBody(response);
    return Response.json({
      requestedUrl: requestedUrl.toString(),
      finalUrl: finalUrl.toString(),
      statusCode: response.status,
      contentType,
      durationMs: Date.now() - startedAt,
      scrapedAt: new Date().toISOString(),
      title: firstElementText(html, "title"),
      description: extractDescription(html),
      headings: extractHeadings(html),
      links: extractLinks(html, finalUrl),
      text: extractReadableText(html),
    });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "The webpage could not be scraped.", 502);
  }
}
