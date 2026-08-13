from django.contrib import admin

from .models import CrawlEvent, CrawlProject, CrawlRun, ExtractionFieldMetric, ScrapedPage


@admin.register(CrawlProject)
class CrawlProjectAdmin(admin.ModelAdmin):
    list_display = ("name", "owner", "status", "start_url", "max_pages", "updated_at")
    list_filter = ("status", "respect_robots", "render_javascript")
    search_fields = ("name", "start_url", "owner__username")


@admin.register(CrawlRun)
class CrawlRunAdmin(admin.ModelAdmin):
    list_display = ("project", "status", "pages_stored", "failed_requests", "estimated_cost", "created_at")
    list_filter = ("status",)
    search_fields = ("project__name", "task_id", "error_code")


admin.site.register(ScrapedPage)
admin.site.register(ExtractionFieldMetric)
admin.site.register(CrawlEvent)
