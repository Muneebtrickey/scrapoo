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

test("renders only the focused scraping experience", async () => {
  const response = await request();
  assert.equal(response.status, 200);
  const html = await response.text();

  assert.match(html, /<title>Scrape a webpage · Scrapoo<\/title>/i);
  assert.match(html, /Paste a URL/);
  assert.match(html, /Scrape page/);
  assert.match(html, /Your scraped data will appear here/);
  assert.doesNotMatch(html, /market research|control plane|spend protected|data explorer|needs attention/i);
});

test("rejects invalid scrape targets", async () => {
  const response = await request("/api/scrape", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url: "http://127.0.0.1/private" }),
  });
  assert.equal(response.status, 400);
  const payload = await response.json();
  assert.match(payload.error, /private network/i);
});
