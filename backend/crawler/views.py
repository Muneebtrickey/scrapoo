from datetime import timedelta
from decimal import Decimal
from urllib.parse import urlsplit

from celery import current_app
from django.db.models import Avg, Count, Sum
from django.db.models.functions import Coalesce
from django.utils import timezone
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .models import CrawlProject, CrawlRun, ScrapedPage
from .serializers import CrawlProjectSerializer, CrawlRunSerializer, ScrapedPageDetailSerializer, ScrapedPageSerializer
from .tasks import run_crawl


class CrawlProjectViewSet(viewsets.ModelViewSet):
    serializer_class = CrawlProjectSerializer

    def get_queryset(self):
        return CrawlProject.objects.filter(owner=self.request.user).prefetch_related("runs")

    def perform_create(self, serializer):
        serializer.save(owner=self.request.user)

    @action(detail=True, methods=["post"], url_path="run")
    def queue_run(self, request, pk=None):
        project = self.get_object()
        if project.status != CrawlProject.Status.ACTIVE:
            return Response({"error": {"code": "project_not_active", "message": "Activate the project before starting a run."}}, status=status.HTTP_409_CONFLICT)
        if project.runs.filter(status__in=[CrawlRun.Status.QUEUED, CrawlRun.Status.RUNNING]).exists():
            return Response({"error": {"code": "run_already_active", "message": "This project already has an active run."}}, status=status.HTTP_409_CONFLICT)
        run = CrawlRun.objects.create(project=project)
        try:
            task = run_crawl.apply_async(args=[str(run.id)], queue="crawls")
        except Exception as exc:
            run.status = CrawlRun.Status.FAILED
            run.error_code = "QUEUE_UNAVAILABLE"
            run.error_message = "The crawl queue is unavailable. The run can be retried after Redis is restored."
            run.finished_at = timezone.now()
            run.save(update_fields=["status", "error_code", "error_message", "finished_at"])
            return Response({"error": {"code": run.error_code, "message": run.error_message, "details": str(exc)}}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        run.task_id = task.id
        run.save(update_fields=["task_id"])
        return Response(CrawlRunSerializer(run).data, status=status.HTTP_202_ACCEPTED)


class CrawlRunViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    serializer_class = CrawlRunSerializer
    filterset_fields = ["status", "project"]

    def get_queryset(self):
        return CrawlRun.objects.filter(project__owner=self.request.user).select_related("project").prefetch_related("events", "field_metrics")

    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        run = self.get_object()
        if run.status not in {CrawlRun.Status.QUEUED, CrawlRun.Status.RUNNING}:
            return Response({"error": {"code": "run_not_active", "message": "Only queued or running crawls can be cancelled."}}, status=status.HTTP_409_CONFLICT)
        run.status = CrawlRun.Status.CANCELLED
        run.finished_at = timezone.now()
        run.save(update_fields=["status", "finished_at"])
        if run.task_id:
            current_app.control.revoke(run.task_id, terminate=False)
        return Response(CrawlRunSerializer(run).data)


class ScrapedPageViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    def get_queryset(self):
        queryset = ScrapedPage.objects.filter(run__project__owner=self.request.user).select_related("run", "run__project")
        if run_id := self.request.query_params.get("run"):
            queryset = queryset.filter(run_id=run_id)
        if status_code := self.request.query_params.get("status_code"):
            queryset = queryset.filter(status_code=status_code)
        return queryset

    def get_serializer_class(self):
        return ScrapedPageDetailSerializer if self.action == "retrieve" else ScrapedPageSerializer


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def dashboard(request):
    now = timezone.now()
    since = now - timedelta(days=7)
    runs = CrawlRun.objects.filter(project__owner=request.user, created_at__gte=since)
    summary = runs.aggregate(
        pages=Coalesce(Sum("pages_stored"), 0),
        spend=Coalesce(Sum("estimated_cost"), Decimal("0")),
        health=Coalesce(Avg("extraction_health"), Decimal("100")),
        failed=Count("id", filter=None),
    )
    recent = CrawlRun.objects.filter(project__owner=request.user).select_related("project")[:8]
    status_map = {
        CrawlRun.Status.QUEUED: "running", CrawlRun.Status.RUNNING: "running",
        CrawlRun.Status.SUCCEEDED: "healthy", CrawlRun.Status.PARTIAL: "warning",
        CrawlRun.Status.BUDGET_STOPPED: "warning", CrawlRun.Status.CANCELLED: "warning",
        CrawlRun.Status.FAILED: "failed",
    }
    recent_runs = []
    for run in recent:
        coverage = min(round((run.pages_visited / max(run.project.max_pages, 1)) * 100), 100)
        page_copy = f"{run.pages_visited:,} / {run.project.max_pages // 1000}k" if run.status in {CrawlRun.Status.QUEUED, CrawlRun.Status.RUNNING} else f"{run.pages_stored:,}"
        recent_runs.append({
            "id": str(run.id), "name": run.project.name, "domain": urlsplit(run.project.start_url).hostname,
            "status": status_map[run.status], "pages": page_copy, "coverage": coverage,
            "spend": f"${run.estimated_cost:.2f}", "updated": "Now" if run.status == CrawlRun.Status.RUNNING else run.created_at.isoformat(),
        })
    active_count = CrawlRun.objects.filter(project__owner=request.user, status__in=[CrawlRun.Status.QUEUED, CrawlRun.Status.RUNNING]).count()
    return Response({
        "summary": {"pages_collected": summary["pages"], "estimated_spend": summary["spend"], "extraction_health": summary["health"], "active_runs": active_count},
        "recent_runs": recent_runs,
    })
