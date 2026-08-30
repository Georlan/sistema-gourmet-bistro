import React, { createContext, useCallback, useContext, useState } from 'react';
import { LeadCaptureModal } from './LeadCaptureModal';
import type { LeadSelection } from '../config/landingConfig';

const LeadCaptureContext = createContext<(selection?: LeadSelection) => void>(() => {});

export function LeadCaptureProvider({ children }: { children: React.ReactNode }) {
  const [request, setRequest] = useState<{ selection?: LeadSelection } | null>(null);
  const open = useCallback((selection?: LeadSelection) => setRequest({ selection }), []);
  const close = useCallback(() => setRequest(null), []);
  return (
    <LeadCaptureContext.Provider value={open}>
      {children}
      <LeadCaptureModal open={request !== null} onClose={close} selection={request?.selection} />
    </LeadCaptureContext.Provider>
  );
}

export const useLeadCapture = () => useContext(LeadCaptureContext);
