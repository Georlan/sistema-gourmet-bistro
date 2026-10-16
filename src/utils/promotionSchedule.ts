/** datetime-local representa o relógio da campanha, nunca o fuso do dispositivo. */
export function campaignLocalTime(iso: string | null | undefined, timeZone: string): string {
  if (!iso) return '';
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit',
    day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso));
  const value = (type: string) => parts.find(part => part.type === type)?.value;
  return `${value('year')}-${value('month')}-${value('day')}T${value('hour')}:${value('minute')}`;
}

export function campaignInstant(local: string, timeZone: string): string | null {
  if (!local) return null;
  const nominal = Date.parse(`${local}Z`);
  if (!Number.isFinite(nominal)) throw new Error('Data da campanha inválida.');
  let instant = nominal;
  for (let i = 0; i < 3; i++) {
    const displayed = Date.parse(`${campaignLocalTime(new Date(instant).toISOString(), timeZone)}Z`);
    instant += nominal - displayed;
  }
  const iso = new Date(instant).toISOString();
  if (campaignLocalTime(iso, timeZone) !== local) throw new Error('Este horário não existe no fuso escolhido.');
  return iso;
}
