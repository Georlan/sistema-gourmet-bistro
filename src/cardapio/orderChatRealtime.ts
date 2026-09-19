export interface OrderRealtimeEvent {
  event: 'connected' | 'message' | 'status' | 'read_update' | string;
  data: Record<string, unknown> | null;
}

export type OrderRealtimeHealth = 'connecting' | 'healthy' | 'degraded';

interface Listener {
  onEvent: (event: OrderRealtimeEvent) => void;
  onState?: (state: OrderRealtimeHealth) => void;
}

interface SharedConnection {
  source: EventSource;
  listeners: Set<Listener>;
  health: OrderRealtimeHealth;
}

const connections = new Map<string, SharedConnection>();

function parseData(event: MessageEvent): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(event.data);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function dispatch(connection: SharedConnection, event: OrderRealtimeEvent) {
  connection.listeners.forEach((listener) => {
    try {
      listener.onEvent(event);
    } catch (error) {
      console.warn('Falha em consumidor do realtime do pedido:', error);
    }
  });
}

function setHealth(connection: SharedConnection, health: OrderRealtimeHealth) {
  if (connection.health === health) return;
  connection.health = health;
  connection.listeners.forEach((listener) => {
    try {
      listener.onState?.(health);
    } catch (error) {
      console.warn('Falha ao atualizar saúde do realtime do pedido:', error);
    }
  });
}

function createConnection(url: string): SharedConnection {
  const source = new EventSource(url);
  const connection: SharedConnection = {
    source,
    listeners: new Set(),
    health: 'connecting',
  };

  source.onopen = () => setHealth(connection, 'healthy');
  source.onerror = () => setHealth(connection, 'degraded');

  const bind = (eventName: string) => {
    source.addEventListener(eventName, (event: MessageEvent) => {
      dispatch(connection, { event: eventName, data: parseData(event) });
    });
  };
  ['connected', 'message', 'status', 'read_update'].forEach(bind);
  return connection;
}

export function subscribeOrderRealtime(options: {
  apiBaseUrl: string;
  token: string;
  onEvent: (event: OrderRealtimeEvent) => void;
  onState?: (state: OrderRealtimeHealth) => void;
}): () => void {
  const token = options.token.trim();
  if (!token) return () => {};

  const url = `${options.apiBaseUrl}/api/cardapio/pedidos/acompanhar/${encodeURIComponent(token)}/events`;
  let connection = connections.get(url);
  if (!connection) {
    connection = createConnection(url);
    connections.set(url, connection);
  }

  const listener: Listener = {
    onEvent: options.onEvent,
    onState: options.onState,
  };
  connection.listeners.add(listener);
  options.onState?.(connection.health);

  return () => {
    const current = connections.get(url);
    if (!current) return;
    current.listeners.delete(listener);
    if (current.listeners.size === 0) {
      current.source.close();
      connections.delete(url);
    }
  };
}
