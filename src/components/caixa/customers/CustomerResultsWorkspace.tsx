import React, { useMemo } from 'react';
import { RefreshCw } from 'lucide-react';

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
  value == null ? '—' : value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const count = (value?: number | null) =>
  value == null ? '—' : value.toLocaleString('pt-BR');
const objectiveNames: Record<string, string> = {
  SECOND_PURCHASE: 'Incentivar a 2ª compra',
  CADENCE_RECOVERY: 'Recuperar frequência',
  BENEFIT_REMINDER: 'Lembrar benefício',
  VIP_RECOGNITION: 'Reconhecer cliente frequente',
  OCCURRENCE_RECOVERY: 'Retomar relacionamento',
  CUSTOM: 'Ação personalizada',
};
const approachNames: Record<string, string> = {
  SEM_DESCONTO: 'Sem desconto', CUPOM: 'Com cupom', FIDELIDADE: 'Fidelidade',
};


function CampaignEvidence({ camp }: { camp: any }) {
  return (
    <div className="space-y-2 text-xs text-koma-muted">
      <p>Abordagem: {approachNames[camp.abordagem_tipo] || 'Não informada'}{camp.cupom_codigo ? ' · Cupom ' + camp.cupom_codigo : ''}</p>
      <p>Janela histórica da campanha: {camp.janela_atribuicao_dias ?? '—'} dias. O seletor geral não modifica este valor.</p>
      <p>Contatos confirmados: {count(camp.clientes_abordados)}. Registro manual não comprova entrega no WhatsApp.</p>
      <p>Clientes que compraram após contato: {camp.clientes_abordados > 0 ? count(camp.clientes_que_voltaram) : 'Não medido — sem contato confirmado'}.</p>
      <p>Usos de cupom vinculado: {count(camp.pedidos_comprovados_cupom)} · {count(camp.cupons_sem_contato_confirmado)} sem contato confirmado.</p>
      <p>Compras por associação temporal: {count(camp.pedidos_estimados_janela)}. Não comprova causalidade.</p>
      <p>Valor líquido associado: {money(camp.valor_pago_liquido_brl)} (não é lucro). Descontos nessas compras: {money(camp.desconto_utilizado_brl)} (não são necessariamente custo incremental).</p>
    </div>
  );
}

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
  const segundaCompra = res?.conversao_segunda_compra;
  const retorno = res?.retorno_apos_abordagem;
  const pedidos = res?.pedidos_associados;
  const descontos = res?.descontos_efetivamente_utilizados;
  const valores = res?.valor_pago_pedidos_associados;
  const campanhas: any[] = crmSummary?.campanhas || [];

  const isMeasured = retorno?.status_mensuracao === 'MENSURADO';
  const hasAssociations = valores?.status_mensuracao === 'MENSURADO';
  // The backend counts customers per observed event-date. No aggregated total
  // is spread across invented time points. Bucketing is presentation only.
  const daily = res?.serie_temporal;
  const temporalSeries = useMemo(() => {
    const rows = (Array.isArray(daily) ? daily : [])
      .filter((item: any) => typeof item.data === 'string' && /^\\d{4}-\\d{2}-\\d{2}$/.test(item.data))
      .sort((a: any, b: any) => a.data.localeCompare(b.data));
    if (!rows.length) return [] as { key: number; label: string; contacts: number; returns: number }[];
    const start = Date.parse(rows[0].data + 'T00:00:00Z');
    const groupDays = periodoDias <= 7 ? 1 : periodoDias <= 30 ? 3 : 7;
    const byDate = new Map<number, { key: number; label: string; contacts: number; returns: number }>();
    for (const item of rows) {
      const date = Date.parse(item.data + 'T00:00:00Z');
      if (!Number.isFinite(date)) continue;
      const key = Math.floor((date - start) / (groupDays * 86400000));
      const previous = byDate.get(key);
      if (previous) {
        previous.contacts += Number(item.clientes_contatados || 0);
        previous.returns += Number(item.clientes_que_voltaram || 0);
      } else {
        byDate.set(key, {
          key,
          label: new Date(start + key * groupDays * 86400000).toLocaleDateString('pt-BR', {day: '2-digit', month: '2-digit', timeZone: 'UTC'}),
          contacts: Number(item.clientes_contatados || 0),
          returns: Number(item.clientes_que_voltaram || 0),
        });
      }
    }
    return Array.from(byDate.values()).sort((a, b) => a.key - b.key);
  }, [daily, periodoDias]);
  const maxEvent = Math.max(1, ...temporalSeries.flatMap(item => [item.contacts, item.returns]));
  const totalEvidence = Math.max(0, Number(pedidos?.comprovados_por_cupom || 0) + Number(pedidos?.estimados_por_janela_temporal || 0));

  return (
    <div className="space-y-4 text-left animate-fade-in">
      {/* Barra de Período, Janela e Metodologia */}
      <div className="flex flex-col gap-3 py-1 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h3 className="text-lg font-bold text-koma-foreground">
            Quantos clientes voltaram e quanto compraram?
          </h3>
        </div>

        <div className="flex flex-wrap items-end gap-2 sm:gap-3">
          <label className="flex min-w-[9rem] flex-1 flex-col gap-1 text-sm font-medium text-koma-muted">
            Período analisado
            <select
              aria-label="Período analisado nos resultados"
              value={periodoDias}
              onChange={(e) => onChangePeriodo(Number(e.target.value))}
              className="min-h-10 rounded-xl border border-koma-border bg-koma-panel px-3 py-2 text-sm font-medium text-koma-foreground"
            >
              <option value={7}>Últimos 7 dias</option>
              <option value={30}>Últimos 30 dias</option>
              <option value={60}>Últimos 60 dias</option>
              <option value={90}>Últimos 90 dias</option>
            </select>
          </label>

          <label className="flex min-w-[9rem] flex-1 flex-col gap-1 text-sm font-medium text-koma-muted">
            Janela geral (sem campanha)
            <select
              aria-label="Janela de atribuição pós-abordagem"
              value={janelaDias}
              onChange={(e) => onChangeJanela(Number(e.target.value))}
              className="min-h-10 rounded-xl border border-koma-border bg-koma-panel px-3 py-2 text-sm font-medium text-koma-foreground"
            >
              <option value={7}>Até 7 dias após contato</option>
              <option value={14}>Até 14 dias após contato</option>
              <option value={30}>Até 30 dias após contato</option>
            </select>
          </label>

          <button
            type="button"
            onClick={onRefresh}
            className="koma-btn-secondary inline-flex min-h-10 items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium"
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

      {loading && <p role="status" className="text-sm text-koma-muted">Atualizando resultados…</p>}
      <div className="grid gap-3 lg:grid-cols-2">
        <article className="rounded-xl border border-koma-border bg-koma-panel p-4 space-y-2.5">
          <h4 className="text-sm font-bold text-koma-muted">Clientes que voltaram</h4>
          <strong className="block text-3xl font-black text-emerald-400">{isMeasured ? retorno.clientes_que_voltaram : '—'}</strong>
          {isMeasured ? <>
            <p className="text-sm text-koma-muted">De {retorno.clientes_abordados_no_periodo} clientes com contato manual confirmado</p>
            <div role="img" aria-label={`${retorno.clientes_que_voltaram} de ${retorno.clientes_abordados_no_periodo} clientes voltaram`} className="h-3 overflow-hidden rounded-full bg-koma-raised">
              <div className="h-full rounded-full bg-emerald-500" style={{width: `${retorno.clientes_abordados_no_periodo > 0 ? Math.min(100, Math.max(0, retorno.clientes_que_voltaram / retorno.clientes_abordados_no_periodo * 100)) : 0}%`}} />
            </div>
          </> : <p className="text-sm text-koma-muted">Não medido: confirme contatos na aba Campanhas para acompanhar retornos.</p>}
        </article>
        <article className="rounded-xl border border-koma-border bg-koma-panel p-4 space-y-2.5">
          <h4 className="text-sm font-bold text-koma-muted">Valor líquido de compras associadas</h4>
          <strong className="block text-3xl font-black text-emerald-400">{hasAssociations ? money(valores.total_liquido_brl) : '—'}</strong>
          {hasAssociations ? <>
            <p className="text-sm text-koma-muted">{pedidos?.total ?? '—'} compras associadas (inclui cupom sem contato confirmado)</p>
            <p className="text-xs text-koma-muted">Cupom vinculado: {money(valores.comprovado_cupom_brl)} · Associação temporal: {money(valores.estimado_temporal_brl)}</p>
          </> : <p className="text-sm text-koma-muted">Ainda sem dados de compras após contatos.</p>}
          <p className="text-xs text-koma-muted">Compras associadas por cupom ou por contato; não representam lucro, causalidade ou vendas incrementais comprovadas.</p>
        </article>
      </div>
      <section aria-label="Evolução observada" className="rounded-xl border border-koma-border bg-koma-panel p-4 space-y-3">
        <h4 className="text-sm font-bold text-koma-foreground">Evolução de contatos confirmados e retornos observados</h4>
        <p className="text-xs text-koma-muted">Eventos reais por data: contagem de cliente/dia. Ao agrupar dias, uma pessoa pode aparecer em mais de um dia; não equivale ao total de clientes únicos.</p>
        {temporalSeries.length > 0 ? <>
          <div className="flex flex-wrap gap-3 text-xs text-koma-muted">
            <span><span className="mr-1 inline-block h-2 w-3 rounded bg-emerald-500" />Contatos manuais</span>
            <span><span className="mr-1 inline-block h-2 w-3 rounded bg-sky-500" />Clientes com compras posteriores</span>
          </div>
          <div className="overflow-x-auto">
            <div className="flex min-w-[420px] items-end gap-1.5" role="img" aria-label="Evolução de registros por datas verificadas. Os números estão na tabela acessível abaixo.">
              {temporalSeries.map(point => <div key={point.key} className="min-w-0 flex-1 text-center" title={point.label + ': ' + point.contacts + ' contatos, ' + point.returns + ' retornos'}>
                <div className="flex h-28 items-end justify-center gap-1 border-b border-koma-border">
                  <div className="w-2 max-w-[35%] bg-emerald-500 rounded-t-sm" style={{height: (point.contacts / maxEvent * 100) + '%'}} />
                  <div className="w-2 max-w-[35%] bg-sky-500 rounded-t-sm" style={{height: (point.returns / maxEvent * 100) + '%'}} />
                </div>
                <span className="block mt-1 text-[10px] text-koma-muted">{point.label}</span>
              </div>)}
            </div>
          </div>
          <details className="text-xs text-koma-muted"><summary className="min-h-10 cursor-pointer py-2">Consultar números do gráfico</summary>
            <table className="w-full text-left"><thead><tr><th>Data inicial</th><th>Contatos</th><th>Retornos observados</th></tr></thead>
              <tbody>{temporalSeries.map(point => <tr key={point.key}><td>{point.label}</td><td>{point.contacts}</td><td>{point.returns}</td></tr>)}</tbody>
            </table>
          </details>
        </> : <p className="text-sm text-koma-muted">Sem eventos datados disponíveis para o gráfico. Não estimamos séries a partir de totais.</p>}
      </section>
      <section aria-label="Compras por evidência" className="rounded-xl border border-koma-border bg-koma-panel p-4 space-y-3">
        <h4 className="text-sm font-bold text-koma-foreground">Compras associadas por evidência</h4>
        {hasAssociations ? <>
          <div role="img" aria-label={String(pedidos?.comprovados_por_cupom || 0) + ' compras com cupom e ' + String(pedidos?.estimados_por_janela_temporal || 0) + ' compras associadas por data'} className="flex h-3 overflow-hidden rounded-full bg-koma-raised">
            <div className="bg-emerald-500" style={{width: (totalEvidence ? Number(pedidos?.comprovados_por_cupom || 0) / totalEvidence * 100 : 0) + '%'}} />
            <div className="bg-sky-500" style={{width: (totalEvidence ? Number(pedidos?.estimados_por_janela_temporal || 0) / totalEvidence * 100 : 0) + '%'}} />
          </div>
          <p className="text-xs text-koma-muted">{count(pedidos?.comprovados_por_cupom)} usos de cupom vinculado (destes, {count(pedidos?.cupons_sem_contato_confirmado)} sem contato confirmado) · {count(pedidos?.estimados_por_janela_temporal)} associações temporais. Nenhuma compra é contada duas vezes.</p>
        </> : <p className="text-sm text-koma-muted">Não medido: não há evidência de compras associadas.</p>}
      </section>
      <div className="grid gap-3 sm:grid-cols-2">
        <article className="rounded-xl border border-koma-border bg-koma-panel p-4">
          <h4 className="text-xs font-bold text-koma-muted">Clientes com 2 ou mais compras · histórico total</h4>
          <strong className="block mt-2 text-xl">{segundaCompra ? segundaCompra.clientes_que_fizeram_segunda_compra : '—'}</strong>
          <p className="text-xs text-koma-muted">{segundaCompra ? `De ${segundaCompra.clientes_com_1_compra_base} clientes com compra em todo o histórico; não é conversão do período.` : 'Ainda sem dados'}</p>
        </article>
        <article className="rounded-xl border border-koma-border bg-koma-panel p-4">
          <h4 className="text-xs font-bold text-koma-muted">Descontos em pedidos identificados do período</h4>
          <strong className="block mt-2 text-xl">{descontos ? money(descontos.total_brl) : '—'}</strong>
          <p className="text-xs text-koma-muted">Pedidos válidos com cliente identificado, inclusive fora de campanhas. Não é custo exclusivo das ações.</p>
        </article>
      </div>
      <details className="rounded-xl border border-koma-border bg-koma-panel p-3 text-sm text-koma-muted">
        <summary className="min-h-10 cursor-pointer py-2 font-semibold text-koma-foreground focus-visible:outline-2 focus-visible:outline-emerald-500">Como calculamos os resultados</summary>
        <div className="mt-3 space-y-2">
          <p>{res?.regra_janelas?.explicacao || 'Campanhas usam a janela originalmente salva; a janela geral aplica-se somente a contatos sem campanha.'}</p>
          <p>{res?.regra_associacao || 'Cada pedido válido pode ser vinculado a no máximo uma evidência; cupom não prova contato.'}</p>
          <p>{res?.aviso_metodologico || 'Compras após contato sem cupom são associações por período, não comprovam que a campanha causou a venda.'}</p>
          {isMeasured && <p>Clientes que voltaram: {retorno.clientes_retorno_comprovado_cupom} com cupom · {retorno.clientes_retorno_estimado_temporal} por período após contato.</p>}
          {segundaCompra?.explicacao && <p>{segundaCompra.explicacao}</p>}
          {descontos && <p>Descontos em cupons: {money(descontos.cupom_brl)} · Fidelidade: {money(descontos.fidelidade_cashback_brl)}</p>}
        </div>
      </details>

      <section aria-label="Resultados por campanha" className="rounded-xl border border-koma-border bg-koma-panel p-4 space-y-3">
        <h4 className="text-sm font-semibold text-koma-foreground">Resultados por campanha ({campanhas.length})</h4>
        {campanhas.length === 0 ? (
          <p className="text-sm text-koma-muted">Nenhuma campanha registrada ainda. Inicie uma ação a partir das abas Hoje ou Campanhas.</p>
        ) : <>
          <div className="hidden md:block overflow-x-auto rounded-xl border border-koma-border">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-koma-border bg-koma-raised text-xs text-koma-muted">
                <tr><th className="p-3">Campanha</th><th className="p-3">Contatados</th><th className="p-3">Retornaram</th><th className="p-3">Valor associado</th></tr>
              </thead>
              <tbody className="divide-y divide-koma-border">{campanhas.map(camp =>
                <tr key={camp.id} className="align-top">
                  <td className="p-3">
                    <details><summary className="min-h-10 cursor-pointer font-semibold text-koma-foreground focus-visible:outline-2 focus-visible:outline-emerald-500">
                      {camp.nome}
                      <span className="mt-1 block font-normal text-xs text-koma-muted">{objectiveNames[camp.objetivo] || 'Ação personalizada'}</span>
                    </summary><div className="mt-3 max-w-lg"><CampaignEvidence camp={camp} /></div></details>
                  </td>
                  <td className="p-3 tabular-nums">{count(camp.clientes_abordados)}</td>
                  <td className="p-3 tabular-nums">{camp.clientes_abordados > 0 ? count(camp.clientes_que_voltaram) : 'Não medido'}</td>
                  <td className="p-3 tabular-nums font-semibold">{money(camp.valor_pago_liquido_brl)}</td>
                </tr>
              )}</tbody>
            </table>
          </div>
          <div className="grid gap-2 md:hidden">
            {campanhas.map(camp => <details key={camp.id}
              className="rounded-xl border border-koma-border bg-koma-card p-3 text-sm">
              <summary className="min-h-10 cursor-pointer font-semibold text-koma-foreground focus-visible:outline-2 focus-visible:outline-emerald-500">
                {camp.nome}
                <span className="mt-1 block font-normal text-xs text-koma-muted">
                  {count(camp.clientes_abordados)} contatos · {camp.clientes_abordados > 0 ? count(camp.clientes_que_voltaram) + ' retornaram' : 'Retorno não medido'} · {money(camp.valor_pago_liquido_brl)}
                </span>
              </summary>
              <div className="mt-3"><CampaignEvidence camp={camp} /></div>
            </details>)}
          </div>
        </>}
      </section>
    </div>
  );
}
