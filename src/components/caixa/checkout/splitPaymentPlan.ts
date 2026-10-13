/** UI-only allocation draft. Each confirmed portion is still a separate backend Pagamento. */
export type SplitPaymentMethod = 'dinheiro' | 'pix' | 'cartao_debito' | 'cartao_credito';

export type SplitPaymentPart = {
  id: number;
  metodo: SplitPaymentMethod | '';
  valor: number | '';
};

export const toCents = (value: number): number => Math.round(value * 100);

export function splitPlanStatus(parts: readonly SplitPaymentPart[], remainingBalance: number) {
  const cents = parts.reduce((sum, part) => sum + toCents(Number(part.valor || 0)), 0);
  const remainingCents = toCents(remainingBalance);
  const allValid = parts.length > 0 && parts.every(part =>
    Boolean(part.metodo) && part.valor !== '' &&
    Number.isFinite(part.valor) && Number(part.valor) > 0 &&
    Math.abs(Number(part.valor) * 100 - toCents(Number(part.valor))) < 0.0001
  );
  return {
    plannedCents: cents,
    differenceCents: remainingCents - cents,
    valid: allValid && remainingCents > 0 && cents === remainingCents,
  };
}
