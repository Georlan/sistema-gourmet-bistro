import React, { useEffect } from 'react';
import { clearOperatorSession, getOperatorSession, type OperationalPortal } from '../../utils/authSession';
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

  const returnToLogin = () => {
    clearOperatorSession(portal);
    window.location.replace('/?view=caixa');
  };

  useEffect(() => {
    if (gate.state !== 'unauthenticated') return;
    const current = getOperatorSession(portal);
    if (current && current.token !== session?.token) return;
    clearOperatorSession(portal);
    window.location.replace('/?view=caixa');
  }, [gate.state, portal, session?.token]);

  if (!isManagementSetupOwner || !session?.token) return <>{children}</>;
  if (internalSupportMode) return <>{children}</>;

  if (gate.isChecking || gate.state === 'idle' || gate.state === 'unauthenticated') {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-koma-page px-6 text-koma-foreground">
        <p className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-koma-accent">
          Verificando implantação…
        </p>
      </main>
    );
  }

  if (gate.state === 'error') {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-koma-page px-6 text-koma-foreground">
        <section className="text-center">
          <p>Não foi possível validar a implantação inicial.</p>
          <button type="button" onClick={gate.retry} className="mt-4 rounded-xl border border-koma-border px-4 py-3">Tentar novamente</button>
          <button type="button" onClick={returnToLogin} className="ml-3 rounded-xl border border-koma-border px-4 py-3">Ir para o login</button>
        </section>
      </main>
    );
  }

  if (setupMode) return <>{children}</>;

  if (!gate.requiredComplete) {
    return (
      <FirstAccessOnboarding
        accessToken={session.token}
        user={session.user as Record<string, unknown>}
      />
    );
  }

  return <>{children}</>;
}
