/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useState } from 'react';
import { API_BASE_URL } from '../../../config/api';

export function useCashierChat(apiBaseUrl?: string) {
  const [isChatDrawerOpen, setIsChatDrawerOpen] = useState(false);
  const [chatUnreadCount, setChatUnreadCount] = useState(0);

  const fetchUnread = useCallback(() => {
    const token =
      localStorage.getItem('koma_caixa_token') ||
      localStorage.getItem('token') ||
      localStorage.getItem('koma_waiter_token');
    if (!token) return;
    const base = apiBaseUrl || API_BASE_URL;
    fetch(`${base}/api/caixa/conversas/unread-count`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    })
      .then((r) => (r.ok ? r.json() : { total_unread: 0 }))
      .then((data) => setChatUnreadCount(Math.max(0, Number(data.total_unread || 0))))
      .catch(() => {});
  }, [apiBaseUrl]);

  useEffect(() => {
    fetchUnread();
    const interval = window.setInterval(() => {
      if (!document.hidden) fetchUnread();
    }, 5000);
    const handleVisibility = () => {
      if (!document.hidden) fetchUnread();
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
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
