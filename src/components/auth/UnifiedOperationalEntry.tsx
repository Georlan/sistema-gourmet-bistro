import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { API_BASE_URL } from '../../config/api';
import {
  KOMA_THEME_CHANGED_EVENT,
  nextKomaTheme,
  persistKomaTheme,
  readKomaTheme,
  type KomaTheme,
} from '../../config/theme';
import type { AppRole } from '../../types';
import { authFetch, authRequestErrorMessage } from '../../utils/authRequest';
import {
  clearOperatorSession,
  getOperatorSession,
  saveOperatorSession,
  type OperationalPortal,
} from '../../utils/authSession';
import { OperationalLogin, type LoginRestaurantOption } from './OperationalLogin';

const OperationalApp = React.lazy(() => import('../../App'));

const MANAGEMENT_ROLES = new Set<AppRole>(['admin', 'gerente', 'caixa']);

function resolvePortalForRole(role: AppRole): OperationalPortal | null {
  if (role === 'garcom') return 'garcom';
  if (MANAGEMENT_ROLES.has(role)) return 'caixa';
  return null;
}

function detectPersistedPortal(): OperationalPortal | null {
  const operatorSession = getOperatorSession();
  if (operatorSession?.token) return 'caixa';
  if (localStorage.getItem('koma_waiter_token')) return 'garcom';
  return null;
}

function relativeUrlWithParams(params: URLSearchParams): string {
  const query = params.toString();
  return `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`;
}

function OperationalAppBridge({ portal }: { portal: OperationalPortal }) {
  const [ready, setReady] = useState(false);
  const injectedView = useRef(false);

  useLayoutEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const currentView = params.get('view')?.toLowerCase() || '';

    if (portal === 'caixa') {
      if (currentView !== 'caixa' && currentView !== 'gerencia') {
        params.set('view', 'caixa');
        injectedView.current = true;
        window.history.replaceState(null, '', relativeUrlWithParams(params));
      }
    } else if (currentView === 'caixa' || currentView === 'gerencia') {
      params.delete('view');
      window.history.replaceState(null, '', relativeUrlWithParams(params));
    }

    setReady(true);
  }, [portal]);

  useEffect(() => {
    if (!ready || portal !== 'caixa' || !injectedView.current) return;

    const frame = window.requestAnimationFrame(() => {
      const params = new URLSearchParams(window.location.search);
      const currentView = params.get('view')?.toLowerCase() || '';
      if (currentView === 'caixa' || currentView === 'gerencia') {
        params.delete('view');
        window.history.replaceState(null, '', relativeUrlWithParams(params));
      }
      injectedView.current = false;
    });

    return () => window.cancelAnimationFrame(frame);
  }, [portal, ready]);

  if (!ready) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-koma-page px-6 text-koma-foreground">
        <p className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-koma-accent">
          Preparando operação…
        </p>
      </main>
    );
  }

  return (
    <React.Suspense
      fallback={(
        <main className="flex min-h-dvh items-center justify-center bg-koma-page px-6 text-koma-foreground">
          <p className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-koma-accent">
            Preparando operação…
          </p>
        </main>
      )}
    >
      <OperationalApp />
    </React.Suspense>
  );
}

