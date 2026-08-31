import type { Dispatch, SetStateAction } from 'react';

/** Session access is supplied by App; data owners never select or create a session. */
export interface OperationalRequestContext {
  getAuthHeaders: (contentType?: string) => Record<string, string>;
  handleLogout: () => void;
}

export interface OperationalErrorSink {
  setFetchError: Dispatch<SetStateAction<string | null>>;
}

export type OperationalNotice = (
  message: string,
  type?: 'success' | 'error' | 'info',
  duration?: number,
) => void;
