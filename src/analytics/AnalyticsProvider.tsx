/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { getPostHogInstance, initAnalytics } from './posthog';

interface AnalyticsProviderProps {
  children: React.ReactNode;
  disabled?: boolean;
}

export function AnalyticsProvider({ children, disabled = false }: AnalyticsProviderProps) {
  const [providerState, setProviderState] = useState<{
    Provider: React.ComponentType<{ client: any; children: React.ReactNode }> | null;
    client: any;
  }>({ Provider: null, client: null });

  useEffect(() => {
    if (disabled) return;
    let cancelled = false;
    void (async () => {
      const active = await initAnalytics();
      if (!active || cancelled) return;
      const client = getPostHogInstance();
      if (!client) return;

      try {
        const reactMod = await import('@posthog/react/slim');
        if (!cancelled && reactMod.PostHogProvider) {
          setProviderState({
            Provider: reactMod.PostHogProvider,
            client,
          });
        }
      } catch (err) {
        console.warn('[analytics] Falha ao carregar @posthog/react:', err);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [disabled]);

  if (providerState.Provider && providerState.client) {
    const PostHogProvider = providerState.Provider;
    return <PostHogProvider client={providerState.client}>{children}</PostHogProvider>;
  }

  return <>{children}</>;
}
