import { Calendar } from 'lucide-react';
import { reportPeriodLabel } from '../../domain/reportPeriod';

export function ReportPeriodButton({ inicio, fim, onClick }: { inicio: string; fim: string; onClick: () => void }) {
  const label = reportPeriodLabel(inicio, fim);
  return <button type="button" onClick={onClick} aria-label={`Alterar período: ${label}`} className="flex cursor-pointer items-center gap-2 rounded-xl border border-koma-border bg-koma-raised px-3.5 py-2 text-xs font-bold text-koma-foreground transition-colors hover:bg-koma-card">
    <Calendar size={15} className="shrink-0 text-emerald-700 dark:text-emerald-300" />
    <span><span className="block text-[9px] font-medium text-koma-muted">Período selecionado</span>{label}</span>
  </button>;
}
