"""Push wake-up listener for the Kôma Print Agent.

The SSE stream is only a hint. Every wake-up is followed by the existing atomic
claim-batch API, and polling remains the fallback whenever push is unavailable.
"""

from __future__ import annotations

import json
import logging
from threading import Event, Lock, Thread
from typing import Iterable, Iterator, Tuple

import requests


log = logging.getLogger("print-agent.wakeup")
PUSH_FALLBACK_POLL_SECONDS = 1.0


def iter_sse_events(lines: Iterable[object]) -> Iterator[Tuple[str, str]]:
    """Parse the small SSE subset used by the wake-up endpoint."""

    event_name = "message"
    data_lines: list[str] = []
    for raw_line in lines:
        if isinstance(raw_line, bytes):
            line = raw_line.decode("utf-8", errors="replace")
        else:
            line = str(raw_line)
        line = line.rstrip("\r")

        if not line:
            if data_lines:
                yield event_name, "\n".join(data_lines)
            event_name = "message"
            data_lines = []
            continue
        if line.startswith(":"):
            continue
        if line.startswith("event:"):
            event_name = line[6:].strip() or "message"
            continue
        if line.startswith("data:"):
            data_lines.append(line[5:].lstrip())

    if data_lines:
        yield event_name, "\n".join(data_lines)


class PrintWakeupListener:
    """Keeps one SSE connection and interrupts the idle polling wait."""

    def __init__(self, api_url: str, agent_token: str, wakeup_event: Event):
        self.api_url = api_url.rstrip("/")
        self.agent_token = agent_token
        self.wakeup_event = wakeup_event
        self._stop = Event()
        self._push_available = Event()
        self.authentication_failed = Event()
        self._thread: Thread | None = None
        self._response_lock = Lock()
        self._response = None

    @property
    def push_available(self) -> bool:
        return self._push_available.is_set()

    def fallback_poll_seconds(self, configured_poll_seconds: float) -> float:
        configured = max(0.1, float(configured_poll_seconds))
        if not self.push_available:
            return configured
        return max(configured, PUSH_FALLBACK_POLL_SECONDS)

    def start(self) -> None:
        if self._thread is not None and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = Thread(
            target=self._run,
            name="koma-print-wakeup",
            daemon=True,
        )
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        self.wakeup_event.set()
        with self._response_lock:
            response = self._response
        if response is not None:
            try:
                response.close()
            except Exception:
                pass
        if self._thread is not None and self._thread.is_alive():
            self._thread.join(timeout=2.0)
        self._push_available.clear()

    def _set_transport(self, payload: dict) -> None:
        if payload.get("push_available") is True:
            self._push_available.set()
        else:
            self._push_available.clear()

    def _consume_event(self, event_name: str, data: str) -> None:
        payload = {}
        if data:
            try:
                decoded = json.loads(data)
                if isinstance(decoded, dict):
                    payload = decoded
            except json.JSONDecodeError:
                payload = {}

        if event_name == "transport":
            self._set_transport(payload)
            return
        if event_name == "ready":
            self._set_transport(payload)
            # Recover work committed while this stream was disconnected.
            self.wakeup_event.set()
            return
        if event_name == "print-job":
            self.wakeup_event.set()

    def _run(self) -> None:
        session = requests.Session()
        headers = {
            "Accept": "text/event-stream",
            "Cache-Control": "no-cache",
            "X-Agent-Token": self.agent_token,
            "User-Agent": "KomaPrintAgent/2026.09.05.2",
        }
        url = f"{self.api_url}/api/print-agents/events"

        try:
            while not self._stop.is_set():
                try:
                    response = session.get(
                        url,
                        headers=headers,
                        stream=True,
                        timeout=(5, 35),
                    )
                    with self._response_lock:
                        self._response = response
                    if response.status_code in (401, 403):
                        self.authentication_failed.set()
                        self.wakeup_event.set()
                        return
                    if response.status_code in (404, 405):
                        self._push_available.clear()
                        response.close()
                        with self._response_lock:
                            self._response = None
                        self._stop.wait(30.0)
                        continue
                    response.raise_for_status()

                    for event_name, data in iter_sse_events(
                        response.iter_lines(decode_unicode=True)
                    ):
                        if self._stop.is_set():
                            break
                        self._consume_event(event_name, data)
                except requests.RequestException as exc:
                    if not self._stop.is_set():
                        log.debug("Canal de wake-up indisponível: %s", exc)
                finally:
                    self._push_available.clear()
                    with self._response_lock:
                        response = self._response
                        self._response = None
                    if response is not None:
                        try:
                            response.close()
                        except Exception:
                            pass
                if not self._stop.is_set():
                    self._stop.wait(1.0)
        finally:
            session.close()
