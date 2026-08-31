import React, { useState } from 'react';

import { Calendar as CalendarIcon, X } from 'lucide-react';
import { localCalendarDate } from '../../utils/dateTime';

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

    const startStr = localCalendarDate(start);
    const endStr = localCalendarDate(end);

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
      className={"fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in"}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className={"bg-koma-dialog border border-koma-border rounded-3xl max-w-md w-full p-6 space-y-5 text-left"}>
        <div className="flex justify-between items-center border-b border-koma-border pb-3">
          <div className="flex items-center gap-2">
            <CalendarIcon size={18} className="text-emerald-700 dark:text-emerald-400" />
            <h3 className="font-serif font-bold text-base text-koma-foreground">Selecionar Período</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 hover:bg-koma-raised rounded-full text-koma-subtle hover:text-koma-foreground transition-colors cursor-pointer"
          >
            <X size={16} />
          </button>
        </div>

        {/* Atalhos Rápidos */}
        <div className="space-y-2">
          <span className="text-[9px] font-bold text-koma-subtle uppercase tracking-wider block">Atalhos Rápidos:</span>
          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={() => applyShortcut(7)}
              className="py-2 px-3 bg-koma-raised hover:bg-koma-card border border-koma-border text-koma-foreground rounded-xl text-[10px] font-bold transition-all cursor-pointer"
            >
              Últimos 7 dias
            </button>
            <button
              type="button"
              onClick={() => applyShortcut(15)}
              className="py-2 px-3 bg-koma-raised hover:bg-koma-card border border-koma-border text-koma-foreground rounded-xl text-[10px] font-bold transition-all cursor-pointer"
            >
              Últimos 15 dias
            </button>
            <button
              type="button"
              onClick={() => applyShortcut(30)}
              className="py-2 px-3 bg-koma-raised hover:bg-koma-card border border-koma-border text-koma-foreground rounded-xl text-[10px] font-bold transition-all cursor-pointer"
            >
              Últimos 30 dias
            </button>
          </div>
        </div>

        {/* Intervalo Personalizado */}
        <form onSubmit={handleCustomSubmit} className="space-y-4 pt-2 border-t border-koma-border">
          <span className="text-[9px] font-bold text-koma-subtle uppercase tracking-wider block">Intervalo Personalizado:</span>
          
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-[8px] font-bold text-koma-secondary uppercase tracking-wider block">Data Início:</label>
              <input
                type="date"
                value={tempInicio}
                onChange={(e) => setTempInicio(e.target.value)}
                className="w-full px-3 py-2 bg-koma-input border border-koma-border rounded-xl text-koma-foreground font-mono text-[10px]"
                required
              />
            </div>
            <div className="space-y-1">
              <label className="text-[8px] font-bold text-koma-secondary uppercase tracking-wider block">Data Fim:</label>
              <input
                type="date"
                value={tempFim}
                onChange={(e) => setTempFim(e.target.value)}
                className="w-full px-3 py-2 bg-koma-input border border-koma-border rounded-xl text-koma-foreground font-mono text-[10px]"
                required
              />
            </div>
          </div>

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 bg-koma-raised hover:bg-koma-card border border-koma-border text-koma-secondary rounded-xl text-[10px] font-bold transition-all cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="flex-1 py-2.5 bg-[#10b981] hover:bg-[#059669] text-zinc-950 font-extrabold rounded-xl text-[10px] transition-all cursor-pointer shadow-sm uppercase tracking-wider"
            >
              Aplicar Período
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
