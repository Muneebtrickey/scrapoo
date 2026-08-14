import assert from "node:assert/strict";
import test from "node:test";

async function request(path = "/", init) {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-${Math.random()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request(`http://localhost${path}`, init),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

async function scrape(url) {
  return request("/api/scrape", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url }),
  });
}

async function withMockedFetch(mock, callback) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mock;
  try {
    return await callback();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function html(title, body, links = []) {
  return `<!doctype html><html><head><title>${title}</title><meta content="Accurate description" name="description"></head><body><main><h1>${title}</h1><p>${body}</p>${links.map((link) => `<a href="${link}">${link}</a>`).join("")}<script>secret noise</script></main></body></html>`;
}

test("renders the focused 10-page scraping experience", async () => {
  const response = await request();
  assert.equal(response.status, 200);
  const rendered = await response.text();

  assert.match(rendered, /<title>Scrape up to 10 website pages · Scrapoo<\/title>/i);
  assert.match(rendered, /Scrape up to 10 pages/);
  assert.match(rendered, /Scrape website/);
  assert.match(rendered, /10.*pages maximum/s);
  assert.match(rendered, /750 ms.*delay between pages/s);
  assert.doesNotMatch(rendered, /market research|control plane|spend protected|data explorer|needs attention/i);
});

test("crawls at most 10 same-site pages to depth 2 with bounded concurrency, delay, redirects, and retry", { timeout: 30_000 }, async () => {
  const firstRequestTimes = [];
  const firstSeen = new Set();
  const requestedPaths = [];
  const counts = new Map();
  let inFlight = 0;
  let maximumInFlight = 0;

  const pages = new Map([
    ["/", html("Root &amp; Home", "Useful root content", ["/section-a", "/section-b", "/section-a#duplicate", "https://outside.example/page"])],
    ["/section-a", html("Section A", "Section A content", ["/a-1", "/a-2?utm_source=test", "/a-3", "/a-4"])],
    ["/section-b", html("Section B", "Section B content", ["/retry", "/redirect-0", "/b-3", "/b-4"])],
    ["/a-1", html("A1", "A1 content")],
    ["/a-2", html("A2", "A2 content")],
    ["/a-3", html("A3", "A3 content")],
    ["/a-4", html("A4", "A4 content")],
    ["/retry", html("Retry page", "Recovered after retry")],
    ["/b-3", html("B3", "B3 content")],
    ["/b-4", html("B4", "B4 content")],
  ]);

  await withMockedFetch(async (input) => {
    const target = input instanceof URL ? input : new URL(typeof input === "string" ? input : input.url);
    requestedPaths.push(target.pathname);
    counts.set(target.pathname, (counts.get(target.pathname) ?? 0) + 1);
    if (!firstSeen.has(target.pathname) && !/^\/redirect-[1-5]$/.test(target.pathname)) {
      firstSeen.add(target.pathname);
      firstRequestTimes.push(Date.now());
    }

    inFlight += 1;
    maximumInFlight = Math.max(maximumInFlight, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 800));
    inFlight -= 1;

    if (target.pathname === "/retry" && counts.get(target.pathname) === 1) {
      return new Response("temporary", { status: 503, headers: { "content-type": "text/html" } });
    }
    const redirectMatch = target.pathname.match(/^\/redirect-(\d)$/);
    if (redirectMatch) {
      const redirectNumber = Number(redirectMatch[1]);
      if (redirectNumber < 5) return new Response(null, { status: 302, headers: { location: `/redirect-${redirectNumber + 1}` } });
      return new Response(html("Redirected", "Five redirects succeeded"), { status: 200, headers: { "content-type": "text/html" } });
    }
    return new Response(pages.get(target.pathname) ?? html("Extra", "Extra page"), { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
  }, async () => {
    const response = await scrape("https://site.example/");
    assert.equal(response.status, 200);
    const result = await response.json();

    assert.deepEqual(result.config, {
      maxPages: 10,
      maxDepth: 2,
      concurrency: 2,
      delayMs: 750,
      timeoutMs: 15_000,
      maxResponseBytes: 2_000_000,
      maxRedirects: 5,
      retries: 1,
    });
    assert.equal(result.summary.attemptedPages, 10);
    assert.equal(result.summary.succeededPages, 10);
    assert.equal(result.summary.failedPages, 0);
    assert.equal(result.summary.maxDepthReached, 2);
    assert.equal(result.pages[0].title, "Root & Home");
    assert.equal(result.pages[0].description, "Accurate description");
    assert.match(result.pages[0].text, /Useful root content/);
    assert.doesNotMatch(result.pages[0].text, /secret noise/);
    assert.ok(result.pages.some((page) => page.attempts === 2), "expected one recovered retry");
    assert.ok(result.pages.some((page) => page.redirects === 5), "expected a five-redirect page");
    assert.equal(maximumInFlight, 2);
    assert.ok(result.pages.every((page) => page.depth <= 2));
    assert.ok(!requestedPaths.includes("/page"), "external links must not be requested");
    for (let index = 1; index < firstRequestTimes.length; index += 1) {
      assert.ok(firstRequestTimes[index] - firstRequestTimes[index - 1] >= 700, "page starts should respect the 750 ms delay");
    }
  });
});

test("records oversized pages as a bounded failure", async () => {
  await withMockedFetch(async () => new Response("", {
    status: 200,
    headers: { "content-type": "text/html", "content-length": "2000001" },
  }), async () => {
    const response = await scrape("https://large.example/");
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.summary.attemptedPages, 1);
    assert.equal(result.summary.succeededPages, 0);
    assert.equal(result.summary.failedPages, 1);
    assert.match(result.errors[0].message, /2 MB size limit/i);
  });
});

test("rejects invalid and private crawl targets", async () => {
  const response = await scrape("http://127.0.0.1/private");
  assert.equal(response.status, 400);
  const payload = await response.json();
  assert.match(payload.error, /private network/i);
});
