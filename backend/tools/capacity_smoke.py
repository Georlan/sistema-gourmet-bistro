#!/usr/bin/env python3
from __future__ import annotations

import concurrent.futures
import os
import statistics
import sys
import time
from dataclasses import dataclass
from urllib.parse import urlparse

import httpx

DEFAULT_CONCURRENCY = 10
DEFAULT_REQUESTS_PER_WORKER = 12
DEFAULT_TIMEOUT_MS = 5000
DEFAULT_P95_LIMIT_MS = 2000

READ_ONLY_PATHS = (
    "/health/ready",
    "/caixa/configuracoes",
    "/caixa/turno-atual/resumo",
    "/comandas/delivery/ativos",
    "/produtos/categorias",
)

FORBIDDEN_HOSTS = {
    "sistema-gourmet-bistro-production.up.railway.app",
    "sistema-gourmet-bistro.pages.dev",
}


@dataclass(frozen=True)
class Result:
    path: str
    status: int
    elapsed_ms: float
    error: str | None = None

    @property
    def ok(self) -> bool:
        return 200 <= self.status < 300 and self.error is None


def positive_int(name: str, fallback: int) -> int:
    raw = os.getenv(name, str(fallback))
    try:
        value = int(raw)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{name} deve ser um número positivo") from exc
    if value <= 0:
        raise ValueError(f"{name} deve ser um número positivo")
    return value


def percentile(values: list[float], ratio: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, int(len(ordered) * ratio + 0.999999) - 1))
    return ordered[index]


def assert_non_production_target(raw_url: str) -> tuple[str, str]:
    parsed = urlparse(raw_url)
    host = (parsed.hostname or "").lower()
    if not parsed.scheme or not host:
        raise ValueError("KOMA_CAPACITY_API_URL inválida.")
    if host in FORBIDDEN_HOSTS or any(host.endswith(f".{item}") for item in FORBIDDEN_HOSTS):
        raise ValueError("Capacity smoke bloqueado contra produção. Use somente homologação.")

    allowed = os.getenv("KOMA_CAPACITY_ALLOW_HOST", "").strip().lower()
    if not allowed:
        raise ValueError("Defina KOMA_CAPACITY_ALLOW_HOST explicitamente para homologação.")
    if host != allowed:
        raise ValueError(f"Host {host} difere de KOMA_CAPACITY_ALLOW_HOST={allowed}")

    return raw_url.rstrip("/"), host


def resolve_tokens(base_url: str, timeout_seconds: float) -> list[str]:
    configured = [item.strip() for item in os.getenv("KOMA_CAPACITY_TOKENS", "").split(",") if item.strip()]
    if configured:
        return configured

    username = os.getenv("KOMA_CAPACITY_LOGIN_EMAIL", "").strip()
    password = os.getenv("KOMA_CAPACITY_LOGIN_PASSWORD", "")
    restaurant_id_raw = os.getenv("KOMA_CAPACITY_LOGIN_RESTAURANT_ID", "").strip()

    if not username and not password and not restaurant_id_raw:
        return []
    if not username or not password:
        raise ValueError("Defina KOMA_CAPACITY_LOGIN_EMAIL e KOMA_CAPACITY_LOGIN_PASSWORD juntos.")

    payload: dict[str, object] = {"username": username, "password": password}
    if restaurant_id_raw:
        try:
            restaurant_id = int(restaurant_id_raw)
        except ValueError as exc:
            raise ValueError("KOMA_CAPACITY_LOGIN_RESTAURANT_ID deve ser um inteiro positivo.") from exc
        if restaurant_id <= 0:
            raise ValueError("KOMA_CAPACITY_LOGIN_RESTAURANT_ID deve ser um inteiro positivo.")
        payload["restaurante_id"] = restaurant_id

    with httpx.Client(timeout=timeout_seconds, follow_redirects=False, trust_env=False) as client:
        response = client.post(f"{base_url}/auth/login", json=payload)
        if not response.is_success:
            raise ValueError(f"Login QA falhou com HTTP {response.status_code}")
        token = str(response.json().get("access_token") or "").strip()
        if not token:
            raise ValueError("Login QA não retornou access_token.")
        return [token]


