import React, { useState } from 'react';
import { Calculator, Check, Loader2, ShieldCheck, TrendingUp } from 'lucide-react';

export interface GrowthEconomicsOption {
  key: 'conservative' | 'balanced' | 'limit' | string;
  label: string;
  incentive_percent: number;
  estimated_margin_after_incentive_percent: number;
  estimated_contribution_per_average_order: number;
  break_even_order_volume_lift_percent: number;
  coupon: {
    percentage_discount: number;
    fixed_discount_on_average_ticket: number;
    suggested_minimum_order_for_fixed_discount: number;
  };
  cashback: {
    earn_percent: number;
    suggested_max_redemption_percent_per_order: number;
    worst_case_redemption_assumption_percent: number;
  };
  loyalty_points: {
    points_per_real: number;
    suggested_point_value_brl: number;
    effective_reward_percent: number;
  };
  preserves_minimum_margin: boolean;
}

interface GrowthEconomicsResponse {
  inputs: {
    average_ticket: number;
    variable_cost_percent_excluding_koma: number;
    minimum_margin_percent: number;
  };
  economics: {
    koma_fee_percent: number;
    koma_revenue_per_average_order: number;
    contribution_margin_before_incentive_percent: number;
    contribution_before_incentive_per_average_order: number;
    safe_incentive_ceiling_percent: number;
    safe_incentive_ceiling_on_average_order: number;
  };
  options: GrowthEconomicsOption[];
  warnings: string[];
  assumptions: string[];
}

interface GrowthEconomicsCalculatorProps {
  apiBaseUrl: string;
  authHeaders: Record<string, string>;
  onApplyOption?: (option: GrowthEconomicsOption) => void;
  applyLabel?: string;
  compact?: boolean;
}

const currency = (value: number) => new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
}).format(Number(value || 0));

const number = (value: number, maximumFractionDigits = 2) => new Intl.NumberFormat('pt-BR', {
  maximumFractionDigits,
}).format(Number(value || 0));

