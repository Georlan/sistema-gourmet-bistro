/** Coalesces overlapping reads while retaining an invalidation received in flight. */
export function createVisibleRefresh(
  refresh: () => Promise<unknown>,
  isVisible: () => boolean,
  now: () => number = Date.now,
) {
  let stopped = false;
  let running = false;
  let dirty = false;
  let lastResumeAt = -Infinity;

  const run = async () => {
    if (stopped || !isVisible()) return;
    if (running) {
      dirty = true;
      return;
    }
    running = true;
    try {
      await refresh();
    } catch {
      // A failed read remains recoverable by the next event or fallback tick.
    } finally {
      running = false;
      if (dirty && !stopped) {
        dirty = false;
        void run();
      }
    }
  };

  return {
    invalidate: () => { void run(); },
    // A slow request must not accumulate periodic work behind itself.
    tick: () => { if (!running) void run(); },
    resume: () => {
      if (stopped || !isVisible() || now() - lastResumeAt < 750) return;
      lastResumeAt = now();
      void run();
    },
    stop: () => { stopped = true; dirty = false; },
  };
}

export function smartPosFallbackInterval(isWsConnected: boolean): number {
  // Events own live updates; retain a slow safety read for missed notifications.
  return isWsConnected ? 300_000 : 30_000;
}
