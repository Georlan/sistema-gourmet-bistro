import { useCallback, useEffect, useRef, useState, type SetStateAction } from 'react';
import { snapshotFetch as fetch } from '../../../utils/snapshotFetch';

export interface LoyaltyConfig {
  ativo: boolean;
  tipo_recompensa: 'PONTOS' | 'CASHBACK';
  taxa_conversao: number;
  valor_ponto_em_dinheiro: number;
}

export const DEFAULT_LOYALTY_CONFIG: LoyaltyConfig = {
  ativo: false, tipo_recompensa: 'PONTOS', taxa_conversao: 1, valor_ponto_em_dinheiro: 0.05,
};

/** Mirrors the backend: points per R$ times the monetary value of each point. */
export function effectiveLoyaltyPercent(config: LoyaltyConfig): number {
  return !config.ativo ? 0 : config.tipo_recompensa === 'PONTOS'
    ? config.taxa_conversao * config.valor_ponto_em_dinheiro * 100
    : config.taxa_conversao;
}

export function loyaltyConfigEqual(a: LoyaltyConfig, b: LoyaltyConfig): boolean {
  return a.ativo === b.ativo && a.tipo_recompensa === b.tipo_recompensa
    && a.taxa_conversao === b.taxa_conversao
    && a.valor_ponto_em_dinheiro === b.valor_ponto_em_dinheiro;
}

/** Strictly verify the server response; never present an unconfirmed POST as saved. */
export function parseLoyaltyConfig(value: unknown): LoyaltyConfig {
  if (!value || typeof value !== 'object') throw new Error('Configuração de fidelidade inválida.');
  const data = value as Record<string, unknown>;
  const rate = data.taxa_conversao;
  const point = data.valor_ponto_em_dinheiro;
  if (typeof data.ativo !== 'boolean'
    || (data.tipo_recompensa !== 'PONTOS' && data.tipo_recompensa !== 'CASHBACK')
    || typeof rate !== 'number' || !Number.isFinite(rate) || rate < 0
    || typeof point !== 'number' || !Number.isFinite(point) || point < 0) {
    throw new Error('O servidor retornou uma configuração de fidelidade inválida.');
  }
  return { ativo: data.ativo, tipo_recompensa: data.tipo_recompensa,
    taxa_conversao: rate, valor_ponto_em_dinheiro: point };
}

interface LoyaltyState {
  scope: string;
  saved: LoyaltyConfig | null;
  draft: LoyaltyConfig | null;
  loading: boolean;
  saving: boolean;
  error: string | null;
}

const emptyState = (scope: string): LoyaltyState => ({
  scope, saved: null, draft: null, loading: true, saving: false, error: null,
});

interface Options {
  apiBaseUrl: string;
  authHeaders: Record<string, string>;
  hasLoyalty: boolean;
  visible: boolean;
}

/**
 * The server snapshot, editable draft and request state belong to one auth/tenant
 * scope. Navigation between Benefits/Coupons doesn't destroy the draft.
 * Late reads and writes from an earlier tenant never mutate the new tenant UI.
 */
export function useLoyaltyConfiguration({ apiBaseUrl, authHeaders, hasLoyalty, visible }: Options) {
  const scope = `${apiBaseUrl}|${authHeaders.Authorization || ''}|${hasLoyalty}`;
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const [state, setState] = useState<LoyaltyState>(() => emptyState(scope));
  const writeLock = useRef(false);
  const [reloadVersion, setReloadVersion] = useState(0);

  const current = state.scope === scope ? state : emptyState(scope);
  const saved = current.saved;
  const draft = current.draft;
  const dirty = Boolean(saved && draft && !loyaltyConfigEqual(saved, draft));

  useEffect(() => {
    setState(prev => prev.scope === scope ? prev : emptyState(scope));
    if (!visible || !hasLoyalty) return;
    const controller = new AbortController();
    setState(prev => prev.scope === scope ? { ...prev, loading: !prev.saved, error: null } : prev);
    void (async () => {
      try {
        const response = await fetch(`${apiBaseUrl}/fidelidade/config`, {
          headers: authHeaders, signal: controller.signal,
        });
        if (!response.ok) throw new Error('Não foi possível consultar o programa vigente.');
        const confirmed = parseLoyaltyConfig(await response.json());
        if (controller.signal.aborted || scopeRef.current !== scope) return;
        setState(prev => {
          if (prev.scope !== scope) return prev;
          const edited = Boolean(prev.saved && prev.draft && !loyaltyConfigEqual(prev.saved, prev.draft));
          return { ...prev, saved: confirmed, draft: edited ? prev.draft : confirmed,
            loading: false, error: null };
        });
      } catch {
        if (controller.signal.aborted || scopeRef.current !== scope) return;
        setState(prev => prev.scope === scope ? { ...prev, loading: false,
          error: 'Não foi possível consultar o programa. Verifique a conexão e tente novamente.' } : prev);
      }
    })();
    return () => controller.abort();
  }, [scope, visible, hasLoyalty, apiBaseUrl, authHeaders.Authorization, reloadVersion]);

  const setDraft = useCallback((next: SetStateAction<LoyaltyConfig>) => {
    setState(prev => {
      if (prev.scope !== scope || !prev.draft || prev.saving) return prev;
      const updated = typeof next === 'function' ? next(prev.draft) : next;
      return { ...prev, draft: updated, error: null };
    });
  }, [scope]);

  const discard = useCallback(() => {
    setState(prev => prev.scope === scope && prev.saved && !prev.saving
      ? { ...prev, draft: prev.saved, error: null } : prev);
  }, [scope]);

  const save = useCallback(async (): Promise<boolean> => {
    if (writeLock.current || !hasLoyalty || !visible || !dirty || current.loading || !draft) return false;
    // The request retains its own exact tenant credentials and payload.
    const submitted = { ...draft };
    const headers = { ...authHeaders, 'Content-Type': 'application/json' };
    const requestScope = scope;
    writeLock.current = true;
    setState(prev => prev.scope === scope ? { ...prev, saving: true, error: null } : prev);
    try {
      const response = await fetch(`${apiBaseUrl}/fidelidade/config`, {
        method: 'POST', headers, body: JSON.stringify(submitted),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(typeof body?.detail === 'string' ? body.detail : 'Não foi possível salvar o programa.');
      }
      const confirmed = parseLoyaltyConfig(await response.json());
      if (scopeRef.current !== requestScope) return false;
      setState(prev => {
        if (prev.scope !== requestScope) return prev;
        const changedDuringRequest = Boolean(prev.draft && !loyaltyConfigEqual(prev.draft, submitted));
        return { ...prev, saved: confirmed, draft: changedDuringRequest ? prev.draft : confirmed,
          saving: false, error: null };
      });
      return true;
    } catch (err) {
      if (scopeRef.current === requestScope) {
        setState(prev => prev.scope === requestScope
          ? { ...prev, saving: false, error: err instanceof Error ? err.message : 'Falha ao salvar.' } : prev);
      }
      return false;
    } finally {
      writeLock.current = false;
    }
  }, [scope, hasLoyalty, visible, dirty, current.loading, draft, authHeaders, apiBaseUrl]);

  return { saved, draft, setDraft, dirty, loading: current.loading, saving: current.saving,
    error: current.error, discard, save, reload: () => setReloadVersion(version => version + 1) };
}
