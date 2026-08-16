import React, { useState } from 'react';
import {
  AlertCircle,
  ArrowDownRight,
  ArrowUpRight,
  Banknote,
  CheckCircle2,
  DollarSign,
  History,
  Lock,
  ReceiptText,
  RefreshCw,
  RotateCcw,
  WalletCards,
  WifiOff,
} from 'lucide-react';
import { CaixaAtividadeRecente, CaixaTurnoResumo } from '../../types';
import { normalizeOperationalTimestamp } from '../../domain';
import { EstornoModal } from './EstornoModal';

interface CaixaTurnoAtualTabProps {
  turnoResumo: CaixaTurnoResumo | null;
  isLoading: boolean;
  isConnected: boolean;
  pendingPaymentsCount: number;
  pendingPaymentsTotal: number;
  onRefresh: () => void;
  onNavigateToFechamento: () => void;
  onNavigateToMovimentacoes: () => void;
  onNavigateToPendingPayments: () => void;
  onOpenSangriaModal: () => void;
  onOpenSuprimentoModal: () => void;
  onOpenNovoTurnoModal?: () => void;
}

const currencyFormatter = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const timeFormatter = new Intl.DateTimeFormat('pt-BR', {
  hour: '2-digit',
  minute: '2-digit',
});

const formatCurrency = (value: number) => currencyFormatter.format(Number(value) || 0);

const activityLabel: Record<string, string> = {
  recebimento: 'Venda recebida',
  suprimento: 'Suprimento',
  sangria: 'Sangria',
  estorno: 'Estorno',
};

const paymentMethodLabel: Record<string, string> = {
  dinheiro: 'Dinheiro',
  pix: 'Pix',
  cartao: 'Cartão',
  cartao_credito: 'Crédito',
  cartao_debito: 'Débito',
};

const CaixaSummarySkeleton = () => (
  <div className="space-y-4" aria-busy="true" aria-label="Sincronizando resumo do caixa">
    <div className="h-14 animate-pulse rounded-[18px] border border-koma-border bg-koma-panel" />
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {[0, 1, 2, 3].map(item => (
        <div key={item} className="h-24 animate-pulse rounded-[18px] border border-koma-border bg-koma-panel" />
      ))}
    </div>
    <div className="grid gap-3 xl:grid-cols-[minmax(0,1.65fr)_minmax(280px,0.75fr)]">
      <div className="h-72 animate-pulse rounded-[18px] border border-koma-border bg-koma-panel" />
      <div className="h-72 animate-pulse rounded-[18px] border border-koma-border bg-koma-panel" />
    </div>
  </div>
);

const ActivityIcon = ({ type }: { type: string }) => {
  if (type === 'suprimento') return <ArrowDownRight size={15} />;
  if (type === 'sangria') return <ArrowUpRight size={15} />;
  if (type === 'estorno') return <RotateCcw size={15} />;
  return <ReceiptText size={15} />;
};

