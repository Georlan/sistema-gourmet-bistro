"""Bound outbound retries without blocking the independent transport lanes."""

import random
import time


class RetryBudget:
    def __init__(self):
        self.ceiling = 1.0
        self.not_before = 0.0

    def ready(self):
        return time.monotonic() >= self.not_before

    def fail(self):
        self.not_before = time.monotonic() + random.uniform(self.ceiling / 2, self.ceiling)
        self.ceiling = min(30.0, self.ceiling * 2)

    def recover(self):
        self.ceiling = 1.0
        self.not_before = 0.0
