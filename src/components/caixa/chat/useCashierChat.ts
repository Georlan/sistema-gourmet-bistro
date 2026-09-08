/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { API_BASE_URL } from '../../../config/api';

export function useCashierChat(apiBaseUrl: string, authorization: string) {
  const requestGeneration = useRef(0);
  const [isChatDrawerOpen, setIsChatDrawerOpen] = useState(false);
  const [chatUnreadCount, setChatUnreadCount] = useState(0);

  const fetchUnread = useCallback(() => {
    const generation = ++requestGeneration.current;
    if (!authorization) { setChatUnreadCount(0); return; }
    const base = apiBaseUrl || API_BASE_URL;
    fetch(`${base}/api/caixa/conversas/unread-count`, {
      headers: { Authorization: authorization },
      cache: 'no-store',
    })
      .then((r) => (r.ok ? r.json() : { total_unread: 0 }))
      .then((data) => { if (generation === requestGeneration.current) setChatUnreadCount(Math.max(0, Number(data.total_unread || 0))); })
      .catch(() => {});
  }, [apiBaseUrl, authorization]);

  useEffect(() => {
    setChatUnreadCount(0);
    fetchUnread();
    const interval = window.setInterval(() => {
      if (!document.hidden) fetchUnread();
    }, 5000);
    const handleVisibility = () => {
      if (!document.hidden) fetchUnread();
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      requestGeneration.current += 1;
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [fetchUnread]);

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
    setChatUnreadCount,
    refreshChatUnreadCount: fetchUnread,
  };
}
