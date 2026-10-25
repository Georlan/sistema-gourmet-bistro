import { useEffect, useMemo, useState } from 'react';

/** Only order IDs, scoped to the delivery credential. No addresses or GPS trail. */
export function useCourierTrip(token: string, deliveries: { id: string }[], loaded: boolean) {
  const [ids, setIds] = useState<string[]>([]);
  const [key, setKey] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [persisted, setPersisted] = useState(true);
  useEffect(() => {
    let active = true;
    setReady(false); setIds([]); setKey(null);
    void (async () => {
      try {
        const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
        const storageKey = 'koma_courier_trip_v1:' + Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
        const value: unknown = JSON.parse(sessionStorage.getItem(storageKey) || '[]');
        const stored = Array.isArray(value) ? [...new Set(value.filter((id): id is string => typeof id === 'string' && id.length < 150))].slice(0, 100) : [];
        if (active) { setIds(stored); setKey(storageKey); }
      } catch { if (active) setPersisted(false); }
      finally { if (active) setReady(true); }
    })();
    return () => { active = false; };
  }, [token]);
  const activeIds = useMemo(() => {
    const allowed = new Set(deliveries.map(item => item.id));
    return ids.filter(id => allowed.has(id));
  }, [ids, deliveries]);
  useEffect(() => {
    if (!loaded || !ready || !key) return;
    try {
      const raw = JSON.stringify(activeIds);
      if (sessionStorage.getItem(key) !== raw) sessionStorage.setItem(key, raw);
    } catch { setPersisted(false); }
    // A removed/reassigned order must not re-enter a trip if it returns later.
    if (ids.length !== activeIds.length) setIds(activeIds);
  }, [activeIds, ids, key, ready, loaded]);
  return { ids: activeIds, save: setIds, ready, persisted };
}
