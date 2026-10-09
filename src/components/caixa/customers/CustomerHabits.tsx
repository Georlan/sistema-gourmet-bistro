import type { LoyaltyCustomer } from '../cashierContracts';
import { customerSegmentLabel } from '../../../domain/customerCrm';

const dateLabel = (value?: string | null) => {
  if (!value) return 'Sem compra identificada';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Data indisponível' : date.toLocaleDateString('pt-BR');
};

export function CustomerHabits({ customer }: { customer: LoyaltyCustomer }) {
  return (
    <details className="mt-2 text-xs font-normal">
      <summary className="min-h-11 cursor-pointer py-3 text-emerald-700 dark:text-emerald-300">Ver hábitos de {customer.cliente}</summary>
      <dl className="space-y-2 rounded-lg border border-koma-border bg-koma-panel p-3 text-koma-foreground">
        <div><dt className="text-koma-muted">Primeira compra</dt><dd>{dateLabel(customer.primeira_compra_em)}</dd></div>
        <div><dt className="text-koma-muted">Última compra</dt><dd>{dateLabel(customer.ultima_compra_em)} · {customerSegmentLabel(customer)}</dd></div>
        <div><dt className="text-koma-muted">Intervalo médio entre compras</dt><dd>{customer.intervalo_medio_dias == null ? 'Precisa de pelo menos 2 compras com data' : `${customer.intervalo_medio_dias.toLocaleString('pt-BR')} dias`}</dd></div>
        <div><dt className="text-koma-muted">Preferências identificadas</dt><dd className="break-words">{customer.produtos_favoritos?.length ? customer.produtos_favoritos.map(item => `${item.nome} (${item.unidades} un.)`).join(' · ') : 'Ainda não há itens identificados'}</dd></div>
      </dl>
      <p className="mt-2 max-w-72 text-koma-muted">Todo o histórico de compras concluídas identificadas nesta loja. O intervalo é uma média, não uma previsão de retorno.</p>
    </details>
  );
}