def do_request(base_url: str, path: str, token: str, timeout_seconds: float) -> Result:
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    started = time.perf_counter()
    try:
        with httpx.Client(timeout=timeout_seconds, follow_redirects=False, trust_env=False) as client:
            response = client.get(f"{base_url}{path}", headers=headers)
            _ = response.content
            elapsed = (time.perf_counter() - started) * 1000
            return Result(
                path=path,
                status=response.status_code,
                elapsed_ms=elapsed,
                error=None if response.is_success else f"HTTP {response.status_code}",
            )
    except Exception as exc:
        elapsed = (time.perf_counter() - started) * 1000
        return Result(path=path, status=0, elapsed_ms=elapsed, error=type(exc).__name__)


def worker(
    worker_index: int,
    *,
    base_url: str,
    token: str,
    requests_per_worker: int,
    timeout_seconds: float,
) -> list[Result]:
    results: list[Result] = []
    for index in range(requests_per_worker):
        path = READ_ONLY_PATHS[(worker_index + index) % len(READ_ONLY_PATHS)]
        results.append(do_request(base_url, path, token, timeout_seconds))
    return results


def main() -> int:
    raw_url = os.getenv("KOMA_CAPACITY_API_URL", "").strip()
    if not raw_url:
        raise ValueError("Defina KOMA_CAPACITY_API_URL para o backend de homologação.")

    base_url, _ = assert_non_production_target(raw_url)
    concurrency = positive_int("KOMA_CAPACITY_CONCURRENCY", DEFAULT_CONCURRENCY)
    requests_per_worker = positive_int("KOMA_CAPACITY_REQUESTS_PER_WORKER", DEFAULT_REQUESTS_PER_WORKER)
    timeout_ms = positive_int("KOMA_CAPACITY_TIMEOUT_MS", DEFAULT_TIMEOUT_MS)
    p95_limit_ms = positive_int("KOMA_CAPACITY_P95_LIMIT_MS", DEFAULT_P95_LIMIT_MS)
    timeout_seconds = timeout_ms / 1000
    tokens = resolve_tokens(base_url, timeout_seconds)

    print("KÔMA capacity smoke — READ ONLY / HOMOLOGAÇÃO", flush=True)
    print(
        f"Workers={concurrency}; requests/worker={requests_per_worker}; auth_tokens={len(tokens)}",
        flush=True,
    )

    all_results: list[Result] = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=concurrency) as executor:
        futures = [
            executor.submit(
                worker,
                worker_index,
                base_url=base_url,
                token=tokens[worker_index % len(tokens)] if tokens else "",
                requests_per_worker=requests_per_worker,
                timeout_seconds=timeout_seconds,
            )
            for worker_index in range(concurrency)
        ]
        for future in concurrent.futures.as_completed(futures):
            all_results.extend(future.result())

    failures = [item for item in all_results if not item.ok]
    latencies = [item.elapsed_ms for item in all_results]
    p50 = percentile(latencies, 0.50)
    p95 = percentile(latencies, 0.95)
    p99 = percentile(latencies, 0.99)
    avg = statistics.fmean(latencies) if latencies else 0.0

    print(
        f"Total={len(all_results)} falhas={len(failures)} avg={avg:.0f}ms "
        f"p50={p50:.0f}ms p95={p95:.0f}ms p99={p99:.0f}ms",
        flush=True,
    )

    for path in READ_ONLY_PATHS:
        items = [item for item in all_results if item.path == path]
        if not items:
            continue
        path_failures = [item for item in items if not item.ok]
        path_latencies = [item.elapsed_ms for item in items]
        print(
            f"{path}: n={len(items)} falhas={len(path_failures)} "
            f"p95={percentile(path_latencies, 0.95):.0f}ms",
            flush=True,
        )

    if failures:
        for item in failures[:8]:
            print(
                f"FAIL {item.path}: status={item.status} error={item.error} "
                f"elapsed={item.elapsed_ms:.0f}ms",
                file=sys.stderr,
                flush=True,
            )
        return 1

    if p95 > p95_limit_ms:
        print(
            f"p95 {p95:.0f}ms excede o limite {p95_limit_ms}ms.",
            file=sys.stderr,
            flush=True,
        )
        return 1

    print("PASS — sem erro/timeout e p95 dentro do limite configurado.", flush=True)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except ValueError as exc:
        print(str(exc), file=sys.stderr)
        raise SystemExit(1)