export default function GrowthEconomicsCalculator({
  apiBaseUrl,
  authHeaders,
  onApplyOption,
  applyLabel = 'Usar sugestão',
  compact = false,
}: GrowthEconomicsCalculatorProps) {
  const [averageTicket, setAverageTicket] = useState('');
  const [variableCostPercent, setVariableCostPercent] = useState('');
  const [minimumMarginPercent, setMinimumMarginPercent] = useState('');
  const [result, setResult] = useState<GrowthEconomicsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [appliedKey, setAppliedKey] = useState('');

  const calculate = async () => {
    const ticket = Number(averageTicket);
    const costs = Number(variableCostPercent);
    const margin = Number(minimumMarginPercent);

    if (!Number.isFinite(ticket) || ticket <= 0 || !Number.isFinite(costs) || costs < 0 || !Number.isFinite(margin) || margin <= 0) {
      setError('Informe ticket médio, custos variáveis e margem mínima para calcular.');
      return;
    }

    setLoading(true);
    setError('');
    setAppliedKey('');
    try {
      const response = await fetch(`${apiBaseUrl}/caixa/cupons/economia/recomendacao`, {
        method: 'POST',
        headers: {
          ...authHeaders,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          average_ticket: ticket,
          variable_cost_percent: costs,
          minimum_margin_percent: margin,
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        const detail = payload && typeof payload.detail === 'string' ? payload.detail : 'Não foi possível calcular agora.';
        throw new Error(detail);
      }
      setResult(payload as GrowthEconomicsResponse);
    } catch (calculateError) {
      setResult(null);
      setError(calculateError instanceof Error ? calculateError.message : 'Não foi possível calcular agora.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <section
      className={`rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.05] ${compact ? 'p-3' : 'p-4'}`}
      id="growth-economics-calculator"
    >
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-emerald-500/10 text-emerald-400">
          <Calculator className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <h4 className="text-xs font-black text-koma-foreground">Calculadora de incentivo KÔMA</h4>
          <p className="mt-1 text-[10px] leading-relaxed text-koma-muted">
            Informe seus números. O KÔMA calcula opções que preservam a margem mínima; você continua livre para editar manualmente.
          </p>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
        <label className="text-[10px] font-bold text-koma-muted">
          Ticket médio (R$)
          <input
            aria-label="Ticket médio"
            type="number"
            min="0.01"
            step="0.01"
            value={averageTicket}
            onChange={(event) => setAverageTicket(event.target.value)}
            placeholder="Ex.: 65,00"
            className="mt-1 w-full rounded-xl border border-koma-border bg-koma-card px-3 py-2 text-xs text-koma-foreground outline-none focus:border-emerald-500"
          />
        </label>
        <label className="text-[10px] font-bold text-koma-muted">
          Custos variáveis (%)
          <input
            aria-label="Custos variáveis"
            type="number"
            min="0"
            max="99.99"
            step="0.01"
            value={variableCostPercent}
            onChange={(event) => setVariableCostPercent(event.target.value)}
            placeholder="CMV + taxas + impostos"
            className="mt-1 w-full rounded-xl border border-koma-border bg-koma-card px-3 py-2 text-xs text-koma-foreground outline-none focus:border-emerald-500"
          />
        </label>
        <label className="text-[10px] font-bold text-koma-muted">
          Margem mínima (%)
          <input
            aria-label="Margem mínima"
            type="number"
            min="0.01"
            max="99.99"
            step="0.01"
            value={minimumMarginPercent}
            onChange={(event) => setMinimumMarginPercent(event.target.value)}
            placeholder="Quanto quer preservar"
            className="mt-1 w-full rounded-xl border border-koma-border bg-koma-card px-3 py-2 text-xs text-koma-foreground outline-none focus:border-emerald-500"
          />
        </label>
      </div>

      <p className="mt-2 text-[9px] leading-relaxed text-koma-subtle">
        Custos variáveis: informe CMV, embalagem, taxa do pagamento, impostos e outros custos que crescem com a venda. Não inclua a taxa KÔMA: ela entra automaticamente conforme seu plano.
      </p>

      <button
        type="button"
        onClick={() => void calculate()}
        disabled={loading}
        className="mt-3 inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 py-2 text-[11px] font-black text-white transition hover:bg-emerald-400 disabled:opacity-60"
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Calculator className="h-4 w-4" />}
        {loading ? 'Calculando…' : 'Calcular opções'}
      </button>

      {error && (
        <p className="mt-3 rounded-xl border border-rose-500/20 bg-rose-500/10 p-3 text-[10px] leading-relaxed text-rose-300" role="alert">
          {error}
        </p>
      )}

      {result && (
        <div className="mt-4 space-y-3" id="growth-economics-result">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="rounded-xl border border-koma-border bg-koma-card p-2.5">
              <p className="text-[8px] font-black uppercase tracking-wide text-koma-subtle">Split KÔMA</p>
              <p className="mt-1 text-sm font-black text-koma-foreground">{number(result.economics.koma_fee_percent)}%</p>
            </div>
            <div className="rounded-xl border border-koma-border bg-koma-card p-2.5">
              <p className="text-[8px] font-black uppercase tracking-wide text-koma-subtle">Margem antes</p>
              <p className="mt-1 text-sm font-black text-koma-foreground">{number(result.economics.contribution_margin_before_incentive_percent)}%</p>
            </div>
            <div className="rounded-xl border border-koma-border bg-koma-card p-2.5">
              <p className="text-[8px] font-black uppercase tracking-wide text-koma-subtle">Teto calculado</p>
              <p className="mt-1 text-sm font-black text-emerald-400">{number(result.economics.safe_incentive_ceiling_percent)}%</p>
            </div>
            <div className="rounded-xl border border-koma-border bg-koma-card p-2.5">
              <p className="text-[8px] font-black uppercase tracking-wide text-koma-subtle">KÔMA / pedido</p>
              <p className="mt-1 text-sm font-black text-koma-foreground">{currency(result.economics.koma_revenue_per_average_order)}</p>
            </div>
          </div>

          {result.warnings.length > 0 && (
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-[10px] leading-relaxed text-amber-300">
              {result.warnings.map((warning) => <p key={warning}>{warning}</p>)}
            </div>
          )}

          {result.options.length > 0 && (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {result.options.map((option) => (
                <article key={option.key} className="rounded-xl border border-koma-border bg-koma-card p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[10px] font-black text-koma-foreground">{option.label}</p>
                    {option.preserves_minimum_margin && <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" aria-label="Preserva margem" />}
                  </div>
                  <p className="mt-2 text-xl font-black tracking-tight text-emerald-400">{number(option.incentive_percent)}%</p>
                  <div className="mt-2 space-y-1 text-[9px] leading-relaxed text-koma-muted">
                    <p>Margem estimada depois: <strong className="text-koma-secondary">{number(option.estimated_margin_after_incentive_percent)}%</strong></p>
                    <p>Contribuição no ticket médio: <strong className="text-koma-secondary">{currency(option.estimated_contribution_per_average_order)}</strong></p>
                    <p className="inline-flex items-center gap-1"><TrendingUp className="h-3 w-3" /> Para se pagar: +{number(option.break_even_order_volume_lift_percent)}% em volume.</p>
                  </div>
                  {onApplyOption && (
                    <button
                      type="button"
                      onClick={() => {
                        onApplyOption(option);
                        setAppliedKey(option.key);
                      }}
                      className="mt-3 inline-flex min-h-9 w-full items-center justify-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2 text-[9px] font-black text-emerald-300 transition hover:bg-emerald-500/20"
                    >
                      {appliedKey === option.key && <Check className="h-3 w-3" />}
                      {appliedKey === option.key ? 'Aplicado ao formulário' : applyLabel}
                    </button>
                  )}
                </article>
              ))}
            </div>
          )}

          <p className="text-[9px] leading-relaxed text-koma-subtle">
            Estimativa econômica: não presume aumento de conversão ou frequência. Cashback é tratado como se 100% do crédito fosse resgatado. Ajuste os números sempre que seus custos mudarem.
          </p>
        </div>
      )}
    </section>
  );
}
