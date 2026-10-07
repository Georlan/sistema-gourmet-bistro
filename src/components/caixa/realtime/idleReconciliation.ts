export const HEALTHY_RECONCILIATION_MS = 300_000;
export const OFFLINE_RECONCILIATION_MS = 30_000;
export const EVENT_COALESCE_MS = 250;

/** One request at a time; retain one invalidation received while it is running. */
export function createIdleReconciliation(options: {
  refresh: () => Promise<unknown>;
  visible: () => boolean;
  connected: boolean;
  healthyIntervalMs?: number;
  setTimer: (callback: () => void, delay: number) => number;
  clearTimer: (id: number) => void;
}) {
  let disposed = false;
  let running = false;
  let dirty = false;
  let eventTimer: number | undefined;
  let periodicTimer: number | undefined;
  let connected = options.connected;
  const armPeriodic = () => {
    if (disposed) return;
    periodicTimer = options.setTimer(() => { periodicTimer = undefined; request(); }, connected ? (options.healthyIntervalMs ?? HEALTHY_RECONCILIATION_MS) : OFFLINE_RECONCILIATION_MS);
  };
  const run = async () => {
    if (disposed || running || !options.visible()) return;
    if (eventTimer !== undefined) options.clearTimer(eventTimer);
    if (periodicTimer !== undefined) options.clearTimer(periodicTimer);
    eventTimer = periodicTimer = undefined;
    dirty = false;
    running = true;
    try { await options.refresh(); }
    catch { /* The resource owner renders errors; reconciliation must keep retrying. */ }
    finally {
      running = false;
      if (!disposed) {
        armPeriodic();
        if (dirty && options.visible()) invalidate();
      }
    }
  };
  const request = () => {
    if (disposed) return;
    dirty = true;
    if (!running && options.visible()) void run();
    else if (!running && periodicTimer === undefined) armPeriodic();
  };
  const invalidate = () => {
    if (disposed) return;
    dirty = true;
    // First event starts the window: a continuous burst cannot postpone forever.
    if (!running && options.visible() && eventTimer === undefined) {
      eventTimer = options.setTimer(() => { eventTimer = undefined; void run(); }, EVENT_COALESCE_MS);
    }
  };
  request();
  return {
    invalidate,
    resume: invalidate,
    setConnected(value: boolean) {
      if (disposed || connected === value) return;
      connected = value;
      if (periodicTimer !== undefined) options.clearTimer(periodicTimer);
      periodicTimer = undefined;
      if (!running) armPeriodic();
      invalidate();
    },
    dispose() {
      disposed = true;
      if (eventTimer !== undefined) options.clearTimer(eventTimer);
      if (periodicTimer !== undefined) options.clearTimer(periodicTimer);
    },
  };
}
