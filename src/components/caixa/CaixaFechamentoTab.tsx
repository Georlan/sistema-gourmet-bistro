import React, { useState } from 'react';
import clsx from 'clsx';
import { Lock, CheckCircle2, AlertCircle, DollarSign, CreditCard, Smartphone, Check } from 'lucide-react';
import { FechamentoCaixaResult } from '../../types';

interface CaixaFechamentoTabProps {
  isTurnoAberto: boolean;
  fechamentoResult: FechamentoCaixaResult | null;
  onConfirmFechamento: (payload: { declarado_dinheiro: number; declarado_cartao: number; declarado_pix: number; observacao: string }) => Promise<void>;
  onOpenNovoTurnoModal?: () => void;
}

export const CaixaFechamentoTab: React.FC<CaixaFechamentoTabProps> = ({
  isTurnoAberto,
  fechamentoResult,
  onConfirmFechamento,
  onOpenNovoTurnoModal
}) => {
  const [declaradoDinheiro, setDeclaradoDinheiro] = useState<number | ''>('');
  const [declaradoCartao, setDeclaradoCartao] = useState<number | ''>('');
  const [declaradoPix, setDeclaradoPix] = useState<number | ''>('');
  const [observacao, setObservacao] = useState<string>('');

  const [showConfirmModal, setShowConfirmModal] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handlePreSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    if (declaradoDinheiro === '' || Number(declaradoDinheiro) < 0) {
      setErrorMsg('Informe o valor físico contado em dinheiro.');
      return;
    }
    setShowConfirmModal(true);
  };

  const handleExecuteFechamento = async () => {
    try {
      setIsSubmitting(true);
      setErrorMsg(null);
      await onConfirmFechamento({
        declarado_dinheiro: Number(declaradoDinheiro || 0),
        declarado_cartao: Number(declaradoCartao || 0),
        declarado_pix: Number(declaradoPix || 0),
        observacao: observacao.trim()
      });
      setShowConfirmModal(false);
    } catch (err: any) {
      setErrorMsg(err.message || 'Erro ao processar fechamento de caixa.');
      setShowConfirmModal(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isTurnoAberto && fechamentoResult) {
    // Post-Closure Audit Summary Screen
    const diffTot = fechamentoResult.diferenca_total;
    const isExact = Math.abs(diffTot) < 0.01;
    const isSobra = diffTot > 0;

    return (
      <div className="space-y-5 text-left animate-fade-in max-w-3xl mx-auto">
        <div className="bg-[#121214]/80 border border-[#27272A] rounded-3xl p-6 space-y-5">
          <div className="flex items-center justify-between border-b border-[#27272A] pb-3">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-2xl">
                <CheckCircle2 size={24} />
              </div>
              <div>
                <h3 className="font-serif text-base font-bold text-white">Fechamento do Caixa Concluído</h3>
                <p className="text-[10px] text-gray-400 font-mono">
                  Turno #{fechamentoResult.turno_id} encarrefechado por {fechamentoResult.fechado_por_nome} às {new Date(fechamentoResult.fechado_em).toLocaleTimeString('pt-BR')}
                </p>
              </div>
            </div>
            <span className="px-3 py-1 bg-zinc-800 text-gray-300 rounded-full text-[9px] font-bold uppercase tracking-wider">
              Turno Encerrado
            </span>
          </div>

          {/* Result Alert Badge */}
          <div className={clsx(
            'p-4 rounded-2xl border text-xs flex items-center justify-between font-mono',
            isExact ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' : isSobra ? 'bg-sky-500/10 border-sky-500/30 text-sky-300' : 'bg-red-500/10 border-red-500/30 text-red-300'
          )}>
            <div>
              <strong className="block text-sm uppercase tracking-wider font-sans font-bold">
                {isExact ? '✓ Caixa Exato (Sem Divergência)' : isSobra ? '▲ Sobra de Caixa' : '▼ Falta / Quebra de Caixa'}
              </strong>
              <span className="text-[10px] text-gray-300">
                {isExact ? 'Valores contados equivalem exatamente ao esperado no sistema.' : isSobra ? `Declarado superior ao esperado por R$ ${diffTot.toFixed(2)}` : `Declarado inferior ao esperado por R$ ${Math.abs(diffTot).toFixed(2)}`}
              </span>
            </div>
            <span className="text-xl font-bold font-mono">
              {isExact ? 'R$ 0,00' : `${isSobra ? '+' : '-'} R$ ${Math.abs(diffTot).toFixed(2)}`}
            </span>
          </div>

          {/* Audit Comparison Table */}
          <div className="overflow-x-auto border border-[#27272A]/60 rounded-2xl">
            <table className="w-full text-left text-xs font-mono">
              <thead>
                <tr className="bg-[#1C1C1F] border-b border-[#27272A] text-gray-400 uppercase text-[9px] tracking-wider">
                  <th className="p-3">Meio de Pagamento</th>
                  <th className="p-3">Esperado (Sistema)</th>
                  <th className="p-3">Declarado (Contado)</th>
                  <th className="p-3 text-right">Diferença (Sobra/Falta)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#27272A]/40 text-gray-200">
                <tr>
                  <td className="p-3 font-sans font-semibold">💵 Dinheiro</td>
                  <td className="p-3">R$ {fechamentoResult.esperado_dinheiro.toFixed(2)}</td>
                  <td className="p-3 font-bold text-white">R$ {fechamentoResult.declarado_dinheiro.toFixed(2)}</td>
                  <td className={clsx('p-3 text-right font-bold', fechamentoResult.diferenca_dinheiro >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                    {fechamentoResult.diferenca_dinheiro >= 0 ? '+' : ''} R$ {fechamentoResult.diferenca_dinheiro.toFixed(2)}
                  </td>
                </tr>
                <tr>
                  <td className="p-3 font-sans font-semibold">💳 Cartão</td>
                  <td className="p-3">R$ {fechamentoResult.esperado_cartao.toFixed(2)}</td>
                  <td className="p-3 font-bold text-white">R$ {fechamentoResult.declarado_cartao.toFixed(2)}</td>
                  <td className={clsx('p-3 text-right font-bold', fechamentoResult.diferenca_cartao >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                    {fechamentoResult.diferenca_cartao >= 0 ? '+' : ''} R$ {fechamentoResult.diferenca_cartao.toFixed(2)}
                  </td>
                </tr>
                <tr>
                  <td className="p-3 font-sans font-semibold">📱 Pix</td>
                  <td className="p-3">R$ {fechamentoResult.esperado_pix.toFixed(2)}</td>
                  <td className="p-3 font-bold text-white">R$ {fechamentoResult.declarado_pix.toFixed(2)}</td>
                  <td className={clsx('p-3 text-right font-bold', fechamentoResult.diferenca_pix >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                    {fechamentoResult.diferenca_pix >= 0 ? '+' : ''} R$ {fechamentoResult.diferenca_pix.toFixed(2)}
                  </td>
                </tr>
                <tr className="bg-[#1C1C1F]/60 font-bold border-t border-[#27272A]">
                  <td className="p-3 font-sans uppercase text-[10px] text-gray-300">TOTAL GERAL</td>
                  <td className="p-3 text-gray-300">R$ {fechamentoResult.total_esperado.toFixed(2)}</td>
                  <td className="p-3 text-white">R$ {fechamentoResult.total_declarado.toFixed(2)}</td>
                  <td className={clsx('p-3 text-right font-bold text-sm', isExact ? 'text-emerald-400' : isSobra ? 'text-sky-400' : 'text-red-400')}>
                    {diffTot >= 0 ? '+' : ''} R$ {diffTot.toFixed(2)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {onOpenNovoTurnoModal && (
            <div className="pt-2 text-center">
              <button
                type="button"
                onClick={onOpenNovoTurnoModal}
                className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold uppercase tracking-wider transition-all cursor-pointer shadow-md inline-flex items-center gap-2"
              >
                <DollarSign size={16} />
                <span>Abrir Novo Turno de Caixa</span>
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (!isTurnoAberto) {
    return (
      <div className="bg-[#121214]/60 border border-[#27272A] rounded-3xl p-8 text-center space-y-3 max-w-xl mx-auto">
        <div className="w-12 h-12 rounded-2xl bg-zinc-800/80 border border-[#27272A] flex items-center justify-center mx-auto text-gray-400">
          <Lock size={24} />
        </div>
        <h4 className="font-serif text-sm font-bold text-white">Nenhum turno aberto para fechamento</h4>
        <p className="text-xs text-gray-400">
          O caixa está fechado. Abra um novo turno para operar o caixa e realizar fechamentos ao fim do expediente.
        </p>
        {onOpenNovoTurnoModal && (
          <button
            type="button"
            onClick={onOpenNovoTurnoModal}
            className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold uppercase tracking-wider transition-all cursor-pointer shadow-sm inline-flex items-center gap-1.5"
          >
            <DollarSign size={14} />
            <span>Abrir Caixa</span>
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-5 text-left animate-fade-in max-w-2xl mx-auto">
      {/* Blind Audit Form Header */}
      <div className="bg-[#121214]/80 border border-[#27272A] rounded-3xl p-6 space-y-4">
        <div className="border-b border-[#27272A] pb-3">
          <div className="flex items-center gap-2">
            <h3 className="font-serif text-sm font-bold text-white">Fechamento de Caixa (Conferência Cega)</h3>
            <span className="px-2.5 py-0.5 bg-amber-500/10 text-amber-400 border border-amber-500/20 rounded-full text-[8px] font-bold uppercase">
              Blind Audit
            </span>
          </div>
          <p className="text-[10px] text-gray-400 mt-0.5">
            Insira os valores contados fisicamente no caixa. O saldo do sistema será comparado apenas após a confirmação.
          </p>
        </div>

        {errorMsg && (
          <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-xs flex items-center gap-2">
            <AlertCircle size={16} className="shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        <form onSubmit={handlePreSubmit} className="space-y-4">
          {/* Dinheiro físico contado */}
          <div className="space-y-1 bg-[#1C1C1F]/40 p-3.5 rounded-2xl border border-[#27272A]">
            <label className="text-[10px] font-bold text-gray-300 uppercase tracking-wider flex items-center gap-1.5">
              <DollarSign size={14} className="text-emerald-400" />
              <span>Dinheiro Físico Contado (R$) <span className="text-red-400">*</span></span>
            </label>
            <input
              type="number"
              step="0.01"
              min="0"
              required
              placeholder="0,00"
              value={declaradoDinheiro}
              onChange={(e) => setDeclaradoDinheiro(e.target.value === '' ? '' : parseFloat(e.target.value))}
              className="w-full px-3.5 py-2 bg-[#121214] border border-[#27272A] rounded-xl text-white text-base font-mono focus:outline-none focus:border-emerald-500"
            />
            <span className="text-[8px] text-gray-500 block">Conte todas as notas e moedas presentes na gaveta.</span>
          </div>

          {/* Comprovantes de cartão */}
          <div className="space-y-1 bg-[#1C1C1F]/40 p-3.5 rounded-2xl border border-[#27272A]">
            <label className="text-[10px] font-bold text-gray-300 uppercase tracking-wider flex items-center gap-1.5">
              <CreditCard size={14} className="text-purple-400" />
              <span>Comprovantes de Cartão / Maquininha (R$)</span>
            </label>
            <input
              type="number"
              step="0.01"
              min="0"
              placeholder="0,00"
              value={declaradoCartao}
              onChange={(e) => setDeclaradoCartao(e.target.value === '' ? '' : parseFloat(e.target.value))}
              className="w-full px-3.5 py-2 bg-[#121214] border border-[#27272A] rounded-xl text-white text-base font-mono focus:outline-none focus:border-emerald-500"
            />
            <span className="text-[8px] text-gray-500 block">Soma dos comprovantes das máquinas de débito e crédito.</span>
          </div>

          {/* Pix total */}
          <div className="space-y-1 bg-[#1C1C1F]/40 p-3.5 rounded-2xl border border-[#27272A]">
            <label className="text-[10px] font-bold text-gray-300 uppercase tracking-wider flex items-center gap-1.5">
              <Smartphone size={14} className="text-sky-400" />
              <span>Comprovantes Pix (R$)</span>
            </label>
            <input
              type="number"
              step="0.01"
              min="0"
              placeholder="0,00"
              value={declaradoPix}
              onChange={(e) => setDeclaradoPix(e.target.value === '' ? '' : parseFloat(e.target.value))}
              className="w-full px-3.5 py-2 bg-[#121214] border border-[#27272A] rounded-xl text-white text-base font-mono focus:outline-none focus:border-emerald-500"
            />
          </div>

          {/* Observação */}
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Observações do Fechamento (Opcional):</label>
            <textarea
              rows={2}
              placeholder="ex: Diferença explicada por troco trocado com cliente..."
              value={observacao}
              onChange={(e) => setObservacao(e.target.value)}
              className="w-full px-3 py-2 bg-[#1C1C1F] border border-[#27272A] rounded-xl text-white text-xs focus:outline-none focus:border-emerald-500 resize-none"
            />
          </div>

          <button
            type="submit"
            className="w-full py-3 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white rounded-xl text-xs font-bold uppercase tracking-wider transition-all cursor-pointer shadow-lg shadow-emerald-950/40 flex items-center justify-center gap-2"
          >
            <Lock size={16} />
            <span>Prosseguir para Confirmação do Fechamento</span>
          </button>
        </form>
      </div>

      {/* Confirmation Modal */}
      {showConfirmModal && (
        <div
          onClick={(e) => { if (e.target === e.currentTarget) setShowConfirmModal(false); }}
          className="fixed inset-0 bg-black/85 backdrop-blur-xs z-50 flex items-center justify-center p-4 overflow-y-auto cursor-pointer"
        >
          <div className="w-full max-w-md bg-[#121214] border border-[#27272A] rounded-3xl p-6 space-y-4 text-left shadow-2xl relative animate-scale-in my-8">
            <div className="flex items-center gap-3 border-b border-[#27272A] pb-3">
              <div className="p-2 bg-amber-500/10 text-amber-400 border border-amber-500/20 rounded-xl">
                <AlertCircle size={20} />
              </div>
              <div>
                <h4 className="font-serif text-sm font-bold text-white">Confirmar Fechamento do Caixa?</h4>
                <p className="text-[9px] text-gray-400">Esta ação irá encerrar o turno de caixa ativo definitivamente.</p>
              </div>
            </div>

            <div className="bg-[#1C1C1F]/60 p-3 rounded-2xl border border-[#27272A] text-xs font-mono space-y-1">
              <div className="flex justify-between text-gray-300">
                <span>Dinheiro Declarado:</span>
                <strong className="text-white">R$ {Number(declaradoDinheiro || 0).toFixed(2)}</strong>
              </div>
              <div className="flex justify-between text-gray-300">
                <span>Cartão Declarado:</span>
                <strong className="text-white">R$ {Number(declaradoCartao || 0).toFixed(2)}</strong>
              </div>
              <div className="flex justify-between text-gray-300">
                <span>Pix Declarado:</span>
                <strong className="text-white">R$ {Number(declaradoPix || 0).toFixed(2)}</strong>
              </div>
            </div>

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowConfirmModal(false)}
                className="flex-1 py-2.5 border border-zinc-800 hover:border-zinc-700 bg-zinc-900 text-gray-400 hover:text-white rounded-xl text-[10px] font-bold uppercase tracking-wider transition-colors cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={isSubmitting}
                onClick={handleExecuteFechamento}
                className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-xl text-[10px] font-bold uppercase tracking-wider transition-colors cursor-pointer shadow-sm flex items-center justify-center gap-1.5"
              >
                <Check size={14} />
                <span>{isSubmitting ? 'Encerrando...' : 'Confirmar Fechamento'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
