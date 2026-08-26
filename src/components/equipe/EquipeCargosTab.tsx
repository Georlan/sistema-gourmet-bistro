import React, { useCallback, useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import {
  AlertTriangle,
  BarChart3,
  Check,
  LockKeyhole,
  RefreshCw,
  Settings2,
  ShieldCheck,
  ShoppingCart,
  UserCog,
  Users,
  WalletCards,
} from 'lucide-react';
import { OperationalBanner } from '../shared/OperationalBanner';

interface CargoPermissoesItem {
  slug: string;
  label: string;
  total_funcionarios: number;
  permissoes: {
    pedidos: boolean;
    caixa: boolean;
    relatorios: boolean;
    equipe: boolean;
    admin: boolean;
  };
}

interface EquipeCargosTabProps {
  apiBaseUrl: string;
  authHeaders: Record<string, string>;
}

type PermissionKey = keyof CargoPermissoesItem['permissoes'];

const ROLE_ALIASES: Record<string, string> = { operador_caixa: 'caixa' };
const ROLE_ORDER = ['admin', 'gerente', 'caixa', 'garcom', 'atendente', 'cozinha', 'motoboy'];
const ROLE_DESCRIPTIONS: Record<string, string> = {
  admin: 'Configura toda a operação e possui acesso completo.',
  gerente: 'Acompanha resultados, caixa e gestão da equipe.',
  caixa: 'Opera pedidos, recebimentos e rotinas do caixa.',
  garcom: 'Registra pedidos e acompanha o atendimento do salão.',
  atendente: 'Registra e acompanha pedidos da operação.',
  cozinha: 'Visualiza somente o fluxo de preparo.',
  motoboy: 'Acompanha as entregas atribuídas.',
};

const PERMISSIONS: { key: PermissionKey; label: string; icon: React.ElementType }[] = [
  { key: 'pedidos', label: 'Pedidos', icon: ShoppingCart },
  { key: 'caixa', label: 'Caixa', icon: WalletCards },
  { key: 'relatorios', label: 'Relatórios', icon: BarChart3 },
  { key: 'equipe', label: 'Equipe', icon: UserCog },
  { key: 'admin', label: 'Configurações', icon: Settings2 },
];

let rolesRequest: { key: string; promise: Promise<CargoPermissoesItem[]> } | null = null;

async function loadRoles(apiBaseUrl: string, authorization: string | undefined, force = false): Promise<CargoPermissoesItem[]> {
  const key = `${apiBaseUrl}::${authorization || 'anonymous'}`;
  if (!force && rolesRequest?.key === key) return rolesRequest.promise;

  const promise = fetch(`${apiBaseUrl}/relatorios/cargos-permissoes`, {
    headers: authorization ? { Authorization: authorization } : undefined,
  }).then(async (response) => {
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const json = await response.json();
    return canonicalizeRoles(json.cargos ?? []);
  }).finally(() => {
    if (rolesRequest?.promise === promise) rolesRequest = null;
  });

  rolesRequest = { key, promise };
  return promise;
}

function canonicalizeRoles(items: CargoPermissoesItem[]): CargoPermissoesItem[] {
  const roles = new Map<string, CargoPermissoesItem>();
  items.forEach((item) => {
    const slug = ROLE_ALIASES[item.slug] || item.slug;
    const current = roles.get(slug);
    if (!current) {
      roles.set(slug, { ...item, slug, label: slug === 'caixa' ? 'Operador de caixa' : item.label });
      return;
    }
    roles.set(slug, {
      ...current,
      total_funcionarios: current.total_funcionarios + item.total_funcionarios,
      permissoes: Object.fromEntries(
        PERMISSIONS.map(({ key }) => [key, current.permissoes[key] || item.permissoes[key]]),
      ) as CargoPermissoesItem['permissoes'],
    });
  });
  return [...roles.values()].sort((a, b) => {
    const aIndex = ROLE_ORDER.indexOf(a.slug);
    const bIndex = ROLE_ORDER.indexOf(b.slug);
    return (aIndex < 0 ? 99 : aIndex) - (bIndex < 0 ? 99 : bIndex) || a.label.localeCompare(b.label, 'pt-BR');
  });
}

export const EquipeCargosTab: React.FC<EquipeCargosTabProps> = ({ apiBaseUrl, authHeaders }) => {
  const [cargos, setCargos] = useState<CargoPermissoesItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasError, setHasError] = useState(false);
  const authorization = authHeaders.Authorization;

  const fetchCargos = useCallback(async (force = false) => {
    setIsLoading(true);
    setHasError(false);
    try {
      setCargos(await loadRoles(apiBaseUrl, authorization, force));
    } catch (error) {
      console.error('Erro ao carregar funções e acessos:', error);
      setHasError(true);
    } finally {
      setIsLoading(false);
    }
  }, [apiBaseUrl, authorization]);

  useEffect(() => {
    void fetchCargos();
  }, [fetchCargos]);

  useEffect(() => {
    const refreshRoles = () => void fetchCargos(true);
    window.addEventListener('koma_team_updated', refreshRoles);
    return () => window.removeEventListener('koma_team_updated', refreshRoles);
  }, [fetchCargos]);

  const totalPeople = useMemo(() => cargos.reduce((total, cargo) => total + cargo.total_funcionarios, 0), [cargos]);
  const rolesInUse = useMemo(() => cargos.filter((cargo) => cargo.total_funcionarios > 0).length, [cargos]);

  return (
    <div className="space-y-4 text-left animate-fade-in">
      <OperationalBanner
        id="team-roles-title"
        eyebrow="ACESSOS"
        title="Cada função"
        accent="vê só o necessário"
        description="Entenda rapidamente o que cada pessoa pode fazer, sem configurar permissões uma por uma."
        metrics={[
          { label: cargos.length === 1 ? 'função disponível' : 'funções disponíveis', value: cargos.length },
          { label: rolesInUse === 1 ? 'função em uso' : 'funções em uso', value: rolesInUse },
          { label: totalPeople === 1 ? 'pessoa vinculada' : 'pessoas vinculadas', value: totalPeople },
        ]}
      />

      <section className="flex flex-col gap-3 rounded-2xl border border-koma-border bg-koma-panel p-3 sm:flex-row sm:items-center sm:justify-between" aria-label="Como os acessos funcionam">
        <div className="flex min-w-0 items-start gap-2.5">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"><ShieldCheck size={16} /></span>
          <div>
            <p className="text-xs font-bold text-koma-foreground">Acesso automático por função</p>
            <p className="mt-0.5 text-[10px] leading-relaxed text-koma-muted">Ao convidar uma pessoa, a função escolhida já libera somente as áreas adequadas.</p>
          </div>
        </div>
        <button type="button" onClick={() => void fetchCargos(true)} disabled={isLoading} className="koma-btn-secondary inline-flex shrink-0 items-center justify-center gap-2 px-3 py-2 text-[10px] font-bold disabled:opacity-60">
          <RefreshCw size={13} className={clsx(isLoading && 'animate-spin')} /> Atualizar
        </button>
      </section>

      {hasError && !isLoading && (
        <section className="flex flex-col items-center justify-center gap-3 rounded-3xl border border-rose-500/25 bg-rose-500/10 p-8 text-center">
          <AlertTriangle size={22} className="text-rose-700 dark:text-rose-300" />
          <div><p className="text-sm font-bold text-koma-foreground">Não foi possível carregar os acessos</p><p className="mt-1 text-[10px] text-koma-muted">Confira a conexão e tente novamente.</p></div>
          <button type="button" onClick={() => void fetchCargos(true)} className="koma-btn-secondary px-4 py-2 text-[10px] font-bold">Tentar novamente</button>
        </section>
      )}

      {isLoading && cargos.length === 0 && (
        <section className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3" aria-label="Carregando funções">
          {[0, 1, 2].map((item) => <div key={item} className="h-44 animate-pulse rounded-3xl border border-koma-border bg-koma-panel" />)}
        </section>
      )}

      {!hasError && cargos.length > 0 && (
        <section className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3" aria-label="Funções e acessos">
          {cargos.map((cargo) => {
            const allowed = PERMISSIONS.filter(({ key }) => cargo.permissoes[key]);
            const denied = PERMISSIONS.filter(({ key }) => !cargo.permissoes[key]);
            return (
              <article key={cargo.slug} className="flex min-h-44 flex-col rounded-3xl border border-koma-border bg-koma-panel p-4 shadow-xs">
                <div className="flex items-start justify-between gap-3 border-b border-koma-border pb-3">
                  <div className="min-w-0">
                    <h2 className="font-serif text-sm font-bold text-koma-foreground">{cargo.label}</h2>
                    <p className="mt-1 text-[9px] leading-relaxed text-koma-muted">{ROLE_DESCRIPTIONS[cargo.slug] || 'Função personalizada da operação.'}</p>
                  </div>
                  <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-koma-border bg-koma-raised px-2.5 py-1 font-mono text-[9px] font-bold text-koma-foreground">
                    <Users size={11} /> {cargo.total_funcionarios}
                  </span>
                </div>

                <div className="mt-3 flex flex-wrap gap-1.5">
                  {allowed.length > 0 ? allowed.map(({ key, label, icon: Icon }) => (
                    <span key={key} className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-2.5 py-1.5 text-[9px] font-bold text-emerald-800 dark:text-emerald-300">
                      <Icon size={11} /><Check size={10} />{label}
                    </span>
                  )) : (
                    <span className="inline-flex items-center gap-1.5 text-[10px] text-koma-muted"><LockKeyhole size={12} /> Sem acesso às áreas administrativas</span>
                  )}
                </div>

                {denied.length > 0 && (
                  <details className="mt-auto pt-3 text-[9px] text-koma-muted">
                    <summary className="w-fit cursor-pointer select-none font-bold hover:text-koma-foreground">Ver limites de acesso</summary>
                    <p className="mt-1.5 leading-relaxed">Não acessa: {denied.map(({ label }) => label.toLocaleLowerCase('pt-BR')).join(', ')}.</p>
                  </details>
                )}
              </article>
            );
          })}
        </section>
      )}
    </div>
  );
};
