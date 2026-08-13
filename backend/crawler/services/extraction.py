import json
import re
from dataclasses import dataclass
from typing import Any
from urllib.parse import urljoin

from bs4 import BeautifulSoup


@dataclass(slots=True)
class ExtractionResult:
    title: str
    text: str
    data: dict[str, Any]
    links: list[str]
    found_fields: set[str]


def _json_ld_documents(soup: BeautifulSoup) -> list[Any]:
    documents: list[Any] = []
    for script in soup.select('script[type="application/ld+json"]'):
        try:
            documents.append(json.loads(script.get_text(strip=True)))
        except (json.JSONDecodeError, TypeError):
            continue
    return documents


def _find_key(value: Any, key: str) -> Any:
    if isinstance(value, dict):
        if key in value and value[key] not in (None, "", []):
            return value[key]
        for child in value.values():
            found = _find_key(child, key)
            if found not in (None, "", []):
                return found
    elif isinstance(value, list):
        for child in value:
            found = _find_key(child, key)
            if found not in (None, "", []):
                return found
    return None


def _coerce(value: Any, field_type: str | None) -> Any:
    if value is None or not field_type:
        return value
    if field_type == "number":
        cleaned = re.sub(r"[^0-9.,-]", "", str(value)).replace(",", "")
        try:
            return float(cleaned)
        except ValueError:
            return value
    if field_type == "integer":
        try:
            return int(float(re.sub(r"[^0-9.-]", "", str(value))))
        except ValueError:
            return value
    if field_type == "boolean":
        return str(value).strip().lower() in {"1", "true", "yes", "in stock", "available"}
    return str(value).strip()


def _extract_field(soup: BeautifulSoup, json_ld: list[Any], name: str, raw_spec: Any) -> Any:
    spec = {"selector": raw_spec} if isinstance(raw_spec, str) else dict(raw_spec or {})
    selectors = [spec.get("selector"), *spec.get("fallback_selectors", [])]
    selectors = [selector for selector in selectors if selector]
    values: list[Any] = []
    for selector in selectors:
        try:
            matches = soup.select(selector)
        except Exception:
            continue
        for match in matches:
            attribute = spec.get("attribute")
            value = match.get(attribute) if attribute else match.get_text(" ", strip=True)
            if value not in (None, ""):
                values.append(value)
        if values:
            break
    if not values:
        semantic_key = spec.get("semantic_key", name.split(".")[-1])
        for document in json_ld:
            value = _find_key(document, semantic_key)
            if value not in (None, "", []):
                values = value if isinstance(value, list) else [value]
                break
    coerced = [_coerce(value, spec.get("type")) for value in values]
    return coerced if spec.get("multiple") else (coerced[0] if coerced else None)


def extract_document(html: str, url: str, schema: dict[str, Any] | None = None) -> ExtractionResult:
    soup = BeautifulSoup(html, "lxml")
    title = soup.title.get_text(" ", strip=True)[:500] if soup.title else ""
    links = []
    for anchor in soup.select("a[href]"):
        absolute = urljoin(url, anchor.get("href", ""))
        if absolute.startswith(("http://", "https://")):
            links.append(absolute)
    json_ld = _json_ld_documents(soup)
    structured: dict[str, Any] = {}
    found_fields: set[str] = set()
    for name, spec in (schema or {}).items():
        value = _extract_field(soup, json_ld, name, spec)
        structured[name] = value
        if value not in (None, "", []):
            found_fields.add(name)
    if not schema:
        description = soup.select_one('meta[name="description"], meta[property="og:description"]')
        structured = {
            "title": title,
            "description": description.get("content", "") if description else "",
            "headings": [node.get_text(" ", strip=True) for node in soup.select("h1, h2")[:30]],
        }
        found_fields = {name for name, value in structured.items() if value}
    for node in soup.select("script, style, noscript, template, svg"):
        node.decompose()
    text = "\n".join(line.strip() for line in soup.get_text("\n").splitlines() if line.strip())
    return ExtractionResult(title=title, text=text[:2_000_000], data=structured, links=list(dict.fromkeys(links)), found_fields=found_fields)
