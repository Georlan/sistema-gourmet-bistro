import { itemCompositionPresentation, type CompositionSource } from '../../domain/orderItemComposition';

/** Compact, shared content for cards, acceptance, details, kitchen and history. */
export function OrderItemComposition({ item, className = '' }: { item: CompositionSource; className?: string }) {
  const { lines, observation } = itemCompositionPresentation(item);
  if (!lines.length && !observation) return null;
  return <div className={`space-y-0.5 whitespace-pre-wrap break-words text-[11px] leading-relaxed ${className}`}>
    {lines.map((line, index) => {
      const separator = line.indexOf(':');
      return <div key={index}><strong>{line.slice(0, separator + 1)}</strong>{line.slice(separator + 1)}</div>;
    })}
    {observation && <div>{(item.composicao_agrupada || lines.length > 0) && <strong>OBS: </strong>}{observation}</div>}
  </div>;
}
