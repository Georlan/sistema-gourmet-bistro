import { useEffect, useRef, useState } from 'react';
import type { Tenant } from './superAdminTypes';
import { formatCurrency } from '../config/subscriptionPlans';
import { superAdminErrorMessage, superAdminFetch } from './superAdminApi';

const categories = {
  chatgpt: 'ChatGPT',
  database: 'Banco de dados',
  railway: 'Railway',
  tools: 'Outras ferramentas e domínio',
  taxes: 'Impostos e tarifas',
  other: 'Outros custos',
};
type Category = keyof typeof categories;
type Costs = Record<Category, string | null>;

type InvoiceBucket = { count: number; amount: string };
type Finance = {
  period: string;
  received: string;
  net_received?: string;
  outstanding: string;
  mrr_contracted?: string;
  mrr_by_plan?: Record<string, string>;
  received_by_channel?: Record<string, string>;
  received_by_source?: Record<string, string>;
  recurring_received_by_plan?: Record<string, string>;
  invoices?: {
    open: InvoiceBucket;
    overdue: InvoiceBucket;
    paid: InvoiceBucket;
    refunded: InvoiceBucket;
  };
  tenant_counts?: {
    total: number;
    paying: number;
    founders: number;
    trialing: number;
    onboarding: number;
    free_or_legacy: number;
    suspended: number;
  };
  arpa?: string | null;
  break_even_tenants?: number | null;
  fixed_costs?: string | null;
  variable_costs?: string | null;
  contribution_margin?: string | null;
  costs: Costs;
  known_costs: string;
  unknown_costs: Category[];
  recorded_result: string | null;
  coverage: string;
  cost_updated_at: string | null;
  tenants: { tenant_id: string; received: string; outstanding: string }[];
};

const planLabels: Record<string, string> = {
  pocket: 'Pocket',
  pro: 'Pro',
  premium: 'Premium',
  founders: 'Founders',
  other: 'Outros',
};

const channelLabels: Record<string, string> = {
  pix: 'Pix',
  credit_card: 'Cartão',
  account_money: 'Saldo MP',
  other: 'Outros',
};

const sourceLabels: Record<string, string> = {
  recurring_plans: 'Planos recorrentes',
  vip_onboarding: 'Implantação VIP',
  modules: 'Módulos adicionais',
  direct_pix_fees: 'Faturas Pix direto',
  other: 'Outros',
};

