from django.contrib import admin
from django.http import JsonResponse
from django.urls import include, path
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView


def health(_request):
    return JsonResponse({"status": "ok", "service": "scrapoo-api"})


urlpatterns = [
    path("admin/", admin.site.urls),
    path("health/", health),
    path("api/auth/token/", TokenObtainPairView.as_view(), name="token_obtain_pair"),
    path("api/auth/token/refresh/", TokenRefreshView.as_view(), name="token_refresh"),
    path("api/", include("crawler.urls")),
]
