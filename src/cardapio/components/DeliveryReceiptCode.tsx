import './deliveryReceipt.css';

export function DeliveryReceiptCode({ code, compact = false }: { code?: string | null; compact?: boolean }) {
  if (!code || !/^[0-9]{4}$/.test(code)) return null;
  return <div className={`k-delivery-receipt${compact ? " k-delivery-receipt--compact" : ""}`} aria-label="Código de recebimento da entrega">
    <span>Código da entrega</span><strong aria-label={`Código ${code.split('').join(' ')}`}>{code}</strong>
    <small>Informe ao entregador quando receber o pedido.</small>
  </div>;
}
