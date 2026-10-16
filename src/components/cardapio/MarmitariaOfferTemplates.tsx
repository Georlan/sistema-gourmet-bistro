/** Modelos da operação Marmitaria. O motor de campanhas não conhece tamanhos nem preços fixos. */
type TemplateProduct = { id: string; nome: string; ativo: boolean; tamanho?: string | null };
export function buildMarmitariaOffer(kind: 'duas' | 'bebida', products: TemplateProduct[]) {
  const g = products.find(p => p.tamanho?.toLowerCase() === 'g' && p.ativo);
  const m = products.find(p => p.tamanho?.toLowerCase() === 'm' && p.ativo);
  const drink = products.find(p => /pitulinha|pithulinha|pituchulinha|pitchulinha/i.test(p.nome) && p.ativo);
  return {
    nome: kind === 'duas' ? 'Quentinha G + Quentinha M' : 'Quentinha G + Pitulinha',
    descricao: kind === 'duas' ? 'Monte uma quentinha G e outra M.' : 'Monte sua quentinha G e escolha a bebida.',
    preco: kind === 'duas' ? '22.00' : '16.00', primeiro: g?.id || '',
    segundo: (kind === 'duas' ? m : drink)?.id || '',
    ativo: false, inicio: '', fim: '', fuso: 'America/Fortaleza',
  };
}
export function MarmitariaOfferTemplates({ onSelect }: { onSelect: (kind: 'duas' | 'bebida') => void }) {
  return <div className="flex flex-wrap gap-2" aria-label="Modelos de ofertas">
    <button type="button" onClick={() => onSelect('duas')} className="min-h-10 rounded-xl border border-koma-border px-3 text-xs font-bold text-koma-foreground">G + M · R$ 22</button>
    <button type="button" onClick={() => onSelect('bebida')} className="min-h-10 rounded-xl border border-koma-border px-3 text-xs font-bold text-koma-foreground">G + Pitulinha · R$ 16</button>
  </div>;
}
