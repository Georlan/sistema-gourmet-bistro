import React, { useEffect, useRef, useState } from 'react';
import { API_BASE_URL } from '../../config/api';
import {
  applyKomaTheme,
  KOMA_THEME_CHANGED_EVENT,
  nextKomaTheme,
  persistKomaTheme,
  readKomaTheme,
  type KomaTheme,
} from '../../config/theme';
import { parseStaffLogin } from '../../utils/staffDestination';
import { useOperatorSessionToken } from './useOperatorSessionToken';
import { requestCourierAccess, persistCourierAccess, clearCourierAccess } from '../../utils/courierAccessSession';
import { releaseTabSessionOwnershipForNavigation } from '../../utils/tabSessionOwnership';
import { authFetchJson, authRequestErrorMessage } from '../../utils/authRequest';
import {
  clearOperatorSession,
  getPersistedOperationalPortal,
  saveOperatorSession,
  type OperationalPortal,
} from '../../utils/authSession';
import { identifyOperator, resetAnalytics } from '../../analytics';
import { KomaLoading } from '../app/KomaLoading';
import { OnboardingOperationalBoundary } from '../onboarding/OnboardingOperationalBoundary';
import { OperationalLogin, type LoginRestaurantOption } from './OperationalLogin';

const OperationalApp = React.lazy(() => import('../../App'));

function OperationalAppBridge({ portal }: { portal: OperationalPortal }) {
  return (
    <React.Suspense fallback={<KomaLoading label="Preparando operação…" />}>
      <OperationalApp initialPortal={portal} />
    </React.Suspense>
  );
}

export default function UnifiedOperationalEntry() {
  // A URL continua sendo única, mas a aba guarda qual portal está operando.
  // Caixa e Garçom podem coexistir em abas diferentes sem um login substituir
  // a identidade operacional da outra aba.
  useOperatorSessionToken();
  const activePortal = getPersistedOperationalPortal();
  const loginRequest = useRef<AbortController | null>(null);
  useEffect(() => () => { loginRequest.current?.abort(); loginRequest.current = null; }, []);
  const [theme, setTheme] = useState<KomaTheme>(() => readKomaTheme());
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const pendingLogin = useRef(false);
  const [restaurantOptions, setRestaurantOptions] = useState<LoginRestaurantOption[]>([]);
  const [restaurantId, setRestaurantId] = useState('');

  // The local/public entry can initialize a different theme before this owner mounts.
  useEffect(() => { applyKomaTheme(theme); }, [theme]);

  useEffect(() => {
    const syncTheme = () => setTheme(readKomaTheme());
    window.addEventListener('storage', syncTheme);
    window.addEventListener(KOMA_THEME_CHANGED_EVENT, syncTheme);
    return () => {
      window.removeEventListener('storage', syncTheme);
      window.removeEventListener(KOMA_THEME_CHANGED_EVENT, syncTheme);
    };
  }, []);

  const resetRestaurantSelection = () => {
    setRestaurantOptions([]);
    setRestaurantId('');
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pendingLogin.current) return;
    pendingLogin.current = true;
    setError('');
    setIsLoggingIn(true);
    const controller = new AbortController();
    loginRequest.current = controller;

    const requestPayload: Record<string, unknown> = {
      username: username.trim().toLowerCase(),
      password,
    };
    if (restaurantId) requestPayload.restaurante_id = Number(restaurantId);

    try {
      const { response, data } = await authFetchJson(`${API_BASE_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestPayload),
        signal: controller.signal,
      });

      if (controller.signal.aborted) return;
      if (!response.ok) {
        const detail = (data as { detail?: unknown } | null)?.detail;
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

      const { token, user, destination } = parseStaffLogin(data);
      if (controller.signal.aborted) return;
      if (destination === 'entregador') {
        const access = await requestCourierAccess(API_BASE_URL, token, controller.signal);
        if (controller.signal.aborted) return;
        persistCourierAccess(access);
        clearOperatorSession();
        resetAnalytics();
        releaseTabSessionOwnershipForNavigation();
        window.location.replace('/entregador');
        return;
      }
      // O login substitui a identidade apenas desta aba e vincula seu portal.
      clearCourierAccess();
      saveOperatorSession(token, user);
      identifyOperator({
        id: user.id,
        role: user.role,
        cargo: user.cargo,
        restaurante_id: user.restaurante_id,
      });

      setUsername('');
      setPassword('');
      setRestaurantOptions([]);
      setRestaurantId('');

    } catch (loginError) {
      if (controller.signal.aborted) return;
      setError(authRequestErrorMessage(loginError, 'Erro ao conectar ao servidor do backend.'));
    } finally {
      if (loginRequest.current === controller) {
        loginRequest.current = null;
        pendingLogin.current = false;
        setIsLoggingIn(false);
      }
    }
  };

  if (activePortal) {
    return (
      <OnboardingOperationalBoundary portal={activePortal}>
        <OperationalAppBridge key={activePortal} portal={activePortal} />
      </OnboardingOperationalBoundary>
    );
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
        setError('');
        setUsername(value);
        resetRestaurantSelection();
      }}
      onPasswordChange={(value) => {
        setError('');
        setPassword(value);
        resetRestaurantSelection();
      }}
      onSubmit={handleSubmit}
    />
  );
}
