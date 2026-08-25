import { useEffect, useRef } from 'react';

const inFlightReportReads = new Map<string, Promise<unknown>>();

function requestKey(url: string, headers: Record<string, string>) {
  const identity = headers.Authorization || headers.authorization || 'anonymous';
  return `${identity}::${url}`;
}

/** Reaproveita uma leitura idêntica enquanto ela ainda está em andamento. */
export function fetchReportJson<T>(url: string, headers: Record<string, string>): Promise<T> {
  const key = requestKey(url, headers);
  const current = inFlightReportReads.get(key) as Promise<T> | undefined;
  if (current) return current;

  const request = fetch(url, { headers }).then(async response => {
    if (!response.ok) throw new Error(`Falha ao carregar relatório (${response.status}).`);
    return response.json() as Promise<T>;
  });
  inFlightReportReads.set(key, request);
  void request.finally(() => {
    if (inFlightReportReads.get(key) === request) inFlightReportReads.delete(key);
  }).catch(() => undefined);
  return request;
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
