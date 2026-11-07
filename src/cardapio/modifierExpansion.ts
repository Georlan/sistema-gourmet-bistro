/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ProductModifier } from './CardapioTypes';

export type QuantityModifier = ProductModifier & { minSelection?: number };

export const isAddonsOrExtrasGroup = (title: string): boolean =>
  /adiciona(l|is)|extra(s)?|acrescimo(s)?/i.test(
    (title || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase()
  );

/**
 * Determina se um grupo de modificadores deve iniciar expandido por padrão.
 *
 * Invariantes de produto:
 * 1. Escolhas obrigatórias e de composição (proteínas, tamanhos, pontos) iniciam sempre abertas.
 * 2. Se o item tiver apenas 1 grupo modificador, inicia sempre aberto.
 * 3. Complementos gratuitos (guarnições livres, saladas, opções com preço 0) continuam abertos.
 * 4. Grupos de adicionais pagos ou identificados como "Adicionais" iniciam expandidos por padrão
 *    em TODOS os restaurantes da plataforma (inclusive Marmitaria e ID 6) para dar visibilidade comercial.
 * 5. Nenhuma opção é selecionada automaticamente (seleção estritamente opt-in pelo consumidor).
 */
export const shouldExpandModifierByDefault = (
  modifier: QuantityModifier,
  totalCount: number,
): boolean => {
  // 1. Escolha obrigatória ou de montagem
  if (modifier.required || (modifier.minSelection ?? 0) > 0) return true;
  // 2. Grupo único
  if (totalCount === 1) return true;
  // 3. Complementos gratuitos (guarnições livres, salada, acompanhamentos a R$ 0)
  const hasOnlyFreeOptions =
    modifier.options.length > 0 && modifier.options.every((o) => (o.extraPrice ?? 0) === 0);
  if (hasOnlyFreeOptions) return true;
  // 4. Adicionais pagos ou com título indicativo
  if (isAddonsOrExtrasGroup(modifier.title)) return true;
  if (modifier.options.some((o) => o.extraPrice > 0)) return true;
  return false;
};
