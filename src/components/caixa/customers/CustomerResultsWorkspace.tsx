import { KomaMetricGroup } from '../../shared/KomaMetricGroup';
import { KomaEmptyState } from '../../shared/KomaEmptyState';
import React, { useMemo } from 'react';
import { RefreshCw, Users, Repeat2, Wallet, Ticket, ArrowRight, MessageCircle, ChartNoAxesCombined } from 'lucide-react';

interface Props {
  crmSummary: any | null;
  loading: boolean;
  error: string | null;
  periodoDias: number;
  janelaDias: number;
  onChangePeriodo: (dias: number) => void;
  onChangeJanela: (dias: number) => void;
  onRefresh: () => void;
  onOpenCampaigns: () => void;
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
    <div className="space-y-3 text-xs text-koma-muted">
      <div className="flex flex-wrap gap-2"><span className="rounded-md bg-koma-raised px-2 py-1">{approachNames[camp.abordagem_tipo] || 'Não informada'}</span><span className="rounded-md bg-koma-raised px-2 py-1">Janela: {camp.janela_atribuicao_dias ?? '—'} dias</span>{camp.cupom_codigo && <span className="rounded-md bg-koma-raised px-2 py-1">{camp.cupom_codigo}</span>}</div>
      <dl className="grid grid-cols-2 gap-3">
        {[
          ['Contatos confirmados',count(camp.clientes_abordados)],
          ['Compraram após contato',camp.clientes_abordados > 0 ? count(camp.clientes_que_voltaram) : 'Não medido'],
          ['Usos de cupom',count(camp.pedidos_comprovados_cupom)],
          ['Cupom sem contato',count(camp.cupons_sem_contato_confirmado)],
          ['Associação por data',count(camp.pedidos_estimados_janela)],
          ['Descontos associados',money(camp.desconto_utilizado_brl)],
        ].map(([label,value]) => <div key={label}><dt>{label}</dt><dd className="mt-1 font-semibold text-koma-foreground">{value}</dd></div>)}
      </dl>
      <p>Registro manual não comprova entrega. Associação não comprova causalidade ou lucro. A janela salva é preservada.</p>
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
  onOpenCampaigns,
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
      .filter((item: any) => typeof item.data === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(item.data))
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
            Retorno dos clientes
          </h3>
        </div>

        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-2 sm:flex sm:flex-wrap sm:gap-3">
          <label className="flex min-w-0 flex-col gap-1 text-sm font-medium text-koma-muted sm:min-w-[9rem] sm:flex-1">
            Período
            <select
              aria-label="Período analisado nos resultados"
              value={periodoDias}
              onChange={(e) => onChangePeriodo(Number(e.target.value))}
              className="min-h-10 w-full min-w-0 rounded-xl border border-koma-border bg-koma-panel px-3 py-2 text-sm font-medium text-koma-foreground"
            >
              <option value={7}>Últimos 7 dias</option>
              <option value={30}>Últimos 30 dias</option>
              <option value={60}>Últimos 60 dias</option>
              <option value={90}>Últimos 90 dias</option>
            </select>
          </label>

          <label className="flex min-w-0 flex-col gap-1 text-sm font-medium text-koma-muted sm:min-w-[9rem] sm:flex-1">
            Janela geral
            <select
              aria-label="Janela de atribuição pós-abordagem"
              value={janelaDias}
              onChange={(e) => onChangeJanela(Number(e.target.value))}
              className="min-h-10 w-full min-w-0 rounded-xl border border-koma-border bg-koma-panel px-3 py-2 text-sm font-medium text-koma-foreground"
            >
              <option value={7}>7 dias após contato</option>
              <option value={14}>14 dias após contato</option>
              <option value={30}>30 dias após contato</option>
            </select>
          </label>

          <button
            type="button"
            onClick={onRefresh}
            aria-label="Atualizar resultados"
            title="Atualizar resultados"
            className="koma-btn-secondary inline-flex min-h-10 items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium"
          >
            <RefreshCw size={16} aria-hidden="true" className={loading ? 'animate-spin' : ''} /><span className="hidden sm:inline">Atualizar</span>
          </button>
        </div>
      </div>