export function SuperAdminFinance({ tenants = [] }: { tenants?: Tenant[] }) {
  const [period, setPeriod] = useState(() =>
    new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Fortaleza', year: 'numeric', month: '2-digit' }).format(new Date()),
  );
  const [data, setData] = useState<Finance | null>(null);
  const [costs, setCosts] = useState<Partial<Costs>>({});
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const saving = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    setError('');
    setSaved(false);
    setReason('');
    superAdminFetch(`/api/super-admin/finance?period=${encodeURIComponent(period)}`, { signal: controller.signal })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.detail || 'Financeiro indisponível.');
        if (!controller.signal.aborted) {
          setData(body);
          setCosts(body.costs);
        }
      })
      .catch((err) => {
        if (!controller.signal.aborted) setError(superAdminErrorMessage(err));
      });
    return () => controller.abort();
  }, [period, refresh]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!data || saving.current || reason.trim().length < 3) return;
    saving.current = true;
    setBusy(true);
    setError('');
    setSaved(false);
    try {
      const normalized = Object.fromEntries(
        Object.keys(categories).map((key) => [key, costs[key as Category]?.trim() || null]),
      );
      const response = await superAdminFetch(`/api/super-admin/finance/costs/${period}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ costs: normalized, reason: reason.trim() }),
      });
      if (!response.ok) throw new Error('Não foi possível salvar. Confira os valores ou recarregue o mês.');
      const result = await response.json();
      const known = Object.values(result.costs as Costs).reduce<number>((sum, value) => sum + Number(value || 0), 0);
      const unknown = Object.keys(categories).filter((key) => result.costs[key] == null) as Category[];
      const net = Number(data.net_received ?? data.received);
      setCosts(result.costs);
      setData({
        ...data,
        costs: result.costs,
        known_costs: String(known),
        unknown_costs: unknown,
        recorded_result: unknown.length ? null : String(net - known),
      });
      setSaved(true);
      setReason('');
      setRefresh((value) => value + 1);
    } catch (err) {
      setError(superAdminErrorMessage(err));
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }

  return (
    <section className="space-y-4 rounded-xl border border-koma-border bg-koma-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">Financeiro KÔMA</h2>
          <p className="text-xs text-koma-muted">
            Recebimentos da empresa e custos do mês. Vendas dos restaurantes ficam fora desta conta.
          </p>
        </div>
        <div className="flex gap-2">
          <label className="text-xs">
            Mês
            <input
              aria-label="Mês financeiro"
              type="month"
              min="2000-01"
              max="2099-12"
              value={period}
              disabled={busy}
              onChange={(event) => {
                if (event.target.value) setPeriod(event.target.value);
              }}
              className="ml-2 min-h-11 rounded border border-koma-border bg-koma-page p-2"
            />
          </label>
          <button
            type="button"
            disabled={busy}
            onClick={() => setRefresh((value) => value + 1)}
            className="min-h-11 rounded border border-koma-border px-3 text-xs"
          >
            Atualizar financeiro
          </button>
        </div>
      </div>

      {error && (
        <p role="alert" className="text-sm text-rose-400">
          {error}
        </p>
      )}
      {!data && !error && <p role="status">Consultando faturas e custos…</p>}

      {data && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[
              ['MRR contratado', data.mrr_contracted != null ? formatCurrency(Number(data.mrr_contracted)) : 'Não calculado'],
              ['Recebido no mês', formatCurrency(Number(data.received))],
              ['Em aberto na competência', formatCurrency(Number(data.outstanding))],
              ['Custos informados', formatCurrency(Number(data.known_costs))],
              ['Resultado registrado', data.recorded_result === null ? 'Custos incompletos' : formatCurrency(Number(data.recorded_result))],
              ['Margem de contribuição', data.contribution_margin == null ? 'Custos variáveis incompletos' : formatCurrency(Number(data.contribution_margin))],
              ['ARPA (pagantes)', data.arpa == null ? 'Sem pagantes ativos' : formatCurrency(Number(data.arpa))],
              ['Ponto de equilíbrio', data.break_even_tenants == null ? 'Custos incompletos' : `${data.break_even_tenants} restaurantes`],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg border border-koma-border bg-koma-page p-4">
                <p className="text-xs text-koma-muted">{label}</p>
                <strong className="mt-2 block text-xl">{value}</strong>
              </div>
            ))}
          </div>

          <p className="text-xs text-koma-muted">{data.coverage}</p>

          {(data.tenant_counts || data.invoices || data.mrr_by_plan || data.received_by_channel) && (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {data.tenant_counts && (
                <div className="rounded-lg border border-koma-border bg-koma-page p-4 text-xs space-y-1">
                  <h3 className="font-bold text-sm mb-2">Base de restaurantes</h3>
                  <div className="flex justify-between"><span>Total</span><strong>{data.tenant_counts.total}</strong></div>
                  <div className="flex justify-between"><span>Pagantes ativos</span><strong>{data.tenant_counts.paying}</strong></div>
                  <div className="flex justify-between"><span>Founders</span><strong>{data.tenant_counts.founders}</strong></div>
                  <div className="flex justify-between"><span>Em teste (trial)</span><strong>{data.tenant_counts.trialing}</strong></div>
                  <div className="flex justify-between"><span>Onboarding</span><strong>{data.tenant_counts.onboarding}</strong></div>
                  <div className="flex justify-between"><span>Gratuitos / Legado</span><strong>{data.tenant_counts.free_or_legacy}</strong></div>
                  <div className="flex justify-between"><span>Suspensos / Cancelados</span><strong>{data.tenant_counts.suspended}</strong></div>
                </div>
              )}

              {data.mrr_by_plan && (
                <div className="rounded-lg border border-koma-border bg-koma-page p-4 text-xs space-y-1">
                  <h3 className="font-bold text-sm mb-2">MRR contratado por plano</h3>
                  {Object.entries(data.mrr_by_plan).map(([key, val]) => (
                    <div key={key} className="flex justify-between">
                      <span>{planLabels[key] || key}</span>
                      <strong>{formatCurrency(Number(val))}</strong>
                    </div>
                  ))}
                </div>
              )}

              {data.received_by_channel && data.received_by_source && (
                <div className="rounded-lg border border-koma-border bg-koma-page p-4 text-xs space-y-1">
                  <h3 className="font-bold text-sm mb-2">Recebido por canal e origem</h3>
                  {Object.entries(data.received_by_channel).map(([key, val]) => (
                    <div key={key} className="flex justify-between">
                      <span>{channelLabels[key] || key}</span>
                      <strong>{formatCurrency(Number(val))}</strong>
                    </div>
                  ))}
                  <div className="border-t border-koma-border my-1 pt-1" />
                  {Object.entries(data.received_by_source).map(([key, val]) => (
                    <div key={key} className="flex justify-between">
                      <span>{sourceLabels[key] || key}</span>
                      <strong>{formatCurrency(Number(val))}</strong>
                    </div>
                  ))}
                </div>
              )}

              {data.invoices && (
                <div className="rounded-lg border border-koma-border bg-koma-page p-4 text-xs space-y-1">
                  <h3 className="font-bold text-sm mb-2">Faturas da competência</h3>
                  <div className="flex justify-between"><span>Pagas ({data.invoices.paid.count})</span><strong>{formatCurrency(Number(data.invoices.paid.amount))}</strong></div>
                  <div className="flex justify-between"><span>Em aberto ({data.invoices.open.count})</span><strong>{formatCurrency(Number(data.invoices.open.amount))}</strong></div>
                  <div className="flex justify-between"><span>Em atraso ({data.invoices.overdue.count})</span><strong>{formatCurrency(Number(data.invoices.overdue.amount))}</strong></div>
                  <div className="flex justify-between"><span>Estornadas ({data.invoices.refunded.count})</span><strong>{formatCurrency(Number(data.invoices.refunded.amount))}</strong></div>
                </div>
              )}
            </div>
          )}

          <details>
            <summary className="cursor-pointer text-sm font-bold">Recebimentos e pendências por restaurante</summary>
            <div className="mt-3 overflow-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr>
                    <th>Restaurante</th>
                    <th>Recebido</th>
                    <th>Em aberto</th>
                  </tr>
                </thead>
                <tbody>
                  {data.tenants.map((row) => (
                    <tr key={row.tenant_id}>
                      <td className="py-2">
                        {tenants.find((tenant) => String(tenant.id) === String(row.tenant_id))?.name || `Restaurante #${row.tenant_id}`}
                      </td>
                      <td>{formatCurrency(Number(row.received))}</td>
                      <td>{formatCurrency(Number(row.outstanding))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>

          <form onSubmit={save} className="space-y-3 border-t border-koma-border pt-4">
            <h3 className="font-bold">Registrar custos em reais</h3>
            <p className="text-xs text-koma-muted">
              Deixe em branco quando não souber. Use 0 somente quando confirmar que não houve custo. Para contas em dólar, informe o valor efetivamente cobrado em reais; não usamos câmbio presumido.
            </p>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {Object.entries(categories).map(([key, label]) => (
                <label key={key} className="text-sm">
                  {label}
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    max="1000000"
                    aria-label={label}
                    placeholder="Não informado"
                    value={costs[key as Category] ?? ''}
                    disabled={busy}
                    onChange={(event) => {
                      setCosts((old) => ({ ...old, [key]: event.target.value || null }));
                      setSaved(false);
                    }}
                    className="mt-1 block min-h-11 w-full rounded border border-koma-border bg-koma-page p-2"
                  />
                </label>
              ))}
            </div>
            <label className="block text-sm">
              Motivo do registro
              <input
                aria-label="Motivo do registro"
                minLength={3}
                maxLength={1000}
                required
                value={reason}
                disabled={busy}
                onChange={(event) => setReason(event.target.value)}
                className="mt-1 block min-h-11 w-full rounded border border-koma-border bg-koma-page p-2"
                placeholder="Valores da fatura mensal, conferidos pelo proprietário"
              />
            </label>
            <button
              type="submit"
              disabled={busy || reason.trim().length < 3}
              className="min-h-11 rounded bg-emerald-700 px-4 text-sm font-bold text-white disabled:opacity-50"
            >
              {busy ? 'Salvando…' : 'Salvar custos do mês'}
            </button>
            {saved && (
              <p role="status" className="text-sm text-emerald-400">
                Custos salvos com responsável, motivo e histórico de alterações.
              </p>
            )}
          </form>
        </>
      )}
    </section>
  );
}
