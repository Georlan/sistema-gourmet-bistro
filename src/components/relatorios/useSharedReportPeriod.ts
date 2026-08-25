import { useCallback, useState } from 'react';
import { localCalendarDate } from '../../utils/dateTime';

const STORAGE_KEY = 'koma_reports_period';

export interface ReportPeriod {
  inicio: string;
  fim: string;
}

function defaultPeriod(): ReportPeriod {
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - 29);
  return { inicio: localCalendarDate(start), fim: localCalendarDate(end) };
}

function initialPeriod(): ReportPeriod {
  if (typeof window === 'undefined') return defaultPeriod();
  try {
    const stored = JSON.parse(window.sessionStorage.getItem(STORAGE_KEY) || 'null');
    if (stored?.inicio && stored?.fim) return stored;
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
    setPeriod(next);
    if (typeof window !== 'undefined') {
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    }
  }, []);

  return {
    dataInicio: period.inicio,
    dataFim: period.fim,
    applyPeriod,
  };
}
