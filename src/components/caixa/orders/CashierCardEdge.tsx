const ifood = new URL('../../../assets/brand/delivery/ifood.png', import.meta.url).href;
const food99 = new URL('../../../assets/brand/delivery/99food.png', import.meta.url).href;
const keeta = new URL('../../../assets/brand/delivery/keeta.png', import.meta.url).href;

export type CashierPartner = 'ifood' | '99food' | 'keeta';
const partners = { ifood: { src: ifood, label: 'iFood' }, '99food': { src: food99, label: '99Food' }, keeta: { src: keeta, label: 'Keeta' } };
export function CashierCardEdge({ partner }: { partner?: CashierPartner }) {
  const origin = partner ? partners[partner] : null;
  if (!origin) return null;
  return <div className="orders-card__edge">
    <span className="orders-card__partner" data-partner={partner} title={origin.label}>
      <img src={origin.src} alt={origin.label} width="36" height="22" />
    </span>
  </div>;
}
