/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { EyeOff, DollarSign, CreditCard, QrCode, CheckCircle, X, ShieldAlert } from 'lucide-react';
import clsx from 'clsx';
import MoneyInput from './MoneyInput';

interface FechamentoCegoModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (declaracao: {
    dinheiro: number;
    cartaoCredito: number;
    cartaoDebito: number;
    pix: number;
    observacao: string;
  }) => Promise<void>;
}

export function FechamentoCegoModal({
  isOpen,
  onClose,
  onConfirm
}: FechamentoCegoModalProps) {
  const [dinheiro, setDinheiro] = useState<number | ''>('');
  const [cartaoCredito, setCartaoCredito] = useState<number | ''>('');
  const [cartaoDebito, setCartaoDebito] = useState<number | ''>('');
  const [pix, setPix] = useState<number | ''>('');
  const [observacao, setObservacao] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    const declaracao = {
      dinheiro: Number(dinheiro || 0),
      cartaoCredito: Number(cartaoCredito || 0),
      cartaoDebito: Number(cartaoDebito || 0),
      pix: Number(pix || 0),
      observacao: observacao.trim()
    };

    try {
      setLoading(true);
      await onConfirm(declaracao);
      onClose();
    } catch (err: any) {
      setErrorMsg(err.message || 'Erro ao processar fechamento cego.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4 animate-fade-in">
      <div className="bg-koma-card border border-amber-500/30 rounded-2xl w-full max-w-lg p-6 shadow-2xl text-koma-foreground relative">
        <button
          onClick={onClose}
          disabled={loading}
          className="absolute top-4 right-4 text-koma-subtle hover:text-koma-foreground transition-colors disabled:opacity-50"
        >
          <X size={20} />
        </button>

        {/* Cabeçalho */}
        <div className="flex items-center gap-3 mb-6 pb-4 border-b border-koma-border">
          <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
            <EyeOff size={20} />
          </div>
          <div>
            <h3 className="text-base font-bold text-koma-foreground">Fechamento de Caixa Cego</h3>
            <p className="text-xs text-koma-subtle">Declare os valores físicos contados na gaveta</p>
          </div>
        </div>

        {/* Aviso de Regra Cega */}
        <div className="mb-5 p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl text-amber-600 dark:text-amber-300/90 text-xs flex items-start gap-2.5">
          <ShieldAlert size={16} className="mt-0.5 shrink-0 text-amber-400" />
          <span>
            <b>Regra Cega Ativa:</b> Os saldos esperados pelo sistema estão ocultos para evitar contagens induzidas. O relatório de quebra (Sobra/Falta) será gerado para a gerência.
          </span>
        </div>

        {errorMsg && (
          <div className="mb-4 p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-rose-400 text-xs">
            {errorMsg}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-koma-secondary mb-1.5 flex items-center gap-2">
              <DollarSign size={14} className="text-emerald-400" />
              <span>Contagem Física Dinheiro (R$)</span>
            </label>
            <MoneyInput
              placeholder="0,00"
              value={dinheiro}
              onValueChange={setDinheiro}
              className="w-full px-3.5 py-2.5 rounded-xl bg-koma-card border border-koma-border text-koma-foreground font-mono text-sm focus:border-amber-500 focus:outline-none"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-koma-secondary mb-1.5 flex items-center gap-2">
              <CreditCard size={14} className="text-blue-400" />
              <span>Contagem Cartão de Crédito (R$)</span>
            </label>
            <MoneyInput
              placeholder="0,00"
              value={cartaoCredito}
              onValueChange={setCartaoCredito}
              className="w-full px-3.5 py-2.5 rounded-xl bg-koma-card border border-koma-border text-koma-foreground font-mono text-sm focus:border-amber-500 focus:outline-none"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-koma-secondary mb-1.5 flex items-center gap-2">
              <CreditCard size={14} className="text-purple-400" />
              <span>Contagem Cartão de Débito (R$)</span>
            </label>
            <MoneyInput
              placeholder="0,00"
              value={cartaoDebito}
              onValueChange={setCartaoDebito}
              className="w-full px-3.5 py-2.5 rounded-xl bg-koma-card border border-koma-border text-koma-foreground font-mono text-sm focus:border-amber-500 focus:outline-none"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-koma-secondary mb-1.5 flex items-center gap-2">
              <QrCode size={14} className="text-teal-400" />
              <span>Contagem Pix (R$)</span>
            </label>
            <MoneyInput
              placeholder="0,00"
              value={pix}
              onValueChange={setPix}
              className="w-full px-3.5 py-2.5 rounded-xl bg-koma-card border border-koma-border text-koma-foreground font-mono text-sm focus:border-amber-500 focus:outline-none"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-koma-subtle mb-1.5">
              Observações do Fechamento (Opcional)
            </label>
            <textarea
              rows={2}
              placeholder="Digite observações sobre o turno ou troco..."
              value={observacao}
              onChange={e => setObservacao(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl bg-koma-card border border-koma-border text-koma-foreground text-xs focus:border-amber-500 focus:outline-none resize-none"
            />
          </div>

          <div className="flex gap-3 pt-3">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="flex-1 py-3 rounded-xl bg-koma-card hover:bg-koma-raised border border-koma-border text-koma-secondary text-xs font-semibold transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={loading}
              className={clsx(
                'flex-1 py-3 rounded-xl font-bold text-xs flex items-center justify-center gap-2 transition-all shadow-lg',
                loading
                  ? 'bg-koma-raised text-koma-muted cursor-not-allowed'
                  : 'bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-black shadow-amber-500/20'
              )}
            >
              <CheckCircle size={16} />
              <span>{loading ? 'Processando Fechamento...' : 'Encerrar Caixa Cego'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
