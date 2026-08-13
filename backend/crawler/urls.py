from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import CrawlProjectViewSet, CrawlRunViewSet, ScrapedPageViewSet, dashboard

router = DefaultRouter()
router.register("projects", CrawlProjectViewSet, basename="project")
router.register("runs", CrawlRunViewSet, basename="run")
router.register("pages", ScrapedPageViewSet, basename="page")

urlpatterns = [path("dashboard/", dashboard, name="dashboard"), path("", include(router.urls))]
