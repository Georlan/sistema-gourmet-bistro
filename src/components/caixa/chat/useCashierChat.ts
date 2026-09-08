/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { API_BASE_URL } from '../../../config/api';
import { consumeCashierChatEvents } from './cashierChatRealtime';

export type CashierChatHealth = 'idle' | 'loading' | 'healthy' | 'degraded';

function reportUnreadFailure(error: unknown) {
  console.warn('Falha ao atualizar não lidas do chat do Caixa:', error);
  void import('@sentry/react')
    .then((Sentry) => Sentry.captureException(error, {
      tags: { feature: 'cashier_chat', operation: 'unread_count' },
    }))
    .catch(() => {});
}

export function useCashierChat(apiBaseUrl: string, authorization: string) {
  const requestGeneration = useRef(0);
  const [isChatDrawerOpen, setIsChatDrawerOpen] = useState(false);
  const [chatUnreadCount, setChatUnreadCount] = useState(0);
  const [chatUnreadStatus, setChatUnreadStatus] = useState<CashierChatHealth>('idle');

  const fetchUnread = useCallback(async () => {
    const generation = ++requestGeneration.current;
    if (!authorization) {
      setChatUnreadCount(0);
      setChatUnreadStatus('idle');
      return;
    }

    setChatUnreadStatus((current) => current === 'healthy' ? current : 'loading');
    const base = apiBaseUrl || API_BASE_URL;
    try {
      const response = await fetch(`${base}/api/caixa/conversas/unread-count`, {
        headers: { Authorization: authorization },
        cache: 'no-store',
      });
      if (!response.ok) {
        throw new Error(`Unread count unavailable (${response.status}).`);
      }
      const data = await response.json();
      if (generation !== requestGeneration.current) return;
      const total = Number(data?.total_unread);
      if (!Number.isFinite(total) || total < 0) {
        throw new Error('Unread count returned an invalid payload.');
      }
      setChatUnreadCount(Math.floor(total));
      setChatUnreadStatus('healthy');
    } catch (error) {
      if (generation !== requestGeneration.current) return;
      // UNKNOWN nunca vira ZERO: preserva o último snapshot válido.
      setChatUnreadStatus('degraded');
      reportUnreadFailure(error);
    }
  }, [apiBaseUrl, authorization]);

  useEffect(() => {
    if (!authorization) {
      setChatUnreadCount(0);
      setChatUnreadStatus('idle');
      return;
    }

    void fetchUnread();
    const controller = new AbortController();
    const base = apiBaseUrl || API_BASE_URL;
    let fallbackInterval: number | null = null;
    let reconnectTimer: number | null = null;
    let stopped = false;

    const stopFallback = () => {
      if (fallbackInterval !== null) {
        window.clearInterval(fallbackInterval);
        fallbackInterval = null;
      }
    };

    const startFallback = () => {
      if (fallbackInterval !== null) return;
      fallbackInterval = window.setInterval(() => {
        if (!document.hidden) void fetchUnread();
      }, 30000);
    };

    const connect = () => {
      if (stopped || controller.signal.aborted) return;
      void consumeCashierChatEvents({
        url: `${base}/api/caixa/conversas/events`,
        authorization,
        signal: controller.signal,
        onOpen: () => {
          stopFallback();
          void fetchUnread();
        },
        onEvent: ({ event }) => {
          if (event === 'new_message' || event === 'status_changed' || event === 'read_update') {
            void fetchUnread();
          }
        },
      }).catch((error) => {
        if (stopped || controller.signal.aborted) return;
        setChatUnreadStatus('degraded');
        reportUnreadFailure(error);
        startFallback();
        reconnectTimer = window.setTimeout(connect, 5000);
      });
    };

    connect();
    const handleVisibility = () => {
      if (!document.hidden) void fetchUnread();
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      stopped = true;
      requestGeneration.current += 1;
      controller.abort();
      stopFallback();
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [apiBaseUrl, authorization, fetchUnread]);

  useEffect(() => {
    const cleanTitle = document.title.replace(/^\(\d+\)\s*/, '');
    document.title = chatUnreadCount > 0
      ? `(${chatUnreadCount}) ${cleanTitle}`
      : cleanTitle;
    return () => {
      document.title = cleanTitle;
    };
  }, [chatUnreadCount]);

  return {
    isChatDrawerOpen,
    setIsChatDrawerOpen,
    chatUnreadCount,
    chatUnreadStatus,
    setChatUnreadCount,
    refreshChatUnreadCount: fetchUnread,
  };
}
