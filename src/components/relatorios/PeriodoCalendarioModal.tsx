import React, { useState } from 'react';

import { Calendar as CalendarIcon, X } from 'lucide-react';
import { reportPeriodLabel, reportShortcut } from '../../domain/reportPeriod';

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

  const shortcuts = [
    { label: 'Hoje', days: 1, offset: 0 },
    { label: 'Ontem', days: 1, offset: 1 },
    { label: 'Últimos 7 dias', days: 7, offset: 0 },
    { label: 'Últimos 15 dias', days: 15, offset: 0 },
    { label: 'Últimos 30 dias', days: 30, offset: 0 },
  ];
  const applyShortcut = (days: number, offset: number) => {
    const next = reportShortcut(days, new Date(), offset);
    onApply(next.inicio, next.fim);
    onClose();
  };

  const handleCustomSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!tempInicio || !tempFim || tempInicio > tempFim) return;
    onApply(tempInicio, tempFim);
    onClose();
  };

  return (
    <div
      className={"fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in"}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div role="dialog" aria-modal="true" aria-labelledby="report-period-heading" className={"bg-koma-dialog border border-koma-border rounded-3xl max-w-md w-full p-6 space-y-5 text-left"}>
        <div className="flex justify-between items-center border-b border-koma-border pb-3">
          <div className="flex items-center gap-2">
            <CalendarIcon size={18} className="text-emerald-700 dark:text-emerald-400" />
            <h3 id="report-period-heading" className="font-serif font-bold text-base text-koma-foreground">Selecionar Período</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar seleção de período"
            className="p-1 hover:bg-koma-raised rounded-full text-koma-subtle hover:text-koma-foreground transition-colors cursor-pointer"
          >
            <X size={16} />
          </button>
        </div>

        {/* Atalhos Rápidos */}
        <div className="space-y-2">
          <span className="text-[9px] font-bold text-koma-subtle uppercase tracking-wider block">Atalhos Rápidos:</span>
          <div className="grid grid-cols-2 gap-2">
            {shortcuts.map(shortcut => {
              const period = reportShortcut(shortcut.days, new Date(), shortcut.offset);
              return <button key={shortcut.label} type="button" onClick={() => applyShortcut(shortcut.days, shortcut.offset)} className="cursor-pointer rounded-xl border border-koma-border bg-koma-raised px-3 py-2 text-left text-xs font-bold text-koma-foreground hover:bg-koma-card">
                {shortcut.label}<span className="mt-1 block text-[9px] font-normal text-koma-muted">{reportPeriodLabel(period.inicio, period.fim)}</span>
              </button>;
            })}
          </div>
        </div>

        {/* Intervalo Personalizado */}
        <form onSubmit={handleCustomSubmit} className="space-y-4 pt-2 border-t border-koma-border">
          <span className="text-[9px] font-bold text-koma-subtle uppercase tracking-wider block">Intervalo Personalizado:</span>
          
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label htmlFor="report-start-date" className="text-[8px] font-bold text-koma-secondary uppercase tracking-wider block">Data Início:</label>
              <input
                id="report-start-date"
                type="date"
                max={tempFim || undefined}
                value={tempInicio}
                onChange={(e) => setTempInicio(e.target.value)}
                className="w-full px-3 py-2 bg-koma-input border border-koma-border rounded-xl text-koma-foreground font-mono text-[10px]"
                required
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="report-end-date" className="text-[8px] font-bold text-koma-secondary uppercase tracking-wider block">Data Fim:</label>
              <input
                id="report-end-date"
                type="date"
                min={tempInicio || undefined}
                value={tempFim}
                onChange={(e) => setTempFim(e.target.value)}
                className="w-full px-3 py-2 bg-koma-input border border-koma-border rounded-xl text-koma-foreground font-mono text-[10px]"
                required
              />
            </div>
          </div>

          {tempInicio > tempFim && <p role="alert" className="text-xs text-koma-danger-text">A data inicial deve ser anterior ou igual à data final.</p>}
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
              disabled={!tempInicio || !tempFim || tempInicio > tempFim}
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
