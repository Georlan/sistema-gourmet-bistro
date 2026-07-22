import React, { useState } from 'react';
import { X, AlertTriangle } from 'lucide-react';
import { Insumo } from '../../types';

interface MovimentacaoEstoqueModalProps {
  insumos: Insumo[];
  onClose: () => void;
  onSubmit: (payload: { insumo_id: string; tipo: string; quantidade: number; motivo: string; observacao: string }) => Promise<void>;
}

export const MovimentacaoEstoqueModal: React.FC<MovimentacaoEstoqueModalProps> = ({
  insumos,
  onClose,
  onSubmit
}) => {
  const [insumoId, setInsumoId] = useState<string>('');
  const [tipo, setTipo] = useState<string>('perda');
  const [quantidade, setQuantidade] = useState<number>(1);
  const [motivo, setMotivo] = useState<string>('');
  const [observacao, setObservacao] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const selectedInsumo = insumos.find(i => i.id === insumoId);
  const saldoAtual = selectedInsumo?.estoque_atual ?? 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (!insumoId) {
      setErrorMsg('Selecione um insumo.');
      return;
    }
    if (quantidade <= 0) {
      setErrorMsg('A quantidade deve ser maior que zero.');
      return;
    }
    if (!motivo.trim()) {
      setErrorMsg('O motivo é obrigatório para registrar a movimentação.');
      return;
    }

    if (['perda', 'ajuste_negativo'].includes(tipo) && (saldoAtual - quantidade < 0)) {
      setErrorMsg(`Saldo insuficiente! O insumo possui apenas ${saldoAtual} ${selectedInsumo?.unidade_medida || 'un'} em estoque.`);
      return;
    }

    try {
      setIsSubmitting(true);
      await onSubmit({
        insumo_id: insumoId,
        tipo,
        quantidade: Number(quantidade),
        motivo: motivo.trim(),
        observacao: observacao.trim()
      });
      onClose();
    } catch (err: any) {
      setErrorMsg(err.message || 'Erro ao registrar movimentação.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      className="fixed inset-0 bg-black/85 backdrop-blur-xs z-50 flex items-center justify-center p-4 overflow-y-auto cursor-pointer"
    >
      <div className="w-full max-w-md bg-[#121214] border border-[#27272A] rounded-3xl p-6 space-y-4 text-left shadow-2xl relative animate-scale-in my-8">
        {/* Header */}
        <div className="flex justify-between items-center pb-2 border-b border-[#27272A]">
          <div>
            <h3 className="font-serif text-sm font-bold text-white">Nova Movimentação de Estoque</h3>
            <p className="text-[9px] text-gray-400">Registre perdas ou ajustes com motivo auditável.</p>
          </div>
          <button type="button" onClick={onClose} className="p-1 text-gray-400 hover:text-white transition-colors cursor-pointer">
            <X size={16} />
          </button>
        </div>

        {errorMsg && (
          <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-xs flex items-center gap-2">
            <AlertTriangle size={16} className="shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Insumo Select */}
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Insumo:</label>
            <select
              value={insumoId}
              onChange={(e) => setInsumoId(e.target.value)}
              required
              className="w-full px-3 py-2 bg-[#1C1C1F] border border-[#27272A] rounded-xl text-white text-xs focus:outline-none focus:border-emerald-500"
            >
              <option value="">-- Selecione o Insumo --</option>
              {insumos.map(i => (
                <option key={i.id} value={i.id}>
                  {i.nome} (Atual: {i.estoque_atual} {i.unidade_medida})
                </option>
              ))}
            </select>
          </div>

          {/* Tipo & Quantidade */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Tipo:</label>
              <select
                value={tipo}
                onChange={(e) => setTipo(e.target.value)}
                className="w-full px-3 py-2 bg-[#1C1C1F] border border-[#27272A] rounded-xl text-white text-xs focus:outline-none focus:border-emerald-500"
              >
                <option value="perda">Perda / Descarte</option>
                <option value="ajuste_positivo">Ajuste Positivo (+)</option>
                <option value="ajuste_negativo">Ajuste Negativo (-)</option>
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">
                Quantidade ({selectedInsumo?.unidade_medida || 'un'}):
              </label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                required
                value={quantidade}
                onChange={(e) => setQuantidade(parseFloat(e.target.value) || 0)}
                className="w-full px-3 py-2 bg-[#1C1C1F] border border-[#27272A] rounded-xl text-white text-xs font-mono focus:outline-none focus:border-emerald-500"
              />
            </div>
          </div>

          {/* Motivo Obrigatório */}
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">
              Motivo <span className="text-red-400">*</span>:
            </label>
            <input
              type="text"
              required
              placeholder="ex: Validade vencida, produto danificado no manuseio..."
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              className="w-full px-3 py-2 bg-[#1C1C1F] border border-[#27272A] rounded-xl text-white text-xs focus:outline-none focus:border-emerald-500"
            />
          </div>

          {/* Observação Opcional */}
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Observação (Opcional):</label>
            <textarea
              rows={2}
              placeholder="Detalhes adicionais..."
              value={observacao}
              onChange={(e) => setObservacao(e.target.value)}
              className="w-full px-3 py-2 bg-[#1C1C1F] border border-[#27272A] rounded-xl text-white text-xs focus:outline-none focus:border-emerald-500 resize-none"
            />
          </div>

          {/* Actions */}
          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2 border border-zinc-800 hover:border-zinc-700 bg-zinc-900 text-gray-400 hover:text-white rounded-xl text-[10px] font-bold uppercase tracking-wider transition-colors cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex-1 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-xl text-[10px] font-bold uppercase tracking-wider transition-colors cursor-pointer shadow-sm"
            >
              {isSubmitting ? 'Salvando...' : 'Salvar Movimentação'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