export default function UnifiedOperationalEntry() {
  const [activePortal, setActivePortal] = useState<OperationalPortal | null>(() => detectPersistedPortal());
  const [theme, setTheme] = useState<KomaTheme>(() => readKomaTheme());
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [restaurantOptions, setRestaurantOptions] = useState<LoginRestaurantOption[]>([]);
  const [restaurantId, setRestaurantId] = useState('');

  useEffect(() => {
    const syncTheme = () => setTheme(readKomaTheme());
    window.addEventListener('storage', syncTheme);
    window.addEventListener(KOMA_THEME_CHANGED_EVENT, syncTheme);
    return () => {
      window.removeEventListener('storage', syncTheme);
      window.removeEventListener(KOMA_THEME_CHANGED_EVENT, syncTheme);
    };
  }, []);

  useEffect(() => {
    if (!activePortal) return;
    const tokenKey = activePortal === 'caixa' ? 'koma_caixa_token' : 'koma_waiter_token';
    const timer = window.setInterval(() => {
      if (!localStorage.getItem(tokenKey)) {
        setActivePortal(null);
      }
    }, 500);
    return () => window.clearInterval(timer);
  }, [activePortal]);

  const resetRestaurantSelection = () => {
    setRestaurantOptions([]);
    setRestaurantId('');
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setIsLoggingIn(true);

    const requestPayload: Record<string, unknown> = {
      username: username.trim().toLowerCase(),
      password,
    };
    if (restaurantId) requestPayload.restaurante_id = Number(restaurantId);

    try {
      const response = await authFetch(`${API_BASE_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestPayload),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        const detail = payload?.detail;
        const detailRecord = detail && typeof detail === 'object'
          ? detail as Record<string, any>
          : null;
        const options = response.status === 409
          && detailRecord?.code === 'restaurant_selection_required'
          && Array.isArray(detailRecord.restaurantes)
          ? detailRecord.restaurantes
              .map((item: any) => ({
                id: Number(item?.id),
                nome: String(item?.nome || `Restaurante ${item?.id || ''}`).trim(),
              }))
              .filter((item: LoginRestaurantOption) => Number.isInteger(item.id) && item.id > 0)
          : [];

        if (options.length > 0) {
          setRestaurantOptions(options);
          setRestaurantId('');
          setError(
            typeof detailRecord?.message === 'string'
              ? detailRecord.message
              : 'Selecione o estabelecimento para continuar.',
          );
          return;
        }

        setError(
          typeof detail === 'string'
            ? detail
            : typeof detailRecord?.message === 'string'
              ? detailRecord.message
              : 'Usuário ou senha incorretos.',
        );
        return;
      }

      const data = await response.json();
      const role = String(data?.usuario?.role || data?.usuario?.cargo || '').trim().toLowerCase() as AppRole;
      const portal = resolvePortalForRole(role);
      const restauranteId = Number(data?.usuario?.restaurante_id);

      if (!portal) {
        setError('Este perfil ainda não possui uma área operacional disponível neste aplicativo.');
        return;
      }
      if (
        !data?.access_token
        || !data?.usuario?.id
        || !data?.usuario?.nome
        || !Number.isInteger(restauranteId)
        || restauranteId <= 0
      ) {
        setError('A resposta de autenticação está incompleta. Tente novamente.');
        return;
      }

      clearOperatorSession();
      if (portal === 'caixa') {
        saveOperatorSession(data.access_token, { ...data.usuario, role });
      } else {
        localStorage.setItem('koma_waiter_token', data.access_token);
        localStorage.setItem('koma_waiter_id', String(data.usuario.id));
        localStorage.setItem('koma_waiter_name', String(data.usuario.nome));
        localStorage.setItem('koma_user_role', role);
      }

      setUsername('');
      setPassword('');
      setRestaurantOptions([]);
      setRestaurantId('');
      setActivePortal(portal);
    } catch (loginError) {
      console.error(loginError);
      setError(authRequestErrorMessage(loginError, 'Erro ao conectar ao servidor do backend.'));
    } finally {
      setIsLoggingIn(false);
    }
  };

  if (activePortal) {
    return <OperationalAppBridge key={activePortal} portal={activePortal} />;
  }

  return (
    <OperationalLogin
      portal="unified"
      theme={theme}
      username={username}
      password={password}
      error={error}
      isLoggingIn={isLoggingIn}
      restaurantOptions={restaurantOptions}
      restaurantId={restaurantId}
      onRestaurantChange={setRestaurantId}
      onToggleTheme={() => setTheme(persistKomaTheme(nextKomaTheme(theme)))}
      onUsernameChange={(value) => {
        setUsername(value);
        resetRestaurantSelection();
      }}
      onPasswordChange={(value) => {
        setPassword(value);
        resetRestaurantSelection();
      }}
      onSubmit={handleSubmit}
    />
  );
}
