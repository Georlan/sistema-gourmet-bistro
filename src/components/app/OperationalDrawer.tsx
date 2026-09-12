import React from 'react';
import clsx from 'clsx';
import {
  ArrowDownRight,
  ArrowUpRight,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  FileText,
  Grid2X2,
  Image as ImageIcon,
  Moon,
  Printer,
  RefreshCw,
  ShoppingBag,
  Sun,
  TrendingUp,
  Type,
  UserCheck,
  UserX,
  Utensils,
  X,
} from 'lucide-react';
import { KomaLogo } from '../KomaLogo';
import { LoginButton } from '../auth/LoginButton';
import type { AppSettings, CaixaTurnoResumo, DraftItem, Order } from '../../types';
import type { KomaTheme } from '../../config/theme';
import { deriveProductionState, getOrderItems } from '../../domain/operationalState';

const LOCAL_STORAGE_DRAFTS_KEY = 'koma_drafts_vFinal_v3';
const LOCAL_STORAGE_FONT_SIZE_KEY = 'koma_font_size';

type FontSize = 'padrao' | 'grande' | 'gigante';
type TableFilter = 'todos' | 'livres' | 'ocupadas' | 'prontas';

type DraftSummary = {
  tableId: number;
  itemCount: number;
};

export interface OperationalDrawerProps {
  portal: 'garcom' | 'caixa';
  restaurantName: string;
  activeWaiterName: string;
  waiterAvailable: boolean;
  orders: Order[];
  tableCounts: { libre: number; ocupada: number; pronto: number };
  turnoResumo: CaixaTurnoResumo | null;
  settings: AppSettings;
  theme: KomaTheme;
  onWaiterAvailabilityChange: (value: boolean) => void;
  onSettingsChange: (value: AppSettings) => void;
  onToggleTheme: () => void;
  onClose: () => void;
  onLogout: () => void;
  onSyncSalon: () => void;
}

