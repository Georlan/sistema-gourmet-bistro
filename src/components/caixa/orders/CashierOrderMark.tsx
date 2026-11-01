type Props = {
  number: string;
  kind: 'pickup' | 'delivery' | 'counter' | 'dine-in';
  label: string;
  tableLabel?: string;
};

export function CashierOrderMark({ number, kind, label, tableLabel }: Props) {
  return (
    <div className={`orders-card__number orders-card__mark${number.length > 4 ? ' is-long' : ''}`}
      role="img" aria-label={`${label}, pedido ${number}${tableLabel ? `, ${tableLabel}` : ''}`}
      title={`${label}${tableLabel ? ` · ${tableLabel}` : ''}`}>
      <img src={`/brand/cashier/${kind}-v1.svg`} width="26" height="26" alt="" aria-hidden="true" />
      <strong>#{number}</strong>
      <span className="orders-card__fulfillment-tag">{label}</span>
      {tableLabel && <span className="orders-card__number-detail">{tableLabel}</span>}
    </div>
  );
}
