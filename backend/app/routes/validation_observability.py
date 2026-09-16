import json
import logging
from typing import Callable, Coroutine

from fastapi import Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.routing import APIRoute

validation_logger = logging.getLogger("koma.validation")


def _safe_location(raw: object) -> list[str | int]:
    if not isinstance(raw, (list, tuple)):
        return []
    safe: list[str | int] = []
    for part in raw:
        if isinstance(part, bool):
            continue
        if isinstance(part, int):
            safe.append(part)
        elif isinstance(part, str):
            safe.append(part[:80])
    return safe[:8]


def _safe_validation_issues(exc: RequestValidationError) -> list[dict[str, object]]:
    issues: list[dict[str, object]] = []
    for error in exc.errors()[:12]:
        issues.append(
            {
                "loc": _safe_location(error.get("loc")),
                "type": str(error.get("type") or "validation_error")[:80],
            }
        )
    return issues


class ValidationObservabilityRoute(APIRoute):
    """Logs only validation metadata; request values/body are never logged."""

    def get_route_handler(self) -> Callable[[Request], Coroutine[object, object, Response]]:
        original_route_handler = super().get_route_handler()

        async def custom_route_handler(request: Request) -> Response:
            try:
                return await original_route_handler(request)
            except RequestValidationError as exc:
                validation_logger.warning(
                    json.dumps(
                        {
                            "event": "request_validation_failed",
                            "request_id": str(getattr(request.state, "request_id", ""))[:128],
                            "method": request.method,
                            "path": request.url.path,
                            "issues": _safe_validation_issues(exc),
                        },
                        separators=(",", ":"),
                        ensure_ascii=False,
                    )
                )
                raise

        return custom_route_handler
