"""Bound outbound retries without blocking the independent transport lanes."""

import random
import time
import math
from email.utils import parsedate_to_datetime


class RetryBudget:
    def __init__(self):
        self.ceiling = 1.0
        self.not_before = 0.0

    def ready(self):
        return time.monotonic() >= self.not_before

    def fail(self, response=None):
        delay = random.uniform(self.ceiling / 2, self.ceiling)
        if response is not None:
            if response.status_code == 403:
                delay = max(delay, 60.0)
            value = response.headers.get("Retry-After")
            if isinstance(value, str):
                try:
                    requested = float(value)
                except ValueError:
                    try:
                        requested = parsedate_to_datetime(value).timestamp() - time.time()
                    except (TypeError, ValueError, OverflowError):
                        requested = 0.0
                if math.isfinite(requested):
                    delay = max(delay, max(0.0, requested))
        self.not_before = time.monotonic() + delay
        self.ceiling = min(30.0, self.ceiling * 2)
        return delay

    def recover(self):
        self.ceiling = 1.0
        self.not_before = 0.0
