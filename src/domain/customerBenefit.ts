/** API CRM returns a benefit object; older snapshots may contain display text. */
export function customerBenefitDescription(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    const summary = value as Record<string, unknown>;
    if (typeof summary.explicacao === 'string') return summary.explicacao;
    if (typeof summary.explicacao_regra === 'string') return summary.explicacao_regra;
  }
  return 'Confira as regras na aba Benefícios.';
}
