import type { OrderItemModifier } from '../types';

export interface CompositionSource {
  readonly observacao?: string;
  readonly modificadores?: readonly OrderItemModifier[];
  readonly composicao_agrupada?: boolean;
}

export function itemCompositionSignature(item: CompositionSource): string {
  return JSON.stringify((item.modificadores || [])
    .map(modifier => [modifier.id, modifier.preco, modifier.grupo_id || ''])
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))));
}

function summarize(modifiers: readonly OrderItemModifier[]): string[] {
  const choices = new Map<string, { name: string; quantity: number }>();
  for (const modifier of modifiers) {
    const choice = choices.get(modifier.id);
    if (choice) choice.quantity += 1;
    else choices.set(modifier.id, { name: modifier.nome, quantity: 1 });
  }
  return Array.from(choices.values(), ({ name, quantity }) => quantity > 1 ? `${quantity}x ${name}` : name);
}

/** Reads persisted choices; never guesses categories from food names. */
export function itemCompositionPresentation(item: CompositionSource): { lines: string[]; observation: string } {
  const modifiers = item.modificadores || [];
  const original = (item.observacao || '').trim();
  let observation = original;
  if (!modifiers.length) return { lines: [], observation };
  const names = summarize(modifiers);
  let generated = false;
  const normalized = observation.toLocaleLowerCase();
  const marker = ' - opções: ';
  const markerIndex = normalized.lastIndexOf(marker);
  const selection = normalized.startsWith('opções: ')
    ? observation.slice('Opções: '.length)
    : markerIndex >= 0 ? observation.slice(markerIndex + marker.length) : null;
  if (selection !== null) {
    const tokens = (value: string) => JSON.stringify(value.split(', ').map(part => part.trim().toLocaleLowerCase()).sort());
    generated = [names.join(', '), modifiers.map(mod => mod.nome).join(', ')]
      .some(candidate => tokens(candidate) === tokens(selection));
    if (generated) observation = normalized.startsWith('opções: ') ? '' : observation.slice(0, markerIndex).trim();
  }
  if (observation.toLocaleLowerCase().includes('opções:') && !generated) return { lines: [], observation };
  if (!item.composicao_agrupada) {
    return generated
      ? { lines: [], observation: original }
      : { lines: [`COMPLEMENTOS: ${names.join(', ')}`], observation };
  }
  const groups = new Map<string, { label: string; options: OrderItemModifier[] }>();
  for (const modifier of modifiers) {
    const key = modifier.grupo_id || '';
    const group = groups.get(key);
    if (group) group.options.push(modifier);
    else groups.set(key, { label: modifier.grupo_nome || 'Complementos', options: [modifier] });
  }
  return {
    lines: Array.from(groups.values(), group => `${group.label.toLocaleUpperCase()}: ${summarize(group.options).join(', ')}`),
    observation,
  };
}
