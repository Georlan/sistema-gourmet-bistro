export const KOMA_OPEN_WAITER_HISTORY_EVENT = 'koma-open-waiter-history';
export const openWaiterHistory = () => window.dispatchEvent(new Event(KOMA_OPEN_WAITER_HISTORY_EVENT));
