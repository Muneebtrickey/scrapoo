import hashlib
import os
import random
import time
import urllib.robotparser
from collections import defaultdict, deque
from dataclasses import dataclass
from decimal import Decimal
from urllib.parse import urljoin, urlsplit

import httpx
from django.db import transaction
from django.utils import timezone

from crawler.models import CrawlEvent, CrawlRun, ExtractionFieldMetric, ScrapedPage

from .extraction import extract_document
from .security import UnsafeTargetError, domain_is_allowed, normalize_url, validate_public_url


class FetchError(RuntimeError):
    code = "FETCH_FAILED"


class ResponseTooLargeError(FetchError):
    code = "RESPONSE_TOO_LARGE"


@dataclass(slots=True)
class FetchedDocument:
    requested_url: str
    final_url: str
    status_code: int
    content: bytes
    headers: dict[str, str]
    latency_ms: int

    @property
    def text(self) -> str:
        charset = "utf-8"
        content_type = self.headers.get("content-type", "")
        if "charset=" in content_type:
            charset = content_type.split("charset=", 1)[1].split(";", 1)[0].strip()
        return self.content.decode(charset, errors="replace")


class SafeHttpClient:
    retryable_statuses = {408, 425, 429, 500, 502, 503, 504}

    def __init__(self, user_agent: str, timeout_seconds: float = 25, max_response_bytes: int = 8_000_000):
        self.max_response_bytes = max_response_bytes
        self.client = httpx.Client(
            follow_redirects=False,
            timeout=httpx.Timeout(timeout_seconds, connect=10),
            headers={"User-Agent": user_agent, "Accept": "text/html,application/xhtml+xml,application/json;q=0.8,*/*;q=0.5"},
            limits=httpx.Limits(max_connections=10, max_keepalive_connections=5),
        )

    def close(self):
        self.client.close()

    def fetch(self, url: str, *, headers: dict | None = None, retries: int = 3, max_bytes: int | None = None) -> FetchedDocument:
        last_error: Exception | None = None
        for attempt in range(retries):
            try:
                document = self._fetch_redirect_chain(url, headers=headers, max_bytes=max_bytes)
                if document.status_code not in self.retryable_statuses or attempt == retries - 1:
                    return document
                retry_after = float(document.headers.get("retry-after", "0") or 0)
                time.sleep(min(retry_after or (2 ** attempt + random.random()), 20))
            except (httpx.HTTPError, FetchError) as exc:
                last_error = exc
                if attempt == retries - 1:
                    break
                time.sleep(min(2 ** attempt + random.random(), 10))
        raise FetchError(str(last_error or "Request failed")) from last_error

    def _fetch_redirect_chain(self, url: str, *, headers: dict | None, max_bytes: int | None) -> FetchedDocument:
        requested_url = url
        current_url = url
        started = time.monotonic()
        for _ in range(6):
            validate_public_url(current_url)
            with self.client.stream("GET", current_url, headers=headers or {}) as response:
                if response.is_redirect:
                    location = response.headers.get("location")
                    if not location:
                        raise FetchError("Redirect response did not include a Location header.")
                    current_url = normalize_url(urljoin(current_url, location))
                    continue
                limit = max_bytes or self.max_response_bytes
                declared_length = int(response.headers.get("content-length", "0") or 0)
                if declared_length > limit:
                    raise ResponseTooLargeError(f"Response declared {declared_length} bytes; limit is {limit}.")
                chunks: list[bytes] = []
                received = 0
                for chunk in response.iter_bytes():
                    received += len(chunk)
                    if received > limit:
                        raise ResponseTooLargeError(f"Response exceeded the {limit}-byte limit.")
                    chunks.append(chunk)
                return FetchedDocument(
                    requested_url=requested_url,
                    final_url=str(response.url),
                    status_code=response.status_code,
                    content=b"".join(chunks),
                    headers={key.lower(): value for key, value in response.headers.items()},
                    latency_ms=int((time.monotonic() - started) * 1000),
                )
        raise FetchError("Redirect limit exceeded.")


