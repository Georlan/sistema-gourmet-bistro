import React, { createContext, useCallback, useContext, useState } from 'react';
import { LeadCaptureModal } from './LeadCaptureModal';
import type { LeadSelection } from '../config/landingConfig';
import { trackAnalyticsEvent } from '../../analytics/posthog';
import { currentLandingTrafficSource } from '../marketingAttribution';

const LeadCaptureContext = createContext<(selection?: LeadSelection) => void>(() => {});

export function LeadCaptureProvider({ children }: { children: React.ReactNode }) {
  const [request, setRequest] = useState<{ selection?: LeadSelection } | null>(null);
  const open = useCallback((selection?: LeadSelection) => {
    trackAnalyticsEvent('landing_demo_opened', {
      traffic_source: currentLandingTrafficSource(),
      entry_point: selection ? 'plan' : 'general',
    });
    setRequest({ selection });
  }, []);
  const close = useCallback(() => setRequest(null), []);
  return (
    <LeadCaptureContext.Provider value={open}>
      {children}
      <LeadCaptureModal open={request !== null} onClose={close} selection={request?.selection} />
    </LeadCaptureContext.Provider>
  );
}

export const useLeadCapture = () => useContext(LeadCaptureContext);
