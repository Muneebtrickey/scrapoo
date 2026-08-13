import ipaddress
import socket
from urllib.parse import parse_qsl, urlencode, urljoin, urlsplit, urlunsplit


TRACKING_PARAMETERS = {"fbclid", "gclid", "mc_cid", "mc_eid", "ref", "ref_src"}


class UnsafeTargetError(ValueError):
    code = "UNSAFE_TARGET"


def _validate_hostname(hostname: str, port: int) -> None:
    if hostname.lower() == "localhost" or hostname.lower().endswith(".localhost"):
        raise UnsafeTargetError("Localhost targets are not allowed.")
    try:
        records = socket.getaddrinfo(hostname, port, type=socket.SOCK_STREAM)
    except socket.gaierror as exc:
        raise UnsafeTargetError(f"Target hostname could not be resolved: {hostname}") from exc
    if not records:
        raise UnsafeTargetError(f"Target hostname returned no addresses: {hostname}")
    for record in records:
        raw_ip = record[4][0].split("%", 1)[0]
        address = ipaddress.ip_address(raw_ip)
        if not address.is_global:
            raise UnsafeTargetError(f"Target resolves to a non-public address: {address}")


def validate_public_url(url: str) -> str:
    try:
        parsed = urlsplit(url)
        port = parsed.port or (443 if parsed.scheme.lower() == "https" else 80)
    except ValueError as exc:
        raise UnsafeTargetError("Target URL has an invalid port.") from exc
    if parsed.scheme.lower() not in {"http", "https"}:
        raise UnsafeTargetError("Only HTTP and HTTPS targets are allowed.")
    if not parsed.hostname:
        raise UnsafeTargetError("Target URL must include a hostname.")
    if parsed.username or parsed.password:
        raise UnsafeTargetError("Credentials are not allowed in crawl URLs.")
    if not 1 <= port <= 65535:
        raise UnsafeTargetError("Target URL has an invalid port.")
    _validate_hostname(parsed.hostname, port)
    return url


def normalize_url(url: str, base_url: str | None = None) -> str:
    absolute = urljoin(base_url, url) if base_url else url
    parsed = urlsplit(absolute)
    scheme = parsed.scheme.lower()
    hostname = (parsed.hostname or "").lower().encode("idna").decode("ascii")
    port = parsed.port
    if port and not ((scheme == "http" and port == 80) or (scheme == "https" and port == 443)):
        hostname = f"{hostname}:{port}"
    path = parsed.path or "/"
    while "//" in path:
        path = path.replace("//", "/")
    query = [
        (key, value)
        for key, value in parse_qsl(parsed.query, keep_blank_values=True)
        if key.lower() not in TRACKING_PARAMETERS and not key.lower().startswith("utm_")
    ]
    return urlunsplit((scheme, hostname, path, urlencode(sorted(query)), ""))


def domain_is_allowed(url: str, allowed_domains: list[str]) -> bool:
    hostname = (urlsplit(url).hostname or "").lower()
    return any(hostname == domain.lower() or hostname.endswith(f".{domain.lower()}") for domain in allowed_domains)