class BrowserRenderer:
    def __init__(self, user_agent: str, timeout_ms: int = 35_000):
        from playwright.sync_api import sync_playwright

        self.timeout_ms = timeout_ms
        self.playwright = sync_playwright().start()
        self.browser = self.playwright.chromium.launch(headless=True)
        self.context = self.browser.new_context(user_agent=user_agent, service_workers="block")
        self.context.route("**/*", self._route_request)

    @staticmethod
    def _route_request(route):
        request = route.request
        if request.resource_type in {"image", "font", "media"}:
            route.abort()
            return
        try:
            validate_public_url(request.url)
        except UnsafeTargetError:
            route.abort()
            return
        route.continue_()

    def fetch(self, url: str) -> FetchedDocument:
        validate_public_url(url)
        page = self.context.new_page()
        started = time.monotonic()
        try:
            response = page.goto(url, wait_until="domcontentloaded", timeout=self.timeout_ms)
            page.wait_for_timeout(500)
            final_url = page.url
            validate_public_url(final_url)
            html = page.content().encode("utf-8")
            return FetchedDocument(
                requested_url=url,
                final_url=final_url,
                status_code=response.status if response else 200,
                content=html,
                headers={"content-type": "text/html; charset=utf-8"},
                latency_ms=int((time.monotonic() - started) * 1000),
            )
        finally:
            page.close()

    def close(self):
        self.context.close()
        self.browser.close()
        self.playwright.stop()


