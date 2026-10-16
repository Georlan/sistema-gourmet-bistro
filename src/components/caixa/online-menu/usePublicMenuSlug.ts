import { snapshotFetch as fetch } from '../../../utils/snapshotFetch';
import { useEffect, useState } from 'react';

export function usePublicMenuSlug(apiBaseUrl: string, authorization: string | undefined, restaurantId: number | null, enabled: boolean): string | null {
  const [menuIdentity, setMenuIdentity] = useState<{ authorization: string; restaurantId: number; slug: string } | null>(null);

  useEffect(() => {
    if (!enabled || !restaurantId || !authorization) return;
    const controller = new AbortController();
    fetch(`${apiBaseUrl}/api/cardapio-digital/config?restaurante_id=${restaurantId}`, {
      headers: { Authorization: authorization },
      signal: controller.signal,
    }).then(async response => {
      if (!response.ok) return;
      const config = await response.json();
      if (!controller.signal.aborted && Number(config.id) === restaurantId && typeof config.slug === 'string' && config.slug.trim()) {
        setMenuIdentity({ authorization, restaurantId, slug: config.slug.trim() });
      }
    }).catch(() => { /* Sem slug autenticada: não gerar link público potencialmente incorreto. */ });
    return () => controller.abort();
  }, [apiBaseUrl, authorization, restaurantId, enabled]);

  return enabled && menuIdentity?.authorization === authorization && menuIdentity.restaurantId === restaurantId
    ? menuIdentity.slug
    : null;
}
