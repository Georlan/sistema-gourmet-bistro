import React, { useState } from 'react';
import { X, AlertTriangle } from 'lucide-react';

interface SuprimentoModalProps {
  onClose: () => void;
  onSubmit: (payload: { valor: number; motivo: string; observacao: string }) => Promise<void>;
}

export const SuprimentoModal: React.FC<SuprimentoModalProps> = ({
  onClose,
  onSubmit
}) => {
  const [valor, setValor] = useState<number>(0);
  const [motivo, setMotivo] = useState<string>('');
  const [observacao, setObservacao] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (valor <= 0) {
      setErrorMsg('O valor do suprimento deve ser maior que zero.');
      return;
    }

    try {
      setIsSubmitting(true);
      await onSubmit({
        valor: Number(valor),
        motivo: motivo.trim(),
        observacao: observacao.trim()
      });
      onClose();
    } catch (err: any) {
      setErrorMsg(err.message || 'Erro ao registrar suprimento.');
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
            <h3 className="font-serif text-sm font-bold text-white">Novo Suprimento de Caixa</h3>
            <p className="text-[9px] text-gray-400">Aporte de fundo de troco extra no caixa aberto.</p>
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
          {/* Valor */}
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">
              Valor do Suprimento (R$) <span className="text-red-400">*</span>:
            </label>
            <input
              type="number"
              step="0.01"
              min="0.01"
              required
              placeholder="0,00"
              value={valor || ''}
              onChange={(e) => setValor(parseFloat(e.target.value) || 0)}
              className="w-full px-3 py-2 bg-[#1C1C1F] border border-[#27272A] rounded-xl text-white text-sm font-mono focus:outline-none focus:border-emerald-500"
            />
          </div>

          {/* Motivo Opcional */}
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Motivo (Opcional):</label>
            <input
              type="text"
              placeholder="ex: Troco inicial extra para início de pico..."
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
              {isSubmitting ? 'Gravando...' : 'Confirmar Suprimento'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
