import { useEffect, useState } from 'react';
import type { CatalogPromotion } from './CardapioTypes';

const MAX_TIMEOUT_MS = 2_147_483_647;

/**
 * Filtra ofertas cujo período programado está ativo em `nowMs`.
 * Ofertas sem `inicio_em` são consideradas já iniciadas; sem `fim_em`, seguem ativas.
 */
export function computeActivePromotions(
  campaigns: CatalogPromotion[] | undefined,
  nowMs: number = Date.now(),
): CatalogPromotion[] {
  return (campaigns || []).filter((offer) => {
    const startMs = offer.inicio_em ? Date.parse(offer.inicio_em) : NaN;
    const endMs = offer.fim_em ? Date.parse(offer.fim_em) : NaN;
    if (Number.isFinite(startMs) && startMs > nowMs) return false;
    if (Number.isFinite(endMs) && endMs <= nowMs) return false;
    return true;
  });
}

/**
 * Retorna o próximo instante futuro (seja `inicio_em` ou `fim_em`) que mudará
 * o conjunto de promoções ativas, junto com a indicação de se é um início.
 */
export function getNextPromotionTransition(
  campaigns: CatalogPromotion[] | undefined,
  nowMs: number = Date.now(),
): { nextAtMs: number; isStartBoundary: boolean } | null {
  let nextAtMs = Number.POSITIVE_INFINITY;
  let isStartBoundary = false;

  for (const offer of campaigns || []) {
    const startMs = offer.inicio_em ? Date.parse(offer.inicio_em) : NaN;
    if (Number.isFinite(startMs) && startMs > nowMs && startMs < nextAtMs) {
      nextAtMs = startMs;
      isStartBoundary = true;
    }
    const endMs = offer.fim_em ? Date.parse(offer.fim_em) : NaN;
    if (Number.isFinite(endMs) && endMs > nowMs && endMs < nextAtMs) {
      nextAtMs = endMs;
      isStartBoundary = false;
    }
  }

  return Number.isFinite(nextAtMs) ? { nextAtMs, isStartBoundary } : null;
}

/** Compartilha a validade das ofertas entre as apresentações do mesmo catálogo. */
export function useActivePromotions(
  campaigns: CatalogPromotion[] | undefined,
  onStartBoundary?: () => void,
) {
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    const currentNow = Date.now();
    const transition = getNextPromotionTransition(campaigns, currentNow);
    if (!transition) return;

    const delay = Math.min(Math.max(transition.nextAtMs - currentNow + 1, 1), MAX_TIMEOUT_MS);
    const timer = window.setTimeout(() => {
      setNow(Date.now());
      if (transition.isStartBoundary) {
        onStartBoundary?.();
      }
    }, delay);

    return () => window.clearTimeout(timer);
  }, [campaigns, now, onStartBoundary]);

  return computeActivePromotions(campaigns, now);
}
