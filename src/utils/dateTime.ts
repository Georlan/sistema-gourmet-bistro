export type TimestampInput = string | number | Date | null | undefined;

const HAS_EXPLICIT_TIMEZONE = /(?:[zZ]|[+-]\d{2}:?\d{2})$/;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const CLOCK_ONLY = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/;

/**
 * Converte timestamps retornados pelo backend em instantes reais.
 *
 * O banco do Kôma persiste UTC, mas colunas DateTime legadas podem ser
 * serializadas sem `Z`. O JavaScript trataria esse valor como hora local e
 * deslocaria caixa, estoque e comandas em três horas. Aqui, ISO sem offset e
 * com horário é explicitamente UTC. Datas puras continuam sendo calendários
 * locais e `HH:mm` continua sendo o relógio operacional do dia corrente.
 */
export function parseBackendTimestamp(
  raw: TimestampInput,
  now: number = Date.now(),
): Date | null {
  if (raw === null || raw === undefined || raw === '') return null;

  if (raw instanceof Date) {
    const copy = new Date(raw.getTime());
    return Number.isNaN(copy.getTime()) ? null : copy;
  }

  if (typeof raw === 'number') {
    if (!Number.isFinite(raw) || raw <= 0) return null;
    const milliseconds = raw < 1_000_000_000_000 ? raw * 1000 : raw;
    const date = new Date(milliseconds);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const value = raw.trim();
  if (!value) return null;

  const clock = value.match(CLOCK_ONLY);
  if (clock) {
    const candidate = new Date(now);
    candidate.setHours(Number(clock[1]), Number(clock[2]), Number(clock[3] || 0), 0);
    if (candidate.getTime() > now + 30_000) {
      candidate.setDate(candidate.getDate() - 1);
    }
    return candidate;
  }

  if (DATE_ONLY.test(value)) {
    const localDate = new Date(`${value}T00:00:00`);
    return Number.isNaN(localDate.getTime()) ? null : localDate;
  }

  const iso = value.replace(' ', 'T');
  const normalized = HAS_EXPLICIT_TIMEZONE.test(iso) ? iso : `${iso}Z`;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatBackendDateTime(
  raw: TimestampInput,
  options: Intl.DateTimeFormatOptions = { dateStyle: 'short', timeStyle: 'short' },
): string {
  const date = parseBackendTimestamp(raw);
  return date ? date.toLocaleString('pt-BR', options) : '—';
}

export function formatBackendTime(raw: TimestampInput): string {
  const date = parseBackendTimestamp(raw);
  return date
    ? date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    : '—';
}

export function localCalendarDate(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
