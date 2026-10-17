import React from 'react';
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
  const segundaCompra = res?.conversao_segunda_compra;
  const retorno = res?.retorno_apos_abordagem;
  const pedidos = res?.pedidos_associados;
  const descontos = res?.descontos_efetivamente_utilizados;
  const valores = res?.valor_pago_pedidos_associados;
  const campanhas: any[] = crmSummary?.campanhas || [];

  const isMeasured = retorno?.status_mensuracao === 'MENSURADO';

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
            Compras após o contato
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
            <p className="text-sm text-koma-muted">De {retorno.clientes_abordados_no_periodo} clientes contatados</p>
            <div role="img" aria-label={`${retorno.clientes_que_voltaram} de ${retorno.clientes_abordados_no_periodo} clientes voltaram`} className="h-3 overflow-hidden rounded-full bg-koma-raised">
              <div className="h-full rounded-full bg-emerald-500" style={{width: `${retorno.clientes_abordados_no_periodo > 0 ? Math.min(100, Math.max(0, retorno.clientes_que_voltaram / retorno.clientes_abordados_no_periodo * 100)) : 0}%`}} />
            </div>
          </> : <p className="text-sm text-koma-muted">Registre contatos em Campanhas para acompanhar o retorno.</p>}
        </article>
        <article className="rounded-xl border border-koma-border bg-koma-panel p-4 space-y-2.5">
          <h4 className="text-sm font-bold text-koma-muted">Quanto compraram após o contato</h4>
          <strong className="block text-3xl font-black text-emerald-400">{isMeasured && valores ? money(valores.total_liquido_brl) : '—'}</strong>
          {isMeasured && valores ? <>
            <p className="text-sm text-koma-muted">{pedidos?.total ?? '—'} pedidos associados aos contatos</p>
            <div className="space-y-2 text-xs">
              {[{label:'Com cupom da campanha',value:valores.comprovado_cupom_brl,color:'bg-emerald-500'}, {label:`Sem cupom, até ${janelaDias} dias após contato`,value:valores.estimado_temporal_brl,color:'bg-sky-500'}].map(item => <div key={item.label}>
                <div className="flex justify-between gap-2"><span>{item.label}</span><strong>{money(item.value)}</strong></div>
                <div aria-hidden="true" className="mt-1 h-2 rounded-full bg-koma-raised"><div className={`h-full rounded-full ${item.color}`} style={{width:`${valores.total_liquido_brl > 0 ? Math.min(100,Math.max(0,item.value / valores.total_liquido_brl * 100)) : 0}%`}} /></div>
              </div>)}
            </div>
          </> : <p className="text-sm text-koma-muted">Ainda sem dados de compras após contatos.</p>}
          <p className="text-xs text-koma-muted">Compras associadas ao contato; não representam lucro ou vendas adicionais comprovadas.</p>
        </article>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <article className="rounded-xl border border-koma-border bg-koma-panel p-4">
          <h4 className="text-xs font-bold text-koma-muted">Clientes com 2 ou mais compras</h4>
          <strong className="block mt-2 text-xl">{segundaCompra ? segundaCompra.clientes_que_fizeram_segunda_compra : '—'}</strong>
          <p className="text-xs text-koma-muted">{segundaCompra ? `De ${segundaCompra.clientes_com_1_compra_base} clientes com compra no histórico` : 'Ainda sem dados'}</p>
        </article>
        <article className="rounded-xl border border-koma-border bg-koma-panel p-4">
          <h4 className="text-xs font-bold text-koma-muted">Descontos utilizados</h4>
          <strong className="block mt-2 text-xl">{descontos ? money(descontos.total_brl) : '—'}</strong>
          <p className="text-xs text-koma-muted">Apenas pedidos concluídos</p>
        </article>
      </div>
      <details className="rounded-xl border border-koma-border bg-koma-panel p-3 text-sm text-koma-muted">
        <summary className="min-h-10 cursor-pointer py-2 font-semibold text-koma-foreground focus-visible:outline-2 focus-visible:outline-emerald-500">Como calculamos os resultados</summary>
        <div className="mt-3 space-y-2">
          <p>{res?.regra_associacao || `Cada pedido concluído é vinculado a no máximo uma abordagem dentro de ${janelaDias} dias após o contato. Cancelamentos e estornos são excluídos.`}</p>
          <p>{res?.aviso_metodologico || 'Compras após contato sem cupom são associações por período, não comprovam que a campanha causou a venda.'}</p>
          {isMeasured && <p>Clientes que voltaram: {retorno.clientes_retorno_comprovado_cupom} com cupom · {retorno.clientes_retorno_estimado_temporal} por período após contato.</p>}
          {segundaCompra?.explicacao && <p>{segundaCompra.explicacao}</p>}
          {descontos && <p>Descontos em cupons: {money(descontos.cupom_brl)} · Fidelidade: {money(descontos.fidelidade_cashback_brl)}</p>}
        </div>
      </details>

      {/* Tabela de Acompanhamento por Campanha */}
      <section className="rounded-xl border border-koma-border bg-koma-panel p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-semibold text-koma-foreground">
            Resultados por campanha ({campanhas.length})
          </h4>
        </div>

        {campanhas.length === 0 ? (
          <p className="text-xs text-koma-muted">
            Nenhuma campanha registrada ainda. Inicie uma ação a partir da aba <strong>Hoje</strong> ou{' '}
            <strong>Campanhas</strong>.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-koma-border">
            <table className="w-full text-left text-sm">
              <thead className="bg-koma-raised border-b border-koma-border text-xs font-semibold text-koma-muted">
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
                      <span className="text-xs text-koma-muted">{camp.objetivo}</span>
                    </td>
                    <td className="p-3">
                      <span className="rounded-md bg-koma-raised px-2 py-0.5 font-mono text-xs text-koma-foreground">
                        {camp.abordagem_tipo}
                        {camp.cupom_codigo ? ` (${camp.cupom_codigo})` : ''}
                      </span>
                    </td>
                    <td className="p-3 font-mono text-koma-foreground">
                      {camp.clientes_abordados}
                    </td>
                    <td className="p-3 font-mono text-koma-foreground">
                      {camp.clientes_abordados > 0 ? camp.clientes_que_voltaram : 'Não mensurado'}
                    </td>
                    <td className="p-3 font-mono text-koma-foreground">
                      {camp.clientes_abordados > 0 ? (
                        <span>
                          {(camp.pedidos_comprovados_cupom ?? 0) + (camp.pedidos_estimados_janela ?? 0)} ({camp.pedidos_comprovados_cupom} cupom ·{' '}
                          {camp.pedidos_estimados_janela} janela)
                        </span>
                      ) : (
                        'Não mensurado'
                      )}
                    </td>
                    <td className="p-3 font-mono font-bold text-emerald-400">
                      {camp.clientes_abordados > 0 ? money(camp.valor_pago_liquido_brl) : 'Não mensurado'}
                    </td>
                    <td className="p-3 font-mono text-koma-foreground">
                      {money(camp.desconto_utilizado_brl)}
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
