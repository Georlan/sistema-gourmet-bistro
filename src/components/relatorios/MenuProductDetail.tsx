import { useEffect, useRef } from 'react';
import { menuMoney, menuPercent, quadrantLabels, type MenuCategory, type MenuProduct } from '../../domain/menuIntelligence';

export function MenuProductDetail({ product, category, onClose, onSimulate }: {
  product: MenuProduct; category?: MenuCategory; onClose: () => void; onSimulate: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const node = dialog.current;
    node?.showModal();
    return () => { node?.close(); if (opener?.isConnected) opener.focus(); };
  }, []);
  // Ignore the queued close event from StrictMode cleanup if the dialog was reopened.
  const p = product;
  return <dialog ref={dialog} onClose={() => { if (!dialog.current?.open) onClose(); }} onClick={e => { if (e.target === e.currentTarget) onClose(); }} aria-labelledby="menu-product-detail-title" className="m-auto max-h-[90dvh] w-[calc(100%_-_2rem)] max-w-2xl overflow-y-auto rounded-2xl border border-koma-border bg-koma-dialog p-5 text-left text-koma-foreground backdrop:bg-black/70">
    <div className="mb-5 flex items-start justify-between gap-4"><div><h2 id="menu-product-detail-title" className="text-lg font-semibold">{p.nome}</h2><p className="text-xs text-koma-muted">{p.categoria} · {p.ativo ? 'Ativo hoje' : 'Pausado hoje'}</p></div><button autoFocus onClick={onClose} className="rounded-xl border border-koma-border p-2 text-xs">Fechar análise</button></div>
    <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">{[
      ['Unidades pedidas / anterior', `${p.unidades} / ${p.unidades_anteriores}`],
      ['Preço médio observado / catálogo atual', `${menuMoney(p.preco_medio)} / ${menuMoney(p.preco_cardapio)}`],
      ['Custo atual por unidade da base', menuMoney(p.custo_unitario)],
      ['Unidades com custo coberto', `${p.unidades_cobertas ?? 'Não calculado'} de ${p.unidades}`],
      ['CMV estimado da parcela coberta', menuPercent(p.cmv_pct_estimado)],
      ['Margem unitária estimada observada', menuMoney(p.margem_unitaria_observada)],
      ['Contribuição estimada / anterior', `${menuMoney(p.contribuicao_estimada)} / ${menuMoney(p.contribuicao_anterior_estimada)}`],
      ['Classificação', p.classificacao ? quadrantLabels[p.classificacao] : 'Não classificável'],
    ].map(([label, value]) => <div key={label} className="rounded-xl bg-koma-raised p-3"><dt className="text-xs text-koma-muted">{label}</dt><dd className="mt-1 font-semibold">{value}</dd></div>)}</dl>
    <div className="mt-5 space-y-3 text-xs text-koma-muted"><p>{p.motivo_classificacao || 'Complete os custos e confira a amostra antes de classificar.'}</p>
      {category && <p>Limites na categoria: {menuPercent(category.limite_popularidade_pct)} de popularidade e {menuMoney(category.limite_margem_unitaria)} de margem/un. · {category.pedidos_distintos} pedidos distintos.</p>}
      <p>Preço aplicado pode incluir adicionais. A contribuição nova usa somente unidades sem modificadores com custo conhecido da base. Compara os dois períodos com o mesmo custo atual; não é lucro histórico. Descontos da conta, taxas, impostos e despesas não cadastrados ficam fora.</p>
      <p>Sem saída não prova falta de interesse. Confira disponibilidade, dias de funcionamento e fidelização antes de retirar um produto.</p>
      {p.sugestoes.map(s => <div key={s.tipo}><strong className="text-koma-foreground">{s.titulo}</strong><p>{s.motivo}</p></div>)}
    </div>
    <button onClick={onSimulate} className="mt-5 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white">Simular este produto</button>
  </dialog>;
}
