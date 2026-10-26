import { createVisibleRefresh } from '../../../utils/visibleRefresh';
import { orderUpdateAffects } from '../../../utils/orderUpdate';

/** Events reconcile immediately; an empty list needs only a slow safety read. */
export function startPendingPixPolling(
  read: (signal: AbortSignal) => Promise<number | undefined>,
  page: Pick<Document, 'hidden' | 'addEventListener' | 'removeEventListener'> = document,
  browser: Pick<Window, 'addEventListener' | 'removeEventListener'> = window,
  isOnline: () => boolean = () => navigator.onLine,
) {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | undefined;
  const refresh = createVisibleRefresh(async () => {
    clearTimeout(timer);
    const request = new AbortController();
    controller = request;
    let timeout: ReturnType<typeof setTimeout>;
    const aborted = new Promise<undefined>(resolve => {
      request.signal.addEventListener('abort', () => resolve(undefined), { once: true });
      timeout = setTimeout(() => request.abort(), 15_000);
    });
    let count: number | undefined;
    try {
      count = await Promise.race([read(request.signal), aborted]);
    } finally {
      clearTimeout(timeout!);
      if (controller === request) controller = undefined;
      if (!stopped) timer = setTimeout(refresh.tick, count === 0 ? 60_000 : 15_000);
    }
  }, () => !page.hidden && isOnline());

  const resume = () => refresh.resume();
  const ordersUpdated = (event: Event) => {
    if (orderUpdateAffects(event, 'payments')) refresh.invalidate();
  };
  page.addEventListener('visibilitychange', resume);
  browser.addEventListener('focus', resume);
  browser.addEventListener('online', resume);
  browser.addEventListener('koma_orders_updated', ordersUpdated);
  refresh.tick();
  return {
    invalidate: refresh.invalidate,
    stop: () => {
      stopped = true;
      refresh.stop();
      clearTimeout(timer);
      controller?.abort();
      page.removeEventListener('visibilitychange', resume);
      browser.removeEventListener('focus', resume);
      browser.removeEventListener('online', resume);
      browser.removeEventListener('koma_orders_updated', ordersUpdated);
    },
  };
}
