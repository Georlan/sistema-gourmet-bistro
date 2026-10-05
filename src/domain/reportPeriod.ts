export interface ReportPeriod { inicio: string; fim: string }

/** Datas gerenciais no mesmo fuso operacional padrão do backend. */
export function reportToday(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Fortaleza', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const part = (type: string) => parts.find(p => p.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function reportShortcut(days: number, now = new Date(), offset = 0): ReportPeriod {
  const end = new Date(`${reportToday(now)}T12:00:00Z`);
  end.setUTCDate(end.getUTCDate() - offset);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - days + 1);
  return { inicio: start.toISOString().slice(0, 10), fim: end.toISOString().slice(0, 10) };
}

export function validReportPeriod(value: unknown): value is ReportPeriod {
  if (!value || typeof value !== 'object') return false;
  const { inicio, fim } = value as ReportPeriod;
  const valid = (date: unknown) => typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(`${date}T12:00:00Z`)) && new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) === date;
  return valid(inicio) && valid(fim) && inicio <= fim;
}

export function reportPeriodLabel(inicio: string, fim: string): string {
  const format = (date: string) => date.split('-').reverse().join('/');
  return inicio === fim ? format(inicio) : `${format(inicio)} — ${format(fim)}`;
}