      {error && (
        <div role="alert" className="rounded-xl border border-koma-danger-border bg-koma-danger-bg p-4 text-xs text-koma-danger-text">
          {error}{' '}
          <button type="button" onClick={onRefresh} className="underline font-bold">
            Tentar novamente
          </button>
        </div>
      )}

      {loading && <p role="status" className="text-sm text-koma-muted">Atualizando resultados…</p>}
      <KomaMetricGroup label="Indicadores de relacionamento" metrics={[
          {label:'Clientes que voltaram', icon:Repeat2, value:isMeasured ? count(retorno.clientes_que_voltaram) : '—', note:isMeasured ? `${count(retorno.clientes_abordados_no_periodo)} contatos confirmados` : 'Não medido', ratio:isMeasured && retorno.clientes_abordados_no_periodo > 0 ? retorno.clientes_que_voltaram / retorno.clientes_abordados_no_periodo : null},
          {label:'Valor líquido associado', icon:Wallet, value:hasAssociations ? money(valores.total_liquido_brl) : '—', note:hasAssociations ? `${count(pedidos?.total)} compras · não é lucro` : 'Não medido'},
          {label:'Clientes recorrentes', icon:Users, value:segundaCompra ? count(segundaCompra.clientes_que_fizeram_segunda_compra) : '—', note:segundaCompra ? `de ${count(segundaCompra.clientes_com_1_compra_base)} compradores · histórico total` : 'Sem histórico', ratio:segundaCompra?.clientes_com_1_compra_base > 0 ? segundaCompra.clientes_que_fizeram_segunda_compra / segundaCompra.clientes_com_1_compra_base : null},
          {label:'Descontos no período', icon:Ticket, value:descontos ? money(descontos.total_brl) : '—', note:'Em toda a base · não só campanhas'},
        ]} />
      {!loading && !error && !isMeasured && !hasAssociations ? <section aria-label="Começar acompanhamento">
        <KomaEmptyState variant="action" icon={MessageCircle} title="Comece pelos contatos"
          description="Confirme os contatos feitos para acompanhar quem volta."
          action={{label:'Abrir campanhas', onClick:onOpenCampaigns, icon:ArrowRight}} />
      </section> : null}
      <section aria-label="Análise detalhada dos resultados" className="space-y-3">
        <h4 className="text-sm font-semibold text-koma-foreground">Evolução e origem das compras</h4>
        <div className="grid gap-3 lg:grid-cols-2">
          <section aria-label="Evolução observada" className="min-w-0 rounded-xl bg-koma-panel p-4 space-y-3">
            <h4 className="text-sm font-bold text-koma-foreground">Contatos e retornos</h4>

