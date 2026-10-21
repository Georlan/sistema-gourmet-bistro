import { useState } from 'react';
import { ArrowRight, ShoppingBag, Gift } from 'lucide-react';
import { projectLoyaltyImpact } from '../../../domain/loyaltyImpact';
import { CrmMetricChart } from './CrmMetricChart';

const money = (value: number) => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export function LoyaltyImpactPanel({ rewardPercent, active }: { rewardPercent: number; active: boolean }) {
  const [ticket, setTicket] = useState('100');
  const [margin, setMargin] = useState('');
  const impact = projectLoyaltyImpact(Number(ticket), active ? rewardPercent : 0, margin.trim() ? Number(margin) : null);
  return (
    <section aria-label="Simulação da fidelidade" className="rounded-xl bg-koma-panel p-4 space-y-4">
      <div><h3 className="text-base font-semibold">Simule o benefício por pedido</h3><p className="mt-1 text-xs text-koma-muted">Cenário com resgate de todo o benefício.</p></div>
      <div className="grid items-center gap-3 sm:grid-cols-[1fr_auto_1fr]">
      <label className="block text-sm text-koma-muted"><span className="inline-flex items-center gap-2"><ShoppingBag size={16} aria-hidden="true"/>Valor do pedido (R$)</span>
        <input aria-label="Valor do pedido na simulação" type="number" min="0.01" step="0.01" value={ticket} onChange={e => setTicket(e.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-koma-border bg-koma-card px-3 text-koma-foreground" />
      </label>
      <ArrowRight size={20} aria-hidden="true" className="hidden text-koma-muted sm:block"/>
      <div className="rounded-xl bg-emerald-500/10 p-4"><span className="inline-flex items-center gap-2 text-xs text-koma-muted"><Gift size={16} aria-hidden="true"/>Benefício gerado para o cliente</span><strong className="mt-1 block text-2xl text-koma-success-text">{impact ? money(impact.benefit) : '—'}</strong><span className="text-xs text-koma-muted">{active ? `${rewardPercent.toLocaleString('pt-BR', {maximumFractionDigits:2})}% do pedido` : 'Programa pausado: novas compras não geram benefício'}</span></div>
      </div>
      {impact ? <>
        <label className="block text-sm text-koma-muted">Margem de contribuição (%) · opcional
          <input aria-label="Margem de contribuição na simulação" type="number" min="0" max="100" step="0.1" placeholder="Informe se conhecer" value={margin} onChange={e => setMargin(e.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-koma-border bg-koma-card px-3 text-koma-foreground" />
        </label>
        <p className="text-xs text-koma-muted">É o percentual que sobra após ingredientes, embalagens e taxas, antes dos custos fixos.</p>
        {impact.contributionBefore !== null && impact.contributionAfter !== null ? <>
          <CrmMetricChart title="Impacto na contribuição por pedido" unit="BRL" rows={[{label:'Antes do benefício',value:impact.contributionBefore},{label:'Após o benefício',value:impact.contributionAfter}]} />
          <p role={impact.exceedsContribution ? 'alert' : undefined} className={`text-sm ${impact.exceedsContribution ? 'text-rose-400' : 'text-koma-muted'}`}>{impact.exceedsContribution ? 'O benefício supera a contribuição informada. Revise a taxa antes de salvar.' : `Neste cenário, restam ${money(impact.contributionAfter)} para cobrir custos fixos e resultado.`}</p>
        </> : <p className="text-sm text-koma-muted">{margin.trim() ? 'Informe uma margem entre 0% e 100%.' : 'Sem a margem, ainda não é possível avaliar se o benefício cabe no pedido.'}</p>}
      </> : <p role="alert" className="text-sm text-koma-muted">Informe um pedido maior que zero e uma taxa válida.</p>}
      <p className="text-xs text-koma-muted">Simulação · não altera o programa nem representa lucro líquido.</p>
    </section>
  );
}
