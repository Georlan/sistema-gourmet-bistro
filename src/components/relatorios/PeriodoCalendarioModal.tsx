import React, { useState } from 'react';
import clsx from 'clsx';
import { Calendar as CalendarIcon, X } from 'lucide-react';

interface PeriodoCalendarioModalProps {
  onClose: () => void;
  dataInicio: string;
  dataFim: string;
  onApply: (inicio: string, fim: string) => void;
}

export const PeriodoCalendarioModal: React.FC<PeriodoCalendarioModalProps> = ({
  onClose,
  dataInicio,
  dataFim,
  onApply,
}) => {
  const [tempInicio, setTempInicio] = useState(dataInicio);
  const [tempFim, setTempFim] = useState(dataFim);

  const applyShortcut = (days: number) => {
    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - days + 1);

    const startStr = start.toISOString().split('T')[0];
    const endStr = end.toISOString().split('T')[0];

    onApply(startStr, endStr);
    onClose();
  };

  const handleCustomSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!tempInicio || !tempFim) return;
    onApply(tempInicio, tempFim);
    onClose();
  };

  return (
    <div
      className={clsx('fixed', 'inset-0', 'z-50', 'bg-black/80', 'backdrop-blur-sm', 'flex', 'items-center', 'justify-center', 'p-4', 'animate-fade-in')}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className={clsx('bg-[#121214]', 'border', 'border-[#27272A]', 'rounded-3xl', 'max-w-md', 'w-full', 'p-6', 'space-y-5', 'text-left')}>
        <div className="flex justify-between items-center border-b border-[#27272A] pb-3">
          <div className="flex items-center gap-2">
            <CalendarIcon size={18} className="text-[#10b981]" />
            <h3 className="font-serif font-bold text-base text-white">Selecionar Período</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 hover:bg-[#27272A] rounded-full text-gray-400 hover:text-white transition-colors cursor-pointer"
          >
            <X size={16} />
          </button>
        </div>

        {/* Atalhos Rápidos */}
        <div className="space-y-2">
          <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wider block">Atalhos Rápidos:</span>
          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={() => applyShortcut(7)}
              className="py-2 px-3 bg-[#1C1C1F] hover:bg-[#27272A] border border-[#27272A] text-white rounded-xl text-[10px] font-bold transition-all cursor-pointer"
            >
              Últimos 7 dias
            </button>
            <button
              type="button"
              onClick={() => applyShortcut(15)}
              className="py-2 px-3 bg-[#1C1C1F] hover:bg-[#27272A] border border-[#27272A] text-white rounded-xl text-[10px] font-bold transition-all cursor-pointer"
            >
              Últimos 15 dias
            </button>
            <button
              type="button"
              onClick={() => applyShortcut(30)}
              className="py-2 px-3 bg-[#1C1C1F] hover:bg-[#27272A] border border-[#27272A] text-white rounded-xl text-[10px] font-bold transition-all cursor-pointer"
            >
              Últimos 30 dias
            </button>
          </div>
        </div>

        {/* Intervalo Personalizado */}
        <form onSubmit={handleCustomSubmit} className="space-y-4 pt-2 border-t border-[#27272A]">
          <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wider block">Intervalo Personalizado:</span>
          
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-[8px] font-bold text-gray-300 uppercase tracking-wider block">Data Início:</label>
              <input
                type="date"
                value={tempInicio}
                onChange={(e) => setTempInicio(e.target.value)}
                className="w-full px-3 py-2 bg-[#09090B] border border-[#27272A] rounded-xl text-white font-mono text-[10px]"
                required
              />
            </div>
            <div className="space-y-1">
              <label className="text-[8px] font-bold text-gray-300 uppercase tracking-wider block">Data Fim:</label>
              <input
                type="date"
                value={tempFim}
                onChange={(e) => setTempFim(e.target.value)}
                className="w-full px-3 py-2 bg-[#09090B] border border-[#27272A] rounded-xl text-white font-mono text-[10px]"
                required
              />
            </div>
          </div>

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 bg-[#1C1C1F] hover:bg-[#27272A] border border-[#27272A] text-gray-300 rounded-xl text-[10px] font-bold transition-all cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="flex-1 py-2.5 bg-[#10b981] hover:bg-[#059669] text-[#121214] rounded-xl text-[10px] font-extrabold transition-all cursor-pointer shadow-sm uppercase tracking-wider"
            >
              Aplicar Período
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
