import React from 'react';
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
  WalletCards,
  WifiOff,
} from 'lucide-react';
import { CaixaAtividadeRecente, CaixaTurnoResumo } from '../../types';

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
    <div className="h-14 animate-pulse rounded-[18px] border border-[#252b28] bg-[#0d100f]" />
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {[0, 1, 2, 3].map(item => (
        <div key={item} className="h-24 animate-pulse rounded-[18px] border border-[#252b28] bg-[#0d100f]" />
      ))}
    </div>
    <div className="grid gap-3 xl:grid-cols-[minmax(0,1.65fr)_minmax(280px,0.75fr)]">
      <div className="h-72 animate-pulse rounded-[18px] border border-[#252b28] bg-[#0d100f]" />
      <div className="h-72 animate-pulse rounded-[18px] border border-[#252b28] bg-[#0d100f]" />
    </div>
  </div>
);

const ActivityIcon = ({ type }: { type: string }) => {
  if (type === 'suprimento') return <ArrowDownRight size={15} />;
  if (type === 'sangria') return <ArrowUpRight size={15} />;
  return <ReceiptText size={15} />;
};

const ActivityRow = ({ activity }: { activity: CaixaAtividadeRecente }) => {
  const isWithdrawal = activity.tipo === 'sangria';
  const date = new Date(activity.criado_em);
  const validDate = !Number.isNaN(date.getTime());
  const method = activity.metodo ? paymentMethodLabel[activity.metodo] || activity.metodo : null;

  return (
    <li className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-t border-[#202522] px-4 py-3 first:border-t-0 sm:px-5">
      <span className={`flex h-9 w-9 items-center justify-center rounded-xl border ${
        isWithdrawal
          ? 'border-[#5a3434] bg-[#1b1212] text-[#dca8a8]'
          : 'border-[#145c49] bg-[#0b2d25] text-[#54d9b3]'
      }`}>
        <ActivityIcon type={activity.tipo} />
      </span>
      <span className="min-w-0">
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
          <strong className="truncate text-xs text-[#f5f4ef]">
            {activityLabel[activity.tipo] || activity.descricao}
          </strong>
          <span className="text-[10px] text-zinc-600">{validDate ? timeFormatter.format(date) : '—'}</span>
        </span>
        <span className="mt-0.5 block truncate text-[11px] text-zinc-500">
          {activity.origem}{method ? ` · ${method}` : ''}{activity.operador_nome ? ` · ${activity.operador_nome}` : ''}
        </span>
      </span>
      <strong className={`whitespace-nowrap text-xs tabular-nums ${isWithdrawal ? 'text-[#dca8a8]' : 'text-[#54d9b3]'}`}>
        {isWithdrawal ? '−' : '+'} {formatCurrency(activity.valor)}
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
  if (!turnoResumo) return <CaixaSummarySkeleton />;

  const isTurnoAberto = turnoResumo.status === 'aberto';
  const isTurnoEsquecido = isTurnoAberto && (
    turnoResumo.tempo_aberto_minutos > 1440 || turnoResumo.turno_esquecido === true
  );
  const digitalTotal = turnoResumo.total_pix + turnoResumo.total_cartao;
  const activities = turnoResumo.atividades_recentes || [];

  if (!isTurnoAberto) {
    return (
      <section className="rounded-[18px] border border-[#252b28] bg-[#0d100f] px-5 py-10 text-center animate-fade-in">
        <Lock size={22} className="mx-auto text-zinc-600" />
        <h2 className="mt-3 text-sm font-bold text-[#f5f4ef]">Caixa fechado</h2>
        <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-zinc-500">
          Abra um turno e informe o fundo de troco para começar a conciliação.
        </p>
        {onOpenNovoTurnoModal && (
          <button
            type="button"
            onClick={onOpenNovoTurnoModal}
            className="mt-5 inline-flex items-center gap-2 rounded-xl bg-[#00b894] px-5 py-2.5 text-[10px] font-bold uppercase tracking-[0.1em] text-[#06110e] transition-colors hover:bg-[#12c9a3]"
          >
            <DollarSign size={14} /> Abrir caixa
          </button>
        )}
      </section>
    );
  }

  const metrics = [
    {
      label: 'Vendas recebidas',
      value: turnoResumo.total_vendas,
      help: `${turnoResumo.total_pedidos_pagos} comanda(s) paga(s)`,
      icon: ReceiptText,
    },
    {
      label: 'Dinheiro esperado',
      value: turnoResumo.saldo_esperado_dinheiro,
      help: 'Valor físico previsto no caixa',
      icon: Banknote,
    },
    {
      label: 'Pix e cartões',
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
      <section className="flex flex-col gap-3 rounded-[18px] border border-[#252b28] bg-[#0d100f] p-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3 px-1">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[#145c49] bg-[#0b2d25] text-[#54d9b3]">
            <DollarSign size={17} />
          </span>
          <div className="min-w-0">
            <h2 className="text-xs font-bold text-[#f5f4ef]">Ações do turno</h2>
            <p className="mt-0.5 truncate text-[10px] text-zinc-500">Registre entradas e saídas antes de fechar o caixa.</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:justify-end">
          <button type="button" onClick={onRefresh} disabled={isLoading} className="inline-flex items-center justify-center gap-2 rounded-xl border border-[#303532] bg-[#151816] px-3 py-2 text-[10px] font-bold text-zinc-300 transition-colors hover:border-[#196b55] hover:text-[#54d9b3] disabled:cursor-wait disabled:opacity-60">
            <RefreshCw size={13} className={isLoading ? 'animate-spin' : ''} /> Atualizar
          </button>
          <button type="button" onClick={onOpenSuprimentoModal} className="inline-flex items-center justify-center gap-2 rounded-xl border border-[#303532] bg-[#151816] px-3 py-2 text-[10px] font-bold text-zinc-300 transition-colors hover:border-[#196b55] hover:text-[#54d9b3]">
            <ArrowDownRight size={13} /> Suprimento
          </button>
          <button type="button" onClick={onOpenSangriaModal} className="inline-flex items-center justify-center gap-2 rounded-xl border border-[#303532] bg-[#151816] px-3 py-2 text-[10px] font-bold text-zinc-300 transition-colors hover:border-[#5a3434] hover:text-[#dca8a8]">
            <ArrowUpRight size={13} /> Sangria
          </button>
          <button type="button" onClick={onNavigateToFechamento} className="inline-flex items-center justify-center gap-2 rounded-xl border border-[#196b55] bg-[#0b2d25] px-3 py-2 text-[10px] font-bold uppercase tracking-[0.08em] text-[#60e4be] transition-colors hover:bg-[#103b30]">
            <Lock size={13} /> Fechar caixa
          </button>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map(metric => (
          <article key={metric.label} className="rounded-[18px] border border-[#252b28] bg-[#111412] p-4">
            <span className="flex items-center gap-2 text-[9px] font-bold uppercase tracking-[0.14em] text-zinc-500">
              <metric.icon size={13} className="text-[#54d9b3]" /> {metric.label}
            </span>
            <strong className="mt-2 block text-xl font-bold tabular-nums text-[#f5f4ef]">{formatCurrency(metric.value)}</strong>
            <span className="mt-1 block truncate text-[10px] text-zinc-500" title={metric.help}>{metric.help}</span>
          </article>
        ))}
      </section>

      <section className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1.65fr)_minmax(280px,0.75fr)]">
        <article className="overflow-hidden rounded-[18px] border border-[#252b28] bg-[#0d100f]">
          <header className="flex items-center justify-between gap-3 border-b border-[#252b28] px-4 py-3 sm:px-5">
            <div className="flex items-center gap-2">
              <History size={15} className="text-[#54d9b3]" />
              <div>
                <h3 className="text-xs font-bold text-[#f5f4ef]">Atividade recente</h3>
                <p className="mt-0.5 text-[10px] text-zinc-500">Últimos recebimentos e ajustes deste turno</p>
              </div>
            </div>
            <button type="button" onClick={onNavigateToMovimentacoes} className="shrink-0 text-[10px] font-bold text-[#54d9b3] transition-colors hover:text-[#7becce]">Ver ajustes</button>
          </header>
          {activities.length > 0 ? (
            <ul>{activities.map(activity => <ActivityRow key={activity.id} activity={activity} />)}</ul>
          ) : (
            <div className="flex min-h-48 flex-col items-center justify-center px-5 text-center">
              <History size={22} className="text-zinc-700" />
              <strong className="mt-3 text-xs text-zinc-400">O turno ainda não teve movimentações</strong>
              <span className="mt-1 text-[10px] text-zinc-600">Vendas recebidas, sangrias e suprimentos aparecerão aqui.</span>
            </div>
          )}
        </article>

        <div className="space-y-3">
          <article className="rounded-[18px] border border-[#252b28] bg-[#111412] p-4">
            <div className="flex items-center gap-2 border-b border-[#252b28] pb-3">
              <Banknote size={15} className="text-[#54d9b3]" />
              <h3 className="text-[10px] font-bold uppercase tracking-[0.13em] text-zinc-300">Conferência do dinheiro</h3>
            </div>
            <dl className="mt-3 space-y-2.5 text-xs">
              <div className="flex justify-between gap-3 text-zinc-400"><dt>Saldo inicial</dt><dd className="tabular-nums text-[#f5f4ef]">{formatCurrency(turnoResumo.saldo_inicial)}</dd></div>
              <div className="flex justify-between gap-3 text-zinc-400"><dt>Recebido em dinheiro</dt><dd className="tabular-nums text-[#f5f4ef]">+ {formatCurrency(turnoResumo.total_dinheiro)}</dd></div>
              <div className="flex justify-between gap-3 text-zinc-400"><dt>Suprimentos</dt><dd className="tabular-nums text-[#f5f4ef]">+ {formatCurrency(turnoResumo.total_suprimentos)}</dd></div>
              <div className="flex justify-between gap-3 text-zinc-400"><dt>Sangrias</dt><dd className="tabular-nums text-[#dca8a8]">− {formatCurrency(turnoResumo.total_sangrias)}</dd></div>
              <div className="flex items-end justify-between gap-3 border-t border-[#252b28] pt-3"><dt className="font-bold text-zinc-300">Esperado no caixa</dt><dd className="text-base font-bold tabular-nums text-[#54d9b3]">{formatCurrency(turnoResumo.saldo_esperado_dinheiro)}</dd></div>
            </dl>
          </article>

          <article className={`rounded-[18px] border p-4 ${
            !isConnected || isTurnoEsquecido || pendingPaymentsCount > 0
              ? 'border-[#3d3a30] bg-[#151511]'
              : 'border-[#145c49] bg-[#0b211b]'
          }`}>
            <div className="flex items-start gap-3">
              {!isConnected ? <WifiOff size={17} className="mt-0.5 shrink-0 text-zinc-400" /> : isTurnoEsquecido || pendingPaymentsCount > 0 ? <AlertCircle size={17} className="mt-0.5 shrink-0 text-zinc-400" /> : <CheckCircle2 size={17} className="mt-0.5 shrink-0 text-[#54d9b3]" />}
              <div className="min-w-0">
                <h3 className="text-xs font-bold text-[#f5f4ef]">
                  {!isConnected ? 'Sincronização reconectando' : isTurnoEsquecido ? 'Turno aberto há mais de 24 horas' : pendingPaymentsCount > 0 ? 'Há contas aguardando confirmação' : 'Operação em dia'}
                </h3>
                <p className="mt-1 text-[10px] leading-relaxed text-zinc-500">
                  {!isConnected ? 'As informações salvas continuam disponíveis e serão atualizadas ao reconectar.' : isTurnoEsquecido ? 'Confira os valores e encerre o turno anterior antes de continuar.' : pendingPaymentsCount > 0 ? `${pendingPaymentsCount} pagamento(s) precisam de conferência.` : 'Resumo conciliado e atualização em tempo real ativa.'}
                </p>
                {(isTurnoEsquecido || pendingPaymentsCount > 0) && (
                  <button type="button" onClick={isTurnoEsquecido ? onNavigateToFechamento : onNavigateToPendingPayments} className="mt-3 text-[10px] font-bold text-[#54d9b3] hover:text-[#7becce]">
                    {isTurnoEsquecido ? 'Conferir e fechar caixa' : 'Conferir pagamentos'}
                  </button>
                )}
              </div>
            </div>
          </article>
        </div>
      </section>
    </div>
  );
};
