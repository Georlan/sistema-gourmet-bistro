import React from 'react';
import {
  ArrowDownRight,
  ArrowUpRight,
  Banknote,
  Calculator,
  CheckCircle2,
  Clock,
  CreditCard,
  DollarSign,
  Lock,
  QrCode,
  RefreshCw,
  User,
} from 'lucide-react';
import { CaixaTurnoResumo } from '../../types';

interface CaixaTurnoAtualTabProps {
  turnoResumo: CaixaTurnoResumo | null;
  isLoading: boolean;
  onRefresh: () => void;
  onNavigateToFechamento: () => void;
  onOpenNovoTurnoModal?: () => void;
}

const currencyFormatter = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const formatCurrency = (value: number) => currencyFormatter.format(Number(value) || 0);

const formatMinutes = (minutes: number) => {
  if (!minutes || minutes <= 0) return 'agora';
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours === 0) return `${remainingMinutes} min`;
  return `${hours}h ${remainingMinutes}min`;
};

const CaixaSummarySkeleton = () => (
  <div className="space-y-4" aria-busy="true" aria-label="Sincronizando resumo do caixa">
    <div className="flex items-center justify-between rounded-[18px] border border-[#252b28] bg-[#0d100f] p-4">
      <div className="space-y-2">
        <div className="h-3 w-28 animate-pulse rounded bg-white/[0.08]" />
        <div className="h-2.5 w-52 animate-pulse rounded bg-white/[0.05]" />
      </div>
      <div className="h-9 w-9 animate-pulse rounded-xl bg-white/[0.06]" />
    </div>
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {[0, 1, 2, 3].map(item => (
        <div key={item} className="h-24 animate-pulse rounded-[18px] border border-[#252b28] bg-[#0d100f]" />
      ))}
    </div>
    <p className="text-center text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500">
      Sincronizando dados do turno…
    </p>
  </div>
);

