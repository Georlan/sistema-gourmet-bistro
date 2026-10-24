import { Zap, Printer } from 'lucide-react';

interface MesaPrintActionsProps {
  isPrintingDirect: boolean;
  onPrintValues: () => void;
  onPrintPreview: () => void;
}

/** Both layouts keep the same print intents and single-action guards. */
export function MesaPrintActions({ isPrintingDirect, onPrintValues, onPrintPreview }: MesaPrintActionsProps) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <button
        id="quick-print-values-btn"
        type="button"
        disabled={isPrintingDirect}
        onClick={onPrintValues}
        className="min-h-[42px] py-2.5 px-2 bg-koma-raised hover:bg-koma-card border border-koma-border hover:border-emerald-500/30 text-koma-foreground rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 transition-all cursor-pointer active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed shadow-xs"
        title="Imprimir Conta da Mesa"
      >
        <Zap size={14} className="shrink-0 text-emerald-400" />
        <span>Conta da Mesa</span>
      </button>

      <button
        id="print-invoice-preview-btn"
        type="button"
        disabled={isPrintingDirect}
        onClick={onPrintPreview}
        className="min-h-[42px] py-2.5 px-2 bg-koma-raised hover:bg-koma-card border border-koma-border hover:border-emerald-500/30 text-koma-foreground rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 transition-all cursor-pointer active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed shadow-xs"
        title="Reimprimir todos os itens ativos da mesa"
      >
        <Printer size={14} className="text-emerald-400 shrink-0" />
        <span>Reimpressão</span>
      </button>
    </div>
  );
}
