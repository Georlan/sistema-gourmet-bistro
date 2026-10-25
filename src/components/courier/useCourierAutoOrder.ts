import { useEffect, useRef, useState } from 'react';
import { orderCourierStops, validCourierPoint, type CourierStop } from './courierAutoOrder';

/** One user-requested location fix. Coordinates never leave this closure or enter storage. */
export function useCourierAutoOrder(token: string, stops: CourierStop[], blocked: boolean, save: (ids: string[]) => void) {
  const [locating, setLocating] = useState(false);
  const [feedback, setFeedback] = useState<{ text: string; error: boolean } | null>(null);
  const live = useRef({ token, stops, blocked, save });
  live.current = { token, stops, blocked, save };
  const requestRef = useRef(0);
  const busyRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    requestRef.current++; busyRef.current = false; setLocating(false); setFeedback(null);
    return () => {
      requestRef.current++; busyRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [token]);

  const order = () => {
    if (busyRef.current || live.current.blocked) return;
    const fail = (text: string) => setFeedback({ text, error: true });
    if (live.current.stops.length > 100) { fail('Organize até 100 entregas por viagem.'); return; }
    if (!live.current.stops.some(stop => validCourierPoint(stop.destination))) {
      fail('Endereços sem localização. Ajuste a sequência.'); return;
    }
    if (!window.isSecureContext || !navigator.geolocation) {
      fail('Localização indisponível neste navegador. Ajuste a sequência.'); return;
    }
    const request = ++requestRef.current;
    const access = live.current.token;
    busyRef.current = true; setLocating(true); setFeedback(null);
    const finish = (text: string, error: boolean) => {
      if (request !== requestRef.current || access !== live.current.token || !busyRef.current) return false;
      busyRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
      setLocating(false); setFeedback({ text, error });
      return true;
    };
    // Also bound browsers that leave a permission prompt pending indefinitely.
    timerRef.current = setTimeout(() => finish('Localização demorou. Tente novamente.', true), 12_000);
    try {
      navigator.geolocation.getCurrentPosition(position => {
        if (request !== requestRef.current || access !== live.current.token || !busyRef.current) return;
        if (live.current.blocked) { finish('Conferindo entregas. Tente novamente.', true); return; }
        const origin = { latitude: position.coords.latitude, longitude: position.coords.longitude };
        if (!validCourierPoint(origin) || !Number.isFinite(position.coords.accuracy) || (position.coords.accuracy < 0 || position.coords.accuracy > 500)) {
          finish('Localização imprecisa. Ative a localização precisa e tente novamente.', true); return;
        }
        // Reassignment/completion during the permission prompt must not resurrect a card.
        const result = orderCourierStops(live.current.stops, origin);
        if (!result.located) { finish('Endereços sem localização. Ajuste a sequência.', true); return; }
        const missingText = result.missing.length === 1 ? '1 entrega sem localização; ajuste a sequência.' : `${result.missing.length} entregas sem localização; ajuste a sequência.`;
        if (finish(result.missing.length ? missingText : 'Ordenado por proximidade.', false)) live.current.save(result.ids);
      }, error => {
        finish(error.code === 1 ? 'Permita a localização para ordenar. A sequência foi mantida.'
          : error.code === 3 ? 'Localização demorou. Tente novamente.'
          : 'Não foi possível localizar você. Tente novamente.', true);
      }, { enableHighAccuracy: true, timeout: 10_000, maximumAge: 30_000 });
    } catch {
      finish('Não foi possível acessar a localização. Ajuste a sequência.', true);
    }
  };
  return { order, locating, feedback, clearFeedback: () => setFeedback(null) };
}
