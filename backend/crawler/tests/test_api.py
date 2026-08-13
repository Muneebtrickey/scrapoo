from unittest.mock import patch

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from crawler.models import CrawlProject


@pytest.mark.django_db
def test_projects_are_scoped_to_the_authenticated_owner():
    user_model = get_user_model()
    owner = user_model.objects.create_user(username="owner", password="strong-test-password")
    other = user_model.objects.create_user(username="other", password="strong-test-password")
    client = APIClient()
    client.force_authenticate(owner)
    with patch("crawler.serializers.validate_public_url", return_value="https://example.com"):
        response = client.post("/api/projects/", {"name": "Catalog", "start_url": "https://example.com", "spend_cap": "5.00"}, format="json")
    assert response.status_code == 201
    assert CrawlProject.objects.get().owner == owner
    client.force_authenticate(other)
    listing = client.get("/api/projects/")
    assert listing.status_code == 200
    assert listing.data["count"] == 0


@pytest.mark.django_db
def test_unauthenticated_project_access_is_rejected():
    response = APIClient().get("/api/projects/")
    assert response.status_code == 401


@pytest.mark.django_db
def test_dashboard_returns_frontend_contract():
    user = get_user_model().objects.create_user(username="viewer", password="strong-test-password")
    client = APIClient()
    client.force_authenticate(user)
    response = client.get("/api/dashboard/")
    assert response.status_code == 200
    assert response.data["recent_runs"] == []
    assert response.data["summary"]["active_runs"] == 0
