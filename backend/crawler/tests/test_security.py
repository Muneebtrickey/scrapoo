from unittest.mock import patch

import httpx
import pytest

from crawler.services.engine import SafeHttpClient
from crawler.services.security import UnsafeTargetError, normalize_url, validate_public_url


PUBLIC_DNS = [(2, 1, 6, "", ("93.184.216.34", 443))]
PRIVATE_DNS = [(2, 1, 6, "", ("127.0.0.1", 80))]


def test_public_target_is_accepted():
    with patch("crawler.services.security.socket.getaddrinfo", return_value=PUBLIC_DNS):
        assert validate_public_url("https://example.com/catalog") == "https://example.com/catalog"


def test_private_target_is_rejected():
    with patch("crawler.services.security.socket.getaddrinfo", return_value=PRIVATE_DNS):
        with pytest.raises(UnsafeTargetError, match="non-public"):
            validate_public_url("http://internal.example/")


@pytest.mark.parametrize("url", ["file:///etc/passwd", "ftp://example.com/file", "http://user:secret@example.com/"])
def test_unsafe_url_shapes_are_rejected(url):
    with pytest.raises(UnsafeTargetError):
        validate_public_url(url)


def test_normalization_removes_tracking_and_fragments():
    assert normalize_url("https://EXAMPLE.com:443/a//b?utm_source=x&b=2&a=1#hero") == "https://example.com/a/b?a=1&b=2"


def test_redirect_to_private_network_is_revalidated():
    def handler(request):
        return httpx.Response(302, headers={"location": "http://127.0.0.1/admin"}, request=request)

    client = SafeHttpClient("ScrapooTest/1.0")
    client.client.close()
    client.client = httpx.Client(transport=httpx.MockTransport(handler), follow_redirects=False)
    try:
        with patch("crawler.services.security.socket.getaddrinfo", side_effect=lambda host, *args, **kwargs: PUBLIC_DNS if host == "example.com" else PRIVATE_DNS):
            with pytest.raises(UnsafeTargetError):
                client.fetch("https://example.com", retries=1)
    finally:
        client.close()