function readDraftSummaries(): DraftSummary[] {
  if (typeof window === 'undefined' || !window.localStorage) return [];
  try {
    const raw = window.localStorage.getItem(LOCAL_STORAGE_DRAFTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Record<string, DraftItem[]>;
    return Object.entries(parsed)
      .map(([tableId, items]) => ({
        tableId: Number(tableId),
        itemCount: Array.isArray(items)
          ? items.reduce((total, item) => total + Math.max(1, Number(item?.quantidade || 1)), 0)
          : 0,
      }))
      .filter((entry) => Number.isFinite(entry.tableId) && entry.tableId > 0 && entry.itemCount > 0)
      .sort((a, b) => a.tableId - b.tableId);
  } catch {
    return [];
  }
}

function readFontSize(): FontSize {
  if (typeof window === 'undefined' || !window.localStorage) return 'padrao';
  const stored = window.localStorage.getItem(LOCAL_STORAGE_FONT_SIZE_KEY);
  return stored === 'grande' || stored === 'gigante' ? stored : 'padrao';
}

/** Drawer operacional compartilhado. O App continua dono dos dados e das mutações. */
export function OperationalDrawer({
  portal,
  restaurantName,
  activeWaiterName,
  waiterAvailable,
  orders,
  tableCounts,
  turnoResumo,
  settings,
  theme,
  onWaiterAvailabilityChange,
  onSettingsChange,
  onToggleTheme,
  onClose,
  onLogout,
  onSyncSalon,
}: OperationalDrawerProps) {
  const mesasOcupadasCount = tableCounts.ocupada + tableCounts.pronto;
  const mesasLivresCount = tableCounts.libre;
  const pratosProntosCount = deriveProductionState(orders.flatMap(getOrderItems)).readyItemCount;
  const comandasAbertasCount = orders.filter((order) => Number(order.mesaId) > 0).length;
  const draftSummaries = portal === 'garcom' ? readDraftSummaries() : [];
  const fontSize = readFontSize();

  const deliveryPendentesCount = orders.filter((order: any) =>
    (order.tipo === 'DELIVERY' || order.tipo === 'BALCAO')
    && (order.status === 'NOVO' || order.status === 'PENDENTE' || order.status === 'AGUARDANDO_ACEITE')
  ).length;
  const totalVendasTurno = orders.reduce((acc: number, order: any) =>
    acc + (parseFloat(order.total) || parseFloat(order.valor_total) || 0), 0);
  const totalComandasAbertas = orders.filter((order: any) =>
    order.status === 'ABERTA' || order.status === 'EM_ANDAMENTO' || order.status === 'OPEN'
  ).length;

  const runAfterClose = (callback: () => void) => {
    onClose();
    if (typeof window === 'undefined') return;
    if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(callback);
    else window.setTimeout(callback, 0);
  };

  const openSalonFilter = (filter: TableFilter) => {
    runAfterClose(() => {
      if (typeof document !== 'undefined') document.getElementById(`waiter-filter-${filter}`)?.click();
    });
  };

  const openDraft = (tableId: number) => {
    runAfterClose(() => {
      if (typeof document !== 'undefined') document.getElementById(`mesa-card-${tableId}`)?.click();
    });
  };

  const changeFontSize = (next: FontSize) => {
    if (typeof window === 'undefined' || !window.localStorage) return;
    window.localStorage.setItem(LOCAL_STORAGE_FONT_SIZE_KEY, next);
    window.dispatchEvent(new Event('koma_font_size_changed'));
  };

  const sectionTitle = 'flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-[0.15em] text-emerald-700 dark:text-emerald-400';
  const quickAction = 'group flex min-h-[76px] w-full flex-col justify-between rounded-2xl border border-koma-border bg-koma-card p-3 text-left transition-all hover:border-emerald-500/35 hover:bg-koma-raised active:scale-[0.99]';

  return (
    <div className="fixed inset-0 z-50 flex animate-fade-in">
      <div id="sidebar-backdrop" onClick={onClose} className="fixed inset-0 bg-black/80 backdrop-blur-[2px]" />

      <aside className="relative z-10 flex h-full w-[88vw] max-w-[370px] flex-col border-r border-koma-border bg-koma-panel text-koma-foreground shadow-2xl animate-slide-in-left">
        <header className="sticky top-0 z-20 flex items-center justify-between border-b border-koma-border bg-koma-panel/95 px-4 py-3.5 backdrop-blur-xl sm:px-5">
          <div className="flex min-w-0 items-center gap-2.5">
            <KomaLogo size="md" />
            <div className="min-w-0">
              <span className="block truncate font-serif text-sm font-bold leading-none text-koma-foreground">{restaurantName}</span>
              <span className="mt-1 block text-[9px] font-semibold uppercase tracking-[0.14em] text-emerald-700 dark:text-emerald-400">
                {portal === 'garcom' ? 'Central do garçom' : 'Operação do caixa'}
              </span>
            </div>
          </div>
          <button id="close-sidebar-btn" type="button" onClick={onClose} aria-label="Fechar menu lateral" className="rounded-xl border border-transparent p-2 text-koma-muted transition-colors hover:border-koma-border hover:bg-koma-card hover:text-koma-foreground">
            <X size={18} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-5">
          {portal === 'garcom' ? (
            <div className="space-y-5">
              <section className="rounded-[22px] border border-emerald-500/20 bg-koma-card p-3.5 shadow-sm">
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-emerald-500/30 bg-emerald-500/10 text-sm font-black text-emerald-700 dark:text-emerald-300">
                    {(activeWaiterName || 'G').trim().charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-extrabold text-koma-foreground">{activeWaiterName || 'Garçom'}</p>
                    <p className="mt-0.5 text-[10px] text-koma-subtle">Atendimento • Salão principal</p>
                  </div>
                  <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-1 text-[8px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-300">Garçom</span>
                </div>

                <button
                  id="waiter-availability-toggle"
                  type="button"
                  onClick={() => onWaiterAvailabilityChange(!waiterAvailable)}
                  className={clsx(
                    'mt-3 flex w-full items-center justify-between rounded-xl border px-3 py-2.5 text-xs font-bold transition-all',
                    waiterAvailable
                      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300'
                      : 'border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300',
                  )}
                >
                  <span className="flex items-center gap-2">
                    {waiterAvailable ? <UserCheck size={15} /> : <UserX size={15} />}
                    {waiterAvailable ? 'Disponível no Salão' : 'Ocupado / Em Atendimento'}
                  </span>
                  <span className={clsx('h-2 w-2 rounded-full', waiterAvailable ? 'bg-emerald-400' : 'bg-amber-400')} />
                </button>
              </section>

              <section className="space-y-2.5">
                <div className="flex items-center justify-between gap-3">
                  <h3 className={sectionTitle}><ClipboardList size={13} /> Salão agora</h3>
                  <span className="text-[9px] text-koma-muted">tempo real</span>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div className="rounded-2xl border border-koma-border bg-koma-card p-3">
                    <div className="flex items-center gap-1.5 text-koma-muted"><Grid2X2 size={13} /><span className="text-[9px] font-bold uppercase">Mesas</span></div>
                    <strong className="mt-2 block font-mono text-xl text-emerald-700 dark:text-emerald-300">{mesasOcupadasCount}</strong>
                    <p className="mt-0.5 text-[9px] text-koma-subtle">ocupadas • {mesasLivresCount} livres</p>
                  </div>
                  <div className={clsx('rounded-2xl border bg-koma-card p-3', pratosProntosCount > 0 ? 'border-amber-500/30' : 'border-koma-border')}>
                    <div className={clsx('flex items-center gap-1.5', pratosProntosCount > 0 ? 'text-amber-700 dark:text-amber-300' : 'text-koma-muted')}><CheckCircle2 size={13} /><span className="text-[9px] font-bold uppercase">Prontos</span></div>
                    <strong className={clsx('mt-2 block font-mono text-xl', pratosProntosCount > 0 ? 'text-amber-700 dark:text-amber-300' : 'text-koma-foreground')}>{pratosProntosCount}</strong>
                    <p className="mt-0.5 text-[9px] text-koma-subtle">p/ servir</p>
                  </div>
                  <div className="rounded-2xl border border-koma-border bg-koma-card p-3">
                    <div className="flex items-center gap-1.5 text-koma-muted"><ClipboardList size={13} /><span className="text-[9px] font-bold uppercase">Comandas</span></div>
                    <strong className="mt-2 block font-mono text-xl text-koma-foreground">{comandasAbertasCount}</strong>
                    <p className="mt-0.5 text-[9px] text-koma-subtle">abertas</p>
                  </div>
                </div>
              </section>

              <section className="space-y-2.5">
                <div className="flex items-center justify-between gap-3">
                  <h3 className={sectionTitle}><Utensils size={13} /> Ações rápidas</h3>
                  <span className="text-[9px] text-koma-muted">1 toque</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button id="drawer-show-all-tables" type="button" onClick={() => openSalonFilter('todos')} className={quickAction}>
                    <span className="flex items-center justify-between"><Grid2X2 size={17} className="text-emerald-700 dark:text-emerald-400" /><ChevronRight size={14} className="text-koma-muted transition-transform group-hover:translate-x-0.5" /></span>
                    <span><strong className="block text-[11px] text-koma-foreground">Todas as mesas</strong><span className="mt-0.5 block text-[9px] text-koma-muted">Salão completo</span></span>
                  </button>
                  <button id="drawer-show-ready-tables" type="button" onClick={() => openSalonFilter('prontas')} className={quickAction}>
                    <span className="flex items-center justify-between"><CheckCircle2 size={17} className="text-amber-700 dark:text-amber-300" /><span className="rounded-md bg-amber-500/10 px-1.5 py-0.5 font-mono text-[9px] font-bold text-amber-700 dark:text-amber-300">{pratosProntosCount}</span></span>
                    <span><strong className="block text-[11px] text-koma-foreground">Itens prontos</strong><span className="mt-0.5 block text-[9px] text-koma-muted">Mesas para servir</span></span>
                  </button>
                  <button id="drawer-show-occupied-tables" type="button" onClick={() => openSalonFilter('ocupadas')} className={quickAction}>
                    <span className="flex items-center justify-between"><Utensils size={17} className="text-koma-danger-text" /><span className="font-mono text-[9px] font-bold text-koma-muted">{mesasOcupadasCount}</span></span>
                    <span><strong className="block text-[11px] text-koma-foreground">Mesas ocupadas</strong><span className="mt-0.5 block text-[9px] text-koma-muted">Focar atendimentos</span></span>
                  </button>
                  <button id="drawer-sync-salon" type="button" onClick={() => { onClose(); onSyncSalon(); }} className={quickAction}>
                    <span className="flex items-center justify-between"><RefreshCw size={17} className="text-blue-700 dark:text-blue-300" /><span className="rounded-md bg-blue-500/10 px-1.5 py-0.5 text-[8px] font-bold uppercase text-blue-700 dark:text-blue-300">manual</span></span>
                    <span><strong className="block text-[11px] text-koma-foreground">Sincronizar Salão</strong><span className="mt-0.5 block text-[9px] text-koma-muted">Atualizar agora</span></span>
                  </button>
                </div>
              </section>

              {draftSummaries.length > 0 && (
                <section className="space-y-2.5">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className={sectionTitle}><FileText size={13} /> Continuar pedidos</h3>
                    <span className="rounded-full border border-blue-500/20 bg-blue-500/10 px-2 py-0.5 font-mono text-[9px] font-bold text-blue-700 dark:text-blue-300">{draftSummaries.length}</span>
                  </div>
                  <div className="overflow-hidden rounded-2xl border border-koma-border bg-koma-card">
                    {draftSummaries.slice(0, 3).map((draft, index) => (
                      <button key={draft.tableId} id={`drawer-resume-draft-${draft.tableId}`} type="button" onClick={() => openDraft(draft.tableId)} className={clsx('flex w-full items-center gap-3 px-3 py-3 text-left transition-colors hover:bg-koma-raised', index > 0 && 'border-t border-koma-border')}>
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-blue-500/20 bg-blue-500/10 font-mono text-xs font-black text-blue-700 dark:text-blue-300">{draft.tableId}</div>
                        <div className="min-w-0 flex-1"><strong className="block text-[11px] text-koma-foreground">Mesa {draft.tableId}</strong><span className="mt-0.5 block text-[9px] text-koma-muted">{draft.itemCount} {draft.itemCount === 1 ? 'item' : 'itens'} aguardando lançamento</span></div>
                        <span className="text-[9px] font-bold text-blue-700 dark:text-blue-300">Retomar</span>
                      </button>
                    ))}
                  </div>
                  {draftSummaries.length > 3 && <p className="px-1 text-[9px] text-koma-muted">+ {draftSummaries.length - 3} outros rascunhos salvos neste aparelho.</p>}
                </section>
              )}
            </div>
          ) : (
            <div className="space-y-5">
              <section className="space-y-2.5">
                <h3 className={sectionTitle}>Operador do Caixa</h3>
                <div className="rounded-2xl border border-koma-border bg-koma-card p-3.5">
                  <div className="flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-full border border-emerald-500/20 bg-emerald-500/10 font-bold text-emerald-700 dark:text-emerald-400">{activeWaiterName ? activeWaiterName[0] : 'C'}</div><div><h4 className="text-sm font-bold text-koma-foreground">{activeWaiterName || 'Caixa'}</h4><p className="mt-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-400">Caixa Operacional Ativo</p></div></div>
                </div>
              </section>

              <section className="space-y-2.5">
                <h3 className={sectionTitle}>Sistema de Impressão</h3>
                <button type="button" onClick={() => { onClose(); window.dispatchEvent(new CustomEvent('koma-open-impressoras')); }} className="flex w-full items-center justify-between rounded-2xl border border-koma-border bg-koma-card p-3 text-left transition-all hover:bg-koma-raised">
                  <div className="flex items-center gap-2.5"><div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-2 text-emerald-700 dark:text-emerald-400"><Printer size={16} /></div><div><h4 className="text-xs font-bold text-koma-foreground">Agente de Impressão</h4><p className="text-[9px] font-medium text-emerald-700 dark:text-emerald-400">Servidor Online • Pronto</p></div></div>
                  <span className="rounded-lg border border-koma-border bg-koma-panel px-2 py-1 font-mono text-[9px] font-bold text-koma-subtle">0 Falhas</span>
                </button>
              </section>

              <section className="space-y-2.5">
                <h3 className={sectionTitle}>Resumo do Turno ao Vivo</h3>
                <div className="space-y-2 rounded-2xl border border-koma-border bg-koma-card p-3">
                  <div className="flex items-center justify-between rounded-xl border border-koma-border p-2 text-xs"><div className="flex items-center gap-2"><TrendingUp size={13} className="text-emerald-700 dark:text-emerald-400" /><span className="text-[11px] font-medium text-koma-secondary">Vendas do Turno</span></div><span className="font-mono font-bold text-emerald-700 dark:text-emerald-400">R$ {(turnoResumo?.total_vendas ?? totalVendasTurno).toFixed(2)}</span></div>
                  <div className="flex items-center justify-between rounded-xl border border-koma-border p-2 text-xs"><div className="flex items-center gap-2"><Utensils size={13} className="text-blue-700 dark:text-blue-300" /><span className="text-[11px] font-medium text-koma-secondary">Comandas Abertas</span></div><span className="font-mono font-bold text-koma-foreground">{turnoResumo?.comandas_abertas_count ?? totalComandasAbertas} ativas</span></div>
                  {deliveryPendentesCount > 0 && <div className="flex items-center justify-between rounded-xl border border-amber-300 bg-amber-50 p-2 text-xs dark:border-amber-800/30 dark:bg-amber-950/20"><div className="flex items-center gap-2"><ShoppingBag size={13} className="text-amber-700 dark:text-amber-300" /><span className="text-[11px] font-medium text-amber-600 dark:text-amber-300">Delivery Pendente</span></div><span className="rounded bg-amber-500/20 px-2 py-0.5 font-mono text-[10px] font-bold text-amber-600 dark:text-amber-300">{deliveryPendentesCount} p/ aceitar</span></div>}
                </div>
              </section>

              <section className="space-y-2.5">
                <h3 className={sectionTitle}>Operações de Tesouraria</h3>
                <div className="space-y-2 rounded-2xl border border-koma-border bg-koma-card p-3">
                  <button type="button" onClick={() => { onClose(); window.dispatchEvent(new CustomEvent('koma-open-suprimento')); }} className="flex w-full items-center justify-between rounded-xl border border-koma-border p-2.5 text-xs text-koma-foreground transition-all hover:bg-koma-raised"><div className="flex items-center gap-2.5"><div className="rounded-lg bg-emerald-500/10 p-1.5 text-emerald-700 dark:text-emerald-400"><ArrowDownRight size={14} /></div><span className="font-semibold">Suprimento de Caixa</span></div><span className="font-mono text-[9px] font-bold text-emerald-700 dark:text-emerald-400">+ Troco</span></button>
                  <button type="button" onClick={() => { onClose(); window.dispatchEvent(new CustomEvent('koma-open-sangria')); }} className="flex w-full items-center justify-between rounded-xl border border-koma-border p-2.5 text-xs text-koma-foreground transition-all hover:bg-koma-raised"><div className="flex items-center gap-2.5"><div className="rounded-lg bg-rose-500/10 p-1.5 text-rose-700 dark:text-rose-300"><ArrowUpRight size={14} /></div><span className="font-semibold">Sangria de Segurança</span></div><span className="font-mono text-[9px] font-bold text-rose-700 dark:text-rose-300">- Retirada</span></button>
                  <button type="button" onClick={() => { onClose(); window.dispatchEvent(new CustomEvent('koma-sync-all')); }} className="flex w-full items-center justify-between rounded-xl border border-koma-border p-2.5 text-xs text-koma-foreground transition-all hover:bg-koma-raised"><div className="flex items-center gap-2.5"><div className="rounded-lg bg-blue-500/10 p-1.5 text-blue-700 dark:text-blue-300"><RefreshCw size={14} /></div><span className="font-semibold">Sincronizar Dados</span></div><span className="flex items-center gap-1 font-mono text-[9px] font-bold text-emerald-700 dark:text-emerald-400"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />Ao Vivo</span></button>
                </div>
              </section>
            </div>
          )}

          <section className="mt-5 space-y-2.5">
            <div className="flex items-center justify-between gap-3"><h3 className={sectionTitle}><Type size={13} /> Preferências</h3><span className="text-[9px] text-koma-muted">neste aparelho</span></div>
            <div className="overflow-hidden rounded-2xl border border-koma-border bg-koma-card">
              <div className="flex items-center justify-between gap-3 border-b border-koma-border px-3 py-3">
                <div><span className="block text-[11px] font-semibold text-koma-foreground">Tema Visual</span><span className="mt-0.5 block text-[9px] text-koma-muted">Claro ou escuro</span></div>
                <button type="button" onClick={onToggleTheme} className="flex items-center gap-1.5 rounded-xl border border-koma-border bg-koma-panel px-2.5 py-2 text-[10px] font-bold uppercase text-koma-foreground transition-colors hover:bg-koma-raised" title={theme === 'dark' ? 'Mudar para Modo Claro' : 'Mudar para Modo Escuro'}>
                  {theme === 'dark' ? <Sun size={13} className="text-amber-400" /> : <Moon size={13} className="text-sky-500" />}{theme === 'dark' ? 'Escuro' : 'Claro'}
                </button>
              </div>

              <div className="border-b border-koma-border px-3 py-3">
                <div className="mb-2 flex items-center justify-between"><span className="text-[11px] font-semibold text-koma-foreground">Tamanho do texto</span><span className="text-[9px] text-koma-muted">Acessibilidade</span></div>
                <div className="grid grid-cols-3 gap-1 rounded-xl border border-koma-border bg-koma-panel p-1">
                  {([['padrao', 'Padrão'], ['grande', 'Grande'], ['gigante', 'Gigante']] as const).map(([value, label]) => (
                    <button key={value} id={`drawer-font-${value}`} type="button" onClick={() => changeFontSize(value)} aria-pressed={fontSize === value} className={clsx('rounded-lg px-2 py-1.5 text-[9px] font-bold transition-colors', fontSize === value ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' : 'text-koma-muted hover:text-koma-foreground')}>{label}</button>
                  ))}
                </div>
              </div>

              <label className="flex cursor-pointer items-center justify-between gap-3 border-b border-koma-border px-3 py-3 hover:bg-koma-raised/40">
                <span className="flex items-center gap-2.5"><ImageIcon size={15} className="text-koma-muted" /><span className="text-[11px] font-medium text-koma-foreground">Exibir Imagens dos Pratos</span></span>
                <input id="sidebar-toggle-images" type="checkbox" checked={settings.exibirImagens} onChange={(event) => onSettingsChange({ ...settings, exibirImagens: event.target.checked })} className="sr-only" />
                <span aria-hidden="true" className={clsx('relative h-5 w-9 shrink-0 rounded-full border transition-colors', settings.exibirImagens ? 'border-emerald-500/40 bg-emerald-500/25' : 'border-koma-border bg-koma-panel')}><span className={clsx('absolute top-0.5 h-3.5 w-3.5 rounded-full transition-transform', settings.exibirImagens ? 'translate-x-[18px] bg-emerald-400' : 'translate-x-0.5 bg-koma-muted')} /></span>
              </label>

              <label className="flex cursor-pointer items-center justify-between gap-3 px-3 py-3 hover:bg-koma-raised/40">
                <span className="flex items-center gap-2.5"><FileText size={15} className="text-koma-muted" /><span className="text-[11px] font-medium text-koma-foreground">Exibir Descrição dos Pratos</span></span>
                <input id="sidebar-toggle-descriptions" type="checkbox" checked={settings.exibirDescricoes} onChange={(event) => onSettingsChange({ ...settings, exibirDescricoes: event.target.checked })} className="sr-only" />
                <span aria-hidden="true" className={clsx('relative h-5 w-9 shrink-0 rounded-full border transition-colors', settings.exibirDescricoes ? 'border-emerald-500/40 bg-emerald-500/25' : 'border-koma-border bg-koma-panel')}><span className={clsx('absolute top-0.5 h-3.5 w-3.5 rounded-full transition-transform', settings.exibirDescricoes ? 'translate-x-[18px] bg-emerald-400' : 'translate-x-0.5 bg-koma-muted')} /></span>
              </label>
            </div>
          </section>
        </div>

        <footer className="border-t border-koma-border bg-koma-panel/95 px-4 pb-[calc(0.8rem+env(safe-area-inset-bottom))] pt-3 backdrop-blur-xl sm:px-5">
          <LoginButton variant="default" iconType="logout" onClick={onLogout} className="w-full py-2 text-[10px] uppercase tracking-[0.14em]">LOGOUT / SAIR</LoginButton>
          <div className="mt-2 flex items-center justify-center gap-2 text-[9px] text-koma-muted"><span>{restaurantName}</span><span className="h-1 w-1 rounded-full bg-koma-border" /><span className="font-mono">v3.5 • Dark Engine</span></div>
        </footer>
      </aside>
    </div>
  );
}