export const CaixaTurnoAtualTab: React.FC<CaixaTurnoAtualTabProps> = ({
  turnoResumo,
  isLoading,
  onRefresh,
  onNavigateToFechamento,
  onOpenNovoTurnoModal,
}) => {
  if (!turnoResumo) return <CaixaSummarySkeleton />;

  const isTurnoAberto = turnoResumo.status === 'aberto';
  const isTurnoEsquecido = isTurnoAberto && (
    turnoResumo.tempo_aberto_minutos > 1440 || turnoResumo.turno_esquecido === true
  );

  const metrics = [
    {
      label: 'Saldo inicial',
      value: turnoResumo.saldo_inicial,
      help: 'Fundo de troco da abertura',
      accent: false,
    },
    {
      label: 'Vendas recebidas',
      value: turnoResumo.total_vendas,
      help: `${turnoResumo.total_pedidos_pagos} comanda(s) paga(s)`,
      accent: true,
    },
    {
      label: 'Entradas em dinheiro',
      value: turnoResumo.total_dinheiro,
      help: 'Valor físico recebido no turno',
      accent: false,
    },
    {
      label: 'Saldo esperado',
      value: turnoResumo.saldo_esperado_dinheiro,
      help: 'Dinheiro que deve estar no caixa',
      accent: true,
    },
  ];

  return (
    <div className="space-y-4 text-left animate-fade-in" aria-live="polite">
      {isTurnoEsquecido && (
        <div className="flex flex-col gap-3 rounded-[18px] border border-[#5a3434] bg-[#1b1212] p-4 text-[#e7b7b7] sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <Clock size={18} className="mt-0.5 shrink-0" />
            <div>
              <strong className="block text-xs text-[#f5dada]">Turno aberto há mais de 24 horas</strong>
              <span className="mt-1 block text-[11px] leading-relaxed text-[#cfa3a3]">
                Aberto há {formatMinutes(turnoResumo.tempo_aberto_minutos)}. Confira os valores antes de encerrar.
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={onNavigateToFechamento}
            className="shrink-0 rounded-xl border border-[#704040] bg-[#261717] px-4 py-2 text-[10px] font-bold uppercase tracking-[0.12em] text-[#f0c4c4] transition-colors hover:bg-[#321d1d]"
          >
            Conferir caixa
          </button>
        </div>
      )}

      <section className="flex flex-col gap-4 rounded-[18px] border border-[#252b28] bg-[#0d100f] p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${
            isTurnoAberto
              ? 'border-[#145c49] bg-[#0b2d25] text-[#54d9b3]'
              : 'border-[#303532] bg-[#161917] text-zinc-500'
          }`}>
            {isTurnoAberto ? <CheckCircle2 size={19} /> : <Lock size={19} />}
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-bold text-[#f5f4ef]">Turno atual</h2>
              <span className={`rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em] ${
                isTurnoAberto
                  ? 'border-[#145c49] bg-[#0b2d25] text-[#54d9b3]'
                  : 'border-[#303532] bg-[#161917] text-zinc-500'
              }`}>
                {isTurnoAberto ? 'Caixa aberto' : 'Caixa fechado'}
              </span>
              {isLoading && <span className="text-[9px] text-zinc-500">Atualizando…</span>}
            </div>
            <p className="mt-1 text-[11px] text-zinc-400">
              {isTurnoAberto
                ? `${turnoResumo.operador_nome || 'Operador'} · aberto há ${formatMinutes(turnoResumo.tempo_aberto_minutos)}`
                : 'Abra um turno para começar a registrar o movimento do dia.'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onRefresh}
            disabled={isLoading}
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-[#303532] bg-[#151816] text-zinc-400 transition-colors hover:border-[#196b55] hover:text-[#54d9b3] disabled:cursor-wait disabled:opacity-60"
            title="Atualizar resumo"
            aria-label="Atualizar resumo do caixa"
          >
            <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
          </button>
          {isTurnoAberto ? (
            <button
              type="button"
              onClick={onNavigateToFechamento}
              className="inline-flex items-center gap-2 rounded-xl border border-[#196b55] bg-[#0b2d25] px-4 py-2 text-[10px] font-bold uppercase tracking-[0.1em] text-[#60e4be] transition-colors hover:bg-[#103b30]"
            >
              <Lock size={13} /> Fechar caixa
            </button>
          ) : onOpenNovoTurnoModal ? (
            <button
              type="button"
              onClick={onOpenNovoTurnoModal}
              className="inline-flex items-center gap-2 rounded-xl bg-[#00b894] px-4 py-2 text-[10px] font-bold uppercase tracking-[0.1em] text-[#06110e] transition-colors hover:bg-[#12c9a3]"
            >
              <DollarSign size={13} /> Abrir caixa
            </button>
          ) : null}
        </div>
      </section>

      {!isTurnoAberto ? (
        <section className="rounded-[18px] border border-[#252b28] bg-[#0d100f] px-5 py-10 text-center">
          <Lock size={22} className="mx-auto text-zinc-600" />
          <h3 className="mt-3 text-sm font-bold text-[#f5f4ef]">Nenhum turno aberto</h3>
          <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-zinc-500">
            Informe o saldo inicial para controlar vendas, Pix, cartões e o dinheiro físico do caixa.
          </p>
        </section>
      ) : (
        <>
          <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {metrics.map(metric => (
              <article
                key={metric.label}
                className={`rounded-[18px] border p-4 ${
                  metric.label === 'Saldo esperado'
                    ? 'border-[#196b55] bg-[#0b211b]'
                    : 'border-[#252b28] bg-[#111412]'
                }`}
              >
                <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-zinc-500">
                  {metric.label}
                </span>
                <strong className={`mt-2 block text-xl font-bold tabular-nums ${metric.accent ? 'text-[#54d9b3]' : 'text-[#f5f4ef]'}`}>
                  {formatCurrency(metric.value)}
                </strong>
                <span className="mt-1 block text-[11px] text-zinc-500">{metric.help}</span>
              </article>
            ))}
          </section>

          <section className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            <article className="rounded-[18px] border border-[#252b28] bg-[#111412] p-4">
              <div className="flex items-center gap-2 border-b border-[#252b28] pb-3">
                <CreditCard size={15} className="text-[#54d9b3]" />
                <h3 className="text-[10px] font-bold uppercase tracking-[0.13em] text-zinc-300">Recebimentos do turno</h3>
              </div>
              <div className="mt-3 space-y-3 text-xs">
                {[
                  { label: 'Dinheiro', value: turnoResumo.total_dinheiro, icon: Banknote },
                  { label: 'Pix', value: turnoResumo.total_pix, icon: QrCode },
                  { label: 'Cartões', value: turnoResumo.total_cartao, icon: CreditCard },
                ].map(method => (
                  <div key={method.label} className="flex items-center justify-between gap-3">
                    <span className="flex items-center gap-2 text-zinc-400"><method.icon size={14} /> {method.label}</span>
                    <strong className="font-semibold tabular-nums text-[#f5f4ef]">{formatCurrency(method.value)}</strong>
                  </div>
                ))}
              </div>
            </article>

            <article className="rounded-[18px] border border-[#252b28] bg-[#111412] p-4">
              <div className="flex items-center gap-2 border-b border-[#252b28] pb-3">
                <Calculator size={15} className="text-[#54d9b3]" />
                <h3 className="text-[10px] font-bold uppercase tracking-[0.13em] text-zinc-300">Composição do dinheiro</h3>
              </div>
              <div className="mt-3 space-y-3 text-xs">
                <div className="flex items-center justify-between text-zinc-400">
                  <span className="flex items-center gap-2"><ArrowDownRight size={14} /> Suprimentos</span>
                  <strong className="tabular-nums text-[#f5f4ef]">+ {formatCurrency(turnoResumo.total_suprimentos)}</strong>
                </div>
                <div className="flex items-center justify-between text-zinc-400">
                  <span className="flex items-center gap-2"><ArrowUpRight size={14} /> Sangrias</span>
                  <strong className="tabular-nums text-[#f5f4ef]">− {formatCurrency(turnoResumo.total_sangrias)}</strong>
                </div>
                <p className="border-t border-[#252b28] pt-3 text-[10px] leading-relaxed text-zinc-500">
                  Saldo inicial + dinheiro + suprimentos − sangrias.
                </p>
              </div>
            </article>

            <article className="rounded-[18px] border border-[#252b28] bg-[#111412] p-4">
              <div className="flex items-center gap-2 border-b border-[#252b28] pb-3">
                <User size={15} className="text-[#54d9b3]" />
                <h3 className="text-[10px] font-bold uppercase tracking-[0.13em] text-zinc-300">Responsável e atividade</h3>
              </div>
              <div className="mt-3 space-y-2 text-xs text-zinc-400">
                <p>Operador: <strong className="text-[#f5f4ef]">{turnoResumo.operador_nome || '—'}</strong></p>
                <p>
                  Abertura: <strong className="text-[#f5f4ef]">
                    {turnoResumo.aberto_em
                      ? new Date(turnoResumo.aberto_em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
                      : '—'}
                  </strong>
                </p>
                {turnoResumo.ultima_movimentacao && (
                  <p className="border-t border-[#252b28] pt-2 text-[10px] leading-relaxed text-zinc-500">
                    Última movimentação: {turnoResumo.ultima_movimentacao.tipo} · {formatCurrency(turnoResumo.ultima_movimentacao.valor)}
                  </p>
                )}
              </div>
            </article>
          </section>
        </>
      )}
    </div>
  );
};
