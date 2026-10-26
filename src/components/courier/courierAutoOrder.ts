export interface CourierPoint { latitude: number; longitude: number }
export interface CourierStop { id: string; destination?: { latitude?: number | null; longitude?: number | null } }

export function validCourierPoint(point: CourierStop['destination']): point is CourierPoint {
  return Boolean(point && typeof point.latitude === 'number' && typeof point.longitude === 'number'
    && Number.isFinite(point.latitude) && Number.isFinite(point.longitude)
    && Math.abs(point.latitude) <= 90 && Math.abs(point.longitude) <= 180
    && (point.latitude !== 0 || point.longitude !== 0));
}

// Haversine's angular score is monotonic in distance; no road network or traffic assumed.
function proximity(a: CourierPoint, b: CourierPoint): number {
  const rad = Math.PI / 180;
  return Math.sin((b.latitude - a.latitude) * rad / 2) ** 2
    + Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad)
    * Math.sin((b.longitude - a.longitude) * rad / 2) ** 2;
}

/** Greedy proximity suggestion. Unknown destinations stay visible, in their previous order. */
export function orderCourierStops(stops: readonly CourierStop[], origin: CourierPoint) {
  const unique = [...new Map(stops.map(stop => [stop.id, stop])).values()];
  const remaining = unique.filter(stop => validCourierPoint(stop.destination));
  const missing = unique.filter(stop => !validCourierPoint(stop.destination)).map(stop => stop.id);
  const ids: string[] = [];
  if (!validCourierPoint(origin)) return { ids: unique.map(stop => stop.id), missing, located: 0 };
  let current = origin;
  while (remaining.length) {
    let next = 0;
    for (let i = 1; i < remaining.length; i++) {
      if (proximity(current, remaining[i].destination as CourierPoint) < proximity(current, remaining[next].destination as CourierPoint)) next = i;
    }
    const [stop] = remaining.splice(next, 1);
    ids.push(stop.id);
    current = stop.destination as CourierPoint;
  }
  return { ids: [...ids, ...missing], missing, located: ids.length };
}