            {temporalSeries.length > 0 ? <>
              <div className="flex flex-wrap gap-3 text-xs text-koma-muted">
                <span><span className="mr-1 inline-block h-2 w-3 rounded bg-emerald-500" />Contatos manuais</span>
                <span><span className="mr-1 inline-block h-2 w-3 rounded bg-sky-500" />Clientes com compras posteriores</span>
              </div>
              <div className="overflow-x-auto">
                <div className="flex min-w-[240px] items-end gap-1.5" role="img" aria-label="Evolução de registros por datas verificadas. Os números estão na tabela acessível abaixo.">
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
            </> : <div className="flex min-h-28 items-center justify-center gap-3 text-koma-muted"><ChartNoAxesCombined size={28} aria-hidden="true"/><div><p className="text-sm">Sem eventos datados.</p><p className="mt-1 text-xs">O gráfico aparece com os primeiros registros.</p></div></div>}
          </section>
          <section aria-label="Compras por evidência" className="min-w-0 rounded-xl bg-koma-panel p-4 space-y-3">
            <h4 className="text-sm font-bold text-koma-foreground">Compras associadas por evidência</h4>
            {hasAssociations ? <>
              <div role="img" aria-label={String(pedidos?.comprovados_por_cupom || 0) + ' compras com cupom e ' + String(pedidos?.estimados_por_janela_temporal || 0) + ' compras associadas por data'} className="flex h-3 overflow-hidden rounded-full bg-koma-raised">
                <div className="bg-emerald-500" style={{width: (totalEvidence ? Number(pedidos?.comprovados_por_cupom || 0) / totalEvidence * 100 : 0) + '%'}} />
                <div className="bg-sky-500" style={{width: (totalEvidence ? Number(pedidos?.estimados_por_janela_temporal || 0) / totalEvidence * 100 : 0) + '%'}} />
              </div>
              <dl className="grid grid-cols-2 gap-3 pt-2">
                <div><dt className="flex items-center gap-2 text-xs text-koma-muted"><span className="h-2 w-2 rounded-full bg-emerald-500"/>Cupom vinculado</dt><dd className="mt-2 text-xl font-bold">{count(pedidos?.comprovados_por_cupom)}</dd><dd className="mt-1 text-xs text-koma-muted">{count(pedidos?.cupons_sem_contato_confirmado)} sem contato confirmado</dd></div>
                <div><dt className="flex items-center gap-2 text-xs text-koma-muted"><span className="h-2 w-2 rounded-full bg-sky-500"/>Após contato</dt><dd className="mt-2 text-xl font-bold">{count(pedidos?.estimados_por_janela_temporal)}</dd><dd className="mt-1 text-xs text-koma-muted">Associação por data</dd></div>
              </dl><p className="text-xs text-koma-muted">Nenhuma compra é contada duas vezes.</p>
            </> : <p className="text-sm text-koma-muted">Não medido</p>}
          </section>
        </div>
      </section>
      <section aria-label="Como calculamos os resultados" className="grid gap-x-6 gap-y-3 border-y border-koma-border py-4 text-xs sm:grid-cols-3">
        <div><h4 className="mb-1 font-semibold text-koma-foreground">Cupom ≠ contato</h4><p className="text-koma-muted">Uso de cupom não confirma conversa ou entrega.</p></div>
        <div><h4 className="mb-1 font-semibold text-koma-foreground">Associação ≠ causalidade</h4><p className="text-koma-muted">Compra após contato não prova venda gerada pela ação.</p></div>
        <div><h4 className="mb-1 font-semibold text-koma-foreground">Valor ≠ lucro</h4><p className="text-koma-muted">Valor pago líquido de estornos, sem descontar os custos.</p></div>
        <p className="text-koma-muted sm:col-span-3">Campanhas mantêm a janela salva. Gráfico conta clientes por dia; recorrência considera todo o histórico.</p>
      </section>

      <section aria-label="Resultados por campanha" className="min-w-0 rounded-xl bg-koma-panel p-4 space-y-3">
        <h4 className="text-sm font-semibold text-koma-foreground">Resultados por campanha ({campanhas.length})</h4>
        {campanhas.length > 0 && res?.conciliacao_campanhas && <details className="text-sm text-koma-muted"><summary className="min-h-9 cursor-pointer py-2">Conferir totais por campanha</summary><p>
          Do total associado: {count(res.conciliacao_campanhas.pedidos_com_campanha)} compras em campanhas ({money(res.conciliacao_campanhas.valor_com_campanha_brl)})
          {' e '}{count(res.conciliacao_campanhas.pedidos_sem_campanha)} sem campanha ({money(res.conciliacao_campanhas.valor_sem_campanha_brl)}).
          {' '}Clientes únicos podem participar de mais de uma campanha; as contagens de pessoas não devem ser somadas.
        </p></details>}
        {campanhas.length === 0 ? (
          <p className="text-sm text-koma-muted">Nenhuma campanha registrada.</p>
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
                      <span className="block">{camp.nome}</span>
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
                <span className="block">{camp.nome}</span>
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
