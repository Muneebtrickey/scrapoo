from celery import shared_task
from celery.exceptions import SoftTimeLimitExceeded
from django.utils import timezone

from .models import CrawlEvent, CrawlRun
from .services.engine import CrawlEngine


@shared_task(bind=True, autoretry_for=(), queue="crawls")
def run_crawl(self, run_id: str):
    run = CrawlRun.objects.select_related("project").get(pk=run_id)
    if run.status == CrawlRun.Status.CANCELLED:
        return {"status": "cancelled"}
    if run.task_id != self.request.id:
        run.task_id = self.request.id
        run.save(update_fields=["task_id"])
    try:
        CrawlEngine(run).execute()
    except SoftTimeLimitExceeded:
        run.status = CrawlRun.Status.PARTIAL if run.pages_stored else CrawlRun.Status.FAILED
        run.error_code = "TIME_LIMIT_REACHED"
        run.error_message = "The worker reached its configured time limit. Stored pages remain available."
        run.finished_at = timezone.now()
        run.save(update_fields=["status", "error_code", "error_message", "finished_at"])
        CrawlEvent.objects.create(run=run, level=CrawlEvent.Level.ERROR, code="TIME_LIMIT_REACHED", message=run.error_message)
        return {"status": run.status, "error": run.error_code}
    return {"status": run.status, "pages": run.pages_stored, "spend": str(run.estimated_cost)}
