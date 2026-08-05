import React from 'react';
import { DollarSign, Lock, Clock, ArrowDownRight, ArrowUpRight, CheckCircle2, User, RefreshCw } from 'lucide-react';
import { CaixaTurnoResumo } from '../../types';

interface CaixaTurnoAtualTabProps {
  turnoResumo: CaixaTurnoResumo | null;
  isLoading: boolean;
  onRefresh: () => void;
  onNavigateToFechamento: () => void;
  onOpenNovoTurnoModal?: () => void;
}

export const CaixaTurnoAtualTab: React.FC<CaixaTurnoAtualTabProps> = ({
  turnoResumo,
  isLoading,
  onRefresh,
  onNavigateToFechamento,
  onOpenNovoTurnoModal
}) => {
  const isTurnoAberto = turnoResumo?.status === 'aberto';
  const isTurnoEsquecido = isTurnoAberto && ((turnoResumo?.tempo_aberto_minutos || 0) > 1440 || Boolean((turnoResumo as any)?.turno_esquecido));

  const formatMinutos = (mins: number) => {
    if (!mins || mins <= 0) return '0 min';
    const horas = Math.floor(mins / 60);
    const m = mins % 60;
    if (horas === 0) return `${m} min`;
    return `${horas}h ${m}m`;
  };

  return (
    <div className="space-y-5 text-left animate-fade-in">
      {/* Alert Banner if Turno Esquecido */}
      {isTurnoEsquecido && (
        <div className="p-3.5 bg-amber-950/40 border border-amber-900/50 rounded-2xl flex items-center justify-between gap-3 text-amber-300/90 text-xs font-medium shadow-md">
          <div className="flex items-center gap-2.5">
            <Clock size={18} className="shrink-0 text-amber-400/80 animate-pulse" />
            <span>
              <strong>Aviso de Operação:</strong> Este turno de caixa foi aberto há <strong>{formatMinutos(turnoResumo?.tempo_aberto_minutos || 0)}</strong> (mais de 24h) e pode ter sido esquecido aberto. Recomendamos realizar a conferência e o fechamento.
            </span>
          </div>
          <button
            type="button"
            onClick={onNavigateToFechamento}
            className="px-3 py-1.5 bg-amber-950/70 hover:bg-amber-900/80 text-amber-300 font-bold rounded-xl text-[10px] uppercase tracking-wider transition-all shrink-0 cursor-pointer border border-amber-800/50 shadow"
          >
            Conferir e Fechar
          </button>
        </div>
      )}

      {/* Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-[#0E1015] border border-[#1C1F28] p-4 rounded-3xl">
        <div className="flex items-center gap-3">
          <div className={`p-2.5 rounded-2xl ${isTurnoEsquecido ? 'bg-amber-950/60 text-amber-400/90 border border-amber-900/40' : isTurnoAberto ? 'bg-emerald-950/60 text-emerald-400/90 border border-emerald-900/40' : 'bg-zinc-900 text-gray-400 border border-zinc-800'}`}>
            {isTurnoAberto ? <CheckCircle2 size={20} /> : <Lock size={20} />}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-serif text-sm font-bold text-white">Status do Turno</h3>
              <span className={`px-2.5 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider ${
                isTurnoEsquecido
                  ? 'bg-amber-950/60 text-amber-300/90 border border-amber-900/40'
                  : isTurnoAberto
                  ? 'bg-emerald-950/60 text-emerald-300/90 border border-emerald-900/40'
                  : 'bg-rose-950/60 text-rose-300/90 border border-rose-900/40'
              }`}>
                {isTurnoEsquecido ? '⚠ Turno Esquecido (+24h)' : isTurnoAberto ? '● Caixa Aberto' : '● Caixa Fechado'}
              </span>
            </div>
            <p className="text-[10px] text-gray-400">
              {isTurnoAberto
                ? `Aberto por ${turnoResumo?.operador_nome || 'Operador'} há ${formatMinutos(turnoResumo?.tempo_aberto_minutos || 0)}`
                : 'Nenhum turno de caixa aberto no momento.'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onRefresh}
            className="p-2 border border-[#1C1F28] bg-[#0D0F14] hover:bg-[#181A22] text-gray-400 hover:text-white rounded-xl transition-all cursor-pointer"
            title="Atualizar Resumo"
          >
            <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
          </button>

          {isTurnoAberto ? (
            <button
              type="button"
              onClick={onNavigateToFechamento}
              className="px-4 py-2 bg-[#046c4e] hover:bg-[#035238] text-emerald-100 rounded-xl text-[10px] font-bold uppercase tracking-wider transition-all cursor-pointer flex items-center gap-1.5 shadow-md shadow-emerald-950/40 border border-emerald-700/30"
            >
              <Lock size={14} />
              <span>Fechar Caixa</span>
            </button>
          ) : (
            onOpenNovoTurnoModal && (
              <button
                type="button"
                onClick={onOpenNovoTurnoModal}
                className="px-4 py-2 bg-[#046c4e] hover:bg-[#035238] text-emerald-100 rounded-xl text-[10px] font-bold uppercase tracking-wider transition-all cursor-pointer flex items-center gap-1.5 shadow-md shadow-emerald-950/40 border border-emerald-700/30"
              >
                <DollarSign size={14} />
                <span>Abrir Novo Turno</span>
              </button>
            )
          )}
        </div>
      </div>

      {!isTurnoAberto ? (
        <div className="bg-[#0E1015] border border-[#1C1F28] rounded-3xl p-8 text-center space-y-3">
          <div className="w-12 h-12 rounded-2xl bg-[#0D0F14] border border-[#1C1F28] flex items-center justify-center mx-auto text-gray-400">
            <Lock size={24} />
          </div>
          <h4 className="font-serif text-sm font-bold text-white">Nenhum turno de caixa aberto</h4>
          <p className="text-xs text-gray-400 max-w-sm mx-auto">
            Para registrar vendas em dinheiro ou movimentações no PDV, abra um novo turno informando o saldo inicial.
          </p>
          {onOpenNovoTurnoModal && (
            <button
              type="button"
              onClick={onOpenNovoTurnoModal}
              className="px-5 py-2.5 bg-[#046c4e] hover:bg-[#035238] text-emerald-100 rounded-xl text-xs font-bold uppercase tracking-wider transition-all cursor-pointer shadow-md border border-emerald-700/30 inline-flex items-center gap-2"
            >
              <DollarSign size={16} />
              <span>Abrir Caixa Agora</span>
            </button>
          )}
        </div>
      ) : (
        <>
          {/* Main Operational Metrics Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-4 gap-3">
            <div className="bg-[#151720] border border-[#252836] p-4 rounded-2xl space-y-1 shadow-md shadow-black/40">
              <span className="text-[9px] font-bold uppercase tracking-wider text-gray-400 block">Saldo Inicial</span>
              <strong className="text-base font-mono font-bold text-white block">
                R$ {(turnoResumo?.saldo_inicial || 0).toFixed(2)}
              </strong>
              <span className="text-[8px] text-gray-500 block">Fundo de troco de abertura</span>
            </div>

            <div className="bg-[#151720] border border-[#252836] p-4 rounded-2xl space-y-1 shadow-md shadow-black/40">
              <span className="text-[9px] font-bold uppercase tracking-wider text-gray-400 block">Total de Vendas</span>
              <strong className="text-base font-mono font-bold text-[#059669] block">
                R$ {(turnoResumo?.total_vendas || 0).toFixed(2)}
              </strong>
              <span className="text-[8px] text-emerald-500/70 block">{turnoResumo?.total_pedidos_pagos || 0} comanda(s) paga(s)</span>
            </div>

            <div className="bg-[#151720] border border-amber-900/30 p-4 rounded-2xl space-y-1 shadow-md shadow-black/40">
              <span className="text-[9px] font-bold uppercase tracking-wider text-amber-400/80 block">Vendas em Dinheiro</span>
              <strong className="text-base font-mono font-bold text-amber-400/90 block">
                R$ {(turnoResumo?.total_dinheiro || 0).toFixed(2)}
              </strong>
              <span className="text-[8px] text-amber-500/70 block">Entradas físicas em caixa</span>
            </div>

            <div className="bg-[#151720] border border-emerald-900/40 p-4 rounded-2xl space-y-1 relative overflow-hidden shadow-md shadow-black/40">
              <div className="absolute -right-2 -bottom-2 opacity-10 text-emerald-400">
                <DollarSign size={60} />
              </div>
              <span className="text-[9px] font-bold uppercase tracking-wider text-emerald-400/80 block">Saldo Esperado em Caixa</span>
              <strong className="text-lg font-mono font-bold text-[#059669] block">
                R$ {(turnoResumo?.saldo_esperado_dinheiro || 0).toFixed(2)}
              </strong>
              <span className="text-[8px] text-emerald-500/70 block font-mono">Inicial + Dinheiro + Supr. - Sangrias</span>
            </div>
          </div>

          {/* Secondary Details Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {/* Payment Methods Breakdown */}
            <div className="bg-[#151720] border border-[#252836] p-4 rounded-2xl space-y-3 text-left shadow-md shadow-black/40">
              <h4 className="text-[10px] font-bold uppercase tracking-wider text-gray-400 border-b border-[#252836] pb-1.5">
                Meios de Pagamento (Turno)
              </h4>
              <div className="space-y-2 text-xs font-mono">
                <div className="flex justify-between items-center text-gray-300">
                  <span>💵 Dinheiro:</span>
                  <strong className="text-white">R$ {(turnoResumo?.total_dinheiro || 0).toFixed(2)}</strong>
                </div>
                <div className="flex justify-between items-center text-gray-300">
                  <span>📱 Pix:</span>
                  <strong className="text-sky-400/90">R$ {(turnoResumo?.total_pix || 0).toFixed(2)}</strong>
                </div>
                <div className="flex justify-between items-center text-gray-300">
                  <span>💳 Cartão:</span>
                  <strong className="text-amber-400/90">R$ {(turnoResumo?.total_cartao || 0).toFixed(2)}</strong>
                </div>
              </div>
            </div>

            {/* Suprimentos & Sangrias Breakdown */}
            <div className="bg-[#151720] border border-[#252836] p-4 rounded-2xl space-y-3 text-left shadow-md shadow-black/40">
              <h4 className="text-[10px] font-bold uppercase tracking-wider text-gray-400 border-b border-[#252836] pb-1.5">
                Movimentações de Troco
              </h4>
              <div className="space-y-2 text-xs font-mono">
                <div className="flex justify-between items-center text-[#059669]">
                  <span className="flex items-center gap-1"><ArrowDownRight size={14} /> Suprimentos:</span>
                  <strong>+ R$ {(turnoResumo?.total_suprimentos || 0).toFixed(2)}</strong>
                </div>
                <div className="flex justify-between items-center text-rose-400/90">
                  <span className="flex items-center gap-1"><ArrowUpRight size={14} /> Sangrias:</span>
                  <strong>- R$ {(turnoResumo?.total_sangrias || 0).toFixed(2)}</strong>
                </div>
              </div>
            </div>

            {/* Operational Metadata */}
            <div className="bg-[#151720] border border-[#252836] p-4 rounded-2xl space-y-3 text-left shadow-md shadow-black/40">
              <h4 className="text-[10px] font-bold uppercase tracking-wider text-gray-400 border-b border-[#252836] pb-1.5">
                Operador & Tempo
              </h4>
              <div className="space-y-1.5 text-xs text-gray-300">
                <div className="flex items-center gap-1.5">
                  <User size={14} className="text-gray-400" />
                  <span>Responsável: <strong className="text-white">{turnoResumo?.operador_nome || '—'}</strong></span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Clock size={14} className="text-gray-400" />
                  <span>Aberto em: <strong className="text-white font-mono">{turnoResumo?.aberto_em ? new Date(turnoResumo.aberto_em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—'}</strong></span>
                </div>
                {turnoResumo?.ultima_movimentacao && (
                  <div className="pt-1.5 text-[9px] text-gray-400 border-t border-[#252836]">
                    Última mov: <strong className="text-gray-200">{turnoResumo.ultima_movimentacao.tipo.toUpperCase()}</strong> R$ {Number(turnoResumo.ultima_movimentacao.valor).toFixed(2)} ({turnoResumo.ultima_movimentacao.descricao})
                  </div>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
