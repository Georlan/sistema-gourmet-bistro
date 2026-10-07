import { useCallback, useState } from 'react';
import { reportShortcut, validReportPeriod, type ReportPeriod } from '../../domain/reportPeriod';
export type { ReportPeriod } from '../../domain/reportPeriod';

const STORAGE_KEY = 'koma_reports_period';

function defaultPeriod(): ReportPeriod { return reportShortcut(30); }

function initialPeriod(): ReportPeriod {
  if (typeof window === 'undefined') return defaultPeriod();
  try {
    const stored = JSON.parse(window.sessionStorage.getItem(STORAGE_KEY) || 'null');
    if (validReportPeriod(stored)) return stored;
  } catch {
    // A preferência é apenas um atalho; um valor inválido volta ao padrão.
  }
  return defaultPeriod();
}

/** Mantém o mesmo período ao alternar entre as abas de Relatórios. */
export function useSharedReportPeriod() {
  const [period, setPeriod] = useState<ReportPeriod>(initialPeriod);

  const applyPeriod = useCallback((inicio: string, fim: string) => {
    const next = { inicio, fim };
    if (!validReportPeriod(next)) return;
    setPeriod(next);
    if (typeof window !== 'undefined') {
      try { window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* A seleção continua funcionando sem armazenamento. */ }
    }
  }, []);

  return {
    dataInicio: period.inicio,
    dataFim: period.fim,
    applyPeriod,
  };
}
