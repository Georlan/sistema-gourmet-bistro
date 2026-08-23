import React, { useState } from 'react';
import { X, AlertTriangle, ShieldCheck } from 'lucide-react';
import { ManagerPinModal } from '../ManagerPinModal';
import { MoneyInput } from '../MoneyInput';

interface SangriaModalProps {
  saldoDisponivelDinheiro: number;
  onClose: () => void;
  onSubmit: (payload: { valor: number; motivo: string; observacao: string }) => Promise<void>;
}

export const SangriaModal: React.FC<SangriaModalProps> = ({
  saldoDisponivelDinheiro,
  onClose,
  onSubmit
}) => {
  const [valor, setValor] = useState<number | ''>('');
  const [motivo, setMotivo] = useState<string>('');
  const [observacao, setObservacao] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showPinModal, setShowPinModal] = useState<boolean>(false);

  const handlePreSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    const valorNumerico = Number(valor || 0);
    if (valorNumerico <= 0) {
      setErrorMsg('O valor retirado deve ser maior que zero.');
      return;
    }

    if (valorNumerico > saldoDisponivelDinheiro) {
      setErrorMsg(`Não há dinheiro suficiente no caixa. Disponível: R$ ${saldoDisponivelDinheiro.toFixed(2)}.`);
      return;
    }

    if (!motivo.trim() || motivo.trim().length < 5) {
      setErrorMsg('Explique o motivo da retirada com pelo menos 5 caracteres. Ex.: pagamento de fornecedor.');
      return;
    }

    setShowPinModal(true);
  };

  const handlePinSuccess = async () => {
    setShowPinModal(false);
    try {
      setIsSubmitting(true);
      const valorNumerico = Number(valor || 0);
      await onSubmit({
        valor: valorNumerico,
        motivo: motivo.trim(),
        observacao: observacao.trim()
      });
      onClose();
    } catch (err: any) {
      setErrorMsg(err.message || 'Não foi possível registrar a retirada de dinheiro.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <div
        onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
        className="fixed inset-0 bg-black/85 backdrop-blur-xs z-50 flex items-center justify-center p-4 overflow-y-auto cursor-pointer"
      >
        <div className="w-full max-w-md bg-koma-dialog border border-koma-border rounded-3xl p-6 space-y-4 text-left shadow-2xl relative animate-scale-in my-8">
          <div className="flex justify-between items-center pb-2 border-b border-koma-border">
            <div>
              <h3 className="font-serif text-sm font-bold text-koma-foreground flex items-center gap-2">
                <ShieldCheck size={18} className="text-amber-400" />
                <span>Retirar dinheiro do caixa</span>
              </h3>
              <p className="text-[9px] text-koma-subtle">Registre a retirada de dinheiro físico. A autorização do gerente será solicitada.</p>
            </div>
            <button type="button" onClick={onClose} className="p-1 text-koma-subtle hover:text-koma-foreground transition-colors cursor-pointer">
              <X size={16} />
            </button>
          </div>

          {errorMsg && (
            <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-xs flex items-center gap-2">
              <AlertTriangle size={16} className="shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          <div className="bg-koma-raised p-3 rounded-2xl border border-koma-border text-xs font-mono flex justify-between items-center">
            <span className="text-koma-subtle font-sans text-[10px] uppercase font-bold">Dinheiro disponível:</span>
            <strong className="text-emerald-400 font-bold text-sm">R$ {saldoDisponivelDinheiro.toFixed(2)}</strong>
          </div>

          <form onSubmit={handlePreSubmit} className="space-y-4">
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-koma-subtle uppercase tracking-wider block">
                Valor a retirar (R$) <span className="text-red-400">*</span>:
              </label>
              <MoneyInput
                required
                placeholder="0,00"
                value={valor}
                onValueChange={setValor}
                selectOnFocus
                aria-label="Valor a retirar do caixa"
                className="w-full px-3 py-2 bg-koma-input border border-koma-border rounded-xl text-koma-foreground text-sm font-mono focus:outline-none focus:border-amber-500"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-bold text-koma-subtle uppercase tracking-wider block">
                Motivo da retirada <span className="text-red-400">* (Obrigatório)</span>:
              </label>
              <input
                type="text"
                required
                placeholder="Ex.: pagamento de fornecedor ou retirada de segurança"
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                className="w-full px-3 py-2 bg-koma-input border border-koma-border rounded-xl text-koma-foreground text-xs focus:outline-none focus:border-amber-500"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-bold text-koma-subtle uppercase tracking-wider block">Observação (Opcional):</label>
              <textarea
                rows={2}
                placeholder="Detalhes adicionais..."
                value={observacao}
                onChange={(e) => setObservacao(e.target.value)}
                className="w-full px-3 py-2 bg-koma-input border border-koma-border rounded-xl text-koma-foreground text-xs focus:outline-none focus:border-amber-500 resize-none"
              />
            </div>

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 py-2 border border-koma-border hover:border-koma-border bg-koma-raised text-koma-subtle hover:text-koma-foreground rounded-xl text-[10px] font-bold uppercase tracking-wider transition-colors cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="flex-1 py-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-black font-bold rounded-xl text-[10px] uppercase tracking-wider transition-colors cursor-pointer shadow-sm"
              >
                {isSubmitting ? 'Gravando...' : 'Pedir autorização'}
              </button>
            </div>
          </form>
        </div>
      </div>

      <ManagerPinModal
        isOpen={showPinModal}
        actionTitle="Autorizar retirada de dinheiro"
        onClose={() => setShowPinModal(false)}
        onSuccess={handlePinSuccess}
      />
    </>
  );
};
