import React, { useState } from 'react';
import { X, AlertTriangle, ShieldCheck } from 'lucide-react';
import { ManagerPinModal } from '../ManagerPinModal';

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
  const [valor, setValor] = useState<number>(0);
  const [motivo, setMotivo] = useState<string>('');
  const [observacao, setObservacao] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showPinModal, setShowPinModal] = useState<boolean>(false);

  const handlePreSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (valor <= 0) {
      setErrorMsg('O valor da sangria deve ser maior que zero.');
      return;
    }

    if (valor > saldoDisponivelDinheiro) {
      setErrorMsg(`Saldo em dinheiro insuficiente! O caixa possui R$ ${saldoDisponivelDinheiro.toFixed(2)} disponível.`);
      return;
    }

    if (!motivo.trim() || motivo.trim().length < 5) {
      setErrorMsg('O Motivo / Justificativa é OBRIGATÓRIO (mínimo de 5 caracteres). Ex: "Pagamento de hortifrúti"');
      return;
    }

    // Solicita o PIN de Gerente antes de prosseguir
    setShowPinModal(true);
  };

  const handlePinSuccess = async () => {
    setShowPinModal(false);
    try {
      setIsSubmitting(true);
      await onSubmit({
        valor: Number(valor),
        motivo: motivo.trim(),
        observacao: observacao.trim()
      });

      // Dispara payload de impressão de comprovante térmico de sangria
      try {
        const dataHora = new Date().toLocaleString('pt-BR');
        const comprovanteText = `
==============================================
          COMPROVANTE DE SANGRIA
              RESTAURANTE KÔMA
==============================================
Data/Hora: ${dataHora}
Turno: Caixa 1
Autorizado por: Gerente (PIN Confirmado)

TIPO: SANGRIA DE CAIXA
VALOR: R$ ${Number(valor).toFixed(2)}
MOTIVO: ${motivo.trim()}
==============================================
Assinatura do Responsável: _________________
==============================================
        `.trim();

        window.dispatchEvent(new CustomEvent('koma_print_receipt', {
          detail: { title: 'Comprovante de Sangria', content: comprovanteText }
        }));
      } catch (printErr) {
        console.warn('Erro ao disparar impressão de sangria:', printErr);
      }

      onClose();
    } catch (err: any) {
      setErrorMsg(err.message || 'Erro ao registrar sangria.');
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
          {/* Header */}
          <div className="flex justify-between items-center pb-2 border-b border-koma-border">
            <div>
              <h3 className="font-serif text-sm font-bold text-koma-foreground flex items-center gap-2">
                <ShieldCheck size={18} className="text-amber-400" />
                <span>Nova Sangria de Caixa</span>
              </h3>
              <p className="text-[9px] text-koma-subtle">Retirada de dinheiro físico do caixa com auditoria por PIN.</p>
            </div>
            <button type="button" onClick={onClose} className="p-1 text-koma-subtle hover:text-white transition-colors cursor-pointer">
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
            <span className="text-koma-subtle font-sans text-[10px] uppercase font-bold">Saldo em Dinheiro Disponível:</span>
            <strong className="text-emerald-400 font-bold text-sm">R$ {saldoDisponivelDinheiro.toFixed(2)}</strong>
          </div>

          <form onSubmit={handlePreSubmit} className="space-y-4">
            {/* Valor */}
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-koma-subtle uppercase tracking-wider block">
                Valor da Sangria (R$) <span className="text-red-400">*</span>:
              </label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                required
                placeholder="0,00"
                value={valor || ''}
                onChange={(e) => setValor(parseFloat(e.target.value) || 0)}
                className="w-full px-3 py-2 bg-koma-input border border-koma-border rounded-xl text-koma-foreground text-sm font-mono focus:outline-none focus:border-amber-500"
              />
            </div>

            {/* Motivo Obrigatório */}
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-koma-subtle uppercase tracking-wider block">
                Motivo / Justificativa <span className="text-red-400">* (Obrigatório)</span>:
              </label>
              <input
                type="text"
                required
                placeholder="ex: Pagamento emergencial de hortifrúti, sangria de segurança..."
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                className="w-full px-3 py-2 bg-koma-input border border-koma-border rounded-xl text-koma-foreground text-xs focus:outline-none focus:border-amber-500"
              />
            </div>

            {/* Observação Opcional */}
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

            {/* Actions */}
            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 py-2 border border-koma-border hover:border-zinc-700 bg-koma-raised text-koma-subtle hover:text-white rounded-xl text-[10px] font-bold uppercase tracking-wider transition-colors cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="flex-1 py-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-black font-bold rounded-xl text-[10px] uppercase tracking-wider transition-colors cursor-pointer shadow-sm"
              >
                {isSubmitting ? 'Gravando...' : 'Solicitar PIN do Gerente'}
              </button>
            </div>
          </form>
        </div>
      </div>

      <ManagerPinModal
        isOpen={showPinModal}
        actionTitle="Autorização de Sangria"
        onClose={() => setShowPinModal(false)}
        onSuccess={handlePinSuccess}
      />
    </>
  );
};
