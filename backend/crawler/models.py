import uuid

from django.conf import settings
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models


class CrawlProject(models.Model):
    class Status(models.TextChoices):
        ACTIVE = "active", "Active"
        PAUSED = "paused", "Paused"
        ARCHIVED = "archived", "Archived"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="crawl_projects")
    name = models.CharField(max_length=160)
    start_url = models.URLField(max_length=2048)
    allowed_domains = models.JSONField(default=list, blank=True)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.ACTIVE)
    respect_robots = models.BooleanField(default=True)
    render_javascript = models.BooleanField(default=False)
    max_pages = models.PositiveIntegerField(default=5_000, validators=[MaxValueValidator(1_000_000)])
    max_depth = models.PositiveSmallIntegerField(default=5, validators=[MaxValueValidator(50)])
    request_delay_ms = models.PositiveIntegerField(default=750, validators=[MaxValueValidator(120_000)])
    concurrency = models.PositiveSmallIntegerField(default=2, validators=[MinValueValidator(1), MaxValueValidator(32)])
    spend_cap = models.DecimalField(max_digits=10, decimal_places=2, default=12)
    extraction_schema = models.JSONField(default=dict, blank=True)
    custom_headers = models.JSONField(default=dict, blank=True)
    schedule = models.CharField(max_length=80, blank=True, help_text="Optional cron expression")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at"]
        constraints = [models.UniqueConstraint(fields=["owner", "name"], name="unique_project_name_per_owner")]
        indexes = [models.Index(fields=["owner", "status"], name="project_owner_status_idx")]

    def __str__(self):
        return self.name


class CrawlRun(models.Model):
    class Status(models.TextChoices):
        QUEUED = "queued", "Queued"
        RUNNING = "running", "Running"
        SUCCEEDED = "succeeded", "Succeeded"
        PARTIAL = "partial", "Partial"
        FAILED = "failed", "Failed"
        CANCELLED = "cancelled", "Cancelled"
        BUDGET_STOPPED = "budget_stopped", "Budget stopped"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    project = models.ForeignKey(CrawlProject, on_delete=models.CASCADE, related_name="runs")
    task_id = models.CharField(max_length=255, blank=True, db_index=True)
    status = models.CharField(max_length=24, choices=Status.choices, default=Status.QUEUED, db_index=True)
    pages_visited = models.PositiveIntegerField(default=0)
    pages_stored = models.PositiveIntegerField(default=0)
    failed_requests = models.PositiveIntegerField(default=0)
    blocked_requests = models.PositiveIntegerField(default=0)
    duplicate_pages = models.PositiveIntegerField(default=0)
    bytes_downloaded = models.PositiveBigIntegerField(default=0)
    estimated_cost = models.DecimalField(max_digits=12, decimal_places=4, default=0)
    extraction_health = models.DecimalField(max_digits=5, decimal_places=2, default=100)
    error_code = models.CharField(max_length=80, blank=True)
    error_message = models.TextField(blank=True)
    started_at = models.DateTimeField(null=True, blank=True)
    finished_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    metadata = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["project", "-created_at"], name="run_project_created_idx"),
            models.Index(fields=["status", "-created_at"], name="run_status_created_idx"),
        ]

    def __str__(self):
        return f"{self.project.name} · {self.created_at:%Y-%m-%d %H:%M}"


class ScrapedPage(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    run = models.ForeignKey(CrawlRun, on_delete=models.CASCADE, related_name="pages")
    url = models.URLField(max_length=2048)
    final_url = models.URLField(max_length=2048)
    status_code = models.PositiveSmallIntegerField()
    title = models.CharField(max_length=500, blank=True)
    content_type = models.CharField(max_length=160, blank=True)
    text_content = models.TextField(blank=True)
    structured_data = models.JSONField(default=dict, blank=True)
    response_headers = models.JSONField(default=dict, blank=True)
    content_hash = models.CharField(max_length=64, db_index=True)
    extractor_version = models.CharField(max_length=32, default="1.0")
    latency_ms = models.PositiveIntegerField(default=0)
    fetched_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-fetched_at"]
        constraints = [models.UniqueConstraint(fields=["run", "url"], name="unique_url_per_run")]
        indexes = [
            models.Index(fields=["run", "status_code"], name="page_run_status_idx"),
            models.Index(fields=["run", "content_hash"], name="page_run_hash_idx"),
        ]


class ExtractionFieldMetric(models.Model):
    run = models.ForeignKey(CrawlRun, on_delete=models.CASCADE, related_name="field_metrics")
    field_name = models.CharField(max_length=180)
    total_pages = models.PositiveIntegerField(default=0)
    values_found = models.PositiveIntegerField(default=0)
    health_score = models.DecimalField(max_digits=5, decimal_places=2, default=100)
    drift_detected = models.BooleanField(default=False)
    sample_values = models.JSONField(default=list, blank=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["run", "field_name"], name="unique_metric_per_run_field")]
        ordering = ["health_score", "field_name"]


class CrawlEvent(models.Model):
    class Level(models.TextChoices):
        DEBUG = "debug", "Debug"
        INFO = "info", "Info"
        WARNING = "warning", "Warning"
        ERROR = "error", "Error"

    run = models.ForeignKey(CrawlRun, on_delete=models.CASCADE, related_name="events")
    level = models.CharField(max_length=12, choices=Level.choices, default=Level.INFO)
    code = models.CharField(max_length=80, db_index=True)
    message = models.CharField(max_length=500)
    details = models.JSONField(default=dict, blank=True)
    occurred_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["-occurred_at"]
        indexes = [models.Index(fields=["run", "-occurred_at"], name="event_run_time_idx")]
