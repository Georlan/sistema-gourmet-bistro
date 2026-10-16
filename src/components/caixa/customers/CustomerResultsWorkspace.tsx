import React from 'react';
import {
  AlertCircle,
  BarChart3,
  CheckCircle2,
  Clock,
  RefreshCw,
  ShieldAlert,
  Ticket,
  TrendingUp,
  Users,
} from 'lucide-react';

interface Props {
  crmSummary: any | null;
  loading: boolean;
  error: string | null;
  periodoDias: number;
  janelaDias: number;
  onChangePeriodo: (dias: number) => void;
  onChangeJanela: (dias: number) => void;
  onRefresh: () => void;
}

const money = (value?: number | null) =>
  (value ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export function CustomerResultsWorkspace({
  crmSummary,
  loading,
  error,
  periodoDias,
  janelaDias,
  onChangePeriodo,
  onChangeJanela,
  onRefresh,
}: Props) {
  const res = crmSummary?.resultados;
  const segundaCompra = res?.segunda_compra;
  const retorno = res?.retorno_apos_abordagem;
  const pedidos = res?.pedidos_associados;
  const descontos = res?.descontos_utilizados;
  const campanhas: any[] = res?.campanhas || [];

  const isMeasured = retorno?.status_mensuracao === 'MENSURADO';

  return (
    <div className="space-y-4 text-left animate-fade-in">
      {/* Barra de Período, Janela e Metodologia */}
      <div className="rounded-2xl border border-koma-border bg-koma-card p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="space-y-1">
          <span className="text-[10px] font-extrabold uppercase tracking-wider text-emerald-400">
            5. Resultados e atribuição honesta
          </span>
          <h3 className="text-sm font-black text-koma-foreground">
            O cliente voltou? Qual resultado consigo comprovar?
          </h3>
          <p className="text-xs text-koma-muted">
            Cada pedido concluído é atribuído a no máximo 1 campanha/contato. Cancelamentos e estornos são excluídos.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <label className="flex flex-col gap-1 text-[10px] font-bold uppercase tracking-wider text-koma-muted">
            Período analisado
            <select
              aria-label="Período analisado nos resultados"
              value={periodoDias}
              onChange={(e) => onChangePeriodo(Number(e.target.value))}
              className="rounded-xl border border-koma-border bg-koma-panel px-3 py-2 text-xs font-semibold text-koma-foreground"
            >
              <option value={7}>Últimos 7 dias</option>
              <option value={30}>Últimos 30 dias</option>
              <option value={60}>Últimos 60 dias</option>
              <option value={90}>Últimos 90 dias</option>
            </select>
          </label>

          <label className="flex flex-col gap-1 text-[10px] font-bold uppercase tracking-wider text-koma-muted">
            Janela pós-abordagem
            <select
              aria-label="Janela de atribuição pós-abordagem"
              value={janelaDias}
              onChange={(e) => onChangeJanela(Number(e.target.value))}
              className="rounded-xl border border-koma-border bg-koma-panel px-3 py-2 text-xs font-semibold text-koma-foreground"
            >
              <option value={7}>Até 7 dias após contato</option>
              <option value={14}>Até 14 dias após contato</option>
              <option value={30}>Até 30 dias após contato</option>
            </select>
          </label>

          <button
            type="button"
            onClick={onRefresh}
            className="koma-btn-secondary mt-4 inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Atualizar
          </button>
        </div>
      </div>

      {error && (
        <div role="alert" className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-4 text-xs text-rose-200">
          {error}{' '}
          <button type="button" onClick={onRefresh} className="underline font-bold">
            Tentar novamente
          </button>
        </div>
      )}

      {/* 5 Indicadores Essenciais de Decisão */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {/* 1. Clientes que fizeram a 2ª compra */}
        <article className="rounded-2xl border border-koma-border bg-koma-panel p-4 space-y-1.5">
          <span className="text-[10px] font-bold uppercase tracking-wider text-koma-muted">
            1. Fizeram a 2ª compra
          </span>
          <strong className="block font-mono text-xl font-black text-koma-foreground">
            {segundaCompra ? segundaCompra.clientes_que_fizeram_segunda_compra : '—'}
            {segundaCompra?.denominador_clientes_com_compra > 0 && (
              <span className="ml-1.5 text-xs font-normal text-koma-muted">
                de {segundaCompra.denominador_clientes_com_compra} ({segundaCompra.taxa_conversao_pct}%)
              </span>
            )}
          </strong>
          <p className="text-[11px] text-koma-muted leading-snug">
            {segundaCompra?.explicacao || 'Clientes com 2 ou mais compras concluídas sobre o total com compra.'}
          </p>
        </article>

        {/* 2. Clientes que voltaram após a abordagem */}
        <article className="rounded-2xl border border-koma-border bg-koma-panel p-4 space-y-1.5">
          <span className="text-[10px] font-bold uppercase tracking-wider text-koma-muted">
            2. Voltaram após abordagem
          </span>
          {isMeasured ? (
            <>
              <strong className="block font-mono text-xl font-black text-emerald-400">
                {retorno.clientes_que_voltaram}{' '}
                <span className="text-xs font-normal text-koma-muted">
                  de {retorno.clientes_abordados_no_periodo} abordados
                </span>
              </strong>
              <p className="text-[11px] text-koma-muted leading-snug">
                <strong>{retorno.clientes_comprovados_por_cupom}</strong> comprovado(s) por cupom ·{' '}
                <strong>{retorno.clientes_estimados_janela_temporal}</strong> estimado(s) na janela de {janelaDias}d.
              </p>
            </>
          ) : (
            <>
              <strong className="block font-mono text-base font-black text-amber-300">
                Não mensurado
              </strong>
              <p className="text-[11px] text-koma-muted leading-snug">
                {retorno?.explicacao || 'Nenhuma abordagem registrada no período para medir retorno.'}
              </p>
            </>
          )}
        </article>

        {/* 3. Pedidos associados à campanha */}
        <article className="rounded-2xl border border-koma-border bg-koma-panel p-4 space-y-1.5">
          <span className="text-[10px] font-bold uppercase tracking-wider text-koma-muted">
            3. Pedidos associados
          </span>
          {isMeasured ? (
            <>
              <strong className="block font-mono text-xl font-black text-koma-foreground">
                {pedidos?.total_pedidos ?? 0}
              </strong>
              <p className="text-[11px] text-koma-muted leading-snug">
                <strong>{pedidos?.pedidos_comprovados_por_cupom ?? 0}</strong> com cupom da ação ·{' '}
                <strong>{pedidos?.pedidos_estimados_janela_temporal ?? 0}</strong> por janela temporal (sem duplicar pedido).
              </p>
            </>
          ) : (
            <>
              <strong className="block font-mono text-base font-black text-amber-300">
                Não mensurado
              </strong>
              <p className="text-[11px] text-koma-muted leading-snug">
                Registre contatos em Campanhas para acompanhar pedidos posteriores.
              </p>
            </>
          )}
        </article>

        {/* 4. Valor líquido pago nesses pedidos */}
        <article className="rounded-2xl border border-koma-border bg-koma-panel p-4 space-y-1.5">
          <span className="text-[10px] font-bold uppercase tracking-wider text-koma-muted">
            4. Valor pago nos pedidos
          </span>
          {isMeasured ? (
            <>
              <strong className="block font-mono text-xl font-black text-emerald-400">
                {money(pedidos?.valor_pago_liquido_total)}
              </strong>
              <p className="text-[11px] text-koma-muted leading-snug">
                Cupom: {money(pedidos?.valor_pago_comprovado_cupom)} · Janela temporal:{' '}
                {money(pedidos?.valor_pago_estimado_janela)}.
              </p>
            </>
          ) : (
            <>
              <strong className="block font-mono text-base font-black text-amber-300">
                Não mensurado
              </strong>
              <p className="text-[11px] text-koma-muted leading-snug">
                Sem contatos registrados no período (não exibimos R$ 0,00 como substituto de dado ausente).
              </p>
            </>
          )}
        </article>

        {/* 5. Descontos efetivamente utilizados */}
        <article className="rounded-2xl border border-koma-border bg-koma-panel p-4 space-y-1.5">
          <span className="text-[10px] font-bold uppercase tracking-wider text-koma-muted">
            5. Descontos utilizados
          </span>
          <strong className="block font-mono text-xl font-black text-koma-foreground">
            {money(descontos?.total_desconto_com_cupom_no_periodo)}
          </strong>
          <p className="text-[11px] text-koma-muted leading-snug">
            Em ações de CRM: <strong>{money(descontos?.desconto_em_pedidos_associados_campanha)}</strong>. Apenas pedidos concluídos.
          </p>
        </article>
      </div>

      {/* Nota Metodológica e Transparência (Sem ROI Fictício) */}
      <div className="rounded-2xl border border-koma-border bg-koma-panel p-4 text-xs text-koma-muted space-y-1.5">
        <strong className="block text-koma-foreground">
          Critério de associação, denominador e leitura honesta dos números:
        </strong>
        <p>
          {res?.regra_associacao ||
            `Cada pedido concluído é vinculado a no máximo uma abordagem comercial dentro de ${janelaDias} dias após o contato.`}
        </p>
        <p className="text-amber-300/90">
          {res?.aviso_metodologico ||
            'Receita associada não comprova receita incremental. Faturamento dividido por desconto não é lucro nem ROI financeiro. Compras sem uso de cupom da campanha são exibidas separadamente como estimativa temporal.'}
        </p>
      </div>

      {/* Tabela de Acompanhamento por Campanha */}
      <section className="rounded-2xl border border-koma-border bg-koma-panel p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-extrabold uppercase tracking-wider text-koma-foreground">
            Desempenho observado por campanha registrada ({campanhas.length})
          </h4>
        </div>

        {campanhas.length === 0 ? (
          <p className="text-xs text-koma-muted">
            Nenhuma campanha registrada ainda. Inicie uma ação a partir da aba <strong>Oportunidades</strong> ou{' '}
            <strong>Campanhas</strong>.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-koma-border">
            <table className="w-full text-left text-xs">
              <thead className="bg-koma-raised border-b border-koma-border text-[10px] font-extrabold uppercase tracking-wider text-koma-muted">
                <tr>
                  <th className="p-3">Campanha / Objetivo</th>
                  <th className="p-3">Abordagem</th>
                  <th className="p-3">Contatos registrados</th>
                  <th className="p-3">Clientes que voltaram</th>
                  <th className="p-3">Pedidos (Cupom vs. Janela)</th>
                  <th className="p-3">Valor líquido pago</th>
                  <th className="p-3">Descontos usados</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-koma-border">
                {campanhas.map((camp) => (
                  <tr key={camp.id} className="hover:bg-koma-raised/50">
                    <td className="p-3">
                      <strong className="block text-koma-foreground">{camp.nome}</strong>
                      <span className="text-[10px] text-koma-muted">{camp.objetivo}</span>
                    </td>
                    <td className="p-3">
                      <span className="rounded-md bg-koma-raised px-2 py-0.5 font-mono text-[10px] text-koma-foreground">
                        {camp.tipo_abordagem}
                        {camp.cupom_codigo ? ` (${camp.cupom_codigo})` : ''}
                      </span>
                    </td>
                    <td className="p-3 font-mono text-koma-foreground">
                      {camp.contatos_registrados} / {camp.total_elegiveis}
                    </td>
                    <td className="p-3 font-mono text-koma-foreground">
                      {camp.contatos_registrados > 0 ? camp.clientes_que_voltaram : 'Não mensurado'}
                    </td>
                    <td className="p-3 font-mono text-koma-foreground">
                      {camp.contatos_registrados > 0 ? (
                        <span>
                          {camp.pedidos_associados} ({camp.pedidos_comprovados_cupom} cupom ·{' '}
                          {camp.pedidos_estimados_janela} janela)
                        </span>
                      ) : (
                        'Não mensurado'
                      )}
                    </td>
                    <td className="p-3 font-mono font-bold text-emerald-400">
                      {camp.contatos_registrados > 0 ? money(camp.valor_pago_associado) : 'Não mensurado'}
                    </td>
                    <td className="p-3 font-mono text-koma-foreground">
                      {money(camp.descontos_utilizados)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
