import { createVisibleRefresh } from '../utils/visibleRefresh';

/** Read-only checkout reconciliation; webhooks remain authoritative. */
export function startPaymentStatusPolling(
  check: (signal: AbortSignal) => Promise<void>,
  page: Pick<Document, 'hidden' | 'addEventListener' | 'removeEventListener'> = document,
  browser: Pick<Window, 'addEventListener' | 'removeEventListener'> = window,
  isOnline: () => boolean = () => navigator.onLine,
) {
  let controller: AbortController | undefined;
  const refresh = createVisibleRefresh(async () => {
    const request = new AbortController();
    controller = request;
    let timeout: ReturnType<typeof setTimeout>;
    const aborted = new Promise<void>((resolve) => {
      request.signal.addEventListener('abort', () => resolve(), { once: true });
      timeout = setTimeout(() => request.abort(), 15_000);
    });
    try {
      // Release the read slot even if a transport fails to settle after abort.
      await Promise.race([check(request.signal), aborted]);
    } finally {
      clearTimeout(timeout!);
      if (controller === request) controller = undefined;
    }
  }, () => !page.hidden && isOnline());

  const resume = () => refresh.resume();
  page.addEventListener('visibilitychange', resume);
  browser.addEventListener('focus', resume);
  browser.addEventListener('online', resume);
  refresh.tick();
  const interval = setInterval(() => refresh.tick(), 3_000);
  return () => {
    refresh.stop();
    clearInterval(interval);
    controller?.abort();
    page.removeEventListener('visibilitychange', resume);
    browser.removeEventListener('focus', resume);
    browser.removeEventListener('online', resume);
  };
}
