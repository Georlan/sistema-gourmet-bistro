import { itemCompositionPresentation, type CompositionSource } from '../../domain/orderItemComposition';

/** Shared composition hierarchy for cards, acceptance, details, kitchen and history. */
export function OrderItemComposition({ item, className = '' }: { item: CompositionSource; className?: string }) {
  const { lines, observation } = itemCompositionPresentation(item);
  if (!lines.length && !observation) return null;
  return <div className={`space-y-1 whitespace-pre-wrap break-words text-xs leading-snug ${className}`}>
    {lines.map((line, index) => {
      const separator = line.indexOf(':');
      const label = separator >= 0 ? line.slice(0, separator + 1) : line;
      const value = separator >= 0 ? line.slice(separator + 1).trimStart() : '';
      return <div key={index} className="order-item-composition__group">
        <strong className="font-extrabold">{label}</strong>
        {value && <span className="font-medium"> {value}</span>}
      </div>;
    })}
    {observation && <div className="pt-0.5 text-[11px] leading-relaxed">{(item.composicao_agrupada || lines.length > 0) && <strong>OBS: </strong>}{observation}</div>}
  </div>;
}
