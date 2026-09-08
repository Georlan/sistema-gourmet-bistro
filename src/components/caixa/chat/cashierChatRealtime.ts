export interface CashierChatStreamEvent {
  event: string;
  data: Record<string, unknown> | null;
}

interface ConsumeCashierChatEventsOptions {
  url: string;
  authorization: string;
  signal: AbortSignal;
  onOpen?: () => void;
  onEvent: (event: CashierChatStreamEvent) => void;
}

function parseEventFrame(frame: string): CashierChatStreamEvent | null {
  const lines = frame.split(/\r?\n/);
  let eventName = 'message';
  const dataLines: string[] = [];

  for (const line of lines) {
    if (!line || line.startsWith(':')) continue;
    if (line.startsWith('event:')) {
      eventName = line.slice('event:'.length).trim() || 'message';
      continue;
    }
    if (line.startsWith('data:')) {
      dataLines.push(line.slice('data:'.length).trimStart());
    }
  }

  if (dataLines.length === 0) return null;
  const rawData = dataLines.join('\n');
  let data: Record<string, unknown> | null = null;
  try {
    const parsed = JSON.parse(rawData);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      data = parsed as Record<string, unknown>;
    }
  } catch {
    data = null;
  }
  return { event: eventName, data };
}

export async function consumeCashierChatEvents({
  url,
  authorization,
  signal,
  onOpen,
  onEvent,
}: ConsumeCashierChatEventsOptions): Promise<void> {
  const response = await fetch(url, {
    headers: {
      Accept: 'text/event-stream',
      Authorization: authorization,
    },
    cache: 'no-store',
    signal,
  });

  if (!response.ok || !response.body) {
    throw new Error(`Cashier chat realtime unavailable (${response.status || 'no-stream'}).`);
  }

  onOpen?.();
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (!signal.aborted) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let boundary = buffer.search(/\r?\n\r?\n/);
      while (boundary >= 0) {
        const match = buffer.slice(boundary).match(/^\r?\n\r?\n/);
        const separatorLength = match?.[0].length || 2;
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + separatorLength);
        const parsed = parseEventFrame(frame);
        if (parsed) onEvent(parsed);
        boundary = buffer.search(/\r?\n\r?\n/);
      }
    }
  } finally {
    reader.releaseLock();
  }

  if (!signal.aborted) {
    throw new Error('Cashier chat realtime stream ended unexpectedly.');
  }
}
