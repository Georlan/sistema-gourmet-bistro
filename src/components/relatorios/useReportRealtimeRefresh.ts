import { useEffect, useRef } from 'react';

type ReportRead = { promise: Promise<unknown>; controller: AbortController; consumers: Set<symbol> };
const inFlightReportReads = new Map<string, ReportRead>();

/** Leituras idênticas compartilham a conexão; aborta quando todos os consumidores saem. */
export function fetchReportJson<T>(url: string, headers: Record<string, string>, signal?: AbortSignal): Promise<T> {
  if (signal?.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'));
  const key = `${headers.Authorization || headers.authorization || 'anonymous'}::${url}`;
  let read = inFlightReportReads.get(key);
  if (!read || read.controller.signal.aborted) {
    const controller = new AbortController();
    const promise = fetch(url, { headers, signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error(`Falha ao carregar relatório (${response.status}).`);
      return response.json();
    });
    read = { promise, controller, consumers: new Set() };
    inFlightReportReads.set(key, read);
    const entry = read;
    void promise.finally(() => {
      if (inFlightReportReads.get(key) === entry) inFlightReportReads.delete(key);
    }).catch(() => undefined);
  }
  const entry = read;
  const consumer = Symbol();
  entry.consumers.add(consumer);
  return new Promise<T>((resolve, reject) => {
    const release = () => {
      signal?.removeEventListener('abort', abort);
      entry.consumers.delete(consumer);
    };
    const abort = () => {
      release();
      reject(new DOMException('Aborted', 'AbortError'));
      // Permite a remontagem imediata do StrictMode reutilizar a mesma leitura.
      queueMicrotask(() => { if (!entry.consumers.size) entry.controller.abort(); });
    };
    signal?.addEventListener('abort', abort, { once: true });
    entry.promise.then(value => { release(); resolve(value as T); }, error => { release(); reject(error); });
  });
}

/**
 * Atualiza somente o relatório que está montado, reutilizando o WebSocket
 * central do app. Eventos próximos são consolidados em uma única leitura.
 */
export function useReportRealtimeRefresh(refresh: () => void, delayMs = 450) {
  const refreshRef = useRef(refresh);

  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  useEffect(() => {
    let timer: number | undefined;

    const scheduleRefresh = () => {
      if (document.visibilityState !== 'visible') return;
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => refreshRef.current(), delayMs);
    };

    window.addEventListener('koma_reports_updated', scheduleRefresh);
    return () => {
      if (timer) window.clearTimeout(timer);
      window.removeEventListener('koma_reports_updated', scheduleRefresh);
    };
  }, [delayMs]);
}
