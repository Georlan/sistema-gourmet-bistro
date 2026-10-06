/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { PostHog } from 'posthog-js';
import type {
  AnalyticsEventMap,
  AnalyticsEventName,
  OperatorIdentityTraits,
  RestaurantGroupProperties,
} from './types';

const BANNED_PII_KEYS = new Set([
  'name',
  'nome',
  'cliente_nome',
  'customer_name',
  'phone',
  'telefone',
  'cliente_telefone',
  'customer_phone',
  'email',
  'cliente_email',
  'customer_email',
  'address',
  'endereco',
  'endereco_entrega',
  'cpf',
  'cnpj',
  'token',
  'access_token',
  'password',
  'senha',
  'secret',
]);

function sanitizeProperties<T extends Record<string, any>>(props?: T): Record<string, any> {
  if (!props || typeof props !== 'object') return {};
  const clean: Record<string, any> = {};
  for (const [key, val] of Object.entries(props)) {
    const lowerKey = key.toLowerCase();
    if (BANNED_PII_KEYS.has(lowerKey)) {
      continue;
    }
    if (val !== undefined && typeof val !== 'function') {
      clean[key] = val;
    }
  }
  return clean;
}

let posthogInstance: any = null;
let initialized = false;
let analyticsActive = false;
let initPromise: Promise<boolean> | null = null;

const pendingEventsQueue: Array<{
  type: 'capture' | 'identify' | 'group' | 'reset';
  event?: string;
  properties?: Record<string, any>;
  distinctId?: string;
  groupType?: string;
  groupKey?: string;
}> = [];

declare global {
  interface Window {
    __KOMA_ANALYTICS_EVENTS__?: Array<{ event: string; properties: Record<string, any>; timestamp: number }>;
  }
}

function recordDebugEvent(event: string, properties: Record<string, any>) {
  const target: any = typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : null);
  if (target) {
    if (!target.__KOMA_ANALYTICS_EVENTS__) {
      target.__KOMA_ANALYTICS_EVENTS__ = [];
    }
    target.__KOMA_ANALYTICS_EVENTS__.push({
      event,
      properties,
      timestamp: Date.now(),
    });
  }
}

function flushPendingQueue() {
  if (!posthogInstance || !analyticsActive) return;
  while (pendingEventsQueue.length > 0) {
    const item = pendingEventsQueue.shift()!;
    try {
      if (item.type === 'capture' && item.event) {
        posthogInstance.capture(item.event, item.properties);
      } else if (item.type === 'identify' && item.distinctId) {
        posthogInstance.identify(item.distinctId, item.properties);
      } else if (item.type === 'group' && item.groupType && item.groupKey) {
        posthogInstance.group(item.groupType, item.groupKey, item.properties);
      } else if (item.type === 'reset') {
        posthogInstance.reset();
      }
    } catch (err) {
      console.warn('[analytics] Falha ao processar evento pendente:', err);
    }
  }
}

export function initAnalytics(): Promise<boolean> {
  if (initPromise) return initPromise;

  initPromise = (async () => {
    if (initialized) return analyticsActive;
    initialized = true;

    if (typeof window === 'undefined') {
      analyticsActive = false;
      return false;
    }

    const projectToken = (import.meta.env?.VITE_POSTHOG_PROJECT_TOKEN || '').trim();
    const host = (import.meta.env?.VITE_POSTHOG_HOST || 'https://us.i.posthog.com').trim();

    if (!projectToken) {
      analyticsActive = false;
      return false;
    }

    try {
      const mod = await import('posthog-js');
      const posthog = (mod.default ?? mod) as PostHog;
      posthog.init(projectToken, {
        api_host: host,
        // Desabilita Session Replay por padrão
        disable_session_recording: true,
        enable_recording_console_log: false,
        // Desabilita autocapture indiscriminado de cliques/DOM; usamos analytics de produto explícito
        autocapture: false,
        // Não cria visualizações de página sintéticas em rotas SPA internas
        capture_pageview: false,
        // Desabilita endpoint /decide e injeção remota de scripts (toolbar/surveys/flags) em conformidade com CSP
        advanced_disable_decide: true,
        // Permite ingestão de sessões automatizadas e testes de navegador (Headless/WebDriver)
        opt_out_useragent_filter: true,
        persistence: 'localStorage+cookie',
      });

      posthogInstance = posthog;
      analyticsActive = true;
      flushPendingQueue();
      return true;
    } catch (error) {
      console.warn('[analytics] Falha ao inicializar PostHog:', error);
      analyticsActive = false;
      return false;
    }
  })();

  return initPromise;
}

