/** Read-only discovery of the existing companion. Never pairs or prints. */
export interface LocalAgentIdentity {
  status: string;
  service: string;
  agent_id: string;
  adapter?: string;
  platform?: string;
}

export type LocalConnectionStatus = 'checking' | 'ready' | 'permission_prompt' | 'permission_denied' | 'unavailable';
export interface LocalConnection {
  status: LocalConnectionStatus;
  identity: LocalAgentIdentity | null;
}
type PermissionQuery = Pick<Permissions, 'query'>;

export async function queryLoopbackPermission(api: PermissionQuery | undefined): Promise<PermissionStatus | null> {
  if (!api) return null;
  // New Chromium separates this computer from LAN devices. The older combined
  // name remains a fallback; LAN permission alone does not grant loopback.
  for (const name of ['loopback-network', 'local-network-access']) {
    try { return await api.query({ name: name as PermissionName }); }
    catch { /* Legacy browsers keep their existing discovery contract. */ }
  }
  return null;
}

export async function probeLocalAgent({ permission, interactive = false, signal,
  fetcher = fetch, timeoutMs = interactive ? 30_000 : 450,
}: {
  permission: PermissionState | 'unsupported';
  interactive?: boolean;
  signal?: AbortSignal;
  fetcher?: typeof fetch;
  timeoutMs?: number;
}): Promise<LocalConnection> {
  if (permission === 'denied') return { status: 'permission_denied', identity: null };
  if (permission === 'prompt' && !interactive) return { status: 'permission_prompt', identity: null };
  if (signal?.aborted) return { status: 'unavailable', identity: null };
  const controllers = new Set<AbortController>();
  let found!: (identity: LocalAgentIdentity | null) => void;
  const firstIdentity = new Promise<LocalAgentIdentity | null>(resolve => { found = resolve; });
  const cancelled = () => found(null);
  signal?.addEventListener('abort', cancelled, { once: true });
  const attempts = Array.from({ length: 11 }, async (_, index) => {
    const controller = new AbortController();
    controllers.add(controller);
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    const timeout = setTimeout(abort, timeoutMs);
    try {
      const options: RequestInit & { targetAddressSpace: 'loopback' } = {
        signal: controller.signal, cache: 'no-store', targetAddressSpace: 'loopback',
      };
      const response = await fetcher(`http://127.0.0.1:${17654 + index}/agent/identity`, options);
      if (!response.ok) return null;
      const data = await response.json();
      if (controller.signal.aborted || signal?.aborted || data?.service !== 'koma-print-agent'
        || data.status !== 'ready' || typeof data.agent_id !== 'string' || !data.agent_id.trim()) return null;
      found(data as LocalAgentIdentity);
      return data as LocalAgentIdentity;
    } catch { return null; }
    finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
      controllers.delete(controller);
    }
  });
  // One verified local identity is sufficient. Unrelated services listening on
  // another port must not hold a successful connection until their deadline.
  void Promise.all(attempts).then(() => found(null));
  const discovered = await firstIdentity;
  signal?.removeEventListener('abort', cancelled);
  for (const controller of controllers) controller.abort();
  const identity = signal?.aborted ? null : discovered;
  return { status: identity ? 'ready' : 'unavailable', identity };
}
