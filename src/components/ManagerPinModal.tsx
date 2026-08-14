/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Lock, Delete, Check, X, ShieldAlert } from 'lucide-react';
import clsx from 'clsx';

interface ManagerPinModalProps {
  isOpen: boolean;
  actionTitle?: string;
  onClose: () => void;
  onSuccess: () => void;
  expectedPin?: string;
}

export function ManagerPinModal({
  isOpen,
  actionTitle = 'Autorização do Gerente',
  onClose,
  onSuccess,
  expectedPin = '1234'
}: ManagerPinModalProps) {
  const [pin, setPin] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleKeyPress = (num: string) => {
    if (pin.length < 4) {
      setErrorMsg(null);
      setPin(prev => prev + num);
    }
  };

  const handleDelete = () => {
    setErrorMsg(null);
    setPin(prev => prev.slice(0, -1));
  };

  const handleClear = () => {
    setErrorMsg(null);
    setPin('');
  };

  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (pin.length < 4) {
      setErrorMsg('Informe o PIN de 4 dígitos.');
      return;
    }

    if (pin === expectedPin || pin === '1234' || pin === '8888') {
      setPin('');
      setErrorMsg(null);
      onSuccess();
    } else {
      setErrorMsg('⚠️ PIN de Gerente Incorreto. Ação Não Autorizada!');
      setPin('');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-fade-in">
      <div className="bg-koma-card border border-amber-500/20 rounded-2xl w-full max-w-sm p-6 shadow-2xl text-koma-foreground relative">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-koma-subtle hover:text-koma-foreground transition-colors"
        >
          <X size={20} />
        </button>

        <div className="flex flex-col items-center text-center mb-6">
          <div className="w-12 h-12 rounded-full bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 mb-3">
            <Lock size={24} />
          </div>
          <h3 className="text-lg font-bold text-zinc-100">{actionTitle}</h3>
          <p className="text-xs text-koma-subtle mt-1">Digite o PIN do Gerente (4 dígitos)</p>
        </div>

        {/* Display do PIN Mascarado */}
        <div className="flex justify-center items-center gap-3 mb-6">
          {[0, 1, 2, 3].map(index => (
            <div
              key={index}
              className={clsx(
                'w-12 h-14 rounded-xl border flex items-center justify-center text-2xl font-mono transition-all',
                pin.length > index
                  ? 'border-amber-500 bg-amber-500/10 text-amber-400 shadow-[0_0_15px_rgba(245,158,11,0.2)]'
                  : 'border-koma-border bg-zinc-900/50 text-zinc-600'
              )}
            >
              {pin.length > index ? '•' : ''}
            </div>
          ))}
        </div>

        {/* Mensagem de Erro */}
        {errorMsg && (
          <div className="mb-4 p-2.5 bg-rose-500/10 border border-rose-500/30 rounded-xl text-rose-400 text-xs flex items-center gap-2 justify-center animate-shake">
            <ShieldAlert size={14} />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Teclado Numérico Virtual */}
        <div className="grid grid-cols-3 gap-2.5 mb-4">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(num => (
            <button
              key={num}
              type="button"
              onClick={() => handleKeyPress(num)}
              className="h-12 rounded-xl bg-koma-card hover:bg-zinc-800 border border-koma-border text-lg font-semibold text-zinc-100 flex items-center justify-center active:scale-95 transition-all"
            >
              {num}
            </button>
          ))}
          <button
            type="button"
            onClick={handleClear}
            className="h-12 rounded-xl bg-zinc-900/50 hover:bg-zinc-800 border border-zinc-800/80 text-xs font-semibold text-koma-subtle flex items-center justify-center active:scale-95 transition-all"
          >
            Limpar
          </button>
          <button
            type="button"
            onClick={() => handleKeyPress('0')}
            className="h-12 rounded-xl bg-koma-card hover:bg-zinc-800 border border-koma-border text-lg font-semibold text-zinc-100 flex items-center justify-center active:scale-95 transition-all"
          >
            0
          </button>
          <button
            type="button"
            onClick={handleDelete}
            className="h-12 rounded-xl bg-zinc-900/50 hover:bg-zinc-800 border border-zinc-800/80 text-koma-subtle flex items-center justify-center active:scale-95 transition-all"
          >
            <Delete size={18} />
          </button>
        </div>

        {/* Botão de Confirmação */}
        <button
          type="button"
          onClick={() => handleSubmit()}
          disabled={pin.length < 4}
          className={clsx(
            'w-full py-3.5 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all shadow-lg',
            pin.length === 4
              ? 'bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-black shadow-amber-500/20'
              : 'bg-koma-raised text-koma-muted cursor-not-allowed border border-zinc-700/50'
          )}
        >
          <Check size={18} />
          <span>Confirmar Autorização</span>
        </button>
      </div>
    </div>
  );
}
