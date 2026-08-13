from decimal import Decimal
from urllib.parse import urlsplit

import soupsieve
from rest_framework import serializers

from .models import CrawlEvent, CrawlProject, CrawlRun, ExtractionFieldMetric, ScrapedPage
from .services.security import UnsafeTargetError, validate_public_url


class CrawlProjectSerializer(serializers.ModelSerializer):
    owner = serializers.CharField(source="owner.username", read_only=True)
    latest_run = serializers.SerializerMethodField()

    class Meta:
        model = CrawlProject
        fields = [
            "id", "owner", "name", "start_url", "allowed_domains", "status", "respect_robots",
            "render_javascript", "max_pages", "max_depth", "request_delay_ms", "concurrency",
            "spend_cap", "extraction_schema", "custom_headers", "schedule", "latest_run", "created_at", "updated_at",
        ]
        read_only_fields = ["id", "owner", "created_at", "updated_at", "latest_run"]

    def get_latest_run(self, obj):
        run = obj.runs.first()
        return {"id": run.id, "status": run.status, "created_at": run.created_at} if run else None

    def validate_start_url(self, value):
        try:
            validate_public_url(value)
        except UnsafeTargetError as exc:
            raise serializers.ValidationError(str(exc), code="unsafe_target") from exc
        return value

    def validate_allowed_domains(self, value):
        normalized = []
        for domain in value:
            candidate = str(domain).strip().lower().lstrip(".")
            if not candidate or "/" in candidate or ":" in candidate:
                raise serializers.ValidationError(f"Invalid allowed domain: {domain}")
            if candidate not in normalized:
                normalized.append(candidate)
        return normalized

    def validate_extraction_schema(self, value):
        if len(value) > 200:
            raise serializers.ValidationError("A project can monitor at most 200 extraction fields.")
        for name, raw_spec in value.items():
            if not name or len(name) > 180:
                raise serializers.ValidationError("Each field needs a name of 180 characters or fewer.")
            spec = {"selector": raw_spec} if isinstance(raw_spec, str) else raw_spec
            if not isinstance(spec, dict):
                raise serializers.ValidationError(f"Field {name} must be a selector string or an object.")
            for selector in [spec.get("selector"), *spec.get("fallback_selectors", [])]:
                if selector:
                    try:
                        soupsieve.compile(selector)
                    except soupsieve.SelectorSyntaxError as exc:
                        raise serializers.ValidationError(f"Field {name} has an invalid CSS selector: {selector}") from exc
        return value

    def validate(self, attrs):
        start_url = attrs.get("start_url", getattr(self.instance, "start_url", ""))
        if start_url and not attrs.get("allowed_domains") and not getattr(self.instance, "allowed_domains", None):
            attrs["allowed_domains"] = [urlsplit(start_url).hostname]
        spend_cap = attrs.get("spend_cap", getattr(self.instance, "spend_cap", Decimal("12")))
        if spend_cap < Decimal("0.01") or spend_cap > Decimal("10000"):
            raise serializers.ValidationError({"spend_cap": "Spend cap must be between $0.01 and $10,000."})
        return attrs


class CrawlEventSerializer(serializers.ModelSerializer):
    class Meta:
        model = CrawlEvent
        fields = ["id", "level", "code", "message", "details", "occurred_at"]


class ExtractionFieldMetricSerializer(serializers.ModelSerializer):
    class Meta:
        model = ExtractionFieldMetric
        fields = ["field_name", "total_pages", "values_found", "health_score", "drift_detected", "sample_values"]


class CrawlRunSerializer(serializers.ModelSerializer):
    project_name = serializers.CharField(source="project.name", read_only=True)
    project_url = serializers.CharField(source="project.start_url", read_only=True)
    events = CrawlEventSerializer(many=True, read_only=True)
    field_metrics = ExtractionFieldMetricSerializer(many=True, read_only=True)

    class Meta:
        model = CrawlRun
        fields = [
            "id", "project", "project_name", "project_url", "task_id", "status", "pages_visited", "pages_stored",
            "failed_requests", "blocked_requests", "duplicate_pages", "bytes_downloaded", "estimated_cost",
            "extraction_health", "error_code", "error_message", "started_at", "finished_at", "created_at",
            "metadata", "events", "field_metrics",
        ]
        read_only_fields = fields


class ScrapedPageSerializer(serializers.ModelSerializer):
    class Meta:
        model = ScrapedPage
        fields = ["id", "run", "url", "final_url", "status_code", "title", "content_type", "structured_data", "content_hash", "latency_ms", "fetched_at"]
        read_only_fields = fields


class ScrapedPageDetailSerializer(ScrapedPageSerializer):
    class Meta(ScrapedPageSerializer.Meta):
        fields = [*ScrapedPageSerializer.Meta.fields, "text_content", "response_headers"]
