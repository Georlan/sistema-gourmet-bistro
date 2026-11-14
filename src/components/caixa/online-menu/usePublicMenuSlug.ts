import { useEffect, useState } from 'react';
import { fetchCardapioDigitalConfig } from './cardapioDigitalConfigClient';

export function usePublicMenuSlug(apiBaseUrl: string, authorization: string | undefined, restaurantId: number | null, enabled: boolean): string | null {
  const [menuIdentity, setMenuIdentity] = useState<{ authorization: string; restaurantId: number; slug: string } | null>(null);

  useEffect(() => {
    if (!enabled || !restaurantId || !authorization) return;
    let cancelled = false;
    fetchCardapioDigitalConfig<{ id?: number; slug?: string }>(apiBaseUrl, authorization, { restaurantId })
      .then((config) => {
        if (!cancelled && Number(config.id) === restaurantId && typeof config.slug === 'string' && config.slug.trim()) {
          setMenuIdentity({ authorization, restaurantId, slug: config.slug.trim() });
        }
      })
      .catch(() => { /* Sem slug autenticada: não gerar link público potencialmente incorreto. */ });
    return () => { cancelled = true; };
  }, [apiBaseUrl, authorization, restaurantId, enabled]);

  return enabled && menuIdentity && menuIdentity.authorization === authorization && menuIdentity.restaurantId === restaurantId
    ? menuIdentity.slug
    : null;
}
