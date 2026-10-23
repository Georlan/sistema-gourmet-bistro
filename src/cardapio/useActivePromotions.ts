import { useEffect, useState } from 'react';
import type { CatalogPromotion } from './CardapioTypes';

/** Compartilha a validade das ofertas entre as apresentações do mesmo catálogo. */
export function useActivePromotions(campaigns: CatalogPromotion[] | undefined) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const nextEnd = Math.min(...(campaigns || [])
      .map(offer => Date.parse(offer.fim_em || ''))
      .filter(end => end > Date.now()));
    if (!Number.isFinite(nextEnd)) return;
    const timer = window.setTimeout(() => setNow(Date.now()), Math.min(nextEnd - Date.now() + 1, 2_147_483_647));
    return () => window.clearTimeout(timer);
  }, [campaigns, now]);
  return (campaigns || []).filter(offer => !offer.fim_em || Date.parse(offer.fim_em) > Date.now());
}
