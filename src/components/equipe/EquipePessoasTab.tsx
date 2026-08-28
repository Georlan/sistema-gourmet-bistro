import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import {
  Check,
  Clock3,
  Search,
  Send,
  ShieldCheck,
  Trash2,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import type { SystemUser } from '../../types';
import { OperationalBanner } from '../shared/OperationalBanner';
import { KomaEmptyState } from '../shared/KomaEmptyState';

type TeamFilter = 'todos' | 'ativos' | 'convites';

interface EquipePessoasTabProps {
  users: SystemUser[];
  onCreate: (payload: { nome: string; telefone: string; cargo: string }) => Promise<void>;
  onResendInvite: (user: SystemUser) => Promise<void>;
  onRemove: (userId: string) => Promise<void>;
}

const ROLE_ALIASES: Record<string, string> = {
  operador_caixa: 'caixa',
};

const ROLE_META: Record<string, { label: string; description: string }> = {
  admin: { label: 'Administrador', description: 'Acesso completo à gestão do restaurante.' },
  gerente: { label: 'Gerente', description: 'Acompanha operação, caixa, relatórios e equipe.' },
  caixa: { label: 'Operador de caixa', description: 'Opera vendas, recebimentos e rotinas do caixa.' },
  garcom: { label: 'Garçom', description: 'Abre pedidos e acompanha o atendimento do salão.' },
  atendente: { label: 'Atendente', description: 'Registra e acompanha pedidos da operação.' },
  cozinha: { label: 'Cozinha', description: 'Acompanha o preparo dos itens.' },
  motoboy: { label: 'Entregador', description: 'Acompanha somente as entregas atribuídas.' },
};

const INVITABLE_ROLES = ['garcom', 'caixa', 'gerente', 'motoboy'] as const;

function normalizeRole(user: SystemUser): string {
  const rawRole = String(user.role || user.cargo || 'garcom').trim().toLowerCase();
  return ROLE_ALIASES[rawRole] || rawRole;
}

function formatPhone(value?: string): string {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 11) return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  if (digits.length === 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  return value || 'Contato não informado';
}

function memberStatus(user: SystemUser): 'ativo' | 'pendente' | 'inativo' {
  if (user.status === 'pendente_ativacao') return 'pendente';
  if (user.status === 'ativo' || !user.status) return 'ativo';
  return 'inativo';
}

export function EquipePessoasTab({ users, onCreate, onResendInvite, onRemove }: EquipePessoasTabProps) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<TeamFilter>('todos');
  const [inviteOpen, setInviteOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [busyUserAction, setBusyUserAction] = useState<string | null>(null);
  const [formError, setFormError] = useState('');
  const [nome, setNome] = useState('');
  const [telefone, setTelefone] = useState('');
  const [cargo, setCargo] = useState<(typeof INVITABLE_ROLES)[number]>('garcom');

  const activeCount = users.filter((user) => memberStatus(user) === 'ativo').length;
  const pendingCount = users.filter((user) => memberStatus(user) === 'pendente').length;
  const roleCount = new Set(users.map(normalizeRole)).size;

  const filteredUsers = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('pt-BR');
    return users
      .filter((user) => {
        const status = memberStatus(user);
        const role = ROLE_META[normalizeRole(user)]?.label || normalizeRole(user);
        const matchesFilter = filter === 'todos'
          || (filter === 'ativos' && status === 'ativo')
          || (filter === 'convites' && status === 'pendente');
        const haystack = `${user.nome} ${user.telefone || ''} ${user.usuario || ''} ${role}`.toLocaleLowerCase('pt-BR');
        return matchesFilter && (!term || haystack.includes(term));
      })
      .sort((a, b) => {
        const statusOrder = { pendente: 0, ativo: 1, inativo: 2 };
        const statusDifference = statusOrder[memberStatus(a)] - statusOrder[memberStatus(b)];
        return statusDifference || a.nome.localeCompare(b.nome, 'pt-BR');
      });
  }, [filter, search, users]);

  const closeInvite = () => {
    if (submitting) return;
    setInviteOpen(false);
    setFormError('');
  };

  useEffect(() => {
    if (!inviteOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeInvite();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [inviteOpen, submitting]);

  const handlePhoneChange = (value: string) => {
    const digits = value.replace(/\D/g, '').slice(0, 11);
    if (digits.length <= 2) setTelefone(digits);
    else if (digits.length <= 6) setTelefone(`(${digits.slice(0, 2)}) ${digits.slice(2)}`);
    else if (digits.length <= 10) setTelefone(`(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`);
    else setTelefone(`(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const cleanName = nome.trim();
    const cleanPhone = telefone.replace(/\D/g, '');
    if (!cleanName || cleanPhone.length < 10) {
      setFormError('Informe o nome e um WhatsApp válido para continuar.');
      return;
    }

    setSubmitting(true);
    setFormError('');
    try {
      await onCreate({ nome: cleanName, telefone: cleanPhone, cargo });
      setNome('');
      setTelefone('');
      setCargo('garcom');
      setInviteOpen(false);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Não foi possível enviar o convite.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleResend = async (user: SystemUser) => {
    if (busyUserAction) return;
    setBusyUserAction(`invite-${user.id}`);
    try {
      await onResendInvite(user);
    } catch {
      // A tela principal já apresenta a mensagem devolvida pela API.
    } finally {
      setBusyUserAction(null);
    }
  };

  const handleRemove = async (userId: string) => {
    if (busyUserAction) return;
    setBusyUserAction(`remove-${userId}`);
    try {
      await onRemove(userId);
    } catch {
      // A tela principal já apresenta a mensagem devolvida pela API.
    } finally {
      setBusyUserAction(null);
    }
  };

  return (
    <div className="space-y-4 text-left animate-fade-in">
      <OperationalBanner
        id="team-people-title"
        eyebrow="EQUIPE"
        title="Pessoas certas"
        accent="no acesso certo"
        description="Convide a equipe, acompanhe ativações e mantenha cada função fácil de identificar."
        metrics={[
          { label: users.length === 1 ? 'pessoa' : 'pessoas', value: users.length },
          { label: 'acessos ativos', value: activeCount },
          { label: pendingCount === 1 ? 'convite pendente' : 'convites pendentes', value: pendingCount },
          { label: roleCount === 1 ? 'função em uso' : 'funções em uso', value: roleCount },
        ]}
      />

      <section className="rounded-2xl border border-koma-border bg-koma-panel p-2.5 shadow-xs" aria-label="Busca e ações da equipe">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
          <label className="relative min-w-0 flex-1">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-koma-muted" />
            <span className="sr-only">Buscar pessoa</span>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar por nome, WhatsApp ou função..."
              className="w-full rounded-xl border border-koma-border bg-koma-input py-2.5 pl-9 pr-3 text-xs text-koma-foreground outline-none transition-colors focus:border-emerald-500"
            />
          </label>
          <div className="grid grid-cols-3 rounded-xl border border-koma-border bg-koma-page p-1 text-[10px] font-bold">
            {([
              ['todos', `Todos ${users.length}`],
              ['ativos', `Ativos ${activeCount}`],
              ['convites', `Convites ${pendingCount}`],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setFilter(value)}
                className={clsx(
                  'rounded-lg px-3 py-2 transition-colors cursor-pointer',
                  filter === value ? 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-300' : 'text-koma-muted hover:text-koma-foreground',
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <button type="button" onClick={() => setInviteOpen(true)} className="koma-btn-success inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-bold">
            <UserPlus size={15} /> Convidar pessoa
          </button>
        </div>
      </section>

      {filteredUsers.length > 0 ? (
        <section className="grid grid-cols-1 gap-3 xl:grid-cols-2" aria-label="Pessoas da equipe">
          {filteredUsers.map((user) => {
            const role = normalizeRole(user);
            const roleMeta = ROLE_META[role] || { label: role, description: 'Função personalizada da operação.' };
            const status = memberStatus(user);
            const isAdmin = role === 'admin';
            return (
              <article key={user.id} className="rounded-2xl border border-koma-border bg-koma-panel p-4 shadow-xs transition-colors hover:bg-koma-raised/35">
                <div className="flex items-start gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-emerald-500/25 bg-emerald-500/10 font-serif text-sm font-bold text-emerald-800 dark:text-emerald-300">
                    {user.nome.trim().charAt(0).toUpperCase() || 'K'}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h2 className="truncate font-serif text-sm font-bold text-koma-foreground">{user.nome}</h2>
                        <p className="mt-0.5 truncate font-mono text-[10px] text-koma-muted">{formatPhone(user.telefone || user.usuario)}</p>
                      </div>
                      <span className={clsx(
                        'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[9px] font-extrabold uppercase tracking-wide',
                        status === 'ativo' && 'border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300',
                        status === 'pendente' && 'border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300',
                        status === 'inativo' && 'border-koma-border bg-koma-raised text-koma-muted',
                      )}>
                        {status === 'ativo' ? <Check size={11} /> : <Clock3 size={11} />}
                        {status === 'ativo' ? 'Acesso ativo' : status === 'pendente' ? 'Aguardando ativação' : 'Inativo'}
                      </span>
                    </div>
                    <div className="mt-3 flex flex-wrap items-end justify-between gap-3 border-t border-koma-border pt-3">
                      <div>
                        <span className="inline-flex items-center gap-1.5 text-[10px] font-bold text-koma-foreground"><ShieldCheck size={13} className="text-emerald-700 dark:text-emerald-400" /> {roleMeta.label}</span>
                        <p className="mt-0.5 text-[9px] text-koma-muted">{roleMeta.description}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        {status === 'pendente' && (
                          <button type="button" disabled={Boolean(busyUserAction)} onClick={() => void handleResend(user)} className="koma-btn-secondary inline-flex items-center gap-1.5 px-3 py-2 text-[10px] font-bold disabled:cursor-not-allowed disabled:opacity-60">
                            <Send size={13} /> {busyUserAction === `invite-${user.id}` ? 'Enviando...' : 'Reenviar convite'}
                          </button>
                        )}
                        {!isAdmin && (
                          <button
                            type="button"
                            disabled={Boolean(busyUserAction)}
                            onClick={() => void handleRemove(user.id)}
                            className="inline-flex items-center gap-1.5 rounded-xl px-2.5 py-2 text-[10px] font-bold text-rose-700 transition-colors hover:bg-rose-500/10 disabled:cursor-not-allowed disabled:opacity-60 dark:text-rose-300"
                            aria-label={`Remover ${user.nome}`}
                          >
                            <Trash2 size={13} /> <span className="hidden sm:inline">Remover</span>
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </article>
            );
          })}
        </section>
      ) : (
        <KomaEmptyState
          icon={<Users size={24} className="text-koma-muted" />}
          title={users.length === 0 ? 'Sua equipe começa aqui' : 'Nenhuma pessoa encontrada'}
          description={users.length === 0 ? 'Convide a primeira pessoa e escolha a função que define seu acesso.' : 'Ajuste a busca ou os filtros para encontrar outro membro.'}
          action={users.length === 0 ? { label: 'Convidar primeira pessoa', onClick: () => setInviteOpen(true), icon: UserPlus } : undefined}
          variant="panel"
        />
      )}

      {inviteOpen && createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget) closeInvite(); }}>
          <div role="dialog" aria-modal="true" aria-labelledby="invite-team-title" className="max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-3xl border border-koma-border bg-koma-dialog p-5 text-left shadow-2xl sm:p-6">
            <div className="flex items-start justify-between gap-3 border-b border-koma-border pb-4">
              <div>
                <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-emerald-700 dark:text-emerald-400">Novo acesso</p>
                <h2 id="invite-team-title" className="mt-1 font-serif text-lg font-bold text-koma-foreground">Convidar para a equipe</h2>
                <p className="mt-1 text-[10px] text-koma-muted">O convite será enviado automaticamente pelo WhatsApp.</p>
              </div>
              <button type="button" onClick={closeInvite} className="rounded-full p-2 text-koma-muted transition-colors hover:bg-koma-raised hover:text-koma-foreground" aria-label="Fechar convite"><X size={17} /></button>
            </div>

            <form onSubmit={handleSubmit} className="mt-5 space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1.5">
                  <span className="text-[9px] font-bold uppercase tracking-wider text-koma-muted">Nome completo</span>
                  <input autoFocus required value={nome} onChange={(event) => setNome(event.target.value)} placeholder="Ex.: Pedro Henrique" className="w-full rounded-xl border border-koma-border bg-koma-input px-3.5 py-2.5 text-xs text-koma-foreground outline-none focus:border-emerald-500" />
                </label>
                <label className="space-y-1.5">
                  <span className="text-[9px] font-bold uppercase tracking-wider text-koma-muted">WhatsApp</span>
                  <input required inputMode="tel" value={telefone} onChange={(event) => handlePhoneChange(event.target.value)} placeholder="(81) 99999-9999" className="w-full rounded-xl border border-koma-border bg-koma-input px-3.5 py-2.5 font-mono text-xs text-koma-foreground outline-none focus:border-emerald-500" />
                </label>
              </div>

              <fieldset>
                <legend className="mb-2 text-[9px] font-bold uppercase tracking-wider text-koma-muted">O que essa pessoa fará?</legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  {INVITABLE_ROLES.map((role) => {
                    const meta = ROLE_META[role];
                    const selected = cargo === role;
                    return (
                      <button key={role} type="button" onClick={() => setCargo(role)} className={clsx('rounded-2xl border p-3 text-left transition-colors', selected ? 'border-emerald-500 bg-emerald-500/10' : 'border-koma-border bg-koma-panel hover:bg-koma-raised')}>
                        <span className="flex items-center justify-between gap-2 text-xs font-bold text-koma-foreground">{meta.label}{selected && <Check size={14} className="text-emerald-700 dark:text-emerald-400" />}</span>
                        <span className="mt-1 block text-[9px] leading-relaxed text-koma-muted">{meta.description}</span>
                      </button>
                    );
                  })}
                </div>
              </fieldset>

              {formError && <p role="alert" className="rounded-xl border border-rose-500/25 bg-rose-500/10 px-3 py-2.5 text-[10px] font-medium text-rose-700 dark:text-rose-300">{formError}</p>}

              <div className="grid grid-cols-2 gap-2 border-t border-koma-border pt-4">
                <button type="button" onClick={closeInvite} className="koma-btn-secondary px-4 py-2.5 text-xs font-bold">Cancelar</button>
                <button type="submit" disabled={submitting} className="koma-btn-success inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-bold disabled:cursor-not-allowed disabled:opacity-60">
                  <Send size={14} /> {submitting ? 'Enviando...' : 'Cadastrar e enviar'}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