class CrawlEngine:
    HTTP_REQUEST_COST = Decimal("0.0002")
    BROWSER_REQUEST_COST = Decimal("0.0030")
    DRIFT_THRESHOLD = Decimal("90.00")

    def __init__(self, run: CrawlRun):
        self.run = run
        self.project = run.project
        self.user_agent = os.getenv("SCRAPER_USER_AGENT", "ScrapooBot/0.1 (+https://example.com/crawler-policy)")
        self.client = SafeHttpClient(self.user_agent)
        self.renderer = BrowserRenderer(self.user_agent) if self.project.render_javascript else None
        start_domain = (urlsplit(self.project.start_url).hostname or "").lower()
        self.allowed_domains = self.project.allowed_domains or [start_domain]
        self.robots: dict[str, urllib.robotparser.RobotFileParser] = {}
        self.last_request_at: dict[str, float] = defaultdict(float)
        self.field_stats = {name: {"total": 0, "found": 0, "samples": []} for name in self.project.extraction_schema}
        self.content_hashes: set[str] = set()

    def event(self, level: str, code: str, message: str, **details):
        CrawlEvent.objects.create(run=self.run, level=level, code=code, message=message[:500], details=details)

    def execute(self):
        self.run.status = CrawlRun.Status.RUNNING
        self.run.started_at = timezone.now()
        self.run.error_code = ""
        self.run.error_message = ""
        self.run.save(update_fields=["status", "started_at", "error_code", "error_message"])
        self.event(CrawlEvent.Level.INFO, "RUN_STARTED", "Crawl worker started.", start_url=self.project.start_url)
        try:
            self._crawl()
            self._finish()
        except Exception as exc:
            self.run.status = CrawlRun.Status.FAILED
            self.run.error_code = getattr(exc, "code", "UNEXPECTED_ERROR")
            self.run.error_message = str(exc)[:2_000]
            self.run.finished_at = timezone.now()
            self.run.save(update_fields=["status", "error_code", "error_message", "finished_at"])
            self.event(CrawlEvent.Level.ERROR, self.run.error_code, "Crawl stopped after an unrecoverable error.", error=str(exc)[:1_000])
            raise
        finally:
            if self.renderer:
                self.renderer.close()
            self.client.close()

    def _crawl(self):
        queue = deque([(normalize_url(self.project.start_url), 0)])
        seen: set[str] = set()
        while queue and self.run.pages_visited < self.project.max_pages:
            url, depth = queue.popleft()
            if url in seen or not domain_is_allowed(url, self.allowed_domains):
                continue
            seen.add(url)
            if len(seen) % 25 == 0:
                status = CrawlRun.objects.filter(pk=self.run.pk).values_list("status", flat=True).first()
                if status == CrawlRun.Status.CANCELLED:
                    self.run.status = CrawlRun.Status.CANCELLED
                    self.event(CrawlEvent.Level.WARNING, "RUN_CANCELLED", "Run cancellation was acknowledged by the worker.")
                    break
            unit_cost = self.BROWSER_REQUEST_COST if self.renderer else self.HTTP_REQUEST_COST
            if self.run.estimated_cost + unit_cost > self.project.spend_cap:
                self.run.status = CrawlRun.Status.BUDGET_STOPPED
                self.event(CrawlEvent.Level.WARNING, "BUDGET_CAP_REACHED", "Run paused before exceeding its configured spend cap.", spend=str(self.run.estimated_cost), cap=str(self.project.spend_cap))
                break
            try:
                validate_public_url(url)
                if self.project.respect_robots and not self._robots_allowed(url):
                    self.event(CrawlEvent.Level.INFO, "ROBOTS_DISALLOWED", "URL skipped because robots.txt disallows it.", url=url)
                    continue
                self._throttle(url)
                document = self.renderer.fetch(url) if self.renderer else self.client.fetch(url, headers=self.project.custom_headers)
                self.run.estimated_cost += unit_cost
                self.run.pages_visited += 1
                self.run.bytes_downloaded += len(document.content)
            except (UnsafeTargetError, FetchError) as exc:
                self.run.failed_requests += 1
                self.event(CrawlEvent.Level.ERROR, getattr(exc, "code", "FETCH_FAILED"), "Request failed and the crawl continued.", url=url, error=str(exc))
                continue

            if self._looks_blocked(document):
                self.run.blocked_requests += 1
                self.event(CrawlEvent.Level.WARNING, "ANTI_BOT_BLOCK", "The target appears to have returned an anti-bot response.", url=url, status=document.status_code)
            if not 200 <= document.status_code < 300:
                self.run.failed_requests += 1
                self.event(CrawlEvent.Level.WARNING, "HTTP_ERROR", f"Target returned HTTP {document.status_code}.", url=url, status=document.status_code)
                continue
            content_type = document.headers.get("content-type", "")
            if not any(kind in content_type for kind in ("html", "xml", "json")):
                self.event(CrawlEvent.Level.INFO, "CONTENT_SKIPPED", "Non-text response was not extracted.", url=url, content_type=content_type)
                continue

            result = extract_document(document.text, document.final_url, self.project.extraction_schema)
            digest = hashlib.sha256((result.text + repr(sorted(result.data.items()))).encode("utf-8", errors="ignore")).hexdigest()
            if digest in self.content_hashes:
                self.run.duplicate_pages += 1
            else:
                self.content_hashes.add(digest)
            safe_headers = {key: value for key, value in document.headers.items() if key not in {"set-cookie", "authorization", "proxy-authorization"}}
            ScrapedPage.objects.update_or_create(
                run=self.run,
                url=url,
                defaults={
                    "final_url": document.final_url,
                    "status_code": document.status_code,
                    "title": result.title,
                    "content_type": content_type[:160],
                    "text_content": result.text,
                    "structured_data": result.data,
                    "response_headers": safe_headers,
                    "content_hash": digest,
                    "latency_ms": document.latency_ms,
                },
            )
            self.run.pages_stored += 1
            self._record_fields(result.found_fields, result.data)
            if depth < self.project.max_depth:
                for discovered in result.links:
                    try:
                        candidate = normalize_url(discovered, document.final_url)
                    except ValueError:
                        continue
                    if candidate not in seen and domain_is_allowed(candidate, self.allowed_domains) and len(queue) < self.project.max_pages * 4:
                        queue.append((candidate, depth + 1))
            if self.run.pages_visited % 10 == 0:
                self.run.save(update_fields=["pages_visited", "pages_stored", "failed_requests", "blocked_requests", "duplicate_pages", "bytes_downloaded", "estimated_cost"])

    def _robots_allowed(self, url: str) -> bool:
        parsed = urlsplit(url)
        origin = f"{parsed.scheme}://{parsed.netloc}"
        if origin not in self.robots:
            parser = urllib.robotparser.RobotFileParser()
            parser.set_url(f"{origin}/robots.txt")
            try:
                response = self.client.fetch(parser.url, retries=1, max_bytes=512_000)
                parser.parse(response.text.splitlines() if response.status_code == 200 else [])
            except (FetchError, UnsafeTargetError) as exc:
                parser.parse([])
                self.event(CrawlEvent.Level.WARNING, "ROBOTS_UNAVAILABLE", "robots.txt could not be read; the default allow policy was used.", origin=origin, error=str(exc))
            self.robots[origin] = parser
        return self.robots[origin].can_fetch(self.user_agent, url)

    def _throttle(self, url: str):
        domain = urlsplit(url).netloc.lower()
        delay = self.project.request_delay_ms / 1_000
        remaining = delay - (time.monotonic() - self.last_request_at[domain])
        if remaining > 0:
            time.sleep(remaining)
        self.last_request_at[domain] = time.monotonic()

    @staticmethod
    def _looks_blocked(document: FetchedDocument) -> bool:
        if document.status_code in {401, 403, 407, 429}:
            return True
        sample = document.text[:50_000].lower()
        indicators = ("cf-chl-", "captcha", "verify you are human", "access denied", "datadome")
        return any(indicator in sample for indicator in indicators)

    def _record_fields(self, found_fields: set[str], data: dict):
        for name, stats in self.field_stats.items():
            stats["total"] += 1
            if name in found_fields:
                stats["found"] += 1
                value = data.get(name)
                if len(stats["samples"]) < 5 and value not in stats["samples"]:
                    stats["samples"].append(value)

    @transaction.atomic
    def _finish(self):
        scores: list[Decimal] = []
        for name, stats in self.field_stats.items():
            score = Decimal("100") if not stats["total"] else (Decimal(stats["found"]) / Decimal(stats["total"]) * 100).quantize(Decimal("0.01"))
            scores.append(score)
            ExtractionFieldMetric.objects.update_or_create(
                run=self.run,
                field_name=name,
                defaults={"total_pages": stats["total"], "values_found": stats["found"], "health_score": score, "drift_detected": score < self.DRIFT_THRESHOLD, "sample_values": stats["samples"]},
            )
            if score < self.DRIFT_THRESHOLD:
                self.event(CrawlEvent.Level.WARNING, "SELECTOR_DRIFT", "A field fell below its extraction health threshold.", field=name, health=str(score))
        self.run.extraction_health = (sum(scores) / len(scores)).quantize(Decimal("0.01")) if scores else Decimal("100")
        if self.run.status == CrawlRun.Status.RUNNING:
            self.run.status = CrawlRun.Status.PARTIAL if self.run.failed_requests or self.run.blocked_requests else CrawlRun.Status.SUCCEEDED
        self.run.finished_at = timezone.now()
        self.run.save(update_fields=["status", "pages_visited", "pages_stored", "failed_requests", "blocked_requests", "duplicate_pages", "bytes_downloaded", "estimated_cost", "extraction_health", "finished_at"])
        self.event(CrawlEvent.Level.INFO, "RUN_FINISHED", "Crawl worker finished.", status=self.run.status, pages=self.run.pages_stored, health=str(self.run.extraction_health), spend=str(self.run.estimated_cost))
