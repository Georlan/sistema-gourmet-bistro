import React from 'react';
import { getOperatorSession, type OperationalPortal } from '../../utils/authSession';
import { FirstAccessOnboarding, ONBOARDING_SETUP_MODE_KEY } from './FirstAccessOnboarding';
import { useOnboardingAccessGate } from './useOnboardingAccessGate';
import { SUPPORT_SESSION_STORAGE_KEY } from '../../super-admin/SuperAdminSupportModal';

function readSetupMode(): boolean {
  try {
    return sessionStorage.getItem(ONBOARDING_SETUP_MODE_KEY) === '1';
  } catch {
    return false;
  }
}

function readInternalSupportMode(): boolean {
  try {
    return Boolean(sessionStorage.getItem(SUPPORT_SESSION_STORAGE_KEY));
  } catch {
    return false;
  }
}

export function OnboardingOperationalBoundary({
  portal,
  children,
}: {
  portal: OperationalPortal;
  children: React.ReactNode;
}) {
  const session = getOperatorSession(portal);
  const role = String(session?.user?.role || session?.user?.cargo || '').trim().toLowerCase();
  const isManagementSetupOwner = portal === 'caixa' && (role === 'admin' || role === 'gerente');
  const setupMode = readSetupMode();
  const internalSupportMode = readInternalSupportMode();
  if (internalSupportMode && setupMode) {
    try {
      sessionStorage.removeItem(ONBOARDING_SETUP_MODE_KEY);
    } catch {
      // Support mode must not stay trapped in customer onboarding UI.
    }
  }
  const gate = useOnboardingAccessGate({
    enabled: isManagementSetupOwner && !internalSupportMode,
    accessToken: session?.token || '',
  });

  if (!isManagementSetupOwner || !session?.token) return <>{children}</>;
  if (internalSupportMode || setupMode) return <>{children}</>;

  if (gate.isChecking || gate.state === 'idle') {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-koma-page px-6 text-koma-foreground">
        <p className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-koma-accent">
          Verificando implantação…
        </p>
      </main>
    );
  }

  if (gate.state === 'error' || !gate.operationReleased) {
    return (
      <FirstAccessOnboarding
        accessToken={session.token}
        user={session.user as Record<string, unknown>}
      />
    );
  }

  return <>{children}</>;
}
