/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from 'react';
import { API_BASE_URL } from '../../../config/api';

export function useCashierChat(apiBaseUrl?: string) {
  const [isChatDrawerOpen, setIsChatDrawerOpen] = useState(false);
  const [chatUnreadCount, setChatUnreadCount] = useState(0);

  useEffect(() => {
    const fetchUnread = () => {
      const token =
        localStorage.getItem('koma_caixa_token') ||
        localStorage.getItem('token') ||
        localStorage.getItem('koma_waiter_token');
      if (!token) return;
      const base = apiBaseUrl || API_BASE_URL;
      fetch(`${base}/api/caixa/conversas/unread-count`, {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then((r) => (r.ok ? r.json() : { total_unread: 0 }))
        .then((data) => setChatUnreadCount(data.total_unread || 0))
        .catch(() => {});
    };

    fetchUnread();
    const interval = setInterval(fetchUnread, 12000);
    return () => clearInterval(interval);
  }, [apiBaseUrl]);

  return {
    isChatDrawerOpen,
    setIsChatDrawerOpen,
    chatUnreadCount,
    setChatUnreadCount,
  };
}
