"""Atribuição leve de aquisição para pedidos do cardápio público.

Não persiste IP, User-Agent bruto, URL completa de referência ou PII do cliente.
"""

from __future__ import annotations

import datetime
from typing import Any
from urllib.parse import urlsplit

from fastapi import Request


MAX_ATTR_LENGTH = 160


def _clean(value: object, *, limit: int = MAX_ATTR_LENGTH) -> str | None:
    if value is None:
        return None
    normalized = " ".join(str(value).strip().split())
    return normalized[:limit] or None


def _platform_from_user_agent(user_agent: str) -> str:
    ua = user_agent.casefold()
    if "instagram" in ua:
        return "instagram"
    if "fban/" in ua or "fbav/" in ua or "facebook" in ua:
        return "facebook"
    if "whatsapp" in ua:
        return "whatsapp"
    if "tiktok" in ua:
        return "tiktok"
    if "googleapp" in ua:
        return "google"
    return "browser"


def _safe_referrer_host(value: object) -> str | None:
    raw = _clean(value, limit=500)
    if not raw:
        return None
    try:
        parsed = urlsplit(raw if "://" in raw else f"https://{raw}")
    except ValueError:
        return None
    host = (parsed.hostname or "").casefold().strip(".")
    return host[:160] or None


def _safe_first_seen(value: object) -> str:
    raw = _clean(value, limit=64)
    if raw:
        try:
            parsed = datetime.datetime.fromisoformat(raw.replace("Z", "+00:00"))
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=datetime.timezone.utc)
            return parsed.astimezone(datetime.timezone.utc).isoformat()
        except ValueError:
            pass
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def build_order_attribution(client_data: Any, request: Request) -> dict[str, Any]:
    raw = client_data if isinstance(client_data, dict) else {}
    user_agent = request.headers.get("user-agent", "")
    platform = _platform_from_user_agent(user_agent)

    header_referrer = request.headers.get("referer")
    referrer_host = _safe_referrer_host(header_referrer) or _safe_referrer_host(raw.get("referrer_host"))

    utm_source = _clean(raw.get("utm_source"))
    source = utm_source or platform

    return {
        "source": source,
        "platform": platform,
        "utm_source": utm_source,
        "utm_medium": _clean(raw.get("utm_medium")),
        "utm_campaign": _clean(raw.get("utm_campaign")),
        "utm_content": _clean(raw.get("utm_content")),
        "utm_term": _clean(raw.get("utm_term")),
        "referrer_host": referrer_host,
        "entry_path": _clean(raw.get("entry_path"), limit=240),
        "first_seen_at": _safe_first_seen(raw.get("first_seen_at")),
    }