const ActivityRow = ({ activity }: { activity: CaixaAtividadeRecente }) => {
  const isOutflow = activity.tipo === 'sangria' || activity.tipo === 'estorno';
  const timestamp = normalizeOperationalTimestamp(activity.criado_em);
  const date = timestamp !== null ? new Date(timestamp) : null;
  const validDate = date !== null && !Number.isNaN(date.getTime());
  const method = activity.metodo ? paymentMethodLabel[activity.metodo] || activity.metodo : null;

  return (
    <li className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-t border-[#202522] px-4 py-3 first:border-t-0 sm:px-5">
      <span className={`flex h-9 w-9 items-center justify-center rounded-xl border ${
        isOutflow
          ? 'border-rose-300 dark:border-rose-900/50 bg-rose-50 dark:bg-rose-950/30 text-rose-800 dark:text-rose-300'
          : 'border-emerald-300 dark:border-emerald-900/50 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-300'
      }`}>
        <ActivityIcon type={activity.tipo} />
      </span>
      <span className="min-w-0">
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
          <strong className="truncate text-xs text-koma-foreground">
            {activityLabel[activity.tipo] || activity.descricao}
          </strong>
          <span className="text-[10px] text-koma-muted">{validDate ? timeFormatter.format(date!) : '—'}</span>
        </span>
        <span className="mt-0.5 block truncate text-[11px] text-koma-muted">
          {activity.origem}{method ? ` · ${method}` : ''}{activity.operador_nome ? ` · ${activity.operador_nome}` : ''}
        </span>
      </span>
      <strong className={`whitespace-nowrap text-xs tabular-nums ${isOutflow ? 'text-rose-800 dark:text-rose-300' : 'text-emerald-800 dark:text-emerald-300'}`}>
        {isOutflow ? '−' : '+'} {formatCurrency(activity.valor)}
      </strong>
    </li>
  );
};

export const CaixaTurnoAtualTab: React.FC<CaixaTurnoAtualTabProps> = ({
  turnoResumo,
  isLoading,
  isConnected,
  pendingPaymentsCount,
  pendingPaymentsTotal,
  onRefresh,
  onNavigateToFechamento,
  onNavigateToMovimentacoes,
  onNavigateToPendingPayments,
  onOpenSangriaModal,
  onOpenSuprimentoModal,
  onOpenNovoTurnoModal,
}) => {
  const [showRefundModal, setShowRefundModal] = useState(false);

  if (!turnoResumo) return <CaixaSummarySkeleton />;

  const isTurnoAberto = turnoResumo.status === 'aberto';
  const isTurnoEsquecido = isTurnoAberto && (
    turnoResumo.tempo_aberto_minutos > 1440 || turnoResumo.turno_esquecido === true
  );
  const digitalTotal = turnoResumo.total_pix + turnoResumo.total_cartao;
  const activities = (turnoResumo.atividades_recentes || []).slice(0, 5);

  if (!isTurnoAberto) {
    return (
      <section className="rounded-[18px] border border-koma-border bg-koma-panel px-5 py-10 text-center animate-fade-in">
        <Lock size={22} className="mx-auto text-koma-muted" />
        <h2 className="mt-3 text-sm font-bold text-koma-foreground">Caixa fechado</h2>
        <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-koma-muted">
          Abra um turno e informe o fundo de troco para começar a conciliação.
        </p>
        {onOpenNovoTurnoModal && (
          <button
            type="button"
            onClick={onOpenNovoTurnoModal}
            className="mt-5 inline-flex items-center gap-2 rounded-xl koma-btn-success px-5 py-2.5 text-xs font-bold uppercase tracking-wider shadow-xs cursor-pointer"
          >
            <DollarSign size={14} /> Abrir caixa
          </button>
        )}
      </section>
    );
  }

  const metrics = [
    {
      label: 'Vendas líquidas',
      value: turnoResumo.total_vendas,
      help: `${turnoResumo.total_pedidos_pagos} comanda(s) com recebimento`,
      icon: ReceiptText,
    },
    {
      label: 'Dinheiro esperado',
      value: turnoResumo.saldo_esperado_dinheiro,
      help: 'Valor físico previsto no caixa após devoluções',
      icon: Banknote,
    },
    {
      label: 'Pix e cartões líquidos',
      value: digitalTotal,
      help: `${formatCurrency(turnoResumo.total_pix)} Pix · ${formatCurrency(turnoResumo.total_cartao)} cartões`,
      icon: WalletCards,
    },
    {
      label: 'Contas pendentes',
      value: pendingPaymentsTotal,
      help: pendingPaymentsCount > 0
        ? `${pendingPaymentsCount} confirmação(ões) aguardando`
        : 'Nenhuma confirmação aguardando',
      icon: CheckCircle2,
    },
  ];

  return (
    <div className="space-y-4 text-left animate-fade-in" aria-live="polite" aria-busy={isLoading}>
      <section className="flex flex-col gap-3 rounded-[18px] border border-koma-border bg-koma-panel p-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3 px-1">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-emerald-300 dark:border-emerald-900/50 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-300">
            <DollarSign size={17} />
          </span>
          <div className="min-w-0">
            <h2 className="text-xs font-bold text-koma-foreground">Ações do turno</h2>
            <p className="mt-0.5 truncate text-[10px] text-koma-muted">Registre entradas, saídas e devoluções antes de fechar o caixa.</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:justify-end">
          {!isConnected && (
            <button type="button" onClick={onRefresh} disabled={isLoading} className="col-span-2 sm:col-span-1 inline-flex items-center justify-center gap-2 rounded-xl border border-koma-border bg-koma-card px-3 py-2 text-[10px] font-bold text-koma-secondary transition-colors hover:border-emerald-500 hover:text-emerald-800 dark:text-emerald-300 disabled:cursor-wait disabled:opacity-60 cursor-pointer shadow-xs">
              <RefreshCw size={13} className={isLoading ? 'animate-spin' : ''} /> Tentar sincronizar
            </button>
          )}
          <button type="button" onClick={onOpenSuprimentoModal} className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-koma-border bg-koma-card px-3 py-2 text-[11px] font-bold text-emerald-800 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 hover:border-emerald-500/50 transition-all cursor-pointer shadow-xs">
            <ArrowDownRight size={14} className="text-emerald-700 dark:text-emerald-400" /> Suprimento
          </button>
          <button type="button" onClick={onOpenSangriaModal} className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-koma-border bg-koma-card px-3 py-2 text-[11px] font-bold text-rose-800 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/40 hover:border-rose-500/50 transition-all cursor-pointer shadow-xs">
            <ArrowUpRight size={14} className="text-rose-700 dark:text-rose-400" /> Sangria
          </button>
          <button type="button" onClick={() => setShowRefundModal(true)} className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-koma-border bg-koma-card px-3 py-2 text-[11px] font-bold text-rose-800 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/40 hover:border-rose-500/50 transition-all cursor-pointer shadow-xs">
            <RotateCcw size={14} /> Estornar
          </button>
          <button type="button" onClick={onNavigateToFechamento} className="col-span-2 sm:col-span-1 inline-flex items-center justify-center gap-2 rounded-xl koma-btn-success px-4 py-2.5 sm:py-2 text-[11px] font-bold uppercase tracking-[0.08em] transition-all cursor-pointer shadow-sm">
            <Lock size={14} /> Fechar caixa
          </button>
        </div>
      </section>

      <section className="grid grid-cols-2 gap-2 sm:gap-3 xl:grid-cols-4">
        {metrics.map(metric => (
          <article key={metric.label} className="min-w-0 rounded-[16px] border border-koma-border bg-koma-panel p-3 sm:rounded-[18px] sm:p-4">
            <span className="flex items-center gap-2 text-[9px] font-bold uppercase tracking-[0.14em] text-koma-muted">
              <metric.icon size={13} className="text-emerald-800 dark:text-emerald-300" /> {metric.label}
            </span>
            <strong className="mt-2 block text-base font-bold tabular-nums text-koma-foreground sm:text-xl">{formatCurrency(metric.value)}</strong>
            <span className="mt-1 block truncate text-[10px] text-koma-muted" title={metric.help}>{metric.help}</span>
          </article>
        ))}
      </section>

      <section className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1.65fr)_minmax(280px,0.75fr)]">
        <article className="overflow-hidden rounded-[18px] border border-koma-border bg-koma-panel">
          <header className="flex items-center justify-between gap-3 border-b border-koma-border px-4 py-3 sm:px-5">
            <div className="flex items-center gap-2">
              <History size={15} className="text-emerald-800 dark:text-emerald-300" />
              <div>
                <h3 className="text-xs font-bold text-koma-foreground">Atividade recente</h3>
                <p className="mt-0.5 text-[10px] text-koma-muted">Últimos recebimentos, devoluções e ajustes deste turno</p>
              </div>
            </div>
            <button type="button" onClick={onNavigateToMovimentacoes} className="shrink-0 text-[10px] font-bold text-emerald-800 dark:text-emerald-300 transition-colors hover:text-[#7becce]">Ver ajustes</button>
          </header>
          {activities.length > 0 ? (
            <ul>{activities.map(activity => <ActivityRow key={activity.id} activity={activity} />)}</ul>
          ) : (
            <div className="flex min-h-48 flex-col items-center justify-center px-5 text-center">
              <History size={22} className="text-koma-muted" />
              <strong className="mt-3 text-xs text-koma-subtle">O turno ainda não teve movimentações</strong>
              <span className="mt-1 text-[10px] text-koma-muted">Vendas recebidas, estornos, sangrias e suprimentos aparecerão aqui.</span>
            </div>
          )}
        </article>

        <div className="space-y-3">
          <article className="rounded-[18px] border border-koma-border bg-koma-panel p-4">
            <div className="flex items-center gap-2 border-b border-koma-border pb-3">
              <Banknote size={15} className="text-emerald-800 dark:text-emerald-300" />
              <h3 className="text-[10px] font-bold uppercase tracking-[0.13em] text-koma-secondary">Conferência do dinheiro</h3>
            </div>
            <dl className="mt-3 space-y-2.5 text-xs">
              <div className="flex justify-between gap-3 text-koma-subtle"><dt>Saldo inicial</dt><dd className="tabular-nums text-koma-foreground">{formatCurrency(turnoResumo.saldo_inicial)}</dd></div>
              <div className="flex justify-between gap-3 text-koma-subtle"><dt>Líquido em dinheiro</dt><dd className={`tabular-nums ${turnoResumo.total_dinheiro < 0 ? 'text-rose-800 dark:text-rose-300' : 'text-koma-foreground'}`}>{turnoResumo.total_dinheiro >= 0 ? '+' : '−'} {formatCurrency(Math.abs(turnoResumo.total_dinheiro))}</dd></div>
              <div className="flex justify-between gap-3 text-koma-subtle"><dt>Suprimentos</dt><dd className="tabular-nums text-koma-foreground">+ {formatCurrency(turnoResumo.total_suprimentos)}</dd></div>
              <div className="flex justify-between gap-3 text-koma-subtle"><dt>Sangrias</dt><dd className="tabular-nums text-rose-800 dark:text-rose-300">− {formatCurrency(turnoResumo.total_sangrias)}</dd></div>
              <div className="flex items-end justify-between gap-3 border-t border-koma-border pt-3"><dt className="font-bold text-koma-secondary">Esperado no caixa</dt><dd className="text-base font-bold tabular-nums text-emerald-800 dark:text-emerald-300">{formatCurrency(turnoResumo.saldo_esperado_dinheiro)}</dd></div>
            </dl>
          </article>

          <article className={`rounded-[18px] border p-3 ${
            !isConnected || isTurnoEsquecido || pendingPaymentsCount > 0
              ? 'border-[#3d3a30] bg-koma-card'
              : 'border-emerald-300 dark:border-emerald-900/50 bg-emerald-50 dark:bg-emerald-950/30'
          }`}>
            <div className="flex items-start gap-3">
              {!isConnected ? <WifiOff size={17} className="mt-0.5 shrink-0 text-koma-subtle" /> : isTurnoEsquecido || pendingPaymentsCount > 0 ? <AlertCircle size={17} className="mt-0.5 shrink-0 text-koma-subtle" /> : <CheckCircle2 size={17} className="mt-0.5 shrink-0 text-emerald-800 dark:text-emerald-300" />}
              <div className="min-w-0">
                <h3 className="text-xs font-bold text-koma-foreground">
                  {!isConnected ? 'Sincronização reconectando' : isTurnoEsquecido ? 'Turno aberto há mais de 24 horas' : pendingPaymentsCount > 0 ? 'Há contas aguardando confirmação' : 'Operação em dia'}
                </h3>
                <p className="mt-0.5 text-[10px] leading-relaxed text-koma-muted">
                  {!isConnected ? 'As informações salvas continuam disponíveis e serão atualizadas ao reconectar.' : isTurnoEsquecido ? 'Confira os valores e encerre o turno anterior antes de continuar.' : pendingPaymentsCount > 0 ? `${pendingPaymentsCount} pagamento(s) precisam de conferência.` : 'Resumo conciliado e atualização em tempo real ativa.'}
                </p>
                {(isTurnoEsquecido || pendingPaymentsCount > 0) && (
                  <button type="button" onClick={isTurnoEsquecido ? onNavigateToFechamento : onNavigateToPendingPayments} className="mt-3 text-[10px] font-bold text-emerald-800 dark:text-emerald-300 hover:text-[#7becce]">
                    {isTurnoEsquecido ? 'Conferir e fechar caixa' : 'Conferir pagamentos'}
                  </button>
                )}
              </div>
            </div>
          </article>
        </div>
      </section>

      {showRefundModal && (
        <EstornoModal
          onClose={() => setShowRefundModal(false)}
          onSuccess={() => {
            onRefresh();
          }}
        />
      )}
    </div>
  );
};
