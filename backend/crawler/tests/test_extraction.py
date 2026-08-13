from crawler.services.extraction import extract_document


HTML = """
<html><head><title>Trail Shoe</title>
<script type="application/ld+json">{"@type":"Product","name":"Trail Shoe","price":"129.95"}</script>
</head><body>
<h1>Trail Shoe</h1><span class="current-price">$129.95</span>
<a href="/products/next?utm_source=email">Next</a>
</body></html>
"""


def test_selector_fallback_and_type_coercion():
    result = extract_document(HTML, "https://shop.example/products/shoe", {
        "price": {"selector": ".removed-selector", "fallback_selectors": [".current-price"], "type": "number"},
        "name": {"selector": ".missing", "semantic_key": "name"},
    })
    assert result.data == {"price": 129.95, "name": "Trail Shoe"}
    assert result.found_fields == {"price", "name"}
    assert result.links == ["https://shop.example/products/next?utm_source=email"]


def test_default_extraction_is_useful_without_a_schema():
    result = extract_document(HTML, "https://shop.example/products/shoe")
    assert result.title == "Trail Shoe"
    assert result.data["headings"] == ["Trail Shoe"]
    assert "Trail Shoe" in result.text