export function isAnalyticsActive(): boolean {
  return analyticsActive;
}

export function getPostHogInstance() {
  return posthogInstance;
}

export function trackAnalyticsEvent<E extends AnalyticsEventName>(
  event: E,
  properties: AnalyticsEventMap[E],
): void {
  const sanitized = sanitizeProperties(properties);
  recordDebugEvent(event, sanitized);

  if (posthogInstance && analyticsActive) {
    try {
      posthogInstance.capture(event, sanitized);
    } catch (error) {
      console.warn(`[analytics] Falha ao enviar evento ${event}:`, error);
    }
  } else if (!initialized) {
    pendingEventsQueue.push({
      type: 'capture',
      event,
      properties: sanitized,
    });
  }
}

/**
 * Identifica o operador autenticado e associa ao grupo do restaurante/tenant.
 * Não envia PII (como e-mail, senha ou CPF); envia apenas papel operacional e tenant.
 */
export function identifyOperator(
  user: OperatorIdentityTraits,
  options?: { restaurantName?: string },
): void {
  if (!user || user.id == null) return;

  const distinctId = `operator_${user.id}`;
  const traits = sanitizeProperties({
    role: user.role || user.cargo || 'operador',
    cargo: user.cargo || undefined,
    restaurante_id: user.restaurante_id,
  });

  recordDebugEvent('$identify', { distinctId, ...traits });

  if (posthogInstance && analyticsActive) {
    try {
      posthogInstance.identify(distinctId, traits);
    } catch (error) {
      console.warn('[analytics] Falha ao identificar operador:', error);
    }
  } else if (!initialized) {
    pendingEventsQueue.push({
      type: 'identify',
      distinctId,
      properties: traits,
    });
  }

  if (user.restaurante_id && Number.isInteger(Number(user.restaurante_id))) {
    setRestaurantGroup(user.restaurante_id, {
      restaurant_id: user.restaurante_id,
      restaurant_name: options?.restaurantName,
    });
  }
}

/**
 * Associa o contexto atual de analytics ao grupo de restaurante (multi-tenant isolation).
 */
export function setRestaurantGroup(
  restaurantId: number | string,
  properties?: RestaurantGroupProperties,
): void {
  const groupKey = String(restaurantId);
  const restaurantName = properties?.restaurant_name || properties?.name;
  const groupProps = sanitizeProperties({
    restaurant_id: Number(restaurantId) || restaurantId,
    ...(restaurantName ? { restaurant_name: restaurantName } : {}),
  });

  recordDebugEvent('$group', { group_type: 'restaurant', group_key: groupKey, ...groupProps });

  if (posthogInstance && analyticsActive) {
    try {
      posthogInstance.group('restaurant', groupKey, groupProps);
    } catch (error) {
      console.warn('[analytics] Falha ao definir grupo de restaurante:', error);
    }
  } else if (!initialized) {
    pendingEventsQueue.push({
      type: 'group',
      groupType: 'restaurant',
      groupKey,
      properties: groupProps,
    });
  }
}

/**
 * Limpa a identidade do usuário e a associação ao tenant ao deslogar ou trocar de sessão.
 */
export function resetAnalytics(): void {
  recordDebugEvent('$reset', {});

  if (posthogInstance && analyticsActive) {
    try {
      posthogInstance.reset();
    } catch (error) {
      console.warn('[analytics] Falha ao reiniciar contexto de analytics:', error);
    }
  } else if (!initialized) {
    pendingEventsQueue.push({
      type: 'reset',
    });
  }
}

/**
 * Captura exceções não tratadas de forma segura.
 */
export function captureAnalyticsException(
  error: unknown,
  context?: Record<string, unknown>,
): void {
  if (!analyticsActive || !posthogInstance) return;

  try {
    const cleanContext = sanitizeProperties(context);
    posthogInstance.captureException(error, cleanContext);
  } catch (captureError) {
    console.warn('[analytics] Falha ao registrar exceção:', captureError);
  }
}
