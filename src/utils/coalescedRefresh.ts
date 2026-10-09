export function createCoalescedRefresh(read: () => Promise<void>) {
  let flight: Promise<void> | null = null;
  let dirty = false;
  const refresh = (): Promise<void> => {
    if (flight) { dirty = true; return flight; }
    flight = (async () => {
      do { dirty = false; await read(); } while (dirty);
    })().finally(() => { flight = null; });
    return flight;
  };
  return refresh;
}
